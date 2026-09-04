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
