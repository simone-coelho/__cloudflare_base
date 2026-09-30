import type { Env } from '@/types/env';
import { readPublication } from '@/config/publication';
import { CONTENT_KIND } from './kinds';
import { isEligibleAt } from './lifecycle';
import type { PageConstraintDiagnostic, SlotCatalog } from './types';
import { compileSlotConstraints, slotPins, type SlotConstraintReason } from './slotConstraints';
import { slotDocumentConstraintDiagnostics } from './decide';

export interface SlotDiagnostics {
  schema: 'slot-pin-diagnostics/v1';
  advisory: true;
  status: 'available' | 'unavailable' | 'not_required';
  slotsRevision: number | null;
  catalog: { source: 'stored' | 'unavailable' | 'not_read'; revision: number | null };
  checkedAt: string | null;
  warningCount: number | null;
  omittedWarningCount: number | null;
  warnings: Array<{ pageIndex: number; slotIndex: number; pinIndex?: number; reason: 'missing_piece' | 'slot_type' | 'currently_ineligible' | SlotConstraintReason }> | null;
}

/** Optional HTTP feedback, never a cross-document activation or serving guard.
 * authorize must establish the exact slot document's canonical catalog tenant. */
export async function slotDiagnostics(env: Env, slots: SlotCatalog | null, slotsRevision: number | null, authorize: () => string): Promise<SlotDiagnostics> {
  const unavailable: SlotDiagnostics = { schema: 'slot-pin-diagnostics/v1', advisory: true, status: 'unavailable', slotsRevision,
    catalog: { source: 'unavailable', revision: null }, checkedAt: null, warningCount: null, omittedWarningCount: null, warnings: null };
  try {
    if (!slots) return unavailable; // A legacy serving fallback is not a checked slot document.
    const tenant = authorize();
    if (!Object.values(slots.pages).some(page => page.some(slot => slotPins(slot).length > 0))) {
      return { ...unavailable, status: 'not_required', catalog: { source: 'not_read', revision: null }, warningCount: 0, omittedWarningCount: 0, warnings: [] };
    }
    const catalog = await readPublication(env, CONTENT_KIND, tenant), now = Date.now();
    const byId = new Map(catalog.value.pieces.map(piece => [piece.id, piece]));
    const warnings: NonNullable<SlotDiagnostics['warnings']> = []; let warningCount = 0;
    Object.values(slots.pages).forEach((page, pageIndex) => page.forEach((slot, slotIndex) => {
      const gate = compileSlotConstraints(slot);
      slotPins(slot).forEach((id, pinIndex) => {
      const piece = byId.get(id);
      const reason = gate.reason(piece, id)
        ?? (!piece ? 'missing_piece' : !piece.slotTypes.includes(slot.slot) ? 'slot_type'
          : !isEligibleAt(piece, now) ? 'currently_ineligible' : null);
      if (reason) { warningCount++; if (warnings.length < 50) warnings.push({ pageIndex, slotIndex, ...(slot.pinnedPieceIds ? { pinIndex } : {}), reason }); }
      });
    }));
    return { ...unavailable, status: 'available', catalog: { source: 'stored', revision: catalog.revision }, checkedAt: new Date(now).toISOString(),
      warningCount, omittedWarningCount: warningCount - warnings.length, warnings };
  } catch { return unavailable; } // Never turn an already committed slot write into a failed response.
}

/**
 * W20 R1 (R77(b), R82(c)): the public home of `constraintDiagnostics` — the
 * pieces a ranked slot's published hard controls refuse although the slot could
 * otherwise serve them — carried beside `pinDiagnostics` on the operator's read
 * of the slot document. It is its own channel, not part of
 * `slot-pin-diagnostics/v1`: that channel's rule is to echo no piece id or slot
 * name, while every constraint entry names both, because a merchandiser cannot
 * act on "slot 3 refused something".
 *
 * The same advisory envelope as the pin channel and the same fail-soft rule: a
 * legacy serving fallback (no stored document), an unauthorized scope or a
 * catalogue that cannot be read reports `unavailable` with null counts — never
 * a zero nobody checked — and never fails the slot read it rides on. A document
 * that publishes no hard control refuses nobody and is `not_required`, without
 * a catalogue read. `available` names the catalogue revision it checked and the
 * instant, because eligibility (window, stock, lifecycle) moves with time.
 */
export interface SlotConstraintDiagnostics {
  schema: 'slot-constraint-diagnostics/v1';
  advisory: true;
  status: 'available' | 'unavailable' | 'not_required';
  slotsRevision: number | null;
  catalog: { source: 'stored' | 'unavailable' | 'not_read'; revision: number | null };
  checkedAt: string | null;
  warningCount: number | null;
  omittedWarningCount: number | null;
  warnings: PageConstraintDiagnostic[] | null;
}

/** authorize must establish the exact slot document's canonical catalog tenant, as for `slotDiagnostics`. */
export async function slotConstraintDiagnostics(env: Env, slots: SlotCatalog | null, slotsRevision: number | null, authorize: () => string): Promise<SlotConstraintDiagnostics> {
  const unavailable: SlotConstraintDiagnostics = { schema: 'slot-constraint-diagnostics/v1', advisory: true, status: 'unavailable', slotsRevision,
    catalog: { source: 'unavailable', revision: null }, checkedAt: null, warningCount: null, omittedWarningCount: null, warnings: null };
  try {
    if (!slots) return unavailable; // A legacy serving fallback is not a checked slot document.
    const tenant = authorize();
    if (!Object.values(slots.pages).some(page => page.some(slot => compileSlotConstraints(slot).active))) {
      return { ...unavailable, status: 'not_required', catalog: { source: 'not_read', revision: null }, warningCount: 0, omittedWarningCount: 0, warnings: [] };
    }
    const catalog = await readPublication(env, CONTENT_KIND, tenant), now = Date.now();
    const found = slotDocumentConstraintDiagnostics(catalog.value.pieces, slots.pages, now);
    return { ...unavailable, status: 'available', catalog: { source: 'stored', revision: catalog.revision }, checkedAt: new Date(now).toISOString(),
      warningCount: found.warningCount, omittedWarningCount: found.omittedWarningCount, warnings: found.warnings };
  } catch { return unavailable; } // Advice never turns the slot read it rides on into a failed response.
}
