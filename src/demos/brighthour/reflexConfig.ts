// src/demos/brighthour/reflexConfig.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Bright Hour dimension registry — the nine axes of recon §C1, expressed in
// the exact shape src/reflex/core.ts already consumes (DimensionSpec, with
// per-dimension τ / K / θin / θout overrides).
//
// TWO-SPEED DECISIONING IS STRUCTURAL, NOT COSMETIC. Dimensions 3, 4 and 7
// (brandPersonality, priceBand, hostAffinity — τ 240–300s demo / 21–45d prod)
// are the durable profile: taste, price posture, parasocial loyalty. Dimensions
// 6 and 8 (urgencyResponsiveness, sessionMission — τ 30–45s) are tonight. Same
// engine, same math, different τ. ONE config file, not two systems.
//
// BOTH τ SETS SHIP. DEMO_TAUS plays the arithmetic at room pace (a meter visibly
// crosses θin in three interactions, ~15 seconds); PROD_TAUS is what a real
// deployment would run (days and weeks). Publishing both is the credibility
// move: nothing here is a demo-only trick, only a demo-only *rate*.
//
// TUNING IS NEVER A REDEPLOY (§C4 Beat 14): a ReflexConfig is data. Change a τ
// in KV, reload, and behaviour changes with the config version stamped on every
// explain record.
//
// Audience-key namespacing ('bh_') is applied by demos/registry.ts, not here —
// this file describes the axes, not where their audiences are stored.
// ─────────────────────────────────────────────────────────────────────────────

import type { DimensionSpec, ReflexConfig } from '@/reflex/core';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The nine axes. Anything not in this union is not a Bright Hour dimension. */
export type BrightHourDimension =
  | 'category'
  | 'subcategory'
  | 'brandPersonality'
  | 'priceBand'
  | 'offerTypeAffinity'
  | 'urgencyResponsiveness'
  | 'hostAffinity'
  | 'sessionMission'
  | 'mediaAffinity';

/**
 * Demo τ (§C1 column 4). Room pace: fast enough that a meter crosses θin inside
 * a sentence, slow enough that the durable axes visibly DON'T move while the
 * session axes spike (Beat 4 — the most persuasive 30 seconds in the demo).
 */
export const DEMO_TAUS: Readonly<Record<BrightHourDimension, number>> = {
  category: 90 * SECOND,
  subcategory: 60 * SECOND,
  brandPersonality: 240 * SECOND,
  priceBand: 300 * SECOND,
  offerTypeAffinity: 120 * SECOND,
  urgencyResponsiveness: 45 * SECOND,
  hostAffinity: 180 * SECOND,
  sessionMission: 30 * SECOND,
  mediaAffinity: 90 * SECOND,
};

/**
 * Production τ (§C1 column 5) — the same nine axes at real-world half-lives.
 * `sessionMission` is unchanged: it is session-scoped by construction, so its
 * production value IS 30 seconds. Everything else stretches by ~4 orders of
 * magnitude, which is exactly the point: the demo is not a different model.
 */
export const PROD_TAUS: Readonly<Record<BrightHourDimension, number>> = {
  category: 14 * DAY,
  subcategory: 3 * DAY,
  brandPersonality: 30 * DAY,
  priceBand: 45 * DAY,
  offerTypeAffinity: 7 * DAY,
  urgencyResponsiveness: 24 * HOUR,
  hostAffinity: 21 * DAY,
  sessionMission: 30 * SECOND, // session-scoped by τ — see SESSION_SCOPED_DIMENSIONS
  mediaAffinity: 10 * DAY,
};

/**
 * core.ts has no session-scoped concept: a dimension is scoped by its τ alone.
 * `sessionMission` is therefore given the shortest τ in the registry (30s) and
 * the highest θin (0.70) — it can only be held while a session is actively
 * feeding it, and it evaporates within ~90s of idle. Hosts that DO have a
 * session boundary (ShopperReflex) may additionally drop this dimension's
 * entries on session end; the τ alone is sufficient, the drop is belt-and-braces.
 */
export const SESSION_SCOPED_DIMENSIONS: readonly BrightHourDimension[] = ['sessionMission'];

/** θin / θout per the §C1 table. θout < θin everywhere = hysteresis, no flapping. */
const THRESHOLDS: Readonly<Record<BrightHourDimension, { thetaIn: number; thetaOut: number }>> = {
  category: { thetaIn: 0.6, thetaOut: 0.45 },
  subcategory: { thetaIn: 0.6, thetaOut: 0.45 },
  brandPersonality: { thetaIn: 0.55, thetaOut: 0.4 },
  priceBand: { thetaIn: 0.55, thetaOut: 0.4 },
  offerTypeAffinity: { thetaIn: 0.6, thetaOut: 0.45 },
  // Hardest to enter, ordinary to leave: urgency framing must be EARNED (Beat 11).
  urgencyResponsiveness: { thetaIn: 0.65, thetaOut: 0.45 },
  hostAffinity: { thetaIn: 0.55, thetaOut: 0.4 },
  // Highest bar in the registry: mission changes the LAYOUT, so it must be certain.
  sessionMission: { thetaIn: 0.7, thetaOut: 0.5 },
  mediaAffinity: { thetaIn: 0.6, thetaOut: 0.45 },
};

/**
 * Source fields — the catalog contract.
 *
 * core.extractTouches() reads `product[spec.source]`: FLAT KEYS ONLY, no paths.
 * Every source below therefore resolves on a RAW catalog.data.json item, before
 * catalog.ts runs — which is what lets the audience generator score the data
 * file directly. See README.md "Field mirroring" for which nested field each
 * one mirrors and who keeps them in sync.
 */
const SOURCES: Readonly<Record<BrightHourDimension, string>> = {
  category: 'category', //            ← categories[] primary node's name
  subcategory: 'subcategory', //      ← the label 1:1 with primaryClassCode
  brandPersonality: 'brandPersonality',
  priceBand: 'price_usd', //          ← pricing.currentSellingPrice (banded below)
  offerTypeAffinity: 'offerType', //  ← offer.type
  urgencyResponsiveness: 'urgencyCue', // ← derived from offer.type
  hostAffinity: 'presentedBy', //     ← signals.presentedBy
  // No catalog field feeds sessionMission: the host's mission classifier injects
  // Touch{dim:'sessionMission', value:'mission'|'browse'} straight into apply().
  // The source name is nominal — no product carries it, so extractTouches yields
  // nothing for it, which is correct rather than accidental.
  sessionMission: 'sessionMission',
  mediaAffinity: 'mediaFormat', //    ← 'video' when media.onAirClip is present
};

/**
 * Price band cuts (§B3): entry <40 | core 40–120 | elevated 120–300 | premium 300+.
 * The catalog stores the same band on `pricing.priceBand`; the build asserts the
 * two agree, so the shopper-facing chip and the scored value can never diverge.
 */
export const PRICE_BAND_CUTS: readonly number[] = [40, 120, 300];
export const PRICE_BAND_LABELS: readonly string[] = ['entry', 'core', 'elevated', 'premium'];

/**
 * Action → accumulation weight. Superset of the coach weights (the host emits
 * the same normalized action names on both surfaces) plus the live-commerce
 * actions this catalog makes possible. Unknown actions weigh 0 and still force
 * a membership re-evaluation, so time alone can move a shopper out.
 */
export const BRIGHTHOUR_WEIGHTS: Record<string, number> = {
  // Browsing
  product_view: 1,
  pdp_view: 1,
  view_product: 1,
  grid_click: 1,
  rail_scroll: 1,
  // A CLICK is intent, not exposure: heavier than the impression the same card
  // already fired, lighter than adding it to a cart. Without these two the Cold
  // Open depended entirely on the impression observer — a presenter clicking
  // three cards moved the meter only if the row stayed in view, which is a
  // fragile thing to ask of anyone standing in front of a room.
  product_click: 2,
  category_click: 1,
  // Offer engagement — the signal urgencyResponsiveness is built on. Clicking the
  // OFFER framing (the badge, the "One-Day Price" line), never a countdown or a
  // scarcity counter: those do not exist on this storefront by design (§A6).
  offer_click: 2,
  offer_badge_click: 2,
  // Live-commerce intent
  clip_play: 2,
  clip_complete: 3,
  host_page_view: 2,
  show_reminder_set: 3,
  // Search-led arrival — the strongest mission signal (Beat 9).
  search_to_pdp: 3,
  // Saving / buying
  wishlist: 2,
  wishlist_add: 2,
  add_to_wishlist: 2,
  save_for_later: 2,
  waitlist_join: 3,
  add_to_cart: 3,
  cart_add: 3,
  speed_buy: 4,
  purchase: 5,
  checkout: 5,
  order_complete: 5,
  // Time-only re-evaluation (alarms / no-product events): no accumulation.
  tick: 0,
};

/** Build the nine DimensionSpecs against a τ map. Exported so Beat 14 can retune live. */
export function brighthourDimensions(taus: Readonly<Record<BrightHourDimension, number>>): DimensionSpec[] {
  const spec = (key: BrightHourDimension, extra: Partial<DimensionSpec> = {}): DimensionSpec => ({
    key,
    source: SOURCES[key],
    tauMs: taus[key],
    thetaIn: THRESHOLDS[key].thetaIn,
    thetaOut: THRESHOLDS[key].thetaOut,
    ...extra,
  });

  return [
    // 1. Core interest. Maps 1:1 to their six top-offers.json buckets, plus two.
    spec('category'),
    // 2. Sharper and more disposable — "air fryers" fades faster than "kitchen".
    spec('subcategory'),
    // 3. Taste is durable. The long-term half of two-speed.
    spec('brandPersonality'),
    // 4. Slowest axis in the registry: price posture is a trait, not a mood.
    spec('priceBand', {
      derive: 'band',
      cuts: [...PRICE_BAND_CUTS],
      labels: [...PRICE_BAND_LABELS],
    }),
    // 5. Does this person shop CONSTRUCTS or CATEGORIES? The most under-used
    //    signal in live commerce — and the one their offer grammar is made of.
    spec('offerTypeAffinity'),
    // 6. Fastest durable dim. Deal-responsiveness is a mood, and the fast decay
    //    IS the governance: we stop pressuring people who don't respond to it.
    spec('urgencyResponsiveness'),
    // 7. Live-commerce-native. 29 hosts, 12 host shops, and no competitor models it.
    spec('hostAffinity'),
    // 8. mission vs browse. Drives LAYOUT (module count), not just content.
    spec('sessionMission'),
    // 9. Watch-to-buy vs read-to-buy: does the on-air rail outrank the grid?
    spec('mediaAffinity'),
  ];
}

const BASE = {
  dimensions: [] as DimensionSpec[],
  weights: BRIGHTHOUR_WEIGHTS,
  // Globals are the FLOOR every dimension overrides; K is deliberately left
  // global at the engine's existing 1.8 (the coach config overrides only τ per
  // dimension). One saturation midpoint across all nine axes means "three brisk
  // interactions crosses θin" reads identically on every meter on screen — the
  // per-dimension differences the demo argues about are τ and θ, and nothing else.
  tauMs: 90 * SECOND,
  K: 1.8,
  thetaIn: 0.6,
  thetaOut: 0.45,
  epsilon: 1e-4,
  // Nine dimensions over a 77-item catalog: 24 tracked values per dimension is
  // far above the widest axis (subcategory, ~40 values catalog-wide, never that
  // many per shopper) while keeping session state small.
  maxValuesPerDim: 24,
} satisfies Omit<ReflexConfig, 'version'>;

/** The shipped Bright Hour tuning — DEMO τ. This is what registry.ts loads. */
export const BRIGHTHOUR_REFLEX_CONFIG: ReflexConfig = {
  ...BASE,
  version: 'brighthour-demo-v1',
  dimensions: brighthourDimensions(DEMO_TAUS),
};

/**
 * The same nine axes at production half-lives. Not wired to a route: it exists
 * so the glass box can show both columns side by side and so a POC can be
 * pointed at it by changing one config reference.
 */
export const BRIGHTHOUR_REFLEX_CONFIG_PROD: ReflexConfig = {
  ...BASE,
  version: 'brighthour-prod-v1',
  dimensions: brighthourDimensions(PROD_TAUS),
};
