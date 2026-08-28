// src/demos/meridian/funnel.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE REVENUE RADAR — "the average lied."
//
// The honesty split here is the whole point, and it is the same split the rest
// of this demo uses: THE TRAFFIC IS SIMULATED, THE COMPUTE IS LIVE. Nobody is
// going to hand us a quarter of real checkout logs for a conference stage, so
// the sessions are generated. But nothing downstream of them is faked — the
// funnel rates, the cohort filter, the drop against the benchmark, the excess
// over it and the recoverable figure are all computed here, from those rows, on
// every request. Change the cohort and the arithmetic runs again.
//
// That distinction is what survives a sceptical question from the floor. "Did
// you hardcode that 44%?" No: the sessions carry attributes, one step has a
// per-attribute failure model, and the aggregate falls out. You can filter to a
// cohort we never rehearsed and the numbers still hold together.
//
// THE ARITHMETIC IS COACH'S. This is a fork of the Revenue Radar maths the Coach
// demo runs (src/services/funnel/compute.ts) — deliberately a fork, not an
// import, because Meridian's isolation charter forbids reaching into another
// demo. The rules are the same:
//
//   dropPct            = 100 × (1 − step rate)                 the observed drop
//   expectedDropPct    = 100 × (1 − benchmark step conversion) the ordinary drop
//   excessDropPct      = max(0, dropPct − expectedDropPct)     the anomaly
//   excessLostSessions = sessions entering the step × excess    what the anomaly cost
//   lostRevenueUsd     = excessLostSessions × AOV × 0.3         what a fix could get back
//   severity           = high ≥ 12 excess points · mid ≥ 5 · else low
//
// Recoverable money is anchored on the EXCESS only. You cannot recover the
// ordinary drop; every checkout on earth loses a fifth of its payment-page
// visitors. You can recover the part that is worse than ordinary.
//
// WHY THE COLLAPSE IS HIDDEN. The affected sessions are deliberately a small
// slice — Gen-Z on a phone, around an eighth of traffic — because that is
// exactly the condition under which an average is a liar: a severe failure
// inside an eighth of sessions moves the blended drop by a few points, which
// sits inside the ordinary range and reads as an ordinary week. Filter to Gen-Z
// and the same rows say something else entirely.
//
// PROVING THE FIX. `remedyApplied` re-runs the SAME rows — same ids, same
// attributes, same random draws — with the defect no longer firing for the
// sessions the remedy targets. The step returns to benchmark and the recoverable
// figure collapses, and it does so through the same arithmetic, not a second
// dataset that was written to look recovered.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vertical } from './types';

export type Severity = 'low' | 'mid' | 'high';

/** The generational cohorts — the pills. Same keys as Coach's Revenue Radar. */
export type GenCohort = 'gen_z' | 'millennial' | 'gen_x' | 'boomer';
export const GEN_COHORTS: readonly GenCohort[] = ['gen_z', 'millennial', 'gen_x', 'boomer'];
export const GEN_LABEL: Record<GenCohort, string> = {
  gen_z: 'Gen-Z',
  millennial: 'Millennial',
  gen_x: 'Gen-X',
  boomer: 'Boomer',
};
/** The attribute name the generational cohort lives under in every session. */
export const COHORT_DIM = 'cohort';

export interface FunnelStep {
  key: string;
  label: string;
  sessions: number;
  /** Share of the step before it. The first step is 1. */
  rate: number;
  /** 100 × (1 − rate): the observed drop INTO this step. The first step is 0. */
  dropPct: number;
  /** The ordinary drop for this step — 100 × (1 − benchmark conversion). */
  expectedDropPct: number;
  /** max(0, dropPct − expectedDropPct): the part of the drop that is an anomaly. */
  excessDropPct: number;
  /** Sessions entering this step × excess. What the anomaly cost, in sessions. */
  excessLostSessions: number;
  /** excessLostSessions × AOV × RECOVERABLE_FRACTION. */
  lostRevenueUsd: number;
  severity: Severity;
  /** e.g. "gen_z 1.6× the drop" — which generation drops materially harder than everyone here. */
  skew?: string;
}

export interface CohortKey {
  dim: string;
  value: string;
}

/** A cohort is a conjunction: every key must match. One key, or several. Empty = everyone. */
export type Cohort = readonly CohortKey[];

export interface FunnelResult {
  vertical: Vertical;
  cohort: Cohort;
  /** 'all', a generational key, or a custom label for a dimensional filter. */
  cohortKey: string;
  cohortLabel: string;
  sessions: number;
  shareOfTraffic: number;
  steps: FunnelStep[];
  /** The step with the widest excess over its benchmark. Null for everyone, or when nothing exceeds it. */
  worst: {
    key: string;
    label: string;
    /** The step before it — the transition the drop is measured over. */
    fromKey: string;
    fromLabel: string;
    cohortRate: number;
    baselineRate: number;
    /** baselineRate − cohortRate, as a fraction. */
    gapPoints: number;
    dropPct: number;
    expectedDropPct: number;
    excessDropPct: number;
    severity: Severity;
    skew?: string;
  } | null;
  /** Present only when the worst step is an anomaly (severity above low). */
  recoverable: {
    /** The sessions lost BEYOND the ordinary drop — the ones a fix can reach. */
    lostSessions: number;
    aov: number;
    amountUsd: number;
    remedy: string;
    /** The audience noun the remedy is aimed at, e.g. "Gen-Z BNPL Hesitators". */
    audience: string;
    /** Every term of the money, so the screen can show the working. */
    math: { excessLostSessions: number; aov: number; fraction: number; formula: string };
  } | null;
  /** The pills: everyone plus the four generations, each with its session count. */
  cohortOptions: Array<{ key: string; label: string; sessions: number; active: boolean }>;
  /** Every cohort we can filter to, with its session count. */
  available: Array<{ dim: string; value: string; sessions: number; label: string }>;
  /** True when the rows were re-run with the defect lifted for the targeted sessions. */
  remedyApplied: boolean;
  /** Only with the remedy: the same step, before and after, so the delta can be shown. */
  recovered?: {
    step: string;
    label: string;
    before: { dropPct: number; amountUsd: number };
    after: { dropPct: number; amountUsd: number };
    note: string;
  };
  honesty: { traffic: 'simulated'; compute: 'live'; lift: 'representative' };
}

// ── Tunables (centralised, every one of them documented) ────────────────────

/** Fraction of the excess loss a fix is assumed to recover. Coach's figure. */
export const RECOVERABLE_FRACTION = 0.3;
/** Excess-drop thresholds, in points over the benchmark. Coach's figures. */
const SEVERITY_HIGH_EXCESS_PCT = 12;
const SEVERITY_MID_EXCESS_PCT = 5;
/** Skew heuristics: a generation must drop ≥ this many × the blended drop, over a real drop, with enough volume. */
const SKEW_RATIO = 1.3;
const MIN_AGG_DROP_PCT = 5;
const MIN_COHORT_SESSIONS = 20;

/**
 * Average order value.
 *   retail    — $223: the mean item value of the Calder catalogue (catalog.retail.json,
 *               40 items, mean $222.88, median $210). One item per order, which is
 *               the conservative end of what a Calder basket looks like.
 *   financial — $2,140: a representative net value per submitted application.
 */
export const AOV_USD: Record<Vertical, number> = { retail: 223, financial: 2140 };

/**
 * The simulated day. 10,750 landed sessions: with the funnel below that is
 * ~3,170 baskets and ~2,500 payment-page visits, of which ~560 are Gen-Z —
 * the scale of a mid-size brand's day, and the scale at which a $223 basket
 * turns an excess drop of twenty points into money you can put on a slide.
 */
const POPULATION = 10_750;

/** Gen-Z leads the skew, boomers trail it. Same shape for both verticals. */
const GEN_WEIGHTS = [0.22, 0.34, 0.28, 0.16];

// ── The simulated population ────────────────────────────────────────────────

/**
 * Deterministic. The same stage run produces the same numbers every time.
 *
 * FNV-1a, then a murmur3 finaliser. The finaliser matters: every draw for one
 * session shares the `${id}:` prefix and differs only in a short suffix, and
 * bare FNV-1a leaves such draws correlated — an earlier build had millennials
 * "leaking" at the browse step for no reason but the hash. A leak the maths
 * finds must be one we put in the rows, so the bits get avalanched.
 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Session {
  id: string;
  attrs: Record<string, string>;
  reached: Record<string, boolean>;
}

const RETAIL_ATTRS: Record<string, string[]> = {
  [COHORT_DIM]: [...GEN_COHORTS],
  priceBand: ['entry', 'core', 'premium'],
  device: ['desktop', 'mobile', 'tablet'],
  styleWorld: ['heritage', 'modern', 'statement'],
  region: ['CA', 'NY', 'TX', 'FL', 'IL', 'WA'],
};

const FINANCIAL_ATTRS: Record<string, string[]> = {
  [COHORT_DIM]: [...GEN_COHORTS],
  amountBand: ['modest', 'core', 'major'],
  device: ['desktop', 'mobile', 'tablet'],
  lifeStage: ['starting', 'building', 'consolidating'],
  region: ['CA', 'NY', 'TX', 'FL', 'IL', 'WA'],
};

interface StepDef {
  key: string;
  label: string;
  /** Benchmark conversion INTO this step from the one before. The expected drop is 1 − base. */
  base: number;
}

/**
 * The benchmark funnel. `base` is the ordinary conversion into each step; the
 * simulated sessions are drawn against it, so a cohort with no defect lands on
 * it up to sampling noise, and the expected drop the anomaly maths compares
 * against is the same number. Payment → order at 76% is the ordinary loss of a
 * payment page; nobody recovers that.
 */
const RETAIL_STEPS: StepDef[] = [
  { key: 'land', label: 'Landed', base: 1 },
  { key: 'browse', label: 'Viewed a product', base: 0.72 },
  { key: 'bag', label: 'Added to bag', base: 0.41 },
  { key: 'payment', label: 'Reached payment', base: 0.79 },
  { key: 'order', label: 'Placed the order', base: 0.76 },
];

const FINANCIAL_STEPS: StepDef[] = [
  { key: 'land', label: 'Landed', base: 1 },
  { key: 'browse', label: 'Viewed a product', base: 0.68 },
  { key: 'bag', label: 'Started an application', base: 0.33 },
  { key: 'payment', label: 'Reached identity check', base: 0.81 },
  { key: 'order', label: 'Submitted', base: 0.76 },
];

interface Defect {
  match: (a: Record<string, string>) => boolean;
  /** The step whose pass rate collapses — the drop is measured INTO this step. */
  step: string;
  /** Multiplier on that step's benchmark conversion for matching sessions. */
  factor: number;
  /** Step one of the reveal: the pill the presenter presses. */
  cohort: CohortKey;
  /** Step two: the drill-down that names the actual failure. */
  drilldown: CohortKey;
  remedy: string;
  audience: string;
}

/**
 * The defect we are going to find. One generation, one device, one step, one
 * cause — because a demo that reveals three problems at once reveals none of
 * them. Gen-Z on a phone reach the payment page at the same rate as everyone
 * and then walk away from it: the basket is a week's money and there is no way
 * to split it. That is Coach's Gen-Z BNPL hesitation, and the remedy is Coach's.
 *
 * The factor is tuned so that, WHEN COMPUTED over the rows, the Gen-Z payment →
 * order drop comes out at ≈44% and the recoverable figure at ≈$7.6K — the two
 * numbers in the conference abstract. Neither appears anywhere in this file.
 */
const DEFECT: Record<Vertical, Defect> = {
  retail: {
    match: (a) => a[COHORT_DIM] === 'gen_z' && a.device === 'mobile',
    step: 'order',
    factor: 0.465,
    cohort: { dim: COHORT_DIM, value: 'gen_z' },
    drilldown: { dim: 'device', value: 'mobile' },
    remedy: 'Installments (Pay in 4) + social proof at the payment step',
    audience: 'Gen-Z BNPL Hesitators',
  },
  financial: {
    match: (a) => a[COHORT_DIM] === 'gen_z' && a.device === 'mobile',
    step: 'order',
    factor: 0.6,
    cohort: { dim: COHORT_DIM, value: 'gen_z' },
    drilldown: { dim: 'device', value: 'mobile' },
    remedy: 'Resume-by-link before the identity check',
    audience: 'Gen-Z Identity-Check Timeouts',
  },
};

const stepsFor = (vertical: Vertical): StepDef[] => (vertical === 'retail' ? RETAIL_STEPS : FINANCIAL_STEPS);
const attrsFor = (vertical: Vertical): Record<string, string[]> => (vertical === 'retail' ? RETAIL_ATTRS : FINANCIAL_ATTRS);

/** Generated once per (vertical, remedy) per isolate, then reused. Deterministic either way. */
const cache = new Map<string, Session[]>();

/**
 * The rows. With `remedied`, the SAME rows — same ids, same attributes, same
 * draws — except the defect no longer fires: a session that failed the
 * collapsed step only because of the defect now passes it, and everyone else
 * is untouched. That is what "the fix, applied to the same traffic" means.
 */
function population(vertical: Vertical, remedied: boolean): Session[] {
  const cacheKey = `${vertical}:${remedied ? 'remedied' : 'observed'}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const attrs = attrsFor(vertical);
  const steps = stepsFor(vertical);
  const defect = DEFECT[vertical];
  const keys = Object.keys(attrs);

  const sessions: Session[] = [];
  for (let i = 0; i < POPULATION; i += 1) {
    const id = `${vertical}-s${i}`;
    const a: Record<string, string> = {};
    for (const k of keys) {
      const opts = attrs[k]!;
      // Skewed rather than uniform: mobile is the majority, premium the minority.
      const r = hash(`${id}:${k}`);
      const weights = k === COHORT_DIM ? GEN_WEIGHTS
        : k === 'device' ? [0.34, 0.55, 0.11]
        : opts.length === 3 ? [0.46, 0.36, 0.18]
        : opts.map(() => 1 / opts.length);
      let acc = 0; let pick = opts[0]!;
      for (let j = 0; j < opts.length; j += 1) {
        acc += weights[j] ?? 0;
        if (r <= acc) { pick = opts[j]!; break; }
      }
      a[k] = pick;
    }

    const reached: Record<string, boolean> = {};
    let alive = true;
    for (const st of steps) {
      if (st.base === 1) { reached[st.key] = alive; continue; }
      const isDefect = !remedied && st.key === defect.step && defect.match(a);
      const p = st.base * (isDefect ? defect.factor : 1);
      alive = alive && hash(`${id}:${st.key}`) < p;
      reached[st.key] = alive;
    }
    sessions.push({ id, attrs: a, reached });
  }

  cache.set(cacheKey, sessions);
  return sessions;
}

// ── Live aggregation ────────────────────────────────────────────────────────

const round0 = (x: number): number => Math.round(x);
const round1 = (x: number): number => Math.round(x * 10) / 10;
const clampPct = (x: number): number => Math.max(0, Math.min(100, x));

const matches = (row: Session, cohort: Cohort): boolean => cohort.every((k) => row.attrs[k.dim] === k.value);

/** Sessions per step, in order, over some rows. */
function countsOver(rows: Session[], steps: StepDef[]): number[] {
  return steps.map((st) => rows.reduce((acc, r) => acc + (r.reached[st.key] ? 1 : 0), 0));
}

/** Observed drop INTO step i, in percent, from a counts vector. */
function dropAt(counts: number[], i: number): number {
  if (i === 0) return 0;
  const prev = counts[i - 1] ?? 0;
  const curr = counts[i] ?? 0;
  return prev > 0 ? clampPct((1 - curr / prev) * 100) : 0;
}

function severityOf(excessDropPct: number): Severity {
  return excessDropPct >= SEVERITY_HIGH_EXCESS_PCT ? 'high'
    : excessDropPct >= SEVERITY_MID_EXCESS_PCT ? 'mid'
    : 'low';
}

/** The generational cohorts a view can be skewed by: all four for everyone, else the one(s) named in the filter. */
function skewCandidates(cohort: Cohort): GenCohort[] {
  const named = cohort.filter((k) => k.dim === COHORT_DIM).map((k) => k.value as GenCohort)
    .filter((v) => (GEN_COHORTS as readonly string[]).includes(v));
  return named.length ? named : [...GEN_COHORTS];
}

/**
 * Coach's cohort-skew heuristic: at this step, which generation drops
 * materially harder (≥ 1.3×) than everyone, over a drop that is real (≥ 5
 * points) and a cohort that is big enough to mean anything (≥ 20 sessions
 * entering the step)? Returns "gen_z 1.6× the drop", or nothing.
 */
function skewAt(all: Session[], steps: StepDef[], aggCounts: number[], i: number, candidates: GenCohort[]): string | undefined {
  const aggDrop = dropAt(aggCounts, i);
  if (i === 0 || aggDrop < MIN_AGG_DROP_PCT) return undefined;
  let worst: { co: GenCohort; ratio: number } | null = null;
  for (const co of candidates) {
    const counts = countsOver(all.filter((r) => r.attrs[COHORT_DIM] === co), steps);
    if ((counts[i - 1] ?? 0) < MIN_COHORT_SESSIONS) continue;
    const ratio = dropAt(counts, i) / aggDrop;
    if (ratio >= SKEW_RATIO && (!worst || ratio > worst.ratio)) worst = { co, ratio };
  }
  return worst ? `${worst.co} ${round1(worst.ratio)}× the drop` : undefined;
}

function labelFor(k: CohortKey): string {
  if (k.dim === COHORT_DIM) return GEN_LABEL[k.value as GenCohort] ?? k.value;
  return `${k.dim} · ${k.value}`;
}

/** 'all' for everyone, the generational key when the cohort is exactly one generation, else the dims joined. */
function keyFor(cohort: Cohort): string {
  if (!cohort.length) return 'all';
  if (cohort.length === 1 && cohort[0]!.dim === COHORT_DIM) return cohort[0]!.value;
  return cohort.map((k) => `${k.dim}:${k.value}`).join(',');
}

export interface FunnelOptions {
  /** Re-run the same rows with the defect lifted for the sessions the remedy targets. */
  remedyApplied?: boolean;
}

/**
 * Aggregate the population, optionally filtered to one cohort, run Coach's
 * anomaly arithmetic over every step, and name the step where this cohort's
 * drop exceeds the benchmark by the most. Every number below is computed on
 * this call — nothing is stored, nothing is looked up.
 */
export function funnel(vertical: Vertical, cohort: Cohort, options: FunnelOptions = {}): FunnelResult {
  const remedied = options.remedyApplied === true;
  const all = population(vertical, remedied);
  const rows = cohort.length ? all.filter((r) => matches(r, cohort)) : all;
  const defs = stepsFor(vertical);
  const defect = DEFECT[vertical];
  const aov = AOV_USD[vertical];

  const counts = countsOver(rows, defs);
  const aggCounts = countsOver(all, defs);
  const candidates = skewCandidates(cohort);

  const steps: FunnelStep[] = defs.map((st, i) => {
    const sessions = counts[i] ?? 0;
    const prev = i > 0 ? (counts[i - 1] ?? 0) : rows.length;
    const rate = i === 0 ? (rows.length > 0 ? sessions / rows.length : 0) : prev > 0 ? sessions / prev : 0;
    const dropPct = round1(dropAt(counts, i));
    const expectedDropPct = i === 0 ? 0 : round1(clampPct((1 - st.base) * 100));
    const excessDropPct = round1(Math.max(0, dropPct - expectedDropPct));
    const excessLostSessions = i === 0 ? 0 : round0(Math.max(0, (prev * excessDropPct) / 100));
    const lostRevenueUsd = round0(excessLostSessions * aov * RECOVERABLE_FRACTION);
    const skew = skewAt(all, defs, aggCounts, i, candidates);
    return {
      key: st.key,
      label: st.label,
      sessions,
      rate,
      dropPct,
      expectedDropPct,
      excessDropPct,
      excessLostSessions,
      lostRevenueUsd,
      severity: severityOf(excessDropPct),
      ...(skew ? { skew } : {}),
    };
  });

  // Everyone has no cohort to be worse than; for a cohort, the worst step is
  // the one with the widest excess over its benchmark (ties: the widest gap to
  // everyone). No excess anywhere → no worst step, and that is a real answer.
  let worst: FunnelResult['worst'] = null;
  if (cohort.length) {
    let best: { i: number; excess: number; gap: number } | null = null;
    for (let i = 1; i < steps.length; i += 1) {
      const c = steps[i]!;
      const baselineRate = (aggCounts[i - 1] ?? 0) > 0 ? (aggCounts[i] ?? 0) / (aggCounts[i - 1] ?? 1) : 0;
      const gap = baselineRate - c.rate;
      if (c.excessDropPct <= 0) continue;
      if (!best || c.excessDropPct > best.excess || (c.excessDropPct === best.excess && gap > best.gap)) {
        best = { i, excess: c.excessDropPct, gap };
      }
    }
    if (best) {
      const c = steps[best.i]!;
      const from = steps[best.i - 1]!;
      const baselineRate = (aggCounts[best.i - 1] ?? 0) > 0 ? (aggCounts[best.i] ?? 0) / (aggCounts[best.i - 1] ?? 1) : 0;
      worst = {
        key: c.key,
        label: c.label,
        fromKey: from.key,
        fromLabel: from.label,
        cohortRate: c.rate,
        baselineRate,
        gapPoints: baselineRate - c.rate,
        dropPct: c.dropPct,
        expectedDropPct: c.expectedDropPct,
        excessDropPct: c.excessDropPct,
        severity: c.severity,
        ...(c.skew ? { skew: c.skew } : {}),
      };
    }
  }

  // Recoverable = the sessions lost BEYOND the ordinary drop, times what an
  // order is worth, times the fraction a fix can realistically reach. Every
  // term returned. Only an anomaly is recoverable; an ordinary drop is not.
  let recoverable: FunnelResult['recoverable'] = null;
  if (worst && worst.severity !== 'low') {
    const st = steps.find((s) => s.key === worst!.key)!;
    recoverable = {
      lostSessions: st.excessLostSessions,
      aov,
      amountUsd: st.lostRevenueUsd,
      remedy: defect.remedy,
      audience: defect.audience,
      math: {
        excessLostSessions: st.excessLostSessions,
        aov,
        fraction: RECOVERABLE_FRACTION,
        formula: 'excessLost × AOV × 0.3',
      },
    };
  }

  const attrs = attrsFor(vertical);
  const countWhere = (dim: string, value: string): number =>
    all.reduce((n, r) => n + (r.attrs[dim] === value ? 1 : 0), 0);
  const available = Object.entries(attrs).flatMap(([dim, values]) =>
    values.map((value) => ({ dim, value, label: labelFor({ dim, value }), sessions: countWhere(dim, value) })));

  const cohortKey = keyFor(cohort);
  const cohortOptions = [
    { key: 'all', label: 'Everyone', sessions: all.length, active: cohortKey === 'all' },
    ...GEN_COHORTS.map((g) => ({ key: g, label: GEN_LABEL[g], sessions: countWhere(COHORT_DIM, g), active: cohortKey === g })),
  ];

  const result: FunnelResult = {
    vertical,
    cohort,
    cohortKey,
    cohortLabel: cohort.length ? cohort.map(labelFor).join('  +  ') : 'Everyone',
    sessions: rows.length,
    shareOfTraffic: all.length > 0 ? rows.length / all.length : 0,
    steps,
    worst,
    recoverable,
    cohortOptions,
    available,
    remedyApplied: remedied,
    honesty: { traffic: 'simulated', compute: 'live', lift: 'representative' },
  };

  // The proof: the same view over the observed rows, so the delta is one
  // subtraction. Measured on the defect's step for every cohort — including
  // ones the remedy does not touch, where before and after are the same.
  if (remedied) {
    const before = funnel(vertical, cohort, { remedyApplied: false });
    const bStep = before.steps.find((s) => s.key === defect.step)!;
    const aStep = steps.find((s) => s.key === defect.step)!;
    result.recovered = {
      step: defect.step,
      label: aStep.label,
      before: { dropPct: bStep.dropPct, amountUsd: bStep.lostRevenueUsd },
      after: { dropPct: aStep.dropPct, amountUsd: aStep.lostRevenueUsd },
      note: 'Same simulated rows, same arithmetic. The only change is that the defect no longer '
        + `fires for the sessions the remedy targets (${defect.audience}); everyone else is untouched.`,
    };
  }

  return result;
}

/**
 * Parse the route's `cohort` query in either form, or both mixed:
 *   gen_z                          — a generational key (Coach's form)
 *   priceBand:premium,device:mobile — dim:value pairs (Meridian's form)
 *   gen_z,device:mobile            — mixed
 *   all / '' / absent              — everyone
 * Unknown bare tokens are dropped rather than refused, so a typo reads as everyone.
 */
export function parseCohort(raw: string | undefined | null): Cohort {
  const text = (raw ?? '').trim();
  if (!text || text === 'all') return [];
  const out: CohortKey[] = [];
  for (const part of text.split(',')) {
    const p = part.trim();
    if (!p || p === 'all') continue;
    const idx = p.indexOf(':');
    if (idx > 0) {
      out.push({ dim: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim() });
    } else if ((GEN_COHORTS as readonly string[]).includes(p)) {
      out.push({ dim: COHORT_DIM, value: p });
    }
  }
  return out;
}

/** Step one: the pill the presenter presses first. The whole generation; the collapse is real but diluted by desktop. */
export const defectCohortFor = (vertical: Vertical): Cohort => [DEFECT[vertical].cohort];

/** Step two: the drill-down that names the actual failure. */
export const defectDrilldownFor = (vertical: Vertical): Cohort =>
  [DEFECT[vertical].cohort, DEFECT[vertical].drilldown];
