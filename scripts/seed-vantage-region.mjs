#!/usr/bin/env node
// scripts/seed-vantage-region.mjs — the Vantage demo's regional lean, seeded.
//
// docs/verizon/Vantage-Demo-Design.md §5: there is no public regional OS or
// brand data (StatCounter publishes none by state), so the regional lean on the
// first paint is the carrier's OWN sales from that region. We do not have the
// carrier's sales, so this script writes SYNTHETIC ones, labelled
// `dataSource: synthetic → warehouse` everywhere they are shown: the same
// operation a warehouse import would perform, with the data swapped.
//
// For each rehearsed region it calls POST /vantage/api/coldstart/prior
// (src/routes/vantageColdStart.ts), which REPLACES that region's synthetic sales
// in the tenant's regional prior: it resets the region object, ingests one
// frame per synthetic sale (brand, ecosystem, price band, category) through the
// object's own door, publishes, records the seed marker and rolls the tenant's
// regions up into the country and everyone. A rerun leaves exactly this data.
//
// Never seeded: census figures (shown on the panel, never scored), household or
// family tables, line counts, intent. Geography adds; it never excludes.
//
// The region object decays with a 24-hour horizon (REGION_TAU_MS). Shares are
// unaffected by a uniform decay, but this demo's own live visits from a seeded
// region weigh relatively more as the seed ages, so reseed on the morning of a
// rehearsal or a meeting. Seeding writes no file under public/, so no redeploy
// follows it (unlike scripts/seed-vantage.mjs).
//
//   node scripts/seed-vantage-region.mjs [--base http://localhost:9110] [--token <jwt>]
//                                        [--regions US-TX,US-NY] [--dry-run]
//
// Use --token or OPERATOR_TOKEN with a grant on `vantage`. Local minting (a
// loopback --base only) needs DEPLOYMENT_PROFILE=demo and explicit JWT_SECRET,
// JWT_ISSUER, JWT_AUDIENCE, and TENANTS must grant the subject
// `seed-vantage-region` the `vantage` tenant.
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

const chosen = (arg('--regions', Object.keys(REGIONS).join(','))).split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
for (const region of chosen) if (!REGIONS[region]) { console.error(`unknown region ${region}; rehearsed: ${Object.keys(REGIONS).join(', ')}`); process.exit(2); }

/** Within-dimension shares, leader = 1, exactly as the region object will publish them (before decay). */
function sharesOf(rows) {
  const r = {};
  for (const row of rows) for (const [dim, value] of Object.entries(row.touches)) (r[dim] ??= {})[value] = (r[dim][value] ?? 0) + row.units;
  return Object.fromEntries(Object.entries(r).map(([dim, values]) => {
    const max = Math.max(...Object.values(values));
    return [dim, Object.fromEntries(Object.entries(values).sort((a, b) => b[1] - a[1]).map(([v, x]) => [v, Math.round((x / max) * 1000) / 1000]))];
  }));
}

if (dryRun) {
  for (const region of chosen) {
    const { label, rows } = REGIONS[region];
    console.log(JSON.stringify({ region, label, units: rows.reduce((n, r) => n + r.units, 0), share: sharesOf(rows) }, null, 1));
  }
  process.exit(0);
}

const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'seed-vantage-region', roles: ['operator'] },
  expiresIn: '10m', allowMint: isLoopbackTarget(base) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': TENANT };

let ok = true;
for (const region of chosen) {
  const { label, rows } = REGIONS[region];
  const res = await fetch(`${base}/vantage/api/coldstart/prior`, { method: 'POST', headers: auth, body: JSON.stringify({ region, label, rows }) });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || body.ok !== true) { ok = false; console.log(`${region}:`, JSON.stringify({ status: res.status, ...body })); continue; }
  console.log(`${region}: ${body.frames} synthetic sales, dataSource ${body.dataSource} → ${body.swapTo}; leaders ${JSON.stringify(body.published?.leaders ?? null)}`);
}

// What a stranger now opens with, per region, through the same read the panel uses.
for (const region of chosen) {
  const res = await fetch(`${base}/vantage/api/coldstart?region=${encodeURIComponent(region)}`, { headers: { 'X-Tenant': TENANT } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) { ok = false; console.log(`${region} panel:`, res.status, JSON.stringify(body)); continue; }
  const c = body.census, l = body.lean;
  console.log(`${region} panel: grain ${body.grain}; census ${c ? `${c.label} $${c.medianHouseholdIncomeUsd} / $${c.medianHomeValueUsd} (${c.estimate})` : 'none'}; `
    + `lean ${l ? `${l.level} ${l.answered}, ${l.events} events, in force ${l.inForce}, ${l.label}, leaders ${JSON.stringify(l.leaders)}` : 'none'}`);
}
process.exit(ok ? 0 : 1);
