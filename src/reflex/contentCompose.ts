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
  /**
   * P30: modules THIS slot does not consider on this decision although the page
   * admits them — on a context-only layout slot, a module whose eligibility rule
   * the slot's context does not satisfy (src/content/decide.ts). Each is treated
   * as ineligible for this slot alone: not pooled, ranked or held, and a pin of
   * one is refused as missing or ineligible. Every other slot is untouched.
   * Absent or empty, the slot decides exactly as before.
   */
  withheld?: ReadonlySet<string>;
  /**
   * P04: modules pinned at a position of this slot, counted from 1 to `take`
   * after any prefix pins. Each is reserved page-wide before any slot ranks,
   * with the prefix pins, and served at exactly its position, never scored or
   * explored; the other positions are ranked around it. One pin that is missing,
   * ineligible, refused by a gate or owned by an earlier slot refuses the whole
   * slot, prefix included (decision D1), and the pin diagnostic names its
   * position. Applied under the current pin policy only.
   */
  positionPins?: ReadonlyArray<{ pieceId: string; position: number }>;
  /**
   * P04: modules marked off-limits in this slot. Each holds its BASELINE
   * position — its place, counted from 1, among the modules the slot could
   * serve (its own pins included) in the order the caller resolved (`order`),
   * else in catalogue order — and is never scored, explored or moved by any
   * term, while the others are ranked around it. One whose baseline position
   * lies beyond the take or on a pinned position is not served by this slot,
   * and one the slot could not serve holds nothing. Applied under the current
   * pin policy only.
   */
  offLimitsPieceIds?: readonly string[];
  /**
   * P15 (decision D1): position bands. Each band covers the positions `from` to
   * `to` of this slot, counted from 1, and its `weights` replace the slot's
   * `weights` for those positions. Positions are filled in order: a fixed
   * position (a prefix pin, a position pin, a held off-limits module) stays its
   * rule's, and every other position is filled from the candidates still
   * eligible (after the slot's exclusions, eligibility, the page's reservations
   * and every module already served on the page) ranked with the weights of the
   * band that covers it, `adjust` handed the band so that every other term is
   * computed as without it. That BANDED RANKING is the slot's ranking:
   * exploration and diversity act on it and never re-rank it, and a configured
   * `order` served exactly is ranked without the bands. Read only when the bands
   * are contiguous over positions 1 to `take`; absent (or malformed), the slot
   * decides exactly as before.
   */
  bands?: ReadonlyArray<SlotBand>;
  /**
   * P26 (decision D1): the inner content slots of this slot, `{ [moduleId]:
   * slotName }`, set by the caller on a page's declared layout slot alone. Each
   * named slot of the page is decided directly after this one, in the order
   * this slot served its modules and only for the modules it returned; one
   * whose module it did not return is not decided. Absent, the page is decided
   * in document order exactly as before.
   */
  inner?: Readonly<Record<string, string>>;
}

/** P15: a position band as the composer ranks with it: the positions it covers, counted from 1, and its weights. */
export interface SlotBand { from: number; to: number; weights: Readonly<Record<string, number>> }

/** P15: a module the composer ranked in a band of its slot, and the positions that band covers. */
export interface BandPlacement { slot: string; contentId: string; from: number; to: number }

/**
 * P15: a slot's bands when they are well formed — listed from position 1, each
 * starting where the one before it ends, the last ending at the take — else
 * null, so a slot whose bands could not be published decides exactly as one
 * without them.
 */
function wellFormedBands(slot: ContentSlotSpec): readonly SlotBand[] | null {
  const bands = slot.bands;
  if (!Array.isArray(bands) || bands.length === 0) return null;
  let next = 1;
  for (const band of bands) {
    if (!band || typeof band.weights !== 'object' || band.weights === null || !Number.isSafeInteger(band.from) || band.from !== next
      || !Number.isSafeInteger(band.to) || band.to < band.from) return null;
    next = band.to + 1;
  }
  return next === slot.take + 1 ? bands : null;
}

/** P15: the positions a ranking fills, grouped into runs of consecutive positions that one band covers. */
function bandRunsOf(bands: readonly SlotBand[], positions: readonly number[]): Array<{ band: SlotBand; count: number }> {
  const runs: Array<{ band: SlotBand; count: number }> = [];
  for (const position of positions) {
    const band = bands.find((b) => b.from <= position && position <= b.to);
    if (!band) continue;
    const last = runs[runs.length - 1];
    if (last && last.band === band) last.count += 1; else runs.push({ band, count: 1 });
  }
  return runs;
}

/**
 * P15: the banded ranking of a pool. Run by run, in position order, the
 * modules still in the pool are ranked with the run's band and the first of
 * them fill its positions; what is left after the last run follows in that
 * run's order. Each module is scored only in the runs it was still in the pool
 * for, so a ranked module's last scoring is the band it was ranked in.
 */
function rankBanded<S extends { p: ContentPieceLike }>(pool: readonly ContentPieceLike[], runs: ReadonlyArray<{ band: SlotBand; count: number }>,
  score: (p: ContentPieceLike, band: SlotBand) => S, order: (x: S, y: S) => number): S[] {
  const out: S[] = [];
  let left = [...pool], tail: S[] = [];
  for (const run of runs) {
    if (!left.length) break;
    const ranked = left.map((p) => score(p, run.band)).sort(order);
    const taken = ranked.slice(0, run.count);
    out.push(...taken);
    tail = ranked.slice(run.count);
    const ids = new Set(taken.map((s) => s.p.id));
    left = left.filter((p) => !ids.has(p.id));
  }
  return [...out, ...tail];
}

/** P04: what a module pinned at a position says on its explain. */
export const positionPinNote = (position: number) => `pinned at position ${position} — the merchandiser’s module at exactly this position; ranking and exploration never ran for this piece`;
/** P04: what an off-limits module held at its baseline position says on its explain. */
export const offLimitsNote = (position: number) => `off-limits module held at its baseline position ${position} — no term and no exploration moved it; ranking never ran for this piece`;

/** P04: a module a position pin or an off-limits mark placed, with the rule and the position it set, counted from 1. */
export interface ModulePlacement {
  slot: string;
  contentId: string;
  rule: 'pinned' | 'off_limits';
  position: number;
  /** For `off_limits`: whether the baseline was the slot's `order` or its catalogue order. */
  baseline?: 'order' | 'catalogue';
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
  /**
   * P26 (decision D1): this decision is of an inner content slot — the slot
   * whose `inner` names it (the page's declared layout slot) and the module
   * whose content it is, keys sorted. Absent on every other decision.
   */
  within?: { module: string; slot: string };
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
  /**
   * Why the pin served nothing. P43 (R-P78): `module_not_returned` is the one
   * reason that refuses nothing — the pin of an inner content slot whose module
   * the layout did not return stayed reserved page-wide, so its piece is served
   * nowhere on that page view.
   */
  reason: 'invalid_take' | 'missing_or_ineligible' | 'slot_type' | 'duplicate_pin' | 'module_not_returned' | SlotConstraintReason;
  ownerSlot?: string;
  pinIndex?: number;
  /** P04: the refused position pin's position, counted from 1; absent on prefix and scalar pins. */
  position?: number;
  /** P43: on a `module_not_returned` entry alone, the module whose inner slot it is and the layout slot that did not return it. */
  within?: { module: string; slot: string };
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
  /** P04: the modules a position pin or an off-limits mark placed, in page order. Absent when none did. */
  moduleRules?: ModulePlacement[];
  /**
   * P04: the slots on which a position pin or an off-limits mark decided
   * something — a pin placed or refused, or a marked module the slot could have
   * ranked held or withheld — in page order. Absent when none did.
   */
  ruled?: string[];
  /** P04: the slots whose `order` supplied the baseline of an off-limits mark that decided something, in page order. */
  orderBaseline?: string[];
  /** P15: each served module a band of its slot ranked, with the positions that band covers. Absent when no band ranked one. */
  bands?: BandPlacement[];
  /**
   * P26: the inner content slots that were not decided because the layout did
   * not return their module, in page order. Absent when every one was decided,
   * and on a page without inner content slots.
   */
  undecided?: string[];
  /**
   * P43 (R-P78): for each pin an undecided inner content slot reserved, an
   * entry naming the inner slot, the piece, the module and the layout slot
   * (`within`), reason `module_not_returned`, keys sorted, in page order. The
   * pin stayed reserved, so the piece is served nowhere on that page view. Kept
   * apart from `pinDiagnostics`, whose entries are refusals; absent when there
   * is none, and on a page without inner content slots.
   */
  unreturnedPins?: PinDiagnostic[];
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
 * rank base `R`, and the returned score is the blend's. On a slot with position
 * bands (P15) it also hands the band the candidate is being ranked in, whose
 * weights replace the slot's wherever the adjustment reads them.
 */
export type ScoreAdjust = (piece: ContentPieceLike, slot: string, baseScore: number, rank?: { R: number }, band?: SlotBand) => number;

/**
 * An optional exploration hook, given the slot's ranked candidates after
 * scoring and before the take. It may name one piece to serve first, or hand
 * back a whole ranking. Returning null serves the ranking as scored.
 */
export type ExploreHook = (slot: string, ranked: ReadonlyArray<{ id: string; score: number }>) => { first?: string; ranking?: readonly string[] } | null;

/**
 * P05 (moved here by P26): an optional word from the caller on each slot once
 * it has served and before any slot after it is decided: the decisions it
 * served, in position order, and whether it served its configured `order`. It
 * may name two positions, counted from 1 within the slot, whose modules then
 * exchange places (the adjacent swap), so every slot decided after it — the
 * inner content slots of a declared layout among them — reads the order the
 * slot really served. Null leaves the slot exactly as served.
 */
export type SettleHook = (slot: string, served: readonly ContentDecision[], servedOrder: boolean) => readonly [number, number] | null;

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
  /** P05 with P26: the caller's word on each slot once it has served, before any slot after it is decided. */
  settle?: SettleHook,
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
  // The slots a pin refused whole: a prefix pin, or (P04) a position pin.
  const refusedPrefixes = new Set<ContentSlotSpec>();
  const prefixOwnedPieces = new Set<ContentPieceLike>();
  const prefixCatalog = new Map<string, ContentPieceLike>();
  // P04: a slot's position pins, under the current pin policy only; the valid
  // ones of a slot that was not refused, by position; and the slots on which a
  // position pin or an off-limits mark decided something.
  const positionPinsOf = (slot: ContentSlotSpec) => (!historicalPins && slot.positionPins?.length ? slot.positionPins : null);
  const positioned = new Map<ContentSlotSpec, Map<number, ContentPieceLike>>();
  const ruled = new Set<ContentSlotSpec>();
  if (prefixes.size || slots.some(positionPinsOf)) for (const piece of live) if (!prefixCatalog.has(piece.id)) prefixCatalog.set(piece.id, piece);
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
      const pins = positionPinsOf(slot);
      if (prefix || pins) {
        let invalid = false;
        if (prefix) {
          const malformed = Boolean(slot.pinnedPieceId) || prefix.ids.length > 50 || prefix.ids.length > prefix.take
            || new Set(prefix.ids).size !== prefix.ids.length || prefix.ids.some(id => typeof id !== 'string' || !id.length);
          invalid = malformed;
          for (const [pinIndex, id] of prefix.ids.entries()) {
            const piece = slot.withheld?.has(id) ? undefined : prefixCatalog.get(id), ownerSlot = reserved.get(id);
            const blocked = piece ? (offLimits.has(slot) ? 'off_limits' : forbidden.get(slot)?.get(piece)) : gates.get(slot)?.reason(undefined, id);
            const reason = blocked ?? (malformed ? 'invalid_take' : !piece ? 'missing_or_ineligible'
              : !piece.slotTypes.includes(slot.slot) ? 'slot_type' : ownerSlot !== undefined ? 'duplicate_pin' : null);
            if (reason) { invalid = true; pinDiagnostics.push({ slot: slot.slot, pinnedPieceId: id, pinIndex, reason,
              ...(ownerSlot !== undefined ? { ownerSlot } : {}) }); }
            if (piece) prefix.pieces.push({ ...piece });
          }
        }
        // P04 (decision D1): every position pin passes eligibility, the slot's
        // gates and page ownership, exactly as a prefix pin does, before any pin
        // of the slot is reserved. One that fails refuses the whole slot — its
        // prefix too — and is named with its position; nothing is shifted and
        // nothing is ranked in its place. A position must lie after the prefix
        // and within the take, and a position or a module is pinned once.
        const placed = new Map<number, ContentPieceLike>();
        if (pins) {
          const lowest = (prefix?.ids.length ?? 0) + 1, prefixIds = new Set(prefix?.ids ?? []);
          const positions = new Set<number>(), ids = new Set<string>();
          let malformed = Boolean(slot.pinnedPieceId) || pins.length > 50 || pins.length > slot.take;
          for (const pin of pins) {
            const id = pin?.pieceId, position = pin?.position;
            if (typeof id !== 'string' || !id.length || typeof position !== 'number' || !Number.isSafeInteger(position) || position < lowest
              || position > slot.take || positions.has(position) || ids.has(id) || prefixIds.has(id)) malformed = true;
            positions.add(position); ids.add(id);
          }
          let refusedPin = false;
          for (const pin of pins) {
            const id = pin.pieceId, piece = slot.withheld?.has(id) ? undefined : prefixCatalog.get(id), ownerSlot = reserved.get(id);
            const blocked = piece ? (offLimits.has(slot) ? 'off_limits' : forbidden.get(slot)?.get(piece)) : gates.get(slot)?.reason(undefined, id);
            const reason = blocked ?? (malformed ? 'invalid_take' : !piece ? 'missing_or_ineligible'
              : !piece.slotTypes.includes(slot.slot) ? 'slot_type' : ownerSlot !== undefined ? 'duplicate_pin' : null);
            if (reason) {
              invalid = true; refusedPin = true;
              pinDiagnostics.push({ slot: slot.slot, pinnedPieceId: id, position: pin.position, reason, ...(ownerSlot !== undefined ? { ownerSlot } : {}) });
            } else placed.set(pin.position, { ...piece! });
          }
          // An off-limits slot serves nothing whatever its pins say, so its dormant pins decide nothing.
          if (refusedPin && !offLimits.has(slot)) ruled.add(slot);
        }
        if (invalid) refusedPrefixes.add(slot);
        else {
          if (prefix) for (const piece of prefix.pieces) {
            reserved.set(piece.id, slot.slot);
            prefixOwnedPieces.add(prefixCatalog.get(piece.id)!);
            if (prefix.diversity) prefix.seeds.push(...(piece.tags[prefix.diversity.dimension] ?? []));
          }
          for (const piece of placed.values()) {
            reserved.set(piece.id, slot.slot);
            prefixOwnedPieces.add(prefixCatalog.get(piece.id)!);
          }
          if (placed.size) positioned.set(slot, placed);
        }
        continue;
      }
      if (!slot.pinnedPieceId) continue;
      const p = slot.withheld?.has(slot.pinnedPieceId) ? undefined : live.find(piece => piece.id === slot.pinnedPieceId);
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
  // P04: what the slots' position pins and off-limits marks placed, and the slots whose order supplied a mark's baseline.
  const placements: ModulePlacement[] = [];
  const orderBaseline = new Set<ContentSlotSpec>();
  // P15: the served modules a band ranked, with the positions their band covers.
  const bandPlacements: BandPlacement[] = [];

  /** One slot of the page, decided: what it serves is added to `out` in its position order. */
  const decideSlot = (slot: ContentSlotSpec): void => {
    if (offLimits.has(slot)) return;
    const prefix = prefixes.get(slot);
    if (refusedPrefixes.has(slot)) return;
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
      return;
    }
    const remaining = prefix ? prefix.take - prefix.ids.length : slot.take;
    if ((prefix && remaining <= 0) || (rankingSlots && !rankingSlots.has(slot.slot))) return;
    const excluded = forbidden.get(slot);
    const eligible = live.filter((p) => p.slotTypes.includes(slot.slot) && !excluded?.has(p) && !slot.withheld?.has(p.id) && !used.has(p.id) && !reserved.has(p.id) && !prefixOwnedPieces.has(p));
    // P04: the slot's own fixed positions — its modules pinned at a position
    // (reserved above), and its off-limits modules, each held at its BASELINE
    // position: its place, counted from 1, among the modules the slot could
    // serve (its own pins included, what other slots served or reserved
    // excluded) in the order the caller resolved for this decision, else in
    // catalogue order. A held module is never ranked; one whose baseline
    // position lies beyond the take or on a pinned position is not served here,
    // and one the slot could not serve holds nothing. A slot with neither rule
    // decides exactly as before.
    const pinsAt = positioned.get(slot) ?? new Map<number, ContentPieceLike>();
    const marks = !historicalPins && slot.offLimitsPieceIds?.length ? new Set(slot.offLimitsPieceIds) : null;
    const fixedSlot = pinsAt.size > 0 || marks !== null;
    const prefixLength = prefix ? prefix.ids.length : 0;
    const held = new Map<number, ContentPieceLike>();
    let marksDecided = false;
    if (marks) {
      const own = new Set([...(prefix?.ids ?? []), ...[...pinsAt.values()].map((p) => p.id)]);
      const servable = new Map<string, ContentPieceLike>();
      for (const p of live) {
        if (servable.has(p.id) || !p.slotTypes.includes(slot.slot) || excluded?.has(p) || slot.withheld?.has(p.id)) continue;
        if (own.has(p.id) || (!used.has(p.id) && !reserved.has(p.id) && !prefixOwnedPieces.has(p))) servable.set(p.id, p);
      }
      const baseline = slot.order ? [...new Set(slot.order)].filter((id) => servable.has(id)) : [...servable.keys()];
      for (const id of new Set(slot.offLimitsPieceIds)) {
        // A pinned module is placed by its pin; publication refuses a module both pinned and off-limits.
        if (own.has(id)) continue;
        const position = baseline.indexOf(id) + 1;
        if (position < 1 || position > slot.take || position <= prefixLength || pinsAt.has(position)) continue;
        held.set(position, servable.get(id)!);
      }
      // A mark decides something only for a module this slot could have ranked.
      marksDecided = eligible.some((p) => marks.has(p.id));
    }
    // The ranking pool: what the slot could serve, its off-limits modules removed.
    const rankable = marks ? eligible.filter((p) => !marks.has(p.id)) : eligible;
    // The positions ranking fills: the take less the prefix, the position pins and the held modules.
    const free = fixedSlot ? Math.max(0, slot.take - prefixLength - pinsAt.size - held.size) : prefix ? remaining : slot.take;
    // P28 (decision D1): on a slot that opted into the layout blend, each
    // candidate's rank base R = (M − i) / M over a baseline of M modules, i
    // counted from 0 (so the first module's R is 1). The slot's own baseline is
    // the modules it could serve — after eligibility, its gates and what the page
    // already served or reserved — in catalogue order (`eligible` keeps it).
    const blended = slot.blend === true && adjust !== undefined;
    const rankBase = (pool: readonly ContentPieceLike[]) => new Map(pool.map((p, i) => [p.id, (pool.length - i) / pool.length] as const));
    const catalogueBase = blended ? rankBase(eligible) : null;
    const view = slot.affinity ?? affinity;
    // P15: on a position band, the band's weights in place of the slot's; absent, the slot's own, exactly as before.
    const scoreOf = (p: ContentPieceLike, R?: number, band?: SlotBand) => {
      // Capture values now: prefer/adjust/explore may mutate the source inputs.
      // Only served candidates need driver objects and their presentation order.
      const drivers: Array<string | number> = [];
      const weights = band ? band.weights : slot.weights;
      let score = 0;
      for (const [dim, values] of Object.entries(p.tags)) {
        const w = weights[dim] ?? 0; if (!w) continue;
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
      if (adjust) {
        const adjusted = band ? adjust(p, slot.slot, score, R === undefined ? undefined : { R }, band)
          : R === undefined ? adjust(p, slot.slot, score) : adjust(p, slot.slot, score, { R });
        if (Number.isFinite(adjusted) && (adjusted >= 0 || R !== undefined)) score = adjusted;
      }
      return { p, score, drivers, band };
    };
    const byScoreThenCatalogue = (x: { p: ContentPieceLike; score: number }, y: { p: ContentPieceLike; score: number }) =>
      y.score - x.score || (rank.get(x.p.id) ?? 0) - (rank.get(y.p.id) ?? 0) || x.p.id.localeCompare(y.p.id);
    const rankUnbanded = () => rankable.map((p) => scoreOf(p, catalogueBase?.get(p.id))).sort(byScoreThenCatalogue);
    // P15 (decision D1): the positions the ranking fills — the take after the
    // prefix, less the positions a pin or a held module fixes — each ranked with
    // the band that covers it. A configured order served exactly is ranked
    // without its bands (R-P34), so they rank it only where exploration could
    // pick instead and the slot would then serve its own, banded, decision.
    const fillPositions: number[] = [];
    for (let position = prefixLength + 1; position <= slot.take && fillPositions.length < free; position++) {
      if (!pinsAt.has(position) && !held.has(position)) fillPositions.push(position);
    }
    const bands = wellFormedBands(slot);
    const exactOrder = Boolean(slot.order) && !blended;
    const explorable = Boolean(explore) && rankable.length > 1 && (!fixedSlot || free > 0);
    const runs = bands && fillPositions.length && (!exactOrder || explorable) ? bandRunsOf(bands, fillPositions) : null;
    let scored = runs?.length ? rankBanded(rankable, runs, (p, band) => scoreOf(p, catalogueBase?.get(p.id), band), byScoreThenCatalogue) : rankUnbanded();

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
    // P15 (R-P77): whether the pick moved a module. A draw that lands on the
    // ranking's own leader is an exploration (W28.C1.01(a)) but reorders nothing.
    let moved = false;
    // P04: exploration acts on the ranked positions only, so a slot whose every position is fixed does not explore.
    if (explore && scored.length > 1 && (!fixedSlot || free > 0)) {
      const pick = explore(slot.slot, scored.map((s) => ({ id: s.p.id, score: s.score })));
      picked = Boolean(pick);
      if (pick?.ranking) {
        const order = new Map(pick.ranking.map((id, i) => [id, i]));
        scored.sort((x, y) => (order.get(x.p.id) ?? 1e9) - (order.get(y.p.id) ?? 1e9));
        moved = true;
      } else if (pick?.first) {
        const i = scored.findIndex((s) => s.p.id === pick.first);
        if (i > 0) { byScore = scored.slice(); promoted = pick.first; scored.unshift(...scored.splice(i, 1)); moved = true; }
      }
    }
    // P15 (R-P34): exploration picked nothing, so the slot serves its configured
    // order exactly, and an order is ranked without the bands: the slot is scored
    // again as without them, last, so every score and term it records is that one.
    if (runs?.length && exactOrder && !picked) scored = rankUnbanded();

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
    // P04: the slot's fixed modules count toward the rule as its prefix pins do.
    if (fixedSlot && rule) for (const p of [...pinsAt.values(), ...held.values()]) for (const value of p.tags[rule.dimension] ?? []) seen.set(value, (seen.get(value) ?? 0) + 1);
    const yielded: typeof scored = [];
    let pendingSkips: string[] = [];
    // P04: on a slot with fixed positions the ranked decisions are collected
    // first and placed around the fixed ones below, so every decision of the
    // slot is numbered in position order; any other slot is served as before.
    const rankedOut: ContentDecision[] | null = fixedSlot ? [] : null;
    const serve = (s: (typeof scored)[number], diversity?: ContentDecision['explain']['diversity'], note?: string) => {
      const drivers: ContentDecision['explain']['drivers'] = [];
      for (let i = 0; i < s.drivers.length; i += 4) {
        drivers.push({ dim: s.drivers[i] as string, value: s.drivers[i + 1] as string,
          a: s.drivers[i + 2] as number, weight: s.drivers[i + 3] as number });
      }
      drivers.sort((x, y) => y.a * y.weight - x.a * x.weight);
      const cold = s.score <= 0;
      used.add(s.p.id);
      // P15: a module a band ranked, and the positions that band covers.
      if (s.band) bandPlacements.push({ slot: slot.slot, contentId: s.p.id, from: s.band.from, to: s.band.to });
      const decision: ContentDecision = { contentId: s.p.id, customerContentId: s.p.customerContentId, type: s.p.type,
        slot: slot.slot, order: rankedOut ? -1 : order++, score: round3(s.score),
        strategy: cold ? 'default' : 'affinity',
        explain: { drivers: drivers.slice(0, 4), ...(note ? { note } : cold ? { note: 'no signal yet — the slot default (catalogue order)' } : {}), ...(diversity ? { diversity } : {}) } };
      if (rankedOut) rankedOut.push(decision); else out.push(decision);
    };
    // P01: the configured order, when the caller resolved one and exploration
    // picked nothing on this decision. Exactly its modules, in its order, up to
    // the slot's capacity after the pinned prefix; a listed module the slot could
    // not serve (ineligible now, refused by a gate, served or reserved elsewhere
    // on the page, or one of this slot's own pins) is passed over, never
    // replaced, and an unlisted module is never served here.
    // P04: the capacity is the positions the slot's fixed modules leave free,
    // and an off-limits module is never served from the order: it holds its place.
    if (slot.order && !picked) {
      const capacity = free;
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
        const rankedPool = marks ? listed.filter((p) => !marks.has(p.id)) : listed;
        const byScoreThenOrder = (x: { p: ContentPieceLike; score: number }, y: { p: ContentPieceLike; score: number }) => y.score - x.score || at.get(x.p.id)! - at.get(y.p.id)!;
        // P15 (R-P34): the blend ranks the listed modules, so on a banded slot each band's positions rank them with its weights (B only).
        const ranked = runs?.length ? rankBanded(rankedPool, runs, (p, band) => scoreOf(p, base.get(p.id), band), byScoreThenOrder)
          : rankedPool.map((p) => scoreOf(p, base.get(p.id))).sort(byScoreThenOrder);
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
    } else if (rule && runs?.length && !moved) {
      // P15 (R-P76): the diversity rule on a slot with position bands, position
      // by position. Each run of positions one band covers ranks the modules
      // still eligible with that band's weights; each position takes the first
      // of them the rule admits, the ones over the limit before it yielding
      // (named on it), and when every module left is over the limit, the first
      // of them, relaxed. A module that yields stays eligible: the next run
      // ranks it again under its own band's weights. So with no exploration
      // pick, and with a draw on the ranking's own leader, which moves nothing
      // (R-P77; the leader keeps its explored mark). A decision whose
      // exploration pick moved a module keeps that order and the rule acts on
      // it as on any ranking (below): it is never re-ranked by the bands (R-P34).
      const takeNote = blended ? BLENDED_NOTE : undefined;
      let left = [...rankable];
      for (const run of runs) {
        if (!left.length) break;
        const ranked = left.map((p) => scoreOf(p, catalogueBase?.get(p.id), run.band)).sort(byScoreThenCatalogue);
        for (let filled = 0; filled < run.count && ranked.length; filled++) {
          const at = ranked.findIndex((c) => !(c.p.tags[rule.dimension] ?? []).some((v) => (seen.get(v) ?? 0) >= rule.max));
          const s = ranked.splice(Math.max(at, 0), 1)[0]!;
          const skipped = at > 0 ? ranked.slice(0, at).map((c) => c.p.id) : [];
          for (const v of s.p.tags[rule.dimension] ?? []) seen.set(v, (seen.get(v) ?? 0) + 1);
          serve(s, at < 0 ? { dimension: rule.dimension, max: rule.max, skipped: [], relaxed: true, sentence: `served over the limit of ${rule.max} per ${rule.dimension}: nothing else was eligible` }
            : skipped.length ? { dimension: rule.dimension, max: rule.max, skipped, relaxed: false, sentence: `${skipped.join(', ')} yielded: at most ${rule.max} per ${rule.dimension} in this slot` } : undefined, takeNote);
          left = left.filter((p) => p.id !== s.p.id);
        }
      }
    } else {
      const takeNote = blended ? BLENDED_NOTE : undefined;
      let taken = 0;
      for (const s of scored) {
        if (taken >= free) break;
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
        if (taken >= free) break;
        serve(s, { dimension: rule!.dimension, max: rule!.max, skipped: [], relaxed: true, sentence: `served over the limit of ${rule!.max} per ${rule!.dimension}: nothing else was eligible` }, takeNote);
        taken += 1;
      }
    }
    // P04: the slot's positions after its prefix, in order: a pinned module at
    // its position, an off-limits module at its baseline position, and the
    // ranked modules in rank order on every other position. A layout has no
    // holes, so when fewer modules could be ranked than the positions before a
    // fixed module, the fixed module follows the last one served; its record
    // names the position its rule set.
    if (rankedOut) {
      let next = 0;
      const place = (p: ContentPieceLike, rule: ModulePlacement['rule'], position: number) => {
        used.add(p.id);
        out.push({ contentId: p.id, customerContentId: p.customerContentId, type: p.type,
          slot: slot.slot, order: order++, score: 0, strategy: 'tenant-pinned',
          explain: { drivers: [], note: rule === 'pinned' ? positionPinNote(position) : offLimitsNote(position) } });
        placements.push({ slot: slot.slot, contentId: p.id, rule, position, ...(rule === 'off_limits' ? { baseline: slot.order ? 'order' as const : 'catalogue' as const } : {}) });
      };
      for (let position = prefixLength + 1; position <= slot.take; position++) {
        const pinnedHere = pinsAt.get(position), heldHere = held.get(position);
        if (pinnedHere) place(pinnedHere, 'pinned', position);
        else if (heldHere) place(heldHere, 'off_limits', position);
        else if (next < rankedOut.length) { const d = rankedOut[next++]!; d.order = order++; out.push(d); }
      }
      if (pinsAt.size || marksDecided) ruled.add(slot);
      if (marksDecided && slot.order) orderBaseline.add(slot);
    }
  };
  /**
   * P05 through `settle`: once a slot has served, and before any slot after it
   * is decided, the caller may exchange the modules of two of its positions
   * (the adjacent swap); the page-wide `order` of the two follows their place.
   */
  const settled = (slot: ContentSlotSpec, start: number, orderedBefore: number) => {
    if (!settle) return;
    const pair = settle(slot.slot, out.slice(start), ordered.length > orderedBefore);
    if (!pair) return;
    const upperAt = start + pair[0] - 1, lowerAt = start + pair[1] - 1;
    if (pair[0] < 1 || pair[1] < 1 || upperAt === lowerAt || upperAt >= out.length || lowerAt >= out.length) return;
    const upper = out[upperAt]!, lower = out[lowerAt]!;
    [upper.order, lower.order] = [lower.order, upper.order];
    out[upperAt] = lower; out[lowerAt] = upper;
  };
  // P26 (decision D1): the page's slots in document order, except that an inner
  // content slot is decided only directly after the slot whose `inner` names it
  // — in the order that slot SERVED its modules, after its pins, its off-limits
  // modules, the withholding and the adjacent swap (`settle`), never a ranking
  // nothing served — and only when its module was returned. One whose module
  // was not returned is not decided at all: it serves, ranks and records
  // nothing (its pins were reserved page-wide before any slot ranked, as every
  // pin is, and stay so). Each inner decision names its module (`within`).
  // `used` is the page's one de-duplication across all three kinds of slot.
  // A page without inner content slots is decided in document order exactly as before.
  const nesting = innerSlotsOf(slots);
  const innerOf = new Map<string, Map<string, ContentSlotSpec>>();
  for (const spec of slots) {
    const placed = nesting.get(spec.slot);
    if (!placed) continue;
    const byModule = innerOf.get(placed.layout) ?? new Map<string, ContentSlotSpec>();
    if (!byModule.has(placed.module)) byModule.set(placed.module, spec);
    innerOf.set(placed.layout, byModule);
  }
  const entered = new Set<ContentSlotSpec>();
  for (const slot of slots) {
    if (nesting.has(slot.slot)) continue;
    const start = out.length, orderedBefore = ordered.length;
    decideSlot(slot);
    settled(slot, start, orderedBefore);
    const byModule = innerOf.get(slot.slot);
    if (!byModule) continue;
    for (const module of out.slice(start).map((d) => d.contentId)) {
      const inner = byModule.get(module);
      if (!inner || entered.has(inner)) continue;
      entered.add(inner);
      const from = out.length, innerOrdered = ordered.length;
      decideSlot(inner);
      settled(inner, from, innerOrdered);
      for (const d of out.slice(from)) d.within = { module, slot: slot.slot };
    }
  }
  const undecided = nesting.size ? slots.filter((slot) => nesting.has(slot.slot) && !entered.has(slot)).map((slot) => slot.slot) : [];
  // P43 (R-P78): an undecided inner slot's pins were reserved page-wide before
  // any slot ranked and stay so; each piece it reserved is named, with the
  // module and the layout slot, so the operator learns why it is served nowhere.
  // Only what the slot itself reserved: a pin refused (off-limits, excluded,
  // ineligible, a duplicate) reserved nothing and has no such entry.
  const unreturnedPins: PinDiagnostic[] = [];
  if (undecided.length) for (const slot of slots) {
    const placed = nesting.get(slot.slot);
    if (!placed || entered.has(slot) || refusedPrefixes.has(slot)) continue;
    const entry = (pinnedPieceId: string, at: { pinIndex?: number; position?: number }): PinDiagnostic => ({
      ...(at.pinIndex !== undefined ? { pinIndex: at.pinIndex } : {}), pinnedPieceId, ...(at.position !== undefined ? { position: at.position } : {}),
      reason: 'module_not_returned', slot: slot.slot, within: { module: placed.module, slot: placed.layout } });
    const prefix = prefixes.get(slot);
    if (prefix) for (const [pinIndex, id] of prefix.ids.entries()) if (reserved.get(id) === slot.slot) unreturnedPins.push(entry(id, { pinIndex }));
    for (const [position, piece] of [...(positioned.get(slot) ?? [])].sort((a, b) => a[0] - b[0])) {
      if (reserved.get(piece.id) === slot.slot) unreturnedPins.push(entry(piece.id, { position }));
    }
    const pinned = resolvedPins.get(slot);
    if (pinned && reserved.get(pinned.id) === slot.slot) unreturnedPins.push(entry(pinned.id, {}));
  }
  const pageOrder = (set: ReadonlySet<ContentSlotSpec>) => slots.filter((slot) => set.has(slot)).map((slot) => slot.slot);
  return { decisions: out, candidates, ...(pinDiagnostics.length ? { pinDiagnostics } : {}), ...(ordered.length ? { ordered } : {}),
    ...(placements.length ? { moduleRules: placements } : {}), ...(ruled.size ? { ruled: pageOrder(ruled) } : {}),
    ...(orderBaseline.size ? { orderBaseline: pageOrder(orderBaseline) } : {}), ...(bandPlacements.length ? { bands: bandPlacements } : {}),
    ...(undecided.length ? { undecided } : {}), ...(unreturnedPins.length ? { unreturnedPins } : {}) };
}

/**
 * P26 (decision D1): the inner content slots of a page, by name: for each, the
 * slot whose `inner` names it and the module whose content it is. A name is
 * taken only where it is another slot of the page that names no inner content
 * slots itself, and once (the first module `inner` lists for it keeps it); any
 * other entry is passed over, so nothing publication refuses is ever nested.
 * The caller sets `inner` on a page's declared layout slot alone.
 */
export function innerSlotsOf(slots: ReadonlyArray<Pick<ContentSlotSpec, 'slot' | 'inner'>>): Map<string, { layout: string; module: string }> {
  const out = new Map<string, { layout: string; module: string }>();
  const carries = (s: Pick<ContentSlotSpec, 'inner'>) => s.inner !== null && typeof s.inner === 'object';
  if (!slots.some(carries)) return out;
  const names = new Set(slots.map((s) => s.slot)), carriers = new Set(slots.filter(carries).map((s) => s.slot));
  for (const s of slots) {
    if (!carries(s)) continue;
    for (const [module, name] of Object.entries(s.inner!)) {
      if (!module || typeof name !== 'string' || name === s.slot || !names.has(name) || carriers.has(name) || out.has(name)) continue;
      out.set(name, { layout: s.slot, module });
    }
  }
  return out;
}

/**
 * P26: the order a page's slots are decided in, as far as it is known before
 * anything is ranked: document order, a slot carrying inner content slots
 * followed directly by all of them (here in document order; the composer
 * decides them in the order that slot served its modules, and only those of
 * the modules it returned). A page without inner content slots: document order.
 */
export function compositionOrder(slots: ReadonlyArray<Pick<ContentSlotSpec, 'slot' | 'inner'>>): string[] {
  const nesting = innerSlotsOf(slots);
  if (!nesting.size) return slots.map((s) => s.slot);
  const order: string[] = [];
  for (const s of slots) {
    if (nesting.has(s.slot)) continue;
    order.push(s.slot);
    for (const t of slots) if (nesting.get(t.slot)?.layout === s.slot) order.push(t.slot);
  }
  return order;
}

/** The delivery contract alone: one decision per slot position, in page order. */
export function composeContent(
  pieces: readonly ContentPieceLike[],
  affinity: AffinityViewLike,
  slots: readonly ContentSlotSpec[],
): ContentDecision[] {
  return composeContentDetailed(pieces, affinity, slots).decisions;
}
