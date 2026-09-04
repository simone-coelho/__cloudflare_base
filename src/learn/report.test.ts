// src/learn/report.test.ts
// CW22 / doc 22 §4.2, §7, §10: the day report over the ledger.

import { describe, it, expect } from 'vitest';
import { buildReport, loadDay, presetPolicies, ringsOf, type ReportPolicy } from './report';
import { DEFAULT_POLICY } from './policy';
import type { DecisionRecord, LearnConfig } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';

const T0 = Date.UTC(2026, 8, 3, 12, 0, 0);
const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: null };
const dec = (id: string, visitor: string, session: string, ts: number, item: string, arm: DecisionRecord['arm'] = 'personalized', explored = false, slot = 'hero'): DecisionRecord => ({
  decision_id: `coach:${ts.toString(36)}:${visitor}:home:${slot}:0`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: session, identity_anchor: 'visitor', ts,
  page: 'home', slot, position: 0, item_id: item, customer_item_id: `cms-${item}`, candidates: [], cell, arm, explored, authority: 'engine',
  versions: { config: 1, lift: 0, prior: 0, policy: 1 }, config_label: 'v1', explain: { drivers: [], score_base: 0, lift: null, score_final: 0 },
} as DecisionRecord);
const out = (visitor: string, session: string | null, ts: number, type: OutcomeRecord['type'], item: string | null): OutcomeRecord =>
  ({ outcome_id: `coach:${ts.toString(36)}:${visitor}:${type}`, tenant: 'coach', brand: 'coach', visitor_id: visitor, session_id: session, ts, type, event: type, item_id: item, slot: null, value: null, currency: null, arm: null });

const learn: LearnConfig = { holdout: { share: 0.1, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click', exploration: { mode: 'rotation', share: 0.5, floor: 50 } } } };
const learning: ReportPolicy = { name: 'learning', ...DEFAULT_POLICY };

describe('the day report', () => {
  const decisions = [
    dec('1', 'v1', 's1', T0, 'a'),                                  // v1 sees a, then b, clicks b: last-touch pays b, first-touch pays a (any-item)
    dec('2', 'v1', 's1', T0 + 60_000, 'b', 'personalized', true),
    dec('3', 'v2', 's2', T0, 'a', 'default'),                       // the holdout's default arm: no exposure, its click counts for the arm
    dec('4', 'v3', 's3', T0, 'a'),                                  // v3 buys 2 days later: outside the 30 min click window, inside a purchase window only under a purchase policy
  ];
  const outcomes = [
    out('v1', 's1', T0 + 120_000, 'click', 'b'),
    out('v2', 's2', T0 + 30_000, 'click', 'a'),
    out('v3', 's3', T0 + 2 * 24 * 3600_000, 'purchase', 'a'),
  ];

  it('rings are per visitor, oldest first', () => {
    const rings = ringsOf(decisions);
    expect(rings.size).toBe(3);
    expect(rings.get('v1')!.map((e) => e.item)).toEqual(['a', 'b']);
  });

  it('the learning grid, the reporting overlays beside it, the arms and what explored', () => {
    const anyFirst: ReportPolicy = { name: 'first-any', ...DEFAULT_POLICY, match: 'any', credit: 'first' };
    const r = buildReport({ tenant: 'coach', brand: 'coach', date: '2026-09-03', learning, reporting: [anyFirst], learn, decisions, outcomes, now: T0 + 3 * 3600_000, truncated: false });
    expect(r.counts).toEqual({ decisions: 4, outcomes: 3, visitors: 3, truncated: false });
    const L = r.grids.hero!.learning!, F = r.grids.hero!['first-any']!;
    // learning: last-touch, direct: the click on b pays b; the default arm's click pays no item; the purchase is a different reward for this slot
    expect(L.items.b!['*']!.s).toBeCloseTo(1, 1); expect(L.items.a!['*']!.s).toBe(0);   // decayed three hours on a 21-day τ
    expect(L.items.a!['*']!.n).toBeCloseTo(2, 1);                   // v1's and v3's exposures; the default arm is not an exposure
    // first-touch over any item: the same click pays a instead
    expect(F.items.a!['*']!.s).toBeCloseTo(1, 1); expect(F.items.b!['*']!.s).toBe(0);
    expect(r.policies.map((p) => [p.name, p.role, p.credits])).toEqual([['learning', 'learning', 2], ['first-any', 'reporting', 2]]);
    expect(r.holdout.hero).toEqual([{ arm: 'default', decisions: 1, credited: 1, rate: 1 }, { arm: 'personalized', decisions: 3, credited: 1, rate: 0.333 }]);
    expect(r.exploration).toEqual([{ slot: 'hero', decisions: 3, explored: 1, realized: 0.333, configured: 0.5, mode: 'rotation' }]);
  });

  it('presets are the natural overlays of the learning policy', () => {
    expect(presetPolicies(DEFAULT_POLICY).map((p) => p.name)).toEqual(['first-touch', 'any-item', 'visitor-scope', 'purchase-1d']);
    // the learning policy carries a name of its own; the overlays must keep theirs
    expect(presetPolicies(learning).map((p) => p.name)).toEqual(['first-touch', 'any-item', 'visitor-scope', 'purchase-1d']);
    expect(presetPolicies(DEFAULT_POLICY)[3]!.windowsMs.purchase).toBe(86_400_000);
  });

  it("loadDay reads a day's NDJSON batches for one stream and stops at the cap", async () => {
    const objects: Record<string, string> = {
      'coach/2026-09-03/12/decision/a-b-1.ndjson': [JSON.stringify(decisions[0]), JSON.stringify(decisions[1]), 'not json'].join('\n'),
      'coach/2026-09-03/12/outcome/a-b-1.ndjson': JSON.stringify(outcomes[0]),
      'coach/2026-09-03/13/decision/c-d-2.ndjson': JSON.stringify(decisions[2]),
      'coach/2026-09-04/00/decision/e-f-3.ndjson': JSON.stringify(decisions[3]),
    };
    const r2 = {
      put: async () => undefined,
      get: async (k: string) => (k in objects ? { text: async () => objects[k]! } : null),
      list: async ({ prefix }: { prefix: string }) => ({ objects: Object.keys(objects).filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    };
    const d = await loadDay<DecisionRecord>(r2, 'coach', '2026-09-03', 'decision', 10);
    expect(d.records.map((x) => x.visitor_id)).toEqual(['v1', 'v1', 'v2']); expect(d.truncated).toBe(false);
    const capped = await loadDay<DecisionRecord>(r2, 'coach', '2026-09-03', 'decision', 1);
    expect(capped.records).toHaveLength(1); expect(capped.truncated).toBe(true);
  });
});
