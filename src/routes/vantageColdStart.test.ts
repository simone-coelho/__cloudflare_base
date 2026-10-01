// src/routes/vantageColdStart.test.ts — the Vantage cold-start route's gates
// (docs/verizon/Vantage-Demo-Design.md §5; R1 4f): absent off the demo profile
// or where the worker does not provision `vantage`; the seed door opens only in
// development, only for `X-Tenant: vantage`, and only for the closed vocabulary
// (category, brand, ecosystem, price band; never census, households, lines or
// intent). Every refusal is proved to touch no binding, and each gate has a
// positive control beside it so a refusal cannot come from a broken rig.
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { SEED_MARKER_KEY, SEED_VOCABULARY, vantageColdStartRoutes } from './vantageColdStart';

const SECRET = 'f1-cold-start-test-secret-long-enough-0000';
const ISSUER = 'edge-platform', AUDIENCE = 'edge-platform-api';
const SEEDER = 'seed-vantage-region';
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;

type Touch = { binding: string; what: string };

/** A worker env with every binding the route could reach, each recording what touched it. */
function envFor(o: { profile?: string; tenants?: string | null; environment?: string } = {}) {
  const touched: Touch[] = [];
  const frames: Array<Record<string, unknown>> = [];
  const kv = new Map<string, string>();
  const env = {
    DEPLOYMENT_PROFILE: o.profile ?? 'demo',
    ENVIRONMENT: o.environment ?? 'development',
    AUTH_MODE: 'enforced',
    JWT_SECRET: SECRET, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE,
    ...(o.tenants === null ? {} : { TENANTS: o.tenants ?? JSON.stringify({ provisioned: ['vantage', 'shn'], operatorGrants: { [SEEDER]: ['vantage', 'shn'] } }) }),
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

/** As src/index.ts mounts it: the app-wide tenant middleware first, then the sub-app. */
const app = new Hono<{ Bindings: Env }>().use('*', tenantMiddleware()).route('/vantage/api/coldstart', vantageColdStartRoutes);

const operatorToken = (sub = SEEDER) => new SignJWT({ sub, roles: ['operator'], type: 'service' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('60s')
  .sign(new TextEncoder().encode(SECRET));

async function seed(env: Env, body: unknown, o: { tenant?: string; token?: string | null } = {}) {
  const token = o.token === undefined ? await operatorToken() : o.token;
  return app.request('https://demo.example/vantage/api/coldstart/prior', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Tenant': o.tenant ?? 'vantage', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env, ctx);
}

const VALID = { region: 'US-TX', label: 'Texas: synthetic carrier sales', rows: [{ touches: { category: 'phones', brand: 'samsung', ecosystem: 'android', priceBand: 'core' }, units: 2 }] };

describe('the cold-start route: absent off the demo profile or where vantage is not provisioned', () => {
  // The sub-app on its own, so the gate is the first thing any request meets.
  const direct = (env: Env, method: 'GET' | 'POST', path: string) => vantageColdStartRoutes.request(`https://demo.example${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Tenant': 'vantage' }, ...(method === 'POST' ? { body: JSON.stringify(VALID) } : {}) }, env, ctx);

  it('answers 404 to the read and the seed door off the demo profile, touching nothing', async () => {
    for (const profile of ['customer', '', 'staging', 'Demo']) {
      const { env, touched } = envFor({ profile });
      for (const [method, path] of [['GET', '/'], ['GET', '/?region=US-TX'], ['POST', '/prior']] as const) {
        const res = await direct(env, method, path);
        expect(res.status, `${profile || '(none)'} ${method} ${path}`).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not Found' });
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
      expect(touched, profile).toEqual([]);
    }
  });

  it('answers 404 on the demo profile where TENANTS does not provision vantage, or cannot be read', async () => {
    const unprovisioned = [JSON.stringify({ provisioned: ['shn'] }), null, 'not json', JSON.stringify({ provisioned: [] })];
    for (const tenants of unprovisioned) {
      const { env, touched } = envFor({ tenants });
      for (const [method, path] of [['GET', '/'], ['POST', '/prior']] as const) {
        expect((await direct(env, method, path)).status, `${tenants} ${method} ${path}`).toBe(404);
      }
      expect(touched).toEqual([]);
    }
  });

  it('opens on the demo profile with vantage provisioned (the control): the read answers, the door asks for a token', async () => {
    const { env } = envFor();
    const read = await direct(env, 'GET', '/?region=US-TX');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ ok: true, tenant: 'vantage', region: { key: 'US-TX', source: 'asserted' },
      scored: { census: false }, sentence: 'aggregate, never the individual; we curate, never price.' });
    const door = await app.request('https://demo.example/vantage/api/coldstart/prior', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': 'vantage' }, body: JSON.stringify(VALID) }, env, ctx);
    expect(door.status).toBe(401);
  });
});

describe('the seed door', () => {
  it('writes in development, for vantage, with an operator grant (the control for every refusal below)', async () => {
    const { env, touched, frames, kv } = envFor();
    const res = await seed(env, VALID);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tenant: 'vantage', region: 'US-TX', frames: 2, dataSource: 'synthetic', swapTo: 'warehouse' });
    const object = touched.filter((t) => t.binding === 'REGION_TREND').map((t) => t.what.replace(/^\S+ /, ''));
    expect(object).toEqual(['/reset', '/ingest', '/ingest', '/publish']);
    // Each frame carries exactly the touches named, as one synthetic sale; nothing else rides along.
    for (const f of frames) {
      expect(f).toMatchObject({ tenant: 'vantage', region: 'US-TX', w: 1 });
      expect(f.touches).toEqual([{ dim: 'category', value: 'phones' }, { dim: 'brand', value: 'samsung' }, { dim: 'ecosystem', value: 'android' }, { dim: 'priceBand', value: 'core' }]);
    }
    expect(JSON.parse(kv.get(SEED_MARKER_KEY)!)).toMatchObject({ dataSource: 'synthetic', swapTo: 'warehouse', regions: { 'US-TX': { units: 2 } } });
  });

  it('is a development-environment operation only: anywhere else it refuses before touching the region object', async () => {
    for (const environment of ['production', 'staging', 'test', '']) {
      const { env, touched } = envFor({ environment });
      const res = await seed(env, VALID);
      expect(res.status, environment || '(none)').toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: 'seeding is a development-environment demo operation' });
      expect(touched.filter((t) => t.binding === 'REGION_TREND')).toEqual([]);
      expect(touched.filter((t) => t.what.startsWith('put'))).toEqual([]);
    }
  });

  it('writes only for X-Tenant: vantage, even for an operator granted another tenant', async () => {
    const { env, touched } = envFor();
    const res = await seed(env, VALID, { tenant: 'shn' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'X-Tenant must be vantage' });
    expect(touched.filter((t) => t.binding === 'REGION_TREND')).toEqual([]);
  });

  it('needs the operator token and a grant on vantage', async () => {
    const { env, touched } = envFor();
    expect((await seed(env, VALID, { token: null })).status).toBe(401);
    expect((await seed(env, VALID, { token: 'not-a-jwt' })).status).toBe(401);
    expect((await seed(env, VALID, { token: await operatorToken('someone-else') })).status).toBe(403);
    expect(touched.filter((t) => t.binding === 'REGION_TREND')).toEqual([]);
  });
});

describe('the seed door’s closed vocabulary', () => {
  const row = (touches: unknown, units: unknown = 1) => ({ region: 'US-TX', rows: [{ touches, units }] });

  it('names exactly four dimensions, none of them census, households, lines or intent', () => {
    expect(Object.keys(SEED_VOCABULARY).sort()).toEqual(['brand', 'category', 'ecosystem', 'priceBand']);
    expect(SEED_VOCABULARY.ecosystem).toEqual(['ios', 'android']);
    expect(SEED_VOCABULARY.priceBand).toEqual(['entry', 'core', 'premium']);
  });

  it('refuses any other dimension, including prototype names, and writes nothing', async () => {
    const { env, touched } = envFor();
    for (const dim of ['income', 'medianHouseholdIncome', 'households', 'lines', 'intent', 'zip', 'region', 'perk', 'constructor', 'toString', '__proto__']) {
      const res = await seed(env, `{"region":"US-TX","rows":[{"touches":{"${dim}":"phones"},"units":1}]}`);
      expect(res.status, dim).toBe(400);
      expect(((await res.json()) as { error: string }).error, dim).toMatch(/not a seeded dimension/);
    }
    expect(touched.filter((t) => t.binding === 'REGION_TREND')).toEqual([]);
  });

  it('refuses a value outside each dimension’s list, or one that is not a string', async () => {
    const { env, touched } = envFor();
    const bad: Array<Record<string, unknown>> = [{ brand: 'nokia' }, { brand: 'Samsung' }, { ecosystem: 'windows' }, { priceBand: 'luxury' },
      { category: 'credit' }, { category: 'financing' }, { brand: 1 }, { brand: ['samsung'] }, { ecosystem: null }];
    for (const touches of bad) expect((await seed(env, row(touches))).status, JSON.stringify(touches)).toBe(400);
    expect(touched.filter((t) => t.binding === 'REGION_TREND')).toEqual([]);
  });

  it('refuses a region that is not a US state, empty or oversized rows, and units out of bounds', async () => {
    const { env, touched } = envFor();
    const bodies: unknown[] = [
      { ...VALID, region: 'US' }, { ...VALID, region: 'CA-ON' }, { ...VALID, region: 'US-TX-1' }, { ...VALID, region: 'TX' }, { ...VALID, region: 7 },
      { region: 'US-TX', rows: [] }, { region: 'US-TX', rows: Array.from({ length: 65 }, () => VALID.rows[0]) },
      row({}), row([]), row('brand=samsung'),
      row({ brand: 'samsung' }, 0), row({ brand: 'samsung' }, 401), row({ brand: 'samsung' }, 1.5), row({ brand: 'samsung' }, '3'),
      { region: 'US-TX', rows: [{ touches: { brand: 'samsung' }, units: 400 }, { touches: { brand: 'apple' }, units: 400 }, { touches: { brand: 'google' }, units: 1 }] },
      [], 'not json',
    ];
    for (const body of bodies) expect((await seed(env, body)).status, JSON.stringify(body)).toBe(400);
    expect(touched.filter((t) => t.binding === 'REGION_TREND')).toEqual([]);
  });

  it('normalises the region key’s case, and keeps the label to plain words', async () => {
    const { env, kv } = envFor();
    const res = await seed(env, { ...VALID, region: ' us-ny ', label: 'New York <script>alert(1)</script> {rehearsal}' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ region: 'US-NY', label: 'New York scriptalert(1)script rehearsal' });
    expect(JSON.parse(kv.get(SEED_MARKER_KEY)!).regions['US-NY'].label).toBe('New York scriptalert(1)script rehearsal');
  });
});
