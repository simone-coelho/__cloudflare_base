#!/usr/bin/env node
// scripts/seed-vantage-region.mjs — the Vantage demo's regional lean, seeded for every state.
//
// docs/verizon/Vantage-Demo-Design.md §5: there is no public regional OS or
// brand data (StatCounter publishes none by state), so the regional lean on the
// first paint is the carrier's OWN sales from that region. We do not have the
// carrier's sales, so this script writes SYNTHETIC ones, labelled
// `dataSource: synthetic → warehouse` everywhere they are shown: the same
// operation a warehouse import would perform, with the data swapped.
//
// The arrival opens on the visitor's real region (lane F2, 2026-10-01): the edge
// locates the request and the page asserts nothing on beat 1. So all 50 states
// and DC carry a seeded lean; otherwise a visitor from an unseeded state opens on
// whatever this worker's own traffic left there.
//
// THE MODEL (docs/verizon/lanes/F2.md §2)
//
//   US-TX and US-NY are lane L4's rehearsed regions, unchanged byte for byte
//   (REGIONS below; the measured beats depend on them). The other 49 come from
//   one small model, built on those two:
//
//     x = clamp((state median household income − national median) / $25,000, −1, 1)
//     t = 0.5 + 0.3 · x                                        so t runs 0.2 … 0.8
//     phones, per brand · ecosystem · price band row:
//            TX(row) · (1 − t) + NY(row) · t                   400 a state, whole sales
//                                                              by largest remainder
//     home internet: 58 sales where Verizon offers home internet (the list
//            below), none elsewhere
//
//   Income: the state's own row in the shared geo_census table (U.S. Census ACS
//   2024 1-year, table B19013), read from migrations/seed/seed_011_geo.sql, the
//   file that loaded those rows; the national median is that file's US row,
//   $81,604. Only DC reaches the cap (x = 1); Mississippi is lowest (x = −0.90).
//   t = 0.5 is the national mix: the two rehearsed regions pooled (iPhone 48.75 %,
//   Samsung 33 %, Google 11 %, Motorola 7.5 %; premium 49 %, core 40 %, entry 11 %).
//   Higher income moves a state toward New York's sales (iPhone, premium), lower
//   income toward Texas's (Android, core), but never more than 0.3 of the way
//   from the middle, so every state's mix sits strictly between the two rehearsed
//   regions and no state leans harder than New York or Texas.
//
//   Home internet, a short demo list, not a coverage map: fiber, the Fios
//   footprint (NY NJ PA MA RI DE MD VA DC), and fixed wireless, the demo's own
//   5G Home list (the catalog's promo-5g-home eligibleWhen.regions: TX NY NJ PA
//   MA IL FL GA NC CA AZ CO WA MI OH VA MN TN). 58 sales, the rehearsed regions'
//   average of 90 and 25, in the 20 listed states other than NY and TX, which
//   keep their own.
//
//   Never used or derived: any protected class, household or family tables, line
//   counts, intent, a ZIP. The census income shapes only this synthetic stand-in;
//   the engine reads no census figure at decision time (the panel's
//   scored.census stays false), and in production the lean is the carrier's real
//   warehouse sales, not a model of them.
//
// For each region it calls POST /vantage/api/coldstart/prior
// (src/routes/vantageColdStart.ts), which REPLACES that region's synthetic sales
// in the tenant's regional prior: it resets the region object, ingests one
// frame per synthetic sale (brand, ecosystem, price band, category) through the
// object's own door, publishes, records the seed marker and rolls the tenant's
// regions up into the country and everyone. A rerun leaves exactly this data.
// Then it reads every seeded region back through the panel's own read and checks
// it answered at region level, labelled synthetic, with the census the model used.
//
// The region object decays with a 24-hour horizon (REGION_TAU_MS), and every
// event a visitor sends fans into the region the edge places her in, on every
// dimension, intent, lines and perk included, which this seed never writes. So a
// walkthrough leaves its own touches in the presenter's state, and one intent or
// lines touch is enough to take beat 1 off the ad for the next visitor from there
// (shares are relative to each dimension's leader). Reseed that state (--regions
// here) before showing beat 1 from it again, after any suite run, and every region
// on the morning of a rehearsal. Seeding writes no file under public/, so no
// redeploy follows it (unlike scripts/seed-vantage.mjs).
//
//   node scripts/seed-vantage-region.mjs [--base http://localhost:9110] [--token <jwt>]
//                                        [--regions US-NC,US-TX | here] [--dry-run [--rows]] [--check]
//
// --regions here is the state the edge places this machine in.
//
// --dry-run prints the model and every region's shares (--rows: its rows too), sending nothing.
// --check reads the panels back without seeding (no token needed).
// Use --token or OPERATOR_TOKEN with a grant on `vantage`. Local minting (a
// loopback --base only) needs DEPLOYMENT_PROFILE=demo and explicit JWT_SECRET,
// JWT_ISSUER, JWT_AUDIENCE, and TENANTS must grant the subject
// `seed-vantage-region` the `vantage` tenant.
import { readFileSync } from 'node:fs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:9110').replace(/\/+$/, '');
const dryRun = argv.includes('--dry-run');
const TENANT = 'vantage';

/** One synthetic device sale per unit: the touches it carries. */
const device = (brand, ecosystem, priceBand, units) => ({ touches: { category: 'phones', brand, ecosystem, priceBand }, units });
/** A home-internet bundle sale: it moves category only. */
const home = (units) => ({ touches: { category: 'home-internet' }, units });

/**
 * The two rehearsed regions, chosen among those the shared census tables cover
 * at state grain with real ACS 2024 1-year rows (Texas $79,721 / $313,200;
 * New York $85,820 / $449,800). Four hundred synthetic device sales each, so
 * the region clears the prior's evidence gate (learn.regional.minEvents) on its
 * own and is answered at region level, never rolled up.
 *
 *   US-TX: Samsung leads Apple narrowly, Android 62.5 %, the core band leads,
 *          and home-internet bundles sell (22.5 % of the phone volume).
 *   US-NY: Apple leads clearly, iOS 60 %, the premium band leads, and the
 *          home bundle barely registers (6 %).
 *
 * Synthetic and representative. Not a claim about either state's market.
 */
const REGIONS = {
  'US-TX': {
    label: 'Texas: synthetic carrier sales, rehearsal region A',
    rows: [
      device('samsung', 'android', 'core', 90), device('samsung', 'android', 'premium', 45), device('samsung', 'android', 'entry', 25),
      device('apple', 'ios', 'premium', 80), device('apple', 'ios', 'core', 70),
      device('google', 'android', 'premium', 20), device('google', 'android', 'core', 25),
      device('motorola', 'android', 'entry', 35), device('motorola', 'android', 'core', 10),
      home(90),
    ],
  },
  'US-NY': {
    label: 'New York: synthetic carrier sales, rehearsal region B',
    rows: [
      device('apple', 'ios', 'premium', 170), device('apple', 'ios', 'core', 70),
      device('samsung', 'android', 'premium', 55), device('samsung', 'android', 'core', 40), device('samsung', 'android', 'entry', 10),
      device('google', 'android', 'premium', 25), device('google', 'android', 'core', 15),
      device('motorola', 'android', 'entry', 15),
      home(25),
    ],
  },
};

// ── The other 49: the model in the header, nothing else ─────────────────────
const MODEL = Object.freeze({
  /** One unit of x, in dollars of median household income. */
  spreadUsd: 25000,
  /** t = 0.5 + tSpan · x: how far from the national mix toward a rehearsed region a state may go. */
  tSpan: 0.3,
  /** Home-internet sales in a listed state: the rehearsed regions' average, round((90 + 25) / 2). */
  homeUnits: 58,
  /** Fiber: the Fios footprint. */
  fiber: ['US-NY', 'US-NJ', 'US-PA', 'US-MA', 'US-RI', 'US-DE', 'US-MD', 'US-VA', 'US-DC'],
  /** Fixed wireless: the demo's 5G Home list, as the catalog's promo-5g-home eligibleWhen.regions names it. */
  fixedWireless: ['US-TX', 'US-NY', 'US-NJ', 'US-PA', 'US-MA', 'US-IL', 'US-FL', 'US-GA', 'US-NC', 'US-CA', 'US-AZ', 'US-CO',
    'US-WA', 'US-MI', 'US-OH', 'US-VA', 'US-MN', 'US-TN'],
});
const HOME_INTERNET = new Set([...MODEL.fiber, ...MODEL.fixedWireless]);
const round3 = (n) => Math.round(n * 1000) / 1000;
const usd = (n) => `$${Number(n).toLocaleString('en-US')}`;

/**
 * The shared census rows, as migrations/seed/seed_011_geo.sql loads them into
 * geo_census: one region row per state and DC, and the national row. INSERT OR
 * IGNORE keeps the first row of a key, so this does too.
 */
function readCensus() {
  const sql = readFileSync(new URL('../migrations/seed/seed_011_geo.sql', import.meta.url), 'utf8');
  const rows = new Map();
  let national = null;
  const re = /\(\s*'(region|national)'\s*,\s*'([A-Z]{2})'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g;
  for (const m of sql.matchAll(re)) {
    const row = { key: m[1] === 'national' ? 'US' : `US-${m[2]}`, label: m[3], income: Number(m[4]), homeValue: Number(m[5]), source: m[6], vintage: m[7] };
    if (m[1] === 'national') national ??= row;
    else if (!rows.has(row.key)) rows.set(row.key, row);
  }
  return { rows, national };
}
const { rows: CENSUS, national: NATIONAL } = readCensus();
if (!NATIONAL || CENSUS.size !== 51) {
  console.error(`seed_011_geo.sql: expected 51 state and DC rows and a national row, read ${CENSUS.size}${NATIONAL ? '' : ' and no national row'}`);
  process.exit(2);
}

/** Phone sales by brand|ecosystem|priceBand row, so the two rehearsed regions blend row by row. */
const rowKey = (t) => `${t.brand}|${t.ecosystem}|${t.priceBand}`;
function phoneUnits(rows) {
  const m = new Map();
  for (const r of rows) if (r.touches.category === 'phones') m.set(rowKey(r.touches), (m.get(rowKey(r.touches)) ?? 0) + r.units);
  return m;
}

/** One modelled state: TX · (1 − t) + NY · t over the phone rows, whole sales by largest remainder, plus home internet where listed. */
function modelled(key, census) {
  const x = Math.max(-1, Math.min(1, (census.income - NATIONAL.income) / MODEL.spreadUsd));
  const t = 0.5 + MODEL.tSpan * x;
  const tx = phoneUnits(REGIONS['US-TX'].rows), ny = phoneUnits(REGIONS['US-NY'].rows);
  const exact = [...new Set([...tx.keys(), ...ny.keys()])].map((k) => ({ k, u: (tx.get(k) ?? 0) * (1 - t) + (ny.get(k) ?? 0) * t }));
  const total = Math.round(exact.reduce((n, r) => n + r.u, 0));      // 400: both rehearsed regions sell 400 phones
  for (const r of exact) { r.n = Math.floor(r.u); r.rem = r.u - r.n; }
  let short = total - exact.reduce((n, r) => n + r.n, 0);
  for (const r of [...exact].sort((a, b) => b.rem - a.rem || a.k.localeCompare(b.k))) { if (short <= 0) break; r.n += 1; short -= 1; }
  const rows = exact.filter((r) => r.n > 0).map((r) => { const [brand, ecosystem, priceBand] = r.k.split('|'); return device(brand, ecosystem, priceBand, r.n); });
  if (HOME_INTERNET.has(key)) rows.push(home(MODEL.homeUnits));
  // Shown on the panel under the lean; the route keeps letters, digits and .,:;'’()—- to 80 characters.
  return { label: `${census.label}: synthetic sales, national mix tilted by census income`, rows, census, model: { x: round3(x), t: round3(t) } };
}

/** Every region this script can seed: the rehearsed two first, verbatim, then the 49 modelled ones by key. */
const ALL = {};
for (const [key, r] of Object.entries(REGIONS)) ALL[key] = { ...r, census: CENSUS.get(key) ?? null, model: null };
for (const key of [...CENSUS.keys()].sort()) if (!ALL[key]) ALL[key] = modelled(key, CENSUS.get(key));
const unitsOf = (region) => ALL[region].rows.reduce((n, r) => n + r.units, 0);

const checkOnly = argv.includes('--check');
const chosen = (arg('--regions', Object.keys(ALL).join(','))).split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
// `here`: the state the edge places this machine in, as the panel reads it with nothing asserted. It is the
// region a walkthrough from this machine leaves its own touches in, so it is the one to reseed before the next.
if (chosen.includes('HERE')) {                // one read-only GET, even on a dry run
  const res = await fetch(`${base}/vantage/api/coldstart`, { headers: { 'X-Tenant': TENANT }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = res && res.ok ? await res.json().catch(() => null) : null;
  const key = body && body.region && body.region.source === 'edge' ? body.region.key : null;
  if (!key || !ALL[key]) { console.error(`--regions here: the edge put ${key ? `${key}, not a US state or DC,` : 'no region'} on this request; name the region instead`); process.exit(2); }
  console.log(`here: the edge places this machine in ${key}`);
  chosen.splice(chosen.indexOf('HERE'), 1, key);
}
for (const region of chosen) if (!ALL[region]) { console.error(`unknown region ${region}; this script seeds the 50 states and DC as US-XX keys, or here`); process.exit(2); }

/** Within-dimension shares, leader = 1, exactly as the region object will publish them (before decay). */
function sharesOf(rows) {
  const r = {};
  for (const row of rows) for (const [dim, value] of Object.entries(row.touches)) (r[dim] ??= {})[value] = (r[dim][value] ?? 0) + row.units;
  return Object.fromEntries(Object.entries(r).map(([dim, values]) => {
    const max = Math.max(...Object.values(values));
    return [dim, Object.fromEntries(Object.entries(values).sort((a, b) => b[1] - a[1]).map(([v, x]) => [v, Math.round((x / max) * 1000) / 1000]))];
  }));
}
const shareLine = (s) => ['ecosystem', 'brand', 'priceBand', 'category'].map((d) => Object.entries(s[d] || {}).map(([v, x]) => `${v} ${x}`).join(' ')).join(' · ');

if (dryRun) {
  console.log(`The model: x = clamp((income − ${usd(NATIONAL.income)}) / ${usd(MODEL.spreadUsd)}, −1, 1); t = 0.5 + ${MODEL.tSpan}·x; phones = TX·(1 − t) + NY·t, 400;`
    + ` home internet ${MODEL.homeUnits} in the listed states (${HOME_INTERNET.size}). Income: the geo_census region rows (${NATIONAL.source}, 1-year), from migrations/seed/seed_011_geo.sql.\n`);
  for (const region of chosen) {
    const r = ALL[region];
    const phones = r.rows.filter((x) => x.touches.category === 'phones').reduce((n, x) => n + x.units, 0);
    console.log(`${region.padEnd(6)} ${(r.census ? r.census.label : region).padEnd(21)} ${r.census ? usd(r.census.income).padStart(9) : ''.padStart(9)}  `
      + `${r.model ? `x ${r.model.x.toFixed(3).padStart(6)} t ${r.model.t.toFixed(3)}` : 'rehearsed, as L4 wrote'.padEnd(20)}  `
      + `${String(phones).padStart(3)} phones ${String(unitsOf(region) - phones).padStart(2)} home  ${shareLine(sharesOf(r.rows))}`);
    if (argv.includes('--rows')) console.log(`       ${JSON.stringify(r.rows.map((x) => [Object.values(x.touches).join('/'), x.units]))}`);
  }
  process.exit(0);
}

async function panelOf(region) {
  try {
    const res = await fetch(`${base}/vantage/api/coldstart?region=${encodeURIComponent(region)}`, { headers: { 'X-Tenant': TENANT }, signal: AbortSignal.timeout(20_000) });
    const body = await res.json().catch(() => null);
    return res.ok && body?.ok ? body : null;
  } catch { return null; }
}
/** What a stranger from the region now opens with, through the panel's own read, checked against what was seeded. */
function problemsOf(region, body) {
  if (!body) return ['the panel did not answer'];
  const l = body.lean, c = body.census, want = ALL[region], out = [];
  if (!l || l.level !== 'region' || l.answered !== region) out.push(`lean answered at ${l ? `${l.level} ${l.answered}` : 'nothing'}`);
  if (!l || l.dataSource !== 'synthetic') out.push(`lean labelled “${l ? l.label : 'none'}”`);
  if (!l || !l.seeded || l.seeded.units !== unitsOf(region)) out.push(`seed marker ${l && l.seeded ? l.seeded.units : 'missing'}, seeded ${unitsOf(region)}`);
  if (want.census && (!c || c.grain !== 'state' || c.medianHouseholdIncomeUsd !== want.census.income)) out.push(`census ${c ? `${c.grain} $${c.medianHouseholdIncomeUsd}` : 'none'}, model ${usd(want.census.income)}`);
  return out;
}
function panelLine(region, b) {
  const c = b && b.census, l = b && b.lean;
  return `${region} panel: grain ${b ? b.grain : '—'}; census ${c ? `${c.label} $${c.medianHouseholdIncomeUsd} / $${c.medianHomeValueUsd} (${c.estimate})` : 'none'}; `
    + `lean ${l ? `${l.level} ${l.answered}, ${l.events} events${l.liveEvents ? ` (${l.liveEvents} live)` : ''}, in force ${l.inForce}, ${l.label}, leaders ${JSON.stringify(l.leaders)}` : 'none'}`;
}

let auth = null;
/**
 * One region, replaced. A rerun leaves exactly this data, so a transient refusal (a 5xx, or no answer: the
 * local dev runtime restarts when a durable object throws, L5 finding 3) is asked again, twice, seconds apart.
 */
async function seed(region) {
  const { label, rows } = ALL[region];
  const t0 = Date.now();
  let res, body;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      res = await fetch(`${base}/vantage/api/coldstart/prior`, { method: 'POST', headers: auth, body: JSON.stringify({ region, label, rows }), signal: AbortSignal.timeout(120_000) });
      body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    } catch (error) { res = { ok: false, status: 0 }; body = { ok: false, error: error.message }; }
    if ((res.ok && body.ok === true) || (res.status > 0 && res.status < 500) || attempt === 3) break;
    console.log(`${region}: answered ${res.status || 'nothing'}; asking again (${attempt + 1} of 3)`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  if (!res.ok || body.ok !== true) { console.log(`${region}:`, JSON.stringify({ status: res.status, ...body })); return false; }
  console.log(`${region}: ${body.frames} synthetic sales in ${((Date.now() - t0) / 1000).toFixed(1)} s, dataSource ${body.dataSource} → ${body.swapTo}; leaders ${JSON.stringify(body.published?.leaders ?? null)}`);
  return true;
}

let ok = true;
if (!checkOnly) {
  const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'seed-vantage-region', roles: ['operator'] },
    expiresIn: '30m', allowMint: isLoopbackTarget(base) });
  auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': TENANT };
  for (const region of chosen) if (!await seed(region)) ok = false;
}

// Read every region back. KV and the isolates' trend caches settle within a minute, so a region that
// reads wrong is read again after one; if it still reads wrong it is seeded once more and read again.
const results = new Map();
let wrong = [];
for (const region of chosen) { const b = await panelOf(region); results.set(region, b); if (problemsOf(region, b).length) wrong.push(region); }
for (const pass of checkOnly ? [] : ['read', 'seed']) {
  if (!wrong.length) break;
  console.log(`\n${wrong.length} region(s) read wrong (${wrong.join(', ')}); ${pass === 'seed' ? 'seeding them again, then ' : ''}waiting 65 s for KV and the trend caches before reading again`);
  if (pass === 'seed') for (const region of wrong) await seed(region);
  await new Promise((r) => setTimeout(r, 65_000));
  const still = [];
  for (const region of wrong) { const b = await panelOf(region); results.set(region, b); if (problemsOf(region, b).length) still.push(region); }
  wrong = still;
}
console.log('');
for (const region of chosen) {
  const problems = problemsOf(region, results.get(region));
  console.log(panelLine(region, results.get(region)) + (problems.length ? `  ✗ ${problems.join('; ')}` : ''));
}
console.log(`\n${chosen.length - wrong.length} of ${chosen.length} region(s) answer at region level, labelled synthetic → warehouse, with the census the model used`
  + `${wrong.length ? `; wrong: ${wrong.join(', ')}` : ''}.`);
if (!ok && !wrong.length) console.log('Every refusal above was put right by the second pass.');
process.exit(wrong.length ? 1 : 0);
