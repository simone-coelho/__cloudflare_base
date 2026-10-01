// src/units/W30/LEDGER.unit.test.ts
// W30 — the two criteria amendment A46 adds to the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W30, criteria L1 and
// S1), one `describe('unit:W30.<criterion id>')` each. The other criteria keep
// their reviewed tests in `src/units/W30/B1.unit.test.ts`, which is neither
// imported nor edited here: importing a `.test.ts` would register its whole
// suite a second time, so the harness below is that file's, trimmed.
//
// WITNESSES (every expected value below comes from one of these):
//   · The adoption verification at 68db4f6, W30 FAIL
//     (/home/simonecoelho/rem/_evidence/adoption-1/reviewer/REPORT.md):
//     D1 — "a late row can disappear from the published day": past the re-fold
//     horizon `staleHour` records `lateObjects` on the hour (hourly.ts:1946-1947,
//     :2033), but `catchUp` republishes only a date that had an hour built in the
//     same run (:2067, :2071), so the published day keeps `lateAfterMaturity: []`
//     and four more cron runs publish nothing. "Why the tests miss it: they build
//     the day by calling `runDayReport` directly." The probes
//     (scratch/late-republish*.probe.test.ts, logs/probe-late-republish*.log)
//     measured it with the cron's own defaults.
//     D2 — both screens say "repaired rather than first folded", but `maturityOf`
//     (hourly.ts:1213-1215) also marks an hour `repaired` when its FIRST fold comes
//     after the horizon; in the defaults probe hours 0–20 were folded for the first
//     time and all show as `repaired`.
//   · docs/kit/02-api-reference.md, the coverage paragraph (:604 at 1c4d153):
//     "`repaired` where the hour's aggregate was written after it became final — a
//     rebuild asked for at a higher object cap, or a first fold that reached the
//     hour late"; "`lateAfterMaturity` is `{hour, objects}` for ledger objects that
//     reached a final hour after it was final: they are counted and named here and
//     applied nowhere".
//   · W30.M1.01 (`src/units/W30/B1.unit.test.ts:684`), the reviewed representation
//     of a late row past the horizon — `lateAfterMaturity: [{hour, objects}]`, hour
//     `final`, `outcomes` unchanged, `status: 'incomplete'` — which L1 demands on
//     the cron path unchanged, so both tests are green on one product.
//
// THE PATH. L1 drives the five-minute cron exactly as `src/index.ts:270-272`
// runs it: the tenant's published learn document read with `read(env,
// LEARN_KIND, tenant, DEFAULT_LEARN)`, then `catchUp(env.STORAGE, tenant, learn,
// now, {}, env)` with the cron's own defaults, once every five minutes. It never
// calls `runDayReport`; the day is read back through the mounted operator route.
// S1 drives the same cron to publish the day and renders both shipped screens
// under jsdom against the mounted application (the W30.F1.01 screen harness).
//
// The re-fold horizon's VALUE is the owner's (D2, LIVE2): it is read off the
// module as `REFOLD_MATURITY_MS` (the M1 export) and never written here.

import { readFileSync } from 'node:fs';

import { describe, it, expect, onTestFinished, vi } from 'vitest';
import { Hono } from 'hono';
import { JSDOM } from 'jsdom';
import * as jose from 'jose';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, read } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { consumeLedger } from '@/ledger/consume';
import { enqueueDecisions, enqueueOutcome } from '@/ledger/enqueue';
import { hourPrefix, outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import * as hourly from '@/learn/hourly';
import { catchUp, hourKey, HOUR_MS } from '@/learn/hourly';
import type { DayReport, ReportCoverage } from '@/learn/report';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (tapestry_requirements A.3.6 — Coach), with a piece
// the taxonomy does not know and a visitor in the unknown cell beside it.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const OPERATOR_SECRET = 'w30-ledger-synthetic-operator-signing-material';
const OPERATOR_ORIGIN = 'http://console.test';
const MIN = 60_000;
const H = HOUR_MS;
const DAY_MS = 86_400_000;
/** The cron's own schedule: `*\/5 * * * *` (src/index.ts:246). */
const CRON_EVERY_MS = 5 * MIN;

const DATE = '2026-09-03';

/**
 * The clock of a test that renders a SHIPPED SCREEN over the fixed day above
 * (date-bomb correction, lead ruling 2026-10-01; arrangement only). The console
 * measure screen opens on a window from `daysAgo(27)` to today and a day box of
 * today, from its own `Date.now()` (public/console/views-measure.js:26-30), so
 * on the host clock DATE left that window on 2026-10-01. Such a test runs on
 * this clock instead — Node's `Date` faked from this instant and advancing in
 * real time, and the jsdom window's `Date.now` reading it — fourteen days after
 * DATE: after every fixture moment, DATE inside the window with thirteen days
 * to spare on each side, and a day box on a day with no report. That is the
 * relation every run from 2026-09-04 to 2026-09-30 had with the host clock, so
 * the screens render what they rendered then, on any host date — also one
 * before DATE, where the product would refuse the fixture's records as born in
 * the future. W30.F1.01 runs on the same clock (src/units/W30/B1.unit.test.ts).
 */
const SCREEN_TEST_NOW = Date.parse(`${DATE}T12:00:00Z`) + 14 * DAY_MS;
function runOnTheScreenTestClock(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: SCREEN_TEST_NOW, shouldAdvanceTime: true });
  onTestFinished(() => { vi.useRealTimers(); });
}

const piece =(id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
});
const PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'], contentType: ['editorial'] } }),
  piece('cnt-charms-slg', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
  piece('cnt-unknown-taxonomy', { title: 'A piece the taxonomy does not know', tags: {} }),
];
const CATALOGUE = { version: 'w30-ledger-coach-catalogue', pieces: PIECES };
const SLOTS: SlotCatalog = { version: 'w30-ledger-coach-slots',
  pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }] } };
/** `holdout.share: 0` so every fixture decision is `personalized` and each count below is exact. */
const LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w30-ledger', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { hero: { reward: 'click' } },
} as unknown as LearnConfig;

const COACH_CELL = { channel: 'web', visit_bucket: 'returning', stage: 'consider', region: 'US-NY', affinity: 'evening' };
const UNKNOWN_CELL = { channel: 'web', visit_bucket: 'new', stage: 'unknown', region: 'none', affinity: 'none' };

// ===========================================================================
// The mounted application, in process, the way `src/index.ts` mounts it, with
// the REAL DecisionRing, LearnStats and ShopperReflex classes (the W30.B1
// harness, `src/units/W30/B1.unit.test.ts:139-290`).
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
}

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w30-ledger-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

interface DurableRegistry { data: Map<string, unknown>; object: { fetch: (request: Request) => Promise<Response> } }

interface Mounted {
  env: Env;
  storage: UnitR2;
  queued: unknown[];
  fetch: (input: Request) => Promise<Response>;
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
    JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:w30-ledger-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    LEDGER_RECOVERY_ENABLED: 'false',
    // The recovery configuration the read-conflict filing path requires
    // (`src/ledger/quarantine.ts:252`), as the shipped deployment declares it.
    LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'events', deadLetterQueue: 'events-dead-letter',
      unknown: { id: 'w30-ledger-quarantine', revision: 1, durationMs: 30 * DAY_MS, basis: 'admitted', renewal: 'new-record-only', disposal: 'delete-on-expiry' } }),
    IDENTITY_SALT: 'w30-ledger-synthetic-quarantine-provenance-salt',
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
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w30-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, CATALOGUE),
    baseline(SLOTS_KIND, SLOTS),
    baseline(LEARN_KIND, LEARN),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);
  return { env, storage, queued, fetch: fetchOne, operatorToken };
}

async function operatorGet(m: Mounted, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(OPERATOR_ORIGIN + path, { headers: { Authorization: `Bearer ${m.operatorToken}`, 'X-Tenant': TENANT } }));
  return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

// ── the fixture's own records, minted the way the engine mints them ─────────

function decision(env: Env, visitor: string, ts: number, item: string): DecisionRecord {
  return {
    decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:hero:0`,
    tenant: TENANT, brand: BRAND, visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts,
    page: 'home', slot: 'hero', position: 0, item_id: item, customer_item_id: `CMS-${item}`, candidates: [],
    cell: visitor.startsWith('u-') ? UNKNOWN_CELL : COACH_CELL, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'w30-ledger',
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
 * and stream (`src/ledger/writer.ts:85`, the key carries the batch id), filed
 * under the hour of its EVENT time (`hourPrefix`, F17 §1).
 */
async function throughTheLedger(m: Mounted, decisions: DecisionRecord[], outcomes: OutcomeRecord[], now: number): Promise<void> {
  if (decisions.length) await enqueueDecisions(m.env, decisions);
  for (const outcome of outcomes) await enqueueOutcome(m.env, outcome);
  const wire = m.queued.splice(0);
  const result = await consumeLedger(m.env, wire, now);
  expect(result.error, 'the fixture ledger batch must be written by the real consumer').toBeUndefined();
  expect(result.ok, 'the fixture ledger batch must be acknowledged by the real consumer').toBe(true);
}

// ── the cron, exactly as src/index.ts runs it ───────────────────────────────

type CatchUp = Awaited<ReturnType<typeof catchUp>>;

/**
 * ONE run of the five-minute job for this tenant, exactly as `src/index.ts:270-272`
 * makes it: the published learn document read the way the cron reads it, then
 * `catchUp(env.STORAGE, tenant, learn, now, {}, env)` — the cron's own options,
 * two hours per run, the 26-hour lookback and the run budget, all defaults.
 */
async function cronRun(m: Mounted, now: number): Promise<CatchUp> {
  const learn = await read<LearnConfig>(m.env, LEARN_KIND, TENANT, DEFAULT_LEARN);
  return catchUp(m.env.STORAGE as unknown as Parameters<typeof catchUp>[0], TENANT, learn, now, {}, m.env as never);
}

/**
 * The cron at one moment, run until a run folds nothing, as the W30.B1 `fold`
 * helper does (`B1.unit.test.ts:396-411`): a backlog is caught up two hours per
 * run. Returns every date any run published.
 */
async function cronUntilQuiet(m: Mounted, now: number, maxRuns = 40): Promise<{ published: string[]; failed: string[] }> {
  const published: string[] = [], failed: string[] = [];
  for (let run = 0; run < maxRuns; run++) {
    const result = await cronRun(m, now);
    published.push(...result.reports.published);
    failed.push(...result.failed.map(hour => `${hour.date} ${hour.hour}: ${hour.error}`), ...result.reports.failed.map(date => `${date.date}: ${date.error}`));
    if (!result.built.length) break;
  }
  return { published, failed };
}

/**
 * The cron on its own schedule: one run every five minutes from `from`, for
 * `runs` runs. No run is skipped when it is quiet, because a build may name the
 * late row on one run and publish the day on the next.
 */
async function cronEveryFiveMinutes(m: Mounted, from: number, runs: number): Promise<{ published: string[]; failed: string[] }> {
  const published: string[] = [], failed: string[] = [];
  for (let run = 0; run < runs; run++) {
    const result = await cronRun(m, from + run * CRON_EVERY_MS);
    published.push(...result.reports.published);
    failed.push(...result.failed.map(hour => `${hour.date} ${hour.hour}: ${hour.error}`), ...result.reports.failed.map(date => `${date.date}: ${date.error}`));
  }
  return { published, failed };
}

// ── what the ruled answers are read off ─────────────────────────────────────

/** A ruled member that is absent reads as this sentence, so the diff names it. */
const absent = (what: string, saw: unknown): string =>
  `absent: ${what} — the answer carries ${Object.keys((saw ?? {}) as object).sort().join(', ')}`;

type W30Coverage = ReportCoverage & {
  refoldHorizonMs?: number | null;
  maturities?: Array<{ hour: number; maturity: 'open' | 'final' | 'repaired' }>;
  lateAfterMaturity?: Array<{ hour: number; objects: number }>;
};
const coverageOf = (report: DayReport | undefined): W30Coverage => (report?.coverage ?? {}) as W30Coverage;
const dayOf = (body: Record<string, unknown>): DayReport => (body as { report: DayReport }).report;

/** The published re-fold horizon, read off the module: its VALUE is the owner's (W30 decision D2, LIVE2). */
const maturityWindow = (): number | undefined => (hourly as unknown as { REFOLD_MATURITY_MS?: number }).REFOLD_MATURITY_MS;
const MATURITY_EXPORT = '`REFOLD_MATURITY_MS`, the published re-fold horizon exported from src/learn/hourly.ts (W30.M1.01)';

/** The saved day an operator reads, through the mounted route. */
async function publishedDay(m: Mounted): Promise<DayReport> {
  const answered = await operatorGet(m, `/v1/${TENANT}/learn/report?date=${DATE}&brand=${BRAND}`);
  expect(answered.status, `the day the cron published reads back through the operator route: ${JSON.stringify(answered.body).slice(0, 300)}`).toBe(200);
  return dayOf(answered.body);
}

/** The repository itself, resolved from this module and never from the working directory. */
const REPO = new URL('../../../', import.meta.url);
const repoFile = (path: string): string => readFileSync(new URL(path, REPO), 'utf8');

/** The sentences of what a screen rendered (a full stop ends one, as W30.F1.01 reads them). */
const sentencesOf = (text: string): string[] => text.split('.').map(sentence => sentence.trim()).filter(Boolean);
/** Does one sentence carry all of these? The wording is the implementation's to choose. */
const says = (text: string, ...patterns: RegExp[]): boolean =>
  sentencesOf(text).some(sentence => patterns.every(pattern => pattern.test(sentence)));
/** The same question of published prose, where a full stop ends a sentence only before whitespace. */
const saysInProse = (text: string, ...patterns: RegExp[]): boolean =>
  text.split(/(?<=[.!?])\s+/).some(sentence => patterns.every(pattern => pattern.test(sentence)));

/**
 * D2's claim, and its plain rewordings: that an hour called repaired was folded
 * BEFORE, i.e. repaired "rather than first folded". `maturityOf` makes no such
 * claim — a first fold that reached the hour late is `repaired` too.
 */
const PRIOR_FOLD_CLAIM = /\b(?:rather than|instead of)\s+(?:being\s+)?(?:(?:a|its|their|the)\s+)?(?:first[- ]?fold|folded for the first time)/i;

// ===========================================================================
// unit:W30.L1 — a late row past the horizon reaches its published day
// ===========================================================================

describe('unit:W30.L1', () => {
  /**
   * Program W30 criterion L1 (amendment A46): "A late row that reaches a final
   * hour past the re-fold horizon reaches its published day: the cron
   * republishes that date with the row counted and named, as kit 02 states for
   * late rows (adoption defect D1, a regression against 7e65a26)."
   *
   * The fixture is the adoption probe's (`late-republish-defaults.probe.test.ts`)
   * on the real path: decisions served in hour 22 of the date, the cron's first
   * sight of the date just after midnight, then clicks that HAPPENED in hour 22
   * delivered ten minutes after hour 22 passed the published horizon, then the
   * cron on its own schedule for an hour. Measured at the W30-B1 build: the
   * stored hour carries `lateObjects: 1` while the published day keeps
   * `lateAfterMaturity: []` and is never published again.
   *
   * RULED (kit 02, W30.M1.01): the day the cron publishes carries the row —
   * COUNTED and NAMED (`coverage.lateAfterMaturity: [{hour: 22, objects: 1}]`,
   * `status: 'incomplete'`) and applied nowhere (the hour stays `final`, the
   * outcome and credit counts do not move). How the cron comes to republish the
   * date is the build's; that it does, within the hour of runs, is ruled.
   */
  const T22 = Date.UTC(2026, 8, 3, 22, 0, 0);
  const LATE_HOUR = 22;

  it('host: after a late row reaches hour 22 past the published horizon, the five-minute cron republishes the date, and the day an operator reads counts and names the row and applies it nowhere', async () => {
    const maturity = maturityWindow();
    expect(typeof maturity === 'number' ? 'published' : absent(MATURITY_EXPORT, hourly),
      'W30.L1 — the published re-fold horizon exists before a row can be said to have arrived past it').toBe('published');
    const window = maturity!;

    const m = await mount();
    // Hour 22: a Coach visitor on a Tabby piece, and a visitor in the unknown
    // cell on the piece the taxonomy does not know.
    const tabby = decision(m.env, 'v-tabby', T22 + 10 * MIN, 'cnt-tabby-evening');
    const unknown = decision(m.env, 'u-unknown', T22 + 12 * MIN, 'cnt-unknown-taxonomy');
    await throughTheLedger(m, [tabby, unknown], [], T22 + 13 * MIN);

    // 00:06 the next day: the cron's first sight of the date publishes it.
    const firstSight = T22 + 2 * H + 6 * MIN;
    const first = await cronUntilQuiet(m, firstSight);
    expect({ published: first.published.includes(DATE), failed: first.failed },
      'the fixture: the cron folds the date and publishes it the first time it sees it').toEqual({ published: true, failed: [] });
    const before = await publishedDay(m);
    expect({ decisions: before.counts.decisions, outcomes: before.counts.outcomes },
      'the fixture: the day as first published holds the two decisions of hour 22 and no outcome').toEqual({ decisions: 2, outcomes: 0 });

    // Ten minutes after hour 22 became final, clicks that HAPPENED at 22:30 and
    // 22:35 reach hour 22's prefix in one delivery: one late ledger object.
    const arrival = T22 + H + window + 10 * MIN;
    await throughTheLedger(m, [], [click(m.env, tabby, T22 + 30 * MIN, 'w30-l1-late-tabby'),
      click(m.env, unknown, T22 + 35 * MIN, 'w30-l1-late-unknown')], arrival);
    const lateObjects = [...m.storage.objects.keys()].filter(key => key.startsWith(`${hourPrefix(TENANT, T22)}/outcome/`));
    expect({ objects: lateObjects.length, pastTheHorizon: arrival > T22 + H + window },
      'the fixture: the late rows sit in hour 22\'s own ledger prefix as one object, delivered after hour 22 passed the published horizon')
      .toEqual({ objects: 1, pastTheHorizon: true });

    // The cron on its own schedule for an hour: twelve runs, five minutes apart.
    const after = await cronEveryFiveMinutes(m, arrival, 12);
    const day = await publishedDay(m);
    expect({ republishedByTheCron: after.published.includes(DATE), builtAfterTheRowArrived: day.builtAt >= arrival, failed: after.failed },
      `W30.L1 (adoption D1) — the cron REPUBLISHES the date a late row reached: within an hour of five-minute runs after the row arrived, a run publishes ${DATE} and the day an operator reads was built after the row arrived. Measured at the W30-B1 build: \`staleHour\` records \`lateObjects\` on the hour (hourly.ts:1946-1947, :2033) but \`catchUp\` republishes only a date that had an hour built in the same run (:2067, :2071), so the day stays as first published (built at ${new Date(before.builtAt).toISOString()}); runs published: ${JSON.stringify(after.published)}`)
      .toEqual({ republishedByTheCron: true, builtAfterTheRowArrived: true, failed: [] });

    const coverage = coverageOf(day);
    expect({ lateAfterMaturity: coverage.lateAfterMaturity ?? absent('`coverage.lateAfterMaturity`', coverage),
      status: coverage.status,
      hour22: coverage.maturities?.find(row => row.hour === LATE_HOUR) ?? absent('`coverage.maturities`', coverage),
      decisions: day.counts.decisions, outcomes: day.counts.outcomes,
      credits: day.policies.find(row => row.role === 'learning')?.credits },
      'W30.L1 — and the republished day carries the row as kit 02 states for late rows: COUNTED and NAMED with its hour (`lateAfterMaturity: [{hour: 22, objects: 1}]`) and "applied nowhere" — hour 22 stays `final`, the outcome and credit counts do not move — and the day says it is incomplete because data exists that it does not include (the W30.M1.01 representation, on the cron path)')
      .toEqual({ lateAfterMaturity: [{ hour: LATE_HOUR, objects: 1 }], status: 'incomplete',
        hour22: { hour: LATE_HOUR, maturity: 'final' }, decisions: 2, outcomes: 0, credits: 0 });
  });
});

// ===========================================================================
// unit:W30.S1 — both screens describe `repaired` as maturityOf and kit 02 do
// ===========================================================================

interface ScreenElement { value: string; dispatchEvent: (event: unknown) => boolean }
interface ScreenWindow extends Record<string, unknown> {
  Date: { now: () => number };
  document: { body: { textContent: string | null }; getElementById: (id: string) => ScreenElement | null };
  Event: new (type: string, options: Record<string, unknown>) => unknown;
  localStorage: { setItem: (key: string, value: string) => void };
  eval: (code: string) => unknown;
  close: () => void;
}

/** Both shipped screens, rendered against the mounted application (the W30.F1.01 harness, `B1.unit.test.ts:1063-1101`). */
async function renderScreens(m: Mounted): Promise<Array<{ name: string; text: string }>> {
  const screens: Array<{ name: string; text: string }> = [];
  for (const screen of ['console', 'legacy'] as const) {
    const page = screen === 'console' ? 'console/index.html' : 'legacy/learning.html';
    const dom = new JSDOM(repoFile(`public/${page}`),
      { url: `${OPERATOR_ORIGIN}/${screen === 'console' ? `console/#/measure?scope=${TENANT}&date=${DATE}` : `legacy/learning.html?scope=${TENANT}&brand=${BRAND}&slot=hero`}`, pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window as unknown as ScreenWindow;
    // The window has its own `Date`; the screen reads the test's clock (SCREEN_TEST_NOW).
    w.Date.now = () => Date.now();
    w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const target = new URL(url, `${OPERATOR_ORIGIN}/`);
      return m.fetch(new Request(OPERATOR_ORIGIN + target.pathname + target.search, {
        method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
      }));
    };
    w.TextEncoder = TextEncoder;
    w.setInterval = () => 1;
    w.localStorage.setItem('operator-session', JSON.stringify({ accessToken: m.operatorToken, refreshToken: 'w30-ledger-refresh',
      exp: Date.now() + 3_600_000, user: { id: 'ops', name: 'Operator', email: 'ops@brand.test', roles: ['admin'], tenants: [TENANT] }, mustChangePassword: false }));
    const scripts = screen === 'console'
      ? ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js', 'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js']
      : ['operator-session.js', 'learning.js'];
    for (const script of scripts) w.eval(repoFile(`public/${script}`));
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
  return screens;
}

describe('unit:W30.S1', () => {
  /**
   * Program W30 criterion S1 (amendment A46): "The console measurement screen
   * and the learning screen describe an hour as repaired exactly as maturityOf
   * and kit 02 define it (an hour folded after the re-fold horizon, whether or
   * not it was folded before), never as repaired rather than first folded
   * (adoption defect D2)."
   *
   * The fixture is D2's own case: a backlog the cron catches up only after the
   * hours are final (an outage, a paused cron), so hour 12 — which holds the
   * date's decisions — is folded for the FIRST time after its horizon. Its
   * aggregate is written once, and `maturityOf` calls it `repaired`. At the
   * W30-B1 build both screens render that hour under "Hours whose aggregate was
   * written after they were already final, so their numbers were repaired
   * rather than first folded" (views-measure.js:129, learning.js:414), which is
   * false for it.
   *
   * The wording is the build's; what is ruled is (1) the definition stays the
   * one `maturityOf` and kit 02 publish — a first fold past the horizon IS
   * `repaired` — and (2) each screen states the repaired hour as one whose
   * aggregate was written after it was final, in one sentence with the hour,
   * and makes no claim that it had been folded before.
   */
  const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);
  const HOUR = 12;

  it('screens: an hour the cron first folded after its horizon reads `repaired`, as kit 02 defines it, and both shipped screens say it was written after it was final without claiming it was repaired rather than first folded', async () => {
    runOnTheScreenTestClock();
    const maturity = maturityWindow();
    expect(typeof maturity === 'number' ? 'published' : absent(MATURITY_EXPORT, hourly),
      'W30.S1 — the published re-fold horizon exists before an hour can be folded past it').toBe('published');
    const window = maturity!;

    const m = await mount();
    await throughTheLedger(m, [decision(m.env, 'v-rogue', T12 + 10 * MIN, 'cnt-rogue-work'),
      decision(m.env, 'v-charms', T12 + 11 * MIN, 'cnt-charms-slg'),
      decision(m.env, 'u-unknown', T12 + 12 * MIN, 'cnt-unknown-taxonomy')], [], T12 + 13 * MIN);
    // The cron sees the date for the first time ten minutes after hour 12 passed
    // the published horizon, and catches the backlog up.
    const backlog = await cronUntilQuiet(m, T12 + H + window + 10 * MIN);
    expect({ published: backlog.published.includes(DATE), failed: backlog.failed },
      'the fixture: the cron catches the backlog up and publishes the date').toEqual({ published: true, failed: [] });

    const coverage = coverageOf(await publishedDay(m));
    expect({ hour12: coverage.maturities?.find(row => row.hour === HOUR) ?? absent('`coverage.maturities`', coverage),
      aggregateWrites: m.storage.versions.get(hourKey(TENANT, DATE, HOUR)) },
      'W30.S1 — the definition the screens must describe: hour 12 was folded ONCE, for the first time, after its horizon, and the published day calls it `repaired` — `maturityOf` (hourly.ts:1213-1215) marks an hour whose aggregate was written after it became final, "whether or not it was folded before"; the fix is the screens\' sentence, never this definition')
      .toEqual({ hour12: { hour: HOUR, maturity: 'repaired' }, aggregateWrites: 1 });
    expect(saysInProse(repoFile('docs/kit/02-api-reference.md'), /`repaired`/, /after it became final/i, /first fold/i),
      'W30.S1 — and kit 02 keeps defining it so: `repaired` is an hour whose aggregate was written after it became final, a rebuild or "a first fold that reached the hour late"')
      .toBe(true);

    for (const screen of await renderScreens(m)) {
      expect(says(screen.text, /repair/i, /\b12\b/, /\bafter\b/i, /\bfinal\b|horizon/i),
        `W30.S1 — ${screen.name} must say, in one sentence with the hour, that hour 12 is repaired because its aggregate was written after it was final (past the published horizon) — the definition \`maturityOf\` and kit 02 publish. It rendered: ${screen.text.slice(0, 900)}`)
        .toBe(true);
      expect(sentencesOf(screen.text).filter(sentence => /repair/i.test(sentence) && PRIOR_FOLD_CLAIM.test(sentence)),
        `W30.S1 (adoption D2) — and ${screen.name} must not describe a repaired hour as "repaired rather than first folded": hour 12 was folded for the first time, after its horizon, and \`maturityOf\` and kit 02 call it repaired whether or not it was folded before (views-measure.js:129 and learning.js:414 at the W30-B1 build)`)
        .toEqual([]);
    }
  });
});
