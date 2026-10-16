// src/learn/policy.ts
// Doc 22 §4: attribution is a policy with four independent axes, not a menu of
// mutually exclusive choices. This is the LEARNING policy, applied online in the
// visitor's own object; reporting policies run over the ledger in batch.

import type { Cell, Objective, SlotAttribution } from '@/content/types';
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
  /**
   * P33 (decision D1, freeze item 11): slot → the slot's own attribution
   * policy, for the slots whose learn dials name one, and ABSENT when none
   * does, so a policy without it is exactly the brand-wide policy it always
   * was. It replaces the `match` axis for that slot's decisions alone; the
   * scope, the credit rule and the windows stay the brand-wide policy's.
   */
  slotAttribution?: Record<string, SlotAttribution>;
}

/**
 * P33: the match rule a decision served in `slot` is held to: the slot's own
 * attribution policy where the learning policy names one, else the brand-wide
 * `match`. A per-slot value other than `module-tied` matches nothing, so a
 * policy nobody published can never widen a slot's credit.
 */
export function slotMatchOf(policy: Pick<AttributionPolicy, 'match' | 'slotAttribution'>, slot: string): Match | SlotAttribution | null {
  const own = policy.slotAttribution;
  if (own === undefined || own === null || typeof own !== 'object' || !Object.hasOwn(own, slot)) return policy.match;
  return own[slot] === 'module-tied' ? 'module-tied' : null;
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
  /**
   * P16 (decision D1, freeze items 14 and 43): the success event the decision's
   * record names (`explain.successEvent`, on every record of a slot whose learn
   * dials publish a conversion table) and the table's value for it, `value`
   * null when the table does not value it. Only an outcome of that event
   * matches the decision (`attributeWindowed`), and `successCreditOf` weighs
   * it. A member the platform cannot read is kept as an event no outcome
   * carries, so it credits nothing. Absent on every other decision, whose
   * entry is exactly as before.
   */
  successEvent?: { event: string; value: number | null };
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
 * `revenue` weighs it by the outcome's value; `margin` by its margin. An outcome with nothing to weigh
 * under a value objective is worth nothing, and the credit is dropped rather than counted as one: a
 * click cannot outrank a purchase on a slot that learns revenue.
 *
 * W24 R1.02 (F19 §5.2, ruling R144): a margin objective NEVER falls back to the value. `margin ?? value`
 * put two different quantities in one counter — an order's margin and another order's revenue — so a
 * series learned under `margin` could not be read as money at all. An outcome the feed gave no margin
 * for is worth nothing to margin learning and is excluded from it, exactly as an outcome with no value
 * is excluded from revenue learning. What a MISSING margin should mean instead — a documented fallback,
 * or this zero — is the learning owners' (W24.P1.01); until they publish one the platform does not guess.
 */
export function creditWeight(objective: 'unit' | 'revenue' | 'margin' | undefined, outcome: Pick<OutcomeRecord, 'value' | 'margin'>): number {
  if (!objective || objective === 'unit') return 1;
  const v = objective === 'margin' ? outcome.margin : outcome.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * P16 (decision D1, freeze items 14 and 43): what one credit of a decision is
 * worth to its slot and the reward counter it is kept under — ONE rule, read by
 * the visitor's ring online (`DecisionRing`) and by every offline fold of the
 * ledger (`foldRetainedDay`, the hourly fold), so the offline recomputation
 * holds what online credit gave (W24).
 *
 * A decision whose record names its success event (`RingEntry.successEvent`,
 * written on every record of a slot whose learn dials publish a conversion
 * table): an outcome of that event is worth the table's value for it, in the
 * slot's own currency, times what the slot's objective weighs it
 * (`creditWeight`: 1 under `unit`, the outcome's value or margin under
 * `revenue` or `margin`), and is kept under the slot's own reward, whose
 * counter IS the slot's currency (`buildSnapshot` reads that counter alone). An
 * event the table does not value is worth nothing (freeze item 43), as is a
 * product that is not a finite number. Any other event is not this decision's
 * success: null.
 *
 * A decision whose record names none: exactly as before — the slot learns
 * against its one reward, at the objective's weight, and any other reward is
 * null.
 *
 * Null means the slot does not learn from this outcome for this decision (a
 * `reward` refusal); a weight of zero means it does and the credit is worth
 * nothing. The position effect (P05) multiplies the result where the credit is
 * applied, online in the statistics object and in the hourly fold alike.
 */
export function successCreditOf(success: RingEntry['successEvent'], slot: { reward: RewardType; objective?: Objective },
  outcome: Pick<OutcomeRecord, 'type' | 'value' | 'margin'>): { reward: RewardType; weight: number } | null {
  if (success === undefined) return outcome.type === slot.reward ? { reward: slot.reward, weight: creditWeight(slot.objective, outcome) } : null;
  if (success.event !== outcome.type) return null;
  const value = success.value;
  const weight = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * creditWeight(slot.objective, outcome) : 0;
  return { reward: slot.reward, weight: Number.isFinite(weight) ? weight : 0 };
}

/**
 * W23 T1.01: what attribution did, not only what it paid.
 *
 * `outsideWindow` counts the ring decisions this outcome MATCHED in every other
 * way — same scope, same served item or featured product, served before the
 * outcome — and could not be credited to because more time had passed than the
 * REWARD'S OWN attribution window allows (doc 22 §4.1). It is the eligibility
 * rule the settled "Late history" decision points at (HANDOFF-2026-09-18 §7
 * :354, "Experiment lifecycle/retained evidence determines eligibility"), never
 * an age cutoff inferred from delivery delay: a late DELIVERY of an outcome
 * whose decision is still inside the window is credited exactly as an on-time
 * one is.
 *
 * It is a COUNT and not a flag, so a reader can tell "nothing matched this
 * outcome" (zero) from "something matched it, but it was too late to count"
 * (one or more). A decision this outcome never matched — a different item, a
 * different session — is a miss by identity, not a miss by time, and is not
 * counted here.
 */
/**
 * W26 C1.01 (F21 §6(c), §8): beside them, the correlated decisions this outcome
 * NAMED and could not be credited to because the brand it carries disagrees
 * with the brand that decision was served under.
 *
 * The credit itself is refused exactly as it always was — a numerator may never
 * be moved into another brand's statistics object. What was missing is the
 * word: the receipt said `attributed: 0`, which is indistinguishable from
 * "nothing matched this outcome at all", and a tenant whose outcome brand was
 * defaulted to its tenant id could lose every credit without one number saying
 * so. This is a COUNT of decisions, never a flag and never a gate: it widens
 * nothing, credits nothing, and reaching it changes no decision.
 */
export interface Attribution { credits: Credit[]; outsideWindow: number; brandMismatched: number;
  /**
   * P16 (decision D1, freeze item 14): the decisions this outcome matched in
   * every other way, inside the reward's window, whose record names another
   * success event (`RingEntry.successEvent`): an outcome credits a decision of
   * a slot with a conversion table only when it is that decision's success.
   * Identifiers, so the ring can name the slot that refused it for its reward.
   * Absent when there are none, so an attribution over decisions that name no
   * success event is exactly what it was.
   */
  unsuccessful?: string[] }

/**
 * The placement an outcome names, or null when it names none. Absent, empty and
 * the SDK's literal `unknown` (`src/sdk/emit.ts:93`) are all "unspecified
 * placement", never a slot called `unknown`. One definition, so attribution and
 * the day report agree on what a legacy, placement-less outcome is.
 */
export const namedSlotOf = (slot: string | null | undefined): string | null =>
  typeof slot === 'string' && slot.trim().length > 0 && slot !== 'unknown' ? slot : null;

/**
 * W26 R4 (LANE-LOG R198; the W26-B1 build review: "the uncorrelated path scopes
 * by brand" and counted nothing): for an outcome that names NO decision, how
 * many placements of ANOTHER brand it would have been credited to under the
 * same policy — same scope, same item or featured product, same named slot,
 * inside the reward's window — in a slot its own brand credited nothing.
 *
 * `foreign` is the caller's own candidate list narrowed to entries that carry a
 * brand other than the outcome's; an entry with no brand cannot establish a
 * disagreement. `credited` is what the outcome's own brand was credited, so an
 * outcome its own placement took is never also a mismatch there. A COUNT, never
 * a gate: it credits nothing and moves nothing between brands. A correlated
 * outcome is counted by `attributeWindowed` itself and answers 0 here.
 */
export function uncorrelatedBrandMismatches(outcome: OutcomeRecord, foreign: readonly RingEntry[], policy: AttributionPolicy, credited: readonly Credit[]): number {
  if (Object.prototype.hasOwnProperty.call(outcome, 'decision_id')) return 0;
  const candidates = foreign.filter(e => typeof e.brand === 'string' && e.brand !== outcome.brand);
  if (!candidates.length) return 0;
  const own = new Set(credited.map(c => c.slot));
  return attributeWindowed(outcome, candidates, policy).credits.filter(c => !own.has(c.slot)).length;
}

/**
 * Apply the learning policy to one outcome against the visitor's ring. Pure.
 * Eligible decisions are those in scope, inside the reward's window, before the
 * outcome; `match` narrows them to the served item; `credit` picks who is paid.
 */
export function attribute(outcome: OutcomeRecord, ring: readonly RingEntry[], policy: AttributionPolicy): Credit[] {
  return attributeWindowed(outcome, ring, policy).credits;
}

/** `attribute`, and beside it what the reward's window refused. */
export function attributeWindowed(outcome: OutcomeRecord, ring: readonly RingEntry[], policy: AttributionPolicy): Attribution {
  const none: Attribution = { credits: [], outsideWindow: 0, brandMismatched: 0 };
  let candidates = ring;
  const correlated = Object.prototype.hasOwnProperty.call(outcome, 'decision_id');
  if (correlated) {
    const id = outcome.decision_id;
    if (!isDecisionReference(id)) return none;
    const carrier = parseId(id)!;
    if (carrier.tenant !== outcome.tenant || id.split(':')[2] !== outcome.visitor_id) return none;
    const matches = ring.filter(e => e.id === id);
    // W26 C1.01: the one refusal below that is a BRAND disagreement, counted
    // apart from the rest so it is legible instead of silent. Reported whether
    // or not another clause would also have refused this reference.
    const brandMismatched = matches.length === 1 && matches[0]!.brand !== outcome.brand ? 1 : 0;
    // Even identical duplicate rows are ambiguous retained evidence, not two selectable receipts.
    if (matches.length !== 1 || brandMismatched === 1 || matches[0]!.ts !== carrier.ts
      || (Object.hasOwn(matches[0]!, 'tenant') && matches[0]!.tenant !== outcome.tenant)
      || (Object.hasOwn(matches[0]!, 'visitor_id') && matches[0]!.visitor_id !== outcome.visitor_id)) return { ...none, brandMismatched };
    candidates = matches;
  }
  const window = policy.windowsMs[outcome.type] ?? policy.windowsMs.custom ?? 30 * MIN;
  // The SDK's literal `unknown` is an unspecified-placement sentinel. Otherwise
  // preserve the supplied name exactly; a named miss must not broaden attribution.
  const namedSlot = namedSlotOf(outcome.slot);
  /**
   * P33: the outcome names this module as its content: its `item_id` is the
   * module's identifier and is not one of the products it names, the form a
   * product-only event takes (`outcomeFromAction` falls back to the product
   * identifier and lists it among `products`).
   */
  const namesModule = (e: RingEntry): boolean => typeof outcome.item_id === 'string' && e.item === outcome.item_id
    && !(outcome.products ?? []).includes(outcome.item_id);
  /**
   * Everything the policy asks of a candidate EXCEPT the reward's window: its
   * exposure time when it matches this outcome's identity, null when it does
   * not. Splitting the window out of the predicate is what lets the receipt say
   * which of the two refused a decision; the predicate itself is unchanged.
   */
  const matchedAt = (e: RingEntry): number | null => {
    const exposureAt = e.measurementBasis === 'rendered-v1' ? e.renderedAt : e.ts;
    if (exposureAt === undefined || !Number.isSafeInteger(exposureAt) || exposureAt > outcome.ts) return null;
    if (policy.scope === 'session' && (e.session_id === null || outcome.session_id === null || e.session_id !== outcome.session_id)) return null;
    const match = slotMatchOf(policy, e.slot);
    if (match === null) return null;
    // `direct`: the outcome names the served item, or (CW32) one of the products the served piece features,
    // so a purchase of a bag credits the story that featured the bag under the default policy.
    if (match === 'direct') {
      if (namedSlot !== null && e.slot !== namedSlot) return null;
      const named = e.item === outcome.item_id;
      const featured = Boolean(e.products?.length) && (outcome.products ?? (outcome.item_id ? [outcome.item_id] : [])).some((p) => e.products!.includes(p));
      if (!named && !featured) return null;
    }
    // P33 `module-tied`: the outcome originated inside the module. A correlated
    // outcome names the decision itself (`candidates` holds that decision
    // alone); any other names the module's identifier as the content it
    // carries, never a product the module features and never a product
    // identifier alone, so a buy-box conversion credits no decision here.
    if (match === 'module-tied') {
      if (namedSlot !== null && e.slot !== namedSlot) return null;
      if (!correlated && !namesModule(e)) return null;
    }
    return exposureAt;
  };
  const eligible: RingEntry[] = [], unsuccessful: string[] = [];
  let outsideWindow = 0;
  for (const e of candidates) {
    const exposureAt = matchedAt(e);
    if (exposureAt === null) continue;
    const late = outcome.ts - exposureAt > window;
    // P16: a decision whose record names its success event is matched only by
    // an outcome of that event, BEFORE the credit rule picks within its slot,
    // so the pick lands on a decision this outcome is the success of. Another
    // event is a miss by identity, never by time.
    if (e.successEvent !== undefined && e.successEvent.event !== outcome.type) { if (!late) unsuccessful.push(e.id); continue; }
    if (late) { outsideWindow++; continue; }
    eligible.push(e);
  }
  const missed = unsuccessful.length ? { unsuccessful } : {};
  if (eligible.length === 0) return { credits: [], outsideWindow, brandMismatched: 0, ...missed };
  // Pick once within each eligible slot. Unspecified direct outcomes and `any`
  // retain their broad legacy behavior; an explicitly named direct outcome does not.
  const bySlot = new Map<string, RingEntry>();
  const ordered = [...eligible].sort((a, b) => (policy.credit === 'last' ? b.ts - a.ts : a.ts - b.ts));
  for (const e of ordered) if (!bySlot.has(e.slot)) bySlot.set(e.slot, e);
  return { outsideWindow, brandMismatched: 0, ...missed, credits: [...bySlot.values()].map((e) => ({
    decision_id: e.id, slot: e.slot, item: e.item, cell: e.cell, reward: outcome.type, event: outcome.event, ts: outcome.ts, weight: 1,
  })) };
}
