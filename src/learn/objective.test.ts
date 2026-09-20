// src/learn/objective.test.ts
// CW27 (doc 22 §13): what a success is worth. Unit counts it; revenue weighs it by the order's value;
// margin by the margin the feed gave, or the value when it gave none. Nothing to weigh, nothing credited.

import { describe, it, expect } from 'vitest';
import { creditWeight } from './policy';
import { outcomeFromAction } from '@/ledger/records';
import { validateLearnConfig } from '@/content/kinds';
import { buildSnapshot, DEFAULT_STATS, emptyStats, liftFor, recordExposure, recordSuccess } from './stats';

const NOW = Date.now();
const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: null };

describe('the credit\'s weight under an objective', () => {
  it('unit counts, revenue weighs by value, margin weighs only a real margin; a click has nothing to weigh', () => {
    const purchase = outcomeFromAction({ type: 'purchase', userId: 'v', data: { orderId: 'o1', value: 395, currency: 'USD', items: [{ productId: 'A', quantity: 2, margin: 80 }, { productId: 'B', margin: 25.5 }] }, timestamp: NOW }, 'coach')!;
    expect(purchase.value).toBe(395); expect(purchase.margin).toBe(185.5);            // 80 × 2 + 25.5
    expect(creditWeight('unit', purchase)).toBe(1);
    expect(creditWeight('revenue', purchase)).toBe(395);
    expect(creditWeight('margin', purchase)).toBe(185.5);
    const noMargin = outcomeFromAction({ type: 'purchase', userId: 'v', data: { orderId: 'o2', value: 120, margin: 48 }, timestamp: NOW }, 'coach')!;
    expect(noMargin.margin).toBe(48);
    const bare = outcomeFromAction({ type: 'purchase', userId: 'v', data: { orderId: 'o3', value: 120 }, timestamp: NOW }, 'coach')!;
    // W24.R1.02 (ruling R144): a margin objective never falls back to the value.
    // Weighing a margin series with a revenue number is two units in one
    // counter (F19 §5.2, `margin ?? value`), so an outcome that carries no
    // margin is worth nothing to margin learning and is excluded from it.
    expect(bare.margin).toBeNull(); expect(creditWeight('margin', bare)).toBe(0);
    const click = outcomeFromAction({ type: 'content_click', userId: 'v', data: { contentId: 'c', slot: 'hero' }, timestamp: NOW }, 'coach')!;
    expect(click.value).toBeNull();
    expect(creditWeight('unit', click)).toBe(1); expect(creditWeight('revenue', click)).toBe(0); expect(creditWeight('margin', click)).toBe(0);
    expect(creditWeight(undefined, click)).toBe(1);
  });

  it('the learn document validates the objective against the reward', () => {
    const ok = validateLearnConfig({ holdout: { share: 0, arms: ['default'] }, slots: { hero: { reward: 'purchase', objective: 'revenue' } } });
    expect(ok.ok).toBe(true); if (ok.ok) expect(ok.value.slots!.hero!.objective).toBe('revenue');
    const bad = validateLearnConfig({ holdout: { share: 0, arms: ['default'] }, slots: { hero: { reward: 'click', objective: 'revenue' } } });
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.errors[0]).toMatch(/needs a reward that carries a value/);
    const unit = validateLearnConfig({ holdout: { share: 0, arms: ['default'] }, slots: { hero: { objective: 'unit' } } });
    expect(unit.ok).toBe(true); if (unit.ok) expect(unit.value.slots!.hero!.objective).toBe('unit');
    const unknown = validateLearnConfig({ holdout: { share: 0, arms: ['default'] }, slots: { hero: { reward: 'purchase', objective: 'clicks' } } });
    expect(unknown.ok).toBe(false);
  });

  it('a revenue-weighed slot ranks by revenue per exposure, and the snapshot and the lookup say so', () => {
    const st = emptyStats();
    // a: 100 exposures, 2 purchases worth 900 together; b: 100 exposures, 10 purchases worth 300 together
    for (let i = 0; i < 100; i++) { recordExposure(st, 'a', cell, NOW - i, DEFAULT_STATS); recordExposure(st, 'b', cell, NOW - i, DEFAULT_STATS); }
    recordSuccess(st, 'a', cell, 'purchase', NOW, 600, DEFAULT_STATS); recordSuccess(st, 'a', cell, 'purchase', NOW, 300, DEFAULT_STATS);
    for (let i = 0; i < 10; i++) recordSuccess(st, 'b', cell, 'purchase', NOW - i, 30, DEFAULT_STATS);
    const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'purchase', NOW, DEFAULT_STATS, null, 'revenue');
    expect(snap.objective).toBe('revenue');
    const a = liftFor(snap, 'a', cell)!, b = liftFor(snap, 'b', cell)!;
    expect(a.objective).toBe('revenue');
    expect(a.lift).toBeGreaterThan(b.lift);                      // 900 per 100 beats 300 per 100, though b converts five times as often
    expect(a.s).toBeCloseTo(900, 0); expect(b.s).toBeCloseTo(300, 0);
  });
});
