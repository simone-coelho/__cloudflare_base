#!/usr/bin/env node
/**
 * seed-funnel.mjs
 * --------------------------------------------------------------------------
 * Deterministic seed emitter for Revenue Radar — the checkout-funnel baseline
 * (`funnel_seed`) that gives the demo a stable, pre-loaded funnel shape with
 * three readable, brand-specific leaks. Writes migrations/0003_funnel_seed.sql.
 *
 * Determinism contract (same as scripts/seed-d1.mjs):
 *   - seeded Mulberry32 PRNG (no bare Math.random)
 *   - no Date.now / no wall-clock
 *   => byte-identical re-runs. Re-run after editing the tuning constants below.
 *
 * SHAPE = src/services/funnel/contract.ts (the single source of truth). This is
 * a plain Node ESM script (no TS loader), so the contract's BRANDS / COHORTS /
 * STAGE_KEYS / BASELINE_STEP_CONV are MIRRORED below and asserted. If the
 * contract changes, update BOTH (the asserts catch obvious drift).
 *
 * THE STORY THIS DATA TELLS (hand-tuned so the leaks read cleanly):
 *   - Traffic skews YOUNG: Gen Z is the largest top-of-funnel cohort (the hero).
 *   - Coach           — HERO leak: gen_z add_payment_info -> purchase ~0.55
 *                       (vs ~0.78 baseline). BNPL hesitation on high-AOV bags.
 *                       Other Coach cohorts stay near baseline.
 *   - Kate Spade      — "Empty-Cart Viewers": view_cart -> begin_checkout ~0.55
 *                       across ALL cohorts (the cart does not persist).
 *   - Stuart Weitzman — shipping sticker-shock: begin_checkout -> add_shipping_info
 *                       ~0.58 across ALL cohorts (highest-AOV brand).
 *
 * The 'all' cohort is NOT stored — the compute layer sums the real cohorts.
 *
 * Apply the generated migration (LOCAL then REMOTE):
 *   npx wrangler d1 migrations apply coach-demo-db --local
 *   npx wrangler d1 migrations apply coach-demo-db --remote
 * --------------------------------------------------------------------------
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_FILE = join(REPO_ROOT, 'migrations', '0003_funnel_seed.sql');
const SEED = 20260625; // house seed (matches scripts/seed-d1.mjs / generate-synthetic-data.mjs)

// ── Contract mirror (src/services/funnel/contract.ts is the source of truth) ──
const BRANDS = ['Coach', 'Kate Spade', 'Stuart Weitzman'];
const COHORTS = ['gen_z', 'millennial', 'gen_x', 'boomer']; // real cohorts only (NO 'all')
const STAGE_KEYS = ['add_to_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'purchase'];
const BASELINE_STEP_CONV = {
  add_to_cart: 1.0, // entry
  view_cart: 0.82,
  begin_checkout: 0.68,
  add_shipping_info: 0.75,
  add_payment_info: 0.80,
  purchase: 0.78,
};

function assert(cond, msg) { if (!cond) throw new Error(`seed-funnel: contract drift — ${msg}`); }
assert(STAGE_KEYS.length === 6, 'expected 6 stages');
assert(STAGE_KEYS[0] === 'add_to_cart', 'first stage must be add_to_cart (entry)');
assert(STAGE_KEYS[STAGE_KEYS.length - 1] === 'purchase', 'last stage must be purchase');
assert(STAGE_KEYS.every((k) => typeof BASELINE_STEP_CONV[k] === 'number'), 'every stage needs a baseline conv');
assert(BASELINE_STEP_CONV.add_to_cart === 1.0, 'add_to_cart conv must be 1.0 (entry)');

// ── Deterministic PRNG (Mulberry32) — the ONLY source of variation ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const jitter = (mag) => (rng() * 2 - 1) * mag; // symmetric in [-mag, +mag]

// ── Tuning ──
// Top-of-funnel sessions per cohort — skews YOUNG (Gen Z largest). Sum ~ 3,000 / brand.
const ENTRY_BASE = { gen_z: 900, millennial: 1100, gen_x: 600, boomer: 400 };

// Per-brand SIGNATURE LEAK: the one collapsed step that tells that brand's story.
// Returns an overriding step-conversion (fraction FROM the previous stage), or null.
function signatureLeak(brand, cohort, stage) {
  if (brand === 'Coach' && cohort === 'gen_z' && stage === 'purchase') return 0.55;   // HERO: BNPL hesitation
  if (brand === 'Kate Spade' && stage === 'begin_checkout') return 0.55;              // Empty-Cart Viewers
  if (brand === 'Stuart Weitzman' && stage === 'add_shipping_info') return 0.58;      // shipping sticker-shock
  return null;
}

// ── Generate rows: { brand, cohort, stage, sessions } for every real cohort ──
const rows = [];
for (const brand of BRANDS) {
  for (const cohort of COHORTS) {
    const entry = Math.max(1, Math.round(ENTRY_BASE[cohort] * (1 + jitter(0.03))));
    let prev = entry;
    for (const stage of STAGE_KEYS) {
      let sessions;
      if (stage === 'add_to_cart') {
        sessions = entry; // entry stage (conv 1.0)
      } else {
        const leak = signatureLeak(brand, cohort, stage);
        const conv = leak != null
          ? leak + jitter(0.01)                          // leak: crisp target + tiny jitter (cohorts not identical)
          : BASELINE_STEP_CONV[stage] + jitter(0.012);   // baseline: small organic jitter
        // Whole integers + MONOTONICALLY NON-INCREASING (clamp <= prev; defensive even though conv < 1).
        sessions = Math.min(prev, Math.max(0, Math.round(prev * conv)));
      }
      rows.push({ brand, cohort, stage, sessions });
      prev = sessions;
    }
  }
}

// ── SQL emit (STRICT-safe literals, house style) ──
const sTxt = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sInt = (v) => String(Math.round(Number(v)));

const LEAK_NOTE = {
  Coach: 'HERO leak — gen_z add_payment_info -> purchase collapses (~0.55 vs ~0.78): Gen-Z BNPL hesitation on high-AOV bags. Other cohorts near baseline.',
  'Kate Spade': 'Empty-Cart Viewers — view_cart -> begin_checkout weak (~0.55) across all cohorts: cart does not persist.',
  'Stuart Weitzman': 'Shipping sticker-shock — begin_checkout -> add_shipping_info weak (~0.58) across all cohorts: highest-AOV brand.',
};

function brandInsert(brand) {
  const values = rows
    .filter((r) => r.brand === brand)
    .map((r) => `  (${sTxt(r.brand)}, ${sTxt(r.cohort)}, ${sTxt(r.stage)}, ${sInt(r.sessions)})`)
    .join(',\n');
  return `-- ${brand} — ${LEAK_NOTE[brand]}\nINSERT INTO funnel_seed (brand, cohort, stage, sessions) VALUES\n${values};`;
}

const HR = '-- ' + '='.repeat(75);
const header = [
  HR,
  '-- 0003_funnel_seed.sql · Revenue Radar — checkout-funnel SEED baseline',
  `--   GENERATED by scripts/seed-funnel.mjs (deterministic, seed=${SEED}). DO NOT hand-edit.`,
  '--   Shape = src/services/funnel/contract.ts. Target: Cloudflare D1 (SQLite, STRICT).',
  '--',
  '--   Two tables:',
  '--     funnel_seed — persistent per-(brand,cohort,stage) baseline ("representative day").',
  '--     funnel_live — resettable live layer (traffic simulator + amplify-on-action).',
  "--   Funnel total = funnel_seed + funnel_live + real Coach demo_events. The 'all' cohort",
  '--   is NOT stored — the compute layer sums the real cohorts (gen_z/millennial/gen_x/boomer).',
  '--',
  '--   Stories (hand-tuned so leaks read cleanly):',
  '--     Coach           — HERO: gen_z add_payment_info -> purchase ~0.55 (BNPL hesitation).',
  '--     Kate Spade      — view_cart -> begin_checkout ~0.55 (Empty-Cart Viewers).',
  '--     Stuart Weitzman — begin_checkout -> add_shipping_info ~0.58 (shipping sticker-shock).',
  '--',
  '--   Apply (LOCAL then REMOTE):',
  '--     npx wrangler d1 migrations apply coach-demo-db --local',
  '--     npx wrangler d1 migrations apply coach-demo-db --remote',
  HR,
].join('\n');

const ddl = [
  '',
  '-- ── Schema (STRICT). IF NOT EXISTS so re-apply is safe. ──',
  'CREATE TABLE IF NOT EXISTS funnel_seed (',
  '  brand    TEXT,',
  '  cohort   TEXT,',
  '  stage    TEXT,',
  '  sessions INTEGER,',
  '  PRIMARY KEY (brand, cohort, stage)',
  ') STRICT;',
  '',
  'CREATE TABLE IF NOT EXISTS funnel_live (',
  '  brand      TEXT,',
  '  cohort     TEXT,',
  '  stage      TEXT,',
  '  sessions   INTEGER NOT NULL DEFAULT 0,',
  '  updated_ts INTEGER,',
  '  PRIMARY KEY (brand, cohort, stage)',
  ') STRICT;',
  '',
  '-- Helpful indexes (the PK already covers brand / brand,cohort prefix lookups).',
  'CREATE INDEX IF NOT EXISTS idx_funnel_seed_brand_stage ON funnel_seed(brand, stage);',
  'CREATE INDEX IF NOT EXISTS idx_funnel_live_brand_stage ON funnel_live(brand, stage);',
  'CREATE INDEX IF NOT EXISTS idx_funnel_live_updated     ON funnel_live(updated_ts);',
  '',
  '-- Idempotent re-seed of the baseline ONLY (never touches the live layer).',
  'DELETE FROM funnel_seed;',
  '',
].join('\n');

const body = BRANDS.map(brandInsert).join('\n\n');

const footer = [
  '',
  '',
  '-- ── Verify (every brand shows 6 stages; sessions non-increasing down the funnel) ──',
  '--   SELECT brand, stage, SUM(sessions) AS sessions',
  '--     FROM funnel_seed GROUP BY brand, stage',
  '--    ORDER BY brand, CASE stage',
  "--      WHEN 'add_to_cart' THEN 1 WHEN 'view_cart' THEN 2 WHEN 'begin_checkout' THEN 3",
  "--      WHEN 'add_shipping_info' THEN 4 WHEN 'add_payment_info' THEN 5 WHEN 'purchase' THEN 6 END;",
  HR,
  '-- END 0003_funnel_seed.sql',
  HR,
  '',
].join('\n');

writeFileSync(OUT_FILE, `${header}\n${ddl}\n${body}\n${footer}`);

// ── Console summary (the story is visible on every run) ──
const get = (brand, cohort, stage) =>
  rows.find((r) => r.brand === brand && r.cohort === cohort && r.stage === stage).sessions;
const sumAll = (brand, stage) => COHORTS.reduce((s, c) => s + get(brand, c, stage), 0);

console.log(`seed-funnel: wrote migrations/0003_funnel_seed.sql — ${rows.length} rows (${BRANDS.length} brands × ${COHORTS.length} cohorts × ${STAGE_KEYS.length} stages)`);
for (const brand of BRANDS) {
  console.log(`\n=== ${brand} ===  ${LEAK_NOTE[brand]}`);
  console.log(['stage'.padEnd(18), 'gen_z'.padStart(7), 'all'.padStart(8), 'all step%'.padStart(11)].join(''));
  let prevAll = null;
  for (const stage of STAGE_KEYS) {
    const gz = get(brand, 'gen_z', stage);
    const all = sumAll(brand, stage);
    const stepAll = prevAll == null ? 100 : (100 * all) / prevAll;
    console.log([stage.padEnd(18), String(gz).padStart(7), String(all).padStart(8), `${stepAll.toFixed(1)}%`.padStart(11)].join(''));
    prevAll = all;
  }
  const ovGz = (100 * get(brand, 'gen_z', 'purchase')) / get(brand, 'gen_z', 'add_to_cart');
  const ovAll = (100 * sumAll(brand, 'purchase')) / sumAll(brand, 'add_to_cart');
  console.log(`  overall conv — gen_z ${ovGz.toFixed(1)}%  ·  all ${ovAll.toFixed(1)}%`);
}
