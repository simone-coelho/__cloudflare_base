// src/demos/meridian/funnel.test.ts
//
// THE REVENUE RADAR, HELD TO ITS OWN CLAIM.
//
// The conference abstract says the radar "surfaces a 44% Gen-Z checkout drop
// (roughly $7.6K recoverable) and proves the fix in the room". Nothing in
// funnel.ts contains either number: they have to FALL OUT of the simulated
// rows through Coach's arithmetic. These tests are the proof that they do, and
// the tripwire if someone retunes a constant and they stop doing so.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  funnel,
  parseCohort,
  defectCohortFor,
  defectDrilldownFor,
  AOV_USD,
  RECOVERABLE_FRACTION,
  GEN_COHORTS,
  COHORT_DIM,
  type Cohort,
} from './funnel';

const GEN_Z: Cohort = [{ dim: COHORT_DIM, value: 'gen_z' }];
const stepOf = (r: ReturnType<typeof funnel>, key: string) => r.steps.find((s) => s.key === key)!;

describe('the abstract, computed', () => {
  it('retail · Gen-Z: the payment → order drop is ≈44% and ≈$7.6K is recoverable', () => {
    const r = funnel('retail', GEN_Z);
    expect(r.worst).not.toBeNull();
    expect(r.worst!.key).toBe('order');
    expect(r.worst!.fromKey).toBe('payment');
    expect(r.worst!.dropPct).toBeGreaterThanOrEqual(44.0);
    expect(r.worst!.dropPct).toBeLessThanOrEqual(44.6);
    expect(r.worst!.severity).toBe('high');
    expect(r.worst!.skew).toMatch(/^gen_z \d\.\d× the drop$/);

    expect(r.recoverable).not.toBeNull();
    expect(r.recoverable!.amountUsd).toBeGreaterThanOrEqual(7400);
    expect(r.recoverable!.amountUsd).toBeLessThanOrEqual(7800);
    expect(r.recoverable!.remedy).toBe('Installments (Pay in 4) + social proof at the payment step');
    expect(r.recoverable!.audience).toBe('Gen-Z BNPL Hesitators');
  });

  it('retail · Gen-Z: the money is exactly the formula over the rows, every term shown', () => {
    const r = funnel('retail', GEN_Z);
    const order = stepOf(r, 'order');
    const payment = stepOf(r, 'payment');
    const m = r.recoverable!.math;
    expect(m.formula).toBe('excessLost × AOV × 0.3');
    expect(m.fraction).toBe(RECOVERABLE_FRACTION);
    expect(m.aov).toBe(AOV_USD.retail);
    // excess = drop − expected; excessLost = entering × excess; $ = excessLost × AOV × 0.3
    expect(order.excessDropPct).toBeCloseTo(order.dropPct - order.expectedDropPct, 1);
    expect(m.excessLostSessions).toBe(Math.round((payment.sessions * order.excessDropPct) / 100));
    expect(r.recoverable!.amountUsd).toBe(Math.round(m.excessLostSessions * m.aov * m.fraction));
    expect(r.recoverable!.lostSessions).toBe(m.excessLostSessions);
  });

  it('the Calder AOV is the catalogue mean, not a number somebody liked', () => {
    const items = JSON.parse(readFileSync('src/demos/meridian/catalog.retail.json', 'utf8')) as Array<{ value_usd: number }>;
    const mean = items.reduce((a, i) => a + i.value_usd, 0) / items.length;
    expect(Math.abs(AOV_USD.retail - mean) / mean).toBeLessThan(0.05);
  });
});

describe('the two-step reveal', () => {
  it('everyone looks healthy: every step within the ordinary range, nothing to recover', () => {
    const r = funnel('retail', []);
    expect(r.cohortKey).toBe('all');
    expect(r.worst).toBeNull();
    expect(r.recoverable).toBeNull();
    for (const s of r.steps) expect(s.severity).toBe('low');
    // The collapse is in there — it just does not clear the bar. That is the point.
    const order = stepOf(r, 'order');
    expect(order.excessDropPct).toBeGreaterThan(0);
    expect(order.excessDropPct).toBeLessThan(5);
    expect(order.skew).toMatch(/^gen_z /);   // the aggregate already knows who is skewing it
  });

  it('Gen-Z reveals it; the drill-down to mobile roughly doubles it', () => {
    const one = funnel('retail', defectCohortFor('retail'));
    const two = funnel('retail', defectDrilldownFor('retail'));
    expect(one.worst!.severity).toBe('high');
    expect(two.worst!.key).toBe('order');
    expect(two.worst!.excessDropPct).toBeGreaterThan(one.worst!.excessDropPct * 1.5);
    expect(two.cohortLabel).toBe('Gen-Z  +  device · mobile');
  });

  it('the other generations track the benchmark — no cohort we did not rehearse lights up', () => {
    for (const g of GEN_COHORTS.filter((x) => x !== 'gen_z')) {
      const r = funnel('retail', [{ dim: COHORT_DIM, value: g }]);
      for (const s of r.steps) expect(s.severity, `${g} · ${s.key}`).toBe('low');
      expect(r.recoverable).toBeNull();
    }
  });

  it('financial · Gen-Z: the identity check collapses on the same shape, with its own figures', () => {
    const all = funnel('financial', []);
    for (const s of all.steps) expect(s.severity).toBe('low');
    const r = funnel('financial', GEN_Z);
    expect(r.worst!.key).toBe('order');
    expect(r.worst!.fromLabel).toBe('Reached identity check');
    expect(r.worst!.severity).toBe('high');
    expect(r.worst!.dropPct).toBeGreaterThan(38);
    expect(r.recoverable!.remedy).toBe('Resume-by-link before the identity check');
    expect(r.recoverable!.aov).toBe(AOV_USD.financial);
    expect(r.recoverable!.amountUsd).toBeGreaterThan(10_000);
  });
});

describe('proving the fix', () => {
  it('the remedy returns Gen-Z to benchmark and the recoverable figure collapses', () => {
    const before = funnel('retail', GEN_Z);
    const after = funnel('retail', GEN_Z, { remedyApplied: true });
    expect(after.remedyApplied).toBe(true);
    const order = stepOf(after, 'order');
    expect(Math.abs(order.dropPct - order.expectedDropPct)).toBeLessThan(3);
    expect(order.severity).toBe('low');
    expect(after.recoverable).toBeNull();
    expect(order.lostRevenueUsd).toBeLessThan(before.recoverable!.amountUsd * 0.1);

    expect(after.recovered).toBeDefined();
    expect(after.recovered!.step).toBe('order');
    expect(after.recovered!.before.dropPct).toBe(before.worst!.dropPct);
    expect(after.recovered!.before.amountUsd).toBe(before.recoverable!.amountUsd);
    expect(after.recovered!.after.dropPct).toBe(order.dropPct);
    expect(after.recovered!.after.amountUsd).toBe(order.lostRevenueUsd);
    expect(after.recovered!.note).toMatch(/same simulated rows/i);
  });

  it('is the SAME rows: the population, its cohorts and every step above the defect are unchanged', () => {
    const before = funnel('retail', GEN_Z);
    const after = funnel('retail', GEN_Z, { remedyApplied: true });
    expect(after.sessions).toBe(before.sessions);
    expect(after.cohortOptions).toEqual(before.cohortOptions.map((o) => ({ ...o })));
    for (const key of ['land', 'browse', 'bag', 'payment']) {
      expect(stepOf(after, key).sessions, key).toBe(stepOf(before, key).sessions);
    }
    // Lifting a defect can only let sessions through; nobody who converted stops converting.
    expect(stepOf(after, 'order').sessions).toBeGreaterThan(stepOf(before, 'order').sessions);
  });

  it('touches nobody the remedy does not target', () => {
    const before = funnel('retail', [{ dim: COHORT_DIM, value: 'boomer' }]);
    const after = funnel('retail', [{ dim: COHORT_DIM, value: 'boomer' }], { remedyApplied: true });
    expect(after.steps.map((s) => s.sessions)).toEqual(before.steps.map((s) => s.sessions));
    expect(after.recovered!.before).toEqual(after.recovered!.after);
  });

  it('is not requested by default', () => {
    const r = funnel('retail', GEN_Z);
    expect(r.remedyApplied).toBe(false);
    expect(r.recovered).toBeUndefined();
  });
});

describe('the contract', () => {
  it('is deterministic — the same stage run produces the same numbers every time', () => {
    expect(funnel('retail', GEN_Z)).toEqual(funnel('retail', GEN_Z));
    expect(funnel('financial', [])).toEqual(funnel('financial', []));
    expect(funnel('retail', GEN_Z, { remedyApplied: true })).toEqual(funnel('retail', GEN_Z, { remedyApplied: true }));
  });

  it('carries every field the screen needs, computed', () => {
    const r = funnel('retail', GEN_Z);
    expect(r.honesty).toEqual({ traffic: 'simulated', compute: 'live', lift: 'representative' });
    expect(r.steps.map((s) => s.key)).toEqual(['land', 'browse', 'bag', 'payment', 'order']);
    for (const s of r.steps) {
      for (const k of ['sessions', 'rate', 'dropPct', 'expectedDropPct', 'excessDropPct', 'excessLostSessions', 'lostRevenueUsd']) {
        expect(typeof (s as any)[k], `${s.key}.${k}`).toBe('number');
      }
      expect(['low', 'mid', 'high']).toContain(s.severity);
      expect(s.dropPct).toBeCloseTo(100 * (1 - s.rate), 0);
    }
    expect(r.steps[0]!.dropPct).toBe(0);
    expect(r.steps[0]!.rate).toBe(1);
    expect(r.cohortKey).toBe('gen_z');
    expect(r.cohortLabel).toBe('Gen-Z');
    expect(r.shareOfTraffic).toBeGreaterThan(0.19);
    expect(r.shareOfTraffic).toBeLessThan(0.25);
  });

  it('offers the five pills with real counts, and marks the active one', () => {
    const r = funnel('retail', GEN_Z);
    expect(r.cohortOptions.map((o) => o.key)).toEqual(['all', 'gen_z', 'millennial', 'gen_x', 'boomer']);
    expect(r.cohortOptions.map((o) => o.label)).toEqual(['Everyone', 'Gen-Z', 'Millennial', 'Gen-X', 'Boomer']);
    const total = r.cohortOptions[0]!.sessions;
    const gens = r.cohortOptions.slice(1).reduce((a, o) => a + o.sessions, 0);
    expect(gens).toBe(total);
    expect(r.cohortOptions.filter((o) => o.active).map((o) => o.key)).toEqual(['gen_z']);
    // Skewed the way the brief says: Gen-Z ≈ 22%, boomers ≈ 16%.
    const share = (k: string) => r.cohortOptions.find((o) => o.key === k)!.sessions / total;
    expect(share('gen_z')).toBeCloseTo(0.22, 1);
    expect(share('millennial')).toBeCloseTo(0.34, 1);
    expect(share('gen_x')).toBeCloseTo(0.28, 1);
    expect(share('boomer')).toBeCloseTo(0.16, 1);
    // And the existing dimensional filters are still there for the room to poke at.
    expect(r.available.some((a) => a.dim === 'priceBand' && a.value === 'premium')).toBe(true);
    expect(r.available.some((a) => a.dim === COHORT_DIM && a.label === 'Gen-Z')).toBe(true);
  });

  it('parses the cohort query in both forms, or mixed', () => {
    expect(parseCohort(undefined)).toEqual([]);
    expect(parseCohort('')).toEqual([]);
    expect(parseCohort('all')).toEqual([]);
    expect(parseCohort('gen_z')).toEqual([{ dim: COHORT_DIM, value: 'gen_z' }]);
    expect(parseCohort('priceBand:premium,device:mobile')).toEqual([
      { dim: 'priceBand', value: 'premium' }, { dim: 'device', value: 'mobile' },
    ]);
    expect(parseCohort('gen_z,device:mobile')).toEqual([
      { dim: COHORT_DIM, value: 'gen_z' }, { dim: 'device', value: 'mobile' },
    ]);
    expect(parseCohort('nonsense')).toEqual([]);          // a typo reads as everyone, never a 500
    // The old dimensional cohorts still compute; they just no longer hide a rehearsed defect.
    const r = funnel('retail', parseCohort('priceBand:premium,device:mobile'));
    expect(r.cohortKey).toBe('priceBand:premium,device:mobile');
    expect(r.sessions).toBeGreaterThan(0);
  });

  it('suggests the generational reveal, not the old device × premium one', () => {
    expect(defectCohortFor('retail')).toEqual([{ dim: COHORT_DIM, value: 'gen_z' }]);
    expect(defectDrilldownFor('retail')).toEqual([{ dim: COHORT_DIM, value: 'gen_z' }, { dim: 'device', value: 'mobile' }]);
    expect(defectCohortFor('financial')).toEqual([{ dim: COHORT_DIM, value: 'gen_z' }]);
  });
});
