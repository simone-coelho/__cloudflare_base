// src/demos/meridian/build-scenes.mjs
//
// Generates the 8 retail scene PLATES once, at design time, into
// public/meridian/scenes/<sceneId>.jpg — a 16:9 editorial photograph with the
// scene's lead product composited in from its REAL packshot, the way the Coach
// demo's sceneGen does it (packshot as inline_data reference + a fidelity
// clause), except nothing here happens at runtime: generate, inspect, reject,
// commit. The demo then serves approved stills and the no-generation line the
// search surface promises the room stays true.
//
// Lead products are picked by FAMILY-NAME SUBSTRING, never by id — catalogue
// ids are being reassigned in parallel and a plate must not orphan when they
// land. scenes.ts carries the same family per scene as `leadFamily`.
//
//   GEMINI_API_KEY=... node src/demos/meridian/build-scenes.mjs
//   node src/demos/meridian/build-scenes.mjs --only=wedding,cold-snap --force
//
// Review every output with your own eyes before committing. Reject anything
// with text, a face, or a product that does not match its reference, and
// regenerate with --only=<sceneId> --force.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
const IMG_DIR = 'public/meridian/img';
const OUT_DIR = 'public/meridian/scenes';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
const MAX_BYTES = 400 * 1024;           // ≤ 400KB per plate, hard
const WIDTH = 1600;                     // 16:9
const HEIGHT = 900;

const key = process.env.GEMINI_API_KEY
  || (existsSync('.dev.vars')
      ? (readFileSync('.dev.vars', 'utf8').match(/GEMINI_API_KEY\s*=\s*"?([^"'\s]+)/) || [])[1]
      : undefined);
if (!key) { console.error('No GEMINI_API_KEY in env or .dev.vars'); process.exit(1); }

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const force = args.includes('--force');

const catalogue = JSON.parse(readFileSync('src/demos/meridian/catalog.retail.json', 'utf8'));

// ─────────────────────────────────────────────────────────────────────────────
// The 8 scenes, each with its approved lead FAMILY and a legible theme — the
// customer's own words: "if it's a graduation, kids throwing their hats; if
// winter, a winter theme; hiking, a mountain with snow." The theme must read
// from across a room; the product must read as the exact referenced item.
// `family` narrows by name substring; `prefer` breaks ties inside the family.
// ─────────────────────────────────────────────────────────────────────────────
const SCENES = [
  {
    // First take: the place-setting menu cards came back with faint script-like
    // squiggles — quasi-text, a reject. Stationery is now banned outright.
    id: 'wedding', family: 'Aster', prefer: ['square'],
    context: 'at an outdoor wedding reception — a long white-linen table set with white roses and peonies, '
      + 'lit taper candles and champagne coupes, a soft-focus white marquee and warm string lights behind; '
      + 'the silk square draped elegantly beside a place setting of empty plates and glassware only — '
      + 'no menus, no place cards, no stationery of any kind — unmistakably a wedding',
  },
  {
    // First take: blurred guests appeared in the ballroom bokeh — people, a
    // reject. The room is now explicitly empty.
    id: 'black-tie', family: 'Halden', prefer: ['earring', 'pave'],
    context: 'on polished black marble at a black-tie evening — beside a black silk bow tie and a champagne coupe, '
      + 'glittering warm chandelier bokeh deep in the background of a completely EMPTY ballroom — '
      + 'not a single person, guest, or human silhouette anywhere, even blurred — formal and nocturnal',
  },
  {
    id: 'new-job', family: 'Linden', prefer: ['structured', 'tote'],
    context: 'standing upright on a tidy desk by a tall office window on a bright first morning — a closed blank '
      + 'notebook, a ceramic cup of coffee, crisp city morning light across clean modern surfaces',
  },
  {
    id: 'cold-snap', family: 'Fenwick', prefer: ['fisherman'],
    context: 'folded on a wooden bench beside a frost-edged window in deep winter — thick snow falling on '
      + 'snow-covered pines outside, soft warm firelight from inside, an unmistakable winter theme',
  },
  {
    id: 'weekend-away', family: 'Holloway', prefer: ['weekender'],
    context: 'sitting in the open boot of a vintage estate car pulled over on a misty coastal road at dawn — '
      + 'a folded wool blanket beside it, headlands and sea haze beyond, packed for a weekend away',
  },
  {
    // First take: the "negative space" ask was honoured with a hard-edged
    // frosted glass panel over the left third — an artifact, a reject. The
    // empty space is now described as part of the scene itself.
    id: 'hard-to-buy-for', family: 'Solstice', prefer: ['vetiver'],
    context: 'among beautifully wrapped gifts — plain kraft-paper boxes tied with cream ribbon, sprigs of winter '
      + 'greenery, soft candlelight, the considered present at the centre-right, and the left of the frame '
      + 'simply a continuous softly lit plaster wall falling out of focus — one seamless photograph, '
      + 'no panels, no borders, no overlays',
  },
  {
    id: 'graduation', family: 'Halden', prefer: ['signet'],
    context: 'in sharp focus on a ribbon-tied blank diploma scroll in the foreground, while black graduation '
      + 'mortarboard caps fly high into a bright celebratory sky behind — unmistakably commencement day, '
      + 'caps airborne, nobody in frame',
  },
  {
    id: 'investment-piece', family: 'Drover', prefer: ['field', 'jacket'],
    context: 'hanging on a weathered wooden fence post beside an upland hiking trail — snow-capped mountains '
      + 'rising sharp behind, clear cold light, a waxed canvas rucksack at the post\'s foot, built for years of this',
  },
];

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

// Adapted from src/services/sceneGen.ts (searchHeroPrompt + FIDELITY),
// generalised from "bag" to the item and hardened for a plate that carries a
// headline overlay on stage.
const FIDELITY =
  'CRITICAL: Reproduce the EXACT item shown in the reference image — identical shape, proportions, '
  + 'hardware, colour, material and texture. Do NOT redesign, recolor, or restyle it. It must read as '
  + 'the same product, and stay the clear hero of the frame. No people, no faces, no hands, no text, '
  + 'no lettering, no watermarks, no logos.';

const promptFor = (item, context) =>
  `Wide cinematic editorial campaign banner. Place the provided ${item.name} ${context}. `
  + 'Premium fashion-magazine lighting, shallow depth of field, tasteful real-world props, refined '
  + 'on-brand palette, generous negative space on the left for a headline, photorealistic. '
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

/** 1600×900, and under the size budget — quality steps down until it fits. */
async function toPlate(bytes) {
  for (const quality of [85, 78, 70, 62, 55, 48]) {
    const out = await sharp(bytes)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= MAX_BYTES) return out;
  }
  throw new Error('could not fit under 400KB even at quality 48');
}

mkdirSync(OUT_DIR, { recursive: true });
const wanted = only.length ? SCENES.filter((s) => only.includes(s.id)) : SCENES;
console.log(`model ${MODEL} · ${wanted.length} scene(s)\n`);

for (const spec of wanted) {
  const path = join(OUT_DIR, `${spec.id}.jpg`);
  if (existsSync(path) && !force) {
    console.log(`  skip   ${spec.id}  (exists — pass --force to redo)`);
    continue;
  }
  const item = leadFor(spec);
  if (!item) { console.log(`  FAIL   ${spec.id}  no catalogue item matches family "${spec.family}"`); continue; }
  const t0 = Date.now();
  const res = await generate(item, spec.context);
  if (!res.ok) { console.log(`  FAIL   ${spec.id}  ${res.why}`); continue; }
  try {
    writeFileSync(path, await toPlate(res.bytes));
  } catch (e) {
    console.log(`  FAIL   ${spec.id}  ${e.message}`);
    continue;
  }
  const kb = Math.round(statSync(path).size / 1024);
  console.log(`  wrote  ${spec.id.padEnd(17)} ${String(kb).padStart(4)}KB  ${Date.now() - t0}ms  lead: ${item.id} ${item.name}`);
}

console.log('\nOpen every plate before committing. Reject anything with text, a face, or a');
console.log('product that does not match its reference; regenerate with --only=<id> --force.');
