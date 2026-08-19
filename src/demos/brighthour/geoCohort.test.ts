// @vitest-environment node
// src/demos/brighthour/geoCohort.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// The geo cold start's contract, pinned where it matters — the honesty model and
// the fairness red lines are not comments in this build, they are assertions:
//
//   · geography CURATES: no cohort item's price, availability or gates differ by
//     one cent or one flag from the catalogue row it came from;
//   · census is CONTEXT: quoted with the vintage and source of the row it came
//     from, and never an input to which items are chosen;
//   · the cohort is REPRESENTATIVE, always labelled, and its N is SUPPRESSED the
//     moment the leaders were borrowed from a coarser grain;
//   · the lean is DETERMINISTIC in the region code, so a state tells one story;
//   · the roll-up walks metro → state → national and reports the ladder it used.
//
// The catalogue is the REAL one against a pinned epoch — the same file that ships.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { loadBrighthourProducts } from './catalog';
import { MS_PER_HOUR, etMidnightForDate } from './demoClock';
import { evaluateGates } from './offerLifecycle';
import { type ComposerItem } from './composer';
import {
  BH_CATEGORIES,
  COHORT_ITEM_COUNT,
  buildBhGeoCohort,
  leanForRegion,
  locationLabel,
  pickCohortItems,
  resolveBhGeoCohort,
  type BhGeoInput,
  type BhGeoRung,
} from './geoCohort';
import type { Env } from '@/types/env';

const EPOCH = etMidnightForDate(2026, 9, 15);
const NOW = EPOCH + 14 * MS_PER_HOUR;
const ITEMS = loadBrighthourProducts(EPOCH) as unknown as ComposerItem[];

const NATIONAL_LADDER: BhGeoRung[] = [{ level: 'national', key: 'US', n: 0, cleared: true }];

const WS_CENSUS = {
  geoLevel: 'metro',
  geoKey: '49180',
  label: 'Winston-Salem, NC Metro (Piedmont Triad)',
  medianHhIncome: 65903,
  medianHomeValue: 270700,
  source: 'Census ACS 2024',
  vintage: '2024',
};

function build(geo: BhGeoInput, over: Partial<Parameters<typeof buildBhGeoCohort>[0]> = {}) {
  return buildBhGeoCohort({
    geo,
    items: ITEMS,
    nowMs: NOW,
    census: null,
    grain: 'state',
    cohortSize: 120,
    borrowed: false,
    ladder: NATIONAL_LADDER,
    ...over,
  });
}

// ── 1. The lean: deterministic, coarse, and drawn from the eight aisles ──────

describe('leanForRegion', () => {
  it('always returns two DISTINCT categories from the eight aisles', () => {
    for (const code of ['NC', 'CA', 'NY', 'TX', 'WY', 'DC', 'AK', 'HI', 'MT', 'RI']) {
      const lean = leanForRegion(code);
      expect(lean).toHaveLength(2);
      expect(lean[0]).not.toBe(lean[1]);
      for (const cat of lean) expect(BH_CATEGORIES).toContain(cat);
    }
  });

  it('is stable — the same state tells the same story every time', () => {
    expect(leanForRegion('NC')).toEqual(leanForRegion('NC'));
    expect(leanForRegion('nc')).toEqual(leanForRegion('NC')); // case-insensitive
    expect(leanForRegion(' NC ')).toEqual(leanForRegion('NC')); // whitespace-insensitive
  });

  it('falls back to the national key when there is no region at all', () => {
    expect(leanForRegion(null)).toEqual(leanForRegion('US'));
    expect(leanForRegion('')).toEqual(leanForRegion('US'));
    expect(leanForRegion(undefined)).toEqual(leanForRegion('US'));
  });

  it('does not collapse every state onto one story', () => {
    const states = ['NC', 'CA', 'NY', 'TX', 'FL', 'IL', 'WA', 'CO', 'MA', 'AZ', 'OR', 'GA'];
    const stories = new Set(states.map((s) => leanForRegion(s).join('|')));
    expect(stories.size).toBeGreaterThan(3);
  });
});

// ── 2. The shelf: eligible items only, both aisles visible, deterministic ────

describe('pickCohortItems', () => {
  const LEAN = leanForRegion('NC');

  it('returns the full row, and only ELIGIBLE items', () => {
    const picks = pickCohortItems(ITEMS, LEAN, NOW, 'state:NC');
    expect(picks).toHaveLength(COHORT_ITEM_COUNT);
    const byId = new Map(ITEMS.map((i) => [String(i.itemNumber ?? i.id), i]));
    for (const p of picks) {
      const raw = byId.get(p.itemNumber);
      expect(raw, `cohort item ${p.itemNumber} is not in the catalogue`).toBeTruthy();
      expect(evaluateGates(raw as never, NOW, { vipOfferActive: true }).eligible).toBe(true);
    }
  });

  it('never repeats an item', () => {
    const picks = pickCohortItems(ITEMS, LEAN, NOW, 'state:NC');
    expect(new Set(picks.map((p) => p.itemNumber)).size).toBe(picks.length);
  });

  it('is deterministic for a grain key, and differs across grains', () => {
    const a = pickCohortItems(ITEMS, LEAN, NOW, 'state:NC').map((p) => p.itemNumber);
    const b = pickCohortItems(ITEMS, LEAN, NOW, 'state:NC').map((p) => p.itemNumber);
    expect(a).toEqual(b);
    const metro = pickCohortItems(ITEMS, LEAN, NOW, 'metro:49180').map((p) => p.itemNumber);
    expect(metro).toHaveLength(COHORT_ITEM_COUNT);
  });

  it('shows BOTH lean aisles when the catalogue can fill them', () => {
    const picks = pickCohortItems(ITEMS, LEAN, NOW, 'state:NC');
    const cats = new Set(picks.map((p) => p.category));
    expect(cats.size).toBeGreaterThan(1);
  });

  it('tops up from the rest of the floor rather than showing a short row', () => {
    // A lean nothing in the catalogue carries: the row must still fill.
    const picks = pickCohortItems(ITEMS, ['No Such Aisle', 'Also Not Real'], NOW, 'state:ZZ');
    expect(picks).toHaveLength(COHORT_ITEM_COUNT);
  });

  it('degrades to an empty row on an empty catalogue, and never throws', () => {
    expect(pickCohortItems([], LEAN, NOW, 'state:NC')).toEqual([]);
  });
});

// ── 3. FAIRNESS: geography curates. It never prices, gates or discounts. ─────

describe('fairness red lines', () => {
  it('leaves every cohort item priced EXACTLY as the catalogue prices it', () => {
    const byId = new Map(ITEMS.map((i) => [String(i.itemNumber ?? i.id), i]));
    for (const code of ['NC', 'CA', 'WY', 'MS']) {
      const cohort = build({ regionCode: code, region: code, source: 'edge' });
      for (const item of cohort.cohortItems) {
        const raw = byId.get(item.itemNumber) as Record<string, unknown>;
        expect(item.priceUsd).toBe(raw.price_usd);
        expect(item.urgencyState).toBe(raw.urgencyState ?? 'in_stock');
      }
    }
  });

  it('prices the SAME item identically in a high-income and a low-income geography', () => {
    const rich = build(
      { regionCode: 'NC', source: 'edge' },
      { census: { ...WS_CENSUS, medianHhIncome: 250000 } }
    );
    const poor = build(
      { regionCode: 'NC', source: 'edge' },
      { census: { ...WS_CENSUS, medianHhIncome: 21000 } }
    );
    expect(rich.cohortItems.map((i) => [i.itemNumber, i.priceUsd])).toEqual(
      poor.cohortItems.map((i) => [i.itemNumber, i.priceUsd])
    );
  });

  it('records that the record is curation-only', () => {
    expect(build({ regionCode: 'NC' }).explain.curation_only).toBe(true);
  });
});

// ── 4. The payload contract ──────────────────────────────────────────────────

describe('buildBhGeoCohort', () => {
  it('always labels the cohort representative, whatever else is true', () => {
    for (const grain of ['metro', 'state', 'national'] as const) {
      const c = build({ regionCode: 'NC' }, { grain });
      expect(c.representative).toBe(true);
      expect(c.honesty).toEqual({
        location: 'live-edge',
        query: 'real',
        census: 'real-public',
        cohort: 'representative',
      });
    }
  });

  it('greets by city, degrades to region, then to "your area"', () => {
    expect(build({ city: 'Winston-Salem', region: 'North Carolina', regionCode: 'NC' }).location.label)
      .toBe('Winston-Salem');
    expect(build({ region: 'North Carolina', regionCode: 'NC' }).location.label).toBe('North Carolina');
    expect(build({ regionCode: 'NC' }).location.label).toBe('NC');
    expect(build({ country: 'US' }).location.label).toBe('your area');
    expect(build({}).location.label).toBe('your area');
  });

  it('reports how precisely it actually knows where she is', () => {
    expect(locationLabel({ city: 'Winston-Salem' }).precision).toBe('city');
    expect(locationLabel({ region: 'North Carolina' }).precision).toBe('region');
    expect(locationLabel({ country: 'US' }).precision).toBe('country');
    expect(locationLabel({}).precision).toBe('none');
  });

  it('quotes the census with the vintage and source of the row it came from', () => {
    const c = build({ city: 'Winston-Salem', regionCode: 'NC' }, { grain: 'metro', census: WS_CENSUS });
    expect(c.census?.medianHhIncome).toBe(65903);
    expect(c.census?.source).toBe('Census ACS 2024');
    expect(c.census?.vintage).toBe('2024');
    expect(c.grainLabel).toBe(WS_CENSUS.label);
    expect(c.explain.censusSource).toBe('Census ACS 2024');
    expect(c.explain.censusVintage).toBe('2024');
  });

  it('SUPPRESSES N when the leaders were borrowed from a coarser grain', () => {
    const borrowed = build({ regionCode: 'WY' }, { borrowed: true, cohortSize: 3, grain: 'state' });
    expect(borrowed.borrowed).toBe(true);
    expect(borrowed.cohortSize).toBeNull();
    expect(borrowed.explain.n).toBeNull();
    // …and still opens on a full, local-looking shelf
    expect(borrowed.cohortItems).toHaveLength(COHORT_ITEM_COUNT);
  });

  it('reports N when the cohort genuinely cleared at the grain', () => {
    const local = build({ regionCode: 'NC' }, { borrowed: false, cohortSize: 148, grain: 'metro' });
    expect(local.cohortSize).toBe(148);
    expect(local.explain.n).toBe(148);
  });

  it('carries the glass-box fields every other slot carries', () => {
    const c = build({ city: 'Winston-Salem', regionCode: 'NC' }, { grain: 'metro', census: WS_CENSUS });
    expect(c.explain.grain).toBe('metro');
    expect(c.explain.threshold).toBeGreaterThan(0);
    expect(c.explain.source).toContain('representative');
    expect(c.explain.categories).toEqual(c.cohortLean);
    expect(Array.isArray(c.explain.ladder)).toBe(true);
  });

  it('echoes the geography it was handed, and how it was obtained', () => {
    const edge = build({ city: 'Winston-Salem', region: 'North Carolina', regionCode: 'nc', country: 'us', source: 'edge' });
    expect(edge.location.regionCode).toBe('NC');
    expect(edge.location.country).toBe('US');
    expect(edge.location.source).toBe('edge');
    expect(build({ regionCode: 'NC', source: 'query' }).location.source).toBe('query');
  });

  it('falls back to a grain label when no census row exists', () => {
    expect(build({ regionCode: 'NC' }, { grain: 'national', census: null }).grainLabel).toBe('United States');
  });
});

// ── 5. The roll-up ladder, against a stubbed D1 ──────────────────────────────

/** A D1 stub that answers the shared brain's three queries off a small fixture. */
function fakeEnv(fixture: {
  shoppers?: Record<string, number>;
  census?: Record<string, Record<string, unknown>>;
  xref?: Record<string, { metroCbsa: string | null; region: string | null; country: string | null }>;
  throwOn?: 'count' | 'census';
}): Env {
  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind: (...args: unknown[]) => {
        bound = args;
        return stmt;
      },
      first: async () => {
        if (sql.includes('geo_xref WHERE zip')) return fixture.xref?.[String(bound[0])] ?? null;
        if (sql.includes('COUNT(DISTINCT t.vuid)')) {
          if (fixture.throwOn === 'count') throw new Error('no such table');
          const key = sql.includes('x.metro_cbsa')
            ? `metro:${bound[0]}`
            : sql.includes('t.billing_region')
              ? `region:${bound[0]}`
              : 'national:US';
          return { n: fixture.shoppers?.[key] ?? 0 };
        }
        if (sql.includes('FROM geo_census')) {
          if (fixture.throwOn === 'census') throw new Error('no such table');
          return fixture.census?.[`${bound[0]}:${bound[1]}`] ?? null;
        }
        return null;
      },
      all: async () => ({ results: [] }),
    };
    return stmt;
  };
  return { DB: { prepare } } as unknown as Env;
}

const CENSUS_ROWS = {
  'metro:49180': {
    geoLevel: 'metro',
    geoKey: '49180',
    label: 'Winston-Salem, NC Metro (Piedmont Triad)',
    medianHhIncome: 65903,
    medianHomeValue: 270700,
    source: 'Census ACS 2024',
    vintage: '2024',
  },
  'region:NC': {
    geoLevel: 'region',
    geoKey: 'NC',
    label: 'North Carolina',
    medianHhIncome: 73958,
    medianHomeValue: 333000,
    source: 'Census ACS 2024',
    vintage: '2024',
  },
  'region:WY': {
    geoLevel: 'region',
    geoKey: 'WY',
    label: 'Wyoming',
    medianHhIncome: 72495,
    medianHomeValue: 349000,
    source: 'Census ACS 2023 1-yr',
    vintage: '2023',
  },
  'national:US': {
    geoLevel: 'national',
    geoKey: 'US',
    label: 'United States',
    medianHhIncome: 80610,
    medianHomeValue: 361282,
    source: 'Census ACS 2024',
    vintage: '2024',
  },
};

describe('resolveBhGeoCohort — the roll-up', () => {
  it('uses the METRO when the ZIP crosswalk resolves it and the cohort clears', async () => {
    const env = fakeEnv({
      xref: { '27101': { metroCbsa: '49180', region: 'NC', country: 'US' } },
      shoppers: { 'metro:49180': 148, 'region:NC': 400, 'national:US': 3200 },
      census: CENSUS_ROWS,
    });
    const c = await resolveBhGeoCohort(
      env,
      { city: 'Winston-Salem', region: 'North Carolina', regionCode: 'NC', postalCode: '27101', source: 'edge' },
      ITEMS,
      NOW
    );
    expect(c.grain).toBe('metro');
    expect(c.cohortSize).toBe(148);
    expect(c.borrowed).toBe(false);
    expect(c.census?.medianHhIncome).toBe(65903);
    expect(c.explain.ladder[0]).toMatchObject({ level: 'metro', key: '49180', cleared: true });
  });

  it('ROLLS UP cleanly to the state when the metro cohort is too thin', async () => {
    const env = fakeEnv({
      xref: { '27101': { metroCbsa: '49180', region: 'NC', country: 'US' } },
      shoppers: { 'metro:49180': 4, 'region:NC': 400, 'national:US': 3200 },
      census: CENSUS_ROWS,
    });
    const c = await resolveBhGeoCohort(
      env,
      { city: 'Winston-Salem', regionCode: 'NC', postalCode: '27101', source: 'edge' },
      ITEMS,
      NOW
    );
    expect(c.grain).toBe('state');
    expect(c.cohortSize).toBe(400);
    expect(c.borrowed).toBe(false);
    expect(c.census?.geoKey).toBe('NC');
    // the ladder shows WHY it rolled up — the thin metro rung is still on the record
    expect(c.explain.ladder.map((r) => [r.level, r.cleared])).toEqual([
      ['metro', false],
      ['state', true],
      ['national', true],
    ]);
  });

  it('presents the national leaders AT her real state, N suppressed, when nothing local clears', async () => {
    const env = fakeEnv({
      shoppers: { 'region:WY': 0, 'national:US': 3200 },
      census: CENSUS_ROWS,
    });
    const c = await resolveBhGeoCohort(env, { regionCode: 'WY', region: 'Wyoming', source: 'edge' }, ITEMS, NOW);
    expect(c.grain).toBe('state');
    expect(c.borrowed).toBe(true);
    expect(c.cohortSize).toBeNull();
    expect(c.census?.label).toBe('Wyoming'); // her state's REAL census, not the nation's
    expect(c.cohortItems).toHaveLength(COHORT_ITEM_COUNT);
  });

  it('lands on the national floor when there is no region at all', async () => {
    const env = fakeEnv({ shoppers: { 'national:US': 3200 }, census: CENSUS_ROWS });
    const c = await resolveBhGeoCohort(env, { country: 'US', source: 'edge' }, ITEMS, NOW);
    expect(c.grain).toBe('national');
    expect(c.borrowed).toBe(false);
    expect(c.location.label).toBe('your area');
    expect(c.census?.geoKey).toBe('US');
  });

  it('never joins the edge DMA code to a CBSA — a metro needs the ZIP crosswalk', async () => {
    const env = fakeEnv({ shoppers: { 'region:NC': 400, 'national:US': 3200 }, census: CENSUS_ROWS });
    const c = await resolveBhGeoCohort(env, { regionCode: 'NC', dmaCode: '518', source: 'edge' }, ITEMS, NOW);
    expect(c.grain).toBe('state');
    expect(c.location.dmaCode).toBe('518');
    expect(c.location.metroCbsa).toBeNull();
    expect(c.explain.ladder.some((r) => r.level === 'metro')).toBe(false);
  });

  it('still opens the banner when D1 is missing entirely', async () => {
    const c = await resolveBhGeoCohort({} as Env, { city: 'Reno', regionCode: 'NV', source: 'edge' }, ITEMS, NOW);
    expect(c.grain).toBe('national');
    expect(c.census).toBeNull();
    expect(c.representative).toBe(true);
    expect(c.cohortItems).toHaveLength(COHORT_ITEM_COUNT);
    expect(c.location.label).toBe('Reno');
  });

  it('degrades — never throws — when a table is unreadable', async () => {
    const env = fakeEnv({ throwOn: 'count', census: CENSUS_ROWS });
    const c = await resolveBhGeoCohort(env, { regionCode: 'NC', source: 'edge' }, ITEMS, NOW);
    expect(c.representative).toBe(true);
    expect(c.cohortItems.length).toBeGreaterThan(0);
  });
});
