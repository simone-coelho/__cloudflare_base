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

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

const PAID_SOCIAL = {
  utmMedium: 'paid_social', utmSource: 'instagram',
  referrer: 'https://www.instagram.com/', siteHost: 'coach.com',
};

let kv: FakeKV;
let mgr: SessionManager;

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
  mgr = new SessionManager({ SESSIONS: kv } as unknown as Env);
});

describe('the visit number the session records', () => {
  it('stays at 1 across a whole visit, however many events fire', async () => {
    // The defect, stated as a test: twelve events used to read as visit 12.
    let s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    for (let i = 0; i < 11; i++) {
      s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    }
    expect(s.metadata.visitCount).toBe(1);
    // and sessionCount still counts interactions, which is all it ever did
    expect(s.metadata.sessionCount).toBe(12);
  });

  it('advances to 2 when the shopper returns after the idle gap', async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    await ageSession('s1', VISIT_GAP_MS + 1000);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(s.metadata.visitCount).toBe(2);
  });

  it('advances once per return, not once per event after the gap', async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    await ageSession('s1', VISIT_GAP_MS + 1000);
    let s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    for (let i = 0; i < 5; i++) s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(s.metadata.visitCount).toBe(2);
  });

  it('moves lastVisitAt only on a boundary', async () => {
    const first = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    const held = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(held.metadata.lastVisitAt).toBe(first.metadata.lastVisitAt);

    await ageSession('s1', VISIT_GAP_MS + 1000);
    const agedVisitAt = JSON.parse(kv.store.get('session:s1') as string).metadata.lastVisitAt as number;
    const returned = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(returned.metadata.lastVisitAt).toBeGreaterThan(agedVisitAt);
  });

  it('measures the gap against the STORED lastSeen, not one the caller passed in', async () => {
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
  });
});

describe('the channel the visit was entered on', () => {
  it('classifies from the tags on the first event of the visit', async () => {
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    expect(s.metadata.entryChannel).toBe('paid_social');
  });

  it('does NOT relabel mid-visit when internal navigation reports a same-site referrer', async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, {
      referrer: 'https://coach.com/collections', siteHost: 'coach.com',
    });
    expect(s.metadata.entryChannel).toBe('paid_social');
  });

  it('re-classifies on the NEXT visit, because that is a new arrival', async () => {
    await mgr.createOrUpdateSession('s1', 'u1', {}, PAID_SOCIAL);
    await ageSession('s1', VISIT_GAP_MS + 1000);
    const s = await mgr.createOrUpdateSession('s1', 'u1', {}, {
      utmMedium: 'email', utmSource: 'klaviyo', siteHost: 'coach.com',
    });
    expect(s.metadata.visitCount).toBe(2);
    expect(s.metadata.entryChannel).toBe('email');
  });

  it('resolves to direct when a client sends no entry signals at all', async () => {
    // Every pre-existing client. It must not throw, and it must not guess.
    const s = await mgr.createOrUpdateSession('s1', 'u1', {});
    expect(s.metadata.entryChannel).toBe('direct');
    expect(s.metadata.visitCount).toBe(1);
  });
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

  it('resolve to visit 1 rather than importing sessionCount, which is not a visit count', async () => {
    kv.store.set('session:legacy', JSON.stringify({
      userId: 'u1', segments: ['new_user'], attributes: {},
      metadata: { firstSeen: 1, lastSeen: Date.now(), sessionCount: 47, engagementScore: 0, lastSegmentUpdate: 2 },
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    }));
    const s = await mgr.createOrUpdateSession('legacy', 'u1', {}, PAID_SOCIAL);
    // 47 interactions do not mean 47 visits. Under-counting once is honest;
    // seeding from sessionCount would import its wrongness permanently.
    expect(s.metadata.visitCount).toBe(1);
  });

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
