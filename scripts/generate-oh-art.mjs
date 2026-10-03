#!/usr/bin/env node
// scripts/generate-oh-art.mjs — OH's campaign art, generated once at DESIGN TIME, reviewed by eye, committed.
//
// Modelled on scripts/generate-vantage-art.mjs (same posture, same model, same review loop). Every piece of
// art is a generated SCENE (a living room with an empty TV wall, a laundry room, a kitchen, or a studio set
// with a colour glow; no product, no text, no marks) with the piece's lead product placed on it from LG's own
// cutout in public/oh/img/products/, so nothing on the art is a model's guess at a product. The page draws
// the headline, the sub, the badge and the button over the art: nothing is baked in.
//
//   art/slide/<piece>.{webp,avif,jpg}    1440×640  hero slides (the six hero pieces), the carousel layout
//   art/slide540/<piece>.{webp,avif,jpg} 1440×540  the same six cut from the 1440×640 frame, for the full-bleed hero
//                                        (a format with `from` is cut from that format's frame; `layout.shrink` draws
//                                        the product at a fraction of its fitted box, toward its right edge, same base)
//   art/tile/<piece>.{webp,avif,jpg}     720×420   deal tiles (the fourteen deals pieces) and the seven room tiles
//   art/tall/<piece>.{webp,avif,jpg}     720×860   the deals pieces' tall variant, for the bento's tall positions
//   art/banner/<room>.{webp,avif,jpg}    1440×360  the three room banners (living room, laundry room, kitchen)
//   art/index.json                       piece id → its art files, with the text, product and badge zones
//
// What is made, from which scene and product, with which layout, is scripts/demo-kit/configs/oh/art.json.
//
//   node scripts/generate-oh-art.mjs --roll [--candidates n] [--only scene,scene] [--force]
//                                            roll scene candidates a, b, ... into the work dir (model calls)
//   node scripts/generate-oh-art.mjs --sheet <png>     contact sheet of every candidate
//   node scripts/generate-oh-art.mjs --preview <dir> [--picked] [--only piece,piece]
//                                                      every job composed from every candidate of its scene
//                                                      (--picked: from its picked candidate only)
//   node scripts/generate-oh-art.mjs --compose         compose the picked candidates, write art/, the index and
//                                                      the manifest's art section (the default; no model calls)
//   node scripts/generate-oh-art.mjs --review <dir>    contact sheets of the committed art, for the gate
//   --gradient     compose every job on a composed gradient scene instead (no candidates, no model)
//   --work <dir>   where candidates live (default: OS temp dir). Candidates are never committed.
//
// The loop that produced the committed set: --roll, --sheet and --preview, a person reads every candidate,
// each job's `pick` and `layout` in art.json are fitted to the winner, --compose writes art/, --review makes
// contact sheets of the exact files, and the gate binds each verdict to the composed WebP's sha256. A job
// whose candidate is absent keeps its committed files as they are, so a checkout that never rolled can re-run
// --compose without losing or replacing reviewed art. Without the image model's credential (GEMINI_API_KEY in
// the environment or, by name, in .dev.vars), a job with neither a candidate nor committed art is composed on
// its scene's gradient, and its provenance says so. Each candidate's exact prompt, model and ratio are written
// beside it at roll time (<group>--<letter>.json), so a row's provenance names the prompt it was rolled with
// even after the config's wording moves on; the manifest keeps each distinct prompt once, under `art.prompts`.
//
// The product cutout is LG's own image from products/ (the D2 file, its sha256 recorded per row), treated only
// as a composite on a dark scene needs and as art.json names per product: LG's composited labels erased where
// they sit on the ground beside the product (whole detached parts inside a box, never the product), a stand
// cropped for a wall-hung TV, the white glow around a dark body faded, ragged white ground under an appliance's
// base cleared, detached specks removed, the edge pulled in one pixel. A product whose image carries a badge ON
// the product is substituted from the same piece's featured list, and the row says so. Where D2 has an accepted
// 840 cutout (MANIFEST.json large), art.json's `largeSource` rule draws it instead (slides, banners, and any tile
// that would scale the 420 cut above 1.0×), into the very box the 420 fit gives, so no zone moves.
//
// Opaque art carries no transparency, so the kit's transparent PNG is replaced by AVIF as the third encoding:
// WebP (the src), AVIF and a JPEG fallback (a PNG of the 44 files measured 4.45 MB at the kit's 256 colours and
// 2.86 MB at D2's 48, either past the 25 MB budget's headroom). Shared pieces come from scripts/demo-kit/lib/imagery.mjs (sharp on
// first use, sha256, the manifest's read and write with its totals, the verdict bound to a sha256); no change
// to the library. On a Windows checkout whose node_modules carries the Linux sharp binary, run it under WSL.
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharp, readManifest, reviewFor, sha256, writeManifest } from './demo-kit/lib/imagery.mjs';

const sharp = (...args) => loadSharp()(...args);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(ROOT, 'scripts', 'demo-kit', 'configs', 'oh', 'art.json');
const OH = join(ROOT, 'public', 'oh');
const IMG = join(OH, 'img');
const ART = join(IMG, 'art');
const MANIFEST = join(IMG, 'MANIFEST.json');
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
const MODEL = process.env.OH_ART_MODEL || cfg.model;
const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
const WORK = arg('--work', process.env.OH_ART_WORK || join(tmpdir(), 'oh-art-work'));
const LETTERS = 'abcdefgh';
const TODAY = new Date().toISOString().slice(0, 10);

// ── The jobs ────────────────────────────────────────────────────────────────

/** One job per piece and format, in config order; a job's candidate letter defaults to its turn in its scene and aspect. */
export function jobsOf(conf = cfg) {
  const turn = new Map();
  const jobs = [];
  const made = new Map();
  for (const piece of conf.pieces) {
    for (const [format, own] of Object.entries(piece.formats)) {
      const f = conf.formats[format];
      if (f.from) {
        // Cut from the frame of another format: the same scene, product and layout, cropped to this height.
        const baseJob = made.get(`${piece.id}/${f.from}`);
        if (!baseJob) throw new Error(`${piece.id}/${format} is cut from ${f.from}, which the piece does not have`);
        jobs.push({ ...baseJob, key: `${piece.id}/${format}`, format, derived: f.from, cropTop: own.cropTop ?? null });
        continue;
      }
      const over = own;
      const scene = over.scene || piece.scene;
      const group = `${scene}--${f.aspect}`;
      const n = turn.get(group) ?? 0;
      turn.set(group, n + 1);
      const mount = over.mount || piece.mount || 'floor';
      const job = {
        key: `${piece.id}/${format}`, piece: piece.id, kind: piece.kind, format, scene, aspect: f.aspect, group,
        pick: over.pick || LETTERS[n], product: piece.product ?? null, mount,
        reflection: over.reflection ?? piece.reflection ?? false,
        layout: { ...(conf.layouts[format]?.[mount] ?? {}), ...(over.layout ?? {}) },
        scrim: { ...f.scrim, ...(over.scrim ?? {}) }, position: over.position || 'centre', note: piece.note || null,
      };
      jobs.push(job);
      made.set(job.key, job);
    }
  }
  return jobs;
}

/** How many candidates each scene and aspect needs: one per job that uses it, plus one spare. */
export function needs(conf = cfg) {
  const out = new Map();
  for (const j of jobsOf(conf)) if (!j.derived) out.set(j.group, (out.get(j.group) ?? 0) + 1);
  for (const [k, v] of out) out.set(k, v + 1);
  return out;
}

export const promptOf = (sceneKey, aspect, conf = cfg) => {
  const s = conf.scenes[sceneKey];
  return `${s.room} ${conf.aspects[aspect].frame.replace('{area}', s.area)} ${conf.style}`;
};

const candidateFile = (group, letter) => join(WORK, `${group}--${letter}.jpg`);
/** Each candidate's own record (model, ratio, the exact prompt, when), written beside it at roll time. */
const sidecarFile = (group, letter) => join(WORK, `${group}--${letter}.json`);
function rolledWith(group, letter) {
  try { return JSON.parse(readFileSync(sidecarFile(group, letter), 'utf8')); } catch { return null; }
}

// ── The model ───────────────────────────────────────────────────────────────

/** The credential by name only: the environment first, then .dev.vars. Never printed, never written. */
function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const file = join(ROOT, '.dev.vars');
  if (!existsSync(file)) return null;
  const m = /^GEMINI_API_KEY=(.*)$/m.exec(readFileSync(file, 'utf8'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') || null : null;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateOne(key, prompt, ratio) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio, imageSize: '2K' } },
  });
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await pause(1500 * 2 ** attempt + Math.random() * 800);
    let r;
    try {
      r = await fetch(`${GLAPI}/models/${MODEL}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
        signal: AbortSignal.timeout(150000),
      });
    } catch (e) { lastErr = `fetch ${e.message}`; continue; }
    if (!r.ok) {
      lastErr = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ')}`;
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

async function roll() {
  mkdirSync(WORK, { recursive: true });
  const only = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const min = Number(arg('--candidates', '0')) || 0;
  const jobs = [];
  for (const [group, n] of needs()) {
    const [scene, aspect] = group.split('--');
    if (only.length && !only.includes(scene) && !only.includes(group)) continue;
    for (let i = 0; i < Math.max(n, min); i += 1) {
      const file = candidateFile(group, LETTERS[i]);
      if (!has('--force') && existsSync(file)) continue;
      jobs.push({ group, scene, aspect, letter: LETTERS[i], file });
    }
  }
  const key = jobs.length ? apiKey() : '';
  if (jobs.length && !key) { console.log('roll: GEMINI_API_KEY is not set and is not in .dev.vars; nothing rolled (compose with --gradient)'); return; }
  console.log(`roll: ${jobs.length} candidate(s), model=${MODEL}, work ${WORK}`);
  let made = 0, failed = 0;
  const queue = [...jobs];
  // Three at a time at most, as the Vantage generator learned (a spend-based 429 at five).
  await Promise.all([0, 1, 2].map(async () => {
    while (queue.length) {
      const job = queue.shift();
      const res = await generateOne(key, promptOf(job.scene, job.aspect), cfg.aspects[job.aspect].ratio);
      if (!res.ok) { failed += 1; console.log(`  ${job.group}--${job.letter} failed (${res.error})`); continue; }
      const out = await sharp(res.buf).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      writeFileSync(job.file, out);
      writeFileSync(sidecarFile(job.group, job.letter), `${JSON.stringify({ model: MODEL, ratio: cfg.aspects[job.aspect].ratio, prompt: promptOf(job.scene, job.aspect), rolled: new Date().toISOString() }, null, 1)}
`);
      made += 1;
      console.log(`  ${job.group}--${job.letter} ${Math.round(out.length / 1024)}KB`);
    }
  }));
  console.log(`roll: ${made} generated, ${failed} failed`);
}

// ── The product ─────────────────────────────────────────────────────────────

function catalog() {
  const c = JSON.parse(readFileSync(join(OH, 'catalog.json'), 'utf8'));
  return new Map((c.pieces || []).map((p) => [p.id, p]));
}
function imageIndex() { return JSON.parse(readFileSync(join(IMG, 'index.json'), 'utf8')).products || {}; }

/** The product a job places: a config entry may name a treatment (`SKU#wall`) and a substitute for a badged image. */
export function productOf(ref, conf = cfg) {
  if (!ref) return null;
  const entry = conf.products[ref] ?? {};
  let sku = entry.sku || ref.split('#')[0];
  let substitute = null;
  if (conf.substitutes?.[sku]) { substitute = { lead: sku, ...conf.substitutes[sku] }; sku = conf.substitutes[sku].with; }
  const base = conf.products[sku] ?? {};
  return { ref, sku, erase: entry.erase ?? base.erase ?? [], standCut: entry.standCut ?? false, matte: entry.matte ?? base.matte ?? null, trimBase: entry.trimBase ?? base.trimBase ?? false,
    notes: [base.note, entry !== base ? entry.note : null].filter(Boolean), substitute };
}

/** Remove whole connected parts that lie entirely inside a box (LG's composited labels on the ground, never the product). */
function eraseInside(data, W, H, boxes) {
  if (!boxes.length) return 0;
  const seen = new Uint8Array(W * H);
  let erased = 0;
  for (let p = 0; p < W * H; p += 1) {
    if (seen[p] || data[p * 4 + 3] < 8) continue;
    const part = [];
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const st = [p]; seen[p] = 1;
    while (st.length) {
      const q = st.pop(); part.push(q);
      const x = q % W, y = (q - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const r = yy * W + xx;
        if (!seen[r] && data[r * 4 + 3] >= 8) { seen[r] = 1; st.push(r); }
      }
    }
    if (boxes.some(([a, b, c, d]) => x0 >= a && y0 >= b && x1 <= c && y1 <= d)) { for (const q of part) data[q * 4 + 3] = 0; erased += part.length; }
  }
  return erased;
}

/**
 * A white appliance keyed from LG's white ground keeps ragged near-white bits of the ground along its base, which
 * read as a torn white fringe on a dark floor. The base line is each column's lowest opaque row, smoothed to a
 * low percentile over a window of columns; near-white pixels hanging below it are cleared. Feet are dark, so
 * they stay; the body above the line is never touched.
 */
function trimBase(data, W, H, { window = 16, pct = 0.3, tol = 1, white = 200, band = 0.15 } = {}) {
  const lowest = new Int32Array(W).fill(-1);
  let top = H, bottom = -1;
  for (let x = 0; x < W; x += 1) for (let y = H - 1; y >= 0; y -= 1) if (data[(y * W + x) * 4 + 3] >= 128) { lowest[x] = y; break; }
  for (let p = 0; p < W * H; p += 1) if (data[p * 4 + 3] >= 128) { const y = Math.floor(p / W); if (y < top) top = y; if (y > bottom) bottom = y; }
  if (bottom < 0) return 0;
  const from = bottom - Math.round((bottom - top) * band);
  let cleared = 0;
  for (let x = 0; x < W; x += 1) {
    if (lowest[x] < 0) continue;
    const near = [];
    for (let k = Math.max(0, x - window); k <= Math.min(W - 1, x + window); k += 1) if (lowest[k] >= 0) near.push(lowest[k]);
    near.sort((a, b) => a - b);
    const line = near[Math.floor((near.length - 1) * pct)];
    for (let y = Math.max(from, line + tol + 1); y < H; y += 1) {
      const i = (y * W + x) * 4;
      if (data[i + 3] >= 8 && Math.min(data[i], data[i + 1], data[i + 2]) >= white) { data[i + 3] = 0; cleared += 1; }
    }
  }
  return cleared;
}

/** Specks of LG's ground left beside the feet: detached parts under `min` pixels, invisible on white, bright on a dark floor. */
function despeck(data, W, H, min) {
  const seen = new Uint8Array(W * H);
  let parts = 0;
  for (let p = 0; p < W * H; p += 1) {
    if (seen[p] || data[p * 4 + 3] < 8) continue;
    const part = [p]; seen[p] = 1;
    for (let i = 0; i < part.length; i += 1) {
      const q = part[i]; const x = q % W, y = (q - x) / W;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const r = yy * W + xx;
        if (!seen[r] && data[r * 4 + 3] >= 8) { seen[r] = 1; part.push(r); }
      }
    }
    if (part.length < min) { for (const q of part) data[q * 4 + 3] = 0; parts += 1; }
  }
  return parts;
}

/** The rows below the panel: the last row at least 85 % as wide as the widest, so a stand can be cropped off. */
function panelBottom(data, W, H) {
  const width = new Array(H).fill(0);
  for (let y = 0; y < H; y += 1) { let a = -1, b = -1; for (let x = 0; x < W; x += 1) if (data[(y * W + x) * 4 + 3] > 128) { if (a < 0) a = x; b = x; } width[y] = a < 0 ? 0 : b - a + 1; }
  const max = Math.max(...width);
  let last = 0;
  for (let y = 0; y < H; y += 1) if (width[y] >= max * 0.85) last = y;
  return last + 1;
}

/**
 * A dark product keyed from LG's white ground keeps a soft white glow around it, which reads as a halo on a dark
 * scene. Within `band` pixels of the transparent ground, a light pixel fades out (fully above `hi`, partly from
 * `lo`), so the dark body stays and its glow goes. Only for dark products: a white washer would lose its edge.
 */
function darkMatte(data, W, H, { band = 14, lo = 0.42, hi = 0.62 } = {}) {
  const dist = new Int16Array(W * H).fill(-1);
  const queue = [];
  for (let p = 0; p < W * H; p += 1) if (data[p * 4 + 3] < 16) { dist[p] = 0; queue.push(p); }
  for (let i = 0; i < queue.length; i += 1) {
    const q = queue[i]; const x = q % W, y = (q - x) / W;
    if (dist[q] >= band) continue;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const r = yy * W + xx;
      if (dist[r] < 0) { dist[r] = dist[q] + 1; queue.push(r); }
    }
  }
  let faded = 0;
  for (let p = 0; p < W * H; p += 1) {
    if (dist[p] <= 0 || dist[p] > band || data[p * 4 + 3] < 16) continue;
    const l = (0.2126 * data[p * 4] + 0.7152 * data[p * 4 + 1] + 0.0722 * data[p * 4 + 2]) / 255;
    if (l <= lo) continue;
    const keep = l >= hi ? 0 : 1 - (l - lo) / (hi - lo);
    data[p * 4 + 3] = Math.round(data[p * 4 + 3] * keep);
    faded += 1;
  }
  return faded;
}

/** Pull the keyed edge in by one pixel: a white studio fringe reads as a halo on a dark scene. */
function defringe(data, W, H) {
  const a = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p += 1) a[p] = data[p * 4 + 3];
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    let m = 255;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      m = Math.min(m, xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : a[yy * W + xx]);
    }
    data[(y * W + x) * 4 + 3] = Math.round((a[y * W + x] + 2 * m) / 3);
  }
}

/** D2's 840 cutout of a product, when there is one and its own verdict is accept (MANIFEST.json, large). */
function largeOf(sku) {
  const entry = imageIndex()[sku];
  if (!entry?.large?.webp) return null;
  const id = `${entry.id}.840`;
  const row = (readManifest(MANIFEST).large || []).find((r) => r.id === id);
  if (!row || row.gate?.verdict !== 'accept') return null;
  return { id, file: row.files.webp, row };
}

const cutCache = new Map();
/**
 * The product cut, from the 420 file or (large) D2's 840 file. Every pixel treatment is stated at the 420 scale
 * and scaled by k = width / 420, so both sizes get the same cut; at k = 1 nothing differs from the 420 path.
 */
async function productCut(product, large = false) {
  const cacheKey = `${product.ref}@${large ? 'large' : '420'}`;
  if (cutCache.has(cacheKey)) return cutCache.get(cacheKey);
  const entry = imageIndex()[product.sku];
  if (!entry || entry.verdict !== 'accept') throw new Error(`no accepted product image for ${product.sku}`);
  const big = large ? largeOf(product.sku) : null;
  if (large && !big) throw new Error(`no accepted 840 image for ${product.sku}`);
  const rel = big ? big.file : `products/${entry.id}.webp`;
  const source = readFileSync(join(IMG, rel));
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const k = W / (entry.size || 420);
  const sc = (v) => Math.round(v * k);
  const erased = eraseInside(data, W, H, product.erase.map((b) => b.map(sc)));
  let height = H;
  if (product.standCut) { height = panelBottom(data, W, H); for (let p = height * W; p < W * H; p += 1) data[p * 4 + 3] = 0; }
  const matte = product.matte ? { ...product.matte, band: sc(product.matte.band ?? 14) } : null;
  const matted = matte ? darkMatte(data, W, H, matte) : 0;
  const tb = product.trimBase === true ? {} : product.trimBase;
  const based = product.trimBase ? trimBase(data, W, H, k === 1 ? tb : { ...tb, window: sc(tb.window ?? 16), tol: sc(tb.tol ?? 1) }) : 0;
  for (let i = 0; i < Math.max(1, Math.round(k)); i += 1) defringe(data, W, H);
  const specks = despeck(data, W, H, Math.round((cfg.despeckBelow ?? 60) * k * k));
  const trimmed = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const cut = await sharp(trimmed).trim({ threshold: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  const out = { buf: cut.data, width: cut.info.width, height: cut.info.height,
    source: { file: rel, sha256: sha256(source), sku: product.sku, size: W,
      ...(big ? { large: true, sourcePixels: big.row.sources?.[0]?.pixels ?? null, rendition: big.row.sources?.[0]?.rendition ?? 'the same LG image as the 420 file, rendered larger' } : {}) },
    treatment: [
      big ? `cut from D2's ${W}-pixel file of LG's own product image (${big.row.sources?.[0]?.rendition ? 'LG\'s zoom rendition, ' : 'LG\'s '}${big.row.sources?.[0]?.pixels ?? ''} source; crop, scale and ground only)`
        : 'cut from LG\'s own product image (D2: crop, scale and ground only)',
      ...(erased ? product.notes.filter((n) => /erased/.test(n)) : []),
      ...(product.standCut ? ['the stand cropped off below the panel, for a wall-mounted TV'] : []),
      ...(matted ? ['the white glow LG\'s ground left around the dark body faded out at the edge'] : []),
      ...(based ? ['ragged near-white bits of LG\'s ground below the base line cleared (the feet kept)'] : []),
      k === 1 ? 'edge pulled in by one pixel against the scene' : 'edge pulled in by one 420-scale pixel against the scene',
      ...(specks ? [`${specks} detached speck${specks === 1 ? '' : 's'} under ${Math.round((cfg.despeckBelow ?? 60) * k * k)} px removed`] : []),
      'scaled to the layout box with lanczos3',
    ] };
  cutCache.set(cacheKey, out);
  return out;
}

// ── Composition ─────────────────────────────────────────────────────────────

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);

/** The scene when there is no candidate: a composed gradient in the scene's colours, a glow at the product, a floor. */
export function gradientSvg(g, W, H) {
  const [gx, gy] = g.glowAt;
  return svg(W, H, `<defs>
    <radialGradient id="glow" cx="${gx}" cy="${gy}" r="${W > H * 1.5 ? 0.45 : 0.6}" gradientTransform="translate(${gx} ${gy}) scale(${H / W} 1) translate(${-gx} ${-gy})">
      <stop offset="0" stop-color="${g.glow}" stop-opacity="0.85"/><stop offset="0.45" stop-color="${g.glow}" stop-opacity="0.32"/><stop offset="1" stop-color="${g.glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g.floor}" stop-opacity="0"/><stop offset="1" stop-color="${g.floor}" stop-opacity="1"/></linearGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="${g.base}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
    <rect y="${Math.round(H * 0.72)}" width="${W}" height="${Math.round(H * 0.28)}" fill="url(#floor)"/>
    <rect width="${W}" height="${H}" fill="url(#vig)"/>`);
}

/** The headline's calm: a soft dark scrim where the page draws its white type (part of the art, not text). */
function scrimSvg(s, W, H) {
  const a = s.strength;
  if (!a) return null;
  if (s.kind === 'left') return svg(W, H, `<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="${a}"/><stop offset="${s.reach * 0.55}" stop-color="#000" stop-opacity="${a * 0.6}"/><stop offset="${s.reach}" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/>`);
  if (s.kind === 'bottom') return svg(W, H, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="${1 - s.reach}" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${a}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#s)"/>`);
  return svg(W, H, `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="${1 - s.reach}" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${a}"/></linearGradient>
    <linearGradient id="l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="${a * 0.55}"/><stop offset="${s.reach}" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#l)"/>`);
}

async function productLayers(job, W, H) {
  const product = productOf(job.product);
  if (!product) return { layers: [], placed: null, product: null, cut: null };
  // The placement is fitted on the 420 cut, so the product box and every zone hold whichever file is drawn.
  const fit = await productCut(product);
  const L = job.layout;
  const s = Math.min((L.boxW * W) / fit.width, (L.boxH * H) / fit.height, cfg.maxUpscale);
  // shrink (R5's ruling on panel marks): the fitted box scaled down, keeping its right edge and its base.
  const shrink = L.shrink ?? 1;
  const w0 = Math.round(fit.width * s);
  const w = Math.round(fit.width * s * shrink), h = Math.round(fit.height * s * shrink);
  const rule = cfg.largeSource;
  const useLarge = Boolean(rule && (rule.formats.includes(job.format) || s > rule.aboveScale) && largeOf(product.sku));
  const cut = useLarge ? await productCut(product, true) : fit;
  const sDrawn = w / cut.width;
  let img;
  if (!useLarge) img = sharp(cut.buf).resize(w, h, { kernel: 'lanczos3' });
  else {
    // D2's 840 cut drawn into the same box; a cut whose shape differs by more than 1.5 % keeps its own shape, on the base.
    const same = Math.abs((cut.width / cut.height) / (fit.width / fit.height) - 1) <= 0.015;
    img = sharp(cut.buf).resize(w, h, same ? { kernel: 'lanczos3', fit: 'fill' }
      : { kernel: 'lanczos3', fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  if (sDrawn > 1.05) img = img.sharpen({ sigma: 0.6 });
  const pimg = await img.png().toBuffer();
  const bottom = Math.round(L.bottom * H);
  const fittedLeft = Math.round(L.cx * W) - Math.round(w0 / 2);
  const left = shrink === 1 ? fittedLeft : fittedLeft + w0 - w, top = bottom - h;
  const cx = left + Math.round(w / 2);
  const layers = [];
  const clip = async (buf, x, y) => {
    // Keep every layer inside the frame (sharp refuses an overlay that runs off the canvas).
    const m = await sharp(buf).metadata();
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + m.width), y1 = Math.min(H, y + m.height);
    if (x1 <= x0 || y1 <= y0) return null;
    const part = await sharp(buf).extract({ left: x0 - x, top: y0 - y, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    return { input: part, left: x0, top: y0 };
  };
  if (job.mount === 'wall') {
    // A wall-hung panel: its own silhouette, blurred and dropped a little, behind it.
    const pad = Math.round(h * 0.12);
    const sil = await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(pimg).ensureAlpha().linear([0, 0, 0, 0.62], [0, 0, 0, 0]).png().toBuffer(), left: pad, top: pad }])
      .blur(Math.max(4, Math.round(h * 0.035))).png().toBuffer();
    const l = await clip(sil, left - pad, top - pad + Math.round(h * 0.035));
    if (l) layers.push(l);
  } else {
    // Standing on a floor or a console: a soft contact shadow under the foot.
    const sw = Math.round(w * 0.96), sh = Math.max(14, Math.round(h * 0.06));
    const shadow = await sharp(svg(sw, sh * 2, `<ellipse cx="${sw / 2}" cy="${sh}" rx="${sw / 2.2}" ry="${sh / 2.4}" fill="#000" fill-opacity="0.62"/>`))
      .blur(Math.max(4, Math.round(sh / 3))).png().toBuffer();
    const l = await clip(shadow, cx - Math.round(sw / 2), bottom - sh);
    if (l) layers.push(l);
    if (job.reflection) {
      // A glossy floor's reflection: the product flipped, fading out over a quarter of its height.
      const rh = Math.min(Math.round(h * 0.28), H - bottom);
      if (rh > 8) {
        // flip in its own pipeline: sharp extracts before it flips, which would mirror the top of the product
        const flipped = await sharp(await sharp(pimg).flip().png().toBuffer()).extract({ left: 0, top: 0, width: w, height: rh }).png().toBuffer();
        const mask = svg(w, rh, `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.24"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${rh}" fill="url(#f)"/>`);
        const refl = await sharp(flipped).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        const r = await clip(refl, left, bottom + 1);
        if (r) layers.push(r);
      }
    }
  }
  const p = await clip(pimg, left, top);
  if (p) layers.push(p);
  return { layers, product, cut, placed: { left, top, width: w, height: h, scale: Math.round(s * shrink * 100) / 100, ...(shrink !== 1 ? { shrink, fittedScale: Math.round(s * 100) / 100 } : {}), ...(useLarge ? { drawnFrom: cut.source.size, drawnScale: Math.round(sDrawn * 100) / 100 } : {}) } };
}

/** The headline zone's light: relative luminance's mean and 90th percentile, and white type's contrast there. */
async function legibility(buf, zone, W, H) {
  const [a, b, c, d] = zone;
  const region = { left: Math.round(a * W), top: Math.round(b * H), width: Math.round((c - a) * W), height: Math.round((d - b) * H) };
  const { data } = await sharp(buf).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = [];
  for (let i = 0; i < data.length; i += 3) lum.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  lum.sort((p, q) => p - q);
  const mean = lum.reduce((s, x) => s + x, 0) / lum.length;
  const p90 = lum[Math.floor(lum.length * 0.9)];
  const contrast = Math.round((1.05 / (p90 + 0.05)) * 10) / 10;
  return { meanLuminance: Math.round(mean * 1000) / 1000, p90Luminance: Math.round(p90 * 1000) / 1000, whiteContrastAtP90: contrast,
    ink: contrast >= 4.5 ? 'light' : contrast >= 3 ? 'light-large' : 'dark' };
}

/** The placed product as fractions of the frame, and the first of the format's badge zones it leaves clear. */
function zonesOf(f, placed, prefer = null) {
  const box = placed ? [placed.left / f.width, placed.top / f.height, (placed.left + placed.width) / f.width, (placed.top + placed.height) / f.height].map((v) => Math.round(v * 1000) / 1000) : null;
  const clear = (z) => !box || z[2] <= box[0] - 0.01 || z[0] >= box[2] + 0.01 || z[3] <= box[1] - 0.01 || z[1] >= box[3] + 0.01;
  const kept = prefer && (f.badgeZones || []).some((z) => JSON.stringify(z) === JSON.stringify(prefer)) && clear(prefer) ? prefer : null;
  return { text: f.textZone, product: box ?? f.productZone, badge: kept ?? (f.badgeZones || []).find(clear) ?? null };
}

const encodings = () => ['webp', 'avif', ...(cfg.encode.jpg ? ['jpg'] : [])];

async function encode(raw) {
  return { webp: await sharp(raw).webp(cfg.encode.webp).toBuffer(), avif: await sharp(raw).avif(cfg.encode.avif).toBuffer(),
    ...(cfg.encode.jpg ? { jpg: await sharp(raw).jpeg(cfg.encode.jpg).toBuffer() } : {}) };
}

async function composeJob(job, srcFile) {
  const f = cfg.formats[job.format];
  if (job.derived) {
    // The base format's frame, cropped to this height: the product keeps its size and its place on the scene. The
    // crop keeps a margin of floor under the product (and its shadow) and takes the rest from the top.
    const base = await composeJob({ ...job, format: job.derived, derived: null }, srcFile);
    const cut = base.H - f.height;
    const margin = Math.round(f.height * (f.baseMargin ?? 0.075));
    const auto = base.placed ? Math.min(cut, Math.max(0, base.placed.top + base.placed.height + margin - f.height)) : Math.round(cut / 2);
    const y0 = job.cropTop ?? auto;
    const raw = await sharp(base.raw).extract({ left: 0, top: y0, width: f.width, height: f.height }).png().toBuffer();
    const placed = base.placed ? { ...base.placed, top: base.placed.top - y0, croppedFrom: { format: job.derived, top: y0 } } : null;
    return { W: f.width, H: f.height, raw, ...(await encode(raw)), product: base.product, cut: base.cut, placed, legibility: await legibility(raw, f.textZone, f.width, f.height) };
  }
  const W = f.width, H = f.height;
  const base = srcFile ? await sharp(srcFile).resize(W, H, { fit: 'cover', position: job.position }).toBuffer()
    : await sharp(gradientSvg(cfg.scenes[job.scene].gradient, W, H)).png().toBuffer();
  const scrim = scrimSvg(job.scrim, W, H);
  const { layers, product, cut, placed } = await productLayers(job, W, H);
  // Scrim first, then the product, so the product stays at full brightness in its own zone.
  const raw = await sharp(base).composite([...(scrim ? [{ input: scrim }] : []), ...layers]).removeAlpha().png().toBuffer();
  return { W, H, raw, ...(await encode(raw)), product, cut, placed, legibility: await legibility(raw, f.textZone, W, H) };
}

// ── Commands ────────────────────────────────────────────────────────────────

async function sheet(out) {
  const files = existsSync(WORK) ? readdirSync(WORK).filter((f) => f.endsWith('.jpg')).sort() : [];
  const cw = 480, ch = 270, lab = 24, cols = 4;
  const tiles = [];
  for (let i = 0; i < files.length; i += 1) {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lab);
    tiles.push({ input: await sharp(join(WORK, files[i])).resize(cw, ch, { fit: 'contain', background: '#222' }).png().toBuffer(), left: x, top: y + lab });
    tiles.push({ input: svg(cw, lab, `<rect width="100%" height="100%" fill="#111"/><text x="6" y="17" font-family="Arial" font-size="14" fill="#fff">${files[i]}</text>`), left: x, top: y });
  }
  await sharp({ create: { width: cols * cw, height: Math.max(1, Math.ceil(files.length / cols)) * (ch + lab), channels: 3, background: '#222' } }).composite(tiles).png().toFile(out);
  console.log(`sheet: ${out} (${files.length} candidates)`);
}

async function preview(dir) {
  mkdirSync(dir, { recursive: true });
  const only = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  let n = 0;
  for (const job of jobsOf()) {
    if (only.length && !only.some((o) => job.key.startsWith(o) || job.group.startsWith(o))) continue;
    for (const letter of has('--picked') ? [job.pick] : LETTERS) {
      const src = candidateFile(job.group, letter);
      if (!existsSync(src)) break;
      const r = await composeJob(job, src);
      writeFileSync(join(dir, `${job.piece}--${job.format}--${letter}.jpg`), await sharp(r.raw).jpeg({ quality: 82 }).toBuffer());
      n += 1;
    }
  }
  console.log(`preview: ${n} composed in ${dir}`);
}

const rel = (format, id, ext) => `art/${format}/${id}.${ext}`;

async function compose() {
  const pieces = catalog();
  const products = JSON.parse(readFileSync(join(OH, 'products.json'), 'utf8')).products || [];
  const nameOf = (sku) => products.find((p) => p.sku === sku)?.name ?? null;
  const manifest = readManifest(MANIFEST);
  const previous = new Map(((manifest.art && manifest.art.rows) || []).map((r) => [r.key, r]));
  const rows = [];
  // Each distinct prompt is recorded once, by id; a row names the id its scene was rolled with.
  const prompts = { ...((manifest.art && manifest.art.prompts) || {}) };
  const promptId = (text) => { const id = `p-${sha256(Buffer.from(text)).slice(0, 10)}`; prompts[id] = text; return id; };
  const gradientAll = has('--gradient');
  const keyPresent = Boolean(apiKey());
  for (const job of jobsOf()) {
    const f = cfg.formats[job.format];
    const src = gradientAll ? null : candidateFile(job.group, job.pick);
    const out = Object.fromEntries(encodings().map((e) => [e, join(IMG, rel(job.format, job.piece, e))]));
    const committed = Object.values(out).every((p) => existsSync(p)) && previous.has(job.key);
    if (!gradientAll && !existsSync(src) && committed) {
      // No candidate here: the reviewed files stay exactly as they are, and so does their row.
      rows.push(previous.get(job.key));
      console.log(`  ${job.key} kept (no candidate ${job.group}--${job.pick} in the work dir)`);
      continue;
    }
    const generated = !gradientAll && existsSync(src);
    const rolled = generated ? rolledWith(job.group, job.pick) : null;
    const r = await composeJob(job, generated ? src : null);
    mkdirSync(join(ART, job.format), { recursive: true });
    for (const e of encodings()) writeFileSync(out[e], r[e]);
    const stale = join(IMG, rel(job.format, job.piece, 'jpg'));
    if (!cfg.encode.jpg && existsSync(stale)) unlinkSync(stale);
    const piece = pieces.get(job.piece) ?? null;
    const room = cfg.rooms?.[job.piece] ?? null;
    const scene = cfg.scenes[job.scene];
    const sku = r.product?.sku ?? null;
    const productText = sku ? ` + the product's own image ${sku}${r.cut.source.large ? ` (D2's ${r.cut.source.size}-pixel cutout, ${r.cut.source.file})` : ''}, demo use` : ' (no product by design: the page draws the shopper\'s own configuration)';
    const provenance = generated ? `generated scene (${rolled?.model ?? MODEL}, ${scene.summary})${productText}` : `composed gradient (${scene.summary.split(',')[0]} colours)${productText}`;
    rows.push({
      key: job.key, piece: job.piece, kind: job.kind, format: job.format, title: piece?.title ?? room?.title ?? null,
      files: Object.fromEntries(encodings().map((e) => [e, rel(job.format, job.piece, e)])),
      size: { width: r.W, height: r.H }, bytes: Object.fromEntries(encodings().map((e) => [e, r[e].length])), sha256: sha256(r.webp),
      generated, provenance,
      scene: { key: job.scene, summary: scene.summary, ...(generated ? { model: rolled?.model ?? MODEL, candidate: `${job.group}--${job.pick}`, aspect: rolled?.ratio ?? cfg.aspects[job.aspect].ratio, prompt: promptId(rolled?.prompt ?? promptOf(job.scene, job.aspect)),...(rolled?.rolled ? { rolled: rolled.rolled.slice(0, 10) } : {}) } : { method: 'composed gradient, sharp (SVG radial glow, floor and vignette)' }) },
      product: sku ? { sku, name: nameOf(sku), image: r.cut.source.file, imageSha256: r.cut.source.sha256, mount: job.mount, reflection: job.reflection,
        placed: r.placed, treatment: r.cut.treatment, ...(r.product.substitute ? { substituteFor: r.product.substitute.lead, why: r.product.substitute.why } : {}) } : null,
      ...(job.note ? { note: job.note } : {}),
      ...(job.derived ? { cutFrom: `${job.piece}/${job.derived}` } : {}),
      zones: zonesOf(f, r.placed, previous.get(job.key)?.zones?.badge ?? null), legibility: r.legibility,
    });
    console.log(`  ${job.key} ← ${generated ? `${job.group}--${job.pick}` : 'gradient'}${sku ? ` + ${sku}` : ''}  webp ${Math.round(r.webp.length / 1024)}KB avif ${Math.round(r.avif.length / 1024)}KB${r.jpg ? ` jpg ${Math.round(r.jpg.length / 1024)}KB` : ''}  white ${r.legibility.whiteContrastAtP90}:1`);
  }
  // The verdict is re-read on every run and holds only for the exact WebP it was given to.
  for (const row of rows) {
    const g = reviewFor(cfg.gate?.[row.key], row.sha256);
    row.gate = g ? { verdict: g.verdict, checked: g.checked, note: g.note, ...(g.rejected?.length ? { rejected: g.rejected } : {}) }
      : { verdict: 'pending', note: 'not yet checked by eye for this exact file' };
  }
  const bytes = rows.reduce((n, r) => n + Object.values(r.bytes).reduce((a, b) => a + b, 0), 0);
  manifest.art = {
    about: `OH campaign art (Lane A1), written by scripts/generate-oh-art.mjs from scripts/demo-kit/configs/oh/art.json. Each file is a generated scene (no product, no text, no marks) with the piece\'s lead product placed on it from LG\'s own cutout in products/, or a composed gradient where no scene was generated; provenance per row, each scene\'s exact prompt once under prompts by the id its row names. ${cfg.encode.jpg ? 'Three encodings: WebP (the src), AVIF and a JPEG fallback' : 'Two encodings: WebP (the src) and AVIF; the JPEG fallback was dropped to keep the image payload under the 25 MB budget when the 1440x540 slides were added (the page draws src and avif only)'}; opaque art carries no transparency, so the kit\'s transparent PNG is not made. The verdict holds only for the sha256 of the exact WebP reviewed. art/index.json maps each piece to its files.`,
    generator: 'scripts/generate-oh-art.mjs', config: 'scripts/demo-kit/configs/oh/art.json', model: MODEL, credential: keyPresent ? 'GEMINI_API_KEY (by name, from the environment or .dev.vars)' : 'none present',
    counts: { files: rows.length, encodings: rows.reduce((n, r) => n + Object.keys(r.files).length, 0), byFormat: Object.fromEntries(Object.keys(cfg.formats).map((k) => [k, rows.filter((r) => r.format === k).length])),
      generated: rows.filter((r) => r.generated).length, gradient: rows.filter((r) => !r.generated).length,
      verdicts: rows.reduce((m, r) => ({ ...m, [r.gate.verdict]: (m[r.gate.verdict] ?? 0) + 1 }), {}) },
    text: 'none baked in: headline, sub, badge and button are content the page draws over the art',
    productLicence: 'Each product is LG Electronics\' own product image, as recorded for its file in this manifest\'s products section: demo use only, in an internal demo; provenance recorded.',
    bytes,
    prompts: Object.fromEntries(Object.entries(prompts).filter(([id]) => rows.some((r) => r.scene?.prompt === id))),
    rows,
  };
  writeIndex(rows);
  writeManifest(MANIFEST, manifest, { dir: IMG, budgetMegabytes: cfg.budgetMegabytes });
  console.log(`art: ${rows.length} files × ${encodings().length} encodings, ${(bytes / 1048576).toFixed(2)} MB; image payload ${manifest.totals.megabytes} MB of ${cfg.budgetMegabytes}`);
}

function writeIndex(rows) {
  const pieces = {};
  for (const r of rows) {
    const entry = pieces[r.piece] ??= { kind: r.kind, title: r.title, product: r.product?.sku ?? null };
    entry[r.format] = { src: `/oh/img/${r.files.webp}`, ...Object.fromEntries(Object.entries(r.files).map(([e, p]) => [e, `/oh/img/${p}`])),
      width: r.size.width, height: r.size.height, ink: r.legibility.ink === 'dark' ? 'dark' : 'light', zones: r.zones, verdict: r.gate.verdict };
  }
  const index = {
    about: `OH campaign art (Lane A1): piece id → its art. Draw the headline, sub, badge and button over the art (nothing is baked in): white type in the format\'s text zone, a badge in its badge zone, never over the product zone. src is the WebP; avif is the same picture for a <picture> source.${cfg.encode.jpg ? ' jpg is the fallback.' : ''} Hero pieces carry two slides: slide (1440x640, the carousel layout) and slide540 (1440x540, the full-bleed hero), the same scene and product, slide540 cut from slide's frame. Zones are fractions of the frame, [left, top, right, bottom]; each file carries its own: text (where the page sets white type), product (the placed product\'s box, or the empty product zone) and badge (a corner the product leaves clear, or null). hero_continue carries no product by design: the page draws the shopper\'s own configuration into its product zone. Provenance and verdicts: MANIFEST.json, art.`,
    manifest: '/oh/img/MANIFEST.json',
    formats: Object.fromEntries(Object.entries(cfg.formats).map(([k, f]) => [k, { width: f.width, height: f.height, textZone: f.textZone, productZone: f.productZone, badgeZones: f.badgeZones,
      ...(f.from ? { cutFrom: f.from } : {}), use: { slide: 'hero carousel slides, 1440x640 (the carousel layout)', slide540: 'the full-bleed hero, 1440x540', tile: 'deal bento tiles and room tiles', tall: 'the deal bento\'s tall positions', banner: 'room grid banners' }[k] }])),
    rooms: Object.fromEntries(Object.entries(cfg.rooms).map(([id, r]) => [r.view, id])),
    pieces,
  };
  writeFileSync(join(ART, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
}

/** Contact sheets of the committed art, by format, for the defect check, plus each file at 1:1 in a folder. */
async function review(dir) {
  mkdirSync(dir, { recursive: true });
  const manifest = readManifest(MANIFEST);
  const rows = manifest.art?.rows || [];
  for (const format of Object.keys(cfg.formats)) {
    const list = rows.filter((r) => r.format === format);
    if (!list.length) continue;
    const f = cfg.formats[format];
    const cols = f.width >= 1440 ? 2 : 4, cw = f.width >= 1440 ? 720 : 360, ch = Math.round(cw * f.height / f.width), lab = 22;
    const tiles = [];
    for (let i = 0; i < list.length; i += 1) {
      const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + lab);
      tiles.push({ input: await sharp(join(IMG, list[i].files.webp)).resize(cw, ch).png().toBuffer(), left: x, top: y + lab });
      tiles.push({ input: svg(cw, lab, `<rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Arial" font-size="13" fill="#fff">${list[i].key} · ${list[i].gate.verdict} · white ${list[i].legibility.whiteContrastAtP90}:1</text>`), left: x, top: y });
    }
    const file = join(dir, `art-${format}.png`);
    await sharp({ create: { width: cols * cw, height: Math.ceil(list.length / cols) * (ch + lab), channels: 3, background: '#222' } }).composite(tiles).png().toFile(file);
    console.log(`review: ${file} (${list.length})`);
  }
}

async function main() {
  const all = !['--roll', '--sheet', '--preview', '--compose', '--review'].some(has);
  if (has('--roll')) await roll(); // never implicit: a roll costs model calls and makes unreviewed art
  if (has('--sheet')) await sheet(arg('--sheet'));
  if (has('--preview')) await preview(arg('--preview'));
  if (has('--compose') || all) await compose();
  if (has('--review')) await review(arg('--review'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
