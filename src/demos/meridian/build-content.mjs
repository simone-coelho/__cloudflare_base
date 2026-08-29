// src/demos/meridian/build-content.mjs
//
// Generates the CONTENT catalogue's artwork ONCE, at design time, into
// public/meridian/content/<customerContentId>.jpg — one landscape editorial
// card per retail piece, with the piece's REAL product composited in from its
// committed packshot (public/meridian/img/*.jpg as inline_data reference + the
// fidelity clause), exactly the way build-scenes.mjs makes the scene plates.
// Nothing here happens at runtime: generate, inspect, reject, commit. The
// financial pieces are text-only by design (art: null) and are skipped.
//
// References are picked by FAMILY-NAME SUBSTRING, never by catalogue id — the
// build-scenes rule — so a card cannot orphan if ids are reassigned.
//
//   GEMINI_API_KEY=... node src/demos/meridian/build-content.mjs
//   node src/demos/meridian/build-content.mjs --only=CMP-1004,CMP-1012 --force
//
// Review every output with your own eyes before committing. Reject anything
// with text or lettering, a face, or a product that does not match its
// reference, and regenerate with --only=<customerContentId> --force.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
const IMG_DIR = 'public/meridian/img';
const OUT_DIR = 'public/meridian/content';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const MAX_BYTES = 200 * 1024;           // 18 cards must stay well under 4MB total
const WIDTH = 1200;                     // 16:9 content card
const HEIGHT = 675;

const key = process.env.GEMINI_API_KEY
  || (existsSync('.dev.vars')
      ? (readFileSync('.dev.vars', 'utf8').match(/GEMINI_API_KEY\s*=\s*"?([^"'\s]+)/) || [])[1]
      : undefined);
if (!key) { console.error('No GEMINI_API_KEY in env or .dev.vars'); process.exit(1); }

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const force = args.includes('--force');

const pieces = JSON.parse(readFileSync('src/demos/meridian/content.catalog.json', 'utf8'));
const catalogue = JSON.parse(readFileSync('src/demos/meridian/catalog.retail.json', 'utf8'));
const financialCat = JSON.parse(readFileSync('src/demos/meridian/catalog.financial.json', 'utf8'));

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE BEFORE GENERATING — the same guard content.ts runs at module load,
// mirrored here so a tag outside the live registry vocabulary fails the build
// before it costs a single generation. Band labels and stage labels are the
// registry's configured values (reflexConfig.ts); everything else is read off
// the live catalogue items.
// ─────────────────────────────────────────────────────────────────────────────
const CONTENT_TYPES = ['on-model', 'silo', 'editorial', 'video', 'guide', 'calculator', 'rate-table', 'explainer'];
const SLOTS = ['chero', 'carousel', 'story', 'merch'];
const KINDS = ['editorial', 'guide', 'lookbook', 'film', 'campaign'];

function vocabFrom(items, spec) {
  const vocab = {};
  for (const [dim, src] of Object.entries(spec.fromItems)) {
    const set = new Set();
    for (const item of items) {
      const raw = item[src];
      if (Array.isArray(raw)) raw.forEach((v) => typeof v === 'string' && set.add(v));
      else if (typeof raw === 'string') set.add(raw);
    }
    vocab[dim] = set;
  }
  for (const [dim, values] of Object.entries(spec.fixed)) vocab[dim] = new Set(values);
  return vocab;
}

const VOCAB = {
  retail: vocabFrom(catalogue, {
    fromItems: { category: 'category', line: 'line', styleWorld: 'world', colour: 'colour', occasion: 'needs' },
    fixed: {
      priceBand: ['entry', 'core', 'premium'],
      contentType: CONTENT_TYPES,
      journeyStage: ['browsing', 'considering', 'deciding'],
    },
  }),
  financial: vocabFrom(financialCat, {
    fromItems: { productFamily: 'category', subFamily: 'subcategory', lifeStage: 'world', tier: 'tier', intent: 'needs' },
    fixed: {
      amountBand: ['modest', 'core', 'major'],
      contentType: CONTENT_TYPES,
      applicationStage: ['exploring', 'comparing', 'applying'],
    },
  }),
};

let bad = 0;
for (const p of pieces) {
  const who = `${p.customerContentId} (${p.vertical})`;
  const vocab = VOCAB[p.vertical];
  if (!vocab) { console.error(`INVALID ${who}: unknown vertical`); bad++; continue; }
  if (!KINDS.includes(p.type)) { console.error(`INVALID ${who}: type "${p.type}"`); bad++; }
  if (p.type === 'film' && !/^\d+:\d{2}$/.test(p.runtime || '')) { console.error(`INVALID ${who}: film without runtime`); bad++; }
  for (const s of p.slotTypes || []) if (!SLOTS.includes(s)) { console.error(`INVALID ${who}: slot "${s}"`); bad++; }
  for (const [dim, values] of Object.entries(p.tags || {})) {
    if (!vocab[dim]) { console.error(`INVALID ${who}: dimension "${dim}" is not in the ${p.vertical} registry`); bad++; continue; }
    for (const v of values) if (!vocab[dim].has(v)) { console.error(`INVALID ${who}: ${dim}="${v}" is not in the live vocabulary`); bad++; }
  }
}
if (bad) { console.error(`\n${bad} tag/schema problem(s) — fix content.catalog.json before generating.`); process.exit(1); }
console.log('catalogue validated: every tag speaks the live registry vocabulary\n');

// ─────────────────────────────────────────────────────────────────────────────
// One scene per retail piece: the real product (found by family-name substring,
// refined by `prefer`) placed in an editorial context that reads as the piece's
// story. The Calder look everywhere: natural light, quiet, unhurried.
// ─────────────────────────────────────────────────────────────────────────────
const SCENES = {
  'CMP-1001': {
    family: 'Drover', prefer: ['olive'],
    context: 'hanging from a single iron hook on a limewashed plaster wall, gently worn in with years of honest '
      + 'creasing at the elbows, low afternoon window light raking across the waxed canvas',
  },
  'CMP-1002': {
    // First take: the boot props came back as lace-ups, but the only boot this
    // house sells is an elastic-sided chelsea — the props now say so.
    family: 'Fenwick Fisherman', prefer: ['cream'],
    context: 'folded neatly on a worn oak bench beside a pair of plain brown leather chelsea boots with elastic '
      + 'side gores and no laces, and a simple canvas tote, soft grey morning light, a styling still life '
      + 'about what completes the sweater',
  },
  'CMP-1003': {
    // First take: blurred customers appeared at the cafe across the street —
    // people, a reject (the black-tie plate's lesson). The street is now empty.
    family: 'Linden Leather Crossbody', prefer: ['tan'],
    context: 'resting on a small marble cafe table beside a white espresso cup, bright city morning light through '
      + 'a window, strap loosely coiled, the street and pavement beyond the glass completely EMPTY — '
      + 'not a single person, passer-by or silhouette anywhere, even blurred — no paper goods on the table',
  },
  'CMP-1004': {
    family: 'Aster', prefer: ['navy print'],
    context: 'caught mid-air in an elegant unfurling drape above a deep charcoal velvet surface, cinematic side '
      + 'light, the silk translucent at its edges, a film still about how a scarf moves',
  },
  'CMP-1005': {
    family: 'Halden Signet', prefer: ['gold'],
    context: 'on polished black marble at an evening table — beside a champagne coupe and a loosely draped dark '
      + 'silk square, warm candlelight and deep chandelier bokeh in a completely empty room, formal and nocturnal',
  },
  'CMP-1006': {
    family: 'Halden Signet', prefer: ['silver'],
    context: 'presented on a small tray lined with natural undyed linen, a plain open ring box beside it, precise '
      + 'soft daylight from one side, a jeweller’s quiet workbench with no tools and no markings',
  },
  'CMP-1007': {
    family: 'Fenwick Fisherman', prefer: ['charcoal'],
    context: 'folded on snow-dusted dark slate among sprigs of winter pine and plain kraft-paper parcels tied '
      + 'with cream ribbon, cold clear winter light, a seasonal sale still with generous empty space on the left',
  },
  'CMP-1008': {
    // First take: a white packing card with faint printed lines sat inside the
    // open bag — quasi-text, a reject. The bag now holds folded cloth only.
    family: 'Holloway', prefer: ['green'],
    context: 'sitting open but tidy on crisp white hotel bed linen, holding only folded plain garments — '
      + 'no paper, no cards, no tags, no labels of any kind inside or on it — a folded grey wool blanket and a '
      + 'pair of rolled dark socks beside it, soft coastal morning light through sheer curtains, nothing '
      + 'electronic anywhere, packed for two days away',
  },
  'CMP-1009': {
    family: 'Shorewell', prefer: ['slate'],
    context: 'hanging on a slim matte-black rail in front of a tall window streaked with heavy rain, cool grey '
      + 'daylight, drops beading on the technical fabric, the city soft and wet beyond the glass',
  },
  'CMP-1010': {
    family: 'Ridgeline Court', prefer: ['white'],
    context: 'placed side by side on pale poured concrete next to a plain natural canvas tote bag, flat even '
      + 'skylight, generous empty ground around them, a minimal styling still about what to carry',
  },
  'CMP-1011': {
    // First take: the sweater grew a dark neck label with tiny quasi-text, and
    // a compass dial crept in — both rejects. Labels and instruments now banned.
    family: 'Drover', prefer: ['tan'],
    context: 'laid flat on wide oak floorboards in a careful editorial flat-lay with a folded cream cable-knit '
      + 'sweater and a pair of plain brown leather boots arranged beside it, warm natural light from a tall '
      + 'window — the boots plain brown leather chelsea boots with elastic side gores and no laces, every '
      + 'garment entirely label-free, no neck tags, no woven labels, and no instruments, dials, watches or '
      + 'compasses among the props',
  },
  'CMP-1012': {
    family: 'Solstice Smoked Vetiver', prefer: [],
    context: 'standing on dark honed marble in near-darkness, one low candle flame off to the side, a single '
      + 'sharp rim of warm light tracing the glass, deep shadow all around, nocturnal and quiet',
  },
  'CMP-1013': {
    family: 'Solstice Amber Absolute', prefer: [],
    context: 'at the centre of a gifting still life — plain kraft-paper boxes tied with cream ribbon, a sprig of '
      + 'winter greenery, soft warm candlelight, the considered present among the wrapped ones',
  },
  'CMP-1014': {
    family: 'Linden Structured Tote', prefer: ['tan'],
    context: 'standing on a leatherworker’s heavy wooden bench beside a rolled hide of matching tan leather '
      + 'and a coil of waxed thread, warm workshop light, the craft of its making implied around it',
  },
  'CMP-1015': {
    family: 'Fenwick Merino', prefer: ['navy'],
    context: 'folded precisely on a pale grey ceramic surface with a slate-grey technical shell folded beneath it '
      + 'and white canvas sneakers aligned beside, flat even light, a quiet capsule-wardrobe still',
  },
  'CMP-1016': {
    family: 'Harlow', prefer: ['tortoise'],
    context: 'resting on sun-bleached rumpled linen beside a plain woven straw hat, hard bright Mediterranean '
      + 'sunlight casting long sharp shadows, the light of somewhere hot and far away',
  },
  'CMP-1017': {
    family: 'Fenwick Fisherman', prefer: ['oatmeal'],
    context: 'in a neat stack of folded knitwear on a linen-lined shelf with two small blocks of plain cedar wood '
      + 'resting beside it, soft diffuse daylight, calm and orderly, a still about care',
  },
  'CMP-1018': {
    family: 'Holloway', prefer: ['navy'],
    context: 'in a tonal navy still life — set on a deep navy linen cloth beside a folded navy merino sweater, '
      + 'every element a close shade of the same colour, soft directional daylight, one colour studied quietly',
  },
};

/** First item whose name contains the family; `prefer` substrings refine within it. */
function leadFor(spec) {
  const named = (subs) => catalogue.filter(
    (i) => subs.every((s) => i.name.toLowerCase().includes(s.toLowerCase())));
  for (const p of spec.prefer) {
    const hit = named([spec.family, p]);
    if (hit.length) return hit[0];
  }
  const family = named([spec.family]);
  return family[0] ?? null;
}

/** The real packshot, whatever extension the pipeline left it with. */
function referenceFor(item) {
  for (const ext of ['jpg', 'png', 'jpeg', 'webp']) {
    const p = join(IMG_DIR, `${item.id}.${ext}`);
    if (existsSync(p)) {
      return { data: readFileSync(p).toString('base64'), mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
    }
  }
  return null;
}

// The scene-plate fidelity clause, verbatim in spirit: the referenced product
// must read as itself, and nothing that would sink a card on stage may appear.
const FIDELITY =
  'CRITICAL: Reproduce the EXACT item shown in the reference image — identical shape, proportions, '
  + 'hardware, colour, material and texture. Do NOT redesign, recolor, or restyle it. It must read as '
  + 'the same product, and stay the clear hero of the frame. No people, no faces, no hands, no text, '
  + 'no lettering, no numbers, no labels, no watermarks, no logos.';

const promptFor = (item, context) =>
  `Landscape editorial photograph for a quiet luxury fashion journal. Place the provided ${item.name} ${context}. `
  + 'Natural light, editorial and unhurried, shallow depth of field, tasteful real-world props, refined '
  + 'muted palette, photorealistic, understated — the same brand photographed everything on one calm afternoon. '
  + FIDELITY;

async function generate(item, context) {
  const ref = referenceFor(item);
  if (!ref) return { ok: false, why: `no packshot for ${item.id} in ${IMG_DIR}` };
  const r = await fetch(`${GLAPI}/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: promptFor(item, context) },
        { inline_data: { mime_type: ref.mime, data: ref.data } },
      ] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
    }),
  });
  if (!r.ok) return { ok: false, why: `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 140)}` };
  const j = await r.json();
  const part = (j?.candidates?.[0]?.content?.parts || [])
    .map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
  if (!part?.data) return { ok: false, why: `no image (finish=${j?.candidates?.[0]?.finishReason})` };
  return { ok: true, bytes: Buffer.from(part.data, 'base64') };
}

/** 1200×675, under the per-card budget — quality steps down until it fits. */
async function toCard(bytes) {
  for (const quality of [78, 70, 62, 55, 48]) {
    const out = await sharp(bytes)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }
  throw new Error('could not fit under 200KB even at quality 48');
}

mkdirSync(OUT_DIR, { recursive: true });
const withArt = pieces.filter((p) => p.vertical === 'retail' && p.art);
const wanted = only.length ? withArt.filter((p) => only.includes(p.customerContentId)) : withArt;
console.log(`model ${MODEL} · ${wanted.length} card(s)\n`);

for (const piece of wanted) {
  const path = join(OUT_DIR, `${piece.customerContentId}.jpg`);
  if (existsSync(path) && !force) {
    console.log(`  skip   ${piece.customerContentId}  (exists — pass --force to redo)`);
    continue;
  }
  const spec = SCENES[piece.customerContentId];
  if (!spec) { console.log(`  FAIL   ${piece.customerContentId}  no scene spec in this script`); continue; }
  const item = leadFor(spec);
  if (!item) { console.log(`  FAIL   ${piece.customerContentId}  no catalogue item matches family "${spec.family}"`); continue; }
  const t0 = Date.now();
  const res = await generate(item, spec.context);
  if (!res.ok) { console.log(`  FAIL   ${piece.customerContentId}  ${res.why}`); continue; }
  try {
    writeFileSync(path, await toCard(res.bytes));
  } catch (e) {
    console.log(`  FAIL   ${piece.customerContentId}  ${e.message}`);
    continue;
  }
  const kb = Math.round(statSync(path).size / 1024);
  console.log(`  wrote  ${piece.customerContentId}  ${String(kb).padStart(4)}KB  ${Date.now() - t0}ms  ref: ${item.id} ${item.name}  · ${piece.title}`);
}

console.log('\nOpen every card before committing. Reject anything with text, a face, or a');
console.log('product that does not match its reference; regenerate with --only=<CMP-id> --force.');
