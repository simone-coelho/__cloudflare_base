// src/demos/meridian/expiry.test.ts
//
// expiryOf() mirrors the closed form inside core.nextCrossing() for a SINGLE
// membership. Mirroring was the right call — widening core's signature reaches
// into two other demos — but a copied formula rots silently, and the failure
// mode is a countdown on stage that disagrees with the audience it belongs to.
// So the two are pinned together here: when exactly one membership can lapse,
// they must return the same instant.

import { describe, it, expect } from 'vitest';
import { emptyState, apply, nextCrossing } from '@/reflex/core';
import { configFor, expiryOf, stageKeyFor } from './reflexConfig';

const cfg = configFor('retail');

describe('expiryOf', () => {
  it('agrees with core.nextCrossing when one membership can lapse', () => {
    const now = 1_700_000_000_000;
    const stageKey = stageKeyFor('retail');

    // One decisive act: enough to enter the deciding audience on its own.
    const res = apply(
      emptyState(cfg),
      { action: 'intent_start', touches: [{ dim: stageKey, value: 'deciding' }] },
      now, cfg,
    );
    expect(res.state.audiences.length).toBe(1);

    const mine = expiryOf(res.state, stageKey, 'deciding', cfg);
    const core = nextCrossing(res.state, now, cfg);

    expect(mine).not.toBeNull();
    expect(core).not.toBeNull();
    // Same closed form, so this is equality rather than approximation.
    expect(Math.round(mine!)).toBe(Math.round(core!));
  });

  it('returns null for a membership that is already under the floor', () => {
    const now = 1_700_000_000_000;
    const stageKey = stageKeyFor('retail');
    const res = apply(
      emptyState(cfg),
      { action: 'intent_start', touches: [{ dim: stageKey, value: 'deciding' }] },
      now, cfg,
    );
    // Far past any plausible half-life: the score has decayed below θ_out.
    const spec = cfg.dimensions.find((d) => d.key === stageKey)!;
    const longGone = {
      dims: { [stageKey]: { deciding: { s: 0.0001, t: res.state.dims[stageKey]!.deciding!.t } } },
    };
    expect(expiryOf(longGone, stageKey, 'deciding', cfg)).toBeNull();
    expect(spec.tauMs).toBeGreaterThan(0);
  });

  it('is null for a dimension or value the visitor never touched', () => {
    const state = emptyState(cfg);
    expect(expiryOf(state, 'journeyStage', 'deciding', cfg)).toBeNull();
    expect(expiryOf(state, 'nonsense', 'nonsense', cfg)).toBeNull();
  });
});
