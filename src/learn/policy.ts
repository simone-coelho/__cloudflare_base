// src/learn/policy.ts
// Doc 22 §4: attribution is a policy with four independent axes, not a menu of
// mutually exclusive choices. This is the LEARNING policy, applied online in the
// visitor's own object; reporting policies run over the ledger in batch.

import type { Cell } from '@/content/types';
import type { OutcomeRecord, RewardType } from '@/ledger/records';

export type Scope = 'session' | 'visitor';
export type Match = 'direct' | 'any';
export type CreditRule = 'last' | 'first';

export interface AttributionPolicy {
  scope: Scope;
  match: Match;
  credit: CreditRule;
  /** Per reward type, how long after a decision an outcome may still count. */
  windowsMs: Partial<Record<RewardType, number>>;
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** §4.2's proposed default: the most conservative choice, the hardest to game, the easiest to explain. */
export const DEFAULT_POLICY: AttributionPolicy = {
  scope: 'session',
  match: 'direct',
  credit: 'last',
  windowsMs: { click: 30 * MIN, dwell: 30 * MIN, video_complete: 30 * MIN, wishlist: 6 * HOUR, add_to_bag: 6 * HOUR, purchase: 7 * DAY, custom: 30 * MIN },
};

/** What the ring keeps per served decision: what attribution and "why did she see this" need. */
export interface RingEntry {
  id: string;
  ts: number;
  page: string;
  slot: string;
  item: string;
  session_id: string | null;
  arm: string;
  cell: Cell;
}

/** One credited pair, on its way to the slot's statistics object. */
export interface Credit {
  decision_id: string;
  slot: string;
  item: string;
  cell: Cell;
  reward: RewardType;
  event: string;
  ts: number;
  weight: number;
}

/**
 * Apply the learning policy to one outcome against the visitor's ring. Pure.
 * Eligible decisions are those in scope, inside the reward's window, before the
 * outcome; `match` narrows them to the served item; `credit` picks who is paid.
 */
export function attribute(outcome: OutcomeRecord, ring: readonly RingEntry[], policy: AttributionPolicy): Credit[] {
  const window = policy.windowsMs[outcome.type] ?? policy.windowsMs.custom ?? 30 * MIN;
  const eligible = ring.filter((e) => {
    if (e.ts > outcome.ts || outcome.ts - e.ts > window) return false;
    if (policy.scope === 'session' && (e.session_id === null || outcome.session_id === null || e.session_id !== outcome.session_id)) return false;
    if (policy.match === 'direct' && (!outcome.item_id || e.item !== outcome.item_id)) return false;
    return true;
  });
  if (eligible.length === 0) return [];
  // Credit goes to one decision per slot, so a click on the hero pays the hero
  // once even when the same piece was also served in a rail.
  const bySlot = new Map<string, RingEntry>();
  const ordered = [...eligible].sort((a, b) => (policy.credit === 'last' ? b.ts - a.ts : a.ts - b.ts));
  for (const e of ordered) if (!bySlot.has(e.slot)) bySlot.set(e.slot, e);
  return [...bySlot.values()].map((e) => ({
    decision_id: e.id, slot: e.slot, item: e.item, cell: e.cell, reward: outcome.type, event: outcome.event, ts: outcome.ts, weight: 1,
  }));
}
