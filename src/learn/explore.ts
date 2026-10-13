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
//
// P05: the adjacent swap, on a page's declared layout slot only, decides
// whether to explore by the same bucket and, inside the share, exchanges the
// modules of two adjacent positions of what the slot serves, the pair chosen
// from the same bucket among the pairs neither of whose positions a rule fixed,
// so the effect of each position can be estimated from the swaps.

import { hash32 } from '@/content/holdout';
import type { LiftSnapshot } from './stats';

export type ExploreMode = 'rotation' | 'thompson' | 'epsilon' | 'off' | 'adjacent-swap';

/** P05: the mode that swaps two adjacent positions, published only on a page's declared layout slot. */
export const ADJACENT_SWAP = 'adjacent-swap' as const;

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
export const SUPPORTED_EXPLORE_MODES: readonly ExploreMode[] = ['off', 'rotation', 'epsilon', ADJACENT_SWAP];

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
  /** The item to serve first. For Thompson, the whole ranking is replaced instead. For the adjacent swap, the module moved up. */
  pieceId: string;
  reason: string;
  bucket: number;
  /** Thompson only: the sampled rates that produced the ranking. */
  samples?: Record<string, number>;
  ranking?: string[];
  /** P05, the adjacent swap only: the two adjacent positions exchanged, counted from 1 within the slot. */
  positions?: [number, number];
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

/**
 * W28.R2 (LANE-LOG R204, amendment A20): the replay-compatibility marker of the
 * exploration RULES a decision was made under. The rules this build runs are
 * the ones W28.C1.01 and W28.M1.01 made: a draw inside the share is an
 * exploration even where it lands on the ranking's own leader, the recorded
 * support is the top candidates by score before the explored piece moved with
 * that piece beside them, and an item under a merchandiser `reject` or `freeze`
 * is never the pick. A record states it as `inputs.explorationRules` — beside
 * the page manifest `inputs.replay`, never inside it — whenever its decision
 * had the learning layer (without one no exploration rule runs and both rule
 * sets decide identically). The replay CHOOSES its rules from this member and
 * nothing else: absent, the record was written before these rules existed and
 * replays under the ones before them ({@link HISTORICAL_EXPLORATION_RULES});
 * present with any other value, the replay refuses. The axis is independent of
 * the Thompson marker (`inputs.replay.exploration`), as the pin, content-type
 * and governance markers are of each other.
 */
export const EXPLORATION_RULES = 'recorded-draws-v1';
export type ExplorationRules = typeof EXPLORATION_RULES;

/**
 * Internal capability: only the replay of a record that carries no
 * {@link EXPLORATION_RULES} marker opts into the rules before it — a rotation
 * or epsilon draw that agreed with the leader was not an exploration, a
 * controlled item could be drawn, and the recorded support was cut after the
 * move (`decideContent`). Never on a live decision.
 */
export const HISTORICAL_EXPLORATION_RULES = Symbol('historical exploration rules');

/** The rules a record's `inputs` state: the current ones, the ones before the marker existed, or a marker this build does not implement. */
export function recordedExplorationRules(inputs: object): 'current' | 'historical' | 'invalid' {
  if (!Object.prototype.hasOwnProperty.call(inputs, 'explorationRules')) return 'historical';
  return (inputs as { explorationRules?: unknown }).explorationRules === EXPLORATION_RULES ? 'current' : 'invalid';
}

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
    /**
     * P05, the adjacent swap only: the adjacent pairs the swap may exchange,
     * each named by its lower position counted from 1 in `ranked` — which is
     * then the slot's served order — the caller having left out every pair a
     * rule fixed a position of. Absent: every adjacent pair of `ranked`.
     */
    pairs?: readonly number[];
  },
  historical?: typeof HISTORICAL_EXPLORATION,
  historicalRules?: typeof HISTORICAL_EXPLORATION_RULES,
): ExplorePick | null {
  const { visitorId, slot, nowMs, ranked, snapshot, cfg } = input;
  // W28.R2: a record written before the current rules replays under the rules
  // it was written with, where no item control governed exploration.
  const before = historicalRules === HISTORICAL_EXPLORATION_RULES;
  const controlled = before ? undefined : input.controlled;
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
  // P05: inside the share the adjacent swap exchanges ONE adjacent pair of the
  // order it is handed, chosen from the decision's own bucket (visitor, slot and
  // hour), as epsilon chooses its pick: the same decision always swaps the same
  // pair. A pair touching a module under a merchandiser's control is not the
  // rule's to move (W28.M1.01), and with no pair left nothing is swapped.
  if (cfg.mode === ADJACENT_SWAP) {
    const legal = [...new Set(input.pairs ?? ranked.slice(1).map((_, i) => i + 1))].sort((a, b) => a - b)
      .filter((k) => Number.isSafeInteger(k) && k >= 1 && k < ranked.length && !controlled?.has(ranked[k - 1]!.id) && !controlled?.has(ranked[k]!.id));
    if (legal.length === 0) return null;
    const idx = Math.floor((bucket / share) * legal.length) % legal.length;
    const k = legal[idx]!;
    return { mode: ADJACENT_SWAP, pieceId: ranked[k]!.id, reason: `bucket ${bucket} < share ${share}: positions ${k} and ${k + 1} swapped, pair ${idx + 1} of ${legal.length}`, bucket, positions: [k, k + 1] };
  }
  // W28.M1.01: what exploration may serve. Empty of controls this is the ranking itself.
  const eligible = controlled?.size ? ranked.filter((r) => !controlled.has(r.id)) : ranked;
  if (eligible.length === 0) return null;
  // W28.C1.01(a) (F23 §4.1): a draw that lands on the ranking's own leader is
  // still the draw it was. The decision was made by this rule, inside the
  // configured share, so it is recorded as an exploration and counted in the
  // realized share; nothing is reordered, because the piece is already first.
  // Under the rules before (W28.R2), such a draw was not flagged: it answered null.
  if (cfg.mode === 'epsilon') {
    const idx = Math.floor((bucket / share) * eligible.length) % eligible.length;
    const pick = eligible[idx]!;
    if (before && pick.id === ranked[0]!.id) return null;
    return { mode: 'epsilon', pieceId: pick.id, reason: `bucket ${bucket} < share ${share}: uniform pick ${idx + 1} of ${eligible.length}`, bucket };
  }
  // Rotation: the under-observed item with the fewest observations, ties by id.
  const under = eligible.map((r) => ({ r, n: observationsOf(snapshot, r.id) })).filter((x) => x.n < cfg.floor)
    .sort((a, b) => (a.n - b.n) || a.r.id.localeCompare(b.r.id));
  if (under.length === 0) return null;
  const pick = under[0]!;
  if (before && pick.r.id === ranked[0]!.id) return null;
  return { mode: 'rotation', pieceId: pick.r.id, reason: `bucket ${bucket} < share ${share}: under-observed, n ${pick.n} < floor ${cfg.floor}`, bucket };
}
