// src/units/W16/C4.unit.test.ts
// W16 criterion C4 — journey stage from versioned thresholds over visit-local
// counters, with purchase and new-visit resets.
//
// One `describe('unit:W16.C4.0N')` per unit of batch W16-B4, one `it` per ruled
// leg. Every expected value comes from the W16-B4 ruling table in
// `docs/remediation/LANE-LOG.md`, the admitted C4 text in
// `docs/handover/HANDOFF-2026-09-18.md` §5 point 4, document 35 §5 W16 / §2 F13,
// `docs/architecture/tapestry_requirements.txt` lines 147 (Time to Relevance:
// "3 clicks—site adapts third interaction onwards") and 149 (Journey Awareness:
// "exploring (seeing) → thinking → deciding"), and the settled decision on
// buffered actions (HANDOFF §7: they must not create fresh visits or recent
// activity) — never from what the engine returns today.
//
// The host legs drive the real mounted app and the real ShopperReflex class in
// process on BOTH hosts, in the pattern of `src/units/W16/C2.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`. A `host-internal` leg (R19) is used
// only for the decision record and its receipt, which no shopper-facing route
// exposes; each such row names the missing public observable as its residual.
//
// RULED MISSING EXPORTS (R21), imported by the name this specification rules and
// RED until they exist:
//   @/services/JourneyStage : JOURNEY_STAGES, DEFAULT_JOURNEY_THRESHOLDS,
//                             journeyStageFrom, visitJourneyCounters
//   @/content/kinds         : JOURNEY_KIND
// and the ruled missing members `DecisionSources.journey`, `DecisionRecord.journey`
// and `Receipt.journey`.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import {
  DEFAULT_JOURNEY_THRESHOLDS, JOURNEY_STAGES, journeyStageFrom, visitJourneyCounters,
} from '@/services/JourneyStage';
import { CONTENT_KIND, JOURNEY_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
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
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { initializePublicationSet, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import { receiptOf } from '@/learn/receipts';
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

/** The Coach storefront's real event shapes (docs/kit/03-payload-schemas.md). */
const pdpView = (line: string, category: string, productId: string, priceUsd: number, dwellMs?: number) =>
  ({ type: 'product_view', data: { productId, line, category, price_usd: priceUsd, ...(dwellMs === undefined ? {} : { dwellMs }) } });
const purchaseEvent = () =>
  ({ type: 'purchase', data: { productId: 'CH-TABBY-26', line: 'Tabby', category: 'Handbags', price_usd: 395, orderId: 'coach-order-1' } });

/** Three interactions of one visit: two Handbags PDPs and one cross-category SLG PDP. */
const THREE_INTERACTIONS = [
  pdpView('Tabby', 'Handbags', 'CH-TABBY-26', 395, 45_000),
  pdpView('Rogue', 'Handbags', 'CH-ROGUE-25', 595),
  pdpView('Wyn', 'Small Leather Goods', 'CH-WYN-WALLET', 150),
];
/** A line nobody in the taxonomy recognises, in a category that is not the first two. */
const UNKNOWN_LINE_VIEW = pdpView('not-a-coach-line', 'Accessories', 'CH-UNKNOWN-1', 95);

// ---------------------------------------------------------------------------
// The journey threshold documents this fixture publishes. The engine reads the
// thresholds as data; these are the customer-neutral configuration, and the only
// Coach-specific thing about them is that they live in a fixture.
//
// v1 moves the stage past the first at the THIRD interaction of the visit
// (tapestry_requirements.txt line 147, Time to Relevance) and makes a purchase
// the deciding signal (admitted criterion C4).
// ---------------------------------------------------------------------------

const JOURNEY_V1 = {
  version: 'coach-journey',
  stages: [
    { stage: 'thinking', anyOf: { interactions: 3 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};
/** A published successor that needs five interactions before thinking. */
const JOURNEY_V2 = {
  version: 'coach-journey',
  stages: [
    { stage: 'thinking', anyOf: { interactions: 5 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};
/** Two independent faults: a stage word outside the shared vocabulary and a negative threshold. */
const JOURNEY_INVALID = {
  version: 'coach-journey',
  stages: [
    { stage: 'considering', anyOf: { interactions: 2 } },
    { stage: 'deciding', anyOf: { purchases: -1 } },
  ],
};

/**
 * Days/weeks memory (document 35 §5 W16: "days/weeks memory"; tapestry line 152
 * Return Visit Recognition). The compiled demo default decays interest with a
 * 60 s time constant, which cannot express a shopper who is remembered across a
 * visit boundary, so this fixture publishes a fourteen-day one. Everything else
 * is the compiled default.
 */
const FIXTURE_TAU_MS = 14 * 24 * 60 * 60 * 1000;
const fixtureReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w16-b4-fixture', tauMs: FIXTURE_TAU_MS, eventAttributes: 'event-when-unknown' as const };

// ---------------------------------------------------------------------------
// Host fixture — the real app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts`; that suite is never imported and never edited.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b4-fixture-policy', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
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

/** One live editorial piece and one home slot, so a decision set actually resolves. */
const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: { pieces: [
    { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby', tags: { line: ['Tabby'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  ] } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: { line: 1 } }] } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b4', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string, journey: unknown | null) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b4-fixture', note: '', value } });
  const changes = documentChanges(tenant);
  const defaults = [baseline(REFLEX_KIND, fixtureReflexConfig, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b4', arms: ['default'] } })];
  // The journey threshold set is published as its own versioned document of the
  // configuration set, or not published at all for the fail-closed case.
  const set = [...defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base),
    ...(journey === null ? [] : [baseline(JOURNEY_KIND, journey)])];
  return initializePublicationSet(env, set, '0:' + crypto.randomUUID());
}

/** Publish the next journey threshold version onto the live configuration set. */
async function publishJourney(env: Env, tenant: string, document: unknown): Promise<{ ok: boolean }> {
  try {
    const pin = await pinPublication(env, tenant);
    const revision = pin.refs[JOURNEY_KIND.name + ':' + tenant]!.revision;
    return await publishSet(env, [{ kind: JOURNEY_KIND, scope: tenant, request: document, candidate: () => document }],
      { actor: 'w16-b4-fixture', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest },
        operationId: revision + ':' + crypto.randomUUID() });
  } catch (error) {
    // A refusal raised as a typed error is still a refusal, never a publication.
    return { ok: false, errors: [String(error)] } as { ok: boolean };
  }
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b4-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
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
  return { env, app, cache, sessions, objects, call, drain, configureRetention };
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
  visit?: { visitNumber: number | null; entryChannel: string | null } | null;
  affinity?: { dims?: Record<string, Record<string, number>> } | null;
}
/** What `POST /realtime/action` answers on either host. */
interface ActionAnswer {
  status: number;
  update?: { data?: { journeyStage?: unknown } } | null;
}
/** What the mounted decisions snapshot exposes about its inputs. */
interface SnapshotAnswer {
  status: number;
  ok: unknown;
  state: unknown;
  decisions: unknown;
  journey: unknown;
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
   * decision record: `/v1/:tenant/decisions/snapshot` omits `cell` and `records`
   * in offer mode (`src/routes/decisions.ts:478`). Named `host-internal` per R19.
   */
  decide: () => Promise<Awaited<ReturnType<typeof serveContentDecisions>>>;
}

async function hostFixture(host: 'session' | 'do', journey: unknown | null = JOURNEY_V1): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT, journey);
  await explicitChoice(f, grant);
  const principal = await verifySessionCapability(f.env, grant.capability, TENANT);
  const action = async (event: { type: string; data: Record<string, unknown> }, options: { buffered?: boolean } = {}) => {
    const response = await f.call('/realtime/action', grant.capability, {
      ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(),
      ...(options.buffered ? { processing: 'buffered', browsingSessionId: grant.sessionId } : {}),
    });
    const body = await response.clone().json().catch(() => ({})) as { update?: { data?: { journeyStage?: unknown } } | null };
    await f.drain();
    return { status: response.status, update: body.update ?? null };
  };
  const hydrate = async () => {
    const response = await f.call('/realtime/reflex', grant.capability);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Hydrate;
  };
  const snapshot = async () => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=home`, grant.capability);
    const body = await response.clone().json().catch(() => ({})) as
      { ok?: unknown; decisions?: unknown[]; sources?: { state?: unknown; journey?: unknown } };
    await f.drain();
    return { status: response.status, ok: body.ok, state: body.sources?.state, decisions: body.decisions?.length, journey: body.sources?.journey };
  };
  const decide = async () => {
    // Production reaches this function inside the shopper owner's invocation
    // (requireShopper → forwardShopperRequest → the object's owned operation);
    // the same admission is established here so the real guards run.
    const owner = {};
    const out = await runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, principal);
      return serveContentDecisions(f.env, {
        tenant: TENANT, page: 'home', visitorId: grant.subject, sessionId: grant.sessionId, cookieHeader: null,
        stateTenant: TENANT, principal, capability: grant.capability, cf: null, channel: null,
      });
    }, f.sessions as unknown as Parameters<typeof runOwnerOperation>[3],
    undefined,
    (async () => f.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
    await f.drain();
    return out;
  };
  return { f, grant, principal, action, hydrate, snapshot, decide };
}

/** What `documentChanges` publishes for /home: one hero slot, take 1, one live piece. */
const HOME_DECISIONS = 1;

/**
 * The first assertion of every leg, so the RED line names both this unit's
 * missing behavior and the ruled export it needs (R21).
 */
const vocabularyExists = (what: string) => {
  expect(JOURNEY_STAGES, `${what} — src/services/JourneyStage.ts must export JOURNEY_STAGES, the one shared stage vocabulary in order`)
    .toEqual(['exploring', 'thinking', 'deciding']);
  expect(typeof journeyStageFrom, `${what} — src/services/JourneyStage.ts must export journeyStageFrom(counters, thresholds)`).toBe('function');
};
const kindExists = (what: string) => {
  expect(typeof JOURNEY_KIND?.validate, `${what} — src/content/kinds.ts must export JOURNEY_KIND, the published versioned journey-threshold document kind`)
    .toBe('function');
};

// ---------------------------------------------------------------------------

describe('unit:W16.C4.01', () => {
  it('logic: one ordered shared vocabulary, one published versioned threshold kind, and a derivation that reads the thresholds as data', () => {
    // tapestry_requirements.txt line 149: "exploring (seeing) → thinking → deciding".
    vocabularyExists('W16.C4.01: the journey stage must derive from one published, versioned threshold set over the shared stage vocabulary');
    expect(JOURNEY_STAGES[0], 'the vocabulary is ordered: the first stage is where a shopper starts').toBe('exploring');
    expect(JOURNEY_STAGES[JOURNEY_STAGES.length - 1]).toBe('deciding');
    kindExists('W16.C4.01: the threshold set is one published, versioned document every host and the content decision consume');

    // One published, versioned document kind, under the same conditional R2
    // publication authority every other configuration kind uses.
    expect(JOURNEY_KIND.name).toBe('journey');
    expect(JOURNEY_KIND.publication).toBe('r2');
    expect(JOURNEY_KIND.validate(JOURNEY_V1).ok, 'a threshold set over the shared vocabulary is a valid document').toBe(true);
    expect(JOURNEY_KIND.validate(DEFAULT_JOURNEY_THRESHOLDS).ok, 'the compiled default threshold set is itself a valid document').toBe(true);

    // Each revision carries its own version identity (`stampLabel`, src/content/kinds.ts:19-22,
    // as CONTENT_KIND does), so a receipt can name the version it used.
    const accepted = JOURNEY_KIND.validate(JOURNEY_V1);
    expect(JOURNEY_KIND.versionOf(JOURNEY_KIND.stamp(accepted.value, 3))).toMatch(/\+r3$/);
    expect(JOURNEY_KIND.versionOf(JOURNEY_KIND.stamp(accepted.value, 4))).toMatch(/\+r4$/);

    // Bounds: a stage word outside the shared vocabulary and an out-of-range
    // threshold are both refused, and the validator returns EVERY error.
    const refused = JOURNEY_KIND.validate(JOURNEY_INVALID);
    expect(refused.ok).toBe(false);
    expect(refused.errors.length, 'every error, not the first: the stage word AND the threshold').toBeGreaterThanOrEqual(2);
    expect(refused.errors.join(' | '), 'the refusal names the stage that is not in the vocabulary').toMatch(/stage/i);
    expect(refused.errors.join(' | '), 'the refusal names the counter whose threshold is out of range').toMatch(/purchases/);
    for (const candidate of [
      { version: 'x', stages: [{ stage: 'exploring', anyOf: { interactions: 1 } }] },               // the first stage is the floor; it has no threshold
      { version: 'x', stages: [{ stage: 'deciding', anyOf: { purchases: 1 } }, { stage: 'thinking', anyOf: { interactions: 3 } }] }, // out of vocabulary order
      { version: 'x', stages: [{ stage: 'thinking', anyOf: { interactions: 1.5 } }] },              // an interaction count is a whole number
      { version: 'x', stages: [{ stage: 'thinking', anyOf: { moon_phase: 3 } }] },                  // a counter the visit does not keep
      { version: 'x', stages: [{ stage: 'thinking', anyOf: {} }] },                                 // a stage with no threshold at all
    ]) {
      expect(JOURNEY_KIND.validate(candidate).ok, JSON.stringify(candidate)).toBe(false);
    }

    // The thresholds are data, not constants: the same counters under two
    // published sets give two stages, and neither is invented by the engine.
    const counters = THREE_INTERACTIONS.reduce<unknown>((acc, event) => visitJourneyCounters(acc, event), null);
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
    const counters = THREE_INTERACTIONS.reduce<unknown>((acc, event) => visitJourneyCounters(acc, event), null);
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
    vocabularyExists("W16.C4.02: a new visit past VISIT_GAP_MS must reset the journey to the vocabulary's first stage while the visit number increments"); kindExists('W16.C4.02: the stage both hosts report comes from the published threshold set');
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
    vocabularyExists('W16.C4.03: the decision made on the purchase event itself must report the deciding stage of the shared vocabulary'); kindExists('W16.C4.03: the purchase is counted against the published threshold set');
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
  it('host: the persisted visit-local counters reset only after the purchase decision, and the next decision starts from them, on both hosts', async () => {
    vocabularyExists("W16.C4.04: the next decision after a purchase must start from reset visit-local counters, at the vocabulary's first stage"); kindExists('W16.C4.04: the reset is measured against the published threshold set');
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

        // 2. Only then are the persisted visit-local counters reset, so the NEXT
        //    personalization decision starts from reset counters — inside the
        //    same visit, with the cumulative taste the purchase itself grew.
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        const next = await h.hydrate();
        expect(next.journeyStage, `${host}: the next decision after the purchase`).toBe('exploring');
        expect(next.visit, `${host}: the reset is not a new visit`).toEqual({ visitNumber: 1, entryChannel: null });
        const grown = next.affinity?.dims?.line?.Tabby;
        expect(grown, `${host}: the purchase's own interest was accumulated, not discarded with the counters`).toBeGreaterThan(taste!);

        // 3. The reset is real: the counters restart, so one interaction after
        //    the purchase is one interaction, not the fifth. The cumulative
        //    taste is not touched again by the reset.
        clock.mockReturnValue(T0 + 5 * STEP_MS);
        expect((await h.action(UNKNOWN_LINE_VIEW)).status, host).toBe(200);
        const afterOne = await h.hydrate();
        expect(afterOne.journeyStage, `${host}: one interaction into the post-purchase journey`).toBe('exploring');
        expect(afterOne.visit, host).toEqual({ visitNumber: 1, entryChannel: null });
        expect(afterOne.affinity?.dims?.line?.Tabby, `${host}: cumulative taste is unchanged by the reset`).toBeCloseTo(grown!, 2);

        // 4. Two more, and the third interaction moves the stage again on the
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
  it('host: a new threshold version applies to subsequent decisions, an invalid set is refused, and nothing published fails closed to the first stage, on both hosts', async () => {
    vocabularyExists('W16.C4.05: publishing a new threshold version must change stage derivation for subsequent decisions'); kindExists('W16.C4.05: the journey thresholds are a published, versioned document that a decision names');
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
        expect((await h.hydrate()).journeyStage, `${host}: three interactions under version 1`).toBe('thinking');
        // The decision names the threshold version it used, beside the catalog,
        // slots, learn and reflex versions it already names.
        expect(await h.snapshot(), host).toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
          journey: { version: expect.stringMatching(/\+r1$/), revision: 1, reason: null } });

        // Publishing the next version changes the derivation for subsequent
        // decisions, with no new event: the same counters, a later threshold.
        invalidateCache();
        expect((await publishJourney(h.f.env, TENANT, JOURNEY_V2)).ok, `${host}: publish version 2`).toBe(true);
        invalidateCache();
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: version 2 needs five interactions`).toBe('exploring');
        expect(await h.snapshot(), host).toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
          journey: { version: expect.stringMatching(/\+r2$/), revision: 2, reason: null } });

        // An invalid set never becomes the threshold in force: it is refused at
        // publication and the last published version keeps deciding.
        invalidateCache();
        expect((await publishJourney(h.f.env, TENANT, JOURNEY_INVALID)).ok, `${host}: an invalid threshold set is refused`).toBe(false);
        invalidateCache();
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: still version 2`).toBe('exploring');
        expect(await h.snapshot(), host).toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
          journey: { version: expect.stringMatching(/\+r2$/), revision: 2, reason: null } });
      }

      // Nothing published at all: the engine serves, derives the vocabulary's
      // first stage and says why. It never invents a threshold.
      for (const host of ['session', 'do'] as const) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, null);
        for (const [index, event] of THREE_INTERACTIONS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, `${host}: unpublished thresholds must not refuse an event`).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        expect((await h.hydrate()).journeyStage, `${host}: fail closed to the first stage`).toBe('exploring');
        expect(await h.snapshot(), `${host}: served, with no version used and a diagnostic that names the journey thresholds`)
          .toEqual({ status: 200, ok: true, state: host, decisions: HOME_DECISIONS,
            journey: { version: null, revision: 0, reason: expect.stringMatching(/journey/i) } });
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: the decision record and its receipt name the stage in the shared vocabulary and the threshold version used, on both hosts', async () => {
    vocabularyExists('W16.C4.05: the decision record and its receipt must name the stage and the threshold version used'); kindExists('W16.C4.05: the receipt names the published journey document version');
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
        expect(out.records.length, host).toBe(HOME_DECISIONS);
        const record = out.records[0]!;
        expect(record.journey, `${host}: the record carries the stage it decided in and the version that derived it`)
          .toEqual({ stage: 'thinking', version: expect.stringMatching(/\+r1$/) });
        expect(out.sources.journey, host).toEqual({ version: expect.stringMatching(/\+r1$/), revision: 1, reason: null });
        // The receipts route reads the same records through receiptOf
        // (src/routes/decisions.ts:312), so the shopper's own receipt says it.
        const receipt = receiptOf(record, new Map([[record.item_id, { customerContentId: record.customer_item_id, title: 'Tabby' }]]));
        expect(receipt.journey, `${host}: the shopper's own receipt names the stage and the version`)
          .toEqual({ stage: 'thinking', version: expect.stringMatching(/\+r1$/) });
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
    const buffered = { ...THREE_INTERACTIONS[0]!, processing: 'buffered' as const, eventId: 'buffered-1', timestamp: T0 - 86_400_000, browsingSessionId: 'earlier-session' };
    expect(visitJourneyCounters(three, buffered), 'a buffered delivery counts as no interaction of the current visit').toEqual(three);
    // A threshold set that turns on the FOURTH interaction, so the difference
    // between a buffered delivery and a live one is visible in the stage.
    const fourth = { version: 'journey-fourth', stages: [{ stage: 'thinking', anyOf: { interactions: 4 } }, { stage: 'deciding', anyOf: { purchases: 1 } }] };
    expect(journeyStageFrom(three, fourth)).toBe('exploring');
    expect(journeyStageFrom(visitJourneyCounters(three, buffered), fourth), 'a buffered delivery does not move the stage').toBe('exploring');
    // The same action delivered live is an interaction, so the rule is about the
    // delivery and not about the event.
    expect(visitJourneyCounters(three, THREE_INTERACTIONS[0]!)).toMatchObject({ interactions: 4 });
    expect(journeyStageFrom(visitJourneyCounters(three, THREE_INTERACTIONS[0]!), fourth), 'the same action delivered live does').toBe('thinking');
    // A buffered purchase is not the current deciding signal either.
    expect(visitJourneyCounters(three, { ...purchaseEvent(), processing: 'buffered' as const, eventId: 'buffered-2', timestamp: T0 - 86_400_000, browsingSessionId: 'earlier-session' }))
      .toEqual(three);
  });
});

describe('unit:W16.C4.07', () => {
  it('host: both hosts derive the same stage for the same sequence and the SDK-visible projection carries it under the shared vocabulary', async () => {
    vocabularyExists('W16.C4.07: both hosts must derive the same stage and the SDK-visible projection must carry it under the shared vocabulary'); kindExists('W16.C4.07: both hosts read the same published threshold set');
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
      // words on both hosts — the object's internal early/mid/late token never
      // crosses the boundary (R20's rule for the visit, applied to the stage).
      for (const host of ['session', 'do'] as const) {
        expect(browsing[host], `${host}: three interactions`).toBe('thinking');
        expect(updates[host], `${host}: the purchase decision`).toBe('deciding');
        expect(buying[host], `${host}: the decision after the purchase reset`).toBe('exploring');
        expect(JOURNEY_STAGES).toContain(browsing[host]);
        expect(JOURNEY_STAGES).toContain(buying[host]);
      }
      expect(browsing.session, 'both hosts derive the same stage for the same sequence').toBe(browsing.do);
      expect(updates.session).toBe(updates.do);
      expect(buying.session).toBe(buying.do);
    } finally { clock.mockRestore(); }
  });
});
