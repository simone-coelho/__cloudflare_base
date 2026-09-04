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
  /** The whole thing, in one sentence a person can read. */
  words: string;
}

const Z95 = 1.959963984540054;
const Z80_POWER = 0.8416212335729143;

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
const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Compare a treatment arm against a control arm. Control is normally `default`
 * (the site's own defaults, no personalization) and treatment `personalized`;
 * `no_learning` against `personalized` isolates what learning adds on top.
 */
export function compareArms(
  control: ArmCount & { arm?: string },
  treatment: ArmCount & { arm?: string },
): ArmComparison {
  const c: ArmSummary = { arm: control.arm ?? 'default', n: Math.max(0, finite(control.n)), s: Math.max(0, finite(control.s)), rate: wilson(control.s, control.n) };
  const t: ArmSummary = { arm: treatment.arm ?? 'personalized', n: Math.max(0, finite(treatment.n)), s: Math.max(0, finite(treatment.s)), rate: wilson(treatment.s, treatment.n) };
  const difference = newcombe(t, c);
  const relative = c.rate.p > 0 ? r4((t.rate.p - c.rate.p) / c.rate.p) : null;
  const verdict: Verdict = difference.lo > 0 ? 'treatment_better' : difference.hi < 0 ? 'control_better' : 'undecided';
  const needed = neededPerArm(c, t);

  let words: string;
  if (c.n === 0 || t.n === 0) {
    words = `${t.arm} ${pct(t.rate.p)} of ${fmt(t.n)} decisions vs ${c.arm} ${pct(c.rate.p)} of ${fmt(c.n)}: one arm has no decisions yet, so there is nothing to compare.`;
  } else {
    const head = `${t.arm} ${pct(t.rate.p)} of ${fmt(t.n)} decisions vs ${c.arm} ${pct(c.rate.p)} of ${fmt(c.n)}: ${pts(difference.p)}`
      + (relative !== null ? ` (${relative >= 0 ? '+' : '−'}${(Math.abs(relative) * 100).toFixed(0)}% relative)` : '');
    const range = `the interval runs ${pts(difference.lo)} to ${pts(difference.hi)}`;
    if (verdict === 'undecided') {
      const tail = needed === null
        ? 'the two rates are the same so far.'
        : needed <= Math.min(c.n, t.n)
          ? 'not yet distinguishable from zero.'
          : `not yet distinguishable from zero; a difference this size needs about ${fmt(needed)} decisions on each arm to call, and the smaller arm has ${fmt(Math.min(c.n, t.n))}.`;
      words = `${head}; ${range}, so ${tail}`;
    } else {
      words = `${head}; ${range}, which excludes zero: ${verdict === 'treatment_better' ? t.arm : c.arm} is doing better, and the holdout is the reason we can say so.`;
    }
  }
  return { control: c, treatment: t, difference, relative, verdict, neededPerArm: needed, words };
}
