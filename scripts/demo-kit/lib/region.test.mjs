// node --test scripts/demo-kit/lib/region.test.mjs
// The regional seed library: the census, the rehearsed regions verbatim, the per-state unit counts of the
// income-tilt model, the route's own limits and the read-back loop. (Part a's line-for-line guard against
// scripts/seed-vantage-region.mjs's own dry run retired in part b: that script is now a wrapper over this
// library, and vantage-wrappers.test.mjs runs its documented flags.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadValidConfig } from './config.mjs';
import {
  buildRegions, extraRegions, panelLine, panelProblems, parseCensus, rowsProblems, runRegionSeed, seedRegion, sharesOf, unitsByDimension, unitsOf,
} from './region.mjs';

const configFile = fileURLToPath(new URL('../configs/vantage.json', import.meta.url));
const vantage = loadValidConfig(configFile, { sections: ['region'], exit: (code) => { throw new Error(`the Vantage config is invalid (${code})`); } });
const region = vantage.config.region;
const built = buildRegions(region, { path: vantage.path });
const { all, census, national } = built;
const HOME = extraRegions(region.model.extras[0]);
const phonesOf = (rows) => rows.filter((r) => r.touches.category === 'phones').reduce((n, r) => n + r.units, 0);

test('the census file holds the 50 states, DC and the national row', () => {
  assert.equal(census.size, 51);
  assert.equal(national.key, 'US');
  assert.equal(national.income, 81604);
  assert.equal(Object.keys(all).length, 51);
  assert.deepEqual(Object.keys(all).slice(0, 2), ['US-TX', 'US-NY'], 'the rehearsed regions come first');
  const sql = "('region','TX','Texas',79721,313200,'ACS','2024'),('region','TX','Texas again',1,1,'x','y'),('national','US','United States',81604,1,'ACS','2024')";
  const parsed = parseCensus(sql);
  assert.equal(parsed.rows.get('US-TX').label, 'Texas', 'INSERT OR IGNORE keeps the first row of a key');
  assert.equal(parsed.national.income, 81604);
});

test('the rehearsed regions are written verbatim: Texas 400 phones and 90 home, New York 400 and 25', () => {
  assert.equal(all['US-TX'].rows, region.rehearsed['US-TX'].rows);
  assert.deepEqual([phonesOf(all['US-TX'].rows), unitsOf(all['US-TX'].rows)], [400, 490]);
  assert.deepEqual([phonesOf(all['US-NY'].rows), unitsOf(all['US-NY'].rows)], [400, 425]);
  assert.equal(all['US-TX'].model, null);
  assert.equal(all['US-TX'].census.income, 79721);
});

test('per-state unit counts: every modelled state sells 400 phones, 58 home-internet sales where listed and none elsewhere', () => {
  let modelled = 0, listed = 0;
  for (const [key, r] of Object.entries(all)) {
    if (!r.model) continue;
    modelled += 1;
    const byDim = unitsByDimension(r.rows);
    assert.equal(byDim.category.phones, 400, `${key} phones`);
    for (const dim of ['brand', 'ecosystem', 'priceBand']) assert.equal(Object.values(byDim[dim]).reduce((n, u) => n + u, 0), 400, `${key} ${dim} sums to the phones`);
    if (HOME.has(key)) { listed += 1; assert.equal(byDim.category['home-internet'], 58, `${key} home internet`); }
    else assert.equal(byDim.category['home-internet'], undefined, `${key} has no home internet`);
    assert.equal(unitsOf(r.rows), 400 + (HOME.has(key) ? 58 : 0), `${key} total`);
  }
  assert.equal(modelled, 49);
  assert.equal(listed, 20, 'the 22 listed states, less New York and Texas, which keep their own');
  assert.equal(HOME.size, 22);
});

test('every state leans between the two rehearsed regions, and the extremes are DC and Mississippi', () => {
  const ios = (rows) => unitsByDimension(rows).ecosystem.ios / 400;
  const lo = ios(all['US-TX'].rows), hi = ios(all['US-NY'].rows);
  for (const [key, r] of Object.entries(all)) {
    if (!r.model) continue;
    const share = ios(r.rows);
    assert.ok(share > lo && share < hi, `${key}: iOS ${share} lies strictly between Texas ${lo} and New York ${hi}`);
  }
  assert.deepEqual(all['US-DC'].model, { x: 1, t: 0.8 }, 'only DC reaches the cap');
  const lowest = Object.entries(all).filter(([, r]) => r.model).sort((a, b) => a[1].model.x - b[1].model.x)[0];
  assert.equal(lowest[0], 'US-MS', 'Mississippi is lowest');
  assert.equal(lowest[1].model.x.toFixed(2), '-0.90', 'x = −0.90, as the reference header rounds it');
  assert.equal(all['US-NC'].label, 'North Carolina: synthetic sales, national mix tilted by census income');
});

test('the largest remainder assigns every sale once, and every region passes the seed route\'s own checks', () => {
  for (const [key, r] of Object.entries(all)) {
    assert.deepEqual(rowsProblems(r.rows, region.vocabulary, region.limits), [], key);
    for (const row of r.rows) assert.ok(Number.isInteger(row.units) && row.units > 0, `${key}: whole sales only`);
  }
  const shares = sharesOf(all['US-NY'].rows);
  assert.deepEqual(shares.ecosystem, { ios: 1, android: 0.667 }, 'shares are within a dimension, the leader at 1');
});

test('rowsProblems refuses what the seed route refuses', () => {
  const v = region.vocabulary, l = region.limits;
  assert.match(rowsProblems([{ touches: { colour: 'red' }, units: 1 }], v, l).join(), /not a seeded dimension/);
  assert.match(rowsProblems([{ touches: { brand: 'nokia' }, units: 1 }], v, l).join(), /one of apple, samsung, google, motorola/);
  assert.match(rowsProblems([{ touches: { brand: 'apple' }, units: 401 }], v, l).join(), /whole number 1\.\.400/);
  assert.match(rowsProblems([{ touches: { brand: 'apple' }, units: 400 }, { touches: { brand: 'google' }, units: 401 }], v, l).join(), /at most 800 units/);
  assert.match(rowsProblems(Array.from({ length: 65 }, () => ({ touches: { brand: 'apple' }, units: 1 })), v, l).join(), /rows: 1\.\.64/);
  assert.match(rowsProblems([], v, l).join(), /rows: 1\.\.64/);
});

/** A stand-in for the seed route and the panel. `wrongReads` regions read wrong that many times first. */
function fakeWorker({ wrongReads = {}, failSeeds = {} } = {}) {
  const seeded = {}, calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
    const json = (status, value) => ({ ok: status < 400, status, json: async () => value });
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      if ((failSeeds[body.region] ?? 0) > 0) { failSeeds[body.region] -= 1; return json(503, { ok: false, error: 'restarted' }); }
      seeded[body.region] = unitsOf(body.rows);
      return json(200, { ok: true, frames: unitsOf(body.rows), dataSource: 'synthetic', swapTo: 'warehouse', published: { leaders: { brand: 'apple' } } });
    }
    const key = u.searchParams.get('region');
    if ((wrongReads[key] ?? 0) > 0) { wrongReads[key] -= 1; return json(200, { ok: true, grain: 'state', census: null, lean: { level: 'country', answered: 'US' } }); }
    const want = all[key];
    return json(200, { ok: true, grain: 'state', census: { label: want.census.label, grain: 'state', medianHouseholdIncomeUsd: want.census.income, medianHomeValueUsd: 1, estimate: 'ACS' },
      lean: { level: 'region', answered: key, events: seeded[key] ?? 0, inForce: true, label: 'synthetic → warehouse', dataSource: 'synthetic', leaders: {}, seeded: seeded[key] ? { units: seeded[key] } : null } });
  };
  return { fetchImpl, calls, seeded };
}

test('runRegionSeed seeds every chosen region, reads each back, and reseeds one that still reads wrong', async () => {
  const lines = [];
  const sleeps = [];
  const w = fakeWorker({ wrongReads: { 'US-NC': 2 } });
  const out = await runRegionSeed({ region, tenant: 'vantage', base: 'http://w', all, chosen: ['US-TX', 'US-NC'], headers: {}, log: (l) => lines.push(l), sleep: async (ms) => { sleeps.push(ms); }, fetchImpl: w.fetchImpl });
  assert.deepEqual(out.wrong, []);
  assert.deepEqual(w.seeded, { 'US-TX': 490, 'US-NC': 458 });
  assert.deepEqual(sleeps, [65_000, 65_000], 'one wait to read again, one after reseeding');
  assert.equal(w.calls.filter((c) => c.startsWith('POST')).length, 3, 'North Carolina was seeded a second time');
  assert.match(lines.join('\n'), /2 of 2 region\(s\) answer at region level, labelled synthetic → warehouse/);
});

test('a transient refusal is asked again; --check reads without seeding', async () => {
  const w = fakeWorker({ failSeeds: { 'US-TX': 1 } });
  const sleeps = [];
  const r = await seedRegion({ base: 'http://w', route: region.route, headers: {}, region: 'US-TX', label: 'x', rows: all['US-TX'].rows, log: () => {}, sleep: async (ms) => { sleeps.push(ms); }, fetchImpl: w.fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(sleeps, [3000]);
  const reader = fakeWorker();
  const out = await runRegionSeed({ region, tenant: 'vantage', base: 'http://w', all, chosen: ['US-NY'], headers: null, checkOnly: true, log: () => {}, sleep: async () => {}, fetchImpl: reader.fetchImpl });
  assert.equal(reader.calls.some((c) => c.startsWith('POST')), false);
  assert.deepEqual(out.wrong, ['US-NY'], 'an unseeded region reads wrong and --check says so');
});

test('panelProblems names each way a panel can read wrong', () => {
  const want = all['US-NC'];
  const good = { census: { grain: 'state', medianHouseholdIncomeUsd: want.census.income }, lean: { level: 'region', answered: 'US-NC', dataSource: 'synthetic', label: 'synthetic → warehouse', seeded: { units: unitsOf(want.rows) } } };
  assert.deepEqual(panelProblems('US-NC', good, want), []);
  assert.deepEqual(panelProblems('US-NC', null, want), ['the panel did not answer']);
  assert.match(panelProblems('US-NC', { ...good, lean: { ...good.lean, level: 'country', answered: 'US' } }, want).join(), /lean answered at country US/);
  assert.match(panelProblems('US-NC', { ...good, lean: { ...good.lean, dataSource: 'observed', label: 'observed' } }, want).join(), /labelled “observed”/);
  assert.match(panelProblems('US-NC', { ...good, lean: { ...good.lean, seeded: { units: 1 } } }, want).join(), /seed marker 1, seeded 458/);
  assert.match(panelProblems('US-NC', { ...good, census: { grain: 'metro', medianHouseholdIncomeUsd: 1 } }, want).join(), /census metro \$1/);
  assert.match(panelLine('US-NC', null), /^US-NC panel: grain —; census none; lean none$/);
});
