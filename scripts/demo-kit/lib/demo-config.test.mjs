// node --test scripts/demo-kit/lib/demo-config.test.mjs
// The demo config (public/<slug>/demo.config.json, lane K4): OH's passes, and each rule refuses the mutation it
// exists for, naming the field.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoSlots, durationMs, kitTokens, REPO_ROOT, validateDemoConfig } from './config.mjs';

const ohFile = fileURLToPath(new URL('../../../public/oh/demo.config.json', import.meta.url));
const oh = JSON.parse(readFileSync(ohFile, 'utf8'));
const errorsOf = (mutate) => { const c = structuredClone(oh); mutate(c); return validateDemoConfig(c).errors.join('\n'); };
const beat = (c, key) => c.beats.list.find((b) => b.key === key);

test('OH\'s demo config is valid, and it names what the design names', () => {
  assert.deepEqual(validateDemoConfig(oh), { ok: true, errors: [] });
  assert.equal(oh.worker.name, 'edge-platform-oh');
  assert.equal(oh.beats.list.length, 16, 'the sixteen beats of design §4');
  assert.equal(oh.dimensions.length, 16, 'the sixteen dimensions of design §3');
  // The regional allowlist is the config's own (R4 removed priceTier from OH's): every name a dimension, the region
  // seed's dimensions the same list, and the learn document the scaffold wrote from it publishing exactly it.
  const learn = JSON.parse(readFileSync(new URL('../configs/oh/learn.json', import.meta.url), 'utf8'));
  assert.ok(oh.regional.dimensions.length > 0 && oh.regional.dimensions.every((d) => oh.dimensions.some((x) => x.key === d)), 'every allowlisted name is a dimension');
  assert.deepEqual(oh.region.dimensions, oh.regional.dimensions, 'the region seed writes exactly the allowlisted dimensions');
  assert.deepEqual(learn.regional.dimensions, oh.regional.dimensions, 'the published learn document carries the config\'s allowlist');
  assert.deepEqual(demoSlots(oh).map((s) => s.slot), ['hero', 'category-rail', 'deals', 'continue', 'grid-promo', 'pdp-modules', 'pdp-offers'], 'the decided slots of design §2');
});

test('the worker and its queue are the slug\'s own, and never the shared worker or a customer stamp', () => {
  assert.match(errorsOf((c) => { c.worker.name = 'edge-platform-lg'; }), /^worker\.name: "edge-platform-lg" must be "edge-platform-oh"/m);
  assert.match(errorsOf((c) => { c.worker.queue = 'events'; }), /^worker\.queue: "events" must be "events-oh"/m);
  assert.match(errorsOf((c) => { c.worker.queue = 'events'; }), /^worker\.queue: must not be the shared worker's queue/m);
  assert.match(errorsOf((c) => { c.slug = 'staging'; c.worker.name = 'edge-platform-staging'; }), /customer staging stamp, never a demo target/);
  assert.match(errorsOf((c) => { c.worker.devPort = 80; }), /^worker\.devPort/m);
  assert.match(errorsOf((c) => { c.slug = 'OH'; }), /^slug:/m);
  assert.match(errorsOf((c) => { c.design = 'docs/lg/no-such-design.md'; }), /^design: "docs\/lg\/no-such-design\.md" does not exist/m);
});

test('the palette sets only the kit\'s tokens, each a colour; brand, ink and paper are required', () => {
  assert.ok(kitTokens(REPO_ROOT).has('brand') && kitTokens(REPO_ROOT).has('m-bg'), 'the tokens are read from public/demo-kit/tokens.css');
  assert.match(errorsOf((c) => { c.palette.brandish = '#000000'; }), /^palette\.brandish: not a token of public\/demo-kit\/tokens\.css/m);
  assert.match(errorsOf((c) => { c.palette.brand = 'LG red'; }), /^palette\.brand: "LG red" is not a colour/m);
  assert.match(errorsOf((c) => { delete c.palette.paper; }), /^palette\.paper: required/m);
  assert.match(errorsOf((c) => { c.palette.font = 'Inter'; }), /^palette\.font: the families are fonts\.font and fonts\.mono/m);
  assert.match(errorsOf((c) => { c.fonts.font = 'Inter; } body { color: red'; }), /^fonts\.font: a font family name/m);
  assert.equal(errorsOf((c) => { c.palette['brand-glow'] = 'rgba(165,0,52,.7)'; c.palette.soft = '#fff'; }), '', 'rgba and short hex are colours');
});

test('dimensions carry their memory as a duration, once each; the regional allowlist names dimensions', () => {
  assert.equal(durationMs('60s'), 60000);
  assert.equal(durationMs('10m'), 600000);
  assert.equal(durationMs('60d'), 60 * 86400000);
  assert.equal(durationMs('a fortnight'), null);
  assert.match(errorsOf((c) => { c.dimensions[2].tau = 'a while'; }), /^dimensions\[2\]\.tau: "a while" is not a duration/m);
  assert.match(errorsOf((c) => { c.dimensions.push({ key: 'room' }); }), /"room" is listed twice/);
  assert.match(errorsOf((c) => { c.dimensions[0].values.push('tvs'); }), /dimensions\[0\]\.values\.category: "tvs" is listed twice/);
  assert.match(errorsOf((c) => { c.regional.dimensions.push('colour'); }), /^regional\.dimensions: "colour" is not a dimension/m);
  assert.match(errorsOf((c) => { c.dimensions = c.dimensions.concat(Array.from({ length: 17 }, (_, i) => ({ key: `d${i}` }))); }), /^dimensions: a list of 1\.\.32/m);
});

test('pages: each slot weighs dimensions, holds a take, and is named on one page only', () => {
  assert.match(errorsOf((c) => { c.pages[0].slots[0].weights.colour = 1; }), /^pages\[0\]\.slots\[0\]\.weights\.colour: not a dimension/m);
  assert.match(errorsOf((c) => { c.pages[0].slots[0].take = 0; }), /^pages\[0\]\.slots\[0\]\.take/m);
  assert.match(errorsOf((c) => { c.pages[1].slots[0].slot = 'deals'; }), /"deals" is named on another page too/);
  assert.match(errorsOf((c) => { c.pages[0].shell = 'home.html'; }), /^pages\[0\]\.shell: index\.html, product\.html, m\.html/m);
  assert.match(errorsOf((c) => { c.pages[3].slotsOf = 'nowhere'; }), /^pages\[3\]\.slotsOf: "nowhere" is not another page/m);
  assert.match(errorsOf((c) => { c.pages[0].url = '/vantage/'; }), /^pages\[0\]\.url: the page’s address, under \/oh/m);
  assert.match(errorsOf((c) => { c.pages[0].slots[3].gate = { visit: [] }; }), /^pages\[0\]\.slots\[3\]\.gate/m);
  assert.match(errorsOf((c) => { c.reportSlots.push('for-you'); }), /^reportSlots: "for-you" is not a snapshot slot/m, 'a /sort rail is not a snapshot slot');
});

test('an arrival seed names slots, and tags only dimensions those slots weigh', () => {
  assert.match(errorsOf((c) => { c.seeds[0].tags.push({ dimension: 'finish', value: 'stainless' }); }), /^seeds\[0\]\.tags: "finish" is not a dimension the hero slot weights/m);
  assert.match(errorsOf((c) => { c.seeds[0].slots.push('pdp-mod'); }), /^seeds\[0\]\.slots: "pdp-mod" is not a snapshot slot/m);
  assert.match(errorsOf((c) => { c.seeds[0].signal = 'weather'; }), /^seeds\[0\]\.signal/m);
  assert.match(errorsOf((c) => { c.seeds[0].weight = 2; }), /^seeds\[0\]\.weight: a rule weight in 0\.\.1/m);
});

test('the beats are data: one key and number each, an act, a who, and a publish says what it changes', () => {
  assert.match(errorsOf((c) => { beat(c, 'contrast').key = 'arrive'; }), /"arrive" is listed twice/);
  assert.match(errorsOf((c) => { beat(c, 'contrast').no = '1'; }), /\.no: its number on the director bar/);
  assert.match(errorsOf((c) => { beat(c, 'contrast').act = 9; }), /\.act: one of beats\.acts/);
  assert.match(errorsOf((c) => { beat(c, 'contrast').who = 'presenter'; }), /\.who: shopper \| merch \| engine/);
  assert.match(errorsOf((c) => { delete beat(c, 'contrast').line; }), /\.line: required/);
  assert.match(errorsOf((c) => { beat(c, 'window-closes').change = []; }), /\.change: what the catalog publish changes/);
  assert.match(errorsOf((c) => { beat(c, 'window-closes').change.push({ pin: { slot: 'deals', piece: {} } }); }), /a pin changes a slots document/);
  assert.match(errorsOf((c) => { beat(c, 'pin-launch').change = [{ shiftDays: 3 }]; }), /shiftDays changes a catalog document/);
  assert.match(errorsOf((c) => { beat(c, 'three-weeks').change = [{ shiftDays: 400 }]; }), /shiftDays: days, 1\.\.365/);
  assert.match(errorsOf((c) => { beat(c, 'three-weeks').change = [{ shiftDays: 2, close: {} }]; }), /exactly one of shiftDays, close, outOfStock, pin/);
  assert.match(errorsOf((c) => { beat(c, 'contrast').change = [{ shiftDays: 2 }]; }), /a context beat publishes nothing/);
  assert.match(errorsOf((c) => { beat(c, 'pin-launch').change[0].pin.slot = 'for-you'; }), /\.pin: \{ slot: a snapshot slot/);
  assert.match(errorsOf((c) => { c.beats.file = 'public/vantage/beats.json'; }), /^beats\.file: "public\/vantage\/beats\.json" must lie inside public\/oh/m);
});

test('a sign-in demo account is a fictional name only: a credential, or any other field, is refused', () => {
  const account = (c) => c.flags.signIn.accounts[0];
  assert.match(errorsOf((c) => { account(c).password = 'hunter2'; }), /accounts\[0\]: carries password: a demo account is a fictional name only/);
  assert.match(errorsOf((c) => { account(c).password = 'hunter2'; }), /^demo\.flags\.signIn\.accounts\[0\]\.password: a config never carries a credential/m);
  assert.match(errorsOf((c) => { account(c).email = 'dana@example.com'; }), /carries email: a demo account is a fictional name only/);
  assert.match(errorsOf((c) => { delete account(c).name; }), /accounts\[0\]\.name: a fictional name/);
  assert.match(errorsOf((c) => { c.flags.signIn.beat = 'no-such-beat'; }), /^flags\.signIn\.beat: a beat key/m);
  assert.match(errorsOf((c) => { c.flags.clockJump.beat = 'no-such-beat'; }), /^flags\.clockJump/m);
});

test('no credential anywhere: a token-shaped value is refused wherever it sits', () => {
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJzZWVkLW9oIn0', 'c2lnbmF0dXJlLW5vdC1yZWFs'].join('.');
  assert.match(errorsOf((c) => { beat(c, 'arrive').line = `anchored ${jwt}`; }), /carries a JWT; a config never carries a credential/);
  assert.match(errorsOf((c) => { c.worker.apiToken = 'x'; }), /^demo\.worker\.apiToken: a config never carries a credential/m);
  assert.equal(errorsOf((c) => { c.secrets = ['TENANTS', 'JWT_SECRET']; }), '', 'secret NAMES are fine');
});

test('what the page asserts, the data files and the documents stay the demo\'s own', () => {
  assert.match(errorsOf((c) => { c.asserted.context = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']; }), /^asserted\.context: at most 8/m);
  assert.match(errorsOf((c) => { c.asserted.intents = ['New Home']; }), /^asserted\.intents/m);
  assert.match(errorsOf((c) => { c.products.file = 'public/vantage/phones.json'; }), /^products\.file: "public\/vantage\/phones\.json" must lie inside public\/oh/m);
  assert.match(errorsOf((c) => { c.products.attributes.price_usd = 'sale price'; }), /^products\.attributes\.price_usd: "sale price" is not a field name/m);
  assert.equal(errorsOf((c) => { c.products.attributes.price_usd = 'pricing.sale'; }), '', 'a dotted path into the row is a field');
  assert.match(errorsOf((c) => { c.region.vocabulary.colour = ['red']; }), /^region\.vocabulary\.colour: not one of region\.dimensions/m);
  assert.match(errorsOf((c) => { c.region.contrast = ['California']; }), /^region\.contrast: region keys such as US-CA/m);
  assert.match(errorsOf((c) => { c.docs.dir = 'docs/lg'; }), /^docs\.dir: "docs\/oh"/m);
  assert.match(errorsOf((c) => { delete c.copy.scoredSentence; }), /^copy:/m);
});

// ── The working store's options (lane K5): the dock, the store, the labels ───
const withStore = (mutate) => errorsOf((c) => {
  c.director = { dock: 'right', collapsed: true };
  c.store = {
    categories: [{ key: 'tvs', label: 'TVs', categories: ['tvs', 'soundbars'] }, { key: 'laundry', label: 'Laundry', categories: ['washers', 'dryers'] }],
    filters: ['type', 'sizeBand', 'finish'], priceBands: [500, 1000, 2000],
    variants: [{ label: 'Size', by: ['attributes.series', 'modelYear'], option: 'sizeInches', suffix: '″' }],
    addOns: [{ key: 'protection', label: 'Protection plan', price: 99, categories: ['tvs'] }],
    service: [{ title: 'Free delivery', text: 'on every order' }],
    retailers: [{ key: 'seller', name: 'A seller', kind: 'online' }, { key: 'store', name: 'A store', kind: 'store', pickup: true }],
    footer: [{ head: 'Shop', links: ['TVs'] }], layout: { home: ['hero', 'service', 'deals'] }, search: { fields: ['attributes.type'] },
    fields: { listPrice: 'listPrice', rating: 'rating' }, pencil: 'Free shipping', delivery: 'Delivered free', financing: 'Pay over time',
  };
  c.labels = { addToCart: 'Add to Cart', findRetailer: 'Find a Retailer', added: 'Added: {name}' };
  mutate(c);
});

test('the director docks right or under the site, collapsed or not; the store\'s options name fields of the map and the rows; the labels are the kit\'s keys, plain words, with the default\'s placeholders', () => {
  assert.equal(withStore(() => {}), '', 'a full store section, the dock and the labels are valid');
  assert.match(withStore((c) => { c.director.dock = 'left'; }), /^director\.dock: right \| bottom/m);
  assert.match(withStore((c) => { c.director.collapsed = 'yes'; }), /^director\.collapsed/m);
  assert.match(withStore((c) => { c.director.key = 'D'; }), /^director: carries key: only dock and collapsed/m);
  assert.match(withStore((c) => { c.store.categories[0].categories.push('phones'); }), /store\.categories\[0\]\.categories: "phones" is not one of products\.categories/);
  assert.match(withStore((c) => { c.store.categories[1].key = 'tvs'; }), /store\.categories\[1\]\.key: "tvs" is listed twice/);
  assert.match(withStore((c) => { c.store.categories[0].key = 'product'; }), /"product" is the product page's key; a category's key names its grid/);
  assert.match(withStore((c) => { c.store.categories[0].key = 'search'; }), /"search" is one of the store's own views/);
  assert.match(withStore((c) => { c.store.categories[0].image = '/vantage/x.png'; }), /store\.categories\[0\]\.image: an image path under \/oh\//);
  assert.match(withStore((c) => { c.store.filters.push('colour'); }), /store\.filters: "colour" is not a key of products\.attributes/);
  assert.match(withStore((c) => { c.store.priceBands = [1000, 500]; }), /store\.priceBands: the band edges, rising/);
  assert.match(withStore((c) => { c.store.variants[0].by = []; }), /store\.variants\[0\]\.by/);
  assert.match(withStore((c) => { c.store.variants[0].option = 'size inches'; }), /store\.variants\[0\]\.option/);
  assert.match(withStore((c) => { c.store.addOns[0].price = 'free'; }), /store\.addOns\[0\]\.price/);
  assert.match(withStore((c) => { c.store.retailers[0].kind = 'mail'; }), /store\.retailers\[0\]\.kind: online \| store/);
  assert.match(withStore((c) => { c.store.layout.home.push('hero-2'); }), /store\.layout\.home: "hero-2" is not a homepage slot or rail/);
  assert.match(withStore((c) => { c.store.fields.price = 'salePrice'; }), /store\.fields\.price: not one of listPrice/);
  assert.match(withStore((c) => { c.store.service = Array.from({ length: 7 }, () => ({ title: 'x' })); }), /store\.service: a list of 1\.\.6/);
  assert.match(withStore((c) => { c.labels.buyNow = 'Buy now'; }), /^labels\.buyNow: not a label of the working store/m);
  assert.match(withStore((c) => { c.labels.addToCart = '<b>Add</b>'; }), /^labels\.addToCart: plain words, 1\.\.400 characters, no markup/m);
  assert.match(withStore((c) => { c.labels.added = 'Added to your cart'; }), /^labels\.added: names \{nothing\}; the label names \{name\}/m);
  assert.match(withStore((c) => { c.labels.cartTitle = 'Bag of {name}'; }), /^labels\.cartTitle: names \{name\}; the label names \{nothing\}/m);
  assert.match(withStore((c) => { c.store.retailers[0].apiKey = 'k'; }), /a config never carries a credential/);
});
