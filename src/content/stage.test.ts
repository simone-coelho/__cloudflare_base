// src/content/stage.test.ts
// CW29, the content half of journey stage (BTIE A.3.4): a piece says which
// stages it is made for, a slot says what to do about a mismatch, the visitor's
// stage is on the cell, and the receipt itemises what the rule did. Off when
// the stage is unknown and on the holdout's default arm. The pooling ladder
// carries the stage after the visit bucket.

import { describe, it, expect } from 'vitest';
import { decideContent, type DecideInput } from './decide';
import { validateContentCatalog, validateSlotCatalog, stageWordOf } from './kinds';
import { levelKeys } from '@/learn/stats';
import type { ContentPiece, SlotStrategy } from './types';

const piece = (id: string, tags: Record<string, string[]>, fit?: ContentPiece['journeyStageFit']): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...(fit ? { journeyStageFit: fit } : {}) });

// `discover` fits the shopper's interest best but is made for explorers; `compare` fits considering; `any` is stage-neutral.
const pieces = [
  piece('discover', { occasion: ['evening'] }, ['exploring']),
  piece('compare', { occasion: ['weekend'] }, ['considering', 'deciding']),
  piece('any', { occasion: ['weekend'] }),
];
const slots: SlotStrategy[] = [{ slot: 'hero', take: 3, weights: { occasion: 0.5 }, stage: { outOfStage: 0.5, inStage: 0.1 } }];
const base: DecideInput = {
  tenant: 'tapestry', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor', nowMs: 1_725_000_000_000,
  pieces, slots, affinity: { dims: { occasion: { evening: 0.8, weekend: 0.4 } } },
  cell: { channel: 'direct', visit_bucket: '2-3', region: 'US-NY', affinity: 'occasion:evening', stage: 'mid' },
  arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
};
const hero = (out: ReturnType<typeof decideContent>, id: string) => out.records.find((r) => r.slot === 'hero' && r.item_id === id)!;

describe('CW29 journey stage on the content decision', () => {
  it('demotes a piece made for another stage and favours one made for this stage, itemised on the receipt', () => {
    const out = decideContent(base);
    // Without the rule `discover` (0.8 × 0.5 = 0.4) leads `compare` and `any` (0.4 × 0.5 = 0.2).
    // With it: discover 0.4 × 0.5 = 0.2; compare 0.2 + 0.1 = 0.3; any 0.2 (no fit tag, untouched).
    expect(out.decisions.map((d) => d.contentId)).toEqual(['compare', 'discover', 'any']);
    const d = hero(out, 'discover');
    expect(d.explain.stage).toEqual({ visitor: 'considering', fit: ['exploring'], applied: -0.2, sentence: 'made for exploring, and this shopper is considering: -0.2' });
    expect(d.explain.drivers).toContainEqual({ dim: 'stage', value: 'made for exploring, shopper considering', a: 1, weight: -0.2 });
    const c = hero(out, 'compare');
    expect(c.explain.stage).toEqual({ visitor: 'considering', fit: ['considering', 'deciding'], applied: 0.1, sentence: 'made for a shopper who is considering: +0.1' });
    expect(c.explain.score_base).toBe(0.3);
    expect(hero(out, 'any').explain.stage).toBeUndefined();
  });

  it('is off when the stage is unknown, on the default arm, and when the slot has no rule', () => {
    const unknown = decideContent({ ...base, cell: { ...base.cell, stage: 'unknown' } });
    expect(unknown.decisions.map((d) => d.contentId)).toEqual(['discover', 'compare', 'any']);
    expect(unknown.records.every((r) => r.explain.stage === undefined)).toBe(true);
    const absent = decideContent({ ...base, cell: { channel: 'direct', visit_bucket: '2-3', region: null, affinity: null } });
    expect(absent.records.every((r) => r.explain.stage === undefined)).toBe(true);
    const dflt = decideContent({ ...base, arm: 'default' });
    expect(dflt.records.every((r) => r.explain.stage === undefined)).toBe(true);
    const noRule = decideContent({ ...base, slots: [{ slot: 'hero', take: 3, weights: { occasion: 0.5 } }] });
    expect(noRule.decisions.map((d) => d.contentId)).toEqual(['discover', 'compare', 'any']);
    expect(noRule.records.every((r) => r.explain.stage === undefined)).toBe(true);
  });

  it('replays: the same input gives the same stage arithmetic', () => {
    expect(decideContent(base).records).toEqual(decideContent(base).records);
  });

  it('validates journeyStageFit in either vocabulary and the slot rule in 0..1', () => {
    expect(stageWordOf('early')).toBe('exploring'); expect(stageWordOf('deciding')).toBe('deciding'); expect(stageWordOf('buyer')).toBeNull();
    const ok = validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['hero'], journeyStageFit: ['late', 'deciding', 'exploring'] }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.pieces[0]!.journeyStageFit).toEqual(['deciding', 'exploring']);
    const bad = validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['hero'], journeyStageFit: ['buyer'] }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('journeyStageFit');
    const slotOk = validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: {}, stage: { outOfStage: 0.5 } }] } });
    expect(slotOk.ok).toBe(true);
    if (slotOk.ok) expect(slotOk.value.pages.home![0]!.stage).toEqual({ outOfStage: 0.5 });
    const slotBad = validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: {}, stage: { outOfStage: 2 } }] } });
    expect(slotBad.ok).toBe(false);
  });

  it('puts the stage on the pooling ladder after the visit bucket', () => {
    expect(levelKeys(base.cell)).toEqual(['*', 'c=direct', 'c=direct|v=2-3', 'c=direct|v=2-3|s=mid', 'c=direct|v=2-3|s=mid|r=US-NY', 'c=direct|v=2-3|s=mid|r=US-NY|a=occasion:evening']);
    expect(levelKeys({ channel: 'direct', visit_bucket: '1', region: null, affinity: null })[3]).toBe('c=direct|v=1|s=unknown');
  });
});
