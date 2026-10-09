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
//
// Hunks judged non-contradicting carry no unit (the conflict map gives the reason for each).
//
// WHAT IS PINNED, AND HOW. Every H unit observes the STORED day (`reports/{tenant}/{brand}/
// {date}.json`, src/learn/report.ts reportKey): its brand, counts and hours. A race is staged the
// way src/units/W33/FIX1.unit.test.ts stages it: the stale writer is held right after a source read
// has answered, the newer writer runs to completion, the stale writer finishes, and the stored day
// is read back. Nothing here asserts when a note is taken, a build time, or whether the stale write
// was refused or retried: that is the build's choice.
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
import { catchUp, foldOpenHours, runDayReport } from '@/learn/hourly';
import { initializePublicationSet, invalidatePublicationCache, readPublication, type PublicationBaseline } from '@/config/publication';
import type { DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { ownerEnvironment, runOwnerOperation } from '@/identity/sessionAuthority';

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
  async put(key: string, body: string, options?: { onlyIf?: unknown }) {
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
      expect(storage.reads, 'LANDING.P1 (product lane E4): the next operation over the same backing binding validates the head and reads nothing else'
        + ' — a cache hit that reads no head keeps serving a publication another isolate replaced, and answers through an authority outage').toEqual([configHead]);
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

