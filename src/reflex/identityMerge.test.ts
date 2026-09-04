// src/reflex/identityMerge.test.ts
//
// The two properties that make stitching safe to run on a live profile:
//
//   A merge is exactly the sum of what each device knew, at every later moment.
//   A batch of historical rows lands identically in any order.
//
// Everything else follows from those, and both are checked against apply()
// itself rather than against numbers typed in by hand.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFLEX_CONFIG, apply, audienceKey, effectiveScore, emptyState, snapshot, tick,
  type ReflexConfig, type ReflexState,
} from '@/reflex/core';
import { applyHistorical, mergeEntries, mergeReflexStates } from '@/reflex/identityMerge';

const cfg: ReflexConfig = DEFAULT_REFLEX_CONFIG;
const T0 = 1_700_000_000_000;
const TABBY = audienceKey('line', 'Tabby');
const view = (value: string, dim = 'line') => ({ action: 'product_view', touches: [{ dim, value }] });
const buy = (value: string, dim = 'line') => ({ action: 'purchase', touches: [{ dim, value }] });

/** A profile built by a sequence of (input, at) through the real apply(). */
function build(steps: Array<[ReturnType<typeof view>, number]>): ReflexState {
  let s: ReflexState = emptyState(cfg);
  for (const [input, at] of steps) s = apply(s, input, at, cfg).state;
  return s;
}

const eff = (s: ReflexState, dim: string, value: string, now: number) => {
  const e = s.dims[dim]?.[value];
  const tau = cfg.dimensions.find((d) => d.key === dim)?.tauMs ?? cfg.tauMs;
  return e ? effectiveScore(e, now, tau) : 0;
};

describe('mergeEntries', () => {
  it('lands at the later touch and sums what is left of each by then', () => {
    const a = { s: 3, t: T0 };
    const b = { s: 2, t: T0 + 30_000 };
    const m = mergeEntries(a, b, 60_000);
    expect(m.t).toBe(T0 + 30_000);
    expect(m.s).toBeCloseTo(3 * Math.exp(-0.5) + 2, 10);
  });

  it('is commutative', () => {
    const a = { s: 3, t: T0 };
    const b = { s: 2, t: T0 + 30_000 };
    expect(mergeEntries(a, b, 60_000)).toEqual(mergeEntries(b, a, 60_000));
  });
});

describe('mergeReflexStates: the sum of what each device knew', () => {
  const phone = build([[view('Tabby'), T0], [view('Tabby'), T0 + 5_000], [view('Rogue'), T0 + 8_000]]);
  const laptop = build([[view('Tabby'), T0 + 20_000], [buy('Brooklyn'), T0 + 40_000]]);
  const now = T0 + 60_000;

  it('holds, at every later moment, exactly effA + effB per value', () => {
    const merged = mergeReflexStates(phone, laptop, now, cfg).state;
    for (const later of [now, now + 15_000, now + 90_000]) {
      for (const v of ['Tabby', 'Rogue', 'Brooklyn']) {
        expect(eff(merged, 'line', v, later)).toBeCloseTo(eff(phone, 'line', v, later) + eff(laptop, 'line', v, later), 9);
      }
    }
  });

  it('is commutative', () => {
    const ab = mergeReflexStates(phone, laptop, now, cfg).state;
    const ba = mergeReflexStates(laptop, phone, now, cfg).state;
    expect(ab.dims).toEqual(ba.dims);
    expect(ab.audiences).toEqual(ba.audiences);
  });

  it('keeps t as the later real touch, never the moment of the merge', () => {
    const merged = mergeReflexStates(phone, laptop, now, cfg).state;
    expect(merged.dims.line.Tabby.t).toBe(T0 + 20_000);
    expect(merged.dims.line.Rogue.t).toBe(T0 + 8_000);
  });

  it('merging with nothing is the identity, evaluated at now', () => {
    const alone = mergeReflexStates(phone, null, now, cfg).state;
    const ticked = tick(phone, now, cfg).state;
    expect(alone.dims).toEqual(ticked.dims);
    expect(alone.audiences).toEqual(ticked.audiences);
    expect(mergeReflexStates(null, null, now, cfg).state.dims).toEqual({});
  });

  it('a membership either device had survives under hysteresis, and the receipt says what the merge changed', () => {
    // Three brisk Tabby views on the phone cross θ_in; the laptop never saw Tabby.
    const p = build([[view('Tabby'), T0], [view('Tabby'), T0 + 5_000], [view('Tabby'), T0 + 10_000]]);
    expect(p.audiences).toContain(TABBY);
    const l = build([[view('Rogue'), T0 + 10_000]]);
    const r = mergeReflexStates(p, l, T0 + 12_000, cfg);
    expect(r.state.audiences).toContain(TABBY);
    // Nothing new entered and nothing exited: the merge is faithful, not an event.
    expect(r.changes.entered).toEqual([]);
    expect(r.changes.exited).toEqual([]);
  });

  it('two half-interests become one whole one: an audience neither device qualified for', () => {
    // Each device saw Tabby once. Alone, a ≈ 1/(1+1.8) = 0.36 < θ_in. Together at
    // the same instant, 2/(2+1.8) = 0.53, still under; a third view on either
    // side and the merged profile crosses where neither single device would.
    const p = build([[view('Tabby'), T0], [view('Tabby'), T0 + 2_000]]);
    const l = build([[view('Tabby'), T0 + 1_000]]);
    expect(p.audiences).toEqual([]);
    expect(l.audiences).toEqual([]);
    const merged = mergeReflexStates(p, l, T0 + 3_000, cfg).state;
    expect(merged.audiences).toContain(TABBY);
  });

  it('respects a per-dimension horizon', () => {
    // priceBand decays on 150s, not 60s; the merge must use the dimension's own τ.
    const a: ReflexState = { v: 1, dims: { priceBand: { core: { s: 2, t: T0 } } }, audiences: [], configVersion: 'x' };
    const b: ReflexState = { v: 1, dims: { priceBand: { core: { s: 1, t: T0 + 150_000 } } }, audiences: [], configVersion: 'x' };
    const merged = mergeReflexStates(a, b, T0 + 150_000, cfg).state;
    expect(merged.dims.priceBand.core.s).toBeCloseTo(2 * Math.exp(-1) + 1, 10);
  });

  it('carries the config version it was evaluated under', () => {
    expect(mergeReflexStates(phone, laptop, now, cfg).state.configVersion).toBe(cfg.version);
  });
});

describe('applyHistorical: an action arriving late', () => {
  const rows: Array<[ReturnType<typeof view>, number]> = [
    [buy('Tabby'), T0 - 40_000],
    [view('Tabby'), T0 - 10_000],
    [view('Rogue'), T0 - 25_000],
    [buy('Rogue'), T0 + 5_000],
  ];
  const now = T0 + 30_000;

  it('applied in time order, equals the ordinary apply() at each moment', () => {
    // The reference: the same rows fed to apply() as they happened.
    const ordered = [...rows].sort((x, y) => x[1] - y[1]);
    let ref: ReflexState = emptyState(cfg);
    for (const [input, at] of ordered) ref = apply(ref, input, at, cfg).state;
    let hist: ReflexState = emptyState(cfg);
    for (const [input, at] of ordered) hist = applyHistorical(hist, input, at, cfg);
    for (const v of ['Tabby', 'Rogue']) {
      expect(eff(hist, 'line', v, now)).toBeCloseTo(eff(ref, 'line', v, now), 9);
    }
  });

  it('lands identically in ANY order', () => {
    const permutations = [
      [0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1],
    ];
    const results = permutations.map((perm) => {
      let s: ReflexState = emptyState(cfg);
      for (const i of perm) s = applyHistorical(s, rows[i][0], rows[i][1], cfg);
      return s;
    });
    for (const r of results.slice(1)) {
      for (const v of ['Tabby', 'Rogue']) {
        expect(eff(r, 'line', v, now)).toBeCloseTo(eff(results[0], 'line', v, now), 9);
        expect(r.dims.line[v].t).toBe(results[0].dims.line[v].t);
      }
    }
  });

  it('a row older than the last touch is discounted and never moves t backwards', () => {
    const live = build([[view('Tabby'), T0]]);
    const withOld = applyHistorical(live, buy('Tabby'), T0 - 60_000, cfg);
    expect(withOld.dims.line.Tabby.t).toBe(T0);
    // A purchase (5) a full τ before the touch is worth 5·e⁻¹ at the touch.
    expect(withOld.dims.line.Tabby.s).toBeCloseTo(1 + 5 * Math.exp(-1), 10);
  });

  it('a row so old it has decayed to nothing still cannot hurt', () => {
    const live = build([[view('Tabby'), T0]]);
    const ancient = applyHistorical(live, buy('Tabby'), T0 - 365 * 24 * 3_600_000, cfg);
    expect(ancient.dims.line.Tabby.s).toBeCloseTo(1, 10);
    expect(ancient.dims.line.Tabby.t).toBe(T0);
  });

  it('ignores an action with no weight and a dimension the registry does not name', () => {
    const s0 = emptyState(cfg);
    expect(applyHistorical(s0, { action: 'page_view', touches: [{ dim: 'line', value: 'Tabby' }] }, T0, cfg).dims).toEqual({});
    expect(applyHistorical(s0, { action: 'purchase', touches: [{ dim: 'colour', value: 'red' }] }, T0, cfg).dims).toEqual({});
  });

  it('does not touch memberships; tick() at now does', () => {
    let s: ReflexState = emptyState(cfg);
    for (const at of [T0, T0 + 1_000, T0 + 2_000]) s = applyHistorical(s, view('Tabby'), at, cfg);
    expect(s.audiences).toEqual([]);
    const evaluated = tick(s, T0 + 3_000, cfg).state;
    expect(evaluated.audiences).toContain(TABBY);
    expect(snapshot(evaluated, T0 + 3_000, cfg).dims.line.Tabby).toBeGreaterThanOrEqual(cfg.thetaIn);
  });

  it('does not mutate its input', () => {
    const live = build([[view('Tabby'), T0]]);
    const before = JSON.stringify(live);
    applyHistorical(live, buy('Tabby'), T0 + 1, cfg);
    expect(JSON.stringify(live)).toBe(before);
  });
});
