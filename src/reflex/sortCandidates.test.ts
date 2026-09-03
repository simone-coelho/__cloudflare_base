// src/reflex/sortCandidates.test.ts
//
// The first test is the one we have promised in three customer documents. The
// rest are the four clauses of §1.11, each as an assertion.

import { describe, it, expect } from 'vitest';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { sortCandidates, type AffinityDims, type Candidate } from '@/reflex/sortCandidates';

// A feed the way a commerce platform would return it: ids plus the attributes the
// registry reads (line, category, silhouette, occasion, price_usd).
const FEED: Candidate[] = [
  { id: 'P1', line: 'Rogue', category: 'Handbags', silhouette: 'satchel', occasion: ['work'], price_usd: 795 },
  { id: 'P2', line: 'Tabby', category: 'Handbags', silhouette: 'shoulder', occasion: ['evening'], price_usd: 380 },
  { id: 'P3', line: 'Tabby', category: 'Handbags', silhouette: 'crossbody', occasion: ['everyday'], price_usd: 350 },
  { id: 'P4', line: 'Willis', category: 'Handbags', silhouette: 'top-handle', occasion: ['evening'], price_usd: 395 },
  { id: 'P5', line: 'Rogue', category: 'Wallets', silhouette: 'wallet', occasion: ['everyday'], price_usd: 195 },
];

/** A shopper who has been circling Tabby, evening bags, in the core price band. */
const SHOPPER: AffinityDims = {
  line: { Tabby: 0.71 },
  occasion: { evening: 0.58 },
  priceBand: { core: 0.4 },
};

const NOBODY: AffinityDims = {};

describe('parity: affinity at zero reproduces the platform sort exactly', () => {
  it('returns the feed order unchanged at weight 0, whatever the shopper has done', () => {
    const r = sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG, { affinity: 0 });
    expect(r.order).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(r.affinityWeight).toBe(0);
  });

  it('returns the feed order unchanged for a shopper with no history', () => {
    // The cold-start case: nothing to personalize on, so the platform's own
    // merchandising stands.
    const r = sortCandidates(FEED, NOBODY, DEFAULT_REFLEX_CONFIG);
    expect(r.order).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
  });

  it('is explicitly stable: equal scores keep feed order', () => {
    // P2 and P3 are both Tabby. With only the line dimension mattering they tie,
    // and the platform's order between them must hold.
    const r = sortCandidates(FEED, { line: { Tabby: 0.6 } }, DEFAULT_REFLEX_CONFIG);
    const i2 = r.order.indexOf('P2'), i3 = r.order.indexOf('P3');
    expect(i2).toBeLessThan(i3);
  });
});

describe('the same affinity profile that drives content decisions', () => {
  it('lifts what the shopper has shown interest in', () => {
    const r = sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG);
    // P2: Tabby AND evening AND core band. P3: Tabby AND core. P4: evening AND core.
    expect(r.order[0]).toBe('P2');
    expect(r.order.indexOf('P3')).toBeLessThan(r.order.indexOf('P1'));
  });

  it('itemizes every driver, so a rank can be explained', () => {
    const r = sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG);
    const p2 = r.items.find((i) => i.id === 'P2')!;
    const dims = p2.drivers.map((d) => `${d.dim}.${d.value}`).sort();
    expect(dims).toEqual(['line.Tabby', 'occasion.evening', 'priceBand.core']);
    const sum = p2.drivers.reduce((n, d) => n + d.contribution, 0);
    expect(Math.abs(sum - p2.score)).toBeLessThan(1e-3);
  });

  it('reads the registry, so a band dimension scores from a numeric price', () => {
    // priceBand is derived: 350 falls in 'core' (cuts 150/400). The candidate
    // carried price_usd, not a band label, and the registry did the mapping.
    const r = sortCandidates([FEED[2]], { priceBand: { core: 0.9 } }, DEFAULT_REFLEX_CONFIG);
    expect(r.items[0].drivers[0]).toMatchObject({ dim: 'priceBand', value: 'core' });
  });

  it('matches values case-insensitively, so a feed spelling cannot silently zero the score', () => {
    const r = sortCandidates([FEED[1]], { line: { tabby: 0.7 } }, DEFAULT_REFLEX_CONFIG);
    expect(r.items[0].score).toBeGreaterThan(0);
  });

  it('honours per-dimension weights', () => {
    // Make occasion count for nothing and line for double: P3 (Tabby, everyday)
    // now beats P4 (Willis, evening) decisively.
    const r = sortCandidates(FEED, { line: { Tabby: 0.5 }, occasion: { evening: 0.9 } }, DEFAULT_REFLEX_CONFIG,
      { dims: { occasion: 0, line: 2 } });
    expect(r.order.indexOf('P3')).toBeLessThan(r.order.indexOf('P4'));
  });
});

describe('the platform remains authoritative', () => {
  it('never drops a candidate the platform sent, whatever the shopper has done', () => {
    const r = sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG);
    expect(r.order.length).toBe(FEED.length);
    expect(new Set(r.order)).toEqual(new Set(FEED.map((f) => f.id)));
  });

  it('operates only within the candidate set: nothing appears that was not sent', () => {
    const r = sortCandidates(FEED.slice(0, 2), SHOPPER, DEFAULT_REFLEX_CONFIG);
    expect(r.order).toHaveLength(2);
    expect(r.order).not.toContain('P3');
  });

  it('returns ids and ranks, not products: the feed owner renders', () => {
    const r = sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG);
    for (const item of r.items) {
      expect(Object.keys(item).sort()).toEqual(['drivers', 'feedRank', 'id', 'rank', 'score']);
    }
  });
});

describe('untrusted feed input', () => {
  it('drops a candidate with no id, and a duplicate id, and counts them', () => {
    const r = sortCandidates(
      [...FEED, { id: '' } as Candidate, { id: 'P1', line: 'Tabby' } as Candidate, { line: 'x' } as unknown as Candidate],
      SHOPPER, DEFAULT_REFLEX_CONFIG,
    );
    expect(r.order).toHaveLength(FEED.length);
    expect(r.dropped).toBe(3);
  });

  it('clamps the dials rather than trusting them', () => {
    expect(sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG, { affinity: -5 }).affinityWeight).toBe(0);
    expect(sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG, { affinity: 1e9 }).affinityWeight).toBe(10);
    expect(sortCandidates(FEED, SHOPPER, DEFAULT_REFLEX_CONFIG, { affinity: NaN }).affinityWeight).toBe(1);
  });

  it('scores a candidate with none of the registry fields as zero, not as an error', () => {
    const r = sortCandidates([{ id: 'bare' }], SHOPPER, DEFAULT_REFLEX_CONFIG);
    expect(r.items[0].score).toBe(0);
    expect(r.items[0].drivers).toEqual([]);
  });

  it('handles an empty feed', () => {
    const r = sortCandidates([], SHOPPER, DEFAULT_REFLEX_CONFIG);
    expect(r.order).toEqual([]);
  });
});
