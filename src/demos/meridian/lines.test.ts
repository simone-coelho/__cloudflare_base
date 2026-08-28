// src/demos/meridian/lines.test.ts
//
// PRODUCT LINES (decision D3). The retail catalogue's narrow dimension is the
// LINE — the family a luxury house merchandises by — not the material. These
// pin the contract: every retail piece belongs to a line, every line is big
// enough to mint an audience, the line leads the name, the registry reads it
// as the narrow shape, and everything that touches the narrow dimension by
// hand (scenes, surfaces) names a line that actually exists.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractTouches, audienceKey } from '@/reflex/core';
import { itemsFor } from './catalog';
import { configFor, SHAPE_OF_KEY } from './reflexConfig';
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

  it('keeps every name within 26 characters and keeps material as a display attribute', () => {
    for (const it of retail) {
      expect(it.name.length, it.name).toBeLessThanOrEqual(26);
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
