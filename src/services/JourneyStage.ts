// src/services/JourneyStage.ts
// Pure journey-stage detection (docs/architecture/05-demo-build-spec.md §2.4).
//
// A stage change is itself a personalization trigger: the engine calls deriveStage on each event,
// writes journey_stage onto the session, and — because journey_stage is also an audience attribute
// (see src/data/insights.json: early_journey_cold_start / mid_journey_considering) — re-runs
// SegmentProvider.fetchQualifiedSegments and broadcasts. No I/O here; fully deterministic.
//
// Thresholds mirror the synthetic data generator's journey_stage derivation EXACTLY
// (scripts/generate-synthetic-data.mjs) so a profile loaded from customers.json stays consistent
// with what we recompute live, and so the journey-stage audiences qualify as designed:
//   - late : a cart add or purchase this session       (cart_adds > 0 || purchases > 0)
//   - mid  : real consideration — deep browse / dwell / a wishlist add
//            (product_views >= 5 || category_dwell_ms > 120000 || product_views >= 2 || wishlist_adds > 0)
//   - early: anyone else (cold start / just landed)

//
// CW29 (2026-09-04, Tapestry's BTIE "journey stage", doc 26 D1): the rule is
// exported on its own as stageFromCounters(), so the content decision can call
// it from a shopper's counters on either host and put the stage on the context
// cell. deriveStage() is unchanged in behaviour; it is now that function applied
// to a QualificationContext. The stage names stay early / mid / late because
// they are already published as the journey_stage attribute and audience keys;
// STAGE_WORDS gives BTIE's names for the same three states.

import type { QualificationContext } from '@/connectors/types';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { isNewVisit } from '@/services/visit';

export type JourneyStage = 'early' | 'mid' | 'late';

/** BTIE's See / Think / Do, in its own words, for receipts and reports. */
export const STAGE_WORDS: Record<JourneyStage, 'exploring' | 'considering' | 'deciding'> = {
  early: 'exploring',
  mid: 'considering',
  late: 'deciding',
};

/** A stored or wire value as a stage, or null when it is not one. */
export function asStage(v: unknown): JourneyStage | null {
  return v === 'early' || v === 'mid' || v === 'late' ? v : null;
}

const MID_VIEWS = 2; // >= this many PDP views ⇒ at least considering
const DEEP_VIEWS = 5; // deep browse signal (also the mid_journey_considering audience floor)
const DEEP_DWELL_MS = 120_000; // 2 min on product content ⇒ considering

/**
 * The stage a shopper's counters put them in. Pure; the same rule the engine
 * has always applied per event, callable from anything that holds the counters.
 * Segments may pin a stage ahead of the counts, as before.
 */
export function stageFromCounters(
  counters: Record<string, unknown> | null | undefined,
  segments: readonly string[] | null | undefined = [],
): JourneyStage {
  const a = counters ?? {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const productViews = num(a.product_views);
  const categoryDwellMs = num(a.category_dwell_ms);
  const cartAdds = num(a.cart_adds);
  const wishlistAdds = num(a.wishlist_adds);
  const purchases = num(a.purchases);

  // Segments can pin a stage even before raw counts catch up (e.g. an Opal/seed audience that
  // already qualified the shopper as ready-to-buy / cart-abandoner).
  const segs = (segments ?? []).map((s) => String(s).toLowerCase());
  const segHas = (frag: string) => segs.some((s) => s.includes(frag));

  // LATE: real purchase intent — something is in the cart, or a buy happened, or a segment says so.
  if (cartAdds > 0 || purchases > 0 || segHas('ready_to_buy') || segHas('late_journey') || segHas('cart')) {
    return 'late';
  }

  // MID: actively considering — deep browse, long dwell, a couple of PDP views, or a wishlist add.
  if (
    productViews >= DEEP_VIEWS ||
    categoryDwellMs > DEEP_DWELL_MS ||
    productViews >= MID_VIEWS ||
    wishlistAdds > 0 ||
    segHas('considering') ||
    segHas('mid_journey')
  ) {
    return 'mid';
  }

  // EARLY: cold start / just landed.
  return 'early';
}

export function deriveStage(ctx: QualificationContext): JourneyStage {
  return stageFromCounters(ctx.attributes ?? {}, ctx.segments ?? []);
}

// ---------------------------------------------------------------------------
// W16 C4 — the journey the ENGINE REPORTS: one shared vocabulary, one published
// threshold set, over the counters of the CURRENT VISIT.
//
// Two grammars live side by side on purpose (R29, R32(2)):
//
//   REPORTED   exploring → thinking → deciding   (the customer's own words:
//              "exploring (seeing) → thinking → deciding",
//              docs/architecture/tapestry_requirements.txt line 148). This is
//              what the SDK hydrate, the personalization update, the decision
//              record and the receipt say.
//
//   PERSISTED  early | mid | late                (the stored cell token, the
//              learning ladder key `s=mid`, the `journey_stage` audience
//              attribute and the ODP profile field). Unchanged by C4, because
//              it is a persisted grammar people already key statistics on (W24).
//
// PERSISTED_STAGE below is the ONE mapping point between them. Nothing else
// translates; a reader that needs the stored token asks it.
//
// The thresholds are DATA, not constants: they ride the tenant's already
// published, versioned reflex document as its `journey` block (R32(1)), so both
// hosts and the content decision read one coherent set and a receipt can name
// the revision that derived the stage. `stageFromCounters` above is the older,
// cumulative, audience-facing rule and is deliberately left alone.
// ---------------------------------------------------------------------------

/** R29: the shared stage vocabulary the engine reports, in order. */
export const JOURNEY_STAGES = ['exploring', 'thinking', 'deciding'] as const;
export type JourneyWord = (typeof JOURNEY_STAGES)[number];

/** The vocabulary's first stage: where every shopper starts, with nothing counted. */
export const FIRST_JOURNEY_STAGE: JourneyWord = JOURNEY_STAGES[0];

/**
 * R32(2): the one mapping point from the reported vocabulary to the persisted
 * grammar. Whoever writes the cell, the ladder key or the stored stage maps
 * here; nobody derives the stored token a second way.
 */
export const PERSISTED_STAGE: Record<JourneyWord, JourneyStage> = {
  exploring: 'early',
  thinking: 'mid',
  deciding: 'late',
};

/** A stored or wire value as one of the three reported words, or null. */
export function journeyWordOf(value: unknown): JourneyWord | null {
  return typeof value === 'string' && (JOURNEY_STAGES as readonly string[]).includes(value) ? value as JourneyWord : null;
}

/** A reported word OR a stored token, as the stored token. Null when neither. */
export function persistedStageOf(value: unknown): JourneyStage | null {
  if (typeof value === 'string' && Object.hasOwn(PERSISTED_STAGE, value)) return PERSISTED_STAGE[value as JourneyWord];
  return asStage(value);
}

/** The counters one VISIT keeps. Visit-local: durable taste is a separate thing. */
export const JOURNEY_COUNTERS = ['interactions', 'product_views', 'purchases', 'cart_adds', 'wishlist_adds', 'category_dwell_ms'] as const;
export type JourneyCounter = (typeof JOURNEY_COUNTERS)[number];
export type JourneyCounters = Record<JourneyCounter, number>;

/** One published rule: the stage a visit reaches when ANY of its counters is met. */
export interface JourneyStageRule {
  stage: Exclude<JourneyWord, 'exploring'>;
  anyOf: Partial<Record<JourneyCounter, number>>;
}
/** The published threshold set: the `journey` block of the reflex document. */
export interface JourneyThresholds { stages: JourneyStageRule[] }

/**
 * THE COMPILED DEFAULT THRESHOLD SET (R49). It decides for a tenant that has
 * never published a `journey` block, exactly as the rest of
 * DEFAULT_REFLEX_CONFIG is the compiled default for a tenant that has never
 * tuned the engine. Reporting the first stage forever instead would make every
 * untuned tenant's cell permanently `early` and collapse the pooled learning
 * key to `s=early`, which is a worse lie than a documented default.
 *
 * The third interaction of a visit moves the stage (tapestry_requirements.txt
 * line 147, Time to Relevance: "3 clicks — site adapts third interaction
 * onwards") and a purchase is the deciding signal (admitted criterion C4).
 * Customer-neutral: counts of the shopper's own actions, no tenant's taxonomy
 * anywhere. A tenant that publishes a block overrides it wholesale, and a
 * published block that cannot be read is NOT replaced by this one — that fails
 * closed, because a tenant who tuned the journey did not ask for ours.
 */
export const DEFAULT_JOURNEY_THRESHOLDS: JourneyThresholds = {
  stages: [
    { stage: 'thinking', anyOf: { interactions: 3 } },
    { stage: 'deciding', anyOf: { purchases: 1 } },
  ],
};

/**
 * The version a decision names when the compiled default decided (lead ruling,
 * 2026-09-19): the version of the compiled default CONFIGURATION this threshold
 * set travels with, because the set is part of that document's defaults exactly
 * as τ, K and the dimension registry are. Reported at revision 0, so a reader
 * can always tell "the engine's own default decided this" from "the tenant's
 * revision 3 decided this" — the tenant's document version is never claimed for
 * thresholds it did not supply.
 */
export const DEFAULT_JOURNEY_THRESHOLDS_VERSION: string = DEFAULT_REFLEX_CONFIG.version;

/** A threshold nobody reaches is a tuning mistake, not a policy. */
const MAX_JOURNEY_THRESHOLD = 1_000_000_000;

/**
 * Every fault in a candidate `journey` block, not the first: a merchandiser
 * fixing a form should see the whole list once, as the reflex validator does.
 * An empty array means the block is publishable.
 */
export function validateJourneyThresholds(candidate: unknown, path = 'journey'): string[] {
  const errors: string[] = [];
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return [`${path} must be a JSON object naming the stages of the journey`];
  }
  const stages = (candidate as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return [`${path}.stages must be an array of stage rules`];
  // The vocabulary's first stage is the floor: it is where a shopper is before
  // anything is counted, so it never carries a threshold of its own.
  const ladder = JOURNEY_STAGES.slice(1);
  if (stages.length === 0) {
    errors.push(`${path}.stages must name at least one stage of ${ladder.join(' | ')}; an empty set derives nothing`);
  }
  let highest = -1;
  const named = new Set<string>();
  stages.forEach((raw, index) => {
    const at = `${path}.stages[${index}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`${at} must be an object with a stage and an anyOf threshold`);
      return;
    }
    const rule = raw as { stage?: unknown; anyOf?: unknown };
    const rank = typeof rule.stage === 'string' ? (ladder as readonly string[]).indexOf(rule.stage) : -1;
    if (rank === -1) {
      errors.push(`${at}.stage must be one of ${ladder.join(' | ')}: the shared vocabulary is ${JOURNEY_STAGES.join(' | ')} and its first stage "${FIRST_JOURNEY_STAGE}" is the floor every shopper starts in, so it carries no threshold (got ${JSON.stringify(rule.stage)})`);
    } else if (named.has(rule.stage as string)) {
      errors.push(`${at}.stage "${rule.stage as string}" is named twice; one threshold per stage`);
    } else if (rank <= highest) {
      errors.push(`${at}.stage "${rule.stage as string}" is out of order; the stages of the journey are listed in the order ${JOURNEY_STAGES.join(' → ')}`);
    } else {
      named.add(rule.stage as string);
      highest = rank;
    }
    if (typeof rule.anyOf !== 'object' || rule.anyOf === null || Array.isArray(rule.anyOf)) {
      errors.push(`${at}.anyOf must be an object of counter thresholds`);
      return;
    }
    const entries = Object.entries(rule.anyOf as Record<string, unknown>);
    if (entries.length === 0) {
      errors.push(`${at}.anyOf must name at least one counter threshold; a stage with no threshold can never be reached`);
    }
    for (const [counter, value] of entries) {
      if (!(JOURNEY_COUNTERS as readonly string[]).includes(counter)) {
        errors.push(`${at}.anyOf.${counter} is not a counter a visit keeps; the counters are ${JOURNEY_COUNTERS.join(', ')}`);
      } else if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${at}.anyOf.${counter} must be a finite number`);
      } else if (!Number.isInteger(value)) {
        errors.push(`${at}.anyOf.${counter} must be a whole number; a counted signal is not divisible (got ${value})`);
      } else if (value < 1) {
        errors.push(`${at}.anyOf.${counter} must be at least 1 (got ${value})`);
      } else if (value > MAX_JOURNEY_THRESHOLD) {
        errors.push(`${at}.anyOf.${counter} must be at most ${MAX_JOURNEY_THRESHOLD} (got ${value})`);
      }
    }
  });
  return errors;
}

/** The published set when it is publishable, else null — the caller fails closed. */
export function journeyThresholdsOf(candidate: unknown): JourneyThresholds | null {
  if (candidate === undefined || candidate === null) return null;
  return validateJourneyThresholds(candidate).length === 0 ? candidate as JourneyThresholds : null;
}

/** Any stored or wire shape as the six counters. Absent or nonsense counts as zero. */
export function journeyCountersOf(value: unknown): JourneyCounters {
  const raw = (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    interactions: num(raw.interactions), product_views: num(raw.product_views), purchases: num(raw.purchases),
    cart_adds: num(raw.cart_adds), wishlist_adds: num(raw.wishlist_adds), category_dwell_ms: num(raw.category_dwell_ms),
  };
}

/** The retail action an event names. The rule of contentTelemetry.ts:77, inlined to keep this module dependency-free. */
function journeyActionOf(event: { type?: unknown; data?: unknown }): string {
  const data = (event.data !== null && typeof event.data === 'object' ? event.data : {}) as Record<string, unknown>;
  for (const key of ['action', 'eventName', 'event'] as const) {
    const v = data[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return typeof event.type === 'string' ? event.type : '';
}

/** The same families the attribute reducer counts (RealtimeSegmentEngine.applyEventToAttributes). */
const VIEW_ACTIONS = new Set(['product_view', 'pdp_view', 'view_product']);
const CART_ACTIONS = new Set(['add_to_cart', 'cart_add']);
const WISHLIST_ACTIONS = new Set(['wishlist', 'wishlist_add', 'add_to_wishlist', 'save_for_later']);
const PURCHASE_ACTIONS = new Set(['purchase', 'checkout', 'order_complete']);
/**
 * Not interactions of a visit. A `tick` is time passing, and a content
 * impression is dense and involuntary — the engine already weighs it zero
 * (src/reflex/core.ts, DEFAULT_REFLEX_CONFIG.weights.content_impression), so it
 * must not read as a shopper doing something either.
 */
const UNCOUNTED_ACTIONS = new Set(['tick', 'content_impression']);

/**
 * The visit's counters after one delivered event. Pure, and the only place an
 * event becomes a journey counter, so both hosts count identically.
 *
 * A BUFFERED delivery is never a fresh interaction of the visit it arrives in
 * (settled decision D06-buffered-action-purpose, HANDOFF-2026-09-18 §7): it
 * carries age-decayed interest from a browsing session that has already ended,
 * and counting it would let a replay move a stage the shopper never reached.
 */
export function visitJourneyCounters(previous: unknown, event: unknown): JourneyCounters {
  const counters = journeyCountersOf(previous);
  const e = (event !== null && typeof event === 'object' ? event : {}) as { type?: unknown; data?: unknown; processing?: unknown };
  if (e.processing === 'buffered') return counters;
  const action = journeyActionOf(e);
  if (action === '' || UNCOUNTED_ACTIONS.has(action)) return counters;
  const data = (e.data !== null && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
  const next: JourneyCounters = { ...counters, interactions: counters.interactions + 1 };
  if (VIEW_ACTIONS.has(action)) next.product_views += 1;
  else if (CART_ACTIONS.has(action)) next.cart_adds += 1;
  else if (WISHLIST_ACTIONS.has(action)) next.wishlist_adds += 1;
  else if (PURCHASE_ACTIONS.has(action)) next.purchases += 1;
  if (typeof data.dwellMs === 'number' && Number.isFinite(data.dwellMs) && data.dwellMs > 0) next.category_dwell_ms += data.dwellMs;
  return next;
}

/**
 * The stage these counters are in under this published threshold set: the
 * furthest stage whose rule is met, and the vocabulary's first stage when none
 * is. An absent, malformed or unpublished set derives the first stage — the
 * engine never invents a threshold.
 */
export function journeyStageFrom(counters: unknown, thresholds: unknown): JourneyWord {
  const set = journeyThresholdsOf(thresholds);
  if (!set) return FIRST_JOURNEY_STAGE;
  const counted = journeyCountersOf(counters);
  let stage: JourneyWord = FIRST_JOURNEY_STAGE;
  for (const rule of set.stages) {
    const met = Object.entries(rule.anyOf).some(([counter, threshold]) =>
      typeof threshold === 'number' && counted[counter as JourneyCounter] >= threshold);
    if (met && JOURNEY_STAGES.indexOf(rule.stage) > JOURNEY_STAGES.indexOf(stage)) stage = rule.stage;
  }
  return stage;
}

/**
 * The visit-local journey a host stores beside — never inside — the durable
 * taste vector. `closed` is set by the purchase that counted in its own
 * decision: the decision made ON the purchase event sees the purchase, and the
 * NEXT one starts again from zero, once that decision and its attribution have
 * been captured (criterion C4, R32(3)).
 */
export interface VisitJourney {
  counters: JourneyCounters;
  closed?: boolean;
}

/**
 * The counters the next derivation starts from. Non-mutating, so a READ crosses
 * the visit boundary exactly as `projectVisit` does: a visit that ended takes
 * its counters with it while the visit number and the cumulative taste — which
 * are not the journey's to reset — carry on.
 */
export function journeyCountersNow(
  stored: unknown, lastSeenMs: number | null | undefined, nowMs: number,
): JourneyCounters {
  if (isNewVisit(lastSeenMs, nowMs)) return journeyCountersOf(null);
  const record = (stored !== null && typeof stored === 'object' ? stored : null) as VisitJourney | null;
  if (!record || record.closed === true) return journeyCountersOf(null);
  return journeyCountersOf(record.counters);
}

/** The stored journey after one delivered event, from whichever host took it. */
export function advanceVisitJourney(
  stored: unknown, lastSeenMs: number | null | undefined, nowMs: number, event: unknown,
): VisitJourney {
  const counters = visitJourneyCounters(journeyCountersNow(stored, lastSeenMs, nowMs), event);
  return counters.purchases > 0 ? { counters, closed: true } : { counters };
}

/** What a host reports and what it stores, from one derivation. */
export interface ReportedJourney {
  /** The shared word (R29). */
  stage: JourneyWord;
  /** The revision identity of the threshold set that derived it; null when none was in force. */
  version: string | null;
  /** The published revision, 0 when none was in force. */
  revision: number;
  /** Why no threshold set was used, for the diagnostic on the answer. Null when one was. */
  reason: string | null;
}

/** R49: the tenant published no block at all, so the engine's own default decided. */
export const JOURNEY_COMPILED_DEFAULT =
  `no journey thresholds are published for this tenant, so the compiled default journey thresholds of configuration "${DEFAULT_JOURNEY_THRESHOLDS_VERSION}" decided this stage at revision 0; publish a journey block on the reflex configuration document to tune it`;
/** A stored block the validator cannot read: fail closed, never substitute another tenant's tuning. */
export const JOURNEY_BLOCK_UNUSABLE =
  'the journey block published on the reflex document cannot be read, so the engine failed closed to the first stage of the journey and used no threshold version';

/**
 * The threshold set actually in force for a reflex document, and the provenance
 * a decision reports for it. ONE function, so no surface can drift:
 *
 *   • a valid published block  → that block, named by the document's own
 *     revision identity (R32(1): the thresholds ARE part of that document);
 *   • no block at all          → the compiled default at revision 0 (R49),
 *     named by its own version, with a diagnostic that says so;
 *   • a block that will not    → nothing. The stage falls closed to the first
 *     validate                   of the journey and no version is claimed.
 */
export function journeySource(
  document: { journey?: unknown; version?: string } | null | undefined,
  revision: number,
): { thresholds: JourneyThresholds | null; version: string | null; revision: number; reason: string | null } {
  const block = document?.journey;
  if (block === undefined || block === null) {
    return { thresholds: DEFAULT_JOURNEY_THRESHOLDS, version: DEFAULT_JOURNEY_THRESHOLDS_VERSION, revision: 0, reason: JOURNEY_COMPILED_DEFAULT };
  }
  const published = journeyThresholdsOf(block);
  return published
    ? { thresholds: published, version: document?.version ?? null, revision, reason: null }
    : { thresholds: null, version: null, revision: 0, reason: JOURNEY_BLOCK_UNUSABLE };
}

/** The set in force, for a caller that needs only the stage. */
export function journeyThresholdsInForce(document: { journey?: unknown } | null | undefined): JourneyThresholds | null {
  return journeySource(document, 0).thresholds;
}

/**
 * One derivation, used by every reporting surface so the hosts cannot drift:
 * the counters of the current visit read against the set in force, with the
 * version a receipt names and the diagnostic when the tenant published none.
 */
export function reportJourney(
  counters: unknown,
  document: { journey?: unknown; version?: string } | null | undefined,
  revision: number,
): ReportedJourney {
  const source = journeySource(document, revision);
  return { stage: journeyStageFrom(counters, source.thresholds), version: source.version, revision: source.revision, reason: source.reason };
}
