// src/units/W16/C8.unit.test.ts
// W16 criterion C8 — behavioral scenarios on Coach's own Handbags, Small
// Leather Goods and Accessories taxonomy, with real event shapes, unknown and
// cross-category inputs, sparse first/third interactions, new-visit and
// post-purchase restart, and the day-7 / day-14 return.
//
// One `describe('unit:W16.C8.0N')` per unit of batch W16-B7 (units .02–.07;
// W16.C8.01 is declared by W16-B4 and is NOT redeclared here), one `it` per
// ruled leg. Every expected value comes from a witness, never from what the
// engine returns today:
//   · HANDOFF-2026-09-18 §5 point 8 (criterion C8): "actual Coach Handbags/Small
//     Leather Goods/Accessories taxonomy and real event shapes, unknown/cross-
//     category inputs, first/third sparse interactions, new visit/purchase
//     reset, day7/day14 return/restart without renewal. Test behavior, not
//     merely stored fields."
//   · HANDOFF §12: "Unknown input remains unknown; no invented direct entry or
//     first visit"; "Keep durable preference separate from visit-local journey.
//     Purchase attribution happens before the next-decision reset";
//     "Browsing/renewal cannot extend original lifetime or consent."
//   · document 35 §5 W16·G2: "journey/new-visit/post-purchase reset, days/weeks
//     memory and contextual cold-start behavior. Tests use actual customer
//     taxonomy/events and unknown cases, not just fields present in a record";
//     §2 F13 ("cross-category taste", "sparse signals", "days/weeks memory").
//   · docs/architecture/tapestry_requirements.txt line 147 (Time to Relevance:
//     "3 clicks—site adapts third interaction onwards"), line 148 (Journey
//     Awareness: exploring → thinking → deciding), line 150 (Style
//     Understanding: "Aesthetic-based … across all categories"), line 152
//     (Return Visit Recognition: "Picks up where you left off").
//   · docs/kit/03-payload-schemas.md line 19-20: the real wire shapes —
//     `product_view` carries `productId` plus `line`, `category`, `subcategory`,
//     `silhouette`, `occasion` (a list) and `price_usd`; `purchase` carries
//     `orderId`, `value`, `currency` and `items[]`.
//   · Rulings R19 (host legs drive the mounted routes), R20, R29/R32 (the shared
//     journey vocabulary and the `journey` block on the published reflex
//     document), R32(4) (a published 14-day reflex `tauMs` is accepted as
//     customer-neutral published data), R34 (the anonymous return after days is
//     C6's continuity gap, so C8 measures the reachable return path).
//
// EVERY unit asserts the RANKING the decision returns through the mounted route
// production serves (R19: `GET /v1/:tenant/decisions/snapshot`), never a stored
// field alone. The host legs drive the real mounted app and the real
// ShopperReflex class in process on BOTH hosts, in the pattern of
// `src/units/W16/C2.unit.test.ts` and `src/routes/realtime.sdkContract.test.ts`;
// those suites are never imported and never edited.
//
// ONE CONSISTENT RULE ACROSS THESE SIX UNITS (so no two of them demand opposite
// representations of the same fixture):
//   (a) A shopper's ESTABLISHED cumulative taste always ranks — across a visit
//       boundary (C8.05), across a purchase (C8.06) and across days (C8.07);
//       that is the return-memory promise of tapestry line 152.
//   (b) A COLD shopper's newly forming taste does not re-rank the page on its
//       first sparse signal: absent a published contextual seed rule (C3), the
//       first view leaves the served order exactly as the catalogue lists it,
//       and the visit's THIRD interaction is where the site adapts (C8.04,
//       tapestry line 147).
//   (c) The journey stage is visit-local and restarts on a new visit and after a
//       purchase's attribution is captured, while (a) is untouched.
//   (d) Input the engine cannot place creates no taste on the dimensions the
//       page ranks on, is diagnosed, and leaves the base order standing (C8.03).
//
// RULED MISSING MEMBER (R21), asserted by the name this specification rules and
// RED until it exists:
//   the answer to `POST /realtime/action` carries `signals`
//   `{ recognized: boolean; unrecognized: string[] }` — the diagnostic that
//   names an input the engine could not place (unit W16.C8.03). No public
//   observable reports an unrecognized input today; `pinDiagnostics`,
//   `catalogDiagnostics` and `slotDiagnostics` are the repository's idiom for
//   the same honesty on the authoring side.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { VISIT_GAP_MS } from '@/services/visit';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import {
  issueSessionCapability, newAnonymousSession, verifySessionCapability, SHOPPER_HEADER,
} from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ---------------------------------------------------------------------------
// Customer-shaped fixtures. Every product below is a row of Coach's own
// catalogue (`src/data/coach-catalog.json`), quoted verbatim — id, line,
// category, subcategory, silhouette, occasion and price — because C8 is
// measured on the actual taxonomy, not on placeholder strings. The taxonomy
// lives here, in the fixture, never in product code (METHOD §6).
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const T0 = 1_725_000_000_000;
/** One interaction apart, well inside the visit (VISIT_GAP_MS = 30 min). */
const STEP_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Coach storefront's real product-view shape (docs/kit/03-payload-schemas.md:19). */
const productView = (data: Record<string, unknown>) => ({ type: 'product_view', data });

/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting · Handbags. */
const VIEW_TABBY_QUILTED_HANDBAG = productView({
  productId: 'COA-CW620', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['evening', 'date-night', 'special-occasion'], price_usd: 575,
});
/** COA-CB925 · Tabby Wallet With Chain · Small Leather Goods — the cross-category view. */
const VIEW_TABBY_CHAIN_WALLET_SLG = productView({
  productId: 'COA-CB925', line: 'Tabby', category: 'Small Leather Goods', subcategory: 'Wallets',
  silhouette: 'chain wallet', occasion: ['evening', 'date-night', 'everyday'], price_usd: 250,
});
/** COA-CCD82 · Essential Small Zip Around Wallet With Charms · Small Leather Goods. */
const VIEW_ESSENTIAL_ZIP_WALLET_SLG = productView({
  productId: 'COA-CCD82', line: 'Essential', category: 'Small Leather Goods', subcategory: 'Wallets',
  silhouette: 'zip-around wallet', occasion: ['everyday', 'evening'], price_usd: 195,
});
/** COA-CH857 · Tabby Shoulder Bag 26 · Handbags. */
const VIEW_TABBY_SHOULDER_26_HANDBAG = productView({
  productId: 'COA-CH857', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['work', 'everyday', 'evening'], price_usd: 475,
});
/** COA-CY201 · Tabby Shoulder Bag 20 · Handbags. */
const VIEW_TABBY_SHOULDER_20_HANDBAG = productView({
  productId: 'COA-CY201', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['everyday', 'evening', 'date-night'], price_usd: 375,
});

/**
 * Three interactions of one visit across TWO categories: a Handbag and two
 * Small Leather Goods. The aesthetic they share — `evening` and `date-night` —
 * is the taste tapestry line 150 says must work "across all categories"; the
 * three categories themselves are Coach's own (`src/services/CatalogIntent.ts`).
 */
const CROSS_CATEGORY_VISIT = [
  VIEW_TABBY_QUILTED_HANDBAG,
  VIEW_TABBY_CHAIN_WALLET_SLG,
  VIEW_ESSENTIAL_ZIP_WALLET_SLG,
];

/** Three views of one line, so the shopper has one unambiguous leading interest. */
const THREE_TABBY_VIEWS = [
  VIEW_TABBY_QUILTED_HANDBAG,
  VIEW_TABBY_SHOULDER_26_HANDBAG,
  VIEW_TABBY_SHOULDER_20_HANDBAG,
];

/**
 * Input the engine cannot place: a product id no Coach catalogue holds, and one
 * whose category is outside Coach's three-category taxonomy. Unknown input is
 * part of the fixture, not an afterthought (document 35 §5 W16).
 */
const UNKNOWN_PRODUCT_ID = 'COA-NOT-A-PRODUCT';
const VIEW_UNKNOWN_PRODUCT = productView({ productId: UNKNOWN_PRODUCT_ID });
const UNKNOWN_CATEGORY_PRODUCT_ID = 'COA-NOT-A-PRODUCT-2';
const VIEW_UNKNOWN_CATEGORY = productView({ productId: UNKNOWN_CATEGORY_PRODUCT_ID, category: 'Home Fragrance' });

/** A real Coach order for the quilted Tabby she has been looking at (payload schemas:20). */
const PURCHASE_TABBY_QUILTED = {
  type: 'purchase',
  data: {
    orderId: 'coach-order-w16-b7', value: 575, currency: 'USD',
    items: [{ productId: 'COA-CW620', quantity: 1, price: 575 }],
    // The registry attributes the brand sends with the order, as the kit allows,
    // so the purchase grows the same interest her views built.
    productId: 'COA-CW620', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
    silhouette: 'shoulder', occasion: ['evening', 'date-night', 'special-occasion'], price_usd: 575,
  },
};

// ---------------------------------------------------------------------------
// The published documents. Three slots on /home, each measuring one thing at
// the ranking level:
//   `hero`  weights { line }      → the shopper's line taste (C8.04, .05, .06, .07)
//   `edit`  weights { occasion }  → the cross-category aesthetic (C8.02)
//   `guide` a stage rule          → the journey stage, visible as an ORDER
//                                   (C8.05, .06, .07) rather than a stored field
// In every slot the piece the catalogue lists FIRST is the one the shopper's own
// evidence must overtake, so catalogue order alone can never produce a pass.
// ---------------------------------------------------------------------------

const HERO_BASE_ORDER = ['rogue-editorial', 'tabby-editorial'];
const EDIT_BASE_ORDER = ['festival-charms-editorial', 'evening-charms-editorial'];
/** The guide slot when the shopper is at the first stage of the journey. */
const GUIDE_FIRST_STAGE_ORDER = ['guide-explore-editorial', 'guide-decide-editorial'];
/** The guide slot when she is past it (thinking, or deciding on her order). */
const GUIDE_PAST_FIRST_STAGE_ORDER = ['guide-decide-editorial', 'guide-explore-editorial'];

const FIXTURE_PIECES = [
  // hero: line taste. Rogue is first, so only a remembered Tabby interest moves Tabby up.
  { id: 'rogue-editorial', customerContentId: 'cms-rogue', type: 'editorial', title: 'The Rogue, Rebuilt',
    tags: { line: ['Rogue'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby, Every Way',
    tags: { line: ['Tabby'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  // edit: the cross-category aesthetic, on Accessories she has never viewed.
  { id: 'festival-charms-editorial', customerContentId: 'cms-festival-charms', type: 'editorial', title: 'Festival Charms',
    tags: { occasion: ['festival'], category: ['Accessories'] }, slotTypes: ['edit'], lifecycle: { status: 'live' } },
  { id: 'evening-charms-editorial', customerContentId: 'cms-evening-charms', type: 'editorial', title: 'Charms For The Evening',
    tags: { occasion: ['evening', 'date-night'], category: ['Accessories'] }, slotTypes: ['edit'], lifecycle: { status: 'live' } },
  // guide: the journey stage, as an order. Only the two words both the persisted
  // grammar and the shared vocabulary agree on are used (R29: the middle word is
  // a W16 whole-item residual, so nothing here depends on it).
  { id: 'guide-decide-editorial', customerContentId: 'cms-guide-decide', type: 'editorial', title: 'Ready When You Are',
    tags: {}, slotTypes: ['guide'], lifecycle: { status: 'live' }, journeyStageFit: ['deciding'] },
  { id: 'guide-explore-editorial', customerContentId: 'cms-guide-explore', type: 'editorial', title: 'Start With The Icons',
    tags: {}, slotTypes: ['guide'], lifecycle: { status: 'live' }, journeyStageFit: ['exploring'] },
];

const FIXTURE_SLOTS = {
  pages: {
    home: [
      { slot: 'hero', take: 2, weights: { line: 1 } },
      { slot: 'edit', take: 2, weights: { occasion: 1 } },
      { slot: 'guide', take: 2, weights: {}, stage: { inStage: 0.5, outOfStage: 0.5 } },
    ],
  },
};

/**
 * The journey threshold block, on the already-published reflex document
 * (R32(1)): the visit's THIRD interaction moves the stage (tapestry line 147)
 * and a purchase is the deciding signal (admitted criterion C4). Published in
 * the same shape W16-B4 publishes, so the two batches agree.
 */
const JOURNEY_V1 = {
  stages: [
    { stage: 'thinking', anyOf: { interactions: 3 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};

/**
 * Days/weeks memory (document 35 §5 W16; tapestry line 152). R32(4) accepts a
 * published fourteen-day reflex `tauMs` as customer-neutral published data; the
 * shipped 60 s default is W16.C8.01's subject and is not re-measured here.
 */
const FIXTURE_TAU_MS = 14 * DAY_MS;
const fixtureReflexConfig = {
  ...DEFAULT_REFLEX_CONFIG, version: 'w16-b7-fixture', tauMs: FIXTURE_TAU_MS,
  // Both hosts score the attributes the brand's own events carry; the shopper
  // object never holds a copy of the customer's catalogue
  // (`ShopperReflex.ts:1055` passes no product), so this is the posture a real
  // Coach deployment publishes.
  eventAttributes: 'event-when-unknown' as const,
};
const withJourney = (config: Record<string, unknown>, journey: unknown) => ({ ...config, journey });

// ---------------------------------------------------------------------------
// Host fixture — the real mounted app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts`.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b7-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
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

const documentChanges = (tenant: string): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b7-fixture', note: '', value: { pieces: FIXTURE_PIECES } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b7-fixture', note: '', value: FIXTURE_SLOTS } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b7-fixture', note: '', value: {
    // Gamma stays zero everywhere in this batch: C8 measures the engine's own
    // context and memory behavior, never learned lift (document 35 §2 N20).
    holdout: { share: 0, salt: 'w16-b7', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string, reflexDocument: unknown) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b7-fixture', note: '', value } });
  const changes = documentChanges(tenant);
  const defaults = [baseline(REFLEX_KIND, reflexDocument, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b7', arms: ['default'] } })];
  return initializePublicationSet(env,
    defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base),
    '0:' + crypto.randomUUID());
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const queued: Array<{ record?: Record<string, unknown> }> = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b7-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (message: { record?: Record<string, unknown> }) => { queued.push(message); } },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b7-fixture', note: '', value: fixtureReflexConfig }));
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

/** What `POST /realtime/action` answers on either host. */
interface ActionAnswer {
  status: number;
  /**
   * RULED, ABSENT TODAY (R21): the diagnostic that names an input the engine
   * could not place. Unit W16.C8.03 is RED on it.
   */
  signals?: { recognized?: boolean; unrecognized?: string[] } | null;
}
/** What the SDK-visible hydrate (`GET /realtime/reflex`) returns on either host. */
interface Hydrate {
  visit?: { visitNumber: number | null; entryChannel: string | null } | null;
  affinity?: { dims?: Record<string, Record<string, number>> } | null;
}
/** What the mounted decisions snapshot exposes: the ranking, per slot, in served order. */
interface SnapshotAnswer {
  status: number;
  ok: unknown;
  state: unknown;
  /** slot → the content ids it served, in the order it served them. */
  ranking: Record<string, string[]>;
  /** slot → the drivers the first served piece was ranked by. */
  firstDrivers: Record<string, Array<{ dim: string; value: string }>>;
}

interface HostFixture {
  f: ReturnType<typeof boundary>;
  grant: Awaited<ReturnType<typeof newAnonymousSession>>;
  /** A real accepted event through the mounted app, on whichever host this fixture runs. */
  action: (event: { type: string; data: Record<string, unknown> }) => Promise<ActionAnswer>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`). */
  hydrate: () => Promise<Hydrate>;
  /** R19: the mounted route production serves, `GET /v1/:tenant/decisions/snapshot`. */
  snapshot: () => Promise<SnapshotAnswer>;
  /**
   * The same decision one layer in, inside the shopper owner's invocation —
   * the path `requireShopper` → `forwardShopperRequest` → the owned operation
   * reaches in production. Used only where no public route can admit the
   * request at all (W16.C8.07's day-7 and day-14 return; R19, R34).
   */
  decide: () => Promise<{ ranking: Record<string, string[]>; visitBucket: string }>;
  /**
   * The same shopper returning days later. A shopper capability lives at most
   * SHOPPER_MAX_AGE (24 h), so a return always presents a freshly minted one;
   * her browser still names the browsing session it stored (HANDOFF §5 C6,
   * direct mode), which is the return path reachable today (R34).
   */
  returnAfterDays: () => Promise<void>;
  /** The retention stamp the owner actually stored for this shopper. */
  ownedRetention: () => unknown;
}

async function hostFixture(host: 'session' | 'do'): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT, withJourney(fixtureReflexConfig, JOURNEY_V1));
  await explicitChoice(f, grant);
  let current: Awaited<ReturnType<typeof newAnonymousSession>> = grant;
  const action = async (event: { type: string; data: Record<string, unknown> }) => {
    const response = await f.call('/realtime/action', current.capability, {
      ...event, source: 'sdk', userId: current.subject, sessionId: current.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(),
    });
    const body = await response.clone().json().catch(() => ({})) as { signals?: ActionAnswer['signals'] };
    await f.drain();
    return { status: response.status, signals: body.signals ?? null };
  };
  const hydrate = async () => {
    const response = await f.call('/realtime/reflex', current.capability);
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()) as Hydrate;
  };
  const snapshot = async () => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=home`, current.capability);
    const body = await response.clone().json().catch(() => ({})) as {
      ok?: unknown; sources?: { state?: unknown };
      decisions?: Array<{ slot?: string; contentId?: string; explain?: { drivers?: Array<{ dim: string; value: string }> } }>;
    };
    await f.drain();
    const ranking: Record<string, string[]> = {}, firstDrivers: Record<string, Array<{ dim: string; value: string }>> = {};
    for (const decision of body.decisions ?? []) {
      const slot = decision.slot ?? 'unknown-slot';
      (ranking[slot] ??= []).push(decision.contentId ?? 'unknown-content');
      if (ranking[slot]!.length === 1) firstDrivers[slot] = (decision.explain?.drivers ?? []).map(d => ({ dim: d.dim, value: d.value }));
    }
    return { status: response.status, ok: body.ok, state: body.sources?.state, ranking, firstDrivers };
  };
  const decide = async () => {
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
    const ranking: Record<string, string[]> = {};
    for (const decision of out.decisions) (ranking[decision.slot] ??= []).push(decision.contentId);
    return { ranking, visitBucket: out.cell.visit_bucket };
  };
  const returnAfterDays = async () => {
    current = await issueSessionCapability(f.env, { tenant: TENANT, subject: grant.subject, sessionId: grant.sessionId, kind: 'anonymous' });
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
  return { f, grant, action, hydrate, snapshot, decide, returnAfterDays, ownedRetention };
}

/** Both hosts answer the same page, so every ranking assertion names the host it measured. */
const HOSTS = ['session', 'do'] as const;

// ---------------------------------------------------------------------------

describe('unit:W16.C8.02', () => {
  it('host: views across Handbags and Small Leather Goods build one aesthetic under which a cross-category Accessories piece outranks an unrelated one, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // Three real interactions of one visit, in two of Coach's categories:
        // the quilted Tabby (Handbags), the Tabby chain wallet and the Essential
        // zip wallet (Small Leather Goods). What they share is an aesthetic —
        // `evening` (all three) and `date-night` (two of them) — not a category.
        for (const [index, event] of CROSS_CATEGORY_VISIT.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await h.action(event)).status, `${host}: ${JSON.stringify(event.data.productId)}`).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const answer = await h.snapshot();
        expect(answer, host).toMatchObject({ status: 200, ok: true, state: host });

        // tapestry line 150, Style Understanding "across all categories": the
        // edit slot serves ACCESSORIES, a category she has never viewed. The
        // piece carrying her evening/date-night aesthetic must lead it, over the
        // festival piece the catalogue lists first.
        expect(answer.ranking.edit,
          `${host}: W16.C8.02 — the cross-category aesthetic she built in Handbags and Small Leather Goods must rank the evening Accessories piece first`)
          .toEqual(['evening-charms-editorial', 'festival-charms-editorial']);
        // …and the reason on the receipt is that aesthetic, named.
        expect(answer.firstDrivers.edit?.some(d => d.dim === 'occasion' && (d.value === 'evening' || d.value === 'date-night')),
          `${host}: W16.C8.02 — the served piece is explained by the shared aesthetic, not by an accident of catalogue order`).toBe(true);
        // The same visit's line taste still ranks the hero slot she did view.
        expect(answer.ranking.hero, `${host}: W16.C8.02 — her Tabby interest also ranks the Handbags slot`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C8.03', () => {
  it('host: an unknown product id and an out-of-taxonomy category create no taste, are diagnosed, and leave the base order standing, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // The shopper's only signals are two the engine cannot place: a product
        // id no Coach catalogue holds, and a category outside Coach's own three
        // (`src/services/CatalogIntent.ts`: Handbags, Small Leather Goods,
        // Accessories). Both are accepted — her traffic is not refused.
        clock.mockReturnValue(T0);
        const first = await h.action(VIEW_UNKNOWN_PRODUCT);
        expect(first.status, `${host}: the unknown product view is accepted`).toBe(200);
        clock.mockReturnValue(T0 + STEP_MS);
        const second = await h.action(VIEW_UNKNOWN_CATEGORY);
        expect(second.status, `${host}: the out-of-taxonomy category view is accepted`).toBe(200);

        // 1. Nothing is invented: the page is served in exactly the order the
        //    catalogue lists it, on every slot that ranks on a dimension.
        clock.mockReturnValue(T0 + STEP_MS);
        const answer = await h.snapshot();
        expect(answer, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(answer.ranking.hero, `${host}: W16.C8.03 — an input the engine cannot place leaves the base order standing`).toEqual(HERO_BASE_ORDER);
        expect(answer.ranking.edit, `${host}: W16.C8.03 — and the same on the aesthetic slot`).toEqual(EDIT_BASE_ORDER);

        // 2. It creates no taste on the dimensions the page ranks on: her
        //    reported interest is exactly what her recognized input justifies,
        //    which here is nothing at all (HANDOFF §12: unknown stays unknown).
        const dims = (await h.hydrate()).affinity?.dims ?? {};
        expect(dims.line ?? {}, `${host}: W16.C8.03 — no line interest is invented from an unrecognized product`).toEqual({});
        expect(dims.occasion ?? {}, `${host}: W16.C8.03 — and no aesthetic interest either`).toEqual({});

        // 3. The control that keeps 2. honest: the same fixture, the same
        //    shopper, one RECOGNIZED view — her visit's third interaction — and
        //    the page moves. An empty taste above is a property of the
        //    unrecognized input, not of a dead harness.
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        expect((await h.action(VIEW_TABBY_QUILTED_HANDBAG)).status, host).toBe(200);
        const recognized = await h.snapshot();
        expect(recognized.ranking.hero,
          `${host}: W16.C8.03 control — a recognized Coach product on the visit's third interaction does move the page`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);
        expect(Object.keys((await h.hydrate()).affinity?.dims?.line ?? {}),
          `${host}: W16.C8.03 control — and the taste it built names exactly the line she viewed`).toEqual(['Tabby']);

        // 4. The unknown input is DIAGNOSED rather than silently dropped: the
        //    host that accepted the event names the input it could not place
        //    (ruled member, R21).
        expect(first.signals,
          `${host}: W16.C8.03 — the answer must diagnose the unrecognized input by naming the product id the engine could not place`)
          .toEqual({ recognized: false, unrecognized: [UNKNOWN_PRODUCT_ID] });
        expect(second.signals,
          `${host}: W16.C8.03 — and the same for a category outside the brand's taxonomy`)
          .toEqual({ recognized: false, unrecognized: [UNKNOWN_CATEGORY_PRODUCT_ID] });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C8.04', () => {
  it('host: one sparse view moves nothing without a published seed rule, and the visit\'s third interaction adapts the page to the line she viewed, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        // LIVE CONTROL FIRST, on its own shopper: Time to Relevance
        // (tapestry_requirements.txt line 147) — by the THIRD interaction of the
        // visit the page adapts to the line she has been viewing. This is the
        // half of the outcome the engine must keep, measured before the half it
        // lacks, so the unit can never be satisfied by refusing to personalize.
        clock.mockReturnValue(T0);
        const control = await hostFixture(host);
        for (const [index, event] of THREE_TABBY_VIEWS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          expect((await control.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const controlAnswer = await control.snapshot();
        expect(controlAnswer, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(controlAnswer.ranking.hero,
          `${host}: W16.C8.04 control — from the third interaction of the visit the page adapts to the Tabby line she viewed`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);

        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // This tenant publishes NO contextual seed rule set (the "if any" branch
        // of the ruled outcome; seeds themselves are criterion C3, units
        // W16.C3.01-.09). So after the FIRST sparse signal of a cold shopper
        // there is nothing that may move the page: a single view is not yet a
        // taste, and inventing one is what document 35 §2 F13 calls out.
        clock.mockReturnValue(T0);
        expect((await h.action(VIEW_TABBY_QUILTED_HANDBAG)).status, host).toBe(200);
        clock.mockReturnValue(T0);
        const afterOne = await h.snapshot();
        expect(afterOne, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(afterOne.ranking.hero,
          `${host}: W16.C8.04 — after one view, with no published seed rule, the served order is still the catalogue's`)
          .toEqual(HERO_BASE_ORDER);
        expect(afterOne.ranking.edit,
          `${host}: W16.C8.04 — and the aesthetic slot is unmoved by one view as well`)
          .toEqual(EDIT_BASE_ORDER);

        // Time to Relevance (tapestry_requirements.txt line 147): "3 clicks —
        // site adapts third interaction onwards". The third interaction of the
        // visit is where the page must adapt to the line she has been viewing.
        clock.mockReturnValue(T0 + STEP_MS);
        expect((await h.action(VIEW_TABBY_SHOULDER_26_HANDBAG)).status, host).toBe(200);
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        expect((await h.action(VIEW_TABBY_SHOULDER_20_HANDBAG)).status, host).toBe(200);
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const afterThree = await h.snapshot();
        expect(afterThree.ranking.hero,
          `${host}: W16.C8.04 — from the third interaction of the visit the page adapts to the Tabby line she viewed`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C8.05', () => {
  it('host: a new visit past VISIT_GAP_MS restarts the journey at the ranking level while her taste keeps ranking the page, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // LIVE CONTROL: one interaction into the visit, the stage-ruled slot
        // leads with the first-stage piece. The rule fires and the engine DOES
        // serve that order today, so the absence this unit measures after the
        // boundary is the journey's restart, not a slot that never ranks.
        clock.mockReturnValue(T0);
        expect((await h.action(THREE_TABBY_VIEWS[0]!)).status, host).toBe(200);
        const firstStep = await h.snapshot();
        expect(firstStep, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(firstStep.ranking.guide,
          `${host}: W16.C8.05 control — one interaction into the visit the stage rule serves the first-stage guide`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        for (const [index, event] of THREE_TABBY_VIEWS.slice(1).entries()) {
          clock.mockReturnValue(T0 + (index + 1) * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const inVisit = await h.snapshot();
        expect(inVisit, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(inVisit.ranking.hero, `${host}: three interactions put her Tabby interest in front`).toEqual(['tabby-editorial', 'rogue-editorial']);
        // Three interactions of this visit: she is past the first stage, so the
        // guide slot leads with the piece made for the later stage — the second
        // live control, proving the order above moves with the journey.
        expect(inVisit.ranking.guide, `${host}: three interactions of this visit are past the first stage`).toEqual(GUIDE_PAST_FIRST_STAGE_ORDER);
        expect((await h.hydrate()).visit, host).toEqual({ visitNumber: 1, entryChannel: null });

        // The read crosses the visit boundary (the read-time rollover of
        // W16.C2.06). The JOURNEY is the visit's and starts again; the TASTE is
        // not the journey's to reset (tapestry line 152: she picks up where she
        // left off).
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS);
        const nextVisit = await h.snapshot();
        expect(nextVisit.ranking.hero,
          `${host}: W16.C8.05 — her cumulative taste still ranks the page across the visit boundary`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);
        expect(nextVisit.ranking.guide,
          `${host}: W16.C8.05 — a new visit restarts the journey, so the first-stage guide leads again`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        expect((await h.hydrate()).visit, `${host}: the visit number advanced`).toEqual({ visitNumber: 2, entryChannel: null });

        // The new visit's own journey starts from zero: one interaction into it
        // is the first stage, not the fourth interaction of a visit that ended.
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + STEP_MS);
        expect((await h.action(VIEW_TABBY_SHOULDER_26_HANDBAG)).status, host).toBe(200);
        const afterOne = await h.snapshot();
        expect(afterOne.ranking.guide,
          `${host}: W16.C8.05 — one interaction into the new visit is still the first stage`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        expect(afterOne.ranking.hero,
          `${host}: W16.C8.05 — her taste is untouched by the restart`).toEqual(['tabby-editorial', 'rogue-editorial']);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C8.06', () => {
  it('host: the decision after a purchase serves the restarted journey and the preserved taste, and the purchase is not carried in as a fresh browsing interaction, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // LIVE CONTROL: one interaction into the visit the stage-ruled slot
        // leads with the first-stage piece, so that order is one the engine can
        // and does serve; what this unit measures is whether the purchase
        // restart brings it back.
        clock.mockReturnValue(T0);
        expect((await h.action(THREE_TABBY_VIEWS[0]!)).status, host).toBe(200);
        const firstStep = await h.snapshot();
        expect(firstStep, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(firstStep.ranking.guide,
          `${host}: W16.C8.06 control — one interaction into the visit the stage rule serves the first-stage guide`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        for (const [index, event] of THREE_TABBY_VIEWS.slice(1).entries()) {
          clock.mockReturnValue(T0 + (index + 1) * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const before = await h.snapshot();
        expect(before, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(before.ranking.hero, `${host}: her Tabby interest before the order`).toEqual(['tabby-editorial', 'rogue-editorial']);
        expect(before.ranking.guide, `${host}: she is past the first stage before the order`).toEqual(GUIDE_PAST_FIRST_STAGE_ORDER);

        // She buys the quilted Tabby she has been looking at: a real order, in
        // the kit's own purchase shape.
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        expect((await h.action(PURCHASE_TABBY_QUILTED)).status, `${host}: the order is accepted`).toBe(200);

        // The NEXT decision (C4's rule: only once the purchase decision and its
        // attribution are captured) serves the restarted journey and the taste
        // the purchase itself grew. It is the same visit, not a new one.
        clock.mockReturnValue(T0 + 4 * STEP_MS);
        const after = await h.snapshot();
        expect(after.ranking.hero,
          `${host}: W16.C8.06 — the taste she bought on is preserved, still ranking Tabby first`).toEqual(['tabby-editorial', 'rogue-editorial']);
        expect(after.ranking.guide,
          `${host}: W16.C8.06 — after the order the journey restarts, so the first-stage guide leads`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        expect((await h.hydrate()).visit, `${host}: W16.C8.06 — a purchase reset is not a new visit`).toEqual({ visitNumber: 1, entryChannel: null });

        // The purchase is not fabricated as a fresh browsing interaction: after
        // the restart, one view is ONE interaction, so the page still serves the
        // first stage exactly as it would for a shopper who had viewed once and
        // bought nothing (HANDOFF §12: buffered/derived occurrences must not
        // become fresh activity).
        clock.mockReturnValue(T0 + 5 * STEP_MS);
        expect((await h.action(VIEW_TABBY_SHOULDER_26_HANDBAG)).status, host).toBe(200);
        const afterOne = await h.snapshot();
        expect(afterOne.ranking.guide,
          `${host}: W16.C8.06 — one view after the order is one interaction of the new journey, not a continuation of the old one`)
          .toEqual(GUIDE_FIRST_STAGE_ORDER);
        expect(afterOne.ranking.hero,
          `${host}: W16.C8.06 — her taste is untouched by the restart`).toEqual(['tabby-editorial', 'rogue-editorial']);
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C8.07', () => {
  it('host: the next-day return restarts the journey at the ranking level, keeps ranking by her earlier taste and renews no retention, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // LIVE CONTROL: one interaction into her first visit the stage-ruled
        // slot serves the first-stage order, so the same order is available to
        // a return.
        clock.mockReturnValue(T0);
        expect((await h.action(THREE_TABBY_VIEWS[0]!)).status, host).toBe(200);
        const firstStep = await h.snapshot();
        expect(firstStep, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(firstStep.ranking.guide,
          `${host}: W16.C8.07 control — one interaction into the visit the stage rule serves the first-stage guide`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        for (const [index, event] of THREE_TABBY_VIEWS.slice(1).entries()) {
          clock.mockReturnValue(T0 + (index + 1) * STEP_MS);
          expect((await h.action(event)).status, host).toBe(200);
        }
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const inVisit = await h.snapshot();
        expect(inVisit, host).toMatchObject({ status: 200, ok: true, state: host });
        expect(inVisit.ranking.hero, `${host}: the taste her three views built ranks the page`).toEqual(['tabby-editorial', 'rogue-editorial']);
        expect(inVisit.ranking.guide, `${host}: and three interactions have moved her past the first stage`).toEqual(GUIDE_PAST_FIRST_STAGE_ORDER);
        const retention = h.ownedRetention();
        expect(retention, `${host}: the owner stored a retention stamp for this shopper`).toBeTruthy();

        // The furthest return the public route can admit today is inside the
        // shopper capability's own life (SHOPPER_MAX_AGE, 24 h): the next day.
        // Everything past that is R34's continuity gap, measured in the
        // host-internal leg below.
        clock.mockReturnValue(T0 + 23 * 60 * 60 * 1000);
        const nextDay = await h.snapshot();
        expect(nextDay, `${host}: the next-day return is served`).toMatchObject({ status: 200, ok: true, state: host });
        expect(nextDay.ranking.hero,
          `${host}: W16.C8.07 — a day later the ranking still reflects the taste that drove her last decision (tapestry line 152)`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);
        expect(nextDay.ranking.guide,
          `${host}: W16.C8.07 — and the day restarts the journey at the first stage`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        expect((await h.hydrate()).visit?.visitNumber, `${host}: W16.C8.07 — the next-day return is a new visit`).toBe(2);
        // The return READ renews nothing: the retained-data stamp is still the
        // one her record was born with (HANDOFF §12; this fixture's published
        // policy renews on a new record only).
        expect(h.ownedRetention(), `${host}: W16.C8.07 — the return read renews no retention`).toEqual(retention);
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: after 7 and after 14 days of the published memory horizon the decision still ranks by her earlier taste, each return restarts the journey, and no return renews retention', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      // R19 host-internal, with the reason: no public route can admit this
      // shopper seven days later. A shopper capability lives at most 24 h and
      // the shopper object admits only grants it stored (`ShopperReflex.ts`
      // assertGrant), and `requireShopper` dispatches EVERY shopper route
      // through that object on both hosts — so the 7-day and 14-day return
      // answers 401 on the public path. R34 rules that gap criterion C6
      // (continuity), not C8, and rules that C8 measures the memory horizon on
      // the reachable return until C6 lands. The missing public observable —
      // an admissible anonymous return after 24 h — is this unit's residual.
      // The decision itself is computed here exactly as production computes it:
      // inside the shopper owner's invocation, through `serveContentDecisions`.
      const host = 'session' as const;
      const h = await hostFixture(host);
      // LIVE CONTROL on the same owned path this leg measures: one interaction
      // into her first visit the stage-ruled slot serves the first-stage order.
      clock.mockReturnValue(T0);
      expect((await h.action(THREE_TABBY_VIEWS[0]!)).status, host).toBe(200);
      const firstStep = await h.decide();
      expect(firstStep.ranking.guide,
        'W16.C8.07 control — one interaction into the visit the stage rule serves the first-stage guide').toEqual(GUIDE_FIRST_STAGE_ORDER);
      for (const [index, event] of THREE_TABBY_VIEWS.slice(1).entries()) {
        clock.mockReturnValue(T0 + (index + 1) * STEP_MS);
        expect((await h.action(event)).status, host).toBe(200);
      }
      clock.mockReturnValue(T0 + 2 * STEP_MS);
      const inVisit = await h.decide();
      expect(inVisit.ranking.hero, 'the taste her three views built ranks the page').toEqual(['tabby-editorial', 'rogue-editorial']);
      expect(inVisit.visitBucket, 'her first visit').toBe('1');
      const retention = h.ownedRetention();
      expect(retention, 'the owner stored a retention stamp for this shopper').toBeTruthy();

      // Day 7 and day 14 of the published fourteen-day memory horizon (R32(4));
      // document 35 §5 W16 "days/weeks memory", tapestry line 152.
      for (const days of [7, 14]) {
        clock.mockReturnValue(T0 + days * DAY_MS);
        await h.returnAfterDays();
        const returned = await h.decide();
        expect(returned.ranking.hero,
          `W16.C8.07 — after ${days} days the ranking still reflects the taste that drove her last decision (tapestry line 152)`)
          .toEqual(['tabby-editorial', 'rogue-editorial']);
        // The day, and then the week, restart the journey: the visit-local
        // journey is not carried across the gap, while the taste above is.
        expect(returned.ranking.guide,
          `W16.C8.07 — the day-${days} return restarts the journey at the first stage`).toEqual(GUIDE_FIRST_STAGE_ORDER);
        expect(returned.visitBucket, `W16.C8.07 — the day-${days} return is a later visit, and the decision is made in that cell`).toBe('2-3');
        expect(h.ownedRetention(), `W16.C8.07 — the day-${days} return read renews no retention`).toEqual(retention);
      }
    } finally { clock.mockRestore(); }
  });
});
