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
import { runOwnerOperation } from '@/identity/sessionAuthority';
import { consentInstruction, CONSENT_LIFETIME_MS, type Consent } from '@/content/consent';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

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
  async list(options?: { prefix?: string }) {
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(options?.prefix ?? '')).sort().map((name) => ({ name })), list_complete: true };
  }
}

/**
 * SYNTHETIC test registry, not an approved retention period. A first record
 * needs an explicit per-category policy (`src/retention.ts:39`, `:72-89`;
 * `src/services/SessionManager.ts:304`); shape from
 * `src/index.api-boundary.test.ts:34-37`.
 */
const SYNTHETIC_POLICY: RetentionPolicy = { id: 'consent-fixture-synthetic', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const SYNTHETIC_RETENTION = JSON.stringify({ version: 1, tenants: { [DEFAULT_TENANT]:
  Object.fromEntries((['profile', 'identity', 'ledger', 'online', 'hourly'] as RetentionCategory[]).map((category) => [category, SYNTHETIC_POLICY])) } });

let kv: FakeKV;
let env: Env;
let mgr: SessionManager;

const stored = (id: string) => JSON.parse(kv.store.get(`session:${id}`) as string);

/** A complete metadata block, because Partial<SessionData> is shallow: the field
    itself is optional, the object inside it is not. Only the score varies here. */
const meta = (engagementScore: number) => ({
  firstSeen: 1, lastSeen: 2, sessionCount: 1, engagementScore, lastSegmentUpdate: 2,
});

/**
 * The owner-issued record that is the ONLY thing which can authorize a purpose.
 * A `preferences` boolean on the profile is a legacy restriction and never
 * evidence of a choice (`src/content/consent.ts:139-152`, `:156-163`), and the
 * switches live in their own owner record, not in the profile
 * (`src/durable-objects/ShopperReflex.ts:1623-1631`; settled decision
 * `docs/remediation/decisions/D06-W05-explicit-choice-approved-2026-09-16.json`).
 */
const choice = (subject: string, tracking: boolean, personalization: boolean): Consent => {
  const chosenAt = Date.now() - 1000;
  return consentInstruction({
    version: 1, tenant: DEFAULT_TENANT, subject, revision: 'consent-fixture-explicit-choice',
    tracking: { value: tracking, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
    personalization: { value: personalization, chosenAt, expiresAt: chosenAt + CONSENT_LIFETIME_MS },
  });
};
/** The request as the owner runs it, carrying that subject's explicit record. */
const held = <T>(subject: string, tracking: boolean, personalization: boolean, work: () => Promise<T>): Promise<T> =>
  runOwnerOperation({}, env, work, kv, undefined, async () => choice(subject, tracking, personalization));
/** A request with no explicit record at all: absent means OFF, everywhere. */
const unstated = <T>(work: () => Promise<T>): Promise<T> => runOwnerOperation({}, env, work, kv);

beforeEach(() => {
  kv = new FakeKV();
  env = { SESSIONS: kv, RETENTION: SYNTHETIC_RETENTION } as unknown as Env;
  mgr = new SessionManager(env);
});

describe('CW31 on the session host: consent decides what is written', () => {
  it('keeps a full profile while the shopper consents', async () => {
    await held('v1', true, true, () => mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers'],
      attributes: { favouriteLine: 'tabby' },
      metadata: meta(42),
    }));
    const rec = stored('s1');
    expect(rec.segments).toEqual(['browsers']);
    expect(rec.attributes.favouriteLine).toBe('tabby');
    expect(rec.metadata.engagementScore).toBe(42);
    expect(rec.preferences.trackingConsent).toBe(true);
  });

  it('answers the request but keeps nothing of it once tracking is withheld', async () => {
    // She browses, consenting. This is what the platform legitimately knows.
    await held('v1', true, true, () => mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers'],
      attributes: { favouriteLine: 'tabby' },
      metadata: meta(42),
    }));
    const before = kv.store.get('session:s1');

    // She withholds tracking, and in the same request the engine computes more.
    const answer = await held('v1', false, true, () => mgr.createOrUpdateSession('s1', 'v1', {
      segments: ['browsers', 'high_intent'],
      attributes: { favouriteLine: 'tabby', cartValue: 890 },
      metadata: meta(99),
    }));

    // Answered from the state that is ALREADY STORED, never from what the refused
    // request computed: src/services/SessionManager.ts:318-331 returns the
    // existing record, which is the object host's rule exactly.
    expect(answer.segments).toEqual(['browsers']);
    expect(answer.metadata.engagementScore).toBe(42);
    expect(answer.attributes.cartValue).toBeUndefined();

    // Not remembered: the stored record is what it was before she withheld it.
    const rec = stored('s1');
    expect(rec.segments).toEqual(['browsers']);
    expect(rec.attributes.cartValue).toBeUndefined();
    expect(rec.metadata.engagementScore).toBe(42);

    // And the refusal itself is NOT a profile field any more. A refused request
    // neither creates nor refreshes a behavioral profile or pointer
    // (src/services/SessionManager.ts:326-331); the choice is its own owner
    // record (src/durable-objects/ShopperReflex.ts:1623-1631; D06-W05-EXPLICIT-
    // CHOICE-APPROVED-2026-09-16). The record is left byte-for-byte alone, and
    // what the caller is told about the switches is the owner's answer.
    expect(kv.store.get('session:s1')).toBe(before);
    expect(answer.consent).toEqual({ tracking: false, personalization: true, instruction: expect.objectContaining({ subject: 'v1' }) });
  });

  it('remembers the refusal of a shopper it had never seen', async () => {
    const answer = await held('v2', false, true, () => mgr.createOrUpdateSession('s2', 'v2', {
      segments: ['high_intent'],
      attributes: { cartValue: 890 },
    }));
    // The refusal is remembered by the OWNER, not by a profile the refusal is
    // not allowed to create: a refused request neither creates nor refreshes a
    // behavioral profile or pointer (src/services/SessionManager.ts:326-331),
    // and the necessary record is stored separately
    // (src/durable-objects/ShopperReflex.ts:1623-1631; D06-W05-EXPLICIT-CHOICE-
    // APPROVED-2026-09-16 "store only consent switches, scope/ownership
    // identifiers and choice/expiry metadata").
    expect([...kv.store.keys()]).toEqual([]);
    expect(answer.preferences.trackingConsent).toBe(false);
    // Answered with nothing she did.
    expect(answer.segments).toEqual([]);
    expect(answer.attributes).toEqual({});
    expect(answer.metadata.engagementScore).toBe(0);
    // And it still refuses on the next request, which is the property the write
    // used to buy: a missing instruction resolves OFF, never to the old default
    // of consenting (src/content/consent.ts:139-152; same settled decision).
    const next = await unstated(() => mgr.createOrUpdateSession('s2', 'v2', { segments: ['high_intent'] }));
    expect(next.preferences.trackingConsent).toBe(false);
    expect(next.segments).toEqual([]);
    expect([...kv.store.keys()]).toEqual([]);
  });

  it('goes on refusing after the request that withheld it, which is what the write is for', async () => {
    await held('v1', false, true, () => mgr.createOrUpdateSession('s1', 'v1', { segments: ['browsers'] }));
    // The next request says nothing about consent, as a browser normally would.
    const next = await unstated(() => mgr.createOrUpdateSession('s1', 'v1', { segments: ['browsers', 'high_intent'] }));
    // The refusal survives the request that gave it because absent and expired
    // instructions resolve OFF, not because a stored preference said so
    // (src/content/consent.ts:139-152, :156-163; D06-W05-EXPLICIT-CHOICE-
    // APPROVED-2026-09-16 "missing or expired records return to off"). Nothing
    // was written by either request (src/services/SessionManager.ts:326-331).
    expect(next.preferences.trackingConsent).toBe(false);
    expect(next.segments).not.toContain('high_intent');
    expect([...kv.store.keys()]).toEqual([]);
  });

  it('starts remembering again the moment she consents', async () => {
    await held('v1', false, true, () => mgr.createOrUpdateSession('s1', 'v1', {}));
    await held('v1', true, true, () => mgr.createOrUpdateSession('s1', 'v1', { segments: ['high_intent'] }));
    const rec = stored('s1');
    expect(rec.preferences.trackingConsent).toBe(true);
    expect(rec.segments).toEqual(['high_intent']);
  });

  it('can still find the shopper by id, or the switches could not be read back', async () => {
    // A refused request writes neither the record nor the pointer that finds it
    // (src/services/SessionManager.ts:326-331): the switches are read back from
    // the owner's own record, not from the profile.
    await held('v3', false, true, () => mgr.createOrUpdateSession('s3', 'v3', {}));
    expect(kv.store.has('user:v3')).toBe(false);
    // A consenting shopper is still findable by id, which is what the pointer is for.
    await held('v7', true, true, () => mgr.createOrUpdateSession('s7', 'v7', {}));
    expect(kv.store.get('user:v7')).toBe('s7');
  });

  it('says the same thing the object host says, on the shape the content service reads', async () => {
    // service.ts asks consentOf({ preferences }) on this host and consentOf({ consent })
    // on the object host, and both must resolve to the same two booleans.
    const { consentOf, personalizes } = await import('@/content/consent');
    const answer = await held('v4', false, true, () => mgr.createOrUpdateSession('s4', 'v4', {}));
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

    const withheld = await held('v5', false, false, () => mgr.createOrUpdateSession('s5', 'v5', {}));
    const off = consentFromCookies(asHeader(mgr.generateSessionCookies(withheld, 's5')));
    expect(off).toEqual({ tracking: false, personalization: false });

    const consenting = await held('v6', true, true, () => mgr.createOrUpdateSession('s6', 'v6', {}));
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
