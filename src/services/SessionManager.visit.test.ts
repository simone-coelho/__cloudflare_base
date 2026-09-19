// src/services/SessionManager.visit.test.ts
//
// The wiring, not the arithmetic. visit.test.ts proves the boundary rule; this
// proves the session record actually applies it, which is where the defect lived:
// sessionCount incremented inside createOrUpdateSession, which runs per event.
//
// It also covers the trap that would have made this deploy dangerous. getSession()
// runs the zod schema and turns a parse failure into null, so a REQUIRED new field
// would have silently wiped every live session. The new fields are optional, and
// the last block here is what proves a record written before them still loads.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import { SessionManager } from '@/services/SessionManager';
import { VISIT_GAP_MS } from '@/services/visit';
import { runOwnerOperation } from '@/identity/sessionAuthority';
import { consentInstruction, CONSENT_LIFETIME_MS, type Consent } from '@/content/consent';
import { retentionBirth, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { DEFAULT_TENANT } from '@/tenancy/tenant';

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
  async list(options?: { prefix?: string }) {
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(options?.prefix ?? '')).sort().map((name) => ({ name })), list_complete: true };
  }
}

const PAID_SOCIAL = {
  utmMedium: 'paid_social', utmSource: 'instagram',
  referrer: 'https://www.instagram.com/', siteHost: 'coach.com',
};

/**
 * SYNTHETIC test registry, not an approved retention period. An explicit
 * per-category policy is a precondition of a first record (`src/retention.ts:39`,
 * `:72-89`; `src/services/SessionManager.ts:304`); the shape is the one the
 * working fixtures use (`src/index.api-boundary.test.ts:34-37`).
 */
const SYNTHETIC_POLICY: RetentionPolicy = { id: 'visit-fixture-synthetic', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const SYNTHETIC_RETENTION = JSON.stringify({ version: 1, tenants: { [DEFAULT_TENANT]:
  Object.fromEntries((['profile', 'identity', 'ledger', 'online', 'hourly'] as RetentionCategory[]).map((category) => [category, SYNTHETIC_POLICY])) } });

let kv: FakeKV;
let env: Env;
let mgr: SessionManager;
let consent: Consent;

/**
 * Push the stored record into the past, which is how a returning shopper is
 * simulated. Both timestamps move, because a real returning visitor's previous
 * visit began in the past as well as ending there -- and because these tests run
 * inside a single millisecond, so a lastVisitAt left at "now" is indistinguishable
 * from one that was just rewritten.
 */
async function ageSession(sessionId: string, byMs: number) {
  const raw = JSON.parse(kv.store.get(`session:${sessionId}`) as string);
  raw.metadata.lastSeen -= byMs;
  if (typeof raw.metadata.lastVisitAt === 'number') raw.metadata.lastVisitAt -= byMs;
  kv.store.set(`session:${sessionId}`, JSON.stringify(raw));
}

beforeEach(() => {
  kv = new FakeKV();
  env = { SESSIONS: kv, RETENTION: SYNTHETIC_RETENTION } as unknown as Env;
  mgr = new SessionManager(env);
  const chosenAt = Date.now() - 1000;
  consent = consentInstruction({
    version: 1, tenant: DEFAULT_TENANT, subject: 'u1', revision: 'visit-fixture-explicit-choice',
    tracking: { value: true, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
    personalization: { value: true, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
  });
});

/**
 * Tracking and personalization are off until an explicit choice, and a stored
 * `preferences` boolean grants nothing (`src/content/consent.ts:139-152`,
 * `:156-163`; `src/services/SessionManager.ts:298-322`; settled decision
 * `docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json`).
 * The owner operation that carries u1's explicit stored record is therefore part
 * of the fixture for every write this suite measures, exactly as the mounted
 * hosts run it (`src/services/SessionManager.identity.test.ts:170-175`).
 */
const held = <T>(work: () => Promise<T>): Promise<T> =>
  runOwnerOperation({}, env, work, kv, undefined, async () => consent);

describe('the visit number the session records', () => {
  it('stays at 1 across a whole visit, however many events fire', async () => held(async () => {
    // The defect, stated as a test: twelve events used to read as visit 12.
    let s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    for (let i = 0; i < 11; i++) {
      s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    }
    expect(s.metadata.visitCount).toBe(1);
    // and sessionCount still counts interactions, which is all it ever did
    expect(s.metadata.sessionCount).toBe(12);
  }));

  it('advances to 2 when the shopper returns after the idle gap', async () => held(async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    await ageSession('s1', VISIT_GAP_MS + 1000);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(s.metadata.visitCount).toBe(2);
  }));

  it('advances once per return, not once per event after the gap', async () => held(async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    await ageSession('s1', VISIT_GAP_MS + 1000);
    let s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    for (let i = 0; i < 5; i++) s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(s.metadata.visitCount).toBe(2);
  }));

  it('moves lastVisitAt only on a boundary', async () => held(async () => {
    const first = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    const sameVisit = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(sameVisit.metadata.lastVisitAt).toBe(first.metadata.lastVisitAt);

    await ageSession('s1', VISIT_GAP_MS + 1000);
    const agedVisitAt = JSON.parse(kv.store.get('session:s1') as string).metadata.lastVisitAt as number;
    const returned = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(returned.metadata.lastVisitAt).toBeGreaterThan(agedVisitAt);
  }));

  it('measures the gap against the STORED lastSeen, not one the caller passed in', async () => held(async () => {
    // A caller that sets metadata.lastSeen = now would otherwise close the very
    // gap it is being measured against, and every event would open a new visit.
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {
      metadata: {
        firstSeen: 0, lastSeen: Date.now(), sessionCount: 0,
        engagementScore: 0, lastSegmentUpdate: 0,
      },
    }, PAID_SOCIAL);
    expect(s.metadata.visitCount).toBe(1);
  }));
});

describe('the channel the visit was entered on', () => {
  it('classifies from the tags on the first event of the visit', async () => held(async () => {
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(s.metadata.entryChannel).toBe('paid_social');
  }));

  it('does NOT relabel mid-visit when internal navigation reports a same-site referrer', async () => held(async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, {
      referrer: 'https://coach.com/collections', siteHost: 'coach.com',
    });
    expect(s.metadata.entryChannel).toBe('paid_social');
  }));

  it('re-classifies on the NEXT visit, because that is a new arrival', async () => held(async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    await ageSession('s1', VISIT_GAP_MS + 1000);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, {
      utmMedium: 'email', utmSource: 'klaviyo', siteHost: 'coach.com',
    });
    expect(s.metadata.visitCount).toBe(2);
    expect(s.metadata.entryChannel).toBe('email');
  }));

  it('keeps channel unknown when a client sends no entry signals at all', async () => held(async () => {
    // Every pre-existing client. It must not throw, and it must not guess.
    const s = await mgr.createOrUpdateSession('s1', 'u1', {});
    expect(s.metadata.entryChannel).toBeUndefined();
    expect(s.metadata.visitCount).toBe(1);
  }));
});

describe('records written before these fields existed', () => {
  it('still load, because getSession turns a parse failure into null', async () => {
    kv.store.set('session:legacy', JSON.stringify({
      userId: 'u1', segments: ['new_user'], attributes: {},
      metadata: { firstSeen: 1, lastSeen: 2, sessionCount: 47, engagementScore: 0, lastSegmentUpdate: 2 },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    }));
    const loaded = await mgr.getSession('legacy');
    expect(loaded).not.toBeNull();
    expect(loaded?.metadata.sessionCount).toBe(47);
    expect(loaded?.metadata.visitCount).toBeUndefined();
  });

  it('resolve to visit 1 rather than importing sessionCount, which is not a visit count', async () => held(async () => {
    kv.store.set('session:legacy', JSON.stringify({
      // An untagged stored profile is not a new record and cannot be enrolled
      // by a later write (`src/services/SessionManager.ts:303-307`), so the
      // pre-visitCount record carries the suite's synthetic profile stamp. Its
      // `trackingConsent: true` is exactly the legacy default-generated boolean
      // that grants nothing (`src/content/consent.ts:156-163`): the write below
      // happens because of u1's explicit owner record, not because of it.
      retention: retentionBirth(env, DEFAULT_TENANT, 'profile', Date.now(), Date.now()),
      userId: 'u1', segments: ['new_user'], attributes: {},
      metadata: { firstSeen: 1, lastSeen: Date.now(), sessionCount: 47, engagementScore: 0, lastSegmentUpdate: 2 },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    }));
    const s = await mgr.createOrUpdateSession('legacy', 'u1', {}, PAID_SOCIAL);
    // 47 interactions do not mean 47 visits. Under-counting once is honest;
    // seeding from sessionCount would import its wrongness permanently.
    expect(s.metadata.visitCount).toBe(1);
  }));

  it('survive an entryChannel value this build does not recognise', async () => {
    kv.store.set('session:legacy', JSON.stringify({
      userId: 'u1', segments: ['new_user'], attributes: {},
      metadata: {
        firstSeen: 1, lastSeen: 2, sessionCount: 3, engagementScore: 0, lastSegmentUpdate: 2,
        entryChannel: 'some_future_channel',
      },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    }));
    const loaded = await mgr.getSession('legacy');
    expect(loaded).not.toBeNull();
    expect(loaded?.metadata.entryChannel).toBeUndefined();
  });
});
