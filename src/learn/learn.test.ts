// src/learn/learn.test.ts
// Phase 1, pure: the policy credits the right decision, the statistics decay
// and shrink and clamp as §5 says, the finest level with enough evidence
// answers, and the objects keep the ring and publish the snapshot.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { attribute, DEFAULT_POLICY, type RingEntry } from './policy';
import { DEFAULT_STATS, buildSnapshot, emptyStats, levelKeys, liftFor, parentKey, recordExposure, recordSuccess } from './stats';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import { liftKey } from './fan';
import type { Cell, DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';

const T0 = 1_725_000_000_000;
const cell: Cell = { channel: 'paid social', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' };
const entry = (id: string, slot: string, item: string, ts: number, session = 's1'): RingEntry => ({ id, ts, page: 'home', slot, item, session_id: session, arm: 'personalized', cell });
const outcome = (type: OutcomeRecord['type'], item: string | null, ts: number, session = 's1'): OutcomeRecord =>
  ({ outcome_id: `o:${ts}`, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: session, ts, type, event: type, item_id: item, slot: null, value: null, currency: null, arm: 'personalized' });

describe('the learning policy', () => {
  const ring = [entry('d1', 'hero', 'A', T0), entry('d2', 'story', 'A', T0 + 1000), entry('d3', 'story', 'B', T0 + 2000)];

  it('direct match, last credit, one credit per slot', () => {
    const c = attribute(outcome('click', 'A', T0 + 60_000), ring, DEFAULT_POLICY);
    expect(c.map((x) => [x.slot, x.decision_id, x.reward])).toEqual([['story', 'd2', 'click'], ['hero', 'd1', 'click']]);
  });

  it('respects the window, the session scope, and the time order', () => {
    expect(attribute(outcome('click', 'A', T0 + 31 * 60_000), ring, DEFAULT_POLICY)).toEqual([]);          // past the 30-minute click window
    expect(attribute(outcome('click', 'A', T0 + 60_000, 's2'), ring, DEFAULT_POLICY)).toEqual([]);           // another session
    expect(attribute(outcome('click', 'A', T0 - 1), ring, DEFAULT_POLICY)).toEqual([]);                      // before the decision
    expect(attribute(outcome('purchase', 'A', T0 + 3 * 24 * 3_600_000), ring, DEFAULT_POLICY)).toHaveLength(2);   // purchase window is 7 days
  });

  it('match any credits the most recent decision per slot whatever the item; first credit picks the earliest', () => {
    const any = attribute(outcome('add_to_bag', 'SKU-9', T0 + 60_000), ring, { ...DEFAULT_POLICY, match: 'any' });
    expect(any.map((x) => x.decision_id).sort()).toEqual(['d1', 'd3']);
    const first = attribute(outcome('add_to_bag', 'SKU-9', T0 + 60_000), ring, { ...DEFAULT_POLICY, match: 'any', credit: 'first' });
    expect(first.find((x) => x.slot === 'story')?.decision_id).toBe('d2');
  });
});

describe('the statistics', () => {
  it('cells materialize five keys, coarsest first, and every key knows its parent', () => {
    const keys = levelKeys(cell);
    expect(keys).toEqual(['*', 'c=paid social', 'c=paid social|v=1', 'c=paid social|v=1|r=US-NY', 'c=paid social|v=1|r=US-NY|a=occasion:evening']);
    expect(parentKey(keys[4]!)).toBe(keys[3]); expect(parentKey(keys[1]!)).toBe('*'); expect(parentKey('*')).toBeNull();
  });

  it('the worked example from §5.3, at the finest level with enough evidence', () => {
    const st = emptyStats();
    const cfg = { ...DEFAULT_STATS, n0: 30, nMin: 30 };
    // 120 exposures of X in the cell, 9 add-to-bags; the slot as a whole runs at 5% in the cell.
    for (let i = 0; i < 120; i++) recordExposure(st, 'X', cell, T0, cfg);
    for (let i = 0; i < 9; i++) recordSuccess(st, 'X', cell, 'add_to_bag', T0, 1, cfg);
    for (let i = 0; i < 1880; i++) recordExposure(st, 'Y', cell, T0, cfg);            // 2000 slot exposures in total
    for (let i = 0; i < 91; i++) recordSuccess(st, 'Y', cell, 'add_to_bag', T0, 1, cfg);  // 100 successes → 5%
    const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'add_to_bag', T0, cfg);
    const finest = levelKeys(cell)[4]!;
    expect(snap.slotRates[finest]?.rate).toBeCloseTo(0.05, 2);
    const x = snap.items.X![finest]!;
    expect(x.n).toBe(120); expect(x.s).toBe(9); expect(x.p0).toBeCloseTo(0.05, 2);
    expect(x.p_hat).toBeCloseTo(0.07, 2);
    expect(x.lift).toBeCloseTo(1.4, 1);
    const look = liftFor(snap, 'X', cell)!;
    expect(look.level).toBe(4); expect(look.lift).toBeCloseTo(1.4, 1); expect(look.level_words).toContain('affinity cell');
    // A cell with no exposures of X pools upward until it finds the item's evidence at the coarser levels.
    const other: Cell = { ...cell, affinity: 'line:drover' };
    expect(liftFor(snap, 'X', other)?.level).toBe(3);
    expect(liftFor(snap, 'Z', cell)).toBeNull();
  });

  it('decays on the long horizon, shrinks a thin sample toward its parent, and clamps', () => {
    const st = emptyStats();
    const cfg = { ...DEFAULT_STATS, nMin: 1 };
    for (let i = 0; i < 40; i++) recordExposure(st, 'X', cell, T0, cfg);
    for (let i = 0; i < 40; i++) recordSuccess(st, 'X', cell, 'click', T0, 1, cfg);   // every exposure clicked: a runaway item
    for (let i = 0; i < 400; i++) recordExposure(st, 'Y', cell, T0, cfg);
    const now = buildSnapshot(st, { tenant: 't', brand: 'b', slot: 's' }, 'click', T0, cfg);
    expect(now.items.X!['*']!.lift).toBe(cfg.liftMax);                                   // clamped at 2
    const later = buildSnapshot(st, { tenant: 't', brand: 'b', slot: 's' }, 'click', T0 + cfg.tauLearnMs, cfg);
    expect(later.items.X!['*']!.n).toBeCloseTo(40 * Math.exp(-1), 1);                   // one horizon later, 37% remains
    // A single exposure with no success is pulled almost entirely to the slot's rate: lift near 1, not near 0.
    const thin = emptyStats(); recordExposure(thin, 'X', cell, T0, cfg);
    const t = buildSnapshot(thin, { tenant: 't', brand: 'b', slot: 's' }, 'click', T0, cfg);
    const fine = t.items.X![levelKeys(cell)[4]!]!;
    expect(fine.p_hat).toBeCloseTo(fine.p0, 3);
    expect(fine.lift).toBeGreaterThan(0.9);
  });
});

class FakeStorage { map = new Map<string, unknown>(); alarm: number | null = null;
  async get(k: string) { return this.map.get(k); } async put(k: string, v: unknown) { this.map.set(k, v); }
  async deleteAll() { this.map.clear(); } async getAlarm() { return this.alarm; } async setAlarm(at: number) { this.alarm = at; } }
class FakeKV { store = new Map<string, string>(); async get(k: string) { const r = this.store.get(k); return r === undefined ? null : JSON.parse(r); } async put(k: string, v: string) { this.store.set(k, v); } }

describe('the objects', () => {
  const record = (id: string, slot: string, item: string, ts: number): DecisionRecord => ({
    decision_id: id, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: 's1', identity_anchor: 'visitor', ts, page: 'home', slot, position: 0,
    item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 0 }, config_label: 'v1', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null },
  });

  it('the ring keeps the last 200, attributes an outcome, and forwards credits to the slot object', async () => {
    const forwarded: unknown[] = [];
    const env = { LEARN_STATS: { idFromName: (n: string) => n, get: (n: string) => ({ fetch: async (_u: string, init?: { body?: string }) => { forwarded.push([n, JSON.parse(init?.body ?? '{}')]); return new Response('{}'); } }) } } as unknown as Env;
    const ring = new DecisionRing({ storage: new FakeStorage() } as unknown as DurableObjectState, env);
    // The ring ages entries against real time, so these are stamped now.
    const NOW = Date.now() - 10_000;
    const many = Array.from({ length: 205 }, (_, i) => record(`d${i}`, 'rail', `item${i % 7}`, NOW + i));
    await ring.fetch(new Request('https://learn/append', { method: 'POST', body: JSON.stringify({ records: many }) }));
    await ring.fetch(new Request('https://learn/append', { method: 'POST', body: JSON.stringify({ records: [record('hero-1', 'hero', 'A', NOW + 1000)] }) }));
    const recent = (await (await ring.fetch(new Request('https://learn/recent'))).json()) as { ring: DecisionRecord[]; index: number };
    expect(recent.ring).toHaveLength(200); expect(recent.index).toBe(206);
    const res = (await (await ring.fetch(new Request('https://learn/outcome', { method: 'POST', body: JSON.stringify({ tenant: 'coach', brand: 'coach', outcome: outcome('click', 'A', NOW + 5000), policy: DEFAULT_POLICY, slotConfig: {} }) }))).json()) as { credits: number };
    expect(res.credits).toBe(1);
    expect(forwarded[0]).toEqual(['coach:coach:hero', expect.objectContaining({ slot: 'hero', credits: [expect.objectContaining({ decision_id: 'hero-1', item: 'A', reward: 'click' })] })]);
  });

  it('the statistics object counts, arms one alarm, and publishes a versioned snapshot to KV', async () => {
    const kv = new FakeKV(); const storage = new FakeStorage();
    const obj = new LearnStats({ storage } as unknown as DurableObjectState, { CACHE: kv } as unknown as Env);
    const NOW = Date.now();
    const cfg = { reward: 'click', stats: { ...DEFAULT_STATS, nMin: 1 } };
    await obj.fetch(new Request('https://learn/exposures', { method: 'POST', body: JSON.stringify({ tenant: 'coach', brand: 'coach', slot: 'hero', config: cfg, exposures: Array.from({ length: 10 }, () => ({ item: 'A', cell, ts: NOW })) }) }));
    await obj.fetch(new Request('https://learn/credits', { method: 'POST', body: JSON.stringify({ tenant: 'coach', brand: 'coach', slot: 'hero', config: cfg, credits: [{ decision_id: 'd', slot: 'hero', item: 'A', cell, reward: 'click', event: 'click', ts: NOW, weight: 1 }] }) }));
    expect(storage.alarm).not.toBeNull(); expect(kv.store.size).toBe(0);
    await obj.alarm();
    const snap = JSON.parse(kv.store.get(liftKey('coach', 'coach', 'hero'))!);
    expect(snap.reward).toBe('click'); expect(snap.events).toBe(10);
    expect(snap.items.A['*'].n).toBeCloseTo(10, 1); expect(snap.items.A['*'].s).toBeCloseTo(1, 1);
    expect(JSON.stringify(snap)).not.toContain('v1');   // no visitor in the aggregate
  });
});
