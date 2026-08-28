// src/demos/meridian/geoCohort.test.ts
//
// The geo-cohort cold start, pinned. Four things must never regress, because
// each is a claim the presenter makes out loud:
//   1. The ladder is gated on OUR first-party shopper count and nothing else —
//      a ZIP with 22 shoppers rolls up to a metro with 320, and the grain used
//      is in the payload.
//   2. The representative fallback presents the national leaders AT the
//      visitor's real region with that region's REAL census, says so
//      (synthesized: true), and suppresses the borrowed N.
//   3. The payload shape is exactly the contract the client was written against.
//   4. Nothing here throws — an unbound D1, a missing table, a warehouse seam
//      that is not wired: every one degrades to a valid national/empty payload.
// No server, no network, no D1: the sources are faked at the interface.

import { describe, it, expect } from 'vitest';
import {
  computeGeoCohort, resolveGeoRollup, MIN_COHORT_SHOPPERS, MeridianD1Source, WarehouseSource,
  getGeoCohortSource, bandOf, modalBandOf, grainLabelFor, EMPTY_AGGREGATE,
  type GeoCohortSource, type CensusFacts, type CohortAggregate, type ResolvedGrain, type GeoInput,
} from './geoCohort';

// ───────────────────────── fakes ─────────────────────────

const CENSUS: Record<string, CensusFacts> = {
  'metro:35620': { level: 'metro', key: '35620', label: 'New York-Newark-Jersey City, NY-NJ Metro', medianHhIncome: 99852, medianHomeValue: 648800, source: 'Census ACS 2024 1-yr', vintage: '2024' },
  'metro:49180': { level: 'metro', key: '49180', label: 'Winston-Salem, NC Metro (Piedmont Triad)', medianHhIncome: 65903, medianHomeValue: 270700, source: 'Census ACS 2024 1-yr', vintage: '2024' },
  'region:NY': { level: 'region', key: 'NY', label: 'New York', medianHhIncome: 85820, medianHomeValue: 449800, source: 'Census ACS 2024 1-yr', vintage: '2024' },
  'region:NC': { level: 'region', key: 'NC', label: 'North Carolina', medianHhIncome: 73958, medianHomeValue: 333000, source: 'Census ACS 2024 1-yr', vintage: '2024' },
  'region:CA': { level: 'region', key: 'CA', label: 'California', medianHhIncome: 100149, medianHomeValue: 759500, source: 'Census ACS 2024 1-yr', vintage: '2024' },
  'national:US': { level: 'national', key: 'US', label: 'United States', medianHhIncome: 81604, medianHomeValue: 360600, source: 'Census ACS 2024 1-yr', vintage: '2024' },
};

const XREF: Record<string, { metroCbsa: string; region: string; country: string }> = {
  '10014': { metroCbsa: '35620', region: 'NY', country: 'US' },
  '27101': { metroCbsa: '49180', region: 'NC', country: 'US' },
};

/** Distinct shoppers per grain, as the seed lays them out. */
const COUNTS: Record<string, number> = {
  'zip:10014': 23, 'metro:35620': 320, 'region:NY': 320,
  'zip:27101': 23, 'metro:49180': 320, 'region:NC': 320,
  'national:US': 640,
};

const AGG_BY_GRAIN: Record<string, Partial<CohortAggregate>> = {
  'metro:35620': { topLines: [{ line: 'Drover', share: 0.35, count: 112 }, { line: 'Linden', share: 0.25, count: 80 }], modalBand: 'premium', aov: 373, attachRate: 0.45 },
  'metro:49180': { topLines: [{ line: 'Shorewell', share: 0.35, count: 112 }, { line: 'Fenwick', share: 0.3, count: 96 }], modalBand: 'core', aov: 275, attachRate: 0.4 },
  'national:US': { topLines: [{ line: 'Shorewell', share: 0.23, count: 148 }, { line: 'Fenwick', share: 0.22, count: 144 }], modalBand: 'core', aov: 324, attachRate: 0.42 },
};

interface FakeOpts {
  counts?: Record<string, number>;
  census?: Record<string, CensusFacts>;
  xref?: Record<string, { metroCbsa: string; region: string; country: string }>;
  agg?: Record<string, Partial<CohortAggregate>>;
}

function fakeSource(opts: FakeOpts = {}): GeoCohortSource & { calls: string[] } {
  const counts = opts.counts ?? COUNTS;
  const census = opts.census ?? CENSUS;
  const xref = opts.xref ?? XREF;
  const agg = opts.agg ?? AGG_BY_GRAIN;
  const calls: string[] = [];
  const k = (g: ResolvedGrain) => `${g.level}:${g.key}`;
  return {
    kind: 'synthetic',
    calls,
    async resolveXref(zip) { calls.push(`xref:${zip}`); return xref[zip] ?? null; },
    async countShoppers(g) { calls.push(`count:${k(g)}`); return counts[k(g)] ?? 0; },
    async aggregate(g) { calls.push(`agg:${k(g)}`); return { ...EMPTY_AGGREGATE, ...(agg[k(g)] ?? {}) }; },
    async census(g) { calls.push(`census:${k(g)}`); return census[k(g)] ?? null; },
  };
}

function throwingSource(kind: 'synthetic' | 'warehouse' = 'synthetic'): GeoCohortSource {
  const boom = async () => { throw new Error('down'); };
  return { kind, resolveXref: boom, countShoppers: boom, aggregate: boom, census: boom };
}

/**
 * A scripted D1: routes each prepared statement to rows by matching its SQL.
 * `first` returns the first row; `all` returns them all. A handler may throw,
 * which is how the never-throws guarantee is exercised.
 */
function fakeDb(route: (sql: string, binds: unknown[]) => unknown[]): D1Database {
  const stmt = (sql: string, binds: unknown[]) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    first: async () => route(sql, binds)[0] ?? null,
    all: async () => ({ results: route(sql, binds), success: true, meta: {} }),
    run: async () => ({ success: true, meta: {} }),
    raw: async () => [],
  });
  return { prepare: (sql: string) => stmt(sql, []) } as unknown as D1Database;
}

const NYC: GeoInput = { zip: '10014', city: 'New York', region: 'NY', country: 'US', source: 'query' };
const WS: GeoInput = { zip: '27101', city: 'Winston-Salem', region: 'NC', country: 'US', source: 'query' };

const CONTRACT_KEYS = [
  'ok', 'vertical', 'geo', 'granularityUsed', 'presentLevel', 'grainLabel', 'synthesized', 'sampleSize',
  'topLines', 'topFamilies', 'modalBand', 'attachRate', 'aov', 'browseToBuy', 'census', 'honesty',
  'dataSource', 'ladder', 'ms',
].sort();

// ───────────────────────── the ladder ─────────────────────────

describe('resolveGeoRollup — gated on first-party N, never on census', () => {
  it('walks ZIP → metro and stops at the first grain that clears', async () => {
    const src = fakeSource();
    const r = await resolveGeoRollup(NYC, src, 'retail');
    expect(r.granularityUsed).toBe('metro');
    expect(r.key).toBe('35620');
    expect(r.sampleSize).toBe(320);
    expect(r.ladder.map((x) => [x.level, x.cleared])).toEqual([
      ['zip', false], ['metro', true], ['region', true], ['national', true],
    ]);
    expect(r.ladder[0]).toMatchObject({ level: 'zip', key: '10014', sampleSize: 23 });
  });

  it('clears at exactly the threshold and not one below', async () => {
    const at = await resolveGeoRollup(NYC, fakeSource({ counts: { 'zip:10014': MIN_COHORT_SHOPPERS } }), 'retail');
    expect(at.granularityUsed).toBe('zip');
    const below = await resolveGeoRollup(NYC, fakeSource({ counts: { 'zip:10014': MIN_COHORT_SHOPPERS - 1 } }), 'retail');
    expect(below.granularityUsed).toBe('national');
  });

  it('the census never gates: a metro with rich census and 5 shoppers still rolls up', async () => {
    const r = await resolveGeoRollup(NYC, fakeSource({ counts: { 'zip:10014': 3, 'metro:35620': 5, 'region:NY': 320 } }), 'retail');
    expect(r.granularityUsed).toBe('region');
  });

  it('takes the region from the crosswalk when the request carries only a ZIP', async () => {
    const r = await resolveGeoRollup({ zip: '27101' }, fakeSource(), 'retail');
    expect(r.region).toBe('NC');
    expect(r.metroCbsa).toBe('49180');
    expect(r.granularityUsed).toBe('metro');
  });

  it('never walks a non-US region code as a US state', async () => {
    const r = await resolveGeoRollup({ region: 'NY', country: 'GB' }, fakeSource(), 'retail');
    expect(r.ladder.map((x) => x.level)).toEqual(['national']);
    expect(r.region).toBeNull();
  });

  it('national is the floor and always clears', async () => {
    const r = await resolveGeoRollup({}, fakeSource({ counts: {} }), 'retail');
    expect(r.granularityUsed).toBe('national');
    expect(r.ladder).toEqual([{ level: 'national', key: 'US', sampleSize: 0, cleared: true }]);
  });
});

// ───────────────────────── the cohort ─────────────────────────

describe('computeGeoCohort — the two geographies differ, and the grain is shown', () => {
  it('a Manhattan ZIP rolls up to the New York metro, N=320, Drover leading', async () => {
    const out = await computeGeoCohort(NYC, fakeSource(), 'retail');
    expect(out.granularityUsed).toBe('metro');
    expect(out.presentLevel).toBe('metro');
    expect(out.grainLabel).toBe('New York metro');
    expect(out.synthesized).toBe(false);
    expect(out.sampleSize).toBe(320);
    expect(out.topLines[0]?.line).toBe('Drover');
    expect(out.modalBand).toBe('premium');
    expect(out.census).toMatchObject({ key: '35620', medianHhIncome: 99852, source: 'Census ACS 2024 1-yr' });
    expect(out.honesty).toEqual({ geo: 'query-override', query: 'real', firstParty: 'representative', census: 'real-public-acs' });
    expect(out.dataSource).toBe('synthetic');
  });

  it('a Winston-Salem ZIP rolls up to its own metro with a different leader', async () => {
    const out = await computeGeoCohort(WS, fakeSource(), 'retail');
    expect(out.grainLabel).toBe('Winston-Salem metro');
    expect(out.sampleSize).toBe(320);
    expect(out.topLines[0]?.line).toBe('Shorewell');
    expect(out.modalBand).toBe('core');
    expect(out.census?.medianHhIncome).toBe(65903);
  });

  it('labels edge geo as a real connection property', async () => {
    const out = await computeGeoCohort({ ...NYC, source: 'edge' }, fakeSource(), 'retail');
    expect(out.honesty.geo).toBe('real-connection-property');
    expect(out.geo.source).toBe('edge');
  });
});

describe('the representative fallback', () => {
  it('?region=CA: national leaders presented AT California with the REAL CA census, N suppressed', async () => {
    const src = fakeSource();
    const out = await computeGeoCohort({ region: 'CA', source: 'query' }, src, 'retail');
    expect(out.granularityUsed).toBe('national');    // what the gate actually resolved
    expect(out.presentLevel).toBe('region');         // what is presented
    expect(out.synthesized).toBe(true);
    expect(out.sampleSize).toBeNull();               // a borrowed N is never shown
    expect(out.grainLabel).toBe('California');
    expect(out.census).toMatchObject({ key: 'CA', medianHhIncome: 100149 });
    expect(out.topLines[0]?.line).toBe('Shorewell'); // the national leaders
    expect(src.calls).toContain('agg:national:US');  // aggregation stayed national
    expect(src.calls).not.toContain('agg:region:CA');
  });

  it('a region with no census row degrades to plain national, not synthesized', async () => {
    const out = await computeGeoCohort({ region: 'XX', source: 'query' }, fakeSource(), 'retail');
    expect(out.granularityUsed).toBe('national');
    expect(out.presentLevel).toBe('national');
    expect(out.synthesized).toBe(false);
    expect(out.sampleSize).toBe(640);
    expect(out.grainLabel).toBe('United States');
    expect(out.census?.key).toBe('US');
  });

  it('is never taken when a real regional cohort exists', async () => {
    const out = await computeGeoCohort({ region: 'NC', source: 'query' }, fakeSource(), 'retail');
    expect(out.granularityUsed).toBe('region');
    expect(out.synthesized).toBe(false);
    expect(out.sampleSize).toBe(320);
  });
});

// ───────────────────────── the contract ─────────────────────────

describe('the contract', () => {
  it('returns exactly the documented keys, in every branch', async () => {
    const happy = await computeGeoCohort(NYC, fakeSource(), 'retail');
    const fallback = await computeGeoCohort({ region: 'CA' }, fakeSource(), 'retail');
    const broken = await computeGeoCohort(NYC, throwingSource(), 'retail');
    for (const out of [happy, fallback, broken]) {
      expect(Object.keys(out).sort()).toEqual(CONTRACT_KEYS);
      expect(out.ok).toBe(true);
      expect(Object.keys(out.geo).sort()).toEqual(['city', 'country', 'region', 'source', 'zip']);
      expect(Object.keys(out.honesty).sort()).toEqual(['census', 'firstParty', 'geo', 'query']);
      expect(typeof out.ms).toBe('number');
    }
    expect(Object.keys(happy.census!).sort()).toEqual(['key', 'label', 'level', 'medianHhIncome', 'medianHomeValue', 'source', 'vintage']);
    expect(Object.keys(happy.topLines[0]!).sort()).toEqual(['count', 'line', 'share']);
  });

  it('echoes the vertical it was asked for', async () => {
    const out = await computeGeoCohort(NYC, fakeSource(), 'financial');
    expect(out.vertical).toBe('financial');
  });
});

// ───────────────────────── never throws ─────────────────────────

describe('never throws', () => {
  it('a source that is entirely down still returns a valid national/empty payload', async () => {
    const out = await computeGeoCohort(NYC, throwingSource(), 'retail');
    expect(out.ok).toBe(true);
    expect(out.granularityUsed).toBe('national');
    expect(out.topLines).toEqual([]);
    expect(out.census).toBeNull();
    expect(out.synthesized).toBe(false);
  });

  it('the warehouse seam is inert: every method throws NotWiredError, the page still gets a payload', async () => {
    const src = getGeoCohortSource({ DB: undefined as unknown as D1Database, MRD_GEO_COHORT_SOURCE: 'warehouse' });
    expect(src).toBeInstanceOf(WarehouseSource);
    await expect(src.countShoppers({ level: 'national', key: 'US' }, 'retail')).rejects.toThrow(/not wired/);
    const out = await computeGeoCohort(NYC, src, 'retail');
    expect(out.dataSource).toBe('warehouse');
    expect(out.honesty.firstParty).toBe('warehouse');
    expect(out.granularityUsed).toBe('national');
    expect(out.topLines).toEqual([]);
  });

  it('defaults to the synthetic D1 source', () => {
    expect(getGeoCohortSource({ DB: undefined as unknown as D1Database })).toBeInstanceOf(MeridianD1Source);
  });

  it('an unbound D1 yields safe defaults from every method', async () => {
    const src = new MeridianD1Source(undefined);
    expect(await src.resolveXref('10014')).toBeNull();
    expect(await src.countShoppers({ level: 'zip', key: '10014' }, 'retail')).toBe(0);
    expect(await src.aggregate({ level: 'national', key: 'US' }, 'retail', 0)).toEqual(EMPTY_AGGREGATE);
    expect(await src.census({ level: 'region', key: 'NY' })).toBeNull();
  });

  it('a D1 whose every statement throws (missing tables) yields the same safe defaults', async () => {
    const src = new MeridianD1Source(fakeDb(() => { throw new Error('no such table: mrd_transactions'); }));
    expect(await src.resolveXref('10014')).toBeNull();
    expect(await src.countShoppers({ level: 'metro', key: '35620' }, 'retail')).toBe(0);
    expect(await src.aggregate({ level: 'metro', key: '35620' }, 'retail', 320)).toEqual(EMPTY_AGGREGATE);
    expect(await src.census({ level: 'metro', key: '35620' })).toBeNull();
    const out = await computeGeoCohort(NYC, src, 'retail');
    expect(out.ok).toBe(true);
    expect(out.granularityUsed).toBe('national');
  });
});

// ───────────────────────── the D1 source's arithmetic ─────────────────────────

describe('MeridianD1Source — the queries and the arithmetic', () => {
  const seen: Array<{ sql: string; binds: unknown[] }> = [];
  const db = fakeDb((sql, binds) => {
    seen.push({ sql, binds });
    if (/FROM geo_xref/.test(sql)) return [{ metroCbsa: '35620', region: 'NY', country: 'US' }];
    if (/COUNT\(DISTINCT t\.vuid\) AS n/.test(sql)) return [{ n: 320 }];
    if (/i\.line AS line/.test(sql)) return [{ line: 'Drover', count: 112 }, { line: 'Linden', count: 80 }, { line: 'Holloway', count: 48 }];
    if (/i\.family AS family/.test(sql)) return [{ family: 'Drover Field Jacket', category: 'Outerwear', count: 112 }];
    if (/MAX\(i\.value_usd\)/.test(sql)) return [{ v: 298, c: 112 }, { v: 320, c: 124 }, { v: 165, c: 84 }];
    if (/AVG\(t\.order_total_usd\)/.test(sql)) return [{ orders: 320, aov: 373.4, multi: 143 }];
    if (/FROM geo_census/.test(sql)) return [{ level: 'metro', key: '35620', label: 'New York-Newark-Jersey City, NY-NJ Metro', medianHhIncome: 99852, medianHomeValue: 648800, source: 'Census ACS 2024 1-yr', vintage: '2024' }];
    return [];
  });
  const src = new MeridianD1Source(db);

  it('reads the crosswalk', async () => {
    expect(await src.resolveXref('10014')).toEqual({ metroCbsa: '35620', region: 'NY', country: 'US' });
  });

  it('the metro grain joins geo_xref and binds the CBSA then the vertical', async () => {
    seen.length = 0;
    expect(await src.countShoppers({ level: 'metro', key: '35620' }, 'retail')).toBe(320);
    expect(seen[0]!.sql).toMatch(/JOIN geo_xref x ON x\.zip = t\.billing_postal_code/);
    expect(seen[0]!.sql).toMatch(/t\.vertical = \?/);
    expect(seen[0]!.binds).toEqual(['35620', 'retail']);
  });

  it('the national grain binds only the vertical', async () => {
    seen.length = 0;
    await src.countShoppers({ level: 'national', key: 'US' }, 'financial');
    expect(seen[0]!.binds).toEqual(['financial']);
  });

  it('shares are count / sampleSize; the modal band is over headline items; attach and AOV from orders', async () => {
    const agg = await src.aggregate({ level: 'metro', key: '35620' }, 'retail', 320);
    expect(agg.topLines).toEqual([
      { line: 'Drover', count: 112, share: 0.35 }, { line: 'Linden', count: 80, share: 0.25 }, { line: 'Holloway', count: 48, share: 0.15 },
    ]);
    expect(agg.topFamilies).toEqual([{ family: 'Drover Field Jacket', category: 'Outerwear', count: 112, share: 0.35 }]);
    expect(agg.modalBand).toBe('premium');   // 236 headline items ≥ $250 vs 84 below
    expect(agg.aov).toBe(373);
    expect(agg.attachRate).toBe(0.45);       // 143 / 320
    expect(agg.browseToBuy).toBeNull();
  });

  it('reads census by (level, key)', async () => {
    seen.length = 0;
    const c = await src.census({ level: 'metro', key: '35620' });
    expect(seen[0]!.binds).toEqual(['metro', '35620']);
    expect(c).toMatchObject({ key: '35620', medianHhIncome: 99852, medianHomeValue: 648800, vintage: '2024' });
  });
});

// ───────────────────────── bands and labels ─────────────────────────

describe('bands are the registry\'s own', () => {
  it('retail: entry < 75 ≤ core < 250 ≤ premium', () => {
    expect(bandOf(74, 'retail')).toBe('entry');
    expect(bandOf(75, 'retail')).toBe('core');
    expect(bandOf(249, 'retail')).toBe('core');
    expect(bandOf(250, 'retail')).toBe('premium');
  });

  it('financial: modest < 25,000 ≤ core < 250,000 ≤ major', () => {
    expect(bandOf(24_999, 'financial')).toBe('modest');
    expect(bandOf(25_000, 'financial')).toBe('core');
    expect(bandOf(250_000, 'financial')).toBe('major');
  });

  it('the modal band counts headline items and breaks a tie upward', () => {
    expect(modalBandOf([{ v: 186, c: 200 }, { v: 298, c: 100 }], 'retail')).toBe('core');
    expect(modalBandOf([{ v: 186, c: 100 }, { v: 298, c: 100 }], 'retail')).toBe('premium');
    expect(modalBandOf([], 'retail')).toBeNull();
  });

  it('grain labels read as the presenter would say them', () => {
    expect(grainLabelFor('metro', '35620', null, 'New York')).toBe('New York metro');
    expect(grainLabelFor('metro', '49180', null, null)).toBe('Winston-Salem metro');
    expect(grainLabelFor('metro', '99999', null, 'Somewhere')).toBe('Somewhere metro');
    expect(grainLabelFor('region', 'NC', CENSUS['region:NC']!, null)).toBe('North Carolina');
    expect(grainLabelFor('region', 'NC', null, null)).toBe('NC');
    expect(grainLabelFor('zip', '10014', null, null)).toBe('ZIP 10014');
    expect(grainLabelFor('national', 'US', null, null)).toBe('United States');
  });
});
