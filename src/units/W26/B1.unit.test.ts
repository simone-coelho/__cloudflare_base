// src/units/W26/B1.unit.test.ts
// W26 — the declared exposure unit carried end to end; page/brand/slot/position
// identity; named-placement credit with the brand resolved from the decision;
// cross-placement fatigue retained and said truly; position carried and its
// non-correction stated; repeated items, replay and SDK refresh counted
// correctly (batch W26-B1).
//
// One `describe('unit:W26.*')` per unit, one `it` per ruled leg. Every expected
// value comes from a witness, never from what the engine returns today:
//
//   · document 35 §5 row W26 (:428) — "Correlated decision/outcome identity and
//     defined served/rendered/viewable unit; page/brand/slot/position identity
//     and named-placement credit. Agree and test global-item versus
//     placement-specific fatigue, unknown legacy outcomes and position effects;
//     prove repeated item/product across slots/pages, replay and SDK refresh
//     produce correct counts."
//   · docs/architecture/35-verification-reports/F21.md §3 (the two defects),
//     §5 items 2-5, §6(a) `servedCounts` is page-wide while its JSDoc says "that
//     slot's", §6(b) no page on `statsName`/`liftKey`, §6(c) `ringEntryOf` and
//     the outcome's brand defaulted to the tenant at ingest
//     (`src/routes/realtime.ts:203`), §6(e) "the receipt overclaims on an
//     unrendered slot", §8 (the S fix and the M that must follow: position in
//     the identity, exposures gated on a rendered impression, page in the
//     identity or global slot uniqueness, brand on the online entry resolved
//     from the decision; "until that lands, the lift table is a diagnostic not
//     corrected for position or placement").
//   · docs/architecture/35-verification-reports/F34.md §2A-§2G, §4, §6 — the
//     SDK lifecycle half is W17's and is NOT re-specified here; what is W26's
//     is that a refresh of the same set produces one exposure per placement.
//   · docs/handover/HANDOFF-2026-09-16.md:230 — open: "Served vs rendered vs
//     viewable unit and denominator remain unresolved. Statistics object is
//     tenant/brand/slot, not page; unknown legacy outcomes and position effects
//     require agreement." Settled: "W26.04 live fatigue now filters to brand,
//     retaining intended cross-placement global-item history. Do not
//     accidentally add slot/page/arm fatigue restrictions as a 'fix.'"
//   · docs/handover/HANDOFF-2026-09-18.md:322 — "Correlated receipts, SDK
//     rendered behavior and same-brand global-item fatigue exist... Do not
//     silently restrict intended cross-placement fatigue."
//   · the customer fixture: Coach's Tabby lifestyle hero and its editorial rail
//     (docs/architecture/tapestry_requirements.txt:113 "the hero features
//     lifestyle content from the collection she came for", :122, :567
//     `content_format  hero-image, carousel, video, editorial, lookbook`).
//
// THE LEAD'S READING FOR THIS BATCH (R153) governs what is ruled and what is
// locked. (a) measure first: named-placement credit, the `unknown` sentinel,
// the featured-product rule, brand-local fatigue with cross-placement
// global-item history, brand/page/position on the ring entry and W22's
// redelivery-once EXIST — each is locked here as GREEN-AT-SPEC and only what is
// absent is ruled. (f) the position CORRECTION itself is not ruled: the
// platform must STATE that the table is uncorrected until W26.P1.01 decides.
// (h) the agreed unit and denominator, the position-effect policy and the
// legacy-outcome rule are the owner's and Data Science's — W26.P1.01,
// `no-witness`.
//
// WHAT "LOCKED" MEANS IN THIS FILE. An assertion marked LOCKED passed on the
// base commit `0662c0c` when this file was written; its comment names the line
// that reverses it, so a reviewer can break the product and watch the
// assertion fail. It is here so an implementer cannot buy a RED assertion by
// giving up settled behaviour.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { transformSync } from 'esbuild';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { invalidatePublicationCache, initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { decideContent, type DecideInput } from '@/content/decide';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { Cell, ContentPiece, DecisionRecord, LearnConfig, SlotStrategy } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { outcomeFromAction, rewardOf, ts36, validDecisionMeasurement, type OutcomeRecord } from '@/ledger/records';
import { fanDecisions, fanOutcome, ringEntryOf, ringName, servedCounts, statsName, liftKey, type SlotLearnConfig } from '@/learn/fan';
import { attribute, DEFAULT_POLICY, type RingEntry } from '@/learn/policy';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { receiptOf } from '@/learn/receipts';
import { rowsOf, type Names } from '@/learn/rows';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ---------------------------------------------------------------------------
// Fixture constants — the customer's own surface, not a synthetic one.
// ---------------------------------------------------------------------------

const TENANT = 'coach';
const BRAND = 'coach';
/** A tenant whose brand is NOT its tenant id: F21 §6(c)'s "first tenant that actually uses brands". */
const MULTI_TENANT = 'meridian';
const MULTI_BRAND = 'alpha';
const ORIGIN = 'https://synthetic.invalid';
const OPERATOR_SECRET = 'w26-b1-synthetic-operator-signing-material';
const HOUR = 3_600_000;
/** A fixed instant inside a closed UTC hour, so no assertion here depends on the wall clock. */
const T0 = Date.UTC(2026, 8, 4, 12, 0, 0);

const COACH_CELL: Cell = { channel: 'paid_social', visit_bucket: '1', region: 'US-NY', affinity: 'line:Tabby', stage: 'mid' };
/** Event nonces in the shape `isEventNonce` admits (`src/events/actionTypes.ts:33`). */
const RENDER_NONCE = 'w26-b1-render-nonce';
const PAGE_NONCE = 'w26-b1-page-instance';

const piece = (id: string, line: string, category: string): ContentPiece => ({
  id, customerContentId: `cms-${id}`, type: 'editorial', title: id,
  tags: { line: [line], category: [category] }, slotTypes: ['hero', 'rail'], lifecycle: { status: 'live' },
});
/** tapestry_requirements:113 — the Tabby lifestyle hero and the editorial beside it. */
const PIECES: ContentPiece[] = [
  piece('tabby-in-motion-film', 'Tabby', 'Handbags'),
  piece('willow-slg-editorial', 'Willow', 'Small Leather Goods'),
];
/** One page carrying the same piece in two placements: the hero and the rail. */
const HOME_SLOTS: SlotStrategy[] = [
  { slot: 'hero', take: 1, weights: { line: 0.5, category: 0.3 } },
  { slot: 'rail', take: 1, weights: { line: 0.5, category: 0.3 } },
];
const LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w26-b1', arms: ['default'] },
  slots: { hero: { reward: 'click' }, rail: { reward: 'click' } },
};

// ---------------------------------------------------------------------------
// Bindings: the same in-memory doubles the repository's own boundary suites use.
// ---------------------------------------------------------------------------

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.data.get(key);
    return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v;
  }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort();
    const start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: new TextEncoder().encode(this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

const fixturePolicy: RetentionPolicy = { id: 'w26-b1-fixture-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant =>
  [tenant, Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface Registry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  storage: UnitR2;
  cache: UnitKV;
  /** Every body the real producer handed to the queue binding, in order. */
  queued: unknown[];
  rings: Map<string, Registry>;
  stats: Map<string, Registry>;
  /** Every outcome the action route forwarded to the learning ring, when captured. */
  learned: OutcomeRecord[];
  call: (path: string, capability?: string, body?: unknown, tenant?: string) => Promise<Response>;
  operator: (method: 'GET' | 'POST', path: string, body?: unknown, tenant?: string) => Promise<Response>;
  drain: () => Promise<void>;
}

/**
 * The routes production serves, mounted as `src/index.ts` mounts them, over the
 * real Durable Object classes. `captureOutcomes` replaces the ring namespace
 * with a recorder when the observable is what the ACTION ROUTE forwarded.
 */
async function mount(options: { host?: 'session' | 'do'; tenants?: string[]; learn?: LearnConfig; captureOutcomes?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const tenants = options.tenants ?? [TENANT];
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [], learned: OutcomeRecord[] = [];
  const storage = new UnitR2(), cache = new UnitKV(), sessions = new UnitKV();
  const shoppers = new Map<string, Registry>(), rings = new Map<string, Registry>(), stats = new Map<string, Registry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: sessions, STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: options.host ?? 'session',
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: tenants.map(t => `${t}:w26-b1-identity-material`).join(','),
    TENANTS: JSON.stringify({ provisioned: tenants, operatorGrants: { ops: tenants } }),
    LEDGER_RECOVERY_ENABLED: 'false',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const m of messages) queued.push(m.body); } },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories(tenants) });

  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, Registry>) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>(); const alarms: number[] = [];
        const storageStub = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry));
              },
              deleteAlarm: async () => { deleteAlarm = true; }, setAlarm: async (at: number) => { nextAlarm = at; },
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
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, object: make(state, env) };
        registry.set(name, item);
      }
      return item.object.fetch(new Request(input, init));
    } }),
  });
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), stats) as unknown as DurableObjectNamespace;
  env.DECISION_RING = options.captureOutcomes
    ? { idFromName: (name: string) => name, get: () => ({ fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { outcome?: OutcomeRecord };
        if (body.outcome) learned.push(body.outcome);
        return Response.json({ ok: true, credits: 0, receipt: { version: 1, kind: 'outcome', received: 1, cutoffSkipped: 0,
          attributed: 0, eligible: 0, weightSkipped: 0, credits: { destinations: 0, acknowledged: 0, unknown: 0, notAttempted: 0,
            received: 0, processed: 0, skipped: 0, rowsUnknown: 0, rowsNotAttempted: 0, alarmsUnknown: 0 } } });
      } }) } as unknown as DurableObjectNamespace
    : namespaceFor((state, e) => new DecisionRing(state, e), rings) as unknown as DurableObjectNamespace;

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope: string): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w26-b1-fixture', note: 'fixture', value } });
  for (const tenant of tenants) {
    await initializePublicationSet(env, [
      baseline(CONTENT_KIND, { pieces: PIECES }, tenant),
      baseline(SLOTS_KIND, { pages: { home: HOME_SLOTS } }, tenant),
      baseline(LEARN_KIND, options.learn ?? LEARN, tenant),
      baseline(PRIORS_KIND, EMPTY_PRIORS, tenant),
      baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }, reflexScopeForTenant(tenant)),
    ], '0:' + crypto.randomUUID());
  }
  invalidatePublicationCache();

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const context = () => ({ waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const call = async (path: string, capability?: string, body?: unknown, tenant = TENANT) => app.request(new Request(ORIGIN + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tenant': tenant, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), undefined, env, context());
  const token = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const operator = async (method: 'GET' | 'POST', path: string, body?: unknown, tenant = TENANT) => app.request(new Request(ORIGIN + path, {
    method, headers: { 'X-Tenant': tenant, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), undefined, env, context());
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, storage, cache, queued, rings, stats, learned, call, operator, drain };
}

/**
 * The shopper's own explicit choice, through the real route: tracking and
 * personalization are off until she makes one (HANDOFF-2026-09-18 §7, consent).
 */
async function explicitChoice(m: Mounted, grant: Awaited<ReturnType<typeof newAnonymousSession>>): Promise<void> {
  const response = await m.call(`/realtime/session/${grant.sessionId}/preferences`, grant.capability, {
    trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp },
  }, grant.tenant);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ consent: { tracking: true, personalization: true } });
}

/** A served decision, in the shape the engine writes and the ring keeps. */
function record(env: Env, over: Partial<DecisionRecord> & { slot: string; item_id: string; ts: number }): DecisionRecord {
  const { slot, item_id, ts } = over;
  const tenant = over.tenant ?? TENANT, visitor = over.visitor_id ?? 'v-w26';
  const page = over.page ?? 'home', position = over.position ?? 0;
  const base = {
    decision_id: `${tenant}:${ts36(ts)}:${visitor}:${page}:${slot}:${position}`,
    tenant, brand: over.brand ?? BRAND, visitor_id: visitor, session_id: over.session_id ?? 's-w26', identity_anchor: 'visitor',
    ts, page, slot, position, item_id, customer_item_id: `cms-${item_id}`, candidates: [], cell: COACH_CELL,
    arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
    config_label: 'w26-b1', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null },
    retention: captureRetention(env as never, tenant, ts, Date.now()),
  };
  return { ...base, ...over } as DecisionRecord;
}

const entry = (over: Partial<RingEntry> & { id: string; slot: string; item: string; ts: number }): RingEntry => ({
  page: 'home', position: 0, brand: BRAND, tenant: TENANT, visitor_id: 'v-w26', session_id: 's-w26',
  arm: 'personalized', cell: COACH_CELL, ...over,
});

const outcome = (over: Partial<OutcomeRecord> & { type: OutcomeRecord['type']; ts: number }): OutcomeRecord => ({
  outcome_id: `${TENANT}:${ts36(over.ts)}:v-w26:${over.event ?? over.type}`, tenant: TENANT, brand: BRAND, visitor_id: 'v-w26',
  session_id: 's-w26', event: over.type, item_id: null, slot: null, value: null, currency: null, margin: null, products: null,
  arm: 'personalized', ...over,
} as OutcomeRecord);

const SLOT_CONFIG: Record<string, SlotLearnConfig> = {
  hero: { reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' },
  rail: { reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' },
};

const NO_NAMES: Names = new Map();
/** The two members of a real DOM node the SDK's element port uses (`src/sdk/types.ts:56-59`). */
type PageElement = { getAttribute(name: string): string | null; addEventListener(type: string, fn: () => void): void };
const sourceOf = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

// ===========================================================================
// unit:W26.U1.01 — the exposure unit is DECLARED and CARRIED, never inferred
// ===========================================================================

describe('unit:W26.U1.01', () => {
  /**
   * R153(b). One `measurementBasis` per statistics object and per report; a
   * `served-v1` exposure and a `rendered-v1` acknowledgement never pool; the
   * viewable impression is either the declared unit or explicitly not a
   * learning input (F21 §5 item 5: "`rewardOf` (`records.ts:90`) has no
   * `content_impression` row... there is no impression signal to switch
   * exposures over to; it exists on the wire and is thrown away"); and no
   * receipt claims a rendered basis for a placement that was never
   * acknowledged (F21 §6(e), "the receipt overclaims on an unrendered slot").
   */
  it('logic: served and rendered never pool, a rendered record without its acknowledgement is refused, and the platform states that the viewable impression is not a learning input', async () => {
    // LOCKED (`src/learn/fan.ts:280`, the `basis === (s.measurementBasis ?? 'served-v1')`
    // clause; deleting it pools the two units and fails this line).
    const legacyServed = entry({ id: 'd-served', slot: 'hero', item: 'tabby-in-motion-film', ts: T0 });
    const acknowledged: RingEntry = { ...entry({ id: 'd-rendered', slot: 'hero', item: 'tabby-in-motion-film', ts: T0 }),
      measurementBasis: 'rendered-v1', renderedAt: T0 + 60_000 };
    const renderedSlot = [{ slot: 'hero', fatigue: { weight: 1, windowHours: 1 }, measurementBasis: 'rendered-v1' as const }];
    expect(servedCounts([legacyServed, acknowledged], renderedSlot, T0 + 60_001)).toEqual({ hero: { 'tabby-in-motion-film': 1 } });
    expect(servedCounts([legacyServed, acknowledged], [{ ...renderedSlot[0]!, measurementBasis: 'served-v1' }], T0 + 60_001))
      .toEqual({ hero: { 'tabby-in-motion-film': 1 } });
    // LOCKED (`src/learn/policy.ts:101`: the rendered entry is eligible from
    // `renderedAt`, not from `ts`).
    expect(attribute(outcome({ type: 'click', item_id: 'tabby-in-motion-film', ts: T0 + 30_000 }), [acknowledged], DEFAULT_POLICY)).toEqual([]);
    expect(attribute(outcome({ type: 'click', item_id: 'tabby-in-motion-film', ts: T0 + 90_000 }), [acknowledged], DEFAULT_POLICY)
      .map(c => c.decision_id)).toEqual(['d-rendered']);

    // RULED. The platform must SAY, in code a caller can read, which wire events
    // the learning loop counts and which it does not, so that "the viewable
    // impression is not a learning input today" is a fact the product states
    // rather than an accident of `REWARD_OF` having no row.
    const records = await import('@/ledger/records') as unknown as Record<string, unknown>;
    const learningInputOf = records.learningInputOf as
      ((action: { type: string; data?: Record<string, unknown> }) => { counted: boolean; reward?: string; reason?: string }) | undefined;
    expect(typeof learningInputOf,
      'W26.U1.01: `src/ledger/records.ts` must export `learningInputOf(action)`, the one place that says which wire events the learning loop counts (F21 §5 item 5)').toBe('function');
    expect(learningInputOf!({ type: 'content_impression', data: { contentId: 'tabby-in-motion-film', slot: 'hero' } }))
      .toEqual({ counted: false, reason: 'not-a-learning-input' });
    expect(learningInputOf!({ type: 'content_click', data: { contentId: 'tabby-in-motion-film', slot: 'hero' } }))
      .toEqual({ counted: true, reward: 'click', event: 'content_click' });
    // LOCKED, and the reason the declaration above must exist: the impression
    // produces no outcome record today (`src/ledger/records.ts:198-205`).
    expect(rewardOf({ type: 'content_impression', userId: 'v-w26', data: {} })).toBeNull();

    // RULED. The kit is where an integrator reads it.
    const kit = sourceOf('docs/kit/03-payload-schemas.md');
    const impression = kit.split('\n').filter(line => line.includes('content_impression')).join('\n');
    expect(impression, 'W26.U1.01: docs/kit/03-payload-schemas.md must say, where it documents `content_impression`, that it is not a learning input')
      .toMatch(/not a learning input/i);

    // LOCKED, and this is F21 §6(e)'s "the receipt overclaims on an unrendered
    // slot" measured closed at the source rather than at the sentence: under
    // `rendered-v1` there is no record at all until the client's render is
    // durably admitted (`src/ledger/records.ts:111-118`, and
    // `src/content/service.ts:500-501`, which captures no exposure at serve
    // time for a rendered-v1 slot), so no receipt can claim an unrendered
    // placement. Deleting either line lets an unacknowledged rendered record
    // exist and fails this.
    const base = record({} as Env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts: T0, retention: undefined });
    expect(validDecisionMeasurement({ ...base, measurementBasis: 'rendered-v1' })).toBe(false);
    expect(validDecisionMeasurement({ ...base, measurementBasis: 'served-v1' })).toBe(true);
    const acknowledged2 = { ...base, measurementBasis: 'rendered-v1' as const,
      rendered: { version: 1 as const, at: T0 + 1000, eventId: RENDER_NONCE, pageInstance: PAGE_NONCE } };
    expect(validDecisionMeasurement(acknowledged2)).toBe(true);
    // LOCKED (`src/learn/receipts.ts:50`): legacy served history is never relabelled.
    expect(receiptOf(base, NO_NAMES).why[0]).toBe('Legacy served-decision exposure; rendering was not confirmed.');

    // RULED (R153(b)). The admitted render is the declared exposure unit; the
    // VIEWABLE impression is a different thing and is not counted at all today
    // (F21 §5 item 5). The receipt that reports an admitted render is where the
    // reader must be told both, so that no one reads "rendered" as "seen" or as
    // "the viewable event is what we learn from".
    expect(receiptOf(acknowledged2, NO_NAMES).why[0],
      'W26.U1.01: the rendered-v1 receipt must say that a viewable impression is not a learning input today (F21 §5 item 5)')
      .toBe('Client-reported rendering was durably admitted; this is not proof of human visibility, and a viewable impression is not a learning input today.');
  });

  /**
   * The same two records through the route an operator actually reads
   * (`GET /v1/:tenant/visitors/:visitorId/receipts`, `src/routes/decisions.ts:372`),
   * and the denominator's own basis on the lift table route
   * (`src/routes/decisions.ts:214`).
   */
  it('host: the receipts route says which unit each placement was counted under and the lift table names the basis of its denominator', async () => {
    const m = await mount();
    const ts = Date.now() - 60_000;
    const rows = [
      record(m.env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts }),
      { ...record(m.env, { slot: 'rail', item_id: 'willow-slg-editorial', ts: ts + 1, position: 0 }), measurementBasis: 'rendered-v1' as const,
        rendered: { version: 1 as const, at: ts + 2_000, eventId: RENDER_NONCE, pageInstance: PAGE_NONCE } },
    ];
    m.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ ok: true, ring: rows, index: rows.length },
      { headers: { 'X-Retention-Witness': JSON.stringify(rows[0]!.retention!.online!) } }) }) } as unknown as DurableObjectNamespace;
    const response = await m.operator('GET', `/v1/${TENANT}/visitors/v-w26/receipts`);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { receipts: Array<{ slot: string; measurementBasis: string; renderedAt: number | null; why: string[] }> };
    const hero = body.receipts.find(r => r.slot === 'hero')!, rail = body.receipts.find(r => r.slot === 'rail')!;
    // LOCKED (`src/learn/receipts.ts:50`, `:97`): a served-v1 placement says
    // rendering was not confirmed, and carries no rendered time.
    expect(hero.renderedAt).toBeNull();
    expect(hero.measurementBasis).toBe('served-v1');
    expect(hero.why[0]).toBe('Legacy served-decision exposure; rendering was not confirmed.');
    expect(rail.renderedAt).toBe(ts + 2_000);
    expect(rail.why[0], 'W26.U1.01: the operator receipt for an admitted render must say that a viewable impression is not a learning input today')
      .toBe('Client-reported rendering was durably admitted; this is not proof of human visibility, and a viewable impression is not a learning input today.');

    // LOCKED (`src/routes/decisions.ts:214`, the `measurementBasis:` member of
    // the answer): the denominator the table reports names the unit it counted.
    await m.env.CACHE.put(liftKey(TENANT, BRAND, 'hero'), JSON.stringify(SNAPSHOT));
    const table = await m.operator('GET', `/v1/${TENANT}/lift/rows?slot=hero`);
    expect(table.status).toBe(200);
    expect(await table.json()).toMatchObject({ ok: true, slot: 'hero', measurementBasis: 'served-v1', published: true });
  });
});

/** One published snapshot, in the shape `buildSnapshot` writes it (`src/learn/stats.ts`). */
const SNAPSHOT: LiftSnapshot = {
  tenant: TENANT, brand: BRAND, slot: 'hero', reward: 'click', objective: 'unit', measurementBasis: 'served-v1',
  tauLearnMs: DEFAULT_STATS.tauLearnMs, version: 7, publishedAt: T0, events: 1200, n0: DEFAULT_STATS.n0, nMin: DEFAULT_STATS.nMin,
  liftMin: DEFAULT_STATS.liftMin, liftMax: DEFAULT_STATS.liftMax, priorVersion: 0,
  items: {
    'tabby-in-motion-film': { '*': { level: 0, key: '*', n: 120, s: 9, p0: 0.05, n0: 30, p_hat: 0.075, lift: 1.5 } },
    'willow-slg-editorial': { '*': { level: 0, key: '*', n: 80, s: 4.8, p0: 0.05, n0: 30, p_hat: 0.06, lift: 1.2 } },
  },
  slotRates: { '*': { n: 2400, s: 120, rate: 0.05 } },
} as LiftSnapshot;

// ===========================================================================
// unit:W26.I1.01 — page/brand/slot/position identity
// ===========================================================================

describe('unit:W26.I1.01', () => {
  /**
   * R153(c). The placement's identity is page/brand/slot/position on every
   * decision record, ring entry and receipt. The learning identity stays
   * tenant/brand/slot today (F21 §6(b)); page in `statsName`/`liftKey` is a
   * storage migration and is NOT ruled here — it is named as owed on the row —
   * so the remedy F21 §8 names instead is enforced at authoring time: a slot
   * name may not be reused on another page of the same brand, and one
   * statistics object can therefore never pool two placements unknowingly.
   */
  it('logic: the entry and the receipt carry page, brand, slot and position, and a slot name reused on a second page is refused by name', () => {
    const served = record({} as Env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts: T0, position: 2, page: 'pdp', retention: undefined });
    // LOCKED (`src/learn/fan.ts:288`: `brand: r.brand, ts, page: r.page, slot: r.slot, position: r.position`).
    expect(ringEntryOf(served)).toMatchObject({ page: 'pdp', brand: BRAND, slot: 'hero', position: 2, tenant: TENANT });
    // LOCKED (`src/learn/fan.ts:71-72`): the statistics identity is
    // tenant/brand/slot today. W26 does not silently migrate it; the page is
    // owed work, named on the unit row.
    expect(statsName(TENANT, BRAND, 'hero')).toBe('coach:coach:hero');
    expect(liftKey(TENANT, BRAND, 'hero')).toBe('lift:coach:coach:hero');

    // RULED. The receipt is the placement's customer-facing identity and must
    // carry the brand it was served under, beside the page, slot and position
    // it already carries (`src/learn/receipts.ts:98`).
    const receipt = receiptOf(served, NO_NAMES) as unknown as Record<string, unknown>;
    expect(receipt, 'W26.I1.01: `receiptOf` must carry the brand the decision was served under').toMatchObject({ brand: BRAND });
    expect(receipt).toMatchObject({ page: 'pdp', slot: 'hero', position: 2 });

    // RULED (F21 §8, the M: "Page in `statsName`/`liftKey`, or an enforced
    // global uniqueness of slot names across pages"). `validateSlot` refuses a
    // duplicate only within one page today (`src/content/kinds.ts:259`).
    const oneSlotTwoPages = validateSlotCatalog({ pages: { home: [HOME_SLOTS[0]!], pdp: [HOME_SLOTS[0]!] } });
    expect(oneSlotTwoPages.ok,
      'W26.I1.01: a slot name reused on a second page of the same brand must be refused at validation (F21 §6(b), §8)').toBe(false);
    const errors = (oneSlotTwoPages as { ok: false; errors: string[] }).errors.join(' | ');
    expect(errors).toMatch(/hero/);
    expect(errors, 'W26.I1.01: the refusal must name the page the slot name is already used on').toMatch(/home/);
    // LOCKED (`src/content/kinds.ts:259`): the within-page duplicate is still refused...
    expect(validateSlotCatalog({ pages: { home: [HOME_SLOTS[0]!, HOME_SLOTS[0]!] } }).ok).toBe(false);
    // ...and two DIFFERENT slot names on two pages remain valid.
    expect(validateSlotCatalog({ pages: { home: [HOME_SLOTS[0]!], pdp: [HOME_SLOTS[1]!] } }).ok).toBe(true);
  });

  /**
   * The same identity through the route an operator reads. The ring holds what
   * the engine wrote; the receipts route joins the catalogue and reads it out.
   */
  it('host: every receipt the operator route returns names the page, the brand, the slot and the position of its placement', async () => {
    const m = await mount();
    const ts = Date.now() - 60_000;
    const rows = [
      record(m.env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts, page: 'home', position: 0 }),
      record(m.env, { slot: 'rail', item_id: 'tabby-in-motion-film', ts: ts + 1, page: 'home', position: 1 }),
    ];
    m.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: async () => Response.json({ ok: true, ring: rows, index: rows.length },
      { headers: { 'X-Retention-Witness': JSON.stringify(rows[0]!.retention!.online!) } }) }) } as unknown as DurableObjectNamespace;
    const response = await m.operator('GET', `/v1/${TENANT}/visitors/v-w26/receipts`);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { receipts: Array<Record<string, unknown>> };
    expect(body.receipts).toHaveLength(2);
    for (const receipt of body.receipts) {
      expect(receipt, 'W26.I1.01: the receipts route must name the brand of the placement').toMatchObject({ brand: BRAND, page: 'home' });
    }
    expect(body.receipts.map(r => [r.slot, r.position])).toEqual([['rail', 1], ['hero', 0]]);
  });
});

// ===========================================================================
// unit:W26.C1.01 — named-placement credit, and the brand from the decision
// ===========================================================================

describe('unit:W26.C1.01', () => {
  /**
   * R153(a) and (d). The named-slot containment, the `unknown` sentinel and the
   * featured-product rule for product-named rewards are the S fix F21 §8 asked
   * for and they EXIST — they are locked here. What is absent is F21 §6(c)'s
   * second half: "`src/routes/realtime.ts:126` calls `outcomeFromAction(...)`
   * and lets `brand` default to the tenant, while exposures are fanned under
   * the `?brand=` the decision request carried... The first tenant that
   * actually uses brands puts the numerator in one statistics object and the
   * denominator in another."
   */
  it('logic: the named placement is respected, unknown and absent stay legacy, product-named rewards keep the featured-product rule, and the outcome takes its brand from the decision it names', () => {
    const ring = [
      entry({ id: 'd-hero-first', slot: 'hero', item: 'tabby-in-motion-film', ts: T0, products: ['SKU-TABBY'] }),
      entry({ id: 'd-rail', slot: 'rail', item: 'tabby-in-motion-film', ts: T0 + 1, products: ['SKU-TABBY'] }),
      entry({ id: 'd-hero-last', slot: 'hero', item: 'tabby-in-motion-film', ts: T0 + 2, products: ['SKU-TABBY'] }),
    ];
    const click = outcome({ type: 'click', event: 'content_click', item_id: 'tabby-in-motion-film', slot: 'hero', ts: T0 + 60_000 });
    // LOCKED (`src/learn/policy.ts:105`: `if (namedSlot !== null && e.slot !== namedSlot) return false`).
    expect(attribute(click, ring, DEFAULT_POLICY).map(c => [c.slot, c.decision_id])).toEqual([['hero', 'd-hero-last']]);
    expect(attribute({ ...click, slot: 'rail' }, ring, DEFAULT_POLICY).map(c => c.decision_id)).toEqual(['d-rail']);
    expect(attribute({ ...click, slot: 'absent' }, ring, DEFAULT_POLICY)).toEqual([]);
    // LOCKED (`src/learn/policy.ts:96-97`: the SDK's literal `unknown`
    // (`src/sdk/emit.ts:93`) is an unspecified placement, not a slot name).
    for (const slot of ['unknown', '', null]) {
      expect(attribute({ ...click, slot } as OutcomeRecord, ring, DEFAULT_POLICY).map(c => c.slot).sort()).toEqual(['hero', 'rail']);
    }
    // LOCKED (`src/learn/policy.ts:107-108`, CW32): a purchase naming only the
    // product credits the placement that featured it.
    const purchase = outcome({ type: 'purchase', event: 'purchase', item_id: null, products: ['SKU-TABBY'], slot: 'hero', ts: T0 + HOUR });
    expect(attribute(purchase, ring, DEFAULT_POLICY).map(c => c.decision_id)).toEqual(['d-hero-last']);
    expect(attribute({ ...purchase, slot: null }, ring, DEFAULT_POLICY).map(c => c.slot).sort()).toEqual(['hero', 'rail']);

    // RULED (F21 §6(c), §8). The outcome's brand is the brand of the decision
    // the shopper acted on — the brand her page was served under — never the
    // tenant id, or the numerator lands in another brand's statistics object
    // from the denominator.
    const built = outcomeFromAction({ type: 'content_click', userId: 'v-w26', sessionId: 's-w26', timestamp: T0 + 60_000,
      data: { contentId: 'tabby-in-motion-film', slot: 'hero', brand: MULTI_BRAND } }, MULTI_TENANT)!;
    expect(built.brand,
      'W26.C1.01: an outcome from an action naming its brand must carry that brand, not the tenant id (F21 §6(c))').toBe(MULTI_BRAND);
    expect(built).toMatchObject({ tenant: MULTI_TENANT, slot: 'hero', item_id: 'tabby-in-motion-film' });
    // LOCKED (`src/ledger/records.ts:260`): an action that names no brand still
    // falls back to the tenant, so every existing client keeps learning.
    expect(outcomeFromAction({ type: 'content_click', userId: 'v-w26', timestamp: T0, data: { contentId: 'tabby-in-motion-film' } }, MULTI_TENANT)!.brand)
      .toBe(MULTI_TENANT);
  });

  /**
   * Both halves through the real path: the action route (the brand it resolves)
   * and the visitor's own Durable Object (the mismatch it refuses). F21 §6(c)
   * is silent today — `attribute` drops a correlated credit whose entry carries
   * another brand and the receipt says `attributed: 0`, indistinguishable from
   * "nothing matched".
   */
  it('host: the action route resolves the outcome brand from the decision it names, and the ring counts a brand mismatch instead of silently pooling it', async () => {
    const m = await mount({ tenants: [TENANT, MULTI_TENANT], captureOutcomes: true });
    const grant = await newAnonymousSession(m.env, MULTI_TENANT);
    await explicitChoice(m, grant);
    const now = Date.now() - 1000;
    const decisionId = `${MULTI_TENANT}:${ts36(now - 1)}:${grant.subject}:home:hero:0`;
    const posted = await m.call('/realtime/action', grant.capability, {
      type: 'content_click', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId, timestamp: now,
      eventId: crypto.randomUUID(), data: { contentId: 'tabby-in-motion-film', slot: 'hero', brand: MULTI_BRAND, decisionId },
    }, MULTI_TENANT);
    expect(posted.status, await posted.clone().text()).toBe(200);
    await m.drain();
    expect(m.learned.at(-1), 'W26.C1.01: the action route must forward the outcome under the brand the decision was served in')
      .toMatchObject({ brand: MULTI_BRAND, tenant: MULTI_TENANT, decision_id: decisionId, slot: 'hero' });

    // The visitor's own object, in process, over the real classes.
    const ring = await mount({ tenants: [MULTI_TENANT] });
    const served = record(ring.env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts: now, tenant: MULTI_TENANT, brand: MULTI_BRAND, visitor_id: 'v-brand' });
    const appended = await ring.env.DECISION_RING!.get(ring.env.DECISION_RING!.idFromName(ringName(MULTI_TENANT, 'v-brand')))
      .fetch('https://learn/append', { method: 'POST', body: JSON.stringify({ records: [served] }) });
    expect(appended.status).toBe(200);
    const mismatched: OutcomeRecord = { ...outcome({ type: 'click', event: 'content_click', item_id: 'tabby-in-motion-film', slot: 'hero',
      ts: now + 1000, tenant: MULTI_TENANT, brand: 'beta', visitor_id: 'v-brand', outcome_id: `${MULTI_TENANT}:${ts36(now + 1000)}:v-brand:content_click` }),
      decision_id: served.decision_id, retention: captureRetention(ring.env as never, MULTI_TENANT, now + 1000, Date.now()) };
    const receipt = await fanOutcome(ring.env, MULTI_TENANT, mismatched, DEFAULT_POLICY, 'beta', SLOT_CONFIG,
      { reward: 'click', objective: 'unit', stats: DEFAULT_STATS });
    // LOCKED (`src/learn/policy.ts:88`): the credit itself is still refused —
    // and the count beside it is what makes the refusal visible rather than
    // indistinguishable from "nothing matched". The counter must survive the
    // fan-out's own receipt projection (`src/learn/fan.ts:204`), which is where
    // the caller reads it.
    expect(receipt, 'W26.C1.01: an outcome whose brand disagrees with the decision it names must be COUNTED as refused, not silently dropped')
      .toMatchObject({ outcome: { attributed: 0, brandMismatched: 1 } });
    const matched: OutcomeRecord = { ...mismatched, brand: MULTI_BRAND };
    expect(await fanOutcome(ring.env, MULTI_TENANT, matched, DEFAULT_POLICY, MULTI_BRAND, SLOT_CONFIG,
      { reward: 'click', objective: 'unit', stats: DEFAULT_STATS })).toMatchObject({ outcome: { attributed: 1, brandMismatched: 0 } });
  });
});

// ===========================================================================
// unit:W26.F1.01 — brand-wide global-item fatigue, said truly
// ===========================================================================

describe('unit:W26.F1.01', () => {
  /**
   * R153(e). Cross-placement global-item fatigue inside the brand is SETTLED
   * (HANDOFF-2026-09-16:230 "W26.04 live fatigue now filters to brand,
   * retaining intended cross-placement global-item history. Do not accidentally
   * add slot/page/arm fatigue restrictions as a 'fix.'"; HANDOFF-2026-09-18:322
   * "Do not silently restrict intended cross-placement fatigue"). F21 §8 item 5
   * proposes the OPPOSITE — `if (e.slot === s.slot …)` — and the lead has ruled
   * against it for this batch: the behaviour is locked and the words are fixed
   * instead, because the contradiction F21 §6(a) found is a false SENTENCE, not
   * a wrong number.
   */
  it('logic: the count is every placement of the item in the brand, on any page and either arm, and the JSDoc and the receipt sentence say so', () => {
    const ring: RingEntry[] = [
      entry({ id: 'd1', slot: 'hero', item: 'tabby-in-motion-film', ts: T0 }),
      entry({ id: 'd2', slot: 'rail', item: 'tabby-in-motion-film', ts: T0 + 1 }),
      entry({ id: 'd3', slot: 'rail', item: 'tabby-in-motion-film', ts: T0 + 2, page: 'pdp' }),
      entry({ id: 'd4', slot: 'hero', item: 'tabby-in-motion-film', ts: T0 + 3, arm: 'default' }),
    ];
    const slots = [{ slot: 'hero', fatigue: { weight: 0.3, windowHours: 24, cap: 3 } }, { slot: 'rail', fatigue: { weight: 0.3, windowHours: 24, cap: 3 } }];
    // LOCKED (`src/learn/fan.ts:277-280`: the loop reads the whole ring, and
    // adding `e.slot === s.slot`, `e.page === …` or an arm filter fails here).
    expect(servedCounts(ring, slots, T0 + HOUR)).toEqual({
      hero: { 'tabby-in-motion-film': 4 }, rail: { 'tabby-in-motion-film': 4 },
    });

    // RULED (F21 §6(a)). The JSDoc promises the slot and the code counts the
    // brand; the true one is the brand's.
    const fan = sourceOf('src/learn/fan.ts');
    const doc = fan.slice(0, fan.indexOf('export function servedCounts')).split('/**').pop() ?? '';
    expect(doc, 'W26.F1.01: the `servedCounts` JSDoc must say the count is every placement in the brand, not "that slot\'s"')
      .toMatch(/across every placement in the brand/);
    expect(doc).not.toMatch(/that slot's fatigue window/);

    // RULED. The shopper-facing sentence must say the same thing: she was
    // served it this many times ANYWHERE IN THIS BRAND, not in this slot.
    const input: DecideInput = {
      tenant: TENANT, brand: BRAND, page: 'home', visitorId: 'v-w26', sessionId: 's-w26', identityAnchor: 'visitor', nowMs: T0 + HOUR,
      pieces: PIECES, slots: [{ ...HOME_SLOTS[0]!, take: 2, fatigue: { weight: 0.3, windowHours: 24, cap: 3 } }],
      affinity: { dims: { line: { Tabby: 0.4 } } }, cell: COACH_CELL, arm: 'personalized',
      versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'w26-b1',
      served: { hero: { 'tabby-in-motion-film': 2 } },
    };
    const fatigued = decideContent(input).records.find(r => r.item_id === 'tabby-in-motion-film')!;
    // LOCKED (`src/content/decide.ts:284-290`): the arithmetic does not change.
    expect(fatigued.explain.fatigue).toMatchObject({ served: 2, windowHours: 24, applied: -0.2 });
    expect(fatigued.explain.fatigue!.sentence,
      'W26.F1.01: the fatigue sentence must name the scope the count really has — every placement in this brand')
      .toBe('this shopper was served it 2 times anywhere in this brand in the last 24 hours: -0.2');
    expect(receiptOf(fatigued, NO_NAMES).why)
      .toContain('Fatigue: this shopper was served it 2 times anywhere in this brand in the last 24 hours: -0.2.');
  });
});

// ===========================================================================
// unit:W26.X1.01 — position carried, and the table's non-correction stated
// ===========================================================================

describe('unit:W26.X1.01', () => {
  /**
   * R153(f). Position is on the entry and on the batch fold already; the
   * correction itself is the owner's and Data Science's decision (W26.P1.01)
   * and is NOT ruled. What is ruled is F21 §8's honest position: "until that
   * lands, report the lift table as a diagnostic that is not corrected for
   * position or placement — not as evidence of incremental business lift". F21
   * §2 probe 3 measured a 3.80x spread from rank alone against a true content
   * difference of 1.00x, and probe 4 a 3.54x spread from cross-placement
   * credit, so the reader of the table must be told what it does not correct
   * for, by a member with a name and not by a number.
   */
  it('logic: position stays on the entry, and every lift row and learned-lift sentence states that it is corrected for neither position nor placement', () => {
    // LOCKED (`src/learn/fan.ts:288`: `position: r.position`).
    expect(ringEntryOf(record({} as Env, { slot: 'rail', item_id: 'willow-slg-editorial', ts: T0, position: 4, retention: undefined })).position).toBe(4);

    // RULED. The table is a diagnostic until W26.P1.01 decides the correction.
    const rows = rowsOf(SNAPSHOT, NO_NAMES, undefined, 'pooled') as unknown as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row, 'W26.X1.01: every lift row must declare that it is not corrected for position or placement (F21 §8)')
        .toMatchObject({ correction: 'uncorrected-v1' });
      // LOCKED (`src/learn/rows.ts:68`): the row still names its measurement basis.
      expect(row).toMatchObject({ measurementBasis: 'served-v1', objective: 'unit' });
    }

    // RULED. The same sentence on the shopper's own receipt, where the learned
    // lift is read out (`src/learn/receipts.ts:86`).
    const served = record({} as Env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts: T0, retention: undefined });
    const receipt = receiptOf({ ...served, explain: { ...served.explain,
      lift: { reward: 'click', objective: 'unit', measurementBasis: 'served-v1', level: 0, level_words: 'everyone',
        n: 120, s: 9, p0: 0.05, n0: 30, p_hat: 0.075, lift: 1.5, gamma: 0 } } }, NO_NAMES);
    expect(receipt.why.at(-1),
      'W26.X1.01: the learned-lift sentence must state that the estimate corrects for neither position nor placement')
      .toBe('Learned lift 1.5 from everyone (120 served exposures, 9 weighted credit in unit units), shown on the receipt, not applied (trust 0), not corrected for position or placement.');
  });

  it('host: the operator lift table route answers rows that state their non-correction', async () => {
    const m = await mount();
    await m.env.CACHE.put(liftKey(TENANT, BRAND, 'hero'), JSON.stringify(SNAPSHOT));
    const response = await m.operator('GET', `/v1/${TENANT}/lift/rows?slot=hero&level=pooled`);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { rows: Array<Record<string, unknown>>; measurementBasis: string; total: number };
    expect(body.total).toBe(2);
    expect(body.measurementBasis).toBe('served-v1');
    for (const row of body.rows) {
      expect(row, 'W26.X1.01: the lift table an operator reads must state that it is not corrected for position or placement')
        .toMatchObject({ correction: 'uncorrected-v1' });
    }
  });
});

// ===========================================================================
// unit:W26.R1.01 — repeated items, replay, refresh and legacy outcomes
// ===========================================================================

describe('unit:W26.R1.01', () => {
  /**
   * R153(g), and document 35 §5 W26's own closure evidence: "prove repeated
   * item/product across slots/pages, replay and SDK refresh produce correct
   * counts". The same piece in the hero and in the rail is TWO exposures, one
   * per placement; a click naming the hero credits one; a redelivered set is
   * one exposure and one credit (W22 D1.02); and an unknown legacy outcome —
   * no slot, no decision reference — is still credited under the declared
   * legacy rule but must be COUNTED AS LEGACY on the report, never presented as
   * a named-placement credit.
   */
  for (const host of ['session', 'do'] as const) {
    it(`host (${host}): two placements of one piece are two exposures, a named click credits one, a redelivered set counts once, and a legacy outcome is counted as legacy on the report`, async () => {
      const m = await mount({ host });
      const now = Date.now() - 5 * 60_000;
      const hero = record(m.env, { slot: 'hero', item_id: 'tabby-in-motion-film', ts: now, position: 0 });
      const rail = record(m.env, { slot: 'rail', item_id: 'tabby-in-motion-film', ts: now + 1, position: 0 });
      const set = { tenant: TENANT, brand: BRAND, visitor_id: 'v-w26', records: [hero, rail] };
      const configOf = (slot: string) => SLOT_CONFIG[slot]!;

      // The fan-in the decision path runs after the response (`src/content/service.ts:507`).
      const first = await fanDecisions(m.env, set, configOf);
      expect(first).toMatchObject({ ok: true, append: { accepted: 2, duplicates: 0 }, exposures: { received: 2, processed: 2 } });
      // LOCKED (`src/learn/fan.ts:308`, `statsName(row.tenant, row.brand, row.slot)`):
      // one exposure per PLACEMENT, in that placement's own statistics object.
      const exposuresOf = async (slot: string) => {
        const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, BRAND, slot)))
          .fetch('https://learn/snapshot', { method: 'POST', body: JSON.stringify({ tenant: TENANT, brand: BRAND, slot,
            reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' }) });
        const body = await response.json() as { snapshot?: LiftSnapshot };
        return body.snapshot?.items?.['tabby-in-motion-film']?.['*']?.n ?? 0;
      };
      // One decayed exposure each: `tauLearnMs` takes 1 to 0.9998 over five
      // minutes, so the count is compared to three decimals, never to the clock.
      expect(await exposuresOf('hero')).toBeCloseTo(1, 3);
      expect(await exposuresOf('rail')).toBeCloseTo(1, 3);

      // A replayed delivery of the same set: W22 D1.02's logical identity.
      const again = await fanDecisions(m.env, set, configOf);
      expect(again).toMatchObject({ ok: true, append: { accepted: 0, duplicates: 2 } });
      expect(await exposuresOf('hero')).toBeCloseTo(1, 3);
      expect(await exposuresOf('rail')).toBeCloseTo(1, 3);

      // A click that names the hero credits the hero only.
      const named: OutcomeRecord = { ...outcome({ type: 'click', event: 'content_click', item_id: 'tabby-in-motion-film',
        slot: 'hero', ts: now + 60_000, outcome_id: `${TENANT}:${ts36(now + 60_000)}:v-w26:content_click` }),
        retention: captureRetention(m.env as never, TENANT, now + 60_000, Date.now()) };
      expect(await fanOutcome(m.env, TENANT, named, DEFAULT_POLICY, BRAND, SLOT_CONFIG,
        { reward: 'click', objective: 'unit', stats: DEFAULT_STATS })).toMatchObject({ outcome: { attributed: 1, eligible: 1 } });

      // The unknown legacy outcome: no slot, no decision reference. It is still
      // credited under the declared legacy rule (both placements), and that is
      // deliberate — but the report must say these credits are legacy.
      const legacy: OutcomeRecord = { ...outcome({ type: 'click', event: 'content_click', item_id: 'tabby-in-motion-film',
        slot: null, ts: now + 120_000, outcome_id: `${TENANT}:${ts36(now + 120_000)}:v-w26:content_click` }),
        retention: captureRetention(m.env as never, TENANT, now + 120_000, Date.now()) };
      expect(await fanOutcome(m.env, TENANT, legacy, DEFAULT_POLICY, BRAND, SLOT_CONFIG,
        { reward: 'click', objective: 'unit', stats: DEFAULT_STATS })).toMatchObject({ outcome: { attributed: 2 } });

      // The day's own report, built by the real consumer and the real report
      // route over the real producer's queue bodies.
      await enqueueDecisions(m.env, [hero, rail]);
      for (const row of [named, legacy]) await enqueueOutcome(m.env, row);
      const written = await consumeLedger(m.env, m.queued.splice(0), now + 180_000);
      expect(written).toMatchObject({ ok: true });
      const date = new Date(now).toISOString().slice(0, 10);
      const response = await m.operator('POST', `/v1/${TENANT}/learn/report`, { date, brand: BRAND });
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json() as { report: { policies: Array<Record<string, unknown>> } };
      const learning = body.report.policies.find(p => p.name === 'learning')!;
      // LOCKED: the legacy credit is not withheld — it is still credited.
      expect(learning.credits).toBe(3);
      expect(learning, 'W26.R1.01: the report must count the credits that came from legacy outcomes — no slot and no decision reference — as legacy')
        .toMatchObject({ legacyCredits: 2 });
    });
  }

  /**
   * The SDK half of "repeated item... and SDK refresh produce correct counts",
   * on the shipped bundle under a real DOM, the path W17 established. The
   * lifecycle defects of F34 §2A/§2B are W17's and are not re-specified here:
   * what is W26's is the COUNT. One piece painted in two placements is two
   * exposures, and a refresh that re-delivers the same set is not a second one.
   */
  it('sdk: the shipped bundle sends one impression per placement and a refresh of the same set sends no second impression', async () => {
    const dom = new JSDOM('<main><div id="hero" data-op-content="tabby-in-motion-film" data-op-slot="hero"></div>'
      + '<div id="rail" data-op-content="tabby-in-motion-film" data-op-slot="rail"></div></main>', { url: 'https://shop.example/home' });
    const win = dom.window as unknown as { document: { getElementById(id: string): PageElement | null }; close(): void };
    const el = (id: string) => win.document.getElementById(id)!;
    const code = readFileSync(resolve(process.cwd(), 'public/sdk/edge-personalization.esm.js'), 'utf8');
    const module = { exports: {} as Record<string, unknown> };
    runInNewContext(transformSync(code, { format: 'cjs' }).code + '\nmodule.exports;', {
      module, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, btoa, atob,
      setTimeout, clearTimeout, setInterval, clearInterval, crypto,
    });
    const { createClient } = module.exports as unknown as { createClient: (config: unknown, host: unknown) => {
      core: { ready: () => Promise<boolean> }; listen: { apply: (set: unknown) => unknown }; emit: { rendered: (slot: string, contentId: string, el?: unknown) => Promise<unknown> } } };
    const { testHost, offeredSet } = await import('@/sdk/testHost');
    const f = testHost({ renderAcks: true });
    const client = createClient({ tenant: TENANT, brand: BRAND }, f.host);
    await client.core.ready();
    const decision = (slot: string, order: number) => ({ contentId: 'tabby-in-motion-film', customerContentId: 'cms-tabby-in-motion-film',
      slot, order, type: 'editorial', strategy: 'affinity' as const, score: 1, explain: { drivers: [] } });
    const set = offeredSet({ page: 'home', decisions: [decision('hero', 0), decision('rail', 1)] } as never, 'w26-page');
    const impressions = () => f.calls.filter(c => c.url.endsWith('/action'))
      .map(c => JSON.parse(c.init!.body!) as { type: string; data: Record<string, unknown> })
      .filter(e => e.type === 'content_impression');

    client.listen.apply(set);
    await client.emit.rendered('hero', 'tabby-in-motion-film', el('hero'));
    await client.emit.rendered('rail', 'tabby-in-motion-film', el('rail'));
    expect(impressions().map(e => [e.data.slot, e.data.position]),
      'W26.R1.01: one piece painted in two placements is two exposures, one per placement').toEqual([['hero', 0], ['rail', 1]]);

    // The refresh: the same page instance, the same decisions, delivered again.
    client.listen.apply(set);
    await client.emit.rendered('hero', 'tabby-in-motion-film', el('hero'));
    await client.emit.rendered('rail', 'tabby-in-motion-film', el('rail'));
    expect(impressions(), 'W26.R1.01: a refresh that re-delivers the same set must not acknowledge the same placement twice').toHaveLength(2);
    expect(el('rail').getAttribute('data-op-slot')).toBe('rail');
    win.close();
  });
});
