// src/reflex/merchandising.test.ts
//
// Two properties carry the whole of section 1.5, and the rest is arithmetic.
//
//   The receipt reconciles. scoreBase + sum(contributions) === scoreFinal, in
//   every case including the clamp. "Itemized in the explain record" is worth
//   nothing if the items do not add up, because someone will check.
//
//   A multiplier tilts, never overrides. "Rules decide what can and must show.
//   Affinity decides what does show in the space that remains" stops being true
//   the moment margin can reorder a page on its own.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_BOOST,
  DEFAULT_MIN_BOOST,
  applyMerchandising,
  merchandisingSentence,
} from '@/reflex/merchandising';

/** scoreBase + sum(contributions) === scoreFinal, to the stored 4dp grain. */
const reconciles = (r: ReturnType<typeof applyMerchandising>) => {
  const summed = r.drivers.reduce((n, d) => n + d.contribution, r.scoreBase);
  return Math.abs(summed - r.scoreFinal) < 5e-4;
};

describe('parity: every weight at zero returns the affinity ordering exactly', () => {
  it('leaves the score untouched and writes no drivers', () => {
    const r = applyMerchandising(0.42, { season: 1, promotion: 1, margin: 1 }, {});
    expect(r.scoreFinal).toBe(0.42);
    expect(r.boost).toBe(1);
    expect(r.drivers).toEqual([]);
  });

  it('is the same with no signals and no weights at all', () => {
    const r = applyMerchandising(0.42, null, null);
    expect(r.scoreFinal).toBe(0.42);
    expect(r.drivers).toEqual([]);
  });
});

describe('the terms themselves', () => {
  it('boosts by 1 + weight * value', () => {
    const r = applyMerchandising(1, { season: 1 }, { season: 0.5 });
    expect(r.boost).toBe(1.5);
    expect(r.scoreFinal).toBe(1.5);
    expect(r.drivers).toHaveLength(1);
    expect(r.drivers[0]).toMatchObject({ term: 'season', value: 1, weight: 0.5, boost: 1.5 });
  });

  it('compounds several terms in the declared order', () => {
    const r = applyMerchandising(1, { season: 1, margin: 1 }, { season: 0.2, margin: 0.1 });
    expect(r.boost).toBeCloseTo(1.2 * 1.1, 4);
    expect(r.drivers.map((d) => d.term)).toEqual(['season', 'margin']);
  });

  it('keeps an ENABLED term that did not fire, so the receipt shows it was considered', () => {
    // "We looked at margin and this item had none" is information. Dropping it
    // would make an absent term and a zero-margin item indistinguishable.
    const r = applyMerchandising(1, { margin: 0 }, { margin: 0.4 });
    expect(r.drivers).toHaveLength(1);
    expect(r.drivers[0]).toMatchObject({ term: 'margin', value: 0, boost: 1, contribution: 0 });
    expect(r.scoreFinal).toBe(1);
  });

  it('omits a term whose weight is zero, because that term is switched off', () => {
    const r = applyMerchandising(1, { season: 1, margin: 1 }, { season: 0.3, margin: 0 });
    expect(r.drivers.map((d) => d.term)).toEqual(['season']);
  });

  it('demotes on a negative weight, which is an ordinary merchandising wish', () => {
    const r = applyMerchandising(1, { promotion: 1 }, { promotion: -0.4 });
    expect(r.boost).toBe(0.6);
    expect(r.scoreFinal).toBe(0.6);
    expect(r.drivers[0].contribution).toBeCloseTo(-0.4, 4);
  });
});

describe('the receipt reconciles', () => {
  it('adds up for a single term', () => {
    expect(reconciles(applyMerchandising(0.42, { season: 0.8 }, { season: 0.5 }))).toBe(true);
  });

  it('adds up for three compounding terms', () => {
    const r = applyMerchandising(0.37, { season: 0.9, promotion: 0.5, margin: 0.75 },
      { season: 0.4, promotion: 0.25, margin: 0.6 });
    expect(reconciles(r)).toBe(true);
  });

  it('STILL adds up when the clamp bites', () => {
    // The case that would otherwise itemize a boost the shopper never saw.
    const r = applyMerchandising(1, { season: 1, promotion: 1, margin: 1 },
      { season: 1, promotion: 1, margin: 1 });
    expect(r.clamped).toBe(true);
    expect(r.boost).toBe(DEFAULT_MAX_BOOST);
    expect(reconciles(r)).toBe(true);
  });

  it('adds up with mixed positive and negative terms', () => {
    const r = applyMerchandising(0.5, { season: 1, promotion: 1 }, { season: 0.6, promotion: -0.5 });
    expect(reconciles(r)).toBe(true);
  });
});

describe('a multiplier tilts, it never overrides', () => {
  it('caps the combined boost, so merchandising cannot reorder a page on its own', () => {
    const r = applyMerchandising(1, { season: 1, promotion: 1, margin: 1 },
      { season: 1, promotion: 1, margin: 1 });
    // Unclamped this would be 8x, which would sink any affinity difference.
    expect(r.boost).toBe(DEFAULT_MAX_BOOST);
    expect(r.clamped).toBe(true);
  });

  it('floors the combined boost, so a demotion cannot zero an item out', () => {
    // Zeroing an item is a BLOCK, and blocks are a different layer on purpose.
    const r = applyMerchandising(1, { season: 1, promotion: 1, margin: 1 },
      { season: -1, promotion: -1, margin: -1 });
    expect(r.boost).toBe(DEFAULT_MIN_BOOST);
    expect(r.scoreFinal).toBe(DEFAULT_MIN_BOOST);
    expect(r.clamped).toBe(true);
  });

  it('respects a tighter cap set per placement', () => {
    const r = applyMerchandising(1, { season: 1 }, { season: 1, maxBoost: 1.2 });
    expect(r.boost).toBe(1.2);
    expect(r.clamped).toBe(true);
  });

  it('cannot be configured below a cap of 1, which would make every boost a demotion', () => {
    const r = applyMerchandising(1, { season: 1 }, { season: 1, maxBoost: 0.1 });
    expect(r.boost).toBe(1);
  });

  it('preserves affinity ORDER between two items when neither is clamped', () => {
    // The property that matters on a page: a stronger affinity with the same
    // merchandising signal still wins.
    const w = { season: 0.5, margin: 0.3 };
    const sig = { season: 1, margin: 0.5 };
    const strong = applyMerchandising(0.6, sig, w).scoreFinal;
    const weak = applyMerchandising(0.4, sig, w).scoreFinal;
    expect(strong).toBeGreaterThan(weak);
  });
});

describe('untrusted input', () => {
  it('clamps signals into [0,1] rather than trusting a feed', () => {
    const over = applyMerchandising(1, { season: 5 }, { season: 0.5 });
    expect(over.boost).toBe(1.5);
    const under = applyMerchandising(1, { season: -3 }, { season: 0.5 });
    expect(under.boost).toBe(1);
  });

  it('clamps weights into [-1,1]', () => {
    const r = applyMerchandising(1, { season: 1 }, { season: 99 });
    expect(r.drivers[0].weight).toBe(1);
    expect(r.drivers[0].boost).toBe(2);
  });

  it('treats NaN and non-numbers as absent rather than propagating them', () => {
    const r = applyMerchandising(1, { season: NaN, margin: 'x' as never }, { season: 0.5, margin: 0.5 });
    expect(Number.isFinite(r.scoreFinal)).toBe(true);
    expect(r.scoreFinal).toBe(1);
  });

  it('survives a non-finite base score', () => {
    const r = applyMerchandising(NaN, { season: 1 }, { season: 0.5 });
    expect(r.scoreBase).toBe(0);
    expect(r.scoreFinal).toBe(0);
  });

  it('handles a zero base score without dividing by it', () => {
    const r = applyMerchandising(0, { season: 1 }, { season: 0.5 });
    expect(r.scoreFinal).toBe(0);
    expect(reconciles(r)).toBe(true);
  });
});

describe('the sentence a person reads', () => {
  it('names each term, its weight and what it did', () => {
    const r = applyMerchandising(0.4, { season: 1, margin: 0.5 }, { season: 0.5, margin: 0.2 });
    const line = merchandisingSentence(r);
    expect(line).toContain('season 1.00 at weight 0.50 gives 1.50x');
    expect(line).toContain('margin 0.50 at weight 0.20 gives 1.10x');
    expect(line).toContain('0.4000 to ');
  });

  it('says so when the cap bit, rather than implying the raw number was applied', () => {
    const r = applyMerchandising(1, { season: 1, promotion: 1, margin: 1 },
      { season: 1, promotion: 1, margin: 1 });
    expect(merchandisingSentence(r)).toContain('capped at 2.00x');
  });

  it('is empty when nothing applied, so the caller can omit the line', () => {
    expect(merchandisingSentence(applyMerchandising(1, {}, {}))).toBe('');
  });
});
