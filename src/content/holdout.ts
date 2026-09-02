// src/content/holdout.ts
// Doc 22 §10. The arm is a hash of the visitor id and a salt: deterministic,
// sticky, and needing no storage. It is assigned at DECISION time because it is
// the one setting that cannot be applied retroactively — traffic served without
// an arm can never be given one afterwards.

import type { Arm, HoldoutConfig } from './types';

/** FNV-1a, 32-bit. Small, fast, and the same everywhere it is used in this repo. */
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A visitor's position in [0, 1), stable for a given salt. */
export function bucketOf(visitorId: string, salt: string): number {
  return fnv1a(`${salt}:${visitorId}`) / 4294967296;
}

export function armFor(visitorId: string, h: HoldoutConfig): Arm {
  const share = Math.min(1, Math.max(0, Number.isFinite(h.share) ? h.share : 0));
  if (share <= 0) return 'personalized';
  const b = bucketOf(visitorId, h.salt);
  if (b >= share) return 'personalized';
  // Inside the holdout slice, split evenly across the configured arms.
  const arms = h.arms.length ? h.arms : (['default'] as const);
  const idx = Math.min(arms.length - 1, Math.floor((b / share) * arms.length));
  return arms[idx] ?? 'default';
}
