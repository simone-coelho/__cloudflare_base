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
//   POST /v1/:tenant/identity/export    the right of access: everything of hers the erasure reaches
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
import { requireShopper, shopperPrincipal, capabilityToken, verifySessionCapability, issueSessionCapability, signSessionCapability, assertSessionTarget, readContinuityProof, CONTINUITY_COOKIE, CONTINUITY_RETIRED_HEADER, SHOPPER_HEADER, SessionAccessError, type ContinuityDescriptor } from '@/identity/sessionCapability';
import { anonymousWithConsent, establishRefusal, ownedConsent, rotateObjectSession } from '@/identity/consentContinuity';
import { consentFromCookies, intersectConsent, personalizes, refusalHints, storedConsent, type Consent } from '@/content/consent';
import { accountIdFormatRefusal, publishedContinuity } from '@/reflex/configStore';
import { resolveTenantReflexConfig, resolveTenantReflexConfigRevision } from '@/demos/registry';
import { shopperObject } from '@/tenancy/objects';
import type { ContinuitySettings } from '@/reflex/core';
import { tenantForRequest } from '@/tenancy/middleware';
import { profileRowSchema } from '@/identity/profileEnrichment';
import { auditedSubjectOperation } from '@/auth/subjectAudit';
import { tenantKey, TenantKV, type KVLike } from '@/tenancy/tenant';
import { forwardShopperRequest, shopperRequestHeld } from '@/identity/sessionAuthority';
import { subjectDecisionHistory, subjectLedgerRows, type LedgerScanPosition } from '@/routes/decisions';

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

// ── W16 C6: anonymous return continuity on the session route ────────────────
//
// The route the SDK already calls on every page load also answers ONE question
// about return recognition, and the answer is always explicit:
//
//   { enabled: false, reason: 'unpublished' }  this tenant published no block
//   { enabled: false, reason: 'incomplete'  }  it published one that is not a
//                                              configuration yet
//   { enabled: false, reason: 'consent'     }  it is configured, and THIS
//                                              shopper has made no current
//                                              explicit choice
//   { enabled: false, reason: 'unavailable' }  the engine could not reach the
//                                              shopper's own object, or could
//                                              not read what it answered. W16
//                                              C6.13 / R62: a failure of the
//                                              CALL is not a decision about the
//                                              shopper, so it is never reported
//                                              as `consent` — the browser's
//                                              still-valid proof is not the
//                                              engine's to destroy over an
//                                              outage, and the SDK keeps it.
//   { enabled: true, mode, purpose, generation, expiresAt, revision, proof? }
//
// Activation stays absent: nothing here supplies a mode, a window or a covered
// purpose, so an engine with nothing published recognizes nobody and a return
// after the capability expires is a cold shopper. `proof` is present only in
// direct mode; in broker mode the long proof leaves only as the first-party
// `opt_shopper_continuity` cookie and the body carries none.

interface ContinuityInForce { settings: ContinuitySettings; revision: number }
type ContinuityDecision = ContinuityInForce | { reason: 'unpublished' | 'incomplete' };
export type ContinuityReport =
  | { enabled: false; reason: 'unpublished' | 'incomplete' | 'consent' | 'unavailable' }
  | { enabled: true; mode: 'direct' | 'broker'; purpose: string; generation: number;
    expiresAt: number; revision: number; proof?: string };

/**
 * W16 C6.13 (R62, R68). The call to the shopper's own object failed, or its
 * answer could not be read as the acknowledgment this call's contract defines.
 * Nothing was decided about the shopper and nothing about her stored state
 * changed, so the reason is its own — reporting `consent` would state a choice
 * she never made and would make the browser destroy a proof that is still good.
 */
const UNAVAILABLE: ContinuityReport = { enabled: false, reason: 'unavailable' };

const inForce = (decision: ContinuityDecision): decision is ContinuityInForce => 'settings' in decision;

/** The published block and the revision a descriptor binds to. An unreadable
 * configuration is not a reason to recognize anyone: it reports unpublished. */
async function continuityInForce(env: Env, tenant: string): Promise<ContinuityDecision> {
  try {
    const resolved = await resolveTenantReflexConfigRevision(env, tenant);
    const published = publishedContinuity(resolved.config);
    return published.published ? { settings: published.settings, revision: resolved.revision } : { reason: published.reason };
  } catch { return { reason: 'unpublished' }; }
}

/** The long proof never enters a body in broker mode, and never a cookie in
 * direct mode. Bound to the first party, unreadable to script, and never
 * outliving the chain it carries. */
function continuityCookie(proof: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${CONTINUITY_COOKIE}=${proof}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function cookieValueOf(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

const descriptorReport = (d: ContinuityDescriptor, proof: string, setCookie: (value: string) => void): ContinuityReport => {
  if (d.mode === 'broker') {
    setCookie(continuityCookie(proof, d.expiresAt));
    return { enabled: true, mode: 'broker', purpose: d.purpose, generation: d.generation, expiresAt: d.expiresAt, revision: d.revision };
  }
  return { enabled: true, mode: 'direct', purpose: d.purpose, generation: d.generation, expiresAt: d.expiresAt, revision: d.revision, proof };
};

/** The owner object's answer, read without trusting its shape. */
function ownerDescriptor(value: unknown, tenant: string, subject: string): ContinuityDescriptor | null {
  const d = value as Partial<ContinuityDescriptor> | null;
  if (!d || d.tenant !== tenant || d.subject !== subject || (d.mode !== 'direct' && d.mode !== 'broker')
    || typeof d.purpose !== 'string' || !Number.isSafeInteger(d.generation) || !Number.isSafeInteger(d.issuedAt)
    || !Number.isSafeInteger(d.expiresAt) || !Number.isSafeInteger(d.revision) || typeof d.chain !== 'string') return null;
  return d as ContinuityDescriptor;
}

/**
 * Ask the shopper's own object for the chain her browser should carry. Only the
 * object mints one, because only the object holds the generation, the digest
 * and the authority this recognition belongs to. Anything short of an issued
 * descriptor is reported as disabled — this never opens a session it could not
 * prove, and never turns a failure into a recognition.
 *
 * W16 C6.13 (R62): two different things are reported apart. A DECISION about
 * this shopper — she has made no current explicit choice, here or in the
 * object's own answer — is `consent`. A failure of the CALL — the transport
 * threw, the object answered a non-200, or its answer is not the acknowledgment
 * this contract defines — is `unavailable`, because nothing was decided and the
 * browser must keep what it holds.
 *
 * Answers `undefined` — no statement at all — for a session this credential
 * cannot describe. W16 C6 is ANONYMOUS return recognition: the descriptor is
 * bound to an anonymous browser subject and `issueContinuityProof` signs nothing
 * else, so asking a signed-in shopper's own object to mint one is a question the
 * contract has no answer to. Making it cost her the session refresh itself would
 * be worse than saying nothing: she is signed in, she has no anonymous return to
 * recognize, and the engine simply reports nothing about one.
 */
async function reportContinuity(env: Env, tenant: string, decision: ContinuityDecision,
  session: { subject: string; capability: string; kind?: unknown; consent?: Consent },
  setCookie: (value: string) => void): Promise<ContinuityReport | undefined> {
  if (session.kind !== 'anonymous') return undefined;
  if (!inForce(decision)) return { enabled: false, reason: decision.reason };
  if (!personalizes(storedConsent(session.consent))) return { enabled: false, reason: 'consent' };
  let body: { ok?: unknown; enabled?: unknown; descriptor?: unknown; proof?: unknown };
  try {
    const response = await shopperObject(env.SHOPPER_REFLEX, session.subject, tenant)
      .fetch('https://shopper-reflex/identity/continuity/issue', {
        method: 'POST', headers: { [SHOPPER_HEADER]: session.capability, 'X-Tenant': tenant, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: decision.settings.mode, windowMs: decision.settings.windowMs,
          purpose: decision.settings.purpose, revision: decision.revision }),
      });
    if (!response.ok) return UNAVAILABLE;
    body = await response.json() as typeof body;
  } catch (error) { if (error instanceof SessionAccessError) throw error; return UNAVAILABLE; }
  // The object acknowledged and said no: that IS the answer about this shopper.
  if (body.ok === true && body.enabled === false) return { enabled: false, reason: 'consent' };
  if (body.ok !== true || body.enabled !== true || typeof body.proof !== 'string') return UNAVAILABLE;
  const descriptor = ownerDescriptor(body.descriptor, tenant, session.subject);
  return descriptor ? descriptorReport(descriptor, body.proof, setCookie) : UNAVAILABLE;
}

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An explicit choice that refuses a purpose: absence of a choice is not one. */
const refusedExplicitly = (consent: Consent): boolean =>
  consent.instruction?.tracking?.value === false || consent.instruction?.personalization?.value === false;

/**
 * W16 R4 (LANE-LOG R81(c)): once her return is recognized beside the
 * provisional capability an outage served her, the provisional subject is
 * retired in its own object — its taste, its choice, its session projection and
 * its grants — so it holds no state of its own. The object keeps only the
 * operation id of this return until the retired grant's expiry, so the exact
 * retry of a lost answer is answered as this return (see the session route).
 *
 * A retirement that cannot finish is a failure of the CALL, never a statement
 * about the shopper: it is answered as a server error, not a session refusal, so
 * the browser keeps the provisional capability and the pending consume and
 * presents both again. The recognition is already decided; that retry is
 * answered once from the one deterministic receipt and retires again.
 */
class ProvisionalRetirementUnavailable extends Error {
  constructor() { super('Provisional retirement unavailable'); this.name = 'ProvisionalRetirementUnavailable'; }
}
async function retireProvisional(env: Env, principal: { tenant: string; subject: string }, capability: string, operationId: string): Promise<void> {
  let body: { ok?: unknown; retired?: unknown };
  try {
    const response = await shopperObject(env.SHOPPER_REFLEX, principal.subject, principal.tenant)
      .fetch('https://shopper-reflex/identity/continuity/retire', {
        method: 'POST', headers: { [SHOPPER_HEADER]: capability, 'X-Tenant': principal.tenant, 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId }),
      });
    if (!response.ok) throw new ProvisionalRetirementUnavailable();
    body = await response.json() as typeof body;
  } catch { throw new ProvisionalRetirementUnavailable(); }
  if (body.ok !== true || body.retired !== true) throw new ProvisionalRetirementUnavailable();
}

/**
 * A return. The proof arrives by the published transport and only by it, is
 * verified here for signature, tenant, transport, covered purpose, revision and
 * its own fixed expiry, and is then consumed by the object that owns the
 * subject. A proof this route cannot place answers `null`: the caller goes on
 * to open a brand-new anonymous session, which is what a cold shopper is.
 *
 * W16 C6.13 (R62): `'unavailable'` is the third answer, and it is not `null`.
 * The object could not be reached, answered a non-200, or answered something
 * this contract cannot read as its acknowledgment — so this route knows nothing
 * about the shopper, the presented proof was not consumed, and the caller must
 * report the outage by its own name instead of the cold-shopper reason.
 */
type ConsumedContinuity = { grant: unknown; consent: unknown; report: ContinuityReport };
async function consumeContinuity(env: Env, tenant: string, decision: ContinuityDecision, request: Request,
  presented: unknown, hints: Consent, setCookie: (value: string) => void): Promise<ConsumedContinuity | 'unavailable' | null> {
  if (!inForce(decision)) return null;
  // A browser that arrives withdrawing a switch is not asking to be recognized.
  // Transition hints can only restrict, so a refusal is refused recognition.
  if (!personalizes(hints)) return null;
  const offered = presented as { proof?: unknown; operationId?: unknown } | undefined;
  const proof = decision.settings.mode === 'broker'
    ? cookieValueOf(request.headers.get('Cookie'), CONTINUITY_COOKIE)
    : typeof offered?.proof === 'string' ? offered.proof : undefined;
  const operationId = typeof offered?.operationId === 'string' ? offered.operationId : undefined;
  if (!proof || !operationId || !OPERATION_ID.test(operationId)) return null;
  const descriptor = await readContinuityProof(env, proof, tenant);
  if (!descriptor || descriptor.mode !== decision.settings.mode || descriptor.revision !== decision.revision
    || descriptor.purpose !== decision.settings.purpose || descriptor.expiresAt <= Date.now()) return null;
  let body: { ok?: unknown; recognized?: unknown; grant?: unknown; consent?: unknown; descriptor?: unknown; proof?: unknown };
  try {
    const response = await shopperObject(env.SHOPPER_REFLEX, descriptor.subject, tenant)
      .fetch('https://shopper-reflex/identity/continuity/consume', {
        method: 'POST', headers: { 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': descriptor.subject, 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof, operationId, settings: { mode: decision.settings.mode, windowMs: decision.settings.windowMs,
          purpose: decision.settings.purpose, revision: decision.revision } }),
      });
    if (!response.ok) return 'unavailable';
    body = await response.json() as typeof body;
  } catch (error) { if (error instanceof SessionAccessError) throw error; return 'unavailable'; }
  // The object acknowledged and placed nobody: a cold shopper, decided.
  if (body.ok === true && body.recognized === false) return null;
  // Anything else is an answer this contract cannot read as the acknowledgment,
  // so it says nothing about the shopper and the proof stays hers.
  if (body.ok !== true || body.recognized !== true || typeof body.proof !== 'string' || body.consent === undefined) return 'unavailable';
  const rotated = ownerDescriptor(body.descriptor, tenant, descriptor.subject);
  const grant = body.grant as { tenant?: unknown; subject?: unknown; kind?: unknown } | null;
  if (!rotated || rotated.chain !== descriptor.chain || rotated.expiresAt !== descriptor.expiresAt
    || !grant || grant.tenant !== tenant || grant.subject !== descriptor.subject || grant.kind !== 'anonymous') return 'unavailable';
  return { grant, consent: body.consent, report: descriptorReport(rotated, body.proof, setCookie) };
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
  // W16 R4: the exact retry of a return recognized beside a provisional
  // capability. Recognition retired that capability in its own object, so the
  // object refuses it — and says, by `CONTINUITY_RETIRED_HEADER`, that it was
  // retired by THIS return (the same operation). The retry is then answered as
  // the return it is, without the capability: the consume in her own object
  // answers it once from its one receipt (same subject, generation, grant and
  // successor proof), and anything after that is a cold shopper.
  let retiredByReturn = false, early: string | undefined;
  if (incoming !== null) {
    const principal = await verifySessionCapability(c.env, incoming, tenant);
    if (!shopperRequestHeld(c.req.raw, principal)) {
      if (principal.kind === 'anonymous') early = await c.req.raw.clone().text();
      const forwarded = await forwardShopperRequest(c.env, c.req.raw, principal);
      if (early === undefined || forwarded.status !== 401 || forwarded.headers.get(CONTINUITY_RETIRED_HEADER) !== 'recognized') return forwarded;
      void forwarded.body?.cancel().catch(() => undefined);
      retiredByReturn = true;
    }
  }
  let body: { consent?: unknown; continuity?: unknown } = {};
  try { const text = early ?? await c.req.text(); if (text) body = JSON.parse(text); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const hints = intersectConsent(consentFromCookies(c.req.header('Cookie')), refusalHints(body?.consent));
  const token = retiredByReturn ? null : capabilityToken(c.req.raw);
  const setCookie = (value: string) => c.header('Set-Cookie', value, { append: true });
  const decision = await continuityInForce(c.env, tenant);
  let session;
  let continuity: ContinuityReport | undefined;
  if (token === null) {
    // W16 C6: a browser with no capability may still be a shopper this engine
    // recognizes. The consume is atomic in her own object; anything else opens
    // a brand-new anonymous session, which is exactly a cold shopper.
    const returned = await consumeContinuity(c.env, tenant, decision, c.req.raw, body?.continuity, hints, setCookie);
    if (returned === 'unavailable') {
      // W16 C6.13 (R62): the engine could not ask her own object, so it knows
      // nothing about her. She is still SERVED — a failure to recognize is never
      // a failure to answer — on a brand-new anonymous session, and the outage is
      // reported by its own name so the browser keeps the proof it still holds
      // and presents the same consume again.
      session = await anonymousWithConsent(c.env, tenant, hints);
      continuity = UNAVAILABLE;
    } else if (returned) {
      session = { ...await signSessionCapability(c.env, returned.grant as Parameters<typeof signSessionCapability>[1]),
        consent: storedConsent(returned.consent) };
      continuity = returned.report;
    } else session = await anonymousWithConsent(c.env, tenant, hints);
  } else {
    const principal = await verifySessionCapability(c.env, token, tenant);
    // W16 C6.13 (R62, R72). A browser carrying BOTH a capability and a
    // recognition proof is a browser whose return this engine could not finish:
    // the `unavailable` answer served it a PROVISIONAL anonymous session in
    // place of the recognition, and a return carries no capability by contract,
    // so without this the same consume would never be offered again and she
    // would be lost for good. Two things bound it. It is attempted only when the
    // session she already holds is itself ANONYMOUS, so a presented proof can
    // never take over a session that belongs to an identified shopper; and it
    // is the ordinary consume, atomic in her own object, so the chain keeps its
    // single use, its one rotation and its one deterministic retry. Nothing of
    // the provisional subject is carried across: it is not merged, not read and
    // not renewed — and once she is recognized it is retired (W16 R4, LANE-LOG
    // R81(c)): the provisional subject holds no state of its own afterwards.
    //
    // A choice made ON the provisional session that refuses a purpose is hers
    // and outranks the return: a session that refused is not asking to be
    // recognized, exactly as a refusing transition hint is not (fail closed).
    const provisionalRefused = principal.kind === 'anonymous' && body?.continuity !== undefined
      && refusedExplicitly(await ownedConsent(c.env, principal, token));
    const returned = principal.kind === 'anonymous' && body?.continuity !== undefined && !provisionalRefused
      ? await consumeContinuity(c.env, tenant, decision, c.req.raw, body.continuity, hints, setCookie)
      : null;
    if (returned !== null && returned !== 'unavailable') {
      session = { ...await signSessionCapability(c.env, returned.grant as Parameters<typeof signSessionCapability>[1]),
        consent: storedConsent(returned.consent) };
      continuity = returned.report;
      // consumeContinuity recognized nobody without a valid operation id.
      await retireProvisional(c.env, principal, token, String((body.continuity as { operationId?: unknown }).operationId));
    } else {
      if (returned === 'unavailable') continuity = UNAVAILABLE;
      const consent = intersectConsent(await ownedConsent(c.env, principal, token), hints);
      session = { ...principal, capability: token, consent: await establishRefusal(c.env, principal, token, consent) };
    }
  }
  continuity ??= await reportContinuity(c.env, tenant, decision, session, setCookie);
  c.header('Cache-Control', 'no-store');
  // `continuity` is absent when the engine makes no statement about anonymous
  // return recognition for this session (an identified shopper has none).
  return c.json({ ok: true, session, ...(continuity === undefined ? {} : { continuity }) });
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
  // P12 (decision D2): a tenant that declares its account identifier format
  // links only an identifier in it; one that declares none links as before. The
  // document is the one the link itself reads (linkVisitor), and the refusal
  // comes before anything is linked or merged, so the browser stays as it was.
  const outsideFormat = accountIdFormatRefusal(await resolveTenantReflexConfig(c.env, tenant), accountId);
  if (outsideFormat) return c.json({ ok: false, error: outsideFormat }, 400);
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

/**
 * W37 T5 (decision D2, lead rulings of 2026-09-24 and 2026-09-30): the
 * per-shopper export — the right of access beside the right to be forgotten. It
 * takes the erase route's selector (`visitorId` and/or `shopperId`, at least
 * one), operator authentication and tenant scope, and it is audited as the
 * erase is (`identity_export`, a read). Its subject is the erasure's: a browser
 * resolves to its person, and the person to every browser linked to her — the
 * browsers her person record lists, and every other browser whose current
 * identity link in the tenant names her, found by the same scan of the tenant's
 * `identity:visitor:` links and the same condition the erasure's discovery uses
 * (src/identity/erase.ts discoverPage).
 *
 * For each of her ids it answers, as each store holds it: her identity links
 * and person record (SESSIONS), each of her shopper objects' profile, consent
 * instruction and pipeline (SHOPPER_REFLEX), the session records her pointers
 * and remembered own sessions name (SESSIONS), her profile copies and
 * overrides (CACHE), and her receipts, ring and receipted ledger records
 * (DECISION_RING, STORAGE); then every other session record of hers the scan of
 * the tenant's session records finds (as the erasure's session discovery scans
 * them), and every row of hers in the tenant's ledger partition (STORAGE).
 * Nothing of another tenant is read, the account id is on none of these
 * records, and what an erasure removed or hides is never answered. A read that
 * fails refuses the export rather than leaving a store out.
 *
 * THE CONTINUATION (shape B of the fix-3 ruling). The link, session and ledger
 * scans have no per-shopper index, so the export is a sequence of calls, each
 * bounded, and the `cursor` carries only where each scan resumes — never a list
 * of browsers — so it is the same size whether she has fifty browsers or
 * thousands. The first call (no cursor) answers her person record and every id
 * her record lists or the selector names. Every call then continues the scans
 * in order — links, then sessions, then the ledger — and answers, in that same
 * call, each browser its slice of the link scan finds linked to her, and each
 * session record and ledger row of hers its slices read. Whether an id is hers
 * is decided again by every call (listed on her record or named by the
 * selector, or its current link names her), never taken from the cursor. One
 * call visits at most `EXPORT_SCAN_KEYS` link and session keys together, reads
 * at most `EXPORT_OWNER_READS` identity links to decide whether a session's or
 * ledger row's owner is hers, answers the per-id records of at most
 * `EXPORT_ANSWER_IDS` ids, and opens at most the ledger scan's own bound
 * (`SUBJECT_EXPORT_LIMITS`); a scan stops at the key, record or row where its
 * bound is reached and the next call resumes there. `complete` says whether
 * all three scans are finished; `next` is the `cursor` the same export sends to
 * continue. `limits` names what the export does not answer.
 */
const EXPORT_LIMITS = [
  'Learning bookkeeping (LEARN_STATS effect markers, hourly shard rings and aggregates, day reports) holds her contribution as attribution state and counts; it is not exported per shopper',
  'Analytics Engine datasets, worker logs, ODP and other external destinations and tenantless historical D1 are outside this export, as they are outside local erasure',
] as const;
/** W37 T5: the link and session keys one export call visits, together. */
const EXPORT_SCAN_KEYS = 256;
/** W37 T5: the identity links one export call reads to decide whether a session's or a ledger row's owner is hers. */
const EXPORT_OWNER_READS = 256;
/** W37 T5: the ids whose own records one export call answers (her person, the fifty browsers her record can list and the selector fit in the first). */
const EXPORT_ANSWER_IDS = 64;
const EXPORT_CURSOR_BYTES = 16_384;
/** Where a key scan resumes: the listing page that holds the next key (null: the first page), and the last key it consumed. */
const scanPosition = z.union([z.literal('done'), z.null(),
  z.object({ page: z.string().min(1).max(4096).nullable(), after: z.string().min(1).max(512).nullable() }).strict()]);
type ScanPosition = { page: string | null; after: string | null };
const exportCursorSchema = z.object({ v: z.literal(3), links: scanPosition, sessions: scanPosition,
  ledger: z.object({ key: z.string().min(1).max(1024).nullable(), line: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable() }).strict().nullable() }).strict();
type ExportCursor = z.infer<typeof exportCursorSchema>;
function encodeExportCursor(cursor: ExportCursor): string {
  // Only a cursor the decoder takes is ever issued; a scan position past its bound refuses the call instead.
  const encoded = btoa(JSON.stringify(exportCursorSchema.parse(cursor))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (encoded.length > EXPORT_CURSOR_BYTES) throw new Error('Export continuation unavailable');
  return encoded;
}
function decodeExportCursor(value: string): ExportCursor | null {
  try { return exportCursorSchema.parse(JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')))); }
  catch { return null; }
}
const exportSchema = z.object({ visitorId: z.string().trim().refine(validVisitorId).optional(),
  shopperId: z.string().trim().refine(isShopperId).optional(), cursor: z.string().min(1).max(EXPORT_CURSOR_BYTES).optional() }).strict().refine(s => !!(s.visitorId || s.shopperId));
async function exportRaw(kv: TenantKV, key: string): Promise<{ key: string; record: unknown } | null> {
  const value = await kv.get(key);
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Export unavailable');
  let record: unknown;
  try { record = JSON.parse(value); } catch { record = value; }
  return { key: tenantKey(kv.tenant, key), record };
}
const exportOwner = (record: unknown): string => String((record as { userId?: unknown } | null)?.userId);
/** The browser's current identity link at the tenant, validated as the documented read validates it. */
async function exportLink(env: Env, tenant: string, visitorId: string) {
  const raw = await identityRaw(env, tenant, 'identity:visitor:' + visitorId);
  const link = raw === null ? null : visitorLinkRead.parse(raw);
  if (link && link.visitorId !== visitorId) throw new Error('Identity unavailable');
  return link;
}
/**
 * A scan of the tenant's keys under `prefix`, in key order, from `from`. `visit`
 * answers false to stop BEFORE consuming the key it was given (the next call
 * visits it again). Answers where to resume, or `'done'` after the last key.
 */
async function scanKeys(kv: TenantKV, prefix: string, from: ScanPosition | null,
  visit: (id: string) => Promise<boolean>): Promise<ScanPosition | 'done'> {
  let page = from?.page ?? null, after = from?.after ?? null;
  for (;;) {
    const listed = await kv.list({ prefix, limit: 1000, ...(page ? { cursor: page } : {}) });
    if (!listed || !Array.isArray(listed.keys) || (listed.list_complete === false && (!listed.cursor || listed.cursor === page))) throw new Error('Export unavailable');
    for (const { name } of listed.keys) {
      if (!name.startsWith(prefix) || (after !== null && name <= after)) continue;
      const id = name.slice(prefix.length);
      if (identityId.safeParse(id).success && !await visit(id)) return { page, after };
      after = name;
    }
    if (listed.list_complete !== false) return 'done';
    page = listed.cursor!;
  }
}
identityRoutes.post('/:tenant/identity/export', operatorJwt(), async (c) => {
  const tenant = tenantOf(c);
  if (!tenant) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'visitorId or shopperId required and must be a valid id' }, 400);
  const { visitorId, shopperId: selected } = parsed.data;
  const first = parsed.data.cursor === undefined;
  const cursor: ExportCursor | null = first ? { v: 3, links: null, sessions: null, ledger: null } : decodeExportCursor(parsed.data.cursor!);
  if (!cursor || (cursor.ledger?.key != null && !cursor.ledger.key.startsWith(tenant + '/'))) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
  const selector = { ...(visitorId ? { visitorId } : {}), ...(selected ? { shopperId: selected } : {}) };
  return auditedSubjectOperation(c, tenant, 'identity_export', { kind: 'identity', ...selector }, async report => {
    const env = c.env;
    if (!env.SESSIONS || !env.CACHE || !env.SHOPPER_REFLEX || !env.DECISION_RING || !env.STORAGE) throw new Error('Export unavailable');
    // The subject the erasure reaches (src/identity/erase.ts discover, then discoverPage).
    const browser = visitorId && !isShopperId(visitorId) ? await exportLink(env, tenant, visitorId) : null;
    const resolved = visitorId && isShopperId(visitorId) ? visitorId : browser?.shopperId ?? null;
    if (selected && visitorId && resolved !== selected) {
      report.result({ outcome: 'read', found: false });
      return c.json({ ok: false, error: 'identity selectors disagree' }, 404);
    }
    const shopperId = selected ?? resolved;
    const personRaw = shopperId ? await identityRaw(env, tenant, 'identity:shopper:' + shopperId) : null;
    const person = personRaw === null ? null : shopperRead.parse(personRaw);
    if (person && person.shopperId !== shopperId) throw new Error('Identity unavailable');
    const listed = [...new Set([...(shopperId ? [shopperId] : []), ...(person?.visitors.map(v => v.visitorId) ?? []), ...(visitorId ? [visitorId] : [])])];
    const sessions = new TenantKV(env.SESSIONS as unknown as KVLike, tenant), cache = new TenantKV(env.CACHE as unknown as KVLike, tenant);

    // Hers: listed on her record or named by the selector, or a browser whose CURRENT link names her (the erasure's
    // condition). Decided by this call, never taken from the cursor; each link it reads is read once per call.
    const linksOf = new Map<string, Awaited<ReturnType<typeof exportLink>>>();
    if (browser) linksOf.set(browser.visitorId, browser);
    const linkOf = async (id: string) => { if (!linksOf.has(id)) linksOf.set(id, await exportLink(env, tenant, id)); return linksOf.get(id) ?? null; };
    const linkedToHer = async (id: string) => !!shopperId && !isShopperId(id) && (await linkOf(id))?.shopperId === shopperId;
    let ownerReads = 0;
    /** Whether a session's or a ledger row's owner is hers; null once this call may read no more links to decide it. */
    const owns = async (id: string): Promise<boolean | null> => {
      if (listed.includes(id)) return true;
      if (!shopperId || isShopperId(id) || !identityId.safeParse(id).success) return false;
      if (!linksOf.has(id)) { if (ownerReads >= EXPORT_OWNER_READS) return null; ownerReads++; }
      return linkedToHer(id);
    };

    const links: unknown[] = [], objects: Array<{ subject: string; affinity?: unknown; consent?: unknown; pipeline?: unknown }> = [];
    const sessionRecords = new Map<string, { key: string; record: unknown }>(), cached: Array<{ key: string; record: unknown }> = [];
    const decisions: Awaited<ReturnType<typeof subjectDecisionHistory>> = { receipts: {}, recent: {}, records: {} };
    const answered: string[] = [];
    /** Everything held per id, read and answered by this call. */
    const answer = async (ids: string[]) => {
      if (!ids.length) return;
      const sessionIds = new Set<string>();
      for (const id of ids) {
        if (!isShopperId(id)) {
          const link = await linkOf(id);
          if (link && link.shopperId !== shopperId) throw new Error('Identity unavailable');
          if (link) { links.push(link); if (link.ownSessionId) sessionIds.add(link.ownSessionId); }
        }
        const pointer = await sessions.get('user:' + id);
        if (pointer !== null) {
          if (typeof pointer !== 'string' || !identityId.safeParse(pointer).success) throw new Error('Identity unavailable');
          sessionIds.add(pointer);
        }
      }
      for (const id of ids) {
        const response = await shopperObject(env.SHOPPER_REFLEX, id, tenant).fetch('https://shopper-reflex/identity/operator-export', {
          headers: { 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': id } });
        const held = await response.json() as { ok?: unknown; affinity?: unknown; consent?: unknown; pipeline?: unknown };
        if (!response.ok || held.ok !== true) throw new Error('Export unavailable');
        if (held.affinity !== undefined || held.consent !== undefined || held.pipeline !== undefined) {
          objects.push({ subject: id, ...(held.affinity === undefined ? {} : { affinity: held.affinity }),
            ...(held.consent === undefined ? {} : { consent: held.consent }), ...(held.pipeline === undefined ? {} : { pipeline: held.pipeline }) });
        }
      }
      for (const sid of [...sessionIds].sort()) {
        const record = await exportRaw(sessions, 'session:' + sid);
        if (record && ids.includes(exportOwner(record.record))) sessionRecords.set(record.key, record);
      }
      for (const id of ids) {
        for (const key of ['profile:' + id, 'profile:user:' + id, 'profile:anon:' + id]) {
          const record = await exportRaw(cache, key);
          if (record) cached.push(record);
        }
        let page: string | undefined;
        const seen = new Set<string>();
        for (;;) {
          const overrides = await cache.list({ prefix: 'override:' + id + ':', limit: 1000, ...(page ? { cursor: page } : {}) });
          for (const { name } of overrides.keys) { const record = await exportRaw(cache, name); if (record) cached.push(record); }
          if (overrides.list_complete !== false || !overrides.cursor || seen.has(overrides.cursor)) break;
          seen.add(overrides.cursor); page = overrides.cursor;
        }
      }
      const history = await subjectDecisionHistory(c, tenant, ids);
      Object.assign(decisions.receipts, history.receipts); Object.assign(decisions.recent, history.recent); Object.assign(decisions.records, history.records);
      answered.push(...ids);
    };

    // The first call answers her person record and the ids her record lists or the selector names.
    if (first) await answer(listed);
    let keys = 0;
    // Then the next slice of the scan of the tenant's identity links: each browser whose current link names her is
    // answered by this call, the one that finds it.
    let linkScan = cursor.links;
    if (linkScan !== 'done') {
      if (shopperId) {
        const found: string[] = [];
        linkScan = await scanKeys(sessions, 'identity:visitor:', linkScan, async id => {
          if (keys >= EXPORT_SCAN_KEYS || answered.length + found.length >= EXPORT_ANSWER_IDS) return false;
          keys++;
          if (!listed.includes(id) && await linkedToHer(id)) found.push(id);
          return true;
        });
        await answer(found);
      } else linkScan = 'done';
    }
    // Then the next slice of the scan of every session record of the tenant, each owner decided by this call.
    let sessionScan = cursor.sessions;
    if (linkScan === 'done' && sessionScan !== 'done') {
      sessionScan = await scanKeys(sessions, 'session:', sessionScan, async sid => {
        if (keys >= EXPORT_SCAN_KEYS) return false;
        const record = await exportRaw(sessions, 'session:' + sid);
        const verdict = record ? await owns(exportOwner(record.record)) : false;
        if (verdict === null) return false;
        keys++;
        if (record && verdict) sessionRecords.set(record.key, record);
        return true;
      });
    }
    // Then the next slice of the ledger partition, each row's owner decided by this call.
    let ledger: Awaited<ReturnType<typeof subjectLedgerRows>> = { rows: { decision: [], outcome: [], 'product-sort': [], behavior: [] }, complete: false, next: cursor.ledger };
    if (linkScan === 'done' && sessionScan === 'done') ledger = await subjectLedgerRows(env, tenant, owns, cursor.ledger as LedgerScanPosition | null);
    const complete = linkScan === 'done' && sessionScan === 'done' && ledger.complete;
    const next = complete ? null : encodeExportCursor({ v: 3, links: linkScan, sessions: sessionScan, ledger: ledger.next });

    const held = links.length > 0 || (first && person !== null) || objects.length > 0 || sessionRecords.size > 0 || cached.length > 0
      || Object.values(decisions.recent).some(ring => ring.length > 0) || Object.values(ledger.rows).some(rows => rows.length > 0);
    // A continuation is answered whatever its slices held; only a first call that finds nothing and has nothing left to scan is a 404.
    report.result({ outcome: 'read', found: held || !complete || !first });
    if (!held && complete && first) return c.json({ ok: false, error: 'unknown shopper' }, 404);
    if (shopperId) await report.subject(shopperId);
    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true, tenant, subject: { shopperId, visitorIds: answered.filter(id => !isShopperId(id)) },
      identity: { links, shopper: first ? person : null },
      objects, sessions: [...sessionRecords.values()], cache: cached,
      decisions, ledger: ledger.rows, complete, next,
      limits: EXPORT_LIMITS,
    });
  });
});
