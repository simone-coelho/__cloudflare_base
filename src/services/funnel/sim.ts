/**
 * Revenue Radar — TRAFFIC SIMULATOR (writes the resettable funnel_live overlay).
 *
 * Gives the on-screen checkout funnel controllable MOTION during a live sales demo:
 *   • simTick    — AMBIENT stream: ~30 new top-of-funnel (add_to_cart) sessions/call, split
 *                  young-skewed across cohorts, then walked DOWN the 6 stages on the SAME
 *                  conversion shape as the seed (signature leaks baked in) so the leaks stay
 *                  legible as live volume accumulates instead of washing out.
 *   • simAmplify — PRESENTER hero move ("amplify-on-action"): inject `count` sessions that all
 *                  reach `throughStage`. convert=false → they stop there (the leak SWELLS);
 *                  convert=true → they also flow on through to purchase (recovered cohort, the
 *                  leak SHRINKS and the purchase bar climbs).
 *   • simReset   — wipe the live overlay only (funnel_seed + real Coach demo_events remain).
 *
 * funnel_live is an UPSERT-increment aggregate keyed (brand,cohort,stage): every write is
 * `INSERT … ON CONFLICT DO UPDATE SET sessions = sessions + excluded.sessions`. computeFunnel
 * sums funnel_seed + funnel_live + real demo_events, so this overlay just adds motion on top.
 * The 'all' cohort is never stored — amplify('all') fans the count out across the real cohorts.
 *
 * Best-effort by design: no DB binding → no-op; a failed write is swallowed — this never throws
 * into the request. Timestamps are minted in the ROUTE (Date.now()) and passed in as nowMs so the
 * service stays clock-free; the only nondeterminism is a small volume shimmer (fine — it's a sim).
 *
 * Shapes/constants come from the shared contract (single source of truth).
 */
import type { Env } from '@/types/env';
import {
  BASELINE_STEP_CONV,
  COHORTS,
  FUNNEL_LIVE_TABLE,
  STAGE_KEYS,
  stageIndex,
  type Brand,
  type Cohort,
  type RealCohort,
} from '@/services/funnel/contract';

// Young-skewed cohort mix for ambient top-of-funnel arrivals (sums to 1.0) — matches the seed's tilt.
const COHORT_WEIGHTS: Record<RealCohort, number> = {
  gen_z: 0.3,
  millennial: 0.37,
  gen_x: 0.2,
  boomer: 0.13,
};

const DEFAULT_BRAND: Brand = 'Coach';
const DEFAULT_TICK_SESSIONS = 30;

// UPSERT-increment one (brand,cohort,stage) bucket — the ONLY way funnel_live is written.
// FUNNEL_LIVE_TABLE is a trusted contract constant (never user input), so interpolating it is safe.
const UPSERT_SQL =
  `INSERT INTO ${FUNNEL_LIVE_TABLE} (brand, cohort, stage, sessions, updated_ts)\n` +
  `VALUES (?1, ?2, ?3, ?4, ?5)\n` +
  `ON CONFLICT(brand, cohort, stage) DO UPDATE SET\n` +
  `  sessions = sessions + excluded.sessions,\n` +
  `  updated_ts = excluded.updated_ts`;

const emptyResult = (): { stage: string; added: number }[] => STAGE_KEYS.map((stage) => ({ stage, added: 0 }));
const toResult = (added: Map<string, number>): { stage: string; added: number }[] =>
  STAGE_KEYS.map((stage) => ({ stage, added: added.get(stage) ?? 0 }));

/**
 * Conversion INTO `toKey` for (brand,cohort) = BASELINE_STEP_CONV, overridden by the three
 * signature leaks so the simulated traffic mirrors the seed stories exactly:
 *   Coach·gen_z          add_payment_info → purchase           = 0.55 (BNPL hesitation)
 *   Kate Spade (any)     view_cart        → begin_checkout     = 0.55 (Empty-Cart Viewers)
 *   Stuart Weitzman(any) begin_checkout   → add_shipping_info  = 0.58 (shipping sticker-shock)
 */
function stepConv(brand: Brand, cohort: RealCohort, fromKey: string, toKey: string): number {
  if (brand === 'Coach' && cohort === 'gen_z' && fromKey === 'add_payment_info' && toKey === 'purchase') return 0.55;
  if (brand === 'Kate Spade' && fromKey === 'view_cart' && toKey === 'begin_checkout') return 0.55;
  if (brand === 'Stuart Weitzman' && fromKey === 'begin_checkout' && toKey === 'add_shipping_info') return 0.58;
  return BASELINE_STEP_CONV[toKey] ?? 1;
}

// ±12% multiplicative shimmer so ambient volume feels alive. Only ever scales the ENTRY count, so
// each cohort's down-funnel ratios stay exactly on the seed shape and the leaks never wash out.
const shimmer = (): number => 1 + (Math.random() * 2 - 1) * 0.12;

/**
 * AMBIENT TICK — `sessions` (~30) new add_to_cart sessions for `brand`, young-skewed across the
 * four cohorts, each cohort walked down the funnel on the seed's conversion shape. UPSERT-increments
 * funnel_live in a single batch. Returns the per-stage volume actually added (summed over cohorts).
 */
export async function simTick(
  env: Env,
  opts: { brand?: Brand; sessions?: number; nowMs: number },
): Promise<{ stage: string; added: number }[]> {
  const brand = opts.brand ?? DEFAULT_BRAND;
  const sessions = Math.max(0, Math.floor(opts.sessions ?? DEFAULT_TICK_SESSIONS));
  if (!env.DB || sessions <= 0) return emptyResult();

  const added = new Map<string, number>();
  const stmts: D1PreparedStatement[] = [];

  for (const cohort of COHORTS) {
    // Entry volume for this cohort = its share of `sessions`, with a little shimmer.
    let curr = Math.round(sessions * COHORT_WEIGHTS[cohort] * shimmer());
    for (let i = 0; i < STAGE_KEYS.length && curr > 0; i++) {
      if (i > 0) curr = Math.round(curr * stepConv(brand, cohort, STAGE_KEYS[i - 1], STAGE_KEYS[i]));
      if (curr <= 0) break;
      const stage = STAGE_KEYS[i];
      added.set(stage, (added.get(stage) ?? 0) + curr);
      stmts.push(env.DB.prepare(UPSERT_SQL).bind(brand, cohort, stage, curr, opts.nowMs));
    }
  }

  try {
    if (stmts.length) await env.DB.batch(stmts);
  } catch {
    /* best-effort: a failed write must never break the demo */
  }
  return toResult(added);
}

/**
 * AMPLIFY-ON-ACTION — inject `count` sessions that all reach `throughStage` (every stage from
 * add_to_cart through it, inclusive). convert=true also increments the stages AFTER throughStage
 * through purchase (full conversion → the leak shrinks); convert=false stops at throughStage (the
 * leak swells). cohort='all' fans the count out across the real cohorts by weight (funnel_live never
 * stores an 'all' row). UPSERT-increments funnel_live in one batch; returns per-stage volume added.
 */
export async function simAmplify(
  env: Env,
  opts: { brand: Brand; cohort: Cohort; throughStage: string; count: number; convert: boolean; nowMs: number },
): Promise<{ stage: string; added: number }[]> {
  const { brand, throughStage, convert, nowMs } = opts;
  const count = Math.max(0, Math.floor(opts.count));
  const through = stageIndex(throughStage);
  if (!env.DB || count <= 0 || through < 0) return emptyResult();

  // Last stage to touch: throughStage normally; all the way to purchase when converting.
  const lastIdx = convert ? STAGE_KEYS.length - 1 : through;

  // Targets: a single real cohort, or — for 'all' — the count fanned across all real cohorts.
  const targets: { cohort: RealCohort; n: number }[] =
    opts.cohort === 'all'
      ? COHORTS.map((co) => ({ cohort: co, n: Math.round(count * COHORT_WEIGHTS[co]) }))
      : [{ cohort: opts.cohort, n: count }];

  const added = new Map<string, number>();
  const stmts: D1PreparedStatement[] = [];

  for (const { cohort, n } of targets) {
    if (n <= 0) continue;
    for (let i = 0; i <= lastIdx; i++) {
      const stage = STAGE_KEYS[i];
      added.set(stage, (added.get(stage) ?? 0) + n);
      stmts.push(env.DB.prepare(UPSERT_SQL).bind(brand, cohort, stage, n, nowMs));
    }
  }

  try {
    if (stmts.length) await env.DB.batch(stmts);
  } catch {
    /* best-effort */
  }
  return toResult(added);
}

/** RESET — wipe the live overlay so the funnel falls back to seed + real demo_events. Best-effort. */
export async function simReset(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`DELETE FROM ${FUNNEL_LIVE_TABLE}`).run();
  } catch {
    /* best-effort */
  }
}
