// src/routes/identity.ts
// ---------------------------------------------------------------------------
// CW25 — identity stitching (scope appendix §1.12, ledger 20 row 2).
//
//   POST /v1/:tenant/identity/link      the site says who this browser is
//   POST /v1/:tenant/identity/detach    this browser stops being anyone (logout)
//   POST /v1/:tenant/identity/resolve   account id → shopper id, for the warehouse
//   GET  /v1/:tenant/identity/visitor/:visitorId   which person, if any
//   GET  /v1/:tenant/identity/shopper/:shopperId   which browsers, and the history applied
//   POST /v1/:tenant/identity/events    historical rows, JSON or CSV
//   POST /v1/:tenant/identity/erase     the right to be forgotten: links, profiles, ledger rows
//
// Mounted under /v1, so the site-key gate (CW10) covers everything here. The
// link and detach are the SDK's calls. Linking always also requires a backend
// signed assertion; missing verification configuration refuses it. The rest is the
// data team's and wants the operator token, like the ledger routes.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import { operatorJwt } from '@/middleware/operatorAuth';
import { SessionManager } from '@/services/SessionManager';
import { verifyAssertion } from '@/identity/assertion';
import { linkVisitor, validVisitorId } from '@/identity/link';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';
import { applyHistory, HistoryCsvError, historyRowSchema, parseHistoryCsv, MAX_ROWS } from '@/identity/history';
import { eraseSubject, reconcileErasure, erasureReconciliationSchema, ErasureFailure } from '@/identity/erase';
import type { AuthContext } from '@/middleware/auth';
import { requireShopper, shopperPrincipal, capabilityToken, verifySessionCapability, issueSessionCapability, signSessionCapability, assertSessionTarget, SessionAccessError } from '@/identity/sessionCapability';
import { anonymousWithConsent, establishRefusal, ownedConsent, rotateObjectSession } from '@/identity/consentContinuity';
import { consentFromCookies, intersectConsent, refusalHints } from '@/content/consent';
import { tenantForRequest } from '@/tenancy/middleware';
import { profileRowSchema } from '@/identity/profileEnrichment';
import { auditedSubjectOperation } from '@/auth/subjectAudit';
import { tenantKey } from '@/tenancy/tenant';
import { forwardShopperRequest, shopperRequestHeld } from '@/identity/sessionAuthority';

export const identityRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables & { auth: AuthContext } }>();

const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const identityId = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const identityTime = z.number().finite();
const identitySource = z.enum(['login', 'signup', 'checkout', 'import', 'other']);
const identityAssurance = z.enum(['site', 'signed']);
const visitorLinkRead = z.object({ visitorId: identityId.refine(id => !isShopperId(id)), shopperId: identityId.refine(isShopperId), linkedAt: identityTime,
  assurance: identityAssurance, source: identitySource, ownSessionId: identityId.optional(),
  previous: z.array(z.object({ shopperId: identityId.refine(isShopperId), linkedAt: identityTime, until: identityTime })).max(10).optional() });
const shopperRead = z.object({ shopperId: identityId.refine(isShopperId), createdAt: identityTime, salted: z.boolean(),
  visitors: z.array(z.object({ visitorId: identityId.refine(id => !isShopperId(id)), linkedAt: identityTime,
    assurance: identityAssurance, source: identitySource })).max(50),
  history: z.object({ rows: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), latestAt: identityTime, appliedAt: identityTime }).optional() });
async function identityRaw(env: Env, tenant: string, key: string): Promise<unknown> {
  const value = await env.SESSIONS.get(tenantKey(tenant, key));
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Identity unavailable');
  const parsed: unknown = JSON.parse(value);
  if (parsed === null) throw new Error('Identity unavailable');
  return parsed;
}

const linkSchema = z.object({
  visitorId: z.string().trim().min(1).max(200),
  accountId: z.string().trim().min(1).max(200),
  source: z.enum(['login', 'signup', 'checkout', 'import', 'other']).default('login'),
  exp: z.number().int().optional(),
  assertion: z.string().min(1).max(200).optional(),
});

function tenantOf(c: { req: { param(name: string): string | undefined } }): string | null {
  const t = (c.req.param('tenant') ?? '').trim();
  return TENANT.test(t) ? t : null;
}

/**
 * The link. Returns the id the client carries from now on. On the session host
 * the response also sets the session cookie to the person's session, so every
 * tab on this device lands there on its next request without any forwarding.
 */
identityRoutes.post('/:tenant/identity/session', async (c) => {
  const tenant = tenantOf(c);
  if (!tenant || tenant !== (c.get('tenant') ?? tenantForRequest(c.env, c.req.raw))) throw new SessionAccessError();
  const incoming = capabilityToken(c.req.raw);
  if (incoming !== null) {
    const principal = await verifySessionCapability(c.env, incoming, tenant);
    if (!shopperRequestHeld(c.req.raw, principal)) return forwardShopperRequest(c.env, c.req.raw, principal);
  }
  let body: { consent?: unknown } = {};
  try { const text = await c.req.text(); if (text) body = JSON.parse(text); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const hints = intersectConsent(consentFromCookies(c.req.header('Cookie')), refusalHints(body?.consent));
  const token = capabilityToken(c.req.raw);
  let session;
  if (token === null) session = await anonymousWithConsent(c.env, tenant, hints);
  else {
    const principal = await verifySessionCapability(c.env, token, tenant);
    const consent = intersectConsent(await ownedConsent(c.env, principal, token), hints);
    session = { ...principal, capability: token, consent: await establishRefusal(c.env, principal, token, consent) };
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, session });
});

identityRoutes.post('/:tenant/identity/link', requireShopper({ forward: false }), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let body: unknown;
  try { body = await c.req.raw.clone().json(); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400);
  const { visitorId, accountId, source, exp, assertion } = parsed.data;
  const principal = shopperPrincipal(c.req.raw);
  assertSessionTarget(principal, visitorId);

  if (!validVisitorId(visitorId)) return c.json({ ok: false, error: 'visitorId is not a visitor id' }, 400);
  if (isShopperId(visitorId)) {
    // A browser already carrying a person's id is signed in as that person.
    // Linking it to another account would fold one person into another.
    return c.json({ ok: false, error: 'this browser already carries a shopper id; detach first' }, 409);
  }

  const verdict = await verifyAssertion(c.env, tenant, { visitorId, accountId, exp, assertion });
  if (!verdict.ok) return c.json({ ok: false, error: verdict.reason }, 401);
  if (!shopperRequestHeld(c.req.raw, principal)) return forwardShopperRequest(c.env, c.req.raw, principal);

  const result = await linkVisitor(c.env, tenant, { visitorId, accountId, source, assurance: verdict.assurance, principal, capability: capabilityToken(c.req.raw)!, cookieHeader: c.req.header('Cookie') });
  if (!result.sessionId) throw new SessionAccessError();
  const session = { ...await signSessionCapability(c.env, result.grant!), consent: result.consent };
  for (const h of result.cookieHeaders) c.header('Set-Cookie', h, { append: true });
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    tenant,
    shopperId: result.shopperId,
    visitorId: result.visitorId,
    outcome: result.outcome,
    assurance: result.assurance,
    salted: isSalted(c.env),
    audiences: result.audiences,
    changes: { entered: result.changes.entered, exited: result.changes.exited },
    // What the client does next, spelled out so no SDK has to guess.
    carry: result.shopperId,
    session,
  });
});

/**
 * Detach keeps the person's profile, transfers only refusal to fresh anonymous
 * authority, and clears private mirrors without expiring the refusal cookies.
 */
identityRoutes.post('/:tenant/identity/detach', requireShopper(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const sm = new SessionManager(c.env, { tenant });
  const principal = shopperPrincipal(c.req.raw), token = capabilityToken(c.req.raw)!;
  const session = await rotateObjectSession(c.env, principal, token, 'detach', c.req.header('Cookie'));
  for (const h of sm.clearCookieHeaders()) c.header('Set-Cookie', h, { append: true });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, detached: true, session });
});

/** The warehouse's join key for an account, without the warehouse holding the salt. */
identityRoutes.post('/:tenant/identity/resolve', operatorJwt(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let body: unknown, bytes = 0, raw = '';
  const reader = c.req.raw.body?.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    if (reader) for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1024 * 1024) { await reader.cancel().catch(() => undefined); return c.json({ ok: false, error: 'Resolve exceeds1MiB' }, 413); }
      raw += decoder.decode(next.value, { stream: true });
    }
    body = JSON.parse(raw + decoder.decode());
  } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  finally { reader?.releaseLock(); }
  const parsed = z.object({ accountIds: z.array(z.string().refine(id => !!id.trim() && id.trim().length <= 200)).min(1).max(1000) }).strict().safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'accountIds must contain1–1000 nonblank accounts of at most200 characters' }, 400);
  const ids = parsed.data.accountIds;
  return auditedSubjectOperation(c, tenant, 'identity_resolve', { kind: 'accounts', values: ids }, async report => {
    const shoppers = await Promise.all(ids.map(id => shopperIdFor(c.env, tenant, id)));
    await report.resolved(shoppers);
    return c.json({ ok: true, tenant, salted: isSalted(c.env), resolved: Object.fromEntries(ids.map((id, ordinal) => [id, shoppers[ordinal]!])) });
  });
});

identityRoutes.get('/:tenant/identity/visitor/:visitorId', operatorJwt(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const visitorId = (c.req.param('visitorId') ?? '').trim();
  if (!validVisitorId(visitorId)) return c.json({ ok: false, error: 'visitorId is not a visitor id' }, 400);
  return auditedSubjectOperation(c, tenant, 'identity_visitor', { kind: 'visitor', value: visitorId }, async report => {
    const raw = await identityRaw(c.env, tenant, 'identity:visitor:' + visitorId), link = raw === null ? null : visitorLinkRead.parse(raw);
    if (link && link.visitorId !== visitorId) throw new Error('Identity unavailable');
    const shopperId = isShopperId(visitorId) ? visitorId : link?.shopperId ?? null;
    if (shopperId) await report.subject(shopperId);
    report.result({ outcome: 'read', found: link !== null });
    return c.json({ ok: true, tenant, visitorId, shopperId, link });
  });
});

identityRoutes.get('/:tenant/identity/shopper/:shopperId', operatorJwt(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const shopperId = (c.req.param('shopperId') ?? '').trim();
  if (!isShopperId(shopperId)) return c.json({ ok: false, error: 'not a shopper id' }, 400);
  return auditedSubjectOperation(c, tenant, 'identity_shopper', { kind: 'shopper', value: shopperId }, async report => {
    const raw = await identityRaw(c.env, tenant, 'identity:shopper:' + shopperId), rec = raw === null ? null : shopperRead.parse(raw);
    if (rec && rec.shopperId !== shopperId) throw new Error('Identity unavailable');
    report.result({ outcome: 'read', found: rec !== null });
    if (!rec) return c.json({ ok: false, error: 'unknown shopper' }, 404);
    await report.subject(rec.shopperId);
    return c.json({ ok: true, tenant, shopper: rec });
  });
});

/**
 * Historical rows. `application/json` with `{ rows: [...] }`, or `text/csv`
 * with a header row. Each row is validated; a bad row fails the request, a row
 * that names nobody or carries no registry attribute is skipped and reported.
 */
identityRoutes.post('/:tenant/identity/events', operatorJwt(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const ct = (c.req.header('Content-Type') ?? '').toLowerCase();
  const csv = ct.includes('text/csv'), format = csv ? 'CSV' : 'JSON';
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0, text: string;
  try {
    if (reader) for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1024 * 1024) {
        await reader.cancel().catch(() => undefined);
        return c.json({ ok: false, error: `${format} import exceeds1MiB` }, 413);
      }
      chunks.push(next.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(joined);
  } catch { return c.json({ ok: false, error: `invalid ${format} body` }, 400); }
  finally { reader?.releaseLock(); }
  let raw: unknown[];
  try {
    if (csv) raw = parseHistoryCsv(text);
    else {
      const body = JSON.parse(text) as { rows?: unknown };
      raw = Array.isArray(body?.rows) ? body.rows : [];
    }
  } catch (error) {
    return error instanceof HistoryCsvError ? c.json({ ok: false, error: error.message }, error.status)
      : c.json({ ok: false, error: `invalid ${format} body` }, 400);
  }
  if (raw.length === 0) return c.json({ ok: false, error: 'no rows' }, 400);
  if (raw.length > MAX_ROWS) return c.json({ ok: false, error: `at most ${MAX_ROWS} rows per request` }, 413);
  const now = Date.now();
  const parsed = z.array(z.union([
    profileRowSchema.refine(row => row.at <= now, 'profile snapshot is in the future'),
    historyRowSchema.and(z.object({ kind: z.never().optional() })),
  ])).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return c.json({ ok: false, error: `row ${String(issue?.path[0] ?? '?')}: ${issue?.message ?? 'invalid'}` }, 400);
  }
  // Preserve the existing unaudited open/demo path, including its error behavior.
  if (c.env.AUTH_MODE !== 'enforced') {
    const report = await applyHistory(c.env, tenant, parsed.data, now);
    return c.json({ ok: true, tenant, ...report });
  }
  return auditedSubjectOperation(c, tenant, 'identity_import', { kind: 'history', format: csv ? 'csv' : 'json', rows: parsed.data }, async audit => {
    const report = await applyHistory(c.env, tenant, parsed.data, now);
    await audit.imported(report);
    return c.json({ ok: true, tenant, ...report });
  });
});

/**
 * Resume bounded local erasure work using the same original selector. This is
 * not physical/external completion or a replay barrier; the receipt says so.
 */
identityRoutes.post('/:tenant/identity/erase', operatorJwt(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const parsed = z.object({ visitorId: z.string().trim().refine(validVisitorId).optional(),
    shopperId: z.string().trim().refine(isShopperId).optional(), reconcile: erasureReconciliationSchema.optional() }).strict().refine(s => !!(s.visitorId || s.shopperId)).safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'visitorId or shopperId required and must be a valid id' }, 400);
  const { visitorId, shopperId } = parsed.data;
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const selector = { ...(visitorId ? { visitorId } : {}), ...(shopperId ? { shopperId } : {}) };
  return auditedSubjectOperation(c, tenant, 'identity_erase', { kind: 'identity', ...selector }, async report => {
    if (parsed.data.reconcile) {
      try {
        const result = await reconcileErasure(c.env, tenant, selector, actor, parsed.data.reconcile);
        report.result({ outcome: 'identity_erase', status: result.status, localComplete: result.localComplete, complete: false, cutoff: result.at });
        // Reconciliation remains pending external verification. Retain the
        // existing strict audit mapping (pending -> 202), not local completion.
        return c.json(result, 202);
      } catch (error) {
        if (!(error instanceof ErasureFailure)) throw error;
        report.result({ outcome: 'identity_erase', status: error.status === 409 ? 'conflict' : 'failed', localComplete: false, complete: false, cutoff: parsed.data.reconcile.at });
        return c.json({ ok: false, complete: false, error: error.message }, error.status);
      }
    }
    const { httpStatus, ...receipt } = await eraseSubject(c.env, tenant, selector, actor);
    if (receipt.tenant !== tenant || receipt.subject.visitorId !== selector.visitorId || receipt.subject.shopperId !== selector.shopperId
      || httpStatus !== ({ local_complete: 200, pending: 202, conflict: 409, failed: 503 })[receipt.status]) throw new Error('Erasure receipt unavailable');
    report.result({ outcome: 'identity_erase', status: receipt.status, localComplete: receipt.localComplete, complete: receipt.complete, cutoff: receipt.at });
    if (receipt.shopperId) await report.subject(receipt.shopperId);
    return c.json(receipt, httpStatus);
  });
});
