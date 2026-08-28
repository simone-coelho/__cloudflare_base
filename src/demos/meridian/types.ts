// src/demos/meridian/types.ts
// ─────────────────────────────────────────────────────────────────────────────
// One item shape, two verticals. Meridian & Co. sells things; Meridian Financial
// lends and holds money. They share a record shape and differ only in vocabulary,
// which is the entire point of the surface: when the catalog swaps on stage, the
// engine's instrument does not change — only the words in it do.
//
// Flat keys only. Every dimension in reflexConfig.ts names one of these fields as
// its `source`, and src/reflex/core.ts reads it off the record directly.
// ─────────────────────────────────────────────────────────────────────────────

/** Which business Meridian is running right now. */
export type Vertical = 'retail' | 'financial';

/** Broad grouping. Retail: what aisle. Financial: what product family. */
export type MeridianCategory =
  // retail
  | 'Bags' | 'Tools' | 'Games' | 'Apparel' | 'Home'
  // financial
  | 'Mortgage' | 'Auto' | 'Card' | 'Savings' | 'Investing';

/**
 * The durable taste axis — slow τ, and the one that visibly does NOT move while
 * the fast axes spike. Retail reads as design temperament, financial as where
 * someone is in their life. Same role in the math, same position on screen.
 */
export type DurableWorld =
  // retail — styleWorld
  | 'heritage' | 'modern' | 'playful' | 'technical'
  // financial — lifeStage
  | 'starting-out' | 'building' | 'established' | 'planning';

/** Multi-valued need. Retail: occasion. Financial: intent. */
export type MeridianNeed =
  // retail
  | 'gift' | 'everyday' | 'project' | 'hosting' | 'travel'
  // financial
  | 'borrow' | 'save' | 'invest' | 'protect' | 'refinance';

/**
 * Content type. The one dimension that is spelled the same in both verticals,
 * because content is content. Drives the composition lane: which block leads.
 */
export type ContentType =
  | 'on-model' | 'silo' | 'editorial' | 'video' | 'guide'
  | 'calculator' | 'rate-table' | 'explainer';

/**
 * A catalog item. `value_usd` is the band source: a price in retail, a typical
 * principal or balance in financial. One field, two meanings, one band dimension.
 */
export interface MeridianItem {
  id: string;                    // MRD-R### | MRD-F###
  vertical: Vertical;
  name: string;
  category: MeridianCategory;
  subcategory: string;
  value_usd: number;
  world: DurableWorld;
  needs: MeridianNeed[];
  /** Display only — never a dimension source. */
  blurb: string;
  image?: string;
  /** Financial only: the headline number a rate table would show. */
  rate_pct?: number;
  /** Eligibility, not affinity. Item properties, never visitor properties. */
  available?: boolean;
  embargoed?: boolean;
}

/**
 * A content block — an ID-addressed, typed, tagged, slot-eligible asset. This is
 * the composition lane: the engine decides which block leads, and the page paints
 * whatever it is handed. Blocks carry the same dimension vocabulary as items, so
 * one visitor vector ranks both.
 */
export interface MeridianBlock {
  id: string;                    // MRD-B###
  vertical: Vertical;
  title: string;
  kicker: string;
  contentType: ContentType;
  /** Tags projected into the item dimension space — the join between the two worlds. */
  category?: MeridianCategory;
  world?: DurableWorld;
  needs?: MeridianNeed[];
  /** Which slots this block may occupy. Eligibility runs before scoring. */
  slots: MeridianSlot[];
  body: string;
}

/** The five surfaces of the page. Each changes for a different, nameable reason. */
export type MeridianSlot =
  | 'hero'        // changes on audience entry or exit
  | 'rail'        // changes on every signal — the fast-twitch surface
  | 'row'         // product ranking
  | 'block_a'     // composition: which block leads
  | 'block_b';

/** One decision, with its receipt. Every slot on the page emits one of these. */
export interface MeridianDecision {
  slot: MeridianSlot;
  order: number;
  itemId?: string;
  blockId?: string;
  /**
   * 'fading' is the honest fourth state. A slot can still rank — decayed scores
   * are not zero — while no longer being entitled to say "because of what you
   * looked at". When the driver behind a slot falls under its own exit
   * threshold, the slot keeps its ordering but drops the claim.
   */
  anchorId?: string;
  strategy: 'cold-start' | 'affinity' | 'fading' | 'pin' | 'fallback' | 'quota' | 'completion';
  explain: MeridianExplain;
}

/** The glass box. If it is on screen, this says why. */
export interface MeridianExplain {
  /** Dimension → the visitor's affinity a(t) at decision time. */
  drivers: Array<{ dim: string; value: string; a: number; weight: number }>;
  candidates: number;
  gatesFailed: string[];
  rank: number;
  /** The strongest driver's affinity, and the exit threshold it is measured against. */
  confidence?: number;
  thetaOut?: number;
  configVersion: string;
  /**
   * What the engine declined. Scored, ranked, and then refused by a rule — the
   * score is kept precisely so we can say "it would have won" out loud.
   */
  refused?: Array<{ id: string; score: number; gate: string }>;
  /** Set when the value shown is representative rather than measured. */
  representative?: boolean;
}
