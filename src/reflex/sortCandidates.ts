// src/reflex/sortCandidates.ts
// ---------------------------------------------------------------------------
// Custom product sort: re-rank a candidate set per shopper. Ledger 20 row 9.
//
// Scope appendix §1.11, as amended in v8 after Nitin caught it in future tense:
// "The engine re-ranks a candidate product set per shopper, using the same
// affinity profile that drives content decisions, and returns the reordered
// product IDs for Tapestry's front end to render. Tapestry's commerce platform
// remains authoritative for availability, price, and entitlements, and ranking
// operates within the candidate set returned."
//
// Every clause of that sentence is a design constraint here:
//
//   "the same affinity profile" -- the score is the shopper's per-dimension
//   affinity a(dim, value) from the reflex snapshot, summed over the touches the
//   candidate produces under the registry. Same vector, same arithmetic as
//   content. No second model.
//
//   "returns the reordered product IDs" -- we hand back ids in a new order and
//   nothing else. The feed carried the attributes in; the feed's owner renders.
//
//   "remains authoritative for availability, price, and entitlements" -- we do
//   not filter. If the platform sent it, it is eligible. Dropping a candidate
//   would be making an availability decision that is not ours to make.
//
//   "operates within the candidate set returned" -- we cannot lift item
//   ninety-seven from page four into position three because we never see it.
//
// And the sentence we have promised in three documents and now prove in a test:
// set the affinity weight to zero and the engine reproduces the platform's
// existing sort EXACTLY. Parity is a configuration of the same engine, not a
// fallback mode or a separate build. The sort is therefore explicitly stable on
// feed order, rather than relying on the runtime's sort being stable.
// ---------------------------------------------------------------------------

import { extractTouches, type ReflexConfig } from '@/reflex/core';

/** Whatever the commerce platform returned, carrying the attributes the registry reads. */
export type Candidate = Record<string, unknown> & { id: string };

/** The shopper's affinity snapshot: dims[dimension][value] = a in [0,1). */
export type AffinityDims = Record<string, Record<string, number>>;

export interface SortWeights {
  /**
   * The global dial. 1 is full personalization; 0 reproduces the feed order
   * exactly, which is the parity proof. Clamped to [0, 10].
   */
  affinity?: number;
  /** Per-dimension weights. An absent dimension weighs 1. Clamped to [0, 10]. */
  dims?: Record<string, number>;
}

export interface SortDriver {
  dim: string;
  value: string;
  /** The shopper's affinity for this value. */
  a: number;
  /** The dimension weight applied. */
  w: number;
  contribution: number;
}

export interface SortedCandidate {
  id: string;
  /** Where the platform put it, 0-based. */
  feedRank: number;
  /** Where we put it, 0-based. */
  rank: number;
  score: number;
  drivers: SortDriver[];
}

export interface SortResult {
  /** The ids, in the new order. This is what the front end renders. */
  order: string[];
  items: SortedCandidate[];
  /** The global dial as applied, after clamping. */
  affinityWeight: number;
  /** Candidates dropped for having no usable id, or for duplicating an earlier id. */
  dropped: number;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * Case-insensitive view of the snapshot, built once per call. The reflex
 * accumulates whatever value the event carried; a feed that spells "Tabby" as
 * "tabby" should still find it, and silently scoring zero on a casing mismatch
 * is the kind of failure that looks like "personalization does nothing".
 */
function foldDims(dims: AffinityDims): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [dim, values] of Object.entries(dims ?? {})) {
    const m = new Map<string, number>();
    for (const [value, a] of Object.entries(values ?? {})) {
      const k = value.toLowerCase();
      // Exact-case entries win over folded collisions, which is what a shopper's
      // real history would have produced anyway.
      if (!m.has(k) || value === value.toLowerCase()) m.set(k, a);
    }
    out.set(dim, m);
  }
  return out;
}

export function sortCandidates(
  candidates: readonly Candidate[],
  dims: AffinityDims,
  config: ReflexConfig,
  weights: SortWeights = {},
): SortResult {
  const affinityWeight = clamp(weights.affinity, 0, 10, 1);
  const dimWeight = (dim: string) => clamp(weights.dims?.[dim], 0, 10, 1);
  const folded = foldDims(dims);

  const seen = new Set<string>();
  let dropped = 0;
  const scored: SortedCandidate[] = [];

  candidates.forEach((candidate, feedRank) => {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    if (id === '' || seen.has(id)) { dropped += 1; return; }
    seen.add(id);

    const drivers: SortDriver[] = [];
    let score = 0;
    for (const touch of extractTouches(candidate, config)) {
      const a = folded.get(touch.dim)?.get(touch.value.toLowerCase()) ?? 0;
      if (a <= 0) continue;
      const w = dimWeight(touch.dim);
      const contribution = a * w;
      score += contribution;
      drivers.push({ dim: touch.dim, value: touch.value, a: r4(a), w: r4(w), contribution: r4(contribution) });
    }

    scored.push({ id, feedRank, rank: -1, score: r4(score * affinityWeight), drivers });
  });

  // Explicitly stable on feed order. At affinity 0 every score is 0 and this
  // comparator returns the feed unchanged, which is the parity proof; relying on
  // the runtime's sort stability would make that a property of the engine
  // rather than of the code.
  scored.sort((x, y) => (y.score - x.score) || (x.feedRank - y.feedRank));
  scored.forEach((item, rank) => { item.rank = rank; });

  return { order: scored.map((s) => s.id), items: scored, affinityWeight, dropped };
}
