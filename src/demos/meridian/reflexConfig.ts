// src/demos/meridian/reflexConfig.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE PARALLEL REGISTRIES — the structural argument for agnosticism.
//
// Retail and financial declare the SAME SEVEN DIMENSION SHAPES, reading the SAME
// RECORD FIELDS, with the SAME τ / K / θ tuning. Only the dimension KEY
// changes — the word the room reads on the instrument.
//
//   category    ← category      → productFamily
//   subcategory ← subcategory   → subFamily
//   priceBand   ← value_usd     → amountBand
//   styleWorld  ← world         → lifeStage
//   occasion    ← needs[]       → intent
//   contentType ← contentType   → contentType
//   journeyStage← (the verb)    → applicationStage
//
// SIX OF THE SEVEN READ THE NOUN. The seventh reads the VERB: journeyStage is
// not carried by any item, it is carried by WHAT THE VISITOR DID — a click is
// browsing, an add-to-bag is deciding. It therefore scores no item and carries
// zero weight in every slot. What it changes is the page's SHAPE: when it tips
// to deciding, the row stops offering more choices and starts completing the
// one already made. A dimension that restructures rather than re-ranks.
//
// So when the catalog swaps on stage, seven bars stay exactly where they were and
// only their labels change. Nobody has to be told the engine is the same engine.
//
// TWO SPEEDS SHIP IN BOTH. The durable axes (priceBand/styleWorld, amountBand/
// lifeStage — τ 240-300s demo) visibly DO NOT move while the fast axes (category,
// subcategory — τ 60-90s) spike. That contrast is the most persuasive thirty
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

/** The seven shapes. Anything not in this union is not a Meridian dimension. */
export type MeridianShape =
  | 'broad'      // what aisle / what product family
  | 'narrow'     // the specific kind
  | 'band'       // value: price, or principal
  | 'durable'    // taste, or life stage — the slow axis
  | 'need'       // multi-valued: occasion, or intent
  | 'content'    // which kind of asset earns attention
  | 'stage';     // where in the journey — read from the verb, not the item

/** Room pace. A bar crosses θ_in inside a sentence; durable bars visibly lag. */
export const DEMO_TAUS: Readonly<Record<MeridianShape, number>> = {
  // Retuned against a measured run. The three surfaces still retreat in order —
  // narrow, then broad, then need — but the whole staircase now completes inside
  // ~90s of narration instead of ~160s of silence.
  broad: 45 * SECOND,
  narrow: 30 * SECOND,
  band: 150 * SECOND,
  durable: 120 * SECOND,
  need: 60 * SECOND,
  content: 45 * SECOND,
  // Intent is the most perishable thing here. Someone who was deciding two
  // minutes ago and has been idle since is browsing again.
  stage: 40 * SECOND,
};

/** What a real deployment runs. Same math, same code path, different rate. */
export const PROD_TAUS: Readonly<Record<MeridianShape, number>> = {
  broad: 14 * DAY,
  narrow: 7 * DAY,
  band: 45 * DAY,
  durable: 60 * DAY,
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
  /** An off-site arrival — email opened, ad clicked, form submitted. Someone
      chose to act on a surface that is not your website, which is a stronger
      statement than a page view and weaker than adding to a bag. */
  arrival: 2.0,
  /** Zero-party: the visitor STATED this rather than revealed it. Weighted above
      an arrival because it is unambiguous, and below a purchase because saying
      you like evening pieces is not the same as buying one. Critically it lands
      in the SAME vector as observed behaviour and decays on the SAME clock — a
      preference declared once stops driving the page unless behaviour agrees. */
  declared: 3.2,
  /** Choosing a department is a broader statement than opening one product —
      it is the visitor telling you which aisle they are in. */
  nav_click: 2.0,
  view: 1.0,
  scroll_depth: 0.5,
  rail_click: 1.5,
  block_read: 1.2,
  row_click: 1.5,
  search: 2.0,
  save: 3.0,
  intent_start: 3.0,   // add to cart · begin application
  convert: 4.0,        // purchase · submit application
  reflex_tick: 0,      // re-evaluate only — never accumulates
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
      dim('narrow', retail ? 'subcategory' : 'subFamily', 'subcategory', taus),
      dim('band', retail ? 'priceBand' : 'amountBand', 'value_usd', taus, {
        derive: 'band',
        // Retail: everyday / considered / premium. Financial: modest / core / major.
        cuts: retail ? [75, 250] : [25_000, 250_000],
        labels: retail ? ['entry', 'core', 'premium'] : ['modest', 'core', 'major'],
      }),
      dim('durable', retail ? 'styleWorld' : 'lifeStage', 'world', taus),
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
  subcategory: 'narrow', subFamily: 'narrow',
  priceBand: 'band', amountBand: 'band',
  styleWorld: 'durable', lifeStage: 'durable',
  occasion: 'need', intent: 'need',
  contentType: 'content',
  journeyStage: 'stage', applicationStage: 'stage',
};

/** Display order on the instrument. Fixed across verticals — that is the point. */
export const SHAPE_ORDER: readonly MeridianShape[] =
  ['broad', 'narrow', 'need', 'band', 'durable', 'content', 'stage'];

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

// ─────────────────────────────────────────────────────────────────────────────
// THE VERB MAP — the seventh dimension's only evidence.
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
