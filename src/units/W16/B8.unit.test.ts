// src/units/W16/B8.unit.test.ts
// W16 batch B8 — the five follow-up units the W16 build reviews left owed.
//
// One `describe('unit:<id>')` per unit, one `it` per ruled leg. Every expected
// value comes from a witness named beside it — the ruled outcome in the W16-B8
// brief, the admitted criteria in `docs/handover/HANDOFF-2026-09-18.md` §5/§7,
// the merged batch tables of W16-B2/B5/B6/B7 and the rulings R19, R21, R32,
// R44, R46(a), R47, R59, R62, R63 and R64 — never from what the engine returns
// today.
//
// WHAT EACH UNIT OWES, AND WHO FOUND IT
//
//  W16.C6.13 (R62; W16-B6 build review finding F1). `reportContinuity`
//    (`src/routes/identity.ts:170-175`) maps a non-200 from the shopper's own
//    object, a body it cannot read, and a thrown transport error all onto
//    `{ enabled: false, reason: 'consent' }`, and the SDK's `keepContinuity`
//    (`src/sdk/core.ts:585-588`) erases the stored proof and its operation id on
//    ANY `enabled: false`. One transient failure on a routine page load
//    therefore destroys a still-valid recognition proof and reports the reason
//    as a consent decision the shopper never made. RULED: a transport or owner-
//    object failure is reported as its own reason and the browser keeps what it
//    holds.
//
//  W16.C5.06 (R63; W16-B5 build review finding F3, carried as "F3 has no unit").
//    A stage-moving read whose stored profile-retention stamp is unusable must
//    still ANSWER, send nothing to the destination, and say so in one coded,
//    non-identifying diagnostic.
//
//  W16.C8.09 and W16.C8.10 (R64; W16-B7 build review finding F3). The catalogue
//    vocabulary is applied on the live ingest path only. Buffered ingest
//    (`src/reflex/bufferedAction.ts:56`), historical import
//    (`src/identity/history.ts:146`) and content telemetry
//    (`src/reflex/contentTelemetry.ts:96`) each reach the registry through
//    `touchesForEvent`/`extractTouches` directly and place values this tenant's
//    catalogue does not name.
//
//  W16.C2.16 (R33/R39; W16-B2 build review residual "the SDK drops an over-bound
//    term silently while the server refuses it"). The browser half of the
//    campaign entry term, measured through the real `src/sdk` entry.
//
// THE RULED VOCABULARY RULE, STATED ONCE (R64), so no two units of W16 demand
// two representations of one fixture. It is the rule unit W16.C8.08 states and
// units W16.C8.03/.04 are specified under, quoted here verbatim in substance:
//   On a dimension the tenant's published catalogue NAMES, a value that
//   catalogue does not name builds no taste, whatever else the event carries;
//   on a dimension the catalogue names nothing, the catalogue is authority over
//   nothing and the event's own value stands. An event is RECOGNIZED when at
//   least one of its values built taste. `signals.unrecognized` names every
//   product reference the engine could not place.
// The published catalogue of the fixture below names: `line {Rogue, Tabby}`,
// `category {Handbags, Accessories}`, `occasion {festival, evening, date-night}`
// and the product ids its pieces feature. It names nothing on `subcategory`,
// `silhouette`, `priceBand` or `contentType`, so those dimensions are never
// refused here. The pieces, slots, journey block and horizon are byte-equal to
// the fixture `src/units/W16/C8.unit.test.ts` publishes, so a value measured
// there and a value measured here are the same value.
//
// RULED MISSING MEMBERS (R21), asserted by the name this specification rules and
// RED until they exist:
//   1. `ContinuityReport` gains the reason `'unavailable'`
//      (`src/routes/identity.ts:101`): `{ enabled: false, reason: 'unavailable' }`
//      is what a transport or owner-object failure reports. The ruled outcome
//      allowed either this or omitting `continuity` from the answer; this
//      specification rules the named reason, because the SDK must be able to
//      tell "the engine could not be reached" from "the engine placed nobody"
//      (an omitted member is also what an older engine sends), and because the
//      host leg and the sdk leg of this same unit must demand ONE representation.
//   2. `signals` `{ recognized: boolean; unrecognized: string[] }` on the
//      BUFFERED answer of `POST /realtime/action` (`src/routes/realtime.ts:250`),
//      the same member unit W16.C8.03 rules for the live answer.
//
// The host legs drive the real mounted app and the real `ShopperReflex` class in
// process on BOTH hosts, in the pattern of `src/units/W16/C2.unit.test.ts`,
// `C5.unit.test.ts`, `C6.unit.test.ts` and `src/routes/realtime.sdkContract.test.ts`;
// those suites are never imported and never edited. The sdk legs drive the real
// `src/sdk` entry (`createCore`) against `memoryHost`, at the fetch boundary, as
// `C6.unit.test.ts:1156` does.
//
// LIMITS OF THIS FILE, named for the whole-W review (R48(c)):
//  - No native (workerd/Miniflare) leg: every unit here is route- and
//    SDK-observable, and the durable-object doubles below are the same
//    hand-written ones the merged W16 units use. Named as a residual per row.
//  - W16.C5.06 makes the stored stamp unusable by publishing the next revision
//    of the tenant's profile retention policy, which is the only customer-neutral
//    way to reach the branch from outside; the W16-B5 review reached it the same
//    way (its probe E).
//  - W16.C6.13 injects the transient failure at the durable-object namespace
//    boundary on the CONSUME call, which is the one continuity call the route
//    makes outside a forwarded owner invocation (the issue call on the refresh
//    path runs behind `dispatchOwnedRequest`'s owner-scoped proxy and cannot be
//    failed from outside — the W16-B6 review recorded exactly that, its probe D).
//    The issue-call half of R62 therefore rides on the same reported reason and
//    is named as a residual on the row.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent } from '@/content/consent';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { snapshot as reflexSnapshot } from '@/reflex/core';
import { applyHistorical } from '@/reflex/identityMerge';
import { REFLEX_KIND, reflexScopeForTenant, invalidateConfigCache } from '@/reflex/configStore';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { configuredDestinations, connectorIdentity } from '@/connectors/config';
import { VISIT_GAP_MS } from '@/services/visit';
import { ENTRY_TERM_LIMIT } from '@/services/visit';
import { memoryStore } from '@/auth/store';
import { createCore, DEFAULT_PATHS } from '@/sdk/core';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks } from '@/sdk/testHost';
import type { RetentionCategory, RetentionPolicy } from '@/retention';

// ---------------------------------------------------------------------------
// Customer-shaped fixtures. Every product below is a verbatim row of the
// brand's own catalogue (`src/data/coach-catalog.json`) — id, line, category,
// subcategory, silhouette, occasion and price — because W16 is measured on the
// actual taxonomy. The taxonomy lives here, in the fixture, never in product
// code (METHOD §6).
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const OTHER_TENANT = 'coach';
const T0 = 1_725_000_000_000;
/** One interaction apart, well inside the visit (VISIT_GAP_MS = 30 min). */
const STEP_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The storefront's real product-view shape (docs/kit/03-payload-schemas.md:19). */
const productView = (data: Record<string, unknown>) => ({ type: 'product_view', data });

/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting · Handbags. */
const VIEW_TABBY_QUILTED_HANDBAG = productView({
  productId: 'COA-CW620', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['evening', 'date-night', 'special-occasion'], price_usd: 575,
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
/** COA-CB925 · Tabby Wallet With Chain · Small Leather Goods — a piece the catalogue features. */
const VIEW_TABBY_CHAIN_WALLET_SLG = productView({
  productId: 'COA-CB925', line: 'Tabby', category: 'Small Leather Goods', subcategory: 'Wallets',
  silhouette: 'chain wallet', occasion: ['evening', 'date-night', 'everyday'], price_usd: 250,
});
/** Three live interactions of one visit, so the shopper has one unambiguous interest. */
const THREE_TABBY_VIEWS = [VIEW_TABBY_QUILTED_HANDBAG, VIEW_TABBY_SHOULDER_26_HANDBAG, VIEW_TABBY_SHOULDER_20_HANDBAG];

/** The values a reported affinity view names per dimension, order-independent. */
const valuesOf = (dims: Record<string, Record<string, number>> | undefined | null): Record<string, string[]> =>
  Object.fromEntries(Object.entries(dims ?? {}).map(([dim, values]) => [dim, Object.keys(values).sort()]));

// --- W16.C8.09 · the buffered arrival -------------------------------------
/**
 * The interest that arrived late: a page she looked at a week ago on a device
 * that was offline, handed to the platform now and explicitly marked buffered
 * (HANDOFF §7, "Explicitly buffered browser/app actions may contribute
 * age-decayed interest"). It carries, on ONE event:
 *   · a product id in no catalogue this tenant publishes  → named unplaceable
 *   · `line: 'Rogue'`      — a value the catalogue names  → builds taste
 *   · `category: 'Home Fragrance'` — a value on a named dimension that this
 *     catalogue does not name                             → builds NO taste
 *   · `occasion: ['festival']` — a value the catalogue names → builds taste
 */
const BUFFERED_UNPLACEABLE_ID = 'COA-NOT-IN-CATALOGUE-09';
const BUFFERED_MIXED_VIEW = productView({
  productId: BUFFERED_UNPLACEABLE_ID, line: 'Rogue', category: 'Home Fragrance', occasion: ['festival'],
});
/** The same buffered delivery for a product the published catalogue names: the control. */
const BUFFERED_NAMED_VIEW = VIEW_TABBY_CHAIN_WALLET_SLG;
/** The browsing session the late page view belongs to, which is not the live one. */
const LATE_BROWSING_SESSION = 'earlier-browsing-session-w16-b8';
/** How late it was delivered (HANDOFF §7 "Late history": no age cutoff is inferred from delay). */
const LATE_BY_MS = 7 * DAY_MS;

// --- W16.C8.10 · the two other ingest paths --------------------------------
/** A content interaction the SDK emits (CW3), carrying a category the catalogue does NOT name. */
const CONTENT_CLICK_UNNAMED_CATEGORY = { type: 'content_click', data: { category: 'Home Fragrance' } };
/** The same content interaction for a category the catalogue DOES name: the control. */
const CONTENT_CLICK_NAMED_CATEGORY = { type: 'content_click', data: { category: 'Accessories' } };
/** A warehouse row carrying a line the catalogue does NOT name… */
const IMPORT_UNNAMED_LINE = 'Willow';
/** …and one it does. */
const IMPORT_NAMED_LINE = 'Rogue';

// ---------------------------------------------------------------------------
// The published documents. Byte-equal to the set `src/units/W16/C8.unit.test.ts`
// publishes (R64's fixture), so the vocabulary these units measure is the
// vocabulary that batch measures.
// ---------------------------------------------------------------------------

const HERO_BASE_ORDER = ['rogue-editorial', 'tabby-editorial'];
const ROGUE = 'rogue-editorial';
const TABBY = 'tabby-editorial';

const FIXTURE_PIECES = [
  // hero: line taste. Rogue is first, so only a remembered Tabby interest moves Tabby up.
  { id: 'rogue-editorial', customerContentId: 'cms-rogue', type: 'editorial', title: 'The Rogue, Rebuilt',
    tags: { line: ['Rogue'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-CP133', 'COA-CCX23', 'COA-CCX21'] },
  { id: 'tabby-editorial', customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby, Every Way',
    tags: { line: ['Tabby'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-CW620', 'COA-CH857', 'COA-CY201', 'COA-CB925'] },
  // edit: the cross-category aesthetic, on Accessories she has never viewed.
  { id: 'festival-charms-editorial', customerContentId: 'cms-festival-charms', type: 'editorial', title: 'Festival Charms',
    tags: { occasion: ['festival'], category: ['Accessories'] }, slotTypes: ['edit'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-77840', 'COA-CB929'] },
  { id: 'evening-charms-editorial', customerContentId: 'cms-evening-charms', type: 'editorial', title: 'Charms For The Evening',
    tags: { occasion: ['evening', 'date-night'], category: ['Accessories'] }, slotTypes: ['edit'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-CCZ00', 'COA-CCD82'] },
  // guide: the journey stage, as an order.
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

/** R32(1): the journey thresholds live on the published reflex document. */
const JOURNEY_V1 = {
  stages: [
    { stage: 'thinking', anyOf: { interactions: 3 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};

/** R32(4): a published fourteen-day memory horizon is customer-neutral fixture data. */
const FIXTURE_TAU_MS = 14 * DAY_MS;
const fixtureReflexConfig = {
  ...DEFAULT_REFLEX_CONFIG, version: 'w16-b8-fixture', tauMs: FIXTURE_TAU_MS,
  eventAttributes: 'event-when-unknown' as const,
};
const reflexDocument = (continuity: unknown | null) => ({
  ...fixtureReflexConfig, journey: JOURNEY_V1, ...(continuity === null ? {} : { continuity }),
});

/**
 * The synthetic continuity configuration W16.C6.13 publishes. Exactly the block
 * `src/units/W16/C6.unit.test.ts` publishes, so the two batches demand one
 * representation. It is a test document, never a shipped default: the
 * production mode, window, purpose and retention approval stay the open owner
 * decision of HANDOFF §8.
 */
const WINDOW_MS = 30 * DAY_MS;
const PURPOSE = 'w16-b6-return-recognition';
const CONTINUITY_DIRECT = { mode: 'direct', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true };
/** Ruled member (W16-B6): the SDK's tenant-scoped direct-mode store. */
const sdkContinuityKey = (endpoint: string, tenant: string) =>
  `opt_shopper_continuity:${encodeURIComponent(endpoint)}:${encodeURIComponent(tenant)}`;
const sdkContinuityOperationKey = (endpoint: string, tenant: string) => `${sdkContinuityKey(endpoint, tenant)}:operation`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// The tenant's configured ODP destination (W16.C5.06). Authored customer
// configuration, not a product constant: the wire vocabulary, the action
// mapping and the profile mapping all come from the document. Identical to the
// destination `src/units/W16/C5.unit.test.ts` authors.
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
  profile: {
    journey_stage: { journey: true },
    line_score: { dimension: 'line', value: 'Tabby' },
    top_line: { dimension: 'line' },
  },
};

/**
 * R63's ruled diagnostic, verbatim: coded, and naming no shopper, session,
 * tenant or destination.
 */
const RETENTION_SKIP_WARNING = '[odp] stage projection skipped: profile retention unavailable';

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

// ---------------------------------------------------------------------------
// Host fixture — the real mounted app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts`, `C5.unit.test.ts` and `C6.unit.test.ts`;
// those suites are never imported and never edited.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b8-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const RETENTION_CATEGORIES = ['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'] as const;
const fixtureCategories = (tenants: string[], profile: RetentionPolicy = fixtureRetentionPolicy) =>
  Object.fromEntries(tenants.map(tenant => [tenant,
    Object.fromEntries(RETENTION_CATEGORIES.map(category =>
      [category, category === 'profile' ? profile : fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

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
 * A transient failure of the shopper's own object, installed at the durable-
 * object namespace boundary: a 5xx the object itself answers, an answer the
 * caller cannot read, or a transport error that never reached the object at all.
 * Nothing about the object's stored state changes, which is exactly what makes
 * the failure transient.
 */
type ObjectFault = { match: string; kind: '5xx' | 'throw' | 'unreadable' } | null;

function boundary(host: 'session' | 'do', options: { odp?: boolean } = {}) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const queued: Array<{ record?: Record<string, unknown> }> = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  let fault: ObjectFault = null;
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b8-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SECRETS: `${TENANT}:backend-proof,${OTHER_TENANT}:backend-proof`,
    TENANTS: JSON.stringify({ provisioned: [OTHER_TENANT, TENANT], operatorGrants: { 'w16-b8-operator': [OTHER_TENANT, TENANT] } }),
    ACCOUNTS: memoryStore(),
    ...(options.odp ? { TENANT_CONNECTORS: JSON.stringify({ version: 1, tenants: { [TENANT]: { odp: ODP_CONFIGURATION } } }),
      CONNECTOR_SECRET_MERIDIAN_ODP: 'synthetic-odp-public-key' } : {}),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (message: { record?: Record<string, unknown> }) => { queued.push(message); } },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b8-fixture', note: '', value: fixtureReflexConfig }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([OTHER_TENANT, TENANT]) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* the fixture reports no destination diagnostics */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  /**
   * W16.C5.06: the tenant publishes the NEXT revision of its profile retention
   * policy. Every stamp already written under revision 1 is from that moment
   * unusable (`requireRetention`, `src/retention.ts:96-100`), which is the
   * condition R63 names — the record's own authority, not a broken environment.
   */
  const publishNextProfileRetentionRevision = () => {
    const tenants = JSON.parse(env.TENANTS!).provisioned as string[];
    env.RETENTION = JSON.stringify({ version: 1,
      tenants: fixtureCategories(tenants, { ...fixtureRetentionPolicy, revision: 2 }) });
  };
  const construct = (name: string) => {
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
    return { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (fault && url.includes(fault.match)) {
        if (fault.kind === 'throw') throw new Error('synthetic transport failure reaching the shopper object');
        if (fault.kind === '5xx') return new Response(JSON.stringify({ ok: false, error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        // An answer the caller cannot read: a 200 whose body is not the
        // acknowledgment this call's contract defines.
        return new Response(JSON.stringify({ ok: true, recognized: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      let item = objects.get(name);
      if (!item) { item = construct(name); objects.set(name, item); }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  // R19: the routes production serves, mounted as `src/index.ts` mounts them.
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes); app.route('/v1', identityRoutes);
  const call = async (path: string, options: { capability?: string; body?: unknown; tenant?: string; headers?: Record<string, string>; method?: string } = {}) => {
    await configureRetention();
    const tenant = options.tenant ?? TENANT;
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { 'X-Tenant': tenant, ...(options.capability === undefined ? {} : { [SHOPPER_HEADER]: options.capability }),
        'Content-Type': 'application/json', ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* the fixture never passes through */ }, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, queued, call, drain, configureRetention,
    publishNextProfileRetentionRevision, setFault: (next: ObjectFault) => { fault = next; } };
}

async function fixturePublication(env: Env, tenant: string, continuity: unknown | null) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b8-fixture', note: '', value } });
  const changes: PublicationBaseline[] = [
    baseline(CONTENT_KIND, { pieces: FIXTURE_PIECES }),
    baseline(SLOTS_KIND, FIXTURE_SLOTS),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b8', arms: ['default'] },
      regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} }),
  ];
  const defaults = [baseline(REFLEX_KIND, reflexDocument(continuity), reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }),
    baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b8', arms: ['default'] } })];
  return initializePublicationSet(env,
    defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base),
    '0:' + crypto.randomUUID());
}

/** The claims a shopper capability carries, read without a verifier. */
const claimsOf = (capability: string) => JSON.parse(
  new TextDecoder().decode(Uint8Array.from(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))),
) as { tenant: string; subject: string; sessionId: string; kind: string; grantId?: string; authorityEpoch?: string; iat: number; exp: number };

const setCookies = (response: Response): string[] => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = response.headers.get('set-cookie');
  return single === null ? [] : [single];
};

/** What `POST /realtime/action` answers on either host. */
interface ActionAnswer {
  status: number;
  interestApplied?: unknown;
  dropped?: unknown;
  /**
   * RULED, ABSENT TODAY (R21): the diagnostic that names an input the engine
   * could not place. Unit W16.C8.03 rules it for the live answer; unit
   * W16.C8.09 rules the same member on the buffered answer.
   */
  signals?: { recognized?: unknown; unrecognized?: unknown } | null;
}
interface Hydrate { ok?: unknown; affinity?: { dims?: Record<string, Record<string, number>> } | null; visit?: unknown; journeyStage?: unknown }
interface SnapshotAnswer { status: number; ok: unknown; state: unknown; ranking: Record<string, string[]> }
interface ContinuityReport { enabled?: unknown; reason?: unknown; mode?: unknown; purpose?: unknown; generation?: unknown; expiresAt?: unknown; revision?: unknown; proof?: unknown }
interface SessionAnswer {
  status: number; ok: unknown; subject: string; sessionId: string; kind: unknown; capability: string;
  continuity: ContinuityReport | undefined; cookies: string[]; bodyText: string;
}

async function hostFixture(host: 'session' | 'do', options: { odp?: boolean; continuity?: unknown | null } = {}) {
  invalidateCache(); invalidateLiftCache(); invalidateConfigCache();
  const f = boundary(host, { odp: options.odp });
  await f.configureRetention();
  await fixturePublication(f.env, TENANT, options.continuity ?? null);
  invalidateCache(); invalidateConfigCache();

  const operator = await new jose.SignJWT({ type: 'service', roles: ['admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('w16-b8-operator').setIssuedAt().setIssuer('i').setAudience('a')
    .setExpirationTime('30m').sign(new TextEncoder().encode('w16-b8-synthetic-signing-material-only'));

  /** `POST /v1/:tenant/identity/session` — establish, refresh, or consume a descriptor. */
  const identitySession = async (options: { capability?: string; proof?: string; operationId?: string } = {}): Promise<SessionAnswer> => {
    const body: Record<string, unknown> = {};
    if (options.proof !== undefined || options.operationId !== undefined) {
      body.continuity = { ...(options.proof === undefined ? {} : { proof: options.proof }),
        ...(options.operationId === undefined ? {} : { operationId: options.operationId }) };
    }
    const response = await f.call(`/v1/${TENANT}/identity/session`, {
      body, ...(options.capability === undefined ? {} : { capability: options.capability }) });
    const bodyText = await response.clone().text();
    const parsed = (() => { try { return JSON.parse(bodyText) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
    const session = (parsed.session ?? {}) as Record<string, unknown>;
    await f.drain();
    return { status: response.status, ok: parsed.ok, subject: String(session.subject ?? ''), sessionId: String(session.sessionId ?? ''),
      kind: session.kind, capability: String(session.capability ?? ''), continuity: parsed.continuity as ContinuityReport | undefined,
      cookies: setCookies(response), bodyText };
  };

  /** Her explicit choice, through the route the SDK calls. */
  const choose = async (session: { subject: string; sessionId: string; capability: string }) => {
    const current = f.objects.get(shopperObjectName(TENANT, session.subject))?.data.get('consent');
    const claims = claimsOf(session.capability);
    const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
      grantId: claims.grantId, iat: claims.iat, exp: claims.exp };
    const response = await f.call(`/realtime/session/${session.sessionId}/preferences`, {
      capability: session.capability, body: { trackingConsent: true, personalizationEnabled: true, choice } });
    expect(response.status, await response.clone().text()).toBe(200);
    await f.drain();
  };

  const action = async (capability: string, event: { type: string; data: Record<string, unknown> },
    options: { buffered?: { timestamp: number; browsingSessionId: string } } = {}): Promise<ActionAnswer> => {
    const claims = claimsOf(capability);
    const response = await f.call('/realtime/action', { capability, body: {
      ...event, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId,
      timestamp: options.buffered ? options.buffered.timestamp : Date.now(), eventId: crypto.randomUUID(),
      ...(options.buffered ? { processing: 'buffered', browsingSessionId: options.buffered.browsingSessionId } : {}),
    } });
    const body = await response.clone().json().catch(() => ({})) as
      { interestApplied?: unknown; dropped?: unknown; signals?: ActionAnswer['signals'] };
    await f.drain();
    return { status: response.status, interestApplied: body.interestApplied, dropped: body.dropped, signals: body.signals ?? null };
  };

  const hydrate = async (capability: string): Promise<Hydrate> => {
    const response = await f.call('/realtime/reflex', { capability });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Hydrate;
    await f.drain();
    return body;
  };

  /** The read as it happens in production, including the answer a failure gives. */
  const rawHydrate = async (capability: string) => {
    const response = await f.call('/realtime/reflex', { capability });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text) as Hydrate; } catch { return {} as Hydrate; } })() };
  };

  const snapshot = async (capability: string): Promise<SnapshotAnswer> => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot?page=home`, { capability });
    const body = await response.clone().json().catch(() => ({})) as
      { ok?: unknown; sources?: { state?: unknown }; decisions?: Array<{ slot?: string; contentId?: string }> };
    await f.drain();
    const ranking: Record<string, string[]> = {};
    for (const decision of body.decisions ?? []) (ranking[decision.slot ?? 'unknown-slot'] ??= []).push(decision.contentId ?? 'unknown-content');
    return { status: response.status, ok: body.ok, state: body.sources?.state, ranking };
  };

  /** `POST /v1/:tenant/identity/events` — the warehouse import route (R19). */
  const importRows = async (rows: unknown[]) => {
    const response = await f.call(`/v1/${TENANT}/identity/events`, {
      body: { rows }, headers: { Authorization: `Bearer ${operator}` } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; } })() };
  };

  /** A shopper who has made her explicit choice and browsed, on this host. */
  const newShopper = async (options: { events?: Array<{ type: string; data: Record<string, unknown> }>;
    clock?: { mockReturnValue: (at: number) => unknown }; from?: number } = {}) => {
    const established = await identitySession({});
    expect(established.status, `the fixture's own establish must succeed: ${established.bodyText}`).toBe(200);
    await choose(established);
    const events = options.events ?? THREE_TABBY_VIEWS, from = options.from ?? T0;
    for (const [index, event] of events.entries()) {
      options.clock?.mockReturnValue(from + index * STEP_MS);
      const answered = await action(established.capability, event);
      expect(answered.status, `the fixture's own browsing must be accepted: ${JSON.stringify(event.data.productId ?? event.type)}`).toBe(200);
    }
    options.clock?.mockReturnValue(from + Math.max(0, events.length - 1) * STEP_MS);
    return established;
  };

  return { f, host, operator, identitySession, choose, action, hydrate, rawHydrate, snapshot, importRows, newShopper };
}

/** Both hosts answer the same page, so every assertion names the host it measured. */
const HOSTS = ['session', 'do'] as const;

// ===========================================================================

describe('unit:W16.C6.13', () => {
  it('host: a transient owner-object or transport failure on the continuity consume is reported as its own reason, never as consent, and leaves the still-valid proof consumable by the next successful call, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { continuity: CONTINUITY_DIRECT });
        const her = await h.newShopper({ clock });
        // Her descriptor, issued by her own object on the refresh the SDK makes
        // on every page load (W16.C6.02).
        const issued = await h.identitySession({ capability: her.capability });
        expect(issued.status, `${host}: the fixture's own refresh must succeed: ${issued.bodyText}`).toBe(200);
        const proof = String((issued.continuity ?? {}).proof ?? '');
        expect(proof.length, `${host}: the fixture must hold a real direct-mode recognition proof`).toBeGreaterThan(32);

        // She comes back after her session capability has expired. Her browser
        // presents the proof it stored, under ONE operation id: every attempt
        // below is the SAME consume (W16.C6.05).
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        const operationId = crypto.randomUUID();

        // 1. THE THREE TRANSIENT FAILURES. Each is a failure of the CALL, never
        //    of the shopper's decision: the object's own stored descriptor is
        //    untouched, which clause 3 below proves by consuming it.
        const failures: Array<['5xx' | 'throw' | 'unreadable', string]> = [
          ['5xx', 'the owner object answered 5xx'],
          ['throw', 'the transport threw before the object was reached'],
          ['unreadable', 'the answer could not be read as the consume acknowledgment'],
        ];
        for (const [kind, why] of failures) {
          h.f.setFault({ match: '/identity/continuity/consume', kind });
          const failed = await h.identitySession({ proof, operationId });
          h.f.setFault(null);
          // The page is still served: a failure to recognize is never a failure
          // to answer. `expect.soft` on the three INDEPENDENT ruled demands of
          // this unit, so one run measures all three faults and the recovery
          // below instead of hiding them behind the first; soft does not weaken,
          // the test still fails.
          expect.soft(failed.status, `${host}: ${why} — W16.C6.13 still ANSWERS the shopper: ${failed.bodyText.slice(0, 160)}`).toBe(200);
          expect.soft(failed.ok, `${host}: ${why} — with a well-formed answer`).toBe(true);
          // RULED MEMBER (R21, R62): its own reason. `consent` is a statement
          // about a choice this shopper never made, and it is what makes the
          // SDK destroy a valid proof.
          expect.soft(failed.continuity, `${host}: ${why} — W16.C6.13 reports the distinct unavailable reason, never a consent decision`)
            .toEqual({ enabled: false, reason: 'unavailable' });
        }

        // 2. LIVE CONTROL, the other direction: with the object perfectly
        //    healthy, a proof the engine genuinely cannot place is a COLD
        //    shopper and still reports `consent` (W16.C6.03). Without this the
        //    unit could be passed by renaming every refusal `unavailable`.
        const tampered = proof.slice(0, -4) + (proof.slice(-4) === 'aaaa' ? 'bbbb' : 'aaaa');
        const cold = await h.identitySession({ proof: tampered, operationId: crypto.randomUUID() });
        expect(cold.status, `${host}: a tampered proof is still answered`).toBe(200);
        expect(cold.continuity, `${host}: W16.C6.13 control — a proof the engine cannot place stays the cold-shopper reason`)
          .toEqual({ enabled: false, reason: 'consent' });
        expect(cold.subject, `${host}: and she is a brand-new anonymous subject`).toMatch(/^vis-[0-9a-f-]{36}$/);
        expect((await h.snapshot(cold.capability)).ranking.hero,
          `${host}: served the catalogue's own order, with nobody's remembered taste`).toEqual(HERO_BASE_ORDER);

        // 3. AND THE PROOF IS STILL GOOD. The next successful call — the same
        //    consume, under the same operation id — recognizes her, rotates to
        //    the next generation of her own chain, and her remembered taste
        //    ranks the page. This is the whole point of R62: a transient
        //    failure must cost nothing.
        const recovered = await h.identitySession({ proof, operationId });
        expect(recovered.status, `${host}: the retry after the outage is answered`).toBe(200);
        expect(recovered.subject, `${host}: W16.C6.13 — the transient failures consumed nothing, so the same proof still recognizes her`)
          .toBe(her.subject);
        expect((recovered.continuity ?? {}).enabled, `${host}: with a live descriptor`).toBe(true);
        expect((recovered.continuity ?? {}).generation, `${host}: rotated exactly once, by the one consume that reached the object`).toBe(2);
        expect((await h.snapshot(recovered.capability)).ranking.hero,
          `${host}: and her remembered Tabby interest ranks her page`).toEqual([TABBY, ROGUE]);
      }
    } finally { clock.mockRestore(); }
  });

  it('sdk: the real SDK entry keeps the stored proof and its operation id when the engine reports the continuity call unavailable, presents the same consume on the next load, and clears the proof only on a decision about the shopper', async () => {
    const endpoint = 'https://engine.example';
    const tenant = 'coach';
    const proof = 'w16b8-direct-recognition-proof-0000000000000000.signature-0000000000000000';
    const rotated = 'w16b8-direct-recognition-proof-1111111111111111.signature-1111111111111111';

    /** A browser whose storage this test can read, driven the way `memoryHost` is normally driven. */
    const browser = (answers: Array<Record<string, unknown>>) => {
      const store = new Map<string, string>();
      const calls: Array<{ url: string; body: { continuity?: { proof?: unknown; operationId?: unknown } } }> = [];
      let clock = T0, uuids = 0, sessions = 0, answered = 0;
      const host = memoryHost({
        acquireAuthorityLock: authorityLocks(),
        now: () => clock,
        uuid: () => `0f0f0f0f-1111-4222-8333-${String(++uuids).padStart(12, '0')}`,
        storage: { get: key => store.get(key) ?? null, set: (key, value) => { store.set(key, value); } },
        location: { href: 'https://shop.example/home', host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '' },
        referrer: '',
        fetch: async (url, init) => {
          const body = (() => { try { return JSON.parse(init?.body ?? '{}') as Record<string, unknown>; } catch { return {}; } })();
          calls.push({ url, body: body as { continuity?: { proof?: unknown; operationId?: unknown } } });
          if (!url.endsWith('/identity/session')) return { ok: true, status: 200, json: async () => ({ success: true }) };
          const n = (++sessions).toString(16).padStart(12, '0');
          const claims = { tenant, subject: `vis-00000000-0000-4000-8000-${n}`, sessionId: `s-00000000-0000-4000-8000-${n}`,
            kind: 'anonymous', grantId: `00000000-0000-4000-8000-${n}`, authorityEpoch: `10000000-0000-4000-8000-${n}`,
            iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600 };
          const choice = (value: boolean) => ({ value, chosenAt: clock, expiresAt: clock + 30 * 86400 * 1000 });
          const session = { ...claims, consent: { tracking: true, personalization: true,
            instruction: { version: 1, tenant, subject: claims.subject, revision: 'w16-b8-explicit',
              tracking: choice(true), personalization: choice(true) } },
            capability: `ss1.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}.AA` };
          const continuity = answers[Math.min(answered++, answers.length - 1)];
          return { ok: true, status: 200, json: async () => ({ ok: true, session, continuity }) };
        },
      });
      return { host, store, calls };
    };

    const key = sdkContinuityKey(endpoint, tenant), operationKey = sdkContinuityOperationKey(endpoint, tenant);
    const issuedReport = (value: string) => ({ enabled: true, mode: 'direct', purpose: PURPOSE, generation: 2,
      expiresAt: T0 + WINDOW_MS, revision: 1, proof: value });

    // The outage: the engine could not reach the shopper's own object, says so
    // by its own reason, and the browser's still-valid proof is not the
    // engine's to destroy (R62).
    const outage = browser([{ enabled: false, reason: 'unavailable' }, issuedReport(rotated)]);
    outage.store.set(key, proof);
    const first = createCore({ tenant, endpoint }, outage.host);
    expect(await first.ready(), 'the SDK adopted the session the engine answered').toBe(true);
    const presented = outage.calls.filter(call => call.url.endsWith('/identity/session'));
    expect(presented.length, 'the returning browser presented its proof once').toBe(1);
    expect(presented[0]!.body.continuity?.proof, 'and it presented the stored proof').toBe(proof);
    const operationId = String(presented[0]!.body.continuity?.operationId ?? '');
    expect(operationId, 'under an operation id the engine can key its one receipt by').toMatch(UUID);
    // `expect.soft` on the independent ruled demands, so one run measures the
    // kept proof, the kept operation id and the next load's retry together.
    expect.soft(outage.store.get(key),
      'W16.C6.13: the SDK keeps the recognition proof when the engine reports the continuity call unavailable').toBe(proof);
    expect.soft(outage.store.get(operationKey),
      'W16.C6.13: and it keeps the operation id, so the next attempt is the SAME consume (W16.C6.05), not a second one')
      .toBe(operationId);

    // The next page load, with the engine healthy: the same consume, then the
    // rotated proof is stored.
    const next = createCore({ tenant, endpoint }, outage.host);
    expect(await next.ready(), 'the next load adopts a session').toBe(true);
    const retried = outage.calls.filter(call => call.url.endsWith('/identity/session'))[1]!;
    expect.soft(retried.body.continuity?.proof, 'W16.C6.13: the next load presents the same kept proof').toBe(proof);
    expect.soft(retried.body.continuity?.operationId, 'W16.C6.13: as the same consume, under the same operation id').toBe(operationId);
    // LIVE CONTROL on the same store: a successful answer DOES replace what she
    // holds, so "keeps it" above is a property of the unavailable reason and not
    // of an SDK that never writes.
    expect(outage.store.get(key), 'W16.C6.13 control — a successful answer replaces the stored proof with the rotated one').toBe(rotated);

    // LIVE CONTROL: a decision about the SHOPPER — the engine placed nobody —
    // still clears what she holds, because a proof this engine will not
    // recognize is a token nobody should keep. Without this control an
    // implementation could simply never clear.
    for (const reason of ['consent', 'unpublished', 'incomplete'] as const) {
      const decided = browser([{ enabled: false, reason }]);
      decided.store.set(key, proof);
      decided.store.set(operationKey, '0f0f0f0f-1111-4222-8333-000000000099');
      const core = createCore({ tenant, endpoint }, decided.host);
      expect(await core.ready(), `the SDK adopted the session answered beside reason ${reason}`).toBe(true);
      expect(decided.store.get(key) ?? '', `W16.C6.13 control — reason ${reason} is a decision about the shopper, so the proof is cleared`).toBe('');
      expect(decided.store.get(operationKey) ?? '', `W16.C6.13 control — and so is the operation id (reason ${reason})`).toBe('');
    }
  });
});

// ===========================================================================

describe('unit:W16.C5.06', () => {
  it('host: a stage-moving read whose stored profile-retention stamp is unusable answers the read, sends nothing to the destination and emits the coded non-identifying warn, while a usable stamp on the same read sends the projection, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const network = installNetwork();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* captured, never printed */ });
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { odp: true });
        const her = await h.newShopper({ clock });
        const vuid = await connectorIdentity(TENANT, ODP_NAMESPACE, her.subject);

        // 1. LIVE CONTROL, first, on the same shopper and the same read: with a
        //    USABLE stamp the stage-moving read DOES send the projection. R63's
        //    absence below is a property of the unusable stamp, not of a dead
        //    destination (W16.C5.02 rules the payload; this unit rules the skip).
        const beforeControl = network.calls.length;
        clock.mockReturnValue(T0 + 2 * STEP_MS + VISIT_GAP_MS + 1);
        const control = await h.rawHydrate(her.capability);
        expect(control.status, `${host}: the stage-moving read with a usable stamp answers`).toBe(200);
        expect(odpSince(network.calls, beforeControl).map(call => `${call.method} ${call.path}`),
          `${host}: W16.C5.06 control — with a usable stamp the stage-moving read sends the stage projection`)
          .toEqual(['POST /v3/profiles']);

        // 2. The stamp her record was born with becomes unusable: the tenant
        //    publishes the next revision of its profile retention policy, so
        //    every stamp written under the previous one no longer matches the
        //    authority in force (`requireRetention`, src/retention.ts:96-100).
        h.f.publishNextProfileRetentionRevision();
        const mark = network.calls.length;
        warn.mockClear();
        clock.mockReturnValue(T0 + 2 * STEP_MS + 2 * VISIT_GAP_MS + 2);
        const answered = await h.rawHydrate(her.capability);

        // R63, clause by clause.
        expect.soft(answered.status,
          `${host}: W16.C5.06 — an unusable profile-retention stamp still ANSWERS the read: ${answered.text.slice(0, 200)}`).toBe(200);
        expect.soft(answered.body.ok, `${host}: W16.C5.06 — with the read's own answer`).toBe(true);
        expect.soft(odpSince(network.calls, mark).map(call => `${call.method} ${call.path}`),
          `${host}: W16.C5.06 — and nothing at all is said to the destination`).toEqual([]);
        // The coded diagnostic, in exactly the words R63 rules, emitted once.
        const warned = warn.mock.calls.map(args => args.map(String).join(' '));
        expect.soft(warned.filter(text => text === RETENTION_SKIP_WARNING),
          `${host}: W16.C5.06 — the skip is reported once, in the coded words R63 rules (saw: ${JSON.stringify(warned)})`)
          .toEqual([RETENTION_SKIP_WARNING]);
        // …and identifying nobody. Scanned with a control source that DOES
        // carry each identifier, so the scan is proven to have teeth instead of
        // being assumed (the `sightings` idiom of `C6.unit.test.ts`).
        for (const [what, secret] of [['shopper', her.subject], ['session', her.sessionId], ['destination id', vuid]] as const) {
          const sources = [...warned.map((text, index) => ({ name: `warn ${index}`, text })), { name: 'control', text: secret }];
          expect.soft(sources.filter(source => source.text.includes(secret)).map(source => source.name),
            `${host}: W16.C5.06 — the diagnostic names no ${what}`).toEqual(['control']);
        }
      }
    } finally { warn.mockRestore(); network.restore(); clock.mockRestore(); }
  });
});

// ===========================================================================

describe('unit:W16.C8.09', () => {
  it('host: a buffered action applies the catalogue vocabulary — an out-of-vocabulary value on a named dimension builds no taste, a placed value builds its age-decayed interest, and the buffered answer names the product reference it could not place, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // Her live visit, which is what gives both hosts a profile for a
        // buffered delivery to be applied to at all.
        const her = await h.newShopper({ clock });
        const live = await h.hydrate(her.capability);
        const liveValues = valuesOf(live.affinity?.dims);
        expect(liveValues.line, `${host}: the fixture's own live visit built her Tabby interest`).toEqual(['Tabby']);

        // The late arrival: one page she looked at a week ago, delivered now,
        // explicitly buffered, carrying its own original time and the browsing
        // session it belongs to (HANDOFF §7, D06-buffered-action-purpose).
        const arrival = T0 + 3 * STEP_MS, occurredAt = T0 - LATE_BY_MS;
        clock.mockReturnValue(arrival);
        const buffered = await h.action(her.capability, BUFFERED_MIXED_VIEW,
          { buffered: { timestamp: occurredAt, browsingSessionId: LATE_BROWSING_SESSION } });
        expect(buffered.status, `${host}: a buffered delivery is accepted — her traffic is not refused`).toBe(200);
        expect(buffered.dropped ?? 'accepted', `${host}: accepted, with no refusal reason`).toBe('accepted');
        expect(buffered.interestApplied, `${host}: and it contributes interest`).toBe(true);

        const after = await h.hydrate(her.capability);
        const afterValues = valuesOf(after.affinity?.dims);

        // 1. R64, PER VALUE, on the buffered path. `Rogue` and `festival` are
        //    values this tenant's published catalogue names, so they build
        //    taste; `Home Fragrance` is a value on a dimension the catalogue
        //    names and does not name, so it builds none. The `line` and
        //    `occasion` halves of these two equalities are the live control:
        //    placed values still build taste beside the refused one.
        expect.soft(afterValues.category,
          `${host}: W16.C8.09 — a buffered category this tenant's catalogue does not name builds no taste on the named dimension`)
          .toEqual(liveValues.category);
        expect.soft(afterValues.line,
          `${host}: W16.C8.09 control — the buffered line the catalogue names does build taste, beside her live one`)
          .toEqual(['Rogue', 'Tabby']);
        expect.soft(afterValues.occasion,
          `${host}: W16.C8.09 control — and so does the buffered occasion the catalogue names`)
          .toEqual([...new Set([...(liveValues.occasion ?? []), 'festival'])].sort());

        // 2. AGE-DECAYED, not live. The engine's own closed form for a touch of
        //    this action's weight at the moment it happened, read a week later
        //    (`applyHistorical`, src/reflex/identityMerge.ts; `snapshot`,
        //    src/reflex/core.ts) — the settled buffered decision, HANDOFF §7.
        const decayed = reflexSnapshot(
          applyHistorical(undefined, { action: 'product_view', touches: [{ dim: 'line', value: 'Rogue' }] }, occurredAt, fixtureReflexConfig),
          arrival, fixtureReflexConfig).dims.line?.Rogue;
        const asIfLive = reflexSnapshot(
          applyHistorical(undefined, { action: 'product_view', touches: [{ dim: 'line', value: 'Rogue' }] }, arrival, fixtureReflexConfig),
          arrival, fixtureReflexConfig).dims.line?.Rogue;
        expect(decayed! < asIfLive!, 'the fixture measures a real discount: a week-old touch is worth less than a live one').toBe(true);
        expect.soft(after.affinity?.dims?.line?.Rogue,
          `${host}: W16.C8.09 — the placed buffered value builds exactly its age-decayed interest`).toBeCloseTo(decayed!, 6);
        expect.soft(after.affinity?.dims?.line?.Tabby,
          `${host}: W16.C8.09 — and her live memory is untouched by the arrival`).toBeCloseTo(live.affinity?.dims?.line?.Tabby ?? -1, 6);

        // 3. RULED MEMBER (R21): the buffered answer carries the same
        //    diagnostic the live answer carries (W16.C8.03), naming every
        //    product reference the engine could not place. The event is still
        //    RECOGNIZED, because two of its values built taste.
        expect.soft(buffered.signals,
          `${host}: W16.C8.09 — the buffered answer names the product reference the engine could not place`)
          .toEqual({ recognized: true, unrecognized: [BUFFERED_UNPLACEABLE_ID] });

        // 4. LIVE CONTROL beside 3, on the same path: a buffered delivery for a
        //    product the published catalogue names reports no unplaceable
        //    reference. Without it, echoing every id would pass.
        clock.mockReturnValue(arrival + STEP_MS);
        const named = await h.action(her.capability, BUFFERED_NAMED_VIEW,
          { buffered: { timestamp: occurredAt + STEP_MS, browsingSessionId: LATE_BROWSING_SESSION } });
        expect(named.status, `${host}: the second buffered delivery is accepted`).toBe(200);
        expect.soft(named.signals,
          `${host}: W16.C8.09 control — a buffered product the published catalogue names is named nowhere as unrecognized`)
          .toEqual({ recognized: true, unrecognized: [] });
      }
    } finally { clock.mockRestore(); }
  });
});

// ===========================================================================

describe('unit:W16.C8.10', () => {
  it('host: content telemetry and historical import apply the same catalogue vocabulary — an out-of-vocabulary value on a named dimension builds no taste, a placed value does, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        const her = await h.newShopper({ clock, events: [VIEW_TABBY_QUILTED_HANDBAG] });
        const start = valuesOf((await h.hydrate(her.capability)).affinity?.dims);
        expect(start.category, `${host}: her live view built the category her catalogue names`).toEqual(['Handbags']);
        expect(start.line, `${host}: and the line it names`).toEqual(['Tabby']);

        // --- Content telemetry (src/reflex/contentTelemetry.ts:96) ----------
        // A content interaction is not a product, so its attributes reach the
        // registry directly. That path never asked the catalogue anything.
        clock.mockReturnValue(T0 + STEP_MS);
        const unnamed = await h.action(her.capability, CONTENT_CLICK_UNNAMED_CATEGORY);
        expect(unnamed.status, `${host}: the content interaction is accepted — her traffic is not refused`).toBe(200);
        expect.soft(valuesOf((await h.hydrate(her.capability)).affinity?.dims).category,
          `${host}: W16.C8.10 — a content event carrying a category this tenant's catalogue does not name builds no taste on it`)
          .toEqual(['Handbags']);

        // LIVE CONTROL on the same path: a category the catalogue DOES name
        // builds taste, so the absence above is the vocabulary and not a dead
        // content path.
        clock.mockReturnValue(T0 + 2 * STEP_MS);
        const namedContent = await h.action(her.capability, CONTENT_CLICK_NAMED_CATEGORY);
        expect(namedContent.status, `${host}: the second content interaction is accepted`).toBe(200);
        expect.soft(valuesOf((await h.hydrate(her.capability)).affinity?.dims).category,
          `${host}: W16.C8.10 control — a content event carrying a category the catalogue names does build taste`)
          .toEqual(['Accessories', 'Handbags']);

        // --- Historical import (src/identity/history.ts:146) ----------------
        // Two warehouse rows for the same browser, in one request: one line the
        // catalogue does not name, one it does. R19: the public route the
        // warehouse posts to, `POST /v1/:tenant/identity/events`.
        clock.mockReturnValue(T0 + 3 * STEP_MS);
        const imported = await h.importRows([
          { visitorId: her.subject, action: 'purchase', at: T0 - 2 * DAY_MS, product: { line: IMPORT_UNNAMED_LINE } },
          { visitorId: her.subject, action: 'purchase', at: T0 - 2 * DAY_MS, product: { line: IMPORT_NAMED_LINE } },
        ]);
        expect(imported.status, `${host}: the fixture's own import must be accepted: ${imported.text.slice(0, 300)}`).toBe(200);
        expect(imported.body.ok, `${host}: with a well-formed report`).toBe(true);

        const afterImport = valuesOf((await h.hydrate(her.capability)).affinity?.dims);
        expect.soft(afterImport.line,
          `${host}: W16.C8.10 — an imported row carrying a line this tenant's catalogue does not name builds no taste on it, and the row that names one does`)
          .toEqual([IMPORT_NAMED_LINE, 'Tabby'].sort());
        // The import really reached her profile — otherwise the absence above
        // would be vacuous. The placed row is the live control, measured as its
        // own positive number.
        expect.soft(afterImport.line?.includes(IMPORT_NAMED_LINE),
          `${host}: W16.C8.10 control — the imported row the catalogue names did reach her profile`).toBe(true);
      }
    } finally { clock.mockRestore(); }
  });
});

// ===========================================================================

describe('unit:W16.C2.16', () => {
  it('sdk: the real SDK entry reads utm_term from the page URL and carries it to the engine at the bound, drops a term beyond the bound before anything is sent, and the engine itself refuses an over-bound term rather than truncating it', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      // One real engine behind the browser: the mounted app, the real identity
      // and action routes, the real ShopperReflex. The SDK talks to it at the
      // fetch boundary and nothing is simulated between them.
      const h = await hostFixture('session');

      /** A browser on a campaign landing page, driving the real `src/sdk` entry. */
      const landing = async (search: string) => {
        const sent: Array<{ url: string; body: string; status: number }> = [];
        let capability = '', subject = '', sessionId = '';
        const host = memoryHost({
          acquireAuthorityLock: authorityLocks(),
          now: () => Date.now(), uuid: () => crypto.randomUUID(),
          location: { href: `https://shop.example/home${search}`, host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search },
          referrer: '',
          fetch: async (url, init) => {
            const body = init?.body ?? '';
            const parsed = (() => { try { return body ? JSON.parse(body) as unknown : undefined; } catch { return undefined; } })();
            const target = new URL(url);
            const bearer = (init?.headers as Record<string, string> | undefined)?.[SHOPPER_HEADER] ?? capability;
            const response = await h.f.call(target.pathname + target.search,
              { method: init?.method ?? 'GET', body: parsed, ...(bearer ? { capability: bearer } : {}) });
            sent.push({ url, body, status: response.status });
            const text = await response.clone().text();
            const json = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
            const session = (json?.session ?? {}) as { capability?: unknown; subject?: unknown; sessionId?: unknown };
            if (typeof session.capability === 'string' && session.capability) {
              capability = session.capability;
              subject = String(session.subject ?? subject); sessionId = String(session.sessionId ?? sessionId);
            }
            return { ok: response.ok, status: response.status, json: async () => json };
          },
        });
        // Page one: the browser meets the engine and the shopper makes her
        // explicit choice, through the route the kit documents
        // (`POST /realtime/session/:sessionId/preferences`). Without a current
        // explicit choice the SDK observes nothing at all, which is the
        // engine's consent posture and not this unit's subject.
        const opening = createCore({ tenant: TENANT, endpoint: 'https://synthetic.invalid', source: 'sdk' }, host);
        expect(await opening.ready(), 'the SDK must establish a session').toBe(true);
        const chosen = await h.f.call(`/realtime/session/${sessionId}/preferences`, { capability, body: {
          trackingConsent: true, personalizationEnabled: true,
          choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: claimsOf(capability).grantId,
            iat: claimsOf(capability).iat, exp: claimsOf(capability).exp } } });
        expect(chosen.status, `the fixture's own explicit choice must succeed: ${await chosen.clone().text()}`).toBe(200);
        await h.f.drain();
        // Page two: the campaign landing page itself, a cold start of the real
        // SDK entry over the same browser storage.
        const mark = sent.length;
        const core = createCore({ tenant: TENANT, endpoint: 'https://synthetic.invalid', source: 'sdk' }, host);
        expect(await core.ready(), `the SDK must resume the session for ${search.slice(0, 40)}`).toBe(true);
        expect(core.trackingAllowed, 'and the shopper her explicit choice authorizes is the one it observes').toBe(true);
        return { core, sent, landingCalls: () => sent.slice(mark), subject: () => subject, capability: () => capability };
      };

      // 1. AT THE BOUND. The keyword the campaign declared is what the shopper
      //    typed; the engine's slots may publish a contextual seed rule for it
      //    (W16.C3.01-.09). The SDK reads it off the page URL and carries it
      //    verbatim — never trimmed, because a truncated keyword is a DIFFERENT
      //    keyword (R30(3), the rule unit W16.C3.09 states).
      const atBound = 'tabby-handbag-' + 'x'.repeat(ENTRY_TERM_LIMIT - 'tabby-handbag-'.length);
      expect(atBound.length, 'the fixture term is exactly at the published bound').toBe(ENTRY_TERM_LIMIT);
      const carried = await landing(`?utm_medium=cpc&utm_source=google&utm_term=${encodeURIComponent(atBound)}`);
      expect(carried.core.entry.utmTerm,
        'W16.C2.16: the real SDK entry reads the campaign keyword off the page URL').toBe(atBound);
      await carried.core.send('product_view', { productId: 'COA-CW620', line: 'Tabby', category: 'Handbags' });
      await h.f.drain();
      const actions = carried.sent.filter(call => new URL(call.url).pathname === DEFAULT_PATHS.action);
      expect(actions.length, 'the SDK sent the action to the engine').toBe(1);
      expect(actions[0]!.status, 'and the engine accepted the arrival it carried').toBe(200);
      const wire = JSON.parse(actions[0]!.body) as { entry?: { utmTerm?: unknown; utmMedium?: unknown; utmSource?: unknown; siteHost?: unknown } };
      expect(wire.entry?.utmTerm,
        'W16.C2.16: and sends it to the engine as the entry term, verbatim, at the bound').toBe(atBound);
      expect(wire.entry?.utmMedium, 'beside the rest of the arrival it observed').toBe('cpc');
      expect(wire.entry?.utmSource, 'beside the rest of the arrival it observed').toBe('google');

      // 2. BEYOND THE BOUND. One character more and the term never reaches the
      //    wire at all — the browser drops it before sending, and the REST of
      //    the arrival still travels, so an overlong keyword costs the keyword
      //    only.
      const beyond = 'tabby-handbag-' + 'x'.repeat(ENTRY_TERM_LIMIT + 1 - 'tabby-handbag-'.length);
      expect(beyond.length, 'the fixture term is one character beyond the bound').toBe(ENTRY_TERM_LIMIT + 1);
      const dropped = await landing(`?utm_medium=cpc&utm_source=google&utm_term=${encodeURIComponent(beyond)}`);
      await dropped.core.send('product_view', { productId: 'COA-CW620', line: 'Tabby', category: 'Handbags' });
      await h.f.drain();
      const overActions = dropped.sent.filter(call => new URL(call.url).pathname === DEFAULT_PATHS.action);
      expect(overActions.length, 'the SDK still sent the action').toBe(1);
      const overWire = JSON.parse(overActions[0]!.body) as { entry?: Record<string, unknown> };
      expect(Object.keys(overWire.entry ?? {}).sort(),
        'W16.C2.16: the rest of the arrival still travels, with no keyword field at all')
        .toEqual(['referrer', 'siteHost', 'utmMedium', 'utmSource']);
      // Scanned across every request the browser made, with a control source
      // that DOES contain the term, so the scan is proven to have teeth.
      const sources = [...dropped.sent.map((call, index) => ({ name: `request ${index}`, text: call.url + ' ' + call.body })),
        { name: 'control', text: beyond }];
      expect(sources.filter(source => source.text.includes(beyond)).map(source => source.name),
        'W16.C2.16: an over-bound keyword reaches the wire nowhere').toEqual(['control']);

      // 3. AND THE ENGINE REFUSES IT ANYWAY. The browser's drop is not the only
      //    protection: an admitted caller that sends an over-bound term is
      //    refused by the route's own documented refusal, never truncated into
      //    a keyword the arrival is not evidence for (W16.C3.09, R46(a)/R59 —
      //    the merged C3.09 unit measures the same 400 on the snapshot route).
      const claims = claimsOf(carried.capability());
      const refused = await h.f.call('/realtime/action', { capability: carried.capability(), body: {
        type: 'product_view', data: { productId: 'COA-CW620', line: 'Tabby' }, source: 'sdk',
        userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
        entry: { utmMedium: 'cpc', utmSource: 'google', utmTerm: beyond, referrer: '', siteHost: 'shop.example' },
      } });
      expect(refused.status, 'W16.C2.16: the engine refuses an over-bound campaign term rather than trimming it').toBe(400);
      // The live control on the same route, the same shopper and the same
      // arrival: at the bound it is accepted.
      const accepted = await h.f.call('/realtime/action', { capability: carried.capability(), body: {
        type: 'product_view', data: { productId: 'COA-CW620', line: 'Tabby' }, source: 'sdk',
        userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID(),
        entry: { utmMedium: 'cpc', utmSource: 'google', utmTerm: atBound, referrer: '', siteHost: 'shop.example' },
      } });
      expect(accepted.status, 'W16.C2.16 control — the same arrival at the bound is accepted').toBe(200);
      await h.f.drain();
    } finally { clock.mockRestore(); }
  });
});
