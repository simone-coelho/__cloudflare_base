// src/content/freshFatigue.test.ts
// CW30 (BTIE D2): recent content gets a bonus that halves every half-life from
// the piece's freshness date; content this visitor was already served gets a
// penalty that grows with the count in the ring up to the cap. Both dials on
// the slot, both itemised, both off on the default arm, and the served counts
// travel on the record's inputs so a replay reproduces the penalty.

import { describe, it, expect } from 'vitest';
import { decideContent, type DecideInput } from './decide';
import { validateContentCatalog, validateSlotCatalog } from './kinds';
import { readRing, servedCounts } from '@/learn/fan';
import { normalizePiece } from './import';
import type { ContentPiece, SlotStrategy } from './types';

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const DAY = 86_400_000;
const piece = (id: string, extra: Partial<ContentPiece> = {}): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags: { occasion: ['weekend'] }, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...extra });

// Same affinity for all three, so only freshness and fatigue separate them.
const pieces = [
  piece('new', { freshnessDate: new Date(NOW - 1 * DAY).toISOString() }),
  piece('old', { freshnessDate: new Date(NOW - 30 * DAY).toISOString() }),
  piece('undated'),
];
const slot = (extra: Partial<SlotStrategy> = {}): SlotStrategy => ({ slot: 'hero', take: 3, weights: { occasion: 0.5 }, ...extra });
const base: DecideInput = {
  tenant: 'tapestry', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor', nowMs: NOW,
  pieces, slots: [slot({ freshness: { weight: 0.2, halfLifeDays: 7 } })], affinity: { dims: { occasion: { weekend: 0.4 } } },
  cell: { channel: 'direct', visit_bucket: '2-3', region: null, affinity: null, stage: 'unknown' },
  arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
};
const rec = (out: ReturnType<typeof decideContent>, id: string) => out.records.find((r) => r.item_id === id)!;

describe('CW30 freshness', () => {
  it('adds weight × 2^(−age/halfLife) from the freshness date, itemised, and nothing for an undated piece', () => {
    const out = decideContent(base);
    expect(out.decisions.map((d) => d.contentId)).toEqual(['new', 'old', 'undated']);
    const n = rec(out, 'new');
    expect(n.explain.freshness).toEqual({ ageDays: 1, decay: 0.906, applied: 0.181, sentence: '1 days old, freshness at 0.906 of new: +0.181' });
    expect(n.explain.score_base).toBeCloseTo(0.2 + 0.181, 3);
    expect(n.explain.drivers).toContainEqual({ dim: 'freshness', value: '1 days old', a: 0.906, weight: 0.2 });
    expect(rec(out, 'old').explain.freshness?.applied).toBe(0.01);    // 30 days at a 7-day half-life: 0.2 × 2^(−30/7)
    expect(rec(out, 'undated').explain.freshness).toBeUndefined();
  });

  it('ages from window.from when there is no freshness date, and is off on the default arm', () => {
    const dated = decideContent({ ...base, pieces: [piece('w', { window: { from: new Date(NOW - 7 * DAY).toISOString() } })] });
    expect(dated.records[0]!.explain.freshness).toMatchObject({ ageDays: 7, decay: 0.5, applied: 0.1 });
    const dflt = decideContent({ ...base, arm: 'default' });
    expect(dflt.records.every((r) => r.explain.freshness === undefined)).toBe(true);
  });
});

describe('CW30 fatigue', () => {
  const fatigued: DecideInput = { ...base, slots: [slot({ fatigue: { weight: 0.3, windowHours: 168, cap: 3 } })], served: { hero: { new: 1, old: 5 } } };

  it('subtracts weight × min(served, cap) / cap for what the ring says was served, itemised, never below zero', () => {
    const out = decideContent(fatigued);
    expect(out.decisions.map((d) => d.contentId)).toEqual(['undated', 'new', 'old']);
    expect(rec(out, 'new').explain.fatigue).toEqual({ served: 1, windowHours: 168, applied: -0.1, sentence: 'this shopper was served it 1 time in the last 168 hours: -0.1' });
    expect(rec(out, 'new').explain.drivers).toContainEqual({ dim: 'fatigue', value: 'served 1 time in 168 h', a: 0.333, weight: -0.3 });
    // Five servings cap at three: the whole 0.3 comes off, and the base cannot go below zero (0.2 − 0.3 → 0, applied −0.2).
    expect(rec(out, 'old').explain.fatigue).toMatchObject({ served: 5, applied: -0.2 });
    expect(rec(out, 'old').explain.score_base).toBe(0);
    expect(rec(out, 'undated').explain.fatigue).toBeUndefined();
    // The counts are on the inputs, so the replay sees what the ring said.
    expect(out.records[0]!.inputs?.served).toEqual({ hero: { new: 1, old: 5 } });
  });

  it('is off without a ring read, on the default arm, and replays from the inputs', () => {
    const none = decideContent({ ...fatigued, served: null });
    expect(none.records.every((r) => r.explain.fatigue === undefined)).toBe(true);
    expect(none.records[0]!.inputs?.served).toBeUndefined();
    const dflt = decideContent({ ...fatigued, arm: 'default' });
    expect(dflt.records.every((r) => r.explain.fatigue === undefined)).toBe(true);
    const first = decideContent(fatigued);
    const again = decideContent({ ...fatigued, served: first.records[0]!.inputs!.served! });
    expect(again.records).toEqual(first.records);
  });

  it('reads the ring\'s full records as entries, under its budget, and gives nothing when unbound or slow', async () => {
    const record = { decision_id: 'd1', ts: NOW - DAY, page: 'home', slot: 'hero', item_id: 'a', session_id: 's', arm: 'personalized', cell: base.cell, featured_product_ids: ['P1'] };
    const ns = (delayMs: number) => ({ idFromName: (n: string) => n, get: () => ({ fetch: async () => { await new Promise((r) => setTimeout(r, delayMs)); return new Response(JSON.stringify({ ok: true, ring: [record] })); } }) }) as unknown as DurableObjectNamespace;
    const fast = await readRing({ DECISION_RING: ns(0) }, 'coach', 'v1', 200);
    // Witness src/learn/fan.ts:245 (ringEntryOf): every entry carries the basis it was counted on, defaulting to served-v1
    // (document 35 §5 W26: "defined served/rendered/viewable unit"), which servedCounts then matches per slot.
    expect(fast).toEqual([{ id: 'd1', ts: NOW - DAY, page: 'home', slot: 'hero', item: 'a', session_id: 's', arm: 'personalized', cell: base.cell, measurementBasis: 'served-v1', products: ['P1'] }]);
    expect(servedCounts(fast!, [{ slot: 'hero', fatigue: { weight: 0.3, windowHours: 168 } }], NOW)).toEqual({ hero: { a: 1 } });
    expect(await readRing({ DECISION_RING: ns(80) }, 'coach', 'v1', 20)).toBeNull();
    expect(await readRing({}, 'coach', 'v1')).toBeNull();
  });

  it('counts the ring inside each slot\'s window only', () => {
    const entry = (item: string, ts: number, slotName = 'hero') => ({ id: `d-${item}-${ts}`, ts, page: 'home', slot: slotName, item, session_id: 's', arm: 'personalized' as const, cell: base.cell });
    const ring = [entry('a', NOW - 1 * DAY), entry('a', NOW - 2 * DAY, 'story'), entry('a', NOW - 10 * DAY), entry('b', NOW - 3_600_000), entry('c', NOW + 1000)];
    const counts = servedCounts(ring, [{ slot: 'hero', fatigue: { weight: 0.3, windowHours: 168 } }, { slot: 'story', fatigue: { weight: 0.3, windowHours: 1 } }, { slot: 'quiet' }], NOW);
    expect(counts).toEqual({ hero: { a: 2, b: 1 }, story: { b: 1 } });
  });
});

describe('CW30 schema', () => {
  it('validates freshnessDate and the two slot dials', () => {
    expect(validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['hero'], freshnessDate: '2026-09-01T00:00:00Z' }] }).ok).toBe(true);
    const bad = validateContentCatalog({ pieces: [{ id: 'a', customerContentId: 'c', type: 't', title: 'a', tags: {}, slotTypes: ['hero'], freshnessDate: 'yesterday' }] });
    expect(bad.ok).toBe(false);
    const ok = validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: {}, freshness: { weight: 0.2, halfLifeDays: 7 }, fatigue: { weight: 0.3, windowHours: 168, cap: 3 } }] } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.pages.home![0]).toMatchObject({ freshness: { weight: 0.2, halfLifeDays: 7 }, fatigue: { weight: 0.3, windowHours: 168, cap: 3 } });
    expect(validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: {}, freshness: { weight: 2, halfLifeDays: 7 } }] } }).ok).toBe(false);
    expect(validateSlotCatalog({ pages: { home: [{ slot: 'hero', take: 1, weights: {}, fatigue: { weight: 0.3, windowHours: 168, cap: 0 } }] } }).ok).toBe(false);
  });

  it('the import adapter carries the BTIE names through', () => {
    const p = normalizePiece({ id: 'x', title: 'x', tags: {}, slotTypes: ['hero'], journey_stage_fit: 'exploring|considering', freshness_date: '2026-09-01' })!;
    expect(p.journeyStageFit).toEqual(['exploring', 'considering']);
    expect(p.freshnessDate).toBe('2026-09-01');
  });
});
