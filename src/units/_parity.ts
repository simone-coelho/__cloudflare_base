// src/units/_parity.ts
// The shared harness of the `tapestry-parity-build` unit files (src/units/P**):
// the routes production serves, mounted as `src/index.ts` mounts them, over the
// REAL Durable Object classes (ShopperReflex, DecisionRing, LearnStats) with
// in-memory storage stubs, on either shopper host (`REFLEX_HOST` session or do),
// in the idiom of src/units/W26/LEDGER.unit.test.ts, src/units/W28/LEDGER.unit.test.ts
// and src/units/W20/B1.unit.test.ts (none of them is imported: importing a
// `.test.ts` registers its whole suite twice).
//
// It holds no expected value of any ticket. It publishes what a ticket file hands
// it, drives the shopper and the operator through the mounted routes, and reads
// back what the platform answers. Documents are read from the tree this file
// lives in (`import.meta.url`), never from the working directory.
//
// THE ONE REPRESENTATION THE PARITY TICKETS SHARE (P02, P01, P03, P10):
//   · a module is a catalogue piece (`id`, `type` = its kind, `journeyStageFit`),
//     naming the layout slot in its `slotTypes`;
//   · the slots document declaring a layout slot is marked `governanceVersion: 4`
//     and the slot carries `layout: true`;
//   · every render acknowledgement and engagement carries `position` = the
//     decision's page-wide `order` and `slotPosition` = its position within its
//     slot (P03 decision D3).

import { readFileSync } from 'node:fs';

import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import { SignJWT } from 'jose';
import { expect } from 'vitest';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import type { DecisionRecord } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { newAnonymousSession, SHOPPER_HEADER, verifySessionCapability } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions } from '@/ledger/enqueue';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { configRoutes } from '@/routes/config';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

export const TENANT = 'coach';
export const BRAND = 'coach';
export type Host = 'session' | 'do';
export const HOSTS: readonly Host[] = ['session', 'do'];
const OPERATOR_SECRET = 'parity-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const DAY_MS = 86_400_000;

/** The checkout this file lives in, whatever the working directory (the 2026-09-20 W29-B1 lesson). */
const ROOT = new URL('../../', import.meta.url);
export const readTree = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

// ---------------------------------------------------------------------------
// The customer's events (docs/kit/03-payload-schemas.md:19): rows of Coach's own
// catalogue (src/data/coach-catalog.json), as src/units/W16/C8.unit.test.ts quotes them.
// ---------------------------------------------------------------------------

export const productView = (data: Record<string, unknown>) => ({ type: 'product_view', data });
/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting · Handbags. */
export const VIEW_TABBY_QUILTED = productView({ productId: 'COA-CW620', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['evening', 'date-night', 'special-occasion'], price_usd: 575 });
/** COA-CH857 · Tabby Shoulder Bag 26 · Handbags. */
export const VIEW_TABBY_26 = productView({ productId: 'COA-CH857', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['work', 'everyday', 'evening'], price_usd: 475 });
/** COA-CY201 · Tabby Shoulder Bag 20 · Handbags. */
export const VIEW_TABBY_20 = productView({ productId: 'COA-CY201', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['everyday', 'evening', 'date-night'], price_usd: 375 });
/** COA-CB925 · Tabby Wallet With Chain · Small Leather Goods: the cross-category fourth view. */
export const VIEW_TABBY_WALLET = productView({ productId: 'COA-CB925', line: 'Tabby', category: 'Small Leather Goods', subcategory: 'Wallets',
  silhouette: 'chain wallet', occasion: ['evening', 'date-night', 'everyday'], price_usd: 250 });
export const TABBY_VIEWS = [VIEW_TABBY_QUILTED, VIEW_TABBY_26, VIEW_TABBY_20, VIEW_TABBY_WALLET];
/** A page view: an action the shipped tuning weighs at 0 (`src/reflex/core.ts:221-244` names no weight for it). */
export const PAGE_VIEW = { type: 'page_view', data: { path: '/products/tabby-shoulder-bag-26' } };

/** Arrivals the engine classifies (`src/services/visit.ts`): an Instagram paid-social click and a direct visit. */
export const PAID_SOCIAL_ENTRY = { utmMedium: 'paid_social', utmSource: 'instagram' };
export const DIRECT_ENTRY = { referrer: '', siteHost: 'www.coach.com' };

/** The tenant's published registry: the bundled default, scoring the attributes the customer's own events carry, with a journey threshold set. */
export const REFLEX_DOCUMENT = { ...DEFAULT_REFLEX_CONFIG, version: 'parity-coach-registry', eventAttributes: 'event-when-unknown' as const,
  journey: { stages: [{ stage: 'thinking', anyOf: { interactions: 3 } }, { stage: 'deciding', anyOf: { purchases: 1 } }] } };

// ---------------------------------------------------------------------------
// The customer's product page (parity §3.3): the modules below the gallery,
// with synthetic identifiers in the `module.PDP.<kind>.<n>` shape, registered as
// catalogue pieces by identifier, kind (`type`) and journey stages
// (`journeyStageFit`, Tapestry's words). CATALOGUE ORDER IS PART OF EVERY
// EXPECTED ANSWER: it is today's page order, and the excluded, ineligible and
// reserved modules are interleaved early so that a slot which failed to drop one
// would show it inside the first K. Unknown and cross-category inputs are part of
// the fixture: `module.PDP.ugc.1` is tagged only on a dimension no registry maps,
// `module.PDP.grid.1` spans two categories.
// ---------------------------------------------------------------------------

export const LAYOUT = 'pdp-modules';
export const RECENT_SLOT = 'pdp-recent';
export const M = {
  grid: 'module.PDP.grid.1', reviews: 'module.PDP.reviews.1', reco1: 'module.PDP.reco.1', lookbook: 'module.PDP.lookbook.1',
  recent: 'module.PDP.recent.1', reco2: 'module.PDP.reco.2', editorial: 'module.PDP.editorial.1', ugc: 'module.PDP.ugc.1',
  charms: 'module.PDP.charms.1',
} as const;

const moduleOf = (id: string, kind: string, title: string, stages: string[], tags: Record<string, string[]>, over: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `TAP-${id.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type: kind, title, tags,
    slotTypes: [LAYOUT], journeyStageFit: stages, lifecycle: { status: 'live' }, ...over });

/** The registered modules, in catalogue order. */
export const MODULES = [
  moduleOf(M.grid, 'category-grid', 'A grid of broad categories', ['exploring'], { category: ['Handbags', 'Small Leather Goods'] }),
  /** Excluded by the layout slot's own `excludedPieceIds`. */
  moduleOf(M.reviews, 'reviews', 'Reviews and fit', ['deciding'], { category: ['Handbags'] }),
  moduleOf(M.reco1, 'recommendations', 'We think you would like this', ['considering', 'deciding'], { line: ['Willow'] }),
  /** Ineligible: expired. */
  moduleOf(M.lookbook, 'editorial', 'Last season’s lookbook', ['exploring'], { line: ['Tabby'] }, { lifecycle: { status: 'expired' } }),
  /** Already served on the page: the pinned piece of the recently-viewed slot, reserved page-wide before any ranking. */
  moduleOf(M.recent, 'recently-viewed', 'Recently viewed', ['considering', 'deciding'], {}, { slotTypes: [LAYOUT, RECENT_SLOT] }),
  moduleOf(M.reco2, 'complete-the-look', 'Complete the look', ['considering'], { line: ['Tabby'], occasion: ['evening'] }),
  moduleOf(M.editorial, 'editorial', 'A styling story', ['exploring', 'considering'], { line: ['Tabby'] }),
  /** Unknown input: tagged only on a dimension the tenant's registry does not map. */
  moduleOf(M.ugc, 'user-generated', 'Seen on you', ['considering'], { styleWorld: ['downtown'] }),
  /** Ineligible: its publish window has closed. */
  moduleOf(M.charms, 'editorial', 'The charms edit', ['exploring'], { line: ['Tabby'] }, { window: { from: '2019-01-01T00:00:00.000Z', to: '2020-01-01T00:00:00.000Z' } }),
];

/** The page's declared layout slot: K = 4 positions over the registered modules. */
export const layoutSlot = (over: Record<string, unknown> = {}) => ({ slot: LAYOUT, take: 4, layout: true,
  weights: { line: 1, category: 0.5, occasion: 0.5 }, excludedPieceIds: [M.reviews], ...over });
/** The recently-viewed slot further down the page, pinned to its own module. */
export const recentSlot = (over: Record<string, unknown> = {}) => ({ slot: RECENT_SLOT, take: 1, weights: {}, pinnedPieceIds: [M.recent], ...over });
/** A slots document declaring the layout slot under the governance version that introduces the declaration. */
export const declaredSlots = (pdp: unknown[], extra: Record<string, unknown> = {}) => ({ version: 'parity-coach-slots', governanceVersion: 4, ...extra, pages: { pdp } });
/** The learn document: no holdout, the regional prior off, and the layout slot measured on rendered-v1 (P02 decision D1). */
export const learnDocument = (slots: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ version: 'parity-coach-learn',
  holdout: { share: 0, salt: 'parity', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 },
  ...extra, slots: { [LAYOUT]: { measurementBasis: 'rendered-v1', reward: 'click' }, ...slots } });

// ---------------------------------------------------------------------------
// Bindings: the in-memory doubles the repository's own boundary suites use.
// ---------------------------------------------------------------------------

export class UnitKV {
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

export class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  /** P98 R10 (R-P551): each object's UTF-8 bytes, held while its stored string is the same one (a test may set `objects` directly). */
  private encoded = new Map<string, { raw: string; bytes: Uint8Array }>();
  private bytesOf(key: string, raw: string): Uint8Array {
    const held = this.encoded.get(key);
    if (held && held.raw === raw) return held.bytes;
    const bytes = new TextEncoder().encode(raw); this.encoded.set(key, { raw, bytes }); return bytes;
  }
  async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    if (options?.range) {
      // P98 R10 (R-P551): R2's ranged read — `size` the whole object's, the body the range's bytes alone.
      const all = this.bytesOf(key, raw), range = options.range;
      const offset = range.suffix !== undefined ? Math.max(0, all.length - range.suffix) : range.offset ?? 0;
      const slice = all.slice(offset, range.length === undefined ? all.length : offset + range.length);
      return { key, etag: 'v' + this.versions.get(key), size: all.length, range: { offset, length: slice.length }, customMetadata: this.metadata.get(key),
        body: new Response(slice).body, text: async () => new TextDecoder().decode(slice), json: async () => JSON.parse(new TextDecoder().decode(slice)) as unknown };
    }
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  /** P98 R10 (R-P551): R2's HEAD answers the object's size and its custom metadata. */
  async head(key: string) {
    const raw = this.objects.get(key);
    return raw === undefined ? null : { key, etag: 'v' + this.versions.get(key), size: this.bytesOf(key, raw).length, customMetadata: this.metadata.get(key) };
  }
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

const fixturePolicy: RetentionPolicy = { id: 'parity-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant =>
  [tenant, Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy>]));

export interface Registry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

/** The documents a provisioned tenant holds. `slots` is published RETAINED (validateStored) when `retainedSlots` is set. */
export interface Documents {
  pieces: unknown[];
  slots: unknown;
  learn: unknown;
  reflex?: unknown;
  retainedSlots?: boolean;
}

export interface Mounted {
  host: Host;
  env: Env;
  cache: UnitKV;
  storage: UnitR2;
  stats: Map<string, Registry>;
  shoppers: Map<string, Registry>;
  rings: Map<string, Registry>;
  queued: unknown[];
  fetch: (request: Request) => Promise<Response>;
  drain: () => Promise<void>;
  /** The real producer's queue bodies, written by the real consumer. */
  drainLedger: () => Promise<void>;
  operatorToken: string;
  /** Null when the documents published; otherwise the platform's refusal of them, verbatim. */
  refused: string | null;
}

/**
 * The mounted application for one host, with the documents published through the
 * publication authority's own baseline path (`initializePublicationSet`, which
 * validates every non-retained document with its kind's write validator). A
 * refusal is CAUGHT and returned on `refused`, so a unit can name it as the
 * missing behaviour instead of dying on an exception.
 */
export async function mount(host: Host, documents: Documents, options: { recovery?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [], queued: unknown[] = [];
  const storage = new UnitR2(), cache = new UnitKV(), sessions = new UnitKV();
  const shoppers = new Map<string, Registry>(), rings = new Map<string, Registry>(), stats = new Map<string, Registry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: sessions, STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:parity-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    // The durable rendered admission (W15): the path a render acknowledgement takes in production.
    LEDGER_RECOVERY_ENABLED: options.recovery === false ? 'false' : 'true',
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

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/config', configRoutes);
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const operatorToken = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));
  const fetchOne = async (request: Request) => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  const drainLedger = async () => {
    await drain();
    if (!queued.length) return;
    const result = await consumeLedger(env, queued.splice(0), Date.now()) as { ok?: boolean; error?: unknown };
    expect(result.error, 'the fixture ledger batch is written by the real consumer').toBeUndefined();
  };

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT, retained = false): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'parity-fixture', note: 'fixture', value }, ...(retained ? { retainedValue: true as const } : {}) });
  let refused: string | null = null;
  try {
    await initializePublicationSet(env, [
      baseline(CONTENT_KIND, { version: 'parity-coach-catalogue', pieces: documents.pieces }),
      baseline(SLOTS_KIND, documents.slots, TENANT, documents.retainedSlots === true),
      baseline(LEARN_KIND, documents.learn),
      baseline(PRIORS_KIND, EMPTY_PRIORS),
      baseline(REFLEX_KIND, documents.reflex ?? REFLEX_DOCUMENT, reflexScopeForTenant(TENANT)),
    ], '0:' + crypto.randomUUID());
  } catch (error) {
    const code = (error as { code?: string }).code;
    refused = `${(error as Error).message}${code ? ` (${code})` : ''}`;
  }
  invalidatePublicationCache();
  return { host, env, cache, storage, stats, shoppers, rings, queued, fetch: fetchOne, drain, drainLedger, operatorToken, refused };
}

/** The precondition every unit names before it measures anything: the tenant's documents published. */
export function expectPublished(m: Mounted, what: string): void {
  expect(m.refused ?? 'published', `PRECONDITION (${m.host}): ${what} — the platform refused the fixture documents: ${m.refused}`).toBe('published');
}

// ---------------------------------------------------------------------------
// The operator.
// ---------------------------------------------------------------------------

export interface Answer { status: number; body: Record<string, unknown> }

export async function asOperator(m: Mounted, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method, headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${m.operatorToken}`, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}

export interface LoadedSlots { revision: number; publication: { revision: number; digest: string }; document: Record<string, unknown> }

/** `GET /content/:kind`: the document in force and its publication identity. */
export async function loadDocument(m: Mounted, kind: 'slots' | 'catalog' | 'learn'): Promise<LoadedSlots> {
  const read = await asOperator(m, 'GET', `/content/${kind}?scope=${TENANT}`);
  expect(read.status, `the operator reads the ${kind} document: ${JSON.stringify(read.body).slice(0, 300)}`).toBe(200);
  return { revision: read.body.revision as number, publication: read.body.publication as LoadedSlots['publication'], document: read.body.document as Record<string, unknown> };
}
export const loadSlots = (m: Mounted) => loadDocument(m, 'slots');

/** `PUT /content/:kind` with the authored preconditions (kit 02: If-Match plus Idempotency-Key): a merchandiser's save, no deployment. */
export async function putDocument(m: Mounted, kind: 'slots' | 'catalog' | 'learn', document: unknown, note = 'parity'): Promise<Answer> {
  const base = await loadDocument(m, kind);
  const answer = await asOperator(m, 'PUT', `/content/${kind}?scope=${TENANT}`, { document, note }, {
    'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
    'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
  });
  invalidatePublicationCache();
  return answer;
}
export const putSlots = (m: Mounted, document: unknown, note = 'parity') => putDocument(m, 'slots', document, note);

/** The errors a refused publication names, as one searchable list. */
export const errorsOf = (answer: Answer): string[] => ((answer.body.errors ?? (answer.body.error ? [answer.body.error] : [])) as unknown[]).map(String);

/** `GET /v1/:tenant/replay/:id` as the operator. */
export const replayOf = (m: Mounted, decisionId: string) => asOperator(m, 'GET', `/v1/${TENANT}/replay/${encodeURIComponent(decisionId)}`);
/** `GET /v1/:tenant/visitors/:visitorId/receipts` as the operator. */
export async function receiptsOf(m: Mounted, visitorId: string): Promise<Array<Record<string, unknown>>> {
  const read = await asOperator(m, 'GET', `/v1/${TENANT}/visitors/${encodeURIComponent(visitorId)}/receipts`);
  expect(read.status, `the operator reads her receipts: ${JSON.stringify(read.body).slice(0, 300)}`).toBe(200);
  return (read.body.receipts ?? []) as Array<Record<string, unknown>>;
}

/** What every statistics object of the namespace holds, read through its own `/snapshot`: item → { n, s } at the root level, summed over objects. */
export async function learned(m: Mounted): Promise<Record<string, { n: number; s: number }>> {
  const out: Record<string, { n: number; s: number }> = {};
  for (const name of [...m.stats.keys()].sort()) {
    const response = await m.env.LEARN_STATS!.get(m.env.LEARN_STATS!.idFromName(name)).fetch('https://learn/snapshot', { method: 'POST' });
    const body = await response.json().catch(() => ({})) as { snapshot?: { items?: Record<string, Record<string, { n: number; s: number }>> } | null };
    for (const [item, cells] of Object.entries(body.snapshot?.items ?? {})) {
      const root = cells['*'];
      if (!root) continue;
      const held = out[item] ?? { n: 0, s: 0 };
      out[item] = { n: held.n + root.n, s: held.s + root.s };
    }
  }
  return out;
}
/** Exposures (`n`) or credits (`s`) rounded to whole units: decay over seconds moves the third decimal only. Zeros are left out. */
export const rounded = (values: Record<string, { n: number; s: number }>, key: 'n' | 's'): Record<string, number> =>
  Object.fromEntries(Object.entries(values).map(([item, v]) => [item, Math.round(v[key])] as const).filter(([, v]) => v !== 0));

// ---------------------------------------------------------------------------
// The shopper.
// ---------------------------------------------------------------------------

export type Grant = Awaited<ReturnType<typeof newAnonymousSession>>;
export interface Decision { contentId: string; customerContentId?: string; slot: string; order: number; score?: number; strategy?: string;
  decisionId?: string; renderOffer?: string; type?: string; slotPosition?: unknown;
  explain?: { drivers?: Array<{ dim: string; value: string; a: number; weight: number }>; note?: string } }
export interface Snapshot extends Answer { decisions: Decision[]; pageInstance?: string; page: string }

export interface Shopper {
  grant: Grant;
  subject: string;
  /** A real accepted event through the mounted app. `entry` is the arrival the SDK sends with every action. */
  action: (event: { type: string; data: Record<string, unknown> }, entry?: Record<string, string>) => Promise<Answer>;
  /** The route production serves, `POST /v1/:tenant/decisions/snapshot`. */
  snapshot: (page: string, opts?: { pageInstance?: string; entry?: Record<string, string> }) => Promise<Snapshot>;
  /** The render acknowledgement the SDK sends for a decision it painted. */
  ack: (snapshot: Snapshot, decision: Decision, retryOf?: { eventId: string; timestamp: number }) => Promise<Answer & { identity: { eventId: string; timestamp: number } }>;
  /** A content engagement (click) on a painted decision, in the payload the SDK sends. */
  click: (snapshot: Snapshot, decision: Decision, data?: Record<string, unknown>) => Promise<Answer>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`). */
  hydrate: () => Promise<Answer>;
}

/** The module's position within its slot on a delivered page: what the decision record calls `position` (P03 D3). */
export function slotPositionOf(snapshot: { decisions: Decision[] }, decision: Decision): number {
  return snapshot.decisions.filter(d => d.slot === decision.slot).sort((a, b) => a.order - b.order).findIndex(d => d.order === decision.order);
}

let pageCounter = 0;
/** A page-view nonce in the shape `isEventNonce` admits (`src/events/actionTypes.ts:33`). */
export const pageInstanceOf = (label: string) => `parity-${label}-${++pageCounter}`;

/**
 * A shopper with a session grant and, unless `consent` is null, her own explicit
 * choice through the real route (HANDOFF-2026-09-18 §7, consent).
 */
export async function shopperOn(m: Mounted, consent: { tracking: boolean; personalization: boolean } | null = { tracking: true, personalization: true }): Promise<Shopper> {
  const grant = await newAnonymousSession(m.env, TENANT);
  const call = async (path: string, body?: unknown): Promise<Answer> => {
    const response = await m.fetch(new Request(`https://shop.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    await m.drain();
    return answer;
  };
  if (consent) {
    const chosen = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization,
      choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
    expect(chosen.status, `PRECONDITION (${m.host}): her explicit choice is accepted (${JSON.stringify(chosen.body).slice(0, 200)})`).toBe(200);
  }
  const action: Shopper['action'] = (event, entry) => call('/realtime/action', { ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
    timestamp: Date.now(), eventId: crypto.randomUUID(), ...(entry ? { entry } : {}) });
  const snapshot: Shopper['snapshot'] = async (page, opts = {}) => {
    const body: Record<string, string> = { page, brand: BRAND };
    if (opts.pageInstance) body.pageInstance = opts.pageInstance;
    if (opts.entry) body.entry = JSON.stringify(opts.entry);
    const answer = await call(`/v1/${TENANT}/decisions/snapshot`, body);
    return { ...answer, page, ...(opts.pageInstance ? { pageInstance: opts.pageInstance } : {}), decisions: (answer.body.decisions ?? []) as Decision[] };
  };
  const ack: Shopper['ack'] = async (snap, d, retryOf) => {
    // A retry carries its first wire identity and time (`src/routes/realtime.ts:143-146`), as the SDK's own retry does.
    const identity = retryOf ?? { eventId: crypto.randomUUID(), timestamp: Date.now() };
    const answer = await call('/realtime/action', { type: 'content_impression', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      ...identity,
      data: { contentId: d.contentId, decisionId: d.decisionId, renderOffer: d.renderOffer, page: snap.page, pageInstance: snap.pageInstance,
        slot: d.slot, position: d.order, slotPosition: slotPositionOf(snap, d) } });
    return { ...answer, identity };
  };
  const click: Shopper['click'] = (snap, d, data = {}) => call('/realtime/action', { type: 'content_click', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
    timestamp: Date.now(), eventId: crypto.randomUUID(),
    data: { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, page: snap.page, position: d.order, slotPosition: slotPositionOf(snap, d), ...data } });
  const hydrate = () => call('/realtime/reflex');
  return { grant, subject: grant.subject, action, snapshot, ack, click, hydrate };
}

/** The modules a slot of a delivered page returned, in the order it returned them. */
export const servedIn = (snapshot: { decisions: Decision[] }, slot: string): string[] =>
  snapshot.decisions.filter(d => d.slot === slot).sort((a, b) => a.order - b.order).map(d => d.contentId);

/**
 * The decision set the serving route composes for her page, one layer in:
 * `POST /v1/:tenant/decisions/snapshot` calls `serveContentDecisions` exactly so
 * (`src/routes/decisions.ts`), inside the owner operation `requireShopper` holds,
 * and answers without the records and the set's own diagnostics; they are read
 * here, as src/units/W26/LEDGER.unit.test.ts and src/units/W16/C8.unit.test.ts
 * read them. `offer: false` is the caller that captures served-v1 decisions at
 * serve time (no page instance).
 */
export async function servePage(m: Mounted, s: Shopper, page: string, opts: { offer?: boolean; entry?: Record<string, string> } = {}) {
  const live = await verifySessionCapability(m.env, s.grant.capability, TENANT);
  const owner = {};
  const out = await runOwnerOperation(owner, m.env, async () => {
    admitOwnerPrincipal(owner, live);
    return serveContentDecisions(m.env, { tenant: TENANT, brand: BRAND, page, visitorId: live.subject, sessionId: live.sessionId,
      cookieHeader: null, stateTenant: TENANT as TenantId, principal: live, capability: s.grant.capability, cf: null, channel: null,
      ...(opts.entry ? { entry: opts.entry } : {}),
      ...(opts.offer === false ? {} : { offer: { pageInstance: pageInstanceOf(page) } }) });
  }, m.env.SESSIONS as unknown as Parameters<typeof runOwnerOperation>[3], undefined,
  (async () => m.shoppers.get(shopperObjectName(TENANT as TenantId, live.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
  await out.afterResponse.catch(() => undefined);
  await m.drain();
  return out;
}

/** Her decisions in the ledger the replay route reads: the real producer and the real consumer. */
export async function toLedger(m: Mounted, records: DecisionRecord[]): Promise<void> {
  await enqueueDecisions(m.env, records);
  await m.drainLedger();
}

/** The decision records the real consumer stored for a visitor (the `decision` stream in R2). */
export function storedDecisions(m: Mounted, visitorId: string): DecisionRecord[] {
  return [...m.storage.objects.entries()].filter(([key]) => key.includes('/decision/') && key.endsWith('.ndjson'))
    .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord))
    .filter(record => record.visitor_id === visitorId);
}

/** The outcome records the real consumer stored for a visitor (the `outcome` stream in R2). */
export function storedOutcomes(m: Mounted, visitorId: string): Array<Record<string, unknown>> {
  return [...m.storage.objects.entries()].filter(([key]) => key.includes('/outcome/') && key.endsWith('.ndjson'))
    .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>))
    .filter(record => record.visitor_id === visitorId);
}

// ---------------------------------------------------------------------------
// The shipped console, under jsdom, bound to the mounted app (unit:W20.G1.09's
// and unit:W20.R2's idiom: src/units/W20/B1.unit.test.ts, LEDGER.unit.test.ts).
// ---------------------------------------------------------------------------

interface ConsoleEl {
  value: string; disabled: boolean; textContent: string | null;
  click: () => void; focus: () => void; dispatchEvent: (e: unknown) => boolean;
}
interface ConsoleBrowser extends Record<string, unknown> {
  document: { body: { textContent: string | null }; getElementById: (id: string) => unknown; querySelectorAll: (sel: string) => ArrayLike<ConsoleEl> };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  Event: new (type: string, options: object) => unknown;
}

export async function openConsole(m: Mounted, hash: string) {
  const dom = new JSDOM(readTree('public/console/index.html'), { url: `${OPERATOR_ORIGIN}/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as ConsoleBrowser;
  const requests: Array<{ method: string; path: string; body: string | undefined }> = [];
  w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/console/`);
    const method = (init?.method ?? 'GET').toUpperCase(), path = target.pathname + target.search;
    requests.push({ method, path, body: init?.body });
    return m.fetch(new Request(OPERATOR_ORIGIN + path, { method, headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }) }));
  };
  w.TextEncoder = TextEncoder;
  w.setInterval = () => 0;
  w.confirm = () => true;
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'parity-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'] }, mustChangePassword: false,
  }));
  w.eval(readTree('public/operator-session.js'));
  for (const file of ['shell.js', 'views.js', 'views-config.js', 'views-measure.js', 'views-accounts.js', 'views-explore.js']) w.eval(readTree(`public/console/${file}`));
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 12)); await m.drain(); };
  /** Long enough for the rules screen's validator, which waits 350 ms after the last keystroke. */
  const settleChecked = async () => { await new Promise(r => setTimeout(r, 450)); await settle(); };
  await settle(); await settle();
  const all = (sel: string) => Array.from(w.document.querySelectorAll(sel));
  const $ = (id: string) => w.document.getElementById(id) as unknown as ConsoleEl | null;
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const control = (focusKey: string): ConsoleEl | null => all(`[data-focus-key="${focusKey}"]`)[0] ?? null;
  const type = async (focusKey: string, value: string): Promise<boolean> => {
    const el = control(focusKey);
    if (!el) return false;
    el.focus(); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await settleChecked();
    return true;
  };
  const save = async () => { await settleChecked(); $('save')?.click(); await settle(); await settle(); };
  const puts = () => requests.filter(r => r.method === 'PUT' && r.path.startsWith('/content/slots'));
  return { w, requests, puts, all, $, text, control, type, save, settle, close: () => w.close() };
}
