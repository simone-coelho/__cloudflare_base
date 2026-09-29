// src/units/W33/FIX1.unit.test.ts
//
// W33 fix 1 — O2 against the writers as they actually run.
//
// AUTHORITY (docs/remediation/delivery-control/program.json, ticket W33, quoting
// document 35 §5 row W33, line 435): "… Protect against concurrent
// overlay/canonical writes." Frozen criterion O2: "Canonical day writes from
// runReport (src/learn/report.ts around line 1351) and publishAggregateDay
// (src/learn/hourly.ts around line 1884) are conditional, so a stale or
// overlay-derived write never replaces a newer canonical day under concurrency."
//
// WHY THIS FILE. The W33 delivery review at bc788a2
// (/home/simonecoelho/rem/_evidence/W33-delivery/reviewer/REPORT.md) failed O2:
// the four O2 cases of LEDGER.unit.test.ts pass, but in each of them the
// five-minute job was handed a clock LATER than the writer it raced. As the
// Worker runs it, the job's day is stamped with the run's START
// (src/index.ts:272 passes `Date.now()` when the run begins) while the job reads
// its hour aggregates only after its folds, and the POST and the nightly job
// read the stored day only at write time. So a POST or a nightly job that starts
// DURING a run, sees fewer hours than the run will publish, and finishes last
// replaces the run's newer day (review probes P1 and P4). The same gap exists the
// other way round, on the job's own write for a date it folded.
//
// WHAT IS PINNED. O2 as its text reads: a writer whose source view is older than
// the stored day's never replaces it under concurrency. A writer's SOURCE VIEW is
// what it read to compute its day: first the date's hour aggregates it listed,
// then their bytes (or, where it listed none, the ledger rows). A view is OLDER
// when the stored day was computed from a view that holds everything it saw and
// more, read after it. Every case holds the stale writer right after its FIRST
// source read has answered — the listing of the date's aggregates, which already
// fixes which hours it will sum or that it will fall back to the ledger — lets the
// newer writer publish, lets the stale writer finish, and asserts the STORED DAY
// read back through the mounted GET: its hours, its decisions, its source. It
// never asserts a build time, the stale writer's response, or whether the stale
// writer was refused, retried or rebuilt: that is the build's choice.
//
//   O2.05 / O2.06  review probe P1: the POST / the nightly job, started 1 s after
//                  a five-minute run began, listed hour 12 alone; the run folds
//                  hour 23 and publishes hours 12 and 23.
//   O2.07 / O2.08  review probe P4 (sweep L1, the ledger degradation): the POST /
//                  the nightly job, started 1 s after the run began, listed no
//                  aggregate for the date; the run folds the date's only hour and
//                  publishes the aggregate-backed day; the writer then reads the
//                  ledger (the same rows the fold read) and finishes last.
//   O2.09 / O2.10  the job with the older view: a run started 1 s AFTER the POST /
//                  the nightly job (so the builtAt rule cannot stop it) listed
//                  hours 12 and 23; hour 22 is folded meanwhile, the POST / the
//                  nightly job publishes hours 12, 22 and 23, and the run
//                  finishes last.
//   O2.11          src/learn/report.ts:643, measured: where the stored day's
//                  leading frame fails to read when a stale writer comes to write,
//                  the builtAt rule is dropped, and a POST that began BEFORE the
//                  run (which that rule otherwise stops) replaces the run's newer
//                  day. Without the failed read the same case is green at bc788a2.
//
// NOT PINNED, AND WHY.
//   · Review probe P2 ("a run replaces a day built after it began", the stored
//     build time going backwards). In P2 the run listed hours 12 AND 13 after the
//     day holding hour 12 alone had been stored: its view is the newer one, its
//     write is not stale, and the day it replaces is not newer in anything O2
//     names. O2 forbids a stale write replacing a newer day; it says nothing of
//     build times, and it does not forbid the newer view reaching the key. So P2
//     is neither pinned nor forbidden here. The sentences the review found untrue
//     (kit 02 :745 and :765, rest :16, the report.ts :648 comment) are a document
//     defect, judged by reading, not by a test.
//   · A ledger-path day that read MORE rows than the job's fold against the job's
//     aggregate day. Each view is newer in one respect (the ledger writer listed
//     the aggregates before the fold and read the ledger after it); the sweep's
//     remedy ("leave the canonical key to the fold") and O2's "newer" point
//     opposite ways, so the witness does not determine the outcome and no case
//     asserts one. In O2.07/08 both views hold the same rows.
//   · The job never writes a ledger-sourced day (its publication is strict and
//     refuses a date with no aggregate), so P4 has no job-is-stale direction; the
//     job-is-stale direction is O2.09/10.
//
// THE ACTORS are the product's own, called as the Worker calls them:
//   · the five-minute job — src/index.ts:271-272: the learn document read with
//     `read(env, LEARN_KIND, tenant, DEFAULT_LEARN)`, then
//     `catchUp(env.STORAGE, tenant, learn, Date.now(), opts, env)` with the clock
//     at the run's start. `opts` sizes the fixture ({ shards: 1, lookbackHours: 4 }
//     for the handler's `{}`, whose 26-hour lookback would first fold the two
//     oldest empty hours); the clock is the handler's;
//   · the nightly job — src/index.ts:282-286: `yesterday` from `Date.now()`, the
//     same learn read, `runDayReport(env.STORAGE, ids, learn, null, Date.now(), {}, env)`;
//   · the authenticated POST /v1/:tenant/learn/report { date } through the mounted
//     decision routes (src/routes/decisions.ts:1327), which reads the published
//     learn document and passes `Date.now()` itself;
//   · the earlier fold is a `catchUp` run; the one fold O2.09/10 need "meanwhile"
//     (hour 22) is `buildHour`, the fold `catchUp` itself calls, as the O2 cases of
//     LEDGER.unit.test.ts fold hour 13;
//   · the stored day is read back through the mounted GET /v1/:tenant/learn/report.
// Storage and the operator credential are the only synthetic parts. The clock is
// Date alone, faked (timers stay real) and set to each actor's start before it
// starts; an actor is held before the clock moves on, after it has read it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { hourPrefix, ts36, type OutcomeRecord } from '@/ledger/records';
import { reportKey, type DayReport } from '@/learn/report';
import { buildHour, catchUp, runDayReport, type R2Agg } from '@/learn/hourly';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { invalidateCache, read } from '@/config/versionedStore';
import { initializePublicationSet } from '@/config/publication';
import { captureRetention, type RetentionEnv } from '@/retention';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';

// ─── the fixture: one tenant, the day of 2026-09-03 ─────────────────────────

const TENANT = 'coach';
const DATE = '2026-09-03';
const SECOND = 1000;
const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 3, hour, minute);
/** An earlier five-minute run, when hour 12 had just closed (hour start + 1 h + 5 min grace). */
const EARLIER_RUN = Date.UTC(2026, 8, 3, 13, 5);
/** 03:00 UTC on the next day, when the nightly cron and a five-minute tick fire together. */
const RUN = Date.UTC(2026, 8, 4, 3, 0);
/** At RUN this lookback holds hour 23 of the fixture day and hours 0 and 1 of the next; the run folds the two oldest it lacks. */
const JOB_OPTS = { shards: 1, lookbackHours: 4 };
const DAY_KEY = reportKey(TENANT, TENANT, DATE);
/** The prefix every day writer lists first: the date's hour aggregates. */
const DATE_AGGREGATES = `aggregates/${TENANT}/${DATE}/`;
/** The prefix the fold of hour 23 lists first: that hour's ledger. */
const HOUR_23_LEDGER = `${TENANT}/${DATE}/23/`;

const LEARN: LearnConfig = { ...DEFAULT_LEARN, holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click' } } };
const OPERATOR_SECRET = 'w33-fix1-synthetic-operator-signing-material';
const TENANTS = JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } });
/**
 * SYNTHETIC retention registry, not an approved retention period: the POST and
 * the jobs carry the Worker's env as their retention authority and admit a
 * ledger row only against an explicit per-category policy (the shape of
 * src/learn/report.test.ts REPORT_RETENTION).
 */
const RETENTION = JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(['ledger', 'online', 'hourly'].map(category => [category,
  { id: 'w33-fix1-' + category, revision: 1, durationMs: 365 * 86_400_000, basis: 'occurred', renewal: 'new-record-only' }])) } });
const RETENTION_ENV = { TENANTS, RETENTION } as RetentionEnv;

const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: null };
const dec = (visitor: string, ts: number, item: string): DecisionRecord => ({
  decision_id: `${TENANT}:${ts36(ts)}:${visitor}:home:hero:0`, tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: `s-${visitor}`,
  identity_anchor: 'visitor', ts, page: 'home', slot: 'hero', position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell,
  arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1',
  explain: { drivers: [], score_base: 0, lift: null, score_final: 0 }, retention: captureRetention(RETENTION_ENV, TENANT, ts, ts),
} as DecisionRecord);
const click = (visitor: string, ts: number, item: string): OutcomeRecord => ({
  outcome_id: `${TENANT}:${ts36(ts)}:${visitor}:click`, tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: `s-${visitor}`, ts,
  type: 'click', event: 'click', item_id: item, slot: null, value: null, currency: null, margin: null, products: null, arm: null,
  retention: captureRetention(RETENTION_ENV, TENANT, ts, ts),
} as OutcomeRecord);

/** Two shoppers at noon; the second clicks what she was served. */
const NOON = { decisions: [dec('v1', at(12), 'a'), dec('v2', at(12, 1), 'b')], outcomes: [click('v2', at(12, 2), 'b')] };
/** A shopper at 22:10. */
const TEN_PM = { decisions: [dec('v4', at(22, 10), 'b')], outcomes: [click('v4', at(22, 12), 'b')] };
/** A shopper at 23:10. */
const ELEVEN_PM = { decisions: [dec('v3', at(23, 10), 'a')], outcomes: [click('v3', at(23, 11), 'a')] };

// ─── storage: an R2 bucket with R2's own conditional semantics ──────────────

interface Stored { body: string; etag: string; uploaded: Date; version: string }

/**
 * Synthetic R2 (the double of LEDGER.unit.test.ts, with three more hooks).
 * Conditional reads/writes follow R2: `onlyIf` as an R2Conditional or as
 * Headers; a failed precondition on put answers null and writes nothing.
 *   · `beforeList` / `afterList` hold one lister at an exact point: before the
 *     listing is taken, or after it has been taken (the lister's view of the
 *     prefix is fixed; it is suspended before it can use it);
 *   · `failFrameRead` makes the next RANGED read of one key fail mid-stream, the
 *     way an R2 body can: the object and its etag are answered, its bytes are not.
 */
class DayR2 {
  private objects = new Map<string, Stored>();
  private seq = 0;
  puts: string[] = [];
  beforeList?: (prefix: string) => Promise<void> | void;
  afterList?: (prefix: string) => Promise<void> | void;
  failFrameRead?: string;

  place(key: string, body: string): void { this.objects.set(key, this.record(body)); }

  private record(body: string): Stored {
    this.seq += 1;
    return { body, etag: createHash('sha256').update(body).digest('hex'), uploaded: new Date(Date.UTC(2026, 8, 1) + this.seq * 1000), version: `v${this.seq}` };
  }
  private meta(key: string, s: Stored) {
    return { key, etag: s.etag, httpEtag: `"${s.etag}"`, version: s.version, uploaded: s.uploaded, size: new TextEncoder().encode(s.body).length,
      httpMetadata: { contentType: 'application/json' }, customMetadata: {}, checksums: {}, storageClass: 'Standard' };
  }
  private passes(s: Stored | undefined, onlyIf: unknown): boolean {
    if (!onlyIf) return true;
    const strip = (e: string) => e.replace(/^W\//, '').replace(/^"|"$/g, '');
    let c: { etagMatches?: string; etagDoesNotMatch?: string; uploadedBefore?: Date; uploadedAfter?: Date };
    if (onlyIf instanceof Headers) {
      const since = onlyIf.get('If-Modified-Since'), unmodified = onlyIf.get('If-Unmodified-Since');
      c = { ...(onlyIf.get('If-Match') ? { etagMatches: onlyIf.get('If-Match')! } : {}),
        ...(onlyIf.get('If-None-Match') ? { etagDoesNotMatch: onlyIf.get('If-None-Match')! } : {}),
        ...(unmodified ? { uploadedBefore: new Date(unmodified) } : {}), ...(since ? { uploadedAfter: new Date(since) } : {}) };
    } else c = onlyIf as typeof c;
    if (c.etagMatches !== undefined) {
      if (!s) return false;
      const wanted = c.etagMatches.split(',').map(e => strip(e.trim()));
      if (!wanted.includes('*') && !wanted.includes(s.etag)) return false;
    }
    if (c.etagDoesNotMatch !== undefined && s) {
      const refused = c.etagDoesNotMatch.split(',').map(e => strip(e.trim()));
      if (refused.includes('*') || refused.includes(s.etag)) return false;
    }
    if (c.uploadedBefore !== undefined && s && !(s.uploaded.getTime() < new Date(c.uploadedBefore).getTime())) return false;
    if (c.uploadedAfter !== undefined && s && !(s.uploaded.getTime() > new Date(c.uploadedAfter).getTime())) return false;
    return true;
  }

  async head(key: string) { const s = this.objects.get(key); return s ? this.meta(key, s) : null; }
  async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } | Headers; onlyIf?: unknown }) {
    const s = this.objects.get(key);
    if (!s) return null;
    if (!this.passes(s, options?.onlyIf)) return this.meta(key, s);
    if (this.failFrameRead === key && options?.range) {
      this.failFrameRead = undefined;
      const failure = () => new Error('synthetic R2 body failure mid-stream');
      return { ...this.meta(key, s), range: options.range, bodyUsed: false,
        body: new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.error(failure()); } }),
        text: async () => { throw failure(); }, json: async () => { throw failure(); }, arrayBuffer: async () => { throw failure(); } };
    }
    const bytes = new TextEncoder().encode(s.body);
    const r = options?.range && !(options.range instanceof Headers) ? options.range : undefined;
    let from = 0, to = bytes.length;
    if (r?.suffix !== undefined) from = Math.max(0, bytes.length - r.suffix);
    else if (r) { from = r.offset ?? 0; to = r.length !== undefined ? Math.min(bytes.length, from + r.length) : bytes.length; }
    const selected = bytes.slice(from, to), text = new TextDecoder().decode(selected);
    return { ...this.meta(key, s), range: r, bodyUsed: false,
      body: new ReadableStream<Uint8Array>({ start(ctrl) { ctrl.enqueue(selected); ctrl.close(); } }),
      text: async () => text, json: async () => JSON.parse(text) as unknown, arrayBuffer: async () => selected.buffer };
  }
  async put(key: string, value: string, options?: { onlyIf?: unknown }) {
    const body = String(value);
    if (!this.passes(this.objects.get(key), options?.onlyIf)) return null;
    const s = this.record(body);
    this.objects.set(key, s); this.puts.push(key);
    return this.meta(key, s);
  }
  async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const prefix = options.prefix ?? '';
    await this.beforeList?.(prefix);
    const names = [...this.objects.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = Number(options.cursor ?? 0), end = start + Math.min(options.limit ?? 1000, 1000);
    const page = { objects: names.slice(start, end).map(key => this.meta(key, this.objects.get(key)!)), truncated: end < names.length,
      ...(end < names.length ? { cursor: String(end) } : {}), delimitedPrefixes: [] as string[] };
    await this.afterList?.(prefix);
    return page;
  }
}

/** The ledger as the consumer writes it: one object per record, under its hour, stream and batch. */
function deliver(r2: DayR2, batch: string, rows: { decisions: DecisionRecord[]; outcomes: OutcomeRecord[] }): void {
  for (const d of rows.decisions) r2.place(`${hourPrefix(TENANT, d.ts)}/decision/${ts36(d.ts)}-${ts36(d.ts)}-${batch}.ndjson`, JSON.stringify(d) + '\n');
  for (const o of rows.outcomes) r2.place(`${hourPrefix(TENANT, o.ts)}/outcome/${ts36(o.ts)}-${ts36(o.ts)}-${batch}.ndjson`, JSON.stringify(o) + '\n');
}

// ─── holding a writer at an exact point ─────────────────────────────────────

function gate() {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const opened = new Promise<void>(r => { release = r; });
  return { ready, release, hold: async () => { entered(); await opened; } };
}
/** Hold the NEXT listing of exactly this prefix, once, before it is taken. */
function holdBeforeList(r2: DayR2, prefix: string) {
  const g = gate();
  r2.beforeList = async p => { if (p === prefix) { r2.beforeList = undefined; await g.hold(); } };
  return g;
}
/** Hold the NEXT listing of exactly this prefix, once, after it is taken and before the lister sees it. */
function holdAfterList(r2: DayR2, prefix: string) {
  const g = gate();
  r2.afterList = async p => { if (p === prefix) { r2.afterList = undefined; await g.hold(); } };
  return g;
}
const settle = <T>(p: Promise<T>) => p.then(value => ({ value }), (error: unknown) => ({ error }));

// ─── the Worker's actors ─────────────────────────────────────────────────────

function worker(r2: DayR2): Env {
  return { AUTH_MODE: 'enforced', JWT_SECRET: OPERATOR_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', TENANTS, RETENTION,
    CACHE: { get: async () => null }, STORAGE: r2 } as unknown as Env;
}
/** The tenant's published learn document: what the POST route and both jobs read. */
async function publishLearn(env: Env): Promise<void> {
  invalidateCache('learn', TENANT);
  await initializePublicationSet({ STORAGE: env.STORAGE } as unknown as Env, [
    { kind: LEARN_KIND, scope: TENANT, revision: { revision: 1, value: LEARN, actor: 'w33-fix1-fixture', note: '', at: at(0) } },
  ], '0:' + crypto.randomUUID());
}
/** src/index.ts:271-272 — the five-minute job, `now` read from the clock as the run starts. */
async function fiveMinuteJob(env: Env, opts: { shards: number; lookbackHours: number } = JOB_OPTS) {
  const learn = await read<LearnConfig>(env, LEARN_KIND, TENANT, DEFAULT_LEARN);
  return catchUp(env.STORAGE as unknown as R2Agg, TENANT, learn, Date.now(), opts, env);
}
/** src/index.ts:282-286 — the nightly job, yesterday's day from the clock as it starts. */
async function nightlyJob(env: Env) {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const learn = await read<LearnConfig>(env, LEARN_KIND, TENANT, DEFAULT_LEARN);
  return runDayReport(env.STORAGE as unknown as R2Agg, { tenant: TENANT, brand: TENANT, date: yesterday }, learn, null, Date.now(), {}, env);
}
const app = () => new Hono<{ Bindings: Env }>().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
async function operatorToken(): Promise<string> {
  return new SignJWT({ type: 'service' }).setProtectedHeader({ alg: 'HS256' }).setSubject('ops').setIssuer('i').setAudience('a')
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(OPERATOR_SECRET));
}
/** POST /v1/:tenant/learn/report { date } — the canonical build (no policies) an operator asks for. */
async function operatorPost(env: Env): Promise<Response> {
  return app().request(`/v1/${TENANT}/learn/report`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${await operatorToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: DATE }) }, env);
}
/** GET /v1/:tenant/learn/report?date= — the stored canonical day. */
async function storedDay(env: Env): Promise<DayReport> {
  const response = await app().request(`/v1/${TENANT}/learn/report?date=${DATE}`,
    { headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${await operatorToken()}` } }, env);
  expect(response.status, 'the canonical day GET answers').toBe(200);
  return (await response.json() as { report: DayReport }).report;
}
type Writer = 'POST' | 'nightly';
function start(writer: Writer, env: Env) {
  if (writer === 'nightly') expect(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), 'fixture: at this clock the nightly job builds the fixture day').toBe(DATE);
  return writer === 'POST' ? settle(operatorPost(env)) : settle(nightlyJob(env));
}

/** The learn document, the noon rows, and an earlier run that folded hour 12 and published the day from it. */
async function dayWithNoonFolded(): Promise<{ r2: DayR2; env: Env }> {
  const r2 = new DayR2(), env = worker(r2);
  vi.setSystemTime(at(0)); await publishLearn(env);
  deliver(r2, 'noon', NOON);
  vi.setSystemTime(EARLIER_RUN);
  const earlier = await fiveMinuteJob(env, { shards: 1, lookbackHours: 1 });
  expect(earlier.reports.published, 'fixture: an earlier run folded hour 12 and published the day').toEqual([DATE]);
  expect((await storedDay(env)).hours?.built, 'fixture: the stored day holds hour 12').toEqual([12]);
  return { r2, env };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { vi.useRealTimers(); });

// =============================================================================
// Review probe P1 — the POST or the nightly job, started during a run, listed fewer hours
// =============================================================================

function staleWriterDuringRun(writer: Writer) {
  return async () => {
    const { r2, env } = await dayWithNoonFolded();
    deliver(r2, 'eleven-pm', ELEVEN_PM);
    // The run starts at RUN; it is held as it begins to fold hour 23.
    vi.setSystemTime(RUN);
    const run = holdBeforeList(r2, HOUR_23_LEDGER);
    const job = settle(fiveMinuteJob(env));
    await run.ready;
    // 1 s later the writer starts; it lists the date's aggregates (hour 12 alone) and is held.
    vi.setSystemTime(RUN + SECOND);
    const writerHeld = holdAfterList(r2, DATE_AGGREGATES);
    const stale = start(writer, env);
    await writerHeld.ready;
    // The run finishes: hour 23 folded, the day published from hours 12 and 23.
    run.release();
    const finished = await job;
    expect('error' in finished ? finished.error : null, 'fixture: the run completed').toBeNull();
    const newer = await storedDay(env);
    expect(newer.hours?.built, 'fixture: the run published hours 12 and 23').toEqual([12, 23]);
    expect(newer.counts.decisions, 'fixture: the run\'s day counts three decisions').toBe(3);
    // The writer whose view was hour 12 alone finishes last.
    writerHeld.release(); await stale;
    const after = await storedDay(env);
    expect(after.hours?.built, `O2 — the ${writer} that listed hour 12 alone must not replace the run's newer day (hours 12 and 23)`).toEqual([12, 23]);
    expect(after.counts.decisions, 'O2 — the newer day\'s three decisions stand').toBe(3);
    expect(after.hours?.source, 'O2 — and it is still aggregate-backed').toBe('aggregates');
  };
}

describe('unit:W33.O2.05', () => {
  it('host: an authenticated POST that starts during a five-minute run and listed fewer hours never replaces the day the run published (review probe P1)',
    staleWriterDuringRun('POST'));
});

describe('unit:W33.O2.06', () => {
  it('host: the nightly job that starts during a five-minute run and listed fewer hours never replaces the day the run published (review probe P1)',
    staleWriterDuringRun('nightly'));
});

// =============================================================================
// Review probe P4 (sweep L1) — the POST or the nightly job listed no aggregate before the fold
// =============================================================================

function ledgerWriterDuringRun(writer: Writer) {
  return async () => {
    // The fixture day's only activity is late in the evening; no hour of it is folded yet.
    const r2 = new DayR2(), env = worker(r2);
    vi.setSystemTime(at(0)); await publishLearn(env);
    deliver(r2, 'eleven-pm', ELEVEN_PM);
    // The run starts at RUN; it is held as it begins to fold hour 23.
    vi.setSystemTime(RUN);
    const run = holdBeforeList(r2, HOUR_23_LEDGER);
    const job = settle(fiveMinuteJob(env));
    await run.ready;
    // 1 s later the writer starts; it lists the date's aggregates (none) and is held.
    vi.setSystemTime(RUN + SECOND);
    const writerHeld = holdAfterList(r2, DATE_AGGREGATES);
    const stale = start(writer, env);
    await writerHeld.ready;
    // The run finishes: hour 23 folded, the day published from its aggregate.
    run.release();
    const finished = await job;
    expect('error' in finished ? finished.error : null, 'fixture: the run completed').toBeNull();
    const newer = await storedDay(env);
    expect(newer.hours?.source, 'fixture: the run published an aggregate-backed day').toBe('aggregates');
    expect(newer.hours?.built, 'fixture: from hour 23').toEqual([23]);
    expect(newer.counts.decisions, 'fixture: with the evening shopper').toBe(1);
    // The writer that found no aggregate reads the ledger and finishes last.
    writerHeld.release(); await stale;
    const after = await storedDay(env);
    expect(after.hours?.source, `O2 (L1: the overwrite degrades \`hours\` to the ledger) — the ${writer} that listed no aggregate must not replace the run's aggregate-backed day`).toBe('aggregates');
    expect(after.hours?.built, 'O2 — the newer day\'s hour stands').toEqual([23]);
    expect(after.counts.decisions, 'O2 — with the evening shopper').toBe(1);
  };
}

describe('unit:W33.O2.07', () => {
  it('host: an authenticated POST that starts during a five-minute run and listed no aggregate before the fold never replaces the aggregate-backed day the run published (review probe P4)',
    ledgerWriterDuringRun('POST'));
});

describe('unit:W33.O2.08', () => {
  it('host: the nightly job that starts during a five-minute run and listed no aggregate before the fold never replaces the aggregate-backed day the run published (review probe P4)',
    ledgerWriterDuringRun('nightly'));
});

// =============================================================================
// The other direction — the five-minute job holds the older view
// =============================================================================

function staleRunAgainstWriter(writer: Writer) {
  return async () => {
    const { r2, env } = await dayWithNoonFolded();
    deliver(r2, 'ten-pm', TEN_PM);
    deliver(r2, 'eleven-pm', ELEVEN_PM);
    // The writer starts at RUN and is held before it lists the date's aggregates.
    vi.setSystemTime(RUN);
    const writerHeld = holdBeforeList(r2, DATE_AGGREGATES);
    const newerWriter = start(writer, env);
    await writerHeld.ready;
    // 1 s later a five-minute run starts. It is held first as it begins to fold hour 23,
    // then after it lists the date's aggregates for its day (hours 12 and 23).
    vi.setSystemTime(RUN + SECOND);
    const folding = holdBeforeList(r2, HOUR_23_LEDGER);
    const job = settle(fiveMinuteJob(env));
    await folding.ready;
    const run = holdAfterList(r2, DATE_AGGREGATES);
    folding.release();
    await run.ready;
    // Meanwhile hour 22 is folded (the fold catchUp runs, as another run of the job performs it).
    await buildHour(r2 as unknown as R2Agg, TENANT, { date: DATE, hour: 22 }, LEARN, Date.now(), { shards: 1 }, env);
    // The writer lists hours 12, 22 and 23 and publishes the day from them.
    writerHeld.release(); await newerWriter;
    const newer = await storedDay(env);
    expect(newer.hours?.built, `fixture: the ${writer} published hours 12, 22 and 23`).toEqual([12, 22, 23]);
    expect(newer.counts.decisions, 'fixture: four decisions').toBe(4);
    // The run whose view was hours 12 and 23 finishes last.
    run.release(); await job;
    const after = await storedDay(env);
    expect(after.hours?.built, `O2 — the run that listed hours 12 and 23 must not replace the ${writer}'s newer day (hours 12, 22 and 23)`).toEqual([12, 22, 23]);
    expect(after.counts.decisions, 'O2 — the newer day\'s four decisions stand').toBe(4);
    expect(after.hours?.source, 'O2 — and it is still aggregate-backed').toBe('aggregates');
  };
}

describe('unit:W33.O2.09', () => {
  it('host: a five-minute run that listed fewer hours never replaces the newer day an authenticated POST published meanwhile, though the run started after the POST',
    staleRunAgainstWriter('POST'));
});

describe('unit:W33.O2.10', () => {
  it('host: a five-minute run that listed fewer hours never replaces the newer day the nightly job published meanwhile, though the run started after the nightly job',
    staleRunAgainstWriter('nightly'));
});

// =============================================================================
// src/learn/report.ts:643 — the stored day's frame fails to read
// =============================================================================

describe('unit:W33.O2.11', () => {
  it('host: a stale POST never replaces the run\'s newer day when the newer day\'s leading frame fails to read as the POST comes to write', async () => {
    const { r2, env } = await dayWithNoonFolded();
    deliver(r2, 'eleven-pm', ELEVEN_PM);
    // The POST starts at RUN, lists the date's aggregates (hour 12 alone), and is held.
    vi.setSystemTime(RUN);
    const writerHeld = holdAfterList(r2, DATE_AGGREGATES);
    const stale = settle(operatorPost(env));
    await writerHeld.ready;
    // 1 s later a five-minute run folds hour 23 and publishes the day from hours 12 and 23.
    vi.setSystemTime(RUN + SECOND);
    const run = await fiveMinuteJob(env);
    expect(run.reports.published, 'fixture: the run published the fixture day').toContain(DATE);
    const newer = await storedDay(env);
    expect(newer.hours?.built, 'fixture: the run published hours 12 and 23').toEqual([12, 23]);
    expect(newer.counts.decisions, 'fixture: three decisions').toBe(3);
    // From here, the next ranged read of the stored day's leading frame fails mid-stream (an R2 body can).
    r2.failFrameRead = DAY_KEY;
    writerHeld.release(); await stale;
    r2.failFrameRead = undefined;
    const after = await storedDay(env);
    expect(after.hours?.built, 'O2 — a frame that fails to read must not let the POST that listed hour 12 alone replace the newer day (hours 12 and 23)').toEqual([12, 23]);
    expect(after.counts.decisions, 'O2 — the newer day\'s three decisions stand').toBe(3);
    expect(after.hours?.source, 'O2 — and it is still aggregate-backed').toBe('aggregates');
  });
});
