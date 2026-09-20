// src/learn/hourly.test.ts
// Doc 31 §3: the day report as the sum of its hours. The fold must agree with
// the report built from the day's records, credit across the hour boundary,
// never double an hour, forget past the horizon, drop an erased visitor, and
// keep the five-minute cadence inside one Worker's budget.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { DecisionRecord, LearnConfig, SlotStrategy } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { hourPrefix, ts36, outcomeFromAction } from '@/ledger/records';
import { writeTombstone } from '@/ledger/erasure';
import { buildReport, runReport, canonicalReportJson, reportKey, REPORT_LIMITS, ReportBudgetExceeded, ReportUnavailableError, ReportInputError, explorationOpportunity, type ReportPolicy } from './report';
import { decideContent } from '@/content/decide';
import { DEFAULT_POLICY } from './policy';
import { computationBasis, diagnosticDayReport } from './report';
import { DEFAULT_STATS, emptyStats, recordExposure, recordSuccess, buildSnapshot } from './stats';
import { windowReport } from '@/measure/window';
import {
  buildHour, catchUp, closedHours, hourKey, loadHours, loadHourRecords, mergeStats, policiesOf, reportFromHours, runDayReport, ReportTooLarge,
  compactOf, emptyShard, shardKey, shardOf, SHARDS, type HourAggregate, type ShardState,
  foldShard, foldDecisions, cleanupHourlyState, type FoldContext,
} from './hourly';
import { retentionBirth, type RetentionEnv } from '@/retention';

const MIN = 60_000, H = 3600_000;

it('W14.07 excludes behavior/product-sort before hourly object and payload budgets',async()=>{
  const r2=new FakeR2(),prefix='coach/2026-09-03/12/';
  for(let i=0;i<300;i++)for(const stream of ['behavior','product-sort'])r2.objects.set(prefix+stream+'/'+i+'.ndjson','deliberately not learning JSON');
  r2.objects.set(prefix+'decision/a.ndjson','');r2.objects.set(prefix+'outcome/b.ndjson','');
  const get=vi.spyOn(r2,'get');
  expect(await loadHourRecords(r2,'coach','2026-09-03',12,2)).toMatchObject({objects:2,read:2,truncated:false,decisions:[],outcomes:[]});
  expect(get.mock.calls.map(([key])=>key)).toEqual([prefix+'decision/a.ndjson',prefix+'outcome/b.ndjson']);
});
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
  async put(key: string, body: string, options?: R2PutOptions): Promise<{ etag: string } | null> {
    const before = this.objects.get(key), onlyIf = options?.onlyIf as R2Conditional | undefined;
    const etag = before === undefined ? null : createHash('sha256').update(before).digest('hex');
    if ((onlyIf?.etagMatches !== undefined && onlyIf.etagMatches !== etag)
      || (onlyIf?.etagDoesNotMatch === '*' && before !== undefined)
      || (onlyIf?.etagDoesNotMatch !== undefined && onlyIf.etagDoesNotMatch === etag)) return null;
    this.objects.set(key, body); this.puts.push(key);
    return { etag: createHash('sha256').update(body).digest('hex') };
  }
  async get(key: string, options?: R2GetOptions) {
    const v = this.objects.get(key); if (v === undefined) return null;
    const bytes = new TextEncoder().encode(v), range = options?.range;
    const selected = range && 'length' in range ? bytes.slice(0, range.length ?? bytes.length) : bytes;
    return { etag: createHash('sha256').update(v).digest('hex'), size: bytes.length, body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(selected); c.close(); } }), text: async () => v, json: async () => JSON.parse(v) as unknown };
  }
  async delete(key: string): Promise<void> { this.objects.delete(key); }
  async list({ prefix }: { prefix: string }) { return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; }
  keys(prefix: string): string[] { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  json<T>(key: string): T { return JSON.parse(this.objects.get(key)!) as T; }
}
/** Explicit builds change write identity; ring/through/seen contents remain exact. */
function ringContents(body: string | undefined): unknown {
  if (body === undefined) return undefined;
  const value = JSON.parse(body) as ShardState;
  delete value.generation; delete value.pending; return value;
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

it('W15 raw and hourly reports isolate rendered/served bases, retain original IDs and use rendered time for decay and credit', async () => {
  const r2 = new FakeR2(), config: LearnConfig = { ...learn, slots: { hero: { reward: 'click', objective: 'unit', measurementBasis: 'rendered-v1' } } };
  const original = dec('legacy', 's', T12, 'legacy'), rendered: DecisionRecord = { ...dec('rendered', 's', T12, 'painted'), measurementBasis: 'rendered-v1',
    rendered: { version: 1, eventId: 'first-render', at: T12 + MIN, pageInstance: 'page' } };
  const before = { ...out('rendered', 's', T12 + 30000, 'click', 'painted'), decision_id: rendered.decision_id };
  const after = { ...out('rendered', 's', T12 + 2 * MIN, 'click', 'painted'), decision_id: rendered.decision_id };
  ledger(r2, [original, rendered], [before, after]);
  const raw = buildReport({ ...ids, decisions: [original, rendered], outcomes: [before, after], learn: config, learning, reporting: [], now: NOW, truncated: false });
  expect(raw.computation).toMatchObject({ version: 4, slots: [{ slot: 'hero', measurementBasis: 'rendered-v1', objective: 'unit' }] });
  expect(raw.grids.hero!.learning!).toMatchObject({ measurementBasis: 'rendered-v1', objective: 'unit' });
  expect(Object.keys(raw.grids.hero!.learning!.items)).toEqual(['painted']); expect(raw.policies[0]!.credits).toBe(1);
  const hour = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, config, NOW, { shards: 2 });
  const folded = reportFromHours([hour], ids, config, NOW, { pending: 0, missing: [] });
  expect(folded.grids.hero!.learning!.items).toEqual(raw.grids.hero!.learning!.items); expect(folded.policies[0]!.credits).toBe(1);
  expect(rendered.ts).toBe(T12); expect(rendered.decision_id).toBe(dec('rendered', 's', T12, 'painted').decision_id);
  const legacy = buildReport({ ...ids, decisions: [original, rendered], outcomes: [], learn, learning, reporting: [], now: NOW, truncated: false });
  expect(Object.keys(legacy.grids.hero!.learning!.items)).toEqual(['legacy']);
  expect(() => reportFromHours([hour], ids, learn, NOW, { pending: 0, missing: [] })).toThrow();
});

async function twoHours(r2: FakeR2, opts: Parameters<typeof buildHour>[5] = {}): Promise<HourAggregate[]> {
  return [await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW, opts), await buildHour(r2, 'coach', { date: '2026-09-03', hour: 13 }, learn, NOW, opts)];
}

it('W15 reads exact archived v1–3 served hours without relabeling or pooling new rendered/versioned history', async () => {
  const r2 = new FakeR2(); ledger(r2, [dec('v', 's', T12, 'a')], []);
  const current = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 2 });
  for (const version of [1, 2, 3] as const) {
    const old = structuredClone(current), basis = old.brands.coach!.computation!;
    basis.version = version; for (const slot of basis.slots) delete slot.measurementBasis;
    if (version < 3) delete old.brands.coach!.duplicates;
    const before = JSON.stringify(old), report = reportFromHours([old], ids, learn, NOW, { pending: 0, missing: [] });
    expect(report.computation).toEqual(basis); expect(report.grids.hero!.learning!.measurementBasis).toBe('served-v1');
    expect(Object.keys(report.grids.hero!.learning!.items)).toEqual(['a']); expect(JSON.stringify(old)).toBe(before);
    expect(() => reportFromHours([old], ids, { ...learn, slots: { hero: { measurementBasis: 'rendered-v1' } } }, NOW, { pending: 0, missing: [] })).toThrow(ReportUnavailableError);
    const newer = structuredClone(current); newer.hour = 13;
    expect(() => reportFromHours([old, newer], ids, learn, NOW, { pending: 0, missing: [] })).toThrow(ReportUnavailableError);
  }
});

function recoveryFixture() {
  const r2 = new FakeR2(), options = { shards: 3, ringCap: 1, horizonMs: H }, now = T12 + H + 7 * MIN;
  const visitors = Array.from({ length: 3 }, (_, s) => Array.from({ length: 100 }, (_, n) => `recover-${n}`).find(v => shardOf(v, 3) === s)!);
  const rows = visitors.map(v => dec(v, 's', T12 + 40 * MIN, 'fresh'));
  for (const [s, v] of visitors.entries()) r2.objects.set(shardKey('coach', s), JSON.stringify({ ...emptyShard(s), through: T12 - H, seenDate: ids.date,
    rings: { [v]: [compactOf(dec(v, 's', T12 - MIN, 'carry')).entry] }, seen: { coach: [v] }, seenAt: { coach: { [v]: T12 - MIN } } }));
  ledger(r2, rows, visitors.flatMap(v => [out(v, 's', T12 + MIN, 'click', 'carry'), out(v, 's', T12 + 41 * MIN, 'click', 'fresh')]));
  return { r2, options, now, visitors, at: { date: ids.date, hour: 12 }, key: hourKey('coach', ids.date, 12), coordinator: shardKey('coach', 0) };
}
async function interruptRecovery(f: ReturnType<typeof recoveryFixture>) {
  const put = f.r2.put.bind(f.r2);
  const writes = vi.spyOn(f.r2, 'put').mockImplementation(async (key, body, options) => {
    if (key === shardKey('coach', 1)) throw new Error('synthetic interrupted shard');
    return put(key, body, options);
  });
  await expect(buildHour(f.r2, 'coach', f.at, learn, f.now, f.options)).rejects.toThrow('synthetic interrupted shard');
  writes.mockRestore(); f.r2.puts.length = 0;
  expect(f.r2.json<ShardState>(f.coordinator).pending).toBeDefined();
}

describe('the hourly fold', () => {
  it('W06.12 recovers frozen numeric credits after source erasure, then durably cleans quiet subject state', async () => {
    const f = recoveryFixture(); await interruptRecovery(f);
    const exact = f.r2.json<ShardState>(f.coordinator).pending!.aggregate;
    await writeTombstone(f.r2, 'coach', f.visitors[0]!, 'test', T12 + 50 * MIN);
    for (const key of f.r2.keys(`coach/${ids.date}/12/`)) f.r2.objects.delete(key);
    const recovered = await buildHour(f.r2, 'coach', f.at, learn, f.now + MIN, f.options);
    expect(f.r2.objects.get(f.key)).toBe(exact);
    expect(recovered.brands.coach!.policies.learning!.credits).toBe(6);
    expect(recovered.builtAt).toBe(f.now);
    const state = f.r2.json<ShardState>(f.coordinator);
    expect(state.rings[f.visitors[0]!]).toBeUndefined();
    expect(state.seen.coach ?? []).not.toContain(f.visitors[0]);
    expect(state.seenAt?.coach?.[f.visitors[0]!]).toBeUndefined();
    for (const [shard, visitor] of f.visitors.entries()) if (shard) expect(f.r2.json<ShardState>(shardKey('coach', shard)).rings[visitor]![0]!.item).toBe('fresh');
    f.r2.puts.length = 0;
    await catchUp(f.r2, 'coach', learn, f.now + MIN, { ...f.options, lookbackHours: 1 });
    expect(f.r2.puts).toEqual([reportKey(ids.tenant, ids.brand, ids.date)]); expect(f.r2.objects.get(f.key)).toBe(exact);
    ledger(f.r2, [], f.visitors.map(visitor => out(visitor, 's', T12 + H + MIN, 'click', 'fresh')));
    expect((await buildHour(f.r2, 'coach', { ...f.at, hour: 13 }, learn, f.now + H, f.options)).brands.coach!.policies.learning!.credits).toBe(2);
  });

  it('W06.12 refuses conflicting cleanup ownership before mutation and expires orphan seen stamps without a fold', async () => {
    const policy = { id: 'fixture-hourly', revision: 1, durationMs: H, basis: 'admitted', renewal: 'new-record-only' };
    const env = { TENANTS: JSON.stringify({ provisioned: ['coach', 'harbor'] }), RETENTION: JSON.stringify({ version: 1, tenants: { coach: { hourly: policy }, harbor: { hourly: policy } } }) } as RetentionEnv;
    for (const fault of ['tenant', 'subject', 'carrier', 'stamp']) {
      const f = recoveryFixture(), state = f.r2.json<ShardState>(shardKey('coach', 1)), visitor = f.visitors[1]!, row = state.rings[visitor]![0]!;
      if (fault === 'tenant') row.tenant = 'harbor';
      if (fault === 'subject') row.visitor_id = 'other';
      if (fault === 'carrier') row.id = row.id.replace(`:${visitor}:`, ':other:');
      if (fault === 'stamp') row.retention = { hourly: retentionBirth(env, 'harbor', 'hourly', T12, T12) };
      f.r2.objects.set(shardKey('coach', 1), JSON.stringify(state));
      await writeTombstone(f.r2, 'coach', visitor, 'test', f.now);
      const before = [...f.r2.objects]; f.r2.puts.length = 0;
      await expect(cleanupHourlyState(f.r2, 'coach', 3, f.now)).rejects.toThrow();
      expect([...f.r2.objects]).toEqual(before); expect(f.r2.puts).toEqual([]);
    }
    const f = recoveryFixture(), state = f.r2.json<ShardState>(f.coordinator), expired = retentionBirth(env, 'coach', 'hourly', T12, T12);
    state.seenRetention = { coach: { orphan: expired, live: retentionBirth(env, 'coach', 'hourly', T12 + H, T12 + H) } };
    f.r2.objects.set(f.coordinator, JSON.stringify(state));
    await cleanupHourlyState(f.r2, 'coach', 3, T12 + H + 1);
    expect(f.r2.json<ShardState>(f.coordinator).seenRetention).toEqual({ coach: { live: state.seenRetention.coach!.live } });
    expect(f.r2.objects.has(f.key)).toBe(false);
    f.r2.puts.length = 0; await cleanupHourlyState(f.r2, 'coach', 3, T12 + H + 1); expect(f.r2.puts).toEqual([]);
  });
  it('W30.04 preserves exact prepared credits across every interrupted write and lost acknowledgement, restart and next-hour attribution', async () => {
    for (const stage of ['coordinator', 'shard1', 'shard2', 'aggregate', 'complete']) for (const applied of [false, true]) {
      const f = recoveryFixture(), { r2 } = f, original = [...r2.objects], put = r2.put.bind(r2), get = r2.get.bind(r2);
      let failed = false, unreadable: string | undefined;
      const writes = vi.spyOn(r2, 'put').mockImplementation(async (key, body, options) => {
        const target = stage === 'coordinator' ? key === f.coordinator && body.includes('"pending":')
          : stage === 'complete' ? key === f.coordinator && !body.includes('"pending":')
            : key === (stage === 'aggregate' ? f.key : shardKey('coach', stage === 'shard1' ? 1 : 2));
        if (target && !failed) {
          failed = true;
          if (applied) { await put(key, body, options); unreadable = key; }
          throw new Error('synthetic interrupted write');
        }
        return put(key, body, options);
      });
      const reads = vi.spyOn(r2, 'get').mockImplementation(async (key, options) => {
        if (key === unreadable) throw new Error('synthetic restart before readback');
        return get(key, options);
      });
      await expect(buildHour(r2, 'coach', f.at, learn, f.now, f.options)).rejects.toThrow(/synthetic/);
      expect(failed).toBe(true);
      expect(writes.mock.calls.every(([, , options]) => options?.onlyIf !== undefined)).toBe(true);
      if (stage === 'coordinator' && !applied) { expect([...r2.objects]).toEqual(original); expect(r2.puts).toEqual([]); }
      reads.mockRestore(); writes.mockRestore();
      const pending = r2.json<ShardState>(f.coordinator).pending;
      const exact = pending?.aggregate ?? r2.objects.get(f.key);
      const restart = new FakeR2(); for (const [key, body] of r2.objects) restart.objects.set(key, body);
      const result = await catchUp(restart, 'coach', learn, f.now + MIN, { ...f.options, lookbackHours: 1, maxHours: 1 });
      expect(result.failed).toEqual([]); expect(result.pending).toBe(0);
      expect(result.built).toHaveLength(stage === 'complete' && applied ? 0 : 1);
      const recovered = restart.json<HourAggregate>(f.key);
      if (exact !== undefined) expect(restart.objects.get(f.key)).toBe(exact);
      expect(recovered.brands.coach!.policies.learning!.credits).toBe(6);
      expect(recovered.brands.coach).toMatchObject({ decisions: 3, outcomes: 6, visitorsDay: 3 });
      expect(recovered.builtAt).toBe(stage === 'coordinator' && !applied ? f.now + MIN : f.now);
      expect(recovered.ringsFolded).toBe(true);
      expect(restart.json<ShardState>(f.coordinator).pending).toBeUndefined();
      for (const [s, visitor] of f.visitors.entries()) {
        const state = restart.json<ShardState>(shardKey('coach', s));
        expect(state.rings[visitor]!.map(e => e.item)).toEqual(['fresh']); expect(state.generation).toBe(recovered.generation);
      }
      const stable = [...restart.objects]; restart.puts.length = 0;
      expect((await catchUp(restart, 'coach', learn, f.now + MIN, { ...f.options, lookbackHours: 1 })).built).toEqual([]);
      expect([...restart.objects]).toEqual(stable); expect(restart.puts).toEqual([]);
      ledger(restart, [], f.visitors.map(v => out(v, 's', T12 + H + MIN, 'click', 'fresh')));
      const next = await buildHour(restart, 'coach', { ...f.at, hour: 13 }, learn, f.now + H, f.options);
      expect(next.brands.coach!.policies.learning!.credits).toBe(3);
      const report = reportFromHours([recovered, next], ids, learn, f.now + H, { pending: 0, missing: [] });
      expect(report.policies[0]!.credits).toBe(9); expect(report.counts).toMatchObject({ decisions: 3, outcomes: 9, visitors: 3 });
    }
    // A lost acknowledgement with available exact readback completes in the same call.
    const f = recoveryFixture(), put = f.r2.put.bind(f.r2);
    const writes = vi.spyOn(f.r2, 'put').mockImplementation(async (key, body, options) => {
      await put(key, body, options); throw new Error('synthetic lost acknowledgement');
    });
    expect((await buildHour(f.r2, 'coach', f.at, learn, f.now, f.options)).brands.coach!.policies.learning!.credits).toBe(6);
    expect(f.r2.puts.filter(k => k === f.key)).toHaveLength(1); writes.mockRestore();
  });

  it('W30.04 refuses changed recovery bases, malformed plans, divergent shards and bounded-state overflow before further effects', async () => {
    for (const fault of ['payload', 'bytes', 'inventory', 'config', 'tombstone', 'options', 'checkpoint', 'vector', 'numeric', 'computation', 'aggregate-owner',
      'missing-etag', 'shard-after', 'shard-before', 'aggregate-race', 'checkpoint-bytes']) {
      const f = recoveryFixture(); await interruptRecovery(f);
      if (['payload', 'bytes', 'inventory', 'tombstone'].includes(fault)) {
        // Retained v1 plans depend on raw sources. Do not grant them v2's new
        // self-contained recovery proof; preserve the original conflict oracle.
        const state = f.r2.json<ShardState>(f.coordinator);
        state.pending!.version = 1; delete state.pending!.targets; delete state.pending!.configuration;
        f.r2.objects.set(f.coordinator, JSON.stringify(state));
      }
      let config = learn, options = f.options;
      if (fault === 'payload' || fault === 'bytes') {
        const key = f.r2.keys(`coach/${ids.date}/12/decision/`)[0]!, lines = f.r2.objects.get(key)!.trimEnd().split('\n'), row = JSON.parse(lines[0]!) as DecisionRecord;
        lines[0] = JSON.stringify({ ...row, explain: { ...row.explain, fullPayloadChange: true } });
        f.r2.objects.set(key, fault === 'bytes' ? f.r2.objects.get(key)! + '\n' : lines.join('\n') + '\n');
      }
      if (fault === 'inventory') f.r2.objects.set(`coach/${ids.date}/12/decision/zzzzzzzzz-later.ndjson`, '');
      if (fault === 'config') config = { ...learn, stats: { ...DEFAULT_STATS, tauLearnMs: DEFAULT_STATS.tauLearnMs + 1 } };
      if (fault === 'tombstone') await writeTombstone(f.r2, 'coach', f.visitors[0]!, 'test', T12);
      if (fault === 'options') options = { ...f.options, ringCap: 2 };
      if (['checkpoint', 'vector', 'numeric', 'computation', 'aggregate-owner', 'checkpoint-bytes'].includes(fault)) {
        const state = f.r2.json<ShardState>(f.coordinator), p = state.pending!;
        if (fault === 'checkpoint') p.version = 3 as never;
        if (fault === 'vector') p.states[2] = null as never;
        if (fault === 'checkpoint-bytes') p.aggregate = ' '.repeat(REPORT_LIMITS.aggregateBytes + 1);
        if (['numeric', 'computation', 'aggregate-owner'].includes(fault)) {
          const a = JSON.parse(p.aggregate) as HourAggregate;
          if (fault === 'numeric') { a.brands.coach!.computation = null; a.brands.coach!.decisions = -1; }
          if (fault === 'computation') a.brands.coach!.computation!.slots[0]!.reward = 'purchase';
          if (fault === 'aggregate-owner') a.tenant = 'other';
          p.aggregate = JSON.stringify(a);
        }
        f.r2.objects.set(f.coordinator, JSON.stringify(state));
      }
      if (fault === 'shard-after' || fault === 'shard-before') {
        const key = shardKey('coach', fault === 'shard-after' ? 0 : 2), state = f.r2.json<ShardState>(key);
        state.seen.coach!.push('divergent'); f.r2.objects.set(key, JSON.stringify(state));
      }
      if (fault === 'aggregate-race') f.r2.objects.set(f.key, '{}');
      const get = f.r2.get.bind(f.r2);
      const reads = vi.spyOn(f.r2, 'get').mockImplementation(async (key, options) => {
        const value = await get(key, options);
        return fault === 'missing-etag' && key === shardKey('coach', 2) && value ? { ...value, etag: undefined as never } : value;
      });
      f.r2.puts.length = 0; const before = [...f.r2.objects];
      await expect(buildHour(f.r2, 'coach', f.at, config, f.now + MIN, options)).rejects.toThrow();
      expect([...f.r2.objects]).toEqual(before); expect(f.r2.puts).toEqual([]); reads.mockRestore();
    }
    // All before/after shards are checked before a resumed first untouched shard writes.
    for (const fault of ['loaded-total', 'staged-total', 'coordinator-total', 'shard-shape', 'options']) {
      const f = recoveryFixture();
      if (fault === 'loaded-total') for (const s of [1, 2]) f.r2.objects.set(shardKey('coach', s), JSON.stringify({
        ...f.r2.json<ShardState>(shardKey('coach', s)), padding: 'x'.repeat(9 * 1024 * 1024) }));
      if (fault === 'staged-total' || fault === 'coordinator-total') {
        const state = f.r2.json<ShardState>(f.coordinator), reserve = fault === 'staged-total' ? 100 : 2500;
        const other = [1, 2].reduce((n, s) => n + f.r2.objects.get(shardKey('coach', s))!.length, 0);
        f.r2.objects.set(f.coordinator, JSON.stringify({ ...state, padding: 'x'.repeat(REPORT_LIMITS.aggregateBytes - JSON.stringify(state).length - other - reserve) }));
      }
      if (fault === 'shard-shape') f.r2.objects.set(shardKey('coach', 2), JSON.stringify({ ...emptyShard(2), through: null }));
      const before = [...f.r2.objects];
      await expect(buildHour(f.r2, 'coach', f.at, learn, f.now, fault === 'options' ? { ...f.options, shards: NaN } : f.options)).rejects.toThrow();
      expect(f.r2.puts).toEqual([]); expect([...f.r2.objects]).toEqual(before);
    }
    const f = recoveryFixture(), { key, tombstone } = await writeTombstone(f.r2, 'coach', 'unrelated', 'test', T12);
    await interruptRecovery(f);
    f.r2.objects.set(key, JSON.stringify({ ...tombstone, rows_removed: 10, objects_rewritten: 2, done_through: '2026-09-01' }));
    expect((await buildHour(f.r2, 'coach', f.at, learn, f.now + MIN, f.options)).brands.coach!.policies.learning!.credits).toBe(6);
  });

  it('W30.04 fences concurrent and stale helpers and recovers pending work before bounded catch-up inside or outside lookback', async () => {
    for (const stage of ['coordinator', 'shard', 'aggregate', 'complete']) {
      const f = recoveryFixture(), put = f.r2.put.bind(f.r2);
      let release!: () => void, entered!: () => void, held = false;
      const ready = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      const writes = vi.spyOn(f.r2, 'put').mockImplementation(async (key, body, options) => {
        const target = stage === 'coordinator' ? key === f.coordinator && body.includes('"pending":')
          : stage === 'complete' ? key === f.coordinator && !body.includes('"pending":')
            : key === (stage === 'aggregate' ? f.key : shardKey('coach', 1));
        if (target && !held) { held = true; entered(); await wait; }
        return put(key, body, options);
      });
      const stale = buildHour(f.r2, 'coach', f.at, learn, f.now, f.options);
      const rejected = expect(stale).rejects.toThrow('Hourly recovery conflict');
      await ready;
      const winner = await buildHour(f.r2, 'coach', f.at, learn, f.now, f.options);
      expect(winner.brands.coach!.policies.learning!.credits).toBe(6);
      ledger(f.r2, f.visitors.map(v => dec(v, 's', T12 + H + MIN, 'next')), []);
      await buildHour(f.r2, 'coach', { ...f.at, hour: 13 }, learn, f.now + H, f.options);
      const newer = [...f.r2.objects]; release(); await rejected;
      expect([...f.r2.objects]).toEqual(newer); writes.mockRestore();
    }
    // A completed replay can restore all prior numeric bytes and builtAt. Its
    // new generation must still prevent X -> Y -> X from reusing a pinned ETag.
    const aba = recoveryFixture();
    await buildHour(aba.r2, 'coach', aba.at, learn, aba.now, aba.options);
    await buildHour(aba.r2, 'coach', aba.at, learn, aba.now, aba.options);
    const original = aba.r2.json<HourAggregate>(aba.key), originalEtag = (await aba.r2.get(aba.key))!.etag;
    let entered!: () => void, release!: () => void, held = false;
    const ready = new Promise<void>(resolve => { entered = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
    const put = aba.r2.put.bind(aba.r2);
    const writes = vi.spyOn(aba.r2, 'put').mockImplementation(async (key, body, options) => {
      if (key === aba.key && !held) { held = true; entered(); await wait; }
      return put(key, body, options);
    });
    const stale = buildHour(aba.r2, 'coach', aba.at, learn, aba.now + 100, aba.options), refused = expect(stale).rejects.toThrow('Hourly recovery conflict');
    await ready;
    await buildHour(aba.r2, 'coach', aba.at, learn, aba.now + 100, aba.options);
    const restored = await buildHour(aba.r2, 'coach', aba.at, learn, aba.now, aba.options);
    expect({ ...restored, generation: undefined }).toEqual({ ...original, generation: undefined });
    expect((await aba.r2.get(aba.key))!.etag).not.toBe(originalEtag);
    const newer = [...aba.r2.objects]; release(); await refused; expect([...aba.r2.objects]).toEqual(newer); writes.mockRestore();

    for (const outside of [false, true]) for (const aggregateExists of [false, true]) {
      const f = recoveryFixture(); await interruptRecovery(f);
      if (aggregateExists) {
        const p = f.r2.json<ShardState>(f.coordinator).pending!;
        // Finish to its final step, then restore that same active checkpoint to model a lost completion.
        const checkpoint = f.r2.objects.get(f.coordinator)!;
        await buildHour(f.r2, 'coach', f.at, learn, f.now, f.options);
        f.r2.objects.set(f.coordinator, checkpoint); expect(f.r2.objects.get(f.key)).toBe(p.aggregate);
      }
      const now = f.now + (outside ? 72 * H : 0), options = { ...f.options, lookbackHours: 1, maxHours: 0 };
      f.r2.puts.length = 0; const checkpoint = f.r2.objects.get(f.coordinator);
      const quiet = await catchUp(f.r2, 'coach', learn, now, options);
      expect(quiet.built).toEqual([]); expect(quiet.pending).toBe(outside ? 2 : 1);
      expect(f.r2.objects.get(f.coordinator)).toBe(checkpoint);
      expect(f.r2.puts.every(k => k.startsWith('reports/'))).toBe(true);
      const resumed = await catchUp(f.r2, 'coach', learn, now, { ...options, maxHours: 1 });
      expect(resumed.built.map(b => [b.date, b.hour])).toEqual([[ids.date, 12]]);
      expect(resumed.pending).toBe(outside ? 1 : 0); expect(resumed.failed).toEqual([]);
      expect(resumed.reports.deferred).toEqual(outside ? [ids.date] : []);
      expect(f.r2.json<HourAggregate>(f.key).brands.coach!.policies.learning!.credits).toBe(6);
      expect(f.r2.json<ShardState>(f.coordinator).pending).toBeUndefined();
    }
    const blocked = recoveryFixture(); await interruptRecovery(blocked);
    // Retain the original source-dependent v1 refusal. New v2 prepared plans
    // carry their exact target bytes and have their separate recovery positive.
    const legacy = blocked.r2.json<ShardState>(blocked.coordinator);
    legacy.pending!.version = 1; delete legacy.pending!.targets; delete legacy.pending!.configuration;
    blocked.r2.objects.set(blocked.coordinator, JSON.stringify(legacy));
    const raw = blocked.r2.keys(`coach/${ids.date}/12/decision/`)[0]!; blocked.r2.objects.set(raw, blocked.r2.objects.get(raw)! + '\n');
    const before = [...blocked.r2.objects];
    const result = await catchUp(blocked.r2, 'coach', learn, blocked.now + H, { ...blocked.options, lookbackHours: 2, maxHours: 2 });
    expect(result.built).toEqual([]); expect(result.failed).toEqual([{ date: ids.date, hour: 12, error: 'Hourly recovery conflict' }]);
    expect(result.pending).toBe(2); expect([...blocked.r2.objects]).toEqual(before); expect(blocked.r2.puts).toEqual([]);
  });

  it('W30.03 retries bounded day publication independently of completed hours and refuses unsafe recovery inputs', async () => {
    const quiet = { published: [], failed: [], deferred: [] }, key = reportKey('coach', 'coach', ids.date);
    const now = T12 + H + 7 * MIN, options = { shards: 1, lookbackHours: 1, maxHours: 1 };
    const inputBytes = (r2: FakeR2) => [...r2.objects].filter(([k]) => !k.startsWith('reports/'));
    for (const mode of ['new', 'stale', 'lost-ack']) {
      const r2 = new FakeR2();
      ledger(r2, [dec('old', 's0', T12 - H, 'old'), dec('v1', 's1', T12, 'a')], [out('v1', 's1', T12 + MIN, 'click', 'a')]);
      await buildHour(r2, 'coach', { date: ids.date, hour: 11 }, learn, now, options);
      if (mode !== 'new') await runDayReport(r2, ids, learn, null, now);
      const prior = r2.objects.get(key), put = r2.put.bind(r2);
      const failing = vi.spyOn(r2, 'put').mockImplementation(async (target, body, options) => {
        const result = target !== key || mode === 'lost-ack' ? await put(target, body, options) : null;
        if (target === key) throw new Error('synthetic storage detail must not escape');
        return result;
      });
      const first = await catchUp(r2, 'coach', learn, now, options);
      expect(first.built.map(h => h.hour)).toEqual([12]); expect(first.failed).toEqual([]); expect(first.pending).toBe(0);
      expect(first.reports).toEqual({ ...quiet, failed: [{ date: ids.date, error: 'day report publication failed' }] });
      if (mode !== 'lost-ack') expect(r2.objects.get(key)).toBe(prior);
      // Ordinary report callers still receive the computation when only persistence fails.
      if (mode === 'new') expect((await runDayReport(r2, ids, learn, null, now)).counts.decisions).toBe(2);
      failing.mockRestore(); r2.puts.length = 0;
      const frozen = inputBytes(r2), reads = vi.spyOn(r2, 'get');
      const recovered = await catchUp(r2, 'coach', learn, now, options);
      expect(recovered).toEqual({ built: [], failed: [], pending: 0,
        reports: { ...quiet, published: mode === 'lost-ack' ? [] : [ids.date] } });
      expect(r2.puts).toEqual(mode === 'lost-ack' ? [] : [key]);
      expect(inputBytes(r2)).toEqual(frozen);
      expect(reads.mock.calls.every(([k]) => !k.startsWith('coach/') && (!k.includes('/rings/') || k === shardKey('coach', 0)))).toBe(true);
      const report = r2.json<ReturnType<typeof reportFromHours>>(key);
      expect(report.counts).toEqual({ decisions: 2, outcomes: 1, visitors: 2, truncated: false });
      expect(report.policies.find(p => p.name === 'learning')?.credits).toBe(1);
      expect(report.hours).toMatchObject({ source: 'aggregates', built: [11, 12], missing: Array.from({ length: 11 }, (_, h) => h) });
      expect(report.coverage).toMatchObject({ maturity: 'unknown', missingHours: Array.from({ length: 11 }, (_, h) => h), unadvancedHours: [] });
      const stored = [...r2.objects]; r2.puts.length = 0;
      expect(await catchUp(r2, 'coach', learn, now, options)).toEqual({ built: [], failed: [], pending: 0, reports: quiet });
      expect([...r2.objects]).toEqual(stored); expect(r2.puts).toEqual([]); reads.mockRestore();
    }

    const nextDate = '2026-09-04', nextNow = now + 24 * H, nextKey = reportKey('coach', 'coach', nextDate);
    for (const fault of ['summary', 'summary-budget', 'aggregate', 'aggregate-json', 'compatibility', 'vanished', 'put']) {
      const r2 = new FakeR2();
      ledger(r2, [dec('v1', 's1', T12, 'a'), dec('v2', 's2', T12 + 24 * H, 'b')], []);
      await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, nextNow, options);
      const prior = await runDayReport(r2, ids, learn, null, nextNow);
      r2.objects.set(key, JSON.stringify({ ...prior, hours: { ...prior.hours, built: [11] } }));
      await buildHour(r2, 'coach', { date: nextDate, hour: 12 }, learn, nextNow, options);
      const aggregateKey = hourKey('coach', ids.date, 12), prefix = `aggregates/coach/${ids.date}/`;
      if (fault === 'aggregate-json') r2.objects.set(aggregateKey, 'not json');
      if (fault === 'compatibility') {
        const aggregate = r2.json<HourAggregate>(aggregateKey); aggregate.brands.coach!.computation = null;
        r2.objects.set(aggregateKey, JSON.stringify(aggregate));
      }
      const before = inputBytes(r2), saved = r2.objects.get(key), get = r2.get.bind(r2), list = r2.list.bind(r2), put = r2.put.bind(r2);
      const reads = vi.spyOn(r2, 'get').mockImplementation(async (target, range) => {
        if (fault === 'summary' && target === key) throw new Error('synthetic summary outage');
        if (fault === 'aggregate' && target === aggregateKey) return null;
        const value = await get(target, range);
        return fault === 'summary-budget' && target === key && value ? { ...value, size: REPORT_LIMITS.savedBytes + 1 } : value;
      });
      let listed = 0;
      const listings = vi.spyOn(r2, 'list').mockImplementation(async opts =>
        fault === 'vanished' && opts.prefix === prefix && ++listed === 2 ? { objects: [], truncated: false } : list(opts));
      const writes = vi.spyOn(r2, 'put').mockImplementation(async (target, body, options) => {
        if (fault === 'put' && target === key) throw new Error('synthetic write outage');
        return put(target, body, options);
      });
      r2.puts.length = 0;
      const result = await catchUp(r2, 'coach', learn, nextNow, { ...options, lookbackHours: 26, maxHours: 0 });
      expect(result).toEqual({ built: [], failed: [], pending: closedHours(nextNow, 26).length - 2,
        reports: { published: [nextDate], failed: [{ date: ids.date, error: 'day report publication failed' }], deferred: [] } });
      expect(r2.objects.get(key)).toBe(saved); expect(inputBytes(r2)).toEqual(before); expect(r2.puts).toEqual([nextKey]);
      expect(reads.mock.calls.every(([k]) => !k.startsWith('coach/') && (!k.includes('/rings/') || k === shardKey('coach', 0)))).toBe(true);
      expect(listings.mock.calls.every(([opts]) => !opts.prefix.startsWith('coach/'))).toBe(true);
      reads.mockRestore(); listings.mockRestore(); writes.mockRestore();
    }

    // Full-date membership includes hour11 outside this one-hour lookback. Order does not matter;
    // missing, sparse, duplicate, out-of-range and wrongly typed entries cannot establish equality.
    const r2 = new FakeR2();
    ledger(r2, [dec('v1', 's1', T12 - H, 'a'), dec('v2', 's2', T12, 'b')], []);
    await buildHour(r2, 'coach', { date: ids.date, hour: 11 }, learn, now, options);
    await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, now, options);
    const report = await runDayReport(r2, ids, learn, null, now), frozen = inputBytes(r2);
    for (const built of [undefined, [12], [12, 12], Array<unknown>(2), [11, 24], [11, '12'], [10, 12], [12, 11]]) {
      r2.objects.set(key, JSON.stringify({ ...report, hours: { ...report.hours, built } })); r2.puts.length = 0;
      const result = await catchUp(r2, 'coach', learn, now, options), matches = built?.[0] === 12 && built?.[1] === 11;
      expect(result).toEqual({ built: [], failed: [], pending: 0, reports: { ...quiet, published: matches ? [] : [ids.date] } });
      expect(r2.puts).toEqual(matches ? [] : [key]); expect(inputBytes(r2)).toEqual(frozen);
    }
    r2.objects.set(key, JSON.stringify({ ...report, hours: { source: 'ledger', built: [11, 12], missing: [] } })); r2.puts.length = 0;
    expect((await catchUp(r2, 'coach', learn, now, options)).reports).toEqual({ ...quiet, published: [ids.date] });
    expect(r2.puts).toEqual([key]); expect(inputBytes(r2)).toEqual(frozen);

    // Custom lookbacks select only the newest three aggregate-backed dates, then process oldest first.
    const bounded = new FakeR2(), dates = ['2026-09-01', '2026-09-02', ids.date, nextDate];
    for (const date of dates) await buildHour(bounded, 'coach', { date, hour: 12 }, learn, nextNow, options);
    bounded.puts.length = 0;
    const reads = vi.spyOn(bounded, 'get'), before = inputBytes(bounded), selectedKeys = dates.slice(1).map(date => reportKey('coach', 'coach', date));
    const result = await catchUp(bounded, 'coach', learn, nextNow, { ...options, maxHours: 0, lookbackHours: 96 });
    expect(result).toEqual({ built: [], failed: [], pending: 92, reports: { published: dates.slice(1), failed: [], deferred: dates.slice(0, 1) } });
    expect(bounded.puts).toEqual(selectedKeys); expect(inputBytes(bounded)).toEqual(before);
    expect(reads.mock.calls.filter(([k]) => k.startsWith('reports/')).map(([k]) => k)).toEqual(selectedKeys);
    // catchUp runs the erasure-cleanup pass over the shard state before it reads the
    // coordinator for an interrupted hour (src/learn/hourly.ts:1156 then :1160; the pass
    // itself reads shard 0 at :893), so the coordinator object is read twice per run and
    // no other aggregate object is touched.
    expect(reads.mock.calls.filter(([k]) => k.startsWith('aggregates/')).map(([k]) => k)).toEqual([shardKey('coach', 0), shardKey('coach', 0), ...dates.slice(1).map(date => hourKey('coach', date, 12))]);
    reads.mockClear(); bounded.puts.length = 0;
    expect((await catchUp(bounded, 'coach', learn, nextNow, { ...options, maxHours: 0, lookbackHours: 96 })).reports)
      .toEqual({ ...quiet, deferred: dates.slice(0, 1) });
    // Same two coordinator reads as above (hourly.ts:1156 cleanup, :1160 coordinator).
    expect(bounded.puts).toEqual([]); expect(reads.mock.calls.map(([k]) => k)).toEqual([shardKey('coach', 0), shardKey('coach', 0), ...selectedKeys]); reads.mockRestore();
  });

  it('W22.02 preserves prior progress on incomplete hourly input and retries one pending hour after restoration', async () => {
    const now = T12 + H + 7 * MIN, options = { shards: 1, lookbackHours: 1, maxHours: 1 };
    const rawPrefix = `${hourPrefix('coach', T12)}/`, inventory = `aggregates/coach/${ids.date}/`;
    for (const fault of ['missing-decision', 'missing-outcome', 'malformed-decision', 'malformed-outcome',
      'raw-cursor-missing', 'raw-cursor-repeat', 'inventory-cursor-missing', 'inventory-cursor-repeat', 'work']) {
      const r2 = new FakeR2();
      ledger(r2, [dec('old', 's0', T12 - H, 'old'), dec('v1', 's1', T12, 'a'), dec('v2', 's2', T12 + MIN, 'b')],
        [out('v2', 's2', T12 + 2 * MIN, 'click', 'b')]);
      await buildHour(r2, 'coach', { date: ids.date, hour: 11 }, learn, now, options);
      await runDayReport(r2, ids, learn, null, now); r2.puts.length = 0;
      const stream = fault.endsWith('outcome') ? 'outcome' : 'decision';
      const target = r2.keys(rawPrefix).filter(key => key.includes(`/${stream}/`)).at(-1)!, original = r2.objects.get(target)!;
      if (fault.startsWith('malformed-')) r2.objects.set(target, original + 'not json\n');
      const before = [...r2.objects], get = r2.get.bind(r2), list = r2.list.bind(r2);
      const reads = vi.spyOn(r2, 'get').mockImplementation(async (key, range) =>
        fault.startsWith('missing-') && key === target ? null : get(key, range));
      let pages = 0;
      const listing = vi.spyOn(r2, 'list').mockImplementation(async opts => {
        if (fault === 'work' && opts.prefix === rawPrefix) {
          return { objects: Array<{ key: string }>(REPORT_LIMITS.work).fill({ key: target }), truncated: false };
        }
        if (!fault.includes('cursor') || opts.prefix !== (fault.startsWith('inventory-') ? inventory : rawPrefix)) return list(opts);
        if (++pages > 2) throw new Error('Synthetic pagination failed to terminate');
        return { objects: (await list(opts)).objects.slice(0, 1), truncated: true,
          ...(fault.endsWith('repeat') ? { cursor: 'same' } : {}) };
      });
      const error = fault.startsWith('missing-') ? ReportUnavailableError : fault === 'work' ? ReportBudgetExceeded : ReportInputError;
      if (!fault.startsWith('inventory-')) {
        const attempt = buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, now, options);
        if (fault === 'work') await expect(attempt).rejects.toMatchObject({ budget: 'work', observed: REPORT_LIMITS.work + 1 });
        else await expect(attempt).rejects.toThrow(error);
        pages = 0;
        const failed = await catchUp(r2, 'coach', learn, now, options);
        expect(failed.built).toEqual([]); expect(failed.pending).toBe(1);
        expect(failed.failed).toEqual([{ date: ids.date, hour: 12,
          error: fault.startsWith('missing-') ? 'report unavailable' : fault === 'work' ? 'report budget exceeded' : 'invalid raw report input' }]);
      } else await expect(catchUp(r2, 'coach', learn, now, options)).rejects.toThrow(ReportInputError);
      if (fault.includes('cursor')) expect(pages).toBe(fault.endsWith('repeat') ? 2 : 1);
      expect(r2.puts).toEqual([]); expect([...r2.objects]).toEqual(before);
      reads.mockRestore(); listing.mockRestore(); r2.objects.set(target, original);
      const visited: Array<[string, string | undefined]> = [];
      const paged = vi.spyOn(r2, 'list').mockImplementation(async opts => {
        const page = await list(opts);
        if (opts.prefix !== rawPrefix && opts.prefix !== inventory) return page;
        const cursor = (opts as { cursor?: string }).cursor; visited.push([opts.prefix, cursor]);
        return cursor ? { ...page, objects: page.objects.slice(1) }
          : { ...page, objects: page.objects.slice(0, 1), truncated: true, cursor: 'next' };
      });
      const recovered = await catchUp(r2, 'coach', learn, now, options);
      expect(recovered).toEqual({ built: [{ date: ids.date, hour: 12, decisions: 2, outcomes: 1, objects: 3, truncated: false }], failed: [], pending: 0,
        reports: { published: [ids.date], failed: [], deferred: [] } });
      const hour = r2.json<HourAggregate>(hourKey('coach', ids.date, 12));
      expect(hour.ringsFolded).toBe(true); expect(hour.brands.coach!.policies.learning!.credits).toBe(1);
      expect(r2.json<{ counts: unknown }>(reportKey('coach', 'coach', ids.date)).counts)
        .toEqual({ decisions: 3, outcomes: 1, visitors: 3, truncated: false });
      for (const prefix of [rawPrefix, inventory]) expect(visited).toContainEqual([prefix, 'next']);
      const stored = [...r2.objects], puts = [...r2.puts];
      expect(await catchUp(r2, 'coach', learn, now, options)).toEqual({ built: [], failed: [], pending: 0, reports: { published: [], failed: [], deferred: [] } });
      expect([...r2.objects]).toEqual(stored); expect(r2.puts).toEqual(puts); paged.mockRestore();
    }
  });

  it('W22.01 folds exact retries before ring caps and refuses loaded or retained ambiguity within the declared write boundary', async () => {
    const a = dec('v', 's', T12 + 59 * MIN, 'a'), b = dec('v', 's', a.ts + 1, 'b');
    const event = outcomeFromAction({ type: 'content_click', userId: 'v', sessionId: 's', timestamp: a.ts + 1000,
      eventId: 'hour-event', data: { contentId: 'a', decisionId: a.decision_id } }, 'coach')!;
    const clean = new FakeR2(); ledger(clean, [a, b], [event]);
    const repeated = new FakeR2(); ledger(repeated, [a, b], [event]);
    repeated.objects.set(`${hourPrefix('coach', a.ts)}/decision/${ts36(a.ts)}-${ts36(b.ts)}-retry.ndjson`, JSON.stringify({ ...b,
      _ledger_delivery: { id: '00000000-0000-4000-8000-000000000001', ordinal: 1 } }));
    repeated.objects.set(`${hourPrefix('coach', a.ts)}/outcome/${ts36(event.ts)}-${ts36(event.ts)}-retry.ndjson`, JSON.stringify(event));
    const opts = { shards: 1, ringCap: 2 }, options = { pending: 0, missing: [] as number[] };
    const normal = await buildHour(clean, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts);
    const hour = await buildHour(repeated, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts);
    const report = reportFromHours([hour], ids, learn, NOW, options), expected = reportFromHours([normal], ids, learn, NOW, options);
    expect(report.counts).toEqual({ ...expected.counts, duplicates: { decisions: 1, outcomes: 1 } });
    expect(report.policies).toEqual(expected.policies); expect(report.grids).toEqual(expected.grids); expect(report.holdout).toEqual(expected.holdout);
    expect(report.policies[0]!.credits).toBe(1);
    expect(repeated.json<ShardState>(shardKey('coach', 0)).rings.v!.map(row => row.id)).toEqual([a.decision_id, b.decision_id]);
    const state = repeated.objects.get(shardKey('coach', 0));
    const replay = await buildHour(repeated, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts);
    expect(replay.brands.coach!.policies.learning!.credits).toBe(1); expect(ringContents(repeated.objects.get(shardKey('coach', 0)))).toEqual(ringContents(state));
    expect(await loadHourRecords(repeated, 'coach', ids.date, 12, 1)).toMatchObject({ objects: 5, read: 1, truncated: true });
    for (const conflict of [{ ...b, explain: { ...b.explain, logical: 'changed' } }, { ...b, tenant: 'other' },
      { ...b, _ledger_delivery: { id: 'bad', ordinal: 1 } }]) {
      const bad = new FakeR2(); ledger(bad, [a, b, conflict as DecisionRecord], [event]);
      await expect(buildHour(bad, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts)).rejects.toThrow(ReportInputError);
      expect(bad.puts).toEqual([]); expect(bad.objects.has(hourKey('coach', ids.date, 12))).toBe(false);
    }
    const tooLarge = new FakeR2(); tooLarge.objects.set(`${hourPrefix('coach', T12)}/decision/large.ndjson`, ' '.repeat(REPORT_LIMITS.rawBytes + 1));
    await expect(buildHour(tooLarge, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts)).rejects.toMatchObject({ budget: 'objectBytes' });
    expect(tooLarge.puts).toEqual([]);
    const carry = dec('old', 's', T12 - MIN, 'carry');
    for (const overlap of [false, true]) {
      const bad = new FakeR2(), before = { ...emptyShard(0), seenDate: ids.date, through: T12 - H,
        rings: { old: overlap ? [compactOf(carry).entry] : [compactOf(carry).entry, compactOf(carry).entry] } };
      bad.objects.set(shardKey('coach', 0), JSON.stringify(before));
      if (overlap) ledger(bad, [{ ...carry, visitor_id: 'new', ts: T12 + 1 }], []);
      await expect(buildHour(bad, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts)).rejects.toThrow(ReportInputError);
      expect(bad.puts).toEqual([]); expect(bad.json<ShardState>(shardKey('coach', 0))).toEqual(before);
    }
    // A later shard collision now refuses before any shard's durable progress.
    const partial = new FakeR2(), firstVisitor = ['a', 'b'].find(v => shardOf(v, 2) === 0)!, secondVisitor = ['a', 'b'].find(v => shardOf(v, 2) === 1)!;
    const earlier = { ...dec(firstVisitor, 's', T12 - MIN, 'earlier'), decision_id: 'legacy-shared-id' }, later = { ...compactOf(earlier).entry, visitor_id: secondVisitor };
    partial.objects.set(shardKey('coach', 0), JSON.stringify({ ...emptyShard(0), seenDate: ids.date, through: T12 - H, rings: { [firstVisitor]: [compactOf(earlier).entry] } }));
    partial.objects.set(shardKey('coach', 1), JSON.stringify({ ...emptyShard(1), seenDate: ids.date, through: T12 - H, rings: { [secondVisitor]: [later] } }));
    ledger(partial, [dec(firstVisitor, 's', T12 + 1, 'fresh')], []);
    await expect(buildHour(partial, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 2 })).rejects.toThrow(ReportInputError);
    expect(partial.puts).toEqual([]); expect(partial.objects.has(hourKey('coach', ids.date, 12))).toBe(false);
    const oversizedHistory = new FakeR2(), template = compactOf(carry).entry;
    const history = Array.from({ length: REPORT_LIMITS.rawBytes / 2048 + 1 }, (_, n) => ({ ...template,
      id: template.id + 'x'.repeat(2048 - template.id.length - String(n).length) + n }));
    const initial = JSON.stringify({ ...emptyShard(0), seenDate: ids.date, through: T12 - H, rings: { old: history } });
    oversizedHistory.objects.set(shardKey('coach', 0), initial);
    await expect(buildHour(oversizedHistory, 'coach', { date: ids.date, hour: 12 }, learn, NOW, opts))
      .rejects.toMatchObject({ budget: 'aggregateBytes' });
    expect(oversizedHistory.puts).toEqual([]); expect(oversizedHistory.objects.get(shardKey('coach', 0))).toBe(initial);
  });

  it('W22.01 preserves erasure-safe duplicate counts and historical computation bases through stored day and window reads', async () => {
    const old = dec('v', 's', T12, 'old'), fresh = dec('v', 's', T12 + 100, 'fresh'), foreign = { ...dec('other', 's', T12 + 101, 'foreign'), brand: 'other' };
    const event = (row: DecisionRecord, ts: number, eventId: string) => outcomeFromAction({ type: 'content_click', userId: row.visitor_id, sessionId: 's', timestamp: ts,
      eventId, data: { contentId: row.item_id, decisionId: row.decision_id } }, 'coach', row.brand)!;
    const events = [event(old, T12 + 1, 'old-event'), event(fresh, T12 + 200, 'fresh-event'), event(foreign, T12 + 201, 'other-event')];
    const r2 = new FakeR2(); ledger(r2, [old, old, fresh, fresh, foreign, foreign], events.flatMap(row => [row, { ...row }]));
    await writeTombstone(r2, 'coach', 'v', 'test', T12 + 50);
    const raw = await runReport(r2, ids, learn, null, NOW), options = { pending: 1, missing: [] as number[] };
    const hour = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1 });
    const report = reportFromHours([hour], ids, learn, NOW, options);
    expect(raw.counts).toEqual({ decisions: 1, outcomes: 1, visitors: 1, truncated: false, duplicates: { decisions: 1, outcomes: 1 } });
    expect(report.counts).toEqual(raw.counts); expect(report.erasures!.rows_hidden).toBe(2); expect(raw.erasures!.rows_hidden).toBe(2);
    expect(r2.json<ShardState>(shardKey('coach', 0)).rings.v!.map(row => row.id)).toEqual([fresh.decision_id]);
    // The recorded computation basis is version 4: it states each slot's measurement
    // basis alongside reward/objective/tau (src/learn/report.ts:119, type at :71, :75;
    // document 35 §5 W26 "defined served/rendered/viewable unit"). Versions 1-3 stay
    // readable as history, which the loop below still proves.
    expect(report.computation!.version).toBe(4); expect(diagnosticDayReport(report).counts).toEqual(report.counts);
    const canonical = canonicalReportJson(report); r2.objects.set(reportKey('coach', 'coach', ids.date), canonical);
    expect((JSON.parse(canonical) as { _summary: { counts: unknown } })._summary.counts).toEqual(report.counts);
    expect((await windowReport(r2, { tenant: 'coach', brand: 'coach', from: ids.date, to: ids.date })).slots.hero!.compatibility.status).toBe('compatible');
    for (const version of [1, 2] as const) {
      // A retained v1-v3 record cannot carry a per-slot measurement basis: the key is
      // admitted only at version 4 (src/learn/report.ts:104-108, :115), so an honest
      // legacy fixture drops it rather than relabelling old accumulators.
      const legacy = structuredClone(hour); legacy.brands.coach!.computation!.version = version;
      legacy.brands.coach!.computation!.slots = legacy.brands.coach!.computation!.slots.map(slot => { const copy = { ...slot }; delete copy.measurementBasis; return copy; });
      delete legacy.brands.coach!.duplicates;
      const bytes = JSON.stringify(legacy), historical = reportFromHours([legacy], ids, learn, NOW, options);
      expect(historical.computation!.version).toBe(version); expect(historical.counts.duplicates).toBeUndefined(); expect(JSON.stringify(legacy)).toBe(bytes);
      const newer = { ...hour, hour: 13, from: hour.from + H, to: hour.to + H };
      expect(() => reportFromHours([legacy, newer], ids, learn, NOW, options)).toThrow(ReportUnavailableError);
      const day = { ...historical, date: '2026-09-02' }, key = reportKey('coach', 'coach', day.date), saved = canonicalReportJson(day);
      r2.objects.set(key, saved);
      const window = await windowReport(r2, { tenant: 'coach', brand: 'coach', from: day.date, to: ids.date });
      expect(window.slots.hero).toMatchObject({ arms: [], compatibility: { status: 'mixed', reasons: ['mixed_basis'] } });
      expect(r2.objects.get(key)).toBe(saved);
    }
    const invalid = structuredClone(hour); invalid.brands.coach!.duplicates = { decisions: -1, outcomes: 0 };
    expect(() => reportFromHours([invalid], ids, learn, NOW, options)).toThrow(ReportUnavailableError);
    const erased = new FakeR2(), oldRing = compactOf(old).entry;
    erased.objects.set(shardKey('coach', 0), JSON.stringify({ ...emptyShard(0), seenDate: ids.date, through: T12 - H, rings: { v: [oldRing, oldRing] } }));
    await writeTombstone(erased, 'coach', 'v', 'test', old.ts); ledger(erased, [fresh], [events[1]!]);
    expect((await buildHour(erased, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1 })).brands.coach!.policies.learning!.credits).toBe(1);
  });

  it('W26.02 preserves correlated raw and hourly counts while withholding ambiguous targets and mixed computation bases', async () => {
    const config: LearnConfig = { holdout: learn.holdout, slots: { hero: { reward: 'click' }, rail: { reward: 'click' } } };
    const first = dec('v1', 's1', T12 + 59 * MIN, 'A');
    const later = { ...dec('v1', 's1', first.ts + 1, 'A'), page: 'other', position: 1 };
    const rows = [first, later, dec('v1', 's1', first.ts + 2, 'A', { slot: 'rail' }),
      dec('v2', 's2', first.ts, 'A', { arm: 'default' })];
    const events = [0, 1, 2].map(n => ({ ...out('v1', 's1', T12 + (61 + n) * MIN, 'click', 'A'),
      decision_id: n === 2 ? first.decision_id + ':absent' : first.decision_id }));
    const r2 = new FakeR2(); ledger(r2, rows, events);
    expect([...r2.objects.values()].flatMap(body => body.trim().split('\n')).map(line => JSON.parse(line))
      .filter(row => row.outcome_id).map(row => row.decision_id)).toEqual(events.map(row => row.decision_id));
    const hours = [await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, config, NOW),
      await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, config, NOW)];
    const options = { pending: 0, missing: [] as number[] }, folded = reportFromHours(hours, ids, config, NOW, options);
    const raw = await runReport(r2, ids, config, null, NOW);
    // Version 4 records the per-slot measurement basis (src/learn/report.ts:119, :75;
    // document 35 §5 W26), and the raw and folded paths must record the same one.
    expect(raw.computation!.version).toBe(4); expect(folded.computation!.version).toBe(4);
    expect(folded.counts).toEqual(raw.counts); expect(raw.counts).toEqual({ decisions: 4, outcomes: 3, visitors: 2, truncated: false });
    expect(folded.policies).toEqual(raw.policies); expect(folded.grids).toEqual(raw.grids);
    expect(folded.holdout).toEqual(raw.holdout); expect(folded.exploration).toEqual(raw.exploration);
    expect(raw.policies.every(p => p.credits === 2)).toBe(true);
    expect(raw.holdout.hero).toEqual([{ arm: 'default', decisions: 1, credited: 0, creditedPerDecision: 0, rate: 0 },
      { arm: 'personalized', decisions: 2, credited: 2, creditedPerDecision: 1, rate: 1 }]);
    expect(raw.holdout.rail![0]).toMatchObject({ decisions: 1, credited: 0 });
    const persisted = r2.json<ShardState>(shardKey('coach', shardOf('v1'))).rings.v1!;
    expect(persisted.find(row => row.id === first.decision_id)).toMatchObject({ brand: 'coach', tenant: 'coach', visitor_id: 'v1' });

    for (const duplicate of [first, { ...first, arm: 'default' as const }, { ...first, brand: 'other' }]) {
      const ambiguous = new FakeR2(); ledger(ambiguous, [...rows, duplicate], [events[0]!]);
      if (duplicate !== first) {
        await expect(buildHour(ambiguous, 'coach', { date: ids.date, hour: 12 }, config, NOW)).rejects.toThrow(ReportInputError);
        await expect(runReport(ambiguous, ids, config, [], NOW)).rejects.toThrow(ReportInputError); expect(ambiguous.puts).toEqual([]); continue;
      }
      const aggregate = [await buildHour(ambiguous, 'coach', { date: ids.date, hour: 12 }, config, NOW),
        await buildHour(ambiguous, 'coach', { date: ids.date, hour: 13 }, config, NOW)];
      const blocked = reportFromHours(aggregate, ids, config, NOW, options);
      const rawBlocked = await runReport(ambiguous, ids, config, [], NOW);
      expect(blocked.policies.every(p => p.credits === 1)).toBe(true);
      expect(rawBlocked.policies[0]!.credits).toBe(1); expect(blocked.counts).toEqual(rawBlocked.counts);
    }
    const unrelated = new FakeR2();
    ledger(unrelated, [{ ...first, visitor_id: 'foreign', arm: 'default' }, ...rows], [events[0]!]);
    await expect(runReport(unrelated, ids, config, [], NOW)).rejects.toThrow(ReportInputError);
    unrelated.objects.clear();
    ledger(unrelated, [{ ...first, visitor_id: 'foreign', arm: 'default', decision_id: first.decision_id.replace(':v1:', ':foreign:') }, ...rows], [events[0]!]);
    const scoped = await runReport(unrelated, ids, config, [], NOW);
    expect(scoped.policies[0]!.credits).toBe(1);
    expect(scoped.holdout.hero!.find(row => row.arm === 'personalized')).toMatchObject({ credited: 1 });
    expect(scoped.holdout.hero!.find(row => row.arm === 'default')).toMatchObject({ credited: 0 });
    expect(scoped.grids.hero!.learning!.items.A!['*']!.s).toBeGreaterThan(0);

    // A retained old fixture computes the unchanged absent-ID policy. Its saved
    // basis1/counts remain old; the reader neither recomputes nor relabels them.
    const oldStore = new FakeR2();
    const legacyEvents = events.slice(0, 2).map(event => { const row: OutcomeRecord = { ...event }; delete row.decision_id; return row; });
    ledger(oldStore, rows, legacyEvents);
    const oldHours = [await buildHour(oldStore, 'coach', { date: ids.date, hour: 12 }, config, NOW),
      await buildHour(oldStore, 'coach', { date: ids.date, hour: 13 }, config, NOW)];
    // As above: version 1 records carry no per-slot measurement basis (report.ts:104-108).
    for (const hour of oldHours) {
      hour.brands.coach!.computation!.version = 1;
      hour.brands.coach!.computation!.slots = hour.brands.coach!.computation!.slots.map(slot => { const copy = { ...slot }; delete copy.measurementBasis; return copy; });
    }
    const oldBytes = JSON.stringify(oldHours), old = reportFromHours(oldHours, ids, config, NOW, options);
    expect(old.computation!.version).toBe(1); expect(old.policies[0]!.credits).toBe(4);
    expect(JSON.stringify(oldHours)).toBe(oldBytes);
    expect(() => reportFromHours([oldHours[0]!, hours[1]!], ids, config, NOW, options)).toThrow(ReportUnavailableError);
    const previous = { ...old, date: '2026-09-02' };
    r2.objects.set(reportKey('coach', 'coach', previous.date), canonicalReportJson(previous));
    expect((await windowReport(r2, { tenant: 'coach', brand: 'coach', from: previous.date, to: previous.date })).slots.hero!.compatibility.status).toBe('compatible');
    const mixed = await windowReport(r2, { tenant: 'coach', brand: 'coach', from: previous.date, to: ids.date });
    expect(mixed.slots.hero).toMatchObject({ arms: [], comparisons: [], compatibility: { status: 'mixed', reasons: ['mixed_basis'] } });
    expect(r2.objects.get(reportKey('coach', 'coach', previous.date))).toBe(canonicalReportJson(previous));
  });

  it('W20.05 counts the first ranked ordinal equally in raw and hourly reports', async () => {
    const page: SlotStrategy[] = [{ slot: 'hero', take: 4, weights: { topic: 1 }, pinnedPieceIds: ['b', 'a'] }, { slot: 'full', take: 1, weights: {}, pinnedPieceIds: ['e'] }];
    const config: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click', gamma: 0, exploration: { mode: 'rotation', share: 1, floor: 50 } } } };
    const state = emptyStats();
    for (let n = 0; n < 60; n++) recordExposure(state, 'c', cell, T12, DEFAULT_STATS);
    const snapshot = buildSnapshot(state, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', T12, DEFAULT_STATS);
    const input = { tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const, nowMs: T12,
      pieces: [...'abcde'].map(id => ({ id, customerContentId: id, title: id, type: 'editorial', tags: { topic: [id] }, slotTypes: ['hero', 'full'], lifecycle: { status: 'live' as const } })), slots: page,
      affinity: { dims: { topic: { c: 1, d: 0.5 } } }, cell, arm: 'personalized' as const,
      versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'prefix',
      learning: { snapshots: { hero: snapshot }, gammaOf: () => 0, exploreOf: () => config.slots!.hero!.exploration! } };
    const active = decideContent(input), quiet = decideContent({ ...input, nowMs: T12 + MIN, learning: null });
    const old = dec('v2', 's2', T12 + 2 * MIN, 'legacy', { explored: true });
    const records = [...active.records, ...quiet.records, old];
    expect(active.records.map(r => [r.position, r.ranking_position, r.explored])).toEqual([[0, undefined, false], [1, undefined, false], [2, 0, true], [3, 1, false], [0, undefined, false]]);
    const r2 = new FakeR2(); ledger(r2, records, []);
    const aggregate = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, config, NOW);
    const folded = reportFromHours([aggregate], ids, config, NOW, { pending: 0, missing: [] });
    const raw = buildReport({ ...ids, learning, reporting: policiesOf(config).slice(1), learn: config, decisions: records, outcomes: [], now: NOW, truncated: false });
    expect(folded.exploration).toEqual(raw.exploration);
    expect(raw.exploration.find(r => r.slot === 'hero')).toMatchObject({ decisions: 3, explored: 2 });
    expect(raw.exploration.find(r => r.slot === 'full')).toMatchObject({ decisions: 0, explored: 0 });
    expect(folded.counts).toEqual(raw.counts); expect(folded.grids).toEqual(raw.grids); expect(folded.policies).toEqual(raw.policies);
    const tail = active.records[2]!;
    for (const malformed of [{ ...tail, ranking_position: undefined }, { ...tail, ranking_position: -1 }, { ...tail, ranking_position: 0.5 },
      { ...tail, ranking_position: 50 }, { ...tail, ranking_position: 3 }, { ...active.records[0]!, ranking_position: 0 }]) {
      expect(() => explorationOpportunity(malformed)).toThrow(ReportInputError);
      expect(() => compactOf(malformed)).toThrow(ReportInputError);
      expect(() => buildReport({ ...ids, learning, reporting: [], learn: config, decisions: [malformed], outcomes: [], now: NOW, truncated: false })).toThrow(ReportInputError);
    }
    expect(explorationOpportunity({ ...old, ranking_position: 99 })).toBe(true);
    const legacyCompact = compactOf(old); delete legacyCompact.explorationOpportunity;
    expect(foldDecisions([legacyCompact], [], DEFAULT_STATS).coach!.exploration.hero).toEqual({ decisions: 1, explored: 1 });
  });

  it('W31.01 captures carry-in and empty-hour bases and refuses unknown mixed or relabeled accumulators before day publication', async () => {
    const r2 = new FakeR2(); ledger(r2, decisions, outcomes);
    const aggs = await twoHours(r2), options = { pending: 0, missing: [] as number[] };
    const canonical = await runDayReport(r2, ids, learn, null, NOW), key = reportKey(ids.tenant, ids.brand, ids.date), before = r2.objects.get(key), puts = r2.puts.length;
    expect(aggs[1]!.brands.coach!.computation!.slots.map(s => s.slot)).toEqual(['hero', 'story']);
    const ordered = structuredClone(aggs);
    ordered[1]!.brands.coach!.computation!.policies.reverse(); ordered[1]!.brands.coach!.computation!.slots.reverse();
    ordered[1]!.brands.coach!.policies = Object.fromEntries(Object.entries(ordered[1]!.brands.coach!.policies).reverse());
    expect(reportFromHours(ordered, ids, learn, NOW, options)).toEqual(reportFromHours(aggs, ids, learn, NOW, options));
    const estimate = { ...learn, stats: { ...DEFAULT_STATS, n0: 30, nMin: 2 } };
    expect(reportFromHours(aggs, ids, estimate, NOW, options).computation).toEqual(canonical.computation);
    for (const change of ['absent', 'profile', 'policy', 'slot', 'duplicate'] as const) {
      const altered = structuredClone(aggs[1]!); const b = altered.brands.coach!;
      if (change === 'absent') delete b.computation;
      if (change === 'profile') b.computation!.profile.ringCap = 199;
      if (change === 'policy') { b.policies.learning!.policy.credit = 'first'; b.computation!.policies.find(p => p.role === 'learning')!.policy.credit = 'first'; }
      if (change === 'slot') b.computation!.slots[0]!.objective = 'revenue';
      if (change === 'duplicate') b.computation!.policies.push(b.computation!.policies[0]!);
      r2.objects.set(hourKey(ids.tenant, ids.date, 13), JSON.stringify(altered));
      await expect(runDayReport(r2, ids, learn, null, NOW)).rejects.toBeInstanceOf(ReportUnavailableError);
      expect(r2.objects.get(key)).toBe(before); expect(r2.puts).toHaveLength(puts);
    }
    for (const changed of [{ ...learn, stats: { ...DEFAULT_STATS, tauLearnMs: DEFAULT_STATS.tauLearnMs + 1 } },
      { ...learn, slots: { ...learn.slots, hero: { reward: 'purchase' as const } } }]) {
      expect(() => reportFromHours(aggs, ids, changed, NOW, options)).toThrow(ReportUnavailableError);
    }
    r2.objects.set(hourKey(ids.tenant, ids.date, 13), JSON.stringify(aggs[1]));
    const empty = await buildHour(r2, ids.tenant, { date: ids.date, hour: 14 }, learn, NOW);
    expect(empty.brands.coach!.decisions).toBe(0); expect(empty.brands.coach!.computation!.policies).toHaveLength(5);
    expect(() => reportFromHours([...aggs, empty], ids, learn, NOW, options)).not.toThrow();
    const carry = new FakeR2(); ledger(carry, [dec('v', 's', T12 + 59 * MIN, 'a', { arm: 'default' })], [out('v', 's', T12 + 61 * MIN, 'click', 'a')]);
    await twoHours(carry);
    const later = carry.json<HourAggregate>(hourKey(ids.tenant, ids.date, 13));
    expect(later.brands.coach!.policies.learning!.armCredits['hero|default']).toBe(1);
    expect(later.brands.coach!.computation!.slots[0]!.slot).toBe('hero');
    const onlyCarry = reportFromHours([later], ids, learn, NOW, options);
    carry.objects.set(key, JSON.stringify(onlyCarry));
    const w = await windowReport(carry, { ...ids, from: ids.date, to: ids.date });
    expect(w.slots.hero).toMatchObject({ arms: [], compatibility: { status: 'unknown', reasons: ['unrepresented_counts'] } });
    const invalid = new FakeR2();
    await expect(buildHour(invalid, ids.tenant, { date: ids.date, hour: 12 }, learn, NOW, { ringCap: 0 })).rejects.toThrow();
    expect(invalid.puts).toEqual([]);
    const invalidRow = new FakeR2(); ledger(invalidRow, [dec('v', 's', T12, 'a', { arm: 'default', slot: 'x'.repeat(257) })], []);
    await expect(buildHour(invalidRow, ids.tenant, { date: ids.date, hour: 12 }, learn, NOW)).rejects.toThrow(ReportInputError);
    expect(invalidRow.puts).toEqual([]);
    for (const rows of [Array.from({ length: 300 }, (_, i) => dec('v', 's', T12 + i, 'a', { arm: 'default', slot: 's' + i + 'x'.repeat(150) }))]) {
      const limited = new FakeR2(); ledger(limited, rows, []);
      const hour = await buildHour(limited, ids.tenant, { date: ids.date, hour: 12 }, learn, NOW);
      expect(hour.brands.coach!.decisions).toBe(rows.length); expect(hour.brands.coach!.computation).toBeNull();
      expect(limited.json<HourAggregate>(hourKey(ids.tenant, ids.date, 12)).brands.coach!.decisions).toBe(rows.length);
      expect(limited.json<ShardState>(shardKey(ids.tenant, shardOf('v'))).through).toBe(T12);
      expect(() => reportFromHours([hour], ids, learn, NOW, options)).toThrow(ReportUnavailableError);
    }
    const union = new FakeR2();
    ledger(union, Array.from({ length: 400 }, (_, i) => dec('v', 's', T12 + Math.floor(i / 200) * H + i, 'a', { arm: 'default', slot: 's' + i + 'x'.repeat(150) })), []);
    const bounded = await twoHours(union);
    expect(bounded.every(h => h.brands.coach!.computation !== null)).toBe(true);
    expect(bounded.map(h => h.brands.coach!.computation!.slots.length)).toEqual([200, 200]);
    union.objects.set(key, before!); const previousPuts = union.puts.length;
    await expect(runDayReport(union, ids, learn, null, NOW)).rejects.toMatchObject({ budget: 'summaryBytes' });
    expect(union.objects.get(key)).toBe(before); expect(union.puts).toHaveLength(previousPuts);
  });
  it('W32.04 stores hourly summary and full fields together and refuses oversized summaries before canonical replacement', async () => {
    const r2 = new FakeR2(); ledger(r2, decisions, outcomes); await twoHours(r2);
    const report = await runDayReport(r2, ids, learn, null, NOW), key = reportKey(ids.tenant, ids.brand, ids.date), body = r2.objects.get(key)!;
    const stored = JSON.parse(body), summary = stored._summary; delete stored._summary;
    expect(stored).toEqual(report); expect(summary.coverage).toEqual(report.coverage); expect(summary.hours).toEqual(report.hours);
    expect(summary.counts).toEqual(report.counts); expect(summary).not.toHaveProperty('grids');
    const window = await windowReport(r2, { ...ids, from: ids.date, to: ids.date });
    expect(window.coverage.days[0]!.coverage).toEqual(report.coverage);
    expect(window.slots.hero!.arms.map(({ arm, decisions, credited }) => ({ arm, decisions, credited }))).toEqual(summary.holdout.hero);
    expect(r2.puts.filter(k => k === key)).toEqual([key]);
    const a = r2.json<HourAggregate>(hourKey(ids.tenant, ids.date, 12));
    a.brands.coach!.arms.hero = Object.fromEntries(Array.from({ length: 700 }, (_, i) => ['arm'+i+'x'.repeat(100), 1]));
    r2.objects.set(hourKey(ids.tenant, ids.date, 12), JSON.stringify(a));
    await expect(runDayReport(r2, ids, learn, null, NOW)).rejects.toMatchObject({ budget: 'summaryBytes' });
    expect(r2.objects.get(key)).toBe(body); expect(r2.puts.filter(k => k === key)).toEqual([key]);
  });
  it('W32.03 admits bounded aggregate days before merging and refuses unsafe loads or publication without partial effects', async () => {
    const r2 = new FakeR2(); ledger(r2, decisions, outcomes);
    const aggs = await twoHours(r2), loaded = await loadHours(r2, ids.tenant, ids.date, NOW);
    const options = { pending: 0, missing: loaded.missing };
    const before = JSON.stringify(aggs), report = reportFromHours(aggs, ids, learn, NOW, options);
    expect(await runDayReport(r2, ids, learn, null, NOW)).toEqual(report);
    const a = aggs[0]!, b = aggs[1]!, policy = a.brands.coach!.policies.learning!;
    const merged = mergeStats(policy.stats.hero!, b.brands.coach!.policies.learning!.stats.hero!, DEFAULT_STATS.tauLearnMs);
    expect(report.grids.hero!.learning).toEqual(buildSnapshot(merged, { tenant: ids.tenant, brand: ids.brand, slot: 'hero' }, 'click', NOW, DEFAULT_STATS));
    expect(report.policies[0]!.credits).toBeGreaterThan(0); expect(JSON.stringify(aggs)).toBe(before);
    const construct = (items: typeof merged.items): HourAggregate => ({ ...a, brands: { coach: { ...a.brands.coach!, computation: computationBasis(learn,
      [{ name: 'learning', role: 'learning', policy: policy.policy }], ['hero', 'story'], a.brands.coach!.computation!.profile), policies: {
      learning: { ...policy, stats: { hero: { ...emptyStats(), items } } },
    } } } });
    const c = { n: { s: 1, t: T12 }, s: {} };
    const parentOnly = construct({ item: { 'c=a|v=b|s=c|r=d|a=e': c } });
    expect(Object.keys(reportFromHours([parentOnly], ids, learn, NOW, options).grids.hero!.learning!.slotRates)).toHaveLength(6);
    const overCells = construct(Object.fromEntries(Array.from({ length: REPORT_LIMITS.cells }, (_, i) => ['item' + i, { '*': c }])));
    expect(() => reportFromHours([overCells], ids, learn, NOW, options)).toThrow(ReportBudgetExceeded);
    const bigOutput = construct(Object.fromEntries(Array.from({ length: 2200 }, (_, i) => ['item' + i, { ['x'.repeat(2048)]: c }])));
    try { reportFromHours([bigOutput], ids, learn, NOW, options); throw new Error('expected output refusal'); }
    catch (error) { expect(error).toMatchObject({ budget: 'outputBytes', limit: REPORT_LIMITS.outputBytes }); }
    const emptyItems = construct(Object.fromEntries(Array.from({ length: 11_000 }, (_, i) => ['item' + i, {}])));
    const day = Array.from({ length: 24 }, (_, hour) => ({ ...emptyItems, hour, from: T12 - 12 * H + hour * H, to: T12 - 12 * H + (hour + 1) * H }));
    expect(() => reportFromHours(day, ids, learn, NOW, options)).toThrow(ReportBudgetExceeded);
    expect(() => reportFromHours([...day, day[0]!], ids, learn, NOW, options)).toThrow(ReportBudgetExceeded);
    for (const broken of [{ ...a, tenant: 'meridian' }, { ...a, hour: 13 }, construct(JSON.parse('{"__proto__":{}}'))]) {
      expect(() => reportFromHours([broken], ids, learn, NOW, options)).toThrow(ReportUnavailableError);
    }
    expect(() => reportFromHours(aggs, ids, learn, NOW, { ...options, missing: [24] })).toThrow(ReportUnavailableError);
    const huge = aggs.map(x => ({ ...x, brands: { coach: { ...x.brands.coach!, decisions: Number.MAX_VALUE } } }));
    expect(() => reportFromHours(huge, ids, learn, NOW, options)).toThrow(ReportUnavailableError);
    const seven = { ...a, brands: { coach: { ...a.brands.coach!, policies: Object.fromEntries(Array.from({ length: 7 }, (_, i) => ['p' + i, policy])) } } };
    expect(() => reportFromHours([seven], ids, learn, NOW, options)).toThrow(ReportBudgetExceeded);
    const key = hourKey(ids.tenant, ids.date, 12), canonical = r2.objects.get(reportKey(ids.tenant, ids.brand, ids.date));
    const text = vi.fn(async () => JSON.stringify(a)), get = vi.fn(async () => ({ text, size: REPORT_LIMITS.aggregateBytes + 1 }));
    const storage = { get, put: vi.fn(), list: vi.fn(async () => ({ objects: [{ key }], truncated: false })) };
    await expect(runDayReport(storage, ids, learn, null, NOW)).rejects.toMatchObject({ budget: 'aggregateBytes' });
    expect(text).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(1); expect(storage.put).not.toHaveBeenCalled();
    for (const value of [null, undefined, { text: async () => '{' }, { text: async () => JSON.stringify({ ...a, date: '2026-09-04' }) }]) {
      const bad = { ...storage, get: vi.fn(async () => value) };
      await expect(runDayReport(bad as unknown as Parameters<typeof runDayReport>[0], ids, learn, null, NOW)).rejects.toBeInstanceOf(ReportUnavailableError);
      expect(bad.get).toHaveBeenCalledTimes(1);
    }
    const overflow = { ...storage, list: vi.fn(async () => ({ objects: Array.from({ length: 25 }, (_, h) => ({ key: hourKey(ids.tenant, ids.date, h) })), truncated: false })) };
    get.mockClear(); await expect(loadHours(overflow, ids.tenant, ids.date, NOW)).rejects.toBeInstanceOf(ReportBudgetExceeded); expect(get).not.toHaveBeenCalled();
    const stalled = { ...storage, list: vi.fn(async () => ({ objects: [], truncated: true, cursor: 'same' })) };
    await expect(loadHours(stalled, ids.tenant, ids.date, NOW)).rejects.toBeInstanceOf(ReportUnavailableError); expect(stalled.list).toHaveBeenCalledTimes(2);
    r2.objects.set(key, JSON.stringify(overCells)); const puts = r2.puts.length;
    await expect(runDayReport(r2, ids, learn, null, NOW)).rejects.toBeInstanceOf(ReportBudgetExceeded);
    expect(r2.puts).toHaveLength(puts); expect(r2.objects.get(reportKey(ids.tenant, ids.brand, ids.date))).toBe(canonical);
  });
  it('W30.02 carries actual hourly limits and unadvanced progress through saved day and window reports', async () => {
    const r2 = new FakeR2(); ledger(r2, decisions, outcomes);
    const first = await buildHour(r2, ids.tenant, { date: ids.date, hour: 12 }, learn, NOW, { horizonMs: 0, maxObjects: 2 });
    const second = await buildHour(r2, ids.tenant, { date: ids.date, hour: 13 }, learn, NOW, { horizonMs: 48 * H });
    const again = await buildHour(r2, ids.tenant, { date: ids.date, hour: 12 }, learn, NOW, { horizonMs: 0, maxObjects: 2 });
    expect(first.truncated).toBe(true); expect(again.ringsFolded).toBe(false);
    expect(() => reportFromHours([second, again], ids, learn, NOW, { pending: 0, missing: [] })).toThrow(ReportUnavailableError);
    const compatible = await buildHour(r2, ids.tenant, { date: ids.date, hour: 13 }, learn, NOW, { horizonMs: 0 });
    const known = reportFromHours([compatible, again], ids, learn, NOW, { pending: 0, missing: [] });
    expect(known.coverage).toMatchObject({ metadata: 'recorded', maturity: 'unknown', status: 'incomplete', truncatedHours: [12], unadvancedHours: [12], unknownHours: [], minHorizonMs: 0,
      horizons: [{ hour: 12, horizonMs: 0 }, { hour: 13, horizonMs: 0 }] });
    expect(known.hours!.horizonMs).toBe(0);
    const incomplete = await runDayReport(r2, ids, learn, null, NOW);
    expect(incomplete.coverage!.missingHours).toContain(14);
    expect(incomplete.coverage!.minHorizonMs).toBeNull();
    expect(incomplete.coverage!.unadvancedHours).toEqual([12]);
    const saved = r2.json<typeof incomplete>(reportKey(ids.tenant, ids.brand, ids.date));
    expect(saved.coverage).toEqual(incomplete.coverage);
    const puts = [...r2.puts];
    const window = await windowReport(r2, { tenant: ids.tenant, brand: ids.brand, from: ids.date, to: ids.date });
    expect(window.coverage.days).toEqual([{ date: ids.date, coverage: incomplete.coverage }]);
    expect(window.coverage).toMatchObject({ maturity: 'unknown', status: 'incomplete', minHorizonMs: null });
    expect(window.slots.hero!.arms.map(a => [a.decisions, a.credited])).toEqual(incomplete.holdout.hero!.map(a => [a.decisions, a.credited]));
    expect(r2.puts).toEqual(puts);
    const unknown = structuredClone(second); delete (unknown as Partial<HourAggregate>).ringsFolded;
    unknown.horizonMs = NaN; unknown.brands.coach!.visitorsIncomplete = true;
    expect(() => reportFromHours([again, unknown], ids, learn, NOW, { pending: 0, missing: [] })).toThrow(ReportUnavailableError);
    const legacy = { ...known, computation: undefined, counts: { ...known.counts, truncated: true },
      coverage: { ...known.coverage!, visitorsIncomplete: true, unknownHours: [13], horizons: [{ hour: 12, horizonMs: 0 }, { hour: 13, horizonMs: null }] } };
    const projected = diagnosticDayReport(legacy);
    expect(projected.coverage).toMatchObject({ visitorsIncomplete: true, unknownHours: [13], minHorizonMs: null, unadvancedHours: [12] });
    expect(projected.counts.truncated).toBe(true);
  });

  it('W30.01 attributes forward-hour outcomes before later decisions consume the ring cap', () => {
    const rows = [dec('v', 's', T12 + 10, 'a'), dec('v', 's', T12 + 30, 'b'), dec('v', 's', T12 + 40, 'c')];
    const events = [out('v', 's', T12 + 20, 'click', 'a'), out('v', 's', T12 + 45, 'click', 'c')];
    const run = (ds: DecisionRecord[], os: OutcomeRecord[], cap = 2) => {
      const compact = ds.map(compactOf), policies = policiesOf(learn);
      const ctx: FoldContext = { date: ids.date, from: T12, to: T12 + H, horizonMs: H, ringCap: cap,
        statsCfg: DEFAULT_STATS, slotCfg: { hero: { reward: 'click', stats: DEFAULT_STATS } }, policies,
        tombs: new Map(), brands: foldDecisions(compact, policies, DEFAULT_STATS) };
      const state = foldShard(emptyShard(0), compact, os, ctx).state;
      return { state, credits: ctx.brands.coach!.policies.learning!.credits };
    };
    for (const ds of [rows, [...rows].reverse()]) for (const os of [events, [...events].reverse()]) {
      const result = run(ds, os); expect(result.credits).toBe(2);
      expect(result.state.rings.v!.map(row => row.item)).toEqual(['b', 'c']);
    }
    // Actual F17 P2 remains: all three decisions precede this click, so cap2 legitimately lost a.
    expect(run(rows, [out('v', 's', T12 + 50, 'click', 'a')]).credits).toBe(0);
    const ties = ['a', 'b'].map(item => {
      const row = dec('v', 's', T12 + 10, item);
      return { ...row, request_id: `tie-${item}`, decision_id: `${row.decision_id}:n1:tie-${item}` };
    });
    expect(run(ties, [out('v', 's', T12 + 10, 'click', 'b')], 1).credits).toBe(1);
    expect(run([...ties].reverse(), [out('v', 's', T12 + 10, 'click', 'a')], 1).credits).toBe(1);
    expect(run(rows, [out('v', 's', T12 - 1, 'click', 'a'), out('v', 's', T12 + H, 'click', 'c')]).credits).toBe(0);
  });

  it('W30.01 restores early credits in actual hourly reports and retains the bounded ring across the next hour', async () => {
    const rows = [dec('v', 's', T12 + MIN, 'early'),
      ...Array.from({ length: 205 }, (_, n) => dec('v', 's', T12 + 58 * MIN + n * 100, `later-${n}`))];
    const early = out('v', 's', T12 + 2 * MIN, 'click', 'early');
    const r2 = new FakeR2(); ledger(r2, rows, [early]);
    const first = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1 });
    expect(first.brands.coach!.policies.learning!.credits).toBe(1);
    const key = shardKey('coach', 0), saved = r2.objects.get(key)!;
    expect(r2.json<ShardState>(key).rings.v).toHaveLength(200);
    expect(r2.json<ShardState>(key).rings.v!.some(entry => entry.item === 'early')).toBe(false);
    const repeated = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1 });
    expect(repeated.ringsFolded).toBe(false); expect(repeated.brands.coach!.policies.learning!.credits).toBe(1);
    expect(repeated.brands).toEqual(first.brands); expect(ringContents(r2.objects.get(key))).toEqual(ringContents(saved));
    const restart = new FakeR2(); for (const [name, body] of r2.objects) restart.objects.set(name, body);
    const later = out('v', 's', T12 + 61 * MIN, 'click', 'later-204'); ledger(restart, [], [later]);
    const second = await buildHour(restart, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    expect(second.brands.coach!.policies.learning!.credits).toBe(1);
    const folded = reportFromHours([repeated, second], ids, learn, NOW, { pending: 0, missing: [] });
    const raw = buildReport({ ...ids, learning, reporting: policiesOf(learn).slice(1), learn,
      decisions: rows, outcomes: [early, later], now: NOW, truncated: false });
    expect(folded.counts).toEqual(raw.counts); expect(folded.holdout).toEqual(raw.holdout);
    expect(folded.policies).toEqual(raw.policies); expect(folded.policies[0]!.credits).toBe(2);
    for (const item of ['early', 'later-204']) {
      expect(folded.grids.hero!.learning!.items[item]!['*']!.s).toBeGreaterThan(0);
      expect(folded.grids.hero!.learning!.items[item]!['*']!.s).toBeCloseTo(raw.grids.hero!.learning!.items[item]!['*']!.s, 12);
    }
    expect(restart.json<ShardState>(key).rings.v).toHaveLength(200);
  });

  it('W30.01 preserves erasure, tenant and cross-brand cap boundaries during ordered folding', async () => {
    for (const erased of [false, true]) {
      const r2 = new FakeR2(), key = shardKey('coach', 0), otherKey = shardKey('meridian', 0);
      const carry = dec('v', 's', T12 - MIN, 'carry');
      const initial = { ...emptyShard(0), seenDate: ids.date, through: T12 - H, rings: { v: [compactOf(carry).entry] } };
      r2.objects.set(key, JSON.stringify(initial)); r2.objects.set(otherKey, JSON.stringify(initial));
      const otherBefore = r2.objects.get(otherKey);
      const rows = [dec('v', 's', T12 + 10, 'old'), { ...dec('v', 's', T12 + 15, 'other'), brand: 'maple' },
        dec('v', 's', T12 + 20, 'at-cutoff'), dec('v', 's', T12 + 30, 'fresh'), dec('v', 's', T12 + 50, 'future')];
      const events = [out('v', 's', T12 + 1, 'click', 'carry'), out('v', 's', T12 + 16, 'click', 'old'),
        out('v', 's', T12 + 20, 'click', 'at-cutoff'), out('v', 's', T12 + 40, 'click', 'fresh'),
        out('v', 'wrong-session', T12 + 41, 'click', 'fresh'), { ...out('v', 's', T12 + 42, 'click', 'fresh'), slot: 'wrong-slot' }];
      ledger(r2, rows, events);
      if (erased) await writeTombstone(r2, 'coach', 'v', 'test', T12 + 20);
      const aggregate = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1, ringCap: 1, horizonMs: H });
      expect(aggregate.brands.coach!.policies.learning!.credits).toBe(erased ? 1 : 3);
      expect(aggregate.brands.coach!.rows_hidden).toBe(erased ? 5 : 0);
      expect(r2.json<ShardState>(key).rings.v!.map(entry => entry.item)).toEqual(['future']);
      expect(r2.json<ShardState>(key).seenAt!.coach!.v).toBe(T12 + 50);
      expect(r2.objects.get(otherKey)).toBe(otherBefore);
      const beforeRepeat = r2.objects.get(key);
      const repeat = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1, ringCap: 1, horizonMs: H });
      // The current-hour fresh credit survives; an evicted pre-hour carry-in does not reappear.
      expect(repeat.brands.coach!.policies.learning!.credits).toBe(erased ? 1 : 2);
      expect(ringContents(r2.objects.get(key))).toEqual(ringContents(beforeRepeat)); expect(r2.objects.get(otherKey)).toBe(otherBefore);
    }
  });

  it('W26.01 agrees on named-slot item and product credit in hourly and raw reports without narrowing broad overlays', async () => {
    for (const reward of ['click', 'purchase'] as const) {
      const config: LearnConfig = { holdout: learn.holdout, slots: { hero: { reward }, rail: { reward } } };
      const rows = [dec('v1', 's1', T12 + 59 * MIN, reward === 'click' ? 'A' : 'story-hero', { products: ['bag-1'] }),
        dec('v1', 's1', T12 + 59 * MIN + 1, reward === 'click' ? 'A' : 'story-rail', { slot: 'rail', products: ['bag-1'] })];
      const events = ['hero', 'absent'].map((slot, i) => ({
        ...out('v1', 's1', T12 + (61 + i) * MIN, reward, reward === 'click' ? 'A' : null, { products: reward === 'purchase' ? ['bag-1'] : undefined }), slot,
      }));
      expect(new Set(rows.map(r => r.decision_id)).size).toBe(2);
      expect(new Set(events.map(o => o.outcome_id)).size).toBe(2);
      const r2 = new FakeR2(); ledger(r2, rows, events);
      const hours = [await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, config, NOW),
        await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, config, NOW)];
      const folded = reportFromHours(hours, ids, config, NOW, { pending: 0, missing: [] });
      const raw = buildReport({ ...ids, learning, reporting: policiesOf(config).slice(1), learn: config,
        decisions: rows, outcomes: events, now: NOW, truncated: false });
      expect(folded.counts).toEqual(raw.counts);
      expect(folded.counts).toEqual({ decisions: 2, outcomes: 2, visitors: 1, truncated: false });
      expect(folded.policies).toEqual(raw.policies);
      expect(folded.grids).toEqual(raw.grids);
      expect(folded.holdout).toEqual(raw.holdout);
      expect(folded.exploration).toEqual(raw.exploration);
      for (const p of folded.policies) expect(p.credits).toBe(p.policy.match === 'any' ? 4 : 1);
      expect(hours[1]!.brands.coach!.policies.learning!.credits).toBe(1);
      for (const row of rows) {
        const grid = folded.grids[row.slot]!.learning!;
        expect(grid.events).toBe(1);
        expect(grid.items[row.item_id]!['*']!.n).toBe(Math.exp(-(NOW - row.ts) / DEFAULT_STATS.tauLearnMs));
        expect(grid.items[row.item_id]!['*']!.s).toBe(row.slot === 'hero'
          ? Math.exp(-(NOW - events[0]!.ts) / DEFAULT_STATS.tauLearnMs) : 0);
        expect(folded.grids[row.slot]!['any-item']!.items[row.item_id]!['*']!.s).toBeGreaterThan(1);
      }
    }
  });

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
    expect(fromHours.holdout.hero).toEqual([{ arm: 'default', decisions: 1, credited: 1, creditedPerDecision: 1, rate: 1 }, { arm: 'personalized', decisions: 4, credited: 2, creditedPerDecision: 0.5, rate: 0.5 }]);
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
    const ringsBefore = r2.keys('aggregates/coach/rings/').map((k) => ringContents(r2.objects.get(k)));
    const again = await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW);
    expect(again.ringsFolded).toBe(false);
    expect(r2.keys('aggregates/coach/rings/').map((k) => ringContents(r2.objects.get(k)))).toEqual(ringsBefore);
    expect(again.brands.coach!.decisions).toBe(first!.brands.coach!.decisions);
    expect(again.brands.coach!.policies.learning!.credits).toBe(first!.brands.coach!.policies.learning!.credits);
    const v1 = r2.json<ShardState>(shardKey('coach', shardOf('v1')));
    expect(v1.rings.v1!.map((e) => e.item)).toEqual(['a', 'b']);
    expect(v1.through).toBe(T12);                                     // hour 13 changed nothing in this shard, so nothing was written
  });

  it('W21 hourly reports preserve repeated credits with inference unavailable', async () => {
    const r2 = new FakeR2();
    ledger(r2, [dec('v1', 's1', T12, 'a')], [1, 2, 3].map((n) => out('v1', 's1', T12 + n * MIN, 'click', 'a')));
    const aggregate = await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW);
    const report = reportFromHours([aggregate], ids, learn, NOW, { pending: 0, missing: [13] });
    expect(report.holdout.hero).toEqual([{ arm: 'personalized', decisions: 1, credited: 3, creditedPerDecision: 3, rate: 3 }]);
    expect(report.holdoutComparison).toEqual({ hero: [] });
    expect(report.measurement.inference).toBe('unavailable');
    expect(report.measurement.unit).toBe('credited_outcomes_per_content_item_decision');
    expect(report.hours!.missing).toEqual([13]);
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
    expect(r2.json<ShardState>(shardKey('coach', shardOf('v1'))).seen.coach ?? []).not.toContain('v1');
    expect(r2.json<ShardState>(shardKey('coach', shardOf('v1'))).seenAt?.coach?.v1).toBeUndefined();
    expect(h13.brands.coach!.rows_hidden).toBe(0);                     // v1 had no rows in hour 13
    const again12 = await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW);
    expect(again12.brands.coach!.rows_hidden).toBe(3);                 // two decisions and a click
    expect(again12.brands.coach!.decisions).toBe(4);
  });

  it('W06.07 persists inclusive seen-only cleanup on replay while preserving other subjects, brands and tenants', async () => {
    const r2 = new FakeR2(), at = T12 + MIN;
    const initial: ShardState = { ...emptyShard(0), through: T12 + H, seenDate: ids.date,
      seen: { cedar: ['before', 'equal', 'after', 'untouched'], maple: ['equal'] },
      seenAt: { cedar: { before: at - 1, equal: at, after: at + 1, untouched: T12 }, maple: { equal: at + 2 } } };
    for (const tenant of ['harbor', 'meridian']) r2.objects.set(shardKey(tenant, 0), JSON.stringify(initial));
    for (const visitor of ['before', 'equal', 'after']) await writeTombstone(r2, 'harbor', visitor, 'test', at);
    const otherBefore = r2.objects.get(shardKey('meridian', 0));
    const agg = await buildHour(r2, 'harbor', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    const cleaned = r2.json<ShardState>(shardKey('harbor', 0));
    expect(agg.ringsFolded).toBe(false);
    expect(cleaned.seen).toEqual({ cedar: ['after', 'untouched'], maple: ['equal'] });
    expect(cleaned.seenAt).toEqual({ cedar: { after: at + 1, untouched: T12 }, maple: { equal: at + 2 } });
    expect(cleaned.seenIncomplete).toBeUndefined();
    expect(agg.brands.cedar!.visitorsDay).toBe(2);
    expect(agg.brands.maple!.visitorsDay).toBe(1);
    expect(r2.objects.get(shardKey('meridian', 0))).toBe(otherBefore);
    const stable = r2.objects.get(shardKey('harbor', 0));
    await buildHour(r2, 'harbor', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    expect(ringContents(r2.objects.get(shardKey('harbor', 0)))).toEqual(ringContents(stable));
    const other = await buildHour(r2, 'meridian', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    expect(other.brands.cedar!.visitorsDay).toBe(4);
    expect(ringContents(r2.objects.get(shardKey('meridian', 0)))).toEqual(ringContents(otherBefore));
  });

  it('W06.07 keeps maximum fresh witnesses after out-of-order rows and cross-brand ring eviction', async () => {
    const r2 = new FakeR2(), key = shardKey('coach', 0), at = T12 + MIN;
    const rows = [dec('visitor', 'session', at + 1, 'new'), dec('visitor', 'session', at - 1, 'old'),
      { ...dec('visitor', 'session', at + 2, 'other'), brand: 'maple' }];
    r2.objects.set(`${hourPrefix('coach', T12)}/decision/${ts36(T12)}-t.ndjson`, rows.map(row => JSON.stringify(row)).join('\n'));
    await buildHour(r2, 'coach', { date: ids.date, hour: 12 }, learn, NOW, { shards: 1, ringCap: 1 });
    expect(r2.json<ShardState>(key).rings.visitor!.map(row => row.brand)).toEqual(['maple']);
    expect(r2.json<ShardState>(key).seenAt).toEqual({ coach: { visitor: at + 1 }, maple: { visitor: at + 2 } });
    await writeTombstone(r2, 'coach', 'visitor', 'test', at);
    await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1, horizonMs: 0 });
    expect(r2.json<ShardState>(key).rings).toEqual({});
    expect(r2.json<ShardState>(key).seen).toEqual({ coach: ['visitor'], maple: ['visitor'] });
    await writeTombstone(r2, 'coach', 'visitor', 'test', at + 1);
    const agg = await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    expect(r2.json<ShardState>(key).seen).toEqual({ coach: [], maple: ['visitor'] });
    expect(r2.json<ShardState>(key).seenAt).toEqual({ maple: { visitor: at + 2 } });
    expect(agg.brands.coach!.visitorsIncomplete).toBeUndefined();
  });

  it('W06.07 keeps legacy uncertainty visible, never recreates orphan membership, and prunes seen metadata by date on forward rollover', async () => {
    const r2 = new FakeR2(), key = shardKey('coach', 0), at = T12 + MIN;
    const entry = (visitor: string, ts: number, brand = 'coach') => ({ ...compactOf(dec(visitor, 'session', ts, 'item')).entry, brand });
    const initial: ShardState = { ...emptyShard(0), through: T12, seenDate: ids.date,
      seen: { coach: ['positive', 'unknown', 'old', 'wrongBrand', 'wrongDay'], maple: ['untouched'] },
      seenAt: { coach: { orphan: at + 1 }, orphanBrand: { orphan: at + 1 } },
      rings: { positive: [entry('positive', at + 1)], old: [entry('old', at - 1)],
        wrongBrand: [entry('wrongBrand', at + 1, 'maple')], wrongDay: [entry('wrongDay', at + 24 * H)],
        ringOnly: [entry('ringOnly', at + 1)] } };
    r2.objects.set(key, JSON.stringify(initial));
    // Without an active cutoff, incomplete legacy history must not be promoted to a trusted latest timestamp.
    await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    expect(r2.json<ShardState>(key).seen).toEqual(initial.seen);
    expect(r2.json<ShardState>(key).seenAt).toEqual({});
    for (const visitor of initial.seen.coach!) await writeTombstone(r2, 'coach', visitor, 'test', at);
    const agg = await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1, horizonMs: 0 });
    expect(r2.json<ShardState>(key).seen).toEqual({ coach: ['positive'], maple: ['untouched'] });
    expect(r2.json<ShardState>(key).seenAt).toEqual({ coach: { positive: at + 1 } });
    expect(r2.json<ShardState>(key).seenIncomplete).toEqual({ coach: true });
    expect(agg.brands.coach!.visitorsIncomplete).toBe(true);
    expect(reportFromHours([agg], ids, learn, NOW, { pending: 5, missing: [] }).counts.truncated).toBe(true);
    expect(reportFromHours([agg], { ...ids, brand: 'maple' }, learn, NOW, { pending: 5, missing: [] }).counts.truncated).toBe(false);
    await writeTombstone(r2, 'coach', 'positive', 'test', at + 1);
    const later = await buildHour(r2, 'coach', { date: ids.date, hour: 14 }, learn, NOW, { shards: 1, horizonMs: 0 });
    expect(r2.json<ShardState>(key).seen.coach).toEqual([]);
    expect(r2.json<ShardState>(key).seenAt).toEqual({});
    expect(later.brands.coach!.visitorsIncomplete).toBe(true);
    // Anonymous historical max counts remain historical; uncertainty survives the merge.
    expect(reportFromHours([agg, later], ids, learn, NOW, { pending: 5, missing: [] }).counts).toMatchObject({ visitors: 1, truncated: true });
    await buildHour(r2, 'coach', { date: '2026-09-04', hour: 0 }, learn, NOW + 24 * H, { shards: 1 });
    // W22.R1.02 (F17 §6 item 3; ruling R133). `seen`, `seenAt` and
    // `seenIncomplete` keep their meaning — the membership of `seenDate` — so
    // every stored shard and every literal in this file still reads, and the
    // rollover still starts the new date empty. What the rollover no longer
    // does is FORGET: the previous date's membership is pruned BY DATE into
    // `seenDays`, because an hour of that date can still be repaired.
    expect(r2.json<ShardState>(key)).toMatchObject({ seenDate: '2026-09-04', seen: {} });
    expect(r2.json<ShardState>(key).seenAt).toBeUndefined();
    expect(r2.json<ShardState>(key).seenIncomplete).toBeUndefined();
    expect((r2.json<ShardState>(key) as { seenDays?: Record<string, Record<string, string[]>> }).seenDays?.[ids.date])
      .toEqual({ coach: [], maple: ['untouched'] });
    // And an hour of that older date is repairable: it folds, it writes its
    // aggregate, and it leaves the newer date's membership alone (F17 P7).
    const writes = r2.puts.length;
    const repaired = await buildHour(r2, 'coach', { date: ids.date, hour: 15 }, learn, NOW, { shards: 1 });
    expect(repaired.hour).toBe(15);
    expect(r2.keys(`aggregates/coach/${ids.date}/`)).toContain(hourKey('coach', ids.date, 15));
    expect(r2.puts.length).toBeGreaterThan(writes);
    expect(r2.json<ShardState>(key)).toMatchObject({ seenDate: '2026-09-04', seen: {} });
  });

  it('W06.07 fails closed on malformed seen state and retries a failed cleanup without publishing an hour', async () => {
    const key = shardKey('coach', 0), at = T12 + MIN;
    const initial: ShardState = { ...emptyShard(0), through: T12, seenDate: ids.date,
      seen: { coach: ['visitor'] }, seenAt: { coach: { visitor: at } } };
    for (const raw of ['{', JSON.stringify({ ...initial, seen: { coach: 'visitor' } }),
      JSON.stringify({ ...initial, seenAt: { coach: { visitor: String(at + 1) } } }),
      JSON.stringify({ ...initial, seenAt: { coach: { visitor: at + 24 * H } } }),
      JSON.stringify({ ...initial, seenIncomplete: { coach: false } })]) {
      const r2 = new FakeR2(); r2.objects.set(key, raw);
      await writeTombstone(r2, 'coach', 'visitor', 'test', at);
      const writes = r2.puts.length;
      await expect(buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 })).rejects.toThrow();
      expect(r2.objects.get(key)).toBe(raw); expect(r2.puts).toHaveLength(writes);
      expect(r2.objects.has(hourKey('coach', ids.date, 13))).toBe(false);
    }
    class MissingResponse extends FakeR2 { override async get(k: string) { return k === key ? undefined as never : super.get(k); } }
    const missing = new MissingResponse(); missing.objects.set(key, JSON.stringify(initial));
    await expect(buildHour(missing, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 })).rejects.toThrow('Hourly shard unavailable');
    expect(missing.puts).toEqual([]);
    expect(missing.objects.get(key)).toBe(JSON.stringify(initial));
    class FailedPut extends FakeR2 {
      fail = true;
      override async put(k: string, body: string, options?: R2PutOptions) {
        if (k === key && this.fail) { this.fail = false; throw new Error('synthetic cleanup write failure'); }
        return super.put(k, body, options);
      }
    }
    const r2 = new FailedPut(), raw = JSON.stringify(initial); r2.objects.set(key, raw);
    await writeTombstone(r2, 'coach', 'visitor', 'test', at);
    await expect(buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 })).rejects.toThrow('synthetic cleanup write failure');
    expect(r2.objects.get(key)).toBe(raw);
    expect(r2.objects.has(hourKey('coach', ids.date, 13))).toBe(false);
    const retried = await buildHour(r2, 'coach', { date: ids.date, hour: 13 }, learn, NOW, { shards: 1 });
    expect(r2.json<ShardState>(key).seen.coach).toEqual([]);
    expect(r2.json<ShardState>(key).seenAt).toEqual({});
    expect(retried.brands.coach!.visitorsDay).toBe(0);
    expect(r2.objects.has(hourKey('coach', ids.date, 13))).toBe(true);
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
    expect(third).toEqual({ built: [], failed: [], pending: 0, reports: { published: [], failed: [], deferred: [] } });
    expect(r2.keys('aggregates/coach/2026-09-03/')).toEqual([hourKey('coach', '2026-09-03', 11), hourKey('coach', '2026-09-03', 12), hourKey('coach', '2026-09-03', 13)]);
    // A day nothing was folded for lists every closed hour as missing.
    expect((await loadHours(r2, 'coach', '2026-09-02', now)).missing).toHaveLength(24);
  });

  it('W06.07 catch-up repairs the oldest missing hour across a date boundary and leaves the current date\'s membership alone', async () => {
    class Traced extends FakeR2 {
      listed: string[] = [];
      override async list(opts: { prefix: string }) { this.listed.push(opts.prefix); return super.list(opts); }
    }
    const r2 = new Traced(), midnight = T12 + 12 * H, currentDate = '2026-09-04', key = shardKey('coach', 0);
    const current = dec('current', 'session', midnight + MIN, 'new');
    const state: ShardState = { ...emptyShard(0), through: midnight, seenDate: currentDate,
      rings: { current: [compactOf(current).entry] }, seen: { coach: ['current'] }, seenAt: { coach: { current: current.ts } } };
    const stored = JSON.stringify(state); r2.objects.set(key, stored);
    ledger(r2, [dec('old', 'session', midnight - 2 * H + MIN, 'old'), dec('old', 'session', midnight - H + MIN, 'old'), current], []);
    const olderRows = [...r2.objects].filter(([k]) => k.startsWith(`coach/${ids.date}/`));
    const result = await catchUp(r2, 'coach', learn, midnight + H + 7 * MIN, { lookbackHours: 3, maxHours: 1, shards: 1 });
    // W22.R1.02 (F17 §6 item 3; ruling R133): an hour of the older date is no
    // longer doomed by the shard having seen a newer one. Oldest first, one
    // hour per run: hour 22 is repaired and written, hour 23 and the current
    // date's hour 0 stay pending, and no hour fails.
    expect(result.built).toEqual([{ date: ids.date, hour: 22, decisions: 1, outcomes: 0, objects: 1, truncated: false }]);
    expect(result.failed).toEqual([]);
    expect(result.pending).toBe(2);
    expect(r2.listed).toContain(`coach/${ids.date}/22/`);
    expect(r2.listed).not.toContain(`coach/${ids.date}/23/`); // One hour per run; the next run takes 23.
    // The repair adds the older hour's decision to the rings and takes nothing
    // away: the current date's own membership and ledger rows are untouched.
    expect(r2.json<ShardState>(key)).toMatchObject({ seenDate: currentDate, seen: { coach: ['current'] } });
    expect([...r2.objects].filter(([k]) => k.startsWith(`coach/${ids.date}/`))).toEqual(olderRows);
    expect(r2.keys(`aggregates/coach/${ids.date}/`)).toEqual([hourKey('coach', ids.date, 22)]);
    expect(r2.keys(`aggregates/coach/${currentDate}/`)).toEqual([]);
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

  it('an hour past the object cap is read in time order up to the cap and marked truncated; the day says so', async () => {
    const r2 = new FakeR2();
    ledger(r2, decisions, outcomes);                                  // hour 12: five decision objects (v1 and v2 share 12:00) and three outcome objects
    const agg = await buildHour(r2, 'coach', { date: '2026-09-03', hour: 12 }, learn, NOW, { maxObjects: 4 });
    expect([agg.objects, agg.objectsRead, agg.truncated]).toEqual([8, 4, true]);
    // The four earliest objects in time order, both streams: 12:00 (v1 a, v2 a), 12:00:30 (v2's click), 12:01 (v1 b), 12:02 (v1's click).
    expect([agg.brands.coach!.decisions, agg.brands.coach!.outcomes]).toEqual([3, 2]);
    const r = reportFromHours([agg], ids, learn, NOW, { pending: 0, missing: [] });
    expect(r.counts.truncated).toBe(true);
  });

  it('the run continues past an hour whose fold throws, and stops when its budget is spent', async () => {
    class Flaky extends FakeR2 { override async get(key: string) { if (key.includes('/2026-09-03/12/')) throw new Error('storage said no'); return super.get(key); } }
    const r2 = new Flaky();
    ledger(r2, decisions, outcomes);
    const now = T12 + 2 * H + 7 * MIN;
    const r = await catchUp(r2, 'coach', learn, now, { lookbackHours: 3, maxHours: 3 });
    expect(r.built.map((b) => b.hour)).toEqual([11, 13]);
    expect(r.failed).toEqual([{ date: '2026-09-03', hour: 12, error: 'storage said no' }]);
    expect(r.pending).toBe(1);
    const tight = new FakeR2();
    ledger(tight, decisions, outcomes);
    expect((await catchUp(tight, 'coach', learn, now, { lookbackHours: 3, maxHours: 3, budget: 1 })).built.map((b) => b.hour)).toEqual([11]);
  });

  it('a visitor always lands in the same shard, inside the range', () => {
    for (const v of ['v1', 'vis-2f1c', 'anything at all']) { expect(shardOf(v)).toBe(shardOf(v)); expect(shardOf(v)).toBeGreaterThanOrEqual(0); expect(shardOf(v)).toBeLessThan(SHARDS); }
    expect(new Set(Array.from({ length: 200 }, (_, i) => shardOf(`visitor-${i}`))).size).toBeGreaterThan(SHARDS / 2);
  });
});
