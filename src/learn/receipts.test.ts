// src/learn/receipts.test.ts
// "What did this shopper see, and why", as sentences: every block the record
// carries has one; a pin, a holdout default, a cold shopper and an explored
// pick each say what they are; nothing is said that the record does not hold.

import { describe, it, expect } from 'vitest';
import { contextOf, receiptOf } from './receipts';
import type { DecisionRecord } from '@/content/types';

const base: DecisionRecord = {
  decision_id: 'coach:x:v1:home:hero:0', tenant: 'coach', brand: 'coach', visitor_id: 'v1', session_id: 's1', identity_anchor: 'visitor', ts: 1_788_000_000_000,
  page: 'home', slot: 'hero', position: 0, item_id: 'cnt_a', customer_item_id: 'CCH-001', candidates: [],
  cell: { channel: 'paid social', visit_bucket: '2-3', region: 'US-NY', affinity: 'line:Tabby', stage: 'mid' },
  arm: 'personalized', explored: false, authority: 'engine', versions: { config: 1, lift: 2, prior: 0, policy: 1 }, config_label: 'v1',
  explain: { drivers: [{ dim: 'line', value: 'Tabby', a: 0.7, weight: 0.35 }, { dim: 'stage', value: 'fits considering', a: 1, weight: 0.2 }], score_base: 0.445, lift: null, score_final: 0.445 },
};
const names = new Map([['cnt_a', { customerContentId: 'CCH-001', title: 'The Tabby Shop' }]]);

describe('W15 the receipt as sentences with explicit measurement units', () => {
  it('reads the context out in words', () => {
    expect(contextOf(base.cell)).toBe('from paid social, visit 2-3, considering, in US-NY, leaning line Tabby');
    expect(contextOf({ channel: 'unknown', visit_bucket: '1', region: null, affinity: null })).toBe('channel unknown, first visit, stage unknown, region unknown, no leading interest yet');
  });

  it('every block the record carries becomes one sentence, in the order the engine applied them', () => {
    const full: DecisionRecord = { ...base, explain: {
      ...base.explain,
      regional: { region: 'US-NY', level: 'region', lambda: 0.4, version: 3, events: 120, contribution: 0.05 } as DecisionRecord['explain']['regional'],
      external: { kind: 'table', ref: 'MODEL', version: 'v7', weight: 0.3, score: 0.6, contribution: 0.18 },
      stage: { visitor: 'considering', fit: ['considering'], applied: 0.2, sentence: 'made for a shopper who is considering: +0.2' },
      freshness: { ageDays: 1, decay: 0.906, applied: 0.181, sentence: '1 days old, freshness at 0.906 of new: +0.181' },
      fatigue: { served: 1, windowHours: 24, applied: -0.1, sentence: 'this shopper was served it 1 time in the last 24 hours: -0.1' },
      merchandising: { boost: 1.1, clamped: false, drivers: [], sentence: 'season 0.8 at weight 0.2: ×1.1' },
      diversity: { dimension: 'line', max: 1, skipped: ['cnt_b'], relaxed: false, sentence: 'cnt_b yielded: at most 1 per line in this slot' },
      lift: { reward: 'click', objective: 'unit', level: 3, level_words: 'channel, visit bucket and journey stage', n: 84, s: 9, p0: 0.07, n0: 30, p_hat: 0.096, lift: 1.37, gamma: 0.5 },
    } };
    const r = receiptOf(full, names);
    expect(r).toMatchObject({ item: 'cnt_a', customer_item_id: 'CCH-001', title: 'The Tabby Shop', slot: 'hero', arm: 'personalized', score_base: 0.445 });
    expect(r.why).toEqual([
      'Legacy served-decision exposure; rendering was not confirmed.',
      'Interest matched: line Tabby (interest 0.7 × weight 0.35).',
      "What is trending in US-NY contributed 0.05 (the trend's share of the score: 0.4).",
      'Their model (MODEL, v7) scored it 0.6; at weight 0.3 that added 0.18.',
      'Journey stage: made for a shopper who is considering: +0.2.',
      'Freshness: 1 days old, freshness at 0.906 of new: +0.181.',
      'Fatigue: this shopper was served it 1 time in the last 24 hours: -0.1.',
      'Merchandising: season 0.8 at weight 0.2: ×1.1.',
      'Diversity: cnt_b yielded: at most 1 per line in this slot.',
      'Learned lift 1.37 from channel, visit bucket and journey stage (84 served exposures, 9 weighted credit in unit units), applied at trust 0.5.',
    ]);
  });

  it('a pin, a holdout default, a cold shopper, a frozen lift and an explored pick each say what they are', () => {
    const everywhere = receiptOf({ ...base, explain: { ...base.explain, regional: { region: '*', level: 'global', lambda: 0.14, version: 1, events: 9, contribution: 0.16 } as DecisionRecord['explain']['regional'] } }, names);
    const legacy = 'Legacy served-decision exposure; rendering was not confirmed.';
    expect(everywhere.why[2]).toBe("What is trending everywhere contributed 0.16 (the trend's share of the score: 0.14).");
    expect(receiptOf({ ...base, authority: 'pin' }, names).why).toEqual([legacy, 'Pinned by the merchandiser for this slot; the engine never ranked it.']);
    expect(receiptOf({ ...base, arm: 'default' }, names).why).toEqual([legacy, "The site's own defaults, no personalization: this shopper is in the holdout's default arm."]);
    const cold = receiptOf({ ...base, explain: { drivers: [], score_base: 0, lift: null, score_final: 0, note: 'no signal yet — the slot default (catalogue order)' } }, names);
    expect(cold.why).toEqual([legacy, 'No interest signal yet for this shopper: the slot served its catalogue order.', "Nothing learned yet for this piece in this shopper's context: no lift."]);
    const frozen = receiptOf({ ...base, explain: { ...base.explain, control: 'freeze', lift: { reward: 'click', level: 0, level_words: 'frozen by a merchandiser', n: 0, s: 0, p0: 0, n0: 0, p_hat: 0, lift: 1.5, gamma: 1 } } }, names);
    expect(frozen.why[2]).toBe('Learned lift frozen by a merchandiser at 1.5, applied at trust 1.');
    const explored = receiptOf({ ...base, explored: true, explain: { ...base.explain, exploration: { mode: 'rotation', reason: 'under-observed, n 3 < floor 50', bucket: 7 } } }, names);
    expect(explored.why.at(-1)).toBe('Served on purpose to explore (rotation): under-observed, n 3 < floor 50.');
    const noLearn = receiptOf({ ...base, arm: 'no_learning' }, names);
    expect(noLearn.why).toContain('This shopper is in the no-learning arm: personalized, with the learned lift held at zero.');
    const consent = receiptOf({ ...base, arm: 'default', explain: { ...base.explain, note: "the site's defaults: personalization is off by the shopper's choice" } }, names);
    expect(consent.why[1]).toContain("holdout's default arm");
  });
  it('does not relabel legacy history and describes revenue per acknowledged render without claiming visibility', () => {
    const record: DecisionRecord = { ...base, measurementBasis: 'rendered-v1', rendered: { version: 1, at: base.ts + 1000, eventId: 'render-original', pageInstance: 'page' },
      explain: { ...base.explain, lift: { reward: 'purchase', objective: 'revenue', measurementBasis: 'rendered-v1', level: 0, level_words: 'everyone', n: 2, s: 80, p0: 20, n0: 30, p_hat: 30, lift: 1.5, gamma: 1 } } };
    const receipt = receiptOf(record, names);
    expect(receipt).toMatchObject({ measurementBasis: 'rendered-v1', at: base.ts, renderedAt: base.ts + 1000, decision_id: base.decision_id });
    expect(receipt.why[0]).toBe('Client-reported rendering was durably admitted; this is not proof of human visibility.');
    expect(receipt.why.at(-1)).toContain('2 client-reported renders, 80 weighted credit in revenue units');
    expect(receiptOf(base, names)).toMatchObject({ measurementBasis: 'served-v1', renderedAt: null });
  });
});
