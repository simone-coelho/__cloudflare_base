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
  return {
    offLimits,
    active: offLimits || ids.size > 0 || types !== null || tags.size > 0,
    reason(piece?: ConstraintPiece, id = piece?.id): SlotConstraintReason | null {
      if (offLimits) return 'off_limits';
      if (id !== undefined && ids.has(id)) return 'excluded';
      if (!piece) return null;
      if (types && !types.has(piece.type)) return 'type_not_allowed';
      // Work follows the piece's actual tags, not a possibly 1000-pair rule.
      for (const dimension in piece.tags) {
        if (!Object.hasOwn(piece.tags, dimension)) continue;
        const values = tags.get(dimension), held = piece.tags[dimension];
        // Explicit own arrays are literal, even when not safe learning inputs.
        if (values && Array.isArray(held) && held.some(value => values.has(value))) return 'excluded_tag';
      }
      // Only an absent contentType key gets the same safe fallback on all arms.
      const formats = tags.get('contentType');
      if (formats && !Object.hasOwn(piece.tags, 'contentType') && contentTypeValues(piece)?.some(value => formats.has(value))) return 'excluded_tag';
      return null;
    },
  };
}
