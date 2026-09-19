// src/units/W16/B9.unit.test.ts
// W16 batch B9 — the regression the whole-W16 review found, and the second
// derivation hiding behind one name.
//
// One `describe('unit:<id>')` per unit, one `it` per ruled leg, both hosts
// inside one `it`. Every expected value comes from a witness named beside it —
// never from what the engine returns today.
//
// WHAT THIS BATCH ANSWERS
//
//  W16.C5.08 — THE ODP WIRE GRAMMAR ON THE EVENT PATH. `src/routes/realtime.ts`
//    hands `result.update?.data?.journeyStage` to `upsertOdpProfile`, and since
//    W16-B4 that field carries the REPORTED word
//    (`src/services/RealtimeSegmentEngine.ts:703`, `journeyStage: journeyWord`;
//    at the baseline `7b01c14` the same payload line carried `deriveStage(ctx)`,
//    i.e. the persisted token). The object host still sends a token
//    (`src/durable-objects/ShopperReflex.ts:1244`, :1364) and
//    `src/services/odpLoop.ts:425-428` writes whatever string it is given, so a
//    purchase on the session host now puts `deciding` on the customer's own ODP
//    profile where the object host puts `late`. That breaks R40(b) verbatim —
//    the ODP wire value of `journey_stage` stays the persisted grammar, and
//    moving it is a customer-scope amendment for the owner, never for an agent —
//    and it breaks the admitted C5 "SessionManager, ShopperReflex, projection,
//    LearnStats, buffered action, ODP and content agree" clause. It is
//    customer-visible: the mirrored RTS audience `late_journey_ready_to_buy`
//    (`src/services/odpLoop.ts:44-49`, `docs/Coach-ODP-Wiring-Spec.md:91`) is
//    keyed on the token, and no mirrored condition matches `deciding`.
//    The read-time projection is already correct on both hosts
//    (`stageOnlyOdpProjection`, `odpLoop.ts:488-497`, maps through
//    `PERSISTED_STAGE`; unit W16.C5.02 guards it). Only the EVENT path is wrong.
//
//  W16.C5.09 — ONE DERIVATION BEHIND ONE NAME. The stored stage still comes
//    from the LEGACY CUMULATIVE rule (`deriveStage` → `stageFromCounters`,
//    `src/services/JourneyStage.ts:92-94`), fed into
//    `metadata.journeyStage` on the session host
//    (`RealtimeSegmentEngine.ts:591`, stored at `:661`/`:684`) and into
//    `pipeline.journeyStage` in the object (`ShopperReflex.ts:1244`, stored at
//    `:1337`). The journey engine's own derivation — the one that counts THIS
//    VISIT and restarts after a purchase and at a new visit (C4) — reports
//    something else. Measured by the whole-W16 review's probe 1 on both hosts:
//    after a purchase and a new visit the stored token says `late` while the
//    hydrate says `exploring`, the decision record `exploring`, the cell
//    `early` and the ladder key `s=early`. Two rules, one name.
//
// THE RULE, STATED ONCE (R85(a) and R85(b)), so no assertion below can mean two
// things:
//   (a) On EVERY path that writes `journey_stage` to the customer's
//       destination — the read-time stage projection and the event path — and on
//       BOTH hosts, the wire value is the PERSISTED token. The reported word
//       (`exploring | thinking | deciding`) never reaches the wire at all.
//   (b) The stored stage (`metadata.journeyStage`, `pipeline.journeyStage`), the
//       decision cell token, the learning ladder key and the ODP token are all
//       `PERSISTED_STAGE[<the word the journey engine reports>]` — one
//       derivation, reached through the one mapping point `PERSISTED_STAGE`
//       (R32(2)). The legacy cumulative rule feeds none of them.
//
// THE CONSEQUENCE, RECORDED AND NOT DECIDED HERE (R85(c)). Under (b) the
// purchase event itself is sent as the deciding token — the truthful ODP input
// at the moment she buys — and the next projection after the post-purchase reset
// carries the early token. So the mirrored audience `late_journey_ready_to_buy`
// no longer keeps a shopper after she has bought. That follows from the admitted
// C4 text ("purchase is the deciding current-event signal and truthful
// ODP/receipt input; reset only after decision/attribution") and the admitted C5
// "agree" clause; it is owner-visible and is named in both units' rows. No agent
// decides it here, and nothing in this file asks for a different audience.
//
// EXPECTED VALUES come from `PERSISTED_STAGE` (`src/services/JourneyStage.ts`),
// the admitted C4 and C5 text in `docs/handover/HANDOFF-2026-09-18.md` §5, the
// published journey threshold block this fixture publishes (R32(1)), and
// rulings R29, R32(2), R40(b) and R85. The ODP call is captured at the fetch
// boundary the code actually uses (`ownerFetch` → global `fetch`); no call ever
// leaves the process. The host legs drive the real mounted app and the real
// `ShopperReflex` class in process on BOTH hosts inside one `it`; `host-internal`
// legs (R19) carry only observables no shopper-facing route exposes — the stored
// stage, the decision record, its cell and the learning object's exposure row —
// and the rows name the missing public observable.
//
// The fixture below — the published documents, the journey threshold block, the
// tenant's authored ODP destination and the host doubles — is the fixture
// `src/units/W16/C5.unit.test.ts` uses, so a value measured there and a value
// measured here are the same value; only the fixture `version` string differs.
// That suite is never imported and never edited.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import { PERSISTED_STAGE, JOURNEY_STAGES, journeyWordOf } from '@/services/JourneyStage';
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
const fixtureReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w16-b9-fixture', tauMs: FIXTURE_TAU_MS, eventAttributes: 'event-when-unknown' as const };
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

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b9-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
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
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b9-fixture', note: '', value: { pieces: [
    { id: 'rogue-editorial', customerContentId: 'cms-rogue', type: 'editorial', title: 'Rogue', tags: { line: ['Rogue'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b9-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b9-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b9', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b9-fixture', note: '', value } });
  const changes = documentChanges(tenant);
  const defaults = [baseline(REFLEX_KIND, reflexDocument, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b9', arms: ['default'] } })];
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
    JWT_SECRET: 'w16-b9-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
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
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b9-fixture', note: '', value: fixtureReflexConfig }));
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

// ===========================================================================

describe('unit:W16.C5.08', () => {
  it('host: the event path writes the persisted grammar — her purchase sends exactly one profile upsert carrying the deciding TOKEN with the same attribute set on both hosts, a later stage-moving read sends a token too, and no reported word ever reaches the wire', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      const perHost: Record<string, unknown> = {};
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        mappingPointExists('W16.C5.08: the ODP wire value of journey_stage is the persisted grammar (R40(b))');
        const h = await hostFixture(host);
        const hostMark = network.calls.length;
        await threeLiveInteractions(h, clock, host);
        const vuid = await connectorIdentity(TENANT, ODP_NAMESPACE, h.grant.subject);

        // LIVE CONTROL: the destination is reachable and the configured action
        // mapping is on the wire, so every absence below is a property of the
        // grammar and not of a dead destination.
        expect(odpSince(network.calls, hostMark).filter(call => call.path === '/v3/events').length,
          `${host}: her live views reach the tenant's ODP destination`).toBeGreaterThan(0);

        // ── THE PURCHASE ────────────────────────────────────────────────────
        // HANDOFF §5 C4: the purchase is the deciding current-event signal and
        // a truthful ODP input, so the profile this event writes carries the
        // DECIDING stage — in the persisted grammar, the only grammar this wire
        // has ever spoken (R40(b), and `deriveStage(ctx)` on this same payload
        // line at the baseline `7b01c14`).
        const purchaseMark = network.calls.length;
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        const ordered = await h.action(livePurchase());
        expect(ordered.status, `${host}: her order is accepted`).toBe(200);
        expect(ordered.update?.data?.journeyStage,
          `${host}: and the engine reports her order as this visit's deciding signal`).toBe('deciding');

        const upserts = odpSince(network.calls, purchaseMark).filter(call => call.path === '/v3/profiles');
        expect(upserts.length, `${host}: W16.C5.08 — the purchase writes her ODP profile exactly once`).toBe(1);
        const attributes = attributesOf(upserts[0]!);
        expect.soft(attributes.journey_stage,
          `${host}: W16.C5.08 — and the journey_stage it writes is the PERSISTED token of that word, never the word itself (R40(b))`)
          .toBe(PERSISTED_STAGE.deciding);
        // "ODP agrees" is about the whole attribute set, not one field
        // (admitted C5): the configured profile mapping and nothing else.
        expect(Object.keys(attributes).sort(), `${host}: W16.C5.08 — the configured profile mapping, and nothing else`)
          .toEqual(ALLOWED_PROFILE_ATTRIBUTES);
        expect(attributes.vuid, `${host}: the configured identity namespace names the shopper`).toBe(vuid);
        expect(attributes.top_line, `${host}: the configured leading-line mapping, from her own memory`).toBe('Tabby');
        perHost[host] = { keys: Object.keys(attributes).sort(), journey_stage: attributes.journey_stage, top_line: attributes.top_line };

        // ── A STAGE-MOVING READ AFTERWARDS ──────────────────────────────────
        // Her next visit reaches the middle of its own journey, and then the
        // visit ends while she is away: that read moves her stage on its own
        // (R40(a)) and may send the one allowed projection — in the same
        // grammar (unit W16.C5.02 rules the payload; this clause rules only
        // that the grammar is the token here too).
        const nextVisit = T0 + 3 * STEP_MS + VISIT_GAP_MS + 1;
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(nextVisit + index * STEP_MS);
          expect((await h.action(event)).status, `${host}: her next visit's interaction ${index + 1}`).toBe(200);
        }
        const readMark = network.calls.length;
        clock.mockReturnValue(nextVisit + 2 * STEP_MS + VISIT_GAP_MS + 1);
        const rolled = await h.hydrate();
        expect(rolled.journeyStage, `${host}: the read past the boundary starts her at the vocabulary's first stage`).toBe('exploring');
        const projected = odpSince(network.calls, readMark).filter(call => call.path === '/v3/profiles');
        expect(projected.length, `${host}: the stage-moving read sends the one allowed stage projection`).toBe(1);
        expect.soft(attributesOf(projected[0]!).journey_stage,
          `${host}: W16.C5.08 — carrying the persisted token for the stage this read moved her to`)
          .toBe(PERSISTED_STAGE.exploring);

        // ── NOTHING THIS HOST EVER SAID CARRIED A REPORTED WORD ─────────────
        // Scanned over every body sent to the destination in the whole
        // sequence, with a control source that DOES contain each word, so the
        // scan is proven to have teeth instead of being assumed.
        const spoken = odpSince(network.calls, hostMark)
          .map((call, index) => ({ name: `${call.method} ${call.path} #${index}`, text: JSON.stringify(call.body) }));
        for (const word of JOURNEY_STAGES) {
          expect.soft([...spoken, { name: 'control', text: JSON.stringify({ journey_stage: word }) }]
            .filter(source => source.text.includes(`"${word}"`)).map(source => source.name),
          `${host}: W16.C5.08 — the reported word "${word}" reaches the customer's destination nowhere`).toEqual(['control']);
        }
      }
      // …and the two hosts said the same thing about the same shopper journey.
      expect.soft(perHost.session,
        'W16.C5.08 — both hosts write one profile grammar for one purchase (the admitted C5 "agree" clause)').toEqual(perHost.do);
    } finally { network.restore(); clock.mockRestore(); }
  });
});

// ===========================================================================

describe('unit:W16.C5.09', () => {
  it('host-internal: one derivation behind one name — at her purchase and again on her next visit, the reported word, the stored stage, the decision record, its cell, the ladder key and the ODP token all agree through PERSISTED_STAGE, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        mappingPointExists('W16.C5.09: one derivation, reached through the one mapping point (R32(2))');
        const h = await hostFixture(host);
        await threeLiveInteractions(h, clock, host);

        // ── AT HER PURCHASE ─────────────────────────────────────────────────
        // The purchase is the deciding signal of this visit (admitted C4, and
        // the published threshold block this fixture publishes). What the
        // engine reports for that event and what the host stores for her are
        // the same stage in two grammars, joined by the one mapping point.
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        const purchaseMark = network.calls.length;
        const ordered = await h.action(livePurchase());
        expect(ordered.status, `${host}: her order is accepted`).toBe(200);
        const orderedWord = journeyWordOf(ordered.update?.data?.journeyStage);
        expect(orderedWord, `${host}: W16.C5.09 — her order is reported as this visit's deciding signal`).toBe('deciding');
        expect.soft(h.ownedStage(),
          `${host}: W16.C5.09 — and the stage ${host === 'do' ? 'ShopperReflex' : 'SessionManager'} stored for her is that same word's persisted token`)
          .toBe(PERSISTED_STAGE[orderedWord!]);
        // …and so is what the customer's own destination was told for that
        // event: one derivation reaches the wire too (R85(b); the absolute
        // value of this same token is unit W16.C5.08's subject, so the two
        // units demand one representation and never two).
        const orderUpserts = odpSince(network.calls, purchaseMark).filter(call => call.path === '/v3/profiles');
        expect(orderUpserts.length, `${host}: her order wrote her ODP profile`).toBe(1);
        expect.soft(attributesOf(orderUpserts[0]!).journey_stage,
          `${host}: W16.C5.09 — the ODP token for her order is the persisted token of the word the engine reported for it`)
          .toBe(PERSISTED_STAGE[orderedWord!]);

        // ── HER NEXT VISIT ──────────────────────────────────────────────────
        // Past VISIT_GAP_MS the visit those counters belonged to has ended: the
        // journey restarts (admitted C4 — "reset only after
        // decision/attribution; keep visit number and cumulative taste") and
        // every reporter moves together. Her taste is untouched, which is the
        // half this unit must never break.
        const nextVisit = T0 + 3 * STEP_MS + VISIT_GAP_MS + 1;
        clock.mockReturnValue(nextVisit);
        const returned = await h.action(pdpView('Tabby', 'Handbags', 'CH-TABBY-RETURN', 415));
        expect(returned.status, `${host}: her return interaction is accepted`).toBe(200);
        const rolled = await h.hydrate();
        expect(rolled.visit, `${host}: a real return, not a fabricated one`).toEqual({ visitNumber: 2, entryChannel: null });
        expect(rolled.journeyStage, `${host}: reported the same way by the SDK-visible projection`).toBe('exploring');
        expect(rolled.affinity?.dims?.line?.Tabby ?? 0,
          `${host}: with her cumulative taste intact across the boundary`).toBeGreaterThan(0);

        // 1. WHAT THIS HOST PERSISTED. R19: no shopper-facing route exposes the
        //    stored stage, so this clause is host-internal and the row names the
        //    missing public observable. This is where the legacy cumulative rule
        //    still speaks: `deriveStage` → `stageFromCounters`
        //    (`src/services/JourneyStage.ts:92-94`), fed into
        //    `metadata.journeyStage` (`RealtimeSegmentEngine.ts:591`) and
        //    `pipeline.journeyStage` (`ShopperReflex.ts:1244`).
        expect.soft(h.ownedStage(),
          `${host}: W16.C5.09 — the stored stage is the persisted token of the word the engine now reports, from the one derivation`)
          .toBe(PERSISTED_STAGE.exploring);

        // 2. WHAT THE CONTENT DECISION DECIDED IN: the record reports the
        //    shared word beside the persisted cell token (R29/R32(2)).
        const out = await h.decide();
        expect(out.records.length, host).toBe(HOME_DECISIONS);
        const record = out.records[0]!;
        expect.soft(record.journey,
          `${host}: W16.C5.09 — the decision record names the stage it decided in`).toMatchObject({ stage: 'exploring' });
        expect.soft(record.cell.stage,
          `${host}: W16.C5.09 — and its cell carries the persisted token for that same stage`).toBe(PERSISTED_STAGE.exploring);

        // 3. WHAT THE LEARNING OBJECT WAS TOLD: the same cell, and the ladder
        //    key the statistics are pooled on (`src/learn/stats.ts:34`). Her
        //    second visit, with no entry signals observed (channel `unknown`,
        //    W16.C2.04/R14).
        const delivered = h.f.learnStats.filter(entry => entry.name === statsName(TENANT, TENANT, 'hero'));
        expect(delivered.length, `${host}: the served decision reached the slot's learning object`).toBeGreaterThan(0);
        const exposures = delivered.at(-1)!.body.exposures as Array<{ item: string; cell: { stage?: unknown } }>;
        expect(exposures.length, `${host}: one exposure for one served decision`).toBe(1);
        expect.soft(exposures[0]!.cell.stage,
          `${host}: W16.C5.09 — the LearnStats cell carries the same persisted token`).toBe(PERSISTED_STAGE.exploring);
        expect.soft(levelKeys(record.cell)[3],
          `${host}: W16.C5.09 — and the learning ladder key is that token, on her second visit`).toBe('c=unknown|v=2-3|s=early');

        // 4. THE LEGACY RULE SPEAKS NOWHERE. Once the journey engine has
        //    reported, every form of her stage above is that one derivation's;
        //    the cumulative `stageFromCounters` value — which counts her whole
        //    history and therefore still says `late` after she has bought — is
        //    not any of them. That is the whole of finding 2: two rules, one
        //    name. It is stated here as the equality of the five reporters
        //    above, not as a second computation, because a specification that
        //    recomputed the legacy value would be asserting the defect.
        //
        //    THE OWNER-VISIBLE CONSEQUENCE, RECORDED AND NOT DECIDED (R85(c)):
        //    under this rule her profile stops saying `late` once her purchase
        //    has been attributed and her next visit has opened, so the mirrored
        //    RTS audience `late_journey_ready_to_buy` (`odpLoop.ts:44-49`,
        //    `docs/Coach-ODP-Wiring-Spec.md:91`) no longer keeps a shopper after
        //    she has bought. That follows from the admitted C4 and C5 text; it
        //    is named in both rows and decided by nobody in this file.
      }
    } finally { network.restore(); clock.mockRestore(); }
  });
});
