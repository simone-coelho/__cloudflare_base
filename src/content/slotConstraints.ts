import { contentTypeValues } from './typeAffinity';

/** Exact configured pin order; callers snapshot when crossing caller-hook boundaries. */
export function slotPins(slot: { pinnedPieceId?: string; pinnedPieceIds?: readonly string[] }): readonly string[] {
  return slot.pinnedPieceIds ?? (slot.pinnedPieceId ? [slot.pinnedPieceId] : []);
}
export function rankedCapacity(slot: { take: number; pinnedPieceId?: string; pinnedPieceIds?: readonly string[]; offLimits?: boolean }): number {
  return slot.offLimits || slot.pinnedPieceId ? 0 : Math.max(0, slot.take - slotPins(slot).length);
}

export interface SlotConstraints {
  offLimits?: boolean;
  excludedPieceIds?: readonly string[];
  excludedTags?: ReadonlyArray<{ dimension: string; value: string }>;
  allowedTypes?: readonly string[];
}
interface ConstraintPiece { id: string; type: string; tags: Readonly<Record<string, readonly string[]>> }
export type SlotConstraintReason = 'off_limits' | 'excluded' | 'type_not_allowed' | 'excluded_tag';
/**
 * The refusal itself: the existing reason word, and — for a refusal by a
 * published `{dimension, value}` pair — the exact pair that matched, so an
 * advisory channel can name the rule rather than leave a merchandiser to guess
 * which of up to 1000 pairs applied. Nothing here is serving authority.
 */
export interface SlotConstraintRefusal { reason: SlotConstraintReason; dimension?: string; value?: string }

/** Pure, exact constraints; no registry, scoring view, or customer vocabulary.
 * Compile once per slot. Callers snapshot results before running mutable hooks. */
export function compileSlotConstraints(slot: SlotConstraints, extended = true) {
  const offLimits = slot.offLimits === true;
  const ids = new Set(slot.excludedPieceIds);
  const types = extended && slot.allowedTypes !== undefined ? new Set(slot.allowedTypes) : null;
  const tags = new Map<string, Set<string>>();
  if (extended) for (const pair of slot.excludedTags ?? []) {
    let values = tags.get(pair.dimension);
    if (!values) { values = new Set(); tags.set(pair.dimension, values); }
    values.add(pair.value);
  }
  /** The single decision path; `reason` is its word and `refusal` its detail. */
  const refuse = (piece?: ConstraintPiece, id = piece?.id): SlotConstraintRefusal | null => {
    if (offLimits) return { reason: 'off_limits' };
    if (id !== undefined && ids.has(id)) return { reason: 'excluded' };
    if (!piece) return null;
    if (types && !types.has(piece.type)) return { reason: 'type_not_allowed' };
    // Work follows the piece's actual tags, not a possibly 1000-pair rule.
    for (const dimension in piece.tags) {
      if (!Object.hasOwn(piece.tags, dimension)) continue;
      const values = tags.get(dimension), held = piece.tags[dimension];
      // Explicit own arrays are literal, even when not safe learning inputs.
      if (!values || !Array.isArray(held)) continue;
      const matched = held.find(value => values.has(value));
      if (matched !== undefined) return { reason: 'excluded_tag', dimension, value: matched };
    }
    // Only an absent contentType key gets the same safe fallback on all arms.
    const formats = tags.get('contentType');
    if (formats && !Object.hasOwn(piece.tags, 'contentType')) {
      const matched = contentTypeValues(piece)?.find(value => formats.has(value));
      if (matched !== undefined) return { reason: 'excluded_tag', dimension: 'contentType', value: matched };
    }
    return null;
  };
  return {
    offLimits,
    active: offLimits || ids.size > 0 || types !== null || tags.size > 0,
    reason(piece?: ConstraintPiece, id = piece?.id): SlotConstraintReason | null {
      return refuse(piece, id)?.reason ?? null;
    },
    /** The same decision, with the published pair that made it when there is one. */
    refusal: refuse,
  };
}
