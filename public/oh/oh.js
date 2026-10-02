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
    verbs: { arrive: () => arrive(), notBuilt: (args) => notBuilt(args) },
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
    rows: () => ({}),
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
  /**
   * A snapshot that also asserts what a page knows about itself (a product page: ctx.anchor, ctx.family), built as
   * the kit's transport.ask builds every other one (the landing entry, ctx.region, ctx.intent) and sent through its
   * api() door. The kit's ask() asserts region and intent only; this is the one place the page adds to it.
   */
  async function askWithContext(pageKey, v, extra) {
    const q = new URLSearchParams({ page: PAGES[pageKey] || pageKey });
    const entry = transport.snapshotEntry(v && v.entry);
    if (entry) q.set('entry', entry);
    if (state.ctx.region) q.set('ctx.region', state.ctx.region);
    const intent = (v && v.intent) || transport.defaultIntent();
    if (intent) q.set('ctx.intent', intent);
    for (const [k, val] of Object.entries(extra)) if (val !== null && val !== undefined && val !== '' && k !== 'region' && k !== 'intent') q.set(`ctx.${k}`, String(val));
    const r = await transport.api(`/v1/${SITE.tenant}/decisions/snapshot?${q}`, undefined, { visitor: v });
    if (!r.ok || !r.body || !Array.isArray(r.body.decisions)) return { ok: false, status: r.status, error: (r.body && r.body.error) || `the decision service answered ${r.status || 'nothing'}` };
    return { ok: true, set: { ...r.body, asked: { intent: q.get('ctx.intent'), region: q.get('ctx.region'), ...extra } } };
  }
  async function askPage(key) {
    const v = transport.cur();
    const extra = (pageOf(key) || {}).entry === 'product' ? productContext(productOf(state.productId)) : null;
    const r = extra && Object.keys(extra).length ? await askWithContext(key, v, extra) : await transport.ask(key, v);
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
  function productCard(p) {
    const id = idOf(p);
    const price = priceOf(p);
    return `<article class="pcard" data-open="${esc(id)}" data-ctl="open-${esc(id)}">${imageOf(p) ? `<img src="${esc(imageOf(p))}" alt="" loading="lazy">` : ''}`
      + `<span class="pname">${esc(productName(p))}</span>${price != null ? `<span class="pprice">${money(price)}</span>` : ''}</article>`;
  }
  /** A /sort rail, as the scaffold paints it: the products file in the site's own order (the page lane wires POST /sort). */
  function renderRail(rail) {
    const box = $(`rail-${rail.slot}`);
    if (!box) return;
    const list = state.products.filter((p) => !rail.category || field(p, SITE.products.category) === rail.category).slice(0, rail.take);
    box.innerHTML = list.length ? list.map(productCard).join('') : '<p class="slot-empty">No products yet: the products file is a placeholder.</p>';
  }
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

  // ── product pages (P2) ────────────────────────────────────────────────────
  // The buy box (off limits) and the decided modules below it, for the TV, the washer and the range on one template.
  // Lane P2 writes here (and the facts it owns).
  /** What a product page asserts about its product, as the config's products.pageContext maps it (OH: anchor = the sku, family). */
  function productContext(p) {
    if (!p) return null;
    const out = {};
    for (const [name, path] of Object.entries(SITE.products.pageContext || {})) { const v = field(p, path); if (v !== undefined && v !== null && v !== '') out[name] = String(v); }
    return out;
  }
  /** The buy box: off limits, the catalog's own facts, the same for everyone. */
  function renderBuyBox(p) {
    if (!$('bbTitle')) return;
    const price = priceOf(p);
    $('bbTitle').textContent = p ? productName(p) : 'Product';
    $('bbMeta').textContent = p ? idOf(p) : '';
    $('bbPrice').textContent = price != null ? money(price) : '';
    $('bbImage').innerHTML = imageOf(p) ? `<img src="${esc(imageOf(p))}" alt="">` : '';
  }
  async function openProduct(id, opts = {}) {
    const key = productKey();
    if (!key) throw new Error('the demo config names no product page');
    const p = productOf(id) || state.products[0] || null;
    await transport.ensureVisitor();
    state.productId = p ? idOf(p) : (id || null);
    showView(key);
    route(urlOf(key, { id: state.productId }));
    renderBuyBox(p);
    if (p && opts.event !== false) {
      await transport.send('product_view', productAttrs(p, { view: 'page' }));
      panels.note('opened', productName(p), 'a product page: its attributes are the event');
    }
    await askPage(key);
    scrollTop();
    return true;
  }

  // ── phone, sign-in, where-to-buy, report (P3) ─────────────────────────────
  // The phone (m.html boots the homepage at phone width), the live sign-in sheet (a fictional account from the
  // server's closed list; the worker mints the assertion), the two where-to-buy outcomes and the day report's
  // labels. Lane P3 writes here (and the facts it owns). Nothing yet: the phone runs the homepage's renderers.

  // ── The routes and the one dispatcher (shared). The cursor and a human hand run the same handler. ─
  async function restoreFromUrl() {
    const q = new URLSearchParams(location.search);
    if (/\/product(\.html)?$/.test(location.pathname)) return openProduct(q.get('id'), { event: false });
    if (q.get('view') && pageOf(q.get('view'))) return openPage(q.get('view'), { event: false });
    return openPage(homeKey(), { event: false });
  }
  async function handleControl(t) {
    await transport.creditDecided(t);
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
    const set = state.sets[state.viewPage] || null;
    return { set, groups: set ? slotsOf(state.viewPage).map((s) => [s.label, transport.bySlot(set, s.slot)]).filter(([, d]) => d.length) : [] };
  }
  function snapshotOfPage() {
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
      signIn: { account: SITE.signIn ? SITE.signIn.accounts[0] : null },
      clock: { days: SITE.clockJump ? SITE.clockJump.days : null },
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
      }
    } catch (error) {
      say(String(error.message || error), 'bad');
      engineDown(String(error.message || error));
    }
  })();
})();
