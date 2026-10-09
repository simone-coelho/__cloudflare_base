// src/units/LANDING/LEDGER.unit.test.ts
//
// THE LANDING TICKET (freeze sheet item 33, docs/parity/authority/BTI-Parity-Freeze-Sheet.md
// section D; owner approval 2026-10-08): the product branch feature/real-time-personalization,
// frozen at 2ffd1a70, is merged into a checkout cut from rem/integration (7264bb71 at this
// specification). Merge base 798f2a72. "Resolved" (the lead's definition, brief
// _evidence/landing/spec/BRIEF.md): the merged tree keeps every behaviour each side's tests pin,
// and where a conflict hunk's two behaviours meet and NEITHER side's tests pin what the merged
// tree must do, a unit here pins it. The conflict map is
// /home/simonecoelho/rem/_evidence/landing/spec/CONFLICT-MAP.md; the hunk numbers below are its
// numbers (`git merge-file` over the three versions, the same 27 hunks git merge-tree reports).
//
// Every unit is RED today on BOTH trees, each for the other side's missing behaviour:
//   · rem/integration lacks the product branch's lane E4 (the serving read validates the head on
//     every operation) and lane E6 (the open hour's working aggregate, `foldOpenHours`, which this
//     file imports by its product-branch name; on rem/integration the import is undefined and the
//     first assertion of each H unit names it);
//   · the product branch lacks W19 LG1 (the serving cache keyed by the backing binding), W33 O2
//     with W33 fix 1 (every canonical day write conditional on the day object the writer noted
//     before it read any source) and W37 T2 (every cron and the hourly fold publish per brand as
//     the tenant's own records define brands).
//
// UNITS AND THE HUNKS THEY COVER
//   unit:LANDING.P1  src/config/publication.ts hunks 1-2 (pinPublication's serving lookup and the
//                    entry it stores): the head is read and validated on every serving operation
//                    (product E4, pinned by the product's src/config/publication.servingCache.test.ts)
//                    AND the set and documents an operation reuses are only those its own backing
//                    binding read (W19 LG1, src/config/publication.ts:334-363 on rem/integration;
//                    docs/kit/02-api-reference.md:784 "Serving snapshots are immutable, keyed by
//                    bucket and tenant"). Neither side's tests pin the second clause.
//   unit:LANDING.H1  src/learn/hourly.ts hunks 11-12 and the product's auto-merged
//                    `foldOpenHours` publication (product src/learn/hourly.ts:2654-2662): the
//                    five-minute job's open-hour publication writes the day of EVERY brand the open
//                    hour's rows carry, each counting only its own brand, the tenant's own day last
//                    (W37 T2; W37 fix 2, src/learn/hourly.ts:2746-2786 on rem/integration).
//   unit:LANDING.H2  src/learn/hourly.ts hunks 10-12 (catchUp's day publication,
//                    `publishAggregateDate` against the product's `publishAggregateDay` with open
//                    views): the catch-up's publication of a date while an open hour stands writes
//                    every brand's day with that open hour named and counted.
//   unit:LANDING.H3  src/learn/hourly.ts hunk 12 and the same auto-merged publication: the open-hour
//                    job's day write is conditional on the day object it noted before it read any
//                    source (W33 O2, W33 fix 1; writeCanonicalDay, src/learn/report.ts:645-664 on
//                    rem/integration), so a job whose ledger view is older never replaces the day a
//                    report build published meanwhile.
//   unit:LANDING.H4  src/learn/hourly.ts hunk 13 (runDayReport): the report build notes the day
//                    before its open-hour refresh reads anything, and its write is conditional on
//                    that note, so a build whose ledger view is older never replaces the day the
//                    five-minute job published meanwhile.
//   unit:LANDING.H5  src/learn/hourly.ts hunks 6-7 (`loadHourRecords` with W30's filed set beside the
//                    product's ledger copy; the fold helper both folds share): the open hour's working
//                    fold refuses an UNFILED row conflict, as the final fold does, and excludes and
//                    counts a FILED one exactly as the final fold of the same hour does (W30 F1.01;
//                    ruling L-R5).
//   unit:LANDING.X1  src/routes/decisions.ts:605 on the product branch, auto-merged (the snapshot route
//                    passes the render offer only for a caller that gives a page instance), against
//                    P02 decision D1 (freeze item 16): a snapshot without a page instance writes its
//                    served-v1 content slot's decision records to the ledger and never a record of a
//                    declared served-v1 layout slot; a snapshot with a page instance writes nothing at
//                    serve time (ruling L-R10). Both shopper hosts.
//
// Fix round L1-fix (rulings L-R5, L-R6 amended, L-R10, L1-C3, L-R4 wording; AMENDMENTS "Landing
// rulings, round 2"): H5 and X1 added; H1 gains its second leg (another brand's day write refused,
// the tenant's own day withheld, W37 fix 2); the H1-H4 and P1 assertions are unchanged.
//
// Hunks judged non-contradicting carry no unit (the conflict map gives the reason for each).
//
// WHAT IS PINNED, AND HOW. Every H unit observes the STORED day (`reports/{tenant}/{brand}/
// {date}.json`, src/learn/report.ts reportKey): its brand, counts and hours. A race is staged the
// way src/units/W33/FIX1.unit.test.ts stages it: the stale writer is held right after a source read
// has answered, the newer writer runs to completion, the stale writer finishes, and the stored day
// is read back. Nothing here asserts when a note is taken or a build time. The stale writer's write
// is refused, and a refused write is never replaced by a retry with older data (L1-C3): a retry that
// republishes the stale writer's view fails H3 and H4 exactly as an unconditional write does.
//
// Names are neutral (`acme`, its second brand `acme-outlet`, the placeholders src/units/W37 uses).
// The codebase's default tenant (src/tenancy/tenant.ts:36) is a customer name, so it is not used.
// No tenant registry is read by these paths. Times are explicit arguments; no wall clock is read.

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Env } from '@/types/env';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { hourPrefix, outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { reportKey, type DayReport } from '@/learn/report';
import { buildHour, catchUp, foldOpenHours, runDayReport } from '@/learn/hourly';
import { initializePublicationSet, invalidatePublicationCache, readPublication, type PublicationBaseline } from '@/config/publication';
import type { DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { ownerEnvironment, runOwnerOperation } from '@/identity/sessionAuthority';
import { captureReadConflict, readConflictFiled } from '@/ledger/quarantine';
import { captureRetention, RETENTION_CATEGORIES, type RetentionCategory, type RetentionPolicy } from '@/retention';
import { Hono } from 'hono';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { consumeLedger } from '@/ledger/consume';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { decisionRoutes } from '@/routes/decisions';
import realtimeRoutes from '@/routes/realtime';
import { tenantMiddleware } from '@/tenancy/middleware';

const MIN = 60_000;
const TENANT = 'acme', OUTLET = 'acme-outlet';
const DATE = '2026-10-02';
const T11 = Date.UTC(2026, 9, 2, 11, 0, 0), T12 = Date.UTC(2026, 9, 2, 12, 0, 0);
const learn = { holdout: { share: 0.1, salt: 'salt', arms: ['default'] }, slots: { hero: { reward: 'click' } } } as LearnConfig;

/** The product-side export every H unit needs; absent on rem/integration. */
const OPEN_HOUR_FOLD = 'the open hour\'s working fold `foldOpenHours` (product branch lane E6, src/learn/hourly.ts:2540 at 2ffd1a70) is exported by src/learn/hourly.ts';

// ── the ledger store ──────────────────────────────────────────────────────────

type After = (op: 'get' | 'list' | 'put', key: string) => Promise<void> | void;
const etagOf = (body: string) => createHash('sha256').update(body).digest('hex');
const bytesOf = (body: string) => new TextEncoder().encode(body).length;

/**
 * An R2 bucket as the ledger, the aggregates and the day reports use it: conditional puts on the
 * object's etag, listings that name each object's etag and size and page by cursor. `after` runs
 * once a call has been answered (its result fixed) and before the caller sees it: that is where a
 * race is staged.
 */
class LedgerR2 {
  objects = new Map<string, string>();
  puts: string[] = [];
  after?: After;
  /** While set, the store refuses every put under this prefix (an outage of those objects, as src/units/W37/FIX2.unit.test.ts stages it) and counts it. */
  refusing?: string;
  refused = 0;
  async put(key: string, body: string, options?: { onlyIf?: unknown }) {
    if (this.refusing !== undefined && key.startsWith(this.refusing)) { this.refused++; throw new Error('fixture: the store refuses this write'); }
    const before = this.objects.get(key), etag = before === undefined ? null : etagOf(before);
    const c = options?.onlyIf;
    if (c instanceof Headers) {
      if (c.get('If-None-Match') === '*' && before !== undefined) return null;
      const match = c.get('If-Match'); if (match !== null && match !== etag) return null;
    } else if (c && typeof c === 'object') {
      const { etagMatches, etagDoesNotMatch } = c as { etagMatches?: string; etagDoesNotMatch?: string };
      if (etagMatches !== undefined && etagMatches !== etag) return null;
      if (etagDoesNotMatch === '*' && before !== undefined) return null;
    }
    this.objects.set(key, body); this.puts.push(key);
    await this.after?.('put', key);
    return { key, etag: etagOf(body), size: bytesOf(body) };
  }
  async get(key: string) {
    const v = this.objects.get(key);
    const out = v === undefined ? null : {
      key, etag: etagOf(v), size: bytesOf(v),
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(v)); c.close(); } }),
      text: async () => v, json: async () => JSON.parse(v) as unknown,
    };
    await this.after?.('get', key);
    return out;
  }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? '', limit = options.limit ?? 1000, start = options.cursor ? Number(options.cursor) : 0;
    const keys = [...this.objects.keys()].filter(k => k.startsWith(prefix)).sort();
    const page = keys.slice(start, start + limit), more = start + page.length < keys.length;
    const out = { objects: page.map(key => ({ key, etag: etagOf(this.objects.get(key)!), size: bytesOf(this.objects.get(key)!) })),
      truncated: more, ...(more ? { cursor: String(start + page.length) } : {}), delimitedPrefixes: [] as string[] };
    await this.after?.('list', prefix);
    return out;
  }
}

const cell = { channel: 'organic', visit_bucket: '1' as const, region: 'US-NC', affinity: null };
/** One served hero decision, under the brand the request named. */
const dec = (brand: string, visitor: string, ts: number, item = 'item-a'): DecisionRecord => ({
  decision_id: `${TENANT}:${ts36(ts)}:${visitor}:pdp:hero:0`, tenant: TENANT, brand, visitor_id: visitor, session_id: `s-${visitor}`,
  identity_anchor: 'session', ts, page: 'pdp', slot: 'hero', position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell,
  arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1',
  explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
} as DecisionRecord);
/** The shopper's click on that decision, a second later, under the same brand. */
const click = (d: DecisionRecord): OutcomeRecord => outcomeFromAction({ type: 'content_click', userId: d.visitor_id, sessionId: d.session_id, timestamp: d.ts + 1_000,
  data: { decisionId: d.decision_id, contentId: d.item_id, slot: d.slot } }, TENANT, d.brand)!;

/** Rows as the queue consumer writes them: one object per stream and batch, named by the batch's time range. */
function write(r2: LedgerR2, rows: Array<DecisionRecord | OutcomeRecord>, batch: string): string[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const stream = 'outcome_id' in row ? 'outcome' : 'decision';
    const key = `${hourPrefix(TENANT, row.ts)}/${stream}/${ts36(rows[0]!.ts)}-${ts36(rows[rows.length - 1]!.ts)}-${batch}.ndjson`;
    groups.set(key, [...(groups.get(key) ?? []), JSON.stringify(row)]);
  }
  for (const [key, lines] of groups) r2.objects.set(key, lines.join('\n') + '\n');
  return [...groups.keys()];
}
const stored = (r2: LedgerR2, brand: string): DayReport | null => {
  const body = r2.objects.get(reportKey(TENANT, brand, DATE));
  return body === undefined ? null : JSON.parse(body) as DayReport;
};
/** The product branch's `hours.open` member (lane E6, src/learn/report.ts OpenHourEntry at 2ffd1a70); rem/integration's DayReport type has none. */
type OpenHours = { open?: Array<{ hour: number; status: string; through: number | null }> };
/** What a stored day says about itself, for one comparison. */
const said = (day: DayReport | null) => day && ({ tenant: day.tenant, brand: day.brand, date: day.date, decisions: day.counts.decisions, outcomes: day.counts.outcomes,
  source: day.hours?.source, built: day.hours?.built, open: (day.hours as OpenHours | undefined)?.open?.map(o => ({ hour: o.hour, status: o.status, through: o.through })) });
/** Stage the stale writer's hold: the first time `prefix` has been listed, run `meanwhile`, then let the listing answer. */
function holdAfterFirstListing(r2: LedgerR2, prefix: string, meanwhile: () => Promise<void>): { fired: () => boolean } {
  let fired = false;
  r2.after = async (op, key) => {
    if (fired || op !== 'list' || key !== prefix) return;
    fired = true;
    await meanwhile();
  };
  return { fired: () => fired };
}
const HOUR12 = `${TENANT}/${DATE}/12/`;

// ── unit:LANDING.P1 ───────────────────────────────────────────────────────────

/** A configuration bucket with per-write etags, conditional writes and a log of every read (the product's E4 fixture, src/config/publication.servingCache.test.ts:18-35). */
class ConfigR2 {
  objects = new Map<string, string>(); versions = new Map<string, number>(); reads: string[] = [];
  async get(key: string) {
    this.reads.push(key);
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: bytesOf(raw), body: new Response(raw).body };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const current = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : false;
    const match = condition instanceof Headers ? null : (condition as { etagMatches?: string } | undefined)?.etagMatches;
    if ((absent && current !== null) || (match != null && match !== current)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return { key, etag: 'v' + this.versions.get(key), size: bytesOf(raw) };
  }
}
const configHead = `config-publication/v2/${TENANT}/head.json`;
const configSet = (n: number) => `config-publication/v2/${TENANT}/set/${n}.json`;
const configDocument = (kind: string, n: number) => `config-publication/v1/${TENANT}/${kind}/rev/${n}.json`;

describe('unit:LANDING.P1 (publication.ts hunks 1-2: the serving cache after the merge)', () => {
  it('logic: a shopper operation reads and validates the publication head every time and reuses only what its own backing binding read; a wrapper the owner fence does not name reads its own set and document', async () => {
    invalidatePublicationCache();
    const storage = new ConfigR2(), env = { STORAGE: storage } as unknown as Env, scope = reflexScopeForTenant(TENANT);
    const row = (kind: DocumentKind<unknown>, value: unknown): PublicationBaseline =>
      ({ kind, scope: kind === REFLEX_KIND ? scope : TENANT, revision: { revision: 1, value, actor: 'fixture', note: '', at: 1 } });
    await initializePublicationSet(env, [row(REFLEX_KIND as DocumentKind<unknown>, DEFAULT_REFLEX_CONFIG), row(CONTENT_KIND as DocumentKind<unknown>, EMPTY_CATALOG),
      row(SLOTS_KIND as DocumentKind<unknown>, DEFAULT_SLOTS), row(LEARN_KIND as DocumentKind<unknown>, DEFAULT_LEARN)], '0:' + crypto.randomUUID());
    invalidatePublicationCache();
    /** One shopper operation, as the shopper's object runs it: behind the owner fence (src/identity/sessionAuthority.ts ownerEnvironment). */
    const asOwner = <T>(work: (fenced: Env) => Promise<T>): Promise<T> => { const owner = {}; return runOwnerOperation(owner, env, () => work(ownerEnvironment(owner, env))); };
    try {
      storage.reads.length = 0;
      const first = await asOwner(fenced => readPublication(fenced, CONTENT_KIND, TENANT, true));
      expect(storage.reads, 'the first serving operation reads the head, the set and the catalogue').toEqual([configHead, configSet(1), configDocument('content', 1)]);
      storage.reads.length = 0;
      const second = await asOwner(fenced => readPublication(fenced, CONTENT_KIND, TENANT, true));
      expect(storage.reads, 'LANDING.P1 (product lane E4, L-R4): a NEW shopper operation over the same backing binding, a fenced handle with no entry of its own,'
        + ' validates the head once and reads nothing else (a read by the same handle again serves its own entry with no storage read, src/config/versionedStore.test.ts:207-208)'
        + ' — a new operation that reads no head keeps serving a publication another isolate replaced, and answers through an authority outage').toEqual([configHead]);
      expect(second, 'and answers exactly the document the full read answered').toEqual(first);

      // A wrapper that is not one of the fence's proxies (W19 LG1's own example: a synthetic monitor's
      // scoped bucket) is its own physical context, over the very same objects.
      const scoped = { get: (key: string) => storage.get(key), put: (key: string, raw: string, options?: R2PutOptions) => storage.put(key, raw, options) };
      storage.reads.length = 0;
      const own = await readPublication({ STORAGE: scoped } as unknown as Env, CONTENT_KIND, TENANT, true);
      expect(storage.reads, 'LANDING.P1 (W19 LG1, kit 02:784 "keyed by bucket and tenant"): a binding the fence does not name is served nothing another binding read'
        + ' — it reads its own head, set and catalogue even where another binding holds the same committed identity').toEqual([configHead, configSet(1), configDocument('content', 1)]);
      expect(own.revision).toBe(1);
    } finally { invalidatePublicationCache(); }
  });
});

// ── unit:LANDING.H1 ───────────────────────────────────────────────────────────

describe('unit:LANDING.H1 (hourly.ts hunks 11-12 with the open-hour publication: per brand, W37 T2)', () => {
  it('logic: the five-minute job\'s open-hour fold publishes the day of every brand its open hour carries, each counting only its own brand and naming the open hour, the tenant\'s own day last', async () => {
    expect(typeof foldOpenHours, OPEN_HOUR_FOLD).toBe('function');
    const r2 = new LedgerR2();
    // 12:00-12:10, the open hour: acme served two hero decisions under its own brand and three under acme-outlet; one click each.
    const own = [dec(TENANT, 'vis-own-1', T12 + 2 * MIN), dec(TENANT, 'vis-own-2', T12 + 3 * MIN)];
    const outlet = [dec(OUTLET, 'vis-outlet-1', T12 + 4 * MIN), dec(OUTLET, 'vis-outlet-2', T12 + 5 * MIN), dec(OUTLET, 'vis-outlet-3', T12 + 6 * MIN)];
    write(r2, [...own, ...outlet], 'a');
    write(r2, [click(own[0]!), click(outlet[0]!)], 'b');
    const now = T12 + 20 * MIN;
    const run = await foldOpenHours(r2 as never, TENANT, learn, now, { start: true, publish: true });
    expect(run.failed, 'the open hour folds').toEqual([]);
    const open = [{ hour: 12, status: 'current', through: now }];
    expect(said(stored(r2, TENANT)), 'the tenant\'s own day, as the job has always published it').toEqual(
      { tenant: TENANT, brand: TENANT, date: DATE, decisions: 2, outcomes: 1, source: 'aggregates', built: [12], open });
    expect(said(stored(r2, OUTLET)), `LANDING.H1 (W37 T2): the open-hour publication must write ${reportKey(TENANT, OUTLET, DATE)} — it publishes { tenant, brand: tenant } alone`).toEqual(
      { tenant: TENANT, brand: OUTLET, date: DATE, decisions: 3, outcomes: 1, source: 'aggregates', built: [12], open });
    expect(r2.puts.indexOf(reportKey(TENANT, OUTLET, DATE)), 'W37 fix 2: the other brand\'s day is written before the tenant\'s own day, the date\'s publication record')
      .toBeLessThan(r2.puts.lastIndexOf(reportKey(TENANT, TENANT, DATE)));
  });

  it('logic: while another brand\'s day write is refused, the open-hour publication withholds the tenant\'s own day, so the own day stored before stands (W37 fix 2, second half)', async () => {
    expect(typeof foldOpenHours, OPEN_HOUR_FOLD).toBe('function');
    const r2 = new LedgerR2();
    // 12:00-12:10: one hero decision under acme and one under acme-outlet; the 12:10 run publishes the date.
    write(r2, [dec(TENANT, 'vis-own-1', T12 + 2 * MIN), dec(OUTLET, 'vis-outlet-1', T12 + 4 * MIN)], 'a');
    expect((await foldOpenHours(r2 as never, TENANT, learn, T12 + 10 * MIN, { start: true, publish: true })).failed, 'the 12:10 run folds the open hour').toEqual([]);
    const before = said(stored(r2, TENANT));
    expect(before, 'the tenant\'s own day the 12:10 run published').toEqual(
      { tenant: TENANT, brand: TENANT, date: DATE, decisions: 1, outcomes: 0, source: 'aggregates', built: [12], open: [{ hour: 12, status: 'current', through: T12 + 10 * MIN }] });
    // 12:15: one more decision under each brand. From here the store refuses every write of acme-outlet's day.
    write(r2, [dec(TENANT, 'vis-own-2', T12 + 15 * MIN), dec(OUTLET, 'vis-outlet-2', T12 + 16 * MIN)], 'b');
    r2.refusing = reportKey(TENANT, OUTLET, DATE);
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 20 * MIN, { start: true, publish: true });
    expect(said(stored(r2, TENANT)), 'LANDING.H1 (W37 fix 2, ruling L-R6 amended): the 12:20 run\'s write of acme-outlet\'s day was refused, so the tenant\'s own day, the date\'s publication record,'
      + ' is withheld and the day the 12:10 run published stands — the open-hour publication writes the tenant\'s own day whatever became of the other brand\'s').toEqual(before);
    expect(r2.refused, 'fixture: the 12:20 run attempted acme-outlet\'s day and the store refused it').toBeGreaterThan(0);
  });
});

// ── unit:LANDING.H2 ───────────────────────────────────────────────────────────

describe('unit:LANDING.H2 (hourly.ts hunks 10-12: the catch-up\'s publication while an open hour stands)', () => {
  it('logic: the catch-up that folds a closed hour while the job\'s open hour stands publishes every brand\'s day with the closed hour and the open hour, named and counted', async () => {
    expect(typeof foldOpenHours, OPEN_HOUR_FOLD).toBe('function');
    const r2 = new LedgerR2();
    // Hour 11 (closed): one decision under acme, two under acme-outlet. Hour 12 (open): two and three.
    write(r2, [dec(TENANT, 'vis-own-11', T11 + 10 * MIN), dec(OUTLET, 'vis-outlet-11a', T11 + 12 * MIN), dec(OUTLET, 'vis-outlet-11b', T11 + 14 * MIN)], 'h11');
    write(r2, [dec(TENANT, 'vis-own-1', T12 + 2 * MIN), dec(TENANT, 'vis-own-2', T12 + 3 * MIN),
      dec(OUTLET, 'vis-outlet-1', T12 + 4 * MIN), dec(OUTLET, 'vis-outlet-2', T12 + 5 * MIN), dec(OUTLET, 'vis-outlet-3', T12 + 6 * MIN)], 'h12');
    // 12:10: the job's run starts the open hour (hour 11's own fold is due at 12:05 and is the catch-up's).
    const job = await foldOpenHours(r2 as never, TENANT, learn, T12 + 10 * MIN, { start: true, publish: true });
    expect(job.failed).toEqual([]);
    // 12:20: the catch-up folds hour 11 and publishes the date.
    const run = await catchUp(r2 as never, TENANT, learn, T12 + 20 * MIN, { lookbackHours: 1 });
    expect(run.built.map(b => b.hour), 'the catch-up folds hour 11').toEqual([11]);
    expect(run.reports.published).toEqual([DATE]);
    const open = [{ hour: 12, status: 'current', through: T12 + 10 * MIN }];
    expect(said(stored(r2, TENANT)), 'the tenant\'s own day: hour 11 folded and hour 12 open').toEqual(
      { tenant: TENANT, brand: TENANT, date: DATE, decisions: 1 + 2, outcomes: 0, source: 'aggregates', built: [11, 12], open });
    expect(said(stored(r2, OUTLET)), `LANDING.H2 (W37 T2 with lane E6): the catch-up must write ${reportKey(TENANT, OUTLET, DATE)} with the open hour named and counted`).toEqual(
      { tenant: TENANT, brand: OUTLET, date: DATE, decisions: 2 + 3, outcomes: 0, source: 'aggregates', built: [11, 12], open });
  });
});

// ── unit:LANDING.H3 ───────────────────────────────────────────────────────────

describe('unit:LANDING.H3 (hourly.ts hunk 12 with the open-hour publication: conditional, W33 O2 and fix 1)', () => {
  it('logic: a five-minute job whose open-hour ledger view is older never replaces the day a report build published meanwhile', async () => {
    expect(typeof foldOpenHours, OPEN_HOUR_FOLD).toBe('function');
    const r2 = new LedgerR2();
    // 12:05 one decision; the job's run at 12:10 starts the open hour.
    write(r2, [dec(TENANT, 'vis-a1', T12 + 5 * MIN)], 'a1');
    expect((await foldOpenHours(r2 as never, TENANT, learn, T12 + 10 * MIN, { start: true, publish: true })).failed).toEqual([]);
    // 12:15 one more, so the 12:20 run has something new to fold and publish.
    write(r2, [dec(TENANT, 'vis-a2', T12 + 15 * MIN)], 'a2');
    // The 12:20 run is held right after its listing of the open hour's ledger has answered: two more rows land,
    // and an operator's day build at 12:21 (POST without policies) reads all four and publishes them.
    let newer: unknown = null;
    const hold = holdAfterFirstListing(r2, HOUR12, async () => {
      write(r2, [dec(TENANT, 'vis-b1', T12 + 20 * MIN + 10_000), dec(TENANT, 'vis-b2', T12 + 20 * MIN + 20_000)], 'b');
      r2.after = undefined;
      await runDayReport(r2 as never, { tenant: TENANT, brand: TENANT, date: DATE }, learn, null, T12 + 21 * MIN);
      newer = said(stored(r2, TENANT));
    });
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 20 * MIN, { start: true, publish: true });
    expect(hold.fired(), 'the job listed the open hour').toBe(true);
    expect(newer, 'the build published the four rows it read').toEqual({ tenant: TENANT, brand: TENANT, date: DATE, decisions: 4, outcomes: 0, source: 'aggregates', built: [12],
      open: [{ hour: 12, status: 'current', through: T12 + 21 * MIN }] });
    expect(said(stored(r2, TENANT)), 'LANDING.H3 (W33 O2, fix 1): the job read the open hour before the build\'s day was stored, so its write never replaces that day'
      + ' — the open-hour publication writes unconditionally').toEqual(newer);
  });
});

// ── unit:LANDING.H4 ───────────────────────────────────────────────────────────

describe('unit:LANDING.H4 (hourly.ts hunk 13, runDayReport: the build\'s open-hour refresh under W33 O2 and fix 1)', () => {
  it('logic: a report build whose open-hour refresh read an older ledger view never replaces the day the five-minute job published meanwhile', async () => {
    expect(typeof foldOpenHours, OPEN_HOUR_FOLD).toBe('function');
    const r2 = new LedgerR2();
    write(r2, [dec(TENANT, 'vis-a1', T12 + 5 * MIN)], 'a1');
    expect((await foldOpenHours(r2 as never, TENANT, learn, T12 + 10 * MIN, { start: true, publish: true })).failed).toEqual([]);
    write(r2, [dec(TENANT, 'vis-a2', T12 + 15 * MIN)], 'a2');
    // The 12:21 build is held right after its refresh's listing of the open hour has answered: two more rows land,
    // and the job's 12:22 run folds all four and publishes them.
    let newer: unknown = null;
    const hold = holdAfterFirstListing(r2, HOUR12, async () => {
      write(r2, [dec(TENANT, 'vis-b1', T12 + 21 * MIN + 10_000), dec(TENANT, 'vis-b2', T12 + 21 * MIN + 20_000)], 'b');
      r2.after = undefined;
      const job = await foldOpenHours(r2 as never, TENANT, learn, T12 + 22 * MIN, { start: true, publish: true });
      expect(job.failed).toEqual([]);
      newer = said(stored(r2, TENANT));
    });
    await runDayReport(r2 as never, { tenant: TENANT, brand: TENANT, date: DATE }, learn, null, T12 + 21 * MIN);
    expect(hold.fired(), 'the build listed the open hour').toBe(true);
    expect(newer, 'the job published the four rows it folded').toEqual({ tenant: TENANT, brand: TENANT, date: DATE, decisions: 4, outcomes: 0, source: 'aggregates', built: [12],
      open: [{ hour: 12, status: 'current', through: T12 + 22 * MIN }] });
    expect(said(stored(r2, TENANT)), 'LANDING.H4 (W33 O2, fix 1): the build read the open hour before the job\'s day was stored, so its write never replaces that day'
      + ' — the build\'s aggregate-backed write is unconditional').toEqual(newer);
  });
});


// ── unit:LANDING.H5 ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const fixturePolicy: RetentionPolicy = { id: 'landing-fixture-policy', revision: 1, durationMs: 3650 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const fixtureRetention = () => JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) as Record<RetentionCategory, RetentionPolicy> } });
/**
 * The bindings the five-minute job hands both folds (`src/index.ts` passes `env`): the store, the tenant
 * registry and its retention policies, and the filing store an operator surface files a read conflict
 * into (`src/ledger/quarantine.ts` captureReadConflict / readConflictFiled: the recovery configuration
 * and the provenance key).
 */
function filingEnv(r2: LedgerR2): Env {
  return { DEPLOYMENT_PROFILE: 'demo', STORAGE: r2, TENANTS: JSON.stringify({ provisioned: [TENANT] }), RETENTION: fixtureRetention(),
    LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'landing-source', deadLetterQueue: 'landing-dead-letter' }),
    IDENTITY_SALT: 'landing-fixture-provenance-material-0001' } as unknown as Env;
}
/** A row as the producer stamps it: its retention births (src/retention.ts captureRetention). */
const stamped = <T extends { ts: number }>(env: Env, row: T): T => ({ ...row, retention: captureRetention(env, TENANT, row.ts, row.ts) });
/** What a day counts that a filed conflict changes. */
const counted = (day: DayReport | null) => day && ({ decisions: day.counts.decisions, outcomes: day.counts.outcomes,
  conflicts: (day.counts as { conflicts?: unknown }).conflicts });

describe('unit:LANDING.H5 (hourly.ts hunks 6-7: the working fold reads the filed conflicts the final fold reads, W30 F1.01, ruling L-R5)', () => {
  it('logic: the open hour\'s working fold refuses an unfiled row conflict as the final fold does, and excludes and counts one an operator surface has filed exactly as the final fold of the same hour does', async () => {
    expect(typeof foldOpenHours, OPEN_HOUR_FOLD).toBe('function');
    /** The open hour as the queue wrote it: 12:05 and 12:06 two hero decisions under acme, a click on the first; then
     *  at-least-once delivery writes a genuinely DIFFERENT row under the first decision's logical id (W22.D1.03, F16 §5(j)). */
    const hour = (r2: LedgerR2, env: Env) => {
      const first = stamped(env, dec(TENANT, 'vis-c1', T12 + 5 * MIN)), second = stamped(env, dec(TENANT, 'vis-c2', T12 + 6 * MIN));
      write(r2, [first, second], 'a');
      write(r2, [stamped(env, click(first))], 'b');
      const intruder = { ...first, item_id: 'item-b', customer_item_id: 'cms-item-b' };
      write(r2, [intruder], 'c');
      return { first, intruder };
    };

    // Unfiled: the working fold refuses the hour, as the final fold refuses it (src/learn/openHour.test.ts:317-334 on the
    // product branch; W30 F1.01: "a conflict that is not filed still refuses the hour").
    const unfiled = new LedgerR2(), unfiledEnv = filingEnv(unfiled);
    hour(unfiled, unfiledEnv);
    const refused = await foldOpenHours(unfiled as never, TENANT, learn, T12 + 20 * MIN, { start: true, publish: true }, unfiledEnv as never);
    expect(refused.failed.filter((f: { hour: number }) => f.hour === 12).map((f: { refusal?: { code?: string } }) => f.refusal?.code),
      'an unfiled conflict refuses the working fold of its hour, named as a row conflict').toEqual(['report_row_conflict']);

    // Filed: the operator's day build met the collision and filed it in the tenant's own scope, as the report
    // route files it (src/routes/decisions.ts:1517-1518), before the five-minute job's run.
    const filed = new LedgerR2(), env = filingEnv(filed);
    const { first, intruder } = hour(filed, env);
    await captureReadConflict(env, 'decision', first.decision_id, intruder as never, T12 + 18 * MIN);
    expect(await readConflictFiled(env, 'decision', first.decision_id), 'fixture: the conflict is filed').toBe(true);
    const run = await foldOpenHours(filed as never, TENANT, learn, T12 + 20 * MIN, { start: true, publish: true }, env as never);
    expect(run.failed, 'LANDING.H5 (W30 F1.01, L-R5): the working fold reads the conflict an operator surface has filed and folds the hour'
      + ' — it refuses a filed conflict the final fold excludes and counts (the working fold reads the hour with no filed set)').toEqual([]);
    const open = stored(filed, TENANT);
    expect({ ...counted(open), source: open?.hours?.source, built: open?.hours?.built,
      open: (open?.hours as OpenHours | undefined)?.open?.map(o => ({ hour: o.hour, status: o.status, through: o.through })) },
      'LANDING.H5 (W30 F1.01): the day the job publishes from the open hour excludes the filed row and counts it in `counts.conflicts`, the member the final fold\'s day uses')
      .toEqual({ decisions: 2, outcomes: 1, conflicts: { decisions: 1, outcomes: 0 }, source: 'aggregates', built: [12], open: [{ hour: 12, status: 'current', through: T12 + 20 * MIN }] });

    // The final fold of the same hour, once it is due, over the same objects and the same filing.
    const final = await buildHour(filed as never, TENANT, { date: DATE, hour: 12 }, learn, T12 + 66 * MIN, {}, env as never);
    expect({ decisions: final.brands[TENANT]?.decisions, outcomes: final.brands[TENANT]?.outcomes, conflicts: (final.brands[TENANT] as { conflicts?: unknown } | undefined)?.conflicts },
      'the final fold excludes the filed row and counts it on the hour (W30 F1.01 `HourBrand.conflicts`)').toEqual({ decisions: 2, outcomes: 1, conflicts: { decisions: 1, outcomes: 0 } });
    const closed = await runDayReport(filed as never, { tenant: TENANT, brand: TENANT, date: DATE }, learn, null, T12 + 67 * MIN, {}, env as never);
    expect(counted(open), 'LANDING.H5: the open hour\'s day counts exactly what the final fold\'s day counts').toEqual(counted(closed));
  });
});

// ── unit:LANDING.X1 ───────────────────────────────────────────────────────────
//
// The mounted application in process, as src/units/_parity.ts and src/routes/realtime.sdkContract.test.ts
// mount it (neither is imported: the parity harness's tenant is a customer name): the real route modules
// behind the tenant middleware, the REAL Durable Object classes over storage stubs, on either shopper host,
// the real ledger producer and consumer. The configuration is the deployed one (LEDGER_RECOVERY_ENABLED
// "false", wrangler.toml:156, :241, :342): served-v1 decisions reach the ledger through the snapshot route's
// own `enqueueDecisions(out.records)` (src/routes/decisions.ts:865 on rem/integration).

class AppKV {
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
class AppR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: bytesOf(raw), customMetadata: this.metadata.get(key),
      body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: bytesOf(raw) };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: bytesOf(this.objects.get(key) ?? ''), uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

type Host = 'session' | 'do';
const STORY_SLOT = 'home-story', MODULE_SLOT = 'home-modules';
const MOD = { grid: 'module.home.grid.1', reco: 'module.home.reco.1', ugc: 'module.home.ugc.1' } as const;
/** The home page's pieces: one story for the content slot, three modules for the layout slot (one spanning two categories, one tagged only on a dimension no registry maps). */
const X1_PIECES = [
  { id: 'story.home.1', customerContentId: 'CMS-STORY-HOME-1', type: 'editorial', title: 'A story for the home page', tags: { line: ['Line-A'] }, slotTypes: [STORY_SLOT], lifecycle: { status: 'live' } },
  { id: MOD.grid, customerContentId: 'CMS-MODULE-GRID-1', type: 'category-grid', title: 'A grid of categories', tags: { category: ['Bags', 'Wallets'] }, slotTypes: [MODULE_SLOT], journeyStageFit: ['exploring'], lifecycle: { status: 'live' } },
  { id: MOD.reco, customerContentId: 'CMS-MODULE-RECO-1', type: 'recommendations', title: 'Picked for this visit', tags: { line: ['Line-A'] }, slotTypes: [MODULE_SLOT], journeyStageFit: ['considering'], lifecycle: { status: 'live' } },
  { id: MOD.ugc, customerContentId: 'CMS-MODULE-UGC-1', type: 'user-generated', title: 'Seen on shoppers', tags: { styleWorld: ['downtown'] }, slotTypes: [MODULE_SLOT], journeyStageFit: ['considering'], lifecycle: { status: 'live' } },
];
/** The page: the served-v1 content slot first, the declared layout slot below it (P02: `layout: true` in a document marked governanceVersion 4). */
const X1_SLOTS = { version: 'landing-x1-slots', governanceVersion: 4, pages: { home: [
  { slot: STORY_SLOT, take: 1, weights: { line: 1 } },
  { slot: MODULE_SLOT, take: 2, layout: true, weights: { line: 1, category: 0.5 } },
] } };
/** Both slots measured on served-v1: the learn document names no basis for either (the documented default). */
const X1_LEARN = { version: 'landing-x1-learn', holdout: { share: 0, salt: 'landing-x1', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { [STORY_SLOT]: { reward: 'click' }, [MODULE_SLOT]: { reward: 'click' } } };

async function mountApp(host: Host) {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const pending: Promise<unknown>[] = [], queued: unknown[] = [];
  const storage = new AppR2(), shoppers = new Map<string, Map<string, unknown>>();
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: new AppKV(), SESSIONS: new AppKV(), STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    JWT_SECRET: 'landing-synthetic-operator-signing-material', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: `${TENANT}:landing-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }), RETENTION: fixtureRetention(),
    LEDGER_RECOVERY_ENABLED: 'false',
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async (body: unknown) => { queued.push(body); }, sendBatch: async (messages: Array<{ body: unknown }>) => { for (const m of messages) queued.push(m.body); } },
  } as unknown as Env;
  const namespaceFor = (make: (state: DurableObjectState, env: Env) => { fetch: (request: Request) => Promise<Response> }, registry: Map<string, Map<string, unknown>>) => {
    const objects = new Map<string, { fetch: (request: Request) => Promise<Response> }>();
    return { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let object = objects.get(name);
      if (!object) {
        const data = new Map<string, unknown>(), alarms: number[] = [];
        registry.set(name, data);
        const storageStub = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => { if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value)); },
          list: async (o?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(o?.prefix ?? '') && (!o?.startAfter || key > o.startAfter))
              .sort(([a], [b]) => (o?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, o?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => { if (typeof values === 'string') candidate.set(values, structuredClone(value)); else for (const [key, entry] of Object.entries(values)) candidate.set(key, structuredClone(entry)); },
              deleteAlarm: async () => { alarms.length = 0; }, setAlarm: async (at: number) => { alarms.push(at); },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage: storageStub, getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        object = make(state, env); objects.set(name, object);
      }
      return object.fetch(new Request(input, init));
    } }) };
  };
  env.SHOPPER_REFLEX = namespaceFor((state, e) => new ShopperReflex(state, e), shoppers) as unknown as DurableObjectNamespace;
  env.LEARN_STATS = namespaceFor((state, e) => new LearnStats(state, e), new Map()) as unknown as DurableObjectNamespace;
  env.DECISION_RING = namespaceFor((state, e) => new DecisionRing(state, e), new Map()) as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/realtime', realtimeRoutes);
  app.route('/v1', decisionRoutes);
  const fetchOne = (request: Request) => app.fetch(request, env,
    { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 5)); };
  /** The real consumer writes what the real producer queued. */
  const drainLedger = async () => {
    await drain();
    if (!queued.length) return;
    const result = await consumeLedger(env, queued.splice(0), Date.now()) as { error?: unknown };
    expect(result.error, 'the fixture ledger batch is written by the real consumer').toBeUndefined();
  };
  const revision = (value: unknown) => ({ revision: 1, at: 1, actor: 'landing-x1-fixture', note: 'fixture', value });
  let refused: string | null = null;
  try {
    await initializePublicationSet(env, [
      { kind: CONTENT_KIND, scope: TENANT, revision: revision({ version: 'landing-x1-catalogue', pieces: X1_PIECES }) },
      { kind: SLOTS_KIND, scope: TENANT, revision: revision(X1_SLOTS) },
      { kind: LEARN_KIND, scope: TENANT, revision: revision(X1_LEARN) },
      { kind: PRIORS_KIND, scope: TENANT, revision: revision(EMPTY_PRIORS) },
      { kind: REFLEX_KIND, scope: reflexScopeForTenant(TENANT), revision: revision({ ...DEFAULT_REFLEX_CONFIG, version: 'landing-x1-registry' }) },
    ] as PublicationBaseline[], '0:' + crypto.randomUUID());
  } catch (error) { refused = `${(error as Error).message}${(error as { code?: string }).code ? ` (${(error as { code?: string }).code})` : ''}`; }
  invalidatePublicationCache();

  /** A shopper with a session grant and her own explicit choice (tracking and personalization on) through the real route. */
  const shopper = async () => {
    const grant = await newAnonymousSession(env, TENANT);
    const call = async (path: string, body: unknown) => {
      const response = await fetchOne(new Request(`https://shop.invalid${path}`, { method: 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
      await drain();
      return answer;
    };
    const chosen = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
      choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
    expect(chosen.status, `PRECONDITION (${host}): her explicit choice is accepted (${JSON.stringify(chosen.body).slice(0, 200)})`).toBe(200);
    /** `POST /v1/:tenant/decisions/snapshot`, the route production serves. */
    const snapshot = async (pageInstance?: string) => {
      const answer = await call(`/v1/${TENANT}/decisions/snapshot`, { page: 'home', brand: TENANT, ...(pageInstance ? { pageInstance } : {}) });
      expect(answer.status, `PRECONDITION (${host}): the snapshot answers (${JSON.stringify(answer.body).slice(0, 200)})`).toBe(200);
      await drainLedger();
      return ((answer.body.decisions ?? []) as Array<{ slot: string; contentId: string; order: number }>).sort((a, b) => a.order - b.order);
    };
    return { subject: grant.subject, snapshot };
  };
  /** The decision records the real consumer stored for a visitor, as (slot, piece) pairs in decision order. */
  const ledgerOf = (visitor: string) => [...storage.objects.entries()].filter(([key]) => key.includes('/decision/') && key.endsWith('.ndjson'))
    .flatMap(([, raw]) => raw.split('\n').filter(Boolean).map(line => JSON.parse(line) as DecisionRecord))
    .filter(record => record.visitor_id === visitor).sort((a, b) => a.ts - b.ts || a.decision_id.localeCompare(b.decision_id)).map(record => ({ slot: record.slot, item: record.item_id }));
  return { refused, shopper, ledgerOf };
}

describe('unit:LANDING.X1 (src/routes/decisions.ts:605 auto-merged, the snapshot route\'s render offer: served-v1 capture without a page instance, never of a declared layout slot, ruling L-R10)', () => {
  for (const host of ['session', 'do'] as const) {
    it(`host (${host}): a snapshot without a page instance writes its served-v1 content slot's decision records to the ledger and never a record of the declared served-v1 layout slot; a snapshot with a page instance writes nothing at serve time`, async () => {
      const m = await mountApp(host);
      expect(m.refused ?? 'published', `PRECONDITION (${host}): the home page with its declared layout slot (\`layout: true\`, governanceVersion 4, P02) on served-v1 publishes — the platform refused it: ${m.refused}`).toBe('published');

      const plain = await m.shopper();
      const served = await plain.snapshot();
      const story = served.filter(d => d.slot === STORY_SLOT).map(d => ({ slot: d.slot, item: d.contentId }));
      expect(story, `PRECONDITION (${host}): the content slot served its one story`).toEqual([{ slot: STORY_SLOT, item: 'story.home.1' }]);
      expect(served.filter(d => d.slot === MODULE_SLOT).map(d => d.contentId), `PRECONDITION (${host}): the layout slot served K = 2 modules, the first eligible in catalogue order with no signal (P02 A2)`)
        .toEqual([MOD.grid, MOD.reco]);
      expect(m.ledgerOf(plain.subject), `LANDING.X1 (${host}; L-R10, P02 decision D1): a snapshot without a page instance writes exactly its served-v1 content slot's decision records to the ledger`
        + ` — never a record of the declared served-v1 layout slot (the hourly fold would count it as an exposure, P02 residual 7.2), and not nothing (src/routes/decisions.ts:858 passes the render offer to every caller, so no served-v1 decision is captured)`)
        .toEqual(story);

      // A caller that gives a page instance asks for rendered measurement: nothing is captured at serve time, as today.
      const rendered = await m.shopper();
      const page = await rendered.snapshot('landing-x1-page-1');
      expect(page.map(d => d.slot), `PRECONDITION (${host}): the page with an instance is served the same slots`).toEqual([STORY_SLOT, MODULE_SLOT, MODULE_SLOT]);
      expect(m.ledgerOf(rendered.subject), `LANDING.X1 (${host}): a snapshot with a page instance writes no decision record at serve time (LOCKED, as today)`).toEqual([]);
    });
  }
});
