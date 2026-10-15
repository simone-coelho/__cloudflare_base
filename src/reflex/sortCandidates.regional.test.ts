// src/reflex/sortCandidates.regional.test.ts
// The itemisation of the regional prior on a sorted item: one `regional`
// driver per touch the region moved, a = λ and w = share × the dimension
// weight, its contribution the region's part of that touch. Never added to the
// score twice, bounded inside the product-sort record, and absent without a prior.

import { describe, it, expect } from 'vitest';
import { sortCandidates } from './sortCandidates';
import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from './core';
import { blendAffinity } from './regionTrend';

const cfg: ReflexConfig = { ...DEFAULT_REFLEX_CONFIG, version: 'sort-regional-unit', dimensions: [{ key: 'type', source: 'type' }, { key: 'sizeBand', source: 'size' }] };
const feed = [{ id: 'q', type: 'QNED', size: '65' }, { id: 'o', type: 'OLED', size: '55' }];
const share = { type: { OLED: 1, QNED: 0.5 } };

describe('sortCandidates with the regional prior', () => {
  it('without a prior is exactly the sort it always was', () => {
    const personal = { type: { QNED: 0.4 } };
    expect(sortCandidates(feed, personal, cfg)).toEqual(sortCandidates(feed, personal, cfg, {}, null));
    expect(sortCandidates(feed, personal, cfg, {}, { region: 'US-NC', lambda: 0, share })).toEqual(sortCandidates(feed, personal, cfg));
  });

  it('itemises the region’s part of every touch it moved, and scores the blended vector once', () => {
    const personal = { type: { QNED: 0.4 } }, lambda = 0.5;
    const blended = blendAffinity(personal, share, lambda).dims;          // OLED 0.5, QNED 0.45
    const out = sortCandidates(feed, blended, cfg, { dims: { type: 2 } }, { region: 'US-NC', lambda, share });
    expect(out.order).toEqual(['o', 'q']);
    const [o, q] = out.items;
    expect(o!.drivers).toEqual([{ dim: 'type', value: 'OLED', a: 0.5, w: 2, contribution: 1 }, { dim: 'regional', value: 'US-NC', a: 0.5, w: 2, contribution: 1 }]);
    expect(q!.drivers).toEqual([{ dim: 'type', value: 'QNED', a: 0.45, w: 2, contribution: 0.9 }, { dim: 'regional', value: 'US-NC', a: 0.5, w: 1, contribution: 0.5 }]);
    // The score is the blended touches alone: the regional drivers say how much of each was the region's.
    expect(o!.score).toBe(1); expect(q!.score).toBe(0.9);
    // A dimension the region carries no share on (sizeBand) has no regional driver.
    expect(out.items.flatMap(i => i.drivers).filter(d => d.dim === 'regional')).toHaveLength(2);
  });

  it('stays inside the product-sort record’s bounds at the heaviest weight and a malformed share', () => {
    const out = sortCandidates(feed, { type: { OLED: 1 } }, cfg, { dims: { type: 10 } }, { region: 'US-NC', lambda: 1, share: { type: { OLED: 7, QNED: Number.NaN } } });
    const regional = out.items.flatMap(i => i.drivers).filter(d => d.dim === 'regional');
    expect(regional).toEqual([{ dim: 'regional', value: 'US-NC', a: 1, w: 10, contribution: 10 }]);
    expect(regional.every(d => d.w <= 10 && d.a <= 1)).toBe(true);
  });

  it('keeps parity: at affinity 0 the platform’s order comes back whatever the region says', () => {
    const blended = blendAffinity({}, share, 1).dims;
    const out = sortCandidates(feed, blended, cfg, { affinity: 0 }, { region: 'US-NC', lambda: 1, share });
    expect(out.order).toEqual(['q', 'o']);
    expect(out.items.every(i => i.score === 0)).toBe(true);
  });
});
