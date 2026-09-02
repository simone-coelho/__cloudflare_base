// src/content/decide.ts
// The decision, pure. Given the catalog, the page's slots, the shopper's
// affinity, the cell, the arm and the versions in force, produce the delivery
// contract and the ledger records in one pass. No I/O, no clock, no randomness:
// the same input yields the same output, which is what makes replay (doc 22
// §12.3) a proof rather than a hope.

import { composeContentDetailed, type ContentSlotSpec, type AffinityViewLike } from '@/reflex/contentCompose';
import type {
  Arm, Authority, Cell, ContentDecisionSet, ContentPiece, DecisionRecord, DecisionVersions, SlotStrategy,
} from './types';

export interface DecideInput {
  tenant: string;
  brand: string;
  page: string;
  visitorId: string;
  sessionId: string | null;
  nowMs: number;
  pieces: readonly ContentPiece[];
  slots: readonly SlotStrategy[];
  affinity: AffinityViewLike | null;
  cell: Cell;
  arm: Arm;
  versions: DecisionVersions;
  configLabel: string;
  /** Top-N candidates recorded per slot (doc 22 §3.1). */
  candidateLimit?: number;
}

const NO_SIGNAL: AffinityViewLike = { dims: {} };

const authorityOf = (strategy: string): Authority =>
  strategy === 'tenant-pinned' ? 'pin' : strategy === 'default' ? 'default' : 'engine';

export function decideContent(i: DecideInput): ContentDecisionSet {
  // The `default` arm is the site's own defaults: no personalization, so the
  // composer sees no signal. Pins still apply — they are merchandising
  // authority, not personalization, and the holdout must not remove them.
  const affinity = i.arm === 'default' ? NO_SIGNAL : (i.affinity ?? NO_SIGNAL);
  const specs: ContentSlotSpec[] = i.slots.map((s) => ({
    slot: s.slot, take: s.take, weights: s.weights,
    ...(s.pinnedPieceId ? { pinnedPieceId: s.pinnedPieceId } : {}),
  }));
  const { decisions, candidates } = composeContentDetailed(i.pieces, affinity, specs, i.candidateLimit ?? 10);

  const positionIn = new Map<string, number>();
  const records: DecisionRecord[] = decisions.map((d) => {
    const position = positionIn.get(d.slot) ?? 0;
    positionIn.set(d.slot, position + 1);
    return {
      decision_id: `${i.nowMs.toString(36)}:${i.visitorId}:${i.page}:${d.slot}:${position}`,
      tenant: i.tenant, brand: i.brand, visitor_id: i.visitorId, session_id: i.sessionId, ts: i.nowMs,
      page: i.page, slot: d.slot, position, item_id: d.contentId, customer_item_id: d.customerContentId,
      candidates: candidates[d.slot] ?? [],
      cell: i.cell, arm: i.arm, explored: false, authority: authorityOf(d.strategy),
      versions: { ...i.versions }, config_label: i.configLabel,
      explain: { drivers: d.explain.drivers, ...(d.explain.note ? { note: d.explain.note } : {}), score_base: d.score, lift: null },
    };
  });

  return {
    tenant: i.tenant, brand: i.brand, page: i.page, visitor_id: i.visitorId, session_id: i.sessionId, ts: i.nowMs,
    arm: i.arm, cell: i.cell, versions: { ...i.versions }, config_label: i.configLabel,
    decisions, records,
  };
}
