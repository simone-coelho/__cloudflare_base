// node --test scripts/demo-kit/lib/store.test.mjs
// The demo kit's working store (public/demo-kit/store.js, lane K5): the same API as OH's store (public/oh/oh-store.js,
// lane M3), so OH can switch to the kit module; no demo's words or lists in its code (OH's own kit-boundary guard, and
// OH's labels, R4); every visible word read from the page's labels; and its behaviour on a page made of fakes: the
// load mints nobody, the first press does; the published template; the filters, the variants and search; the cart's
// lines, totals and set savings; the events in the beat verbs' shapes; the routes; where to buy and its outcomes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, STORE_LABELS } from './config.mjs';
import { codeOnly } from './rehearse.mjs';

const KIT = join(REPO_ROOT, 'public', 'demo-kit', 'store.js');
const OH_STORE = join(REPO_ROOT, 'public', 'oh', 'oh-store.js');
const source = readFileSync(KIT, 'utf8');
const code = codeOnly(source, 'js');

// ── A page made of fakes: the DOM the store touches, a transport that records, a host with a small feed ──────────
function fakePage() {
  const nodes = new Map();
  const node = (id, extra = {}) => {
    const n = { id, hidden: true, textContent: '', innerHTML: '', dataset: {}, attrs: {}, listeners: {}, ...extra,
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return k in this.attrs; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, querySelector: () => null, querySelectorAll: () => [], closest: () => null };
    nodes.set(id, n);
    return n;
  };
  const count = node('cartCount', { attrs: { 'data-cart-count': '', 'data-hide-empty': '' } });
  node('storeToast'); node('signIn');
  const doc = {
    listeners: {},
    getElementById: (id) => nodes.get(id) || null,
    querySelector: (sel) => (sel === '[data-act="store-cart-open"][aria-label]' ? null : sel === '#site .site-header' ? null : null),
    querySelectorAll: (sel) => (/data-cart-count/.test(sel) ? [count] : []),
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    body: { insertAdjacentHTML() {} },
  };
  const storage = new Map();
  Object.assign(globalThis, {
    document: doc,
    location: { origin: 'http://kit.test', pathname: '/kx/', search: '', href: 'http://kit.test/kx/' },
    history: { pushes: [], pushState(s, t, url) { this.pushes.push(url); globalThis.location.href = `http://kit.test${url}`; const u = new URL(url, 'http://kit.test'); globalThis.location.pathname = u.pathname; globalThis.location.search = u.search; }, back() {} },
    sessionStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
  });
  return { nodes, count };
}
const LABELS = Object.fromEntries(Object.keys(STORE_LABELS).map((k) => [k, `⟦${k}${(STORE_LABELS[k].match(/\{[a-z]+\}/g) || []).join('')}⟧`]));
const PRODUCTS = [
  { sku: 'A1', name: 'Ⓐ1', cat: 'c1', colour: 'red', size: 'S', fam: 'f1', price: 100, list: 120, stock: true, rating: 4.5 },
  { sku: 'A2', name: 'Ⓐ2', cat: 'c1', colour: 'red', size: 'M', fam: 'f1', price: 100, list: null, stock: true, rating: 4.1 },
  { sku: 'A3', name: 'Ⓐ3', cat: 'c1', colour: 'blue', size: 'S', fam: 'f1', price: 110, list: null, stock: false, rating: 3.9 },
  { sku: 'B1', name: 'Ⓑ1', cat: 'c2', colour: 'blue', size: null, fam: 'f2', price: 900, list: 1000, stock: true, rating: 4.9, configs: [{ k: '50', label: '⓹⓪', price: 900 }, { k: '58', label: '⓹⓼', price: 950 }] },
  { sku: 'B2', name: 'Ⓑ2', cat: 'c2', colour: 'green', size: null, fam: 'f3', price: 2400, list: null, stock: true, rating: 4.7 },
];
function harness({ hostExtra = {}, site = {} } = {}) {
  const page = fakePage();
  const calls = [];
  const visitors = {};
  const state = { busy: false, who: null, visitors, ctx: { region: null }, sheet: null, pieces: new Map(), sets: {}, viewPage: 'home', registry: { weights: { add_to_cart: 3, filter: 2 }, dimensions: [{ key: 'colour' }] } };
  let minted = 0;
  const transport = {
    cur: () => (state.who ? visitors[state.who] : null),
    async ensureVisitor() { minted += 1; visitors.A = { key: 'A', label: 'Shopper A', session: { subject: 'u1', sessionId: 's1', capability: 'cap' }, journey: [] }; state.who = 'A'; return visitors.A; },
    async send(type, data) { calls.push({ door: 'send', type, data }); return { ok: true, status: 200, body: {} }; },
    async sendCustom(event, data) { calls.push({ door: 'send', type: 'custom', data: { event, ...data } }); return { ok: true, status: 200, body: {} }; },
    async api(path, body) {
      calls.push({ door: 'api', path, body });
      if (path === '/sort') return { ok: true, status: 200, body: { order: [...body.candidates].reverse().map((c) => c.id), items: [], regional: { region: 'US-NC', level: 'region', dataSource: 'synthetic' } } };
      return { ok: false, status: 404, body: {} };
    },
    async tryJson() { calls.push({ door: 'tryJson' }); return null; },
    useVisitor(k) { state.who = k; },
  };
  const sheetsOpened = [];
  const demo = { transport, state, panels: { note() {}, loadColdStart: async () => { calls.push({ door: 'coldstart' }); }, coldLabel: () => null, regionName: (k) => ({ 'US-NC': 'Ⓝ' }[k] || k), ownName: () => 'Ⓡ' },
    sheets: { open(kind, html) { state.sheet = { kind }; sheetsOpened.push({ kind, html }); }, async close() { state.sheet = null; } }, director: { say() {} } };
  const byId = new Map(PRODUCTS.map((p) => [p.sku, p]));
  const opened = [];
  const host = {
    demo, lanes: { routes: {}, beforeBeat: [] }, base: '/kx/',
    site: { name: '⟪store⟫', slug: 'kx', tenant: 'kx', base: '/kx/', labels: LABELS, pages: [{ key: 'home', page: 'home', sorted: [{ slot: 'search', weights: { colour: 1 } }] }],
      products: { category: 'cat', attributes: { category: 'cat', colour: 'colour', size: 'size', price_usd: 'price' }, variants: { list: 'configs', key: 'k', attributes: { price_usd: 'price' } } },
      store: { fields: { listPrice: 'list', inStock: 'stock', rating: 'rating' }, variants: [{ label: '⟪size⟫', by: ['fam', 'colour'], option: 'size' }],
        retailers: [{ key: 'r1', name: '⟪r1⟫', kind: 'online' }, { key: 'r2', name: '⟪r2⟫', kind: 'store', pickup: true }, { key: 'r3', name: '⟪r3⟫', kind: 'store' }], search: { fields: ['colour'] } },
      signIn: { accounts: ['⟪Ann Example⟫'] }, ...site },
    productOf: (id) => byId.get(String(id)) || null, idOf: (p) => p.sku, productName: (p) => p.name, priceOf: (p) => p.price, imageOf: () => null, listPriceOf: (p) => p.list,
    field: (p, path) => String(path).split('.').reduce((v, k) => (v == null ? undefined : v[k]), p), products: () => PRODUCTS,
    productAttrs: (p, extra) => ({ productId: p.sku, category: p.cat, colour: p.colour, ...(p.size ? { size: p.size } : {}), price_usd: p.price, ...(extra || {}) }),
    openPage: async (key, o) => { opened.push(['page', key, o]); return true; }, openProduct: async (id, o) => { opened.push(['product', id, o]); return true; },
    askPage: async (key) => { calls.push({ door: 'ask', key }); return true; }, homeKey: () => 'home', pageOf: (k) => (k === 'home' ? { key: 'home' } : null), phoneKey: () => 'home',
    pieces: () => [{ customerContentId: 'set-1', title: '⟪set⟫', featuredProductIds: ['A1', 'B1'], display: { savings: 50, price: 950, memberSum: 1000 } }, { customerContentId: 'wtb', display: { outcome: 'retailer_referral' } }],
    ...hostExtra,
  };
  return { page, calls, state, transport, host, sheetsOpened, opened, minted: () => minted };
}
const load = async () => { const m = await import(`../../../public/demo-kit/store.js?t=${Math.random()}`); return m; };

// ── The API: OH's store's, so OH can switch ───────────────────────────────────────────────────────────────────
/** The members of each part of a store, as its source declares them: `const <part> = { a, b: …, c(…) { … } }`. */
function membersOf(src, part) {
  const m = new RegExp(`const ${part} = \\{`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length, depth = 1, body = '';
  while (i < src.length && depth) { const c = src[i]; if (c === '{') depth += 1; else if (c === '}') depth -= 1; if (depth) body += depth === 1 ? c : (c === '\n' ? '\n' : ' '); i += 1; }
  return [...new Set([...body.matchAll(/(?:^|[,{\n])\s*([A-Za-z_]\w*)\s*(?=[,:(}\n]|$)/g)].map((x) => x[1]))].filter((k) => !['async', 'function', 'return', 'const', 'let'].includes(k)).sort();
}

test('the kit\'s store has OH\'s store\'s API, every part and every member, so OH can switch to the kit module', { skip: !existsSync(OH_STORE) && 'public/oh/oh-store.js is not in this tree' }, async () => {
  const oh = readFileSync(OH_STORE, 'utf8');
  const top = /export const store = \{\s*([\s\S]*?)\n\s*\/\*\*/.exec(oh);
  const ohTop = top[1].split(/[,\s]+/).filter((k) => /^[a-z]\w*$/.test(k));
  const { store } = await load();
  for (const k of ohTop) assert.ok(k in store, `store.${k}`);
  for (const part of ['visitor', 'events', 'nav', 'cart', 'search', 'retailers', 'signin', 'ui', 'trail']) {
    const want = membersOf(oh, part), have = Object.keys(store[part]);
    assert.ok(want && want.length, `oh-store.js declares ${part}`);
    for (const k of want) assert.ok(have.includes(k), `store.${part}.${k} (OH has it)`);
  }
  for (const fn of ['bind', 'control', 'reask', 'debug']) assert.equal(typeof store[fn], 'function', `store.${fn}()`);
  assert.ok(store.ready instanceof Promise, 'store.ready');
});

// ── No demo's words, no demo's lists ──────────────────────────────────────────────────────────────────────────
test('the kit module holds no OH literal: OH\'s own kit-boundary guard (routes, brand, partners, room words, its products and pieces) and OH\'s labels, over the code of store.js', () => {
  const ohDir = join(REPO_ROOT, 'public', 'oh');
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = (s) => new RegExp(`(?<![\\w-])${reEsc(s)}(?![\\w-])`, 'i');
  const names = [['OH’s routes', /\/oh\//], ['__oh', /__oh\b/], ['oh-demo', /\boh-demo\b/], ['Optimized Home', /optimized home/i], ['LG', /\bLG\b/],
    ['Best Buy', /best\s*buy/i], ['PriceSpider', /pricespider/i], ['Find a Retailer', /find a retailer/i], ['Notify Me', /notify me/i], ['oh-store', /oh-store/i],
    ...['washer', 'dryer', 'laundry', 'soundbar', 'OLED', 'QNED', 'VESA', 'pedestal', 'refrigerator', 'dishwasher', 'microwave', 'ThinQ'].map((w) => [w, new RegExp(`\\b${w}`, 'i')])];
  if (existsSync(join(ohDir, 'products.json'))) for (const p of JSON.parse(readFileSync(join(ohDir, 'products.json'), 'utf8')).products || []) {
    names.push([p.sku, word(p.sku)]);
    if (/\s/.test(String(p.name || '').trim())) names.push([p.name, word(p.name)]);
  }
  if (existsSync(join(ohDir, 'catalog.json'))) for (const p of JSON.parse(readFileSync(join(ohDir, 'catalog.json'), 'utf8')).pieces || []) names.push([p.customerContentId, word(p.customerContentId)]);
  // OH's labels: the words its demo config gives the store, and the button words of its own store (exact, as OH writes them).
  const ohConfig = existsSync(join(ohDir, 'demo.config.json')) ? JSON.parse(readFileSync(join(ohDir, 'demo.config.json'), 'utf8')) : {};
  for (const v of Object.values(ohConfig.labels || {})) if (/\s/.test(v)) names.push([v, new RegExp(reEsc(v))]);
  for (const v of ['Add to Cart', 'Buy directly', 'Choose Best Buy pickup', 'Shop at ', 'From OH.', 'Search TVs, laundry, kitchen']) names.push([v, new RegExp(reEsc(v))]);
  const leaks = [];
  code.split('\n').forEach((line, n) => { for (const [w, re] of names) if (re.test(line)) leaks.push(`store.js:${n + 1} “${w}”`); });
  assert.deepEqual(leaks, [], `${names.length} names checked`);
});

test('every visible word the store renders is the page\'s label: with every label a marker, what it draws holds no other words but the data it was given', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  await store.visitor.ensure();
  await store.cart.add('A1', { addOns: [{ id: 'x', label: '⟪addon⟫', price: 9 }] });
  await store.cart.add('B1');
  store.cart.open();
  store.cart.checkout();
  await store.retailers.open('A1');
  store.signin.open();
  await store.nav.go('/kx/?q=red');
  const rendered = h.sheetsOpened.map((s) => s.html).join('\n');
  assert.ok(h.sheetsOpened.map((s) => s.kind).join(',') === 'cart,checkout,retailers,sign-in,search', h.sheetsOpened.map((s) => s.kind).join(','));
  // Strip the markup and the attributes, then the labels (⟦…⟧), the data (⟪…⟫, Ⓐ…), money, codes and symbols: nothing is left.
  const text = rendered.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/⟦[^⟧]*⟧/g, ' ').replace(/⟪[^⟫]*⟫/g, ' ').replace(/[ⒶⒷⓃⓇ⓹⓪⓼]\d*/g, ' ')
    .replace(/\$[\d,.]+/g, ' ').replace(/\b(?:A1|A2|A3|B1|B2|kx-order-\w+)\b/g, ' ').replace(/[\s·×−+:\-–(),.#\d"“”'’]+/g, ' ').trim();
  assert.equal(text, '', `words the store drew that are not labels: ${text.slice(0, 200)}`);
  for (const k of ['cartTitle', 'subtotal', 'total', 'checkout', 'continueShopping', 'checkoutTitle', 'placeOrder', 'buyDirect', 'onlineSellers', 'nearbyStores', 'referral', 'pickup', 'signInTo', 'noResults', 'resultsFor', 'resultFor'].filter((x) => x !== 'noResults' && x !== 'resultFor')) {
    assert.ok(rendered.includes(`⟦${k}`), `the ${k} label is drawn`);
  }
  // A label the settings lack is an error at its use, never an empty button.
  const bare = createStore();
  bare.bind({ ...harness().host, site: { ...h.host.site, labels: {} } });
  assert.throws(() => bare.label('addToCart'), /carry no "addToCart" label/);
});

// ── The load mints nobody; the first press does ───────────────────────────────────────────────────────────────
test('binding the store and rendering the published template mint no visitor and send nothing; the first press mints her once, however many ask at once', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  await store.ready;
  const t = store.template.of('home', {
    anchor: '2026-10-01T12:00:00.000Z',
    catalog: { pieces: [
      { id: 'p_a', customerContentId: 'p-a', slotTypes: ['hero'], window: { from: '2026-09-01T00:00:00Z', to: '2026-12-01T00:00:00Z' } },
      { id: 'p_b', customerContentId: 'p-b', slotTypes: ['hero', 'deals'] },
      { id: 'p_c', customerContentId: 'p-c', slotTypes: ['deals'], inStock: false },
      { id: 'p_d', customerContentId: 'p-d', slotTypes: ['deals'], eligibleWhen: { context: { visit: ['return'] } } },
      { id: 'p_e', customerContentId: 'p-e', slotTypes: ['deals'], window: { from: '2026-09-01T00:00:00Z', to: '2026-09-30T00:00:00Z' } },
      { id: 'p_f', customerContentId: 'p-f', slotTypes: ['deals'] },
      { id: 'p_g', customerContentId: 'p-g', slotTypes: ['deals'], lifecycle: { status: 'draft' } },
    ] },
    slots: { pages: { home: [{ slot: 'hero', take: 1 }, { slot: 'deals', take: 3, pinnedPieceIds: ['p_f'] }] } },
    display: new Map([['p-a', { order: 2 }], ['p-b', { order: 1 }], ['p-f', { order: 9 }]]),
  });
  assert.deepEqual(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map((p) => p.customerContentId)])), { hero: ['p-b'], deals: ['p-f', 'p-b'] },
    'pins first, then the catalog\'s order (display.order, then the file\'s); live, in window at the anchor, in stock and ungated; to the take');
  assert.equal(h.minted(), 0, 'nobody minted on load');
  assert.deepEqual(h.calls.filter((c) => c.door !== 'tryJson'), [], 'nothing sent and nothing asked on load');
  const [a, b] = await Promise.all([store.visitor.ensure(), store.visitor.ensure()]);
  assert.equal(h.minted(), 1, 'two presses at once share one mint');
  assert.equal(a, b);
  assert.ok(h.calls.some((c) => c.door === 'coldstart'), 'her cold start is read with the mint');
});

// ── Events, the re-ask, the routes ────────────────────────────────────────────────────────────────────────────
test('events go out in the beat verbs\' shapes: a product\'s attributes on product_view, first-class types as they are, anything else custom with data.event', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  assert.equal(await store.events.send('page_view', { page: 'home' }), null, 'nobody on the page yet: nothing sent');
  await store.visitor.ensure();
  await store.events.send('product_view', { sku: 'A1' });
  await store.events.send('filter', store.filters.eventOf('colour', 'red'), { reask: true });
  await store.events.send('add_to_cart', { sku: 'B1', quantity: 2 });
  const sent = h.calls.filter((c) => c.door === 'send');
  assert.deepEqual(sent[0], { door: 'send', type: 'product_view', data: { productId: 'A1', category: 'c1', colour: 'red', size: 'S', price_usd: 100, view: 'page' } });
  assert.deepEqual(sent[1], { door: 'send', type: 'custom', data: { event: 'filter', control: 'filter', filter: 'colour', value: 'red', colour: 'red' } }, 'a filter carries the dimension it narrows');
  assert.deepEqual(sent[2], { door: 'send', type: 'add_to_cart', data: { productId: 'B1', category: 'c2', colour: 'blue', price_usd: 900, quantity: 2 } });
  assert.ok(h.calls.some((c) => c.door === 'ask' && c.key === 'home'), 'opts.reask asks the page on screen again');
  assert.equal(store.events.weight('add_to_cart'), 3, 'the published registry\'s weight');
  assert.equal(store.events.weight('compare'), 0);
});

test('the routes: the store\'s paths under the demo\'s base, the canonical search path a reload reaches, and a grid no page carries going home', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  const p = store.nav.parse;
  assert.deepEqual(p('/kx/'), { name: 'home', path: '/kx/' });
  assert.deepEqual(p('/kx/?view=tents'), { name: 'grid', view: 'tents', path: '/kx/?view=tents' });
  assert.deepEqual(p('/kx/product?id=A1'), { name: 'product', id: 'A1', path: '/kx/product?id=A1' });
  assert.deepEqual(p('/kx/?q=red%20tent'), { name: 'search', q: 'red tent', path: '/kx/?q=red%20tent' });
  assert.deepEqual(p('/kx/search?q=red'), { name: 'search', q: 'red', path: '/kx/?q=red' }, 'OH\'s search path parses too, to the canonical one');
  assert.deepEqual(p('/kx/m'), { name: 'phone', path: '/kx/m' });
  assert.equal(p('/vantage/'), null, 'another demo\'s path is not this store\'s');
  assert.equal(store.nav.navPath('tents'), '/kx/?view=tents');
  assert.equal(store.nav.navPath('home'), '/kx/');
  await store.nav.go('/kx/product?id=B1');
  assert.deepEqual(h.opened.at(-1), ['product', 'B1', { event: undefined }]);
  assert.equal(history.pushes.at(-1), '/kx/product?id=B1', 'the address bar gets the route');
  h.host.lanes.routes.grid = async (r) => { h.opened.push(['lane', r.view]); };
  await store.nav.go('/kx/?view=tents');
  assert.deepEqual(h.opened.at(-1), ['lane', 'tents'], 'a page lane\'s renderer for its route');
  h.state.busy = true;
  assert.equal(await store.nav.go('/kx/'), false, 'refused while a beat runs, unless the dispatcher sends it');
});

// ── The cart ──────────────────────────────────────────────────────────────────────────────────────────────────
test('the cart: lines by product, options and add-ons; quantities; a set\'s saving only when every member is in, at the catalog\'s own figure; checkout records one order per line', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  const line = await store.cart.add('A1', { options: { '⟪size⟫': 'S' }, addOns: [{ id: 'care', label: '⟪care⟫', price: 10 }] });
  assert.equal(h.minted(), 1, 'adding mints her when she is not here yet');
  assert.deepEqual([line.sku, line.qty, line.unitPrice, line.listPrice], ['A1', 1, 100, 120]);
  await store.cart.add('A1', { options: { '⟪size⟫': 'S' }, addOns: [{ id: 'care', label: '⟪care⟫', price: 10 }] });
  assert.equal(store.cart.lines().length, 1, 'the same product, options and add-ons are one line');
  assert.equal(store.cart.count(), 2);
  assert.deepEqual(store.cart.total(), { subtotal: 200, addOns: 20, savings: [], saving: 0, total: 220, count: 2 });
  await store.cart.add('B1', { unitPrice: 950, options: { '⟪frame⟫': '58' } });
  const t = store.cart.total();
  assert.deepEqual(t.savings.map((s) => [s.id, s.amount]), [['set-1', 50]], 'both members in: the set\'s published saving');
  assert.equal(t.total, 200 + 20 + 950 - 50);
  const adds = h.calls.filter((c) => c.type === 'add_to_cart');
  assert.equal(adds.length, 3, 'every add sends the order-start action');
  assert.equal(adds[2].data.config ?? adds[2].data.options['⟪frame⟫'], '58');
  await assert.rejects(() => store.cart.add('A3'), /⟦outOfStockHereⒶ3⟧/, 'out of stock: refused, with the label and the product named');
  await assert.rejects(() => store.cart.add('ZZ'), /⟦noProduct/, 'not in the feed: refused');
  store.cart.setQty(store.cart.lines()[0].lineId, 0);
  assert.equal(store.cart.lines().length, 1, 'a quantity of 0 removes the line');
  assert.equal(h.page.count.textContent, '1', 'the header\'s count follows');
  await store.control({ dataset: { act: 'store-cart-place' } });
  const orders = h.calls.filter((c) => c.type === 'purchase');
  assert.equal(orders.length, 1, 'one order event per line');
  assert.deepEqual([orders[0].data.productId, orders[0].data.quantity, orders[0].data.value, orders[0].data.currency], ['B1', 1, 950, 'USD']);
  assert.equal(store.cart.count(), 0, 'the cart is empty after the order');
});

// ── Search, filters, variants, /sort ──────────────────────────────────────────────────────────────────────────
test('search matches every word in the feed\'s order; the query sends the search event and returns POST /sort\'s order with the regional label', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  store.search.index(PRODUCTS);
  assert.deepEqual(store.search.match('red').map((p) => p.sku), ['A1', 'A2'], 'the configured field (colour), in the feed\'s order');
  assert.deepEqual(store.search.match('b1').map((p) => p.sku), ['B1'], 'by id');
  assert.deepEqual(store.search.match('blue reds').map((p) => p.sku), [], 'every word must match');
  const r = await store.search.query('blue');
  assert.deepEqual([r.status, r.skus, r.matched], ['sorted', ['B1', 'A3'], 2]);
  assert.equal(r.label, '⟦leansWithⓃ⟧ · ⟦leanSynthetic⟧', 'the regional label, from the labels, the region named by the panel');
  const ev = h.calls.find((c) => c.door === 'send' && c.data.event === 'search');
  assert.deepEqual(ev.data, { event: 'search', control: 'search', query: 'blue', results: 2 });
  const sortCall = h.calls.find((c) => c.path === '/sort');
  assert.deepEqual(sortCall.body.weights, { affinity: 1, dims: { colour: 1 } }, 'a published "search" rail\'s weights');
});

test('filters come from the attribute map (each attribute with two values or more), with price bands, in stock and on sale; variants from sibling rows and a row\'s own configurations', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  const groups = store.filters.groups(PRODUCTS);
  assert.deepEqual(groups.map((g) => g.key), ['category', 'colour', 'size', 'price', 'show']);
  assert.deepEqual(groups.find((g) => g.key === 'colour').values.map((v) => [v.value, v.count]), [['red', 2], ['blue', 2], ['green', 1]]);
  assert.deepEqual(groups.find((g) => g.key === 'show').values.map((v) => v.value), ['in-stock', 'on-sale']);
  assert.ok(groups.find((g) => g.key === 'price').values.every((v) => /^⟦(under|andUp|range)/.test(v.label)), 'price bands are labelled by the labels');
  assert.deepEqual(store.filters.apply(PRODUCTS, { colour: new Set(['red', 'blue']), show: new Set(['in-stock']) }).map((p) => p.sku), ['A1', 'A2', 'B1'], 'one value in a group, every group');
  assert.deepEqual(store.filters.apply(PRODUCTS, { show: new Set(['on-sale']) }).map((p) => p.sku), ['A1', 'B1']);
  const v = store.variants.of(PRODUCTS[0]);
  assert.deepEqual(v.map((x) => [x.kind, x.label, x.options.map((o) => `${o.id}${o.on ? '*' : ''}`)]), [['sibling', '⟪size⟫', ['A1*', 'A2']]], 'the rows sharing the family and the colour, by size');
  const c = store.variants.of(PRODUCTS[3], { config: '58' });
  assert.deepEqual(c.map((x) => [x.kind, x.options.map((o) => `${o.id}:${o.price}${o.on ? '*' : ''}`)]), [['config', ['50:900', '58:950*']]], 'the row\'s own configurations, each with its price');
  const none = await createStore();
  none.bind({ ...harness().host });
  const site = await none.sort.ask(PRODUCTS);
  assert.deepEqual([site.status, site.order], ['site', ['A1', 'A2', 'A3', 'B1', 'B2']], 'no visitor: the site\'s own order, and why');
  assert.equal(site.why, '⟦sortNoVisitor⟧');
});

// ── Where to buy ──────────────────────────────────────────────────────────────────────────────────────────────
test('where to buy: buying here first, then the pickup partners, the online sellers and the nearby stores; each button its named outcome, credited to the decided module on screen', async () => {
  const h = harness();
  const { createStore } = await load();
  const store = createStore();
  store.bind(h.host);
  await store.visitor.ensure();
  h.state.sets.home = { decisions: [{ customerContentId: 'wtb', decisionId: 'd-9', contentId: 'c-9', slot: 'pdp-modules' }] };
  await store.retailers.open('A1');
  const html = h.sheetsOpened.at(-1).html;
  const order = ['store-retailer-buy', 'store-pickup', 'data-retailer="r1"', 'data-retailer="r3"'].map((x) => html.indexOf(x));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), 'buy here, the pickup partner, online, nearby');
  assert.ok(html.includes('⟦outcomeCredited⟧'), 'it says the outcome is credited to the decision that earned it');
  const opened = h.calls.find((c) => c.door === 'send' && c.data.event === 'find_a_retailer');
  assert.equal(opened.data.productId, 'A1');
  await store.control({ dataset: { act: 'store-referral', sku: 'A1', retailer: 'r1', retailerName: '⟪r1⟫', where: 'online' } });
  await store.control({ dataset: { act: 'store-pickup', sku: 'A1', retailer: 'r2', retailerName: '⟪r2⟫' } });
  const outcomes = h.calls.filter((c) => c.door === 'send' && ['retailer_referral', 'partner_pickup'].includes(c.data.event));
  assert.deepEqual(outcomes.map((o) => [o.data.event, o.data.decisionId, o.data.slot, o.data.partner || o.data.retailer]), [['retailer_referral', 'd-9', 'pdp-modules', 'r1'], ['partner_pickup', 'd-9', 'pdp-modules', 'r2']]);
});
