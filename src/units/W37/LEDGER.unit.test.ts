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

import { describe, it, expect, vi } from 'vitest';
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
import { initializePublicationSet, publicationScope, PublicationError, PUBLICATION_CACHE_MS, type PublicationBaseline } from '@/config/publication';
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
import { signAssertion } from '@/identity/assertion';
import { isShopperId } from '@/identity/shopperId';
import { customerRequest } from '@/customerBoundary';
import { memoryStore, type AuditRow } from '@/auth/store';
import { operatorJwt } from '@/middleware/operatorAuth';
import { catchUp } from '@/learn/hourly';
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
// to waitUntil awaited, read stored objects back, and move the runtime's clock
// forward (standing in for a real wait of that long: installed only when a leg
// asks, and never moved back).
// ===========================================================================

const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { newAnonymousSession } from './src/identity/sessionCapability.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
let clockAdvance = 0, clockInstalled = false;
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
    if (url.pathname === '/clock') {
      if (!(Number.isSafeInteger(input.advanceMs) && input.advanceMs > 0)) return new Response(null, { status: 400 });
      if (!clockInstalled) { const wall = Date.now.bind(Date); Date.now = () => wall() + clockAdvance; clockInstalled = true; }
      clockAdvance += input.advanceMs;
      return Response.json({ advancedMs: clockAdvance });
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
  queue(batch, env, ctx) { return worker.queue(batch, env, ctx); },
};`;

let nativeBundle: Promise<string> | undefined;
/**
 * R-P615 (R10 by name, unit:P104.RF1): the queue binding the shipped configuration declares for the fold's steps
 * (wrangler.toml [[queues.producers]] EVENT_QUEUE → "events"; [[queues.consumers]] "events": max_batch_size 100,
 * max_batch_timeout 3, max_retries 2, dead_letter_queue "events-dead-letter"), declared for the five-minute fold's legs.
 */
/**
 * R-P632 (R10 by name): the queue's deliveries awaited, bounded, before the stored objects are read — the stored
 * aggregates and days unchanged across 7 s (more than two hops at the shipped max_batch_timeout of 3 s), at most 90 s.
 */
async function delivered(door: (path: string, body?: unknown) => Promise<Record<string, unknown>>): Promise<void> {
  const view = async () => JSON.stringify(Object.entries({ ...await door('/objects', { prefix: 'aggregates/' }), ...await door('/objects', { prefix: 'reports/' }) })
    .map(([key, body]) => [key, String(body).length]).sort());
  const started = Date.now();
  let last = await view(), since = Date.now();
  while (Date.now() - started < 90_000 && Date.now() - since < 7_000) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const now = await view();
    if (now !== last) { last = now; since = Date.now(); }
  }
}
const SHIPPED_EVENTS_QUEUE = { queueProducers: { EVENT_QUEUE: 'events' },
  queueConsumers: { events: { maxBatchSize: 100, maxBatchTimeout: 3, maxRetries: 2, deadLetterQueue: 'events-dead-letter' } } };
async function nativeStamp(name: string, bindings: Record<string, string>, options: { queue?: boolean } = {}) {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'w37-ledger-native'));
  const directory = nativeScratchDirectory('w37-ledger-native-');
  const runtime: NativeRuntime = await openNativeRuntime({
    bundle, name, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket',
      DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', JWT_SECRET: SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', ...bindings },
    ...(options.queue ? SHIPPED_EVENTS_QUEUE : {}),
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
    const stamp = await nativeStamp('w37t2fold', { REFLEX_HOST: 'do', TENANTS: registry([ACME, GLOBEX]), RETENTION: day.retention }, { queue: true });
    try {
      for (const tenant of [ACME, GLOBEX]) await stamp.door('/publish', stamp.documents(tenant));
      await stamp.door('/seed', { objects: day.objects });
      const folded = `aggregates/${ACME}/${day.date}/${new Date(day.hour).toISOString().slice(11, 13)}.json`;
      // Two closed hours per run, oldest first (src/learn/hourly.ts:1750-1800): run until the data hour is folded.
      for (let run = 0; run < 14 && !Object.hasOwn(await stamp.door('/objects', { prefix: folded }), folded); run++) { await stamp.door('/scheduled', { cron: '*/5 * * * *' }); await delivered(stamp.door); }
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
        // Refreshed arrangement (W19 LG1, 6219c50): the shopper path serves from the bounded
        // publication cache, and "a verified cached set can serve until expiry"
        // (docs/kit/02-api-reference.md:709; src/config/publication.ts:8, :344). The withdrawal
        // is observed once the set the action above cached has expired: the runtime's clock
        // moves PUBLICATION_CACHE_MS forward, as a real wait of that long would.
        await stamp.door('/clock', { advanceMs: PUBLICATION_CACHE_MS });
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

// ===========================================================================
// unit:W37.T5 — per-shopper export and erasure for shoppers of two non-default
// brands, reaching every store that holds that tenant's shopper data.
//
// AUTHORITY: document 35 §5 row W37 (:444) "… complete export/erasure", ruled by
// the owner as decision D2 (2026-09-24, row A32): "per-shopper export and
// erasure proven for two non-default brands across every store holding that
// tenant's shopper data; whole-tenant offboarding is not built". F31 (:231):
// "Prove two non-default brands across event, decision, identity, sort, egress
// and erasure."
//
// THE INTERFACES: the documented ones, and the one export route the lead ruled:
//   · erasure — operator `POST /v1/{tenant}/identity/erase` with the subject
//     selector, resumed with the same selector until it is no longer pending
//     (docs/kit/02-api-reference.md:42); the ledger half's scheduled rewrite
//     "walks the tenant's partition newest day first from the erasure day back"
//     the NEXT night and "never touches a day that is not over" (doc 22 §15,
//     src/ledger/erasure.ts:1-19), run here through its route
//     (`POST ledger/erasures/rewrite`, kit :585) at the 03:00 cron's hour of the
//     next day, with the hourly fold (`catchUp`, the five-minute cron,
//     src/index.ts:271) and the shopper objects' alarms the erasure arms
//     (src/durable-objects/ShopperReflex.ts:2063);
//   · export — the per-shopper operator reads (kit §3 `GET identity/visitor`,
//     `GET identity/shopper`; kit §5 `GET visitors/{id}/receipts`, `/recent`,
//     `GET ledger/{id}`, `GET ledger/batches` with each stream, kit :176) and
//     the R2 partition they list, which "is the export" (doc 22 §12.4); the
//     same list the privacy sweep names as the subject reads and exports
//     (35-verification-reports/sweep-data-privacy-and-lifecycle.md:341-348) —
//     and, for the stores no documented read returns, the ruled
//     `POST identity/export` below, which answers all of it at once.
//
// THE STORES MEASURED (every binding of the mounted host that can hold a
// shopper's data): KV SESSIONS (session, user pointer, identity links), KV
// CACHE (the session host's profile copy), R2 STORAGE (the ledger partition's
// decision, outcome, product-sort and behavior streams; the hourly fold's shard
// rings and hour aggregates; the day reports; the managed delivery claims and
// identities; the erasure records), and the Durable Objects SHOPPER_REFLEX
// (profile, consent, segments, recovery journal, grants), DECISION_RING (the
// visitor ring and credit plans), LEARN_STATS (learning effects) and
// REGION_TREND (aggregate only). NOT measured here: the queue's in-flight
// copies (transport; every consumer write re-reads the tombstones,
// src/ledger/writer.ts:246), and the stores the kit keeps outside local erasure
// — Analytics Engine datasets, worker logs, ODP and other external destinations,
// tenantless historical D1 — which the erasure reaches only as frozen
// reconciliation obligations (kit :42); the unit reads that inventory back.
// D1's audit rows in enforced mode carry keyed references only
// (src/auth/subjectAudit.ts:177-181) and are the accountability record N13 asks for.
//
// THE TENANTLESS DELIVERY IDENTITIES (`ledger-delivery/identities/{uuid}.json`,
// src/ledger/writer.ts:250) name no tenant and hold `{version, id, digest,
// count}` only — a random delivery id, a row count and a SHA-256 over the whole
// delivery ("immutable claims contain no raw records", writer.ts:95). Erasure
// reaches them without deleting them: each is attributed to exactly one tenant
// by the claim `ledger-delivery/claims/{tenant}/…/{uuid}.json` that names the
// same id, the rewrite re-proves every surviving row against both
// (src/ledger/erasure.ts:344-388), and neither carries any identifier of the
// shopper. The unit asserts exactly that, before and after the erasure.
//
// WHAT AN ERASURE MAY LEAVE: its own records — the tombstone that stays the
// active suppression predicate and the job/obligation/source records under
// `erasures/{tenant}/` (doc 22 §15; kit :42 "Obligations survive local
// compaction"), and the shopper object's erasure receipts and barriers
// (`identityErasure:`, `identitySourceErasure:`, `identitySessionErasure:`,
// `identityRetired:`). Nothing else of that tenant may still carry her
// identifiers.
//
// THE RULED EXPORT SURFACE (lead ruling 2026-09-24, an interface choice under D2
// "every store"): `POST /v1/{tenant}/identity/export`, with the erase route's
// selector (`{ visitorId?, shopperId? }`, at least one), operator authentication
// and tenant scope. It answers that shopper's data from every store the erasure
// reaches — her SHOPPER_REFLEX `affinity`, `consent` and `pipeline`, her SESSIONS
// `t:{tenant}:session:*` and CACHE `t:{tenant}:profile:*` records, and what the
// documented operator reads above already return — for shoppers of two
// non-default brands, never another tenant's or brand's data, and nothing of
// hers after her erasure. The shopper-facing read still never carries the
// account id (kit 02 :350, src/identity/store.ts:14, locked by
// src/routes/identity.test.ts:552). The erasure's reach decides the subject:
// a browser selector resolves to its person and every browser linked to her
// (src/identity/erase.ts:425-431), so both selectors answer the same person.
// The export legs require each ruled datum AS STORED (or, for a documented
// read, as that read returns it) somewhere in the answer, at any depth and
// under any name: the ruling names the records, not a projection of them. A
// KV record may be answered as its stored text or as the parsed object. The
// route is reachable on a customer stamp only if the customer surface admits
// it as it admits the erase route (src/customerBoundary.ts:96, the logic leg).
//
// THE EXPORT'S AUDIT (lead ruling 2026-09-24, completing "mirroring the erase
// route"): the erase route runs through `auditedSubjectOperation`
// (src/routes/identity.ts:536), so the export is audited the same way. In
// enforced mode — the only mode that audits (src/auth/subjectAudit.ts:176; kit
// 02 :573 "valid open/demo operations remain unaudited") — a successful export
// writes the entries the erase writes for the same selector at the same tenant:
// the minimized `subject_operation` v2 records of the tenant-admin audit view
// (kit 02 :573, `GET /v1/{tenant}/audit`), one admitted and one result, with the
// erase's action, tenant, actor, members, selector (its kind and keyed
// references) and subject reference, named for the export (operation and route);
// a refused export writes what a refused erase writes and releases nothing of
// hers. The erase itself is measured as the witness in the same world, never
// transcribed. A control shows the leg fails for an export that answers her
// correctly but writes no audit entry.
//
// THE FIXTURE: one browser shops both non-default brands, acme and globex, the
// day before (the kit's Coach taxonomy with an unknown category and a
// cross-category occasion list; a rendered decision, its impression and a
// click; a purchase; a manual segment; a product sort), then signs in at each
// brand with the same account id, and shops once more as the linked shopper.
// Slot `hero` measures on the rendered basis with durable recovery (kit :270),
// so the decision stream is written through the managed delivery path.
// ===========================================================================

const T5_RETENTION = JSON.stringify({ version: 1, tenants: Object.fromEntries([ACME, GLOBEX].map(tenant => [tenant, { ...categories(), recovery: policy(), quarantine: policy() }])) });
const T5_LEARN = (tenant: string) => ({ holdout: { share: 0, salt: `w37-${tenant}`, arms: ['default'] }, slots: { hero: { reward: 'click', measurementBasis: 'rendered-v1' } } });
const T5_ACCOUNT = 'w37-person-account-0042';
const T5_STREAMS = ['decision', 'outcome', 'product-sort', 'behavior'] as const;
/** The shopper object's erasure receipts and barriers (src/durable-objects/ShopperReflex.ts:1995-2028). */
const ERASURE_RECEIPT = /^(identityErasure|identitySourceErasure|identitySessionErasure|identityRetired):/;

interface T5Answer { status: number; body: Record<string, any> }
interface T5Shopper { tenant: string; visitorId: string; sessionId: string; grantIds: string[]; shopperId: string; linkedSessionId: string; orderId: string; decisions: { visitor: string; shopper: string } }

async function t5World(kind: 'session' | 'do') {
  invalidateCache(); invalidateTrendCache();
  // One calendar, fixed before the clock moves: served yesterday at noon, erased today at noon, rewritten at 03:00 tomorrow.
  const today = Math.floor(Date.now() / DAY) * DAY, served = today - DAY + 12 * 3_600_000, erasedAt = today + 12 * 3_600_000, night = today + DAY + 3 * 3_600_000;
  vi.setSystemTime(served);
  const h = host(kind, { retention: T5_RETENTION, extra: { LEDGER_RECOVERY_ENABLED: 'true', IDENTITY_SALT: 'w37-ledger-synthetic-identity-salt',
    IDENTITY_SECRETS: `${ACME}:${ACME}-identity-material,${GLOBEX}:${GLOBEX}-identity-material` } });
  for (const tenant of [ACME, GLOBEX]) {
    const documents = publicationFor(tenant);
    documents[3] = { ...documents[3]!, revision: { ...documents[3]!.revision, value: T5_LEARN(tenant) } };
    await initializePublicationSet(h.env, documents, '0:' + crypto.randomUUID());
  }
  const cf = { country: 'US', regionCode: 'NY' };
  const browser = await newAnonymousSession(h.env, ACME);
  type Grant = typeof browser;
  const shop = async (tenant: string): Promise<T5Shopper> => {
    const g: Grant = tenant === ACME ? browser : await issueSessionCapability(h.env, { tenant, subject: browser.subject, sessionId: browser.sessionId, kind: 'anonymous' }) as Grant;
    await choose(h, g, true, true);
    const act = async (grant: Grant, type: string, data: Record<string, unknown>) => {
      const response = await h.call('/realtime/action', { grant, tenant, cf, body: { type, userId: grant.subject, sessionId: grant.sessionId, source: 'sdk', timestamp: Date.now(), eventId: crypto.randomUUID(), data } });
      const text = await response.text(); expect(response.status, `${kind} ${tenant} ${type}: ${text}`).toBe(200); // G21 class (R-P108(2)): the body is read once; a read clone collected by GC during the drain cancels the original's body under Node's undici ("Body is unusable")
      await h.drain();
      return JSON.parse(text) as Record<string, unknown>;
    };
    const page = async (grant: Grant, pageInstance: string) => {
      const response = await h.call(`/v1/${tenant}/decisions/snapshot?page=home&pageInstance=${pageInstance}`, { grant, tenant, cf });
      const piece = (await response.json() as { decisions?: Array<{ contentId: string; decisionId: string; renderOffer?: string }> }).decisions?.[0];
      await h.drain();
      expect(piece?.renderOffer, `${kind} ${tenant}: the rendered basis offers an acknowledgement`).toBeTruthy();
      const ack = await act(grant, 'content_impression', { contentId: piece!.contentId, decisionId: piece!.decisionId, renderOffer: piece!.renderOffer, page: 'home', pageInstance, slot: 'hero', position: 0 });
      expect(ack.render, `${kind} ${tenant}: the render is durably acknowledged`).toMatchObject({ version: 1, decisionId: piece!.decisionId, status: 'durable' });
      await act(grant, 'content_click', { contentId: piece!.contentId, slot: 'hero', decisionId: piece!.decisionId, contentType: 'editorial' });
      return piece!.decisionId;
    };
    await act(g, 'product_view', TABBY_VIEW);
    await act(g, 'product_view', UNKNOWN_VIEW);
    const visitorDecision = await page(g, `w37-t5-${tenant}-anonymous`);
    const orderId = `W37-${tenant.toUpperCase()}-ORDER-7731`;
    await act(g, 'purchase', { orderId, value: 395, currency: 'USD', items: [{ productId: TABBY_VIEW.productId, quantity: 1, price: 395 }] });
    for (const [path, body] of [[`/realtime/segments/${g.subject}`, { segment: 'w37-manual' }], [`/realtime/personalization/${g.subject}`, undefined],
      ['/sort', { userId: g.subject, sessionId: g.sessionId, candidates: [{ id: 'tabby', line: 'Tabby' }, { id: 'rogue', line: 'Rogue' }, { id: 'unfiled', line: 'Unfiled' }] }]] as Array<[string, unknown]>) {
      const response = await h.call(path, { grant: g, tenant, body, cf });
      expect(response.status, `${kind} ${tenant} ${path}: ${await response.clone().text()}`).toBe(200);
    }
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const linked = await h.call(`/v1/${tenant}/identity/link`, { grant: g, tenant, body: { visitorId: g.subject, accountId: T5_ACCOUNT, exp,
      assertion: await signAssertion(`${tenant}-identity-material`, tenant, g.subject, T5_ACCOUNT, exp) } });
    const link = await linked.json() as { shopperId: string; session: Grant };
    expect(linked.status, `${kind} ${tenant}: the signed link`).toBe(200);
    await h.drain();
    await act(link.session, 'product_view', TABBY_VIEW);
    const shopperDecision = await page(link.session, `w37-t5-${tenant}-signed-in`);
    await h.drain();
    h.queued.length = 0; // transport copies of what the managed path already stored (not measured; see the banner)
    return { tenant, visitorId: g.subject, sessionId: g.sessionId, grantIds: [g.grantId!, link.session.grantId!], shopperId: link.shopperId,
      linkedSessionId: link.session.sessionId, orderId, decisions: { visitor: visitorDecision, shopper: shopperDecision } };
  };
  const shoppers = { [ACME]: await shop(ACME), [GLOBEX]: await shop(GLOBEX) } as Record<string, T5Shopper>;

  // The next day: the five-minute cron folds yesterday's closed hours.
  vi.setSystemTime(erasedAt);
  const fold = async (tenant: string) => {
    for (let run = 0; run < 16; run++) {
      const result = await catchUp(h.env.STORAGE as unknown as Parameters<typeof catchUp>[0], tenant, T5_LEARN(tenant) as unknown as Parameters<typeof catchUp>[2], Date.now(), {}, h.env);
      if (!result.built.length && !result.pending) break;
    }
  };
  for (const tenant of [ACME, GLOBEX]) await fold(tenant);

  const operatorToken = () => new SignJWT({ sub: 'w37-operator', type: 'service', roles: ['admin'], permissions: ['*'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
  const operator = async (tenant: string, path: string, body?: unknown): Promise<T5Answer> => {
    const response = await h.call(`/v1/${tenant}${path}`, { tenant, body, headers: { Authorization: `Bearer ${await operatorToken()}` } });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, any> };
  };

  /** Every identifier of her the stores could carry: browser, sessions, grants, person, account, order and every decision id. */
  const identifiers = (s: T5Shopper) => [s.visitorId, s.sessionId, ...s.grantIds, s.shopperId, T5_ACCOUNT, s.linkedSessionId, s.orderId, s.decisions.visitor, s.decisions.shopper];
  /** A physical name that belongs to no tenant: no registered tenant is one of its segments. */
  const tenantless = (name: string) => ![ACME, GLOBEX].some(tenant => segments(name).includes(tenant));
  /** Every physical entry of the tenant (and every tenantless entry) that carries one of her identifiers. */
  const holding = (tenant: string, s: T5Shopper) => {
    const ids = identifiers(s), found: Array<{ store: string; name: string; key: string }> = [];
    const carries = (text: string) => ids.some(id => text.includes(id));
    for (const [store, data] of [['CACHE', h.cache.data], ['SESSIONS', h.sessions.data], ['STORAGE', h.storage.data]] as const)
      for (const [key, value] of data) if ((names(tenant)(key) || tenantless(key)) && carries(key + '\n' + value)) found.push({ store, name: key, key });
    for (const [id, item] of h.objects) {
      if (!names(tenant)(id) && !tenantless(id)) continue;
      // An object is judged by what it stores: the platform keeps no name, only the id derived from it.
      for (const [key, value] of item.data) if (carries(key + '\n' + JSON.stringify(value))) found.push({ store: id.slice(0, id.indexOf('|')), name: id, key });
    }
    return found;
  };
  const erasureRecord = (tenant: string) => (entry: { store: string; name: string; key: string }) =>
    entry.store === 'STORAGE' ? entry.name.startsWith(`erasures/${tenant}/`) : entry.store === 'SHOPPER_REFLEX' && ERASURE_RECEIPT.test(entry.key);
  const tenantState = (tenant: string) => JSON.stringify({
    kv: [...h.cache.data, ...h.sessions.data].filter(([key]) => names(tenant)(key)).sort(),
    r2: [...h.storage.data].filter(([key]) => names(tenant)(key)).sort(),
    objects: [...h.objects].filter(([id]) => names(tenant)(id)).map(([id, item]) => [id, [...item.data].sort(([a], [b]) => a.localeCompare(b))]).sort(),
  });
  /** The tenantless delivery identities, each with the one tenant claim that names it (src/ledger/writer.ts:250, delivery.ts:206). */
  const identities = () => [...h.storage.data.keys()].filter(key => key.startsWith('ledger-delivery/identities/')).map(key => {
    const id = key.slice('ledger-delivery/identities/'.length, -'.json'.length);
    const claims = [...h.storage.data.keys()].filter(claim => claim.startsWith('ledger-delivery/claims/') && claim.endsWith(`/${id}.json`));
    return { key, value: h.storage.data.get(key)!, owners: [...new Set(claims.map(claim => claim.split('/')[2]))] };
  });
  /** The documented per-shopper export: every operator read of the person and her browser, and the listed partition objects. */
  const exported = async (tenant: string, s: T5Shopper, date: string) => {
    const visitor = await operator(tenant, `/identity/visitor/${s.visitorId}`);
    const person = await operator(tenant, `/identity/shopper/${s.shopperId}`);
    const each = async (ids: string[], path: (id: string) => string) => {
      const answers: Record<string, T5Answer> = {};
      for (const id of ids) answers[id] = await operator(tenant, path(id));
      return answers;
    };
    const receipts = await each([s.visitorId, s.shopperId], id => `/visitors/${id}/receipts`);
    const recent = await each([s.visitorId, s.shopperId], id => `/visitors/${id}/recent`);
    const records = await each([s.decisions.visitor, s.decisions.shopper], id => `/ledger/${encodeURIComponent(id)}`);
    const partition: Record<string, { status: number; rows: Array<Record<string, any>> }> = {};
    for (const stream of T5_STREAMS) {
      const listed = await operator(tenant, `/ledger/batches?date=${date}&stream=${stream}`);
      const rows = ((listed.body.objects ?? []) as Array<{ key: string }>).flatMap(object => (h.storage.data.get(object.key) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, any>));
      partition[stream] = { status: listed.status, rows };
    }
    return { visitor, person, receipts, recent, records, partition };
  };
  /** Her rows, straight from the tenant's partition in R2, per stream. */
  const partitionRows = (tenant: string, s: T5Shopper, stream: string) => [...h.storage.data].filter(([key]) => key.startsWith(`${tenant}/`) && key.split('/')[3] === stream)
    .flatMap(([, body]) => body.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, any>))
    .filter(row => row.visitor_id === s.visitorId || row.visitor_id === s.shopperId);
  const rowId = (row: Record<string, any>) => String(row.decision_id ?? row.outcome_id ?? row.record_id ?? row.behavior_id ?? row.event_id ?? JSON.stringify(row));

  /** Erase her through the documented route, then run the work the erasure schedules, the next night. */
  const erase = async (s: T5Shopper) => {
    let answer = await operator(s.tenant, '/identity/erase', { shopperId: s.shopperId });
    for (let resume = 0; answer.body.status === 'pending' && resume < 40; resume++) answer = await operator(s.tenant, '/identity/erase', { shopperId: s.shopperId });
    await h.drain();
    for (let round = 0; round < 3; round++) for (const [id, item] of h.objects) {
      if (!id.startsWith(`SHOPPER_REFLEX|${shopperObjectName(s.tenant, '')}`) || !item.alarms.length) continue;
      item.alarms.length = 0;
      await (h.restart('SHOPPER_REFLEX', id.slice('SHOPPER_REFLEX|'.length)).instance as ShopperReflex).alarm();
      await h.drain();
    }
    vi.setSystemTime(night); // the 03:00 cron of the next day
    const rewrites: Array<Record<string, any>> = [];
    for (let run = 0; run < 12; run++) {
      const rewrite = await operator(s.tenant, '/ledger/erasures/rewrite', {});
      expect(rewrite.status, `the rewrite route: ${JSON.stringify(rewrite.body)}`).toBe(200);
      rewrites.push(rewrite.body);
      if (!rewrite.body.more) break;
    }
    await fold(s.tenant);
    await h.drain();
    vi.setSystemTime(erasedAt);
    return { answer, rewrites };
  };

  /**
   * What the ruled export must answer for the person with these ids at this
   * tenant (lead ruling on D2): every value the documented operator reads return
   * for her, and every value the ruled store members hold for her — SHOPPER_REFLEX
   * `affinity`, `consent` and `pipeline` of each of her objects, SESSIONS
   * `t:{tenant}:session:*` and CACHE `t:{tenant}:profile:*` records whose subject
   * is one of her ids. Each entry is labelled with the store that holds it.
   */
  const exportTruth = async (tenant: string, ids: string[], date: string): Promise<T5Entry[]> => {
    const entries: T5Entry[] = [];
    const add = (store: string, member: string, value: unknown, raw?: string) => { if (value !== undefined && value !== null) entries.push({ store, member, value, ...(raw === undefined ? {} : { raw }) }); };
    for (const id of ids) {
      if (isShopperId(id)) {
        const person = await operator(tenant, `/identity/shopper/${id}`);
        if (person.status === 200) add('SESSIONS', `GET identity/shopper/${id}`, person.body.shopper);
      } else add('SESSIONS', `GET identity/visitor/${id} link`, (await operator(tenant, `/identity/visitor/${id}`)).body.link);
      // The receipts are read from her own ring (src/routes/decisions.ts:385-387), the record by id from R2.
      for (const receipt of (await operator(tenant, `/visitors/${id}/receipts`)).body.receipts ?? []) {
        add('DECISION_RING', `GET visitors/${id}/receipts ${receipt.decision_id}`, receipt);
        const record = await operator(tenant, `/ledger/${encodeURIComponent(receipt.decision_id)}`);
        if (record.status === 200) add('STORAGE', `GET ledger/${receipt.decision_id}`, record.body.record);
      }
      for (const entry of (await operator(tenant, `/visitors/${id}/recent`)).body.ring ?? []) add('DECISION_RING', `GET visitors/${id}/recent ${entry.decision_id}`, entry);
    }
    for (const stream of T5_STREAMS) for (const object of ((await operator(tenant, `/ledger/batches?date=${date}&stream=${stream}`)).body.objects ?? []) as Array<{ key: string }>)
      for (const line of (h.storage.data.get(object.key) ?? '').split('\n').filter(Boolean)) {
        const row = JSON.parse(line) as Record<string, any>;
        if (ids.includes(row.visitor_id)) add('STORAGE', `GET ledger/batches ${stream} ${object.key} ${rowId(row)}`, row);
      }
    for (const id of ids) {
      const name = shopperObjectName(tenant, id), object = h.item('SHOPPER_REFLEX', name);
      for (const key of ['affinity', 'consent', 'pipeline']) add('SHOPPER_REFLEX', `${name} ${key}`, object?.data.get(key));
    }
    for (const [store, data, prefix] of [['SESSIONS', h.sessions.data, `t:${tenant}:session:`], ['CACHE', h.cache.data, `t:${tenant}:profile:`]] as const)
      for (const [key, raw] of data) {
        if (!key.startsWith(prefix)) continue;
        const value = JSON.parse(raw) as { userId?: string };
        if (ids.includes(value?.userId ?? '')) add(store, key, value, raw);
      }
    return entries;
  };
  /** Her ids at a tenant: her person and every browser linked to her. */
  const personIds = (s: T5Shopper) => [s.visitorId, s.shopperId];
  const bearer = async () => `Bearer ${await operatorToken()}`;
  return { h, kind, served, shoppers, operator, bearer, identifiers, holding, erasureRecord, tenantState, identities, exported, partitionRows, rowId, erase, exportTruth, personIds };
}

interface T5Entry { store: string; member: string; value: unknown; raw?: string }

/** A value's canonical JSON: object keys sorted at every depth, array order kept. */
const canonical = (value: unknown) => JSON.stringify(value, (_key, v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v);
/** Every value an answer carries, at any depth and under any name, in canonical form. */
function carried(answer: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (value: unknown) => { seen.add(canonical(value)); if (value && typeof value === 'object') for (const child of Object.values(value)) walk(child); };
  walk(answer);
  return seen;
}
const carries = (seen: Set<string>, entry: T5Entry) => seen.has(canonical(entry.value)) || (entry.raw !== undefined && seen.has(canonical(entry.raw)));
/**
 * The ruled data an export answer omits: each entry of `before` (the stores and reads
 * just before the call) the answer carries neither as it was before nor as the same
 * member stands just after the call. Named `<store> <member>`.
 */
function exportGaps(answer: unknown, before: T5Entry[], after: T5Entry[]): string[] {
  const seen = carried(answer), now = new Map(after.map(entry => [`${entry.store} ${entry.member}`, entry]));
  return before.filter(entry => !carries(seen, entry) && !(now.has(`${entry.store} ${entry.member}`) && carries(seen, now.get(`${entry.store} ${entry.member}`)!)))
    .map(entry => `${entry.store} ${entry.member}`);
}
/** The entries of `theirs` an answer carries that are not also equal to an entry of `own`. */
function foreignCarried(answer: unknown, theirs: T5Entry[], own: T5Entry[]): string[] {
  const seen = carried(answer), mine = new Set(own.map(entry => canonical(entry.value)));
  return theirs.filter(entry => !mine.has(canonical(entry.value)) && carries(seen, entry)).map(entry => `${entry.store} ${entry.member}`);
}

/** A subject-audit row as the audit store keeps it (src/auth/store.ts:48), its detail parsed. */
interface AuditLine { id: number; action: string; tenant?: string; actorId?: string | null; detail: Record<string, any> }
const auditLines = (rows: AuditRow[]): AuditLine[] =>
  rows.map(row => ({ id: row.id, action: row.action, tenant: row.tenant, actorId: row.actorId, detail: (JSON.parse(row.detail ?? 'null') ?? {}) as Record<string, any> }));
/**
 * What an export's audit lacks against the erase's, for the same selector at the same tenant (lead ruling
 * 2026-09-24: the export is audited as the erase route is, src/routes/identity.ts:536). Phase by phase, the
 * erase's entries: the same action, tenant, actor, members, record version, method, selector and subject
 * reference; named for the export (its operation and its route); one request of the export's own; the result's
 * status the export's own answer; and no entry the erase does not write. Named `<phase>: <what>`.
 */
function exportAuditGaps(exported: { status: number; lines: AuditLine[] }, erased: { lines: AuditLine[] }): string[] {
  const gaps: string[] = [], request = exported.lines[0]?.detail.requestId;
  erased.lines.forEach((e, index) => {
    const x = exported.lines[index], phase = String(e.detail.phase);
    if (!x) { gaps.push(`${phase}: no subject-audit entry`); return; }
    const same = (what: string, mine: unknown, theirs: unknown) => {
      if (canonical(mine) !== canonical(theirs)) gaps.push(`${phase}: ${what} ${canonical(mine)}, where the erase writes ${canonical(theirs)}`);
    };
    same('action', x.action, e.action); same('tenant', x.tenant, e.tenant); same('actor', x.actorId, e.actorId);
    same('members', Object.keys(x.detail).sort(), Object.keys(e.detail).sort());
    for (const member of ['v', 'method', 'phase', 'selector', 'subjectRef']) same(member, x.detail[member], e.detail[member]);
    if (!/export/.test(String(x.detail.operation))) gaps.push(`${phase}: operation ${String(x.detail.operation)} is not named for the export`);
    const route = String(e.detail.route).replace(/\/erase$/, '/export');
    if (x.detail.route !== route) gaps.push(`${phase}: route ${String(x.detail.route)}, not the export's ${route}`);
    if (x.detail.requestId !== request || x.detail.requestId === e.detail.requestId) gaps.push(`${phase}: not one request of the export's own`);
    if (phase === 'result' && x.detail.status !== exported.status) gaps.push(`result: status ${String(x.detail.status)}, where the export answered ${exported.status}`);
  });
  for (const x of exported.lines.slice(erased.lines.length)) gaps.push(`${String(x.detail.phase)}: an entry the erase does not write (${x.action} ${String(x.detail.operation)})`);
  return gaps;
}

describe('unit:W37.T5', () => {
  for (const kind of ['session', 'do'] as const) {
    it(`host (${kind}): the per-shopper export of each non-default brand returns her own identity link, decisions, ring and every stream of the partition, never the other brand's, and nothing of her once she is erased`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await t5World(kind);
        const date = new Date(w.served).toISOString().slice(0, 10);
        for (const [tenant, other] of [[ACME, GLOBEX], [GLOBEX, ACME]] as const) {
          const s = w.shoppers[tenant]!, x = await w.exported(tenant, s, date);
          // identity links (SESSIONS)
          expect(x.visitor, `W37.T5 — ${kind} ${tenant}: the browser's link`).toMatchObject({ status: 200, body: { ok: true, tenant, visitorId: s.visitorId, shopperId: s.shopperId } });
          expect(x.person.status, `W37.T5 — ${kind} ${tenant}: the person`).toBe(200);
          expect(x.person.body.shopper.visitors.map((v: { visitorId: string }) => v.visitorId), `W37.T5 — ${kind} ${tenant}: the person's browsers`).toEqual([s.visitorId]);
          // decisions (R2 decision stream, DECISION_RING)
          for (const [id, decision] of [[s.visitorId, s.decisions.visitor], [s.shopperId, s.decisions.shopper]] as const) {
            expect(x.receipts[id].body.receipts?.map((r: { decision_id: string }) => r.decision_id), `W37.T5 — ${kind} ${tenant}: ${id}'s receipts`).toEqual([decision]);
            expect(x.recent[id].body.ring?.map((r: { decision_id: string }) => r.decision_id), `W37.T5 — ${kind} ${tenant}: ${id}'s ring`).toEqual([decision]);
            expect(x.records[decision], `W37.T5 — ${kind} ${tenant}: the record by id`).toMatchObject({ status: 200, body: { ok: true, stream: 'decision', record: { decision_id: decision, tenant, visitor_id: id } } });
          }
          // every stream of the partition: the listed objects carry every row of hers the partition holds
          for (const stream of T5_STREAMS) {
            const stored = w.partitionRows(tenant, s, stream).map(w.rowId).sort();
            expect(stored.length, `${kind} ${tenant}: the fixture wrote her ${stream} rows`).toBeGreaterThan(0);
            expect(x.partition[stream]!.status).toBe(200);
            expect(x.partition[stream]!.rows.filter(row => row.visitor_id === s.visitorId || row.visitor_id === s.shopperId).map(w.rowId).sort(),
              `W37.T5 — ${kind} ${tenant}: the ${stream} export lists every object that holds her ${stream} rows`).toEqual(stored);
            expect(x.partition[stream]!.rows.every(row => row.tenant === tenant), `W37.T5 — ${kind} ${tenant}: the ${stream} export is ${tenant}'s alone`).toBe(true);
          }
          // never through the other brand's path: the same browser is the other brand's own shopper there, never this one
          const across = await w.exported(other, s, date), theirs = w.shoppers[other]!;
          expect(across.person, `W37.T5 — ${kind}: ${other} does not know ${tenant}'s person`).toMatchObject({ status: 404, body: { ok: false, error: 'unknown shopper' } });
          expect(across.visitor.body.shopperId, `W37.T5 — ${kind}: at ${other} the shared browser is ${other}'s own person`).toBe(theirs.shopperId);
          expect(across.receipts[s.shopperId].body.receipts, `W37.T5 — ${kind}: ${other} holds no receipt of ${tenant}'s person`).toEqual([]);
          expect(across.recent[s.shopperId].body.ring, `W37.T5 — ${kind}: ${other} holds no ring of ${tenant}'s person`).toEqual([]);
          expect(across.receipts[s.visitorId].body.receipts?.map((r: { decision_id: string }) => r.decision_id), `W37.T5 — ${kind}: at ${other} the shared browser's receipts are ${other}'s`).toEqual([theirs.decisions.visitor]);
          for (const decision of [s.decisions.visitor, s.decisions.shopper]) expect(across.records[decision]!.status, `W37.T5 — ${kind}: ${other} refuses ${tenant}'s record id`).toBe(400);
          const carried = JSON.stringify([across.visitor.body.link, across.person.body.shopper, Object.values(across.receipts).map(r => r.body.receipts), Object.values(across.recent).map(r => r.body.ring),
            Object.values(across.records).map(r => r.body.record), Object.values(across.partition).map(p => p.rows)]);
          for (const id of [s.shopperId, s.decisions.visitor, s.decisions.shopper, s.orderId, s.linkedSessionId])
            expect(carried.includes(id), `W37.T5 — ${kind}: nothing ${other} exports carries ${tenant}'s ${id}`).toBe(false);
        }

        // After her erasure: nothing of hers is exported at acme; globex's export of the same browser is unchanged.
        const globexBefore = JSON.stringify(await w.exported(GLOBEX, w.shoppers[GLOBEX]!, date));
        const s = w.shoppers[ACME]!;
        const { answer } = await w.erase(s);
        expect(answer, `W37.T5 — ${kind}: the erasure completes its local steps`).toMatchObject({ status: 200, body: { ok: true, status: 'local_complete', tenant: ACME, shopperId: s.shopperId } });
        const after = await w.exported(ACME, s, date);
        expect(after.visitor.body, `W37.T5 — ${kind}: no link is exported for the erased browser`).toMatchObject({ ok: true, visitorId: s.visitorId, shopperId: null, link: null });
        expect(after.person.status, `W37.T5 — ${kind}: the erased person is unknown`).toBe(404);
        for (const id of [s.visitorId, s.shopperId]) {
          expect(after.receipts[id].body.receipts, `W37.T5 — ${kind}: no receipt of ${id} after erasure`).toEqual([]);
          expect(after.recent[id].body.ring, `W37.T5 — ${kind}: no ring of ${id} after erasure`).toEqual([]);
        }
        // Hidden at once (410, doc 22 §15), then physically gone after the rewrite (404).
        for (const decision of [s.decisions.visitor, s.decisions.shopper]) expect([404, 410], `W37.T5 — ${kind}: ${decision} is no longer exported`).toContain(after.records[decision]!.status);
        const exportedText = JSON.stringify(after.partition);
        for (const id of w.identifiers(s)) expect(exportedText.includes(id), `W37.T5 — ${kind}: the partition export carries no ${id} after the rewrite`).toBe(false);
        expect(JSON.stringify(await w.exported(GLOBEX, w.shoppers[GLOBEX]!, date)), `W37.T5 — ${kind}: globex's export of the same browser is untouched by acme's erasure`).toBe(globexBefore);
      } finally { vi.useRealTimers(); }
    }, 120_000);

    it(`host (${kind}): erasing a shopper of either non-default brand leaves no identifier of hers in any store of that tenant but the erasure's own records, leaves the other brand byte-for-byte, and reaches the tenantless delivery identities and the unerasable stores as the kit says`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await t5World(kind);
        const stores = (list: ReturnType<typeof w.holding>) => [...new Set(list.map(entry => entry.store))].sort();
        for (const [tenant, other] of [[ACME, GLOBEX], [GLOBEX, ACME]] as const) {
          const s = w.shoppers[tenant]!;
          // CONTROL: the fixture put her into every store that holds shopper data on this host, and the detector sees it.
          const before = w.holding(tenant, s);
          expect(stores(before), `${kind} ${tenant}: her data is in every store the fixture reaches`).toEqual(
            (kind === 'session' ? ['CACHE', 'DECISION_RING', 'LEARN_STATS', 'SESSIONS', 'SHOPPER_REFLEX', 'STORAGE'] : ['DECISION_RING', 'LEARN_STATS', 'SESSIONS', 'SHOPPER_REFLEX', 'STORAGE']));
          for (const prefix of T5_STREAMS.map(stream => `/${stream}/`).concat([`aggregates/${tenant}/rings/`]))
            expect(before.some(entry => entry.store === 'STORAGE' && entry.name.includes(prefix)), `${kind} ${tenant}: her rows are under ${prefix}`).toBe(true);
          // The tenantless delivery identities: attributed to one tenant each, and carrying nothing of hers.
          const identitiesBefore = w.identities();
          expect(identitiesBefore.length, `${kind}: the managed path wrote delivery identities`).toBeGreaterThan(0);
          for (const identity of identitiesBefore) expect(identity.owners, `W37.T5 — ${kind}: ${identity.key} is claimed by exactly one tenant`).toHaveLength(1);

          const otherBefore = w.tenantState(other);
          const { answer, rewrites } = await w.erase(s);
          expect(answer, `W37.T5 — ${kind} ${tenant}: the documented erasure completes its local steps`).toMatchObject({ status: 200, body: { ok: true, complete: false, status: 'local_complete', tenant, shopperId: s.shopperId } });
          expect(rewrites.at(-1), `W37.T5 — ${kind} ${tenant}: the next night's rewrite finishes`).toMatchObject({ ok: true, tenant, more: false });

          const residue = w.holding(tenant, s).filter(entry => !w.erasureRecord(tenant)(entry));
          expect(residue.map(entry => `${entry.store} ${entry.name}${entry.store === 'STORAGE' || entry.store === 'CACHE' || entry.store === 'SESSIONS' ? '' : ' :: ' + entry.key}`),
            `W37.T5 — ${kind} ${tenant}: after the erasure, its scheduled work and the next night's rewrite, no store of ${tenant} still carries her identifiers outside the erasure's own records`).toEqual([]);
          expect(w.tenantState(other), `W37.T5 — ${kind}: erasing ${tenant}'s shopper leaves ${other}'s stores byte-for-byte`).toBe(otherBefore);
          for (const identity of w.identities()) {
            expect(identity.owners, `W37.T5 — ${kind} ${tenant}: ${identity.key} stays attributable to exactly one tenant`).toHaveLength(1);
            expect(w.identifiers(s).filter(id => (identity.key + identity.value).includes(id)), `W37.T5 — ${kind} ${tenant}: ${identity.key} carries no identifier of hers`).toEqual([]);
            expect(Object.keys(JSON.parse(identity.value)).sort(), `W37.T5 — ${kind}: a delivery identity holds hashes and counts only`).toEqual(['count', 'digest', 'id', 'version']);
          }
          // What cannot be erased locally is reached as frozen, explicitly unresolved obligations naming her (kit :42).
          const reconciliation = await w.operator(tenant, '/identity/erase', { shopperId: s.shopperId, reconcile: { at: answer.body.reconciliation.at, erasureId: answer.body.reconciliation.erasureId, read: true } });
          expect(reconciliation.status, `W37.T5 — ${kind} ${tenant}: the reconciliation read: ${JSON.stringify(reconciliation.body).slice(0, 300)}`).toBe(202);
          const unverified = (reconciliation.body.reconciliation?.obligations ?? []).find((o: { kind: string }) => o.kind === 'unverified');
          expect(unverified, `W37.T5 — ${kind} ${tenant}: the unerasable stores are an explicit obligation`).toMatchObject({ status: 'unresolved',
            configuration: { history: 'unverified provider mappings, retired aliases, analytics/log datasets and tenantless historical D1' } });
          expect(unverified.identities.map((i: { subject: string }) => i.subject).sort(), `W37.T5 — ${kind} ${tenant}: the obligation names her person and her browser`).toEqual([s.shopperId, s.visitorId].sort());
        }
      } finally { vi.useRealTimers(); }
    }, 120_000);

    it(`host (${kind}): POST /v1/{tenant}/identity/export, with the erase route's selector, operator authentication and tenant scope, answers the shopper of each non-default brand her SHOPPER_REFLEX affinity, consent and pipeline, her SESSIONS session and CACHE profile records and all the documented operator reads return, never the other brand's data or the account id, and nothing of hers once she is erased`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await t5World(kind);
        const date = new Date(w.served).toISOString().slice(0, 10);
        const exportOf = (tenant: string, selector: { visitorId?: string; shopperId?: string }) => w.operator(tenant, '/identity/export', selector);
        const truth: Record<string, T5Entry[]> = {};
        for (const tenant of [ACME, GLOBEX]) {
          truth[tenant] = await w.exportTruth(tenant, w.personIds(w.shoppers[tenant]!), date);
          // CONTROL: the fixture put her into every ruled store this host keeps shopper data in, so an export that omits one cannot pass.
          expect([...new Set(truth[tenant]!.map(entry => entry.store))], `${kind} ${tenant}: her ruled data is in every store this host keeps it in`)
            .toEqual(expect.arrayContaining(kind === 'session' ? ['CACHE', 'DECISION_RING', 'SESSIONS', 'SHOPPER_REFLEX', 'STORAGE'] : ['DECISION_RING', 'SESSIONS', 'SHOPPER_REFLEX', 'STORAGE']));
          expect(truth[tenant]!.filter(entry => entry.store === 'SHOPPER_REFLEX').map(entry => entry.member.split(' ').pop()).sort(), `${kind} ${tenant}: both her objects hold each ruled member`)
            .toEqual(['affinity', 'affinity', 'consent', 'consent', 'pipeline', 'pipeline']);
          if (kind === 'session') expect(truth[tenant]!.filter(entry => entry.member.startsWith(`t:${tenant}:session:`) || entry.member.startsWith(`t:${tenant}:profile:`)).map(entry => entry.store).sort(),
            `session ${tenant}: her browser's and her person's session records, and her profile copy`).toEqual(['CACHE', 'SESSIONS', 'SESSIONS']);
        }

        // Her export at each non-default brand, by either selector: every ruled datum of hers, and nothing of the other brand's.
        for (const [tenant, other] of [[ACME, GLOBEX], [GLOBEX, ACME]] as const) {
          const s = w.shoppers[tenant]!, o = w.shoppers[other]!;
          for (const selector of [{ shopperId: s.shopperId }, { visitorId: s.visitorId }] as Array<{ visitorId?: string; shopperId?: string }>) {
            const label = `W37.T5 export — ${kind} ${tenant} ${Object.keys(selector)[0]}`;
            const before = await w.exportTruth(tenant, w.personIds(s), date);
            const answer = await exportOf(tenant, selector);
            const after = await w.exportTruth(tenant, w.personIds(s), date);
            expect(answer.status, `${label}: POST /v1/${tenant}/identity/export answers the operator with her export: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
            expect(answer.body.ok ?? answer.body.success, `${label}: a success answer (kit 02 :31)`).toBe(true);
            expect(exportGaps(answer.body, before, after), `${label}: the export carries every ruled datum of hers, from every store`).toEqual([]);
            expect(foreignCarried(answer.body, truth[other]!, before), `${label}: the export carries nothing of ${other}'s`).toEqual([]);
            const text = JSON.stringify(answer.body);
            expect([o.shopperId, o.linkedSessionId, o.orderId, o.decisions.visitor, o.decisions.shopper, ...o.grantIds].filter(id => text.includes(id)), `${label}: no identifier of ${other}'s person`).toEqual([]);
            expect(text.includes(T5_ACCOUNT), `${label}: the export never carries the account id (kit 02 :350)`).toBe(false);
          }
          // The other brand's path never answers her: her person id names nobody there.
          const across = await exportOf(other, { shopperId: s.shopperId }), acrossText = JSON.stringify(across.body);
          expect(foreignCarried(across.body, truth[tenant]!, truth[other]!), `W37.T5 export — ${kind}: ${other}'s export of ${tenant}'s person id carries nothing of hers`).toEqual([]);
          expect([s.linkedSessionId, s.orderId, s.decisions.visitor, s.decisions.shopper, ...s.grantIds].filter(id => acrossText.includes(id)), `W37.T5 export — ${kind}: ${other}'s export carries no identifier of ${tenant}'s person`).toEqual([]);
        }

        // The erase route's selector, operator authentication and tenant scope: every request below the erase route
        // refuses before it reads a subject, and the export refuses it with the same status.
        const nobody = { shopperId: 'sh_' + 'f'.repeat(32) }, bearer = await w.bearer(), capability = await newAnonymousSession(w.h.env, ACME);
        const globexOperator = await new SignJWT({ sub: 'w37-globex-operator', type: 'service', roles: ['admin'], permissions: ['*'] })
          .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
        const enforced = host(kind, { enforced: true, extra: { TENANTS: JSON.stringify({ provisioned: [ACME, GLOBEX], operatorGrants: { 'w37-globex-operator': [GLOBEX] } }) } });
        const refusals: Array<[string, (route: string) => Promise<Response>]> = [
          ['no operator token', route => w.h.call(`/v1/${ACME}/identity/${route}`, { tenant: ACME, body: nobody })],
          ['a shopper capability instead of an operator token', route => w.h.call(`/v1/${ACME}/identity/${route}`, { tenant: ACME, body: nobody, grant: capability })],
          ['no selector', route => w.h.call(`/v1/${ACME}/identity/${route}`, { tenant: ACME, body: {}, headers: { Authorization: bearer } })],
          ['an account id beside the selector', route => w.h.call(`/v1/${ACME}/identity/${route}`, { tenant: ACME, body: { ...nobody, accountId: T5_ACCOUNT }, headers: { Authorization: bearer } })],
          ['a browser id where the shopper id belongs', route => w.h.call(`/v1/${ACME}/identity/${route}`, { tenant: ACME, body: { shopperId: w.shoppers[ACME]!.visitorId }, headers: { Authorization: bearer } })],
          ['an unregistered tenant', route => w.h.call(`/v1/${INITECH}/identity/${route}`, { tenant: INITECH, body: nobody, headers: { Authorization: bearer } })],
          ['another tenant named beside the path', route => w.h.call(`/v1/${ACME}/identity/${route}`, { tenant: GLOBEX, body: nobody, headers: { Authorization: bearer } })],
          ['an operator granted only the other brand (enforced)', route => enforced.call(`/v1/${ACME}/identity/${route}`, { tenant: ACME, body: nobody, headers: { Authorization: `Bearer ${globexOperator}` } })],
        ];
        for (const [refusal, send] of refusals) {
          const erase = (await send('erase')).status, exported = (await send('export')).status;
          expect(erase, `${kind} ${refusal}: the erase route refuses it`).toBeGreaterThanOrEqual(400);
          expect(exported, `W37.T5 export — ${kind}: ${refusal} — refused exactly as the erase route refuses it`).toBe(erase);
        }

        // Nothing of hers once she is erased, at either brand; the other brand's shopper keeps her whole export.
        for (const [tenant, other] of [[ACME, GLOBEX], [GLOBEX, ACME]] as const) {
          const s = w.shoppers[tenant]!, o = w.shoppers[other]!;
          const { answer } = await w.erase(s);
          expect(answer.body.status, `${kind} ${tenant}: the erasure completes its local steps`).toBe('local_complete');
          for (const selector of [{ shopperId: s.shopperId }, { visitorId: s.visitorId }] as Array<{ visitorId?: string; shopperId?: string }>) {
            const label = `W37.T5 export — ${kind} ${tenant} ${Object.keys(selector)[0]} after her erasure`, own = Object.values(selector)[0];
            const erased = await exportOf(tenant, selector), text = JSON.stringify(erased.body), seen = carried(erased.body);
            expect([200, 404], `${label}: the export route still answers the operator: ${text.slice(0, 200)}`).toContain(erased.status);
            expect(typeof erased.body.ok, `${label}: a JSON answer in the kit's convention (kit 02 :31)`).toBe('boolean');
            expect([...truth[tenant]!, ...truth[other]!].filter(entry => carries(seen, entry)).map(entry => `${entry.store} ${entry.member}`), `${label}: nothing of hers, and nothing of ${other}'s, is exported`).toEqual([]);
            expect(w.identifiers(s).filter(id => id !== own && text.includes(id)), `${label}: no identifier of hers but the selector`).toEqual([]);
            expect(text.includes(T5_ACCOUNT), `${label}: never the account id`).toBe(false);
          }
          if (tenant === ACME) {
            const kept = await exportOf(other, { shopperId: o.shopperId });
            expect(kept.status, `W37.T5 export — ${kind}: ${other}'s shopper is still exported after ${tenant}'s erasure`).toBe(200);
            expect(exportGaps(kept.body, truth[other]!, await w.exportTruth(other, w.personIds(o), date)), `W37.T5 export — ${kind}: ${tenant}'s erasure takes nothing from ${other}'s export`).toEqual([]);
          }
        }
      } finally { vi.useRealTimers(); }
    }, 120_000);

    it(`host (${kind}): POST /v1/{tenant}/identity/export is audited as the erase route is (auditedSubjectOperation, src/routes/identity.ts:536) — in enforced mode a successful export of the shopper of each non-default brand writes the subject-audit entries the erase writes for the same selector, named for the export, for the tenant and the selector's kind, listed in the tenant's audit view; a refused export writes what a refused erase writes and releases nothing of hers`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const w = await t5World(kind);
        const date = new Date(w.served).toISOString().slice(0, 10);
        const truth: Record<string, T5Entry[]> = {};
        for (const tenant of [ACME, GLOBEX]) truth[tenant] = await w.exportTruth(tenant, w.personIds(w.shoppers[tenant]!), date);
        const capability: Record<string, Awaited<ReturnType<typeof newAnonymousSession>>> = { [ACME]: await newAnonymousSession(w.h.env, ACME), [GLOBEX]: await newAnonymousSession(w.h.env, GLOBEX) };

        // The same stamp, enforced — the only mode that audits (src/auth/subjectAudit.ts:176) — with an audit store
        // that can refuse a phase, and explicit operator grants (src/middleware/operatorAuth.ts:11).
        const accounts = memoryStore(), append = accounts.auditOperations.bind(accounts);
        let refuse: 'admitted' | 'result' | null = null;
        vi.spyOn(accounts, 'auditOperations').mockImplementation(async rows => {
          if (refuse && JSON.parse(rows[0]!.detail!).phase === refuse) throw new Error('synthetic audit store refusal');
          await append(rows);
        });
        Object.assign(w.h.env, { AUTH_MODE: 'enforced', ACCOUNTS: accounts, TENANTS: JSON.stringify({ provisioned: [ACME, GLOBEX],
          operatorGrants: { 'w37-operator': [ACME, GLOBEX], [`w37-${ACME}-operator`]: [ACME], [`w37-${GLOBEX}-operator`]: [GLOBEX] } }) });
        const token = (sub: string) => new SignJWT({ sub, type: 'service', roles: ['admin'], permissions: ['*'] })
          .setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
        const bearer = `Bearer ${await token('w37-operator')}`;
        type Audited = { status: number; body: Record<string, any>; lines: AuditLine[] };
        const audited = async (send: () => Response | Promise<Response>): Promise<Audited> => {
          const start = accounts.log.length, response = await send();
          const body = await response.json().catch(() => ({})) as Record<string, any>;
          return { status: response.status, body, lines: auditLines(accounts.log.slice(start)) };
        };
        const refusing = async (phase: 'admitted' | 'result', send: () => Promise<Audited>) => { refuse = phase; try { return await send(); } finally { refuse = null; } };

        // CONTROL: an export that answers her correctly, behind the same ingress and operator authentication, and writes no audit entry.
        const unaudited = new Hono<{ Bindings: Env }>();
        unaudited.use('*', tenantMiddleware()); unaudited.use('/v1/:tenant/*', sdkKey());
        unaudited.post('/v1/:tenant/identity/export', operatorJwt() as unknown as Parameters<typeof unaudited.use>[1],
          c => c.json({ ok: true, tenant: c.req.param('tenant'), export: truth[c.req.param('tenant')]!.map(entry => entry.value) }));

        for (const [tenant, other, selector] of [[ACME, GLOBEX, { shopperId: w.shoppers[ACME]!.shopperId }], [GLOBEX, ACME, { visitorId: w.shoppers[GLOBEX]!.visitorId }]] as Array<[string, string, { visitorId?: string; shopperId?: string }]>) {
          const s = w.shoppers[tenant]!, label = `W37.T5 export audit — ${kind} ${tenant} ${Object.keys(selector)[0]}`;
          const route = (name: 'erase' | 'export', body: unknown = selector, options: { path?: string; tenant?: string; headers?: Record<string, string>; grant?: { capability: string } } = {}) =>
            audited(() => w.h.call(`/v1/${options.path ?? tenant}/identity/${name}`, { tenant: options.tenant ?? tenant, body, headers: options.headers ?? { Authorization: bearer }, ...(options.grant ? { grant: options.grant } : {}) }));

          // Everything that reads her runs while her data is there; the erase, the witness, runs last.
          const control = await audited(() => unaudited.request(new Request(`https://w37.synthetic.invalid/v1/${tenant}/identity/export`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant, Authorization: bearer }, body: JSON.stringify(selector) }), undefined, w.h.env,
            { waitUntil: () => undefined, passThroughOnException() {}, props: {} } as unknown as ExecutionContext));
          const exported = await route('export');
          const otherOperator = `Bearer ${await token(`w37-${other}-operator`)}`;
          const refusals: Array<[string, (name: 'erase' | 'export') => Promise<Audited>]> = [
            ['no operator token', name => route(name, selector, { headers: {} })],
            ['a shopper capability instead of an operator token', name => route(name, selector, { headers: {}, grant: capability[tenant]! })],
            ['no selector', name => route(name, {})],
            ['an account id beside the selector', name => route(name, { ...selector, accountId: T5_ACCOUNT })],
            ['a browser id where the shopper id belongs', name => route(name, { shopperId: s.visitorId })],
            ['an unregistered tenant', name => route(name, selector, { path: INITECH, tenant: INITECH })],
            ['another tenant named beside the path', name => route(name, selector, { tenant: other })],
            ['an operator granted only the other brand', name => route(name, selector, { headers: { Authorization: otherOperator } })],
            ['the audit store refusing the admission', name => refusing('admitted', () => route(name))],
          ];
          const refused: Array<[string, Audited, Audited]> = [];
          for (const [refusal, send] of refusals) refused.push([refusal, await send('export'), await send('erase')]);
          const resultRefusedExport = await refusing('result', () => route('export'));
          const erased = await route('erase');
          refused.push(['the audit store refusing the result', resultRefusedExport, await refusing('result', () => route('erase'))]);
          const view = await audited(() => w.h.call(`/v1/${tenant}/audit?limit=100`, { tenant, headers: { Authorization: bearer } }));

          // CONTROL (the witness, measured): the erase writes one admitted and one result subject_operation entry, named for the erase,
          // for this tenant and the selector's kind (kit 02 :573).
          expect(erased.lines.map(line => [line.action, line.tenant, line.detail.operation, line.detail.phase, line.detail.selector?.kind]), `${label}: the erase's own audit`).toEqual([
            ['subject_operation', tenant, 'identity_erase', 'admitted', 'identity'], ['subject_operation', tenant, 'identity_erase', 'result', 'identity']]);
          // CONTROL: the export that answers her correctly but writes no audit entry fails this leg, on the audit alone.
          expect(control.status, `${label} control: the unaudited export answers the operator`).toBe(200);
          expect(exportGaps(control.body, truth[tenant]!, truth[tenant]!), `${label} control: the unaudited export carries every ruled datum of hers`).toEqual([]);
          expect(control.lines, `${label} control: the unaudited export writes no audit entry`).toEqual([]);
          expect(exportAuditGaps(control, erased), `${label} control: this leg names what the unaudited export did not write`).toEqual(['admitted: no subject-audit entry', 'result: no subject-audit entry']);

          // The ruling: a successful export writes the subject-audit entries the erase writes, named for the export.
          expect(exportAuditGaps(exported, erased), `${label}: a successful POST /v1/${tenant}/identity/export writes the subject-audit entries the erase writes for the same selector, named for the export`).toEqual([]);
          expect(exported.status, `${label}: the export succeeded`).toBe(200);
          expect(view.status, `${label}: the tenant's audit view answers`).toBe(200);
          const listed = new Map(((view.body.entries ?? []) as Array<{ id: number; detail: unknown }>).map(entry => [entry.id, canonical(entry.detail)]));
          expect([...erased.lines, ...exported.lines].filter(line => listed.get(line.id) !== canonical(line.detail)).map(line => `${String(line.detail.operation)} ${String(line.detail.phase)}`),
            `${label}: the tenant's audit view lists the export's entries as it lists the erase's (kit 02 :573)`).toEqual([]);

          // A refused export writes what a refused erase writes, and releases nothing of hers.
          for (const [refusal, x, e] of refused) {
            expect(e.status, `${kind} ${tenant} ${refusal}: the erase route refuses it`).toBeGreaterThanOrEqual(400);
            const released = truth[tenant]!.filter(entry => carries(carried(x.body), entry)).map(entry => `${entry.store} ${entry.member}`);
            expect({ status: x.status, audit: exportAuditGaps(x, e), released }, `${label}: ${refusal} — the refused export writes what the refused erase writes, and releases nothing of hers`)
              .toEqual({ status: e.status, audit: [], released: [] });
          }
        }
      } finally { vi.useRealTimers(); }
    }, 180_000);
  }

  it('logic: a customer stamp admits POST /v1/{tenant}/identity/export for each non-default brand exactly as it admits the erase route (src/customerBoundary.ts:96), and no other method on it', () => {
    for (const tenant of [ACME, GLOBEX]) for (const method of ['POST', 'GET', 'PUT', 'DELETE']) {
      const admitted = (route: string) => customerRequest(new Request(`https://shop.${tenant}.example/v1/${tenant}/identity/${route}`, { method }), `/v1/${tenant}/identity/${route}`);
      expect(admitted('export'), `W37.T5 export — ${tenant} ${method}: the customer surface admits the export as it admits the erase route`).toEqual(admitted('erase'));
    }
  });
});
