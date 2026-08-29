// src/demos/meridian/contentCompose.ts
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT IS A CATALOGUE TOO — the Tapestry thesis (doc 18), executable.
//
// The same arithmetic that ranks products ranks content: a piece's score for a
// slot is Σ over its tags of affinity[dim][value] · the slot's dimension
// weight. Deterministic, explainable, no model in the render path. The output
// is the DELIVERY CONTRACT itself: one push per page — an array of
// { contentId, customerContentId, type, slot, order, score, explain } — the
// customer's front end paints. Cross-slot invariants enforced here, where the
// contract says they live: DEDUPE (no piece twice per page), NON-PERSONALIZABLE
// slots untouched (the merchandiser banner takes its piece from tenant config,
// never from ranking), ABSENT DECISION → the slot's default piece.
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

interface AffinityViewLike { dims: Readonly<Record<string, Readonly<Record<string, number>>>> }

export function composeContent(
  pieces: readonly ContentPieceLike[],
  affinity: AffinityViewLike,
  slots: readonly ContentSlotSpec[],
): ContentDecision[] {
  const live = pieces.filter((p) => (p.lifecycle?.status ?? 'live') === 'live');
  const used = new Set<string>();
  const out: ContentDecision[] = [];
  let order = 0;

  for (const slot of slots) {
    // Non-personalizable: the tenant's piece, verbatim, and ranking never runs.
    if (slot.pinnedPieceId) {
      const p = live.find((x) => x.id === slot.pinnedPieceId);
      if (p) {
        used.add(p.id);
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
      drivers.sort((x, y) => y.a * y.weight - x.a * x.weight);
      return { p, score, drivers };
    }).sort((x, y) => y.score - x.score || x.p.id.localeCompare(y.p.id));

    let taken = 0;
    for (const s of scored) {
      if (taken >= slot.take) break;
      const cold = s.score <= 0;
      used.add(s.p.id);
      out.push({ contentId: s.p.id, customerContentId: s.p.customerContentId, type: s.p.type,
        slot: slot.slot, order: order++, score: Math.round(s.score * 1000) / 1000,
        strategy: cold ? 'default' : 'affinity',
        explain: { drivers: s.drivers.slice(0, 4), ...(cold ? { note: 'no signal yet — the slot default (catalogue order)' } : {}) } });
      taken += 1;
    }
  }
  return out;
}
