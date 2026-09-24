// src/units/W26/LEDGER.unit.test.ts
// W26 — the later W26 unit of LANE-LOG R198, as the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W26) states it:
//
//   R2  page is part of the storage identity, so a retained catalogue with a
//       cross-page duplicate never pools silently.
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
import { invalidateLiftCache } from '@/content/service';
import type { Cell, ContentPiece, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { ts36, type OutcomeRecord } from '@/ledger/records';
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
  stats: Map<string, Registry>;
  fetch: (request: Request) => Promise<Response>;
  operatorToken: string;
  drain: () => Promise<void>;
}

/**
 * The routes production serves, mounted as `src/index.ts` mounts them, over the
 * real Durable Object classes, for the Tapestry tenant.
 */
async function mount(options: { slots?: SlotCatalog; retainedSlots?: boolean } = {}): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const storage = new UnitR2(), cache = new UnitKV(), sessions = new UnitKV();
  const shoppers = new Map<string, Registry>(), rings = new Map<string, Registry>(), stats = new Map<string, Registry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: sessions, STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session',
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w26-ledger-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    LEDGER_RECOVERY_ENABLED: 'false',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined, sendBatch: async () => undefined },
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
    baseline(LEARN_KIND, LEARN),
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
  return { env, cache, stats, fetch: fetchOne, operatorToken, drain };
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
  it('sdk: a client configured for the Coach brand of the Tapestry tenant sends data.brand coach on every reward-bearing action it emits — a content click, a completed video, an add to bag, a wishlist add and a purchase — from the source entry and from the shipped bundle', async () => {
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
        await client.emit.videoComplete(TABBY, 'hero');
        await client.emit.addToCart('CH-TABBY-26', { line: 'Tabby', category: 'Handbags', price_usd: 495 });
        await client.emit.wishlistAdd('CH-ROGUE-25', { line: 'Rogue', category: 'Handbags', price_usd: 695 });
        await client.emit.purchase({ orderId: 'w26-ledger-order', value: 495, currency: 'USD', items: [{ productId: 'CH-TABBY-26', quantity: 1, price: 495 }] });
        const sent = f.calls.filter(call => call.url.endsWith('/action')).map(call => JSON.parse(call.init!.body!) as Sent);
        // PRECONDITION: each reward-bearing action reached the wire at all.
        const rewarded = ['content_click', 'video_complete', 'add_to_cart', 'wishlist_add', 'purchase'];
        expect(rewarded.filter(type => !sent.some(e => e.type === type)), `${label}: PRECONDITION — every reward-bearing action was sent`).toEqual([]);
        for (const type of rewarded) {
          expect(sent.filter(e => e.type === type).map(e => e.data.brand),
            `W26.R3: ${label} must send data.brand — the brand the page was served under, the one the decision request carried — on ${type} (kit 03:26; LANE-LOG R198)`)
            .toEqual([BRAND]);
        }
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
  it('host: an outcome naming no decision whose brand disagrees with the placement it could credit is counted as brandMismatched on the outcome receipt, or the kit states that brandMismatched counts correlated outcomes only — and never both', async () => {
    const m = await mount();
    const now = Date.now() - 60_000;
    const served = record(m.env, { page: 'home', slot: 'hero', item_id: TABBY, ts: now });
    const appended = await m.env.DECISION_RING!.get(m.env.DECISION_RING!.idFromName(ringName(TENANT, 'v-w26-ledger')))
      .fetch('https://learn/append', { method: 'POST', body: JSON.stringify({ records: [served] }) });
    expect(appended.status, 'PRECONDITION: the visitor\'s ring holds the Coach decision').toBe(200);

    // The control: the same uncorrelated click under the decision's own brand is credited.
    const matched = click(m.env, { item_id: TABBY, slot: 'hero', ts: now + 1_000, brand: BRAND });
    expect(await fanOutcome(m.env, TENANT, matched, DEFAULT_POLICY, BRAND, SLOT_CONFIG, CLICK_CONFIG),
      'the uncorrelated click under the placement\'s own brand is credited').toMatchObject({ outcome: { attributed: 1 } });

    // The case: an uncorrelated click whose brand is another brand of the tenant.
    const mismatched = click(m.env, { item_id: TABBY, slot: 'hero', ts: now + 2_000, brand: OTHER_BRAND,
      outcome_id: `${TENANT}:${ts36(now + 2_000)}:v-w26-ledger:content_click` });
    const receipt = await fanOutcome(m.env, TENANT, mismatched, DEFAULT_POLICY, OTHER_BRAND, SLOT_CONFIG, CLICK_CONFIG) as { outcome?: { attributed?: number; brandMismatched?: number } };
    expect(receipt.outcome?.attributed, 'LOCKED: the other brand\'s click credits nothing (`src/learn/policy.ts`)').toBe(0);

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
