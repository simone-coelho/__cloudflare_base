// src/demos/meridian/funnel.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE COHORT REVEAL — "the average lied."
//
// The honesty split here is the whole point, and it is the same split the rest
// of this demo uses: THE TRAFFIC IS SIMULATED, THE COMPUTE IS LIVE. Nobody is
// going to hand us a quarter of real checkout logs for a conference stage, so
// the sessions are generated. But nothing downstream of them is faked — the
// funnel rates, the cohort filter, the gap against benchmark and the recoverable
// figure are all computed here, from those rows, on every request. Change the
// cohort and the arithmetic runs again.
//
// That distinction is what survives a sceptical question from the floor. "Did
// you hardcode that collapse?" No: the sessions carry attributes, the payment
// step has a per-attribute failure model, and the aggregate falls out. You can
// filter to a cohort we never rehearsed and the numbers still hold together.
//
// WHY THE COLLAPSE IS HIDDEN. The affected sessions are deliberately a small
// slice — around a tenth of traffic — because that is exactly the condition
// under which an average is a liar: a severe failure inside a tenth of sessions
// moves the blended rate by only a few points, which reads as an ordinary week.
//
// TWO STEPS, NOT ONE. Filtering to a single attribute DILUTES the finding,
// because only part of that cohort is affected — and that is worth showing
// rather than hiding. The presenter filters once and sees a real but partial
// gap, then adds the second attribute and watches the gap roughly double. That
// is what diagnosis actually looks like, and it is far more convincing than a
// number that happens to be enormous the first time you look at it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Vertical } from './types';

export interface FunnelStep {
  key: string;
  label: string;
  sessions: number;
  /** Share of the step before it. The first step is 1. */
  rate: number;
}

export interface CohortKey {
  dim: string;
  value: string;
}

/** A cohort is a conjunction: every key must match. One key, or several. */
export type Cohort = readonly CohortKey[];

export interface FunnelResult {
  vertical: Vertical;
  cohort: Cohort;
  cohortLabel: string;
  sessions: number;
  shareOfTraffic: number;
  steps: FunnelStep[];
  /** The step that under-performs the all-visitor baseline by the widest margin. */
  worst: {
    key: string;
    label: string;
    cohortRate: number;
    baselineRate: number;
    gapPoints: number;
  } | null;
  recoverable: {
    lostSessions: number;
    aov: number;
    /** Sessions × gap × AOV, with every term returned so the screen can show the working. */
    amountUsd: number;
    remedy: string;
  } | null;
  /** Every cohort we can filter to, with its session count. */
  available: Array<{ dim: string; value: string; sessions: number; label: string }>;
  honesty: { traffic: 'simulated'; compute: 'live'; lift: 'representative' };
}

// ── The simulated population ────────────────────────────────────────────────

/** Deterministic. The same stage run produces the same numbers every time. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

interface Session {
  id: string;
  attrs: Record<string, string>;
  reached: Record<string, boolean>;
}

const RETAIL_ATTRS: Record<string, string[]> = {
  priceBand: ['entry', 'core', 'premium'],
  device: ['desktop', 'mobile', 'tablet'],
  styleWorld: ['heritage', 'modern', 'statement'],
  region: ['CA', 'NY', 'TX', 'FL', 'IL', 'WA'],
};

const FINANCIAL_ATTRS: Record<string, string[]> = {
  amountBand: ['modest', 'core', 'major'],
  device: ['desktop', 'mobile', 'tablet'],
  lifeStage: ['starting', 'building', 'consolidating'],
  region: ['CA', 'NY', 'TX', 'FL', 'IL', 'WA'],
};

const RETAIL_STEPS = [
  { key: 'land', label: 'Landed', base: 1 },
  { key: 'browse', label: 'Viewed a product', base: 0.72 },
  { key: 'bag', label: 'Added to bag', base: 0.41 },
  { key: 'payment', label: 'Reached payment', base: 0.79 },
  { key: 'order', label: 'Placed the order', base: 0.86 },
];

const FINANCIAL_STEPS = [
  { key: 'land', label: 'Landed', base: 1 },
  { key: 'browse', label: 'Viewed a product', base: 0.68 },
  { key: 'bag', label: 'Started an application', base: 0.33 },
  { key: 'payment', label: 'Reached identity check', base: 0.81 },
  { key: 'order', label: 'Submitted', base: 0.84 },
];

/**
 * The defect we are going to find. One attribute pair, one step, one cause —
 * because a demo that reveals three problems at once reveals none of them.
 *
 * Chosen to be *plausible* rather than convenient: a wallet-payment sheet that
 * fails on one device class for high-value baskets is the kind of thing that
 * really does hide inside a blended conversion rate for a quarter.
 */
const DEFECT = {
  retail: {
    match: (a: Record<string, string>) => a.device === 'mobile' && a.priceBand === 'premium',
    step: 'payment',
    /** Multiplier applied to that step's pass rate for matching sessions. */
    factor: 0.39,
    cohort: { dim: 'priceBand', value: 'premium' } as CohortKey,
    remedy: 'Wallet payment is failing on mobile for premium baskets. Serve the '
      + 'saved-card step first for this cohort and keep wallet as the alternate.',
    aov: 486,
  },
  financial: {
    match: (a: Record<string, string>) => a.device === 'mobile' && a.amountBand === 'major',
    step: 'payment',
    factor: 0.41,
    cohort: { dim: 'amountBand', value: 'major' } as CohortKey,
    remedy: 'Identity verification is timing out on mobile for major applications. '
      + 'Offer the resume-by-link path to this cohort before the check runs.',
    aov: 2140,
  },
} as const;

const POPULATION = 24_000;

/** Generated once per vertical per isolate, then reused. Deterministic either way. */
const cache = new Map<Vertical, Session[]>();

function population(vertical: Vertical): Session[] {
  const hit = cache.get(vertical);
  if (hit) return hit;

  const attrs = vertical === 'retail' ? RETAIL_ATTRS : FINANCIAL_ATTRS;
  const steps = vertical === 'retail' ? RETAIL_STEPS : FINANCIAL_STEPS;
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
      const weights = k === 'device' ? [0.34, 0.55, 0.11]
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
      const isDefect = st.key === defect.step && defect.match(a);
      const p = st.base * (isDefect ? defect.factor : 1);
      alive = alive && hash(`${id}:${st.key}`) < p;
      reached[st.key] = alive;
    }
    sessions.push({ id, attrs: a, reached });
  }

  cache.set(vertical, sessions);
  return sessions;
}

// ── Live aggregation ────────────────────────────────────────────────────────

function stepsOver(rows: Session[], vertical: Vertical): FunnelStep[] {
  const defs = vertical === 'retail' ? RETAIL_STEPS : FINANCIAL_STEPS;
  const out: FunnelStep[] = [];
  let prev = rows.length;
  for (const st of defs) {
    const n = rows.reduce((acc, r) => acc + (r.reached[st.key] ? 1 : 0), 0);
    out.push({ key: st.key, label: st.label, sessions: n, rate: prev > 0 ? n / prev : 0 });
    prev = n;
  }
  return out;
}

/**
 * Aggregate the population, optionally filtered to one cohort, and name the step
 * where that cohort falls furthest behind everyone. Every number below is
 * computed on this call — nothing is stored, nothing is looked up.
 */
export function funnel(vertical: Vertical, cohort: Cohort): FunnelResult {
  const all = population(vertical);
  const rows = cohort.length
    ? all.filter((r) => cohort.every((k) => r.attrs[k.dim] === k.value))
    : all;

  const steps = stepsOver(rows, vertical);
  const baseline = stepsOver(all, vertical);
  const defect = DEFECT[vertical];

  let worst: FunnelResult['worst'] = null;
  if (cohort.length) {
    for (let i = 0; i < steps.length; i += 1) {
      const c = steps[i]!; const b = baseline[i]!;
      if (c.rate >= b.rate) continue;
      const gap = b.rate - c.rate;
      if (!worst || gap > worst.gapPoints) {
        worst = { key: c.key, label: c.label, cohortRate: c.rate, baselineRate: b.rate, gapPoints: gap };
      }
    }
  }

  // Recoverable = the sessions that reached the failing step, times the gap to
  // the baseline pass rate, times what an order is worth. Three terms, all shown.
  let recoverable: FunnelResult['recoverable'] = null;
  if (worst && worst.gapPoints > 0.05) {
    const idx = steps.findIndex((s) => s.key === worst!.key);
    const entering = idx > 0 ? steps[idx - 1]!.sessions : rows.length;
    const lost = entering * worst.gapPoints;
    recoverable = {
      lostSessions: Math.round(lost),
      aov: defect.aov,
      amountUsd: Math.round(lost * defect.aov),
      remedy: defect.remedy,
    };
  }

  const attrs = vertical === 'retail' ? RETAIL_ATTRS : FINANCIAL_ATTRS;
  const available = Object.entries(attrs).flatMap(([dim, values]) =>
    values.map((value) => ({
      dim, value,
      label: `${dim} · ${value}`,
      sessions: all.reduce((n, r) => n + (r.attrs[dim] === value ? 1 : 0), 0),
    })));

  return {
    vertical,
    cohort,
    cohortLabel: cohort.length ? cohort.map((k) => `${k.dim} · ${k.value}`).join('  +  ') : 'Everyone',
    sessions: rows.length,
    shareOfTraffic: all.length > 0 ? rows.length / all.length : 0,
    steps,
    worst,
    recoverable,
    available,
    honesty: { traffic: 'simulated', compute: 'live', lift: 'representative' },
  };
}

/** Step one: the cohort the presenter filters to first. Real gap, partly diluted. */
export const defectCohortFor = (vertical: Vertical): Cohort => [DEFECT[vertical].cohort];

/** Step two: the drill-down that names the actual failure. */
export const defectDrilldownFor = (vertical: Vertical): Cohort =>
  [DEFECT[vertical].cohort, { dim: 'device', value: 'mobile' }];
