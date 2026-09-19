// src/units/W16/C5.unit.test.ts
// W16 criterion C5 — stage parity across every path, and the ODP stage-only proof.
//
// One `describe('unit:W16.C5.0N')` per unit of batch W16-B5, one `it` per ruled
// leg. Every expected value comes from the W16-B5 ruling table in the brief,
// the admitted C5 text in `docs/handover/HANDOFF-2026-09-18.md` §5 point 5
// ("SessionManager, ShopperReflex, projection, LearnStats, buffered action, ODP
// and content agree. Stage-only changes may send the exact allowed stage
// projection; prove the actual ODP payload/network call and zero fabricated
// behavioral events and zero retention renewal"), the K3 boundary in §5's check
// table, the settled decision on buffered events in §7 ("Explicitly buffered
// browser/app actions may contribute age-decayed interest plus eligible
// historical measurement. They must not create fresh visits/recent ODP
// activity/regional activity on arrival"), document 35 §5 W16 and §2 F13/F14,
// `docs/architecture/tapestry_requirements.txt` line 148 (exploring (seeing) →
// thinking → deciding) and line 152 (Return Visit Recognition), and rulings
// R19, R20, R21, R29, R32 and R34 — never from what the engine returns today.
//
// R29/R32(2): the engine REPORTS the shared vocabulary `exploring|thinking|
// deciding`; the persisted grammar (`early|mid|late` on the cell, the session
// record, the shopper object's pipeline and the learning ladder key `s=mid`) is
// unchanged and is reached through the one mapping point `PERSISTED_STAGE`.
//
// TWO READINGS, RULED BY THE LEAD AS R40 after the specification pass:
//   (a) THE STAGE-ONLY CHANGE is the read-time visit boundary: after
//       VISIT_GAP_MS of inactivity the next SDK read is a new visit whose
//       visit-local counters start from zero (W16.C4.02), so the stage moves
//       from `thinking` to `exploring` with NO new behavioral event. That read
//       is the "stage-only change" of units .02, .03 and .04.
//   (b) THE ODP WIRE VOCABULARY stays the persisted grammar, reached through
//       PERSISTED_STAGE: `journey_stage` on the ODP profile is an external
//       published grammar mirrored 1:1 with the customer's RTS conditions
//       (`ODP_MIRRORED_AUDIENCES` carries `late_journey_ready_to_buy`;
//       `src/services/odpLoop.ts` header, wire contract LIVE-VERIFIED
//       2026-07-03), exactly like the cell token and the learning key that R29
//       keeps. The shared word is what the engine REPORTS; the token is what it
//       PROJECTS onto a published external grammar.
//
// RULED MISSING EXPORTS AND MEMBERS (R21), imported/read by the name the
// W16-B4 specification rules, and RED until they exist:
//   @/services/JourneyStage : PERSISTED_STAGE (R32(2))
//   members                 : DecisionRecord.journey (stage + threshold version)
//
// The host legs drive the real mounted app and the real ShopperReflex class in
// process on BOTH hosts, in the pattern of `src/units/W16/C2.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`. The ODP call is captured at the
// fetch boundary the code actually uses (`ownerFetch` → global `fetch`,
// `src/identity/sessionAuthority.ts:292`); no call ever leaves the process.
// `host-internal` legs (R19) carry only observables no shopper-facing route
// exposes — the stored stage, the decision record and the learning object's
// exposure rows; those rows name the missing public observable as a residual.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import { PERSISTED_STAGE } from '@/services/JourneyStage';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { VISIT_GAP_MS } from '@/services/visit';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, verifySessionCapability, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { snapshot as reflexSnapshot, apply as reflexApply, DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { applyHistorical } from '@/reflex/identityMerge';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import { configuredDestinations, connectorIdentity } from '@/connectors/config';
import { levelKeys } from '@/learn/stats';
import { statsName } from '@/learn/fan';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ---------------------------------------------------------------------------
// Customer-shaped fixtures: Coach's own taxonomy (Handbags, Small Leather
// Goods, Accessories — HANDOFF §5 C8), with a cross-category view and an
// unrecognized line, because unknown and cross-category inputs are part of the
// fixture, not an afterthought.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const T0 = 1_725_000_000_000;
/** One interaction apart, well inside the visit (VISIT_GAP_MS = 30 min). */
const STEP_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The shopper's coarse region, so the population fan-in is reachable at all. */
const GEO = { country: 'US', regionCode: 'NY' };

/** The Coach storefront's real event shapes (docs/kit/03-payload-schemas.md). */
const pdpView = (line: string, category: string, productId: string, priceUsd: number, dwellMs?: number) =>
  ({ type: 'product_view', data: { productId, line, category, price_usd: priceUsd, ...(dwellMs === undefined ? {} : { dwellMs }) } });

/** Three interactions of one visit: two Handbags PDPs and one cross-category SLG PDP. */
const THREE_INTERACTIONS = [
  pdpView('Tabby', 'Handbags', 'CH-TABBY-26', 395, 45_000),
  pdpView('Tabby', 'Handbags', 'CH-TABBY-32', 450),
  pdpView('Wyn', 'Small Leather Goods', 'CH-WYN-WALLET', 150),
];
/** A line nobody in the taxonomy recognises, in a third category. */
const UNKNOWN_LINE_VIEW = pdpView('not-a-coach-line', 'Accessories', 'CH-UNKNOWN-1', 95);
/** A live order, for the control shopper: the reward-bearing event. */
const livePurchase = () =>
  ({ type: 'purchase', data: { orderId: 'coach-order-live-1', line: 'Tabby', category: 'Handbags', price_usd: 395, value: 395, currency: 'USD' } });
/**
 * The order the shopper placed a week ago on a device that was offline, handed
 * to the platform late and explicitly marked buffered. Its line (Rogue) is one
 * she never touched live in this fixture, so its age-decayed contribution is
 * the engine's own closed form on a fresh entry and nothing else.
 */
const LATE_ORDER_ID = 'coach-order-late-1';
const lateRoguePurchase = () =>
  ({ type: 'purchase', data: { orderId: LATE_ORDER_ID, line: 'Rogue', category: 'Handbags', price_usd: 595, value: 595, currency: 'USD' } });
/** How late it was delivered (HANDOFF §7 "Late history": no age cutoff is inferred from delay). */
const LATE_BY_MS = 7 * DAY_MS;
/** The browsing session the late order belongs to, which is not the live one. */
const LATE_BROWSING_SESSION = 'earlier-browsing-session';

// ---------------------------------------------------------------------------
// The published documents. R32(1): the journey threshold set is the `journey`
// block of the already-published, tenant-scoped reflex document, with exactly
// the thresholds the W16-B4 specification publishes, so the two batches demand
// ONE representation. Three interactions is `thinking`; a purchase is
// `deciding`; the vocabulary's first stage needs no threshold.
// ---------------------------------------------------------------------------

const JOURNEY_V1 = {
  stages: [
    { stage: 'thinking', anyOf: { interactions: 3 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};
/** R32(4): a published fourteen-day memory horizon is accepted customer-neutral fixture data. */
const FIXTURE_TAU_MS = 14 * DAY_MS;
const fixtureReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w16-b5-fixture', tauMs: FIXTURE_TAU_MS, eventAttributes: 'event-when-unknown' as const };
const reflexDocument = { ...fixtureReflexConfig, journey: JOURNEY_V1 };

// ---------------------------------------------------------------------------
// The tenant's configured ODP destination. This is authored customer
// configuration, not a product constant: the wire vocabulary, the action
// mapping and the profile mapping all come from the document, so "the
// configured mappings and nothing else" is a real bound and not a tautology.
// ---------------------------------------------------------------------------

const ODP_HOST = 'https://odp-meridian.invalid';
const ODP_NAMESPACE = 'customer';
const ODP_CONFIGURATION = {
  apiHost: ODP_HOST,
  publicKeyRef: 'CONNECTOR_SECRET_MERIDIAN_ODP',
  identityNamespace: ODP_NAMESPACE,
  actions: {
    product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId', product_line: 'line' } },
    purchase: { type: 'order', action: 'purchase', fields: { order_id: 'orderId', total: 'value', currency: 'currency' } },
  },
  audiences: { late_journey_ready_to_buy: 'owned_ready_to_buy' },
  /** One journey field and two affinity fields: the whole allowed profile projection. */
  profile: {
    journey_stage: { journey: true },
    line_score: { dimension: 'line', value: 'Tabby' },
    top_line: { dimension: 'line' },
  },
};
/** Exactly the attribute names an ODP profile call may carry for this tenant. */
const ALLOWED_PROFILE_ATTRIBUTES = ['journey_stage', 'line_score', 'top_line', 'vuid'];

// ---------------------------------------------------------------------------
// The network boundary. Every ODP call the product makes goes through
// `ownerFetch` → global `fetch`; nothing here ever reaches a real host.
// ---------------------------------------------------------------------------

interface NetworkCall { url: string; path: string; method: string; body: unknown }

function installNetwork(): { calls: NetworkCall[]; restore: () => void } {
  const calls: NetworkCall[] = [];
  const network = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const raw = init?.body;
    let body: unknown = null;
    if (typeof raw === 'string') { try { body = JSON.parse(raw); } catch { body = raw; } }
    calls.push({ url, path: url.startsWith(ODP_HOST) ? url.slice(ODP_HOST.length) : url, method: init?.method ?? 'GET', body });
    if (url === `${ODP_HOST}/v3/events`) return new Response(null, { status: 202 });
    if (url === `${ODP_HOST}/v3/profiles`) return new Response(null, { status: 200 });
    if (url === `${ODP_HOST}/v3/graphql`) return Response.json({ data: { customer: { audiences: { edges: [] } } } });
    return new Response(null, { status: 503 });
  };
  vi.stubGlobal('fetch', network);
  return { calls, restore: () => vi.unstubAllGlobals() };
}

/** Everything the tenant's ODP destination was told, in order, since `from`. */
const odpSince = (calls: NetworkCall[], from: number) => calls.slice(from).filter(call => call.url.startsWith(ODP_HOST));
const attributesOf = (call: NetworkCall) => (call.body as Array<{ attributes: Record<string, unknown> }>)[0]!.attributes;

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts`; that suite is never imported and never edited.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b5-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
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
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/** Two live editorial pieces on one hero slot, take 1. */
const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b5-fixture', note: '', value: { pieces: [
    { id: 'rogue-editorial', customerContentId: 'cms-rogue', type: 'editorial', title: 'Rogue', tags: { line: ['Rogue'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b5-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b5-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b5', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b5-fixture', note: '', value } });
  const changes = documentChanges(tenant);
  const defaults = [baseline(REFLEX_KIND, reflexDocument, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b5', arms: ['default'] } })];
  return initializePublicationSet(env,
    defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base),
    '0:' + crypto.randomUUID());
}

function boundary(host: string, options: { ledgerRecovery?: boolean } = {}) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  /** Every ledger message the real producer path actually sent. */
  const queued: Array<{ record?: Record<string, unknown> }> = [];
  /** Every population count the real region fan-in actually sent. */
  const regionIngests: Array<{ name: string; body: unknown }> = [];
  /** Every exposure body the real learning fan actually delivered. */
  const learnStats: Array<{ name: string; url: string; body: Record<string, unknown> }> = [];
  const ringAppends: Array<{ name: string; body: unknown }> = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const recordingNamespace = (sink: Array<{ name: string; url: string; body: Record<string, unknown> }>, reply: unknown) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; } catch { body = {}; }
      sink.push({ name: String(name), url: input instanceof Request ? input.url : String(input), body });
      return Response.json(reply);
    } }),
  });
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    // Durable ledger recovery, where asked for: without it the demo profile
    // writes no behavior record at all (src/ledger/behavior.ts:21), so the
    // "no action record" clause of W16.C5.03 would have nothing to measure.
    ...(options.ledgerRecovery ? { LEDGER_RECOVERY_ENABLED: 'true' } : {}),
    JWT_SECRET: 'w16-b5-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    // The customer's authored ODP destination (src/connectors/config.ts registry).
    TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: { [TENANT]: { odp: ODP_CONFIGURATION } } }),
    CONNECTOR_SECRET_MERIDIAN_ODP: 'synthetic-odp-public-key',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    // The real outcome producer path (src/ledger/enqueue.ts) sends here.
    EVENT_QUEUE: { send: async (message: { record?: Record<string, unknown> }) => { queued.push(message); } },
    // The real population fan-in (src/reflex/regionTrend.ts:158) posts here.
    REGION_TREND: recordingNamespace(regionIngests as unknown as Array<{ name: string; url: string; body: Record<string, unknown> }>, { ok: true }),
    // The real learning fan (src/learn/fan.ts:340) delivers exposures here.
    LEARN_STATS: recordingNamespace(learnStats, { ok: true }),
    DECISION_RING: recordingNamespace(ringAppends as unknown as Array<{ name: string; url: string; body: Record<string, unknown> }>, { ok: true }),
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b5-fixture', note: '', value: fixtureReflexConfig }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
  /** Each configured destination has its own retained-data policy before any record is born. */
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* the fixture reports no destination diagnostics */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const storage = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
              },
              deleteAlarm: async () => { deleteAlarm = true; },
              setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  // R19: the routes production serves, mounted as `src/index.ts` mounts them.
  app.use('*', tenantMiddleware()); app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes);
  const call = async (path: string, capability?: string, body?: unknown, tenant = TENANT) => {
    await configureRetention();
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': tenant, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // The coarse request geolocation the platform receives, as
    // `src/routes/realtime.sdkContract.test.ts:235` supplies it.
    Object.defineProperty(request, 'cf', { value: GEO });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* the fixture never passes through */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, queued, regionIngests, learnStats, ringAppends, call, drain, configureRetention };
}

async function explicitChoice(f: ReturnType<typeof boundary>, grant: Awaited<ReturnType<typeof newAnonymousSession>>) {
  const current = f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const response = await f.call(`/realtime/session/${grant.sessionId}/preferences`,
    grant.capability, { trackingConsent: true, personalizationEnabled: true, choice }, grant.tenant);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { consent?: { tracking: boolean; personalization: boolean; instruction?: ConsentInstruction } };
}

/** What the SDK-visible hydrate (`GET /realtime/reflex`) returns on either host. */
interface Hydrate {
  journeyStage?: unknown;
  config?: { tauMs?: number; K?: number };
  visit?: { visitNumber: number | null; entryChannel: string | null } | null;
  affinity?: { dims?: Record<string, Record<string, number>> } | null;
}
/** What `POST /realtime/action` answers on either host. */
interface ActionAnswer {
  status: number;
  interestApplied?: unknown;
  dropped?: unknown;
  /** What the mounted route says it durably captured about this action. */
  behavior?: { status?: unknown; recordId?: unknown };
  update?: { data?: { journeyStage?: unknown } } | null;
}
/** What the mounted decisions snapshot exposes about its inputs and its answer. */
interface SnapshotAnswer { status: number; ok: unknown; state: unknown; decisions: unknown }

interface HostFixture {
  f: ReturnType<typeof boundary>;
  grant: Awaited<ReturnType<typeof newAnonymousSession>>;
  principal: SessionCapability;
  /** A real accepted event through the mounted app, on whichever host this fixture runs. */
  action: (event: { type: string; data: Record<string, unknown> },
    options?: { buffered?: { timestamp: number; browsingSessionId: string } }) => Promise<ActionAnswer>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`). */
  hydrate: () => Promise<Hydrate>;
  /** R19: the mounted route production serves, `GET /v1/:tenant/decisions/snapshot`. */
  snapshot: () => Promise<SnapshotAnswer>;
  /**
   * The same decision one layer in, because no shopper-facing route exposes the
   * decision record, its cell or the exposures the learning object receives:
   * the snapshot route runs in offer mode, where `captureRecords` is empty
   * (`src/content/service.ts:317`) and the records are omitted from the body
   * (`src/routes/decisions.ts:479`). Named `host-internal` per R19.
   */
  decide: () => Promise<Awaited<ReturnType<typeof serveContentDecisions>>>;
  /** The stage this host actually persisted for the shopper (internal grammar). */
  ownedStage: () => unknown;
  /** The retention stamp the owner actually stored for this shopper. */
  ownedRetention: () => { expiresAt?: number } | null;
  /** The ring of recent ODP activity the owner actually stored. */
  ownedOdpRing: () => unknown[] | null;
  /** Every alarm this host armed, in order (the object host owns the alarms). */
  alarms: () => number[];
  /** Every durable recovery admission the shopper's owner actually stored. */
  ownedRecoveryAdmissions: () => string[];
}

async function hostFixture(host: 'session' | 'do', options: { ledgerRecovery?: boolean } = {}): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host, options);
  // Every configured destination has a retained-data policy BEFORE the first
  // record is born, so its external copy carries its own original stamp.
  await f.configureRetention();
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT);
  await explicitChoice(f, grant);
  const principal = await verifySessionCapability(f.env, grant.capability, TENANT);
  const objectName = shopperObjectName(TENANT, grant.subject);
  const action = async (event: { type: string; data: Record<string, unknown> },
    options: { buffered?: { timestamp: number; browsingSessionId: string } } = {}) => {
    const response = await f.call('/realtime/action', grant.capability, {
      ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: options.buffered ? options.buffered.timestamp : Date.now(), eventId: crypto.randomUUID(),
      ...(options.buffered ? { processing: 'buffered', browsingSessionId: options.buffered.browsingSessionId } : {}),
    });
    const body = await response.clone().json().catch(() => ({})) as
      { interestApplied?: unknown; dropped?: unknown; behavior?: { status?: unknown; recordId?: unknown }; update?: { data?: { journeyStage?: unknown } } | null };
    await f.drain();
    return { status: response.status, interestApplied: body.interestApplied, dropped: body.dropped,
      behavior: body.behavior, update: body.update ?? null };
  };
  const hydrate = async () => {
    const response = await f.call('/realtime/reflex', grant.capability);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Hydrate;
    await f.drain();
    return body;
  };
  const snapshot = async () => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=home`, grant.capability);
    const body = await response.clone().json().catch(() => ({})) as
      { ok?: unknown; decisions?: Array<{ contentId?: unknown }>; sources?: { state?: unknown } };
    await f.drain();
    return { status: response.status, ok: body.ok, state: body.sources?.state, decisions: body.decisions?.length };
  };
  const decide = async () => {
    // Production reaches this function inside the shopper owner's invocation
    // (requireShopper → forwardShopperRequest → the object's owned operation);
    // the same admission is established here so the real guards run.
    const owner = {};
    const live = await verifySessionCapability(f.env, grant.capability, TENANT);
    const out = await runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, live);
      return serveContentDecisions(f.env, {
        tenant: TENANT, page: 'home', visitorId: live.subject, sessionId: live.sessionId, cookieHeader: null,
        stateTenant: TENANT, principal: live, capability: grant.capability, cf: GEO, channel: null,
      });
    }, f.sessions as unknown as Parameters<typeof runOwnerOperation>[3],
    undefined,
    (async () => f.objects.get(objectName)?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
    // The learning fan runs after the response, exactly as production runs it.
    await out.afterResponse;
    await f.drain();
    return out;
  };
  const ownedSession = (): Record<string, unknown> | null => {
    for (const raw of f.sessions.data.values()) {
      try { const value = JSON.parse(raw) as Record<string, unknown>; if (value && typeof value === 'object' && 'metadata' in value) return value; }
      catch { /* not a session record */ }
    }
    return null;
  };
  const ownedStage = () => host === 'do'
    ? (f.objects.get(objectName)?.data.get('pipeline') as { journeyStage?: unknown } | undefined)?.journeyStage ?? null
    : ((ownedSession()?.metadata as { journeyStage?: unknown } | undefined)?.journeyStage ?? null);
  const ownedRetention = () => host === 'do'
    ? ((f.objects.get(objectName)?.data.get('affinity') as { retention?: { expiresAt?: number } } | undefined)?.retention ?? null)
    : ((ownedSession()?.retention as { expiresAt?: number } | undefined) ?? null);
  const ownedOdpRing = () => host === 'do'
    ? ((f.objects.get(objectName)?.data.get('affinity') as { odpRecentEvents?: unknown[] } | undefined)?.odpRecentEvents ?? null)
    : ((ownedSession()?.odpRecentEvents as unknown[] | undefined) ?? null);
  const alarms = () => [...(f.objects.get(objectName)?.alarms ?? [])];
  /** src/ledger/recovery.ts:76-77 — the keys a durable owner admission writes. */
  const ownedRecoveryAdmissions = () => [...(f.objects.get(objectName)?.data.keys() ?? [])].filter(key => key.startsWith('recovery')).sort();
  return { f, grant, principal, action, hydrate, snapshot, decide, ownedStage, ownedRetention, ownedOdpRing, alarms, ownedRecoveryAdmissions };
}

/**
 * A second shopper on the same host, who sends one ordinary live order. She is
 * the positive control for the sinks the stage-only change must leave alone: if
 * the ledger, the ODP destination and the region object cannot be reached in
 * this fixture at all, an absence proves nothing.
 */
async function controlShopper(f: ReturnType<typeof boundary>, at: number): Promise<{ subject: string }> {
  const grant = await newAnonymousSession(f.env, TENANT);
  await explicitChoice(f, grant);
  const response = await f.call('/realtime/action', grant.capability, {
    ...livePurchase(), source: 'sdk', userId: grant.subject, sessionId: grant.sessionId, timestamp: at, eventId: crypto.randomUUID(),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  await f.drain();
  return { subject: grant.subject };
}

/** What `documentChanges` publishes for /home: one hero slot, take 1. */
const HOME_DECISIONS = 1;

/**
 * The first assertion of every leg that reads the persisted grammar, so the RED
 * line names the ruled mapping point this unit needs (R21, R32(2)).
 */
const mappingPointExists = (what: string) => {
  expect(PERSISTED_STAGE, `${what} — src/services/JourneyStage.ts must export PERSISTED_STAGE, the one mapping point between the reported vocabulary and the persisted token (R32(2))`)
    .toEqual({ exploring: 'early', thinking: 'mid', deciding: 'late' });
};

/**
 * Three real interactions of one visit, live, with the shopper's own geo. At
 * the end of it the visit is her first, the journey stage is `thinking`
 * (`interactions: 3` under the published set; `product_views >= 2` under the
 * shipped rule — the two agree on this sequence), and the ODP destination,
 * the region object and the owner's stored ring have all been exercised.
 */
async function threeLiveInteractions(h: HostFixture, clock: { mockReturnValue: (v: number) => unknown }, host: string): Promise<void> {
  for (const [index, event] of THREE_INTERACTIONS.entries()) {
    clock.mockReturnValue(T0 + index * STEP_MS);
    expect((await h.action(event)).status, host).toBe(200);
  }
  clock.mockReturnValue(T0 + 2 * STEP_MS);
}

// ---------------------------------------------------------------------------

describe('unit:W16.C5.01', () => {
  it('host: for one event sequence the SDK-visible projection reports the same shared stage word on both hosts, and both serve the page', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      const reported: Record<string, unknown> = {}, afterUnknown: Record<string, unknown> = {};
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);
        const hydrate = await h.hydrate();
        // tapestry_requirements.txt line 148: the engine reports the shared word
        // (R29). Today the session host omits the field while it personalizes
        // (src/routes/realtime.ts:442) and the object host answers with its
        // internal token (src/durable-objects/ShopperReflex.ts:1608).
        expect(hydrate.journeyStage, `${host}: three interactions of one visit, reported in the shared vocabulary`).toBe('thinking');
        expect(hydrate.visit, `${host}: the same one visit`).toEqual({ visitNumber: 1, entryChannel: null });
        reported[host] = hydrate.journeyStage;
        // A line nobody recognises is still an interaction of this visit: the
        // stage does not move backwards because the catalogue is surprised.
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        expect((await h.action(UNKNOWN_LINE_VIEW)).status, host).toBe(200);
        afterUnknown[host] = (await h.hydrate()).journeyStage;
        expect(afterUnknown[host], `${host}: an unrecognized line is still this visit's fourth interaction`).toBe('thinking');
        // …and the page the shopper asked for is still served by this host.
        expect(await h.snapshot(), host).toMatchObject({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS });
      }
      expect(reported.session, 'both hosts report one stage for the same sequence').toBe(reported.do);
      expect(afterUnknown.session).toBe(afterUnknown.do);
    } finally { network.restore(); clock.mockRestore(); }
  });

  it('host-internal: the stored stage, the content decision record, its cell and the learning object\'s exposure row carry one consistent stage on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        mappingPointExists('W16.C5.01: SessionManager, ShopperReflex, the projection, LearnStats and the content decision must report one stage');
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);

        // 1. What the host persisted: the persisted token, reached through the
        //    one mapping point (R32(2)); the reported word is never stored.
        expect(h.ownedStage(), `${host}: the stage ${host === 'do' ? 'ShopperReflex' : 'SessionManager'} persisted for this shopper`)
          .toBe(PERSISTED_STAGE.thinking);

        // 2. What the content decision decided in: the record reports the
        //    shared word beside the persisted cell token (R29/R32(2)).
        const out = await h.decide();
        expect(out.records.length, host).toBe(HOME_DECISIONS);
        const record = out.records[0]!;
        expect(record.journey, `${host}: the decision record names the stage it decided in and the version that derived it`)
          .toMatchObject({ stage: 'thinking' });
        expect(record.cell.stage, `${host}: the persisted cell token for the same stage`).toBe(PERSISTED_STAGE.thinking);

        // 3. What the learning object was told: the exposure row carries that
        //    same cell, and the ladder key the statistics are pooled on is
        //    unchanged (src/learn/stats.ts:34).
        const delivered = h.f.learnStats.filter(entry => entry.name === statsName(TENANT, TENANT, 'hero'));
        expect(delivered.length, `${host}: the served decision reached the slot's learning object`).toBe(1);
        const exposures = delivered[0]!.body.exposures as Array<{ item: string; cell: { stage?: unknown } }>;
        expect(exposures.length, `${host}: one exposure for one served decision`).toBe(1);
        expect(exposures[0]!.cell.stage, `${host}: the LearnStats cell stage is the same persisted token`).toBe(PERSISTED_STAGE.thinking);
        // The fixture's own cell: no entry signals were observed, so the channel
        // is `unknown` (W16.C2.04/R14), and this is her first visit.
        expect(levelKeys(record.cell)[3], `${host}: the learning ladder key is unchanged (src/learn/stats.ts:34)`)
          .toBe('c=unknown|v=1|s=mid');

        // 4. And the SDK-visible projection reports the shared word for the
        //    same shopper at the same moment: one stage, five reporters.
        expect((await h.hydrate()).journeyStage, `${host}: the reported vocabulary beside the persisted token`).toBe('thinking');
      }
    } finally { network.restore(); clock.mockRestore(); }
  });
});

describe('unit:W16.C5.02', () => {
  it('host: a stage-only change sends exactly one ODP call, carrying the stage projection and the configured mappings and nothing else, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // The recorder spans the whole test, so every window is measured from
        // where THIS host's own traffic starts; the other host's shopper is a
        // different subject with a different vuid.
        const hostMark = network.calls.length;
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);

        // The destination is reachable and the wire contract is the configured
        // one: a real behavioral event forwards the configured action mapping,
        // identified by the configured identity namespace. This is the control
        // that gives the stage-only measurement below its teeth.
        const vuid = await connectorIdentity(TENANT, ODP_NAMESPACE, h.grant.subject);
        const forwarded = odpSince(network.calls, hostMark).filter(call => call.path === '/v3/events');
        expect(forwarded.length, `${host}: a behavioral event reaches the tenant's ODP destination`).toBeGreaterThan(0);
        expect(forwarded[0]!.body, `${host}: the exact ODP payload of a real product view, through the configured mapping`)
          .toEqual({ type: 'product', action: 'detail', data: { product_id: 'CH-TABBY-26', product_line: 'Tabby' }, identifiers: { vuid } });

        // The stage-only change: no new behavioral event, only the read that
        // crosses the visit boundary, where the visit-local counters start from
        // zero and the stage becomes the vocabulary's first stage (W16.C4.02).
        const mark = network.calls.length;
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + 1);
        const rolled = await h.hydrate();

        // HANDOFF §5 C5: a stage-only change may send the exact allowed stage
        // projection — one profile call, and nothing else on the wire.
        const sent = odpSince(network.calls, mark);
        expect(sent.map(call => `${call.method} ${call.path}`), `${host}: the stage-only change sends exactly the allowed ODP stage projection`)
          .toEqual(['POST /v3/profiles']);

        mappingPointExists('W16.C5.02: the ODP stage projection is the persisted grammar, reached through the one mapping point');
        const attributes = attributesOf(sent[0]!);
        expect(Object.keys(attributes).sort(), `${host}: the stage projection and the configured mappings, and nothing else`)
          .toEqual(ALLOWED_PROFILE_ATTRIBUTES);
        expect(attributes.vuid, `${host}: the configured identity namespace names the shopper`).toBe(vuid);
        expect(attributes.journey_stage, `${host}: the stage projection carries the stage this change moved her to`)
          .toBe(PERSISTED_STAGE.exploring);
        expect(attributes.top_line, `${host}: the configured leading-line mapping, from her own memory`).toBe('Tabby');
        expect(attributes.line_score, `${host}: the configured line mapping carries the number this host itself reports`)
          .toBeCloseTo(rolled.affinity?.dims?.line?.Tabby ?? -1, 4);

        // The change that was projected really was the stage: her new visit
        // starts at the vocabulary's first stage, with her memory intact.
        expect(rolled.journeyStage, `${host}: the new visit starts at the first stage`).toBe('exploring');
        expect(rolled.visit, `${host}: a real return, not a fabricated one`).toEqual({ visitNumber: 2, entryChannel: null });
      }
    } finally { network.restore(); clock.mockRestore(); }
  });
});

describe('unit:W16.C5.03', () => {
  it('host: a stage-only change writes no action or outcome record, no ledger or queue message, no ODP event and no regional activity, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // Each host's own window of the shared network recorder.
        const hostMark = network.calls.length;
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);

        // Controls: in this fixture a real behavioral event does reach the
        // region object and the ODP destination, and a real order does reach
        // the ledger producer. An absence below is therefore a measurement.
        expect(h.f.regionIngests.length, `${host}: a live event fans its touches into the shopper's region`).toBeGreaterThan(0);
        expect(odpSince(network.calls, hostMark).filter(call => call.path === '/v3/events').length,
          `${host}: a live event reaches the ODP destination`).toBeGreaterThan(0);
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        await controlShopper(h.f, T0 + 2 * STEP_MS);
        expect(h.f.queued.length, `${host}: a real order reaches the ledger producer`).toBeGreaterThan(0);

        const queuedBefore = h.f.queued.length, regionBefore = h.f.regionIngests.length;
        const ringBefore = h.f.ringAppends.length, statsBefore = h.f.learnStats.length;
        const mark = network.calls.length;

        // The stage-only change: the read that crosses the visit boundary.
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + 1);
        const rolled = await h.hydrate();
        expect(rolled.journeyStage, `${host}: W16.C5.03 — the read that crosses the visit boundary must report the new visit's first stage; that stage change, with no new behavioral event, is the change this unit measures`)
          .toBe('exploring');

        // Zero fabricated behavioral events (HANDOFF §5 C5).
        expect(h.f.queued.slice(queuedBefore), `${host}: a stage change is not an outcome and enqueues no ledger message`).toEqual([]);
        expect(h.f.regionIngests.slice(regionBefore), `${host}: a stage change is not regional activity`).toEqual([]);
        expect(h.f.ringAppends.slice(ringBefore), `${host}: a stage change appends no decision to the shopper's ring`).toEqual([]);
        expect(h.f.learnStats.slice(statsBefore), `${host}: a stage change is not an exposure`).toEqual([]);
        expect(odpSince(network.calls, mark).map(call => call.path).filter(path => path !== '/v3/profiles'),
          `${host}: a stage change forwards no behavioral event to ODP`).toEqual([]);

        // …and her own behavioral history is unchanged by the read: the same
        // order count, the same memory, no invented interaction.
        expect(h.f.queued.filter(message => (message.record as { visitor_id?: unknown } | undefined)?.visitor_id === h.grant.subject),
          `${host}: this shopper placed no order, so the ledger holds none for her`).toEqual([]);
      }

      // THE ACTION RECORD. Under the demo profile without durable ledger
      // recovery the platform writes no behavior record at all
      // (src/ledger/behavior.ts:21), so that clause is measured here in a
      // fixture where the record is real: every live interaction is durably
      // admitted by the shopper's owner, and the stage-only change admits
      // nothing.
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { ledgerRecovery: true });
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          const answer = await h.action(event);
          expect(answer.status, host).toBe(200);
          expect(answer.behavior?.status, `${host}: a real interaction is captured as a behavior record`).toBe('durable');
        }
        const admitted = h.ownedRecoveryAdmissions();
        expect(admitted.length, `${host}: those records were durably admitted by the shopper's owner`).toBeGreaterThan(0);

        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + 1);
        expect((await h.hydrate()).journeyStage,
          `${host}: W16.C5.03 — the read that crosses the visit boundary must report the new visit's first stage; that stage change, with no new behavioral event, is the change this unit measures`)
          .toBe('exploring');
        expect(h.ownedRecoveryAdmissions(), `${host}: a stage change writes no action record`).toEqual(admitted);
      }
    } finally { network.restore(); clock.mockRestore(); }
  });
});

describe('unit:W16.C5.04', () => {
  it('host: a stage-only change renews no retention — the stored stamp and its expiry are unchanged and no retention alarm is rearmed, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);

        const retention = h.ownedRetention();
        expect(retention, `${host}: the owner stored a retained-data stamp for this shopper`).toBeTruthy();
        expect(typeof retention!.expiresAt, `${host}: with an expiry`).toBe('number');
        const alarmsBefore = h.alarms();
        if (host === 'do') expect(alarmsBefore.length, 'the object host arms its own alarms, so an unchanged alarm is a measurement').toBeGreaterThan(0);

        // Control: a retained-data stamp tracks the clock in this fixture, so
        // "unchanged" below is a measurement and not a constant. A record born
        // two minutes later carries an expiry two minutes later.
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const later = await controlShopper(h.f, T0 + 2 * STEP_MS);
        const laterRecord = h.f.queued.find(message => (message.record as { visitor_id?: unknown } | undefined)?.visitor_id === later.subject)
          ?.record as { retention?: { ledger?: { expiresAt?: number } } } | undefined;
        expect(laterRecord?.retention?.ledger?.expiresAt, 'a record born later carries a later expiry, so a stamp is not a fixture constant')
          .toBeGreaterThan(retention!.expiresAt!);

        // The stage-only change: the read that crosses the visit boundary.
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + 1);
        const rolled = await h.hydrate();
        expect(rolled.journeyStage, `${host}: W16.C5.04 — the read that crosses the visit boundary must report the new visit's first stage; that stage change, with no new behavioral event, is the change this unit measures`)
          .toBe('exploring');

        // HANDOFF §5 C5: zero retention renewal. The stamp is the one her
        // record was born with; browsing on cannot extend an original lifetime
        // (HANDOFF §5 C6, settled retention decision §7).
        expect(h.ownedRetention(), `${host}: the stage-only change renews no retention`).toEqual(retention);
        expect(h.ownedRetention()!.expiresAt, `${host}: the same expiry, to the millisecond`).toBe(retention!.expiresAt);
        expect(h.alarms(), `${host}: no retention alarm is rearmed by a stage-only change`).toEqual(alarmsBefore);
      }
    } finally { network.restore(); clock.mockRestore(); }
  });
});

describe('unit:W16.C5.05', () => {
  it('host: a buffered action delivered a week late contributes age-decayed interest and an eligible historical outcome, and creates no fresh visit, no recent ODP activity and no regional activity, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // Each host's own window of the shared network recorder.
        const hostMark = network.calls.length;
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);
        const live = await h.hydrate();
        expect(live.visit, `${host}: her live visit`).toEqual({ visitNumber: 1, entryChannel: null });
        const ringBefore = h.ownedOdpRing();
        expect(ringBefore?.length, `${host}: her live events did build a ring of recent ODP activity`).toBe(THREE_INTERACTIONS.length);

        // Controls for the two absences: live events do reach the ODP
        // destination and the region object in this fixture.
        const odpBefore = odpSince(network.calls, hostMark).length, regionBefore = h.f.regionIngests.length;
        expect(odpBefore, `${host}: live events reach the ODP destination`).toBeGreaterThan(0);
        expect(regionBefore, `${host}: live events fan into the region object`).toBeGreaterThan(0);
        const mark = network.calls.length, queuedBefore = h.f.queued.length;

        // The late arrival: an order she placed a week ago, delivered now,
        // explicitly buffered, carrying its own original time and the browsing
        // session it belongs to (HANDOFF §7, D06-buffered-action-purpose).
        const arrival = T0 + 3 * STEP_MS, occurredAt = T0 - LATE_BY_MS;
        clock.mockReturnValue(arrival);
        const answer = await h.action(lateRoguePurchase(), { buffered: { timestamp: occurredAt, browsingSessionId: LATE_BROWSING_SESSION } });
        expect(answer.status, `${host}: a buffered delivery is accepted`).toBe(200);
        expect(answer.dropped ?? 'accepted', `${host}: accepted, with no refusal reason`).toBe('accepted');
        expect(answer.interestApplied, `${host}: it contributes interest`).toBe(true);

        // 1. AGE-DECAYED INTEREST. The engine's own arithmetic: a touch of the
        //    purchase's weight at the moment it happened, read a week later
        //    (src/reflex/identityMerge.ts:101 applyHistorical, core.ts:233).
        const decayed = reflexSnapshot(
          applyHistorical(undefined, { action: 'purchase', touches: [{ dim: 'line', value: 'Rogue' }] }, occurredAt, fixtureReflexConfig),
          arrival, fixtureReflexConfig).dims.line?.Rogue;
        const asIfLive = reflexSnapshot(
          reflexApply(undefined, { action: 'purchase', touches: [{ dim: 'line', value: 'Rogue' }] }, arrival, fixtureReflexConfig).state,
          arrival, fixtureReflexConfig).dims.line?.Rogue;
        const after = await h.hydrate();
        // Everything the arrival itself caused, captured before the visit
        // boundary below is crossed (a later stage-only change of its own is
        // unit W16.C5.02's subject, not this one).
        const arrivalOdp = odpSince(network.calls, mark).map(call => call.path);
        const arrivalRegion = h.f.regionIngests.slice(regionBefore);
        const ringAfterArrival = h.ownedOdpRing();
        expect(after.affinity?.dims?.line?.Rogue, `${host}: the late order contributes her Rogue interest, aged by the week it waited`)
          .toBeCloseTo(decayed!, 6);
        expect(decayed!, 'the fixture measures a real discount: a week-old touch is worth less than a live one').toBeLessThan(asIfLive!);
        expect(after.affinity?.dims?.line?.Tabby, `${host}: her live memory is untouched by the arrival`)
          .toBeCloseTo(live.affinity?.dims?.line?.Tabby ?? -1, 6);

        // 2. ELIGIBLE HISTORICAL MEASUREMENT. The order reaches the ledger
        //    producer with its OWN time and its OWN browsing session — no age
        //    cutoff is inferred from the delivery delay (HANDOFF §7, Late history).
        const measured = h.f.queued.slice(queuedBefore).map(message => message.record as Record<string, unknown> | undefined)
          .filter(record => record?.item_id === LATE_ORDER_ID);
        expect(measured.length, `${host}: the late order is measured, once`).toBe(1);
        expect(measured[0], `${host}: measured as it happened, in the session it happened in`).toMatchObject({
          tenant: TENANT, visitor_id: h.grant.subject, session_id: LATE_BROWSING_SESSION,
          ts: occurredAt, event: 'purchase', value: 595, currency: 'USD',
        });

        // 3. NO FRESH VISIT. The arrival is not activity: her visit number is
        //    unchanged, and the visit clock still runs from her last LIVE
        //    interaction — the boundary falls where it would have fallen.
        expect(after.visit, `${host}: a late delivery opens no visit`).toEqual({ visitNumber: 1, entryChannel: null });
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + 1);
        expect((await h.hydrate()).visit, `${host}: the visit boundary is measured from her last live interaction, not from the delivery`)
          .toEqual({ visitNumber: 2, entryChannel: null });

        // 4. NO RECENT ODP ACTIVITY. Nothing was said to the destination on
        //    arrival, and her stored ring of recent ODP activity is the one her
        //    live visit built.
        expect(arrivalOdp, `${host}: a buffered delivery is not recent ODP activity`).toEqual([]);
        expect(ringAfterArrival, `${host}: her ring of recent ODP activity is unchanged by the arrival`).toEqual(ringBefore);

        // 5. NO REGIONAL ACTIVITY.
        expect(arrivalRegion, `${host}: a buffered delivery is not regional activity`).toEqual([]);
      }
    } finally { network.restore(); clock.mockRestore(); }
  });
});
