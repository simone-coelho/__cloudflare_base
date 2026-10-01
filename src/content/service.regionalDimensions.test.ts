// The dimensions the regional prior may blend (docs/verizon/lanes/F2.md finding 1).
//
// Every scored event fans its touches into the visitor's region on every
// dimension, and the blend measures each value against its dimension's leader,
// so in a dimension nobody seeded, one shopper's press reaches full share for
// the next stranger from the same region. `learn.regional.dimensions` names the
// dimensions the prior may blend; absent means every dimension, the shipped
// behaviour. Both branches are proved against the real service, beside the
// validator and the pure helper.

import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from '@/types/env';
import { invalidateCache } from '@/config/versionedStore';
import { initializePublicationSet } from '@/config/publication';
import type { DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateLearnConfig } from './kinds';
import { serveContentDecisions } from './service';
import { issueSessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { CONSENT_LIFETIME_MS, type Consent } from './consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { PRIORS_KIND } from '@/learn/priors';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
import { blendAffinity, invalidateTrendCache, sharesWithin, trendKey, REGION_GENERATION } from '@/reflex/regionTrend';

const TENANT = 'coach';
const VISITOR = 'vis-00000000-0000-4000-8000-0000000000f3';
const HOLDOUT = { share: 0, salt: '', arms: ['default'] };
const REGIONAL = { enabled: true, kBlend: 1, minEvents: 30 };
const REFUSAL = 'regional.dimensions: 1..32 distinct registry dimension names when present';

/**
 * New York's population: a seeded `category` lean, and a `line` value that one
 * live shopper's touches put at full share (its dimension's only value).
 */
const NY_SHARE = { category: { handbags: 0.6, wallets: 1 }, line: { signature: 1 } };

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

async function envFor(regional: Record<string, unknown>): Promise<Env> {
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
  cache.store.set(trendKey(TENANT, 'US-NY'), JSON.stringify({
    generation: REGION_GENERATION, tenant: TENANT, region: 'US-NY', level: 'region', events: 400, updatedAt: 1, version: 7, r: NY_SHARE, share: NY_SHARE,
  }));
  const now = Date.now();
  const consent = { tracking: true, personalization: true, instruction: { version: 1 as const, tenant: TENANT, subject: VISITOR, revision: 'fixture-choice',
    tracking: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
    personalization: { value: true, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } } };
  const env = {
    CACHE: cache, REFLEX_HOST: 'do', ENVIRONMENT: 'test', STORAGE: storage,
    JWT_SECRET: 'regional-dimensions-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    // A stranger: consenting, with no behaviour of her own, so the prior speaks alone (λ = 1).
    SHOPPER_REFLEX: fakeNs({ ok: true, affinity: null, journeyStage: 'mid', consent }),
    DECISION_RING: fakeNs({ ok: true }),
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery'].map(category => [category,
      { id: 'regional-dimensions-fixture-' + category, revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }])) } }),
  } as unknown as Env;
  fixtureConsent.set(env, consent);
  invalidateCache(); invalidateTrendCache();
  const piece = (id: string, tags: Record<string, string[]>) => ({ id, customerContentId: `cms-${id}`, type: 'promotion', title: id, tags, slotTypes: ['deals'], lifecycle: { status: 'live' as const } });
  const values = [
    // Catalog order puts the category piece first, so a line piece that leads did so on its score.
    [CONTENT_KIND, TENANT, { pieces: [piece('handbag-deal', { category: ['handbags'] }), piece('signature-deal', { line: ['signature'] })] }],
    [SLOTS_KIND, TENANT, { pages: { home: [{ slot: 'deals', take: 2, weights: { category: 0.5, line: 0.5 } }] } }],
    [LEARN_KIND, TENANT, { holdout: HOLDOUT, regional }],
    [REFLEX_KIND, reflexScopeForTenant(TENANT), DEFAULT_REFLEX_CONFIG],
    [PRIORS_KIND, TENANT, { rows: [] }], [PROPOSALS_KIND, TENANT, EMPTY_PROPOSALS],
  ] as Array<[DocumentKind<unknown>, string, unknown]>;
  expect((await initializePublicationSet(env, values.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, at: 1, actor: 'test', note: '', value } })), '0:' + crypto.randomUUID())).revision).toBe(1);
  return env;
}

/** One home snapshot from the edge region New York. */
async function serve(env: Env) {
  const principal = await issueSessionCapability(env, { tenant: TENANT, subject: VISITOR, sessionId: 's1', kind: 'anonymous',
    grantId: '10000000-0000-4000-8000-0000000000f3', authorityEpoch: '20000000-0000-4000-8000-0000000000f3' });
  const owner = {};
  return runOwnerOperation(owner, env, async () => {
    admitOwnerPrincipal(owner, principal);
    const result = await serveContentDecisions(env, { tenant: TENANT, page: 'home', visitorId: VISITOR, sessionId: 's1', channel: 'direct',
      cf: { country: 'US', regionCode: 'NY' }, cookieHeader: null, stateTenant: TENANT, principal, capability: principal.capability });
    await result.afterResponse;
    return result;
  }, undefined, undefined, async () => fixtureConsent.get(env)!);
}

type Served = Awaited<ReturnType<typeof serve>>;
const scoreOf = (out: Served, id: string) => out.decisions.find(d => d.contentId === id)!.score;
const regionalDriverOf = (out: Served, id: string) => out.decisions.find(d => d.contentId === id)!.explain.drivers.find(x => x.dim === 'regional');
const recordOf = (out: Served, id: string) => out.records.find(r => r.item_id === id)!;

afterEach(() => { invalidateCache(); invalidateTrendCache(); });

describe('learn.regional.dimensions: the validator', () => {
  it('absent, the block reads exactly as before: no dimensions key is added', () => {
    const out = validateLearnConfig({ holdout: HOLDOUT, regional: REGIONAL });
    expect(out.ok).toBe(true);
    expect(out.ok && out.value.regional).toEqual(REGIONAL);
    expect(out.ok && out.value.regional).not.toHaveProperty('dimensions');
  });

  it('accepts a list of distinct registry dimension names and carries it in order, on publish and on a retained read', () => {
    const dimensions = ['brand', 'ecosystem', 'priceBand', 'category'];
    for (const validate of [validateLearnConfig, LEARN_KIND.validateStored!]) {
      const out = validate({ holdout: HOLDOUT, regional: { ...REGIONAL, dimensions } });
      expect(out.ok).toBe(true);
      expect(out.ok && out.value.regional).toEqual({ ...REGIONAL, dimensions });
    }
  });

  it('refuses anything a registry could not define, naming the field', () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `dim${i}`);
    for (const dimensions of [[], 'brand', {}, null, [1], [''], [' brand'], ['brand', 'brand'], ['__proto__'], ['constructor'], ['prototype'], [null], tooMany]) {
      const out = validateLearnConfig({ holdout: HOLDOUT, regional: { ...REGIONAL, dimensions } });
      expect(out.ok, JSON.stringify(dimensions)).toBe(false);
      expect(!out.ok && out.errors).toContain(REFUSAL);
    }
    expect(validateLearnConfig({ holdout: HOLDOUT, regional: { ...REGIONAL, dimensions: tooMany.slice(0, 32) } }).ok).toBe(true);
  });
});

describe('sharesWithin: the blend sees only the dimensions it may', () => {
  it('absent keeps every dimension (the same object); a list keeps only its dimensions', () => {
    expect(sharesWithin(NY_SHARE, undefined)).toBe(NY_SHARE);
    expect(sharesWithin(NY_SHARE, null)).toBe(NY_SHARE);
    expect(sharesWithin(NY_SHARE, ['category', 'brand'])).toEqual({ category: NY_SHARE.category });
  });

  it('a dimension left out blends like one the region never saw: her own evidence at (1 − λ), nothing from the region', () => {
    const personal = { line: { signature: 0.5 }, category: { handbags: 0.5 } };
    const allowed = blendAffinity(personal, sharesWithin(NY_SHARE, ['category']), 0.5).dims;
    const unseen = blendAffinity(personal, { category: NY_SHARE.category }, 0.5).dims;
    expect(allowed).toEqual(unseen);
    expect(allowed.line).toEqual({ signature: 0.25 });
    expect(allowed.category).toEqual({ handbags: 0.55, wallets: 0.5 });
  });
});

describe('learn.regional.dimensions: the decision', () => {
  it('absent: every dimension blends, as shipped; one shopper\'s line touches lead a stranger\'s four', async () => {
    const out = await serve(await envFor(REGIONAL));
    expect(out.regional).toMatchObject({ region: 'US-NY', level: 'region', lambda: 1 });
    expect(out.decisions.map(d => d.contentId)).toEqual(['signature-deal', 'handbag-deal']);
    expect(scoreOf(out, 'signature-deal')).toBeCloseTo(0.5, 3);   // λ 1 × share 1 × weight 0.5
    expect(scoreOf(out, 'handbag-deal')).toBeCloseTo(0.3, 3);     // λ 1 × share 0.6 × weight 0.5
    expect(regionalDriverOf(out, 'signature-deal')).toMatchObject({ value: 'US-NY' });
    expect(recordOf(out, 'signature-deal').inputs!.regional_share).toEqual(NY_SHARE);
    expect(recordOf(out, 'signature-deal').inputs!.affinity).toHaveProperty('line');
  });

  it('listed: a dimension left out contributes nothing, on the score, the receipt and the replay inputs; a listed one still does', async () => {
    const out = await serve(await envFor({ ...REGIONAL, dimensions: ['category'] }));
    expect(out.regional).toMatchObject({ region: 'US-NY', level: 'region', lambda: 1 });
    expect(out.decisions.map(d => d.contentId)).toEqual(['handbag-deal', 'signature-deal']);
    expect(scoreOf(out, 'handbag-deal')).toBeCloseTo(0.3, 3);
    expect(scoreOf(out, 'signature-deal')).toBe(0);
    expect(regionalDriverOf(out, 'handbag-deal')).toMatchObject({ value: 'US-NY' });
    expect(regionalDriverOf(out, 'signature-deal')).toBeUndefined();
    expect(recordOf(out, 'handbag-deal').explain.regional).toMatchObject({ region: 'US-NY' });
    expect(recordOf(out, 'signature-deal').explain.regional).toBeUndefined();
    for (const record of out.records) {
      expect(record.inputs!.regional_share).toEqual({ category: NY_SHARE.category });
      expect(record.inputs!.affinity).not.toHaveProperty('line');
    }
  });
});
