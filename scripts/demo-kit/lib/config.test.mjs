// node --test scripts/demo-kit/lib/config.test.mjs
// The demo config's validation: the Vantage config passes every section, and each rule refuses the mutation
// it exists for, naming the field. (Part a's guard that compared the config with what scripts/seed-vantage.mjs
// last wrote retired with the generator in part b; the anchor file's copies of the registry, the learn
// summary, the reset and the closed list are now checked on every seed, lib/seed.mjs anchorCopyProblems.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, configArg, isInside, loadConfig, loadValidConfig, REPO_ROOT, resolveInside, validateConfig } from './config.mjs';

const configFile = fileURLToPath(new URL('../configs/vantage.json', import.meta.url));
const { config } = loadConfig(configFile);
const errorsOf = (mutate, sections) => { const c = structuredClone(config); mutate(c); return validateConfig(c, { sections }).errors.join('\n'); };

test('the Vantage config is valid in every section, and its sections were read from their own files', () => {
  assert.deepEqual(validateConfig(config), { ok: true, errors: [] });
  const loaded = loadConfig(configFile);
  assert.equal(typeof loaded.config.region, 'object');
  assert.match(loaded.sources.region, /configs[\\/]vantage[\\/]region\.json$/);
  assert.match(loaded.sources.imagery, /configs[\\/]vantage[\\/]imagery\.json$/);
});

test('the common fields: name, slug, tenant, the public directory, and a worker that is never the shared one', () => {
  assert.match(errorsOf((c) => { c.slug = 'Vantage Demo'; }), /^slug:/m);
  assert.match(errorsOf((c) => { c.tenant = ''; }), /^tenant:/m);
  assert.match(errorsOf((c) => { delete c.name; }), /^name:/m);
  assert.match(errorsOf((c) => { c.publicDir = 'src/vantage'; }), /^publicDir: "public\/<slug>"/m);
  assert.match(errorsOf((c) => { c.publicDir = 'public/no-such-demo'; }), /publicDir: "public\/no-such-demo" does not exist/);
  assert.match(errorsOf((c) => { c.worker.name = 'edge-platform'; }), /SHARED demo worker/);
  assert.match(errorsOf((c) => { c.worker.queue = 'events'; }), /must not be the shared worker's queue/);
  assert.match(errorsOf((c) => { c.worker.devPort = 80; }), /worker\.devPort/);
});

test('paths stay inside the repository, and whatever a script writes stays inside the demo\'s public directory', () => {
  assert.equal(resolveInside(REPO_ROOT, '../outside'), null);
  assert.equal(resolveInside(REPO_ROOT, 'C:/Windows'), null);
  assert.equal(resolveInside(REPO_ROOT, '/etc/passwd'), null);
  assert.ok(isInside(join(REPO_ROOT, 'public', 'vantage', 'beats'), join(REPO_ROOT, 'public', 'vantage')));
  assert.match(errorsOf((c) => { c.seed.documents.reflex.file = '../reflex.json'; }), /seed\.documents\.reflex\.file: "\.\.\/reflex\.json" must be a path relative to the repository root, inside it/);
  assert.match(errorsOf((c) => { c.seed.beats.dir = 'public/top-offers/beats'; }), /seed\.beats\.dir: "public\/top-offers\/beats" must lie inside public\/vantage/);
  assert.match(errorsOf((c) => { c.imagery.dir = 'src'; }), /imagery\.dir: "src" must lie inside public\/vantage/);
  assert.match(errorsOf((c) => { c.imagery.manifest = 'docs/MANIFEST.json'; }), /imagery\.manifest: "docs\/MANIFEST\.json" must lie inside public\/vantage/);
  assert.match(errorsOf((c) => { c.check.suites[0].script = 'scripts/no-such-suite.mjs'; }), /does not exist/);
});

test('the beat lists are closed: publishable ⊆ files, reset ⊆ publishable, documents named by beats of their kind', () => {
  assert.match(errorsOf((c) => { c.seed.beats.publishable['99-extra'] = 'catalog'; }), /"99-extra" is not in seed\.beats\.files/);
  assert.match(errorsOf((c) => { c.seed.beats.publishable['open-catalog'] = 'pieces'; }), /kind must be catalog, slots or learn/);
  assert.match(errorsOf((c) => { c.seed.beats.reset = ['01-arrival']; }), /seed\.beats\.reset: "01-arrival" is not publishable/);
  assert.match(errorsOf((c) => { c.seed.beats.files.push('open-catalog'); }), /"open-catalog" is listed twice/);
  assert.match(errorsOf((c) => { c.seed.beats.files.push('16-encore'); }), /public\/vantage\/beats\/16-encore\.json does not exist/);
  assert.match(errorsOf((c) => { c.seed.beats.files.push('anchor'); }), /"anchor" is the anchor file, not a beat/);
  assert.match(errorsOf((c) => { c.seed.documents.catalog = { beat: 'open-slots' }; }), /"open-slots" publishes slots, not catalog/);
  assert.match(errorsOf((c) => { c.seed.documents.slots = 'open-slots'; }), /seed\.documents\.slots: \{ file/);
  assert.match(errorsOf((c) => { c.seed.beats.count = 0; }), /seed\.beats\.count/);
  assert.match(errorsOf((c) => { c.seed.beats.anchor = { file: 'anchor.json' }; }), /seed\.beats\.anchor/);
});

test('vocabularies are exact: no duplicate, no empty value, and a seed-only dimension is not a registry one', () => {
  assert.match(errorsOf((c) => { c.seed.vocabulary.brand.push('apple'); }), /seed\.vocabulary\.brand: "apple" is listed twice/);
  assert.match(errorsOf((c) => { c.seed.vocabulary.brand.push(''); }), /is not a value of 1\.\.64 characters/);
  assert.match(errorsOf((c) => { c.seed.vocabulary.colour = []; }), /seed\.vocabulary\.colour: a list of 1\.\.1000 values/);
  assert.match(errorsOf((c) => { c.seed.seedOnlyDimensions.push('brand'); }), /"brand" is a registry dimension/);
  assert.match(errorsOf((c) => { c.region.vocabulary.brand = ['apple', 'apple']; }), /region\.vocabulary\.brand: "apple" is listed twice/);
});

test('a config never carries a credential: a key that would hold one, or a value shaped like one', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzZWVkLXZhbnRhZ2UifQ', 'c2lnbmF0dXJlLW5vdC1yZWFs'].join('.');
  assert.match(errorsOf((c) => { c.seed.token = 'anything-at-all'; }), /seed\.token: a config never carries a credential/);
  assert.match(errorsOf((c) => { c.worker.jwtSecret = 'x'.repeat(40); }), /worker\.jwtSecret/);
  assert.match(errorsOf((c) => { c.seed.notes.catalog = `anchored ${jwt}`; }), /seed\.notes\.catalog: carries a JWT/);
  assert.match(errorsOf((c) => { c.about = `Authorization: Bearer ${'a'.repeat(30)}`; }), /carries a bearer token literal/);
  assert.match(errorsOf((c) => { c.region.label = `ss1.${'b'.repeat(40)}`; }), /carries a shopper capability literal/);
  assert.equal(errorsOf((c) => { c.worker.secrets = ['TENANTS', 'JWT_SECRET']; c.tokens = { brand: '#cd040b' }; }), '', 'secret NAMES and design tokens are fine');
});

test('the region section: anchors, model, extras, limits and the label length', () => {
  const r = (mutate) => errorsOf((c) => mutate(c.region), ['region']);
  assert.match(r((x) => { x.model.low = 'US-CA'; }), /region\.model\.low: one of the rehearsed regions/);
  assert.match(r((x) => { x.model.high = x.model.low; }), /two different regions/);
  assert.match(r((x) => { x.model.kind = 'linear'; }), /income-tilt/);
  assert.match(r((x) => { x.model.tSpan = 0.8; }), /tSpan/);
  assert.match(r((x) => { x.model.blend.value = 'pagers'; }), /category=pagers is not in the vocabulary/);
  assert.match(r((x) => { x.model.extras[0].regions = ['Texas']; }), /extras\[0\]\.regions/);
  assert.match(r((x) => { x.rehearsed['US-TX'].rows[0].touches.brand = 'nokia'; }), /"nokia" is not one of/);
  assert.match(r((x) => { x.rehearsed['US-TX'].rows[0].units = 401; }), /within the per-row limit/);
  assert.match(r((x) => { x.model.label = `{{census.label}}: ${'z'.repeat(80)}`; }), /at most 80 characters/);
  assert.match(r((x) => { x.census = 'migrations/seed/missing.sql'; }), /does not exist/);
  assert.match(r((x) => { x.text.shareOrder = ['intent']; }), /region\.text\.shareOrder/);
});

test('the imagery section: every source has a licence, an https page and the sources its kind needs', () => {
  const m = (mutate) => errorsOf((c) => mutate(c.imagery), ['imagery']);
  assert.match(m((x) => { x.sources[0].maker = 'nokia'; }), /"nokia" has no licence note/);
  assert.match(m((x) => { x.sources[0].page = 'http://www.apple.com/'; }), /page: the https page/);
  assert.match(m((x) => { x.sources[0].kind = 'compose'; }), /a compose is a "back" and a "front"/);
  assert.match(m((x) => { x.sources[1].id = x.sources[0].id; }), /is listed twice/);
  assert.match(m((x) => { x.sources[0].src[0].url = 'ftp://x'; }), /an https URL/);
  assert.match(m((x) => { x.render = { fill: 2 }; }), /imagery\.render\.fill/);
  assert.match(m((x) => { x.gate = { 'iphone-17': { verdict: 'fine', sha: 'x' } }; }), /imagery\.gate\.iphone-17/);
  assert.match(m((x) => { delete x.manifestAbout; }), /imagery\.manifestAbout/);
});

test('a section may live in its own file; a missing one, or one outside the repository, is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-kit-config-'));
  mkdirSync(join(root, 'cfg'));
  writeFileSync(join(root, 'cfg', 'region.json'), '{"operator":"x"}');
  writeFileSync(join(root, 'cfg', 'demo.json'), JSON.stringify({ name: 'D', region: 'cfg/region.json' }));
  assert.deepEqual(loadConfig(join(root, 'cfg', 'demo.json'), { root }).config.region, { operator: 'x' });
  writeFileSync(join(root, 'cfg', 'bad.json'), JSON.stringify({ name: 'D', imagery: 'cfg/none.json' }));
  assert.throws(() => loadConfig(join(root, 'cfg', 'bad.json'), { root }), /section "imagery" names cfg\/none\.json/);
  writeFileSync(join(root, 'cfg', 'escape.json'), JSON.stringify({ name: 'D', imagery: '../x.json' }));
  assert.throws(() => loadConfig(join(root, 'cfg', 'escape.json'), { root }), /not a file inside the repository/);
  let exited = null;
  loadValidConfig(join(root, 'cfg', 'demo.json'), { root, sections: ['region'], exit: (code) => { exited = code; }, log: () => {} });
  assert.equal(exited, 2, 'an invalid config stops the command line with every problem named');
});

test('the command lines read --config or the first plain argument, and never take a flag for a value', () => {
  assert.equal(configArg(['--config', 'a.json']), 'a.json');
  assert.equal(configArg(['--base', 'http://x', 'b.json'], ['--base']), 'b.json');
  assert.equal(configArg(['--dry-run']), null);
  assert.equal(argOf(['--base', '--token'], '--base', 'fallback'), 'fallback');
  assert.equal(argOf(['--out', 'dir'], '--out'), 'dir');
});
