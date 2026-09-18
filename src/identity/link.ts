// src/identity/link.ts
// ---------------------------------------------------------------------------
// The link itself: a browser becomes a person's, and the profile follows.
//
// The DO host delegates to a durable source-owned transfer: prepare/fence,
// idempotent target commit, compatibility publication, then source forwarding.
// The session host retains its existing, nontransactional sequence:
//
//   1. name the person: shopperIdFor(tenant, accountId)
//   2. record the link, and learn whether this browser is new to the person,
//      already theirs, or moving from someone else
//   3. new: fold the browser's profile into the person's, and leave the
//      browser's record forwarding there
//      moving: only repoint; what it learned went to the first person
//      already: nothing
//   4. tell the client the id to carry from now on
//
// WHAT A LINK IS NOT. It is not a login. The site knows who is signed in; this
// records that the site said so, with how much assurance, and merges profiles
// accordingly. And it is not reversible by design: a merged profile is one
// profile. "Log out" is a client act, detach (identity/detach) plus a fresh
// anonymous id, and the person's profile stays whole for their next sign-in.
// ---------------------------------------------------------------------------

import type { Env } from '@/types/env';
import { DEFAULT_TENANT, TenantKV, type TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { resolveTenantReflexConfig, resolveSurface } from '@/demos/registry';
import { SessionManager, type SessionData } from '@/services/SessionManager';
import type { ReflexChanges, ReflexConfig } from '@/reflex/core';
import { IdentityStore, type LinkSource } from '@/identity/store';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';
import type { Assurance } from '@/identity/assertion';
import { assertSessionTarget, SessionAccessError, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { consentOf, type Consent } from '@/content/consent';
import { mergeEnrichment } from '@/identity/profileEnrichment';

export type LinkOutcome = 'linked' | 'already' | 'relinked';

export interface LinkResult {
  shopperId: string;
  visitorId: string;
  outcome: LinkOutcome;
  assurance: Assurance;
  /** Session host only: the person's session id, for the cookie. */
  sessionId: string | null;
  /** What the merge did to the person's memberships. Empty when nothing merged. */
  changes: ReflexChanges;
  audiences: string[];
  cookieHeaders: string[];
  consent?: Consent;
  /** DO receipt-owned descriptor; retries must not mint a new grant. */
  grant?: SessionCapability;
}

/** A visitor id we will link: the client's own format, bounded, never a namespace. */
export function validVisitorId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(id);
}

export async function linkVisitor(
  env: Env,
  tenant: TenantId,
  input: {
    visitorId: string; accountId: string; source: LinkSource; assurance: Assurance; now?: number;
    /** The session id on the request's cookie, if any: where the browser's own record lives once its `user:` key points at a person. */
    cookieSessionId?: string | null;
    /** Public link ingress only; trusted history/import callers omit this. */
    principal?: SessionCapability;
    capability?: string;
    cookieHeader?: string | null;
  },
): Promise<LinkResult> {
  const now = input.now ?? Date.now();
  if (input.principal || (env.REFLEX_HOST ?? 'session') === 'do') {
    if (input.principal) {
      assertSessionTarget(input.principal, input.visitorId);
      if (input.principal.kind !== 'anonymous' || input.principal.tenant !== tenant) throw new SessionAccessError();
    }
    const shopperId = await shopperIdFor(env, tenant, input.accountId);
    await resolveTenantReflexConfig(env, tenant);
    const response = await shopperObject(env.SHOPPER_REFLEX, input.visitorId, tenant).fetch('https://shopper-reflex/identity/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(input.principal
        ? { [SHOPPER_HEADER]: input.capability ?? '', 'X-Tenant': tenant, ...(input.cookieHeader ? { Cookie: input.cookieHeader } : {}) }
        : { 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': input.visitorId }) },
      body: JSON.stringify({ shopperId, now, assurance: input.assurance, source: input.source, salted: isSalted(env) }),
    });
    const body = await response.json() as { ok?: unknown; result?: LinkResult };
    if (!response.ok || body.ok !== true || !body.result || body.result.shopperId !== shopperId
      || body.result.visitorId !== input.visitorId || typeof body.result.sessionId !== 'string' || !body.result.sessionId
      || !body.result.grant || body.result.grant.subject !== shopperId || body.result.grant.sessionId !== body.result.sessionId
      || body.result.grant.tenant !== tenant || body.result.grant.kind !== 'recognized') throw new SessionAccessError();
    return body.result;
  }
  const shopperId = await shopperIdFor(env, tenant, input.accountId);
  const store = new IdentityStore(env.SESSIONS as never, tenant);
  // Establish non-default configuration before publishing any identity link.
  const cfg = tenant === DEFAULT_TENANT ? undefined : await resolveTenantReflexConfig(env, tenant);

  // Enrichment can introduce deterministic merge conflicts/overflow. Detect
  // those BEFORE the existing nontransactional link write; the host repeats
  // the pure merge against its then-current state at the actual mutation.
  const kv = new TenantKV(env.SESSIONS as never, tenant);
  const rawLink = await kv.get(`identity:visitor:${input.visitorId}`);
  let priorShopper: string | undefined;
  if (rawLink !== null) {
    if (typeof rawLink !== 'string') throw new SessionAccessError();
    let link: { visitorId?: unknown; shopperId?: unknown } | null;
    try { link = JSON.parse(rawLink); } catch { throw new SessionAccessError(); }
    if (!link || link.visitorId !== input.visitorId || typeof link.shopperId !== 'string' || !isShopperId(link.shopperId)) throw new SessionAccessError();
    priorShopper = link.shopperId;
  }
  const repoint = priorShopper !== undefined && priorShopper !== shopperId;
  if ((env.REFLEX_HOST ?? 'session') !== 'do') {
    const sm = new SessionManager(env, { tenant });
    const exact = async (subject: string, sid?: string | null): Promise<SessionData | null> => {
      const pointer = sid ?? await kv.get(`user:${subject}`);
      if (pointer === null) return null;
      if (typeof pointer !== 'string' || !validVisitorId(pointer)) throw new SessionAccessError();
      return sm.readRaw(pointer, true);
    };
    const target = await exact(shopperId);
    if (target && (target.userId !== shopperId || target.identity?.shopperId !== shopperId || target.forwardTo !== undefined)) throw new SessionAccessError();
    const own = (data: SessionData | null): SessionData | null => data && !data.identity && data.userId === input.visitorId ? data : null;
    // Match the host's own(cookie) ?? own(visitor pointer) selection. A stale
    // or non-owned cookie is not the source; strict read failures still throw.
    const source = (input.cookieSessionId ? own(await exact(input.visitorId, input.cookieSessionId)) : null) ?? own(await exact(input.visitorId));
    if (!repoint && !(priorShopper === shopperId && target) && source?.userId === input.visitorId && source.forwardTo !== undefined) throw new SessionAccessError();
    mergeEnrichment(target?.profileEnrichment, !repoint && !(priorShopper === shopperId && target) ? source?.profileEnrichment : undefined);
  }

  const { outcome } = await store.link({
    visitorId: input.visitorId, shopperId, assurance: input.assurance, source: input.source,
    salted: isSalted(env), now,
  });

  const base: Omit<LinkResult, 'sessionId' | 'changes' | 'audiences' | 'cookieHeaders'> = {
    shopperId, visitorId: input.visitorId, outcome, assurance: input.assurance,
  };

  const r = await linkOnSessionHost(env, tenant, input.visitorId, shopperId, outcome, now, input.cookieSessionId ?? null, undefined, undefined, cfg);
  // CW28: the browser's own record now forwards to the person and nothing else
  // points at it; the link remembers it so an erasure can reach it.
  if (r.ownSessionId) await store.noteOwnSession(input.visitorId, r.ownSessionId);
  return { ...base, sessionId: r.sessionId, changes: r.changes, audiences: r.audiences, cookieHeaders: r.cookieHeaders, consent: r.consent };
}

// ── The session host ─────────────────────────────────────────────────────────

async function linkOnSessionHost(
  env: Env, tenant: TenantId, visitorId: string, shopperId: string, outcome: LinkOutcome, now: number,
  cookieSessionId: string | null,
  ownedSource?: { id: string; data: SessionData } | null,
  consent?: Consent,
  selectedConfig?: ReflexConfig,
): Promise<Pick<LinkResult, 'sessionId' | 'changes' | 'audiences' | 'cookieHeaders' | 'consent'> & { ownSessionId: string | null }> {
  const sm = new SessionManager(env, { tenant });
  const none: ReflexChanges = { entered: [], exited: [], explain: [] };

  // The browser's OWN record: the one named by this visitor id, carrying no
  // identity. After a first link the `user:` key points at the person, so the
  // cookie is tried first; a record that turns out to be a person's is not the
  // browser's and is left alone.
  const own = async (sid: string | null): Promise<{ id: string; data: SessionData } | null> => {
    if (!sid) return null;
    const data = await sm.readRaw(sid);
    return data && !data.identity && data.userId === visitorId ? { id: sid, data } : null;
  };
  const browser = ownedSource !== undefined ? ownedSource : (await own(cookieSessionId)) ?? (await own(await sm.resolveSessionIdByUserId(visitorId)));
  const fromSessionId = browser?.id ?? null;
  const fromRaw = browser?.data ?? null;
  const cfg = selectedConfig ?? await resolveTenantReflexConfig(env, tenant, resolveSurface({ surface: fromRaw?.surface }));

  if (outcome === 'already') {
    // Nothing to merge; still answer with the person's session so the cookie can follow.
    const sid = await sm.resolveSessionIdByUserId(shopperId);
    const data = sid ? await sm.readRaw(sid, consent !== undefined) : null;
    if (sid && data) {
      const resolved = consent ? await sm.restrictConsent(sid, consent) : consentOf(data);
      const next = { ...data, preferences: { ...data.preferences, trackingConsent: resolved.tracking, personalizationEnabled: resolved.personalization } };
      return { sessionId: sid, changes: none, audiences: data.reflex?.audiences ?? [], cookieHeaders: sm.createCookieHeaders(sm.generateSessionCookies(next, sid)), ownSessionId: fromSessionId, consent: resolved };
    }
    // The link exists but the person's session expired: make one from what the browser has.
  }

  const absorbed = await sm.absorbIntoShopper({
    shopperId, visitorId, from: fromRaw, fromSessionId, config: cfg, now,
    mode: outcome === 'relinked' ? 'repoint' : 'merge',
    consent,
  });
  return {
    sessionId: absorbed.sessionId,
    changes: absorbed.changes,
    audiences: absorbed.data.reflex?.audiences ?? [],
    cookieHeaders: sm.createCookieHeaders(sm.generateSessionCookies(absorbed.data, absorbed.sessionId)),
    ownSessionId: fromSessionId && fromSessionId !== absorbed.sessionId ? fromSessionId : null,
    consent: consentOf(absorbed.data),
  };
}
