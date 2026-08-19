// src/demos/brighthour/offerLifecycle.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Bright Hour — offer-lifecycle engine (brief §3 item 1: THE centerpiece).
//
// "You didn't build a campaign. You published an item with a start time and an
//  end time. Your product data already has that field. We made the page read it."
//
// The offer window is a first-class field on the ITEM (recon §A4) — start/end
// timestamps that QVC's own product API already ships and their CMS ignores.
// This module is everything that follows from taking that field seriously:
//
//   • lifecycleStateAt()   — their own state names (tsvprev / tsvprelaunch /
//                            tsvpresale / tsvpostsale, §A5) plus live/ending/expired
//   • resolveRevealWindow  — the nested staggered reveal ("120 Hours of Deals":
//                            5 days with 3-hour reveals inside, §A13)
//   • evaluateGates()      — precedence step 1 (§C2) with §C3's published rules;
//                            the gate names ARE the strings the explain record
//                            and the export row carry (Beat 7, Beat 14)
//   • nextOccupantFor()    — succession: old offer expires at T, queued offer
//                            takes the slot at T. No gap, no overlap, no human (Beat 2f)
//   • nextTransitionAt()   — CLOSED-FORM soonest boundary. Scheduling consumes
//                            this; it is exact, never polled — the same discipline
//                            as ReflexCore.nextCrossing()
//   • windowLanguage()     — §A6/§D2 doctrine: window state as LANGUAGE, never a
//                            clock. No countdowns, no scarcity, no social proof
//
// House discipline (src/reflex/core.ts): pure functions, no I/O, `now` is always
// a parameter, nothing mutates on a timer, replays are deterministic.
//
// Types are structural on purpose. The catalog's richer item type (./types,
// owned elsewhere) satisfies these interfaces without an import — the engine
// stays catalog-agnostic, exactly as the reflex core is.
// ─────────────────────────────────────────────────────────────────────────────

import { slugValue } from '../../reflex/core';
import {
  MS_PER_HOUR,
  nextEtMidnightAfter,
  toIso,
  toMs,
  type Instant,
} from './demoClock';

export type { Instant };

// ── Lifecycle vocabulary ─────────────────────────────────────────────────────

/**
 * Mirrors QVC's own badge codes (`tsvprev`, `tsvprelaunch`, `tsvpresale`,
 * `tsvpostsale` — recon §A5, confirmed three independent ways) plus the three
 * states their codes imply but don't name: live, ending_today, expired.
 */
export type LifecycleState =
  | 'preview'
  | 'prelaunch'
  | 'presale'
  | 'live'
  | 'ending_today'
  | 'postsale'
  | 'expired';

export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  'preview',
  'prelaunch',
  'presale',
  'live',
  'ending_today',
  'postsale',
  'expired',
];

/** Lifecycle states in which a slot may actually be occupied (§C2 step 1). */
export const OPEN_STATES: readonly LifecycleState[] = ['live', 'ending_today'];

// ── Structural shapes (the catalog satisfies these; no import needed) ────────

export interface OfferWindowLike {
  windowStart?: Instant;
  windowEnd?: Instant;
}

export interface OfferLike extends OfferWindowLike {
  /** Construct code — drives badge style and slot identity: TBO, BH2, EVT120, LHS… (§B4). */
  code?: string | null;
  /** Merchandiser-authored label — "Today's Bright One". Style from code, text from label (§A5). */
  label?: string | null;
  /** daily_deal | limited_time_event | on_air | one_time_only | web_exclusive | clearance | final_sale | evergreen. */
  type?: string | null;
  /** Only flagged offers get the presale lead — QVC's `tsvpresale`/`/*APTSV*` construct (§A4). */
  presaleEligible?: boolean | null;
  /** Parent event id for a nested staggered reveal (§A13 "120 Hours of Deals"). */
  parentEvent?: string | null;
  /** This item's index within the parent event's reveal ladder. */
  revealIndex?: number | null;
  /** Set on a PARENT event: how often a nested reveal turns over (e.g. 3h). */
  revealCadenceMs?: number | null;
  /** Optional child window length; defaults to the cadence (back-to-back reveals). */
  revealDurationMs?: number | null;
}

export interface OfferItemLike {
  itemNumber?: string | null;
  offer?: OfferLike | null;
  /** Their real machine model: ats ∈ Y | N | W (§A6). */
  availability?: { ats?: string | null } | null;
  pricing?: { brightPay?: unknown; specialFinancing?: unknown } | null;
  /** standard | final_sale (non-returnable — an eligibility constraint, §C3). */
  returnPolicy?: string | null;
}

// ── Lifecycle tuning ─────────────────────────────────────────────────────────

export interface LifecycleConfig {
  /** How long before windowStart the offer becomes visible on preview surfaces. */
  previewLeadMs: number;
  /** …becomes `prelaunch`. */
  prelaunchLeadMs: number;
  /** …becomes `presale`, for offers flagged presaleEligible only. */
  presaleLeadMs: number;
  /** Tail of the window that reads `ending_today`. */
  endingSoonMs: number;
  /** How long after windowEnd the offer lingers as `postsale` before `expired`. */
  postsaleTailMs: number;
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  previewLeadMs: 24 * MS_PER_HOUR,
  prelaunchLeadMs: 6 * MS_PER_HOUR,
  presaleLeadMs: 2 * MS_PER_HOUR,
  endingSoonMs: 4 * MS_PER_HOUR,
  postsaleTailMs: 2 * MS_PER_HOUR,
};

// ── Lifecycle state ──────────────────────────────────────────────────────────

/**
 * The offer's lifecycle state at `now`. Pure function of (window, now, config) —
 * nothing is stored, nothing ticks; the state is *derived*, exactly as the
 * reflex core derives affinity from a raw score and elapsed time.
 *
 * Windowless offers (evergreen, one_time_only "until gone") are `live`; whether
 * they can actually be served is the availability gate's job, not the clock's.
 *
 * `preview` is the left-terminal state: an offer authored months out reads
 * `preview` too. `previewLeadMs` governs *visibility* on preview surfaces —
 * see isPreviewVisibleAt() — not the state name.
 */
export function lifecycleStateAt(
  offer: OfferLike | null | undefined,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): LifecycleState {
  const start = toMs(offer?.windowStart);
  const end = toMs(offer?.windowEnd);

  if (start === null && end === null) return 'live'; // evergreen / one_time_only

  if (end !== null) {
    if (nowMs >= end + cfg.postsaleTailMs) return 'expired';
    if (nowMs >= end) return 'postsale';
  }

  if (start === null || nowMs >= start) {
    if (end !== null && nowMs >= end - cfg.endingSoonMs) return 'ending_today';
    return 'live';
  }

  if (offer?.presaleEligible && nowMs >= start - cfg.presaleLeadMs) return 'presale';
  if (nowMs >= start - cfg.prelaunchLeadMs) return 'prelaunch';
  return 'preview';
}

/** Is the offer visible on preview surfaces yet (the Offer Desk's queued tray, Beat 2)? */
export function isPreviewVisibleAt(
  offer: OfferLike | null | undefined,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): boolean {
  const start = toMs(offer?.windowStart);
  if (start === null) return true; // evergreen — always on the shelf
  return nowMs >= start - cfg.previewLeadMs;
}

/** True while the offer may occupy a slot (§C2 step 1: lifecycle ∈ {live, ending_today}). */
export function isWindowOpenAt(
  offer: OfferLike | null | undefined,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): boolean {
  const state = lifecycleStateAt(offer, nowMs, cfg);
  return state === 'live' || state === 'ending_today';
}

// ── Nested staggered reveals (§A13 "120 Hours of Deals") ─────────────────────

export interface RevealWindow {
  revealIndex: number;
  windowStart: string;
  windowEnd: string;
  startMs: number;
  endMs: number;
  /** True when the parent window truncated this reveal (the last one, usually). */
  clamped: boolean;
}

/**
 * The child window of reveal `revealIndex` inside a parent event:
 *   start = parentStart + index · cadence,  duration = revealDurationMs ?? cadence
 * Both ends clamp into the parent window — a reveal can never outlive its event,
 * which is precisely what makes Beat 2f's "the next reveal takes over *without
 * the parent event changing*" true by construction.
 */
export function resolveRevealWindow(
  parent: OfferWindowLike,
  revealIndex: number,
  cadenceMs: number,
  revealDurationMs?: number
): RevealWindow {
  const parentStart = toMs(parent?.windowStart);
  if (parentStart === null) throw new TypeError('resolveRevealWindow: parent.windowStart is required');
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) {
    throw new TypeError(`resolveRevealWindow: cadenceMs must be > 0, got ${String(cadenceMs)}`);
  }
  const duration = revealDurationMs ?? cadenceMs;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new TypeError(`resolveRevealWindow: revealDurationMs must be >= 0, got ${String(revealDurationMs)}`);
  }

  const parentEnd = toMs(parent?.windowEnd);
  const index = Math.trunc(revealIndex);
  const rawStart = parentStart + index * cadenceMs;
  const rawEnd = rawStart + duration;

  let startMs = Math.max(parentStart, rawStart);
  let endMs = Math.max(startMs, rawEnd);
  if (parentEnd !== null) {
    startMs = Math.min(startMs, parentEnd);
    endMs = Math.min(Math.max(endMs, startMs), parentEnd);
  }

  return {
    revealIndex: index,
    startMs,
    endMs,
    windowStart: toIso(startMs),
    windowEnd: toIso(endMs),
    clamped: startMs !== rawStart || endMs !== rawEnd,
  };
}

/**
 * Which reveal is current at `now`, or null outside the parent window.
 * Half-open [parentStart, parentEnd) — the same convention lifecycleStateAt uses,
 * so an event's last reveal and its `postsale` begin on the same millisecond.
 */
export function currentRevealIndex(
  parent: OfferWindowLike,
  cadenceMs: number,
  nowMs: number
): number | null {
  const parentStart = toMs(parent?.windowStart);
  if (parentStart === null || !Number.isFinite(cadenceMs) || cadenceMs <= 0) return null;
  const parentEnd = toMs(parent?.windowEnd);
  if (nowMs < parentStart) return null;
  if (parentEnd !== null && nowMs >= parentEnd) return null;
  return Math.floor((nowMs - parentStart) / cadenceMs);
}

/** How many reveals the parent window holds — the "40" in "reveal 7 of 40". */
export function revealCount(parent: OfferWindowLike, cadenceMs: number): number | null {
  const parentStart = toMs(parent?.windowStart);
  const parentEnd = toMs(parent?.windowEnd);
  if (parentStart === null || parentEnd === null) return null;
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) return null;
  return Math.max(0, Math.ceil((parentEnd - parentStart) / cadenceMs));
}

// ── Eligibility gates (§C2 step 1 · §C3 business rules) ──────────────────────

export const GATE_WINDOW_OPEN = 'window_open';
export const GATE_AVAILABILITY = 'availability';
export const GATE_VIP_OFFER_EXCLUSION = 'vip_offer_exclusion';
export const GATE_FINANCING_CONFLICT = 'financing_conflict';
export const GATE_CHANNEL = 'channel';

/** Evaluation order — deterministic, and the order the explain record reads in. */
export const GATE_ORDER: readonly string[] = [
  GATE_WINDOW_OPEN,
  GATE_AVAILABILITY,
  GATE_VIP_OFFER_EXCLUSION,
  GATE_FINANCING_CONFLICT,
  GATE_CHANNEL,
];

/**
 * Gates that suppress a DISPLAY element rather than the item. §C3: Easy Pay and
 * QCard Special Financing are mutually exclusive — that removes an installment
 * line, it does not remove the product from the slot.
 */
export const DISPLAY_GATES: readonly string[] = [GATE_FINANCING_CONFLICT];

/** §C3's published VIP-offer exclusion roster, normalized to six reason tokens. */
export type VipExclusionReason =
  | 'as_is'
  | 'clearance'
  | 'clearance_sale'
  | 'final_sale'
  | 'last_chance'
  | 'lunch';

const VIP_TYPE_TO_REASON: Record<string, VipExclusionReason> = {
  as_is: 'as_is',
  asis: 'as_is',
  clearance: 'clearance',
  clearance_sale: 'clearance_sale',
  final_sale: 'final_sale',
  last_chance: 'last_chance',
  lunch: 'lunch',
  lunch_hour_steals: 'lunch',
  lunchtime_special: 'lunch',
  lunchtime_specials: 'lunch',
};

const VIP_CODE_TO_REASON: Record<string, VipExclusionReason> = {
  ASIS: 'as_is',
  AS_IS: 'as_is',
  CLR: 'clearance',
  CLR_S: 'clearance_sale',
  FIN_S: 'final_sale',
  LC: 'last_chance',
  LHS: 'lunch',
};

export interface GateContext {
  /** A VIP savings event is running — the §C3 exclusion roster applies. */
  vipOfferActive?: boolean;
  /** Serving channel; 'web' when omitted. Placeholder until channel ctx is threaded. */
  channel?: string;
  /** Lifecycle tuning for the window gate. */
  cfg?: LifecycleConfig;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  /** Machine-readable reason token when failed — 'final_sale', 'expired', 'sold_out'… */
  reason: string | null;
  /** Display-only gate: it suppresses an element, never the item. */
  display: boolean;
}

export interface GateEvaluation {
  eligible: boolean;
  /** Bare gate names, e.g. ['window_open','availability'] — export row `gates_passed[]`. */
  gatesPassed: string[];
  /** `name (reason)` — e.g. 'vip_offer_exclusion (final_sale)' (Beat 14). */
  gatesFailed: string[];
  /** Display elements a display-gate turned off, e.g. ['brightPay']. */
  displaySuppressed: string[];
  /** Full per-gate detail for the glass box. */
  results: GateResult[];
  lifecycleState: LifecycleState;
}

function token(v: unknown): string {
  return typeof v === 'string' ? slugValue(v) : '';
}

function code(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : '';
}

/** Which §C3 roster entry (if any) makes this item ineligible during a VIP offer. */
export function vipExclusionReason(item: OfferItemLike): VipExclusionReason | null {
  const byType = VIP_TYPE_TO_REASON[token(item.offer?.type)];
  if (byType) return byType;
  const byCode = VIP_CODE_TO_REASON[code(item.offer?.code)];
  if (byCode) return byCode;
  if (token(item.returnPolicy) === 'final_sale') return 'final_sale'; // non-returnable (§C3)
  return null;
}

function isWebExclusive(item: OfferItemLike): boolean {
  return token(item.offer?.type) === 'web_exclusive' || code(item.offer?.code) === 'WEB';
}

/**
 * Precedence step 1: run EVERY gate, report all of them. No short-circuit —
 * a glass box that stops at the first failure isn't a glass box (Beat 14).
 *
 * ★ The engineered moment: a high-affinity Final Sale item during a VIP offer
 * fails with `vip_offer_exclusion (final_sale)` — the engine refusing to serve
 * something the visitor would probably have clicked, because merchandising
 * rules outrank the model.
 */
export function evaluateGates(
  item: OfferItemLike,
  nowMs: number,
  ctx: GateContext = {}
): GateEvaluation {
  const cfg = ctx.cfg ?? DEFAULT_LIFECYCLE_CONFIG;
  const results: GateResult[] = [];
  const displaySuppressed: string[] = [];

  // 1. window_open — the offer window is the gate (§A4, §C2).
  const lifecycleState = lifecycleStateAt(item.offer, nowMs, cfg);
  const windowOpen = lifecycleState === 'live' || lifecycleState === 'ending_today';
  results.push({
    gate: GATE_WINDOW_OPEN,
    passed: windowOpen,
    reason: windowOpen ? null : lifecycleState,
    display: false,
  });

  // 2. availability — their real Y|N|W machine model (§A6). Absent → sellable.
  const ats = code(item.availability?.ats) || 'Y';
  const available = ats === 'Y' || ats === 'W';
  results.push({
    gate: GATE_AVAILABILITY,
    passed: available,
    reason: available ? null : ats === 'N' ? 'sold_out' : `ats_${slugValue(ats)}`,
    display: false,
  });

  // 3. vip_offer_exclusion — §C3's published non-discountable roster.
  const vipReason = ctx.vipOfferActive ? vipExclusionReason(item) : null;
  results.push({
    gate: GATE_VIP_OFFER_EXCLUSION,
    passed: vipReason === null,
    reason: vipReason,
    display: false,
  });

  // 4. financing_conflict — DISPLAY gate. Special Financing and Bright Pay are
  //    mutually exclusive (§C3); financing wins and the installment line is
  //    suppressed. The item stays eligible.
  const hasFinancing = item.pricing?.specialFinancing != null;
  const hasBrightPay = item.pricing?.brightPay != null;
  const financingConflict = hasFinancing && hasBrightPay;
  if (financingConflict) displaySuppressed.push('brightPay');
  results.push({
    gate: GATE_FINANCING_CONFLICT,
    passed: !financingConflict,
    reason: financingConflict ? 'special_financing' : null,
    display: true,
  });

  // 5. channel — web_exclusive is fine on web; placeholder for other channels.
  const channel = ctx.channel ?? 'web';
  const channelOk = !isWebExclusive(item) || channel === 'web';
  results.push({
    gate: GATE_CHANNEL,
    passed: channelOk,
    reason: channelOk ? null : 'web_exclusive',
    display: false,
  });

  const gatesPassed = results.filter((r) => r.passed).map((r) => r.gate);
  const gatesFailed = results.filter((r) => !r.passed).map((r) => `${r.gate} (${r.reason})`);
  const eligible = results.every((r) => r.passed || r.display);

  return { eligible, gatesPassed, gatesFailed, displaySuppressed, results, lifecycleState };
}

// ── Succession (Beat 2f: expiry → the next offer flows in) ───────────────────

/** Items with no offer code group here — the composer's evergreen discovery pool. */
export const UNCODED_CONSTRUCT = 'NONE';

/** Slot construct an item belongs to: TBO, BH2, EVT120, LHS… (§B4). */
export function constructCodeOf(item: OfferItemLike): string {
  return code(item.offer?.code) || UNCODED_CONSTRUCT;
}

/**
 * Every eligible item at `now`, grouped by slot construct. Input order is
 * preserved inside each group so downstream ranking is deterministic.
 */
export function activeOffersAt<T extends OfferItemLike>(
  items: readonly T[],
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
  ctx: GateContext = {}
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of items) {
    if (!evaluateGates(item, nowMs, { ...ctx, cfg }).eligible) continue;
    const key = constructCodeOf(item);
    (grouped[key] = grouped[key] ?? []).push(item);
  }
  return grouped;
}

/**
 * The occupant of a takeover slot (TBO, BH2) at `now`: the eligible item whose
 * window contains now, or null.
 *
 * Windowless items are deliberately NOT candidates — the slot's evergreen
 * fallback is the composer's decision (recon §B2: "every category carries both
 * a timely offer and an evergreen fallback"), not this function's.
 *
 * Tie-break for a malformed catalog with overlapping windows: the freshest
 * start wins, then the lower itemNumber. Deterministic and replayable — the
 * same property the reflex core guarantees.
 */
export function nextOccupantFor<T extends OfferItemLike>(
  constructCode: string,
  items: readonly T[],
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
  ctx: GateContext = {}
): T | null {
  const wanted = code(constructCode);
  let best: T | null = null;
  let bestStart = -Infinity;
  let bestKey = '';

  for (const item of items) {
    if (constructCodeOf(item) !== wanted) continue;
    const start = toMs(item.offer?.windowStart);
    const end = toMs(item.offer?.windowEnd);
    if (start === null && end === null) continue; // evergreen fallback — composer's job
    if (!evaluateGates(item, nowMs, { ...ctx, cfg }).eligible) continue;

    const startKey = start ?? -Infinity;
    const itemKey = String(item.itemNumber ?? '');
    if (best === null || startKey > bestStart || (startKey === bestStart && itemKey < bestKey)) {
      best = item;
      bestStart = startKey;
      bestKey = itemKey;
    }
  }
  return best;
}

// ── Closed-form next transition (what scheduling consumes) ───────────────────

/**
 * Everything about an item that a scheduler must react to, as one comparable
 * string: its lifecycle state, its preview visibility, and — for a parent event —
 * which nested reveal is current. If this string is unchanged, nothing on the
 * page needs to change.
 */
export function lifecycleSignatureAt(
  item: OfferItemLike,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): string {
  const offer = item.offer ?? null;
  const state = lifecycleStateAt(offer, nowMs, cfg);
  const visible = isPreviewVisibleAt(offer, nowMs, cfg) ? 'v' : '-';
  const cadence = offer?.revealCadenceMs ?? null;
  if (!cadence || !Number.isFinite(cadence) || cadence <= 0) return `${visible}|${state}`;
  return `${visible}|${state}|${currentRevealIndex(offer ?? {}, cadence, nowMs)}`;
}

/** Candidate boundary instants for one item — every breakpoint of the state functions. */
function boundaryCandidates(item: OfferItemLike, nowMs: number, cfg: LifecycleConfig): number[] {
  const offer = item.offer;
  if (!offer) return [];
  const start = toMs(offer.windowStart);
  const end = toMs(offer.windowEnd);
  const out: number[] = [];

  if (start !== null) {
    out.push(start - cfg.previewLeadMs, start - cfg.prelaunchLeadMs, start);
    if (offer.presaleEligible) out.push(start - cfg.presaleLeadMs);

    const cadence = offer.revealCadenceMs ?? null;
    if (cadence && Number.isFinite(cadence) && cadence > 0 && nowMs >= start) {
      // The next reveal rollover strictly after now.
      const next = start + (Math.floor((nowMs - start) / cadence) + 1) * cadence;
      if (end === null || next < end) out.push(next);
    }
  }
  if (end !== null) out.push(end - cfg.endingSoonMs, end, end + cfg.postsaleTailMs);

  return out;
}

/**
 * The soonest instant strictly after `now` at which this item's signature
 * changes, or null. Closed form — every candidate is verified to be a real
 * transition (signature at b differs from signature at b−1), so the answer is
 * exact in both directions: nothing changes before it, something changes at it.
 */
export function nextTransitionForItem(
  item: OfferItemLike,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): number | null {
  let best: number | null = null;
  for (const raw of boundaryCandidates(item, nowMs, cfg)) {
    const at = Math.round(raw);
    if (at <= nowMs) continue;
    if (best !== null && at >= best) continue;
    if (lifecycleSignatureAt(item, at, cfg) === lifecycleSignatureAt(item, at - 1, cfg)) continue;
    best = at;
  }
  return best;
}

/**
 * The soonest future lifecycle boundary across the whole catalog — window
 * starts/ends, lead boundaries and nested-reveal rollovers alike.
 *
 * This is the alarm time. It is computed, not polled: the same closed-form
 * discipline as ReflexCore.nextCrossing(), which is what makes expiry and
 * succession land on the exact millisecond instead of "within 30 seconds".
 */
export function nextTransitionAt(
  items: readonly OfferItemLike[],
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): number | null {
  let earliest: number | null = null;
  for (const item of items) {
    const at = nextTransitionForItem(item, nowMs, cfg);
    if (at !== null && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest;
}

// ── Window language (§A6 doctrine: language, never a clock) ──────────────────

export type WindowLanguage = 'One-Day Price' | 'Ends Today' | 'Last Hours';

/** The COMPLETE shopper-facing window vocabulary. Nothing else is ever returned. */
export const WINDOW_LANGUAGE_VALUES: readonly WindowLanguage[] = [
  'One-Day Price',
  'Ends Today',
  'Last Hours',
];

// DST-tolerant: an ET calendar day is 23h, 24h or 25h long (§A13's 49-hour event
// exists precisely because someone at QVC noticed).
const ONE_DAY_MIN_MS = 23 * MS_PER_HOUR;
const ONE_DAY_MAX_MS = 25 * MS_PER_HOUR;

/**
 * How the window is expressed to the shopper — and only ever as language.
 *
 * QVC deliberately hides its own TSV countdown, ships no scarcity counters and
 * no social proof (§A6, four independent evidence lines). The ladder is
 * `null → One-Day Price → Ends Today → Last Hours` (§D2). A countdown string
 * or "Almost Gone"-class vocabulary is not reachable from this function.
 *
 * The presenter's ops panel gets the real ticking clock; the shopper never does.
 */
export function windowLanguage(
  offer: OfferLike | null | undefined,
  nowMs: number,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): WindowLanguage | null {
  const state = lifecycleStateAt(offer, nowMs, cfg);
  if (state !== 'live' && state !== 'ending_today') return null;

  const end = toMs(offer?.windowEnd);
  if (end === null) return null; // evergreen / one_time_only — no time framing at all

  const remaining = end - nowMs;
  if (remaining < cfg.endingSoonMs / 2) return 'Last Hours';
  if (state === 'ending_today' && end <= nextEtMidnightAfter(nowMs)) return 'Ends Today';

  const start = toMs(offer?.windowStart);
  if (start !== null) {
    const duration = end - start;
    if (duration >= ONE_DAY_MIN_MS && duration <= ONE_DAY_MAX_MS) return 'One-Day Price';
  }
  return null;
}
