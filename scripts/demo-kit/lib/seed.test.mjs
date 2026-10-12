// node --test scripts/demo-kit/lib/seed.test.mjs
// The seed library: windows re-anchored to now, the beat envelope, the local checks and the publish's
// preconditions, proven on Vantage's own beat documents (read, never written; a mutated copy lives in a
// temporary directory) and on synthetic ones.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidConfig, REPO_ROOT } from './config.mjs';
import {
  DAY, MINUTE, actOfFrom, anchorCopyProblems, beatOrderProblems, bootstrapScope, catalogPieces, deepDiff, envelope, envelopeProblems, fillNote, iso,
  jsonText, loneTimestamps, prepareSeed, publishOpening, readBeats, reanchorBeats, reanchorEnvelope, relativeTimestamps, renderUrlProblems,
  seedRuleProblems, shifted, versionedPut, vocabularyProblems, windowAt,
} from './seed.mjs';

const configFile = fileURLToPath(new URL('../configs/vantage.json', import.meta.url));
const vantage = loadValidConfig(configFile, { sections: ['seed'], exit: (code) => { throw new Error(`the Vantage config is invalid (${code})`); } });
const seed = vantage.config.seed;
const beatsDir = vantage.path(seed.beats.dir);
const onDisk = readBeats(beatsDir, seed.beats.files, seed.beats.anchor.file);
const oldAnchor = Date.parse(onDisk.anchorDoc.anchor);
const T = Date.UTC(2027, 0, 15, 9, 30, 12, 345);

test('windowAt is days either side of the anchor; time passing moves every window back by one amount', () => {
  const a = Date.UTC(2026, 8, 30, 12);
  assert.deepEqual(windowAt(a, [-18, 31]), { from: '2026-09-12T12:00:00.000Z', to: '2026-10-31T12:00:00.000Z' });
  const pieces = [{ id: 'a', window: windowAt(a, [-2, 1]) }, { id: 'b' }];
  const later = shifted(pieces, 14 * DAY);
  assert.deepEqual(later[0].window, windowAt(a - 14 * DAY, [-2, 1]));
  assert.equal(later[1], pieces[1], 'a piece without a window is the same object');
});

test('re-anchoring slides every window of Vantage\'s catalogs by the anchor delta, keeping each window\'s offset to its anchor', () => {
  const { envelopes, anchorDoc, deltaMs } = reanchorBeats({ envelopes: onDisk.envelopes, anchorDoc: onDisk.anchorDoc, anchorField: 'anchor', toMs: T });
  assert.equal(deltaMs, T - oldAnchor);
  assert.equal(anchorDoc.anchor, iso(T));
  assert.deepEqual(Object.keys(anchorDoc), Object.keys(onDisk.anchorDoc), 'the anchor file keeps its key order');
  let windows = 0;
  for (const name of ['open-catalog', '11-two-weeks-pass', '12-black-friday']) {
    const before = onDisk.envelopes[name].publish.document.pieces, after = envelopes[name].publish.document.pieces;
    assert.equal(after.length, before.length);
    before.forEach((p, i) => {
      assert.deepEqual(Object.keys(after[i]), Object.keys(p), `${name} ${p.id}: key order kept`);
      for (const edge of ['from', 'to']) {
        assert.equal(Date.parse(after[i].window[edge]) - T, Date.parse(p.window[edge]) - oldAnchor, `${name} ${p.id} window.${edge}`);
        windows += 1;
      }
    });
  }
  assert.ok(windows > 100, `${windows} window edges checked`);
  for (const name of ['01-arrival', 'open-slots', '13-pin-duo-preorder']) assert.equal(envelopes[name], onDisk.envelopes[name], `${name} carries no window and is returned as it is`);
});

test('a document seeded at one anchor and re-anchored to another equals the document seeded there', () => {
  const a0 = Date.UTC(2026, 9, 1, 14, 34, 44, 845), a1 = Date.UTC(2026, 9, 2, 6, 1, 2, 3);
  const make = (a) => ({ name: 'x', kind: 'publish', publish: { kind: 'catalog', document: { version: 'v', pieces: [
    { id: 'p', window: windowAt(a, [-18, 31]) },
    { id: 'flash', window: windowAt(a, [-2, 1]) },
    { id: 'new', window: { from: iso(a - 2 * MINUTE), to: iso(a + 28 * DAY) } },
    { id: 'always' },
  ] } } });
  assert.deepEqual(reanchorEnvelope(make(a0), a0, a1), make(a1));
  const twice = reanchorEnvelope(reanchorEnvelope(make(a0), a0, T), T, a1);
  assert.deepEqual(twice, make(a1), 'two moves equal one');
});

test('a bad anchor or a window that is not two instants is refused before anything moves', () => {
  assert.throws(() => reanchorBeats({ envelopes: {}, anchorDoc: { anchor: 'yesterday' }, anchorField: 'anchor', toMs: T }), /not an ISO instant/);
  const bad = { name: 'x', kind: 'publish', publish: { kind: 'catalog', document: { pieces: [{ id: 'p', window: { from: '2026-10-01', to: 'soon' } }] } } };
  assert.throws(() => reanchorEnvelope(bad, 0, 1), /not two ISO instants/);
});

test('relativeTimestamps writes every instant against its anchor, inside sentences too; loneTimestamps finds what a reseed would not move', () => {
  const a = Date.UTC(2026, 9, 1);
  assert.deepEqual(relativeTimestamps({ w: { from: '2026-10-01T00:00:01.000Z' }, note: 'windows anchored 2026-09-30T23:59:59.000Z' }, a),
    { w: { from: '@anchor+1000ms' }, note: 'windows anchored @anchor-1000ms' });
  const doc = { publish: { document: { pieces: [{ window: { from: iso(a), to: iso(a) } }], stamped: iso(a) } } };
  assert.deepEqual(loneTimestamps(doc, { path: 'x' }), ['x.publish.document.stamped']);
  for (const [name, e] of Object.entries(onDisk.envelopes)) assert.deepEqual(loneTimestamps(e, { path: name }), [], `${name} carries no instant outside a window`);
  assert.deepEqual(loneTimestamps(onDisk.anchorDoc, { path: 'anchor.json', skip: ['anchor.json.anchor'] }), []);
});

test('envelope() rebuilds every one of Vantage\'s seventeen beat documents exactly, key order included', () => {
  const actOf = actOfFrom(onDisk.anchorDoc.acts);
  for (const [name, file] of Object.entries(onDisk.envelopes)) {
    const { name: _n, beat, act: _a, actName: _an, press, kind, publish, engine, sees, ...rest } = file;
    const def = { beat, press, ...(kind === 'publish' ? { kind: publish.kind, document: publish.document } : {}), ...rest, ...(engine ? { engine } : {}), ...(sees ? { sees } : {}) };
    const built = envelope(name, def, actOf);
    assert.equal(JSON.stringify(built), JSON.stringify(file), name);
  }
  assert.throws(() => actOfFrom([{ n: 1, through: 2, name: 'one' }])(3), /after the last act/);
});

test('envelopeProblems passes Vantage\'s documents and names each malformed shape', () => {
  for (const [name, e] of Object.entries(onDisk.envelopes)) assert.deepEqual(envelopeProblems(name, e), [], name);
  const ok = { name: 'b', beat: 2, act: 1, actName: 'A', press: 'Press', kind: 'context' };
  assert.deepEqual(envelopeProblems('b', ok), []);
  assert.match(envelopeProblems('b', { ...ok, name: 'c' })[0], /name field/);
  assert.match(envelopeProblems('b', { ...ok, kind: 'publish' }).join(), /publish: \{ kind/);
  assert.match(envelopeProblems('b', { ...ok, publish: { kind: 'catalog', document: {} } }).join(), /context beat publishes nothing/);
  assert.match(envelopeProblems('b', { ...ok, beat: -1 }).join(), /whole number/);
  assert.match(envelopeProblems('b', { ...ok, beat: 0, act: 0 }).join(), /reset document/);
  assert.match(envelopeProblems('b', { ...ok, kind: 'other' }).join(), /publish or context/);
  assert.match(envelopeProblems('b', null).join(), /not a JSON object/);
});

test('the numbered beats are exactly 1..N', () => {
  assert.deepEqual(beatOrderProblems(onDisk.envelopes, 15), []);
  assert.match(beatOrderProblems(onDisk.envelopes, 16)[0], /exactly 1\.\.16/);
  assert.match(beatOrderProblems({ a: { beat: 1 }, b: { beat: 3 } }, 2)[0], /found 1, 3/);
  assert.match(beatOrderProblems({ a: { beat: 1 }, b: { beat: 1 } }, 2)[0], /found 1, 1/);
});

test('the vocabulary checks pass Vantage\'s documents and fail each way a document can drift', () => {
  const reflex = JSON.parse(readFileSync(vantage.path(seed.documents.reflex.file), 'utf8'));
  const learn = JSON.parse(readFileSync(vantage.path(seed.documents.learn.file), 'utf8'));
  const pieces = catalogPieces(onDisk.envelopes);
  assert.equal(pieces.length, 33, 'the opening 32 pieces and Black Friday');
  const base = { pieces, vocabulary: seed.vocabulary, registryKeys: reflex.dimensions.map((d) => d.key), regionalDimensions: learn.regional.dimensions, seedOnly: seed.seedOnlyDimensions };
  assert.deepEqual(vocabularyProblems(base), []);
  const tagged = (tags) => [...pieces, { id: 'x', customerContentId: 'x', tags }];
  assert.match(vocabularyProblems({ ...base, pieces: tagged({ colour: ['red'] }) }).join(), /"colour" is not in the registry/);
  assert.match(vocabularyProblems({ ...base, pieces: tagged({ brand: ['nokia'] }) }).join(), /brand=nokia is not in the vocabulary/);
  assert.match(vocabularyProblems({ ...base, vocabulary: { ...seed.vocabulary, brand: [...seed.vocabulary.brand, 'nokia'] } }).join(), /no piece names brand=nokia/);
  assert.match(vocabularyProblems({ ...base, registryKeys: [...base.registryKeys].reverse() }).join(), /registry and vocabulary disagree/);
  assert.match(vocabularyProblems({ ...base, regionalDimensions: ['brand', 'pricebands'] }).join(), /names pricebands, not a registry dimension/);
  assert.match(vocabularyProblems({ ...base, seedOnly: [] }).join(), /"campaign" is not in the registry/, 'campaign is weighted but seed-only');
});

test('the arrival seeds: a tag the slot does not weight is an error, a tag no piece of the slot carries is a warning', () => {
  const pieces = catalogPieces(onDisk.envelopes);
  const slotsDocument = onDisk.envelopes['open-slots'].publish.document;
  assert.deepEqual(seedRuleProblems({ slotsDocument, pieces }), { errors: [], warnings: [] });
  const doc = { pages: { home: [{ slot: 'deals', weights: { brand: 1 }, seeds: [{ tags: [{ dimension: 'lines', value: 'duo' }, { dimension: 'brand', value: 'nokia' }] }] }] } };
  const found = seedRuleProblems({ slotsDocument: doc, pieces });
  assert.match(found.errors.join(), /'lines' is not a dimension the deals slot weights/);
  assert.match(found.warnings.join(), /no deals piece carries brand=nokia/);
});

test('prepareSeed on the Vantage config: no problem, the four documents, notes filled from the opening catalog', () => {
  const p = prepareSeed({ config: vantage.config, path: vantage.path, nowMs: T });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(Object.keys(p.documents), ['reflex', 'catalog', 'slots', 'learn']);
  assert.equal(p.documents.catalog, p.envelopes['open-catalog'].publish.document);
  assert.equal(p.documents.slots, p.envelopes['open-slots'].publish.document);
  assert.deepEqual(p.counts, { promotion: 17, hero: 4, module: 7, plan: 4 });
  assert.deepEqual(p.added, { promotion: 1 });
  assert.equal(p.notes.catalog, `Vantage opening catalog: 17 promotions, heroes, modules, plans; windows anchored ${iso(T)}`);
  assert.equal(fillNote('{{count.plan}} plans, {{count.none}}', { anchorIso: '', counts: { plan: 4 } }), '4 plans, 0');
  assert.equal(fillNote(undefined, { anchorIso: '', counts: {} }), undefined);
});

test('prepareSeed refuses a closed list that names a context beat, and a document named by the wrong beat', () => {
  const broken = structuredClone(vantage.config);
  broken.seed.beats.publishable['01-arrival'] = 'catalog';
  assert.match(prepareSeed({ config: broken, path: vantage.path, nowMs: T }).errors.join(), /01-arrival: on the closed list, but its document publishes nothing/);
  const wrongKind = structuredClone(vantage.config);
  wrongKind.seed.beats.publishable['13-pin-duo-preorder'] = 'catalog';
  assert.match(prepareSeed({ config: wrongKind, path: vantage.path, nowMs: T }).errors.join(), /listed as catalog, but it publishes slots/);
  const unlisted = structuredClone(vantage.config);
  delete unlisted.seed.beats.publishable['12-black-friday'];
  assert.match(prepareSeed({ config: unlisted, path: vantage.path, nowMs: T }).warnings.join(), /12-black-friday: a publish the route's closed list does not name/);
});

/** A stand-in for the configuration API: answers like the worker and records every request. */
function fakeApi({ initialized = false, refuse = null } = {}) {
  const calls = [];
  const rev = {};
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method ?? 'GET', path: u.pathname, scope: u.searchParams.get('scope'), headers: init.headers, body });
    const json = (status, value) => ({ ok: status < 400, status, json: async () => value });
    if (u.pathname === '/ops/demo-bootstrap') {
      if (refuse) return json(refuse.status, refuse.body);
      if (initialized) return json(409, { ok: false, code: 'already_initialized' });
      initialized = true;
      return json(200, { ok: true });
    }
    if ((init.method ?? 'GET') === 'GET') return json(200, { revision: rev[u.pathname] ?? 3, publication: { revision: 7, digest: 'abc' } });
    rev[u.pathname] = (rev[u.pathname] ?? 3) + 1;
    return json(200, { ok: true, revision: rev[u.pathname], version: (body.config ?? body.document).version });
  };
  return { calls, fetchImpl };
}

test('versionedPut reads first, then writes against exactly what it read', async () => {
  const api = fakeApi();
  const r = await versionedPut({ base: 'http://w', scope: 'demo', headers: { 'X-Tenant': 'demo' }, path: '/config/reflex', document: { version: 'r1' }, note: 'n', fetchImpl: api.fetchImpl });
  assert.equal(r.ok, true);
  const [get, put] = api.calls;
  assert.deepEqual([get.method, get.path, get.scope], ['GET', '/config/reflex', 'demo']);
  assert.equal(put.headers['If-Match'], '"3/7/abc"');
  assert.match(put.headers['Idempotency-Key'], /^3:[0-9a-f-]{36}$/);
  assert.deepEqual(put.body, { config: { version: 'r1' }, note: 'n' }, 'a /config/ document travels as config');
  await versionedPut({ base: 'http://w', scope: 'demo', headers: {}, path: '/content/slots', document: { version: 's1' }, note: 'n', fetchImpl: api.fetchImpl });
  assert.deepEqual(api.calls.at(-1).body, { document: { version: 's1' }, note: 'n' }, 'a /content/ document travels as document');
  const unread = await versionedPut({ base: 'http://w', scope: 'demo', headers: {}, path: '/content/learn', document: {}, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'down' }) }) });
  assert.deepEqual(unread, { status: 503, ok: false, error: 'down' });
});

test('the bootstrap creates once, falls through when the scope exists, and stops the publish when refused', async () => {
  const documents = { reflex: { version: 'r' }, catalog: { version: 'c', pieces: [] }, slots: { version: 's' }, learn: { version: 'l' } };
  const fresh = fakeApi();
  const lines = [];
  const first = await publishOpening({ base: 'http://w', scope: 'demo', token: 'not-a-credential', documents, notes: { catalog: 'c' }, log: (l) => lines.push(l), fetchImpl: fresh.fetchImpl });
  assert.equal(first.ok, true);
  assert.equal(first.bootstrap, 'created');
  assert.deepEqual(fresh.calls[0].body, documents, 'the bootstrap carries the four documents in one intent');
  assert.deepEqual(Object.keys(fresh.calls[0].body), ['reflex', 'catalog', 'slots', 'learn']);
  assert.deepEqual(fresh.calls.slice(1).map((c) => `${c.method} ${c.path}`), ['GET /config/reflex', 'PUT /config/reflex', 'GET /content/catalog', 'PUT /content/catalog',
    'GET /content/slots', 'PUT /content/slots', 'GET /content/learn', 'PUT /content/learn']);
  assert.equal(fresh.calls[0].headers.Authorization, 'Bearer not-a-credential');
  assert.equal(fresh.calls[0].headers['X-Tenant'], 'demo');
  assert.equal(lines[0], 'bootstrap: created the publication set for "demo"');
  assert.equal(lines[1], 'reflex: {"ok":true,"status":200,"revision":4,"version":"r"}');
  const again = await publishOpening({ base: 'http://w', scope: 'demo', token: 't', documents, log: () => {}, fetchImpl: fakeApi({ initialized: true }).fetchImpl });
  assert.deepEqual([again.ok, again.bootstrap], [true, 'already_initialized']);
  const refused = fakeApi({ refuse: { status: 422, body: { ok: false, error: 'Invalid baseline configuration' } } });
  const out = await publishOpening({ base: 'http://w', scope: 'demo', token: 't', documents, log: () => {}, fetchImpl: refused.fetchImpl });
  assert.deepEqual([out.ok, out.bootstrap], [false, 'failed']);
  assert.equal(refused.calls.length, 1, 'nothing is written after a refused bootstrap');
  const direct = await bootstrapScope({ base: 'http://w', scope: 'demo', headers: {}, documents, fetchImpl: fakeApi({ initialized: true }).fetchImpl });
  assert.equal(direct.outcome, 'already_initialized');
});

test('deepDiff names every difference by path and ignores key order', () => {
  assert.deepEqual(deepDiff({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), []);
  assert.deepEqual(deepDiff({ a: 1, b: [1, 2] }, { a: 2, b: [1], c: 0 }).map((d) => d.path), ['$.a', '$.b.length', '$.c']);
  assert.deepEqual(deepDiff(null, {}).map((d) => d.path), ['$']);
});

test('the anchor file\'s copies agree with what the seed publishes, and each disagreement is refused by name', () => {
  const p = prepareSeed({ config: vantage.config, path: vantage.path, nowMs: T });
  const base = { anchorDoc: p.anchorDoc, anchorFile: 'anchor.json', documents: p.documents, seed };
  assert.deepEqual(anchorCopyProblems(base), [], 'Vantage\'s anchor file agrees with its registry, learn document, reset and closed list');
  const mutated = (fn) => { const a = structuredClone(p.anchorDoc); fn(a); return anchorCopyProblems({ ...base, anchorDoc: a }).join('\n'); };
  assert.match(mutated((a) => { a.registry.K = 2; }), /anchor\.json: registry\.K differs from the registry the seed publishes/);
  assert.match(mutated((a) => { a.registry.weights.compare = 3; }), /registry\.weights differs/);
  assert.match(mutated((a) => { a.registry.vocabulary.brand.push('nokia'); }), /registry\.vocabulary differs from the config's seed\.vocabulary/);
  assert.match(mutated((a) => { a.registry.memory.dimensions.find((d) => d.key === 'brand').tauMs = 120_000; }),
    /registry\.memory says brand remembers for 120000 ms; the registry the seed publishes says 60000 ms/);
  assert.match(mutated((a) => { a.learn.holdout.share = 0.05; }), /learn\.holdout differs from the learn document the seed publishes/);
  assert.match(mutated((a) => { a.learn.regional.kBlend = 1; }), /learn\.regional differs/);
  assert.match(mutated((a) => { a.learn.gamma = 0.5; }), /learn\.gamma says 0\.5; the learn document the seed publishes gives hero, deals, pdp-modules, plan-pairing another γ/);
  assert.match(mutated((a) => { a.reset = ['open-catalog', 'open-slots']; }), /reset is open-catalog, open-slots; the config's seed\.beats\.reset is open-slots, open-catalog/);
  assert.match(mutated((a) => { a.beats.pinDuo = { catalog: '13-pin-duo-preorder' }; }), /beats names 13-pin-duo-preorder as a catalog publish; the closed list says slots/);
  assert.match(mutated((a) => { a.beats.encore = { catalog: '16-encore' }; }), /beats names 16-encore as a catalog publish; the closed list does not name it/);
  assert.match(mutated((a) => { delete a.beats.blackFriday; }), /beats gives the page no role for 12-black-friday, which the closed list publishes/);
  const edited = { ...p.documents, reflex: { ...p.documents.reflex, thetaIn: 0.65 } };
  assert.match(anchorCopyProblems({ ...base, documents: edited }).join(), /registry\.thetaIn differs/, 'a registry edited without the page\'s copy is caught too');
  assert.deepEqual(anchorCopyProblems({ ...base, anchorDoc: { anchor: p.anchorDoc.anchor } }), [], 'only the copies an anchor file carries are compared');
});

test('every piece\'s art is a file the worker serves; a renderUrl naming none is a warning, not a broken tag', () => {
  const pieces = catalogPieces(onDisk.envelopes);
  assert.deepEqual(renderUrlProblems(pieces, () => true), []);
  const extra = { id: 'promo_x', customerContentId: 'promo-x', renderUrl: '/vantage/img/promos/promo-x.jpg' };
  assert.deepEqual(renderUrlProblems([...pieces, extra, { id: 'no_art' }], (url) => url !== extra.renderUrl),
    ['promo-x: renderUrl /vantage/img/promos/promo-x.jpg is not a file under public/, so its card would paint a broken image'], 'a piece with no renderUrl paints the placeholder and is fine');
});

/** prepareSeed over a copy of Vantage's beat documents in a temporary directory, after `mutate(files)` edits the copy. */
function preparedFromCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'demo-kit-beats-'));
  const files = { ...structuredClone(onDisk.envelopes), [seed.beats.anchor.file.replace(/\.json$/, '')]: structuredClone(onDisk.anchorDoc) };
  mutate(files);
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), jsonText(value));
  return prepareSeed({ config: vantage.config, path: (rel) => (rel === seed.beats.dir ? dir : vantage.path(rel)), nowMs: T });
}

test('prepareSeed holds the edited data to its copies: a desynced anchor file stops the seed before anything is written', () => {
  assert.deepEqual(preparedFromCopy(() => {}).errors, [], 'an unedited copy prepares cleanly');
  const desynced = preparedFromCopy((f) => { f.anchor.registry.thetaOut = 0.5; });
  assert.deepEqual(desynced.errors, ['anchor.json: registry.thetaOut differs from the registry the seed publishes'], 'an error, so the command line writes nothing and sends nothing');
  const missingArt = preparedFromCopy((f) => { f['open-catalog'].publish.document.pieces[0].renderUrl = '/vantage/img/promos/no-such-tile.jpg'; });
  assert.deepEqual(missingArt.errors, []);
  assert.match(missingArt.warnings.join(), /promo-iphone-18-pro-launch: renderUrl \/vantage\/img\/promos\/no-such-tile\.jpg is not a file under public\//);
  const unindexed = preparedFromCopy((f) => { f.anchor.beatIndex = f.anchor.beatIndex.filter((b) => b.name !== '07-compare-storage'); });
  assert.match(unindexed.warnings.join(), /anchor\.json: beatIndex leaves out 07-compare-storage, beat 7/);
});

test('the seed never needed a file outside the config: every document path resolves inside the repository', () => {
  for (const d of Object.values(seed.documents)) if (d.file) assert.ok(vantage.path(d.file).startsWith(REPO_ROOT));
  assert.equal(beatsDir, join(REPO_ROOT, 'public', 'vantage', 'beats'));
});
