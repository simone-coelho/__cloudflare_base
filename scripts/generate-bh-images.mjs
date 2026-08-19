#!/usr/bin/env node
/**
 * generate-bh-images.mjs — Bright Hour product imagery batch (docs/qvc Part D2).
 *
 * Standalone: talks to the Gemini image model over REST directly (same model the worker's
 * sceneGen.ts uses), never through the worker. Key read from .dev.vars (GEMINI_API_KEY).
 *
 * Pipeline
 *   gen    → N candidates per item at 2K, one locked recipe per category, into a work dir.
 *            Records automatic metrics per candidate (background whiteness/neutrality,
 *            product bounding box, margins, centering) — the mechanical half of the QA gate.
 *   sheets → contact sheets so a human eye can run the defect checklist (text, geometry,
 *            melted detail, wrong item, hands/logos) on every candidate.
 *   wire   → accepted candidates normalised to 1200×1200 near-white #FEFEFE, <300KB, written
 *            to public/live/img/{itemNumber}.jpg, and image_url set in catalog.data.json.
 *            Anything not accepted gets image_url:null → the storefront's deliberate SVG
 *            placeholder ships instead. A clean placeholder beats a bad image.
 *
 * Usage
 *   node scripts/generate-bh-images.mjs gen --tier a --candidates 2
 *   node scripts/generate-bh-images.mjs gen --tier b,c,d --candidates 2 --concurrency 5
 *   node scripts/generate-bh-images.mjs sheets --tier a
 *   node scripts/generate-bh-images.mjs wire --decisions <path/to/decisions.json>
 *   node scripts/generate-bh-images.mjs verify
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CATALOG = path.join(ROOT, 'src/demos/brighthour/catalog.data.json');
const OUT_DIR = path.join(ROOT, 'public/live/img');
const WORK =
  process.env.BH_WORK ||
  path.join(
    '/tmp/claude-1000/-mnt-c-Users-LAH-Documents---Development-Optimizely---cloudflare-base',
    '8c5fb36d-4046-4ba9-9716-eca51783373c/scratchpad/bh'
  );
const CAND_DIR = path.join(WORK, 'cand');
const SHEET_DIR = path.join(WORK, 'sheets');
const MANIFEST = path.join(WORK, 'candidates.json');

const MODEL = process.env.BH_MODEL || 'gemini-3.1-flash-image';
const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';

/* ── env ─────────────────────────────────────────────────────────────────── */
function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const f = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(f)) throw new Error('no .dev.vars and no GEMINI_API_KEY in env');
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    if (line.slice(0, i).trim() === 'GEMINI_API_KEY') return line.slice(i + 1).trim();
  }
  throw new Error('GEMINI_API_KEY not found in .dev.vars');
}

/* ── the locked per-category recipe ──────────────────────────────────────── */
const CATEGORY_STYLE = {
  'Kitchen & Table':
    'Cookware and tabletop packshot style: clean three-quarter elevated angle, product empty and unused, ' +
    'crisp specular highlights on metal and glaze, no food inside, no cooktop, no kitchen setting.',
  'For the Home':
    'Home textiles and lighting packshot style: textiles neatly folded or stacked in a tidy square stack, ' +
    'hard goods shot three-quarter with a true vertical, no room setting, no furniture behind the product.',
  'Garden & Outdoor':
    'Garden and outdoor packshot style: the product cleanly isolated in the studio, no soil, no lawn, no patio, ' +
    'no sky; only include plants if the product is a planter, and then only simple plain green foliage.',
  'Food & Wine':
    'Food packshot style: food and drink presented in COMPLETELY BLANK unlabelled vessels — plain clear or amber ' +
    'glass jars with plain solid lids, unmarked kraft-paper bags, plain white ceramic, natural wood boards. ' +
    'Every surface is blank: no printed labels, no stickers, no stamped text, no seals, no tags.',
  Fashion:
    'Apparel packshot style: flat-lay, garment laid perfectly flat and neatly folded, photographed straight down ' +
    'from directly overhead. Fabric weave and stitching visible. Absolutely no human body, no model, no mannequin, ' +
    'no hanger, no face, no hands, no legs, no feet.',
  'Beauty & Wellness':
    'Minimalist beauty packshot style: the vessel is COMPLETELY UNLABELLED and blank — plain frosted or matte glass, ' +
    'smooth matte ceramic, or plain matte plastic, with a solid-colour cap in a soft neutral tone. Every surface is ' +
    'perfectly blank: no printing, no embossing, no engraving, no symbols, no decoration of any kind.',
  Jewelry:
    'Jewellery macro packshot style: shot straight down on plain white, precise physically-correct metalwork, every ' +
    'link and clasp complete and continuous, stones evenly cut and symmetrically set, correct count of stones and ' +
    'prongs, no engraving, no hallmark, no display bust, no velvet, no fingers.',
  'Electronics & Tech':
    'Consumer-electronics packshot style: restrained modern industrial design, physically plausible buttons, ports ' +
    'and seams, any screen or display switched fully OFF as uniform dark glass, no illuminated user interface, no ' +
    'icons, no glyphs, no indicator text, no branding plate.',
};

const NEGATIVE =
  'STRICT: no text of any kind anywhere in the image — no letters, no words, no numbers, no captions, no printed ' +
  'labels, no packaging copy, no logos, no brand marks, no monograms, no watermarks, no measurement markings. ' +
  'No hands, no people, no body parts, no faces. No extra props, no styling clutter, no plants or flowers unless ' +
  'stated. No coloured, textured, gradient or patterned background — the background is a single flat near-white sweep.';

const FRAME =
  'Single product centred in a square 1:1 frame, occupying roughly 84 percent of the frame with an even margin of ' +
  'about 8 percent on all four sides. Seamless flat near-white studio background (#FEFEFE), soft large key light ' +
  'from the upper left, gentle realistic contact shadow directly under the product, no backdrop gradient, no ' +
  'vignette. Photorealistic commercial product photography, medium-format camera, 100mm lens at f/11, ' +
  'tack-sharp focus edge to edge, true-to-life colour.';

/* Candidate variants — same recipe, one deliberate framing change so two candidates are a real
   choice rather than the same roll twice. */
const VARIANTS = [
  'Three-quarter hero angle, camera slightly above the product.',
  'Straight-on eye-level front elevation, perfectly square to the camera.',
];
const FLAT_CATEGORIES = new Set(['Fashion', 'Jewelry']);
const FLAT_VARIANTS = [
  'Perfectly flat overhead top-down view, product squared to the frame.',
  'Overhead top-down view, product angled a few degrees for a softer composition.',
];

/* ── per-item subject phrasing (brand names deliberately stripped: a fictional brand name in the
      prompt invites a rendered logo, which is an automatic reject) ─────────── */
const SUBJECT = {
  B412907: 'a 9-quart round enamelled cast-iron Dutch oven in deep marigold yellow with a cream enamel interior, a heavy domed lid with a small stainless knob, and two integral loop side handles',
  B412915: 'a 7-quart countertop digital air-fryer oven in matte black with brushed stainless steel trim, a clear glass door, a blank unlit control panel with no markings, and short feet',
  B412933: 'a tall 12-quart enamelled steel stockpot in slate grey with a cream interior, a domed lid with a stainless knob, and two riveted side handles',
  B412948: 'a set of three solid acacia wood serving boards of graduated sizes in warm natural grain, stacked in a neat fan with the largest at the back',
  // re-rolled: the first recipe drew the blades ON the face of the block (impossible geometry).
  // Blades are now explicitly hidden inside the block.
  B412961: 'a natural wood knife block holding a set of kitchen knives with ONLY the black knife handles protruding above the top of the block — every blade fully inserted and completely hidden inside the solid wood, no blade visible anywhere — with a pair of kitchen shears and a sharpening steel standing upright beside the block',
  B412974: 'a 10-inch round enamelled cast-iron skillet in marigold yellow with a slate grey exterior rim, a long integral handle and a small helper handle, empty and unused',
  B412988: 'a borosilicate glass coffee press with a stainless steel frame, lid and plunger, empty and clean, glass perfectly clear',
  B413006: 'a set of three glazed stoneware baking dishes in sea-glass green and clay, rectangular and graduated in size, nested and stacked on top of each other',
  B413019: 'a stack of clear borosilicate glass food-storage containers of graduated sizes with plain frosted-white plastic lids, neatly nested in two short columns',
  B413027: 'four hand-glazed stoneware dinner plates in cream with a sea-glass green rim, three stacked flat and one leaning upright behind them showing the glaze face',
  B413041: 'three stainless steel nesting prep bowls in graduated sizes with white and slate silicone bases, arranged in a neat overlapping row',
  B413058: 'a fourteen-piece tri-ply stainless steel cookware set — saucepans, a stockpot, a sauté pan and a skillet with glass lids — arranged in a tidy stepped group with the tall pot at the back',
  B421104: 'a five-piece quilted cotton coverlet set in soft oatmeal with fog grey and clay accents, folded into a neat stack: the folded coverlet on the bottom, two pillow shams and two decorative pillows stacked squarely on top',
  // re-rolled: first recipe gave a thin disc base that could not counterweight the arc (bad physics)
  B421118: 'a tall arc floor lamp with a brushed brass curved arm rising from a large heavy solid white marble block base wide enough to counterweight the arc, with a matte black conical shade hanging at the end of the arc, lamp switched off',
  B421126: 'a hand-loomed cotton throw blanket in rust, oatmeal and indigo stripes, folded into a neat square stack with a short fringe visible on one edge',
  B421139: 'a cotton sateen sheet set in crisp white with fog grey, folded into a neat squared stack of a flat sheet, fitted sheet and two pillowcases, with a soft satin sheen',
  B421147: 'an adjustable LED task lamp in matte black with a bone-white shade, a weighted round base and an articulated arm, lamp switched off',
  B421155: 'three poured soy candles in plain amber glass jars of equal size with plain matte black lids, one lid off and resting beside its jar, wax surfaces smooth and unburned, glass completely blank',
  B421168: 'six stackable fabric storage bins in fog grey and oatmeal canvas on slim steel frames, arranged as a neat stacked group of three by two, with plain fabric pull handles and no label holders',
  B421172: 'a pendant ceiling light with a rounded hand-blown milk-glass shade and a brushed brass fitting and cord, hanging straight, light switched off',
  // re-rolled: first recipe drew a square rug; a 5x7 must read clearly rectangular
  B421186: 'a clearly RECTANGULAR wool-blend area rug, noticeably longer than it is wide in a 5 to 7 proportion, in rust and fog grey with a simple geometric pattern, shown flat and complete from directly overhead with all four corners visible and even',
  B421195: 'a six-piece Turkish cotton towel set in white, fog grey and clay, rolled and folded into a tidy stack of two bath towels, two hand towels and two washcloths',
  B421203: 'eight stonewashed linen napkins in oatmeal and rust, folded into neat squares and arranged in two small stacks with the linen slub texture visible',
  B433208: 'a squat wide jar of face cream in plain frosted white glass with a smooth matte cream-coloured lid, completely blank with no printing whatsoever, standing upright',
  // re-rolled: first recipe produced a featureless moulded human face (reads as a theatre mask, not a device)
  B433216: 'an LED light-therapy beauty device: a gently curved white plastic shield with a visible internal grid of many small round unlit LED bulbs behind its inner face, two oval eye cut-outs, a slim silicone head strap and a small plain white control puck on the cable. It is a flat technical panel, NOT a moulded human face — no nose, no lips, no facial features, no mannequin. Switched off, standing at a three-quarter angle',
  B433224: 'a tall slim body-oil bottle in plain amber glass with a matte bone-coloured dropper cap, completely blank with no printing, the oil a warm golden colour',
  B433237: 'a set of thirty small sealed glass ampoules of serum in clear glass with plain gold caps, arranged upright in a tidy block of rows in a plain white tray, all glass blank',
  B433245: 'three tinted lip balms in plain matte cylindrical tubes in rose, brick and plum, standing upright in a row with caps on, surfaces completely blank',
  B433259: 'a sonic facial cleansing device: a smooth palm-sized rounded silicone paddle in blush pink with a bone-coloured back plate and a single plain round button, no markings',
  B433263: 'a five-piece travel skincare set: five small plain frosted-glass and matte-white bottles and jars of graduated sizes with plain neutral caps, standing in a neat row, every surface blank',
  B433271: 'three bars of milled soap in soft natural cream, sage and oatmeal tones, unwrapped, cleanly cut rectangular bars stacked and fanned, surfaces smooth and completely unstamped',
  B433288: 'a slim upright pump bottle of facial moisturiser in matte white with a plain white pump top, completely blank with no printing or symbols',
  B433294: 'a tall slim bottle of hair serum in clear glass with a soft pearl-white liquid and a plain matte black pump cap, entirely blank glass',
  B445301: 'a cable-knit cotton cardigan in oatmeal, laid perfectly flat and neatly folded with sleeves tucked in, buttons closed, the cable knit texture crisp and even',
  B445318: 'a pair of black ponte-knit leggings laid perfectly flat, folded once at the hip with the legs stacked straight and even',
  B445326: 'an ivory silk-blend button-front blouse laid perfectly flat and neatly folded, collar squared at the top, sleeves folded in, buttons in a straight even line',
  B445334: 'an olive quilted barn jacket laid perfectly flat, zip and snap placket straight, corduroy collar visible, sleeves folded neatly in at the sides',
  // re-rolled: first recipe rendered a hip-length wrap TOP; the item is a dress
  B445347: 'a full-length black jersey wrap DRESS laid perfectly flat with the whole garment visible from neckline to hem, clearly knee-length or longer with a wide skirt, the wrap front crossing cleanly and the tie belt laid across the waist',
  B445355: 'three plain crew-neck cotton tees in white, black and heather grey, each folded into an identical neat rectangle and stacked squarely on top of each other',
  B445369: 'a camel corduroy A-line skirt laid perfectly flat, waistband straight at the top, the corduroy wale running evenly vertical',
  B445372: 'a pair of bone-coloured memory-foam slip-on sandals with a single wide upper strap and a contoured footbed, placed side by side and shot from directly overhead',
  B445384: 'a pair of indigo pull-on straight-leg jeans laid perfectly flat, folded once at the hip, legs stacked straight, a plain elastic waistband with no rivets or patches',
  B445396: 'a structured convertible tote handbag in cognac pebbled leather with two rolled top handles, a detachable plain leather shoulder strap coiled neatly beside it, and plain brushed gold hardware with no logo plate',
  B456402: 'a fine 14K yellow gold chain necklace with a single small polished gold leaf pendant, the chain laid in a smooth even oval loop with the pendant at the bottom centre, clasp intact',
  B456417: 'a matched pair of 30mm sterling silver hoop earrings, perfectly round and identical, laid flat side by side with their hinged closures visible and complete',
  B456425: 'a platinum-toned tennis bracelet: one continuous straight line of identical square-set round clear stones in individual four-prong settings, laid in a gentle even curve with a box clasp at one end',
  B456438: 'a single hammered sterling silver band ring standing upright, the hammered facets even and regular, the band a perfect unbroken circle',
  B456446: 'a graduated strand necklace of round rhodium-plated silver beads that grow evenly larger toward the centre, laid in a smooth symmetrical horseshoe with a small clasp at the top',
  B456453: 'a delicate sterling silver beaded chain anklet laid in a simple open oval, evenly spaced small round beads along a fine chain, small spring clasp intact',
  B456467: 'a matched pair of drop earrings in rhodium-plated silver, each a slim teardrop outline set with small identical clear pavé stones, hung side by side and identical to each other',
  B456479: 'a matched pair of small 6mm sterling silver ball stud earrings with posts and butterfly backs, laid flat side by side',
  B467503: 'a long slim matte black soundbar with a fine fabric speaker grille, lying horizontally in front of a matching small black cube subwoofer standing behind it, both switched off with no lights and no markings',
  B467511: 'a pair of over-ear headphones in bone white with midnight navy earcup rings, plush oval earpads and a padded headband, shown three-quarter with the earcups turned slightly forward, no branding',
  B467528: 'a 10-inch smart display: a rectangular screen in a chalk-white bezel angled on a soft charcoal fabric wedge stand, the screen completely off as uniform dark glass with nothing shown on it',
  B467536: 'a small portable projector, a compact bone-coloured cube with a round glass lens on the front face and a fabric-wrapped side panel, switched off, no markings',
  B467549: 'a pair of true-wireless earbuds in bone white resting in an open pebble-shaped charging case with midnight navy interior, no lights, no markings',
  B467557: 'a slim fitness tracker with a small dark rectangular screen switched off and a sand-coloured silicone band, laid flat and open in a shallow curve',
  B467565: 'a three-in-one wireless charging dock in matte black: a low flat base with an upright arc pad, a small circular pad on the base and a slim raised puck at the back, no lights, no markings',
  B467578: 'a rectangular black power bank with softly rounded corners and a matte finish, standing upright at a slight three-quarter angle, ports visible on the top edge, no display, no markings',
  B478604: 'three self-watering planters in terracotta and slate UV-stable resin, graduated in size, arranged in a stepped row with simple plain green foliage in each',
  B478612: 'a matched pair of hand-forged iron lanterns in weathered dark iron with clear glass panels and a ring handle on top, candles unlit, standing side by side',
  B478629: 'a wall-mount retractable hose reel: a green garden hose neatly coiled inside a dark green housing with a plain crank handle, brass hose fitting visible, no markings',
  B478637: 'a two-seat bistro set: a small round ivory metal table with two matching folding metal chairs in ivory and matte black, arranged in a tidy triangle with the table at the centre',
  B478645: 'a round cast-iron fire bowl on three legs in black, with a domed mesh spark screen resting on top, empty and clean',
  B478658: 'a 48-inch reclaimed teak garden bench with slatted seat and back and simple square legs, shown three-quarter, natural silvered teak grain',
  // re-rolled: first recipe engraved depth gradations and numerals on the transplanter blade (rendered text)
  B478663: 'an eight-piece garden tool set — stainless steel trowel, transplanter, cultivator, weeder, pruners and gloves — standing in a natural canvas tote with ash wood handles, arranged upright and tidy. Every blade is perfectly smooth mirror-polished bare steel with NO depth gradations, NO ruler marks, NO numerals and NO engraving of any kind',
  B478677: 'a galvanized steel watering can with a long spout, a curved carrying handle and a removable rose head, shown three-quarter, unpainted metal with visible seams',
  B478689: 'four round cast-stone stepping stones in weathered grey with a simple textured surface, arranged overlapping in a shallow fan, plain and unengraved',
  B489705: 'four small jars of fruit preserves in identical plain clear glass jars with plain gold lids, the fruit visible inside in four different colours from deep berry to golden apricot, jars completely blank with no labels, standing in a neat row shot close so the row of jars fills the width of the frame',
  B489713: 'twelve freshly baked cinnamon rolls with white glaze in a plain rectangular metal baking tray, shot three-quarter, glaze glossy, no packaging',
  B489728: 'six servings of autumn soup in identical plain white ceramic bowls with no rims, arranged in two rows of three, each a different warm autumn colour from squash orange to deep tomato, no spoons, no garnish sprigs beyond a simple herb leaf',
  B489736: 'four rustic artisan bread loaves with scored crusts, arranged in a tidy overlapping group on plain natural linen, with a small plain kraft bag of flour behind them, everything completely blank and unlabelled',
  B489744: 'a cheese board gift crate: a plain natural wood crate holding wedges of cheese, a small bunch of grapes, plain crackers and a small blank glass jar of preserve, arranged neatly, every item unlabelled',
  B489752: 'four small round fruit pies with golden lattice crusts in plain aluminium pie tins, arranged in a two by two square, no packaging, no labels',
  B489767: 'four identical plain kraft-paper coffee bags with flat bottoms and plain matte black tin ties, standing in a neat row with a small scatter of roasted coffee beans in front, bags completely blank with no printing',
  B489775: 'a tall round two-layer celebration cake with smooth ivory buttercream frosting and a simple piped border, on a plain white cake stand, undecorated and unwritten',
  B489783: 'a 500ml bottle of olive oil in plain dark green glass with a plain matte cork-topped stopper, completely blank with no label and no printing, standing upright',
};

/* ── priority tiers (a partial batch still covers the demo) ──────────────── */
function tierOf(item) {
  const code = item.offer?.code;
  const cat = item.category;
  if (['TBO', 'BH2', 'EVT'].includes(code) || item.offer?.pinned) return 'a';
  if (['Kitchen & Table', 'For the Home', 'Garden & Outdoor', 'Food & Wine'].includes(cat)) return 'b';
  if (['Fashion', 'Beauty & Wellness'].includes(cat)) return 'c';
  return 'd'; // Electronics & Tech, Jewelry — strictest gate, expect rejections
}

/* ── prompt ──────────────────────────────────────────────────────────────── */
function promptFor(item, variantIdx) {
  const subject = SUBJECT[item.itemNumber];
  if (!subject) throw new Error(`no SUBJECT phrase for ${item.itemNumber} (${item.name})`);
  const style = CATEGORY_STYLE[item.category] || CATEGORY_STYLE['For the Home'];
  const variants = FLAT_CATEGORIES.has(item.category) ? FLAT_VARIANTS : VARIANTS;
  const variant = variants[variantIdx % variants.length];
  return `Professional studio e-commerce product photograph of ${subject}. ${variant} ${FRAME} ${style} ${NEGATIVE}`;
}

/* ── generation ──────────────────────────────────────────────────────────── */
async function generateOne(key, prompt) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '2K' } },
  });
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(1500 * 2 ** attempt + Math.random() * 800);
    let r;
    try {
      r = await fetch(`${GLAPI}/models/${MODEL}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      lastErr = `fetch ${e.message}`;
      continue;
    }
    if (!r.ok) {
      lastErr = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`;
      if (r.status < 500 && r.status !== 429) break;
      continue;
    }
    const j = await r.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
    if (!part?.data) {
      lastErr = `no image (finish=${j?.candidates?.[0]?.finishReason})`;
      continue;
    }
    return { ok: true, buf: Buffer.from(part.data, 'base64') };
  }
  return { ok: false, error: lastErr };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ── mechanical metrics: background whiteness + product bbox/margins ─────── */
async function metrics(file) {
  const S = 220;
  const { data } = await sharp(file).resize(S, S, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => {
    const i = (y * S + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // background = median-ish of the four corner patches
  const patch = [];
  const K = 14;
  for (const [ox, oy] of [[0, 0], [S - K, 0], [0, S - K], [S - K, S - K]]) {
    for (let y = oy; y < oy + K; y++) for (let x = ox; x < ox + K; x++) patch.push(px(x, y));
  }
  const chan = (c) => {
    const v = patch.map((p) => p[c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const bg = [chan(0), chan(1), chan(2)];
  const bgMin = Math.min(...bg);
  const bgSpread = Math.max(...bg) - bgMin;
  // bbox of anything meaningfully darker/more saturated than the background
  const thr = Math.max(12, Math.round((255 - bgMin) * 0.25) + 10);
  let x0 = S, y0 = S, x1 = -1, y1 = -1, ink = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const [r, g, b] = px(x, y);
      const d = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      if (d > thr) {
        ink++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { bg, bgMin, bgSpread, coverage: 0, empty: true };
  const m = {
    bg,
    bgMin,
    bgSpread,
    coverage: +(ink / (S * S)).toFixed(3),
    marginL: +(x0 / S).toFixed(3),
    marginR: +((S - 1 - x1) / S).toFixed(3),
    marginT: +(y0 / S).toFixed(3),
    marginB: +((S - 1 - y1) / S).toFixed(3),
  };
  m.minMargin = Math.min(m.marginL, m.marginR, m.marginT, m.marginB);
  m.centerOffX = +(((x0 + x1) / 2 / S - 0.5)).toFixed(3);
  // mechanical flags — the eye still has to run the defect checklist
  m.flags = [];
  if (m.bgMin < 232) m.flags.push('bg-dark');
  if (m.bgSpread > 12) m.flags.push('bg-tinted');
  if (m.minMargin < 0.02) m.flags.push('crops-edge');
  if (m.coverage < 0.06) m.flags.push('tiny-subject');
  if (Math.abs(m.centerOffX) > 0.09) m.flags.push('off-centre');
  return m;
}

/* ── normalisation for the shipped file ──────────────────────────────────── */
async function normalise(src, dest) {
  const m = await metrics(src);
  let pipe = sharp(src).resize(1200, 1200, { fit: 'cover', position: 'centre' });
  // gentle white-point lift so every accepted shot lands on the same near-white sweep
  if (m.bgMin && m.bgMin < 250) {
    const factor = Math.min(1.09, 253 / m.bgMin);
    if (factor > 1.005) pipe = pipe.linear(factor, 0);
  }
  let q = 86;
  let buf = await pipe.jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  while (buf.length > 300 * 1024 && q > 60) {
    q -= 6;
    buf = await sharp(src)
      .resize(1200, 1200, { fit: 'cover', position: 'centre' })
      .linear(m.bgMin && m.bgMin < 250 ? Math.min(1.09, 253 / m.bgMin) : 1, 0)
      .jpeg({ quality: q, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
  }
  fs.writeFileSync(dest, buf);
  const after = await metrics(dest);
  return { bytes: buf.length, quality: q, bgBefore: m.bgMin, bgAfter: after.bgMin };
}

/* ── commands ────────────────────────────────────────────────────────────── */
function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
}
function loadManifest() {
  return fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
}
function saveManifest(m) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1));
}
function args() {
  const a = {};
  for (let i = 3; i < process.argv.length; i++) {
    const t = process.argv[i];
    if (t.startsWith('--')) a[t.slice(2)] = process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? true : process.argv[++i];
  }
  return a;
}

async function cmdGen() {
  const a = args();
  const tiers = String(a.tier || 'a,b,c,d').split(',');
  const nCand = Number(a.candidates || 2);
  const conc = Number(a.concurrency || 5);
  const only = a.only ? String(a.only).split(',') : null;
  // --letters cd → name the re-rolls c,d instead of a,b (keeps the first pass intact for the record)
  const letters = a.letters ? String(a.letters).split('') : null;
  const key = loadKey();
  fs.mkdirSync(CAND_DIR, { recursive: true });
  const cat = readCatalog();
  const manifest = loadManifest();

  const jobs = [];
  for (const item of cat.items) {
    const tier = tierOf(item);
    if (!tiers.includes(tier)) continue;
    if (only && !only.includes(item.itemNumber)) continue;
    const n = letters ? letters.length : nCand;
    for (let c = 0; c < n; c++) {
      const id = `${item.itemNumber}-${letters ? letters[c] : 'ab'[c] || c}`;
      const file = path.join(CAND_DIR, `${id}.jpg`);
      if (fs.existsSync(file) && !a.force) continue;
      jobs.push({ id, file, item, tier, variant: c });
    }
  }
  console.log(`[gen] ${jobs.length} candidate(s) to generate, model=${MODEL}, concurrency=${conc}`);
  let done = 0;
  const t0 = Date.now();
  const queue = jobs.slice();
  await Promise.all(
    Array.from({ length: conc }, async () => {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        const prompt = promptFor(job.item, job.variant);
        const r = await generateOne(key, prompt);
        done++;
        if (!r.ok) {
          console.log(`[gen] ${job.id} FAIL ${r.error}`);
          manifest[job.id] = { itemNumber: job.item.itemNumber, tier: job.tier, error: r.error };
          continue;
        }
        fs.writeFileSync(job.file, r.buf);
        const m = await metrics(job.file);
        manifest[job.id] = {
          itemNumber: job.item.itemNumber,
          name: job.item.name,
          category: job.item.category,
          tier: job.tier,
          variant: job.variant,
          file: job.file,
          bytes: r.buf.length,
          metrics: m,
        };
        console.log(
          `[gen] ${done}/${jobs.length} ${job.id} ok ${(r.buf.length / 1024) | 0}KB bg=${m.bgMin} cov=${m.coverage} flags=${(m.flags || []).join(',') || '-'}`
        );
        if (done % 10 === 0) saveManifest(manifest);
      }
    })
  );
  saveManifest(manifest);
  console.log(`[gen] complete in ${Math.round((Date.now() - t0) / 1000)}s`);
}

/** Rebuild the manifest from whatever is actually on disk (two gen runs overlapping can race on
 *  the manifest file; the candidate JPEGs are the source of truth). */
async function cmdReindex() {
  const cat = readCatalog();
  const byId = Object.fromEntries(cat.items.map((i) => [i.itemNumber, i]));
  const manifest = {};
  for (const f of fs.readdirSync(CAND_DIR).filter((f) => f.endsWith('.jpg'))) {
    const id = f.replace(/\.jpg$/, '');
    const itemNumber = id.split('-')[0];
    const item = byId[itemNumber];
    if (!item) continue;
    const file = path.join(CAND_DIR, f);
    manifest[id] = {
      itemNumber,
      name: item.name,
      category: item.category,
      tier: tierOf(item),
      file,
      bytes: fs.statSync(file).size,
      metrics: await metrics(file),
    };
  }
  saveManifest(manifest);
  const missing = cat.items.filter((i) => !Object.values(manifest).some((v) => v.itemNumber === i.itemNumber));
  console.log(`[reindex] ${Object.keys(manifest).length} candidates, ${missing.length} item(s) with none: ${missing.map((i) => i.itemNumber).join(',') || '-'}`);
}

/** Contact sheets for the human defect check: 4 candidates per sheet at 760px each. */
async function cmdSheets() {
  const a = args();
  const tiers = a.tier ? String(a.tier).split(',') : ['a', 'b', 'c', 'd'];
  const per = Number(a.per || 4);
  const cell = Number(a.cell || 760);
  const manifest = loadManifest();
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  const entries = Object.entries(manifest)
    .filter(([, v]) => v.file && fs.existsSync(v.file) && tiers.includes(v.tier))
    .sort(([x], [y]) => (x < y ? -1 : 1));
  const cols = per <= 2 ? per : 2;
  const rows = Math.ceil(per / cols);
  let n = 0;
  const sheets = [];
  for (let i = 0; i < entries.length; i += per) {
    const chunk = entries.slice(i, i + per);
    const composites = [];
    for (let k = 0; k < chunk.length; k++) {
      const [, v] = chunk[k];
      const buf = await sharp(v.file).resize(cell, cell, { fit: 'cover' }).toBuffer();
      composites.push({ input: buf, left: (k % cols) * cell, top: Math.floor(k / cols) * cell });
    }
    const name = path.join(SHEET_DIR, `sheet-${String(++n).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: '#c8c8c8' } })
      .composite(composites)
      .jpeg({ quality: 82 })
      .toFile(name);
    sheets.push({ sheet: name, cells: chunk.map(([id, v]) => `${id} ${v.name}`) });
    console.log(`[sheets] ${name}`);
    chunk.forEach(([id, v], k) => console.log(`   cell ${k + 1} (${'TL,TR,BL,BR'.split(',')[k] || k}): ${id} — ${v.name}`));
  }
  fs.writeFileSync(path.join(SHEET_DIR, 'index.json'), JSON.stringify(sheets, null, 1));
}

/** decisions.json: { "B412907": {"accept":"a","note":"…"} | {"accept":null,"note":"…"} } */
async function cmdWire() {
  const a = args();
  const dPath = a.decisions || path.join(WORK, 'decisions.json');
  const decisions = JSON.parse(fs.readFileSync(dPath, 'utf8'));
  const cat = readCatalog();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let accepted = 0;
  let nulled = 0;
  const report = [];
  for (const item of cat.items) {
    const d = decisions[item.itemNumber];
    const pick = d && d.accept ? d.accept : null;
    if (pick) {
      const src = path.join(CAND_DIR, `${item.itemNumber}-${pick}.jpg`);
      if (!fs.existsSync(src)) throw new Error(`accepted candidate missing: ${src}`);
      const dest = path.join(OUT_DIR, `${item.itemNumber}.jpg`);
      const info = await normalise(src, dest);
      item.image_url = `/live/img/${item.itemNumber}.jpg`;
      accepted++;
      report.push(`${item.itemNumber} accept ${pick} ${(info.bytes / 1024) | 0}KB q${info.quality} bg ${info.bgBefore}->${info.bgAfter}`);
    } else {
      item.image_url = null;
      nulled++;
      const stale = path.join(OUT_DIR, `${item.itemNumber}.jpg`);
      if (fs.existsSync(stale)) fs.unlinkSync(stale);
    }
  }
  fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 2) + '\n');
  console.log(report.join('\n'));
  console.log(`[wire] accepted=${accepted} placeholder=${nulled}`);
}

/** THE check: every image_url resolves to a real file, and no orphan files. */
function cmdVerify() {
  const cat = readCatalog();
  const referenced = new Set();
  let missing = 0;
  let nulls = 0;
  for (const item of cat.items) {
    if (item.image_url == null) {
      nulls++;
      continue;
    }
    const expect = `/live/img/${item.itemNumber}.jpg`;
    if (item.image_url !== expect) {
      console.log(`[verify] UNEXPECTED PATH ${item.itemNumber}: ${item.image_url}`);
      missing++;
      continue;
    }
    const f = path.join(ROOT, 'public', item.image_url);
    if (!fs.existsSync(f)) {
      console.log(`[verify] MISSING FILE ${item.image_url}`);
      missing++;
      continue;
    }
    referenced.add(path.basename(f));
  }
  // Beat 2b's staged rows live in staging.data.json, not the catalogue; a file named after one of
  // them is another lane's asset, not an orphan of this batch.
  const stagingFile = path.join(ROOT, 'src/demos/brighthour/staging.data.json');
  const staged = new Set();
  if (fs.existsSync(stagingFile)) {
    try {
      for (const it of JSON.parse(fs.readFileSync(stagingFile, 'utf8')).items || []) staged.add(`${it.itemNumber}.jpg`);
    } catch { /* staging is another lane's file; never fail on it */ }
  }
  const onDisk = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.jpg')) : [];
  const foreign = onDisk.filter((f) => !referenced.has(f) && staged.has(f));
  if (foreign.length) console.log(`[verify] NOT THIS BATCH (staged rows, left untouched): ${foreign.join(',')}`);
  const orphans = onDisk.filter((f) => !referenced.has(f) && !staged.has(f));
  let oversize = 0;
  for (const f of onDisk) {
    const b = fs.statSync(path.join(OUT_DIR, f)).size;
    if (b > 300 * 1024) {
      console.log(`[verify] OVERSIZE ${f} ${(b / 1024) | 0}KB`);
      oversize++;
    }
  }
  console.log(
    `[verify] items=${cat.items.length} withImage=${referenced.size} placeholder=${nulls} filesOnDisk=${onDisk.length} ` +
      `missing=${missing} orphans=${orphans.length}${orphans.length ? ' (' + orphans.join(',') + ')' : ''} oversize=${oversize}`
  );
  if (missing || orphans.length || oversize) process.exitCode = 1;
}

const cmd = process.argv[2];
const table = { gen: cmdGen, reindex: cmdReindex, sheets: cmdSheets, wire: cmdWire, verify: cmdVerify };
if (!table[cmd]) {
  console.log('usage: generate-bh-images.mjs <gen|sheets|wire|verify> [--tier a,b] [--candidates 2] [--concurrency 5] [--only ID,ID]');
  process.exit(1);
}
Promise.resolve(table[cmd]()).catch((e) => {
  console.error(e);
  process.exit(1);
});
