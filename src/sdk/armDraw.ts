// src/sdk/armDraw.ts
// The holdout draw as a pure function of an identifier and a salt (doc 22 §10,
// W21 E1.01). It lives here, with no import of its own, so that the engine
// (src/content/holdout.ts re-exports it) and the head script (src/sdk/head.ts,
// P84) run the very same bytes: the class a page computes before paint for a
// browser the engine knows is the class the engine assigns it.

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

/** The holdout terms the draw reads (src/content/types.ts HoldoutConfig). */
export interface HoldoutTerms { share: number; salt: string; arms: ReadonlyArray<'default' | 'no_learning'> }

/** The share clamped to [0, 1]; anything not a finite number is no holdout. */
export function holdoutShare(share: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
}

export function armFor(visitorId: string, h: HoldoutTerms): 'personalized' | 'default' | 'no_learning' {
  const share = holdoutShare(h.share);
  if (share <= 0) return 'personalized';
  const b = bucketOf(visitorId, h.salt);
  if (b >= share) return 'personalized';
  // Inside the holdout slice, split evenly across the configured arms.
  const arms = h.arms.length ? h.arms : (['default'] as const);
  const idx = Math.min(arms.length - 1, Math.floor((b / share) * arms.length));
  return arms[idx] ?? 'default';
}

/**
 * P84 (E8, N4): the probability that a new identifier's arm is `default`, by
 * the split `armFor` makes — the share divided evenly across the arms, so the
 * `default` arm holds share × (its count in the arms) ÷ (the number of arms).
 * The head script draws a brand-new browser's class with it; the engine's
 * mint bounds its redraws with it.
 */
export function defaultArmProbability(h: Pick<HoldoutTerms, 'share' | 'arms'>): number {
  const arms = h.arms.length ? h.arms : (['default'] as const);
  return holdoutShare(h.share) * arms.filter((a) => a === 'default').length / arms.length;
}

/** The class an arm belongs to: `default` is the holdout's control, every other arm personalizes. */
export const armClassOf = (arm: string): 'default' | 'personalized' => arm === 'default' ? 'default' : 'personalized';
