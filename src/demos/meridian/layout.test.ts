// src/demos/meridian/layout.test.ts
//
// Section order (decision D4). Four re-orderable regions; the engine decides
// where each sits per visitor — intent first, then weight, then template order.
// These pin the things the room will see: a cold page in template order, the
// offer climbing to the top the moment someone decides, the rank holding while
// the interest fades through the hysteresis band, the return to template order
// when it crosses out — and the receipt that says why, in the same vocabulary
// as a slot decision.

import { describe, it, expect } from 'vitest';
import { apply, emptyState, snapshot, extractTouches } from '@/reflex/core';
import { composeLayout, SECTIONS, OFFER_COPY, type LayoutInput } from './layout';
import { configFor, SHAPE_OF_KEY, stageKeyFor } from './reflexConfig';
import { captureLayout, rowsForLayout, MRD_DECISION_COLUMNS } from './receipts';
import type { MeridianItem } from './types';

const cfg = configFor('retail');
const TEMPLATE = ['hero', 'offer', 'row', 'block_a'];

const view = (dims: Record<string, Record<string, number>>, extra: Partial<LayoutInput> = {}): LayoutInput =>
  ({ affinity: { dims, audiences: [] }, config: cfg, shapeOfKey: SHAPE_OF_KEY, ...extra });

/** Premium band, plainly deciding, a little broad interest. The spec's visitor. */
const PREMIUM_DECIDING = {
  priceBand: { premium: 0.71 },
  journeyStage: { deciding: 0.68, browsing: 0.2 },
  category: { Bags: 0.31 },
  styleWorld: { heritage: 0.31 },
};
const at = (r: ReturnType<typeof composeLayout>, id: string) => r.sections.find((s) => s.section === id)!;

describe('composeLayout', () => {
  it('cold start → template order, and says so', () => {
    const r = composeLayout(view({}));
    expect(r.order).toEqual(TEMPLATE);
    for (const s of r.sections) {
      expect(s.strategy).toBe('template');
      expect(s.rank).toBe(s.templateRank);
      expect(s.score).toBe(0);
      expect(s.explain.movedBecause).toBe('cold start; template order');
      expect(s.explain.configVersion).toBe(cfg.version);
    }
  });

  it('premium + deciding → the offer ranks 1 under the locked takeover, by intent', () => {
    const r = composeLayout(view(PREMIUM_DECIDING, { locked: ['takeover'] }));
    expect(r.order).toEqual(['takeover', 'offer', 'hero', 'row', 'block_a']);

    const offer = at(r, 'offer');
    expect(offer.rank).toBe(1);
    expect(offer.templateRank).toBe(2);
    expect(offer.strategy).toBe('stage');
    expect(offer.score).toBeCloseTo(0.5 * 0.71 + 0.5 * 0.68, 6);
    expect(offer.explain.lead).toEqual({ shape: 'stage', dim: 'journeyStage', value: 'deciding' });
    expect(offer.explain.confidence).toBe(0.68);
    expect(offer.explain.thetaOut).toBe(0.45);
    expect(offer.explain.movedBecause)
      .toBe('journeyStage·deciding 0.68 ≥ θout 0.45; intent outranks hero (0.31) on band+stage');
    // The drivers are scoreOne's own: dim, value, a, ω·a — the slot vocabulary.
    expect(offer.explain.drivers).toEqual([
      { dim: 'priceBand', value: 'premium', a: 0.71, weight: 0.355 },
      { dim: 'journeyStage', value: 'deciding', a: 0.68, weight: 0.34 },
    ]);

    // The hero was passed, not moved: it holds template order under the offer.
    const hero = at(r, 'hero');
    expect(hero.strategy).toBe('template');
    expect(hero.rank).toBe(2);
    expect(hero.explain.movedBecause).toBe('template order; pushed to rank 2 by offer (0.70)');

    // Without the takeover the same visitor puts the offer at the very top.
    expect(composeLayout(view(PREMIUM_DECIDING)).order).toEqual(['offer', 'hero', 'row', 'block_a']);
  });

  it("uses the engine's own numbers: one add-to-bag on a premium bag puts the offer on top", () => {
    const now = 1_700_000_000_000;
    const bag: MeridianItem = {
      id: 'MRD-R999', vertical: 'retail', name: 'Test tote', category: 'Bags', subcategory: 'Tote',
      value_usd: 420, world: 'heritage', needs: ['gift'], blurb: '',
    };
    const touches = [...extractTouches(bag as unknown as Record<string, unknown>, cfg),
      { dim: stageKeyFor('retail'), value: 'deciding' }];
    const res = apply(emptyState(cfg), { action: 'intent_start', touches }, now, cfg);
    const snap = snapshot(res.state, now, cfg);

    const r = composeLayout({ affinity: snap, config: cfg, shapeOfKey: SHAPE_OF_KEY });
    const offer = at(r, 'offer');
    expect(offer.rank).toBe(0);
    expect(offer.strategy).toBe('stage');
    // a = 3.0 / (3.0 + 1.4): one decisive act clears θ_in on its own.
    expect(offer.explain.confidence).toBeCloseTo(3 / 4.4, 3);
    expect(offer.explain.drivers.map((d) => d.dim).sort()).toEqual(['journeyStage', 'priceBand']);
  });

  it('hysteresis: between θ_out and θ_in the raised rank holds', () => {
    // Intent has faded from 0.68 to 0.50 — under θ_in (0.60), still over θ_out (0.45).
    const fading = { ...PREMIUM_DECIDING, journeyStage: { deciding: 0.5 } };
    const r = composeLayout(view(fading, { prevOrder: ['offer', 'hero', 'row', 'block_a'] }));
    const offer = at(r, 'offer');
    expect(offer.rank).toBe(0);
    expect(offer.prevRank).toBe(0);
    expect(offer.strategy).toBe('stage');
    expect(offer.explain.movedBecause).toMatch(/^journeyStage·deciding 0\.50 ≥ θout 0\.45; intent outranks/);
  });

  it('hysteresis on score: a section that climbed keeps its rank while its lead is confident, even once outscored', () => {
    // Content lead at 0.50 (over θ_out, under θ_in); the hero now scores higher.
    const dims = {
      contentType: { guide: 0.5 },
      category: { Bags: 0.7 },
      styleWorld: { heritage: 0.7 },
    };
    // Fresh walk: block_a climbs past the silent offer and row, not past the hero.
    const fresh = composeLayout(view(dims));
    expect(fresh.order).toEqual(['hero', 'block_a', 'offer', 'row']);
    const fb = at(fresh, 'block_a');
    expect(fb.strategy).toBe('affinity');
    expect(fb.score).toBeCloseTo(0.7 * 0.5 + 0.3 * 0.7, 6);
    expect(fb.explain.movedBecause)
      .toBe('contentType·guide 0.50 ≥ θout 0.45; outscored offer (0.00), row (0.00) on content+broad');

    // Last frame it sat above the hero: it stays there until its lead lets go.
    const held = composeLayout(view(dims, { prevOrder: ['block_a', 'hero', 'offer', 'row'] }));
    expect(held.order).toEqual(['block_a', 'hero', 'offer', 'row']);
    const hb = at(held, 'block_a');
    expect(hb.strategy).toBe('affinity');
    expect(hb.explain.movedBecause).toBe(
      'contentType·guide 0.50 ≥ θout 0.45; outscored offer (0.00), row (0.00) on content+broad; '
      + 'holding above hero (0.70) until contentType decays under θout',
    );

    // Lead under θ_out: the hold ends, whatever the score says.
    const gone = composeLayout(view({ ...dims, contentType: { guide: 0.4 } },
      { prevOrder: ['block_a', 'hero', 'offer', 'row'] }));
    expect(gone.order).toEqual(TEMPLATE);
    expect(at(gone, 'block_a').strategy).toBe('template');
  });

  it('below θ_out → back to template rank, and the receipt names the number that ended it', () => {
    // Band still premium at 0.71 — the score alone would still beat the hero.
    // The LEAD is the verb, and the verb has gone: the rank goes with it.
    const lapsed = { ...PREMIUM_DECIDING, journeyStage: { deciding: 0.4 } };
    const r = composeLayout(view(lapsed, { prevOrder: ['offer', 'hero', 'row', 'block_a'] }));
    expect(r.order).toEqual(TEMPLATE);
    const offer = at(r, 'offer');
    expect(offer.rank).toBe(1);
    expect(offer.prevRank).toBe(0);
    expect(offer.strategy).toBe('template');
    expect(offer.score).toBeCloseTo(0.5 * 0.71 + 0.5 * 0.4, 6);
    expect(offer.explain.movedBecause).toBe('journeyStage·deciding 0.40 < θout 0.45; returned to template rank 1');
    expect(at(r, 'hero').explain.movedBecause).toBe('category·Bags 0.31 < θout 0.45; template order');
  });

  it('movedBecause is a sentence on every section in every state', () => {
    const runs = [
      composeLayout(view({})),
      composeLayout(view(PREMIUM_DECIDING, { locked: ['takeover'] })),
      composeLayout(view({ ...PREMIUM_DECIDING, journeyStage: { deciding: 0.4 } }, { prevOrder: ['offer', ...TEMPLATE.filter((t) => t !== 'offer')] })),
      composeLayout(view({ contentType: { guide: 0.9 } })),
    ];
    for (const r of runs) {
      for (const s of r.sections) {
        expect(typeof s.explain.movedBecause).toBe('string');
        expect(s.explain.movedBecause.length).toBeGreaterThan(8);
      }
    }
  });

  it('a locked takeover stays at rank 0 through intent priority; a locked hero holds rank 0 too', () => {
    const tk = composeLayout(view(PREMIUM_DECIDING, { locked: ['takeover'], prevOrder: ['takeover', 'hero', 'offer', 'row', 'block_a'] }));
    expect(tk.order[0]).toBe('takeover');
    expect(at(tk, 'takeover')).toMatchObject({ rank: 0, prevRank: 0, templateRank: 0, strategy: 'locked' });
    expect(at(tk, 'takeover').explain.lead).toBeNull();

    // The takeover arriving shifts every rank by one. That is not a fall.
    const shifted = composeLayout(view(PREMIUM_DECIDING, { locked: ['takeover'], prevOrder: TEMPLATE }));
    expect(at(shifted, 'hero').explain.movedBecause).not.toMatch(/returned/);

    const lockedHero = composeLayout(view(PREMIUM_DECIDING, { locked: ['hero'] }));
    expect(lockedHero.order).toEqual(TEMPLATE);
    expect(at(lockedHero, 'hero')).toMatchObject({ rank: 0, strategy: 'locked' });
    const offer = at(lockedHero, 'offer');
    expect(offer).toMatchObject({ rank: 1, strategy: 'stage' });
    expect(offer.explain.movedBecause).toBe('journeyStage·deciding 0.68 ≥ θout 0.45; intent priority; already at template rank');
  });

  it('speaks the financial vocabulary unchanged: applying + major moves the offer the same way', () => {
    const fin = configFor('financial');
    const r = composeLayout({
      affinity: { dims: { amountBand: { major: 0.6 }, applicationStage: { applying: 0.7 } }, audiences: [] },
      config: fin, shapeOfKey: SHAPE_OF_KEY,
    });
    const offer = at(r, 'offer');
    expect(offer).toMatchObject({ rank: 0, strategy: 'stage' });
    expect(offer.explain.lead).toEqual({ shape: 'stage', dim: 'applicationStage', value: 'applying' });
    expect(offer.explain.drivers.map((d) => `${d.dim}.${d.value}`).sort()).toEqual(['amountBand.major', 'applicationStage.applying']);
    expect(offer.explain.configVersion).toBe(fin.version);
  });

  it('is deterministic and always a permutation of the grammar', () => {
    const input = view(PREMIUM_DECIDING, { locked: ['takeover'], prevOrder: TEMPLATE });
    expect(JSON.stringify(composeLayout(input))).toBe(JSON.stringify(composeLayout(input)));
    const cases: Array<Record<string, Record<string, number>>> =
      [{}, PREMIUM_DECIDING, { contentType: { guide: 0.9 }, occasion: { gift: 0.9 } }];
    for (const dims of cases) {
      const r = composeLayout(view(dims));
      expect([...r.order].sort()).toEqual([...TEMPLATE].sort());
      expect(r.sections.map((s) => s.rank)).toEqual([0, 1, 2, 3]);
    }
  });

  it('declares the grammar the design fixed, and the offer copy for both businesses', () => {
    expect(SECTIONS.map((s) => [s.id, s.answers])).toEqual([
      ['hero', { broad: 0.5, durable: 0.5 }],
      ['offer', { band: 0.5, stage: 0.5 }],
      ['row', { narrow: 0.5, need: 0.5 }],
      ['block_a', { content: 0.7, broad: 0.3 }],
    ]);
    expect(SECTIONS.find((s) => s.id === 'offer')?.kind).toBe('offer');
    for (const v of ['retail', 'financial'] as const) {
      for (const k of ['kicker', 'title', 'body', 'cta'] as const) expect(OFFER_COPY[v][k].length).toBeGreaterThan(0);
    }
    expect(OFFER_COPY.retail.cta).toBe('Apply in 60 seconds');
    expect(OFFER_COPY.financial.cta).toBe('Meet your adviser');
  });
});

describe('layout receipts', () => {
  const now = 1_700_000_000_000;
  const r = composeLayout(view(PREMIUM_DECIDING, { locked: ['takeover'] }));
  const input = { visitorId: 'mrd-test', vertical: 'retail' as const, sections: r.sections, now, demoRunId: 'run-1' };

  it('writes one row per section that fits MRD_DECISION_COLUMNS exactly, as slot_id layout:<section>', () => {
    const rows = rowsForLayout(input);
    expect(rows.length).toBe(r.sections.length);
    const col = (name: (typeof MRD_DECISION_COLUMNS)[number]) => MRD_DECISION_COLUMNS.indexOf(name);
    for (const row of rows) expect(row.length).toBe(MRD_DECISION_COLUMNS.length);

    const offer = rows.find((row) => row[col('slot_id')] === 'layout:offer')!;
    expect(offer[col('rank_position')]).toBe(1);
    expect(offer[col('chosen_item')]).toBe('offer');
    expect(offer[col('strategy')]).toBe('stage');
    expect(offer[col('candidate_set')]).toBe(r.sections.length);
    expect(offer[col('rank_score')]).toBeCloseTo(0.695, 6);
    expect(offer[col('confidence')]).toBe(0.68);
    expect(offer[col('theta_out')]).toBe(0.45);
    expect(offer[col('config_version')]).toBe(cfg.version);
    expect(offer[col('demo_run_id')]).toBe('run-1');
    expect(JSON.parse(String(offer[col('dimension_scores')]))).toEqual({ 'priceBand.premium': 0.71, 'journeyStage.deciding': 0.68 });
    expect(offer[col('decision_id')]).toBe(`mrd-test:${now}:layout:offer:1`);

    const takeover = rows.find((row) => row[col('slot_id')] === 'layout:takeover')!;
    expect(takeover[col('rank_position')]).toBe(0);
    expect(JSON.parse(String(takeover[col('gates_failed')]))).toEqual(['locked']);
  });

  it('captureLayout batches them into mrd_decisions', async () => {
    const bound: Array<{ sql: string; args: unknown[] }> = [];
    const batches: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({ bind: (...args: unknown[]) => { const s = { sql, args }; bound.push(s); return s; } }),
      batch: async (stmts: unknown[]) => { batches.push(stmts); return []; },
    } as unknown as D1Database;

    const n = await captureLayout(db, input);
    expect(n).toBe(r.sections.length);
    expect(batches.length).toBe(1);
    expect(batches[0]!.length).toBe(n);
    expect(bound[0]!.sql).toMatch(/INSERT OR REPLACE INTO mrd_decisions/);
    expect(bound[0]!.args.length).toBe(MRD_DECISION_COLUMNS.length);
  });
});
