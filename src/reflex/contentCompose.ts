// src/reflex/contentCompose.ts
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT IS A CATALOGUE TOO — the content ranking arithmetic, shared.
//
// Pure and stateless like core.ts: no I/O, no config of its own, nothing to
// fork. A piece's score for a slot is Σ over its tags of affinity[dim][value] ·
// the slot's dimension weight — the same multiply that ranks products. The
// output is the delivery contract: one ordered decision per slot position,
// addressed by the customer's own content id, with the drivers that produced it.
//
// Cross-slot invariants live here because the contract says they do: DEDUPE (no
// piece twice on a page), PINNED slots untouched by ranking (the merchandiser's
// piece, verbatim), NO SIGNAL → the slot's default in catalogue order.
//
// Moved here from the Meridian demo on 2026-09-02 so the product decision
// service (src/content) and the demo run the same function rather than a copy
// of it. The demo re-exports it; its isolation charter allows this module by name.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContentPieceLike {
  id: string;
  customerContentId: string;
  type: string;
  title: string;
  subtitle?: string;
  tags: Readonly<Record<string, readonly string[]>>;
  slotTypes: readonly string[];
  lifecycle?: { status?: string };
  art?: string | null;
  runtime?: string;
}

export interface ContentSlotSpec {
  slot: string;
  /** How many pieces this slot takes (the carousel takes several). */
  take: number;
  /** dimension key → weight; the slot's own vector, like SLOT_STRATEGIES. */
  weights: Readonly<Record<string, number>>;
  /** Non-personalizable: ranking never runs; the pinned piece is tenant config. */
  pinnedPieceId?: string;
  /**
   * The completion logic, content-side: when she has committed to a piece, a
   * slot may PREFER content that completes it (a guide for the thing in her
   * bag). A preferred piece earns a named bonus that shows in its explain —
   * scored, not smuggled.
   */
  prefer?: { test: (p: ContentPieceLike) => boolean; bonus: number; label: string };
}

export interface ContentDecision {
  contentId: string;
  customerContentId: string;
  type: string;
  slot: string;
  order: number;
  score: number;
  strategy: 'affinity' | 'default' | 'tenant-pinned';
  explain: { drivers: Array<{ dim: string; value: string; a: number; weight: number }>; note?: string };
}

export interface AffinityViewLike { dims: Readonly<Record<string, Readonly<Record<string, number>>>> }

/** One ranked candidate for a slot: what was considered, and its base score. */
export interface SlotCandidate { contentId: string; score: number }

export interface ComposeContentResult {
  decisions: ContentDecision[];
  /**
   * Per slot, the top-N ranked candidates at the moment of decision — the
   * chosen pieces included. Recorded on the decision ledger (doc 22 §3.1) so a
   * decision can be replayed and its runner-up named.
   */
  candidates: Record<string, SlotCandidate[]>;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The composer, with the candidate sets the ledger records. Decisions are
 * byte-for-byte what composeContent() returns; the candidates are additional.
 */
/**
 * An optional final adjustment per candidate, applied after the tag sum and
 * before ranking. The learning layer uses it to multiply by lift^γ; the base
 * score is handed back so the receipt can show both.
 */
export type ScoreAdjust = (piece: ContentPieceLike, slot: string, baseScore: number) => number;

/**
 * An optional exploration hook, given the slot's ranked candidates after
 * scoring and before the take. It may name one piece to serve first, or hand
 * back a whole ranking. Returning null serves the ranking as scored.
 */
export type ExploreHook = (slot: string, ranked: ReadonlyArray<{ id: string; score: number }>) => { first?: string; ranking?: readonly string[] } | null;

export function composeContentDetailed(
  pieces: readonly ContentPieceLike[],
  affinity: AffinityViewLike,
  slots: readonly ContentSlotSpec[],
  candidateLimit = 10,
  adjust?: ScoreAdjust,
  explore?: ExploreHook,
): ComposeContentResult {
  const live = pieces.filter((p) => (p.lifecycle?.status ?? 'live') === 'live');
  // "Catalogue order" is the document's order: the merchandiser's, not the ids'. Ties, and the cold
  // case where every score is zero, resolve to the first eligible piece as the catalog lists them.
  const rank = new Map(pieces.map((p, i) => [p.id, i]));
  const used = new Set<string>();
  const out: ContentDecision[] = [];
  const candidates: Record<string, SlotCandidate[]> = {};
  let order = 0;

  for (const slot of slots) {
    // Non-personalizable: the tenant's piece, verbatim, and ranking never runs.
    if (slot.pinnedPieceId) {
      const p = live.find((x) => x.id === slot.pinnedPieceId);
      if (p) {
        used.add(p.id);
        candidates[slot.slot] = [{ contentId: p.id, score: 0 }];
        out.push({ contentId: p.id, customerContentId: p.customerContentId, type: p.type,
          slot: slot.slot, order: order++, score: 0, strategy: 'tenant-pinned',
          explain: { drivers: [], note: 'non-personalizable slot — tenant config; ranking never ran' } });
      }
      continue;
    }
    const eligible = live.filter((p) => p.slotTypes.includes(slot.slot) && !used.has(p.id));
    const scored = eligible.map((p) => {
      const drivers: ContentDecision['explain']['drivers'] = [];
      let score = 0;
      for (const [dim, values] of Object.entries(p.tags)) {
        const w = slot.weights[dim] ?? 0; if (!w) continue;
        for (const v of values) {
          const a = affinity.dims[dim]?.[v] ?? 0; if (a <= 0) continue;
          score += a * w; drivers.push({ dim, value: v, a, weight: w });
        }
      }
      if (slot.prefer?.test(p)) {
        score += slot.prefer.bonus;
        drivers.push({ dim: 'completes', value: slot.prefer.label, a: 1, weight: slot.prefer.bonus });
      }
      drivers.sort((x, y) => y.a * y.weight - x.a * x.weight);
      if (adjust) { const adjusted = adjust(p, slot.slot, score); if (Number.isFinite(adjusted) && adjusted >= 0) score = adjusted; }
      return { p, score, drivers };
    }).sort((x, y) => y.score - x.score || (rank.get(x.p.id) ?? 0) - (rank.get(y.p.id) ?? 0) || x.p.id.localeCompare(y.p.id));

    if (explore && scored.length > 1) {
      const pick = explore(slot.slot, scored.map((s) => ({ id: s.p.id, score: s.score })));
      if (pick?.ranking) {
        const order = new Map(pick.ranking.map((id, i) => [id, i]));
        scored.sort((x, y) => (order.get(x.p.id) ?? 1e9) - (order.get(y.p.id) ?? 1e9));
      } else if (pick?.first) {
        const i = scored.findIndex((s) => s.p.id === pick.first);
        if (i > 0) scored.unshift(...scored.splice(i, 1));
      }
    }

    candidates[slot.slot] = scored.slice(0, Math.max(0, candidateLimit))
      .map((s) => ({ contentId: s.p.id, score: round3(s.score) }));

    let taken = 0;
    for (const s of scored) {
      if (taken >= slot.take) break;
      const cold = s.score <= 0;
      used.add(s.p.id);
      out.push({ contentId: s.p.id, customerContentId: s.p.customerContentId, type: s.p.type,
        slot: slot.slot, order: order++, score: round3(s.score),
        strategy: cold ? 'default' : 'affinity',
        explain: { drivers: s.drivers.slice(0, 4), ...(cold ? { note: 'no signal yet — the slot default (catalogue order)' } : {}) } });
      taken += 1;
    }
  }
  return { decisions: out, candidates };
}

/** The delivery contract alone: one decision per slot position, in page order. */
export function composeContent(
  pieces: readonly ContentPieceLike[],
  affinity: AffinityViewLike,
  slots: readonly ContentSlotSpec[],
): ContentDecision[] {
  return composeContentDetailed(pieces, affinity, slots).decisions;
}
