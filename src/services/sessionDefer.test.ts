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

let kv: SlowKV;
let mgr: SessionManager;

beforeEach(() => {
  kv = new SlowKV();
  mgr = new SessionManager({ SESSIONS: kv } as unknown as Env);
});

it('W04.02 a verified fresh SID survives deferred writes without restoring cookie/profile authority', async () => {
  const env = { SESSIONS: kv, CACHE: kv, JWT_SECRET: 'w0402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } as unknown as Env;
  const principal = await newAnonymousSession(env, 'coach');
  const owner = {};
  await runOwnerOperation(owner, env, async () => {
  admitOwnerPrincipal(owner, principal);
  const engine = new RealtimeSegmentEngine(env, {} as never, { principal });
  kv.delayMs = 50;
  const pending: Promise<unknown>[] = [];
  const cookies = 'opt_session_id=victim; opt_user_id=victim; opt_segments=PRIVATE; opt_engagement_score=999; opt_tracking_consent=false';
  const first = await engine.getOrCreateSessionFromCookies(cookies, principal.subject, p => pending.push(p), principal.sessionId);
  // Current owned consent persists the necessary refusal before answering;
  // this is not a behavioral write that may be left behind the response.
  expect(kv.putsFinished).toBe(1); expect(pending).toEqual([]); expect(first.sessionId).toBe(principal.sessionId);
  expect(kv.store.has(`user:${principal.subject}`)).toBe(false);
  expect(JSON.parse(kv.store.get(`session:${principal.sessionId}`)!)).toMatchObject({ attributes: {}, segments: [] });
  expect(first.sessionData.segments).not.toContain('PRIVATE'); expect(first.sessionData.preferences.trackingConsent).toBe(false);
  const second = await engine.getOrCreateSessionFromCookies(cookies, principal.subject, p => pending.push(p), principal.sessionId);
  expect(second.sessionId).toBe(first.sessionId);
  await Promise.all(pending);
  expect(kv.store.has(`session:${principal.sessionId}`)).toBe(true); expect(kv.store.has('session:victim')).toBe(false);
  }, kv);
});

describe('CW37: the session write leaves the decision path', () => {
  it('sends the record and its pointer together rather than one after the other', async () => {
    kv.delayMs = 40;
    const started = Date.now();
    await mgr.createOrUpdateSession('s1', 'v1', { segments: ['a'] });
    const took = Date.now() - started;
    expect(kv.putsFinished).toBe(2);
    // Two 40 ms writes in sequence cannot finish in under 80 ms; together they can.
    expect(took).toBeLessThan(75);
  });

  it('returns before the writes finish when it is given somewhere to put them', async () => {
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
  });

  it('still waits when nobody asked it not to, so every existing caller is unchanged', async () => {
    kv.delayMs = 20;
    await mgr.createOrUpdateSession('s1', 'v1', { segments: ['a'] });
    expect(kv.putsFinished).toBe(2);
    expect(kv.store.has('session:s1')).toBe(true);
  });

  it('defers the consent refusal the same way, and still records it', async () => {
    kv.delayMs = 30;
    const deferred: Promise<unknown>[] = [];
    await mgr.createOrUpdateSession('s1', 'v1', {
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    }, undefined, (p) => { deferred.push(p); });
    expect(kv.putsFinished).toBe(0);
    await Promise.all(deferred);
    expect(JSON.parse(kv.store.get('session:s1') as string).preferences.trackingConsent).toBe(false);
  });
});

describe('CW37: a visit is never split across two sessions', () => {
  const engine = () => new RealtimeSegmentEngine(
    { SESSIONS: kv, CACHE: kv } as unknown as Env,
    {} as never,
    { tenant: 'coach' },
  );

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

  it('names the session after the one the client is already carrying', async () => {
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
  });

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
