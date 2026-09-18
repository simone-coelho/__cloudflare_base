import { extractTouches, type ReflexConfig } from '@/reflex/core';
import { sortCandidates, type AffinityDims, type Candidate, type SortResult, type SortWeights } from '@/reflex/sortCandidates';

export interface StructuredIntent {
  /** AND across dimensions, OR across the exact normalized values of each. */
  filters: Array<{ dimension: string; values: string[] }>;
}

export interface SearchResult extends SortResult {
  source: 'structured-intent';
  inputCount: number;
  /** Unique first records rejected by stock or explicit filters. */
  filteredCount: number;
  /** All eligible records before the result limit. */
  eligibleCount: number;
}

export class InvalidSearchIntent extends Error {
  constructor() { super('Invalid intent filters'); }
}

const normalized = (value: string) => value.trim().toLowerCase();

/**
 * A deterministic leg over a commerce-supplied candidate page, not catalog
 * retrieval or query interpretation. Availability and attributes are feed
 * assertions. The existing tenant registry supplies all matching semantics.
 */
export function searchCandidates(
  candidates: readonly Candidate[],
  intent: StructuredIntent,
  dims: AffinityDims,
  config: ReflexConfig,
  weights: SortWeights = {},
  limit = 9,
): SearchResult {
  const dimensions = new Set(config.dimensions.map(spec => spec.key));
  const filters = new Map<string, Set<string>>();
  for (const filter of intent.filters) {
    if (!dimensions.has(filter.dimension) || filters.has(filter.dimension)) throw new InvalidSearchIntent();
    filters.set(filter.dimension, new Set(filter.values.map(normalized)));
  }

  const seen = new Set<string>();
  const eligible: Candidate[] = [];
  const feedRanks: number[] = [];
  let dropped = 0;
  let filteredCount = 0;
  candidates.forEach((candidate, feedRank) => {
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    if (!id || seen.has(id)) { dropped += 1; return; }
    // First occurrence owns the ID even when it is unavailable or excluded.
    seen.add(id);
    if (candidate.inStock !== true) { filteredCount += 1; return; }
    const touches = extractTouches(candidate, config);
    for (const [dimension, values] of filters) {
      if (!touches.some(touch => touch.dim === dimension && values.has(normalized(touch.value)))) {
        filteredCount += 1;
        return;
      }
    }
    eligible.push(candidate);
    feedRanks.push(feedRank);
  });

  const ranked = sortCandidates(eligible, dims, config, weights);
  const items = ranked.items.slice(0, limit).map(item => ({ ...item, feedRank: feedRanks[item.feedRank]! }));
  return {
    ...ranked,
    source: 'structured-intent',
    order: items.map(item => item.id),
    items,
    inputCount: candidates.length,
    dropped,
    filteredCount,
    eligibleCount: eligible.length,
  };
}
