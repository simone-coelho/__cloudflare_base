// src/identity/link.ts
// ---------------------------------------------------------------------------
// The link itself: a browser becomes a person's, and the profile follows.
//
// Whichever host holds the profile (the KV session today, the shopper object
// when REFLEX_HOST is 'do'), the steps are the same and in the same order:
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
// Step 3 is where the two hosts differ, and only there.
//
// WHAT A LINK IS NOT. It is not a login. The site knows who is signed in; this
// records that the site said so, with how much assurance, and merges profiles
// accordingly. And it is not reversible by design: a merged profile is one
// profile. "Log out" is a client act, detach (identity/detach) plus a fresh
// anonymous id, and the person's profile stays whole for their next sign-in.
// ---------------------------------------------------------------------------

import type { Env } from '@/types/env';
import type { TenantId } from '@/tenancy/tenant';
import { shopperObject, shopperObjectName } from '@/tenancy/objects';
import { resolveReflexConfig, resolveSurface } from '@/demos/registry';
import { SessionManager, type SessionData } from '@/services/SessionManager';
import type { ReflexChanges } from '@/reflex/core';
import { IdentityStore, type LinkSource } from '@/identity/store';
import { isSalted, isShopperId, shopperIdFor } from '@/identity/shopperId';
import type { Assurance } from '@/identity/assertion';

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
}

/** A visitor id we will link: the client's own format, bounded, never a namespace. */
export function validVisitorId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.\-]{1,200}$/.test(id);
}

export async function linkVisitor(
  env: Env,
  tenant: TenantId,
  input: {
    visitorId: string; accountId: string; source: LinkSource; assurance: Assurance; now?: number;
    /** The session id on the request's cookie, if any: where the browser's own record lives once its `user:` key points at a person. */
    cookieSessionId?: string | null;
  },
): Promise<LinkResult> {
  const now = input.now ?? Date.now();
  const shopperId = await shopperIdFor(env, tenant, input.accountId);
  const store = new IdentityStore(env.SESSIONS as never, tenant);

  const { outcome } = await store.link({
    visitorId: input.visitorId, shopperId, assurance: input.assurance, source: input.source,
    salted: isSalted(env), now,
  });

  const base: Omit<LinkResult, 'sessionId' | 'changes' | 'audiences' | 'cookieHeaders'> = {
    shopperId, visitorId: input.visitorId, outcome, assurance: input.assurance,
  };

  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    const r = await linkOnObjectHost(env, tenant, input.visitorId, shopperId, outcome, now);
    return { ...base, sessionId: null, cookieHeaders: [], ...r };
  }
  const r = await linkOnSessionHost(env, tenant, input.visitorId, shopperId, outcome, now, input.cookieSessionId ?? null);
  return { ...base, ...r };
}

// ── The session host ─────────────────────────────────────────────────────────

async function linkOnSessionHost(
  env: Env, tenant: TenantId, visitorId: string, shopperId: string, outcome: LinkOutcome, now: number,
  cookieSessionId: string | null,
): Promise<Pick<LinkResult, 'sessionId' | 'changes' | 'audiences' | 'cookieHeaders'>> {
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
  const browser = (await own(cookieSessionId)) ?? (await own(await sm.resolveSessionIdByUserId(visitorId)));
  const fromSessionId = browser?.id ?? null;
  const fromRaw = browser?.data ?? null;
  const cfg = await resolveReflexConfig(env, resolveSurface({ surface: fromRaw?.surface }));

  if (outcome === 'already') {
    // Nothing to merge; still answer with the person's session so the cookie can follow.
    const sid = await sm.resolveSessionIdByUserId(shopperId);
    const data = sid ? await sm.readRaw(sid) : null;
    if (sid && data) {
      return { sessionId: sid, changes: none, audiences: data.reflex?.audiences ?? [], cookieHeaders: sm.createCookieHeaders(sm.generateSessionCookies(data, sid)) };
    }
    // The link exists but the person's session expired: make one from what the browser has.
  }

  const absorbed = await sm.absorbIntoShopper({
    shopperId, visitorId, from: fromRaw, fromSessionId, config: cfg, now,
    mode: outcome === 'relinked' ? 'repoint' : 'merge',
  });
  return {
    sessionId: absorbed.sessionId,
    changes: absorbed.changes,
    audiences: absorbed.data.reflex?.audiences ?? [],
    cookieHeaders: sm.createCookieHeaders(sm.generateSessionCookies(absorbed.data, absorbed.sessionId)),
  };
}

// ── The object host ──────────────────────────────────────────────────────────

async function linkOnObjectHost(
  env: Env, tenant: TenantId, visitorId: string, shopperId: string, outcome: LinkOutcome, now: number,
): Promise<Pick<LinkResult, 'changes' | 'audiences'>> {
  const none: ReflexChanges = { entered: [], exited: [], explain: [] };
  const person = shopperObject(env.SHOPPER_REFLEX, shopperId, tenant);
  const browser = shopperObject(env.SHOPPER_REFLEX, visitorId, tenant);
  const personName = shopperObjectName(tenant, shopperId);

  if (outcome === 'already') {
    const snap = (await (await person.fetch('https://shopper-reflex/snapshot')).json()) as { affinity?: { audiences?: string[] } | null };
    return { changes: none, audiences: snap.affinity?.audiences ?? [] };
  }

  let audiences: string[] = [];
  let changes = none;
  if (outcome === 'linked') {
    const exported = (await (await browser.fetch('https://shopper-reflex/identity/export')).json()) as {
      affinity?: unknown; pipeline?: unknown; forwardTo?: string | null;
    };
    // A browser already forwarding elsewhere has nothing of its own to fold in.
    const payload = exported.forwardTo ? { shopperId, now } : { shopperId, now, affinity: exported.affinity ?? null, pipeline: exported.pipeline ?? null };
    const absorbed = (await (await person.fetch('https://shopper-reflex/identity/absorb', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })).json()) as { audiences?: string[]; changes?: ReflexChanges };
    audiences = absorbed.audiences ?? [];
    changes = absorbed.changes ?? none;
  } else {
    // relinked: make sure the person's object exists and carries the id, fold nothing.
    await person.fetch('https://shopper-reflex/identity/absorb', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopperId, now }),
    });
  }
  await browser.fetch('https://shopper-reflex/identity/forward', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: personName }),
  });
  return { changes, audiences };
}
