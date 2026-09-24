// src/units/W26/LEDGER.unit.test.ts
// W26 — the later W26 unit of LANE-LOG R198, as the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W26) states it:
//
//   R2  page is part of the storage identity, so a retained catalogue with a
//       cross-page duplicate never pools silently — written and READ: serving,
//       the operator's lift reads, the monitor, the managed exposure path and
//       the recovery record follow the page-separated object (pending
//       amendment A16 grants those read paths).
//   R3  The SDK sends data.brand.
//   R4  brandMismatched is counted for uncorrelated outcomes as well, or the
//       limit is stated.
//   R5  The operator lift table shows the correction column.
//
// U1, I1, C1, F1, X1 and R1 are proven by src/units/W26/B1.unit.test.ts and are
// not re-specified here. LG1 is the acceptance command's second part (W26.02 of
// src/routes/realtime.sdkContract.test.ts, corrected in this same commit).
//
// Witnesses: document 35 §5 row W26 (:428); F21 §6(b) "The learning identity
// has no page… `home/hero` and `pdp/hero` share one statistics object", §6(c)
// (the outcome's brand), §8 ("Page in `statsName`/`liftKey`, or an enforced
// global uniqueness of slot names across pages"; "report the lift table as a
// diagnostic that is not corrected for position or placement");
// docs/kit/03-payload-schemas.md:26-32 (`data.brand` "the same value the
// decision request carried… Send it wherever a tenant serves more than one
// brand"); LANE-LOG R153, R155, R157, R189, R194 and R198 (the four residuals
// routed here); the W26-B1 build review
// (/home/simonecoelho/rem/_evidence/W26-B1/reviewer-build/REPORT.md, residuals).
//
// The customer fixture is Tapestry's own: one Tapestry-wide tenant whose launch
// brand is Coach (F21 §6(c): "Tapestry, whose contract is Tapestry-wide with
// Coach as the launch brand"), a second brand of the same tenant, Coach's Tabby
// lifestyle hero (docs/architecture/tapestry_requirements.txt:113) and a
// cross-category lookbook carrying a tag dimension the registry does not map.
//
// The harness is the one src/units/W26/B1.unit.test.ts uses (real classes over
// storage stubs, the mounted routes, the publication set); that file is not
// imported, because importing a `.test.ts` registers its whole suite twice.

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { transformSync } from 'esbuild';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { invalidatePublicationCache, initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { contentRoutes } from '@/routes/content';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import type { Cell, ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { newAnonymousSession, SHOPPER_HEADER, verifySessionCapability } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { fanDecisions, fanOutcome, ringName, statsName, type SlotLearnConfig } from '@/learn/fan';
import { DEFAULT_POLICY } from '@/learn/policy';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createListen } from '@/sdk/listen';
import { offeredSet, testHost } from '@/sdk/testHost';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { SinkReconciliation } from '@/ops/monitor';
import type { Env } from '@/types/env';

// ---------------------------------------------------------------------------
// The customer's fixture.
// ---------------------------------------------------------------------------

/** One Tapestry-wide tenant (F21 §6(c)). */
const TENANT = 'tapestry';
/** Its launch brand, and a second brand of the same tenant. */
const BRAND = 'coach';
const OTHER_BRAND = 'kate-spade';
const OPERATOR_SECRET = 'w26-ledger-synthetic-operator-signing-material';
const DAY_MS = 86_400_000;
/** The checkout this file lives in, whatever the working directory (the 2026-09-20 W29-B1 lesson). */
const ROOT = new URL('../../../', import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, ROOT), 'utf8');

const COACH_CELL: Cell = { channel: 'paid_social', visit_bucket: '1', region: 'US-NY', affinity: 'line:Tabby', stage: 'mid' };

const TABBY = 'tabby-in-motion-film';
const WILLOW = 'willow-slg-editorial';
const ROGUE = 'rogue-occasion-lookbook';
/** A piece of the tenant's second brand, which this visitor was never served. */
const OTHER_BRAND_PIECE = 'kate-spade-knott-editorial';
const piece = (id: string, type: string, tags: Record<string, string[]>): ContentPiece => ({
  id, customerContentId: `cms-${id}`, type, title: id, tags, slotTypes: ['hero', 'rail'], lifecycle: { status: 'live' },
});
const PIECES: ContentPiece[] = [
  piece(TABBY, 'video', { line: ['Tabby'], category: ['Handbags'] }),
  piece(WILLOW, 'editorial', { line: ['Willow'], category: ['Small Leather Goods'] }),
  // Cross-category, and a tag dimension no registry maps.
  piece(ROGUE, 'lookbook', { line: ['Rogue'], category: ['Handbags', 'Small Leather Goods'], unmapped_dimension: ['x'] }),
];
const HERO: SlotStrategy = { slot: 'hero', take: 1, weights: { line: 0.5, category: 0.3 } };
const RAIL: SlotStrategy = { slot: 'rail', take: 1, weights: { line: 0.5, category: 0.3 } };
/** The two pages every catalogue of this tenant has today: slot names unique across pages. */
const UNIQUE_SLOTS: SlotCatalog = { version: 'w26-ledger-unique', pages: { home: [HERO, RAIL] } };
/**
 * A catalogue RETAINED from before W26.I1.01's authoring-time rule: the name
 * `hero` on the home page and on the product page. `validateSlotCatalog` refuses
 * it for any new write; a retained document keeps reading (`SLOTS_KIND
 * .validateStored`), which is the case R198 names: "a RETAINED catalogue with a
 * cross-page duplicate still pools silently — nothing warns".
 */
const RETAINED_DUPLICATE: SlotCatalog = { version: 'w26-ledger-retained', pages: { home: [HERO, RAIL], pdp: [HERO] } };
const LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w26-ledger', arms: ['default'] },
  slots: { hero: { reward: 'click' }, rail: { reward: 'click' } },
};
const SLOT_CONFIG: Record<string, SlotLearnConfig> = {
  hero: { reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' },
  rail: { reward: 'click', objective: 'unit', stats: DEFAULT_STATS, measurementBasis: 'served-v1' },
};
const CLICK_CONFIG: SlotLearnConfig = { reward: 'click', objective: 'unit', stats: DEFAULT_STATS };
/** The same learning document with the hero counted by its durably admitted render (`rendered-v1`, W15): the managed path. */
const RENDERED_LEARN: LearnConfig = { ...LEARN, slots: { hero: { reward: 'click', measurementBasis: 'rendered-v1' }, rail: { reward: 'click' } } };

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

const fixturePolicy: RetentionPolicy = { id: 'w26-ledger-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant =>
  [tenant, Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface Registry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  cache: UnitKV;
  storage: UnitR2;
  stats: Map<string, Registry>;
  /** The shoppers' own objects: the owner that holds her consent and her recovery records. */
  shoppers: Map<string, Registry>;
  /** Every body the real producer handed to the queue binding, in order. */
  queued: unknown[];
  fetch: (request: Request) => Promise<Response>;
  operatorToken: string;
  drain: () => Promise<void>;
}

/**
 * The routes production serves, mounted as `src/index.ts` mounts them, over the
 * real Durable Object classes, for the Tapestry tenant.
 */
async function mount(options: { slots?: SlotCatalog; retainedSlots?: boolean; learn?: LearnConfig; recovery?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [], queued: unknown[] = [];
  const storage = new UnitR2(), cache = new UnitKV(), sessions = new UnitKV();
  const shoppers = new Map<string, Registry>(), rings = new Map<string, Registry>(), stats = new Map<string, Registry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: sessions, STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session',
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w26-ledger-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    // `recovery` binds the durable rendered admission (W15), the owner-held
    // path that runs the managed exposure fan-in (`src/ledger/recovery.ts`).
    LEDGER_RECOVERY_ENABLED: options.recovery ? 'true' : 'false',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const message of messages) queued.push(message.body); } },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });

  const namespaceFor = (make: (state: DurableObjectState, env: Env) => Registry['object'], registry: Map<string, Registry>) => ({
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
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), rings) as unknown as DurableObjectNamespace;

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, retainedValue = false): PublicationBaseline =>
    ({ kind, scope: TENANT, revision: { revision: 1, at: 1, actor: 'w26-ledger-fixture', note: 'fixture', value }, ...(retainedValue ? { retainedValue: true as const } : {}) });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { pieces: PIECES }),
    // `retainedValue` is the publication's own mechanism for "explicit reviewed
    // historical bytes" (`src/config/publication.ts`): read under
    // `validateStored`, never re-validated as a new write.
    baseline(SLOTS_KIND, options.slots ?? UNIQUE_SLOTS, options.retainedSlots === true),
    baseline(LEARN_KIND, options.learn ?? LEARN),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    { kind: REFLEX_KIND, scope: reflexScopeForTenant(TENANT), revision: { revision: 1, at: 1, actor: 'w26-ledger-fixture', note: 'fixture',
      value: { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' } } },
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const operatorToken = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const fetchOne = async (request: Request) => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, cache, storage, stats, shoppers, queued, fetch: fetchOne, operatorToken, drain };
}

/** A served decision, in the shape the engine writes and the ring keeps. */
function record(env: Env, over: Partial<DecisionRecord> & { slot: string; item_id: string; ts: number; page: string }): DecisionRecord {
  const visitor = over.visitor_id ?? 'v-w26-ledger', position = over.position ?? 0, brand = over.brand ?? BRAND;
  return {
    decision_id: `${TENANT}:${ts36(over.ts)}:${visitor}:${over.page}:${over.slot}:${position}`,
    tenant: TENANT, brand, visitor_id: visitor, session_id: 's-w26-ledger', identity_anchor: 'visitor',
    position, customer_item_id: `cms-${over.item_id}`, candidates: [], cell: COACH_CELL,
    arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 },
    config_label: 'w26-ledger', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null },
    retention: captureRetention(env as never, TENANT, over.ts, Date.now()),
    ...over,
  } as DecisionRecord;
}

/** A content click, as the action route builds it (`outcomeFromAction`), with its retention stamp. */
function click(env: Env, over: Partial<OutcomeRecord> & { item_id: string; slot: string | null; ts: number; brand: string }): OutcomeRecord {
  return {
    outcome_id: `${TENANT}:${ts36(over.ts)}:v-w26-ledger:content_click`, tenant: TENANT, visitor_id: 'v-w26-ledger',
    session_id: 's-w26-ledger', type: 'click', event: 'content_click', value: null, currency: null, margin: null, products: null,
    arm: 'personalized', retention: captureRetention(env as never, TENANT, over.ts, Date.now()), ...over,
  } as OutcomeRecord;
}

/** What each statistics object of the namespace holds, read through its own `/snapshot`. */
async function statisticsObjects(m: Mounted): Promise<Array<{ name: string; items: Record<string, Record<string, { n: number; s: number }>> }>> {
  const out: Array<{ name: string; items: Record<string, Record<string, { n: number; s: number }>> }> = [];
  for (const name of [...m.stats.keys()].sort()) {
    const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
    const body = await response.json() as { snapshot?: LiftSnapshot | null };
    if (body.snapshot) out.push({ name, items: body.snapshot.items as never });
  }
  return out;
}

/** Publishes every statistics object that holds evidence, each through its own `/publish`, whatever the build names it. */
async function publishEvery(m: Mounted): Promise<void> {
  for (const o of await statisticsObjects(m)) {
    const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(o.name)).fetch('https://learn/publish', { method: 'POST' });
    expect(await published.json(), `PRECONDITION: ${o.name} publishes its snapshot`).toMatchObject({ ok: true, published: true });
  }
}

type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
type Answer = { status: number; body: Record<string, unknown> };

/** A request the shopper's browser makes with her own grant. */
async function asShopper(m: Mounted, grant: Grant, path: string, body?: unknown): Promise<Answer> {
  const response = await m.fetch(new Request(`https://shop.invalid${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

/** A request the Tapestry operator makes with her signed token. */
async function asOperator(m: Mounted, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
  const response = await m.fetch(new Request(`https://ops.invalid${path}`, {
    method, headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

/** Sarah, with tracking and personalization on by her own explicit choice (HANDOFF-2026-09-18 §7, consent). */
async function consentingShopper(m: Mounted): Promise<Grant> {
  const grant = await newAnonymousSession(m.env, TENANT);
  const chosen = await asShopper(m, grant, `/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
  expect(chosen.status, `PRECONDITION: her explicit choice is accepted (${JSON.stringify(chosen.body).slice(0, 200)})`).toBe(200);
  return grant;
}

/**
 * The decision the serving route composes for her page: `GET /v1/:tenant/decisions/snapshot`
 * calls `serveContentDecisions` exactly so (`src/routes/decisions.ts`), inside the owner
 * operation `requireShopper` holds, and answers without the records; the records are read
 * here, one layer in, as src/units/W25/B1.unit.test.ts reads them.
 */
async function servePage(m: Mounted, grant: Grant, page: string) {
  const live = await verifySessionCapability(m.env, grant.capability, TENANT);
  const owner = {};
  return runOwnerOperation(owner, m.env, async () => {
    admitOwnerPrincipal(owner, live);
    return serveContentDecisions(m.env, { tenant: TENANT, brand: BRAND, page, visitorId: live.subject, sessionId: live.sessionId,
      cookieHeader: null, stateTenant: TENANT as TenantId, principal: live, capability: grant.capability, offer: { pageInstance: `w26-ledger-${page}` } });
  }, m.env.SESSIONS as unknown as Parameters<typeof runOwnerOperation>[3], undefined,
    (async () => m.shoppers.get(shopperObjectName(TENANT as TenantId, live.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
}

/**
 * What each hero placement of the retained catalogue has learned from: every
 * piece, 32 times on the home page and 64 times on the product page, and the
 * rail (unique to the home page) the lookbook 32 times — each count above the
 * estimator's `nMin` (30, DEFAULT_STATS), so every piece has a learned lift on
 * each page, and no two of the three tables (home, product page, both pooled)
 * hold the same count.
 */
const HERO_EXPOSURES = { home: 32, pdp: 64 } as const;
const RAIL_EXPOSURES = 32;

/** The retained catalogue's two pages served through the real fan-in, one page at a time, and every object published. */
async function learnedWorld(m: Mounted): Promise<void> {
  const at = Date.now() - 5 * 60_000;
  const refused: unknown[] = [];
  for (let k = 0; k < HERO_EXPOSURES.pdp; k++) {
    const visitor = `v-w26-ledger-${k}`;
    for (const page of ['home', 'pdp'] as const) {
      if (k >= HERO_EXPOSURES[page]) continue;
      const offset = page === 'home' ? 0 : 5;
      const records = [TABBY, WILLOW, ROGUE].map((item, i) => record(m.env, { page, slot: 'hero', item_id: item, ts: at + k * 10 + offset + i, visitor_id: visitor }));
      if (page === 'home' && k < RAIL_EXPOSURES) records.push(record(m.env, { page, slot: 'rail', item_id: ROGUE, ts: at + k * 10 + 3, visitor_id: visitor }));
      const receipt = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records }, slot => SLOT_CONFIG[slot]!);
      if (!receipt.ok) refused.push({ visitor, page, receipt });
    }
  }
  expect(refused, 'PRECONDITION: every page\'s served set reached the fan-in whole').toEqual([]);
  await publishEvery(m);
}

// ===========================================================================
// unit:W26.R2 — page in the storage identity: a retained cross-page duplicate
// never pools
// ===========================================================================

describe('unit:W26.R2', () => {
  /**
   * F21 §6(b): "`statsName(tenant, brand, slot)` and `liftKey(...)` carry no
   * page… So `home/hero` and `pdp/hero` share one statistics object, one
   * baseline rate, one lift table, one gamma, one reward and one objective."
   * W26-B1 closed the authoring door (I1.01: a new catalogue may not reuse a
   * slot name on a second page); LANE-LOG R198 routed what that leaves: "`page`
   * in the storage identity (a RETAINED catalogue with a cross-page duplicate
   * still pools silently — nothing warns)".
   *
   * One world with the ticket's existing units: src/units/W26/B1.unit.test.ts
   * locks the page-less names for slots whose name is unique across pages —
   * `statsName(t, b, 'hero') === 't:b:hero'` (:527-531) and exposures fanned for
   * the unique `hero`/`rail` read back from exactly those objects (:834-844). So
   * the page enters the identity where the page is what tells two placements
   * apart: a slot name the brand's catalogue carries on more than one page. A
   * unique name is locked below to keep its object, and with it every
   * statistic already learned under it.
   */
  it('host: under a retained catalogue carrying `hero` on the home page and on the product page, exposures and credits of the two placements land in two statistics objects that publish two snapshots, while a slot unique to one page keeps the object it has always had', async () => {
    const m = await mount({ slots: RETAINED_DUPLICATE, retainedSlots: true });
    const now = Date.now() - 5 * 60_000;
    const homeHero = record(m.env, { page: 'home', slot: 'hero', item_id: TABBY, ts: now });
    const homeRail = record(m.env, { page: 'home', slot: 'rail', item_id: ROGUE, ts: now + 1 });
    const pdpHero = record(m.env, { page: 'pdp', slot: 'hero', item_id: WILLOW, ts: now + 2 });
    const configOf = (slot: string) => SLOT_CONFIG[slot]!;
    // The fan-in the decision path runs after each page's response
    // (`src/content/service.ts` → `fanDecisions`), one page at a time.
    expect(await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-w26-ledger', records: [homeHero, homeRail] }, configOf))
      .toMatchObject({ ok: true, exposures: { received: 2, processed: 2 } });
    expect(await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: 'v-w26-ledger', records: [pdpHero] }, configOf))
      .toMatchObject({ ok: true, exposures: { received: 1, processed: 1 } });
    // A click the shopper made on the product page's hero. The outcome names the
    // slot and the piece; the ring's entry for that piece carries the page.
    const clicked = click(m.env, { item_id: WILLOW, slot: 'hero', ts: now + 60_000, brand: BRAND });
    expect(await fanOutcome(m.env, TENANT, clicked, DEFAULT_POLICY, BRAND, SLOT_CONFIG, CLICK_CONFIG))
      .toMatchObject({ outcome: { attributed: 1 } });

    // LOCKED (B1:527-531 and :834-844): the unique `rail` keeps its page-less object.
    const objects = await statisticsObjects(m);
    const rail = objects.find(o => o.name === statsName(TENANT, BRAND, 'rail'));
    expect(rail ? Object.keys(rail.items) : `no object named ${statsName(TENANT, BRAND, 'rail')}`,
      'a slot name unique to one page keeps the statistics object it has always had').toEqual([ROGUE]);

    // RED: the two `hero` placements are two statistics objects, never one.
    const hero = objects.filter(o => TABBY in o.items || WILLOW in o.items);
    expect(hero.map(o => Object.keys(o.items).sort()).sort(),
      'W26.R2: home/hero and pdp/hero must be two statistics objects, one per page, so a retained cross-page duplicate never pools (F21 §6(b); LANE-LOG R198)')
      .toEqual([[TABBY], [WILLOW]]);
    // One decayed exposure each (tauLearnMs takes 1 to 0.9998 over five
    // minutes), and the click credited on the product page only.
    const home = hero.find(o => TABBY in o.items)!, pdp = hero.find(o => WILLOW in o.items)!;
    expect(home.items[TABBY]!['*']!.n).toBeCloseTo(1, 3);
    expect(home.items[TABBY]!['*']!.s, 'the home hero earned no credit').toBe(0);
    expect(pdp.items[WILLOW]!['*']!.n).toBeCloseTo(1, 3);
    expect(pdp.items[WILLOW]!['*']!.s, 'the product-page hero earned the click').toBeCloseTo(1, 3);

    // RED: and each publishes its own snapshot, under its own key, so neither
    // page's lift table is the other's.
    for (const o of hero) {
      const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(o.name)).fetch('https://learn/publish', { method: 'POST' });
      expect(await published.json(), `${o.name} publishes`).toMatchObject({ ok: true, published: true });
    }
    const snapshots = [...m.cache.data].filter(([key]) => key.startsWith('lift:'))
      .map(([, body]) => Object.keys((JSON.parse(body) as LiftSnapshot).items)).filter(items => items.includes(TABBY) || items.includes(WILLOW));
    expect(snapshots.map(items => [...items].sort()).sort(),
      'W26.R2: the two pages\' hero snapshots are published under two keys (F21 §8 "Page in `statsName`/`liftKey`")')
      .toEqual([[TABBY], [WILLOW]]);
  });

  // -------------------------------------------------------------------------
  // The read side. F21 §8 puts the page in `statsName`/`liftKey` so that the
  // two placements are two things; a build that splits the WRITES and keeps
  // READING the page-less name serves, reports, monitors and cleans up against
  // an object nothing writes to — or against the other page's — which is the
  // silent pooling R198 names, moved one step along. Every reader of the
  // identity follows it (pending amendment A16 grants the read paths): serving
  // (`src/content/service.ts:85`, `readLift` and its live witness), the
  // operator's lift reads (`src/routes/decisions.ts:219`, `:432`), the
  // monitor's cross-sink comparison (`src/ops/monitor.ts:509`), and the
  // managed exposure path with the recovery record that names its cleanup
  // (`src/learn/fan.ts:471-474`, `src/ledger/recovery.ts:204`). Each leg finds
  // the objects by what they hold, never by a name, so it holds whatever
  // page-qualified name the build chooses.
  // -------------------------------------------------------------------------

  it('host: serving (src/content/service.ts:85, the lift snapshot and its live witness) reads the page it composes — her product page\'s hero is decided with the product page\'s own learned lift and her home page\'s hero with the home page\'s, never with both pages pooled', async () => {
    const m = await mount({ slots: RETAINED_DUPLICATE, retainedSlots: true });
    await learnedWorld(m);
    const sarah = await consentingShopper(m);
    for (const page of ['home', 'pdp'] as const) {
      const served = await servePage(m, sarah, page);
      expect(served.arm, `PRECONDITION: on the ${page} page she is served the personalized experience`).toBe('personalized');
      const hero = served.records.find(r => r.slot === 'hero');
      expect(hero?.item_id, `PRECONDITION: the ${page} page serves its hero`).toEqual(expect.any(String));
      // `explain.lift` is the learned lift the decision read for the piece it
      // served (shown at trust 0, `src/content/decide.ts`); its `n` says which
      // table it came from: 32 on the home page, 64 on the product page, 96
      // pooled, none from an object nothing wrote to.
      expect(hero?.explain.lift ? Math.round(hero.explain.lift.n) : `the ${page} hero was decided with no learned lift`,
        `W26.R2: the ${page} page's hero must be decided with the ${page} page's own learned lift — ${HERO_EXPOSURES[page]} exposures of the piece it served — never the pooled table of both pages' heroes nor a page-less snapshot nothing writes (F21 §6(b), §8; A16)`)
        .toBe(HERO_EXPOSURES[page]);
    }
  });

  it('host: the operator\'s lift reads (src/routes/decisions.ts:219 `GET /v1/:tenant/lift/rows`, :432 `GET /v1/:tenant/lift`) answer the page they are asked for — `page=pdp` the product page\'s hero table and `page=home` the home page\'s — while a slot unique to one page keeps answering without one', async () => {
    const m = await mount({ slots: RETAINED_DUPLICATE, retainedSlots: true });
    await learnedWorld(m);
    for (const page of ['home', 'pdp'] as const) {
      const count = HERO_EXPOSURES[page];
      const rows = await asOperator(m, 'GET', `/v1/${TENANT}/lift/rows?slot=hero&brand=${BRAND}&page=${page}`);
      expect({ status: rows.status, published: rows.body.published,
        rows: ((rows.body.rows ?? []) as Array<{ item: string; n: number }>).map(row => [row.item, Math.round(row.n)]).sort() },
      `W26.R2: the lift table the operator reads for the ${page} page's hero must be that page's own — every piece at ${count} exposures — never both pages pooled nor a page-less key nothing publishes (F21 §6(b) "one lift table"; A16)`)
        .toEqual({ status: 200, published: true, rows: [[ROGUE, count], [TABBY, count], [WILLOW, count]] });
      const table = await asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=hero&brand=${BRAND}&page=${page}`);
      const snapshot = table.body.snapshot as { items?: Record<string, Record<string, { n: number }>> } | null | undefined;
      expect(snapshot?.items ? Object.fromEntries(Object.entries(snapshot.items).map(([item, cells]) => [item, Math.round(cells['*']?.n ?? 0)])) : `no snapshot (${table.status})`,
        `W26.R2: the snapshot in force the operator reads for the ${page} page's hero must be that page's own (A16)`)
        .toEqual({ [ROGUE]: count, [TABBY]: count, [WILLOW]: count });
    }
    // LOCKED (B1:490-491, :527-531): a slot name unique to one page is read
    // without a page, from the object it has always had.
    const rail = await asOperator(m, 'GET', `/v1/${TENANT}/lift/rows?slot=rail&brand=${BRAND}`);
    expect(((rail.body.rows ?? []) as Array<{ item: string; n: number }>).map(row => [row.item, Math.round(row.n)]),
      'a slot name unique to one page keeps its page-less read').toEqual([[ROGUE, RAIL_EXPOSURES]]);
  });

  it('host: the monitor\'s cross-sink comparison (src/ops/monitor.ts:509) reads the objects the two hero placements are learned in — the online credits of both pages\' heroes agree with the day\'s ledger and the scheduled run reports them in agreement, never as a disagreement against an object nothing writes to', async () => {
    const m = await mount({ slots: RETAINED_DUPLICATE, retainedSlots: true });
    const at = Date.now() - 2 * 3_600_000, date = new Date(at).toISOString().slice(0, 10);
    const decisions: DecisionRecord[] = [], outcomes: OutcomeRecord[] = [], refused: unknown[] = [];
    // Ten shoppers click the Tabby film in the home page's hero, twelve the
    // Willow editorial in the product page's hero: one placement each, so every
    // click names exactly the placement it credits.
    for (const [page, item, clicks] of [['home', TABBY, 10], ['pdp', WILLOW, 12]] as const) {
      for (let k = 0; k < clicks; k++) {
        const visitor = `v-w26-ledger-${page}-${k}`, ts = at + k * 1000;
        const served = record(m.env, { page, slot: 'hero', item_id: item, ts, visitor_id: visitor, session_id: `s-${visitor}` });
        const clicked = { ...outcomeFromAction({ type: 'content_click', userId: visitor, sessionId: `s-${visitor}`, timestamp: ts + 60_000,
          eventId: `w26-ledger-click-${page}-${k}`, eventIdSource: 'provided', data: { contentId: item, slot: 'hero', brand: BRAND } } as never, TENANT, BRAND)!,
        retention: captureRetention(m.env as never, TENANT, ts + 60_000, Date.now()) } as OutcomeRecord;
        const exposed = await fanDecisions(m.env, { tenant: TENANT, brand: BRAND, visitor_id: visitor, records: [served] }, slot => SLOT_CONFIG[slot]!);
        const credited = await fanOutcome(m.env, TENANT, clicked, DEFAULT_POLICY, BRAND, SLOT_CONFIG, CLICK_CONFIG);
        if (!exposed.ok || credited.outcome?.attributed !== 1) refused.push({ page, visitor, exposed, credited });
        decisions.push(served); outcomes.push(clicked);
      }
    }
    expect(refused, 'PRECONDITION: every exposure and every click reached the online sink').toEqual([]);
    const holders = (await statisticsObjects(m)).filter(o => TABBY in o.items || WILLOW in o.items);
    expect(holders.map(o => Object.keys(o.items).sort()).sort(),
      'PRECONDITION (the write leg above): the two pages\' hero credits are held in two statistics objects, one per page')
      .toEqual([[TABBY], [WILLOW]]);

    // The same events through the real producer, the real consumer and the report route.
    await enqueueDecisions(m.env, decisions);
    for (const outcome of outcomes) await enqueueOutcome(m.env, outcome);
    const written = await consumeLedger(m.env, m.queued.splice(0), Date.now());
    expect(written, 'PRECONDITION: the real consumer wrote the day').toMatchObject({ ok: true });
    const report = await asOperator(m, 'POST', `/v1/${TENANT}/learn/report`, { date, brand: BRAND });
    expect(report.status, `PRECONDITION: the day's report is built (${JSON.stringify(report.body).slice(0, 200)})`).toBe(200);
    const hero = ((report.body.report as { holdout?: Record<string, Array<{ arm: string; credited: number }>> } | undefined)?.holdout?.hero ?? []);
    expect(hero.filter(row => row.arm === 'personalized').reduce((sum, row) => sum + row.credited, 0),
      'PRECONDITION: the day\'s ledger credits the hero with both pages\' clicks').toBe(22);

    const run = await asOperator(m, 'POST', `/v1/${TENANT}/monitor`);
    const reconciliation = (run.body.result as { reconciliation?: SinkReconciliation } | undefined)?.reconciliation;
    expect(reconciliation ? { heroCompared: reconciliation.compared >= 1, disagreements: reconciliation.disagreements } : `no reconciliation (${run.status}: ${JSON.stringify(run.body).slice(0, 200)})`,
      'W26.R2: the scheduled comparison must read the online credits where both pages\' hero placements are learned — 22, as the ledger says — and report the two sinks in agreement, never compare the ledger with a page-less object nothing writes to or with one page\'s object alone (F16 §7; A16)')
      .toEqual({ heroCompared: true, disagreements: [] });
  });

  it('host: the managed exposure path (src/learn/fan.ts:471-474, prepared by the owner\'s recovery) and the recovery record\'s cleanup destinations (src/ledger/recovery.ts:204) follow the page-separated object — her rendered hero on the home page and on the product page is admitted durably, each exposure lands in its own page\'s statistics object, and every object that holds one of her exposures is named for her cleanup', async () => {
    const m = await mount({ slots: RETAINED_DUPLICATE, retainedSlots: true, learn: RENDERED_LEARN, recovery: true });
    const sarah = await consentingShopper(m);
    const acks: unknown[] = [];
    for (const page of ['home', 'pdp'] as const) {
      const pageInstance = `w26-ledger-render-${page}`;
      const snapshot = await asShopper(m, sarah, `/v1/${TENANT}/decisions/snapshot`, { page, pageInstance, brand: BRAND });
      const hero = ((snapshot.body.decisions ?? []) as Array<{ slot: string; contentId: string; decisionId?: string; renderOffer?: string }>).find(d => d.slot === 'hero');
      expect(hero?.renderOffer, `PRECONDITION: the ${page} page's hero is offered for a render acknowledgement (${snapshot.status}: ${JSON.stringify(snapshot.body).slice(0, 200)})`).toMatch(/^ro1\./);
      const ack = await asShopper(m, sarah, '/realtime/action', { type: 'content_impression', source: 'sdk', userId: sarah.subject, sessionId: sarah.sessionId,
        timestamp: Date.now(), eventId: crypto.randomUUID(), data: { contentId: hero!.contentId, decisionId: hero!.decisionId, renderOffer: hero!.renderOffer,
          page, pageInstance, slot: 'hero', position: 0 } });
      acks.push([page, ack.status, (ack.body.render as { status?: string } | undefined)?.status ?? null]);
    }
    expect(acks, 'PRECONDITION: both renders are admitted durably (W15)').toEqual([['home', 200, 'durable'], ['pdp', 200, 'durable']]);

    // The managed exposure: each render is one exposure, in its own page's object.
    const holders = (await statisticsObjects(m))
      .map(o => ({ name: o.name, exposures: Object.values(o.items).reduce((sum, cells) => sum + (cells['*']?.n ?? 0), 0) }))
      .filter(o => o.exposures > 0);
    expect(holders.map(o => Math.round(o.exposures)),
      'W26.R2: the managed exposures of her two rendered heroes must land in two statistics objects, one per page, each prepared against and accepted by its own page\'s object (fan.ts:471-474; A16)')
      .toEqual([1, 1]);
    // The recovery record names the objects its effects went to, so her
    // erasure and the record's expiry clean them (`disposeOwnerRecovery`).
    const owner = m.shoppers.get(shopperObjectName(TENANT as TenantId, sarah.subject));
    const named = [...new Set([...(owner?.data ?? new Map<string, unknown>())]
      .filter(([key]) => key.startsWith('recoveryOperation:'))
      .flatMap(([, meta]) => (meta as { destinations?: string[] }).destinations ?? []))].sort();
    expect(named, 'W26.R2: every statistics object that holds one of her managed exposures must be named among her recovery records\' cleanup destinations, so her erasure reaches it (recovery.ts:204; A16)')
      .toEqual(expect.arrayContaining(holders.map(o => o.name)));
  });
});

// ===========================================================================
// unit:W26.R3 — the SDK sends data.brand
// ===========================================================================

/** The action bodies a test host received, by type. */
type Sent = { type: string; data: Record<string, unknown> };

describe('unit:W26.R3', () => {
  /**
   * docs/kit/03-payload-schemas.md:26-29: "`data.brand` is accepted on any of
   * these and is the brand the shopper's page was served under — the same value
   * the decision request carried… Send it wherever a tenant serves more than one
   * brand, or a click on brand A's hero lands in brand B's numerator while the
   * exposure stays in A's denominator." W26.C1.01 made the platform read it
   * (`outcomeFromAction`); LANE-LOG R198: "the SDK sending no `data.brand`". The
   * SDK already puts its configured brand on the decision request
   * (`src/sdk/listen.ts`, `brand: core.config.brand`); every reward-bearing
   * action it sends must carry the same value.
   */
  it('sdk: a client configured for the Coach brand of the Tapestry tenant sends data.brand coach on every reward-bearing action it emits — a content click, a dwell on the piece, a completed video, an add to bag, a wishlist add and a purchase — from the source entry and from the shipped bundle', async () => {
    const dom = new JSDOM(`<main><div id="hero" data-op-content="${TABBY}" data-op-slot="hero"></div></main>`, { url: 'https://shop.example/home' });
    const win = dom.window as unknown as { document: { getElementById(id: string): unknown }; close(): void };
    try {
      const bundle = read('public/sdk/edge-personalization.esm.js');
      const shipped = { exports: {} as Record<string, unknown> };
      runInNewContext(transformSync(bundle, { format: 'cjs' }).code + '\nmodule.exports;', {
        module: shipped, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, btoa, atob,
        setTimeout, clearTimeout, setInterval, clearInterval, crypto,
      });
      type Client = {
        core: { ready: () => Promise<boolean> };
        listen: { apply: (set: unknown) => unknown };
        emit: {
          rendered: (slot: string, contentId: string, el?: unknown) => Promise<unknown>;
          contentClick: (contentId: string, slot: string) => Promise<unknown>;
          contentDwell: (contentId: string, slot: string, ms: number) => Promise<unknown>;
          videoComplete: (contentId: string, slot: string) => Promise<unknown>;
          addToCart: (productId: string, attrs?: Record<string, unknown>) => Promise<unknown>;
          wishlistAdd: (productId: string, attrs?: Record<string, unknown>) => Promise<unknown>;
          purchase: (input: { orderId: string; value: number; currency?: string; items?: unknown[] }) => Promise<unknown>;
        };
      };
      // The source entry is the composition `createClient` performs
      // (`src/sdk/index.ts:32-35`: createCore, createListen, createEmit);
      // `src/sdk/index.ts` and `src/sdk/host.ts` are outside the app tsconfig
      // (they need the DOM lib), so the composition is repeated here, as
      // src/units/W17/L1.unit.test.ts does, and every module under test is the
      // product's own.
      const sourceClient = (config: unknown, host: unknown): Client => {
        const core = createCore(config as Parameters<typeof createCore>[0], host as Parameters<typeof createCore>[1]);
        const listen = createListen(core);
        return { core, listen, emit: createEmit(core, listen) } as unknown as Client;
      };
      const entries: Array<[string, (config: unknown, host: unknown) => Client]> = [
        ['source entry (src/sdk)', sourceClient],
        ['shipped bundle (public/sdk/edge-personalization.esm.js)', (shipped.exports as { createClient: (config: unknown, host: unknown) => Client }).createClient],
      ];
      for (const [label, createClient] of entries) {
        const f = testHost({ renderAcks: true });
        const client = createClient({ tenant: TENANT, brand: BRAND }, f.host);
        expect(await client.core.ready(), `${label}: the client is ready`).toBe(true);
        const set = offeredSet({ page: 'home', decisions: [{ contentId: TABBY, customerContentId: `cms-${TABBY}`, slot: 'hero', order: 0,
          type: 'video', strategy: 'affinity' as const, score: 1, explain: { drivers: [] } }] } as never, 'w26-ledger-page');
        client.listen.apply(set);
        await client.emit.rendered('hero', TABBY, win.document.getElementById('hero'));
        await client.emit.contentClick(TABBY, 'hero');
        // `content_dwell` is reward-bearing (`src/ledger/records.ts:203`, reward
        // `dwell`; kit 03:22 "the same, plus `ms`"), sent by the explicit API
        // (`src/sdk/emit.ts:362`) and by the declarative observer (`:223`)
        // through the same `track`.
        await client.emit.contentDwell(TABBY, 'hero', 4200);
        await client.emit.videoComplete(TABBY, 'hero');
        await client.emit.addToCart('CH-TABBY-26', { line: 'Tabby', category: 'Handbags', price_usd: 495 });
        await client.emit.wishlistAdd('CH-ROGUE-25', { line: 'Rogue', category: 'Handbags', price_usd: 695 });
        await client.emit.purchase({ orderId: 'w26-ledger-order', value: 495, currency: 'USD', items: [{ productId: 'CH-TABBY-26', quantity: 1, price: 495 }] });
        const sent = f.calls.filter(call => call.url.endsWith('/action')).map(call => JSON.parse(call.init!.body!) as Sent);
        // PRECONDITION: each reward-bearing action reached the wire at all.
        const rewarded = ['content_click', 'content_dwell', 'video_complete', 'add_to_cart', 'wishlist_add', 'purchase'];
        expect(rewarded.filter(type => !sent.some(e => e.type === type)), `${label}: PRECONDITION — every reward-bearing action was sent`).toEqual([]);
        // One comparison over every reward-bearing type, so a run names each type that lacks the brand.
        expect(Object.fromEntries(rewarded.map(type => [type, sent.filter(e => e.type === type).map(e => e.data.brand)])),
          `W26.R3: ${label} must send data.brand — the brand the page was served under, the one the decision request carried — on every reward-bearing action (kit 03:26; LANE-LOG R198)`)
          .toEqual(Object.fromEntries(rewarded.map(type => [type, [BRAND]])));
      }
    } finally { win.close(); }
  });
});

// ===========================================================================
// unit:W26.R4 — brandMismatched for uncorrelated outcomes, or the limit stated
// ===========================================================================

/** A sentence of the kit that states the correlated-only limit of `brandMismatched`. */
function statesUncorrelatedLimit(text: string): boolean {
  return text.replace(/\s+/g, ' ').split(/(?<=\.)\s+/).some(sentence => /brandMismatched/.test(sentence)
    && /(uncorrelated|names? no `?decisionId`?|without (a|any) `?decisionId`?|no decision reference|names? no decision)/i.test(sentence)
    && /\b(not|only|never)\b/i.test(sentence));
}

describe('unit:W26.R4', () => {
  /**
   * W26.C1.01 counts a CORRELATED outcome whose brand disagrees with the
   * decision it names (`brandMismatched` on the outcome receipt). LANE-LOG R198:
   * "`brandMismatched` counts the correlated case only"; the W26-B1 build review
   * residual: "`policy.ts:181,187` return 0; the uncorrelated path scopes by
   * brand" — an outcome naming no decision whose brand disagrees with the only
   * placement that could have earned it is dropped with nothing counted. The
   * frozen criterion admits two outcomes: the count, or the limit stated.
   * Exactly one must hold — a count the kit denies, or a kit that promises a
   * count the ring does not make, is the mismatch this criterion exists to end.
   */
  it('host: an outcome naming no decision whose brand disagrees with the placement it could credit is counted as brandMismatched on the outcome receipt, or the kit states that brandMismatched counts correlated outcomes only — and never both; a click under the placement\'s own brand and an other-brand click on a piece never served are never counted', async () => {
    const m = await mount();
    const now = Date.now() - 60_000;
    const served = record(m.env, { page: 'home', slot: 'hero', item_id: TABBY, ts: now });
    const appended = await m.env.DECISION_RING!.get(m.env.DECISION_RING!.idFromName(ringName(TENANT, 'v-w26-ledger')))
      .fetch('https://learn/append', { method: 'POST', body: JSON.stringify({ records: [served] }) });
    expect(appended.status, 'PRECONDITION: the visitor\'s ring holds the Coach decision').toBe(200);

    // The control: the same uncorrelated click under the decision's own brand is credited.
    const matched = click(m.env, { item_id: TABBY, slot: 'hero', ts: now + 1_000, brand: BRAND });
    const matchedReceipt = await fanOutcome(m.env, TENANT, matched, DEFAULT_POLICY, BRAND, SLOT_CONFIG, CLICK_CONFIG) as { outcome?: { attributed?: number; brandMismatched?: number } };
    expect(matchedReceipt, 'the uncorrelated click under the placement\'s own brand is credited').toMatchObject({ outcome: { attributed: 1 } });
    // CONTROL against over-counting: a click whose brand IS the placement's
    // disagrees with nothing, whatever the tenant's own id is.
    expect(matchedReceipt.outcome?.brandMismatched ?? 0,
      'W26.R4: the click under the placement\'s own brand is no brand mismatch — brandMismatched is 0 or absent on its receipt').toBe(0);

    // The case: an uncorrelated click whose brand is another brand of the tenant.
    const mismatched = click(m.env, { item_id: TABBY, slot: 'hero', ts: now + 2_000, brand: OTHER_BRAND,
      outcome_id: `${TENANT}:${ts36(now + 2_000)}:v-w26-ledger:content_click` });
    const receipt = await fanOutcome(m.env, TENANT, mismatched, DEFAULT_POLICY, OTHER_BRAND, SLOT_CONFIG, CLICK_CONFIG) as { outcome?: { attributed?: number; brandMismatched?: number } };
    expect(receipt.outcome?.attributed, 'LOCKED: the other brand\'s click credits nothing (`src/learn/policy.ts`)').toBe(0);

    // CONTROL against over-counting: an uncorrelated click of the other brand on
    // one of ITS pieces this visitor was never served disagrees with no
    // placement — there is none it could have credited — so it is no brand
    // mismatch either: neither "the brand is not the tenant" nor "an
    // uncorrelated outcome that earned no credit" is the count.
    const unserved = click(m.env, { item_id: OTHER_BRAND_PIECE, slot: 'hero', ts: now + 3_000, brand: OTHER_BRAND,
      outcome_id: `${TENANT}:${ts36(now + 3_000)}:v-w26-ledger:content_click` });
    const unservedReceipt = await fanOutcome(m.env, TENANT, unserved, DEFAULT_POLICY, OTHER_BRAND, SLOT_CONFIG, CLICK_CONFIG) as { outcome?: { attributed?: number; brandMismatched?: number } };
    expect(unservedReceipt.outcome?.attributed, 'LOCKED: a click on a piece never served credits nothing').toBe(0);
    expect(unservedReceipt.outcome?.brandMismatched ?? 0,
      'W26.R4: an other-brand click on a piece no placement served is no brand mismatch — brandMismatched is 0 or absent on its receipt').toBe(0);

    const counted = receipt.outcome?.brandMismatched === 1;
    const stated = statesUncorrelatedLimit(read('docs/kit/02-api-reference.md') + '\n' + read('docs/kit/03-payload-schemas.md'));
    expect(counted ? 'counted' : stated ? 'limit stated' : 'neither counted nor stated',
      'W26.R4: an uncorrelated outcome whose brand disagrees with the placement must be counted as brandMismatched on the outcome receipt, or the kit must state that brandMismatched counts correlated outcomes only (LANE-LOG R198)')
      .toMatch(/^(counted|limit stated)$/);
    expect(counted && stated ? 'the kit states a limit the receipt does not have' : 'consistent',
      'W26.R4: the kit and the receipt agree').toBe('consistent');
  });
});

// ===========================================================================
// unit:W26.R5 — the operator's lift table shows the correction column
// ===========================================================================

type El = { textContent: string | null; firstChild: { textContent: string | null } | null; querySelectorAll: (sel: string) => ArrayLike<El> };
type Browser = {
  document: { body: El; querySelectorAll: (sel: string) => ArrayLike<El>; getElementById: (id: string) => El | null };
  eval: (source: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  fetch?: unknown; Headers?: unknown; TextEncoder?: unknown; confirm?: unknown; setInterval?: unknown;
};

describe('unit:W26.R5', () => {
  /**
   * F21 §8: "report the lift table as a diagnostic that is not corrected for
   * position or placement". W26.X1.01 put `correction: 'uncorrected-v1'` on
   * every row `GET /v1/:tenant/lift/rows` answers and a `correction` column in
   * the CSV download; LANE-LOG R198: "the operator's on-screen lift table
   * without a `correction` column". The table is the operator console's "What
   * this slot has learned" view (`public/console/views.js`, the view that reads
   * `/lift/rows`), rendered here the way a browser renders it, against the real
   * routes of the mounted application.
   */
  it('console: the operator\'s "What this slot has learned" table, fed by the real lift rows route, has a correction column and every row states in it that the lift is corrected for neither position nor placement', async () => {
    const m = await mount();
    // A real published snapshot: one exposure of each piece through the real
    // fan, published by the slot's own statistics object. The console reads a
    // brand the stamp provisions (`GET /v1/:tenant/brands`); the tenant's own
    // brand is the one it opens on.
    const now = Date.now() - 60_000;
    expect(await fanDecisions(m.env, { tenant: TENANT, brand: TENANT, visitor_id: 'v-w26-ledger', records: [
      record(m.env, { page: 'home', slot: 'hero', item_id: TABBY, ts: now, brand: TENANT }),
      record(m.env, { page: 'home', slot: 'hero', item_id: ROGUE, ts: now + 1, position: 1, brand: TENANT }),
    ] }, slot => SLOT_CONFIG[slot]!)).toMatchObject({ ok: true });
    const published = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(statsName(TENANT, TENANT, 'hero'))).fetch('https://learn/publish', { method: 'POST' });
    expect(await published.json(), 'PRECONDITION: the slot has a published snapshot').toMatchObject({ ok: true, published: true });

    const dom = new JSDOM(read('public/console/index.html'), { url: `http://console.test/console/#/work?scope=${TENANT}`, pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window as unknown as Browser;
    try {
      // The console's requests go to the mounted application itself.
      w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
        m.fetch(new Request(new URL(url, 'http://console.test/'), { method: init?.method ?? 'GET', headers: init?.headers, ...(init?.body === undefined ? {} : { body: init.body }) }));
      w.Headers = Headers; w.TextEncoder = TextEncoder; w.confirm = () => true; w.setInterval = () => 0;
      w.localStorage.setItem('operator-session', JSON.stringify({ accessToken: m.operatorToken, refreshToken: 'w26-ledger-refresh',
        exp: Date.now() + 3_600_000, user: { name: 'Tapestry Operator' } }));
      for (const file of ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js', 'console/views-measure.js',
        'console/views-accounts.js', 'console/views-explore.js']) w.eval(read(`public/${file}`));
      const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 15)); };
      await settle();
      w.location.hash = `#/lift?scope=${TENANT}&slot=hero`;
      await settle(); await settle();

      const headings = Array.from(w.document.querySelectorAll('#view thead th')).map(th => (th.firstChild?.textContent ?? '').trim());
      const rows = Array.from(w.document.querySelectorAll('#view tbody tr'));
      // PRECONDITION: the table is the real one, with both pieces the route answered.
      expect(headings, `PRECONDITION: the lift table rendered (view text: ${(w.document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300)})`).toContain('Lift ↓');
      expect(rows.length, 'PRECONDITION: one row per piece the route answered').toBe(2);

      // RED: the correction column.
      const column = headings.findIndex(label => /correct/i.test(label));
      expect(column >= 0 ? 'shown' : `absent from ${JSON.stringify(headings)}`,
        'W26.R5: the operator\'s on-screen lift table must show the correction column (F21 §8; LANE-LOG R198)').toBe('shown');
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(td => (td.textContent ?? '').trim());
        expect(cells[column] ?? '',
          'W26.R5: every row states, in that column, what its lift does not correct for — the row\'s own `correction` (uncorrected-v1)')
          .toMatch(/uncorrected-v1|not corrected for position or placement/i);
      }
      // The console's own rendering property: no stray value on the screen.
      expect((w.document.querySelectorAll('#view')[0]?.textContent ?? '').match(/\b(undefined|NaN)\b/g) ?? [], 'no stray value is rendered').toEqual([]);
    } finally { w.close(); }
  });
});
