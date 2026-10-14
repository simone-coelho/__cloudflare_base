// The demo-only region override (docs/verizon/Vantage-Demo-Design.md §5).
//
// The engine's rule is that an asserted region gates eligibility and moves no
// affinity: the regional prior reads only the edge region. On the demo profile
// alone, the snapshot's asserted `ctx.region` also selects the prior, so one
// laptop can rehearse two regions, and every receipt the prior touched says the
// region was asserted. Both branches are proved here against the real service.

import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '@/types/env';
import { invalidateCache } from '@/config/versionedStore';
import { initializePublicationSet } from '@/config/publication';
import type { DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from './kinds';
import { demoAssertedRegion, serveContentDecisions } from './service';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { CONSENT_LIFETIME_MS, type Consent } from './consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { PRIORS_KIND } from '@/learn/priors';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
import { invalidateTrendCache, trendKey, REGION_GENERATION } from '@/reflex/regionTrend';

const TENANT = 'coach';
const VISITOR = 'vis-00000000-0000-4000-8000-0000000000d3';

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

/** A population snapshot as the region object publishes it: leader = 1 within each dimension. */
const snapshotFor = (region: string, share: Record<string, Record<string, number>>) => JSON.stringify({
  generation: REGION_GENERATION, tenant: TENANT, region, level: 'region', events: 400, updatedAt: 1, version: 7, r: share, share,
});

const fixtureConsent = new WeakMap<Env, Consent>();

async function envFor(profile: 'demo' | 'customer' | undefined): Promise<Env> {
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
  const cache = new FakeKV();
  // Two rehearsed regions with opposite leans, and nothing anywhere else.
  cache.store.set(trendKey(TENANT, 'US-TX'), snapshotFor('US-TX', { brand: { samsung: 1, apple: 0.2 } }));
  cache.store.set(trendKey(TENANT, 'US-NY'), snapshotFor('US-NY', { brand: { apple: 1, samsung: 0.2 } }));
  const now = Date.now();
  const consent = { tracking: true, personalization: true, instruction: { version: 1 as const, tenant: TENANT, subject: VISITOR, revision: 'fixture-choice',
    tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
    personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } } };
  const env = {
    CACHE: cache, REFLEX_HOST: 'do', ENVIRONMENT: 'test', STORAGE: storage,
    ...(profile ? { DEPLOYMENT_PROFILE: profile } : {}),
    JWT_SECRET: 'demo-region-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    // A stranger: consenting, with no behaviour of her own, so the prior speaks alone (λ = 1).
    SHOPPER_REFLEX: fakeNs({ ok: true, affinity: null, journeyStage: 'mid', consent }),
    DECISION_RING: fakeNs({ ok: true }),
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery'].map(category => [category,
      { id: 'demo-region-fixture-' + category, revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }])) } }),
  } as unknown as Env;
  fixtureConsent.set(env, consent);
  invalidateCache(); invalidateTrendCache();
  const piece = (id: string, brand: string) => ({ id, customerContentId: `cms-${id}`, type: 'promotion', title: id, tags: { brand: [brand] }, slotTypes: ['deals'], lifecycle: { status: 'live' as const } });
  const values = [
    [CONTENT_KIND, TENANT, { pieces: [piece('galaxy-deal', 'samsung'), piece('iphone-deal', 'apple')] }],
    [SLOTS_KIND, TENANT, { pages: { home: [{ slot: 'deals', take: 2, weights: { brand: 1 } }] } }],
    [LEARN_KIND, TENANT, { holdout: { share: 0, salt: '', arms: ['default'] }, regional: { enabled: true, kBlend: 1, minEvents: 30 } }],
    [REFLEX_KIND, reflexScopeForTenant(TENANT), DEFAULT_REFLEX_CONFIG],
    [PRIORS_KIND, TENANT, { rows: [] }], [PROPOSALS_KIND, TENANT, EMPTY_PROPOSALS],
  ] as Array<[DocumentKind<unknown>, string, unknown]>;
  expect((await initializePublicationSet(env, values.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, at: 1, actor: 'test', note: '', value } })), '0:' + crypto.randomUUID())).revision).toBe(1);
  return env;
}

/** One snapshot from the edge region New York, optionally asserting another region. */
async function serve(env: Env, context?: Record<string, string>, tracking = true) {
  const principal = await issueSessionCapability(env, { tenant: TENANT, subject: VISITOR, sessionId: 's1', kind: 'anonymous',
    grantId: '10000000-0000-4000-8000-000000000001', authorityEpoch: '20000000-0000-4000-8000-000000000001' });
  const owner = {};
  return runOwnerOperation(owner, env, async () => {
    admitOwnerPrincipal(owner, principal);
    const result = await serveContentDecisions(env, { tenant: TENANT, page: 'home', visitorId: VISITOR, sessionId: 's1', channel: 'direct',
      cf: { country: 'US', regionCode: 'NY' }, cookieHeader: tracking ? null : 'opt_tracking_consent=false', stateTenant: TENANT,
      principal, capability: principal.capability, ...(context ? { context } : {}) });
    await result.afterResponse;
    return result;
  }, undefined, undefined, async () => fixtureConsent.get(env)!);
}

afterEach(() => { invalidateCache(); invalidateTrendCache(); });

describe('Vantage L4: the demo-only region override', () => {
  it('parses only a region key, and only on the demo profile', () => {
    const demo = { DEPLOYMENT_PROFILE: 'demo' as const };
    expect(demoAssertedRegion(demo, ' us-tx ')).toBe('US-TX');
    expect(demoAssertedRegion(demo, 'US')).toBe('US');
    for (const bad of ['', 'moon', 'US-TEXAS', 'US_TX', 'trend:v2:x', '../US-NY']) expect(demoAssertedRegion(demo, bad)).toBeNull();
    expect(demoAssertedRegion(demo, undefined)).toBeNull();
    expect(demoAssertedRegion({ DEPLOYMENT_PROFILE: 'customer' }, 'US-TX')).toBeNull();
    expect(demoAssertedRegion({}, 'US-TX')).toBeNull();
  });

  it('on the demo profile an asserted ctx.region selects the regional prior, and the receipt names it asserted', async () => {
    const env = await envFor('demo');
    const out = await serve(env, { region: 'US-TX' });
    expect(out.regional).toMatchObject({ region: 'US-TX', level: 'region', lambda: 1, asserted: true });
    expect(out.records.map(r => r.item_id)).toEqual(['galaxy-deal', 'iphone-deal']);
    for (const record of out.records) expect(record.explain.regional).toMatchObject({ region: 'US-TX', asserted: true });
    expect(out.decisions[0]!.explain.drivers).toContainEqual(expect.objectContaining({ dim: 'regional', value: 'US-TX' }));
    // The same laptop, the other rehearsed region: only the assertion changed.
    const other = await serve(env, { region: 'us-ny' });
    expect(other.regional).toMatchObject({ region: 'US-NY', asserted: true });
    expect(other.records.map(r => r.item_id)).toEqual(['iphone-deal', 'galaxy-deal']);
  });

  it('on the demo profile, with nothing or a non-region asserted, the prior reads the edge and claims no assertion', async () => {
    const env = await envFor('demo');
    const contexts: Array<Record<string, string> | undefined> = [undefined, { region: 'moon' }, { weather: 'snow' }];
    for (const context of contexts) {
      const out = await serve(env, context);
      expect(out.regional).toMatchObject({ region: 'US-NY', level: 'region' });
      expect(out.regional).not.toHaveProperty('asserted');
      for (const record of out.records) expect(record.explain.regional).not.toHaveProperty('asserted');
      expect(out.records[0]!.item_id).toBe('iphone-deal');
    }
  });

  it('on every other profile an asserted region moves no affinity: the prior stays on the edge region', async () => {
    for (const profile of ['customer', undefined] as const) {
      const env = await envFor(profile);
      const out = await serve(env, { region: 'US-TX' });
      expect(out.regional).toMatchObject({ region: 'US-NY', level: 'region' });
      expect(out.regional).not.toHaveProperty('asserted');
      expect(out.records.map(r => r.item_id)).toEqual(['iphone-deal', 'galaxy-deal']);
      for (const record of out.records) {
        expect(record.explain.regional).toMatchObject({ region: 'US-NY' });
        expect(record.explain.regional).not.toHaveProperty('asserted');
      }
    }
  });

  it('a shopper who withholds tracking is located by nobody, asserted or not', async () => {
    const env = await envFor('demo');
    const out = await serve(env, { region: 'US-TX' }, false);
    expect(out.regional).toBeNull();
    for (const record of out.records) expect(record.explain.regional).toBeUndefined();
  });
});
