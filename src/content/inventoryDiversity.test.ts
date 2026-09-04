// src/content/inventoryDiversity.test.ts
// CW32 (BTIE A.3.6): featuredProductIds carried and validated. CW33 (BTIE D11):
// a piece the catalog marks out of stock does not exist for a decision; a slot's
// diversity rule lets at most `max` pieces share one value of a dimension, the
// piece over the limit yields to the next and is named on its explain, and the
// rule relaxes rather than leave a rail with holes.

import { describe, it, expect } from 'vitest';
import { decideContent, type DecideInput } from './decide';
import { validateContentCatalog, validateSlotCatalog } from './kinds';
import { isEligibleAt } from './lifecycle';
import { normalizePiece, stockOf } from './import';
import type { ContentPiece, SlotStrategy } from './types';

const piece = (id: string, tags: Record<string, string[]>, extra: Partial<ContentPiece> = {}): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: ['rail'], lifecycle: { status: 'live' }, ...extra });

// Affinity favours Drover strongly, Tabby a little; three Drover pieces outrank the Tabby one.
const pieces = [
  piece('d1', { line: ['Drover'] }),
  piece('d2', { line: ['Drover'] }),
  piece('d3', { line: ['Drover'] }),
  piece('t1', { line: ['Tabby'] }),
];
const rail = (extra: Partial<SlotStrategy> = {}): SlotStrategy => ({ slot: 'rail', take: 3, weights: { line: 0.5 }, ...extra });
const base: DecideInput = {
  tenant: 'tapestry', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor', nowMs: 1_725_000_000_000,
  pieces, slots: [rail()], affinity: { dims: { line: { Drover: 0.8, Tabby: 0.2 } } },
  cell: { channel: 'direct', visit_bucket: '1', region: null, affinity: null, stage: 'unknown' },
  arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
};
const served = (out: ReturnType<typeof decideContent>) => out.decisions.map((d) => d.contentId);

describe('CW33 inventory', () => {
  it('a piece marked out of stock does not exist for the decision, not even as a candidate', () => {
    const out = decideContent({ ...base, pieces: [piece('d1', { line: ['Drover'] }, { inStock: false }), ...pieces.slice(1)] });
    expect(served(out)).toEqual(['d2', 'd3', 't1']);
    expect(out.records[0]!.candidates.map((c) => c.contentId)).not.toContain('d1');
    expect(isEligibleAt(piece('x', {}, { inStock: false }), base.nowMs)).toBe(false);
    expect(isEligibleAt(piece('x', {}, { inStock: true }), base.nowMs)).toBe(true);
    expect(isEligibleAt(piece('x', {}), base.nowMs)).toBe(true);
  });
});

describe('CW33 diversity', () => {
  it('at most max per value: the piece over the limit yields to the next, named on its explain', () => {
    const out = decideContent({ ...base, slots: [rail({ diversity: { dimension: 'line', max: 2 } })] });
    expect(served(out)).toEqual(['d1', 'd2', 't1']);
    const t = out.records.find((r) => r.item_id === 't1')!;
    expect(t.explain.diversity).toEqual({ dimension: 'line', max: 2, skipped: ['d3'], relaxed: false, sentence: 'd3 yielded: at most 2 per line in this slot' });
    expect(out.records.find((r) => r.item_id === 'd1')!.explain.diversity).toBeUndefined();
    // The yielded piece is still a recorded candidate: it was considered.
    expect(t.candidates.map((c) => c.contentId)).toContain('d3');
  });

  it('relaxes rather than leave the rail short, and says so', () => {
    const out = decideContent({ ...base, slots: [rail({ diversity: { dimension: 'line', max: 1 } })] });
    expect(served(out)).toEqual(['d1', 't1', 'd2']);
    expect(out.records.find((r) => r.item_id === 't1')!.explain.diversity).toMatchObject({ skipped: ['d2', 'd3'], relaxed: false });
    expect(out.records.find((r) => r.item_id === 'd2')!.explain.diversity).toMatchObject({ skipped: [], relaxed: true, sentence: 'served over the limit of 1 per line: nothing else was eligible' });
  });

  it('a piece without the dimension is never limited, and the rule replays', () => {
    const out = decideContent({ ...base, pieces: [...pieces, piece('n1', { occasion: ['weekend'] })], slots: [rail({ diversity: { dimension: 'line', max: 1 } })], affinity: { dims: { line: { Drover: 0.8, Tabby: 0.2 }, occasion: { weekend: 0.1 } } } });
    expect(served(out)).toEqual(['d1', 't1', 'n1']);
    expect(decideContent({ ...base, slots: [rail({ diversity: { dimension: 'line', max: 1 } })] }).records).toEqual(decideContent({ ...base, slots: [rail({ diversity: { dimension: 'line', max: 1 } })] }).records);
  });
});

describe('CW32 schema', () => {
  it('validates featuredProductIds and inStock on the piece, and the diversity rule on the slot', () => {
    const ok = validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['rail'], featuredProductIds: ['P1', ' P2 ', 'P1'], inStock: false }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.pieces[0]).toMatchObject({ featuredProductIds: ['P1', 'P2'], inStock: false });
    expect(validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['rail'], featuredProductIds: 'P1' }] }).ok).toBe(false);
    expect(validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['rail'], inStock: 'no' }] }).ok).toBe(false);
    const slotOk = validateSlotCatalog({ pages: { home: [{ slot: 'rail', take: 3, weights: {}, diversity: { dimension: 'line', max: 2 } }] } });
    expect(slotOk.ok).toBe(true);
    if (slotOk.ok) expect(slotOk.value.pages.home![0]!.diversity).toEqual({ dimension: 'line', max: 2 });
    expect(validateSlotCatalog({ pages: { home: [{ slot: 'rail', take: 3, weights: {}, diversity: { dimension: 'line', max: 0 } }] } }).ok).toBe(false);
  });

  it('the import adapter carries the BTIE names and the feed\'s stock spellings through', () => {
    const p = normalizePiece({ id: 'x', title: 'x', tags: {}, slotTypes: ['rail'], featured_product_ids: 'P1|P2', ats: 'N' })!;
    expect(p.featuredProductIds).toEqual(['P1', 'P2']);
    expect(p.inStock).toBe(false);
    expect(stockOf('Y')).toBe(true); expect(stockOf(0)).toBe(false); expect(stockOf('sold_out')).toBe(false); expect(stockOf('maybe')).toBeUndefined(); expect(stockOf(undefined)).toBeUndefined();
    expect(normalizePiece({ id: 'y', title: 'y', tags: {}, slotTypes: ['rail'] })!.inStock).toBeUndefined();
  });
});
