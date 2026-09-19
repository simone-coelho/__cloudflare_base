// src/measure/holdout.ts
// ---------------------------------------------------------------------------
// The incrementality number, with its uncertainty, in words a person can read.
//
// The day report (src/learn/report.ts) gives each holdout arm a rate: credited
// outcomes over decisions. A rate on its own invites the first question any
// data scientist asks, "is that difference real or is it the 68 people in the
// holdout?", and the second, "how long until we know?". This module answers
// both from the two counts per arm and nothing else. Pure; no I/O.
//
// SYMBOLS, ONCE.
//   n        decisions served on an arm
//   s        of those, the ones credited with an outcome under the policy
//   p        the observed rate, s / n
//   z        the normal quantile for the confidence level: 1.96 is 95%
//   lo, hi   the bounds of an interval that would contain the true rate 95% of
//            the time the experiment was repeated
//
// THE INTERVALS. A rate's interval is Wilson's score interval, which behaves
// at small n and at p near zero, where the textbook p ± z·sqrt(p(1-p)/n)
// collapses to a point or crosses below zero. A difference of two rates uses
// Newcombe's hybrid score interval (method 10 in Newcombe 1998), built from the
// two Wilson intervals, for the same reason. Neither needs a continuity
// correction to be honest at the sizes a 5% holdout produces.
//
// WHAT A VERDICT MEANS. The difference is called only when its interval
// excludes zero. "Undecided" is a result, not a failure, and the words say how
// many more decisions the holdout needs before a difference of the observed
// size could be called at 80% power. That number is the honest answer to
// "how long".
// ---------------------------------------------------------------------------

export interface ArmCount {
  /** Decisions served on the arm. */
  n: number;
  /** Decisions credited with an outcome under the attribution policy. */
  s: number;
}

export interface Proportion {
  p: number;
  lo: number;
  hi: number;
}

export interface ArmSummary extends ArmCount {
  arm: string;
  rate: Proportion;
}

export type Verdict = 'treatment_better' | 'control_better' | 'undecided';

/**
 * Pre-set targets, as RELATIVE lift of the treatment rate over the control rate
 * (BTIE §6.4.2: "CVR lift vs holdout, minimum +10 %, target +40 %, stretch +60 %").
 * Set before any money is spent; the comparison only ever reports against them.
 */
export interface Targets { minimum: number; target: number; stretch: number }

/** Tapestry's own numbers, from their measurement chapter. A tenant may set its own. */
export const TAPESTRY_TARGETS: Targets = { minimum: 0.10, target: 0.40, stretch: 0.60 };

export type Standing = 'reached_stretch' | 'reached_target' | 'reached_minimum' | 'on_track' | 'below' | 'undecided';

export interface TargetReading {
  targets: Targets;
  /**
   * The relative lift's interval: Katz's log interval on the two arms' RAW
   * rates (F25 §7.3). Null when the control rate is zero, and null when the raw
   * counts the log interval needs were not supplied — a relative interval is
   * never reconstructed by dividing an absolute interval by a rounded rate.
   */
  relativeLow: number | null;
  relativeHigh: number | null;
  /**
   * reached_*: the interval's LOW end clears that target, so the target is met at
   * this confidence. on_track: the point estimate clears the minimum but the
   * interval does not yet. below: the point estimate is under the minimum.
   */
  standing: Standing;
}

export interface CompareOptions {
  /** 0.90, 0.95 or 0.99. Tapestry's rule is 90 % or better; the default stays 95 %. */
  confidence?: number;
  /** null switches the target reading off. */
  targets?: Targets | null;
}

export interface ArmComparison {
  control: ArmSummary;
  treatment: ArmSummary;
  /** treatment rate minus control rate, in absolute terms, with its interval. */
  difference: Proportion;
  /** (treatment − control) / control. Null when the control rate is zero. */
  relative: number | null;
  verdict: Verdict;
  /** Decisions PER ARM at which a difference of the observed size could be called at 80% power. Null when the rates are equal. */
  neededPerArm: number | null;
  /** The confidence the intervals above are at. */
  confidence: number;
  /** The same difference at the other everyday confidence (90 beside 95), so nobody has to rerun. */
  alsoAt: { confidence: number; difference: Proportion; verdict: Verdict };
  /** Where the observed lift stands against the pre-set targets. Absent when targets were switched off. */
  targets?: TargetReading;
  /** The whole thing, in one sentence a person can read. */
  words: string;
}

const Z95 = 1.959963984540054;
const Z80_POWER = 0.8416212335729143;

/** The two-sided normal quantile for a confidence level. Exact at the three everyday levels; interpolated elsewhere. */
export function zFor(confidence: number): number {
  const c = clamp01(finite(confidence) || 0.95);
  if (Math.abs(c - 0.90) < 1e-9) return 1.6448536269514722;
  if (Math.abs(c - 0.95) < 1e-9) return Z95;
  if (Math.abs(c - 0.99) < 1e-9) return 2.5758293035489004;
  // Acklam's inverse-normal approximation for anything else, relative error under 1.2e-9.
  const p = 1 - (1 - c) / 2;   // the upper tail's probability: two-sided, so half the remainder on each side
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const cc = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const tail = (q: number) => (((((cc[0] * q + cc[1]) * q + cc[2]) * q + cc[3]) * q + cc[4]) * q + cc[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p <= 1 - 0.02425) {
    const q = p - 0.5, r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return -tail(Math.sqrt(-2 * Math.log(1 - p)));
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const finite = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Wilson's score interval for s successes in n trials. n = 0 gives the whole line: we know nothing. */
export function wilson(s: number, n: number, z = Z95): Proportion {
  const N = Math.max(0, Math.floor(finite(n)));
  const S = Math.min(N, Math.max(0, finite(s)));
  if (N === 0) return { p: 0, lo: 0, hi: 1 };
  const p = S / N;
  const z2 = z * z;
  const denom = 1 + z2 / N;
  const centre = (p + z2 / (2 * N)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / N + z2 / (4 * N * N))) / denom;
  return { p: r4(p), lo: r4(clamp01(centre - half)), hi: r4(clamp01(centre + half)) };
}

/**
 * Newcombe's hybrid score interval for p1 − p2, from the two Wilson intervals.
 * With n = 0 on either side the interval is the whole range, honestly.
 */
export function newcombe(a: ArmCount, b: ArmCount, z = Z95): Proportion {
  const wa = wilson(a.s, a.n, z);
  const wb = wilson(b.s, b.n, z);
  const d = wa.p - wb.p;
  if (a.n === 0 || b.n === 0) return { p: r4(d), lo: -1, hi: 1 };
  const lo = d - Math.sqrt((wa.p - wa.lo) ** 2 + (wb.hi - wb.p) ** 2);
  const hi = d + Math.sqrt((wa.hi - wa.p) ** 2 + (wb.p - wb.lo) ** 2);
  return { p: r4(d), lo: r4(Math.max(-1, lo)), hi: r4(Math.min(1, hi)) };
}

/**
 * Decisions per arm needed to call a difference of the observed size with 95%
 * confidence at 80% power, two-sided, equal arms. Null when there is no
 * difference to size, or no rate to size it against.
 */
export function neededPerArm(control: ArmCount, treatment: ArmCount): number | null {
  if (control.n === 0 || treatment.n === 0) return null;
  const pc = control.s / control.n;
  const pt = treatment.s / treatment.n;
  const delta = Math.abs(pt - pc);
  if (delta === 0) return null;
  const pBar = (pc + pt) / 2;
  const term = Z95 * Math.sqrt(2 * pBar * (1 - pBar)) + Z80_POWER * Math.sqrt(pc * (1 - pc) + pt * (1 - pt));
  return Math.ceil((term * term) / (delta * delta));
}

/** Sum counts across days, or across slots, so a holdout can be read cumulatively. */
export function pooled(rows: readonly ArmCount[]): ArmCount {
  return rows.reduce((acc, r) => ({ n: acc.n + Math.max(0, finite(r.n)), s: acc.s + Math.max(0, finite(r.s)) }), { n: 0, s: 0 });
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const pts = (d: number) => `${d >= 0 ? '+' : '−'}${(Math.abs(d) * 100).toFixed(1)} points`;
const rel = (r: number) => `${r >= 0 ? '+' : '−'}${(Math.abs(r) * 100).toFixed(0)}%`;
const fmt = (n: number) => n.toLocaleString('en-US');
const verdictOf = (d: Proportion): Verdict => (d.lo > 0 ? 'treatment_better' : d.hi < 0 ? 'control_better' : 'undecided');

/**
 * The relative difference of two arms with its interval, by Katz's log method:
 *
 *   relative = p_t / p_c − 1,
 *   low/high = exp( ln(p_t/p_c) ∓ z·sqrt( (1−p_t)/s_t + (1−p_c)/s_c ) ) − 1
 *
 * computed from the RAW rates. Dividing an absolute difference interval by a
 * rounded control rate is not this interval and is not used anywhere: at a
 * small control rate the divisor's own rounding dominates the answer, and at a
 * large difference the two are simply different intervals.
 *
 * Every member is null where the quantity is unreadable rather than zero: a
 * control rate of zero has no ratio to take, and a treatment arm with no
 * credited outcome, an empty arm or a count that is not a proportion (credits
 * may exceed decisions, doc 22 §10) has no log interval.
 */
export function katzRelativeInterval(control: ArmCount, treatment: ArmCount, z = Z95): { relative: number | null; low: number | null; high: number | null } {
  const unreadable = { relative: null, low: null, high: null };
  const nc = Math.max(0, finite(control?.n)), sc = Math.max(0, finite(control?.s));
  const nt = Math.max(0, finite(treatment?.n)), st = Math.max(0, finite(treatment?.s));
  if (!(nc > 0) || !(nt > 0)) return unreadable;
  const pc = sc / nc, pt = st / nt;
  if (!(pc > 0) || !Number.isFinite(pc) || !Number.isFinite(pt)) return unreadable;
  const relative = pt / pc - 1;
  const variance = (1 - pt) / st + (1 - pc) / sc;
  if (!(pt > 0) || !Number.isFinite(variance) || variance < 0) return { relative, low: null, high: null };
  const half = finite(z) * Math.sqrt(variance);
  const centre = Math.log(pt / pc);
  return { relative, low: Math.exp(centre - half) - 1, high: Math.exp(centre + half) - 1 };
}

/**
 * Where a relative lift stands against the targets, judged on the low end of
 * the Katz interval. The arms' raw counts are what that interval is computed
 * from; without them the reading is withheld rather than approximated.
 */
export function readTargets(difference: Proportion, controlRate: number, targets: Targets,
  counts?: { control: ArmCount; treatment: ArmCount; z?: number }): TargetReading {
  if (!(controlRate > 0) || !counts) return { targets, relativeLow: null, relativeHigh: null, standing: 'undecided' };
  const katz = katzRelativeInterval(counts.control, counts.treatment, counts.z ?? Z95);
  if (katz.low === null || katz.high === null || katz.relative === null) return { targets, relativeLow: null, relativeHigh: null, standing: 'undecided' };
  // Reported unrounded: the rung a target reading turns on is decided a few
  // parts in ten thousand from the boundary often enough that rounding the
  // interval's own ends would decide it.
  const relativeLow = katz.low;
  const relativeHigh = katz.high;
  const point = katz.relative;
  const standing: Standing =
    relativeLow >= targets.stretch ? 'reached_stretch'
    : relativeLow >= targets.target ? 'reached_target'
    : relativeLow >= targets.minimum ? 'reached_minimum'
    : point >= targets.minimum ? 'on_track'
    : 'below';
  return { targets, relativeLow, relativeHigh, standing };
}

function targetWords(r: TargetReading, controlRate: number): string {
  const t = r.targets;
  const named = `the pre-set targets (minimum ${rel(t.minimum)}, target ${rel(t.target)}, stretch ${rel(t.stretch)} relative)`;
  if (r.standing === 'undecided' || r.relativeLow === null) {
    return `${named} cannot be read ${controlRate > 0 ? 'without a relative interval on these counts' : 'against a control rate of zero'}`;
  }
  const low = `the low end of the interval is ${rel(r.relativeLow)}`;
  switch (r.standing) {
    case 'reached_stretch': return `against ${named}: the stretch target is reached, ${low}`;
    case 'reached_target': return `against ${named}: the target is reached, ${low}`;
    case 'reached_minimum': return `against ${named}: the minimum is reached, ${low}`;
    case 'on_track': return `against ${named}: on track, the observed lift clears the minimum but ${low}, so no target is reached yet`;
    default: return `against ${named}: below the minimum`;
  }
}

/**
 * Compare a treatment arm against a control arm. Control is normally `default`
 * (the site's own defaults, no personalization) and treatment `personalized`;
 * `no_learning` against `personalized` isolates what learning adds on top.
 *
 * Intervals at `confidence` (default 95 %), the same difference at the other
 * everyday level beside it, and the reading against the pre-set targets
 * (Tapestry's by default; null to switch off).
 */
export function compareArms(
  control: ArmCount & { arm?: string },
  treatment: ArmCount & { arm?: string },
  options: CompareOptions = {},
): ArmComparison {
  const confidence = [0.9, 0.95, 0.99].includes(options.confidence ?? 0.95) ? (options.confidence ?? 0.95) : clamp01(finite(options.confidence) || 0.95);
  const z = zFor(confidence);
  const other = Math.abs(confidence - 0.95) < 1e-9 ? 0.9 : 0.95;
  const targets = options.targets === undefined ? TAPESTRY_TARGETS : options.targets;

  const c: ArmSummary = { arm: control.arm ?? 'default', n: Math.max(0, finite(control.n)), s: Math.max(0, finite(control.s)), rate: wilson(control.s, control.n, z) };
  const t: ArmSummary = { arm: treatment.arm ?? 'personalized', n: Math.max(0, finite(treatment.n)), s: Math.max(0, finite(treatment.s)), rate: wilson(treatment.s, treatment.n, z) };
  const difference = newcombe(t, c, z);
  // The point ratio comes from the RAW rates, never from the rounded ones the
  // interval is reported at: at a small control rate that rounding is the whole
  // answer (a genuine lift divided by a divisor rounded to four decimals reads 0).
  const katz = katzRelativeInterval(c, t, z);
  const relative = katz.relative === null ? null : r4(katz.relative);
  const verdict = verdictOf(difference);
  const needed = neededPerArm(c, t);
  const otherDiff = newcombe(t, c, zFor(other));
  const alsoAt = { confidence: other, difference: otherDiff, verdict: verdictOf(otherDiff) };
  const reading = targets ? readTargets(difference, c.rate.p, targets, { control: c, treatment: t, z }) : undefined;

  let words: string;
  const level = `${Math.round(confidence * 100)}% interval`;
  if (c.n === 0 || t.n === 0) {
    words = `${t.arm} ${pct(t.rate.p)} of ${fmt(t.n)} decisions vs ${c.arm} ${pct(c.rate.p)} of ${fmt(c.n)}: one arm has no decisions yet, so there is nothing to compare.`;
  } else {
    const head = `${t.arm} ${pct(t.rate.p)} of ${fmt(t.n)} decisions vs ${c.arm} ${pct(c.rate.p)} of ${fmt(c.n)}: ${pts(difference.p)}`
      + (relative !== null ? ` (${rel(relative)} relative)` : '');
    const range = `the ${level} runs ${pts(difference.lo)} to ${pts(difference.hi)}`;
    const also = alsoAt.verdict !== verdict
      ? ` At ${Math.round(other * 100)}% it ${alsoAt.verdict === 'undecided' ? 'would not be called' : `would be called: ${alsoAt.verdict === 'treatment_better' ? t.arm : c.arm} better`}.`
      : '';
    if (verdict === 'undecided') {
      const tail = needed === null
        ? 'the two rates are the same so far.'
        : needed <= Math.min(c.n, t.n)
          ? 'not yet distinguishable from zero.'
          : `not yet distinguishable from zero; a difference this size needs about ${fmt(needed)} decisions on each arm to call, and the smaller arm has ${fmt(Math.min(c.n, t.n))}.`;
      words = `${head}; ${range}, so ${tail}${also}`;
    } else {
      words = `${head}; ${range}, which excludes zero: ${verdict === 'treatment_better' ? t.arm : c.arm} is doing better, and the holdout is the reason we can say so.${also}`;
    }
    if (reading) words += ` ${targetWords(reading, c.rate.p).replace(/^./, (ch) => ch.toUpperCase())}.`;
  }
  return { control: c, treatment: t, difference, relative, verdict, neededPerArm: needed, confidence, alsoAt, ...(reading ? { targets: reading } : {}), words };
}
