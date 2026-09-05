// src/measure/holdout.test.ts
//
// The intervals are checked against published values, not against this
// module's own arithmetic; the words are checked for what they claim.

import { describe, it, expect } from 'vitest';
import { compareArms, neededPerArm, newcombe, pooled, readTargets, wilson, zFor, TAPESTRY_TARGETS } from '@/measure/holdout';

describe('wilson', () => {
  it('matches the formula worked by hand: 10 of 40 at 95% is 0.1419 to 0.4020', () => {
    // centre = (p + z²/2n) / (1 + z²/n) = 0.27191; half-width = z·√(p(1−p)/n + z²/4n²) / (1 + z²/n) = 0.13004.
    const w = wilson(10, 40);
    expect(w.p).toBe(0.25);
    expect(w.lo).toBeCloseTo(0.1419, 3);
    expect(w.hi).toBeCloseTo(0.4020, 3);
  });

  it('behaves at zero successes, where the textbook interval collapses to a point', () => {
    const w = wilson(0, 20);
    expect(w.p).toBe(0);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeGreaterThan(0.1);   // 0 of 20 is consistent with a 16% rate
    expect(w.hi).toBeLessThan(0.2);
  });

  it('behaves at all successes, staying inside [0,1]', () => {
    const w = wilson(20, 20);
    expect(w.hi).toBe(1);
    expect(w.lo).toBeGreaterThan(0.8);
  });

  it('knows nothing from nothing', () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it('narrows as n grows', () => {
    const small = wilson(5, 50);
    const large = wilson(500, 5000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it('tolerates nonsense input without throwing', () => {
    expect(wilson(-3, 10).p).toBe(0);
    expect(wilson(30, 10).p).toBe(1);
    expect(wilson(NaN, NaN)).toEqual({ p: 0, lo: 0, hi: 1 });
  });
});

describe('newcombe', () => {
  it('matches the published example: 56/70 vs 48/80 gives 0.0524 to 0.3339', () => {
    // Newcombe (1998), example (a), method 10.
    const d = newcombe({ s: 56, n: 70 }, { s: 48, n: 80 });
    expect(d.p).toBeCloseTo(0.2, 4);
    expect(d.lo).toBeCloseTo(0.0524, 3);
    expect(d.hi).toBeCloseTo(0.3339, 3);
  });

  it('spans zero when the arms are indistinguishable', () => {
    const d = newcombe({ s: 3, n: 60 }, { s: 2, n: 55 });
    expect(d.lo).toBeLessThan(0);
    expect(d.hi).toBeGreaterThan(0);
  });

  it('is the whole range when an arm is empty', () => {
    expect(newcombe({ s: 0, n: 0 }, { s: 5, n: 50 })).toMatchObject({ lo: -1, hi: 1 });
  });
});

describe('neededPerArm', () => {
  it('reproduces the standard two-proportion sample size: 5% vs 6% needs about 8,000 per arm', () => {
    // 0.05 vs 0.06, alpha 0.05 two-sided, power 0.80: the usual tables give ≈ 8,100.
    const n = neededPerArm({ s: 50, n: 1000 }, { s: 60, n: 1000 });
    expect(n).toBeGreaterThan(7500);
    expect(n).toBeLessThan(8500);
  });

  it('is null when there is no difference to size, or no arm to size it against', () => {
    expect(neededPerArm({ s: 5, n: 100 }, { s: 5, n: 100 })).toBeNull();
    expect(neededPerArm({ s: 0, n: 0 }, { s: 5, n: 100 })).toBeNull();
  });
});

describe('pooled', () => {
  it('adds days together, ignoring junk', () => {
    expect(pooled([{ n: 10, s: 1 }, { n: 20, s: 3 }, { n: NaN as never, s: -1 }])).toEqual({ n: 30, s: 4 });
  });
});

describe('compareArms: the sentence', () => {
  it('calls the treatment better only when the interval excludes zero, and says why we can', () => {
    const r = compareArms({ arm: 'default', n: 2000, s: 60 }, { arm: 'personalized', n: 38000, s: 1900 });
    expect(r.verdict).toBe('treatment_better');
    expect(r.relative).toBeCloseTo((0.05 - 0.03) / 0.03, 2);
    expect(r.words).toContain('personalized 5.0% of 38,000 decisions vs default 3.0% of 2,000');
    expect(r.words).toContain('+2.0 points');
    expect(r.words).toContain('excludes zero');
    expect(r.words).toContain('personalized is doing better');
  });

  it('stays undecided at holdout sizes a week produces, and says how many more it needs', () => {
    const r = compareArms({ arm: 'default', n: 68, s: 2 }, { arm: 'personalized', n: 1240, s: 51 });
    expect(r.verdict).toBe('undecided');
    expect(r.words).toContain('not yet distinguishable from zero');
    expect(r.words).toMatch(/needs about [\d,]+ decisions on each arm/);
    expect(r.words).toContain('the smaller arm has 68');
    expect(r.neededPerArm).toBeGreaterThan(68);
  });

  it('can call the control better, which is the result nobody wants and the holdout exists to find', () => {
    const r = compareArms({ arm: 'default', n: 5000, s: 300 }, { arm: 'personalized', n: 5000, s: 200 });
    expect(r.verdict).toBe('control_better');
    expect(r.words).toContain('default is doing better');
    expect(r.difference.p).toBeCloseTo(-0.02, 4);
  });

  it('says so when one arm has no decisions', () => {
    const r = compareArms({ arm: 'default', n: 0, s: 0 }, { arm: 'personalized', n: 100, s: 5 });
    expect(r.verdict).toBe('undecided');
    expect(r.words).toContain('nothing to compare');
    expect(r.relative).toBeNull();
  });

  it('says so when the rates are identical', () => {
    const r = compareArms({ n: 100, s: 5 }, { n: 100, s: 5 });
    expect(r.words).toContain('the two rates are the same so far');
    expect(r.neededPerArm).toBeNull();
  });

  it('reads no_learning against personalized as what learning adds on top', () => {
    const r = compareArms({ arm: 'no_learning', n: 900, s: 45 }, { arm: 'personalized', n: 9000, s: 540 });
    expect(r.control.arm).toBe('no_learning');
    expect(r.words).toContain('personalized 6.0% of 9,000 decisions vs no_learning 5.0% of 900');
  });
});

describe('CW34: the confidence level, and the other one beside it', () => {
  it('knows the three everyday quantiles exactly and interpolates the rest', () => {
    expect(zFor(0.9)).toBeCloseTo(1.6449, 4);
    expect(zFor(0.95)).toBeCloseTo(1.96, 4);
    expect(zFor(0.99)).toBeCloseTo(2.5758, 4);
    expect(zFor(0.8)).toBeCloseTo(1.2816, 3);
    expect(zFor(0.999)).toBeCloseTo(3.2905, 3);   // the tail branch
  });

  it('a 90% interval is narrower than the 95% one on the same counts', () => {
    const at95 = compareArms({ n: 200, s: 6 }, { n: 4000, s: 200 });
    const at90 = compareArms({ n: 200, s: 6 }, { n: 4000, s: 200 }, { confidence: 0.9 });
    expect(at95.confidence).toBe(0.95);
    expect(at90.confidence).toBe(0.9);
    expect(at90.difference.hi - at90.difference.lo).toBeLessThan(at95.difference.hi - at95.difference.lo);
    expect(at90.alsoAt.confidence).toBe(0.95);
    expect(at95.alsoAt.confidence).toBe(0.9);
    expect(at95.alsoAt.difference).toEqual(at90.difference);
  });

  it("says so when Tapestry's 90% rule would call what 95% does not", () => {
    // Counts chosen so the 95% interval just spans zero and the 90% one does not.
    const r = compareArms({ n: 300, s: 9 }, { n: 300, s: 19 });
    expect(r.verdict).toBe('undecided');
    expect(r.alsoAt.verdict).toBe('treatment_better');
    expect(r.words).toContain('At 90% it would be called: personalized better');
    expect(r.words).toContain('95% interval');
  });

  it('falls back to 95% for a confidence it does not recognise', () => {
    expect(compareArms({ n: 10, s: 1 }, { n: 10, s: 2 }, { confidence: 0.5 }).confidence).toBe(0.5);
    expect(compareArms({ n: 10, s: 1 }, { n: 10, s: 2 }, { confidence: NaN }).confidence).toBe(0.95);
  });
});

describe('CW34: the pre-set targets', () => {
  it("uses Tapestry's numbers by default and can be switched off", () => {
    const r = compareArms({ n: 1000, s: 30 }, { n: 20000, s: 900 });
    expect(r.targets?.targets).toEqual(TAPESTRY_TARGETS);
    expect(compareArms({ n: 10, s: 1 }, { n: 10, s: 2 }, { targets: null }).targets).toBeUndefined();
  });

  it('judges on the low end of the interval, not the point estimate', () => {
    // 3.0% vs 4.5%: +50% observed. Small arms: the low end is under the minimum, so on track, not reached.
    const small = compareArms({ n: 200, s: 6 }, { n: 4000, s: 180 });
    expect(small.relative).toBeCloseTo(0.5, 2);
    expect(small.targets?.standing).toBe('on_track');
    expect(small.words).toContain('on track, the observed lift clears the minimum but the low end of the interval is');
    // Same rates, big arms: the low end clears the target.
    const big = compareArms({ n: 20000, s: 600 }, { n: 400000, s: 18000 });
    expect(big.targets?.standing).toBe('reached_target');
    expect(big.words).toContain('the target is reached, the low end of the interval is +');
  });

  it('reaches stretch, or the minimum only, or is below', () => {
    expect(compareArms({ n: 20000, s: 400 }, { n: 400000, s: 16000 }).targets?.standing).toBe('reached_stretch');   // 2% → 4%: +100%
    expect(compareArms({ n: 20000, s: 600 }, { n: 400000, s: 15000 }).targets?.standing).toBe('reached_minimum');   // 3% → 3.75%: +25%
    expect(compareArms({ n: 20000, s: 600 }, { n: 400000, s: 12600 }).targets?.standing).toBe('below');             // 3% → 3.15%: +5%
    expect(compareArms({ n: 20000, s: 600 }, { n: 400000, s: 12600 }).words).toContain('below the minimum');
  });

  it('cannot be read against a control rate of zero, and says so', () => {
    const r = compareArms({ n: 100, s: 0 }, { n: 100, s: 5 });
    expect(r.targets?.standing).toBe('undecided');
    expect(r.words).toContain('cannot be read against a control rate of zero');
    expect(readTargets({ p: 0.05, lo: 0.01, hi: 0.09 }, 0, TAPESTRY_TARGETS).relativeLow).toBeNull();
  });

  it('accepts a tenant\u2019s own targets', () => {
    // 3% → 3.75%: +25% observed; the low end of the relative interval is about +17% at these sizes.
    const r = compareArms({ n: 20000, s: 600 }, { n: 400000, s: 15000 }, { targets: { minimum: 0.05, target: 0.15, stretch: 0.3 } });
    expect(r.targets?.relativeLow).toBeGreaterThan(0.15);
    expect(r.targets?.relativeLow).toBeLessThan(0.2);
    expect(r.targets?.standing).toBe('reached_target');
    expect(r.words).toContain('minimum +5%, target +15%, stretch +30% relative');
  });
});
