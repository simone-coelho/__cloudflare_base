// src/demos/meridian/lines.test.ts
//
// PRODUCT LINES (decision D3) and FAMILIES × COLOURWAYS (decision D8). The
// retail catalogue's narrow dimension is the LINE — the family a luxury house
// merchandises by — not the material; and the catalogue itself is twelve
// families of three colourways plus four fragrance singles, so "three of the
// same thing" can happen and COLOUR is a dimension (`hue`: colour ← colour in
// retail, tier ← tier in financial). These pin the contract: every retail
// piece belongs to a line, every line and family is big enough to mint an
// audience, the family leads the name and the colourway closes it, every
// retail item carries a colour, the registry reads line as the narrow shape
// and colour/tier as the hue shape, and everything that touches the narrow
// dimension by hand (scenes, surfaces) names a line that actually exists.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractTouches, audienceKey } from '@/reflex/core';
import { itemsFor } from './catalog';
import { configFor, SHAPE_OF_KEY, SHAPE_ORDER } from './reflexConfig';
import { vocabularyFor } from './opal';
import { RETAIL_SCENES } from './scenes';
import type { MeridianItem } from './types';

type Lined = MeridianItem & { line: string };
const retail = itemsFor('retail') as readonly Lined[];
const cfg = configFor('retail');
const lines = new Set(retail.map((i) => i.line));

describe('product lines (D3)', () => {
  it('gives every retail item a line, and the line leads the name', () => {
    expect(retail.length).toBe(40);
    for (const it of retail) {
      expect(typeof it.line, it.id).toBe('string');
      expect(it.line.length, it.id).toBeGreaterThan(0);
      expect(it.name.startsWith(`${it.line} `), `${it.id} ${it.name}`).toBe(true);
    }
  });

  it('has 8–10 lines, every one with at least three pieces', () => {
    expect(lines.size).toBeGreaterThanOrEqual(8);
    expect(lines.size).toBeLessThanOrEqual(10);
    for (const line of lines) {
      expect(retail.filter((i) => i.line === line).length, line).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps every name within 36 characters and keeps material as a display attribute', () => {
    // 26 was the LINE-led cap; a colourway name carries family AND colour, and
    // the measured longest is "Fenwick Fisherman Sweater · Charcoal" (36).
    for (const it of retail) {
      expect(it.name.length, it.name).toBeLessThanOrEqual(36);
      expect(typeof it.subcategory, it.id).toBe('string');
      expect(it.subcategory.length, it.id).toBeGreaterThan(0);
    }
  });

  it('registers line as the retail narrow shape; financial keeps subFamily ← subcategory', () => {
    const narrow = cfg.dimensions.find((d) => d.key === 'line');
    expect(narrow?.source).toBe('line');
    expect(SHAPE_OF_KEY.line).toBe('narrow');
    expect(cfg.dimensions.some((d) => d.key === 'subcategory')).toBe(false);
    expect(SHAPE_OF_KEY.subcategory).toBeUndefined();

    const fin = configFor('financial').dimensions.find((d) => d.key === 'subFamily');
    expect(fin?.source).toBe('subcategory');
    expect(SHAPE_OF_KEY.subFamily).toBe('narrow');
  });

  it('extractTouches yields a line touch for a retail item, and no subcategory touch', () => {
    const it = retail.find((i) => i.line === 'Drover')!;
    const touches = extractTouches(it as unknown as Record<string, unknown>, cfg);
    expect(touches).toContainEqual({ dim: 'line', value: 'Drover' });
    expect(touches.some((t) => t.dim === 'subcategory')).toBe(false);
  });

  it('mints the audience key as line_<slug>_affinity', () => {
    expect(audienceKey('line', 'Drover')).toBe('line_drover_affinity');
    expect(audienceKey('line', 'Linden')).toBe('line_linden_affinity');
  });

  it('derives the Opal vocabulary from the registry, so line replaces subcategory there too', () => {
    const vocab = vocabularyFor('retail');
    expect(new Set(vocab.line)).toEqual(lines);
    expect(vocab.subcategory).toBeUndefined();
  });

  it('names a real line wherever a scene or surface touches the narrow dimension', () => {
    const touched: Array<{ from: string; value: string }> = [];
    for (const s of RETAIL_SCENES) {
      for (const t of s.touches) if (t.dim === 'line') touched.push({ from: s.id, value: t.value });
    }
    // surfaces.js is browser-side ESM with no TypeScript twin; read its touches off the source.
    const src = readFileSync('public/meridian/surfaces.js', 'utf8');
    for (const m of src.matchAll(/dim:\s*'line',\s*value:\s*'([^']+)'/g)) {
      touched.push({ from: 'surfaces.js', value: m[1]! });
    }
    expect(touched.length).toBeGreaterThan(0);
    for (const t of touched) expect(lines.has(t.value), `${t.from} → ${t.value}`).toBe(true);

    // And nothing still touches the retired key.
    expect(RETAIL_SCENES.some((s) => s.touches.some((t) => t.dim === 'subcategory'))).toBe(false);
    expect(/dim:\s*'subcategory'/.test(src)).toBe(false);
  });
});

describe('families × colourways (D8)', () => {
  const familied = retail.filter((i) => i.family);
  const singles = retail.filter((i) => !i.family);
  const families = new Set(familied.map((i) => i.family!));
  const titleCase = (s: string) => s.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

  it('is twelve families of exactly three colourways, plus the four Solstice singles', () => {
    expect(families.size).toBe(12);
    for (const family of families) {
      const cw = familied.filter((i) => i.family === family);
      expect(cw.length, family).toBe(3);
      expect(new Set(cw.map((i) => i.colour)).size, family).toBe(3);   // three DIFFERENT colours
    }
    expect(singles.length).toBe(4);
    for (const s of singles) expect(s.line, s.id).toBe('Solstice');
  });

  it('names a family SKU as "<family> · <Colour>", with the family led by its line', () => {
    for (const it of familied) {
      expect(it.family!.startsWith(`${it.line} `), `${it.id} ${it.family}`).toBe(true);
      expect(it.name, it.id).toBe(`${it.family} · ${titleCase(it.colour!)}`);
    }
  });

  it('holds price, world, needs and material constant across a family — only the colour varies', () => {
    for (const family of families) {
      const cw = familied.filter((i) => i.family === family);
      expect(new Set(cw.map((i) => i.value_usd)).size, family).toBe(1);
      expect(new Set(cw.map((i) => i.world)).size, family).toBe(1);
      expect(new Set(cw.map((i) => i.subcategory)).size, family).toBe(1);
      expect(new Set(cw.map((i) => JSON.stringify(i.needs))).size, family).toBe(1);
    }
  });

  it('puts a lowercase colour on every retail item, singles included', () => {
    for (const it of retail) {
      expect(typeof it.colour, it.id).toBe('string');
      expect(it.colour!.length, it.id).toBeGreaterThan(0);
      expect(it.colour, it.id).toBe(it.colour!.toLowerCase());
    }
  });

  it('repeats colours across families, so a colour affinity is observable', () => {
    const count = new Map<string, number>();
    for (const it of retail) count.set(it.colour!, (count.get(it.colour!) ?? 0) + 1);
    // black is the archetype: it must recur enough to clear the audience floor.
    expect(count.get('black')!).toBeGreaterThanOrEqual(3);
    expect([...count.values()].filter((n) => n >= 3).length).toBeGreaterThanOrEqual(3);
  });

  it('registers hue as the eighth shape: colour ← colour in retail, tier ← tier in financial', () => {
    const hue = cfg.dimensions.find((d) => d.key === 'colour');
    expect(hue?.source).toBe('colour');
    expect(SHAPE_OF_KEY.colour).toBe('hue');

    const fin = configFor('financial').dimensions.find((d) => d.key === 'tier');
    expect(fin?.source).toBe('tier');
    expect(SHAPE_OF_KEY.tier).toBe('hue');

    // On the instrument it sits right after the durable axis, in both verticals.
    expect(SHAPE_ORDER.indexOf('hue')).toBe(SHAPE_ORDER.indexOf('durable') + 1);
    expect(cfg.dimensions.map((d) => SHAPE_OF_KEY[d.key]))
      .toEqual(configFor('financial').dimensions.map((d) => SHAPE_OF_KEY[d.key]));
  });

  it('extractTouches yields a colour touch for retail, a tier touch for tiered cards, none otherwise', () => {
    const jacket = retail.find((i) => i.family === 'Drover Field Jacket')!;
    expect(extractTouches(jacket as unknown as Record<string, unknown>, cfg))
      .toContainEqual({ dim: 'colour', value: jacket.colour });

    const finCfg = configFor('financial');
    const financial = itemsFor('financial');
    const platinum = financial.find((i) => i.name === 'Platinum Rewards Card')!;
    expect(extractTouches(platinum as unknown as Record<string, unknown>, finCfg))
      .toContainEqual({ dim: 'tier', value: 'black' });
    const loc = financial.find((i) => i.name === 'Personal Line of Credit')!;
    expect(loc.tier).toBeUndefined();
    expect(extractTouches(loc as unknown as Record<string, unknown>, finCfg)
      .some((t) => t.dim === 'tier')).toBe(false);
    // The five Card products: four tiers, one deliberate absence.
    expect(financial.filter((i) => i.tier).map((i) => i.tier).sort())
      .toEqual(['black', 'blue', 'gold', 'silver']);
  });

  it('mints colour audiences, two-word colours included', () => {
    expect(audienceKey('colour', 'black')).toBe('colour_black_affinity');
    expect(audienceKey('colour', 'rose gold')).toBe('colour_rose_gold_affinity');
  });

  it('exposes colour in the Opal vocabulary, straight from the registry', () => {
    const vocab = vocabularyFor('retail');
    expect(new Set(vocab.colour)).toEqual(new Set(retail.map((i) => i.colour!)));
    expect(vocabularyFor('financial').tier?.sort()).toEqual(['black', 'blue', 'gold', 'silver']);
  });
});
