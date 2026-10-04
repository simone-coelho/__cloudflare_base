/* public/@@SLUG@@/@@SLUG@@.js
 * @@NAME@@ on the demo kit: the vertical layer, AS SCAFFOLDED by scripts/demo-kit/new-demo.mjs from
 * public/@@SLUG@@/demo.config.json. The page lanes own it from here.
 *
 * THE RULES THIS FILE EXISTS TO KEEP (docs/demos/BOOTSTRAP.md section 0).
 * 1. THE PAGE NEVER RANKS. It sends events and asks questions, and renders what comes back in the order it
 *    comes back. When the engine cannot answer, the page says so and keeps what was on screen. Before anyone is
 *    decided for, it renders the published template (the opening documents' pins, then the catalog's own order).
 *    A visitor's own sort (price, rating) is hers, and labelled so.
 * 2. THE CAUSE IS VISIBLE. A beat moves the cursor to a real control and runs that control's own handler. A hand
 *    on the page runs the same handler and sends the same event.
 * 3. THE BUY BOX IS OFF LIMITS. Price, sizes, add-ons, Add to Cart and the financing line are the catalog's,
 *    identical for everyone, and every one of them works. "Off limits" means the engine never decides it.
 * 4. NO CREDENTIAL IN THE PAGE. Merchandiser beats are applied BY NAME by the worker (src/routes/@@SLUG@@.ts).
 *
 * What the scaffold gives (a working store, lane K5), and what it leaves to the page lanes:
 *   the store       public/demo-kit/store.js, bound below: the cart (the kit's sheet), navigation and the browser's
 *                   Back, the manual events and the re-ask, search, where to buy, the sign-in sheet, the toast; plus
 *                   the published template, the filters, the variants and POST /sort. The boot page mints no
 *                   visitor: the first click on the site (or the director's first press) does.
 *   the renderers   a neutral store restyled by tokens: the homepage in the slots' template order (a hero, the
 *                   service strip, the category tiles, the decided modules, the product rails), the grids with
 *                   filters and a sort control, search results, the product page's anatomy with a functional buy
 *                   box, the footer. Every visible word is SITE.labels' (demo.config.json labels over the kit's).
 *   the lanes       LANES: each page lane registers its own renderers, questions, routes, controls and verbs there,
 *                   in its own section below (one writer per section); the scaffold's are the defaults.
 *   the facts       a SKELETON naming every path public/@@SLUG@@/beats.json reads, so the director's template
 *                   validation passes at load; each value is the page's own reading of its documents and state.
 *   the verbs       arrive (beat 1's arrival: the stranger minted from the landing, her region from the request)
 *                   and notBuilt (a beat whose presses are still its lane's to write says so and stops).
 *   the chassis     the kit's (public/demo-kit/, wired by createDemo below): transport, director (docked as
 *                   demo.config.json's director says), panels, before/now rows, predict-then-prove, sheets, Compare.
 */
import { createDemo, util } from '/demo-kit/kit.js';
import { store } from '/demo-kit/store.js';

(() => {
  'use strict';

  const { esc, arr, money, fmt3, focusOn, scrollTop } = util;

  /** Written by the scaffold from demo.config.json: the names this page reads. */
  const SITE = @@SITE@@;
  const BASE = SITE.base;
  const STORE = SITE.store;
  /** The page's words (demo.config.json labels over the kit's neutral defaults): every label this page shows. */
  const T = (key, vars = {}) => String(SITE.labels[key] ?? key).replace(/\{([a-z]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const PAGES = Object.fromEntries(SITE.pages.map((p) => [p.key, p.page]));
  const pageOf = (key) => SITE.pages.find((p) => p.key === key) || null;
  const own = (key) => { const p = pageOf(key); return p && p.slotsOf ? pageOf(p.slotsOf) : p; };
  const slotsOf = (key) => (own(key) ? own(key).slots : []);
  const railsOf = (key) => (own(key) ? own(key).sorted : []);
  const ENTRY = document.body.dataset.entry || 'home';
  const homeKey = () => (ENTRY === 'phone' && SITE.entries.phone ? SITE.entries.phone : SITE.entries.home);
  const productKey = () => SITE.entries.product;
  const roomOf = (key) => STORE.categories.find((c) => c.key === key) || null;
  /** The region keys' names, for the panel and the beats' sentences (US states and DC). */
  const US = { 'US-AL': 'Alabama', 'US-AK': 'Alaska', 'US-AZ': 'Arizona', 'US-AR': 'Arkansas', 'US-CA': 'California', 'US-CO': 'Colorado', 'US-CT': 'Connecticut',
    'US-DE': 'Delaware', 'US-DC': 'District of Columbia', 'US-FL': 'Florida', 'US-GA': 'Georgia', 'US-HI': 'Hawaii', 'US-ID': 'Idaho', 'US-IL': 'Illinois', 'US-IN': 'Indiana',
    'US-IA': 'Iowa', 'US-KS': 'Kansas', 'US-KY': 'Kentucky', 'US-LA': 'Louisiana', 'US-ME': 'Maine', 'US-MD': 'Maryland', 'US-MA': 'Massachusetts', 'US-MI': 'Michigan',
    'US-MN': 'Minnesota', 'US-MS': 'Mississippi', 'US-MO': 'Missouri', 'US-MT': 'Montana', 'US-NE': 'Nebraska', 'US-NV': 'Nevada', 'US-NH': 'New Hampshire', 'US-NJ': 'New Jersey',
    'US-NM': 'New Mexico', 'US-NY': 'New York', 'US-NC': 'North Carolina', 'US-ND': 'North Dakota', 'US-OH': 'Ohio', 'US-OK': 'Oklahoma', 'US-OR': 'Oregon', 'US-PA': 'Pennsylvania',
    'US-RI': 'Rhode Island', 'US-SC': 'South Carolina', 'US-SD': 'South Dakota', 'US-TN': 'Tennessee', 'US-TX': 'Texas', 'US-UT': 'Utah', 'US-VT': 'Vermont', 'US-VA': 'Virginia',
    'US-WA': 'Washington', 'US-WV': 'West Virginia', 'US-WI': 'Wisconsin', 'US-WY': 'Wyoming' };

  // ── The lanes' registry: each page lane adds its own here, in its own section, never another's ───────────────
  //    render[slot](slot, decisions) a slot's own renderer;  ask[pageKey](key) a page's own question;
  //    routes[name](route, opts) the store's navigation calls it for home, grid { view }, product { id }, search { q },
  //    phone (opts.event === false: a restore from the browser's Back); controls: [fn(t) → true | false | undefined];
  //    verbs, facts, rows, hooks; beforeBeat: [fn(b)]; compareTools; boot: [fn()] after the documents are in.
  const LANES = { render: {}, ask: {}, verbs: {}, rows: {}, facts: {}, controls: [], compareTools: [], beforeBeat: [], boot: [], hooks: {}, routes: {} };

  // ════════════════════════════════════════════════════════════════════════
  // THE KIT. Every hook below answers a question the chassis asks; the module
  // headers in public/demo-kit/ name each one.
  // ════════════════════════════════════════════════════════════════════════
  const demo = createDemo({
    tenant: SITE.tenant, api: SITE.api, pageNames: PAGES, slots: {}, dimLabels: SITE.dimLabels, source: SITE.source, docBase: BASE,
    debugName: '@@DEBUG@@', intents: SITE.intents, roadmap: SITE.roadmap,
    // The director docked (demo.config.json director): beside the site, collapsed to a slim rail until the presenter's
    // key (D) or ?present=1 opens it; 'bottom' keeps the kit's own bar under the site.
    ...(SITE.director.dock === 'right' ? { dock: { collapsed: SITE.director.collapsed } } : {}),
    state: { view: null, viewPage: null, productId: null, room: null, query: null, sets: {}, pieces: new Map(), display: new Map(), catalogPieces: [], openSlots: null,
      engine: null, products: [], productById: new Map(), anchor: {}, grids: {}, rails: {}, sel: { config: null, addOns: new Set() } },
    // The transport: her own fields on a new visitor; nothing asserted as her intent until she or the presenter says so.
    visitor: () => ({ cart: 0 }),
    defaultIntent: () => null,
    // What a product page asserts about its product (products.pageContext: ctx.<name> = the row's field), on every ask.
    context: (pageKey) => ((pageOf(pageKey) || {}).entry === 'product' ? productContext(productOf(state.productId)) : null),
    beatName: (key, kind) => (((state.anchor.beats || {})[key] || {})[kind]) || null,
    // The director: the one dispatcher, the router, the facts the beats read, the pages and verbs they drive.
    control: (t) => handleControl(t),
    restore: () => store.nav.restore(),
    view: () => state.view,
    facts: () => facts(),
    pages: Object.fromEntries(SITE.pages.map((p) => [p.key, { open: (o) => openPage(p.key, o || {}), refresh: () => askPage(p.key) }])),
    verbs: Object.assign(LANES.verbs, { arrive: () => arrive(), notBuilt: (args) => notBuilt(args) }),
    beforeBeat: (b) => LANES.beforeBeat.forEach((f) => f(b)),
    compareTools: LANES.compareTools,
    publishing: async (kind, name) => { if (kind === 'catalog') await useCatalog(name); },
    published: async (kind) => { if (kind === 'reset') await useCatalog('open-catalog'); },
    beatFailed: (m) => engineDown(m),
    assertRegions: () => [null, ...contrastList(), ...(flags.region && !contrastList().includes(flags.region) ? [flags.region] : [])],
    // The panels: the set on screen, the registry's memory, names, Why these, the report.
    currentSet: () => state.sets[state.viewPage] || null,
    memoryDims: () => (((state.anchor.registry || {}).memory || {}).dimensions || []),
    regionName: (key) => US[key] || null,
    coldStart: { seeded: SITE.regionDims.join(', '), salesOf: SITE.copy.salesOf || 'the brand’s' },
    why: () => whyGroups(),
    titleOf: (d) => titleOf(d),
    report: { slots: () => SITE.reportSlots, labels: () => ({}), row: (slot, id) => ({ key: id, title: titleOfCid(id) }) },
    // The before/now rows are the page lanes' (deltas.js reads config.rows()); the scaffold has none.
    rows: () => LANES.rows,
    compare: { root: '#site', ignore: '.machine, .director, .dock-rail, .pd-back, .sheet-back, .pd-pill, #demo-cursor, .back-chip, .fixture-flag, .skip, .st-toast, #site > .stage > .view[hidden]',
      foot: 'Same page, same catalog and the same public prices. Only what each moment knew about the shopper is different.', where: () => whereNow(), snapshot: () => snapshotOfPage() },
  });
  const { state, flags, transport, panels, director, sheets } = demo;
  const $ = (id) => document.getElementById(id);
  const say = (t, tone) => director.say(t, tone);

  // ── The products, as the products map names their fields ──────────────────
  /** A product's field by its path in the row (attributes.category), as the products map names it. */
  const field = (p, path) => String(path || '').split('.').reduce((v, k) => (v == null ? undefined : v[k]), p);
  const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
  const idOf = (p) => String(field(p, SITE.products.id));
  const productOf = (id) => state.productById.get(String(id)) || null;
  const productName = (p) => (p && (field(p, SITE.products.name) || idOf(p))) || null;
  const priceOf = (p) => (p ? num(field(p, SITE.products.attributes.price_usd || 'price')) : null);
  const listOf = (p) => (p ? num(field(p, STORE.fields.listPrice)) : null);
  const imageOf = (p) => (p ? field(p, SITE.products.image) || null : null);
  const categoryOf = (p) => field(p, SITE.products.category);
  const ratingOf = (p) => num(field(p, STORE.fields.rating));
  const reviewsOf = (p) => num(field(p, STORE.fields.reviews));
  const inStock = (p) => field(p, STORE.fields.inStock) !== false;
  /** The overlay another lane writes (specs.json), merged over each row by id: its top-level fields replace the row's. */
  function mergeOverlay(rows, doc) {
    if (!doc) return rows;
    const by = SITE.products.overlay.by;
    const list = Array.isArray(doc) ? doc : [doc[SITE.products.list], doc.specs, doc.rows].find(Array.isArray);
    const keyed = list ? Object.fromEntries(list.filter((r) => r && typeof r === 'object').map((r) => [String(r[by]), r]))
      : [doc.specs, doc.bySku].find((x) => x && typeof x === 'object' && !Array.isArray(x)) || {};
    return rows.map((p) => (keyed[idOf(p)] ? { ...p, ...keyed[idOf(p)] } : p));
  }
  /** The attributes an event about a product carries, exactly as the products file holds them (the seed checks the same map). */
  function productAttrs(p, extra) {
    const out = { productId: idOf(p) };
    for (const [attr, path] of Object.entries(SITE.products.attributes)) { const v = field(p, path); if (v !== undefined && v !== null) out[attr] = v; }
    return { ...out, ...(extra || {}) };
  }
  /** A value as the site says it: the vocabulary's own word, dashes as spaces, the first letter up. */
  const words = (v) => String(v == null ? '' : v).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

  // ── The store, bound once: the kit, the feed's readers and the shared openers, read lazily ─────────
  store.bind({
    demo, site: SITE, lanes: LANES, base: BASE,
    productOf: (id) => productOf(id), productAttrs: (p, extra) => productAttrs(p, extra), idOf: (p) => idOf(p), productName: (p) => productName(p),
    priceOf: (p) => priceOf(p), imageOf: (p) => imageOf(p), field: (p, path) => field(p, path), products: () => state.products,
    openPage: (key, opts) => openPage(key, opts), openProduct: (id, opts) => openProduct(id, opts), askPage: (key) => askPage(key),
    homeKey: () => homeKey(), pageOf: (key) => pageOf(key), phoneKey: () => SITE.entries.phone || homeKey(),
    // The kit's own hooks: the list price, the catalog's pieces with their page fields, what the buy box has chosen.
    listPriceOf: (p) => listOf(p), pieces: () => state.catalogPieces,
    selection: (sku) => (String(sku) === String(state.productId) ? selectionNow(productOf(sku)) : null),
  });

  // ── The catalog the page names its pieces from: the document in force ─────
  async function useCatalog(name) {
    const doc = transport.unwrap(await transport.tryJson(`${BASE}beats/${name}.json`));
    if (doc && Array.isArray(doc.pieces)) { state.engine = doc; state.pieces = new Map(doc.pieces.map((p) => [p.customerContentId, p])); }
  }
  const pieceOf = (d) => state.pieces.get(d.customerContentId) || null;
  const displayOf = (cid) => state.display.get(cid) || {};
  const titleOfCid = (cid) => { const p = state.pieces.get(cid); return (p && p.title) || cid; };
  const titleOf = (d) => titleOfCid(d.customerContentId);

  // ── Views and the address bar ─────────────────────────────────────────────
  function showView(key) {
    const view = own(key) ? own(key).key : key;
    for (const sec of document.querySelectorAll('#stage > .view')) sec.hidden = sec.dataset.page !== view;
    state.view = key === 'room' ? 'grid' : key === 'search' ? 'search' : (pageOf(key) || {}).entry || null;
    state.viewPage = key;
    sheets.dismiss();
  }
  function urlOf(key, opts) {
    if (key === 'room') return `${BASE}?view=${encodeURIComponent(opts.room || state.room || '')}`;
    if (key === 'search') return `${BASE}?q=${encodeURIComponent(opts.q ?? state.query ?? '')}`;
    const p = pageOf(key);
    if (!p) return BASE;
    if (p.entry === 'product') return `${BASE}product?id=${encodeURIComponent(opts.id || state.productId || '')}`;
    if (p.entry === 'grid') return `${BASE}?view=${encodeURIComponent(key)}`;
    return p.entry === 'phone' ? `${BASE}m` : BASE;
  }
  const keep = () => { const q = new URLSearchParams(location.search); const out = new URLSearchParams(); for (const k of ['debug', 'fixtures', 'region', 'metro', 'wait', 'present']) if (q.has(k)) out.set(k, q.get(k)); return out; };
  /** The address bar follows the view, except on a restore from the browser's Back (opts.event === false), which is already there. */
  function route(path, opts = {}) {
    if (opts.event === false || opts.restore) return;
    const extra = keep().toString();
    try { history.pushState({ [SITE.slug]: true }, '', extra ? `${path}${path.includes('?') ? '&' : '?'}${extra}` : path); } catch { /* sandboxed */ }
  }
  const whereNow = () => {
    if (state.viewPage === 'room') return `${(roomOf(state.room) || {}).label || 'category'} grid`;
    if (state.viewPage === 'search') return 'search results';
    const p = pageOf(state.viewPage);
    return p ? (p.entry === 'product' ? `${productName(productOf(state.productId)) || 'product'} page` : `${p.key} page`) : 'page';
  };

  // ════════════════════════════════════════════════════════════════════════
  // THE RENDERERS: a neutral store, restyled by tokens. Plain markup in the
  // order the answer gave (or the template's, before anyone is decided for);
  // the page lanes replace each one with the vertical's own (LANES.render).
  // ════════════════════════════════════════════════════════════════════════
  const stars = (r) => { const n = Math.round(Math.max(0, Math.min(5, r))); return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`; };
  function ratingLine(p) {
    const r = ratingOf(p), n = reviewsOf(p);
    return r !== null ? `<span class="rating" aria-label="${r} / 5, ${n || 0}"><span class="stars" aria-hidden="true">${stars(r)}</span> ${r.toFixed(1)}${n !== null ? ` <span class="rcount">(${n.toLocaleString('en-US')})</span>` : ''}</span>` : '';
  }
  function priceBlock(p, price = priceOf(p)) {
    if (price === null) return '';
    const list = listOf(p);
    const off = list !== null && list > price ? list - price : 0;
    return `<span class="pprice">${money(price)}</span>${off ? `<span class="poff">${money(off).replace(/\.00$/, '')} OFF</span><s class="plist">${money(list)}</s>` : ''}`;
  }
  /** An image, eager unless asked (a grid's later cards load lazily); one that cannot load becomes its name (the store's own fallback). */
  function imgTag(src, alt, size, lazy = false) {
    return src ? `<img src="${esc(src)}" alt="${esc(alt || '')}"${lazy ? ' loading="lazy"' : ''} data-store-name="${esc(alt || '')}"${size ? ` width="${size}" height="${size}"` : ''}>` : '<span class="noimg" aria-hidden="true"></span>';
  }
  /** A product card: image, name, stars and reviews, the sale price, $X OFF and the struck list price, and a primary button. */
  function productCard(p, i = 0) {
    const id = idOf(p);
    const badges = arr(field(p, STORE.fields.badges)).slice(0, 2);
    return `<article class="pcard" data-open="${esc(id)}" data-ctl="open-${esc(id)}" data-pid="${esc(id)}">
      <span class="pimg">${imgTag(imageOf(p), productName(p), null, i >= 8)}${badges.length ? `<span class="pbadges">${badges.map((b) => `<i>${esc(b)}</i>`).join('')}</span>` : ''}</span>
      <span class="pname">${esc(productName(p))}</span>${ratingLine(p)}<span class="pprices">${priceBlock(p)}</span>
      ${inStock(p) && priceOf(p) !== null ? `<button type="button" class="btn btn--brand btn--sm" data-act="store-add" data-sku="${esc(id)}" data-ctl="add-${esc(id)}">${esc(T('addToCart'))}</button>` : `<span class="pout">${esc(T('outOfStock'))}</span>`}</article>`;
  }
  /** Where a piece goes when it is pressed: the room its tile names, the product it features, else nowhere. */
  function pieceTarget(cid, piece) {
    const disp = displayOf(cid);
    const room = disp.room ? roomOf(disp.room) : arr(disp.categories).length ? STORE.categories.find((c) => c.categories.some((x) => arr(disp.categories).includes(x))) : null;
    if (room) return { nav: room.page || room.key };
    const sku = arr(piece && piece.featuredProductIds)[0] || disp.imageSku;
    return sku && productOf(sku) ? { id: sku } : null;
  }
  const pieceImage = (cid, piece) => { const d = displayOf(cid); return d.image || imageOf(productOf(d.imageSku || arr(piece && piece.featuredProductIds)[0])) || null; };
  /**
   * A piece, as its slot's kind draws it: a hero banner, a tile, a deal card or a module card. A decided piece carries
   * its decision (data-op-*), so a click on it is the reward it is judged on; a template piece carries none.
   */
  function card(d, i, slot) {
    const cid = d.customerContentId;
    const p = pieceOf(d) || {};
    const disp = displayOf(cid);
    const kind = ($(`mod-${slot.slot}`) || { dataset: {} }).dataset.kind || p.type || 'piece';
    const target = pieceTarget(cid, p);
    const go = target ? (target.id ? ` data-go-id="${esc(target.id)}"` : ` data-go-nav="${esc(target.nav)}"`) : '';
    const decided = d.decisionId ? ` data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}" data-op-decision-id="${esc(d.decisionId)}"` : ' data-template="true"';
    const receipt = d.decisionId ? `<span class="receipt">${esc(d.strategy || 'engine')} &middot; score ${fmt3(d.score)}</span>` : '';
    const img = pieceImage(cid, p);
    const cta = disp.cta ? `<span class="btn ${kind === 'hero' ? 'btn--brand' : 'btn--line'} btn--sm">${esc(disp.cta)}</span>` : '';
    return `<article class="card card--${esc(kind)}" data-act="piece" data-ctl="piece-${esc(cid)}" data-cid="${esc(cid)}"${decided}${go}>
      ${img ? `<span class="cimg">${imgTag(img, p.title)}</span>` : ''}<span class="ctext"><span class="pos">${i + 1}</span><h3>${esc(p.title || cid)}</h3>${p.subtitle ? `<p>${esc(p.subtitle)}</p>` : ''}${cta}${receipt}</span></article>`;
  }
  function renderSlot(slot, decisions, how) {
    if (LANES.render[slot.slot]) return LANES.render[slot.slot](slot, decisions, how);   // the section's own renderer
    const box = $(`slot-${slot.slot}`), mod = $(`mod-${slot.slot}`);
    if (!box) return undefined;
    if (slot.gated && mod) mod.hidden = !decisions.length;     // a gated slot fails closed: nothing returned, nothing shown
    box.innerHTML = decisions.length ? decisions.map((d, i) => card(d, i, slot)).join('') : `<p class="slot-empty">${how === 'template' ? 'Nothing is published for this slot yet.' : `The engine returned nothing for ${esc(slot.slot)} on this request.`}</p>`;
    const h = $(`how-${slot.slot}`);
    if (h) h.textContent = how === 'template' ? 'the site’s own page: the published template' : 'decided for this visitor';
    return undefined;
  }
  function engineDown(message) {
    const node = document.querySelector('#stage > .view:not([hidden]) .engine-down');
    if (!node) return;
    node.hidden = false;
    node.textContent = `The page is keeping what it last showed: ${message}. Nothing here ranks in the browser, so there is nothing to show instead.`;
  }
  const engineUp = () => document.querySelectorAll('.engine-down').forEach((n) => { n.hidden = true; });

  /**
   * The published template, before anyone is decided for: each slot of the page from the opening documents (its
   * pins, then its pieces in the catalog's own order, to its take), rendered as the site's own page. No visitor is
   * minted and nothing is asked: the boot page is the site as a stranger sees it.
   */
  function renderTemplate(key) {
    const p = own(key);
    if (!p) return;
    const t = store.template.of(p.page, { catalog: state.engine, slots: state.openSlots, display: state.display, anchor: state.anchor.anchor });
    for (const s of slotsOf(key)) renderSlot(s, arr(t[s.slot]).map((piece) => ({ customerContentId: piece.customerContentId, slot: s.slot })), 'template');
    for (const rail of railsOf(key)) void sortAndPaint(rail);
  }

  // ── The question: one snapshot per page view; the page renders what it says ─
  async function askPage(key) {
    if (LANES.ask[key]) return LANES.ask[key](key);   // the section's own question for its page
    if (key === 'room' || key === 'search') return paintGrid(key);
    const v = transport.cur();
    if (!v) { renderTemplate(key); return true; }
    if (!slotsOf(key).length) { await refreshRails(key); return true; }
    const r = await transport.ask(key, v);
    if (!r.ok) { engineDown(r.error); say(r.error, 'bad'); await panels.renderVectors(); return false; }
    engineUp();
    state.sets[key] = r.set;
    for (const s of slotsOf(key)) renderSlot(s, transport.bySlot(r.set, s.slot), 'decided');
    await refreshRails(key);
    panels.renderWho();
    director.sayAfter();
    await panels.renderVectors();
    panels.renderWhy();
    void transport.prefetchReceipts(r.set.decisions, r.set.asked).then(() => { panels.renderWhy(); director.sayAfter(); });
    demo.compare.afterDecidedPaint(key);
    return true;
  }

  // ── home and grid (P1) ────────────────────────────────────────────────────
  // The homepage's sections, the rails, the grids with their filters and sort, the search results and the category
  // tiles. Lane P1 writes here (and the facts it owns); the scaffold's renderers are a neutral store.
  /** The /sort weights for a rail: its published weights over the registry's dimensions (a dimension it does not name weighs 0). */
  function weightsOf(rail) {
    const w = rail && rail.weights;
    if (!w) return { affinity: 1 };
    const zero = Object.fromEntries(arr((state.registry || {}).dimensions).map((d) => [d.key, 0]));
    return { affinity: 1, dims: { ...zero, ...w } };
  }
  const railConfig = (slot) => { for (const p of SITE.pages) for (const r of arr((own(p.key) || {}).sorted)) if (r.slot === slot) return r; return null; };
  /** A rail's candidates: the products of its category (or all), priced, in the products file's own order. */
  function railPool(rail) {
    const cats = rail.category ? [rail.category] : null;
    return state.products.filter((p) => priceOf(p) !== null && (!cats || cats.includes(categoryOf(p)))).slice(0, rail.pool || 60);
  }
  /** A rail: the engine's order for her through POST /sort, or the site's own order with the reason. */
  async function sortAndPaint(rail) {
    const box = $(`rail-${rail.slot}`);
    if (!box) return false;
    if (box.closest('.grid-wrap')) return paintGrid(rail.slot);
    const pool = railPool(rail);
    const answer = await store.sort.ask(pool, { weights: weightsOf(railConfig(rail.slot) || rail) });
    state.rails[rail.slot] = answer;
    const byId = new Map(pool.map((p) => [idOf(p), p]));
    box.innerHTML = answer.order.slice(0, rail.take || 8).map((id) => byId.get(id)).filter(Boolean).map((p, i) => productCard(p, i)).join('') || '<p class="slot-empty">No products yet: the products file is a placeholder.</p>';
    const chip = $(`chip-${rail.slot}`);
    if (chip) { chip.textContent = answer.status === 'sorted' ? `${T('bestMatch')} · POST /sort` : `the site’s own order · ${answer.why}`; chip.classList.toggle('chip-live', answer.status === 'sorted'); }
    paintLean(rail.slot, answer);
    return true;
  }
  function paintLean(key, answer) {
    const node = $(`lean-${key}`);
    if (!node) return;
    const text = answer ? answer.label || '' : '';
    node.textContent = text; node.hidden = !text;
  }
  async function refreshRails(key) {
    for (const rail of railsOf(key)) await sortAndPaint(rail);
    return true;
  }

  // ── The grids: a room's products, filtered by hand, sorted by the engine (Best match) or by her own choice ──
  const SORTS = [['best', 'bestMatch'], ['price-asc', 'priceLow'], ['price-desc', 'priceHigh'], ['rating', 'topRated']];
  const gridOf = (key) => (state.grids[key] ||= { chosen: {}, sort: 'best', answer: null, first: null });
  /** A grid's candidates: a room's categories, a grid page's rail, or the search's matches; priced, in the products file's order. */
  function gridPool(key) {
    if (key === 'search') return store.search.match(state.query || '').filter((p) => priceOf(p) !== null);
    const room = key === 'room' ? roomOf(state.room) : STORE.categories.find((c) => c.page && railsOf(c.page).some((r) => r.slot === key)) || null;
    const rail = key === 'room' ? null : railConfig(key);
    const cats = room ? room.categories : rail && rail.category ? [rail.category] : null;
    return state.products.filter((p) => priceOf(p) !== null && (!cats || cats.includes(categoryOf(p))));
  }
  /** Her own sort, when she picks one: by price or by rating, said on screen as hers. The engine's is Best match. */
  function ownSort(list, how) {
    const by = { 'price-asc': (a, b) => priceOf(a) - priceOf(b), 'price-desc': (a, b) => priceOf(b) - priceOf(a),
      rating: (a, b) => ((ratingOf(b) ?? -1) - (ratingOf(a) ?? -1)) || ((reviewsOf(b) ?? 0) - (reviewsOf(a) ?? 0)) }[how];
    return by ? list.slice().sort(by) : list;
  }
  async function paintGrid(key) {
    const box = $(`rail-${key}`);
    if (!box) return false;
    const g = gridOf(key);
    const pool = gridPool(key);
    const groups = store.filters.groups(pool, { labels: SITE.dimLabels, valueLabel: (k, v) => words(v) });
    const shown = store.filters.apply(pool, g.chosen);
    const filtered = Object.values(g.chosen).some((s) => s && s.size);
    let list = shown;
    if (g.sort === 'best') {
      const room = key === 'room' ? roomOf(state.room) : null;
      // The search's own answer stands while nothing narrows it; otherwise POST /sort over what she sees.
      g.answer = !filtered && g.first ? g.first : await store.sort.ask(shown, { weights: weightsOf(railConfig(key) || (room && room.weights ? { weights: room.weights } : null)) });
      const byId = new Map(shown.map((p) => [idOf(p), p]));
      list = g.answer.order.map((id) => byId.get(id)).filter(Boolean);
    } else { g.answer = null; list = ownSort(shown, g.sort); }
    const take = (railConfig(key) || {}).take || 48;
    box.innerHTML = list.slice(0, take).map((p, i) => productCard(p, i)).join('') || `<p class="slot-empty">${pool.length ? 'Nothing matches these filters.' : key === 'search' ? 'Nothing in the store matches that search.' : 'No products in this category yet.'}</p>`;
    const count = $(`count-${key}`);
    if (count) count.innerHTML = `<b>${shown.length}</b> ${esc(T(shown.length === 1 ? 'result' : 'results'))}${shown.length > take ? ` &middot; ${take} shown` : ''} &middot; <span class="how">${g.sort === 'best' ? (g.answer && g.answer.status === 'sorted' ? `${esc(T('bestMatch'))}: ${esc(T('sortDecided'))}` : `the site’s own order (${esc((g.answer || {}).why || T('sortNoVisitor'))})`) : 'sorted as she chose: not personalised'}</span>`;
    const sortBox = $(`sort-${key}`);
    if (sortBox) sortBox.innerHTML = SORTS.map(([k, label]) => `<button type="button" data-act="sort" data-grid="${key}" data-sort="${k}" data-ctl="sort-${k}" aria-pressed="${g.sort === k}">${esc(T(label))}</button>`).join('');
    const fbox = $(`filters-${key}`);
    if (fbox) fbox.innerHTML = groups.length ? `<p class="fhead">${esc(T('filter'))}${filtered ? ` <button type="button" class="fclear" data-act="filter-clear" data-grid="${key}" data-ctl="filter-clear">${esc(T('clearAll'))}</button>` : ''}</p>${groups.map((gr) => `<fieldset class="fgroup"><legend>${esc(gr.label)}</legend>${gr.values.map((v) => {
      const on = Boolean(g.chosen[gr.key] && g.chosen[gr.key].has(v.value));
      return `<button type="button" class="fval" data-act="filter" data-grid="${key}" data-key="${esc(gr.key)}" data-value="${esc(v.value)}" data-ctl="filter-${esc(gr.key)}-${esc(v.value)}" aria-pressed="${on}"><span>${esc(v.label)}</span><i>${v.count}</i></button>`;
    }).join('')}</fieldset>`).join('')}` : '';
    paintLean(key, g.answer);
    return true;
  }
  /** The tiles' images: the configured image, else the room's first pictured product. */
  function paintTiles() {
    for (const node of document.querySelectorAll('[data-room-img]')) {
      const room = roomOf(node.dataset.roomImg);
      const src = node.dataset.src || imageOf(state.products.find((p) => room && room.categories.includes(categoryOf(p)) && imageOf(p)));
      node.innerHTML = src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '';
    }
  }
  async function openPage(key, opts = {}) {
    const p = pageOf(key);
    if (!p) throw new Error(`no page named "${key}"`);
    if (p.entry === 'product') return openProduct(opts.id || state.productId, opts);
    await store.visitor.ensure();
    showView(key);
    route(urlOf(key, opts), opts);
    if (opts.event !== false) {
      await store.events.send('page_view', { page: p.page }, { note: opts.quiet ? false : ['viewed', `The ${p.label || p.key} page`, 'asked again'] });
    }
    await askPage(key);
    if (opts.focus) focusOn($(`mod-${opts.focus}`)); else scrollTop();
    return true;
  }
  /** A room of the store without a grid page of its own: its categories' products, filtered and sorted. */
  async function openRoom(key, opts = {}) {
    const room = roomOf(key);
    if (!room) throw new Error(`no category named "${key}"`);
    if (room.page) return openPage(room.page, opts);
    await store.visitor.ensure();
    if (state.room !== key) state.grids.room = null;
    state.room = key;
    showView('room');
    $('roomTitle').textContent = room.label; $('roomCrumb').textContent = room.label;
    route(urlOf('room', { room: key }), opts);
    if (opts.event !== false) await store.events.send('page_view', { page: key }, { note: ['viewed', room.label, 'a category grid: the engine orders it (Best match)'] });
    await paintGrid('room');
    scrollTop();
    return true;
  }
  /** The search results: the feed by name, id and type, in the engine's order for her (Best match), with the search event. */
  async function openSearch(q, opts = {}) {
    await store.visitor.ensure();
    state.query = q;
    state.grids.search = null;
    showView('search');
    const input = document.querySelector('form[data-store-search] input[name="q"]'); if (input && input.value !== q) input.value = q;
    $('searchTitle').textContent = T('searchResults', { query: q });
    route(urlOf('search', { q }), opts);
    const res = await store.search.query(q, { event: opts.event });
    gridOf('search').first = { status: res.status === 'sorted' ? 'sorted' : 'site', why: res.error || T('sortDecided'), order: res.skus, items: res.items, regional: res.regional, label: res.label };
    await paintGrid('search');
    scrollTop();
    return true;
  }
  // The store's routes for this page: a grid is a grid page or a room; search is the results view.
  LANES.routes.grid = (r, opts = {}) => (pageOf(r.view) ? openPage(r.view, opts) : roomOf(r.view) ? openRoom(r.view, opts) : (store.ui.toast(T('notOnPage', { view: r.view }), 'bad'), openPage(homeKey(), opts)));
  LANES.routes.search = (r, opts = {}) => openSearch((r && r.q) || '', opts);

  // ── product pages (P2) ────────────────────────────────────────────────────
  // The buy box (off limits: never decided, and every control in it works) and the decided modules below it.
  // Lane P2 writes here (and the facts it owns).
  /** What a product page asserts about its product, as the config's products.pageContext maps it. */
  function productContext(p) {
    if (!p) return null;
    const out = {};
    for (const [name, path] of Object.entries(SITE.products.pageContext || {})) { const v = field(p, path); if (v !== undefined && v !== null && v !== '') out[name] = String(v); }
    return out;
  }
  const addOnsFor = (p) => STORE.addOns.filter((a) => !a.categories || a.categories.includes(categoryOf(p)));
  /** The buy box's choices for the product on screen, as the store's cart takes them: its configuration and the add-ons ticked. */
  function selectionNow(p) {
    if (!p) return {};
    const vs = store.variants.of(p, { config: state.sel.config });
    const configs = vs.find((v) => v.kind === 'config');
    const chosen = configs ? configs.options.find((o) => o.on) : null;
    const options = Object.fromEntries(vs.filter((v) => v.kind === 'sibling').map((v) => [v.label, (v.options.find((o) => o.on) || {}).label]).filter(([, x]) => x));
    if (chosen) options[configs.label] = chosen.label;
    return { options, addOns: addOnsFor(p).filter((a) => state.sel.addOns.has(a.key)).map((a) => ({ id: a.key, label: a.label, price: a.price })),
      ...(chosen && Number.isFinite(chosen.price) && chosen.price > 0 ? { unitPrice: chosen.price } : {}) };
  }
  /** The buy box: the catalog's own facts, the same for everyone, and controls that work. */
  function renderBuyBox(p) {
    if (!$('bbTitle')) return;
    if (!p) { $('bbTitle').textContent = 'This product is not in the catalog'; return; }
    const sel = selectionNow(p);
    const price = sel.unitPrice ?? priceOf(p);
    const gallery = [imageOf(p), ...arr(field(p, STORE.fields.gallery))].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
    $('bbImage').innerHTML = imgTag(gallery[0], productName(p));
    $('bbThumbs').innerHTML = gallery.length > 1 ? gallery.slice(0, 6).map((src, i) => `<button type="button" data-act="thumb" data-src="${esc(src)}" data-ctl="thumb-${i}" aria-label="${i + 1}">${imgTag(src, '', 56)}</button>`).join('') : '';
    $('bbBadges').innerHTML = arr(field(p, STORE.fields.badges)).map((b) => `<i>${esc(b)}</i>`).join('');
    $('bbTitle').textContent = productName(p);
    $('bbMeta').innerHTML = `<span>${esc(T('model'))} ${esc(idOf(p))}</span>${ratingLine(p)}`;
    $('bbPrice').innerHTML = priceBlock(p, price);
    const fin = $('bbFinancing'); fin.hidden = !STORE.financing; fin.textContent = STORE.financing || '';
    const del = $('bbDelivery');
    const where = state.own && state.own.label ? state.own.label : null;
    del.hidden = !(STORE.delivery || where);
    del.textContent = [STORE.delivery, where ? `${where}, from the request` : null].filter(Boolean).join(' · ');
    const vs = store.variants.of(p, { config: state.sel.config, valueLabel: (k, v) => words(v) });
    $('bbOpts').innerHTML = vs.map((v) => `<div class="bb-opt"><p class="bb-label">${esc(v.label)}</p><div class="bb-chips">${v.options.map((o) => v.kind === 'sibling'
      ? `<button type="button" data-act="variant" data-id="${esc(o.id)}" data-ctl="variant-${esc(o.id)}" aria-pressed="${o.on}">${esc(o.label)}${o.price !== null && o.price !== undefined ? `<i>${money(o.price)}</i>` : ''}</button>`
      : `<button type="button" data-act="config" data-config="${esc(o.id)}" data-ctl="config-${esc(o.id)}" aria-pressed="${o.on}">${esc(o.label)}${Number.isFinite(o.price) ? `<i>${money(o.price)}</i>` : ''}</button>`).join('')}</div></div>`).join('');
    const addOns = addOnsFor(p);
    $('bbAddons').innerHTML = addOns.length ? `<p class="bb-label">${esc(T('addOns'))}</p>${addOns.map((a) => `<button type="button" class="bb-addon" data-act="addon" data-key="${esc(a.key)}" data-ctl="addon-${esc(a.key)}" aria-pressed="${state.sel.addOns.has(a.key)}"><span>${esc(a.label)}</span><b>${money(a.price)}</b></button>`).join('')}` : '';
    const total = (price || 0) + sel.addOns.reduce((s, a) => s + (a.price || 0), 0);
    const opted = Object.entries(sel.options).map(([k, v]) => `${k}: ${v}`).join(' · ');
    $('bbReview').innerHTML = sel.addOns.length ? `<p class="bb-label">${esc(T('review'))}</p><ul><li><span>${esc(productName(p))}${opted ? ` · ${esc(opted)}` : ''}</span><b>${money(price)}</b></li>${sel.addOns.map((a) => `<li><span>${esc(a.label)}</span><b>${money(a.price)}</b></li>`).join('')}<li class="tot"><span>${esc(T('total'))}</span><b>${money(total)}</b></li></ul>` : '';
    const add = $('bbAdd');
    add.disabled = !inStock(p) || priceOf(p) === null;
    add.textContent = add.disabled ? T('outOfStock') : T('addToCart');
    add.dataset.sku = idOf(p);
    const retail = $('bbRetail');
    retail.dataset.sku = idOf(p);
    const cat = categoryOf(p), room = STORE.categories.find((c) => c.categories.includes(cat));
    const crumbs = $(`crumbs-${productKey()}`);
    if (crumbs) crumbs.innerHTML = `<a data-nav="home" data-ctl="crumb-home" href="${BASE}">Home</a><span>/</span>${room ? `<a data-nav="${esc(room.page || room.key)}" data-ctl="crumb-room" href="${BASE}?view=${esc(room.page || room.key)}">${esc(room.label)}</a><span>/</span>` : ''}<span>${esc(productName(p))}</span>`;
    renderSpecs(p);
  }
  /** Specs from the row's own fields (the attribute map and the specs field), and reviews from its rating and count: nothing invented. */
  function renderSpecs(p) {
    const rows = [];
    for (const [attr, path] of Object.entries(SITE.products.attributes)) {
      if (/price/i.test(attr)) continue;
      const v = field(p, path);
      if (v !== undefined && v !== null && v !== '') rows.push([words(SITE.dimLabels[attr] || attr), arr(v).map(words).join(', ')]);
    }
    const specs = field(p, STORE.fields.specs);
    if (specs && typeof specs === 'object') for (const [k, v] of Object.entries(specs)) if (v !== null && v !== undefined && typeof v !== 'object') rows.push([words(k), String(v)]);
    const old = $('pdpDesc'); if (old) old.remove();
    if ($('specsList')) $('specsList').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') || '<div><dt>—</dt><dd>—</dd></div>';
    const desc = field(p, STORE.fields.description);
    if (desc && $('specsList')) $('specsList').insertAdjacentHTML('beforebegin', `<p class="pdesc" id="pdpDesc">${esc(desc)}</p>`);
    const r = ratingOf(p), n = reviewsOf(p);
    if ($('reviewsBody')) $('reviewsBody').innerHTML = r !== null ? `<p class="rbig"><b>${r.toFixed(1)}</b> / 5 <span class="stars">${stars(r)}</span></p><p class="rnote">${n !== null ? `${n.toLocaleString('en-US')} · ` : ''}as the product feed lists them; the reviews themselves are not reproduced here.</p>` : '<p class="rnote">No rating is listed for this product yet.</p>';
  }
  async function openProduct(id, opts = {}) {
    const key = productKey();
    if (!key) throw new Error('the demo config names no product page');
    const p = productOf(id) || state.products[0] || null;
    await store.visitor.ensure();
    if (!p || idOf(p) !== state.productId) state.sel = { config: null, addOns: new Set() };
    state.productId = p ? idOf(p) : (id || null);
    showView(key);
    route(urlOf(key, { id: state.productId }), opts);
    renderBuyBox(p);
    if (p && opts.event !== false) await store.events.send('product_view', { sku: idOf(p) }, { note: ['opened', productName(p), 'a product page: its attributes are the event'] });
    await askPage(key);
    scrollTop();
    return true;
  }

  // ── phone, sign-in, where-to-buy, report (P3) ─────────────────────────────
  // The phone (m.html boots the homepage at phone width), the sign-in sheet (the store's: a fictional account from the
  // server's closed list; the worker signs the link), where to buy (the store's: the catalog's where-to-buy piece, else
  // demo.config.json store.retailers), the day report's labels. Lane P3 writes here (and the facts it owns).

  // ── The one dispatcher (shared). The cursor and a human hand run the same handler. ─
  async function handleControl(t) {
    await store.visitor.ensure();          // the first click mints her: never the load, so the boot page is the template
    store.trail.note(t);                   // a press inside a decided container: the decisions that led to what she adds
    await transport.creditDecided(t);
    if (await store.control(t)) return true;   // the store's own controls (data-act="store-…"): cart, where to buy, sign-in, search
    for (const fn of LANES.controls) { const done = await fn(t); if (done !== undefined) return done; }   // the sections' own controls
    const act = t.dataset.act;
    if (act === 'piece') {
      panels.note('clicked', titleOfCid(t.dataset.cid), t.dataset.opDecisionId ? 'a decided piece: its click is the reward it is judged on' : 'a piece of the site’s own page');
      if (t.dataset.goId) return store.nav.go(`${BASE}product?id=${encodeURIComponent(t.dataset.goId)}`, { dispatched: true });
      if (t.dataset.goNav) return store.nav.go(store.nav.navPath(t.dataset.goNav), { dispatched: true });
      return true;
    }
    // Navigation goes through the store's routes (LANES.routes, else the shared openers), with the browser's Back working.
    if (t.dataset.nav) return store.nav.go(store.nav.navPath(t.dataset.nav), { dispatched: true });
    if (t.dataset.open) return store.nav.go(`${BASE}product?id=${encodeURIComponent(t.dataset.open)}`, { dispatched: true });
    if (act === 'add-to-cart') { await store.cart.add(t.dataset.sku || state.productId, { target: t, ...selectionNow(productOf(t.dataset.sku || state.productId)) }); return true; }
    if (act === 'variant') {
      const p = productOf(t.dataset.id);
      if (p) await store.events.send('select', { sku: idOf(p), control: 'variant' }, { note: ['selected', productName(p), 'a size or a colour: another product, with its own price'] });
      return store.nav.go(`${BASE}product?id=${encodeURIComponent(t.dataset.id)}`, { dispatched: true });
    }
    if (act === 'config') {
      const p = productOf(state.productId);
      state.sel.config = t.dataset.config;
      renderBuyBox(p);
      if (p) await store.events.send('select', { sku: idOf(p), control: 'config', config: t.dataset.config }, { reask: true, note: ['selected', `${productName(p)} · ${t.dataset.config}`, 'a configuration, with its own price'] });
      return true;
    }
    if (act === 'addon') {
      const k = t.dataset.key;
      if (state.sel.addOns.has(k)) state.sel.addOns.delete(k); else state.sel.addOns.add(k);
      renderBuyBox(productOf(state.productId));
      return true;
    }
    if (act === 'thumb') { $('bbImage').innerHTML = imgTag(t.dataset.src, productName(productOf(state.productId))); return true; }
    if (act === 'tab') { focusOn($(t.dataset.target)); return true; }
    if (act === 'sort') { gridOf(t.dataset.grid).sort = t.dataset.sort; await paintGrid(t.dataset.grid); return true; }
    if (act === 'filter') {
      const g = gridOf(t.dataset.grid), key = t.dataset.key, value = t.dataset.value;
      const set = (g.chosen[key] ||= new Set());
      const on = !set.has(value);
      if (on) set.add(value); else set.delete(value);
      if (on) await store.events.send('filter', store.filters.eventOf(key, value), { note: ['filtered', `${words(key)}: ${words(value)}`, 'a filter: the attribute it narrows is taste the engine reads'] });
      await paintGrid(t.dataset.grid);
      return true;
    }
    if (act === 'filter-clear') { gridOf(t.dataset.grid).chosen = {}; await paintGrid(t.dataset.grid); return true; }
    return false;
  }

  // ── Why these, and what Compare keeps of a frame ──────────────────────────
  function whyGroups() {
    if (LANES.hooks.why) { const w = LANES.hooks.why(state.viewPage); if (w) return w; }
    const set = state.sets[state.viewPage] || null;
    return { set, groups: set ? slotsOf(state.viewPage).map((s) => [s.label, transport.bySlot(set, s.slot)]).filter(([, d]) => d.length) : [] };
  }
  function snapshotOfPage() {
    if (LANES.hooks.snapshot) { const s = LANES.hooks.snapshot(state.viewPage); if (s) return s; }
    const set = state.sets[state.viewPage] || null;
    const v = transport.cur();
    const vector = [];
    for (const [dim, values] of Object.entries(state.lastVector || {})) for (const [value, a] of Object.entries(values || {})) vector.push({ dim, value, a: Number(a) || 0 });
    vector.sort((x, y) => y.a - x.a);
    return { who: demo.compare.whoNow(), at: Date.now(), where: whereNow(), vector: vector.slice(0, 4), intent: v && v.intent, region: panels.regionShown(),
      lists: set ? slotsOf(state.viewPage).map((s) => [s.label, transport.bySlot(set, s.slot).map((d) => ({ id: d.customerContentId, t: titleOf(d), s: d.score }))]) : [] };
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE FACTS the beats speak about (public/@@SLUG@@/beats.json): a skeleton.
  // Read fresh at every step. Every path beats.json names exists here, with a
  // value or null (null reads as not set); a name that is not here is the
  // director's error at load, never an empty string.
  // ════════════════════════════════════════════════════════════════════════
  function regionLean() {
    const l = state.coldstart && state.coldstart.lean;
    const share = (l && (l.share || l.shares)) || {};
    const leaders = Object.entries(share).map(([dim, values]) => {
      const top = Object.entries(values || {}).sort((a, b) => b[1] - a[1])[0];
      return top ? `${top[0]}` : null;
    }).filter(Boolean);
    return leaders.length ? leaders.slice(0, 3).join(', ') : null;
  }
  const ownKey = () => flags.region || (state.own && state.own.key) || null;
  /** The regions beat 2 may assert, in order of preference: the anchor file's (the seed keeps it), else the config's. */
  const contrastList = () => { const r = (state.anchor.regions || {}).contrast; return Array.isArray(r) && r.length ? r : SITE.contrast; };
  const contrastRegion = () => contrastList().find((k) => k !== ownKey()) || contrastList()[0] || null;
  function adParams() {
    const a = state.anchor.arrival || {};
    const q = new URLSearchParams();
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term']) if (a[k]) q.set(k, a[k]);
    for (const [k, v] of keep()) q.set(k, v);
    return q;
  }
  function facts() {
    const p = productOf(state.productId);
    const contrast = contrastRegion();
    return {
      view: Object.fromEntries(SITE.pages.map((x) => [x.key, state.viewPage === x.key])),
      arrival: { term: (state.anchor.arrival || {}).utm_term || null, entry: transport.describeEntry(transport.landingEntry(adParams())) },
      region: { override: flags.region || null, away: (state.ctx.region || null) !== panels.ownRegion(), ownName: panels.ownName(),
        contrast, contrastName: (contrast && US[contrast]) || contrast, lean: regionLean() },
      beatNames: { ...SITE.beatNames },
      ids: { ...SITE.ids, ...(state.anchor.ids || {}) },
      // The product on screen, from the feed with the overlay merged over it (P2 adds what its beats read).
      product: { id: state.productId, name: productName(p), price: priceOf(p) ?? null, image: imageOf(p), cta: (p && p.cta) || null,
        family: (p && SITE.products.family && field(p, SITE.products.family)) || null, modelFamily: (p && SITE.products.modelFamily && field(p, SITE.products.modelFamily)) || null },
      // The store, as a visitor left it: the cart, the room and the search on screen.
      store: { cart: store.cart.count(), total: store.cart.total().total, room: state.room, query: state.query },
      signIn: { account: SITE.signIn ? SITE.signIn.accounts[0] : null },
      clock: { days: SITE.clockJump ? SITE.clockJump.days : null },
      ...Object.fromEntries(Object.entries(LANES.facts).map(([k, fn]) => [k, fn()])),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE VERBS THE KIT LACKS (beats.json `call`): the arrival, and the honest stop.
  // ════════════════════════════════════════════════════════════════════════
  /**
   * Beat 1's arrival, after the tenant's reset: the page's own state cleared, the address bar the landing, the
   * stranger minted from it, her region read from the request (or the rehearsal override, labelled). The landing
   * itself is the beat's next step.
   */
  async function arrive() {
    state.visitors = {}; state.who = null; state.receipts.clear(); state.sets = {}; state.grids = {};
    const params = adParams();
    try { history.replaceState({ [SITE.slug]: true }, '', `${ENTRY === 'phone' ? `${BASE}m` : BASE}?${params}`); } catch { /* sandboxed */ }
    const v = await transport.mintVisitor('A', transport.landingEntry(params));
    transport.useVisitor('A');
    panels.note('arrived', 'A stranger, from the landing', `${transport.describeEntry(v.entry)} · anonymous · consent granted`);
    state.own = null;
    panels.setRegion(panels.ownRegion(), panels.ownSource());
    if (flags.region) panels.note('asserted', `region = ${flags.region}`, 'a rehearsal override (?region=), labelled · never the default');
    await panels.loadColdStart();
    paintRegionChip();
    if (!flags.region) {
      const o = state.own || {};
      panels.note('located', o.key ? `region ${o.key}${o.label && o.label !== o.key ? ` (${o.label})` : ''}` : 'no region on this request',
        o.key ? (transport.localRuntime ? 'from the request, as the local runtime fills request.cf · nothing asserted' : 'from the request: the edge located her · nothing asserted')
          : 'the national figure is shown · nothing invented');
    }
  }
  /** A beat the scaffold has named but not built: it says whose presses these are, and stops. Never a silent "done". */
  async function notBuilt(args = {}) {
    throw new Error(`not built yet: this beat's presses are ${args.lane || 'a page lane'}'s to write in public/${SITE.slug}/beats.json (${args.what || 'its run'})`);
  }
  /** The header's region chip: the request's own region, as the cold-start read gives it; nothing when there is none. */
  function paintRegionChip() {
    const chip = $('regionChip');
    if (!chip) return;
    const o = state.own || {};
    const label = flags.region ? `${US[flags.region] || flags.region} (rehearsal override)` : o.label || (o.key ? US[o.key] || o.key : null);
    chip.textContent = label || '';
    chip.hidden = !label;
  }

  // ════════════════════════════════════════════════════════════════════════
  // BOOT. The boot page is the site as a stranger sees it: the published template, no visitor minted, nothing asked.
  // ════════════════════════════════════════════════════════════════════════
  (async () => {
    try {
      if (flags.fixtures) $('fixtureFlag').hidden = false;
      const [anchor, beatsDoc, productsDoc, overlayDoc, catalogDoc, slotsDoc] = await Promise.all([
        transport.firstJson('anchor', [`${BASE}beats/anchor.json`]),
        transport.firstJson('beats', [`${BASE}beats.json`]),
        transport.firstJson('products', [SITE.products.file]),
        SITE.products.overlay ? transport.tryJson(SITE.products.overlay.file) : Promise.resolve(null),
        transport.tryJson(`${BASE}catalog.json`),
        transport.tryJson(`${BASE}beats/open-slots.json`),
      ]);
      if (!beatsDoc || !Array.isArray(beatsDoc.beats)) throw new Error(`beats.json is missing: the director's script is public/${SITE.slug}/beats.json`);
      if (!anchor) throw new Error(`beats/anchor.json is missing: node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/${SITE.slug}.json --files-only`);
      state.anchor = anchor;
      // The registry the arithmetic reads: the anchor's copy of the published document (the seed holds them equal). A
      // dimension may carry its own K (and τ); the kit's panel and Explain read each dimension's own, else the registry's.
      state.registry = anchor.registry || null;
      state.sources.registry = anchor.registry ? 'beats/anchor.json registry' : 'missing';
      state.products = mergeOverlay(arr(productsDoc && productsDoc[SITE.products.list]), overlayDoc);
      state.sources.overlay = overlayDoc ? SITE.products.overlay.file.replace(BASE, '') : 'none';
      state.products.forEach((p) => state.productById.set(idOf(p), p));
      // The page's own fields of each piece (display: its order in the template, its image's product, its call to action).
      state.catalogPieces = arr(catalogDoc && catalogDoc.pieces).filter((p) => p && typeof p === 'object')
        .map((p) => ({ ...p, customerContentId: p.customerContentId || String(p.id || '').replace(/_/g, '-') }));
      state.display = new Map(state.catalogPieces.filter((p) => p.display).map((p) => [p.customerContentId, p.display]));
      state.openSlots = transport.unwrap(slotsDoc);
      if (anchor.events && anchor.events.source) transport.configure({ source: anchor.events.source });
      await useCatalog('open-catalog');
      store.search.index(state.products);
      director.setBeats(beatsDoc);
      // The rehearsal override applies from the first read; without it nothing is asserted.
      if (flags.region) { state.ctx.region = flags.region; state.regionSource = 'rehearsal override'; }
      // Every template in beats.json resolves against the facts, or the page names what does not before anyone presses.
      const unresolved = director.validate();
      if (unresolved.length) throw new Error(`beats.json: ${unresolved.join(' · ')}`);
      panels.renderRoadmap();
      director.renderAsserts();
      director.renderPresses();
      director.renderNext();
      panels.renderWho();
      paintTiles();
      for (const fn of LANES.boot) await fn();
      demo.debug({ handleControl, store });   // under ?debug, window.@@DEBUG@@: the hook the DOM suite drives
      const q = new URLSearchParams(location.search);
      const direct = ENTRY === 'product' || (ENTRY !== 'phone' && (q.has('view') || q.has('q')));
      if (!direct) {
        // The boot page: the published template, rendered from the opening documents. Nobody is minted, nothing is asked.
        showView(homeKey());
        renderTemplate(homeKey());
      }
      const loaded = ['anchor', 'beats', 'products'].map((k) => `${k}: ${state.sources[k] || 'missing'}`).join(' · ');
      say(`ready · ${loaded} · registry: ${state.sources.registry}`, 'good');
      demo.compare.prefetch();
      // The region chip reads the cold start: the request's own region, with no visitor minted for it.
      void panels.loadColdStart().then(paintRegionChip).catch(() => undefined);
      // A direct load of a product page, a grid or a search is a real arrival on it: a visitor, and the live answer.
      if (direct) {
        await store.nav.restore().then(() => say(`ready · this ${whereNow()} was decided live for a direct visitor; Next starts the walkthrough`, 'good'))
          .catch((error) => { engineDown(String(error.message || error)); say(String(error.message || error), 'bad'); });
      }
    } catch (error) {
      say(String(error.message || error), 'bad');
      engineDown(String(error.message || error));
    }
  })();
})();
