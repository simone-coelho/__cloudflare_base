import type { Env } from '@/types/env';
import { readPublication } from '@/config/publication';
import { CONTENT_KIND } from './kinds';
import { isEligibleAt } from './lifecycle';
import type { SlotCatalog } from './types';
import { compileSlotConstraints, slotPins, type SlotConstraintReason } from './slotConstraints';

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
