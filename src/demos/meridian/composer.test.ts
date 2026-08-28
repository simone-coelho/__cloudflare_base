// src/demos/meridian/composer.test.ts
//
// THE ROW READS AS A BLOCK — and AUDIENCE PRIORITY IS A MERCHANDISER CONTROL.
//
// The customer's screenshot had promoted cards at positions 1–4 and 8–9 with
// untouched cards between them, because the row re-scored every item and let
// the arithmetic scatter the result. The rule under test is the Tapestry
// documents' own — memberships gate, scores rank: an item is PROMOTED only
// when it belongs to an audience the visitor has actually entered; everything
// else holds the catalogue's own order, identical for every visitor.
//
// Synthetic items throughout. The catalogue is being rebuilt in parallel, so
// nothing here reads catalog.retail.json — the fixtures ARE the catalogue, and
// their construction order IS the standard order the assertions lean on.

import { describe, it, expect } from 'vitest';
import { configFor, SHAPE_OF_KEY } from './reflexConfig';
import { compose, type ComposeInput, type AffinityView } from './composer';
import type { MeridianDecision, MeridianItem } from './types';

const cfg = configFor('retail');

// ── synthetic catalogue ──────────────────────────────────────────────────────
// Construction order is standard order. Bands per the retail cuts [75, 250]:
// <75 entry, <250 core, ≥250 premium. F01/F02 exist to be pinned into the hero
// and rail so neither consumes a shelf item while the row is under the glass.

const item = (
  id: string,
  category: string,
  over: Partial<MeridianItem> & Record<string, unknown> = {},
): MeridianItem => ({
  id,
  vertical: 'retail',
  name: id,
  category: category as MeridianItem['category'],
  subcategory: 'synthetic',
  value_usd: 120,
  world: 'heritage' as MeridianItem['world'],
  needs: ['everyday'] as MeridianItem['needs'],
  blurb: '',
  ...over,
} as MeridianItem);

const ITEMS: readonly MeridianItem[] = [
  item('S01', 'Tools', { world: 'technical' }),
  item('S02', 'Bags', { line: 'Drover' }),
  item('S03', 'Apparel', { value_usd: 400, world: 'modern' }),        // premium, non-Drover
  item('S04', 'Bags', { value_usd: 200, world: 'modern' }),
  item('S05', 'Tools', { value_usd: 60, world: 'technical' }),
  item('S06', 'Apparel', { line: 'Drover' }),
  item('S07', 'Home', { value_usd: 400, world: 'modern', needs: ['travel'] }), // premium, non-Drover
  item('S08', 'Bags', { value_usd: 90, world: 'playful' }),
  item('S09', 'Games', { value_usd: 45, world: 'playful' }),
  item('S10', 'Home', { value_usd: 30 }),
  item('F01', 'Games'),   // hero pin fodder
  item('F02', 'Home'),    // rail pin fodder
];

const BAGS = ['S02', 'S04', 'S08'];
const byId = (catalogue: readonly MeridianItem[], id?: string) => catalogue.find((i) => i.id === id);

const affinity = (dims: AffinityView['dims'], audiences: string[]): AffinityView => ({ dims, audiences });

const composeWith = (over: Partial<ComposeInput>, catalogue: readonly MeridianItem[] = ITEMS): MeridianDecision[] =>
  compose({
    affinity: affinity({}, []),
    items: catalogue,
    blocks: [],
    config: cfg,
    shapeOfKey: SHAPE_OF_KEY,
    rowSize: 20,
    pins: { hero: 'F01', rail: 'F02' },   // keep the shelf intact unless a test says otherwise
    ...over,
  });

const rowOf = (ds: MeridianDecision[]) => ds.filter((d) => d.slot === 'row');
const heroOf = (ds: MeridianDecision[]) => ds.find((d) => d.slot === 'hero')!;
const idsOf = (row: MeridianDecision[]) => row.map((d) => d.itemId!);

/** The green block is contiguous by construction: once 'standard' starts, no promotion follows. */
const expectContiguous = (row: MeridianDecision[]) => {
  const firstStandard = row.findIndex((d) => d.strategy === 'standard');
  if (firstStandard === -1) return;
  for (const d of row.slice(firstStandard)) expect(d.strategy).toBe('standard');
};

describe('the row reads as a block (promotion requires membership)', () => {
  it('puts every member of the entered audience before every non-member, non-members in catalogue order', () => {
    const ds = composeWith({
      affinity: affinity({ category: { Bags: 0.7 } }, ['category_bags_affinity']),
    });
    const row = rowOf(ds);
    const ids = idsOf(row);

    // Every bag before every non-bag.
    const lastBag = Math.max(...BAGS.map((b) => ids.indexOf(b)));
    const firstNonBag = ids.findIndex((id) => !BAGS.includes(id));
    expect(new Set(ids.slice(0, BAGS.length))).toEqual(new Set(BAGS));
    expect(lastBag).toBeLessThan(firstNonBag === -1 ? Infinity : firstNonBag);

    // Equal scores inside the block tie-break to standard order, not id arithmetic on shuffled ranks.
    expect(ids.slice(0, BAGS.length)).toEqual(BAGS);

    // Non-bags keep catalogue order exactly.
    expect(ids.slice(BAGS.length)).toEqual(['S01', 'S03', 'S05', 'S06', 'S07', 'S09', 'S10']);

    // Promoted carry 'affinity' and name the audience that earned it; the rest are 'standard'.
    for (const d of row.slice(0, BAGS.length)) {
      expect(d.strategy).toBe('affinity');
      expect(d.explain.matched).toContain('category_bags_affinity');
    }
    for (const d of row.slice(BAGS.length)) {
      expect(d.strategy).toBe('standard');
      expect(d.explain.matched).toBeUndefined();
    }
    expectContiguous(row);
  });

  it('keeps the standard tail identical for two visitors whose memberships differ', () => {
    // A is in bags only, with a live (sub-threshold) travel affinity that makes
    // tail item S07 outscore its neighbours. B is in bags AND games.
    const dsA = composeWith({
      affinity: affinity(
        { category: { Bags: 0.7 }, occasion: { travel: 0.55 } },
        ['category_bags_affinity'],
      ),
    });
    const dsB = composeWith({
      affinity: affinity(
        { category: { Bags: 0.65, Games: 0.7 } },
        ['category_bags_affinity', 'category_games_affinity'],
      ),
    });

    const tailA = rowOf(dsA).filter((d) => d.strategy === 'standard').map((d) => d.itemId!);
    const tailB = rowOf(dsB).filter((d) => d.strategy === 'standard').map((d) => d.itemId!);

    // Each tail is the catalogue's own order — and A's score on S07 moved nothing:
    // S03 (score 0 for A) still precedes S07 (A's strongest tail item).
    expect(tailA).toEqual(['S01', 'S03', 'S05', 'S06', 'S07', 'S09', 'S10']);
    expect(tailA.indexOf('S03')).toBeLessThan(tailA.indexOf('S07'));

    // B promotes S09 out of the shelf; what remains is A's tail with S09 removed,
    // relative order untouched. The shelf is the shelf every visitor sees.
    expect(tailB).toEqual(tailA.filter((id) => id !== 'S09'));
  });

  it('renders exactly the catalogue order, all standard, when no audience is entered', () => {
    // Live sub-threshold affinity, but no membership: scores exist, promotion may not.
    const ds = composeWith({
      affinity: affinity({ category: { Bags: 0.5 } }, []),
    });
    const row = rowOf(ds);
    expect(idsOf(row)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10']);
    for (const d of row) {
      expect(d.strategy).toBe('standard');
      expect(d.explain.matched).toBeUndefined();
    }
  });

  it('still excludes the anchor category and still promotes in completion mode', () => {
    const anchor = 'S03'; // Apparel, premium, modern, needs: everyday
    const ds = composeWith({
      affinity: affinity(
        { category: { Bags: 0.7 }, journeyStage: { deciding: 0.68 } },
        ['category_bags_affinity', 'journeystage_deciding_affinity'],
      ),
      anchorId: anchor,
      decidingValue: 'deciding',
    });
    const row = rowOf(ds);
    const ids = idsOf(row);

    // The anchor's category is out entirely — nothing substitutable.
    expect(ids).not.toContain('S03');
    expect(ids).not.toContain('S06');

    // Membership still gates: the bags lead as one block, strategy 'completion',
    // each carrying the anchor and the audience that earned the promotion.
    // Coherence ranks INSIDE the block: S04 shares the anchor's world and need
    // (+0.75) so it outranks S02/S08 (+0.30 each, tie → standard order).
    expect(ids.slice(0, 3)).toEqual(['S04', 'S02', 'S08']);
    for (const d of row.slice(0, 3)) {
      expect(d.strategy).toBe('completion');
      expect(d.anchorId).toBe(anchor);
      expect(d.explain.matched).toEqual(['category_bags_affinity']);
    }

    // The shelf under it: catalogue order, standard, unanchored.
    expect(ids.slice(3)).toEqual(['S01', 'S05', 'S07', 'S09', 'S10']);
    for (const d of row.slice(3)) {
      expect(d.strategy).toBe('standard');
      expect(d.anchorId).toBeUndefined();
    }
    expectContiguous(row);
  });

  it('keeps the refused-candidates receipt: scored first, gated second, score preserved', () => {
    const catalogue = [
      ...ITEMS,
      item('E01', 'Bags', { embargoed: true }),
      item('U01', 'Bags', { available: false }),
    ];
    const ds = composeWith(
      { affinity: affinity({ category: { Bags: 0.7 } }, ['category_bags_affinity']), pins: undefined },
      catalogue,
    );

    const refused = heroOf(ds).explain.refused ?? [];
    const embargoed = refused.find((r) => r.id === 'E01');
    const unavailable = refused.find((r) => r.id === 'U01');
    expect(embargoed?.gate).toBe('embargoed');
    expect(unavailable?.gate).toBe('unavailable');
    // The score BEFORE the gate — kept so the room can hear "it would have won".
    expect(embargoed!.score).toBeGreaterThan(0);
    expect(unavailable!.score).toBeGreaterThan(0);

    // And the gate held: neither reaches the shelf.
    const ids = idsOf(rowOf(ds));
    expect(ids).not.toContain('E01');
    expect(ids).not.toContain('U01');
  });

  it('never lets a stage audience promote an item — journey stage is page structure, not merchandise', () => {
    // X01 even carries the verb field on the record, so extractTouches WOULD map
    // it to journeystage_deciding_affinity if stage were not excluded.
    const catalogue = [
      ...ITEMS.slice(0, 5),
      { ...item('X01', 'Home'), __verb__: 'deciding' } as MeridianItem,
      ...ITEMS.slice(5),
    ];
    const ds = composeWith(
      { affinity: affinity({ journeyStage: { deciding: 0.68 } }, ['journeystage_deciding_affinity']) },
      catalogue,
    );
    const row = rowOf(ds);
    expect(idsOf(row)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'X01', 'S06', 'S07', 'S08', 'S09', 'S10']);
    for (const d of row) {
      expect(d.strategy).toBe('standard');
      expect(d.explain.matched).toBeUndefined();
    }
  });
});

describe('audience priority is a merchandiser control (hero)', () => {
  // In two audiences at once: Drover (core-band items) and premium (non-Drover
  // items) — the contest audiencePriority exists to decide.
  const contested = affinity(
    { line: { Drover: 0.7 }, priceBand: { premium: 0.65 } },
    ['line_drover_affinity', 'priceband_premium_affinity'],
  );
  const heroWith = (over: Partial<ComposeInput>) => heroOf(composeWith({ affinity: contested, pins: undefined, ...over }));

  it('gives the hero to the highest-priority entered audience — the line when the line is listed first', () => {
    const hero = heroWith({ audiencePriority: ['line_drover_affinity', 'priceband_premium_affinity'] });
    expect(byId(ITEMS, hero.itemId)?.line).toBe('Drover');
    expect(hero.explain.wonBy).toEqual({
      audience: 'line_drover_affinity',
      priority: 0,
      over: ['priceband_premium_affinity'],
    });
  });

  it('flips to a premium non-Drover hero when the band is listed first', () => {
    const hero = heroWith({ audiencePriority: ['priceband_premium_affinity', 'line_drover_affinity'] });
    const it_ = byId(ITEMS, hero.itemId)!;
    expect(it_.value_usd).toBeGreaterThanOrEqual(250);
    expect(it_.line).not.toBe('Drover');
    expect(hero.explain.wonBy).toEqual({
      audience: 'priceband_premium_affinity',
      priority: 0,
      over: ['line_drover_affinity'],
    });
  });

  it('skips a listed, entered audience no eligible candidate matches, and says so in the receipt', () => {
    const hero = heroWith({
      affinity: affinity(
        { line: { Drover: 0.7 }, priceBand: { premium: 0.65 }, occasion: { hosting: 0.7 } },
        ['occasion_hosting_affinity', 'line_drover_affinity', 'priceband_premium_affinity'],
      ),
      audiencePriority: ['occasion_hosting_affinity', 'line_drover_affinity', 'priceband_premium_affinity'],
    });
    // Nothing in the catalogue hosts; the line wins at its listed position.
    expect(byId(ITEMS, hero.itemId)?.line).toBe('Drover');
    expect(hero.explain.wonBy).toEqual({
      audience: 'line_drover_affinity',
      priority: 1,
      over: ['occasion_hosting_affinity', 'priceband_premium_affinity'],
    });
  });

  it('changes nothing without a list, or with only one listed audience entered', () => {
    const unlisted = heroWith({});
    expect(unlisted.explain.wonBy).toBeUndefined();
    const unlistedId = unlisted.itemId;

    // Games is listed but not entered: one entered listed audience → no contest.
    const single = heroWith({ audiencePriority: ['line_drover_affinity', 'category_games_affinity'] });
    expect(single.explain.wonBy).toBeUndefined();
    expect(single.itemId).toBe(unlistedId);
  });
});

// ── The cold start: the neighbourhood cohort opens the first line ─────────────
describe('cold start — the cohort opens the first line', () => {
  it('with no audiences of her own, the cold picks are the first line, in order, as cohort strategy', () => {
    const picks = ITEMS.slice(3, 6).map((i) => i.id);
    const row = rowOf(composeWith({ affinity: affinity({}, []), coldPicks: picks }));
    expect(idsOf(row).slice(0, 3)).toEqual(picks);
    expect(row.slice(0, 3).every((d) => d.strategy === 'cohort')).toBe(true);
    expect(row.slice(3).every((d) => d.strategy === 'standard')).toBe(true);
    expectContiguous(row);
  });
  it('the moment she has an audience of her own, the cohort hands off', () => {
    const picks = ITEMS.slice(3, 6).map((i) => i.id);
    const key = `category_${String(ITEMS[0].category).toLowerCase()}_affinity`;
    const row = rowOf(composeWith({
      affinity: affinity({ category: { [ITEMS[0].category]: 0.7 } }, [key]), coldPicks: picks,
    }));
    expect(row.some((d) => d.strategy === 'cohort')).toBe(false);
  });
  it('cold picks never touch the hero, rail or blocks', () => {
    const picks = ITEMS.slice(3, 6).map((i) => i.id);
    const a = composeWith({ affinity: affinity({}, []) });
    const b = composeWith({ affinity: affinity({}, []), coldPicks: picks });
    expect(heroOf(b).itemId).toBe(heroOf(a).itemId);
    expect(b.filter((d) => d.slot === 'block_a').map((d) => d.blockId)).toEqual(a.filter((d) => d.slot === 'block_a').map((d) => d.blockId));
  });
});

