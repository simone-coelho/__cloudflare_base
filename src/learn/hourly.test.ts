// src/learn/hourly.test.ts
// Doc 31 §3: the day report as the sum of its hours. The fold must agree with
// the report built from the day's records, credit across the hour boundary,
// never double an hour, forget past the horizon, drop an erased visitor, and
// keep the five-minute cadence inside one Worker's budget.

import { describe, it, expect } from 'vitest';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { hourPrefix, ts36 } from '@/ledger/records';
import { writeTombstone } from '@/ledger/erasure';
import { buildReport, reportKey, type ReportPolicy } from './report';
import { DEFAULT_POLICY } from './policy';
import { DEFAULT_STATS, emptyStats, recordExposure, recordSuccess, buildSnapshot } from './stats';
import {
  buildHour, catchUp, closedHours, hourKey, loadHours, mergeStats, policiesOf, reportFromHours, runDayReport, ReportTooLarge,
  shardKey, shardOf, SHARDS, type HourAggregate, type ShardState,
} from './hourly';

const MIN = 60_000, H = 3600_000;
const T12 = Date.UTC(2026, 8, 3, 12, 0, 0);          // 2026-09-03 12:00 UTC
const NOW = T12 + 4 * H;                              // 16:00, when the reports are read
const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: null };

const dec = (visitor: string, session: string, ts: number, item: string, o: { arm?: DecisionRecord['arm']; explored?: boolean; slot?: string; products?: string[] } = {}): DecisionRecord => ({
  decision_id: `coach:${ts36(ts)}:${visitor}:home:${o.slot ?? 'hero'}:0`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: session, identity_anchor: 'visitor', ts,
  page: 'home', slot: o.slot ?? 'hero', position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm: o.arm ?? 'personalized', explored: o.explored ?? false, authority: 'engine',
  versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1', explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
  ...(o.products ? { featured_product_ids: o.products } : {}),
} as DecisionRecord);
const out = (visitor: string, session: string | null, ts: number, type: OutcomeRecord['type'], item: string | null, o: { products?: string[]; value?: number } = {}): OutcomeRecord =>
  ({ outcome_id: `coach:${ts36(ts)}:${visitor}:${type}`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: session, ts, type, event: type, item_id: item, slot: null, value: o.value ?? null, currency: null, margin: null, products: o.products ?? null, arm: null });

const learn: LearnConfig = { holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click', exploration: { mode: 'rotation', share: 0.5, floor: 50 } }, story: { reward: 'purchase' } } };

class FakeR2 {
  objects = new Map<string, string>();
  puts: string[] = [];
  async put(key: string, body: string): Promise<void> { this.objects.set(key, body); this.puts.push(key); }
  async get(key: string) { const v = this.objects.get(key); return v === undefined ? null : { text: async () => v, json: async () => JSON.parse(v) as unknown }; }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
  async list({ prefix }: { prefix: string }) { return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; }
  keys(prefix: string): string[] { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  json<T>(key: string): T { return JSON.parse(this.objects.get(key)!) as T; }
}

/** The ledger as the consumer writes it: one object per hour and stream, lines in the order given. */
function ledger(r2: FakeR2, decisions: DecisionRecord[], outcomes: OutcomeRecord[]): void {
  const groups = new Map<string, string[]>();
  for (const d of decisions) { const k = `${hourPrefix('coach', d.ts)}/decision/${ts36(d.ts)}-${ts36(d.ts)}-t.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(d)]); }
  for (const o of outcomes) { const k = `${hourPrefix('coach', o.ts)}/outcome/${ts36(o.ts)}-${ts36(o.ts)}-t.ndjson`; groups.set(k, [...(groups.get(k) ?? []), JSON.stringify(o)]); }
  for (const [k, lines] of groups) r2.objects.set(k, lines.join('\n') + '\n');
}

// The day: five shoppers over two hours.
const decisions = [
  dec('v1', 's1', T12, 'a'),                                          // v1 sees a, then b, clicks b: last-touch pays b, first-touch pays a
  dec('v1', 's1', T12 + 1 * MIN, 'b', { explored: true }),
  dec('v2', 's2', T12, 'a', { arm: 'default' }),                      // the holdout: its click counts for the arm, never as an exposure
  dec('v5', 's5', T12 + 5 * MIN, 'a'),                                // v5 buys with no product named: a purchase is not the hero's reward
  dec('v4', 's4', T12 + 10 * MIN, 'st-1', { slot: 'story', products: ['bag-1'] }),  // the story features the bag v4 buys at 13:30
  dec('v3', 's3', T12 + 59 * MIN, 'a'),                               // served at 12:59, clicked at 13:01: the credit crosses the hour
];
const outcomes = [
  out('v2', 's2', T12 + 30_000, 'click', 'a'),
  out('v1', 's1', T12 + 2 * MIN, 'click', 'b'),
  out('v5', 's5', T12 + 6 * MIN, 'purchase', null),
  out('v3', 's3', T12 + 61 * MIN, 'click', 'a'),
  out('v4', 's4', T12 + 90 * MIN, 'purchase', null, { products: ['bag-1'], value: 375 }),
];
const ids = { tenant: 'coach', brand: 'coach', date: '2026-09-03' };
const learning: ReportPolicy = { name: 'learning', ...DEFAULT_POLICY };

async function twoHours(r2: FakeR2, opts: Parameters<typeof buildHour>[5] = {}): Promise<HourAggregate[]> {
  return [await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW, opts), await buildHour(r2, 'coach', { date: '2026-09-03', hour: 13 }, learn, NOW, opts)];
}

describe('the hourly fold', () => {
  it('the day from its hours is the day from its records: grids, arms, exploration, credits, counts', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);
    const aggs = await twoHours(r2);
    const fromHours = reportFromHours(aggs, ids, learn, NOW, { pending: 0, missing: [] });
    const fromRecords = buildReport({ ...ids, learning, reporting: policiesOf(learn).slice(1), learn, decisions, outcomes, now: NOW, truncated: false });
    expect(fromHours.counts).toEqual(fromRecords.counts);
    expect(fromHours.policies).toEqual(fromRecords.policies);
    expect(fromHours.holdout).toEqual(fromRecords.holdout);
    expect(fromHours.holdoutComparison).toEqual(fromRecords.holdoutComparison);
    expect(fromHours.exploration).toEqual(fromRecords.exploration);
    expect(fromHours.grids).toEqual(fromRecords.grids);
    expect(fromHours.hours).toEqual({ source: 'aggregates', built: [12, 13], missing: [], horizonMs: 48 * H });
    // The facts a reader checks by hand: the cross-hour click paid a, the featured bag paid the story, the holdout's click paid no item.
    expect(fromHours.counts).toEqual({ decisions: 6, outcomes: 5, visitors: 5, truncated: false });
    expect(fromHours.policies[0]).toMatchObject({ name: 'learning', role: 'learning', credits: 4 });   // v2's arm credit, v1's b, v3's a, v4's story
    expect(fromHours.holdout.hero).toEqual([{ arm: 'default', decisions: 1, credited: 1, rate: 1 }, { arm: 'personalized', decisions: 4, credited: 2, rate: 0.5 }]);
    expect(fromHours.grids.hero!.learning!.items.a!['*']!.s).toBeCloseTo(0.994, 3);       // one click, decayed three hours on the 21-day horizon
    expect(fromHours.grids.story!.learning!.items['st-1']!['*']!.s).toBeCloseTo(0.995, 3);
    // Hour 13 holds no decision, only the cross-hour click and the purchase, and credits both.
    expect(aggs[1]!.brands.coach!.policies.learning!.credits).toBe(2);
    expect(aggs[1]!.brands.coach!.decisions).toBe(0);
    expect(aggs[1]!.brands.coach!.outcomes).toBe(2);
    expect(aggs[1]!.objects).toBe(2);                                 // one object per outcome in this fixture
    // No visitor id in an aggregate; the rings live in the shards.
    expect(JSON.stringify(aggs)).not.toContain('"v1"');
    expect(r2.keys('aggregates/coach/rings/').length).toBeGreaterThan(0);
  });

  it('an hour built again is not folded twice, and its aggregate still counts everything', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);
    const [first] = await twoHours(r2);
    const ringsBefore = r2.keys('aggregates/coach/rings/').map((k) => r2.objects.get(k));
    const again = await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW);
    expect(again.ringsFolded).toBe(false);
    expect(r2.keys('aggregates/coach/rings/').map((k) => r2.objects.get(k))).toEqual(ringsBefore);
    expect(again.brands.coach!.decisions).toBe(first!.brands.coach!.decisions);
    expect(again.brands.coach!.policies.learning!.credits).toBe(first!.brands.coach!.policies.learning!.credits);
    const v1 = r2.json<ShardState>(shardKey('coach', shardOf('v1')));
    expect(v1.rings.v1!.map((e) => e.item)).toEqual(['a', 'b']);
    expect(v1.through).toBe(T12);                                     // hour 13 changed nothing in this shard, so nothing was written
  });

  it('the rings forget past the horizon and keep no more than the cap; the report says how far it reached', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);
    const aggs = await twoHours(r2, { horizonMs: 30 * MIN, ringCap: 1 });
    // Hour 13 reaches back to 12:30: v3's 12:59 hero is credited, v4's 12:10 story is not.
    const r = reportFromHours(aggs, ids, learn, NOW, { pending: 0, missing: [] });
    expect(r.policies[0]!.credits).toBe(3);
    expect(r.grids.story!.learning!.items['st-1']!['*']!.s).toBe(0);
    expect(r.hours!.horizonMs).toBe(30 * MIN);
    // The cap: v1 keeps only the later of the two decisions.
    const after12 = JSON.parse(r2.puts.filter((k) => k === shardKey('coach', shardOf('v1'))).length ? r2.objects.get(shardKey('coach', shardOf('v1')))! : '{}') as ShardState;
    expect(after12.rings.v1 === undefined || after12.rings.v1.length <= 1).toBe(true);
  });

  it('an erased visitor: rows hidden before the fold, the ring gone at the next one', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);
    await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW);
    expect(r2.json<ShardState>(shardKey('coach', shardOf('v1'))).rings.v1).toBeDefined();
    await writeTombstone(r2, 'coach', 'v1', 'test', T12 + 2 * H);
    const h13 = await buildHour(r2, 'coach', { date: '2026-09-03', hour: 13 }, learn, NOW);
    expect(r2.json<ShardState>(shardKey('coach', shardOf('v1'))).rings.v1).toBeUndefined();
    expect(h13.brands.coach!.rows_hidden).toBe(0);                     // v1 had no rows in hour 13
    const again12 = await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW);
    expect(again12.brands.coach!.rows_hidden).toBe(3);                 // two decisions and a click
    expect(again12.brands.coach!.decisions).toBe(4);
  });

  it('two accumulators merge to what one would hold, exactly', () => {
    const tau = DEFAULT_STATS.tauLearnMs;
    const one = emptyStats(), a = emptyStats(), b = emptyStats();
    recordExposure(one, 'x', cell, T12, DEFAULT_STATS); recordSuccess(one, 'x', cell, 'click', T12 + MIN, 1, DEFAULT_STATS); recordExposure(one, 'x', cell, T12 + 3 * H, DEFAULT_STATS);
    recordExposure(a, 'x', cell, T12, DEFAULT_STATS); recordSuccess(a, 'x', cell, 'click', T12 + MIN, 1, DEFAULT_STATS);
    recordExposure(b, 'x', cell, T12 + 3 * H, DEFAULT_STATS);
    const merged = mergeStats(a, b, tau);
    const snapOne = buildSnapshot(one, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS);
    const snapMerged = buildSnapshot(merged, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS);
    expect(snapMerged.items).toEqual(snapOne.items);
    expect(snapMerged.slotRates).toEqual(snapOne.slotRates);
    expect(merged.events).toBe(2);
    expect(mergeStats(b, a, tau).items.x!['*']!.n.s).toBeCloseTo(merged.items.x!['*']!.n.s, 12);
  });

  it('the five-minute job folds the oldest closed hours first, a few per run, and refreshes the day so far', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);
    const now = T12 + 2 * H + 7 * MIN;                                  // 14:07: hour 13 closed at 14:05
    expect(closedHours(now, 3).map((h) => h.hour)).toEqual([11, 12, 13]);
    expect(closedHours(T12 + 2 * H + 3 * MIN, 3).map((h) => h.hour)).toEqual([11, 12]);   // 14:03: hour 13 has not drained
    const first = await catchUp(r2, 'coach', learn, now, { lookbackHours: 3, maxHours: 2 });
    expect(first.built.map((b) => [b.hour, b.decisions, b.outcomes])).toEqual([[11, 0, 0], [12, 6, 3]]);
    expect(first.pending).toBe(1);
    const soFar = r2.json<{ hours: { built: number[]; missing: number[] }; counts: { decisions: number } }>(reportKey('coach', 'coach', '2026-09-03'));
    const earlier = Array.from({ length: 11 }, (_, h) => h);            // 00h to 10h: closed, outside this run's lookback, honestly listed
    expect(soFar.hours).toEqual({ built: [11, 12], missing: [...earlier, 13], source: 'aggregates', horizonMs: 48 * H });
    expect(soFar.counts.decisions).toBe(6);
    const second = await catchUp(r2, 'coach', learn, now, { lookbackHours: 3, maxHours: 2 });
    expect(second.built.map((b) => b.hour)).toEqual([13]);
    expect(second.pending).toBe(0);
    expect(r2.json<{ hours: { built: number[]; missing: number[] } }>(reportKey('coach', 'coach', '2026-09-03')).hours).toMatchObject({ built: [11, 12, 13], missing: earlier });
    const third = await catchUp(r2, 'coach', learn, now, { lookbackHours: 3, maxHours: 2 });
    expect(third).toEqual({ built: [], pending: 0 });
    expect(r2.keys('aggregates/coach/2026-09-03/')).toEqual([hourKey('coach', '2026-09-03', 11), hourKey('coach', '2026-09-03', 12), hourKey('coach', '2026-09-03', 13)]);
    // A day nothing was folded for lists every closed hour as missing.
    expect((await loadHours(r2, 'coach', '2026-09-02', now)).missing).toHaveLength(24);
  });

  it('the day report comes from the hours when they exist, from the records otherwise, and a big day without hours is refused', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);
    const fromRecords = await runDayReport(r2, ids, learn, null, NOW, { maxObjects: 100 });
    expect(fromRecords.hours).toEqual({ source: 'ledger', built: [], missing: [] });
    await expect(runDayReport(r2, ids, learn, null, NOW, { maxObjects: 1 })).rejects.toBeInstanceOf(ReportTooLarge);
    await twoHours(r2);
    const fromHours = await runDayReport(r2, ids, learn, null, NOW, { maxObjects: 1 });
    expect(fromHours.hours!.source).toBe('aggregates');
    expect(fromHours.counts.decisions).toBe(6);
    // Custom policies are computed over the records, so the same small day is refused.
    await expect(runDayReport(r2, ids, learn, [{ name: 'mine', ...DEFAULT_POLICY, match: 'any' }], NOW, { maxObjects: 1 })).rejects.toBeInstanceOf(ReportTooLarge);
    const custom = await runDayReport(r2, ids, learn, [{ name: 'mine', ...DEFAULT_POLICY, match: 'any' }], NOW, { maxObjects: 100 });
    expect(custom.policies.map((p) => p.name)).toEqual(['learning', 'mine']);
  });

  it('a visitor always lands in the same shard, inside the range', () => {
    for (const v of ['v1', 'vis-2f1c', 'anything at all']) { expect(shardOf(v)).toBe(shardOf(v)); expect(shardOf(v)).toBeGreaterThanOrEqual(0); expect(shardOf(v)).toBeLessThan(SHARDS); }
    expect(new Set(Array.from({ length: 200 }, (_, i) => shardOf(`visitor-${i}`))).size).toBeGreaterThan(SHARDS / 2);
  });
});
