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
// The store (lane M3): the cart, navigation and Back, manual events and the re-ask, search, Find a Retailer, the
// sign-in from every header, the toast. Its contract is the header of public/oh/oh-store.js; every section shares it.
import { store } from '/oh/oh-store.js';

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
    "legal": "OH. is a fictional home brand built for a demonstration. Products, their names, images and prices are real as listed publicly on 2 October 2026; offers, packages and regional sales are representative. Price, financing and rebate eligibility never vary by where someone lives or by inferred income."
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
          "take": 5,
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
          "take": 12,
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
    "scoredSentence": "No census term enters any score, and none shaped this synthetic lean; the census is shown for context. The lean is the brand’s own sales, seeded here as synthetic data.",
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
      "A piece only where its rule admits it: the product page’s companions gate on ctx.family, the family of the product on the page; a condition the request does not carry fails closed."
    ],
    [
      "built",
      "slot seeds",
      "The search term lifts the category it names, as context, never as evidence about the visitor; the receipt itemises it."
    ],
    [
      "built",
      "learn.regional",
      "The brand’s regional sales, synthetic here and labelled synthetic → warehouse, blended by λ = K / (K + Σa), giving way as the visitor’s evidence grows."
    ],
    [
      "built",
      "POST /sort with the regional prior",
      "The rails and every grid over the products file, leaning with the state under the allowlist and saying so on screen; at an affinity weight of zero the site’s own order exactly."
    ],
    [
      "built",
      "complements",
      "A piece names the products it completes; on that product’s page (ctx.anchor) the slot rule prefers it, itemised on the receipt as “Completes what was committed to”."
    ],
    [
      "built",
      "partner_pickup and retailer_referral",
      "Two named outcomes, credited to the decision that earned them and counted in the day report; a referral is never a sale."
    ],
    [
      "designed",
      "gclid on the entry contract",
      "The channel classification reads Google’s auto-tagged click as paid search; the entry contract does not carry gclid yet, so the walk lands on its search term."
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
  //    routes[name](route, opts) → painted: the store's navigation (oh-store.js store.nav) calls a section's own
  //    renderer for its route (home, grid { view }, product { id }, search { q }, phone) and falls back to the shared
  //    openPage / openProduct when none is registered; opts.event === false is a restore from the browser's Back.
  const LANES = { render: {}, ask: {}, verbs: {}, rows: {}, facts: {}, controls: [], compareTools: [], beforeBeat: [], boot: [], hooks: {}, routes: {} };

  // ════════════════════════════════════════════════════════════════════════
  // THE KIT. Every hook below answers a question the chassis asks; the module
  // headers in public/demo-kit/ name each one.
  // ════════════════════════════════════════════════════════════════════════
  const demo = createDemo({
    tenant: SITE.tenant, api: SITE.api, pageNames: PAGES, slots: {}, dimLabels: SITE.dimLabels, source: SITE.source, docBase: BASE,
    debugName: '__oh', intents: SITE.intents, roadmap: SITE.roadmap,
    // The director docked right, collapsed to a slim rail by default so the site is the store (design §9.1); the
    // presenter's key (D) or ?present=1 opens it, and it remembers its state in this tab (kit option, lane M3).
    dock: { collapsed: true, onForget: () => { store.visitor.forget(); store.cart.clear(); location.assign('/oh/'); } },   // "Forget this browser": back to the cold open (M1d)
    // "What has been signalled": the audiences the engine holds, as chips under the meters, as Meridian showed them (kit, K8).
    signals: { audiences: true },
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
    // A reset starts a new person (the sign-in ruling): what this browser kept of her goes with it (M3).
    published: async (kind) => { if (kind === 'reset') { store.visitor.forget(); await useCatalog('open-catalog'); } },
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

  // ── The store, bound once (lane M3): the kit, the feed's readers and the shared openers, read lazily ─
  const synthetic = (act) => { const b = document.createElement('button'); b.dataset.act = act; return b; };
  store.bind({
    demo, site: SITE, lanes: LANES, base: BASE,
    productOf: (id) => productOf(id), productAttrs: (p, extra) => productAttrs(p, extra), idOf: (p) => idOf(p), productName: (p) => productName(p),
    priceOf: (p) => priceOf(p), imageOf: (p) => imageOf(p), field: (p, path) => field(p, path), products: () => state.products,
    openPage: (key, opts) => openPage(key, opts), openProduct: (id, opts) => openProduct(id, opts), askPage: (key) => askPage(key),
    homeKey: () => homeKey(), pageOf: (key) => pageOf(key), phoneKey: () => SITE.entries.phone || homeKey(),
    // The sign-in sheet is P3's (the fictional account; the worker mints the link); the store opens it from any header.
    signIn: { open: () => p3Control(synthetic('sign-in')), account: () => { const v = transport.cur(); return (v && v.p3 && v.p3.linked && v.p3.linked.account) || null; } },
    // An outcome the store's Find a Retailer sends: P3 reads the day's baseline once before it, and records it after it
    // (beat 16's facts, the report's "this visit", the where-to-buy module's own line).
    beforeOutcome: () => (typeof P3 !== 'undefined' && P3.beforeOutcome ? P3.beforeOutcome() : null),
    outcome: (o) => { if (typeof P3 !== 'undefined' && P3.recordOutcome) P3.recordOutcome(o); },
  });

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
    const canon = store.nav.canonical(path);   // the route's own address (/oh/search?q=x is written /oh/?q=x, which a reload serves)
    const to = extra ? `${canon}${canon.includes('?') ? '&' : '?'}${extra}` : canon;
    // The same place again (a restore from the browser's Back, a re-open) replaces the entry, so Back stays one press.
    try { if (store.nav.same(canon, location.pathname + location.search)) history.replaceState({ [SITE.slug]: true }, '', to); else history.pushState({ [SITE.slug]: true }, '', to); } catch { /* sandboxed */ }
  }
  // Before any view (the boot page), the page on screen is the homepage's published template, named as such.
  const whereNow = () => { const p = pageOf(state.viewPage); return p ? (p.entry === 'product' ? `${productName(productOf(state.productId)) || 'product'} page` : `${p.key} page`) : `${homeKey()} page`; };

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
  //   the store       (lane M1, design §9) LG's look and a store that works by hand, on M3's store (oh-store.js):
  //                   the boot page is the published template (the opening catalog's pieces in each slot's own order:
  //                   in force, nothing asked, the slot's diversity rule, its take; the rail and the grids in the order
  //                   the products file's template declares, best sellers), never a visitor on load; the header
  //                   (the same on every shell), the pencil banner, the 13 category icons, the hero carousel, the
  //                   service strip, the expert band, the showcase tabs, the benefits and the footer, all static; the
  //                   room grids (/oh/?view=tvs|laundry|kitchen|offers) and the search results (/oh/?q=) with
  //                   working filters from the feed's attributes, a sort control (Best match = POST /sort's order;
  //                   price; rating: the visitor's own choice), the declared fit, the result count and the regional
  //                   label. A filter she turns on sends the filter event (the beat verbs' shape) and the grid asks
  //                   again; nothing on these pages ranks: the order is POST /sort's, or the sort she chose
  // Its own names live in the closure below (other sections share this scope); renderRail and openPage stay
  // declarations because the shared code calls them.
  /** A /sort rail painted from what the page holds (no question asked): the shared boot and askPage call it. */
  function renderRail(rail) { void P1.paintRail(rail); }
  async function openPage(key, opts = {}) {
    const p = pageOf(key);
    if (!p) throw new Error(`no page named "${key}"`);
    if (p.entry === 'product') return openProduct(opts.id || state.productId, opts);
    await store.visitor.ensure();                 // one mint, shared with the store's dispatcher: the first click, never the load
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
    /** A grid's own state: the rail's answer, her declared fit, her filters, her choice of order, how many are shown. */
    const freshGrid = () => ({ set: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null }, fit: null, hidden: [], unknown: 0, f: {}, sort: 'best', show: 24 });
    const S = {
      ready: null, display: new Map(), images: {}, weights: {}, takes: {}, openSlots: {},
      home: { set: null, slots: {}, heroWas: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null } },
      grid: freshGrid(),
      grids: {}, search: { q: '', matches: [] }, tpl: false, zip: null, slide: 0, pencil: 0, tab: 'appliances', template: null, feedAsOf: null, art: null,
      mark: null, windows: null, held: null, pin: null, clock: null, returned: false, lead: null, quiet: false, restoring: false, contrast: null, contrastAsk: null,
    };

    // ── The store's grids (M1): every room's grid and the search results, on one machinery ─────────────────────
    // tvs is the TV grid the walk uses (its rail, its weights and its fit are P1's, from demo.config.json); the others
    // ask POST /sort over their own room with the engine's default weights. A grid's candidates are its products with a
    // price of ours, filtered by what she chose (the filters are hers, never decided), then by her declared space.
    const GRIDS = {
      tvs: { title: 'TVs', cats: ['tvs'], fit: 'tvs', groups: ['type', 'sizeBand', 'price', 'stock', 'sale'],
        quick: [['OLED', 'type', 'oled', 'OLED65C6PUA'], ['QNED', 'type', 'qned', '65QNED8MBAA'], ['Micro RGB', 'type', 'micro-rgb', '75MRGB95BUA'], ['4K UHD', 'type', 'uhd', '50NU700BPUA'], ['Lifestyle', 'type', 'lifestyle', '27LX6TYGA'], ['HD', 'type', 'hd', '24LJ4540-WU']] },
      laundry: { title: 'Washers & dryers', cats: ['washers', 'dryers', 'washtowers', 'washer-dryer-combos', 'laundry-sets', 'pedestals', 'laundry-accessories'], fit: 'laundry-room',
        groups: ['category', 'type', 'capacityTier', 'fuel', 'finish', 'price', 'stock', 'sale'],
        quick: [['Washers', 'category', 'washers', 'WM4000HWA'], ['Dryers', 'category', 'dryers', 'DLEX4000W'], ['WashTower', 'category', 'washtowers', 'WKE100HWA'], ['All-in-one', 'category', 'washer-dryer-combos', 'LUWM101HWA'], ['Laundry sets', 'category', 'laundry-sets', 'WM4000HWA_DLEX4000W_WD300CW_WDP6W'], ['Pedestals', 'category', 'pedestals', 'WDP6A']] },
      kitchen: { title: 'Kitchen', cats: ['ranges', 'microwaves', 'dishwashers', 'kitchen-packages'], fit: 'kitchen', groups: ['category', 'type', 'fuel', 'finish', 'price', 'stock', 'sale'],
        quick: [['Ranges', 'category', 'ranges', 'LSGL6335X'], ['Microwaves', 'category', 'microwaves', 'MVEM1825F'], ['Dishwashers', 'category', 'dishwashers', 'LDNTH753S'], ['Kitchen packages', 'category', 'kitchen-packages', 'LF24Z6530S_LSGL5833X_MVEM1825F_ADFD5448AT']] },
      offers: { title: 'Offers', cats: null, sale: true, groups: ['room', 'category', 'price', 'stock'],
        quick: [['TVs & audio', 'room', 'living-room', 'OLED77G6WUA'], ['Laundry', 'room', 'laundry-room', 'WM4000HWA'], ['Kitchen', 'room', 'kitchen', 'LSGL6335X']] },
      search: { title: 'Search', cats: null, groups: ['category', 'type', 'price', 'stock', 'sale'], quick: [] },
    };
    const GRID_OF_SLOT = { 'tv-grid': 'tvs', 'laundry-grid': 'laundry', 'kitchen-grid': 'kitchen', 'offers-grid': 'offers', 'search-grid': 'search' };
    /** The rail a grid asks with: the TV grid's from the config (its published weights), the others' own. */
    const gridRail = (view) => (view === 'tvs' ? railsOf(GRID)[0] : { slot: `${view}-grid`, take: 24, label: GRIDS[view].title, view });
    const viewOfRail = (rail) => (rail ? GRID_OF_SLOT[rail.slot] || null : null);
    /** A grid's state; the TV grid's is P1's own S.grid (the walk's beats read it), the others' are kept by name. */
    const gs = (view) => (view === 'tvs' ? S.grid : (S.grids[view] || (S.grids[view] = freshGrid())));
    const isGrid = (key) => Object.prototype.hasOwnProperty.call(GRIDS, key);

    // ── The page's own documents ────────────────────────────────────────────
    function data() {
      if (S.ready) return S.ready;
      S.ready = Promise.all([transport.tryJson(`${BASE}catalog.json`), transport.tryJson(`${BASE}img/index.json`), transport.tryJson(`${BASE}demo.config.json`),
        transport.tryJson(`${BASE}beats/open-slots.json`), transport.tryJson(SITE.products.file), transport.tryJson(`${BASE}img/art/index.json`)])
        .then(([cat, idx, cfg, slots, feed, art]) => {
          S.art = art && typeof art === 'object' ? art : null;   // lane A1's campaign art by piece id; none yet: the soft scenes
          // The site's own merchandising order, declared in the products file (best sellers, the same for everyone): what
          // the rail and the grids show before anyone arrives. Read as the file gives it; the page orders nothing.
          S.template = (feed && feed.template && typeof feed.template === 'object') ? feed.template : null;
          S.feedAsOf = (feed && feed.asOf) || null;
          for (const p of arr(cat && cat.pieces)) if (p && p.customerContentId && p.display) S.display.set(p.customerContentId, p.display);
          S.images = (idx && idx.products) || {};
          for (const pg of arr(cfg && cfg.pages)) for (const r of arr(pg.sorted)) if (r && r.weights) S.weights[r.slot] = r.weights;
          // Each rail's and slot's take as the config gives it (M1e, the lead's rulings: Recommended for you 12, deals 5), so a
          // rail follows the config rather than the scaffold's copy of it in SITE; a slot's template takes the published opening
          // slots document's take first (the engine's own answer always sets how many a decided slot shows).
          for (const pg of arr(cfg && cfg.pages)) for (const s of [...arr(pg.slots), ...arr(pg.sorted)]) if (s && s.slot && num(s.take) > 0) S.takes[s.slot] = num(s.take);
          // The opening slots as published (their take and diversity rule): what the template applies before anyone arrives.
          const pages = (transport.unwrap(slots) || {}).pages || ((((slots || {}).publish || {}).document || {}).pages) || {};
          for (const list of Object.values(pages)) for (const s of arr(list)) if (s && s.slot) S.openSlots[s.slot] = s;
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
        const filter = `category:${cat}${type ? `,type:${type}` : ''}`;
        return `<div class="p1-menu-group"><p class="p1-menu-h"><button type="button" data-act="m1-goto" data-view="${key}" data-filter="${esc(filter)}" data-ctl="menu-head-${esc(cat)}${type ? `-${esc(type)}` : ''}">${esc(label)} &rsaquo;</button></p>${list.map((p) => `<button type="button" class="p1-menu-item" data-open="${esc(idOf(p))}" data-ctl="menu-${esc(idOf(p))}">`
          + `${artHtml(p, 'p1-art--menu')}<span><b>${esc(productName(p))}</b><em>${money(priceNum(p))}</em></span></button>`).join('')}</div>`;
      }).join('');
      return `<div class="p1-menu" id="menu-${key}" hidden><div class="p1-menu-in">${groups}</div><p class="p1-menu-foot"><button type="button" class="btn btn--line btn--sm" data-nav="${key}" data-ctl="menu-all-${key}">Shop all ${esc(m.label.toLowerCase())}</button><span class="nper">not personalised</span> the site’s own picks, the same for everyone</p></div>`;
    }
    function ensureChrome() {
      M1.chrome();                                   // the store's header, pencil banner and footer, the same on every shell
      const nav = $('mainnav');
      if (nav && !nav.querySelector('[data-ctl="nav-laundry"]')) {
        const tv = nav.querySelector('[data-ctl="nav-tvs"]');
        const btns = Object.entries(MENUS).map(([key, m]) => `<button type="button" data-act="p1-menu" data-menu="${key}" data-ctl="nav-${key}" aria-expanded="false">${esc(m.label)}</button>`).join('');
        if (tv) tv.insertAdjacentHTML('afterend', btns); else nav.insertAdjacentHTML('afterbegin', btns);
      }
      if (nav && !$('menu-laundry') && state.products.length) {
        const mast = nav.closest('.mast') || nav.parentElement;
        mast.insertAdjacentHTML('afterend', Object.keys(MENUS).map(menuHtml).join(''));
      }
      const hero = $('mod-hero');
      if (hero && !$('p1Arrival')) hero.insertAdjacentHTML('beforebegin', '<p class="p1-arrival" id="p1Arrival" hidden></p>');
      for (const [slot, cap] of [['category-rail', 'The tiles before this press'], ['deals', 'What was on screen before this press']]) {
        const box = $(`slot-${slot}`);
        if (box && !$(`p1Ghosts-${slot}`)) box.insertAdjacentHTML('beforebegin', `<section class="changes p1-changes" id="p1Changes-${slot}" aria-live="polite">
          <div class="changes-before"><span class="changes-cap">${esc(cap)}</span><div class="ghosts" id="p1Ghosts-${slot}"><span class="ghost-empty">Not seen yet.</span></div></div>
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
      for (const view of Object.keys(GRIDS)) {
        if (view === 'tvs') continue;
        const rail = gridRail(view), box = $(`rail-${rail.slot}`), chip = $(`chip-${rail.slot}`);
        if (chip && !$(`lean-${rail.slot}`)) chip.insertAdjacentHTML('beforebegin', `<span class="p1-lean" id="lean-${rail.slot}" hidden></span>`);
        const room = GRIDS[view].fit;
        if (box && room && !$(`m1Fit-${view}`)) {
          box.insertAdjacentHTML('beforebegin', `<div class="p1-fit" id="m1Fit-${view}">
            <span class="p1-fit-k">Your space</span><label class="p1-fit-in"><input type="number" id="m1FitWidth-${view}" min="18" max="60" step="0.5" inputmode="decimal" aria-label="The width of your space, in inches"> in wide</label>
            <button type="button" class="btn btn--line btn--sm" data-act="p1-fit" data-view="${view}" data-ctl="fit-apply-${view}">Apply</button>
            ${(room === 'kitchen' ? [24, 30, 33, 36] : [24, 27, 28, 30]).map((w) => `<button type="button" class="p1-chip" data-act="p1-fit" data-view="${view}" data-fit="${w}" data-ctl="fit-${view}-${w}">${w} in</button>`).join('')}
            <button type="button" class="p1-chip" data-act="p1-fit" data-view="${view}" data-fit="" data-ctl="fit-clear-${view}">Clear</button>
            <p class="p1-fit-note" id="m1FitNote-${view}"></p></div>`);
          const input = $(`m1FitWidth-${view}`);
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const go = document.querySelector(`#m1Fit-${view} [data-ctl="fit-apply-${view}"]`); if (go) go.click(); } });
        }
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
      document.body.classList.add('m1-live');           // a decided paint: the before/now strips and the arrival line may show
      state.sets[key] = r.set;
      if (own(key).key === HOME) S.home.set = r.set; else S.grid.set = r.set;
      for (const s of slotsOf(key)) renderSlot(s, transport.bySlot(r.set, s.slot));
      for (const rail of railsOf(key)) await sortAndPaint(key, rail, v);
      arrivalLine();
      M1.zip();
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
      if (d.strategy === 'template') return `the published template · ${d.slot === 'deals' ? 'container' : 'position'} ${i + 1} · the catalog’s own order: nobody has arrived, nothing is decided yet`;
      const rec = recOf(d), ex = (rec && rec.explain) || {};
      const parts = [d.strategy === 'default' ? `container ${i + 1} · the catalog’s order: nothing in the profile scores it` : `rank <b>${i + 1}</b> · score <b>${fmt3(d.score)}</b>`];
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
      const tags = (piece && piece.tags) || {}, disp = dispOf(cid);
      const cats = arr(disp.categories).length ? arr(disp.categories) : arr(tags.category), room = arr(tags.room)[0];
      const featured = arr(piece && piece.featuredProductIds);
      if (featured.length && featured.length <= 2) { const p = productOfPiece(piece, cid); if (p) return `data-open="${esc(idOf(p))}"`; }
      // A room's piece goes to that room's grid, filtered to the categories it names (the store's own navigation, no event of its own).
      const view = room === 'laundry-room' ? 'laundry' : room === 'kitchen' ? 'kitchen' : room === 'living-room' || cats.includes('tvs') || cats.includes('soundbars') ? 'tvs' : null;
      if (view === 'tvs' && cats.length && !cats.includes('tvs')) return `data-act="m1-goto" data-view="search" data-q="${cats.includes('soundbars') ? 'soundbar' : 'mount'}"`;
      if (view === 'tvs') return 'data-nav="tvs"';
      if (view) {
        const inGrid = cats.filter((c) => arr(GRIDS[view].cats).includes(c));
        return inGrid.length ? `data-act="m1-goto" data-view="${view}" data-filter="${esc(inGrid.map((c) => `category:${c}`).join(','))}"` : `data-nav="${view}"`;
      }
      const p = productOfPiece(piece, cid);
      return p ? `data-open="${esc(idOf(p))}"` : 'data-nav="tvs"';
    }

    // ── The hero, take 1 ────────────────────────────────────────────────────
    // ── The campaign art (lane A1, design §10): by piece id from img/art/index.json; until it lands, a soft scene with the
    //    product itself on it. The headline, the sub and the button are the piece's own copy, drawn over the art.
    const roomOfPiece = (piece) => arr(piece && piece.tags && piece.tags.room)[0] || (arr(piece && piece.tags && piece.tags.category).includes('tvs') ? 'living-room' : 'living-room');
    const KICKER = { 'living-room': 'TV & audio', 'laundry-room': 'Laundry', kitchen: 'Kitchen' };
    /** A1's formats by the page's roles: a hero is a slide (1440×640); tall (720×860), tile (720×420), banner (1440×360). */
    const ART_ROLE = { hero: ['slide540', 'slide'] };   // the full-bleed hero is 1440×540 (A1's slide540); the 640 slide where a piece has none
    const VIEW_OF_ROOM = { 'living-room': 'tvs', 'laundry-room': 'laundry', kitchen: 'kitchen' };
    /** The room's own art piece (A1's index maps a grid's view to it): the banners. */
    const roomArtKey = (room) => { const r = S.art && S.art.rooms; return r ? r[VIEW_OF_ROOM[room] || room] || null : null; };
    /** The art A1 mapped to a piece for a role, as { src, avif, ink }; null when it has none (then the scene). */
    function artSrc(keys, role) {
      const idx = S.art;
      if (!idx) return null;
      const book = idx.pieces || idx.art || idx.items || idx;
      const roles = [...new Set([...arr(ART_ROLE[role] || role), role])];
      for (const key of arr(keys)) {
        const e = key && book[key];
        if (!e) continue;
        if (typeof e === 'string') return { src: e };
        for (const r of roles) {
          const pick = e[r];
          if (typeof pick === 'string') return { src: pick, role: r };
          if (pick && typeof pick === 'object' && (pick.src || pick.webp)) return { src: pick.src || pick.webp, avif: pick.avif || null, ink: pick.ink || null, zones: pick.zones || null, role: r };
        }
      }
      return null;
    }
    /** The picture for A1's art: AVIF first, the WebP as the src; dark type where A1 measured the art light. */
    const artPicture = (art, name, narrow) => `<span class="m1-scene m1-scene--art${art.ink === 'dark' ? ' m1-ink-dark' : ''}"><picture>${narrow ? `${narrow.avif ? `<source media="(max-width: 640px)" type="image/avif" srcset="${esc(narrow.avif)}">` : ''}<source media="(max-width: 640px)" srcset="${esc(narrow.src)}">` : ''}${art.avif ? `<source type="image/avif" srcset="${esc(art.avif)}">` : ''}<img src="${esc(art.src)}" alt="" decoding="async" data-p1-name="${esc(name)}"></picture></span>`;
    /** A piece's picture for a role: A1's art when it exists, else a dark scene in its room's colours with the product on it. */
    /**
     * A room banner's picture (M1e): A1b's 1440×520 `banner-tall` from a desk's width (861 px, where the banner's box takes
     * its proportion, oh.css M1e), the 1440×360 banner below it (the phone's 4:3 crop), each drawn at no more than its own
     * scale at 1440. Without a tall file, the 360 banner alone.
     */
    const bannerPicture = (art, tall, name) => (tall ? `<span class="m1-scene m1-scene--art${(art || tall).ink === 'dark' ? ' m1-ink-dark' : ''}"><picture>${tall.avif ? `<source media="(min-width: 861px)" type="image/avif" srcset="${esc(tall.avif)}">` : ''}<source media="(min-width: 861px)" srcset="${esc(tall.src)}">${art && art.avif ? `<source type="image/avif" srcset="${esc(art.avif)}">` : ''}<img src="${esc((art || tall).src)}" alt="" decoding="async" data-p1-name="${esc(name)}"></picture></span>`
      : artPicture(art, name));
    /** A room's tall banner art (A1b's banner-tall), by the same keys as its banner; null where the index has none. */
    const tallArtOf = (keys) => artSrc(keys, 'banner-tall');
    function sceneHtml(piece, cid, role, narrowRole) {
      const room = roomOfPiece(piece), prod = productOfPiece(piece, cid);
      const keys = [cid, piece.id, role === 'banner' ? roomArtKey(room) : null];
      const art = artSrc(keys, role);
      if (art && role === 'banner') return bannerPicture(art, tallArtOf(keys), bare(piece.title || cid));
      if (art) return artPicture(art, bare(piece.title || cid), narrowRole ? artSrc([cid, piece.id], narrowRole) : null);
      return `<span class="m1-scene m1-scene--${esc(room)}" data-art="placeholder">${prod ? artHtml(prod, 'p1-art--scene') : ''}</span>`;
    }
    /** The art's zones for a piece in a role (A1 records them per file), or null without art. */
    const zonesOf = (piece, cid, role) => { const art = artSrc([cid, piece.id, role === 'banner' ? roomArtKey(roomOfPiece(piece)) : null], role); return art && art.zones ? art.zones : null; };
    /** A badge in the corner the art names (its badge zone), anchored to the zone's nearer edges; none without a zone. */
    function badgePos(z) {
      const bz = z && Array.isArray(z.badge) && z.badge.length === 4 ? z.badge.map(Number) : null;
      if (!bz || bz.some((n) => !Number.isFinite(n))) return '';
      const pc = (n) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`;
      const x = bz[0] + bz[2] > 1 ? `right:${pc(1 - bz[2])};left:auto` : `left:${pc(bz[0])};right:auto`;
      const y = bz[1] + bz[3] > 1 ? `bottom:${pc(1 - bz[3])};top:auto` : `top:${pc(bz[1])};bottom:auto`;
      return ` style="${x};${y}" data-zone="badge"`;
    }
    // ── The hero's play control (lg.com's pause): the slides advance only after a press; a new answer stops them ──
    const HERO_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
    const HERO_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor"/></svg>';
    let heroTimer = null;
    /** Puts slide `to` on screen (the same move as the arrows and the bars). */
    function heroGo(to) {
      const track = $('m1HeroTrack');
      const slides = track ? [...track.querySelectorAll('.m1-slide:not(.m1-slide--clone)')] : [];
      if (!slides.length) return;
      S.slide = ((to % slides.length) + slides.length) % slides.length;
      track.style.setProperty('--i', String(slides.length > 1 ? S.slide + 1 : 0));
      for (const b of document.querySelectorAll('#slot-hero .m1-dot')) b.setAttribute('aria-current', String(num(b.dataset.m1Slide) === S.slide));
    }
    function heroPlay(on) {
      if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
      if (on) heroTimer = setInterval(() => heroGo(S.slide + 1), 6000);
      const btn = document.querySelector('#slot-hero [data-m1-play]'), car = document.querySelector('#slot-hero .m1-carousel');
      if (btn) { btn.setAttribute('aria-pressed', String(Boolean(heroTimer))); btn.setAttribute('aria-label', heroTimer ? 'Pause the slides' : 'Play the slides'); btn.innerHTML = heroTimer ? HERO_PAUSE : HERO_PLAY; }
      if (car) car.classList.toggle('m1-car--playing', Boolean(heroTimer));
    }

    // ── The pagers: the category row, Recommended for you (four a view at a desk, M1e), the TV grid's offer cards, and at ──
    //    phone width the service strip and the deals, one view at a time. Paging scrolls what is already on the page, in the order it came: no event, no visitor, nothing
    //    reordered. The hero's arrows and dots are the same kind of control (the lead's ruling): a slide change mints nobody
    //    and sends nothing; only a press on the slide's own content goes through the click dispatcher.
    const PAGED = ['m1Cats', 'm1Svc', 'slot-deals', 'rail-for-you', 'm1OffersTrack'];
    function pagerGeo(box) {
      const kids = [...box.children].filter((c) => c.getBoundingClientRect().width > 0);
      if (kids.length < 2) return { kids, step: Math.max(1, box.clientWidth), per: 1 };
      const r0 = kids[0].getBoundingClientRect(), r1 = kids[1].getBoundingClientRect();
      const step = Math.max(1, r1.left - r0.left);
      return { kids, step, per: Math.max(1, Math.round((box.clientWidth + (step - r0.width)) / step)) };
    }
    function pagerSync(id) {
      const box = $(id), pg = document.querySelector(`.m1-pager[data-pager-for="${id}"]`);
      if (!box || !pg) return;
      const { kids, step, per } = pagerGeo(box);
      const pages = Math.max(1, Math.ceil(kids.length / per)), max = box.scrollWidth - box.clientWidth;
      const at = max <= 1 ? 1 : box.scrollLeft >= max - 2 ? pages : Math.min(pages, Math.floor(box.scrollLeft / (step * per) + 0.5) + 1);
      const n = pg.querySelector('.m1-pg-n');
      if (n && n.textContent !== `${at}/${pages}`) n.textContent = `${at}/${pages}`;
      const [prev, next] = pg.querySelectorAll('[data-m1-page]');
      if (prev) prev.disabled = at <= 1;
      if (next) next.disabled = at >= pages;
      pg.classList.toggle('m1-pager--one', pages <= 1);
    }
    function pagersWire() {
      if (S.pagersWired) return;
      S.pagersWired = true;
      for (const id of PAGED) {
        const box = $(id);
        if (!box) continue;
        box.addEventListener('scroll', () => requestAnimationFrame(() => pagerSync(id)), { passive: true });
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => pagerSync(id)).observe(box);
      }
      document.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-m1-page], [data-m1-play], [data-m1-slide], [data-m1-step]') : null;
        if (!btn) return;
        e.preventDefault();
        if (btn.hasAttribute('data-m1-play')) { heroPlay(!heroTimer); return; }
        if (btn.hasAttribute('data-m1-slide')) { heroGo(num(btn.dataset.m1Slide)); return; }
        if (btn.hasAttribute('data-m1-step')) { heroGo(S.slide + (num(btn.dataset.m1Step) || 1)); return; }
        const pg = btn.closest('.m1-pager'), box = pg ? $(pg.dataset.pagerFor) : null;
        if (!box) return;
        const { step, per } = pagerGeo(box);
        box.scrollBy({ left: num(btn.dataset.m1Page) * step * per, behavior: 'smooth' });
      });
      // (At a phone's width the collapsed director's pill is the kit's to hide: director.js sets body.kit-present from ?present=1.)
    }

    /** A grid's own banner (static, the same for everyone): the room's art from A1, else a dark scene with its products. */
    function roomBanner(view) {
      const box = $(`m1BannerArt-${view}`);
      if (!box || box.dataset.m1 === (S.art ? 'art' : 'scene')) return;
      box.dataset.m1 = S.art ? 'art' : 'scene';
      const room = box.dataset.room || '';
      const art = room ? artSrc([roomArtKey(room)], 'banner') : null, tall = room ? tallArtOf([roomArtKey(room)]) : null;
      const ban = box.closest('.m1-banner');
      if (ban) ban.classList.toggle('m1-banner--tall', Boolean(art && tall));
      if (art) { box.innerHTML = bannerPicture(art, tall, GRIDS[view] ? GRIDS[view].title : view); return; }
      const prods = (box.dataset.skus || '').split(' ').filter(Boolean).map(productOf).filter(Boolean);
      box.innerHTML = `<span class="m1-scene m1-scene--${esc(room || 'living-room')}" data-art="placeholder">${prods.map((p, k) => `<span class="m1-banner-prod m1-banner-prod--${k}">${artHtml(p, 'p1-art--scene')}</span>`).join('')}</span>`;
    }

    /** A clone for the carousel's peeking neighbours: the same picture, no decision, no control, inert. */
    const cloneOf = (html) => html.replace(/ data-(?:cid|op-[a-z-]+|ctl|receipt|open|nav|act|menu|view|filter|q)="[^"]*"/g, '');

    // ── The hero, take 1: a carousel of wide art slides, the neighbours peeking on both sides ──
    function heroSlideHtml(d, i, decidedSlide, entered) {
      const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), g = disp.grammar || {};
      const kicker = d.strategy === 'tenant-pinned' ? 'Pinned by our merchandiser' : (KICKER[roomOfPiece(piece)] || 'New');
      const badge = d.strategy === 'tenant-pinned' ? 'Pinned' : g.ends || (/^new for/i.test(piece.title || '') ? 'New for 2026' : '');
      const attrs = decidedSlide ? decided(d) : '';
      // data-room tints the slide's copy panel at a phone's width (oh.css, M1d), where lg.com sets the copy above the art.
      return `<div class="m1-slide" data-slide="${i}"><article class="card p1-hero${entered ? ' p1-entered' : ''}${decidedSlide ? '' : ' m1-static-slide'}" data-room="${esc(roomOfPiece(piece))}"${attrs}>${entered ? '<span class="delta-chip delta-chip--in">new</span>' : ''}
        ${sceneHtml(piece, d.customerContentId, 'hero')}
        <div class="p1-hero-copy"><p class="p1-kicker">${esc(kicker)}</p><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-hero-sub">${esc(piece.subtitle)}</p>` : ''}
          <div class="p1-ctas"><button type="button" class="btn btn--brand" ${target(piece, d.customerContentId)} data-ctl="${decidedSlide ? 'hero-cta' : `hero-cta-${i + 1}`}">${esc(disp.cta || 'Shop now')}</button></div></div>
        ${badge ? `<span class="m1-hero-badge"${badgePos(zonesOf(piece, d.customerContentId, 'hero'))}>${esc(badge)}</span>` : ''}
        <p class="receipt p1-receipt"${decidedSlide ? ` data-receipt="${esc(d.decisionId || '')}"` : ''}>${decidedSlide ? receiptLine(d, 0) : 'one of the site’s own slides: static, the same for everyone'}</p></article></div>`;
    }
    function renderHero(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      heroPlay(false);                                   // a new answer stops the slides: the decided slide is the one on screen
      const d = decisions[0];
      const entered = !S.quiet && !S.restoring && !S.tpl && Boolean(d && S.home.heroWas && S.home.heroWas !== d.customerContentId);
      if (!S.quiet && !S.restoring && !S.tpl) { S.home.heroPrev = S.home.heroWas; S.home.heroWas = d ? d.customerContentId : null; }
      if (!d) { box.innerHTML = '<p class="slot-empty">The engine returned no hero for this request, and the page shows none rather than invent one.</p>'; return; }
      // The slot's answer first; then the template's other heroes, static, the same for everyone, in the catalog's order.
      const others = S.quiet ? [] : M1.template({ slot: 'hero', take: 6, own: true }).filter((x) => x.customerContentId !== d.customerContentId).slice(0, 4);
      S.slide = 0;
      const slides = [heroSlideHtml(d, 0, true, entered), ...others.map((x, i) => heroSlideHtml(x, i + 1, false, false))];
      const n = slides.length;
      // The neighbours that peek: the last slide before the first, the first after the last (inert copies).
      const track = n > 1 ? [`<div class="m1-slide m1-slide--clone" aria-hidden="true" inert>${cloneOf(slides[n - 1]).replace(/^<div class="m1-slide"[^>]*>|<\/div>$/g, '')}</div>`, ...slides,
        `<div class="m1-slide m1-slide--clone" aria-hidden="true" inert>${cloneOf(slides[0]).replace(/^<div class="m1-slide"[^>]*>|<\/div>$/g, '')}</div>`] : slides;
      box.innerHTML = `<div class="m1-carousel"><div class="m1-hero-bleed"><div class="m1-hero-track" id="m1HeroTrack" style="--i:${n > 1 ? 1 : 0}">${track.join('')}</div></div>
        ${n > 1 ? `<div class="m1-car-ctl"><div class="m1-dots">${Array.from({ length: n }, (_, i) => `<button type="button" class="m1-dot" data-m1-slide="${i}" data-ctl="hero-dot-${i + 1}" aria-label="Slide ${i + 1} of ${n}" aria-current="${i === 0}"></button>`).join('')}</div>
          <button type="button" class="m1-car-arrow m1-car-play" data-m1-play aria-pressed="false" aria-label="Play the slides">${HERO_PLAY}</button>
          <button type="button" class="m1-car-arrow" data-m1-step="-1" data-ctl="hero-prev" aria-label="Previous slide">&lsaquo;</button>
          <button type="button" class="m1-car-arrow" data-m1-step="1" data-ctl="hero-next" aria-label="Next slide">&rsaquo;</button></div>` : ''}</div>`;
      M1.heads();
    }

    // ── The room tiles, take 3: the order is the engine's ────────────────────
    const viewOf = (d) => { const p = pieceOf(d) || {}; return { id: d.customerContentId, title: p.title || d.customerContentId, art: artOf(productOfPiece(p, d.customerContentId)) }; };
    function renderTiles(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      const after = decisions.map(viewOf);
      const row = S.tpl ? null : rowFor(slot.slot);       // the template has no before: nobody has seen anything yet
      if (row && !S.restoring) deltas.rotate(slot.slot, after, decisions);   // her answer put back after Compare: no new before
      const moves = row && !S.quiet ? deltas.moves(slot.slot, slotState(slot.slot).previous, after, decisions) : {};
      box.innerHTML = decisions.map((d, i) => {
        const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId);
        return `<article class="card p1-tile"${decided(d)}>${deltas.chipHtml(moves[d.customerContentId])}
          <button type="button" class="p1-tile-hit" ${target(piece, d.customerContentId)} data-ctl="tile-${esc(d.customerContentId)}">${sceneHtml(piece, d.customerContentId, 'tile')}
          <span class="p1-tile-text"><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<span class="p1-sub">${esc(piece.subtitle)}</span>` : ''}<span class="p1-tile-cta">${esc(disp.cta || 'Shop')} &rsaquo;</span></span></button>
          <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${receiptLine(d, i)}</p></article>`;
      }).join('') || '<p class="slot-empty">The engine returned no tile for this request.</p>';
      if (row && !S.quiet) deltas.render(slot.slot);
      M1.heads();
    }

    // ── The deals four: the bento of art tiles, headlines over them ──────────
    function renderDeals(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      const after = decisions.map(viewOf);
      const row = S.tpl ? null : rowFor(slot.slot);       // the template has no before: nobody has seen anything yet
      if (row && !S.restoring) deltas.rotate(slot.slot, after, decisions);   // her answer put back after Compare: no new before
      const moves = row && !S.quiet ? deltas.moves(slot.slot, slotState(slot.slot).previous, after, decisions) : {};
      box.innerHTML = decisions.length ? `${decisions.map((d, i) => dealHtml(d, i, moves[d.customerContentId])).join('')}${dealSetHtml(decisions)}`
        : '<p class="slot-empty">The engine returned no deal for this request, and the page shows none rather than invent one.</p>';
      if (row && !S.quiet) deltas.render(slot.slot);
      M1.heads();
    }
    // At a desk the five are lg.com's bento (oh.css, M1e): the tall tile beside a 2 × 2 block of small tiles with round
    // arrows, every one decided (the slot's take is 5, the lead's ruling). Each tile keeps its receipt in its own container (the suites and refreshReceipts read it there); the layout
    // sets the receipts in rows under the whole set, each led by its tile's title (data-of), under one honesty line.
    // Every tile takes A1's tall art, which crops to the bento's near-square cells and to the phone's carousel alike.
    function dealHtml(d, i, mv) {
      const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), g = disp.grammar || {};
      return `<article class="card p1-deal p1-deal--${i}${d.strategy === 'tenant-pinned' ? ' p1-deal--pinned' : ''}"${decided(d)}>${deltas.chipHtml(mv)}
        <div class="p1-deal-tile">${sceneHtml(piece, d.customerContentId, 'tall')}${disp.badge ? `<span class="p1-badge"${badgePos(zonesOf(piece, d.customerContentId, 'tall'))}>${esc(disp.badge)}</span>` : ''}
          <div class="p1-deal-body"><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-sub">${esc(piece.subtitle)}</p>` : ''}
            ${g.value || g.consideration ? `<p class="p1-fine">${esc([g.value, g.consideration].filter(Boolean).join(' · '))}</p>` : ''}</div>
          <button type="button" class="m1-tile-go" ${target(piece, d.customerContentId)} data-ctl="deal-${i + 1}" aria-label="${esc(disp.cta || 'Shop the deal')}"><span>${esc(disp.cta || 'Shop the deal')}</span> &rsaquo;</button></div>
        <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}" data-of="${esc(bare(piece.title || d.customerContentId))}">${receiptLine(d, i)}</p></article>`;
    }
    /**
     * The one honesty line under the set (at a desk): what the five are, and the region's lean when a decision carries it,
     * in the /sort rails' own words ("leans with North Carolina’s sales · synthetic → warehouse"), read off the decisions'
     * own drivers. The receipts follow it, one per tile.
     */
    function dealSetHtml(decisions) {
      const tpl = decisions.every((d) => d.strategy === 'template');
      const reg = decisions.map((d) => arr(d.explain && d.explain.drivers).find((x) => x && x.dim === 'regional')).find(Boolean);
      const lean = reg ? leanLine({ status: 'sorted', regional: { region: reg.value, asserted: Boolean(state.ctx.region) } }) : '';
      const pinned = decisions.some((d) => d.strategy === 'tenant-pinned');
      const n = ['no', 'one', 'two', 'three', 'four', 'five', 'six'][decisions.length] || String(decisions.length);
      const head = tpl ? `The published template: the opening catalog’s ${n} in its own order, nobody has arrived and nothing is decided yet`
        : `<b>Decided for you</b>: the ${n} deals in the engine’s order${pinned ? ', one pinned by our merchandiser' : ''}`;
      return `<p class="m1-deal-set">${head}${lean ? ` · <span class="p1-lean">${esc(lean)}</span>` : ''} · each tile’s receipt:</p>`;
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
      const contArt = artSrc([d.customerContentId, piece.id], 'hero');
      box.innerHTML = `<article class="card p1-continue"${decided(d)}>${contArt ? artPicture(contArt, bare(piece.title || d.customerContentId)) : ''}
        <div class="p1-cont-head"><p class="p1-kicker">${S.returned ? 'A return visit, asserted for the clock jump' : 'A return visit'}</p><h3>${esc(piece.title || 'Pick up where you left off.')}</h3>
          <p class="p1-hero-sub">Your shortlist is what you opened on this device, nothing inferred, kept for the window we publish, with your consent.</p></div>
        <div class="p1-shortlist">${list.map((s, i) => { const p = productOf(s.id); return p ? `<button type="button" class="p1-short" data-open="${esc(s.id)}" data-ctl="short-${i + 1}">${artHtml(p, 'p1-art--short')}<span><b>${esc(productName(p))}</b><em>${money(priceNum(p))}</em></span></button>` : ''; }).join('')
          || '<p class="slot-empty">Nothing opened on this device yet: the shortlist is what you open.</p>'}</div>
        ${clock}
        <div class="p1-ctas"><button type="button" class="btn btn--brand" data-act="p1-changes" data-ctl="continue-changes">What changed while you were away</button></div>
        <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${continueReceipt(d)}</p></article>`;
      M1.heads();
    }
    function continueReceipt(d) {
      const rec = recOf(d), ex = (rec && rec.explain) || {};
      const visit = S.returned ? 'ctx.visit = return, asserted for the clock jump (labelled)' : 'the return visit';
      const rests = S.clock && (S.clock.gone || !arr(S.clock.rooms).length)
        ? `it rests on the visitor’s shortlist (what they opened on this device) and the decisions trail${S.clock.fast ? ': on the demo’s dial their room signals are gone within minutes; production’s dial is days' : ''}` : null;
      return [`${visit} · ${d.strategy === 'default' ? 'the only eligible piece: nothing in the profile scores it' : `score <b>${fmt3(d.score)}</b>`}`,
        rests, ex.stage && ex.stage.sentence ? esc(ex.stage.sentence) : null].filter(Boolean).join(' · ');
    }

    // ── The grid's promotion, take 1: a wide banner over the room's art, the copy the piece's own ──
    function renderGridPromo(slot, decisions) {
      const box = $(`slot-${slot.slot}`);
      if (!box) return;
      box.innerHTML = decisions.map((d, i) => {
        const piece = pieceOf(d) || {}, disp = dispOf(d.customerContentId), g = disp.grammar || {};
        const badge = g.ends || disp.badge || '';
        const bk = [d.customerContentId, piece.id, roomArtKey(roomOfPiece(piece))], tall = Boolean(artSrc(bk, 'banner') && tallArtOf(bk));
        return `<article class="card p1-promo m1-banner${tall ? ' m1-banner--tall' : ''}" data-room="${esc(roomOfPiece(piece))}"${decided(d)}>${sceneHtml(piece, d.customerContentId, 'banner')}
          <div class="m1-banner-copy"><p class="p1-kicker">${esc(KICKER[roomOfPiece(piece)] || 'Offer')}</p><h3>${esc(piece.title || d.customerContentId)}</h3>${piece.subtitle ? `<p class="p1-sub">${esc(piece.subtitle)}</p>` : ''}
            ${disp.cta ? `<button type="button" class="btn btn--brand p1-promo-cta" data-act="m1-promo" data-cid="${esc(d.customerContentId)}" data-ctl="promo-cta">${esc(disp.cta)}</button>` : ''}</div>
          ${badge ? `<span class="m1-hero-badge"${badgePos(zonesOf(piece, d.customerContentId, 'banner'))}>${esc(badge)}</span>` : ''}
          <p class="receipt p1-receipt" data-receipt="${esc(d.decisionId || '')}">${receiptLine(d, i)}</p></article>`;
      }).join('') || '<p class="slot-empty">The engine returned nothing for the grid’s promotion on this request.</p>';
      renderOffers(decisions.map((d) => d.customerContentId));
      M1.heads();
    }
    /**
     * lg.com's row of offer cards under the TVs banner: the catalog's own TV promotions in force (published deals for TVs
     * and their bundles, live, inside their window, in stock), in the catalog's order, static and the same for everyone;
     * the piece the banner shows is left out. The copy is each piece's own (its title, its "Valid through" where the feed
     * gives one, its button), never written here; a piece with no window in the feed carries no date.
     */
    function renderOffers(shownAbove) {
      const wrap = $('m1Offers-tvs'), box = $('m1OffersTrack');
      if (!wrap || !box) return;
      const now = Date.now();
      const list = piecesNow().filter((p) => p && p.type === 'promotion' && arr(p.tags && p.tags.contentType).includes('deal') && arr(p.tags && p.tags.category).includes('tvs')
        && (arr(p.slotTypes).includes('deals') || arr(p.slotTypes).includes('grid-promo')) && liveAt(p, now) && p.inStock !== false && !p.eligibleWhen
        && !arr(shownAbove).includes(p.customerContentId));
      const pc = (n) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`;
      box.innerHTML = list.map((p) => {
        const cid = p.customerContentId, disp = dispOf(cid), g = disp.grammar || {};
        const art = artSrc([cid, p.id], 'tile'), z = art && art.zones && Array.isArray(art.zones.product) ? art.zones.product.map(Number) : null;
        const at = z && z.every(Number.isFinite) ? ` style="object-position:${pc((z[0] + z[2]) / 2)} ${pc((z[1] + z[3]) / 2)}"` : '';   // the product A1 placed, kept in the crop
        const prod = productOfPiece(p, cid);
        const pic = art ? `<span class="m1-scene m1-scene--art"><picture>${art.avif ? `<source type="image/avif" srcset="${esc(art.avif)}">` : ''}<img src="${esc(art.src)}" alt="" loading="lazy" decoding="async" data-p1-name="${esc(bare(p.title || cid))}"${at}></picture></span>`
          : `<span class="m1-scene m1-scene--${esc(roomOfPiece(p))}" data-art="placeholder">${prod ? artHtml(prod, 'p1-art--scene') : ''}</span>`;
        return `<article class="m1-offer"><span class="m1-offer-pic">${pic}</span><div class="m1-offer-body">${g.ends ? `<p class="m1-offer-ends">${esc(g.ends)}</p>` : ''}<h3>${esc(bare(p.title || cid))}</h3>
          <button type="button" class="btn btn--brand" data-act="m1-promo" data-offer="${esc(cid)}" data-ctl="offer-${esc(cid)}">${esc(disp.cta || 'Shop now')}</button></div></article>`;
      }).join('');
      wrap.hidden = !list.length;
      box.scrollLeft = 0;
      eager(box);
    }
    /** A carousel's pictures past its first view load with it (a lazy image beside the view, not below it, would wait for a page press). */
    function eager(box) { for (const img of box.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager'; }

    // ── The /sort rails: "for you" across rooms, and the TV grid ────────────
    /**
     * "For you" is the engine's twice over, and the page orders nothing: POST /sort over each room's products (priced,
     * pictured, in stock, in the products file's own order) gives that room's first PER_ROOM, as a platform asks for each
     * category of a cross-category widget; then POST /sort over those twelve gives the rail, rendered in that answer's
     * own order. So the rail follows her rooms instead of swapping wholesale to one of them, and every position on it is
     * an answer's.
     */
    const roomProducts = (room, cats) => state.products.filter((p) => roomOf(p) === room && cats.includes(field(p, 'attributes.category')) && priceNum(p) !== null && artOf(p) && p.inStock !== false);
    /**
     * With no answer (no visitor yet): the products file's own template.recommended, the site's best sellers in the order
     * the file declares them (four per room); without one, each room's first PER_ROOM in the file's order, the rooms in turn.
     */
    function forYouPool() {
      const declared = arr(S.template && S.template.recommended).map(productOf).filter((p) => p && priceNum(p) !== null);
      if (declared.length) return declared;
      const lists = POOL.map(([room, cats]) => roomProducts(room, cats).slice(0, PER_ROOM));
      const out = [];
      for (let i = 0; i < PER_ROOM; i += 1) for (const l of lists) if (l[i]) out.push(l[i]);
      return out;
    }
    const widthOf = (p) => { const w = num(p && (p.width != null ? p.width : p.fits && p.fits.width)); return Number.isFinite(w) && w > 0 ? w : null; };
    /**
     * A grid's candidates: its products with a price of ours, in the products file's own order, kept by her filters
     * (OR within a group, AND across groups; the filters are hers, never decided), then by her declared space: a
     * product wider than it leaves before the engine sees it, and one with no listed width is kept, unmeasured.
     */
    function gridPool(rail) {
      const view = viewOfRail(rail) || GRID, G = gs(view);
      const all = M1.filtered(view);
      const fit = G.fit;
      G.hidden = fit ? all.filter((p) => widthOf(p) !== null && widthOf(p) > fit) : [];
      G.unknown = fit ? all.filter((p) => widthOf(p) === null).length : 0;
      return all.filter((p) => !G.hidden.includes(p));
    }
    const poolOf = (rail) => (viewOfRail(rail) ? gridPool(rail) : forYouPool());
    /** What a rail shows: the engine's order (or, with no answer, the products file's), the module's rule, its take. */
    /** A slot's or a rail's take: the published config's (read with the documents), else the page's own. */
    const takeOf = (x) => num(S.takes[x && x.slot]) || num(x && x.take) || 0;
    const shownOrder = (rail, R) => (R.order || (R.pool || poolOf(rail)).map(idOf)).slice(0, takeOf(rail));
    const candidateOf = (p) => { const { productId, ...attrs } = productAttrs(p); return { id: productId, ...attrs }; };
    /** The rail's weights as demo.config.json publishes them; a dimension it does not name weighs 0, as on the slots. */
    function weightsOf(rail) {
      const w = S.weights[rail.slot];
      if (!w) return { affinity: 1 };
      const zero = Object.fromEntries(arr((state.registry || {}).dimensions).map((d) => [d.key, 0]));
      return { affinity: 1, dims: { ...zero, ...w } };
    }
    const railState = (rail) => (viewOfRail(rail) ? gs(viewOfRail(rail)).rail : S.home.rail);
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
      let pool = viewOfRail(rail) ? gridPool(rail) : null, rooms = null;
      if (pool && !pool.length) return { status: 'sorted', order: [], items: [], regional: null, prevOrder, pool };   // her filters left nothing to ask about
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
      if (viewOfRail(rail)) gs(viewOfRail(rail)).rail = next; else S.home.rail = next;
      await paintRail(rail);
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
    /**
     * A /sort rail (for you) or a grid, painted from what the page holds. A grid shows POST /sort's order over what her
     * filters and her space leave (Best match), or the order she chose on the sort control (price, rating), never one
     * of the page's own; it shows as many as she asked to see, and says how many there are.
     */
    async function paintRail(rail) {
      await data();
      ensureChrome();
      const view = viewOfRail(rail);
      const box = $(`rail-${rail.slot}`), chip = $(`chip-${rail.slot}`), leanNode = $(`lean-${rail.slot}`);
      if (!box) return;
      const R = railState(rail), G = view ? gs(view) : null;
      const pool = view ? gridPool(rail) : (R.pool || poolOf(rail));
      const byId = new Map((R.items || []).map((x) => [String(x.id), x]));
      const best = view ? M1.bestOrder(R, pool, view) : null;
      const chosen = Boolean(view && G.sort !== 'best');
      const declared = !R.order && M1.declaredFor(view || 'for-you', pool);
      const order = view ? (chosen ? M1.chosenOrder(pool, G.sort) : best).slice(0, G.show) : (R.order ? shownOrder(rail, R) : pool.map(idOf));
      const prev = R.prevOrder && !chosen ? (view ? M1.bestOrder({ order: R.prevOrder }, pool).slice(0, G.show) : shownOrder(rail, { order: R.prevOrder, pool })) : null;
      if (chip) {
        chip.textContent = R.status === 'sorted' ? `decided · POST /sort ${view ? `over ${pool.length} ${view === GRID ? 'TVs' : 'products'}` : `per room for its ${PER_ROOM}, then across the rooms`}${chosen ? ' · shown in the order you chose' : ''}`
          : R.status === 'no-capture' ? 'the site’s own order · /sort answers once the visitor has a captured event'
            : R.status === 'down' ? `the site’s own order · /sort did not answer (${R.error})` : declared ? 'best sellers · the site’s own order' : 'the site’s own order · no visitor yet';
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
        const it = byId.get(String(id));
        const was = prev ? prev.indexOf(id) : -1;
        const moved = prev && !S.quiet ? (was === -1 ? 'new' : was > i ? `↑${was - i}` : was < i ? `↓${i - was}` : '') : '';
        const top = it && arr(it.drivers).filter((x) => x.dim !== 'regional').sort((a, b) => num(b.contribution) - num(a.contribution))[0];
        const reg = it && arr(it.drivers).find((x) => x.dim === 'regional');
        const from = it ? `site ${it.feedRank + 1}` : '—';   // its place in the products file's own order of what was asked
        const rank = chosen ? `${esc(M1.sortLabel(G.sort))}, your choice${R.status === 'sorted' ? ` · Best match <b>${best.indexOf(id) + 1}</b>` : ''}`
          : R.status === 'sorted' ? `rank <b>${i + 1}</b> · ${from}${it && num(it.score) > 0 ? ` · ${fmt3(it.score)}` : ''}${top ? ` · ${esc(SITE.dimLabels[top.dim] || top.dim)} ${esc(top.value)}` : ''}${reg ? ` · region ${esc(reg.value)}` : ''}`
            : declared ? `best seller <b>${i + 1}</b> · the site’s own order` : `site position <b>${i + 1}</b>`;
        const mark = moved ? `<span class="delta-chip delta-chip--${moved === 'new' ? 'in' : moved[0] === '↑' ? 'up' : 'down'}">${esc(moved)}</span>` : '';
        return M1.card(p, { chip: mark, rank });
      }).join('') || `<p class="slot-empty m1-empty">${view && G.fit && !pool.length ? `Nothing here fits that space.` : view ? 'Nothing matches those filters.' : 'No product to show.'}${view && Object.keys(G.f).length ? `<br><button type="button" class="btn btn--line btn--sm" data-act="m1-filter-clear" data-view="${view}" data-ctl="filter-clear-${view}">Clear the filters</button>` : ''}</p>`;
      if (view) M1.gridChrome(view, pool, best || [], order.length);
      else { railDeltas(prev, order); eager(box); }   // a carousel at every width now (M1e): its later pages' pictures load with the first
      M1.heads();
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
    /** Her declared space on a grid: what it hid, said with the count the data gives; declared, never inferred. */
    function fitNote(view = GRID) {
      const node = view === GRID ? $('p1FitNote') : $(`m1FitNote-${view}`);
      if (!node) return;
      const G = gs(view), fit = G.fit;
      const what = view === GRID ? 'A TV' : 'A machine';
      node.innerHTML = fit
        ? `<b class="p1-fit-hidden">Hidden: ${G.hidden.length} wider than your space</b> (${fit} in, declared by you, never inferred)${G.unknown ? ` · ${G.unknown} without a listed width are kept, unmeasured` : ''} · the engine ranks what fits`
        : `Your measurement is yours: declared, never inferred. ${what} wider than your space leaves the grid, and the page says how many.`;
      const input = view === GRID ? $('p1FitWidth') : $(`m1FitWidth-${view}`);
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
        opening: { sign: '·', cls: 'in', what: slot === 'deals' ? 'The opening deals' : 'The opening tiles', why: transport.cur() && transport.cur().fresh ? 'a fresh visitor: nothing sent' : 'the first decision this visitor was served' },
        emptyBefore: 'Not seen yet.',
        left: (b, i) => `left ${unit} ${i + 1} · ${wentWhy(b.id)}`,
        lead: () => (slot === 'deals' && S.lead && !S.quiet ? S.lead : '') + (slot === 'deals' && !S.quiet ? (deltas.superseded('deals') || '') : ''),
        held: { title: (d) => (pieceOf(d) || {}).title || d.customerContentId, index: (d) => transport.bySlot(S.home.set, slot).indexOf(d) },
        nothing: { text: slot === 'deals' ? 'Nothing moved in the deals.' : 'The tiles held their order.' },
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
        line: c.length ? [`${c.length} on your shortlist`, ended ? `${ended} offer${ended === 1 ? '' : 's'} on it ended` : 'no offer on it ended',
          running ? `${running} still running` : null, moved.length ? `${moved.length} price${moved.length === 1 ? '' : 's'} moved` : 'every price held, the catalog’s',
          newer.length ? `a newer model listed for ${newer.length}` : null].filter(Boolean).join(' · ') : null };
    }
    function openChanges() {
      const c = changes();
      const when = S.clock ? `${S.clock.days} days later, by the labelled clock jump` : 'since you looked';
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
        ${body || '<p class="slot-empty">Nothing on your shortlist yet: it is what you open.</p>'}`);
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
        const view = t.dataset.view && isGrid(t.dataset.view) ? t.dataset.view : GRID, G = gs(view);
        const raw = t.dataset.fit !== undefined ? t.dataset.fit : ($(view === GRID ? 'p1FitWidth' : `m1FitWidth-${view}`) || {}).value;
        const w = num(raw);
        G.fit = Number.isFinite(w) && w >= (view === GRID ? 20 : 18) && w <= 140 ? Math.round(w * 2) / 2 : null;
        panels.note('declared', G.fit ? `the space: ${G.fit} in wide` : 'the space: cleared', 'a measurement the shopper gave: declared, never inferred');
        const rail = view === GRID ? railsOf(GRID)[0] : gridRail(view);
        if (rail) await sortAndPaint(view, rail, transport.cur());
        return true;
      }
      if (t.dataset.act === 'p1-changes') { openChanges(); panels.note('opened', 'What changed in the meantime', 'the shopper’s shortlist, read off the documents in force'); return true; }
      if (t.dataset.act && t.dataset.act.startsWith('m1-')) return M1.control(t);
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
      const title = ext ? (ext.title || 'The shopper’s page, and a fresh visitor’s') : key === GRID ? 'The shopper’s TV grid, and a fresh visitor’s' : 'The shopper’s homepage, and a fresh visitor’s';
      if (!transport.cur() || !key) {
        m.showMessage({ title, heading: 'No shopper on the homepage or the grid yet:', text: 'Fresh visitor sets a stranger’s homepage or TV grid beside the shopper’s. Bring the shopper in with Next, then press it again.' });
        throw new Error('open the homepage or the TV grid with the shopper first: Compare puts a fresh visitor beside them there');
      }
      const wasBusy = state.busy;
      state.busy = true;
      demo.compare.supersede();
      say('a fresh visitor is asking…');
      const keys = ['The shopper’s page', 'A fresh visitor, same region'];
      m.showWaiting({ title, heading: 'The shopper’s page, then a fresh visitor’s', text: 'The same region, nothing sent.' });
      let restore = null;
      try {
        await demo.compare.takeBaseline('tool');
        const f = await transport.mintVisitor('F', transport.directEntry(), 'Fresh visitor');
        f.fresh = true;
        panels.note('compared', 'A fresh visitor beside the shopper', 'direct · consent granted · no event sent · the same region · the shopper’s page is not asked again');
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
          foot: 'Same page, same moment, same region, same catalog and the same public prices. The fresh visitor arrived direct and has sent nothing: the region’s prior alone. The shopper’s, on the left, is what their visit earned.',
          details: (bf, nf) => demo.compare.columns(bf.meta && bf.meta.snap, nf.meta && nf.meta.snap, keys),
          sameNote: 'The shopper’s page and the fresh visitor’s are the same: nothing they have done weighs on it yet.',
          nearNote: 'The shopper’s page and the fresh visitor’s differ only in small print: What changed has the answers behind both.' });
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
      const rowText = (r) => `<b>${esc(r.title)}</b> <em>${r.still ? 'still answered: the window did not hold' : r.was === 'shown' ? `left ${r.slots.join(' and ')} on this decision` : r.was === 'page' ? 'left the TV page’s offers, above' : r.was === 'candidate' ? 'left the candidates on this decision' : 'was not in front of the shopper; it can no longer be chosen'}</em>`;
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
      const deals = transport.bySlot(set, 'deals');
      const pinned = deals.find((d) => d.strategy === 'tenant-pinned') || null;
      const ranked = deals.filter((d) => d.strategy !== 'tenant-pinned');
      // The ranked deals' own receipts; read again when none has landed yet (the receipt route gives up at a 503 under load).
      let rec = null;
      for (let attempt = 0; attempt < 3 && !rec; attempt += 1) {
        if (attempt) await util.sleep(2000);
        await receiptsFor(set);
        rec = ranked.map(recOf).find((x) => x && arr(x.candidates).length) || null;
      }
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
     * are carried three weeks on by the registry's memory (a = R / (R + K), R decaying by e^(−t/τ) per dimension), and
     * the return visit is asserted on every homepage question from here on. The engine's own clock stays real. The demo's
     * dial is compressed (τ in seconds on the page-driving dimensions; production runs days): read off the registry, so
     * when her room signals are gone below the entry threshold θin the note says so, and the continue hero rests on her
     * shortlist and the decisions trail.
     */
    async function clockJump(args) {
      const days = num(args && args.days) || (SITE.clockJump && SITE.clockJump.days) || 21;
      await panels.renderVectors();
      const before = JSON.parse(JSON.stringify(state.lastVector || {}));
      const reg = state.registry || {};
      const kOf = (dim) => { const d = arr(reg.dimensions).find((x) => x.key === dim); return num(d && d.K) || num(reg.K) || 1.8; }, K = kOf('room'), base = num(reg.tauMs) || 1209600000, t = days * 86400000;   // K per dimension: its own, else the registry's
      const tauOf = (dim) => { const d = arr(reg.dimensions).find((x) => x.key === dim); return num(d && d.tauMs) || base; };
      const carry = (a, dim) => { if (!(a > 0) || a >= 1) return a; const k = kOf(dim), r = (a * k) / (1 - a) * Math.exp(-t / tauOf(dim)); return r / (r + k); };
      const thetaIn = num(reg.thetaIn) || 0.6;                                // the entry threshold, the registry's own
      const fast = tauOf('room') < 3600000;                                   // the demo's compressed dial: seconds or minutes, not days
      const read = (dim, value) => { const a = num(((before[dim] || {})[value]) || 0); return { dim, value, b: a, a: carry(a, dim), tau: tauOf(dim) }; };
      const rooms = ['living-room', 'laundry-room', 'kitchen'].map((x) => read('room', x)).filter((r) => r.b > 0);
      const fall = (r) => (r.b > 0 ? (r.b - r.a) / r.b : 0);
      const tv = rooms.find((r) => r.value === 'living-room'), laundry = rooms.find((r) => r.value === 'laundry-room');
      const pctFall = (r) => Math.round(fall(r) * 100);
      const laundryFaster = Boolean(tv && laundry && pctFall(laundry) > pctFall(tv));   // a room "faded faster" only when the readings differ
      const below = rooms.filter((r) => r.a < thetaIn), gone = rooms.length > 0 && below.length === rooms.length;
      const cats = ['tvs', 'washers'].map((x) => read('category', x)).filter((r) => r.b > 0);
      const dayLabel = (ms) => (ms < 120000 ? `${Math.round(ms / 1000)} seconds` : ms < 7200000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 86400000)} days`);
      const row = (r) => `${esc(ROOM[r.value] || r.value)} ${fmt3(r.b)} → <b>${fmt3(r.a)}</b> (−${Math.round(fall(r) * 100)}%)`;   // three places, so the arithmetic can be checked by hand
      const most = rooms.reduce((m, r) => (!m || fall(r) > fall(m) ? r : m), null);   // the dial that fell furthest, named in the sentence
      const differ = new Set(rooms.map(pctFall)).size > 1;
      const faded = most && differ ? `the ${ROOM[most.value] || most.value} faded furthest (−${Math.round(fall(most) * 100)}%), ${rooms.filter((r) => r !== most).map((r) => `the ${ROOM[r.value] || r.value} −${Math.round(fall(r) * 100)}%`).join(', ') || 'the only room the shopper had'}` : null;
      S.clock = { days, rooms, laundryFaster, faded, gone, fast, head: `${days} days later · a labelled clock jump`,
        html: `${rooms.length ? `${fast ? `On the demo’s dial (τ ${dayLabel(tauOf('room'))} on room, K ${K}; production’s dial runs days) the shopper’s room signals are gone within minutes` : `The shopper’s room dials, carried ${days} days on by the published memory (τ ${dayLabel(tauOf('room'))} on room, K ${K})`}: ${rooms.map(row).join(' · ')}; `
          + `${gone ? `every room below the entry threshold (θin ${fmt2(thetaIn)})` : `${rooms.length - below.length} of ${rooms.length} still at or above the entry threshold (θin ${fmt2(thetaIn)})`}.` : 'The shopper had no room dial to carry: nothing about them to fade.'}`
          + `${tv && laundry && differ ? ` ${laundryFaster ? '<b>Laundry faded faster than TV</b>: less evidence fades further on the same memory.' : '<b>The living room faded faster than laundry</b> on these dials.'}` : ''}`
          + `${gone || !rooms.length ? ' So the continue hero rests on <b>the shopper’s shortlist and the decisions trail</b>, not on their room dials.' : ''}`
          + `${cats.length ? ` Category, a ${dayLabel(tauOf('category'))} memory: ${cats.map((r) => `${esc(r.value)} ${fmt2(r.b)} → ${fmt2(r.a)}`).join(' · ')}.` : ''}`
          + ' The catalog’s windows moved back in one publish; the engine decides on its own clock, which is real, so the meters beside the page show the shopper’s dials as it holds them.' };
      S.returned = true;
      panels.note('asserted', 'ctx.visit = return', `the clock jump: ${days} days later, labelled · a return visit in the same browser, asserted on the homepage`);
      await ask(homeKey());
      S.lead = `<li class="delta-engine"><span class="hk">${esc(S.clock.head)}</span>${S.clock.html}</li>`;
      if (rowFor('deals')) deltas.render('deals');
      panels.note('engine', S.clock.fast ? 'Three weeks on, on the demo’s dial (production’s runs days)' : 'Three weeks on, by the published memory', stripTags(S.clock.html).slice(0, 170));
      director.sayAfter();
    }

    // ── What Why these and Compare read on these two pages ──────────────────
    function railRows(R, rail) {
      const take = takeOf(rail);
      return (R.order ? shownOrder(rail, R) : []).slice(0, take).map((id, i) => {
        const it = arr(R.items).find((x) => x.id === id);
        const regs = arr(it && it.drivers).filter((x) => x.dim === 'regional');
        const reg = regs.length ? { dim: 'regional', value: regs[0].value, a: num(regs[0].a), weight: Math.round(regs.reduce((s, x) => s + num(x.w), 0) * 1e4) / 1e4 } : null;
        const drivers = [...arr(it && it.drivers).filter((x) => x.dim !== 'regional').map((x) => ({ dim: x.dim, value: x.value, a: x.a, weight: x.w })), ...(reg ? [reg] : [])];
        return { customerContentId: id, slot: rail.slot, order: i, score: num(it && it.score), strategy: 'sort', explain: { drivers, note: it ? `site position ${it.feedRank + 1}` : undefined } };
      });
    }
    function why(pageKey) {
      const m1Grid = Boolean(pageKey) && isGrid(pageKey) && pageKey !== GRID;   // one of the store's own grids (M1): its POST /sort, no slot
      if (!pageKey || (!m1Grid && (!own(pageKey) || ![HOME, GRID].includes(own(pageKey).key)))) return null;
      const set = m1Grid ? null : state.sets[pageKey] || null;
      const groups = set ? slotsOf(pageKey).map((s) => [s.label, transport.bySlot(set, s.slot)]).filter(([, d]) => d.length) : [];
      for (const rail of (m1Grid ? [gridRail(pageKey)] : railsOf(pageKey))) {
        const R = railState(rail);
        if (R.status === 'sorted') groups.push([`${rail.label} · POST /sort${leanLine(R) ? ` · ${leanLine(R)} · λ ${fmt2(num(R.regional.lambda))}` : ''}`, railRows(R, rail)]);
      }
      return { set, lead: !m1Grid && own(pageKey).key === HOME && !S.quiet ? (deltas.superseded('deals') || null) : null, groups };
    }
    function snap(pageKey) {
      const m1Grid = Boolean(pageKey) && isGrid(pageKey) && pageKey !== GRID;   // one of the store's own grids (M1)
      if (!pageKey || (!m1Grid && (!own(pageKey) || ![HOME, GRID].includes(own(pageKey).key)))) return null;
      const set = m1Grid ? null : state.sets[pageKey] || null;
      const v = transport.cur();
      const vector = [];
      for (const [dim, values] of Object.entries(state.lastVector || {})) for (const [value, a] of Object.entries(values || {})) vector.push({ dim, value, a: Number(a) || 0 });
      vector.sort((x, y) => y.a - x.a);
      const lists = set ? slotsOf(pageKey).map((s) => [s.label, transport.bySlot(set, s.slot).map((d) => ({ id: d.customerContentId, t: titleOf(d), s: d.score }))]) : [];
      for (const rail of (m1Grid ? [gridRail(pageKey)] : railsOf(pageKey))) { const R = railState(rail); lists.push([rail.label, (R.order ? shownOrder(rail, R) : []).map((id) => ({ id, t: productName(productOf(id)) || id, s: null }))]); }
      return { who: demo.compare.whoNow(), at: Date.now(), where: m1Grid ? `the ${GRIDS[pageKey].title} page` : whereNow(), vector: vector.slice(0, 4), intent: v && v.intent, region: panels.regionShown(), lists };
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
      // What moved on the homepage's last answer and what held, module by module, read off the before/now rows (beat 2's line).
      const moved = [], held = [], fours = slotState('deals');
      const keyOf = (list) => (list ? list.map((x) => x.id).join('|') : null);
      const railPrev = S.home.rail.prevOrder && railsOf(HOME)[0] ? shownOrder(railsOf(HOME)[0], { order: S.home.rail.prevOrder, pool: S.home.rail.pool }).join('|') : null;
      for (const [name, was, now] of [['the hero', S.home.heroPrev || null, S.home.heroWas || null], ['the room tiles', keyOf(tiles.previous), keyOf(tiles.current)],
        ['the deals', keyOf(fours.previous), keyOf(fours.current)], ['the rail across rooms', railPrev, order.length ? order.join('|') : null]]) {
        if (was === null || now === null) continue;
        (was === now ? held : moved).push(name);
      }
      const listed = (xs) => (xs.length ? (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]) : null);
      const ch = changesFacts();
      const next = gridOrder.find((id) => !opened.has(id)) || gridOrder[0] || null;
      const attrsOf = (id) => (id && productOf(id) ? productAttrs(productOf(id)) : null);
      return {
        grid: { next, nextAttrs: attrsOf(next), count: gridOrder.length || null, lean: leanLine(S.grid.rail) || null },
        washer, washerName: washer ? productName(productOf(washer)) : null, washerAttrs: attrsOf(washer),
        arrival: { name: a ? a.name : null, how: a ? a.how : null, leans: a ? a.leans : null, sentence: a ? `${a.name}, ${a.how}${a.leans ? `; your sales here lean ${a.leans}` : ''}; census shown, not scored` : null },
        home: { rail: rooms ? Object.entries(rooms).map(([room, n]) => `${ROOM[room] || room} ${n}`).join(' · ') : null,
          twoRooms: Boolean(rooms && rooms['living-room'] > 0 && rooms['laundry-room'] > 0), tilesMoved, lean: leanLine(S.home.rail) || null, moved: listed(moved), held: listed(held) },
        contrast: S.contrast ? S.contrast.key : null, contrastName: S.contrast ? (US[S.contrast.key] || S.contrast.key) : null,
        tvPage: lastTv(), tvName: lastTv() ? productName(productOf(lastTv())) : null,
        windows: { page: S.windows ? S.windows.page : null, pageName: S.windows ? S.windows.pageName : null, closed: S.windows ? S.windows.rows.length : null, left: S.windows ? S.windows.left : null, still: S.windows ? S.windows.still : null,
          held: S.held ? S.held.packages.length : null, heldShown: S.held ? S.held.appeared : null },
        pin: { title: S.pin ? S.pin.title : null, would: S.pin ? S.pin.would : null, nowAt: S.pin ? S.pin.nowAt : null },
        clock: { laundryFaster: S.clock ? S.clock.laundryFaster : null, faded: S.clock ? S.clock.faded : null, gone: S.clock ? S.clock.gone : null, fast: S.clock ? S.clock.fast : null, returned: S.returned || null },
        shortlist: { count: ch.count || null, line: ch.line, ended: ch.ended || null },
      };
    }

    // ════════════════════════════════════════════════════════════════════════
    // M1: THE STORE. LG's look and a site that works by hand (design §9.1–§9.3), on M3's store (oh-store.js).
    // Nothing here ranks: the template is the catalog's own order, a grid is POST /sort's order or the order she chose,
    // and every list of the site's own (the icons, the showcase, the menus) is the same for everyone.
    // ════════════════════════════════════════════════════════════════════════
    const M1 = (() => {
      const DAY = 86400000;
      const money0 = util.money0 || ((n) => money(n));
      const WORD = { 'living-room': 'TVs & audio', 'laundry-room': 'Laundry', kitchen: 'Kitchen', tvs: 'TVs', soundbars: 'Soundbars', 'tv-mounts': 'Wall mounts', washers: 'Washers', dryers: 'Dryers',
        washtowers: 'WashTower', 'washer-dryer-combos': 'All-in-one', 'laundry-sets': 'Laundry sets', pedestals: 'Pedestals', 'laundry-accessories': 'Stacking kits', ranges: 'Ranges',
        microwaves: 'Microwaves', dishwashers: 'Dishwashers', 'kitchen-packages': 'Kitchen packages', refrigerators: 'Refrigerators', styler: 'Styler',
        oled: 'OLED', qned: 'QNED', 'micro-rgb': 'Micro RGB', uhd: '4K UHD', hd: 'HD', lifestyle: 'Lifestyle', 'front-load': 'Front load', 'top-load': 'Top load', 'pedestal-washer': 'Pedestal washer',
        'rear-control': 'Rear control', washtower: 'WashTower', 'all-in-one': 'All-in-one', '4-piece': '4-piece', '3-piece': '3-piece', 'pedestal-drawer': 'Pedestal drawer', 'pedestal-riser': 'Pedestal riser',
        'stacking-kit': 'Stacking kit', freestanding: 'Freestanding', 'slide-in': 'Slide-in', 'over-the-range': 'Over-the-range', 'front-control': 'Front control', 'top-control': 'Top control',
        'up-to-41': 'Up to 41″', '42-54': '42″ – 54″', '55-64': '55″ – 64″', '65-74': '65″ – 74″', '75-82': '75″ – 82″', '83-and-up': '83″ and up',
        compact: 'Compact', standard: 'Standard', large: 'Large', 'extra-large': 'Extra large', electric: 'Electric', gas: 'Gas', induction: 'Induction', 'dual-fuel': 'Dual fuel',
        white: 'White', 'black-steel': 'Black steel', 'graphite-steel': 'Graphite steel', 'alpine-white': 'Alpine white', 'platinum-black': 'Platinum black', 'essence-white': 'Essence white',
        stainless: 'Stainless', 'printproof-stainless': 'PrintProof stainless', 'black-stainless': 'Black stainless', 'printproof-black-stainless': 'PrintProof black stainless', black: 'Black',
        'in-stock': 'In stock', 'on-sale': 'On sale', 'best-buy-pickup': 'Pick up at Best Buy' };
      const word = (v) => WORD[v] || String(v).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const GROUP = { category: 'Category', room: 'Room', type: 'Type', sizeBand: 'Screen size', capacityTier: 'Capacity', fuel: 'Fuel', finish: 'Finish', price: 'Price', pickup: 'Get it fast', stock: 'Availability', sale: 'Offers' };
      /** The facets' own order where the values have one (sizes, capacities); every other group lists its values as the feed first carries them. */
      const ORDER = { sizeBand: ['up-to-41', '42-54', '55-64', '65-74', '75-82', '83-and-up'], capacityTier: ['compact', 'standard', 'large', 'extra-large'], type: ['oled', 'qned', 'micro-rgb', 'uhd', 'lifestyle', 'hd'] };
      const ATTR_DIMS = new Set(['category', 'room', 'type', 'sizeBand', 'capacityTier', 'fuel', 'finish']);
      const BANDS = { [GRID]: [[0, 500], [500, 1000], [1000, 2000], [2000, 3000], [3000, Infinity]], other: [[0, 700], [700, 1000], [1000, 1500], [1500, 2500], [2500, Infinity]] };
      const bandsOf = (view) => BANDS[view] || BANDS.other;
      const bandKey = (b) => `${b[0]}-${b[1] === Infinity ? 'up' : b[1]}`;
      const bandLabel = (b) => (b[0] === 0 ? `Under ${money0(b[1])}` : b[1] === Infinity ? `${money0(b[0])} and up` : `${money0(b[0])} – ${money0(b[1])}`);
      const SORT_LABEL = { best: 'Best match', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low', rating: 'Customer rating' };
      const sortLabel = (k) => SORT_LABEL[k] || SORT_LABEL.best;
      const titleOfP = (p) => (p && (p.title || productName(p))) || '';
      const isPickup = (p) => Boolean(p && (p.bestBuyPickup === true || arr(p.attributes && p.attributes.retailer).includes('best-buy-pickup')));

      // ── The template: the opening catalog's pieces in a slot's own order, before anyone arrives ──
      /** In force now with nothing asked: live, inside its window, in stock, and no rule that needs a context she has not given. */
      const inForceNow = (p) => Boolean(p) && liveAt(p, Date.now()) && p.inStock !== false && !p.eligibleWhen;
      function template(slot) {
        const def = S.openSlots[slot.slot] || {};
        // The take of the published opening slots document (beats/open-slots.json, what the template is), else the config's;
        // own: the hero carousel's own count of slides, not the slot's.
        const take = (slot.own ? num(slot.take) : num(def.take) || takeOf(slot)) || 1, div = def.diversity || null, counts = {};
        const out = [];
        for (const p of piecesNow()) {
          if (out.length >= take) break;
          if (!arr(p.slotTypes).includes(slot.slot) || !inForceNow(p)) continue;
          if (div && div.dimension) {                                   // the slot's own diversity rule, applied in the catalog's order
            const vals = arr((p.tags || {})[div.dimension]);
            if (vals.some((v) => (counts[v] || 0) >= num(div.max))) continue;
            for (const v of vals) counts[v] = (counts[v] || 0) + 1;
          }
          out.push({ customerContentId: p.customerContentId, contentId: p.id, slot: slot.slot, order: out.length, strategy: 'template', decisionId: '' });
        }
        return out;
      }
      /** The boot page: the published template in every slot of the homepage, the rail in the site's own order, nothing decided. */
      async function paintTemplate(key) {
        await data();
        ensureChrome();
        S.tpl = true;
        try { for (const s of slotsOf(key)) renderSlot(s, template(s)); } finally { S.tpl = false; }
        for (const rail of railsOf(key)) await paintRail(rail);
      }

      // ── The product card: image, badges, name, model, stars, sale price, $X OFF, the struck list price, delivery, a button ──
      const stars = (r) => { const n = Math.round(num(r) || 0); return `${'★'.repeat(Math.max(0, Math.min(5, n)))}${'☆'.repeat(Math.max(0, 5 - n))}`; };
      const ICON_TRUCK = '<svg class="m1-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/></svg>';
      const ICON_STORE = '<svg class="m1-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5V20h16V9.5M3 9.5l1.6-5h14.8L21 9.5zM9.5 20v-5.5h5V20"/></svg>';
      function shipLine(p) {
        if (p.cta !== 'cart') return `<span class="m1-sl">${ICON_STORE}Sold through retailers <span>· Find a Retailer for stock near you</span></span>`;
        if (p.inStock === false) return `<span class="m1-sl">${ICON_TRUCK}<span>Out of stock online</span></span>`;
        const room = roomOf(p);
        const when = new Date(Date.now() + (room === 'living-room' ? 5 : 8) * DAY).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return `<span class="m1-sl">${ICON_TRUCK}Free delivery <span>· est. ${esc(when)}</span></span>${isPickup(p) ? `<span class="m1-sl">${ICON_STORE}Pick up at Best Buy <span>· where eligible</span></span>` : ''}`;
      }
      /** The card in lg.com's grammar: badges, the picture, the name, the model with the stars, the price bold with $X OFF over
       *  the struck list price beside it, delivery with its icons, the button. */
      function card(p, o = {}) {
        const id = idOf(p), price = priceNum(p), list = listNum(p);
        const off = price !== null && list && list > price ? list - price : 0;   // shown as lg.com does, in whole dollars ("$399 OFF")
        const badges = arr(p.badges).slice(0, 2);
        const cta = p.cta === 'cart' && p.inStock !== false && price !== null
          ? `<button type="button" class="btn btn--brand btn--sm" data-act="store-add" data-sku="${esc(id)}" data-ctl="add-${esc(id)}">Add to Cart</button>`
          : p.cta !== 'cart' ? `<button type="button" class="btn btn--line btn--sm" data-act="store-retailers" data-sku="${esc(id)}" data-ctl="retailers-${esc(id)}">Find a Retailer</button>`
            : '<span class="p1-stock">Out of stock</span>';
        return `<article class="pcard p1-pcard" data-open="${esc(id)}" data-ctl="${esc(o.ctl || `open-${id}`)}" data-sku="${esc(id)}">${o.chip || ''}
          <span class="m1-badges">${badges.map((b) => `<span class="m1-badge${/new/i.test(b) ? '' : ' m1-badge--quiet'}">${esc(b)}</span>`).join('')}</span>
          ${artHtml(p, 'p1-art--card')}
          <span class="pname">${esc(titleOfP(p))}</span>
          <span class="m1-meta"><span class="m1-sku">${esc(id)}</span>${p.rating ? ` <span class="p1-rating"><i aria-hidden="true">${stars(p.rating)}</i> ${esc(p.rating)}${p.reviews ? ` <em>(${Number(p.reviews).toLocaleString('en-US')})</em>` : ''}</span>` : ''}</span>
          <span class="pprice">${price !== null ? `<b class="m1-now">${money(price)}</b>` : '<span class="m1-retail">Price at the retailer</span>'}${off >= 0.5 ? ` <span class="m1-was"><span class="m1-off">${money0(Math.round(off))} OFF</span> <s>${money(list)}</s></span>` : ''}</span>
          <span class="m1-ship">${shipLine(p)}</span>
          <span class="m1-cardbtn">${cta}</span>
          ${o.rank ? `<span class="p1-rank">${o.rank}</span>` : ''}</article>`;
      }

      // ── The grids: candidates, facets, filters, her choice of order ─────────
      function basePool(view) {
        const priced = (p) => priceNum(p) !== null;
        if (view === GRID) return state.products.filter((p) => field(p, SITE.products.category) === 'tvs' && priced(p));   // the products file's own order
        if (view === 'search') return arr(S.search.matches);
        if (GRIDS[view] && GRIDS[view].sale) return state.products.filter((p) => priced(p) && listNum(p) && listNum(p) > priceNum(p) && field(p, 'attributes.category') !== 'styler');
        const cats = arr(GRIDS[view] && GRIDS[view].cats);
        return state.products.filter((p) => cats.includes(field(p, 'attributes.category')) && priced(p));
      }
      function facet(view, p, dim) {
        if (ATTR_DIMS.has(dim)) return arr(field(p, `attributes.${dim}`)).map(String);
        if (dim === 'price') { const pr = priceNum(p); const b = bandsOf(view).find(([lo, hi]) => pr >= lo && pr < hi); return b ? [bandKey(b)] : []; }
        if (dim === 'stock') return p.inStock !== false ? ['in-stock'] : [];
        if (dim === 'sale') return listNum(p) && listNum(p) > priceNum(p) ? ['on-sale'] : [];
        if (dim === 'pickup') return isPickup(p) ? ['best-buy-pickup'] : [];
        return [];
      }
      /** Her filters over a grid's candidates; `except` leaves one group out (its own counts). */
      function filtered(view, except) {
        const f = gs(view).f;
        const groups = Object.entries(f).filter(([dim, vals]) => dim !== except && arr(vals).length);
        return basePool(view).filter((p) => groups.every(([dim, vals]) => facet(view, p, dim).some((x) => vals.includes(x))));
      }
      /** POST /sort's order over what is left; a candidate the answer did not hold yet (her filters widened since) follows in the site's order. */
      /**
       * A grid's order before any answer, as the products file declares it: the room's best sellers (the TV grid its
       * gridDefaults; offers and search every room's, room by room), then the rest of what is left in the feed's order.
       * The lists are the merchandiser's, read from the file; the page computes no order of its own.
       */
      function declaredList(view) {
        const t = S.template;
        if (!t) return [];
        const sellers = t.bestSellers || {};
        if (view === 'for-you') return arr(t.recommended);
        if (view === GRID) return arr(t.gridDefaults && t.gridDefaults.tvs);
        if (view === 'laundry') return arr(sellers['laundry-room']);
        if (view === 'kitchen') return arr(sellers.kitchen);
        if (view === 'offers' || view === 'search') return [...arr(sellers['living-room']), ...arr(sellers['laundry-room']), ...arr(sellers.kitchen)];
        return [];
      }
      function templateOrder(view, pool) {
        const ids = pool.map(idOf), here = new Set(ids), out = [];
        for (const id of declaredList(view).map(String)) if (here.has(id) && !out.includes(id)) out.push(id);
        for (const id of ids) if (!out.includes(id)) out.push(id);
        return out;
      }
      /** Whether the declared list leads what is on screen (the label then says so). */
      const declaredFor = (view, pool) => { const here = new Set(pool.map(idOf)); return declaredList(view).some((id) => here.has(String(id))); };
      function bestOrder(R, pool, view) {
        const ids = new Set(pool.map(idOf));
        const out = R && R.order ? R.order.map(String).filter((id) => ids.has(id)) : templateOrder(view, pool);
        if (R && R.order) { const seen = new Set(out); for (const p of pool) if (!seen.has(idOf(p))) out.push(idOf(p)); }
        return out;
      }
      const SORTS = {
        'price-asc': (a, b) => (priceNum(a) === null ? Infinity : priceNum(a)) - (priceNum(b) === null ? Infinity : priceNum(b)),
        'price-desc': (a, b) => (priceNum(b) === null ? -Infinity : priceNum(b)) - (priceNum(a) === null ? -Infinity : priceNum(a)),
        rating: (a, b) => ((num(b.rating) || 0) - (num(a.rating) || 0)) || ((num(b.reviews) || 0) - (num(a.reviews) || 0)),
      };
      /** Her own choice on the sort control (a price or the rating), never the default: Best match is POST /sort's order. */
      function chosenOrder(pool, key) { return SORTS[key] ? [...pool].sort(SORTS[key]).map(idOf) : pool.map(idOf); }
      /** The values a group offers on this grid, in their own order (sizes, capacities) or as the feed first carries them. */
      function optionsOf(view, dim) {
        if (dim === 'price') return bandsOf(view).map((b) => [bandKey(b), bandLabel(b)]);
        if (dim === 'stock') return [['in-stock', 'In stock']];
        if (dim === 'sale') return [['on-sale', 'On sale']];
        if (dim === 'pickup') return [['best-buy-pickup', 'Pick up at Best Buy']];
        const seen = [];
        for (const p of basePool(view)) for (const v of facet(view, p, dim)) if (!seen.includes(v)) seen.push(v);
        const own = ORDER[dim];
        const list = own ? [...own.filter((v) => seen.includes(v)), ...seen.filter((v) => !own.includes(v))] : seen;
        return list.map((v) => [v, word(v)]);
      }
      function groupsOf(view) {
        const groups = arr(GRIDS[view].groups);
        return view === GRID && !groups.includes('pickup') ? [...groups.slice(0, 3), 'pickup', ...groups.slice(3)] : groups;
      }
      function filtersHtml(view) {
        const G = gs(view), any = Object.keys(G.f).length;
        const body = groupsOf(view).map((dim) => {
          const opts = optionsOf(view, dim);
          if (opts.length < (['stock', 'sale', 'pickup'].includes(dim) ? 1 : 2)) return '';
          const pool = filtered(view, dim);
          const rows = opts.map(([v, label]) => {
            const n = pool.filter((p) => facet(view, p, dim).includes(v)).length;
            const on = arr(G.f[dim]).includes(v);
            return `<button type="button" class="m1-fopt" data-act="m1-filter" data-view="${view}" data-dim="${dim}" data-val="${esc(v)}" data-ctl="filter-${view}-${dim}-${esc(v)}" aria-pressed="${on}"${!n && !on ? ' disabled' : ''}>${esc(label)}<em>${n}</em></button>`;
          }).join('');
          return `<div class="m1-fgroup"><h3>${esc(GROUP[dim] || dim)}</h3>${rows}</div>`;
        }).join('');
        return `<div class="m1-filters-head"><h2>Filters</h2>${any ? `<button type="button" data-act="m1-filter-clear" data-view="${view}" data-ctl="filters-clear-${view}">Clear all</button>` : ''}</div>${body}
          <p class="m1-fnote"><span class="nper">filters and sort: not personalised</span> Your filters are yours, never decided; the engine orders what they leave.</p>`;
      }
      function toolbarHtml(view, total, shown) {
        const G = gs(view);
        const chips = Object.entries(G.f).flatMap(([dim, vals]) => arr(vals).map((v) => {
          const label = dim === 'price' ? (optionsOf(view, 'price').find(([k]) => k === v) || [v, v])[1] : word(v);
          return `<button type="button" class="m1-chip" data-act="m1-filter" data-view="${view}" data-dim="${dim}" data-val="${esc(v)}" data-ctl="chip-${view}-${dim}-${esc(v)}" aria-label="Remove ${esc(label)}">${esc(label)}</button>`;
        })).join('');
        const menu = Object.keys(SORT_LABEL).map((k) => `<button type="button" role="menuitemradio" data-act="m1-sort" data-view="${view}" data-sort="${k}" data-ctl="sort-${view}-${k}" aria-checked="${G.sort === k}">${esc(SORT_LABEL[k])}</button>`).join('');
        return `<span class="m1-count" id="m1Count-${view}">${total.toLocaleString('en-US')} result${total === 1 ? '' : 's'}${total ? ` <span>· showing ${shown}</span>` : ''}</span>
          ${chips ? `<span class="m1-chips">${chips}</span>` : ''}
          <span class="m1-tools"><button type="button" class="btn btn--line btn--sm m1-filters-toggle" data-act="m1-filters-toggle" data-view="${view}" data-ctl="filters-toggle-${view}">Filters${Object.keys(G.f).length ? ` (${Object.values(G.f).reduce((n, x) => n + arr(x).length, 0)})` : ''}</button>
          <span class="m1-sort"><button type="button" data-act="m1-sort-open" data-view="${view}" data-ctl="sort-${view}" aria-haspopup="menu" aria-expanded="false">Sort by: <b>${esc(sortLabel(G.sort))}</b></button><span class="m1-sort-menu" role="menu" id="m1SortMenu-${view}" hidden>${menu}</span></span></span>`;
      }
      /** The grid's own chrome around its cards: the toolbar, the filters, Show more, her space. */
      function gridChrome(view, pool, best, shown) {
        const G = gs(view);
        const bar = $(`m1Bar-${view}`), panel = $(`m1Filters-${view}`), more = $(`m1More-${view}`);
        if (bar) bar.innerHTML = toolbarHtml(view, pool.length, shown);
        if (panel) { const open = panel.classList.contains('m1-open'); panel.innerHTML = filtersHtml(view); panel.classList.toggle('m1-open', open); }
        if (more) more.innerHTML = pool.length > shown ? `<span>Showing ${shown} of ${pool.length}</span><button type="button" class="btn btn--line" data-act="m1-more" data-view="${view}" data-ctl="more-${view}">Show more</button>` : (pool.length ? `<span>Showing all ${pool.length}</span>` : '');
        if (GRIDS[view].fit) fitNote(view);
        quick(view);
        roomBanner(view);
        if (view === 'search') searchHead();
      }
      function quick(view) {
        const box = $(`m1Quick-${view}`);
        if (!box || box.dataset.m1 === `${JSON.stringify(gs(view).f)}`) return;
        box.dataset.m1 = JSON.stringify(gs(view).f);
        box.innerHTML = arr(GRIDS[view].quick).map(([label, dim, val, sku]) => {
          const p = productOf(sku), on = arr(gs(view).f[dim]).includes(val);
          return `<button type="button" data-act="m1-filter" data-view="${view}" data-dim="${dim}" data-val="${esc(val)}" data-ctl="quick-${view}-${esc(val)}" aria-pressed="${on}">${p ? artHtml(p, 'p1-art--quick') : '<span class="p1-art p1-art--quick"></span>'}<span>${esc(label)}</span></button>`;
        }).join('');
      }
      /** A grid's own question: POST /sort over what her filters and her space leave (the TV grid also asks its promotion). */
      async function askGrid(view) {
        await data();
        ensureChrome();
        const v = transport.cur();
        await sortAndPaint(view, gridRail(view), v);
        document.body.classList.add('m1-live');
        zip();
        panels.renderWho();
        director.sayAfter();
        await panels.renderVectors();
        panels.renderWhy();
        demo.compare.afterDecidedPaint(view);
        return true;
      }
      async function openGrid(view, opts = {}) {
        await store.visitor.ensure();
        showView(view);
        route(`${BASE}?view=${encodeURIComponent(view)}`);
        if (opts.event !== false) {
          await transport.send('page_view', { page: view });
          panels.note('viewed', `The ${GRIDS[view].title} grid`, 'asked again');
        }
        await askGrid(view);
        markNav(view);
        scrollTop();
        return true;
      }

      // ── The search results: the feed by name, model and type, in POST /sort's order ──
      function searchHead() {
        const q = S.search.q || '', n = arr(S.search.matches).length;
        const title = $('m1SearchTitle'), sub = $('m1SearchSub');
        if (title) title.textContent = q ? (n ? `${n.toLocaleString('en-US')} result${n === 1 ? '' : 's'} for “${q}”` : `Nothing matches “${q}”`) : 'Search';
        if (sub) sub.innerHTML = q && !n ? 'Try a type (OLED, front load), a category (dishwashers) or a model number. <button type="button" class="btn btn--line btn--sm" data-act="m1-goto" data-view="search" data-q="OLED" data-ctl="try-oled">OLED</button> <button type="button" class="btn btn--line btn--sm" data-act="m1-goto" data-view="search" data-q="front load washer" data-ctl="try-washer">Front load washer</button>'
          : 'Search the store by name, model number or type';
        const input = document.querySelector('#site form[data-store-search] input[name="q"]');
        if (input && document.activeElement !== input && q) input.value = q;
      }
      function setSearch(q) {
        S.search = { q: String(q || '').trim().slice(0, 120), matches: store.search.match(String(q || '')).filter((p) => priceNum(p) !== null) };
        S.grids.search = freshGrid();
      }
      async function openSearch(q, opts = {}) {
        await store.visitor.ensure();
        setSearch(q);
        showView('search');
        route(`${BASE}?q=${encodeURIComponent(S.search.q)}`);                // the store's search address (/oh/?q=, the contract's)
        searchHead();
        const G = gs('search');
        if (S.search.q) {
          const res = await store.search.query(S.search.q, { event: opts.event !== false });   // the search event, then POST /sort over every match
          G.rail = { status: res.status === 'sorted' ? 'sorted' : 'site', order: arr(res.skus).map(String), items: arr(res.items), regional: res.regional || null, prevOrder: null, error: res.error };
        }
        await paintRail(gridRail('search'));
        document.body.classList.add('m1-live');
        panels.renderWho();
        await panels.renderVectors();
        panels.renderWhy();
        markNav('search');
        scrollTop();
        return true;
      }

      // ── The store's chrome: the header, the pencil banner and the footer, the same on every shell ──
      const ICON = {
        truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 6.5h11v9h-11z"/><path d="M13.5 9.5h4l3 3v3h-7z"/><circle cx="6.5" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>',
        cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 3.5h2.6l2.3 11.2h10.8l2.2-8H6.3"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/></svg>',
      };
      const NAV = `<button type="button" data-nav="tvs" data-ctl="nav-tvs">TVs</button>${Object.entries(MENUS).map(([key, m]) => `<button type="button" data-act="p1-menu" data-menu="${key}" data-ctl="nav-${key}" aria-expanded="false">${esc(m.label)}</button>`).join('')}`
        + '<button type="button" data-nav="offers" data-ctl="nav-offers">Offers</button><button type="button" data-act="m1-info" data-info="support" data-ctl="nav-support">Support</button>';
      const MAST = `<div class="mast"><a class="wordmark" href="${BASE}" data-nav="home" data-ctl="home" aria-label="OH. home"><span class="wm" id="wordmark">${esc(SITE.brand.wordmark)}</span><span class="wm-tag" id="tagline">${esc(SITE.brand.tagline)}</span></a>
        <nav class="mainnav" id="mainnav" aria-label="Shop">${NAV}</nav>
        <form class="m1-search" data-store-search role="search" action="${BASE}search"><input name="q" type="search" placeholder="Search TVs, laundry, kitchen" aria-label="Search the store" autocomplete="off" data-ctl="search-input" /><button type="submit" data-ctl="search-go" aria-label="Search">${ICON.search}</button></form>
        <div class="m1-right"><button type="button" class="m1-zip" data-act="m1-info" data-info="delivery" data-ctl="zip" title="Your region, read from the request">${ICON.truck}<span class="m1-label">Delivering to</span> <b id="m1Zip">your area</b></button><span id="m1SignSlot"></span>
        <button type="button" class="m1-icon-btn" data-act="store-cart-open" data-ctl="cart-open" aria-label="Cart">${ICON.cart}<span class="m1-cart-n" data-cart-count>0</span></button></div></div>`;
      const FOOT_COLS = [
        ['TV & audio', [['All TVs', 'data-nav="tvs"', 'foot-tvs'], ['OLED TVs', 'data-act="m1-goto" data-view="tvs" data-filter="type:oled"', 'foot-oled'], ['QNED TVs', 'data-act="m1-goto" data-view="tvs" data-filter="type:qned"', 'foot-qned'], ['Soundbars', 'data-act="m1-goto" data-view="search" data-q="soundbar"', 'foot-soundbars']]],
        ['Laundry', [['Washers & dryers', 'data-nav="laundry"', 'foot-laundry'], ['Washers', 'data-act="m1-goto" data-view="laundry" data-filter="category:washers"', 'foot-washers'], ['Dryers', 'data-act="m1-goto" data-view="laundry" data-filter="category:dryers"', 'foot-dryers'], ['Laundry sets', 'data-act="m1-goto" data-view="laundry" data-filter="category:laundry-sets"', 'foot-sets']]],
        ['Kitchen', [['All kitchen', 'data-nav="kitchen"', 'foot-kitchen'], ['Ranges', 'data-act="m1-goto" data-view="kitchen" data-filter="category:ranges"', 'foot-ranges'], ['Dishwashers', 'data-act="m1-goto" data-view="kitchen" data-filter="category:dishwashers"', 'foot-dishwashers'], ['Kitchen packages', 'data-act="m1-goto" data-view="kitchen" data-filter="category:kitchen-packages"', 'foot-packages']]],
        ['Support', [['Contact us', 'data-act="m1-info" data-info="support"', 'foot-support'], ['Delivery and installation', 'data-act="m1-info" data-info="delivery"', 'foot-delivery'], ['Returns', 'data-act="m1-info" data-info="returns"', 'foot-returns'], ['Protection plans', 'data-act="m1-info" data-info="coverage"', 'foot-coverage']]],
      ];
      const FOOT = `<span class="nper">not personalised</span><div class="m1-foot"><div class="m1-foot-cols">${FOOT_COLS.map(([h, links]) => `<div><h3>${esc(h)}</h3><ul>${links.map(([label, attrs, ctl]) => `<li><button type="button" ${attrs} data-ctl="${ctl}">${esc(label)}</button></li>`).join('')}</ul></div>`).join('')}
        <div class="m1-foot-brand"><span class="wm">${esc(SITE.brand.wordmark)}</span><p>${esc(SITE.brand.tagline)}: TVs, laundry and the kitchen, chosen with you. The header, the menus, the strips and this footer are the same for everyone; the modules marked “Decided for you” are decided per visitor, and each says why.</p></div></div>
        <div class="m1-foot-base"><p class="foot-legal" id="footLegal">${esc(String(SITE.brand.legal || '').replace(/ as listed publicly on [^;]+;/, ' as listed publicly;'))}</p><p class="m1-foot-marks">Delivery dates are representative and the same for everyone.</p></div></div>`;
      /** The site's own promotions in the pencil banner, each kept only while its piece is in force in the catalog. */
      const PENCIL = [
        { cid: 'deal-big-screens', b: 'Up to $1,000 off big screens', t: 'on select 75-inch and larger TVs', cta: 'Shop now', attrs: 'data-act="m1-goto" data-view="tvs" data-filter="sizeBand:75-82,sizeBand:83-and-up"' },
        { cid: 'deal-laundry-pair', b: 'Save $200 on a washer and an eligible dryer', t: 'bought together, online only', cta: 'Shop laundry', attrs: 'data-act="m1-goto" data-view="laundry" data-filter="category:washers,category:dryers"' },
        { cid: null, b: 'Free delivery on everything we sell', t: 'and haul-away of the old one when you book it', cta: 'Details', attrs: 'data-act="m1-info" data-info="delivery"' },
      ];
      const pencilNow = () => PENCIL.filter((x) => !x.cid || inForce(x.cid));
      const inForce = (cid) => { const p = piecesNow().find((x) => x.customerContentId === cid); return Boolean(p) && liveAt(p, Date.now()) && p.inStock !== false; };
      function pencil() {
        const list = pencilNow(), msg = $('m1PencilMsg'), n = $('m1PencilN');
        if (!msg || !list.length) return;
        const i = ((S.pencil % list.length) + list.length) % list.length, x = list[i];
        msg.dataset.i = String(i);
        msg.innerHTML = `<b>${esc(x.b)}</b><span>${esc(x.t)}</span><button type="button" ${x.attrs} data-ctl="pencil-cta">${esc(x.cta)}</button>`;
        if (n) n.textContent = `${i + 1}/${list.length}`;
      }
      /** Every shell carries the same chrome: a shell whose header predates the store gets this one, its Sign in control moved in. */
      function shell() {
        const site = $('site');
        if (!site) return;
        const header = site.querySelector('.site-header');
        if (header && !header.dataset.m1) {
          const sign = $('signIn');
          header.dataset.m1 = '1';
          header.innerHTML = MAST;
          const slot = $('m1SignSlot');
          if (sign) { sign.classList.add('u-sign'); slot.replaceWith(sign); } else slot.outerHTML = '<span class="u-sign" id="signIn" role="button" tabindex="0" data-act="sign-in" data-ctl="sign-in">Sign in</span>';
        }
        if (header && !$('m1Pencil')) header.insertAdjacentHTML('beforebegin', `<div class="m1-pencil static" id="m1Pencil" aria-label="Promotions"><div class="m1-pencil-in"><p class="m1-pencil-msg" id="m1PencilMsg"></p><div class="m1-pencil-nav"><button type="button" data-act="m1-pencil" data-step="-1" data-ctl="pencil-prev" aria-label="Previous promotion">&lsaquo;</button><span id="m1PencilN"></span><button type="button" data-act="m1-pencil" data-step="1" data-ctl="pencil-next" aria-label="Next promotion">&rsaquo;</button></div></div></div>`);
        const foot = site.querySelector('.site-footer');
        if (foot && !foot.dataset.m1) { foot.dataset.m1 = '1'; foot.innerHTML = FOOT; }
      }
      /** The 13 category icons (static): each opens its grid with its own filter, or the search for its kind. */
      const CATS = [['TVs', 'tvs', '', 'OLED65C6PUA'], ['OLED TVs', 'tvs', 'type:oled', 'OLED77G6WUA'], ['QNED TVs', 'tvs', 'type:qned', '65QNED8MBAA'], ['Soundbars', 'search', 'q:soundbar', 'S90TR'],
        ['Wall mounts', 'search', 'q:wall mount', 'OLW480B'], ['Washers', 'laundry', 'category:washers', 'WM4000HWA'], ['Dryers', 'laundry', 'category:dryers', 'DLEX4000W'], ['WashTower', 'laundry', 'category:washtowers', 'WKE100HWA'],
        ['Laundry sets', 'laundry', 'category:laundry-sets', 'WM4000HWA_DLEX4000W_WD300CW_WDP6W'], ['Ranges', 'kitchen', 'category:ranges', 'LSGL6335X'], ['Microwaves', 'kitchen', 'category:microwaves', 'MVEM1825F'],
        ['Dishwashers', 'kitchen', 'category:dishwashers', 'LDNTH753S'], ['Kitchen packages', 'kitchen', 'category:kitchen-packages', 'LF24Z6530S_LSGL5833X_MVEM1825F_ADFD5448AT']];
      /** The showcase tabs (static): the site's own picks, the same for everyone. */
      const SHOWCASE = { appliances: ['WM4000HWA', 'DLEX4000W', 'LSGL6335X', 'LDNTH753S'], entertainment: ['OLED65C6PUA', '75MRGB95BUA', '65QNED8MBAA', 'S90TR'] };
      function fill() {
        const cats = $('m1Cats');
        if (cats && !cats.dataset.m1 && state.products.length) {
          cats.dataset.m1 = '1';
          cats.innerHTML = CATS.map(([label, view, f, sku]) => {
            const p = productOf(sku), q = /^q:/.test(f) ? f.slice(2) : null;
            return `<button type="button" class="m1-cat" data-act="m1-goto" data-view="${view}" ${q ? `data-q="${esc(q)}"` : `data-filter="${esc(f)}"`} data-ctl="cat-${esc(label.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${p ? artHtml(p, 'p1-art--cat') : '<span class="p1-art p1-art--cat"></span>'}<span>${esc(label)}</span></button>`;
          }).join('');
        }
        const show = $('m1ShowCards'), msg = $('m1PencilMsg');
        if (show && !show.dataset.tab) showcase();      // drawn once; a tab press draws it again
        if (msg && !msg.dataset.i) pencil();
      }
      function showcase() {
        const box = $('m1ShowCards');
        if (!box || !state.products.length) return;
        for (const b of document.querySelectorAll('#m1ShowTabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
        box.dataset.tab = S.tab;
        box.innerHTML = arr(SHOWCASE[S.tab]).map(productOf).filter(Boolean).map((p) => card(p, { ctl: `show-${idOf(p)}` })).join('');
      }
      /** The ZIP chip: her region as the request gives it (the edge's state, never her postal code), read once without a visitor. */
      let zipAsk = null;
      function zip() {
        const node = $('m1Zip');
        if (!node) return;
        const own = state.own && (state.own.label || state.own.key);
        if (own) { node.textContent = own; return; }
        if (S.zip) { node.textContent = S.zip; return; }
        if (!zipAsk) {
          zipAsk = transport.api(SITE.api.coldstart, undefined, { visitor: null }).then((r) => {
            const c = r.ok && r.body ? r.body : null, region = (c && c.region) || {}, cen = (c && c.census) || {};
            S.zip = region.source === 'edge' && region.key ? (cen.label && cen.grain !== 'national' ? cen.label : US[region.key] || region.key) : null;
            if (S.zip && !(state.own && state.own.label)) node.textContent = S.zip;
          }).catch(() => null);
        }
      }
      /** The legal line, dated by the feed itself: the latest price date the products file and the product pages carry. */
      let legalAsk = null;
      function legal() {
        if (legalAsk) return legalAsk;
        legalAsk = data().then(() => (SITE.products.overlay ? transport.tryJson(SITE.products.overlay.file) : null)).then((overlay) => {
          const docs = [{ asOf: S.feedAsOf }, overlay];
          const dates = docs.map((d) => d && /^\d{4}-\d{2}-\d{2}/.test(String(d.asOf || '')) ? String(d.asOf).slice(0, 10) : null).filter(Boolean);
          let latest = null;
          for (const d of dates) if (!latest || d > latest) latest = d;
          if (!latest) return;
          const when = new Date(`${latest}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
          const text = /as listed publicly on [^;]+;/.test(SITE.brand.legal) ? SITE.brand.legal.replace(/as listed publicly on [^;]+;/, `as listed publicly on or before ${when};`) : `${SITE.brand.legal} Prices as listed publicly on or before ${when}.`;
          for (const node of document.querySelectorAll('#footLegal')) node.textContent = text;
        }).catch(() => null);
        return legalAsk;
      }
      /**
       * Each decided module's head says what is true of what it shows: "Decided for you" (a grid's "Best match, decided
       * for you") once the engine has returned a decision for her there, else the site's own order, "before anyone
       * arrives" while nobody has. Read off the page: a slot's container carrying a decision id, a rail's /sort answer.
       */
      function heads() {
        for (const id of PAGED) pagerSync(id);
        const someone = Boolean(transport.cur());
        for (const mod of document.querySelectorAll('#stage .module[data-slot], #stage .module[data-rail]')) {
          const tag = mod.querySelector('.module-where .m1-for');
          if (!tag) continue;
          let decided = false;
          if (mod.dataset.slot) decided = Boolean(mod.querySelector('[data-op-decision-id]:not([data-op-decision-id=""])'));
          else {
            const rail = mod.dataset.rail === 'for-you' ? railsOf(HOME)[0] : GRID_OF_SLOT[mod.dataset.rail] ? gridRail(GRID_OF_SLOT[mod.dataset.rail]) : null;
            decided = Boolean(rail && railState(rail).status === 'sorted');
          }
          const text = decided ? (tag.dataset.decided || 'Decided for you') : someone ? 'The site’s own order' : 'The site’s own order · before anyone arrives';
          if (tag.textContent !== text) tag.textContent = text;
          tag.classList.toggle('m1-for--site', !decided);
        }
      }
      /** The header marks the page on screen: TVs, Offers, or the menu whose room's grid is open. */
      function markNav(view) {
        const v = view || state.viewPage;
        for (const b of document.querySelectorAll('#mainnav button')) {
          const mine = (b.dataset.nav && b.dataset.nav === v) || (b.dataset.menu && b.dataset.menu === v);
          if (mine) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        }
      }
      function chrome() {
        shell();
        fill();
        zip();
        void legal();
      }

      // ── The info sheets: what the store's static controls open, said plainly ──
      function info(kind) {
        const region = (state.own && (state.own.label || state.own.key)) || S.zip || null;
        const go = (label, attrs, ctl) => `<button type="button" class="btn btn--line btn--sm" ${attrs} data-ctl="${ctl}">${esc(label)}</button>`;
        const SHEETS = {
          support: ['Support', 'How can we help?', `<p>Order status, delivery, installation, returns and protection plans: each has its page below. This is a demonstration store, so there is no support desk behind it and no order is ever shipped.</p>
            <div class="sactions">${go('Delivery and installation', 'data-act="m1-info" data-info="delivery"', 'info-delivery')}${go('Returns', 'data-act="m1-info" data-info="returns"', 'info-returns')}${go('Protection plans', 'data-act="m1-info" data-info="coverage"', 'info-coverage')}${go('Chat with an expert', 'data-act="m1-info" data-info="expert"', 'info-expert')}</div>`],
          delivery: ['Delivery', region ? `Delivering to ${region}` : 'Delivery', `<p>${region ? `<b>${esc(region)}</b> is your region as the request that loaded this page gives it, read at the edge. We never ask for or read your ZIP code.` : 'Your region is read from the request at the edge; this request carried none.'}</p>
            <p>Delivery is free on everything we sell. Stand set-up, wall mounting, appliance installation and haul-away are added on the product page. The delivery dates on the cards are representative and the same for everyone.</p>`],
          returns: ['Returns', '14-day returns', '<p>Return any product within 14 days of delivery. In this demonstration nothing is sold, so nothing is returned: the cart records what you chose and the decisions that led you there.</p>'],
          coverage: ['Protection', 'Extended coverage', '<p>Protection plans of one, two or three years, added to a TV or an appliance on its product page or in the cart, at the price the product page lists. The price of a plan is the same for everyone.</p>'],
          'haul-away': ['Haul-away', 'We take the old one away', '<p>Book haul-away with your delivery and the appliance you are replacing leaves with the crew, at the price the product page lists.</p>'],
          expert: ['Shop with an expert', 'Chat with an expert', '<p>On a live site this opens the store’s chat with a product expert. In this demonstration the chat is not connected: nothing you type here goes anywhere.</p>'],
          pickup: ['Pickup', 'Order here, pick up at Best Buy', `<p>On eligible TVs, soundbars and some laundry, an OH. order is handed over at a Best Buy store, often in about two hours. Look for “Pick up at Best Buy” on a card or a product page.</p><div class="sactions">${go('See pickup TVs', 'data-act="m1-goto" data-view="tvs" data-filter="pickup:best-buy-pickup"', 'info-pickup-tvs')}</div>`],
        };
        const s = SHEETS[kind] || SHEETS.support;
        sheets.open('m1-info', `<p class="sk">${esc(s[0])}</p><h2 id="sheetTitle">${esc(s[1])}</h2>${s[2]}<p class="p3-fine sheet-fine"><span class="nper">not personalised</span> the same for everyone</p>`);
      }
      /** The TV grid's promotion's own control: a filter it names, or the guide it is. */
      async function promo(cid) {
        const piece = pieceOf({ customerContentId: cid }) || {}, tags = piece.tags || {}, G = gs(GRID);
        if (cid === 'grid-size-by-distance') {
          return sheets.open('m1-info', `<p class="sk">Size it to the room</p><h2 id="sheetTitle">${esc(bare(piece.title || 'Size it to the room'))}</h2><p>${esc(piece.subtitle || '')}</p>
            <div class="sactions">${['55-64', '65-74', '75-82', '83-and-up'].map((b) => `<button type="button" class="btn btn--line btn--sm" data-act="m1-goto" data-view="tvs" data-filter="sizeBand:${b}" data-ctl="size-${b}">${esc(word(b))}</button>`).join('')}</div>`);
        }
        if (cid === 'grid-series-chart') {
          const rows = [];
          for (const t of ORDER.type) {
            const series = [];
            for (const p of basePool(GRID)) if (field(p, 'attributes.type') === t && field(p, 'attributes.series') && !series.includes(field(p, 'attributes.series'))) series.push(field(p, 'attributes.series'));
            if (series.length) rows.push(`<div class="srow"><span>${esc(word(t))}</span><b>${esc(series.map((x) => x.toUpperCase()).join(' · '))}</b></div>`);
          }
          return sheets.open('m1-info', `<p class="sk">Every series</p><h2 id="sheetTitle">${esc(bare(piece.title || 'Every series'))}</h2><p>${esc(piece.subtitle || '')}</p>${rows.join('')}<p class="p3-fine">The series we list today, by panel type, from the feed.</p>`);
        }
        // The piece's own tags as the grid's filters: one TV type names the narrowest list (free wall mounting: OLED), else its
        // sizes, else up to two TV types. A piece about soundbars (a soundbar or Sound Suite bundle) opens their search instead,
        // since no TV carries its type. (The offer cards under the banner use this too, by data-offer.)
        const tvTypes = arr(tags.type).filter((t) => ORDER.type.includes(t));
        const f = cid === 'grid-best-buy-pickup' ? { pickup: ['best-buy-pickup'] } : tvTypes.length === 1 ? { type: tvTypes } : arr(tags.sizeBand).length ? { sizeBand: arr(tags.sizeBand) }
          : tvTypes.length && tvTypes.length < 3 ? { type: tvTypes } : null;
        if (!f && arr(tags.category).includes('soundbars')) return store.nav.go(`${BASE}?q=${encodeURIComponent(arr(tags.type).includes('sound-suite') ? 'sound suite' : 'soundbar')}`, { dispatched: true });
        if (f) { G.f = { ...G.f, ...f }; G.show = 24; await store.reask(GRID); }
        const mod = $('mod-tv-grid');
        if (mod) focusOn(mod);
        return true;
      }
      /** The attributes a filter event carries: the control, the page, and the dimension value she chose (the beat verbs' shape). */
      function filterAttrs(view, dim, val) {
        const cats = arr(GRIDS[view].cats);
        return { control: dim === 'stock' ? 'in-stock' : dim === 'sale' ? 'on-sale' : dim, page: view, ...(cats.length === 1 ? { category: cats[0] } : {}),
          ...(ATTR_DIMS.has(dim) ? { [dim]: val } : {}), ...(dim === 'price' ? { band: val } : {}), ...(dim === 'sale' ? { contentType: 'deal' } : {}), ...(dim === 'pickup' ? { retailer: 'best-buy-pickup' } : {}) };
      }
      function closeSorts(except) { for (const m of document.querySelectorAll('.m1-sort-menu')) if (m !== except) { m.hidden = true; const b = m.parentElement && m.parentElement.querySelector('[data-act="m1-sort-open"]'); if (b) b.setAttribute('aria-expanded', 'false'); } }
      document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.m1-sort')) closeSorts(); });

      // ── The section's own controls (data-act="m1-…"): every one works by hand, and the cursor runs the same handler ──
      async function control(t) {
        const d = t.dataset, act = d.act;
        if (act === 'm1-goto') {
          closeMenus();
          const view = d.view;
          if (view === 'search') return store.nav.go(`${BASE}?q=${encodeURIComponent(d.q || '')}`, { dispatched: true });
          if (!isGrid(view)) return true;
          const G = gs(view);
          G.f = {}; G.sort = 'best'; G.show = 24;
          for (const pair of String(d.filter || '').split(',').filter(Boolean)) { const [dim, val] = pair.split(':'); if (dim && val) (G.f[dim] = G.f[dim] || []).push(val); }
          if (state.viewPage === view && transport.cur()) { await store.visitor.ensure(); await store.reask(view); markNav(view); return true; }
          return store.nav.go(store.nav.navPath(view), { dispatched: true });
        }
        if (act === 'm1-filter') {
          const view = d.view, dim = d.dim, val = d.val;
          if (!isGrid(view)) return true;
          await store.visitor.ensure();
          const G = gs(view), list = G.f[dim] || (G.f[dim] = []);
          const on = !list.includes(val);
          if (on) list.push(val); else list.splice(list.indexOf(val), 1);
          if (!list.length) delete G.f[dim];
          G.show = 24;
          await paintRail(gridRail(view));          // at once: the last answer's order over what her filters leave
          const label = dim === 'price' ? (optionsOf(view, 'price').find(([k]) => k === val) || [val, val])[1] : word(val);
          if (on) await store.events.send('filter', filterAttrs(view, dim, val), { reask: view, note: ['filtered', `${GROUP[dim] || dim}: ${label}`, 'the shopper’s own filter · custom filter, the beat verbs’ shape · the grid asks again'] });
          else { panels.note('filtered', `${GROUP[dim] || dim}: ${label} removed`, 'the filter taken off · no event: removing one says nothing about the shopper’s taste'); await store.reask(view); }
          return true;
        }
        if (act === 'm1-filter-clear') {
          const view = d.view;
          if (!isGrid(view)) return true;
          await store.visitor.ensure();
          gs(view).f = {}; gs(view).show = 24;
          panels.note('filtered', 'every filter cleared', 'no event: clearing says nothing about the shopper’s taste');
          await paintRail(gridRail(view));
          await store.reask(view);
          return true;
        }
        if (act === 'm1-sort-open') {
          const menu = $(`m1SortMenu-${d.view}`);
          if (!menu) return true;
          const open = menu.hidden;
          closeSorts(menu);
          menu.hidden = !open;
          t.setAttribute('aria-expanded', String(open));
          return true;
        }
        if (act === 'm1-sort') {
          const view = d.view;
          if (!isGrid(view) || !SORT_LABEL[d.sort]) return true;
          gs(view).sort = d.sort;
          closeSorts();
          panels.note('sorted', sortLabel(d.sort), d.sort === 'best' ? 'Best match: POST /sort’s order for the shopper' : 'the shopper’s own choice of order on the sort control: the page orders by it, the engine’s order stays on each card');
          await paintRail(gridRail(view));
          return true;
        }
        if (act === 'm1-more') { const G = gs(d.view); G.show += 24; await paintRail(gridRail(d.view)); return true; }
        if (act === 'm1-filters-toggle') { const p = $(`m1Filters-${d.view}`); if (p) p.classList.toggle('m1-open'); return true; }
        if (act === 'm1-info') { closeMenus(); info(d.info); return true; }
        if (act === 'm1-pencil') { S.pencil += num(d.step) || 1; pencil(); return true; }
        if (act === 'm1-tab') { S.tab = d.tab === 'entertainment' ? 'entertainment' : 'appliances'; showcase(); return true; }
        if (act === 'm1-promo') return promo(d.cid || d.offer);
        return undefined;
      }

      return { heads, template, paintTemplate, card, filtered, bestOrder, declaredFor, chosenOrder, sortLabel, gridChrome, askGrid, openGrid, openSearch, setSearch, searchHead, chrome, shell, fill, zip, legal, markNav, control };
    })();

    // ── Registration, once ──────────────────────────────────────────────────
    for (const key of [HOME, GRID]) LANES.ask[key] = (k) => ask(k);
    for (const view of Object.keys(GRIDS)) if (view !== GRID) LANES.ask[view] = () => M1.askGrid(view);
    // The store's navigation (M3's store.nav) paints a grid or the search results through these; home and products are the shared openers'.
    LANES.routes.grid = async (r, opts = {}) => {
      const view = r && r.view;
      if (view === GRID || (pageOf(view) && own(view) && own(view).key === GRID)) { const out = await openPage(view, { event: opts.event }); M1.markNav(view); return out; }
      if (isGrid(view) && view !== 'search') return M1.openGrid(view, opts);
      store.ui.toast(`There is no ${view} page in this store; here is the homepage`, 'bad');
      return openPage(homeKey(), { event: opts.event });
    };
    LANES.routes.search = (r, opts = {}) => M1.openSearch(r && r.q, opts);
    store.nav.onRoute((r) => { closeMenus(); M1.markNav(r && (r.view || (r.name === 'search' ? 'search' : r.name))); });
    Object.assign(LANES.render, { hero: renderHero, 'category-rail': renderTiles, deals: renderDeals, continue: renderContinue, 'grid-promo': renderGridPromo });
    Object.assign(LANES.verbs, { freshVisitor: () => freshVisitor(), p1Mark: () => mark(), p1Windows: () => windows(), p1PageWindows: () => pageWindows(), p1Pin: () => pin(), p1ClockJump: (a) => clockJump(a),
      p1Changes: () => { openChanges(); panels.note('opened', 'What changed in the meantime', 'the shopper’s shortlist, read off the documents in force'); },
      p1AfterChanges: () => director.sayAfter(), p1Contrast: () => contrastNow() });
    LANES.controls.push(control);
    LANES.compareTools.push(['fresh', 'Fresh visitor', () => { void freshVisitor().catch(() => { /* said on the status line */ }); }]);
    LANES.beforeBeat.push((b) => {
      S.lead = null; closeMenus();
      if (state.sheet && state.sheet.kind === 'changes') sheets.dismiss();
      if (b && b.data && b.data.arrives) Object.assign(S, { pageWin: null, contrast: null, contrastAsk: null, mark: null, windows: null, held: null, pin: null, clock: null, returned: false,
        home: { set: null, slots: {}, heroWas: null, heroPrev: null, rail: { status: 'site', order: null, items: null, regional: null, prevOrder: null } },
        grid: freshGrid(), grids: {}, search: { q: '', matches: [] } });   // a new arrival starts the walk again: her filters, her sorts and her space too
    });
    LANES.facts.p1 = facts;
    Object.assign(LANES.hooks, { regionalDriver, why, snapshot: snap });
    Object.assign(LANES.rows, homeRows());
    LANES.boot.push(async (entry) => {
      await data();
      ensureChrome();
      Object.assign(LANES.rows, homeRows());
      if (entry !== 'home' || transport.cur()) { for (const rail of railsOf(homeKey())) void paintRail(rail); return; }   // the other shells boot themselves
      // The boot page is the published template: the page a stranger sees, before anyone arrives. No visitor is minted on
      // load; the first click (store.visitor.ensure, through the store's dispatcher) or the director's first press brings one.
      const r = store.nav.parse(location.pathname + location.search) || { name: 'home' };
      try {
        if (r.name === 'grid' && isGrid(r.view) && r.view !== 'search') {
          showView(r.view);
          if (r.view === GRID) { S.tpl = true; try { for (const s of slotsOf(GRID)) renderSlot(s, M1.template(s)); } finally { S.tpl = false; } }
          await paintRail(gridRail(r.view));
          M1.markNav(r.view);
          say(`ready · the ${GRIDS[r.view].title} grid in the site’s own order, nothing decided yet: the first click brings a visitor; Next starts the walkthrough`, 'good');
        } else if (r.name === 'search') {
          M1.setSearch(r.q);
          showView('search');
          await paintRail(gridRail('search'));
          M1.markNav('search');
          say('ready · the search results in the site’s own order, nothing decided yet: the first click brings a visitor; Next starts the walkthrough', 'good');
        } else {
          await M1.paintTemplate(HOME);
          say('ready · the published template: the opening catalog in each slot’s own order, nothing decided yet; the first click brings a visitor; Next starts the walkthrough', 'good');
        }
      } catch (error) { say(String(error.message || error), 'bad'); }
    });
    M1.shell();                                       // the store's header, pencil banner and footer at once, on every shell
    pagersWire();                                     // the carousels' pagers and the hero's play control (no event, no visitor)
    return { paintRail, homeRows, freshVisitor, state: S };
  })();
  /** The before/now rows of the homepage (P2's merge, rows: () => ({ ...homeRows(), ...productRows() }), reads this). */
  function homeRows() { return P1.homeRows(); }

  // ── product pages (P2) ────────────────────────────────────────────────────
  // The product page in lg.com's anatomy, for the TV, the washer, the range and every other product on one template
  // (docs/lg/OH-Demo-Design.md §9.3). Lane P2 wrote it; lane M2 rebuilt it as a working page. M2 writes here (and the
  // facts it owns).
  //
  // The page, top to bottom, as lg.com's product pages run (docs/lg/research/lg-site-recon.md §3). The view is one
  // template (productViewHtml): product.html carries it, and index.html and m.html get it the first time a product
  // page opens there (ensureProductChrome), so a beat that walks from the homepage paints the same page.
  //   the breadcrumb    Home / the room's grid / the kind / the SKU.
  //   the buy bar       #buyBox, OFF LIMITS to the engine: the title, the SKU and the stars, the price block, the
  //                     financing line as the site shows it, Add to Cart, Notify Me or Find a Retailer as the feed says,
  //                     and Special Offers. The catalog's, the same for everyone, nothing decided inside. Its twin, one
  //                     row (the title and SKU, the price, the financing line, the button), sticks with the tabs at the
  //                     top once the bar has scrolled away: about 100 px together, as lg.com's title bar and tabs (M2b).
  //   the tabs          Overview, Specifications, Features, Reviews, Q&A: each scrolls to its section.
  //   the gallery       the product's pictures as the data has them (picturesOf: D2b's gallery in img/index.json, two
  //                     for most products, one for some; never an invented one), else its name on a neutral tile and
  //                     no thumbnail; a thumbnail column at the picture's left at a desk and a row under it on
  //                     a phone, as lg.com's; a thumbnail shows its picture; the feed's badges; the heart, which
  //                     sends wishlist_add.
  //   on a phone        lg.com's phone order: the crumbs, the tabs, the title block, then the gallery; the price and the
  //                     two buttons dock to the foot of the screen (M2b; the styles are oh.css's).
  //   the offer carousel pdp-offers, DECIDED (take 2), in the engine's order, each card with its receipt. It sits under
  //                     the gallery, not at the head of the buy column, so nothing decided sits near the financing line.
  //   the buy column    static, the catalog's, the same for everyone: key features; delivery and pickup for her real
  //                     region; the size or colour tiles (the feed's variants: a press sends select, then opens that
  //                     variant); a package's members; the services (protection, set-up or installation, haul-away) at
  //                     the prices lg.com lists; "Review your selections" totalling them, with Add to Cart (the store's
  //                     cart: the options, the services and the decisions on the page; then the cart drawer) and Find
  //                     a Retailer (the store's modal: buy directly first, then the two outcomes).
  //   the type switch   static: this kind's other types, each its type's best seller at this price tier (the site's rule).
  //   pdp-modules       DECIDED, in the order the engine returned: companions (the merchandiser's relation in
  //                     products.json, shown as a rule), packages, protection, installation, haul-away, the comparisons,
  //                     the tools, where-to-buy (P3's body). Every module carries its receipt, with E1's completes line
  //                     when the engine preferred it because it completes this product. A module the last page of the
  //                     same room showed, whose rule does not serve this product, is shown withdrawn with its reason,
  //                     and is not decided.
  //   the specs         static: the feed and D2's specs.json merged by sku, in groups; the fit tool here when the engine
  //                     did not decide it on this page. Then the features, the reviews (the feed's rating and count)
  //                     and the questions, static.
  // The page asks through the kit's context hook (transport.ask(key, v, { context })): ctx.anchor = the sku and
  // ctx.family = the row's family, and ctx.fit = her declared width once she has entered one. It never ranks: the
  // modules come in the engine's order, the products inside every module in POST /sort's order (one call per page
  // view), and her declared width filters, labelled declared, never inferred. Its styles, the pdp-, bb-, pmod, ptile,
  // fit- and cmp2 families in OH's tokens, live in oh.css (M1's), where M1 appended both of the page's blocks verbatim.

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
  const FINANCING = { seen: { OLED65C6PUA: '0% APR or as low as $83/mo with Affirm' }, cart: 'Pay over time with Affirm at checkout' };
  /**
   * The feed's badges that name a catalog offer: shown only while that offer is in force in the catalog the page last
   * read (a closed window takes its badge off the gallery too), the same for everyone. A badge naming another brand's
   * programme is said plainly or left off, since OH sells the products and is not LG.
   */
  const BADGE_OFFER = [[/NFL Shop eGift/i, 'offer-tv-gift-card'], [/Savings with Select TVs/i, 'offer-soundbar-with-tv'], [/Free Xbox Controller/i, 'deal-xbox-controller'], [/EXTRA \$100 WITH CODE/i, 'deal-wash1000']];
  const BADGE_WORDS = { 'LG.com Exclusive': 'Online exclusive', 'LG Online Exclusive': 'Online exclusive', '5% Back MyLG Rewards': null };
  /**
   * The services lg.com sells beside a product, at the prices its product pages list them (seen 2026-10-02 on the
   * OLED65C6PUA, WM6500HWA and LSGL6335X pages): one option per group or none, chosen by her, never decided. A price
   * is [now, was]; `freeWith` names the catalog offer that makes it free while that offer's window is open in the
   * catalog in force (the C6's free wall mounting), the same for everyone.
   */
  const P2_SERVICES = {
    tv: { seen: 'OLED65C6PUA', groups: [
      { id: 'protection', title: 'Premium Care by Asurion', short: 'Premium Care', note: 'Adds to the manufacturer’s limited warranty. Not available in Florida.',
        opts: [['care-1y', '1-Year Additional Protection', 129.99, null], ['care-2y', '2-Year Additional Protection', 179.99, null], ['care-3y', '3-Year Additional Protection', 249.99, null]] },
      { id: 'setup', title: 'Add TV Setup', short: 'TV setup', note: 'Wall mounting is by Angi; the mount itself is sold separately unless the TV includes one.',
        opts: [['setup-stand', 'TV Stand Setup', 0, null], ['setup-wall', 'Wall Mounting by Angi', 164.99, null, 'offer-tv-free-mounting']] },
    ] },
    laundry: { seen: 'WM6500HWA', groups: [
      { id: 'protection', title: 'Premium Care by Asurion', short: 'Premium Care', note: 'Adds to the manufacturer’s limited warranty. Not available in Florida.',
        opts: [['care-1y', '1-Year Additional Protection', 9.99, 64.99], ['care-2y', '2-Year Additional Protection', 39.99, 94.99], ['care-3y', '3-Year Additional Protection', 69.99, 124.99]] },
      { id: 'install', title: 'Add Professional Installation', short: 'Installation', note: 'Hook-up and levelling by a professional installer; we contact you to schedule it.',
        opts: [['install', 'Install Appliance', 29.99, null]] },
      { id: 'haul', title: 'Add Haul Away or Move', short: 'Haul away or move', note: 'We take the old one away, or move it to another room.',
        opts: [['haul-away', 'Haul Away', 25, 50], ['move-rooms', 'Move Rooms', 25, null]] },
    ] },
    kitchen: { seen: 'LSGL6335X', groups: [
      { id: 'protection', title: 'Premium Care by Asurion', short: 'Premium Care', note: 'Adds to the manufacturer’s limited warranty. Not available in Florida.',
        opts: [['care-1y', '1-Year Additional Protection', 9.99, 89.99], ['care-2y', '2-Year Additional Protection', 39.99, 119.99], ['care-3y', '3-Year Additional Protection', 69.99, 149.99]] },
      { id: 'install', title: 'Add Professional Installation', short: 'Installation', note: 'Hard-wiring, water-line extensions and propane conversion are not included.',
        opts: [['install', 'Install Appliance', 69.99, null]] },
      { id: 'haul', title: 'Add Haul Away or Move', short: 'Haul away or move', note: 'We take the old one away, or move it to another room.',
        opts: [['haul-away', 'Haul Away', 25, 50], ['move-rooms', 'Move Rooms', 25, null]] },
    ] },
  };
  /** Which services a category is sold with (a category with none shows none). */
  const SERVICES_OF = { tvs: 'tv', washers: 'laundry', dryers: 'laundry', washtowers: 'laundry', 'washer-dryer-combos': 'laundry', ranges: 'kitchen', dishwashers: 'kitchen', microwaves: 'kitchen' };
  /** The feed's feature tags as the product pages name them. */
  const FEATURE_WORDS = { 'bright-room': 'Made for bright rooms', 'smart-thinq': 'ThinQ smart features', 'gallery-frame': 'Gallery design, frame-style', 'mini-led': 'Mini LED backlight',
    'wireless-av': 'Wireless audio and video', 'mount-included': 'Wall mount included', 'gaming-165hz': '165Hz refresh rate for gaming', 'g-sync': 'NVIDIA G-SYNC compatible',
    'dolby-vision': 'Dolby Vision', 'dolby-atmos': 'Dolby Atmos', 'filmmaker-mode': 'FILMMAKER MODE', 'brightness-booster': 'Brightness Booster', flexconnect: 'Dolby Atmos FlexConnect',
    'dolby-audio': 'Dolby Audio', 'rear-speakers': 'Rear speakers included', 'wireless-subwoofer': 'Wireless subwoofer', 'designed-for-qned': 'Designed for QNED TVs', slim: 'Slim design',
    turbowash: 'TurboWash', 'ai-dd': 'AI DD built-in intelligence', 'energy-star': 'ENERGY STAR certified', ezdispense: 'ezDispense', steam: 'Steam', agitator: 'Agitator',
    turbodrum: 'TurboDrum', 'sensor-dry': 'Sensor Dry', easyunload: 'EasyUnload', impeller: 'Impeller', allergiene: 'Allergiene cycle', 'easyload-door': 'EasyLoad door', compact: 'Compact size',
    'heat-pump': 'Heat pump drying', ventless: 'Ventless', 'center-control': 'Center control', 'probake-convection': 'ProBake Convection', convection: 'Convection', easyclean: 'EasyClean',
    'double-oven': 'Double oven', 'air-fry': 'Air Fry', instaview: 'InstaView', 'air-sous-vide': 'Air Sous Vide', 'ai-camera': 'AI camera', extendavent: 'ExtendaVent', quadwash: 'QuadWash',
    'dynamic-dry': 'Dynamic Dry', flushfit: 'FlushFit', 'autovent-dry': 'AutoVent Dry', 'quadwash-pro': 'QuadWash Pro', 'one-hour-wash': 'One-hour wash and dry', quiet: 'Quiet operation',
    truesteam: 'TrueSteam', 'third-rack': 'Third rack', 'panel-ready': 'Panel ready', 'counter-depth': 'Counter depth', 'door-in-door': 'Door-in-Door', 'craft-ice': 'Craft Ice' };
  /** The tabs, and the section each scrolls to. */
  const P2_TABS = [['overview', 'Overview', 'pdpTop'], ['specs', 'Specifications', 'pdpSpecs'], ['features', 'Features', 'pdpFeatures'], ['reviews', 'Reviews', 'pdpReviews'], ['qa', 'Q&A', 'pdpQa']];
  /** The decided modules' heading, by room: lg.com's "Complete Your Laundry Room". */
  const ROOM_HEAD = { 'living-room': 'Complete your living room', 'laundry-room': 'Complete your laundry room', kitchen: 'Complete your kitchen' };
  /** The room grid a breadcrumb goes to (the store's routes: /oh/?view=…). */
  const ROOM_GRID = { 'living-room': ['tvs', 'TV & Audio'], 'laundry-room': ['laundry', 'Laundry'], kitchen: ['kitchen', 'Kitchen'] };
  /** The merchandiser's relation behind each companion module, and the rule as the card states it. */
  const P2_REL = {
    'mod-laundry-dryer': ['dryers', (p) => `a washer goes with the dryers of its own series${p.modelFamily ? ` (${p.modelFamily})` : ''}, in gas, electric or heat pump`],
    'mod-laundry-washer': ['washers', (p) => `a dryer goes with the washers of its own series${p.modelFamily ? ` (${p.modelFamily})` : ''}`],
    'mod-laundry-pedestal': ['pedestals', () => 'front-load pairs only: the storage drawer and the SideKick pedestal washer in the same colour'],
    'mod-laundry-stacking': ['stackingKits', () => 'front-load pairs only: the stacking kit the product page names'],
    'mod-laundry-pair-price': ['sets', () => 'the laundry sets this machine belongs to, with the set price beside its pieces’ sum when that sum is known'],
    'mod-tv-soundbar': ['soundbars', (p) => `a TV goes with soundbars from its series’ tier${p.seriesTier ? ` (${p.seriesTier})` : ''}${p.attributes && p.attributes.type === 'qned' ? '; a QNED leads with the soundbar designed for QNED' : ''}`],
    'mod-tv-mount': ['mounts', (p) => (p.vesa ? `a wall mount that lists this TV’s VESA pattern, ${String(p.vesa).replace('x', ' x ')} mm` : 'a wall mount that lists the TV’s VESA pattern; this TV’s pattern is not in our data')],
    'mod-range-microwave': ['microwaves', () => 'the over-the-range microwave packaged with this range first, then the same finish'],
    'mod-range-dishwasher': ['dishwashers', () => 'the dishwasher packaged with it first, then the same finish family'],
    'mod-kitchen-range': ['ranges', () => 'the range packaged with it first, then the same finish family'],
  };
  /** The categories whose products a declared width can rule out (machines that stand in a space). */
  const FIT_CATEGORIES = new Set(['washers', 'dryers', 'washtowers', 'washer-dryer-combos', 'ranges', 'dishwashers']);
  const FIT_CHIPS = { 'laundry-room': [24, 27, 28, 30, 32], kitchen: [24, 30, 33, 36] };
  /** The families that are parts of a room rather than its machines: never a type to switch to. */
  const PART_FAMILIES = new Set(['pedestal-washer', 'pedestal', 'stacking-kit', 'tv-mount', 'refrigerator']);
  const P2 = { docs: null, display: new Map(), images: new Map(), sort: null, last: null, prevRoom: null, gone: [], sizeUp: null,
    rows: { 'pdp-modules': {}, 'pdp-offers': {} },
    // Her choices in the buy column (the services, one per group), kept across a size or colour of the same kind; her wishlist.
    sel: { sku: null, kind: null, picks: {} }, wished: new Set(),
    // The gallery: the product it shows, its pictures and the one in the main frame; the stuck twin's last measured height.
    pics: { sku: null, list: [], at: 0 }, twinH: 0 };

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
  function imageHtml(p, size = 120, eager = false) {
    const name = nameOf(p);
    const tile = `<span class="ph-tile" role="img" aria-label="${esc(name)}">${esc(name)}</span>`;
    if (!p) return tile;
    const entry = P2.images.get(idOf(p));
    const own = entry && entry.verdict === 'accept' && entry.src ? entry.src : null;
    const feed = !own && p.image && !/placeholder/.test(String(p.image)) ? p.image : null;
    const src = own || feed;
    return src ? `<img src="${esc(src)}" alt="${esc(name)}" width="${size}" height="${size}" ${eager ? 'decoding="async"' : 'loading="lazy"'} data-p2ph="${esc(tile)}">` : tile;
  }
  /**
   * The product's pictures, as the data has them, for the gallery. D2b's `gallery` in img/index.json, in its order, where
   * the row carries one: the first is the row's `src`, the second (where D2b found one) `<id>-2.webp`; two for 549
   * products, one for 42, none for the 11 placeholders, which keep today's placeholder in the main frame and draw no
   * thumbnail. D2's 840-pixel rendition goes in the first picture's srcset only (the second has none). A row without the
   * field: D2's accepted file, else the feed's own link. Never an invented picture, and never the feed's link beside
   * D2's files: for most TVs and some appliances it names another LG gallery picture that D2's gate never checked.
   */
  function picturesOf(p) {
    if (!p) return [];
    const entry = P2.images.get(idOf(p));
    if (entry && Array.isArray(entry.gallery)) {
      const big = entry.large && (entry.large.webp || entry.large.png || entry.large.jpg);
      return entry.gallery.filter(Boolean).map((src, i) => ({ src: String(src),
        srcset: i === 0 && big && src === entry.src ? `${src} ${Number(entry.size) || 420}w, ${big} ${Number(entry.large.size) || 840}w` : null }));
    }
    if (entry && entry.verdict === 'accept' && entry.src) {
      const big = entry.large && (entry.large.webp || entry.large.png || entry.large.jpg);
      return [{ src: String(entry.src), srcset: big ? `${entry.src} ${Number(entry.size) || 420}w, ${big} ${Number(entry.large.size) || 840}w` : null }];
    }
    const feed = p.image && !/placeholder/.test(String(p.image)) ? String(p.image) : null;
    return feed ? [{ src: feed, srcset: null }] : [];
  }
  /** One picture as the gallery draws it: the main frame (named, sharp where a larger rendition exists) or a thumbnail (its button names it). */
  function pictureHtml(pic, p, main) {
    const name = nameOf(p), size = main ? 560 : 96;
    const tile = `<span class="ph-tile" role="img" aria-label="${esc(name)}">${esc(name)}</span>`;
    return `<img src="${esc(pic.src)}"${main && pic.srcset ? ` srcset="${esc(pic.srcset)}" sizes="(max-width: 900px) 92vw, 560px"` : ''} alt="${main ? esc(name) : ''}" width="${size}" height="${size}" decoding="async" data-p2ph="${esc(tile)}">`;
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

  // ── The view, one template in every shell ──────────────────────────────────
  /** A before/now strip for a decided slot (the kit's deltas.js fills it). */
  const changesHtml = (slot) => `<section class="changes" id="changes-${slot}" aria-live="polite"><div class="changes-before"><span class="changes-cap">What was on screen before this press</span>`
    + `<ol class="ordlist" id="before-${slot}"><li class="ghost-empty">No product page had been opened yet.</li></ol></div>`
    + `<div class="changes-what"><span class="changes-cap">What changed</span><ul class="deltas" id="deltas-${slot}"><li class="delta-none">Open a product to begin.</li></ul></div></section>`;
  /** The product view's markup, top to bottom (product.html carries the same; ensureProductChrome puts it in any other shell). */
  function productViewHtml() {
    return '<p class="offlimits-note"><b>Off limits</b> the buy bar, the sizes and colours, the services and the selections total: never decided, never personalised</p>'
      + '<nav class="crumbs pdp-crumbs" id="crumbs-product" aria-label="Breadcrumb"></nav>'
      + '<section class="buybox pdp-bar" id="buyBox" aria-label="Buy box"></section>'
      + '<div class="pdp-stick" id="pdpStick"><div class="pdp-stick-bar" id="pdpStickBar"></div>'
      + `<nav class="pdp-tabs" id="pdpTabs" aria-label="On this page">${P2_TABS.map(([k, label, to], i) => `<button type="button" data-act="pdp-tab" data-to="${to}" data-ctl="tab-${k}" aria-current="${i === 0}">${esc(label)}</button>`).join('')}</nav></div>`
      + '<div class="pdp-top" id="pdpTop"><div class="pdp-left"><div class="pdp-gallery static" id="pdpGallery" aria-label="Gallery"></div>'
      + '<section class="module decided pdp-offers" id="mod-pdp-offers" data-slot="pdp-offers" aria-labelledby="head-pdp-offers"><header class="module-head"><div>'
      + '<p class="module-where">slot <b>pdp-offers</b> &middot; take 2 &middot; decided per visitor</p><h2 id="head-pdp-offers">Special offers</h2></div>'
      + '<div class="pdp-onav"><button type="button" class="pdp-oarrow" data-act="pdp-offers-nav" data-dir="-1" data-ctl="offers-prev" aria-label="Previous offer">&lsaquo;</button>'
      + '<span id="pdpOcount">0 / 0</span><button type="button" class="pdp-oarrow" data-act="pdp-offers-nav" data-dir="1" data-ctl="offers-next" aria-label="Next offer">&rsaquo;</button></div></header>'
      + `${changesHtml('pdp-offers')}<div class="pdp-otrack" id="slot-pdp-offers" aria-live="polite"><p class="slot-wait">Not asked yet.</p></div><p class="engine-down" id="down-pdp-offers" hidden></p></section></div>`
      + '<div class="pdp-config static" id="pdpConfig" aria-label="Choose and buy"></div></div>'
      + '<nav class="pdp-type" id="pdpType" aria-label="Other types" hidden></nav>'
      + '<section class="module decided" id="mod-pdp-modules" data-slot="pdp-modules" aria-labelledby="head-pdp-modules"><header class="module-head"><div>'
      + '<p class="module-where">slot <b>pdp-modules</b> &middot; take 6 &middot; decided per visitor</p><h2 id="head-pdp-modules">Goes with it</h2></div></header>'
      + `${changesHtml('pdp-modules')}<div class="cards cards--many pdp-mods" id="slot-pdp-modules" aria-live="polite"><p class="slot-wait">Not asked yet.</p></div>`
      + '<div class="pdp-gone" id="pdpGone" aria-live="polite"></div><p class="engine-down" id="down-pdp-modules" hidden></p></section>'
      + '<section class="pdp-specs pdp-sec static" id="pdpSpecs" aria-label="Specifications"></section>'
      + '<section class="pdp-sec static" id="pdpFeatures" aria-label="Features"></section>'
      + '<section class="pdp-sec static" id="pdpReviews" aria-label="Reviews"></section>'
      + '<section class="pdp-sec static" id="pdpQa" aria-label="Questions and answers"></section>';
  }
  /** The chrome a product page needs, made once in whichever shell it opens: the template and the sticky bar (its styles are oh.css's). */
  function ensureProductChrome() {
    const view = $('view-product');
    if (!view) return;
    if (!$('pdpTop')) view.innerHTML = productViewHtml();   // index.html and m.html carry the earlier anatomy: one template everywhere
    wireStick();
    const track = $('slot-pdp-offers');
    if (track && !track.dataset.p2) { track.dataset.p2 = '1'; track.addEventListener('scroll', () => syncOffers(), { passive: true }); }
  }
  /**
   * Where the sticky row sits: under the header while the header is on screen and sticks (or is fixed), else at the top.
   * The header scrolls away at every width now (M1e, as lg.com's), so the row sits at 0 and the stack is the row alone;
   * a header that sticks or hides itself on scroll is read where it is, never assumed.
   */
  function stickTop() {
    const head = document.querySelector('#site .site-header');
    const pos = head ? getComputedStyle(head).position : '';
    const top = pos === 'sticky' || pos === 'fixed' ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 0;
    const view = $('view-product');
    if (view && view.style.getPropertyValue('--pdp-stick-top') !== `${top}px`) view.style.setProperty('--pdp-stick-top', `${top}px`);
    return top;
  }
  /**
   * A section's own box: at a phone's width the overview's wrapper lays out its children directly (display: contents),
   * and the title block comes first there (lg.com's phone order), so the buy bar's box stands for the overview.
   */
  function boxOf(id) {
    let n = $(id);
    if (id === 'pdpTop' && n && !n.getClientRects().length && $('buyBox') && $('buyBox').getClientRects().length) return $('buyBox');
    while (n && !n.getClientRects().length && n.firstElementChild) n = n.firstElementChild;
    return n;
  }
  /** The tab of the section in view (the last section whose top has passed the sticky row), marked current. */
  function spyTabs() {
    const view = $('view-product');
    if (!view || view.hidden) return;
    const line = stickTop() + (($('pdpStick') || {}).offsetHeight || 0) + 24;
    let at = P2_TABS[0][2];
    for (const [, , to] of P2_TABS) { const n = boxOf(to); if (n && n.getBoundingClientRect().top <= line) at = to; }
    for (const b of document.querySelectorAll('#pdpTabs [data-to]')) { const on = String(b.dataset.to === at); if (b.getAttribute('aria-current') !== on) b.setAttribute('aria-current', on); }
  }
  /** The twin shows once the buy bar has scrolled up under the header, never beside it; the tabs follow the reader. */
  function wireStick() {
    const bar = $('buyBox'), stick = $('pdpStick');
    if (!bar || !stick || bar.dataset.p2stick) return;
    bar.dataset.p2stick = '1';
    const stuck = () => {
      const view = $('view-product');
      const on = Boolean(view && !view.hidden && bar.getBoundingClientRect().bottom < stickTop() + 1);
      if (stick.classList.contains('is-stuck') !== on) stick.classList.toggle('is-stuck', on);
      // The twin's height, measured while it shows: the tabs and the sections land under the whole stuck row (M2b).
      const twin = $('pdpStickBar');
      if (on && twin && twin.offsetHeight) P2.twinH = twin.offsetHeight;
      const full = stick.offsetHeight + (on ? 0 : twinHeight());
      // The gallery column stays in view beside a longer buy column, as lg.com's does, when it fits under the sticky row.
      const left = document.querySelector('#view-product .pdp-left');
      if (view && left) {
        if (view.style.getPropertyValue('--pdp-stick-h') !== `${full}px`) view.style.setProperty('--pdp-stick-h', `${full}px`);
        const fits = window.innerWidth > 900 && left.offsetHeight + stickTop() + full + 32 <= window.innerHeight;
        if (left.classList.contains('is-pinned') !== fits) left.classList.toggle('is-pinned', fits);
      }
    };
    let queued = false;
    const tick = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; stuck(); spyTabs(); }); };
    window.addEventListener('scroll', tick, { passive: true });
    window.addEventListener('resize', tick, { passive: true });
    tick();
  }
  /** The twin's height once it shows (it shows at a desk only): its last measure, else the one row oh.css gives it. */
  function twinHeight() {
    if (window.innerWidth <= 900 || document.body.classList.contains('shell--phone')) return 0;
    return P2.twinH || 57;
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
  /** What the feed says the button is: Add to Cart (sold here, in stock, priced), Notify Me (sold here, out of stock), else Find a Retailer. */
  function ctaOf(p) {
    if (!p) return null;
    if (p.cta === 'cart' && priceOf(p) != null) return p.inStock === false ? 'notify' : 'cart';
    return 'retailer';
  }
  /** The button, as the buy bar ('bar', #bbAdd), its sticky twin ('stick') or the selections total ('review') shows it. */
  function ctaHtml(p, where) {
    const kind = ctaOf(p);
    const id = where === 'bar' ? ' id="bbAdd"' : '';
    const ctl = (name) => (where === 'bar' ? name : `${where}-${name}`);
    if (kind === 'cart') return `<button type="button" class="btn btn--brand"${id} data-act="pdp-add" data-ctl="${ctl('add-to-cart')}">Add to Cart</button>`;
    if (kind === 'notify') return `<button type="button" class="btn btn--brand"${id} data-act="pdp-notify" data-ctl="${ctl('notify-me')}" title="Out of stock here today">Notify Me</button>`;
    return kind ? `<button type="button" class="btn btn--brand"${id} data-act="store-retailers" data-sku="${esc(idOf(p))}" data-ctl="${ctl('find-retailer')}">Find a Retailer</button>` : '';
  }
  /** The price block: the sale price, "$X OFF" in the brand colour, the struck list price; or the retailer's when there is none of ours. */
  function priceHtml(p) {
    const price = priceOf(p), list = p && Number(p.listPrice);
    if (price == null) return '<span class="bb-retail">Price at the retailer</span>';
    const was = Number.isFinite(list) && list > Number(price) ? list : null;
    return `<span class="bb-now">${money(price)}</span>${was ? `<span class="off">${money(was - Number(price))} OFF</span><s class="was">${money(was)}</s>` : ''}`;
  }
  /** The financing line as the site shows it: on products sold here, never computed, never personalised. */
  const financingOf = (p) => (ctaOf(p) === 'cart' ? (FINANCING.seen[idOf(p)] || FINANCING.cart) : null);
  const finHtml = (fin, id) => `<p class="bb-fin"${id ? ` id="${id}"` : ''}><span>${esc(fin)}</span><span class="nper">not personalised</span></p>`;
  /** The feed's rating as stars and its count; a press goes to the reviews. */
  function starsHtml(p, opts = {}) {
    const r = p ? Number(p.rating) : 0, n = p ? Number(p.reviews || 0) : 0;
    if (!(r > 0)) return '';
    const pct = `${Math.max(0, Math.min(100, (r / 5) * 100)).toFixed(0)}%`;
    const said = `${r} out of 5${n ? `, ${n.toLocaleString('en-US')} reviews` : ''}`;
    const inner = `<i style="--pct:${pct}" aria-hidden="true">★★★★★</i><span>${esc(r.toFixed(1))}</span>${n ? `<em>(${n.toLocaleString('en-US')})</em>` : ''}`;
    return opts.still ? `<span class="pdp-stars" aria-label="${esc(said)}">${inner}</span>`
      : `<button type="button" class="pdp-stars" data-act="pdp-tab" data-to="pdpReviews" data-ctl="${esc(opts.ctl || 'stars')}" aria-label="${esc(said)}: read the reviews">${inner}</button>`;
  }
  /** Home / the room's grid / the kind / the SKU: the store's routes, so the browser's Back returns. */
  function crumbsHtml(p) {
    const home = '<button type="button" data-nav="home" data-ctl="crumb-home">Home</button>';
    if (!p) return home;
    const sep = '<span aria-hidden="true">/</span>';
    const [grid, label] = ROOM_GRID[attrOf(p, 'room')] || [null, capital(words(attrOf(p, 'room') || ''))];
    return `${home}${sep}${grid ? `<button type="button" data-nav="${esc(grid)}" data-ctl="crumb-${esc(grid)}">${esc(label)}</button>` : `<span>${esc(label)}</span>`}${sep}`
      + `<span>${esc(capital(familyWords(p.family)))}</span>${sep}<span aria-current="page">${esc(idOf(p))}</span>`;
  }
  /**
   * The buy bar: the buy box, off limits to the engine. The title, the SKU and the stars, the price block, the
   * financing line as the site shows it, the feed's button and Special Offers; its twin under the header carries
   * the same. Painted from the product row alone, the same for everyone.
   */
  function renderBuyBox(p) {
    ensureProductChrome();
    const box = $('buyBox');
    if (!box) return;
    const v = variantsOf(p), fin = financingOf(p);
    const crumbs = $('crumbs-product');
    if (crumbs) crumbs.innerHTML = crumbsHtml(p);
    box.innerHTML = `<div class="bb-head"><h1 class="bb-title" id="bbTitle">${esc(titleOfProduct(p))}</h1>`
      + `<p class="bb-meta" id="bbMeta"><span class="bb-sku">${esc(p ? idOf(p) : '')}</span>${starsHtml(p)}</p></div>`
      + `<div class="bb-dock"><div class="bb-pricebox"><div class="bb-price" id="bbPrice">${priceHtml(p)}</div>${fin ? finHtml(fin, 'bbFin') : ''}</div>`
      + `<div class="bb-actions">${ctaHtml(p, 'bar')}<button type="button" class="btn btn--line" data-act="pdp-tab" data-to="mod-pdp-offers" data-ctl="special-offers">Special Offers</button></div></div>`
      + `<p class="offlimits"><b>Off limits</b> the title, the price, the ${v.label === 'Size' ? 'sizes' : 'colours'}, the button and the financing line are the catalog’s, the same for everyone · never decided, never personalised</p>`;
    // The twin is one row (M2b): the title over the SKU, the price, the financing line, the button; the same facts, smaller.
    const twin = $('pdpStickBar');
    if (twin) {
      twin.innerHTML = `<div class="bb-head"><b class="bb-title">${esc(titleOfProduct(p))}</b><span class="bb-sku">${esc(p ? idOf(p) : '')}</span></div>`
        + `<div class="bb-price">${priceHtml(p)}</div>${fin ? finHtml(fin) : ''}<div class="bb-actions">${ctaHtml(p, 'stick')}</div>`;
    }
  }

  // ── The gallery: the product's image, the feed's badges, the heart ───────
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4s-7.6-4.6-7.6-10.3A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7.6 2.6c0 5.7-7.6 10.3-7.6 10.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  /** The feed's badges as the gallery shows them: an offer's badge only while the offer is in force; plain words for another's programme. */
  function galleryBadges(p) {
    return arr(p && p.badges).filter(Boolean).map((b) => (Object.prototype.hasOwnProperty.call(BADGE_WORDS, b) ? BADGE_WORDS[b] : b)).filter((b) => {
      if (!b) return false;
      const m = BADGE_OFFER.find(([re]) => re.test(b));
      return !m || (state.pieces.has(m[1]) && !catalogWhy(m[1]));
    });
  }
  /**
   * The gallery, as lg.com's (M2b): the picture in the main frame; a thumbnail for each of the product's pictures (a column
   * at the picture's left at a desk, a row under it on a phone; oh.css), the one shown pressed; the feed's badges; the
   * heart. A product with no picture shows today's placeholder and no thumbnail. A thumbnail press puts its picture in
   * the main frame (showPicture); the thumbnails are the gallery's controls, with no arrows beside them. The pictures are
   * the catalog's, the same for everyone; looking at one sends nothing.
   */
  function renderGallery(p) {
    const box = $('pdpGallery');
    if (!box) return;
    const badges = galleryBadges(p);
    const on = Boolean(p && P2.wished.has(idOf(p)));
    const list = picturesOf(p), sku = p ? idOf(p) : null;
    if (P2.pics.sku !== sku) P2.pics = { sku, list, at: 0 };
    else P2.pics.list = list;
    const at = Math.min(P2.pics.at, Math.max(0, list.length - 1));
    P2.pics.at = at;
    box.classList.toggle('pdp-gallery--bare', !list.length);
    const html = `<div class="pdp-gmain">${list.length ? pictureHtml(list[at], p, true) : imageHtml(p, 560, true)}</div>`
      + (list.length ? `<div class="pdp-gthumbs" role="group" aria-label="Pictures of the ${esc(nameOf(p))}">${list.map((pic, i) => `<button type="button" class="pdp-gthumb" data-act="pdp-thumb" data-i="${i}" data-ctl="thumb-${i + 1}" aria-pressed="${i === at}" aria-label="Picture ${i + 1} of ${list.length}">${pictureHtml(pic, p, false)}</button>`).join('')}</div>` : '')
      + (badges.length ? `<div class="pdp-gbadges">${badges.map((b) => `<span class="pdp-gbadge">${esc(b)}</span>`).join('')}</div>` : '')
      + (p ? `<button type="button" class="pdp-wish" data-act="pdp-wish" data-ctl="wishlist" aria-pressed="${on}" aria-label="${on ? 'Saved to your wishlist: remove it' : 'Save to your wishlist'}">${HEART}</button>` : '');
    // A repaint with nothing changed leaves the gallery's nodes alone: a press on the heart or a thumbnail that lands while
    // the page asks again (after Back, say) is never lost to its button being replaced between the press and the release.
    if (box.p2html === html && box.firstElementChild) return;
    box.innerHTML = html;
    box.p2html = html;
  }
  /** A thumbnail: its picture in the main frame, the thumbnail pressed. Looking at a picture is not a taste: nothing is sent. */
  function showPicture(i) {
    const p = productOf(state.productId), n = P2.pics.list.length, at = Math.trunc(Number(i));
    if (!p || !n || P2.pics.sku !== idOf(p) || !(at >= 0 && at < n)) return;
    const main = document.querySelector('#pdpGallery .pdp-gmain');
    if (main && at !== P2.pics.at) {
      const was = main.querySelector('img, .ph-tile');
      if (was) was.remove();
      main.insertAdjacentHTML('afterbegin', pictureHtml(P2.pics.list[at], p, true));
    }
    P2.pics.at = at;
    for (const b of document.querySelectorAll('#pdpGallery .pdp-gthumb')) b.setAttribute('aria-pressed', String(Number(b.dataset.i) === at));
  }

  // ── The buy column: static, the catalog's, the same for everyone ──────────
  const panelWords = (x) => words(x).replace(/\boled\b/gi, 'OLED').replace(/\bqned\b/gi, 'QNED').replace(/\bled\b/gi, 'LED').replace(/\bevo\b/gi, 'evo');
  /** The product's own facts as lg.com's key features read: its size or capacity, its type, the feed's feature tags, its finish. */
  function keyFeatures(p) {
    if (!p) return [];
    const out = [];
    if (Number(p.sizeInches) > 0) out.push(`${p.sizeInches}″ class screen${attrOf(p, 'panel') ? `, ${panelWords(attrOf(p, 'panel'))}` : ''}`);
    if (Number(p.capacityCuFt) > 0) out.push(`${p.capacityCuFt} cu. ft. capacity`);
    if (attrOf(p, 'type') && attrOf(p, 'category') !== 'tvs') out.push(`${typeWords(attrOf(p, 'type'))}${attrOf(p, 'fuel') ? `, ${words(attrOf(p, 'fuel'))}` : ''}`);
    for (const f of arr(attrOf(p, 'feature'))) out.push(FEATURE_WORDS[f] || capital(words(f)));
    if (attrOf(p, 'finish')) out.push(`${finishWords(attrOf(p, 'finish'))} finish`);
    if (p.modelYear) out.push(`${p.modelYear} model`);
    return out;
  }
  /** Her region as the request located it (the cold-start read): never asked for, never asserted here. */
  const regionLabel = () => { const o = state.own; return (o && (o.label || US[o.key] || o.key)) || null; };
  /** Three business days out, the delivery estimate the site shows for an in-stock item, the same for everyone. */
  function deliveryDate() {
    const d = new Date();
    for (let n = 0; n < 3;) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n += 1; }
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const offersPickupHere = (p) => arr(attrOf(p, 'retailer')).includes('best-buy-pickup') || Boolean(p && p.bestBuyPickup === true);
  const TRUCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6.5" cy="17" r="1.7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="17" r="1.7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  const STOREFRONT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.5 5 4.5h14l1.5 5M4.5 9.5v10h15v-10M3.5 9.5h17M9.5 19.5v-5h5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  function shipHtml(p) {
    const where = regionLabel();
    if (!where) shipLater();
    const head = `<h3>Shipping to ${where ? `<b>${esc(where)}</b>` : 'your area'}</h3>`;
    const kind = ctaOf(p);
    if (kind === 'retailer') {
      return `<section class="pdp-cfg pdp-ship" id="pdpShip">${head}<p class="pdp-fine">Sold through retailers: delivery and pickup are the retailer’s. Find a Retailer lists the stores that carry it, online and near you.</p>`
        + `<button type="button" class="pdp-link" data-act="store-retailers" data-sku="${esc(idOf(p))}" data-ctl="ship-find-retailer">Find a Retailer</button></section>`;
    }
    const pickup = offersPickupHere(p);
    return `<section class="pdp-cfg pdp-ship" id="pdpShip">${head}<div class="pdp-ship-grid">`
      + `<div><b>${TRUCK}Delivery</b>${kind === 'notify' ? '<span>Out of stock here today</span>' : `<span class="pdp-ok">Estimated delivery ${esc(deliveryDate())}</span><span class="pdp-fine">You can choose another date at checkout.</span>`}</div>`
      + `<div><b>${STOREFRONT}Pickup</b>${pickup ? '<span>Need it faster? Pick up at Best Buy as early as today</span>'
        + `<button type="button" class="pdp-link" data-act="store-retailers" data-sku="${esc(idOf(p))}" data-ctl="find-a-store">Find a Store</button>` : '<span class="pdp-fine">Store pickup is not offered for this model: delivered only.</span>'}</div>`
      + `</div><p class="pdp-fine">${where ? `${esc(where)}, read from your connection: never asked for, never stored here.` : 'Your region is read from your connection as the page loads.'} The same dates for everyone there.</p></section>`;
  }
  /** The region arrives with the cold-start read, a moment after a direct load: the shipping line is said again once it is in. */
  function shipLater(tries = 0) {
    if (P2.shipTimer) return;
    P2.shipTimer = setTimeout(() => {
      P2.shipTimer = null;
      const p = productOf(state.productId), node = $('pdpShip');
      if (!p || !node) return;
      if (regionLabel()) node.outerHTML = shipHtml(p);
      else if (tries < 20) shipLater(tries + 1);
    }, 600);
  }
  /** The size or colour tiles: the feed's variants with their own prices; a press sends select, then opens that variant. */
  function variantsHtml(p) {
    const v = variantsOf(p);
    if (v.list.length < 2) return '';
    const kind = v.label === 'Size' ? 'size' : 'colour';
    const on = v.list.find((x) => x.on);
    return `<section class="pdp-cfg" id="pdpVariants"><h3>${esc(v.label)}${on ? `: ${esc(on.label)}` : ''}</h3><div class="bb-vars" id="bbOpts">`
      + v.list.map((x) => {
        const q = productOf(x.sku), now = priceOf(q), list = q && Number(q.listPrice);
        const was = now != null && Number.isFinite(list) && list > Number(now) ? list : null;
        return `<button type="button" class="bb-var" data-act="pdp-variant" data-sku="${esc(x.sku)}" data-kind="${kind}" data-label="${esc(x.label)}" data-ctl="variant-${esc(x.sku)}" aria-pressed="${x.on}">`
          + `<b>${esc(x.label)}</b>${now != null ? `<span class="bb-var-now">${money(now)}</span>${was ? `<span class="bb-var-off">${money(was - Number(now))} OFF</span><s>${money(was)}</s>` : ''}` : '<span class="bb-var-now">Price at the retailer</span>'}</button>`;
      }).join('')
      + `</div><p class="pdp-fine">The ${kind === 'size' ? 'sizes of this series' : 'colours of this model'} at their own prices, the catalog’s: the same for everyone.</p></section>`;
  }
  /** A package's or a set's members, in its own order, each at its catalog price. */
  function p2MembersOf(p) {
    if (!p || !['kitchen-packages', 'laundry-sets'].includes(attrOf(p, 'category'))) return [];
    const own = arr(p.companions && p.companions.members);
    return (own.length ? own : String(idOf(p)).split('_')).map(String).filter((id) => id !== idOf(p) && productOf(id));
  }
  function membersHtml(p) {
    const list = p2MembersOf(p);
    if (!list.length) return '';
    return `<section class="pdp-cfg" id="pdpMembers"><h3>${list.length} products in this ${attrOf(p, 'category') === 'laundry-sets' ? 'set' : 'package'}</h3>`
      + `<div class="ptiles">${list.map((id) => tileHtml(productOf(id), finishWords(attrOf(productOf(id), 'finish')) || '')).join('')}</div>`
      + '<p class="pdp-fine">In the package’s own order, each at its catalog price.</p></section>';
  }
  /** The services this product is sold with (the category's), only where it is sold here. */
  const servicesFor = (p) => (ctaOf(p) === 'cart' ? P2_SERVICES[SERVICES_OF[attrOf(p, 'category')]] || null : null);
  /** A catalog offer in force for this product: the document the page last read holds it open and its family rule admits the product. */
  function offerOpen(cid, p) {
    const piece = state.pieces.get(cid);
    if (!piece || !p) return false;
    const fams = piece.eligibleWhen && piece.eligibleWhen.context && piece.eligibleWhen.context.family;
    if (Array.isArray(fams) && !fams.includes(p.family)) return false;
    return !catalogWhy(cid);
  }
  /** A service option at its price now: free while the catalog's own offer for it is open for this product, else as listed. */
  function serviceDeal(opt, p) {
    const [id, label, price, was, freeWith] = opt;
    if (freeWith && offerOpen(freeWith, p)) return { id, label, price: 0, was: price || null, free: true };
    return { id, label, price, was, free: price === 0 };
  }
  function servicesHtml(p) {
    const s = servicesFor(p);
    if (!s) return '';
    return s.groups.map((g) => `<section class="pdp-cfg pdp-svcgroup" data-group="${esc(g.id)}"><h3>${esc(g.title)}</h3><div class="pdp-svcs">${g.opts.map((o) => {
      const d = serviceDeal(o, p), on = P2.sel.picks[g.id] === d.id;
      return `<button type="button" class="pdp-svc" data-act="pdp-service" data-group="${esc(g.id)}" data-opt="${esc(d.id)}" data-ctl="service-${esc(d.id)}" aria-pressed="${on}">`
        + `<span class="pdp-svc-l">${esc(d.label)}</span><span class="pdp-svc-p">${d.free ? '<span class="pdp-free">FREE</span>' : money(d.price)}${d.was ? `<s>${money(d.was)}</s>` : ''}</span><i aria-hidden="true">${on ? '✓' : '+'}</i></button>`;
    }).join('')}</div><p class="pdp-fine">${esc(g.note)}</p></section>`).join('')
      + `<p class="pdp-fine">Service prices as listed publicly for the ${esc(s.seen)} on 2 October, the same for everyone; you choose them, nothing chooses them for you.</p>`;
  }
  /** Her chosen services, one per group, at their prices now. */
  function picksOf(p) {
    const s = servicesFor(p);
    if (!s) return [];
    return s.groups.map((g) => {
      const id = P2.sel.picks[g.id], o = id ? g.opts.find((x) => x[0] === id) : null;
      return o ? { group: g, ...serviceDeal(o, p) } : null;
    }).filter(Boolean);
  }
  /** The line's configuration, as the cart shows it: the size of a TV, else the colour. */
  function selectionOptions(p) {
    const v = variantsOf(p), on = v.list.find((x) => x.on);
    if (v.label === 'Size' && on) return { Size: on.label };
    return attrOf(p, 'finish') ? { Colour: finishWords(attrOf(p, 'finish')) } : {};
  }
  /** "Review your selections": the product and her services, the total, the savings, and the buttons. */
  function reviewHtml(p) {
    const kind = ctaOf(p), price = priceOf(p), list = Number(p.listPrice), picks = picksOf(p);
    const opts = Object.entries(selectionOptions(p)).map(([k, x]) => `${k} ${x}`).join(' · ');
    const lines = `<div class="pdp-rline"><span>${esc(titleOfProduct(p))}${opts ? ` · ${esc(opts)}` : ''}</span><b>${price != null ? money(price) : 'at the retailer'}</b></div>`
      + picks.map((x) => `<div class="pdp-rline pdp-rline--svc"><span>+ ${esc(x.group.short)}: ${esc(x.label)}</span><b>${x.free ? 'FREE' : money(x.price)}</b></div>`).join('');
    const find = `<button type="button" class="btn btn--line" data-act="store-retailers" data-sku="${esc(idOf(p))}" data-ctl="review-find-retailer">Find a Retailer</button>`;
    if (price == null || kind === 'retailer') return `<section class="pdp-review" id="pdpReview"><h3>Review your selections</h3>${lines}<div class="pdp-ractions">${ctaHtml(p, 'review')}</div></section>`;
    const total = Number(price) + picks.reduce((n, x) => n + Number(x.price || 0), 0);
    const saves = [Number.isFinite(list) && list > Number(price) ? list - Number(price) : 0, ...picks.map((x) => (x.was && x.was > x.price ? x.was - x.price : 0))].filter((n) => n > 0);
    const saved = saves.reduce((n, x) => n + x, 0);
    return `<section class="pdp-review" id="pdpReview"><h3>Review your selections</h3>${lines}`
      + `<div class="pdp-rtotal"><span>Selection total</span><b id="pdpTotal">${money(total)}</b></div>`
      + (saved > 0 ? `<div class="pdp-rsave"><span>Total savings (${saves.length})</span><b>${money(saved)}</b></div>` : '')
      + `<div class="pdp-ractions">${ctaHtml(p, 'review')}${find}</div></section>`;
  }
  /** The buy column, top to bottom. */
  function renderConfig(p) {
    const box = $('pdpConfig');
    if (!box) return;
    if (!p) { box.innerHTML = ''; return; }
    const feats = keyFeatures(p).slice(0, 6);
    box.innerHTML = (feats.length ? `<section class="pdp-cfg pdp-keyf"><h3>Key features</h3><ul>${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : '')
      + shipHtml(p) + variantsHtml(p) + membersHtml(p)
      + `<div id="pdpServices">${servicesHtml(p)}</div><div id="pdpReviewWrap">${reviewHtml(p)}</div>`
      + '<p class="pdp-cfgnote"><span class="nper">not personalised</span>Everything in this column is the catalog’s and the same for everyone: never decided. Your choices travel with the item into the cart.</p>';
  }
  /** Her services changed: the tiles and the total are painted again, nothing else. */
  function renderSelections(p) {
    const s = $('pdpServices'), r = $('pdpReviewWrap');
    if (s) s.innerHTML = servicesHtml(p);
    if (r) r.innerHTML = reviewHtml(p);
  }
  /** Her choices are kept across a size or colour of the same kind, and start empty on another product. */
  function keepSelections(p) {
    const kind = p ? `${attrOf(p, 'category')}|${attrOf(p, 'series') || p.modelFamily || idOf(p)}` : null;
    if (P2.sel.kind !== kind) P2.sel = { sku: p ? idOf(p) : null, kind, picks: {} };
    else P2.sel.sku = p ? idOf(p) : null;
  }

  // ── The features, the reviews, the questions: static ─────────────────────
  function renderFeatures(p) {
    const box = $('pdpFeatures');
    if (!box) return;
    const feats = keyFeatures(p);
    box.innerHTML = '<header class="pdp-sechead"><h2>Features</h2><span class="nper">not personalised</span></header>'
      + (feats.length ? `<div class="pdp-feats">${feats.map((f) => `<div class="pdp-feat">${esc(f)}</div>`).join('')}</div>` : '<p class="pdp-fine">The feed lists no features for this model.</p>');
  }
  function renderReviews(p) {
    const box = $('pdpReviews');
    if (!box) return;
    const r = p ? Number(p.rating) : 0, n = p ? Number(p.reviews || 0) : 0;
    box.innerHTML = '<header class="pdp-sechead"><h2>Reviews</h2><span class="nper">not personalised</span></header>'
      + (r > 0 ? `<div class="pdp-rev"><b class="pdp-rev-n">${esc(r.toFixed(1))}</b>${starsHtml(p, { still: true })}<span class="pdp-fine">out of 5, from ${n.toLocaleString('en-US')} review${n === 1 ? '' : 's'}</span></div>`
        + '<p class="pdp-fine">The rating and the count as the product page lists them on 1 October. Owners’ own words are not carried in this demo’s data, so none is shown.</p>'
        : '<p class="pdp-fine">No rating is listed for this model yet.</p>');
  }
  function renderQa(p) {
    const box = $('pdpQa');
    if (!box) return;
    box.innerHTML = '<header class="pdp-sechead"><h2>Questions &amp; answers</h2><span class="nper">not personalised</span></header>'
      + `<div class="pdp-qa-box"><b>Questions about the ${esc(p ? idOf(p) : 'product')}?</b><span>Owners’ questions and answers are not carried in this demo’s data. The specifications above answer the common ones, and Find a Retailer shows the stores that carry it near you.</span></div>`;
  }
  /** Everything static on the page, from the product row alone: the buy bar, the gallery, the buy column, the type switch, the sections. */
  function renderStatic(p) {
    keepSelections(p);
    renderBuyBox(p);
    renderGallery(p);
    renderConfig(p);
    renderTypeSwitch(p);
    renderFeatures(p);
    renderReviews(p);
    renderQa(p);
    const head = $('head-pdp-modules');
    if (head) head.textContent = (p && ROOM_HEAD[attrOf(p, 'room')]) || 'Goes with it';
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
  /**
   * The product page's context: its anchor and family, her declared width once she has entered one, and her declared
   * viewing distance on a TV page once she has given it (ctx.distance): declared, never inferred, never a product choice.
   */
  function askContext(p, v) {
    const fit = v && v.p2 && v.p2.fit;
    const distance = v && v.p2 && v.p2.distance && attrOf(p, 'category') === 'tvs' ? v.p2.distance : null;
    return { ...(productContext(p) || {}), ...(fit ? { fit: String(fit) } : {}), ...(distance ? { distance: String(distance) } : {}) };
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
    refreshDryerCard(p);   // her profile as it now stands: the dryer's lead names her fuel only when it holds one
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
  /** Her own fuel: the fuel value her profile carries most (the meters' own read), or null when it carries none. */
  function herFuel() {
    const vals = Object.entries(((state.lastVector || {}).fuel) || {}).filter(([, a]) => Number(a) > 0);
    return vals.length ? vals.reduce((best, x) => (Number(x[1]) > Number(best[1]) ? x : best))[0] : null;
  }
  /**
   * Why POST /sort put the first ahead of the second, read off its own items: by dimension, the first's contributions
   * less the second's, the largest gaps first (what the two share, such as their type or tier, separates nothing). With
   * no second, the first's own strongest drivers.
   */
  function leadReasons(first, second, n = 2) {
    const byDim = (x) => {
      const sum = new Map(), top = new Map();
      for (const d of arr(x && x.drivers)) {
        if (!d || !d.dim) continue;
        const c = Number(d.contribution) || 0;
        sum.set(d.dim, (sum.get(d.dim) || 0) + c);
        if (!top.has(d.dim) || c > (Number(top.get(d.dim).contribution) || 0)) top.set(d.dim, d);
      }
      return { sum, top };
    };
    const A = byDim(first), B = second ? byDim(second) : { sum: new Map() };
    const pool = [...A.sum.entries()].map(([dim, v]) => ({ ...A.top.get(dim), gap: v - (B.sum.get(dim) || 0) })).filter((x) => x.gap > 0.0005);
    const out = [];
    while (out.length < n && pool.length) {
      const best = pool.reduce((b, x) => (x.gap > b.gap ? x : b));
      out.push(best);
      pool.splice(pool.indexOf(best), 1);
    }
    return out;
  }
  /** A driver in the room's words: "sold here", "Best Buy pickup", "in the 4-piece laundry set". */
  function driverWords(x) {
    if (x.dim === 'retailer') return { 'lg-com': 'sold here', 'best-buy-pickup': 'Best Buy pickup', 'find-a-retailer': 'at retailers' }[x.value] || words(x.value);
    if (x.dim === 'package') { const m = /^(laundry|kitchen)-(\d)-piece$/.exec(String(x.value)); return m ? `in the ${m[2]}-piece ${m[1]} set with it` : `in the ${words(x.value)} set`; }
    if (x.dim === 'regional') return `the region’s lean, ${US[x.value] || x.value} (synthetic → warehouse)`;
    if (x.dim === 'fuel') return `${words(x.value)} (fuel)`;
    return `${SITE.dimLabels[x.dim] || x.dim} ${words(x.value)}`;
  }
  /** The first two of a list in POST /sort's order, as /sort's own items, for leadReasons. */
  function sortItems(skus) {
    const order = sorted(skus), items = (P2.sort && P2.sort.items) || new Map();
    return [items.get(order[0]) || null, items.get(order[1]) || null];
  }
  /**
   * What leads the dryers, and why: the first of POST /sort's own order, and what put it ahead of the next, read off
   * /sort's own items (sold here, Best Buy pickup, the set it completes). Her fuel is named only when her own profile
   * carries a fuel value, and the region's lean is the region's, labelled synthetic (R4 F1: never "in her fuel" when she
   * has none).
   */
  function fuelLead(skus, what) {
    const first = productOf(sorted(skus)[0]);
    if (!first) return '';
    const [a, b] = sortItems(skus);
    const why = leadReasons(a, b).map(driverWords).filter(Boolean);
    const fuel = attrOf(first, 'fuel'), hers = herFuel();
    const lean = state.coldstart && state.coldstart.lean && state.coldstart.lean.leaders ? state.coldstart.lean.leaders.fuel : null;
    const r = P2.sort && P2.sort.regional, where = r && r.region ? (US[r.region] || r.region) : null;
    const fuelSaid = hers ? (hers === fuel ? `; in your fuel: ${words(hers)}` : `; your own browsing leans ${words(hers)}`) : '; you have shown no fuel yet, so none is claimed for you';
    const regionSaid = lean && where ? ` ${where}’s sales lean ${words(lean)} (synthetic → warehouse).` : '';
    return `<p class="pmod-lead" data-p2-lead="dryers">The <b>${esc(nameOf(first))}</b>${fuel ? ` (${esc(words(fuel))})` : ''} leads, by POST /sort over the ${esc(what)} of this series`
      + `${why.length ? `, ahead of the next on: ${esc(why.join(' · '))}` : ''}${esc(fuelSaid)}.${esc(regionSaid)}</p>`;
  }
  /** A card's heading: the piece's own title, except that the dryer's "in your fuel" is said only when her profile carries a fuel. */
  /** A decided piece's title as the page shows it, in the before/now rows as on its card. */
  const shownTitle = (d) => cardTitle(d, pieceOf(d) || { title: titleOfCid(d.customerContentId) });
  function cardTitle(d, piece) {
    const t = piece.title || d.customerContentId;
    return d.customerContentId === 'mod-laundry-dryer' && !herFuel() ? t.replace(/,?\s*in your fuel\.?$/i, '') : t;
  }
  /** After her meters are read again: the dryer card's lead and heading follow her profile as it now stands. */
  function refreshDryerCard(p) {
    const set = state.sets[productKey()] || null;
    // Every receipt on the page, read against her profile as it now stands (a driver she does not carry is the region's lean).
    for (const slot of ['pdp-modules', 'pdp-offers']) {
      const all = transport.bySlot(set, slot);
      for (const node of document.querySelectorAll(`#stage > .view:not([hidden]) #slot-${slot} > [data-cid]`)) {
        const d = all.find((x) => x.customerContentId === node.dataset.cid), r = node.querySelector(':scope > .receipt');
        if (d && r) r.innerHTML = receiptLine(d, all.indexOf(d));
      }
    }
    const card = document.querySelector('#stage > .view:not([hidden]) #slot-pdp-modules [data-module="mod-laundry-dryer"]');
    const d = card ? transport.bySlot(set, 'pdp-modules').find((x) => x.customerContentId === 'mod-laundry-dryer') : null;
    if (!d) return;
    const lead = card.querySelector('[data-p2-lead]');
    if (lead) lead.outerHTML = fuelLead(listFor(d, p), 'dryers');
    const h = card.querySelector('.pmod-head h3');
    if (h) h.textContent = cardTitle(d, pieceOf(d) || {});
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
  /** A laundry set's own figures: its price, and the sum of its pieces' prices when every one is in our data. */
  function setFigures(id) {
    const s = productOf(id), price = priceOf(s);
    const prices = String(id).split('_').map((m) => priceOf(productOf(m)));
    const apart = prices.every((x) => x != null) ? prices.reduce((a, b) => a + Number(b), 0) : null;
    return { s, price, apart };
  }
  /** The sets in the relation that cost less than their pieces, in POST /sort's order: the only sets the set-price card shows. */
  const lowerSets = (sets) => sorted(sets).filter((id) => { const f = setFigures(id); return f.price != null && f.apart != null && f.apart > Number(f.price); });
  /** The laundry sets this machine is in that cost less than their pieces: the set price beside the sum, and the saving. */
  function pairBody(p, sets) {
    const rows = lowerSets(sets).slice(0, 3).map((id) => { const f = setFigures(id); return tileHtml(f.s, `set ${money(f.price)} · apart ${money(f.apart)} · ${money(f.apart - Number(f.price))} less`); });
    return rows.length ? `<div class="ptiles">${rows.join('')}</div><p class="pdp-same">${esc(sortLine())}</p>` : '';
  }
  /**
   * A decided module the page shows: every one, except the set-price card ("The set price, when it is lower") when no
   * set it lists costs less than its pieces. That card's own condition is the saving, so without one it is not shown at
   * all (R4 F7); the receipts keep the engine's positions.
   */
  function shows(d, p) {
    return d.customerContentId !== 'mod-laundry-pair-price' || lowerSets(listFor(d, p)).length > 0;
  }
  const shownOf = (set, p) => transport.bySlot(set, 'pdp-modules').filter((d) => shows(d, p));
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
    // Her distance is a declared context (ctx.distance on the next question), never a choice of hers: the card names one
    // size up by its own rule, and only her own press on "Choose" sends a select for that size (R4 F2).
    const chosen = Boolean(r && r.up && P2.sizeUp && P2.sizeUp.chosen && P2.sizeUp.sku === idOf(r.up));
    const says = !r ? '<p class="pmod-rule">Your viewing distance is yours to give: declared, never inferred.</p>'
      : r.up ? `<p class="pmod-lead">From <b>${esc(r.ft)} ft</b>, your viewing distance, declared, sizes from ${Math.ceil(r.lo)} to ${Math.floor(r.hi)} inches fill 30 to 40 degrees of the view: by this card’s own rule, one size up is the <b>${esc(nameOf(r.up))}</b>, ${money(priceOf(r.up))}.</p>`
        + `<div class="ptiles">${tileHtml(r.up, 'one size up · from your declared distance')}</div>`
        + (chosen ? `<p class="pmod-rule"><b>You chose the ${esc(String(r.up.sizeInches))}″.</b> Sent as select, your own choice${P2.sizeUp.moved ? `: ${esc(P2.sizeUp.moved)}` : ''}.</p>`
          : `<button type="button" class="btn btn--line btn--sm pmod-pick" data-act="size-up-pick" data-ctl="size-up-pick">Choose the ${esc(String(r.up.sizeInches))}″</button><p class="pmod-rule">The distance is sent as context and records nothing about a product; choosing a size is yours.</p>`)
        + '<p class="pdp-same">The price is the same for everyone</p>'
        : `<p class="pmod-lead">From <b>${esc(r.ft)} ft</b>, your viewing distance, declared: ${r.fitsNow ? 'this size already fills the view' : 'no larger size of this series is in our data with a price'}.</p>`;
    return `<p class="pmod-lead"><b>Where you sit</b></p><div class="pdp-chips">${chips}</div>${says}`;
  }
  /** The fit tool: her space, declared; what is wider drops out, counted; what publishes no dimensions is shown and said. Widths: specs.json, else the feed's fits. */
  function fitBody(p, where) {
    const f = fitNow(p);
    if (!f) return '';
    const room = attrOf(p, 'room');
    const chips = (FIT_CHIPS[room] || FIT_CHIPS['laundry-room']).map((w) => `<button type="button" data-act="fit" data-width="${w}" data-ctl="fit-${w}" aria-pressed="${f.width === w}">${w} in</button>`).join('');
    const own = widthOf(p);
    const result = !f.width ? (where === 'module' ? '<p class="pmod-rule">Your measurement is yours: declared, never inferred.</p>'
      : '<p class="pmod-rule">Enter the width of your closet or cut-out: models wider than it drop out, and the page says how many. Your measurement is yours, labelled declared, never inferred.</p>')
      : `<p class="pmod-lead"><b>${f.fit.length} of ${f.all} ${esc(f.kind)}</b> fit ${esc(inches(f.width))} · <span class="fit-hidden">hidden: ${f.hidden.length} wider than your space</span>${f.unknown.length ? ` · ${f.unknown.length} with no dimensions published, shown and counted` : ''}</p>`
        + `${own ? `<p class="pmod-rule">This one is ${esc(inches(own.inches))} wide (${esc(own.from)}): ${own.inches <= f.width ? 'it fits' : 'wider than your space'}.</p>` : ''}`
        + `<div class="ptiles">${f.fit.slice(0, 6).map((id) => { const w = widthOf(productOf(id)); return tileHtml(productOf(id), w ? `${inches(w.inches)} wide` : 'no dimensions published'); }).join('')}</div>`
        + `${f.hidden.length ? `<p class="pdp-same">Wider than your space: ${f.hidden.map((id) => `${esc(idOf(productOf(id)))} (${esc(inches(widthOf(productOf(id)).inches))})`).join(', ')}</p>` : ''}`
        + `<p class="pdp-same">What fits, ${esc(sortLine())} · widths from the product pages (specs.json), else the feed’s fits, merged by sku · your width declared, never inferred</p>`;
    return `<div class="pdp-fit" data-fit="${esc(where)}"><div class="fit-row pdp-chips">${chips}<input type="number" min="12" max="72" step="0.5" id="fitIn-${esc(where)}" aria-label="Your width in inches" value="${f.width || ''}">`
      + `<button type="button" class="btn btn--line btn--sm" data-act="fit-custom" data-in="fitIn-${esc(where)}" data-ctl="fit-custom-${esc(where)}">Check</button></div>${result}</div>`;
  }

  // ── The cards ────────────────────────────────────────────────────────────
  const KIND = (d, piece) => (P2_REL[d.customerContentId] ? 'goes with it' : piece.type === 'package' ? 'package'
    : /where-to-buy/.test(d.customerContentId) ? 'where to buy' : ({ compare: 'compare', tool: 'tool', explainer: 'service', deal: 'deal' }[arr((piece.tags || {}).contentType)[0]] || piece.type || 'module'));
  /** The receipt on the card: position and score, E1's completes line when the engine preferred it for this product, her own drivers, the region. */
  /** Whether her own profile carries a driver's value: one it does not came from the region's lean blended into the score, said so, never as hers. */
  const herCarries = (x) => Number((((state.lastVector || {})[x.dim]) || {})[x.value]) > 0;
  function receiptLine(d, i) {
    if (d.strategy === 'tenant-pinned') return `#${i + 1} · pinned by the merchandiser · the engine never ranked it`;
    const drivers = arr(d.explain && d.explain.drivers);
    const completes = drivers.filter((x) => x.dim === 'completes').map((x) => `<b>Completes what was committed to: ${esc(x.value)} (+${esc(Number(x.weight))})</b>`);
    const own = drivers.filter((x) => panels.OWN(x) && x.dim !== 'completes').sort((a, b) => Number(b.a) * Number(b.weight) - Number(a.a) * Number(a.weight)).slice(0, 2)
      .map((x) => `${esc(SITE.dimLabels[x.dim] || x.dim)} ${esc(x.value)}${herCarries(x) ? '' : ' (the region’s lean)'}`);
    const reg = drivers.find((x) => x.dim === 'regional');
    const parts = [`#${i + 1} · score ${fmt3(d.score)}`, ...completes, ...own, ...(reg ? [`region ${esc(reg.value)}`] : [])];
    if (!completes.length && !own.length && !reg) parts.push(d.strategy === 'default' ? 'the catalog’s order, the holdout' : 'nothing the visitor has shown moves it yet: the catalog’s order');
    return parts.join(' · ');
  }
  function moduleCard(d, i, p, mv) {
    const piece = pieceOf(d) || {};
    const rel = P2_REL[d.customerContentId];
    return `<article class="card pmod" data-act="piece" data-ctl="piece-${esc(d.customerContentId)}" data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}"`
      + ` data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}" data-module="${esc(d.customerContentId)}">`
      + `<header class="pmod-head"><h3>${esc(cardTitle(d, piece))}</h3><span class="pmod-kind">${esc(KIND(d, piece))}</span></header>${demo.deltas.chipHtml(mv)}`
      + `${piece.subtitle ? `<p>${esc(piece.subtitle)}</p>` : ''}${rel && p ? `<p class="pmod-rule"><b>Our merchandiser’s rule</b> ${esc(rel[1](p))}</p>` : ''}`
      + `${moduleBody(d, p)}<p class="receipt">${receiptLine(d, i)}</p></article>`;
  }
  /** An offer in the carousel: its badge, title and line, its terms on a press (a decided click, credited), its receipt. */
  function offerCard(d, i, mv) {
    const piece = pieceOf(d) || {}, disp = P2.display.get(d.customerContentId) || {};
    const w = piece.window || null;
    const when = (t) => new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const terms = `${w && w.to ? `The catalog’s window for this offer closes ${when(w.to)}.` : 'The catalog publishes no closing date for this offer.'} Applied at checkout to eligible products; the same for everyone.`;
    return `<article class="card pdp-offer" data-act="pdp-offer" data-ctl="piece-${esc(d.customerContentId)}" data-op-content="${esc(d.contentId || '')}" data-op-slot="${esc(d.slot)}"`
      + ` data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}" aria-expanded="false">${demo.deltas.chipHtml(mv)}`
      + `${disp.badge ? `<span class="pdp-obadge">${esc(disp.badge)}</span>` : ''}<h3>${esc(piece.title || d.customerContentId)}</h3>`
      + `${piece.subtitle ? `<p>${esc(piece.subtitle)}</p>` : ''}<p class="pdp-oterms" hidden>${esc(terms)}</p><span class="pdp-omore">See terms</span>`
      + `<span class="receipt">${receiptLine(d, i)}</span></article>`;
  }
  /** The carousel's count and arrows, from where the track has scrolled. */
  function syncOffers() {
    const track = $('slot-pdp-offers'), count = $('pdpOcount');
    if (!track || !count) return;
    const n = track.querySelectorAll('.pdp-offer').length, w = track.clientWidth || 1;
    const at = n ? Math.min(n - 1, Math.max(0, Math.round(track.scrollLeft / (w + 16)))) : -1;
    count.textContent = n ? `${at + 1} / ${n}` : '0 / 0';
    const arrows = document.querySelectorAll('#mod-pdp-offers .pdp-oarrow');
    if (arrows[0]) arrows[0].disabled = at <= 0;
    if (arrows[1]) arrows[1].disabled = at < 0 || at >= n - 1;
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
    const groups = [
      ['Dimensions', anyDim ? [dim('width', 'Width'), dim('height', 'Height'), dim('depth', 'Depth')] : [['Dimensions', 'no dimensions published']]],
      ['The product', [['Model', idOf(p)], p.sizeInches ? ['Screen size', `${p.sizeInches}″ class`] : null, attrOf(p, 'panel') ? ['Panel', panelWords(attrOf(p, 'panel'))] : null,
        p.capacityCuFt ? ['Capacity', `${p.capacityCuFt} cu. ft.`] : null, attrOf(p, 'type') ? ['Type', typeWords(attrOf(p, 'type'))] : null,
        attrOf(p, 'fuel') ? ['Fuel', capital(words(attrOf(p, 'fuel')))] : null, attrOf(p, 'finish') ? ['Finish', finishWords(attrOf(p, 'finish'))] : null,
        p.modelYear ? ['Model year', String(p.modelYear)] : null]],
      ['Mounting', p.vesa ? [['VESA pattern', `${String(p.vesa).replace('x', ' x ')} mm`]] : []],
      ['Features', arr(attrOf(p, 'feature')).length ? [['Features', arr(attrOf(p, 'feature')).map((f) => FEATURE_WORDS[f] || words(f)).join(', ')]] : []],
      ['Ratings and availability', [p.rating ? ['Rating', `${p.rating} out of 5 from ${Number(p.reviews || 0).toLocaleString('en-US')} reviews`] : null,
        ['Sold', p.cta === 'cart' ? (p.inStock === false ? 'here: out of stock today' : 'here, and at Best Buy for pickup where offered') : 'through retailers'],
        ['Best Buy pickup', offersPickupHere(p) ? 'offered' : 'not offered']]],
    ].map(([h, rows]) => [h, rows.filter(Boolean)]).filter(([, rows]) => rows.length);
    box.innerHTML = '<header class="pdp-sechead"><h2>Specifications</h2><span class="nper">not personalised</span></header>'
      + `<div class="pdp-specgrid">${groups.map(([h, rows]) => `<section class="pdp-specgroup"><h3>${esc(h)}</h3><dl>${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></section>`).join('')}</div>`
      + `${fitHere ? `<div class="pdp-fit-static"><p class="module-where">the site’s own tool · not decided here</p><h3>Will it fit? Tell us your space.</h3>${fitBody(p, 'specs')}</div>` : ''}`
      + '<p class="bb-note">From the feed (products.json, as listed on 1 October) and the product page (specs.json, 2 October), merged by sku. A dimension is the product page’s where it gives one, else the feed’s.</p>';
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
    catalogFacts(p);
  }
  /**
   * What the catalog in force says on the static parts, read again after every question (a publish may have closed an
   * offer): the gallery's offer badges and the services an offer makes free. The same for everyone; nothing decided.
   */
  function catalogFacts(p) {
    if (!p) return;
    const g = document.querySelector('#pdpGallery .pdp-gbadges');
    const badges = galleryBadges(p);
    const html = badges.map((b) => `<span class="pdp-gbadge">${esc(b)}</span>`).join('');
    if (g && g.innerHTML !== html) { if (badges.length) g.innerHTML = html; else g.remove(); }
    if (servicesFor(p)) renderSelections(p);
  }
  /**
   * The page from one answer, with P2.sort already the engine's order for it. quiet: a frame for Compare (a fresh
   * visitor's, or hers put back): the before/now rows do not rotate, nothing is withdrawn from her history, and her
   * page's memory (the last product page) is left as it was; `gone` is what the withdrawn row shows.
   */
  function renderProductFrom(set, p, opts = {}) {
    const all = transport.bySlot(set, 'pdp-modules'), offers = transport.bySlot(set, 'pdp-offers');
    const mods = all.filter((d) => shows(d, p));   // the engine's order; the set-price card only when a set costs less
    const fitDecided = all.some((d) => d.customerContentId === 'mod-fit-check');
    const fitHere = Boolean(p) && fitScope(p).length > 0 && Boolean(widthOf(p));
    const after = mods.map((d) => ({ id: d.customerContentId, title: shownTitle(d) }));
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
    if (box) box.innerHTML = mods.length ? mods.map((d) => moduleCard(d, all.indexOf(d), p, mv[d.customerContentId])).join('')
      : '<p class="slot-empty">The engine returned no module for this product on this request, and the page shows none rather than invent one.</p>';
    if ($('pdpGone')) $('pdpGone').innerHTML = (opts.quiet ? arr(opts.gone) : P2.gone).map(goneCard).join('');
    const ob = $('slot-pdp-offers');
    if (ob) {
      ob.innerHTML = offers.length ? offers.map((d, i) => offerCard(d, i, mvo[d.customerContentId])).join('') : '<p class="slot-empty">No offer the engine could serve applies to this product today.</p>';
      ob.scrollLeft = 0;
      syncOffers();
    }
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
    title: 'The shopper’s product page, and a fresh visitor’s',
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
    renderStatic(p);
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
    panels.note('declared', `the space: ${inches(w)} wide`, 'the shopper’s own measurement, declared, never inferred · asserted on the next decision as ctx.fit · wider models drop out of this page’s lists, counted');
    await askProduct(productKey());
    focusOn(document.querySelector('#stage > .view:not([hidden]) [data-fit]'), 'center');
  }
  /**
   * Her viewing distance: a declared context, never a choice (R4 F2). It rides the next question as ctx.distance and
   * sends no event for any product; the size-up card names one size up by its own rule. Her meters move only when she
   * then chooses that size herself (chooseSizeUp).
   */
  async function declareDistance(ft) {
    const v = transport.cur(), p = productOf(state.productId);
    if (!v || !p) return;
    v.p2 = { ...(v.p2 || {}), distance: Number(ft) };
    const r = sizeUpFor(p, ft);
    P2.sizeUp = r && r.up ? { sku: idOf(r.up), name: nameOf(r.up), price: money(priceOf(r.up)), size: Number(r.up.sizeInches), ft: Number(ft), moved: null, chosen: false } : null;
    panels.note('declared', `the shopper sits ${ft} ft away`, `the shopper’s own answer, declared · carried as ctx.distance on the next question, never as a choice of theirs · nothing is sent for any product · ${r && r.up ? `the card names one size up by its own rule: ${nameOf(r.up)}` : r && r.fitsNow ? 'this size already fills the view' : 'no larger size of this series with a price'}`);
    await askProduct(productKey());
    director.sayAfter();
    focusOn(document.querySelector('#stage > .view:not([hidden]) [data-module="mod-tv-size-up"]'), 'center');
  }
  /** She chooses the size the card names, herself: a select with that size's attributes, and what it did to her own meters. */
  async function chooseSizeUp() {
    const v = transport.cur(), p = productOf(state.productId), up = P2.sizeUp ? productOf(P2.sizeUp.sku) : null;
    if (!v || !p || !up) { say('declare a viewing distance on the size-up card first', 'bad'); return; }
    const was = JSON.parse(JSON.stringify(v.vector || {}));   // her meters as the panel last read them
    await store.events.send('select', { sku: idOf(up), control: 'size-up', distanceFt: P2.sizeUp.ft, chosen: 'by the shopper' },
      { note: ['chose', `${nameOf(up)}, one size up`, 'the shopper’s own press on the size-up card · sent as select with that size’s attributes · the price is the same for everyone'] });
    P2.sizeUp.chosen = true;
    await askProduct(productKey());
    // What her own choice did to her meters, dimension by dimension, as her profile reads after the ask.
    const now = v.vector || {}, a = (vec, dim, val) => Number(((vec[dim] || {})[val]) || 0);
    const moved = [['sizeBand', 'size band'], ['priceTier', 'price tier']].map(([dim, label]) => {
      const val = attrOf(up, dim);
      return val ? { label, val, from: a(was, dim, val), to: a(now, dim, val) } : null;
    }).filter((m) => m && m.to > m.from + 0.004);
    P2.sizeUp.moved = moved.length ? moved.map((m) => `${m.label} ${m.val} ${m.from.toFixed(2)} → ${m.to.toFixed(2)}`).join(', ') : null;
    const card = document.querySelector('#stage > .view:not([hidden]) [data-module="mod-tv-size-up"]');
    const d = card ? transport.bySlot(state.sets[productKey()] || null, 'pdp-modules').find((x) => x.customerContentId === 'mod-tv-size-up') : null;
    if (card && d) card.outerHTML = moduleCard(d, transport.bySlot(state.sets[productKey()], 'pdp-modules').indexOf(d), p, undefined);
    director.sayAfter();   // the beat's sentence, now that her meters bear it out
    focusOn(document.querySelector('#stage > .view:not([hidden]) [data-module="mod-tv-size-up"]'), 'center');
  }

  // ── The buy column's controls: a size or colour, a service, Add to Cart ─────
  /** A size or colour tile: the select event with that variant's attributes, then that variant's page (the address bar's, so Back returns). */
  async function pickVariant(t) {
    const sku = t.dataset.sku, x = productOf(sku), p = productOf(state.productId);
    if (!x) return false;
    if (p && idOf(x) === idOf(p)) return true;
    const kind = t.dataset.kind === 'size' ? 'size' : 'colour';
    await store.events.send('select', { sku: idOf(x), control: kind, [kind]: t.dataset.label || null, from: p ? idOf(p) : null },
      { note: ['selected', `${kind} ${t.dataset.label || idOf(x)}`, `the buy box’s own ${kind} tiles, the same for everyone · sent as select with the ${idOf(x)}’s attributes · its page opens at its own price`] });
    await store.nav.go(`${BASE}product?id=${encodeURIComponent(idOf(x))}`, { event: false, dispatched: true });
    return true;
  }
  /** A service tile: one per group or none, hers; the total follows. Nothing is sent until she adds the item. */
  function toggleService(t) {
    const p = productOf(state.productId), g = t.dataset.group, id = t.dataset.opt;
    if (!p || !g || !id) return;
    P2.sel.picks[g] = P2.sel.picks[g] === id ? null : id;
    renderSelections(p);
    const s = servicesFor(p), group = s && s.groups.find((x) => x.id === g), o = group && group.opts.find((x) => x[0] === id);
    if (o) panels.note(P2.sel.picks[g] ? 'chose' : 'removed', `${group.short}: ${o[1]}`, 'a service on the line, chosen by the shopper · it travels with Add to Cart, nothing is sent on its own');
  }
  /**
   * Add to Cart: the store's cart with the line's options, her services, and the decisions on this page (the decided
   * press that led to this product first, then this page's offers, then its modules), then the cart drawer. The store
   * sends add_to_cart, the order-start action, credited to the first of them.
   */
  async function addToCart(t) {
    const p = productOf(state.productId);
    if (!p) return false;
    const set = state.sets[productKey()] || null;
    const onPage = [...transport.bySlot(set, 'pdp-offers'), ...shownOf(set, p)].map((d) => d.decisionId).filter(Boolean);
    const fromDecisionId = [...new Set([...store.trail.ledTo(idOf(p)), ...onPage])];
    const addOns = picksOf(p).map((x) => ({ id: x.id, label: `${x.group.short}: ${x.label}`, price: x.price }));
    await store.cart.add(idOf(p), { options: selectionOptions(p), addOns, fromDecisionId, target: t });
    store.cart.open();
    return true;
  }
  /**
   * A tab, or Special Offers: the section scrolls in under the sticky row. The row is in the page's flow, so when its twin
   * appears on the way down the sections below move down by the twin's height too: the row's height now is the offset.
   */
  function scrollToSection(to) {
    const node = boxOf(to);
    if (!node) return;
    const top = node.getBoundingClientRect().top + window.scrollY - stickTop() - (($('pdpStick') || {}).offsetHeight || 0) - 12;
    try { window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch { window.scrollTo(0, Math.max(0, top)); }
    for (const b of document.querySelectorAll('#pdpTabs [data-to]')) b.setAttribute('aria-current', String(b.dataset.to === to || (to === 'mod-pdp-offers' && b.dataset.to === 'pdpTop')));
  }
  /** The heart: saved sends wishlist_add (the engine's own action); unsaved sends nothing, a removal is not a taste. */
  async function toggleWish(t) {
    const p = productOf(state.productId);
    if (!p) return;
    const sku = idOf(p);
    if (P2.wished.has(sku)) { P2.wished.delete(sku); store.ui.toast(`Removed from your wishlist: ${nameOf(p)}`); }
    else {
      P2.wished.add(sku);
      await store.events.send('wishlist_add', { sku, control: 'gallery' }, { note: ['saved', nameOf(p), 'to the shopper’s wishlist · wishlist_add, the engine’s own action, with its attributes'] });
      store.ui.toast(`Saved to your wishlist: ${nameOf(p)}`, 'good');
    }
    // The heart on screen now, as well as the one pressed: the page may have repainted the gallery between the press and
    // this line (the dispatcher awaits the visitor first), and a detached button would leave the saved state invisible (M2b).
    const on = P2.wished.has(sku);
    for (const h of new Set([t, document.querySelector('#pdpGallery .pdp-wish')])) {
      if (!h) continue;
      h.setAttribute('aria-pressed', String(on));
      h.setAttribute('aria-label', on ? 'Saved to your wishlist: remove it' : 'Save to your wishlist');
    }
  }
  /** An offer card: its terms open and close (the press is a decided click, credited by the dispatcher before this runs). */
  function toggleOffer(t) {
    const pressed = t.closest ? t.closest('.pdp-offer') : null;
    if (!pressed) return;
    // The card on screen with the same decision, when the track was repainted between the press and this line (M2b).
    const card = pressed.isConnected ? pressed
      : document.querySelector(`#slot-pdp-offers > .pdp-offer[data-cid="${CSS.escape(pressed.dataset.cid || '')}"]`) || pressed;
    const open = card.getAttribute('aria-expanded') !== 'true';
    card.setAttribute('aria-expanded', String(open));
    const terms = card.querySelector('.pdp-oterms'), more = card.querySelector('.pdp-omore');
    if (terms) terms.hidden = !open;
    if (more) more.textContent = open ? 'Hide terms' : 'See terms';
    panels.note('clicked', titleOfCid(card.dataset.cid), 'a decided offer: its click is the reward it is judged on');
  }
  function moveOffers(dir) {
    const track = $('slot-pdp-offers');
    if (!track) return;
    try { track.scrollBy({ left: Number(dir) * (track.clientWidth + 16), behavior: 'smooth' }); } catch { track.scrollLeft += Number(dir) * (track.clientWidth + 16); }
    setTimeout(syncOffers, 400);
  }
  /** Notify Me on a product out of stock here: her interest goes on the wire as a named custom event; no email is asked for. */
  async function notifyMe() {
    const p = productOf(state.productId);
    if (!p) return;
    await store.events.send('notify_me', { sku: idOf(p), control: 'buy-box' }, { note: ['asked', `Notify Me · ${nameOf(p)}`, 'out of stock here: sent as custom notify_me with its attributes · no email is asked for in the demo'] });
    store.ui.toast(`Noted: the ${idOf(p)} is out of stock here today. A real store would ask for your email; this demo asks for nothing.`, 'good');
  }
  LANES.controls.push(async (t) => {
    const act = t.dataset && t.dataset.act;
    if (act === 'fit') { await declareFit(t.dataset.width); return true; }
    if (act === 'fit-custom') { await declareFit(($(t.dataset.in) || {}).value); return true; }
    if (act === 'size-up') { await declareDistance(t.dataset.ft); return true; }
    if (act === 'size-up-pick') { await chooseSizeUp(); return true; }
    if (act === 'pdp-add') return addToCart(t);
    if (act === 'pdp-variant') return pickVariant(t);
    if (act === 'pdp-service') { toggleService(t); return true; }
    if (act === 'pdp-tab') { scrollToSection(t.dataset.to); return true; }
    if (act === 'pdp-offers-nav') { moveOffers(t.dataset.dir); return true; }
    if (act === 'pdp-offer') { toggleOffer(t); return true; }
    if (act === 'pdp-wish') { await toggleWish(t); return true; }
    if (act === 'pdp-notify') { await notifyMe(); return true; }
    if (act === 'pdp-thumb') { showPicture(t.dataset.i); return true; }
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
      held: { title: (d) => shownTitle(d), index: (d) => transport.bySlot(state.sets[productKey()], slot).indexOf(d) },
      nothing: { text: slot === 'pdp-modules' ? 'The same modules, in the same order.' : 'The same offers, in the same order.' },
      title: (d) => shownTitle(d),
      titleOfId: (id) => shownTitle({ customerContentId: id }),
    };
  }

  // ── The facts beats 5–10 speak about (beats.json {{p2.*}}), read fresh ───
  LANES.facts.p2 = () => {
    const p = productOf(state.productId), set = state.sets[productKey()] || null;
    const mods = set && (pageOf(state.viewPage) || {}).entry === 'product' ? shownOf(set, p) : [];   // the modules on screen
    // The dryer card's lead, as the card says it: the first of POST /sort's order, what put it ahead of the next, her fuel only when she has one.
    const dryerMod = mods.find((d) => d.customerContentId === 'mod-laundry-dryer') || null;
    const dryerFirst = dryerMod && p ? productOf(sorted(listFor(dryerMod, p))[0]) : null;
    const dryerWhy = dryerFirst ? leadReasons(...sortItems(listFor(dryerMod, p))).map(driverWords).join(' · ') || null : null;
    const named = (sku) => { const x = productOf(sku); return { sku: x ? idOf(x) : sku, name: x ? nameOf(x) : sku }; };
    const washer = productOf(P2_WALK.washer), top = typeTarget(washer, 'top-load');
    const f = p ? fitNow(p) : null;
    const pkg = mods.map((d) => [d, P2.display.get(d.customerContentId) || {}]).find(([d, x]) => (pieceOf(d) || {}).type === 'package' && Number(x.savings) > 0);
    const other = p && attrOf(p, 'category') === 'tvs' ? productOf(sorted(counterpartPool(p).map(idOf))[0]) : null;
    return {
      washer: named(P2_WALK.washer), topLoader: named(top ? idOf(top) : null), tv: named(P2_WALK.tv), range: named(P2_WALK.range), qned: named(P2_WALK.qned),
      closet: P2_WALK.closet, distanceFt: P2_WALK.distanceFt,
      onPage: { product: p ? nameOf(p) : null, modules: mods.length || null, titles: mods.map((d) => shownTitle(d)).join(', ') || null,
        completes: mods.filter((d) => arr(d.explain && d.explain.drivers).some((x) => x.dim === 'completes')).length || null,
        completing: mods.filter((d) => arr(d.explain && d.explain.drivers).some((x) => x.dim === 'completes')).map((d) => shownTitle(d)).join(', ') || null },
      vesa: p && p.vesa ? String(p.vesa).replace('x', ' x ') : null,
      withdrawn: P2.gone.length ? P2.gone.map((g) => g.title).join(', ') : null,
      withdrawnWhy: P2.gone.length ? goneSentence(P2.gone[0].why) : null,
      fit: { width: f ? f.width : null, all: f ? f.all : null, fits: f && f.width ? f.fit.length : null, hidden: f && f.width ? f.hidden.length : null, kind: f ? f.kind : null },
      sizeUp: { name: P2.sizeUp ? P2.sizeUp.name : null, price: P2.sizeUp ? P2.sizeUp.price : null, size: P2.sizeUp ? P2.sizeUp.size : null, moved: P2.sizeUp ? P2.sizeUp.moved : null,
        chosen: P2.sizeUp && P2.sizeUp.chosen ? true : null },
      dryer: { lead: dryerFirst ? nameOf(dryerFirst) : null, why: dryerWhy, fuel: herFuel() },
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
    // The Find a Retailer list and its outcomes are the store's (oh-store.js, M3): one modal for the decided module, the
    // buy box and a manual press, reading the catalog's where-to-buy lists first and saying which list is in use.
    /** The companion modules the attach rows read off the product pages' grid. */
    const ATTACH = [['mod-laundry-dryer', 'The dryer for the washer'], ['mod-laundry-pedestal', 'The pedestal'], ['mod-laundry-stacking', 'The stacking kit'],
      ['mod-laundry-pair-price', 'The set price'], ['mod-tv-soundbar', 'The soundbar for the series'], ['mod-tv-mount', 'The mount for the VESA pattern'],
      ['mod-range-microwave', 'The microwave over the range'], ['mod-range-dishwasher', 'The dishwasher beside it']];
    const S = { laptop: null, phone: null, laptopTop: null, phoneBefore: null, phoneAfter: null, phoneTop: null, same: null, moved: null,
      outcomes: [], baseline: null, report: null, quiet: false, gen: 0, framed: document.body.classList.contains('shell--phone') };
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
    /**
     * Her three strongest values across every dimension, whatever its memory, read from her profile at one moment (the
     * link's): the demo's registry runs the page-driving dimensions in seconds and minutes, so a cut by memory length
     * would leave nothing to show.
     */
    function topOf(dims, n = 3) {
      const rows = [];
      for (const [dim, values] of Object.entries(dims || {})) for (const [value, a] of Object.entries(values || {})) if (Number(a) > 0) rows.push({ dim, value, a: Number(a) });
      return rows.sort((x, y) => y.a - x.a).slice(0, n);
    }
    /** What the strip says of memory when what it names is compressed for the room (under a day here); production runs days. */
    const memoryNote = (list) => (arr(list).some((x) => tauOf(x.dim) < 86400000) ? ' · memory compressed for the room; production runs days' : '');
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
      // Her profile at the moment of the link, before anything else is asked; on the phone, the laptop's beside it at the
      // same moment (both sessions now name the person). Strongest values across every dimension, whatever their memory.
      const laptopNow = isPhone && S.laptop && state.visitors[S.laptop] ? state.visitors[S.laptop] : null;
      const [atLink, laptopAtLink] = await Promise.all([reflexOf(v).then((d) => topOf(d)), laptopNow ? reflexOf(laptopNow).then((d) => topOf(d)) : Promise.resolve(null)]);
      if (state.viewPage) await askPage(state.viewPage);   // one request: the page asks again, as the person
      const gained = atLink.filter((x) => !before.some((y) => y.dim === x.dim && y.value === x.value));
      if (isPhone) {
        S.phoneAfter = shownOn(state.viewPage);
        S.phoneTop = atLink;
        if (laptopAtLink) S.laptopTop = laptopAtLink;
        S.same = Boolean(laptopAtLink && laptopAtLink.length && keysOf(atLink) === keysOf(laptopAtLink));
        S.moved = S.phoneBefore && S.phoneAfter ? Object.keys(S.phoneAfter).filter((k) => S.phoneAfter[k] !== S.phoneBefore[k]).length : null;
        v.p3.linked.taste = atLink.length ? `strongest at sign-in: ${tops(atLink)}${memoryNote(atLink)}` : 'nothing from another device yet';
      } else if (gained.length) v.p3.linked.taste = `strongest at sign-in: ${tops(gained)}${memoryNote(gained)}`;
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
      await transport.mintVisitor('B', transport.directEntry(), 'The phone');
      S.phone = 'B';
      transport.useVisitor('B');
      panels.note('arrived', 'The phone', 'a second device, a stranger to the engine: anonymous · consent granted · direct · nothing links it to the laptop until the shopper signs in');
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
        panels.note('returned', 'The laptop', link ? `signed in as ${link.account}: the same person as on the phone` : 'anonymous, as it was left');
      }
      renderSignedIn();
      return true;
    }
    /** m.html on its own: a direct load is a real arrival on the phone, a stranger decided live, her region from the request. */
    async function phoneArrival() {
      const v = await transport.mintVisitor('A', transport.landingEntry(), 'The phone');
      transport.useVisitor('A');
      panels.note('arrived', 'The phone', `a stranger on this device: ${transport.describeEntry(v.entry)} · anonymous · consent granted · no device matching`);
      await openPage(homeKey(), { quiet: true });
      await panels.loadColdStart();
      say('ready · this phone page was decided live for a stranger; Sign in names the fictional account; Next starts the walkthrough', 'good');
    }

    // ── Where to buy (beat 16): the two decided modules' bodies, and their outcomes ──
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
      return '<div class="p3-wtb" data-wtb="pickup"><p class="pmod-lead">Pickup changes how you get it, not what you pay: the price is the buy box’s, the same for everyone.</p>'
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
    /** The day's counts before this visit's first outcome, so the report can show what this visit added (one build, once). */
    async function baselineOnce() {
      if (S.baseline && S.baseline.date === today()) return;
      try {
        const out = await transport.demoRoute(SITE.api.report, { date: today(), slot: 'pdp-modules', build: true });
        S.baseline = { date: today(), counts: countsOf(out.report) };
      } catch { S.baseline = { date: today(), counts: Object.fromEntries(EVENTS.map((e) => [e, 0])), unknown: true }; }
    }
    /** The decision a where-to-buy press is credited to, in the store's shape: the module's decision on this page, and its place. */
    const creditOf = (at) => (at ? { decisionId: at.d.decisionId, contentId: at.d.contentId, slot: at.d.slot, customerContentId: at.d.customerContentId, position: at.position } : null);
    /**
     * The pickup module's own button: the store records the outcome (oh-store.js store.retailers.pickup, the same call the
     * modal's pickup button makes): partner_pickup with the product's attributes as the feed has them, data.store
     * 'best-buy', and this module's decision. Its record comes back through recordOutcome below.
     */
    async function pickup() {
      const p = productOf(state.productId), at = onScreen(PICKUP);
      if (!p || !at) throw new Error('Best Buy pickup is chosen on a product page where the engine decided the pickup module');
      if (!offersPickup(p)) throw new Error(`Best Buy pickup is not offered for the ${productName(p)}`);
      return store.retailers.pickup(p, creditOf(at));
    }
    /** Find a Retailer, from the decided module or the buy box: the store's one modal, credited to this module's decision when the press is inside it. */
    async function findRetailer(t) {
      const p = productOf(state.productId);
      if (!p) return false;
      const fromBox = !(t.closest && t.closest('[data-op-decision-id]'));
      return store.retailers.open(p, fromBox ? null : creditOf(onScreen(RETAIL)));
    }
    /** The store's record of an outcome it sent (its host calls this): this visit's tally, beat 16's facts, the module's own line. */
    function recordOutcome(o) {
      S.outcomes.push({ ...o, cid: o.event === 'partner_pickup' ? PICKUP : RETAIL });
      repaint(o.event === 'partner_pickup' ? PICKUP : RETAIL, productOf(o.sku));
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
      Object.assign(S, { laptop: null, phone: null, laptopTop: null, phoneBefore: null, phoneAfter: null, phoneTop: null, same: null, moved: null, outcomes: [], baseline: null, report: null });
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
    return { laptopFirst, pickUpPhone, backToLaptop, phoneArrival, dayReport, readOutcomes, control, facts, whereToBuyBody, reportLabels, attach, theirs, titleById, beforeOutcome: baselineOnce, recordOutcome, state: S };
  })();

  // ── The routes and the one dispatcher (shared). The cursor and a human hand run the same handler. ─
  /** The browser's Back and Forward (and a beat's own Back): the route the address bar holds, painted with no view event. */
  async function restoreFromUrl() { return store.nav.restore(); }
  async function handleControl(t) {
    await store.visitor.ensure();          // the first click mints her (M3): never the load, so the boot page is the template
    store.trail.note(t);                   // a press inside a decided container: the decisions that led to what she adds
    await transport.creditDecided(t);
    if (await store.control(t)) return true;   // the store's own controls (data-act="store-…"): cart, Find a Retailer, search, nav
    if (await p3Control(t)) return true;   // the P3 section's controls: sign-in, where-to-buy
    for (const own of LANES.controls) { const done = await own(t); if (done !== undefined) return done; }   // the other sections' controls (LANES.controls)
    // Navigation goes through the store's routes (LANES.routes, else the shared openers), with the browser's Back working.
    if (t.dataset.nav) return store.nav.go(store.nav.navPath(t.dataset.nav), { dispatched: true });
    if (t.dataset.open) return store.nav.go(`${BASE}product?id=${encodeURIComponent(t.dataset.open)}`, { dispatched: true });
    // Add to Cart: the store's cart (the order-start action, add_to_cart, with the decisions that led here).
    if (t.dataset.act === 'add-to-cart') { await store.cart.add(t.dataset.sku || state.productId, { target: t }); return true; }
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
        o.key ? (transport.localRuntime ? 'from the request, as the local runtime fills request.cf · nothing asserted' : 'from the request: the edge located the visitor · nothing asserted')
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
      // Her visitor from this browser, continued (M3): a full load, a reload, a new tab or Back after a full navigation is
      // the same person, with no identity call and no new consent; nothing kept, the page is a stranger's.
      const back = await store.visitor.resume().catch(() => null);
      const failed = (error) => { engineDown(String(error.message || error)); say(String(error.message || error), 'bad'); };
      // A direct load of the product page is a real arrival on it: a visitor, the product, and the live answer.
      if (ENTRY === 'product') {
        const id = new URLSearchParams(location.search).get('id');
        await openProduct(id).then(() => panels.loadColdStart())
          .then(() => say(back ? 'ready · this product page was decided live for the same visitor as before on this browser; Next starts the walkthrough'
            : 'ready · this product page was decided live for a direct visitor; Next starts the walkthrough', 'good'))
          .catch(failed);
      } else if (ENTRY === 'grid') {
        await restoreFromUrl().catch(failed);
      } else if (back) {
        // Home, a grid by its view, a search or the phone: her own page, decided for her, not the stranger's template.
        await panels.loadColdStart().then(() => store.nav.go(location.pathname + location.search, { dispatched: true }))
          .then(() => say('ready · decided for the same visitor as before on this browser; Next starts the walkthrough', 'good'))
          .catch(failed);
      } else if (ENTRY === 'phone') {
        await phoneArrival().catch(failed);   // P3: a stranger on the phone
      }
      store.visitor.persist(transport.cur());   // a visitor this load minted (a direct product address, the phone) is kept for the next
      // The sections' own boot steps (a direct load of the grid, the static menus), in order.
      for (const step of LANES.boot) await step(ENTRY);
    } catch (error) {
      say(String(error.message || error), 'bad');
      engineDown(String(error.message || error));
    }
  })();
})();
