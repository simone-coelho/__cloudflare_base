// src/learn/learn.test.ts
// Phase 1, pure: the policy credits the right decision, the statistics decay
// and shrink and clamp as §5 says, the finest level with enough evidence
// answers, and the objects keep the ring and publish the snapshot.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '@/types/env';
import { attribute, DEFAULT_POLICY, type RingEntry } from './policy';
import { DEFAULT_STATS, buildSnapshot, emptyStats, levelKeys, liftFor, parentKey, recordExposure, recordSuccess } from './stats';
import { DecisionRing, RING_LIMITS } from '@/durable-objects/DecisionRing';
import { LearnStats, LEARN_LIMITS } from '@/durable-objects/LearnStats';
import { deliverStats, FAN_LIMITS, fanDecisions, fanOutcome, liftArchiveKey, liftKey, readRing, reportLearningIncomplete, ringEntryOf, servedCounts, type OutcomeReceipt, type StatsWriteReceipt } from './fan';
import { invalidateCache } from '@/config/versionedStore';
import { initializePublicationSet, readPublication, publish } from '@/config/publication';
import { LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { PRIORS_KIND } from './priors';
import { effectiveScore } from '@/reflex/core';
import { mergeStats } from './hourly';
import { decideContent } from '@/content/decide';
import type { StatsState, LiftSnapshot } from './stats';
import { tombstoneKey } from '@/ledger/erasure';
import type { Cell, DecisionRecord } from '@/content/types';
import { outcomeFromAction, type OutcomeRecord } from '@/ledger/records';
import { captureRetention, retentionBirth, type RetentionEnv } from '@/retention';
import { learningEffectId, recoveryDigest, disposeOwnerRecovery, resumeOwnerRecovery, type LearningEffect, type OwnerRecovery } from '@/ledger/recovery';
import { runOwnerOperation } from '@/identity/sessionAuthority';

const onlineFixtureEnv = { TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian', 'harbor'] }), RETENTION: JSON.stringify({ version: 1,
  tenants: Object.fromEntries(['coach', 'meridian', 'harbor'].map(tenant => [tenant, { online: { id: 'synthetic-online', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' } }])) }) } as RetentionEnv;

const T0 = 1_725_000_000_000;
const cell: Cell = { channel: 'paid_social', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' };
const entry = (id: string, slot: string, item: string, ts: number, session = 's1'): RingEntry => ({ id, ts, page: 'home', slot, item, session_id: session, arm: 'personalized', cell });
const outcome = (type: OutcomeRecord['type'], item: string | null, ts: number, session = 's1'): OutcomeRecord =>
  ({ retention: captureRetention(onlineFixtureEnv, 'coach', Math.min(ts, Date.now())), outcome_id: `coach:${ts.toString(36)}:v1:${type}`, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: session, ts, type, event: type, item_id: item, slot: null, value: null, currency: null, margin: null, products: null, arm: 'personalized' });

describe('the learning policy', () => {
  it('W15 rendered attribution and fatigue use acknowledged time and never pool served history', () => {
    const renderedId = `coach:${T0.toString(36)}:v1:home:hero:0`;
    const legacy = entry('legacy', 'hero', 'A', T0), rendered: RingEntry = { ...entry(renderedId, 'hero', 'A', T0), brand: 'coach', measurementBasis: 'rendered-v1', renderedAt: T0 + 60000 };
    const slots = [{ slot: 'hero', fatigue: { weight: 1, windowHours: 1 }, measurementBasis: 'rendered-v1' as const }];
    expect(servedCounts([legacy, rendered], slots, T0 + 30000)).toEqual({});
    expect(servedCounts([legacy, rendered], slots, T0 + 60001)).toEqual({ hero: { A: 1 } });
    expect(servedCounts([legacy, rendered], [{ ...slots[0]!, measurementBasis: 'served-v1' }], T0 + 60001)).toEqual({ hero: { A: 1 } });
    expect(attribute(outcome('click', 'A', T0 + 30000), [rendered], DEFAULT_POLICY)).toEqual([]);
    expect(attribute({ ...outcome('click', 'A', T0 + 60001), decision_id: renderedId }, [rendered], DEFAULT_POLICY).map(row => row.decision_id)).toEqual([renderedId]);
    expect(legacy).not.toHaveProperty('measurementBasis'); expect(rendered.ts).toBe(T0);
  });
  const ring = [entry('d1', 'hero', 'A', T0), entry('d2', 'story', 'A', T0 + 1000), entry('d3', 'story', 'B', T0 + 2000)];

  it('direct match, last credit, one credit per slot when the outcome slot is unspecified', () => {
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
    expect(keys).toEqual(['*', 'c=paid social', 'c=paid social|v=1', 'c=paid social|v=1|s=unknown', 'c=paid social|v=1|s=unknown|r=US-NY', 'c=paid social|v=1|s=unknown|r=US-NY|a=occasion:evening']);
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
    const finest = levelKeys(cell)[5]!;
    expect(snap.slotRates[finest]?.rate).toBeCloseTo(0.05, 2);
    const x = snap.items.X![finest]!;
    expect(x.n).toBe(120); expect(x.s).toBe(9); expect(x.p0).toBeCloseTo(0.05, 2);
    expect(x.p_hat).toBeCloseTo(0.07, 2);
    expect(x.lift).toBeCloseTo(1.4, 1);
    const look = liftFor(snap, 'X', cell)!;
    expect(look.level).toBe(5); expect(look.lift).toBeCloseTo(1.4, 1); expect(look.level_words).toContain('affinity cell');
    // A cell with no exposures of X pools upward until it finds the item's evidence at the coarser levels.
    const other: Cell = { ...cell, affinity: 'line:drover' };
    expect(liftFor(snap, 'X', other)?.level).toBe(4);
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
    const fine = t.items.X![levelKeys(cell)[5]!]!;
    expect(fine.p_hat).toBeCloseTo(fine.p0, 3);
    expect(fine.lift).toBeGreaterThan(0.9);
  });
});

class FakeStorage { map = new Map<string, unknown>(); alarm: number | null = null;
  async get(k: string) { return this.map.get(k); } async put(k: string, v: unknown) { this.map.set(k, v); }
  async delete(k: string) { return this.map.delete(k); }
  async list(options: { prefix?: string; limit?: number } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(options.prefix ?? '')).slice(0, options.limit)); }
  async transaction<T>(work: (storage: FakeStorage) => Promise<T>): Promise<T> {
    const before = structuredClone(this.map), alarm = this.alarm;
    try { return await work(this); } catch (error) { this.map = before; this.alarm = alarm; throw error; }
  }
  async deleteAll() { this.map.clear(); } async getAlarm() { return this.alarm; } async setAlarm(at: number) { this.alarm = at; } }
class FakeKV { store = new Map<string, string>(); async get(k: string, type?: string) { const r = this.store.get(k); return r === undefined ? null : type === 'stream' ? new Response(r).body : JSON.parse(r); } async put(k: string, v: string) { this.store.set(k, v); } }

const boundedBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const boundedConfig = { reward: 'click' as const, stats: DEFAULT_STATS };
const boundedStored = (stats = emptyStats()) => ({ tenant: 'coach', brand: 'coach', slot: 'hero', config: boundedConfig, stats });

describe('W09.09 atomic managed learning and physical continuation', () => {
  const make = (slot = 'hero') => {
    const storage = new FakeStorage(), tombstones = new Map<string, string>();
    const env = { ...onlineFixtureEnv, LEDGER_RECOVERY_ENABLED: 'true', STORAGE: { get: vi.fn(async (key: string) => {
      const text = tombstones.get(key); return text === undefined ? null : { text: async () => text };
    }) }, CACHE: new FakeKV() } as unknown as Env;
    const state = { storage } as unknown as DurableObjectState;
    let object = new LearnStats(state, env);
    const request = (path: string, body: unknown) => object.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
    const effect = async (decision: string, until = T0 + 60_000, kind: 'exposures' | 'credits' = 'exposures'): Promise<LearningEffect> => ({
      version: 1, id: await learningEffectId(kind, 'coach:coach:' + slot, decision, kind === 'credits' ? 'outcome' : undefined), decision,
      ...(kind === 'credits' ? { outcome: 'outcome' } : {}), tenant: 'coach', subject: 'v1', generation: { whole: 0, item: 0 },
      retention: retentionBirth(env, 'coach', 'online', 0), consentUntil: until,
    });
    const send = (rows: unknown[], kind = 'exposures') => request('/' + kind, { version: 2, tenant: 'coach', brand: 'coach', slot, config: boundedConfig, [kind]: rows });
    return { storage, env, state, tombstones, request, effect, send, restart: () => { object = new LearnStats(state, env); }, object: () => object };
  };
  it('W09.09 rework ring alarm strips expired plans and tagged ring/index before held R2 while retaining live and unproved history', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0); let release: (() => void) | undefined;
    try {
      const storage = new FakeStorage(), target = make(), policy = JSON.parse(onlineFixtureEnv.RETENTION!);
      policy.tenants.coach.online.durationMs = 1000;
      const cleanup: unknown[] = [], env = { ...onlineFixtureEnv, RETENTION: JSON.stringify(policy), STORAGE: { get: vi.fn(async () => null) }, LEARN_STATS: {
        idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init?: RequestInit) => {
          const path = new URL(url).pathname, body = JSON.parse(String(init?.body));
          if (path === '/cleanup-effects') cleanup.push(body);
          return target.request(path, body);
        } }),
      } } as unknown as Env;
      target.env.RETENTION = env.RETENTION;
      const state = { storage } as unknown as DurableObjectState; let ring = new DecisionRing(state, env);
      const ask = (path: string, body: unknown) => ring.fetch(new Request('https://ring' + path, { method: 'POST', body: JSON.stringify(body) }));
      const records = [-500, 0].map((offset, i) => ({ decision_id: `coach:${(T0 + offset).toString(36)}:v1:home:hero:${i}`, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: 's1', ts: T0 + offset,
        slot: 'hero', page: 'home', item_id: 'A', arm: 'personalized', cell, retention: captureRetention(env, 'coach', T0 + offset, T0 + offset) } as DecisionRecord));
      expect((await ask('/append', { version: 2, records })).status).toBe(200);
      for (const [i, decision] of records.entries()) {
        const reward = { ...outcome('click', 'A', T0 + i), decision_id: decision.decision_id, retention: captureRetention(env, 'coach', T0, T0) };
        expect((await ask('/outcome/prepare', { version: 2, tenant: 'coach', brand: 'coach', outcome: reward, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig, consentUntil: T0 + 2000 })).status).toBe(200);
      }
      const plans = [...storage.map].filter(([key]) => key.startsWith('creditPlan:')) as Array<[string, { retention: { expiresAt: number }; cleanup?: boolean; retired?: boolean; plan: { batches: Array<{ name: string; body: unknown }> } }]>;
      const expired = plans.find(([, value]) => value.retention.expiresAt === T0 + 500)!, live = plans.find(([, value]) => value.retention.expiresAt === T0 + 1000)!;
      const liveBefore = structuredClone(live[1]); expect(expired).toBeDefined(); expect(live).toBeDefined();
      const stored = storage.map.get('ring') as { ring: DecisionRecord[]; index: Array<{ id: string; ts: number; retention?: unknown }> };
      const legacy = { ...records[0]!, decision_id: `coach:${(T0 - 500).toString(36)}:v1:legacy:hero:0`, retention: undefined };
      const unproved = { ...records[0]!, decision_id: `coach:${(T0 - 500).toString(36)}:v1:unproved:hero:0`, retention: { online: { invalid: 'not disposal authority' } } } as unknown as DecisionRecord;
      stored.ring.push(legacy, unproved); stored.index.push({ id: legacy.decision_id, ts: legacy.ts }, { id: unproved.decision_id, ts: unproved.ts, retention: unproved.retention!.online });
      // Preserve an already-retired minimal debt independently of raw expiry.
      const retiredKey = 'creditPlan:' + 'f'.repeat(64), retired = structuredClone(expired[1]);
      retired.cleanup = true; retired.retired = true; retired.plan.batches = retired.plan.batches.map(batch => ({ ...batch, body: null })); storage.map.set(retiredKey, retired);
      clock.mockReturnValue(T0 + 501); storage.alarm = null; ring = new DecisionRing(state, env);
      let entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
      vi.spyOn(env.STORAGE, 'get').mockImplementation(async () => { entered(); await gate; throw new Error('held R2 outage'); });
      const pending = ring.alarm().catch(() => undefined);
      try {
        await started;
        const physical = storage.map.get('ring') as typeof stored;
        expect.soft(physical.ring.map(row => row.decision_id)).toEqual([records[1]!.decision_id, legacy.decision_id, unproved.decision_id]);
        expect.soft(physical.index.map(row => row.id)).toEqual([records[1]!.decision_id, legacy.decision_id, unproved.decision_id]);
        const debt = storage.map.get(expired[0]) as typeof expired[1];
        expect.soft(debt.cleanup).toBe(true); expect.soft(debt.plan.batches.every(batch => batch.body === null)).toBe(true);
        expect.soft(debt.retention.expiresAt).toBe(T0 + 500); expect.soft(storage.map.get(live[0])).toEqual(liveBefore);
        expect.soft(storage.map.get(retiredKey)).toEqual(retired); expect.soft(cleanup).toEqual([]);
        expect.soft(storage.alarm).toBe(T0 + 1000);
      } finally { release?.(); await pending; }
      expect(storage.map.has(expired[0])).toBe(true); expect(storage.map.has(retiredKey)).toBe(true);
      vi.spyOn(env.STORAGE, 'get').mockResolvedValue(null); ring = new DecisionRing(state, env);
      await ring.alarm().catch(() => undefined);
      expect(storage.map.has(expired[0])).toBe(false); expect(storage.map.has(retiredKey)).toBe(false);
      expect(storage.map.get(live[0])).toEqual(liveBefore); expect(cleanup).toContainEqual({ tenant: 'coach', subject: 'v1', retired: true });
      expect((storage.map.get('ring') as typeof stored).ring).toEqual([records[1], legacy, unproved]);
    } finally { release?.(); clock.mockRestore(); }
  });
  it('W09.09 rework credit copies retain selected decision lifetime across partial retry, restart and preparation/delivery waits', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try { for (const crossing of ['partial-restart', 'preparation', 'delivery']) {
      clock.mockReturnValue(T0);
      const targets = new Map(['hero', 'rail'].map(slot => [slot, make(slot)])), storage = new FakeStorage();
      const policy = JSON.parse(onlineFixtureEnv.RETENTION!); policy.tenants.coach.online.durationMs = 200;
      const env = { ...onlineFixtureEnv, RETENTION: JSON.stringify(policy), STORAGE: { get: async () => null }, LEARN_STATS: {
        idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: string, init?: RequestInit) => {
          const path = new URL(url).pathname, slot = name.split(':').at(-1)!, target = targets.get(slot)!;
          if (crossing === 'preparation' && path === '/generation') clock.mockReturnValue(T0 + 101);
          if (path === '/credits') {
            sends.push(slot);
            if (crossing === 'partial-restart' && slot === 'rail' && failRail) throw new Error('credit unavailable');
            if (crossing === 'delivery') clock.mockReturnValue(T0 + 101);
          }
          return target.request(path, JSON.parse(String(init?.body)));
        } }),
      } } as unknown as Env;
      for (const target of targets.values()) target.env.RETENTION = env.RETENTION;
      const sends: string[] = []; let failRail = true, ring = new DecisionRing({ storage } as unknown as DurableObjectState, env);
      const ask = (path: string, body: unknown) => ring.fetch(new Request('https://ring' + path, { method: 'POST', body: JSON.stringify(body) }));
      const rows = ['hero', 'rail'].map((slot, i) => ({ decision_id: `coach:${(T0 - 100).toString(36)}:v1:home:${slot}:${i}`, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: 's1', ts: T0 - 100,
        slot, page: 'home', item_id: 'A', arm: 'personalized', cell, retention: captureRetention(env, 'coach', T0 - 100, T0 - 100) } as DecisionRecord));
      expect((await ask('/append', { version: 2, records: rows })).status).toBe(200); clock.mockReturnValue(T0 + 50);
      const reward = { ...outcome('click', 'A', T0), retention: captureRetention(env, 'coach', T0, T0) };
      const body = { version: 2, tenant: 'coach', brand: 'coach', outcome: reward, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig, consentUntil: T0 + 1000 };
      const prepared = await ask('/outcome/prepare', body);
      if (crossing === 'preparation') { expect.soft(prepared.status).not.toBe(200); expect.soft(sends).toEqual([]); continue; }
      expect(prepared.status).toBe(200);
      const saved = [...storage.map].find(([key]) => key.startsWith('creditPlan:'))![1] as { retention: { expiresAt: number }; plan: { batches: Array<{ body: { credits: Array<{ effect: LearningEffect }> } | null }> } };
      expect.soft(saved.retention.expiresAt).toBe(T0 + 100);
      for (const batch of saved.plan.batches) for (const row of batch.body!.credits) expect.soft(row.effect.retention.expiresAt).toBe(T0 + 100);
      await ask('/outcome', body);
      if (crossing === 'delivery') { for (const target of targets.values()) expect.soft(target.storage.map.has('learn')).toBe(false); continue; }
      expect(sends).toEqual(['hero', 'rail']); const counters = structuredClone(targets.get('hero')!.storage.map.get('learn'));
      clock.mockReturnValue(T0 + 150); failRail = false; ring = new DecisionRing({ storage } as unknown as DurableObjectState, env);
      expect.soft((await ask('/outcome', body)).status).not.toBe(200); expect.soft(sends).toEqual(['hero', 'rail']);
      expect.soft(targets.get('hero')!.storage.map.get('learn')).toEqual(counters); expect.soft(targets.get('rail')!.storage.map.has('learn')).toBe(false);
      await ring.alarm();
      const plans = [...storage.map].filter(([key]) => key.startsWith('creditPlan:')).map(([, value]) => value);
      expect.soft(JSON.stringify(plans)).not.toContain(rows[0]!.decision_id);
    } } finally { clock.mockRestore(); }
  });
  it('commits markers with counters, survives lost replies/restart, rejects conflicts and preserves ts=0/weight=0 and flag-off reset fences', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const f = make(), effect = await f.effect('d1'), row = { item: 'A', cell, ts: 0, effect };
      expect(await (await f.send([row])).json()).toMatchObject({ receipt: { newlyApplied: 1, alreadyApplied: 0 } });
      const first = structuredClone(f.storage.map.get('learn')); f.restart();
      expect(await (await f.send([row])).json()).toMatchObject({ receipt: { newlyApplied: 0, alreadyApplied: 1 } });
      expect(f.storage.map.get('learn')).toEqual(first);
      expect((await f.send([{ ...row, item: 'B' }])).status).toBe(409);
      const credit = { item: 'A', cell, ts: 0, weight: 0, reward: 'click', effect: await f.effect('d1', T0 + 60_000, 'credits') };
      expect((await f.send([credit], 'credits')).status).toBe(200);
      expect((f.storage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.n.t).toBe(0);
      expect((f.storage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.s.click!.s).toBe(0);
      const counters = structuredClone((f.storage.map.get('learn') as { stats: StatsState }).stats);
      expect(await (await f.request('/cleanup-effects', { tenant: 'coach', subject: 'v1', retired: true })).json()).toMatchObject({ complete: true });
      const retired = f.storage.map.get('learn') as { effects: object; retiredEffects: object };
      expect(Object.keys(retired.effects)).toHaveLength(0); expect(Object.keys(retired.retiredEffects)).toHaveLength(2);
      expect(JSON.stringify(retired.retiredEffects)).not.toContain('v1');
      expect(await (await f.send([row])).json()).toMatchObject({ receipt: { newlyApplied: 0, suppressed: 1 } });
      expect((f.storage.map.get('learn') as { stats: StatsState }).stats).toEqual(counters);
      f.env.LEDGER_RECOVERY_ENABLED = 'false'; expect((await f.request('/reset', {})).status).toBe(200);
      expect((await f.send([row])).status).toBe(409);
      expect(f.storage.map.has('learn')).toBe(false); expect(f.storage.map.get('learnFence')).toMatchObject({ whole: 1 });
    } finally { clock.mockRestore(); }
  });
  it('refuses awaited deadline crossings before atomic commit and schedules publication alongside earliest marker cleanup', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const crossing of ['barrier', 'transaction']) {
        const f = make(), row = { item: 'A', cell, ts: T0, effect: await f.effect('deadline', T0 + 10) };
        if (crossing === 'barrier') vi.spyOn(f.env.STORAGE, 'get').mockImplementationOnce(async () => { clock.mockReturnValue(T0 + 11); return null; });
        else { const put = f.storage.put.bind(f.storage); vi.spyOn(f.storage, 'put').mockImplementation(async (key, value) => { await put(key, value); if (key === 'learnFence') clock.mockReturnValue(T0 + 11); }); }
        expect((await f.send([row])).status, crossing).not.toBe(200); expect(f.storage.map.has('learn')).toBe(false); clock.mockReturnValue(T0);
      }
      const f = make(); f.storage.alarm = T0 + 100_000;
      expect((await f.send([{ item: 'A', cell, ts: T0, effect: await f.effect('short', T0 + 5000) }])).status).toBe(200);
      expect(f.storage.alarm).toBe(T0 + 5000);
      clock.mockReturnValue(T0 + 5001);
      expect(await (await f.request('/cleanup-effects', { tenant: 'coach', subject: 'v1' })).json()).toMatchObject({ complete: true });
      expect(Object.keys((f.storage.map.get('learn') as { effects: object }).effects)).toHaveLength(0);
      expect((f.storage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.n.s).toBe(1);
    } finally { clock.mockRestore(); }
  });
  it('purges expired raw owner chunks during R2 failure and retains destination debt until marker acknowledgement', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const storage = new FakeStorage(), id = await recoveryDigest('owner-expiry');
      const meta = { version: 1, id, digest: id, payloadDigest: id, chunks: 1, bytes: 7, principal: {}, consentUntil: T0 + 100,
        retention: retentionBirth(onlineFixtureEnv, 'coach', 'online', 0), expiresAt: T0, tenant: 'coach', subject: 'v1', records: 1, occurredAt: 0,
        destinations: ['coach:coach:hero'], receipt: { version: 1, operation: id, durable: true, source: { expected: 1, state: 'recovered' } } } as OwnerRecovery;
      storage.map.set('recoveryOperation:' + id, meta); storage.map.set('recoveryBody:' + id + ':0', 'raw-row');
      let available = false, complete = false;
      const env = { STORAGE: { get: async () => { if (!available) throw new Error('R2 outage'); return null; } },
        LEARN_STATS: { idFromName: (x: string) => x, get: () => ({ fetch: async () => Response.json({ ok: true, complete, next: T0 + 100 }) }) },
        DECISION_RING: { idFromName: (x: string) => x, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as unknown as Env;
      await expect(disposeOwnerRecovery(storage as unknown as DurableObjectStorage, env, meta, false)).rejects.toThrow();
      expect(storage.map.has('recoveryBody:' + id + ':0')).toBe(false); expect(storage.map.has('recoveryOperation:' + id)).toBe(true);
      available = true;
      await expect(disposeOwnerRecovery(storage as unknown as DurableObjectStorage, env, storage.map.get('recoveryOperation:' + id) as OwnerRecovery, false)).rejects.toThrow('Learning cleanup pending');
      complete = true; await disposeOwnerRecovery(storage as unknown as DurableObjectStorage, env, storage.map.get('recoveryOperation:' + id) as OwnerRecovery, false);
      expect(storage.map.has('recoveryOperation:' + id)).toBe(false); expect(storage.map.get('recoveryTerminal:' + id)).toMatchObject({ state: 'recovered' });
      const policies = JSON.parse(onlineFixtureEnv.RETENTION!); policies.tenants.coach.recovery = policies.tenants.coach.online;
      const liveEnv = { ...env, ...onlineFixtureEnv, RETENTION: JSON.stringify(policies) } as Env;
      const live = { ...meta, retention: retentionBirth(liveEnv, 'coach', 'recovery', 0), expiresAt: T0 + 100 }; storage.alarm = null;
      await runOwnerOperation({}, liveEnv, () => resumeOwnerRecovery(storage as unknown as DurableObjectStorage, liveEnv, live, async () => {}));
      expect(storage.alarm).toBe(T0 + 100);
    } finally { clock.mockRestore(); }
  });
  it('retains immutable multi-destination credit plans, reconciles committed-response-lost counters, and fences reset during a barrier await', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const targets = new Map(['hero', 'rail'].map(slot => [slot, make(slot)])), storage = new FakeStorage();
      const env = { ...onlineFixtureEnv, LEDGER_RECOVERY_ENABLED: 'true', STORAGE: { get: vi.fn(async () => null) }, LEARN_STATS: {
        idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: string, init?: RequestInit) => {
          const slot = name.split(':').at(-1)!, target = targets.get(slot)!, path = new URL(url).pathname;
          const response = await target.request(path, JSON.parse(String(init?.body)));
          if (path === '/credits') { sent.push(slot); if (slot === 'rail' && lose) { lose = false; throw new Error('committed credit reply lost'); } }
          return response;
        } }),
      } } as unknown as Env;
      const sent: string[] = []; let lose = true;
      const ring = new DecisionRing({ storage } as unknown as DurableObjectState, env), ask = (path: string, body: unknown) => ring.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
      const rows = ['hero', 'rail'].map((slot, index) => ({ decision_id: `coach:${T0.toString(36)}:v1:home:${slot}:${index}`, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: 's1', ts: T0,
        slot, page: 'home', item_id: 'A', arm: 'personalized', cell, retention: captureRetention(env, 'coach', T0) } as DecisionRecord));
      expect((await ask('/append', { version: 2, records: rows })).status).toBe(200);
      const reward = outcome('click', 'A', T0 + 1);
      const body = { version: 2, tenant: 'coach', brand: 'coach', outcome: reward, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig, consentUntil: T0 + 60_000 };
      expect((await ask('/outcome/prepare', body)).status).toBe(200);
      const prepared = structuredClone([...storage.map].find(([key]) => key.startsWith('creditPlan:'))![1]);
      expect(await (await ask('/outcome', body)).json()).toMatchObject({ receipt: { credits: { acknowledged: 1, unknown: 1, newlyApplied: 1 } } });
      expect(await (await ask('/outcome', body)).json()).toMatchObject({ receipt: { credits: { acknowledged: 2, unknown: 0, newlyApplied: 0, alreadyApplied: 2 } } });
      expect(sent).toEqual(['hero', 'rail', 'rail']);
      for (const target of targets.values()) expect((target.storage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.s.click!.s).toBe(1);
      const retained = [...storage.map].find(([key]) => key.startsWith('creditPlan:'))![1] as { plan: unknown; digest: string };
      expect(retained.plan).toEqual((prepared as { plan: unknown }).plan); expect(retained.digest).toBe((prepared as { digest: string }).digest);
      expect((await ask('/outcome', { ...body, defaultSlotConfig: { ...boundedConfig, reward: 'purchase' } })).status).toBe(409);
      let release!: () => void, entered!: () => void, count = 0;
      const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
      vi.spyOn(env.STORAGE, 'get').mockImplementation(async () => { if (++count === 2) { entered(); await gate; } return null; });
      const retry = ask('/outcome', body); await started; expect((await ask('/reset', {})).status).toBe(200); release();
      expect((await retry).status).toBe(409); expect(sent).toHaveLength(3);
    } finally { clock.mockRestore(); }
  });
});
function boundedStats(initial?: unknown) {
  invalidateCache();
  class Storage extends FakeStorage {
    async get(key: string) { return structuredClone(this.map.get(key)); }
    async put(key: string, value: unknown) {
      if (boundedBytes(value) > LEARN_LIMITS.stateBytes) throw new Error('synthetic application storage ceiling');
      this.map.set(key, structuredClone(value));
    }
  }
  const storage = new Storage(), cache = new FakeKV(), published: string[] = [], archives = new Map<string, string>();
  if (initial !== undefined) storage.map.set('learn', structuredClone(initial));
  const archive = { put: vi.fn(async (key: string, body: string, options?: R2PutOptions): Promise<unknown> => {
    if (!(options?.onlyIf instanceof Headers) || options.onlyIf.get('If-None-Match') !== '*') throw new Error('create-only required');
    if (archives.has(key)) return null;
    archives.set(key, body); published.push(body);
    return { key, etag: 'synthetic-' + archives.size, size: new TextEncoder().encode(body).length };
  }) };
  const configuration = new Map<string, { text: string; etag: string }>(); let configVersion = 0;
  const env = { CACHE: cache, STORAGE: {
    get: async (key: string) => { const v = configuration.get(key); return v ? { key, etag: v.etag, size: new TextEncoder().encode(v.text).length, body: new Response(v.text).body } : null; },
    put: async (key: string, text: string, options?: R2PutOptions) => {
      if (!key.startsWith('config-publication/')) return archive.put(key, text, options);
      const condition = options?.onlyIf;
      if (condition instanceof Headers ? configuration.has(key) : condition && condition.etagMatches !== configuration.get(key)?.etag) return null;
      const etag = 'config-' + (++configVersion); configuration.set(key, { text, etag });
      return { key, etag, size: new TextEncoder().encode(text).length };
    },
  } } as unknown as Env;
  const initialConfig = (initial as { config?: typeof boundedConfig } | undefined)?.config ?? boundedConfig;
  let authorityReady: Promise<unknown> = initializePublicationSet(env, [
    { kind: LEARN_KIND, scope: 'coach', revision: { revision: 1, value: { ...DEFAULT_LEARN, stats: initialConfig.stats, slots: { hero: { reward: initialConfig.reward } } }, actor: 'fixture', note: '', at: 1 } },
    { kind: PRIORS_KIND, scope: 'coach', revision: { revision: 1, value: { rows: [] }, actor: 'fixture', note: '', at: 1 } },
  ], '0:' + crypto.randomUUID());
  const state = { storage } as unknown as DurableObjectState, object = new LearnStats(state, env);
  const request = async (path: string, body?: unknown, target = object) => { await authorityReady; return target.fetch(new Request('https://learn' + path,
    body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })); };
  const post = (rows: unknown[], kind: 'exposures' | 'credits' = 'exposures', extra: Record<string, unknown> = {}) => request('/' + kind,
    { tenant: 'coach', brand: 'coach', slot: 'hero', config: boundedConfig, [kind]: rows, ...extra });
  const prior = (rows: unknown[]) => {
    authorityReady = authorityReady.then(async () => {
      const basis = await readPublication(env, PRIORS_KIND, 'coach');
      const saved = await publish(env, PRIORS_KIND, 'coach', { type: 'fixture-prior', rows }, { actor: 'fixture', expectedRevision: basis.revision,
        expectedPublication: basis.publication, operationId: basis.revision + ':' + crypto.randomUUID() }, () => ({ rows }));
      if (!saved.ok) throw new Error('Synthetic prior invalid: ' + saved.errors.join(','));
    });
  };
  const snapshot = async (target = object) => await (await request('/snapshot', undefined, target)).json() as { snapshot: LiftSnapshot | null };
  const learn = async (config: typeof boundedConfig & { objective?: 'unit' | 'revenue' | 'margin'; measurementBasis?: 'served-v1' | 'rendered-v1' }) => {
    await authorityReady;
    const basis = await readPublication(env, LEARN_KIND, 'coach');
    const result = await publish(env, LEARN_KIND, 'coach', config, { actor: 'fixture', expectedRevision: basis.revision,
      expectedPublication: basis.publication, operationId: basis.revision + ':' + crypto.randomUUID() },
    () => ({ ...DEFAULT_LEARN, stats: config.stats, slots: { hero: { reward: config.reward, objective: config.objective, measurementBasis: config.measurementBasis } } }));
    expect(result.ok).toBe(true);
  };
  return { storage, cache, published, archives, archive, env, state, object, request, post, prior, learn, snapshot };
}

it('W15 strict learning state refuses basis mixing until explicit reset, including restart and invalid basis', async () => {
  const f = boundedStats(), row = { item: 'A', cell, ts: T0 };
  expect((await f.post([row])).status).toBe(200); const original = structuredClone(f.storage.map);
  const config = { ...boundedConfig, measurementBasis: 'rendered-v1' as const };
  expect((await f.post([row], 'exposures', { config })).status).toBeGreaterThanOrEqual(400); expect(f.storage.map).toEqual(original);
  const restarted = new LearnStats(f.state, f.env);
  expect((await f.request('/exposures', { tenant: 'coach', brand: 'coach', slot: 'hero', config, exposures: [row] }, restarted)).status).toBeGreaterThanOrEqual(400); expect(f.storage.map).toEqual(original);
  expect((await f.post([row], 'exposures', { config: { ...config, measurementBasis: 'viewable-guessed' } })).status).toBe(400); expect(f.storage.map).toEqual(original);
  expect((await f.request('/reset', {}, restarted)).status).toBe(200); await f.learn(config);
  expect((await f.request('/exposures', { tenant: 'coach', brand: 'coach', slot: 'hero', config, exposures: [{ ...row, ts: T0 + 1000 }] }, restarted)).status).toBe(200);
  const result = await f.snapshot(restarted); expect(result.snapshot?.measurementBasis).toBe('rendered-v1'); expect(result.snapshot?.events).toBe(1);
});

it('W27.01 archives immutable candidates before live publication and keeps every failure and partial effect truthful', async () => {
  vi.useFakeTimers(); vi.setSystemTime(T0);
  try {
    const ready = async () => {
      const f = boundedStats(); expect((await f.post([{ item: 'A', cell, ts: T0 }])).status).toBe(200);
      f.cache.store.set(liftKey('coach', 'coach', 'hero'), '"previous-live"'); return f;
    };
    const f = await ready(), key = liftKey('coach', 'coach', 'hero'), real = f.archive.put.getMockImplementation()!;
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    f.archive.put.mockImplementationOnce(async (...args) => { entered(); await held; return real(...args); });
    const live = vi.spyOn(f.cache, 'put').mockImplementation(async (k, body) => {
      const snap = JSON.parse(body) as LiftSnapshot;
      expect(f.archives.get(liftArchiveKey(snap.tenant, snap.brand, snap.slot, snap.version))).toBe(body);
      f.cache.store.set(k, body);
    });
    const pending = f.request('/publish', {}); await started;
    expect(live).not.toHaveBeenCalled(); expect(f.cache.store.get(key)).toBe('"previous-live"');
    release(); expect((await pending).status).toBe(200);
    const original = new Map(f.archives);
    expect((await f.post([{ item: 'A', cell, ts: T0, reward: 'click' }], 'credits')).status).toBe(200);
    const changed = await (await f.request('/publish', {})).json() as { snapshot: LiftSnapshot };
    expect(changed.snapshot.version).toBe(T0 + 1); expect(changed.snapshot.publishedAt).toBe(T0);
    expect(changed.snapshot.items.A!['*']!.s).toBe(1);
    const restart = new LearnStats(f.state, f.env);
    const restarted = await (await f.request('/publish', {}, restart)).json() as { snapshot: LiftSnapshot };
    expect(restarted.snapshot.version).toBe(T0 + 2); expect(restarted.snapshot.items).toEqual(changed.snapshot.items);
    expect((await f.request('/reset', {})).status).toBe(200);
    expect((await f.post([{ item: 'B', cell, ts: T0 }])).status).toBe(200);
    const reset = await (await f.request('/publish', {})).json() as { snapshot: LiftSnapshot };
    expect(reset.snapshot.version).toBe(T0 + 3); expect(reset.snapshot.items).not.toHaveProperty('A');
    for (const [k, body] of original) expect(f.archives.get(k)).toBe(body);
    expect(f.archives.size).toBe(4);

    for (const mode of ['missing', 'throw', 'undefined', 'key', 'etag', 'etag-long', 'size', 'collision', 'committed-throw']) {
      const x = await ready(), before = structuredClone(x.storage.map.get('learn')), put = x.archive.put.getMockImplementation()!;
      x.archive.put.mockImplementation(async (k, body, options) => {
        if (mode === 'collision') return null;
        if (mode === 'committed-throw') { await put(k, body, options); throw new Error('private archive failure'); }
        if (mode === 'throw') throw new Error('private archive failure');
        if (mode === 'undefined') return undefined;
        return { key: mode === 'key' ? 'wrong' : k, etag: mode === 'etag' ? ' ' : mode === 'etag-long' ? 'x'.repeat(257) : 'ack',
          size: new TextEncoder().encode(body).length + (mode === 'size' ? 1 : 0) };
      });
      if (mode === 'missing') x.env.STORAGE = undefined as never;
      const response = await x.request('/publish', {});
      expect(response.status, mode).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: 'statistics acknowledgement unavailable' });
      expect(x.cache.store.get(key)).toBe('"previous-live"'); expect(x.storage.map.get('learn')).toEqual(before);
      expect(x.storage.alarm).toBe(T0 + 30_000);
      expect(x.archive.put).toHaveBeenCalledTimes(mode === 'missing' ? 0 : mode === 'collision' ? 8 : 1);
      if (mode === 'committed-throw') expect(x.archives.size).toBe(1);
    }
    for (const committed of [false, true]) {
      const x = await ready(); vi.spyOn(x.cache, 'put').mockImplementationOnce(async (k, body) => {
        if (committed) x.cache.store.set(k, body); throw new Error('private KV failure');
      });
      const response = await x.request('/publish', {});
      expect(response.status).toBe(503); expect(await response.json()).not.toHaveProperty('applied');
      expect(x.archives.size).toBe(1); expect(x.storage.alarm).toBe(T0 + 30_000);
      expect(x.cache.store.get(key)).toBe(committed ? [...x.archives.values()][0] : '"previous-live"');
    }
    const partial = await ready(); expect((await partial.post([{ item: 'B', cell, ts: T0 }])).status).toBe(200);
    partial.archive.put.mockRejectedValue(new Error('private archive failure'));
    const resetFailure = await partial.request('/reset-item', { item: 'A' });
    expect(resetFailure.status).toBe(503); expect(await resetFailure.json()).not.toHaveProperty('applied');
    expect((partial.storage.map.get('learn') as { stats: StatsState }).stats.items).not.toHaveProperty('A');
    expect(partial.cache.store.get(key)).toBe('"previous-live"');
    const alarm = await ready(); alarm.archive.put.mockRejectedValue(new Error('private archive failure'));
    alarm.storage.alarm = null;
    await expect(alarm.object.alarm()).rejects.toThrow(); expect(alarm.storage.alarm).toBe(T0 + 30_000);
    vi.spyOn(alarm.storage, 'setAlarm').mockRejectedValue(new Error('private alarm failure'));
    await expect(alarm.object.alarm()).rejects.toThrow(); expect(alarm.cache.store.get(key)).toBe('"previous-live"');
    const malformed = boundedStats(null);
    expect((await malformed.request('/publish', {})).status).toBe(503);
    expect(malformed.archive.put).not.toHaveBeenCalled(); expect(malformed.storage.alarm).toBeNull();
  } finally { vi.useRealTimers(); invalidateCache(); }
});

describe('W24.01 forward accumulation compatibility', () => {
  afterEach(() => { vi.useRealTimers(); invalidateCache(); });

  it('W24.01 pins the accumulation tuple before effects while estimator changes retain item and slot history', async () => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    const f = boundedStats(), row = { item: 'A', cell, ts: T0 };
    for (const kind of ['exposures', 'credits'] as const) {
      expect((await f.post([{ ...row, reward: 'click' }], kind, { config: undefined })).status).toBe(400);
    }
    expect(f.storage.map.size).toBe(0); expect(f.storage.alarm).toBeNull();
    expect((await f.post([row])).status).toBe(200);
    // Other rewards keep their existing semantics; this guard is not a reward filter.
    expect((await f.post([{ ...row, reward: 'purchase', weight: 2 }], 'credits')).status).toBe(200);
    const before = structuredClone(f.storage.map.get('learn')) as ReturnType<typeof boundedStored>;
    const put = vi.spyOn(f.storage, 'put'), alarm = vi.spyOn(f.storage, 'setAlarm');
    const incompatible = [
      { ...boundedConfig, reward: 'purchase' }, { ...boundedConfig, objective: 'revenue' },
      { ...boundedConfig, objective: 'margin' }, { ...boundedConfig, stats: { ...DEFAULT_STATS, tauLearnMs: DEFAULT_STATS.tauLearnMs * 2 } },
    ];
    for (const config of incompatible) for (const kind of ['exposures', 'credits'] as const) {
      const response = await f.post([{ ...row, reward: 'click' }], kind, { config });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ ok: false, error: 'statistics configuration incompatible', applied: false });
      expect(f.storage.map.get('learn')).toEqual(before);
    }
    expect((await f.post([row], 'exposures', { config: undefined })).status).toBe(400);
    expect(put).not.toHaveBeenCalled(); expect(alarm).not.toHaveBeenCalled();
    const estimator = { ...boundedConfig, objective: 'unit' as const, stats: { ...DEFAULT_STATS, n0: 17, nMin: 2, liftMin: 0.25, liftMax: 3 } };
    for (const config of [estimator, boundedConfig, estimator]) {
      expect((await f.post([], 'exposures', { config })).status).toBe(200);
      expect((f.storage.map.get('learn') as ReturnType<typeof boundedStored>).stats).toEqual(before.stats);
      expect((await f.post([row], 'exposures', { config: incompatible[0] })).status).toBe(409);
    }
    const restarted = new LearnStats(f.state, f.env);
    expect((await f.request('/credits', { tenant: 'coach', brand: 'coach', slot: 'hero', config: incompatible[2], credits: [{ ...row, reward: 'click' }] }, restarted)).status).toBe(409);
    await f.learn(estimator);
    const publication = await (await f.request('/publish', {}, restarted)).json() as { snapshot: LiftSnapshot };
    expect(publication.snapshot).toMatchObject({ reward: 'click', objective: 'unit', tauLearnMs: DEFAULT_STATS.tauLearnMs,
      n0: 17, nMin: 2, liftMin: 0.25, liftMax: 3, events: 1 });
    expect(publication.snapshot.slotRates['*']!.n).toBe(1);
    expect((await f.storage.get('learn') as ReturnType<typeof boundedStored>).stats).toEqual(before.stats);
    expect(JSON.parse(f.cache.store.get(liftKey('coach', 'coach', 'hero'))!)).toEqual(publication.snapshot);
    expect(JSON.parse(f.published[0]!)).toEqual(publication.snapshot);
  });
});

describe('W23.01 forward arithmetic and precision', () => {
  afterEach(() => { vi.useRealTimers(); invalidateCache(); });

  it('W23.01 keeps weighted item and slot mass invariant across order, merge and acknowledged restart/publication', async () => {
    const tau = DEFAULT_STATS.tauLearnMs, now = T0 + 2 * tau;
    const rows = [{ item: 'A', ts: T0, weight: 0.25 }, { item: 'A', ts: T0 + tau / 2, weight: 1.75 },
      { item: 'B', ts: T0 + tau, weight: 3.5 }];
    const accumulate = (order: typeof rows) => {
      const st = emptyStats();
      for (const row of order) {
        recordExposure(st, row.item, cell, row.ts, DEFAULT_STATS);
        recordSuccess(st, row.item, cell, 'purchase', row.ts, row.weight, DEFAULT_STATS);
        recordSuccess(st, row.item, cell, 'click', row.ts, row.weight / 2, DEFAULT_STATS);
      }
      return st;
    };
    const verify = (st: StatsState) => {
      expect(st.events).toBe(rows.length); expect(st.updatedAt).toBe(T0 + tau);
      for (const item of ['A', 'B', null]) {
        const relevant = rows.filter(row => item === null || row.item === item);
        const counters = item === null ? st.slot : st.items[item]!;
        const mass = (weight: (row: typeof rows[number]) => number) => relevant.reduce((n, row) => n + weight(row) * Math.exp(-(now - row.ts) / tau), 0);
        for (const key of levelKeys(cell)) {
          const c = counters[key]!;
          expect(c.n.t).toBe(Math.max(...relevant.map(row => row.ts)));
          expect(effectiveScore(c.n, now, tau)).toBeCloseTo(mass(() => 1), 12);
          for (const reward of ['purchase', 'click'] as const) {
            expect(c.s[reward]!.t).toBe(c.n.t);
            expect(effectiveScore(c.s[reward]!, now, tau)).toBeCloseTo(mass(row => row.weight / (reward === 'click' ? 2 : 1)), 12);
          }
        }
      }
    };
    const orders = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0], [0, 2, 1], [2, 0, 1]];
    for (const order of orders) verify(accumulate(order.map(i => rows[i]!)));
    const a = accumulate([rows[2]!, rows[0]!]), b = accumulate([rows[1]!]);
    verify(mergeStats(a, b, tau)); verify(mergeStats(b, a, tau));
    const repeated = accumulate(rows), late = rows[0]!;
    const before = repeated.items.A!['*']!.n.s, reference = repeated.items.A!['*']!.n.t;
    recordExposure(repeated, late.item, cell, late.ts, DEFAULT_STATS);
    expect(repeated.events).toBe(4); expect(repeated.items.A!['*']!.n.t).toBe(reference);
    expect(repeated.items.A!['*']!.n.s).toBeCloseTo(before + Math.exp(-(reference - late.ts) / tau), 12); // Not deduplication.

    vi.useFakeTimers(); vi.setSystemTime(now);
    for (const order of [rows, [...rows].reverse()]) {
      const f = boundedStats();
      expect(await (await f.post(order.map(row => ({ item: row.item, ts: row.ts, cell })))).json())
        .toMatchObject({ receipt: { received: 3, processed: 3, skipped: 0 } });
      const credits = order.flatMap(row => (['purchase', 'click'] as const).map(reward =>
        ({ ...row, cell, reward, weight: row.weight / (reward === 'click' ? 2 : 1) })));
      expect(await (await f.post(credits, 'credits')).json()).toMatchObject({ receipt: { received: 6, processed: 6, skipped: 0 } });
      verify((f.storage.map.get('learn') as { stats: StatsState }).stats);
      const restarted = new LearnStats(f.state, f.env);
      const read = await f.snapshot(restarted), expected = buildSnapshot(accumulate(rows),
        { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', now, DEFAULT_STATS);
      for (const item of ['A', 'B']) for (const key of levelKeys(cell)) {
        for (const field of ['n', 's', 'p0', 'p_hat', 'lift'] as const) {
          expect(read.snapshot!.items[item]![key]![field]).toBeCloseTo(expected.items[item]![key]![field], 12);
        }
      }
      expect(await (await f.request('/publish', {}, restarted)).json()).toMatchObject({ ok: true, published: true });
      const published = JSON.parse(f.cache.store.get(liftKey('coach', 'coach', 'hero'))!) as LiftSnapshot;
      expect(published.items).toEqual(read.snapshot!.items); expect(published.slotRates).toEqual(read.snapshot!.slotRates);
      expect(f.published.length).toBeGreaterThan(0);
    }
  });

  it('W23.01 preserves rare rates and exact evidence gates through snapshots and raw decision explanations', () => {
    const ids = { tenant: 'coach', brand: 'coach', slot: 'hero' }, st = emptyStats();
    for (let i = 0; i < 5000; i++) for (const item of ['A', 'B']) recordExposure(st, item, cell, T0, DEFAULT_STATS);
    for (let i = 0; i < 4; i++) recordSuccess(st, 'A', cell, 'purchase', T0, 1, DEFAULT_STATS);
    const snap = buildSnapshot(st, ids, 'purchase', T0, DEFAULT_STATS), p0 = 4 / 10_000;
    const p_hat = (4 + DEFAULT_STATS.n0 * p0) / (5000 + DEFAULT_STATS.n0);
    for (const key of levelKeys(cell)) {
      expect(snap.slotRates[key]!.rate).toBeCloseTo(p0, 15);
      expect(snap.items.A![key]!.p_hat).toBeCloseTo(p_hat, 15);
      expect(snap.items.A![key]!.lift).toBeCloseTo(p_hat / p0, 12);
      expect(snap.items.A![key]!.p0).toBeGreaterThan(0);
    }
    const concentrated = emptyStats();
    for (let i = 0; i < 10_000; i++) recordExposure(concentrated, i < 100 ? 'A' : 'B',
      i < 100 ? cell : { ...cell, channel: 'direct' }, T0, DEFAULT_STATS);
    for (let i = 0; i < 4; i++) recordSuccess(concentrated, 'A', cell, 'purchase', T0, 1, DEFAULT_STATS);
    const child = buildSnapshot(concentrated, ids, 'purchase', T0, DEFAULT_STATS);
    let rate = p0;
    for (const key of levelKeys(cell)) {
      if (key !== '*') rate = (4 + DEFAULT_STATS.n0 * rate) / (100 + DEFAULT_STATS.n0);
      expect(child.slotRates[key]!.rate).toBeCloseTo(rate, 15);
    }
    expect(child.slotRates[levelKeys(cell)[1]!]!.rate).toBeGreaterThan(0.03); // Rare root is not a zero-child policy.

    const gate = emptyStats(), cfg = { ...DEFAULT_STATS, tauLearnMs: -1 / Math.log(29.9996 / 30) };
    for (let i = 0; i < 30; i++) recordExposure(gate, 'A', cell, T0, cfg);
    const below = buildSnapshot(gate, ids, 'purchase', T0 + 1, cfg);
    expect(below.items.A!['*']!.n).toBeCloseTo(29.9996, 10);
    expect(below.items.A!['*']!.n).toBeLessThan(30);
    expect(liftFor(JSON.parse(JSON.stringify(below)), 'A', cell)).toBeNull();
    expect(liftFor(buildSnapshot(gate, ids, 'purchase', T0, cfg), 'A', cell)).toMatchObject({ n: 30, lift: 1 });
    const zero = buildSnapshot(emptyStats(), ids, 'purchase', T0, DEFAULT_STATS,
      { version: 7, index: new Map([['P', new Map([['*', { p: 0.000123456789, n: 30.00000001 }]])]]) });
    expect(zero.items.P!['*']).toMatchObject({ n: 0, p0: 0, n0: 30.00000001, lift: 1 });
    expect(liftFor(zero, 'P', cell)).toMatchObject({ lift: 1, prior: { p: 0.000123456789, n: 30.00000001 } });

    const wire: LiftSnapshot = JSON.parse(JSON.stringify(snap));
    expect(wire).toEqual(snap);
    const base = { tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const,
      nowMs: T0, pieces: [{ id: 'A', customerContentId: 'cms-A', type: 'editorial', title: 'A', tags: { occasion: ['evening'] },
        slotTypes: ['hero'], lifecycle: { status: 'live' as const } }], slots: [{ slot: 'hero', take: 1, weights: { occasion: 1 } }],
      affinity: { dims: { occasion: { evening: 0.8 } } }, cell, arm: 'personalized' as const,
      versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1' };
    const serve = (snapshot: LiftSnapshot, gamma: number) => decideContent({ ...base, learning: { snapshots: { hero: snapshot }, gammaOf: () => gamma } });
    const served = serve(wire, 1), shadow = serve(wire, 0);
    expect(served.records).toHaveLength(1); expect(shadow.records).toHaveLength(1);
    const look = liftFor(wire, 'A', cell)!;
    for (const record of [served.records[0]!, shadow.records[0]!]) {
      expect(JSON.parse(JSON.stringify(record)).explain.lift).toMatchObject({ p0: look.p0, p_hat: look.p_hat, lift: look.lift, n: look.n, s: look.s });
    }
    expect(served.records[0]!.explain.score_final).toBeGreaterThan(shadow.records[0]!.explain.score_final);
    expect(shadow.records[0]!.explain.score_final).toBe(shadow.records[0]!.explain.score_base);
    expect(shadow.records[0]!.explain.lift!.gamma).toBe(0);
    const legacy = structuredClone(wire);
    for (const level of Object.values(legacy.items.A!)) Object.assign(level, { p0: 0, p_hat: 0.001, lift: 1 });
    const before = structuredClone(legacy);
    expect(liftFor(legacy, 'A', cell)).toMatchObject({ p0: 0, p_hat: 0.001, lift: 1 });
    expect(serve(legacy, 1).records[0]!.explain.lift).toMatchObject({ p0: 0, p_hat: 0.001, lift: 1 });
    expect(legacy).toEqual(before); // Supplying an old rounded snapshot does not rebuild it.
  });
});

describe('W10.03 bounded useful learning and proof recovery', () => {
  it('W10.03 conserves root mass through finite high-cardinality waves, coarse saturation and restart', async () => {
    const f = boundedStats(), clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      let total = 0;
      for (let wave = 0; wave < 12; wave++) {
        const rows = Array.from({ length: 80 }, (_, i) => ({ item: 'item' + (wave * 80 + i) % 300,
          cell: { channel: 'direct', visit_bucket: '1', region: 'r' + wave, affinity: 'a' + i }, ts: T0 }));
        expect((await f.post(rows)).status).toBe(200); total += rows.length;
        const stored = f.storage.map.get('learn') as { stats: StatsState };
        expect(boundedBytes(stored)).toBeLessThanOrEqual(LEARN_LIMITS.stateBytes);
        expect(Object.keys(stored.stats.items).length).toBeLessThanOrEqual(LEARN_LIMITS.items);
        expect(stored.stats.slot['*']!.n.s).toBe(total);
        expect(Object.values(stored.stats.items).reduce((n, map) => n + map['*']!.n.s, stored.stats.bounded!.omitted.n.s)).toBe(total);
      }
      const snapshot = (await f.snapshot(new LearnStats(f.state, f.env))).snapshot!;
      expect(snapshot.completeness).toMatchObject({ depth: 0, omittedItems: true, reason: 'item-capacity' });
      expect(Object.keys(snapshot.slotRates)).toEqual(['*']);
      expect(liftFor(snapshot, 'item299', cell)).toBeNull();
      const before = structuredClone(f.storage.map.get('learn'));
      vi.spyOn(f.storage, 'put').mockRejectedValueOnce(new Error('not committed'));
      expect((await f.post([{ item: 'item0', cell, ts: T0 }])).status).toBe(503);
      expect(f.storage.map.get('learn')).toEqual(before);
      expect((await f.snapshot()).snapshot!.events).toBe(total);
    } finally { clock.mockRestore(); }
  });

  it('W10.03 repairs oversized valid state conditionally, preserves witnesses and resolves committed response loss', async () => {
    const stats = emptyStats();
    for (let i = 0; i < 300; i++) recordExposure(stats, 'i' + i, cell, T0, DEFAULT_STATS);
    const original = boundedStored(stats), scope = { tenant: 'coach', brand: 'coach', slot: 'hero' };
    for (const ambiguous of [false, true]) {
      const f = boundedStats(original);
      expect((await f.request('/snapshot')).status).toBe(503);
      const status = await (await f.request('/recovery', scope)).json() as { digest: string; generation: number };
      const repair = { ...scope, ...status, intent: 'coarsen', operationId: 'a'.repeat(32) };
      expect((await f.request('/recover', { ...repair, digest: '0'.repeat(64) })).status).toBe(409);
      expect(f.storage.map.get('learn')).toEqual(original);
      if (ambiguous) {
        const transaction = f.storage.transaction.bind(f.storage);
        vi.spyOn(f.storage, 'transaction').mockImplementationOnce(async fn => { await transaction(fn); throw new Error('committed response lost'); });
      }
      expect((await f.request('/recover', repair)).status).toBe(200);
      expect((await f.request('/recover', repair, new LearnStats(f.state, f.env))).status).toBe(200);
      const repaired = f.storage.map.get('learn') as { stats: StatsState };
      expect(repaired.stats.events).toBe(300); expect(repaired.stats.slot['*']!.n.s).toBe(300);
      expect(Object.values(repaired.stats.items).reduce((n, map) => n + map['*']!.n.s, repaired.stats.bounded!.omitted.n.s)).toBe(300);
      expect(f.storage.map.get('learnFence')).toEqual({ whole: 1, items: {} }); expect(f.published).toEqual([]);
      const healthy = await (await f.request('/health', scope)).json() as { witness: string };
      const snap = (await f.snapshot()).snapshot!; expect(snap.witness).toBe(healthy.witness);
      await f.request('/reset-item', { item: 'i0' });
      expect((await (await f.request('/health', scope)).json() as { witness: string }).witness).not.toBe(healthy.witness);
      expect((await f.request('/recover', repair)).status).toBe(409);
    }
    const f = boundedStats(original), expiresAt = Date.now() + 5000;
    const tagged = f.storage.map.get('learn') as Record<string, unknown>;
    tagged.effects = { ['b'.repeat(64)]: { digest: 'c'.repeat(64), subject: 'v1', ts: Date.now(), expiresAt, item: 'i0' } };
    const basis = await (await f.request('/recovery', scope)).json() as { digest: string; generation: number };
    const intent = { ...scope, ...basis, intent: 'coarsen', operationId: 'd'.repeat(32) };
    vi.spyOn(f.storage, 'setAlarm').mockRejectedValueOnce(new Error('Synthetic alarm failure'));
    expect((await f.request('/recover', intent)).status).toBe(503);
    expect((await f.request('/recover', intent, new LearnStats(f.state, f.env))).status).toBe(200);
    expect(f.storage.alarm).toBe(expiresAt);
    expect((f.storage.map.get('learn') as { effects: unknown }).effects).toEqual(tagged.effects);
  });
});

describe('W10.01 application learning budgets', () => {
  afterEach(() => invalidateCache());
  const row = { item: 'A', cell, ts: T0 };
  const shortCell: Cell = { channel: 'c', visit_bucket: '1', region: null, affinity: null };

  it('W10.01 refuses bounded-input and whole candidate overflow before any partial learning commit', async () => {
    const f = boundedStats();
    expect(await (await f.post([row, null])).json()).toMatchObject({ ok: true, receipt: { received: 2, processed: 1, skipped: 1 } });
    const before = structuredClone(f.storage.map.get('learn')), put = vi.spyOn(f.storage, 'put'), alarm = f.storage.alarm;
    const prototype = Object.getOwnPropertyNames(Object.prototype);
    for (const bad of [
      { ...row, item: '__proto__' }, { ...row, item: 'constructor' }, { ...row, item: 'toString' },
      { ...row, item: 'x'.repeat(257) }, { ...row, cell: { ...cell, channel: 'x'.repeat(257) } },
      { ...row, cell: 'bad' },
    ]) {
      expect((await f.post([row, bad])).status).toBe(400);
    }
    expect((await f.post([{ ...row, reward: 'constructor' }], 'credits')).status).toBe(400);
    expect((await f.post([{ ...row, reward: 'click', weight: '1e999' }], 'credits')).status).toBe(400);
    expect((await f.post([row], 'exposures', { tenant: 'other' })).status).toBe(503);
    expect((await f.post(Array.from({ length: 1001 }, () => null))).status).toBe(413);
    const oversized = await f.object.fetch(new Request('https://learn/exposures', { method: 'POST', headers: { 'Content-Length': '1' },
      body: JSON.stringify({ exposures: [row], padding: '界'.repeat(LEARN_LIMITS.requestBytes / 2) }) }));
    expect(oversized.status).toBe(413); expect(await oversized.json()).toEqual({ ok: false, error: 'statistics capacity exceeded', applied: false });
    expect((await f.object.fetch(new Request('https://learn/exposures', { method: 'POST', body: '{' }))).status).toBe(400);
    expect(put).not.toHaveBeenCalled(); expect(f.storage.map.get('learn')).toEqual(before); expect(f.storage.alarm).toBe(alarm);
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(prototype);

    const items = emptyStats();
    for (let i = 0; i < LEARN_LIMITS.items; i++) recordExposure(items, 'item' + i, shortCell, T0, DEFAULT_STATS);
    const full = boundedStats(boundedStored(items)), fullPut = vi.spyOn(full.storage, 'put');
    const batch = [{ ...row, item: 'item0', cell: shortCell }, { ...row, item: 'new-item', cell: shortCell }];
    const statuses: number[] = [];
    const ns = { idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init: RequestInit) => {
      const response = await full.object.fetch(new Request(url, init)); statuses.push(response.status); return response;
    } }) } as unknown as DurableObjectNamespace;
    expect(await deliverStats(ns, 'coach:coach:hero', 'exposures', { tenant: 'coach', brand: 'coach', slot: 'hero', config: boundedConfig, exposures: batch }, 2))
      .toMatchObject({ acknowledged: 0, unknown: 1, processed: 0, rowsUnknown: 2 });
    expect(statuses).toEqual([413]); expect(fullPut).not.toHaveBeenCalled(); expect(full.storage.map.get('learn')).toEqual(boundedStored(items));
    expect((await full.post([batch[0]])).status).toBe(200); // Existing cells remain usable after refusal.

    const keys = emptyStats();
    for (let i = 0; i < 2043; i++) recordExposure(keys, 'A', { ...shortCell, affinity: 'a' + i }, T0, DEFAULT_STATS);
    expect(Object.keys(keys.items.A!).length + Object.keys(keys.slot).length).toBe(4096);
    expect(boundedBytes(boundedStored(keys))).toBeLessThan(LEARN_LIMITS.stateBytes);
    const keyFull = boundedStats(boundedStored(keys)), keyPut = vi.spyOn(keyFull.storage, 'put');
    expect((await keyFull.post([{ ...row, cell: { ...shortCell, affinity: 'one-more' } }])).status).toBe(413);
    expect(keyPut).not.toHaveBeenCalled(); expect(keyFull.storage.map.get('learn')).toEqual(boundedStored(keys));

    const large = emptyStats(), textCell = (i: number) => ({ ...shortCell, affinity: '界'.repeat(200) + i });
    for (let i = 0; i < 320; i++) recordExposure(large, 'A', textCell(i), T0, DEFAULT_STATS);
    const more = Array.from({ length: 100 }, (_, i) => ({ ...row, cell: textCell(i + 320) }));
    const candidate = structuredClone(large); for (const r of more) recordExposure(candidate, r.item, r.cell, r.ts, DEFAULT_STATS);
    expect(boundedBytes(boundedStored(large))).toBeLessThan(LEARN_LIMITS.stateBytes);
    expect(boundedBytes(boundedStored(candidate))).toBeGreaterThan(LEARN_LIMITS.stateBytes);
    const byteFull = boundedStats(boundedStored(large)), bytePut = vi.spyOn(byteFull.storage, 'put');
    expect((await byteFull.post(more)).status).toBe(413); expect(bytePut).not.toHaveBeenCalled();
    expect(byteFull.storage.map.get('learn')).toEqual(boundedStored(large));
  });

  it('W10.01 protects restart/reset ambiguity and bounds actual prior expansion and public snapshots', async () => {
    const healthy = emptyStats(); for (const item of ['A', 'B']) recordExposure(healthy, item, shortCell, T0, DEFAULT_STATS);
    for (const committed of [false, true]) for (const reset of ['item', 'all']) {
      const f = boundedStats(boundedStored(healthy)); await f.snapshot();
      if (reset === 'item') vi.spyOn(f.storage, 'put').mockImplementationOnce(async (key, value) => {
        if (committed) f.storage.map.set(key, structuredClone(value)); throw new Error('synthetic ambiguous save');
      });
      else vi.spyOn(f.storage, 'deleteAll').mockImplementationOnce(async () => {
        if (committed) f.storage.map.clear(); throw new Error('synthetic ambiguous delete');
      });
      expect((await f.request(reset === 'item' ? '/reset-item' : '/reset', reset === 'item' ? { item: 'A' } : {})).status).toBe(503);
      for (const obj of [f.object, new LearnStats(f.state, f.env)]) {
        const snap = (await f.snapshot(obj)).snapshot;
        if (reset === 'all' && committed) expect(snap).toBeNull();
        else expect(Object.keys(snap!.items).sort()).toEqual(committed ? ['B'] : ['A', 'B']);
      }
      expect(f.published).toEqual([]);
    }
    const malformed = [null, false, {}, { ...boundedStored(healthy), tenant: '' },
      { ...boundedStored(healthy), stats: { ...healthy, events: -1 } },
      { ...boundedStored(healthy), stats: { ...healthy, items: JSON.parse('{"constructor":{}}') } },
      { ...boundedStored(healthy), stats: { ...healthy, items: Object.fromEntries(Array.from({ length: 257 }, (_, i) => ['i' + i, {}])) } }];
    for (const initial of malformed) {
      const f = boundedStats(initial), put = vi.spyOn(f.storage, 'put');
      for (const res of [await f.request('/snapshot'), await f.request('/publish', {}), await f.post([row])]) {
        expect(res.status).toBe(503); expect(await res.json()).toMatchObject({ error: 'statistics recovery required' });
      }
      await expect(f.object.alarm()).rejects.toThrow('statistics recovery required');
      expect(put).not.toHaveBeenCalled(); expect(f.published).toEqual([]); expect(f.storage.map.get('learn')).toEqual(initial);
      expect((await f.request('/reset', {})).status).toBe(200); expect((await f.snapshot()).snapshot).toBeNull();
    }

    const f = boundedStats(boundedStored(healthy));
    const prior = (item: string, key = '*') => ({ slot: 'hero', item, cell: key, p_prior: 0.1, n_equiv: 1 });
    f.prior([prior('P', 'c=other|v=1')]);
    const snapshot = (await f.snapshot()).snapshot!;
    expect(snapshot).not.toHaveProperty('stats'); expect(snapshot).not.toHaveProperty('config');
    expect(snapshot.items.P).toHaveProperty('c=other|v=1');
    expect(snapshot.items).not.toHaveProperty('P|c=other');
    expect(boundedBytes(snapshot)).toBeLessThanOrEqual(LEARN_LIMITS.snapshotBytes);
    expect(buildSnapshot(healthy, boundedStored(healthy), 'click', T0, DEFAULT_STATS)).not.toHaveProperty('stats');
    expect((await f.request('/publish', {})).status).toBe(200); expect(f.published).toHaveLength(1);
    expect(JSON.parse(f.published[0]!)).not.toHaveProperty('config');
    const priorCases = [
      Array.from({ length: 255 }, (_, i) => prior('P' + i, 'c=other|v=1')),
      Array.from({ length: 4097 }, (_, i) => prior('i' + i)),
      Array.from({ length: 1000 }, (_, i) => prior('界'.repeat(90) + i)),
      [prior('P', 'c=x|v=1|s=x|r=x|a=x|f=x|g=x')], [prior('P', 'c=' + '界'.repeat(1000))], [prior('constructor')],
    ];
    for (const rows of priorCases) {
      f.prior(rows); const before = [...f.cache.store], publications = f.published.length;
      expect((await f.request('/snapshot')).status).toBe(413); expect((await f.request('/publish', {})).status).toBe(413);
      await expect(f.object.alarm()).rejects.toThrow();
      expect([...f.cache.store]).toEqual(before); expect(f.published).toHaveLength(publications);
    }
    // After deleting A, B plus 256 distinct real prior items still exceed the union budget.
    const extra = boundedStats(boundedStored(healthy)); extra.prior(Array.from({ length: 256 }, (_, i) => prior('P' + i, 'c=other|v=1')));
    const res = await extra.request('/reset-item', { item: 'A' });
    expect(res.status).toBe(503); expect(await res.json()).not.toHaveProperty('applied');
    expect((extra.storage.map.get('learn') as { stats: StatsState }).stats.items).not.toHaveProperty('A');
  });
});

describe('the objects', () => {
  const record = (id: string, slot: string, item: string, ts: number): DecisionRecord => ({
    retention: captureRetention(onlineFixtureEnv, 'coach', Math.min(ts, Date.now())),
    decision_id: `coach:${ts.toString(36)}:v1:home:${slot}:${id}`, tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: 's1', identity_anchor: 'visitor', ts, page: 'home', slot, position: 0,
    item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm: 'personalized', explored: false, authority: 'engine',
    versions: { config: 1, lift: 0, prior: 0, policy: 0 }, config_label: 'v1', explain: { drivers: [], score_base: 0.5, score_final: 0.5, lift: null },
  });
  const barrier = (erased_at: number) => ({ tenant: 'coach', visitor_id: 'v1', erased_at, actor: 'ops', rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 });
  const saved = (ring: DecisionRecord[]) => ({ ring, index: ring.map(r => ({ id: r.decision_id, ts: r.ts, retention: r.retention?.online })) });

  it('W26.02 narrows explicit outcomes to one owned receipt without changing exposure or repeated credit counts', async () => {
    const now = Date.now() - 5000;
    const first = { ...record('first', 'hero', 'A', now), featured_product_ids: ['bag-1'] };
    const later = { ...record('later', 'hero', 'A', now + 1), page: 'other', position: 1 };
    const rail = record('rail', 'rail', 'A', now + 2), rows = [first, later, rail], entries = rows.map(ringEntryOf);
    const named: OutcomeRecord = { ...outcome('click', 'A', now + 1000), decision_id: first.decision_id };
    expect(attribute(named, entries, DEFAULT_POLICY).map(c => c.decision_id)).toEqual([first.decision_id]);
    expect(attribute(named, entries, { ...DEFAULT_POLICY, credit: 'first', match: 'any' }).map(c => c.decision_id)).toEqual([first.decision_id]);
    const legacy = { ...named }; delete legacy.decision_id;
    expect(attribute(legacy, entries, DEFAULT_POLICY).map(c => c.decision_id)).toEqual([rail.decision_id, later.decision_id]);
    expect(attribute({ ...named, item_id: null, products: ['bag-1'] }, entries, DEFAULT_POLICY)).toHaveLength(1);
    for (const delta of [{ item_id: 'B' }, { item_id: null, products: ['wrong'] }, { slot: 'rail' }, { session_id: 'other' },
      { ts: now - 1 }, { ts: now + 31 * 60_000 }, { tenant: 'other' }, { visitor_id: 'other' }, { brand: 'other' }]) {
      expect(attribute({ ...named, ...delta }, entries, DEFAULT_POLICY)).toEqual([]);
    }
    for (const ref of ['', null, 7, first.decision_id + ' ', first.decision_id + ':unknown', 'other:' + first.decision_id.split(':').slice(1).join(':')]) {
      expect(attribute({ ...named, decision_id: ref } as OutcomeRecord, entries, DEFAULT_POLICY)).toEqual([]);
    }
    for (const changed of [{ brand: 'other' }, { tenant: 'other' }, { visitor_id: 'other' }, { ts: now + 1 }]) {
      expect(attribute(named, [{ ...entries[0]!, ...changed }], DEFAULT_POLICY)).toEqual([]);
    }
    for (const duplicate of [entries[0]!, { ...entries[0]!, item: 'B' }, { ...entries[0]!, arm: 'default' }, { ...entries[0]!, brand: 'other' }]) {
      expect(attribute(named, [...entries, duplicate], DEFAULT_POLICY)).toEqual([]);
    }
    const historical = { ...entries[0]! }; delete historical.tenant; delete historical.visitor_id;
    expect(attribute(named, [historical], DEFAULT_POLICY)).toHaveLength(1);
    delete historical.brand; expect(attribute(named, [historical], DEFAULT_POLICY)).toEqual([]);

    class ClonedStorage extends FakeStorage {
      async get(key: string) { return structuredClone(this.map.get(key)); }
      async put(key: string, value: unknown) { this.map.set(key, structuredClone(value)); }
    }
    const targets = new Map<string, { storage: ClonedStorage; object: LearnStats }>();
    for (const slot of ['hero', 'rail']) {
      const storage = new ClonedStorage(), object = new LearnStats({ storage } as unknown as DurableObjectState, {} as Env);
      const response = await object.fetch(new Request('https://learn/exposures', { method: 'POST', body: JSON.stringify({
        tenant: 'coach', brand: 'coach', slot, config: boundedConfig,
        exposures: rows.filter(r => r.slot === slot).map(r => ({ item: r.item_id, cell, ts: r.ts })),
      }) }));
      expect(response.status).toBe(200); targets.set('coach:coach:' + slot, { storage, object });
    }
    const forwarded: string[] = [];
    const env = { STORAGE: { get: async () => null }, LEARN_STATS: { idFromName: (name: string) => name,
      get: (name: string) => ({ fetch: (url: string, init?: RequestInit) => {
        forwarded.push(name); return targets.get(name)!.object.fetch(new Request(url, init));
      } }) } } as unknown as Env;
    const storage = new ClonedStorage(), ring = new DecisionRing({ storage } as unknown as DurableObjectState, env);
    const request = (path: string, body: unknown) => ring.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
    expect((await request('/append', { records: rows })).status).toBe(200);
    const before = [...targets.values()].map(t => structuredClone(t.storage.map.get('learn')));
    const credit = (o: OutcomeRecord) => request('/outcome', { tenant: 'coach', brand: 'coach', outcome: o, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig });
    expect(await (await credit({ ...named, decision_id: named.decision_id + ':absent' })).json()).toMatchObject({ credits: 0 });
    expect([...targets.values()].map(t => t.storage.map.get('learn'))).toEqual(before);
    for (let n = 0; n < 2; n++) expect(await (await credit(named)).json()).toMatchObject({ credits: 1, receipt: { eligible: 1, credits: { processed: 1 } } });
    expect(forwarded).toEqual(['coach:coach:hero', 'coach:coach:hero']);
    const hero = (targets.get('coach:coach:hero')!.storage.map.get('learn') as { stats: StatsState }).stats;
    expect(hero.items.A!['*']!.n).toEqual((before[0] as { stats: StatsState }).stats.items.A!['*']!.n);
    expect(hero.items.A!['*']!.s.click).toEqual({ s: 2, t: named.ts });
    expect(targets.get('coach:coach:rail')!.storage.map.get('learn')).toEqual(before[1]);
    for (const duplicate of [first, { ...first, arm: 'default' as const }, { ...first, brand: 'other' }]) {
      const f = storedRing(saved([...rows, duplicate]));
      expect(await (await f.credit(named)).json()).toMatchObject({ credits: 0 });
      expect(f.forwarded).not.toHaveBeenCalled();
    }
    const holdout = storedRing(saved([{ ...first, arm: 'default' }]));
    expect(await (await holdout.credit(named)).json()).toMatchObject({ credits: 0 });
    expect(holdout.forwarded).not.toHaveBeenCalled();
  });

  it('W26.01 contains named direct item and product credits through the actual ring and statistics objects', async () => {
    const entries = [entry('first', 'hero', 'A', T0), entry('rail', 'rail', 'A', T0 + 1), entry('last', 'hero', 'A', T0 + 2)]
      .map(e => ({ ...e, products: ['bag-1'] }));
    const named = { ...outcome('click', 'A', T0 + 60_000), slot: 'hero' };
    for (const type of ['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'] as const) {
      for (const match of [{ item_id: 'A', products: null }, { item_id: null, products: ['bag-1'] }]) {
        const o = { ...named, ...match, type };
        expect(attribute(o, entries, DEFAULT_POLICY).map(c => c.decision_id)).toEqual(['last']);
        expect(attribute(o, entries, { ...DEFAULT_POLICY, credit: 'first' }).map(c => c.decision_id)).toEqual(['first']);
        expect(attribute({ ...o, slot: 'absent' }, entries, DEFAULT_POLICY)).toEqual([]);
      }
    }
    for (const slot of ['Hero', ' hero ', 'Unknown']) expect(attribute({ ...named, slot }, entries, DEFAULT_POLICY)).toEqual([]);
    for (const slot of [null, undefined, '', ' \t ', 'unknown']) {
      const o = { ...named, slot } as OutcomeRecord;
      if (slot === undefined) delete (o as Partial<OutcomeRecord>).slot;
      expect(attribute(o, entries, DEFAULT_POLICY).map(c => c.decision_id)).toEqual(['last', 'rail']);
    }
    expect(attribute({ ...named, item_id: 'unmatched' }, entries, DEFAULT_POLICY)).toEqual([]);
    expect(attribute({ ...named, session_id: 'other' }, entries, DEFAULT_POLICY)).toEqual([]);
    expect(attribute({ ...named, ts: T0 - 1 }, entries, DEFAULT_POLICY)).toEqual([]);
    expect(attribute({ ...named, ts: T0 + 31 * 60_000 }, entries, DEFAULT_POLICY)).toEqual([]);
    expect(attribute(named, entries, { ...DEFAULT_POLICY, match: 'any' }).map(c => c.decision_id)).toEqual(['last', 'rail']);
    expect(attribute({ ...named, slot: 'absent', item_id: 'unmatched' }, entries,
      { ...DEFAULT_POLICY, match: 'any', credit: 'first' }).map(c => c.decision_id)).toEqual(['first', 'rail']);

    class ClonedStorage extends FakeStorage {
      async get(key: string) { return structuredClone(this.map.get(key)); }
      async put(key: string, value: unknown) { this.map.set(key, structuredClone(value)); }
    }
    for (const reward of ['click', 'purchase'] as const) {
      const now = Date.now() - 5000, config = { reward, stats: DEFAULT_STATS };
      const rows = [record('hero', 'hero', reward === 'click' ? 'A' : 'story-hero', now),
        record('rail', 'rail', reward === 'click' ? 'A' : 'story-rail', now + 1)]
        .map(r => ({ ...r, featured_product_ids: ['bag-1'] }));
      expect(new Set(rows.map(r => r.decision_id)).size).toBe(2);
      const targets = new Map<string, { storage: ClonedStorage; object: LearnStats }>();
      for (const row of rows) {
        const storage = new ClonedStorage(), object = new LearnStats({ storage } as unknown as DurableObjectState, {} as Env);
        const res = await object.fetch(new Request('https://learn/exposures', { method: 'POST', body: JSON.stringify({
          tenant: 'coach', brand: 'coach', slot: row.slot, config, exposures: [{ item: row.item_id, cell, ts: row.ts }],
        }) }));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, receipt: { received: 1, processed: 1, skipped: 0, alarm: 'scheduled' } });
        targets.set('coach:coach:' + row.slot, { storage, object });
      }
      const forwarded: string[] = [];
      const env = { STORAGE: { get: async () => null }, LEARN_STATS: { idFromName: (name: string) => name,
        get: (name: string) => ({ fetch: (url: string, init?: RequestInit) => {
          forwarded.push(name); return targets.get(name)!.object.fetch(new Request(url, init));
        } }) } } as unknown as Env;
      const ring = new DecisionRing({ storage: new ClonedStorage() } as unknown as DurableObjectState, env);
      const request = (path: string, body: unknown) => ring.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
      expect(await (await request('/append', { records: rows })).json()).toMatchObject({ ok: true, ring: 2, receipt: { accepted: 2 } });
      const before = [...targets.values()].map(t => structuredClone(t.storage.map.get('learn')));
      for (const [i, slot] of ['absent', 'hero'].entries()) {
        const o = outcomeFromAction({ type: reward, userId: 'v1', sessionId: 's1', timestamp: now + 1000 + i,
          data: { slot, ...(reward === 'click' ? { contentId: 'A' } : { items: [{ productId: 'bag-1' }] }) } }, 'coach')!;
        expect(o.slot).toBe(slot);
        expect(o.type).toBe(reward);
        expect(o.products).toEqual(reward === 'purchase' ? ['bag-1'] : null);
        const res = await request('/outcome', { tenant: 'coach', brand: 'coach', outcome: o, policy: DEFAULT_POLICY, defaultSlotConfig: config });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, credits: i, receipt: { attributed: i, eligible: i, weightSkipped: 0,
          credits: { destinations: i, acknowledged: i, received: i, processed: i, skipped: 0, unknown: 0, notAttempted: 0, alarmsUnknown: 0 } } });
        if (i === 0) {
          expect(forwarded).toEqual([]);
          expect([...targets.values()].map(t => t.storage.map.get('learn'))).toEqual(before);
        }
      }
      expect(forwarded).toEqual(['coach:coach:hero']);
      const hero = targets.get('coach:coach:hero')!.storage.map.get('learn') as { stats: StatsState };
      expect(hero.stats.items[rows[0]!.item_id]!['*']!.s[reward]).toEqual({ s: 1, t: now + 1001 });
      expect(hero.stats.items[rows[0]!.item_id]!['*']!.n).toEqual({ s: 1, t: now });
      expect(hero.stats.events).toBe(1);
      expect(targets.get('coach:coach:rail')!.storage.map.get('learn')).toEqual(before[1]);
    }
  });

  function storedRing(initial: unknown) {
    const storage = new FakeStorage(); storage.map.set('ring', structuredClone(initial));
    const put = vi.spyOn(storage, 'put'), get = vi.fn(async (_key: string): Promise<{ text(): Promise<string> } | null> => null);
    const forwarded = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    const env = { ...onlineFixtureEnv, STORAGE: { get }, LEARN_STATS: { idFromName: (name: string) => name, get: () => ({ fetch: forwarded }) } } as unknown as Env;
    const ring = new DecisionRing({ storage } as unknown as DurableObjectState, env);
    const request = (path: string, body?: unknown) => ring.fetch(new Request('https://learn' + path,
      body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }));
    const credit = (o: OutcomeRecord) => request('/outcome', { tenant: 'coach', brand: 'coach', outcome: o, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig });
    return { storage, put, get, forwarded, env, request, credit };
  }

  function boundedRing(initial: unknown = saved([])) {
    class Storage extends FakeStorage {
      async get(key: string) { return structuredClone(this.map.get(key)); }
      async put(key: string, value: unknown) {
        if (boundedBytes(value) > RING_LIMITS.stateBytes) throw new Error('synthetic application storage ceiling');
        this.map.set(key, structuredClone(value));
      }
    }
    const storage = new Storage(); storage.map.set('ring', structuredClone(initial));
    const put = vi.spyOn(storage, 'put'), get = vi.fn(async (): Promise<null> => null);
    const forwarded = vi.fn(async () => Response.json({ ok: true }));
    const env = { ...onlineFixtureEnv, STORAGE: { get }, LEARN_STATS: { idFromName: (name: string) => name, get: () => ({ fetch: forwarded }) } } as unknown as Env;
    const state = { storage } as unknown as DurableObjectState, ring = new DecisionRing(state, env);
    const request = (path: string, body?: unknown, target = ring) => target.fetch(new Request('https://learn' + path,
      body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }));
    return { storage, put, get, forwarded, env, state, ring, request };
  }

  it('W10.03 repairs only proved ring duplication/index gaps and preserves retained plan debt across restart', async () => {
    const row = record('repair', 'hero', 'A', Date.now()), original = { ring: Array.from({ length: 201 }, () => row), index: [] };
    const f = boundedRing(original), scope = { tenant: 'coach', visitorId: 'v1' };
    const planExpiry = Date.now() + 5000;
    const debt = { version: 1, digest: 'c'.repeat(64), generation: 0, tenant: 'coach', subject: 'v1', ts: row.ts,
      retention: row.retention!.online!, consentUntil: planExpiry, plan: { batches: [] }, completed: {} };
    f.storage.map.set('creditPlan:' + 'b'.repeat(64), debt);
    const status = await (await f.request('/recovery', scope)).json() as { digest: string; generation: number };
    expect((await f.request('/recent')).status).toBe(503);
    const intent = { ...scope, ...status, intent: 'compact', operationId: 'c'.repeat(32) };
    vi.spyOn(f.storage, 'setAlarm').mockRejectedValueOnce(new Error('Synthetic alarm failure'));
    expect((await f.request('/recover', intent)).status).toBe(503);
    expect((await f.request('/recover', intent, new DecisionRing(f.state, f.env))).status).toBe(200);
    expect((f.storage.map.get('ring') as { ring: DecisionRecord[] }).ring).toEqual([row]);
    expect((f.storage.map.get('ring') as { index: unknown[] }).index).toHaveLength(1);
    expect(f.storage.map.get('creditPlan:' + 'b'.repeat(64))).toEqual(debt);
    expect(f.storage.map.get('creditGeneration')).toBe(1);
    expect(f.storage.alarm).toBe(planExpiry);
    const conflict = boundedRing({ ring: [row, { ...row, item_id: 'different' }], index: [] });
    const basis = await (await conflict.request('/recovery', scope)).json() as { digest: string; generation: number };
    expect((await conflict.request('/recover', { ...intent, ...basis })).status).toBe(409);
    expect(conflict.storage.map.get('ring')).toEqual({ ring: [row, { ...row, item_id: 'different' }], index: [] });
  });

  it('W06.12 expires actual ring and index-only copies on alarm without deleting untagged history or another owner', async () => {
    const now = Date.now(), expiryEnv = { ...onlineFixtureEnv, RETENTION: JSON.stringify({ version: 1, tenants: { coach: { online: {
      id: 'short-fixture', revision: 1, durationMs: 1000, basis: 'admitted', renewal: 'new-record-only' } } } }) };
    const row = record('expiry', 'hero', 'A', now); row.retention = { online: retentionBirth(expiryEnv, 'coach', 'online', now, now) };
    const old = record('legacy', 'hero', 'B', now); delete old.retention;
    const f = boundedRing(saved([row, old])); Object.assign(f.env, expiryEnv);
    expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: [row], index: 1 });
    expect(f.storage.map.get('ring')).toEqual(saved([row, old]));
    vi.useFakeTimers(); vi.setSystemTime(now + 1000);
    try {
      await f.ring.alarm();
      expect(f.storage.map.get('ring')).toEqual(saved([old]));
      expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: [], index: 0 });
      const indexOnly = boundedRing({ ring: [], index: saved([row]).index }); Object.assign(indexOnly.env, expiryEnv);
      await indexOnly.ring.alarm(); expect(indexOnly.storage.map.get('ring')).toEqual({ ring: [], index: [] });
      const foreign = boundedRing(saved([{ ...row, tenant: 'harbor' }])); Object.assign(foreign.env, expiryEnv);
      const before = structuredClone(foreign.storage.map);
      await expect(foreign.ring.alarm()).rejects.toThrow(); expect(foreign.storage.map).toEqual(before); expect(foreign.put).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('W22.04 reconciles detached surviving decisions before either sink and accounts for physical copies', async () => {
    const now = Date.now() - 1000;
    const make = () => {
      const f = boundedRing(), targets = new Map<string, ReturnType<typeof boundedStats>>();
      const ringFetch = vi.fn((url: string, init?: RequestInit) => f.ring.fetch(new Request(url, init)));
      const statsFetch = vi.fn((name: string, url: string, init?: RequestInit) => {
        let target = targets.get(name);
        if (!target) { target = boundedStats(); targets.set(name, target); }
        return target.object.fetch(new Request(url, init));
      });
      f.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: ringFetch }) } as unknown as DurableObjectNamespace;
      f.env.LEARN_STATS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: (url: string, init?: RequestInit) => statsFetch(name, url, init) }) } as unknown as DurableObjectNamespace;
      const config = vi.fn(() => boundedConfig);
      const send = (records: unknown[]) => fanDecisions(f.env, { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: records as DecisionRecord[] }, config);
      return { ...f, targets, ringFetch, statsFetch, config, send };
    };
    const provenance = (ordinal: number) => ({ id: '00000000-0000-4000-8000-000000000001', ordinal });
    const a = { ...record('coalesce', 'hero', 'A', now), extra: { nested: [null, 0, false, { value: 'exact' }] }, _ledger_delivery: provenance(0) };
    const reordered = { ...Object.fromEntries(Object.entries(a).reverse()),
      cell: Object.fromEntries(Object.entries(a.cell).reverse()), _ledger_delivery: provenance(1) };
    const b = record('distinct', 'hero', 'A', now), holdout = { ...record('holdout', 'hero', 'A', now), arm: 'default' as const };
    const noLearning = { ...record('no-learning', 'hero', 'A', now), arm: 'no_learning' as const };
    const rail = record('rail', 'rail', 'B', now), f = make();
    const good = await f.send([a, reordered, a, b, holdout, holdout, noLearning, rail]);
    expect(good).toMatchObject({ version: 1, ok: true, received: 8, cutoffSkipped: 0, coalesced: 3,
      append: { received: 5, accepted: 5, duplicates: 0 }, exposures: { received: 3, processed: 3 } });
    expect(f.storage.map.get('ring')).toEqual(saved([a, b, holdout, noLearning, rail]));
    expect(f.config.mock.calls).toHaveLength(2);
    const hero = f.targets.get('coach:coach:hero')!.storage.map.get('learn') as { stats: StatsState };
    expect(hero.stats.events).toBe(2); expect(hero.stats.slot['*']!.n).toEqual({ s: 2, t: now });
    expect(JSON.stringify(hero)).not.toContain('visitor_id'); expect(JSON.stringify(hero)).not.toContain('decision_id');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportLearningIncomplete('decisions', { ...good, ok: false });
    expect(warning).toHaveBeenCalledWith('learning_incomplete', expect.objectContaining({ coalesced: 3 })); warning.mockRestore();

    for (const changed of [{ ...a, item_id: 'other' }, { ...a, arm: 'default' }, { ...a, slot: 'other' },
      { ...a, extra: { nested: [false, 0, null, { value: 'exact' }] } }, { ...a, explain: { ...a.explain, newField: true } },
      { ...a, nestedProvenance: provenance(0) }]) {
      const held = make();
      expect(await held.send([b, b, a, changed])).toMatchObject({ ok: false, code: 'invalid', received: 4, coalesced: 0 });
      expect(held.config).not.toHaveBeenCalled(); expect(held.ringFetch).not.toHaveBeenCalled(); expect(held.statsFetch).not.toHaveBeenCalled();
      expect(held.storage.map.get('ring')).toEqual(saved([]));
    }
    const erased = make(); erased.get.mockResolvedValue({ text: async () => JSON.stringify(barrier(now)) } as never);
    const fresh = record('fresh', 'hero', 'A', now + 1);
    expect(await erased.send([a, { ...a, item_id: 'erased-conflict' }, fresh, fresh]))
      .toMatchObject({ ok: true, received: 4, cutoffSkipped: 2, coalesced: 1, append: { received: 1 }, exposures: { processed: 1 } });
    expect(erased.storage.map.get('ring')).toEqual(saved([fresh]));

    const held = make(); let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    held.get.mockImplementationOnce(async () => { await waiting; return null; });
    const mutable = structuredClone(a), set = { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [mutable, mutable] };
    const pending = fanDecisions(held.env, set, held.config);
    mutable.item_id = 'changed'; mutable.extra.nested = []; set.records.length = 0;
    set.tenant = 'other'; set.brand = 'other'; set.visitor_id = 'other';
    release(); expect(await pending).toMatchObject({ ok: true, received: 2, coalesced: 1, append: { received: 1 }, exposures: { processed: 1 } });
    expect(held.storage.map.get('ring')).toEqual(saved([a]));
    expect([...held.targets.keys()]).toEqual(['coach:coach:hero']);

    const pushed = make(), pushing: unknown[] = Array.from({ length: FAN_LIMITS.rows }, () => a);
    pushing[0] = { ...a, toJSON() { pushing.push(b); return a; } };
    expect(await pushed.send(pushing)).toMatchObject({ ok: true, received: FAN_LIMITS.rows, coalesced: FAN_LIMITS.rows - 1,
      append: { received: 1 }, exposures: { received: 1, processed: 1 } });
    expect(pushing).toHaveLength(FAN_LIMITS.rows + 1);
    expect(pushed.storage.map.get('ring')).toEqual(saved([a]));
    expect((pushed.targets.get('coach:coach:hero')!.storage.map.get('learn') as { stats: StatsState }).stats.events).toBe(1);
    const shrunk = make(), shrinking: unknown[] = [{ ...a, toJSON() { shrinking.length = 1; return a; } }, b];
    expect(await shrunk.send(shrinking)).toMatchObject({ ok: true, received: 2, coalesced: 0,
      append: { received: 2 }, exposures: { received: 2, processed: 2 } });
    expect(shrinking).toHaveLength(1);
    expect(shrunk.storage.map.get('ring')).toEqual(saved([a, b]));
    expect((shrunk.targets.get('coach:coach:hero')!.storage.map.get('learn') as { stats: StatsState }).stats.events).toBe(2);

    const cyclic = { ...a, loop: {} }; cyclic.loop = cyclic;
    const disguised = { ...a, brand: 'other', toJSON() { this.brand = 'coach'; return a; } };
    const huge = { ...a, extra: 'é'.repeat(FAN_LIMITS.recordBytes / 2) };
    const work = { ...a, extra: Array.from({ length: 200_000 }, () => 0) };
    for (const rows of [new Array(1), [null], [{ ...a, _ledger_delivery: undefined }], [{ ...a, _ledger_delivery: { ...provenance(0), extra: true } }],
      [{ ...a, visitor_id: 'other' }], [disguised], [cyclic], Array.from({ length: FAN_LIMITS.rows + 1 }, () => a), [huge], [work, work, work, work]]) {
      const refused = make();
      expect(await refused.send(rows)).toMatchObject({ ok: false, code: 'invalid', coalesced: 0 });
      expect(refused.config).not.toHaveBeenCalled(); expect(refused.ringFetch).not.toHaveBeenCalled(); expect(refused.statsFetch).not.toHaveBeenCalled();
      if (rows[0] !== work) expect(refused.get).not.toHaveBeenCalled();
    }
    const boundary = make();
    expect(await boundary.send(Array.from({ length: FAN_LIMITS.rows }, () => a)))
      .toMatchObject({ ok: true, received: FAN_LIMITS.rows, coalesced: FAN_LIMITS.rows - 1, exposures: { processed: 1 } });
  });

  it('W22.04 refuses malformed online outcome identities before reads or credits and preserves nonce and legacy calls', async () => {
    const now = Date.now() - 1000, row = record('identity', 'hero', 'A', now), f = boundedRing(saved([row]));
    const stats = boundedStats();
    const creditFetch = vi.fn((url: string, init?: RequestInit) => stats.object.fetch(new Request(url, init)));
    const ringFetch = vi.fn((url: string, init?: RequestInit) => f.ring.fetch(new Request(url, init)));
    f.env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: creditFetch }) } as unknown as DurableObjectNamespace;
    f.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: ringFetch }) } as unknown as DurableObjectNamespace;
    const valid = outcomeFromAction({ type: 'content_click', userId: 'v1', sessionId: 's1', timestamp: now + 100,
      eventId: 'event-identity', eventIdSource: 'provided', data: { contentId: 'A', slot: 'hero', decisionId: row.decision_id } }, 'coach')!;
    valid.retention = captureRetention(onlineFixtureEnv, 'coach', valid.ts);
    const legacy = outcome('click', 'A', now + 100);
    const send = (o: unknown) => fanOutcome(f.env, 'coach', o as OutcomeRecord, DEFAULT_POLICY, 'coach', { hero: boundedConfig });
    const direct = (o: unknown) => f.request('/outcome', { tenant: 'coach', brand: 'coach', outcome: o, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig });
    expect(await send({ ...valid, brand: 'other', toJSON(this: { brand: string }) { this.brand = 'coach'; return valid; } }))
      .toMatchObject({ ok: false, code: 'invalid' });
    expect(f.get).not.toHaveBeenCalled(); expect(ringFetch).not.toHaveBeenCalled();
    for (const bad of [{ ...valid, event_id: '' }, { ...valid, event_id: null }, { ...valid, event_id_source: 'other' },
      { ...valid, event_id_source: null }, { ...valid, event_id: 'different' }, { ...valid, type: 'purchase' },
      { ...valid, outcome_id: valid.outcome_id + '-mismatch' }, { ...legacy, event_id_source: 'request' },
      { ...valid, _ledger_delivery: null }, { ...valid, _ledger_delivery: { id: 'bad', ordinal: 0 } }]) {
      expect(await send(bad)).toMatchObject({ ok: false, code: 'invalid' });
      expect((await direct(bad)).status).toBe(503);
      expect(f.get).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled();
      expect(ringFetch).not.toHaveBeenCalled(); expect(creditFetch).not.toHaveBeenCalled();
    }
    // Own undefined must refuse before JSON normalization can turn it into a legacy row.
    for (const bad of [{ ...legacy, event_id: undefined }, { ...legacy, event_id_source: undefined }, { ...legacy, _ledger_delivery: undefined }]) {
      expect(await send(bad)).toMatchObject({ ok: false, code: 'invalid' });
      expect(f.get).not.toHaveBeenCalled(); expect(ringFetch).not.toHaveBeenCalled(); expect(creditFetch).not.toHaveBeenCalled();
    }
    for (const accepted of [valid, valid, { ...valid, event_id_source: 'request' }, legacy, legacy]) {
      const result = await send(accepted);
      expect(result).toMatchObject({ ok: true, outcome: { attributed: 1, credits: { processed: 1 } } });
      expect(result).not.toHaveProperty('coalesced');
    }
    expect((stats.storage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.s.click).toEqual({ s: 5, t: now + 100 });
    expect(f.storage.map.get('ring')).toEqual(saved([row])); expect(f.put).not.toHaveBeenCalled();
    const mutable = structuredClone(valid); let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    f.get.mockImplementationOnce(async () => { await waiting; return null; });
    const pending = send(mutable); mutable.item_id = 'other'; mutable.visitor_id = 'other'; mutable.event_id = 'other';
    release(); expect(await pending).toMatchObject({ ok: true, outcome: { credits: { processed: 1 } } });
    expect((stats.storage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.s.click).toEqual({ s: 6, t: now + 100 });
  });

  it('W22.09 fences uncorrelated item product and any credits to the exact brand in actual statistics', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      for (const mode of ['item', 'product', 'any'] as const) for (const credit of ['first', 'last'] as const) {
        const tenant = 'meridian', ownBrand = 'alpha', foreignBrand = 'beta';
        const scoped = (id: string, brand: string, item: string, ts: number): DecisionRecord => {
          const row = record(id, 'hero', item, ts);
          return { ...row, tenant, brand, retention: captureRetention(onlineFixtureEnv, tenant, ts), decision_id: row.decision_id.replace(/^coach:/, tenant + ':'),
            ...(mode === 'product' ? { featured_product_ids: ['shared-product'] } : {}) };
        };
        const own = scoped('own', ownBrand, 'A', T0 - 200), foreignItem = mode === 'item' ? 'A' : 'B';
        // Either credit rule would choose a foreign candidate without the brand fence.
        const foreign = [scoped('early', foreignBrand, foreignItem, T0 - 300), scoped('late', foreignBrand, foreignItem, T0 - 100)];
        const f = boundedRing(), targets = new Map([[ownBrand, boundedStats()], [foreignBrand, boundedStats()]]);
        for (const [brand, target] of targets) expect((await target.request('/exposures', { tenant, brand, slot: 'hero', config: boundedConfig,
          exposures: [{ item: brand === ownBrand ? 'A' : foreignItem, cell, ts: T0 - 300 }] })).status).toBe(200);
        const before = new Map([...targets].map(([brand, target]) => [brand, structuredClone(target.storage.map.get('learn'))]));
        const sent: Array<{ name: string; url: string; body: unknown }> = [];
        f.env.LEARN_STATS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: string, init?: RequestInit) => {
          sent.push({ name, url, body: JSON.parse(String(init?.body)) });
          return targets.get(name.split(':')[1]!)!.object.fetch(new Request(url, init));
        } }) } as unknown as DurableObjectNamespace;
        const base = outcome('click', mode === 'product' ? null : mode === 'item' ? 'A' : 'unrelated', T0 - 50);
        const original: OutcomeRecord = { ...base, tenant, brand: ownBrand, retention: captureRetention(onlineFixtureEnv, tenant, base.ts), outcome_id: base.outcome_id.replace(/^coach:/, tenant + ':'),
          products: mode === 'product' ? ['shared-product'] : null };
        const policy = { ...DEFAULT_POLICY, credit, match: mode === 'any' ? 'any' as const : 'direct' as const };
        const send = () => f.request('/outcome', { tenant, brand: ownBrand, outcome: original, policy, defaultSlotConfig: boundedConfig });
        expect((await f.request('/append', { records: foreign })).status).toBe(200);
        expect(await (await send()).json()).toMatchObject({ ok: true, credits: 0, receipt: { attributed: 0, eligible: 0, credits: { destinations: 0, processed: 0 } } });
        expect(sent).toEqual([]);
        for (const [brand, target] of targets) expect(target.storage.map.get('learn')).toEqual(before.get(brand));
        expect((await f.request('/append', { records: [own] })).status).toBe(200);
        const retained = structuredClone(f.storage.map.get('ring'));
        expect(await (await send()).json()).toMatchObject({ ok: true, credits: 1,
          receipt: { attributed: 1, eligible: 1, credits: { acknowledged: 1, processed: 1, unknown: 0 } } });
        expect(sent).toEqual([{ name: 'meridian:alpha:hero', url: 'https://learn/credits', body: { tenant, brand: ownBrand, slot: 'hero', config: boundedConfig,
          credits: [{ decision_id: own.decision_id, slot: 'hero', item: 'A', cell, reward: 'click', event: 'click', ts: original.ts, weight: 1 }] } }]);
        const ownStored = targets.get(ownBrand)!.storage.map.get('learn') as { tenant: string; brand: string; stats: StatsState };
        expect(ownStored).toMatchObject({ tenant, brand: ownBrand });
        expect(ownStored.stats.items.A!['*']!.s.click).toEqual({ s: 1, t: original.ts });
        expect(ownStored.stats.items.A!['*']!.n).toEqual((before.get(ownBrand) as { stats: StatsState }).stats.items.A!['*']!.n);
        expect(ownStored.stats.items.B).toBeUndefined();
        expect(targets.get(foreignBrand)!.storage.map.get('learn')).toEqual(before.get(foreignBrand));
        expect(f.storage.map.get('ring')).toEqual(retained);
      }
    } finally { clock.mockRestore(); }
  });

  it('W22.08 retains newest occurrence times across arrival batches with stable ties and unaltered inputs', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const rows = Array.from({ length: 210 }, (_, i) => record(String(i), 'hero', 'A', T0 - 1000 + i));
      const interleaved = [...rows.filter((_, i) => i % 2), ...rows.filter((_, i) => !(i % 2)).reverse()];
      for (const ordered of [rows, [...rows].reverse(), interleaved]) for (const split of [false, true]) {
        const f = boundedRing(), input = structuredClone(ordered), batches = split ? [ordered.slice(0, 100), ordered.slice(100)] : [ordered];
        let received = 0;
        for (const batch of batches) {
          const previous = (f.ring as unknown as { data: ReturnType<typeof saved> | null }).data, untouched = structuredClone(previous);
          const response = await f.request('/append', { records: batch }); received += batch.length;
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ ok: true, ring: Math.min(200, received), receipt: { version: 2, kind: 'append',
            received: batch.length, accepted: batch.length, duplicates: 0, cutoffSkipped: 0, retained: Math.min(200, received), indexed: received } });
          expect(previous).toEqual(untouched);
        }
        expect(ordered).toEqual(input);
        expect(f.storage.map.get('ring')).toEqual({ ring: rows.slice(10), index: saved(ordered).index });
        expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: rows.slice(10), index: 210 });
      }
      // Reverse lexical IDs intentionally: timestamp ties preserve old-before-new/input order, not ID order.
      const sameTime = Array.from({ length: 200 }, (_, i) => record('z-' + i, 'hero', 'A', T0 - 100));
      const f = boundedRing(saved(sameTime)), incoming = [record('a-new', 'hero', 'A', T0 - 100), record('0-new', 'hero', 'A', T0 - 100)];
      await f.request('/recent');
      const previous = (f.ring as unknown as { data: ReturnType<typeof saved> }).data, unchanged = structuredClone(previous), input = structuredClone(incoming);
      Object.freeze(previous.ring); Object.freeze(previous.index); Object.freeze(incoming);
      for (const row of incoming) Object.freeze(row);
      const direct = f.ring as unknown as { append: (records: DecisionRecord[]) => Promise<unknown> };
      expect(await direct.append(incoming)).toEqual({ version: 2, kind: 'append', received: 2, accepted: 2,
        duplicates: 0, cutoffSkipped: 0, retained: 200, indexed: 202 });
      expect(previous).toEqual(unchanged); expect(incoming).toEqual(input);
      const retained = [...sameTime.slice(2), ...incoming];
      expect(f.storage.map.get('ring')).toEqual({ ring: retained, index: saved([...sameTime, ...incoming]).index });
      for (const credit of ['first', 'last'] as const) expect(attribute(outcome('click', 'A', T0), retained.map(ringEntryOf), { ...DEFAULT_POLICY, credit })[0]!.decision_id)
        .toBe(sameTime[2]!.decision_id);
    } finally { clock.mockRestore(); }
  });

  it('W22.08 forwards original-time correlated credit after older arrivals and object recreation', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const rows = Array.from({ length: 200 }, (_, i) => record(String(i), 'hero', 'A', T0 - 1000 + i)), target = rows[0]!;
      const late = Array.from({ length: 3 }, (_, i) => record('late-' + i, 'hero', 'A', target.ts - 100 - i));
      const f = boundedRing(), sent: Array<{ name: string; url: string; body: unknown }> = [];
      f.env.LEARN_STATS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: string, init?: RequestInit) => {
        sent.push({ name, url, body: JSON.parse(String(init?.body)) });
        return Response.json({ ok: true, receipt: { version: 1, kind: 'credits', received: 1, processed: 1, skipped: 0, alarm: 'scheduled' } });
      } }) } as unknown as DurableObjectNamespace;
      expect((await f.request('/append', { records: rows })).status).toBe(200);
      expect(await (await f.request('/append', { records: late })).json()).toMatchObject({ receipt: { received: 3, accepted: 3, retained: 200, indexed: 203 } });
      const persisted = structuredClone(f.storage.map.get('ring'));
      expect(persisted).toEqual({ ring: rows, index: saved([...rows, ...late]).index });
      const restarted = new DecisionRing(f.state, f.env);
      expect(await (await f.request('/recent', undefined, restarted)).json()).toEqual({ ok: true, ring: rows, index: 203 });
      const original = outcomeFromAction({ type: 'click', userId: 'v1', sessionId: 's1', timestamp: target.ts + 100,
        eventId: 'w2208-original', eventIdSource: 'provided', data: { contentId: 'A', slot: 'hero', decisionId: target.decision_id } }, 'coach')!;
      original.retention = captureRetention(onlineFixtureEnv, 'coach', original.ts);
      expect(await (await f.request('/outcome', { tenant: 'coach', brand: 'coach', outcome: original,
        policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig }, restarted)).json()).toMatchObject({ ok: true, credits: 1,
        receipt: { received: 1, cutoffSkipped: 0, attributed: 1, eligible: 1, weightSkipped: 0,
          credits: { acknowledged: 1, processed: 1, unknown: 0, notAttempted: 0 } } });
      expect(sent).toEqual([{ name: 'coach:coach:hero', url: 'https://learn/credits', body: { tenant: 'coach', brand: 'coach', slot: 'hero', config: boundedConfig,
        credits: [{ decision_id: target.decision_id, slot: 'hero', item: 'A', cell, reward: 'click', event: 'click', ts: original.ts, weight: 1 }] } }]);
      expect(original.ts).toBe(target.ts + 100); expect(original.event_id).toBe('w2208-original');
      expect(f.storage.map.get('ring')).toEqual(persisted); expect(f.put).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('W26.03 atomically contains retained and in-batch retries without repairing ambiguous history', async () => {
    const now = Date.now() - 1000;
    let nested: unknown = { value: null, list: [false, 0, 'exact'] };
    for (let depth = 0; depth < 512; depth++) nested = { next: nested };
    const a = { ...record('a', 'hero', 'A', now), candidates: [{ contentId: 'A', score: 1 }, { contentId: 'B', score: 0 }],
      extra: { nested, ...JSON.parse('{"__proto__":{"value":"own"}}') } };
    const b = record('b', 'hero', 'B', now), c = record('c', 'hero', 'C', now + 1);
    const reordered = { ...Object.fromEntries(Object.entries(a).reverse()),
      cell: Object.fromEntries(Object.entries(a.cell).reverse()),
      extra: Object.fromEntries(Object.entries(a.extra).reverse()) };
    const f = boundedRing(), append = (records: unknown[], target = f.ring) => f.request('/append', { records }, target);
    expect(await (await append([a, reordered, a, b])).json()).toEqual({ ok: true, ring: 2,
      receipt: { version: 2, kind: 'append', received: 4, accepted: 2, duplicates: 2, cutoffSkipped: 0, retained: 2, indexed: 2 } });
    expect(f.storage.map.get('ring')).toEqual(saved([a, b]));
    const collision = async (response: Response) => {
      expect(response.status).toBe(409); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual({ ok: false, error: 'ring decision collision', applied: false });
    };
    const changed = [{ ...a, item_id: 'different' }, { ...a, candidates: [...a.candidates].reverse() },
      { ...a, explain: { ...a.explain, newField: true } }, { ...a, cell: { ...cell, channel: 'other' } },
      { ...a, extra: { nested: null } }];
    for (const row of changed) {
      const puts = f.put.mock.calls.length;
      await collision(await append([c, row])); // A late conflict cannot commit the earlier new candidate.
      expect(f.put).toHaveBeenCalledTimes(puts); expect(f.storage.map.get('ring')).toEqual(saved([a, b]));
      expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: [a, b], index: 2 });
    }
    expect(await (await append([reordered], new DecisionRing(f.state, f.env))).json())
      .toMatchObject({ receipt: { accepted: 0, duplicates: 1, retained: 2, indexed: 2 } });
    const fresh = boundedRing();
    await collision(await fresh.request('/append', { records: [a, changed[0]] }));
    expect(fresh.put).not.toHaveBeenCalled(); expect(fresh.storage.map.get('ring')).toEqual(saved([]));
    for (const initial of [saved([a, a]), saved([a, changed[0]!]), { ring: [], index: saved([a]).index }]) {
      const held = boundedRing(initial);
      await collision(await held.request('/append', { records: [c, a] }));
      expect(held.put).not.toHaveBeenCalled(); expect(held.storage.map.get('ring')).toEqual(initial);
      expect((await held.request('/append', { records: [c] })).status).toBe(200);
      expect((held.storage.map.get('ring') as ReturnType<typeof saved>).ring).toEqual([...initial.ring, c]);
    }
    const noIndex = boundedRing({ ring: [b], index: [] });
    expect(await (await noIndex.request('/append', { records: [b] })).json())
      .toMatchObject({ receipt: { accepted: 0, duplicates: 1, retained: 1, indexed: 0 } });

    const full = boundedRing({ ring: [b], index: [...saved([b]).index,
      ...Array.from({ length: RING_LIMITS.index - 1 }, (_, i) => ({ id: b.decision_id + '-' + i, ts: now }))] });
    expect(await (await full.request('/append', { records: Array.from({ length: 500 }, () => b) })).json())
      .toMatchObject({ receipt: { accepted: 0, duplicates: 500, retained: 1, indexed: RING_LIMITS.index } });
    expect((await full.request('/append', { records: [c] })).status).toBe(413);
    for (const committed of [false, true]) {
      const uncertain = boundedRing();
      uncertain.put.mockImplementationOnce(async (key, value) => {
        if (committed) uncertain.storage.map.set(key, structuredClone(value));
        throw new Error('private ambiguous append');
      });
      expect((await uncertain.request('/append', { records: [b] })).status).toBe(503);
      expect(await (await uncertain.request('/append', { records: [b] })).json())
        .toMatchObject({ receipt: { accepted: committed ? 0 : 1, duplicates: committed ? 1 : 0, retained: 1, indexed: 1 } });
      expect(await (await uncertain.request('/recent', undefined, new DecisionRing(uncertain.state, uncertain.env))).json())
        .toEqual({ ok: true, ring: [b], index: 1 });
    }
    const concurrent = boundedRing();
    const receipts = await Promise.all([b, b].map(async row => (await (await concurrent.request('/append', { records: [row] })).json()) as { receipt: { accepted: number; duplicates: number } }));
    expect(receipts.map(r => [r.receipt.accepted, r.receipt.duplicates])).toEqual([[1, 0], [0, 1]]);
    f.get.mockImplementation(async () => ({ text: async () => JSON.stringify(barrier(now)) }) as never);
    expect(await (await append([a, changed[0], c, c])).json()).toMatchObject({ receipt: {
      received: 4, accepted: 1, duplicates: 1, cutoffSkipped: 2, retained: 1, indexed: 1 } });
    expect(f.storage.map.get('ring')).toEqual(saved([c]));
    const expired = record('expired', 'hero', 'A', now - 91 * 86_400_000), aged = boundedRing(saved([expired]));
    await collision(await aged.request('/append', { records: [{ ...expired, item_id: 'changed' }] }));
    expect((await aged.request('/append', { records: [b] })).status).toBe(200); // Existing append-only pruning removes evidence.
    expect(await (await aged.request('/append', { records: [expired] })).json())
      .toMatchObject({ receipt: { accepted: 1, duplicates: 0, retained: 1, indexed: 1 } });
    expect((await concurrent.request('/reset', {})).status).toBe(200);
    expect(await (await concurrent.request('/append', { records: [b] })).json()).toMatchObject({ receipt: { accepted: 1, duplicates: 0 } });
  });

  it('W26.03 surfaces ring retry receipts without claiming statistics or fan-out idempotency', async () => {
    const now = Date.now() - 1000, row = record('retry', 'hero', 'A', now), f = boundedRing(), statsStorage = new FakeStorage();
    const stats = new LearnStats({ storage: statsStorage } as unknown as DurableObjectState, {} as Env);
    const ringFetch = vi.fn((url: string, init?: RequestInit) => f.ring.fetch(new Request(url, init)));
    const statsFetch = vi.fn((url: string, init?: RequestInit) => stats.fetch(new Request(url, init)));
    f.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: ringFetch }) } as unknown as DurableObjectNamespace;
    f.env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: statsFetch }) } as unknown as DurableObjectNamespace;
    const send = () => fanDecisions(f.env, { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [row] }, () => boundedConfig);
    expect(await send()).toMatchObject({ ok: true, append: { version: 2, accepted: 1, duplicates: 0 }, exposures: { processed: 1 } });
    expect(await send()).toMatchObject({ ok: true, append: { version: 2, accepted: 0, duplicates: 1 }, exposures: { processed: 1 } });
    expect(ringFetch).toHaveBeenCalledTimes(2); expect(statsFetch).toHaveBeenCalledTimes(2);
    expect(f.storage.map.get('ring')).toEqual(saved([row]));
    const recent = await readRing(f.env, 'coach', 'v1');
    expect(recent).toHaveLength(1); // The same recent rows supply fatigue; a retry adds no second served row.
    expect(servedCounts(recent!, [{ slot: 'hero', fatigue: { weight: 1, windowHours: 1 } }], now + 100)).toEqual({ hero: { A: 1 } });
    const named = { ...outcome('click', 'A', now + 100), decision_id: row.decision_id };
    expect(attribute(named, recent!, DEFAULT_POLICY).map(c => c.decision_id)).toEqual([row.decision_id]);
    const credit = () => f.request('/outcome', { tenant: 'coach', brand: 'coach', outcome: named, policy: DEFAULT_POLICY, defaultSlotConfig: boundedConfig });
    for (let i = 0; i < 2; i++) expect(await (await credit()).json()).toMatchObject({ credits: 1, receipt: { credits: { processed: 1 } } });
    const stored = statsStorage.map.get('learn') as { stats: StatsState };
    expect(stored.stats.items.A!['*']!.n).toEqual({ s: 2, t: now });
    expect(stored.stats.items.A!['*']!.s.click).toEqual({ s: 2, t: named.ts });

    const base = { version: 1, kind: 'append', received: 1, accepted: 1, cutoffSkipped: 0, retained: 1, indexed: 1 };
    const fake = (receipt: unknown) => ringFetch.mockImplementationOnce(async () => Response.json({ ok: true, ring: 1, receipt }));
    fake(base);
    const legacy = await send(); expect(legacy).toMatchObject({ ok: true, append: base });
    expect(legacy.append).not.toHaveProperty('duplicates');
    for (const receipt of [{ ...base, version: 2 }, { ...base, version: 2, duplicates: 1 },
      { ...base, version: 2, accepted: 0, duplicates: -1 }, { ...base, version: 2, accepted: 0, duplicates: 0.5 },
      { ...base, version: 3, duplicates: 0 }, { ...base, version: 2, accepted: 0, duplicates: 1, retained: 2 }]) {
      const calls = ringFetch.mock.calls.length; fake(receipt);
      expect(await send()).toMatchObject({ ok: false, append: null, ring: { unknown: 1 }, exposures: { processed: 1 } });
      expect(ringFetch).toHaveBeenCalledTimes(calls + 1); // Malformed acknowledgement never triggers a retry.
    }
    const before = structuredClone(f.storage.map.get('ring')), n = (statsStorage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.n.s;
    expect(await fanDecisions(f.env, { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [{ ...row, explain: { ...row.explain, score_base: 0.2 } }] }, () => boundedConfig))
      .toMatchObject({ ok: false, ring: { unknown: 1 }, append: null, exposures: { processed: 1 } });
    expect(f.storage.map.get('ring')).toEqual(before);
    expect((statsStorage.map.get('learn') as { stats: StatsState }).stats.items.A!['*']!.n.s).toBe(n + 1);
  });

  it('W10.02 bounds actual requests and whole ring candidates without hiding concurrent statistics acceptance', async () => {
    const now = Date.now(), row = record('new', 'hero', 'A', now), f = boundedRing();
    const refused = { ok: false, error: 'ring capacity exceeded', applied: false };
    const assertRefused = async (response: Response) => {
      expect(response.status).toBe(413); expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toEqual(refused);
    };
    for (const path of ['/append', '/outcome']) {
      let cancelled = false, offset = 0;
      const encoded = new TextEncoder().encode(JSON.stringify({ records: [row], padding: '界'.repeat(400_000) }));
      const body = new ReadableStream<Uint8Array>({ pull(controller) {
        if (offset === encoded.length) { controller.close(); return; }
        controller.enqueue(encoded.slice(offset, offset + 16_381)); offset = Math.min(encoded.length, offset + 16_381);
      }, cancel() { cancelled = true; } });
      await assertRefused(await f.ring.fetch(new Request('https://learn' + path,
        { method: 'POST', headers: { 'Content-Length': '1' }, body, duplex: 'half' } as RequestInit)));
      expect(cancelled).toBe(true);
    }
    const empty = JSON.stringify({ records: [] });
    expect((await f.ring.fetch(new Request('https://learn/append', { method: 'POST',
      body: empty + ' '.repeat(RING_LIMITS.requestBytes - empty.length) }))).status).toBe(200);
    for (const body of ['{', 'null', '[]']) for (const path of ['/append', '/outcome']) {
      expect((await f.ring.fetch(new Request('https://learn' + path, { method: 'POST', body }))).status).toBe(400);
    }
    await assertRefused(await f.request('/append', { records: Array.from({ length: RING_LIMITS.rows + 1 }, () => row) }));
    const exactId = row.decision_id + 'x'.repeat(RING_LIMITS.idBytes - row.decision_id.length);
    await assertRefused(await f.request('/append', { records: [{ ...row, decision_id: exactId + '界' }] }));
    const o = outcome('click', 'A', now + 1);
    await assertRefused(await f.request('/outcome', { tenant: 'coach', brand: 'coach', policy: DEFAULT_POLICY,
      outcome: { ...o, outcome_id: o.outcome_id + 'x'.repeat(RING_LIMITS.idBytes) } }));
    expect(f.put).not.toHaveBeenCalled(); expect(f.forwarded).not.toHaveBeenCalled();
    expect((await f.request('/append', { records: [{ ...row, decision_id: exactId }] })).status).toBe(200);

    const rich = { ...record('rich', 'hero', 'A', now), explain: { ...row.explain, note: '界'.repeat(190_000) } }, byteFull = boundedRing(saved([rich]));
    const next = { ...rich, decision_id: rich.decision_id + '-next' };
    expect(boundedBytes({ records: [row, next] })).toBeLessThan(RING_LIMITS.requestBytes);
    expect(boundedBytes(saved([rich, row, next]))).toBeGreaterThan(RING_LIMITS.stateBytes);
    await assertRefused(await byteFull.request('/append', { records: [row, next] }));
    expect(byteFull.put).not.toHaveBeenCalled(); expect(byteFull.storage.map.get('ring')).toEqual(saved([rich]));
    expect(await (await byteFull.request('/recent')).json()).toEqual({ ok: true, ring: [rich], index: 1 });
    expect((await byteFull.request('/append', { records: [row] })).status).toBe(200);

    const indexed = { ring: [row], index: Array.from({ length: RING_LIMITS.index - 1 }, (_, i) => ({ id: row.decision_id + '-' + i, ts: now })) };
    const add = record('add', 'hero', 'A', now), extra = record('extra', 'hero', 'A', now);
    const full = boundedRing(indexed);
    await assertRefused(await full.request('/append', { records: [add, extra] }));
    expect(full.put).not.toHaveBeenCalled(); expect(full.storage.map.get('ring')).toEqual(indexed);
    expect(await (await full.request('/append', { records: [add] })).json()).toMatchObject({ receipt: { accepted: 1, indexed: RING_LIMITS.index } });
    const before = structuredClone(full.storage.map.get('ring')), statsStorage = new FakeStorage();
    const stats = new LearnStats({ storage: statsStorage } as unknown as DurableObjectState, {} as Env);
    const append = vi.fn(async (url: string, init?: RequestInit) => full.ring.fetch(new Request(url, init)));
    full.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: append }) } as unknown as DurableObjectNamespace;
    full.env.LEARN_STATS = { idFromName: (name: string) => name,
      get: () => ({ fetch: (url: string, init?: RequestInit) => stats.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
    expect(await fanDecisions(full.env, { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [extra] }, () => boundedConfig))
      .toMatchObject({ ok: false, ring: { acknowledged: 0, unknown: 1 }, exposures: { acknowledged: 1, processed: 1 } });
    expect(append).toHaveBeenCalledTimes(1); expect(full.put).toHaveBeenCalledTimes(1);
    expect(full.storage.map.get('ring')).toEqual(before);
    expect((statsStorage.map.get('learn') as { stats: StatsState }).stats.events).toBe(1);
  });

  it('W10.02 holds invalid saved state and preserves restart, ambiguous reset, full fields and age boundaries', async () => {
    const now = Date.now(), row = record('new', 'hero', 'A', now);
    const invalid = [false, { ...saved([row]), extra: true }, saved(Array.from({ length: 201 }, () => row)),
      { ring: [], index: Array.from({ length: RING_LIMITS.index + 1 }, () => ({ id: row.decision_id, ts: now })) },
      saved([{ ...row, explain: { ...row.explain, note: '界'.repeat(350_000) } }]),
      saved([{ ...row, decision_id: row.decision_id + 'x'.repeat(RING_LIMITS.idBytes) }]),
      { ring: [], index: [{ id: row.decision_id, ts: now, extra: true }] }];
    for (const initial of invalid) {
      const f = boundedRing(initial);
      for (const target of [f.ring, new DecisionRing(f.state, f.env)]) for (const [path, body] of [
        ['/recent', undefined], ['/append', { records: [row] }],
        ['/outcome', { tenant: 'coach', brand: 'coach', outcome: outcome('click', 'A', now + 1), policy: DEFAULT_POLICY }],
      ] as const) {
        const response = await f.request(path, body, target);
        expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'ring unavailable' });
      }
      expect(f.get).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled(); expect(f.forwarded).not.toHaveBeenCalled();
      expect(f.storage.map.get('ring')).toEqual(initial);
      expect((await f.request('/reset', {})).status).toBe(200); expect(f.storage.map.size).toBe(0);
      expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: [], index: 0 });
    }
    for (const committed of [false, true]) for (const operation of ['append', 'reset']) {
      const f = boundedRing(saved([row])), next = record('later', 'hero', 'B', now + 1);
      expect((await f.request('/recent')).status).toBe(200);
      if (operation === 'append') f.put.mockImplementationOnce(async (key, value) => {
        if (committed) f.storage.map.set(key, structuredClone(value));
        throw new Error('private ambiguous save');
      });
      else vi.spyOn(f.storage, 'deleteAll').mockImplementationOnce(async () => {
        if (committed) f.storage.map.clear();
        throw new Error('private ambiguous reset');
      });
      const response = await f.request('/' + operation, { records: [next] });
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'ring unavailable' });
      const expected = committed ? operation === 'append' ? [row, next] : [] : [row];
      for (const target of [f.ring, new DecisionRing(f.state, f.env)]) {
        expect(await (await f.request('/recent', undefined, target)).json()).toEqual({ ok: true, ring: expected, index: expected.length });
      }
    }
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const day = 86_400_000, rows = [record('old', 'hero', 'A', now - 7 * day - 1), record('edge', 'hero', 'B', now - 7 * day)];
      const index = [record('old-index', 'hero', 'A', now - 90 * day - 1), record('edge-index', 'hero', 'A', now - 90 * day)];
      const initial = { ring: rows, index: saved([...index, ...rows]).index }, f = boundedRing(initial);
      expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: rows, index: 4 });
      expect(f.put).not.toHaveBeenCalled(); // Existing age pruning is append-only, not a new read mutation.
      const rich: DecisionRecord = { ...row, candidates: [{ contentId: 'A', score: 0.5 }, { contentId: 'B', score: 0.4 }],
        featured_product_ids: ['sku-1'], explain: { ...row.explain, note: 'full explanation' } };
      expect((await f.request('/append', { records: [rich] })).status).toBe(200);
      expect(f.storage.map.get('ring')).toEqual({ ring: [rows[1], rich], index: [...initial.index.slice(1), ...saved([rich]).index] });
      expect(await (await f.request('/recent', undefined, new DecisionRing(f.state, f.env))).json())
        .toEqual({ ok: true, ring: [rows[1], rich], index: 4 });
    } finally { vi.useRealTimers(); }
  });

  it('W06.06 projects fresh inclusive cutoffs over cached ring and index-only state without writing on reads', async () => {
    const at = Date.now() - 10_000;
    const rows = [record('old', 'hero', 'A', at - 1), record('equal', 'hero', 'A', at),
      record('new', 'hero', 'B', at + 1), { ...record('held', 'hero', 'C', at + 2), arm: 'default' as const, brand: 'other-brand' }];
    const f = storedRing(saved(rows));
    expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: rows, index: 4 });
    f.get.mockImplementation(async () => ({ text: async () => JSON.stringify(barrier(at)) }));
    expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: rows.slice(2), index: 2 });
    f.get.mockImplementation(async () => ({ text: async () => JSON.stringify(barrier(at + 1)) }));
    expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: rows.slice(3), index: 1 });
    expect(f.get.mock.calls).toEqual(Array.from({ length: 3 }, () => [tombstoneKey('coach', 'v1')]));
    expect(f.put).not.toHaveBeenCalled(); expect(f.storage.map.get('ring')).toEqual(saved(rows));

    const indexOnly = storedRing({ ring: [], index: saved(rows).index });
    indexOnly.get.mockImplementation(async () => ({ text: async () => JSON.stringify(barrier(at)) }));
    expect(await (await indexOnly.request('/recent')).json()).toEqual({ ok: true, ring: [], index: 2 });
    expect(indexOnly.get).toHaveBeenCalledWith(tombstoneKey('coach', 'v1')); expect(indexOnly.put).not.toHaveBeenCalled();
  });

  it('W06.06 suppresses old decisions and outcomes before credits, and prunes stale stored/index rows on append', async () => {
    const at = Date.now() - 10_000;
    const rows = [record('old', 'hero', 'A', at - 1), record('equal', 'hero', 'A', at), record('new', 'hero', 'B', at + 1),
      { ...record('default', 'hero', 'C', at + 2), arm: 'default' as const },
      { ...record('no-learning', 'hero', 'D', at + 3), arm: 'no_learning' as const }];
    const f = storedRing(saved(rows));
    f.get.mockImplementation(async () => ({ text: async () => JSON.stringify(barrier(at)) }));
    for (const o of [outcome('click', 'A', at), outcome('click', 'A', at + 10), outcome('click', 'C', at + 10), outcome('click', 'D', at + 10)]) {
      expect(await (await f.credit(o)).json()).toMatchObject({ ok: true, credits: 0 });
    }
    expect(f.forwarded).not.toHaveBeenCalled();
    expect(await (await f.credit(outcome('click', 'B', at + 10))).json()).toMatchObject({ ok: true, credits: 1 });
    expect(JSON.parse(f.forwarded.mock.calls[0]![1]!.body as string).credits[0].decision_id).toBe(rows[2]!.decision_id);
    expect(f.put).not.toHaveBeenCalled();
    const incoming = [...rows.slice(0, 2), { ...record('later', 'story', 'E', at + 4), brand: 'another-brand' }];
    expect(await (await f.request('/append', { tenant: 'coach', visitorId: 'v1', records: incoming })).json()).toMatchObject({ ok: true, ring: 4 });
    expect(f.storage.map.get('ring')).toEqual(saved([...rows.slice(2), incoming[2]!]));
    f.get.mockImplementation(async () => ({ text: async () => JSON.stringify(barrier(at + 4)) }));
    expect(await (await f.credit(outcome('click', 'B', at + 20))).json()).toMatchObject({ ok: true, credits: 0 });
    expect(f.forwarded).toHaveBeenCalledTimes(1);
  });

  it('W06.06 exposes no records and starts no writes or credits on unknown barriers; reset remains reachable', async () => {
    const at = Date.now() - 10_000, row = record('new', 'hero', 'A', at + 1);
    for (const mode of ['binding', 'read', 'undefined', 'json', 'null', 'tenant', 'visitor', 'cutoff']) {
      const f = storedRing(saved([row])), tomb = barrier(at);
      if (mode === 'binding') f.env.STORAGE = undefined as never;
      if (mode === 'tenant') tomb.tenant = 'harbor';
      if (mode === 'visitor') tomb.visitor_id = 'v2';
      if (mode === 'cutoff') tomb.erased_at = 1.5;
      f.get.mockImplementation(async () => {
        if (mode === 'read') throw new Error('synthetic read failure');
        if (mode === 'undefined') return undefined as never;
        return { text: async () => mode === 'json' ? '{' : mode === 'null' ? 'null' : JSON.stringify(tomb) };
      });
      for (const response of [await f.request('/recent'), await f.request('/append', { records: [row] }), await f.credit(outcome('click', 'A', at + 2))]) {
        expect(response.status, mode).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'ring unavailable' });
      }
      expect(f.put, mode).not.toHaveBeenCalled(); expect(f.forwarded, mode).not.toHaveBeenCalled();
      expect(f.storage.map.get('ring')).toEqual(saved([row]));
      expect(await (await f.request('/reset', {})).json()).toEqual({ ok: true, reset: true });
      expect(f.storage.map.size).toBe(0);
      expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: [], index: 0 });
    }
  });

  it('W06.06 rejects malformed and mixed stored/received scope before any side effect', async () => {
    const at = Date.now() - 10_000, row = record('new', 'hero', 'A', at + 1);
    const other = { ...row, tenant: 'harbor', decision_id: row.decision_id.replace(/^coach:/, 'harbor:') };
    const subject = { ...row, visitor_id: 'v2', decision_id: row.decision_id.replace(':v1:', ':v2:') };
    const invalid = [null, { ring: null, index: [] }, { ring: [], index: null }, { ring: [null], index: [] },
      { ring: [], index: [null] }, { ring: [], index: [{ id: 'bad', ts: at }] },
      { ring: [], index: [{ id: row.decision_id, ts: row.ts + 1 }] },
      saved([{ ...row, visitor_id: 'v2' }]), saved([{ ...row, tenant: 'harbor' }]), saved([{ ...row, ts: row.ts + 1 }]),
      saved([row, other]), saved([row, subject]), { ring: [row], index: saved([other]).index },
      { ring: [], index: saved([row, subject]).index }];
    for (const initial of invalid) {
      const f = storedRing(initial);
      for (const response of [await f.request('/recent'), await f.request('/append', { records: [row] }), await f.credit(outcome('click', 'A', at + 2))]) {
        expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'ring unavailable' });
      }
      expect(f.get).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled(); expect(f.forwarded).not.toHaveBeenCalled();
      expect(f.storage.map.get('ring')).toEqual(initial);
    }
    const f = storedRing(saved([row]));
    for (const body of [{ records: [row, other] }, { records: [subject] }, { records: [null] },
      { records: [{ ...row, ts: row.ts + 1 }] }, { tenant: 'harbor', records: [row] },
      { visitorId: 'v2', records: [row] }, { tenant: 'harbor', visitorId: 'v1', records: [] }]) {
      expect((await f.request('/append', body)).status).toBe(503);
    }
    const o = outcome('click', 'A', at + 2);
    for (const change of [{ tenant: 'harbor' }, { visitor_id: 'v2' }, { visitor_id: 'v2', outcome_id: o.outcome_id.replace(':v1:', ':v2:') },
      { ts: o.ts + 1 }, { brand: 'other' }]) {
      expect((await f.credit({ ...o, ...change })).status).toBe(503);
    }
    expect(f.put).not.toHaveBeenCalled(); expect(f.forwarded).not.toHaveBeenCalled();
    expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: [row], index: 1 });
  });

  it('W06.06 reloads storage after rejected saves without leaking uncommitted append state', async () => {
    const at = Date.now() - 10_000, old = record('old', 'hero', 'A', at), next = record('new', 'hero', 'B', at + 1);
    for (const committed of [false, true]) {
      const f = storedRing(saved([old]));
      await f.request('/recent'); // Populate the cached before-state.
      f.put.mockImplementationOnce(async (key, value) => {
        if (committed) f.storage.map.set(key, structuredClone(value));
        throw new Error('synthetic save failure');
      });
      expect((await f.request('/append', { records: [next] })).status).toBe(503);
      const expected = committed ? [old, next] : [old];
      expect(await (await f.request('/recent')).json()).toEqual({ ok: true, ring: expected, index: expected.length });
      expect(f.storage.map.get('ring')).toEqual(saved(expected));
      if (!committed) {
        expect(await (await f.request('/append', { records: [next] })).json()).toMatchObject({ ok: true, ring: 2 });
        expect(f.storage.map.get('ring')).toEqual(saved([old, next]));
      }
    }
  });

  it('W06.06 leaves the existing fatigue timeout effective while its DO barrier read is held', async () => {
    vi.useFakeTimers();
    try {
      const at = Date.now(), f = storedRing(saved([record('new', 'hero', 'A', at)]));
      let release!: (value: null) => void;
      f.get.mockImplementation(() => new Promise(resolve => { release = resolve; }));
      const env = { DECISION_RING: { idFromName: (name: string) => name, get: () => ({ fetch: () => f.request('/recent') }) } } as unknown as Env;
      const read = readRing(env, 'coach', 'v1');
      await vi.advanceTimersByTimeAsync(60);
      expect(await read).toBeNull(); expect(f.get).toHaveBeenCalledTimes(1); expect(f.put).not.toHaveBeenCalled();
      release(null); await vi.advanceTimersByTimeAsync(0);
    } finally { vi.useRealTimers(); }
  });

  it('the ring keeps the last 200, attributes an outcome, and forwards credits to the slot object', async () => {
    const forwarded: unknown[] = [];
    const env = { ...onlineFixtureEnv, STORAGE: { get: async () => null }, LEARN_STATS: { idFromName: (n: string) => n, get: (n: string) => ({ fetch: async (_u: string, init?: { body?: string }) => { forwarded.push([n, JSON.parse(init?.body ?? '{}')]); return new Response('{}'); } }) } } as unknown as Env;
    const ring = new DecisionRing({ storage: new FakeStorage() } as unknown as DurableObjectState, env);
    // The ring ages entries against real time, so these are stamped now.
    const NOW = Date.now() - 10_000;
    const many = Array.from({ length: 205 }, (_, i) => record(`d${i}`, 'rail', `item${i % 7}`, NOW + i));
    await ring.fetch(new Request('https://learn/append', { method: 'POST', body: JSON.stringify({ records: many }) }));
    await ring.fetch(new Request('https://learn/append', { method: 'POST', body: JSON.stringify({ records: [record('hero-1', 'hero', 'A', NOW + 1000)] }) }));
    const recent = (await (await ring.fetch(new Request('https://learn/recent'))).json()) as { ring: DecisionRecord[]; index: number };
    expect(recent.ring).toHaveLength(200); expect(recent.index).toBe(206);
    const res = (await (await ring.fetch(new Request('https://learn/outcome', { method: 'POST', body: JSON.stringify({ tenant: 'coach', brand: 'coach', outcome: outcome('click', 'A', NOW + 5000), policy: DEFAULT_POLICY, slotConfig: {}, defaultSlotConfig: boundedConfig }) }))).json()) as { credits: number };
    expect(res.credits).toBe(1);
    expect(forwarded[0]).toEqual(['coach:coach:hero', expect.objectContaining({ slot: 'hero', credits: [expect.objectContaining({ decision_id: record('hero-1', 'hero', 'A', NOW + 1000).decision_id, item: 'A', reward: 'click' })] })]);
  });

  it('the statistics object counts, arms one alarm, and publishes a versioned snapshot to KV', async () => {
    const f = boundedStats(), kv = f.cache, storage = f.storage, obj = f.object;
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

  it('W09.04 reports acknowledged statistics processing and the complete ring credit cascade', async () => {
    // Structured-clone boundaries model DO storage, not aliases to the object's mutable cache.
    class ClonedStorage extends FakeStorage {
      async get(key: string) { return structuredClone(this.map.get(key)); }
      async put(key: string, value: unknown) { this.map.set(key, structuredClone(value)); }
    }
    const now = Date.now(), cfg = { reward: 'click' as const, stats: DEFAULT_STATS };
    const exposure = { item: 'A', cell, ts: now }, credit = { item: 'A', cell, reward: 'click', ts: now, weight: 1 };
    const request = (object: LearnStats, kind: 'exposures' | 'credits', rows: unknown[]) => object.fetch(new Request('https://learn/' + kind,
      { method: 'POST', body: JSON.stringify({ tenant: 'coach', brand: 'coach', slot: 'hero', config: cfg, [kind]: rows }) }));
    for (const kind of ['exposures', 'credits'] as const) for (const committed of [false, true]) {
      const storage = new ClonedStorage(), state = { storage } as unknown as DurableObjectState;
      const object = new LearnStats(state, {} as Env), row = kind === 'exposures' ? exposure : credit;
      expect(await (await request(object, kind, [row, null])).json()).toEqual({ ok: true,
        receipt: { version: 1, kind, received: 2, processed: 1, skipped: 1, alarm: 'scheduled' } });
      const before = structuredClone(storage.map.get('learn'));
      const put = vi.spyOn(storage, 'put').mockImplementationOnce(async (key, value) => {
        if (committed) storage.map.set(key, structuredClone(value));
        throw new Error('private synthetic save failure');
      });
      const failed = await request(object, kind, [row]);
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ ok: false, error: 'statistics acknowledgement unavailable' });
      if (!committed) expect(storage.map.get('learn')).toEqual(before);
      expect(put).toHaveBeenCalledTimes(1); // No automatic replay, even after an ambiguous commit.
      const snapshot = async (obj: LearnStats) => (await (await obj.fetch(new Request('https://learn/snapshot'))).json()) as { snapshot: { items: Record<string, Record<string, { n: number; s: number }>> } };
      const expected = committed ? 2 : 1;
      for (const obj of [object, new LearnStats(state, {} as Env)]) {
        const snap = (await snapshot(obj)).snapshot;
        expect(kind === 'exposures' ? snap.items.A!['*']!.n : snap.items.A!['*']!.s).toBeCloseTo(expected, 3);
      }
      put.mockRestore();
    }
    const storage = new ClonedStorage(), stats = new LearnStats({ storage } as unknown as DurableObjectState, {} as Env);
    const alarm = vi.spyOn(storage, 'setAlarm').mockRejectedValueOnce(new Error('private alarm failure'));
    const alarmReply = await (await request(stats, 'exposures', [exposure])).json() as { receipt: StatsWriteReceipt };
    expect(alarmReply.receipt).toEqual({ version: 1, kind: 'exposures', received: 1, processed: 1, skipped: 0, alarm: 'unknown' });
    expect((storage.map.get('learn') as { stats: { events: number } }).stats.events).toBe(1);
    expect(alarm).toHaveBeenCalledTimes(1);

    let release!: () => void, started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
    const forwarded = vi.fn(async (url: string, init?: RequestInit) => { started(); await held; return stats.fetch(new Request(url, init)); });
    const env = { ...onlineFixtureEnv, STORAGE: { get: async () => null }, LEARN_STATS: { idFromName: (name: string) => name, get: () => ({ fetch: forwarded }) } } as unknown as Env;
    const ringStorage = new ClonedStorage(), ring = new DecisionRing({ storage: ringStorage } as unknown as DurableObjectState, env);
    const ringRequest = (path: string, body?: unknown) => ring.fetch(new Request('https://learn' + path,
      body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }));
    const rows = Array.from({ length: 205 }, (_, i) => record('d' + i, 'hero', 'A', now + i));
    expect(await (await ringRequest('/append', { records: rows })).json()).toEqual({ ok: true, ring: 200,
      receipt: { version: 2, kind: 'append', received: 205, accepted: 205, duplicates: 0, cutoffSkipped: 0, retained: 200, indexed: 205 } });
    let completed = false;
    const body = { tenant: 'coach', brand: 'coach', outcome: outcome('click', 'A', now + 1000), policy: DEFAULT_POLICY, slotConfig: { hero: cfg } };
    const pending = ringRequest('/outcome', body).then(r => { completed = true; return r; });
    await entered;
    expect((await ringRequest('/recent')).status).toBe(200); expect(completed).toBe(false);
    release();
    const result = await (await pending).json() as { credits: number; receipt: OutcomeReceipt };
    expect(result.credits).toBe(1); expect(result.receipt).toMatchObject({ version: 1, kind: 'outcome', received: 1, attributed: 1, eligible: 1, weightSkipped: 0,
      credits: { destinations: 1, acknowledged: 1, unknown: 0, notAttempted: 0, received: 1, processed: 1, skipped: 0, alarmsUnknown: 0 } });
    expect(forwarded).toHaveBeenCalledTimes(1);
    env.LEARN_STATS = undefined;
    const missing = await (await ringRequest('/outcome', body)).json() as { receipt: OutcomeReceipt };
    expect(missing.receipt.credits).toMatchObject({ received: 1, processed: 0, notAttempted: 1, rowsNotAttempted: 1 });
    const worthless = await (await ringRequest('/outcome', { ...body, slotConfig: { hero: { ...cfg, objective: 'revenue' } } })).json() as { receipt: OutcomeReceipt };
    expect(worthless.receipt).toMatchObject({ attributed: 1, eligible: 0, weightSkipped: 1, credits: { destinations: 0, received: 0 } });
  });
});
