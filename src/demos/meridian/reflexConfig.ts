// src/demos/meridian/reflexConfig.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE PARALLEL REGISTRIES — the structural argument for agnosticism.
//
// Retail and financial declare the SAME EIGHT DIMENSION SHAPES, with the SAME
// τ / K / θ tuning, and six of the eight read the SAME RECORD FIELD. Only the
// dimension KEY changes — the word the room reads on the instrument.
//
//   shape     retail key    ← retail field   financial key      ← financial field
//   broad     category      ← category       productFamily      ← category
//   narrow    line          ← line           subFamily          ← subcategory
//   band      priceBand     ← value_usd      amountBand         ← value_usd
//   durable   styleWorld    ← world          lifeStage          ← world
//   hue       colour        ← colour         tier               ← tier
//   need      occasion      ← needs[]        intent             ← needs[]
//   content   contentType   ← contentType    contentType        ← contentType
//   stage     journeyStage  ← (the verb)     applicationStage   ← (the verb)
//
// NARROW AND HUE ARE THE TWO EXCEPTIONS. Narrow (decision D3, 2026-08-28):
// retail's narrow dimension is the product LINE — Drover, Linden, Halden — the
// family a luxury house actually merchandises by, the way Coach merchandises
// "Tabby". Material stays on the retail record as `subcategory` for the card's
// display string ("Outerwear · canvas") and is no longer a dimension. Financial
// has no lines; its narrow dimension keeps reading `subcategory` (fixed /
// variable / revolving …) under the key subFamily.
//
// Hue (decision D8, 2026-08-28): the catalogue is FAMILIES × COLOURWAYS now, so
// colour is a value that recurs across families — an affinity for black is
// finally observable — and it reads `colour` in retail. Financial's colour is
// the card in your wallet: `tier` (black / gold / silver / blue), carried by the
// Card products only. A sparse source is fine — extractTouches skips an absent
// field — which is itself part of the agnosticism argument.
//
// SEVEN OF THE EIGHT READ THE NOUN. The eighth reads the VERB: journeyStage is
// not carried by any item, it is carried by WHAT THE VISITOR DID — a click is
// browsing, an add-to-bag is deciding. It therefore scores no item and carries
// zero weight in every slot. What it changes is the page's SHAPE: when it tips
// to deciding, the row stops offering more choices and starts completing the
// one already made. A dimension that restructures rather than re-ranks.
//
// So when the catalog swaps on stage, eight bars stay exactly where they were and
// only their labels change. Nobody has to be told the engine is the same engine.
//
// TWO SPEEDS SHIP IN BOTH. The durable axes (priceBand/styleWorld, amountBand/
// lifeStage — τ 120-150s demo) visibly DO NOT move while the fast axes (category,
// line — τ 30-45s) spike. That contrast is the most persuasive thirty
// seconds available: taste is slow, this session is fast, one engine holds both.
//
// PROD_TAUS is what a real deployment runs — days and weeks. Publishing both is
// the credibility move: nothing here is a demo-only trick, only a demo-only RATE.
//
// Tuning is data, never a redeploy. The version stamps every explain record.
// ─────────────────────────────────────────────────────────────────────────────

import type { DimensionSpec, ReflexConfig } from '@/reflex/core';
import type { Vertical } from './types';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The eight shapes. Anything not in this union is not a Meridian dimension. */
export type MeridianShape =
  | 'broad'      // what aisle / what product family
  | 'narrow'     // the specific kind
  | 'band'       // value: price, or principal
  | 'durable'    // taste, or life stage — the slow axis
  | 'hue'        // colour of the thing: colourway, or card tier
  | 'need'       // multi-valued: occasion, or intent
  | 'content'    // which kind of asset earns attention
  | 'stage';     // where in the journey — read from the verb, not the item

/** Room pace. A bar crosses θ_in inside a sentence; durable bars visibly lag. */
export const DEMO_TAUS: Readonly<Record<MeridianShape, number>> = {
  // FOUR TIMES SLOWER THAN THE FIRST TUNING. At 30–60s the whole profile
  // evaporated while the presenter talked for two minutes — every bar at zero,
  // the row back to "our usual order", the tuning dial dead because a weight
  // times nothing is nothing. A profile has to survive a conversation. The
  // staircase ("watch her leave") is no longer something that happens while
  // you wait: the presenter presses "Let two minutes pass" and the same decay
  // runs on demand, which is also the only honest way to make it a beat.
  broad: 180 * SECOND,
  narrow: 120 * SECOND,
  band: 600 * SECOND,
  durable: 480 * SECOND,
  // Colour taste sits between the session's aisle and the durable axes: faster
  // than taste, slower than "which line is she in right now".
  hue: 240 * SECOND,
  need: 240 * SECOND,
  content: 180 * SECOND,
  // Intent is still the most perishable thing here.
  stage: 160 * SECOND,
};

/** What a real deployment runs. Same math, same code path, different rate. */
export const PROD_TAUS: Readonly<Record<MeridianShape, number>> = {
  broad: 14 * DAY,
  narrow: 7 * DAY,
  band: 45 * DAY,
  durable: 60 * DAY,
  hue: 30 * DAY,
  need: 21 * DAY,
  content: 14 * DAY,
  stage: 3 * DAY,
};

/** Per-shape saturation and hysteresis. Identical across verticals, by design. */
const SHAPE_TUNING: Readonly<Record<MeridianShape, { K: number; thetaIn: number; thetaOut: number }>> = {
  broad: { K: 1.8, thetaIn: 0.60, thetaOut: 0.45 },
  narrow: { K: 1.6, thetaIn: 0.60, thetaOut: 0.45 },
  band: { K: 2.4, thetaIn: 0.55, thetaOut: 0.40 },
  durable: { K: 2.2, thetaIn: 0.58, thetaOut: 0.42 },
  hue: { K: 1.8, thetaIn: 0.60, thetaOut: 0.45 },
  need: { K: 1.8, thetaIn: 0.60, thetaOut: 0.45 },
  content: { K: 1.6, thetaIn: 0.60, thetaOut: 0.45 },
  // Low K on purpose: one add-to-bag (weight 3.0) gives a = 3.0/(3.0+1.4) =
  // 0.68, clear of θ_in. Deciding is a state you enter on one decisive act.
  stage: { K: 1.4, thetaIn: 0.60, thetaOut: 0.45 },
};

/**
 * Action → accumulation weight. Unknown actions weigh 0 but still re-evaluate,
 * so a tick with no signal can still produce an EXIT. That is the mechanism
 * behind the beat where the page changes with nobody touching it.
 *
 * THREE SIGNALS ENTER AN AUDIENCE, NEVER ONE (decision D4 — these are the
 * Coach demo's values). Every browsing verb weighs exactly 1.0, so with K 1.8
 * and θ_in 0.60 three of them enter — 3/(3+1.8) = 0.625 — and two do not —
 * 2/3.8 = 0.53. One click is noise, two is a hint, three is a pattern, and the
 * ladder above browsing (search 1.5, declared/save 2.0, intent 3.0, convert
 * 5.0) buys steps up that staircase rather than a way around it.
 */
export const MERIDIAN_WEIGHTS: Readonly<Record<string, number>> = {
  /** The cold-start seed, derived from published census figures. Sized to land
      the band affinity visibly above zero but below theta_out — we know
      something, we have not committed to anything.
      At 1.6 it landed a = 1.6/(1.6+2.4) = 0.400 against a theta_out of 0.40,
      i.e. exactly ON the line, so it claimed for one tick and immediately
      announced its own retreat. 1.35 gives a = 0.36: unmistakably non-zero on
      the bar, and comfortably short of committing. */
  prior: 1.35,
  /** An off-site arrival — email opened, ad clicked, form submitted — counts as
      one browsing signal, no more: someone acted somewhere, which starts the
      pattern but never is one by itself. */
  arrival: 1.0,
  /** Zero-party: the visitor STATED this rather than revealed it. Two signals'
      worth — unambiguous, so it outweighs any single observed act, and short of
      entry on its own, because saying you like evening pieces is not the same
      as buying one. Critically it lands in the SAME vector as observed
      behaviour and decays on the SAME clock — a preference declared once stops
      driving the page unless behaviour agrees. */
  declared: 2.0,
  /** One browsing signal, like every other browsing verb — the aisle chosen,
      the card opened, the rail followed: each is a third of an audience. */
  nav_click: 1.0,
  view: 1.0,
  scroll_depth: 0.5,
  rail_click: 1.0,
  block_read: 1.0,
  row_click: 1.0,
  search: 1.5,         // typed words beat a click, but not a declaration
  save: 2.0,
  intent_start: 3.0,   // add to cart · begin application
  convert: 5.0,        // purchase · submit application
  reflex_tick: 0,      // re-evaluate only — never accumulates
  time_skip: 0,        // the presenter let time pass; nothing accumulates, decay runs
};

/** One shape, expressed for a given vertical's vocabulary. */
function dim(
  shape: MeridianShape,
  key: string,
  source: string,
  taus: Readonly<Record<MeridianShape, number>>,
  extra: Partial<DimensionSpec> = {},
): DimensionSpec {
  return { key, source, tauMs: taus[shape], ...SHAPE_TUNING[shape], ...extra };
}

function buildConfig(vertical: Vertical, taus: Readonly<Record<MeridianShape, number>>): ReflexConfig {
  const retail = vertical === 'retail';
  const rate = taus === DEMO_TAUS ? 'demo' : 'prod';

  return {
    version: `meridian-${vertical}-${rate}-v1`,
    dimensions: [
      dim('broad', retail ? 'category' : 'productFamily', 'category', taus),
      // The one place the two registries read different fields — see the header.
      dim('narrow', retail ? 'line' : 'subFamily', retail ? 'line' : 'subcategory', taus),
      dim('band', retail ? 'priceBand' : 'amountBand', 'value_usd', taus, {
        derive: 'band',
        // Retail: everyday / considered / premium. Financial: modest / core / major.
        cuts: retail ? [75, 250] : [25_000, 250_000],
        labels: retail ? ['entry', 'core', 'premium'] : ['modest', 'core', 'major'],
      }),
      dim('durable', retail ? 'styleWorld' : 'lifeStage', 'world', taus),
      // The second place the registries read different fields (D8): a colourway
      // in retail, the card's tier in financial — where only the five Card
      // products carry the source, and extractTouches skips everything else.
      dim('hue', retail ? 'colour' : 'tier', retail ? 'colour' : 'tier', taus),
      dim('need', retail ? 'occasion' : 'intent', 'needs', taus, { multi: true }),
      dim('content', 'contentType', 'contentType', taus),
      // Source deliberately names no item field. extractTouches skips a source
      // it cannot find, so this dimension can only ever be moved by an
      // explicitly emitted verb — which is exactly the guarantee we want.
      dim('stage', retail ? 'journeyStage' : 'applicationStage', '__verb__', taus),
    ],
    weights: { ...MERIDIAN_WEIGHTS },
    // Globals are per-dimension-overridden above; these are the floor.
    tauMs: taus.broad,
    K: 1.8,
    thetaIn: 0.60,
    thetaOut: 0.45,
    epsilon: 0.01,
    maxValuesPerDim: 24,
  };
}

export const MERIDIAN_RETAIL_CONFIG: ReflexConfig = buildConfig('retail', DEMO_TAUS);
export const MERIDIAN_FINANCIAL_CONFIG: ReflexConfig = buildConfig('financial', DEMO_TAUS);

/** What a production deployment of the same registry looks like. Shown, not run. */
export const MERIDIAN_RETAIL_CONFIG_PROD: ReflexConfig = buildConfig('retail', PROD_TAUS);
export const MERIDIAN_FINANCIAL_CONFIG_PROD: ReflexConfig = buildConfig('financial', PROD_TAUS);

export function configFor(vertical: Vertical, rate: 'demo' | 'prod' = 'demo'): ReflexConfig {
  if (rate === 'prod') {
    return vertical === 'retail' ? MERIDIAN_RETAIL_CONFIG_PROD : MERIDIAN_FINANCIAL_CONFIG_PROD;
  }
  return vertical === 'retail' ? MERIDIAN_RETAIL_CONFIG : MERIDIAN_FINANCIAL_CONFIG;
}

/**
 * The shape a dimension key belongs to — so the client can keep a bar in the
 * SAME ROW across a vertical swap instead of re-sorting the instrument.
 */
export const SHAPE_OF_KEY: Readonly<Record<string, MeridianShape>> = {
  category: 'broad', productFamily: 'broad',
  line: 'narrow', subFamily: 'narrow',
  priceBand: 'band', amountBand: 'band',
  styleWorld: 'durable', lifeStage: 'durable',
  colour: 'hue', tier: 'hue',
  occasion: 'need', intent: 'need',
  contentType: 'content',
  journeyStage: 'stage', applicationStage: 'stage',
};

/** Display order on the instrument. Fixed across verticals — that is the point. */
export const SHAPE_ORDER: readonly MeridianShape[] =
  ['broad', 'narrow', 'need', 'band', 'durable', 'hue', 'content', 'stage'];

// ─────────────────────────────────────────────────────────────────────────────
// RECENCY LEADS, ACCUMULATION GATES — AN ADDITION TO THE SPEC.
//
// Decided 2026-08-28 (D2). This is NOT in the Tapestry documents, which specify
// decay only: within a dimension the value with the most accumulated affinity
// leads, and keeps leading until decay says otherwise. Run that on stage and it
// misbehaves in a way the room notices. Three clicks on Drover pieces, then one
// on a Linden bag — the visitor has plainly moved on, and the documented
// algorithm keeps pushing Drover for roughly the narrow τ, about thirty seconds,
// because one Linden click cannot out-accumulate three Drover ones. Thirty
// seconds of a page ignoring what she just did is thirty seconds of the
// argument failing.
//
// So a dimension can be flagged RECENCY-LED. Its lead is the most recently
// touched value — the entry with the latest t — not the highest a. In scoring,
// the lead contributes its full a; every other value in that dimension
// contributes a × TRAILING. Drover pieces still rank, weakly: she did look at
// three of them, and pretending otherwise would be its own kind of lie.
//
// MEMBERSHIP IS NOT TOUCHED. Entering and leaving an audience stays purely
// threshold-based in core — a ≥ θ_in in, a < θ_out out — so after those four
// clicks Linden leads the page, the Drover audience is still hers, and it
// leaves on its own when its affinity decays out. The receipt names both:
// "line · Linden led by recency; Drover trailing ×0.25".
//
// Retail `line` is the only recency-led dimension for now. Category stays
// score-led on purpose: which aisle she is in IS a running total. This is a
// Meridian-side map rather than a field on core's DimensionSpec because it is
// a Meridian decision, and widening core reaches into two other demos. The rule
// itself lives in lead.ts; composer.ts applies it when it is handed raw state.
// ─────────────────────────────────────────────────────────────────────────────

export type LeadMode = 'recency' | 'score';

/** Dimension key → how its lead is chosen. Absent means 'score', the documented default. */
export const LEAD_BY: Readonly<Record<string, LeadMode>> = {
  line: 'recency',
};

/** What a non-lead value's affinity is multiplied by inside a recency-led dimension. */
export const DEFAULT_TRAILING = 0.25;
export const TRAILING: Readonly<Record<string, number>> = {
  line: 0.25,
};

export const leadModeFor = (dimKey: string): LeadMode => LEAD_BY[dimKey] ?? 'score';
export const trailingFor = (dimKey: string): number => TRAILING[dimKey] ?? DEFAULT_TRAILING;

// ─────────────────────────────────────────────────────────────────────────────
// THE GUARD.
//
// SHAPE_OF_KEY and SHAPE_ORDER are hand-written, and a dimension added to the
// registry without a matching entry here does not fail — it resolves to
// undefined, scores nothing, and looks exactly like a dimension that simply
// isn't moving. That has now cost three separate debugging sessions on this
// demo. So the mismatch is made loud, at module load, before anything renders.
// ─────────────────────────────────────────────────────────────────────────────
for (const vertical of ['retail', 'financial'] as const) {
  for (const d of configFor(vertical).dimensions) {
    const shape = SHAPE_OF_KEY[d.key];
    if (!shape) {
      throw new Error(
        `reflexConfig: dimension "${d.key}" (${vertical}) is missing from SHAPE_OF_KEY. ` +
        `It would score nothing and fail silently. Add it, and add its shape to SHAPE_ORDER.`,
      );
    }
    if (!SHAPE_ORDER.includes(shape)) {
      throw new Error(
        `reflexConfig: shape "${shape}" (from "${d.key}") is missing from SHAPE_ORDER, ` +
        `so it would never be drawn on the instrument.`,
      );
    }
  }
}
// Same failure mode for the lead maps: a misspelt key would apply the recency
// rule to nothing, silently, and look exactly like the rule not working.
for (const key of new Set([...Object.keys(LEAD_BY), ...Object.keys(TRAILING)])) {
  if (!SHAPE_OF_KEY[key]) {
    throw new Error(
      `reflexConfig: LEAD_BY/TRAILING names "${key}", which is not a Meridian dimension key. ` +
      `The recency rule would silently apply to nothing.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE VERB MAP — the stage dimension's only evidence.
//
// Every other dimension is read off the item. This one is read off what the
// visitor DID with it, which is why it lives here as a table rather than in a
// catalogue field: browsing and deciding are properties of the person, and no
// product is inherently one or the other.
// ─────────────────────────────────────────────────────────────────────────────

export type StageStep = 'browse' | 'consider' | 'decide';

export const STAGE_OF_ACTION: Readonly<Record<string, StageStep>> = {
  view: 'browse', row_click: 'browse', rail_click: 'browse', block_read: 'browse',
  nav_click: 'browse',
  scroll_depth: 'browse', arrival: 'browse',
  search: 'consider', save: 'consider',
  intent_start: 'decide', convert: 'decide',
};

/** Same three steps, the vertical's own word for each. */
export const STAGE_LABELS: Readonly<Record<Vertical, Readonly<Record<StageStep, string>>>> = {
  retail:    { browse: 'browsing',  consider: 'considering', decide: 'deciding' },
  financial: { browse: 'exploring', consider: 'comparing',   decide: 'applying' },
};

export const stageKeyFor = (v: Vertical) => (v === 'retail' ? 'journeyStage' : 'applicationStage');
export const decidingValueFor = (v: Vertical) => STAGE_LABELS[v].decide;

/** The touch a verb contributes, or null for verbs that say nothing about stage. */
export function stageTouchFor(action: string, vertical: Vertical): { dim: string; value: string } | null {
  const step = STAGE_OF_ACTION[action];
  if (!step) return null;
  return { dim: stageKeyFor(vertical), value: STAGE_LABELS[vertical][step] };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHEN ONE MEMBERSHIP WILL EXPIRE.
//
// core.nextCrossing() answers "when does the FIRST of my audiences lapse", which
// is the right question for scheduling an alarm and the wrong one for an offer
// that has to name its own remaining life. Same closed form, one membership:
//
//   t* = tLast + τ · ln( R / floor ),  floor = K·θ_out / (1 − θ_out)
//
// Deliberately mirrored rather than imported, because widening core's signature
// would reach into two other demos that share it. `offerExpiryAgreesWithCore`
// in the test suite pins the two together so the duplication cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

export function expiryOf(
  state: { dims: Record<string, Record<string, { s: number; t: number }>> },
  dim: string,
  value: string,
  config: ReflexConfig,
): number | null {
  const entry = state.dims?.[dim]?.[value];
  if (!entry) return null;
  const spec = config.dimensions.find((d) => d.key === dim);
  const K = spec?.K ?? config.K;
  const thetaOut = spec?.thetaOut ?? config.thetaOut;
  const tauMs = spec?.tauMs ?? config.tauMs;
  const floor = (K * thetaOut) / (1 - thetaOut);
  if (entry.s <= floor) return null;          // already gone
  return entry.t + tauMs * Math.log(entry.s / floor);
}
