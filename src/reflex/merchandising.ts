// src/reflex/merchandising.ts
// ---------------------------------------------------------------------------
// Season, promotion and margin as tunable multipliers, each itemized.
//
// Scope appendix section 1.5, in full: "Merchandising sits above the engine.
// Eligibility gates run before scoring. Pins and blocks outrank the engine
// absolutely and survive audience regeneration. Season, promotion, and margin
// apply as tunable multipliers, each itemized in the explain record."
//
// Gates and pins were real. The multipliers did not exist as a term at all, which
// is ledger 20 row 6. This is the term.
//
// THE SENTENCE THIS HAS TO KEEP TRUE. The same section promises: "Rules decide
// what can and must show. Affinity decides what does show in the space that
// remains." A multiplier that can reorder a page on its own breaks that sentence,
// because then margin decides what shows and the pin layer was never needed. So
// the combined boost is CLAMPED. A multiplier tilts; it does not override. Anyone
// who wants an override has pins, which are a different layer on purpose.
//
// WHY THE CONTRIBUTIONS ARE DELTAS. "Itemized in the explain record" is only
// worth anything if the items add up. Each driver carries the score delta it
// actually caused, in a declared order, so scoreBase + sum(contributions) equals
// scoreFinal exactly -- including when the clamp bites, where the deltas are
// scaled to match what was really applied. A receipt whose numbers do not
// reconcile is worse than no receipt, because someone will check.
//
// This module is pure and has no opinion about where the weights are stored. Per
// doc 22 section 18.5, per-placement settings belong in their own document kind
// rather than in ReflexConfig, which is per-scope.
// ---------------------------------------------------------------------------

/** The three terms section 1.5 names, applied in this order. */
export const MERCHANDISING_TERMS = ['season', 'promotion', 'margin'] as const;
export type MerchandisingTerm = (typeof MERCHANDISING_TERMS)[number];

/**
 * The item's own signals, each normalized to [0,1] by whoever supplies the feed.
 *
 * These are ITEM properties, never shopper properties, which is the same line
 * gates already draw: an item can be out of season, a shopper cannot.
 */
export type MerchandisingSignals = Partial<Record<MerchandisingTerm, number>>;

/**
 * The tunable part, per placement.
 *
 * A weight of 0, or an absent weight, switches the term OFF: it contributes
 * nothing and does not appear in the explain record. Set every weight to zero and
 * the engine returns the affinity ordering exactly, which is the same parity
 * property the sort answer relies on.
 *
 * Negative weights are allowed and are not a mistake: demoting deep-discount
 * stock, or last season's carryover, is an ordinary merchandising wish.
 */
export interface MerchandisingWeights extends Partial<Record<MerchandisingTerm, number>> {
  /** Ceiling on the COMBINED boost. Default 2: a multiplier may at most double. */
  maxBoost?: number;
  /** Floor on the combined boost. Default 0.5: a multiplier may at most halve. */
  minBoost?: number;
}

export interface MerchandisingDriver {
  term: MerchandisingTerm;
  /** The item's signal, after clamping to [0,1]. */
  value: number;
  /** The configured strength, after clamping to [-1,1]. */
  weight: number;
  /** This term's own multiplier, 1 + weight * value. 1 means it did nothing. */
  boost: number;
  /** The score delta this term caused. The drivers sum to scoreFinal - scoreBase. */
  contribution: number;
}

export interface MerchandisingResult {
  scoreBase: number;
  scoreFinal: number;
  /** The combined multiplier actually applied, after the clamp. */
  boost: number;
  /** True when the clamp bit, so the receipt can say so rather than imply it. */
  clamped: boolean;
  drivers: MerchandisingDriver[];
}

export const DEFAULT_MAX_BOOST = 2;
export const DEFAULT_MIN_BOOST = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Round to 4dp, the same grain the decision receipts already store scores at. */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Apply the merchandising multipliers to an affinity score.
 *
 * Terms are applied in MERCHANDISING_TERMS order, which is declared rather than
 * incidental: the sequential deltas depend on it, and replay has to reproduce the
 * number exactly.
 */
export function applyMerchandising(
  scoreBase: number,
  signals: MerchandisingSignals | null | undefined,
  weights: MerchandisingWeights | null | undefined,
): MerchandisingResult {
  const base = finite(scoreBase, 0);
  const w = weights ?? {};
  const s = signals ?? {};

  const maxBoost = Math.max(1, finite(w.maxBoost, DEFAULT_MAX_BOOST));
  const minBoost = clamp(finite(w.minBoost, DEFAULT_MIN_BOOST), 0, 1);

  const active: Array<{ term: MerchandisingTerm; value: number; weight: number; boost: number }> = [];
  let rawBoost = 1;

  for (const term of MERCHANDISING_TERMS) {
    const weight = clamp(finite(w[term], 0), -1, 1);
    // A term that is switched off is absent from the receipt entirely. A term
    // that is ON but did not fire stays, with boost 1, because "we considered
    // margin and this item had none" is information a merchandiser wants.
    if (weight === 0) continue;
    const value = clamp(finite(s[term], 0), 0, 1);
    const boost = 1 + weight * value;
    active.push({ term, value, weight, boost });
    rawBoost *= boost;
  }

  if (active.length === 0) {
    return { scoreBase: r4(base), scoreFinal: r4(base), boost: 1, clamped: false, drivers: [] };
  }

  const boost = clamp(rawBoost, minBoost, maxBoost);
  const clamped = boost !== rawBoost;
  const scoreFinal = base * boost;
  const totalDelta = scoreFinal - base;

  // Sequential deltas: each term's contribution is what the running score moved
  // by when that term was applied. They sum to the UNCLAMPED delta, so when the
  // clamp bites they are scaled to the delta that was really applied. Without
  // that, the receipt would itemize a boost the shopper never saw.
  const rawDeltas: number[] = [];
  let running = base;
  for (const a of active) {
    const next = running * a.boost;
    rawDeltas.push(next - running);
    running = next;
  }
  const rawTotal = running - base;
  const scale = rawTotal === 0 ? 0 : totalDelta / rawTotal;

  const drivers: MerchandisingDriver[] = active.map((a, i) => ({
    term: a.term,
    value: r4(a.value),
    weight: r4(a.weight),
    boost: r4(a.boost),
    contribution: r4(rawDeltas[i] * scale),
  }));

  return { scoreBase: r4(base), scoreFinal: r4(scoreFinal), boost: r4(boost), clamped, drivers };
}

/**
 * One sentence a person can read, for the explain record's prose line.
 * Empty string when nothing applied, so a caller can omit the line entirely.
 */
export function merchandisingSentence(result: MerchandisingResult): string {
  if (result.drivers.length === 0) return '';
  const parts = result.drivers.map(
    (d) => `${d.term} ${d.value.toFixed(2)} at weight ${d.weight.toFixed(2)} gives ${d.boost.toFixed(2)}x`,
  );
  const tail = result.clamped ? `, capped at ${result.boost.toFixed(2)}x` : '';
  return `${parts.join('; ')}${tail}; ${result.scoreBase.toFixed(4)} to ${result.scoreFinal.toFixed(4)}`;
}
