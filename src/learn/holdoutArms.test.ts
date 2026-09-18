// src/learn/holdoutArms.test.ts
// Doc 22 §10, made real (R12-2, R12-4): the no_learning arm is personalized with γ 0 and no
// exploration; holdout traffic never reaches the statistics; the report retains raw
// attribution counts without experimental inference.

import { describe, it, expect, vi } from 'vitest';
import { decideContent } from '@/content/decide';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess } from './stats';
import { fanDecisions, fanOutcome } from './fan';
import { buildReport, type ReportPolicy } from './report';
import { DEFAULT_POLICY } from './policy';
import type { ContentPiece, DecisionRecord, SlotStrategy } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { outcomeFromAction } from '@/ledger/records';
import { tombstoneKey } from '@/ledger/erasure';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { LearnStats } from '@/durable-objects/LearnStats';
import type { Env } from '@/types/env';
import { captureRetention, type RetentionEnv } from '@/retention';

const retainedFixture = { TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian', 'harbor'] }), RETENTION: JSON.stringify({ version: 1,
  tenants: Object.fromEntries(['coach', 'meridian', 'harbor'].map(tenant => [tenant, { online: { id: 'synthetic-online', revision: 1, durationMs: 86400_000, basis: 'admitted', renewal: 'new-record-only' } }])) }) } as RetentionEnv;

const NOW = Date.now();
const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' };
const piece = (id: string, tags: Record<string, string[]>): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: ['hero'], lifecycle: { status: 'live' } });
const pieces = [piece('a', { occasion: ['evening'] }), piece('d', { occasion: ['evening'], line: ['drover'] }), piece('n', { occasion: ['weekend'] })];
const slots: SlotStrategy[] = [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }];
const base = {
  tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const, nowMs: NOW,
  pieces, slots, affinity: { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } }, cell,
  versions: { config: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'v1',
};

describe('the no_learning arm', () => {
  it('is personalized, at γ 0, with no exploration, and says so on the receipt', () => {
    const st = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(st, 'a', cell, NOW - i, DEFAULT_STATS);
    for (let i = 0; i < 30; i++) recordSuccess(st, 'a', cell, 'click', NOW - i, 1, DEFAULT_STATS);
    for (let i = 0; i < 100; i++) recordExposure(st, 'd', cell, NOW - i, DEFAULT_STATS);
    const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS);
    const learning = { snapshots: { hero: snap }, gammaOf: () => 1, exploreOf: () => ({ mode: 'rotation' as const, share: 1, floor: 500 }) };
    // the personalized arm explores when told to (n is under the floor), and learns at γ 1 when it does not
    expect(decideContent({ ...base, arm: 'personalized', learning }).records[0]!.explored).toBe(true);
    const learned = decideContent({ ...base, arm: 'personalized', learning: { ...learning, exploreOf: () => null } }).records[0]!;
    const held = decideContent({ ...base, arm: 'no_learning', learning }).records[0]!;
    expect(learned.explain.lift!.gamma).toBe(1);
    expect(held.explain.lift!.gamma).toBe(0);                          // the lift is shown, and ignored
    expect(held.explain.score_final).toBeCloseTo(held.explain.score_base, 6);
    expect(held.explain.drivers.length).toBeGreaterThan(0);             // still personalized
    expect(held.explored).toBe(false); expect(held.explain.exploration).toBeUndefined();
    expect(held.item_id).toBe('d');                                     // affinity alone: d's 0.455 beats a's 0.28
  });

  it('feeds no exposures to the statistics; only the personalized arm does', async () => {
    const posted: Array<{ name: string; path: string; body: { exposures?: unknown[] } }> = [];
    const ns = { idFromName: (n: string) => n, get: (name: string) => ({ fetch: async (url: string, init: { body: string }) => { posted.push({ name, path: new URL(url).pathname, body: JSON.parse(init.body) }); return new Response('{}'); } }) };
    const record = (arm: DecisionRecord['arm']): DecisionRecord => {
      const row = decideContent({ ...base, arm }).records[0]!;
      return { ...row, decision_id: row.decision_id + ':' + arm, arm };
    };
    await fanDecisions({ DECISION_RING: ns as never, LEARN_STATS: ns as never, STORAGE: { get: async () => null } as never }, { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [record('personalized'), record('no_learning'), record('default')] }, () => ({ reward: 'click', stats: DEFAULT_STATS }));
    const exposures = posted.filter((p) => p.path === '/exposures');
    expect(exposures).toHaveLength(1);
    expect(exposures[0]!.body.exposures).toHaveLength(1);
    expect(posted.filter((p) => p.path === '/append')).toHaveLength(1);   // the ring keeps every arm
  });
});

describe('the recorded arms as attribution diagnostics (W21)', () => {
  it('the report carries each arm with raw credit intensity and no inferred comparison', () => {
    const T0 = Date.UTC(2026, 8, 3, 12, 0, 0);
    const dec = (visitor: string, arm: DecisionRecord['arm'], item: string): DecisionRecord => ({
      decision_id: `coach:${T0.toString(36)}:${visitor}:home:hero:0`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: `s-${visitor}`, identity_anchor: 'visitor', ts: T0,
      page: 'home', slot: 'hero', position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm, explored: false, authority: 'engine',
      versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1', explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
    } as DecisionRecord);
    const out = (visitor: string, item: string): OutcomeRecord => ({ outcome_id: `coach:${(T0 + 1000).toString(36)}:${visitor}:click`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: `s-${visitor}`, ts: T0 + 1000, type: 'click', event: 'content_click', item_id: item, slot: 'hero', value: null, currency: null, margin: null, products: null, arm: null });
    const decisions: DecisionRecord[] = [];
    const outcomes: OutcomeRecord[] = [];
    for (let i = 0; i < 40; i++) { decisions.push(dec(`p${i}`, 'personalized', 'a')); if (i < 8) outcomes.push(out(`p${i}`, 'a')); }
    for (let i = 0; i < 40; i++) { decisions.push(dec(`h${i}`, 'default', 'a')); if (i < 2) outcomes.push(out(`h${i}`, 'a')); }
    const learning: ReportPolicy = { name: 'learning', ...DEFAULT_POLICY };
    const r = buildReport({ tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [], learn: { holdout: { share: 0.5, salt: '', arms: ['default'] } }, decisions, outcomes, now: T0 + 3600_000, truncated: false });
    expect(r.holdout.hero).toEqual([{ arm: 'default', decisions: 40, credited: 2, creditedPerDecision: 0.05, rate: 0.05 }, { arm: 'personalized', decisions: 40, credited: 8, creditedPerDecision: 0.2, rate: 0.2 }]);
    const cmp = r.holdoutComparison.hero!;
    expect(cmp).toEqual([]);
    expect(r.measurement.inference).toBe('unavailable');
    // the statistics saw the personalized arm alone: 40 exposures, 8 successes
    const g = r.grids.hero!.learning!;
    expect(g.items.a!['*']!.n).toBeCloseTo(40, 0); expect(g.items.a!['*']!.s).toBeCloseTo(8, 0);
  });
});

describe('W06.05 retained cutoff on online fan-out', () => {
  const slotConfig = () => ({ reward: 'click' as const, stats: DEFAULT_STATS });
  const decision = (tenant: string, visitor: string, ts: number, arm: DecisionRecord['arm'] = 'personalized') =>
    ({ ...decideContent({ ...base, tenant, brand: tenant, visitorId: visitor, nowMs: ts, arm }).records[0]!, retention: captureRetention(retainedFixture, tenant, Math.min(ts, Date.now())) });
  const barrier = (tenant: string, visitor: string, at: number) => ({ tenant, visitor_id: visitor, erased_at: at, actor: 'ops', rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 });

  it('W06.06 rejects an append delayed until after erasure even though fan admission already passed', async () => {
    const tenant = 'meridian', visitor = 'vis-delayed', at = Date.now() - 1000;
    let tomb: ReturnType<typeof barrier> | null = null;
    const data = new Map<string, any>(), reads: string[] = [];
    const env = { ...retainedFixture, STORAGE: { get: async (key: string) => {
      reads.push(key); return tomb === null ? null : { text: async () => JSON.stringify(tomb) };
    } } } as unknown as Env;
    const ring = new DecisionRing({ storage: {
      get: async (key: string) => data.get(key), put: async (key: string, value: unknown) => { data.set(key, value); },
      getAlarm: async () => null, setAlarm: async () => {},
      deleteAll: async () => { data.clear(); },
    } } as unknown as DurableObjectState, env);
    env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init?: RequestInit) => {
      tomb = barrier(tenant, visitor, at); // Caller already read a definite absent barrier; delivery now resumes.
      return ring.fetch(new Request(url, init));
    } }) } as unknown as DurableObjectNamespace;
    await fanDecisions(env, { tenant, brand: tenant, visitor_id: visitor, records: [decision(tenant, visitor, at)] }, slotConfig);
    expect(reads).toEqual([tombstoneKey(tenant, visitor), tombstoneKey(tenant, visitor)]);
    expect(data.get('ring')).toEqual({ ring: [], index: [] });
    await fanDecisions(env, { tenant, brand: tenant, visitor_id: visitor, records: [decision(tenant, visitor, at + 1, 'no_learning')] }, slotConfig);
    expect(data.get('ring').ring.map((r: DecisionRecord) => r.ts)).toEqual([at + 1]);
    expect(data.get('ring').index).toHaveLength(1);
  });

  it('keeps only post-cutoff records in actual ring/statistics, preserves holdout and other subjects/tenants, and suppresses old outcomes', async () => {
    const cutoff = Date.now() - 1000, tenant = 'meridian', visitor = 'vis-replay';
    const tombs = new Map([[tombstoneKey(tenant, visitor), JSON.stringify(barrier(tenant, visitor, cutoff))]]);
    const reads: string[] = [], calls: Array<{ name: string; path: string }> = [], pending: Promise<unknown>[] = [];
    const env = { ...retainedFixture, STORAGE: { get: async (key: string) => { reads.push(key); const value = tombs.get(key); return value === undefined ? null : { text: async () => value }; } } } as unknown as Env;
    function namespace(kind: 'ring' | 'stats') {
      const items = new Map<string, { data: Map<string, any>; object: DecisionRing | LearnStats }>();
      const ns = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: string, init?: RequestInit) => {
        calls.push({ name, path: new URL(url).pathname });
        let item = items.get(name);
        if (!item) {
          const data = new Map<string, any>(), state = { storage: {
            get: async (key: string) => data.get(key), put: async (key: string, value: unknown) => { data.set(key, value); },
            getAlarm: async () => null, setAlarm: async () => {}, deleteAll: async () => { data.clear(); },
          }, waitUntil: (p: Promise<unknown>) => { pending.push(p); } } as unknown as DurableObjectState;
          item = { data, object: kind === 'ring' ? new DecisionRing(state, env) : new LearnStats(state, env) }; items.set(name, item);
        }
        return item.object.fetch(new Request(url, init));
      } }) } as unknown as DurableObjectNamespace;
      return { ns, items };
    }
    const ring = namespace('ring'), stats = namespace('stats'); env.DECISION_RING = ring.ns; env.LEARN_STATS = stats.ns;
    const records = [decision(tenant, visitor, cutoff - 1), decision(tenant, visitor, cutoff), decision(tenant, visitor, cutoff + 1),
      decision(tenant, visitor, cutoff + 2, 'default'), decision(tenant, visitor, cutoff + 3, 'no_learning')];
    await fanDecisions(env, { tenant, brand: tenant, visitor_id: visitor, records }, slotConfig);
    expect(reads).toEqual([tombstoneKey(tenant, visitor), tombstoneKey(tenant, visitor)]); // Fan admission and the actual DO each read afresh.
    const stored = ring.items.get(tenant + ':' + visitor)!.data.get('ring');
    expect(stored.ring.map((r: DecisionRecord) => r.ts)).toEqual([cutoff + 1, cutoff + 2, cutoff + 3]);
    expect(stored.index).toHaveLength(3);
    const state = stats.items.get(tenant + ':' + tenant + ':hero')!.data.get('learn').stats;
    expect(state.slot['*'].n.s).toBe(1); // Only the personalized post-cutoff exposure.
    const outcome = (ts: number, scope = tenant, subject = visitor) => ({ ...outcomeFromAction({ type: 'content_click', userId: subject, timestamp: ts,
      sessionId: base.sessionId, data: { contentId: records[2].item_id, slot: 'hero' } }, scope)!, retention: captureRetention(retainedFixture, scope, Math.min(ts, Date.now())) });
    const before = calls.length;
    await fanDecisions(env, { tenant, brand: tenant, visitor_id: visitor, records: records.slice(0, 2) }, slotConfig);
    expect(calls).toHaveLength(before);
    await fanOutcome(env, tenant, outcome(cutoff), DEFAULT_POLICY, tenant, { hero: slotConfig() });
    expect(calls).toHaveLength(before); expect(state.slot['*'].s.click).toBeUndefined();
    await fanOutcome(env, tenant, outcome(cutoff + 4), DEFAULT_POLICY, tenant, { hero: slotConfig() });
    await Promise.all(pending);
    expect(stats.items.get(tenant + ':' + tenant + ':hero')!.data.get('learn').stats.slot['*'].s.click.s).toBe(1);
    expect(calls.filter(c => c.path === '/outcome')).toHaveLength(1); expect(calls.filter(c => c.path === '/credits')).toHaveLength(1);
    for (const [scope, subject] of [[tenant, 'vis-other'], ['harbor', visitor]]) {
      await fanDecisions(env, { tenant: scope, brand: scope, visitor_id: subject, records: [decision(scope, subject, cutoff)] }, slotConfig);
      expect(ring.items.get(scope + ':' + subject)!.data.get('ring').ring).toHaveLength(1);
    }
    expect(stored.ring).toHaveLength(3);
  });

  it('starts no ring/exposure/attribution effects for invalid carriers or absent, failed or malformed barrier storage', async () => {
    const tenant = 'meridian', visitor = 'vis-replay', cutoff = Date.now() - 1000;
    for (const mode of ['binding', 'read', 'undefined', 'malformed-json', 'null-json', 'wrong-tenant', 'wrong-subject', 'bad-cutoff', 'carrier-tenant', 'carrier-visitor', 'carrier-time', 'set-tenant', 'set-brand', 'set-visitor']) {
      const posted = vi.fn(async () => Response.json({ ok: true }));
      const ns = { idFromName: (name: string) => name, get: () => ({ fetch: posted }) } as unknown as DurableObjectNamespace;
      const tomb = barrier(tenant, visitor, cutoff);
      if (mode === 'wrong-tenant') tomb.tenant = 'harbor';
      if (mode === 'wrong-subject') tomb.visitor_id = 'vis-other';
      if (mode === 'bad-cutoff') tomb.erased_at = 1.5;
      const get = vi.fn(async () => {
        if (mode === 'read') throw new Error('synthetic unavailable');
        if (mode === 'undefined') return undefined;
        return { text: async () => mode === 'malformed-json' ? '{' : mode === 'null-json' ? 'null' : JSON.stringify(tomb) };
      });
      const env = { ...retainedFixture, DECISION_RING: ns, LEARN_STATS: ns, ...(mode === 'binding' ? {} : { STORAGE: { get } }) } as unknown as Env;
      const record = decision(tenant, visitor, cutoff + 1), outcome = outcomeFromAction({ type: 'content_click', userId: visitor, timestamp: cutoff + 2 }, tenant)!;
      if (mode === 'carrier-tenant') { record.tenant = 'harbor'; outcome.tenant = 'harbor'; }
      if (mode === 'carrier-visitor') { record.visitor_id = 'vis-other'; outcome.visitor_id = 'vis-other'; }
      if (mode === 'carrier-time') { record.ts++; outcome.ts++; }
      const scope = mode === 'set-tenant' ? 'harbor' : tenant, brand = mode === 'set-brand' ? 'harbor' : tenant;
      const subject = mode === 'set-visitor' ? 'vis-other' : visitor;
      const config = vi.fn(slotConfig);
      await expect(fanDecisions(env, { tenant: scope, brand, visitor_id: subject, records: [record] }, config)).resolves.toMatchObject({ ok: false });
      // fanOutcome has no separate visitor carrier; use a mismatched record for the analogous case.
      if (mode === 'set-visitor') outcome.visitor_id = subject;
      await expect(fanOutcome(env, scope, outcome, DEFAULT_POLICY, brand, { hero: slotConfig() })).resolves.toMatchObject({ ok: false });
      expect(posted, mode).not.toHaveBeenCalled(); expect(config).not.toHaveBeenCalled();
    }
    const posted = vi.fn(async () => Response.json({ ok: true })), ns = { idFromName: (n: string) => n, get: () => ({ fetch: posted }) } as unknown as DurableObjectNamespace;
    let release!: (value: null) => void;
    const held = new Promise<null>(resolve => { release = resolve; });
    const env = { ...retainedFixture, DECISION_RING: ns, LEARN_STATS: ns, STORAGE: { get: () => held } } as unknown as Env;
    const promise = fanDecisions(env, { tenant, brand: tenant, visitor_id: visitor, records: [decision(tenant, visitor, cutoff + 1)] }, slotConfig);
    expect(posted).not.toHaveBeenCalled(); release(null); await promise;
    expect(posted).toHaveBeenCalledTimes(2); // Definite absent barrier preserves the ordinary positive lane.
  });

  it('W09.04 conserves fan destinations and refuses missing or malformed acknowledgements without retry', async () => {
    const first = decision('coach', 'v1', NOW), second = { ...first, slot: 'rail', decision_id: first.decision_id.replace(':hero:', ':rail:') };
    const set = { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [first, second, { ...first, decision_id: first.decision_id + ':default', arm: 'default' as const }] };
    const append = { ok: true, ring: 3, receipt: { version: 1, kind: 'append', received: 3, accepted: 3, cutoffSkipped: 0, retained: 3, indexed: 3 } };
    const stats = { ok: true, receipt: { version: 1, kind: 'exposures', received: 1, processed: 1, skipped: 0, alarm: 'scheduled' } };
    const modes = ['valid', 'http', 'throw', 'json', 'old', 'false', 'version', 'kind', 'negative', 'fraction', 'count', 'alarm', 'skipped', 'alarm-unknown'];
    for (const mode of modes) {
      const posted = vi.fn(async (url: string) => {
        if (url.endsWith('/append')) return Response.json(append);
        const body = structuredClone(stats);
        if (mode === 'throw') throw new Error('private payload');
        if (mode === 'json') return new Response('{');
        if (mode === 'old') return Response.json({ ok: true });
        if (mode === 'false') body.ok = false;
        if (mode === 'version') body.receipt.version = 2;
        if (mode === 'kind') body.receipt.kind = 'credits';
        if (mode === 'negative') body.receipt.processed = -1;
        if (mode === 'fraction') body.receipt.processed = 0.5;
        if (mode === 'count') body.receipt.received = 2;
        if (mode === 'alarm') body.receipt.alarm = 'published';
        if (mode === 'skipped') { body.receipt.processed = 0; body.receipt.skipped = 1; }
        if (mode === 'alarm-unknown') body.receipt.alarm = 'unknown';
        return Response.json(body, { status: mode === 'http' ? 503 : 200 });
      });
      const ns = { idFromName: (name: string) => name, get: () => ({ fetch: posted }) } as unknown as DurableObjectNamespace;
      const env = { ...retainedFixture, DECISION_RING: ns, LEARN_STATS: ns, STORAGE: { get: async () => null } } as unknown as Env;
      const result = await fanDecisions(env, set, slotConfig);
      expect(result.ok, mode).toBe(mode === 'valid');
      expect(result.ring).toEqual({ destinations: 1, acknowledged: 1, unknown: 0, notAttempted: 0 });
      expect(result.append).toEqual(append.receipt);
      const acknowledged = ['valid', 'skipped', 'alarm-unknown'].includes(mode);
      expect(result.exposures).toEqual({ destinations: 2, acknowledged: acknowledged ? 2 : 0, unknown: acknowledged ? 0 : 2, notAttempted: 0,
        received: 2, processed: acknowledged && mode !== 'skipped' ? 2 : 0, skipped: mode === 'skipped' ? 2 : 0,
        rowsUnknown: acknowledged ? 0 : 2, rowsNotAttempted: 0, alarmsUnknown: mode === 'alarm-unknown' ? 2 : 0 });
      expect(posted).toHaveBeenCalledTimes(3);
    }
    const unbound = { ...retainedFixture, STORAGE: { get: async () => null } } as unknown as Env;
    const missing = await fanDecisions(unbound, set, slotConfig);
    expect(missing).toMatchObject({ ok: false, ring: { destinations: 1, notAttempted: 1 }, exposures: { destinations: 2, received: 2, notAttempted: 2, rowsNotAttempted: 2 } });
    const badConfig = await fanDecisions(unbound, set, () => { throw new Error('private config'); });
    expect(badConfig).toMatchObject({ ok: false, code: 'config', ring: { notAttempted: 1 }, exposures: { rowsNotAttempted: 2 } });
    const getter = { ...retainedFixture, STORAGE: unbound.STORAGE, get DECISION_RING(): DurableObjectNamespace { throw new Error('private capability'); } } as unknown as Env;
    expect(await fanDecisions(getter, set, slotConfig)).toMatchObject({ ok: false, code: 'incomplete', ring: { unknown: 1 }, exposures: { rowsUnknown: 2 } });

    const credits = { destinations: 1, acknowledged: 1, unknown: 0, notAttempted: 0, received: 1, processed: 1, skipped: 0, rowsUnknown: 0, rowsNotAttempted: 0, alarmsUnknown: 0 };
    const outcomeBody = { ok: true, credits: 1, receipt: { version: 1, kind: 'outcome', received: 1, cutoffSkipped: 0, attributed: 1, eligible: 1, weightSkipped: 0, credits } };
    const outcome = outcomeFromAction({ type: 'content_click', userId: 'v1', timestamp: NOW + 1 }, 'coach')!;
    outcome.retention = captureRetention(retainedFixture, 'coach', outcome.ts, NOW);
    for (const mode of ['valid', 'http', 'old', 'kind', 'received', 'attributed', 'eligible', 'cutoff', 'nested-count', 'nested-destinations', 'nested-alarm', 'partial']) {
      const body = structuredClone(outcomeBody);
      if (mode === 'kind') body.receipt.kind = 'append';
      if (mode === 'received') body.receipt.received = 0;
      if (mode === 'attributed') body.credits = 2;
      if (mode === 'eligible') body.receipt.eligible = 2;
      if (mode === 'cutoff') body.receipt.cutoffSkipped = 1;
      if (mode === 'nested-count') body.receipt.credits.processed = 2;
      if (mode === 'nested-destinations') body.receipt.credits.acknowledged = 0;
      if (mode === 'nested-alarm') body.receipt.credits.alarmsUnknown = 2;
      if (mode === 'partial') Object.assign(body.receipt.credits, { acknowledged: 0, unknown: 1, processed: 0, rowsUnknown: 1 });
      const posted = vi.fn(async () => Response.json(mode === 'old' ? { ok: true, credits: 1 } : body, { status: mode === 'http' ? 503 : 200 }));
      const env = { ...retainedFixture, STORAGE: unbound.STORAGE, DECISION_RING: { idFromName: (name: string) => name, get: () => ({ fetch: posted }) } } as unknown as Env;
      const result = await fanOutcome(env, 'coach', outcome, DEFAULT_POLICY, 'coach', {});
      expect(result.ok, mode).toBe(mode === 'valid');
      expect(result.ring).toEqual({ destinations: 1, acknowledged: ['valid', 'partial'].includes(mode) ? 1 : 0, unknown: ['valid', 'partial'].includes(mode) ? 0 : 1, notAttempted: 0 });
      if (mode === 'partial') expect(result.outcome?.credits.rowsUnknown).toBe(1);
      else if (mode !== 'valid') expect(result.outcome).toBeNull();
      expect(posted).toHaveBeenCalledTimes(1);
    }
    expect(await fanOutcome(getter, 'coach', outcome, DEFAULT_POLICY, 'coach', {})).toMatchObject({ ok: false, ring: { unknown: 1 } });
  });
});
