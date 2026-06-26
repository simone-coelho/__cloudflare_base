#!/usr/bin/env node
/**
 * validate-search.mjs — pre-demo certainty check for AI Search + the Style Concierge.
 * --------------------------------------------------------------------------------
 * Simulates EXACTLY what the storefront does when a presenter opens Search/Concierge and types:
 *   1) POST /ai/search (real Gemini intent + editorial copy + ranked REAL catalog)
 *   2) resolve the scene the SAME way the client does:
 *        exact chip → occasion×SKU GRID (product-accurate) → original curated anchor → LIVE
 *   3) (with --live) POST /ai/scene for genuinely off-script queries and save the image to inspect.
 *
 * The _deriveOccasion / _anchorKey / sceneFor logic below MUST stay in parity with public/storefront.js.
 *
 * Usage:
 *   node scripts/validate-search.mjs                  # fast: confirms curated queries are INSTANT + stable
 *   node scripts/validate-search.mjs --live           # also live-generate any off-script (Tier B) scenes
 *   node scripts/validate-search.mjs --base=https://… # target a different deployment
 *   node scripts/validate-search.mjs --runs=3         # stability repeats per curated query (default 2)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const BASE = (arg('base', 'https://edge-platform.expedge.workers.dev')).replace(/\/$/, '');
const LIVE = process.argv.includes('--live');
const RUNS = parseInt(arg('runs', '2'), 10);
const OUT = join(ROOT, 'public/images/generated/_validation');

// ── ported verbatim from public/storefront.js (keep in parity) ──
const normQ = (s) => (s || '').toLowerCase().trim().replace(/[?!.…]+$/g, '').trim();
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
function deriveOccasion(query, intent, type) {
  const q = (query || '').toLowerCase();
  const occ = new Set((intent && intent.occasions) || []);
  const gift = (intent && intent.giftMode) || /\b(gift|present|for (her|him|mom|dad|a friend))\b/.test(q);
  const band = intent && intent.priceBand;
  const cc = type === 'concierge';
  const has = (re) => re.test(q);
  if (has(/winter wedding/)) return 'winter-wedding';
  if (gift) return 'gift';
  if (cc && has(/\bcapsule\b/)) return 'capsule';
  if (cc && has(/\bbrooklyn\b/)) return 'brooklyn';
  if (has(/\bcocktail\b/)) return 'cocktail';
  if (has(/\b(gala|black.?tie)\b/)) return 'gala';
  if (has(/\b(opera|theat(er|re)|symphony|ballet|philharmonic)\b/)) return 'opera';
  if (has(/\b(gallery|exhibition|art (opening|show|fair)|museum|vernissage)\b/)) return 'gallery';
  if (has(/\b(beach|resort|poolside|tropical|honeymoon|yacht|seaside|cruise)\b/)) return 'beach-resort';
  if (has(/\bbrunch\b/)) return 'brunch';
  if (has(/\b(work|office|commute|desk|laptop|9 ?to ?5)\b/)) return 'work';
  if (has(/\b(travel|trip|vacation|carry.?on|getaway|weekend away)\b/)) return 'travel';
  if (has(/\b(investment|splurge|heirloom|timeless|quiet luxury|high[- ]end)\b/)) return 'investment';
  if (has(/\b(festival|concert)\b/)) return 'festival';
  if (has(/\b(date night|date-night|night out)\b/)) return 'date-night';
  if (has(/\b(everyday|daily|casual)\b/)) return 'everyday';
  if (occ.has('winter') && (occ.has('special-occasion') || occ.has('evening'))) return 'winter-wedding';
  if (occ.has('work')) return 'work';
  if (occ.has('travel')) return 'travel';
  if (occ.has('festival')) return 'festival';
  if (occ.has('date-night')) return 'date-night';
  if (band === 'elevated') return 'investment';
  if (occ.has('everyday')) return 'everyday';
  if (cc && (occ.has('special-occasion') || occ.has('evening'))) return 'winter-wedding';
  return null;
}
const anchorKey = (occ, type) => {
  const S = { 'winter-wedding': 'search-winter-wedding', gift: 'search-gift-150', work: 'search-work-tote', travel: 'search-travel-crossbody', investment: 'search-investment', 'date-night': 'search-date-night', festival: 'search-festival', everyday: 'search-everyday' };
  const L = { 'winter-wedding': 'look-winter-wedding', gift: 'look-gift-200', work: 'look-work', travel: 'look-travel', capsule: 'look-capsule-tabby', brooklyn: 'look-brooklyn' };
  return (type === 'concierge' ? L : S)[occ] || null;
};
function sceneFor(manifest, gridByOcc, query, intent, type, heroId) {
  const nq = normQ(query);
  for (const k in manifest) { if (manifest[k] && manifest[k].type === type && normQ(manifest[k].query) === nq) return { ...manifest[k], _via: 'chip' }; }
  const occ = deriveOccasion(query, intent, type);
  if (occ) {
    const list = (gridByOcc[type] && gridByOcc[type][occ]) || null;
    if (list && list.length) { const hit = (heroId && list.find((e) => e.productId === heroId)) || list[0]; return { ...hit, occ, _via: heroId && hit.productId === heroId ? 'grid·exact' : 'grid' }; }
    const ak = anchorKey(occ, type);
    if (ak && manifest[ak] && manifest[ak].type === type) return { ...manifest[ak], occ, _via: 'anchor' };
  }
  return null;
}
const search = (query) => fetch(`${BASE}/ai/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, limit: 9, affinity: {} }) }).then((r) => r.json());
const genScene = (p) => fetch(`${BASE}/ai/scene`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then((r) => r.json());

// ── CURATED query sets (see docs/search-query-catalog.md) ──
const TIER_A_SEARCH = [
  'bags for a winter wedding', 'what should I wear to a winter wedding', 'a gift under $150', 'a holiday gift for my sister',
  'everyday work tote', 'a bag for the office', 'a crossbody for travel', 'an investment bag', 'a date night bag',
  'a fun festival bag', 'an everyday neutral shoulder bag',
  // new occasions added by the grid
  'a cocktail party bag', 'a black-tie gala bag', 'something elegant for the opera', 'a bag for a gallery opening',
  'a bag for a beach resort vacation', 'a weekend brunch bag', 'a bold bag for a yacht party',
];
const CONCIERGE = [
  'What should I carry to a winter wedding?', 'I need a gift under $200', 'Build me a work look', 'put together a travel look',
  'Build me a capsule around the Tabby 26', "I love the Brooklyn line — complete the look",
  'what should I wear to the opera?', 'style me for a gallery opening',
];
const TIER_B_SEARCH = [   // deliberately off-script — should LIVE-generate (no grid occasion)
  'a bag for my college graduation ceremony', 'a whimsical bag for a garden tea party',
];

async function curated(label, list, type, manifest, gridByOcc) {
  console.log(`\n=== ${label} — must be INSTANT (grid/anchor) + STABLE across ${RUNS} runs ===`);
  let ok = 0;
  for (const q of list) {
    const seen = [];
    let via = '';
    for (let i = 0; i < RUNS; i++) {
      const r = await search(q);
      const sc = sceneFor(manifest, gridByOcc, q, r.intent, type, r.hero && r.hero.productId);
      seen.push(sc ? `${sc.occ || sc.key}` : 'LIVE'); if (sc) via = sc._via;
    }
    const stable = seen.every((x) => x === seen[0]);
    const instant = seen.every((x) => x !== 'LIVE');
    if (stable && instant) ok++;
    console.log(`${stable && instant ? '✅' : '⚠️ '} ${(stable ? 'STABLE' : 'VARIES').padEnd(7)} ${String(seen[0]).padEnd(15)} ${via.padEnd(11)} ← "${q}"`);
  }
  console.log(`   → ${ok}/${list.length} instant & stable`);
  return ok === list.length;
}

async function main() {
  console.log(`validate-search: BASE=${BASE} live=${LIVE}`);
  const manifest = await fetch(`${BASE}/images/generated/manifest.json`).then((r) => r.json());
  const grid = await fetch(`${BASE}/images/generated/scene-grid.json`).then((r) => r.json()).catch(() => ({}));
  const gridByOcc = { search: {}, concierge: {} };
  for (const k in grid) { const e = grid[k]; const t = e.type === 'concierge' ? 'concierge' : 'search'; (gridByOcc[t][e.occ] = gridByOcc[t][e.occ] || []).push({ productId: e.productId, asset: e.asset, productName: e.productName }); }
  console.log(`grid: ${Object.keys(grid).length} scenes · search occasions=${Object.keys(gridByOcc.search).length} · concierge occasions=${Object.keys(gridByOcc.concierge).length}`);

  const a = await curated('TIER A · SEARCH', TIER_A_SEARCH, 'search', manifest, gridByOcc);
  const c = await curated('CONCIERGE', CONCIERGE, 'concierge', manifest, gridByOcc);

  console.log(`\n=== TIER B · SEARCH — off-script (grid if covered, else LIVE) ===`);
  if (LIVE) mkdirSync(OUT, { recursive: true });
  for (const q of TIER_B_SEARCH) {
    const r = await search(q);
    const sc = sceneFor(manifest, gridByOcc, q, r.intent, 'search', r.hero && r.hero.productId);
    if (sc) { console.log(`• INSTANT (${sc._via} ${sc.occ}) ← "${q}"`); continue; }
    if (!LIVE) { console.log(`• LIVE (would generate) ← "${q}"`); continue; }
    const sceneId = (deriveOccasion(q, r.intent, 'search') && `search-${deriveOccasion(q, r.intent, 'search')}`) || ('q-' + slug(q));
    const t0 = Date.now();
    const g = await genScene({ productId: r.hero.productId, sceneId, type: 'search', sceneContext: r.intent.sceneContext, aspect: '16:9' });
    let note = g.ok ? '' : `FAILED: ${g.error}`;
    if (g.ok && g.url) { const buf = Buffer.from(await fetch(`${BASE}${g.url}`).then((x) => x.arrayBuffer())); writeFileSync(join(OUT, `${slug(q)}.jpg`), buf); note = `${Math.round(buf.length / 1024)}KB`; }
    console.log(`${g.ok ? '✅' : '❌'} LIVE ${(Date.now() - t0)}ms "${r.intent.headline}" ${note} ← "${q}"`);
  }

  console.log(`\n${a && c ? '✅ ALL CURATED QUERIES INSTANT & STABLE' : '⚠️ some curated queries not guaranteed — review above'}`);
  process.exit(a && c ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
