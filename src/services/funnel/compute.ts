/**
 * Revenue Radar — FUNNEL COMPUTE.
 *
 * computeFunnel(env, { brand, cohort }) builds a GA4-shaped checkout funnel for one
 * (brand, cohort) by summing three sources per stage:
 *   1. funnel_seed   — persistent "representative day" baseline   (cohort-dimensioned)
 *   2. funnel_live   — simulator / amplify-on-action overlay      (cohort-dimensioned)
 *   3. demo_events   — REAL Coach checkout clicks                 (cohortless; LIVE_BRAND only)
 *
 * Everything is defensive: the funnel_* tables are created by a migration built in
 * parallel and may not exist yet, rows may be missing, and demo_events may be empty.
 * Any read failure is treated as zero — this function never throws.
 *
 * All shapes/constants come from the shared contract (single source of truth).
 */
import type { Env } from '@/types/env';
import {
  STAGES,
  COHORTS,
  BRAND_AOV_USD,
  BASELINE_STEP_CONV,
  CHECKOUT_EVENT_TYPES,
  LIVE_BRAND,
  FUNNEL_SEED_TABLE,
  FUNNEL_LIVE_TABLE,
  type Brand,
  type Cohort,
  type FunnelResult,
  type FunnelStageResult,
  type FunnelLeak,
} from '@/services/funnel/contract';

// ───────────────────────── Tunables (centralized) ─────────────────────────
/** Fraction of lost revenue assumed recoverable by an intervention (cart recovery, BNPL, …). */
const RECOVERABLE_FRACTION = 0.3;
/** EXCESS-drop% thresholds for leak severity — the drop OVER the expected baseline, so a
 *  natural baseline drop (e.g. the normal ~32% begin-checkout step) reads as 'low', not a leak. */
const SEVERITY_HIGH_EXCESS_PCT = 12;
const SEVERITY_MED_EXCESS_PCT = 5;
/** Cohort-skew heuristics: a cohort must be ≥ this many× the aggregate drop, over a real drop, with enough volume. */
const SKEW_RATIO = 1.3;
const MIN_AGG_DROP_PCT = 5;
const MIN_COHORT_SESSIONS = 20;

/** Live event types the Coach checkout emits, keyed back onto stages: CHECKOUT_EVENT_TYPES + the entry add_to_cart. */
const LIVE_EVENT_TYPES = ['add_to_cart', ...CHECKOUT_EVENT_TYPES] as const;

// ───────────────────────── small numeric helpers ─────────────────────────
const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round0 = (x: number): number => Math.round(x);
const round1 = (x: number): number => Math.round(x * 10) / 10;
const clampPct = (x: number): number => Math.max(0, Math.min(100, x));

type StageMap = Map<string, number>; // stage key -> sessions
type CohortStageMap = Map<string, StageMap>; // cohort -> (stage -> sessions)

// ───────────────────────── data access (all defensive) ─────────────────────────

/**
 * Sum sessions per (cohort, stage) for one cohort-dimensioned funnel table.
 * `table` is ALWAYS a trusted contract constant (FUNNEL_SEED_TABLE / FUNNEL_LIVE_TABLE),
 * never user input, so interpolating it is safe; brand stays parameterized.
 * Missing table / unreadable rows → empty map (treated as zero).
 */
async function fetchByCohort(env: Env, table: string, brand: Brand): Promise<CohortStageMap> {
  const out: CohortStageMap = new Map();
  if (!env.DB) return out;
  try {
    const res = await env.DB
      .prepare(
        `SELECT cohort, stage, SUM(sessions) AS sessions
           FROM ${table}
          WHERE brand = ?1
          GROUP BY cohort, stage`
      )
      .bind(brand)
      .all();
    const rows = (res?.results ?? []) as Array<{ cohort?: unknown; stage?: unknown; sessions?: unknown }>;
    for (const r of rows) {
      if (!r || typeof r.cohort !== 'string' || typeof r.stage !== 'string') continue;
      const m = out.get(r.cohort) ?? new Map<string, number>();
      m.set(r.stage, (m.get(r.stage) ?? 0) + toNum(r.sessions));
      out.set(r.cohort, m);
    }
  } catch {
    /* table missing (migration built in parallel) or unreadable — treat as no rows */
  }
  return out;
}

/**
 * Real Coach checkout sessions from demo_events: COUNT(DISTINCT session_id) per stage
 * event_type. These rows carry no cohort, so the caller adds them to every view.
 * Missing demo_events / unreadable rows → empty map.
 */
async function fetchLiveEventSessions(env: Env): Promise<StageMap> {
  const out: StageMap = new Map();
  if (!env.DB) return out;
  const placeholders = LIVE_EVENT_TYPES.map((_, i) => `?${i + 1}`).join(', ');
  try {
    const res = await env.DB
      .prepare(
        `SELECT event_type, COUNT(DISTINCT session_id) AS sessions
           FROM demo_events
          WHERE source = 'demo'
            AND session_id IS NOT NULL
            AND event_type IN (${placeholders})
          GROUP BY event_type`
      )
      .bind(...LIVE_EVENT_TYPES)
      .all();
    const rows = (res?.results ?? []) as Array<{ event_type?: unknown; sessions?: unknown }>;
    for (const r of rows) {
      if (r && typeof r.event_type === 'string') out.set(r.event_type, toNum(r.sessions));
    }
  } catch {
    /* demo_events missing or unreadable — no live overlay */
  }
  return out;
}

// ───────────────────────── pure assembly helpers ─────────────────────────

function mergeCohortMaps(a: CohortStageMap, b: CohortStageMap): CohortStageMap {
  const out: CohortStageMap = new Map();
  for (const src of [a, b]) {
    for (const [cohort, stages] of src) {
      const m = out.get(cohort) ?? new Map<string, number>();
      for (const [stage, n] of stages) m.set(stage, (m.get(stage) ?? 0) + n);
      out.set(cohort, m);
    }
  }
  return out;
}

/** Step drop% from stage i → i+1 for a given stage map (clamped to [0,100]). */
function dropAt(map: StageMap, i: number): number {
  const prev = map.get(STAGES[i].key) ?? 0;
  const curr = map.get(STAGES[i + 1].key) ?? 0;
  return prev > 0 ? clampPct((1 - curr / prev) * 100) : 0;
}

// ───────────────────────── main ─────────────────────────

export async function computeFunnel(env: Env, opts: { brand: Brand; cohort: Cohort }): Promise<FunnelResult> {
  const { brand, cohort } = opts;

  // 1. Cohort-dimensioned baseline = funnel_seed + funnel_live (read across ALL real cohorts;
  //    we slice/sum in JS so 'all' and the per-cohort skew analysis share one read).
  const seedByCohort = await fetchByCohort(env, FUNNEL_SEED_TABLE, brand);
  const liveByCohort = await fetchByCohort(env, FUNNEL_LIVE_TABLE, brand);
  const byCohort = mergeCohortMaps(seedByCohort, liveByCohort);

  // Brand aggregate across the four real cohorts ('all' base + skew reference; never sums a stray 'all' row).
  const aggByStage: StageMap = new Map();
  for (const co of COHORTS) {
    const m = byCohort.get(co);
    if (!m) continue;
    for (const [stage, n] of m) aggByStage.set(stage, (aggByStage.get(stage) ?? 0) + n);
  }

  // Requested-view base, before the live overlay: 'all' = aggregate, else the single cohort.
  const baseByStage: StageMap =
    cohort === 'all' ? new Map(aggByStage) : new Map(byCohort.get(cohort) ?? new Map<string, number>());

  // 2. Real Coach checkout overlay (cohortless → added to every requested view; LIVE_BRAND only).
  const liveEvents: StageMap = brand === LIVE_BRAND ? await fetchLiveEventSessions(env) : new Map();

  // 3. Final sessions per stage, in canonical order = base + live overlay.
  const sessionsByStage: StageMap = new Map();
  for (const def of STAGES) {
    sessionsByStage.set(def.key, (baseByStage.get(def.key) ?? 0) + (liveEvents.get(def.eventType) ?? 0));
  }

  // 4. stages[] — sessions, step conversion vs previous stage (stage 0 = 100), and drop.
  const stages: FunnelStageResult[] = STAGES.map((def, i) => {
    const sessions = round0(sessionsByStage.get(def.key) ?? 0);
    let stepConvPct = 100;
    if (i > 0) {
      const prev = sessionsByStage.get(STAGES[i - 1].key) ?? 0;
      stepConvPct = prev > 0 ? round1(clampPct((sessions / prev) * 100)) : 0;
    }
    return { stage: def.key, label: def.label, sessions, stepConvPct, dropPct: round1(100 - stepConvPct) };
  });

  // 5. leaks[] — one per consecutive stage pair.
  const aov = BRAND_AOV_USD[brand] ?? 0;
  const skewCandidates: string[] = cohort === 'all' ? [...COHORTS] : [cohort];
  const leaks: FunnelLeak[] = [];
  let recoverableRevenueUsd = 0;

  for (let i = 0; i < STAGES.length - 1; i++) {
    const from = stages[i];
    const to = stages[i + 1];
    const dropPct = to.dropPct;
    const lostSessions = Math.max(0, from.sessions - to.sessions);
    // Anomaly framing: how much WORSE than the expected baseline drop this step is.
    // Natural baseline drops → excess ≈ 0 → 'low'; only true leaks (Coach·gen_z payment, etc.) escalate.
    const expectedConv = BASELINE_STEP_CONV[to.stage] ?? 1; // expected prev→this conversion
    const expectedDropPct = clampPct((1 - expectedConv) * 100);
    const excessDropPct = round1(Math.max(0, dropPct - expectedDropPct));
    const excessLostSessions = round0(Math.max(0, (from.sessions * excessDropPct) / 100));
    // Recoverable $ is anchored on the EXCESS (anomalous) loss only — you can't recover the baseline drop.
    const lostRevenueUsd = round0(excessLostSessions * aov * RECOVERABLE_FRACTION);
    const severity: FunnelLeak['severity'] =
      excessDropPct >= SEVERITY_HIGH_EXCESS_PCT ? 'high' : excessDropPct >= SEVERITY_MED_EXCESS_PCT ? 'med' : 'low';

    // cohortSkew: which cohort drops materially harder than the brand aggregate at this step.
    // Baseline is the cohort-only aggregate (excludes cohortless demo_events) so it stays comparable.
    let cohortSkew: string | undefined;
    const aggDrop = dropAt(aggByStage, i);
    if (aggDrop >= MIN_AGG_DROP_PCT) {
      let worst: { co: string; ratio: number } | null = null;
      for (const co of skewCandidates) {
        if (co === 'all') continue;
        const m = byCohort.get(co);
        if (!m) continue;
        const prev = m.get(STAGES[i].key) ?? 0;
        if (prev < MIN_COHORT_SESSIONS) continue;
        const ratio = dropAt(m, i) / aggDrop;
        if (ratio >= SKEW_RATIO && (!worst || ratio > worst.ratio)) worst = { co, ratio };
      }
      if (worst) cohortSkew = `${worst.co} ${round1(worst.ratio)}× the drop`;
    }

    leaks.push({
      fromStage: from.stage,
      toStage: to.stage,
      fromLabel: from.label,
      toLabel: to.label,
      dropPct,
      lostSessions,
      lostRevenueUsd,
      excessDropPct,
      excessLostSessions,
      severity,
      ...(cohortSkew ? { cohortSkew } : {}),
    });

    if (severity !== 'low') recoverableRevenueUsd += lostRevenueUsd;
  }

  // 6. Headline metrics.
  const entry = sessionsByStage.get('add_to_cart') ?? 0;
  const purchased = sessionsByStage.get('purchase') ?? 0;
  const overallConvPct = entry > 0 ? round1((purchased / entry) * 100) : 0;

  return {
    brand,
    cohort,
    generatedAt: Date.now(),
    stages,
    leaks,
    overallConvPct,
    recoverableRevenueUsd,
  };
}
