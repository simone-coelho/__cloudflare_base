#!/usr/bin/env node
// scripts/generate-vantage-art.mjs — the Vantage creative, generated once and committed.
//
// Adapted from scripts/generate-shn-art.mjs (the Top Offers promotion art). Same posture: generated at
// DESIGN TIME, inspected by a person, committed; never generated on the serving path. Three kinds:
//
//   promos/<id>.jpg       3:2 promotion tiles, named by the content id in L1's catalog.json. One locked recipe (red #EE0000, black,
//                         white, one small yellow #F5FF1E accent), editorial and photographic, no text.
//                         Where a promotion is about a phone, the background is an empty stage and the
//                         maker's own render (public/vantage/img/devices/, fetched by
//                         scripts/fetch-vantage-devices.mjs) is placed on it, so the phone is the real
//                         phone and never a model's guess at one. The page renders every title and badge.
//   heroes/<id>.png       hero art: the makers' renders composed on a transparent ground.
//   plans/<id>.svg|png    typographic plan tiles: Simple, Unlimited Go / Plus / Max.
//   modules/<id>.svg|png  typographic tiles for the phone-page modules.
//   placeholder-*.svg     palette placeholders; a missing image renders one, never a broken tag.
//
//   node scripts/generate-vantage-art.mjs                      tiles, then compose from whatever candidates exist (no model calls)
//   node scripts/generate-vantage-art.mjs --tiles              typographic tiles and placeholders (no network)
//   node scripts/generate-vantage-art.mjs --roll [--candidates 2] [--only k1,k2] [--force]
//                                                             roll background candidates a, b, ... into the work dir
//   node scripts/generate-vantage-art.mjs --compose            place the picked candidate + device, write promos/
//   node scripts/generate-vantage-art.mjs --sheet <png>        contact sheet of every candidate, for the defect check
//   node scripts/generate-vantage-art.mjs --preview <dir>      every candidate composed with its phone, judged as it ships
//   --work <dir>   where candidates live (default: OS temp dir). Only picked, composed tiles are committed.
//
// The loop that produced the committed set: --roll (two candidates each), --sheet and --preview, a person
// reads every candidate, each promotion's `pick` names the winner, --compose writes promos/ and heroes/, and GATE binds each verdict to
// the composed file's sha256. The candidates are not committed, so a re-roll is a new review, never a
// silent replacement: a changed file reads "pending" in MANIFEST.json until someone looks again.
//
// On a Windows checkout whose node_modules carries the Linux sharp binary, run it under WSL.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(import.meta.url)('sharp');

const MODEL = process.env.VANTAGE_ART_MODEL || 'gemini-3.1-flash-image';
const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
// argv is already sliced, so a flag at index 0 is real: `i >= 0`, not `i > 0`.
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMG = join(ROOT, 'public', 'vantage', 'img');
const MANIFEST = join(IMG, 'MANIFEST.json');
const WORK = arg('--work', process.env.VANTAGE_ART_WORK || join(tmpdir(), 'vantage-art-work'));
const W = 1200, H = 800; // 3:2, the card shape; ~150 KB a frame at quality 82

export const PALETTE = { red: '#EE0000', black: '#000000', white: '#FFFFFF', yellow: '#F5FF1E',
  ink: '#111111', grey: '#F2F2F2', line: '#D9D9D9' };
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif";

/**
 * The one locked recipe, applied to every prompt so a dozen tiles read as one campaign rather than a
 * dozen stock photos. It forbids text: the page renders titles and badges, which must stay changeable
 * ("Ends tonight" swaps the badge, not the picture). It forbids people and hands, which are where
 * image models fail a human check, and it switches every screen off, so no interface, and no carrier
 * mark, can appear inside a device.
 */
export const STYLE = 'Premium editorial studio photograph for a mobile carrier promotion. Strict palette: saturated signal red (#EE0000), '
  + 'deep black and clean white, with at most one small warm yellow (#F5FF1E) accent. Seamless paper set, crisp directional key light '
  + 'with soft fill, clean graphic shapes, sharp focus, photographic realism, generous negative space on the left third. '
  + 'ABSOLUTELY NO text, NO letters, NO numbers, NO logos, NO brand marks, NO watermarks, NO people, NO hands, NO faces. '
  + 'Any screen is switched off: plain dark glass with no interface.';
const STAGE = ' EMPTY STAGE: no phone, no device and no product anywhere in the frame; keep the centre-right of the frame clear, '
  + 'lit and uncluttered, ready for a product to be placed later.';

/**
 * The sets, each rolled once as two candidates (a, b) under the locked recipe. A set is never the
 * product: where a promotion is about a phone, the set is an empty stage and the maker's render is
 * placed on it. The names describe the set, because one set serves more than one promotion (its two
 * candidates are different frames, so no two tiles share a picture).
 */
export const BACKGROUNDS = {
  'red-arches': { stage: true,
    scene: 'A seamless deep red paper set; tall sculptural curves of white and black paper arc in from the left edge; a soft white glow of light pools on the floor at centre-right; one thin warm yellow line of light runs along the floor.' },
  'red-dusk': { stage: true,
    scene: 'The same seamless red paper set at dusk: deeper shadows, the paper curves at the left in near silhouette, one warm concentrated pool of light at centre-right, a single thin yellow light streak, an urgent end-of-sale evening mood, shot a little closer.' },
  'white-disc': { stage: true,
    scene: 'A clean white seamless set; a large bold red paper disc stands behind the centre-right like a rising sun; a black paper ribbon curls across the lower left corner; soft natural shadows.' },
  'black-circles': { stage: true,
    scene: 'A black seamless set; two large overlapping red paper circles glow softly behind the centre-right; a soft top light; one thin yellow line accent on the floor.' },
  'black-arc': { stage: true,
    scene: 'A black seamless set; a soft red glow rises behind the centre-right; a thin white arc of light curves across the floor; calm and luxurious.' },
  'white-plinth': { stage: true,
    scene: 'A warm white seamless set; a long low red plinth runs across the lower centre of the frame; a few black paper geometric shapes lean at the left edge; soft daylight.' },
  'red-acrylic': { stage: true,
    scene: 'A red seamless set; a tall curved panel of clear acrylic stands at centre-right catching a crisp highlight along its edge; soft white light; a black paper arc at the lower left.' },
  'black-bag': {
    scene: 'Black Friday still life: a glossy black paper shopping bag with black rope handles and red tissue paper spilling from the top, standing on a black seamless set with a red rim light; a small blank yellow card tag with no writing hangs from one handle.' },
  'watch-tablet': {
    scene: 'Editorial still life of a generic smartwatch with a plain black sport band and a generic slim tablet, both screens switched off as dark glass, resting on stacked red and white paper blocks on a white seamless set, crisp shadows.' },
  'home-console': {
    scene: 'A sleek plain white cylindrical home internet router with no markings and no lights on a light oak console table in a calm living room; a red painted wall behind; a black paper lamp shade; soft daylight from the left.' },
  'accessories': {
    scene: 'Top-down flat lay on a red seamless paper surface: a plain white wireless earbuds charging case, a coiled braided white charging cable, a round white magnetic wireless charging puck and a plain black silicone phone case with no phone inside, arranged on a neat grid with generous spacing and crisp shadows; nothing printed on any object.' },
  'gift-box': {
    scene: 'A gift box wrapped in glossy red paper with a warm yellow satin ribbon and bow on a black seamless set, soft top light, a few scattered white paper confetti circles on the floor.' },
  'sim-card': {
    scene: 'Macro still life of a single blank white nano SIM card with gold contacts and a small silver SIM ejector pin on a glossy red surface, strong soft shadow, the background falling off to white at the top; no printing on the card.' },
  'black-slash': { stage: true,
    scene: 'A black seamless set; one sharp diagonal slash of saturated red light cuts across the back wall like a lightning stroke; a single thin warm yellow line of light on the floor; crisp, high-energy, urgent; the centre-right of the floor is lit.' },
  'popcorn': {
    scene: 'Evening still life for a streaming night in: a generous bowl of fresh popcorn in a plain white ceramic bowl on a folded red wool throw, on a black set, lit warmly from the front as if by an unseen screen; no screen, no remote control, no packaging, nothing printed.' },
};

/**
 * The promotion tiles, keyed by the content id L1's catalog names (public/vantage/catalog.json,
 * `customerContentId`), so scripts/seed-vantage.mjs finds each at /vantage/img/promos/<id>.jpg.
 * `bg` and `pick` name the set and the candidate that shipped; `layout` is fitted to that candidate.
 * `variantOf` is the same promotion behind a different frame: Top Offers' Final Hours pattern, the
 * content id and its learning kept, the creative swapped ("Ends tonight" is the page's badge).
 */
export const PROMOS = [
  { key: 'promo-iphone-18-pro-launch', bg: 'red-arches', pick: 'a', device: ['iphone-18-pro'] },
  { key: 'promo-iphone-18-pro-launch-final', variantOf: 'promo-iphone-18-pro-launch', bg: 'red-dusk', pick: 'a', device: ['iphone-18-pro'] },
  { key: 'promo-galaxy-s26-new-line', bg: 'white-disc', pick: 'a', device: ['galaxy-s26'] },
  { key: 'promo-four-lines', bg: 'white-plinth', pick: 'b', device: ['iphone-17', 'galaxy-s26', 'pixel-11', 'razr-2026'],
    layout: { centres: [0.35, 0.5, 0.65, 0.8], boxW: 0.21, boxH: 0.52, bottom: 0.735 } },
  { key: 'promo-bring-your-phone', bg: 'sim-card', pick: 'a' },
  { key: 'promo-pixel-11-launch', bg: 'black-circles', pick: 'b', device: ['pixel-11'], layout: { centres: [0.42], boxH: 0.74 } },
  { key: 'promo-pixel-11-season', bg: 'black-arc', pick: 'b', device: ['pixel-11'], layout: { centres: [0.44], boxH: 0.78 } },
  { key: 'promo-iphone-duo-preorder', bg: 'black-arc', pick: 'a', device: ['iphone-duo'] },
  { key: 'promo-galaxy-s26-ultra-upgrade', bg: 'red-acrylic', pick: 'b', device: ['galaxy-s26-ultra'] },
  { key: 'promo-iphone-18-pro-upgrade', bg: 'white-disc', pick: 'b', device: ['iphone-18-pro-max', 'iphone-18-pro'],
    layout: { centres: [0.56, 0.79], boxW: 0.3, boxH: 0.76 } },
  { key: 'promo-galaxy-z-fold8-trade-in', bg: 'red-acrylic', pick: 'a', device: ['galaxy-z-fold8'] },
  { key: 'promo-iphone-17-new-line', bg: 'white-plinth', pick: 'a', device: ['iphone-17'], layout: { centres: [0.5], boxH: 0.6, bottom: 0.7 } },
  { key: 'promo-razr-new-line', bg: 'red-dusk', pick: 'b', device: ['razr-2026'] },
  { key: 'promo-moto-g-flash', bg: 'red-arches', pick: 'b', device: ['moto-g-2026'] },
  { key: 'promo-watch-tablet-line', bg: 'watch-tablet', pick: 'a' },
  { key: 'promo-streaming-perk', bg: 'popcorn', pick: 'a' },
  { key: 'promo-5g-home', bg: 'home-console', pick: 'a' },
  { key: 'promo-black-friday-switch', bg: 'black-bag', pick: 'a' },
  // The flash cut seen on verizon.com on 2026-09-30 (edge 2026, $289.99 off on Simplicity, "Ends Wednesday").
  { key: 'promo-edge-flash', bg: 'black-slash', pick: 'a', device: ['edge-2026'] },
  // The lead's list names these two; catalog.json carries no piece for them yet. Ready if it does.
  { key: 'promo-accessories', bg: 'accessories', pick: 'a' },
  { key: 'promo-loyalty', bg: 'gift-box', pick: 'a' },
];

/**
 * The hero art: the makers' renders composed on a transparent ground, because the page paints the
 * hero's art over its own dark-red gradient (vantage.css .hero-art). `hero-continue` is deliberately
 * absent: that hero paints the shopper's own configuration, so a fixed picture would contradict it.
 */
export const HEROES = [
  { key: 'hero-launch', device: ['iphone-18-pro-max', 'iphone-18-pro'], layout: { centres: [0.36, 0.64], boxW: 0.44, boxH: 0.88, bottom: 0.95 } },
  { key: 'hero-family', device: ['iphone-17', 'galaxy-s26', 'pixel-11', 'razr-2026'], layout: { centres: [0.22, 0.41, 0.6, 0.79], boxW: 0.28, boxH: 0.7, bottom: 0.9 } },
  { key: 'hero-switch', device: ['galaxy-s26-plus', 'iphone-17'], layout: { centres: [0.38, 0.62], boxW: 0.44, boxH: 0.86, bottom: 0.94 } },
];

/**
 * The human defect check on the exact composed file: the verdict holds only while the file's sha256
 * matches the one reviewed. A candidate the check rejected is named with its reason.
 */
const ACCEPT = (sha, note, rejected = []) => ({ verdict: 'accept', checked: '2026-09-30', sha, note, rejected });
export const GATE = {
  'promo-iphone-18-pro-launch': ACCEPT('0a24d799a44bdd4e2092caab37b8f16da099ff17bf0e0c7aca15171b730bc0e8', "Red set, white and black paper arches, a yellow floor line; Apple’s burgundy render stands in the pool of light with a contact shadow. No text; the only mark is Apple’s own on the device.", ["red-arches-b: no defect; used for the moto g flash instead"]),
  'promo-iphone-18-pro-launch-final': ACCEPT('b8f926aa3b9d170a85150f93bb077ecf758f9482c043fb216ddc3c94b2656640', "The same promotion at dusk: a visibly different frame (dark set, one yellow streak) around the identical device, so Ends tonight reads as new creative on the same id.", ["red-dusk-b: no defect; used for the razr instead"]),
  'promo-galaxy-s26-new-line': ACCEPT('c7487ea0076710f60f128f25a7e925ef0c2db148c84df9882cd5cb3004a6a172', "White Galaxy S26 in front of the red disc; the phone’s own grey outline holds it on the white set; the window frame at the right edge belongs to the set.", ["white-disc-b: no defect; used for the iPhone 18 Pro upgrade instead"]),
  'promo-four-lines': ACCEPT('c1e3c18771cc72676fbfc1c91e12d461ec4b1da039d9ee62b0b609b047ac1887', "iPhone 17, Galaxy S26, Pixel 11 and razr on the red plinth: four lines, four makers, all inside the frame. The razr is Motorola’s floating press render, so it sits a touch high: recorded.", ["white-plinth-a (as the three-phone version): the plinth sat beside the phones and the right-hand phone ran to the frame edge"]),
  'promo-bring-your-phone': ACCEPT('1cce91b833266c6e8ab6c1628837cea62be65d97d0d0e93186daebcc47c81c64', "A blank SIM card (checked: no printing) and an ejector pin; the chip’s reflection on the glossy red is physically consistent.", ["sim-card-b: no defect"]),
  'promo-pixel-11-launch': ACCEPT('eaf8c33938551fc9490ca8f9660c70d89f6b4816427caebe60c4ac09f8fa784f', "Pixel 11 left of centre (layout fitted) so the two glowing circles stay in view; yellow floor line.", ["black-circles-a: the circles sit exactly behind the phone and vanish"]),
  'promo-pixel-11-season': ACCEPT('5882bab6894384d42b88c3b7da48a252a1c13cceca2174aa500c67cc03d89a76', "Pixel 11 shifted left (layout fitted) to reveal the red glow and the white floor arc; a different frame from the launch tile, as the two-weeks beat needs.", []),
  'promo-iphone-duo-preorder': ACCEPT('9a08a72540dfbb4d9afe8e80addb981719a4dd798c417e9c8c1807d0440a1b99', "White arc and red glow frame the open Duo; clean.", []),
  'promo-galaxy-s26-ultra-upgrade': ACCEPT('264b51a6be436291c0413b4c6f36de4ac88d1e1c375913d28857f56d0ee38ffd', "Galaxy S26 Ultra render in front of the curved clear panel; S Pen as Samsung shoots it.", []),
  'promo-iphone-18-pro-upgrade': ACCEPT('e7904f1201f04f4796d3f5ac95b62c929d2b5bc3cfa23b60fe53ac8c74a991f2', "iPhone 18 Pro Max (Glacier) and iPhone 18 Pro (Burgundy) in front of the red disc: the family for an upgrade offer; Apple marks only.", []),
  'promo-galaxy-z-fold8-trade-in': ACCEPT('cae0ce51d1370f1a2e7a0a9bd7bd3050486084877f005c94c2d0d82948768038', "Z Fold8 in front of the clear panel, black floor ring; clean.", []),
  'promo-iphone-17-new-line': ACCEPT('04f9d222e773f9664f1c4c8eabc5ede3249d24f7918eac3a48cf1e1806d48bb6', "iPhone 17 standing on the red plinth (layout fitted); black paper shapes and one yellow accent at the left.", []),
  'promo-razr-new-line': ACCEPT('7d8ce4f86fad7595ed50fa9c6cfa0600dff69c7df209e99bd8f8d786cbb192c1', "Motorola’s razr press render over the dark red set; lock screens show the maker’s time and date, no carrier.", []),
  'promo-moto-g-flash': ACCEPT('121ddeb5d2e140c6e158196177dcda416fc25f9192bd2b9899b82bfc3b39f657', "moto g press pair on the red set with the arches and floor line; lock screen time and date only.", []),
  'promo-watch-tablet-line': ACCEPT('4de88705288e00cf9552cbd7cf88549cd8536e2d2a6b1e3ab4d42a573422b1f8', "Generic watch and tablet, screens off as dark glass, no marks; strap holes and pin coherent.", ["watch-tablet-b: no defect"]),
  'promo-streaming-perk': ACCEPT('03ad9c668e8882684431d1e70f306be300944d428aeb95dd8e911465b552d381', "A bowl of popcorn on a folded red throw, black set; no screen, no remote, nothing printed.", ["popcorn-b: no defect; a has the cleaner negative space"]),
  'promo-5g-home': ACCEPT('a7209957e18d764f6e76f09db013ecf9a32afa66c88173bc0b6e67a052e5066c', "A plain white cylinder router with no light and no mark on an oak console; the mirror shows only furniture.", ["home-console-b: the framed print’s black brush stroke reads as a letter"]),
  'promo-black-friday-switch': ACCEPT('694fd1e905e8ad7383cd71e426c3ab5b7f30e545e7d1f21e519d62d5ea6bbcae', "Black bag, red tissue, a yellow tag checked blank; handles and tag string coherent.", ["black-bag-b: no defect"]),
  'promo-edge-flash': ACCEPT('a01d2ddd93eb12dca712cb55eecf8b555916dea8690a0f9c449b30755bb17d42', "Motorola’s edge press pair in front of a red diagonal slash of light on a black set, one yellow floor line; the lock screen shows the render’s own time and date, no carrier; no other text or marks.", ["black-slash-b: no defect, the slash hides behind the phone"]),
  'promo-accessories': ACCEPT('7b3400711b1115345f08e7f01ba26d870d71dd0be8ec6153db2269a05ad8ce42', "Blank earbuds case, cable with USB-C ends, charging puck, black case; nothing printed.", ["accessories-b: an EU two-pin wall plug, wrong for a US carrier"]),
  'promo-loyalty': ACCEPT('bdea727f02e40352ef5fce4de5382f62771b54d7ccc7de86f30feed093e45186', "The ribbon crosses the box correctly and the bow is attached; no tag, no text.", ["gift-box-b: no defect"]),
  'hero-launch': ACCEPT('f9a452475b1c8f2fd8df6319a91109ee9e2b0067386d0e06c217b6f57c8ea4b7', "iPhone 18 Pro Max and 18 Pro on a transparent ground, for the page’s own dark-red hero gradient.", []),
  'hero-family': ACCEPT('ba5ac47c3d721309c260c5ebb25ef751c4fb9bd2822b71cca6521f86e413ced3', "iPhone 17, Galaxy S26, Pixel 11 and razr on a transparent ground.", []),
  'hero-switch': ACCEPT('7df4672c00bb1b0463be66d304481971f6c2194b81c77643b3724daea5c7450a', "Galaxy S26+ and iPhone 17 on a transparent ground: bring either kind of phone.", []),
};

/**
 * Plan and module tiles, named by the content ids in L1's catalog (plan-simple ... plan-max; the seven
 * phone-page modules). Plan names are the lead's ruling and are authoritative here: Simple, Unlimited Go,
 * Unlimited More, Unlimited Max (the middle tier was renamed from "Unlimited Plus" on 2026-09-30). A
 * plans.json that still disagrees is reported, not followed, so the tiles carry the ruling while L1
 * catches up. The tile id is `plan-more`, matching the piece id L1 renames to (2026-09-30). `aliases`
 * would write the same tile under a second id; none is needed now. Module titles come from catalog.json.
 */
export const PLANS = [
  { id: 'plan-simple', tierOf: 'simple', name: 'Simple', line: 'One plan. One price per line.', tier: 0, ground: 'white' },
  { id: 'plan-go', tierOf: 'go', name: 'Unlimited Go', line: 'Unlimited 5G, the essentials.', tier: 1, ground: 'red' },
  { id: 'plan-more', tierOf: 'more', name: 'Unlimited More', line: 'Premium 5G and more hotspot.', tier: 2, ground: 'red' },
  { id: 'plan-max', tierOf: 'max', name: 'Unlimited Max', line: 'Everything, everywhere.', tier: 3, ground: 'black' },
];

export const MODULES = [
  { id: 'storage-memory', name: 'Storage & memory', line: 'Room for every photo.', icon: 'storage' },
  { id: 'plan-pairing', name: 'Pair with a plan', line: 'The plan that fits the phone.', icon: 'sim' },
  { id: 'trade-in', name: 'Trade in and save', line: 'Your old phone, working for you.', icon: 'trade' },
  { id: 'protection', name: 'Protect your phone', line: 'Cover for drops, loss and theft.', icon: 'shield' },
  { id: 'accessories', name: 'Accessories', line: 'Cases, chargers, sound.', icon: 'accessories' },
  { id: 'connected-devices', name: 'Watch, tablet and more lines', line: 'Add a connected device.', icon: 'connected' },
  { id: 'home-bundle', name: 'Add home internet', line: 'Mobile and home, together.', icon: 'home' },
];

/** A heading size that fits the tile: bold grotesque glyphs average about 0.56 em. */
const fitSize = (text, max, width = 1000) => Math.max(56, Math.min(max, Math.floor(width / (String(text).length * 0.56))));

// ---------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const raw = readFileSync(join(ROOT, '.dev.vars'), 'utf8');
  const m = /^GEMINI_API_KEY=(.*)$/m.exec(raw);
  if (!m) throw new Error('GEMINI_API_KEY is not set and is not in .dev.vars');
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

async function generateOne(key, prompt) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } },
  });
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await sleep(1500 * 2 ** attempt + Math.random() * 800);
    let r;
    try {
      r = await fetch(`${GLAPI}/models/${MODEL}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
        signal: AbortSignal.timeout(150000),
      });
    } catch (e) { lastErr = `fetch ${e.message}`; continue; }
    if (!r.ok) {
      lastErr = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`;
      if (r.status < 500 && r.status !== 429) break;
      continue;
    }
    const j = await r.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
    if (!part?.data) { lastErr = `no image (finish=${j?.candidates?.[0]?.finishReason})`; continue; }
    return { ok: true, buf: Buffer.from(part.data, 'base64') };
  }
  return { ok: false, error: lastErr };
}

const promptOf = (bgKey) => `${BACKGROUNDS[bgKey].scene}${BACKGROUNDS[bgKey].stage ? STAGE : ''} ${STYLE}`;
const candidateFile = (bgKey, letter) => join(WORK, `${bgKey}-${letter}.jpg`);
const LETTERS = 'abcdefgh';

async function roll() {
  mkdirSync(WORK, { recursive: true });
  const only = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const n = Math.max(1, Math.min(6, Number(arg('--candidates', '2')) || 2));
  const jobs = [];
  for (const bg of Object.keys(BACKGROUNDS)) {
    if (only.length && !only.includes(bg)) continue;
    for (let i = 0; i < n; i += 1) {
      const file = candidateFile(bg, LETTERS[i]);
      if (!has('--force') && existsSync(file)) continue;
      jobs.push({ bg, file, letter: LETTERS[i] });
    }
  }
  const key = jobs.length ? apiKey() : '';
  console.log(`roll: ${jobs.length} candidate(s), model=${MODEL}, work ${WORK}`);
  let made = 0, failed = 0;
  // Three at a time at most: two overlapping runs at five each once hit a spend-based 429 (BrightHour-Imagery-QA.md).
  const queue = [...jobs];
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const job = queue.shift();
      const res = await generateOne(key, promptOf(job.bg));
      if (!res.ok) { failed += 1; console.log(`  ${job.bg}-${job.letter} failed (${res.error})`); continue; }
      const out = await sharp(res.buf).resize(W, H, { fit: 'cover', position: 'centre' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      writeFileSync(job.file, out);
      made += 1;
      console.log(`  ${job.bg}-${job.letter} ${Math.round(out.length / 1024)}KB`);
    }
  }));
  console.log(`roll: ${made} generated, ${failed} failed`);
}

/** The maker's render, trimmed to its content, as a PNG buffer with its size. */
async function deviceCut(id) {
  const file = join(IMG, 'devices', `${id}.webp`);
  if (!existsSync(file)) throw new Error(`device image missing: devices/${id}.webp (run scripts/fetch-vantage-devices.mjs)`);
  const trimmed = await sharp(file).trim({ threshold: 1 }).png().toBuffer();
  const m = await sharp(trimmed).metadata();
  return { buf: trimmed, width: m.width, height: m.height };
}

/** A soft contact shadow: a blurred black ellipse under the product, so it sits on the set and does not float. */
function shadowSvg(w, h, opacity = 0.34) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2.4}" ry="${h / 3}" fill="#000" fill-opacity="${opacity}"/></svg>`);
}

async function placeDevices(ids, layout = {}) {
  const layers = [];
  const n = ids.length;
  const boxH = H * (layout.boxH ?? (n === 1 ? 0.8 : 0.62));
  const boxW = W * (layout.boxW ?? (n === 1 ? 0.5 : 0.26));
  const centres = layout.centres ?? (n === 1 ? [0.68] : n === 2 ? [0.6, 0.8] : [0.5, 0.68, 0.86]);
  for (let i = 0; i < n; i += 1) {
    const d = await deviceCut(ids[i]);
    const s = Math.min(boxW / d.width, boxH / d.height);
    const w = Math.round(d.width * s), h = Math.round(d.height * s);
    const img = await sharp(d.buf).resize(w, h).png().toBuffer();
    const cx = Math.round(W * centres[i]);
    const bottom = Math.round(H * (layout.bottom ?? (n === 1 ? 0.9 : 0.84)));
    const left = cx - Math.round(w / 2), top = bottom - h;
    const sw = Math.round(w * 0.95), sh = Math.max(24, Math.round(h * 0.07));
    const shadow = await sharp(shadowSvg(sw, sh)).blur(Math.max(6, Math.round(sh / 3))).png().toBuffer();
    layers.push({ input: shadow, left: cx - Math.round(sw / 2), top: bottom - Math.round(sh / 2) });
    layers.push({ input: img, left, top });
  }
  return layers;
}

const composeTile = async (src, p) => sharp(src).resize(W, H, { fit: 'cover' })
  .composite(p.device ? await placeDevices(p.device, p.layout) : []).jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
const composeHero = async (h) => sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(await placeDevices(h.device, h.layout)).png({ palette: true, quality: 100, colours: 256, dither: 1, compressionLevel: 9 }).toBuffer();

/** Every tile composed from every candidate of its set, into a scratch directory, judged as it would ship. */
async function preview(dir) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const p of PROMOS) {
    for (const letter of LETTERS) {
      const src = candidateFile(p.bg, letter);
      if (!existsSync(src)) break;
      writeFileSync(join(dir, `${p.key}--${letter}.jpg`), await composeTile(src, p));
      n += 1;
    }
  }
  for (const h of HEROES) { writeFileSync(join(dir, `${h.key}.png`), await composeHero(h)); n += 1; }
  console.log(`preview: ${n} composed tiles in ${dir}`);
}

/** Titles and badges come from L1's catalog when it exists: the art never disagrees with the page about what a tile is. */
function catalogById() {
  try {
    const c = JSON.parse(readFileSync(join(ROOT, 'public', 'vantage', 'catalog.json'), 'utf8'));
    return new Map((c.pieces || []).map((x) => [x.customerContentId || x.id, x]));
  } catch { return new Map(); }
}

async function compose() {
  mkdirSync(join(IMG, 'promos'), { recursive: true });
  mkdirSync(join(IMG, 'heroes'), { recursive: true });
  const manifest = readManifest();
  const catalog = catalogById();
  const rows = [], heroRows = [];
  for (const p of PROMOS) {
    const src = candidateFile(p.bg, p.pick);
    const piece = catalog.get(p.key) || catalog.get(p.variantOf);
    const row = { key: p.key, catalogId: piece?.id ?? null, variantOf: p.variantOf || null, title: piece?.title ?? null,
      generated: true, model: MODEL, method: p.device ? 'generated empty stage + the maker\'s render placed on it' : 'generated still life',
      devices: p.device || [], set: p.bg, candidate: p.pick, prompt: promptOf(p.bg) };
    const committed = join(IMG, 'promos', `${p.key}.jpg`);
    if (!existsSync(src)) {
      // The candidates are not committed. Without them the reviewed tile on disk is kept exactly as it is,
      // so a checkout that never rolled can re-run this without losing or replacing reviewed art.
      if (existsSync(committed)) {
        const buf = readFileSync(committed);
        rows.push({ ...row, file: `promos/${p.key}.jpg`, size: { width: W, height: H }, bytes: buf.length, sha256: sha256(buf) });
        console.log(`  ${p.key} kept (no candidate ${p.bg}-${p.pick} in the work dir)`);
      } else rows.push({ ...row, file: null, placeholder: 'placeholder-promo.svg', gate: { verdict: 'missing', note: `no candidate ${p.bg}-${p.pick} in ${WORK}` } });
      continue;
    }
    try {
      const out = await composeTile(src, p);
      writeFileSync(join(IMG, 'promos', `${p.key}.jpg`), out);
      rows.push({ ...row, file: `promos/${p.key}.jpg`, size: { width: W, height: H }, bytes: out.length, sha256: sha256(out) });
      console.log(`  ${p.key} ← ${p.bg}-${p.pick}${p.device ? ` + ${p.device.join(', ')}` : ''}  ${Math.round(out.length / 1024)}KB`);
    } catch (e) {
      rows.push({ ...row, file: null, placeholder: 'placeholder-promo.svg', gate: { verdict: 'missing', note: e.message } });
      console.log(`  ${p.key} failed (${e.message})`);
    }
  }
  for (const h of HEROES) {
    const piece = catalog.get(h.key);
    try {
      const out = await composeHero(h);
      writeFileSync(join(IMG, 'heroes', `${h.key}.png`), out);
      heroRows.push({ key: h.key, catalogId: piece?.id ?? null, title: piece?.title ?? null, generated: false,
        method: 'the makers\' renders composed on a transparent ground', devices: h.device, file: `heroes/${h.key}.png`,
        size: { width: W, height: H }, bytes: out.length, sha256: sha256(out) });
      console.log(`  ${h.key} ← ${h.device.join(', ')}  ${Math.round(out.length / 1024)}KB`);
    } catch (e) { heroRows.push({ key: h.key, file: null, gate: { verdict: 'missing', note: e.message } }); }
  }
  // Tiles this script wrote earlier under names it no longer ships are removed, so the manifest and the
  // directory never disagree. Only files this script owns by name are touched.
  const keep = new Set(PROMOS.map((p) => `${p.key}.jpg`));
  for (const f of readdirSync(join(IMG, 'promos'))) if (f.endsWith('.jpg') && !keep.has(f)) { unlinkSync(join(IMG, 'promos', f)); console.log(`  removed stale promos/${f}`); }
  for (const r of [...rows, ...heroRows]) {
    if (!r.file) continue;
    const g = GATE[r.key];
    r.gate = g && g.sha === r.sha256 ? { verdict: g.verdict, checked: g.checked, note: g.note, rejected: g.rejected || [] }
      : { verdict: 'pending', note: 'not yet checked by eye for this exact file' };
  }
  manifest.promos = rows;
  manifest.heroes = heroRows;
  writeManifest(manifest);
}

// ---------------------------------------------------------------------------------------------------
// Typographic tiles. Deterministic SVG, rendered to PNG as well so every browser shows the same type.

const ICONS = {
  storage: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linejoin="round"><rect x="20" y="30" width="200" height="44" rx="12"/><rect x="20" y="98" width="200" height="44" rx="12"/><rect x="20" y="166" width="200" height="44" rx="12"/></g><g fill="${c}"><circle cx="190" cy="52" r="9"/><circle cx="190" cy="120" r="9"/><circle cx="190" cy="188" r="9"/></g>`,
  sim: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linejoin="round"><path d="M50 20 H160 L210 70 V220 H50 Z"/><rect x="88" y="104" width="84" height="84" rx="10"/><path d="M130 104 V188 M88 146 H172"/></g>`,
  trade: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M40 110 A80 80 0 0 1 180 60"/><path d="M150 40 L184 62 L162 96"/><path d="M200 130 A80 80 0 0 1 60 180"/><path d="M90 200 L56 178 L78 144"/></g>`,
  shield: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linejoin="round"><path d="M120 20 L205 52 V120 C205 172 168 206 120 224 C72 206 35 172 35 120 V52 Z"/><path d="M120 62 L170 82 V122 C170 152 150 172 120 184 Z" fill="${c}" stroke="none"/></g>`,
  accessories: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><rect x="24" y="60" width="110" height="130" rx="40"/><path d="M24 104 H134"/><path d="M170 40 V120 C170 170 214 170 214 120 V100"/><rect x="156" y="20" width="28" height="30" rx="6" fill="${c}"/></g>`,
  connected: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linejoin="round"><rect x="14" y="40" width="130" height="170" rx="16"/><path d="M60 188 H98"/><rect x="164" y="84" width="66" height="78" rx="18"/><path d="M180 84 V52 H214 V84 M180 162 V194 H214 V162"/></g>`,
  home: (c) => `<g fill="none" stroke="${c}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><path d="M30 120 L120 44 L210 120"/><path d="M56 100 V214 H184 V100"/><path d="M92 170 A40 40 0 0 1 148 170"/><path d="M72 146 A70 70 0 0 1 168 146"/><circle cx="120" cy="192" r="8" fill="${c}"/></g>`,
};

export function planSvg(p) {
  const g = { white: [PALETTE.white, PALETTE.red, PALETTE.ink], red: [PALETTE.red, PALETTE.white, PALETTE.white], black: [PALETTE.black, PALETTE.white, PALETTE.white] }[p.ground];
  const [bg, title, sub] = g;
  const dots = [0, 1, 2].map((i) => `<rect x="${96 + i * 64}" y="600" width="48" height="16" rx="8" fill="${i < p.tier ? PALETTE.yellow : (p.ground === 'white' ? PALETTE.line : 'rgba(255,255,255,0.35)')}"/>`).join('');
  const rule = p.ground === 'white' ? PALETTE.red : PALETTE.yellow;
  const words = p.name.split(' ');
  const big = words.length > 1 ? `<text x="96" y="330" font-family="${FONT}" font-size="64" font-weight="700" fill="${sub}" opacity="0.9">${esc(words[0])}</text>
  <text x="90" y="470" font-family="${FONT}" font-size="168" font-weight="800" letter-spacing="-5" fill="${title}">${esc(words.slice(1).join(' '))}</text>`
    : `<text x="90" y="470" font-family="${FONT}" font-size="168" font-weight="800" letter-spacing="-5" fill="${title}">${esc(p.name)}</text>`;
  // the horizon motif ("See further."): concentric arcs rising from the lower right, faint
  const arcColour = p.ground === 'white' ? PALETTE.red : PALETTE.white;
  const arcs = [260, 400, 540].map((r) => `<circle cx="1200" cy="800" r="${r}" fill="none" stroke="${arcColour}" stroke-width="18" stroke-opacity="${p.ground === 'white' ? 0.12 : 0.16}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  ${arcs}
  ${p.ground === 'white' ? `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${PALETTE.line}" stroke-width="4"/>` : ''}
  <rect x="96" y="150" width="120" height="12" fill="${rule}"/>
  ${big}
  <text x="96" y="540" font-family="${FONT}" font-size="44" font-weight="500" fill="${sub}">${esc(p.line)}</text>
  ${p.tier ? dots : ''}
</svg>
`;
}

export function moduleSvg(m) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PALETTE.white}"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${PALETTE.line}" stroke-width="4"/>
  <rect x="0" y="0" width="24" height="${H}" fill="${PALETTE.red}"/>
  <g transform="translate(96 96) scale(0.9)">${ICONS[m.icon](PALETTE.red)}</g>
  <text x="92" y="480" font-family="${FONT}" font-size="${fitSize(m.name, 96)}" font-weight="800" letter-spacing="-3" fill="${PALETTE.ink}">${esc(m.name)}</text>
  <rect x="98" y="520" width="140" height="12" fill="${PALETTE.yellow}"/>
  <text x="96" y="620" font-family="${FONT}" font-size="44" font-weight="500" fill="#444444">${esc(m.line)}</text>
</svg>
`;
}

export function placeholderDeviceSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="${PALETTE.grey}"/>
  <rect x="290" y="130" width="220" height="440" rx="36" fill="${PALETTE.white}" stroke="${PALETTE.line}" stroke-width="10"/>
  <rect x="370" y="150" width="60" height="14" rx="7" fill="${PALETTE.line}"/>
  <rect x="340" y="620" width="120" height="10" fill="${PALETTE.red}"/>
</svg>
`;
}

export function placeholderPromoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PALETTE.red}"/>
  <path d="M0 800 L0 520 C260 460 520 620 760 800 Z" fill="${PALETTE.black}"/>
  <circle cx="900" cy="330" r="190" fill="${PALETTE.white}" fill-opacity="0.14"/>
  <rect x="96" y="150" width="120" height="12" fill="${PALETTE.yellow}"/>
</svg>
`;
}

async function writeTile(dir, id, svg) {
  mkdirSync(join(IMG, dir), { recursive: true });
  const svgPath = join(IMG, dir, `${id}.svg`), pngPath = join(IMG, dir, `${id}.png`);
  writeFileSync(svgPath, svg);
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  writeFileSync(pngPath, png);
  return { svg: `${dir}/${id}.svg`, png: `${dir}/${id}.png`, bytes: { svg: Buffer.byteLength(svg), png: png.length } };
}

async function tiles() {
  const manifest = readManifest();
  // The lead's plan names are authoritative; a plans.json that still disagrees is reported, not followed.
  const plansJson = join(ROOT, 'public', 'vantage', 'plans.json');
  const drift = [];
  if (existsSync(plansJson)) {
    try {
      const raw = JSON.parse(readFileSync(plansJson, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw.plans || raw.tiers || [];
      for (const p of PLANS) {
        const hit = list.find((x) => x.id === p.tierOf || x.id === p.id);
        if (hit?.name && hit.name !== p.name) drift.push(`plans.json names tier '${hit.id}' "${hit.name}"; the tile carries the ruling, "${p.name}"`);
      }
    } catch { /* unreadable: nothing to compare */ }
  }
  for (const d of drift) console.log(`  note: ${d}`);
  manifest.plans = [];
  for (const p of PLANS) {
    for (const id of [p.id, ...(p.aliases || [])]) {
      manifest.plans.push({ id, name: p.name, ...(id !== p.id ? { aliasOf: p.id, note: 'the catalog\x27s current content id for this tier' } : {}),
        generated: false, method: 'typographic SVG, deterministic', files: await writeTile('plans', id, planSvg(p)) });
    }
  }
  if (drift.length) manifest.planNameDrift = drift; else delete manifest.planNameDrift;
  const catalog = catalogById();
  const modules = MODULES.map((m) => { const hit = catalog.get(m.id); return hit?.title ? { ...m, name: hit.title } : m; });
  // tiles written earlier under ids this script no longer ships are removed (only its own files, by name)
  for (const [dir, list] of [['plans', PLANS], ['modules', modules]]) {
    const keep = new Set(list.flatMap((x) => [x.id, ...(x.aliases || [])]).flatMap((id) => [`${id}.svg`, `${id}.png`]));
    for (const f of existsSync(join(IMG, dir)) ? readdirSync(join(IMG, dir)) : []) if (!keep.has(f)) { unlinkSync(join(IMG, dir, f)); console.log(`  removed stale ${dir}/${f}`); }
  }
  manifest.modules = [];
  for (const m of modules) manifest.modules.push({ id: m.id, name: m.name, generated: false, method: 'typographic SVG, deterministic', files: await writeTile('modules', m.id, moduleSvg(m)) });
  writeFileSync(join(IMG, 'placeholder-device.svg'), placeholderDeviceSvg());
  writeFileSync(join(IMG, 'placeholder-promo.svg'), placeholderPromoSvg());
  manifest.placeholders = { ...(manifest.placeholders || {}), device: 'placeholder-device.svg', promo: 'placeholder-promo.svg' };
  writeManifest(manifest);
  console.log(`tiles: ${manifest.plans.length} plans, ${manifest.modules.length} modules, 2 placeholders`);
}

// ---------------------------------------------------------------------------------------------------

function readManifest() { try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; } }

function walk(dir) {
  const out = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) { const p = join(dir, name); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}

function writeManifest(m) {
  const files = walk(IMG).filter((p) => !p.endsWith('MANIFEST.json'));
  const bytes = files.reduce((n, p) => n + statSync(p).size, 0);
  m.totals = { files: files.length, bytes, megabytes: Math.round((bytes / 1048576) * 100) / 100, budgetMegabytes: 25 };
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
  console.log(`manifest: ${m.totals.files} files, ${m.totals.megabytes} MB of 25`);
}

async function sheet(out) {
  const files = readdirSync(WORK).filter((f) => f.endsWith('.jpg')).sort();
  const cw = 480, ch = 320, lab = 26, cols = 4;
  const tilesOut = [];
  for (let i = 0; i < files.length; i += 1) {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lab);
    tilesOut.push({ input: await sharp(join(WORK, files[i])).resize(cw, ch).png().toBuffer(), left: x, top: y + lab });
    tilesOut.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${lab}"><rect width="100%" height="100%" fill="#111"/><text x="8" y="18" font-family="Arial" font-size="15" fill="#fff">${esc(files[i])}</text></svg>`), left: x, top: y });
  }
  await sharp({ create: { width: cols * cw, height: Math.ceil(files.length / cols) * (ch + lab), channels: 3, background: '#222' } }).composite(tilesOut).png().toFile(out);
  console.log(`sheet: ${out} (${files.length} candidates)`);
}

async function main() {
  const all = !has('--tiles') && !has('--roll') && !has('--compose') && !has('--sheet') && !has('--preview');
  if (has('--tiles') || all) await tiles();
  if (has('--roll')) await roll(); // never implicit: a roll costs model calls and makes unreviewed art
  if (has('--sheet')) await sheet(arg('--sheet'));
  if (has('--preview')) await preview(arg('--preview'));
  if (has('--compose') || all) await compose();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
