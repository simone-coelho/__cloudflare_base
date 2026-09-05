// src/services/sessionConsent.test.ts
//
// CW31 (BTIE D10) on the SESSION host, the half that matched the object host's.
//
// The rule, stated once: a shopper who withheld tracking consent is still
// answered, and nothing the request learned is kept or forwarded. The switches
// themselves ARE kept, because the instruction to stop has to survive the
// request that gave it -- otherwise the next request finds no stored preference,
// reads the default (consenting), and the engine starts writing again.
//
// ShopperReflex holds exactly this rule in-object (shopperReflex.consent.test.ts).
// A brand picks its host with REFLEX_HOST and consent is not a property of that
// choice, so the two hosts must not disagree about the same shopper. The last
// test here is the one that would fail if they drifted apart.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '@/types/env';
import { SessionManager } from '@/services/SessionManager';

class FakeKV {
  store = new Map<string, string>();
  writes: string[] = [];
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? JSON.parse(raw) : raw;
  }
  async put(key: string, value: string): Promise<void> { this.writes.push(key); this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

let kv: FakeKV;
let mgr: SessionManager;

const stored = (id: string) => JSON.parse(kv.store.get(`session:${id}`) as string);

/** A complete metadata block, because Partial<SessionData> is shallow: the field
    itself is optional, the object inside it is not. Only the score varies here. */
const meta = (engagementScore: number) => ({
  firstSeen: 1, lastSeen: 2, sessionCount: 1, engagementScore, lastSegmentUpdate: 2,
});

beforeEach(() => {
  kv = new FakeKV();
  mgr = new SessionManager({ SESSIONS: kv } as unknown as Env);
});

describe('CW31 on the session host: consent decides what is written', () => {
  it('keeps a full profile while the shopper consents', async () => {
    await mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers'],
      attributes: { favouriteLine: 'tabby' },
      metadata: meta(42),
    });
    const rec = stored('s1');
    expect(rec.segments).toEqual(['browsers']);
    expect(rec.attributes.favouriteLine).toBe('tabby');
    expect(rec.metadata.engagementScore).toBe(42);
    expect(rec.preferences.trackingConsent).toBe(true);
  });

  it('answers the request but keeps nothing of it once tracking is withheld', async () => {
    // She browses, consenting. This is what the platform legitimately knows.
    await mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers'],
      attributes: { favouriteLine: 'tabby' },
      metadata: meta(42),
    });

    // She withholds tracking, and in the same request the engine computes more.
    const answer = await mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers', 'high_intent'],
      attributes: { favouriteLine: 'tabby', cartValue: 890 },
      metadata: meta(99),
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    });

    // Answered: the caller gets what this request computed, so nothing breaks.
    expect(answer.segments).toContain('high_intent');
    expect(answer.metadata.engagementScore).toBe(99);

    // Not remembered: the stored record is what it was before she withheld it.
    const rec = stored('s1');
    expect(rec.segments).toEqual(['browsers']);
    expect(rec.attributes.cartValue).toBeUndefined();
    expect(rec.metadata.engagementScore).toBe(42);

    // Except the instruction itself, which is the whole point of the write.
    expect(rec.preferences.trackingConsent).toBe(false);
  });

  it('remembers the refusal of a shopper it had never seen', async () => {
    await mgr.createOrUpdateSession('s2', 'v2', {
      segments: ['high_intent'],
      attributes: { cartValue: 890 },
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    });
    const rec = stored('s2');
    expect(rec.preferences.trackingConsent).toBe(false);
    // A record holding the instruction and nothing she did.
    expect(rec.segments).toEqual([]);
    expect(rec.attributes).toEqual({});
    expect(rec.metadata.engagementScore).toBe(0);
  });

  it('goes on refusing after the request that withheld it, which is what the write is for', async () => {
    await mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers'],
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    });
    // The next request says nothing about consent, as a browser normally would.
    await mgr.createOrUpdateSession('s1', 'v1', { segments: ['browsers', 'high_intent'] });
    const rec = stored('s1');
    expect(rec.preferences.trackingConsent).toBe(false);
    expect(rec.segments).not.toContain('high_intent');
  });

  it('starts remembering again the moment she consents', async () => {
    await mgr.createOrUpdateSession('s1', 'v1', {
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    });
    await mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['high_intent'],
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    });
    const rec = stored('s1');
    expect(rec.preferences.trackingConsent).toBe(true);
    expect(rec.segments).toEqual(['high_intent']);
  });

  it('can still find the shopper by id, or the switches could not be read back', async () => {
    await mgr.createOrUpdateSession('s3', 'v3', {
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    });
    expect(kv.store.get('user:v3')).toBe('s3');
  });

  it('says the same thing the object host says, on the shape the content service reads', async () => {
    // service.ts asks consentOf({ preferences }) on this host and consentOf({ consent })
    // on the object host, and both must resolve to the same two booleans.
    const { consentOf, personalizes } = await import('@/content/consent');
    const answer = await mgr.createOrUpdateSession('s4', 'v4', {
      preferences: { trackingConsent: false, personalizationEnabled: true, cookieConsent: true },
    });
    const fromSession = consentOf({ preferences: answer.preferences });
    const fromObject = consentOf({ consent: { tracking: false, personalization: true } });
    expect(fromSession).toEqual(fromObject);
    // And tracking off is enough on its own to stop personalization.
    expect(personalizes(fromSession)).toBe(false);
  });

  // ── The seam the ODP gate stands on ────────────────────────────────────────
  // POST /realtime/action decides whether to forward to ODP from the request's
  // COOKIES, because on the session host that is what it knows before it has
  // read the record. SessionManager is what writes those cookies. If either side
  // renamed one, the gate would read a missing cookie, fall back to the default
  // of consenting, and forward a withheld shopper's event to ODP without a
  // single test going red. This is that seam, proven in both directions.
  it('writes consent cookies the route reads back as the same two switches', async () => {
    const { consentFromCookies } = await import('@/content/consent');
    const asHeader = (cookies: Array<{ name: string; value: string }>) =>
      cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const withheld = await mgr.createOrUpdateSession('s5', 'v5', {
      preferences: { trackingConsent: false, personalizationEnabled: false, cookieConsent: true },
    });
    const off = consentFromCookies(asHeader(mgr.generateSessionCookies(withheld, 's5')));
    expect(off).toEqual({ tracking: false, personalization: false });

    const consenting = await mgr.createOrUpdateSession('s6', 'v6', {
      preferences: { trackingConsent: true, personalizationEnabled: true, cookieConsent: true },
    });
    const on = consentFromCookies(asHeader(mgr.generateSessionCookies(consenting, 's6')));
    expect(on).toEqual({ tracking: true, personalization: true });
  });

  it('reads a request that carries no consent cookie at all as consenting', async () => {
    // Every shopper browsing today sends no such cookie, and the engine must go
    // on working for them. Absent means consenting, everywhere.
    const { consentFromCookies } = await import('@/content/consent');
    expect(consentFromCookies('opt_session_id=s1; opt_user_id=v1')).toEqual({ tracking: true, personalization: true });
    expect(consentFromCookies(null)).toEqual({ tracking: true, personalization: true });
  });
});
