// src/learn/receipts.ts
// Doc 28 §4, "what did this shopper see, and why": the decision record, which
// carries every term as numbers and a sentence per rule, read out as sentences
// a merchandiser follows. Pure; the route reads the ring and joins the names.

import type { DecisionRecord } from '@/content/types';
import type { Names } from './rows';

export interface Receipt {
  decision_id: string;
  at: number;
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
  score_base: number;
  score_final: number;
  /** Why this piece was here, one sentence per reason, in the order the engine applied them. */
  why: string[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function contextOf(cell: DecisionRecord['cell']): string {
  const stage = cell.stage && cell.stage !== 'unknown' ? ({ early: 'exploring', mid: 'considering', late: 'deciding' } as Record<string, string>)[cell.stage] ?? cell.stage : 'stage unknown';
  const visit = cell.visit_bucket === 'unknown' ? 'visit unknown' : cell.visit_bucket === '1' ? 'first visit' : `visit ${cell.visit_bucket}`;
  return `${cell.channel === 'unknown' ? 'channel unknown' : `from ${cell.channel}`}, ${visit}, ${stage}, ${cell.region ? `in ${cell.region}` : 'region unknown'}, ${cell.affinity ? `leaning ${cell.affinity.replace(':', ' ')}` : 'no leading interest yet'}`;
}

/** The record as sentences. Every number on the record has a place here, so nothing is said that the record does not carry. */
export function receiptOf(r: DecisionRecord, names: Names): Receipt {
  const why: string[] = [];
  const e = r.explain;
  if (r.authority === 'pin') why.push('Pinned by the merchandiser for this slot; the engine never ranked it.');
  else if (r.arm === 'default') why.push(`The site's own defaults, no personalization: this shopper is in the holdout's default arm.`);
  else {
    if (e.note && /shopper/.test(e.note)) why.push(e.note.endsWith('.') ? e.note : `${e.note}.`);
    const drivers = (e.drivers || []).filter((d) => !['regional', 'external', 'merchandising', 'stage', 'freshness', 'fatigue', 'completes'].includes(d.dim)).slice(0, 3);
    if (drivers.length) why.push(`Interest matched: ${drivers.map((d) => `${d.dim} ${d.value} (interest ${r3(d.a)} × weight ${r3(d.weight)})`).join(', ')}.`);
    else if (e.score_base === 0 && !e.freshness && !e.stage) why.push('No interest signal yet for this shopper: the slot served its catalogue order.');
    for (const d of (e.drivers || []).filter((d) => d.dim === 'completes')) why.push(`Completes what she committed to: ${d.value} (+${r3(d.weight)}).`);
    if (e.regional) why.push(`What is trending in ${e.regional.region} contributed ${r3(e.regional.contribution)} (the region's share of the score: ${r3(e.regional.lambda)}).`);
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
      const applied = l.gamma > 0 ? `applied at trust ${r3(l.gamma)}` : 'shown on the receipt, not applied (trust 0)';
      why.push(e.control === 'freeze'
        ? `Learned lift frozen by a merchandiser at ${r3(l.lift)}, ${applied}.`
        : `Learned lift ${r3(l.lift)} from ${l.level_words} (${r3(l.n)} shown, ${r3(l.s)} succeeded${l.objective && l.objective !== 'unit' ? `, weighed by ${l.objective}` : ''}), ${applied}.`);
    } else if (r.arm === 'personalized') why.push('Nothing learned yet for this piece in this shopper\'s context: no lift.');
    if (r.arm === 'no_learning') why.push('This shopper is in the no-learning arm: personalized, with the learned lift held at zero.');
    if (r.explored && e.exploration) why.push(`Served on purpose to explore (${e.exploration.mode}): ${e.exploration.reason}.`);
  }
  const nm = names.get(r.item_id);
  return {
    decision_id: r.decision_id, at: r.ts, page: r.page, slot: r.slot, position: r.position,
    item: r.item_id, customer_item_id: nm?.customerContentId ?? r.customer_item_id ?? null, title: nm?.title ?? null,
    arm: r.arm, explored: r.explored, authority: r.authority,
    context: contextOf(r.cell),
    score_base: r3(e.score_base), score_final: r3(e.score_final),
    why,
  };
}
