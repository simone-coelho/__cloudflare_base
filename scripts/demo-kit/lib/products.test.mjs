// node --test scripts/demo-kit/lib/products.test.mjs
// The products-file check (lane K4; K3b's build item in the design's decisions log): a beat document's product facts
// held to the demo's products file. Proven on Vantage's own beat documents and phones.json (read, never written), on
// each way a fact can drift, and through prepareSeed, which refuses before anything is written.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadValidConfig, REPO_ROOT, validateConfig } from './config.mjs';
import { prepareSeed, productFactProblems } from './seed.mjs';

const vantageDir = fileURLToPath(new URL('../../../public/vantage/beats/', import.meta.url));
const readDocs = () => Object.fromEntries(readdirSync(vantageDir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(vantageDir, f), 'utf8'))]));
const phones = JSON.parse(readFileSync(join(REPO_ROOT, 'public/vantage/phones.json'), 'utf8'));
/** Vantage's products map, as a demo.config.json would write it: phones by id, the storage steps as variants. */
const spec = {
  file: 'public/vantage/phones.json', list: 'phones', id: 'id', eventId: 'productId',
  attributes: { brand: 'brand', ecosystem: 'ecosystem', os: 'ecosystem', price_usd: 'price_usd' },
  variants: { list: 'storageOptions', key: 'storage', attributes: { price_usd: 'price_usd' } },
};

test('Vantage\'s eighteen beat documents agree with phones.json: every featured phone exists and every event\'s facts hold', () => {
  const docs = readDocs();
  assert.equal(Object.keys(docs).length, 18);
  assert.deepEqual(productFactProblems({ documents: docs, products: phones, spec }), []);
  // The check did read facts: ten events name a phone, and the catalogs feature twelve.
  let named = 0;
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.productId === 'string') named += 1; Object.values(v).forEach(walk); } };
  walk(docs);
  assert.equal(named, 10);
});

test('each way a product fact drifts is refused by document and path', () => {
  const docs = readDocs();
  const storage = docs['07-compare-storage'].events;
  storage[0].data.price_usd = 999.99;                               // a named variant's price
  storage[1].data.storage = '3tb';                                  // a variant the phone does not have
  storage[2].data.brand = 'apple';                                  // the product's own field
  docs['03-browse-galaxy-pixel'].events[1].data.price_usd = 1.23;    // no configuration has it
  docs['03-browse-galaxy-pixel'].events[2].data.productId = 'nokia-3310';
  docs['open-catalog'].publish.document.pieces[0].featuredProductIds.push('pixel-99');
  const found = productFactProblems({ documents: docs, products: phones, spec });
  const has = (re) => assert.ok(found.some((m) => re.test(m)), `${re} in:\n${found.join('\n')}`);
  has(/^07-compare-storage\.events\[0\]\.data: price_usd 999\.99 for galaxy-s26 storage "512gb"; the products file says 1099\.99/);
  has(/^07-compare-storage\.events\[1\]\.data: names galaxy-s26 storage "3tb", which the products file does not list for it/);
  has(/^07-compare-storage\.events\[2\]\.data: brand "apple" for galaxy-s26; the products file says "samsung"/);
  has(/^03-browse-galaxy-pixel\.events\[1\]\.data: price_usd 1\.23 for galaxy-s26; the products file says 899\.99 \(or a configuration's price_usd: 899\.99, /);
  has(/^03-browse-galaxy-pixel\.events\[2\]\.data: names product nokia-3310, which the products file does not have/);
  has(/^open-catalog\.publish\.document\.pieces\[0\]\.featuredProductIds\[\d+\]: pixel-99 is not in the products file/);
  assert.equal(found.length, 6, found.join('\n'));
});

test('fields may sit inside the row (attributes.category) and hold lists (a product in several retailers)', () => {
  const products = { products: [{ sku: 'TV1', salePrice: 999, attributes: { category: 'tvs', retailer: ['lg-com', 'best-buy-pickup'] } }] };
  const nested = { list: 'products', id: 'sku', attributes: { category: 'attributes.category', retailer: 'attributes.retailer', price_usd: 'salePrice' } };
  const doc = (data) => ({ beat: { events: [{ type: 'product_view', data: { productId: 'TV1', ...data } }] } });
  assert.deepEqual(productFactProblems({ documents: doc({ category: 'tvs', retailer: 'best-buy-pickup', price_usd: 999 }), products, spec: nested }), []);
  assert.deepEqual(productFactProblems({ documents: doc({ retailer: ['lg-com'] }), products, spec: nested }), [], 'a list stated is a subset of the list held');
  assert.match(productFactProblems({ documents: doc({ category: 'washers' }), products, spec: nested })[0], /category "washers" for TV1; the products file says "tvs"/);
  assert.match(productFactProblems({ documents: doc({ retailer: 'find-a-retailer' }), products, spec: nested })[0], /retailer "find-a-retailer" for TV1/);
  assert.match(productFactProblems({ documents: doc({ fuel: 'gas' }), products, spec: { ...nested, attributes: { fuel: 'attributes.fuel' } } })[0], /states fuel for TV1, which the products file does not record/);
  assert.deepEqual(productFactProblems({ documents: {}, products: { rows: [] }, spec: nested }), ['the products file has no "products" list']);
});

test('a seed refuses when a beat document\'s product facts disagree with the products file: nothing written, nothing sent', () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-kit-products-'));
  cpSync(join(REPO_ROOT, 'public', 'vantage', 'beats'), join(root, 'public', 'vantage', 'beats'), { recursive: true });
  cpSync(join(REPO_ROOT, 'public', 'vantage', 'phones.json'), join(root, 'public', 'vantage', 'phones.json'));
  cpSync(join(REPO_ROOT, 'scripts', 'demo-kit', 'configs'), join(root, 'scripts', 'demo-kit', 'configs'), { recursive: true });
  const configFile = join(root, 'scripts', 'demo-kit', 'configs', 'vantage.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.seed.products = spec;
  writeFileSync(configFile, JSON.stringify(config));
  const seed = () => { const l = loadValidConfig(configFile, { root, sections: ['seed'], exit: (c) => { throw new Error(`invalid ${c}`); } }); return prepareSeed({ config: l.config, path: l.path, nowMs: Date.UTC(2027, 0, 1) }); };
  assert.deepEqual(seed().errors, [], 'the documents as they are: clean');
  const file = join(root, 'public', 'vantage', 'beats', '06-open-the-galaxy.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const event = doc.events.find((e) => e.data && e.data.productId);
  event.data.price_usd = 4242;
  writeFileSync(file, JSON.stringify(doc));
  const refused = seed();
  assert.equal(refused.errors.length, 1, refused.errors.join('\n'));
  assert.match(refused.errors[0], /^06-open-the-galaxy\.events\[0\]\.data: price_usd 4242 for galaxy-s26; the products file says 899\.99/);
  // An error, not a warning: scripts/demo-kit/seed.mjs stops on any error, before it writes a file or sends a request.
  assert.equal(refused.warnings.some((w) => /4242/.test(w)), false);
  const cli = readFileSync(join(REPO_ROOT, 'scripts', 'demo-kit', 'seed.mjs'), 'utf8');
  assert.match(cli, /if \(prepared\.errors\.length\) \{[\s\S]{0,200}nothing written, nothing sent[\s\S]{0,80}return 1;/);
});

test('the kit config\'s seed.products: a file inside the demo\'s directory, an id field, a map of attribute → field', () => {
  const { config } = loadConfig(join(REPO_ROOT, 'scripts', 'demo-kit', 'configs', 'vantage.json'));
  const errorsOf = (p) => { const c = structuredClone(config); c.seed.products = p; return validateConfig(c, { sections: ['seed'] }).errors.join('\n'); };
  assert.equal(errorsOf(spec), '');
  assert.match(errorsOf({ ...spec, file: 'public/oh/products.json' }), /seed\.products\.file: "public\/oh\/products\.json" must lie inside public\/vantage/);
  assert.match(errorsOf({ ...spec, file: 'public/vantage/no-such.json' }), /seed\.products\.file: "public\/vantage\/no-such\.json" does not exist/);
  assert.match(errorsOf({ ...spec, id: undefined }), /seed\.products\.id: the field that holds each product's id/);
  assert.match(errorsOf({ ...spec, attributes: {} }), /seed\.products\.attributes: an object of event attribute → product field/);
  assert.match(errorsOf({ ...spec, variants: { list: 'storageOptions' } }), /seed\.products\.variants: \{ list, key, attributes \}/);
});

test('an overlay another lane writes (specs.json) is merged over the products by id before the facts are read', async () => {
  const { mergeOverlay } = await import('./seed.mjs');
  const products = { products: [{ sku: 'TV1', salePrice: 999, name: 'TV one' }, { sku: 'TV2', salePrice: 500 }] };
  const spec = { list: 'products', id: 'sku', attributes: { price_usd: 'salePrice' }, overlay: { file: 'public/oh/specs.json', by: 'sku' } };
  const asList = mergeOverlay(products, { specs: [{ sku: 'TV1', salePrice: 949, vesa: '300x200' }] }, spec);
  assert.deepEqual(asList.products[0], { sku: 'TV1', salePrice: 949, name: 'TV one', vesa: '300x200' });
  assert.equal(asList.products[1], products.products[1], 'a product the overlay does not name is the same row');
  assert.deepEqual(mergeOverlay(products, { bySku: { TV2: { salePrice: 450 } } }, spec).products[1], { sku: 'TV2', salePrice: 450 });
  assert.equal(products.products[0].salePrice, 999, 'neither input changes');
  const doc = { beat: { events: [{ data: { productId: 'TV1', price_usd: 949 } }] } };
  assert.match(productFactProblems({ documents: doc, products, spec })[0], /price_usd 949 for TV1; the products file says 999/);
  assert.deepEqual(productFactProblems({ documents: doc, products: asList, spec }), [], 'held to the merged view');
});
