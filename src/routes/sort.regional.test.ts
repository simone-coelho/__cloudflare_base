// src/routes/sort.regional.test.ts
//
// The regional prior on POST /sort, through the real mounted route and a real
// shopper object: a product grid leans with the request's region the way the
// homepage slots do, under the tenant's published `learn.regional.dimensions`
// allowlist and only then, labelled on the answer, itemised on every item, and
// still captured as a valid product-sort record.

import { beforeAll, describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { sortRoutes } from '@/routes/sort';
import realtimeRoutes from './realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { shopperObjectName } from '@/tenancy/objects';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { storedConsent } from '@/content/consent';
import { initializePublicationSet, invalidatePublicationCache } from '@/config/publication';
import type { DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { PRIORS_KIND } from '@/learn/priors';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from '@/reflex/core';
import { invalidateConfigCache, REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { invalidateTrendCache, REGION_GENERATION, trendKey } from '@/reflex/regionTrend';
import { isProductSortRecord, type ProductSortRecord } from '@/ledger/records';
import { DELIVERY_FIELD } from '@/ledger/delivery';

const TENANT = 'acme';
const REGISTRY: ReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'sort-regional-v1', dimensions: [{ key: 'type', source: 'type' }, { key: 'series', source: 'series' }] };
// The grid as the platform returns it: the QNED first, the OLED second.
const FEED = [{ id: 'q85', type: 'QNED', series: 'QNED85' }, { id: 'c5', type: 'OLED', series: 'C5' }];
// North Carolina's sales lean OLED; Texas's lean QNED. Both carry a series lean the allowlist never admits.
const NC = { type: { OLED: 1, QNED: 0.4 }, series: { QNED85: 1 } };
const TX = { type: { QNED: 1, OLED: 0.3 }, series: { C5: 1 } };
const REGIONAL = { enabled: true, kBlend: 1, minEvents: 30, dimensions: ['type'] };

class FakeKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) { const r = this.store.get(key); return r === undefined ? null : (type === 'json' ? JSON.parse(r) : r); }
  async put(key: string, value: string) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
  async list(o?: { prefix?: string }) { return { keys: [...this.store.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort().map(name => ({ name })), list_complete: true }; }
}
class FakeR2 {
  store = new Map<string, string>(); etags = new Map<string, string>(); sequence = 0;
  async get(key: string) {
    const body = this.store.get(key); return body === undefined ? null : { key, etag: this.etags.get(key), size: new TextEncoder().encode(body).length,
      body: new Response(body).body, text: async () => body, json: async () => JSON.parse(body) as unknown };
  }
  async head(key: string) { const value = await this.get(key); return value ? { key, etag: value.etag, size: value.size } : null; }
  async put(key: string, body: string, options?: R2PutOptions) {
    const condition = options?.onlyIf;
    if (condition instanceof Headers ? condition.get('If-None-Match') === '*' && this.store.has(key)
      : condition?.etagDoesNotMatch === '*' && this.store.has(key) || condition?.etagMatches !== undefined && condition.etagMatches !== this.etags.get(key)) return null;
    this.store.set(key, body); this.etags.set(key, 'r' + (++this.sequence));
    return { key, etag: this.etags.get(key), size: new TextEncoder().encode(body).length };
  }
  async list(options?: { prefix?: string }) {
    const keys = [...this.store.keys()].filter(k => k.startsWith(options?.prefix ?? '')).sort();
    return { objects: keys.map(key => ({ key, etag: this.etags.get(key), size: new TextEncoder().encode(this.store.get(key)!).length })), truncated: false };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) { this.store.delete(key); this.etags.delete(key); } }
}

type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
interface SortAnswer {
  ok: boolean; order: string[]; affinityWeight: number;
  items: Array<{ id: string; score: number; drivers: Array<{ dim: string; value: string; a: number; w: number; contribution: number }> }>;
  regional?: { region: string; level: string; lambda: number; version: number; events: number; dimensions: string[]; asserted?: true };
  persistence: { status: string };
}

async function fixture(o: { regional?: Record<string, unknown>; profile?: string } = {}) {
  invalidateConfigCache(); invalidatePublicationCache(); invalidateTrendCache();
  const r2 = new FakeR2(), pending: Promise<unknown>[] = [];
  const policy = { id: 'sort-regional-fixture', revision: 1, durationMs: 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const cache = new FakeKV(), sessions = new FakeKV();
  for (const [region, share] of [['US-NC', NC], ['US-TX', TX]] as const) {
    cache.store.set(trendKey(TENANT, region), JSON.stringify({ generation: REGION_GENERATION, tenant: TENANT, region, level: 'region', events: 400, updatedAt: 1, version: 9, r: share, share }));
  }
  const e = {
    CACHE: cache, SESSIONS: sessions, STORAGE: r2, REFLEX_HOST: 'session', ENVIRONMENT: 'test', CONNECTOR_MODE: 'mock', DEPLOYMENT_PROFILE: o.profile ?? 'demo',
    JWT_SECRET: 'sort-regional-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', LEDGER_RECOVERY_ENABLED: 'true', IDENTITY_SALT: 'sort-regional-fixture',
    TENANTS: JSON.stringify({ provisioned: [TENANT] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map(c => [c, policy])) } }),
    EVENT_QUEUE: { send: async () => undefined },
    PERSONALIZATION_WEBSOCKET: { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
  } as unknown as Env;
  const objects = new Map<string, { data: Map<string, unknown>; shopper: ShopperReflex }>();
  e.SHOPPER_REFLEX = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    let item = objects.get(name);
    if (!item) {
      const data = new Map<string, unknown>(); let alarm: number | null = null;
      const storage = {
        get: async (key: string | string[]) => structuredClone(Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key)),
        put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') data.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v)); },
        list: async (q?: { prefix?: string; startAfter?: string; limit?: number }) => structuredClone(new Map([...data].filter(([k]) => k.startsWith(q?.prefix ?? '') && (!q?.startAfter || k > q.startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, q?.limit))),
        delete: async (keys: string | string[]) => { for (const k of typeof keys === 'string' ? [keys] : keys) data.delete(k); }, deleteAll: async () => data.clear(),
        getAlarm: async () => alarm, setAlarm: async (value: number) => { alarm = value; }, deleteAlarm: async () => { alarm = null; },
        transaction: async (work: (tx: unknown) => Promise<unknown>) => { const saved = structuredClone(data); try { return await work(storage); } catch (error) { data.clear(); for (const [k, v] of saved) data.set(k, v); throw error; } },
      };
      const state = { id: name, storage, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
      item = { data, shopper: new ShopperReflex(state, e) }; objects.set(name, item);
    }
    return item.shopper.fetch(new Request(input, init));
  } }) } as unknown as DurableObjectNamespace;
  const values = [
    [CONTENT_KIND, TENANT, { pieces: [] }], [SLOTS_KIND, TENANT, { pages: {} }],
    [LEARN_KIND, TENANT, { holdout: { share: 0, salt: '', arms: ['default'] }, ...(o.regional ? { regional: o.regional } : {}) }],
    [REFLEX_KIND, reflexScopeForTenant(TENANT), REGISTRY], [PRIORS_KIND, TENANT, { rows: [] }], [PROPOSALS_KIND, TENANT, EMPTY_PROPOSALS],
  ] as Array<[DocumentKind<unknown>, string, unknown]>;
  await initializePublicationSet(e, values.map(([kind, scope, value]) => ({ kind, scope, revision: { revision: 1, at: 1, actor: 'test', note: '', value } })), '0:' + crypto.randomUUID());
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware()); app.route('/sort', sortRoutes); app.route('/realtime', realtimeRoutes);
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { return; }, props: {} } as unknown as ExecutionContext;
  /** One request from the edge location `cf`, which the owner forwarding carries to the shopper's object. */
  const request = (path: string, grant: Grant, body: unknown, cf: Record<string, string> | null = { country: 'US', regionCode: 'NC' }) => {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability }, body: JSON.stringify(body) };
    if (!cf) return app.request('https://sort.invalid' + path, init, e, ctx);
    const r = new Request('https://sort.invalid' + path, init);
    Object.defineProperty(r, 'cf', { value: cf });
    return app.request(r, undefined, e, ctx);
  };
  const choice = (grant: Grant, personalization = true) => request('/realtime/session/' + grant.sessionId + '/preferences', grant, { trackingConsent: true, personalizationEnabled: personalization,
    choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent')).instruction?.revision ?? null,
      grantId: grant.grantId, iat: grant.iat, exp: grant.exp } }, null);
  const choose = async (grant: Grant, personalization = true) => {
    const res = await choice(grant, personalization);
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  /** A consenting stranger: no behaviour of her own, so the region speaks alone (λ = 1). */
  const stranger = async (personalization = true) => { const g = await newAnonymousSession(e, TENANT); await choose(g, personalization); await drain(); return g; };
  const sort = async (g: Grant, extra: Record<string, unknown> = {}, cf?: Record<string, string>) => {
    const res = await request('/sort', g, { userId: g.subject, sessionId: g.sessionId, candidates: FEED, ...extra }, cf);
    const body = await res.json() as SortAnswer; await drain();
    expect(res.status, JSON.stringify(body)).toBe(200);
    return body;
  };
  const records = () => [...r2.store].filter(([k]) => k.includes('/product-sort/')).flatMap(([, text]) => text.trim().split('\n').map(line => {
    const raw = JSON.parse(line) as Record<string, unknown>; delete raw[DELIVERY_FIELD]; return raw as unknown as ProductSortRecord;
  }));
  return { env: e, stranger, sort, records, choice };
}

describe('POST /sort with the regional prior', () => {
  // The first consent choice a test process sends answers 500 ("unusable", a
  // locked body at `src/routes/realtime.ts:54`), whatever the suite: the existing
  // `src/routes/sort.test.ts` W14.07 case fails the same way when it runs alone.
  // One throwaway choice warms that path, so the cases below assert only their own.
  beforeAll(async () => {
    const warm = await fixture({ regional: REGIONAL });
    await warm.choice(await newAnonymousSession(warm.env, TENANT));
  });
  it('leans with the request’s region where the tenant publishes the allowlist, labelled and itemised like the homepage', async () => {
    const f = await fixture({ regional: REGIONAL });
    const answer = await f.sort(await f.stranger());
    expect(answer.order).toEqual(['c5', 'q85']);
    expect(answer.regional).toEqual({ region: 'US-NC', level: 'region', lambda: 1, version: 9, events: 400, dimensions: ['type'] });
    const [oled, qned] = answer.items;
    // The touch carries the blended affinity, as a decision's tag driver does, and the regional
    // driver says how much of it was the region's: λ × share × the dimension weight.
    expect(oled!.drivers).toEqual([{ dim: 'type', value: 'OLED', a: 1, w: 1, contribution: 1 }, { dim: 'regional', value: 'US-NC', a: 1, w: 1, contribution: 1 }]);
    expect(qned!.drivers).toEqual([{ dim: 'type', value: 'QNED', a: 0.4, w: 1, contribution: 0.4 }, { dim: 'regional', value: 'US-NC', a: 1, w: 0.4, contribution: 0.4 }]);
    // The series lean is outside the allowlist, so it moved nothing: the QNED85 lean never reached the grid.
    expect(answer.items.flatMap(i => i.drivers).some(d => d.dim === 'series')).toBe(false);
    expect(oled!.score).toBe(1); expect(qned!.score).toBe(0.4);
    // Still captured, and the record its strict schema admits carries the same itemisation.
    expect(['durable', 'queued']).toContain(answer.persistence.status);
    const record = f.records().at(-1)!;
    expect(isProductSortRecord(record)).toBe(true);
    expect(record.items.map(i => i.drivers)).toEqual(answer.items.map(i => i.drivers));
  });

  it('a different region, a different lean: the edge decides, and an asserted region selects the prior only on the demo profile, labelled asserted', async () => {
    const demo = await fixture({ regional: REGIONAL });
    const texas = await demo.sort(await demo.stranger(), {}, { country: 'US', regionCode: 'TX' });
    expect(texas.order).toEqual(['q85', 'c5']); expect(texas.regional).toMatchObject({ region: 'US-TX', level: 'region' });
    expect(texas.regional).not.toHaveProperty('asserted');
    const asserted = await demo.sort(await demo.stranger(), { context: { region: 'us-tx' } });
    expect(asserted.order).toEqual(['q85', 'c5']); expect(asserted.regional).toMatchObject({ region: 'US-TX', asserted: true });
    // Anything that is not a region key asserts nothing, and a malformed member is ignored as it always was.
    for (const context of [{ region: 'Texas' }, { region: 5 }, 'US-TX', ['US-TX'], null]) {
      const edge = await demo.sort(await demo.stranger(), { context });
      expect(edge.regional, JSON.stringify(context)).toEqual({ region: 'US-NC', level: 'region', lambda: 1, version: 9, events: 400, dimensions: ['type'] });
    }
    // Every other profile keeps the request's own region; the assertion moves nothing.
    const customer = await fixture({ regional: REGIONAL, profile: 'customer' });
    const ignored = await customer.sort(await customer.stranger(), { context: { region: 'US-TX' } });
    expect(ignored.order).toEqual(['c5', 'q85']); expect(ignored.regional).toMatchObject({ region: 'US-NC' });
    expect(ignored.regional).not.toHaveProperty('asserted');
  });

  it('and not otherwise: no allowlist, the prior switched off, or no consent to personalization sorts exactly as before', async () => {
    for (const regional of [undefined, { enabled: true, kBlend: 1, minEvents: 30 }, { ...REGIONAL, enabled: false }]) {
      const f = await fixture({ ...(regional ? { regional } : {}) });
      const answer = await f.sort(await f.stranger());
      expect(answer.order, JSON.stringify(regional)).toEqual(['q85', 'c5']);
      expect(answer).not.toHaveProperty('regional');
      expect(answer.items.every(i => i.drivers.length === 0 && i.score === 0)).toBe(true);
    }
    const f = await fixture({ regional: REGIONAL });
    const refused = await f.sort(await f.stranger(false));
    expect(refused.order).toEqual(['q85', 'c5']); expect(refused).not.toHaveProperty('regional');
    expect(refused.items.every(i => i.drivers.length === 0 && i.score === 0)).toBe(true);
    // A region with nothing published for this tenant opens nothing either.
    const nowhere = await f.sort(await f.stranger(), {}, { country: 'CA', regionCode: 'QC' });
    expect(nowhere.order).toEqual(['q85', 'c5']); expect(nowhere).not.toHaveProperty('regional');
  });

  it('keeps the parity dial: at affinity 0 the platform’s order comes back exactly, the prior still named', async () => {
    const f = await fixture({ regional: REGIONAL });
    const answer = await f.sort(await f.stranger(), { weights: { affinity: 0 } });
    expect(answer.order).toEqual(['q85', 'c5']); expect(answer.affinityWeight).toBe(0);
    expect(answer.items.every(i => i.score === 0)).toBe(true);
    expect(answer.regional).toMatchObject({ region: 'US-NC' });
  });
});
