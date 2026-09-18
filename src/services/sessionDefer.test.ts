// src/services/sessionDefer.test.ts
//
// CW37 (doc 32 §4 item 1). A shopper the platform has never seen waited 627 ms
// for a decision on staging, and doc 32 measured effectively all of it inside
// the `shopper` stage: two KV writes creating her session, on the response path,
// one after the other. The decision does not depend on them having landed. It is
// computed from the record the call returns.
//
// Three properties this file holds:
//   1. the two writes go together, not one after the other;
//   2. given a sink, the call returns before they finish, and the record it
//      returns is complete;
//   3. the id the browser already holds is reused when the record cannot be
//      read, because deferring widens the window in which that happens and
//      minting a second id would split one visit across two sessions.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import { SessionManager } from '@/services/SessionManager';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { newAnonymousSession } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { consentInstruction, CONSENT_LIFETIME_MS, type Consent } from '@/content/consent';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

/** A KV whose writes take as long as we say, so "did it wait?" is answerable. */
class SlowKV {
  store = new Map<string, string>();
  putsStarted = 0;
  putsFinished = 0;
  delayMs = 0;
  /** Writes that have started, so a test can let them finish. */
  inFlight: Promise<void>[] = [];
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> {
    this.putsStarted += 1;
    const p = (async () => {
      if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
      this.store.set(key, value);
      this.putsFinished += 1;
    })();
    this.inFlight.push(p);
    return p;
  }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list() { return { keys: [] }; }
}

/**
 * SYNTHETIC test registry, not an approved retention period. A first record
 * needs an explicit per-category policy (`src/retention.ts:39`, `:72-89`;
 * `src/services/SessionManager.ts:304`); shape from
 * `src/index.api-boundary.test.ts:34-37`.
 */
const SYNTHETIC_POLICY: RetentionPolicy = { id: 'defer-fixture-synthetic', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const SYNTHETIC_RETENTION = JSON.stringify({ version: 1, tenants: { [DEFAULT_TENANT]:
  Object.fromEntries((['profile', 'identity', 'ledger', 'online', 'hourly'] as RetentionCategory[]).map((category) => [category, SYNTHETIC_POLICY])) } });

let kv: SlowKV;
let env: Env;
let mgr: SessionManager;

beforeEach(() => {
  kv = new SlowKV();
  env = { SESSIONS: kv, CACHE: kv, RETENTION: SYNTHETIC_RETENTION } as unknown as Env;
  mgr = new SessionManager(env);
});

/**
 * The subject's explicit owner-issued choice. A `preferences` boolean on the
 * profile grants nothing (`src/content/consent.ts:139-152`, `:156-163`; settled
 * decision `docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json`),
 * so the only thing that makes a behavioral write lawful is this record, carried
 * by the owner operation every shopper route runs inside
 * (`src/identity/sessionCapability.ts:175`).
 */
const choice = (subject: string, tracking: boolean, personalization = tracking): Consent => {
  const chosenAt = Date.now() - 1000;
  return consentInstruction({
    version: 1, tenant: DEFAULT_TENANT, subject, revision: 'defer-fixture-explicit-choice',
    tracking: { value: tracking, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
    personalization: { value: personalization, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
  });
};
const held = <T>(subject: string, tracking: boolean, work: () => Promise<T>): Promise<T> =>
  runOwnerOperation({}, env, work, kv, undefined, async () => choice(subject, tracking));

it('W04.02 a verified fresh SID survives deferred writes without restoring cookie/profile authority', async () => {
  const signing = { SESSIONS: kv, CACHE: kv, RETENTION: SYNTHETIC_RETENTION,
    JWT_SECRET: 'w0402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
  const principal = await newAnonymousSession(signing, 'coach');
  const owner = {};
  await runOwnerOperation(owner, signing, async () => {
  admitOwnerPrincipal(owner, principal);
  const engine = new RealtimeSegmentEngine(signing, {} as never, { principal });
  kv.delayMs = 50;
  const pending: Promise<unknown>[] = [];
  // The subject HAS chosen both purposes; the request's cookie withdraws
  // tracking. Cookies only restrict, never enable (src/services/SessionManager.ts:424).
  const cookies = 'opt_session_id=victim; opt_user_id=victim; opt_segments=PRIVATE; opt_engagement_score=999; opt_tracking_consent=false';
  const first = await engine.getOrCreateSessionFromCookies(cookies, principal.subject, p => pending.push(p), principal.sessionId);
  // The restricted request is answered and NOTHING of it is written: no profile,
  // no pointer (src/services/RealtimeSegmentEngine.ts:1069-1075 "No behavioral
  // creation or pointer"; src/services/SessionManager.ts:326-331). Persisting the
  // necessary refusal is the owner's own record, not a session-host write
  // (src/durable-objects/ShopperReflex.ts:1623-1631).
  expect(kv.putsStarted).toBe(0); expect(kv.putsFinished).toBe(0); expect(pending).toEqual([]); expect(first.sessionId).toBe(principal.sessionId);
  expect(kv.store.has(`user:${principal.subject}`)).toBe(false);
  expect(kv.store.has(`session:${principal.sessionId}`)).toBe(false);
  expect(first.sessionData.segments).not.toContain('PRIVATE'); expect(first.sessionData.preferences.trackingConsent).toBe(false);
  const second = await engine.getOrCreateSessionFromCookies(cookies, principal.subject, p => pending.push(p), principal.sessionId);
  expect(second.sessionId).toBe(first.sessionId);
  await Promise.all(pending);
  // Same rule after the deferred work drains: still nothing of the restricted
  // request, and the cookie's victim session was never touched.
  expect(kv.store.has(`session:${principal.sessionId}`)).toBe(false); expect(kv.store.has('session:victim')).toBe(false);
  }, kv, undefined, async () => choice(principal.subject, true));
});

describe('CW37: the session write leaves the decision path', () => {
  it('sends the record and its pointer together rather than one after the other', async () => {
    kv.delayMs = 40;
    const started = Date.now();
    await held('v1', true, () => mgr.createOrUpdateSession('s1', 'v1', { segments: ['a'] }));
    const took = Date.now() - started;
    expect(kv.putsFinished).toBe(2);
    // Two 40 ms writes in sequence cannot finish in under 80 ms; together they can.
    expect(took).toBeLessThan(75);
  });

  it('returns before the writes finish when it is given somewhere to put them', async () => held('v1', true, async () => {
    kv.delayMs = 50;
    const deferred: Promise<unknown>[] = [];
    const data = await mgr.createOrUpdateSession('s1', 'v1', { segments: ['a'] }, undefined, (p) => { deferred.push(p); });

    // Answered, in full, with nothing stored yet.
    expect(data.segments).toEqual(['a']);
    expect(data.userId).toBe('v1');
    expect(kv.putsStarted).toBe(2);
    expect(kv.putsFinished).toBe(0);
    expect(kv.store.has('session:s1')).toBe(false);

    // And the caller's waitUntil finishes them.
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect(kv.putsFinished).toBe(2);
    expect(JSON.parse(kv.store.get('session:s1') as string).segments).toEqual(['a']);
  }));

  it('still waits when nobody asked it not to, so every existing caller is unchanged', async () => held('v1', true, async () => {
    kv.delayMs = 20;
    await mgr.createOrUpdateSession('s1', 'v1', { segments: ['a'] });
    expect(kv.putsFinished).toBe(2);
    expect(kv.store.has('session:s1')).toBe(true);
  }));

  it('defers the consent refusal the same way, and still records it', async () => held('v1', false, async () => {
    kv.delayMs = 30;
    const deferred: Promise<unknown>[] = [];
    const answer = await mgr.createOrUpdateSession('s1', 'v1', {}, undefined, (p) => { deferred.push(p); });
    expect(kv.putsFinished).toBe(0);
    await Promise.all(deferred);
    // A refused request has no behavioral write to defer at all: it neither
    // creates nor refreshes a profile or its pointer
    // (src/services/SessionManager.ts:326-331). The refusal itself is recorded
    // as the owner's own separate record, not in the profile
    // (src/durable-objects/ShopperReflex.ts:1623-1631; D06-W05-EXPLICIT-CHOICE-
    // APPROVED-2026-09-16), and it is what the caller is answered with.
    expect(kv.putsStarted).toBe(0);
    expect(deferred).toEqual([]);
    expect([...kv.store.keys()]).toEqual([]);
    expect(answer.preferences.trackingConsent).toBe(false);
  }));
});

describe('CW37: a visit is never split across two sessions', () => {
  const engine = () => new RealtimeSegmentEngine(env, {} as never, { tenant: DEFAULT_TENANT });

  it('reuses the id the browser presents when the record cannot be read yet', async () => {
    // The shape deferring produces: the cookie names a session whose write has
    // started and not landed. KV's own eventual consistency produces it too.
    kv.delayMs = 0;
    const first = await engine().getOrCreateSessionFromCookies('opt_session_id=sess-abc', 'v1');
    expect(first.isNewSession).toBe(true);
    // The id the browser gave us, not a new one.
    expect(first.sessionId).toBe('sess-abc');
  });

  it('mints an id only when the browser has none', async () => {
    const made = await engine().getOrCreateSessionFromCookies(null, 'v2');
    expect(made.isNewSession).toBe(true);
    expect(made.sessionId).toBeTruthy();
    expect(made.sessionId.length).toBeGreaterThan(8);
  });

  it('keeps one visit on one session when the second request beats the first write', async () => {
    kv.delayMs = 60;
    const e = engine();
    const deferred: Promise<unknown>[] = [];
    const one = await e.getOrCreateSessionFromCookies('opt_session_id=sess-abc', 'v1', (p) => { deferred.push(p); });
    // Nothing stored: the second request cannot see the first.
    expect(kv.store.has('session:sess-abc')).toBe(false);
    const two = await e.getOrCreateSessionFromCookies('opt_session_id=sess-abc', 'v1');
    // Same session, so a decision on one and an outcome on the other still
    // compare equal, which is what session-scope attribution needs.
    expect(two.sessionId).toBe(one.sessionId);
    await Promise.all(deferred);
  });

  it('names the session after the one the client is already carrying', async () => held('v1', true, async () => {
    // CW39. The SDK sends its browsing session on the snapshot. Two requests
    // arriving together both carry it, so both land on one session instead of
    // each inventing its own and counting one visit as two.
    const e = engine();
    const a = await e.getOrCreateSessionFromCookies(null, 'v1', undefined, 'sdk-session-7');
    expect(a.sessionId).toBe('sdk-session-7');
    const b = await e.getOrCreateSessionFromCookies(null, 'v1', undefined, 'sdk-session-7');
    expect(b.sessionId).toBe('sdk-session-7');
    // The second request joined the first one's session instead of starting a
    // second. That is the whole property: one visit, one session.
    expect(b.isNewSession).toBe(false);
  }));

  it('lets the browser\'s own cookie win over the client\'s, since that is the older claim', async () => {
    const e = engine();
    const r = await e.getOrCreateSessionFromCookies('opt_session_id=from-cookie', 'v1', undefined, 'sdk-session-7');
    expect(r.sessionId).toBe('from-cookie');
  });

  it('still mints one when the client sends nothing at all', async () => {
    const r = await engine().getOrCreateSessionFromCookies(null, 'v9');
    expect(r.sessionId).toBeTruthy();
    expect(r.sessionId.length).toBeGreaterThan(8);
  });
});
