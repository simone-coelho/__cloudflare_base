// src/demos/brighthour/composer.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Bright Hour slot composer — recon §C2 precedence, made observable.
//
// This is the FIRST and ONLY enforcement point for the eligibility gates: the
// reflex core scores, the lifecycle engine derives, and THIS module decides. The
// whole of §C2 runs here, in order, and every step it takes lands in an explain
// record that becomes one warehouse-shaped row (Beat 7):
//
//   1. ELIGIBILITY GATES   evaluateGates() — lifecycle open, availability,
//                          vip_offer_exclusion, financing_conflict (display-only),
//                          channel. Nothing enters a slot without passing.
//   2. MERCHANDISER PINS   hero_billboard (non-personalized billboard) and the
//                          Q50-style pinned pick at deals_rail position 1.
//                          `pinned: true, ranking skipped` (Beat 5).
//   3. WEIGHTED RANKING    Σ affinity_d × weight_d over the SURVIVING candidates,
//                          using the visitor's live reflex scores.
//   4. EXPOSURE QUOTAS     the discovery floor: ≥N picks from categories the
//                          visitor has no affinity for. Turn it off and the page
//                          collapses into a monotone wall — visibly worse.
//   5. TIE-BREAK           deterministic hash(visitorId, slotId) — replayable.
//
// House discipline (src/reflex/core.ts, ./offerLifecycle.ts): the core is PURE.
// `now` is a parameter, no ambient clock, no I/O, no randomness — so "same
// inputs + same config_version ⇒ byte-identical payload" is a property of the
// code rather than a claim in a deck (Beat 14). The thin I/O wrapper at the
// bottom (catalog load, D1 write) is the only part that touches the outside.
//
// Two things this module deliberately does NOT do:
//   • it never trusts a stored `offer.lifecycleState` (the loader always writes
//     null); state is derived at decision time via lifecycleStateAt();
//   • it never re-resolves an EVT120 reveal window — the loader already
//     materialized those through resolveRevealWindow(), so a reveal item is
//     gated exactly like any other windowed item. currentRevealIndex() is used
//     only for the event module's "reveal N of M" framing.
// ─────────────────────────────────────────────────────────────────────────────

import { extractTouches, type ReflexConfig } from '@/reflex/core';
import { BRIGHTHOUR_REFLEX_CONFIG, type BrightHourDimension } from './reflexConfig';
import { toMs } from './demoClock';
import {
  DEFAULT_LIFECYCLE_CONFIG,
  GATE_AVAILABILITY,
  GATE_VIP_OFFER_EXCLUSION,
  constructCodeOf,
  currentRevealIndex,
  evaluateGates,
  isWindowOpenAt,
  lifecycleStateAt,
  nextOccupantFor,
  nextTransitionAt,
  revealCount as revealCountOf,
  windowLanguage,
  type GateEvaluation,
  type LifecycleConfig,
  type LifecycleState,
  type OfferItemLike,
  type WindowLanguage,
} from './offerLifecycle';
import {
  BH_FRAMINGS,
  chooseFraming,
  frameOffer,
  type BhAssignment,
  type BhExperimentIds,
  type BhVariationKey,
} from './experiment';

// ── Structural item shape (the loader's BrighthourProduct satisfies it) ──────

export interface ComposerOffer {
  code?: string | null;
  label?: string | null;
  type?: string | null;
  badgeBucket?: string | null;
  windowStart?: string | number | null;
  windowEnd?: string | number | null;
  window?: { startMs?: number; endMs?: number } | null;
  presaleEligible?: boolean | null;
  parentEvent?: string | null;
  revealIndex?: number | null;
  revealCadenceMs?: number | null;
  revealDurationMs?: number | null;
  /** Merchandiser pin — §C2 precedence layer 2, above ranking. */
  pinned?: boolean | null;
  /** Set by the loader when it materialized a nested reveal window. */
  revealResolved?: boolean | null;
  revealClamped?: boolean | null;
}

export interface ComposerItem {
  id?: string | null;
  itemNumber?: string | null;
  name?: string | null;
  brand?: string | null;
  brandPersonality?: string | null;
  category?: string | null;
  subcategory?: string | null;
  price_usd?: number | null;
  image_url?: string | null;
  product_url?: string | null;
  urgencyState?: string | null;
  presentedBy?: string | null;
  mediaFormat?: string | null;
  /** Materialized by the loader from signals.lastOnAirOffsetHours. */
  last_on_air_ms?: number | null;
  offer?: ComposerOffer | null;
  availability?: { ats?: string | null } | null;
  pricing?: {
    comparableRetail?: number | null;
    ourPrice?: number | null;
    currentSellingPrice?: number | null;
    brightPay?: unknown;
    cardGatedPay?: unknown;
    specialFinancing?: unknown;
  } | null;
  returnPolicy?: string | null;
  signals?: { lastOnAirDate?: string | null } | null;
  reviews?: { count?: number | null; averageRating?: number | null } | null;
  /**
   * The catalog loader (catalog.ts `flattenInto`) copies scalars across and
   * flattens nested objects into `parent_child` keys, so an item that reaches
   * the composer carries `pricing_ourPrice`, `pricing_brightPay_phrasing`,
   * `reviews_averageRating`, … rather than the nested objects the JSON declares.
   * This index signature is how the projection below reads that mirror.
   */
  [flatKey: string]: unknown;
}

/** A materialized parent event (loadBrighthourEvents' output shape). */
export interface ComposerEvent {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  windowStart?: string | number | null;
  windowEnd?: string | number | null;
  revealCadenceMs?: number | null;
  revealDurationMs?: number | null;
  revealCount?: number | null;
}

/** reflexSnapshot(state, now, config).dims — original catalog value names. */
export type DimensionScores = Record<string, Record<string, number>>;

// ── Slot map v1 ──────────────────────────────────────────────────────────────

export type SlotId =
  | 'hero_billboard'
  | 'daily_deal'
  | 'spotlight_for_you'
  | 'deals_rail'
  | 'on_air_rail'
  | 'category_rail'
  | 'event_module'
  | 'discovery_rail';

/** Browse layout: all eight modules, in page order. */
export const BROWSE_SLOT_IDS: readonly SlotId[] = [
  'hero_billboard',
  'daily_deal',
  'spotlight_for_you',
  'deals_rail',
  'on_air_rail',
  'category_rail',
  'event_module',
  'discovery_rail',
];

/**
 * Mission layout (Beat 9): FOUR modules, offer-forward. The beat that REMOVES
 * modules — the direct antidote to a 15-module homepage. Layout is a decision
 * subject here, not just content.
 */
export const MISSION_SLOT_IDS: readonly SlotId[] = [
  'hero_billboard',
  'daily_deal',
  'spotlight_for_you',
  'category_rail',
];

export type SessionMission = 'mission' | 'browse';

/** How a slot arrived at its occupant — glass-box framing, not part of the row. */
export type SlotStrategy =
  | 'pin'
  | 'takeover'
  | 'affinity'
  | 'evergreen_fallback'
  | 'rank'
  | 'recency'
  | 'reveal'
  | 'quota'
  | 'empty';

// ── Tuning ───────────────────────────────────────────────────────────────────

/**
 * Ranking weights per dimension (§C2 step 3: Σ affinity_d × weight_d).
 *
 * `sessionMission` weighs ZERO on purpose: it decides the LAYOUT (how many
 * modules render), never which item wins a slot. Mixing the two would make the
 * mission collapse look like a ranking effect, which is exactly the confusion
 * Beat 9 exists to dispel.
 */
export const DEFAULT_DIMENSION_WEIGHTS: Readonly<Record<BrightHourDimension, number>> = {
  category: 1.0,
  subcategory: 0.8,
  offerTypeAffinity: 0.7,
  brandPersonality: 0.6,
  hostAffinity: 0.6,
  priceBand: 0.5,
  urgencyResponsiveness: 0.5,
  mediaAffinity: 0.4,
  sessionMission: 0,
};

export interface ComposerConfig {
  dimensionWeights: Record<string, number>;
  /** Max items in a rail slot (§A1's carousels are long; eight reads as a rail). */
  railMax: number;
  /** §C2 step 4: how many discovery picks are RESERVED before ranking fills the rail. */
  discoveryQuota: number;
  /** A category at or above this affinity is not "discovery" any more. */
  discoveryAffinityMax: number;
  /** The guardrail itself. Off ⇒ the monotone page (Beat 5's failure mode). */
  quotaEnabled: boolean;
  /** A VIP savings event is running ⇒ §C3's exclusion roster applies (Beat 14). */
  vipOfferActive: boolean;
  channel: string;
  lifecycle: LifecycleConfig;
  /** Construct codes the merchandiser billboard may feature, in precedence order. */
  heroBillboardConstructs: readonly string[];
  /** The takeover construct the daily-deal slot follows (succession, Beat 2f). */
  takeoverConstruct: string;
  /** Parent event the tentpole module renders. */
  eventModuleParentId: string;
  /** How many excluded candidates the explain carries (highest affinity first). */
  maxExcludedInExplain: number;
  /**
   * Beat 8. A sold-out item stays in its slot as WAITLIST for a visitor who
   * demonstrably wanted it (any weighted dimension at or above its θin), and is
   * replaced by the next eligible item for everyone else. Off ⇒ the pre-Beat-8
   * behaviour: sold out is sold out for everybody.
   */
  waitlistRetention: boolean;
  /**
   * Beat 12. When the visitor's hostAffinity has a leading value at or above
   * θin, the on-air rail leads with that host's items (recency preserved inside
   * each group). Off ⇒ pure broadcast recency.
   */
  hostAffinityReorder: boolean;
}

export const DEFAULT_COMPOSER_CONFIG: ComposerConfig = {
  dimensionWeights: { ...DEFAULT_DIMENSION_WEIGHTS },
  railMax: 8,
  discoveryQuota: 2,
  discoveryAffinityMax: 0.1,
  quotaEnabled: true,
  // ON by default so the Beat-14 refusal is demonstrable without a flag flip:
  // a high-affinity Final Sale item must be visibly refused by RULE.
  vipOfferActive: true,
  channel: 'web',
  lifecycle: DEFAULT_LIFECYCLE_CONFIG,
  heroBillboardConstructs: ['EVT', 'EVT120', 'EVT72', 'EVT48', 'DDP', 'BH2'],
  takeoverConstruct: 'TBO',
  eventModuleParentId: 'EVT120_FALL',
  maxExcludedInExplain: 5,
  waitlistRetention: true,
  hostAffinityReorder: true,
};

// ── Output shapes ────────────────────────────────────────────────────────────

/**
 * The shopper-safe projection of an item. A SUBSET by construction: fields the
 * recon's DO-NOT-USE list forbids rendering (`signals.soldLast30Days`,
 * `availability.unitsRemaining`) can never leak to a page through this type.
 */
export interface SafeItem {
  id: string;
  itemNumber: string;
  name: string;
  brand: string;
  brandPersonality: string | null;
  category: string;
  subcategory: string;
  priceUsd: number;
  comparableRetail: number | null;
  ourPrice: number | null;
  /** null when the financing_conflict display gate suppressed it (§C3). */
  brightPay: unknown | null;
  cardGatedPay: unknown | null;
  specialFinancing: unknown | null;
  imageUrl: string;
  productUrl: string;
  urgencyState: string;
  ats: string;
  presentedBy: string | null;
  mediaFormat: string | null;
  lastOnAirDate: string | null;
  /**
   * The catalog's own review aggregate. Present so the page renders the REAL
   * count and rating instead of deriving a plausible-looking pair client-side —
   * a demo that invents its own social proof is exactly the kind of fake stamp
   * this surface refuses to make.
   */
  reviews: ItemReviews | null;
  /** Display elements a display-gate turned off, e.g. ['brightPay']. */
  displaySuppressed: string[];
}

/** Review aggregate as the catalog carries it (reviews.count / .averageRating). */
export interface ItemReviews {
  count: number;
  averageRating: number;
}

export interface RailItem extends SafeItem {
  offer: OfferView;
  rankScore: number;
  rankPosition: number;
  quotaReserved: boolean;
  pinned: boolean;
}

export interface OfferView {
  code: string | null;
  label: string | null;
  type: string | null;
  badgeBucket: string | null;
  lifecycleState: LifecycleState;
  /** §A6/§D2: window state as LANGUAGE. Never a countdown. */
  windowLanguage: WindowLanguage | null;
  windowStart: string | null;
  windowEnd: string | null;
  parentEvent: string | null;
  revealIndex: number | null;
  pinned: boolean;
  presaleEligible: boolean;
  /** Loader provenance for a nested reveal (glass box). */
  revealResolved?: boolean;
  revealClamped?: boolean;
  /**
   * Beat 13. Which vocabulary this offer's chip speaks under the running
   * experiment, and the badge text that arm produces. Present on the slot under
   * test only; every other slot's offer view is untouched.
   */
  framing?: BhVariationKey;
  framedLabel?: string;
}

/** Beat 13's assignment, as it rides on the decision it governed. */
export interface SlotExperiment {
  experiment_id: string | null;
  variation_id: string | null;
  campaign_id: string | null;
  variation_key: BhVariationKey;
  /** 0…9999 — the bucket, shown so the assignment is checkable, not asserted. */
  bucket: number;
  bucketed_on: string;
  /** False ⇒ nothing is launched on the platform and the ids are null. */
  launched: boolean;
}

/** One excluded candidate, with the rule that refused it (Beat 14). */
export interface ExcludedCandidate {
  itemId: string;
  name: string;
  gates_failed: string[];
  dimension_scores: Record<string, number>;
  rank_score: number;
}

/** The explain record — the glass box, and the shape of the export row. */
export interface SlotExplain {
  candidates_considered: number;
  /** Every item this slot looked at, in the order it saw them (Beat 7's `candidate_set[]`). */
  candidate_set: string[];
  gates_passed: string[];
  /** `name (reason)` — e.g. 'vip_offer_exclusion (final_sale)'. */
  gates_failed: string[];
  pinned: boolean;
  quota_reserved: boolean;
  dimension_scores: Record<string, number>;
  rank_score: number | null;
  rank_position: number | null;
  tie_break_hash: string;
  config_version: string;
  engine_latency_ms: number;
  /** Payload-only detail (never a column): who was refused, and by which rule. */
  excluded: ExcludedCandidate[];
}

export interface QueuedOffer {
  itemId: string;
  label: string | null;
  code: string | null;
  lifecycleState: LifecycleState;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface EventContext {
  id: string;
  name: string | null;
  code: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  lifecycleState: LifecycleState;
  /** Which reveal is current, or null outside the parent window. */
  revealIndex: number | null;
  /** Authored ladder length ("reveal 3 of 12"). */
  revealCount: number | null;
  /** window ÷ cadence — how many reveals the window could hold. */
  revealCapacity: number | null;
  revealCadenceMs: number | null;
}

export interface SlotDecision {
  slot_id: SlotId;
  order: number;
  decision_id: string;
  strategy: SlotStrategy;
  item: SafeItem | null;
  /** Rail slots only — the ordered picks. */
  items?: RailItem[];
  offer: OfferView | null;
  explain: SlotExplain;
  /**
   * What the composer DID to this slot beyond choosing an occupant — the notes
   * a presenter reads out: 'retained: high_affinity_waitlist' (Beat 8),
   * 'reordered: host_affinity host_dana_reyes' (Beat 12).
   */
  notes?: string[];
  /** Beat 13 — present on the slot under experiment, absent everywhere else. */
  experiment?: SlotExperiment;
  /** Non-clock messaging when a takeover slot has no live occupant. */
  message?: string;
  /** The successor sitting in preview (Beat 2: "tomorrow's TBO"). */
  queued?: QueuedOffer;
  event?: EventContext;
}

export interface ComposedPage {
  page: string;
  surface: 'brighthour';
  visitorId: string;
  sessionId: string | null;
  demoRunId: string | null;
  nowMs: number;
  epochMs: number | null;
  demoClock: { multiplier: number };
  sessionMission: SessionMission;
  moduleCount: number;
  decisions: SlotDecision[];
  /** Closed-form soonest lifecycle boundary — what scheduling consumes. */
  nextTransitionAt: number | null;
  affinitySnapshot: { dims: DimensionScores; memberships: string[] };
  configVersion: string;
  engineLatencyMs: number;
}

export interface ComposeInput {
  visitorId: string;
  /** Demo-timeline instant. The engine clock is authoritative. */
  nowMs: number;
  items: readonly ComposerItem[];
  events?: readonly ComposerEvent[];
  /** reflexSnapshot(...).dims — absent ⇒ a cold, zero-history visitor. */
  scores?: DimensionScores;
  memberships?: readonly string[];
  reflexConfig?: ReflexConfig;
  /** Explicit override; absent ⇒ derived from the sessionMission dimension. */
  sessionMission?: SessionMission;
  config?: Partial<ComposerConfig>;
  page?: string;
  sessionId?: string | null;
  demoRunId?: string | null;
  epochMs?: number | null;
  clockMultiplier?: number;
  /** Measured by the caller; injectable so replays compare byte-for-byte. */
  engineLatencyMs?: number;
  /**
   * Beat 13's platform ids, read from KV by the route (experiment.ts
   * `getBhExperimentIds`). Absent ⇒ the arm is still assigned deterministically
   * — the page varies, the export row's ids stay null, and nothing claims a
   * launch that has not happened.
   */
  experimentIds?: BhExperimentIds | null;
}

// ── Deterministic hashing (§C2 step 5) ───────────────────────────────────────

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 16 hex chars from two chained FNV-1a passes. Pure, portable, replayable. */
export function hashHex(...parts: string[]): string {
  const s = parts.join('\u0000');
  const a = fnv1a(s);
  const b = fnv1a(`${s}\u0001${a.toString(16)}`);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The §C2 step-5 tie-break: hash(visitorId, slotId). Stamped on every record. */
export function tieBreakHash(visitorId: string, slotId: string): string {
  return hashHex(visitorId, slotId).slice(0, 8);
}

/** Per-candidate ordering key — the same hash, extended by the item. */
function candidateTieKey(visitorId: string, slotId: string, itemId: string): string {
  return hashHex(visitorId, slotId, itemId);
}

function decisionId(
  visitorId: string,
  sessionId: string | null,
  slotId: string,
  nowMs: number,
  configVersion: string
): string {
  return `bhd_${hashHex(visitorId, sessionId ?? '', slotId, String(nowMs), configVersion)}`;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

// ── Candidates ───────────────────────────────────────────────────────────────

interface Candidate {
  item: ComposerItem;
  itemId: string;
  gates: GateEvaluation;
  /** The visitor's score for each of THIS item's dimension values. */
  dimensionScores: Record<string, number>;
  rankScore: number;
  categoryScore: number;
  /**
   * Beat 8: sold out, but kept in the running for THIS visitor and rendered on
   * the waitlist. Set by applyWaitlistRetention(), never by the gates — the gate
   * still failed, and the explain still says so.
   */
  waitlisted?: boolean;
}

interface RankedCandidate extends Candidate {
  tieKey: string;
}

function idOf(item: ComposerItem): string {
  return String(item.itemNumber ?? item.id ?? '');
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

/**
 * The item's availability, nested form first then the loader's flat mirror.
 *
 * `catalog.ts` flattens nested objects on the way in (`availability.ats` →
 * `availability_ats`) and re-attaches only `offer` and `signals`, so a
 * materialized catalog item carries no `availability` object at all — and the
 * gate, reading only the nested form, was defaulting every item to sellable.
 * This is the same nested-then-flat rule the money and review readers already
 * follow, and it is what lets Beat 8's availability override (which writes both
 * forms) be READ by the gate rather than quietly ignored.
 */
function atsOf(item: ComposerItem): string {
  const nested = item.availability?.ats;
  if (typeof nested === 'string' && nested.trim()) return nested;
  const flat = flatOf(item, 'availability_ats');
  return typeof flat === 'string' && flat.trim() ? flat : 'Y';
}

function buildCandidate(
  item: ComposerItem,
  nowMs: number,
  cfg: ComposerConfig,
  reflexConfig: ReflexConfig,
  scores: DimensionScores
): Candidate {
  // The gates see the resolved availability, whichever form the item carries.
  const gates = evaluateGates({ ...(item as OfferItemLike), availability: { ats: atsOf(item) } }, nowMs, {
    vipOfferActive: cfg.vipOfferActive,
    channel: cfg.channel,
    cfg: cfg.lifecycle,
  });

  // The dimension mapping is the reflex core's own — flat sources, banded price.
  // Reusing extractTouches means a dimension the registry adds is ranked here
  // with no composer change, and can never be scored one way and ranked another.
  const touches = extractTouches(item as unknown as Record<string, unknown>, reflexConfig);
  const dimensionScores: Record<string, number> = {};
  for (const t of touches) {
    const s = scores[t.dim]?.[t.value] ?? 0;
    if (!(t.dim in dimensionScores) || s > dimensionScores[t.dim]) dimensionScores[t.dim] = s;
  }

  let rankScore = 0;
  for (const [dim, s] of Object.entries(dimensionScores)) {
    rankScore += s * (cfg.dimensionWeights[dim] ?? 0);
  }

  return {
    item,
    itemId: idOf(item),
    gates,
    dimensionScores,
    rankScore: round4(rankScore),
    categoryScore: dimensionScores.category ?? 0,
  };
}

// ── Beat 8: sold out for most, WAITLIST for the visitor who wanted it ────────

/**
 * Did this visitor demonstrably want this item? True when any WEIGHTED
 * dimension the item carries is at or above that dimension's own θin — the same
 * threshold the meters on screen cross, so "she was above the line" is a thing
 * the presenter can point at rather than assert.
 */
function aboveThetaIn(
  c: Candidate,
  cfg: ComposerConfig,
  reflexConfig: ReflexConfig
): { dim: string; score: number } | null {
  let best: { dim: string; score: number } | null = null;
  for (const spec of reflexConfig.dimensions) {
    if ((cfg.dimensionWeights[spec.key] ?? 0) <= 0) continue;
    const score = c.dimensionScores[spec.key] ?? 0;
    const thetaIn = spec.thetaIn ?? reflexConfig.thetaIn;
    if (score < thetaIn) continue;
    if (!best || score > best.score) best = { dim: spec.key, score };
  }
  return best;
}

/** The only reason a retained item may have failed: it sold through. */
function soldOutOnly(c: Candidate): boolean {
  const failed = c.gates.results.filter((r) => !r.passed && !r.display);
  return failed.length === 1 && failed[0].gate === GATE_AVAILABILITY && failed[0].reason === 'sold_out';
}

/**
 * Beat 8, in one pass over the candidates.
 *
 * QVC's real rule is that the waitlist PRESERVES the price, so nothing about
 * the money changes here: the item keeps its slot, its price and its offer, and
 * only its availability language moves (In Stock → Waitlist, their exact
 * strings). The gate result is rewritten from `sold_out` to `waitlist` because
 * that is now what happened to it — the failure is still reported, so the glass
 * box shows both the refusal AND the retention, and the slot carries the note
 * `retained: high_affinity_waitlist`.
 *
 * A low-affinity visitor takes no branch at all: the item stays ineligible and
 * the next eligible occupant fills the slot, exactly as before.
 */
function applyWaitlistRetention(
  all: Candidate[],
  cfg: ComposerConfig,
  reflexConfig: ReflexConfig
): void {
  if (!cfg.waitlistRetention) return;
  for (const c of all) {
    if (c.gates.eligible || !soldOutOnly(c)) continue;
    if (!aboveThetaIn(c, cfg, reflexConfig)) continue;
    c.waitlisted = true;
    c.gates = {
      ...c.gates,
      eligible: true,
      gatesFailed: c.gates.gatesFailed.map((f) =>
        f === `${GATE_AVAILABILITY} (sold_out)` ? `${GATE_AVAILABILITY} (waitlist)` : f
      ),
      results: c.gates.results.map((r) =>
        r.gate === GATE_AVAILABILITY && !r.passed ? { ...r, reason: 'waitlist' } : r
      ),
    };
  }
}

/** §C2 step 3 then step 5: weighted rank, deterministic hash tie-break. */
function rankPool(visitorId: string, slotId: string, pool: readonly Candidate[]): RankedCandidate[] {
  return pool
    .map((c) => ({ ...c, tieKey: candidateTieKey(visitorId, slotId, c.itemId) }))
    .sort((a, b) => b.rankScore - a.rankScore || (a.tieKey < b.tieKey ? -1 : a.tieKey > b.tieKey ? 1 : 0));
}

// ── Projections ──────────────────────────────────────────────────────────────

// The catalog declares pricing and reviews as NESTED objects, but the loader
// flattens them on the way in (catalog.ts `flattenInto`), so by the time an item
// reaches this projection the money lives in `pricing_ourPrice`,
// `pricing_brightPay_phrasing`, `reviews_count`, … Reading only the nested form
// meant every price and every review aggregate left here as null, and the page
// had no choice but to invent its own — a derived "was" price and a synthesized
// star rating standing in for numbers the catalog was carrying all along.
//
// So the readers below take the nested object when it is there (hand-built test
// fixtures, and any future loader that stops flattening) and fall back to the
// flat mirror otherwise. Server values win; the client's derivation becomes the
// fallback it was always meant to be.

/** A flat mirror key the loader left on the item, e.g. `pricing_ourPrice`. */
function flatOf(item: ComposerItem, key: string): unknown {
  return (item as Record<string, unknown>)[key];
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Nested number if present, else the flat mirror, else null. */
function moneyOf(item: ComposerItem, nested: unknown, flatKey: string): number | null {
  return finiteOrNull(nested) ?? finiteOrNull(flatOf(item, flatKey));
}

/**
 * An installment plan (brightPay / cardGatedPay / specialFinancing), rebuilt
 * from whichever form survived. Only the fields actually present are emitted, so
 * a plan the catalog left null stays null rather than becoming a hollow object
 * the page would happily render as a real offer.
 */
function planOf(item: ComposerItem, nested: unknown, flatPrefix: string): unknown | null {
  if (nested && typeof nested === 'object') return nested;
  const code = flatOf(item, `${flatPrefix}_code`);
  const phrasing = flatOf(item, `${flatPrefix}_phrasing`);
  const amount = finiteOrNull(flatOf(item, `${flatPrefix}_amount`));
  const installments = finiteOrNull(flatOf(item, `${flatPrefix}_installments`));
  const months = finiteOrNull(flatOf(item, `${flatPrefix}_months`));
  if (typeof phrasing !== 'string' && amount === null && months === null) return null;
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(installments === null ? {} : { installments }),
    ...(amount === null ? {} : { amount }),
    ...(months === null ? {} : { months }),
    ...(typeof phrasing === 'string' ? { phrasing } : {}),
  };
}

/** The review aggregate, nested form first, then the flat mirror. */
function reviewsOf(item: ComposerItem): ItemReviews | null {
  const count = finiteOrNull(item.reviews?.count) ?? finiteOrNull(flatOf(item, 'reviews_count'));
  const averageRating =
    finiteOrNull(item.reviews?.averageRating) ?? finiteOrNull(flatOf(item, 'reviews_averageRating'));
  if (count === null && averageRating === null) return null;
  return { count: count ?? 0, averageRating: averageRating ?? 0 };
}

function safeItem(c: Candidate): SafeItem {
  const item = c.item;
  const suppressed = c.gates.displaySuppressed;
  const hide = (key: string, value: unknown): unknown | null =>
    suppressed.includes(key) ? null : (value ?? null);
  return {
    id: str(item.id, c.itemId),
    itemNumber: c.itemId,
    name: str(item.name),
    brand: str(item.brand),
    brandPersonality: item.brandPersonality ?? null,
    category: str(item.category),
    subcategory: str(item.subcategory),
    priceUsd: typeof item.price_usd === 'number' ? item.price_usd : 0,
    comparableRetail: moneyOf(item, item.pricing?.comparableRetail, 'pricing_comparableRetail'),
    ourPrice: moneyOf(item, item.pricing?.ourPrice, 'pricing_ourPrice'),
    brightPay: hide('brightPay', planOf(item, item.pricing?.brightPay, 'pricing_brightPay')),
    cardGatedPay: hide(
      'cardGatedPay',
      planOf(item, item.pricing?.cardGatedPay, 'pricing_cardGatedPay')
    ),
    specialFinancing: hide(
      'specialFinancing',
      planOf(item, item.pricing?.specialFinancing, 'pricing_specialFinancing')
    ),
    imageUrl: str(item.image_url),
    productUrl: str(item.product_url),
    // Beat 8: a retained sell-through renders in THEIR waitlist vocabulary
    // (In Stock → Low Stock → Sold Out → Waitlist) on their own Y|N|W model.
    // The price is untouched on purpose — the waitlist preserves it (§C3).
    urgencyState: c.waitlisted ? 'waitlist' : str(item.urgencyState, 'in_stock'),
    ats: c.waitlisted ? 'W' : atsOf(item),
    presentedBy: item.presentedBy ?? null,
    mediaFormat: item.mediaFormat ?? null,
    lastOnAirDate: item.signals?.lastOnAirDate ?? null,
    reviews: reviewsOf(item),
    displaySuppressed: [...suppressed],
  };
}

function offerView(c: Candidate, nowMs: number, cfg: ComposerConfig): OfferView {
  const offer = c.item.offer ?? {};
  const state = lifecycleStateAt(offer, nowMs, cfg.lifecycle);
  const view: OfferView = {
    code: offer.code ?? null,
    label: offer.label ?? null,
    type: offer.type ?? null,
    badgeBucket: offer.badgeBucket ?? null,
    lifecycleState: state,
    windowLanguage: windowLanguage(offer, nowMs, cfg.lifecycle),
    windowStart: typeof offer.windowStart === 'string' ? offer.windowStart : null,
    windowEnd: typeof offer.windowEnd === 'string' ? offer.windowEnd : null,
    parentEvent: offer.parentEvent ?? null,
    revealIndex: typeof offer.revealIndex === 'number' ? offer.revealIndex : null,
    pinned: offer.pinned === true,
    presaleEligible: offer.presaleEligible === true,
  };
  if (offer.revealResolved) {
    view.revealResolved = true;
    view.revealClamped = offer.revealClamped === true;
  }
  return view;
}

function railItem(
  c: RankedCandidate,
  nowMs: number,
  cfg: ComposerConfig,
  position: number,
  flags: { quotaReserved?: boolean; pinned?: boolean } = {}
): RailItem {
  return {
    ...safeItem(c),
    offer: offerView(c, nowMs, cfg),
    rankScore: c.rankScore,
    rankPosition: position,
    quotaReserved: flags.quotaReserved === true,
    pinned: flags.pinned === true || c.item.offer?.pinned === true,
  };
}

// ── Explain ──────────────────────────────────────────────────────────────────

interface ExplainInput {
  visitorId: string;
  slotId: string;
  /** Everything the slot looked at, BEFORE the eligibility filter. */
  pool: readonly Candidate[];
  chosen: Candidate | null;
  pinned: boolean;
  quotaReserved: boolean;
  rankScore: number | null;
  rankPosition: number | null;
  configVersion: string;
  engineLatencyMs: number;
  cfg: ComposerConfig;
}

function buildExplain(input: ExplainInput): SlotExplain {
  const rejected = input.pool.filter((c) => !c.gates.eligible);

  // Deduped, in GATE_ORDER-stable candidate order: 'name (reason)' exactly as
  // offerLifecycle formats it, so the export row and the panel read identically.
  const failed: string[] = [];
  for (const c of rejected) {
    for (const f of c.gates.gatesFailed) if (!failed.includes(f)) failed.push(f);
  }
  // A display gate on the CHOSEN item failed without excluding it — say so.
  if (input.chosen) {
    for (const f of input.chosen.gates.gatesFailed) if (!failed.includes(f)) failed.push(f);
  }
  // Beat 8: a retained item is eligible again, so it is not in `rejected` — but
  // its availability gate DID fail, and an explain that hid that would be
  // claiming the item is simply in stock.
  for (const c of input.pool) {
    if (!c.waitlisted) continue;
    for (const f of c.gates.gatesFailed) if (!failed.includes(f)) failed.push(f);
  }

  // Beat 14's refusal must survive the slice. Sorting excluded candidates by
  // rank_score alone hid it in practice: for a kitchen visitor the Final Sale
  // items are Beauty/Fashion/Home/Electronics, they score ~0, and they fell off
  // the end of the top-5 — so the one exclusion the beat is ABOUT was invisible
  // from most slots. One vip_offer_exclusion is hoisted to the front (the
  // highest-ranked one, so it is still the most interesting refusal), and the
  // rank order fills the rest.
  const byRank = [...rejected].sort(
    (a, b) => b.rankScore - a.rankScore || (a.itemId < b.itemId ? -1 : 1)
  );
  // Final Sale first among the VIP refusals: non-returnable is the rule that
  // most plainly outranks the model, and it is the one Beat 14 is scripted on.
  // Every refusal in this list really happened — this only decides which one
  // gets the seat when the slice cannot hold them all.
  const vipRefusal = (c: Candidate, reason?: string): boolean =>
    c.gates.gatesFailed.some((f) =>
      reason ? f === `${GATE_VIP_OFFER_EXCLUSION} (${reason})` : f.startsWith(GATE_VIP_OFFER_EXCLUSION)
    );
  const vipRefused =
    byRank.find((c) => vipRefusal(c, 'final_sale')) ?? byRank.find((c) => vipRefusal(c));
  const ordered = vipRefused ? [vipRefused, ...byRank.filter((c) => c !== vipRefused)] : byRank;

  const excluded = ordered
    .slice(0, input.cfg.maxExcludedInExplain)
    .map((c) => ({
      itemId: c.itemId,
      name: str(c.item.name),
      gates_failed: [...c.gates.gatesFailed],
      dimension_scores: { ...c.dimensionScores },
      rank_score: c.rankScore,
    }));

  return {
    candidates_considered: input.pool.length,
    candidate_set: input.pool.map((c) => c.itemId),
    gates_passed: input.chosen ? [...input.chosen.gates.gatesPassed] : [],
    gates_failed: failed,
    pinned: input.pinned,
    quota_reserved: input.quotaReserved,
    dimension_scores: input.chosen ? { ...input.chosen.dimensionScores } : {},
    rank_score: input.rankScore,
    rank_position: input.rankPosition,
    tie_break_hash: tieBreakHash(input.visitorId, input.slotId),
    config_version: input.configVersion,
    engine_latency_ms: input.engineLatencyMs,
    excluded,
  };
}

// ── Slot context ─────────────────────────────────────────────────────────────

interface SlotContext {
  visitorId: string;
  nowMs: number;
  cfg: ComposerConfig;
  reflexConfig: ReflexConfig;
  scores: DimensionScores;
  /** Every item, gated. */
  all: Candidate[];
  /** The survivors of §C2 step 1. */
  eligible: Candidate[];
  byId: Map<string, Candidate>;
  items: readonly ComposerItem[];
  events: readonly ComposerEvent[];
  configVersion: string;
  engineLatencyMs: number;
  sessionId: string | null;
  /** Beat 13's assignment for this visitor — governs the daily_deal slot only. */
  experiment: BhAssignment | null;
}

function newDecision(
  ctx: SlotContext,
  slotId: SlotId,
  order: number,
  parts: Omit<SlotDecision, 'slot_id' | 'order' | 'decision_id'>
): SlotDecision {
  return {
    slot_id: slotId,
    order,
    decision_id: decisionId(ctx.visitorId, ctx.sessionId, slotId, ctx.nowMs, ctx.configVersion),
    ...parts,
  };
}

// ── Slot 1: hero_billboard (precedence 2 — a pin, never personalized) ────────

/**
 * Beat 5's governance module. The merchandiser's billboard is chosen from the
 * live named-event constructs in declared precedence order and, within one, by
 * the lowest itemNumber: IDENTICAL for every visitor, by construction. The
 * explain reads `pinned: true` with a null rank_score — "ranking skipped".
 */
function composeHeroBillboard(ctx: SlotContext, order: number): SlotDecision {
  const pool: Candidate[] = [];
  let chosen: Candidate | null = null;

  for (const code of ctx.cfg.heroBillboardConstructs) {
    const group = ctx.all.filter((c) => constructCodeOf(c.item as OfferItemLike) === code);
    if (group.length === 0) continue;
    pool.push(...group);
    const live = group
      .filter((c) => c.gates.eligible)
      .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    if (live.length > 0) {
      chosen = live[0];
      break; // first construct with an occupant wins; no ranking, ever
    }
  }

  return newDecision(ctx, 'hero_billboard', order, {
    strategy: chosen ? 'pin' : 'empty',
    item: chosen ? safeItem(chosen) : null,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'hero_billboard',
      pool,
      chosen,
      pinned: true,
      quotaReserved: false,
      rankScore: null, // ranking skipped — the pin outranks the model
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });
}

// ── Slot 2: daily_deal (the takeover — succession, Beat 2f) ──────────────────

/**
 * The TBO slot. Its occupant is whoever's window contains `now` — computed, not
 * scheduled. At the boundary the outgoing offer leaves every eligible set and
 * the queued one takes the slot in the same millisecond: no gap, no human.
 */
function composeDailyDeal(ctx: SlotContext, order: number): SlotDecision {
  const code = ctx.cfg.takeoverConstruct;
  const pool = ctx.all.filter((c) => constructCodeOf(c.item as OfferItemLike) === code);

  const occupant = nextOccupantFor(code, ctx.items, ctx.nowMs, ctx.cfg.lifecycle, {
    vipOfferActive: ctx.cfg.vipOfferActive,
    channel: ctx.cfg.channel,
  });

  // Beat 8 on the takeover slot. nextOccupantFor works off the raw items and so
  // cannot know about this visitor's affinity; when the featured offer sold
  // through and THIS visitor was above θin on it, she keeps it (on the waitlist,
  // at the same price) instead of being handed the successor. Everyone else
  // takes the line below and gets the next eligible occupant, as before.
  const retained = rankPool(
    ctx.visitorId,
    'daily_deal',
    pool.filter((c) => c.waitlisted && isWindowOpenAt(c.item.offer, ctx.nowMs, ctx.cfg.lifecycle))
  )[0] ?? null;

  const chosen = retained ?? (occupant ? ctx.byId.get(idOf(occupant)) ?? null : null);

  // The successor sitting in preview — Beat 2's "tomorrow's TBO", visible
  // before it is servable, and the fallback message when the slot is empty.
  let queued: QueuedOffer | undefined;
  let soonest = Infinity;
  for (const c of pool) {
    if (chosen && c.itemId === chosen.itemId) continue;
    const start = toMs(c.item.offer?.windowStart);
    if (start === null || start <= ctx.nowMs || start >= soonest) continue;
    soonest = start;
    queued = {
      itemId: c.itemId,
      label: c.item.offer?.label ?? null,
      code: c.item.offer?.code ?? null,
      lifecycleState: lifecycleStateAt(c.item.offer, ctx.nowMs, ctx.cfg.lifecycle),
      windowStart: typeof c.item.offer?.windowStart === 'string' ? c.item.offer.windowStart : null,
      windowEnd: typeof c.item.offer?.windowEnd === 'string' ? c.item.offer.windowEnd : null,
    };
  }

  const decision = newDecision(ctx, 'daily_deal', order, {
    strategy: chosen ? 'takeover' : 'empty',
    item: chosen ? safeItem(chosen) : null,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'daily_deal',
      pool,
      chosen,
      pinned: false,
      quotaReserved: false,
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });

  // Beat 13: the slot under test. The arm is chosen from the visitor id alone
  // (pure, sticky, no storage), so the page varies whether or not anything is
  // launched on the platform; the ids stay null until it is, and the export row
  // says null rather than inventing a number.
  const assignment = ctx.experiment;
  if (assignment && decision.offer) {
    decision.offer.framing = assignment.variationKey;
    decision.offer.framedLabel = frameOffer(assignment.framing, decision.offer);
    // The value arm re-describes the same window without time language; the
    // window itself is unchanged, and neither arm ever counts down (§A6).
    if (assignment.framing.style === 'value') decision.offer.windowLanguage = null;
  }
  if (assignment) {
    decision.experiment = {
      experiment_id: assignment.experimentId,
      variation_id: assignment.variationId,
      campaign_id: assignment.campaignId,
      variation_key: assignment.variationKey,
      bucket: assignment.bucket,
      bucketed_on: assignment.bucketedOn,
      launched: assignment.launched,
    };
  }

  if (retained) decision.notes = [...(decision.notes ?? []), 'retained: high_affinity_waitlist'];
  if (queued) decision.queued = queued;
  if (!chosen) {
    // Language, never a clock (§A6): the queued state is described, not counted.
    decision.message = queued
      ? `${queued.label ?? "Today's Bright One"} — in ${queued.lifecycleState.replace('_', ' ')}.`
      : 'No Bright One is on the floor right now.';
  }
  return decision;
}

// ── Slot 3: spotlight_for_you (affinity, with the evergreen floor) ───────────

/** The top (dimension, value) the visitor is ABOVE θin on, or null. */
function topDimensionValue(
  scores: DimensionScores,
  reflexConfig: ReflexConfig,
  weights: Record<string, number>
): { dim: string; value: string; score: number } | null {
  let best: { dim: string; value: string; score: number } | null = null;
  for (const spec of reflexConfig.dimensions) {
    if ((weights[spec.key] ?? 0) <= 0) continue; // sessionMission drives layout, not content
    const thetaIn = spec.thetaIn ?? reflexConfig.thetaIn;
    const values = scores[spec.key];
    if (!values) continue;
    for (const value of Object.keys(values).sort()) {
      const score = values[value];
      if (score < thetaIn) continue;
      if (!best || score > best.score) best = { dim: spec.key, value, score };
    }
  }
  return best;
}

/** Does this item carry `value` on dimension `dim`? (Same mapping as scoring.) */
function itemHasValue(
  item: ComposerItem,
  dim: string,
  value: string,
  reflexConfig: ReflexConfig
): boolean {
  return extractTouches(item as unknown as Record<string, unknown>, reflexConfig).some(
    (t) => t.dim === dim && t.value === value
  );
}

/** A "timely" offer has a clock of its own; evergreen/until-gone items do not. */
function isTimely(item: ComposerItem): boolean {
  return toMs(item.offer?.windowStart) !== null;
}

function isEvergreen(item: ComposerItem): boolean {
  return item.offer?.type === 'evergreen';
}

/**
 * Beat 1's slot, and the `top-offers.json` homage: the top affinity dimension's
 * TIMELY offer — and, when the visitor has no affinity above θin (or nothing
 * timely survives the gates), the category's EVERGREEN entry rather than a
 * blank. Their own hand-curated file pairs exactly this way; the structure is
 * theirs, the automation is ours.
 */
function composeSpotlight(ctx: SlotContext, order: number): SlotDecision {
  const top = topDimensionValue(ctx.scores, ctx.reflexConfig, ctx.cfg.dimensionWeights);

  let pool: Candidate[] = [];
  let strategy: SlotStrategy = 'evergreen_fallback';

  if (top) {
    pool = ctx.all.filter(
      (c) => isTimely(c.item) && itemHasValue(c.item, top.dim, top.value, ctx.reflexConfig)
    );
    if (pool.some((c) => c.gates.eligible)) strategy = 'affinity';
  }

  if (strategy === 'evergreen_fallback') {
    // The evergreen floor, narrowed to the visitor's best-known category when
    // there is one (even below θin) — otherwise the whole evergreen pool.
    const category = topValueOf(ctx.scores.category);
    const evergreens = ctx.all.filter((c) => isEvergreen(c.item));
    const inCategory = category ? evergreens.filter((c) => c.item.category === category) : [];
    pool = inCategory.some((c) => c.gates.eligible) ? inCategory : evergreens;
  }

  const ranked = rankPool(ctx.visitorId, 'spotlight_for_you', pool.filter((c) => c.gates.eligible));
  const chosen = ranked[0] ?? null;

  return newDecision(ctx, 'spotlight_for_you', order, {
    strategy: chosen ? strategy : 'empty',
    item: chosen ? safeItem(chosen) : null,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'spotlight_for_you',
      pool,
      chosen,
      pinned: false,
      quotaReserved: false,
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });
}

/** Highest-scoring value on a dimension (deterministic on ties by value name). */
function topValueOf(values: Record<string, number> | undefined): string | null {
  if (!values) return null;
  let best: string | null = null;
  let bestScore = -1;
  for (const v of Object.keys(values).sort()) {
    if (values[v] > bestScore) {
      bestScore = values[v];
      best = v;
    }
  }
  return best;
}

// ── Slot 4: deals_rail (pins, then ranking) ──────────────────────────────────

/**
 * §C2 layers 2 and 3 in one visible place: the Q50-style curated pick holds
 * position 1 whatever the model thinks, and the rest of the rail is the weighted
 * ranking over everything that survived the gates.
 */
function composeDealsRail(ctx: SlotContext, order: number): SlotDecision {
  const pool = ctx.all;
  const ranked = rankPool(ctx.visitorId, 'deals_rail', ctx.eligible);

  const pins = ranked
    .filter((c) => c.item.offer?.pinned === true)
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  const pin = pins[0] ?? null;

  const rest = ranked.filter((c) => !pin || c.itemId !== pin.itemId);
  const picks = (pin ? [pin, ...rest] : rest).slice(0, ctx.cfg.railMax);

  const items = picks.map((c, i) =>
    railItem(c, ctx.nowMs, ctx.cfg, i + 1, { pinned: pin != null && i === 0 })
  );
  const chosen = picks[0] ?? null;

  return newDecision(ctx, 'deals_rail', order, {
    strategy: pin ? 'pin' : chosen ? 'rank' : 'empty',
    item: chosen ? safeItem(chosen) : null,
    items,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'deals_rail',
      pool,
      chosen,
      pinned: pin != null,
      quotaReserved: false,
      // A pin's rank_score is reported but was NOT what put it here.
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });
}

// ── Slot 5: on_air_rail (recency, not affinity) ──────────────────────────────

/**
 * "Items Recently On Air" (§A1 module 8). Ordered by `lastOnAirDate` recency —
 * a broadcast fact, not a model output.
 *
 * Beat 12 adds ONE move on top, and only when the visitor has earned it: if her
 * hostAffinity has a leading value at or above θin, that host's items lead the
 * rail and recency orders each group internally. It is a STABLE reorder, not a
 * re-rank — the rail is still the clock's, with a host lifted to the front —
 * which is why the note says `reordered`, not `ranked`. Nobody else in their
 * vendor set models the host at all; the honest version of that claim is a
 * reorder a presenter can point at, not a score nobody can check.
 */
function composeOnAirRail(ctx: SlotContext, order: number): SlotDecision {
  const aired = (c: Candidate): number | null => {
    const ms = c.item.last_on_air_ms;
    return typeof ms === 'number' && ms <= ctx.nowMs ? ms : null;
  };
  const pool = ctx.all.filter((c) => aired(c) !== null);
  const byRecency = pool
    .filter((c) => c.gates.eligible)
    .map((c) => ({ ...c, tieKey: candidateTieKey(ctx.visitorId, 'on_air_rail', c.itemId) }))
    .sort((a, b) => (aired(b) ?? 0) - (aired(a) ?? 0) || (a.tieKey < b.tieKey ? -1 : 1));

  const leadHost = hostAffinityLead(ctx);
  const ordered = leadHost
    ? [
        ...byRecency.filter((c) => str(c.item.presentedBy) === leadHost),
        ...byRecency.filter((c) => str(c.item.presentedBy) !== leadHost),
      ]
    : byRecency;
  const picks = ordered.slice(0, ctx.cfg.railMax);

  const items = picks.map((c, i) => railItem(c, ctx.nowMs, ctx.cfg, i + 1));
  const chosen = picks[0] ?? null;

  const decision = newDecision(ctx, 'on_air_rail', order, {
    strategy: chosen ? 'recency' : 'empty',
    item: chosen ? safeItem(chosen) : null,
    items,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'on_air_rail',
      pool,
      chosen,
      pinned: false,
      quotaReserved: false,
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });

  if (leadHost) decision.notes = [`reordered: host_affinity ${leadHost}`];
  return decision;
}

/** The host this visitor is above θin on, or null. Beat 12's whole condition. */
function hostAffinityLead(ctx: SlotContext): string | null {
  if (!ctx.cfg.hostAffinityReorder) return null;
  const values = ctx.scores.hostAffinity;
  const lead = topValueOf(values);
  if (!lead || !values) return null;
  const spec = ctx.reflexConfig.dimensions.find((d) => d.key === 'hostAffinity');
  const thetaIn = spec?.thetaIn ?? ctx.reflexConfig.thetaIn;
  return (values[lead] ?? 0) >= thetaIn ? lead : null;
}

// ── Slot 6: category_rail ────────────────────────────────────────────────────

function composeCategoryRail(ctx: SlotContext, order: number): SlotDecision {
  let category = topValueOf(ctx.scores.category);

  if (!category) {
    // Cold visitor: a deterministic, visitor-specific category off the tie-break
    // hash — replayable, and it stops every cold session opening on the same rail.
    const cats = [...new Set(ctx.eligible.map((c) => str(c.item.category)).filter(Boolean))].sort();
    if (cats.length > 0) {
      category = cats[fnv1a(hashHex(ctx.visitorId, 'category_rail')) % cats.length];
    }
  }

  const pool = category ? ctx.all.filter((c) => c.item.category === category) : [];
  const picks = rankPool(ctx.visitorId, 'category_rail', pool.filter((c) => c.gates.eligible)).slice(
    0,
    ctx.cfg.railMax
  );

  const items = picks.map((c, i) => railItem(c, ctx.nowMs, ctx.cfg, i + 1));
  const chosen = picks[0] ?? null;

  return newDecision(ctx, 'category_rail', order, {
    strategy: chosen ? (ctx.scores.category ? 'affinity' : 'rank') : 'empty',
    item: chosen ? safeItem(chosen) : null,
    items,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'category_rail',
      pool,
      chosen,
      pinned: false,
      quotaReserved: false,
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });
}

// ── Slot 7: event_module (the nested reveal) ─────────────────────────────────

/**
 * The 120-hour tentpole. The parent event does not change; the REVEAL inside it
 * turns over on the cadence, and the module follows it — which is precisely the
 * nested case Beat 2f lands. Eligibility is the reveal item's own materialized
 * window (the loader already resolved it); currentRevealIndex() supplies only
 * the "reveal N of M" framing.
 */
function composeEventModule(ctx: SlotContext, order: number): SlotDecision {
  const parent =
    ctx.events.find((e) => e.id === ctx.cfg.eventModuleParentId) ??
    ctx.events.find((e) => typeof e.revealCadenceMs === 'number' && (e.revealCadenceMs ?? 0) > 0) ??
    null;

  const parentId = parent?.id ?? ctx.cfg.eventModuleParentId;
  const cadenceMs = typeof parent?.revealCadenceMs === 'number' ? parent.revealCadenceMs : null;

  // The reveal ladder = children of this parent that carry a revealIndex.
  // FIN finale items hang off the same parent WITH their own windows and are
  // deliberately not on the ladder.
  const pool = ctx.all.filter(
    (c) => c.item.offer?.parentEvent === parentId && typeof c.item.offer?.revealIndex === 'number'
  );

  const index =
    parent && cadenceMs ? currentRevealIndex(parent, cadenceMs, ctx.nowMs) : null;

  const chosen =
    index === null
      ? null
      : pool.find((c) => c.item.offer?.revealIndex === index && c.gates.eligible) ?? null;

  const event: EventContext | undefined = parent
    ? {
        id: parentId,
        name: parent.name ?? null,
        code: parent.code ?? null,
        windowStart: typeof parent.windowStart === 'string' ? parent.windowStart : null,
        windowEnd: typeof parent.windowEnd === 'string' ? parent.windowEnd : null,
        lifecycleState: lifecycleStateAt(parent, ctx.nowMs, ctx.cfg.lifecycle),
        revealIndex: index,
        revealCount: typeof parent.revealCount === 'number' ? parent.revealCount : null,
        revealCapacity: cadenceMs ? revealCountOf(parent, cadenceMs) : null,
        revealCadenceMs: cadenceMs,
      }
    : undefined;

  const decision = newDecision(ctx, 'event_module', order, {
    strategy: chosen ? 'reveal' : 'empty',
    item: chosen ? safeItem(chosen) : null,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'event_module',
      pool,
      chosen,
      pinned: false,
      quotaReserved: false,
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });

  if (event) decision.event = event;
  if (!chosen && event) {
    decision.message =
      event.lifecycleState === 'live' || event.lifecycleState === 'ending_today'
        ? `${event.name ?? 'The event'} is running — the next reveal is on its way.`
        : `${event.name ?? 'The event'} opens on its start time.`;
  }
  return decision;
}

// ── Slot 8: discovery_rail (§C2 step 4 — the exposure floor) ─────────────────

/**
 * Beat 5's other half. At least `discoveryQuota` picks are RESERVED for
 * categories the visitor scores below `discoveryAffinityMax` on — held for the
 * exposure floor, against the ranking's own preference. Turn the quota off and
 * the rail becomes the top of the same ranked list the deals rail already
 * showed: the monotone page, which is the point of showing it.
 */
function composeDiscoveryRail(ctx: SlotContext, order: number): SlotDecision {
  const pool = ctx.all;
  const eligible = ctx.eligible;
  const quota = ctx.cfg.quotaEnabled ? Math.max(0, ctx.cfg.discoveryQuota) : 0;

  const discoveryPool = eligible.filter((c) => c.categoryScore < ctx.cfg.discoveryAffinityMax);
  const reserved = rankPool(ctx.visitorId, 'discovery_rail', discoveryPool).slice(0, quota);
  const reservedIds = new Set(reserved.map((c) => c.itemId));

  const filler = rankPool(ctx.visitorId, 'discovery_rail', eligible).filter(
    (c) => !reservedIds.has(c.itemId)
  );
  const picks = [...reserved, ...filler].slice(0, ctx.cfg.railMax);

  const items = picks.map((c, i) =>
    railItem(c, ctx.nowMs, ctx.cfg, i + 1, { quotaReserved: reservedIds.has(c.itemId) })
  );
  const chosen = picks[0] ?? null;

  return newDecision(ctx, 'discovery_rail', order, {
    strategy: chosen ? (reserved.length > 0 ? 'quota' : 'rank') : 'empty',
    item: chosen ? safeItem(chosen) : null,
    items,
    offer: chosen ? offerView(chosen, ctx.nowMs, ctx.cfg) : null,
    explain: buildExplain({
      visitorId: ctx.visitorId,
      slotId: 'discovery_rail',
      pool,
      chosen,
      pinned: false,
      quotaReserved: reserved.length > 0,
      rankScore: chosen ? chosen.rankScore : null,
      rankPosition: chosen ? 1 : null,
      configVersion: ctx.configVersion,
      engineLatencyMs: ctx.engineLatencyMs,
      cfg: ctx.cfg,
    }),
  });
}

// ── The composer ─────────────────────────────────────────────────────────────

/** mission vs browse — an explicit override, else the θin on the dimension. */
export function resolveMission(
  scores: DimensionScores,
  reflexConfig: ReflexConfig,
  override?: SessionMission
): SessionMission {
  if (override === 'mission' || override === 'browse') return override;
  const spec = reflexConfig.dimensions.find((d) => d.key === 'sessionMission');
  const thetaIn = spec?.thetaIn ?? reflexConfig.thetaIn;
  return (scores.sessionMission?.mission ?? 0) >= thetaIn ? 'mission' : 'browse';
}

const SLOT_BUILDERS: Record<SlotId, (ctx: SlotContext, order: number) => SlotDecision> = {
  hero_billboard: composeHeroBillboard,
  daily_deal: composeDailyDeal,
  spotlight_for_you: composeSpotlight,
  deals_rail: composeDealsRail,
  on_air_rail: composeOnAirRail,
  category_rail: composeCategoryRail,
  event_module: composeEventModule,
  discovery_rail: composeDiscoveryRail,
};

/**
 * Compose the page. PURE: (visitor, now, catalog, scores, config) → decisions.
 * No clock read, no I/O, no randomness — replay the same inputs under the same
 * config_version and every byte comes back identical, tie-break hashes included.
 */
export function composePage(input: ComposeInput): ComposedPage {
  const cfg: ComposerConfig = {
    ...DEFAULT_COMPOSER_CONFIG,
    ...input.config,
    dimensionWeights: { ...DEFAULT_DIMENSION_WEIGHTS, ...(input.config?.dimensionWeights ?? {}) },
    lifecycle: { ...DEFAULT_LIFECYCLE_CONFIG, ...(input.config?.lifecycle ?? {}) },
  };
  const reflexConfig = input.reflexConfig ?? BRIGHTHOUR_REFLEX_CONFIG;
  const scores = input.scores ?? {};
  const nowMs = input.nowMs;

  // §C2 step 1, once for every item: gates are evaluated in full (no
  // short-circuit) so a refusal can always name its rule.
  const all = input.items.map((item) => buildCandidate(item, nowMs, cfg, reflexConfig, scores));
  // Beat 8 runs between the gates and everything downstream: it is the ONLY
  // thing that may re-admit a gate failure, it may do it for exactly one reason
  // (sold through, and this visitor wanted it), and it leaves the failure on the
  // record. Every slot below then treats the retained item like any other.
  applyWaitlistRetention(all, cfg, reflexConfig);
  const eligible = all.filter((c) => c.gates.eligible);
  const byId = new Map(all.map((c) => [c.itemId, c]));

  const mission = resolveMission(scores, reflexConfig, input.sessionMission);
  const slots = mission === 'mission' ? MISSION_SLOT_IDS : BROWSE_SLOT_IDS;

  const ctx: SlotContext = {
    visitorId: input.visitorId,
    nowMs,
    cfg,
    reflexConfig,
    scores,
    all,
    eligible,
    byId,
    items: input.items,
    events: input.events ?? [],
    configVersion: reflexConfig.version,
    engineLatencyMs: input.engineLatencyMs ?? 0,
    sessionId: input.sessionId ?? null,
    // Beat 13's seam: pure and synchronous, so composePage stays replayable.
    // The ids are whatever the route read from KV — null before launch.
    experiment: chooseFraming(input.visitorId, input.experimentIds ?? null),
  };

  const decisions = slots.map((slotId, i) => SLOT_BUILDERS[slotId](ctx, i + 1));

  // Beat 8's note on every OTHER slot that ended up rendering a retained item
  // (the takeover slot writes its own above, where the retention happened).
  const waitlistedIds = new Set(all.filter((c) => c.waitlisted).map((c) => c.itemId));
  if (waitlistedIds.size > 0) {
    for (const d of decisions) {
      if (d.notes?.includes('retained: high_affinity_waitlist')) continue;
      const shown = [d.item?.itemNumber, ...(d.items ?? []).map((i) => i.itemNumber)];
      if (shown.some((id) => id && waitlistedIds.has(id))) {
        d.notes = [...(d.notes ?? []), 'retained: high_affinity_waitlist'];
      }
    }
  }

  return {
    page: input.page ?? 'home',
    surface: 'brighthour',
    visitorId: input.visitorId,
    sessionId: input.sessionId ?? null,
    demoRunId: input.demoRunId ?? null,
    nowMs,
    epochMs: input.epochMs ?? null,
    demoClock: { multiplier: input.clockMultiplier ?? 1 },
    sessionMission: mission,
    moduleCount: decisions.length,
    decisions,
    nextTransitionAt: nextTransitionAt(input.items, nowMs, cfg.lifecycle),
    affinitySnapshot: { dims: scores, memberships: [...(input.memberships ?? [])] },
    configVersion: reflexConfig.version,
    engineLatencyMs: input.engineLatencyMs ?? 0,
  };
}

/** Re-stamp the measured latency after composition (the core stays pure). */
export function stampEngineLatency(page: ComposedPage, ms: number): ComposedPage {
  page.engineLatencyMs = ms;
  for (const d of page.decisions) d.explain.engine_latency_ms = ms;
  return page;
}

// ── The export row (Beat 7) ──────────────────────────────────────────────────

/**
 * One flat, warehouse-shaped row per slot decision. The key order below is the
 * COLUMN ORDER of migrations/0006_brighthour_decisions.sql, 1:1 — asserted in
 * composer.test.ts, because a schema that drifts from its writer is how an
 * export exhibit dies.
 *
 * experiment_id / variation_id / campaign_id are null until the FX beat lands
 * (Beat 13, phase 3). The columns exist now so the row shape never changes
 * under the customer's analysts.
 */
export interface BhDecisionRow {
  decision_id: string;
  ts: number;
  visitor_id: string;
  session_id: string | null;
  slot_id: string;
  page_type: string;
  candidate_set: string;
  chosen_item: string | null;
  offer_code: string | null;
  offer_label: string | null;
  offer_window_start: string | null;
  offer_window_end: string | null;
  offer_lifecycle_state: string | null;
  parent_event: string | null;
  reveal_index: number | null;
  gates_passed: string;
  gates_failed: string;
  pinned: number;
  quota_reserved: number;
  dimension_scores: string;
  rank_score: number | null;
  rank_position: number | null;
  tie_break_hash: string;
  experiment_id: string | null;
  variation_id: string | null;
  campaign_id: string | null;
  config_version: string;
  engine_latency_ms: number;
  demo_run_id: string | null;
}

/** Column order, exported so the writer and the test read the same list. */
export const BH_DECISION_COLUMNS: readonly (keyof BhDecisionRow)[] = [
  'decision_id',
  'ts',
  'visitor_id',
  'session_id',
  'slot_id',
  'page_type',
  'candidate_set',
  'chosen_item',
  'offer_code',
  'offer_label',
  'offer_window_start',
  'offer_window_end',
  'offer_lifecycle_state',
  'parent_event',
  'reveal_index',
  'gates_passed',
  'gates_failed',
  'pinned',
  'quota_reserved',
  'dimension_scores',
  'rank_score',
  'rank_position',
  'tie_break_hash',
  'experiment_id',
  'variation_id',
  'campaign_id',
  'config_version',
  'engine_latency_ms',
  'demo_run_id',
];

export function decisionRows(page: ComposedPage): BhDecisionRow[] {
  return page.decisions.map((d) => ({
    decision_id: d.decision_id,
    ts: page.nowMs,
    visitor_id: page.visitorId,
    session_id: page.sessionId,
    slot_id: d.slot_id,
    page_type: page.page,
    candidate_set: JSON.stringify(d.explain.candidate_set),
    chosen_item: d.item?.itemNumber ?? null,
    offer_code: d.offer?.code ?? null,
    offer_label: d.offer?.label ?? null,
    offer_window_start: d.offer?.windowStart ?? null,
    offer_window_end: d.offer?.windowEnd ?? null,
    offer_lifecycle_state: d.offer?.lifecycleState ?? null,
    parent_event: d.offer?.parentEvent ?? d.event?.id ?? null,
    reveal_index: d.offer?.revealIndex ?? d.event?.revealIndex ?? null,
    gates_passed: JSON.stringify(d.explain.gates_passed),
    gates_failed: JSON.stringify(d.explain.gates_failed),
    pinned: d.explain.pinned ? 1 : 0,
    quota_reserved: d.explain.quota_reserved ? 1 : 0,
    dimension_scores: JSON.stringify(d.explain.dimension_scores),
    rank_score: d.explain.rank_score,
    rank_position: d.explain.rank_position,
    tie_break_hash: d.explain.tie_break_hash,
    // Beat 13: the slot under test carries the platform's own ids — and only
    // once something is actually launched. Before that they stay null rather
    // than carrying a locally invented identifier their analysts could not join.
    experiment_id: d.experiment?.experiment_id ?? null,
    variation_id: d.experiment?.variation_id ?? null,
    campaign_id: d.experiment?.campaign_id ?? null,
    config_version: d.explain.config_version,
    engine_latency_ms: d.explain.engine_latency_ms,
    demo_run_id: page.demoRunId,
  }));
}

// ── Thin I/O wrapper (the only part that touches the outside) ────────────────

export interface ComposerEnv {
  DB?: D1Database;
  /** Offer Desk overlay store (`bh:offerdesk:*`) — absent ⇒ catalog only. */
  CACHE?: KVNamespace;
  BRIGHTHOUR_EPOCH_MS?: string;
  BRIGHTHOUR_CLOCK_MULTIPLIER?: string;
}

/** Compression factor for the demo clock. 1 = real time (the default). */
export function clockMultiplierOf(env?: ComposerEnv | null): number {
  const raw = Number(env?.BRIGHTHOUR_CLOCK_MULTIPLIER);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

interface CatalogBundle {
  epochMs: number;
  items: ComposerItem[];
  events: ComposerEvent[];
}

// One materialization per epoch per isolate. The epoch only moves at ET
// midnight (or never, when BRIGHTHOUR_EPOCH_MS pins it), so this is a single
// entry, replaced rather than accreted — the registry's own discipline.
let _bundle: CatalogBundle | null = null;

/**
 * Catalog items ∪ Offer Desk overlay, by id, overlay last.
 *
 * An approved item is NOT a special case downstream: it arrives here already
 * materialized by the catalog's own loader, so it meets the same gates, the
 * same ranking and the same expiry as a committed item. A committed item of the
 * same id is REPLACED (a merchandiser re-publishing an item means the desk's
 * version is the current one) — which is also why the merge is by id rather
 * than a blind concat: the composer must never see two occupants for one id.
 */
export function mergeOverlayItems(
  base: readonly ComposerItem[],
  overlay: readonly ComposerItem[]
): ComposerItem[] {
  if (overlay.length === 0) return base as ComposerItem[];
  const overlaid = new Set(overlay.map((i) => String(i.id ?? '')));
  return [...base.filter((i) => !overlaid.has(String(i.id ?? ''))), ...overlay];
}

/**
 * The materialized catalog for a request. Honors BRIGHTHOUR_EPOCH_MS (a
 * rehearsed run replays identically), which is why this does not borrow the
 * registry's cache — that accessor pins no epoch by design.
 *
 * The committed catalog is cached per epoch; the Offer Desk overlay is read
 * FRESH every call, because a merchandiser who just clicked Approve expects the
 * next page to have it (Beat 2c → 2d). No KV binding ⇒ no overlay ⇒ byte
 * identical to before the desk existed.
 */
export async function loadComposerCatalog(
  env: ComposerEnv | null | undefined,
  realNowMs: number
): Promise<CatalogBundle> {
  const { getEpochMs, loadBrighthourProducts, loadBrighthourEvents } = await import('./catalog');
  const epochMs = getEpochMs(env ?? null, realNowMs);
  if (!_bundle || _bundle.epochMs !== epochMs) {
    _bundle = {
      epochMs,
      items: loadBrighthourProducts(epochMs) as unknown as ComposerItem[],
      events: loadBrighthourEvents(epochMs) as unknown as ComposerEvent[],
    };
  }
  if (!env?.CACHE) return _bundle;
  const { overlayItems, listOverrides, applyAvailabilityOverrides } = await import('./offerDesk');
  const [overlay, overrides] = await Promise.all([
    overlayItems(env.CACHE, epochMs),
    listOverrides(env.CACHE),
  ]);
  if (overlay.length === 0 && overrides.size === 0) return _bundle;

  // Order matters: merge FIRST, override SECOND, so a desk-approved item can be
  // sold out on stage exactly like a committed one. Both are pure and neither
  // mutates the cached bundle — the committed catalog in this isolate is still
  // whatever the file says.
  const merged = mergeOverlayItems(_bundle.items, overlay as unknown as ComposerItem[]);
  return { ..._bundle, items: applyAvailabilityOverrides(merged, overrides) };
}

/**
 * Persist one row per slot decision into D1 `bh_decisions`.
 *
 * Called OFF the response path (ctx.waitUntil) and self-guarding, exactly like
 * captureDemoEvent: a D1 hiccup can never break a live demo, and capture adds
 * zero latency to the decision the shopper is waiting on.
 */
export async function writeDecisionRows(
  env: ComposerEnv | null | undefined,
  rows: readonly BhDecisionRow[]
): Promise<void> {
  try {
    if (!env?.DB || rows.length === 0) return;
    const placeholders = BH_DECISION_COLUMNS.map(() => '?').join(', ');
    const sql =
      `INSERT OR REPLACE INTO bh_decisions (${BH_DECISION_COLUMNS.join(', ')}) VALUES (${placeholders})`;
    const stmt = env.DB.prepare(sql);
    await env.DB.batch(
      rows.map((row) => stmt.bind(...BH_DECISION_COLUMNS.map((col) => row[col] ?? null)))
    );
  } catch (err) {
    console.error('writeDecisionRows failed (non-fatal):', err);
  }
}
