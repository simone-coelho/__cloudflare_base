// src/learn/policy.ts
// Doc 22 §4: attribution is a policy with four independent axes, not a menu of
// mutually exclusive choices. This is the LEARNING policy, applied online in the
// visitor's own object; reporting policies run over the ledger in batch.

import type { Cell } from '@/content/types';
import { isDecisionReference, parseId, type OutcomeRecord, type RewardType } from '@/ledger/records';

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
  measurementBasis?: import('@/content/types').MeasurementBasis;
  renderedAt?: number;
  position?: number;
  retention?: import('@/retention').CaptureRetention;
  id: string;
  /** Historical compact entries may lack this; they cannot establish an exact correlated brand. */
  brand?: string;
  tenant?: string;
  visitor_id?: string;
  ts: number;
  page: string;
  slot: string;
  item: string;
  session_id: string | null;
  arm: string;
  cell: Cell;
  /** CW32: the products the served piece features; a direct match accepts an outcome naming one of them. */
  products?: string[];
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
 * CW27 (doc 22 §13): what a credit is worth under the slot's objective. `unit` counts the success;
 * `revenue` weighs it by the outcome's value; `margin` by its margin, or its value when the feed gave
 * none. An outcome with nothing to weigh under a value objective is worth nothing, and the credit is
 * dropped rather than counted as one: a click cannot outrank a purchase on a slot that learns revenue.
 */
export function creditWeight(objective: 'unit' | 'revenue' | 'margin' | undefined, outcome: Pick<OutcomeRecord, 'value' | 'margin'>): number {
  if (!objective || objective === 'unit') return 1;
  const v = objective === 'margin' ? (outcome.margin ?? outcome.value) : outcome.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Apply the learning policy to one outcome against the visitor's ring. Pure.
 * Eligible decisions are those in scope, inside the reward's window, before the
 * outcome; `match` narrows them to the served item; `credit` picks who is paid.
 */
export function attribute(outcome: OutcomeRecord, ring: readonly RingEntry[], policy: AttributionPolicy): Credit[] {
  let candidates = ring;
  if (Object.prototype.hasOwnProperty.call(outcome, 'decision_id')) {
    const id = outcome.decision_id;
    if (!isDecisionReference(id)) return [];
    const carrier = parseId(id)!;
    if (carrier.tenant !== outcome.tenant || id.split(':')[2] !== outcome.visitor_id) return [];
    const matches = ring.filter(e => e.id === id);
    // Even identical duplicate rows are ambiguous retained evidence, not two selectable receipts.
    if (matches.length !== 1 || matches[0]!.brand !== outcome.brand || matches[0]!.ts !== carrier.ts
      || (Object.hasOwn(matches[0]!, 'tenant') && matches[0]!.tenant !== outcome.tenant)
      || (Object.hasOwn(matches[0]!, 'visitor_id') && matches[0]!.visitor_id !== outcome.visitor_id)) return [];
    candidates = matches;
  }
  const window = policy.windowsMs[outcome.type] ?? policy.windowsMs.custom ?? 30 * MIN;
  // The SDK's literal `unknown` is an unspecified-placement sentinel. Otherwise
  // preserve the supplied name exactly; a named miss must not broaden attribution.
  const namedSlot = typeof outcome.slot === 'string' && outcome.slot.trim().length > 0 && outcome.slot !== 'unknown'
    ? outcome.slot : null;
  const eligible = candidates.filter((e) => {
    const exposureAt = e.measurementBasis === 'rendered-v1' ? e.renderedAt : e.ts;
    if (exposureAt === undefined || !Number.isSafeInteger(exposureAt) || exposureAt > outcome.ts || outcome.ts - exposureAt > window) return false;
    if (policy.scope === 'session' && (e.session_id === null || outcome.session_id === null || e.session_id !== outcome.session_id)) return false;
    // `direct`: the outcome names the served item, or (CW32) one of the products the served piece features,
    // so a purchase of a bag credits the story that featured the bag under the default policy.
    if (policy.match === 'direct') {
      if (namedSlot !== null && e.slot !== namedSlot) return false;
      const named = e.item === outcome.item_id;
      const featured = Boolean(e.products?.length) && (outcome.products ?? (outcome.item_id ? [outcome.item_id] : [])).some((p) => e.products!.includes(p));
      if (!named && !featured) return false;
    }
    return true;
  });
  if (eligible.length === 0) return [];
  // Pick once within each eligible slot. Unspecified direct outcomes and `any`
  // retain their broad legacy behavior; an explicitly named direct outcome does not.
  const bySlot = new Map<string, RingEntry>();
  const ordered = [...eligible].sort((a, b) => (policy.credit === 'last' ? b.ts - a.ts : a.ts - b.ts));
  for (const e of ordered) if (!bySlot.has(e.slot)) bySlot.set(e.slot, e);
  return [...bySlot.values()].map((e) => ({
    decision_id: e.id, slot: e.slot, item: e.item, cell: e.cell, reward: outcome.type, event: outcome.event, ts: outcome.ts, weight: 1,
  }));
}
