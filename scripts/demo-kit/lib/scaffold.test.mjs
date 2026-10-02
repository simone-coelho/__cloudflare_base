// node --test scripts/demo-kit/lib/scaffold.test.mjs
// The scaffolder (scripts/demo-kit/new-demo.mjs and lib/scaffold.mjs, lane K4): a small demo scaffolded into a
// scratch root, every file it writes held to the kit's own checks (the seed's local checks, the closed list, the
// anchor's copies, the markup contract), the rule that it never overwrites, and the refusals. Then OH's scaffold in
// this repository, which must seed clean.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadValidConfig, REPO_ROOT, validateConfig } from './config.mjs';
import { DAY, MINUTE, prepareSeed } from './seed.mjs';
import { beatFile, fill, idents, mountLines, planScaffold, selectPiece } from './scaffold.mjs';
import { builderArgs, main } from '../new-demo.mjs';

const ANCHOR = Date.UTC(2026, 9, 2, 12, 0, 0);
const tiny = () => ({
  name: 'KX', slug: 'kx', tenant: 'kx', customer: 'a test',
  worker: { name: 'edge-platform-kx', queue: 'events-kx', devPort: 9199 },
  brand: { wordmark: 'KX', title: 'KX | a test demo' },
  palette: { brand: '#123456', ink: '#111111', paper: '#FFFFFF' },
  fonts: { font: 'Inter', mono: 'JetBrains Mono' },
  dimensions: [
    { key: 'category', values: ['a', 'b', 'c'] },
    { key: 'style', tau: '60s', values: ['x', 'y'] },
    { key: 'intent', tau: '10m', multi: true, values: ['buy', 'browse'] },
  ],
  regional: { dimensions: ['category'] },
  pages: [
    { key: 'home', page: 'home', entry: 'home', url: '/kx/', shell: 'index.html',
      slots: [{ slot: 'hero', take: 1, weights: { category: 0.5, style: 0.2 } }, { slot: 'deals', take: 3, weights: { category: 0.3, intent: 0.4 } },
        { slot: 'back', take: 1, weights: { style: 1 }, gate: { visit: ['return'] } }],
      sorted: [{ slot: 'rail', take: 4, weights: { category: 1 } }] },
    { key: 'product', page: 'product', entry: 'product', url: '/kx/product?id=<id>', shell: 'product.html', slots: [{ slot: 'modules', take: 2, weights: { style: 1 } }] },
    { key: 'phone', page: 'home', entry: 'phone', url: '/kx/m', shell: 'm.html', slotsOf: 'home' },
  ],
  seeds: [{ slots: ['hero', 'deals'], signal: 'campaign_term', value: 'kx sale', tags: [{ dimension: 'category', value: 'b' }], weight: 0.2 }],
  arrival: { utm_source: 'google', utm_medium: 'cpc', utm_term: 'kx sale' },
  beats: { file: 'public/kx/beats.json', acts: { 1: 'Arrive', 2: 'Merchandise' }, list: [
    { key: 'arrive', no: '1', act: 1, who: 'shopper', kind: 'context', label: 'A stranger arrives', press: 'she lands', declare: ['lands'], will: ['paints'], line: 'She lands.', run: [{ publish: 'reset' }, { call: 'arrive' }] },
    { key: 'browse', no: '2', act: 1, who: 'shopper', kind: 'context', lane: 'P9', label: 'She browses', press: 'she browses', declare: ['b'], will: ['w'], line: 'l' },
    { key: 'close', no: '3', act: 2, who: 'merch', kind: 'catalog', label: 'A window closes', press: 'closes', declare: ['d'], will: ['w'], line: 'l',
      change: [{ close: { slotType: 'deals', pick: 'first' }, as: 'closed' }, { outOfStock: { slotType: 'deals', pick: 'last' }, as: 'gone' }] },
    { key: 'pin', no: '4', act: 2, who: 'merch', kind: 'slots', label: 'A pin', press: 'pins', declare: ['d'], will: ['w'], line: 'l',
      change: [{ pin: { slot: 'deals', piece: { slotType: 'deals', pick: 'last' } }, as: 'pinned' }] },
    { key: 'later', no: '5', act: 2, who: 'engine', kind: 'catalog', label: 'Time passes', press: 'later', declare: ['d'], will: ['w'], line: 'l', change: [{ shiftDays: 14 }] },
  ] },
  products: { file: 'public/kx/products.json', list: 'products', id: 'id', attributes: { category: 'category', price_usd: 'price' } },
  region: { dimensions: ['category'], vocabulary: { category: ['a', 'b', 'c'] }, contrast: ['US-TX'] },
  asserted: { intents: ['buy', 'browse'] },
  reportSlots: ['hero', 'deals'],
  copy: { coldStartSentence: 'aggregate, never the individual.', scoredSentence: 'No census term enters any score.' },
  docs: { dir: 'docs/kx' },
});

/** A scratch repository root with what the scaffolder reads: the kit's token sheet, and the demo's config. */
function scratch(demo = tiny()) {
  const root = mkdtempSync(join(tmpdir(), 'demo-kit-scaffold-'));
  mkdirSync(join(root, 'public', 'demo-kit'), { recursive: true });
  cpSync(join(REPO_ROOT, 'public', 'demo-kit', 'tokens.css'), join(root, 'public', 'demo-kit', 'tokens.css'));
  mkdirSync(join(root, 'public', demo.slug), { recursive: true });
  const file = join(root, 'public', demo.slug, 'demo.config.json');
  writeFileSync(file, JSON.stringify(demo, null, 2));
  return { root, file };
}
const run = (root, file, extra = []) => {
  const out = [];
  return main(['--config', file, ...extra], { root, runBuilder: false, nowMs: ANCHOR + 345, log: (l) => out.push(l), err: (l) => out.push(l) }).then((code) => ({ code, out: out.join('\n') }));
};
const read = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

test('new-demo scaffolds every file the design names, and the kit\'s own seed checks pass on what it wrote', async () => {
  const { root, file } = scratch();
  const { code, out } = await run(root, file);
  assert.equal(code, 0, out);
  for (const rel of ['src/demos/kx.config.ts', 'src/routes/kx.ts', 'public/kx/index.html', 'public/kx/product.html', 'public/kx/m.html', 'public/kx/kx.css', 'public/kx/kx.js',
    'public/kx/beats.json', 'public/kx/beats/anchor.json', 'public/kx/beats/open-catalog.json', 'public/kx/beats/open-slots.json', 'public/kx/beats/05-later.json',
    'public/kx/catalog.json', 'public/kx/products.json', 'public/kx/img/MANIFEST.json', 'scripts/demo-kit/configs/kx.json', 'scripts/demo-kit/configs/kx/reflex.json',
    'scripts/demo-kit/configs/kx/learn.json', 'scripts/rehearse-kx-page.mjs', 'scripts/rehearse-kx-dom.mjs', 'docs/kx/KX-Demo-Design.md', 'docs/kx/KX-Presenter-Script.md', 'docs/kx/RESUME-kx.md']) {
    assert.ok(existsSync(join(root, rel)), rel);
  }
  const loaded = loadValidConfig(join(root, 'scripts', 'demo-kit', 'configs', 'kx.json'), { root, sections: ['seed', 'check'], exit: (c) => { throw new Error(`the kit config is invalid (${c})`); } });
  const p = prepareSeed({ config: loaded.config, path: loaded.path, nowMs: ANCHOR + DAY });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  // The closed list, three ways: the server's constants, the kit config, and the anchor's roles for the page.
  const server = readFileSync(join(root, 'src', 'demos', 'kx.config.ts'), 'utf8');
  const listed = Object.fromEntries([...server.matchAll(/^ {2}'([^']+)': '(catalog|slots)',$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(listed, loaded.config.seed.beats.publishable);
  assert.deepEqual(listed, { 'open-catalog': 'catalog', 'open-slots': 'slots', '03-close': 'catalog', '04-pin': 'slots', '05-later': 'catalog' });
  assert.match(server, /new Set\(\['buy', 'browse'\]\)/);
  assert.match(server, /category: \['a', 'b', 'c'\],/);
  const routes = readFileSync(join(root, 'src', 'routes', 'kx.ts'), 'utf8');
  assert.match(routes, /export function kxRoutes\(dispatch: Dispatch\)/);
  assert.match(routes, /export const kxColdStartRoutes = demoColdStartRoutes\(KX_COLD_START\);/);
  // The director's script: the beats as given, an unbuilt beat stopping honestly with its lane.
  const script = read(root, 'public/kx/beats.json');
  assert.equal(script.beats.length, 5);
  assert.deepEqual(script.beats[0].run, [{ publish: 'reset' }, { call: 'arrive' }]);
  assert.deepEqual(script.beats[1].run, [{ call: 'notBuilt', lane: 'P9', what: 'she browses' }]);
  assert.match(out, /app\.route\('\/kx\/api', kxRoutes\(async \(request, env, ctx\) => app\.fetch\(request, env, ctx\)\)\);/);
  assert.match(out, /secrets {2}TENANTS, SDK_KEYS, RETENTION, JWT_SECRET, IDENTITY_SALT \(by name only/);
});

test('publishes are cut in order onto each other: a window closing, a piece out of stock, a pin as a required prefix, time passing', async () => {
  const { root, file } = scratch();
  assert.equal((await run(root, file)).code, 0);
  const anchor = read(root, 'public/kx/beats/anchor.json');
  const at = Date.parse(anchor.anchor);
  assert.equal(at, ANCHOR, 'the anchor is the scaffold\'s moment, to the second');
  const open = read(root, 'public/kx/beats/open-catalog.json').publish.document.pieces;
  const closed = read(root, 'public/kx/beats/03-close.json').publish.document.pieces;
  const deals = open.filter((p) => p.slotTypes.includes('deals'));
  assert.equal(Date.parse(closed.find((p) => p.customerContentId === deals[0].customerContentId).window.to), ANCHOR - MINUTE, 'a window that closed a minute before the anchor');
  assert.equal(closed.find((p) => p.customerContentId === deals[deals.length - 1].customerContentId).inStock, false);
  assert.deepEqual(anchor.ids, { closed: deals[0].customerContentId, gone: deals[deals.length - 1].customerContentId, pinned: deals[deals.length - 1].customerContentId });
  const pin = read(root, 'public/kx/beats/04-pin.json').publish.document.pages.home.find((s) => s.slot === 'deals');
  assert.deepEqual(pin.pinnedPieceIds, [deals[deals.length - 1].id], 'the engine\'s internal id, as a prefix');
  const later = read(root, 'public/kx/beats/05-later.json').publish.document.pieces;
  later.forEach((p, i) => {
    assert.equal(Date.parse(p.window.to), Date.parse(closed[i].window.to) - 14 * DAY, `${p.id}: moved back 14 days from the beat before it`);
    assert.equal(p.inStock, closed[i].inStock, `${p.id}: the beat before it still holds`);
  });
  assert.deepEqual(anchor.beats, { open: { slots: 'open-slots', catalog: 'open-catalog' }, close: { catalog: '03-close' }, pin: { slots: '04-pin' }, later: { catalog: '05-later' } });
  assert.deepEqual(anchor.acts, [{ n: 1, through: 2, name: 'Arrive' }, { n: 2, through: 5, name: 'Merchandise' }]);
  assert.equal(beatFile(10, 'x'), '11-x');
  assert.equal(selectPiece(open, { slotType: 'deals', pick: 'nope' }), null);
});

test('the starter catalog names every value of every dimension, carries each seed on its slot\'s first piece, and gates a gated slot', async () => {
  const { root, file } = scratch();
  assert.equal((await run(root, file)).code, 0);
  const cat = read(root, 'public/kx/catalog.json');
  assert.equal(cat.starter, true);
  for (const d of tiny().dimensions) for (const v of d.values) assert.ok(cat.pieces.some((p) => (p.tags[d.key] || []).includes(v)), `${d.key}=${v} is named`);
  assert.deepEqual(cat.pieces.find((p) => p.customerContentId === 'hero-1').tags.category.slice(0, 1), ['b']);
  assert.deepEqual(cat.pieces.find((p) => p.customerContentId === 'deals-1').tags.category.slice(0, 1), ['b']);
  for (const p of cat.pieces.filter((x) => x.slotTypes.includes('back'))) assert.deepEqual(p.eligibleWhen, { context: { visit: ['return'] } });
  const vocab = read(root, 'scripts/demo-kit/configs/kx.json').seed.vocabulary;
  assert.deepEqual(vocab, { category: ['a', 'b', 'c'], style: ['x', 'y'], intent: ['buy', 'browse'] });
  const reflex = read(root, 'scripts/demo-kit/configs/kx/reflex.json');
  assert.deepEqual(reflex.dimensions, [{ key: 'category', source: 'category' }, { key: 'style', source: 'style', tauMs: 60000 }, { key: 'intent', source: 'intent', multi: true, tauMs: 600000 }]);
  const learn = read(root, 'scripts/demo-kit/configs/kx/learn.json');
  assert.deepEqual(Object.keys(learn.slots), ['hero', 'deals', 'back', 'modules']);
  assert.ok(Object.values(learn.slots).every((s) => s.gamma === 0 && s.exploration.mode === 'off'));
});

test('a second run writes nothing: what exists is left byte for byte; --leave leaves an absent file absent; --rebuild-beats rewrites only the beat documents and the kit config', async () => {
  const { root, file } = scratch();
  assert.equal((await run(root, file, ['--leave', 'img/MANIFEST.json'])).code, 0);
  assert.equal(existsSync(join(root, 'public', 'kx', 'img', 'MANIFEST.json')), false, '--leave leaves it to its lane');
  writeFileSync(join(root, 'public', 'kx', 'index.html'), 'edited by a page lane');
  writeFileSync(join(root, 'public', 'kx', 'beats', '05-later.json'), '{"edited":true}');
  const again = await run(root, file, ['--leave', 'img/MANIFEST.json']);
  assert.equal(again.code, 0);
  assert.match(again.out, /✓ wrote 0 file\(s\); left \d+ that exist and 1 for another lane/);
  assert.equal(readFileSync(join(root, 'public', 'kx', 'index.html'), 'utf8'), 'edited by a page lane');
  assert.equal(readFileSync(join(root, 'public', 'kx', 'beats', '05-later.json'), 'utf8'), '{"edited":true}');
  const rebuilt = await run(root, file, ['--rebuild-beats']);
  assert.equal(rebuilt.code, 0);
  assert.match(rebuilt.out, /~ public\/kx\/beats\/05-later\.json {2}\(rewritten \(--rebuild-beats\)\)/);
  assert.equal(read(root, 'public/kx/beats/05-later.json').name, '05-later');
  assert.equal(readFileSync(join(root, 'public', 'kx', 'index.html'), 'utf8'), 'edited by a page lane', 'a page file is never rebuilt');
  assert.match(rebuilt.out, /\+ public\/kx\/img\/MANIFEST\.json/, 'without --leave, the absent manifest is written');
});

test('a slug, worker, queue, tenant or dev port another demo holds is refused, and nothing is written', async () => {
  for (const [rel, text] of [
    ['wrangler.other.toml', 'name = "edge-platform-other"\n[[queues.producers]]\nqueue = "events-kx"\n'],
    ['wrangler.other.toml', 'name = "edge-platform-kx"\n'],
    ['wrangler.other.toml', 'name = "edge-platform-other"\n\n[dev]\nport = 9199\n'],
    ['scripts/demo-kit/configs/other.json', JSON.stringify({ slug: 'other', tenant: 'kx', worker: { name: 'edge-platform-other', queue: 'events-other', devPort: 9001 } })],
    ['scripts/demo-kit/configs/other.json', JSON.stringify({ slug: 'other', tenant: 'other', worker: { name: 'edge-platform-other', queue: 'events-other', devPort: 9199 } })],
  ]) {
    const { root, file } = scratch();
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
    const { code, out } = await run(root, file);
    assert.equal(code, 2, `${rel}: ${out}`);
    assert.match(out, /collides with a demo the repository already holds; nothing written/);
    assert.equal(existsSync(join(root, 'public', 'kx', 'index.html')), false, `${rel}: nothing written`);
  }
});

test('an invalid demo config, or one outside public/<slug>/, stops before anything is written', async () => {
  const bad = tiny();
  bad.worker.queue = 'events';
  const one = scratch(bad);
  const r1 = await run(one.root, one.file);
  assert.equal(r1.code, 2);
  assert.match(r1.out, /worker\.queue: "events" must be "events-kx"/);
  const two = scratch();
  const elsewhere = join(two.root, 'kx.demo.json');
  writeFileSync(elsewhere, JSON.stringify(tiny()));
  const r2 = await run(two.root, elsewhere);
  assert.equal(r2.code, 2);
  assert.match(r2.out, /a demo's config lives at public\/kx\/demo\.config\.json/);
  assert.equal(existsSync(join(two.root, 'public', 'kx', 'index.html')), false);
});

test('every shell carries the kit\'s markup contract by id, loads the kit in order, and boots into its own view', async () => {
  const { root, file } = scratch();
  assert.equal((await run(root, file)).code, 0);
  const ids = ['site', 'machine', 'beatNo', 'engineLine', 'nextBeat', 'nextLabel', 'explainBtn', 'directorHandle', 'presses', 'status', 'assertRegion', 'assertIntent',
    'compareTools', 'whoChip', 'armChip', 'ctxChips', 'vectors', 'priorLine', 'coldStart', 'journey', 'whyBody', 'reportBody', 'buildReport', 'roadmap', 'captureBtn',
    'compareBtn', 'captureNote', 'sheetBack', 'sheetBody', 'sheetClose', 'pdBack', 'pdMode', 'pdDone', 'pdAct', 'pdArith', 'pdArithK', 'pdWill', 'pdNow', 'pdNowK',
    'pdWhyWrap', 'pdWhy', 'pdWhyHead', 'pdMapNow', 'pdMapAfter', 'pdGo', 'pdPill', 'pdNote', 'demo-cursor', 'fixtureFlag', 'wordmark'];
  for (const [shell, entry] of [['index.html', 'home'], ['product.html', 'product'], ['m.html', 'phone']]) {
    const html = readFileSync(join(root, 'public', 'kx', shell), 'utf8');
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${shell} carries #${id}`);
    assert.match(html, new RegExp(`<body data-entry="${entry}"`));
    const order = ['/demo-kit/tokens.css', '/demo-kit/kit.css', '/kx/kx.css', '/demo-kit/compare.css'].map((h) => html.indexOf(`href="${h}"`));
    assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `${shell}: tokens, kit, the demo's sheet, compare`);
    assert.ok(html.includes('id="slot-hero"') && html.includes('id="slot-modules"') && html.includes('id="rail-rail"'), `${shell}: every decided slot and rail`);
    assert.match(html, /id="mod-back" data-slot="back" data-gated="true" hidden/, `${shell}: a gated slot starts off the page`);
    assert.doesNotMatch(html, /@@/, `${shell}: no template name left unfilled`);
  }
  const css = readFileSync(join(root, 'public', 'kx', 'kx.css'), 'utf8');
  assert.match(css, /--brand: #123456;/);
  assert.match(css, /--brand-glow: rgba\(18,52,86,\.7\);/, 'the brand\'s tints derived with it (html2canvas reads no color-mix)');
  const js = readFileSync(join(root, 'public', 'kx', 'kx.js'), 'utf8');
  assert.match(js, /import \{ createDemo, util \} from '\/demo-kit\/kit\.js';/);
  assert.match(js, /debugName: '__kx'/);
  assert.doesNotMatch(js, /@@/);
});

test('the templates refuse a name they have no value for; a slug\'s names; the mount lines', () => {
  assert.throws(() => fill('a @@MISSING@@ b', {}, 'x.tpl'), /x\.tpl: @@MISSING@@ has no value/);
  assert.equal(fill('@@A@@-@@A@@', { A: 'z' }), 'z-z');
  assert.deepEqual(idents('top-offers'), { camel: 'topOffers', pascal: 'TopOffers', constant: 'TOP_OFFERS' });
  assert.deepEqual(idents('oh'), { camel: 'oh', pascal: 'Oh', constant: 'OH' });
  const m = mountLines(tiny());
  assert.equal(m.mounts[1], "app.route('/kx/api/coldstart', kxColdStartRoutes);");
  assert.deepEqual(builderArgs(tiny()), ['scripts/build-demo-worker-config.mjs', '--name', 'edge-platform-kx', '--queue', 'events-kx', '--dev-port', '9199']);
});

test('the kit config a scaffold writes is valid, and a section another lane has not written yet does not stop the seed', async () => {
  const { root, file } = scratch();
  assert.equal((await run(root, file)).code, 0);
  const configFile = join(root, 'scripts', 'demo-kit', 'configs', 'kx.json');
  const lazy = loadConfig(configFile, { root, sections: ['seed', 'check'] });
  assert.deepEqual(lazy.pending, { region: 'scripts/demo-kit/configs/kx/region.json', imagery: 'scripts/demo-kit/configs/kx/imagery.json' });
  assert.deepEqual(validateConfig(lazy.config, { root, sections: ['seed', 'check'] }), { ok: true, errors: [] });
  assert.deepEqual(lazy.config.check.suites.map((s) => [s.kind, s.script]), [['page', 'scripts/rehearse-kx-page.mjs'], ['dom', 'scripts/rehearse-kx-dom.mjs']]);
  assert.throws(() => loadConfig(configFile, { root, sections: ['region'] }), /section "region" names scripts\/demo-kit\/configs\/kx\/region\.json/, 'a section the caller needs must exist');
  assert.throws(() => loadConfig(configFile, { root }), /section "region"/, 'and without sections, every section is needed, as before');
});

test('OH\'s scaffold in this repository seeds clean, and its server, kit config and worker config agree', () => {
  const loaded = loadValidConfig(join(REPO_ROOT, 'scripts', 'demo-kit', 'configs', 'oh.json'), { sections: ['seed', 'check'], exit: (c) => { throw new Error(`the OH kit config is invalid (${c})`); } });
  const p = prepareSeed({ config: loaded.config, path: loaded.path, nowMs: Date.now() });
  assert.deepEqual(p.errors, []);
  assert.equal(loaded.config.seed.beats.count, 16);
  const server = readFileSync(join(REPO_ROOT, 'src', 'demos', 'oh.config.ts'), 'utf8');
  const listed = Object.fromEntries([...server.matchAll(/^ {2}'([^']+)': '(catalog|slots)',$/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(listed, loaded.config.seed.beats.publishable);
  const toml = readFileSync(join(REPO_ROOT, 'wrangler.oh.toml'), 'utf8');
  assert.match(toml, /^# Regenerate: node scripts\/build-demo-worker-config\.mjs --name edge-platform-oh --queue events-oh --dev-port 9120$/m);
  assert.match(toml, /^name = "edge-platform-oh"$/m);
  const plan = planScaffold({ demo: JSON.parse(readFileSync(join(REPO_ROOT, 'public', 'oh', 'demo.config.json'), 'utf8')) });
  assert.equal(plan.files.find((f) => f.path === 'src/demos/oh.config.ts').content.split('\n').filter((l) => /^ {2}'/.test(l)).join('\n'),
    server.split('\n').filter((l) => /^ {2}'/.test(l)).join('\n'), 'a rerun plans the same closed list');
});

test('a demo\'s own catalog: the opening document carries the engine\'s fields only, against the catalog\'s own anchor, with a slot\'s gate on its ungated pieces', async () => {
  const { root, file } = scratch();
  mkdirSync(join(root, 'src', 'content'), { recursive: true });
  cpSync(join(REPO_ROOT, 'src', 'content', 'kinds.ts'), join(root, 'src', 'content', 'kinds.ts'));
  const own = { anchor: '2026-10-01T12:00:00.000Z', pieces: [
    { id: 'hero_a', customerContentId: 'hero-a', type: 'hero', title: 'A', tags: { category: ['a'], style: ['x'], intent: ['buy'] }, slotTypes: ['hero'], lifecycle: { status: 'live' },
      window: { from: '2026-09-20T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' }, display: { cta: 'Shop' } },
    { id: 'deal_b', customerContentId: 'deal-b', type: 'promotion', title: 'B', tags: { category: ['b', 'c'], style: ['y'], intent: ['browse'] }, slotTypes: ['deals', 'modules'], lifecycle: { status: 'live' }, display: { order: 1 } },
    { id: 'back_c', customerContentId: 'back-c', type: 'hero', title: 'C', tags: { style: ['x'] }, slotTypes: ['back'], lifecycle: { status: 'live' } },
  ] };
  writeFileSync(join(root, 'public', 'kx', 'catalog.json'), JSON.stringify(own));
  const { code, out } = await run(root, file);
  assert.equal(code, 0, out);
  assert.match(out, /the opening catalog is cut from public\/kx\/catalog\.json \(3 pieces, its windows against its own anchor 2026-10-01T12:00:00\.000Z, which the anchor file carries\), the engine's fields only \(display stay in the file, for the page\)/);
  assert.match(out, /gated on the slot's own rule until the page asserts it: back-c/);
  const open = read(root, 'public/kx/beats/open-catalog.json').publish.document.pieces;
  assert.ok(open.every((p) => !('display' in p)), 'no page field reaches the engine');
  assert.deepEqual(open[0].window, own.pieces[0].window, 'the windows as the catalog wrote them');
  assert.deepEqual(open[2].eligibleWhen, { context: { visit: ['return'] } });
  assert.equal(read(root, 'public/kx/beats/anchor.json').anchor, '2026-10-01T12:00:00.000Z');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'public', 'kx', 'catalog.json'), 'utf8')), own, 'the catalog itself is the data lane\'s, untouched');
  assert.equal(existsSync(join(root, 'public', 'kx', 'beats', '03-close.json')), true);
  const loaded = loadValidConfig(join(root, 'scripts', 'demo-kit', 'configs', 'kx.json'), { root, sections: ['seed'], exit: (c) => { throw new Error(`invalid ${c}`); } });
  assert.deepEqual(prepareSeed({ config: loaded.config, path: loaded.path, nowMs: Date.now() }).errors, []);
});
