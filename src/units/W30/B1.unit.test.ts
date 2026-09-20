// src/units/W30/B1.unit.test.ts
// W30 batch B1 — late/mutable hours: the higher-cap repair, maturity made
// explicit, date-scoped visitors with their evicted and unplaced carry-in, every
// flag propagated to both reports and both screens, and multi-hour catch-up
// under the cron's own budget.
//
// One `describe('unit:W30.<id>')` per unit of the batch, one `it` per ruled leg.
// The witnesses, the ruled outcome and the residual are on each unit's row in
// docs/remediation/units.json (batch W30-B1).
//
// The harness is the one `src/units/W22/B2.unit.test.ts` uses (itself after
// `src/units/W22/B1.unit.test.ts` and `src/units/W20/B2.unit.test.ts`): the real
// mounted application over a real in-process R2 double, the real ledger producer
// and consumer, the real Durable Object classes, and the shipped screens under
// jsdom. None of those files is imported or edited here, because importing a
// `.test.ts` would register its whole suite a second time.
//
// WHAT THIS BATCH REUSES AND NEVER RE-SPECIFIES:
//  · W22.R1.02 (`src/units/W22/B2.unit.test.ts:370`) — the re-fold on a grown
//    prefix, the per-hour folded set, date-keyed `seenDays`. Locked here by name
//    in one place (W30.V1.01 clause (i)), never re-proved.
//  · W22.R1.03 (`src/units/W22/B1.unit.test.ts:1024`) — `unadvancedHours` and
//    `truncatedHours` on both reports and both screens. Extended here by name;
//    the old members are not re-asserted on the screens.
//  · W22.A1.01 (`src/units/W22/B1.unit.test.ts:1185`) — `attributionContract`.
//    Locked here as the statement of which history the aggregate path applied.
//  · W21.C1.08 (`src/units/W21/B3.unit.test.ts:625`) — `assignments` and
//    `coverage.unassignedHours`. This batch closes that build review's finding 1
//    (the later-hour carry-in outcome) without changing either member.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import * as hourly from '@/learn/hourly';
import { buildHour, catchUp, hourKey, runDayReport, shardKey, DEFAULT_HORIZON_MS, HOUR_MS, MAX_HOUR_OBJECTS,
  type HourAggregate, type HourBrand, type ShardState } from '@/learn/hourly';
import { DEFAULT_POLICY } from '@/learn/policy';
import type { DayReport, DuplicateCounts, ReportCoverage } from '@/learn/report';
import type { WindowReport } from '@/measure/window';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (tapestry_requirements A.3.6 — Coach), plus the
// cross-category and unknown-taxonomy rows this batch needs.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w30-b1-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const MIN = 60_000;
const H = HOUR_MS;
const DAY_MS = 86_400_000;

/** The day every ledger fixture below is written into, and the hour inside it. */
const DATE = '2026-09-03';
const PREVIOUS = '2026-09-02';
const HOUR = 12;
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
/** The moment hour 12 ends; every maturity statement below is measured from it. */
const HOUR12_END = T12 + H;

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});

const W30_PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
  // Cross-category and unknown-taxonomy rows are part of the fixture, not an afterthought.
  piece('cnt-charms-slg', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
  piece('cnt-tabby-work', { title: 'Tabby, at the desk',
    tags: { line: ['Tabby'], occasion: ['work'], category: ['Handbags'] } }),
  piece('cnt-unknown-taxonomy', { title: 'A piece the taxonomy does not know', tags: {} }),
];
const W30_CATALOGUE = { version: 'w30-b1-coach-catalogue', pieces: W30_PIECES };
const W30_SLOTS: SlotCatalog = { version: 'w30-b1-coach-slots',
  pages: { home: [
    { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
    // The second slot learns from purchases, the reward whose published policy
    // window is seven days: the history N23 measures the 48-hour fold against.
    { slot: 'story', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  ] } };

/**
 * The tenant's published learning document. `holdout.share: 0` so every fixture
 * decision is `personalized` and each count below is exact; the attribution
 * policy is the platform default, whose `purchase` window is seven days
 * (`src/learn/policy.ts` DEFAULT_POLICY.windowsMs.purchase).
 */
const W30_LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w30-b1', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' }, story: { reward: 'purchase' } },
} as unknown as LearnConfig;

/** The cell every fixture decision carries: one known Coach cell and one unknown one. */
const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, with
// the REAL DecisionRing, LearnStats and ShopperReflex classes.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) as unknown : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  /** How many times each key has been written: a second write is a second version. */
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string, options?: R2GetOptions) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length, customMetadata: this.metadata.get(key),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absentOnly = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absentOnly && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: new TextEncoder().encode(this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
  json<T>(key: string): T { return JSON.parse(this.objects.get(key)!) as T; }
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w30-b1-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  storage: UnitR2;
  queued: unknown[];
  fetch: (input: Request) => Promise<Response>;
  drain: () => Promise<void>;
  operatorToken: string;
}

async function mount(): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [];
  const queued: unknown[] = [];
  const storage = new UnitR2();
  const shoppers = new Map<string, DurableRegistry>(), rings = new Map<string, DurableRegistry>(), stats = new Map<string, DurableRegistry>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: new UnitKV(), SESSIONS: new UnitKV(),
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session', STORAGE: storage,
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w30-b1-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    LEDGER_RECOVERY_ENABLED: 'false',
    // The recovery configuration the read-conflict filing path requires
    // (`src/ledger/quarantine.ts:252`), as the shipped deployment declares it.
    LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'events', deadLetterQueue: 'events-dead-letter',
      unknown: { id: 'w30-b1-quarantine', revision: 1, durationMs: 30 * DAY_MS, basis: 'admitted', renewal: 'new-record-only', disposal: 'delete-on-expiry' } }),
    IDENTITY_SALT: 'w30-b1-synthetic-quarantine-provenance-salt',
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); } },
  } as unknown as Env;
  env.RETENTION = JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT]) });

  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, DurableRegistry>) => ({
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = registry.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [];
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
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), rings) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), stats) as unknown as DurableObjectNamespace;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a').setExpirationTime('2h')
    .sign(new TextEncoder().encode(OPERATOR_SECRET));

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w30-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, W30_CATALOGUE),
    baseline(SLOTS_KIND, W30_SLOTS),
    baseline(LEARN_KIND, W30_LEARN),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  return { env, storage, queued, fetch: fetchOne, drain, operatorToken };
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

async function operatorPost(m: Mounted, path: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, {
    method: 'POST', headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

// ── the fixture's own records, minted the way the engine mints them ─────────

function decision(env: Env, visitor: string, ts: number, item: string, slot: 'hero' | 'story' = 'hero'): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:${slot}:0`,
    tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
    page: 'home', slot, position: 0, item_id: item, customer_item_id: `CMS-${item}`, candidates: [],
    cell: visitor.startsWith('u-') ? UNKNOWN_CELL : COACH_CELL, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w30-b1',
    explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    retention: captureRetention(env as never, TENANT, ts, ts),
  } as unknown as DecisionRecord;
}

/** A click on the item a visitor was served, with the engine's own event nonce. */
function click(env: Env, d: DecisionRecord, ts: number, nonce: string): OutcomeRecord {
  const outcome = outcomeFromAction({ type: 'content_click', userId: d.visitor_id, sessionId: d.session_id ?? undefined, timestamp: ts,
    eventId: nonce, eventIdSource: 'provided', data: { contentId: d.item_id, slot: d.slot } } as never, TENANT, BRAND)!;
  return { ...outcome, retention: captureRetention(env as never, TENANT, ts, ts) } as OutcomeRecord;
}

/**
 * Put the fixture on the queue with the real producer and write it with the real
 * consumer. Each call is ONE delivery, so it writes one ledger object per hour
 * and stream (`src/ledger/writer.ts:85`, the key carries the batch id): five
 * calls into one hour are the five OBJECTS the object-scan cap counts.
 */
async function throughTheLedger(m: Mounted, decisions: DecisionRecord[], outcomes: OutcomeRecord[], now: number): Promise<void> {
  if (decisions.length) await enqueueDecisions(m.env, decisions);
  for (const outcome of outcomes) await enqueueOutcome(m.env, outcome);
  const wire = m.queued.splice(0);
  const result = await consumeLedger(m.env, wire, now);
  expect(result.error, 'the fixture ledger batch must be written by the real consumer').toBeUndefined();
  expect(result.ok, 'the fixture ledger batch must be acknowledged by the real consumer').toBe(true);
}

// ── what the ruled answers are read off ─────────────────────────────────────

/** A ruled member that is absent reads as this sentence, so the diff names it. */
const absent = (what: string, saw: unknown): string =>
  `absent: ${what} — the answer carries ${Object.keys((saw ?? {}) as object).sort().join(', ')}`;

/**
 * The coverage block with the members this batch rules. Every one of them is
 * OPTIONAL in stored evidence (R149): a report written before this release
 * carries none and is still `metadata: 'recorded'`.
 */
type W30Coverage = ReportCoverage & {
  /** The published re-fold horizon: the window inside which a folded hour is still re-checked. */
  refoldHorizonMs?: number | null;
  /** Per built hour: `open` while inside that horizon, `final` past it. */
  maturities?: Array<{ hour: number; maturity: 'open' | 'final' }>;
  /** Rows that reached an hour's ledger prefix after the hour became final: counted, named, never applied. */
  lateAfterMaturity?: Array<{ hour: number; objects: number }>;
  /** Per built hour, the outcomes whose carry-in history the fold could not reach. */
  carryInHours?: Array<{ hour: number; evicted: number; unplaced: number }>;
  /** Per built hour, the ledger objects it holds and the objects the fold opened. */
  objectScan?: Array<{ hour: number; objects: number; read: number }>;
  /** The version-1 shard migration bound: the earliest hour a repair can still put into the rings. */
  recoveryFromMs?: number | null;
};
type W30Brand = HourBrand & {
  carryIn?: { evicted: number; unplaced: number };
  conflicts?: DuplicateCounts;
};
type W30Aggregate = HourAggregate & { lateObjects?: number; recoveryFrom?: number };

const coverageOf = (report: DayReport | undefined): W30Coverage => (report?.coverage ?? {}) as W30Coverage;
const brandOf = (agg: HourAggregate, brand = BRAND): W30Brand => (agg.brands[brand] ?? {}) as W30Brand;
const dayOf = (body: Record<string, unknown>): DayReport => (body as { report: DayReport }).report;
const windowOf = (body: Record<string, unknown>): WindowReport => (body as { report: WindowReport }).report;

/**
 * The ruled maturity window, read off the module: its VALUE is the owner's
 * (`W30.P1.01`), so every assertion below is computed from whatever the module
 * compiles, never from a number written here.
 */
const maturityWindow = (): number | undefined => (hourly as unknown as { REFOLD_MATURITY_MS?: number }).REFOLD_MATURITY_MS;
const MATURITY_EXPORT = '`REFOLD_MATURITY_MS`, the published re-fold horizon exported from src/learn/hourly.ts';

/** The shard state as it stands, for the observables no public route exposes. */
const shardOf0 = (m: Mounted): ShardState & { seenDays?: Record<string, Record<string, string[]>> } =>
  m.storage.json<ShardState>(shardKey(TENANT, 0));
const ringItems = (m: Mounted, visitor: string): string[] => (shardOf0(m).rings[visitor] ?? []).map(entry => entry.item);
const storedHour = (m: Mounted, date: string, hour: number): W30Aggregate =>
  m.storage.json<W30Aggregate>(hourKey(TENANT, date, hour));

/**
 * The cron's own fold, run to quiescence: `catchUp(env.STORAGE, tenant, learn,
 * now, opts, env)` exactly as `src/index.ts:272` runs it. One five-minute run
 * folds at most two hours, so the loop is a quarter of an hour of real runs.
 */
type FoldOptions = Parameters<typeof catchUp>[4];
async function fold(m: Mounted, now: number, opts: FoldOptions = {}, maxRuns = 40): Promise<{
  built: Array<{ date: string; hour: number }>; failed: string[]; perRun: number[]; pending: number;
}> {
  const built: Array<{ date: string; hour: number }> = [], failed: string[] = [], perRun: number[] = [];
  let pending = -1;
  for (let run = 0; run < maxRuns; run++) {
    const result = await catchUp(m.storage as never, TENANT, W30_LEARN, now, opts, m.env as never);
    perRun.push(result.built.length);
    for (const hour of result.built) built.push({ date: hour.date, hour: hour.hour });
    for (const hour of result.failed) failed.push(`${hour.date} ${hour.hour}`);
    pending = result.pending;
    if (!result.built.length) break;
  }
  return { built, failed, perRun, pending };
}
const hoursOf = (built: Array<{ date: string; hour: number }>, date = DATE): number[] =>
  built.filter(entry => entry.date === date).map(entry => entry.hour);

/**
 * The day built from the hour aggregates and SAVED, at a PINNED moment. Every
 * maturity statement below is measured against the time the report was built,
 * so no assertion here reads the wall clock: the mounted rebuild route passes
 * `Date.now()` (`src/routes/decisions.ts:1084`), which would put every fixture
 * hour years past any published horizon. This is the call W22.R1.03 uses for the
 * same reason (`src/units/W22/B1.unit.test.ts:1057`).
 */
const publish = (m: Mounted, now: number, date = DATE): Promise<DayReport> =>
  runDayReport(m.storage as never, { tenant: TENANT, brand: BRAND, date }, W30_LEARN, null, now, {}, m.env as never);

/**
 * Does one SENTENCE of what a screen rendered carry all of these? The wording is
 * the implementation's to choose; what is ruled is that the fact and the hour it
 * is about are said together, so a reader is not left to join them.
 */
const says = (text: string, ...patterns: RegExp[]): boolean =>
  text.split('.').some(sentence => patterns.every(pattern => pattern.test(sentence)));

// ===========================================================================
// unit:W30.R1.01 — the higher-cap repair
// ===========================================================================

describe('unit:W30.R1.01', () => {
  /**
   * Document 35 §5 row W30: "handle higher-cap repairs … explicitly." F17 P6
   * measured the whole fault, and the W22 whole-W review routed it here:
   * "`staleHour` fires on `objects > agg.objects` only, and `agg.objects` is
   * already the full prefix count, so a cap raise never re-folds."
   *
   * F17 P6, measured again at specification on this product (probe, reverted):
   *   fold with cap 2 -> objects: 5 read: 2 truncated: true decisions: 2
   *   ring after the truncated fold: ["item0","item1"]
   *   hour 13 credits (the click on the fifth item): 0
   *   catch-up at cap 600 -> hour 12 is NOT re-folded (stored: read 2, truncated true)
   *   manual rebuild with cap 600 -> read 5 truncated: false ringsFolded: false
   *   ring after the rebuild: ["item0","item1"]        <- the recovered rows never enter the rings
   *   hour 13 credits after the rebuild: 0
   * F17's own words: "Raising `MAX_HOUR_OBJECTS` after the fact makes the report
   * look MORE complete while attribution stays broken."
   *
   * RULED: a truncated hour is REPAIRABLE. The cap is an input of the fold
   * (`BuildOptions.maxObjects`, already), and a fold asked for more than the
   * stored one read rebuilds the hour, admits the recovered rows to the rings
   * (`ringsFolded: true`), carries the cross-hour credit into the next hour, and
   * clears `truncated` only when the object count is complete. A cap raise is an
   * explicit repair the caller asked for, so it is NOT bounded by the maturity
   * window W30.M1.01 rules — that window governs the AUTOMATIC re-fold on a
   * grown prefix, never a requested one (no blanket age cutoff).
   */
  const SERVED = ['cnt-tabby-evening', 'cnt-rogue-work', 'cnt-charms-slg', 'cnt-tabby-work', 'cnt-unknown-taxonomy'];

  /** Five ledger OBJECTS in hour 12, one per delivery, and a click in hour 13 on the fifth. */
  async function truncatedHour(m: Mounted): Promise<void> {
    const rows: DecisionRecord[] = [];
    for (let n = 0; n < SERVED.length; n++) {
      const d = decision(m.env, 'v-tabby', T12 + (n + 1) * MIN, SERVED[n]!);
      rows.push(d);
      await throughTheLedger(m, [d], [], T12 + (n + 1) * MIN + 1000);
    }
    // 13:05, on the item the fifth object served, inside the platform's default
    // thirty-minute click window (`src/learn/policy.ts` DEFAULT_POLICY): the
    // credit depends on the repaired hour reaching the ring and on nothing else.
    await throughTheLedger(m, [], [click(m.env, rows[4]!, T12 + H + 5 * MIN, 'w30-b1-cross-hour')], T12 + H + 6 * MIN);
  }

  it('logic: a truncated hour rebuilt at a higher cap re-folds, the rings hold the recovered decisions, the cross-hour credit follows, and a rebuild still short of the count stays truncated', async () => {
    const m = await mount();
    await truncatedHour(m);
    const options = { shards: 1 };

    const low = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, T12 + H + 6 * MIN, { ...options, maxObjects: 2 }, m.env as never);
    expect({ objects: low.objects, read: low.objectsRead, truncated: low.truncated },
      'the fixture: five ledger objects in hour 12 and a fold that could open two, so the hour is truncated at the cap (F17 P6)')
      .toEqual({ objects: 5, read: 2, truncated: true });
    await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR + 1 }, W30_LEARN, T12 + 2 * H + 6 * MIN, { ...options, maxObjects: 2 }, m.env as never);

    // The repair: the same hour, the same ledger, a cap that can open all of it.
    const repaired = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, T12 + 2 * H + 7 * MIN, { ...options, maxObjects: MAX_HOUR_OBJECTS }, m.env as never);
    expect({ read: repaired.objectsRead, truncated: repaired.truncated, ringsFolded: repaired.ringsFolded },
      'W30.R1.01 — a rebuild at a higher cap really rebuilds the hour: it opens every object, it clears `truncated` because the count is now complete, and it reports that the rings ADVANCED, instead of clearing the flag over rings that never moved (F17 P6: "the rebuild recovers the counts and clears the `truncated` flag, but `folded` is false")')
      .toEqual({ read: 5, truncated: false, ringsFolded: true });
    expect(ringItems(m, 'v-tabby'),
      'W30.R1.01 — and the rings hold the recovered decisions, which is the half of the repair F17 §6 item 2 says must not be skipped ("the rebuild recovers the counts but not attribution"); measured at specification as ["cnt-tabby-evening","cnt-rogue-work"]')
      .toEqual(SERVED);

    const later = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR + 1 }, W30_LEARN, T12 + 2 * H + 8 * MIN, { ...options, maxObjects: MAX_HOUR_OBJECTS }, m.env as never);
    expect(brandOf(later).policies.learning!.credits,
      'W30.R1.01 — and the cross-hour credit the truncation lost is paid once the hour is repaired: the click at 13:05 on the item the fifth object served (F17 "tests that should exist": "Truncate an hour, rebuild at a higher cap, assert the rings hold the recovered decisions")')
      .toBe(1);

    // LOCKED, measured green at specification: a rebuild that is still short of
    // the hour's object count keeps saying so.
    const s = await mount();
    await truncatedHour(s);
    await buildHour(s.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, T12 + H + 6 * MIN, { ...options, maxObjects: 2 }, s.env as never);
    const partial = await buildHour(s.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, T12 + H + 7 * MIN, { ...options, maxObjects: 3 }, s.env as never);
    expect({ read: partial.objectsRead, truncated: partial.truncated },
      'W30.R1.01 — `truncated` clears ONLY when the object count is complete: a repair at a cap still below it opens more and still says the hour is short')
      .toEqual({ read: 3, truncated: true });
  });

  it('host-internal: the catch-up run itself repairs the truncated hour at the raised cap, re-folds the later hour that depends on it, and the published day carries the recovered credit', async () => {
    // host-internal (R19): the observable of the repair is the batch RING, which
    // no public route exposes. The day it produces is read through the mounted
    // operator route beside it.
    const m = await mount();
    await truncatedHour(m);
    const options = { shards: 1, lookbackHours: 3 };

    // 14:06 — hours 12 and 13 are closed. The cron's own call, at a cap that
    // truncates hour 12.
    const first = await fold(m, T12 + 2 * H + 6 * MIN, { ...options, maxObjects: 2 });
    expect(hoursOf(first.built).sort((a, b) => a - b),
      'the fixture folds both closed hours at the low cap before the repair is asked for').toEqual([11, 12, 13]);
    expect(storedHour(m, DATE, HOUR).truncated, 'and hour 12 is stored truncated').toBe(true);

    // 14:07 — the same cron entry point, asked for the whole hour this time.
    const repair = await fold(m, T12 + 2 * H + 7 * MIN, { ...options, maxObjects: MAX_HOUR_OBJECTS });
    expect(hoursOf(repair.built).sort((a, b) => a - b),
      'W30.R1.01 — the catch-up itself repairs the hour: `staleHour` re-folds an hour whose stored fold was cut short by a cap this run is allowed to exceed, and it re-folds the LATER hour of the same shard whose attribution ran against the rings as they were (W22 whole-W review: "`staleHour` fires on `objects > agg.objects` only … so a cap raise never re-folds")')
      .toEqual([12, 13]);
    expect(ringItems(m, 'v-tabby'),
      'W30.R1.01 — after the repair the rings hold every decision of the hour').toEqual(SERVED);
    expect({ read: storedHour(m, DATE, HOUR).objectsRead, truncated: storedHour(m, DATE, HOUR).truncated },
      'W30.R1.01 — and the stored hour says it is now complete because it really is').toEqual({ read: 5, truncated: false });

    const answered = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`);
    expect(answered.status, `the saved day report reads back: ${JSON.stringify(answered.body).slice(0, 300)}`).toBe(200);
    const day = dayOf(answered.body);
    expect({ source: day.hours?.source, decisions: day.counts.decisions, credits: day.policies.find(row => row.role === 'learning')?.credits },
      'W30.R1.01 — and the day the catch-up publishes from the aggregates carries the recovered decisions and the cross-hour credit')
      .toEqual({ source: 'aggregates', decisions: 5, credits: 1 });
  });
});

// ===========================================================================
// unit:W30.M1.01 — maturity explicit, with no blanket age cutoff
// ===========================================================================

describe('unit:W30.M1.01', () => {
  /**
   * Document 35 §5 row W30: "handle … maturity explicitly." F17 §6 item 1 names
   * the mechanism — re-fold "candidate hours whose aggregate `builtAt` is inside
   * a maturity window (say the last 2–3 hours)" — and HANDOFF-2026-09-16 :234
   * records the owner's limit: "User did not approve a blanket age cutoff."
   *
   * MEASURED at specification on this product (probe, reverted): there is no
   * maturity window at all. Every settled hour inside the 26-hour lookback is
   * re-listed and re-folded on every run, and a click that arrived TWENTY HOURS
   * after its hour closed was silently applied (`counts.outcomes: 1`) with
   * nothing on the report saying so; an hour that has left the lookback is
   * silently final, with nothing saying that either. `ReportCoverage.maturity`
   * is the frozen literal `'unknown'` (`src/learn/report.ts:685`, W30.02 in
   * `src/learn/hourly.test.ts:941`, `src/console/learning.render.test.ts:212`)
   * and stays that way: it is the LEGACY statement about outcome maturity, and
   * the per-hour re-fold horizon is its own named member beside it.
   *
   * RULED: the re-fold horizon is a NAMED, PUBLISHED value — `REFOLD_MATURITY_MS`
   * on the fold, `coverage.refoldHorizonMs` on the report — measured from the
   * hour's own end. Inside it an hour is `open` and a grown prefix is re-folded
   * (W22.R1.02, unchanged). Past it the hour is `final` BY DECLARATION: a row
   * that arrives afterwards is COUNTED and NAMED (`coverage.lateAfterMaturity`),
   * never silently dropped and never silently applied. The VALUE of the window
   * is the owner's (`W30.P1.01`); every assertion here reads it off the module.
   */
  it('logic: the re-fold horizon is a named published constant on the coverage, an hour inside it is open, and a row that arrives after the hour is final is counted and named instead of being silently applied', async () => {
    const maturity = maturityWindow();
    expect(typeof maturity === 'number' ? { positive: maturity > 0, insideTheLookback: maturity < 26 * H } : absent(MATURITY_EXPORT, hourly),
      'W30.M1.01 — the window inside which a folded hour is still re-checked is a named, published value of the fold, not an unstated 26-hour side effect of the lookback; and it fits inside the catch-up\'s own lookback, because an hour whose late rows can never be seen can never be named (ruled export: `REFOLD_MATURITY_MS`; F17 §6 item 1)')
      .toEqual({ positive: true, insideTheLookback: true });
    const window = maturity!;
    const lookbackHours = Math.ceil(window / H) + 4;
    const options = { shards: 1, lookbackHours };

    const m = await mount();
    const served = decision(m.env, 'v-tabby', T12 + 10 * MIN, 'cnt-tabby-evening');
    await throughTheLedger(m, [served], [], T12 + 11 * MIN);

    // OPEN: six minutes after hour 12 ends, well inside any published window.
    await fold(m, HOUR12_END + 6 * MIN, options);
    const open = coverageOf(await publish(m, HOUR12_END + 6 * MIN));
    expect({ refoldHorizonMs: open.refoldHorizonMs ?? absent('`coverage.refoldHorizonMs`', open),
      hour12: open.maturities?.find(row => row.hour === HOUR) ?? absent('`coverage.maturities`', open) },
      'W30.M1.01 — the day states the published re-fold horizon it was built under and says, hour by hour, which hours are still inside it (ruled members: `coverage.refoldHorizonMs`, `coverage.maturities`)')
      .toEqual({ refoldHorizonMs: window, hour12: { hour: HOUR, maturity: 'open' } });

    // FINAL: one minute past the published window, a click that HAPPENED at
    // 12:30 is written into hour 12's prefix (`hourPrefix` files a record by its
    // event time, F17 §1), and the catch-up runs again.
    const late = click(m.env, served, T12 + 30 * MIN, 'w30-b1-late-past-maturity');
    const pastMaturity = HOUR12_END + window + MIN;
    await throughTheLedger(m, [], [late], pastMaturity);
    await fold(m, pastMaturity, options);

    const day = await publish(m, pastMaturity), final = coverageOf(day);
    expect({ outcomes: day.counts.outcomes,
      lateAfterMaturity: final.lateAfterMaturity ?? absent('`coverage.lateAfterMaturity`', final),
      hour12: final.maturities?.find(row => row.hour === HOUR) ?? absent('`coverage.maturities`', final),
      status: final.status },
      'W30.M1.01 — past the published horizon the hour is final BY DECLARATION: the row that arrived afterwards is COUNTED and NAMED with its hour, never silently applied to a number an analyst has already read and never silently dropped; the day says it is incomplete because data exists that it does not include (ruled member: `coverage.lateAfterMaturity`; HANDOFF-2026-09-16 :234 "User did not approve a blanket age cutoff" — the rows stay in the ledger and are named, and an explicit repair still reaches them, W30.R1.01)')
      .toEqual({ outcomes: 0, lateAfterMaturity: [{ hour: HOUR, objects: 1 }], hour12: { hour: HOUR, maturity: 'final' }, status: 'incomplete' });
    expect(storedHour(m, DATE, HOUR).lateObjects ?? absent('`HourAggregate.lateObjects`', storedHour(m, DATE, HOUR)),
      'W30.M1.01 — and the hour itself carries the count, so the statement survives a restart of the job that made it (ruled member: `HourAggregate.lateObjects`)')
      .toBe(1);
  });

  it('host: both reports an operator reads carry the published horizon, the per-hour maturity and the rows that arrived after an hour was final', async () => {
    const maturity = maturityWindow();
    expect(typeof maturity === 'number' ? 'published' : absent(MATURITY_EXPORT, hourly),
      'W30.M1.01 — the re-fold horizon is published by the fold before any report can state it').toBe('published');
    const window = maturity!;
    const options = { shards: 1, lookbackHours: Math.ceil(window / H) + 4 };

    const m = await mount();
    const served = decision(m.env, 'v-tabby', T12 + 10 * MIN, 'cnt-tabby-evening');
    await throughTheLedger(m, [served], [], T12 + 11 * MIN);
    await fold(m, HOUR12_END + 6 * MIN, options);
    const pastMaturity = HOUR12_END + window + MIN;
    await throughTheLedger(m, [], [click(m.env, served, T12 + 30 * MIN, 'w30-b1-host-late')], pastMaturity);
    await fold(m, pastMaturity, options);
    await publish(m, pastMaturity);

    const dayAnswer = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`);
    expect(dayAnswer.status, `the day report answers: ${JSON.stringify(dayAnswer.body).slice(0, 300)}`).toBe(200);
    const day = coverageOf(dayOf(dayAnswer.body));
    expect({ horizon: day.refoldHorizonMs ?? absent('`coverage.refoldHorizonMs`', day),
      late: day.lateAfterMaturity ?? absent('`coverage.lateAfterMaturity`', day) },
      'W30.M1.01 — the day report an operator reads states the horizon and the late rows')
      .toEqual({ horizon: window, late: [{ hour: HOUR, objects: 1 }] });

    const windowAnswer = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${DATE}&to=${DATE}&brand=${BRAND}`);
    expect(windowAnswer.status, `the window answers: ${JSON.stringify(windowAnswer.body).slice(0, 300)}`).toBe(200);
    const pooled = windowOf(windowAnswer.body);
    const pooledDay = (pooled.coverage.days[0]?.coverage ?? {}) as W30Coverage;
    expect({ date: pooled.coverage.days[0]?.date,
      horizon: pooledDay.refoldHorizonMs ?? absent('`coverage.refoldHorizonMs` on the pooled day', pooledDay),
      late: pooledDay.lateAfterMaturity ?? absent('`coverage.lateAfterMaturity` on the pooled day', pooledDay),
      maturities: pooledDay.maturities?.find(row => row.hour === HOUR) ?? absent('`coverage.maturities` on the pooled day', pooledDay) },
      'W30.M1.01 — and the window report carries the same statement per day, instead of dropping every honesty signal but missing days (F17 §3.4)')
      .toEqual({ date: DATE, horizon: window, late: [{ hour: HOUR, objects: 1 }], maturities: { hour: HOUR, maturity: 'final' } });
  });
});

// ===========================================================================
// unit:W30.V1.01 — date-scoped visitors, evicted carry-in, unplaced carry-in
// ===========================================================================

describe('unit:W30.V1.01', () => {
  /**
   * Document 35 §5 row W30: "date-scoped visitors … explicitly". Three clauses,
   * one representation:
   *
   * (i) LOCKED — W22.R1.02 (`src/units/W22/B2.unit.test.ts:403`) already proves
   *     that an out-of-order repair across a date boundary no longer freezes the
   *     day's distinct visitors (F17 P7). This unit locks the STATE that makes
   *     it true, by name: `ShardState.seenDays`, the per-date membership.
   *
   * (ii) RULED — evicted carry-in. An outcome whose earlier decisions have left
   *     the batch ring earns no credit, and today that is a silent zero: the
   *     fold's `if (!ring.length) continue` and `attribute()` simply return
   *     nothing (`src/learn/hourly.ts:725-727`). Measured at specification with
   *     `ringCap: 1`: `outcomes: 1, credits: 0`, and no member of the hour or of
   *     the coverage says why. RULED member `HourBrand.carryIn.evicted`: the
   *     outcomes of this hour that earned no credit under the learning policy
   *     while the visitor's usable history was BOUNDED — her ring held `ringCap`
   *     entries when the outcome was attributed, or this fold dropped an entry of
   *     hers older than the horizon cutoff. That is the honest name for the
   *     uncertainty, never a claim that a credit was owed.
   *
   * (iii) RULED — unplaced carry-in, the W21-B3 build review's finding 1:
   *     "an outcome at 09:15 whose visitor's only decision of the day is at
   *     14:00 is counted by the raw branch and dropped by the fold, while the day
   *     still reports `unassignedHours: []`. A wrong number, not a null."
   *     Measured at specification: folded `visitorOutcomes` `byType: {}` against
   *     the raw branch's `{click: 1}`, with `unassignedHours: []`. The fold
   *     CANNOT count it as the raw branch does — at hour 9's fold no decision of
   *     hers exists yet anywhere, and an earlier hour is never re-folded for a
   *     later one — so the ruled outcome is the other half of the brief's
   *     disjunction: it is NAMED. `HourBrand.carryIn.unplaced` counts the
   *     outcomes of this hour that no assignment of the visitor's date could be
   *     found for, and `coverage.carryInHours` names the hour, so the day's
   *     visitor-level outcomes are declared incomplete instead of being short.
   *     `HourBrand.assignments` and `coverage.unassignedHours` keep their
   *     meaning exactly (W21.C1.08).
   */
  it('logic: the per-date membership is kept by name, an outcome whose carry-in was evicted is named on its hour, and an outcome the fold could place under no assignment of the date is named too', async () => {
    // ── (i) the per-date membership, locked by name ─────────────────────────
    const v = await mount();
    const yesterday = decision(v.env, 'v-yesterday', Date.UTC(2026, 8, 2, 23, 10, 0), 'cnt-rogue-work');
    const today = decision(v.env, 'v-tabby', T12 + MIN, 'cnt-tabby-evening');
    await throughTheLedger(v, [yesterday, today], [], T12 + 2 * MIN);
    await buildHour(v.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, T12 + H + 6 * MIN, { shards: 1 }, v.env as never);
    // The OLDER hour, folded after the newer one: the out-of-order repair.
    await buildHour(v.storage as never, TENANT, { date: PREVIOUS, hour: 23 }, W30_LEARN, T12 + H + 7 * MIN, { shards: 1 }, v.env as never);
    expect(shardOf0(v).seenDays?.[PREVIOUS] ?? absent('`ShardState.seenDays`', shardOf0(v)),
      'LOCKED (W22.R1.02, F17 §6 item 3): the shard keeps the membership of the other dates it has folded, keyed by date, so a repaired older hour counts on its own day instead of being wiped (`src/units/W22/B2.unit.test.ts:403` proves the reports; this is the state behind them)')
      .toEqual({ [BRAND]: ['v-yesterday'] });

    // ── (ii) evicted carry-in ───────────────────────────────────────────────
    const e = await mount();
    const carry = decision(e.env, 'v-tabby', T12 + MIN, 'cnt-tabby-evening');
    const newer = decision(e.env, 'v-tabby', T12 + 2 * MIN, 'cnt-rogue-work');
    await throughTheLedger(e, [carry, newer], [], T12 + 3 * MIN);
    // The click lands in the NEXT hour, on the decision the cap evicted.
    await throughTheLedger(e, [], [click(e.env, carry, T12 + H + MIN, 'w30-b1-evicted')], T12 + H + 2 * MIN);
    const bounded = { shards: 1, ringCap: 1 };
    await buildHour(e.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, T12 + H + 6 * MIN, bounded, e.env as never);
    const thirteen = await buildHour(e.storage as never, TENANT, { date: DATE, hour: HOUR + 1 }, W30_LEARN, T12 + 2 * H + 6 * MIN, bounded, e.env as never);
    expect({ outcomes: brandOf(thirteen).outcomes,
      carryIn: brandOf(thirteen).carryIn ?? absent('`HourBrand.carryIn`', brandOf(thirteen)) },
      'W30.V1.01 — an outcome whose carry-in decision left the batch ring under the cap is NAMED on its hour, instead of being a silent zero in the credits (F17 P2/P6; measured at specification as outcomes: 1, credits: 0 with nothing said anywhere)')
      .toEqual({ outcomes: 1, carryIn: { evicted: 1, unplaced: 0 } });

    const evictedCoverage = coverageOf(await publish(e, T12 + 2 * H + 7 * MIN));
    expect(evictedCoverage.carryInHours ?? absent('`coverage.carryInHours`', evictedCoverage),
      'W30.V1.01 — and the day names the hour that holds it, beside the flags the day already carries (ruled member: `coverage.carryInHours`)')
      .toEqual([{ hour: HOUR, evicted: 0, unplaced: 0 }, { hour: HOUR + 1, evicted: 1, unplaced: 0 }]);

    // ── (iii) the later-hour carry-in outcome ───────────────────────────────
    const u = await mount();
    const T9 = Date.UTC(2026, 8, 3, 9, 0, 0), T14 = Date.UTC(2026, 8, 3, 14, 0, 0);
    const laterDecision = decision(u.env, 'u-unknown', T14 + MIN, 'cnt-charms-slg');
    // Her click at 09:15 precedes every decision of her day, which is exactly
    // the case the raw-day branch resolves from her FIRST decision of the date
    // (`src/learn/report.ts:981`) and the fold cannot see at all.
    await throughTheLedger(u, [laterDecision], [click(u.env, laterDecision, T9 + 15 * MIN, 'w30-b1-carry-in')], T14 + 2 * MIN);
    const nine = await buildHour(u.storage as never, TENANT, { date: DATE, hour: 9 }, W30_LEARN, T14 + 2 * H, { shards: 1 }, u.env as never);
    await buildHour(u.storage as never, TENANT, { date: DATE, hour: 14 }, W30_LEARN, T14 + 2 * H + MIN, { shards: 1 }, u.env as never);
    expect({ outcomes: brandOf(nine).outcomes, carryIn: brandOf(nine).carryIn ?? absent('`HourBrand.carryIn`', brandOf(nine)) },
      'W30.V1.01 — an outcome the fold can place under no assignment of the visitor\'s date is NAMED on its hour, so the day\'s visitor-level outcomes are declared incomplete instead of being quietly short (W21-B3 build review finding 1: "counted by the raw branch and dropped by the fold, while the day still reports `unassignedHours: []` — a wrong number, not a null")')
      .toEqual({ outcomes: 1, carryIn: { evicted: 0, unplaced: 1 } });
    const carriedCoverage = coverageOf(await publish(u, T14 + 2 * H + 2 * MIN));
    expect({ hours: carriedCoverage.carryInHours?.filter(row => row.unplaced > 0) ?? absent('`coverage.carryInHours`', carriedCoverage),
      status: carriedCoverage.status },
      'W30.V1.01 — and the day names the hour and declares itself incomplete, which is the honest answer when a visitor-level number cannot be completed from the hours the fold has')
      .toEqual({ hours: [{ hour: 9, evicted: 0, unplaced: 1 }], status: 'incomplete' });
  });

  it('host-internal: after an out-of-order repair each date counts its own visitors and the later hour that depended on the repaired one is folded again', async () => {
    // host-internal (R19): the dependent re-fold is observable on the shard and
    // on the catch-up's own progress; no public route exposes either.
    const m = await mount();
    const previousHour = Date.UTC(2026, 8, 2, 23, 0, 0);
    const yesterday = decision(m.env, 'v-yesterday', previousHour + 10 * MIN, 'cnt-rogue-work');
    const early = decision(m.env, 'v-tabby', T12 + 59 * MIN, 'cnt-tabby-evening');
    const crossHour = click(m.env, early, T12 + H + 10 * MIN, 'w30-b1-dependent');
    await throughTheLedger(m, [yesterday, early], [crossHour], T12 + 2 * H);

    // The previous day's hour is folded LAST: hours 12 and 13 of the current day
    // go first, then the older hour is repaired, and the hour whose attribution
    // ran against the rings as they were is folded again.
    const options = { shards: 1, lookbackHours: 3 };
    const firstPass = await fold(m, T12 + 2 * H + 6 * MIN, options);
    expect(hoursOf(firstPass.built).sort((a, b) => a - b),
      'the fixture folds the current day first, inside a lookback that cannot reach the previous day').toEqual([11, 12, 13]);

    const repair = await fold(m, T12 + 2 * H + 7 * MIN, { shards: 1, lookbackHours: 16 });
    expect(hoursOf(repair.built, PREVIOUS),
      'the previous day\'s hour is folded when the lookback reaches it, after the current day\'s hours').toContain(23);
    expect(hoursOf(repair.built).sort((a, b) => a - b),
      'W30.V1.01 — and the hours of the current day that depend on the repaired shard are folded AGAIN in the same catch-up, so an hour repaired out of order never leaves a later hour attributing against rings that have since changed (F17 P3b; the honest half measured at specification: `catchUp` does re-fold them)')
      .toContain(HOUR + 1);

    const previousDay = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: PREVIOUS, brand: BRAND });
    expect(dayOf(previousDay.body).counts.visitors,
      'LOCKED (W22.R1.02, F17 P7) — the visitor served only in the repaired hour counts on her own day').toBe(1);
    const currentDay = await operatorPost(m, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect({ visitors: dayOf(currentDay.body).counts.visitors, credits: dayOf(currentDay.body).policies.find(row => row.role === 'learning')?.credits },
      'LOCKED (W22.R1.02) — and the current day keeps its own distinct visitor and its cross-hour credit')
      .toEqual({ visitors: 1, credits: 1 });
  });
});

// ===========================================================================
// unit:W30.F1.01 — every flag propagated, the collision named, the v1 bound
// ===========================================================================

describe('unit:W30.F1.01', () => {
  /**
   * Document 35 §5 row W30: "Propagate all missing/truncated/unfolded/horizon
   * flags." F17 §3.4: the honesty signals "die before they reach a human".
   * W22.R1.03 carried `missingHours`, `truncatedHours`, `unadvancedHours` and
   * `horizons` to both reports and both screens; this unit carries the rest of
   * them, and closes the two W22 residuals routed here by ruling R124:
   * "the hourly fold still fails closed unnamed on a collision" and
   * "`counts.conflicts` absent on the aggregate path"; and R143's
   * "v1-shard migration bound — P3b recovery begins at the first v2 fold".
   *
   * MEASURED at specification: `reportFromHours` builds `counts` from
   * `{decisions, outcomes, visitors, truncated, duplicates?}` and never sets
   * `conflicts` (`src/learn/hourly.ts:1054`); `loadHourRecords` constructs
   * `new ReportRowIdentity(tenant)` with no filed-conflict set and no brand
   * (`:1116`), so a collision throws `ReportRowConflict` out of `buildHour`
   * for ever, even after the operator surface has filed it (W22.D1.03);
   * the coverage carries no scan bound and no migration bound.
   */
  it('logic: the day and the window carry the object-scan bound, the carry-in, the maturity and the migration bound, and a filed collision is counted on the aggregate-built day', async () => {
    const maturity = maturityWindow();
    expect(typeof maturity === 'number' ? 'published' : absent(MATURITY_EXPORT, hourly),
      'W30.F1.01 — the published re-fold horizon exists before a report can propagate it').toBe('published');

    // ── a day with a truncated hour, on a shard migrated from version 1 ─────
    const m = await mount();
    for (let n = 0; n < 3; n++) {
      const d = decision(m.env, 'v-tabby', T12 + (n + 1) * MIN, ['cnt-tabby-evening', 'cnt-rogue-work', 'cnt-charms-slg'][n]!);
      await throughTheLedger(m, [d], [], T12 + (n + 1) * MIN + 1000);
    }
    // A stored VERSION-1 shard: `through` is its only memory of what is folded,
    // so no hour at or below it can ever be put into these rings again. Its
    // floor is what the migration inherits (`src/learn/hourly.ts:123`).
    const v1: ShardState = { version: 1, shard: 0, through: T12 - H, rings: {}, seenDate: '', seen: {} };
    await m.storage.put(shardKey(TENANT, 0), JSON.stringify(v1));

    const truncated = await buildHour(m.storage as never, TENANT, { date: DATE, hour: HOUR }, W30_LEARN, HOUR12_END + 6 * MIN, { shards: 1, maxObjects: 2 }, m.env as never);
    expect({ objects: truncated.objects, read: truncated.objectsRead },
      'the fixture: three ledger objects in hour 12 and a fold allowed to open two').toEqual({ objects: 3, read: 2 });
    const coverage = coverageOf(await publish(m, HOUR12_END + 6 * MIN));

    expect({ objectScan: coverage.objectScan ?? absent('`coverage.objectScan`', coverage),
      truncatedHours: coverage.truncatedHours },
      'W30.F1.01 — the day names the object-scan bound where an hour hit it: how many ledger objects the hour holds and how many the fold opened, so the reader can see both the loss and the cap that caused it (N08: "the fold reads at most 600 objects/hour"; ruled member: `coverage.objectScan`, beside the `truncatedHours` W22.R1.03 already carries)')
      .toEqual({ objectScan: [{ hour: HOUR, objects: 3, read: 2 }], truncatedHours: [HOUR] });

    expect(coverage.recoveryFromMs ?? absent('`coverage.recoveryFromMs`', coverage),
      'W30.F1.01 — and the day states the version-1 shard migration bound: repair reaches back to the first version-2 fold and no further, because a version-1 state remembers only a high-water mark (W22 R143: "v1-shard migration bound — P3b recovery begins at the first v2 fold"; the stored `through` here is 11:00, so the earliest hour a repair can still put into these rings is 12:00)')
      .toBe(T12);
    expect(storedHour(m, DATE, HOUR).recoveryFrom ?? absent('`HourAggregate.recoveryFrom`', storedHour(m, DATE, HOUR)),
      'W30.F1.01 — carried on the hour that measured it, because only the fold can see the shard').toBe(T12);

    const windowAnswer = await operatorGet(m, `/v1/${TENANT}/learn/report/window?from=${DATE}&to=${DATE}&brand=${BRAND}`);
    const pooledDay = (windowOf(windowAnswer.body).coverage.days[0]?.coverage ?? {}) as W30Coverage;
    expect({ objectScan: pooledDay.objectScan ?? absent('`coverage.objectScan` on the pooled day', pooledDay),
      recoveryFromMs: pooledDay.recoveryFromMs ?? absent('`coverage.recoveryFromMs` on the pooled day', pooledDay),
      carryInHours: pooledDay.carryInHours ?? absent('`coverage.carryInHours` on the pooled day', pooledDay),
      maturities: pooledDay.maturities ?? absent('`coverage.maturities` on the pooled day', pooledDay) },
      'W30.F1.01 — and the window report carries every one of them per day, instead of dropping every honesty signal but missing days (F17 §3.4)')
      .toEqual({ objectScan: [{ hour: HOUR, objects: 3, read: 2 }], recoveryFromMs: T12,
        carryInHours: [{ hour: HOUR, evicted: 0, unplaced: 0 }], maturities: [{ hour: HOUR, maturity: 'open' }] });

    // ── the fold's collision: named, and counted once it is filed ───────────
    const c = await mount();
    const d1 = decision(c.env, 'v-rogue', T12 + 5 * MIN, 'cnt-rogue-work');
    const o1 = click(c.env, d1, T12 + 7 * MIN, 'w30-b1-collision');
    await throughTheLedger(c, [d1], [o1], T12 + 8 * MIN);
    // Two genuinely DIFFERENT events under one logical id, which at-least-once
    // delivery writes and the reader must never merge (W22.D1.03, F16 §5(j)).
    const collision = { ...o1, item_id: 'cnt-tabby-evening' } as OutcomeRecord;
    const wrote = await consumeLedger(c.env, [{ kind: 'ledger', type: 'outcome', version: 1, record: collision }], T12 + 9 * MIN);
    expect(wrote.ok, 'the fixture writes the colliding event the way at-least-once delivery does').toBe(true);
    // The operator surface files it, exactly as W22.D1.03 rules: the first read
    // refuses and names the id, the second reads again with the row excluded.
    const refused = await operatorPost(c, `/v1/${TENANT}/learn/report`, { date: DATE, brand: BRAND });
    expect((refused.body as { conflict?: { id?: string } }).conflict?.id,
      'LOCKED (W22.D1.03) — the read names the colliding logical id and files it').toBe(o1.outcome_id);

    const folded = await fold(c, HOUR12_END + 6 * MIN, { shards: 1, lookbackHours: 2 });
    expect(folded.failed,
      'W30.F1.01 — the fold no longer fails closed on a collision an operator has already filed: it reads the filed case the report route wrote and folds the hour (W22 R124 residual: "the hourly fold still fails closed unnamed on a collision")')
      .toEqual([]);
    const hour = storedHour(c, DATE, HOUR);
    expect(brandOf(hour).conflicts ?? absent('`HourBrand.conflicts`', brandOf(hour)),
      'W30.F1.01 — and the hour names the collision by the brand it belongs to and the kind of id it was, in the vocabulary `duplicates` already uses (ruled member: `HourBrand.conflicts`)')
      .toEqual({ decisions: 0, outcomes: 1 });
    const collisionDay = dayOf((await operatorGet(c, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`)).body);
    expect({ source: collisionDay.hours?.source, outcomes: collisionDay.counts.outcomes,
      conflicts: collisionDay.counts.conflicts ?? absent('`counts.conflicts` on the aggregate-built day', collisionDay.counts) },
      'W30.F1.01 — and the day built FROM THE AGGREGATES counts the exclusion in the same member the direct-record day already uses (W22 R124 residual: "`counts.conflicts` absent on the aggregate path")')
      .toEqual({ source: 'aggregates', outcomes: 1, conflicts: { decisions: 0, outcomes: 1 } });
  });

  it('sdk: both shipped screens name the hour that is final, the rows that arrived after it, and the outcomes whose carry-in the fold could not reach', async () => {
    const maturity = maturityWindow();
    expect(typeof maturity === 'number' ? 'published' : absent(MATURITY_EXPORT, hourly),
      'W30.F1.01 — the published re-fold horizon exists before a screen can render it').toBe('published');
    const window = maturity!;
    const options = { shards: 1, ringCap: 1, lookbackHours: Math.ceil(window / H) + 4 };

    const m = await mount();
    const carry = decision(m.env, 'v-tabby', T12 + MIN, 'cnt-tabby-evening');
    const newer = decision(m.env, 'v-tabby', T12 + 2 * MIN, 'cnt-rogue-work');
    await throughTheLedger(m, [carry, newer], [], T12 + 3 * MIN);
    // An outcome in hour 13 on the decision the cap evicted: the carry-in line.
    await throughTheLedger(m, [], [click(m.env, carry, T12 + H + MIN, 'w30-b1-screen-evicted')], T12 + H + 2 * MIN);
    await fold(m, T12 + 2 * H + 6 * MIN, options);
    // And a row that arrives after hour 12 is final: the maturity line.
    const pastMaturity = HOUR12_END + window + MIN;
    await throughTheLedger(m, [], [click(m.env, newer, T12 + 40 * MIN, 'w30-b1-screen-late')], pastMaturity);
    await fold(m, pastMaturity, options);
    // The day the screens read, saved at the pinned moment (W22.R1.03's own step).
    await publish(m, pastMaturity);

    const screens: Array<{ name: string; text: string }> = [];
    for (const screen of ['console', 'legacy'] as const) {
      const page = screen === 'console' ? 'console/index.html' : 'legacy/learning.html';
      const dom = new JSDOM(readFileSync(`public/${page}`, 'utf8'),
        { url: `${OPERATOR_ORIGIN}/${screen === 'console' ? `console/#/measure?scope=${TENANT}&date=${DATE}` : `legacy/learning.html?scope=${TENANT}&brand=${BRAND}&slot=hero`}`, pretendToBeVisual: true, runScripts: 'outside-only' });
      const w = dom.window as unknown as ScreenWindow;
      w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
        const target = new URL(url, `${OPERATOR_ORIGIN}/`);
        return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
          method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
        }));
      };
      w.TextEncoder = TextEncoder;
      w.setInterval = () => 1;
      w.localStorage.setItem('operator-session', JSON.stringify({ accessToken: m.operatorToken, refreshToken: 'w30-b1-refresh',
        exp: Date.now() + 3_600_000, user: { id: 'ops', name: 'Operator', email: 'ops@brand.test', roles: ['admin'], tenants: [TENANT] }, mustChangePassword: false }));
      const scripts = screen === 'console'
        ? ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js', 'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js']
        : ['operator-session.js', 'learning.js'];
      for (const script of scripts) w.eval(readFileSync(`public/${script}`, 'utf8'));
      const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 12)); };
      await settle();
      if (screen === 'legacy') {
        const date = w.document.getElementById('report-date');
        expect(date, 'the retained learning screen ships a date control').toBeTruthy();
        date!.value = DATE;
        date!.dispatchEvent(new w.Event('change', { bubbles: true }));
        await settle();
      }
      screens.push({ name: page, text: (w.document.body.textContent ?? '').replace(/\s+/g, ' ') });
      w.close();
    }

    for (const screen of screens) {
      expect(says(screen.text, /\bfinal\b/i, /\b12\b/),
        `W30.F1.01 — the shipped screen ${screen.name} must say, in one sentence, which of the day's hours are past the published re-fold horizon and final, so an operator knows which hours the platform will still repair and which it will not (F17 §3.4: the honesty signals die before they reach a human). It rendered: ${screen.text.slice(0, 600)}`)
        .toBe(true);
      expect(says(screen.text, /late|after/i, /row|object|record/i, /\b12\b/),
        `W30.F1.01 — and ${screen.name} must say that rows reached that hour after it became final and were NOT applied, which is the fact F17 P1 measured as invisible ("the outcome is durably in R2, is never read again, is counted nowhere, and no field of the report says a repair is pending"). It rendered: ${screen.text.slice(0, 600)}`)
        .toBe(true);
      expect(says(screen.text, /carry[- ]in/i, /\b13\b/),
        `W30.F1.01 — and ${screen.name} must say that an outcome's earlier decisions were out of the fold's reach in that hour, instead of showing the credit as a plain zero (F17 P2). It rendered: ${screen.text.slice(0, 600)}`)
        .toBe(true);
    }
  });
});

interface ScreenElement { value: string; dispatchEvent: (event: unknown) => boolean }
interface ScreenWindow extends Record<string, unknown> {
  document: { body: { textContent: string | null }; getElementById: (id: string) => ScreenElement | null };
  Event: new (type: string, options: Record<string, unknown>) => unknown;
  localStorage: { setItem: (key: string, value: string) => void };
  eval: (code: string) => unknown;
  close: () => void;
}

// ===========================================================================
// unit:W30.C1.01 — multi-hour catch-up under the cron's own budget
// ===========================================================================

describe('unit:W30.C1.01', () => {
  /**
   * Document 35 §5 row W30: "Prove … multi-hour catch-up and seven-day policy at
   * a signed-off workload. Timeout tuning/count comparisons alone are not
   * closure." The WORKLOAD is the owner's (`W30.P1.01`); what is mechanical is
   * that a backlog is caught up under the cron's own call and budget without
   * skipping or doubling an hour, that the scan bound is named where an hour hit
   * it, and that the day says WHICH HISTORY it applied (N23: "Online, hourly and
   * direct-record recomputation use different histories/caps … One cap
   * everywhere alone is not seven-day reconstruction").
   *
   * The call is `catchUp(env.STORAGE, tenant, learn, now, opts, env)` exactly as
   * `src/index.ts:272` makes it, with the cron's own budget: two hours per run
   * and the 26-hour lookback, both defaults, untouched here. The one option this
   * fixture sets is the object-scan cap, because 601 ledger objects is not a
   * unit fixture and the cap is an input of the fold, not a compiled constant.
   *
   * MEASURED at specification (probe, reverted): the backlog IS caught up two
   * hours per run with every aggregate written exactly once, so those clauses
   * are locked here rather than ruled. What is absent is the scan bound on the
   * coverage.
   */
  /** `DEFAULT_POLICY.windowsMs.purchase`, hand-written because the map's index signature is optional: seven days = 604 800 000 ms (F17 P4). */
  const PURCHASE_WINDOW_MS = 7 * DAY_MS;

  it('host-internal: a backlog of closed hours is caught up two hours per run, every hour folded exactly once, with the scan bound named where an hour hit it and the history each path applied stated', async () => {
    // host-internal (R19): per-run progress and the written-once property are
    // properties of the scheduled job and of storage, which no route exposes.
    const m = await mount();
    const CAP = 2;
    // Six populated hours, the last of them holding THREE ledger objects: more
    // than this run's object-scan cap, so that hour hits the bound.
    for (let hour = 0; hour < 6; hour++) {
      const at = T12 + hour * H + MIN;
      await throughTheLedger(m, [decision(m.env, `v-shopper-${hour}`, at, W30_PIECES[hour % W30_PIECES.length]!.id)], [], at + 1000);
    }
    const crowded = T12 + 5 * H;
    for (let n = 1; n <= 2; n++) {
      await throughTheLedger(m, [decision(m.env, `u-unknown-${n}`, crowded + n * MIN, 'cnt-unknown-taxonomy')], [], crowded + n * MIN + 1000);
    }
    // 18:06: hours 12..17 are closed, and so is every hour of the 26-hour
    // lookback behind them.
    const now = T12 + 6 * H + 6 * MIN;
    const run = await fold(m, now, { maxObjects: CAP });

    expect(Math.max(...run.perRun),
      'W30.C1.01 — LOCKED: the cron\'s own budget is two hours per run, and the catch-up never exceeds it (`src/learn/hourly.ts` catchUp `opts.maxHours ?? 2`)').toBe(2);
    expect({ failed: run.failed, pending: run.pending },
      'W30.C1.01 — LOCKED: the backlog is caught up across successive runs, each starting where the last stopped, until nothing is pending')
      .toEqual({ failed: [], pending: 0 });
    const aggregates = [...m.storage.objects.keys()].filter(key => key.startsWith(`aggregates/${TENANT}/`) && key.endsWith('.json') && !key.includes('/rings/'));
    expect({ folded: run.built.length, stored: aggregates.length, writtenTwice: aggregates.filter(key => (m.storage.versions.get(key) ?? 0) !== 1) },
      'W30.C1.01 — LOCKED: no hour is skipped and none is folded twice — every closed hour of the lookback ends with exactly one aggregate, written exactly once')
      .toEqual({ folded: aggregates.length, stored: aggregates.length, writtenTwice: [] });

    const answered = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`);
    expect(answered.status, `the day the catch-up published reads back: ${JSON.stringify(answered.body).slice(0, 300)}`).toBe(200);
    const day = dayOf(answered.body), coverage = coverageOf(day);
    const crowdedHour = new Date(crowded).getUTCHours();
    expect(coverage.objectScan?.find(row => row.hour === crowdedHour) ?? absent('`coverage.objectScan`', coverage),
      'W30.C1.01 — the hour that hit the object-scan bound says so with the bound itself: three objects in the hour, two opened by the fold (N08: "the fold reads at most 600 objects/hour; no universal break-even"; ruled member: `coverage.objectScan`)')
      .toEqual({ hour: crowdedHour, objects: 3, read: CAP });

    // N23, LOCKED (W22.A1.01): the day says which history it could really read,
    // beside the window the tenant's published policy asks for, so "one cap
    // everywhere" can never be mistaken for seven-day reconstruction.
    const contract = day.attributionContract;
    expect(contract ? { asked: contract.windowsMs.purchase, applied: contract.appliedWindowsMs.purchase }
      : absent('`attributionContract`', day),
      'W30.C1.01 — LOCKED (W22.A1.01, N23): the aggregate-built day states the purchase window the published policy asks for and the horizon the fold could actually read, which are not the same number')
      .toEqual({ asked: PURCHASE_WINDOW_MS, applied: DEFAULT_HORIZON_MS });
    expect({ published: DEFAULT_POLICY.windowsMs.purchase, read: DEFAULT_HORIZON_MS },
      'N23 — the published purchase window really is seven days while the batch fold reaches forty-eight hours, which is why the day must say both (F17 P4: "DEFAULT_POLICY.windowsMs.purchase = 604800000 = 7 days … batch day report: horizonMs(days) 2")')
      .toEqual({ published: PURCHASE_WINDOW_MS, read: 48 * H });
  });
});


