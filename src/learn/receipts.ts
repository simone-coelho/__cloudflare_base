// src/learn/receipts.ts
// Doc 28 §4, "what did this shopper see, and why": the decision record, which
// carries every term as numbers and a sentence per rule, read out as sentences
// a merchandiser follows. Pure; the route reads the ring and joins the names.

import type { DecisionRecord } from '@/content/types';
import type { Names } from './rows';

export interface Receipt {
  measurementBasis: 'served-v1' | 'rendered-v1';
  renderedAt: number | null;
  decision_id: string;
  at: number;
  /**
   * W26 I1.01 (F21 §6(b), §8): the placement's identity is page/brand/slot/
   * position, and the receipt is where it is read. The brand is the one the
   * DECISION carries — the brand her page was served under — and is never
   * stamped from the tenant id, which is the default F21 §6(c) condemns and
   * which is indistinguishable from the truth only for a tenant whose single
   * brand happens to be named after it.
   */
  brand: string;
  page: string;
  slot: string;
  position: number;
  item: string;
  customer_item_id: string | null;
  title: string | null;
  arm: string;
  explored: boolean;
  authority: string;
  /** The shopper's context as words: channel, visit, stage, region, the leading interest. */
  context: string;
  /**
   * W16 C4: the journey stage this decision was made in and the published
   * threshold version that derived it, exactly as the record carries them.
   * Absent when the record carries none, so no receipt claims a stage the
   * counters it decided on do not support.
   */
  journey?: DecisionRecord['journey'];
  score_base: number;
  score_final: number;
  /**
   * W23 X1.02 (F18 §2 E, §6.4; doc 22 §12.1 "a script can recompute"): the three
   * terms the learned-lift sentence compares, as the decision recorded them, and
   * the strings this receipt shows them as. A MEMBER and never a new or altered
   * `why` sentence, because `src/learn/receipts.test.ts:41-51` asserts the exact
   * `why` array of a receipt.
   *
   * Fixed three-decimal display cannot tell a 0.0016 baseline from a 0.002 one,
   * so a receipt at a rare rate printed "lift 1.949" beside terms that read
   * 0.004 / 0.002 = 2 and contradicted itself. `shown` therefore carries
   * SIGNIFICANT digits: the same number of meaningful figures at every
   * magnitude, so what the receipt prints for p̂ over what it prints for p₀ is
   * what it prints for the lift. Absent when the decision applied no learned
   * lift, so no receipt names terms its own sentences do not.
   */
  lift_terms?: LiftTerms;
  /** Why this piece was here, one sentence per reason, in the order the engine applied them. */
  why: string[];
}

/** The lift a receipt reports, as exact numbers and as the strings it prints. */
export interface LiftTerms {
  /** The slot's own rate in this cell — the baseline the lift is measured against. */
  p0: number;
  /** The item's shrunk estimate in this cell. */
  p_hat: number;
  /** clamp(p̂/p₀), exactly as the decision applied it. */
  lift: number;
  /**
   * W25 V1.01 (doc 35 §2 N22, kit 02:316): the OBSERVED exposures behind this
   * estimate, kept apart from `n0`, the strength the estimate was shrunk with.
   * An item ranked on an imported prior alone has `n: 0` and `n0: 200`, and a
   * reader can see that the platform observed nothing: prior strength is never
   * presented as exposure.
   */
  n: number;
  /** The shrinkage strength: the imported prior's `n_equiv` where one applied, else the slot's n₀. */
  n0: number;
  /** The imported prior in force for this cell, when there was one. */
  prior?: { p: number; n: number };
  /** The prior document revision this decision was made under; 0 when none. */
  prior_version: number;
  shown: { p0: string; p_hat: string; lift: string };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/**
 * F18 §6.4: "display significant digits, not decimals". Three is what the
 * existing sentence already shows for a lift near one (1.949), and it is the
 * smallest number of figures that separates a 0.00199 baseline from a 0.002 one.
 * Magnitude-free, so it holds for any tenant's rates, however rare.
 */
const SIGNIFICANT_DIGITS = 3;
const shownAs = (x: number): string => (Number.isFinite(x) ? x.toPrecision(SIGNIFICANT_DIGITS) : String(x));

export function contextOf(cell: DecisionRecord['cell']): string {
  const stage = cell.stage && cell.stage !== 'unknown' ? ({ early: 'exploring', mid: 'considering', late: 'deciding' } as Record<string, string>)[cell.stage] ?? cell.stage : 'stage unknown';
  const visit = cell.visit_bucket === 'unknown' ? 'visit unknown' : cell.visit_bucket === '1' ? 'first visit' : `visit ${cell.visit_bucket}`;
  return `${cell.channel === 'unknown' ? 'channel unknown' : `from ${cell.channel}`}, ${visit}, ${stage}, ${cell.region ? `in ${cell.region}` : 'region unknown'}, ${cell.affinity ? `leaning ${cell.affinity.replace(':', ' ')}` : 'no leading interest yet'}`;
}

/** The record as sentences. Every number on the record has a place here, so nothing is said that the record does not carry. */
export function receiptOf(r: DecisionRecord, names: Names): Receipt {
  const why: string[] = [];
  const e = r.explain;
  // W23 X1.02: set exactly where the learned-lift sentence is written, so the
  // terms and the sentence can never describe two different decisions.
  let liftTerms: LiftTerms | undefined;
  // W26 U1.01 (R153(b), F21 §5 item 5): the admitted render is the declared
  // exposure unit. The VIEWABLE impression is a different thing and the
  // learning loop counts none of it today (`learningInputOf` in
  // `src/ledger/records.ts` states the same fact in code), so the receipt that
  // reports an admitted render says both — no reader may take "rendered" for
  // "seen", or for the event the platform learns from.
  why.push(r.measurementBasis === 'rendered-v1'
    ? 'Client-reported rendering was durably admitted; this is not proof of human visibility, and a viewable impression is not a learning input today.'
    : 'Legacy served-decision exposure; rendering was not confirmed.');
  if (r.authority === 'pin') why.push('Pinned by the merchandiser for this slot; the engine never ranked it.');
  else if (r.arm === 'default') why.push(`The site's own defaults, no personalization: this shopper is in the holdout's default arm.`);
  else {
    if (e.note && /shopper/.test(e.note)) why.push(e.note.endsWith('.') ? e.note : `${e.note}.`);
    const drivers = (e.drivers || []).filter((d) => !['regional', 'external', 'merchandising', 'stage', 'freshness', 'fatigue', 'completes'].includes(d.dim)).slice(0, 3);
    if (drivers.length) why.push(`Interest matched: ${drivers.map((d) => `${d.dim} ${d.value} (interest ${r3(d.a)} × weight ${r3(d.weight)})`).join(', ')}.`);
    else if (e.score_base === 0 && !e.freshness && !e.stage) why.push('No interest signal yet for this shopper: the slot served its catalogue order.');
    for (const d of (e.drivers || []).filter((d) => d.dim === 'completes')) why.push(`Completes what she committed to: ${d.value} (+${r3(d.weight)}).`);
    // W16 C3: the arrival's own evidence, named rule by rule with the delta it
    // caused. A candidate the rules never named says nothing here rather than
    // claiming a context it did not have.
    if (e.contextual && e.contextual.drivers.length) {
      why.push(`Arrival context: ${e.contextual.drivers.map((d) => `${d.signal.replace(/_/g, ' ')} ${d.value} → ${d.dimension} ${d.tag} (weight ${r3(d.weight)}, ${d.contribution < 0 ? '' : '+'}${r3(d.contribution)})`).join(', ')}.`);
    }
    if (e.regional) why.push(`What is trending ${e.regional.region === '*' ? 'everywhere' : `in ${e.regional.region}`} contributed ${r3(e.regional.contribution)} (the trend's share of the score: ${r3(e.regional.lambda)}).`);
    if (e.external) {
      if ('status' in e.external) why.push(`Their model (${e.external.ref}) was unavailable: ${e.external.reason}; the term was omitted.`);
      else why.push(`Their model (${e.external.ref}, ${e.external.version}) scored it ${r3(e.external.score)}; at weight ${r3(e.external.weight)} that added ${r3(e.external.contribution)}.`);
    }
    if (e.stage) why.push(`Journey stage: ${e.stage.sentence}.`);
    if (e.freshness) why.push(`Freshness: ${e.freshness.sentence}.`);
    if (e.fatigue) why.push(`Fatigue: ${e.fatigue.sentence}.`);
    if (e.merchandising) why.push(`Merchandising: ${e.merchandising.sentence}${e.merchandising.sentence.endsWith('.') ? '' : '.'}`);
    if (e.diversity) why.push(`Diversity: ${e.diversity.sentence}.`);
    if (e.control === 'reject') why.push('A merchandiser rejected the learned lift for this piece; it competes on its base score alone.');
    if (e.lift) {
      const l = e.lift;
      // N20: a multiplicative term on a score it could not move applied nothing,
      // whatever the trust dial says, and the receipt never claims otherwise. A
      // retained record that itemised no delta keeps the sentence it was written with.
      const applied = l.gamma <= 0 ? 'shown on the receipt, not applied (trust 0)'
        : l.applied === 0 ? `shown on the receipt; at trust ${r3(l.gamma)} it moved this score by nothing`
          : `applied at trust ${r3(l.gamma)}`;
      // W25 V1.01 (N22): where an imported prior carried this estimate, the
      // sentence names it and its strength beside the observed exposures, so no
      // reader takes prior strength for something the platform saw. The clause
      // is written only where the decision recorded a prior, so a receipt
      // without one keeps the sentence it has always had.
      const prior = l.prior ? `, shrunk toward an imported prior of ${l.prior.p} at strength ${l.prior.n} (belief, not observed exposures)` : '';
      why.push(e.control === 'freeze'
        ? `Learned lift frozen by a merchandiser at ${r3(l.lift)}, ${applied}.`
        : `Learned lift ${r3(l.lift)} from ${l.level_words} (${r3(l.n)} ${l.measurementBasis === 'rendered-v1' ? 'client-reported renders' : 'served exposures'}, ${r3(l.s)} weighted credit in ${l.objective ?? 'unit'} units)${prior}, ${applied}.`);
      liftTerms = { p0: l.p0, p_hat: l.p_hat, lift: l.lift,
        n: l.n, n0: l.n0, ...(l.prior ? { prior: l.prior } : {}), prior_version: r.versions?.prior ?? 0,
        shown: { p0: shownAs(l.p0), p_hat: shownAs(l.p_hat), lift: shownAs(l.lift) } };
    } else if (r.arm === 'personalized') why.push('Nothing learned yet for this piece in this shopper\'s context: no lift.');
    if (r.arm === 'no_learning') why.push('This shopper is in the no-learning arm: personalized, with the learned lift held at zero.');
    if (r.explored && e.exploration) why.push(`Served on purpose to explore (${e.exploration.mode}): ${e.exploration.reason}.`);
  }
  // W20 G2 (R86(c)): the shortfall is a fact about the SLOT, not about the
  // ranking of this piece, so it is read out for a pinned position exactly as
  // for a ranked one — the way every other block on `explain` is read out.
  if (e.shortTake) why.push(`Short take: ${e.shortTake.sentence}.`);
  const nm = names.get(r.item_id);
  return {
    measurementBasis: r.measurementBasis ?? 'served-v1', renderedAt: r.rendered?.at ?? null,
    decision_id: r.decision_id, at: r.ts, brand: r.brand, page: r.page, slot: r.slot, position: r.position,
    item: r.item_id, customer_item_id: nm?.customerContentId ?? r.customer_item_id ?? null, title: nm?.title ?? null,
    arm: r.arm, explored: r.explored, authority: r.authority,
    context: contextOf(r.cell),
    ...(r.journey ? { journey: r.journey } : {}),
    score_base: r3(e.score_base), score_final: r3(e.score_final),
    ...(liftTerms ? { lift_terms: liftTerms } : {}),
    why,
  };
}
