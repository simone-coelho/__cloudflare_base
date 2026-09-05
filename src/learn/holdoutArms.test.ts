// src/learn/holdoutArms.test.ts
// Doc 22 §10, made real (R12-2, R12-4): the no_learning arm is personalized with γ 0 and no
// exploration; holdout traffic never reaches the statistics; the report compares the arms with
// the uncertainty a person needs.

import { describe, it, expect } from 'vitest';
import { decideContent } from '@/content/decide';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess } from './stats';
import { fanDecisions } from './fan';
import { buildReport, type ReportPolicy } from './report';
import { DEFAULT_POLICY } from './policy';
import type { ContentPiece, DecisionRecord, SlotStrategy } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';

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
    const record = (arm: DecisionRecord['arm']): DecisionRecord => ({ ...decideContent({ ...base, arm }).records[0]!, arm });
    await fanDecisions({ DECISION_RING: ns as never, LEARN_STATS: ns as never }, { tenant: 'coach', brand: 'coach', visitor_id: 'v1', records: [record('personalized'), record('no_learning'), record('default')] }, () => ({ reward: 'click', stats: DEFAULT_STATS }));
    const exposures = posted.filter((p) => p.path === '/exposures');
    expect(exposures).toHaveLength(1);
    expect(exposures[0]!.body.exposures).toHaveLength(1);
    expect(posted.filter((p) => p.path === '/append')).toHaveLength(1);   // the ring keeps every arm
  });
});

describe('the arms compared with uncertainty (R12-4)', () => {
  it('the report carries each holdout arm against personalized, with the interval and the sentence', () => {
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
    expect(r.holdout.hero).toEqual([{ arm: 'default', decisions: 40, credited: 2, rate: 0.05 }, { arm: 'personalized', decisions: 40, credited: 8, rate: 0.2 }]);
    const cmp = r.holdoutComparison.hero!;
    expect(cmp).toHaveLength(1);
    expect(cmp[0]!.control.arm).toBe('default'); expect(cmp[0]!.treatment.arm).toBe('personalized');
    expect(cmp[0]!.treatment.rate.p).toBeCloseTo(0.2, 3);
    expect(['treatment_better', 'undecided']).toContain(cmp[0]!.verdict);
    expect(cmp[0]!.words).toMatch(/personalized/);
    // the statistics saw the personalized arm alone: 40 exposures, 8 successes
    const g = r.grids.hero!.learning!;
    expect(g.items.a!['*']!.n).toBeCloseTo(40, 0); expect(g.items.a!['*']!.s).toBeCloseTo(8, 0);
  });
});
