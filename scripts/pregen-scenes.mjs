#!/usr/bin/env node
/**
 * pregen-scenes.mjs — pre-generate the demo's HEADLINE styled scenes so AI Search +
 * the Style Concierge are INSTANT on stage (no live latency for the scripted beats).
 * --------------------------------------------------------------------------------
 * What it does (VALIDATED against the real API 2026-06-25 — see
 *   docs/architecture/13-visual-ai-scenes-plan.md and scratchpad/validate-gemini-image.mjs):
 *   - For each curated {productId, sceneContext} it reads the REAL on-white product shot
 *     from public/images/<id>.{jpg,png}, sends it as a REFERENCE image to Gemini
 *     "nano banana" (gemini-3.1-flash-image) via the Generative Language REST API, and
 *     gets back a photorealistic editorial scene that PRESERVES the real bag.
 *   - Saves each scene as a static asset: public/images/generated/<key>.jpg
 *     (served directly by Cloudflare [assets] at /images/generated/<key>.jpg — zero
 *     runtime cost, survives redeploys), and writes a manifest the UI/route can read.
 *   - Optionally mirrors the same bytes into R2 (STORAGE) for the live-cache code path.
 *
 * Reference-image -> scene IS the whole point: text-to-image (Imagen / Flux / SDXL)
 * CANNOT keep the real product. Only the multimodal generateContent path can.
 *
 * Response shape (validated): candidates[0].content.parts[].inlineData.data = base64 image.
 * Per-image latency ~6-9s; each image bills a fixed ~1290-1385 output tokens (~$0.04 on
 * 2.5-flash-image; confirm current 3.1 pricing). Cost here is one-time/offline.
 *
 * Config (env first, then .dev.vars — NEVER printed): GEMINI_API_KEY, optional GEMINI_IMAGE_MODEL.
 *
 * Usage:
 *   node scripts/pregen-scenes.mjs                 # generate any missing scenes
 *   node scripts/pregen-scenes.mjs --force         # regenerate all
 *   node scripts/pregen-scenes.mjs --only=winter-wedding,work-look
 *   node scripts/pregen-scenes.mjs --r2            # also upload to R2 (needs wrangler auth)
 *   node scripts/pregen-scenes.mjs --r2 --local    # mirror into the local R2 (wrangler --local)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'public/images/generated');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const BUCKET = 'edge-platform-storage';            // wrangler.toml [[r2_buckets]] STORAGE
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const FORCE = process.argv.includes('--force');
const GRID_MODE = process.argv.includes('--grid');
const DO_R2 = process.argv.includes('--r2');
const R2_LOCAL = process.argv.includes('--local');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);

// ---- config (env first, then gitignored .dev.vars); never echo secrets ----
function fromFiles(name) {
  for (const f of ['.dev.vars', 'llm-models-keys.md']) {
    try {
      const m = readFileSync(join(REPO_ROOT, f), 'utf8').match(new RegExp('^' + name + '=(.+)$', 'm'));
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    } catch { /* ignore */ }
  }
  return '';
}
const cfg = (name) => (process.env[name] || fromFiles(name) || '').trim();
const KEY = cfg('GEMINI_API_KEY');
const MODEL = cfg('GEMINI_IMAGE_MODEL') || 'gemini-3.1-flash-image';
if (!KEY) { console.error('✘ GEMINI_API_KEY not set (env or .dev.vars).'); process.exit(1); }

// ---- catalog (for product names in the prompt) ----
const CATALOG = JSON.parse(readFileSync(join(REPO_ROOT, 'public/data/coach-catalog.json'), 'utf8')).products;
const byId = new Map(CATALOG.map((p) => [p.id, p]));
function refFor(id) {
  for (const ext of ['jpg', 'png', 'jpeg', 'webp']) {
    const p = join(REPO_ROOT, 'public/images', `${id}.${ext}`);
    if (existsSync(p)) return { path: p, mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
  }
  return null;
}

// ---- prompt templates (see plan §3 Prompt design) ----
const FIDELITY =
  'CRITICAL: Reproduce the EXACT bag shown in the reference image — identical shape, proportions, ' +
  'hardware, logo, stitching, color and leather texture. Do NOT redesign, recolor, or restyle the bag. ' +
  'It must read as the same product. Keep it the clear hero of the frame. No text, no watermarks, no extra logos.';

const searchHeroPrompt = (p, scene) =>
  `Wide cinematic editorial campaign banner. Place the provided Coach ${p.name} ${scene}. ` +
  `Premium fashion-magazine lighting, shallow depth of field, tasteful real-world props, refined on-brand palette, ` +
  `generous negative space on the left for a headline, photorealistic. ${FIDELITY}`;

const conciergeLookPrompt = (p, scene) =>
  `Editorial luxury lifestyle photograph, portrait orientation. Style the provided Coach ${p.name} as the centerpiece of ${scene}. ` +
  `Natural premium lighting, curated complementary props, aspirational but believable, photorealistic. ${FIDELITY}`;

// ---- curated headline scenes (grounded to REAL, image-backed catalog ids) ----
const SCENES = [
  // AI SEARCH — occasion "Edits" (16:9 heroes; map to the on-stage chips + doc-12 queries)
  { key: 'search-winter-wedding',   type: 'search', aspect: '16:9', productId: 'COA-CH857', query: 'bags for a winter wedding',
    scene: 'on a velvet bench beside a candlelit winter-wedding reception table — white roses, crystal, frosted window with soft snow and string lights' },
  { key: 'search-gift-150',         type: 'search', aspect: '16:9', productId: 'COA-CR554', query: 'a gift under $150',
    scene: 'as a thoughtful gift on a marble surface with elegant ribbon, tissue and a sprig of greenery, warm holiday light' },
  { key: 'search-work-tote',        type: 'search', aspect: '16:9', productId: 'COA-C4084', query: 'everyday work tote',
    scene: 'on a sunlit modern office desk with a laptop, notebook and coffee, a city skyline softly blurred through glass' },
  { key: 'search-travel-crossbody', type: 'search', aspect: '16:9', productId: 'COA-C1985', query: 'crossbody for travel under $300',
    scene: 'on a marble cafe table on a sun-dappled European street, espresso and a linen jacket nearby, cobblestones blurred behind' },
  { key: 'search-investment',       type: 'search', aspect: '16:9', productId: 'COA-CP133', query: 'an investment top-handle bag',
    scene: 'on a sculptural stone plinth in a minimalist gallery, single directional light, architectural shadows, quiet luxury' },
  { key: 'search-date-night',       type: 'search', aspect: '16:9', productId: 'COA-CY201', query: "a date-night bag that isn't black",
    scene: 'on a candlelit restaurant table at dusk, a glass of wine and soft bokeh city lights behind, intimate warm mood' },
  { key: 'search-festival',         type: 'search', aspect: '16:9', productId: 'COA-CBH23', query: 'a fun festival bag in a bold color',
    scene: 'at a golden-hour outdoor festival, string lights and a soft crowd bokeh, playful sunlit energy' },
  { key: 'search-everyday',         type: 'search', aspect: '16:9', productId: 'COA-CY201', query: 'everyday Tabby shoulder bag in a neutral',
    scene: 'on a linen-draped bench by a bright window with a coffee and an open book, calm everyday-luxury morning' },

  // STYLE CONCIERGE — styled "looks" (4:5 portrait moments)
  { key: 'look-winter-wedding',     type: 'concierge', aspect: '4:5', productId: 'COA-CH857', query: 'What should I carry to a winter wedding?',
    scene: 'a winter-wedding-guest look — beside a folded cashmere wrap and delicate gold jewelry on a velvet surface, candlelight' },
  { key: 'look-gift-200',           type: 'concierge', aspect: '4:5', productId: 'COA-CR554', query: 'I need a gift under $200',
    scene: 'an elegant gifting moment — nestled in tissue with ribbon and a handwritten card on a soft neutral surface' },
  { key: 'look-work',               type: 'concierge', aspect: '4:5', productId: 'COA-C4084', query: 'Build me a work look',
    scene: 'a polished workday look — with a tailored blazer, leather notebook and reading glasses on a warm walnut desk' },
  { key: 'look-travel',             type: 'concierge', aspect: '4:5', productId: 'COA-76197', query: 'put together a travel look',
    scene: 'a chic carry-on travel look — beside sunglasses, a passport and a linen scarf on a bright hotel-room bench' },
  { key: 'look-capsule-tabby',      type: 'concierge', aspect: '4:5', productId: 'COA-CH857', query: 'Build me a capsule around the Tabby 26',
    scene: 'a versatile capsule flat-lay — with a silk scarf, card case and sunglasses arranged on a soft neutral linen' },
  { key: 'look-brooklyn',           type: 'concierge', aspect: '4:5', productId: 'COA-CU044', query: 'I love the Brooklyn line — complete the look',
    scene: 'an effortless city look — with a trench coat and small leather goods on a textured stone surface, soft daylight' },
];

function selected() {
  let list = SCENES;
  if (ONLY.length) list = list.filter((s) => ONLY.includes(s.key) || ONLY.includes(s.key.replace(/^(search|look)-/, '')));
  return list;
}

async function generate(s) {
  const p = byId.get(s.productId);
  if (!p) return { ...s, ok: false, err: `product ${s.productId} not in catalog` };
  const ref = refFor(s.productId);
  if (!ref) return { ...s, ok: false, err: `no image for ${s.productId}` };
  const prompt = s.type === 'search' ? searchHeroPrompt(p, s.scene) : conciergeLookPrompt(p, s.scene);
  const body = {
    contents: [{ role: 'user', parts: [
      { text: prompt },
      { inline_data: { mime_type: ref.mime, data: readFileSync(ref.path).toString('base64') } },
    ] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: s.aspect } },
  };
  const t0 = Date.now();
  const r = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!r.ok) return { ...s, ok: false, ms, err: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const j = await r.json();
  const inline = (j.candidates?.[0]?.content?.parts || []).map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
  if (!inline) return { ...s, ok: false, ms, err: `no image (finish=${j.candidates?.[0]?.finishReason})` };
  const buf = Buffer.from(inline.data, 'base64');
  const file = join(OUT_DIR, `${s.key}.jpg`);
  writeFileSync(file, buf);
  if (DO_R2) {
    try {
      execSync(`npx wrangler r2 object put ${BUCKET}/scene/${s.key}.jpg --file="${file}" --content-type=image/jpeg ${R2_LOCAL ? '--local' : '--remote'}`,
        { cwd: REPO_ROOT, stdio: 'ignore' });
    } catch (e) { console.warn(`  ! R2 upload failed for ${s.key} (continuing): ${e.message?.slice(0, 120)}`); }
  }
  return { ...s, ok: true, ms, kb: Math.round(buf.length / 1024),
    asset: `/images/generated/${s.key}.jpg`, r2Key: `scene/${s.key}.jpg`,
    productName: p.name, usage: j.usageMetadata };
}

async function runCurated() {
  mkdirSync(OUT_DIR, { recursive: true });
  const list = selected();
  console.log(`pregen-scenes: model=${MODEL} scenes=${list.length} force=${FORCE} r2=${DO_R2}${DO_R2 && R2_LOCAL ? '(local)' : ''}\n`);
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const CONCURRENCY = 2;
  const results = [];
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY).filter((s) => {
      const exists = existsSync(join(OUT_DIR, `${s.key}.jpg`));
      if (exists && !FORCE) { console.log(`= skip ${s.key} (exists; --force to regen)`); results.push({ ...s, ok: true, skipped: true }); return false; }
      return true;
    });
    const done = await Promise.all(batch.map(generate));
    for (const r of done) {
      if (r.ok) {
        console.log(`✔ ${r.key.padEnd(24)} ${String(r.ms).padStart(5)}ms  ${String(r.kb).padStart(4)}KB  ${r.aspect}  ${r.productId} (${r.productName})`);
        manifest[r.key] = { key: r.key, type: r.type, query: r.query, productId: r.productId, productName: r.productName,
          aspect: r.aspect, asset: r.asset, r2Key: r.r2Key, model: MODEL, generatedAt: new Date().toISOString() };
      } else {
        console.error(`✘ ${r.key.padEnd(24)} ${r.err}`);
      }
      results.push(r);
    }
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  const okc = results.filter((r) => r.ok && !r.skipped).length;
  const gens = results.filter((r) => r.ok && !r.skipped && r.ms);
  const avg = gens.length ? Math.round(gens.reduce((a, r) => a + r.ms, 0) / gens.length) : 0;
  console.log(`\nDone: ${okc} generated, ${results.filter((r) => r.skipped).length} skipped, ${results.filter((r) => !r.ok).length} failed. avg ${avg}ms/img. Manifest -> ${MANIFEST}`);
}

/* ════════════════════════════════════════════════════════════════════════════
 * GRID MODE (--grid) — the occasion × SKU scene grid.
 * For each occasion we rank the REAL catalog and pre-generate the top-N hero BAGS
 * styled for that occasion, so the storefront's Edit hero is BOTH instant AND
 * product-accurate (it can match the shopper's personalized #1, not a fixed anchor),
 * and so many more typed/off-script queries resolve to a verified scene (no live wait).
 * Output: public/images/generated/grid/<key>.jpg + scene-grid.json (additive; the
 * curated manifest.json is untouched). Keys: search-<occ>-<id> / look-<occ>-<id>.
 * ════════════════════════════════════════════════════════════════════════════ */
const GRID_DIR = join(OUT_DIR, 'grid');
const GRID_MANIFEST = join(OUT_DIR, 'scene-grid.json');
const SEARCH_N = parseInt((process.argv.find((a) => a.startsWith('--searchN=')) || '--searchN=2').split('=')[1], 10);
const CC_N = parseInt((process.argv.find((a) => a.startsWith('--ccN=')) || '--ccN=1').split('=')[1], 10);

// occasion → { ranking tags (catalog occasion tags), search scene (16:9), concierge scene (4:5) }
const GRID = [
  { occ: 'winter-wedding', tags: ['special-occasion', 'evening'],
    search: 'on a velvet bench beside a candlelit winter-wedding reception — white roses, crystal, a frosted window with soft snow and string lights',
    cc: 'a winter-wedding-guest look — a folded cashmere wrap and delicate gold jewelry on a velvet surface, candlelight' },
  { occ: 'work', tags: ['work'],
    search: 'on a sunlit modern office desk with a laptop, notebook and coffee, a city skyline softly blurred through glass',
    cc: 'a polished workday look — a tailored blazer, leather notebook and reading glasses on a warm walnut desk' },
  { occ: 'travel', tags: ['travel'],
    search: 'on a marble cafe table on a sun-dappled European street, espresso and a linen jacket nearby, cobblestones blurred behind',
    cc: 'a chic carry-on travel look — sunglasses, a passport and a linen scarf on a bright hotel-room bench' },
  { occ: 'investment', tags: ['special-occasion', 'evening'],
    search: 'on a sculptural stone plinth in a minimalist gallery, single directional light, architectural shadows, quiet luxury',
    cc: 'a quiet-luxury capsule — a silk scarf and fine leather goods arranged on soft neutral linen' },
  { occ: 'date-night', tags: ['date-night', 'evening'],
    search: 'on a candlelit restaurant table at dusk, a glass of wine and soft bokeh city lights behind, intimate warm mood',
    cc: 'an elegant date-night look — fine jewelry and a silk wrap on a dark table, candlelight' },
  { occ: 'festival', tags: ['festival'],
    search: 'at a golden-hour outdoor festival, string lights and a soft crowd bokeh, playful sunlit energy',
    cc: 'a festival look — sunglasses, a woven hat and bright accessories on warm timber, golden hour' },
  { occ: 'everyday', tags: ['everyday'],
    search: 'on a linen-draped bench by a bright window with a coffee and an open book, calm everyday-luxury morning',
    cc: 'an everyday look — a soft knit, sunglasses and a card case on neutral linen, morning light' },
  // ── new occasions — broad "type anything" coverage so off-script queries are instant ──
  { occ: 'cocktail', tags: ['evening', 'date-night'],
    search: 'at a chic cocktail party, a coupe glass and soft golden bokeh, refined evening glamour',
    cc: 'a cocktail-party look — a statement earring and a satin wrap on dark marble, warm bokeh' },
  { occ: 'gala', tags: ['special-occasion', 'evening'],
    search: 'on a marble ledge at a black-tie gala, a dramatic chandelier and deep shadows, opulent evening',
    cc: 'a black-tie look — fine jewelry and a satin wrap on dark velvet, chandelier light' },
  { occ: 'beach-resort', tags: ['travel', 'everyday'],
    search: 'on a white-sand beach lounge at golden hour, linen and soft palm shadows, resort luxury',
    cc: 'a resort look — a straw hat, sunglasses and a linen kaftan on a sun-bleached lounger' },
  { occ: 'brunch', tags: ['everyday'],
    search: 'at a sunlit weekend brunch table with fresh flowers, pastries and coffee, airy and bright',
    cc: 'a weekend-brunch look — sunglasses and a light knit on a bright cafe table with fresh flowers' },
  { occ: 'opera', tags: ['evening', 'special-occasion'],
    search: 'on plush burgundy theater velvet with a printed program and gilded opera glasses, dim elegant light',
    cc: 'an opera-night look — long gloves and fine jewelry on burgundy velvet, warm low light' },
  { occ: 'gallery', tags: ['evening', 'special-occasion'],
    search: 'on a white pedestal in a contemporary gallery beside a minimalist modern sculpture, soft directional light',
    cc: 'a gallery-opening look — minimalist jewelry and a structured coat on pale concrete, cool daylight' },
];

function rankBagsForOccasion(tags, n) {
  const bags = CATALOG.filter((p) => p.category === 'Handbags' && p.in_stock !== false && refFor(p.id));
  const scored = bags.map((p) => {
    let s = 0; const occ = p.occasion || [];
    tags.forEach((t) => { if (occ.includes(t)) s += 1; });
    s += Math.min(p.price_usd || 0, 800) / 4000;                 // mild elevation proxy (deterministic)
    return { p, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id));
  const out = [], perLine = {};
  for (const { p } of scored) {
    if ((perLine[p.line] || 0) >= 2) continue;                   // line diversity → varied heroes
    perLine[p.line] = (perLine[p.line] || 0) + 1; out.push(p);
    if (out.length >= n) break;
  }
  return out.length ? out : scored.slice(0, n).map((x) => x.p);
}

async function generateGridItem(type, occ, p, sceneText, aspect) {
  const ref = refFor(p.id);
  const prompt = type === 'search' ? searchHeroPrompt(p, sceneText) : conciergeLookPrompt(p, sceneText);
  const key = `${type === 'search' ? 'search' : 'look'}-${occ}-${p.id}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: ref.mime, data: readFileSync(ref.path).toString('base64') } }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
  };
  const t0 = Date.now();
  const r = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!r.ok) return { key, ok: false, ms, err: `HTTP ${r.status}: ${(await r.text()).slice(0, 160)}` };
  const j = await r.json();
  const inline = (j.candidates?.[0]?.content?.parts || []).map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
  if (!inline) return { key, ok: false, ms, err: `no image (finish=${j.candidates?.[0]?.finishReason})` };
  const buf = Buffer.from(inline.data, 'base64');
  writeFileSync(join(GRID_DIR, `${key}.jpg`), buf);
  return { key, ok: true, ms, kb: Math.round(buf.length / 1024), type: type === 'search' ? 'search' : 'concierge', occ, productId: p.id, productName: p.name, aspect, asset: `/images/generated/grid/${key}.jpg` };
}

async function runGrid() {
  mkdirSync(GRID_DIR, { recursive: true });
  const manifest = existsSync(GRID_MANIFEST) ? JSON.parse(readFileSync(GRID_MANIFEST, 'utf8')) : {};
  const tasks = [];
  for (const g of GRID) {
    rankBagsForOccasion(g.tags, SEARCH_N).forEach((p) => tasks.push({ type: 'search', occ: g.occ, p, scene: g.search, aspect: '16:9' }));
    rankBagsForOccasion(g.tags, CC_N).forEach((p) => tasks.push({ type: 'concierge', occ: g.occ, p, scene: g.cc, aspect: '4:5' }));
  }
  console.log(`pregen GRID: model=${MODEL} occasions=${GRID.length} tasks=${tasks.length} searchN=${SEARCH_N} ccN=${CC_N} force=${FORCE}\n`);
  const CONC = 3; let done = 0, fail = 0, skip = 0;
  for (let i = 0; i < tasks.length; i += CONC) {
    const batch = tasks.slice(i, i + CONC).filter((t) => {
      const key = `${t.type === 'search' ? 'search' : 'look'}-${t.occ}-${t.p.id}`;
      if (existsSync(join(GRID_DIR, `${key}.jpg`)) && !FORCE) {
        manifest[key] = manifest[key] || { key, type: t.type === 'search' ? 'search' : 'concierge', occ: t.occ, productId: t.p.id, productName: t.p.name, aspect: t.aspect, asset: `/images/generated/grid/${key}.jpg` };
        console.log(`= skip ${key}`); skip++; return false;
      }
      return true;
    });
    const res = await Promise.all(batch.map((t) => generateGridItem(t.type, t.occ, t.p, t.scene, t.aspect)));
    for (const r of res) {
      if (r.ok) { manifest[r.key] = { key: r.key, type: r.type, occ: r.occ, productId: r.productId, productName: r.productName, aspect: r.aspect, asset: r.asset }; console.log(`✔ ${r.key.padEnd(36)} ${String(r.ms).padStart(5)}ms ${String(r.kb).padStart(4)}KB`); done++; }
      else { console.error(`✘ ${r.key.padEnd(36)} ${r.err}`); fail++; }
    }
    writeFileSync(GRID_MANIFEST, JSON.stringify(manifest, null, 2));   // checkpoint each batch
  }
  console.log(`\nGrid done: ${done} generated, ${skip} skipped, ${fail} failed. ${Object.keys(manifest).length} entries -> ${GRID_MANIFEST}`);
}

(async () => { if (GRID_MODE) return runGrid(); return runCurated(); })()
  .catch((e) => { console.error('FATAL', e); process.exit(1); });
