// src/units/W16/LEDGER.unit.test.ts
// W16 — the six LOCAL criteria the frozen work order still owes (R1–R6).
//
// Work order: ticket W16 in `docs/remediation/delivery-control/program.json`
// (frozen by the owner 2026-09-24; R3 and R5 as amended by A8 and A9, approved
// 2026-09-24, rem/integration 1676a97). Criteria C2–C8 are proven by the merged units
// in this directory (`unit:W16.C2.*` … `unit:W16.C8.*`) and are NOT rewritten
// here. DECISION (DC1–DC4) and DEFERRED_LIVE (LV1–LV3) criteria are proved by
// their records, not by tests.
//
// One `describe('unit:W16.<criterion>')` per criterion, one `it` per leg. Every
// expected value comes from the work order and the witnesses named beside it —
// never from what the engine returns today:
//
//  R1  "Adoption of a legacy session into the shopper object keeps the visit
//      journey at both adoption sites of ShopperReflex.ts (~2998, ~3446)."
//      Origin: whole-W16 delta review §5 row 1 (`_evidence/W16/reviewer-whole/
//      REPORT-DELTA.md`), W16-B9 build review finding 2, LANE-LOG R96(b), R98(a).
//      The visit journey is `PipelineRecord.journey` (ShopperReflex.ts:160-165):
//      "the counters of the CURRENT VISIT the reported journey stage is derived
//      from". Both adoption sites are session-host paths; the object host keeps
//      the record in its own object and adopts nothing.
//  R2  "The legacy deriveStage and stageFromCounters of JourneyStage.ts are
//      deleted, or deprecated behind a test that fails when a product path
//      imports them." Origin: REPORT-DELTA §5 row 3 ("no guard exists"), R96(a),
//      R98(a). "Deprecated" is read as the TypeScript `@deprecated` JSDoc tag on
//      the declaration; the guard is the second clause of this unit.
//  R3  "Every literal persisted-stage floor (RealtimeSegmentEngine.ts around
//      lines 815 and 858, ShopperReflex.ts around lines 637, 1189 and 2885) goes
//      through the one persisted-stage mapping point or is shown to be the
//      documented legacy-record floor, and the kit states that a legacy record
//      without a stage adopts as early." Origin: REPORT-DELTA §5 rows 2 and 4,
//      R96(b)/(c), R98(a); amendment A8. The mapping point is `PERSISTED_STAGE`
//      (JourneyStage.ts:131-139, R32(2)). One leg per floor; the documented
//      legacy-record floor is admitted only where the input is a legacy record.
//      The KIT SENTENCE half is a document sentence: per the criterion's proof
//      it is closed by the reviewer reading `docs/kit/02-api-reference.md`, not
//      by this file.
//  R4  "Continuity follow-ups (LANE-LOG R81(c)): linking or sign-in retires the
//      shopper's own recognition descriptor; the broker (cookie) mode
//      lost-response retry succeeds exactly once; a provisional subject holds no
//      state of its own after recognition." Origin: R81(c), R72(c) (no silent
//      identity merge; single use, rotation, one retry — R48(a)), the W16-B8
//      delta review "Not measured" list, whole-W16 review §8.
//  R5  "On the public decision route an unreadable record is served the
//      default decision (200, catalogue order) with a stable member naming it
//      unreadable, distinct from a refusal and from an expired session (LANE-LOG
//      R19 and R98(b))." Amendment A9. R19 names that route:
//      `POST /v1/:tenant/decisions/snapshot` behind `requireShopper`. The
//      unreadable record is the one this ticket already arranges for W16.C5.06
//      (R63): the tenant publishes the next revision of its profile retention
//      policy, so her stored profile stamp is unusable.
//  R6  "One native (workerd) leg proves the continuity consume-and-rotate
//      atomicity and restart behavior that C6.02, C6.08 and C6.11 prove against
//      doubles." Origin: R48(c); `C6.unit.test.ts` "LIMITS OF THIS FILE". The
//      shared Miniflare setup lives in `src/units/_native.ts`.
//
// NO WIRE OR STORAGE MEMBER IS NAMED HERE. Every leg asserts an outcome a
// client, an operator or the object's own storage can observe. R5 demands a
// member whose name or value says "unreadable" — the criterion's own word —
// and leaves the member's name and place in the answer to the build.
//
// The host legs drive the real mounted app (`tenantMiddleware`, the realtime,
// decision and identity routes, mounted as `src/index.ts` mounts them) and the
// real `ShopperReflex` class in process, on BOTH hosts unless the criterion is a
// one-host path, in the pattern of `src/units/W16/B8.unit.test.ts` and
// `src/routes/realtime.sdkContract.test.ts`; those suites are never imported and
// never edited. The sdk legs drive the real `src/sdk` entry (`createCore`, and
// for broker mode the shipped first-party broker `createServerBridge` of
// `src/sdk/server.ts`) over `memoryHost`, at the fetch boundary. The native leg
// runs the real Worker in workerd.
//
// The taxonomy is the brand's own catalogue (`src/data/coach-catalog.json`):
// every product below is a verbatim row, and every visit carries a
// cross-category interaction and a line nobody recognizes, because unknown input
// is part of the fixture.

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { REFLEX_KIND, reflexScopeForTenant, invalidateConfigCache } from '@/reflex/configStore';
import { initializePublicationSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import { memoryStore } from '@/auth/store';
import { signAssertion } from '@/identity/assertion';
import * as JourneyStageModule from '@/services/JourneyStage';
import { FIRST_JOURNEY_STAGE, JOURNEY_STAGES, PERSISTED_STAGE, type JourneyWord } from '@/services/JourneyStage';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { createIdentity } from '@/sdk/identify';
import { createCore } from '@/sdk/core';
import { createServerBridge } from '@/sdk/server';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks } from '@/sdk/testHost';
import type { RetentionCategory, RetentionPolicy } from '@/retention';
import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime, type NativeRuntime } from '../_native';

// ---------------------------------------------------------------------------
// The checkout this file measures: derived from this file's own URL, never
// from the process's working directory.
// ---------------------------------------------------------------------------

const CHECKOUT = fileURLToPath(new URL('../../..', import.meta.url));

// ---------------------------------------------------------------------------
// Customer-shaped fixtures: verbatim rows of `src/data/coach-catalog.json`.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const OTHER_TENANT = 'coach';
const T0 = 1_725_000_000_000;
/** One interaction apart, well inside the visit. */
const STEP_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The storefront's real product-view shape (docs/kit/03-payload-schemas.md). */
const productView = (data: Record<string, unknown>) => ({ type: 'product_view', data });

/** COA-CW620 · Tabby Shoulder Bag 26 With Quilting · Handbags. */
const VIEW_TABBY_QUILTED = productView({ productId: 'COA-CW620', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['evening', 'date-night', 'special-occasion'], price_usd: 575 });
/** COA-CH857 · Tabby Shoulder Bag 26 · Handbags. */
const VIEW_TABBY_26 = productView({ productId: 'COA-CH857', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['work', 'everyday', 'evening'], price_usd: 475 });
/** COA-CY201 · Tabby Shoulder Bag 20 · Handbags. */
const VIEW_TABBY_20 = productView({ productId: 'COA-CY201', line: 'Tabby', category: 'Handbags', subcategory: 'Shoulder Bags',
  silhouette: 'shoulder', occasion: ['everyday', 'evening', 'date-night'], price_usd: 375 });
/** COA-CB925 · Tabby Wallet With Chain · Small Leather Goods — the cross-category interaction. */
const VIEW_TABBY_WALLET_SLG = productView({ productId: 'COA-CB925', line: 'Tabby', category: 'Small Leather Goods', subcategory: 'Wallets',
  silhouette: 'chain wallet', occasion: ['evening', 'date-night', 'everyday'], price_usd: 250 });
/** A product and a line nobody's catalogue names: the unknown input. */
const VIEW_UNKNOWN_LINE = productView({ productId: 'COA-NOT-IN-CATALOGUE-16', line: 'not-a-coach-line', category: 'Accessories', price_usd: 95 });
/** COA-CP133 · Rogue Bag 25 · Handbags. */
const VIEW_ROGUE_25 = productView({ productId: 'COA-CP133', line: 'Rogue', category: 'Handbags', subcategory: 'Top-Handle Bags',
  silhouette: 'top-handle', occasion: ['work', 'evening', 'special-occasion'], price_usd: 595 });
/** COA-CCX23 · Rogue Bag 31 · Handbags. */
const VIEW_ROGUE_31 = productView({ productId: 'COA-CCX23', line: 'Rogue', category: 'Handbags', subcategory: 'Top-Handle Bags',
  silhouette: 'top-handle', occasion: ['work', 'travel', 'special-occasion'], price_usd: 695 });

/** Three views of one line, so she has one unambiguous interest. */
const THREE_TABBY_VIEWS = [VIEW_TABBY_QUILTED, VIEW_TABBY_26, VIEW_TABBY_20];
/** Her whole visit: the three views, a cross-category piece, and a line nobody knows. */
const HER_VISIT = [...THREE_TABBY_VIEWS, VIEW_TABBY_WALLET_SLG, VIEW_UNKNOWN_LINE];
/** What she browses on the PROVISIONAL session an outage served her (R4): a taste that is not hers. */
const PROVISIONAL_VISIT = [VIEW_ROGUE_25, VIEW_ROGUE_31, VIEW_UNKNOWN_LINE];

/** The values a reported affinity view names on one dimension, sorted. */
const linesOf = (body: { affinity?: { dims?: Record<string, Record<string, number>> } | null } | null | undefined): string[] =>
  Object.keys(body?.affinity?.dims?.line ?? {}).sort();

// ---------------------------------------------------------------------------
// The published documents: the same data `src/units/W16/B8.unit.test.ts`
// publishes (its FIXTURE_PIECES, FIXTURE_SLOTS, JOURNEY_V1, fourteen-day
// horizon), so a value measured there and here is the same value.
// ---------------------------------------------------------------------------

const ROGUE = 'rogue-editorial';
const TABBY = 'tabby-editorial';
/** The catalogue's own order: Rogue first, so only a remembered Tabby interest moves Tabby up. */
const HERO_BASE_ORDER = [ROGUE, TABBY];

const FIXTURE_PIECES = [
  { id: ROGUE, customerContentId: 'cms-rogue', type: 'editorial', title: 'The Rogue, Rebuilt',
    tags: { line: ['Rogue'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-CP133', 'COA-CCX23', 'COA-CCX21'] },
  { id: TABBY, customerContentId: 'cms-tabby', type: 'editorial', title: 'Tabby, Every Way',
    tags: { line: ['Tabby'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-CW620', 'COA-CH857', 'COA-CY201', 'COA-CB925'] },
  { id: 'festival-charms-editorial', customerContentId: 'cms-festival-charms', type: 'editorial', title: 'Festival Charms',
    tags: { occasion: ['festival'], category: ['Accessories'] }, slotTypes: ['edit'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-77840', 'COA-CB929'] },
  { id: 'evening-charms-editorial', customerContentId: 'cms-evening-charms', type: 'editorial', title: 'Charms For The Evening',
    tags: { occasion: ['evening', 'date-night'], category: ['Accessories'] }, slotTypes: ['edit'], lifecycle: { status: 'live' },
    featuredProductIds: ['COA-CCZ00', 'COA-CCD82'] },
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
const FIXTURE_LEARN = { holdout: { share: 0, salt: 'w16-ledger', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} };
/** R32(1): the journey thresholds live on the published reflex document. */
const JOURNEY_V1 = { stages: [{ stage: 'thinking', anyOf: { interactions: 3 } }, { stage: 'deciding', anyOf: { purchases: 1 } }] };
const fixtureReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'w16-ledger-fixture', tauMs: 14 * DAY_MS, eventAttributes: 'event-when-unknown' as const };
const reflexDocument = (continuity: unknown | null) => ({ ...fixtureReflexConfig, journey: JOURNEY_V1, ...(continuity === null ? {} : { continuity }) });

/**
 * The synthetic continuity configuration: exactly the block
 * `src/units/W16/C6.unit.test.ts` publishes (same purpose, same windows), so the
 * batches demand one representation. A test document, never a shipped default:
 * the production mode, window, purpose and retention approval stay the open
 * owner decision (LIVE2).
 */
const WINDOW_MS = 30 * DAY_MS;
const PURPOSE = 'w16-b6-return-recognition';
const CONTINUITY_DIRECT = { mode: 'direct', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true };
const CONTINUITY_BROKER = { mode: 'broker', windowMs: WINDOW_MS, purpose: PURPOSE, retentionApproved: true };
/** C6.11's six-hour window: the descriptor ends while her 24 h capability is still live. */
const ALARM_WINDOW_MS = 6 * HOUR_MS;
const CONTINUITY_ALARM = { mode: 'direct', windowMs: ALARM_WINDOW_MS, purpose: PURPOSE, retentionApproved: true };
/** The ruled broker-mode cookie the ENGINE sets (W16-B6 ruled member). */
const CONTINUITY_COOKIE = 'opt_shopper_continuity';
/** Ruled member (W16-B6): the SDK's tenant-scoped direct-mode store. */
const sdkContinuityKey = (endpoint: string, tenant: string) =>
  `opt_shopper_continuity:${encodeURIComponent(endpoint)}:${encodeURIComponent(tenant)}`;
const sdkContinuityOperationKey = (endpoint: string, tenant: string) => `${sdkContinuityKey(endpoint, tenant)}:operation`;

/** The object's own owned-state keys (`OWNED_STATE_KEYS`, ShopperReflex.ts:208). */
const OWNED_STATE_KEYS = ['affinity', 'pipeline', 'audienceOwner', 'consent', 'continuity'];

/** The digest form this codebase uses for a stored proof (`src/identity/erase.ts:279`). */
async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Where a needle is visible. Every absence claim is paired with a control source that DOES contain it. */
const sightings = (sources: Array<{ name: string; text: string }>, needle: string): string[] =>
  sources.filter(source => source.text.includes(needle)).map(source => source.name);

// ---------------------------------------------------------------------------
// Host fixture — the real mounted app and the real ShopperReflex class, one
// construction per host (pattern of `src/units/W16/B8.unit.test.ts`).
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-ledger-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const RETENTION_CATEGORIES = ['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'] as const;
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

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

/** A transient failure of the shopper's own object at the namespace boundary (W16.C6.13's fault). */
type ObjectFault = { match: string; kind: '5xx' } | null;

function boundary(host: 'session' | 'do') {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  let fault: ObjectFault = null;
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-ledger-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SECRETS: `${TENANT}:backend-proof,${OTHER_TENANT}:backend-proof`,
    TENANTS: JSON.stringify({ provisioned: [OTHER_TENANT, TENANT], operatorGrants: { 'w16-ledger-operator': [OTHER_TENANT, TENANT] } }),
    ACCOUNTS: memoryStore(),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => undefined },
  } as unknown as Env;
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories([OTHER_TENANT, TENANT]) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => { /* no destination diagnostics */ })) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  /**
   * W16.C5.06's arrangement (R63): the tenant publishes the NEXT revision of its
   * PROFILE retention policy, every other category carried forward verbatim, so
   * every stamp written under revision 1 is unusable (`requireRetention`,
   * src/retention.ts). This is the ticket's own "unreadable record".
   */
  const publishNextProfileRetentionRevision = () => {
    const current = JSON.parse(env.RETENTION!) as { version: 1; tenants: Record<string, Record<string, RetentionPolicy>> };
    const next: { version: 1; tenants: Record<string, Record<string, RetentionPolicy>> } = { version: 1, tenants: Object.fromEntries(
      Object.entries(current.tenants).map(([tenant, categories]) => [tenant, { ...categories, profile: { ...fixtureRetentionPolicy, revision: 2 } }])) };
    env.RETENTION = JSON.stringify(next);
    const before = current.tenants[TENANT] ?? {}, after = next.tenants[TENANT] ?? {};
    return Object.keys(after).filter(category => JSON.stringify(after[category]) !== JSON.stringify(before[category])).sort();
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
      deleteAll: async () => data.clear(), delete: async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) data.delete(key); return true; },
      setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null, deleteAlarm: async () => { alarms.length = 0; },
    };
    const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
    return { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (fault && url.includes(fault.match)) {
        return new Response(JSON.stringify({ ok: false, error: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
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
  const executionContext = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never passes through */ }, props: {} };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  const call = async (path: string, options: { capability?: string; body?: unknown; tenant?: string; headers?: Record<string, string>; method?: string } = {}) => {
    await configureRetention();
    const tenant = options.tenant ?? TENANT;
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { 'X-Tenant': tenant, ...(options.capability === undefined ? {} : { [SHOPPER_HEADER]: options.capability }),
        'Content-Type': 'application/json', ...options.headers },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return app.request(request, undefined, env, executionContext);
  };
  /** A request exactly as another server (the first-party broker) sends it to this engine. */
  const raw = async (request: Request) => {
    await configureRetention();
    const response = await app.request(request, undefined, env, executionContext);
    await drain();
    return response;
  };
  /** A cold start of a shopper object over the same durable storage. */
  const restart = (subject: string, tenant = TENANT) => {
    const name = shopperObjectName(tenant, subject), item = objects.get(name);
    if (!item) throw new Error(`no object for ${name}`);
    objects.set(name, { ...item, shopper: new ShopperReflex(item.state, env) });
  };
  return { env, app, cache, sessions, objects, call, raw, drain, restart, configureRetention, publishNextProfileRetentionRevision,
    setFault: (next: ObjectFault) => { fault = next; } };
}

async function fixturePublication(env: Env, tenant: string, continuity: unknown | null) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-ledger-fixture', note: '', value } });
  return initializePublicationSet(env, [
    baseline(REFLEX_KIND, reflexDocument(continuity), reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: FIXTURE_PIECES }),
    baseline(SLOTS_KIND, FIXTURE_SLOTS),
    baseline(LEARN_KIND, FIXTURE_LEARN),
  ], '0:' + crypto.randomUUID());
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

interface ContinuityReport { enabled?: unknown; reason?: unknown; mode?: unknown; purpose?: unknown; generation?: unknown; expiresAt?: unknown; revision?: unknown; proof?: unknown }
interface SessionAnswer {
  status: number; ok: unknown; subject: string; sessionId: string; kind: unknown; capability: string;
  continuity: ContinuityReport | undefined; cookies: string[]; bodyText: string;
}
interface Hydrate { ok?: unknown; affinity?: { dims?: Record<string, Record<string, number>> } | null; consent?: { tracking?: unknown; personalization?: unknown } | null }

async function hostFixture(host: 'session' | 'do', options: { continuity?: unknown | null; alarmTenantContinuity?: unknown | null } = {}) {
  invalidateCache(); invalidateLiftCache(); invalidateConfigCache();
  const f = boundary(host);
  await f.configureRetention();
  await fixturePublication(f.env, TENANT, options.continuity ?? null);
  await fixturePublication(f.env, OTHER_TENANT, options.alarmTenantContinuity ?? null);
  invalidateCache(); invalidateConfigCache();

  const operator = await new jose.SignJWT({ type: 'service', roles: ['admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('w16-ledger-operator').setIssuedAt().setIssuer('i').setAudience('a')
    .setExpirationTime('30m').sign(new TextEncoder().encode('w16-ledger-synthetic-signing-material-only'));

  /** `POST /v1/:tenant/identity/session` — establish, refresh, or consume a descriptor. */
  const identitySession = async (o: { capability?: string; proof?: string; operationId?: string; cookie?: string } = {}): Promise<SessionAnswer> => {
    const body: Record<string, unknown> = {};
    if (o.proof !== undefined || o.operationId !== undefined) {
      body.continuity = { ...(o.proof === undefined ? {} : { proof: o.proof }), ...(o.operationId === undefined ? {} : { operationId: o.operationId }) };
    }
    const response = await f.call(`/v1/${TENANT}/identity/session`, {
      body, ...(o.capability === undefined ? {} : { capability: o.capability }), ...(o.cookie === undefined ? {} : { headers: { Cookie: o.cookie } }) });
    const bodyText = await response.clone().text();
    const parsed = (() => { try { return JSON.parse(bodyText) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
    const session = (parsed.session ?? {}) as Record<string, unknown>;
    await f.drain();
    return { status: response.status, ok: parsed.ok, subject: String(session.subject ?? ''), sessionId: String(session.sessionId ?? ''),
      kind: session.kind, capability: String(session.capability ?? ''), continuity: parsed.continuity as ContinuityReport | undefined,
      cookies: setCookies(response), bodyText };
  };

  /** Her explicit choice — or her refusal — through the route the SDK calls. */
  const choose = async (session: { subject: string; sessionId: string; capability: string }, choice: { tracking: boolean; personalization: boolean } = { tracking: true, personalization: true }) => {
    const current = f.objects.get(shopperObjectName(TENANT, session.subject))?.data.get('consent');
    const claims = claimsOf(session.capability);
    const response = await f.call(`/realtime/session/${session.sessionId}/preferences`, { capability: session.capability, body: {
      trackingConsent: choice.tracking, personalizationEnabled: choice.personalization,
      choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null, grantId: claims.grantId, iat: claims.iat, exp: claims.exp } } });
    expect(response.status, `the fixture's own choice must be accepted: ${await response.clone().text()}`).toBe(200);
    await f.drain();
  };

  const action = async (capability: string, event: { type: string; data: Record<string, unknown> }) => {
    const claims = claimsOf(capability);
    const response = await f.call('/realtime/action', { capability, body: {
      ...event, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })() };
  };

  /** `GET /realtime/reflex` as production answers it, including a refusal. */
  const rawHydrate = async (capability: string) => {
    const response = await f.call('/realtime/reflex', { capability });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text) as Hydrate; } catch { return {} as Hydrate; } })() };
  };

  /** `POST /v1/:tenant/decisions/snapshot` — the route production serves the decision on (R19). */
  const rawSnapshot = async (capability: string) => {
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot`, { capability, body: { page: 'home' } });
    const text = await response.clone().text();
    await f.drain();
    const body = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
    const ranking: Record<string, string[]> = {};
    for (const decision of ((body?.decisions ?? []) as Array<{ slot?: string; contentId?: string }>)) (ranking[decision.slot ?? 'unknown-slot'] ??= []).push(decision.contentId ?? 'unknown-content');
    return { status: response.status, text, body, ranking };
  };

  /** `POST /v1/:tenant/identity/events` — the warehouse import route (R19). */
  const importRows = async (rows: unknown[]) => {
    const response = await f.call(`/v1/${TENANT}/identity/events`, { body: { rows }, headers: { Authorization: `Bearer ${operator}` } });
    const text = await response.clone().text();
    await f.drain();
    return { status: response.status, text };
  };

  /** A shopper who has made her explicit choice and browsed, on this host. */
  const newShopper = async (o: { events?: Array<{ type: string; data: Record<string, unknown> }>; clock?: { mockReturnValue: (at: number) => unknown }; from?: number } = {}) => {
    const established = await identitySession({});
    expect(established.status, `the fixture's own establish must succeed: ${established.bodyText}`).toBe(200);
    await choose(established);
    const events = o.events ?? HER_VISIT, from = o.from ?? Date.now();
    for (const [index, event] of events.entries()) {
      o.clock?.mockReturnValue(from + index * STEP_MS);
      const answered = await action(established.capability, event);
      expect(answered.status, `the fixture's own browsing must be accepted: ${JSON.stringify(event.data.productId)} → ${answered.text.slice(0, 200)}`).toBe(200);
    }
    return established;
  };

  const objectData = (subject: string) => f.objects.get(shopperObjectName(TENANT, subject))?.data ?? new Map<string, unknown>();
  const sessionRecordKey = (sessionId: string) => `t:${TENANT}:session:${sessionId}`;

  return { f, host, operator, identitySession, choose, action, rawHydrate, rawSnapshot, importRows, newShopper, objectData, sessionRecordKey };
}
type HostFixture = Awaited<ReturnType<typeof hostFixture>>;

const HOSTS = ['session', 'do'] as const;

// ---------------------------------------------------------------------------
// ONE REAL BROWSER, direct mode, in front of the mounted engine: the shipped
// `src/sdk` entry drives every load (pattern of `B8.unit.test.ts` sdkBrowser).
// ---------------------------------------------------------------------------

const SDK_ENDPOINT = 'https://synthetic.invalid';

function sdkBrowser(h: HostFixture) {
  const store = new Map<string, string>(), jar = new Map<string, string>();
  const calls: Array<{ path: string; status: number; continuity: unknown; subject: string }> = [];
  let capability = '', subject = '', sessionId = '';
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const browser = () => memoryHost({
    acquireAuthorityLock: authorityLocks(),
    now: () => Date.now(), uuid: () => crypto.randomUUID(),
    storage: { get: key => store.get(key) ?? null, set: (key, value) => { store.set(key, value); } },
    location: { href: 'https://shop.example/home', host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '' },
    referrer: '',
    fetch: async (url, init) => {
      const raw = init?.body ?? '';
      const parsed = (() => { try { return raw ? JSON.parse(raw) as Record<string, unknown> : undefined; } catch { return undefined; } })();
      const target = new URL(url);
      const bearer = init?.headers?.[SHOPPER_HEADER];
      const response = await h.f.call(target.pathname + target.search, {
        method: init?.method ?? 'GET', body: parsed, ...(bearer ? { capability: bearer } : {}), ...(jar.size ? { headers: { Cookie: cookieHeader() } } : {}) });
      for (const cookie of setCookies(response)) {
        const pair = cookie.split(';')[0] ?? '', at = pair.indexOf('=');
        if (at <= 0) continue;
        const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
        if (value === '' || /Max-Age=0/i.test(cookie)) jar.delete(name); else jar.set(name, value);
      }
      const text = await response.clone().text();
      await h.f.drain();
      const json = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
      const session = (json?.session ?? {}) as { capability?: unknown; subject?: unknown; sessionId?: unknown };
      if (typeof session.capability === 'string' && session.capability) {
        capability = session.capability; subject = String(session.subject ?? subject); sessionId = String(session.sessionId ?? sessionId);
      }
      calls.push({ path: target.pathname, status: response.status, continuity: (json as { continuity?: unknown } | null)?.continuity ?? null, subject: String(session.subject ?? '') });
      return { ok: response.ok, status: response.status, json: async () => json };
    },
  });
  const key = sdkContinuityKey(SDK_ENDPOINT, TENANT), operationKey = sdkContinuityOperationKey(SDK_ENDPOINT, TENANT);
  return {
    store, calls,
    load: async () => { const core = createCore({ tenant: TENANT, endpoint: SDK_ENDPOINT, source: 'sdk' }, browser()); return { core, adopted: await core.ready() }; },
    held: () => ({ proof: store.get(key) ?? '', operationId: store.get(operationKey) ?? '' }),
    capability: () => capability, subject: () => subject, sessionId: () => sessionId,
    /** A week away: her short session capability is gone; her long recognition proof is not. */
    forgetCapability: () => { for (const name of [...store.keys()]) if (name.startsWith('opt_shopper_session:')) store.delete(name); capability = ''; },
    /** Her explicit choice through the route the kit documents. */
    choose: async (on = true) => {
      const claims = claimsOf(capability);
      const stored = h.f.objects.get(shopperObjectName(TENANT, subject))?.data.get('consent');
      const response = await h.f.call(`/realtime/session/${sessionId}/preferences`, { capability,
        body: { trackingConsent: on, personalizationEnabled: on,
          choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(stored).instruction?.revision ?? null, grantId: claims.grantId, iat: claims.iat, exp: claims.exp } } });
      expect(response.status, `the fixture's own choice must be accepted: ${await response.clone().text()}`).toBe(200);
      await h.f.drain();
    },
  };
}

// ---------------------------------------------------------------------------
// ONE REAL BROWSER, broker mode (R4): the shipped `src/sdk` entry configured
// with `sessionBroker`, talking to the SHIPPED first-party broker
// (`createServerBridge(...).broker`, src/sdk/server.ts, the server integration
// docs/kit/01-integration-guide.md tells the customer to mount), which talks to
// the mounted engine. The browser keeps a first-party cookie jar for the shop's
// origin and honours each cookie's Max-Age on the fixture clock; nothing the
// harness does can carry a credential the broker did not hand the browser.
// ---------------------------------------------------------------------------

const SHOP_ORIGIN = 'https://shop.example';
const ENGINE_ORIGIN = 'https://engine.example';
const BROKER_PATH = '/shopper-broker';

type FirstPartyJar = Map<string, { value: string; expires: number }>;

function brokerBrowser(h: HostFixture, from?: { store: Map<string, string>; jar: FirstPartyJar }) {
  const store = new Map(from?.store ?? []), jar: FirstPartyJar = new Map([...(from?.jar ?? [])].map(([k, v]) => [k, { ...v }]));
  let capability = '', subject = '', sessionId = '', loseNext = false;
  const bridge = createServerBridge({ tenant: TENANT, origin: SHOP_ORIGIN, endpoint: ENGINE_ORIGIN, sdkKey: 'w16-ledger-site-key' },
    async (input, init) => h.f.raw(new Request(input as RequestInfo, init)));
  const cookieHeader = () => [...jar].filter(([, cookie]) => cookie.expires > Date.now()).map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
  const keepCookies = (response: Response) => {
    for (const cookie of setCookies(response)) {
      const pair = cookie.split(';')[0] ?? '', at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
      const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1] ?? 'NaN');
      if (value === '' || maxAge <= 0) jar.delete(name);
      else jar.set(name, { value, expires: Number.isFinite(maxAge) ? Date.now() + maxAge * 1000 : Number.POSITIVE_INFINITY });
    }
  };
  const browser = () => memoryHost({
    acquireAuthorityLock: authorityLocks(),
    now: () => Date.now(), uuid: () => crypto.randomUUID(),
    storage: { get: key => store.get(key) ?? null, set: (key, value) => { store.set(key, value); } },
    location: { href: `${SHOP_ORIGIN}/home`, host: 'shop.example', hostname: 'shop.example', protocol: 'https:', search: '' },
    referrer: '',
    fetch: async (url, init) => {
      if (url === SHOP_ORIGIN + BROKER_PATH) {
        const headers = new Headers(init?.headers ?? {});
        headers.set('Origin', SHOP_ORIGIN); headers.set('Sec-Fetch-Site', 'same-origin');
        const cookie = cookieHeader();
        if (cookie) headers.set('Cookie', cookie);
        const response = await bridge.broker(new Request(url, { method: init?.method ?? 'POST', headers, body: init?.body ?? '{}' }));
        await h.f.drain();
        if (loseNext) {
          // THE LOST ANSWER: the broker and the engine did their work, and the
          // answer never reached the browser — no body, no Set-Cookie.
          loseNext = false;
          return { ok: false, status: 502, json: async () => null };
        }
        keepCookies(response);
        const json = await response.json().catch(() => null) as { session?: { capability?: unknown; subject?: unknown; sessionId?: unknown } } | null;
        if (typeof json?.session?.capability === 'string' && json.session.capability) {
          capability = json.session.capability; subject = String(json.session.subject ?? ''); sessionId = String(json.session.sessionId ?? '');
        }
        return { ok: response.ok, status: response.status, json: async () => json };
      }
      // Every other call the SDK makes goes to the engine with what the SDK sends.
      const target = new URL(url);
      const bearer = init?.headers?.[SHOPPER_HEADER];
      const parsed = (() => { try { return init?.body ? JSON.parse(init.body) as Record<string, unknown> : undefined; } catch { return undefined; } })();
      const response = await h.f.call(target.pathname + target.search, { method: init?.method ?? 'GET', body: parsed, ...(bearer ? { capability: bearer } : {}) });
      const json = await response.clone().json().catch(() => null);
      await h.f.drain();
      return { ok: response.ok, status: response.status, json: async () => json };
    },
  });
  const self = {
    load: async () => {
      const core = createCore({ tenant: TENANT, endpoint: ENGINE_ORIGIN, source: 'sdk', sessionBroker: BROKER_PATH }, browser());
      return { core, adopted: await core.ready() };
    },
    capability: () => capability, subject: () => subject, sessionId: () => sessionId,
    /** The next broker answer never reaches this browser. */
    loseNextAnswer: () => { loseNext = true; },
    /** This browser exactly as it stands now — cookies and storage — as a second copy. */
    clone: () => brokerBrowser(h, { store, jar }),
    /** A week away: the SDK's stored copy of the short capability is gone (its cookie expires on its own Max-Age). */
    forgetCapability: () => { for (const name of [...store.keys()]) if (name.startsWith('opt_shopper_session:')) store.delete(name); capability = ''; },
    choose: async (on = true) => {
      const claims = claimsOf(capability);
      const stored = h.f.objects.get(shopperObjectName(TENANT, subject))?.data.get('consent');
      const response = await h.f.call(`/realtime/session/${sessionId}/preferences`, { capability,
        body: { trackingConsent: on, personalizationEnabled: on,
          choice: { id: crypto.randomUUID(), expectedRevision: storedConsent(stored).instruction?.revision ?? null, grantId: claims.grantId, iat: claims.iat, exp: claims.exp } } });
      expect(response.status, `the fixture's own choice must be accepted: ${await response.clone().text()}`).toBe(200);
      await h.f.drain();
    },
  };
  return self;
}

// ===========================================================================
// R1 — adoption keeps the visit journey at both adoption sites
// ===========================================================================

describe('unit:W16.R1', () => {
  // R19: no public route exposes the shopper object's stored record, so both
  // legs read it in process from the real object the request path just wrote.
  // Missing public observable (named for the review): the object's own pipeline
  // record and the stage the object's alarm and import qualification derive from
  // it (ShopperReflex.ts:1668, :3157).
  it('host-internal: the session host adopts her session record into her shopper object with the visit journey the record carries (the session-projection adoption site, ShopperReflex.ts ~3446)', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const h = await hostFixture('session');
      const her = await h.newShopper({ clock, from: T0 });
      const record = JSON.parse(h.f.sessions.data.get(h.sessionRecordKey(her.sessionId)) ?? '{}') as { journey?: { counters?: Record<string, number> } };
      // Control: the session record really carries this visit's journey — the
      // five interactions of her visit, three of them Tabby product views plus the
      // cross-category wallet and the unknown line.
      expect(record.journey?.counters?.interactions, 'the session record counts the interactions of this visit').toBe(HER_VISIT.length);
      expect(record.journey?.counters?.product_views, 'and its product views').toBe(HER_VISIT.length);
      const pipeline = h.objectData(her.subject).get('pipeline') as { journey?: unknown; journeyStage?: unknown } | undefined;
      expect(pipeline, 'the session host adopted her record into her shopper object').toBeDefined();
      expect(pipeline?.journey,
        'W16.R1 — the object record adopted from her session keeps the visit journey the session record carries').toEqual(record.journey);
    } finally { clock.mockRestore(); }
  });

  it('host-internal: a legacy session record the object never adopted is adopted by the historical import with the visit journey the record carries (the import adoption site, ShopperReflex.ts ~2998)', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const h = await hostFixture('session');
      const her = await h.newShopper({ clock, from: T0 });
      const legacy = h.f.sessions.data.get(h.sessionRecordKey(her.sessionId));
      const record = JSON.parse(legacy ?? '{}') as { journey?: { counters?: Record<string, number> } };
      expect(record.journey?.counters?.interactions, 'the legacy session record counts the interactions of her visit').toBe(HER_VISIT.length);
      // A LEGACY record: the shopper object holds no adopted record of its own —
      // the state the adoption site at ~2998 exists for (it adopts only when the
      // object has neither `affinity` nor `pipeline`). The object is cold-started
      // over that storage so nothing in memory stands in for it.
      const data = h.objectData(her.subject);
      for (const key of ['affinity', 'pipeline', 'audienceOwner']) data.delete(key);
      h.f.restart(her.subject);
      clock.mockReturnValue(T0 + HER_VISIT.length * STEP_MS);
      const imported = await h.importRows([{ visitorId: her.subject, action: 'purchase', at: T0 - 2 * DAY_MS, product: { line: 'Rogue', category: 'Handbags' } }]);
      expect(imported.status, `the fixture's own import must be accepted: ${imported.text.slice(0, 300)}`).toBe(200);
      const pipeline = h.objectData(her.subject).get('pipeline') as { journey?: unknown } | undefined;
      expect(pipeline, 'the historical import adopted the legacy record into her shopper object').toBeDefined();
      expect(pipeline?.journey,
        'W16.R1 — the object record adopted from a legacy session keeps the visit journey that session carries').toEqual(record.journey);
    } finally { clock.mockRestore(); }
  });
});

// ===========================================================================
// R2 — the legacy cumulative rule is deleted or deprecated behind a guard
// ===========================================================================

const LEGACY_STAGE_FUNCTIONS = ['deriveStage', 'stageFromCounters'] as const;
const JOURNEY_STAGE_SOURCE = join(CHECKOUT, 'src', 'services', 'JourneyStage.ts');

/** Every product module under src/: not a test, not a unit, not a declaration file. */
function productModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (path !== join(CHECKOUT, 'src', 'units')) walk(path); continue; }
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(name) || /\.test\.(ts|tsx|js|mjs)$/.test(name) || name.endsWith('.d.ts')) continue;
      out.push(path);
    }
  };
  walk(join(CHECKOUT, 'src'));
  return out.sort();
}

/** Every place a module's CODE (never its comments) names one of the legacy functions. */
function legacyReferences(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && (LEGACY_STAGE_FUNCTIONS as readonly string[]).includes(node.text)) {
      found.push(`${fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** What the one module that defines them says about each: gone, deprecated, or neither. */
function legacyDisposition(name: string): string {
  const source = ts.createSourceFile(JOURNEY_STAGE_SOURCE, readFileSync(JOURNEY_STAGE_SOURCE, 'utf8'), ts.ScriptTarget.Latest, true);
  let declaration: ts.Node | undefined;
  source.forEachChild(node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name)) declaration = node;
  });
  const exported = Object.hasOwn(JourneyStageModule, name);
  if (!exported && declaration === undefined) return 'deleted';
  const deprecated = declaration !== undefined && ts.getJSDocTags(declaration).some(tag => tag.tagName.text === 'deprecated');
  return deprecated ? 'deprecated' : 'exported without a @deprecated tag';
}

describe('unit:W16.R2', () => {
  it('logic: the legacy deriveStage and stageFromCounters are deleted or marked @deprecated, and no product module under src/ references them', () => {
    // 1. The guard has teeth: it finds a product-shaped named import and its
    //    call, and a namespace reach dotted or bracketed; a comment is not code.
    expect(legacyReferences('synthetic-product.ts',
      "import { deriveStage } from '@/services/JourneyStage';\nexport const s = deriveStage(ctx);").length,
    'W16.R2 control — the guard sees a named import and its call').toBe(2);
    expect(legacyReferences('synthetic-product.ts',
      "import * as J from './JourneyStage';\nexport const s = J.stageFromCounters({});\nexport const t = J['deriveStage'];").length,
    'W16.R2 control — the guard sees a namespace reach, dotted or bracketed').toBe(2);
    expect(legacyReferences('synthetic-product.ts', '// deriveStage and stageFromCounters are mentioned only here\nexport const x = 1;'),
      'W16.R2 control — a comment is not a reference').toEqual([]);
    const modules = productModules();
    expect(modules.length, 'the walk reaches the product tree').toBeGreaterThan(100);
    expect(modules, 'the defining module is among the product modules the walk reaches').toContain(JOURNEY_STAGE_SOURCE);

    // 2. THE GUARD: no product path names either function, except the one module
    //    that defines them (and only while they are deprecated there).
    const references = modules.filter(path => path !== JOURNEY_STAGE_SOURCE)
      .flatMap(path => legacyReferences(relative(CHECKOUT, path), readFileSync(path, 'utf8')));
    expect(references, 'W16.R2 guard — no product module under src/ imports or calls deriveStage or stageFromCounters').toEqual([]);

    // 3. THE DISPOSITION: each is deleted, or carries the @deprecated tag.
    for (const name of LEGACY_STAGE_FUNCTIONS) {
      expect.soft(legacyDisposition(name), `W16.R2 — ${name} is deleted, or deprecated with a @deprecated tag on its declaration`)
        .toMatch(/^(deleted|deprecated)$/);
    }
  });
});

// ===========================================================================
// R3 — every literal persisted-stage floor goes through the one mapping point,
// or is shown to be the documented legacy-record floor
// ===========================================================================

/**
 * A permutation of the three persisted tokens: every reported word maps to a
 * DIFFERENT valid token, so a floor that reads the mapping point follows it and
 * a literal does not. `deciding → 'early'` keeps the permuted grammar a grammar.
 */
const PERMUTED_STAGE: Record<JourneyWord, 'early' | 'mid' | 'late'> = { exploring: 'mid', thinking: 'late', deciding: 'early' };
/** What the kit documents for a record written before the stored stage existed (the criterion's own words: "adopts as early"). */
const DOCUMENTED_LEGACY_FLOOR = 'early';

/**
 * Run one whole scenario — from her first request to the observation — with the
 * one mapping point permuted in place, and restore it whatever happens. The
 * window covers the whole scenario, not only the read, so a repair that gives a
 * record its stage when the record is born (through the mapping point) is
 * measured exactly like a repair at the floor itself.
 */
async function underPermutedMapping<T>(run: () => Promise<T>): Promise<T> {
  const original = { ...PERSISTED_STAGE };
  expect({ tokens: JOURNEY_STAGES.map(word => PERMUTED_STAGE[word]).sort(), first: PERMUTED_STAGE[FIRST_JOURNEY_STAGE], shipped: original[FIRST_JOURNEY_STAGE] },
    'the permutation uses exactly the three persisted tokens and moves the first stage off the shipped token')
    .toEqual({ tokens: ['early', 'late', 'mid'], first: 'mid', shipped: 'early' });
  Object.assign(PERSISTED_STAGE, PERMUTED_STAGE);
  try { return await run(); } finally { Object.assign(PERSISTED_STAGE, original); }
}

describe('unit:W16.R3', () => {
  // The CODE half of R3, one leg per literal floor the criterion names:
  // RealtimeSegmentEngine.ts ~815 and ~858, ShopperReflex.ts ~637, ~1189 and
  // ~2885. The mapping point is `PERSISTED_STAGE` (JourneyStage.ts:131-139,
  // R32(2)); a floor that goes through it is `PERSISTED_STAGE[FIRST_JOURNEY_STAGE]`
  // (the form RealtimeSegmentEngine.ts:985 and the adoption sites
  // ShopperReflex.ts:3001/:3449 already use). "Goes through the one mapping
  // point" is measured as what it means: every leg runs its scenario twice —
  // once as shipped (the CONTROL: the floor is the first reported stage in the
  // persisted grammar) and once with the mapping point permuted for the whole
  // scenario — and the floor must follow the permutation. (Constraint for the
  // build: the mapping point stays the one mutable record at JourneyStage.ts:135
  // that every writer reads at call time.)
  //
  // "Or is shown to be the documented legacy-record floor": that disposition is
  // what the kit sentence documents — a record written BEFORE the stored stage
  // existed, carrying none, adopts as early. It is admissible only for a legacy
  // record. Every input below except the one legacy leg is NOT a legacy record:
  // a record born during the scenario (her session before its first event, the
  // record a segment assignment, a first event or a sign-in fold births) or a
  // refusal answer that floors whatever is stored. A floor those inputs reach is
  // not the legacy-record floor, so for them the floor follows the mapping point
  // — whether the repair is at the floor or gives the record its stage at birth.
  // The legacy leg accepts either the mapping point or the documented floor.
  //
  // HOST-INTERNAL (R19) throughout: the mounted routes that run these floors
  // either discard the floored value (`GET /realtime/personalization/:userId`
  // answers without `journeyStage` or the cookie updates, src/routes/realtime.ts
  // :412-:430) or store it in the shopper object, which no public route exposes.
  // The legs drive the mounted route and read the value that route resolved (a
  // call-through spy on `getSessionPersonalizationConfig`, which the route runs)
  // or the record the real object stored. Missing public observable, named for
  // the review: the floored stage on each of these paths.
  //
  // The KIT half ("the kit states that a legacy record without a stage adopts as
  // early", docs/kit/02-api-reference.md) is a document sentence: per the
  // criterion's proof it is closed by the reviewer reading the changed sentence.

  /** The mounted read, and the floored stage the session host's engine resolved on it. */
  const flooredOnRead = async (h: HostFixture, shopper: { subject: string; capability: string }, spy: { mockClear: () => void; mock: { calls: unknown[]; results: Array<{ value: unknown }> } }) => {
    spy.mockClear();
    const response = await h.f.call(`/realtime/personalization/${shopper.subject}`, { capability: shopper.capability });
    expect(response.status, `the mounted read answers: ${(await response.clone().text()).slice(0, 200)}`).toBe(200);
    await h.f.drain();
    expect(spy.mock.calls.length, 'the mounted read ran getSessionPersonalizationConfig').toBe(1);
    const config = await spy.mock.results[0]!.value as { journeyStage?: unknown; cookieUpdates?: Record<string, unknown> } | null;
    return { journeyStage: config?.journeyStage, cookie: config?.cookieUpdates?.opt_journey_stage };
  };
  /** The stage the real shopper object stored on its pipeline record. */
  const storedStage = (h: HostFixture, subject: string) =>
    (h.objectData(subject).get('pipeline') as { journeyStage?: unknown } | undefined)?.journeyStage ?? 'no pipeline record stored';

  it('host-internal (RealtimeSegmentEngine.ts ~858, session host): her session read before its first event — a record born this visit, not a legacy one — is floored through the one mapping point', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const spy = vi.spyOn(RealtimeSegmentEngine.prototype, 'getSessionPersonalizationConfig');
    try {
      /** A consenting shopper who has made her explicit choice and not yet interacted, read on the mounted route. */
      const scenario = async () => {
        const h = await hostFixture('session');
        const her = await h.identitySession({});
        expect(her.status, `the fixture's own establish must succeed: ${her.bodyText}`).toBe(200);
        await h.choose(her);
        clock.mockReturnValue(T0 + STEP_MS);
        return flooredOnRead(h, her, spy);
      };
      expect(await scenario(), 'W16.R3 control — as shipped, her unstaged session is floored at the first reported stage in the persisted grammar')
        .toEqual({ journeyStage: PERSISTED_STAGE[FIRST_JOURNEY_STAGE], cookie: PERSISTED_STAGE[FIRST_JOURNEY_STAGE] });
      clock.mockReturnValue(T0);
      expect.soft(await underPermutedMapping(scenario),
        'W16.R3 (~858) — a session born this visit is floored through PERSISTED_STAGE[FIRST_JOURNEY_STAGE]: the floor follows the one mapping point')
        .toEqual({ journeyStage: PERMUTED_STAGE[FIRST_JOURNEY_STAGE], cookie: PERMUTED_STAGE[FIRST_JOURNEY_STAGE] });
    } finally { spy.mockRestore(); clock.mockRestore(); }
  });

  it('host-internal (RealtimeSegmentEngine.ts ~858, session host): a LEGACY record — written before the stored stage existed, carrying none — is floored through the one mapping point or at the documented legacy-record floor, and at nothing else', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const spy = vi.spyOn(RealtimeSegmentEngine.prototype, 'getSessionPersonalizationConfig');
    /** Strip the stored stage from both copies the session host holds: the KV record and the object's projection of it. */
    const makeLegacy = (h: HostFixture, shopper: { subject: string; sessionId: string }) => {
      const key = h.sessionRecordKey(shopper.sessionId);
      const record = JSON.parse(h.f.sessions.data.get(key)!) as { metadata: Record<string, unknown> };
      expect(record.metadata.journeyStage, 'the fixture\'s record carries a stored stage before it is made legacy').toBeDefined();
      delete record.metadata.journeyStage;
      h.f.sessions.data.set(key, JSON.stringify(record));
      const data = h.objectData(shopper.subject), projectionKey = `sessionProjection:${key}`;
      const projection = data.get(projectionKey) as { value: string } | undefined;
      expect(projection, 'the object holds its projection of her record').toBeDefined();
      const inner = JSON.parse(projection!.value) as { metadata: Record<string, unknown> };
      delete inner.metadata.journeyStage;
      data.set(projectionKey, { ...projection, value: JSON.stringify(inner) });
      h.f.restart(shopper.subject);
    };
    /**
     * Her visit is the ordinary one: a Tabby view, the cross-category wallet, a
     * line nobody knows. Her record is then made legacy — the record the kit
     * sentence speaks of — and read once. A legacy record was written before
     * this scenario, so only the read can run under a permuted mapping point.
     */
    const scenario = async (read: (run: () => Promise<{ journeyStage: unknown; cookie: unknown }>) => Promise<{ journeyStage: unknown; cookie: unknown }>) => {
      clock.mockReturnValue(T0);
      const h = await hostFixture('session');
      const legacy = await h.newShopper({ clock, from: T0, events: [VIEW_TABBY_QUILTED, VIEW_TABBY_WALLET_SLG, VIEW_UNKNOWN_LINE] });
      makeLegacy(h, legacy);
      clock.mockReturnValue(T0 + 4 * STEP_MS);
      return read(async () => flooredOnRead(h, legacy, spy));
    };
    try {
      expect(await scenario(async run => run()), 'W16.R3 control — as shipped, a legacy record is floored at the first reported stage in the persisted grammar')
        .toEqual({ journeyStage: PERSISTED_STAGE[FIRST_JOURNEY_STAGE], cookie: PERSISTED_STAGE[FIRST_JOURNEY_STAGE] });
      const floored = await scenario(async run => underPermutedMapping(run));
      expect.soft([
        { journeyStage: PERMUTED_STAGE[FIRST_JOURNEY_STAGE], cookie: PERMUTED_STAGE[FIRST_JOURNEY_STAGE] },
        { journeyStage: DOCUMENTED_LEGACY_FLOOR, cookie: DOCUMENTED_LEGACY_FLOOR },
      ], 'W16.R3 (~858, legacy record) — floored through the one mapping point, or at the documented legacy-record floor the kit states')
        .toContainEqual(floored);
    } finally { spy.mockRestore(); clock.mockRestore(); }
  });

  it('host-internal (RealtimeSegmentEngine.ts ~815, session host): the answer the engine resolves for a shopper who refused personalization floors her stage through the one mapping point', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    const spy = vi.spyOn(RealtimeSegmentEngine.prototype, 'getSessionPersonalizationConfig');
    try {
      /** She allows tracking and refuses personalization, browses (a Tabby view, the wallet, a line nobody knows), and is read. */
      const scenario = async () => {
        const h = await hostFixture('session');
        const her = await h.identitySession({});
        expect(her.status, `the fixture's own establish must succeed: ${her.bodyText}`).toBe(200);
        await h.choose(her, { tracking: true, personalization: false });
        for (const [index, event] of [VIEW_TABBY_QUILTED, VIEW_TABBY_WALLET_SLG, VIEW_UNKNOWN_LINE].entries()) {
          clock.mockReturnValue(T0 + (index + 1) * STEP_MS);
          const answered = await h.action(her.capability, event);
          expect(answered.status, `the fixture's own browsing must be accepted: ${answered.text.slice(0, 160)}`).toBe(200);
        }
        clock.mockReturnValue(T0 + 5 * STEP_MS);
        const floored = await flooredOnRead(h, her, spy);
        return floored.journeyStage;
      };
      expect(await scenario(), 'W16.R3 control — as shipped, the refusal answer is floored at the first reported stage in the persisted grammar')
        .toBe(PERSISTED_STAGE[FIRST_JOURNEY_STAGE]);
      clock.mockReturnValue(T0);
      expect.soft(await underPermutedMapping(scenario),
        'W16.R3 (~815) — the refusal answer floors the stage through PERSISTED_STAGE[FIRST_JOURNEY_STAGE]: the floor follows the one mapping point')
        .toBe(PERMUTED_STAGE[FIRST_JOURNEY_STAGE]);
    } finally { spy.mockRestore(); clock.mockRestore(); }
  });

  it('host-internal (ShopperReflex.ts ~637): a segment assigned to a consenting shopper who has no record yet births her record with the floor the one mapping point names, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        /** She makes her explicit choice and, before any interaction, is assigned a segment through the mounted route. */
        const scenario = async () => {
          clock.mockReturnValue(T0);
          const h = await hostFixture(host);
          const her = await h.identitySession({});
          expect(her.status, `${host}: the fixture's own establish must succeed: ${her.bodyText}`).toBe(200);
          await h.choose(her);
          clock.mockReturnValue(T0 + STEP_MS);
          const response = await h.f.call(`/realtime/segments/${her.subject}`, { capability: her.capability,
            body: { segment: 'coach-tabby-loyalist', source: 'manual', userId: her.subject, sessionId: her.sessionId } });
          expect(response.status, `${host}: the fixture's own assignment must be accepted: ${(await response.clone().text()).slice(0, 200)}`).toBe(200);
          await h.f.drain();
          return storedStage(h, her.subject);
        };
        expect(await scenario(), `${host}: W16.R3 control — as shipped, the record the assignment births carries the first reported stage in the persisted grammar`)
          .toBe(PERSISTED_STAGE[FIRST_JOURNEY_STAGE]);
        expect.soft(await underPermutedMapping(scenario),
          `${host}: W16.R3 (~637) — the record a segment assignment births is floored through PERSISTED_STAGE[FIRST_JOURNEY_STAGE]: the floor follows the one mapping point`)
          .toBe(PERMUTED_STAGE[FIRST_JOURNEY_STAGE]);
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal (ShopperReflex.ts ~1189, object host): the first event of a shopper who allows tracking and refuses personalization births her record with the floor the one mapping point names', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      /** Her explicit choice (tracking yes, personalization no), then her first event: a Tabby product view. */
      const scenario = async () => {
        clock.mockReturnValue(T0);
        const h = await hostFixture('do');
        const her = await h.identitySession({});
        expect(her.status, `the fixture's own establish must succeed: ${her.bodyText}`).toBe(200);
        await h.choose(her, { tracking: true, personalization: false });
        clock.mockReturnValue(T0 + STEP_MS);
        const answered = await h.action(her.capability, VIEW_TABBY_QUILTED);
        expect(answered.status, `the fixture's own first event must be accepted: ${answered.text.slice(0, 160)}`).toBe(200);
        return storedStage(h, her.subject);
      };
      expect(await scenario(), 'W16.R3 control — as shipped, the record her first event births carries the first reported stage in the persisted grammar')
        .toBe(PERSISTED_STAGE[FIRST_JOURNEY_STAGE]);
      expect.soft(await underPermutedMapping(scenario),
        'W16.R3 (~1189) — the record a first event births is floored through PERSISTED_STAGE[FIRST_JOURNEY_STAGE]: the floor follows the one mapping point')
        .toBe(PERMUTED_STAGE[FIRST_JOURNEY_STAGE]);
    } finally { clock.mockRestore(); }
  });

  it('host-internal (ShopperReflex.ts ~2885): a sign-in through the real SDK that folds a consenting shopper with no record into an account with none births the person\'s record with the floor the one mapping point names, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        /** Her first load and explicit choice, then a login through the real SDK before any interaction. */
        const scenario = async () => {
          clock.mockReturnValue(T0);
          const h = await hostFixture(host);
          const browser = sdkBrowser(h);
          const first = await browser.load();
          expect(first.adopted, `${host}: load 1 establishes her session`).toBe(true);
          await browser.choose();
          const anonymous = browser.subject();
          const exp = Math.floor(Date.now() / 1000) + 300, account = 'coach-account-w16-r3-fold';
          const assertion = await signAssertion('backend-proof', TENANT, first.core.visitorId, account, exp);
          const signedIn = await createIdentity(first.core).identify(account, { assertion, exp, source: 'login' });
          expect(signedIn, `${host}: the fixture's own login must succeed: ${JSON.stringify(signedIn)}`).toMatchObject({ ok: true });
          await h.f.drain();
          // The person's object: the one object of this tenant, other than her
          // anonymous one, that now holds the identity members.
          const person = [...h.f.objects].filter(([name, item]) => name !== shopperObjectName(TENANT, anonymous) && item.data.has('identityMembers'));
          expect(person.length, `${host}: the login folded her into exactly one person's object`).toBe(1);
          return (person[0]![1].data.get('pipeline') as { journeyStage?: unknown } | undefined)?.journeyStage ?? 'no pipeline record stored';
        };
        expect(await scenario(), `${host}: W16.R3 control — as shipped, the record the fold births carries the first reported stage in the persisted grammar`)
          .toBe(PERSISTED_STAGE[FIRST_JOURNEY_STAGE]);
        expect.soft(await underPermutedMapping(scenario),
          `${host}: W16.R3 (~2885) — the record a sign-in fold births is floored through PERSISTED_STAGE[FIRST_JOURNEY_STAGE]: the floor follows the one mapping point`)
          .toBe(PERMUTED_STAGE[FIRST_JOURNEY_STAGE]);
      }
    } finally { clock.mockRestore(); }
  });
});

// ===========================================================================
// R4 — the three continuity follow-ups of LANE-LOG R81(c)
// ===========================================================================

/**
 * R4(iii)'s arrangement, both hosts. She is a returning shopper whose proof the
 * real SDK holds; on her return her own object is unreachable, so the engine
 * serves her a PROVISIONAL anonymous session (W16.C6.13). On that provisional
 * session she sees the consent banner again, makes her explicit choice, and
 * browses a taste that is not hers (Rogue, and a line nobody knows). Her next
 * load, engine healthy, recognizes her own subject.
 */
async function provisionalThenRecognized(h: HostFixture, clock: { mockReturnValue: (at: number) => unknown },
  beforeRecognition: (provisional: { subject: string; sessionId: string }) => void = () => undefined) {
  const her = sdkBrowser(h);
  expect((await her.load()).adopted, 'load 1 establishes her session').toBe(true);
  await her.choose();
  const second = await her.load();
  expect(second.adopted, 'load 2 issues her recognition descriptor').toBe(true);
  expect(her.held().proof.length, 'her browser holds a real direct-mode proof').toBeGreaterThan(32);
  const herSubject = her.subject();
  for (const [index, view] of THREE_TABBY_VIEWS.entries()) {
    clock.mockReturnValue(T0 + index * STEP_MS);
    await second.core.send('product_view', view.data);
  }
  await h.f.drain();

  // A week later, her object unreachable for the consume: the provisional session.
  clock.mockReturnValue(T0 + 7 * DAY_MS);
  her.forgetCapability();
  h.f.setFault({ match: '/identity/continuity/consume', kind: '5xx' });
  expect((await her.load()).adopted, 'the outage load still serves her a session').toBe(true);
  h.f.setFault(null);
  const provisional = { subject: her.subject(), capability: her.capability(), sessionId: her.sessionId() };
  expect({ anonymous: /^vis-[0-9a-f-]{36}$/.test(provisional.subject), hers: provisional.subject === herSubject },
    'the outage served a provisional anonymous subject that is not hers').toEqual({ anonymous: true, hers: false });

  // On it: her explicit choice, and a taste that is not hers.
  await her.choose(true);
  for (const [index, view] of PROVISIONAL_VISIT.entries()) {
    clock.mockReturnValue(T0 + 7 * DAY_MS + (index + 1) * STEP_MS);
    const answered = await h.action(provisional.capability, view);
    expect(answered.status, `the provisional session's browsing is accepted: ${answered.text.slice(0, 160)}`).toBe(200);
  }
  const provisionalRead = await h.rawHydrate(provisional.capability);
  beforeRecognition(provisional);

  // Her next load, engine healthy: recognized as her own subject (W16.C6.13).
  clock.mockReturnValue(T0 + 7 * DAY_MS + 10 * STEP_MS);
  expect((await her.load()).adopted, 'the recovery load serves her a session').toBe(true);
  expect(her.subject(), 'precondition (W16.C6.13): her next load recognizes her own subject').toBe(herSubject);
  return { her, herSubject, provisional, provisionalRead };
}

/** Everything stored for a subject on this host: her object's records and her rows in the shared session store. */
function storedFor(h: HostFixture, subject: string, sessionId: string): Array<{ name: string; text: string }> {
  return [
    ...[...h.objectData(subject)].map(([key, value]) => ({ name: `object ${key}`, text: JSON.stringify(value ?? null) })),
    ...[...h.f.sessions.data].filter(([key]) => key.includes(subject) || key.includes(sessionId)).map(([key, value]) => ({ name: `session store ${key}`, text: value })),
  ];
}

describe('unit:W16.R4', () => {
  it('sdk: signing in through the real SDK — a login, or a link at checkout — retires her own recognition descriptor: the proof her browser held recognizes nobody afterwards, while a shopper who did not sign in is still recognized, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { continuity: CONTINUITY_DIRECT });
        const shoppers: Array<{ source: 'login' | 'checkout' | null; proof: string; subject: string }> = [];
        for (const source of ['login', 'checkout', null] as const) {
          const browser = sdkBrowser(h);
          expect((await browser.load()).adopted, `${host}: load 1`).toBe(true);
          await browser.choose();
          const second = await browser.load();
          expect(second.adopted, `${host}: load 2`).toBe(true);
          for (const view of THREE_TABBY_VIEWS) await second.core.send('product_view', view.data);
          await h.f.drain();
          const proof = browser.held().proof;
          expect(proof.length, `${host}: her browser holds her own recognition proof before she signs in`).toBeGreaterThan(32);
          const subject = browser.subject();
          if (source !== null) {
            const exp = Math.floor(Date.now() / 1000) + 300, account = `coach-account-w16-r4-${source}`;
            const assertion = await signAssertion('backend-proof', TENANT, second.core.visitorId, account, exp);
            const signedIn = await createIdentity(second.core).identify(account, { assertion, exp, source });
            expect(signedIn, `${host}: the fixture's own ${source} must succeed: ${JSON.stringify(signedIn)}`).toMatchObject({ ok: true });
          }
          shoppers.push({ source, proof, subject });
        }

        clock.mockReturnValue(T0 + 7 * DAY_MS);
        for (const { source, proof, subject } of shoppers) {
          const presented = await h.identitySession({ proof, operationId: crypto.randomUUID() });
          expect(presented.status, `${host}: the return is answered`).toBe(200);
          if (source === null) {
            // CONTROL at the same moment: without a sign-in her proof still brings her back.
            expect(presented.subject, `${host}: W16.R4 control — a shopper who did not sign in is still recognized by her proof`).toBe(subject);
            continue;
          }
          expect.soft({ continuity: presented.continuity, sameSubject: presented.subject === subject, anonymous: /^vis-[0-9a-f-]{36}$/.test(presented.subject) },
            `${host}: W16.R4 — after a ${source} through the SDK, the proof her own browser held recognizes nobody: a cold shopper`)
            .toEqual({ continuity: { enabled: false, reason: 'consent' }, sameSubject: false, anonymous: true });
          expect.soft((await h.rawSnapshot(presented.capability)).ranking.hero,
            `${host}: W16.R4 — and that caller is served the catalogue's own order`).toEqual(HERO_BASE_ORDER);
        }
      }
    } finally { clock.mockRestore(); }
  });

  it('host: in broker (cookie) mode the engine answers the exact retry of a lost consume once — the same subject, generation, grant and successor cookie — and refuses a second retry and a different operation, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { continuity: CONTINUITY_BROKER });
        const her = await h.newShopper({ clock, from: T0 });
        const issued = await h.identitySession({ capability: her.capability });
        const cookie = issued.cookies.find(value => value.startsWith(`${CONTINUITY_COOKIE}=`))?.split(';')[0] ?? '';
        expect(cookie.length, `${host}: broker mode delivers her proof as the ${CONTINUITY_COOKIE} cookie`).toBeGreaterThan(CONTINUITY_COOKIE.length + 32);
        clock.mockReturnValue(T0 + 7 * DAY_MS);

        const operationId = crypto.randomUUID();
        const first = await h.identitySession({ cookie, operationId });
        expect(first.subject, `${host}: the consume recognizes her`).toBe(her.subject);
        const successor = first.cookies.find(value => value.startsWith(`${CONTINUITY_COOKIE}=`))?.split(';')[0] ?? '';
        // The answer is lost: the browser still holds the old cookie and retries the SAME consume.
        const retry = await h.identitySession({ cookie, operationId });
        expect.soft(retry.subject, `${host}: W16.R4 broker — the exact retry recognizes her`).toBe(her.subject);
        expect.soft(retry.continuity, `${host}: W16.R4 broker — at the same generation`).toEqual(first.continuity);
        expect.soft(claimsOf(retry.capability || first.capability).grantId, `${host}: W16.R4 broker — with the same session grant`).toBe(claimsOf(first.capability).grantId);
        expect.soft(retry.cookies.find(value => value.startsWith(`${CONTINUITY_COOKIE}=`))?.split(';')[0] ?? '',
          `${host}: W16.R4 broker — and the same successor cookie, so the browser cannot end up with two`).toBe(successor);
        // Exactly once: a second retry, and a different operation, are cold.
        for (const [why, answer] of [
          ['a second exact retry', await h.identitySession({ cookie, operationId })],
          ['the spent cookie under a different operation', await h.identitySession({ cookie, operationId: crypto.randomUUID() })],
        ] as const) {
          expect.soft({ continuity: answer.continuity, hers: answer.subject === her.subject },
            `${host}: W16.R4 broker — ${why} is a cold shopper`).toEqual({ continuity: { enabled: false, reason: 'consent' }, hers: false });
        }
        // And the successor is her live chain.
        clock.mockReturnValue(T0 + 8 * DAY_MS);
        expect.soft((await h.identitySession({ cookie: successor, operationId: crypto.randomUUID() })).subject,
          `${host}: W16.R4 broker — the successor cookie recognizes her`).toBe(her.subject);
      }
    } finally { clock.mockRestore(); }
  });

  it('sdk: joined — in broker mode, through the real SDK and the shipped first-party broker, a return whose answer is lost is recognized on the very next load, exactly once, and leaves her browser holding a live successor, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { continuity: CONTINUITY_BROKER });
        const her = brokerBrowser(h);
        expect((await her.load()).adopted, `${host}: load 1 establishes her session through the first-party broker`).toBe(true);
        await her.choose();
        const second = await her.load();
        expect(second.adopted, `${host}: load 2 — the ordinary page load on which her recognition descriptor is issued`).toBe(true);
        const herSubject = her.subject();
        for (const [index, view] of THREE_TABBY_VIEWS.entries()) {
          clock.mockReturnValue(T0 + index * STEP_MS);
          await second.core.send('product_view', view.data);
        }
        await h.f.drain();
        expect((await h.rawSnapshot(her.capability())).ranking.hero,
          `${host}: before she leaves, her own taste ranks her page — the control the return is measured against`).toEqual([TABBY, ROGUE]);

        // A week away. Her short session is gone; whatever the broker left her browser holding is not.
        clock.mockReturnValue(T0 + 7 * DAY_MS);
        her.forgetCapability();
        const asSheCameBack = her.clone();

        // LOAD 3 — her return; the answer is lost on its way back to the browser.
        her.loseNextAnswer();
        expect((await her.load()).adopted, `${host}: harness — the lost answer adopts nothing`).toBe(false);
        // LOAD 4 — the very next load.
        clock.mockReturnValue(T0 + 7 * DAY_MS + STEP_MS);
        expect((await her.load()).adopted, `${host}: the next load serves her a session`).toBe(true);
        expect.soft(her.subject(), `${host}: W16.R4 broker — after the lost answer her next load recognizes HER subject`).toBe(herSubject);
        expect.soft((await h.rawSnapshot(her.capability())).ranking.hero, `${host}: W16.R4 broker — and her own taste ranks her page`).toEqual([TABBY, ROGUE]);

        // EXACTLY ONCE: the browser exactly as it stood when she came back presents
        // the same return again. It is spent: a cold shopper, the catalogue order.
        // (Green by construction today, because nothing is recognized in broker
        // mode at all; it is the half no repair may break.)
        const replay = asSheCameBack;
        expect((await replay.load()).adopted, `${host}: the replayed browser is served a session`).toBe(true);
        expect.soft({ hers: replay.subject() === herSubject, hero: (await h.rawSnapshot(replay.capability())).ranking.hero },
          `${host}: W16.R4 broker — the return her browser already spent is never recognized a second time`).toEqual({ hers: false, hero: HERO_BASE_ORDER });

        // AND WHAT SHE HOLDS NOW IS LIVE: another week away, her browser brings her back.
        clock.mockReturnValue(T0 + 14 * DAY_MS);
        her.forgetCapability();
        expect((await her.load()).adopted, `${host}: the second return is served`).toBe(true);
        expect.soft(her.subject(), `${host}: W16.R4 broker — the successor her browser now holds recognizes her on her next return`).toBe(herSubject);
      }
    } finally { clock.mockRestore(); }
  });

  it('host: after recognition the provisional subject an outage served her holds no state of its own — its capability reads no taste and no choice of its own — and nothing of it was merged into hers, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { continuity: CONTINUITY_DIRECT });
        const { her, provisional, provisionalRead } = await provisionalThenRecognized(h, clock);
        // CONTROL: before recognition the provisional subject really held a taste
        // and an explicit choice of its own, readable with its capability.
        expect({ taste: linesOf(provisionalRead.body), personalization: provisionalRead.body.consent?.personalization ?? false },
          `${host}: W16.R4 control — before recognition the provisional subject holds a taste and a choice of its own`)
          .toEqual({ taste: ['Rogue'], personalization: true });

        const after = await h.rawHydrate(provisional.capability);
        expect.soft({ taste: linesOf(after.body), personalization: after.body.consent?.personalization ?? false },
          `${host}: W16.R4 — after recognition the provisional subject holds no state of its own: its capability reads no taste and no choice (status ${after.status})`)
          .toEqual({ taste: [], personalization: false });
        // No silent identity merge (R72(c)): her own profile carries none of it.
        const own = await h.rawHydrate(her.capability());
        expect.soft(linesOf(own.body), `${host}: W16.R4 — and nothing of the provisional subject was merged into her own profile`).toEqual(['Tabby']);
      }
    } finally { clock.mockRestore(); }
  });

  it('host-internal: after recognition nothing is stored for the provisional subject — no owned state in its object and no record of its taste anywhere this host keeps shopper state, on both hosts', async () => {
    // R19: no public route exposes the provisional subject's object or its rows
    // in the shared session store; this leg reads them in process. Missing
    // public observable (named for the review): what is stored for a subject
    // whose capability nobody holds any more.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host, { continuity: CONTINUITY_DIRECT });
        // The controls are taken on the provisional subject at the last moment
        // before her recognizing load.
        let before: Array<{ name: string; text: string }> = [];
        let ownedBefore: string[] = [];
        const result = await provisionalThenRecognized(h, clock, ({ subject, sessionId }) => {
          before = storedFor(h, subject, sessionId);
          ownedBefore = OWNED_STATE_KEYS.filter(key => h.objectData(subject).has(key));
        });
        expect(ownedBefore, `${host}: W16.R4 control — before recognition the provisional object holds owned state of its own`)
          .toEqual(expect.arrayContaining(['affinity', 'consent']));
        expect(sightings([...before, { name: 'control', text: '"Rogue"' }], '"Rogue"').length,
          `${host}: W16.R4 control — before recognition the provisional subject's taste is stored where the scan looks`).toBeGreaterThan(1);

        const { provisional } = result;
        expect.soft(OWNED_STATE_KEYS.filter(key => h.objectData(provisional.subject).has(key)),
          `${host}: W16.R4 — after recognition the provisional subject's object holds none of the owned state keys`).toEqual([]);
        expect.soft(sightings([...storedFor(h, provisional.subject, provisional.sessionId), { name: 'control', text: '"Rogue"' }], '"Rogue"'),
          `${host}: W16.R4 — and the taste the provisional subject built is stored nowhere this host keeps shopper state`).toEqual(['control']);
      }
    } finally { clock.mockRestore(); }
  });
});

// ===========================================================================
// R5 — on the public decision route an unreadable record is served the default
// decision with a stable member naming it unreadable, distinct from a refusal
// and from an expired session
// ===========================================================================

type Answer = { status: number; body: unknown };

/** Every leaf of an answer as `path → value`, so answers compare member by member. */
function leaves(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.set(prefix, JSON.stringify(value));
    for (const [key, item] of entries) leaves(item, prefix ? `${prefix}.${key}` : key, out);
  } else out.set(prefix, JSON.stringify(value));
  return out;
}

/**
 * The members a client can tell two classes of answer apart by: a member says
 * the same thing in EVERY answer of one class, the same thing in every answer of
 * the other, and the two things differ. Status is a member. A member that varies
 * inside a class (a subject id, a session id, a decision id) tells nothing and is
 * never counted, so a difference by accident cannot pass for a distinction.
 */
function tellingMembers(a: Answer[], b: Answer[]): string[] {
  const la = a.map(answer => leaves(answer)), lb = b.map(answer => leaves(answer));
  const paths = new Set([...la, ...lb].flatMap(map => [...map.keys()]));
  const telling: string[] = [];
  for (const path of paths) {
    const va = la.map(map => map.get(path) ?? 'absent'), vb = lb.map(map => map.get(path) ?? 'absent');
    if (va.every(value => value === va[0]) && vb.every(value => value === vb[0]) && va[0] !== vb[0]) telling.push(path);
  }
  return telling.sort();
}

/**
 * The members that NAME the record unreadable and say so identically in every
 * answer of the class: `path=value` leaves whose member name or value carries
 * the criterion's own word, present with the same value in every answer. The
 * member's name and place in the answer are not ruled; the word is the
 * criterion's ("a stable member naming it unreadable").
 */
function stableMembersNamingUnreadable(answers: Answer[]): string[] {
  const naming = answers.map(answer => new Set([...leaves(answer)]
    .filter(([path, value]) => /unreadable/i.test(path) || /unreadable/i.test(value)).map(([path, value]) => `${path}=${value}`)));
  return answers.length === 0 ? [] : [...naming[0]!].filter(entry => naming.every(set => set.has(entry))).sort();
}

/**
 * THE DEFAULT DECISION for the fixture's page: every slot of the published page
 * filled from the published catalogue in the catalogue's own order — the pieces
 * of that slot's type, in the order the catalogue lists them, `take` of them.
 * Derived from the fixture's own publication, never from an engine answer; the
 * refusing shoppers below are its control (kit 02: "personalization-refused
 * choices use defaults").
 */
const CATALOGUE_ORDER: Record<string, string[]> = Object.fromEntries(FIXTURE_SLOTS.pages.home.map(({ slot, take }) =>
  [slot, FIXTURE_PIECES.filter(piece => piece.slotTypes.includes(slot)).slice(0, take).map(piece => piece.id)]));

describe('unit:W16.R5', () => {
  // The criterion as amended (A9, approved 2026-09-24): "On the public decision
  // route an unreadable record is served the default decision (200, catalogue
  // order) with a stable member naming it unreadable, distinct from a refusal
  // and from an expired session (LANE-LOG R19 and R98(b))."
  //  - The route (R19): `POST /v1/:tenant/decisions/snapshot` behind
  //    `requireShopper`, mounted as src/index.ts mounts it.
  //  - The unreadable record: the one this ticket already arranges for
  //    W16.C5.06 (R63) — the tenant publishes the next revision of its profile
  //    retention policy, so her stored profile stamp is unusable.
  //  - The default decision: `CATALOGUE_ORDER`, every slot of the page.
  //  - The member: any member of the answer whose name or value says
  //    "unreadable", identical in every answer of the class (two shoppers, two
  //    moments each), and telling her answer from BOTH a refusing shopper's and
  //    an expired session's (`tellingMembers`). Its name and place are not
  //    ruled. (The expired session's answer names itself "Shopper session
  //    unavailable", so "unavailable" cannot be the word that names her.)
  it('host: on the public decision route a shopper whose record is unreadable is served the default decision — 200, the catalogue\'s own order in every slot — with a stable member naming her record unreadable that tells her answer from a refusing shopper\'s and from an expired session\'s, on both hosts', async () => {
    expect(CATALOGUE_ORDER, 'the default decision the fixture publishes: the catalogue\'s own order in each of the page\'s three slots').toEqual({
      hero: HERO_BASE_ORDER, edit: ['festival-charms-editorial', 'evening-charms-editorial'], guide: ['guide-decide-editorial', 'guide-explore-editorial'] });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        clock.mockReturnValue(T0);
        const h = await hostFixture(host);
        // REFUSING shoppers: an explicit refusal of personalization, once with
        // tracking kept and once with tracking refused as well.
        const refusing: Array<{ capability: string }> = [];
        for (const choice of [{ tracking: true, personalization: false }, { tracking: false, personalization: false }]) {
          const shopper = await h.identitySession({});
          await h.choose(shopper, choice);
          refusing.push(shopper);
        }
        // Shoppers whose record will be UNREADABLE: consenting, with a taste of
        // their own (her visit: three Tabby views, the cross-category wallet, a
        // line nobody knows).
        const unreadable = [await h.newShopper({ clock, from: T0 }), await h.newShopper({ clock, from: T0 + 10 * STEP_MS })];
        // Shoppers whose SESSION will be gone: consenting, with a taste of their own.
        const gone = [await h.newShopper({ clock, from: T0 + 20 * STEP_MS, events: THREE_TABBY_VIEWS }),
          await h.newShopper({ clock, from: T0 + 25 * STEP_MS, events: THREE_TABBY_VIEWS })];

        // CONTROL: while their records are readable, their own taste ranks their page.
        clock.mockReturnValue(T0 + 40 * STEP_MS);
        for (const shopper of unreadable) {
          expect((await h.rawSnapshot(shopper.capability)).ranking.hero,
            `${host}: W16.R5 control — a readable record's own taste ranks her page`).toEqual([TABBY, ROGUE]);
        }
        // Her stored profile stamp becomes unusable: the ticket's unreadable record (R63, W16.C5.06).
        expect(h.f.publishNextProfileRetentionRevision(), `${host}: exactly the profile retention policy moves to its next revision`).toEqual(['profile']);
        clock.mockReturnValue(T0 + 41 * STEP_MS);
        const refusingAnswers = await Promise.all(refusing.map(async shopper => h.rawSnapshot(shopper.capability)));
        const unreadableAnswers: Array<Awaited<ReturnType<HostFixture['rawSnapshot']>>> = [];
        for (const moment of [41, 42]) {
          clock.mockReturnValue(T0 + moment * STEP_MS);
          for (const shopper of unreadable) unreadableAnswers.push(await h.rawSnapshot(shopper.capability));
        }
        // A day later, the gone sessions' capabilities have expired.
        clock.mockReturnValue(T0 + 25 * HOUR_MS);
        const goneAnswers = await Promise.all(gone.map(async shopper => h.rawSnapshot(shopper.capability)));

        // CONTROLS: the two neighbouring classes exist and say what they are, and
        // a refusal is served exactly the default decision.
        for (const answer of refusingAnswers) {
          expect({ status: answer.status, reason: (answer.body?.experiment as { reason?: unknown } | undefined)?.reason, ranking: answer.ranking },
            `${host}: W16.R5 control — a refusing shopper is served the default decision and the answer names her refusal (kit 02, experiment.reason)`)
            .toEqual({ status: 200, reason: 'personalization_consent', ranking: CATALOGUE_ORDER });
        }
        for (const answer of goneAnswers) {
          expect(answer.status, `${host}: W16.R5 control — a shopper whose session is gone is refused as such`).toBe(401);
        }

        // CLAUSE 1 — the unreadable record is served the DEFAULT DECISION: 200, the catalogue's own order in every slot.
        for (const answer of unreadableAnswers) {
          expect.soft({ status: answer.status, ok: answer.body?.ok, ranking: answer.ranking },
            `${host}: W16.R5 — a shopper whose record is unreadable is served the default decision on the decision route: 200, the catalogue's own order in every slot (${answer.text.slice(0, 120)})`)
            .toEqual({ status: 200, ok: true, ranking: CATALOGUE_ORDER });
        }
        // CLAUSE 2 — with a STABLE member NAMING it unreadable.
        const toAnswer = (answer: { status: number; body: unknown }): Answer => ({ status: answer.status, body: answer.body });
        const naming = stableMembersNamingUnreadable(unreadableAnswers.map(toAnswer));
        expect.soft(naming,
          `${host}: W16.R5 — every answer to an unreadable record carries the same member naming it unreadable (answers seen: ${JSON.stringify(unreadableAnswers.map(answer => answer.text.slice(0, 80)))})`)
          .toEqual(expect.arrayContaining([expect.stringMatching(/unreadable/i)]));
        // CLAUSE 3 — and that member tells her answer from a refusal's AND from an expired session's.
        const versusRefusal = tellingMembers(unreadableAnswers.map(toAnswer), refusingAnswers.map(toAnswer));
        const versusGone = tellingMembers(unreadableAnswers.map(toAnswer), goneAnswers.map(toAnswer));
        const distinct = naming.map(entry => entry.slice(0, entry.indexOf('='))).filter(path => versusRefusal.includes(path) && versusGone.includes(path));
        expect.soft(distinct,
          `${host}: W16.R5 — the member naming it unreadable is one a client tells her apart by, from a refusing shopper and from a gone session (naming: ${JSON.stringify(naming)})`)
          .toEqual(expect.arrayContaining([expect.stringMatching(/./)]));
      }
    } finally { clock.mockRestore(); }
  });
});

// ===========================================================================
// R6 — the native (workerd) continuity leg
// ===========================================================================

/**
 * The wrapper the shared harness bundles (`src/units/_native.ts`). It adds only
 * fixture doors, in the pattern of `src/index.api-boundary.test.ts`'s wrapper:
 * a fixture clock (a module-level offset on `Date.now`, as that wrapper's
 * `w12Offset` does), the tenant's publication written by the real publication
 * code inside workerd, and two doors on the real `ShopperReflex` subclass that
 * read its storage and alarm and run its own alarm handler. Every shopper
 * request goes to the real Worker `fetch`.
 */
const NATIVE_WRAPPER = `
import worker, { ShopperReflex as NativeShopperReflex, PersonalizationWebSocket } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { shopperObjectName } from './src/tenancy/objects.ts';
export { PersonalizationWebSocket };
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;
export class ShopperReflex extends NativeShopperReflex {
  constructor(state, env) { super(state, env); this.w16State = state; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/__w16/state') {
      return Response.json({ entries: [...(await this.w16State.storage.list())], alarm: await this.w16State.storage.getAlarm() });
    }
    if (path === '/__w16/alarm') { await this.alarm(); return Response.json({ ran: true }); }
    return super.fetch(request);
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'w16-fixture') {
      const input = await request.json();
      if (url.pathname === '/clock') { offset = input.offset; return Response.json({ now: Date.now() }); }
      if (url.pathname === '/publish') {
        const revision = value => ({ revision: 1, at: 1, actor: 'w16-ledger-native', note: '', value });
        await initializePublicationSet(env, [
          { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
          { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) },
          { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
          { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) },
        ], '0:' + crypto.randomUUID());
        return Response.json({ published: true });
      }
      if (url.pathname === '/object') {
        const namespace = env.SHOPPER_REFLEX;
        return namespace.get(namespace.idFromName(shopperObjectName(input.tenant, input.subject))).fetch('https://w16-fixture' + input.path);
      }
      return new Response(null, { status: 404 });
    }
    return worker.fetch(request, env, ctx);
  },
};
`;

describe('unit:W16.R6', () => {
  it('native: in workerd, concurrent consumes rotate the chain exactly once and the object persists only the digest, generation and fixed expiry; across a real process restart the live generation consumes exactly once, spent generations stay spent, the alarm schedule survives and the alarm removes an expired descriptor while her taste stays, on both hosts', async () => {
    const bundle = await bundleNativeWorker(NATIVE_WRAPPER, 'w16-ledger-native');
    for (const host of HOSTS) {
      const directory = nativeScratchDirectory(`w16-ledger-native-${host}-`);
      const retention = JSON.stringify({ version: 1, tenants: fixtureCategories([OTHER_TENANT, TENANT]) });
      const options = { bundle, name: `w16ledger${host}`, persistDir: directory.path,
        durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket' },
        kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
        bindings: { DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: host, JWT_SECRET: 'w16-ledger-native-synthetic-signing-material-only',
          JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
          TENANTS: JSON.stringify({ provisioned: [OTHER_TENANT, TENANT] }), RETENTION: retention } };
      let runtime: NativeRuntime = await openNativeRuntime(options);
      try {
        const door = async (path: string, body: unknown) =>
          (await runtime.fetch(`https://w16-fixture${path}`, { method: 'POST', body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
        const clockAt = async (offset: number) => { await door('/clock', { offset }); };
        const engine = async (tenant: string, path: string, o: { capability?: string; body?: unknown } = {}) => {
          const response = await runtime.fetch(`${ENGINE_ORIGIN}${path}`, { method: o.body === undefined ? 'GET' : 'POST',
            headers: { 'X-Tenant': tenant, 'Content-Type': 'application/json', ...(o.capability ? { [SHOPPER_HEADER]: o.capability } : {}) },
            ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
          const text = await response.text();
          return { status: response.status, text, body: (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })() };
        };
        const sessionOf = (answer: { body: Record<string, unknown> }) => (answer.body.session ?? {}) as { subject?: string; sessionId?: string; capability?: string };
        const continuityOf = (answer: { body: Record<string, unknown> }) => (answer.body.continuity ?? {}) as ContinuityReport;
        const objectState = async (tenant: string, subject: string) =>
          await door('/object', { tenant, subject, path: '/__w16/state' }) as { entries: Array<[string, unknown]>; alarm: number | null };
        const continuityRecords = (state: { entries: Array<[string, unknown]> }) => state.entries.filter(([key]) => key.startsWith('continuity'));
        const heroOf = async (tenant: string, capability: string) =>
          (((await engine(tenant, `/v1/${tenant}/decisions/snapshot`, { capability, body: { page: 'home' } })).body.decisions ?? []) as Array<{ slot?: string; contentId?: string }>)
            .filter(decision => decision.slot === 'hero').map(decision => decision.contentId);
        /** A shopper who makes her explicit choice, browses her visit, and is issued her descriptor. */
        const returningShopper = async (tenant: string, events: typeof HER_VISIT) => {
          const established = sessionOf(await engine(tenant, `/v1/${tenant}/identity/session`, { body: {} }));
          const claims = claimsOf(established.capability!);
          const chosen = await engine(tenant, `/realtime/session/${established.sessionId}/preferences`, { capability: established.capability,
            body: { trackingConsent: true, personalizationEnabled: true, choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: claims.grantId, iat: claims.iat, exp: claims.exp } } });
          expect(chosen.status, `${host}: the fixture's own choice is accepted natively: ${chosen.text.slice(0, 160)}`).toBe(200);
          for (const event of events) {
            const acted = await engine(tenant, '/realtime/action', { capability: established.capability, body: { ...event, source: 'sdk',
              userId: established.subject, sessionId: established.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() } });
            expect(acted.status, `${host}: the fixture's own browsing is accepted natively: ${acted.text.slice(0, 160)}`).toBe(200);
          }
          const issued = continuityOf(await engine(tenant, `/v1/${tenant}/identity/session`, { capability: established.capability, body: {} }));
          expect(issued.enabled, `${host}: the native engine issues her descriptor`).toBe(true);
          return { subject: established.subject!, capability: established.capability!, proof: String(issued.proof), expiresAt: Number(issued.expiresAt), issued };
        };
        const consume = (tenant: string, proof: string) =>
          engine(tenant, `/v1/${tenant}/identity/session`, { body: { continuity: { proof, operationId: crypto.randomUUID() } } });

        for (const [tenant, continuity] of [[TENANT, CONTINUITY_DIRECT], [OTHER_TENANT, CONTINUITY_ALARM]] as const) {
          expect(await door('/publish', { tenant, reflex: reflexDocument(continuity), content: { pieces: FIXTURE_PIECES }, slots: FIXTURE_SLOTS, learn: FIXTURE_LEARN }),
            `${host}: the fixture publishes ${tenant}'s documents natively`).toEqual({ published: true });
        }
        await clockAt(0);
        const her = await returningShopper(TENANT, HER_VISIT);
        const alarmed = await returningShopper(OTHER_TENANT, THREE_TABBY_VIEWS);

        // C6.02, natively: the object keeps the digest, the generation and the
        // fixed expiry — and the raw proof in no stored record.
        const digest = await sha256Hex(her.proof);
        const stored = continuityRecords(await objectState(TENANT, her.subject)).filter(([, value]) => JSON.stringify(value).includes(digest));
        expect.soft(stored.length, `${host}: W16.R6 — exactly one persisted continuity record holds her descriptor's digest`).toBe(1);
        expect.soft(stored[0]?.[1], `${host}: W16.R6 — with its generation and original fixed expiry`).toMatchObject({ generation: 1, digest, expiresAt: her.expiresAt });
        const everything = (await objectState(TENANT, her.subject)).entries.map(([key, value]) => ({ name: `record ${key}`, text: JSON.stringify(value) }));
        const signature = her.proof.split('.').at(-1)!;
        // The scan is proven to have teeth on the real storage: the digest the
        // object may keep IS found by it.
        expect(sightings(everything, digest).length, `${host}: the scan sees what the object stores`).toBeGreaterThan(0);
        for (const needle of [her.proof, signature]) {
          expect.soft(sightings([...everything, { name: 'control', text: needle }], needle),
            `${host}: W16.R6 — neither the raw proof nor its signature is in any stored record`).toEqual(['control']);
        }
        // C6.11's schedule, natively: the object holds an alarm no later than the short descriptor's expiry.
        const scheduled = (await objectState(OTHER_TENANT, alarmed.subject)).alarm;
        expect.soft(scheduled ?? Number.POSITIVE_INFINITY, `${host}: W16.R6 — the object holds an alarm, at or before the descriptor's expiry`).toBeLessThanOrEqual(alarmed.expiresAt);
        // A live descriptor survives its object's alarm.
        await clockAt(HOUR_MS);
        await door('/object', { tenant: OTHER_TENANT, subject: alarmed.subject, path: '/__w16/alarm' });
        expect.soft(continuityRecords(await objectState(OTHER_TENANT, alarmed.subject)).length,
          `${host}: W16.R6 — before its expiry the alarm keeps the descriptor`).toBe(1);

        // C6.08, natively: two concurrent consumes of the same proof.
        await clockAt(2 * HOUR_MS);
        const [a, b] = await Promise.all([consume(TENANT, her.proof), consume(TENANT, her.proof)]);
        const recognized = [a, b].filter(answer => sessionOf(answer).subject === her.subject);
        const refused = [a, b].filter(answer => sessionOf(answer).subject !== her.subject);
        expect.soft(recognized.length, `${host}: W16.R6 — exactly one concurrent consume recognizes her`).toBe(1);
        expect.soft(refused.map(answer => continuityOf(answer)), `${host}: W16.R6 — and exactly one is a cold shopper`).toEqual([{ enabled: false, reason: 'consent' }]);
        expect.soft(continuityOf(recognized[0] ?? { body: {} }), `${host}: W16.R6 — rotated once, on the original fixed expiry`)
          .toMatchObject({ enabled: true, generation: 2, expiresAt: her.expiresAt });
        const live = String(continuityOf(recognized[0] ?? { body: {} }).proof);
        const rotated = continuityRecords(await objectState(TENANT, her.subject));
        expect.soft(rotated.map(([, value]) => value), `${host}: W16.R6 — the object persists the rotated generation and the live digest`)
          .toEqual([expect.objectContaining({ generation: 2, digest: await sha256Hex(live), expiresAt: her.expiresAt })]);

        // A REAL PROCESS RESTART over the same persisted storage.
        await runtime.dispose();
        runtime = await openNativeRuntime(options);

        // C6.11 after the restart: the schedule survived, and past the expiry the
        // alarm removes the descriptor and nothing else of hers.
        const persistedAlarm = (await objectState(OTHER_TENANT, alarmed.subject)).alarm;
        expect.soft(persistedAlarm ?? Number.POSITIVE_INFINITY,
          `${host}: W16.R6 — the alarm schedule survives the restart, still at or before the descriptor's expiry`).toBeLessThanOrEqual(alarmed.expiresAt);
        await clockAt(ALARM_WINDOW_MS + 60_000);
        await door('/object', { tenant: OTHER_TENANT, subject: alarmed.subject, path: '/__w16/alarm' });
        expect.soft(continuityRecords(await objectState(OTHER_TENANT, alarmed.subject)),
          `${host}: W16.R6 — after its expiry the alarm removes the descriptor`).toEqual([]);
        expect.soft(await heroOf(OTHER_TENANT, alarmed.capability), `${host}: W16.R6 — and her retained taste is untouched`).toEqual([TABBY, ROGUE]);
        expect.soft(continuityOf(await consume(OTHER_TENANT, alarmed.proof)), `${host}: W16.R6 — the removed descriptor is a cold shopper`)
          .toEqual({ enabled: false, reason: 'consent' });

        // C6.08 after the restart: the live generation consumes exactly once; spent generations stay spent.
        await clockAt(7 * DAY_MS);
        const after = await consume(TENANT, live);
        expect.soft(sessionOf(after).subject, `${host}: W16.R6 — after the restart the live generation still recognizes her`).toBe(her.subject);
        expect.soft(continuityOf(after), `${host}: W16.R6 — and rotates exactly once more`).toMatchObject({ enabled: true, generation: 3, expiresAt: her.expiresAt });
        for (const [why, proof] of [['the same generation presented again', live], ['the first generation', her.proof]] as const) {
          const spent = await consume(TENANT, proof);
          expect.soft({ continuity: continuityOf(spent), hers: sessionOf(spent).subject === her.subject },
            `${host}: W16.R6 — ${why} after the restart is a cold shopper`).toEqual({ continuity: { enabled: false, reason: 'consent' }, hers: false });
        }
        expect.soft(await heroOf(TENANT, String(sessionOf(after).capability)), `${host}: W16.R6 — and her own taste ranks her page after the restart`).toEqual([TABBY, ROGUE]);
        expect(runtime.outboundAttempts(), `${host}: nothing reached the network`).toBe(0);
      } finally { await runtime.dispose(); directory.remove(); }
    }
  }, 300_000);
});

// ===========================================================================
// THE EXACT LOST-RESPONSE RETRY BESIDE THE PROVISIONAL CAPABILITY (C6, R4)
//
// Added after the W16 delivery review of 55a4490 (rem-reviewer, FAIL, defects 1
// and 2: `_evidence/W16-delivery/reviewer/REPORT.md`). Both defects break
// criteria already frozen: C6 "... with exact lost-response retry" and R4 "...
// the broker (cookie) mode lost-response retry succeeds exactly once; a
// provisional subject holds no state of its own after recognition". No
// criterion, command or path changes. The C6 units carry the retry (both
// modes, by C6's own words); the R4 legs carry R4's third clause — no state of
// its own after recognition — on this lost-response path, joined with that
// retry so both are measured on one product. R4's broker clause keeps its own
// leg above (`unit:W16.R4`, broker mode).
//
// WITNESSES — every expected value below comes from these, never from an answer:
//  - kit `docs/kit/02-api-reference.md` (55a4490 :451; 9830cce :429): the exact
//    retry of a lost answer "is honoured once from one deterministic successor
//    receipt, with the same subject, the same generation, the same grant and the
//    same successor proof"; "a second retry ... [is] a cold shopper: a brand-new
//    anonymous subject served the catalogue's own order". Direct mode presents
//    `{ continuity: { proof, operationId } }`.
//  - kit 02 (55a4490 :432-434; 9830cce :414-416): the unavailable retry is the one
//    case where a return may carry `X-Shopper-Session`, completed beside a
//    capability whose session is itself anonymous. R4 and kit 02 at 55a4490
//    :436-438: once she is recognized the provisional subject is retired — it
//    holds no state of its own and its capability reads nothing.
//  - `src/routes/identity.ts` at 55a4490 :227-229 ("the browser's exact retry is
//    answered from the one deterministic receipt") and :342-343 ("its single use,
//    its one rotation and its one deterministic retry").
//  - kit 02 at 55a4490 :453: "A return whose answer was lost is presented again
//    on the next load as the same consume, answered once from the one receipt;
//    that retry is not treated as unknown consent, because its answer carries the
//    consent of the session it establishes, while a refusal the shopper made is
//    restored from its own marker and still turns the return away." Against it,
//    `src/sdk/core.ts` at 55a4490 :614-619 (`returnInFlight` gives up when a
//    capability is stored) and :716 (the unknown-consent marker it guards).
//
// ONE PRODUCT. The retirement R4 demands is of the provisional subject's STATE and
// of what its capability READS. Nothing here asks the retired capability to read or
// hold anything; C6.14 asks only that the exact retry of the consume presented
// beside it be answered from her own object's one receipt. `unit:W16.R4.retry`
// states both at once, on the host and through the real SDK.
//
// THE CONSENT THE RETRY CARRIES: none of its own. Its body is the direct-mode
// return exactly as kit 02 writes it, `{ continuity: { proof, operationId } }`:
// she made no refusal, so there is no hint to carry (kit 02 :453), and the
// unknown-consent marker is not a choice of hers. Its ANSWER carries the consent
// of the session it establishes — her own explicit choice, made on her first
// visit and stored in her own object (both switches on, its 30-day deadline not
// reached), which the SDK then holds. The W05 fail-closed remedy stays: nothing
// here treats a request without a known choice as consent; the engine answers
// the choice her own object already holds (kit 02 "Explicit consent": missing
// hints are neutral to valid server authority, false hints only restrict it).
//
// MODE. Direct mode, the mode in which the review measured both defects. Broker
// mode beside a provisional session is on that review's "not measured" list and
// is not specified here.
// ===========================================================================

const OPERATION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `provisionalThenRecognized`'s arrangement up to, and NOT including, her
 * recognizing load: her descriptor and her Tabby taste; a week later an outage on
 * her return, which serves her a PROVISIONAL anonymous session (W16.C6.13) and
 * leaves her browser holding her proof and the operation id of the interrupted
 * consume; on that provisional session her explicit choice and a taste that is
 * not hers. The clock is left at the moment of her recognizing load.
 */
async function provisionalServed(h: HostFixture, clock: { mockReturnValue: (at: number) => unknown }) {
  const her = sdkBrowser(h);
  expect((await her.load()).adopted, 'load 1 establishes her session').toBe(true);
  await her.choose();
  const second = await her.load();
  expect(second.adopted, 'load 2 issues her recognition descriptor').toBe(true);
  const issuedProof = her.held().proof;
  expect(issuedProof.length, 'her browser holds a real direct-mode proof').toBeGreaterThan(32);
  const herSubject = her.subject();
  for (const [index, view] of THREE_TABBY_VIEWS.entries()) {
    clock.mockReturnValue(T0 + index * STEP_MS);
    await second.core.send('product_view', view.data);
  }
  await h.f.drain();

  // A week later, her object unreachable for the consume: the provisional session.
  clock.mockReturnValue(T0 + 7 * DAY_MS);
  her.forgetCapability();
  h.f.setFault({ match: '/identity/continuity/consume', kind: '5xx' });
  expect((await her.load()).adopted, 'the outage load still serves her a session').toBe(true);
  h.f.setFault(null);
  const provisional = { subject: her.subject(), capability: her.capability(), sessionId: her.sessionId() };
  expect({ anonymous: /^vis-[0-9a-f-]{36}$/.test(provisional.subject), hers: provisional.subject === herSubject },
    'the outage served a provisional anonymous subject that is not hers').toEqual({ anonymous: true, hers: false });
  const held = her.held();
  expect({ proof: held.proof === issuedProof, operationId: OPERATION_ID_SHAPE.test(held.operationId) },
    'precondition (W16.C6.13): her browser kept her proof and the operation id of the consume the outage interrupted')
    .toEqual({ proof: true, operationId: true });

  // On it: her explicit choice, and a taste that is not hers.
  await her.choose(true);
  for (const [index, view] of PROVISIONAL_VISIT.entries()) {
    clock.mockReturnValue(T0 + 7 * DAY_MS + (index + 1) * STEP_MS);
    const answered = await h.action(provisional.capability, view);
    expect(answered.status, `the provisional session's browsing is accepted: ${answered.text.slice(0, 160)}`).toBe(200);
  }
  const provisionalRead = await h.rawHydrate(provisional.capability);
  expect({ taste: linesOf(provisionalRead.body), personalization: provisionalRead.body.consent?.personalization ?? false },
    'control: before recognition the provisional subject holds a taste and a choice of its own')
    .toEqual({ taste: ['Rogue'], personalization: true });
  clock.mockReturnValue(T0 + 7 * DAY_MS + 10 * STEP_MS);
  return { her, herSubject, provisional, held };
}

/** One `POST /v1/:tenant/identity/session` exchange as the browser's network carried it. */
interface SessionExchange { capability: string | null; body: unknown; status: number; answer: Record<string, unknown> | null; lost: boolean }

/**
 * The browser's network in front of the mounted engine, for `sdkBrowser`: every
 * session request the SDK makes is recorded with the engine's own answer, and the
 * next answer can be LOST — the engine did all of its work and nothing of the
 * answer (no body, no Set-Cookie) reaches the browser, exactly as
 * `brokerBrowser.loseNextAnswer` loses a broker answer.
 */
function browserNetwork(h: HostFixture) {
  const exchanges: SessionExchange[] = [];
  let loseNext = false;
  const call: HostFixture['f']['call'] = async (path, options = {}) => {
    const response = await h.f.call(path, options);
    if (!path.endsWith('/identity/session')) return response;
    const text = await response.clone().text();
    const lost = loseNext;
    loseNext = false;
    exchanges.push({ capability: options.capability ?? null, body: options.body ?? null, status: response.status, lost,
      answer: (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })() });
    if (!lost) return response;
    await h.f.drain();
    return new Response(null, { status: 502 });
  };
  return { h: { ...h, f: { ...h.f, call } } as HostFixture, exchanges, loseNextAnswer: () => { loseNext = true; } };
}

/** What an exchange presented as its continuity, and what the engine answered to it. */
const presentedContinuity = (exchange: SessionExchange) => (exchange.body as { continuity?: unknown } | null)?.continuity ?? null;
const answeredTo = (exchange: SessionExchange) => ({ status: exchange.status,
  subject: String(((exchange.answer?.session ?? {}) as { subject?: unknown }).subject ?? ''),
  continuity: (exchange.answer?.continuity ?? null) as ContinuityReport | null });

/**
 * Defect 1's arrangement: the provisional session, then her return presented
 * beside its capability — which recognizes her — and, the answer lost, the very
 * same request again: the same capability, the same proof, the same operation id.
 */
async function exactRetryBesideProvisional(host: typeof HOSTS[number], clock: { mockReturnValue: (at: number) => unknown }) {
  clock.mockReturnValue(T0);
  const h = await hostFixture(host, { continuity: CONTINUITY_DIRECT });
  const { herSubject, provisional, held } = await provisionalServed(h, clock);
  const exact = { capability: provisional.capability, proof: held.proof, operationId: held.operationId };
  const first = await h.identitySession(exact);
  expect({ status: first.status, subject: first.subject, generation: first.continuity?.generation },
    `${host}: precondition (W16.C6.13) — her return presented beside the provisional capability recognizes HER subject and rotates her chain once: ${first.bodyText.slice(0, 160)}`)
    .toEqual({ status: 200, subject: herSubject, generation: 2 });
  // Her browser never saw that answer, and sends the same request again.
  const retry = await h.identitySession(exact);
  return { h, herSubject, provisional, first, retry };
}

/**
 * Defect 2's arrangement, driven only by the real SDK: the provisional session;
 * her recognizing load, whose answer is LOST after the engine recognized her; and
 * her very next load. `asItStood` is her browser's storage right after the lost
 * answer, for the exactly-once replay.
 */
async function lostReturnThenNextLoad(host: typeof HOSTS[number], clock: { mockReturnValue: (at: number) => unknown }) {
  clock.mockReturnValue(T0);
  const network = browserNetwork(await hostFixture(host, { continuity: CONTINUITY_DIRECT }));
  const h = network.h;
  const { her, herSubject, provisional, held } = await provisionalServed(h, clock);

  // Her recognizing load. The engine recognizes her; the answer never arrives.
  network.loseNextAnswer();
  expect((await her.load()).adopted, `${host}: harness — the lost answer adopts nothing`).toBe(false);
  const lost = network.exchanges.filter(exchange => exchange.lost);
  expect(lost.map(exchange => ({ presented: presentedContinuity(exchange), ...answeredTo(exchange) })),
    `${host}: precondition (W16.C6.13) — the answer lost is the one that recognized HER, on the consume her browser kept, rotating her chain once`)
    .toEqual([{ presented: { proof: held.proof, operationId: held.operationId }, status: 200, subject: herSubject,
      continuity: expect.objectContaining({ enabled: true, mode: 'direct', generation: 2 }) }]);
  const lostContinuity = answeredTo(lost[0]!).continuity!;
  const asItStood = new Map(her.store);

  // Her very next load, driven only by the SDK with whatever her browser holds.
  clock.mockReturnValue(T0 + 7 * DAY_MS + 11 * STEP_MS);
  const mark = network.exchanges.length;
  const next = await her.load();
  const retries = network.exchanges.slice(mark).filter(exchange => {
    const presented = presentedContinuity(exchange) as { proof?: unknown; operationId?: unknown } | null;
    return presented?.proof === held.proof && presented?.operationId === held.operationId;
  });
  return { h, her, herSubject, provisional, held, lostContinuity, asItStood, next, retries };
}

describe('unit:W16.C6.14', () => {
  it('host: the exact retry of a return recognized beside the provisional capability an outage served her — the same capability, proof and operation id — is answered as the first answer was: 200, her own subject, the same generation, grant and successor proof, never refused as an unavailable session, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        const { herSubject, first, retry } = await exactRetryBesideProvisional(host, clock);
        expect.soft({ status: retry.status, subject: retry.subject, continuity: retry.continuity ?? null,
          grant: retry.capability ? claimsOf(retry.capability) : null },
        `${host}: W16.C6.14 — the exact retry of the lost answer is answered from the one deterministic successor receipt: 200, HER subject, the same generation, the same grant and the same successor proof (answered ${retry.status}: ${retry.bodyText.slice(0, 120)})`)
          .toEqual({ status: 200, subject: herSubject, continuity: first.continuity, grant: claimsOf(first.capability) });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.C6.15', () => {
  it('sdk: joined — when the answer that recognized her beside the provisional capability is lost, the real SDK presents that return again on the very next load, exactly once, as the same consume carrying no consent of its own, and she is recognized as her own subject under her own explicit choice — never the unknown-consent refusal that makes her a new anonymous shopper — on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        const { h, her, herSubject, held, lostContinuity, asItStood, next, retries } = await lostReturnThenNextLoad(host, clock);

        // The retry, as her browser sent it: once, the same consume, no consent hint she never gave.
        expect.soft(retries.map(exchange => exchange.body),
          `${host}: W16.C6.15 — on the very next load the real SDK presents the lost return again exactly once, as the same consume (her proof, the same operation id) in the direct-mode return body, carrying no consent of its own — never the unknown-consent refusal`)
          .toEqual([{ continuity: { proof: held.proof, operationId: held.operationId } }]);
        // The engine's answer to it: the one receipt.
        expect.soft(retries.map(answeredTo),
          `${host}: W16.C6.15 — and that retry is answered as the lost answer was, from the one receipt: 200, HER subject, the same generation and the same successor proof — not a new anonymous shopper with continuity disabled for consent`)
          .toEqual([{ status: 200, subject: herSubject, continuity: lostContinuity }]);
        // What her browser holds afterwards.
        expect.soft({ adopted: next.adopted, subject: her.subject(), consent: next.core.consent, proof: her.held().proof },
          `${host}: W16.C6.15 — her browser adopts HER session under her own explicit choice (both switches on: the retry is not treated as unknown consent) and keeps the successor proof of her own chain`)
          .toEqual({ adopted: true, subject: herSubject, consent: { tracking: true, personalization: true }, proof: lostContinuity.proof });
        expect.soft(her.capability() ? (await h.rawSnapshot(her.capability())).ranking.hero : null,
          `${host}: W16.C6.15 — and her own remembered taste ranks her page`).toEqual([TABBY, ROGUE]);

        // EXACTLY ONCE: her browser exactly as it stood after the lost answer
        // presents the same return again — a second retry, never recognized.
        // (Green by construction on a product that recognizes nothing on this
        // path; it is the half no repair may break.)
        const replay = sdkBrowser(h);
        for (const [key, value] of asItStood) replay.store.set(key, value);
        const replayed = await replay.load();
        expect.soft({ adopted: replayed.adopted, hers: replay.subject() === herSubject,
          hero: replay.capability() ? (await h.rawSnapshot(replay.capability())).ranking.hero : null },
        `${host}: W16.C6.15 — the same return presented a second time is a cold shopper served the catalogue's own order`)
          .toEqual({ adopted: true, hers: false, hero: HERO_BASE_ORDER });
      }
    } finally { clock.mockRestore(); }
  });
});

describe('unit:W16.R4.retry', () => {
  it('host: both at once — the exact retry of her return recognized beside the provisional capability is answered as hers, AND after it the provisional subject holds no state of its own (its capability reads no taste and no choice) and nothing of it was merged into hers, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        const { h, herSubject, provisional, first, retry } = await exactRetryBesideProvisional(host, clock);
        expect.soft({ status: retry.status, subject: retry.subject },
          `${host}: W16.R4 joined with W16.C6.14 — the exact retry beside the provisional capability is answered as HER (answered ${retry.status}: ${retry.bodyText.slice(0, 120)})`)
          .toEqual({ status: 200, subject: herSubject });
        const after = await h.rawHydrate(provisional.capability);
        const own = await h.rawHydrate(first.capability);
        expect.soft({ provisional: { taste: linesOf(after.body), personalization: after.body.consent?.personalization ?? false }, own: linesOf(own.body) },
          `${host}: W16.R4 — and after recognition and its retry the provisional subject holds no state of its own (its capability reads no taste and no choice; status ${after.status}), and her own profile holds only her own taste`)
          .toEqual({ provisional: { taste: [], personalization: false }, own: ['Tabby'] });
      }
    } finally { clock.mockRestore(); }
  });

  it('sdk: joined — after the answer that recognized her beside the provisional capability is lost, the real SDK\'s next load brings HER back with her own taste and nothing of the provisional subject merged into it, and the provisional subject holds no state of its own, on both hosts', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const host of HOSTS) {
        const { h, her, herSubject, provisional, next } = await lostReturnThenNextLoad(host, clock);
        const own = her.capability() ? await h.rawHydrate(her.capability()) : null;
        expect.soft({ adopted: next.adopted, subject: her.subject(), taste: linesOf(own?.body) },
          `${host}: W16.R4 joined with W16.C6.15 — the lost-response retry succeeds through the real SDK: her next load brings back HER subject, with her own taste and nothing of the provisional subject merged into it`)
          .toEqual({ adopted: true, subject: herSubject, taste: ['Tabby'] });
        const after = await h.rawHydrate(provisional.capability);
        expect.soft({ taste: linesOf(after.body), personalization: after.body.consent?.personalization ?? false },
          `${host}: W16.R4 — and after recognition the provisional subject holds no state of its own: its capability reads no taste and no choice (status ${after.status})`)
          .toEqual({ taste: [], personalization: false });
      }
    } finally { clock.mockRestore(); }
  });
});
