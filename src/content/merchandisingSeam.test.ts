// src/content/merchandisingSeam.test.ts
// Scope §1.5 / ledger 20 row 6: season, promotion and margin as tunable
// multipliers, each itemised in the explain record, wired into the decision.

import { describe, it, expect } from 'vitest';
import { decideContent } from './decide';
import { validateContentCatalog, validateSlotCatalog } from './kinds';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess } from '@/learn/stats';
import type { ContentPiece, SlotStrategy } from './types';

const NOW = Date.now();
const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' };
const piece = (id: string, tags: Record<string, string[]>, merchandising?: ContentPiece['merchandising']): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...(merchandising ? { merchandising } : {}) });
const pieces = [piece('a', { occasion: ['evening'] }, { promotion: 1, margin: 0.5 }), piece('d', { occasion: ['evening'], line: ['drover'] }), piece('n', { occasion: ['weekend'] }, { promotion: 1 })];
const base = {
  tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const, nowMs: NOW,
  pieces, affinity: { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } }, cell,
  arm: 'personalized' as const, versions: { config: 1, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'v1',
};
const slotWith = (merchandising?: SlotStrategy['merchandising']): SlotStrategy[] => [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 }, ...(merchandising ? { merchandising } : {}) }];

describe('merchandising multipliers on the decision', () => {
  it('a promotion weight lifts the promoted piece, itemised as the delta it caused, and the numbers reconcile', () => {
    // without merchandising d leads: 0.28 + 0.175 = 0.455 against a's 0.28
    expect(decideContent({ ...base, slots: slotWith() }).records[0]!.item_id).toBe('d');
    const out = decideContent({ ...base, slots: slotWith({ promotion: 0.8 }) });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('a');                                       // 0.28 × 1.8 = 0.504 beats 0.455
    expect(hero.explain.score_base).toBeCloseTo(0.28, 3);
    expect(hero.explain.score_final).toBeCloseTo(0.504, 3);
    expect(hero.explain.merchandising).toMatchObject({ boost: 1.8, clamped: false });
    expect(hero.explain.merchandising!.drivers).toEqual([{ term: 'promotion', value: 1, weight: 0.8, boost: 1.8, contribution: 0.224 }]);
    expect(hero.explain.score_base + 0.224).toBeCloseTo(hero.explain.score_final, 3);
    expect(hero.explain.merchandising!.sentence).toMatch(/promotion 1.00 at weight 0.80 gives 1.80x/);
    expect(hero.explain.drivers).toContainEqual({ dim: 'merchandising', value: 'promotion', a: 1, weight: 0.8 });
    // d carries no signals: no block, no driver, score untouched
    const dRow = hero.candidates.find((c) => c.contentId === 'd')!;
    expect(dRow.score).toBeCloseTo(0.455, 3);
    expect(out.records.find((r) => r.slot === 'hero' && r.item_id === 'd')).toBeUndefined();
  });

  it('the combined boost is clamped and the deltas are scaled to what was really applied; a negative weight demotes', () => {
    const out = decideContent({ ...base, slots: slotWith({ promotion: 1, margin: 1, maxBoost: 1.7 }) });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('a');                                        // 0.28 × 1.7 = 0.476 beats 0.455
    const m = hero.explain.merchandising!;
    expect(m.clamped).toBe(true); expect(m.boost).toBe(1.7);               // raw 2 × 1.5 = 3, capped
    expect(m.drivers.reduce((s, d) => s + d.contribution, 0)).toBeCloseTo(hero.explain.score_final - hero.explain.score_base, 3);
    const demoted = decideContent({ ...base, slots: slotWith({ promotion: -0.5 }) });
    const aRow = demoted.records[0]!.candidates.find((c) => c.contentId === 'a')!;
    expect(aRow.score).toBeCloseTo(0.14, 3);                               // 0.28 × 0.5
  });

  it('sits before the lift: the lift multiplies the merchandised score', () => {
    const st = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(st, 'a', cell, NOW - i, DEFAULT_STATS);
    for (let i = 0; i < 20; i++) recordSuccess(st, 'a', cell, 'click', NOW - i, 1, DEFAULT_STATS);
    for (let i = 0; i < 100; i++) recordExposure(st, 'd', cell, NOW - i, DEFAULT_STATS);
    const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS);
    const out = decideContent({ ...base, slots: slotWith({ promotion: 0.5 }), learning: { snapshots: { hero: snap }, gammaOf: () => 1 } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('a');
    const merchandised = hero.explain.score_base + hero.explain.merchandising!.drivers.reduce((s, d) => s + d.contribution, 0);
    expect(hero.explain.score_final).toBeCloseTo(merchandised * hero.explain.lift!.lift, 2);
  });

  it('the default arm scores nothing, so there is nothing to multiply and no block', () => {
    const out = decideContent({ ...base, arm: 'default', slots: slotWith({ promotion: 1 }) });
    expect(out.records[0]!.explain.merchandising).toBeUndefined();          // a zero base has no delta to itemise
    expect(out.records[0]!.explain.drivers.some((d) => d.dim === 'merchandising')).toBe(false);
  });
});

describe('the documents carry the seam', () => {
  it('pieces validate their signals in 0..1 and slots their weights in -1..1 with the clamp', () => {
    const ok = validateContentCatalog({ pieces: [{ ...pieces[0], merchandising: { season: 0.2, promotion: 1 } }] });
    expect(ok.ok).toBe(true); if (ok.ok) expect(ok.value.pieces[0]!.merchandising).toEqual({ season: 0.2, promotion: 1 });
    const bad = validateContentCatalog({ pieces: [{ ...pieces[0], merchandising: { promotion: 2, discount: 1 } }] });
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/merchandising.promotion.*merchandising.discount/s);
    const slots = validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: { occasion: 0.3 }, merchandising: { promotion: -0.5, maxBoost: 1.5, minBoost: 0.7 } }] } });
    expect(slots.ok).toBe(true); if (slots.ok) expect(slots.value.pages.home![0]!.merchandising).toEqual({ promotion: -0.5, maxBoost: 1.5, minBoost: 0.7 });
    const badSlots = validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: {}, merchandising: { promotion: 3, maxBoost: 0.5 } }] } });
    expect(badSlots.ok).toBe(false);
  });
});
