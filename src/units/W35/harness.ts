// src/units/W35/harness.ts
// The in-process host harness for the W35 acceptance tests
// (src/units/W35/LEDGER.unit.test.ts). It mounts the REAL routes on one Hono
// app and binds the REAL `ShopperReflex` class over a durable-storage fake,
// the way `boundary()` in src/routes/realtime.sdkContract.test.ts:120-237 does
// (that helper is file-local and cannot be imported). Nothing here computes an
// expected value; it only runs the product.
//
// What it adds over that helper, and only for the W35 criteria:
//   - `restart(tenant, subject)`: a new ShopperReflex instance over the same
//     stored bytes and alarms (the in-process meaning of an object restart, as
//     the legacy W35 tests use it, :1367 and :4105);
//   - `storageOf(...)`: the object's own storage, so a test can hold or fail
//     one write the way the legacy W35.01 test does (:4133-4151);
//   - `kvDelay`/`kvMiss`: a KV read that answers from an older value or not at
//     all, which is what "stale pointer" means for the KV index (F14 R8);
//   - DECISION_RING / LEARN_STATS objects over the same storage fake, so the
//     served-count (fatigue) path runs its real classes as W15 does (:282-293).

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { identityRoutes } from '@/routes/identity';
import { decisionRoutes } from '@/routes/decisions';
import { sortRoutes } from '@/routes/sort';
import { trackingRoutes } from '@/routes/tracking';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { SHOPPER_HEADER, verifySessionCapability } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { reflexScopeForTenant, REFLEX_KIND } from '@/reflex/configStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionPolicy, RetentionCategory } from '@/retention';

export type Host = 'session' | 'do';
export const HOSTS: readonly Host[] = ['session', 'do'];

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w35-explicit-fixture-policy', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
export const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

export class HarnessKV {
  data = new Map<string, string>();
  calls: string[] = [];
  /** Keys whose reads answer as if the write had not propagated yet (null). */
  miss = new Set<string>();
  /** Keys whose reads answer the value they held when first frozen. */
  frozen = new Map<string, string | null>();
  async get(key: string, type?: string) {
    this.calls.push(`get:${key}`);
    const v = this.miss.has(key) ? undefined : this.frozen.has(key) ? this.frozen.get(key) ?? undefined : this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) { this.calls.push(`put:${key}`); this.data.set(key, value); }
  async delete(key: string) { this.calls.push(`delete:${key}`); this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    this.calls.push('list');
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
  /** Freeze a key's reads at its current value (a replica that has not seen later writes). */
  freeze(key: string) { this.frozen.set(key, this.data.get(key) ?? null); }
}

export class HarnessR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: this.data.get(key)!.length })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/** One durable object's stored bytes and alarm, independent of any instance. */
export interface StoredObject {
  data: Map<string, unknown>;
  alarms: number[];
  sockets: WebSocket[];
  state: DurableObjectState;
}

function storageOver(data: Map<string, unknown>, alarms: number[], effects: string[]) {
  return {
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      const entries = typeof k === 'string' ? [[k, v] as const] : Object.entries(k);
      for (const [key] of entries) effects.push('store:' + key);
      for (const [key, value] of entries) data.set(key, structuredClone(value));
    },
    list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
      structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
        .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
    transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
      const candidate = structuredClone(data);
      let deleteAlarm = false, nextAlarm: number | undefined;
      const tx = {
        list: async (options?: { prefix?: string }) => structuredClone(new Map([...candidate].filter(([key]) => key.startsWith(options?.prefix ?? '')))),
        get: async (key: string | string[]) => structuredClone(Array.isArray(key) ? new Map(key.map(v => [v, candidate.get(v)])) : candidate.get(key)),
        delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
        put: async (values: string | Record<string, unknown>, value?: unknown) => {
          if (typeof values === 'string') candidate.set(values, structuredClone(value));
          else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
        },
        getAlarm: async () => alarms.at(-1) ?? null,
        deleteAlarm: async () => { deleteAlarm = true; },
        setAlarm: async (at: number) => { nextAlarm = at; },
      } as unknown as DurableObjectTransaction;
      const result = await run(tx);
      data.clear(); for (const [key, value] of candidate) data.set(key, value);
      if (deleteAlarm) alarms.length = 0;
      if (nextAlarm !== undefined) alarms.push(nextAlarm);
      return result;
    },
    deleteAll: async () => data.clear(),
    delete: async (k: string | string[]) => { const list = typeof k === 'string' ? [k] : k; let n = 0; for (const key of list) if (data.delete(key)) n++; return typeof k === 'string' ? n > 0 : n; },
    setAlarm: async (at: number) => { alarms.push(at); },
    getAlarm: async () => alarms.at(-1) ?? null,
    deleteAlarm: async () => { alarms.length = 0; },
  };
}

export interface Harness {
  host: Host;
  env: Env;
  app: Hono<{ Bindings: Env }>;
  kv: HarnessKV;
  cache: HarnessKV;
  r2: HarnessR2;
  effects: string[];
  shoppers: Map<string, StoredObject & { shopper: ShopperReflex }>;
  call(path: string, o?: { capability?: string; body?: unknown; tenant?: string; cookie?: string; headers?: Record<string, string>; method?: string }): Promise<Response>;
  drain(): Promise<void>;
  /** The shopper object for a subject, created on first touch exactly as a request would. */
  shopper(tenant: string, subject: string): StoredObject & { shopper: ShopperReflex };
  /** A new instance of the object over the same stored bytes and alarms. */
  restart(tenant: string, subject: string): void;
}

export function harness(host: Host, tenants: string[] = ['meridian', 'coach']): Harness {
  const kv = new HarnessKV(), cache = new HarnessKV(), r2 = new HarnessR2(), effects: string[] = [];
  const pending: Promise<unknown>[] = [];
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: kv, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: r2,
    JWT_SECRET: 'w35-ledger-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:w35-backend-proof',
    TENANTS: JSON.stringify({ provisioned: tenants }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    RETENTION: JSON.stringify({ version: 1, tenants: fixtureCategories(tenants) }),
  } as unknown as Env;
  // Explicit synthetic compatibility configuration, as boundary() authors it (:128-134).
  for (const tenant of [...tenants, 'meridian', 'coach']) cache.data.set(
    `reflex:config:${reflexScopeForTenant(tenant)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w35-synthetic-compatibility', note: '', value: { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' } }),
  );
  let retentionConfigured = false;
  const configureRetention = async () => {
    if (retentionConfigured) return; retentionConfigured = true;
    const policies = fixtureCategories(tenants);
    try {
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => {})) policies[tenant]![destination.category] = fixtureRetentionPolicy;
    } catch { /* a malformed registry still reaches the production refusal */ }
    env.RETENTION = JSON.stringify({ version: 1, tenants: policies });
  };

  const shoppers = new Map<string, StoredObject & { shopper: ShopperReflex }>();
  const objectFor = (name: string) => {
    let item = shoppers.get(name);
    if (!item) {
      const data = new Map<string, unknown>(), alarms: number[] = [], sockets: WebSocket[] = [];
      const storage = storageOver(data, alarms, effects);
      const state = { id: { toString: () => name, name }, storage, getWebSockets: () => sockets, acceptWebSocket: (ws: WebSocket) => { sockets.push(ws); },
        waitUntil: (p: Promise<unknown>) => { pending.push(p); }, blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn() } as unknown as DurableObjectState;
      item = { data, alarms, sockets, state, shopper: new ShopperReflex(state, env) };
      shoppers.set(name, item);
    }
    return item;
  };
  env.SHOPPER_REFLEX = {
    idFromName: (n: string) => ({ toString: () => n, name: n }),
    get: (id: { toString(): string }) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const name = id.toString(); effects.push(`object:${name}`);
      return objectFor(name).shopper.fetch(new Request(input, init));
    } }),
  } as unknown as DurableObjectNamespace;
  for (const [binding, Class] of [['DECISION_RING', DecisionRing], ['LEARN_STATS', LearnStats]] as const) {
    const instances = new Map<string, DecisionRing | LearnStats>();
    (env as unknown as Record<string, unknown>)[binding] = {
      idFromName: (name: string) => ({ toString: () => name, name }),
      get: (id: { toString(): string }) => ({ fetch: (url: string, init?: RequestInit) => {
        const name = id.toString();
        let instance = instances.get(name);
        if (!instance) {
          const data = new Map<string, unknown>(), alarms: number[] = [];
          instance = new Class({ id: { toString: () => name }, storage: storageOver(data, alarms, []), waitUntil: (p: Promise<unknown>) => { pending.push(p); } } as unknown as DurableObjectState, env);
          instances.set(name, instance);
        }
        return instance.fetch(new Request(url, init));
      } }),
    } as unknown as DurableObjectNamespace;
  }

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes); app.route('/v1', identityRoutes); app.route('/v1', decisionRoutes);
  app.route('/sort', sortRoutes); app.route('/track', trackingRoutes);

  const call: Harness['call'] = async (path, o = {}) => {
    await configureRetention();
    const tenant = o.tenant ?? 'meridian';
    const request = new Request(`https://w35.invalid${path}`, {
      method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
      headers: { ...o.headers, 'X-Tenant': tenant, ...(o.capability === undefined ? {} : { [SHOPPER_HEADER]: o.capability }),
        ...(o.cookie ? { Cookie: o.cookie } : {}), 'Content-Type': 'application/json' },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {}, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return {
    host, env, app, kv, cache, r2, effects, shoppers, call, drain,
    shopper: (tenant, subject) => objectFor(shopperObjectName(tenant, subject)),
    restart: (tenant, subject) => { const item = objectFor(shopperObjectName(tenant, subject)); item.shopper = new ShopperReflex(item.state, env); },
  };
}

/** The tenant's four documents, published by the real publication code (W11). */
export async function publish(env: Env, tenant: string, documents: { content: unknown; slots: unknown; learn?: unknown; reflex?: unknown }) {
  const revision = (value: unknown) => ({ revision: 1, at: 1, actor: 'w35-ledger-fixture', note: '', value });
  const baselines: PublicationBaseline[] = [
    { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision(documents.reflex ?? { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }) },
    { kind: CONTENT_KIND, scope: tenant, revision: revision(documents.content) },
    { kind: SLOTS_KIND, scope: tenant, revision: revision(documents.slots) },
    { kind: LEARN_KIND, scope: tenant, revision: revision(documents.learn ?? { holdout: { share: 0, salt: 'w35-fixture', arms: ['default'] } }) },
  ] as PublicationBaseline[];
  await initializePublicationSet(env, baselines, '0:' + crypto.randomUUID());
}

export interface Shopper { tenant: string; subject: string; sessionId: string; capability: string; kind: string; grantId: string; iat: number; exp: number }

/** A brand-new anonymous shopper, through the public session door (src/routes/identity.ts:275). */
export async function openSession(h: Harness, tenant = 'meridian'): Promise<Shopper> {
  const response = await h.call(`/v1/${tenant}/identity/session`, { body: {}, tenant });
  if (response.status !== 200) throw new Error(`fixture session door answered ${response.status}: ${await response.text()}`);
  const { session } = await response.json() as { session: Shopper };
  const claims = await verifySessionCapability(h.env, session.capability, tenant);
  return { ...session, grantId: claims.grantId!, iat: claims.iat, exp: claims.exp };
}

/** Her explicit choice (settled decision D06-W05), through the public preferences door. */
export async function choose(h: Harness, g: Shopper, tracking: boolean, personalization: boolean): Promise<Response> {
  const current = h.shoppers.get(shopperObjectName(g.tenant, g.subject))?.data.get('consent');
  return h.call(`/realtime/session/${g.sessionId}/preferences`, { capability: g.capability, tenant: g.tenant, body: {
    trackingConsent: tracking, personalizationEnabled: personalization,
    choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null, grantId: g.grantId, iat: g.iat, exp: g.exp },
  } });
}
