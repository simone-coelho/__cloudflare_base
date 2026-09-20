// src/learn/queue.ts
// Doc 28 §3.5: the landing page of an operator application is a work queue,
// what needs a person as counts with links, never the data itself. Pure; the
// route gathers the inputs.

import type { LearnConfig } from '@/content/types';
import type { Proposal } from './autonomy';
import type { SlotIndexEntry } from './rows';

export interface WorkQueue {
  /** Proposals the daily cycle made that nobody has applied or rejected. */
  proposals_pending: number;
  /** Slots that have published nothing yet: nothing learned, nothing to tune against. */
  slots_without_evidence: Array<{ page: string; slot: string }>;
  /** Slots whose trust dial is above zero: learning is acting, worth a look. */
  slots_acting: Array<{ page: string; slot: string; gamma: number }>;
  /** Pieces a merchandiser froze or rejected, per slot: controls that outlive their reason. */
  items_frozen: number;
  items_rejected: number;
  /** Visitors erased whose ledger rows are still to be rewritten. */
  erasures_pending: number;
  /**
   * W21 E1.05 (R118(3)): decisions in the last thirty days that could not read
   * the shopper's persistent enrollment anchor. Each one was served the site's
   * own default and recorded as an ineligible assignment rather than being
   * re-randomised, so this is not lost traffic — it is a store that needs a
   * person to look at it before the experiment's population drifts.
   */
  enrollment_anchor_unavailable: number;
  slots_total: number;
}

export function queueOf(input: { proposals: readonly Proposal[]; slots: readonly SlotIndexEntry[]; learn: LearnConfig; erasuresPending: number;
  anchorUnavailable?: number }): WorkQueue {
  let frozen = 0, rejected = 0;
  for (const d of Object.values(input.learn.slots ?? {})) for (const c of Object.values(d.items ?? {})) { if (c.mode === 'freeze') frozen++; else if (c.mode === 'reject') rejected++; }
  return {
    proposals_pending: input.proposals.filter((p) => p.status === 'proposed').length,
    slots_without_evidence: input.slots.filter((s) => (s.rankedCapacity !== undefined ? s.rankedCapacity > 0 : !s.pinned) && (!s.evidence || s.evidence.items === 0)).map((s) => ({ page: s.page, slot: s.slot })),
    slots_acting: input.slots.filter((s) => (s.rankedCapacity === undefined || s.rankedCapacity > 0) && s.gamma > 0).map((s) => ({ page: s.page, slot: s.slot, gamma: s.gamma })),
    items_frozen: frozen,
    items_rejected: rejected,
    erasures_pending: input.erasuresPending,
    enrollment_anchor_unavailable: input.anchorUnavailable ?? 0,
    slots_total: input.slots.length,
  };
}
