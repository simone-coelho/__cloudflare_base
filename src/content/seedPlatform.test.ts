// The `platform` seed (docs/verizon/Vantage-Demo-Design.md §4, §5).
//
// The visitor's OS family is the strongest free per-visitor prior: the request
// reports it, as `Sec-CH-UA-Platform` or in the user agent. The engine reads the
// family only (`ios` | `android`, nothing finer), a published seed rule maps it
// to canonical tags (the `ecosystem` dimension in the carrier demo), the receipt
// itemises it as a seed, and a rule may be dampened while the shopper's OWN
// evidence holds an interest (halved while intent is switch). Never a model,
// never a fingerprint: the OS family is read from the request; the fired seed
// (ios or android) is recorded on the receipt as a driver; nothing finer is read
// or kept.

import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '@/types/env';
import { platformOf, platformWordOf, PLATFORM_WORDS } from '@/services/platform';
import { validateSeedRules, CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from './kinds';
import { decideContent } from './decide';
import { serveContentDecisions } from './service';
import type { Cell, ContentPiece, SeedRule, SlotStrategy } from './types';
import { audienceKey, DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { initializePublicationSet } from '@/config/publication';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { CONSENT_LIFETIME_MS, type Consent } from './consent';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { PRIORS_KIND } from '@/learn/priors';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD_CHROME = 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_REDUCED = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

const headers = (h: Record<string, string>) => new Headers(h);

describe('platformOf: the OS family and nothing finer', () => {
  it('reads the client hint first and the user agent second', () => {
    expect(platformOf(headers({ 'Sec-CH-UA-Platform': '"Android"', 'User-Agent': ANDROID_CHROME_REDUCED }))).toBe('android');
    expect(platformOf(headers({ 'Sec-CH-UA-Platform': '"iOS"' }))).toBe('ios');
    expect(platformOf(headers({ 'User-Agent': IPHONE_SAFARI }))).toBe('ios');
    expect(platformOf(headers({ 'User-Agent': IPAD_CHROME }))).toBe('ios');
    expect(platformOf(headers({ 'User-Agent': ANDROID_CHROME_REDUCED }))).toBe('android');
  });
  it('a desktop is neither, and a positive answer from either source counts', () => {
    expect(platformOf(headers({ 'Sec-CH-UA-Platform': '"Windows"', 'User-Agent': DESKTOP_CHROME }))).toBeNull();
    expect(platformOf(headers({ 'User-Agent': MAC_SAFARI }))).toBeNull();
    expect(platformOf(headers({}))).toBeNull();
    expect(platformOf(headers({ 'Sec-CH-UA-Platform': '""', 'User-Agent': '' }))).toBeNull();
    // An emulated phone behind a desktop hint still reads as the phone.
    expect(platformOf(headers({ 'Sec-CH-UA-Platform': '"macOS"', 'User-Agent': IPHONE_SAFARI }))).toBe('ios');
  });
  it('the vocabulary is exactly two words', () => {
    expect(PLATFORM_WORDS).toEqual(['ios', 'android']);
    for (const word of ['iOS', 'Android', 'ipados', 'windows', 'ios 26', '']) expect(platformWordOf(word)).toBeNull();
  });
});

describe('validateSeedRules: platform rules and dampen', () => {
  const weights = { ecosystem: 1, brand: 0.8 };
  const rule = (extra: Record<string, unknown> = {}) => ({ signal: 'platform', value: 'ios', tags: [{ dimension: 'ecosystem', value: 'ios' }], weight: 0.5, ...extra });
  it('accepts a platform rule and keeps its dampen list', () => {
    const dampen = [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'ecosystem', value: 'android', factor: 0 }];
    const checked = validateSeedRules([rule({ dampen }), rule({ value: 'android', tags: [{ dimension: 'ecosystem', value: 'android' }] })], weights);
    expect(checked).toEqual({ ok: true, value: [
      { signal: 'platform', value: 'ios', tags: [{ dimension: 'ecosystem', value: 'ios' }], weight: 0.5, dampen },
      { signal: 'platform', value: 'android', tags: [{ dimension: 'ecosystem', value: 'android' }], weight: 0.5 },
    ] });
  });
  it('refuses a platform value outside the two families and a malformed dampen', () => {
    for (const value of ['iOS', 'iPhone 17', 'windows', 'macos']) expect(validateSeedRules([rule({ value })], weights).ok).toBe(false);
    const one = (d: unknown) => [d];
    for (const dampen of [one({ dimension: 'intent', value: 'switch', factor: 1.5 }), one({ dimension: 'intent', value: 'switch', factor: -0.1 }),
      one({ dimension: '', value: 'switch', factor: 0.5 }), one({ dimension: 'intent', factor: 0.5 }), 'half', [],
      { dimension: 'intent', value: 'switch', factor: 0.5 },
      [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'intent', value: 'switch', factor: 0.2 }],
      Array.from({ length: 5 }, (_, i) => ({ dimension: 'intent', value: `v${i}`, factor: 0.5 }))]) {
      expect(validateSeedRules([rule({ dampen })], weights).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The pure decision.
// ---------------------------------------------------------------------------

const T0 = Date.UTC(2026, 8, 30, 12);
const piece = (id: string, ecosystem: string): ContentPiece => ({ id, customerContentId: `cms-${id}`, type: 'promotion', title: id,
  tags: { ecosystem: [ecosystem] }, slotTypes: ['deals'], lifecycle: { status: 'live' } } as ContentPiece);
const PIECES = [piece('android-deal', 'android'), piece('ios-deal', 'ios')];
// Halved while intent is switch; and a family's seed yields once her own evidence holds the other one.
const PLATFORM_SEEDS: SeedRule[] = [
  { signal: 'platform', value: 'ios', tags: [{ dimension: 'ecosystem', value: 'ios' }], weight: 0.5,
    dampen: [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'ecosystem', value: 'android', factor: 0 }] },
  { signal: 'platform', value: 'android', tags: [{ dimension: 'ecosystem', value: 'android' }], weight: 0.5,
    dampen: [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'ecosystem', value: 'ios', factor: 0 }] },
];
const DEALS: SlotStrategy = { slot: 'deals', take: 2, weights: { ecosystem: 0.8 }, seeds: PLATFORM_SEEDS };
const CELL: Cell = { channel: 'direct', visit_bucket: '1', region: null, affinity: null, stage: 'unknown' };

function run(o: { platform?: 'ios' | 'android' | null; audiences?: string[]; arm?: 'personalized' | 'default' }) {
  return decideContent({
    tenant: 't', brand: 't', page: 'home', visitorId: 'v', sessionId: 's', identityAnchor: 'visitor', nowMs: T0,
    pieces: PIECES, slots: [DEALS], affinity: null, cell: CELL, arm: o.arm ?? 'personalized',
    versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'platform-fixture',
    ...(o.platform !== undefined ? { platform: o.platform } : {}),
    ...(o.audiences ? { audiences: o.audiences } : {}),
  });
}

describe('decideContent: the platform seed on the receipt', () => {
  it('an iPhone opens on the iOS piece, itemised as a platform seed', () => {
    const set = run({ platform: 'ios' });
    expect(set.decisions.map(d => [d.contentId, d.score])).toEqual([['ios-deal', 0.4], ['android-deal', 0]]);
    const ios = set.records.find(r => r.item_id === 'ios-deal')!;
    expect(ios.explain.contextual).toEqual({ applied: 0.4, drivers: [
      { signal: 'platform', value: 'ios', dimension: 'ecosystem', tag: 'ios', weight: 0.5, contribution: 0.4 }] });
    expect(set.records.find(r => r.item_id === 'android-deal')!.explain.contextual).toEqual({ applied: 0, drivers: [] });
  });
  it('an Android phone opens on the Android piece; a desktop fires nothing', () => {
    expect(run({ platform: 'android' }).decisions[0]!.contentId).toBe('android-deal');
    for (const platform of [null, undefined]) {
      const set = run({ platform });
      expect(set.decisions.map(d => [d.contentId, d.score])).toEqual([['android-deal', 0], ['ios-deal', 0]]);
      for (const record of set.records) expect(record.explain.contextual).toEqual({ applied: 0, drivers: [] });
    }
  });
  it('halves while her own evidence holds intent = switch, and the receipt says why', () => {
    const set = run({ platform: 'ios', audiences: [audienceKey('intent', 'switch')] });
    const ios = set.records.find(r => r.item_id === 'ios-deal')!;
    expect(ios.explain.contextual).toEqual({ applied: 0.2, drivers: [
      { signal: 'platform', value: 'ios', dimension: 'ecosystem', tag: 'ios', weight: 0.5, contribution: 0.2,
        dampened: [{ dimension: 'intent', value: 'switch', factor: 0.5 }] }] });
    // Another interest she holds does not dampen the rule.
    expect(run({ platform: 'ios', audiences: [audienceKey('intent', 'upgrade')] }).records.find(r => r.item_id === 'ios-deal')!.explain.contextual!.applied).toBe(0.4);
  });
  it('yields to her own contrary evidence: an iPhone owner who holds android is no longer seeded toward iOS', () => {
    const set = run({ platform: 'ios', audiences: [audienceKey('ecosystem', 'android'), audienceKey('intent', 'switch')] });
    expect(set.records.find(r => r.item_id === 'ios-deal')!.explain.contextual).toEqual({ applied: 0, drivers: [
      { signal: 'platform', value: 'ios', dimension: 'ecosystem', tag: 'ios', weight: 0.5, contribution: 0,
        dampened: [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'ecosystem', value: 'android', factor: 0 }] }] });
  });
  it('never on the holdout default arm', () => {
    const set = run({ platform: 'ios', arm: 'default' });
    for (const record of set.records) expect(record.explain.contextual).toBeUndefined();
    expect(set.decisions.every(d => d.score === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The service: tracking gates the platform like the arrival; her own
// memberships, not the region's, feed the dampen.
// ---------------------------------------------------------------------------

const TENANT = 'coach';
const VISITOR = 'vis-00000000-0000-4000-8000-0000000000e5';
class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string): Promise<unknown> {
    const raw = this.store.get(key);
    return raw === undefined ? null : type === 'stream' ? new Response(raw).body : JSON.parse(raw);
  }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}
const fakeNs = (reply: unknown) => ({
  idFromName: (n: string) => n,
  get: () => ({ fetch: async () => new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } }) }),
}) as unknown as DurableObjectNamespace;
const fixtureConsent = new WeakMap<Env, Consent>();

async function envWith(affinity: { dims: Record<string, Record<string, number>>; audiences: string[] } | null): Promise<Env> {
  const objects = new Map<string, { text: string; etag: string }>();
  let version = 0;
  const storage = {
    async list(options: { prefix: string }) { return { objects: [...objects.keys()].filter(key => key.startsWith(options.prefix)).map(key => ({ key })), truncated: false }; },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { key, etag: value.etag, size: new TextEncoder().encode(value.text).length,
        body: new Response(value.text).body, text: async () => value.text, json: async () => JSON.parse(value.text) as unknown } : null;
    },
    async put(key: string, text: string, options?: R2PutOptions) {
      const condition = options?.onlyIf;
      if (condition instanceof Headers ? objects.has(key) : condition && condition.etagMatches !== objects.get(key)?.etag) return null;
      const etag = 'fixture-' + (++version); objects.set(key, { text, etag });
      return { key, etag, size: new TextEncoder().encode(text).length };
    },
  };
  const now = Date.now();
  const consent = { tracking: true, personalization: true, instruction: { version: 1 as const, tenant: TENANT, subject: VISITOR, revision: 'fixture-choice',
    tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
    personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } } };
  const env = {
    CACHE: new FakeKV(), REFLEX_HOST: 'do', ENVIRONMENT: 'test', STORAGE: storage,
    JWT_SECRET: 'platform-seed-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    SHOPPER_REFLEX: fakeNs({ ok: true, affinity, journeyStage: 'mid', consent }),
    DECISION_RING: fakeNs({ ok: true }),
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery'].map(category => [category,
      { id: 'platform-seed-fixture-' + category, revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }])) } }),
  } as unknown as Env;
  fixtureConsent.set(env, consent);
  invalidateCache();
  const values = [
    [CONTENT_KIND, TENANT, { pieces: PIECES }],
    [SLOTS_KIND, TENANT, { pages: { home: [DEALS] } }],
    [LEARN_KIND, TENANT, { holdout: { share: 0, salt: '', arms: ['default'] } }],
    [REFLEX_KIND, reflexScopeForTenant(TENANT), DEFAULT_REFLEX_CONFIG],
    [PRIORS_KIND, TENANT, { rows: [] }], [PROPOSALS_KIND, TENANT, EMPTY_PROPOSALS],
  ] as Array<[DocumentKind<unknown>, string, unknown]>;
  expect((await initializePublicationSet(env, values.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, at: 1, actor: 'test', note: '', value } })), '0:' + crypto.randomUUID())).revision).toBe(1);
  return env;
}

async function serve(env: Env, platform: 'ios' | 'android' | null, tracking = true) {
  const principal = await issueSessionCapability(env, { tenant: TENANT, subject: VISITOR, sessionId: 's1', kind: 'anonymous',
    grantId: '10000000-0000-4000-8000-000000000001', authorityEpoch: '20000000-0000-4000-8000-000000000001' });
  const owner = {};
  return runOwnerOperation(owner, env, async () => {
    admitOwnerPrincipal(owner, principal);
    const result = await serveContentDecisions(env, { tenant: TENANT, page: 'home', visitorId: VISITOR, sessionId: 's1', channel: 'direct',
      cf: null, cookieHeader: tracking ? null : 'opt_tracking_consent=false', stateTenant: TENANT, principal, capability: principal.capability, platform });
    await result.afterResponse;
    return result;
  }, undefined, undefined, async () => fixtureConsent.get(env)!);
}

afterEach(() => { invalidateCache(); });

describe('serveContentDecisions: the platform reaches the seed under the arrival\'s own gate', () => {
  it('a consenting stranger on an iPhone is seeded; without tracking nobody reads her platform', async () => {
    const env = await envWith(null);
    const seeded = await serve(env, 'ios');
    expect(seeded.records.find(r => r.item_id === 'ios-deal')!.explain.contextual).toMatchObject({ applied: 0.4 });
    expect(seeded.decisions[0]!.contentId).toBe('ios-deal');
    const refused = await serve(env, 'ios', false);
    for (const record of refused.records) expect(record.explain.contextual).toBeUndefined();
  });
  it('her own intent = switch membership halves the platform seed', async () => {
    const env = await envWith({ dims: { intent: { switch: 0.7 } }, audiences: [audienceKey('intent', 'switch')] });
    const out = await serve(env, 'ios');
    expect(out.records.find(r => r.item_id === 'ios-deal')!.explain.contextual).toMatchObject({ applied: 0.2,
      drivers: [expect.objectContaining({ signal: 'platform', dampened: [{ dimension: 'intent', value: 'switch', factor: 0.5 }] })] });
  });
});
