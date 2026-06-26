/**
 * Revenue Radar — SHARED FUNNEL CONTRACT (single source of truth).
 *
 * The parallel build pieces all import from here so they fit together:
 *   - migrations/0003_funnel_seed.sql + scripts/seed-funnel.mjs   (seed data)
 *   - src/services/funnel/compute.ts + src/routes/funnel.ts       (compute endpoint)
 *   - src/services/funnel/sim.ts + src/routes/funnelSim.ts        (traffic simulator)
 *   - src/agents/tools/diagnoseFunnel.ts                          (Opal tool)
 *
 * See docs/REVENUE-RADAR-TDD.md (§6 architecture, §11 parallel plan).
 * DO NOT add stages/brands/cohorts ad hoc — change them here so every piece stays aligned.
 */

// ───────────────────────── Brands ─────────────────────────
// Coach = full clickable checkout (emits real demo_events). KS/SW = seed-level funnels.
export const BRANDS = ['Coach', 'Kate Spade', 'Stuart Weitzman'] as const;
export type Brand = (typeof BRANDS)[number];
export const LIVE_BRAND: Brand = 'Coach'; // real demo_events checkout counts as this brand

// Representative AOV per brand (USD) — recoverable-revenue math.
export const BRAND_AOV_USD: Record<Brand, number> = {
  Coach: 385,
  'Kate Spade': 295,
  'Stuart Weitzman': 525,
};

// ───────────────────────── Cohorts ─────────────────────────
// gen_z is the hero (BNPL-affinity hesitators). 'all' = sum of real cohorts (computed, not stored).
export const COHORTS = ['gen_z', 'millennial', 'gen_x', 'boomer'] as const;
export type RealCohort = (typeof COHORTS)[number];
export type Cohort = RealCohort | 'all';

// ───────────────────────── Stages (ordered, GA4-shaped) ─────────────────────────
export interface StageDef { key: string; label: string; eventType: string; }
export const STAGES: StageDef[] = [
  { key: 'add_to_cart',       label: 'Add to Cart',    eventType: 'add_to_cart' },
  { key: 'view_cart',         label: 'View Cart',      eventType: 'view_cart' },
  { key: 'begin_checkout',    label: 'Begin Checkout', eventType: 'begin_checkout' },
  { key: 'add_shipping_info', label: 'Shipping Info',  eventType: 'add_shipping_info' },
  { key: 'add_payment_info',  label: 'Payment Info',   eventType: 'add_payment_info' },
  { key: 'purchase',          label: 'Purchase',       eventType: 'purchase' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);
export const stageIndex = (k: string): number => STAGE_KEYS.indexOf(k);

// Live event types the Coach checkout emits (add_to_cart already exists upstream).
// event_type is free-form on demo_events — no schema change needed.
export const CHECKOUT_EVENT_TYPES = [
  'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase',
] as const;
// A signal, NOT a funnel stage (cart persistence problem → Empty-Cart Viewers segment).
export const SIGNAL_EVENT_TYPES = ['view_cart_empty'] as const;

// ───────────────────────── Storage (created by migrations/0003_funnel_seed.sql) ─────────────────────────
//  funnel_seed (brand, cohort, stage, sessions)              — persistent baseline ("representative day"); PK(brand,cohort,stage)
//  funnel_live (brand, cohort, stage, sessions, updated_ts)  — simulator + amplify-on-action; resettable & isolated; PK(brand,cohort,stage)
//  Real Coach checkout → demo_events (event_type in CHECKOUT_EVENT_TYPES), counted as brand=Coach.
//  Funnel total per (brand,cohort,stage) = funnel_seed + funnel_live + (real demo_events, Coach only).
export const FUNNEL_SEED_TABLE = 'funnel_seed';
export const FUNNEL_LIVE_TABLE = 'funnel_live';

// ───────────────────────── Compute output — GET /funnel?brand=&cohort= ─────────────────────────
export interface FunnelStageResult {
  stage: string; label: string; sessions: number;
  stepConvPct: number; // conversion from the previous stage (stage 0 = 100)
  dropPct: number;     // 100 - stepConvPct
}
export interface FunnelLeak {
  fromStage: string; toStage: string; fromLabel: string; toLabel: string;
  dropPct: number; lostSessions: number; lostRevenueUsd: number;
  // Anomaly framing: how much WORSE than the expected baseline drop this step is.
  // Severity + recoverable revenue are driven by these so natural baseline drops don't read as leaks.
  excessDropPct?: number;              // max(0, dropPct - expected baseline drop for this step)
  excessLostSessions?: number;         // sessions lost BEYOND the baseline expectation
  cohortSkew?: string;                 // e.g. "gen_z 2.1× worse than avg"
  severity: 'high' | 'med' | 'low';
}

// Fraction of anomalous (excess) lost sessions a fix can realistically recover — for $ math.
export const RECOVERABLE_FRACTION = 0.30;
export interface FunnelResult {
  brand: Brand; cohort: Cohort; generatedAt: number;
  stages: FunnelStageResult[]; leaks: FunnelLeak[];
  overallConvPct: number; recoverableRevenueUsd: number;
}

// ───────────────────────── diagnoseFunnel recommendation (Opal → launchExperiment seam) ─────────────────────────
export type RemedyKind = 'bnpl' | 'cart_recovery' | 'shipping_estimator' | 'reassurance';
export interface FunnelRecommendation {
  leak: FunnelLeak;
  audience: { name: string; conditions: unknown; estimatedSize: number };
  remedy: { kind: RemedyKind; title: string; description: string };
  // Feeds the cross-team seam: launchExperiment({ audienceId, variations, metric }) -> { experimentId, readoutUrl }
  experiment: { variations: string[]; metric: string };
  projectedRecoveryUsd: number;
  rationale: string; // plain-English, evidence-cited
}

// Convenience for the simulator/compute: a baseline per-step conversion profile (fractions).
// Seed data should reflect these with brand/cohort-specific leaks layered on top.
export const BASELINE_STEP_CONV: Record<string, number> = {
  add_to_cart: 1.0,        // entry
  view_cart: 0.82,
  begin_checkout: 0.68,
  add_shipping_info: 0.75,
  add_payment_info: 0.80,
  purchase: 0.78,
};
