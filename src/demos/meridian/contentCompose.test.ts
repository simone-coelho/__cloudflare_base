import { describe, it, expect } from 'vitest';
import { composeContent, type ContentPieceLike, type ContentSlotSpec } from './contentCompose';

const P = (id: string, tags: Record<string, string[]>, slots: string[] = ['carousel']): ContentPieceLike => ({
  id, customerContentId: `CMP-${id}`, type: 'editorial', title: id, tags, slotTypes: slots,
});
const SLOTS: ContentSlotSpec[] = [
  { slot: 'chero', take: 1, weights: { contentType: 0.4, category: 0.3, line: 0.3 } },
  { slot: 'carousel', take: 3, weights: { line: 0.4, occasion: 0.3, category: 0.3 } },
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'campaign' },
];
const PIECES = [
  P('drover-film', { line: ['Drover'], category: ['Outerwear'] }, ['chero', 'carousel']),
  P('fenwick-guide', { line: ['Fenwick'], category: ['Knitwear'] }, ['carousel']),
  P('linden-look', { line: ['Linden'], occasion: ['evening'] }, ['carousel', 'chero']),
  P('care-guide', { category: ['Outerwear'] }, ['carousel']),
  P('campaign', {}, ['merch']),
];

describe('content is a catalogue too', () => {
  it('ranks by the product formula: Σ a[dim][tag] · w, per slot', () => {
    const ds = composeContent(PIECES, { dims: { line: { Drover: 0.7, Fenwick: 0.3 }, category: { Outerwear: 0.5 } } }, SLOTS);
    expect(ds.find((d) => d.slot === 'chero')!.contentId).toBe('drover-film');
    const carousel = ds.filter((d) => d.slot === 'carousel').map((d) => d.contentId);
    expect(carousel[0]).toBe('care-guide');                 // Outerwear 0.5 · 0.3 beats Fenwick 0.3 · 0.4
    expect(carousel).not.toContain('drover-film');          // DEDUPE: the hero took it
  });
  it('the merch slot is tenant-pinned: ranking never runs', () => {
    const ds = composeContent(PIECES, { dims: { line: { Linden: 0.9 } } }, SLOTS);
    const merch = ds.find((d) => d.slot === 'merch')!;
    expect(merch.contentId).toBe('campaign');
    expect(merch.strategy).toBe('tenant-pinned');
    expect(merch.explain.note).toMatch(/tenant config/);
  });
  it('absent signal → the slot default, labelled', () => {
    const ds = composeContent(PIECES, { dims: {} }, SLOTS);
    for (const d of ds.filter((x) => x.slot !== 'merch')) expect(d.strategy).toBe('default');
  });
  it('every decision carries the customer id and the explain — the wire is the contract', () => {
    const ds = composeContent(PIECES, { dims: { line: { Drover: 0.7 } } }, SLOTS);
    for (const d of ds) { expect(d.customerContentId).toMatch(/^CMP-/); expect(d.explain).toBeTruthy(); }
  });

  it('a slot may prefer completing content, and the bonus is a named driver', () => {
    const slots: ContentSlotSpec[] = [{ slot: 'chero', take: 1, weights: { line: 0.3 },
      prefer: { test: (p) => p.type === 'guide', bonus: 0.5, label: 'completes the bag' } }];
    const pieces = [
      { ...P('big-lookbook', { line: ['Fenwick'] }, ['chero']), type: 'lookbook' },
      { ...P('small-guide', { line: ['Fenwick'] }, ['chero']), type: 'guide' },
    ];
    const ds = composeContent(pieces, { dims: { line: { Fenwick: 0.9 } } }, slots);
    expect(ds[0].contentId).toBe('small-guide');
    expect(ds[0].explain.drivers.some((d) => d.dim === 'completes')).toBe(true);
  });
});
