// node --test scripts/demo-kit/lib/imagery.test.mjs
// The imagery library: the manifest rows it writes have exactly the shape public/vantage/img/MANIFEST.json
// carries (rebuilt from the committed rows' own numbers), verdicts hold only for the sha256 they were
// given to (the config's own review or the previous row's), the manifest write with its totals, the cache
// naming, the download's retries, and — where sharp loads (WSL on this checkout) — the pixel work itself on
// a synthetic image. Nothing here reads the network or writes outside a temporary directory. (Part a's guard
// comparing the config's URL list with the committed manifest retired in part b, when the config became the
// source and scripts/fetch-vantage-devices.mjs a wrapper over it.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidConfig } from './config.mjs';
import {
  GALLERY_SECTION, RENDER_DEFAULTS, cacheFileOf, cutout, download, failedRow, fetchImagery, gateOf, loadSharp, manifestRow, manifestRowProblems, place, renderOf,
  reviewFor, sha256, sourceRecord, totals, writeManifest,
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

/** A second picture's row, as the `gallery` section carries it: the kit's row with WebP and JPEG only, naming the row it follows. */
const galleryRowOf = (row) => {
  const { files, bytes, ...rest } = row;
  return { ...rest, id: `${row.id}-2`, of: row.id, files: { webp: files.webp.replace('.webp', '-2.webp'), white: files.white.replace('.jpg', '-2.jpg') },
    bytes: { webp: bytes.webp, jpg: bytes.jpg } };
};

test('a gallery row (a second picture, WebP and JPEG only) passes the shape check for its section; without the section, or without `of`, it does not', () => {
  const g = galleryRowOf(byId.get('galaxy-s26'));
  assert.deepEqual(manifestRowProblems(g, { section: GALLERY_SECTION }), []);
  assert.match(manifestRowProblems(g).join(), /files\.png must be a path/, 'outside its section a row still needs its PNG');
  assert.match(manifestRowProblems(g).join(), /bytes\.png must be a whole number/);
  const { of: _of, ...orphan } = g;
  assert.match(manifestRowProblems(orphan, { section: GALLERY_SECTION }).join(), /of must be a non-empty string/, 'a second picture names the row it follows');
  assert.match(manifestRowProblems({ ...g, files: { webp: g.files.webp } }, { section: GALLERY_SECTION }).join(), /files\.white must be a path/);
  assert.match(manifestRowProblems({ ...g, bytes: { webp: 1 } }, { section: GALLERY_SECTION }).join(), /bytes\.jpg must be a whole number/);
  for (const row of committed.devices) assert.deepEqual(manifestRowProblems(row, { section: GALLERY_SECTION }).filter((p) => !/: of must be/.test(p)), [], `${row.id}: a full row also satisfies the gallery's files and bytes`);
});

// OH's second pictures (Lane D2b), where the working tree carries them: every row passes the gallery shape check,
// follows a product row, and the index's `gallery` field has the shape imagery.mjs documents.
const ohImg = fileURLToPath(new URL('../../../public/oh/img/', import.meta.url));
const ohManifest = existsSync(join(ohImg, 'MANIFEST.json')) ? JSON.parse(readFileSync(join(ohImg, 'MANIFEST.json'), 'utf8')) : null;
const ohIndex = existsSync(join(ohImg, 'index.json')) ? JSON.parse(readFileSync(join(ohImg, 'index.json'), 'utf8')) : null;
test('OH\'s gallery section and the index\'s gallery field: rows of the gallery shape, the first entry equal to src, two with a second picture, one without, [] for a placeholder', { skip: !(ohManifest?.[GALLERY_SECTION] && ohIndex) && 'no OH gallery in this checkout' }, () => {
  const rows = ohManifest[GALLERY_SECTION];
  const productIds = new Set(ohManifest.products.map((r) => r.id));
  for (const r of rows) {
    assert.deepEqual(manifestRowProblems(r, { section: GALLERY_SECTION }), [], r.id);
    assert.ok(productIds.has(r.of) && r.id === `${r.of}-2`, `${r.id} follows a product row`);
    assert.equal(sha256(readFileSync(join(ohImg, r.files.webp))), r.sha256, `${r.id}: the file is the one reviewed`);
  }
  const second = new Map(rows.map((r) => [r.of, `/oh/img/${r.files.webp}`]));
  for (const [sku, e] of Object.entries(ohIndex.products)) {
    assert.ok(Array.isArray(e.gallery), `${sku}: gallery is an array`);
    if (e.verdict !== 'accept') { assert.deepEqual(e.gallery, [], `${sku}: a placeholder product has no pictures`); continue; }
    assert.equal(e.gallery[0], e.src, `${sku}: the first entry is src`);
    assert.deepEqual(e.gallery.slice(1), second.has(e.id) ? [second.get(e.id)] : [], `${sku}: the second entry is the gallery row's WebP, or none`);
  }
  assert.equal(Object.values(ohIndex.products).filter((e) => e.gallery.length === 2).length, rows.length);
});

test('a kit rerun keeps the manifest\'s gallery section and the index\'s gallery field as they were, and no demo section may be called "gallery"', async () => {
  const out = mkdtempSync(join(tmpdir(), 'demo-kit-gallery-'));
  mkdirSync(join(out, 'products'));
  const files = { 'p1.webp': 'w1', 'p1.jpg': 'j1', 'p1.png': 'p1', 'p1-2.webp': 'w2', 'p1-2.jpg': 'j2' };
  for (const [f, body] of Object.entries(files)) writeFileSync(join(out, 'products', f), body);
  const product = { ...byId.get('galaxy-s26'), id: 'p1', files: { png: 'products/p1.png', webp: 'products/p1.webp', white: 'products/p1.jpg' }, sha256: sha256(Buffer.from('w1')) };
  const gallery = [{ ...galleryRowOf(product), files: { webp: 'products/p1-2.webp', white: 'products/p1-2.jpg' }, sha256: sha256(Buffer.from('w2')) }];
  writeFileSync(join(out, 'MANIFEST.json'), `${JSON.stringify({ about: 'x', products: [product], totals: {}, art: { rows: [] }, [GALLERY_SECTION]: gallery }, null, 2)}\n`);
  const index = `${JSON.stringify({ products: { P1: { id: 'p1', verdict: 'accept', src: '/d/img/products/p1.webp', gallery: ['/d/img/products/p1.webp', '/d/img/products/p1-2.webp'] } } }, null, 1)}\n`;
  writeFileSync(join(out, 'index.json'), index);
  const conf = { ...imagery, section: 'products', subdir: 'products', gate: undefined,
    sources: [{ id: 'p1', name: product.name, maker: product.maker, page: 'https://example.com/p1', kind: 'pair', src: [{ role: 'pair', url: 'https://example.com/p1.png' }] }] };
  const noNetwork = async () => { throw new Error('no network'); };
  const result = await fetchImagery({ imagery: conf, outDir: out, manifestPath: join(out, 'MANIFEST.json'), cacheDir: mkdtempSync(join(tmpdir(), 'demo-kit-cache-')), log: () => {}, fetchImpl: noNetwork });
  assert.deepEqual([result.made, result.kept, result.failed], [0, 1, 0], 'nothing fetched: the product is on disk');
  const written = JSON.parse(readFileSync(join(out, 'MANIFEST.json'), 'utf8'));
  assert.deepEqual(written[GALLERY_SECTION], gallery, 'the gallery section is kept as read');
  assert.deepEqual(written.art, { rows: [] }, 'and any other section');
  assert.equal(readFileSync(join(out, 'index.json'), 'utf8'), index, 'the index, its gallery field included, is not touched');
  assert.equal(written.totals.files, 6, 'the totals count the second pictures (and the index) as payload');
  await assert.rejects(fetchImagery({ imagery: { ...conf, section: GALLERY_SECTION }, outDir: out, manifestPath: join(out, 'MANIFEST.json'), cacheDir: out, log: () => {}, fetchImpl: noNetwork }),
    /cannot be "gallery"/);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'MANIFEST.json'), 'utf8'))[GALLERY_SECTION], gallery, 'the refused run wrote nothing');
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

test('a review binds to one file: reviewFor answers only for the exact sha256, and the config\'s reviews reproduce the committed verdicts', () => {
  const review = { verdict: 'accept', checked: '2026-09-30', sha: 'e'.repeat(64), note: 'clean', rejected: ['b: a hand'] };
  assert.equal(reviewFor(review, 'e'.repeat(64)), review, 'the whole review, extra fields included (the art generator keeps rejected)');
  assert.equal(reviewFor(review, 'f'.repeat(64)), null);
  assert.equal(reviewFor(null, 'e'.repeat(64)), null);
  assert.equal(reviewFor({ verdict: 'accept' }, undefined), null, 'a review without a sha binds to nothing');
  assert.deepEqual(Object.keys(imagery.gate), imagery.sources.map((s) => s.id), 'one review per device, in lineup order');
  for (const [id, g] of Object.entries(imagery.gate)) assert.deepEqual(Object.keys(g), ['verdict', 'checked', 'sha', 'note'], id);
  for (const d of committed.devices) {
    assert.deepEqual(gateOf(d, { review: imagery.gate[d.id] }), d.gate, `${d.id}: the config's review gives the committed file its committed verdict`);
    assert.equal(gateOf({ ...d, sha256: '0'.repeat(64) }, { review: imagery.gate[d.id] }).verdict, 'pending', `${d.id}: and any other file reads pending`);
  }
});

test('writeManifest sets the totals in place over the directory and writes two-space JSON with a final newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-kit-manifest-'));
  mkdirSync(join(dir, 'tiles'));
  writeFileSync(join(dir, 'tiles', 'a.png'), Buffer.alloc(2048));
  const file = join(dir, 'MANIFEST.json');
  const manifest = { about: 'x', totals: { stale: true }, promos: [] };
  const t = writeManifest(file, manifest, { dir, budgetMegabytes: 25 });
  assert.deepEqual(t, { files: 1, bytes: 2048, megabytes: 0, budgetMegabytes: 25 });
  assert.deepEqual(Object.keys(manifest), ['about', 'totals', 'promos'], 'an existing totals key keeps its place');
  assert.equal(readFileSync(file, 'utf8'), `${JSON.stringify(manifest, null, 2)}\n`);
  const fresh = writeManifest(join(dir, 'nested', 'MANIFEST.json'), { about: 'y' }, { dir: join(dir, 'tiles'), budgetMegabytes: 10 });
  assert.equal(fresh.files, 1, 'the directory is created, and only the image payload counts');
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
  const reviewed = { ...conf, gate: { 'phone-one': { verdict: 'accept', checked: '2026-10-01', sha: row.sha256, note: 'looked at 1:1' } } };
  const third = await fetchImagery({ imagery: reviewed, outDir: out, manifestPath: join(out, 'MANIFEST.json'), cacheDir, log: () => {}, fetchImpl: async () => { throw new Error('no network'); } });
  assert.deepEqual(third.rows[0].gate, { verdict: 'accept', checked: '2026-10-01', note: 'looked at 1:1' }, 'the config\'s review, given to this exact file, is its verdict');
  const stale = { ...conf, gate: { 'phone-one': { ...reviewed.gate['phone-one'], sha: 'a'.repeat(64) } } };
  const fourth = await fetchImagery({ imagery: stale, outDir: out, manifestPath: join(out, 'MANIFEST.json'), cacheDir, log: () => {}, fetchImpl: async () => { throw new Error('no network'); } });
  assert.equal(fourth.rows[0].gate.verdict, 'pending', 'a review of another file is no verdict for this one');
});
