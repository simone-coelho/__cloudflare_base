// src/learn/explore.ts
// Doc 22 §7, pure. Without exploration a new asset never accumulates evidence
// and can never win; with too much, the merchandiser's ranking is diluted.
// Three modes, all deterministic given their inputs, so a replay reproduces
// the pick and the receipt can say why it happened.
//
// Rotation and epsilon decide WHETHER to explore with a hash bucket over the
// visitor, the slot and the hour, exactly as the holdout assigns arms: the
// configured share is realized with no shared counter, which would be a
// single writer on the decision path. Rotation then serves the eligible item
// with the fewest observations; epsilon serves a uniformly chosen one.
// Thompson explores by ranking on a rate sampled from each item's evidence,
// seeded from the same inputs, so the sample is recomputable.

import { fnv1a } from '@/content/holdout';
import type { LiftSnapshot } from './stats';

export type ExploreMode = 'rotation' | 'thompson' | 'epsilon' | 'off';

export interface ExploreConfig {
  mode: ExploreMode;
  /** Fraction of decisions in the slot reserved for exploration. */
  share: number;
  /** Observations below which an item is under-observed. */
  floor: number;
}
export const DEFAULT_EXPLORE: ExploreConfig = { mode: 'rotation', share: 0.1, floor: 50 };

export interface Ranked { id: string; score: number }

export interface ExplorePick {
  mode: ExploreMode;
  /** The item to serve first. For Thompson, the whole ranking is replaced instead. */
  pieceId: string;
  reason: string;
  bucket: number;
  /** Thompson only: the sampled rates that produced the ranking. */
  samples?: Record<string, number>;
  ranking?: string[];
}

/** A deterministic unit interval from the decision's own coordinates. */
export function bucketOf(visitorId: string, slot: string, hourKey: string): number {
  return fnv1a(`explore:${visitorId}:${slot}:${hourKey}`) / 4294967296;
}
export const hourKeyOf = (ms: number) => String(Math.floor(ms / 3_600_000));

/** Observations of an item in the slot, from the snapshot's coarsest level. */
export function observationsOf(snap: LiftSnapshot | null | undefined, item: string): number {
  return snap?.items[item]?.['*']?.n ?? 0;
}

// A small seeded PRNG (mulberry32) so a Thompson sample is a function of its inputs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A Beta(a, b) sample by the ratio of two Gamma draws (Marsaglia and Tsang for the shape). */
function gamma(rng: () => number, k: number): number {
  if (k < 1) return gamma(rng, k + 1) * Math.pow(rng() || 1e-12, 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { const u1 = rng() || 1e-12, u2 = rng(); x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); v = 1 + c * x; } while (v <= 0);
    v = v * v * v; const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
export function betaSample(rng: () => number, alpha: number, beta: number): number {
  const x = gamma(rng, alpha), y = gamma(rng, beta);
  return x / (x + y);
}

/**
 * Decide whether and how to explore one slot's decision. `ranked` is the
 * slot's eligible candidates in score order. Null means: serve the ranking.
 */
export function explorationPick(
  input: { visitorId: string; slot: string; nowMs: number; ranked: readonly Ranked[]; snapshot: LiftSnapshot | null | undefined; cfg: ExploreConfig },
): ExplorePick | null {
  const { visitorId, slot, nowMs, ranked, snapshot, cfg } = input;
  if (cfg.mode === 'off' || ranked.length < 2) return null;
  const share = Math.min(1, Math.max(0, cfg.share));
  const bucket = Math.round(bucketOf(visitorId, slot, hourKeyOf(nowMs)) * 1000) / 1000;

  if (cfg.mode === 'thompson') {
    // Every decision ranks on a sampled rate; the sample is the exploration.
    const rng = mulberry32(fnv1a(`thompson:${visitorId}:${slot}:${hourKeyOf(nowMs)}`));
    const samples: Record<string, number> = {};
    for (const r of ranked) {
      const st = snapshot?.items[r.id]?.['*'];
      const n = st?.n ?? 0, s = st?.s ?? 0;
      samples[r.id] = Math.round(betaSample(rng, s + 1, Math.max(0, n - s) + 1) * 1000) / 1000;
    }
    const ranking = [...ranked].sort((a, b) => (samples[b.id]! - samples[a.id]!) || (b.score - a.score)).map((r) => r.id);
    const top = ranking[0]!;
    if (top === ranked[0]!.id) return null;   // the sample agreed with the ranking: nothing to flag
    return { mode: 'thompson', pieceId: top, reason: `sampled rate ${samples[top]} led; the ranking's leader sampled ${samples[ranked[0]!.id]}`, bucket, samples, ranking };
  }

  if (bucket >= share) return null;
  if (cfg.mode === 'epsilon') {
    const idx = Math.floor((bucket / share) * ranked.length) % ranked.length;
    const pick = ranked[idx]!;
    if (pick.id === ranked[0]!.id) return null;
    return { mode: 'epsilon', pieceId: pick.id, reason: `bucket ${bucket} < share ${share}: uniform pick ${idx + 1} of ${ranked.length}`, bucket };
  }
  // Rotation: the under-observed item with the fewest observations, ties by id.
  const under = ranked.map((r) => ({ r, n: observationsOf(snapshot, r.id) })).filter((x) => x.n < cfg.floor)
    .sort((a, b) => (a.n - b.n) || a.r.id.localeCompare(b.r.id));
  if (under.length === 0) return null;
  const pick = under[0]!;
  if (pick.r.id === ranked[0]!.id) return null;
  return { mode: 'rotation', pieceId: pick.r.id, reason: `bucket ${bucket} < share ${share}: under-observed, n ${pick.n} < floor ${cfg.floor}`, bucket };
}
