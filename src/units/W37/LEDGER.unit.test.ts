// src/units/W37/LEDGER.unit.test.ts
// W37 — the Closure Ledger acceptance tests for the LOCAL criteria of the frozen
// work order (docs/remediation/delivery-control/program.json, ticket W37) that no
// existing test already proves. One `describe('unit:W37.<criterion>')` per
// criterion, one `it` per leg.
//
// AUTHORITY (document 35 §5 row W37, :444): "One tenant/customer registry for live
// engine, connector audiences/seeding, regional trend, history/link, sort, ODP and
// all crons. Managed runtime discovery and per-customer stamp manifest with
// environment/resource ownership. Prove two non-default brands, add-brand without
// rebinding another, shared-load isolation and complete export/erasure."
//
// WITNESSES
//   · document 35 §2 F31 (:227-231) and its report §7 — "Thread a canonical
//     customer/brand registry into every production path and cron … Prove two
//     non-default brands across event, decision, identity, sort, egress and erasure."
//   · F33 (:239-243) — resource ownership, provisioning and isolation evidence.
//   · F03 (:59-63) — "two non-default-brand tests that inspect the destination
//     namespace"; N29 (:291) — runtime tenant/registry/job discovery is one authority.
//   · docs/kit/03-payload-schemas.md:26-32 — a tenant may serve more than one brand;
//     the brand is carried on its decisions and events (`data.brand`), and each
//     brand has its own statistics and its own day report (:490).
//   · docs/kit/02-api-reference.md:36 (RETENTION tenants "must already exist in
//     TENANTS"), :581 (`GET brands`: manifest order, "preserving each brand's
//     original default flag"), docs/deployment/01-deploy.md:15 (`add-brand`
//     retains "every existing brand key, policy and descriptor"), :32.
//   · LANE-LOG R46(g)/(i), R52 and R58 — the owed regression units W37.BASE.03,
//     .04 and .05 (frozen, evidence only).
//   · HANDOFF-2026-09-18 §8 D08 — local proof uses fixture tenants; the real
//     topology is LIVE2.
//
// ONE REPRESENTATION. Every unit here uses the same fixture stamp: two
// non-default tenants `acme` and `globex` (no default tenant is registered), the
// unregistered `initech`, and a second brand `acme-outlet` served by `acme`. Events
// carry the kit's Coach taxonomy (docs/kit/03-payload-schemas.md:19), including an
// unknown category and a cross-category occasion list.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import type { Env } from '@/types/env';
import { tenantMiddleware } from '@/tenancy/middleware';
import { sdkKey, operatorWrites } from '@/middleware/edgeAccess';
import { errorHandler } from '@/middleware/error';
import realtimeRoutes from '@/routes/realtime';
import { identityRoutes } from '@/routes/identity';
import { decisionRoutes } from '@/routes/decisions';
import { sortRoutes } from '@/routes/sort';
import { authRoutes } from '@/routes/auth';
import { operatorRoutes } from '@/routes/operator';
import { ShopperReflex, type AffinityRecord } from '@/durable-objects/ShopperReflex';
import { RegionTrend } from '@/durable-objects/RegionTrend';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { newAnonymousSession, issueSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { storedConsent, CONSENT_LIFETIME_MS, CONSENT_SWITCHES, type ConsentInstruction } from '@/content/consent';
import { initializePublicationSet, publicationScope, PublicationError, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant, ReflexConfigUnavailableError } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { invalidateTrendCache, objectName as regionObjectName, trendKey, REGION_GENERATION } from '@/reflex/regionTrend';
import { shopperObjectName } from '@/tenancy/objects';
import { connectorConfiguration, ConnectorConfigurationError } from '@/connectors/config';
import { retentionPolicy, retentionBirth, RetentionUnavailable, type RetentionPolicy } from '@/retention';
import { oidcConfiguration } from '@/auth/oidc';
import { hourPrefix, ts36 } from '@/ledger/records';
import { reportKey } from '@/learn/report';
import { consumeLedger } from '@/ledger/consume';
import { rollupTenant } from '@/reflex/regionTrend';
import { canonical as stampCanonical, sha256 as stampSha256, validateDesired, validateTransition } from '../../../scripts/stamp-workflow.mjs';
import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime, type NativeRuntime } from '../_native';

// ===========================================================================
// The fixture stamp — one representation for every unit.
// ===========================================================================

const ACME = 'acme', GLOBEX = 'globex', INITECH = 'initech', OUTLET = 'acme-outlet';
const DAY = 86_400_000;
const SECRET = 'w37-ledger-synthetic-signing-material-only';
const policy = (durationMs = 365 * DAY): RetentionPolicy => ({ id: 'w37-ledger-fixture-policy', revision: 1, durationMs, basis: 'admitted', renewal: 'new-record-only' });
const categories = (profile = policy()) => ({ profile, identity: policy(), ledger: policy(), online: policy(), hourly: policy() });
const retentionFor = (tenants: string[], profile?: RetentionPolicy) =>
  JSON.stringify({ version: 1, tenants: Object.fromEntries(tenants.map(tenant => [tenant, categories(profile)])) });
const registry = (tenants: string[]) => JSON.stringify({ provisioned: tenants });

/** The kit's Coach taxonomy (docs/kit/03-payload-schemas.md:19), with an unknown and a cross-category value. */
const TABBY_VIEW = { productId: 'W37-TABBY-26', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags', silhouette: 'shoulder', occasion: ['evening', 'work'], price_usd: 395 };
const UNKNOWN_VIEW = { productId: 'W37-UNFILED', line: 'Unfiled', category: 'Unknown Category', occasion: ['evening', 'travel', 'gift'], price_usd: 12 };

/** The tenant's published configuration: publication is the only configuration authority (src/config/publication.ts:19). */
function publicationFor(tenant: string, reflex = { ...DEFAULT_REFLEX_CONFIG, version: `w37-${tenant}`, eventAttributes: 'event-when-unknown' as const }): PublicationBaseline[] {
  const revision = (value: unknown) => ({ revision: 1, at: 1, actor: 'w37-ledger-fixture', note: '', value });
  return [
    { kind: REFLEX_KIND, scope: reflexScopeForTenant(tenant), revision: revision(reflex) },
    { kind: CONTENT_KIND, scope: tenant, revision: revision({ pieces: [
      { id: 'tabby-evening', customerContentId: 'CMS-TABBY-EVENING', type: 'editorial', title: 'Tabby, after six', tags: { line: ['Tabby'], occasion: ['evening'] }, slotTypes: ['hero'] },
      { id: 'rogue-work', customerContentId: 'CMS-ROGUE-WORK', type: 'video', title: 'The Rogue, at work', tags: { line: ['Rogue'], occasion: ['work'] }, slotTypes: ['hero'] },
    ] }) },
    { kind: SLOTS_KIND, scope: tenant, revision: revision({ pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1, occasion: 0.5 } }] } }) },
    { kind: LEARN_KIND, scope: tenant, revision: revision({ holdout: { share: 0, salt: `w37-${tenant}`, arms: ['default'] }, slots: { hero: { reward: 'click' } } }) },
  ];
}

// ===========================================================================
// The in-process host: the mounted routes behind the ingress chain of
// src/index.ts:81-95, over KV/R2/queue doubles that log every physical key, and
// the REAL Durable Object classes (ShopperReflex, RegionTrend, DecisionRing,
// LearnStats) addressed by name — the harness shape of
// src/routes/realtime.sdkContract.test.ts:137-245.
// ===========================================================================

type Write = { store: string; op: string; key: string };

class LoggedKV {
  data = new Map<string, string>();
  constructor(private readonly name: string, private readonly writes: Write[]) {}
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) : type === 'stream' ? new Response(v).body : v; }
  async put(key: string, value: string) { this.writes.push({ store: this.name, op: 'put', key }); this.data.set(key, String(value)); }
  async delete(key: string) { this.writes.push({ store: this.name, op: 'delete', key }); this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}
class LoggedR2 {
  data = new Map<string, string>(); versions = new Map<string, number>(); metadata = new Map<string, Record<string, string>>();
  constructor(private readonly writes: Write[]) {}
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.data.has(key) ? { key, etag: 'v' + this.versions.get(key), size: this.data.get(key)!.length } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const text = typeof raw === 'string' ? raw : await new Response(raw as BodyInit).text();
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : (condition as R2Conditional | undefined)?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : (condition as R2Conditional | undefined)?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.writes.push({ store: 'STORAGE', op: 'put', key });
    this.data.set(key, text); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(text).length };
  }
  async delete(key: string | string[]) { for (const k of typeof key === 'string' ? [key] : key) { this.writes.push({ store: 'STORAGE', op: 'delete', key: k }); this.data.delete(k); } }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface Item { data: Map<string, unknown>; alarms: number[]; state: DurableObjectState; instance: { fetch(r: Request): Promise<Response>; alarm?(): Promise<void> } }

/** One object's storage, with the transaction/alarm surface the classes use (sdkContract.test.ts:171-212). */
function objectStorage(item: { data: Map<string, unknown>; alarms: number[] }) {
  const { data, alarms } = item;
  return {
    get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
    put: async (k: string | Record<string, unknown>, v?: unknown) => {
      if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
    },
    delete: async (k: string | string[]) => { const keys = typeof k === 'string' ? [k] : k; let n = 0; for (const key of keys) if (data.delete(key)) n++; return typeof k === 'string' ? n > 0 : n; },
    list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
      structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
        .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
    transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
      const candidate = structuredClone(data); let deleteAlarm = false, nextAlarm: number | undefined;
      const tx = {
        list: async (options?: { prefix?: string }) => structuredClone(new Map([...candidate].filter(([key]) => key.startsWith(options?.prefix ?? '')))),
        get: async (key: string) => structuredClone(candidate.get(key)),
        delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
        put: async (values: string | Record<string, unknown>, value?: unknown) => {
          if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, v] of Object.entries(values)) candidate.set(key, structuredClone(v));
        },
        deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; }, getAlarm: async () => alarms.at(-1) ?? null,
      } as unknown as DurableObjectTransaction;
      const result = await run(tx);
      data.clear(); for (const [key, value] of candidate) data.set(key, value);
      if (deleteAlarm) alarms.length = 0;
      if (nextAlarm !== undefined) alarms.push(nextAlarm);
      return result;
    },
    deleteAll: async () => data.clear(),
    setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
  };
}

interface HostOptions { tenants?: string[]; retention?: string; enforced?: boolean; sdkKeys?: string; extra?: Record<string, unknown> }

function host(kind: 'session' | 'do', options: HostOptions = {}) {
  const writes: Write[] = [], addressed: Write[] = [], queued: unknown[] = [], pending: Promise<unknown>[] = [];
  const cache = new LoggedKV('CACHE', writes), sessions = new LoggedKV('SESSIONS', writes), storage = new LoggedR2(writes);
  const tenants = options.tenants ?? [ACME, GLOBEX];
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ...(options.enforced ? { AUTH_MODE: 'enforced' } : {}), REFLEX_HOST: kind, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
    CACHE: cache, SESSIONS: sessions, STORAGE: storage, JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    TENANTS: registry(tenants), RETENTION: options.retention ?? retentionFor(tenants),
    ...(options.sdkKeys ? { SDK_KEYS: options.sdkKeys } : {}),
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (bodies: Array<{ body: unknown }>) => { for (const b of bodies) queued.push(b.body); } },
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: (sql: string) => { writes.push({ store: 'DB', op: 'prepare', key: sql }); return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 1 } }), first: async () => null, all: async () => ({ success: true, results: [] }) }) }; } },
    ...options.extra,
  } as unknown as Env;
  const objects = new Map<string, Item>();
  const namespace = (binding: string, make: (state: DurableObjectState) => Item['instance']) => ({
    idFromName: (name: string) => name,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      addressed.push({ store: binding, op: 'fetch', key: name });
      const id = binding + '|' + name;
      let item = objects.get(id);
      if (!item) {
        const data = new Map<string, unknown>(), alarms: number[] = [];
        const sockets: WebSocket[] = [];
        const state = { id: { toString: () => name, name } as unknown as DurableObjectId, storage: objectStorage({ data, alarms }), getWebSockets: () => sockets,
          waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, alarms, state, instance: make(state) };
        objects.set(id, item);
      }
      return item.instance.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespace('SHOPPER_REFLEX', state => new ShopperReflex(state, env)) as unknown as DurableObjectNamespace;
  env.REGION_TREND = namespace('REGION_TREND', state => new RegionTrend(state, env)) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespace('DECISION_RING', state => new DecisionRing(state, env)) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespace('LEARN_STATS', state => new LearnStats(state, env)) as unknown as DurableObjectNamespace;

  // The ingress chain of src/index.ts:81-95, then the retained shopper and operator routes.
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.use('/realtime/*', sdkKey()); app.use('/v1/:tenant/*', sdkKey()); app.use('/operator/*', operatorWrites());
  app.onError(errorHandler);
  app.route('/auth', authRoutes); app.route('/operator', operatorRoutes); app.route('/sort', sortRoutes);
  app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes); app.route('/v1', identityRoutes);

  const call = async (path: string, opts: { grant?: { capability: string }; body?: unknown; tenant?: string; headers?: Record<string, string>; method?: string; cf?: unknown } = {}) => {
    const request = new Request(`https://w37.synthetic.invalid${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...(opts.tenant ? { 'X-Tenant': opts.tenant } : {}),
        ...(opts.grant ? { [SHOPPER_HEADER]: opts.grant.capability } : {}), ...opts.headers },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    if (opts.cf) Object.defineProperty(request, 'cf', { value: opts.cf });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  const item = (binding: string, name: string) => objects.get(binding + '|' + name);
  const restart = (binding: string, name: string) => {
    const it = item(binding, name)!;
    it.instance = binding === 'SHOPPER_REFLEX' ? new ShopperReflex(it.state, env) : binding === 'REGION_TREND' ? new RegionTrend(it.state, env) : it.instance;
    return it;
  };
  return { env, app, call, drain, cache, sessions, storage, writes, addressed, queued, objects, item, restart };
}
type Host = ReturnType<typeof host>;

async function publish(h: Host, tenant: string, reflex?: Parameters<typeof publicationFor>[1]) {
  await initializePublicationSet(h.env, publicationFor(tenant, reflex), '0:' + crypto.randomUUID());
}

/** The SDK's explicit choice (D06-W05): the only consent that grants a purpose (src/content/consent.ts:6-8). */
async function choose(h: Host, grant: Awaited<ReturnType<typeof newAnonymousSession>>, tracking: boolean, personalization: boolean) {
  const current = h.item('SHOPPER_REFLEX', shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const response = await h.call(`/realtime/session/${grant.sessionId}/preferences`, { grant, tenant: grant.tenant, body: {
    trackingConsent: tracking, personalizationEnabled: personalization,
    choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  } });
  expect(response.status, `explicit choice for ${grant.tenant}: ${await response.clone().text()}`).toBe(200);
}

/** The key segments a physical name carries; a tenant's name appears as one whole segment. */
const segments = (name: string) => name.split(/[:/|]/);
const names = (tenant: string) => (name: string) => segments(name).includes(tenant);

// ===========================================================================
// The native runtime: the REAL src/index.ts (fetch and scheduled) bundled and run
// in workerd by the one shared harness, src/units/_native.ts. The wrapper adds
// fixture doors only: publish a tenant's documents, seed raw ledger objects, mint
// an anonymous grant, withdraw a publication, run a cron with every job it hands
// to waitUntil awaited, and read stored objects back.
// ===========================================================================

const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { newAnonymousSession } from './src/identity/sessionCapability.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'w37-fixture') return worker.fetch(request, env, ctx);
    const input = request.method === 'POST' ? await request.json() : {};
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'w37-ledger-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) },
        { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/seed') { for (const [key, body] of input.objects) await env.STORAGE.put(key, body); return Response.json({ seeded: input.objects.length }); }
    if (url.pathname === '/grant') return Response.json(await newAnonymousSession(env, input.tenant));
    if (url.pathname === '/unpublish') {
      let removed = 0, cursor;
      do { const page = await env.STORAGE.list({ prefix: 'config-publication/v2/' + input.tenant + '/', cursor });
        for (const o of page.objects) { await env.STORAGE.delete(o.key); removed++; } cursor = page.truncated ? page.cursor : undefined; } while (cursor);
      return Response.json({ removed });
    }
    if (url.pathname === '/scheduled') {
      const pending = [];
      await worker.scheduled({ cron: input.cron, scheduledTime: Date.now(), noRetry() {} }, env,
        { waitUntil(promise) { pending.push(Promise.resolve(promise)); }, passThroughOnException() {} });
      let rejected = 0; for (let i = 0; i < pending.length; i++) { try { await pending[i]; } catch { rejected++; } }
      return Response.json({ jobs: pending.length, rejected });
    }
    if (url.pathname === '/objects') {
      const out = {}; let cursor;
      do { const page = await env.STORAGE.list({ prefix: input.prefix, cursor });
        for (const o of page.objects) out[o.key] = await (await env.STORAGE.get(o.key)).text(); cursor = page.truncated ? page.cursor : undefined; } while (cursor);
      return Response.json(out);
    }
    return new Response(null, { status: 404 });
  },
};`;

let nativeBundle: Promise<string> | undefined;
async function nativeStamp(name: string, bindings: Record<string, string>) {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'w37-ledger-native'));
  const directory = nativeScratchDirectory('w37-ledger-native-');
  const runtime: NativeRuntime = await openNativeRuntime({
    bundle, name, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket',
      DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', ...bindings },
  });
  const door = async (path: string, body?: unknown) => {
    const response = await runtime.fetch(`https://w37-fixture${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    expect(response.status, `fixture door ${path}`).toBe(200);
    return await response.json() as Record<string, unknown>;
  };
  const documents = (tenant: string) => {
    const [reflex, content, slots, learn] = publicationFor(tenant).map(entry => entry.revision.value);
    return { tenant, reflex, content, slots, learn };
  };
  return { runtime, door, documents, close: async () => { await runtime.dispose(); directory.remove(); } };
}

// ===========================================================================
// unit:W37.T1 — one registry; an unregistered tenant is refused everywhere.
//
// The registry is `TENANTS` (src/tenancy/middleware.ts:41-74); the kit makes the
// per-tenant configurations subordinate to it (docs/kit/02-api-reference.md:36
// for RETENTION; src/connectors/config.ts:1 and :110-119; src/auth/oidc.ts:29-30;
// the stamp workflow requires key sets to "exactly cover the registry",
// docs/deployment/01-deploy.md:32). The fixture below gives the unregistered
// `initech` everything a registered tenant has — its own site key, identity
// secret, connectors, retention policies and operator OIDC provider — so only the
// registry can refuse it. Legacy W37.07 already proves an unknown tenant with NO
// configuration is refused at ingress and by all crons; this unit adds the
// tenant every other configuration names, and the work that carries a tenant
// outside any request (a queued envelope, the shopper object's alarm, the
// regional-trend object's alarm — doc 35 W37 lists "regional trend").
// ===========================================================================

const OIDC_PROVIDER = (tenant: string) => ({ enabled: true, issuer: `https://idp.${tenant}.example`, authorizationEndpoint: `https://idp.${tenant}.example/authorize`,
  tokenEndpoint: `https://idp.${tenant}.example/token`, jwksUri: `https://idp.${tenant}.example/jwks`, origin: `https://ops.${tenant}.example/`,
  clientId: `w37-${tenant}`, clientSecretRef: `OPERATOR_OIDC_SECRET_${tenant.toUpperCase()}`, algorithms: ['RS256'],
  transactionMs: 60_000, sessionMs: 3_600_000, reauthMs: 3_600_000, timeoutMs: 1_000 });
/** Every per-tenant configuration and credential the stamp holds, for the given tenants. */
function perTenantConfiguration(tenants: string[]) {
  return {
    SDK_KEYS: tenants.map(tenant => `${tenant}:${tenant}-site-key`).join(','),
    IDENTITY_SECRETS: tenants.map(tenant => `${tenant}:${tenant}-identity-material`).join(','),
    TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: Object.fromEntries(tenants.map(tenant => [tenant, {}])) }),
    OPERATOR_OIDC: JSON.stringify({ version: 1, tenants: Object.fromEntries(tenants.map(tenant => [tenant, OIDC_PROVIDER(tenant)])) }),
    ...Object.fromEntries(tenants.map(tenant => [`OPERATOR_OIDC_SECRET_${tenant.toUpperCase()}`, `${tenant}-oidc-client-secret-material-0123456789`])),
  };
}

describe('unit:W37.T1', () => {
  it('host: the unregistered tenant is refused on every request surface and by every per-tenant configuration, although each of them names it; the same requests for a registered tenant pass the tenant gate', async () => {
    const operator = await new SignJWT({ sub: 'w37-operator', type: 'service', roles: ['operator'], permissions: ['read', 'write'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const requests = (tenant: string, grant?: { capability: string; subject: string; sessionId: string }) => [
      ['POST /realtime/action', `/realtime/action`, { type: 'product_view', userId: grant?.subject ?? 'vis-w37', sessionId: grant?.sessionId ?? 's-w37', source: 'sdk', data: TABBY_VIEW }, {}],
      ['GET /realtime/reflex', `/realtime/reflex`, undefined, {}],
      ['GET /v1/:tenant/decisions/snapshot', `/v1/${tenant}/decisions/snapshot?page=home`, undefined, {}],
      ['POST /v1/:tenant/identity/link', `/v1/${tenant}/identity/link`, { visitorId: grant?.subject ?? 'vis-w37', accountId: 'w37-account' }, {}],
      ['POST /sort', `/sort`, { userId: grant?.subject ?? 'vis-w37', sessionId: grant?.sessionId ?? 's-w37', candidates: [{ id: 'tabby', line: 'Tabby' }] }, {}],
      ['GET /operator/audiences', `/operator/audiences`, undefined, { Authorization: `Bearer ${operator}` }],
      ['POST /auth/oidc/start', `/auth/oidc/start`, { email: 'ops@example.test' }, {}],
      ['GET /auth/oidc/callback/:tenant', `/auth/oidc/callback/${tenant}?code=x&state=${'a'.repeat(43)}`, undefined, {}],
    ] as const;

    // Every configuration names initech; only the registry does not.
    const named = host('do', { enforced: true, tenants: [ACME, GLOBEX], retention: retentionFor([ACME, GLOBEX, INITECH]),
      extra: perTenantConfiguration([ACME, GLOBEX, INITECH]) });
    for (const [label, path, body, headers] of requests(INITECH)) {
      const response = await named.call(path, { tenant: INITECH, body, headers: { 'X-SDK-Key': `${INITECH}-site-key`, ...headers } });
      expect({ status: response.status, body: await response.json() }, `W37.T1 — ${label}: the unregistered tenant is refused before any tenant work`)
        .toEqual({ status: 403, body: { ok: false, error: 'Tenant unavailable' } });
    }
    expect(named.writes, 'W37.T1 — no storage write for the unregistered tenant').toEqual([]);
    expect(named.addressed, 'W37.T1 — no object addressed for the unregistered tenant').toEqual([]);
    expect(() => connectorConfiguration(named.env, INITECH), 'W37.T1 — connectors do not resolve an unregistered tenant').toThrow(ConnectorConfigurationError);
    expect(() => retentionPolicy(named.env, INITECH, 'profile'), 'W37.T1 — retention does not resolve an unregistered tenant').toThrow(RetentionUnavailable);
    expect(() => oidcConfiguration(named.env)[INITECH], 'W37.T1 — operator OIDC does not resolve an unregistered tenant').toThrow();

    // CONTROL: the registered tenant, configured exactly as the registry names, passes the tenant gate on the same requests.
    invalidateCache();
    const registered = host('do', { enforced: true, tenants: [ACME, GLOBEX], extra: perTenantConfiguration([ACME, GLOBEX]) });
    await publish(registered, ACME);
    const grant = await newAnonymousSession(registered.env, ACME);
    for (const [label, path, body, headers] of requests(ACME, grant)) {
      const response = await registered.call(path, { tenant: ACME, grant, body, headers: { 'X-SDK-Key': `${ACME}-site-key`, ...headers } });
      expect(await response.clone().text(), `W37.T1 control — ${label}: a registered tenant is not refused by the tenant gate`).not.toContain('Tenant unavailable');
    }
    expect(connectorConfiguration(registered.env, ACME)).toEqual({});
    expect(retentionPolicy(registered.env, ACME, 'profile')).toEqual(policy());
    expect(oidcConfiguration(registered.env)[ACME]).toMatchObject({ enabled: true, issuer: 'https://idp.acme.example' });
    await registered.drain();
  });

  it('host: work that carries a tenant outside a request — a queued ledger envelope, the shopper object\'s alarm and the regional-trend object\'s alarm — does nothing for a tenant the registry no longer names, keeps its state, and resumes when the tenant is registered again', async () => {
    for (const kind of ['session', 'do'] as const) {
      invalidateCache(); invalidateTrendCache();
      const h = host(kind); await publish(h, ACME); await publish(h, GLOBEX);
      const g = await newAnonymousSession(h.env, GLOBEX); await choose(h, g, true, true);
      for (const data of [TABBY_VIEW, { event: 'content_click', contentType: 'video' }]) {
        const response = await h.call('/realtime/action', { grant: g, tenant: GLOBEX, cf: { country: 'US', regionCode: 'NY' },
          body: { type: data === TABBY_VIEW ? 'product_view' : 'custom', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data } });
        expect(response.status, `${kind}: globex's load while registered`).toBe(200);
      }
      await h.drain();
      const trendName = regionObjectName(GLOBEX, 'US-NY'), trend = h.item('REGION_TREND', trendName)!;
      expect(trend, `${kind}: globex's population accrued in its own regional object`).toBeDefined();
      const envelopes = h.queued.splice(0);
      expect(envelopes.length, `${kind}: globex's outcome was queued`).toBeGreaterThan(0);

      // The registry no longer names globex (and, coherently, neither does RETENTION).
      Object.assign(h.env, { TENANTS: registry([ACME]), RETENTION: retentionFor([ACME]) });
      h.writes.length = 0;
      const consumed = await consumeLedger(h.env, envelopes);
      expect(consumed.dispositions, `${kind}: the queued envelope of an unregistered tenant is retried, not consumed`).toEqual(envelopes.map(() => 'retry'));
      const shopperName = shopperObjectName(GLOBEX, g.subject), shopper = h.restart('SHOPPER_REFLEX', shopperName);
      const shopperBefore = structuredClone([...shopper.data]); shopper.alarms.length = 0;
      await (shopper.instance as ShopperReflex).alarm().catch(() => undefined);
      expect([...shopper.data], `${kind}: the shopper object's alarm does no work for an unregistered tenant`).toEqual(shopperBefore);
      const trendBefore = structuredClone([...trend.data]);
      await (h.restart('REGION_TREND', trendName).instance as RegionTrend).alarm().catch(() => undefined);
      expect(h.writes, `W37.T1 — ${kind}: nothing is written for a tenant the registry no longer names (the regional-trend alarm must not publish trend:v2:globex:*)`).toEqual([]);
      expect([...trend.data], `${kind}: the regional object keeps its population through the refusal`).toEqual(trendBefore);

      // Registered again: the same work resumes (the refusal was the registry's, not the fixture's).
      Object.assign(h.env, { TENANTS: registry([ACME, GLOBEX]), RETENTION: retentionFor([ACME, GLOBEX]) });
      expect((await consumeLedger(h.env, envelopes)).dispositions, `${kind}: the retained envelope is consumed once the tenant is registered`).toEqual(envelopes.map(() => 'ack'));
      await (h.restart('REGION_TREND', trendName).instance as RegionTrend).alarm();
      expect(h.cache.data.get(trendKey(GLOBEX, 'US-NY')), `${kind}: the preserved population is published once the tenant is registered`).toBeDefined();
      expect(JSON.parse(h.cache.data.get(trendKey(GLOBEX, 'US-NY'))!)).toMatchObject({ generation: REGION_GENERATION, tenant: GLOBEX, region: 'US-NY' });
      await h.drain();
    }
  });
});

// ===========================================================================
// unit:W37.T2 — every cron iterates the registered tenants AND their brands.
//
// A tenant serves more than one brand: the brand rides on its decisions and
// events and is measured in that brand's own statistics (docs/kit/03-payload-
// schemas.md:26-32), and the day report is one per brand, stored at
// `reports/{tenant}/{brand}/{date}.json` (src/learn/report.ts:1195) and built from
// that brand's rows only (:1316-1320). The day-report cron builds
// `{ tenant, brand: tenant }` (src/index.ts:286) and the hourly fold's day
// publication does the same (src/learn/hourly.ts:1834), so a brand other than the
// tenant's own never gets a day report. "Registered tenants and their brands":
// the tenants come from the registry, their brands from what each tenant's own
// records carry — no witness defines a separate brand list.
//
// The fixture: yesterday, in one closed hour, `acme` served two decisions under
// its own brand and three under `acme-outlet`, each with a click; `globex`
// served one under its own. Ledger objects are written exactly as the consumer
// writes them (src/learn/hourly.test.ts:82-88), with their retention births.
// ===========================================================================

function ledgerDay(tenants: string[], at = Date.now() - DAY) {
  const retentionEnv = { TENANTS: registry(tenants), RETENTION: retentionFor(tenants), DEPLOYMENT_PROFILE: 'demo' } as Pick<Env, 'TENANTS' | 'RETENTION' | 'DEPLOYMENT_PROFILE'>;
  const hour = Math.floor(at / 3_600_000) * 3_600_000, objects: [string, string][] = [];
  const cell = { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: null };
  const stamps = (tenant: string, ts: number) => Object.fromEntries((['ledger', 'online', 'hourly'] as const).map(category => [category, retentionBirth(retentionEnv, tenant, category, ts, ts)]));
  const served: Array<{ tenant: string; brand: string; visitor: string }> = [
    { tenant: ACME, brand: ACME, visitor: 'vis-w37-acme-1' }, { tenant: ACME, brand: ACME, visitor: 'vis-w37-acme-2' },
    { tenant: ACME, brand: OUTLET, visitor: 'vis-w37-outlet-1' }, { tenant: ACME, brand: OUTLET, visitor: 'vis-w37-outlet-2' }, { tenant: ACME, brand: OUTLET, visitor: 'vis-w37-outlet-3' },
    { tenant: GLOBEX, brand: GLOBEX, visitor: 'vis-w37-globex-1' },
  ];
  served.forEach(({ tenant, brand, visitor }, n) => {
    const ts = hour + (n + 1) * 60_000, clicked = ts + 1_000;
    const decision = { decision_id: `${tenant}:${ts36(ts)}:${visitor}:home:hero:0`, tenant, brand, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
      page: 'home', slot: 'hero', position: 0, item_id: 'tabby-evening', customer_item_id: 'CMS-TABBY-EVENING', candidates: [], cell, arm: 'personalized', explored: false,
      authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: `w37-${tenant}`, explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
      retention: stamps(tenant, ts) };
    const outcome = { outcome_id: `${tenant}:${ts36(clicked)}:${visitor}:click`, tenant, brand, visitor_id: visitor, session_id: `s-${visitor}`, ts: clicked, type: 'click', event: 'click',
      item_id: 'tabby-evening', slot: 'hero', value: null, currency: null, margin: null, products: null, arm: null, retention: stamps(tenant, clicked) };
    objects.push([`${hourPrefix(tenant, ts)}/decision/${ts36(ts)}-${ts36(ts)}-w37.ndjson`, JSON.stringify(decision) + '\n']);
    objects.push([`${hourPrefix(tenant, clicked)}/outcome/${ts36(clicked)}-${ts36(clicked)}-w37.ndjson`, JSON.stringify(outcome) + '\n']);
  });
  const date = new Date(hour).toISOString().slice(0, 10);
  const expected = { [`${ACME}/${ACME}`]: 2, [`${ACME}/${OUTLET}`]: 3, [`${GLOBEX}/${GLOBEX}`]: 1 };
  return { objects, date, hour, expected, retention: retentionEnv.RETENTION! };
}

describe('unit:W37.T2', () => {
  it('native: in workerd the 03:00 day-report cron publishes one day report for each brand every registered tenant served yesterday — acme-outlet as well as acme and globex — each counting only its own brand', async () => {
    const day = ledgerDay([ACME, GLOBEX]);
    const stamp = await nativeStamp('w37t2report', { REFLEX_HOST: 'do', TENANTS: registry([ACME, GLOBEX]), RETENTION: day.retention });
    try {
      for (const tenant of [ACME, GLOBEX]) await stamp.door('/publish', stamp.documents(tenant));
      await stamp.door('/seed', { objects: day.objects });
      const run = await stamp.door('/scheduled', { cron: '0 3 * * *' });
      expect(run.jobs as number, 'the real scheduled handler handed its jobs to the runtime').toBeGreaterThan(0);
      const reports = await stamp.door('/objects', { prefix: 'reports/' }) as Record<string, string>;
      const got = Object.fromEntries(Object.entries(reports).map(([key, body]) => { const r = JSON.parse(body); return [key, { tenant: r.tenant, brand: r.brand, date: r.date, decisions: r.counts.decisions, outcomes: r.counts.outcomes }]; }));
      expect(got, `W37.T2 — the day-report cron must publish ${reportKey(ACME, OUTLET, day.date)}: it builds { tenant, brand: tenant } only (src/index.ts:286)`).toEqual(Object.fromEntries(
        Object.entries(day.expected).map(([pair, count]) => { const [tenant, brand] = pair.split('/') as [string, string];
          return [reportKey(tenant, brand, day.date), { tenant, brand, date: day.date, decisions: count, outcomes: count }]; })));
      expect(stamp.runtime.outboundAttempts(), 'no job reached the network').toBe(0);
    } finally { await stamp.close(); }
  }, 240_000);

  it('native: in workerd the five-minute cron\'s hourly fold publishes the folded day for each brand of each registered tenant, acme-outlet included', async () => {
    const day = ledgerDay([ACME, GLOBEX]);
    const stamp = await nativeStamp('w37t2fold', { REFLEX_HOST: 'do', TENANTS: registry([ACME, GLOBEX]), RETENTION: day.retention });
    try {
      for (const tenant of [ACME, GLOBEX]) await stamp.door('/publish', stamp.documents(tenant));
      await stamp.door('/seed', { objects: day.objects });
      const folded = `aggregates/${ACME}/${day.date}/${new Date(day.hour).toISOString().slice(11, 13)}.json`;
      // Two closed hours per run, oldest first (src/learn/hourly.ts:1750-1800): run until the data hour is folded.
      for (let run = 0; run < 14 && !Object.hasOwn(await stamp.door('/objects', { prefix: folded }), folded); run++) await stamp.door('/scheduled', { cron: '*/5 * * * *' });
      const aggregate = JSON.parse((await stamp.door('/objects', { prefix: folded }) as Record<string, string>)[folded]!);
      expect(Object.keys(aggregate.brands).sort(), 'the fold holds both brands of acme for that hour').toEqual([ACME, OUTLET].sort());
      const reports = Object.keys(await stamp.door('/objects', { prefix: 'reports/' })).sort();
      expect(reports, `W37.T2 — the hourly fold's day publication must include ${reportKey(ACME, OUTLET, day.date)}: it publishes { tenant, brand: tenant } only (src/learn/hourly.ts:1834)`)
        .toEqual(expect.arrayContaining([reportKey(ACME, ACME, day.date), reportKey(ACME, OUTLET, day.date), reportKey(GLOBEX, GLOBEX, day.date)]));
    } finally { await stamp.close(); }
  }, 240_000);
});

// ===========================================================================
// unit:W37.T3 — two non-default brands side by side; adding a brand rebinds no
// other brand (scripts/stamp-workflow.mjs).
//
// The customer stamp's desired state (docs/deployment/01-deploy.md:23-32,
// validateDesired at scripts/stamp-workflow.mjs:167) holds the registry
// (`tenants.provisioned`, `hosts`), origins, routes and each brand's key set,
// identity secret, retention policies, telemetry descriptors and OIDC provider.
// `add-brand` "retain[s] every existing brand key, policy and descriptor"
// (01-deploy.md:15); the workflow runs validateTransition before any provider
// call (stamp-workflow.mjs:1265). The runtime binds `TENANTS` from
// `canonical(d.tenants)` and `SDK_KEYS` from the desired secrets (:896-903), and a
// brand's `default` flag in the operator brand list is its manifest position
// (src/routes/decisions.ts:245; "preserving each brand's original default flag",
// docs/kit/02-api-reference.md:581). The stamp serves acme and globex; the brand
// added is initech — the tenant T1 refuses until it is registered.
// ===========================================================================


const STAMP_MATERIAL = '9qL8wEfR73mCu5xY02hJ6zN4bAvT1sKd';
type Desired = Record<string, any>;
function desiredStamp(brands: string[]): Desired {
  const script = 'w37cust-staging', approved = { id: 'approved-fixture', revision: 1, durationMs: 123456, basis: 'admitted', renewal: 'new-record-only' };
  const d: Desired = { version: 1, customer: 'w37cust', account: 'a'.repeat(32), environment: 'staging', script, ownership: 'a'.repeat(64),
    resources: { cache: { name: `${script}-cache`, id: '1'.repeat(32) }, sessions: { name: `${script}-sessions`, id: '2'.repeat(32) },
      database: { name: `${script}-database`, id: '33333333-3333-4333-8333-333333333333' }, storage: { name: `${script}-storage`, id: `${script}-storage` },
      queue: { name: `${script}-queue`, id: '4'.repeat(32) }, deadLetter: { name: `${script}-deadletter`, id: '5'.repeat(32) }, analytics: 'w37cust_staging_ops_v1' },
    tenants: { provisioned: [...brands], hosts: Object.fromEntries(brands.map(b => [`${b}.example.test`, b])) },
    origins: brands.map(b => `https://${b}.example.test`), owners: ['ops-22222222-2222-4222-8222-222222222222'],
    vars: { JWT_ISSUER: script, JWT_AUDIENCE: 'customer-api', REFLEX_HOST: 'session' },
    secrets: { JWT_SECRET: STAMP_MATERIAL, SDK_KEYS: brands.map(b => `${b}:${b}-${STAMP_MATERIAL}`).join(','), IDENTITY_SALT: STAMP_MATERIAL,
      IDENTITY_SECRETS: brands.map(b => `${b}:${b}-identity-${STAMP_MATERIAL}`).join(','), ALERT_WEBHOOK_URL: 'https://alerts.example.test/private-fixture' },
    routes: brands.map(b => ({ zone: 'b'.repeat(32), pattern: `${b}.example.test/*` })) };
  const retention: Desired = { version: 1, tenants: {} }, connectors: Desired = { version: 1, tenants: {} }, oidc: Desired = { version: 1, tenants: {} };
  for (const tenant of brands) {
    retention.tenants[tenant] = Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(k => [k, { ...approved }]));
    const telemetry: Desired = { environment: 'staging', schema: 'ops-v1', analytics: { binding: 'ANALYTICS', dataset: d.resources.analytics, accessPolicy: 'approved-analytics' },
      monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'approved-monitor' },
      alert: { binding: 'ALERT_WEBHOOK_URL', destination: 'approved-alert', urlSha256: stampSha256(d.secrets.ALERT_WEBHOOK_URL), accessPolicy: 'approved-alert' } };
    connectors.tenants[tenant] = { telemetry };
    for (const kind of ['analytics', 'monitor', 'alert']) retention.tenants[tenant][`telemetry.${kind}.${stampSha256(stampCanonical({ tenant, environment: 'staging', schema: 'ops-v1', ...telemetry[kind] }))}`] = { ...approved };
    oidc.tenants[tenant] = { ...OIDC_PROVIDER(tenant), origin: `https://${tenant}.example.test/` };
    d.secrets[`OPERATOR_OIDC_SECRET_${tenant.toUpperCase()}`] = `${tenant}-oidc-client-secret-material-0123456789`;
  }
  Object.assign(d.vars, { RETENTION: JSON.stringify(retention), TENANT_CONNECTORS: JSON.stringify(connectors), OPERATOR_OIDC: JSON.stringify(oidc) });
  return d;
}
const transition = (desired: Desired, previous: Desired) => { try { validateTransition('add-brand', desired, previous); return 'accepted'; } catch { return 'refused'; } };

describe('unit:W37.T3', () => {
  it('logic: the workflow\'s add-brand transition accepts initech beside the two non-default brands, and refuses every change that rebinds acme or globex — its host, origin, route, site key, identity secret, retention, telemetry, OIDC provider, its presence, or its position (the default flag)', () => {
    const current = desiredStamp([ACME, GLOBEX]), added = desiredStamp([ACME, GLOBEX, INITECH]);
    expect(validateDesired(current), 'a stamp of two non-default brands is a valid desired state').toEqual(current);
    expect(transition(added, current), 'initech added after the existing brands, with its own material, is accepted').toBe('accepted');
    const rebinding: Array<[string, (d: Desired) => void]> = [
      ['acme\'s host moves to initech', d => { d.tenants.hosts[`${ACME}.example.test`] = INITECH; }],
      ['globex\'s origin is dropped', d => { d.origins = d.origins.filter((o: string) => !o.includes(GLOBEX)); }],
      ['acme\'s route is dropped', d => { d.routes = d.routes.filter((r: { pattern: string }) => !r.pattern.startsWith(ACME)); }],
      ['acme\'s site key changes', d => { d.secrets.SDK_KEYS = d.secrets.SDK_KEYS.replace(`${ACME}:${ACME}-`, `${ACME}:rotated-`); }],
      ['globex\'s identity secret changes', d => { d.secrets.IDENTITY_SECRETS = d.secrets.IDENTITY_SECRETS.replace(`${GLOBEX}:${GLOBEX}-`, `${GLOBEX}:rotated-`); }],
      ['acme\'s profile retention changes', d => { const r = JSON.parse(d.vars.RETENTION); r.tenants[ACME].profile.durationMs = 7; d.vars.RETENTION = JSON.stringify(r); }],
      ['globex\'s telemetry descriptor changes', d => { const c = JSON.parse(d.vars.TENANT_CONNECTORS); c.tenants[GLOBEX].telemetry.monitor.accessPolicy = 'changed'; d.vars.TENANT_CONNECTORS = JSON.stringify(c); }],
      ['acme\'s OIDC provider changes', d => { const o = JSON.parse(d.vars.OPERATOR_OIDC); o.tenants[ACME].clientId = 'rebound'; d.vars.OPERATOR_OIDC = JSON.stringify(o); }],
      ['globex is removed', d => { d.tenants.provisioned = d.tenants.provisioned.filter((t: string) => t !== GLOBEX); }],
      ['initech is inserted before acme, taking acme\'s default position', d => { d.tenants.provisioned = [INITECH, ACME, GLOBEX]; }],
    ];
    for (const [label, rebind] of rebinding) {
      const desired = structuredClone(added); rebind(desired);
      expect(transition(desired, current), `W37.T3 — add-brand must refuse: ${label}`).toBe('refused');
    }
  });

  it('host: the runtime bound from the stamp before and after the add serves acme and globex side by side — each site key admits its own brand only, and the brand list keeps acme first and default', async () => {
    const operator = await new SignJWT({ sub: 'w37-operator', type: 'service', roles: ['operator'], permissions: ['read'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    for (const desired of [desiredStamp([ACME, GLOBEX]), desiredStamp([ACME, GLOBEX, INITECH])]) {
      const brands = desired.tenants.provisioned as string[];
      const h = host('session', { tenants: brands, enforced: true, sdkKeys: desired.secrets.SDK_KEYS as string });
      // The binding the workflow writes (scripts/stamp-workflow.mjs:900), with the operator's grant beside it.
      Object.assign(h.env, { TENANTS: JSON.stringify({ ...JSON.parse(stampCanonical(desired.tenants)), operatorGrants: { 'w37-operator': brands } }) });
      for (const brand of [ACME, GLOBEX]) {
        await publish(h, brand);
        const grant = await newAnonymousSession(h.env, brand);
        for (const keyOwner of [ACME, GLOBEX]) {
          const response = await h.call('/realtime/reflex', { grant, tenant: brand, headers: { 'X-SDK-Key': `${keyOwner}-${STAMP_MATERIAL}` } });
          if (keyOwner === brand) expect(response.status, `${brands.length} brands: ${brand}'s own key admits ${brand}`).toBe(200);
          else expect(await response.json(), `${brands.length} brands: ${keyOwner}'s key never admits ${brand}`).toEqual({ ok: false, error: 'SDK key is for a different tenant' });
        }
      }
      const listed = await h.call(`/v1/${ACME}/brands`, { tenant: ACME, headers: { Authorization: `Bearer ${operator}` } });
      expect(await listed.json(), `${brands.length} brands: manifest order, acme default`).toMatchObject({ ok: true, brands: brands.map((id, index) => ({ id, default: index === 0 })) });
      await h.drain();
    }
  });
});

// ===========================================================================
// unit:W37.T4 — one tenant's load and state never reach another tenant's
// physical store.
//
// "Shared-load isolation" (doc 35 W37) with F03's "tests that inspect the
// destination namespace": the same browser (one subject, one session id) is a
// consenting shopper of both non-default tenants, globex first. Then acme's whole
// load runs — events with the kit's taxonomy (including an unknown category and a
// cross-category occasion list) under server geography, every owned read, a
// manual segment, a product sort, a content snapshot — followed by the background
// work that load creates: the queue consumer (src/ledger/consume.ts:89), the
// shopper object's alarm, the regional object's publication and the hourly trend
// roll-up. Every physical key written and every object addressed must name acme
// as a whole segment and never globex; every queued envelope is acme's; and
// globex's KV, R2 and object bytes are unchanged. With no default tenant
// registered, an unprefixed key would be the default namespace — a leak too.
// ===========================================================================

describe('unit:W37.T4', () => {
  it('host: on both hosts, acme\'s load and its background work write and address only acme\'s physical names and leave globex\'s stores byte-for-byte unchanged', async () => {
    for (const kind of ['session', 'do'] as const) {
      invalidateCache(); invalidateTrendCache();
      const h = host(kind); await publish(h, ACME); await publish(h, GLOBEX);
      const a = await newAnonymousSession(h.env, ACME);
      const b = await issueSessionCapability(h.env, { tenant: GLOBEX, subject: a.subject, sessionId: a.sessionId, kind: 'anonymous' });
      const cf = { country: 'US', regionCode: 'NY' };
      const load = async (g: typeof a) => {
        await choose(h, g, true, true);
        const steps: Array<[string, unknown]> = [
          ['/realtime/action', { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: TABBY_VIEW }],
          ['/realtime/action', { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: UNKNOWN_VIEW }],
          ['/realtime/action', { type: 'custom', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: { event: 'content_click', contentType: 'video' } }],
          ['/realtime/reflex', undefined], [`/realtime/segments/${g.subject}`, undefined], [`/realtime/segments/${g.subject}`, { segment: 'w37-manual' }],
          [`/realtime/personalization/${g.subject}`, undefined],
          ['/sort', { userId: g.subject, sessionId: g.sessionId, candidates: [{ id: 'tabby', line: 'Tabby' }, { id: 'rogue', line: 'Rogue' }, { id: 'unfiled', line: 'Unfiled' }] }],
          [`/v1/${g.tenant}/decisions/snapshot?page=home`, undefined],
        ];
        for (const [path, body] of steps) expect((await h.call(path, { grant: g, tenant: g.tenant, body, cf })).status, `${kind} ${g.tenant} ${path}`).toBe(200);
        await h.drain();
        expect((await consumeLedger(h.env, h.queued.splice(0))).ok, `${kind} ${g.tenant}: the queue consumer stores the load's ledger`).toBe(true);
        const shopper = h.restart('SHOPPER_REFLEX', shopperObjectName(g.tenant, g.subject)); shopper.alarms.length = 0;
        await (shopper.instance as ShopperReflex).alarm();
        await (h.restart('REGION_TREND', regionObjectName(g.tenant, 'US-NY')).instance as RegionTrend).alarm();
        await rollupTenant(h.env, g.tenant);
        await h.drain();
      };
      await load(b);
      const globexState = () => ({
        kv: [...h.cache.data, ...h.sessions.data].filter(([key]) => names(GLOBEX)(key)),
        r2: [...h.storage.data].filter(([key]) => names(GLOBEX)(key)),
        objects: [...h.objects].filter(([id]) => names(GLOBEX)(id)).map(([id, item]) => [id, structuredClone([...item.data])]),
      });
      const before = globexState();
      expect(before.kv.length + before.r2.length + before.objects.length, `${kind}: globex holds state of its own to protect`).toBeGreaterThan(0);
      h.writes.length = 0; h.addressed.length = 0;
      const envelopes: unknown[] = []; const send = h.env.EVENT_QUEUE.send.bind(h.env.EVENT_QUEUE);
      h.env.EVENT_QUEUE.send = (async (body: unknown) => { envelopes.push(body); return send(body as never); }) as never;
      await load(a);

      const physical = [...h.writes.filter(w => w.store !== 'DB'), ...h.addressed].map(w => `${w.store} ${w.key}`);
      // Another tenant's store is any name carrying globex; the default tenant's store is any KV key or
      // object name outside acme's (src/tenancy/tenant.ts:163-166, objects.ts:43-45). Stamp-level R2
      // bookkeeping that names no tenant (the delivery identities of src/ledger/writer.ts:250) is neither.
      const leaks = (names: string[]) => names.filter(name => {
        const store = name.slice(0, name.indexOf(' ')), key = name.slice(name.indexOf(' ') + 1);
        return segments(key).includes(GLOBEX) || (store !== 'STORAGE' && !segments(key).includes(ACME));
      });
      expect(physical.length, `${kind}: acme's load did physical work`).toBeGreaterThan(0);
      expect(leaks(physical), `W37.T4 — ${kind}: no key acme's load writes and no object it addresses is globex's or the default tenant's`).toEqual([]);
      expect(envelopes.map(e => (e as { record?: { tenant?: string } }).record?.tenant), `W37.T4 — ${kind}: every queued envelope is acme's`).toEqual(envelopes.map(() => ACME));
      expect(globexState(), `W37.T4 — ${kind}: globex's stores are unchanged by acme's load`).toEqual(before);
      // CONTROL: the same detector reports a write into globex's namespace and an unprefixed (default-namespace) write.
      expect(leaks([`SESSIONS t:${GLOBEX}:session:${a.sessionId}`, `CACHE session:${a.sessionId}`]), 'the leak detector is not vacuous').toHaveLength(2);
    }
  });
});

// ===========================================================================
// unit:W37.T6 — the owed regression units W37.BASE.03, .04 and .05.
// Witnesses: LANE-LOG R52(a), R58 (the register entries), R46(g)/(i) (the
// re-arm), R28 (typed refusals); frozen, evidence only.
// ===========================================================================

describe('unit:W37.T6', () => {
  it('host: W37.BASE.03 — on the object host, /realtime/segments GET and POST answer 401 for a refusing shopper whose stored audienceOwner names another session, and write nothing; with her own owner the refusal projection answers 200-empty and 403', async () => {
    invalidateCache();
    const h = host('do'); await publish(h, ACME);
    const g = await newAnonymousSession(h.env, ACME); await choose(h, g, true, true);
    expect((await h.call('/realtime/action', { grant: g, tenant: ACME, body: { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: TABBY_VIEW } })).status).toBe(200);
    await h.drain();
    await choose(h, g, false, false); // she refuses
    const name = shopperObjectName(ACME, g.subject), item = h.item('SHOPPER_REFLEX', name)!;
    expect(item.data.get('audienceOwner'), 'the consenting action bound her own audience owner').toEqual({ tenant: ACME, subject: g.subject, sessionId: g.sessionId });
    const read = async () => { h.restart('SHOPPER_REFLEX', name);
      const get = await h.call(`/realtime/segments/${g.subject}`, { grant: g, tenant: ACME });
      const post = await h.call(`/realtime/segments/${g.subject}`, { grant: g, tenant: ACME, body: { segment: 'w37-manual' } });
      return { get: { status: get.status, body: await get.json() }, post: { status: post.status, body: await post.json() } }; };
    let before = structuredClone([...item.data]);
    expect(await read(), 'control: her own owner — the refusal projection').toMatchObject({ get: { status: 200, body: { userId: g.subject, segments: [] } },
      post: { status: 403, body: { ok: false, error: 'Shopper consent refused segment assignment' } } });
    expect([...item.data]).toEqual(before);
    item.data.set('audienceOwner', { tenant: ACME, subject: g.subject, sessionId: 'w37-another-session' });
    before = structuredClone([...item.data]);
    expect(await read(), 'W37.BASE.03 — a mismatched audienceOwner answers 401 on both verbs').toEqual({
      get: { status: 401, body: { ok: false, error: 'Shopper session unavailable' } }, post: { status: 401, body: { ok: false, error: 'Shopper session unavailable' } } });
    expect([...item.data], 'W37.BASE.03 — and writes nothing').toEqual(before);
  });

  it('host: W37.BASE.04 — on the object host, an alarm refused for an absent configuration authority re-arms the retention deadline when retention is the strict minimum, and writes nothing', async () => {
    invalidateCache();
    // A seven-day profile policy puts the retention expiry before the 30-day consent expiry (src/content/consent.ts:17).
    const h = host('do', { retention: retentionFor([ACME, GLOBEX], policy(7 * DAY)) }); await publish(h, ACME);
    const g = await newAnonymousSession(h.env, ACME); await choose(h, g, true, true);
    expect((await h.call('/realtime/action', { grant: g, tenant: ACME, body: { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: TABBY_VIEW } })).status).toBe(200);
    await h.drain();
    const name = shopperObjectName(ACME, g.subject), item = h.item('SHOPPER_REFLEX', name)!;
    const retention = (item.data.get('affinity') as AffinityRecord).retention!.expiresAt;
    const consent = item.data.get('consent') as ConsentInstruction;
    const consentExpiry = Math.min(...CONSENT_SWITCHES.flatMap(key => consent[key] ? [consent[key]!.chosenAt + CONSENT_LIFETIME_MS] : []));
    expect(retention, 'precondition: the retention expiry is the strict minimum').toBeLessThan(consentExpiry);
    // The configuration publication authority is withdrawn (src/config/publication.ts:19); the harness consumes the fired alarm as workerd does.
    for (const key of [...h.storage.data.keys()]) if (key.startsWith(`config-publication/v2/${publicationScope(REFLEX_KIND, reflexScopeForTenant(ACME))}/`)) h.storage.data.delete(key);
    invalidateCache();
    const before = structuredClone([...item.data]); item.alarms.length = 0;
    await expect((h.restart('SHOPPER_REFLEX', name).instance as ShopperReflex).alarm(), 'R28: the refusal is typed')
      .rejects.toSatisfy((error: unknown) => error instanceof PublicationError || error instanceof ReflexConfigUnavailableError);
    expect(item.alarms.at(-1), 'W37.BASE.04 — the refused alarm re-arms the retention deadline (R46(g))').toBe(retention);
    expect([...item.data], 'W37.BASE.04 — and writes nothing else').toEqual(before);
  });

  it('native: W37.BASE.05 — in workerd, with the configuration authority withdrawn, the object host answers every shopper route with the typed refusal reason, as the session host does', async () => {
    const reason = 'Coherent configuration publication is uninitialized';
    for (const reflexHost of ['session', 'do']) {
      const stamp = await nativeStamp(`w37base05${reflexHost}`, { REFLEX_HOST: reflexHost, TENANTS: registry([ACME, GLOBEX]), RETENTION: retentionFor([ACME, GLOBEX]) });
      try {
        await stamp.door('/publish', stamp.documents(ACME));
        const g = await stamp.door('/grant', { tenant: ACME }) as unknown as Awaited<ReturnType<typeof newAnonymousSession>>;
        const shopper = (path: string, body?: unknown) => stamp.runtime.fetch(`https://shop.acme.example${path}`, { method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant': ACME, [SHOPPER_HEADER]: g.capability }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        expect((await shopper(`/realtime/session/${g.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
          choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } })).status, `${reflexHost}: explicit choice`).toBe(200);
        const event = { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: TABBY_VIEW };
        expect((await shopper('/realtime/action', event)).status, `${reflexHost}: served while the authority stands`).toBe(200);
        await stamp.door('/unpublish', { tenant: ACME });
        for (const [path, body] of [['/realtime/action', event], ['/realtime/reflex', undefined], [`/realtime/personalization/${g.subject}`, undefined],
          [`/realtime/segments/${g.subject}`, undefined], ['/sort', { userId: g.subject, sessionId: g.sessionId, candidates: [{ id: 'tabby', line: 'Tabby' }] }],
          [`/v1/${ACME}/decisions/snapshot?page=home`, undefined]] as const) {
          const response = await shopper(path, body), text = await response.text();
          expect(response.status, `${reflexHost} ${path}: refused`).toBeGreaterThanOrEqual(500);
          expect(response.headers.get('content-type'), `W37.BASE.05 — ${reflexHost} ${path}: a JSON refusal, never a bare text 500`).toContain('application/json');
          expect(text, `W37.BASE.05 — ${reflexHost} ${path}: the answer names the typed refusal reason`).toContain(reason);
        }
        expect(stamp.runtime.outboundAttempts(), 'no request reached the network').toBe(0);
      } finally { await stamp.close(); }
    }
  }, 240_000);
});
