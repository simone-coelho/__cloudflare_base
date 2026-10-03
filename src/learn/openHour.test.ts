// src/learn/openHour.test.ts
// Lane E6: the day report answers on a busy day. Two things made a busy day's
// report refuse, and both are fixed here without moving a budget:
//
//  · the day summed from its hours charged admission for a merge that rebuilt
//    the whole day for every hour summed, so the same traffic was refused later
//    in the day than it was admitted earlier. The day is now merged in place,
//    each hour's members once, and charged for that.
//  · the hour that is still open was either left out or — on a day with no
//    folded hour — read as raw with the rest of the day. The five-minute job now
//    folds it into a WORKING aggregate beside the final ones, so the day report
//    reads one aggregate per hour plus the few minutes of raw the queue has
//    written since.
//
// The hour's FINAL fold is the one it has always been: these tests pin its
// bytes to what it wrote before this lane.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { hourPrefix, outcomeFromAction, ts36, type OutcomeRecord } from '@/ledger/records';
import { writeTombstone } from '@/ledger/erasure';
import { canonicalReportJson, ReportTooLarge, type DayReport } from './report';
import {
  buildHour, catchUp, emptyBrand, foldOpenHours, hourKey, mergeBrand, mergeBrandInto, openHours, openKey, openLedgerKey, reportFromHours,
  runDayReport, shardKey, SHARDS, type HourAggregate,
} from './hourly';
import { DEFAULT_STATS } from './stats';

const MIN = 60_000, H = 3_600_000;
const TENANT = 'acme';
const DATE = '2026-10-02';
const T12 = Date.UTC(2026, 9, 2, 12, 0, 0);
const ids = { tenant: TENANT, brand: TENANT, date: DATE };
const cell = { channel: 'organic', visit_bucket: '1' as const, region: 'US-NC', affinity: null };

class FakeR2 {
  objects = new Map<string, string>();
  gets: string[] = [];
  puts: string[] = [];
  /** When set, the listing says what storage would: each object's etag and size. */
  listsIdentity = false;
  async put(key: string, body: string, options?: R2PutOptions): Promise<{ etag: string } | null> {
    const before = this.objects.get(key), onlyIf = options?.onlyIf as R2Conditional | undefined;
    const etag = before === undefined ? null : createHash('sha256').update(before).digest('hex');
    if ((onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== etag) || (onlyIf?.etagDoesNotMatch === '*' && before !== undefined)) return null;
    this.objects.set(key, body); this.puts.push(key);
    return { etag: createHash('sha256').update(body).digest('hex') };
  }
  async get(key: string) {
    this.gets.push(key);
    const v = this.objects.get(key); if (v === undefined) return null;
    const bytes = new TextEncoder().encode(v);
    return { etag: createHash('sha256').update(v).digest('hex'), size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }), text: async () => v, json: async () => JSON.parse(v) as unknown };
  }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
  async list({ prefix, limit }: { prefix: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit ?? 1000);
    return { objects: keys.map((key) => this.listsIdentity
      ? { key, etag: createHash('sha256').update(this.objects.get(key)!).digest('hex'), size: new TextEncoder().encode(this.objects.get(key)!).length }
      : { key }), truncated: false };
  }
}

const dec = (visitor: string, ts: number, slot: string, item: string, o: { arm?: DecisionRecord['arm']; explored?: boolean; products?: string[]; assignment?: string } = {}): DecisionRecord => ({
  decision_id: `${TENANT}:${ts36(ts)}:${visitor}:pdp:${slot}:0`, tenant: TENANT, brand: TENANT, visitor_id: visitor, session_id: `s-${visitor}`,
  identity_anchor: 'session', ts, page: 'pdp', slot, position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell,
  arm: o.arm ?? 'personalized', explored: o.explored ?? false, authority: 'engine', versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1',
  explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
  ...(o.products ? { featured_product_ids: o.products } : {}),
  ...(o.assignment ? { experiment: { id: `${TENANT}:${TENANT}:salt`, saltVersion: 1, arm: o.assignment, anchorGeneration: 1 } } : {}),
} as DecisionRecord);
const wire = (visitor: string, ts: number, type: string, data: Record<string, unknown>): OutcomeRecord =>
  outcomeFromAction({ type, userId: visitor, sessionId: `s-${visitor}`, timestamp: ts, data }, TENANT)!;

/**
 * The ledger as the consumer writes it: one object per batch, named by the
 * batch's range. `batch` names the object, so one hour can hold several, and a
 * redelivered row can land in a second object of its own.
 */
function write(r2: FakeR2, rows: Array<DecisionRecord | OutcomeRecord>, batch: string): string[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const stream = 'decision_id' in row && !('outcome_id' in row) ? 'decision' : 'outcome';
    const k = `${hourPrefix(TENANT, row.ts)}/${stream}/${ts36(rows[0]!.ts)}-${ts36(rows[rows.length - 1]!.ts)}-${batch}.ndjson`;
    groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(row)]);
  }
  for (const [k, lines] of groups) r2.objects.set(k, lines.join('\n') + '\n');
  return [...groups.keys()];
}

// One day's two hours: provenance-less rows beside rows that carry their
// assignment, the holdout, an explored first slot, a story that features a
// product, two named outcomes, a redelivered decision, a credit across the hour
// boundary, and a shopper erased half way through the first hour.
const pickup = dec('v1', T12, 'pdp-modules', 'where-to-buy', { assignment: 'personalized' });
const deal = dec('v1', T12 + 1 * MIN, 'deals', 'gift-card', { explored: true, assignment: 'personalized' });
const holdout = dec('v2', T12 + 5 * MIN, 'hero', 'item-a', { arm: 'default', assignment: 'default' });
const story = dec('v4', T12 + 10 * MIN, 'story', 'st-1', { products: ['bag-1'] });
const erased = dec('v5', T12 + 20 * MIN, 'hero', 'item-a');
const late = dec('v3', T12 + 59 * MIN, 'hero', 'item-a');
const next = dec('v6', T12 + 65 * MIN, 'hero', 'item-b', { assignment: 'personalized' });
const hour12 = {
  decisions: [pickup, deal, holdout, story, erased, late],
  outcomes: [
    wire('v1', T12 + 2 * MIN, 'custom', { event: 'partner_pickup', decisionId: pickup.decision_id, contentId: 'where-to-buy', slot: 'pdp-modules' }),
    wire('v1', T12 + 3 * MIN, 'content_click', { decisionId: deal.decision_id, contentId: 'gift-card', slot: 'deals' }),
    wire('v1', T12 + 10 * MIN, 'purchase', { orderId: 'o-1', value: 899, currency: 'USD' }),
    wire('v5', T12 + 21 * MIN, 'content_click', { decisionId: erased.decision_id, contentId: 'item-a', slot: 'hero' }),
  ],
};
const hour13 = {
  decisions: [next],
  outcomes: [
    wire('v3', T12 + 61 * MIN, 'content_click', { decisionId: late.decision_id, contentId: 'item-a', slot: 'hero' }),
    wire('v4', T12 + 90 * MIN, 'purchase', { orderId: 'o-2', value: 375, currency: 'USD', products: ['bag-1'] }),
    wire('v6', T12 + 66 * MIN, 'custom', { event: 'retailer_referral', decisionId: next.decision_id, contentId: 'item-b', slot: 'hero', retailer: 'costco' }),
  ],
};
const learn: LearnConfig = { holdout: { share: 0.1, salt: 'salt', arms: ['default'] },
  slots: { hero: { reward: 'click' }, deals: { reward: 'click', exploration: { mode: 'rotation', share: 0.5, floor: 50 } }, story: { reward: 'purchase' } } } as LearnConfig;

/** Hour 12 as the consumer wrote it, batch by batch, in the order the batches closed. */
const BATCHES: Array<[Array<DecisionRecord | OutcomeRecord>, string]> = [
  [hour12.decisions.slice(0, 3), 'a'],
  [hour12.outcomes.slice(0, 2), 'c'],
  [hour12.decisions.slice(3), 'b'],
  [[pickup], 'redelivered'],                                  // the same decision again, in an object of its own
  [hour12.outcomes.slice(2), 'd'],
];

/** The whole day on the ledger, in the batches the consumer would have written. */
async function day(r2: FakeR2): Promise<void> {
  for (const [rows, batch] of BATCHES) write(r2, rows, batch);
  write(r2, hour13.decisions, 'e');
  write(r2, hour13.outcomes, 'f');
  await writeTombstone(r2 as never, TENANT, 'v5', 'test', T12 + 30 * MIN);
}

/** Write identities are random; a fixed sequence makes the bytes comparable across builds. */
function fixedGenerations(): void {
  vi.restoreAllMocks();
  let n = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`);
}
afterEach(() => { vi.restoreAllMocks(); });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
/** What an aggregate says, without its write identity and the time it was built. */
const content = (agg: unknown): unknown => { const { generation: _g, builtAt: _b, ...rest } = agg as Record<string, unknown>; void _g; void _b; return rest; };
const shardBodies = (r2: FakeR2) => Array.from({ length: SHARDS }, (_, s) => r2.objects.get(shardKey(TENANT, s)) ?? null);
const ledgerKeys = (keys: string[], hour: number) => keys.filter((k) => k.startsWith(`${TENANT}/${DATE}/${String(hour).padStart(2, '0')}/`));
const stored = (r2: FakeR2, key: string) => JSON.parse(r2.objects.get(key)!) as HourAggregate;
/** The open hour's ledger segments, oldest first. */
const segments = (r2: FakeR2, hour = 12) => [...r2.objects.keys()].filter((k) => k.startsWith(openLedgerKey(TENANT, DATE, hour) + '.')).sort();
/** Every row the hour's ledger segments hold. */
const segmentRows = (r2: FakeR2, hour = 12) => segments(r2, hour).flatMap((k) => { const body = r2.objects.get(k)!;
  return body.slice(body.indexOf('\n') + 1).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { visitor_id: string }); });

describe('the final fold of a closed hour', () => {
  /**
   * Captured from the fold at 272ede8, before this lane touched hourly.ts: the
   * two hour aggregates, every ring shard after them, and the canonical day
   * report summed from them. Any change to what a closed hour's fold writes,
   * or to a day report with no open hour, changes one of these.
   */
  const GOLDEN = {
    hour12: '2bcf1f0fcbf3eed65e04112ea637ba1247f66c1c38c1383214df3c559d96ec2d',
    hour13: '9ec75462bd2d7395825cf0b753d75a2c99cdcd1685d9a860a82ae110d62aa11a',
    shards: '10b0906b492ec9860af5f59dfa2aa645be0f5cfcf48f56d9e828d84cf0a46a93',
    day: '8319005dd2428a4a2ba6ee93ba6beb30ea78b0d406aa669bd9f2b05d262be041',
  };

  it('writes the bytes it wrote before the open hour existed: both aggregates, every shard and the day summed from them', async () => {
    fixedGenerations();
    const r2 = new FakeR2();
    await day(r2);
    const now = T12 + 2 * H + 6 * MIN;
    const a12 = await buildHour(r2 as never, TENANT, { date: DATE, hour: 12 }, learn, now);
    const a13 = await buildHour(r2 as never, TENANT, { date: DATE, hour: 13 }, learn, now + MIN);
    const report = reportFromHours([a12, a13], ids, learn, now + 2 * MIN, { pending: 1, missing: [] });
    const observed = {
      hour12: sha(r2.objects.get(hourKey(TENANT, DATE, 12))!),
      hour13: sha(r2.objects.get(hourKey(TENANT, DATE, 13))!),
      shards: sha(shardBodies(r2).map((b) => b ?? '').join('\n')),
      day: sha(canonicalReportJson(report)),
    };
    // The fixture really exercises what the hashes are meant to pin.
    expect(a12.brands[TENANT]!.duplicates).toEqual({ decisions: 1, outcomes: 0 });
    expect(a12.brands[TENANT]!.rows_hidden).toBe(2);
    expect(report.namedOutcomes?.events.partner_pickup?.credited).toBe(1);
    expect(report.namedOutcomes?.events.retailer_referral?.credited).toBe(1);
    expect(report.policies.find((p) => p.role === 'learning')!.credits).toBeGreaterThan(0);
    expect(observed).toEqual(GOLDEN);
  });

  it('is the same fold whether or not the open hour was worked on all through it', async () => {
    const quiet = new FakeR2(), worked = new FakeR2();
    // The quiet store sees the hour only when it closes; the worked one is folded open every five minutes as the queue writes it.
    for (const [rows, batch] of BATCHES) write(quiet, rows, batch);
    for (const [index, [rows, batch]] of BATCHES.entries()) {
      write(worked, rows, batch);
      const result = await foldOpenHours(worked as never, TENANT, learn, T12 + (index + 1) * 10 * MIN, { start: true, publish: true });
      expect(result.failed).toEqual([]);
    }
    expect(worked.puts.filter((k) => k.startsWith(`aggregates/${TENANT}/rings/`) || k === hourKey(TENANT, DATE, 12)),
      'the working fold never writes a shard or the hour\'s aggregate').toEqual([]);
    fixedGenerations();
    const final = await buildHour(quiet as never, TENANT, { date: DATE, hour: 12 }, learn, T12 + H + 6 * MIN);
    fixedGenerations();
    const after = await buildHour(worked as never, TENANT, { date: DATE, hour: 12 }, learn, T12 + H + 6 * MIN);
    expect(worked.objects.get(hourKey(TENANT, DATE, 12)), 'the hour\'s final aggregate is byte for byte the one a quiet hour gets').toBe(quiet.objects.get(hourKey(TENANT, DATE, 12)));
    expect(shardBodies(worked), 'and so is every shard: `foldedHours` names the hour once, as it always did').toEqual(shardBodies(quiet));
    const holding = shardBodies(worked).filter((b): b is string => b !== null).map((b) => JSON.parse(b) as { rings: Record<string, unknown>; foldedHours?: number[] })
      .filter((state) => Object.keys(state.rings).length);
    expect(holding.length).toBeGreaterThan(0);
    for (const state of holding) expect(state.foldedHours, '`foldedHours` names the hour, once').toEqual([T12]);
    expect(after).toEqual(final);
  });
});

describe('the open hour\'s working aggregate', () => {
  it('names the hour that is open, and the hour before it until that hour\'s own fold is due', () => {
    expect(openHours(T12 + 30 * MIN)).toEqual([{ date: DATE, hour: 12, from: T12 }]);
    expect(openHours(T12 + 4 * MIN)).toEqual([{ date: DATE, hour: 11, from: T12 - H }, { date: DATE, hour: 12, from: T12 }]);
    expect(openHours(T12 + 5 * MIN)).toEqual([{ date: DATE, hour: 12, from: T12 }]);
    expect(openHours(Date.UTC(2026, 9, 3, 0, 1)).map((h) => [h.date, h.hour])).toEqual([[DATE, 23], ['2026-10-03', 0]]);
  });

  it('folds a segment: each run reads from the ledger only what the queue wrote since the last, and counts the hour so far', async () => {
    const r2 = new FakeR2();
    const first = write(r2, hour12.decisions.slice(0, 3), 'a');
    const one = await foldOpenHours(r2 as never, TENANT, learn, T12 + 6 * MIN, { start: true, publish: true });
    expect(one.folded).toEqual([{ date: DATE, hour: 12, objects: 1, read: 1, copied: 0, truncated: false, decisions: 3, outcomes: 0, changed: true }]);
    expect(one.published, 'the day is published again with the hour in it').toEqual([DATE]);
    const saved = JSON.parse(r2.objects.get(`reports/${TENANT}/${TENANT}/${DATE}.json`)!) as DayReport;
    expect(saved.hours).toMatchObject({ source: 'aggregates', built: [12], open: [12] });
    expect(saved.counts.decisions).toBe(3);

    const second = [...write(r2, hour12.outcomes.slice(0, 2), 'c'), ...write(r2, hour12.decisions.slice(3), 'b')];
    r2.gets = [];
    const two = await foldOpenHours(r2 as never, TENANT, learn, T12 + 11 * MIN, { start: true, publish: true });
    expect(ledgerKeys(r2.gets, 12).sort(), 'the next run reads the two new objects from the ledger, and the first from its copy').toEqual(second.sort());
    expect(r2.gets.filter((k) => k.startsWith(openLedgerKey(TENANT, DATE, 12))), 'the copy is the first run\'s segment').toEqual(segments(r2).slice(0, 1));
    expect(segments(r2), 'and each run that read something from the ledger writes one segment of it').toHaveLength(2);
    expect(two.folded).toEqual([{ date: DATE, hour: 12, objects: 3, read: 3, copied: 1, truncated: false, decisions: 6, outcomes: 2, changed: true }]);
    expect(stored(r2, openKey(TENANT, DATE, 12)).brands[TENANT]!.named?.events.partner_pickup?.outcomes).toBe(1);

    r2.gets = [];
    const quiet = await foldOpenHours(r2 as never, TENANT, learn, T12 + 16 * MIN, { start: true, publish: true });
    expect(ledgerKeys(r2.gets, 12), 'a run with nothing new reads nothing from the ledger').toEqual([]);
    expect(quiet.folded[0]).toMatchObject({ copied: 3, changed: false });
    expect(quiet.published, 'and publishes nothing again').toEqual([]);
    expect(segments(r2), 'nor writes a segment').toHaveLength(2);
    void first;
  });

  it('is the final fold over the same objects: the working aggregate and the closed hour\'s aggregate say the same thing', async () => {
    const r2 = new FakeR2();
    for (const [rows, batch] of BATCHES) write(r2, rows, batch);
    await writeTombstone(r2 as never, TENANT, 'v5', 'test', T12 + 30 * MIN);
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 59 * MIN, { start: true, publish: true });
    const working = stored(r2, openKey(TENANT, DATE, 12));
    const before = shardBodies(r2);
    const final = await buildHour(r2 as never, TENANT, { date: DATE, hour: 12 }, learn, T12 + H + 6 * MIN);
    expect(content(working)).toEqual(content(final));
    expect(before.every((b) => b === null), 'and the working fold wrote no shard').toBe(true);
  });

  it('folds the hour still in its grace before the open one, so a credit across the boundary is the one the final folds give', async () => {
    const r2 = new FakeR2();
    for (const [rows, batch] of BATCHES) write(r2, rows, batch);
    write(r2, [hour13.outcomes[0]!], 'f');                                     // 13:01: v3's click on the hero served at 12:59
    // 13:04: hour 12 is closed but its fold is not due; both hours are worked on, 12 first.
    const both = await foldOpenHours(r2 as never, TENANT, learn, T12 + 64 * MIN, { start: true, publish: true });
    expect(both.folded.map((h) => h.hour)).toEqual([12, 13]);
    const working13 = stored(r2, openKey(TENANT, DATE, 13));
    expect(working13.brands[TENANT]!.policies.learning!.armCredits['hero|personalized'], 'the 13:01 click credits the 12:59 hero').toBe(1);
    const day = await runDayReport(r2 as never, ids, learn, null, T12 + 64 * MIN);
    expect(day.hours).toMatchObject({ built: [12, 13], open: [12, 13] });
    // The finals, when they come, say the same.
    await buildHour(r2 as never, TENANT, { date: DATE, hour: 12 }, learn, T12 + 2 * H + 6 * MIN);
    const final13 = await buildHour(r2 as never, TENANT, { date: DATE, hour: 13 }, learn, T12 + 2 * H + 6 * MIN);
    expect(content(working13)).toEqual(content(final13));
  });

  it('drops an erased visitor at the next segment fold', async () => {
    const r2 = new FakeR2();
    for (const [rows, batch] of BATCHES) write(r2, rows, batch);
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 25 * MIN, { start: true, publish: true });
    const before = stored(r2, openKey(TENANT, DATE, 12)).brands[TENANT]!;
    await writeTombstone(r2 as never, TENANT, 'v5', 'test', T12 + 30 * MIN);
    const next = await foldOpenHours(r2 as never, TENANT, learn, T12 + 31 * MIN, { start: true, publish: true });
    const after = stored(r2, openKey(TENANT, DATE, 12)).brands[TENANT]!;
    expect(next.folded[0]).toMatchObject({ copied: 5, changed: true });
    expect([before.decisions, before.outcomes, before.rows_hidden]).toEqual([6, 4, 0]);
    expect([after.decisions, after.outcomes, after.rows_hidden], 'her decision and her click are gone from the counts, and named as hidden').toEqual([5, 3, 2]);
    expect(after.visitorsDay, 'and from the day\'s visitors').toBe(before.visitorsDay - 1);
    const rows = segmentRows(r2);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.visitor_id === 'v5'), 'and the hour\'s ledger copy keeps none of her rows').toEqual([]);
    r2.gets = [];
    const again = await foldOpenHours(r2 as never, TENANT, learn, T12 + 36 * MIN, { start: true, publish: true });
    expect(again.folded[0], 'the objects that name her are read from the ledger, as the final fold reads them').toMatchObject({ copied: 3, changed: false });
    expect(ledgerKeys(r2.gets, 12)).toHaveLength(2);
  });

  it('refuses an hour that holds a row conflict, as the final fold does, and leaves the last working aggregate standing', async () => {
    const r2 = new FakeR2();
    write(r2, hour12.decisions.slice(0, 3), 'a');
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 6 * MIN, { start: true, publish: true });
    const standing = r2.objects.get(openKey(TENANT, DATE, 12));
    write(r2, [{ ...pickup, item_id: 'another' }], 'conflict');
    const refused = await foldOpenHours(r2 as never, TENANT, learn, T12 + 11 * MIN, { start: true, publish: true });
    expect(refused.failed).toEqual([{ date: DATE, hour: 12, error: 'conflicting rows under one logical id' }]);
    expect(r2.objects.get(openKey(TENANT, DATE, 12))).toBe(standing);
    await expect(buildHour(r2 as never, TENANT, { date: DATE, hour: 12 }, learn, T12 + H + 6 * MIN)).rejects.toThrow('conflicting rows under one logical id');
    // 13:02: the refused hour is in its grace and the next hour is open. The refusal does not hold the next hour
    // back: it is folded on the shards as they stood, which is how its final fold will find them while hour 12 stays unfolded.
    write(r2, [next], 'e');
    const grace = await foldOpenHours(r2 as never, TENANT, learn, T12 + H + 6 * MIN - 4 * MIN, { start: true, publish: true });
    expect(grace.failed.map((f) => f.hour)).toEqual([12]);
    expect(grace.folded.map((h) => [h.hour, h.decisions])).toEqual([[13, 1]]);
  });

  it('reads a ledger object again when storage says it changed', async () => {
    const r2 = new FakeR2();
    r2.listsIdentity = true;
    const [key] = write(r2, hour12.decisions.slice(0, 3), 'a');
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 6 * MIN, { start: true, publish: true });
    r2.objects.set(key!, r2.objects.get(key!)!.split('\n').slice(1).join('\n'));    // rewritten in place, one row fewer
    r2.gets = [];
    const again = await foldOpenHours(r2 as never, TENANT, learn, T12 + 11 * MIN, { start: true, publish: true });
    expect(ledgerKeys(r2.gets, 12)).toEqual([key]);
    expect(again.folded[0]).toMatchObject({ copied: 0, decisions: 2 });
  });

  it('keeps nothing past its hour: once the hour\'s fold is due the working objects go', async () => {
    const r2 = new FakeR2();
    for (const [rows, batch] of BATCHES) write(r2, rows, batch);
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 59 * MIN, { start: true, publish: true });
    // 13:02, inside hour 12's grace: the hour is closed, its fold is not due yet, its working aggregate still stands for it.
    const grace = await foldOpenHours(r2 as never, TENANT, learn, T12 + H + 2 * MIN, { start: true, publish: true });
    expect(grace.removed).toBe(0);
    expect(r2.objects.has(openKey(TENANT, DATE, 12))).toBe(true);
    // 13:06: the catch-up folds hour 12, and the next open-hour run removes its working objects.
    await catchUp(r2 as never, TENANT, learn, T12 + H + 6 * MIN, { lookbackHours: 2 });
    const after = await foldOpenHours(r2 as never, TENANT, learn, T12 + H + 6 * MIN, { start: true, publish: true });
    expect(after.removed).toBe(2);
    expect([...r2.objects.keys()].filter((k) => k.startsWith(`aggregates/${TENANT}/open/`))).toEqual([]);
  });
});

describe('the day report on a busy day', () => {
  /** Hours 10 and 11 folded, hour 12 open and started by the job at 12:16. */
  async function busy(): Promise<{ r2: FakeR2; tail: string[] }> {
    const r2 = new FakeR2();
    const T10 = T12 - 2 * H, T11 = T12 - H;
    write(r2, [dec('v7', T10 + 5 * MIN, 'hero', 'item-a'), dec('v8', T10 + 9 * MIN, 'hero', 'item-b')], 'ten');
    write(r2, [wire('v7', T10 + 6 * MIN, 'content_click', { decisionId: dec('v7', T10 + 5 * MIN, 'hero', 'item-a').decision_id, contentId: 'item-a', slot: 'hero' })], 'ten-o');
    write(r2, [dec('v9', T11 + 15 * MIN, 'deals', 'gift-card')], 'eleven');
    await buildHour(r2 as never, TENANT, { date: DATE, hour: 10 }, learn, T11 + 6 * MIN);
    await buildHour(r2 as never, TENANT, { date: DATE, hour: 11 }, learn, T12 + 6 * MIN);
    for (const [rows, batch] of BATCHES.slice(0, 3)) write(r2, rows, batch);
    await foldOpenHours(r2 as never, TENANT, learn, T12 + 16 * MIN, { start: true, publish: true });
    // What the queue writes after the job's last run: the raw tail.
    const tail = [...write(r2, ...BATCHES[3]!), ...write(r2, ...BATCHES[4]!)];
    return { r2, tail };
  }

  it('reads one aggregate per closed hour, the open hour\'s working aggregate and copy, and only the raw tail', async () => {
    const { r2, tail } = await busy();
    r2.gets = [];
    const report = await runDayReport(r2 as never, ids, learn, null, T12 + 31 * MIN);
    expect(r2.gets.filter((k) => k.startsWith(`aggregates/${TENANT}/${DATE}/`)).sort(), 'one final aggregate per closed hour').toEqual([hourKey(TENANT, DATE, 10), hourKey(TENANT, DATE, 11)]);
    expect([...ledgerKeys(r2.gets, 10), ...ledgerKeys(r2.gets, 11)], 'no raw of a closed hour').toEqual([]);
    expect(ledgerKeys(r2.gets, 12).sort(), 'and of the open hour only what the queue wrote since the job\'s run').toEqual([...tail].sort());
    expect(r2.gets.some((k) => k.startsWith(openLedgerKey(TENANT, DATE, 12) + '.')), 'and the copy the job wrote').toBe(true);
    expect(report.hours).toEqual({ source: 'aggregates', built: [10, 11, 12], missing: [...Array(10).keys()], open: [12], horizonMs: 48 * H });
    expect(report.counts.decisions, 'the tail is counted: 3 + 1 + hour 12\'s 6 (one of them redelivered)').toBe(9);
    expect(report.counts.outcomes).toBe(5);
    expect(report.coverage?.status, 'and a day with an hour still open says it is incomplete').toBe('incomplete');
  });

  it('answers from its hours where the day\'s raw is refused, and a day the job never folded is read as raw exactly as before', async () => {
    const { r2 } = await busy();
    // More ledger objects than the request may open: the raw day would be refused.
    await expect(runDayReport(r2 as never, ids, learn, [], T12 + 31 * MIN, { maxObjects: 3 })).rejects.toBeInstanceOf(ReportTooLarge);
    const report = await runDayReport(r2 as never, ids, learn, null, T12 + 31 * MIN, { maxObjects: 3 });
    expect(report.hours?.source).toBe('aggregates');

    const raw = new FakeR2();
    for (const [rows, batch] of BATCHES) write(raw, rows, batch);
    const fromRecords = await runDayReport(raw as never, ids, learn, null, T12 + 31 * MIN, { maxObjects: 100 });
    expect(fromRecords.hours).toEqual({ source: 'ledger', built: [], missing: [] });
    expect([...raw.objects.keys()].filter((k) => k.startsWith('aggregates/')), 'a report build starts no working aggregate: that is the job\'s').toEqual([]);
    await expect(runDayReport(raw as never, ids, learn, null, T12 + 31 * MIN, { maxObjects: 3 })).rejects.toBeInstanceOf(ReportTooLarge);
  });

  it('admits the same busy hours whatever the hour of the day they are summed at, and merges them to exactly what the old merge made', async () => {
    const slots = { hero: 3, 'category-rail': 6, deals: 9, 'pdp-modules': 29, 'pdp-offers': 8, 'grid-promo': 2, continue: 1 } as Record<string, number>;
    const channels = ['paid_search', 'unknown'], visits = ['1', '2-3', '4+', 'unknown'], stages = ['early', 'mid', 'late'], affinities = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const config: LearnConfig = { holdout: { share: 0, salt: 'salt', arms: ['default'] }, slots: Object.fromEntries(Object.keys(slots).map((s) => [s, { reward: 'click' }])) } as LearnConfig;
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const busyHours: HourAggregate[] = [];
    for (let h = 0; h < 6; h++) {
      // About one rehearsal's worth of decisions, over the store's slots, items and cells (lane E6's rig: 828 decisions a round).
      const r2 = new FakeR2(), base = Date.UTC(2026, 9, 2, h, 0, 0), rows: Array<DecisionRecord | OutcomeRecord> = [];
      for (let i = 0; i < 828; i++) {
        const slot = Object.keys(slots)[rnd(7)]!, item = `${slot}-i${rnd(slots[slot]!)}`, v = `v${h}-${rnd(20)}`;
        const d = { ...dec(v, base + i * 4000, slot, item), decision_id: `${TENANT}:${ts36(base + i * 4000)}:${v}:pdp:${slot}:${i}`,
          cell: { channel: channels[rnd(2)], visit_bucket: visits[rnd(4)], stage: stages[rnd(3)], region: 'US-NC', affinity: affinities[rnd(5)] } } as DecisionRecord;
        rows.push(d);
        if (i % 30 === 0) rows.push(wire(v, base + i * 4000 + 1000, 'content_click', { decisionId: d.decision_id, contentId: item, slot }));
      }
      write(r2, rows.filter((r) => 'decision_id' in r && !('outcome_id' in r)), 'x');
      write(r2, rows.filter((r) => 'outcome_id' in r), 'y');
      busyHours.push(await buildHour(r2 as never, TENANT, { date: DATE, hour: h }, config, base + H + 6 * MIN, { shards: 4 }));
    }
    // The afternoon: the same six busy hours, after seventeen quiet hours folded empty.
    const quiet = Array.from({ length: 17 }, (_, i) => ({ ...busyHours[0]!, hour: 6 + i, from: T12 - 6 * H + i * H, to: T12 - 5 * H + i * H, brands: {} }));
    const morning = reportFromHours(busyHours, ids, config, T12, { pending: 0, missing: [] });
    const afternoon = reportFromHours([...busyHours, ...quiet], ids, config, T12 + 11 * H, { pending: 0, missing: [] });
    expect(morning.counts.decisions).toBe(6 * 828);
    expect(afternoon.counts).toEqual(morning.counts);
    // The day merged in place is the day the old merge made, value for value and key for key.
    const tau = DEFAULT_STATS.tauLearnMs;
    let copied = emptyBrand();
    const inPlace = emptyBrand();
    for (const hour of busyHours) { copied = mergeBrand(copied, hour.brands[TENANT]!, tau); mergeBrandInto(inPlace, hour.brands[TENANT]!, tau); }
    expect(JSON.stringify(inPlace)).toBe(JSON.stringify(copied));
  });
});
