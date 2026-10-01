// scripts/demo-kit/lib/imagery.mjs — a demo's product imagery: fetched once by URL list at DESIGN TIME,
// cut out, normalised to one apparent size, encoded three ways, and recorded with its provenance.
//
// Lifted from scripts/fetch-vantage-devices.mjs (download with retries, the raw cache, the border-only
// flood-fill key, the floor-shadow drop, the alpha box, the back-and-front compose, the placement and the
// three encodings), and the manifest discipline it shares with scripts/generate-vantage-art.mjs: every
// file carries its source page, source URL, retrieval date, source and output sha256, licence note and a
// human defect-check verdict, and a verdict holds ONLY for the sha256 it was given to. A re-fetch that
// changes one byte puts the image back to "pending" until someone looks again. Nothing here is on the
// serving path, and a missing image renders the demo's placeholder, never a broken tag.
//
// sharp is loaded on first use, not at import: on a Windows checkout whose node_modules carries the Linux
// sharp binary, everything but the pixel work (the manifest, the gate, the totals) still runs; the pixel
// work runs under WSL there, as the Vantage scripts' headers say.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

let sharpModule = null;
export function loadSharp() {
  if (!sharpModule) {
    try { sharpModule = createRequire(import.meta.url)('sharp'); } catch (error) {
      throw new Error(`sharp does not load here (${process.platform}-${process.arch}): ${String(error.message).split('\n')[0]}. `
        + 'On a Windows checkout whose node_modules carries the Linux sharp binary, run this under WSL.');
    }
  }
  return sharpModule;
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/** Vantage's settings, which are the kit's defaults: an 800 square at 86 % fill, Meridian's normaliser size. */
export const RENDER_DEFAULTS = Object.freeze({
  size: 800, fill: 0.86, composeHeight: 1600, composeOffset: 0.86,
  webp: Object.freeze({ quality: 88, alphaQuality: 100, effort: 6 }),
  // Palette-quantised with dither, a third of full colour and indistinguishable at 1:1 (checked on the Pixel 11 Pro XL back gradient).
  png: Object.freeze({ palette: true, quality: 100, colours: 256, dither: 1, compressionLevel: 9, effort: 10 }),
  jpg: Object.freeze({ quality: 86, mozjpeg: true, background: '#ffffff' }),
});

/** The config's render settings over the defaults, one level deep. */
export function renderOf(imagery = {}) {
  const r = imagery.render ?? {};
  return { ...RENDER_DEFAULTS, ...r,
    webp: { ...RENDER_DEFAULTS.webp, ...(r.webp ?? {}) }, png: { ...RENDER_DEFAULTS.png, ...(r.png ?? {}) }, jpg: { ...RENDER_DEFAULTS.jpg, ...(r.jpg ?? {}) } };
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fetching ────────────────────────────────────────────────────────────────

export async function download(url, { fetchImpl = fetch, attempts = 4, timeoutMs = 180_000, sleep = pause } = {}) {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await sleep(1500 * 2 ** attempt);
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' },
        redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) { lastErr = `HTTP ${r.status}`; if (r.status < 500 && r.status !== 429) break; continue; }
      const type = r.headers.get('content-type') || '';
      if (!type.startsWith('image/')) { lastErr = `not an image (${type})`; break; }
      return { ok: true, buf: Buffer.from(await r.arrayBuffer()), type, finalUrl: r.url };
    } catch (e) { lastErr = e.message; }
  }
  return { ok: false, error: lastErr };
}

/** Raw downloads are kept outside the checkout, one file per URL, and never committed. */
export const cacheFileOf = (cacheDir, url) => join(cacheDir, `${sha256(Buffer.from(url)).slice(0, 24)}.bin`);

export async function cached(url, { cacheDir, refetch = false, ...options }) {
  mkdirSync(cacheDir, { recursive: true });
  const file = cacheFileOf(cacheDir, url);
  if (!refetch && existsSync(file)) return { ok: true, buf: readFileSync(file), cached: true };
  const res = await download(url, options);
  if (res.ok) writeFileSync(file, res.buf);
  return res;
}

// ── The pixel work (fetch-vantage-devices.mjs, unchanged) ───────────────────

async function rgba(buf) {
  const { data, info } = await loadSharp()(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** True when the image already carries transparency at its border (a cut-out render). */
export function hasAlphaGround({ data, width, height }) {
  let clear = 0, n = 0;
  const probe = (x, y) => { n += 1; if (data[(y * width + x) * 4 + 3] < 250) clear += 1; };
  for (let x = 0; x < width; x += 7) { probe(x, 0); probe(x, height - 1); }
  for (let y = 0; y < height; y += 7) { probe(0, y); probe(width - 1, y); }
  return clear / n > 0.9;
}

/**
 * Remove an opaque studio ground by flood fill from the border: only pixels connected to the edge and
 * within `tol` of the ground colour become transparent, so nothing inside the product's closed outline is
 * ever cut. The kept edge is pulled in by one pixel and its alpha feathered (a dark fringe against a black
 * ground reads as a grey stair-step on a white card).
 */
export function keyGround(img, tol = 36) {
  const { data, width, height } = img;
  const ring = [[], [], []];
  for (let x = 0; x < width; x += 3) for (const y of [0, height - 1]) { const i = (y * width + x) * 4; ring[0].push(data[i]); ring[1].push(data[i + 1]); ring[2].push(data[i + 2]); }
  for (let y = 0; y < height; y += 3) for (const x of [0, width - 1]) { const i = (y * width + x) * 4; ring[0].push(data[i]); ring[1].push(data[i + 1]); ring[2].push(data[i + 2]); }
  const bg = ring.map((a) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]);
  const dist = (i) => Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
  const gone = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => { const p = y * width + x; if (!gone[p] && dist(p * 4) <= tol) { gone[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const p = stack.pop(); const x = p % width, y = (p - x) / width;
    if (x > 0) push(x - 1, y); if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < height - 1) push(x, y + 1);
  }
  const edge = [];
  for (let p = 0; p < width * height; p += 1) {
    if (gone[p]) continue;
    const x = p % width, y = (p - x) / width;
    if ((x > 0 && gone[p - 1]) || (x < width - 1 && gone[p + 1]) || (y > 0 && gone[p - width]) || (y < height - 1 && gone[p + width])) edge.push(p);
  }
  for (const p of edge) gone[p] = 1;
  let removed = 0;
  const soft = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) { sum += gone[yy * width + xx] ? 0 : 1; n += 1; }
    }
    soft[y * width + x] = sum / n;
  }
  for (let p = 0; p < width * height; p += 1) {
    if (gone[p]) removed += 1;
    data[p * 4 + 3] = Math.round(data[p * 4 + 3] * (gone[p] ? 0 : soft[p]));
  }
  return { ground: bg, removedShare: removed / (width * height) };
}

/** A floor shadow cut off by the source frame reads as a grey box; drop everything faint. */
export function dropFaint({ data }, below = 110) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < below) { data[i] = 0; n += 1; }
  return n;
}

/** Bounding box of everything that is not transparent, and whether it touches the source frame. */
export function alphaBox({ data, width, height }, min = 12) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * 4 + 3] >= min) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1,
    touchesEdge: minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1 };
}

export async function cutout(buf, { key, keyTol = 36, shadow } = {}) {
  const sharp = loadSharp();
  const img = await rgba(buf);
  let keyed = null;
  if (key || !hasAlphaGround(img)) keyed = keyGround(img, keyTol);
  const shadowPixels = shadow === 'remove' ? dropFaint(img) : 0;
  const box = alphaBox(img);
  if (!box) throw new Error('no content found');
  const png = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).extract(box).png().toBuffer();
  return { png, box, source: { width: img.width, height: img.height }, keyed, shadowPixels };
}

/** Back on the left and in front, the front render behind it to the right, as the maker's own pair is shot. */
export async function composePair(back, front, render = RENDER_DEFAULTS) {
  const sharp = loadSharp();
  const H = render.composeHeight;
  const b = await sharp(back.png).resize({ height: H }).png().toBuffer();
  const f = await sharp(front.png).resize({ height: H }).png().toBuffer();
  const bw = (await sharp(b).metadata()).width, fw = (await sharp(f).metadata()).width;
  const offset = Math.round(bw * render.composeOffset);
  const W = Math.max(bw, offset + fw);
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: f, left: offset, top: 0 }, { input: b, left: 0, top: 0 }]).png().toBuffer();
}

/** Resize to the fill, centre on a transparent square, and encode: WebP and PNG transparent, JPEG on white. */
export async function place(png, render = RENDER_DEFAULTS) {
  const sharp = loadSharp();
  const SIZE = render.size;
  const target = Math.round(SIZE * render.fill);
  const product = await sharp(png).resize(target, target, { fit: 'inside' }).png().toBuffer();
  const pm = await sharp(product).metadata();
  const canvas = sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: product, left: Math.round((SIZE - pm.width) / 2), top: Math.round((SIZE - pm.height) / 2) }]);
  const transparent = await canvas.png().toBuffer();
  const webp = await sharp(transparent).webp(render.webp).toBuffer();
  const pngOut = await sharp(transparent).png(render.png).toBuffer();
  const { background, ...jpeg } = render.jpg;
  const jpg = await sharp(transparent).flatten({ background }).jpeg(jpeg).toBuffer();
  return { webp, png: pngOut, jpg, fill: Math.max(pm.width, pm.height) / SIZE, product: { width: pm.width, height: pm.height } };
}

// ── The manifest ────────────────────────────────────────────────────────────

/** Where one source came from and what was done to it (`sha` and `bytes` are the raw download's). */
export function sourceRecord({ role, url }, { page, retrieved, sha, bytes, cut }) {
  return { role, url, page, retrieved, sha256: sha, bytes,
    pixels: `${cut.source.width}x${cut.source.height}`, touchesEdge: cut.box.touchesEdge,
    ground: cut.keyed ? `opaque ${cut.keyed.ground.join(',')} keyed from the border` : 'transparent',
    ...(cut.shadowPixels ? { shadow: 'faint floor shadow removed (it ran off the source frame)' } : {}) };
}

/** One manifest row, in the shape public/vantage/img/MANIFEST.json carries for every device. */
export function manifestRow(d, { subdir, size, fill, bytes, sha, sources, views, licence }) {
  return {
    id: d.id, name: d.name, maker: d.maker, colour: d.colour,
    files: { png: `${subdir}/${d.id}.png`, webp: `${subdir}/${d.id}.webp`, white: `${subdir}/${d.id}.jpg` },
    ...(d.spare ? { spare: d.spare } : {}),
    size: { width: size, height: size, productFill: Math.round(fill * 100) / 100 },
    bytes: { png: bytes.png, webp: bytes.webp, jpg: bytes.jpg }, sha256: sha,
    generated: false, view: d.kind === 'compose' ? views.compose : views.pair,
    sources,
    licence,
  };
}

/** The row a failed fetch leaves: no files, the placeholder named, the reason as the verdict's note. */
export const failedRow = (d, placeholderFile, reason) => ({ id: d.id, name: d.name, maker: d.maker, files: null, placeholder: placeholderFile, generated: false,
  gate: { verdict: 'missing', note: reason } });

export const PENDING = Object.freeze({ verdict: 'pending', note: 'not yet checked by eye at 1:1 for this exact file' });

/**
 * The human defect-check verdict for a row, bound to the exact output file. A review entry from the config
 * (`{ verdict, checked, sha, note }`, the shape of fetch-vantage-devices.mjs's GATE) decides when there is
 * one; otherwise the previous manifest row's verdict carries over only if it was given to this sha256.
 */
export function gateOf(row, { review = null, previous = null } = {}) {
  if (review) return review.sha === row.sha256 ? { verdict: review.verdict, checked: review.checked, note: review.note } : { ...PENDING };
  const g = previous?.gate;
  if (g && previous.sha256 === row.sha256 && g.verdict && !['pending', 'missing'].includes(g.verdict)) return { ...g };
  return { ...PENDING };
}

export function walk(dir) {
  const out = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** The image payload under a directory, the manifest itself excluded, against the demo's budget. */
export function totals(dir, budgetMegabytes, manifestName = 'MANIFEST.json') {
  const files = walk(dir).filter((p) => basename(p) !== manifestName);
  const bytes = files.reduce((n, p) => n + statSync(p).size, 0);
  return { files: files.length, bytes, megabytes: Math.round((bytes / 1048576) * 100) / 100, budgetMegabytes };
}

export function readManifest(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

/** What is wrong with a row's shape, against the shape the Vantage manifest carries; empty when sound. */
export function manifestRowProblems(row) {
  const out = [];
  const str = (k) => { if (typeof row[k] !== 'string' || !row[k]) out.push(`${row.id ?? '?'}: ${k} must be a non-empty string`); };
  ['id', 'name', 'maker'].forEach(str);
  if (row.files === null) {
    if (typeof row.placeholder !== 'string' || row.gate?.verdict !== 'missing') out.push(`${row.id}: a row without files names its placeholder and a "missing" verdict`);
    return out;
  }
  ['view', 'licence', 'sha256'].forEach(str);
  if (!/^[0-9a-f]{64}$/.test(row.sha256 ?? '')) out.push(`${row.id}: sha256 must be 64 hex characters`);
  for (const k of ['png', 'webp', 'white']) if (typeof row.files?.[k] !== 'string') out.push(`${row.id}: files.${k} must be a path`);
  if (!Number.isInteger(row.size?.width) || !Number.isInteger(row.size?.height) || typeof row.size?.productFill !== 'number') out.push(`${row.id}: size is { width, height, productFill }`);
  for (const k of ['png', 'webp', 'jpg']) if (!Number.isInteger(row.bytes?.[k])) out.push(`${row.id}: bytes.${k} must be a whole number`);
  if (row.generated !== false) out.push(`${row.id}: generated must be false (a fetched render)`);
  if (!Array.isArray(row.sources) || !row.sources.length) out.push(`${row.id}: sources must list where each part came from`);
  for (const s of row.sources ?? []) {
    for (const k of ['role', 'url', 'page', 'retrieved', 'sha256', 'pixels', 'ground']) if (typeof s[k] !== 'string' || !s[k]) out.push(`${row.id}: sources[].${k} must be a string`);
    if (!Number.isInteger(s.bytes) || typeof s.touchesEdge !== 'boolean') out.push(`${row.id}: sources[] carries bytes and touchesEdge`);
  }
  if (!row.gate || typeof row.gate.verdict !== 'string') out.push(`${row.id}: gate.verdict is required`);
  return out;
}

// ── The run ─────────────────────────────────────────────────────────────────

/**
 * Fetch what is missing (or everything with `force`), normalise, encode, write the three files per item
 * under <outDir>/<subdir>/, and write the manifest's section with provenance and verdicts. Rows outside
 * `only` and rows already on disk are kept as they are. `gateFrom` reads verdicts from another manifest
 * (read-only), still bound to each file's sha256.
 */
export async function fetchImagery({ imagery, outDir, manifestPath, cacheDir, only = [], force = false, refetch = false,
  retrieved = new Date().toISOString().slice(0, 10), gateFrom = null, log = console.log, fetchImpl = fetch }) {
  const render = renderOf(imagery);
  const out = join(outDir, imagery.subdir);
  mkdirSync(out, { recursive: true });
  const manifest = readManifest(manifestPath);
  const previous = new Map((manifest[imagery.section] || []).map((d) => [d.id, d]));
  const verdicts = gateFrom ? new Map((readManifest(gateFrom)[imagery.section] || []).map((d) => [d.id, d])) : previous;
  const rows = [];
  let made = 0, kept = 0, failed = 0;
  log(`${imagery.section}: ${imagery.sources.length} in the lineup, cache ${cacheDir}`);
  for (const d of imagery.sources) {
    const webpPath = join(out, `${d.id}.webp`), jpgPath = join(out, `${d.id}.jpg`), pngPath = join(out, `${d.id}.png`);
    const inScope = !only.length || only.includes(d.id);
    const upToDate = !force && existsSync(webpPath) && existsSync(jpgPath) && existsSync(pngPath) && previous.has(d.id);
    if (!inScope || upToDate) { if (previous.has(d.id)) { rows.push(previous.get(d.id)); kept += 1; } continue; }
    try {
      const parts = [];
      for (const s of d.src) {
        const res = await cached(s.url, { cacheDir, refetch, fetchImpl });
        if (!res.ok) throw new Error(`${s.role}: ${res.error}`);
        parts.push({ ...s, buf: res.buf, cut: await cutout(res.buf, s) });
      }
      const png = d.kind === 'compose'
        ? await composePair(parts.find((p) => p.role === 'back').cut, parts.find((p) => p.role === 'front').cut, render)
        : parts[0].cut.png;
      const placed = await place(png, render);
      writeFileSync(webpPath, placed.webp);
      writeFileSync(jpgPath, placed.jpg);
      writeFileSync(pngPath, placed.png);
      rows.push(manifestRow(d, {
        subdir: imagery.subdir, size: render.size, fill: placed.fill,
        bytes: { png: placed.png.length, webp: placed.webp.length, jpg: placed.jpg.length }, sha: sha256(placed.webp),
        sources: parts.map((p) => sourceRecord(p, { page: d.page, retrieved, sha: sha256(p.buf), bytes: p.buf.length, cut: p.cut })),
        views: imagery.views, licence: imagery.licences[d.maker],
      }));
      made += 1;
      log(`  ${d.id} … ${Math.round(placed.webp.length / 1024)}KB webp, ${Math.round(placed.jpg.length / 1024)}KB jpg, fill ${Math.round(placed.fill * 100)}%`);
    } catch (e) {
      failed += 1;
      log(`  ${d.id} … failed (${e.message}); the page shows the placeholder`);
      rows.push(failedRow(d, imagery.placeholder.file, e.message));
    }
  }
  // The verdict is re-read on every run, for kept rows too, and holds only for the file it was given to.
  for (const r of rows) if (r.files) r.gate = gateOf(r, { review: imagery.gate?.[r.id] ?? null, previous: verdicts.get(r.id) ?? null });
  manifest.about = imagery.manifestAbout;
  manifest[imagery.section] = rows;
  manifest.placeholders = { ...(manifest.placeholders || {}), [imagery.placeholder.key]: imagery.placeholder.file };
  manifest.totals = totals(outDir, imagery.budgetMegabytes, basename(manifestPath));
  mkdirSync(join(manifestPath, '..'), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${imagery.section}: ${made} written, ${kept} kept, ${failed} failed; image payload ${manifest.totals.megabytes} MB of ${imagery.budgetMegabytes}`);
  return { manifest, rows, made, kept, failed };
}

/** A contact sheet of every row with files, for the defect check at 1:1. */
export async function contactSheet({ rows, imgDir, file, cell = 360, cols = 4 }) {
  const sharp = loadSharp();
  const list = rows.filter((r) => r.files);
  const tiles = [];
  for (let i = 0; i < list.length; i += 1) {
    const img = await sharp(join(imgDir, list[i].files.webp)).flatten({ background: '#f2f2f2' }).resize(cell, cell).png().toBuffer();
    tiles.push({ input: img, left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
  }
  await sharp({ create: { width: cols * cell, height: Math.max(1, Math.ceil(list.length / cols)) * cell, channels: 3, background: '#f2f2f2' } })
    .composite(tiles).png().toFile(file);
  return list.length;
}
