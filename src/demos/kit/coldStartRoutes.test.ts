// src/demos/kit/coldStartRoutes.test.ts — the demo kit's cold-start sub-app,
// built for a second, fictional demo (an appliance maker on the tenant
// `kestrel`) and mounted beside Vantage's on one worker: absent where the
// worker does not provision kestrel, its own sentences on the read, a seed door
// that writes only for X-Tenant: kestrel over kestrel's own vocabulary, into
// kestrel's own region objects and marker, and a lean read from kestrel's own
// learn document, trend and marker, never Vantage's. Every refusal is checked to
// touch no region object. src/routes/vantageColdStart.test.ts stays the
// regression gate for the real demo; this file is the gate for the factory.
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { initializePublicationSet } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { LEARN_KIND } from '@/content/kinds';
import { invalidateTrendCache, objectName, trendKey, REGION_GENERATION } from '@/reflex/regionTrend';
import { VANTAGE_COLD_START } from '@/demos/vantage.config';
import { demoColdStartRoutes, type DemoColdStartConfig } from './coldStartRoutes';

const SECRET = 'k1-cold-start-kit-test-secret-long-enough';
const ISSUER = 'edge-platform', AUDIENCE = 'edge-platform-api';
const SEEDER = 'seed-kestrel-region';
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

/** A second demo, fictional, with a vocabulary that shares no dimension but `category` with Vantage's, and none of its values. */
const KESTREL: DemoColdStartConfig = {
  tenant: 'kestrel',
  vocabulary: { category: ['laundry', 'kitchen'], finish: ['steel', 'black-steel', 'white'] },
  sentence: 'aggregate only; the region, never the household.',
  markerKey: 'demo:kestrel:region-seed:v1',
  seedScript: 'scripts/seed-kestrel-region.mjs',
  scoredSentence: 'No census term enters any score. The lean is the maker\'s own sales, seeded here as synthetic data.',
};

type Touch = { binding: string; what: string };

/** A worker env with every binding the sub-app could reach, each recording what touched it. */
function envFor(o: { profile?: string; tenants?: string | null } = {}) {
  const touched: Touch[] = [];
  const frames: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const env = {
    DEPLOYMENT_PROFILE: o.profile ?? 'demo',
    ENVIRONMENT: 'development',
    AUTH_MODE: 'enforced',
    JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    ...(o.tenants === null ? {} : { TENANTS: o.tenants ?? JSON.stringify({ provisioned: ['kestrel', 'vantage'], operatorGrants: { [SEEDER]: ['kestrel', 'vantage'] } }) }),
    CACHE: {
      async get(key: string, type?: string) { touched.push({ binding: 'CACHE', what: `get ${key}` }); const v = kv.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : v; },
      async put(key: string, value: string) { touched.push({ binding: 'CACHE', what: `put ${key}` }); kv.set(key, value); },
      async list() { touched.push({ binding: 'CACHE', what: 'list' }); return { keys: [], list_complete: true }; },
    },
    DB: {
      prepare() { touched.push({ binding: 'DB', what: 'prepare' }); return { bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }; },
    },
    STORAGE: {
      async get() { touched.push({ binding: 'STORAGE', what: 'get' }); return null; },
      async list() { touched.push({ binding: 'STORAGE', what: 'list' }); return { objects: [], truncated: false }; },
      async put() { touched.push({ binding: 'STORAGE', what: 'put' }); return null; },
    },
    REGION_TREND: {
      idFromName: (name: string) => name,
      get: (id: string) => ({
        fetch: async (url: string, init?: RequestInit) => {
          const path = new URL(url).pathname;
          touched.push({ binding: 'REGION_TREND', what: `${id} ${path}` });
          if (path === '/ingest') frames.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        },
      }),
    },
  };
  return { env: env as unknown as Env, touched, frames, kv };
}

const kestrelRoutes = demoColdStartRoutes(KESTREL);
const vantageRoutes = demoColdStartRoutes(VANTAGE_COLD_START);
/** One worker serving both demos, as src/index.ts mounts a sub-app: the app-wide tenant middleware first. */
const app = new Hono<{ Bindings: Env }>().use('*', tenantMiddleware())
  .route('/kestrel/api/coldstart', kestrelRoutes)
  .route('/vantage/api/coldstart', vantageRoutes);

const operatorToken = (sub = SEEDER) => new SignJWT({ sub, roles: ['operator'], type: 'service' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('60s')
  .sign(new TextEncoder().encode(SECRET));

async function seed(env: Env, body: unknown, o: { tenant?: string; mount?: string } = {}) {
  return app.request(`https://demo.example/${o.mount ?? 'kestrel'}/api/coldstart/prior`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Tenant': o.tenant ?? 'kestrel', Authorization: `Bearer ${await operatorToken()}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env, ctx);
}

const VALID = { region: 'US-TX', label: 'Texas: synthetic sales', rows: [{ touches: { category: 'laundry', finish: 'steel' }, units: 2 }] };
const regionObjectCalls = (touched: Touch[]) => touched.filter((t) => t.binding === 'REGION_TREND');

describe('the cold-start sub-app for a second demo: absent where its tenant is not served', () => {
  // The sub-app on its own, so the gate is the first thing any request meets.
  const direct = (env: Env, method: 'GET' | 'POST', path: string) => kestrelRoutes.request(`https://demo.example${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Tenant': 'kestrel' }, ...(method === 'POST' ? { body: JSON.stringify(VALID) } : {}) }, env, ctx);

  it('answers 404 where the worker provisions vantage but not kestrel, touching nothing; vantage’s sub-app answers there (the control)', async () => {
    const { env, touched } = envFor({ tenants: JSON.stringify({ provisioned: ['vantage'] }) });
    for (const [method, path] of [['GET', '/'], ['GET', '/?region=US-TX'], ['POST', '/prior']] as const) {
      const res = await direct(env, method, path);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not Found' });
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(touched).toEqual([]);
    const vantage = await vantageRoutes.request('https://demo.example/?region=US-TX', { headers: { 'X-Tenant': 'vantage' } }, env, ctx);
    expect(vantage.status).toBe(200);
    expect(await vantage.json()).toMatchObject({ ok: true, tenant: 'vantage' });
  });

  it('answers 404 off the demo profile, and where TENANTS is absent or unreadable, touching nothing', async () => {
    for (const o of [{ profile: 'customer' }, { profile: '' }, { tenants: null }, { tenants: 'not json' }]) {
      const { env, touched } = envFor(o);
      for (const [method, path] of [['GET', '/'], ['POST', '/prior']] as const) expect((await direct(env, method, path)).status, JSON.stringify(o)).toBe(404);
      expect(touched).toEqual([]);
    }
  });
});

describe('its read: its own tenant and its own sentences', () => {
  it('answers for the asserted region with the demo’s own tenant, sentence and scored sentence', async () => {
    const { env } = envFor();
    const res = await app.request('https://demo.example/kestrel/api/coldstart?region=US-TX', { headers: { 'X-Tenant': 'kestrel' } }, env, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, tenant: 'kestrel', region: { key: 'US-TX', source: 'asserted' },
      scored: { census: false, sentence: KESTREL.scoredSentence }, sentence: KESTREL.sentence });
    const vantage = await app.request('https://demo.example/vantage/api/coldstart?region=US-TX', { headers: { 'X-Tenant': 'vantage' } }, env, ctx);
    expect(await vantage.json()).toMatchObject({ tenant: 'vantage', sentence: VANTAGE_COLD_START.sentence, scored: { sentence: VANTAGE_COLD_START.scoredSentence } });
  });
});

describe('its seed door: its own tenant, vocabulary, region objects and marker', () => {
  it('writes for X-Tenant: kestrel into kestrel’s region object, frames and marker (the control for every refusal below)', async () => {
    const { env, touched, frames, kv } = envFor();
    const res = await seed(env, VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tenant: 'kestrel', region: 'US-TX', label: 'Texas: synthetic sales', frames: 2,
      dataSource: 'synthetic', swapTo: 'warehouse' });
    expect(regionObjectCalls(touched).map((t) => t.what)).toEqual(['/reset', '/ingest', '/ingest', '/publish'].map((p) => `${objectName('kestrel', 'US-TX')} ${p}`));
    for (const f of frames) {
      expect(f).toMatchObject({ generation: REGION_GENERATION, tenant: 'kestrel', region: 'US-TX', w: 1 });
      expect(f.touches).toEqual([{ dim: 'category', value: 'laundry' }, { dim: 'finish', value: 'steel' }]);
    }
    expect(JSON.parse(kv.get(KESTREL.markerKey)!)).toMatchObject({ generator: 'scripts/seed-kestrel-region.mjs', dataSource: 'synthetic',
      swapTo: 'warehouse', regions: { 'US-TX': { units: 2, label: 'Texas: synthetic sales' } } });
    expect(kv.has(VANTAGE_COLD_START.markerKey)).toBe(false);
  });

  it('refuses X-Tenant: vantage on kestrel’s door, and X-Tenant: kestrel on vantage’s, even for an operator granted both', async () => {
    const { env, touched } = envFor();
    const wrong = await seed(env, VALID, { tenant: 'vantage' });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ ok: false, error: 'X-Tenant must be kestrel' });
    const crossed = await seed(env, { region: 'US-TX', rows: [{ touches: { brand: 'apple' }, units: 1 }] }, { mount: 'vantage', tenant: 'kestrel' });
    expect(crossed.status).toBe(403);
    expect(await crossed.json()).toEqual({ ok: false, error: 'X-Tenant must be vantage' });
    expect(regionObjectCalls(touched)).toEqual([]);
  });

  it('refuses Vantage’s dimensions and values, prototype names and anything outside its own lists, writing nothing', async () => {
    const { env, touched } = envFor();
    for (const dim of ['brand', 'ecosystem', 'priceBand', 'income', 'households', 'constructor', 'toString', '__proto__']) {
      const res = await seed(env, `{"region":"US-TX","rows":[{"touches":{"${dim}":"steel"},"units":1}]}`);
      expect(res.status, dim).toBe(400);
      expect(((await res.json()) as { error: string }).error, dim).toBe(`rows[0].touches.${dim}: not a seeded dimension (category, finish)`);
    }
    const values: Array<[Record<string, unknown>, string]> = [
      [{ category: 'phones' }, 'rows[0].touches.category: one of laundry, kitchen'],
      [{ finish: 'chrome' }, 'rows[0].touches.finish: one of steel, black-steel, white'],
      [{ finish: 'Steel' }, 'rows[0].touches.finish: one of steel, black-steel, white'],
      [{ finish: ['steel'] }, 'rows[0].touches.finish: one of steel, black-steel, white'],
    ];
    for (const [touches, error] of values) {
      const res = await seed(env, { region: 'US-TX', rows: [{ touches, units: 1 }] });
      expect(res.status, JSON.stringify(touches)).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error });
    }
    expect(regionObjectCalls(touched)).toEqual([]);
  });
});

describe('its lean: its own learn document, trend and marker, never Vantage’s', () => {
  /** An R2 stand-in that holds a real publication set, so the sub-app reads the tenant's own learn document. */
  const publicationStorage = () => {
    const objects = new Map<string, { text: string; etag: string }>();
    let version = 0;
    return {
      async list(options: { prefix: string }) { return { objects: [...objects.keys()].filter((key) => key.startsWith(options.prefix)).map((key) => ({ key })), truncated: false }; },
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
  };
  const snapshot = (tenant: string, share: Record<string, Record<string, number>>, events: number) => JSON.stringify({
    generation: REGION_GENERATION, tenant, region: 'US-TX', level: 'region', events, updatedAt: 1, version: 7, r: share, share });
  const marker = (units: number, label: string) => JSON.stringify({ generator: 'test', dataSource: 'synthetic', swapTo: 'warehouse',
    regions: { 'US-TX': { units, seededAt: 2, label } } });

  it('reads nothing of Vantage’s, then kestrel’s own trend with its own dimensions, labelled by its own marker', async () => {
    const { env, kv } = envFor();
    Object.assign(env, { STORAGE: publicationStorage() });
    invalidateCache(); invalidateTrendCache();
    const learn = { holdout: { share: 0, salt: '', arms: ['default'] }, regional: { enabled: true, kBlend: 0.4, minEvents: 30, dimensions: ['finish'] } };
    await initializePublicationSet(env, [{ kind: LEARN_KIND, scope: 'kestrel', revision: { revision: 1, at: 1, actor: 'test', note: '', value: learn } }], '0:' + crypto.randomUUID());
    // Vantage's region and marker on the same worker: never kestrel's lean.
    kv.set(trendKey('vantage', 'US-TX'), snapshot('vantage', { brand: { apple: 1 } }, 999));
    kv.set(VANTAGE_COLD_START.markerKey, marker(999, 'vantage'));
    type Lean = { level: string; answered: string; events: number; share: Record<string, unknown>; dataSource: string } | null;
    const read = async () => {
      invalidateTrendCache();
      const res = await app.request('https://demo.example/kestrel/api/coldstart?region=US-TX', { headers: { 'X-Tenant': 'kestrel' } }, env, ctx);
      expect(res.status).toBe(200);
      return res.json() as Promise<{ lean: Lean; prior: unknown }>;
    };

    const none = await read();
    expect(none.prior).toEqual({ enabled: true, kBlend: 0.4, minEvents: 30 });
    expect(none.lean).toBeNull();

    kv.set(trendKey('kestrel', 'US-TX'), snapshot('kestrel', { finish: { steel: 1, white: 0.3 }, category: { laundry: 1 } }, 400));
    const own = await read();
    expect(own.lean).toMatchObject({ inForce: true, level: 'region', answered: 'US-TX', events: 400, kBlend: 0.4,
      share: { finish: { steel: 1, white: 0.3 } }, leaders: { finish: 'steel' },
      dataSource: 'observed', label: 'observed on this demo worker only', seeded: null });
    expect(own.lean!.share).not.toHaveProperty('category');

    kv.set(KESTREL.markerKey, marker(120, 'Texas: synthetic sales'));
    const seeded = await read();
    expect(seeded.lean).toMatchObject({ dataSource: 'synthetic', label: 'synthetic → warehouse',
      seeded: { units: 120, at: 2, label: 'Texas: synthetic sales' }, liveEvents: 280 });
    invalidateCache(); invalidateTrendCache();
  });
});

describe('a misconfigured demo fails when its sub-app is built, never on a request', () => {
  const build = (patch: Record<string, unknown>) => () => demoColdStartRoutes({ ...KESTREL, ...patch } as never);

  it('builds Vantage’s config and the second demo’s (the control)', () => {
    expect(() => demoColdStartRoutes(VANTAGE_COLD_START)).not.toThrow();
    expect(build({})).not.toThrow();
  });

  it('refuses a tenant that is not a tenant id, an empty or malformed vocabulary, and a missing sentence, key or script', () => {
    for (const tenant of ['', 'Kestrel', 'kes:trel', 'k'.repeat(40), undefined]) expect(build({ tenant }), String(tenant)).toThrow(/is not a tenant id/);
    expect(build({ vocabulary: {} })).toThrow(/vocabulary must name at least one dimension/);
    expect(build({ vocabulary: ['finish'] })).toThrow(/vocabulary must name at least one dimension/);
    for (const values of [[], 'steel', ['steel', ''], [7]]) expect(build({ vocabulary: { finish: values } }), JSON.stringify(values)).toThrow(/vocabulary\.finish must list its values/);
    for (const what of ['sentence', 'markerKey', 'seedScript', 'scoredSentence']) expect(build({ [what]: '' }), what).toThrow(new RegExp(`${what} is required`));
  });

  it('is closed when built: widening the vocabulary afterwards widens nothing', async () => {
    const vocabulary: Record<string, string[]> = { category: ['laundry'], finish: ['steel'] };
    const routes = demoColdStartRoutes({ ...KESTREL, vocabulary });
    vocabulary.finish!.push('chrome');
    vocabulary.brand = ['apple'];
    const local = new Hono<{ Bindings: Env }>().use('*', tenantMiddleware()).route('/k', routes);
    const { env, touched } = envFor();
    for (const touches of [{ finish: 'chrome' }, { brand: 'apple' }]) {
      const res = await local.request('https://demo.example/k/prior', {
        method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': 'kestrel', Authorization: `Bearer ${await operatorToken()}` },
        body: JSON.stringify({ region: 'US-TX', rows: [{ touches, units: 1 }] }),
      }, env, ctx);
      expect(res.status, JSON.stringify(touches)).toBe(400);
    }
    expect(regionObjectCalls(touched)).toEqual([]);
  });
});
