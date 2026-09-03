// src/content/decide.test.ts
// The seam with Phase 0, pinned: every record carries the doc 22 §3.1 fields,
// the arm changes what is served but never what is recorded, pins outrank the
// holdout, and the same input replays to the same output.

import { describe, it, expect } from 'vitest';
import { decideContent, type DecideInput } from './decide';
import type { ContentPiece, SlotStrategy } from './types';

const piece = (id: string, tags: Record<string, string[]>, slots: string[]): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: slots, lifecycle: { status: 'live' } });

const pieces = [
  piece('a', { occasion: ['evening'], line: ['drover'] }, ['hero', 'story']),
  piece('b', { occasion: ['weekend'] }, ['hero', 'story']),
  piece('c', { line: ['drover'] }, ['story']),
  piece('p', {}, ['merch']),
];
const slots: SlotStrategy[] = [
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'p' },
  { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  { slot: 'story', take: 2, weights: { occasion: 0.3, line: 0.25 } },
];
const base: DecideInput = {
  tenant: 'tapestry', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor', nowMs: 1_725_000_000_000,
  pieces, slots, affinity: { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } },
  cell: { channel: 'paid social', visit_bucket: '1', region: 'US-NY', affinity: 'occasion:evening' },
  arm: 'personalized', versions: { config: 41, lift: 0, prior: 0, policy: 0 }, configLabel: 'reflex-demo-v1+r41',
};

describe('decideContent', () => {
  it('emits the delivery contract and one §3.1 record per served position', () => {
    const out = decideContent(base);
    expect(out.decisions.map((d) => [d.slot, d.contentId])).toEqual([['merch', 'p'], ['hero', 'a'], ['story', 'c'], ['story', 'b']]);
    expect(out.records).toHaveLength(4);
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero).toMatchObject({
      tenant: 'tapestry', brand: 'coach', visitor_id: 'v1', session_id: 's1', ts: base.nowMs, page: 'home',
      position: 0, item_id: 'a', customer_item_id: 'cms-a', identity_anchor: 'visitor', arm: 'personalized', explored: false, authority: 'engine',
      versions: { config: 41, lift: 0, prior: 0, policy: 0 }, config_label: 'reflex-demo-v1+r41',
    });
    expect(hero.cell).toEqual(base.cell);
    expect(hero.candidates.map((c) => c.contentId)).toEqual(['a', 'b']);
    expect(hero.explain.score_base).toBeCloseTo(0.455, 3);
    expect(hero.explain.lift).toBeNull();
    expect(hero.explain.drivers[0]).toMatchObject({ dim: 'occasion', value: 'evening' });
    // The two story positions are distinct records with distinct ids.
    const story = out.records.filter((r) => r.slot === 'story');
    expect(story.map((r) => r.position)).toEqual([0, 1]);
    expect(new Set(out.records.map((r) => r.decision_id)).size).toBe(4);
  });

  it('the default arm serves the defaults, keeps the pin, and still records everything', () => {
    const out = decideContent({ ...base, arm: 'default' });
    expect(out.decisions.find((d) => d.slot === 'merch')?.contentId).toBe('p');
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.authority).toBe('default');
    expect(hero.arm).toBe('default');
    expect(hero.explain.drivers).toEqual([]);
    expect(hero.explain.score_base).toBe(0);
    expect(out.records).toHaveLength(4);
    // Default order is catalogue order: the first eligible piece by id.
    expect(hero.item_id).toBe('a');
  });

  it('a cold shopper on the personalized arm gets defaults marked as such', () => {
    const out = decideContent({ ...base, affinity: null });
    expect(out.records.find((r) => r.slot === 'hero')?.authority).toBe('default');
    expect(out.records.find((r) => r.slot === 'merch')?.authority).toBe('pin');
  });

  it('replays: the same input produces the same output', () => {
    expect(decideContent(base)).toEqual(decideContent(base));
    expect(JSON.stringify(decideContent(base))).toBe(JSON.stringify(decideContent({ ...base })));
  });

  it('an unknown page yields no decisions and no records, not an error', () => {
    const out = decideContent({ ...base, slots: [] });
    expect(out.decisions).toEqual([]);
    expect(out.records).toEqual([]);
  });
});

// ── CW6: the regional prior, itemized on the receipt ────────────────────────
describe('decideContent with a regional prior', () => {
  it('appends a regional driver and records what the region contributed', () => {
    const out = decideContent({
      ...base, affinity: { dims: { occasion: { evening: 0.62 }, line: { drover: 0.35 } } },
      regional: { region: 'US-NY', level: 'region', lambda: 0.5, version: 7, events: 120, share: { line: { drover: 0.7 } } },
    });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(out.regional).toEqual({ region: 'US-NY', level: 'region', lambda: 0.5, version: 7, events: 120 });
    expect(hero.explain.regional).toEqual({ region: 'US-NY', level: 'region', lambda: 0.5, version: 7, events: 120, contribution: 0.088 }); // 0.5 × 0.7 × 0.25
    const drv = hero.explain.drivers.find((d) => d.dim === 'regional')!;
    expect(drv).toEqual({ dim: 'regional', value: 'US-NY', a: 0.5, weight: 0.176 });   // 0.088 / 0.5, rounded
    expect(Math.round(drv.a * drv.weight * 1000) / 1000).toBe(0.088);
  });

  it('the holdout default arm gets no prior', () => {
    const out = decideContent({ ...base, arm: 'default', regional: { region: 'US-NY', level: 'region', lambda: 1, version: 1, events: 50, share: { line: { drover: 1 } } } });
    expect(out.regional).toBeNull();
    expect(out.records.every((r) => r.explain.regional === undefined)).toBe(true);
  });
});
