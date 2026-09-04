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
//
// Mounted under /v1, so the site-key gate (CW10) covers everything here. The
// link and detach are the SDK's calls and need only the site key, plus the
// signed assertion where the tenant has an identity secret. The rest is the
// data team's and wants the operator token, like the ledger routes.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import { jwt } from '@/middleware/auth';
import { SessionManager } from '@/services/SessionManager';
import { verifyAssertion } from '@/identity/assertion';
import { linkVisitor, validVisitorId } from '@/identity/link';
import { IdentityStore } from '@/identity/store';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';
import { applyHistory, historyRowSchema, parseHistoryCsv, MAX_ROWS } from '@/identity/history';

export const identityRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

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
identityRoutes.post('/:tenant/identity/link', async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid body' }, 400);
  const { visitorId, accountId, source, exp, assertion } = parsed.data;

  if (!validVisitorId(visitorId)) return c.json({ ok: false, error: 'visitorId is not a visitor id' }, 400);
  if (isShopperId(visitorId)) {
    // A browser already carrying a person's id is signed in as that person.
    // Linking it to another account would fold one person into another.
    return c.json({ ok: false, error: 'this browser already carries a shopper id; detach first' }, 409);
  }

  const verdict = await verifyAssertion(c.env, tenant, { visitorId, accountId, exp, assertion });
  if (!verdict.ok) return c.json({ ok: false, error: verdict.reason }, 401);

  const cookieSessionId = new SessionManager(c.env, { tenant }).parseSessionCookies(c.req.header('Cookie') ?? null).sessionId ?? null;
  const result = await linkVisitor(c.env, tenant, { visitorId, accountId, source, assurance: verdict.assurance, cookieSessionId });
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
  });
});

/**
 * Detach: clear this device's session cookies and nothing else. The person's
 * profile stays whole for their next sign-in; the client mints a fresh
 * anonymous id. Erasure is a different door (session reset), on purpose.
 */
identityRoutes.post('/:tenant/identity/detach', async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const sm = new SessionManager(c.env, { tenant });
  for (const h of sm.clearCookieHeaders()) c.header('Set-Cookie', h, { append: true });
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, detached: true });
});

/** The warehouse's join key for an account, without the warehouse holding the salt. */
identityRoutes.post('/:tenant/identity/resolve', jwt({ required: true }), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let body: { accountIds?: unknown } = {};
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const ids = Array.isArray(body.accountIds) ? body.accountIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 1000) : [];
  if (ids.length === 0) return c.json({ ok: false, error: 'accountIds: string[] required' }, 400);
  const resolved: Record<string, string> = {};
  for (const id of ids) resolved[id] = await shopperIdFor(c.env, tenant, id);
  return c.json({ ok: true, tenant, salted: isSalted(c.env), resolved });
});

identityRoutes.get('/:tenant/identity/visitor/:visitorId', jwt({ required: true }), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const visitorId = (c.req.param('visitorId') ?? '').trim();
  if (!validVisitorId(visitorId)) return c.json({ ok: false, error: 'visitorId is not a visitor id' }, 400);
  const store = new IdentityStore(c.env.SESSIONS as never, tenant);
  const link = await store.visitorLink(visitorId);
  return c.json({ ok: true, tenant, visitorId, shopperId: isShopperId(visitorId) ? visitorId : (link?.shopperId ?? null), link });
});

identityRoutes.get('/:tenant/identity/shopper/:shopperId', jwt({ required: true }), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const shopperId = (c.req.param('shopperId') ?? '').trim();
  if (!isShopperId(shopperId)) return c.json({ ok: false, error: 'not a shopper id' }, 400);
  const store = new IdentityStore(c.env.SESSIONS as never, tenant);
  const rec = await store.shopper(shopperId);
  if (!rec) return c.json({ ok: false, error: 'unknown shopper' }, 404);
  return c.json({ ok: true, tenant, shopper: rec });
});

/**
 * Historical rows. `application/json` with `{ rows: [...] }`, or `text/csv`
 * with a header row. Each row is validated; a bad row fails the request, a row
 * that names nobody or carries no registry attribute is skipped and reported.
 */
identityRoutes.post('/:tenant/identity/events', jwt({ required: true }), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const ct = (c.req.header('Content-Type') ?? '').toLowerCase();
  let raw: unknown[];
  if (ct.includes('text/csv')) {
    raw = parseHistoryCsv(await c.req.text());
  } else {
    let body: { rows?: unknown } = {};
    try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
    raw = Array.isArray(body.rows) ? body.rows : [];
  }
  if (raw.length === 0) return c.json({ ok: false, error: 'no rows' }, 400);
  if (raw.length > MAX_ROWS) return c.json({ ok: false, error: `at most ${MAX_ROWS} rows per request` }, 413);
  const parsed = z.array(historyRowSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return c.json({ ok: false, error: `row ${String(issue?.path[0] ?? '?')}: ${issue?.message ?? 'invalid'}` }, 400);
  }
  const report = await applyHistory(c.env, tenant, parsed.data);
  return c.json({ ok: true, tenant, ...report });
});

