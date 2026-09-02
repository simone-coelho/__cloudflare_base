// src/content/cell.ts
// Doc 22 §5.4: the context a decision was made in. Built only from what is
// actually known. Channel and visit bucket are `unknown` until CW7 lands and are
// recorded that way; a cell that guessed would poison the statistics it feeds.

import type { AffinitySnapshot, ReflexConfig } from '@/reflex/core';
import type { Cell } from './types';

/** The subset of request.cf this module reads. */
export interface CfLike { country?: string | null; regionCode?: string | null }

/** `US-NY` when both are known, `US` when only the country is, else null. */
export function regionOf(cf: CfLike | null | undefined): string | null {
  const country = (cf?.country ?? '').trim();
  if (!country) return null;
  const region = (cf?.regionCode ?? '').trim();
  return region ? `${country}-${region}` : country;
}

/**
 * The leading interest: the dimension value with the highest affinity among
 * those above their dimension's entry threshold (per-dimension θ_in wins over
 * the global). Ties resolve in registry order, so it is deterministic.
 */
export function affinityCellOf(
  snap: Pick<AffinitySnapshot, 'dims'> | null | undefined,
  cfg: ReflexConfig,
): string | null {
  if (!snap) return null;
  let best: { key: string; a: number } | null = null;
  for (const d of cfg.dimensions) {
    const theta = d.thetaIn ?? cfg.thetaIn;
    const values = snap.dims[d.key];
    if (!values) continue;
    for (const [value, a] of Object.entries(values)) {
      if (a >= theta && (best === null || a > best.a)) best = { key: `${d.key}:${value}`, a };
    }
  }
  return best?.key ?? null;
}

export function visitBucketOf(n: number | null | undefined): Cell['visit_bucket'] {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 1) return 'unknown';
  if (n === 1) return '1';
  if (n <= 3) return '2-3';
  return '4+';
}

export function cellFor(input: {
  cf?: CfLike | null;
  snap?: Pick<AffinitySnapshot, 'dims'> | null;
  cfg: ReflexConfig;
  channel?: string | null;
  visitNumber?: number | null;
}): Cell {
  const channel = (input.channel ?? '').trim().toLowerCase().slice(0, 32) || 'unknown';
  return {
    channel,
    visit_bucket: visitBucketOf(input.visitNumber),
    region: regionOf(input.cf),
    affinity: affinityCellOf(input.snap, input.cfg),
  };
}
