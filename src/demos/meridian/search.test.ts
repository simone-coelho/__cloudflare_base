// src/demos/meridian/search.test.ts
//
// Decision 6's deterministic half, pinned. "Sweaters for winter" once returned
// a rain shell, a jacket, a muffler and a vest, because only the SCENE reached
// the ranker and the word "sweaters" evaporated. These tests hold the parts
// that must never regress and never need a model: the local intent parser, the
// hard category filter, colour ranking, and the empty-intent fallback to the
// scene's touches. No network, no key, no model call anywhere in this file.

import { describe, it, expect } from 'vitest';
import {
  parseIntentLocally, rankByIntent, intentHasSignal, EMPTY_INTENT,
  type SearchIntent,
} from './search';
import { itemsFor, itemById } from './catalog';
import type { MeridianItem } from './types';

const intentWith = (over: Partial<SearchIntent>): SearchIntent => ({ ...EMPTY_INTENT, ...over });

/**
 * A minimal synthetic retail item; `colour` rides along the way the catalogue
 * agent will add it, and category/world are plain strings because the LIVE
 * catalogue's vocabulary (Knitwear, Outerwear, …) is wider than the stale
 * union in types.ts — exactly as catalog.ts itself loads it.
 */
type SynthOver = Partial<Omit<MeridianItem, 'category' | 'world' | 'needs'>> & {
  colour?: string; category?: string; world?: string; needs?: string[];
};
let seq = 0;
function synth(over: SynthOver): MeridianItem {
  seq += 1;
  return {
    id: `SYN-${String(seq).padStart(3, '0')}`,
    vertical: 'retail',
    name: 'Synthetic Piece',
    category: 'Knitwear',
    subcategory: 'wool',
    value_usd: 100,
    world: 'heritage',
    needs: ['everyday'],
    blurb: '',
    available: true,
    ...over,
  } as unknown as MeridianItem;
}

describe('parseIntentLocally — the no-model fallback reads the noun', () => {
  it('parses "sweaters for winter" to categories [Knitwear]', () => {
    const intent = parseIntentLocally('retail', 'I am looking for sweaters for winter');
    expect(intent.categories).toEqual(['Knitwear']);
    expect(intent.priceCeilingUsd).toBe(0);
  });

  it('maps the mandated nouns, plurals stripped', () => {
    expect(parseIntentLocally('retail', 'boots').categories).toEqual(['Footwear']);
    expect(parseIntentLocally('retail', 'sneakers please').categories).toEqual(['Footwear']);
    expect(parseIntentLocally('retail', 'weekend bags').categories).toContain('Bags');
    expect(parseIntentLocally('retail', 'totes').categories).toContain('Bags');
    expect(parseIntentLocally('retail', 'warm coats').categories).toEqual(['Outerwear']);
    expect(parseIntentLocally('retail', 'a jacket').categories).toEqual(['Outerwear']);
  });

  it('reads a named line, an occasion, and a spoken price ceiling', () => {
    const intent = parseIntentLocally('retail', 'a Drover gift under $200');
    expect(intent.lines).toEqual(['Drover']);
    expect(intent.occasions).toContain('gift');
    expect(intent.priceCeilingUsd).toBe(200);
  });

  it('a sentence naming nothing yields an empty intent', () => {
    const intent = parseIntentLocally('retail', 'something wonderful please');
    expect(intentHasSignal(intent)).toBe(false);
  });
});

describe('rankByIntent — hard filter', () => {
  it('a named category returns ONLY that category', () => {
    const ids = rankByIntent('retail', itemsFor('retail'), intentWith({ categories: ['Knitwear'] }));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(8);
    for (const id of ids) expect(itemById(id)?.category).toBe('Knitwear');
  });

  it('never exceeds eight products', () => {
    const ids = rankByIntent('retail', itemsFor('retail'), EMPTY_INTENT,
      { touches: [{ dim: 'occasion', value: 'gift' }] });
    expect(ids.length).toBeLessThanOrEqual(8);
  });
});

describe('rankByIntent — deterministic scoring', () => {
  it('a named colour ranks that colourway first', () => {
    const items = [
      synth({ colour: 'coral' }),
      synth({ colour: 'teal' }),
      synth({ colour: 'indigo' }),
    ];
    const ids = rankByIntent('retail', items, intentWith({ colours: ['teal'] }));
    expect(ids[0]).toBe(items[1].id);
  });

  it('a named line hard-filters to it; ties inside break by catalogue order', () => {
    const items = [
      synth({ line: 'Linden' }),
      synth({ line: 'Fenwick' }),
      synth({ line: 'Fenwick' }),
    ];
    const ids = rankByIntent('retail', items, intentWith({ lines: ['Fenwick'] }));
    expect(ids).toEqual([items[1].id, items[2].id]);
  });

  it('an impossible category+line combination keeps the CATEGORY — the typed noun wins', () => {
    const items = [
      synth({ category: 'Outerwear', line: 'Drover' }),
      synth({ category: 'Knitwear', line: 'Fenwick' }),
    ];
    const ids = rankByIntent('retail', items,
      intentWith({ categories: ['Knitwear'], lines: ['Drover'] }));
    expect(ids).toEqual([items[1].id]);
  });

  it('empty intent falls back to the scene touches', () => {
    const items = [
      synth({ category: 'Knitwear' }),
      synth({ category: 'Outerwear', line: 'Drover' }),
      synth({ category: 'Outerwear' }),
    ];
    // cold-snap's own touches: category + line + styleWorld.
    const touches = [
      { dim: 'category', value: 'Outerwear' },
      { dim: 'line', value: 'Drover' },
      { dim: 'styleWorld', value: 'modern' },
    ];
    const ids = rankByIntent('retail', items, EMPTY_INTENT, { touches });
    // Two touch hits beat one; one beats none; the untouched item ranks last.
    expect(ids).toEqual([items[1].id, items[2].id, items[0].id]);
  });

  it('scene touches do NOT reorder once the intent names a facet — the noun wins', () => {
    const items = [
      synth({ category: 'Knitwear' }),
      synth({ category: 'Outerwear', line: 'Drover' }),
    ];
    const ids = rankByIntent('retail', items, intentWith({ categories: ['Knitwear'] }),
      { touches: [{ dim: 'category', value: 'Outerwear' }] });
    expect(ids).toEqual([items[0].id]);
  });

  it('the affinity term orders an otherwise tied pool, weighted 0.4 × Σa', () => {
    const items = [
      synth({ line: 'Linden' }),
      synth({ line: 'Fenwick' }),
    ];
    const affinity = { dims: { line: { Fenwick: 0.8 } }, audiences: [] };
    const ids = rankByIntent('retail', items, EMPTY_INTENT, { affinity });
    expect(ids[0]).toBe(items[1].id);
  });

  // A ceiling stated in words is a promise, not a preference: someone in the
  // room can read the price. It used to be a scoring bonus, so "under $150"
  // answered with a $165 piece ranked below the ones that qualified.
  it('a price ceiling EXCLUDES what is over it', () => {
    const items = [
      synth({ value_usd: 400 }),
      synth({ value_usd: 120 }),
    ];
    const ids = rankByIntent('retail', items, EMPTY_INTENT, { ceiling: 200 });
    expect(ids).toEqual([items[1].id]);
  });

  it('but never empties the answer: with nothing under it, the ceiling stands down', () => {
    const items = [synth({ value_usd: 400 }), synth({ value_usd: 380 })];
    const ids = rankByIntent('retail', items, EMPTY_INTENT, { ceiling: 200 });
    expect(ids).toHaveLength(2);
  });
});
