// src/demos/meridian/build-images.mjs
//
// Generates the retail catalogue's product images ONCE, at design time, into
// public/meridian/img/. The output is committed and served as static files —
// there is no model call at runtime, none at deploy, and the demo runs with the
// network unplugged. This script is a tool we run deliberately, exactly like
// build-catalogs.mjs, not part of any pipeline.
//
// WHY GENERATED RATHER THAN SOURCED. Forty stock photographs come from forty
// photographers: forty lighting setups, grounds and crops. A grid of those looks
// worse than drawings — it looks like a mood board. One prompt family gives
// coherence by construction, and it lets us SPECIFY the near-white ground the
// layout needs rather than hope the photography allows it.
//
// This does not cross the no-generation line. That line is about the model
// inventing things at runtime in front of the room. This is design time:
// generate, inspect, reject, commit a fixed approved set — the same resolution
// already applied to the scenes.
//
//   node src/demos/meridian/build-images.mjs --only=MRD-R007,MRD-R003
//   node src/demos/meridian/build-images.mjs --all
//   node src/demos/meridian/build-images.mjs --all --force     (re-do everything)

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
const OUT = 'public/meridian/img';
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

const key = (readFileSync('.dev.vars', 'utf8').match(/GEMINI_API_KEY\s*=\s*"?([^"'\s]+)/) || [])[1];
if (!key) { console.error('No GEMINI_API_KEY in .dev.vars'); process.exit(1); }

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);
const force = args.includes('--force');
const all = args.includes('--all');

const catalogue = JSON.parse(readFileSync('src/demos/meridian/catalog.retail.json', 'utf8'));
const items = only.length ? catalogue.filter((i) => only.includes(i.id)) : (all ? catalogue : catalogue.slice(0, 4));

/**
 * ONE PROMPT FAMILY. Everything that must be identical across the catalogue —
 * ground, light, framing, margin — is fixed text. Only the subject clause
 * changes. That is what makes forty images look like one brand shot them on one
 * afternoon, which is the entire reason for generating rather than sourcing.
 *
 * The prohibitions are not politeness: rendered text and logos are the two
 * artefacts that would make an image unusable on stage, and a face turns a
 * packshot into a model shot that no longer matches the rest of the grid.
 */
const WORLD_STYLING = {
  heritage: 'classic, substantial, gently worn-in; natural fibres and aged brass hardware',
  modern:   'clean lines, precise construction, understated hardware',
  statement:'sculptural and confident, a single strong silhouette',
  minimal:  'quiet, unadorned, matte finishes, no visible hardware',
};

/**
 * Things that are sold as a pair must be SHOWN as a pair. Left to itself the
 * model read "Pave Drop Earrings" as one pendant, which is a reject: the card
 * would say earrings and the picture would show a necklace charm.
 */
const PAIRED = /\b(earrings|cufflinks|studs|hoops)\b/i;

function subjectOf(item) {
  const noun = item.category.toLowerCase().replace(/s$/, '');
  if (PAIRED.test(item.name)) {
    return `A matched PAIR of ${item.name.toLowerCase()}, both shown side by side — ${item.subcategory} ${noun}`;
  }
  return `A single ${item.name.toLowerCase()} — a ${item.subcategory} ${noun}`;
}

function promptFor(item) {
  const styling = WORLD_STYLING[item.world] || WORLD_STYLING.modern;
  return [
    `${subjectOf(item)} —`,
    `photographed as a luxury e-commerce packshot. Style: ${styling}.`,
    '',
    'Fixed studio setup, identical for every product in this catalogue:',
    // PURE WHITE, and it belongs here rather than in post-processing: lifting a
    // warm ground to white afterwards also lifts the product. Bright Hour pins
    // its packshot white as a token (#FEFEFE, "pixel-verified") because card and
    // photograph have to share one surface — any tint and the image reads as a
    // tile sitting on the card instead of part of it.
    '- Pure white seamless studio background, #FFFFFF, no warmth and no tint whatsoever.',
    '- Soft, large, diffused key light from the upper left; gentle fill; one soft contact shadow beneath the product.',
    '- Product centred, shot straight on, entirely within frame, with generous even margin on all four sides.',
    '- Sharp focus throughout, true colour, subtle natural texture.',
    '- Square composition.',
    '',
    'Strict requirements:',
    '- Absolutely no text, lettering, numbers, labels, tags or watermarks anywhere in the image.',
    '- No logos, monograms or brand marks of any kind.',
    '- No people, no faces, no hands, no mannequins.',
    '- No props, no styling clutter, no other products — the single product only.',
    '- Physically coherent construction: correct seams, symmetric hardware, no impossible geometry.',
  ].join('\n');
}

async function generate(item) {
  const r = await fetch(`${GLAPI}/models/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptFor(item) }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    }),
  });
  if (!r.ok) return { ok: false, why: `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 140)}` };
  const j = await r.json();
  const part = (j?.candidates?.[0]?.content?.parts || [])
    .map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
  if (!part?.data) return { ok: false, why: `no image (finish=${j?.candidates?.[0]?.finishReason})` };
  return { ok: true, bytes: Buffer.from(part.data, 'base64'), mime: part.mimeType || part.mime_type || 'image/png' };
}

mkdirSync(OUT, { recursive: true });
console.log(`model ${MODEL} · ${items.length} item(s)\n`);

for (const item of items) {
  const ext = 'png';
  const path = join(OUT, `${item.id}.${ext}`);
  if (existsSync(path) && !force) {
    console.log(`  skip   ${item.id}  ${item.name}  (exists — pass --force to redo)`);
    continue;
  }
  const t0 = Date.now();
  const res = await generate(item);
  if (!res.ok) { console.log(`  FAIL   ${item.id}  ${item.name}  ${res.why}`); continue; }
  writeFileSync(path, res.bytes);
  const kb = Math.round(statSync(path).size / 1024);
  console.log(`  wrote  ${item.id}  ${String(kb).padStart(4)}KB  ${Date.now() - t0}ms  ${item.name}`);
}

console.log('\nInspect every file before committing. Reject anything with text, a logo, a face,');
console.log('or geometry that does not make sense, and regenerate it with --only=<id> --force.');
