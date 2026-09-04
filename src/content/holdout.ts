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

/**
 * The finalizer murmur3 ends with: every input bit reaches every output bit. FNV-1a alone leaves ids
 * that differ only in their last character a fixed distance apart, so a customer whose visitor ids are
 * sequential (account numbers, a commerce customer list) would get a holdout that is a block sample,
 * not a random one (found 2026-09-04; 180 of 200 blocks of ten consecutive ids on one arm, 0 after).
 */
export function mix32(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A well-mixed 32-bit hash of a string: FNV-1a with the finalizer. The same everywhere a bucket is drawn. */
export const hash32 = (s: string): number => mix32(fnv1a(s));

/** A visitor's position in [0, 1), stable for a given salt. */
export function bucketOf(visitorId: string, salt: string): number {
  return hash32(`${salt}:${visitorId}`) / 4294967296;
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
