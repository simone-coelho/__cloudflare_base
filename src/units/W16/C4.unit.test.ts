// src/units/W16/C4.unit.test.ts
// W16 criterion C4 — journey stage from versioned thresholds over visit-local
// counters, with purchase and new-visit resets — plus the first C8 unit.
//
// One `describe('unit:W16.C4.0N')` per unit of batch W16-B4, one `it` per ruled
// leg. Every expected value comes from the W16-B4 ruling table in
// `docs/remediation/LANE-LOG.md`, ruling R32 (the design rulings from the
// specification pass), R29 (the shared vocabulary and the persisted grammar),
// the admitted C4 text in `docs/handover/HANDOFF-2026-09-18.md` §5 point 4,
// document 35 §5 W16 / §2 F13, `docs/architecture/tapestry_requirements.txt`
// line 147 (Time to Relevance: "3 clicks—site adapts third interaction
// onwards"), line 148 (Journey Awareness: "exploring (seeing) → thinking →
// deciding") and line 152 (Return Visit Recognition), and the settled decision
// on buffered actions (HANDOFF §7) — never from what the engine returns today.
//
// R32(1): there is no fourth document kind. The journey threshold set is the
// `journey` block of the already-published, tenant-scoped REFLEX_KIND document
// that both hosts and the content decision already read, and the version a
// receipt names is that document's revision (`sources.config`).
//
// The host legs drive the real mounted app and the real ShopperReflex class in
// process on BOTH hosts, in the pattern of `src/units/W16/C2.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`. A `host-internal` leg (R19) is used
// only for the decision record, its receipt and the cell, which no shopper-facing
// route exposes; those rows name the missing public observable as a residual.
//
// RULED MISSING EXPORTS AND MEMBERS (R21), imported by the name this
// specification rules and RED until they exist:
//   @/services/JourneyStage : JOURNEY_STAGES, DEFAULT_JOURNEY_THRESHOLDS,
//                             journeyStageFrom, visitJourneyCounters, PERSISTED_STAGE
//   members                 : ReflexConfig.journey, DecisionSources.journey,
//                             DecisionRecord.journey, Receipt.journey

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import {
  DEFAULT_JOURNEY_THRESHOLDS, JOURNEY_STAGES, PERSISTED_STAGE, journeyStageFrom, visitJourneyCounters,
} from '@/services/JourneyStage';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { VISIT_GAP_MS } from '@/services/visit';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import {
  issueSessionCapability, newAnonymousSession, verifySessionCapability, SHOPPER_HEADER, type SessionCapability,
} from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { apply as reflexApply, effectiveScore, extractTouches, snapshot as reflexSnapshot, DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { initializePublicationSet, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import { cellFor } from '@/content/cell';
import { decideContent, type DecideInput } from '@/content/decide';
import { levelKeys } from '@/learn/stats';
import { receiptOf } from '@/learn/receipts';
import type { ContentPiece, SlotStrategy } from '@/content/types';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ---------------------------------------------------------------------------
// Customer-shaped fixtures: Coach's own taxonomy (Handbags, Small Leather Goods,
// Accessories — HANDOFF §5 C8), with a cross-category view and an unrecognized
// line in the same visit, because unknown inputs are part of the fixture.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const T0 = 1_725_000_000_000;
/** One interaction apart, well inside the visit (VISIT_GAP_MS = 30 min). */
const STEP_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Coach storefront's real event shapes (docs/kit/03-payload-schemas.md). */
const pdpView = (line: string, category: string, productId: string, priceUsd: number, dwellMs?: number) =>
  ({ type: 'product_view', data: { productId, line, category, price_usd: priceUsd, ...(dwellMs === undefined ? {} : { dwellMs }) } });
/** A real order: the reward-bearing event, with the order the outcome record names. */
const purchaseEvent = () =>
  ({ type: 'purchase', data: { orderId: 'coach-order-1', line: 'Tabby', category: 'Handbags', price_usd: 395, value: 395, currency: 'USD' } });

/** Three interactions of one visit: two Handbags PDPs and one cross-category SLG PDP. */
const THREE_INTERACTIONS = [
  pdpView('Tabby', 'Handbags', 'CH-TABBY-26', 395, 45_000),
  pdpView('Rogue', 'Handbags', 'CH-ROGUE-25', 595),
  pdpView('Wyn', 'Small Leather Goods', 'CH-WYN-WALLET', 150),
];
/** A line nobody in the taxonomy recognises, in a category that is not the first two. */
const UNKNOWN_LINE_VIEW = pdpView('not-a-coach-line', 'Accessories', 'CH-UNKNOWN-1', 95);
/** Three views of one line, so a returning shopper has one unambiguous leading interest. */
const THREE_TABBY_VIEWS = [
  pdpView('Tabby', 'Handbags', 'CH-TABBY-26', 395),
  pdpView('Tabby', 'Handbags', 'CH-TABBY-32', 450),
  pdpView('Tabby', 'Handbags', 'CH-TABBY-SHOULDER', 425),
];

// ---------------------------------------------------------------------------
// The journey threshold sets this fixture publishes. R32(1): they are the
// `journey` block of the reflex configuration document, so they are published,
// versioned and read by both hosts through the path that already exists. The
// thresholds are customer-neutral configuration; only the numbers are fixture.
//
// v1 moves the stage past the first at the THIRD interaction of the visit
// (tapestry_requirements.txt line 147, Time to Relevance) and makes a purchase
// the deciding signal (admitted criterion C4).
// ---------------------------------------------------------------------------

const JOURNEY_V1 = {
  stages: [
    { stage: 'thinking', anyOf: { interactions: 3 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};
/** A published successor that needs five interactions before thinking. */
const JOURNEY_V2 = {
  stages: [
    { stage: 'thinking', anyOf: { interactions: 5 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};
/** Two independent faults: a stage word outside the shared vocabulary and a negative threshold. */
const JOURNEY_INVALID = {
  stages: [
    { stage: 'considering', anyOf: { interactions: 2 } },
    { stage: 'deciding', anyOf: { purchases: -1 } },
  ],
};

/**
 * Days/weeks memory (document 35 §5 W16; tapestry line 152 Return Visit
 * Recognition: "Picks up where you left off"). R32(4) accepts a published
 * fourteen-day reflex `tauMs` as customer-neutral configuration for the C4
 * fixtures; the shipped compiled default (60 s, src/reflex/core.ts:202) is the
 * subject of W16.C8.01 and is used unchanged there.
 */
const FIXTURE_TAU_MS = 14 * DAY_MS;
const fixtureReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w16-b4-fixture', tauMs: FIXTURE_TAU_MS, eventAttributes: 'event-when-unknown' as const };
/** The compiled default's own memory horizon, published verbatim: what an untuned tenant gets. */
const shippedReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w16-b4-shipped-memory', eventAttributes: 'event-when-unknown' as const };
/** A reflex document carrying a journey threshold block (R32(1)). */
const withJourney = (config: Record<string, unknown>, journey: unknown | null) =>
  (journey === null ? { ...config } : { ...config, journey });

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts`; that suite is never imported and never edited.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b4-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

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

/**
 * Two live editorial pieces on one hero slot, take 1. The Rogue piece is FIRST
 * in the catalogue, so catalogue order alone serves Rogue and only a shopper's
 * own remembered interest puts Tabby in front of it (W16.C8.01).
 */
const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: { pieces: [
    { id: 'rogue-editorial', customerContentId: 'cms-rogue', type: 'editorial', title: 'Rogue', tags: { line: ['Rogue'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b4', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string, reflexDocument: unknown) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value } });
  const changes = documentChanges(tenant);
  const defaults = [baseline(REFLEX_KIND, reflexDocument, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b4', arms: ['default'] } })];
  return initializePublicationSet(env,
    defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base),
    '0:' + crypto.randomUUID());
}

/**
 * Publish the next revision of the reflex document, which is where the journey
 * thresholds live (R32(1)). Returns the publication result: a refusal keeps its
 * errors, so a validator's refusal can be told from an accident.
 */
async function publishReflex(env: Env, tenant: string, document: unknown): Promise<{ ok: boolean; errors?: string[] }> {
  const scope = reflexScopeForTenant(tenant);
  const pin = await pinPublication(env, tenant);
  const revision = pin.refs[REFLEX_KIND.name + ':' + scope]!.revision;
  const result = await publishSet(env, [{ kind: REFLEX_KIND, scope, request: document, candidate: () => document }],
    { actor: 'w16-b4-fixture', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest },
      operationId: revision + ':' + crypto.randomUUID() });
  invalidateCache();
  return result as { ok: boolean; errors?: string[] };
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  /** Every ledger message the real producer path actually sent. */
  const queued: Array<{ record?: Record<string, unknown> }> = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b4-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    // The real outcome producer path (src/ledger/enqueue.ts:87-97) sends here.
    EVENT_QUEUE: { send: async (message: { record?: Record<string, unknown> }) => { queued.push(message); } },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: fixtureReflexConfig }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
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
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* the fixture never passes through */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, queued, call, drain, configureRetention };
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
  /**
   * The horizon the host publishes to the SDK, top level and per dimension —
   * the numbers the client's own drain animation decays each bar at
   * (src/routes/realtime.ts GET /realtime/reflex `config.dims`, and the same
   * block from ShopperReflex.handleSnapshot on the object host). W16.C8.01
   * reads the per-dimension horizon here (R50(c)).
   */
  config?: { tauMs?: number; dims?: Record<string, { tauMs?: number }> };
  visit?: { visitNumber: number | null; entryChannel: string | null } | null;
  affinity?: { dims?: Record<string, Record<string, number>> } | null;
}
/** What `POST /realtime/action` answers on either host. */
interface ActionAnswer {
  status: number;
  update?: { data?: { journeyStage?: unknown } } | null;
}
/** What the mounted decisions snapshot exposes about its inputs and its answer. */
interface SnapshotAnswer {
  status: number;
  ok: unknown;
  state: unknown;
  decisions: unknown;
  first: unknown;
  journey: unknown;
  config: unknown;
}

interface HostFixture {
  f: ReturnType<typeof boundary>;
  grant: Awaited<ReturnType<typeof newAnonymousSession>>;
  principal: SessionCapability;
  /** A real accepted event through the mounted app, on whichever host this fixture runs. */
  action: (event: { type: string; data: Record<string, unknown> }, options?: { buffered?: boolean }) => Promise<ActionAnswer>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`). */
  hydrate: () => Promise<Hydrate>;
  /** R19: the mounted route production serves, `GET /v1/:tenant/decisions/snapshot`. */
  snapshot: () => Promise<SnapshotAnswer>;
  /**
   * The same decision one layer in, because no shopper-facing route exposes the
   * decision record or its cell: `/v1/:tenant/decisions/snapshot` omits `cell`
   * and `records` in offer mode (`src/routes/decisions.ts:479`). Named
   * `host-internal` per R19.
   */
  decide: () => Promise<Awaited<ReturnType<typeof serveContentDecisions>>>;
  /**
   * The same shopper returning days later with a fresh browsing session: a
   * shopper capability lives at most SHOPPER_MAX_AGE (24 h), so a return is
   * always a new one for the same subject. The returning shopper makes her
   * explicit choice again, as the SDK asks her to.
   */
  returnVisit: () => Promise<void>;
  /** The retention stamp the owner actually stored for this shopper. */
  ownedRetention: () => unknown;
}

async function hostFixture(
  host: 'session' | 'do',
  options: { journey?: unknown | null; memory?: 'fixture' | 'shipped' } = {},
): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  const base = options.memory === 'shipped' ? shippedReflexConfig : fixtureReflexConfig;
  await fixturePublication(f.env, TENANT, withJourney(base, options.journey === undefined ? JOURNEY_V1 : options.journey));
  await explicitChoice(f, grant);
  let current: Awaited<ReturnType<typeof newAnonymousSession>> = grant;
  const principal = await verifySessionCapability(f.env, grant.capability, TENANT);
  const action = async (event: { type: string; data: Record<string, unknown> }, opts: { buffered?: boolean } = {}) => {
    const response = await f.call('/realtime/action', current.capability, {
      ...event, source: 'sdk', userId: current.subject, sessionId: current.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(),
      ...(opts.buffered ? { processing: 'buffered', browsingSessionId: current.sessionId } : {}),
    });
    const body = await response.clone().json().catch(() => ({})) as { update?: { data?: { journeyStage?: unknown } } | null };
    await f.drain();
    return { status: response.status, update: body.update ?? null };
  };
  const hydrate = async () => {
    const response = await f.call('/realtime/reflex', current.capability);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Hydrate;
  };
  const snapshot = async () => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=home`, current.capability);
    const body = await response.clone().json().catch(() => ({})) as
      { ok?: unknown; decisions?: Array<{ contentId?: unknown }>; sources?: { state?: unknown; journey?: unknown; config?: unknown } };
    await f.drain();
    return { status: response.status, ok: body.ok, state: body.sources?.state, decisions: body.decisions?.length,
      first: body.decisions?.[0]?.contentId, journey: body.sources?.journey, config: body.sources?.config };
  };
  const decide = async () => {
    // Production reaches this function inside the shopper owner's invocation
    // (requireShopper → forwardShopperRequest → the object's owned operation);
    // the same admission is established here so the real guards run.
    const owner = {};
    const live = await verifySessionCapability(f.env, current.capability, TENANT);
    const out = await runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, live);
      return serveContentDecisions(f.env, {
        tenant: TENANT, page: 'home', visitorId: live.subject, sessionId: live.sessionId, cookieHeader: null,
        stateTenant: TENANT, principal: live, capability: current.capability, cf: null, channel: null,
      });
    }, f.sessions as unknown as Parameters<typeof runOwnerOperation>[3],
    undefined,
    (async () => f.objects.get(shopperObjectName(TENANT, current.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
    await f.drain();
    return out;
  };
  const returnVisit = async () => {
    current = await issueSessionCapability(f.env, { tenant: TENANT, subject: grant.subject, sessionId: `s-${crypto.randomUUID()}`, kind: 'anonymous' });
    await explicitChoice(f, current);
  };
  const ownedRetention = () => {
    if (host === 'do') {
      const owned = f.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('affinity') as { retention?: unknown } | undefined;
      return owned?.retention ?? null;
    }
    for (const raw of f.sessions.data.values()) {
      try { const value = JSON.parse(raw) as { retention?: unknown }; if (value?.retention) return value.retention; } catch { /* not a session record */ }
    }
    return null;
  };
  return { f, grant, principal, action, hydrate, snapshot, decide, returnVisit, ownedRetention };
}

/** What `documentChanges` publishes for /home: one hero slot, take 1. */
const HOME_DECISIONS = 1;

/**
 * The first assertion of every logic leg, so the RED line names both this
 * unit's missing behavior and the ruled export it needs (R21).
 */
const vocabularyExists = (what: string) => {
  expect(JOURNEY_STAGES, `${what} — src/services/JourneyStage.ts must export JOURNEY_STAGES, the one shared stage vocabulary in order`)
    .toEqual(['exploring', 'thinking', 'deciding']);
  expect(typeof journeyStageFrom, `${what} — src/services/JourneyStage.ts must export journeyStageFrom(counters, thresholds)`).toBe('function');
};

/** The counters three real interactions of one visit produce. */
const countersFor = (events: Array<{ type: string; data: Record<string, unknown> }>) =>
  events.reduce<unknown>((acc, event) => visitJourneyCounters(acc, event), null);

// ---------------------------------------------------------------------------

describe('unit:W16.C4.01', () => {
  it('logic: one ordered shared vocabulary, one published versioned threshold block on the reflex document, and a derivation that reads the thresholds as data', () => {
    // tapestry_requirements.txt line 148: "exploring (seeing) → thinking → deciding".
    vocabularyExists('W16.C4.01: the journey stage must derive from one published, versioned threshold set over the shared stage vocabulary');
    expect(JOURNEY_STAGES[0], 'the vocabulary is ordered: the first stage is where a shopper starts').toBe('exploring');
    expect(JOURNEY_STAGES[JOURNEY_STAGES.length - 1]).toBe('deciding');

    // R32(1): the threshold set is a block of the published, tenant-scoped
    // reflex document that both hosts and the content decision already read.
    const accepted = REFLEX_KIND.validate(withJourney(fixtureReflexConfig, JOURNEY_V1));
    expect(accepted.ok, 'a journey threshold block over the shared vocabulary is a valid reflex document').toBe(true);
    expect(accepted.ok && accepted.value.journey, 'the published document carries the thresholds it was given').toEqual(JOURNEY_V1);
    expect(REFLEX_KIND.validate(withJourney(fixtureReflexConfig, DEFAULT_JOURNEY_THRESHOLDS)).ok,
      'the compiled default threshold set is itself a publishable block').toBe(true);

    // Each revision carries its own version identity (stampVersion,
    // src/reflex/configStore.ts:293), which is the version a receipt names.
    const stamp = REFLEX_KIND.stamp, versionOf = REFLEX_KIND.versionOf;
    expect(typeof stamp, 'the reflex kind stamps every revision with its own version identity').toBe('function');
    expect(typeof versionOf, 'and reports it').toBe('function');
    expect(versionOf!(stamp!(fixtureReflexConfig, 3))).toMatch(/\+r3$/);
    expect(versionOf!(stamp!(fixtureReflexConfig, 4))).toMatch(/\+r4$/);

    // Bounds: a stage word outside the shared vocabulary and an out-of-range
    // threshold are both refused, and the validator returns EVERY error.
    const refused = REFLEX_KIND.validate(withJourney(fixtureReflexConfig, JOURNEY_INVALID));
    expect(refused.ok, 'an invalid journey block makes the whole document invalid').toBe(false);
    const errors = refused.ok ? [] : refused.errors;
    expect(errors.length, 'every error, not the first: the stage word AND the threshold').toBeGreaterThanOrEqual(2);
    expect(errors.join(' | '), 'the refusal names the journey block').toMatch(/journey/i);
    expect(errors.join(' | '), 'the refusal names the stage that is not in the vocabulary').toMatch(/stage/i);
    expect(errors.join(' | '), 'the refusal names the counter whose threshold is out of range').toMatch(/purchases/);
    for (const candidate of [
      { stages: [{ stage: 'exploring', anyOf: { interactions: 1 } }] },                 // the first stage is the floor; it has no threshold (W16.C4.06)
      { stages: [{ stage: 'deciding', anyOf: { purchases: 1 } }, { stage: 'thinking', anyOf: { interactions: 3 } }] }, // out of vocabulary order
      { stages: [{ stage: 'thinking', anyOf: { interactions: 1.5 } }] },                // a counted interaction is a whole number
      { stages: [{ stage: 'thinking', anyOf: { moon_phase: 3 } }] },                    // a counter the visit does not keep
      { stages: [{ stage: 'thinking', anyOf: {} }] },                                   // a stage with no threshold at all
      { stages: [] },                                                                    // a block that derives nothing
    ]) {
      expect(REFLEX_KIND.validate(withJourney(fixtureReflexConfig, candidate)).ok, JSON.stringify(candidate)).toBe(false);
    }

    // The thresholds are data, not constants: the same counters under two
    // published sets give two stages, and neither is invented by the engine.
    const counters = countersFor(THREE_INTERACTIONS);
    expect(journeyStageFrom(counters, JOURNEY_V1), 'thinking at the third interaction under v1').toBe('thinking');
    expect(journeyStageFrom(counters, JOURNEY_V2), 'the same counters under a set that needs five').toBe('exploring');
    expect(journeyStageFrom(visitJourneyCounters(counters, purchaseEvent()), JOURNEY_V1)).toBe('deciding');
    expect(journeyStageFrom(visitJourneyCounters(counters, purchaseEvent()), JOURNEY_V2)).toBe('deciding');
  });
});

describe('unit:W16.C4.02', () => {
  it('logic: visit-local counters accumulate inside one visit and start from zero in the next, and carry no durable taste', () => {
    vocabularyExists('W16.C4.02: visit-local counters must be separate from durable taste and start from zero in a new visit');
    // Three interactions of one visit, in the customer's own taxonomy, one of
    // them cross-category and one with dwell.
    const counters = countersFor(THREE_INTERACTIONS);
    expect(counters).toMatchObject({ interactions: 3, product_views: 3, purchases: 0, cart_adds: 0, wishlist_adds: 0, category_dwell_ms: 45_000 });
    expect(journeyStageFrom(counters, JOURNEY_V1)).toBe('thinking');

    // An unrecognized line is still an interaction of this visit: the counters
    // count events, they do not judge the catalogue.
    expect(visitJourneyCounters(counters, UNKNOWN_LINE_VIEW)).toMatchObject({ interactions: 4, product_views: 4 });

    // The next visit starts from zero. The counters are the visit's, so the
    // stage a shopper walks in with is the vocabulary's first stage however
    // much cumulative taste she has accumulated over previous visits.
    const nextVisit = visitJourneyCounters(null, THREE_INTERACTIONS[0]!);
    expect(nextVisit).toMatchObject({ interactions: 1, product_views: 1, purchases: 0, cart_adds: 0, wishlist_adds: 0, category_dwell_ms: 45_000 });
    expect(journeyStageFrom(nextVisit, JOURNEY_V1)).toBe('exploring');
  });

  it('host: a new visit past VISIT_GAP_MS resets the journey while the visit number increments and cumulative taste survives, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const inVisit = await h.hydrate();
        expect(inVisit.journeyStage, `${host}: three interactions of this visit`).toBe('thinking');
        expect(inVisit.visit, host).toEqual({ visitNumber: 1, entryChannel: null });
        const taste = inVisit.affinity?.dims?.line?.Tabby;
        expect(typeof taste, `${host}: the Tabby interest the three views built`).toBe('number');
        expect(taste, host).toBeGreaterThan(0);

        // The read itself crosses the visit boundary (the read-time rollover of
        // W16.C2.06). The journey is the visit's, so it starts again; the visit
        // number and the cumulative taste are not the journey's to reset.
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS);
        const nextVisit = await h.hydrate();
        expect(nextVisit.journeyStage, `${host}: a new visit starts at the first stage`).toBe('exploring');
        expect(nextVisit.visit, host).toEqual({ visitNumber: 2, entryChannel: null });
        expect(nextVisit.affinity?.dims?.line?.Tabby, `${host}: cumulative taste is not reset with the journey`).toBeCloseTo(taste!, 2);

        // The new visit's own counters start from zero: one interaction is one,
        // not the fourth of a visit that has ended.
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + STEP_MS);
        expect((await h.action(UNKNOWN_LINE_VIEW)).status, host).toBe(200);
        const afterOne = await h.hydrate();
        expect(afterOne.journeyStage, `${host}: the first interaction of the new visit`).toBe('exploring');
        expect(afterOne.visit, host).toEqual({ visitNumber: 2, entryChannel: null });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C4.03', () => {
  it('host: the decision made on the purchase event itself counts the purchase and reports deciding, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // Two interactions: under the published set, still the first stage.
        for (const [index, event] of THREE_INTERACTIONS.slice(0, 2).entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: two interactions, thresholds say three`).toBe('exploring');

        // The purchase is the deciding CURRENT-EVENT signal: the personalization
        // decision computed for the purchase event is computed WITH the purchase
        // counted, not from the state that preceded it. This value is also what
        // both hosts hand to upsertOdpProfile as the ODP-bound stage input
        // (src/routes/realtime.ts:281 and src/durable-objects/ShopperReflex.ts:1255),
        // so an untruthful stage here is an untruthful ODP profile.
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const answer = await h.action(purchaseEvent());
        expect(answer.status, host).toBe(200);
        expect(answer.update, `${host}: the purchase moves the stage, so the shopper's own decision is answered`).toBeTruthy();
        expect(answer.update?.data?.journeyStage, `${host}: the purchase decision`).toBe('deciding');
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C4.04', () => {
  it('host: the persisted visit-local counters reset only after the purchase decision and its captured attribution, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const before = await h.hydrate();
        expect(before.journeyStage, host).toBe('thinking');
        const taste = before.affinity?.dims?.line?.Tabby;
        expect(typeof taste, host).toBe('number');

        // 1. The purchase decision and its attribution are captured FIRST, with
        //    the purchase counted.
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        expect((await h.action(purchaseEvent())).update?.data?.journeyStage, `${host}: the purchase decision itself`).toBe('deciding');

        // 2. R32(3): the attribution is captured, not assumed — the purchase
        //    outcome for this order reached the ledger producer before the next
        //    personalization decision was asked for.
        const attributed = h.f.queued.filter(message =>
          (message.record as { visitor_id?: unknown } | undefined)?.visitor_id === h.grant.subject
          && (message.record as { item_id?: unknown } | undefined)?.item_id === 'coach-order-1');
        expect(attributed.length, `${host}: the purchase outcome is captured before the counters reset`).toBeGreaterThan(0);

        // 3. Only then are the persisted visit-local counters reset, so the NEXT
        //    personalization decision starts from reset counters — inside the
        //    same visit, with the cumulative taste the purchase itself grew.
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        const next = await h.hydrate();
        expect(next.journeyStage, `${host}: the next decision after the purchase`).toBe('exploring');
        expect(next.visit, `${host}: the reset is not a new visit`).toEqual({ visitNumber: 1, entryChannel: null });
        const grown = next.affinity?.dims?.line?.Tabby;
        expect(grown, `${host}: the purchase's own interest was accumulated, not discarded with the counters`).toBeGreaterThan(taste!);

        // 4. The reset is real: the counters restart, so one interaction after
        //    the purchase is one interaction, not the fifth. The cumulative
        //    taste is not touched again by the reset.
        clock.mockReturnValue(T0 + 5 * STEP_MS);
        expect((await h.action(UNKNOWN_LINE_VIEW)).status, host).toBe(200);
        const afterOne = await h.hydrate();
        expect(afterOne.journeyStage, `${host}: one interaction into the post-purchase journey`).toBe('exploring');
        expect(afterOne.visit, host).toEqual({ visitNumber: 1, entryChannel: null });
        expect(afterOne.affinity?.dims?.line?.Tabby, `${host}: cumulative taste is unchanged by the reset`).toBeCloseTo(grown!, 2);

        // 5. Two more, and the third interaction moves the stage again on the
        //    published thresholds — the shopper is browsing on after her order.
        for (const [index, event] of THREE_INTERACTIONS.slice(0, 2).entries()) {
          clock.mockReturnValue(T0 + (6 + index) * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 7 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: three interactions after the reset`).toBe('thinking');
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C4.05', () => {
  it('host: a new threshold version applies to subsequent decisions, an invalid set is refused, and with nothing ever published the compiled default decides and names itself, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: three interactions under the published version`).toBe('thinking');
        // R32(1): the version a decision names is the reflex document's own
        // revision, beside the catalog, slots and learn versions it already
        // names. The publication baseline is stored unstamped (publication.ts:465-469),
        // so revision 1 carries the document's bare version name.
        expect(await h.snapshot(), host).toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
          // R10, lead addendum from the W16-B4 specification pass 2: the hero slot carries no stage rule
          // and neither piece a journeyStageFit, so nothing in C4 changes the served piece
          // (src/content/decide.ts:128-130 — `hasStage` is false); with one view each the Rogue piece,
          // first in the catalogue, is the one the engine serves at every revision.
          first: 'rogue-editorial', journey: { version: 'w16-b4-fixture', revision: 1, reason: null },
          config: { label: 'w16-b4-fixture', revision: 1 } });

        // Publishing the next version changes the derivation for subsequent
        // decisions, with no new event: the same counters, a later threshold.
        expect((await publishReflex(h.f.env, TENANT, withJourney(fixtureReflexConfig, JOURNEY_V2))).ok, `${host}: publish version 2`).toBe(true);
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: version 2 needs five interactions`).toBe('exploring');
        expect(await h.snapshot(), host).toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
          // R10, lead addendum from the W16-B4 specification pass 2: the hero slot carries no stage rule
          // and neither piece a journeyStageFit, so nothing in C4 changes the served piece
          // (src/content/decide.ts:128-130 — `hasStage` is false); with one view each the Rogue piece,
          // first in the catalogue, is the one the engine serves at every revision.
          first: 'rogue-editorial', journey: { version: 'w16-b4-fixture+r2', revision: 2, reason: null },
          config: { label: 'w16-b4-fixture+r2', revision: 2 } });

        // An invalid set never becomes the threshold in force: the validator
        // refuses it, naming the fault, and the last published version decides.
        const refused = await publishReflex(h.f.env, TENANT, withJourney(fixtureReflexConfig, JOURNEY_INVALID));
        expect(refused.ok, `${host}: an invalid threshold set is refused at publication`).toBe(false);
        expect((refused.errors ?? []).join(' | '), `${host}: the refusal names the journey fault`).toMatch(/journey/i);
        expect((refused.errors ?? []).join(' | '), `${host}: and the stage word it does not recognise`).toMatch(/stage/i);
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: still version 2`).toBe('exploring');
        expect(await h.snapshot(), host).toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
          // R10, lead addendum from the W16-B4 specification pass 2: the hero slot carries no stage rule
          // and neither piece a journeyStageFit, so nothing in C4 changes the served piece
          // (src/content/decide.ts:128-130 — `hasStage` is false); with one view each the Rogue piece,
          // first in the catalogue, is the one the engine serves at every revision.
          first: 'rogue-editorial', journey: { version: 'w16-b4-fixture+r2', revision: 2, reason: null },
          config: { label: 'w16-b4-fixture+r2', revision: 2 } });
      }

      // NOTHING EVER PUBLISHED: the reflex document carries no journey block.
      //
      // R10 update, witness R49 (2026-09-19, from the W16-B4 build review's
      // P1e/P1g measurement): an untuned tenant is not a tenant with a broken
      // publication. The compiled default set DEFAULT_JOURNEY_THRESHOLDS
      // decides — exactly as the REST of DEFAULT_REFLEX_CONFIG (τ, K, the
      // thresholds, the dimension registry) is the compiled default an untuned
      // tenant runs on — so three interactions reach the SECOND stage of the
      // vocabulary here too, and the learning ladder and the slot stage rule
      // keep working for every tenant that has tuned nothing. The engine still
      // invents nothing: it names the compiled default it used, at revision 0,
      // because no revision of the tenant's document supplied it.
      //
      // Fail-closed is unchanged where a tenant HAS spoken: the invalid-set
      // clause above still keeps the last published block in force.
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { journey: null });
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, `${host}: unpublished thresholds must not refuse an event`).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        // The compiled default moves the stage at the third interaction
        // (DEFAULT_JOURNEY_THRESHOLDS, tapestry_requirements.txt line 147), so
        // the three interactions of this visit reach 'thinking' here.
        expect(DEFAULT_JOURNEY_THRESHOLDS.stages.find((s) => s.stage === 'thinking')?.anyOf.interactions,
          'the compiled default moves the stage at the third interaction (tapestry line 147)').toBe(3);
        expect((await h.hydrate()).journeyStage, `${host}: R49 — with nothing published the compiled default decides, so the third interaction moves the stage`).toBe('thinking');
        const served = await h.snapshot();
        expect(served, `${host}: served, with the compiled default named as the set that decided, at revision 0`)
          // R10, lead addendum from the W16-B4 specification pass 2: the hero slot carries no stage rule
          // and neither piece a journeyStageFit, so nothing in C4 changes the served piece
          // (src/content/decide.ts:128-130 — `hasStage` is false); with one view each the Rogue piece,
          // first in the catalogue, is the one the engine serves with nothing published either.
          .toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS, first: 'rogue-editorial',
            // R49: the version a receipt names here is the COMPILED DEFAULT's
            // own version — the version field of the compiled default reflex
            // configuration the set travels with — never the tenant's document
            // version, which did not supply the thresholds, and never null now
            // that a set decided. Revision 0: no published revision supplied it.
            journey: { version: DEFAULT_REFLEX_CONFIG.version, revision: 0, reason: expect.stringMatching(/default/i) },
            config: { label: 'w16-b4-fixture', revision: 1 } });
        const reason = (served.journey as { reason: string }).reason;
        expect(reason, `${host}: the diagnostic says WHICH set decided — the journey thresholds of the compiled default`).toMatch(/journey/i);
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: every decision record and receipt names the stage it decided in and the threshold version used, before and after a purchase, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const browsing = await h.decide();
        expect(browsing.records.length, host).toBe(HOME_DECISIONS);
        const record = browsing.records[0]!;
        const names = new Map([[record.item_id, { customerContentId: record.customer_item_id, title: 'Tabby' }]]);
        expect(record.journey, `${host}: the record carries the stage it decided in and the version that derived it`)
          .toEqual({ stage: 'thinking', version: 'w16-b4-fixture' });
        expect(browsing.sources.journey, host).toEqual({ version: 'w16-b4-fixture', revision: 1, reason: null });
        expect(browsing.sources.journey, `${host}: the version a receipt names is the reflex document's revision (R32)`)
          .toMatchObject({ version: browsing.sources.config.label, revision: browsing.sources.config.revision });
        // The receipts route reads the same records through receiptOf
        // (src/routes/decisions.ts:312), so the shopper's own receipt says it.
        expect(receiptOf(record, names).journey, `${host}: the shopper's own receipt names the stage and the version`)
          .toEqual({ stage: 'thinking', version: 'w16-b4-fixture' });

        // After the purchase the counters are reset, so the next decision is
        // taken at the first stage — and its receipt says exactly that. No
        // receipt claims a stage the counters it decided on do not support.
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        expect((await h.action(purchaseEvent())).update?.data?.journeyStage, host).toBe('deciding');
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        const after = await h.decide();
        const afterRecord = after.records[0]!;
        expect(afterRecord.journey, `${host}: the post-purchase decision record`).toEqual({ stage: 'exploring', version: 'w16-b4-fixture' });
        expect(receiptOf(afterRecord, names).journey, `${host}: the post-purchase receipt`).toEqual({ stage: 'exploring', version: 'w16-b4-fixture' });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C4.06', () => {
  it('logic: absent counters derive the first stage, the third interaction moves it, and a buffered delivery is not a fresh interaction', () => {
    vocabularyExists("W16.C4.06: cold start derives the vocabulary's first stage and the third interaction moves it, with no invented interaction");
    // Cold start: nothing counted is the vocabulary's first stage, and no
    // interaction is invented to get there.
    expect(journeyStageFrom(undefined, DEFAULT_JOURNEY_THRESHOLDS)).toBe('exploring');
    expect(journeyStageFrom(null, DEFAULT_JOURNEY_THRESHOLDS)).toBe('exploring');
    expect(journeyStageFrom({}, DEFAULT_JOURNEY_THRESHOLDS)).toBe('exploring');
    expect(journeyStageFrom({ interactions: 0, product_views: 0, purchases: 0 }, DEFAULT_JOURNEY_THRESHOLDS)).toBe('exploring');

    // Time to Relevance (tapestry_requirements.txt line 147: "3 clicks—site
    // adapts third interaction onwards"). On the compiled default thresholds the
    // third interaction of the visit moves the stage past the first.
    const one = visitJourneyCounters(null, THREE_INTERACTIONS[0]!);
    const two = visitJourneyCounters(one, THREE_INTERACTIONS[1]!);
    const three = visitJourneyCounters(two, THREE_INTERACTIONS[2]!);
    expect(three).toMatchObject({ interactions: 3 });
    expect(journeyStageFrom(one, DEFAULT_JOURNEY_THRESHOLDS)).toBe('exploring');
    expect(journeyStageFrom(three, DEFAULT_JOURNEY_THRESHOLDS)).toBe('thinking');
    expect(JOURNEY_STAGES.indexOf(journeyStageFrom(three, DEFAULT_JOURNEY_THRESHOLDS)))
      .toBeGreaterThan(JOURNEY_STAGES.indexOf('exploring'));

    // Buffered actions (HANDOFF-2026-09-18 §7, D06-buffered-action-purpose):
    // an explicitly buffered delivery contributes age-decayed interest, and must
    // not create fresh visits or recent activity. It is therefore not one of
    // this visit's interactions, whatever it carries.
    const buffered = { ...THREE_INTERACTIONS[0]!, processing: 'buffered' as const, eventId: 'buffered-1', timestamp: T0 - DAY_MS, browsingSessionId: 'earlier-session' };
    expect(visitJourneyCounters(three, buffered), 'a buffered delivery counts as no interaction of the current visit').toEqual(three);
    // A threshold set that turns on the FOURTH interaction, so the difference
    // between a buffered delivery and a live one is visible in the stage.
    const fourth = { stages: [{ stage: 'thinking', anyOf: { interactions: 4 } }, { stage: 'deciding', anyOf: { purchases: 1 } }] };
    expect(journeyStageFrom(three, fourth)).toBe('exploring');
    expect(journeyStageFrom(visitJourneyCounters(three, buffered), fourth), 'a buffered delivery does not move the stage').toBe('exploring');
    // The same action delivered live is an interaction, so the rule is about the
    // delivery and not about the event.
    expect(visitJourneyCounters(three, THREE_INTERACTIONS[0]!)).toMatchObject({ interactions: 4 });
    expect(journeyStageFrom(visitJourneyCounters(three, THREE_INTERACTIONS[0]!), fourth), 'the same action delivered live does').toBe('thinking');
    // A buffered purchase is not the current deciding signal either.
    expect(visitJourneyCounters(three, { ...purchaseEvent(), processing: 'buffered' as const, eventId: 'buffered-2', timestamp: T0 - DAY_MS, browsingSessionId: 'earlier-session' }))
      .toEqual(three);
  });
});

describe('unit:W16.C4.07', () => {
  it('host: both hosts derive the same stage for the same sequence and the SDK-visible projection carries it under the shared vocabulary', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const browsing: Record<string, unknown> = {}, buying: Record<string, unknown> = {}, updates: Record<string, unknown> = {};
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        browsing[host] = (await h.hydrate()).journeyStage;
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        updates[host] = (await h.action(purchaseEvent())).update?.data?.journeyStage;
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        buying[host] = (await h.hydrate()).journeyStage;
      }
      // The SDK-visible hydrate carries the stage as one of the three shared
      // words on both hosts (tapestry line 148) — today the session host omits
      // the field while it personalizes (src/routes/realtime.ts:442) and the
      // object host answers with its internal token (ShopperReflex.ts:1608).
      for (const host of ['session', 'do'] as const) {
        expect(browsing[host], `${host}: three interactions`).toBe('thinking');
        expect(updates[host], `${host}: the purchase decision`).toBe('deciding');
        expect(buying[host], `${host}: the decision after the purchase reset`).toBe('exploring');
      }
      expect(browsing.session, 'both hosts derive the same stage for the same sequence').toBe(browsing.do);
      expect(updates.session).toBe(updates.do);
      expect(buying.session).toBe(buying.do);
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C4.08', () => {
  it('logic: one mapping point keeps the persisted cell token and the learning stage key unchanged while the engine reports the shared word', () => {
    vocabularyExists('W16.C4.08: the persisted cell token and the learning stage key must be unchanged after C4');
    // R32(2)/R29: exactly one mapping point between the reported vocabulary and
    // the persisted grammar. The persisted token is not a second vocabulary to
    // derive; it is what the cell, the ladder and the stored session already use.
    expect(PERSISTED_STAGE, 'src/services/JourneyStage.ts must export PERSISTED_STAGE, the one mapping point (R32(2))')
      .toEqual({ exploring: 'early', thinking: 'mid', deciding: 'late' });

    const reported = journeyStageFrom(countersFor(THREE_INTERACTIONS), JOURNEY_V1);
    expect(reported).toBe('thinking');
    // The cell keeps the persisted grammar: the shared word is mapped, never stored.
    expect(cellFor({ cfg: DEFAULT_REFLEX_CONFIG, channel: 'direct', visitNumber: 2, stage: PERSISTED_STAGE[reported] }).stage).toBe('mid');
    // The learning ladder key is unchanged (src/learn/stats.ts:34).
    expect(levelKeys({ channel: 'direct', visit_bucket: '2-3', region: null, affinity: null, stage: PERSISTED_STAGE[reported] })[3])
      .toBe('c=direct|v=2-3|s=mid');

    // The W18.01 slot stage rule still fires on that cell (src/content/decide.ts:128):
    // a piece made for another stage is demoted and one made for this stage is
    // favoured, exactly as before C4.
    const piece = (id: string, tags: Record<string, string[]>, fit?: ContentPiece['journeyStageFit']): ContentPiece =>
      ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...(fit ? { journeyStageFit: fit } : {}) });
    const slots: SlotStrategy[] = [{ slot: 'hero', take: 3, weights: { occasion: 0.5 }, stage: { outOfStage: 0.5, inStage: 0.1 } }];
    const input: DecideInput = {
      tenant: TENANT, brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor', nowMs: T0,
      pieces: [piece('discover', { occasion: ['evening'] }, ['exploring']), piece('compare', { occasion: ['weekend'] }, ['considering', 'deciding']), piece('any', { occasion: ['weekend'] })],
      slots, affinity: { dims: { occasion: { evening: 0.8, weekend: 0.4 } } },
      cell: { channel: 'direct', visit_bucket: '2-3', region: 'US-NY', affinity: 'occasion:evening', stage: PERSISTED_STAGE[reported] },
      arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
    };
    const out = decideContent(input);
    expect(out.decisions.map(d => d.contentId), 'the stage rule still reorders the slot').toEqual(['compare', 'discover', 'any']);
    expect(out.records.find(r => r.item_id === 'discover')!.explain.stage?.applied, 'out of stage is still demoted').toBe(-0.2);
    expect(out.records.find(r => r.item_id === 'compare')!.explain.stage?.applied, 'in stage is still favoured').toBe(0.1);
  });

  it('host: the mounted routes serve the shared vocabulary for the same shopper, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        // The SDK-visible projection reports the shared word …
        expect((await h.hydrate()).journeyStage, `${host}: the reported vocabulary`).toBe('thinking');
        // … and the page is still served, with the same one decision as before C4.
        expect(await h.snapshot(), host).toMatchObject({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS });
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: the decision cell still carries the persisted token and the learning ladder key is unchanged, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const out = await h.decide();
        const record = out.records[0]!;
        // R29: the persisted grammar is unchanged by C4 — the cell token and the
        // ladder key the learning statistics are keyed on stay exactly as they were.
        expect(record.cell.stage, `${host}: the persisted cell token`).toBe('mid');
        expect(levelKeys(record.cell)[3], `${host}: the learning ladder key`).toBe(`c=${record.cell.channel}|v=${record.cell.visit_bucket}|s=mid`);
        // …while the same record reports the shared word to a reader.
        expect(record.journey, `${host}: the reported stage beside the persisted token`)
          .toEqual({ stage: 'thinking', version: 'w16-b4-fixture' });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C8.01', () => {
  /** Three views of one line, as the engine's own core accumulates them. */
  const rememberedTabby = (config: { tauMs: number; K: number; weights: Record<string, number>; dimensions: unknown[] }) =>
    THREE_TABBY_VIEWS.reduce<ReturnType<typeof reflexApply>['state'] | undefined>(
      (state, _view, index) => reflexApply(state, { action: 'product_view', touches: [{ dim: 'line', value: 'Tabby' }] },
        T0 + index * STEP_MS, config as never).state, undefined)!;

  /**
   * One product of her visit in the customer's own taxonomy, carrying a value
   * for EVERY dimension the shipped default scores — the Tabby shoulder bag she
   * viewed, met through this fixture's editorial content (the catalogue here
   * serves editorial pieces). R50(c): the memory horizon is the product's, so
   * every dimension she is remembered in is held to it, not only the line.
   */
  const HER_PRODUCT = {
    id: 'CH-TABBY-26', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
    silhouette: 'shoulder', occasion: ['work', 'everyday'], price_usd: 395, contentType: 'editorial',
  };
  /** The same three views, through the engine's own touch extraction, in every dimension. */
  const rememberedEverywhere = (config: typeof DEFAULT_REFLEX_CONFIG) =>
    THREE_TABBY_VIEWS.reduce<ReturnType<typeof reflexApply>['state'] | undefined>(
      (state, _view, index) => reflexApply(state, { action: 'product_view', touches: extractTouches(HER_PRODUCT, config) },
        T0 + index * STEP_MS, config).state, undefined)!;
  /** The engine's own rule for the horizon a dimension runs on (src/reflex/core.ts, dimParams). */
  const effectiveTau = (spec: { tauMs?: number }, config: { tauMs: number }) => spec.tauMs ?? config.tauMs;
  /** Her interest in one dimension, as the state holds it: the first value that dimension carries. */
  const interestIn = (state: ReturnType<typeof reflexApply>['state'], dim: string) => Object.entries(state.dims[dim] ?? {})[0];

  it("logic: the shipped memory horizon still holds a shopper's interest after 7 and after 14 days, in every dimension it remembers her in", () => {
    // tapestry_requirements.txt line 152, Return Visit Recognition: "Picks up
    // where you left off, remembers what you were considering"; document 35 §5
    // W16 "days/weeks memory". The compiled default is what an untuned tenant
    // gets, so the horizon it expresses is the product's memory.
    //
    // "Remembers" has the engine's own definition: an entry whose effective
    // score falls below the prune floor ε is dropped from the shopper's state
    // (src/reflex/core.ts, step 2 of apply) — that is what forgetting IS here.
    const state = rememberedTabby(DEFAULT_REFLEX_CONFIG);
    const entry = state.dims.line!.Tabby!;
    const remembered = (days: number) => effectiveScore(entry, T0 + days * DAY_MS, DEFAULT_REFLEX_CONFIG.tauMs);
    expect(reflexSnapshot(state, T0 + 2 * STEP_MS, DEFAULT_REFLEX_CONFIG).dims.line?.Tabby,
      'three views of one line build the interest that drives her decision').toBeGreaterThan(0);

    expect(remembered(7), 'W16.C8.01: after 7 days the shipped memory horizon still holds the interest that drove her last decision, above the engine\'s own prune floor')
      .toBeGreaterThan(DEFAULT_REFLEX_CONFIG.epsilon);
    expect(remembered(14), 'W16.C8.01: and after 14 days').toBeGreaterThan(DEFAULT_REFLEX_CONFIG.epsilon);
    // A memory horizon, not a freeze: it fades, it does not vanish.
    expect(remembered(14)).toBeLessThan(remembered(0));

    // R50(c) (2026-09-19): the horizon is the PRODUCT's memory, not one field's.
    // Every dimension the shipped default remembers her in is held to it, and a
    // per-dimension `tauMs` override is that dimension's OWN horizon — so each
    // is read at the effective τ the engine itself would use, `spec?.tauMs ??
    // config.tauMs` (src/reflex/core.ts, dimParams). R50(a): the shipped
    // override scales with the top-level horizon rather than standing still at
    // a demo cadence, so a dimension cannot be forgotten while the rest is
    // remembered.
    const everywhere = rememberedEverywhere(DEFAULT_REFLEX_CONFIG);
    expect(DEFAULT_REFLEX_CONFIG.dimensions.some((spec) => spec.tauMs !== undefined),
      'R50(a): the shipped default carries at least one per-dimension horizon of its own, and this unit holds it to the same memory').toBe(true);
    for (const spec of DEFAULT_REFLEX_CONFIG.dimensions) {
      const tauMs = effectiveTau(spec, DEFAULT_REFLEX_CONFIG);
      const held = interestIn(everywhere, spec.key);
      expect(held, `her own product touches the shipped dimension "${spec.key}", so the interest held there is real`).toBeDefined();
      const [value, entry] = held!;
      expect(effectiveScore(entry, T0 + 7 * DAY_MS, tauMs),
        `W16.C8.01: after 7 days the shipped horizon of dimension "${spec.key}" (effective τ ${tauMs} ms, value "${value}") still holds the interest that drove her last decision, above the engine's own prune floor`)
        .toBeGreaterThan(DEFAULT_REFLEX_CONFIG.epsilon);
      expect(effectiveScore(entry, T0 + 14 * DAY_MS, tauMs),
        `W16.C8.01: and after 14 days for dimension "${spec.key}" (effective τ ${tauMs} ms)`)
        .toBeGreaterThan(DEFAULT_REFLEX_CONFIG.epsilon);
      // Still a horizon, not a freeze, in every dimension.
      expect(effectiveScore(entry, T0 + 14 * DAY_MS, tauMs), `"${spec.key}" fades`).toBeLessThan(effectiveScore(entry, T0, tauMs));
    }
  });

  it('host: the memory horizon the mounted host publishes carries her interest across days in every dimension, and a return renews nothing, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        // An untuned tenant: the shipped memory horizon, published as it ships.
        const h = await hostFixture(host, { memory: 'shipped' });
        for (const [index, event] of THREE_TABBY_VIEWS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        // Her own taste decides the slot: Rogue is first in the catalogue, so
        // only a remembered interest can put Tabby in front of it.
        expect(await h.snapshot(), host).toMatchObject({ status: 200, ok: true, decisions: HOME_DECISIONS, first: 'tabby-editorial' });
        const first = await h.hydrate();
        const retention = h.ownedRetention();
        expect(retention, `${host}: the owner stored a retention stamp for this shopper`).toBeTruthy();

        // The horizon this host publishes to the SDK is the one her memory
        // decays on (the client animates the same numbers). Reconstruct her
        // interest with the engine's own core under exactly that horizon: the
        // host's own answer proves the reconstruction is the same arithmetic.
        const published = first.config;
        expect(typeof published?.tauMs, `${host}: the hydrate publishes the memory horizon`).toBe('number');
        const config = { ...DEFAULT_REFLEX_CONFIG, tauMs: published!.tauMs! };
        const state = rememberedTabby(config);
        expect(reflexSnapshot(state, T0 + 2 * STEP_MS, config).dims.line?.Tabby, `${host}: the same interest the host answered with`)
          .toBeCloseTo(first.affinity?.dims?.line?.Tabby ?? -1, 6);
        const entry = state.dims.line!.Tabby!;
        expect(effectiveScore(entry, T0 + 7 * DAY_MS, config.tauMs),
          `${host}: W16.C8.01 — the horizon this host publishes must still hold her interest after 7 days, above the engine's prune floor`)
          .toBeGreaterThan(config.epsilon);
        expect(effectiveScore(entry, T0 + 14 * DAY_MS, config.tauMs), `${host}: and after 14 days`).toBeGreaterThan(config.epsilon);

        // R50(c): every dimension this host remembers her in, at the horizon
        // THIS HOST publishes for that dimension. The hydrate publishes the
        // per-dimension overrides beside the top-level τ precisely so the
        // client decays each bar at its true rate, so a dimension's own horizon
        // is a public observable and is held to the same 7- and 14-day memory.
        const everywhere = rememberedEverywhere({ ...DEFAULT_REFLEX_CONFIG, tauMs: published!.tauMs! });
        for (const spec of DEFAULT_REFLEX_CONFIG.dimensions) {
          if (spec.tauMs !== undefined) {
            expect(typeof published?.dims?.[spec.key]?.tauMs,
              `${host}: the hydrate publishes the horizon of dimension "${spec.key}", which the shipped default tunes on its own (R50(a))`).toBe('number');
          }
          const publishedTau = published?.dims?.[spec.key]?.tauMs ?? published!.tauMs!;
          const held = interestIn(everywhere, spec.key);
          expect(held, `${host}: her own product touches the shipped dimension "${spec.key}"`).toBeDefined();
          expect(effectiveScore(held![1], T0 + 7 * DAY_MS, publishedTau),
            `${host}: W16.C8.01 — the horizon this host publishes for dimension "${spec.key}" (τ ${publishedTau} ms) must still hold her interest after 7 days, above the engine's prune floor`)
            .toBeGreaterThan(config.epsilon);
          expect(effectiveScore(held![1], T0 + 14 * DAY_MS, publishedTau),
            `${host}: and after 14 days for dimension "${spec.key}"`).toBeGreaterThan(config.epsilon);
        }

        // A real return, past the visit boundary: she picks up where she left
        // off, and browsing on the return renews nothing (the retained-data
        // stamp stays the one her record was born with).
        clock.mockReturnValue(T0 + 2 * VISIT_GAP_MS);
        const returned = await h.hydrate();
        expect(returned.visit?.visitNumber, `${host}: a return is a new visit`).toBe(2);
        expect(await h.snapshot(), `${host}: W16.C8.01 — a returning shopper picks up where she left off (tapestry line 152)`)
          .toMatchObject({ status: 200, ok: true, decisions: HOME_DECISIONS, first: 'tabby-editorial' });
        expect(h.ownedRetention(), `${host}: the return itself renews no retention`).toEqual(retention);
      }
    } finally { clock.mockRestore(); }
  });
});
