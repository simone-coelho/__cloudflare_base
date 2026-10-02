/* public/oh/oh.js
 * OH on the demo kit: the vertical layer, AS SCAFFOLDED by scripts/demo-kit/new-demo.mjs from
 * public/oh/demo.config.json. The page lanes own it from here.
 *
 * THE RULES THIS FILE EXISTS TO KEEP (docs/demos/BOOTSTRAP.md section 0).
 * 1. THE PAGE NEVER RANKS. It sends events and asks questions, and renders what comes back in the order it
 *    comes back. When the engine cannot answer, the page says so and keeps what was on screen.
 * 2. THE CAUSE IS VISIBLE. A beat moves the cursor to a real control and runs that control's own handler.
 * 3. THE BUY BOX IS OFF LIMITS. Price, sizes, Add to Cart and financing are the catalog's, identical for everyone.
 * 4. NO CREDENTIAL IN THE PAGE. Merchandiser beats are applied BY NAME by the worker (src/routes/oh.ts).
 *
 * What the scaffold gives, and what it leaves to the page lanes:
 *   the renderers   EMPTY: each decided slot paints plain cards (title, subtitle, a receipt line) in the order
 *                   the engine returned; each /sort rail paints the products file in the site's own order. The
 *                   vertical's cards, buy box and module bodies replace them.
 *   the facts       a SKELETON naming every path public/oh/beats.json reads, so the director's template
 *                   validation passes at load; each value is the page's own reading of its documents and state.
 *   the verbs       arrive (beat 1's arrival: the stranger minted from the landing, her region from the request)
 *                   and notBuilt (a beat whose presses are still its lane's to write says so and stops).
 *   the chassis     the kit's (public/demo-kit/, wired by createDemo below): transport, director, panels,
 *                   before/now rows, predict-then-prove, sheets and Compare.
 */
import { createDemo, util } from '/demo-kit/kit.js';

(() => {
  'use strict';

  const { esc, arr, money, fmt3, focusOn, scrollTop } = util;

  /** Written by the scaffold from demo.config.json: the names this page reads. */
  const SITE = {
  "slug": "oh",
  "name": "OH",
  "tenant": "oh",
  "base": "/oh/",
  "source": "oh-demo",
  "api": {
    "beat": "/oh/api/beat",
    "reset": "/oh/api/reset",
    "receipt": "/oh/api/receipt",
    "report": "/oh/api/report",
    "coldstart": "/oh/api/coldstart"
  },
  "brand": {
    "wordmark": "OH.",
    "tagline": "Optimized Home",
    "title": "OH. | TVs, laundry and the kitchen",
    "legal": "OH. is a fictional home brand built for a demonstration. Products, their names, images and prices are real as listed publicly on 1 October 2026; offers, packages and regional sales are representative. Price, financing and rebate eligibility never vary by where someone lives or by inferred income."
  },
  "pages": [
    {
      "key": "home",
      "page": "home",
      "entry": "home",
      "url": "/oh/",
      "slotsOf": null,
      "slots": [
        {
          "slot": "hero",
          "take": 1,
          "label": "The hero",
          "gated": false
        },
        {
          "slot": "category-rail",
          "take": 3,
          "label": "Shop by room",
          "gated": false
        },
        {
          "slot": "deals",
          "take": 4,
          "label": "Deals for you",
          "gated": false
        },
        {
          "slot": "continue",
          "take": 1,
          "label": "Pick up where you left off",
          "gated": true
        }
      ],
      "sorted": [
        {
          "slot": "for-you",
          "take": 8,
          "label": "Recommended for you",
          "category": null
        }
      ]
    },
    {
      "key": "tvs",
      "page": "tvs",
      "entry": "grid",
      "url": "/oh/?view=tvs",
      "slotsOf": null,
      "slots": [
        {
          "slot": "grid-promo",
          "take": 1,
          "label": "In the TV grid",
          "gated": false
        }
      ],
      "sorted": [
        {
          "slot": "tv-grid",
          "take": 24,
          "label": "TVs",
          "category": "tvs"
        }
      ]
    },
    {
      "key": "product",
      "page": "product",
      "entry": "product",
      "url": "/oh/product?id=\u003csku>",
      "slotsOf": null,
      "slots": [
        {
          "slot": "pdp-modules",
          "take": 6,
          "label": "Goes with it",
          "gated": false
        },
        {
          "slot": "pdp-offers",
          "take": 2,
          "label": "Offers on this product",
          "gated": false
        }
      ],
      "sorted": []
    },
    {
      "key": "phone",
      "page": "home",
      "entry": "phone",
      "url": "/oh/m",
      "slotsOf": "home",
      "slots": [],
      "sorted": []
    }
  ],
  "entries": {
    "home": "home",
    "grid": "tvs",
    "product": "product",
    "phone": "phone"
  },
  "dimLabels": {
    "category": "category",
    "subcategory": "subcategory",
    "type": "type",
    "series": "series",
    "panel": "panel",
    "sizeBand": "sizeband",
    "capacityTier": "capacitytier",
    "fuel": "fuel",
    "finish": "finish",
    "priceTier": "pricetier",
    "room": "room",
    "feature": "feature",
    "intent": "intent",
    "contentType": "contenttype",
    "retailer": "retailer",
    "package": "package"
  },
  "intents": [
    [
      "replace",
      "Replace"
    ],
    [
      "remodel",
      "Remodel"
    ],
    [
      "new-home",
      "New home"
    ],
    [
      "upgrade",
      "Upgrade"
    ]
  ],
  "products": {
    "file": "/oh/products.json",
    "list": "products",
    "id": "sku",
    "attributes": {
      "category": "attributes.category",
      "subcategory": "attributes.subcategory",
      "type": "attributes.type",
      "series": "attributes.series",
      "panel": "attributes.panel",
      "sizeBand": "attributes.sizeBand",
      "capacityTier": "attributes.capacityTier",
      "fuel": "attributes.fuel",
      "finish": "attributes.finish",
      "priceTier": "attributes.priceTier",
      "room": "attributes.room",
      "feature": "attributes.feature",
      "retailer": "attributes.retailer",
      "package": "attributes.package",
      "price_usd": "salePrice"
    },
    "name": "name",
    "category": "attributes.category",
    "image": "image",
    "overlay": {
      "file": "/oh/specs.json",
      "by": "sku"
    },
    "pageContext": {
      "anchor": "sku",
      "family": "family"
    },
    "family": "family",
    "modelFamily": "modelFamily"
  },
  "reportSlots": [
    "hero",
    "category-rail",
    "deals",
    "continue",
    "grid-promo",
    "pdp-modules",
    "pdp-offers"
  ],
  "regionDims": [
    "category",
    "type",
    "sizeBand",
    "priceTier",
    "fuel"
  ],
  "contrast": [
    "US-NJ",
    "US-TX"
  ],
  "copy": {
    "coldStartSentence": "aggregate, never the individual; we curate, never price.",
    "scoredSentence": "No census term enters any score. The census figure explains the lean; the lean is the brand’s own sales, seeded here as synthetic data.",
    "salesOf": "the brand’s"
  },
  "beatNames": {
    "windowCloses": "11-window-closes",
    "pinLaunch": "12-pin-launch",
    "threeWeeks": "13-three-weeks"
  },
  "ids": {
    "closesAtBeat11": "deal-nfl-gift-card",
    "pinned": "pin-micro-rgb-evo"
  },
  "signIn": {
    "accounts": [
      "Dana Whitfield"
    ]
  },
  "clockJump": {
    "beat": "three-weeks",
    "days": 21
  },
  "roadmap": [
    [
      "built",
      "eligibleWhen { regions, context }",
      "A piece only where its rule admits it: companions on the product page gate on ctx.anchor until complements lands; a condition the request does not carry fails closed."
    ],
    [
      "built",
      "slot seeds",
      "The search term lifts the category it names, as context, never as evidence about her; the receipt itemises it."
    ],
    [
      "built",
      "learn.regional",
      "The brand’s own regional sales blended by λ = K / (K + Σa), giving way as her evidence grows."
    ],
    [
      "built",
      "POST /sort",
      "The rails over the products file; at an affinity weight of zero the site’s own order exactly."
    ],
    [
      "designed",
      "complements",
      "A piece names the products it completes, and a slot rule prefers it, itemised on the receipt (engine lane E1)."
    ],
    [
      "designed",
      "partner_pickup and retailer_referral",
      "Two named outcomes credited to the decision that earned them, counted in the day report (engine lane E1)."
    ],
    [
      "designed",
      "the regional prior on /sort",
      "The TV grid leans with the state, as the homepage already does (engine lane E1)."
    ]
  ]
};
  const BASE = SITE.base;
  const PAGES = Object.fromEntries(SITE.pages.map((p) => [p.key, p.page]));
  const pageOf = (key) => SITE.pages.find((p) => p.key === key) || null;
  const own = (key) => { const p = pageOf(key); return p && p.slotsOf ? pageOf(p.slotsOf) : p; };
  const slotsOf = (key) => (own(key) ? own(key).slots : []);
  const railsOf = (key) => (own(key) ? own(key).sorted : []);
  const ENTRY = document.body.dataset.entry || 'home';
  const homeKey = () => (ENTRY === 'phone' && SITE.entries.phone ? SITE.entries.phone : SITE.entries.home);
  const productKey = () => SITE.entries.product;
  /** The region keys' names, for the panel and the beats' sentences (US states and DC). */
  const US = { 'US-AL': 'Alabama', 'US-AK': 'Alaska', 'US-AZ': 'Arizona', 'US-AR': 'Arkansas', 'US-CA': 'California', 'US-CO': 'Colorado', 'US-CT': 'Connecticut',
    'US-DE': 'Delaware', 'US-DC': 'District of Columbia', 'US-FL': 'Florida', 'US-GA': 'Georgia', 'US-HI': 'Hawaii', 'US-ID': 'Idaho', 'US-IL': 'Illinois', 'US-IN': 'Indiana',
    'US-IA': 'Iowa', 'US-KS': 'Kansas', 'US-KY': 'Kentucky', 'US-LA': 'Louisiana', 'US-ME': 'Maine', 'US-MD': 'Maryland', 'US-MA': 'Massachusetts', 'US-MI': 'Michigan',
    'US-MN': 'Minnesota', 'US-MS': 'Mississippi', 'US-MO': 'Missouri', 'US-MT': 'Montana', 'US-NE': 'Nebraska', 'US-NV': 'Nevada', 'US-NH': 'New Hampshire', 'US-NJ': 'New Jersey',
    'US-NM': 'New Mexico', 'US-NY': 'New York', 'US-NC': 'North Carolina', 'US-ND': 'North Dakota', 'US-OH': 'Ohio', 'US-OK': 'Oklahoma', 'US-OR': 'Oregon', 'US-PA': 'Pennsylvania',
    'US-RI': 'Rhode Island', 'US-SC': 'South Carolina', 'US-SD': 'South Dakota', 'US-TN': 'Tennessee', 'US-TX': 'Texas', 'US-UT': 'Utah', 'US-VT': 'Vermont', 'US-VA': 'Virginia',
    'US-WA': 'Washington', 'US-WV': 'West Virginia', 'US-WI': 'Wisconsin', 'US-WY': 'Wyoming' };

  // ── The lanes' hooks (shared, written once by P1). One writer per section: each section registers its own slot
  //    renderers, page asks, verbs, before/now rows, facts, controls, Compare tools, beat starts, boot steps and panel
  //    hooks here, so no lane edits another lane's section or the shared code around them. render[slot](slot,
  //    decisions); ask[pageKey](pageKey) → boolean; controls: (t) → undefined when not its control; facts[name]() → the
  //    beats' {{name.*}}; hooks: regionalDriver(), why(pageKey), snapshot(pageKey) (null falls back to the scaffold's),
  //    fresh[pageKey] = { ask(f) → set, paint(f, set) → restore, title } (Compare's fresh visitor on that section's page).
  //    A section adds to a hook it shares (wraps the one there), never replaces another section's.
  const LANES = { render: {}, ask: {}, verbs: {}, rows: {}, facts: {}, controls: [], compareTools: [], beforeBeat: [], boot: [], hooks: {} };

  // ════════════════════════════════════════════════════════════════════════
  // THE KIT. Every hook below answers a question the chassis asks; the module
  // headers in public/demo-kit/ name each one.
  // ════════════════════════════════════════════════════════════════════════
  const demo = createDemo({
    tenant: SITE.tenant, api: SITE.api, pageNames: PAGES, slots: {}, dimLabels: SITE.dimLabels, source: SITE.source, docBase: BASE,
    debugName: '__oh', intents: SITE.intents, roadmap: SITE.roadmap,
    state: { view: null, viewPage: null, productId: null, sets: {}, pieces: new Map(), engine: null, products: [], productById: new Map(), anchor: {} },
    // The transport: her own fields on a new visitor; nothing asserted as her intent until she or the presenter says so.
    visitor: () => ({ cart: 0 }),
    defaultIntent: () => null,
    beatName: (key, kind) => (((state.anchor.beats || {})[key] || {})[kind]) || null,
    // The director: the one dispatcher, the router, the facts the beats read, the pages and verbs they drive.
    control: (t) => handleControl(t),
    restore: () => restoreFromUrl(),
    view: () => state.view,
    facts: () => facts(),
    pages: Object.fromEntries(SITE.pages.map((p) => [p.key, { open: (o) => openPage(p.key, o || {}), refresh: () => askPage(p.key) }])),
    verbs: Object.assign(LANES.verbs, { arrive: () => arrive(), notBuilt: (args) => notBuilt(args), ...p3Verbs() }),   // p3Verbs: the P3 section's verbs (beats 15–16); LANES.verbs: the other sections'
    beforeBeat: (b) => LANES.beforeBeat.forEach((f) => f(b)),
    compareTools: LANES.compareTools,
    publishing: async (kind, name) => { if (kind === 'catalog') await useCatalog(name); },
    published: async (kind) => { if (kind === 'reset') await useCatalog('open-catalog'); },
    beatFailed: (m) => engineDown(m),
    assertRegions: () => [null, ...contrastList(), ...(flags.region && !contrastList().includes(flags.region) ? [flags.region] : [])],
    // The panels: the set on screen, the registry's memory, names, Why these, the report.
    currentSet: () => state.sets[state.viewPage] || null,
    regionalDriver: () => (LANES.hooks.regionalDriver ? LANES.hooks.regionalDriver() : null),
    memoryDims: () => (((state.anchor.registry || {}).memory || {}).dimensions || []),
    regionName: (key) => US[key] || null,
    coldStart: { seeded: SITE.regionDims.join(', '), salesOf: SITE.copy.salesOf || 'the brand’s' },
    why: () => whyGroups(),
    titleOf: (d) => titleOf(d),
    report: p3Report(),   // the day report's slots, labels, rows and attach: the P3 section
    // The before/now rows are the page lanes' (deltas.js reads config.rows()); the scaffold has none.
    rows: () => LANES.rows,
    compare: { root: '#site', ignore: '.machine, .director, .pd-back, .sheet-back, .pd-pill, #demo-cursor, .back-chip, .fixture-flag, .skip, #site > .stage > .view[hidden]',
      foot: 'Same page, same catalog and the same public prices. Only what each moment knew about the shopper is different.', where: () => whereNow(), snapshot: () => snapshotOfPage() },
  });
  const { state, flags, transport, panels, director, sheets } = demo;
  const $ = (id) => document.getElementById(id);
  const say = (t, tone) => director.say(t, tone);

  // ── The catalog the page names its pieces from: the document in force ─────
  async function useCatalog(name) {
    const doc = transport.unwrap(await transport.tryJson(`${BASE}beats/${name}.json`));
    if (doc && Array.isArray(doc.pieces)) { state.engine = doc; state.pieces = new Map(doc.pieces.map((p) => [p.customerContentId, p])); }
  }
  const pieceOf = (d) => state.pieces.get(d.customerContentId) || null;
  const titleOfCid = (cid) => { const p = state.pieces.get(cid); return (p && p.title) || cid; };
  const titleOf = (d) => titleOfCid(d.customerContentId);
  /** A product's field by its path in the row (attributes.category), as the products map names it. */
  const field = (p, path) => String(path || '').split('.').reduce((v, k) => (v == null ? undefined : v[k]), p);
  const idOf = (p) => String(field(p, SITE.products.id));
  const productOf = (id) => state.productById.get(String(id)) || null;
  const productName = (p) => (p && (field(p, SITE.products.name) || idOf(p))) || null;
  const priceOf = (p) => (p ? field(p, SITE.products.attributes.price_usd || 'price') : null);
  const imageOf = (p) => (p ? field(p, SITE.products.image) || null : null);
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

  // ── Views and the address bar ─────────────────────────────────────────────
  function showView(key) {
    const view = own(key) ? own(key).key : key;
    for (const sec of document.querySelectorAll('#stage > .view')) sec.hidden = sec.dataset.page !== view;
    state.view = (pageOf(key) || {}).entry || null;
    state.viewPage = key;
    sheets.dismiss();
  }
  function urlOf(key, opts) {
    const p = pageOf(key);
    if (!p) return BASE;
    if (p.entry === 'product') return `${BASE}product?id=${encodeURIComponent(opts.id || state.productId || '')}`;
    if (p.entry === 'grid') return `${BASE}?view=${encodeURIComponent(key)}`;
    return p.entry === 'phone' ? `${BASE}m` : BASE;
  }
  const keep = () => { const q = new URLSearchParams(location.search); const out = new URLSearchParams(); for (const k of ['debug', 'fixtures', 'region', 'metro', 'wait']) if (q.has(k)) out.set(k, q.get(k)); return out; };
  function route(path) {
    const extra = keep().toString();
    try { history.pushState({ [SITE.slug]: true }, '', extra ? `${path}${path.includes('?') ? '&' : '?'}${extra}` : path); } catch { /* sandboxed */ }
  }
  const whereNow = () => { const p = pageOf(state.viewPage); return p ? (p.entry === 'product' ? `${productName(productOf(state.productId)) || 'product'} page` : `${p.key} page`) : 'page'; };

  // ════════════════════════════════════════════════════════════════════════
  // THE RENDERERS, EMPTY. Plain cards in the order the engine returned them;
  // the page lanes replace each one with the vertical's own, each in its own
  // section below (one writer per section).
  // ════════════════════════════════════════════════════════════════════════
  function card(d, i) {
    const p = pieceOf(d) || {};
    return `<article class="card" data-act="piece" data-ctl="piece-${esc(d.customerContentId)}" data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}"`
      + ` data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}"><span class="pos">${i + 1}</span>`
      + `<h3>${esc(p.title || d.customerContentId)}</h3>${p.subtitle ? `<p>${esc(p.subtitle)}</p>` : ''}`
      + `<span class="receipt">${esc(d.strategy || 'engine')} &middot; score ${fmt3(d.score)}${p.type ? ` &middot; ${esc(p.type)}` : ''}</span></article>`;
  }
  function renderSlot(slot, decisions) {
    if (LANES.render[slot.slot]) return LANES.render[slot.slot](slot, decisions);   // the section's own renderer
    const box = $(`slot-${slot.slot}`), mod = $(`mod-${slot.slot}`);
    if (!box) return;
    if (slot.gated && mod) mod.hidden = !decisions.length;     // a gated slot fails closed: nothing returned, nothing shown
    box.innerHTML = decisions.length ? decisions.map(card).join('') : `<p class="slot-empty">The engine returned nothing for ${esc(slot.slot)} on this request.</p>`;
  }
  function engineDown(message) {
    const node = document.querySelector('#stage > .view:not([hidden]) .engine-down');
    if (!node) return;
    node.hidden = false;
    node.textContent = `The page is keeping what it last showed: ${message}. Nothing here ranks in the browser, so there is nothing to show instead.`;
  }
  const engineUp = () => document.querySelectorAll('.engine-down').forEach((n) => { n.hidden = true; });

  // ── The question: one snapshot per page view; the page renders what it says ─
  async function askPage(key) {
    if (LANES.ask[key]) return LANES.ask[key](key);   // the section's own question for its page
    const v = transport.cur();
    const r = await transport.ask(key, v);
    if (!r.ok) { engineDown(r.error); say(r.error, 'bad'); await panels.renderVectors(); return false; }
    engineUp();
    state.sets[key] = r.set;
    for (const s of slotsOf(key)) renderSlot(s, transport.bySlot(r.set, s.slot));
    for (const rail of railsOf(key)) renderRail(rail);
    panels.renderWho();
    director.sayAfter();
    await panels.renderVectors();
    panels.renderWhy();
    void transport.prefetchReceipts(r.set.decisions, r.set.asked).then(() => { panels.renderWhy(); director.sayAfter(); });
    demo.compare.afterDecidedPaint(key);
    return true;
  }

  // ── home and grid (P1) ────────────────────────────────────────────────────
  // The hero, the category rail, the deals, the "for you" rail and the continue hero on the homepage; the grid and
  // its promotion. Lane P1 writes here (and the facts it owns); the scaffold's empty renderers are above.
  //
  //   the documents   catalog.json's `display` (the page's own fields: cta, badge, grammar, imageSku), img/index.json
  //                   (D2's accepted images by sku) and demo.config.json (each /sort rail's published weights), read once
  //   the renderers   each decided slot in the order the engine returned it; each /sort rail in the order POST /sort
  //                   returned it. A product with no image shows its name on a neutral tile, never a broken image
  //   the questions   one snapshot per page view, ctx.visit=return asserted (labelled) once the clock jump has run;
  //                   one POST /sort per rail, the region on its body only when the page asserts it everywhere
  //   the beats       1–4 and 11–14 (beats.json): the arrival line, the two rooms, the fresh visitor, the closed
  //                   window and the held-back packages, the pin with what the engine would have led with, the clock
  //                   jump on her dials, the shortlist's deltas. Every sentence they say is read off an answer, a
  //                   receipt or a published document, never typed
  // Its own names live in the closure below (other sections share this scope); renderRail and openPage stay
  // declarations because the shared code calls them.
  /** A /sort rail painted from what the page holds (no question asked): the shared boot and askPage call it. */
  function renderRail(rail) { void P1.paintRail(rail); }
  async function openPage(key, opts = {}) {
    const p = pageOf(key);
    if (!p) throw new Error(`no page named "${key}"`);
    if (p.entry === 'product') return openProduct(opts.id || state.productId, opts);
    await transport.ensureVisitor();
    showView(key);
    route(urlOf(key, opts));
    if (opts.event !== false) {
      await transport.send('page_view', { page: p.page });
      if (!opts.quiet) panels.note('viewed', `The ${p.key} page`, 'asked again');
    }
    await askPage(key);
    if (opts.focus) focusOn($(`mod-${opts.focus}`)); else scrollTop();
    return true;
  }
  const P1 = (() => {
    const { num, fmt2, stripTags } = util;
    const deltas = demo.deltas;
    const HOME = SITE.entries.home, GRID = SITE.entries.grid;
    const ROOM = { 'living-room': 'living room', 'laundry-room': 'laundry room', kitchen: 'kitchen' };
    const TYPE = { oled: 'OLED', qned: 'QNED', 'micro-rgb': 'Micro RGB', uhd: 'UHD', hd: 'HD', lifestyle: 'lifestyle' };
    /** The homepage's room menus in the header: static, the same for everyone (the header is off limits), the site's own picks. */
    const MENUS = {
      laundry: { label: 'Laundry', groups: [['Front-load washers', 'washers', 'front-load'], ['Top-load washers', 'washers', 'top-load'], ['Dryers', 'dryers', null], ['WashTower', 'washtowers', null]],
        lead: ['WM4000HWA'] },
      kitchen: { label: 'Kitchen', groups: [['Ranges', 'ranges', null], ['Over-the-range microwaves', 'microwaves', null], ['Dishwashers', 'dishwashers', null], ['Kitchen packages', 'kitchen-packages', null]],
        lead: [] },
    };
    /** "For you" candidates: the site's picks per room, as its platform would return them (four each, badged first). */
    const POOL = [['living-room', ['tvs', 'soundbars']], ['laundry-room', ['washers', 'dryers', 'washtowers']], ['kitchen', ['ranges', 'dishwashers', 'microwaves']]];
    const PER_ROOM = 4;
    const S = {
      ready: null, display: new Map(), images: {}, weights: {},
      home: { set: null, slots: {}, heroWas: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null } },
      grid: { set: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null }, fit: null, hidden: [], unknown: 0 },
      mark: null, windows: null, held: null, pin: null, clock: null, returned: false, lead: null, quiet: false, restoring: false, contrast: null, contrastAsk: null,
    };

    // ── The page's own documents ────────────────────────────────────────────
    function data() {
      if (S.ready) return S.ready;
      S.ready = Promise.all([transport.tryJson(`${BASE}catalog.json`), transport.tryJson(`${BASE}img/index.json`), transport.tryJson(`${BASE}demo.config.json`)])
        .then(([cat, idx, cfg]) => {
          for (const p of arr(cat && cat.pieces)) if (p && p.customerContentId && p.display) S.display.set(p.customerContentId, p.display);
          S.images = (idx && idx.products) || {};
          for (const pg of arr(cfg && cfg.pages)) for (const r of arr(pg.sorted)) if (r && r.weights) S.weights[r.slot] = r.weights;
          state.sources.display = cat ? 'catalog.json' : 'missing';
          state.sources.images = idx ? 'img/index.json' : 'missing';
        });
      return S.ready;
    }
    const dispOf = (cid) => S.display.get(cid) || {};
    const piecesNow = () => arr(state.engine && state.engine.pieces);
    const pieceById = (id, doc) => arr(doc ? doc.pieces : piecesNow()).find((p) => p.id === id) || null;
    /** A piece's title inside a sentence: its closing full stop dropped ("New for 2026: Micro RGB evo." → "… evo"). */
    const bare = (t) => String(t == null ? '' : t).replace(/\.\s*$/, '');
    const titleById = (id) => { const p = pieceById(id) || arr(S.mark && S.mark.catalog && S.mark.catalog.pieces).find((x) => x.id === id); return bare(p ? p.title : id); };
    const priceNum = (p) => { const v = num(priceOf(p)); return Number.isFinite(v) && v > 0 ? v : null; };
    const listNum = (p) => { const v = num(p && p.listPrice); return Number.isFinite(v) && v > 0 ? v : null; };
    const roomOf = (p) => field(p, 'attributes.room') || null;

    // ── Images: D2's accepted image by sku; else the row's own; else its name on a neutral tile ─
    function artOf(p) {
      if (!p) return null;
      const e = S.images[idOf(p)];
      if (e && e.verdict === 'accept' && e.src) return e.src;
      if (e && e.verdict && e.verdict !== 'accept') return null;      // the imagery gate holds none for it: the name tile
      return imageOf(p);
    }
    function artHtml(p, cls) {
      const src = artOf(p), name = productName(p) || '';
      return `<span class="p1-art${cls ? ` ${cls}` : ''}">${src ? `<img src="${esc(src)}" alt="${esc(name)}" loading="lazy" decoding="async" data-p1-name="${esc(name)}">`
        : `<span class="p1-noimg">${esc(name)}</span>`}</span>`;
    }
    // An image that cannot load becomes its product's name on the tile: never a broken image on the page.
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-p1-name')) return;
      const tile = document.createElement('span');
      tile.className = 'p1-noimg';
      tile.textContent = img.getAttribute('data-p1-name') || '';
      img.replaceWith(tile);
    }, true);

    // ── The static chrome the shells share: the room menus, the arrival line, the strips, the fit row ─
    function menuPicks(cat, type) {
      return state.products.filter((p) => field(p, 'attributes.category') === cat && (!type || field(p, 'attributes.type') === type)
        && priceNum(p) !== null && artOf(p) && p.inStock !== false);
    }
    function menuHtml(key) {
      const m = MENUS[key];
      const groups = m.groups.map(([label, cat, type]) => {
        const picks = menuPicks(cat, type);
        const lead = m.lead.map(productOf).filter((p) => p && picks.includes(p));
        const list = [...lead, ...picks.filter((p) => !lead.includes(p))].slice(0, 3);
        return `<div class="p1-menu-group"><p class="p1-menu-h">${esc(label)}</p>${list.map((p) => `<button type="button" class="p1-menu-item" data-open="${esc(idOf(p))}" data-ctl="menu-${esc(idOf(p))}">`
          + `${artHtml(p, 'p1-art--menu')}<span><b>${esc(productName(p))}</b><em>${money(priceNum(p))}</em></span></button>`).join('')}</div>`;
      }).join('');
      return `<div class="p1-menu" id="menu-${key}" hidden><div class="p1-menu-in">${groups}</div><p class="p1-menu-foot"><span class="nper">not personalised</span> the site’s own picks, the same for everyone</p></div>`;
    }
    function ensureChrome() {
      const nav = $('mainnav');
      if (nav && !nav.querySelector('[data-ctl="nav-laundry"]')) {
        const tv = nav.querySelector('[data-ctl="nav-tvs"]');
        const btns = Object.entries(MENUS).map(([key, m]) => `<button type="button" data-act="p1-menu" data-menu="${key}" data-ctl="nav-${key}" aria-expanded="false">${esc(m.label)}</button>`).join('');
        if (tv) tv.insertAdjacentHTML('afterend', btns); else nav.insertAdjacentHTML('afterbegin', btns);
        const mast = nav.closest('.mast') || nav.parentElement;
        mast.insertAdjacentHTML('afterend', Object.keys(MENUS).map(menuHtml).join(''));
      }
      const hero = $('mod-hero');
      if (hero && !$('p1Arrival')) hero.insertAdjacentHTML('beforebegin', '<p class="p1-arrival" id="p1Arrival" hidden></p>');
      for (const [slot, cap] of [['category-rail', 'The tiles before this press'], ['deals', 'What was on screen before this press']]) {
        const box = $(`slot-${slot}`);
        if (box && !$(`p1Ghosts-${slot}`)) box.insertAdjacentHTML('beforebegin', `<section class="changes p1-changes" id="p1Changes-${slot}" aria-live="polite">
          <div class="changes-before"><span class="changes-cap">${esc(cap)}</span><div class="ghosts" id="p1Ghosts-${slot}"><span class="ghost-empty">She had not seen it yet.</span></div></div>
          <div class="changes-what"><span class="changes-cap">What changed</span><ul class="deltas" id="p1Deltas-${slot}"><li class="delta-none">Press a beat to begin.</li></ul></div></section>
          <section class="beforerow" id="p1Before-${slot}" hidden><p class="rowlabel">What was on screen before this press</p><div class="p1-before-cards" id="p1BeforeCards-${slot}"></div></section>
          <p class="rowlabel rowlabel--now" id="p1NowLabel-${slot}" hidden>What is on screen now</p>`);
        const ghosts = $(`p1Ghosts-${slot}`);
        if (ghosts) ghosts.addEventListener('click', () => { if (!state.busy && slotState(slot).prevDecisions) deltas.toggleBefore(slot); });
      }
      for (const slot of ['for-you', 'tv-grid']) {
        const chip = $(`chip-${slot}`);
        if (chip && !$(`lean-${slot}`)) chip.insertAdjacentHTML('beforebegin', `<span class="p1-lean" id="lean-${slot}" hidden></span>`);
      }
      const forYou = $('rail-for-you');
      if (forYou && !$('p1RailDeltas')) forYou.insertAdjacentHTML('beforebegin', '<ul class="deltas p1-rail-deltas" id="p1RailDeltas" hidden></ul>');
      const grid = $('rail-tv-grid');
      if (grid && !$('p1Fit')) grid.insertAdjacentHTML('beforebegin', `<div class="p1-fit" id="p1Fit">
          <span class="p1-fit-k">Your space</span><label class="p1-fit-in"><input type="number" id="p1FitWidth" min="20" max="140" step="0.5" inputmode="decimal" aria-label="The width of your space, in inches"> in wide</label>
          <button type="button" class="btn btn--line btn--sm" data-act="p1-fit" data-ctl="fit-apply">Apply</button>
          ${[50, 58, 62].map((w) => `<button type="button" class="p1-chip" data-act="p1-fit" data-fit="${w}" data-ctl="fit-${w}">${w} in</button>`).join('')}
          <button type="button" class="p1-chip" data-act="p1-fit" data-fit="" data-ctl="fit-clear">Clear</button>
          <p class="p1-fit-note" id="p1FitNote">Your measurement is yours: declared, never inferred. A TV wider than your space leaves the grid, and the page says how many.</p></div>`);
      const fitIn = $('p1FitWidth');
      if (fitIn && !fitIn.dataset.p1) {
        fitIn.dataset.p1 = '1';
        fitIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const go = document.querySelector('#p1Fit [data-ctl="fit-apply"]'); if (go) go.click(); } });
      }
      Object.assign(LANES.rows, homeRows());
      const view = $('view-tvs');
      if (view && !view.querySelector('.p1-facets')) {
        const head = view.querySelector('.view-head');
        if (head) head.insertAdjacentHTML('afterend', `<div class="p1-facets static" aria-label="Filters"><span class="nper">filters and sort: not personalised</span>${['OLED', 'QNED', 'Micro RGB', '65 in and up', 'Under $1,500'].map((x) => `<span class="p1-facet">${esc(x)}</span>`).join('')}<span class="p1-facet p1-facet--sort">Sort: Featured</span></div>`);
      }
    }
    function closeMenus(except) {
      for (const key of Object.keys(MENUS)) {
        const m = $(`menu-${key}`), b = document.querySelector(`[data-ctl="nav-${key}"]`);
        if (m && key !== except) m.hidden = true;
        if (b && key !== except) b.setAttribute('aria-expanded', 'false');
      }
    }
    document.addEventListener('click', (e) => { if (!e.target.closest || (!e.target.closest('.p1-menu') && !e.target.closest('[data-act="p1-menu"]'))) closeMenus(); });

    // ── The question for a page: the kit's transport.ask, with what this page asserts as its context ─
    async function snapshot(pageKey, v, extra) { return transport.ask(pageKey, v, { context: extra || {} }); }
    /** What the homepage asserts beyond the kit's two: the return visit, from the labelled clock jump on. */
    const homeExtra = (key) => (S.returned && own(key) && own(key).key === HOME ? { visit: 'return' } : {});
    async function ask(key) {
      await data();
      ensureChrome();
      const v = transport.cur();
      const r = await snapshot(key, v, homeExtra(key));
      if (!r.ok) { engineDown(r.error); say(r.error, 'bad'); await panels.renderVectors(); return false; }
      engineUp();
      state.sets[key] = r.set;
      if (own(key).key === HOME) S.home.set = r.set; else S.grid.set = r.set;
      for (const s of slotsOf(key)) renderSlot(s, transport.bySlot(r.set, s.slot));
      for (const rail of railsOf(key)) await sortAndPaint(key, rail, v);
      arrivalLine();
      if (own(key).key === HOME && state.coldstart && !state.ctx.region && !S.contrastAsk) void contrastNow();   // ready before beat 2 is pressed
      panels.renderWho();
      director.sayAfter();
      await panels.renderVectors();
      panels.renderWhy();
      void transport.prefetchReceipts(r.set.decisions, r.set.asked).then(() => { refreshReceipts(); panels.renderWhy(); director.sayAfter(); });
      demo.compare.afterDecidedPaint(key);
      return true;
    }

    // ── The receipts' vocabulary on a card ──────────────────────────────────
    const decided = (d) => ` data-cid="${esc(d.customerContentId)}" data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}" data-op-decision-id="${esc(d.decisionId || '')}"`;
    const recOf = (d) => (d && d.decisionId && state.receipts.get(d.decisionId)) || null;
    function receiptLine(d, i) {
      if (d.strategy === 'tenant-pinned') return pinReceipt(d, i);
      const rec = recOf(d), ex = (rec && rec.explain) || {};
      const parts = [d.strategy === 'default' ? `container ${i + 1} · the catalog’s order: nothing in her profile scores it` : `rank <b>${i + 1}</b> · score <b>${fmt3(d.score)}</b>`];
      const drv = panels.driverSummary(d, 3);
      if (drv) parts.push(drv);
      if (ex.contextual && num(ex.contextual.applied) > 0) parts.push(panels.seedLabel(ex.contextual, true));
      if (ex.stage && ex.stage.sentence) parts.push(esc(ex.stage.sentence));
      if (ex.diversity && ex.diversity.sentence) parts.push(esc(ex.diversity.sentence));
      return parts.join(' · ');
    }
    function pinReceipt(d, i) {
      const p = S.pin;
      const would = p && p.would ? ` · without the pin the engine would have led with <b>${esc(p.would)}</b> (score ${fmt3(p.score)}), container ${p.nowAt} now` : '';
      return `<span class="p1-rc-pin">pinned by our merchandiser · container ${i + 1} for everyone · ranking skipped</span>${would}`;
    }
    function refreshReceipts() {
      for (const node of document.querySelectorAll('.p1-receipt[data-receipt]')) {
        const id = node.getAttribute('data-receipt');
        const set = [S.home.set, S.grid.set].find((x) => x && x.decisions.some((d) => d.decisionId === id));
        if (!set) continue;
        const d = set.decisions.find((x) => x.decisionId === id);
        const i = transport.bySlot(set, d.slot).indexOf(d);
        node.innerHTML = d.slot === 'continue' ? continueReceipt(d) : receiptLine(d, i);
      }
      if (!S.quiet) for (const slot of ['category-rail', 'deals']) if (rowFor(slot)) deltas.render(slot);
    }

    // ── Where a card's own control goes: a TV piece to the grid, a product to its page, a room to its menu ─
    function productOfPiece(piece, cid) {
      const disp = dispOf(cid);
      return productOf(disp.imageSku) || arr(piece && piece.featuredProductIds).map(productOf).find(Boolean) || null;
    }
    function target(piece, cid) {
      const tags = (piece && piece.tags) || {};
      const cats = arr(tags.category), room = arr(tags.room)[0];
      const featured = arr(piece && piece.featuredProductIds);
      if (featured.length && featured.length <= 2) { const p = productOfPiece(piece, cid); if (p) return `data-open="${esc(idOf(p))}"`; }
      if (cats.includes('tvs') || cats.includes('soundbars') || room === 'living-room') return 'data-nav="tvs"';
      if (room === 'laundry-room') return 'data-act="p1-menu" data-menu="laundry"';
      if (room === 'kitchen') return 'data-act="p1-menu" data-menu="kitchen"';
      const p = productOfPiece(piece, cid);
      return p ? `data-open="${esc(idOf(p))}"` : 'data-nav="tvs"';
    }

    // ── The hero, take 1 ────────────────────────────────────────────────────
    function renderHero(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      const d = decisions[0];
      const entered = !S.quiet && !S.restoring && Boolean(d && S.home.heroWas && S.home.heroWas !== d.customerContentId);
      if (!S.quiet && !S.restoring) S.home.heroWas = d ? d.customerContentId : null;
      if (!d) { box.innerHTML = '<p class="slot-empty">The engine returned no hero for this request, and the page shows none rather than invent one.</p>'; return; }
      const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), prod = productOfPiece(piece, d.customerContentId);
      const kicker = d.strategy === 'tenant-pinned' ? 'Pinned by our merchandiser' : ({ 'living-room': 'TV & audio', 'laundry-room': 'Laundry', kitchen: 'Kitchen' }[arr(piece.tags && piece.tags.room)[0]] || 'New');
      box.innerHTML = `<article class="card p1-hero${entered ? ' p1-entered' : ''}"${decided(d)}>${entered ? '<span class="delta-chip delta-chip--in">new</span>' : ''}
        <div class="p1-hero-copy"><p class="p1-kicker">${esc(kicker)}</p><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-hero-sub">${esc(piece.subtitle)}</p>` : ''}
          <div class="p1-ctas"><button type="button" class="btn btn--brand" ${target(piece, d.customerContentId)} data-ctl="hero-cta">${esc(disp.cta || 'Shop now')}</button></div></div>
        <div class="p1-hero-art">${prod ? artHtml(prod, 'p1-art--hero') : ''}</div>
        <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${receiptLine(d, 0)}</p></article>`;
    }

    // ── The room tiles, take 3: the order is the engine's ────────────────────
    const viewOf = (d) => { const p = pieceOf(d) || {}; return { id: d.customerContentId, title: p.title || d.customerContentId, art: artOf(productOfPiece(p, d.customerContentId)) }; };
    function renderTiles(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      const after = decisions.map(viewOf);
      const row = rowFor(slot.slot);
      if (row && !S.restoring) deltas.rotate(slot.slot, after, decisions);   // her answer put back after Compare: no new before
      const moves = row && !S.quiet ? deltas.moves(slot.slot, slotState(slot.slot).previous, after, decisions) : {};
      box.innerHTML = decisions.map((d, i) => {
        const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), prod = productOfPiece(piece, d.customerContentId);
        return `<article class="card p1-tile"${decided(d)}>${deltas.chipHtml(moves[d.customerContentId])}
          <button type="button" class="p1-tile-hit" ${target(piece, d.customerContentId)} data-ctl="tile-${esc(d.customerContentId)}">${prod ? artHtml(prod, 'p1-art--tile') : ''}
          <h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-sub">${esc(piece.subtitle)}</p>` : ''}<span class="p1-tile-cta">${esc(disp.cta || 'Shop')} &rarr;</span></button>
          <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${receiptLine(d, i)}</p></article>`;
      }).join('') || '<p class="slot-empty">The engine returned no tile for this request.</p>';
      if (row && !S.quiet) deltas.render(slot.slot);
    }

    // ── The deals four ──────────────────────────────────────────────────────
    function renderDeals(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      const after = decisions.map(viewOf);
      const row = rowFor(slot.slot);
      if (row && !S.restoring) deltas.rotate(slot.slot, after, decisions);   // her answer put back after Compare: no new before
      const moves = row && !S.quiet ? deltas.moves(slot.slot, slotState(slot.slot).previous, after, decisions) : {};
      box.innerHTML = decisions.map((d, i) => dealHtml(d, i, moves[d.customerContentId])).join('')
        || '<p class="slot-empty">The engine returned no deal for this request, and the page shows none rather than invent one.</p>';
      if (row && !S.quiet) deltas.render(slot.slot);
    }
    function dealHtml(d, i, mv) {
      const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), prod = productOfPiece(piece, d.customerContentId), g = disp.grammar || {};
      return `<article class="card p1-deal${d.strategy === 'tenant-pinned' ? ' p1-deal--pinned' : ''}"${decided(d)}>${deltas.chipHtml(mv)}
        <div class="p1-deal-art">${prod ? artHtml(prod, 'p1-art--deal') : ''}${disp.badge ? `<span class="p1-badge">${esc(disp.badge)}</span>` : ''}</div>
        <div class="p1-deal-body"><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-sub">${esc(piece.subtitle)}</p>` : ''}
          ${g.value || g.consideration ? `<p class="p1-fine">${esc([g.value, g.consideration].filter(Boolean).join(' · '))}</p>` : ''}
          <button type="button" class="btn btn--line btn--sm" ${target(piece, d.customerContentId)} data-ctl="deal-${i + 1}">${esc(disp.cta || 'Shop the deal')}</button>
          <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${receiptLine(d, i)}</p></div></article>`;
    }

    // ── The continue hero: gated on the return visit; its body is her own shortlist ─
    function renderContinue(slot, decisions) {
      const box = $(`slot-${slot.slot}`), mod = $(`mod-${slot.slot}`);
      if (!box) return;
      if (mod) mod.hidden = !decisions.length;       // gated: nothing returned, nothing shown
      const d = decisions[0];
      if (!d) { box.innerHTML = ''; return; }
      const piece = pieceOf(d) || {};
      const list = S.quiet ? [] : shortlist();
      const clock = S.clock && !S.quiet ? `<div class="p1-clock"><span class="hk">${esc(S.clock.head)}</span>${S.clock.html}</div>` : '';
      box.innerHTML = `<article class="card p1-continue"${decided(d)}>
        <div class="p1-cont-head"><p class="p1-kicker">${S.returned ? 'A return visit, asserted for the clock jump' : 'A return visit'}</p><h3>${esc(piece.title || 'Pick up where you left off.')}</h3>
          <p class="p1-hero-sub">Your shortlist is what you opened on this device, nothing inferred, kept for the window we publish, with your consent.</p></div>
        <div class="p1-shortlist">${list.map((s, i) => { const p = productOf(s.id); return p ? `<button type="button" class="p1-short" data-open="${esc(s.id)}" data-ctl="short-${i + 1}">${artHtml(p, 'p1-art--short')}<span><b>${esc(productName(p))}</b><em>${money(priceNum(p))}</em></span></button>` : ''; }).join('')
          || '<p class="slot-empty">Nothing opened on this device yet: the shortlist is what she opens.</p>'}</div>
        ${clock}
        <div class="p1-ctas"><button type="button" class="btn btn--brand" data-act="p1-changes" data-ctl="continue-changes">What changed while you were away</button></div>
        <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${continueReceipt(d)}</p></article>`;
    }
    function continueReceipt(d) {
      const rec = recOf(d), ex = (rec && rec.explain) || {};
      const visit = S.returned ? 'ctx.visit = return, asserted for the clock jump (labelled)' : 'the return visit';
      return [`${visit} · ${d.strategy === 'default' ? 'the only eligible piece: nothing in her profile scores it' : `score <b>${fmt3(d.score)}</b>`}`,
        ex.stage && ex.stage.sentence ? esc(ex.stage.sentence) : null].filter(Boolean).join(' · ');
    }

    // ── The grid's promotion, take 1 ────────────────────────────────────────
    function renderGridPromo(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      box.innerHTML = decisions.map((d, i) => {
        const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), prod = productOfPiece(piece, d.customerContentId);
        return `<article class="card p1-promo"${decided(d)}>${prod ? artHtml(prod, 'p1-art--promo') : ''}<div><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-sub">${esc(piece.subtitle)}</p>` : ''}
          <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${receiptLine(d, i)}</p></div>
          ${disp.cta ? `<span class="p1-promo-cta">${esc(disp.cta)}</span>` : ''}</article>`;
      }).join('') || '<p class="slot-empty">The engine returned nothing for the grid’s promotion on this request.</p>';
    }

    // ── The /sort rails: "for you" across rooms, and the TV grid ────────────
    /**
     * "For you" is the engine's twice over, and the page orders nothing: POST /sort over each room's products (priced,
     * pictured, in stock, in the products file's own order) gives that room's first PER_ROOM, as a platform asks for each
     * category of a cross-category widget; then POST /sort over those twelve gives the rail, rendered in that answer's
     * own order. So the rail follows her rooms instead of swapping wholesale to one of them, and every position on it is
     * an answer's.
     */
    const roomProducts = (room, cats) => state.products.filter((p) => roomOf(p) === room && cats.includes(field(p, 'attributes.category')) && priceNum(p) !== null && artOf(p) && p.inStock !== false);
    /** With no answer (no visitor yet): each room's first PER_ROOM in the products file's own order, the rooms in turn. */
    function forYouPool() {
      const lists = POOL.map(([room, cats]) => roomProducts(room, cats).slice(0, PER_ROOM));
      const out = [];
      for (let i = 0; i < PER_ROOM; i += 1) for (const l of lists) if (l[i]) out.push(l[i]);
      return out;
    }
    const widthOf = (p) => { const w = num(p && (p.width != null ? p.width : p.fits && p.fits.width)); return Number.isFinite(w) && w > 0 ? w : null; };
    function gridPool(rail) {
      const all = state.products.filter((p) => field(p, SITE.products.category) === rail.category && priceNum(p) !== null);   // the products file's own order
      const fit = S.grid.fit;
      S.grid.hidden = fit ? all.filter((p) => widthOf(p) !== null && widthOf(p) > fit) : [];
      S.grid.unknown = fit ? all.filter((p) => widthOf(p) === null).length : 0;
      return all.filter((p) => !S.grid.hidden.includes(p));
    }
    const poolOf = (rail) => (rail.category ? gridPool(rail) : forYouPool());
    /** What a rail shows: the engine's order (or, with no answer, the products file's), the module's rule, its take. */
    const shownOrder = (rail, R) => (R.order || (R.pool || poolOf(rail)).map(idOf)).slice(0, rail.take);
    const candidateOf = (p) => { const { productId, ...attrs } = productAttrs(p); return { id: productId, ...attrs }; };
    /** The rail's weights as demo.config.json publishes them; a dimension it does not name weighs 0, as on the slots. */
    function weightsOf(rail) {
      const w = S.weights[rail.slot];
      if (!w) return { affinity: 1 };
      const zero = Object.fromEntries(arr((state.registry || {}).dimensions).map((d) => [d.key, 0]));
      return { affinity: 1, dims: { ...zero, ...w } };
    }
    const railState = (rail) => (rail.category ? S.grid.rail : S.home.rail);
    /** One POST /sort, as the page asks it: her vector, the rail's published weights, the region only when the page asserts it. */
    async function sortOnce(rail, v, list) {
      const asserted = state.ctx.region || null;
      const r = await transport.api('/sort', { userId: v.session.subject, sessionId: v.session.sessionId, candidates: list.map(candidateOf), weights: weightsOf(rail),
        ...(asserted ? { context: { region: asserted } } : {}) }, { visitor: v });
      if (!r.ok || !r.body || !Array.isArray(r.body.order)) return { ok: false, status: r.status, error: (r.body && r.body.error) || String(r.status) };
      return { ok: true, order: r.body.order, items: r.body.items || [], regional: r.body.regional || null };
    }
    async function askRail(rail, v, from) {
      const prevOrder = from ? from.order : null;
      const fail = (x, pool) => ({ status: x.status === 503 ? 'no-capture' : 'down', order: null, items: null, regional: null, prevOrder, pool, error: x.error });
      let pool = rail.category ? gridPool(rail) : null, rooms = null;
      if (!pool) {
        // Each room's own question first, then the one across them: the twelve are the rooms' answers' first four each.
        rooms = [];
        for (const [room, cats] of POOL) rooms.push({ room, r: await sortOnce(rail, v, roomProducts(room, cats)) });   // one at a time: each records its own product sort
        const bad = rooms.find((x) => !x.r.ok);
        if (bad) return fail(bad.r, forYouPool());
        // The twelve go to the question across the rooms in the products file's own order (the site's), as the grid's do.
        const picked = new Set(rooms.flatMap((x) => x.r.order.slice(0, PER_ROOM)));
        pool = state.products.filter((p) => picked.has(idOf(p)));
      }
      const r = await sortOnce(rail, v, pool);
      if (!r.ok) return fail(r, pool);
      return { status: 'sorted', order: r.order, items: r.items, regional: r.regional, prevOrder, pool,
        rooms: rooms ? rooms.map((x) => ({ room: x.room, of: roomProducts(x.room, POOL.find(([k]) => k === x.room)[1]).length })) : null };
    }
    async function sortAndPaint(key, rail, v) {
      const before = railState(rail);
      const next = v ? await askRail(rail, v, before) : { ...before, status: 'site', order: null, items: null, regional: null, pool: poolOf(rail) };
      if (rail.category) S.grid.rail = next; else S.home.rail = next;
      paintRail(rail);
    }
    /** "leans with North Carolina’s sales · synthetic → warehouse", from the answer's own regional label; "(asserted)" when it says so. */
    function leanLine(R) {
      const reg = R && R.status === 'sorted' ? R.regional : null;
      if (!reg || !reg.region) return '';
      const key = reg.region;
      const cold = state.coldstart && state.coldstart.region && state.coldstart.region.key === key ? state.coldstart : null;
      const name = reg.level === 'global' ? 'every region' : (cold && panels.coldLabel()) || US[key] || (key === 'US' ? 'the US' : key);
      const lean = cold && cold.lean;
      const ours = lean && (lean.dataSource || lean.label) && !/synthetic/i.test(`${lean.dataSource || ''} ${lean.label || ''}`);
      return `leans with ${name}’s sales${reg.asserted ? ' (asserted)' : ''} · ${ours ? 'this worker’s own' : 'synthetic → warehouse'}`;
    }
    async function paintRail(rail) {
      await data();
      ensureChrome();
      const box = $(`rail-${rail.slot}`), chip = $(`chip-${rail.slot}`), leanNode = $(`lean-${rail.slot}`);
      if (!box) return;
      const R = railState(rail);
      const pool = R.pool || poolOf(rail);
      const byId = new Map((R.items || []).map((x) => [x.id, x]));
      const order = shownOrder(rail, R);
      const prev = R.prevOrder ? shownOrder(rail, { order: R.prevOrder, pool }) : null;
      if (chip) {
        chip.textContent = R.status === 'sorted' ? `decided · POST /sort ${rail.category ? `over ${pool.length} TVs` : `per room for its ${PER_ROOM}, then across the rooms`}`
          : R.status === 'no-capture' ? 'the site’s own order · /sort answers once she has a captured event'
            : R.status === 'down' ? `the site’s own order · /sort did not answer (${R.error})` : 'the site’s own order · no visitor yet';
        chip.classList.toggle('p1-chip-live', R.status === 'sorted');
      }
      const lean = leanLine(R);
      if (leanNode) {
        leanNode.textContent = lean;
        leanNode.hidden = !lean;
        leanNode.title = lean ? `The regional prior on POST /sort: ${R.regional.region} at ${R.regional.level} level, λ = ${fmt2(num(R.regional.lambda))} of the blend over ${arr(R.regional.dimensions).join(', ')}; ${R.regional.asserted ? 'the region asserted on the request, not observed' : 'the region read from the request'}` : '';
      }
      box.innerHTML = order.map((id, i) => {
        const p = productOf(id);
        if (!p) return '';
        const it = byId.get(id);
        const was = prev ? prev.indexOf(id) : -1;
        const moved = prev && !S.quiet ? (was === -1 ? 'new' : was > i ? `↑${was - i}` : was < i ? `↓${i - was}` : '') : '';
        const top = it && arr(it.drivers).filter((x) => x.dim !== 'regional').sort((a, b) => num(b.contribution) - num(a.contribution))[0];
        const reg = it && arr(it.drivers).find((x) => x.dim === 'regional');
        const from = it ? `site ${it.feedRank + 1}` : '—';   // its place in the products file's own order of what was asked
        const rank = R.status === 'sorted' ? `rank <b>${i + 1}</b> · ${from}${it && num(it.score) > 0 ? ` · ${fmt3(it.score)}` : ''}${top ? ` · ${esc(SITE.dimLabels[top.dim] || top.dim)} ${esc(top.value)}` : ''}${reg ? ` · region ${esc(reg.value)}` : ''}`
          : `site position <b>${i + 1}</b>`;
        const list = listNum(p), price = priceNum(p);
        return `<article class="pcard p1-pcard" data-open="${esc(id)}" data-ctl="open-${esc(id)}" data-sku="${esc(id)}">${moved ? `<span class="delta-chip delta-chip--${moved === 'new' ? 'in' : moved[0] === '↑' ? 'up' : 'down'}">${esc(moved)}</span>` : ''}
          ${artHtml(p, 'p1-art--card')}<span class="pname">${esc(productName(p))}</span>
          ${p.rating ? `<span class="p1-rating">★ ${esc(p.rating)}${p.reviews ? ` <em>(${Number(p.reviews).toLocaleString('en-US')})</em>` : ''}</span>` : ''}
          <span class="pprice">${money(price)}${list && list > price ? ` <s>${money(list)}</s>` : ''}</span>
          ${p.inStock === false ? '<span class="p1-stock">Notify me: out of stock</span>' : ''}
          <span class="p1-rank">${rank}</span></article>`;
      }).join('') || `<p class="slot-empty">${rail.category && S.grid.fit ? 'No TV in the feed fits that space.' : 'No product to show.'}</p>`;
      if (rail.category) fitNote();
      else railDeltas(prev, order);
    }
    function railDeltas(prev, order) {
      const node = $('p1RailDeltas');
      if (!node) return;
      const rooms = roomsOn(order);
      const roomLine = `<li class="delta-none">On the rail now: ${Object.entries(rooms).map(([room, n]) => `<b>${esc(ROOM[room] || room)} ${n}</b>`).join(' · ')}.</li>`;
      if (!prev || S.quiet) { node.innerHTML = roomLine; node.hidden = S.quiet || !transport.cur(); return; }
      const rows = [];
      order.forEach((id, i) => {
        const was = prev.indexOf(id), p = productOf(id);
        if (!p) return;
        if (was === -1) rows.push(`<li><span class="sign sign--in">+</span><span><b>${esc(productName(p))}</b> <em>entered the rail at ${i + 1}</em></span></li>`);
        else if (was > i) rows.push(`<li><span class="sign sign--up">↑</span><span><b>${esc(productName(p))}</b> <em>${was + 1} → ${i + 1}</em></span></li>`);
      });
      prev.forEach((id, i) => { if (!order.includes(id) && productOf(id)) rows.push(`<li><span class="sign sign--out">−</span><span><b>${esc(productName(productOf(id)))}</b> <em>left the rail (was ${i + 1})</em></span></li>`); });
      node.innerHTML = roomLine + (rows.slice(0, 6).join('') || '<li class="delta-none">The rail held its order on this answer.</li>');
      node.hidden = false;
    }
    function roomsOn(order) {
      const out = {};
      for (const id of order) { const r = roomOf(productOf(id)); if (r) out[r] = (out[r] || 0) + 1; }
      for (const [room] of POOL) if (!(room in out)) out[room] = 0;
      return out;
    }
    function fitNote() {
      const node = $('p1FitNote');
      if (!node) return;
      const fit = S.grid.fit;
      node.innerHTML = fit
        ? `<b class="p1-fit-hidden">Hidden: ${S.grid.hidden.length} wider than your space</b> (${fit} in, declared by you, never inferred)${S.grid.unknown ? ` · ${S.grid.unknown} without a listed width are kept, unmeasured` : ''} · the engine ranks what fits`
        : 'Your measurement is yours: declared, never inferred. A TV wider than your space leaves the grid, and the page says how many.';
      const input = $('p1FitWidth');
      if (input && document.activeElement !== input) input.value = fit ? String(fit) : '';
    }

    // ── The arrival line: her real place, the brand's sales there, the census never scored ─
    function arrivalParts() {
      const c = state.coldstart;
      if (!c) return null;
      const asserted = Boolean(state.ctx.region);
      const override = asserted && flags.region && state.ctx.region === flags.region;
      const located = !asserted && c.region && c.region.source === 'edge' && c.region.key;
      const name = panels.coldLabel() || (located ? c.region.key : null);
      if (!name) return null;
      const how = override ? 'a rehearsal override, asserted and labelled' : asserted ? 'asserted, not observed' : located
        ? (transport.localRuntime ? 'from the request (the local runtime’s stand-in)' : 'from the request') : 'no region on this request';
      const lead = (c.lean && c.lean.inForce !== false && c.lean.leaders) || null;
      const band = lead && lead.sizeBand ? (/^up-to-(\d+)/.test(lead.sizeBand) ? `up to ${lead.sizeBand.replace(/^up-to-/, '')}-inch` : /-and-up$/.test(lead.sizeBand) ? `${lead.sizeBand.split('-')[0]}-inch and up` : `${lead.sizeBand.split('-')[0]}-inch`) : null;
      const leans = lead && lead.type ? `${TYPE[lead.type] || lead.type}${band ? ` ${band}` : ''}` : null;
      const synthetic = c.lean && /synthetic/i.test(`${c.lean.dataSource || ''} ${c.lean.label || ''}`);
      return { name, how, leans, synthetic, asserted };
    }
    function arrivalLine() {
      const node = $('p1Arrival');
      if (!node) return;
      const a = arrivalParts();
      node.hidden = !a || !transport.cur();
      if (!a) return;
      node.innerHTML = `<b>${esc(a.name)}</b>, ${esc(a.how)}${a.leans ? `; your sales here lean <b>${esc(a.leans)}</b>` : '; no regional lean in force here'}; census shown, not scored${a.leans ? ` <span class="p1-tag">${a.synthetic ? 'synthetic → warehouse' : 'this worker’s own'}</span>` : ''}`;
    }

    // ── Beat 2's region: of the configured contrast regions, the first whose sales lean differently from hers ─
    /** Read off the cold-start panel for each (aggregate, never the individual); else the first that is not hers. Asserted only by the beat, labelled. */
    async function pickContrast() {
      const mine = (state.coldstart && state.coldstart.lean && state.coldstart.lean.leaders) || {};
      const sig = (l) => `${l.type || ''}|${l.sizeBand || ''}`;
      const ownK = flags.region || (state.own && state.own.key) || (state.coldstart && state.coldstart.region && state.coldstart.region.key) || null;
      let first = null;
      for (const key of contrastList()) {
        if (key === ownK) continue;
        if (!first) first = key;
        const r = await transport.api(`${SITE.api.coldstart}?region=${encodeURIComponent(key)}`, undefined, { visitor: transport.cur() });
        const l = r.ok && r.body && r.body.lean && r.body.lean.leaders;
        if (l && sig(l) !== sig(mine)) { S.contrast = { key, leans: l }; return key; }
      }
      S.contrast = first ? { key: first, leans: null } : null;
      return first;
    }
    const contrastNow = () => S.contrastAsk || (S.contrastAsk = pickContrast().catch(() => null));

    // ── The before/now rows (the kit's deltas), for the tiles and the four ───
    const slotState = (slot) => S.home.slots[slot] || (S.home.slots[slot] = { previous: null, current: null, prevDecisions: null, curDecisions: null });
    /** Why a card left, read off the catalog in force and the receipt's own candidates: the page tests no rule of its own. */
    function wentWhy(cid) {
      const p = pieceOf({ customerContentId: cid });
      if (!p) return 'left the catalog in force';
      if (p.window && p.window.to && Date.parse(p.window.to) <= Date.now()) return 'its window closed, by the catalog';
      if (p.inStock === false) return 'out of stock, by the catalog';
      const set = S.home.set;
      const cands = new Set();
      if (set) for (const d of set.decisions) for (const c of arr((recOf(d) || {}).candidates)) cands.add(c.contentId);
      if (cands.size && cands.has(p.id)) return 'still a candidate, outranked';
      return 'outranked on this answer';
    }
    const rowCache = {};
    function rowFor(slot) {
      if (!$(`p1Ghosts-${slot}`) || !$(`p1Deltas-${slot}`)) return null;
      if (rowCache[slot] && rowCache[slot].before === $(`p1Ghosts-${slot}`)) return rowCache[slot];
      const unit = slot === 'deals' ? 'container' : 'position';
      rowCache[slot] = {
        state: () => slotState(slot),
        get: () => ({ before: slotState(slot).previous, after: slotState(slot).current || [] }),
        set: () => S.home.set,
        mode: 'ghosts', before: $(`p1Ghosts-${slot}`), deltas: $(`p1Deltas-${slot}`), unit, pins: true, swaps: false, leftFirst: true,
        opening: { sign: '·', cls: 'in', what: slot === 'deals' ? 'The opening four' : 'The opening tiles', why: transport.cur() && transport.cur().fresh ? 'a fresh visitor: nothing sent' : 'the first decision this visitor was served' },
        emptyBefore: 'She had not seen it yet.',
        left: (b, i) => `left ${unit} ${i + 1} · ${wentWhy(b.id)}`,
        lead: () => (slot === 'deals' && S.lead && !S.quiet ? S.lead : '') + (slot === 'deals' && !S.quiet ? (deltas.superseded('deals') || '') : ''),
        held: { title: (d) => (pieceOf(d) || {}).title || d.customerContentId, index: (d) => transport.bySlot(S.home.set, slot).indexOf(d) },
        nothing: { text: slot === 'deals' ? 'Nothing moved in the four.' : 'The tiles held their order.' },
        pending: 'the homepage has not been asked again yet',
        beforeRow: { row: $(`p1Before-${slot}`), label: $(`p1NowLabel-${slot}`), four: $(`p1BeforeCards-${slot}`), card: (d, i) => beforeCard(slot, d, i) },
        title: (d) => (pieceOf(d) || {}).title || d.customerContentId,
        titleOfId: (id) => (pieceOf({ customerContentId: id }) || {}).title || id,
      };
      return rowCache[slot];
    }
    /** A card as it was before this press, for the full-size before row: no control, no decision of its own now. */
    function beforeCard(slot, d, i) {
      const piece = pieceOf(d) || {}, prod = productOfPiece(piece, d.customerContentId);
      return `<article class="p1-before"><span class="p1-before-n">${i + 1}</span>${prod ? artHtml(prod, slot === 'deals' ? 'p1-art--deal' : 'p1-art--tile') : ''}<h4>${esc(piece.title || d.customerContentId)}</h4></article>`;
    }
    function homeRows() {
      const out = {};
      for (const slot of ['category-rail', 'deals']) { const r = rowFor(slot); if (r) out[slot] = r; }
      return out;
    }

    // ── Her shortlist: the products she opened on this device, as the page sent them ─
    const sendRaw = transport.send;
    transport.send = (type, data, v = transport.cur()) => {
      if (type === 'product_view' && v && data && data.productId && !v.fresh) {
        v.p1Shortlist = v.p1Shortlist || [];
        if (!v.p1Shortlist.some((s) => s.id === data.productId)) {
          v.p1Shortlist.push({ id: String(data.productId), at: Date.now(), price: priceNum(productOf(data.productId)), catalog: state.engine });
        }
      }
      return sendRaw(type, data, v);
    };
    const shortlist = () => arr((transport.cur() || {}).p1Shortlist).slice(-8);   // the last eight she opened, in the order she opened them
    const liveAt = (p, at) => (!p.window || ((!p.window.from || Date.parse(p.window.from) <= at) && (!p.window.to || Date.parse(p.window.to) > at)))
      && !(p.lifecycle && p.lifecycle.status && p.lifecycle.status !== 'live');
    /** The offers that speak about a product in a catalog: promotions featuring it, and the product page's offers gated on its family. */
    function offersFor(p, doc, at) {
      const fam = field(p, SITE.products.family);
      return arr(doc && doc.pieces).filter((x) => x.type === 'promotion' && liveAt(x, at)
        && (arr(x.featuredProductIds).includes(idOf(p)) || arr(x.eligibleWhen && x.eligibleWhen.context && x.eligibleWhen.context.family).includes(fam)));
    }
    /** A newer model in the same TV series and size, as the feed lists it (C5 → C6), or null. */
    function newerOf(p) {
      const series = String(field(p, 'attributes.series') || ''), m = /^([a-z]+)(\d)$/.exec(series);
      if (!m || field(p, 'attributes.category') !== 'tvs') return null;
      const next = `${m[1]}${Number(m[2]) + 1}`;
      return state.products.find((x) => field(x, 'attributes.category') === 'tvs' && field(x, 'attributes.series') === next && x.sizeInches === p.sizeInches) || null;
    }
    function changes() {
      const now = Date.now();
      return shortlist().map((s) => {
        const p = productOf(s.id);
        if (!p) return null;
        const then = offersFor(p, s.catalog, s.at), nowOffers = offersFor(p, state.engine, now);
        const nowIds = new Set(nowOffers.map((x) => x.id)), thenIds = new Set(then.map((x) => x.id));
        const daysLeft = (x) => (x.window && x.window.to ? Math.max(0, Math.ceil((Date.parse(x.window.to) - now) / 86400000)) : null);
        return { id: s.id, p, priceThen: s.price, priceNow: priceNum(p),
          ended: then.filter((x) => !nowIds.has(x.id)), running: nowOffers.filter((x) => thenIds.has(x.id)).map((x) => ({ x, left: daysLeft(x) })),
          started: nowOffers.filter((x) => !thenIds.has(x.id)), newer: newerOf(p) };
      }).filter(Boolean);
    }
    function changesFacts() {
      const c = changes();
      const moved = c.filter((x) => x.priceThen !== null && x.priceNow !== null && x.priceThen !== x.priceNow);
      const ended = c.reduce((n, x) => n + x.ended.length, 0), running = c.reduce((n, x) => n + x.running.length, 0);
      const newer = c.filter((x) => x.newer);
      return { count: c.length, ended, running, moved: moved.length, newer: newer.length,
        line: c.length ? [`${c.length} on her shortlist`, ended ? `${ended} offer${ended === 1 ? '' : 's'} on it ended` : 'no offer on it ended',
          running ? `${running} still running` : null, moved.length ? `${moved.length} price${moved.length === 1 ? '' : 's'} moved` : 'every price held, the catalog’s',
          newer.length ? `a newer model listed for ${newer.length}` : null].filter(Boolean).join(' · ') : null };
    }
    function openChanges() {
      const c = changes();
      const when = S.clock ? `${S.clock.days} days later, by the labelled clock jump` : 'since she looked';
      const body = c.map(({ p, priceThen, priceNow, ended, running, started, newer }) => `<div class="p1-chg">
          ${artHtml(p, 'p1-art--chg')}<div><h3>${esc(productName(p))}</h3>
          <p class="srow"><span>Price</span><b>${priceThen !== null && priceNow !== null && priceThen !== priceNow ? `${money(priceThen)} → ${money(priceNow)}` : `${money(priceNow)}, held`}</b></p>
          ${ended.map((x) => `<p class="srow p1-chg-out"><span>Ended</span><b>${esc(x.title)}</b></p>`).join('')}
          ${running.map(({ x, left }) => `<p class="srow"><span>Still running</span><b>${esc(x.title)}${left !== null ? ` · ${left} day${left === 1 ? '' : 's'} left` : ''}</b></p>`).join('')}
          ${started.map((x) => `<p class="srow p1-chg-in"><span>New offer</span><b>${esc(x.title)}</b></p>`).join('')}
          ${newer ? `<p class="srow p1-chg-in"><span>Newer model</span><b>${esc(productName(newer))}</b></p>` : ''}
          <button type="button" class="btn btn--line btn--sm" data-open="${esc(idOf(p))}" data-ctl="chg-${esc(idOf(p))}">Open it again</button></div></div>`).join('');
      sheets.open('changes', `<p class="sk">Your shortlist · ${esc(when)}</p><h2>What changed while you were away</h2>
        <p>Read off the documents in force: the offers that ended and the ones still running, by the catalog’s own windows; the prices are the catalog’s, the same for everyone, and nothing here decides one.</p>
        ${body || '<p class="slot-empty">Nothing on her shortlist yet: it is what she opens.</p>'}`);
    }

    // ── The controls this section owns ──────────────────────────────────────
    async function control(t) {
      if (t.closest && t.closest('.p1-menu')) closeMenus();                     // a pick in a menu: the menu closes, the pick opens
      if (t.dataset.act === 'p1-menu') {
        const key = t.dataset.menu, m = $(`menu-${key}`);
        if (!m) return true;
        const open = m.hidden;
        closeMenus(open ? key : undefined);
        m.hidden = !open;
        const b = document.querySelector(`[data-ctl="nav-${key}"]`);
        if (b) b.setAttribute('aria-expanded', String(open));
        if (open) panels.note('opened', `The ${MENUS[key].label} menu`, 'the header: static, not personalised');
        return true;
      }
      if (t.dataset.act === 'p1-fit') {
        const raw = t.dataset.fit !== undefined ? t.dataset.fit : ($('p1FitWidth') || {}).value;
        const w = num(raw);
        S.grid.fit = Number.isFinite(w) && w >= 20 && w <= 140 ? Math.round(w * 2) / 2 : null;
        panels.note('declared', S.grid.fit ? `her space: ${S.grid.fit} in wide` : 'her space: cleared', 'a measurement she gave: declared, never inferred');
        const rail = railsOf(GRID)[0];
        if (rail) await sortAndPaint(GRID, rail, transport.cur());
        return true;
      }
      if (t.dataset.act === 'p1-changes') { openChanges(); panels.note('opened', 'What changed while she was away', 'her shortlist, read off the documents in force'); return true; }
      return undefined;
    }

    // ── A fresh visitor beside her, for Compare (beat 4, and the drawer's tool) ─
    function paintQuietly(key, f, set, rails) {
      const keep = { who: state.who, vector: state.lastVector, home: S.home, grid: S.grid, scroll: window.scrollY, url: location.pathname + location.search };
      state.who = f.key;
      state.lastVector = {};
      S.quiet = true;
      const freshState = (x) => ({ ...x, set, slots: {}, heroWas: null });
      if (own(key).key === HOME) { S.home = { ...freshState(S.home), rail: rails['for-you'] || S.home.rail }; }
      else S.grid = { ...S.grid, set, rail: rails['tv-grid'] || S.grid.rail };
      for (const s of slotsOf(key)) renderSlot(s, transport.bySlot(set, s.slot));
      for (const rail of railsOf(key)) void paintRail(rail);
      const strips = [...document.querySelectorAll('.p1-changes, #p1RailDeltas')].map((n) => [n, n.hidden]);
      strips.forEach(([n]) => { n.hidden = true; });
      return () => {
        state.who = keep.who; state.lastVector = keep.vector; S.home = keep.home; S.grid = keep.grid; S.quiet = false;
        strips.forEach(([n, h]) => { n.hidden = h; });
        const hers = state.sets[key];
        if (hers) {                                    // her answer, her strips and her chips as she left them: no rotation
          S.restoring = true;
          try { for (const s of slotsOf(key)) renderSlot(s, transport.bySlot(hers, s.slot)); } finally { S.restoring = false; }
        }
        for (const rail of railsOf(key)) void paintRail(rail);
        refreshReceipts();
        try { window.scrollTo({ top: keep.scroll, behavior: 'instant' }); } catch { /* optional */ }
        try { if (location.pathname + location.search !== keep.url) history.replaceState({ [SITE.slug]: true }, '', keep.url); } catch { /* sandboxed */ }
      };
    }
    async function freshVisitor() {
      let m;
      try { m = await demo.compare.load(); } catch (error) { say(`Compare could not load the compare kit: ${String(error.message || error)}`, 'bad'); return; }
      const ext = (LANES.hooks.fresh || {})[state.viewPage] || null;   // another section's page: its own ask and quiet paint
      const key = ext ? state.viewPage : state.viewPage && own(state.viewPage) && [HOME, GRID].includes(own(state.viewPage).key) ? state.viewPage : null;
      const title = ext ? (ext.title || 'Her page, and a fresh visitor’s') : key === GRID ? 'Her TV grid, and a fresh visitor’s' : 'Her homepage, and a fresh visitor’s';
      if (!transport.cur() || !key) {
        m.showMessage({ title, heading: 'No shopper on the homepage or the grid yet:', text: 'Fresh visitor sets a stranger’s homepage or TV grid beside hers. Bring her in with Next, then press it again.' });
        throw new Error('open the homepage or the TV grid with her first: Compare puts a fresh visitor beside her there');
      }
      const wasBusy = state.busy;
      state.busy = true;
      demo.compare.supersede();
      say('a fresh visitor is asking…');
      const keys = ['Her page', 'A fresh visitor, same region'];
      m.showWaiting({ title, heading: 'Her page, then a fresh visitor’s', text: 'The same region, nothing sent.' });
      let restore = null;
      try {
        await demo.compare.takeBaseline('tool');
        const f = await transport.mintVisitor('F', transport.directEntry(), 'Fresh visitor');
        f.fresh = true;
        panels.note('compared', 'A fresh visitor beside her', 'direct · consent granted · no event sent · the same region · her page is not asked again');
        if (ext) {
          const set = await ext.ask(f);
          restore = await ext.paint(f, set);
        } else {
          const r = await snapshot(key, f, homeExtra(key));
          if (!r.ok) throw new Error(r.error);
          const rails = {};
          for (const rail of railsOf(key)) rails[rail.slot] = await askRail(rail, f, null);
          restore = paintQuietly(key, f, r.set, rails);
        }
        await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
        const live = snapshotOfPage();
        const theirs = m.captureFrame($('site'), { kind: 'fresh', label: demo.compare.frameLabel, meta: () => ({ where: whereNow(), who: 'Fresh visitor', snap: live }) });
        await theirs.cloned;
        restore(); restore = null;
        await m.openCompare($('site'), { now: theirs, title, tags: { before: keys[0], now: keys[1] },
          foot: 'Same page, same moment, same region, same catalog and the same public prices. The fresh visitor arrived direct and has sent nothing: the region’s prior alone. Hers, on the left, is what her visit earned.',
          details: (bf, nf) => demo.compare.columns(bf.meta && bf.meta.snap, nf.meta && nf.meta.snap, keys),
          sameNote: 'Her page and the fresh visitor’s are the same: nothing she has done weighs on it yet.',
          nearNote: 'Her page and the fresh visitor’s differ only in small print: What changed has the answers behind both.' });
        say('done', 'good');
      } catch (error) {
        say(String(error.message || error), 'bad');
        if (m.isOpen()) m.showMessage({ title, heading: 'No fresh visitor’s page:', text: String(error.message || error) });
        if (wasBusy) throw error;
      } finally {
        if (restore) { try { restore(); } catch { /* her page, as far as it can be put back */ } }
        state.busy = wasBusy;
      }
    }

    // ── The merchandiser's day and the clock jump (beats 11, 12, 13) ─────────
    const homeSlotsShown = ['hero', 'category-rail', 'deals', 'continue'];
    async function receiptsFor(set) { if (set) await transport.prefetchReceipts(set.decisions, set.asked); }
    function candidateIds(set, slots) {
      const out = new Set();
      if (set) for (const d of set.decisions) if (!slots || slots.includes(d.slot)) for (const c of arr((recOf(d) || {}).candidates)) out.add(c.contentId);
      return out;
    }
    /** What was on screen and in force as a merchandiser beat starts: the answer, its candidates, the catalog. */
    async function mark() {
      const set = S.home.set;
      await receiptsFor(set);
      S.mark = { at: Date.now(), catalog: state.engine, set,
        shown: set ? set.decisions.filter((d) => homeSlotsShown.includes(d.slot)).map((d) => ({ slot: d.slot, id: d.contentId, cid: d.customerContentId, order: d.order })) : [],
        candidates: candidateIds(set, homeSlotsShown),
        lead: set ? (transport.bySlot(set, 'deals')[0] || null) : null,
        page: state.viewPage, pageSet: state.viewPage && own(state.viewPage).key !== HOME ? state.sets[state.viewPage] || null : null, productId: state.productId };
    }
    /**
     * Beat 11 on her TV page: the offers this publish closed that the page showed her before it, and whether the page's
     * next decision still answers any of them. Read off the two answers, the one marked and the one in force now.
     */
    function pageWindows() {
      const now = Date.now();
      const before = new Map(arr(S.mark && S.mark.catalog && S.mark.catalog.pieces).map((p) => [p.id, p]));
      const closedNow = (p) => Boolean(p && p.window && p.window.to && Date.parse(p.window.to) <= now);
      const was = S.mark && S.mark.pageSet, set = S.mark ? state.sets[S.mark.page] : null;
      if (!was || !set) { S.pageWin = null; return; }
      const shownNow = new Set(set.decisions.map((d) => d.contentId));
      const closedShown = was.decisions.filter((d) => { const p = pieceById(d.contentId); return closedNow(p) && !closedNow(before.get(d.contentId)); });
      const p = productOf(S.mark.productId);
      S.pageWin = { sku: S.mark.productId, name: p ? productName(p) : S.mark.productId, ids: closedShown.map((d) => d.contentId), left: closedShown.filter((d) => !shownNow.has(d.contentId)).map((d) => bare(titleById(d.contentId))),
        still: closedShown.filter((d) => shownNow.has(d.contentId)).map((d) => bare(titleById(d.contentId))) };
      panels.note('engine', `On the ${S.pageWin.name} page`, S.pageWin.left.length ? `${S.pageWin.left.join('; ')}: window closed, gone from its offers on the next decision` : 'no closing offer was on this page');
    }
    /** Beat 11: the pieces whose window this publish closed, where each one was, and the packages the catalog holds back. */
    async function windows() {
      const now = Date.now();
      const before = new Map(arr(S.mark && S.mark.catalog && S.mark.catalog.pieces).map((p) => [p.id, p]));
      const closedNow = (p) => Boolean(p && p.window && p.window.to && Date.parse(p.window.to) <= now);
      const closed = piecesNow().filter((p) => closedNow(p) && !closedNow(before.get(p.id)));
      await receiptsFor(S.home.set);
      const shownNow = new Set((S.home.set ? S.home.set.decisions : []).map((d) => d.contentId));
      const candNow = candidateIds(S.home.set, homeSlotsShown);
      const shownBefore = new Map(arr(S.mark && S.mark.shown).map((x) => [x.id, x]));
      const rows = closed.map((p) => ({ id: p.id, title: bare(p.title), slots: arr(p.slotTypes), was: shownBefore.has(p.id) ? 'shown' : S.pageWin && S.pageWin.ids.includes(p.id) ? 'page' : (S.mark && S.mark.candidates.has(p.id)) ? 'candidate' : 'neither',
        still: shownNow.has(p.id) || candNow.has(p.id) }));
      S.windows = { at: now, rows, page: S.pageWin ? S.pageWin.left.length : null, pageName: S.pageWin ? S.pageWin.name : null, left: rows.filter((r) => r.was === 'shown' && !r.still).length, fromCandidates: rows.filter((r) => r.was === 'candidate' && !r.still).length,
        still: rows.filter((r) => r.still).length };
      // The package half: packages the catalog in force holds out of stock, the member that keeps each one incomplete, and
      // whether any answer this visit carried one (every decision and every recorded candidate the page holds).
      const seen = new Set();
      let decisions = 0, candidates = 0;
      for (const set of Object.values(state.sets)) for (const d of arr(set && set.decisions)) { seen.add(d.contentId); decisions += 1; }
      for (const rec of state.receipts.values()) for (const c of arr(rec.candidates)) { seen.add(c.contentId); candidates += 1; }
      const held = piecesNow().filter((p) => p.type === 'package' && p.inStock === false).map((p) => ({ id: p.id, title: bare(p.title),
        members: arr(p.featuredProductIds).map(productOf).filter((m) => m && m.inStock === false).map((m) => idOf(m)), appeared: seen.has(p.id) }));
      S.held = { packages: held, decisions, candidates, appeared: held.filter((h) => h.appeared).length };
      const rowText = (r) => `<b>${esc(r.title)}</b> <em>${r.still ? 'still answered: the window did not hold' : r.was === 'shown' ? `left ${r.slots.join(' and ')} on this decision` : r.was === 'page' ? 'left her TV page’s offers, above' : r.was === 'candidate' ? 'left the candidates on this decision' : 'was not in front of her; it can no longer be chosen'}</em>`;
      const pk = held.map((h) => `<b>${esc(h.title)}</b> <em>(${h.members.length ? `${esc(h.members.join(', '))} out of stock` : 'out of stock'})</em>`).join('; ');
      const pageLine = S.pageWin && (S.pageWin.left.length || S.pageWin.still.length) ? `On the ${esc(S.pageWin.name)} page: ${S.pageWin.left.length ? `<b>${S.pageWin.left.map(esc).join('</b>; <b>')}</b> left its offers on the next decision` : ''}${S.pageWin.still.length ? `${S.pageWin.left.length ? '; ' : ''}${S.pageWin.still.map(esc).join('; ')} still answered: the window did not hold` : ''}. ` : '';
      S.lead = `<li class="delta-engine"><span class="hk">The catalog’s own windows and stock, on the next decision</span>${pageLine}`
        + `${rows.length ? `Window closed: ${rows.map(rowText).join('; ')}.` : 'No window closed with this publish.'}`
        + `${held.length ? ` Never shown as complete: ${pk}: ${S.held.appeared ? `${S.held.appeared} appeared in an answer this visit` : `in none of this visit’s ${decisions} decisions or their ${candidates} recorded candidates`}.` : ''}</li>`;
      for (const slot of ['deals']) if (rowFor(slot)) deltas.render(slot);
      panels.note('engine', 'Windows and stock, on the next decision', stripTags(S.lead).slice(0, 170));
      director.sayAfter();
    }
    /** Beat 12: the pin leads; what the engine would have led with, from a ranked decision's own receipt. */
    async function pin() {
      const set = S.home.set;
      await receiptsFor(set);
      const deals = transport.bySlot(set, 'deals');
      const pinned = deals.find((d) => d.strategy === 'tenant-pinned') || null;
      const ranked = deals.filter((d) => d.strategy !== 'tenant-pinned');
      const rec = ranked.map(recOf).find((x) => x && arr(x.candidates).length) || null;
      const top = rec ? arr(rec.candidates)[0] : null;
      const nowAt = top ? deals.findIndex((d) => d.contentId === top.contentId) + 1 : 0;
      const was = S.mark && S.mark.lead;
      const ledItself = Boolean(pinned && was && was.contentId === pinned.contentId);
      S.pin = { title: pinned ? bare((pieceOf(pinned) || {}).title || pinned.customerContentId) : null, would: top ? titleById(top.contentId) : null, score: top ? top.score : null,
        nowAt: nowAt || null, agrees: Boolean(top && was && was.contentId === top.contentId), ledItself, wasLead: was ? bare((pieceOf(was) || {}).title || was.customerContentId) : null };
      const before = ledItself ? '; the pinned piece led on the engine’s own ranking a moment ago, too' : S.pin.agrees ? ', as it led a moment ago' : S.pin.wasLead ? `; ${esc(S.pin.wasLead)} led a moment ago` : '';
      S.lead = pinned ? `<li class="delta-engine"><span class="hk">The merchandiser outranks the engine, visibly</span><b>${esc(S.pin.title)}</b> is pinned to container 1 for everyone: ranking never ran for it.`
        + `${top ? ` Without the pin the engine would have led with <b>${esc(S.pin.would)}</b> (score ${fmt3(S.pin.score)}), the first choice on its own receipt${before}; it is container ${S.pin.nowAt || '—'} now.` : ' The ranked decisions’ receipts are still being written.'}</li>`
        : '<li class="delta-engine"><span class="hk">The pin</span>The slots answered without a pinned piece: the engine refused the pin, and the page shows what it answered.</li>';
      refreshReceipts();
      panels.note('tuned', S.pin.title ? `${S.pin.title} pinned` : 'the pin', S.pin.would ? `container 1 for everyone · the engine would have led with ${S.pin.would}` : 'container 1 for everyone');
      director.sayAfter();
    }
    /**
     * Beat 13: three weeks later, labelled. The windows moved back in the publish; her dials, the engine's own read now,
     * are carried three weeks on by the published memory (a = R / (R + K), R decaying by e^(−t/τ) per dimension), and
     * the return visit is asserted on every homepage question from here on. The engine's own clock stays real.
     */
    async function clockJump(args) {
      const days = num(args && args.days) || (SITE.clockJump && SITE.clockJump.days) || 21;
      await panels.renderVectors();
      const before = JSON.parse(JSON.stringify(state.lastVector || {}));
      const reg = state.registry || {};
      const K = num(reg.K) || 1.8, base = num(reg.tauMs) || 1209600000, t = days * 86400000;
      const tauOf = (dim) => { const d = arr(reg.dimensions).find((x) => x.key === dim); return num(d && d.tauMs) || base; };
      const carry = (a, dim) => { if (!(a > 0) || a >= 1) return a; const r = (a * K) / (1 - a) * Math.exp(-t / tauOf(dim)); return r / (r + K); };
      const read = (dim, value) => { const a = num(((before[dim] || {})[value]) || 0); return { dim, value, b: a, a: carry(a, dim), tau: tauOf(dim) }; };
      const rooms = ['living-room', 'laundry-room', 'kitchen'].map((x) => read('room', x)).filter((r) => r.b > 0);
      const fall = (r) => (r.b > 0 ? (r.b - r.a) / r.b : 0);
      const tv = rooms.find((r) => r.value === 'living-room'), laundry = rooms.find((r) => r.value === 'laundry-room');
      const laundryFaster = Boolean(tv && laundry && fall(laundry) > fall(tv));
      const cats = ['tvs', 'washers'].map((x) => read('category', x)).filter((r) => r.b > 0);
      const dayLabel = (ms) => `${Math.round(ms / 86400000)} days`;
      const row = (r) => `${esc(ROOM[r.value] || r.value)} ${fmt3(r.b)} → <b>${fmt3(r.a)}</b> (−${Math.round(fall(r) * 100)}%)`;   // three places, so the arithmetic can be checked by hand
      const most = rooms.reduce((m, r) => (!m || fall(r) > fall(m) ? r : m), null);   // the dial that fell furthest, named in the sentence
      const faded = most ? `the ${ROOM[most.value] || most.value} faded furthest (−${Math.round(fall(most) * 100)}%), ${rooms.filter((r) => r !== most).map((r) => `the ${ROOM[r.value] || r.value} −${Math.round(fall(r) * 100)}%`).join(', ') || 'the only room she had'}` : null;
      S.clock = { days, rooms, laundryFaster, faded, head: `${days} days later · a labelled clock jump`,
        html: `${rooms.length ? `Her room dials, three weeks on by the published memory (τ ${dayLabel(tauOf('room'))} on room, K ${K}): ${rooms.map(row).join(' · ')}.` : 'She had no room dial to carry: nothing about her to fade.'}`
          + `${tv && laundry ? ` ${laundryFaster ? '<b>Laundry faded faster than TV</b>: less evidence fades further on the same memory.' : 'Laundry did not fade faster than TV on these dials.'}` : ''}`
          + `${cats.length ? ` Category, a ${dayLabel(tauOf('category'))} memory: ${cats.map((r) => `${esc(r.value)} ${fmt2(r.b)} → ${fmt2(r.a)}`).join(' · ')}.` : ''}`
          + ' The catalog’s windows moved back in one publish; the engine decides on its own clock, which is real, so the meters beside the page show her dials as it holds them.' };
      S.returned = true;
      panels.note('asserted', 'ctx.visit = return', `the clock jump: ${days} days later, labelled · a return visit in the same browser, asserted on the homepage`);
      await ask(homeKey());
      S.lead = `<li class="delta-engine"><span class="hk">${esc(S.clock.head)}</span>${S.clock.html}</li>`;
      if (rowFor('deals')) deltas.render('deals');
      panels.note('engine', 'Three weeks on, by the published memory', stripTags(S.clock.html).slice(0, 170));
      director.sayAfter();
    }

    // ── What Why these and Compare read on these two pages ──────────────────
    function railRows(R, rail) {
      const take = rail.take;
      return (R.order ? shownOrder(rail, R) : []).slice(0, take).map((id, i) => {
        const it = arr(R.items).find((x) => x.id === id);
        const regs = arr(it && it.drivers).filter((x) => x.dim === 'regional');
        const reg = regs.length ? { dim: 'regional', value: regs[0].value, a: num(regs[0].a), weight: Math.round(regs.reduce((s, x) => s + num(x.w), 0) * 1e4) / 1e4 } : null;
        const drivers = [...arr(it && it.drivers).filter((x) => x.dim !== 'regional').map((x) => ({ dim: x.dim, value: x.value, a: x.a, weight: x.w })), ...(reg ? [reg] : [])];
        return { customerContentId: id, slot: rail.slot, order: i, score: num(it && it.score), strategy: 'sort', explain: { drivers, note: it ? `site position ${it.feedRank + 1}` : undefined } };
      });
    }
    function why(pageKey) {
      if (!pageKey || !own(pageKey) || ![HOME, GRID].includes(own(pageKey).key)) return null;
      const set = state.sets[pageKey] || null;
      const groups = set ? slotsOf(pageKey).map((s) => [s.label, transport.bySlot(set, s.slot)]).filter(([, d]) => d.length) : [];
      for (const rail of railsOf(pageKey)) {
        const R = railState(rail);
        if (R.status === 'sorted') groups.push([`${rail.label} · POST /sort${leanLine(R) ? ` · ${leanLine(R)} · λ ${fmt2(num(R.regional.lambda))}` : ''}`, railRows(R, rail)]);
      }
      return { set, lead: own(pageKey).key === HOME && !S.quiet ? (deltas.superseded('deals') || null) : null, groups };
    }
    function snap(pageKey) {
      if (!pageKey || !own(pageKey) || ![HOME, GRID].includes(own(pageKey).key)) return null;
      const set = state.sets[pageKey] || null;
      const v = transport.cur();
      const vector = [];
      for (const [dim, values] of Object.entries(state.lastVector || {})) for (const [value, a] of Object.entries(values || {})) vector.push({ dim, value, a: Number(a) || 0 });
      vector.sort((x, y) => y.a - x.a);
      const lists = set ? slotsOf(pageKey).map((s) => [s.label, transport.bySlot(set, s.slot).map((d) => ({ id: d.customerContentId, t: titleOf(d), s: d.score }))]) : [];
      for (const rail of railsOf(pageKey)) { const R = railState(rail); lists.push([rail.label, (R.order ? shownOrder(rail, R) : []).map((id) => ({ id, t: productName(productOf(id)) || id, s: null }))]); }
      return { who: demo.compare.whoNow(), at: Date.now(), where: whereNow(), vector: vector.slice(0, 4), intent: v && v.intent, region: panels.regionShown(), lists };
    }
    function regionalDriver() {
      const set = S.home.set;
      return set ? transport.bySlot(set, 'deals').map((d) => ((d.explain && d.explain.drivers) || []).find((x) => x.dim === 'regional')).find(Boolean) || null : null;
    }

    /** Her TV page: the last TV she opened on this device (P2's walk TV when she has opened none). */
    function lastTv() {
      const tvs = arr((transport.cur() || {}).p1Shortlist).map((x) => x.id).filter((id) => field(productOf(id), 'attributes.category') === 'tvs');
      if (tvs.length) return tvs[tvs.length - 1];
      const p2 = LANES.facts.p2 ? (LANES.facts.p2() || {}).tv : null;
      return (p2 && p2.sku) || null;
    }
    // ── The facts the beats read ({{p1.*}}): every name always present, null when not set ─
    function facts() {
      const v = transport.cur();
      const opened = new Set(arr(v && v.p1Shortlist).map((s) => s.id));
      const gridOrder = (S.grid.rail.order && railsOf(GRID)[0] ? shownOrder(railsOf(GRID)[0], S.grid.rail) : []).filter((id) => productOf(id));
      const washer = MENUS.laundry.lead.find((id) => productOf(id)) || (menuPicks('washers', 'front-load')[0] ? idOf(menuPicks('washers', 'front-load')[0]) : null);
      const a = arrivalParts();
      const order = S.home.rail.order && railsOf(HOME)[0] ? shownOrder(railsOf(HOME)[0], S.home.rail) : [];
      const rooms = order.length ? roomsOn(order) : null;
      const tiles = slotState('category-rail');
      const tilesMoved = Boolean(tiles.previous && tiles.current && tiles.previous.map((x) => x.id).join('|') !== tiles.current.map((x) => x.id).join('|'));
      const ch = changesFacts();
      const next = gridOrder.find((id) => !opened.has(id)) || gridOrder[0] || null;
      const attrsOf = (id) => (id && productOf(id) ? productAttrs(productOf(id)) : null);
      return {
        grid: { next, nextAttrs: attrsOf(next), count: gridOrder.length || null, lean: leanLine(S.grid.rail) || null },
        washer, washerName: washer ? productName(productOf(washer)) : null, washerAttrs: attrsOf(washer),
        arrival: { name: a ? a.name : null, how: a ? a.how : null, leans: a ? a.leans : null, sentence: a ? `${a.name}, ${a.how}${a.leans ? `; your sales here lean ${a.leans}` : ''}; census shown, not scored` : null },
        home: { rail: rooms ? Object.entries(rooms).map(([room, n]) => `${ROOM[room] || room} ${n}`).join(' · ') : null,
          twoRooms: Boolean(rooms && rooms['living-room'] > 0 && rooms['laundry-room'] > 0), tilesMoved, lean: leanLine(S.home.rail) || null },
        contrast: S.contrast ? S.contrast.key : null, contrastName: S.contrast ? (US[S.contrast.key] || S.contrast.key) : null,
        tvPage: lastTv(), tvName: lastTv() ? productName(productOf(lastTv())) : null,
        windows: { page: S.windows ? S.windows.page : null, pageName: S.windows ? S.windows.pageName : null, closed: S.windows ? S.windows.rows.length : null, left: S.windows ? S.windows.left : null, still: S.windows ? S.windows.still : null,
          held: S.held ? S.held.packages.length : null, heldShown: S.held ? S.held.appeared : null },
        pin: { title: S.pin ? S.pin.title : null, would: S.pin ? S.pin.would : null, nowAt: S.pin ? S.pin.nowAt : null },
        clock: { laundryFaster: S.clock ? S.clock.laundryFaster : null, faded: S.clock ? S.clock.faded : null, returned: S.returned || null },
        shortlist: { count: ch.count || null, line: ch.line, ended: ch.ended || null },
      };
    }

    // ── Registration, once ──────────────────────────────────────────────────
    for (const key of [HOME, GRID]) LANES.ask[key] = (k) => ask(k);
    Object.assign(LANES.render, { hero: renderHero, 'category-rail': renderTiles, deals: renderDeals, continue: renderContinue, 'grid-promo': renderGridPromo });
    Object.assign(LANES.verbs, { freshVisitor: () => freshVisitor(), p1Mark: () => mark(), p1Windows: () => windows(), p1PageWindows: () => pageWindows(), p1Pin: () => pin(), p1ClockJump: (a) => clockJump(a),
      p1Changes: () => { openChanges(); panels.note('opened', 'What changed while she was away', 'her shortlist, read off the documents in force'); },
      p1AfterChanges: () => director.sayAfter(), p1Contrast: () => contrastNow() });
    LANES.controls.push(control);
    LANES.compareTools.push(['fresh', 'Fresh visitor', () => { void freshVisitor().catch(() => { /* said on the status line */ }); }]);
    LANES.beforeBeat.push((b) => {
      S.lead = null; closeMenus();
      if (state.sheet && state.sheet.kind === 'changes') sheets.dismiss();
      if (b && b.data && b.data.arrives) Object.assign(S, { pageWin: null, contrast: null, contrastAsk: null, mark: null, windows: null, held: null, pin: null, clock: null, returned: false,
        home: { set: null, slots: {}, heroWas: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null } },
        grid: { set: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null }, fit: null, hidden: [], unknown: 0 } });   // a new arrival starts the walk again
    });
    LANES.facts.p1 = facts;
    Object.assign(LANES.hooks, { regionalDriver, why, snapshot: snap });
    Object.assign(LANES.rows, homeRows());
    LANES.boot.push(async (entry) => {
      await data();
      ensureChrome();
      Object.assign(LANES.rows, homeRows());
      for (const rail of railsOf(homeKey())) void paintRail(rail);
      // A direct load of the grid (index.html at /oh/?view=tvs) is a real arrival on it: a visitor, the grid, the live answer.
      const view = new URLSearchParams(location.search).get('view');
      if (entry === 'home' && view && pageOf(view) && own(view).key === GRID) {
        await openPage(view).then(() => panels.loadColdStart()).then(() => { arrivalLine(); for (const rail of railsOf(view)) void paintRail(rail); })
          .then(() => say('ready · the TV grid was decided live for a direct visitor; Next starts the walkthrough', 'good'))
          .catch((error) => { engineDown(String(error.message || error)); say(String(error.message || error), 'bad'); });
      }
    });
    return { paintRail, homeRows, freshVisitor, state: S };
  })();
  /** The before/now rows of the homepage (P2's merge, rows: () => ({ ...homeRows(), ...productRows() }), reads this). */
  function homeRows() { return P1.homeRows(); }

  // ── product pages (P2) ────────────────────────────────────────────────────
  // The buy box (off limits) and the decided modules below it, for the TV, the washer and the range on one template.
  // Lane P2 writes here (and the facts it owns).
  //
  // The page, top to bottom. product.html carries the containers; index.html and m.html get them the first time a
  // product page opens there (ensureProductChrome), so a beat that walks from the homepage paints the same page.
  //   the buy box     OFF LIMITS: title, image, price, sizes or colours, Add to Cart or Find a Retailer as the feed says,
  //                   the financing line as the site shows it. The catalog's, the same for everyone, never decided.
  //   the type switch static: this kind's other types, each its type's best seller at this price tier (the site's rule).
  //   pdp-modules     DECIDED, in the order the engine returned: companions (the merchandiser's relation in
  //                   products.json, shown as a rule), packages, protection, installation, haul-away, the comparisons,
  //                   the tools, where-to-buy (P3's body). Every module carries its receipt, with E1's completes line
  //                   when the engine preferred it because it completes this product. A module the last page of the
  //                   same room showed, whose rule does not serve this product, is shown withdrawn with its reason,
  //                   and is not decided.
  //   pdp-offers      DECIDED.
  //   the specs       static: the feed and D2's specs.json merged by sku; the fit tool here when the engine did not
  //                   decide it on this page.
  // The page asks through the kit's context hook (transport.ask(key, v, { context })): ctx.anchor = the sku and
  // ctx.family = the row's family, and ctx.fit = her declared width once she has entered one. It never ranks: the
  // modules come in the engine's order, the products inside every module in POST /sort's order (one call per page
  // view), and her declared width filters, labelled declared, never inferred.

  /**
   * The walk's products (beats 5–10), each chosen for what its data can show. WM6500HWA: the front-load washer
   * whose width is in the feed itself (the lead's ruling for beat 10), with dryers in both fuels, the pedestal, the
   * stacking kit and two sets. OLED65C6PUA: the TV whose VESA pattern the crawl names (the mount relation).
   * LSGL6335X: D1's sample range, with packages that cost less than their pieces. 65QNED8MBAA: a 2026 Mini LED QNED
   * (bright room), sold here, with a 75-inch one size up in its own series.
   */
  const P2_WALK = { washer: 'WM6500HWA', tv: 'OLED65C6PUA', range: 'LSGL6335X', qned: '65QNED8MBAA', closet: 28, distanceFt: 9 };
  /**
   * The financing line, as the site shows it (docs/lg/research/lg-site-recon.md): every page sold here carries
   * Affirm, and the C6's page renders the as-low-as line recorded on 2026-10-01. Never decided, never computed here.
   */
  const FINANCING = { seen: { OLED65C6PUA: '0% APR or as low as $83/mo with Affirm' }, cart: 'Financing with Affirm, as the site offers it at checkout' };
  /** The merchandiser's relation behind each companion module, and the rule as the card states it. */
  const P2_REL = {
    'mod-laundry-dryer': ['dryers', (p) => `a washer goes with the dryers of its own series${p.modelFamily ? ` (${p.modelFamily})` : ''}, in gas, electric or heat pump`],
    'mod-laundry-washer': ['washers', (p) => `a dryer goes with the washers of its own series${p.modelFamily ? ` (${p.modelFamily})` : ''}`],
    'mod-laundry-pedestal': ['pedestals', () => 'front-load pairs only: the storage drawer and the SideKick pedestal washer in the same colour'],
    'mod-laundry-stacking': ['stackingKits', () => 'front-load pairs only: the stacking kit the product page names'],
    'mod-laundry-pair-price': ['sets', () => 'the laundry sets this machine belongs to, with the set price beside its pieces’ sum when that sum is known'],
    'mod-tv-soundbar': ['soundbars', (p) => `a TV goes with soundbars from its series’ tier${p.seriesTier ? ` (${p.seriesTier})` : ''}${p.attributes && p.attributes.type === 'qned' ? '; a QNED leads with the soundbar designed for QNED' : ''}`],
    'mod-tv-mount': ['mounts', (p) => (p.vesa ? `a wall mount that lists this TV’s VESA pattern, ${String(p.vesa).replace('x', ' x ')} mm` : 'a wall mount that lists the TV’s VESA pattern; this TV’s pattern is not in our data')],
    'mod-range-microwave': ['microwaves', () => 'the over-the-range microwave LG packages with this range first, then the same finish'],
    'mod-range-dishwasher': ['dishwashers', () => 'the dishwasher LG packages with it first, then the same finish family'],
    'mod-kitchen-range': ['ranges', () => 'the range LG packages with it first, then the same finish family'],
  };
  /** The categories whose products a declared width can rule out (machines that stand in a space). */
  const FIT_CATEGORIES = new Set(['washers', 'dryers', 'washtowers', 'washer-dryer-combos', 'ranges', 'dishwashers']);
  const FIT_CHIPS = { 'laundry-room': [24, 27, 28, 30, 32], kitchen: [24, 30, 33, 36] };
  /** The families that are parts of a room rather than its machines: never a type to switch to. */
  const PART_FAMILIES = new Set(['pedestal-washer', 'pedestal', 'stacking-kit', 'tv-mount', 'refrigerator']);
  const P2 = { docs: null, display: new Map(), images: new Map(), sort: null, last: null, prevRoom: null, gone: [], sizeUp: null,
    rows: { 'pdp-modules': {}, 'pdp-offers': {} } };

  // ── Its documents: D1's display catalog (packages' prices), D2's image index ──
  function loadProductDocs() {
    if (!P2.docs) {
      P2.docs = Promise.all([transport.tryJson(`${BASE}catalog.json`), transport.tryJson(`${BASE}img/index.json`)]).then(([cat, idx]) => {
        for (const piece of arr(cat && cat.pieces)) if (piece && piece.customerContentId) P2.display.set(piece.customerContentId, piece.display || {});
        for (const [sku, entry] of Object.entries((idx && idx.products) || {})) P2.images.set(String(sku), entry);
        state.sources.images = idx ? 'img/index.json' : 'none';
      });
    }
    return P2.docs;
  }

  // ── Small readers over the feed (with specs.json merged over it by sku) ───
  const attrOf = (p, k) => (p && p.attributes ? p.attributes[k] : undefined);
  const nameOf = (p) => (p ? String(productName(p) || idOf(p)) : '');
  /** The product page's own title (specs.json) where D2 read one, else the feed's name. */
  const titleOfProduct = (p) => (p ? String(p.title || productName(p) || idOf(p)) : 'Product');
  const words = (s) => String(s || '').replace(/-/g, ' ');
  const familyWords = (f) => ({ 'front-load-washer': 'front-load washers', 'top-load-washer': 'top-load washers', 'front-load-dryer': 'front-load dryers',
    'rear-control-dryer': 'rear-control dryers', 'pedestal-washer': 'pedestal washers', 'oled-tv': 'OLED TVs', 'qned-tv': 'QNED TVs', 'uhd-tv': '4K UHD TVs',
    'micro-rgb-tv': 'Micro RGB TVs', 'otr-microwave': 'over-the-range microwaves', 'gas-range': 'gas ranges', 'electric-range': 'electric ranges',
    'induction-range': 'induction ranges', 'dual-fuel-range': 'dual-fuel ranges', 'front-control-dishwasher': 'front-control dishwashers',
    'top-control-dishwasher': 'top-control dishwashers', 'washtower': 'WashTowers', 'washer-dryer-combo': 'washer-dryer combos' }[f] || `${words(f)}s`);
  const typeWords = (t) => ({ oled: 'OLED', qned: 'QNED', uhd: '4K UHD', hd: 'HD', 'micro-rgb': 'Micro RGB', 'front-load': 'Front load', 'top-load': 'Top load',
    'slide-in': 'Slide-in', freestanding: 'Freestanding', 'front-control': 'Front control', 'top-control': 'Top control', 'rear-control': 'Rear control' }[t] || words(t));
  const finishWords = (f) => ({ white: 'White', 'black-steel': 'Black steel', 'graphite-steel': 'Graphite steel', 'alpine-white': 'Alpine white', 'platinum-black': 'Platinum black',
    stainless: 'Stainless', 'printproof-stainless': 'PrintProof stainless', 'black-stainless': 'Black stainless', 'printproof-black-stainless': 'PrintProof black stainless',
    black: 'Black', 'essence-white': 'Essence white' }[f] || words(f));
  const sold = (p) => p && p.cta === 'cart' && p.inStock !== false;
  const byReviews = (a, b) => (Number(b.reviews) || 0) - (Number(a.reviews) || 0);
  /** A dimension: the product page's (specs.json, merged over the row by sku) where it gives one, else the feed's own fits; null when neither publishes one. */
  function dimOf(p, k) {
    const s = p && Number(p[k]);
    if (Number.isFinite(s) && s > 0) return { inches: s, from: 'the product page' };
    const f = p && p.fits && Number(p.fits[k]);
    return Number.isFinite(f) && f > 0 ? { inches: f, from: 'the feed' } : null;
  }
  const widthOf = (p) => dimOf(p, 'width');
  const inches = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} in`;

  // ── Images: D2's accepted file by sku, else the feed's own link, else a neutral tile with the name ──
  function imageHtml(p, size = 120) {
    const name = nameOf(p);
    const tile = `<span class="ph-tile" role="img" aria-label="${esc(name)}">${esc(name)}</span>`;
    if (!p) return tile;
    const entry = P2.images.get(idOf(p));
    const own = entry && entry.verdict === 'accept' && entry.src ? entry.src : null;
    const feed = !own && p.image && !/placeholder/.test(String(p.image)) ? p.image : null;
    const src = own || feed;
    return src ? `<img src="${esc(src)}" alt="${esc(name)}" width="${size}" height="${size}" loading="lazy" data-p2ph="${esc(tile)}">` : tile;
  }
  // A link that does not answer is replaced by the tile with its name: never a broken image on screen.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.dataset || t.dataset.p2ph === undefined) return;
    const holder = document.createElement('span');
    holder.innerHTML = t.dataset.p2ph;
    t.replaceWith(holder.firstElementChild || holder);
  }, true);
  /** One product, as a module shows it: a press opens its page. `tag` is what the module says about it. */
  function tileHtml(p, tag) {
    const price = priceOf(p);
    return `<button type="button" class="ptile" data-open="${esc(idOf(p))}" data-ctl="open-${esc(idOf(p))}">${imageHtml(p)}`
      + `<span class="pname">${esc(nameOf(p))}</span><span class="pprice">${price != null ? money(price) : 'price on the product page'}</span>`
      + `${tag ? `<span class="ptag">${esc(tag)}</span>` : ''}</button>`;
  }

  // ── The chrome a product page needs, made once in whichever shell it opens ──
  function ensureProductChrome() {
    const view = document.getElementById('view-product');
    if (!view) return;
    const add = (id, html, where, ref) => { if (!$(id) && ref) ref.insertAdjacentHTML(where, html); };
    add('pdpType', '<nav class="pdp-type" id="pdpType" aria-label="Other types"></nav>', 'afterend', $('buyBox'));
    for (const slot of ['pdp-modules', 'pdp-offers']) {
      add(`changes-${slot}`, `<section class="changes" id="changes-${slot}" aria-live="polite"><div class="changes-before"><span class="changes-cap">What was on screen before this press</span>`
        + `<ol class="ordlist" id="before-${slot}"><li class="ghost-empty">No product page had been opened yet.</li></ol></div>`
        + `<div class="changes-what"><span class="changes-cap">What changed</span><ul class="deltas" id="deltas-${slot}"><li class="delta-none">Open a product to begin.</li></ul></div></section>`,
      'beforebegin', $(`slot-${slot}`));
    }
    add('pdpGone', '<div class="pdp-gone" id="pdpGone" aria-live="polite"></div>', 'afterend', $('slot-pdp-modules'));
    add('pdpSpecs', '<section class="pdp-specs static" id="pdpSpecs" aria-label="Specs"></section>', 'beforeend', view);
    const box = $('slot-pdp-modules');
    if (box) box.classList.add('pdp-mods');
  }

  // ── The buy box: off limits, the catalog's own facts, the same for everyone ──
  /** Sizes (a TV's series in its model year) or colours (the same model in another finish letter): the site's own controls, never decided. */
  function variantsOf(p) {
    if (!p) return { label: null, list: [] };
    const cat = attrOf(p, 'category');
    if (cat === 'tvs' && attrOf(p, 'series') && Number(p.sizeInches) > 0) {
      const bySize = new Map();
      for (const x of state.products) {
        if (attrOf(x, 'category') !== 'tvs' || attrOf(x, 'series') !== attrOf(p, 'series') || (x.modelYear || null) !== (p.modelYear || null) || !(Number(x.sizeInches) > 0)) continue;
        const was = bySize.get(Number(x.sizeInches));
        if (idOf(x) === idOf(p) || !was || (idOf(was) !== idOf(p) && priceOf(was) == null && priceOf(x) != null)) bySize.set(Number(x.sizeInches), x);
      }
      return { label: 'Size', list: [...bySize.entries()].sort((a, b) => a[0] - b[0]).map(([size, x]) => ({ sku: idOf(x), label: `${size}″`, on: idOf(x) === idOf(p) })) };
    }
    const sku = idOf(p);
    const list = state.products.filter((x) => {
      const s = idOf(x);
      if (s === sku) return true;
      if (s.length !== sku.length || attrOf(x, 'category') !== cat || !attrOf(x, 'finish') || attrOf(x, 'finish') === attrOf(p, 'finish')) return false;
      let diff = 0, at = -1;
      for (let i = 0; i < s.length; i += 1) if (s[i] !== sku[i]) { diff += 1; at = i; }
      return diff === 1 && /[A-Z]/.test(s[at]) && /[A-Z]/.test(sku[at]);
    });
    return { label: 'Colour', list: list.map((x) => ({ sku: idOf(x), label: finishWords(attrOf(x, 'finish')) || idOf(x), on: idOf(x) === sku })) };
  }
  function renderBuyBox(p) {
    ensureProductChrome();
    const box = $('buyBox');
    if (!box) return;
    const price = priceOf(p), list = p && Number(p.listPrice);
    const was = p && Number.isFinite(list) && price != null && list > Number(price) ? list : null;
    const v = variantsOf(p);
    const fin = p && sold(p) && price != null ? (FINANCING.seen[idOf(p)] || FINANCING.cart) : null;
    const cta = !p ? '' : p.cta === 'cart'
      ? `<button type="button" class="btn btn--brand" id="bbAdd" data-act="add-to-cart" data-ctl="add-to-cart"${p.inStock === false ? ' disabled' : ''}>${p.inStock === false ? 'Notify Me' : 'Add to Cart'}</button>`
      : '<button type="button" class="btn btn--brand" id="bbAdd" data-act="find-retailer" data-ctl="find-retailer">Find a Retailer</button>';
    const crumbs = $('crumbs-product');
    if (crumbs && p) crumbs.innerHTML = `<a data-nav="home" data-ctl="crumb-home">Home</a><span>/</span><span>${esc(words(attrOf(p, 'room') || ''))}</span><span>/</span><span>${esc(familyWords(p.family))}</span><span>/</span><span>${esc(idOf(p))}</span>`;
    box.innerHTML = `<p class="offlimits"><b>Off limits</b> the buy box: title, image, price, ${v.label === 'Size' ? 'sizes' : 'colours'}, the button and the financing line are the catalog’s, the same for everyone · never decided, never personalised</p>
      <div class="bb-grid"><div class="bb-image" id="bbImage">${imageHtml(p, 420)}</div><div class="bb-config">
        <h1 class="bb-title" id="bbTitle">${esc(titleOfProduct(p))}</h1>
        <p class="bb-meta" id="bbMeta">${esc(p ? idOf(p) : '')}${p && p.rating ? ` · ★ ${esc(p.rating)} (${Number(p.reviews || 0).toLocaleString('en-US')} reviews)` : ''}${p && Array.isArray(p.badges) && p.badges.length ? ` · ${esc(p.badges.join(' · '))}` : ''}</p>
        <div class="bb-price" id="bbPrice">${price != null ? `<span class="now">${money(price)}</span>${was ? `<s class="was">${money(was)}</s><span class="off">Save ${money(was - Number(price))}</span>` : ''}` : '<span class="now">Price at the retailer</span>'}</div>
        ${v.list.length > 1 ? `<div class="bb-opts" id="bbOpts"><p class="bb-label">${esc(v.label)}</p><div class="bb-chips">${v.list.map((x) => `<button type="button" data-open="${esc(x.sku)}" data-ctl="variant-${esc(x.sku)}" aria-pressed="${x.on}">${esc(x.label)}</button>`).join('')}</div></div>` : ''}
        ${fin ? `<p class="bb-fin" id="bbFin"><span>${esc(fin)}</span><span class="nper">not personalised</span></p>` : ''}
        <div class="bb-actions">${cta}</div>
        <p class="bb-note">${p && p.cta !== 'cart' ? 'Sold through retailers: this site counts a referral, never a sale. ' : ''}Every figure in this box is the catalog’s and identical for every visitor. The price is the same for everyone; nothing decided sits in this box.</p>
      </div></div>`;
  }
  /** The site's own type switch: for each other type of this kind, its best seller at this price tier (sold here, most reviews). */
  function typeTarget(p, type) {
    if (!p) return null;
    const pool = state.products.filter((x) => attrOf(x, 'category') === attrOf(p, 'category') && attrOf(x, 'type') === type && !PART_FAMILIES.has(x.family) && sold(x));
    return pool.filter((x) => attrOf(x, 'priceTier') === attrOf(p, 'priceTier')).sort(byReviews)[0] || pool.sort(byReviews)[0] || null;
  }
  function renderTypeSwitch(p) {
    const nav = $('pdpType');
    if (!nav) return;
    const types = p ? [...new Set(state.products.filter((x) => attrOf(x, 'category') === attrOf(p, 'category') && !PART_FAMILIES.has(x.family) && attrOf(x, 'type')).map((x) => attrOf(x, 'type')))] : [];
    const chips = types.map((t) => [t, t === attrOf(p, 'type') ? p : typeTarget(p, t)]).filter(([, x]) => x).slice(0, 5);
    nav.hidden = chips.length < 2;
    nav.innerHTML = chips.length < 2 ? '' : `<span class="nper">not personalised</span><span>Also in ${esc(words(attrOf(p, 'category')))}, by type: each its type’s best seller at this price</span>`
      + `<span class="pdp-chips">${chips.map(([t, x]) => `<button type="button" data-open="${esc(idOf(x))}" data-ctl="type-${esc(t)}" aria-pressed="${t === attrOf(p, 'type')}" title="${esc(nameOf(x))}">${esc(typeWords(t))}</button>`).join('')}</span>`;
  }

  // ── The question, through the kit's context hook ─────────────────────────
  /** What a product page asserts about its product, as the config's products.pageContext maps it (OH: anchor = the sku, family). */
  function productContext(p) {
    if (!p) return null;
    const out = {};
    for (const [name, path] of Object.entries(SITE.products.pageContext || {})) { const v = field(p, path); if (v !== undefined && v !== null && v !== '') out[name] = String(v); }
    return out;
  }
  /** The product page's context: its anchor and family, and her declared width once she has entered one (declared, never inferred). */
  function askContext(p, v) {
    const fit = v && v.p2 && v.p2.fit;
    return { ...(productContext(p) || {}), ...(fit ? { fit: String(fit) } : {}) };
  }
  async function askProduct(key) {
    await loadProductDocs();
    const v = transport.cur();
    const p = productOf(state.productId);
    const r = await transport.ask(key, v, { context: askContext(p, v) });
    if (!r.ok) { engineDown(r.error); say(r.error, 'bad'); await panels.renderVectors(); return false; }
    engineUp();
    state.sets[key] = r.set;
    await paintProduct(r.set, p);
    panels.renderWho();
    director.sayAfter();
    await panels.renderVectors();
    panels.renderWhy();
    void transport.prefetchReceipts(r.set.decisions, r.set.asked).then(() => { panels.renderWhy(); director.sayAfter(); });
    demo.compare.afterDecidedPaint(key);
    return true;
  }
  LANES.ask[productKey()] = askProduct;

  // ── POST /sort: one call per page view over every product the page's modules show ──
  async function sortForPage(lists) {
    const v = transport.cur();
    const ids = [...new Set([].concat(...lists.values()))].filter((id) => productOf(id));
    if (!v || !ids.length) return { status: 'none', order: ids, items: new Map(), regional: null };
    const candidates = ids.map((id) => { const { productId, ...a } = productAttrs(productOf(id)); return { id, ...a }; });
    const r = await transport.api('/sort', { userId: v.session.subject, sessionId: v.session.sessionId, candidates,
      ...(state.ctx.region ? { context: { region: state.ctx.region } } : {}) }, { visitor: v });
    if (!r.ok || !r.body || !Array.isArray(r.body.order)) return { status: 'down', order: ids, items: new Map(), regional: null, error: (r.body && r.body.error) || String(r.status) };
    return { status: 'sorted', order: r.body.order.map(String), items: new Map(arr(r.body.items).map((x) => [String(x.id), x])), regional: r.body.regional || null };
  }
  /** A module's products in the order POST /sort returned them (the page reorders nothing of its own). */
  function sorted(skus) {
    const s = P2.sort, pos = new Map(((s && s.order) || []).map((id, i) => [id, i]));
    return arr(skus).filter((id) => productOf(id)).map(String).sort((a, b) => (pos.has(a) ? pos.get(a) : 1e9) - (pos.has(b) ? pos.get(b) : 1e9));
  }
  /** What the sort says about its order, on the card: the engine's, and the regional lean when it applied (synthetic → warehouse). */
  function sortLine() {
    const s = P2.sort;
    if (!s || s.status === 'none') return 'the catalog’s order';
    if (s.status === 'down') return `the catalog’s order · POST /sort did not answer (${s.error})`;
    const r = s.regional;
    const lean = r && r.region ? ` · leans with ${US[r.region] || r.region}’s sales${r.asserted ? ' (asserted)' : ''} · synthetic → warehouse` : '';
    return `in POST /sort’s order${lean}`;
  }

  // ── What each module shows ───────────────────────────────────────────────
  /** The products a module lists, before her declared width: the relation (or the package's members), as the files hold it. */
  function listFor(d, p) {
    const cid = d.customerContentId;
    const c = (p && p.companions) || {};
    if (cid === 'mod-laundry-dryer') { const x = c.dryers || {}; return Array.isArray(x) ? x : [...arr(x.electric), ...arr(x.gas), ...arr(x.heatPump)]; }
    if (cid === 'mod-laundry-pair-price') return arr(c.packages).filter((id) => attrOf(productOf(id), 'category') === 'laundry-sets');
    if (cid === 'mod-tv-mount') return arr(c.mounts).length ? arr(c.mounts) : vesaMounts(p);
    if (cid === 'mod-tv-qned-vs-oled') return counterpartPool(p).map(idOf);
    if (P2_REL[cid]) return arr(c[P2_REL[cid][0]]);
    const piece = pieceOf(d) || {};
    if (piece.type === 'package') return arr(piece.featuredProductIds).filter((id) => id !== (P2.display.get(cid) || {}).packageSku && productOf(id));
    return [];
  }
  /** Mounts whose own listing names this TV's VESA pattern (LSW440B "VESA - 400 x 400"), when the feed's relation has none. */
  function vesaMounts(p) {
    const want = p && p.vesa ? String(p.vesa).toLowerCase().replace(/\s/g, '') : null;
    if (!want) return [];
    return state.products.filter((m) => attrOf(m, 'category') === 'tv-mounts'
      && [...String(m.name || '').matchAll(/(\d{2,4})\s*[xX]\s*(\d{2,4})/g)].some((x) => `${x[1]}x${x[2]}` === want)).map(idOf);
  }
  /** The OLED beside a QNED (or the QNED beside an OLED): the same size in the other panel, priced; POST /sort orders them. */
  function counterpartPool(p) {
    const other = attrOf(p, 'type') === 'oled' ? 'qned' : 'oled';
    return state.products.filter((x) => attrOf(x, 'category') === 'tvs' && attrOf(x, 'type') === other && Number(x.sizeInches) === Number(p && p.sizeInches) && priceOf(x) != null);
  }
  /** Her declared width against a list: what fits, what is wider, what has no published width (shown, never hidden). */
  function fitSplit(skus, width) {
    const out = { fit: [], hidden: [], unknown: [] };
    for (const id of skus) {
      const x = productOf(id), w = widthOf(x);
      if (!width || !FIT_CATEGORIES.has(attrOf(x, 'category'))) out.fit.push(id);
      else if (!w) { out.unknown.push(id); out.fit.push(id); }
      else if (w.inches > width + 1e-9) out.hidden.push(id);
      else out.fit.push(id);
    }
    return out;
  }
  const declaredWidth = () => { const v = transport.cur(); return (v && v.p2 && v.p2.fit) || null; };
  /** The fit tool's scope: the product's own family (front-load washers on a front-load washer's page). */
  const fitScope = (p) => (p && FIT_CATEGORIES.has(attrOf(p, 'category')) ? state.products.filter((x) => x.family === p.family).map(idOf) : []);
  function fitNow(p) {
    const width = declaredWidth(), scope = fitScope(p);
    if (!p || !scope.length) return null;
    const split = fitSplit(sorted(scope), width);
    return { width, kind: familyWords(p.family), all: scope.length, ...split };
  }
  /** Tiles for a list, after her declared width, with what the width hid said in so many words. */
  function listHtml(skus, tagOf, max = 6) {
    const width = declaredWidth();
    const split = fitSplit(sorted(skus), width);
    const shown = split.fit.slice(0, max);
    if (!shown.length && !split.hidden.length) return '<p class="pmod-rule">No product in our data matches this rule for this product, and the page shows none rather than invent one.</p>';
    return `<div class="ptiles">${shown.map((id) => tileHtml(productOf(id), tagOf ? tagOf(productOf(id)) : '')).join('')}</div>`
      + `<p class="pdp-same">${esc(sortLine())}${split.fit.length > max ? ` · ${split.fit.length - max} more` : ''}${width && split.hidden.length ? ` · <span class="fit-hidden">hidden: ${split.hidden.length} wider than your space (${esc(inches(width))}, declared)</span>` : ''}${width && split.unknown.length ? ` · ${split.unknown.length} with no dimensions published, shown` : ''}</p>`;
  }

  /** The body of each decided module. Copy is the piece's own (catalog.json); numbers are the catalog's prices and the feed's facts. */
  function moduleBody(d, p) {
    const cid = d.customerContentId;
    const piece = pieceOf(d) || {};
    if (cid === 'mod-where-to-buy-pickup' || cid === 'mod-where-to-buy-retailer') return typeof whereToBuyBody === 'function' ? whereToBuyBody(d, p) : '';   // P3's
    if (cid === 'mod-laundry-dryer') {
      return `${fuelLead(listFor(d, p), 'dryers')}${listHtml(listFor(d, p), (x) => [words(attrOf(x, 'fuel')), finishWords(attrOf(x, 'finish'))].filter(Boolean).join(' · '))}`;
    }
    if (cid === 'mod-laundry-pair-price') return pairBody(p, listFor(d, p));
    if (cid === 'mod-tv-mount') {
      const own = arr(((p && p.companions) || {}).mounts).length;
      const list = listFor(d, p);
      return list.length ? `${own ? '' : '<p class="pmod-rule">Matched by the VESA pattern each mount’s own listing names.</p>'}${listHtml(list)}`
        : `<p class="pmod-lead">${p && p.vesa ? `No mount in our data lists ${esc(String(p.vesa).replace('x', ' x '))}.` : 'This TV’s VESA pattern is not in our data,'} so we say so rather than guess.</p>`;
    }
    if (cid === 'mod-tv-qned-vs-oled') return compareBody(p, listFor(d, p));
    if (cid === 'mod-tv-series-oled') return seriesBody(p);
    if (cid === 'mod-tv-size-up') return sizeUpBody(p);
    if (cid === 'mod-fit-check') return fitBody(p, 'module');
    if (cid === 'mod-laundry-front-vs-top') {
      const other = typeTarget(p, attrOf(p, 'type') === 'top-load' ? 'front-load' : 'top-load');
      return other ? `<div class="ptiles">${tileHtml(p, `${typeWords(attrOf(p, 'type'))} · on screen`)}${tileHtml(other, `${typeWords(attrOf(other, 'type'))} · its best seller at this price`)}</div>` : '';
    }
    if (piece.type === 'package') return packageBody(cid, listFor(d, p));
    if (P2_REL[cid]) return listHtml(listFor(d, p), cid === 'mod-tv-soundbar' ? (x) => attrOf(x, 'priceTier') || '' : null);
    return '';
  }
  /**
   * Her fuel, as the engine read it: the fuel of what POST /sort put first, and the fuel her region's sales lean (the
   * cold-start read, synthetic → warehouse). When the two differ the card says her own browsing outweighed the region
   * here (the sort's own drivers, on her receipt), never that the region chose.
   */
  function fuelLead(skus, what) {
    const first = productOf(sorted(skus)[0]);
    const fuel = attrOf(first, 'fuel');
    if (!fuel) return '';
    const lean = state.coldstart && state.coldstart.lean && state.coldstart.lean.leaders ? state.coldstart.lean.leaders.fuel : null;
    const r = P2.sort && P2.sort.regional, where = r && r.region ? (US[r.region] || r.region) : null;
    const said = lean && where ? (lean === fuel ? `, as ${where}’s sales lean` : `; ${where}’s sales lean ${words(lean)}, and her own browsing outweighs the region here`) : '';
    return `<p class="pmod-lead">In her fuel: <b>${esc(words(fuel))}</b> leads, by POST /sort over the ${esc(what)} of this series${esc(said)}.</p>`;
  }
  /** A package: its price beside its members' sum, shown as a saving only when it costs less (D1's figures from the crawl). */
  function packageBody(cid, members) {
    const disp = P2.display.get(cid) || {};
    const price = Number(disp.price), apart = Number(disp.memberSum), save = Number(disp.savings);
    const line = Number.isFinite(price) && Number.isFinite(apart) && Number.isFinite(save) && save > 0
      ? `<p class="pmod-lead">Together <b>${money(price)}</b> · apart ${money(apart)} · <b>${money(save)} less</b> as a package</p>`
      : Number.isFinite(price) ? `<p class="pmod-lead">The package price, <b>${money(price)}</b>: not every member’s price is in our data, so no saving is computed.</p>` : '';
    return `${line}${listHtml(members, null, 4)}`;
  }
  /** The laundry sets this machine is in: the set price beside the sum of its pieces, a saving only when the sum is known and higher. */
  function pairBody(p, sets) {
    const rows = sorted(sets).slice(0, 3).map((id) => {
      const s = productOf(id), price = priceOf(s);
      const members = String(id).split('_').map((m) => productOf(m));
      const prices = members.map((m) => priceOf(m));
      const apart = prices.every((x) => x != null) ? prices.reduce((a, b) => a + Number(b), 0) : null;
      const says = price == null ? 'set price on the product page' : apart != null && apart > Number(price)
        ? `set ${money(price)} · apart ${money(apart)} · ${money(apart - Number(price))} less`
        : apart != null ? `set ${money(price)} · apart ${money(apart)}: not lower, so no saving is shown` : `set ${money(price)} · ${prices.filter((x) => x == null).length} piece price(s) not in our data`;
      return tileHtml(s, says);
    });
    return rows.length ? `<div class="ptiles">${rows.join('')}</div><p class="pdp-same">${esc(sortLine())}</p>` : '<p class="pmod-rule">No set in our data contains this machine.</p>';
  }
  /** Premium as curation: this TV beside the other panel at the same size, and the honest sentence. Never a price that moves. */
  function compareBody(p, pool) {
    const other = productOf(sorted(pool)[0]);
    if (!p || !other) return '<p class="pmod-rule">No TV of the other panel at this size is in our data.</p>';
    const qned = attrOf(p, 'type') === 'qned' ? p : other, oled = qned === p ? other : p;
    const col = (x, room) => `<div class="${x === p ? 'cur' : ''}"><span class="pdp-same">${esc(room)}${x === p ? ' · on screen' : ' · beside it, by POST /sort'}</span>${tileHtml(x, `${typeWords(attrOf(x, 'type'))} · ${attrOf(x, 'panel') ? words(attrOf(x, 'panel')) : ''}`)}</div>`;
    return `<p class="pdp-say">For a bright room the QNED is the right choice; for a dark room this OLED is.</p>
      <div class="cmp2">${col(qned, 'for a bright room')}${col(oled, 'for a dark room')}</div>
      <p class="pdp-same">The price is the same for everyone · ${esc(sortLine())}</p>`;
  }
  /** G6, C6 or B6 at this TV's size: the catalog's prices, in the piece's own order (brightest first), not ranked. */
  function seriesBody(p) {
    const size = Number(p && p.sizeInches);
    const rows = ['g6', 'c6', 'b6'].map((s) => state.products.filter((x) => attrOf(x, 'series') === s && Number(x.sizeInches) === size && priceOf(x) != null)
      .sort((a, b) => Number(priceOf(a)) - Number(priceOf(b)))[0]).filter(Boolean);
    return rows.length ? `<div class="ptiles">${rows.map((x) => tileHtml(x, `${String(attrOf(x, 'series')).toUpperCase()}${idOf(x) === idOf(p) ? ' · on screen' : ''}`)).join('')}</div><p class="pdp-same">The price is the same for everyone · the series in the module’s own order</p>` : '';
  }
  /**
   * One size up, from where she sits: a size fills 30 to 40 degrees of her view between 0.613 and 0.833 of her
   * distance in inches (the piece's own figures: a 65-inch from 6′6″ to 8′10″, a 77-inch from 7′8″ to 10′5″, RTINGS).
   */
  function sizeUpFor(p, ft) {
    const d = Number(ft) * 12, lo = d * 0.613, hi = d * 0.833, now = Number(p && p.sizeInches);
    if (!p || !(now > 0)) return null;
    const sizes = variantsOf(p).list.map((x) => ({ x: productOf(x.sku), size: Number(productOf(x.sku).sizeInches) })).filter((s) => s.x && priceOf(s.x) != null);
    const up = sizes.filter((s) => s.size > now && s.size >= lo && s.size <= hi).sort((a, b) => a.size - b.size)[0] || null;
    return { ft: Number(ft), lo, hi, up: up ? up.x : null, fitsNow: now >= lo && now <= hi };
  }
  function sizeUpBody(p) {
    const v = transport.cur(), ft = v && v.p2 && v.p2.distance;
    const r = ft ? sizeUpFor(p, ft) : null;
    const chips = [6, 7, 8, 9, 10].map((n) => `<button type="button" data-act="size-up" data-ft="${n}" data-ctl="size-up-${n}" aria-pressed="${ft === n}">${n} ft</button>`).join('');
    const says = !r ? '<p class="pmod-rule">Her viewing distance is hers to give: declared, never inferred.</p>'
      : r.up ? `<p class="pmod-lead">From <b>${esc(r.ft)} ft</b>, sizes from ${Math.ceil(r.lo)} to ${Math.floor(r.hi)} inches fill 30 to 40 degrees of her view: one size up is the <b>${esc(nameOf(r.up))}</b>, ${money(priceOf(r.up))}.</p><div class="ptiles">${tileHtml(r.up, 'one size up · declared distance')}</div><p class="pdp-same">The price is the same for everyone</p>`
        : `<p class="pmod-lead">From <b>${esc(r.ft)} ft</b>, ${r.fitsNow ? 'this size already fills her view' : 'no larger size of this series is in our data with a price'}.</p>`;
    return `<p class="pmod-lead"><b>Where she sits</b></p><div class="pdp-chips">${chips}</div>${says}`;
  }
  /** The fit tool: her space, declared; what is wider drops out, counted; what publishes no dimensions is shown and said. Widths: specs.json, else the feed's fits. */
  function fitBody(p, where) {
    const f = fitNow(p);
    if (!f) return '';
    const room = attrOf(p, 'room');
    const chips = (FIT_CHIPS[room] || FIT_CHIPS['laundry-room']).map((w) => `<button type="button" data-act="fit" data-width="${w}" data-ctl="fit-${w}" aria-pressed="${f.width === w}">${w} in</button>`).join('');
    const own = widthOf(p);
    const result = !f.width ? (where === 'module' ? '<p class="pmod-rule">Her measurement is hers: declared, never inferred.</p>'
      : '<p class="pmod-rule">Enter the width of her closet or cut-out: models wider than it drop out, and the page says how many. Her measurement is hers, labelled declared, never inferred.</p>')
      : `<p class="pmod-lead"><b>${f.fit.length} of ${f.all} ${esc(f.kind)}</b> fit ${esc(inches(f.width))} · <span class="fit-hidden">hidden: ${f.hidden.length} wider than your space</span>${f.unknown.length ? ` · ${f.unknown.length} with no dimensions published, shown and counted` : ''}</p>`
        + `${own ? `<p class="pmod-rule">This one is ${esc(inches(own.inches))} wide (${esc(own.from)}): ${own.inches <= f.width ? 'it fits' : 'wider than her space'}.</p>` : ''}`
        + `<div class="ptiles">${f.fit.slice(0, 6).map((id) => { const w = widthOf(productOf(id)); return tileHtml(productOf(id), w ? `${inches(w.inches)} wide` : 'no dimensions published'); }).join('')}</div>`
        + `${f.hidden.length ? `<p class="pdp-same">Wider than her space: ${f.hidden.map((id) => `${esc(idOf(productOf(id)))} (${esc(inches(widthOf(productOf(id)).inches))})`).join(', ')}</p>` : ''}`
        + `<p class="pdp-same">What fits, ${esc(sortLine())} · widths from the product pages (specs.json), else the feed’s fits, merged by sku · her width declared, never inferred</p>`;
    return `<div class="pdp-fit" data-fit="${esc(where)}"><div class="fit-row pdp-chips">${chips}<input type="number" min="12" max="72" step="0.5" id="fitIn-${esc(where)}" aria-label="Her width in inches" value="${f.width || ''}">`
      + `<button type="button" class="btn btn--line btn--sm" data-act="fit-custom" data-in="fitIn-${esc(where)}" data-ctl="fit-custom-${esc(where)}">Check</button></div>${result}</div>`;
  }

  // ── The cards ────────────────────────────────────────────────────────────
  const KIND = (d, piece) => (P2_REL[d.customerContentId] ? 'goes with it' : piece.type === 'package' ? 'package'
    : /where-to-buy/.test(d.customerContentId) ? 'where to buy' : ({ compare: 'compare', tool: 'tool', explainer: 'service', deal: 'deal' }[arr((piece.tags || {}).contentType)[0]] || piece.type || 'module'));
  /** The receipt on the card: position and score, E1's completes line when the engine preferred it for this product, her own drivers, the region. */
  function receiptLine(d, i) {
    if (d.strategy === 'tenant-pinned') return `#${i + 1} · pinned by the merchandiser · the engine never ranked it`;
    const drivers = arr(d.explain && d.explain.drivers);
    const completes = drivers.filter((x) => x.dim === 'completes').map((x) => `<b>Completes what she committed to: ${esc(x.value)} (+${esc(Number(x.weight))})</b>`);
    const own = drivers.filter((x) => panels.OWN(x) && x.dim !== 'completes').sort((a, b) => Number(b.a) * Number(b.weight) - Number(a.a) * Number(a.weight)).slice(0, 2)
      .map((x) => `${esc(SITE.dimLabels[x.dim] || x.dim)} ${esc(x.value)}`);
    const reg = drivers.find((x) => x.dim === 'regional');
    const parts = [`#${i + 1} · score ${fmt3(d.score)}`, ...completes, ...own, ...(reg ? [`region ${esc(reg.value)}`] : [])];
    if (!completes.length && !own.length && !reg) parts.push(d.strategy === 'default' ? 'the catalog’s order, the holdout' : 'nothing she has shown moves it yet: the catalog’s order');
    return parts.join(' · ');
  }
  function moduleCard(d, i, p, mv) {
    const piece = pieceOf(d) || {};
    const rel = P2_REL[d.customerContentId];
    return `<article class="card pmod" data-act="piece" data-ctl="piece-${esc(d.customerContentId)}" data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}"`
      + ` data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}" data-module="${esc(d.customerContentId)}">`
      + `<header class="pmod-head"><h3>${esc(piece.title || d.customerContentId)}</h3><span class="pmod-kind">${esc(KIND(d, piece))}</span></header>${demo.deltas.chipHtml(mv)}`
      + `${piece.subtitle ? `<p>${esc(piece.subtitle)}</p>` : ''}${rel && p ? `<p class="pmod-rule"><b>Our merchandiser’s rule</b> ${esc(rel[1](p))}</p>` : ''}`
      + `${moduleBody(d, p)}<p class="receipt">${receiptLine(d, i)}</p></article>`;
  }
  function offerCard(d, i, mv) {
    const piece = pieceOf(d) || {};
    return `<article class="card" data-act="piece" data-ctl="piece-${esc(d.customerContentId)}" data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}"`
      + ` data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}">${demo.deltas.chipHtml(mv)}<h3>${esc(piece.title || d.customerContentId)}</h3>`
      + `${piece.subtitle ? `<p>${esc(piece.subtitle)}</p>` : ''}<span class="receipt">${receiptLine(d, i)}</span></article>`;
  }
  /** Why a module the last page showed is not on this one, when its own rule says so: the gate on ctx.family, with the feed's note. */
  /** The families a piece's own rule serves (eligibleWhen.context.family), or null when it has no such rule. */
  function servesOf(cid) {
    const piece = state.pieces.get(cid);
    const fams = piece && piece.eligibleWhen && piece.eligibleWhen.context && piece.eligibleWhen.context.family;
    return Array.isArray(fams) ? fams : null;
  }
  const servesWords = (fams, p) => (fams.length <= 3 ? `${fams.map(familyWords).join(' and ')} only` : `${fams.length} product families, and not ${familyWords(p.family)}`);
  const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  /** The withdrawal as one sentence: the feed's own reason, then the rule; or the rule alone, capitalised. */
  const goneSentence = (why) => (why.note ? `${why.note}: ${why.rule}` : capital(why.rule));
  /** Why a module is not on this product's page when its own rule says so: { note (the feed's own words), rule }, or null. */
  function goneWhy(cid, p = productOf(state.productId)) {
    const fams = servesOf(cid);
    if (!p || !fams || fams.includes(p.family)) return null;
    const raw = /pedestal|stacking/.test(cid) && p.companions && p.companions.pedestalsNote ? String(p.companions.pedestalsNote) : '';
    return { note: raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '', rule: `the rule serves ${servesWords(fams, p)}, and this page asserts ctx.family = ${p.family}, so the engine did not return it: the rule fails closed` };
  }
  function withdrawnFrom(p, now) {
    const last = P2.last;
    if (!p || !last || last.sku === idOf(p) || last.room !== attrOf(p, 'room')) return [];
    const ids = new Set(now.map((m) => m.id));
    const gone = last.modules.filter((m) => !ids.has(m.id)).map((m) => ({ ...m, why: goneWhy(m.id, p), from: last.sku })).filter((m) => m.why);
    return [...gone.filter((g) => g.why.note), ...gone.filter((g) => !g.why.note)];   // the one with the feed's own reason first: the pedestal
  }
  const goneCard = (g) => `<div class="pmod-gone" data-gone="${esc(g.id)}"><span class="nper">withdrawn · not decided</span><h4>${esc(g.title)}</h4>`
    + `<p class="gone-why"><b>Withdrawn by its own rule.</b> ${esc(goneSentence(g.why))}. It was on the ${esc(g.from)} page.</p></div>`;

  // ── The specs, and the fit tool when the engine did not decide it here ───
  function renderSpecs(p, fitHere) {
    const box = $('pdpSpecs');
    if (!box) return;
    if (!p) { box.innerHTML = ''; return; }
    const dim = (k, label) => { const d = dimOf(p, k); return d ? [label, inches(d.inches)] : null; };
    const anyDim = ['width', 'height', 'depth'].some((k) => dimOf(p, k));
    const rows = [['Model', idOf(p)], ...(anyDim ? [dim('width', 'Width'), dim('height', 'Height'), dim('depth', 'Depth')] : [['Dimensions', 'no dimensions published']]),
      p.capacityCuFt ? ['Capacity', `${p.capacityCuFt} cu. ft.`] : null, p.sizeInches ? ['Screen size', `${p.sizeInches}″ class`] : null,
      attrOf(p, 'panel') ? ['Panel', words(attrOf(p, 'panel'))] : null, p.vesa ? ['VESA pattern', `${String(p.vesa).replace('x', ' x ')} mm`] : null,
      attrOf(p, 'fuel') ? ['Fuel', words(attrOf(p, 'fuel'))] : null, attrOf(p, 'finish') ? ['Finish', finishWords(attrOf(p, 'finish'))] : null,
      arr(attrOf(p, 'feature')).length ? ['Features', arr(attrOf(p, 'feature')).map(words).join(', ')] : null,
      p.rating ? ['Rating', `${p.rating} out of 5 from ${Number(p.reviews || 0).toLocaleString('en-US')} reviews`] : null,
      ['Sold', p.cta === 'cart' ? (p.inStock === false ? 'here: out of stock today' : 'here, and at Best Buy for pickup where offered') : 'through retailers']].filter(Boolean);
    box.innerHTML = `<header class="module-head"><div><p class="module-where">static · the same for everyone</p><h2>Specs</h2></div><span class="nper">not personalised</span></header>
      <dl>${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>
      ${fitHere ? `<div class="pdp-fit-static"><p class="module-where">the site’s own tool · not decided here</p><h3>Will it fit? Tell us your space.</h3>${fitBody(p, 'specs')}</div>` : ''}
      <p class="bb-note">From the feed (products.json, as listed on 1 October) and the product page (specs.json, 2 October), merged by sku. A dimension is the product page’s where it gives one, else the feed’s.</p>`;
  }

  // ── The page, painted from one answer ────────────────────────────────────
  /** The lists every module on this answer shows, for the one POST /sort call of the page view. */
  function listsOf(set, p) {
    const mods = transport.bySlot(set, 'pdp-modules');
    const lists = new Map(mods.map((d) => [d.customerContentId, listFor(d, p)]));
    if (p && fitScope(p).length && (widthOf(p) || mods.some((d) => d.customerContentId === 'mod-fit-check'))) lists.set('fit', fitScope(p));
    return lists;
  }
  async function paintProduct(set, p) {
    ensureProductChrome();
    P2.sort = await sortForPage(listsOf(set, p));
    renderProductFrom(set, p);
  }
  /**
   * The page from one answer, with P2.sort already the engine's order for it. quiet: a frame for Compare (a fresh
   * visitor's, or hers put back): the before/now rows do not rotate, nothing is withdrawn from her history, and her
   * page's memory (the last product page) is left as it was; `gone` is what the withdrawn row shows.
   */
  function renderProductFrom(set, p, opts = {}) {
    const mods = transport.bySlot(set, 'pdp-modules'), offers = transport.bySlot(set, 'pdp-offers');
    const fitDecided = mods.some((d) => d.customerContentId === 'mod-fit-check');
    const fitHere = Boolean(p) && fitScope(p).length > 0 && Boolean(widthOf(p));
    const after = mods.map((d) => ({ id: d.customerContentId, title: titleOf(d) }));
    const offersAfter = offers.map((d) => ({ id: d.customerContentId, title: titleOf(d) }));
    let mv = {}, mvo = {};
    if (!opts.quiet) {
      demo.deltas.rotate('pdp-modules', after, mods);
      demo.deltas.rotate('pdp-offers', offersAfter, offers);
      mv = demo.deltas.moves('pdp-modules', P2.rows['pdp-modules'].previous, after, mods);
      mvo = demo.deltas.moves('pdp-offers', P2.rows['pdp-offers'].previous, offersAfter, offers);
      P2.gone = withdrawnFrom(p, after);
    }
    const box = $('slot-pdp-modules');
    if (box) box.innerHTML = mods.length ? mods.map((d, i) => moduleCard(d, i, p, mv[d.customerContentId])).join('')
      : '<p class="slot-empty">The engine returned no module for this product on this request, and the page shows none rather than invent one.</p>';
    if ($('pdpGone')) $('pdpGone').innerHTML = (opts.quiet ? arr(opts.gone) : P2.gone).map(goneCard).join('');
    const ob = $('slot-pdp-offers');
    if (ob) ob.innerHTML = offers.length ? offers.map((d, i) => offerCard(d, i, mvo[d.customerContentId])).join('') : '<p class="slot-empty">No offer the engine could serve applies to this product today.</p>';
    if (!opts.quiet) {
      P2.prevRoom = P2.last ? P2.last.room : null;
      demo.deltas.render('pdp-modules');
      demo.deltas.render('pdp-offers');
    }
    renderSpecs(p, fitHere && !fitDecided);
    if (!opts.quiet && p) P2.last = { sku: idOf(p), family: p.family, room: attrOf(p, 'room'), modules: after };
  }
  // A fresh visitor beside her on this product page (P1's Compare tool, through its hook): the same product, the same
  // region, the same anchor and family; nothing of hers (no declared width, no distance), and nothing sent for him.
  LANES.hooks.fresh = LANES.hooks.fresh || {};
  LANES.hooks.fresh[productKey()] = {
    title: 'Her product page, and a fresh visitor’s',
    ask: async (f) => {
      const r = await transport.ask(productKey(), f, { context: productContext(productOf(state.productId)) || {} });
      if (!r.ok) throw new Error(r.error);
      return r.set;
    },
    paint: async (f, set) => {
      const p = productOf(state.productId);
      const keep = { who: state.who, vector: state.lastVector, sort: P2.sort, gone: P2.gone, scroll: window.scrollY };
      const strips = ['changes-pdp-modules', 'changes-pdp-offers'].map((id) => $(id)).filter(Boolean).map((n) => [n, n.hidden]);
      state.who = f.key;
      state.lastVector = {};
      try { P2.sort = await sortForPage(listsOf(set, p)); } catch (error) { state.who = keep.who; state.lastVector = keep.vector; P2.sort = keep.sort; throw error; }
      strips.forEach(([n]) => { n.hidden = true; });
      renderProductFrom(set, p, { quiet: true, gone: [] });
      return () => {
        state.who = keep.who; state.lastVector = keep.vector; P2.sort = keep.sort;
        strips.forEach(([n, h]) => { n.hidden = h; });
        const hers = state.sets[productKey()];
        if (hers) renderProductFrom(hers, p, { quiet: true, gone: keep.gone });
        try { window.scrollTo({ top: keep.scroll, behavior: 'instant' }); } catch { /* optional */ }
      };
    },
  };

  async function openProduct(id, opts = {}) {
    const key = productKey();
    if (!key) throw new Error('the demo config names no product page');
    await loadProductDocs();
    const p = productOf(id) || state.products[0] || null;
    await transport.ensureVisitor();
    state.productId = p ? idOf(p) : (id || null);
    showView(key);
    route(urlOf(key, { id: state.productId }));
    renderBuyBox(p);
    renderTypeSwitch(p);
    if (p && opts.event !== false) {
      await transport.send('product_view', productAttrs(p, { view: 'page' }));
      panels.note('opened', nameOf(p), `${familyWords(p.family)} · its attributes are the event; the next decision asserts ctx.anchor = ${idOf(p)}, ctx.family = ${p.family}`);
    }
    await askPage(key);
    scrollTop();
    return true;
  }

  // ── Her own answers on this page: a width, a viewing distance. Declared, never inferred. ──
  async function declareFit(width) {
    const v = transport.cur(), p = productOf(state.productId);
    const w = Number(width);
    if (!v || !p || !(w >= 12 && w <= 72)) { say('a width between 12 and 72 inches, please', 'bad'); return; }
    v.p2 = { ...(v.p2 || {}), fit: w };
    const a = productAttrs(p);
    await transport.sendCustom('filter', { control: 'fit', widthInches: w, declared: true, productId: a.productId, category: a.category, type: a.type, room: a.room });
    panels.note('declared', `her space: ${inches(w)} wide`, 'her own measurement, declared, never inferred · asserted on the next decision as ctx.fit · wider models drop out of this page’s lists, counted');
    await askProduct(productKey());
    focusOn(document.querySelector('#stage > .view:not([hidden]) [data-fit]'), 'center');
  }
  async function declareDistance(ft) {
    const v = transport.cur(), p = productOf(state.productId);
    if (!v || !p) return;
    v.p2 = { ...(v.p2 || {}), distance: Number(ft) };
    const r = sizeUpFor(p, ft);
    const was = JSON.parse(JSON.stringify(v.vector || {}));   // her meters as the panel last read them
    P2.sizeUp = r && r.up ? { sku: idOf(r.up), name: nameOf(r.up), price: money(priceOf(r.up)), size: Number(r.up.sizeInches), ft: Number(ft), moved: null } : null;
    if (r && r.up) {
      await transport.sendCustom('select', productAttrs(r.up, { control: 'viewing-distance', distanceFt: Number(ft), declared: true }));
      panels.note('declared', `she sits ${ft} ft away`, `one size up: ${nameOf(r.up)} · the select carries its size band and price tier · the price is the same for everyone`);
    } else panels.note('declared', `she sits ${ft} ft away`, r && r.fitsNow ? 'this size already fills her view: nothing to step up to' : 'no larger size of this series with a price');
    await askProduct(productKey());
    if (P2.sizeUp) {
      // What the select did to her own meters, dimension by dimension, as her profile reads after the ask.
      const now = v.vector || {}, a = (vec, dim, val) => Number(((vec[dim] || {})[val]) || 0);
      const moved = [['sizeBand', 'size band'], ['priceTier', 'price tier']].map(([dim, label]) => {
        const val = attrOf(r.up, dim);
        return val ? { label, val, from: a(was, dim, val), to: a(now, dim, val) } : null;
      }).filter((m) => m && m.to > m.from + 0.004);
      P2.sizeUp.moved = moved.length ? moved.map((m) => `${m.label} ${m.val} ${m.from.toFixed(2)} → ${m.to.toFixed(2)}`).join(', ') : null;
      director.sayAfter();   // the beat's sentence, now that her meters bear it out
    }
    focusOn(document.querySelector('#stage > .view:not([hidden]) [data-module="mod-tv-size-up"]'), 'center');
  }
  LANES.controls.push(async (t) => {
    const act = t.dataset && t.dataset.act;
    if (act === 'fit') { await declareFit(t.dataset.width); return true; }
    if (act === 'fit-custom') { await declareFit(($(t.dataset.in) || {}).value); return true; }
    if (act === 'size-up') { await declareDistance(t.dataset.ft); return true; }
    if (act === 'find-retailer') {
      const p = productOf(state.productId);
      if (p) {
        await transport.sendCustom('find_a_retailer', productAttrs(p, { retailer: 'find-a-retailer', control: 'buy-box' }));
        panels.note('pressed', `Find a Retailer · ${nameOf(p)}`, 'the buy box’s own button, the same for everyone: the engine hears it; a referral is not a sale');
      }
      return true;
    }
    return undefined;
  });

  /**
   * Why a piece is out of this answer by the catalog in force, the document the page read before the publish
   * (state.pieces, as the beat's own document holds it): its window has closed, or not opened, or it is out of stock.
   * Null when the document says none of these, so the strip never infers a reason it cannot read.
   */
  function catalogWhy(cid) {
    const piece = state.pieces.get(cid);
    if (!piece) return null;
    const when = (t) => new Date(t).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const w = piece.window || null, now = Date.now();
    if (w && w.to && Date.parse(w.to) <= now) return `its window closed ${when(w.to)}`;
    if (w && w.from && Date.parse(w.from) > now) return `its window opens ${when(w.from)}`;
    if (piece.inStock === false) return 'out of stock in the catalog in force: never shown as complete';
    return null;
  }

  // ── The before/now rows for the two decided slots (deltas.js reads them) ──
  for (const slot of ['pdp-modules', 'pdp-offers']) {
    LANES.rows[slot] = {
      state: () => P2.rows[slot],
      get: () => ({ before: P2.rows[slot].previous || null, after: P2.rows[slot].current || [] }),
      set: () => state.sets[productKey()] || null,
      mode: 'list', get before() { return $(`before-${slot}`); }, get deltas() { return $(`deltas-${slot}`); }, unit: 'position', tight: true, leftFirst: true,
      emptyBefore: 'No product page had been opened on this visit.',
      first: (g) => `<li class="delta-none">The first product page of this visit: <b>${esc(g.after.map((m) => m.title).join(' → ') || 'nothing')}</b>, in the order the engine returned.</li>`,
      left: (b) => {
        const closed = catalogWhy(b.id);
        if (closed) return `left the page · ${closed}`;
        const p = productOf(state.productId), fams = servesOf(b.id);
        if (p && fams && !fams.includes(p.family)) {
          if (P2.prevRoom && P2.prevRoom !== attrOf(p, 'room')) return `left the page: another room’s module, its rule serves ${servesWords(fams, p)}`;
          const why = goneWhy(b.id, p);
          return `withdrawn by its own rule${why.note ? `: ${why.note.charAt(0).toLowerCase()}${why.note.slice(1)}` : ''} · it serves ${servesWords(fams, p)}`;
        }
        return 'left the page · outranked on this answer';
      },
      held: { title: (d) => titleOf(d), index: (d) => transport.bySlot(state.sets[productKey()], slot).indexOf(d) },
      nothing: { text: slot === 'pdp-modules' ? 'The same modules, in the same order.' : 'The same offers, in the same order.' },
      title: (d) => titleOf(d),
      titleOfId: (id) => titleOfCid(id),
    };
  }

  // ── The facts beats 5–10 speak about (beats.json {{p2.*}}), read fresh ───
  LANES.facts.p2 = () => {
    const p = productOf(state.productId), set = state.sets[productKey()] || null;
    const mods = set && (pageOf(state.viewPage) || {}).entry === 'product' ? transport.bySlot(set, 'pdp-modules') : [];
    const named = (sku) => { const x = productOf(sku); return { sku: x ? idOf(x) : sku, name: x ? nameOf(x) : sku }; };
    const washer = productOf(P2_WALK.washer), top = typeTarget(washer, 'top-load');
    const f = p ? fitNow(p) : null;
    const pkg = mods.map((d) => [d, P2.display.get(d.customerContentId) || {}]).find(([d, x]) => (pieceOf(d) || {}).type === 'package' && Number(x.savings) > 0);
    const other = p && attrOf(p, 'category') === 'tvs' ? productOf(sorted(counterpartPool(p).map(idOf))[0]) : null;
    return {
      washer: named(P2_WALK.washer), topLoader: named(top ? idOf(top) : null), tv: named(P2_WALK.tv), range: named(P2_WALK.range), qned: named(P2_WALK.qned),
      closet: P2_WALK.closet, distanceFt: P2_WALK.distanceFt,
      onPage: { product: p ? nameOf(p) : null, modules: mods.length || null, titles: mods.map((d) => titleOf(d)).join(', ') || null,
        completes: mods.filter((d) => arr(d.explain && d.explain.drivers).some((x) => x.dim === 'completes')).length || null,
        completing: mods.filter((d) => arr(d.explain && d.explain.drivers).some((x) => x.dim === 'completes')).map((d) => titleOf(d)).join(', ') || null },
      vesa: p && p.vesa ? String(p.vesa).replace('x', ' x ') : null,
      withdrawn: P2.gone.length ? P2.gone.map((g) => g.title).join(', ') : null,
      withdrawnWhy: P2.gone.length ? goneSentence(P2.gone[0].why) : null,
      fit: { width: f ? f.width : null, all: f ? f.all : null, fits: f && f.width ? f.fit.length : null, hidden: f && f.width ? f.hidden.length : null, kind: f ? f.kind : null },
      sizeUp: { name: P2.sizeUp ? P2.sizeUp.name : null, price: P2.sizeUp ? P2.sizeUp.price : null, size: P2.sizeUp ? P2.sizeUp.size : null, moved: P2.sizeUp ? P2.sizeUp.moved : null },
      compare: { other: other ? nameOf(other) : null },
      package: { name: pkg ? titleOf(pkg[0]) : null, savings: pkg ? money(pkg[1].savings) : null, price: pkg ? money(pkg[1].price) : null },
    };
  };

  // ── phone, sign-in, where-to-buy, report (P3) ─────────────────────────────
  // The phone (m.html boots the homepage at phone width), the live sign-in sheet (a fictional account from the
  // server's closed list; the worker mints the assertion), the two where-to-buy outcomes and the day report's
  // labels. Lane P3 writes here (and the facts it owns).
  //
  //   the sign-in   the header's Sign in opens a sheet naming the fictional account of demo.config.json's signIn (the
  //                 server's OH_ACCOUNTS is the closed list). "Sign in as …" sends { account } and nothing else to
  //                 /oh/api/sign-in through the kit's api door, with her own capability. The worker mints the signed
  //                 assertion with its IDENTITY_SECRETS and spends it on the identity link (src/routes/oh.ts); the page
  //                 receives success, the linked flag and the session she carries from now on, and asks again: the
  //                 next answer is the person's. The receipt under the header reads "linked at sign-in · consented ·
  //                 no device matching", with what her other device's taste brought.
  //   the phone     beat 15. Her laptop (the walk's visitor) signs in; her phone, a second, anonymous visitor at phone
  //                 width with her region's opening, signs in as the same person, and one request later shows the
  //                 laptop's taste. m.html is the same phone on its own: a direct load is a stranger, decided live.
  //   where-to-buy  whereToBuyBody(d, p): the body of the two decided modules P2's renderer places (mod-where-to-buy-
  //                 pickup, mod-where-to-buy-retailer). Best Buy pickup, and a PriceSpider-shaped Find a Retailer list
  //                 (the buy box's own Find a Retailer opens the same list). Each press goes on the wire as E1's named
  //                 outcome, type custom with data.event partner_pickup or retailer_referral, carrying the decision on
  //                 screen (decisionId, contentId, slot) that earned it. A referral is not a sale, and it says so.
  //   the report    the kit's day report with the slots' names and the attach rows, and beside it the outcomes the
  //                 engine's own report counts (E1's namedOutcomes): orders, Best Buy pickups, retailer referrals,
  //                 attach; attribution, never a lift, and "not yet significant" until LG computes lift on a holdout.
  // The hooks the shared code calls (hoisted, so the kit's config may name them before this section runs).
  function p3Verbs() {
    return { laptopFirst: () => P3.laptopFirst(), pickUpPhone: () => P3.pickUpPhone(), backToLaptop: () => P3.backToLaptop(),
      dayReport: () => P3.dayReport() };
  }
  function p3Report() {
    return { slots: () => SITE.reportSlots, labels: () => P3.reportLabels(), row: (slot, id) => ({ key: id, title: P3.titleById(id) }),
      get attach() { return P3.attach(); }, get theirs() { return P3.theirs(); } };
  }
  async function p3Control(t) { return P3.control(t); }
  function p3Facts() { return P3.facts(); }
  async function phoneArrival() { return P3.phoneArrival(); }
  /** P2's renderer calls this for the two where-to-buy modules: (the decision, the product on the page) → the module's body. */
  function whereToBuyBody(d, p) { return P3.whereToBuyBody(d, p); }

  const P3 = (() => {
    const { sleep, hhmm } = util;
    const ACCOUNTS = arr(SITE.signIn && SITE.signIn.accounts);
    const SIGN_IN = `${BASE}api/sign-in`;
    const RECEIPT = 'linked at sign-in · consented · no device matching';
    const RECEIPT_REFUSED = 'linked at sign-in · consent off: nothing personalised · no device matching';
    const PICKUP = 'mod-where-to-buy-pickup', RETAIL = 'mod-where-to-buy-retailer';
    const EVENTS = ['partner_pickup', 'retailer_referral'];
    /** Beat 16's pages, from the C6's own companions (beat 7): the soundbar the TV goes with (Best Buy pickup offered), and its wall mount (sold through retailers). */
    const WALK = { tv: 'OLED65C6PUA', pickup: 'S90TR', referral: 'OLW480B', retailer: 'costco' };
    /** A PriceSpider-shaped list, per room: the stores that carry it, the same for everyone, with no price of theirs shown here. */
    const RETAILERS = {
      'living-room': [['best-buy', 'Best Buy'], ['costco', 'Costco'], ['walmart', 'Walmart'], ['amazon', 'Amazon']],
      'laundry-room': [['best-buy', 'Best Buy'], ['home-depot', 'The Home Depot'], ['lowes', 'Lowe’s'], ['costco', 'Costco']],
      kitchen: [['home-depot', 'The Home Depot'], ['lowes', 'Lowe’s'], ['best-buy', 'Best Buy'], ['costco', 'Costco']],
    };
    /** The companion modules the attach rows read off the product pages' grid. */
    const ATTACH = [['mod-laundry-dryer', 'The dryer for her washer'], ['mod-laundry-pedestal', 'The pedestal'], ['mod-laundry-stacking', 'The stacking kit'],
      ['mod-laundry-pair-price', 'The set price'], ['mod-tv-soundbar', 'The soundbar for the series'], ['mod-tv-mount', 'The mount for the VESA pattern'],
      ['mod-range-microwave', 'The microwave over the range'], ['mod-range-dishwasher', 'The dishwasher beside it']];
    const S = { laptop: null, phone: null, laptopTop: null, phoneBefore: null, phoneAfter: null, phoneTop: null, same: null, moved: null,
      outcomes: [], baseline: null, report: null, quiet: false, gen: 0, sheet: null, framed: document.body.classList.contains('shell--phone') };
    const phoneKey = () => SITE.entries.phone || homeKey();
    const linkOf = (v) => (v && v.p3 && v.p3.linked) || null;
    const firstName = (name) => String(name || '').split(' ')[0];
    const today = () => new Date().toISOString().slice(0, 10);
    /** A signal as the room would say it: "living room", "65–74-inch", "OLED", "C6 series". */
    const WORDS = { 'living-room': 'living room', 'laundry-room': 'laundry room', tvs: 'TVs', oled: 'OLED', qned: 'QNED', uhd: '4K UHD', 'micro-rgb': 'Micro RGB' };
    function label(x) {
      const v = String(x.value), w = WORDS[v] || v.replace(/-/g, ' ');
      if (x.dim === 'sizeBand') return /^\d+-\d+$/.test(v) ? `${v.replace('-', '–')}-inch` : `${w} inches`;
      if (x.dim === 'series') return `${v.toUpperCase()} series`;
      if (['room', 'type', 'category'].includes(x.dim)) return w;
      return `${w} (${SITE.dimLabels[x.dim] || x.dim})`;
    }
    const tops = (list) => (list && list.length ? list.map(label).join(', ') : null);
    const nameOfSku = (sku) => productName(productOf(sku)) || sku;

    // ── Her signals, read from her own profile (the meters' own read) ────────
    async function reflexOf(v) {
      const r = await transport.api('/realtime/reflex', undefined, { visitor: v });
      return (r.body && r.body.affinity && r.body.affinity.dims) || {};
    }
    /** A dimension's memory in the published registry: its own τ, else the registry's. */
    function tauOf(dim) {
      const reg = state.registry || {};
      const d = arr(reg.dimensions).find((x) => x.key === dim);
      return Number(d && d.tauMs) || Number(reg.tauMs) || 0;
    }
    /** Her strongest signals; taste is the long memory (a day or more), not the minute's intent (retailer, content type, price tier). */
    function topOf(dims, n = 3, taste = true) {
      const rows = [];
      for (const [dim, values] of Object.entries(dims || {})) {
        if (taste && tauOf(dim) < 86400000) continue;
        for (const [value, a] of Object.entries(values || {})) if (Number(a) > 0) rows.push({ dim, value, a: Number(a) });
      }
      return rows.sort((x, y) => y.a - x.a).slice(0, n);
    }
    const keysOf = (list) => arr(list).map((x) => `${x.dim}\u0000${x.value}`).sort().join('|');
    /** What a page showed in its decided slots, slot by slot, for "the same page, before and after she signed in". */
    function shownOn(key) {
      const set = state.sets[key] || null;
      return set ? Object.fromEntries(slotsOf(key).map((s) => [s.slot, transport.bySlot(set, s.slot).map((d) => d.customerContentId).join('|')])) : null;
    }

    // ── The page's own chrome for the sign-in: the header control, the receipt under it, a few styles ──
    function style() {
      if ($('p3-style')) return;
      const css = [
        '#signIn[data-act]{cursor:pointer}',
        '.p3-signed{margin:0;padding:8px 28px;background:var(--brand-wash);color:var(--ink);font-size:13px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}',
        '.p3-signed .p3-receipt{font-family:var(--mono);font-size:11px;color:var(--brand-deep)}',
        '.p3-signed .p3-taste{color:var(--muted)}',
        'body.shell--phone .p3-signed{padding:8px 14px}',
        '.p3-wtb .sactions{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}',
        '.p3-done{margin:10px 0;padding:8px 10px;border-left:3px solid var(--brand);background:var(--soft);font-size:13px;line-height:1.5}',
        '.p3-wtb code,.p3-done code,.sheet .p3-fine code{font-family:var(--mono);font-size:11.5px}',
        '.sheet .p3-fine{font-size:12.5px;color:var(--muted);margin-top:14px}',
        '.sheet .srow .btn{flex:none}',
        '.p3-outcomes{margin-top:16px;padding-top:4px;border-top:1px solid var(--m-line)}',
        '.p3-outcomes .rep-row .nm{white-space:normal}',
        // A real phone is its own frame: at a phone's width the drawn bezel goes, so nothing runs past the screen.
        '@media (max-width:480px){body.shell--phone .site{max-width:none;margin:0;border:0;border-radius:0}}',
      ].join('\n');
      document.head.insertAdjacentHTML('beforeend', `<style id="p3-style">${css}</style>`);
    }
    function wireSignIn() {
      const el = $('signIn');
      if (!el || el.dataset.p3) return;
      el.dataset.p3 = '1';
      el.dataset.act = 'sign-in';
      el.dataset.ctl = 'sign-in';
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
    }
    function renderSignedIn() {
      const v = transport.cur(), link = linkOf(v);
      const sign = $('signIn');
      if (sign) { const text = link ? `Hi, ${firstName(link.account)}` : 'Sign in'; if (sign.textContent !== text) sign.textContent = text; }
      let strip = $('p3Signed');
      if (!strip) {
        const header = document.querySelector('#site .site-header');
        if (!header) return;
        header.insertAdjacentHTML('afterend', '<p class="p3-signed" id="p3Signed" aria-live="polite" hidden></p>');
        strip = $('p3Signed');
      }
      if (!link) { if (!strip.hidden) { strip.hidden = true; strip.innerHTML = ''; } return; }
      const html = `<b>Signed in as ${esc(link.account)}</b><span class="p3-receipt" data-p3-receipt>${esc(link.receipt)}</span>`
        + `${link.taste ? `<span class="p3-taste">${esc(link.taste)}</span>` : ''}`;
      if (strip.innerHTML !== html) strip.innerHTML = html;
      strip.hidden = false;
    }
    /** The kit's who chip says "anonymous" of every visitor; a signed-in one is not, so the chip says what she is. */
    function watchWho() {
      const chip = $('whoChip');
      if (!chip) return;
      const fix = () => {
        const v = transport.cur(), link = linkOf(v);
        if (link) {
          const text = `${v.label} · signed in as ${link.account} · ${link.consented ? 'consent on' : 'consent off'}`;
          if (chip.textContent !== text) chip.textContent = text;
        }
        renderSignedIn();
      };
      new MutationObserver(fix).observe(chip, { childList: true, characterData: true, subtree: true });
    }
    function setPhoneFrame(on) {
      if (S.framed) return;                          // m.html is the phone already
      document.body.classList.toggle('shell--phone', Boolean(on));
    }

    // ── The sign-in ─────────────────────────────────────────────────────────
    function openSignIn() {
      const v = transport.cur(), link = linkOf(v);
      const rows = ACCOUNTS.map((name) => `<div class="srow"><span><b>${esc(name)}</b><br><span class="nper">a fictional demo account</span></span>`
        + `<button type="button" class="btn btn--brand btn--sm" data-act="sign-in-as" data-account="${esc(name)}" data-ctl="sign-in-as"${link ? ' disabled' : ''}>Sign in as ${esc(firstName(name))}</button></div>`).join('');
      sheets.open('sign-in', `<p class="sk">Sign in${v ? ` · ${esc(v.label)}` : ''}</p>`
        + `<h2 id="sheetTitle">${link ? `Signed in as ${esc(link.account)}` : 'Sign in to OH.'}</h2>`
        + '<p>Signed in, the devices you use are one profile, and only then: <b>no device matching</b>, ever. What you browsed here joins what you browsed on any other device signed in as you, with your consent as you set it. Prices are the same signed in or not.</p>'
        + (rows || '<p>No demo account is configured.</p>')
        + '<p class="p3-fine">A demonstration with a fictional account and no password. A real site’s backend signs who signed in; here the worker signs it for the demo accounts only, with its own identity secret, and this page never holds it.</p>');
    }
    async function signInAs(name) {
      let v = transport.cur();
      if (!v) throw new Error('nobody is on the page yet: press Next and a stranger lands');
      if (!ACCOUNTS.includes(name)) throw new Error(`${name} is not one of the demo accounts`);
      if (linkOf(v)) { await sheets.close(); say(`${v.label} is already signed in as ${linkOf(v).account}`, 'good'); return true; }
      const isPhone = S.phone !== null && v.key === S.phone;
      const before = topOf(await reflexOf(v));
      say(`signing in as ${name} · the worker mints the signed link…`);
      const r = await transport.api(SIGN_IN, { account: name }, { visitor: v });
      const b = r.body || {};
      if (!r.ok || b.ok !== true || b.linked !== true || !b.session || b.session.kind !== 'recognized' || !b.session.capability) {
        throw new Error(`the sign-in was refused: ${b.error || `the route answered ${r.status || 'nothing'}`}`);
      }
      const consented = Boolean(b.session.consent && b.session.consent.personalization);
      // The person's session from now on: the link retired her anonymous one. A new visitor object under the same key,
      // so a receipt read still in flight for her earlier decisions finishes on the session those decisions were made in.
      const was = v;
      v = { ...was, session: b.session, p3: { ...(was.p3 || {}), linked: { account: name, at: Date.now(), consented, receipt: consented ? RECEIPT : RECEIPT_REFUSED, taste: null } } };
      state.visitors[was.key] = v;
      if (state.who === was.key) transport.useVisitor(was.key);
      await sheets.close();
      panels.note('signed in', `${name} · ${v.p3.linked.receipt}`, 'the worker minted the signed link for this browser and spent it on the identity link; the page never held the secret · the next request is the person’s');
      panels.renderWho();
      renderSignedIn();
      if (isPhone) S.phoneBefore = shownOn(state.viewPage);
      if (state.viewPage) await askPage(state.viewPage);   // one request: the page asks again, as the person
      const after = topOf(await reflexOf(v));
      const gained = after.filter((x) => !before.some((y) => y.dim === x.dim && y.value === x.value));
      if (isPhone) {
        S.phoneAfter = shownOn(state.viewPage);
        S.phoneTop = after;
        S.same = Boolean(S.laptopTop && S.laptopTop.length && keysOf(after) === keysOf(S.laptopTop));
        S.moved = S.phoneBefore && S.phoneAfter ? Object.keys(S.phoneAfter).filter((k) => S.phoneAfter[k] !== S.phoneBefore[k]).length : null;
        v.p3.linked.taste = after.length ? `her laptop’s taste, now on this phone: ${tops(after)}` : 'nothing from another device yet';
      } else if (gained.length) v.p3.linked.taste = `from her other signed-in devices: ${tops(gained)}`;
      renderSignedIn();
      panels.renderWho();
      director.sayAfter();
      focusOn($('p3Signed'));
      return true;
    }

    // ── The phone (beat 15) ─────────────────────────────────────────────────
    /** The laptop leads the beat: if the phone is on screen from an earlier press, the walk's own visitor comes back first. */
    async function laptopFirst() {
      if (S.phone && state.visitors[S.laptop]) await backToLaptop();
      if (!transport.cur()) throw new Error('nobody has arrived yet: the phone picks up a walk already under way (beat 1 first)');
      S.laptop = transport.cur().key;
      return true;
    }
    async function pickUpPhone() {
      const laptop = transport.cur();
      if (!laptop) throw new Error('nobody has arrived yet: the phone picks up a walk already under way (beat 1 first)');
      S.laptop = laptop.key;
      S.laptopTop = topOf(await reflexOf(laptop));
      S.phoneAfter = null; S.phoneTop = null; S.same = null; S.moved = null;
      setPhoneFrame(true);
      await transport.mintVisitor('B', transport.directEntry(), 'Her phone');
      S.phone = 'B';
      transport.useVisitor('B');
      panels.note('arrived', 'Her phone', 'a second device, a stranger to the engine: anonymous · consent granted · direct · nothing links it to the laptop until she signs in');
      await panels.restoreRegion();                  // her own region, from the request: never an asserted one on a new device
      await openPage(phoneKey(), { quiet: true, focus: 'hero' });
      S.phoneBefore = shownOn(phoneKey());
      return true;
    }
    async function backToLaptop() {
      setPhoneFrame(false);
      if (S.laptop && state.visitors[S.laptop] && transport.cur() !== state.visitors[S.laptop]) {
        transport.useVisitor(S.laptop);
        const link = linkOf(transport.cur());
        panels.note('returned', 'Her laptop', link ? `signed in as ${link.account}: the same person as her phone` : 'anonymous, as she left it');
      }
      renderSignedIn();
      return true;
    }
    /** m.html on its own: a direct load is a real arrival on the phone, a stranger decided live, her region from the request. */
    async function phoneArrival() {
      const v = await transport.mintVisitor('A', transport.landingEntry(), 'Her phone');
      transport.useVisitor('A');
      panels.note('arrived', 'Her phone', `a stranger on this device: ${transport.describeEntry(v.entry)} · anonymous · consent granted · no device matching`);
      await openPage(homeKey(), { quiet: true });
      await panels.loadColdStart();
      say('ready · this phone page was decided live for a stranger; Sign in names the fictional account; Next starts the walkthrough', 'good');
    }

    // ── Where to buy (beat 16): the two decided modules' bodies, and their outcomes ──
    const roomOfProduct = (p) => (p && p.attributes && p.attributes.room) || 'living-room';
    const offersPickup = (p) => arr(p && p.attributes && p.attributes.retailer).includes('best-buy-pickup');
    const recorded = (event, sku) => S.outcomes.filter((o) => o.event === event && o.sku === sku);
    function whereToBuyBody(d, p) {
      if (!d) return '';
      if (d.customerContentId === PICKUP) return pickupBody(p);
      if (d.customerContentId === RETAIL) return retailerBody(p);
      return '';
    }
    function pickupBody(p) {
      if (!p || !offersPickup(p)) {
        return '<div class="p3-wtb" data-wtb="pickup"><p class="pmod-rule">Best Buy pickup is not offered for this model in our data, so there is nothing to press here: the page never invents an option.</p></div>';
      }
      const done = recorded('partner_pickup', idOf(p))[0];
      return '<div class="p3-wtb" data-wtb="pickup"><p class="pmod-lead">Pickup changes how she gets it, not what she pays: the price is the buy box’s, the same for everyone.</p>'
        + (done ? `<p class="p3-done" data-p3-outcome="partner_pickup"><b>Best Buy pickup chosen</b> at ${esc(hhmm(done.at))} · sent as <code>partner_pickup</code> with this module’s decision (#${done.position} on this page), which earned it</p>`
          : '<div class="sactions"><button type="button" class="btn btn--brand btn--sm" data-act="partner-pickup" data-ctl="partner-pickup">Choose Best Buy pickup</button></div>')
        + '<p class="pmod-rule">A press is the named outcome <code>partner_pickup</code>, credited to the decision that put this module here, and counted as a pickup, never as a second purchase: no value is read for it.</p></div>';
    }
    function retailerBody(p) {
      const done = p ? recorded('retailer_referral', idOf(p)) : [];
      return `<div class="p3-wtb" data-wtb="retailer">${p && p.cta !== 'cart' ? '<p class="pmod-lead">Sold through retailers, not here: the list names the stores that carry it.</p>' : ''}`
        + '<div class="sactions"><button type="button" class="btn btn--line btn--sm" data-act="find-retailer" data-ctl="find-a-retailer">Find a Retailer</button></div>'
        + (done.length ? `<p class="p3-done" data-p3-outcome="retailer_referral"><b>Referred to ${esc(done.map((o) => o.retailerName).join(', '))}</b> at ${esc(hhmm(done[done.length - 1].at))} · sent as <code>retailer_referral</code> with this module’s decision (#${done[0].position} on this page), which earned it</p>` : '')
        + '<p class="pmod-rule">A retailer press is the named outcome <code>retailer_referral</code>, credited to the decision that put this module here. <b>A referral is not a sale</b>: registration is how a sale finds its way back.</p></div>';
    }
    /** The where-to-buy decision on the product page on screen, and its position: the decision a press is credited to. */
    function onScreen(cid) {
      if ((pageOf(state.viewPage) || {}).entry !== 'product') return null;
      const mods = transport.bySlot(state.sets[state.viewPage] || null, 'pdp-modules');
      const i = mods.findIndex((d) => d.customerContentId === cid);
      return i < 0 ? null : { d: mods[i], position: i + 1 };
    }
    function repaint(cid, p) {
      const node = document.querySelector(`#stage > .view:not([hidden]) [data-module="${cid}"] .p3-wtb`);
      if (node) node.outerHTML = cid === PICKUP ? pickupBody(p) : retailerBody(p);
    }
    /** E1's wire form: type custom, data.event the outcome's name, with the decision that earned it. */
    async function sendOutcome(event, at, p, extra) {
      const data = { event, ...(at ? { decisionId: at.d.decisionId, contentId: at.d.contentId, slot: at.d.slot, customerContentId: at.d.customerContentId } : {}),
        productId: idOf(p), ...extra };
      const r = await transport.send('custom', data);
      if (!r || !r.ok || (r.body && r.body.success === false)) throw new Error(`the engine did not take the ${event} (${(r && r.status) || 'no answer'}${r && r.body && r.body.error ? `: ${r.body.error}` : ''})`);
      return r;
    }
    /** The day's counts before this visit's first outcome, so the report can show what this visit added (one build, once). */
    async function baselineOnce() {
      if (S.baseline && S.baseline.date === today()) return;
      try {
        const out = await transport.demoRoute(SITE.api.report, { date: today(), slot: 'pdp-modules', build: true });
        S.baseline = { date: today(), counts: countsOf(out.report) };
      } catch { S.baseline = { date: today(), counts: Object.fromEntries(EVENTS.map((e) => [e, 0])), unknown: true }; }
    }
    async function pickup() {
      const p = productOf(state.productId), at = onScreen(PICKUP);
      if (!p || !at) throw new Error('Best Buy pickup is chosen on a product page where the engine decided the pickup module');
      if (!offersPickup(p)) throw new Error(`Best Buy pickup is not offered for the ${productName(p)}`);
      await baselineOnce();
      await sendOutcome('partner_pickup', at, p, { retailer: 'best-buy-pickup' });
      S.outcomes.push({ event: 'partner_pickup', sku: idOf(p), cid: PICKUP, decisionId: at.d.decisionId, position: at.position, retailerName: 'Best Buy', at: Date.now() });
      panels.note('outcome', `partner_pickup · ${productName(p)}`, `Best Buy pickup, an OH order handed over by a partner · credited to “${titleOf(at.d)}” (#${at.position}), the decision on screen · never a purchase`);
      repaint(PICKUP, p);
      return true;
    }
    async function findRetailer(t) {
      const p = productOf(state.productId);
      if (!p) return false;
      const at = onScreen(RETAIL);
      const fromBox = !(t.closest && t.closest('[data-op-decision-id]'));
      S.sheet = { sku: idOf(p) };
      const list = RETAILERS[roomOfProduct(p)] || RETAILERS['living-room'];
      sheets.open('retailers', `<p class="sk">Find a Retailer · ${esc(idOf(p))}</p><h2 id="sheetTitle">Where to buy the ${esc(productName(p))}</h2>`
        + '<p>The stores that carry it, the same list for everyone. Each sets its own price and stock: this site shows no price of theirs and undercuts no one.</p>'
        + list.map(([key, name]) => `<div class="srow"><span><b>${esc(name)}</b><br><span class="nper">online and in store · price at the retailer</span></span>`
          + `<button type="button" class="btn btn--line btn--sm" data-act="retailer-referral" data-retailer="${esc(key)}" data-retailer-name="${esc(name)}" data-ctl="retailer-${esc(key)}">Shop at ${esc(name)}</button></div>`).join('')
        + `<p class="p3-fine">${at ? `A press is sent as <code>retailer_referral</code> with “${esc(titleOf(at.d))}”, the decision on this page (#${at.position}) that earned it.`
          : 'The engine did not decide a where-to-buy module on this page, so a press here is counted as a referral and credited to no decision: the buy box is not decided.'}`
        + ' A referral is not a sale; registration is how a sale finds its way back. In the demo nothing leaves this page.</p>');
      await transport.sendCustom('find_a_retailer', productAttrs(p, { retailer: 'find-a-retailer', control: fromBox ? 'buy-box' : 'where-to-buy' }));
      panels.note('opened', `Find a Retailer · ${productName(p)}`, fromBox ? 'the buy box’s own button, the same for everyone' : 'from the decided where-to-buy module');
      return true;
    }
    async function referral(t) {
      const p = productOf(S.sheet && S.sheet.sku);
      if (!p) throw new Error('Find a Retailer first: the list belongs to a product page');
      const key = t.dataset.retailer, name = t.dataset.retailerName || key;
      const at = onScreen(RETAIL);
      await baselineOnce();
      await sendOutcome('retailer_referral', at, p, { retailer: 'find-a-retailer', partner: key });
      S.outcomes.push({ event: 'retailer_referral', sku: idOf(p), cid: RETAIL, decisionId: at ? at.d.decisionId : null, position: at ? at.position : null, retailerName: name, at: Date.now(), credited: Boolean(at) });
      panels.note('outcome', `retailer_referral · ${name}`, `${productName(p)} · ${at ? `credited to “${titleOf(at.d)}” (#${at.position}), the decision on screen` : 'credited to no decision: none on this page earned it'} · a referral is not a sale`);
      await sheets.close();
      repaint(RETAIL, p);
      return true;
    }

    // ── The day report: the kit's tables, named, and the outcomes beside them ──
    const pieceTitle = new Map();
    function titleById(id) {
      if (state.pieces.has(id)) return titleOfCid(id);
      if (!pieceTitle.size) for (const p of arr(state.engine && state.engine.pieces)) pieceTitle.set(p.id, p.title || p.customerContentId);
      return pieceTitle.get(id) || titleOfCid(id);
    }
    function reportLabels() {
      const where = { home: 'the homepage', tvs: 'the TV grid', product: 'product pages' };
      const out = {};
      for (const pg of SITE.pages) for (const s of arr(pg.slots)) if (!out[s.slot]) out[s.slot] = `${s.label} · ${where[pg.key] || pg.key}`;
      return out;
    }
    // The grid is keyed by the engine's piece id (mod_tv_soundbar), the cards by the customer's (mod-tv-soundbar): the kit matches the former.
    const attach = () => ({ slot: 'pdp-modules', head: 'Attach · the companion modules, credited clicks per exposure', rows: ATTACH.map(([k, name]) => [k.replace(/-/g, '_'), name]) });
    const theirs = () => 'Lift is LG’s to compute, against a holdout in its own warehouse; until it is, every count here is attribution and the report reads “not yet significant”.';
    function countsOf(rep) {
      const ev = (rep && rep.namedOutcomes && rep.namedOutcomes.events) || {};
      return Object.fromEntries(EVENTS.map((e) => [e, ev[e] ? Number(ev[e].outcomes) || 0 : 0]));
    }
    function wanted() {
      if (!S.baseline || !S.outcomes.length) return null;
      return Object.fromEntries(EVENTS.map((e) => [e, S.baseline.counts[e] + S.outcomes.filter((o) => o.event === e).length]));
    }
    function ordersOf(rep) {
      const vo = rep && rep.visitorOutcomes;
      if (!vo || !Array.isArray(vo.arms)) return null;
      return vo.arms.reduce((n, a) => n + (Number(a.byType && a.byType.purchase) || 0), 0);
    }
    function attachOf(rep) {
      const items = (rep && rep.grids && rep.grids['pdp-modules'] && rep.grids['pdp-modules'].learning && rep.grids['pdp-modules'].learning.items) || {};
      let n = 0, s = 0;
      for (const [id, cells] of Object.entries(items)) {
        const key = String(id).replace(/_/g, '-');
        if (!ATTACH.some(([k]) => key.includes(k))) continue;
        const c = cells['*'] || Object.values(cells)[0] || {};
        n += Number(c.n) || 0; s += Number(c.s) || 0;
      }
      return { n, s, rate: n ? `${((s / n) * 100).toFixed(1)}%` : '—' };
    }
    function outcomesBox() {
      let box = $('p3Outcomes');
      const body = $('reportBody');
      if (!box && body) { body.insertAdjacentHTML('afterend', '<div class="p3-outcomes" id="p3Outcomes" aria-live="polite"></div>'); box = $('p3Outcomes'); }
      return box;
    }
    function renderOutcomes(rep, error) {
      const box = outcomesBox();
      if (!box) return;
      if (!rep) { box.innerHTML = error ? `<p class="rep-k">Outcomes</p><p class="m-empty">${esc(String((error && error.message) || error))}</p>` : ''; return; }
      const named = rep.namedOutcomes;
      const ev = (named && named.events) || {};
      const mine = (e) => S.outcomes.filter((o) => o.event === e && o.at >= Date.parse(`${rep.date || today()}T00:00:00Z`)).length;
      const cell = (e, k) => (named === null || named === undefined ? '—' : ev[e] ? Number(ev[e][k]) || 0 : 0);
      const orders = ordersOf(rep), a = attachOf(rep);
      const row = (name, n, s, r) => `<div class="rep-row"><span class="nm">${name}</span><span class="n">${n}</span><span class="s">${s}</span><span class="r">${r}</span></div>`;
      const credits = EVENTS.map((e) => {
        const by = (ev[e] && ev[e].bySlot) || {};
        const where = Object.entries(by).flatMap(([slot, items]) => Object.entries(items).map(([item, n]) => `${titleById(item)} on ${(reportLabels()[slot] || slot)} ×${n}`));
        return where.length ? `<b>${e}</b> credited to ${esc(where.join('; '))}` : null;
      }).filter(Boolean);
      box.innerHTML = `<p class="rep-k">Outcomes · the UTC day ${esc(rep.date || today())} · side by side</p>`
        + '<div class="rep-row rep-head"><span>Outcome</span><span class="n">day</span><span class="s">credited</span><span class="r">this visit</span></div>'
        + row('Orders shipped · visitors who purchased', orders === null ? '—' : orders, '—', '—')
        + row('Best Buy pickups · <code>partner_pickup</code>', cell('partner_pickup', 'outcomes'), cell('partner_pickup', 'credited'), mine('partner_pickup'))
        + row('Retailer referrals · <code>retailer_referral</code>', cell('retailer_referral', 'outcomes'), cell('retailer_referral', 'credited'), mine('retailer_referral'))
        + row('Attach · companion modules, credited clicks of exposures', a.n ? `${a.s.toFixed(0)} of ${a.n.toFixed(0)}` : '0', '—', a.rate)
        + `${named === null ? '<p class="rep-theirs">The engine’s report cannot say the named outcomes for this day (an hour folded before they were counted).</p>' : ''}`
        + `${credits.length ? `<p class="rep-theirs">${credits.join(' · ')}.</p>` : ''}`
        + '<div class="rep-flag"><b>Not yet significant.</b> Attribution: each outcome is credited to the decision on screen that earned it, within its window. A pickup is an order handed over by a partner, never a second purchase; a referral is not a sale. Lift is LG’s to compute against a holdout in its own warehouse.</div>';
    }
    /** Read the day's outcomes; when this visit's presses are not in the ledger yet (it records a few seconds after), build again. */
    async function readOutcomes(built) {
      const gen = ++S.gen, want = wanted();
      let out = null, tries = 0;
      for (;;) {
        try { out = await transport.demoRoute(SITE.api.report, { date: today(), slot: 'pdp-modules', ...(built || tries ? {} : { build: true }) }); }
        catch (error) { if (gen === S.gen) renderOutcomes(null, error); return false; }
        const c = countsOf(out.report);
        if (!want || EVENTS.every((e) => c[e] >= want[e]) || tries >= 6) break;
        tries += 1;
        if (gen === S.gen) renderOutcomes(out.report);
        await sleep(2500);
        try { await transport.demoRoute(SITE.api.report, { date: today(), slot: 'pdp-modules', build: true }); } catch { /* the read below says what the engine says */ }
      }
      if (gen !== S.gen) return false;
      S.report = { at: Date.now(), counts: countsOf(out.report), orders: ordersOf(out.report), want, counted: !want || EVENTS.every((e) => countsOf(out.report)[e] >= want[e]) };
      renderOutcomes(out.report);
      if (tries) { S.quiet = true; try { await panels.loadReport(false); } finally { S.quiet = false; } }   // the kit's tables, from the day just rebuilt
      return true;
    }
    /** Beat 16's last press: the kit builds today's report, then the outcomes beside it. */
    async function dayReport() {
      S.quiet = true;
      try { await panels.loadReport(true); } finally { S.quiet = false; }
      await readOutcomes(true);
      director.sayAfter();
      return true;
    }
    /** A hand on Build today's report: the kit renders its tables, then the outcomes are read beside them. */
    function watchReport() {
      const body = $('reportBody');
      if (!body) return;
      outcomesBox();
      new MutationObserver(() => {
        if (S.quiet) return;
        if (/Reading the ledger/.test(body.textContent || '')) { renderOutcomes(null); return; }
        if (body.querySelector('.rep-window, .rep-k')) void readOutcomes(true);
      }).observe(body, { childList: true });
    }

    // ── The dispatcher's share: this section's controls ──────────────────────
    async function control(t) {
      const act = t && t.dataset ? t.dataset.act : null;
      if (act === 'sign-in') { openSignIn(); return true; }
      if (act === 'sign-in-as') return signInAs(t.dataset.account);
      if (act === 'partner-pickup') return pickup();
      if (act === 'find-retailer') return findRetailer(t);
      if (act === 'retailer-referral') return referral(t);
      return false;
    }

    // ── The facts beats 15–16 speak about, read fresh ────────────────────────
    function facts() {
      const v = transport.cur();
      const laptop = S.laptop && state.visitors[S.laptop] ? state.visitors[S.laptop] : (S.phone ? null : v);
      const phone = S.phone && state.visitors[S.phone] ? state.visitors[S.phone] : null;
      const count = (e) => S.outcomes.filter((o) => o.event === e).length;
      const c = S.report ? S.report.counts : null;
      return {
        signIn: { account: ACCOUNTS[0] || null, receipt: RECEIPT, here: linkOf(v) ? linkOf(v).account : null, laptopLinked: Boolean(laptop && linkOf(laptop)) || null },
        phone: { on: Boolean(phone) || null, signedIn: Boolean(phone && linkOf(phone)) || null, laptopTop: tops(S.laptopTop), top: tops(S.phoneTop),
          same: S.same, moved: S.moved },
        whereToBuy: { tv: WALK.tv, tvName: nameOfSku(WALK.tv), pickupSku: WALK.pickup, pickupName: nameOfSku(WALK.pickup), referralSku: WALK.referral,
          referralName: nameOfSku(WALK.referral), retailer: WALK.retailer, retailerName: 'Costco', pickups: count('partner_pickup') || null, referrals: count('retailer_referral') || null },
        report: { read: Boolean(S.report) || null, counted: S.report ? S.report.counted : null, pickups: c ? c.partner_pickup : null, referrals: c ? c.retailer_referral : null,
          orders: S.report ? S.report.orders : null },
      };
    }
    /** A new walk (beat 1) starts with nobody signed in and no phone. */
    function reset() {
      Object.assign(S, { laptop: null, phone: null, laptopTop: null, phoneBefore: null, phoneAfter: null, phoneTop: null, same: null, moved: null, outcomes: [], baseline: null, report: null, sheet: null });
      setPhoneFrame(false);
      renderOutcomes(null);
    }

    // ── Registration, once ──────────────────────────────────────────────────
    // The phone is the homepage's slots at phone width: it asks as the homepage does (P1's question), keyed as the phone.
    if (SITE.entries.phone && !LANES.ask[SITE.entries.phone] && LANES.ask[SITE.entries.home]) LANES.ask[SITE.entries.phone] = (k) => LANES.ask[SITE.entries.home](k);
    LANES.beforeBeat.push((b) => { if (b && b.data && b.data.arrives) reset(); });
    style();
    wireSignIn();
    watchWho();
    watchReport();
    renderSignedIn();
    return { laptopFirst, pickUpPhone, backToLaptop, phoneArrival, dayReport, readOutcomes, control, facts, whereToBuyBody, reportLabels, attach, theirs, titleById, state: S };
  })();

  // ── The routes and the one dispatcher (shared). The cursor and a human hand run the same handler. ─
  async function restoreFromUrl() {
    const q = new URLSearchParams(location.search);
    if (/\/product(\.html)?$/.test(location.pathname)) return openProduct(q.get('id'), { event: false });
    if (q.get('view') && pageOf(q.get('view'))) return openPage(q.get('view'), { event: false });
    return openPage(homeKey(), { event: false });
  }
  async function handleControl(t) {
    await transport.creditDecided(t);
    if (await p3Control(t)) return true;   // the P3 section's controls: sign-in, where-to-buy
    for (const own of LANES.controls) { const done = await own(t); if (done !== undefined) return done; }   // the other sections' controls (LANES.controls)
    if (t.dataset.nav) return openPage(t.dataset.nav === 'home' ? homeKey() : t.dataset.nav);
    if (t.dataset.open) return openProduct(t.dataset.open);
    if (t.dataset.act === 'add-to-cart') {
      const p = productOf(state.productId);
      if (p) { await transport.send('add_to_cart', productAttrs(p)); panels.note('added', productName(p), 'to the cart: the buy box is off limits, its events are not'); }
      return true;
    }
    if (t.dataset.act === 'piece') { panels.note('clicked', titleOfCid(t.dataset.cid), 'a decided piece: its click is the reward it is judged on'); return true; }
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
  // THE FACTS the beats speak about (public/oh/beats.json): a skeleton.
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
      ...p3Facts(),   // signIn, phone, whereToBuy, report: the P3 section's facts (beats 15–16)
      clock: { days: SITE.clockJump ? SITE.clockJump.days : null },
      // The other sections' own facts (LANES.facts), read fresh like the rest.
      ...Object.fromEntries(Object.entries(LANES.facts).map(([name, read]) => [name, read()])),
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
    state.visitors = {}; state.who = null; state.receipts.clear(); state.sets = {};
    const params = adParams();
    try { history.replaceState({ [SITE.slug]: true }, '', `${ENTRY === 'phone' ? `${BASE}m` : BASE}?${params}`); } catch { /* sandboxed */ }
    const v = await transport.mintVisitor('A', transport.landingEntry(params));
    transport.useVisitor('A');
    panels.note('arrived', 'A stranger, from the landing', `${transport.describeEntry(v.entry)} · anonymous · consent granted`);
    state.own = null;
    panels.setRegion(panels.ownRegion(), panels.ownSource());
    if (flags.region) panels.note('asserted', `region = ${flags.region}`, 'a rehearsal override (?region=), labelled · never the default');
    await panels.loadColdStart();
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

  // ════════════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════════════
  (async () => {
    try {
      if (flags.fixtures) $('fixtureFlag').hidden = false;
      const [anchor, beatsDoc, productsDoc, overlayDoc] = await Promise.all([
        transport.firstJson('anchor', [`${BASE}beats/anchor.json`]),
        transport.firstJson('beats', [`${BASE}beats.json`]),
        transport.firstJson('products', [SITE.products.file]),
        SITE.products.overlay ? transport.tryJson(SITE.products.overlay.file) : Promise.resolve(null),
      ]);
      if (!beatsDoc || !Array.isArray(beatsDoc.beats)) throw new Error(`beats.json is missing: the director's script is public/${SITE.slug}/beats.json`);
      if (!anchor) throw new Error(`beats/anchor.json is missing: node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/${SITE.slug}.json --files-only`);
      state.anchor = anchor;
      // The registry the arithmetic reads: the anchor's copy of the published document (the seed holds them equal).
      state.registry = anchor.registry || null;
      state.sources.registry = anchor.registry ? 'beats/anchor.json registry' : 'missing';
      state.products = mergeOverlay(arr(productsDoc && productsDoc[SITE.products.list]), overlayDoc);
      state.sources.overlay = overlayDoc ? SITE.products.overlay.file.replace(BASE, '') : 'none';
      state.products.forEach((p) => state.productById.set(idOf(p), p));
      if (anchor.events && anchor.events.source) transport.configure({ source: anchor.events.source });
      await useCatalog('open-catalog');
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
      for (const s of slotsOf(homeKey())) { const box = $(`slot-${s.slot}`); if (box) box.innerHTML = '<p class="slot-wait">Before anyone arrives nothing is decided. Press <b>Next</b> and a stranger lands.</p>'; }
      for (const rail of railsOf(homeKey())) renderRail(rail);
      demo.debug({ handleControl });   // under ?debug, window.__oh: the hook the DOM suite drives
      const loaded = ['anchor', 'beats', 'products'].map((k) => `${k}: ${state.sources[k] || 'missing'}`).join(' · ');
      say(`ready · ${loaded} · registry: ${state.sources.registry}`, 'good');
      demo.compare.prefetch();
      // A direct load of the product page is a real arrival on it: a visitor, the product, and the live answer.
      if (ENTRY === 'product') {
        const id = new URLSearchParams(location.search).get('id');
        await openProduct(id).then(() => panels.loadColdStart())
          .then(() => say('ready · this product page was decided live for a direct visitor; Next starts the walkthrough', 'good'))
          .catch((error) => { engineDown(String(error.message || error)); say(String(error.message || error), 'bad'); });
      } else if (ENTRY === 'grid') {
        await restoreFromUrl().catch((error) => { engineDown(String(error.message || error)); say(String(error.message || error), 'bad'); });
      } else if (ENTRY === 'phone') {
        await phoneArrival().catch((error) => { engineDown(String(error.message || error)); say(String(error.message || error), 'bad'); });   // P3: a stranger on the phone
      }
      // The sections' own boot steps (a direct load of the grid, the static menus), in order.
      for (const step of LANES.boot) await step(ENTRY);
    } catch (error) {
      say(String(error.message || error), 'bad');
      engineDown(String(error.message || error));
    }
  })();
})();
