// node --test scripts/demo-kit/lib/imagery.test.mjs
// The imagery library: the manifest rows it writes have exactly the shape public/vantage/img/MANIFEST.json
// carries (rebuilt from the committed rows' own numbers), verdicts hold only for the sha256 they were
// given to, the totals, the cache naming, the download's retries, and — where sharp loads (WSL on this
// checkout) — the pixel work itself on a synthetic image. Nothing here reads the network or writes outside
// a temporary directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidConfig } from './config.mjs';
import {
  RENDER_DEFAULTS, cacheFileOf, cutout, download, failedRow, fetchImagery, gateOf, loadSharp, manifestRow, manifestRowProblems, place, renderOf,
  sha256, sourceRecord, totals,
} from './imagery.mjs';

const configFile = fileURLToPath(new URL('../configs/vantage.json', import.meta.url));
const vantage = loadValidConfig(configFile, { sections: ['imagery'], exit: (code) => { throw new Error(`the Vantage config is invalid (${code})`); } });
const imagery = vantage.config.imagery;
const committed = JSON.parse(readFileSync(vantage.path(imagery.manifest), 'utf8'));
const byId = new Map(committed.devices.map((d) => [d.id, d]));
const sourceOf = (id) => imagery.sources.find((s) => s.id === id);
let sharpLoads = true;
try { loadSharp(); } catch { sharpLoads = false; }

/** The committed row rebuilt from its own numbers through the kit's row and source builders. */
function rebuilt(id) {
  const row = byId.get(id), d = sourceOf(id);
  const sources = row.sources.map((s) => sourceRecord({ role: s.role, url: s.url }, {
    page: s.page, retrieved: s.retrieved, sha: s.sha256, bytes: s.bytes,
    cut: { source: { width: Number(s.pixels.split('x')[0]), height: Number(s.pixels.split('x')[1]) }, box: { touchesEdge: s.touchesEdge },
      keyed: s.ground === 'transparent' ? null : { ground: s.ground.replace(/^opaque ([\d,]+) .*$/, '$1').split(',').map(Number) },
      shadowPixels: s.shadow ? 1 : 0 },
  }));
  return manifestRow(d, { subdir: imagery.subdir, size: row.size.width, fill: row.size.productFill, bytes: row.bytes, sha: row.sha256,
    sources, views: imagery.views, licence: imagery.licences[d.maker] });
}

test('a manifest row has exactly the committed shape, key order included: a pair, a compose, a spare, a keyed ground and a dropped shadow', () => {
  for (const id of ['iphone-18-pro', 'pixel-11', 'pixel-11-pro-xl', 'pixel-10a', 'razr-2026']) {
    const row = rebuilt(id);
    const { gate, ...want } = byId.get(id);
    assert.equal(JSON.stringify(row), JSON.stringify(want), id);
    assert.deepEqual(manifestRowProblems({ ...row, gate }), [], id);
  }
});

test('every committed device row passes the shape check, and a broken one names its fault', () => {
  for (const row of committed.devices) assert.deepEqual(manifestRowProblems(row), [], row.id);
  const row = byId.get('galaxy-s26');
  assert.match(manifestRowProblems({ ...row, sha256: 'abc' }).join(), /64 hex characters/);
  assert.match(manifestRowProblems({ ...row, files: { png: 'x' } }).join(), /files\.webp must be a path/);
  assert.match(manifestRowProblems({ ...row, sources: [] }).join(), /sources must list/);
  assert.match(manifestRowProblems({ ...row, generated: true }).join(), /generated must be false/);
  assert.match(manifestRowProblems({ ...row, gate: undefined }).join(), /gate\.verdict is required/);
  const failed = failedRow(sourceOf('galaxy-s26'), imagery.placeholder.file, 'HTTP 404');
  assert.deepEqual(failed, { id: 'galaxy-s26', name: 'Samsung Galaxy S26', maker: 'samsung', files: null, placeholder: 'placeholder-device.svg', generated: false, gate: { verdict: 'missing', note: 'HTTP 404' } });
  assert.deepEqual(manifestRowProblems(failed), []);
});

test('a verdict holds only for the sha256 it was given to', () => {
  const row = { id: 'x', sha256: 'a'.repeat(64) };
  const accepted = { sha256: row.sha256, gate: { verdict: 'accept', checked: '2026-09-30', note: 'clean' } };
  assert.deepEqual(gateOf(row, { previous: accepted }), accepted.gate, 'the same file keeps its verdict');
  assert.equal(gateOf(row, { previous: { ...accepted, sha256: 'b'.repeat(64) } }).verdict, 'pending', 'one changed byte reads pending');
  assert.equal(gateOf(row, { previous: { ...accepted, gate: { verdict: 'pending' } } }).verdict, 'pending');
  assert.equal(gateOf(row, {}).verdict, 'pending');
  const review = { verdict: 'accept', checked: '2026-10-01', sha: row.sha256, note: 'looked at 1:1' };
  assert.deepEqual(gateOf(row, { review, previous: { ...accepted, sha256: 'c'.repeat(64) } }), { verdict: 'accept', checked: '2026-10-01', note: 'looked at 1:1' });
  assert.equal(gateOf(row, { review: { ...review, sha: 'd'.repeat(64) }, previous: accepted }).verdict, 'pending', 'a review decides when there is one');
  for (const d of committed.devices) assert.equal(gateOf(d, { previous: d }).verdict, 'accept', `${d.id}: the committed verdict carries over for the committed file`);
});

test('the totals exclude the manifest; the render settings merge over Vantage\'s; the cache is named as the Vantage script names it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-kit-imagery-'));
  mkdirSync(join(dir, 'devices'));
  writeFileSync(join(dir, 'devices', 'a.webp'), Buffer.alloc(1000));
  writeFileSync(join(dir, 'MANIFEST.json'), '{}');
  assert.deepEqual(totals(dir, 25), { files: 1, bytes: 1000, megabytes: 0, budgetMegabytes: 25 });
  assert.deepEqual(renderOf({}), { ...RENDER_DEFAULTS, webp: { ...RENDER_DEFAULTS.webp }, png: { ...RENDER_DEFAULTS.png }, jpg: { ...RENDER_DEFAULTS.jpg } });
  assert.deepEqual(renderOf({ render: { size: 600, webp: { quality: 80 } } }).webp, { quality: 80, alphaQuality: 100, effort: 6 });
  assert.equal(renderOf(imagery).size, 800);
  const url = 'https://example.com/a.png';
  assert.equal(cacheFileOf('/c', url), join('/c', `${sha256(Buffer.from(url)).slice(0, 24)}.bin`));
});

test('the download retries a 5xx, stops on a 404 and refuses what is not an image', async () => {
  const answers = (list) => { let i = 0; const seen = []; return { seen, fetchImpl: async (url) => { seen.push(url); return list[Math.min(i++, list.length - 1)]; } }; };
  const res = (status, type = 'image/png') => ({ ok: status < 400, status, url: 'u', headers: { get: () => type }, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  const retry = answers([res(503), res(200)]);
  const ok = await download('u', { fetchImpl: retry.fetchImpl, sleep: async () => {} });
  assert.deepEqual([ok.ok, ok.buf.length, retry.seen.length], [true, 2, 2]);
  const gone = answers([res(404)]);
  assert.deepEqual([(await download('u', { fetchImpl: gone.fetchImpl, sleep: async () => {} })).error, gone.seen.length], ['HTTP 404', 1]);
  const page = answers([res(200, 'text/html')]);
  assert.match((await download('u', { fetchImpl: page.fetchImpl, sleep: async () => {} })).error, /not an image \(text\/html\)/);
});

test('the Vantage imagery config lists every committed device with the same source URLs, page, maker and licence', () => {
  assert.equal(imagery.sources.length, committed.devices.length);
  for (const row of committed.devices) {
    const d = sourceOf(row.id);
    assert.ok(d, row.id);
    assert.deepEqual(d.src.map((s) => [s.role, s.url]), row.sources.map((s) => [s.role, s.url]), row.id);
    assert.equal(d.page, row.sources[0].page, row.id);
    assert.deepEqual([d.name, d.maker, d.colour], [row.name, row.maker, row.colour], row.id);
    assert.equal(imagery.licences[d.maker], row.licence, row.id);
    assert.equal(d.kind === 'compose' ? imagery.views.compose : imagery.views.pair, row.view, row.id);
  }
});

test('the pixel work on a synthetic render: a white ground keyed from the border, placed at 86 % of an 800 square', { skip: !sharpLoads && 'sharp does not load on this platform (run under WSL)' }, async () => {
  const sharp = loadSharp();
  const W = 300, H = 200;
  const raw = Buffer.alloc(W * H * 4, 255);
  for (let y = 40; y < 160; y += 1) for (let x = 100; x < 160; x += 1) { const i = (y * W + x) * 4; raw[i] = 20; raw[i + 1] = 20; raw[i + 2] = 20; }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const cut = await cutout(png);
  assert.deepEqual(cut.keyed.ground, [255, 255, 255]);
  assert.equal(cut.box.touchesEdge, false);
  assert.ok(cut.box.width <= 60 && cut.box.height <= 120, `the box hugs the product: ${cut.box.width}x${cut.box.height}`);
  const placed = await place(cut.png);
  const meta = await sharp(placed.webp).metadata();
  assert.deepEqual([meta.width, meta.height], [800, 800]);
  assert.equal(Math.round(placed.fill * 100), 86);
  assert.ok(placed.png.length > 0 && placed.jpg.length > 0);
  const record = sourceRecord({ role: 'pair', url: 'https://example.com/x.png' }, { page: 'https://example.com', retrieved: '2026-10-01', sha: sha256(png), bytes: png.length, cut });
  assert.equal(record.ground, 'opaque 255,255,255 keyed from the border');
  assert.equal(record.pixels, '300x200');
});

test('fetchImagery end to end on a stand-in host: three files, a row of the committed shape, totals over the output only', { skip: !sharpLoads && 'sharp does not load on this platform (run under WSL)' }, async () => {
  const sharp = loadSharp();
  const img = await sharp({ create: { width: 120, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 60, height: 200, channels: 4, background: '#3366cc' } }).png().toBuffer(), left: 30, top: 20 }]).png().toBuffer();
  const out = mkdtempSync(join(tmpdir(), 'demo-kit-fetch-'));
  const one = { id: 'phone-one', name: 'Phone One', maker: 'apple', colour: 'Blue', page: 'https://example.com/p', kind: 'pair', src: [{ role: 'pair', url: 'https://example.com/one.png' }] };
  const conf = { ...imagery, sources: [one] };
  const fetchImpl = async () => ({ ok: true, status: 200, url: 'u', headers: { get: () => 'image/png' }, arrayBuffer: async () => img.buffer.slice(img.byteOffset, img.byteOffset + img.length) });
  const cacheDir = mkdtempSync(join(tmpdir(), 'demo-kit-cache-'));
  const result = await fetchImagery({ imagery: conf, outDir: out, manifestPath: join(out, 'MANIFEST.json'), cacheDir, retrieved: '2026-10-01', log: () => {}, fetchImpl });
  assert.deepEqual([result.made, result.failed], [1, 0]);
  const written = JSON.parse(readFileSync(join(out, 'MANIFEST.json'), 'utf8'));
  const row = written.devices[0];
  const shapeOf = (v) => (Array.isArray(v) ? v.map(shapeOf) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)])) : typeof v);
  const { gate: _g, ...committedShape } = shapeOf(byId.get('iphone-18-pro'));
  const { gate, ...rowShape } = shapeOf(row);
  assert.deepEqual(rowShape, committedShape, 'the same keys and value types as a committed device row');
  assert.deepEqual(row.gate, { verdict: 'pending', note: 'not yet checked by eye at 1:1 for this exact file' }, 'nobody has looked at this file');
  assert.equal(written.about, imagery.manifestAbout);
  assert.deepEqual(written.placeholders, { device: 'placeholder-device.svg' });
  assert.equal(written.totals.files, 3, 'the three encodings; the manifest is not image payload');
  assert.equal(row.sha256, sha256(readFileSync(join(out, 'devices', 'phone-one.webp'))));
  assert.equal(row.sources[0].sha256, sha256(img), 'the source hash is the raw download\'s');
  const again = await fetchImagery({ imagery: conf, outDir: out, manifestPath: join(out, 'MANIFEST.json'), cacheDir, log: () => {}, fetchImpl: async () => { throw new Error('no network'); } });
  assert.deepEqual([again.made, again.kept], [0, 1], 'a row already on disk is kept and nothing is fetched');
});
