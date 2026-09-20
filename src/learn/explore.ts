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

import { hash32 } from '@/content/holdout';
import type { LiftSnapshot } from './stats';

export type ExploreMode = 'rotation' | 'thompson' | 'epsilon' | 'off';

export interface ExploreConfig {
  mode: ExploreMode;
  /** Fraction of decisions in the slot reserved for exploration. */
  share: number;
  /** Observations below which an item is under-observed. */
  floor: number;
}
/**
 * N25 (W28.S1.01): the compiled default states what a slot with no exploration
 * block actually does — nothing. `exploreOf` answers null for such a slot, so
 * the ranking serves and no record is flagged; the kit, doc 22 §7 and both
 * editors say the same. `floor` keeps its value: it is the fallback the
 * exploring answer publishes when a slot names no floor of its own
 * (`src/routes/decisions.ts`), which is the only member anything reads.
 */
export const DEFAULT_EXPLORE: ExploreConfig = { mode: 'off', share: 0, floor: 50 };

/** The modes the live decision path will run. A retained document may still name a withdrawn one. */
export const SUPPORTED_EXPLORE_MODES: readonly ExploreMode[] = ['off', 'rotation', 'epsilon'];

/** True for a mode the engine offers; `thompson` is withdrawn (doc 22 §7, HANDOFF-2026-09-16 :232). */
export function isSupportedExploreMode(mode: string | null | undefined): boolean {
  return typeof mode === 'string' && (SUPPORTED_EXPLORE_MODES as readonly string[]).includes(mode);
}

/** What a reporting surface says about a slot's dial: the mode the engine RAN, and the retained setting where they differ. */
export interface EffectiveExploration {
  /** The mode the engine runs; null where the slot configures no exploration at all. */
  mode: ExploreMode | null;
  /** The share a policy that can actually run reserves; null when nothing can run. */
  configured: number | null;
  /** The mode the document names, where the engine will not run it. */
  configuredMode?: ExploreMode;
  /** Set with `configuredMode`: the stored policy is retained, not offered. */
  unsupported?: true;
}

/**
 * W28.W1.01: a withdrawn mode is inert on the decision path (`explorationPick`
 * refuses it below), so every surface that REPORTS exploration reports the mode
 * the engine ran and names the retained setting instead of publishing a share
 * for a policy that cannot explore. One representation, in the words
 * `GET learn/exploring` already answers with.
 */
export function effectiveExploration(cfg: ExploreConfig | null | undefined): EffectiveExploration {
  if (!cfg) return { mode: null, configured: null };
  if (!isSupportedExploreMode(cfg.mode)) return { mode: 'off', configured: null, configuredMode: cfg.mode, unsupported: true };
  return { mode: cfg.mode, configured: cfg.mode === 'off' ? null : cfg.share };
}

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
  return hash32(`explore:${visitorId}:${slot}:${hourKey}`) / 4294967296;
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
/** Internal capability: only retained historical replay opts into withdrawn sampling. */
export const HISTORICAL_EXPLORATION = Symbol('historical exploration');

export function explorationPick(
  input: {
    visitorId: string; slot: string; nowMs: number; ranked: readonly Ranked[];
    snapshot: LiftSnapshot | null | undefined; cfg: ExploreConfig;
    /**
     * W28.M1.01 (F23 §4.3): items whose learned treatment a merchandiser has
     * taken manual control of — `reject` removed the learned evidence from the
     * item's treatment, `freeze` replaced it with a chosen value. Exploration
     * selects on that same learned evidence, so a controlled item is not
     * eligible for it and keeps the position its base score earned. The ranking
     * itself is unchanged: the leader the pick is compared against is still the
     * merchandiser's own.
     */
    controlled?: ReadonlySet<string>;
  },
  historical?: typeof HISTORICAL_EXPLORATION,
): ExplorePick | null {
  const { visitorId, slot, nowMs, ranked, snapshot, cfg, controlled } = input;
  if (cfg.mode === 'off' || ranked.length < 2) return null;
  if (cfg.mode === 'thompson' && historical !== HISTORICAL_EXPLORATION) return null;
  const share = Math.min(1, Math.max(0, cfg.share));
  const bucket = Math.round(bucketOf(visitorId, slot, hourKeyOf(nowMs)) * 1000) / 1000;

  if (cfg.mode === 'thompson') {
    // Every decision ranks on a sampled rate; the sample is the exploration.
    const rng = mulberry32(hash32(`thompson:${visitorId}:${slot}:${hourKeyOf(nowMs)}`));
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
  // W28.M1.01: what exploration may serve. Empty of controls this is the ranking itself.
  const eligible = controlled?.size ? ranked.filter((r) => !controlled.has(r.id)) : ranked;
  if (eligible.length === 0) return null;
  // W28.C1.01(a) (F23 §4.1): a draw that lands on the ranking's own leader is
  // still the draw it was. The decision was made by this rule, inside the
  // configured share, so it is recorded as an exploration and counted in the
  // realized share; nothing is reordered, because the piece is already first.
  if (cfg.mode === 'epsilon') {
    const idx = Math.floor((bucket / share) * eligible.length) % eligible.length;
    const pick = eligible[idx]!;
    return { mode: 'epsilon', pieceId: pick.id, reason: `bucket ${bucket} < share ${share}: uniform pick ${idx + 1} of ${eligible.length}`, bucket };
  }
  // Rotation: the under-observed item with the fewest observations, ties by id.
  const under = eligible.map((r) => ({ r, n: observationsOf(snapshot, r.id) })).filter((x) => x.n < cfg.floor)
    .sort((a, b) => (a.n - b.n) || a.r.id.localeCompare(b.r.id));
  if (under.length === 0) return null;
  const pick = under[0]!;
  return { mode: 'rotation', pieceId: pick.r.id, reason: `bucket ${bucket} < share ${share}: under-observed, n ${pick.n} < floor ${cfg.floor}`, bucket };
}
