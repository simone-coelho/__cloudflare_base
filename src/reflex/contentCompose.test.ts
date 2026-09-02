// src/reflex/contentCompose.test.ts
// The candidate sets the ledger records: what was considered, in rank order,
// with the chosen pieces included — and the decisions unchanged by asking for them.

import { describe, it, expect } from 'vitest';
import { composeContent, composeContentDetailed, type ContentPieceLike, type ContentSlotSpec } from './contentCompose';

const piece = (id: string, tags: Record<string, string[]>, slots: string[]): ContentPieceLike =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: slots });

const pieces = [
  piece('a', { occasion: ['evening'], line: ['drover'] }, ['hero', 'story']),
  piece('b', { occasion: ['weekend'] }, ['hero', 'story']),
  piece('c', { line: ['drover'] }, ['story']),
  piece('p', {}, ['merch']),
];
const slots: ContentSlotSpec[] = [
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'p' },
  { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  { slot: 'story', take: 2, weights: { occasion: 0.3, line: 0.25 } },
];
const affinity = { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } };

describe('composeContentDetailed', () => {
  it('returns exactly the decisions composeContent returns', () => {
    expect(composeContentDetailed(pieces, affinity, slots).decisions).toEqual(composeContent(pieces, affinity, slots));
  });

  it('records the ranked candidates per slot, chosen included, deduped across slots', () => {
    const { decisions, candidates } = composeContentDetailed(pieces, affinity, slots);
    expect(candidates.merch).toEqual([{ contentId: 'p', score: 0 }]);
    expect(candidates.hero?.map((c) => c.contentId)).toEqual(['a', 'b']);
    expect(candidates.hero?.[0]?.score).toBeCloseTo(0.8 * 0.35 + 0.7 * 0.25, 3);
    // `a` went to the hero, so the story's candidate set never contains it.
    expect(candidates.story?.map((c) => c.contentId)).toEqual(['c', 'b']);
    expect(decisions.filter((d) => d.slot === 'story').map((d) => d.contentId)).toEqual(['c', 'b']);
  });

  it('honours the candidate limit', () => {
    const { candidates } = composeContentDetailed(pieces, affinity, slots, 1);
    expect(candidates.story).toHaveLength(1);
    expect(candidates.story?.[0]?.contentId).toBe('c');
  });
});
