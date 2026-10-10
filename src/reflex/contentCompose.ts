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

import { compileSlotConstraints, type SlotConstraintReason } from '@/content/slotConstraints';

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
  pinnedPieceIds?: readonly string[];
  offLimits?: boolean;
  excludedPieceIds?: readonly string[];
  excludedTags?: ReadonlyArray<{ dimension: string; value: string }>;
  allowedTypes?: readonly string[];
  /**
   * The completion logic, content-side: when she has committed to a piece, a
   * slot may PREFER content that completes it (a guide for the thing in her
   * bag). A preferred piece earns a named bonus that shows in its explain —
   * scored, not smuggled.
   */
  prefer?: { test: (p: ContentPieceLike) => boolean; bonus: number; label: string };
  /**
   * CW33 (BTIE D11): at most `max` pieces sharing one value of `dimension` in
   * this slot. A piece over the limit yields its position to the next ranked
   * piece and is named on that piece's explain; when the rule leaves positions
   * unfilled, the yielded pieces fill them in rank order, marked `relaxed`.
   */
  diversity?: { dimension: string; max: number };
  /**
   * P01: a configured module order the caller resolved for THIS decision (the
   * shopper's context, an arm that personalizes). When the slot's exploration
   * picks nothing, the slot serves exactly these modules, in this order, after
   * its own pinned prefix: only those the slot could serve at all (eligible,
   * admitted by its gates, not served or reserved elsewhere on the page), and
   * never one it does not list, which stays hidden. Diversity does not apply to
   * it. When exploration picks, the slot serves its own decision (decision D2).
   * On a slot that also carries `blend` (P28), the order is not served exactly:
   * it supplies the rank base and its listed modules are ranked by the blend.
   */
  order?: readonly string[];
  /**
   * P28 (decision D1): the slot opted into the behaviour-and-performance blend.
   * The composer hands `adjust` each candidate's rank base R = (M − i) / M over
   * the slot's baseline — the modules it could serve (eligible, admitted by its
   * gates, not served or reserved elsewhere on the page) in catalogue order, or,
   * when an `order` is served, the listed modules among them in the order's
   * sequence, an unlisted module never entering the pool — and ranks by the
   * score `adjust` returns, whatever its sign. Requires `adjust`; without it the
   * slot decides exactly as before.
   */
  blend?: true;
  /**
   * P10 (decision D2): the interest view THIS slot is scored on, in place of the
   * page's. The caller sets it on a slot decided below the signal floor, where
   * it is the context view (the population prior at full weight, or nothing),
   * so no interest of the shopper's own reaches that slot's score or drivers.
   * Absent, the slot is scored on the page's view exactly as before.
   */
  affinity?: AffinityViewLike;
}

/**
 * P01: what a position served under a configured order says on its explain, on
 * a slot that does not opt into the layout blend (P28).
 */
export const CONFIGURED_ORDER_NOTE = 'configured order position — the merchandiser’s order for this context placed it; the ranking did not';
/** P28: what a position the layout blend ranked over the slot's catalogue order says on its explain. */
export const BLENDED_NOTE = 'layout blend position — ranked by R + (1 − p) × B + p × Q, the rank base R from the slot’s catalogue order';
/** P28: what a position the layout blend ranked over the configured order for the shopper's context says on its explain. */
export const BLENDED_ORDER_NOTE = 'layout blend position — ranked by R + (1 − p) × B + p × Q, the rank base R from the merchandiser’s configured order for this context';

export interface ContentDecision {
  contentId: string;
  customerContentId: string;
  type: string;
  slot: string;
  order: number;
  score: number;
  strategy: 'affinity' | 'default' | 'tenant-pinned';
  explain: {
    drivers: Array<{ dim: string; value: string; a: number; weight: number }>;
    note?: string;
    /** CW33: the slot's diversity rule touched this position. */
    diversity?: { dimension: string; max: number; skipped: string[]; relaxed: boolean; sentence: string };
  };
}

export interface AffinityViewLike { dims: Readonly<Record<string, Readonly<Record<string, number>>>> }

/** One ranked candidate for a slot: what was considered, and its base score. */
export interface SlotCandidate { contentId: string; score: number }

/** Only historical receipts may opt into the former, sequential pin behavior. */
export const HISTORICAL_PINS = Symbol('historical-pins');
/** Retained reservation policy before ordered prefixes. */
export const HISTORICAL_PINS_V1 = Symbol('historical-pins-v1');
export type HistoricalPins = typeof HISTORICAL_PINS | typeof HISTORICAL_PINS_V1;
/** Only retained receipts may ignore the later hard slot controls. */
export const HISTORICAL_GOVERNANCE = Symbol('historical-slot-governance');
/** Version-1 receipts enforce ID/off-limits gates, not later tag/type controls. */
export const HISTORICAL_GOVERNANCE_V1 = Symbol('historical-slot-governance-v1');
export type HistoricalGovernance = typeof HISTORICAL_GOVERNANCE | typeof HISTORICAL_GOVERNANCE_V1;

export interface PinDiagnostic {
  slot: string;
  pinnedPieceId: string;
  reason: 'invalid_take' | 'missing_or_ineligible' | 'slot_type' | 'duplicate_pin' | SlotConstraintReason;
  ownerSlot?: string;
  pinIndex?: number;
}

export interface ComposeContentResult {
  decisions: ContentDecision[];
  /**
   * Per slot, the top-N ranked candidates at the moment of decision — the
   * chosen pieces included. Recorded on the decision ledger (doc 22 §3.1) so a
   * decision can be replayed and its runner-up named.
   */
  candidates: Record<string, SlotCandidate[]>;
  /** Refused configuration, not fabricated delivery decisions or ledger rows. */
  pinDiagnostics?: PinDiagnostic[];
  /** P01: the slots that served their configured `order` on this decision, in page order. Absent when none did. */
  ordered?: string[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The composer, with the candidate sets the ledger records. Decisions are
 * byte-for-byte what composeContent() returns; the candidates are additional.
 */
/**
 * An optional final adjustment per candidate, applied after the tag sum and
 * before ranking. The learning layer uses it to multiply by lift^γ; the base
 * score is handed back so the receipt can show both. On a slot that opted into
 * the layout blend (`blend`, P28) the composer also hands it the candidate's
 * rank base `R`, and the returned score is the blend's.
 */
export type ScoreAdjust = (piece: ContentPieceLike, slot: string, baseScore: number, rank?: { R: number }) => number;

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
  historicalPins?: HistoricalPins,
  historicalGovernance?: HistoricalGovernance,
  /** Replay retains all reservations but never runs unrelated later ranking. */
  rankingSlots?: ReadonlySet<string>,
): ComposeContentResult {
  const live = pieces.filter((p) => (p.lifecycle?.status ?? 'live') === 'live');
  // "Catalogue order" is the document's order: the merchandiser's, not the ids'. Ties, and the cold
  // case where every score is zero, resolve to the first eligible piece as the catalog lists them.
  const rank = new Map(pieces.map((p, i) => [p.id, i]));
  const used = new Set<string>();
  const out: ContentDecision[] = [];
  const candidates: Record<string, SlotCandidate[]> = {};
  const reserved = new Map<string, string>();
  const resolvedPins = new Map<ContentSlotSpec, ContentPieceLike>();
  const pinDiagnostics: PinDiagnostic[] = [];
  const prefixes = new Map<ContentSlotSpec, { ids: string[]; take: number; pieces: ContentPieceLike[]; diversity?: { dimension: string; max: number }; seeds: string[] }>();
  if (!historicalPins) for (const slot of slots) if (slot.pinnedPieceIds) {
    prefixes.set(slot, { ids: [...slot.pinnedPieceIds], take: slot.take, pieces: [],
      ...(slot.diversity ? { diversity: { ...slot.diversity } } : {}), seeds: [] });
  }
  const refusedPrefixes = new Set<ContentSlotSpec>();
  const prefixOwnedPieces = new Set<ContentPieceLike>();
  const prefixCatalog = new Map<string, ContentPieceLike>();
  if (prefixes.size) for (const piece of live) if (!prefixCatalog.has(piece.id)) prefixCatalog.set(piece.id, piece);
  // Capture settings AND each piece's result before any caller hook can mutate
  // a later slot or its candidate tags. Unconstrained slots need no piece map.
  const offLimits = new Set<ContentSlotSpec>();
  const gates = new Map<ContentSlotSpec, ReturnType<typeof compileSlotConstraints>>();
  const forbidden = new Map<ContentSlotSpec, Map<ContentPieceLike, SlotConstraintReason>>();
  if (historicalGovernance !== HISTORICAL_GOVERNANCE) for (const slot of slots) {
    const gate = compileSlotConstraints(slot, historicalGovernance !== HISTORICAL_GOVERNANCE_V1);
    if (!gate.active) continue;
    gates.set(slot, gate);
    if (gate.offLimits) { offLimits.add(slot); continue; }
    const captured = new Map<ContentPieceLike, SlotConstraintReason>();
    for (const piece of live) { const reason = gate.reason(piece); if (reason) captured.set(piece, reason); }
    forbidden.set(slot, captured);
  }
  {
    // Reserve before any ranking. Invalid pins do not acquire ownership, and
    // inherited duplicates belong to the first valid pin in page order.
    for (const slot of slots) {
      const prefix = prefixes.get(slot);
      if (prefix) {
        const malformed = Boolean(slot.pinnedPieceId) || prefix.ids.length > 50 || prefix.ids.length > prefix.take
          || new Set(prefix.ids).size !== prefix.ids.length || prefix.ids.some(id => typeof id !== 'string' || !id.length);
        let invalid = malformed;
        for (const [pinIndex, id] of prefix.ids.entries()) {
          const piece = prefixCatalog.get(id), ownerSlot = reserved.get(id);
          const blocked = piece ? (offLimits.has(slot) ? 'off_limits' : forbidden.get(slot)?.get(piece)) : gates.get(slot)?.reason(undefined, id);
          const reason = blocked ?? (malformed ? 'invalid_take' : !piece ? 'missing_or_ineligible'
            : !piece.slotTypes.includes(slot.slot) ? 'slot_type' : ownerSlot !== undefined ? 'duplicate_pin' : null);
          if (reason) { invalid = true; pinDiagnostics.push({ slot: slot.slot, pinnedPieceId: id, pinIndex, reason,
            ...(ownerSlot !== undefined ? { ownerSlot } : {}) }); }
          if (piece) prefix.pieces.push({ ...piece });
        }
        if (invalid) refusedPrefixes.add(slot);
        else for (const piece of prefix.pieces) {
          reserved.set(piece.id, slot.slot);
          prefixOwnedPieces.add(prefixCatalog.get(piece.id)!);
          if (prefix.diversity) prefix.seeds.push(...(piece.tags[prefix.diversity.dimension] ?? []));
        }
        continue;
      }
      if (!slot.pinnedPieceId) continue;
      const p = live.find(piece => piece.id === slot.pinnedPieceId);
      const blocked = p ? (offLimits.has(slot) ? 'off_limits' : forbidden.get(slot)?.get(p)) : gates.get(slot)?.reason(undefined, slot.pinnedPieceId);
      if (blocked) { pinDiagnostics.push({ slot: slot.slot, pinnedPieceId: slot.pinnedPieceId, reason: blocked }); continue; }
      if (historicalPins === HISTORICAL_PINS) continue;
      const ownerSlot = reserved.get(slot.pinnedPieceId);
      const reason = slot.take !== 1 ? 'invalid_take' : !p ? 'missing_or_ineligible'
        : !p.slotTypes.includes(slot.slot) ? 'slot_type' : ownerSlot !== undefined ? 'duplicate_pin' : null;
      if (reason) {
        pinDiagnostics.push({ slot: slot.slot, pinnedPieceId: slot.pinnedPieceId, reason,
          ...(reason === 'duplicate_pin' ? { ownerSlot } : {}) });
      } else if (p) {
        reserved.set(p.id, slot.slot);
        resolvedPins.set(slot, p);
      }
    }
  }
  let order = 0;
  const ordered: string[] = [];

  for (const slot of slots) {
    if (offLimits.has(slot)) continue;
    const prefix = prefixes.get(slot);
    if (refusedPrefixes.has(slot)) continue;
    if (prefix) for (const p of prefix.pieces) {
      used.add(p.id);
      out.push({ contentId: p.id, customerContentId: p.customerContentId, type: p.type,
        slot: slot.slot, order: order++, score: 0, strategy: 'tenant-pinned',
        explain: { drivers: [], note: 'required pinned prefix position — ranking never ran for this piece' } });
    }
    // Non-personalizable: the tenant's piece, verbatim, and ranking never runs.
    if (!prefix && slot.pinnedPieceId) {
      const p = historicalPins === HISTORICAL_PINS
        ? live.find((x) => x.id === slot.pinnedPieceId) : resolvedPins.get(slot);
      if (p && !forbidden.get(slot)?.has(p)) {
        used.add(p.id);
        candidates[slot.slot] = [{ contentId: p.id, score: 0 }];
        out.push({ contentId: p.id, customerContentId: p.customerContentId, type: p.type,
          slot: slot.slot, order: order++, score: 0, strategy: 'tenant-pinned',
          explain: { drivers: [], note: 'non-personalizable slot — tenant config; ranking never ran' } });
      }
      continue;
    }
    const remaining = prefix ? prefix.take - prefix.ids.length : slot.take;
    if ((prefix && remaining <= 0) || (rankingSlots && !rankingSlots.has(slot.slot))) continue;
    const excluded = forbidden.get(slot);
    const eligible = live.filter((p) => p.slotTypes.includes(slot.slot) && !excluded?.has(p) && !used.has(p.id) && !reserved.has(p.id) && !prefixOwnedPieces.has(p));
    // P28 (decision D1): on a slot that opted into the layout blend, each
    // candidate's rank base R = (M − i) / M over a baseline of M modules, i
    // counted from 0 (so the first module's R is 1). The slot's own baseline is
    // the modules it could serve — after eligibility, its gates and what the page
    // already served or reserved — in catalogue order (`eligible` keeps it).
    const blended = slot.blend === true && adjust !== undefined;
    const rankBase = (pool: readonly ContentPieceLike[]) => new Map(pool.map((p, i) => [p.id, (pool.length - i) / pool.length] as const));
    const catalogueBase = blended ? rankBase(eligible) : null;
    const view = slot.affinity ?? affinity;
    const scoreOf = (p: ContentPieceLike, R?: number) => {
      // Capture values now: prefer/adjust/explore may mutate the source inputs.
      // Only served candidates need driver objects and their presentation order.
      const drivers: Array<string | number> = [];
      let score = 0;
      for (const [dim, values] of Object.entries(p.tags)) {
        const w = slot.weights[dim] ?? 0; if (!w) continue;
        for (const v of values) {
          const a = view.dims[dim]?.[v] ?? 0; if (a <= 0) continue;
          score += a * w; drivers.push(dim, v, a, w);
        }
      }
      if (slot.prefer?.test(p)) {
        score += slot.prefer.bonus;
        drivers.push('completes', slot.prefer.label, 1, slot.prefer.bonus);
      }
      // The blend's score is taken whatever its sign: a learned lift below 1 subtracts.
      if (adjust) { const adjusted = R === undefined ? adjust(p, slot.slot, score) : adjust(p, slot.slot, score, { R }); if (Number.isFinite(adjusted) && (adjusted >= 0 || R !== undefined)) score = adjusted; }
      return { p, score, drivers };
    };
    const scored = eligible.map((p) => scoreOf(p, catalogueBase?.get(p.id)))
      .sort((x, y) => y.score - x.score || (rank.get(x.p.id) ?? 0) - (rank.get(y.p.id) ?? 0) || x.p.id.localeCompare(y.p.id));

    // W28.C1.01(b) (F23 §4.2): where an exploration moved ONE piece to the front,
    // the support the ledger records is the top candidates BY SCORE — taken
    // before that move, so the third-highest scored piece is no longer pushed
    // out of the record by the reorder — with the piece the exploration named
    // kept beside them, first, because it is what was served. Record only: the
    // served ranking is untouched, and a slot with no exploration pick, or one
    // whose whole ranking was replaced, records exactly what it recorded before.
    let byScore: typeof scored | null = null;
    let promoted: string | null = null;
    let picked = false;
    if (explore && scored.length > 1) {
      const pick = explore(slot.slot, scored.map((s) => ({ id: s.p.id, score: s.score })));
      picked = Boolean(pick);
      if (pick?.ranking) {
        const order = new Map(pick.ranking.map((id, i) => [id, i]));
        scored.sort((x, y) => (order.get(x.p.id) ?? 1e9) - (order.get(y.p.id) ?? 1e9));
      } else if (pick?.first) {
        const i = scored.findIndex((s) => s.p.id === pick.first);
        if (i > 0) { byScore = scored.slice(); promoted = pick.first; scored.unshift(...scored.splice(i, 1)); }
      }
    }

    const limit = Math.max(0, candidateLimit);
    const support = limit > 0 && byScore && promoted !== null
      ? [scored[0]!, ...byScore.slice(0, limit).filter((s) => s.p.id !== promoted)]
      : scored.slice(0, limit);
    candidates[slot.slot] = support.map((s) => ({ contentId: s.p.id, score: round3(s.score) }));

    // The take. With a diversity rule (CW33), a piece that would put a value of the dimension over
    // `max` yields to the next ranked piece and is named on that piece's explain; if the rule leaves
    // positions empty, the yielded pieces fill them in rank order, marked relaxed, because a hole in
    // a rail is worse than a repeated line.
    const diversity = prefix ? prefix.diversity : slot.diversity;
    const rule = diversity && diversity.max >= 1 && diversity.dimension ? diversity : null;
    const seen = new Map<string, number>();
    if (prefix && rule) for (const value of prefix.seeds) seen.set(value, (seen.get(value) ?? 0) + 1);
    const yielded: typeof scored = [];
    let pendingSkips: string[] = [];
    const serve = (s: (typeof scored)[number], diversity?: ContentDecision['explain']['diversity'], note?: string) => {
      const drivers: ContentDecision['explain']['drivers'] = [];
      for (let i = 0; i < s.drivers.length; i += 4) {
        drivers.push({ dim: s.drivers[i] as string, value: s.drivers[i + 1] as string,
          a: s.drivers[i + 2] as number, weight: s.drivers[i + 3] as number });
      }
      drivers.sort((x, y) => y.a * y.weight - x.a * x.weight);
      const cold = s.score <= 0;
      used.add(s.p.id);
      out.push({ contentId: s.p.id, customerContentId: s.p.customerContentId, type: s.p.type,
        slot: slot.slot, order: order++, score: round3(s.score),
        strategy: cold ? 'default' : 'affinity',
        explain: { drivers: drivers.slice(0, 4), ...(note ? { note } : cold ? { note: 'no signal yet — the slot default (catalogue order)' } : {}), ...(diversity ? { diversity } : {}) } });
    };
    // P01: the configured order, when the caller resolved one and exploration
    // picked nothing on this decision. Exactly its modules, in its order, up to
    // the slot's capacity after the pinned prefix; a listed module the slot could
    // not serve (ineligible now, refused by a gate, served or reserved elsewhere
    // on the page, or one of this slot's own pins) is passed over, never
    // replaced, and an unlisted module is never served here.
    if (slot.order && !picked) {
      const capacity = prefix ? remaining : slot.take;
      if (blended) {
        // P28 (R-P41): on a slot that opted into the blend, the order supplies
        // the rank base — the listed modules the slot could serve, in the
        // order's sequence (M of them, i from 0; one passed over is no member)
        // — and the blend ranks exactly those modules. An unlisted module never
        // enters the pool, so it stays hidden; diversity does not apply.
        const pool = new Map(eligible.map((p) => [p.id, p] as const));
        const listed: ContentPieceLike[] = [], seen = new Set<string>();
        for (const id of slot.order) {
          const p = pool.get(id);
          if (p && !used.has(p.id) && !seen.has(p.id)) { seen.add(p.id); listed.push(p); }
        }
        const base = rankBase(listed), at = new Map(listed.map((p, i) => [p.id, i] as const));
        const ranked = listed.map((p) => scoreOf(p, base.get(p.id))).sort((x, y) => y.score - x.score || at.get(x.p.id)! - at.get(y.p.id)!);
        candidates[slot.slot] = ranked.slice(0, limit).map((s) => ({ contentId: s.p.id, score: round3(s.score) }));
        for (const s of ranked.slice(0, capacity)) serve(s, undefined, BLENDED_ORDER_NOTE);
      } else {
        const byId = new Map(scored.map((s) => [s.p.id, s] as const));
        let served = 0;
        for (const id of slot.order) {
          if (served >= capacity) break;
          const s = byId.get(id);
          if (!s || used.has(s.p.id)) continue;
          serve(s, undefined, CONFIGURED_ORDER_NOTE);
          served += 1;
        }
      }
      ordered.push(slot.slot);
      continue;
    }
    const takeNote = blended ? BLENDED_NOTE : undefined;
    let taken = 0;
    for (const s of scored) {
      if (taken >= (prefix ? remaining : slot.take)) break;
      if (rule) {
        const values = s.p.tags[rule.dimension] ?? [];
        if (values.some((v) => (seen.get(v) ?? 0) >= rule.max)) { yielded.push(s); pendingSkips.push(s.p.id); continue; }
        for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
      }
      const skipped = pendingSkips; pendingSkips = [];
      serve(s, rule && skipped.length ? { dimension: rule.dimension, max: rule.max, skipped, relaxed: false, sentence: `${skipped.join(', ')} yielded: at most ${rule.max} per ${rule.dimension} in this slot` } : undefined, takeNote);
      taken += 1;
    }
    for (const s of yielded) {
      if (taken >= (prefix ? remaining : slot.take)) break;
      serve(s, { dimension: rule!.dimension, max: rule!.max, skipped: [], relaxed: true, sentence: `served over the limit of ${rule!.max} per ${rule!.dimension}: nothing else was eligible` }, takeNote);
      taken += 1;
    }
  }
  return { decisions: out, candidates, ...(pinDiagnostics.length ? { pinDiagnostics } : {}), ...(ordered.length ? { ordered } : {}) };
}

/** The delivery contract alone: one decision per slot position, in page order. */
export function composeContent(
  pieces: readonly ContentPieceLike[],
  affinity: AffinityViewLike,
  slots: readonly ContentSlotSpec[],
): ContentDecision[] {
  return composeContentDetailed(pieces, affinity, slots).decisions;
}
