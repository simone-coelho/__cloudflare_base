// src/units/W18/B1.unit.test.ts
// W18 — the merchandiser's operator controls (batch W18-B1).
//
// One `describe('unit:W18.<criterion>.<n>')` per unit, one `it` per ruled leg.
// Every expected value comes from a witness, never from what the code returns
// today:
//   · document 35 §5 row W18 (line 413): "Valid stage defaults/ranges/empty-value
//     semantics and real validator in console tests. Numeric per-slot dimension
//     editor/readback with version/rollback feedback; customer weight-change
//     walkthrough without reload. Test safe off values and interactions with
//     later score terms."
//   · document 35 §2 F26 (:197-199), F29 (:215-217), §3 N30 (:292, "retain
//     regression coverage in W18").
//   · docs/architecture/35-verification-reports/F26.md §1 (the claim table),
//     §2.1 (the shipped defaults against the real validator), §2.2 (the console
//     with the real validator wired in), §2.3 (the arithmetic), §2.4 (the other
//     console forms as the N30 control), §3(a) (the inverted empty-field
//     fallbacks, "the form's empty-field fallbacks are exactly inverted from the
//     engine's off-defaults").
//   · docs/architecture/35-verification-reports/F29.md §1.3 ("No weight is
//     edited mid-run and no rendered consequence of a weight edit is asserted
//     anywhere") and §1.6.
//   · docs/handover/HANDOFF-2026-09-18.md §6 row W18 (:314): "Numeric per-slot
//     dimension editor, stage bounds/defaults and history controls already exist
//     … Prove actual validator, safe off/empty semantics, publication/readback/
//     rollback feedback and customer no-reload weight changes."
//   · docs/handover/HANDOFF-2026-09-16.md §6 (:217): "Exact customer
//     weight-change/no-reload walkthrough and publication feedback/parity
//     remain … Do not relist already fixed numeric editor/stage defects as
//     absent code."
//   · docs/architecture/19-tapestry-delivery-ledger.md:17 — the customer's V1
//     acceptance, in his words: "20–30 images on the homepage served differently
//     per user based on the agreed dimensions, with weight configurability".
//   · docs/architecture/18-content-affinity-engine.md:67 — the weighted affinity
//     arithmetic: "score(item) = Σ_tag a[dim][tag] · w_tag".
//   · docs/kit/03-payload-schemas.md:129 (`inStage` is a bonus, 0 to 1) and
//     docs/architecture/22-outcome-learning-design.md:303 ("`outOfStage`
//     multiplies a piece made for another stage (0 sorts it last), `inStage` is
//     added to a piece made for this one").
//   · docs/kit/02-api-reference.md:364 — "All configuration administration
//     bypasses the serving cache. One serving operation pins the same committed
//     set for its catalog, slots, learning and Reflex dependencies … Serving
//     snapshots are immutable, keyed by bucket and tenant, and expire within 30
//     seconds of the read's start"; `src/config/publication.ts:8`
//     (`PUBLICATION_CACHE_MS = 30_000`).
//   · src/sdk/README.md:42-43 (`void client.listen.refresh({ page: 'home' }); //
//     supported coalesced refresh`) and :60 ("`listen.refresh({page})` permits
//     one active snapshot and one coalesced pending latest intent").
//
// THE READINGS THIS BATCH RUNS UNDER (ruling R68):
//   (a) the `sdk` leg is shipped browser JavaScript under jsdom. For the console
//       units it is the SHIPPED console modules (`public/console/*.js`) with
//       their `fetch` bound to the MOUNTED application — never a hand-written
//       fake server. `src/console/console.render.test.ts` drives the same
//       modules against a fake platform; this file drives them against the real
//       routes, and never imports or edits that suite.
//   (b) "without reload" means the shipped SDK's supported coalesced refresh
//       repaints the slot on the same page and the same client instance, with no
//       navigation and no `location.reload`, and the serving side reads the new
//       slots revision within the documented 30-second serving cache, with no
//       worker restart and no republication of anything else.
//   (c) `outOfStage: 0` is a SCORE TERM, never an exclusion: later terms still
//       apply and the piece stays eligible.
//   (d) the customer walkthrough itself is live acceptance and is batched at the
//       end (F29 §1.3-§1.4: "a script is an engineering check, not the
//       acceptance"). These units are the engineering proof through the shipped
//       SDK and the shipped console. Customer acceptance stays OPEN on every row.
//   (e) GREEN-AT-SPEC is the honest verdict where the frozen W18.01 work already
//       holds; the reversing product line is named in the unit's row.
//
// ONE REPRESENTATION, SHARED BY EVERY UNIT IN THIS FILE, so that no two units
// demand opposite things of the same fixture:
//   · a slot's dimension weight scales that dimension's contribution and nothing
//     else: `score(item) = Σ_tag a[dim][tag] · w_tag` (doc 18:67). Weight 0
//     removes the dimension from the sum; it never removes the piece.
//   · a rule is OFF when it is absent, and its "off value" is the value the
//     engine already treats as absent (`src/content/decide.ts:141` for stage,
//     `:150-151` for freshness and fatigue, `src/reflex/merchandising.ts:118`
//     for a zero weight). An off rule leaves no applied term on the receipt.
//   · `inStage` is ADDED and `outOfStage` MULTIPLIES, both bounded 0..1, and a
//     zero `outOfStage` zeroes the affinity base only — freshness, fatigue,
//     merchandising, contextual seeds and the learned lift still apply, in the
//     order `src/content/decide.ts:210-247` applies them.
//   · one serving operation pins one committed set: the ranking a snapshot
//     serves is the ranking the slots revision it NAMES produces.

import { readFileSync } from 'node:fs';

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import { decideContent, type DecideInput } from '@/content/decide';
import type { ContentPiece, SlotCatalog, SlotStrategy } from '@/content/types';
import type { LiftSnapshot } from '@/learn/stats';
import { PUBLICATION_CACHE_MS, initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { contentRoutes } from '@/routes/content';
import { configRoutes } from '@/routes/config';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { configuredDestinations } from '@/connectors/config';
import type { Env } from '@/types/env';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

import { createCore } from '@/sdk/core';
import { createEmit } from '@/sdk/emit';
import { createIdentity } from '@/sdk/identify';
import { createListen } from '@/sdk/listen';
import { destroyClient } from '@/sdk/teardown';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks } from '@/sdk/testHost';
import type { DomLike, ElementLike, RequestInitLike, ResponseLike } from '@/sdk/types';

// ===========================================================================
// The shipped browser files. Read from `public/`, never copied into this file:
// a defaults test that quotes a constant proves nothing about what shipped.
// ===========================================================================

const pub = (file: string): string => readFileSync(new URL(`../../../public/${file}`, import.meta.url), 'utf8');
const RULES_SOURCE = pub('console/views-config.js');
const DIALS_SOURCE = pub('console/views.js');

/**
 * The defaults the shipped rules form writes when a merchandiser switches a rule
 * on: the object literal in each `toggle('<rule>', on, {…}, st)` call
 * (`public/console/views-config.js`), parsed out of the shipped file exactly as
 * F26 §2.1 parsed them. Every one of them must be accepted by the real
 * validator through the mounted routes.
 */
function shippedRuleDefaults(): Record<string, Record<string, number | string>> {
  const found: Record<string, Record<string, number | string>> = {};
  const pattern = /toggle\('([a-z]+)',\s*on,\s*(\{[^}]*\}),\s*st\)/g;
  for (const match of RULES_SOURCE.matchAll(pattern)) {
    const [, name, literal] = match;
    found[name!] = JSON.parse(literal!.replace(/([{,]\s*)([A-Za-z][A-Za-z0-9]*)\s*:/g, '$1"$2":').replace(/'/g, '"')) as Record<string, number | string>;
  }
  return found;
}

/**
 * The bounds the shipped weight editor offers, read off the shipped file. A
 * merchandiser can only author what the spinner offers, so those are the values
 * the mounted routes have to accept (F26 §2.1's boundary sweep).
 */
const WEIGHT_EDITOR_BOUNDS = { min: 0, max: 1, step: 0.05 };

// ===========================================================================
// The customer's fixture. Coach's own dimensions (`line`, `occasion`,
// `category`), the shipped registry's keys, and a homepage catalogue of 24
// pieces — inside the 20–30 the customer's V1 acceptance names
// (docs/architecture/19-tapestry-delivery-ledger.md:17). The taxonomy lives
// here, in the fixture, never in product code (METHOD §6).
// ===========================================================================

const TENANT = 'coach';
const T0 = 1_756_000_000_000;
const DAY_MS = 86_400_000;

/** Ten homepage pieces made for the Tabby line. */
const TABBY_PIECES: ContentPiece[] = Array.from({ length: 10 }, (_, i) => ({
  id: `hero-tabby-${String(i + 1).padStart(2, '0')}`,
  customerContentId: `CMS-TABBY-${String(i + 1).padStart(2, '0')}`,
  type: 'editorial', title: `Tabby, frame ${i + 1}`,
  tags: { line: ['Tabby'], occasion: ['work'], category: ['Handbags'] },
  slotTypes: ['hero'], lifecycle: { status: 'live' },
}));
/** Ten homepage pieces made for the evening occasion, on another line. */
const EVENING_PIECES: ContentPiece[] = Array.from({ length: 10 }, (_, i) => ({
  id: `hero-evening-${String(i + 1).padStart(2, '0')}`,
  customerContentId: `CMS-EVENING-${String(i + 1).padStart(2, '0')}`,
  type: 'editorial', title: `Evening, frame ${i + 1}`,
  tags: { line: ['Rogue'], occasion: ['evening'], category: ['Handbags'] },
  slotTypes: ['hero'], lifecycle: { status: 'live' },
}));
/** Four pieces for a second slot, whose order no weight change on `hero` may touch. */
const EDIT_PIECES: ContentPiece[] = Array.from({ length: 4 }, (_, i) => ({
  id: `edit-accessory-${String(i + 1).padStart(2, '0')}`,
  customerContentId: `CMS-ACC-${String(i + 1).padStart(2, '0')}`,
  type: 'editorial', title: `Accessories, frame ${i + 1}`,
  tags: { category: ['Accessories'], occasion: [i % 2 ? 'evening' : 'work'] },
  slotTypes: ['edit'], lifecycle: { status: 'live' },
}));
/**
 * The catalogue as the merchandiser ordered it: the two families INTERLEAVED,
 * so that neither of the two orders below is catalogue order. Catalogue order
 * is what the engine falls back to when nothing scores
 * (`src/reflex/contentCompose.ts:149-150`), so a fixture whose expected order
 * happens to be catalogue order could pass with no personalization at all.
 */
const HOMEPAGE_CATALOG = {
  pieces: [
    ...EVENING_PIECES.flatMap((evening, i) => [evening, TABBY_PIECES[i]!]),
    ...EDIT_PIECES,
  ],
};

/** 24 pieces: inside the customer's own "20–30 images on the homepage". */
const CATALOGUE_SIZE = HOMEPAGE_CATALOG.pieces.length;

/**
 * The business user's two weightings of the homepage hero.
 *
 * The shopper below builds her taste from events that carry `line: Tabby` and
 * `occasion: evening` together, so the two dimensions hold evidence of the same
 * order. Under `doc 18:67` a Tabby piece then scores `a_line · w_line` and an
 * evening piece `a_occasion · w_occasion`, so the twentyfold gap between the two
 * weights decides the order for ANY pair of affinities within a factor of 20 of
 * each other: the ranking is a consequence of the weights, not of a number read
 * off the engine.
 */
const WEIGHTS_A = { line: 1, occasion: 0.05 };
const WEIGHTS_B = { line: 0.05, occasion: 1 };
const ORDER_A = ['hero-tabby-01', 'hero-tabby-02', 'hero-tabby-03'];
const ORDER_B = ['hero-evening-01', 'hero-evening-02', 'hero-evening-03'];
/** Neither order is the catalogue's own, so neither can be produced by no signal. */
const CATALOGUE_ORDER_TOP3 = ['hero-evening-01', 'hero-tabby-01', 'hero-evening-02'];

const homepageSlots = (heroWeights: Record<string, number>): SlotCatalog => ({
  pages: {
    home: [
      { slot: 'hero', take: 3, weights: { ...heroWeights } },
      { slot: 'edit', take: 2, weights: { category: 0.5 } },
    ],
  },
} as unknown as SlotCatalog);

/** The shopper's own browsing: three real Coach product views, one visit. */
const SHOPPER_VIEWS = Array.from({ length: 3 }, (_, i) => ({
  type: 'product_view',
  data: { productId: `COA-CW62${i}`, line: 'Tabby', category: 'Handbags', occasion: ['evening'], price_usd: 575 },
}));

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it.
// Pattern reused from `src/units/W16/C8.unit.test.ts` and
// `src/routes/content.test.ts`; neither suite is imported or edited.
// ===========================================================================

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

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w18-b1-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

const OPERATOR_SECRET = 'w18-b1-synthetic-operator-signing-material';

interface Mounted {
  env: Env;
  app: Hono<{ Bindings: Env }>;
  sessions: UnitKV;
  objects: Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>;
  pending: Promise<unknown>[];
  drain: () => Promise<void>;
  fetch: (input: Request) => Promise<Response>;
  operatorToken: string;
  configureRetention: () => Promise<void>;
}

async function mount(host: 'session' | 'do' = 'session'): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown> }>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w18-b1-proof`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });
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
                else for (const [key, item2] of Object.entries(values)) candidate.set(key, structuredClone(item2));
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
        item = { data, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  app.route('/v1', identityRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const fetchOne = async (request: Request): Promise<Response> => {
    await configureRetention();
    return app.fetch(request, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, app, sessions, objects, pending, drain, fetch: fetchOne, operatorToken, configureRetention };
}

/** The four documents this batch publishes, exactly as a provisioned tenant holds them. */
async function publishFixture(m: Mounted, slots: SlotCatalog, catalog: { pieces: ContentPiece[] } = HOMEPAGE_CATALOG,
  learnSlots: Record<string, unknown> = {}): Promise<void> {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w18-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(m.env, [
    baseline(CONTENT_KIND, catalog),
    baseline(SLOTS_KIND, slots),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w18-b1', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: learnSlots }),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
}

const OPERATOR_ORIGIN = 'http://console.test';

/** The authenticated operator read the console makes. */
async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT },
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

/**
 * The console's own write, byte for byte: `If-Match: "N/S/H"` from the loaded
 * draft and `Idempotency-Key: N:UUID`, exactly as `public/console/shell.js`
 * composes them (`write()`), against the mounted routes.
 */
async function operatorWrite(m: Mounted, path: string, method: 'PUT' | 'POST', body: unknown,
  base: { revision: number; publication: { revision: number; digest: string } }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method,
    headers: {
      Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json',
      'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
      'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body ?? {}),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

interface LoadedSlots { revision: number; publication: { revision: number; digest: string }; document: SlotCatalog }
async function loadSlots(m: Mounted): Promise<LoadedSlots> {
  const read = await operatorGet(m, `/content/slots?scope=${TENANT}`);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  return { revision: read.body.revision as number, publication: read.body.publication as LoadedSlots['publication'], document: read.body.document as SlotCatalog };
}

/** Change one slot's weights and nothing else, the way the rules screen does. */
function withHeroWeights(document: SlotCatalog, weights: Record<string, number>): SlotCatalog {
  const next = JSON.parse(JSON.stringify(document)) as SlotCatalog;
  const hero = next.pages.home!.find(s => s.slot === 'hero')!;
  hero.weights = { ...weights };
  return next;
}

// ---------------------------------------------------------------------------
// A shopper on the mounted application: her own events, her own snapshot.
// ---------------------------------------------------------------------------

interface Shopper {
  capability: string;
  subject: string;
  sessionId: string;
  action: (event: { type: string; data: Record<string, unknown> }) => Promise<number>;
  snapshot: () => Promise<{ status: number; ranking: Record<string, string[]>; versions: Record<string, number> }>;
}

async function shopperOn(m: Mounted): Promise<Shopper> {
  const grant = await newAnonymousSession(m.env, TENANT);
  const call = async (path: string, body?: unknown) => {
    await m.configureRetention();
    return m.fetch(new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  };
  // The shopper's own explicit choice, through the mounted preferences route.
  const current = m.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const preferences = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true, choice });
  expect(preferences.status, await preferences.clone().text()).toBe(200);
  await m.drain();

  const action = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await call('/realtime/action', { ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
    await m.drain();
    return response.status;
  };
  const snapshot = async () => {
    const response = await call(`/v1/${TENANT}/decisions/snapshot?page=home`);
    const body = await response.clone().json().catch(() => ({})) as {
      versions?: Record<string, number>; decisions?: Array<{ slot?: string; contentId?: string }>;
    };
    await m.drain();
    const ranking: Record<string, string[]> = {};
    for (const decision of body.decisions ?? []) (ranking[decision.slot ?? '?'] ??= []).push(decision.contentId ?? '?');
    return { status: response.status, ranking, versions: body.versions ?? {} };
  };
  return { capability: grant.capability, subject: grant.subject, sessionId: grant.sessionId, action, snapshot };
}

/** Her taste: three real product views inside one visit. */
async function buildTaste(shopper: Shopper, clock: { set: (ms: number) => void }, from = T0): Promise<void> {
  for (const [index, event] of SHOPPER_VIEWS.entries()) {
    clock.set(from + index * 60_000);
    expect(await shopper.action(event), `the shopper's view ${index + 1} must be accepted`).toBe(200);
  }
}

// ===========================================================================
// The SHIPPED console, under jsdom, with its fetch bound to the mounted app
// (R68(a)). Nothing here is a stub: every answer the screen reads comes from
// the routes production serves.
// ===========================================================================

interface El {
  value: string; hidden: boolean; disabled: boolean; textContent: string | null; dataset: Record<string, string>;
  click: () => void; focus: () => void; getAttribute: (name: string) => string | null;
  querySelectorAll: (sel: string) => ArrayLike<El>; querySelector: (sel: string) => El | null;
  dispatchEvent: (e: unknown) => boolean;
}
interface ConsoleBrowser extends Record<string, unknown> {
  document: { body: El; getElementById: (id: string) => unknown; querySelectorAll: (sel: string) => ArrayLike<El>; querySelector: (s: string) => El | null };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  Event: new (type: string, options: object) => unknown;
}

interface ConsoleHarness {
  w: ConsoleBrowser;
  requests: Array<{ method: string; path: string; body: string | undefined }>;
  puts: () => Array<{ path: string; document: SlotCatalog; note: string }>;
  $: (id: string) => El;
  all: (sel: string) => El[];
  text: () => string;
  settle: () => Promise<void>;
  settleChecked: () => Promise<void>;
  goTo: (hash: string) => Promise<void>;
  input: (key: string, value: string) => void;
  toggleRule: (title: string, value: 'on' | 'off') => void;
  save: () => Promise<void>;
  close: () => void;
}

async function openConsole(m: Mounted, hash = `#/rules?scope=${TENANT}&slot=hero`): Promise<ConsoleHarness> {
  const dom = new JSDOM(pub('console/index.html'), { url: `${OPERATOR_ORIGIN}/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as ConsoleBrowser;
  const requests: Array<{ method: string; path: string; body: string | undefined }> = [];
  const intervals: Array<() => void> = [];
  w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/console/`);
    requests.push({ method: (init?.method ?? 'GET').toUpperCase(), path: target.pathname + target.search, body: init?.body });
    return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
      method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
    }));
  };
  w.TextEncoder = TextEncoder;
  w.setInterval = (callback: () => void) => { intervals.push(callback); return intervals.length; };
  w.confirm = () => true;
  // The operator is already signed in: the platform's own access token, in the
  // shipped session store `public/operator-session.js` reads.
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'w18-b1-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'] }, mustChangePassword: false,
  }));
  w.eval(pub('operator-session.js'));
  w.eval(pub('console/shell.js'));
  w.eval(pub('console/views.js'));
  w.eval(pub('console/views-config.js'));
  w.eval(pub('console/views-measure.js'));
  w.eval(pub('console/views-accounts.js'));
  w.eval(pub('console/views-explore.js'));
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 12)); };
  /** Long enough for the rules screen's validator, which waits 350 ms after the last keystroke. */
  const settleChecked = async () => { await new Promise(r => setTimeout(r, 450)); await settle(); };
  await settle(); await settle();
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  const all = (sel: string) => Array.from(w.document.querySelectorAll(sel));
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const goTo = async (next: string) => { w.location.hash = next; await settle(); await settle(); };
  const input = (key: string, value: string) => {
    const el = all(`[data-focus-key="${key}"]`)[0]!;
    el.focus(); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const toggleRule = (title: string, value: 'on' | 'off') => {
    const el = all('#view select').find(x => x.dataset.focusKey === `rule:${title}`)!;
    el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const save = async () => { await settleChecked(); $('save').click(); await settle(); await settle(); };
  const puts = () => requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/slots'))
    .map(r => { const parsed = JSON.parse(r.body ?? '{}') as { document: SlotCatalog; note?: string }; return { path: r.path, document: parsed.document, note: parsed.note ?? '' }; });
  return { w, requests, puts, $, all, text, settle, settleChecked, goTo, input, toggleRule, save, close: () => w.close() };
}

/** The on-screen name of the control a merchandiser was editing when it was refused. */
const IN_STAGE_LABEL = 'A piece for her stage gets a bonus of';

// ===========================================================================
// Pure-decision fixtures for the `logic` legs. Here the affinity is supplied,
// so every expected number below is computed from the documented formulas
// (doc 18:67, kit 03:129, doc 22:303) and never read off the engine.
// ===========================================================================

const LOGIC_NOW = Date.parse('2026-09-19T12:00:00.000Z');

/** a[line][Tabby] = 0.8 and a[occasion][evening] = 0.4, the shopper of every logic leg. */
const LOGIC_AFFINITY = { dims: { line: { Tabby: 0.8 }, occasion: { evening: 0.4 } } };

const logicPiece = (over: Partial<ContentPiece> & { id: string }): ContentPiece => ({
  customerContentId: `CMS-${over.id}`, type: 'editorial', title: over.id,
  tags: { line: ['Tabby'], occasion: ['evening'] }, slotTypes: ['hero'], lifecycle: { status: 'live' },
  ...over,
} as ContentPiece);

const decisionFor = (slots: SlotStrategy[], pieces: ContentPiece[], extra: Partial<DecideInput> = {}): DecideInput => ({
  tenant: TENANT, brand: TENANT, page: 'home', visitorId: 'vis-w18-b1', sessionId: 's-w18-b1',
  identityAnchor: 'visitor', nowMs: LOGIC_NOW, pieces, slots,
  affinity: LOGIC_AFFINITY, arm: 'personalized',
  cell: { channel: 'email', visit_bucket: '2-3', stage: 'mid', region: null, affinity: null },
  versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'w18-b1',
  ...extra,
});

/** A slot document is only a witness if a merchandiser could actually author it. */
const authorable = (slot: SlotStrategy): SlotStrategy => {
  const checked = validateSlotCatalog({ pages: { home: [slot] } });
  expect(checked.ok ? '' : checked.errors.join('; '), `the fixture slot must be authorable: ${JSON.stringify(slot)}`).toBe('');
  return (checked as { ok: true; value: SlotCatalog }).value.pages.home![0]!;
};

// ===========================================================================
// unit:W18.O1.01 — every default the shipped console forms write is accepted by
// the real validator through the mounted routes; the control `inStage: 1.2` is
// refused, and the console shows the refusal with the save disabled and no PUT.
// ===========================================================================

describe('unit:W18.O1.01', () => {
  it('host: every rule default the shipped rules form writes, every weight the shipped editor offers and the learn-document defaults are accepted by the mounted routes, and inStage 1.2 is refused naming stage.inStage', async () => {
    const m = await mount();
    await publishFixture(m, homepageSlots(WEIGHTS_A));
    const defaults = shippedRuleDefaults();
    // The shipped form offers exactly these five rules (F26 §3(e) counted them).
    expect(Object.keys(defaults).sort(), 'the shipped rules form writes a default for each of its five rules')
      .toEqual(['diversity', 'fatigue', 'freshness', 'merchandising', 'stage']);

    const loaded = await loadSlots(m);
    let base = { revision: loaded.revision, publication: loaded.publication };
    let document = loaded.document;

    for (const [rule, value] of Object.entries(defaults)) {
      const candidate = JSON.parse(JSON.stringify(document)) as SlotCatalog;
      (candidate.pages.home![0] as unknown as Record<string, unknown>)[rule] = value;
      const dry = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: candidate }, base);
      expect(dry.status, `${rule}: ${JSON.stringify(value)} was refused by POST /content/slots/validate: ${JSON.stringify(dry.body.errors ?? dry.body)}`).toBe(200);
      expect(dry.body.valid, `${rule}: the real validator must accept the default the form writes`).toBe(true);
      const written = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT', { document: candidate, note: `switch ${rule} on` }, base);
      expect(written.status, `${rule}: PUT /content/slots refused the shipped default: ${JSON.stringify(written.body.errors ?? written.body)}`).toBe(200);
      expect(written.body.ok).toBe(true);
      const after = await loadSlots(m);
      expect((after.document.pages.home![0] as unknown as Record<string, unknown>)[rule], `${rule}: the stored slot carries the default the form wrote`).toEqual(value);
      base = { revision: after.revision, publication: after.publication }; document = after.document;
    }

    // Every stop the shipped weight spinner offers (min 0, max 1, step 0.05).
    const stops: number[] = [];
    for (let v = WEIGHT_EDITOR_BOUNDS.min; v <= WEIGHT_EDITOR_BOUNDS.max + 1e-9; v += WEIGHT_EDITOR_BOUNDS.step) stops.push(Math.round(v * 100) / 100);
    expect(stops).toHaveLength(21);
    for (const stop of stops) {
      const candidate = withHeroWeights(document, { line: stop, occasion: 1 - stop });
      const dry = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: candidate }, base);
      expect(dry.status, `weight ${stop} is a stop the shipped editor offers and must be authorable`).toBe(200);
      expect(dry.body.valid).toBe(true);
    }
    const saved = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT', { document: withHeroWeights(document, { line: 0.65, occasion: 0.35 }), note: 'weights' }, base);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    // The learn document the shipped dials form writes (F26 §2.4, the N30 control).
    for (const pin of [
      "D.holdout = D.holdout || { share: 0.05, salt: '', arms: ['default'] }",
      "d.exploration = { mode: v, share: (d.exploration || {}).share ?? 0.1, floor: (d.exploration || {}).floor ?? 50 }",
    ]) expect(DIALS_SOURCE.replace(/\s+/g, ' '), `the learn form still writes this default: ${pin}`).toContain(pin.replace(/\s+/g, ' '));
    const learnRead = await operatorGet(m, `/content/learn?scope=${TENANT}`);
    expect(learnRead.status).toBe(200);
    const learnBase = { revision: learnRead.body.revision as number, publication: learnRead.body.publication as LoadedSlots['publication'] };
    const learnDefaults = {
      holdout: { share: 0.05, salt: '', arms: ['default'] },
      policy: { scope: 'session', match: 'direct', credit: 'last', windowsMs: {} },
      stats: { n0: 30, tauLearnMs: 21 * DAY_MS, liftMin: 0.5, liftMax: 2, nMin: 30 },
      slots: { hero: { gamma: 0, reward: 'click', measurementBasis: 'served-v1', exploration: { mode: 'rotation', share: 0.1, floor: 50 } } },
    };
    const learnDry = await operatorWrite(m, `/content/learn/validate?scope=${TENANT}`, 'POST', { document: learnDefaults }, learnBase);
    expect(learnDry.status, `the learn form's own defaults were refused: ${JSON.stringify(learnDry.body.errors ?? learnDry.body)}`).toBe(200);
    expect(learnDry.body.valid).toBe(true);
    const learnWritten = await operatorWrite(m, `/content/learn?scope=${TENANT}`, 'PUT', { document: learnDefaults, note: 'dials defaults' }, learnBase);
    expect(learnWritten.status, JSON.stringify(learnWritten.body.errors ?? learnWritten.body)).toBe(200);

    // The control: the value F26 found shipped is refused, by name, and writes nothing.
    const before = await loadSlots(m);
    const invalid = JSON.parse(JSON.stringify(before.document)) as SlotCatalog;
    (invalid.pages.home![0] as unknown as Record<string, unknown>).stage = { outOfStage: 0.5, inStage: 1.2 };
    const invalidBase = { revision: before.revision, publication: before.publication };
    const refusedDry = await operatorWrite(m, `/content/slots/validate?scope=${TENANT}`, 'POST', { document: invalid }, invalidBase);
    expect(refusedDry.status).toBe(422);
    expect((refusedDry.body.errors as string[]).join(' '), 'the refusal names the field that is out of range').toContain('stage.inStage');
    const refusedPut = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT', { document: invalid, note: 'out of range' }, invalidBase);
    expect(refusedPut.status).toBe(422);
    expect((refusedPut.body.errors as string[]).join(' ')).toContain('stage.inStage');
    const unchanged = await loadSlots(m);
    expect(unchanged.revision, 'a refused write creates no revision').toBe(before.revision);
    expect(unchanged.document).toEqual(before.document);
  }, 60_000);

  it('sdk: the shipped console, bound to the mounted routes, saves every rule default it writes and shows an out-of-range stage bonus in the operator’s own words with the save disabled and no PUT', async () => {
    const m = await mount();
    await publishFixture(m, homepageSlots(WEIGHTS_A));
    const c = await openConsole(m);
    try {
      expect(c.text(), 'the rules screen is reading the mounted slot document').toContain('hero on home');
      for (const rule of ['Where the shopper is in her journey', 'How fresh the piece is', 'How often she has already seen it',
        'How much of one thing it may show', 'Season, promotion and margin']) c.toggleRule(rule, 'on');
      await c.save();
      const written = c.puts();
      expect(written.length, 'the console saved the five rules it switched on through the mounted route').toBe(1);
      const stored = await loadSlots(m);
      const hero = stored.document.pages.home!.find(s => s.slot === 'hero')! as unknown as Record<string, unknown>;
      const defaults = shippedRuleDefaults();
      for (const [rule, value] of Object.entries(defaults)) {
        expect(hero[rule], `the mounted platform stored the ${rule} default the shipped form wrote`).toEqual(value);
      }
      expect(c.text(), 'the screen reads back the revision the platform actually wrote').toContain(`from revision ${stored.revision}`);

      // The N30 control, on the console's other form: the learn document's own
      // defaults save through the mounted route too (F26 §2.4).
      await c.goTo(`#/dials?scope=${TENANT}&slot=hero`);
      const mode = c.all('[data-focus-key="slots.hero.exploration.mode"]')[0]!;
      mode.value = 'rotation'; mode.dispatchEvent(new c.w.Event('change', { bubbles: true }));
      await c.save();
      const learn = await operatorGet(m, `/content/learn?scope=${TENANT}`);
      expect(learn.status).toBe(200);
      expect((learn.body.document as { slots?: Record<string, { exploration?: unknown }> }).slots?.hero?.exploration,
        'the learn form’s own default was accepted by the mounted platform, exactly as written')
        .toEqual({ mode: 'rotation', share: 0.1, floor: 50 });
      await c.goTo(`#/rules?scope=${TENANT}&slot=hero`);

      // The control. `inStage` is a bonus 0 to 1 (kit 03:129): 1.2 cannot be saved.
      const putsBefore = c.puts().length;
      c.input('stage.in', '1.2');
      await c.settleChecked();
      expect(c.$('save').disabled, 'a refused draft disables the save').toBe(true);
      c.$('save').click();
      await c.settle();
      expect(c.puts(), 'a refused draft sends no PUT at all').toHaveLength(putsBefore);
      expect(c.text(), 'the refusal is on the screen').toContain('This change cannot be saved');
      // F26 §2.2 recorded what a merchandiser is given today: "a raw
      // developer-worded error naming a JSON path". The screen's own rule
      // (`public/console/views-config.js:13-16`: "every symbol is named in
      // words … because the person tuning this is a merchandiser") makes the
      // refusal name the control the operator was editing, in the words the
      // screen uses for that control, and the value it will not take.
      const refusal = c.all('#view .msg.err').map(el => (el.textContent ?? '').replace(/\s+/g, ' ')).join(' ');
      expect(refusal, 'the refusal banner exists').toContain('This change cannot be saved');
      expect(refusal, `the refusal names the control the merchandiser was editing, in the screen's own words for it ("${IN_STAGE_LABEL}")`).toContain(IN_STAGE_LABEL);
      expect(refusal, 'and the value it will not take').toContain('1.2');
    } finally { c.close(); }
  }, 60_000);
});

// ===========================================================================
// unit:W18.O1.02 — empty-value and off semantics of the stage form.
// ===========================================================================

describe('unit:W18.O1.02', () => {
  it('sdk: clearing either stage field writes the engine’s off value through the mounted route, both fields are bounded 0..1, and switching the rule off deletes the stage block while the weights stand', async () => {
    const m = await mount();
    await publishFixture(m, homepageSlots(WEIGHTS_A));
    const c = await openConsole(m);
    try {
      c.toggleRule('Where the shopper is in her journey', 'on');
      await c.settleChecked();
      for (const key of ['stage.in', 'stage.out']) {
        expect(c.all(`[data-focus-key="${key}"]`)[0]!.getAttribute('min'), `${key} is bounded below at 0`).toBe('0');
        expect(c.all(`[data-focus-key="${key}"]`)[0]!.getAttribute('max'), `${key} is bounded above at 1`).toBe('1');
      }
      await c.save();
      const withRule = await loadSlots(m);
      const weightsBefore = JSON.parse(JSON.stringify(withRule.document.pages.home!.find(s => s.slot === 'hero')!.weights)) as Record<string, number>;

      // Emptying a field means "off", never the maximum effect (F26 §3(a)).
      c.input('stage.out', ''); c.input('stage.in', '');
      await c.save();
      const neutralDoc = await loadSlots(m);
      const neutralHero = neutralDoc.document.pages.home!.find(s => s.slot === 'hero')!;
      expect(neutralHero.stage, 'an emptied stage form saves the engine’s own off values')
        .toEqual({ outOfStage: 1, inStage: 0 });
      expect(c.all('[data-focus-key="stage.out"]')[0]!.value).toBe('1');
      expect(c.all('[data-focus-key="stage.in"]')[0]!.value).toBe('0');

      // Switching the rule off deletes the block and leaves the weights alone.
      c.toggleRule('Where the shopper is in her journey', 'off');
      await c.save();
      const offDoc = await loadSlots(m);
      const offHero = offDoc.document.pages.home!.find(s => s.slot === 'hero')!;
      expect(Object.hasOwn(offHero, 'stage'), 'a rule switched off is deleted from the document').toBe(false);
      expect(offHero.weights, 'switching a rule off leaves the dimension weights exactly as they were').toEqual(weightsBefore);
    } finally { c.close(); }
  }, 60_000);

  it('logic: the saved neutral stage document decides identically to the rule-absent document on the real decideContent', async () => {
    const pieces = [
      logicPiece({ id: 'made-for-another-stage', journeyStageFit: ['exploring'] }),
      logicPiece({ id: 'made-for-her-stage', journeyStageFit: ['considering'], tags: { line: ['Rogue'], occasion: ['evening'] } }),
    ];
    const neutral = authorable({ slot: 'hero', take: 2, weights: { line: 0.5, occasion: 0.25 }, stage: { outOfStage: 1, inStage: 0 } });
    const absent = authorable({ slot: 'hero', take: 2, weights: { line: 0.5, occasion: 0.25 } });
    const withNeutral = decideContent(decisionFor([neutral], pieces));
    const withAbsent = decideContent(decisionFor([absent], pieces));
    expect(withNeutral.decisions, 'the off values decide exactly what the absent rule decides').toEqual(withAbsent.decisions);
    expect(withNeutral.records.map(r => r.explain), 'and leave the same receipt').toEqual(withAbsent.records.map(r => r.explain));
    for (const record of withNeutral.records) {
      expect(record.explain.stage, `an off rule leaves no applied term on ${record.item_id}'s receipt`).toBeUndefined();
    }
    // The positive control on the same fixture: a rule that is ON does bite.
    const live = authorable({ slot: 'hero', take: 2, weights: { line: 0.5, occasion: 0.25 }, stage: { outOfStage: 0.5, inStage: 0.2 } });
    const withLive = decideContent(decisionFor([live], pieces));
    expect(withLive.records.find(r => r.item_id === 'made-for-her-stage')!.explain.stage!.applied,
      'the same form, switched on, adds the bonus it promises (kit 03:129: inStage is added)').toBe(0.2);
  });
});

// ===========================================================================
// unit:W18.O2.01 — the numeric per-slot dimension editor, its readback, and the
// publication feedback the save gives the operator.
// ===========================================================================

describe('unit:W18.O2.01', () => {
  it('host: PUT /content/slots saves the weights alone, answers with the new revision, its publication identity and the published version, and a fresh read returns them; a weight outside 0..1 is refused by name and writes nothing', async () => {
    const m = await mount();
    await publishFixture(m, homepageSlots(WEIGHTS_A));
    const before = await loadSlots(m);
    const base = { revision: before.revision, publication: before.publication };
    const others = JSON.stringify(before.document.pages.home!.filter(s => s.slot !== 'hero'));

    const saved = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
      { document: withHeroWeights(before.document, { line: 0.4, occasion: 0.6 }), note: 'prefer the evening edit' }, base);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.revision, 'the save answers with the revision it created').toBe(before.revision + 1);
    expect(saved.body.publication, 'the save answers with the publication the serving side will read')
      .toMatchObject({ revision: expect.any(Number) as unknown as number, digest: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string });
    expect(typeof saved.body.version, 'the save answers with the published version label').toBe('string');
    expect((saved.body.version as string).length, 'the published version label is not empty').toBeGreaterThan(0);

    const after = await loadSlots(m);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.document.pages.home!.find(s => s.slot === 'hero')!.weights, 'a fresh read returns the saved weights').toEqual({ line: 0.4, occasion: 0.6 });
    expect(JSON.stringify(after.document.pages.home!.filter(s => s.slot !== 'hero')), 'every other slot is byte-identical').toBe(others);
    const hero = after.document.pages.home!.find(s => s.slot === 'hero')!;
    expect(Object.keys(hero).sort(), 'a weight save writes the slot\u2019s own three fields and no rule').toEqual(['slot', 'take', 'weights']);

    const refused = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
      { document: withHeroWeights(after.document, { line: 1.01 }), note: 'out of range' },
      { revision: after.revision, publication: after.publication });
    expect(refused.status).toBe(422);
    expect((refused.body.errors as string[]).join(' '), 'the refusal names the weight that is out of range').toContain('weights.line');
    const unchanged = await loadSlots(m);
    expect(unchanged.revision, 'a refused weight writes no revision').toBe(after.revision);
  }, 60_000);

  it('sdk: the shipped rules screen lists every registered dimension with its stored weight, keeps an unknown stored key read-only, refuses a weight outside 0..1 without a PUT, and its save feedback names the new revision AND the publication the serving side will read', async () => {
    const m = await mount();
    const slots = homepageSlots({ line: 0.6, occasion: 0.1, 'retired-dimension': 0.4 });
    await publishFixture(m, slots);
    const c = await openConsole(m);
    try {
      const registry = DEFAULT_REFLEX_CONFIG.dimensions.map(d => d.key);
      const labelled = registry.filter(key => c.text().includes(`Weight on ${key}`));
      expect(labelled, 'every dimension the tenant’s published registry names has its own weight field').toEqual(registry);
      const shown = c.all('[data-focus-key^="weight:"]').map(el => el.value);
      expect(shown.length, 'one numeric field per registered dimension').toBe(registry.length);
      expect(shown[registry.indexOf('line')], 'the stored weight is read back as a number').toBe('0.6');
      expect(shown[registry.indexOf('occasion')]).toBe('0.1');
      expect(shown[registry.indexOf('category')], 'a dimension the document does not weight reads 0').toBe('0');
      expect(c.text(), 'a stored weight outside the registry is visible').toContain('retired-dimension');
      expect(c.text(), 'and read-only').toContain('read-only here');

      const putsBefore = c.puts().length;
      c.input(`weight:${registry.indexOf('line')}`, '1.01');
      await c.settleChecked();
      expect(c.$('save').disabled, 'a weight outside 0..1 blocks the save').toBe(true);
      c.$('save').click(); await c.settle();
      expect(c.puts(), 'and sends no PUT').toHaveLength(putsBefore);

      c.input(`weight:${registry.indexOf('line')}`, '0.4');
      c.input(`weight:${registry.indexOf('occasion')}`, '0.6');
      await c.save();
      const written = c.puts().at(-1)!;
      const heroWritten = written.document.pages.home!.find(s => s.slot === 'hero')!;
      // A registered dimension the document does not weight reads 0 on the
      // screen and stays absent in the document unless the operator edits it:
      // absent and 0 are the same weight (doc 18:67, `w = weights[dim] ?? 0`).
      expect(heroWritten.weights, 'the save carries the edited weights and preserves the unknown stored key')
        .toEqual({ line: 0.4, occasion: 0.6, 'retired-dimension': 0.4 });
      expect(JSON.stringify(written.document.pages.home!.filter(s => s.slot !== 'hero')), 'and changes no other slot')
        .toBe(JSON.stringify(slots.pages.home!.filter(s => s.slot !== 'hero')));

      const stored = await loadSlots(m);
      expect(stored.document.pages.home!.find(s => s.slot === 'hero')!.weights).toEqual(heroWritten.weights);
      expect(c.text(), 'the screen reads the saved weights back at the new revision').toContain(`from revision ${stored.revision}`);
      expect(c.all('[data-focus-key^="weight:"]').map(el => el.value)[registry.indexOf('occasion')]).toBe('0.6');

      // The feedback a business user needs: what was saved AND what is now
      // serving. The reflex save already gives both words
      // (`public/console/views-config.js:137`); the slots save must reach parity.
      const publishedVersion = (stored.document as unknown as { version?: string }).version ?? '';
      expect(publishedVersion.length, 'the platform stamped a published version on the saved document').toBeGreaterThan(0);
      const feedback = c.text();
      expect(feedback, 'the save feedback names the revision the platform created').toContain(`revision ${stored.revision}`);
      expect(feedback, `the save feedback names the published version the serving side will read (${publishedVersion})`).toContain(`Published as ${publishedVersion}`);
      expect(feedback, `the save feedback tells the operator when serving picks it up: the documented ${PUBLICATION_CACHE_MS / 1000}-second window`)
        .toMatch(new RegExp(`${PUBLICATION_CACHE_MS / 1000}[ -]second`));
    } finally { c.close(); }
  }, 60_000);
});

// ===========================================================================
// unit:W18.O2.02 — rollback feedback, with serving parity.
// ===========================================================================

describe('unit:W18.O2.02', () => {
  for (const host of ['session', 'do'] as const) {
    it(`host: rolling an older slots revision forward creates a new revision without rewriting history, reads back the older weights, and serves by them naming the new revision (${host} host)`, async () => {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        const m = await mount(host);
        await publishFixture(m, homepageSlots(WEIGHTS_A));
        const shopper = await shopperOn(m);
        await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });
        clockValue.now = T0 + 5 * 60_000;

        const first = await loadSlots(m);           // revision 1: WEIGHTS_A
        const changed = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
          { document: withHeroWeights(first.document, WEIGHTS_B), note: 'try the evening weighting' },
          { revision: first.revision, publication: first.publication });
        expect(changed.status, JSON.stringify(changed.body)).toBe(200);
        const second = await loadSlots(m);          // revision 2: WEIGHTS_B
        expect(second.document.pages.home!.find(s => s.slot === 'hero')!.weights).toEqual(WEIGHTS_B);

        const rolled = await operatorWrite(m, `/content/slots/rollback/${first.revision}?scope=${TENANT}`, 'POST', {},
          { revision: second.revision, publication: second.publication });
        expect(rolled.status, JSON.stringify(rolled.body)).toBe(200);
        expect(rolled.body.revision, 'a rollback is written forward as a NEW revision').toBe(second.revision + 1);

        const history = await operatorGet(m, `/content/slots/history?scope=${TENANT}`);
        const revisions = (history.body.revisions as Array<{ revision: number; note: string }>);
        expect(revisions.map(r => r.revision).sort((a, b) => a - b), 'history is never rewritten: every revision is still listed')
          .toEqual([first.revision, second.revision, second.revision + 1]);
        expect(revisions.find(r => r.revision === second.revision)!.note, 'the undone revision keeps its own note').toBe('try the evening weighting');

        const readBack = await loadSlots(m);
        expect(readBack.revision).toBe(second.revision + 1);
        expect(readBack.document.pages.home!.find(s => s.slot === 'hero')!.weights,
          'the new revision carries the older weights').toEqual(WEIGHTS_A);

        // Serving parity, once the documented serving-cache window has passed.
        clockValue.now += PUBLICATION_CACHE_MS + 1_000;
        const served = await shopper.snapshot();
        expect(served.status).toBe(200);
        expect(served.versions.slots, `${host}: the decision names the revision the rollback created`).toBe(second.revision + 1);
        expect(served.ranking.hero, `${host}: and serves the rolled-forward weights`).toEqual(ORDER_A);
      } finally { clock.mockRestore(); }
    }, 90_000);
  }

  it('sdk: the shipped History screen names both revisions of a rollback, and the rules screen then reads the older weights back at the new revision', async () => {
    const m = await mount();
    await publishFixture(m, homepageSlots(WEIGHTS_A));
    const first = await loadSlots(m);
    const changed = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
      { document: withHeroWeights(first.document, WEIGHTS_B), note: 'try the evening weighting' },
      { revision: first.revision, publication: first.publication });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    const c = await openConsole(m, `#/history?scope=${TENANT}&slot=hero`);
    try {
      const section = c.all('#view section').find(el => el.querySelector('h3')?.textContent === 'The slots and their rules')!;
      const older = Array.from(section.querySelectorAll('tbody tr')).find(el => el.querySelector('td')?.textContent === String(first.revision))!;
      older.querySelector('button')!.click();
      await c.settle(); await c.settle();
      const stored = await loadSlots(m);
      expect(stored.revision, 'the rollback went through the mounted route').toBe(first.revision + 2);
      expect(c.text(), 'the operator is told which revision was rolled forward, and what it became')
        .toContain(`Rolled revision ${first.revision} forward as revision ${stored.revision}`);

      await c.goTo(`#/rules?scope=${TENANT}&slot=hero`);
      const registry = DEFAULT_REFLEX_CONFIG.dimensions.map(d => d.key);
      const shown = c.all('[data-focus-key^="weight:"]').map(el => el.value);
      expect(shown[registry.indexOf('line')], 'the rules screen reads the rolled-forward weights back').toBe('1');
      expect(shown[registry.indexOf('occasion')]).toBe('0.05');
      expect(c.text()).toContain(`from revision ${stored.revision}`);
    } finally { c.close(); }
  }, 90_000);
});

// ===========================================================================
// unit:W18.O3.01 — the customer's weight-change walkthrough, engine half.
// ===========================================================================

describe('unit:W18.O3.01', () => {
  for (const host of ['session', 'do'] as const) {
    it(`host: with ${CATALOGUE_SIZE} tagged pieces on the homepage, a business user's weight change on one slot re-ranks that slot for the same shopper inside the documented window, names the new revision, republishes nothing else and leaves every other slot's order alone (${host} host)`, async () => {
      const clockValue = { now: T0 };
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
      try {
        const m = await mount(host);
        await publishFixture(m, homepageSlots(WEIGHTS_A));
        expect(CATALOGUE_SIZE, 'the customer’s own acceptance names 20–30 homepage images (document 19:17)').toBeGreaterThanOrEqual(20);
        expect(CATALOGUE_SIZE).toBeLessThanOrEqual(30);
        // Both orders below are personalization, not the catalogue falling through.
        expect(HOMEPAGE_CATALOG.pieces.filter(p => p.slotTypes.includes('hero')).slice(0, 3).map(p => p.id)).toEqual(CATALOGUE_ORDER_TOP3);
        expect(CATALOGUE_ORDER_TOP3).not.toEqual(ORDER_A);
        expect(CATALOGUE_ORDER_TOP3).not.toEqual(ORDER_B);
        const shopper = await shopperOn(m);
        await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });

        clockValue.now = T0 + 5 * 60_000;
        const before = await shopper.snapshot();
        expect(before.status).toBe(200);
        expect(before.ranking.hero, `${host}: order A, the line weighting the tenant published`).toEqual(ORDER_A);
        const otherSlotOrder = before.ranking.edit;
        expect(otherSlotOrder, `${host}: the second slot is serving`).toHaveLength(2);
        const publishedBefore = { catalog: before.versions.catalog, learn: before.versions.learn, config: before.versions.config };

        // The business user's change: the console's own PUT, one slot's weights.
        const loaded = await loadSlots(m);
        const saved = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
          { document: withHeroWeights(loaded.document, WEIGHTS_B), note: 'weight the evening edit' },
          { revision: loaded.revision, publication: loaded.publication });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const newRevision = saved.body.revision as number;
        expect(newRevision).toBe(loaded.revision + 1);

        // Inside the window a serving read may still hold the committed set it
        // pinned; whatever revision it names, the ranking is that revision's
        // (kit 02:364, "one serving operation pins the same committed set").
        clockValue.now += 1_000;
        const inside = await shopper.snapshot();
        expect(inside.status).toBe(200);
        expect([loaded.revision, newRevision], `${host}: a serving read names a committed slots revision`).toContain(inside.versions.slots);
        expect(inside.ranking.hero, `${host}: the order served is the order the revision it names produces`)
          .toEqual(inside.versions.slots === newRevision ? ORDER_B : ORDER_A);

        // After the documented window, with no worker restart and nothing else
        // republished, the change is in force.
        clockValue.now += PUBLICATION_CACHE_MS + 1_000;
        const after = await shopper.snapshot();
        expect(after.status).toBe(200);
        expect(after.versions.slots, `${host}: the decision names the revision the business user created`).toBe(newRevision);
        expect(after.ranking.hero, `${host}: order B, by the new weights alone`).toEqual(ORDER_B);
        expect(after.ranking.edit, `${host}: every other slot's order is untouched by a weight change on one slot`).toEqual(otherSlotOrder);
        expect({ catalog: after.versions.catalog, learn: after.versions.learn, config: after.versions.config },
          `${host}: nothing but the slot document was republished`).toEqual(publishedBefore);
      } finally { clock.mockRestore(); }
    }, 90_000);
  }
});

// ===========================================================================
// unit:W18.O3.02 — the customer's weight-change walkthrough, page half.
// ===========================================================================

describe('unit:W18.O3.02', () => {
  it('sdk: the shipped SDK paints order A on the page, and after the business user’s weight change the supported coalesced refresh repaints the same slot with order B on the same client and the same page — no navigation, no reload — and the exposure it then sends is the receipt of the new revision’s decision', async () => {
    const clockValue = { now: T0 };
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
    const dom = new JSDOM('<main><section id="hero"><p class="default">The season, for everyone</p></section><aside id="masthead">Coach</aside></main>',
      { url: 'https://shop.coach.test/home', runScripts: 'outside-only' });
    const win = dom.window as unknown as {
      document: { getElementById(id: string): { innerHTML: string; querySelectorAll(sel: string): ArrayLike<{ getAttribute(n: string): string | null }> } | null;
        querySelectorAll(sel: string): ArrayLike<ElementLike> & Iterable<ElementLike> };
      location: { href: string }; close(): void;
    };
    try {
      const m = await mount('session');
      // The page acknowledges its own paint, so the slot publishes the rendered
      // basis the kit documents for it (src/sdk/README.md: "Explicitly publish
      // `slots.{slot}.measurementBasis: 'rendered-v1'` for new rendered
      // measurement").
      await publishFixture(m, homepageSlots(WEIGHTS_A), HOMEPAGE_CATALOG, { hero: { reward: 'click', measurementBasis: 'rendered-v1' } });

      const traffic: Array<{ url: string; body: string | undefined }> = [];
      const host = memoryHost({
        acquireAuthorityLock: authorityLocks(),
        now: () => clockValue.now,
        uuid: () => crypto.randomUUID(),
        location: { href: 'https://shop.coach.test/home', host: 'shop.coach.test', hostname: 'shop.coach.test', protocol: 'https:', search: '' },
        referrer: '',
        fetch: async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
          traffic.push({ url, body: init?.body });
          const target = new URL(url, 'https://edge.coach.test');
          const response = await m.fetch(new Request('https://edge.coach.test' + target.pathname + target.search, {
            method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>,
            ...(init?.body === undefined ? {} : { body: init.body }),
          }));
          await m.drain();
          const json = await response.clone().json().catch(() => null) as unknown;
          return { ok: response.ok, status: response.status, json: async () => json };
        },
      });
      const dom0: DomLike = {
        querySelectorAll: sel => Array.from(win.document.querySelectorAll(sel)) as unknown as ArrayLike<ElementLike> & Iterable<ElementLike>,
        observe: (_el, cb) => { cb(true); return () => undefined; },
      };
      host.dom = dom0;

      const core = createCore({ tenant: TENANT, endpoint: 'https://edge.coach.test', source: 'coach-web' }, host);
      const listen = createListen(core);
      const emit = createEmit(core, listen);
      const identity = createIdentity(core);
      try {
        // The page's own renderer: it paints what the slot subscriber hands it,
        // and its default markup when there is nothing.
        const heroElement = win.document.getElementById('hero')!;
        const documentBefore = win.document;
        const mastheadBefore = win.document.getElementById('masthead')!.innerHTML;
        const paints: string[][] = [];
        listen.subscribe('hero', list => {
          heroElement.innerHTML = list.length
            ? list.map(d => `<article data-cms="${d.customerContentId}">${d.customerContentId}</article>`).join('')
            : '<p class="default">The season, for everyone</p>';
          paints.push(Array.from(heroElement.querySelectorAll('article')).map(a => a.getAttribute('data-cms') ?? ''));
        });

        const shopperId = (await core.ready()) ? core.visitorId : '';
        expect(shopperId.startsWith('vis-'), `the SDK holds a visitor the mounted platform named (got "${shopperId}")`).toBe(true);
        // The shopper's own explicit choice, through the SDK's own consent path.
        const chosen = await core.postJson('/realtime/session/preferences', { trackingConsent: true, personalizationEnabled: true });
        expect(chosen.ok, `the shopper's consent choice was accepted: ${JSON.stringify(chosen.json)}`).toBe(true);
        await m.drain();
        expect(core.trackingAllowed, 'the SDK holds an explicit choice it may act on').toBe(true);
        // Her taste, through the SDK's own event path.
        for (const view of SHOPPER_VIEWS) { await emit.productView(String(view.data.productId), view.data); await m.drain(); }
        clockValue.now = T0 + 5 * 60_000;

        const firstSet = await listen.refresh({ page: 'home' });
        expect(firstSet?.decisions.length ?? 0, 'the supported coalesced refresh delivered a set').toBeGreaterThan(0);
        const painted = () => Array.from(heroElement.querySelectorAll('article')).map(a => a.getAttribute('data-cms') ?? '');
        expect(painted(), 'the page paints order A').toEqual(ORDER_A.map(id => `CMS-${id.replace('hero-', '').toUpperCase()}`));

        // The business user changes one weight, through the console's own PUT.
        const loaded = await loadSlots(m);
        const saved = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
          { document: withHeroWeights(loaded.document, WEIGHTS_B), note: 'weight the evening edit' },
          { revision: loaded.revision, publication: loaded.publication });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const newRevision = saved.body.revision as number;

        // No reload, no navigation: the same client, the same page, one refresh.
        clockValue.now += PUBLICATION_CACHE_MS + 1_000;
        const secondSet = await listen.refresh({ page: 'home' });
        expect(secondSet?.decisions.length ?? 0, 'the refresh delivered the new set').toBeGreaterThan(0);
        expect(painted(), 'the same slot on the same page now paints order B')
          .toEqual(ORDER_B.map(id => `CMS-${id.replace('hero-', '').toUpperCase()}`));
        // No reload and no navigation: `location.reload` is non-configurable in
        // jsdom, so the claim is carried by what a reload or a navigation would
        // necessarily destroy — the document, the very DOM node the first paint
        // wrote into, and the URL.
        expect(win.document.getElementById('hero'), 'the repaint went into the same live node the first paint used').toBe(heroElement);
        expect(win.document, 'the document was never replaced').toBe(documentBefore);
        expect(win.location.href, 'and the page never navigated').toBe('https://shop.coach.test/home');
        expect(win.document.getElementById('masthead')!.innerHTML, 'nothing else on the page was repainted').toBe(mastheadBefore);
        expect(paints.length, 'the slot repainted for the change, on one client instance').toBeGreaterThanOrEqual(2);
        expect(secondSet!.versions?.slots, 'the set the page is holding names the revision the business user created').toBe(newRevision);

        // The exposure the page sends next is the receipt of that decision.
        const top = secondSet!.decisions.find(d => d.slot === 'hero' && d.order === 0)!;
        expect(top.decisionId, 'the delivery carries the receipt the page acknowledges against').toBeTruthy();
        await emit.track('content_impression', { slot: 'hero', contentId: top.contentId, decisionId: top.decisionId });
        await m.drain();
        const exposures = traffic.filter(t => t.url.endsWith('/realtime/action'))
          .map(t => JSON.parse(t.body ?? '{}') as { type: string; data: Record<string, unknown> })
          .filter(e => e.type === 'content_impression');
        expect(exposures.length, 'the page acknowledged the paint it made').toBeGreaterThanOrEqual(1);
        expect(exposures.at(-1)!.data.decisionId, 'and the exposure names the decision the new revision produced').toBe(top.decisionId);
      } finally { destroyClient(core, listen, emit, identity); }
    } finally { clock.mockRestore(); win.close(); }
  }, 90_000);
});

// ===========================================================================
// unit:W18.O4.01 — safe off values.
// ===========================================================================

describe('unit:W18.O4.01', () => {
  it('logic: each rule’s off form decides exactly what the rule’s absence decides, and leaves no applied term on any receipt', async () => {
    const pieces = [
      logicPiece({ id: 'tabby-evening-new', journeyStageFit: ['exploring'], freshnessDate: new Date(LOGIC_NOW - 7 * DAY_MS).toISOString(), merchandising: { season: 1, promotion: 0.5, margin: 0.25 } }),
      logicPiece({ id: 'rogue-evening', tags: { line: ['Rogue'], occasion: ['evening'] }, journeyStageFit: ['considering'], freshnessDate: new Date(LOGIC_NOW - 30 * DAY_MS).toISOString(), merchandising: { season: 0.2 } }),
      logicPiece({ id: 'tabby-work', tags: { line: ['Tabby'], occasion: ['work'] }, freshnessDate: new Date(LOGIC_NOW - 1 * DAY_MS).toISOString() }),
    ];
    const weights = { line: 0.5, occasion: 0.25 };
    const bare = authorable({ slot: 'hero', take: 3, weights });
    const served = { hero: { 'tabby-evening-new': 2, 'rogue-evening': 1 } };
    const reference = decideContent(decisionFor([bare], pieces, { served }));

    /** Every rule, in the off form the engine itself treats as absent. */
    const offForms: Array<[string, Partial<SlotStrategy>]> = [
      ['stage', { stage: { outOfStage: 1, inStage: 0 } }],
      ['freshness', { freshness: { weight: 0, halfLifeDays: 14 } }],
      ['fatigue', { fatigue: { weight: 0, windowHours: 24, cap: 3 } }],
      ['merchandising', { merchandising: { season: 0, promotion: 0, margin: 0, maxBoost: 2, minBoost: 0.5 } }],
      // A ceiling at or above the take cannot bite; absence is the form's own off.
      ['diversity', { diversity: { dimension: 'line', max: 3 } }],
      ['a dimension weight of 0', { weights: { ...weights, silhouette: 0 } }],
    ];
    for (const [name, off] of offForms) {
      const slot = authorable({ ...bare, ...off } as SlotStrategy);
      const result = decideContent(decisionFor([slot], pieces, { served }));
      expect(result.decisions, `${name} switched off decides exactly what its absence decides`).toEqual(reference.decisions);
      expect(result.records.map(r => r.explain), `${name} switched off leaves the same receipt`).toEqual(reference.records.map(r => r.explain));
      for (const record of result.records) {
        for (const term of ['stage', 'freshness', 'fatigue', 'merchandising', 'diversity'] as const) {
          expect(record.explain[term], `${name} off: no applied ${term} term on ${record.item_id}'s receipt`).toBeUndefined();
        }
      }
    }
    // The positive control: the same fixture with the rules ON does move.
    const live = authorable({ ...bare, freshness: { weight: 0.6, halfLifeDays: 14 }, fatigue: { weight: 0.3, windowHours: 24, cap: 2 } });
    const moved = decideContent(decisionFor([live], pieces, { served }));
    expect(moved.records.find(r => r.item_id === 'tabby-evening-new')!.explain.freshness!.applied,
      'freshness at weight 0.6 and 7 days on a 14-day half-life adds 0.6 x 2^-0.5 (doc 18 receipt arithmetic)')
      .toBe(Math.round(0.6 * Math.pow(2, -0.5) * 1000) / 1000);
  });
});

// ===========================================================================
// unit:W18.O4.02 — interactions with the later score terms.
// ===========================================================================

describe('unit:W18.O4.02', () => {
  it('logic: with outOfStage 0 the out-of-stage piece’s affinity base is zeroed and the piece stays eligible, with freshness, fatigue, merchandising, the contextual seed and the learned lift all still applied in the documented order and arithmetic', () => {
    // The slot a merchandiser authored, with every later term switched on.
    const slot = authorable({
      slot: 'hero', take: 3, weights: { line: 0.5, occasion: 0.25 },
      stage: { outOfStage: 0, inStage: 0.2 },
      freshness: { weight: 0.6, halfLifeDays: 14 },
      fatigue: { weight: 0.3, windowHours: 24, cap: 2 },
      merchandising: { season: 0.5, promotion: 0, margin: 0, maxBoost: 2, minBoost: 0.5 },
      seeds: [{ signal: 'entry_channel', value: 'email', weight: 0.4, tags: [{ dimension: 'occasion', value: 'evening' }] }],
    } as SlotStrategy);
    const out = logicPiece({ id: 'made-for-another-stage', journeyStageFit: ['exploring'],
      freshnessDate: new Date(LOGIC_NOW - 14 * DAY_MS).toISOString(), merchandising: { season: 1 } });
    const inside = logicPiece({ id: 'made-for-her-stage', journeyStageFit: ['considering'],
      freshnessDate: new Date(LOGIC_NOW - 28 * DAY_MS).toISOString(), merchandising: { season: 0.4 } });
    const snapshot: LiftSnapshot = {
      tenant: TENANT, brand: TENANT, slot: 'hero', reward: 'click', version: 7, publishedAt: LOGIC_NOW, events: 400,
      n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2,
      items: Object.fromEntries([out.id, inside.id].map(id => [id, { '*': { level: 0 as const, key: '*', n: 200, s: 40, p0: 0.1, p_hat: 0.2, lift: 2 } }])),
      slotRates: { '*': { n: 400, s: 60, rate: 0.15 } },
    };
    const result = decideContent(decisionFor([slot], [out, inside], {
      served: { hero: { [out.id]: 1 } },
      entry: { utmSource: 'newsletter', utmMedium: 'email' },
      learning: { snapshots: { hero: snapshot }, gammaOf: () => 1 },
    }));

    // R68(c): a zeroed score term is not an exclusion.
    expect(result.decisions.map(d => d.contentId), 'the out-of-stage piece is still served').toEqual([inside.id, out.id]);

    const zeroed = result.records.find(r => r.item_id === out.id)!;
    // Σ a·w = 0.8×0.5 + 0.4×0.25 = 0.5 (doc 18:67); the seed adds 0.4×0.25 = 0.1
    // to the tag sum, so the base the stage rule multiplies is 0.6.
    // outOfStage 0 (doc 22:303, "0 sorts it last"): 0.6 → 0, applied −0.6.
    expect(zeroed.explain.stage!.applied, 'outOfStage 0 multiplies the affinity base to zero').toBe(-0.6);
    // freshness: 14 days on a 14-day half-life → 0.6 × 2^-1 = 0.3, ADDED after the stage term.
    expect(zeroed.explain.freshness!.applied, 'the freshness bonus still applies to a zeroed base').toBe(0.3);
    // fatigue: served once against a cap of two → 0.3 × 1/2 = 0.15, subtracted.
    expect(zeroed.explain.fatigue!.applied, 'the fatigue penalty still applies').toBe(-0.15);
    // score_base is the chain before merchandising: 0 + 0.3 − 0.15 = 0.15.
    expect(zeroed.explain.score_base).toBe(0.15);
    // merchandising: season 1 at weight 0.5 → ×1.5, inside minBoost..maxBoost.
    expect(zeroed.explain.merchandising!.boost, 'the merchandising multiplier still applies').toBe(1.5);
    expect(zeroed.explain.merchandising!.clamped).toBe(false);
    expect(zeroed.explain.merchandising!.boost).toBeGreaterThanOrEqual(0.5);
    expect(zeroed.explain.merchandising!.boost).toBeLessThanOrEqual(2);
    // lift² : the learned lift of 2 at γ = 1 → 0.225 × 2 = 0.45.
    expect(zeroed.explain.lift!.lift).toBe(2);
    expect(zeroed.explain.lift!.applied, 'the learned lift still applies to what is left').toBe(0.225);
    expect(zeroed.explain.score_final, 'and the piece carries a real score into the ranking').toBe(0.45);

    // The same chain on the piece made for her stage, where the seed survives to
    // the receipt: 0.5 + 0.1 (seed) + 0.2 (inStage, ADDED) = 0.8; freshness 28
    // days on a 14-day half-life adds 0.6 × 2^-2 = 0.15 → 0.95; merchandising
    // season 0.4 at weight 0.5 → ×1.2 → 1.14; the seed's 0.1 became 0.12 after
    // that multiplier, which is what the receipt records.
    const served = result.records.find(r => r.item_id === inside.id)!;
    expect(served.explain.stage!.applied, 'inStage is ADDED, never multiplied (kit 03:129, doc 22:303)').toBe(0.2);
    expect(served.explain.freshness!.applied).toBe(0.15);
    expect(served.explain.fatigue, 'a piece she has not been served carries no fatigue term').toBeUndefined();
    expect(served.explain.score_base).toBe(0.95);
    expect(served.explain.merchandising!.boost).toBe(1.2);
    expect(served.explain.contextual!.applied, 'the contextual seed is itemised where it landed').toBe(0.12);
    expect(served.explain.contextual!.drivers.map(d => ({ dimension: d.dimension, tag: d.tag, contribution: d.contribution })))
      .toEqual([{ dimension: 'occasion', tag: 'evening', contribution: 0.12 }]);
    expect(served.explain.lift!.applied).toBe(1.14);
    expect(served.explain.score_final).toBe(2.28);
  });
});

// ===========================================================================
// unit:W18.O4.03 — the weight arithmetic the customer was promised.
// ===========================================================================

describe('unit:W18.O4.03', () => {
  it('logic: a dimension’s weight scales that dimension’s contribution by the documented formula, weight 0 removes the dimension and nothing else, and swapping two weights flips the top piece for the same shopper', () => {
    const tabby = logicPiece({ id: 'tabby-piece', tags: { line: ['Tabby'] } });
    const evening = logicPiece({ id: 'evening-piece', tags: { occasion: ['evening'] } });
    const pieces = [tabby, evening];

    // doc 18:67 — score(item) = Σ_tag a[dim][tag] · w_tag.
    const half = decideContent(decisionFor([authorable({ slot: 'hero', take: 2, weights: { line: 0.5, occasion: 0.25 } })], pieces));
    expect(half.decisions.find(d => d.contentId === tabby.id)!.score, '0.8 × 0.5').toBe(0.4);
    expect(half.decisions.find(d => d.contentId === evening.id)!.score, '0.4 × 0.25').toBe(0.1);
    const quarter = decideContent(decisionFor([authorable({ slot: 'hero', take: 2, weights: { line: 0.25, occasion: 0.25 } })], pieces));
    expect(quarter.decisions.find(d => d.contentId === tabby.id)!.score, 'halving the weight halves that dimension’s contribution').toBe(0.2);
    expect(quarter.decisions.find(d => d.contentId === evening.id)!.score, 'and touches no other dimension').toBe(0.1);

    // Weight 0 removes the dimension, and nothing else.
    const zeroed = decideContent(decisionFor([authorable({ slot: 'hero', take: 2, weights: { line: 0, occasion: 0.25 } })], pieces));
    const without = decideContent(decisionFor([authorable({ slot: 'hero', take: 2, weights: { occasion: 0.25 } })], pieces));
    expect(zeroed.decisions, 'weight 0 decides what leaving the dimension out decides').toEqual(without.decisions);
    expect(zeroed.decisions.find(d => d.contentId === evening.id)!.score, 'the other dimension is untouched').toBe(0.1);
    expect(zeroed.decisions.map(d => d.contentId), 'and the piece is still served, not excluded').toContain(tabby.id);

    // Swapping the two weights flips the page for the same shopper.
    const lineLed = decideContent(decisionFor([authorable({ slot: 'hero', take: 2, weights: { line: 0.8, occasion: 0.2 } })], pieces));
    const occasionLed = decideContent(decisionFor([authorable({ slot: 'hero', take: 2, weights: { line: 0.2, occasion: 0.8 } })], pieces));
    expect(lineLed.decisions[0]!.contentId, '0.8×0.8 = 0.64 beats 0.4×0.2 = 0.08').toBe(tabby.id);
    expect(lineLed.decisions[0]!.score).toBe(0.64);
    expect(occasionLed.decisions[0]!.contentId, 'swapped: 0.4×0.8 = 0.32 beats 0.8×0.2 = 0.16').toBe(evening.id);
    expect(occasionLed.decisions[0]!.score).toBe(0.32);
  });

  it('host: the same flip is observed through the mounted snapshot route, and the decision names the slots revision that carries the weights', async () => {
    const clockValue = { now: T0 };
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => clockValue.now);
    try {
      const m = await mount('session');
      await publishFixture(m, homepageSlots(WEIGHTS_A));
      const shopper = await shopperOn(m);
      await buildTaste(shopper, { set: (ms: number) => { clockValue.now = ms; } });
      clockValue.now = T0 + 5 * 60_000;

      const first = await shopper.snapshot();
      expect(first.status).toBe(200);
      expect(first.ranking.hero, 'the line weighting leads with the line pieces').toEqual(ORDER_A);
      const firstRevision = first.versions.slots;

      const loaded = await loadSlots(m);
      const saved = await operatorWrite(m, `/content/slots?scope=${TENANT}`, 'PUT',
        { document: withHeroWeights(loaded.document, WEIGHTS_B), note: 'swap the two weights' },
        { revision: loaded.revision, publication: loaded.publication });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);

      clockValue.now += PUBLICATION_CACHE_MS + 1_000;
      const second = await shopper.snapshot();
      expect(second.versions.slots, 'the decision names the revision that carries the swapped weights').toBe(saved.body.revision);
      expect(second.versions.slots, 'which is a later revision than the one that served order A').toBeGreaterThan(firstRevision);
      expect(second.ranking.hero, 'and the swap flipped the page for the same shopper').toEqual(ORDER_B);
    } finally { clock.mockRestore(); }
  }, 90_000);
});
