// src/demos/meridian/content.test.ts
//
// THE CONTENT CATALOGUE (doc 18 §3, the §17 content act). These pin the
// contract: every piece is schema-shaped and carries the customer's own id;
// every tag names a live registry dimension and a value the engine can actually
// score; the coverage the act depends on exists (a piece per major line, the
// evening story, the complement guides, the merchandiser's campaign, the
// cold-start pieces for the New York cohort's lead lines); ids are unique; and
// every retail piece's approved artwork is committed where its `art` points.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  contentFor, contentById, contentVocabFor, assertValidPiece,
  type ContentPiece, type ContentSlot,
} from './content';
import { itemsFor } from './catalog';

const retail = contentFor('retail');
const financial = contentFor('financial');
const all = [...retail, ...financial];
const vocab = contentVocabFor('retail');

const SLOTS: readonly ContentSlot[] = ['chero', 'carousel', 'story', 'merch'];
const KINDS = ['editorial', 'guide', 'lookbook', 'film', 'campaign'] as const;

describe('content catalogue — schema shape (doc 18 §3)', () => {
  it('carries 18 retail and 4 financial live pieces', () => {
    expect(retail.length).toBe(18);
    expect(financial.length).toBe(4);
  });

  it('gives every piece the contract fields: both ids, type, title, subtitle, tags, slots, lifecycle', () => {
    for (const p of all) {
      expect(p.systemId, p.customerContentId).toMatch(/^cnt_[0-9a-f]{8}$/);
      expect(p.customerContentId).toMatch(/^CMP-\d{4}$/);
      expect(KINDS).toContain(p.type);
      expect(p.title.length, p.customerContentId).toBeGreaterThan(0);
      expect(p.subtitle.length, p.customerContentId).toBeGreaterThan(0);
      expect(Object.keys(p.tags).length, `${p.customerContentId} has no tags`).toBeGreaterThan(0);
      expect(p.slotTypes.length, p.customerContentId).toBeGreaterThan(0);
      for (const s of p.slotTypes) expect(SLOTS, p.customerContentId).toContain(s);
      expect(p.lifecycle.status).toBe('live');
    }
  });

  it('gives every film a runtime, and only films carry one', () => {
    for (const p of all) {
      if (p.type === 'film') expect(p.runtime, p.customerContentId).toMatch(/^\d+:\d{2}$/);
      else expect(p.runtime, p.customerContentId).toBeUndefined();
    }
  });

  it('keeps ids unique, and resolves a piece by either id', () => {
    expect(new Set(all.map((p) => p.customerContentId)).size).toBe(all.length);
    expect(new Set(all.map((p) => p.systemId)).size).toBe(all.length);
    for (const p of all) {
      expect(contentById(p.customerContentId)).toBe(p);
      expect(contentById(p.systemId)).toBe(p);
    }
  });
});

describe('content catalogue — tags speak the live registry vocabulary', () => {
  it('tags only dimensions and values the vertical registry can score', () => {
    for (const vertical of ['retail', 'financial'] as const) {
      const v = contentVocabFor(vertical);
      for (const p of contentFor(vertical)) {
        for (const [dim, values] of Object.entries(p.tags)) {
          expect(v[dim], `${p.customerContentId} tags unknown dimension "${dim}"`).toBeDefined();
          for (const value of values) {
            expect(v[dim].has(value), `${p.customerContentId}: ${dim}="${value}" is not in the live vocabulary`).toBe(true);
          }
        }
      }
    }
  });

  it('throws loudly on a tag outside the vocabulary — the guard itself', () => {
    const base = retail[0];
    const badDim: ContentPiece = { ...base, tags: { aisle: ['Outerwear'] } };
    expect(() => assertValidPiece(badDim, vocab)).toThrow(/dimension "aisle"/);
    const badValue: ContentPiece = { ...base, tags: { line: ['Tabby'] } };
    expect(() => assertValidPiece(badValue, vocab)).toThrow(/line="Tabby"/);
    const badSlot = { ...base, slotTypes: ['sidebar'] } as unknown as ContentPiece;
    expect(() => assertValidPiece(badSlot, vocab)).toThrow(/unknown slot/);
    const mutefilm = { ...base, type: 'film', runtime: undefined } as unknown as ContentPiece;
    expect(() => assertValidPiece(mutefilm, vocab)).toThrow(/runtime/);
  });
});

describe('content catalogue — the coverage the act depends on', () => {
  const tagged = (dim: string, value: string) =>
    retail.filter((p) => (p.tags[dim] ?? []).includes(value));

  it('speaks for every major line', () => {
    for (const line of ['Drover', 'Fenwick', 'Linden', 'Holloway', 'Shorewell', 'Aster']) {
      expect(tagged('line', line).length, line).toBeGreaterThanOrEqual(1);
    }
  });

  it('has at least three evening pieces — the quiz story', () => {
    expect(tagged('occasion', 'evening').length).toBeGreaterThanOrEqual(3);
  });

  it('has at least two guides that COMPLEMENT a product — a line tagged with another category', () => {
    const categoryOfLine = new Map<string, Set<string>>();
    for (const item of itemsFor('retail')) {
      if (!item.line) continue;
      if (!categoryOfLine.has(item.line)) categoryOfLine.set(item.line, new Set());
      categoryOfLine.get(item.line)!.add(item.category);
    }
    const complements = retail.filter((p) => {
      if (p.type !== 'guide') return false;
      const lines = p.tags.line ?? [];
      const categories = p.tags.category ?? [];
      return lines.some((l) => categories.some((c) => !categoryOfLine.get(l)?.has(c)));
    });
    expect(complements.length).toBeGreaterThanOrEqual(2);
  });

  it('gives the merchandiser one campaign piece eligible for the pinned merch banner', () => {
    const campaigns = retail.filter((p) => p.type === 'campaign' && p.slotTypes.includes('merch'));
    expect(campaigns.length).toBeGreaterThanOrEqual(1);
  });

  it('has a cold-start piece for each New York lead line: Drover and Linden, browsing-stage, hero-eligible', () => {
    for (const line of ['Drover', 'Linden']) {
      const pieces = tagged('line', line).filter(
        (p) => (p.tags.journeyStage ?? []).includes('browsing') && p.slotTypes.includes('chero'),
      );
      expect(pieces.length, line).toBeGreaterThanOrEqual(1);
    }
  });

  it('spreads across all five kinds', () => {
    for (const kind of KINDS) {
      expect(retail.some((p) => p.type === kind) || financial.some((p) => p.type === kind), kind).toBe(true);
    }
  });

  it('keeps the financial pieces simple: guide/editorial, text-only, financial vocabulary', () => {
    for (const p of financial) {
      expect(['guide', 'editorial']).toContain(p.type);
      expect(p.art).toBeNull();
    }
  });
});

describe('content catalogue — the artwork is committed', () => {
  it('points every retail piece at approved art under /meridian/content/, and the file exists', () => {
    for (const p of retail) {
      expect(p.art, p.customerContentId).toMatch(/^\/meridian\/content\/CMP-\d{4}\.jpg$/);
      const file = join(process.cwd(), 'public', p.art!);
      expect(existsSync(file), `${p.customerContentId}: missing ${file}`).toBe(true);
    }
  });
});
