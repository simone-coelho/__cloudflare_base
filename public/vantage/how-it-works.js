/* public/vantage/how-it-works.js
 * ─────────────────────────────────────────────────────────────────────────────
 * The Vantage explainer for engineers (/vantage/how-it-works): the engine's
 * published arithmetic, recomputed in the browser so a reader can move the
 * constants. Every formula below carries the file:line it mirrors, and the
 * constants are the ones the demo publishes (scripts/seed-vantage.mjs at c720907, the
 * opening slots document public/vantage/beats/open-slots.json, the arrival seeds
 * public/vantage/seeds.json). Measured numbers come from the demo's facts sheet
 * (FACTS.md, kept with the explainer notes) and are marked as measured where they show.
 *
 * What this file is not: it decides nothing for the demo. The demo's decisions
 * come from the service; this page redoes the same arithmetic and says so.
 *
 * Posture: no credential, no storage, no HTML built from strings (every node is
 * created and filled with textContent). The one optional network call is the
 * demo's credential-free cold-start read, same origin, X-Tenant: vantage, sent
 * without cookies; its answer is validated field by field before it is used.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // 0 · Units, rounding, formatting, the DOM
  // ══════════════════════════════════════════════════════════════════════════
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const DAY = 24 * 60 * MINUTE;
  const SVGNS = 'http://www.w3.org/2000/svg';

  /** src/reflex/core.ts:733-735: four decimals, the grain of the affinity snapshot. */
  const round4 = (n) => Math.round(n * 10000) / 10000;
  /** src/reflex/regionTrend.ts:221, :247 and src/reflex/contentCompose.ts:116. */
  const round3 = (n) => Math.round(n * 1000) / 1000;
  /** src/content/decide.ts:156: three decimals, never a negative zero. */
  const r3 = (n) => { const v = Math.round(n * 1000) / 1000; return v === 0 ? 0 : v; };
  /** src/reflex/merchandising.ts:92. */
  const r4m = (n) => Math.round(n * 1e4) / 1e4;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

  const fx = (n, d) => (Number.isFinite(n) ? n.toFixed(d) : '–');
  const f3 = (n) => fx(n, 3);
  const f2 = (n) => fx(n, 2);
  const f1 = (n) => fx(n, 1);
  const wfmt = (w) => (Number.isInteger(w) ? String(w) : String(round3(w)));
  function dur(ms) {
    if (!Number.isFinite(ms)) return '–';
    const s = Math.abs(ms) / 1000;
    if (s < 100) return `${s.toFixed(1)} s`;
    if (s < 90 * 60) return `${(s / 60).toFixed(1)} min`;
    if (s < 48 * 3600) return `${(s / 3600).toFixed(1)} h`;
    return `${(s / 86400).toFixed(s < 10 * 86400 ? 2 : 1)} days`;
  }
  const tauLabel = (ms) => (ms % DAY === 0 ? `${ms / DAY} days` : (ms % MINUTE === 0 && ms >= 2 * MINUTE ? `${ms / MINUTE} min` : `${ms / 1000} s`));

  const $ = (id) => document.getElementById(id);
  function setAttrs(el, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') el.textContent = String(v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  function appendKids(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
  }
  /** Labels the stylesheet sets in capitals keep their case when they carry a formula: λ must not become Λ, nor a become A. */
  const MATHY = /[Ͱ-Ͽ̂̃ãΣ×·=≥≤^]|(^|[\s(])(?:[anstwk]|R|K|N)(?=[\s),/·*]|$)/;
  const CASED = ['inst-h', 'chart-k', 'k', 'mini-k', 'box-k'];
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    appendKids(el, kids);
    if ((tag === 'th' || CASED.some((c) => el.classList.contains(c))) && MATHY.test(el.textContent)) el.classList.add('nocase');
    return el;
  }
  function sv(tag, attrs, ...kids) { const el = document.createElementNS(SVGNS, tag); setAttrs(el, attrs); appendKids(el, kids); return el; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  /** θ with a subscript, as a node. */
  const theta = (which) => h('span', null, 'θ', h('sub', { text: which }));

  // ══════════════════════════════════════════════════════════════════════════
  // 1 · The published documents, as served on the demo worker on 2026-10-01
  //     (the facts sheet, FACTS.md §10: reflex r3, slots r51, learn r3),
  //     identical to scripts/seed-vantage.mjs at c720907 and public/vantage/seeds.json.
  //     The page's arithmetic reads these objects; section 8 displays them.
  // ══════════════════════════════════════════════════════════════════════════

  /** The three documents as served on the demo worker, verbatim from FACTS.md §10 (identical to scripts/seed-vantage.mjs at c720907). */
  const PUBLISHED = {
    registry: {
      K: 1.8, thetaIn: 0.6, thetaOut: 0.45, tauMs: 1209600000, epsilon: 0.01, maxValuesPerDim: 64,
      eventAttributes: 'event-when-unknown', version: 'reflex-vantage-v2-room-memory+r3',
      dimensions: [
        { key: 'category', source: 'category' },
        { key: 'brand', source: 'brand', tauMs: 60000 },
        { key: 'ecosystem', source: 'ecosystem' },
        { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [400, 900], labels: ['entry', 'core', 'premium'], tauMs: 600000 },
        { key: 'intent', source: 'intent', multi: true, tauMs: 600000 },
        { key: 'perk', source: 'perk', multi: true, tauMs: 600000 },
        { key: 'lines', source: 'lines' },
        { key: 'contentType', source: 'contentType', tauMs: 60000 },
      ],
      journey: { stages: [{ stage: 'thinking', anyOf: { product_views: 6 } }, { stage: 'deciding', anyOf: { cart_adds: 1, purchases: 1 } }] },
      weights: { product_view: 1, pdp_view: 1, view_product: 1, page_view: 1, search: 1.5, select: 2, filter: 2, compare: 2,
        wishlist: 2, wishlist_add: 2, add_to_wishlist: 2, save_for_later: 2, start_order: 3, add_to_cart: 3, cart_add: 3,
        purchase: 5, checkout: 5, order_complete: 5, content_impression: 0, content_dwell: 0.5, content_click: 1, video_complete: 2, tick: 0 },
    },
    slots: {
      version: 'slots-vantage+r51', governanceVersion: 3,
      pages: {
        home: [
          { slot: 'hero', take: 1, weights: { brand: 0.1, campaign: 0.3, ecosystem: 0.1, intent: 0.5, lines: 0.35 },
            stage: { inStage: 0.5, outOfStage: 0 },
            seeds: [{ signal: 'campaign_term', value: 'iphone-18-pro', tags: [{ dimension: 'campaign', value: 'iphone-18-pro' }], weight: 0.2 }] },
          { slot: 'deals', take: 4,
            weights: { brand: 0.2, campaign: 0.3, category: 0.1, ecosystem: 0.15, intent: 1, lines: 0.4, perk: 0.1, priceBand: 0.1 },
            merchandising: { maxBoost: 1.6, minBoost: 0.7, promotion: 0.1 },
            diversity: { dimension: 'brand', max: 2 },
            seeds: [
              { signal: 'campaign_term', value: 'iphone-18-pro', tags: [{ dimension: 'campaign', value: 'iphone-18-pro' }], weight: 0.2 },
              { signal: 'platform', value: 'ios', tags: [{ dimension: 'ecosystem', value: 'ios' }], weight: 1,
                dampen: [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'ecosystem', value: 'android', factor: 0 }] },
              { signal: 'platform', value: 'android', tags: [{ dimension: 'ecosystem', value: 'android' }], weight: 1,
                dampen: [{ dimension: 'intent', value: 'switch', factor: 0.5 }, { dimension: 'ecosystem', value: 'ios', factor: 0 }] }] },
        ],
        phone: [
          { slot: 'pdp-modules', take: 6, weights: { category: 0.15, contentType: 0.2, intent: 0.2, lines: 0.3, perk: 0.35, priceBand: 0.2 } },
          { slot: 'plan-pairing', take: 3, weights: { intent: 0.5, lines: 0.25, perk: 0.35 } },
        ],
      },
    },
    learn: {
      version: 'learn-vantage+r3',
      holdout: { share: 0, salt: 'vantage', arms: ['default'] },
      regional: { enabled: true, kBlend: 0.5, minEvents: 30, dimensions: ['brand', 'ecosystem', 'priceBand', 'category'] },
      policy: { scope: 'session', match: 'direct', credit: 'last',
        windowsMs: { click: 1800000, dwell: 1800000, video_complete: 1800000, custom: 1800000, wishlist: 21600000, add_to_bag: 21600000, purchase: 604800000 } },
      stats: { n0: 30, tauLearnMs: 1814400000, liftMin: 0.5, liftMax: 2, nMin: 30 },
      slots: {
        deals: { gamma: 0, reward: 'click', objective: 'unit', exploration: { mode: 'off', share: 0, floor: 0 } },
        hero: { gamma: 0, reward: 'click', objective: 'unit', exploration: { mode: 'off', share: 0, floor: 0 } },
        'pdp-modules': { gamma: 0, reward: 'click', objective: 'unit', exploration: { mode: 'off', share: 0, floor: 0 } },
        'plan-pairing': { gamma: 0, reward: 'click', objective: 'unit', exploration: { mode: 'off', share: 0, floor: 0 } },
      },
    },
  };

  /** The arithmetic reads exactly what is displayed: the engine constants are the served documents. */
  const REGISTRY = PUBLISHED.registry;

  /** The exact-value vocabularies: scripts/seed-vantage.mjs:81-90 at c720907. */
  const VOCAB = {
    category: ['phones', 'plans', 'home-internet', 'accessories', 'watches-tablets'],
    brand: ['apple', 'samsung', 'google', 'motorola'],
    ecosystem: ['ios', 'android'],
    priceBand: ['entry', 'core', 'premium'],
    intent: ['new', 'switch', 'upgrade', 'add-line', 'byod', 'home'],
    perk: ['streaming', 'music-games', 'hotspot-travel', 'international', 'family'],
    lines: ['solo', 'duo', 'family'],
    contentType: ['deal', 'compare', 'explainer', 'tool'],
  };

  const DEALS = PUBLISHED.slots.pages.home[1];
  const LEARN_DOC = PUBLISHED.learn;

  /** The phones rail: POST /sort over phones.json in its own order, dials on the request (public/vantage/phones.json `rail`). */
  const RAIL = { slot: 'phones-rail', take: 6, weights: { affinity: 1, dims: { brand: 1, ecosystem: 0.6, priceBand: 0.8 } } };

  /** The sixteen phones in the site's own order, at full retail (public/vantage/phones.json). */
  const PHONES = [
    { id: 'iphone-18-pro', name: 'iPhone 18 Pro', brand: 'apple', ecosystem: 'ios', price: 1199.99 },
    { id: 'iphone-18-pro-max', name: 'iPhone 18 Pro Max', brand: 'apple', ecosystem: 'ios', price: 1299.99 },
    { id: 'iphone-duo', name: 'iPhone Duo', brand: 'apple', ecosystem: 'ios', price: 1999.99 },
    { id: 'galaxy-s26-ultra', name: 'Galaxy S26 Ultra', brand: 'samsung', ecosystem: 'android', price: 1299.99 },
    { id: 'galaxy-s26-plus', name: 'Galaxy S26+', brand: 'samsung', ecosystem: 'android', price: 1099.99 },
    { id: 'galaxy-s26', name: 'Galaxy S26', brand: 'samsung', ecosystem: 'android', price: 899.99 },
    { id: 'galaxy-z-fold8', name: 'Galaxy Z Fold8', brand: 'samsung', ecosystem: 'android', price: 1899.99 },
    { id: 'galaxy-z-flip8', name: 'Galaxy Z Flip8', brand: 'samsung', ecosystem: 'android', price: 1199.99 },
    { id: 'pixel-11-pro', name: 'Pixel 11 Pro', brand: 'google', ecosystem: 'android', price: 1099.99 },
    { id: 'pixel-11', name: 'Pixel 11', brand: 'google', ecosystem: 'android', price: 899.99 },
    { id: 'iphone-air', name: 'iPhone Air', brand: 'apple', ecosystem: 'ios', price: 1099.99 },
    { id: 'iphone-17', name: 'iPhone 17', brand: 'apple', ecosystem: 'ios', price: 929.99 },
    { id: 'razr-2026', name: 'razr 2026', brand: 'motorola', ecosystem: 'android', price: 799.99 },
    { id: 'edge-2026', name: 'edge 2026', brand: 'motorola', ecosystem: 'android', price: 529.99 },
    { id: 'pixel-10a', name: 'Pixel 10a', brand: 'google', ecosystem: 'android', price: 499.99 },
    { id: 'moto-g-2026', name: 'moto g 2026', brand: 'motorola', ecosystem: 'android', price: 279.99 },
  ];
  const PHONE = Object.fromEntries(PHONES.map((p) => [p.id, p]));

  /**
   * The deals pool in the opening catalog's order (public/vantage/beats/open-catalog.json;
   * definitions at scripts/seed-vantage.mjs:212-378 at c720907). `gate` is eligibleWhen.context.intent,
   * `regions` eligibleWhen.regions; `live` is its window at the opening (the Pixel 11 season
   * offer opens when two weeks pass, beat 11).
   */
  const NEW_LINE = ['new', 'add-line'];
  const HOME_COVERAGE = ['US-TX', 'US-NY', 'US-NJ', 'US-PA', 'US-MA', 'US-IL', 'US-FL', 'US-GA', 'US-NC', 'US-CA',
    'US-AZ', 'US-CO', 'US-WA', 'US-MI', 'US-OH', 'US-VA', 'US-MN', 'US-TN'];
  const phoneTags = (brand, ecosystem, band, intent) => ({ category: ['phones'], brand: [brand], ecosystem: [ecosystem], priceBand: [band], intent, contentType: ['deal'] });
  const PROMOTIONS = [
    { id: 'promo-iphone-18-pro-launch', title: 'iPhone 18 Pro. Up to $1,200 off.', tags: { ...phoneTags('apple', 'ios', 'premium', ['new']), campaign: ['iphone-18-pro'] }, gate: NEW_LINE, merch: { promotion: 1 }, live: true, featured: ['iphone-18-pro', 'iphone-18-pro-max'] },
    { id: 'promo-galaxy-s26-new-line', title: 'Galaxy S26 on us with a new line.', tags: phoneTags('samsung', 'android', 'core', ['new']), gate: NEW_LINE, live: true, featured: ['galaxy-s26'] },
    { id: 'promo-four-lines', title: 'Four lines, $28 a line.', tags: { category: ['plans'], intent: ['add-line', 'new'], lines: ['family'], perk: ['family'], contentType: ['deal'] }, gate: NEW_LINE, live: true },
    { id: 'promo-bring-your-phone', title: 'Bring your phone. Keep your number.', tags: { category: ['plans'], intent: ['byod', 'switch'], lines: ['solo'], contentType: ['deal'] }, gate: ['new', 'byod'], live: true },
    { id: 'promo-pixel-11-launch', title: 'Pixel 11 on us, on a new line or upgrade.', tags: phoneTags('google', 'android', 'core', ['new', 'upgrade']), gate: ['new', 'add-line', 'upgrade'], live: true },
    { id: 'promo-pixel-11-season', title: 'Pixel 11. Up to $900 off with trade-in.', tags: phoneTags('google', 'android', 'core', ['new', 'upgrade']), gate: ['new', 'add-line', 'upgrade'], live: false, closed: 'window opens in 7 days (beat 11)' },
    { id: 'promo-iphone-duo-preorder', title: 'iPhone Duo. Pre-order 16 October.', tags: phoneTags('apple', 'ios', 'premium', ['new', 'upgrade']), gate: ['new', 'add-line', 'upgrade'], live: true },
    { id: 'promo-galaxy-s26-ultra-upgrade', title: 'Galaxy S26 Ultra. Up to $900 off your upgrade.', tags: phoneTags('samsung', 'android', 'premium', ['upgrade']), gate: ['upgrade'], live: true },
    { id: 'promo-iphone-18-pro-upgrade', title: 'iPhone 18 Pro. Up to $1,020 off your upgrade.', tags: phoneTags('apple', 'ios', 'premium', ['upgrade']), gate: ['upgrade'], live: true },
    { id: 'promo-galaxy-z-fold8-trade-in', title: 'Galaxy Z Fold8. Up to $1,100 off.', tags: phoneTags('samsung', 'android', 'premium', ['new']), gate: NEW_LINE, live: true },
    { id: 'promo-iphone-17-new-line', title: 'iPhone 17 on us with a new line.', tags: phoneTags('apple', 'ios', 'premium', ['new']), gate: NEW_LINE, live: true },
    { id: 'promo-razr-new-line', title: 'razr 2026 on us with a new line.', tags: phoneTags('motorola', 'android', 'core', ['new']), gate: NEW_LINE, live: true },
    { id: 'promo-moto-g-new-line', title: 'moto g 2026 on us with a new line.', tags: phoneTags('motorola', 'android', 'entry', ['new']), gate: NEW_LINE, live: true },
    { id: 'promo-edge-flash', title: 'edge 2026: $289.99 off.', tags: phoneTags('motorola', 'android', 'core', ['new']), gate: NEW_LINE, live: true },
    { id: 'promo-watch-tablet-line', title: 'Add a watch or tablet line.', tags: { category: ['watches-tablets'], intent: ['add-line'], lines: ['duo', 'family'], perk: ['family'], contentType: ['deal'] }, gate: ['new', 'add-line', 'byod'], live: true },
    { id: 'promo-streaming-perk', title: 'The streaming bundle, three months on us.', tags: { category: ['plans'], perk: ['streaming'], contentType: ['deal'] }, live: true },
    { id: 'promo-5g-home', title: 'Add 5G Home for $35 a month.', tags: { category: ['home-internet'], intent: ['home'], lines: ['duo', 'family'], contentType: ['deal'] }, regions: HOME_COVERAGE, live: true },
  ];
  const PROMO = Object.fromEntries(PROMOTIONS.map((p) => [p.id, p]));
  const CATALOG_ORDER = new Map(PROMOTIONS.map((p, i) => [p.id, i]));

  /**
   * The two rehearsed regions' synthetic sales, unit for unit
   * (scripts/seed-vantage-region.mjs:105-130 at c720907): one device sale touches category,
   * brand, ecosystem and price band at weight 1; a home-internet sale touches
   * category only. SYNTHETIC, labelled synthetic → warehouse wherever shown.
   */
  const REGION_SEED = {
    'US-NY': { label: 'New York', rows: [['apple', 'ios', 'premium', 170], ['apple', 'ios', 'core', 70], ['samsung', 'android', 'premium', 55], ['samsung', 'android', 'core', 40], ['samsung', 'android', 'entry', 10], ['google', 'android', 'premium', 25], ['google', 'android', 'core', 15], ['motorola', 'android', 'entry', 15]], home: 25 },
    'US-TX': { label: 'Texas', rows: [['samsung', 'android', 'core', 90], ['samsung', 'android', 'premium', 45], ['samsung', 'android', 'entry', 25], ['apple', 'ios', 'premium', 80], ['apple', 'ios', 'core', 70], ['google', 'android', 'premium', 20], ['google', 'android', 'core', 25], ['motorola', 'android', 'entry', 35], ['motorola', 'android', 'core', 10]], home: 90 },
  };
  const REGION_NAME = { 'US-NY': 'New York', 'US-TX': 'Texas', 'US-MT': 'Montana' };
  const LANDING_TERM = 'iphone-18-pro';

  /**
   * What the service returned when the demo was measured: the facts sheet, FACTS.md
   * §12 (and §9 for the receipt), quoted, never computed. "Hosted suite" is the request-level
   * suite on the demo worker; "E1 hosted" the facts lane's own reads, 2026-10-01. The suites
   * run in New York through the labelled ?region=US-NY override, from the ad, with no
   * platform header, so a measured row applies only under those conditions.
   */
  const FACTS = {
    sheet: 'the demo’s facts sheet, §12',
    conditions: { region: 'US-NY', ad: true, device: 'desktop' },
    steps: [
      { rows: ['hero 0.260; deals 0.671 · 0.550 · 0.388 · 0.338', 'the campaign seed applied: +0.066 on the launch offer, +0.060 on the hero'], src: 'the demo worker on 1 October 2026: the hosted suite and the facts sheet’s own reads' },
      { rows: ['brand samsung after the first touch: 0.352 (a local run: 0.356)'], src: 'the hosted suite' },
      { rows: ['brand samsung after the second touch: 0.513 (a local run: 0.523)'], src: 'the hosted suite' },
      { rows: ['brand samsung after the third touch: 0.612 (a local run: 0.621; an earlier hosted run: 0.614): over θin 0.60'], src: 'the hosted suite' },
      { rows: ['Galaxy S26 offer 0.353 first · Fold8 0.336 · Pixel 0.302 · launch offer 0.245 fourth, +0.066 applied', 'brand samsung 0.601'], src: 'the hosted suite' },
      { rows: ['re-asked at 52 s: brand samsung 0.398, under 0.45; ecosystem android 0.690; the order held', 'an earlier hosted run read 0.406; local runs 0.35 to 0.41'], src: 'the hosted suite' },
    ],
    texas: { ad: ['launch offer 0.563 · Galaxy S26 0.550 · Fold8 0.524 · Duo 0.452; hero 0.214'], noAd: ['Galaxy S26 offer first, 0.550'], src: 'the hosted suite' },
    newYorkNoAd: { rows: ['launch offer 0.605'], src: 'the demo worker' },
  };

  /** The real receipt, verbatim from the facts sheet, FACTS.md §9 (visitor id and nonce redacted there). */
  const RECEIPT = {
    decision_id: 'vantage:muq3x3y9:<visitor>:home:deals:0:n1:<nonce>',
    ts: 1790893784385, page: 'home', slot: 'deals', position: 0, ranking_position: 0,
    item_id: 'promo_iphone_18_pro_launch', customer_item_id: 'promo-iphone-18-pro-launch',
    arm: 'personalized', authority: 'engine', explored: false,
    cell: { channel: 'paid_social', visit_bucket: 'unknown', region: 'US-NC', affinity: null, stage: 'early' },
    journey: { stage: 'exploring', version: 'reflex-vantage-v2-room-memory+r3' },
    versions: { config: 3, catalog: 61, slots: 51, learn: 3, lift: 0, prior: 0, policy: 3 },
    config_label: 'reflex-vantage-v2-room-memory+r3',
    candidates: [
      { contentId: 'promo_iphone_18_pro_launch', score: 0.671 }, { contentId: 'promo_iphone_duo_preorder', score: 0.55 },
      { contentId: 'promo_iphone_17_new_line', score: 0.55 }, { contentId: 'promo_galaxy_z_fold8_trade_in', score: 0.388 },
      { contentId: 'promo_galaxy_s26_new_line', score: 0.338 }, { contentId: 'promo_pixel_11_launch', score: 0.284 },
      { contentId: 'promo_razr_new_line', score: 0.263 }, { contentId: 'promo_edge_flash', score: 0.263 },
      { contentId: 'promo_moto_g_new_line', score: 0.223 }, { contentId: 'promo_5g_home', score: 0.006 },
    ],
    explain: {
      drivers: [
        { dim: 'brand', value: 'apple', a: 1, weight: 0.2 }, { dim: 'ecosystem', value: 'ios', a: 1, weight: 0.15 },
        { dim: 'category', value: 'phones', a: 1, weight: 0.1 }, { dim: 'priceBand', value: 'premium', a: 1, weight: 0.1 },
        { dim: 'regional', value: 'US-NY', a: 1, weight: 0.55 }, { dim: 'merchandising', value: 'promotion', a: 1, weight: 0.1 },
      ],
      score_base: 0.61,
      regional: { region: 'US-NY', level: 'region', lambda: 1, version: 1790865492056, events: 425, asserted: true, contribution: 0.55 },
      lift: null,
      score_final: 0.671,
      contextual: { applied: 0.066, drivers: [
        { signal: 'campaign_term', value: 'iphone-18-pro', dimension: 'campaign', tag: 'iphone-18-pro', weight: 0.2, contribution: 0.066 }] },
      merchandising: { boost: 1.1, clamped: false,
        drivers: [{ term: 'promotion', value: 1, weight: 0.1, boost: 1.1, contribution: 0.061 }],
        sentence: 'promotion 1.00 at weight 0.10 gives 1.10x; 0.6100 to 0.6710' },
    },
    measurementBasis: 'served-v1',
    featured_product_ids: ['iphone-18-pro', 'iphone-18-pro-max'],
    asserted: { 'ctx.region': { value: 'US-NY', from: 'record' }, 'ctx.intent': { value: 'new', from: 'request' } },
  };


  // ══════════════════════════════════════════════════════════════════════════
  // 2 · The reflex core, line for line (src/reflex/core.ts)
  // ══════════════════════════════════════════════════════════════════════════

  const specOf = (reg, key) => reg.dimensions.find((d) => d.key === key);
  /** src/reflex/core.ts:276-283: a dimension's own τ, K and θ, else the document's. */
  function dimParams(reg, key) {
    const spec = specOf(reg, key);
    const own = (field) => (spec && spec[field] !== undefined ? spec[field] : reg[field]);
    return { tauMs: own('tauMs'), K: own('K'), thetaIn: own('thetaIn'), thetaOut: own('thetaOut') };
  }
  /** src/reflex/core.ts:182-187 */
  const slugValue = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  /** src/reflex/core.ts:190-192 */
  const audienceKey = (dim, value) => `${slugValue(dim)}_${slugValue(value)}_affinity`;
  /** src/reflex/core.ts:290-293: R_eff = R · e^(−Δt/τ), read lazily, never stored. */
  function effectiveScore(entry, now, tauMs) {
    const dt = Math.max(0, now - entry.t);
    return entry.s * Math.exp(-dt / tauMs);
  }
  /** src/reflex/core.ts:296-298: a = R / (R + K). */
  const affinityOf = (R, K) => (R <= 0 ? 0 : R / (R + K));
  /** src/reflex/core.ts:300-302 */
  const emptyState = (reg) => ({ v: 1, dims: {}, audiences: [], configVersion: reg.version });

  /** src/reflex/core.ts:309-337: the touches a product-shaped object produces under the registry. */
  function extractTouches(product, reg) {
    const touches = [];
    for (const spec of reg.dimensions) {
      const raw = product[spec.source];
      if (raw === undefined || raw === null) continue;
      if (spec.derive === 'band') {                                         // :315-323
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n) || !spec.cuts || !spec.labels) continue;
        let idx = spec.cuts.findIndex((cut) => n < cut);
        if (idx === -1) idx = spec.cuts.length;
        const label = spec.labels[idx];
        if (label) touches.push({ dim: spec.key, value: label, from: `${spec.source} ${n}` });
        continue;
      }
      if (spec.multi && Array.isArray(raw)) {                                // :325-330
        for (const v of raw) if (typeof v === 'string' && v.trim()) touches.push({ dim: spec.key, value: v, from: spec.source });
        continue;
      }
      if (typeof raw === 'string' && raw.trim()) touches.push({ dim: spec.key, value: raw, from: spec.source }); // :332-334
    }
    return touches;
  }

  /**
   * src/reflex/core.ts:567-657, the core transition:
   *   1. decay-then-accumulate every touched value: R ← R·e^(−Δt/τ) + w   (:580-592)
   *   2. prune what decayed under ε, cap the values per dimension          (:594-610)
   *   3. re-evaluate every membership with hysteresis                      (:612-628)
   */
  function apply(prev, action, touches, now, reg) {
    const base = prev && prev.v === 1 ? prev : emptyState(reg);
    const weight = reg.weights[action] !== undefined ? reg.weights[action] : 0;       // :574
    const dims = {};
    for (const d of Object.keys(base.dims)) dims[d] = { ...base.dims[d] };
    if (weight > 0) {
      for (const touch of touches) {
        if (!touch.value || !specOf(reg, touch.dim)) continue;
        const p = dimParams(reg, touch.dim);
        const dimMap = (dims[touch.dim] = dims[touch.dim] || {});
        const prevEntry = dimMap[touch.value];
        const carried = prevEntry ? effectiveScore(prevEntry, now, p.tauMs) : 0;      // :589
        dimMap[touch.value] = { s: carried + weight, t: now };                       // :590
      }
    }
    for (const d of Object.keys(dims)) {
      const p = dimParams(reg, d);
      const dimMap = dims[d];
      for (const v of Object.keys(dimMap)) if (effectiveScore(dimMap[v], now, p.tauMs) < reg.epsilon) delete dimMap[v]; // :599
      const values = Object.keys(dimMap);
      if (values.length > reg.maxValuesPerDim) {
        values.map((v) => ({ v, eff: effectiveScore(dimMap[v], now, p.tauMs) }))
          .sort((a, b) => a.eff - b.eff || (a.v < b.v ? -1 : 1))
          .slice(0, values.length - reg.maxValuesPerDim)
          .forEach(({ v }) => delete dimMap[v]);
      }
      if (Object.keys(dimMap).length === 0) delete dims[d];
    }
    const prevAud = new Set(base.audiences);
    const next = new Set();
    for (const d of Object.keys(dims).sort()) {
      const p = dimParams(reg, d);
      for (const v of Object.keys(dims[d]).sort()) {
        const a = affinityOf(effectiveScore(dims[d][v], now, p.tauMs), p.K);
        const key = audienceKey(d, v);
        if (prevAud.has(key) ? a >= p.thetaOut : a >= p.thetaIn) next.add(key);     // :626
      }
    }
    const entered = [...next].filter((k) => !prevAud.has(k)).sort();
    const exited = [...prevAud].filter((k) => !next.has(k)).sort();
    return { state: { v: 1, dims, audiences: [...next].sort(), configVersion: reg.version }, entered, exited };
  }

  /** src/reflex/core.ts:664-676: the live snapshot, a per value at `now`, four decimals. */
  function snapshot(state, now, reg) {
    const dims = {};
    for (const d of Object.keys(state.dims).sort()) {
      const p = dimParams(reg, d);
      const out = {};
      for (const v of Object.keys(state.dims[d]).sort()) out[v] = round4(affinityOf(effectiveScore(state.dims[d][v], now, p.tauMs), p.K));
      dims[d] = out;
    }
    return { dims, audiences: [...state.audiences] };
  }

  /** src/reflex/core.ts:717, :721-726: the closed-form exit, t* = t + τ·ln(R / floor), floor = K·θout/(1 − θout). */
  function exitInstant(entry, p) {
    const floor = (p.K * p.thetaOut) / (1 - p.thetaOut);
    if (entry.s <= floor) return entry.t;
    return entry.t + p.tauMs * Math.log(entry.s / floor);
  }

  /** The event a phone control sends (scripts/seed-vantage.mjs:659-671 at c720907; lane L2's event contract). */
  const phoneEvent = (p, view) => ({ type: 'product_view',
    data: { productId: p.id, category: 'phones', brand: p.brand, os: p.ecosystem, ecosystem: p.ecosystem, price_usd: p.price, view } });

  // ══════════════════════════════════════════════════════════════════════════
  // 3 · The regional prior (src/reflex/regionTrend.ts)
  // ══════════════════════════════════════════════════════════════════════════

  /** One frame per synthetic sale at weight 1, all at one instant (regionTrend.ts:86-107), so R per value is its unit count. */
  function regionR(seed) {
    const r = { category: {}, brand: {}, ecosystem: {}, priceBand: {} };
    const add = (dim, v, u) => { r[dim][v] = (r[dim][v] || 0) + u; };
    let events = 0;
    for (const [brand, ecosystem, band, units] of seed.rows) {
      add('category', 'phones', units); add('brand', brand, units); add('ecosystem', ecosystem, units); add('priceBand', band, units);
      events += units;
    }
    if (seed.home) { add('category', 'home-internet', seed.home); events += seed.home; }
    return { r, events };
  }
  /** src/reflex/regionTrend.ts:123-131: the within-dimension share, the leader = 1. */
  function sharesOf(r) {
    const share = {};
    for (const [dim, values] of Object.entries(r)) {
      const max = Math.max(0, ...Object.values(values));
      if (max <= 0) continue;
      share[dim] = Object.fromEntries(Object.entries(values).map(([v, x]) => [v, Math.round((x / max) * 1000) / 1000]));
    }
    return share;
  }
  /** src/reflex/regionTrend.ts:217-222: λ = k / (k + Σa) over every value of her own vector. */
  function lambdaFor(personal, kBlend) {
    let evidence = 0;
    for (const values of Object.values(personal || {})) for (const a of Object.values(values)) evidence += a;
    const k = kBlend > 0 ? kBlend : 1;
    return Math.round((k / (k + evidence)) * 1000) / 1000;
  }
  const evidenceOf = (personal) => { let e = 0; for (const values of Object.values(personal || {})) for (const a of Object.values(values)) e += a; return e; };
  /** src/reflex/regionTrend.ts:230-234: only the dimensions the tenant names blend. */
  function sharesWithin(share, dimensions) {
    if (!dimensions) return share;
    const allowed = new Set(dimensions);
    return Object.fromEntries(Object.entries(share || {}).filter(([dim]) => allowed.has(dim)));
  }
  /** src/reflex/regionTrend.ts:239-252: ã = (1 − λ)·a + λ·share, three decimals, a copy. */
  function blendAffinity(personal, regional, lambda) {
    const dims = {};
    const keys = new Set([...Object.keys(personal || {}), ...Object.keys(regional || {})]);
    for (const dim of keys) {
      const p = (personal && personal[dim]) || {}, r = (regional && regional[dim]) || {};
      const out = {};
      for (const v of new Set([...Object.keys(p), ...Object.keys(r)])) {
        const a = (1 - lambda) * (p[v] || 0) + lambda * (r[v] || 0);
        if (a > 0) out[v] = Math.round(a * 1000) / 1000;
      }
      if (Object.keys(out).length) dims[dim] = out;
    }
    return { dims, lambda };
  }
  const SEEDED_SHARE = Object.fromEntries(Object.entries(REGION_SEED).map(([k, seed]) => {
    const { r, events } = regionR(seed);
    return [k, { share: sharesOf(r), r, events, label: seed.label }];
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // 4 · One decision for the deals slot (src/content/decide.ts, src/reflex/contentCompose.ts)
  // ══════════════════════════════════════════════════════════════════════════

  /** src/content/lifecycle.ts:47-63 (and the window, :71-73): why a piece does not exist for this request, or null. */
  function ineligibleWhy(piece, ctx) {
    if (!piece.live) return piece.closed || 'outside its window';
    if (piece.regions && piece.regions.length) {
      const here = String(ctx.region || '').trim().toUpperCase();
      if (!here) return 'no region on the request: fails closed';
      const country = here.split('-')[0];
      if (!piece.regions.some((r) => r === here || r === country)) return `${REGION_NAME[here] || here} is not covered: fails closed`;
    }
    if (piece.gate && piece.gate.length) {
      if (typeof ctx.intent !== 'string' || !piece.gate.includes(ctx.intent)) return `needs intent ${piece.gate.join(' or ')}: fails closed`;
    }
    return null;
  }

  /** src/content/decide.ts:250-279: the seeds this arrival fires for a candidate, each at rule weight × the slot's weight. */
  function seedDriversFor(piece, slotDoc, ctx, audiences) {
    const rules = slotDoc.seeds || [];
    const held = new Set(audiences || []);                                     // :258, her own memberships only
    const term = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
    const arrival = term(ctx.utmTerm);
    const out = [];
    for (const rule of rules) {
      const fires = rule.signal === 'campaign_term' ? arrival !== '' && arrival === term(rule.value)   // :252-256
        : rule.signal === 'platform' ? ctx.platform != null && ctx.platform === rule.value
          : rule.signal === 'entry_channel' ? ctx.channel === rule.value : false;
      if (!fires) continue;
      const damped = (rule.dampen || []).filter((d) => held.has(audienceKey(d.dimension, d.value)));   // :269
      const weight = damped.reduce((w, d) => w * d.factor, rule.weight);                                // :270
      for (const tag of rule.tags) {
        const w = slotDoc.weights[tag.dimension] || 0;
        if (!w || !(piece.tags[tag.dimension] || []).includes(tag.value)) continue;
        out.push({ signal: rule.signal, value: rule.value, dimension: tag.dimension, tag: tag.value, weight: rule.weight, contribution: r3(weight * w), damped }); // :274
      }
    }
    return out;
  }

  /** src/reflex/merchandising.ts:101-160: the multipliers, Π(1 + w·v), clamped, each itemised as its delta. */
  function applyMerchandising(scoreBase, signals, weights) {
    const base = finite(scoreBase, 0), w = weights || {}, s = signals || {};
    const maxBoost = Math.max(1, finite(w.maxBoost, 2));
    const minBoost = clamp(finite(w.minBoost, 0.5), 0, 1);
    const active = [];
    let rawBoost = 1;
    for (const term of ['season', 'promotion', 'margin']) {
      const weight = clamp(finite(w[term], 0), -1, 1);
      if (weight === 0) continue;
      const value = clamp(finite(s[term], 0), 0, 1);
      const boost = 1 + weight * value;
      active.push({ term, value, weight, boost });
      rawBoost *= boost;
    }
    if (!active.length) return { scoreBase: r4m(base), scoreFinal: r4m(base), boost: 1, clamped: false, drivers: [] };
    const boost = clamp(rawBoost, minBoost, maxBoost);
    const scoreFinal = base * boost;
    let running = base;
    const raw = active.map((a) => { const next = running * a.boost; const d = next - running; running = next; return d; });
    const scale = running - base === 0 ? 0 : (scoreFinal - base) / (running - base);
    return { scoreBase: r4m(base), scoreFinal: r4m(scoreFinal), boost: r4m(boost), clamped: boost !== rawBoost,
      drivers: active.map((a, i) => ({ term: a.term, value: r4m(a.value), weight: r4m(a.weight), boost: r4m(a.boost), contribution: r4m(raw[i] * scale) })) };
  }

  /**
   * One candidate in one slot, the whole chain this demo's slots use:
   *   the tag sum                       src/reflex/contentCompose.ts:258-264
   *   + the seeds, where the sum lands  src/content/decide.ts:337-340
   *   × the merchandising multiplier    src/content/decide.ts:325-329
   *   × lift^γ, γ = 0 on stage          src/content/decide.ts:349-367
   * and what the seeds contributed, measured where it lands (decide.ts:341-348).
   */
  function scorePiece(piece, slotDoc, affinity, ctx, audiences) {
    const terms = [];
    let base0 = 0, madds = 0;
    for (const [dim, values] of Object.entries(piece.tags)) {
      const w = slotDoc.weights[dim] || 0;
      for (const v of values) {
        const a = (affinity[dim] && affinity[dim][v]) || 0;
        if (w) madds += 1;
        terms.push({ dim, value: v, a, w });
        if (!w || a <= 0) continue;
        base0 += a * w;
      }
    }
    const seeds = slotDoc.seeds ? seedDriversFor(piece, slotDoc, ctx, audiences) : [];
    let seeded = 0;
    for (const d of seeds) seeded += d.contribution;
    const merchOn = Boolean(slotDoc.merchandising) && ['season', 'promotion', 'margin'].some((t) => (slotDoc.merchandising[t] || 0) !== 0);
    const preLift = (b) => {
      if (!merchOn) return { base: b, m: null, before: b };
      const m = b > 0 ? applyMerchandising(b, piece.merch || null, slotDoc.merchandising) : null;
      return m && m.drivers.length ? { base: m.scoreFinal, m, before: b } : { base: b, m: null, before: b };
    };
    const lifted = preLift(base0 + seeded);
    const bare = seeded === 0 ? lifted : preLift(base0);
    const share = seeded === 0 ? 0 : (lifted.base - bare.base) / seeded;
    return {
      base0, terms, madds,
      seeds: seeds.map((d) => ({ ...d, applied: r3(d.contribution * share) })),
      seeded, seedApplied: slotDoc.seeds ? r3(lifted.base - bare.base) : 0,
      scoreBase: lifted.before, merch: lifted.m,
      gamma: 0, lift: 1,
      score: lifted.base,
    };
  }

  /**
   * src/reflex/contentCompose.ts:224-340, the take for one slot: a pinned prefix first and
   * unranked (:230-235, its brand counted toward the cap, :203, :306), then the ranking by
   * score with catalogue order breaking ties (:271), a value over the cap yielding its place
   * (:326-329) and filling a hole only if nothing else is eligible (:335-339). A pin on a piece
   * this request cannot see refuses the slot (:186-199, :229).
   */
  function takeSlot(scored, slotDoc, pinIds) {
    const pins = (pinIds || []).filter(Boolean);
    const byId = new Map(scored.map((s) => [s.piece.id, s]));
    if (pins.some((id) => !byId.has(id)) || pins.length > slotDoc.take) return { refused: true, served: [], ranked: [] };
    const rule = slotDoc.diversity && slotDoc.diversity.max >= 1 && slotDoc.diversity.dimension ? slotDoc.diversity : null;
    const seen = new Map();
    const served = [];
    for (const id of pins) {
      const s = byId.get(id);
      served.push({ ...s, pinned: true });
      if (rule) for (const v of s.piece.tags[rule.dimension] || []) seen.set(v, (seen.get(v) || 0) + 1);
    }
    const ranked = scored.filter((s) => !pins.includes(s.piece.id))
      .sort((x, y) => y.score - x.score || CATALOG_ORDER.get(x.piece.id) - CATALOG_ORDER.get(y.piece.id) || x.piece.id.localeCompare(y.piece.id));
    const remaining = slotDoc.take - pins.length;
    const yielded = [];
    let pending = [], taken = 0;
    for (const s of ranked) {
      if (taken >= remaining) break;
      if (rule) {
        const values = s.piece.tags[rule.dimension] || [];
        if (values.some((v) => (seen.get(v) || 0) >= rule.max)) { yielded.push(s); pending.push(s.piece.id); continue; }
        for (const v of values) seen.set(v, (seen.get(v) || 0) + 1);
      }
      served.push({ ...s, skipped: pending });
      pending = [];
      taken += 1;
    }
    for (const s of yielded) {
      if (taken >= remaining) break;
      served.push({ ...s, relaxed: true });
      taken += 1;
    }
    return { refused: false, served, ranked, yielded, rule };
  }

  const platformOf = (device) => (device === 'iphone' ? 'ios' : device === 'android' ? 'android' : null);

  /** The deals module for one shopper at one instant, as the service runs it ('served') or the tag sum alone ('own'). */
  function decideDeals(o) {
    const served = o.mode !== 'own';
    const slotDoc = {
      slot: 'deals', take: DEALS.take,
      weights: o.weights || DEALS.weights,
      diversity: o.cap === undefined ? DEALS.diversity : (o.cap ? { dimension: 'brand', max: o.cap } : null),
      seeds: served ? DEALS.seeds : undefined,
      merchandising: served ? DEALS.merchandising : undefined,
    };
    const personal = o.dims || {};
    let affinity = personal, lambda = null, share = null;
    if (served && o.share) {
      lambda = lambdaFor(personal, o.kBlend);                                          // src/content/service.ts:454
      share = sharesWithin(o.share, LEARN_DOC.regional.dimensions);                   // :458
      affinity = blendAffinity(personal, share, lambda).dims;                         // :459-460
    }
    const ctx = { intent: o.intent || 'new', region: o.region, utmTerm: o.ad ? LANDING_TERM : '', platform: platformOf(o.device) };
    const rows = PROMOTIONS.map((piece) => {
      const why = ineligibleWhy(piece, ctx);
      if (why) return { piece, why };
      const scored = scorePiece(piece, slotDoc, affinity, ctx, o.audiences);
      // decide.ts:421-435: what the region contributed, Σ λ·share·w over the piece's tags.
      let regional = 0;
      if (lambda !== null) for (const [dim, values] of Object.entries(piece.tags)) {
        const w = slotDoc.weights[dim] || 0;
        if (w) for (const v of values) regional += lambda * ((share[dim] && share[dim][v]) || 0) * w;
      }
      return { piece, ...scored, regional: round3(regional) };
    });
    const eligible = rows.filter((r) => !r.why);
    const take = takeSlot(eligible, slotDoc, o.pin ? [o.pin] : []);
    return { rows, eligible, take, lambda, share, affinity, ctx, slotDoc, personal };
  }

  /**
   * The record's driver list for one row: the four strongest tag terms by a × w
   * (src/reflex/contentCompose.ts:309-321), then the region's part, named with λ as its a and
   * Σλ·share·w / λ as its weight, then the merchandising terms (src/content/decide.ts:436-451).
   */
  function recordDrivers(row, lambda, region) {
    const out = row.terms.filter((t) => t.w && t.a > 0).sort((x, y) => y.a * y.w - x.a * x.w).slice(0, 4)
      .map((t) => ({ dim: t.dim, value: t.value, a: t.a, weight: t.w }));
    if (lambda !== null && row.regional > 0) out.push({ dim: 'regional', value: region, a: lambda, weight: round3(row.regional / (lambda || 1)) });
    if (row.merch) for (const md of row.merch.drivers) out.push({ dim: 'merchandising', value: md.term, a: md.value, weight: md.weight });
    return out;
  }

  /** src/reflex/sortCandidates.ts:109-150: the rail, her own vector only (src/routes/sort.ts:93-101, :116), stable on the site's order. */
  function sortRail(dims, weights) {
    const clampW = (v, lo, hi, fb) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
    const affinityWeight = clampW(weights.affinity, 0, 10, 1);
    const dimWeight = (dim) => clampW(weights.dims && weights.dims[dim], 0, 10, 1);
    const folded = {};
    for (const [dim, values] of Object.entries(dims || {})) { folded[dim] = {}; for (const [v, a] of Object.entries(values)) folded[dim][v.toLowerCase()] = a; }
    const scored = PHONES.map((p, feedRank) => {
      const touches = extractTouches({ id: p.id, brand: p.brand, ecosystem: p.ecosystem, os: p.ecosystem, price_usd: p.price }, REGISTRY);
      let score = 0;
      const drivers = [];
      for (const t of touches) {
        const a = (folded[t.dim] && folded[t.dim][t.value.toLowerCase()]) || 0;
        const w = dimWeight(t.dim);
        drivers.push({ dim: t.dim, value: t.value, a, w });
        if (a <= 0) continue;
        score += a * w;
      }
      return { p, feedRank, score: round4(score * affinityWeight), drivers, madds: touches.length };
    });
    scored.sort((x, y) => (y.score - x.score) || (x.feedRank - y.feedRank));
    return { scored, affinityWeight };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5 · Learning (src/learn/stats.ts, src/content/decide.ts:365)
  // ══════════════════════════════════════════════════════════════════════════
  /** src/learn/stats.ts:449 */
  const pooled = (s, n, n0, p0) => (s + n0 * p0) / (n + n0);
  /** src/learn/stats.ts:450 */
  const liftOf = (pHat, p0, lo, hi) => (p0 > 0 ? Math.min(hi, Math.max(lo, pHat / p0)) : 1);
  /** src/content/decide.ts:365 */
  const liftedScore = (base, lift, gamma) => base * Math.pow(lift, gamma);

  // ══════════════════════════════════════════════════════════════════════════
  // 6 · The worked example's timeline: beats 1 to 5 of the demo
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Fitted defaults, not the hosted suite's pace (its touches land 1 to 2.5 s apart and are
   * read about a second later, FACTS.md §1): with touches 3.5 s apart the page reproduces the
   * suite's 0.612 after the third (FACTS.md §12); a hinge read 2.6 s later reproduces brand
   * 0.601 and the four 0.353 · 0.336 · 0.303 · 0.245 (hosted: 0.302 for the Pixel offer, read later); a re-ask 52 s after the third touch
   * reproduces 0.398.
   */
  const EX_DEFAULTS = { region: 'US-NY', ad: true, device: 'desktop', gapS: 3.5, toPixelS: 2.6, reaskS: 52, kBlend: LEARN_DOC.regional.kBlend };

  /** Six moments, each a read of the same engine on the same documents. The homepage is asked at 0, 4 and 5; 1 to 3 show what it would answer. */
  function runScenario(opts) {
    const o = { ...EX_DEFAULTS, ...opts };
    const share = o.share || (SEEDED_SHARE[o.region] || SEEDED_SHARE['US-NY']).share;
    const t1 = 5 * SECOND, t2 = t1 + o.gapS * SECOND, t3 = t2 + o.gapS * SECOND, t4 = t3 + o.toPixelS * SECOND, t5 = Math.max(t4, t3 + o.reaskS * SECOND);
    const steps = [
      { n: 0, short: 'She lands', title: 'She lands from the ad', at: 0, events: [], asked: true },
      { n: 1, short: 'S26 card', title: 'A Galaxy S26 card', at: t1, events: [phoneEvent(PHONE['galaxy-s26'], 'card')], asked: false },
      { n: 2, short: 'S26 page', title: 'The Galaxy S26 page', at: t2, events: [phoneEvent(PHONE['galaxy-s26'], 'page')], asked: false },
      { n: 3, short: 'Ultra card', title: 'A Galaxy S26 Ultra card', at: t3, events: [phoneEvent(PHONE['galaxy-s26-ultra'], 'card')], asked: false },
      { n: 4, short: 'Pixel, home', title: 'The Pixel 11 page, then home', at: t4, events: [phoneEvent(PHONE['pixel-11'], 'page')], asked: true },
      { n: 5, short: `re-ask`, title: `Asked again, ${o.reaskS} s after the third touch`, at: t5, events: [], asked: true },
    ];
    let state = emptyState(REGISTRY);
    let samsungEntry = null;
    return steps.map((st) => {
      const fired = st.events.map((e) => {
        const touches = extractTouches(e.data, REGISTRY);
        const r = apply(state, e.type, touches, st.at, REGISTRY);
        state = r.state;
        return { e, touches, entered: r.entered, exited: r.exited };
      });
      if (state.dims.brand && state.dims.brand.samsung) samsungEntry = state.dims.brand.samsung;
      const snap = snapshot(state, st.at, REGISTRY);
      const decision = decideDeals({ dims: snap.dims, audiences: snap.audiences, mode: 'served', share, kBlend: o.kBlend, region: o.region === 'live' ? (o.liveRegion || null) : o.region, ad: o.ad, device: o.device, intent: 'new' });
      const samsungExit = samsungEntry ? exitInstant(samsungEntry, dimParams(REGISTRY, 'brand')) : null;
      return { ...st, fired, state, snap, decision, samsungExit, opts: o };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7 · Small shared pieces of UI
  // ══════════════════════════════════════════════════════════════════════════
  const DIM_LABEL = { category: 'category', brand: 'brand', ecosystem: 'ecosystem', priceBand: 'price band', intent: 'intent', perk: 'perk', lines: 'lines', contentType: 'content type', campaign: 'campaign' };
  const LOCAL_TAG = ['recomputed in your browser', false];
  const ROOM_TAG = ['memory compressed for the room', true];
  const SYN_TAG = ['regional sales: synthetic → warehouse', true];

  // ══════════════════════════════════════════════════════════════════════════
  // 7a · Hints: a circled question mark on every control group and instrument
  // ══════════════════════════════════════════════════════════════════════════
  // Each hint is a real button (keyboard-focusable, aria-label, aria-describedby). Its
  // tooltip lives in one layer on <body>, so no panel clips it; it opens on hover, focus
  // and tap, is placed inside the viewport, follows a scroll, and closes on Escape, blur
  // and a tap outside. Built from nodes and textContent like the rest: no library and no
  // inline handler. Every statement in TIPS below is drawn from the facts sheet.
  let tipSeq = 0, tipLayer = null, tipQuiet = false, tipFrame = 0;
  const OPEN = { btn: null, tip: null, why: new Set(), timer: 0 };
  /** A sentence with `code` spans, as nodes. */
  const rich = (s) => String(s).split('`').map((part, i) => (i % 2 ? h('code', { text: part }) : part));
  function placeTip(btn, tip) {
    const m = 8, vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    tip.style.maxWidth = `${Math.min(360, vw - 2 * m)}px`;
    tip.style.maxHeight = `${vh - 2 * m}px`;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const b = btn.getBoundingClientRect(), r = tip.getBoundingClientRect();
    const left = clamp(b.left + b.width / 2 - r.width / 2, m, Math.max(m, vw - m - r.width));
    let top = b.bottom + 8;
    if (top + r.height > vh - m) top = b.top - 8 - r.height >= m ? b.top - 8 - r.height : Math.max(m, vh - m - r.height);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }
  // Clears the state before touching the DOM: hiding a tooltip that holds focus fires focusout, which calls back in.
  function hideTip() {
    clearTimeout(OPEN.timer);
    const { btn, tip } = OPEN;
    if (!tip) return;
    OPEN.btn = null;
    OPEN.tip = null;
    OPEN.why.clear();
    tip.hidden = true;
    btn.classList.remove('is-open');
  }
  function showTip(btn, tip, why) {
    clearTimeout(OPEN.timer);
    if (OPEN.tip !== tip) { hideTip(); OPEN.btn = btn; OPEN.tip = tip; tip.hidden = false; btn.classList.add('is-open'); }
    OPEN.why.add(why);
    placeTip(btn, tip);
  }
  function leaveSoon(tip) {
    clearTimeout(OPEN.timer);
    OPEN.timer = setTimeout(() => { if (OPEN.tip !== tip) return; OPEN.why.delete('hover'); if (!OPEN.why.size) hideTip(); }, 160);
  }
  /** spec: { t: title, s: one to three sentences, f: a one-line formula (optional), and p (published in), q (quoted from) or np (not published) }. */
  function hint(spec, label) {
    const id = `hint-${++tipSeq}`;
    const where = spec.p ? ['Published in', spec.p] : spec.q ? ['Quoted from', spec.q] : ['Not published', spec.np || 'a page control'];
    const tip = h('div', { class: 'tip', id, role: 'tooltip', tabindex: '-1', hidden: true },
      h('p', { class: 'tip-t', text: spec.t }),
      h('p', { class: 'tip-d' }, rich(spec.s)),
      spec.f ? h('p', { class: 'tip-f', text: spec.f }) : null,
      h('p', { class: 'tip-p' }, h('span', { class: 'tip-pk', text: where[0] }), ' ', rich(where[1])));
    if (!tipLayer) { tipLayer = h('div', { class: 'tips' }); document.body.append(tipLayer); }
    tipLayer.append(tip);
    const btn = h('button', { type: 'button', class: 'hint', 'aria-label': `About ${String(label || spec.t).replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())}`, 'aria-describedby': id }, '?');
    btn.addEventListener('mouseenter', () => showTip(btn, tip, 'hover'));
    btn.addEventListener('mouseleave', () => leaveSoon(tip));
    tip.addEventListener('mouseenter', () => { if (OPEN.tip === tip) { clearTimeout(OPEN.timer); OPEN.why.add('hover'); } });
    tip.addEventListener('mouseleave', () => leaveSoon(tip));
    btn.addEventListener('focus', () => { if (!tipQuiet) showTip(btn, tip, 'focus'); });
    btn.addEventListener('blur', (e) => { if (OPEN.tip === tip && !tip.contains(e.relatedTarget)) hideTip(); });
    tip.addEventListener('focusout', (e) => { if (OPEN.tip === tip && e.relatedTarget !== btn && !tip.contains(e.relatedTarget)) hideTip(); });
    btn.addEventListener('click', () => { if (OPEN.tip === tip && OPEN.why.has('pin')) hideTip(); else showTip(btn, tip, 'pin'); });
    return btn;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !OPEN.tip) return;
    const btn = OPEN.btn, inside = OPEN.tip.contains(document.activeElement);
    hideTip();
    if (inside) { tipQuiet = true; btn.focus(); tipQuiet = false; }
  });
  document.addEventListener('pointerdown', (e) => { if (OPEN.tip && !OPEN.tip.contains(e.target) && !OPEN.btn.contains(e.target)) hideTip(); }, true);
  function followTip() {
    if (tipFrame || !OPEN.tip) return;
    tipFrame = requestAnimationFrame(() => {
      tipFrame = 0;
      if (!OPEN.tip) return;
      const b = OPEN.btn.getBoundingClientRect();
      if ((b.width === 0 && b.height === 0) || b.bottom < 0 || b.top > document.documentElement.clientHeight) hideTip();
      else placeTip(OPEN.btn, OPEN.tip);
    });
  }
  window.addEventListener('scroll', followTip, { passive: true, capture: true });
  window.addEventListener('resize', followTip);
  /** A heading inside an instrument, with its hint. */
  const ih = (text, tip) => h('p', { class: 'inst-h' }, text, hint(tip, text));
  /** A static frame around a body that is redrawn, with the frame's hint in its corner. */
  function framed(cls, body, tip, label) {
    body.classList.add('hint-body');
    return h('div', { class: `${cls} has-hint` }, h('div', { class: 'hint-corner' }, hint(tip, label)), body);
  }

  /** What every hint says. Constants, fields and figures are the facts sheet's (§1–§5, §9–§12). */
  const TIPS = {
    s1: { t: 'One candidate’s score, taken apart', s: 'Each row is one tag of the Galaxy S26 offer: her interest in its value, the deals slot’s weight for its dimension, and their product. A tag scores only when she has an interest in its value and the slot weighs its dimension; the bottom line is the sum, on her own vector before the regional prior.', f: 'score = Σ over its tags of a × w', p: 'the slots document, deals `weights` (`pages.home[1].weights`); the offer’s `tags`, in the catalog' },

    s2head: { t: 'One coordinate of one shopper', s: 'What the engine keeps for one dimension value: the evidence R and the time of its last touch, read on the constants the sliders set. Everything in this panel is recomputed in your browser on every change.', p: 'the dimension registry: `K`, `thetaIn`, `thetaOut` and the dimension’s `tauMs`' },
    s2K: { t: 'K, the evidence constant', s: 'The evidence at which interest is one half; interest never reaches 1, so more evidence always counts, by less each time. Moving it redraws both charts, the readout and the three worked numbers.', f: 'a = R / (R + K)', p: 'the dimension registry, `K`: 1.8' },
    s2tau: { t: 'τ, this coordinate’s memory', s: 'How fast stored evidence fades: by a factor of e for every τ since the last touch. Brand is published at 60 s for the room; a dimension that names no τ takes the registry’s 14 days. Moving it redraws the chart against time, t* and the third worked number.', f: 'R_eff = R · e^(−Δt/τ)', p: 'the dimension registry, brand’s `dimensions[1].tauMs`: 60000; the default `tauMs`: 14 days' },
    s2in: { t: 'θin, the entry line', s: 'She joins this value’s audience when her interest reaches the line: evidence R ≥ 2.7 at the published constants. Only a touch can make her join. Moving it moves the solid green line, the band and the touch at which she enters.', f: 'enter when a ≥ θin', p: 'the dimension registry, `thetaIn`: 0.6' },
    s2out: { t: 'θout, the exit line', s: 'She leaves only when her interest falls under this lower line, R < 1.4727 at the published constants, so a shopper near one line does not flap in and out. The validator refuses a θout that is not below θin, and so does this slider. Moving it moves the dashed green line, the band’s end and t*.', f: 'leave when a < θout', p: 'the dimension registry, `thetaOut`: 0.45' },
    s2w: { t: 'w, the action’s weight', s: 'What the next press adds to the evidence; an action no table names adds 0. Moving it redraws the chart against touches and the worked numbers, and changes what the next press adds.', f: 'R ← R_eff + w', p: 'the dimension registry, `weights`, for example `product_view`: 1' },
    s2presets: { t: 'Weights from the published table', s: 'Each button sets w to the weight the registry gives that action: a view 1, a search 1.5, a selector or a compare 2, a cart add 3, a purchase 5.', p: 'the dimension registry, `weights`: `product_view`, `search`, `select`, `compare`, `add_to_cart`, `purchase`' },
    s2touch: { t: 'Touches and the clock', s: 'Press adds one touch of weight w at the clock’s time now. The clock can be paused or run five or twenty times faster, so a minute of fading plays out in seconds; the last two buttons clear the touches and put the published constants back.', np: 'page controls; they drive the chart against time and the readout' },
    s2chartA: { t: 'Interest against touches', s: 'Her interest after n touches with no time between them, at the current K and w, with the two audience lines. The yellow line marks the touch at which she enters.', f: 'a = n·w / (n·w + K)', p: 'the dimension registry, `K`, `thetaIn`, `thetaOut`' },
    s2chartB: { t: 'Interest against time', s: 'Her interest on the clock as you press: solid is what happened, dashed what happens if nothing else does, and the green band is when she is in the audience. The yellow line t* is the instant she leaves, solved in closed form, so nothing has to poll for it.', f: 't* = t + τ · ln(R (1 − θout) / (K θout))', p: 'the dimension registry, `K`, `thetaIn`, `thetaOut` and the dimension’s `tauMs`' },
    s2read: { t: 'The readout, at this instant', s: 'The evidence stored at the last touch, the evidence left now, her interest, whether she is in the audience, and when she leaves. Nothing is decayed in storage: every value here is computed from the clock at the read.', f: 'a = R_eff / (R_eff + K)', p: 'the dimension registry, `K`, `thetaIn`, `thetaOut`, `tauMs`' },
    s2worked: { t: 'The three worked numbers', s: 'One touch, three touches close together, and the time from three touches to under θout, at the constants above. At the published constants they read 0.357, 0.625 and 42.7 s at τ 60 s.', f: 'a = w / (w + K); τ · ln(3w (1 − θout) / (K θout))', p: 'the dimension registry, `K`, `thetaIn`, `thetaOut`; brand’s `tauMs`' },

    s3event: { t: 'The event the page sends', s: 'The request the demo page sends when she views a phone: its type and the product’s own attributes. It changes on every press in the panel below.', p: 'the dimension registry, `weights.product_view`: 1, what one view adds' },
    s3touches: { t: 'What the engine extracts', s: 'One touch per registry dimension whose source field is on the event: a string is one value, a list several, and the price is banded at 400 and 900. A field no dimension names, such as os, is ignored.', p: 'the dimension registry, `dimensions`: each `source`, and `cuts` [400, 900] on `priceBand`' },
    s3head: { t: 'One shopper, live', s: 'A shopper held in this browser on the published registry. Each press is one product view, applied with the engine’s arithmetic; sections 4 and 5 score this same shopper.', p: 'the dimension registry: `weights`, `dimensions`, `K`, `thetaIn`, `thetaOut`' },
    device: { t: 'A product view', s: 'Each button is one product_view of that phone at weight 1, carrying its brand, ecosystem, price and category, so one press touches four coordinates at once. The last button empties her state: a stranger again.', p: 'the dimension registry, `weights.product_view`: 1' },
    s3meters: { t: 'Her vector', s: 'A meter per coordinate she has, her interest read from the clock now. The solid tick is θin and the dotted tick θout; a white bar means she is in that audience, and a meter that glows was just touched.', p: 'the dimension registry, `thetaIn` 0.6, `thetaOut` 0.45 and each dimension’s `tauMs`' },
    s3state: { t: 'The whole state', s: 'Everything the engine stores for her: per value, the evidence as of its last touch and the time of that touch. Interest is computed from the two at every read, which is why nothing has to run to make it fade.', f: 'a = R·e^(−Δt/τ) / (R·e^(−Δt/τ) + K)', p: 'the dimension registry, `K` and each dimension’s `tauMs`; at most `maxValuesPerDim` 64 values, pruned under `epsilon` 0.01' },

    s4head: { t: 'One slot, every candidate', s: 'The shopper’s vector scored against every candidate in one slot: eligibility first, then the sum over each candidate’s tags of her interest times the slot’s weight, then the slot’s rules take the top N. Recomputed in your browser on the published documents.', f: 'score = Σ a[d][v] × w_slot[d]', p: 'the slots document, deals (`pages.home[1]`); the rail’s dials are not published: they travel on each POST /sort' },
    s4vec: { t: 'Her vector, from section 3', s: 'The same live shopper as section 3: a press here or there moves both. The line lists every coordinate she has now; an empty vector is a stranger, scored on her region’s prior when scoring as served.', p: 'the dimension registry (her vector); the learn document, `regional` (the prior)' },
    s4slot: { t: 'Which slot', s: 'The homepage deals module, 17 promotions with a take of 4, or the phones rail, which re-orders the site’s own phone grid. The weights belong to the slot, so the same interest counts differently in each.', p: 'the slots document, deals `take`: 4; the rail’s dials are not published: they travel on each POST /sort' },
    s4mode: { t: 'Score with', s: 'As served is the whole decision: her vector blended with the region’s prior, the arrival’s seeds and the promotion multiplier, at γ = 0. The tag sum alone is the plain dot product on her own vector. It changes every score in the table and the four containers.', p: 'the learn document, `regional`; the slots document, deals `seeds` and `merchandising`' },
    s4intent: { t: 'Asserted intent', s: 'The intent the page asserts for this request. Eligibility runs before scoring and fails closed: an offer gated to other intents is not scored at all. It changes which rows are scored.', p: 'each promotion’s `eligibleWhen.context.intent`, in the catalog' },
    s4cap: { t: 'The diversity cap', s: 'At most this many pieces of one brand in the four: a third yields its container to the next ranked piece, and unbranded offers never count. It moves the containers and the rows marked yielded.', p: 'the slots document, deals `diversity`: `brand`, `max` 2' },
    s4pin: { t: 'A pin', s: 'A pinned piece is a required prefix: it takes container 1 and is never ranked. If it is not eligible for this request, the whole slot serves nothing and records a pin diagnostic: the engine’s current behaviour.', p: 'the slots document, deals `pinnedPieceIds`: none in the opening document; beat 13 pins the Duo' },
    s4weights: { t: 'The slot’s weights', s: 'What each dimension is worth in this slot, from 0 to 1: per slot, never per product. A dimension weighted 0 contributes nothing, and the campaign weight scores only through the seed, because no event builds that dimension. Moving one changes every sum in the table.', f: 'score = Σ a × w', p: 'the slots document, deals `weights`: brand 0.2, campaign 0.3, category 0.1, ecosystem 0.15, intent 1, lines 0.4, perk 0.1, priceBand 0.1' },
    s4boxes: { t: 'The four containers', s: 'What the slot would serve: pinned pieces first, then the ranking under the cap, until four are filled. If every score is zero, the slot serves catalog order, labelled as the default.', p: 'the slots document, deals `take`: 4' },
    s4table: { t: 'Every candidate', s: 'Each promotion with its tags and its sum written out term by term: her interest in the value times the slot’s weight, plus any seed, times any promotion multiplier. Rows that fail eligibility are listed but not scored; blue terms are blended dimensions, yellow ones seeds.', p: 'the catalog, each promotion’s `tags` and `eligibleWhen`; the slots document, deals `weights`' },
    s4counts: { t: 'What it cost, counted', s: 'The lookups and multiply-adds this slot took: one per tag value on a weighted dimension, then one sort and a take of 4; the blend runs once per shopper. These are counts, not times: nothing has been timed on the service at 10,000 candidates.', p: 'the slots document, deals `weights` (which dimensions count)' },
    s4bench: { t: '10,000 synthetic candidates', s: 'Generates 10,000 candidates in this browser from the registry’s vocabulary at the real pool’s tag density, scores them against the same vector and weights, sorts them and takes four under the cap. It reports what it counted; it times nothing.', np: 'a page control; the candidates are synthetic and exist only in this browser' },
    s4railAff: { t: 'The rail’s affinity dial', s: 'Multiplies every score on the rail. At 0 every score is 0 and the order is the site’s own exactly, because the sort is stable on feed order.', f: 'score = dial × Σ a × w', np: 'sent on each POST /sort, from `rail.weights.affinity` in public/vantage/phones.json: 1. The slots document carries no sort dials.' },
    rail: {
      brand: { t: 'Rail weight: brand', s: 'What her brand interest is worth on the rail; the route clamps a weight to 0–10. Moving it re-scores and re-orders the rail.', np: 'sent on each POST /sort, from `rail.weights.dims.brand` in public/vantage/phones.json: 1' },
      ecosystem: { t: 'Rail weight: ecosystem', s: 'What her ecosystem interest is worth on the rail; the route clamps a weight to 0–10. Moving it re-scores and re-orders the rail.', np: 'sent on each POST /sort, from `rail.weights.dims.ecosystem` in public/vantage/phones.json: 0.6' },
      priceBand: { t: 'Rail weight: price band', s: 'What her price-band interest is worth on the rail; the route clamps a weight to 0–10. Moving it re-scores and re-orders the rail.', np: 'sent on each POST /sort, from `rail.weights.dims.priceBand` in public/vantage/phones.json: 0.8' },
    },
    s4railBoxes: { t: 'The rail’s first positions', s: 'The phones in the order the rail would show them, each with its position in the site’s own feed. The route never filters: every phone comes back, re-ordered.', np: 'sent on each POST /sort, from `rail` in public/vantage/phones.json' },
    s4railTable: { t: 'Every phone', s: 'Each phone with the touches it produces and its sum written out. The rail scores her own vector only: no prior, no seeds, no multiplier, no learning and no pins on this route.', f: 'score = dial × Σ a × w', np: 'sent on each POST /sort, from `rail.weights` in public/vantage/phones.json' },

    s5head: { t: 'The prior, the seeds and the hinge', s: 'The shopper scored the way a stranger is: her vector blended with her region’s synthetic sales at a weight λ that falls as her own evidence grows, plus the arrival’s seeds. Recomputed in your browser; the sales are synthetic, labelled synthetic → warehouse.', f: 'ã = (1 − λ)·a + λ·share', p: 'the learn document, `regional`: `kBlend` 0.5, `minEvents` 30, `dimensions` brand, ecosystem, priceBand, category' },
    s5region: { t: 'Region, its synthetic sales', s: 'Whose sales the prior speaks for: New York’s or Texas’s: Vantage’s synthetic sales, labelled synthetic → warehouse; in production, the customer’s own. It moves the shares, the blended vector, the stranger’s receipt and the hinge.', p: 'the learn document, `regional.minEvents`: 30, the events a region needs to answer; the sales themselves are seeded, not published' },
    s5ad: { t: 'Arrival', s: 'Whether she landed from the ad, whose landing entry carries utm_term=iphone-18-pro; the page resends it with every snapshot. From the ad, the campaign seed adds 0.2 on the campaign tag, which only the launch offer and the launch hero carry.', p: 'the slots document, deals `seeds[0]`: `campaign_term` iphone-18-pro, `weight` 0.2' },
    s5dev: { t: 'Her device', s: 'Only the OS family is read from the request: iOS, Android or nothing. On an iPhone or an Android phone the OS-family seed adds 1 on that ecosystem tag; a laptop sends neither, so no platform seed fires.', p: 'the slots document, deals `seeds[1]` and `seeds[2]`: `platform` ios and android, `weight` 1, with their `dampen` rules' },
    s5k: { t: 'kBlend, the prior’s strength', s: 'How long the region keeps speaking. At 0.5 a stranger has λ = 1, Σa = 0.5 gives λ = 0.5 and Σa = 3 gives 0.14; with no learn document at all, the compiled default is 1. It moves the λ curve, the blend, the receipt and the hinge.', f: 'λ = kBlend / (kBlend + Σa)', p: 'the learn document, `regional.kBlend`: 0.5' },
    s5ev: { t: 'Σa, her evidence', s: 'The sum of all her own interests, on every dimension: read live from the shopper in section 3, or set by hand with the slider that appears. It moves the dot on the λ curve and everything blended from it.', np: 'an input; her evidence comes from her own events' },
    s5sigma: { t: 'Σa set by hand', s: 'Sets her evidence directly, to read λ anywhere on the curve without pressing phones.', np: 'an input you set' },
    s5live: { t: 'Read this request’s region', s: 'Optional: asks the demo’s cold-start read for the lean the service holds for this request’s region, with X-Tenant: vantage, no credential and no cookie. Nothing is sent until you press it; the seeded New York and Texas numbers stay the default.', np: 'a read of the service (GET /vantage/api/coldstart); it changes no document' },
    s5lambda: { t: 'λ against her evidence', s: 'How much the population speaks as her evidence grows: red at the current kBlend, grey at the compiled default of 1, the white dot at her Σa now. The readout under it gives Σa, λ and her own share of the mix, 1 − λ.', f: 'λ = k / (k + Σa)', p: 'the learn document, `regional.kBlend`: 0.5' },
    s5lean: { t: 'The region’s share per value', s: 'Within each blended dimension the region’s leading value is 1 and the others are fractions of it: shares, not probabilities. The outline is the share; the count beside a value is the synthetic sales behind it.', f: 'share = R_value / R_leader', p: 'the learn document, `regional.dimensions`: brand, ecosystem, priceBand, category' },
    s5blend: { t: 'Her blended vector', s: 'For every value on a blended dimension: her own interest, the region’s share, and the mix at the current λ. Her stored vector is never written to; the blend is a copy made for this decision.', f: 'ã = (1 − λ)·a + λ·share', p: 'the learn document, `regional.kBlend` and `regional.dimensions`' },
    s5seeds: { t: 'The arrival’s seeds', s: 'Which seeds fire for this arrival and what each adds: the campaign seed, 0.2 × the slot’s campaign weight 0.3, on the launch offer; the OS-family seed, 1 × the ecosystem weight 0.15, halved while she holds intent switch and withdrawn once she holds the other ecosystem.', p: 'the slots document, deals `seeds`' },
    s5stranger: { t: 'A stranger’s receipt', s: 'The launch offer’s drivers as the record itemises them for a stranger: the four strongest tag terms, then the region’s part and the multiplier. Each a is the region’s share at λ = 1, not her own affinity: she has none yet.', p: 'the learn document, `regional`; the slots document, deals `weights` and `merchandising`' },
    s5hinge: { t: 'The hinge', s: 'The launch offer and the Galaxy S26 offer at every step of the worked example, on the settings above, with the best Android offer dashed. The yellow line marks where Android overtakes the launch offer; the campaign seed never switches off, her own evidence outgrows it.', p: 'the learn document, `regional.kBlend`; the slots document, deals `seeds` and `merchandising`' },

    s6head: { t: 'Two memories on one shopper', s: 'One shopper’s brand and ecosystem interest on one clock: brand forgets on 60 s for the room, ecosystem keeps the 14-day default. Recomputed in your browser.', p: 'the dimension registry, brand’s `dimensions[1].tauMs`: 60000; ecosystem names none, so the default `tauMs`: 14 days' },
    s6tauB: { t: 'τ brand', s: 'Brand’s memory: published at 60 s for the room, where the engine’s default is 14 days. It moves both brand curves and when the brand claim leaves.', f: 'R_eff = R · e^(−Δt/τ)', p: 'the dimension registry, `dimensions[1].tauMs`: 60000' },
    s6tauE: { t: 'τ ecosystem', s: 'Ecosystem’s memory: 14 days as published, 90 days as the design proposes for production and the validator’s cap, or an hour to watch it fade here. It moves the ecosystem curve.', p: 'the dimension registry, the default `tauMs`: 14 days' },
    s6clock: { t: 'Clock speed', s: 'Runs this panel’s clock one, five or twenty times faster, so a minute of fading plays out in seconds.', np: 'a page control' },
    s6views: { t: 'A Galaxy view, a Pixel view', s: 'Each press is one view at weight 1: the Galaxy touches brand samsung and ecosystem android, the Pixel brand google and ecosystem android. Reset clears both memories.', p: 'the dimension registry, `weights.product_view`: 1' },
    s6chart: { t: 'Interest against time', s: 'Brand samsung, brand google and ecosystem android on one clock, with the entry and exit lines: solid is what happened, dashed what happens if she stops. A yellow line marks when a claim will leave.', p: 'the dimension registry, `K`, `thetaIn`, `thetaOut` and each dimension’s `tauMs`' },
    s6who: { t: 'Who is in, and until when', s: 'A meter per value with her interest now and, for each claim, whether she is in the audience and when she leaves, solved in closed form. Watch brand leave while ecosystem holds.', f: 't* = t + τ · ln(R (1 − θout) / (K θout))', p: 'the dimension registry, `thetaIn` 0.6, `thetaOut` 0.45' },

    exHead: { t: 'Beats 1 to 5, recomputed', s: 'The demo’s opening scenario on the published documents: each step recomputes her touches, the decay, her vector, λ, the blend, the seeds, the multiplier, the sums and the take. Beside it is what the service returned when the demo was measured.', p: 'the dimension registry, the slots document and the learn document, as served: r3, r51, r3' },
    exSteps: { t: 'The six steps', s: 'Each step is one moment: she lands from the ad, views a Galaxy S26 card and then its page, an S26 Ultra card, then the Pixel 11 page and goes home, and is asked again later. The homepage is asked at steps 0, 4 and 5; steps 1 to 3 show what it would answer.', np: 'a page control; t is seconds on the scenario’s clock' },
    exRegion: { t: 'Region', s: 'Whose synthetic sales the prior speaks for. New York, from the ad on a laptop, has a measured row at every step; Texas was measured on arrival only.', p: 'the learn document, `regional.minEvents`: 30; the sales are seeded, labelled synthetic → warehouse' },
    exAd: { t: 'Arrival', s: 'From the ad, the campaign seed fires on the launch offer and the launch hero; with no ad, it does not fire. It moves the launch offer’s score.', p: 'the slots document, deals `seeds[0]`: `weight` 0.2' },
    exDev: { t: 'Her device', s: 'Only the OS family is read, and a laptop fires no platform seed. The suites ran with no platform header, so only the laptop has measured rows.', p: 'the slots document, deals `seeds[1]` and `seeds[2]`: `weight` 1' },
    exGap: { t: 'Seconds between the Samsung touches', s: 'The spacing of the three Samsung touches. The fitted default, 3.5 s, reproduces the hosted reading of 0.612 after the third touch; brand forgets on 60 s, so a second of spacing moves the third decimal. It moves steps 1 to 5.', np: 'a fitted timing, not a measurement: the suite’s touches land 1 to 2.5 s apart and are read about a second later' },
    exPix: { t: 'Seconds from the third touch to the hinge', s: 'How long after the third Samsung touch the Pixel page and home come. The fitted default, 2.6 s, gives brand 0.601 at the hinge, as hosted; at a presenter’s pace the Samsung claim fades before she reaches home. It moves steps 4 and 5.', np: 'a fitted timing, not a measurement' },
    exAsk: { t: 'Seconds from the third touch to the re-ask', s: 'When the homepage is asked again. The default, 52 s, is when the hosted suite re-asked and read brand 0.398, under 0.45. It moves step 5.', np: 'a timing from the hosted suite, not a published constant' },
    exReset: { t: 'Back to the fitted defaults', s: 'Puts the region, the arrival, the device and the three timings back to New York, from the ad, a laptop, 3.5 s, 2.6 s and 52 s: the settings with which the page reproduces the hosted readings.', np: 'a page control' },
    exLeft: { t: 'This step, recomputed', s: 'What happened at this step, her own vector at the decision, λ and the blend, and the deals module: the four, then the ranking with every sum written out. All of it is recomputed here from the published documents.', f: 'score = (Σ ã × w + seeds) × multiplier', p: 'the dimension registry; the slots document, deals; the learn document, `regional`' },
    exRight: { t: 'Measured on the service', s: 'What the service returned when the demo was measured on 1 October 2026, beside what this page recomputes. A measured row is shown only under the conditions it was measured in, all with no platform header: New York through the labelled override from the ad at every step, and Texas, or New York without the ad, on arrival.', q: 'the demo’s facts sheet, §9 and §12' },

    s7head: { t: 'One item, one cell, one dial', s: 'One item’s counts in one cell of context, turned into a clamped lift and raised to the trust dial γ. Every input in this panel is yours to set; none is a measurement.', f: 'score = base × lift^γ', p: 'the learn document, `stats`: `n0` 30, `liftMin` 0.5, `liftMax` 2, `nMin` 30; `slots.deals.gamma`: 0' },
    s7n: { t: 'n, exposures', s: 'How many times the item was served in her cell, decayed over the 21-day horizon. More exposures let the item’s own rate outweigh the pull toward p0. It moves the pooled rate, the lift, the chart and the ladder.', p: 'the learn document, `stats.tauLearnMs`: 21 days' },
    s7s: { t: 's, successes', s: 'How many of those exposures were credited with a click; it cannot exceed n. It moves the item’s own rate, the pooled rate, the lift and the chart.', p: 'the learn document, `policy`: session scope, the last decision credited, a click counted for 30 minutes' },
    s7p0: { t: 'p0, the slot’s rate in this cell', s: 'The rate the whole slot earns in this cell, itself pulled toward the next coarser cell’s rate. The item’s rate is pulled toward it, and its lift is measured against it.', f: 'p0 = (s_slot + n0 · p0,parent) / (n_slot + n0)', np: 'an input you set: a rate the engine counts, not a constant' },
    s7n0: { t: 'n0, the shrinkage strength', s: 'How many observations’ worth of pull toward p0 the item’s rate carries, so a handful of lucky clicks cannot move it far. It moves the pooled rate, the chart’s curve and the lift.', f: 'p̂ = (s + n0 · p0) / (n + n0)', p: 'the learn document, `stats.n0`: 30' },
    s7gamma: { t: 'γ, the trust dial', s: 'How much of the lift reaches the score, from 0 to 1 per slot. At 0 any lift to the power 0 is 1: the lift is computed, recorded and ignored. It moves only lift^γ, the score and the sentence under the readout.', f: 'score = base × lift^γ', p: 'the learn document, `slots.deals.gamma`: 0, as on every slot' },
    s7base: { t: 'The base score', s: 'The score before the lift, which the dial multiplies. The default is the Galaxy S26 offer at the hinge, step 4 of the worked example.', np: 'an input you set' },
    s7read: { t: 'The estimate and the score', s: 'The pooled rate, the item’s own rate it is pulled from, the lift clamped to [0.5, 2], lift^γ, and the score before and after the dial.', f: 'lift = clamp(p̂ / p0, 0.5, 2)', p: 'the learn document, `stats.liftMin` 0.5 and `stats.liftMax` 2' },
    s7chart: { t: 'The pooled rate against exposures', s: 'At her rate s / n, how the pooled estimate moves from p0 toward that rate as exposures grow. The solid green lines are lift 0.5 and the clamp at 2, the dashed green line is p0, the blue dashed line her own rate, and the dot is n now.', f: 'p̂ = (s + n0 · p0) / (n + n0)', p: 'the learn document, `stats.n0`, `stats.liftMin`, `stats.liftMax`' },
    s7ladder: { t: 'The ladder', s: 'Six cells from everyone down to her leading interest: the finest cell where the item has at least 30 exposures answers, so thin contexts borrow from wider ones. The counts per cell are illustrative, set by the slider under this heading.', p: 'the learn document, `stats.nMin`: 30' },
    s7fan: { t: 'Each coarser cell holds × more', s: 'Illustrative: how many times more exposures each coarser cell holds than the one below it, to show which cell answers. It moves only the ladder.', np: 'an input you set, for the ladder' },

    s8reg: { t: 'The dimension registry', s: 'The axes of her vector and the field each reads, each dimension’s memory, the evidence constant, the two audience lines, and what each action adds. Every write is validated whole and stamped with a revision; this is r3.', p: 'PUT /config/reflex: `K`, `thetaIn`, `thetaOut`, `tauMs`, `dimensions`, `weights`, `journey`' },
    s8slots: { t: 'The slots', s: 'Per page, the slots in page order, each with its take, its weights and its rules: the stage rule, the seeds, the promotion multiplier, the diversity cap and pins. This is the opening state, r51.', p: 'PUT /content/slots: `pages.home[0]`, the hero; `pages.home[1]`, deals; and the phone page’s two slots' },
    s8learn: { t: 'What the slots learn', s: 'The prior’s blend, the attribution policy, the statistics’ constants, and each slot’s trust dial γ, which is 0 on every slot. Revision r3.', p: 'PUT /content/learn: `holdout`, `regional`, `policy`, `stats`, `slots`' },

    s9receipt: { t: 'The receipt', s: 'One record the service wrote for one served position: the launch offer in container 1, for a stranger from the ad, with New York asserted through the labelled override. A note in words sits beside every field; the visitor id and the nonce are redacted.', q: 'the demo’s facts sheet, §9, read from the demo worker on 1 October 2026' },
    s9recompute: { t: 'Recompute it', s: 'The same decision twice: from the receipt’s own terms, and from the published documents on this page, with the receipt’s ten candidates beside the page’s. The count of candidates that agree is computed, not typed.', f: '0.2 + 0.15 + 0.1 + 0.1 = 0.55; + 0.06 = 0.61; × 1.1 = 0.671', p: 'the slots document, deals `weights`, `seeds`, `merchandising`; the learn document, `regional`' },

    s10dims: { t: 'The registry’s dimensions', s: 'One line per dimension: the feed field it reads, how it is read, and the exact values the catalog uses. On a dimension the catalog names values on, a value outside them is simply not scored.', p: 'the dimension registry, `dimensions`; the vocabulary: the values the catalog’s `tags` name' },
    s10feed: { t: 'A promotion feed’s fields', s: 'Each field of a promotion grid and what the engine does with it: scored, a band, eligibility, a multiplier or a prefix, or display only. Eligibility runs before scoring; the offer book goes to the page.', q: 'the demo’s facts sheet, §11' },
  };

  function instHead(title, tags, tip) {
    return h('div', { class: 'inst-head' }, h('p', { class: 'inst-k' }, title, tip ? hint(tip, title.replace(/^Instrument · /, '')) : null),
      h('div', { class: 'inst-tags' }, (tags || []).map(([t, rep]) => h('p', { class: rep ? 'inst-tag inst-tag--rep' : 'inst-tag', text: t }))));
  }

  /** A clock that can run fast, pause and restart, for the instruments that show decay. */
  function makeClock() {
    let base = 0, anchor = performance.now(), speed = 1, running = true;
    const now = () => (running ? base + (performance.now() - anchor) * speed : base);
    return {
      now,
      setSpeed(s) { base = now(); anchor = performance.now(); speed = s; },
      pause() { if (!running) return; base = now(); running = false; },
      play() { if (running) return; anchor = performance.now(); running = true; },
      get running() { return running; },
      get speed() { return speed; },
    };
  }

  let uid = 0;
  /** A labelled range input. `values` makes it a stepped choice over a list. */
  function slider(o) {
    const id = `hiw-${++uid}`;
    const values = o.values || null;
    const toPos = (v) => (values ? Math.max(0, values.indexOf(v)) : v);
    const fromPos = (pos) => (values ? values[Math.round(pos)] : Number(pos));
    const out = h('output', { for: id });
    const input = h('input', { type: 'range', id, min: values ? 0 : o.min, max: values ? values.length - 1 : o.max, step: values ? 1 : o.step, value: toPos(o.value) });
    const show = () => { out.textContent = o.fmt(fromPos(input.value)); };
    input.addEventListener('input', () => { show(); o.on(fromPos(input.value)); });
    show();
    const el = h('div', { class: 'ctrl' }, h('div', { class: 'ctrl-top' }, h('span', { class: 'ctrl-l' }, h('label', { for: id }, o.label), o.tip ? hint(o.tip, o.label) : null), out), input,
      o.sub ? h('p', { class: 'ctrl-sub', text: o.sub }) : null);
    return { el, input, set(v) { input.value = String(toPos(v)); show(); }, get value() { return fromPos(input.value); } };
  }

  /** A segmented choice. */
  function seg(label, options, value, on) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const buttons = options.map(([v, text]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(v === value), text });
      b.addEventListener('click', () => { for (const x of buttons) x.setAttribute('aria-pressed', String(x === b)); on(v); });
      wrap.append(b);
      return b;
    });
    return { el: wrap, set(v) { options.forEach(([ov], i) => buttons[i].setAttribute('aria-pressed', String(ov === v))); } };
  }
  const ctrlBlock = (label, control, sub, tip) => h('div', { class: 'ctrl' }, h('div', { class: 'ctrl-top' }, h('span', { class: 'ctrl-l' }, h('label', { text: label }), tip ? hint(tip, label) : null)), control, sub ? h('p', { class: 'ctrl-sub', text: sub }) : null);

  function readoutCell(k, v, s, cls) { return h('div', null, h('p', { class: 'k', text: k }), h('p', { class: cls ? `v ${cls}` : 'v', text: v }), s ? h('p', { class: 's', text: s }) : null); }

  /** A meter in the demo's own style: the fill, the entry tick, the exit tick, the region's hollow lean. */
  function meterRow(o) {
    const fill = h('div', { class: o.member ? 'fill fill--in' : 'fill' });
    fill.style.width = `${clamp(o.a, 0, 1) * 100}%`;
    const track = h('div', { class: 'track' }, fill);
    if (o.lean !== undefined && o.lean > 0) { const l = h('div', { class: 'fill fill--lean' }); l.style.width = `${clamp(o.lean, 0, 1) * 100}%`; track.append(l); }
    if (o.ticks !== false) {
      const tin = h('div', { class: 'tick', title: `θin ${o.thIn}` }); tin.style.left = `${clamp(o.thIn, 0, 1) * 100}%`;
      const tout = h('div', { class: 'tick tick--out', title: `θout ${o.thOut}` }); tout.style.left = `${clamp(o.thOut, 0, 1) * 100}%`;
      track.append(tin, tout);
    }
    const shown = o.value !== undefined ? o.value : `${f3(o.a)}${o.member ? ' · in' : ''}`;
    return h('div', { class: o.touched ? 'meter meter--touched' : 'meter' },
      h('div', { class: 'meter-top' }, h('span', { class: 'nm' }, o.name, o.sub ? h('em', { text: o.sub }) : null),
        h('span', { class: o.member ? 'val in' : 'val', text: shown })), track);
  }

  /** A chart frame: axes, grid and the scale functions; marks are added by the caller. */
  function frame(o) {
    const W = o.w || 600, H = o.h || 240;
    const P = { l: 40, r: 14, t: 14, b: 28, ...(o.pad || {}) };
    const [x0, x1] = o.x, [y0, y1] = o.y;
    const X = (v) => P.l + ((v - x0) / ((x1 - x0) || 1)) * (W - P.l - P.r);
    const Y = (v) => H - P.b - ((v - y0) / ((y1 - y0) || 1)) * (H - P.t - P.b);
    const svg = sv('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label || '' });
    const ax = sv('g', { class: 'ax' });
    for (const t of o.yTicks || []) {
      ax.append(sv('line', { class: 'gl', x1: P.l, x2: W - P.r, y1: Y(t), y2: Y(t) }));
      ax.append(sv('text', { x: P.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', text: (o.yFmt || String)(t) }));
    }
    for (const t of o.xTicks || []) {
      ax.append(sv('line', { class: 'gl', y1: P.t, y2: H - P.b, x1: X(t), x2: X(t) }));
      ax.append(sv('text', { x: X(t), y: H - P.b + 15, 'text-anchor': 'middle', text: (o.xFmt || String)(t) }));
    }
    ax.append(sv('line', { class: 'axl', x1: P.l, x2: W - P.r, y1: H - P.b, y2: H - P.b }));
    ax.append(sv('line', { class: 'axl', x1: P.l, x2: P.l, y1: P.t, y2: H - P.b }));
    if (o.xLabel) ax.append(sv('text', { x: W - P.r, y: H - 3, 'text-anchor': 'end', text: o.xLabel }));
    if (o.yLabel) ax.append(sv('text', { x: P.l + 4, y: P.t + 9, text: o.yLabel }));
    svg.append(ax);
    const plot = sv('g');
    svg.append(plot);
    const inX = (v) => v >= Math.min(x0, x1) - 1e-9 && v <= Math.max(x0, x1) + 1e-9;
    return {
      svg, plot, X, Y, W, H, P,
      path(points, cls) {
        if (points.length < 2) return;
        plot.append(sv('path', { class: cls, d: points.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join('') }));
      },
      hline(v, cls, label, lcls) {
        plot.append(sv('line', { class: cls, x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v) }));
        if (label) plot.append(sv('text', { class: lcls || 'th-lbl', x: W - P.r - 2, y: Y(v) - 4, 'text-anchor': 'end', text: label }));
      },
      vline(v, cls, label, lcls, anchor) {
        if (!inX(v)) return;
        plot.append(sv('line', { class: cls, x1: X(v), x2: X(v), y1: P.t, y2: H - P.b }));
        if (label) plot.append(sv('text', { class: lcls || 'vl-lbl', x: X(v) + (anchor === 'end' ? -4 : 4), y: P.t + 10, 'text-anchor': anchor || 'start', text: label }));
      },
      band(xa, xb, cls) {
        const a = Math.max(Math.min(x0, x1), xa), b = Math.min(Math.max(x0, x1), xb);
        if (b <= a) return;
        plot.append(sv('rect', { class: cls || 'band', x: X(a), y: P.t, width: Math.max(0, X(b) - X(a)), height: H - P.t - P.b }));
      },
      dot(x, y, cls, r) { if (inX(x)) plot.append(sv('circle', { class: cls || 'dot', cx: X(x), cy: Y(y), r: r || 3.5 })); },
      text(x, y, s, cls, anchor, dy) { plot.append(sv('text', { class: cls || 'lbl', x: X(x), y: Y(y) + (dy || 0), 'text-anchor': anchor || 'start', text: s })); },
    };
  }

  /** Re-render the visible instruments five times a second; nothing runs for what is off screen. */
  const visible = new Set();
  const tickers = [];
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => { for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); } }, { rootMargin: '160px 0px' })
    : null;
  function everyTick(el, fn) { tickers.push({ el, fn }); if (io) io.observe(el); else visible.add(el); }
  setInterval(() => { for (const t of tickers) if (visible.has(t.el)) { try { t.fn(); } catch (err) { console.error(err); } } }, 200);

  /** The written-out sum for one candidate: "samsung 0.534×0.2 + …". Zero terms are counted, not printed. */
  function sumLine(row, opts) {
    const parts = [];
    const used = row.terms.filter((t) => t.w && t.a > 0);
    used.forEach((t, i) => {
      if (i) parts.push(' + ');
      parts.push(h('span', { class: (opts && opts.blended && LEARN_DOC.regional.dimensions.includes(t.dim)) ? 'reg' : null, text: `${t.value} ${f3(t.a)}×${wfmt(t.w)}` }));
    });
    if (!used.length) parts.push('no tag of this candidate carries an interest yet: 0');
    // Four decimals, the grain the multiplier rounds to before the score's three (merchandising.ts:92; contentCompose.ts:319).
    parts.push(' = ', h('b', { text: fx(r4m(row.base0), 4) }));
    for (const s of row.seeds || []) parts.push(h('span', { class: 'seed', text: ` + ${s.signal === 'campaign_term' ? 'campaign' : `${s.value} device`} seed ${f3(s.contribution)}` }));
    if (row.merch && row.merch.boost !== 1) parts.push(` × ${f2(row.merch.boost)} promotion`);
    return h('span', { class: 'sum' }, parts);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8 · The live shopper (sections 3, 4 and 5 share her)
  // ══════════════════════════════════════════════════════════════════════════
  const LIVE = { state: emptyState(REGISTRY), clock: makeClock(), touched: new Map(), last: null, listeners: [] };
  const liveNow = () => LIVE.clock.now();
  const liveSnap = () => snapshot(LIVE.state, liveNow(), REGISTRY);
  function liveView(phoneId) {
    const e = phoneEvent(PHONE[phoneId], 'card');
    const touches = extractTouches(e.data, REGISTRY);
    const r = apply(LIVE.state, e.type, touches, liveNow(), REGISTRY);
    LIVE.state = r.state;
    LIVE.last = { e, touches, entered: r.entered };
    const at = performance.now();
    for (const t of touches) LIVE.touched.set(`${t.dim}:${t.value}`, at);
    for (const fn of LIVE.listeners) fn();
  }
  function liveReset() { LIVE.state = emptyState(REGISTRY); LIVE.touched.clear(); LIVE.last = null; for (const fn of LIVE.listeners) fn(); }
  const DEVICE_BUTTONS = ['galaxy-s26', 'pixel-11', 'galaxy-s26-ultra', 'iphone-18-pro', 'moto-g-2026'];
  function deviceButtons(compact, tip) {
    const row = h('div', { class: 'btnrow' }, h('span', { class: 'btnrow-k', text: 'A product view' }), tip ? hint(tip, 'the product-view buttons') : null);
    for (const id of DEVICE_BUTTONS) {
      const p = PHONE[id];
      const b = h('button', { type: 'button', class: 'ib dev', title: `${p.name}: brand ${p.brand}, ecosystem ${p.ecosystem}, $${p.price}` },
        compact ? null : h('img', { src: `/vantage/img/devices/${p.id}.webp`, alt: '', width: 34, height: 34, loading: 'lazy' }),
        h('span', null, p.name, compact ? null : h('span', { class: 'sub', text: `${p.brand} · ${p.ecosystem} · $${p.price}` })));
      b.addEventListener('click', () => liveView(id));
      row.append(b);
    }
    row.append(h('button', { type: 'button', class: 'ib ib--ghost', text: 'Reset the shopper', onclick: liveReset }));
    return row;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 1 · The diagram
  // ══════════════════════════════════════════════════════════════════════════
  function initDiagram() {
    const mount = $('s1-diagram');
    if (!mount) return;
    const cap = $('s1-caption');
    if (cap) cap.prepend(hint(TIPS.s1, 'the diagram'));
    const draw = () => {
      const steps = runScenario({});
      const personal = steps[4].snap.dims;
      const piece = PROMO['promo-galaxy-s26-new-line'];
      const weights = DEALS.weights;
      const rows = [];
      for (const [dim, values] of Object.entries(piece.tags)) for (const v of values) {
        const a = (personal[dim] && personal[dim][v]) || 0;
        const w = weights[dim] || 0;
        rows.push({ dim, v, a, w, c: w && a > 0 ? a * w : 0 });
      }
      const others = [];
      for (const [dim, values] of Object.entries(personal)) for (const [v, a] of Object.entries(values)) if (!(piece.tags[dim] || []).includes(v)) others.push({ dim, v, a });
      const total = rows.reduce((s, r) => s + r.c, 0);
      const narrow = mount.clientWidth < 660;
      clear(mount).append(narrow ? diagramTall(rows, others, total) : diagramWide(rows, others, total));
    };
    draw();
    let pending = null;
    window.addEventListener('resize', () => { clearTimeout(pending); pending = setTimeout(draw, 150); });
  }
  function diagramWide(rows, others, total) {
    const rowH = 36, top = 74, W = 980;
    const H = top + rows.length * rowH + 96;
    const svg = sv('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    const head = (x, k, sub, anchor) => {
      svg.append(sv('text', { class: 'lbl lbl--r', x, y: 22, 'text-anchor': anchor || 'start', text: k }));
      svg.append(sv('text', { class: 'lbl lbl--d', x, y: 40, 'text-anchor': anchor || 'start', text: sub }));
    };
    head(18, 'HER VECTOR', 'per shopper: (R, t) per value, read as a');
    head(390, 'THE CANDIDATE’S TAGS', 'per product: the Galaxy S26 offer');
    head(650, 'THE SLOT’S WEIGHTS', 'per slot: deals');
    head(962, 'a × w', 'its part of the score', 'end');
    svg.append(sv('line', { class: 'axl', x1: 18, x2: 962, y1: 54, y2: 54 }));
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const hit = r.a > 0 && r.w;
      svg.append(sv('rect', { x: 18, y: y - 9, width: 250, height: 9, rx: 4, fill: '#26262B' }));
      if (r.a > 0) svg.append(sv('rect', { x: 18, y: y - 9, width: 250 * r.a, height: 9, rx: 4, fill: hit ? '#FF3A3A' : '#6a6a72' }));
      svg.append(sv('text', { class: r.a > 0 ? 'lbl' : 'lbl lbl--d', x: 282, y, text: r.a > 0 ? `a ${f3(r.a)}` : 'a 0 (none yet)' }));
      svg.append(sv('line', { x1: 362, x2: 386, y1: y - 4, y2: y - 4, stroke: hit ? '#8a8a92' : '#2A2A2F', 'stroke-width': 1 }));
      svg.append(sv('rect', { x: 390, y: y - 16, width: 212, height: 22, rx: 11, fill: '#141416', stroke: hit ? '#8a8a92' : '#2A2A2F' }));
      svg.append(sv('text', { class: hit ? 'lbl' : 'lbl lbl--d', x: 404, y: y - 1, text: `${DIM_LABEL[r.dim]} · ${r.v}` }));
      svg.append(sv('line', { x1: 606, x2: 642, y1: y - 4, y2: y - 4, stroke: hit ? '#8a8a92' : '#2A2A2F', 'stroke-width': 1 }));
      svg.append(sv('text', { class: r.w ? 'lbl' : 'lbl lbl--d', x: 650, y, text: r.w ? `× ${wfmt(r.w)}` : 'not weighted in this slot' }));
      svg.append(sv('text', { class: hit ? 'lbl lbl--r' : 'lbl lbl--d', x: 962, y, 'text-anchor': 'end', text: hit ? `= ${fx(r.c, 4)}` : '0' }));
    });
    const yb = top + rows.length * rowH;
    svg.append(sv('line', { class: 'axl', x1: 18, x2: 962, y1: yb - 14, y2: yb - 14 }));
    svg.append(sv('text', { class: 'lbl', x: 18, y: yb + 8, text: 'score = Σ over its tags of a × w' }));
    svg.append(sv('text', { class: 'lbl lbl--r', x: 962, y: yb + 8, 'text-anchor': 'end', text: `= ${fx(total, 4)}` }));
    const otherText = others.length ? `Also in her vector, not on this candidate: ${others.map((o) => `${DIM_LABEL[o.dim]} ${o.v} ${f3(o.a)}`).join(' · ')}.` : '';
    svg.append(sv('text', { class: 'lbl lbl--d', x: 18, y: yb + 36, text: otherText }));
    svg.append(sv('text', { class: 'lbl lbl--d', x: 18, y: yb + 56, text: 'They score other candidates (the Pixel offer, the premium offers). Nothing here was configured for the Galaxy S26.' }));
    return svg;
  }
  function diagramTall(rows, others, total) {
    const W = 360, rowH = 50, top = 92;
    const H = top + rows.length * rowH + 52 + others.length * 16;
    const svg = sv('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
    svg.append(sv('text', { class: 'lbl lbl--r', x: 8, y: 18, text: 'HER VECTOR · per shopper' }));
    svg.append(sv('text', { class: 'lbl', x: 8, y: 38, text: 'THE CANDIDATE’S TAGS · per product' }));
    svg.append(sv('text', { class: 'lbl lbl--d', x: 8, y: 58, text: 'THE SLOT’S WEIGHTS · per slot (deals)' }));
    svg.append(sv('line', { class: 'axl', x1: 8, x2: 352, y1: 70, y2: 70 }));
    rows.forEach((r, i) => {
      const y = top + i * rowH;
      const hit = r.a > 0 && r.w;
      svg.append(sv('text', { class: hit ? 'lbl' : 'lbl lbl--d', x: 8, y, text: `${DIM_LABEL[r.dim]} · ${r.v}` }));
      svg.append(sv('text', { class: hit ? 'lbl lbl--r' : 'lbl lbl--d', x: 352, y, 'text-anchor': 'end', text: hit ? `= ${fx(r.c, 4)}` : '0' }));
      svg.append(sv('rect', { x: 8, y: y + 9, width: 150, height: 8, rx: 4, fill: '#26262B' }));
      if (r.a > 0) svg.append(sv('rect', { x: 8, y: y + 9, width: 150 * r.a, height: 8, rx: 4, fill: hit ? '#FF3A3A' : '#6a6a72' }));
      svg.append(sv('text', { class: 'lbl lbl--d', x: 166, y: y + 17, text: `a ${f3(r.a)}  ${r.w ? `× ${wfmt(r.w)}` : 'not weighted'}` }));
    });
    const yb = top + rows.length * rowH;
    svg.append(sv('line', { class: 'axl', x1: 8, x2: 352, y1: yb - 16, y2: yb - 16 }));
    svg.append(sv('text', { class: 'lbl', x: 8, y: yb + 4, text: 'score = Σ a × w' }));
    svg.append(sv('text', { class: 'lbl lbl--r', x: 352, y: yb + 4, 'text-anchor': 'end', text: `= ${fx(total, 4)}` }));
    svg.append(sv('text', { class: 'lbl lbl--d', x: 8, y: yb + 30, text: 'Also in her vector, not on this candidate:' }));
    others.forEach((o, i) => svg.append(sv('text', { class: 'lbl lbl--d', x: 8, y: yb + 48 + i * 16, text: `${DIM_LABEL[o.dim]} ${o.v} ${f3(o.a)}` })));
    return svg;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 2 · Interest is a quantity
  // ══════════════════════════════════════════════════════════════════════════
  /** Membership over a touch log, exactly: entries only at touches (a touch only raises a), exits at the closed-form t* (core.ts:626, :717-726). */
  function membership(touches, K, tauMs, thIn, thOut, until) {
    const floor = (K * thOut) / (1 - thOut);
    let R = 0, tl = null, member = false, from = null;
    const spans = [];
    for (const tc of touches) {
      if (tc.t > until) break;
      if (member) {
        const tStar = R <= floor ? tl : tl + tauMs * Math.log(R / floor);
        if (tStar <= tc.t) { spans.push({ from, to: tStar }); member = false; }
      }
      R = (tl === null ? 0 : R * Math.exp(-(tc.t - tl) / tauMs)) + tc.w;
      tl = tc.t;
      if (!member && affinityOf(R, K) >= thIn) { member = true; from = tc.t; }
    }
    let exitAt = null;
    if (member) { exitAt = R <= floor ? tl : tl + tauMs * Math.log(R / floor); spans.push({ from, to: exitAt }); }
    return { spans, exitAt, R, tl, inNow: member && exitAt > until, floor };
  }
  /** R at time t from the touch log: Σ w·e^(−(t − tᵢ)/τ), identical to the recursive decay-then-accumulate. */
  function rAt(touches, t, tauMs) { let R = 0; for (const tc of touches) { if (tc.t > t) break; R += tc.w * Math.exp(-(t - tc.t) / tauMs); } return R; }

  function initS2() {
    const mount = $('s2-inst');
    if (!mount) return;
    const S = { K: REGISTRY.K, tau: 60 * SECOND, thIn: REGISTRY.thetaIn, thOut: REGISTRY.thetaOut, w: 1, touches: [], clock: makeClock() };
    const TAUS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600].map((s) => s * SECOND);
    const chartA = h('div');
    const chartB = h('div');
    const readout = h('div', { class: 'readout' });
    const worked = h('div', { class: 'worked' });
    const closed = h('p', { class: 'inst-note' });

    const kS = slider({ label: 'K, the evidence constant', tip: TIPS.s2K, min: 0.2, max: 6, step: 0.1, value: S.K, fmt: (v) => f1(v), sub: 'a = ½ when R = K. Published: 1.8.', on: (v) => { S.K = v; redrawAll(); } });
    const tauS = slider({ label: 'τ, this coordinate’s memory', tip: TIPS.s2tau, values: TAUS, value: S.tau, fmt: (v) => tauLabel(v), sub: 'Brand in this room: 60 s. The engine default: 14 days.', on: (v) => { S.tau = v; redrawAll(); } });
    const inS = slider({ label: 'θin, enter at', tip: TIPS.s2in, min: 0.2, max: 0.95, step: 0.01, value: S.thIn, fmt: f2, sub: 'Published: 0.60.', on: (v) => { S.thIn = v; if (S.thOut >= v) { S.thOut = round3(Math.max(0.05, v - 0.05)); outS.set(S.thOut); } redrawAll(); } });
    const outS = slider({ label: 'θout, leave under', tip: TIPS.s2out, min: 0.05, max: 0.9, step: 0.01, value: S.thOut, fmt: f2, sub: 'Published: 0.45. Kept under θin.', on: (v) => { S.thOut = Math.min(v, round3(S.thIn - 0.01)); if (S.thOut !== v) outS.set(S.thOut); redrawAll(); } });
    const wS = slider({ label: 'w, the action’s weight', tip: TIPS.s2w, min: 0.5, max: 5, step: 0.5, value: S.w, fmt: (v) => wfmt(v), sub: 'What the next press adds.', on: (v) => { S.w = v; redrawAll(); } });
    const presets = h('div', { class: 'btnrow' }, h('span', { class: 'btnrow-k', text: 'Weights from the table' }), hint(TIPS.s2presets, 'the weight buttons'),
      [['view', 1], ['search', 1.5], ['selector / compare', 2], ['cart add', 3], ['purchase', 5]].map(([n, w]) =>
        h('button', { type: 'button', class: 'ib', text: `${n} ${w}`, onclick: () => { S.w = w; wS.set(w); redrawAll(); } })));

    const pressB = h('button', { type: 'button', class: 'ib ib--red', text: 'Press: add a touch of weight w' });
    pressB.addEventListener('click', () => { S.touches.push({ t: S.clock.now(), w: S.w }); if (S.touches.length > 80) S.touches.shift(); redrawB(); });
    const pauseB = h('button', { type: 'button', class: 'ib', text: 'Pause the clock' });
    pauseB.addEventListener('click', () => { if (S.clock.running) { S.clock.pause(); pauseB.textContent = 'Run the clock'; } else { S.clock.play(); pauseB.textContent = 'Pause the clock'; } redrawB(); });
    const speed = seg('Clock speed', [[1, '×1'], [5, '×5'], [20, '×20']], 1, (v) => S.clock.setSpeed(v));
    const clearB = h('button', { type: 'button', class: 'ib ib--ghost', text: 'Clear the touches', onclick: () => { S.touches = []; redrawB(); } });
    const resetB = h('button', { type: 'button', class: 'ib ib--ghost', text: 'Back to the published constants' });
    resetB.addEventListener('click', () => {
      S.K = REGISTRY.K; S.tau = 60 * SECOND; S.thIn = REGISTRY.thetaIn; S.thOut = REGISTRY.thetaOut; S.w = 1;
      kS.set(S.K); tauS.set(S.tau); inS.set(S.thIn); outS.set(S.thOut); wS.set(S.w); redrawAll();
    });

    mount.append(
      instHead('Instrument · one coordinate, for example brand samsung', [LOCAL_TAG, ['τ of 60 s is the room’s, compressed', true]], TIPS.s2head),
      h('div', { class: 'ctrls' }, kS.el, tauS.el, inS.el, outS.el, wS.el),
      presets,
      h('div', { class: 'btnrow' }, h('span', { class: 'btnrow-k', text: 'Touches' }), hint(TIPS.s2touch, 'the touch buttons and the clock'), pressB, pauseB, speed.el, clearB, resetB),
      h('div', { class: 'cols' }, framed('chart-wrap', chartA, TIPS.s2chartA, 'the chart of interest against touches'), framed('chart-wrap', chartB, TIPS.s2chartB, 'the chart of interest against time')),
      ih('The readout, at this instant', TIPS.s2read), readout, closed,
      ih('The three worked numbers, at the constants above', TIPS.s2worked),
      worked,
    );

    function redrawA() {
      const N = 10;
      const fr = frame({ w: 520, h: 250, x: [0, N], y: [0, 1], xTicks: [0, 2, 4, 6, 8, 10], yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: (v) => f2(v), xLabel: 'touches, no time between them', label: 'a against the number of touches' });
      fr.band(0, N, 'band faint');
      fr.hline(S.thIn, 'th-in', `θin ${f2(S.thIn)}`);
      fr.hline(S.thOut, 'th-out', `θout ${f2(S.thOut)}`);
      const smooth = [];
      for (let i = 0; i <= 100; i++) { const n = (i / 100) * N; smooth.push([n, affinityOf(n * S.w, S.K)]); }
      fr.path(smooth, 'curve faint');
      let nStar = null;
      for (let n = 1; n <= N; n++) {
        const a = affinityOf(n * S.w, S.K);
        if (nStar === null && a >= S.thIn) nStar = n;
        fr.dot(n, a, a >= S.thIn ? 'dot dot--w' : 'dot');
      }
      if (nStar !== null) fr.vline(nStar, 'vl', `enters at touch ${nStar}`);
      clear(chartA).append(h('p', { class: 'chart-k', text: `a = n·w / (n·w + K) · w ${wfmt(S.w)}, K ${f1(S.K)}` }), fr.svg);
    }

    function redrawB() {
      const now = S.clock.now();
      const past = Math.max(60 * SECOND, 2 * S.tau), future = Math.max(30 * SECOND, S.tau);
      const t0 = Math.max(0, now - past), t1 = t0 + past + future;
      const span = (t1 - t0) / SECOND;
      const step = span > 1200 ? 300 : span > 600 ? 120 : span > 240 ? 60 : span > 120 ? 30 : 15;
      const ticks = [];
      for (let s = Math.ceil(t0 / SECOND / step) * step; s <= t1 / SECOND; s += step) ticks.push(s);
      const fr = frame({ w: 520, h: 250, x: [t0 / SECOND, t1 / SECOND], y: [0, 1], xTicks: ticks, yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: (v) => f2(v), xLabel: 'seconds on this clock', label: 'a against time, with the projection if nothing else happens' });
      const m = membership(S.touches, S.K, S.tau, S.thIn, S.thOut, now);
      for (const sp of m.spans) fr.band(sp.from / SECOND, Math.min(sp.to, t1) / SECOND, 'band');
      fr.hline(S.thIn, 'th-in', `θin ${f2(S.thIn)}`);
      fr.hline(S.thOut, 'th-out', `θout ${f2(S.thOut)}`);
      const solid = [], proj = [];
      const n = 220;
      for (let i = 0; i <= n; i++) {
        const t = t0 + (i / n) * (t1 - t0);
        const pt = [t / SECOND, affinityOf(rAt(S.touches, t, S.tau), S.K)];
        if (t <= now) solid.push(pt);
        if (t >= now - (t1 - t0) / n) proj.push(pt);
      }
      fr.path(solid, 'curve');
      fr.path(proj, 'curve proj');
      fr.vline(now / SECOND, 'now');
      for (const tc of S.touches) if (tc.t >= t0) fr.dot(tc.t / SECOND, 0.02, 'dot dot--y', 2.6);
      if (m.exitAt !== null) fr.vline(m.exitAt / SECOND, 'vl', m.exitAt > now ? 't*: leaves' : 't*: left', 'vl-lbl', m.exitAt / SECOND > (t0 + 0.75 * (t1 - t0)) / SECOND ? 'end' : 'start');
      clear(chartB).append(h('p', { class: 'chart-k', text: S.clock.running ? `a(t) live · clock ×${S.clock.speed}` : 'a(t) · the clock is paused' }), fr.svg);

      const Rnow = rAt(S.touches, now, S.tau), aNow = affinityOf(Rnow, S.K);
      const last = S.touches.length ? S.touches[S.touches.length - 1] : null;
      clear(readout).append(
        readoutCell('R stored', last ? f3(rAt(S.touches, last.t, S.tau)) : '0', last ? `at the last touch, ${dur(now - last.t)} ago` : 'no touch yet'),
        readoutCell('R_eff now', f3(Rnow), 'R · e^(−Δt/τ)'),
        readoutCell('a now', f3(aNow), 'R_eff / (R_eff + K)', m.inNow ? 'in' : null),
        readoutCell('In the audience', m.inNow ? 'yes' : 'no', m.inNow ? `entered at ≥ ${f2(S.thIn)}` : `enters at ≥ ${f2(S.thIn)}`, m.inNow ? 'in' : 'out'),
        readoutCell('Leaves at t*', m.exitAt === null ? '–' : (m.exitAt > now ? `in ${dur(m.exitAt - now)}` : `${dur(now - m.exitAt)} ago`), m.exitAt === null ? 'not in the audience' : 'closed form, no polling'),
      );
      if (last && m.exitAt !== null) {
        const R = rAt(S.touches, last.t, S.tau);
        closed.textContent = `t* = t + τ · ln(R · (1 − θout) / (K · θout)) = t + ${tauLabel(S.tau)} · ln(${f3(R)} × ${f2(1 - S.thOut)} / (${f1(S.K)} × ${f2(S.thOut)})) = t + ${dur(m.exitAt - m.tl)}, with t the last touch (src/reflex/core.ts:717, :726).`;
      } else closed.textContent = 'Press a few times: the band shows when she is in the audience, the dashed line what happens if she stops, and t* the instant she leaves, solved in closed form.';
    }

    function redrawWorked() {
      const a1 = affinityOf(S.w, S.K), a3 = affinityOf(3 * S.w, S.K);
      const floor = (S.K * S.thOut) / (1 - S.thOut);
      const exit3 = 3 * S.w <= floor ? 0 : S.tau * Math.log((3 * S.w) / floor);
      const published = S.K === REGISTRY.K && S.w === 1 && S.thIn === REGISTRY.thetaIn && S.thOut === REGISTRY.thetaOut && S.tau === 60 * SECOND;
      const card = (k, f, v, small) => h('div', null, h('p', { class: 'k', text: k }), h('p', { class: 'f', text: f }), h('p', { class: 'v' }, v, small ? h('small', { text: small }) : null));
      clear(worked).append(
        card('One touch', `a = w / (w + K) = ${wfmt(S.w)} / (${wfmt(S.w)} + ${f1(S.K)})`, f3(a1), published ? 'published: 0.357' : null),
        card('Three touches, close together', `a = 3w / (3w + K) = ${wfmt(3 * S.w)} / (${wfmt(3 * S.w)} + ${f1(S.K)})`, f3(a3), a3 >= S.thIn ? `enters (≥ ${f2(S.thIn)})` : `under θin ${f2(S.thIn)}`),
        card(`From ${f3(a3)} to under θout`, `τ · ln(3w (1 − θout) / (K θout)) = ${tauLabel(S.tau)} · ln(${f3(3 * S.w)} × ${f2(1 - S.thOut)} / (${f1(S.K)} × ${f2(S.thOut)}))`,
          exit3 > 0 ? dur(exit3) : 'already under', published ? 'about 43 s at τ 60 s' : null),
      );
    }
    function redrawAll() { redrawA(); redrawB(); redrawWorked(); }
    redrawAll();
    everyTick(mount, redrawB);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 3 · One click, four coordinates (the live shopper)
  // ══════════════════════════════════════════════════════════════════════════
  function eventText(e) {
    const lines = ['POST /realtime/action', '{', `  "type": "${e.type}",`, '  "data": {'];
    const entries = Object.entries(e.data);
    entries.forEach(([k, v], i) => lines.push(`    "${k}": ${JSON.stringify(v)}${i < entries.length - 1 ? ',' : ''}`));
    lines.push('  }', '}', '', '(userId, sessionId, source and the landing entry', ' ride beside type and data)');
    return lines.join('\n');
  }
  function touchesText(e, touches) {
    const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
    const lines = touches.map((t) => {
      const spec = specOf(REGISTRY, t.dim);
      const why = spec.derive === 'band' ? `← price_usd ${e.data.price_usd}: ${bandRule(e.data.price_usd, spec)}` : `← ${spec.source}`;
      return `${pad(t.dim, 12)}${pad(t.value, 10)}${why}`;
    });
    lines.push('', 'os         no dimension reads it: ignored', 'productId  names the product on the answer', 'view       not a registry source');
    return lines.join('\n');
  }
  function bandRule(price, spec) {
    const idx = spec.cuts.findIndex((c) => price < c);
    if (idx === 0) return `under ${spec.cuts[0]}`;
    if (idx === -1) return `${spec.cuts[spec.cuts.length - 1]} or more`;
    return `${spec.cuts[idx - 1]} ≤ price < ${spec.cuts[idx]}`;
  }

  function initS3() {
    const mount = $('s3-inst');
    if (!mount) return;
    const evPre = $('s3-event'), tPre = $('s3-touches');
    const evK = $('s3-event-k'), tK = $('s3-touches-k');
    if (evK) evK.append(hint(TIPS.s3event, 'the event the page sends'));
    if (tK) tK.append(hint(TIPS.s3touches, 'what the engine extracts'));
    const showEvent = (e) => { evPre.textContent = eventText(e); tPre.textContent = touchesText(e, extractTouches(e.data, REGISTRY)); };
    showEvent(phoneEvent(PHONE['galaxy-s26'], 'card'));
    const meters = h('div', { class: 'meters' });
    const tableBody = h('tbody');
    const note = h('p', { class: 'inst-note' });
    mount.append(
      instHead('Instrument · one shopper, live, on the published registry', [LOCAL_TAG, ROOM_TAG], TIPS.s3head),
      deviceButtons(false, TIPS.device),
      h('div', { class: 'cols cols--wide' },
        h('div', null, ih('Her vector: every coordinate she has, read now', TIPS.s3meters), meters, note),
        h('div', null, ih('The whole state: (R, t) per value, nothing else', TIPS.s3state),
          h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'value' }), h('th', { class: 'num', text: 'R stored' }), h('th', { class: 'num', text: 'last touch' }), h('th', { class: 'num', text: 'τ' }), h('th', { class: 'num', text: 'a now' }))), tableBody),
          h('p', { class: 'inst-note', text: 'The state is the pair (R, t) per value (src/reflex/core.ts:117-132). a is computed at every read from the clock, which is why nothing has to run to make her interest fade.' }))),
    );
    function render() {
      const now = liveNow();
      const snap = snapshot(LIVE.state, now, REGISTRY);
      const aud = new Set(LIVE.state.audiences);
      clear(meters);
      clear(tableBody);
      const flashFrom = performance.now() - 900;
      let any = false;
      for (const spec of REGISTRY.dimensions) {
        const values = snap.dims[spec.key];
        if (!values) continue;
        const p = dimParams(REGISTRY, spec.key);
        for (const [v, a] of Object.entries(values).sort((x, y) => y[1] - x[1])) {
          any = true;
          const touchedAt = LIVE.touched.get(`${spec.key}:${v}`) || 0;
          meters.append(meterRow({ name: `${DIM_LABEL[spec.key]} · ${v}`, sub: `τ ${tauLabel(p.tauMs)}`, a, thIn: p.thetaIn, thOut: p.thetaOut, member: aud.has(audienceKey(spec.key, v)), touched: touchedAt > flashFrom }));
          const entry = LIVE.state.dims[spec.key][v];
          tableBody.append(h('tr', null,
            h('td', { class: 'mono', 'data-k': 'value', text: `${spec.key} · ${v}` }),
            h('td', { class: 'num', 'data-k': 'R stored', text: f3(entry.s) }),
            h('td', { class: 'num', 'data-k': 'last touch', text: `${dur(now - entry.t)} ago` }),
            h('td', { class: 'num', 'data-k': 'τ', text: tauLabel(p.tauMs) }),
            h('td', { class: 'num', 'data-k': 'a now', text: f3(a) })));
        }
      }
      if (!any) {
        meters.append(h('p', { class: 'meter-empty', text: 'No coordinate has evidence yet. Press the Galaxy S26: four meters move at once.' }));
        tableBody.append(h('tr', null, h('td', { colspan: 5, class: 'mono', text: 'empty: a stranger' })));
      }
      if (LIVE.last) {
        const t = LIVE.last.touches;
        note.textContent = `Last press: ${PHONE[LIVE.last.e.data.productId].name}, one product_view at weight 1, ${t.length} touches: ${t.map((x) => `${x.dim} ${x.value}`).join(', ')}.${LIVE.last.entered.length ? ` Entered: ${LIVE.last.entered.join(', ')}.` : ''} Try the Galaxy S26, then the Pixel 11: ecosystem android and core take their second touch while brand splits across two makers.`;
      } else note.textContent = 'Each meter shows a, its entry tick (solid) and exit tick (dotted). White means she is in that audience.';
    }
    LIVE.listeners.push(() => { if (LIVE.last) showEvent(LIVE.last.e); render(); });
    render();
    everyTick(mount, render);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 5 state, shared with section 4's "as served" scoring
  // ══════════════════════════════════════════════════════════════════════════
  const S5 = { region: 'US-NY', ad: true, device: 'desktop', kBlend: LEARN_DOC.regional.kBlend, evidence: 'live', sigma: 1.5, live: null, listeners: [] };
  function s5Share() {
    if (S5.region === 'live') return S5.live && S5.live.share ? S5.live.share : SEEDED_SHARE['US-NY'].share;
    return SEEDED_SHARE[S5.region].share;
  }
  const s5RegionKey = () => (S5.region === 'live' ? (S5.live && S5.live.region) || null : S5.region);
  const s5RegionName = () => (S5.region === 'live' ? (S5.live && (S5.live.label || S5.live.region)) || 'this request’s region' : REGION_NAME[S5.region]);
  const s5Changed = () => { for (const fn of S5.listeners) fn(); };

  // ══════════════════════════════════════════════════════════════════════════
  // Section 4 · Scoring 10,000 candidates
  // ══════════════════════════════════════════════════════════════════════════
  function initS4() {
    const mount = $('s4-inst');
    if (!mount) return;
    const S = { tab: 'deals', mode: 'served', intent: 'new', pin: '', cap: 2, weights: { ...DEALS.weights }, rail: { affinity: 1, dims: { ...RAIL.weights.dims } } };
    const vecLine = h('p', { class: 'inst-note' });
    const dealsPane = h('div');
    const railPane = h('div', { hidden: true });
    const tabs = seg('Slot', [['deals', 'deals · 17 promotions · take 4'], ['rail', 'phones-rail · 16 phones · take 6']], 'deals', (v) => { S.tab = v; dealsPane.hidden = v !== 'deals'; railPane.hidden = v !== 'rail'; render(); });

    // The deals pane
    const modeSeg = seg('Score with', [['served', 'as served'], ['own', 'the tag sum alone']], S.mode, (v) => { S.mode = v; render(); });
    const intentSel = h('select', { 'aria-label': 'Asserted intent' }, ['new', 'add-line', 'upgrade', 'byod'].map((v) => h('option', { value: v, text: v })));
    intentSel.addEventListener('change', () => { S.intent = intentSel.value; render(); });
    const capSel = h('select', { 'aria-label': 'Diversity cap' }, [['0', 'off'], ['1', '1 per brand'], ['2', '2 per brand (published)'], ['3', '3 per brand'], ['4', '4 per brand']].map(([v, t]) => h('option', { value: v, text: t })));
    capSel.value = '2';
    capSel.addEventListener('change', () => { S.cap = Number(capSel.value); render(); });
    const pinSel = h('select', { 'aria-label': 'Pin a promotion' }, h('option', { value: '', text: 'no pin (the opening document)' }), PROMOTIONS.map((p) => h('option', { value: p.id, text: p.title })));
    pinSel.addEventListener('change', () => { S.pin = pinSel.value; render(); });
    const weightSliders = Object.keys(DEALS.weights).map((dim) => slider({ label: DIM_LABEL[dim], min: 0, max: 1, step: 0.05, value: DEALS.weights[dim], fmt: (v) => wfmt(v), on: (v) => { S.weights[dim] = v; render(); } }));
    const resetW = h('button', { type: 'button', class: 'ib ib--ghost', text: 'Published weights' });
    resetW.addEventListener('click', () => { Object.keys(DEALS.weights).forEach((dim, i) => { S.weights[dim] = DEALS.weights[dim]; weightSliders[i].set(DEALS.weights[dim]); }); render(); });
    const boxes = h('div', { class: 'boxes' });
    const pinNote = h('p', { class: 'inst-sentence', hidden: true });
    const tbody = h('tbody');
    const counts = h('div', { class: 'readout' });
    const bench = h('p', { class: 'inst-note' });
    const benchB = h('button', { type: 'button', class: 'ib ib--red', text: 'Run it on 10,000 synthetic candidates' });
    benchB.addEventListener('click', () => runBench());
    const priorNote = h('p', { class: 'inst-note' });
    dealsPane.append(
      h('div', { class: 'ctrls' }, ctrlBlock('Score with', modeSeg.el, null, TIPS.s4mode), ctrlBlock('Asserted intent (eligibility)', intentSel, 'Gated offers fail closed.', TIPS.s4intent), ctrlBlock('Diversity', capSel, null, TIPS.s4cap), ctrlBlock('Pin', pinSel, 'A required prefix: container 1, never ranked. If the pinned piece is not eligible for this request, the whole slot serves nothing: the engine’s current behaviour. Try an upgrade offer under intent new.', TIPS.s4pin)),
      priorNote,
      ih('The slot’s weights: per slot, never per product', TIPS.s4weights),
      h('div', { class: 'ctrls' }, weightSliders.map((s) => s.el)),
      h('div', { class: 'btnrow' }, resetW),
      ih('The four containers', TIPS.s4boxes), boxes, pinNote,
      ih('Every candidate, scored the same way', TIPS.s4table),
      h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'candidate and its tags' }), h('th', { text: 'Σ a × w, written out' }), h('th', { class: 'num', text: 'score' }), h('th', { text: 'outcome' }))), tbody)),
      ih('What it cost, counted, not timed', TIPS.s4counts), counts, h('div', { class: 'btnrow' }, benchB, hint(TIPS.s4bench, 'the 10,000-candidate run')), bench,
    );

    // The rail pane
    const railAff = seg('Affinity weight', [[1, 'affinity 1'], [0, 'affinity 0: the site’s order']], 1, (v) => { S.rail.affinity = v; render(); });
    const railSliders = Object.keys(RAIL.weights.dims).map((dim) => slider({ label: DIM_LABEL[dim], tip: TIPS.rail[dim], min: 0, max: 2, step: 0.05, value: RAIL.weights.dims[dim], fmt: (v) => wfmt(v), on: (v) => { S.rail.dims[dim] = v; render(); } }));
    const railBoxes = h('div', { class: 'boxes boxes--6' });
    const railBody = h('tbody');
    railPane.append(
      h('p', { class: 'inst-note', text: 'POST /sort over the site’s own grid. The rail scores her own vector only: no regional prior and no seeds on this route (src/routes/sort.ts:100, :116). The dials travel on the request (public/vantage/phones.json); at affinity 0 every score is 0 and the order is the site’s exactly (src/reflex/sortCandidates.ts:142-146).' }),
      h('div', { class: 'ctrls' }, ctrlBlock('Affinity', railAff.el, null, TIPS.s4railAff), railSliders.map((s) => s.el)),
      ih('The six positions', TIPS.s4railBoxes), railBoxes,
      ih('Every phone, scored the same way', TIPS.s4railTable),
      h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'phone' }), h('th', { text: 'Σ a × w over the touches it produces' }), h('th', { class: 'num', text: 'score' }), h('th', { text: 'site order' }))), railBody)),
    );

    mount.append(
      instHead('Instrument · one slot, every candidate', [LOCAL_TAG, ROOM_TAG, SYN_TAG], TIPS.s4head),
      ih('Her vector, from section 3 (the same live shopper)', TIPS.s4vec),
      deviceButtons(true, TIPS.device), vecLine,
      h('div', { class: 'btnrow' }, h('span', { class: 'btnrow-k', text: 'Slot' }), hint(TIPS.s4slot, 'the slot choice'), tabs.el),
      dealsPane, railPane,
    );

    function outcomeOf(row, take) {
      if (row.why) return h('span', { class: 'out out--closed', text: row.why });
      const pos = take.served.findIndex((s) => s.piece.id === row.piece.id);
      if (take.refused) return h('span', { class: 'out out--closed', text: 'not served: the slot served nothing' });
      if (pos >= 0) {
        const s = take.served[pos];
        if (s.pinned) return h('span', { class: 'out out--pin', text: `pinned · container ${pos + 1} · ranking skipped` });
        return h('span', { class: 'out out--served', text: `container ${pos + 1}${s.relaxed ? ' (cap relaxed)' : ''}` });
      }
      if ((take.yielded || []).some((s) => s.piece.id === row.piece.id)) return h('span', { class: 'out out--yield', text: `yielded: over ${take.rule.max} per ${take.rule.dimension}` });
      const rank = take.ranked.findIndex((s) => s.piece.id === row.piece.id);
      return h('span', { class: 'out', text: `rank ${rank + 1 + take.served.filter((s) => s.pinned).length}, not in the four` });
    }

    function render() {
      const snap = liveSnap();
      const coords = [];
      for (const [dim, values] of Object.entries(snap.dims)) for (const [v, a] of Object.entries(values)) coords.push(`${dim} ${v} ${f3(a)}`);
      vecLine.textContent = coords.length ? `Her own vector now: ${coords.join(' · ')}.` : 'Her own vector is empty: a stranger. As served, the region’s prior carries every score (section 5); the tag sum alone is zero everywhere and the slot answers its catalogue order.';
      if (S.tab === 'deals') renderDeals(snap); else renderRail(snap);
    }

    function renderDeals(snap) {
      const d = decideDeals({ dims: snap.dims, audiences: snap.audiences, mode: S.mode, share: s5Share(), kBlend: S5.kBlend, region: s5RegionKey() || 'US-NY', ad: S5.ad, device: S5.device, intent: S.intent, pin: S.pin, cap: S.cap, weights: S.weights });
      priorNote.textContent = S.mode === 'served'
        ? `As served: her vector blended with ${s5RegionName()}’s synthetic sales at λ = ${f3(d.lambda)} (kBlend ${wfmt(S5.kBlend)}), ${S5.ad ? 'arrived from the ad (campaign seed fires)' : 'no ad'}, ${S5.device === 'desktop' ? 'on a laptop (no OS-family seed)' : `on ${S5.device === 'iphone' ? 'an iPhone' : 'an Android phone'} (OS-family seed)`}, the promotion multiplier on, γ = 0. Change these in section 5. Blue terms are blended dimensions.`
        : 'The tag sum alone, on her own vector: no prior, no seeds, no multiplier. This is the dot product with nothing around it.';
      clear(boxes);
      const take = d.take;
      for (let i = 0; i < DEALS.take; i++) {
        const s = take.served[i];
        boxes.append(s
          ? h('div', { class: s.pinned ? 'box box--pin' : i === 0 ? 'box box--lead' : 'box' }, h('p', { class: 'box-k' }, h('span', { text: `container ${i + 1}` }), h('span', { text: s.pinned ? 'pinned' : 'ranked' })), h('p', { class: 'box-t', text: s.piece.title }), h('p', { class: 'box-s', text: s.pinned ? 'ranking skipped' : f3(round3(s.score)) }))
          : h('div', { class: take.refused ? 'box box--pin' : 'box' }, h('p', { class: 'box-k', text: `container ${i + 1}` }), h('p', { class: 'box-t', text: take.refused ? 'empty: the slot served nothing' : 'empty: nothing else eligible' })));
      }
      pinNote.hidden = !take.refused;
      if (take.refused) {
        const pinned = PROMO[S.pin];
        pinNote.textContent = `The pinned piece, “${pinned.title.replace(/\.$/, '')}”, is not eligible for this request (${ineligibleWhy(pinned, d.ctx)}), so the whole slot serves nothing and records a pin diagnostic. That is the engine’s current behaviour: a pin is a required prefix, and a prefix that cannot be served refuses the slot rather than serving three (src/reflex/contentCompose.ts:187-199, :229; src/content/decide.ts:400-401). The demo’s beat 13 asserts a device-purchase intent before it pins the Duo for that reason.`;
      }
      clear(tbody);
      const order = [...take.served.map((s) => s.piece.id), ...take.ranked.map((s) => s.piece.id)];
      const rows = [...d.rows].sort((x, y) => {
        const ix = order.indexOf(x.piece.id), iy = order.indexOf(y.piece.id);
        return (ix < 0 ? 1e3 + CATALOG_ORDER.get(x.piece.id) : ix) - (iy < 0 ? 1e3 + CATALOG_ORDER.get(y.piece.id) : iy);
      });
      rows.forEach((row, i) => {
        const servedHere = take.served.some((s) => s.piece.id === row.piece.id);
        const tags = h('div', { class: 'tagl' }, Object.entries(row.piece.tags).flatMap(([dim, values]) => values.map((v) => {
          const a = (d.affinity[dim] && d.affinity[dim][v]) || 0;
          const w = d.slotDoc.weights[dim] || 0;
          return h('span', { class: a > 0 && w ? 'tg tg--hit' : 'tg tg--zero', text: `${dim}:${v}` });
        })));
        tbody.append(h('tr', { class: row.why ? 'is-out' : servedHere ? 'is-served' : null },
          h('td', { class: 'num', 'data-k': '#', text: row.why ? '–' : String(i + 1) }),
          h('td', { 'data-k': 'candidate' }, h('div', { class: 'ttl', text: row.piece.title }), tags),
          h('td', { 'data-k': 'the sum' }, row.why ? h('span', { class: 'sum', text: 'not scored: eligibility runs before scoring' }) : sumLine(row, { blended: S.mode === 'served' }),
            row.why ? null : h('div', { class: 'madds', text: `${row.madds} lookups and multiply-adds${row.regional ? ` · the region’s part ${f3(row.regional)}` : ''}${row.seedApplied ? ` · seed applied +${f3(row.seedApplied)}` : ''}` })),
          h('td', { class: 'num', 'data-k': 'score', text: row.why ? '–' : f3(round3(row.score)) }),
          h('td', { 'data-k': 'outcome' }, outcomeOf(row, take))));
      });
      const scored = d.rows.filter((r) => !r.why);
      const madds = scored.reduce((s, r) => s + r.madds, 0);
      const per = scored.length ? madds / scored.length : 0;
      clear(counts).append(
        readoutCell('Candidates scored', String(scored.length), `${d.rows.length - scored.length} failed eligibility first`),
        readoutCell('Multiply-adds, this slot', String(madds), `${f1(per)} per candidate: one per tag value on a weighted dimension`),
        readoutCell('At 10,000 candidates', `≈ ${Math.round(per * 10000).toLocaleString('en-US')}`, 'the same density; then one sort and a take of 4; the blend runs once per shopper'),
        readoutCell('Configured per product', '0', 'tags only; weights and rules live on the slot'),
      );
    }

    function renderRail(snap) {
      const { scored, affinityWeight } = sortRail(snap.dims, S.rail);
      clear(railBoxes);
      scored.slice(0, RAIL.take).forEach((s, i) => railBoxes.append(h('div', { class: i === 0 ? 'box box--lead' : 'box' }, h('p', { class: 'box-k' }, h('span', { text: `position ${i + 1}` }), h('span', { text: `site #${s.feedRank + 1}` })), h('p', { class: 'box-t', text: s.p.name }), h('p', { class: 'box-s', text: f3(s.score) }))));
      clear(railBody);
      scored.forEach((s, i) => {
        const used = s.drivers.filter((x) => x.a > 0 && x.w);
        const parts = used.map((x, j) => `${j ? ' + ' : ''}${x.value} ${f3(x.a)}×${wfmt(x.w)}`).join('');
        railBody.append(h('tr', { class: i < RAIL.take ? 'is-served' : null },
          h('td', { class: 'num', 'data-k': '#', text: String(i + 1) }),
          h('td', { 'data-k': 'phone' }, h('div', { class: 'ttl', text: s.p.name }), h('div', { class: 'tagl' }, s.drivers.map((x) => h('span', { class: x.a > 0 ? 'tg tg--hit' : 'tg tg--zero', text: `${x.dim}:${x.value}` })))),
          h('td', { 'data-k': 'the sum' }, h('span', { class: 'sum', text: used.length ? `${parts}${affinityWeight !== 1 ? `, × affinity ${affinityWeight}` : ''}` : 'no interest on its values: 0' }), h('div', { class: 'madds', text: `${s.madds} lookups and multiply-adds` })),
          h('td', { class: 'num', 'data-k': 'score', text: f3(s.score) }),
          h('td', { class: 'num', 'data-k': 'site order', text: `#${s.feedRank + 1}` })));
      });
    }

    function runBench() {
      // Synthetic candidates generated here from the registry's own vocabulary, at the real pool's tag density.
      const N = 10000;
      const vocab = { ...VOCAB, campaign: ['iphone-18-pro'] };
      let seed = 7;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const pool = [];
      for (let i = 0; i < N; i++) {
        const tpl = PROMOTIONS[i % PROMOTIONS.length];
        const tags = {};
        for (const [dim, values] of Object.entries(tpl.tags)) tags[dim] = values.map(() => vocab[dim][Math.floor(rnd() * vocab[dim].length)]);
        pool.push({ id: `synthetic-${i}`, tags });
      }
      const snap = liveSnap();
      const share = sharesWithin(s5Share(), LEARN_DOC.regional.dimensions);
      const lambda = lambdaFor(snap.dims, S5.kBlend);
      const aff = S.mode === 'served' ? blendAffinity(snap.dims, share, lambda).dims : snap.dims;
      const weights = S.weights;
      // Counted, not timed: FACTS.md §2 records that none of this has been timed on the service.
      let madds = 0, comparisons = 0;
      const scored = new Array(N);
      for (let i = 0; i < N; i++) {
        const tags = pool[i].tags;
        let score = 0;
        for (const dim in tags) {
          const w = weights[dim] || 0;
          if (!w) continue;
          const vals = tags[dim], row = aff[dim];
          for (let j = 0; j < vals.length; j++) { madds += 1; const a = row ? row[vals[j]] || 0 : 0; if (a > 0) score += a * w; }
        }
        scored[i] = { i, score };
      }
      scored.sort((x, y) => { comparisons += 1; return y.score - x.score || x.i - y.i; });
      const seen = new Map();
      const four = [];
      for (const s of scored) {
        if (four.length >= 4) break;
        const brands = pool[s.i].tags.brand || [];
        if (S.cap && brands.some((b) => (seen.get(b) || 0) >= S.cap)) continue;
        for (const b of brands) seen.set(b, (seen.get(b) || 0) + 1);
        four.push(s);
      }
      bench.textContent = `${N.toLocaleString('en-US')} synthetic candidates, generated in this browser from the registry’s vocabulary at the real pool’s tag density and scored against the same vector and weights: ${madds.toLocaleString('en-US')} lookups and multiply-adds, ${comparisons.toLocaleString('en-US')} comparisons in the sort, and a take of 4 under the cap; the leader scored ${f3(four[0] ? four[0].score : 0)}. The facts sheet’s estimate, at seven values a candidate: about 70,000 multiply-adds and a sort of about 133,000 comparisons. Counted, not timed: nothing has been timed on the service at 10,000 candidates, and a deployed Worker’s clock does not advance during pure computation.`;
    }

    LIVE.listeners.push(render);
    S5.listeners.push(render);
    render();
    everyTick(mount, render);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 5 · Cold start as a prior
  // ══════════════════════════════════════════════════════════════════════════
  /** The cold-start read's answer, field by field; anything unexpected is dropped. */
  function parseColdStart(body) {
    if (!body || typeof body !== 'object' || body.ok === false) return null;
    const out = { region: null, source: null, label: null, level: null, events: null, dataSource: null, share: null };
    const r = body.region && typeof body.region === 'object' ? body.region : {};
    if (typeof r.key === 'string' && /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(r.key)) out.region = r.key;
    if (r.source === 'edge' || r.source === 'asserted' || r.source === 'none') out.source = r.source;
    const census = body.census && typeof body.census === 'object' ? body.census : {};
    if (typeof census.label === 'string' && census.label.length <= 60) out.label = census.label;
    const lean = body.lean && typeof body.lean === 'object' ? body.lean : null;
    if (lean) {
      if (['region', 'country', 'global'].includes(lean.level)) out.level = lean.level;
      if (Number.isFinite(lean.events)) out.events = lean.events;
      if (lean.dataSource === 'synthetic' || lean.dataSource === 'observed') out.dataSource = lean.dataSource;
      const share = {};
      if (lean.share && typeof lean.share === 'object') for (const dim of LEARN_DOC.regional.dimensions) {
        const vals = lean.share[dim];
        if (!vals || typeof vals !== 'object') continue;
        for (const v of VOCAB[dim]) {
          const x = vals[v];
          if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1) (share[dim] = share[dim] || {})[v] = x;
        }
      }
      if (Object.keys(share).length) out.share = share;
    }
    return out;
  }

  function initS5() {
    const mount = $('s5-inst');
    if (!mount) return;
    const regionSeg = seg('Region', [['US-NY', 'New York'], ['US-TX', 'Texas']], S5.region, (v) => { S5.region = v; s5Changed(); });
    const adSeg = seg('Arrival', [[true, 'from the ad'], [false, 'no ad']], S5.ad, (v) => { S5.ad = v; s5Changed(); });
    const devSeg = seg('Device', [['desktop', 'laptop'], ['iphone', 'iPhone'], ['android', 'Android']], S5.device, (v) => { S5.device = v; s5Changed(); });
    const kS = slider({ label: 'kBlend, the prior’s strength', tip: TIPS.s5k, min: 0.1, max: 3, step: 0.1, value: S5.kBlend, fmt: (v) => wfmt(round3(v)), sub: 'Published 0.5. The compiled default, with no learn document, is 1.', on: (v) => { S5.kBlend = round3(v); s5Changed(); } });
    const sigmaS = slider({ label: 'Σa set by hand', tip: TIPS.s5sigma, min: 0, max: 8, step: 0.05, value: S5.sigma, fmt: (v) => f2(v), on: (v) => { S5.sigma = v; s5Changed(); } });
    const evSeg = seg('Her evidence', [['live', 'her live vector (section 3)'], ['hand', 'set by hand']], S5.evidence, (v) => { S5.evidence = v; sigmaS.el.hidden = v !== 'hand'; s5Changed(); });
    sigmaS.el.hidden = true;
    const liveB = h('button', { type: 'button', class: 'ib', text: 'Read this request’s region from the service' });
    const liveStatus = h('p', { class: 'live-status', text: 'Optional: GET /vantage/api/coldstart with X-Tenant: vantage, no credential, no cookie. The seeded New York and Texas numbers stay the default.' });
    liveB.addEventListener('click', async () => {
      liveB.disabled = true;
      liveStatus.className = 'live-status';
      liveStatus.textContent = 'Asking the service…';
      try {
        const res = await fetch('/vantage/api/coldstart', { method: 'GET', headers: { 'X-Tenant': 'vantage' }, credentials: 'omit', cache: 'no-store' });
        const body = res.ok ? await res.json().catch(() => null) : null;
        const parsed = body ? parseColdStart(body) : null;
        if (!res.ok || !parsed) { liveStatus.className = 'live-status warn'; liveStatus.textContent = `The cold-start read answered ${res.status}; the page keeps the seeded numbers.`; return; }
        if (!parsed.share) { liveStatus.className = 'live-status warn'; liveStatus.textContent = `The service answered${parsed.region ? ` for ${parsed.region}` : ''}, but this worker holds no regional lean for it; the page keeps the seeded numbers.`; return; }
        S5.live = parsed;
        S5.region = 'live';
        regionSeg.set('none');
        liveStatus.className = 'live-status ok';
        liveStatus.textContent = `Now using the lean the service holds for ${parsed.label || parsed.region || 'this request’s region'}${parsed.source ? ` (region ${parsed.source === 'edge' ? 'from the request' : parsed.source})` : ''}, answered at ${parsed.level || 'an unnamed'} level from ${parsed.events !== null ? `${parsed.events} events` : 'its events'}, labelled ${parsed.dataSource === 'synthetic' ? 'synthetic → warehouse' : 'observed on this demo worker only'}. Pick New York or Texas to go back.`;
        s5Changed();
      } catch (err) {
        liveStatus.className = 'live-status warn';
        liveStatus.textContent = 'The cold-start read is not reachable from here; the page keeps the seeded numbers.';
      } finally { liveB.disabled = false; }
    });

    const lambdaChart = h('div');
    const lambdaRead = h('div', { class: 'readout' });
    const leanBox = h('div');
    const blendBody = h('tbody');
    const seedList = h('ul', { class: 'events' });
    const hingeChart = h('div', { class: 'chart-wrap' });
    const hingeNote = h('p', { class: 'inst-sentence' });
    const strangerBody = h('tbody');
    const strangerNote = h('p', { class: 'inst-note' });
    const strangerMeasured = h('p', { class: 'inst-note' });
    mount.append(
      instHead('Instrument · the prior, the seeds and the hinge', [LOCAL_TAG, SYN_TAG], TIPS.s5head),
      h('div', { class: 'ctrls' }, ctrlBlock('Region (synthetic sales)', regionSeg.el, null, TIPS.s5region), ctrlBlock('Arrival', adSeg.el, 'utm_term=iphone-18-pro, resent with every snapshot.', TIPS.s5ad), ctrlBlock('Her device', devSeg.el, 'Only the OS family, from the request.', TIPS.s5dev), kS.el, ctrlBlock('Σa, her evidence', evSeg.el, null, TIPS.s5ev), sigmaS.el),
      h('div', { class: 'btnrow' }, liveB, hint(TIPS.s5live, 'the optional read of this request’s region')), liveStatus,
      h('div', { class: 'cols' }, h('div', null, framed('chart-wrap', lambdaChart, TIPS.s5lambda, 'the chart of λ against her evidence'), lambdaRead), framed('panel', leanBox, TIPS.s5lean, 'the region’s shares')),
      ih('Her blended vector, value by value: ã = (1 − λ)·a + λ·share', TIPS.s5blend),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'value' }), h('th', { class: 'num', text: 'her a' }), h('th', { class: 'num', text: 'region share' }), h('th', { text: 'ã, written out' }), h('th', { class: 'num', text: 'ã' }))), blendBody),
      h('p', { class: 'inst-note', text: 'Dimensions outside the list (intent, perk, lines, content type) take nothing from the region and keep (1 − λ) of her own: a stranger’s first intent touch counts at that discount until her evidence grows (src/reflex/regionTrend.ts:224-229).' }),
      ih('The arrival’s seeds on the deals slot, for this arrival', TIPS.s5seeds), seedList,
      ih('A stranger’s receipt: the launch offer at λ = 1', TIPS.s5stranger),
      h('p', { class: 'inst-sentence', text: 'On a stranger’s receipt the driver values are the region’s shares at λ = 1, not her own affinity: she has none yet, so every a is the region speaking.' }),
      h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'driver' }), h('th', { class: 'num', text: 'a (the region’s share)' }), h('th', { class: 'num', text: 'weight' }), h('th', { class: 'num', text: 'a × w' }))), strangerBody),
      strangerNote, strangerMeasured,
      ih('The hinge, as arithmetic: the launch offer and the Galaxy S26 offer across her presses', TIPS.s5hinge), hingeChart, hingeNote,
    );

    function render() {
      const snap = liveSnap();
      const personal = snap.dims;
      const sigma = S5.evidence === 'hand' ? S5.sigma : evidenceOf(personal);
      const k = S5.kBlend > 0 ? S5.kBlend : 1;
      const lambda = S5.evidence === 'hand' ? round3(k / (k + sigma)) : lambdaFor(personal, S5.kBlend);
      // λ against Σa
      const fr = frame({ w: 520, h: 240, x: [0, 8], y: [0, 1], xTicks: [0, 1, 2, 3, 4, 5, 6, 7, 8], yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: f2, xLabel: 'Σa, the sum of her own interests', label: 'lambda against her evidence' });
      const curve = (kk) => { const pts = []; for (let i = 0; i <= 160; i++) { const x = (i / 160) * 8; pts.push([x, kk / (kk + x)]); } return pts; };
      fr.path(curve(1), 'curve curve--g faint');
      fr.path(curve(k), 'curve');
      fr.dot(clamp(sigma, 0, 8), k / (k + clamp(sigma, 0, 8)), 'dot dot--w', 4.5);
      fr.text(clamp(sigma, 0, 8), k / (k + clamp(sigma, 0, 8)), `  λ ${f3(lambda)}`, 'lbl', 'start', -8);
      fr.text(7.9, 1 / (1 + 7.9), 'k = 1 (the compiled default)', 'lbl lbl--d', 'end', -8);
      clear(lambdaChart).append(h('p', { class: 'chart-k', text: `λ = ${wfmt(k)} / (${wfmt(k)} + Σa)` }), h('div', { class: 'legend' }, h('span', { text: `kBlend ${wfmt(k)}` }), h('span', { class: 'lg-g', text: 'kBlend 1' })), fr.svg);
      clear(lambdaRead).append(
        readoutCell('Σa, her evidence', f3(sigma), S5.evidence === 'hand' ? 'set by hand' : 'every value of her live vector'),
        readoutCell('λ, the population’s weight', f3(lambda), `${wfmt(k)} / (${wfmt(k)} + ${f3(sigma)})`),
        readoutCell('1 − λ, hers', f3(1 - lambda), sigma === 0 ? 'a stranger: the region speaks alone' : 'grows with every touch'),
      );
      // The region's lean
      const regionShare = s5Share();
      const seeded = S5.region === 'live' ? null : SEEDED_SHARE[S5.region];
      const leanRows = [];
      for (const dim of LEARN_DOC.regional.dimensions) {
        const vals = regionShare[dim] || {};
        for (const [v, s] of Object.entries(vals).sort((x, y) => y[1] - x[1])) {
          const units = seeded && seeded.r[dim] ? seeded.r[dim][v] : null;
          leanRows.push(meterRow({ name: `${DIM_LABEL[dim]} · ${v}`, sub: units !== null && units !== undefined ? `${units} sales` : null, a: 0, lean: s, ticks: false, value: f3(s) }));
        }
      }
      clear(leanBox).append(
        h('p', { class: 'inst-h', text: `${s5RegionName()}: the region’s share per value (leader = 1)` }),
        h('div', { class: 'meters' }, leanRows),
        h('p', { class: 'inst-note', text: seeded ? `${seeded.events} synthetic sales (scripts/seed-vantage-region.mjs:105-130 at c720907), labelled synthetic → warehouse. Answered at region level: ${seeded.events} ≥ minEvents 30.` : 'The lean the service holds for this request’s region, read live; labelled as the service labels it.' }),
      );
      // The blended values
      const share = sharesWithin(regionShare, LEARN_DOC.regional.dimensions);
      const blended = blendAffinity(personal, share, lambda).dims;
      clear(blendBody);
      for (const dim of LEARN_DOC.regional.dimensions) {
        const values = new Set([...Object.keys(personal[dim] || {}), ...Object.keys(share[dim] || {})]);
        for (const v of [...values].sort((x, y) => ((blended[dim] || {})[y] || 0) - ((blended[dim] || {})[x] || 0))) {
          const a = (personal[dim] || {})[v] || 0, s = (share[dim] || {})[v] || 0;
          blendBody.append(h('tr', null,
            h('td', { class: 'mono', 'data-k': 'value', text: `${dim} · ${v}` }),
            h('td', { class: 'num', 'data-k': 'hers', text: f3(a) }),
            h('td', { class: 'num', 'data-k': 'share', text: f3(s) }),
            h('td', { class: 'mono', 'data-k': 'written out', text: `(1 − ${f3(lambda)})·${f3(a)} + ${f3(lambda)}·${f3(s)}` }),
            h('td', { class: 'num', 'data-k': 'blended', text: f3((blended[dim] || {})[v] || 0) })));
        }
      }
      // The seeds
      clear(seedList);
      const ctx = { utmTerm: S5.ad ? LANDING_TERM : '', platform: platformOf(S5.device) };
      const launch = PROMO['promo-iphone-18-pro-launch'];
      const camp = seedDriversFor(launch, DEALS, ctx, snap.audiences).find((x) => x.signal === 'campaign_term');
      seedList.append(h('li', null, camp ? `campaign_term fires on utm_term=${LANDING_TERM}: 0.2 × the slot’s campaign weight 0.3 = +${f3(camp.contribution)} on the launch offer (the only promotion tagged campaign), × 1.1 promotion multiplier = +${f3(r3(camp.contribution * 1.1))} on its receipt.` : h('em', { text: 'campaign_term: no utm_term on this arrival, so it does not fire.' })));
      const plat = platformOf(S5.device);
      if (!plat) seedList.append(h('li', null, h('em', { text: 'platform: a laptop sends neither iOS nor Android, so neither OS-family seed fires.' })));
      else {
        const probe = { id: 'probe', tags: { ecosystem: [plat] } };
        const drv = seedDriversFor(probe, DEALS, ctx, snap.audiences);
        const other = plat === 'ios' ? 'android' : 'ios';
        const d0 = drv[0];
        seedList.append(h('li', null, d0
          ? `platform ${plat} fires: weight 1${d0.damped.length ? ` × ${d0.damped.map((x) => `${x.factor} (she holds ${x.dimension} ${x.value})`).join(' × ')}` : ''} × the slot’s ecosystem weight 0.15 = +${f3(d0.contribution)} on every offer tagged ecosystem ${plat}. Halved while she holds intent switch; withdrawn once she holds ecosystem ${other}.`
          : `platform ${plat}: no offer carries it here.`));
      }
      // A stranger's receipt, as the record itemises it (src/reflex/contentCompose.ts:309-321; src/content/decide.ts:436-451)
      const stranger = decideDeals({ dims: {}, audiences: [], mode: 'served', share: regionShare, kBlend: S5.kBlend, region: s5RegionKey() || 'US-NY', ad: S5.ad, device: S5.device, intent: 'new' });
      const srow = stranger.rows.find((r) => r.piece.id === 'promo-iphone-18-pro-launch');
      clear(strangerBody);
      if (srow && !srow.why) {
        for (const dvr of recordDrivers(srow, stranger.lambda, s5RegionKey() || 'US-NY')) {
          strangerBody.append(h('tr', null,
            h('td', { class: 'mono', 'data-k': 'driver', text: `${dvr.dim} · ${dvr.value}` }),
            h('td', { class: 'num', 'data-k': 'share', text: wfmt(dvr.a) }),
            h('td', { class: 'num', 'data-k': 'weight', text: wfmt(dvr.weight) }),
            h('td', { class: 'num', 'data-k': 'product', text: dvr.dim === 'merchandising' ? `× ${f2(1 + dvr.a * dvr.weight)}` : f3(dvr.a * dvr.weight) })));
        }
        strangerNote.textContent = `λ = ${f3(stranger.lambda)}: the tag terms sum to ${f3(srow.base0)}, all of it regional (the regional row names that sum as its weight); the campaign seed adds ${f3(srow.seeded)} for score_base ${f3(round3(srow.scoreBase))}; the promotion multiplier ${srow.merch ? f2(srow.merch.boost) : '1'} makes score_final ${f3(round3(srow.score))}.`;
      }
      const asMeasured = S5.region === 'US-NY' && S5.ad && S5.device === 'desktop' && S5.kBlend === LEARN_DOC.regional.kBlend;
      strangerMeasured.textContent = asMeasured
        ? 'Measured, New York from the ad on the demo worker: brand apple 1, ecosystem ios 1, category phones 1, price band premium 1, regional λ 1 with 0.55, score_base 0.61, score_final 0.671, the seed applied +0.066 (the demo’s facts sheet, §9; the receipt in section 9). Every number agrees.'
        : 'The measured receipt is New York, from the ad, on a laptop, at kBlend 0.5 (the receipt in section 9); these settings differ.';
      // The hinge
      const steps = runScenario({ region: S5.region === 'live' ? 'live' : S5.region, share: S5.region === 'live' ? s5Share() : null, liveRegion: s5RegionKey(), ad: S5.ad, device: S5.device, kBlend: S5.kBlend });
      const scoreOf = (st, id) => { const r = st.decision.rows.find((x) => x.piece.id === id); return r && !r.why ? r.score : 0; };
      const androidBest = (st) => Math.max(0, ...st.decision.rows.filter((r) => !r.why && (r.piece.tags.ecosystem || []).includes('android')).map((r) => r.score));
      const L = steps.map((st, i) => [i, scoreOf(st, 'promo-iphone-18-pro-launch')]);
      const G = steps.map((st, i) => [i, scoreOf(st, 'promo-galaxy-s26-new-line')]);
      const A = steps.map((st, i) => [i, androidBest(st)]);
      const yMax = Math.max(0.8, ...L.map((p) => p[1]), ...G.map((p) => p[1])) + 0.05;
      const hf = frame({ w: 980, h: 260, pad: { l: 44, r: 20, b: 34 }, x: [-0.3, steps.length - 0.7], y: [0, yMax], xTicks: steps.map((_, i) => i), xFmt: (i) => steps[i].short, yTicks: [0, 0.2, 0.4, 0.6, 0.8].filter((v) => v <= yMax), yFmt: f2, label: 'launch offer and Galaxy S26 offer scores across her presses' });
      hf.path(L, 'curve curve--w');
      hf.path(G, 'curve');
      hf.path(A, 'curve curve--b proj');
      // Each label sits on the far side of its own line from the other line, so the two never collide.
      L.forEach(([x, y], i) => { const above = y >= G[i][1]; hf.dot(x, y, 'dot dot--w'); hf.text(x, y, f3(round3(y)), 'lbl', 'middle', above ? -9 : 17); });
      G.forEach(([x, y], i) => { const above = y > L[i][1]; hf.dot(x, y, 'dot'); hf.text(x, y, f3(round3(y)), 'lbl lbl--r', 'middle', above ? -9 : 17); });
      const cross = steps.findIndex((st, i) => i > 0 && A[i][1] > L[i][1]);
      if (cross > 0) hf.vline(cross - 0.5, 'vl', 'Android overtakes', 'vl-lbl');
      clear(hingeChart).append(h('p', { class: 'chart-k', text: `${s5RegionName()} · ${S5.ad ? 'from the ad' : 'no ad'} · ${S5.device === 'desktop' ? 'laptop' : S5.device} · kBlend ${wfmt(S5.kBlend)}` }),
        h('div', { class: 'legend' }, h('span', { class: 'lg-w', text: 'launch offer (campaign seed, promotion 1.1)' }), h('span', { text: 'Galaxy S26 offer' }), h('span', { class: 'lg-b', text: 'best Android offer' })), hf.svg);
      const last = steps[4];
      const lrow = last.decision.rows.find((x) => x.piece.id === 'promo-iphone-18-pro-launch');
      const pos = last.decision.take.served.findIndex((s) => s.piece.id === 'promo-iphone-18-pro-launch');
      hingeNote.textContent = cross > 0
        ? `Android overtakes the launch offer at “${steps[cross].short}”. At “${last.short}” the launch offer ${pos >= 0 ? `sits in container ${pos + 1}` : 'has left the four'}, its campaign seed still applied (+${f3(lrow && !lrow.why ? lrow.seedApplied : 0)}) and outscored: the seed never switches off, her own evidence outgrows it. The demo’s line “campaign context superseded by observed behaviour” is the page’s reading of the record, written when a seeded piece fell and the leader rests on her own drivers (public/vantage/vantage.js:901-930 at 5ddc64d); the engine itself prints no such sentence.`
        : 'The launch offer holds the lead across these presses on these settings; Android has not outgrown the seed and the region yet.';
    }
    LIVE.listeners.push(render);
    S5.listeners.push(render);
    render();
    everyTick(mount, render);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 6 · Two memories, two speeds
  // ══════════════════════════════════════════════════════════════════════════
  function initS6() {
    const mount = $('s6-inst');
    if (!mount) return;
    const S = { tauBrand: 60 * SECOND, tauEco: 14 * DAY, clock: makeClock(), touches: { 'brand:samsung': [], 'brand:google': [], 'ecosystem:android': [] } };
    const VALS = [
      { key: 'brand:samsung', name: 'brand · samsung', dim: 'brand', cls: 'curve', dot: 'dot' },
      { key: 'brand:google', name: 'brand · google', dim: 'brand', cls: 'curve curve--b', dot: 'dot dot--b' },
      { key: 'ecosystem:android', name: 'ecosystem · android', dim: 'ecosystem', cls: 'curve curve--w', dot: 'dot dot--w' },
    ];
    const tauOf = (dim) => (dim === 'brand' ? S.tauBrand : S.tauEco);
    const press = (brand) => { const t = S.clock.now(); S.touches[`brand:${brand}`].push({ t, w: 1 }); S.touches['ecosystem:android'].push({ t, w: 1 }); render(); };
    const galaxyB = h('button', { type: 'button', class: 'ib ib--red', text: 'View a Galaxy: brand samsung + ecosystem android' });
    galaxyB.addEventListener('click', () => press('samsung'));
    const pixelB = h('button', { type: 'button', class: 'ib', text: 'View a Pixel: brand google + ecosystem android' });
    pixelB.addEventListener('click', () => press('google'));
    const speed = seg('Clock speed', [[1, '×1'], [5, '×5'], [20, '×20']], 1, (v) => S.clock.setSpeed(v));
    const resetB = h('button', { type: 'button', class: 'ib ib--ghost', text: 'Reset' });
    resetB.addEventListener('click', () => { for (const k of Object.keys(S.touches)) S.touches[k] = []; render(); });
    const tauB = slider({ label: 'τ brand', tip: TIPS.s6tauB, values: [10, 20, 30, 45, 60, 90, 120, 300, 600].map((s) => s * SECOND), value: S.tauBrand, fmt: tauLabel, sub: 'Published for the room: 60 s. The engine default: 14 days.', on: (v) => { S.tauBrand = v; render(); } });
    const tauE = seg('τ ecosystem', [[14 * DAY, '14 days (published)'], [90 * DAY, '90 days (design)'], [60 * MINUTE, '1 hour']], S.tauEco, (v) => { S.tauEco = v; render(); });
    const meters = h('div', { class: 'meters' });
    const chart = h('div');
    const read = h('div', { class: 'readout' });
    const sentence = h('p', { class: 'inst-sentence inst-sentence--big' });
    mount.append(
      instHead('Instrument · two memories on one shopper', [LOCAL_TAG, ROOM_TAG], TIPS.s6head),
      h('div', { class: 'ctrls' }, tauB.el, ctrlBlock('τ ecosystem', tauE.el, null, TIPS.s6tauE), ctrlBlock('Clock', speed.el, null, TIPS.s6clock)),
      h('div', { class: 'btnrow' }, h('span', { class: 'btnrow-k', text: 'Views' }), hint(TIPS.s6views, 'the view buttons'), galaxyB, pixelB, resetB),
      h('div', { class: 'cols cols--wide' }, framed('chart-wrap', chart, TIPS.s6chart, 'the chart of interest against time'), h('div', null, ih('Who is in, and until when', TIPS.s6who), meters, read)),
      sentence,
    );
    function render() {
      const now = S.clock.now();
      const K = REGISTRY.K, thIn = REGISTRY.thetaIn, thOut = REGISTRY.thetaOut;
      const past = 150 * SECOND, future = 60 * SECOND;
      const t0 = Math.max(0, now - past), t1 = t0 + past + future;
      const ticks = [];
      for (let s = Math.ceil(t0 / SECOND / 30) * 30; s <= t1 / SECOND; s += 30) ticks.push(s);
      const fr = frame({ w: 620, h: 270, x: [t0 / SECOND, t1 / SECOND], y: [0, 1], xTicks: ticks, yTicks: [0, 0.25, 0.5, 0.75, 1], yFmt: f2, xLabel: 'seconds on this clock', label: 'brand and ecosystem interest against time' });
      fr.hline(thIn, 'th-in', `θin ${f2(thIn)}`);
      fr.hline(thOut, 'th-out', `θout ${f2(thOut)}`);
      fr.vline(now / SECOND, 'now');
      clear(meters);
      clear(read);
      const state = {};
      for (const v of VALS) {
        const tau = tauOf(v.dim);
        const log = S.touches[v.key];
        const pts = [], proj = [];
        for (let i = 0; i <= 200; i++) {
          const t = t0 + (i / 200) * (t1 - t0);
          const pt = [t / SECOND, affinityOf(rAt(log, t, tau), K)];
          if (t <= now) pts.push(pt);
          if (t >= now - (t1 - t0) / 200) proj.push(pt);
        }
        if (log.length) { fr.path(pts, v.cls); fr.path(proj, `${v.cls} proj`); }
        const m = membership(log, K, tau, thIn, thOut, now);
        const a = affinityOf(rAt(log, now, tau), K);
        state[v.key] = { m, a, any: log.length > 0 };
        if (m.exitAt !== null && m.exitAt > now && m.exitAt <= t1) fr.vline(m.exitAt / SECOND, 'vl', `${v.name.split(' · ')[1]} leaves`, 'vl-lbl', 'end');
        meters.append(meterRow({ name: v.name, sub: `τ ${tauLabel(tau)}`, a, thIn, thOut, member: m.inNow }));
        read.append(readoutCell(v.name, m.inNow ? `leaves in ${dur(m.exitAt - now)}` : (m.exitAt !== null ? 'withdrawn' : (log.length ? 'under θin' : 'no touch')), m.inNow ? 't* in closed form' : null, m.inNow ? 'in' : 'out'));
      }
      clear(chart).append(h('p', { class: 'chart-k', text: S.clock.running ? `live · clock ×${S.clock.speed}` : 'paused' }),
        h('div', { class: 'legend' }, h('span', { text: 'brand samsung' }), h('span', { class: 'lg-b', text: 'brand google' }), h('span', { class: 'lg-w', text: 'ecosystem android' })), fr.svg);
      const sam = state['brand:samsung'], eco = state['ecosystem:android'];
      if (sam.any && sam.m.exitAt !== null && !sam.m.inNow && eco.m.inNow) sentence.textContent = `Samsung claim withdrawn; Android holds at ${f3(eco.a)}. The Samsung offers lose their brand term and keep their ecosystem term, which is why the four usually keep their order.`;
      else if (sam.m.inNow && eco.m.inNow) sentence.textContent = `Both claims held. Stop pressing: brand samsung leaves in ${dur(sam.m.exitAt - now)}, ecosystem android in ${dur(eco.m.exitAt - now)}.`;
      else if (sam.any) sentence.textContent = 'Three Galaxy views close together put brand samsung over θin 0.60; then stop and watch.';
      else sentence.textContent = 'Press the Galaxy three times close together, then stop.';
    }
    render();
    everyTick(mount, render);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // The worked example · the chain, end to end
  // ══════════════════════════════════════════════════════════════════════════
  function initEx() {
    const mount = $('ex-inst');
    if (!mount) return;
    const S = { ...EX_DEFAULTS, step: 4 };
    const stepsBar = h('div', { class: 'steps', role: 'group', 'aria-label': 'Steps' });
    const left = h('div');
    const right = h('div');
    const regionSeg = seg('Region', [['US-NY', 'New York'], ['US-TX', 'Texas']], S.region, (v) => { S.region = v; render(); });
    const adSeg = seg('Arrival', [[true, 'from the ad'], [false, 'no ad']], S.ad, (v) => { S.ad = v; render(); });
    const devSeg = seg('Device', [['desktop', 'laptop'], ['iphone', 'iPhone'], ['android', 'Android']], S.device, (v) => { S.device = v; render(); });
    // Three equal touches g apart cross θin only if 1 + x + x² ≥ K·θin/(1 − θin), x = e^(−g/τ): the widest g that still does.
    const bp = dimParams(REGISTRY, 'brand'), needR = (bp.K * bp.thetaIn) / (1 - bp.thetaIn);
    const crossGapMs = -bp.tauMs * Math.log((-1 + Math.sqrt(4 * needR - 3)) / 2);
    const gapS = slider({ label: 'Seconds between the Samsung touches', tip: TIPS.exGap, min: 0.5, max: 10, step: 0.1, value: S.gapS, fmt: (v) => `${f1(v)} s`, sub: `Fitted default: 3.5 s, with which the page reproduces the hosted reading of 0.612 after the third touch. The suite’s own touches land 1 to 2.5 s apart and are read about a second later. Evenly spaced, three touches cross 0.60 only if the first and third land within ${f1((2 * crossGapMs) / SECOND)} s.`, on: (v) => { S.gapS = v; render(); } });
    const pixS = slider({ label: 'Seconds from the third touch to the hinge', tip: TIPS.exPix, min: 0.5, max: 40, step: 0.1, value: S.toPixelS, fmt: (v) => `${f1(v)} s`, sub: 'Fitted default: 2.6 s, at which the page computes the hinge as brand 0.601 and the four 0.353 · 0.336 · 0.303 · 0.245. Slide it out to a presenter’s pace and watch the Samsung claim fade before she reaches home.', on: (v) => { S.toPixelS = v; render(); } });
    const askS = slider({ label: 'Seconds from the third touch to the re-ask', tip: TIPS.exAsk, min: 5, max: 150, step: 1, value: S.reaskS, fmt: (v) => `${v} s`, sub: 'Default: 52 s, when the hosted suite re-asked (brand 0.398). On stage the page waits a minute after the press.', on: (v) => { S.reaskS = v; render(); } });
    const resetT = h('button', { type: 'button', class: 'ib ib--ghost', text: 'Back to the fitted defaults' });
    resetT.addEventListener('click', () => {
      Object.assign(S, { region: EX_DEFAULTS.region, ad: EX_DEFAULTS.ad, device: EX_DEFAULTS.device, gapS: EX_DEFAULTS.gapS, toPixelS: EX_DEFAULTS.toPixelS, reaskS: EX_DEFAULTS.reaskS });
      regionSeg.set(S.region); adSeg.set(S.ad); devSeg.set(S.device); gapS.set(S.gapS); pixS.set(S.toPixelS); askS.set(S.reaskS); render();
    });
    mount.append(
      instHead('Instrument · beats 1 to 5, recomputed', [LOCAL_TAG, ROOM_TAG, SYN_TAG], TIPS.exHead),
      ih('The six steps', TIPS.exSteps),
      stepsBar,
      h('div', { class: 'ctrls' }, ctrlBlock('Region', regionSeg.el, null, TIPS.exRegion), ctrlBlock('Arrival', adSeg.el, null, TIPS.exAd), ctrlBlock('Her device', devSeg.el, null, TIPS.exDev), gapS.el, pixS.el, askS.el),
      h('div', { class: 'btnrow' }, resetT, hint(TIPS.exReset, 'the reset to the fitted defaults')),
      h('div', { class: 'ex-grid' }, h('div', { class: 'ex-col' }, ih('This step, recomputed', TIPS.exLeft), left), h('div', { class: 'measured' }, ih('Measured on the service', TIPS.exRight), right)),
    );
    function render() {
      const steps = runScenario({ region: S.region, ad: S.ad, device: S.device, gapS: S.gapS, toPixelS: S.toPixelS, reaskS: S.reaskS });
      clear(stepsBar);
      steps.forEach((st, i) => {
        const b = h('button', { type: 'button', class: 'step', 'aria-pressed': String(i === S.step) }, h('b', { text: `${i} · t = ${f1(st.at / SECOND)} s` }), h('span', { text: st.title }));
        b.addEventListener('click', () => { S.step = i; render(); });
        stepsBar.append(b);
      });
      const st = steps[S.step];
      clear(left);
      // What happened
      left.append(h('p', { class: 'inst-h', text: `What happened · ${st.asked ? 'the homepage is asked' : 'the homepage is not asked while she browses; shown as if it were'}` }));
      const evs = h('ul', { class: 'events' });
      if (!st.fired.length) evs.append(h('li', null, S.step === 0 ? 'No event. The landing entry fires the campaign seed; the region prior fills an empty vector at λ = 1.' : 'No event. The page asks again; every interest is decayed at the read, so the engine’s answer is new and the page computed nothing.'));
      for (const f of st.fired) evs.append(h('li', null, `${f.e.type} · ${PHONE[f.e.data.productId].name} (${f.e.data.view}) → `, h('em', { text: f.touches.map((t) => `${t.dim} ${t.value}`).join(', ') }), f.entered.length ? ` · entered ${f.entered.join(', ')}` : ''));
      left.append(evs);
      // Her vector
      left.append(h('p', { class: 'inst-h', text: 'Her own vector at the decision' }));
      const mtr = h('div', { class: 'meters' });
      const aud = new Set(st.snap.audiences);
      let anyV = false;
      for (const spec of REGISTRY.dimensions) {
        const values = st.snap.dims[spec.key];
        if (!values) continue;
        const p = dimParams(REGISTRY, spec.key);
        for (const [v, a] of Object.entries(values).sort((x, y) => y[1] - x[1])) {
          anyV = true;
          const member = aud.has(audienceKey(spec.key, v));
          mtr.append(meterRow({ name: `${DIM_LABEL[spec.key]} · ${v}`, sub: `τ ${tauLabel(p.tauMs)}`, a, thIn: p.thetaIn, thOut: p.thetaOut, member: member && a >= p.thetaOut }));
        }
      }
      if (!anyV) mtr.append(h('p', { class: 'meter-empty', text: 'Empty: a stranger.' }));
      left.append(mtr);
      const sam = st.snap.dims.brand && st.snap.dims.brand.samsung;
      if (sam !== undefined && st.samsungExit !== null) {
        left.append(h('p', { class: 'inst-note', text: st.at < st.samsungExit
          ? `brand samsung ${f3(sam)}: ${sam >= 0.6 ? 'over θin' : 'under θin, still in the audience by hysteresis'}; with no further Samsung touch it leaves at t* = ${f1(st.samsungExit / SECOND)} s (closed form), ${dur(st.samsungExit - st.at)} from now.`
          : `brand samsung ${f3(sam)}: under θout since t* = ${f1(st.samsungExit / SECOND)} s, so ranking reads the withdrawn claim. On the session host the audience flag itself is re-evaluated at her next event; the object host’s alarm would fire at t*.` }));
      }
      // λ and the blend
      const d = st.decision;
      const sigma = evidenceOf(st.snap.dims);
      left.append(h('p', { class: 'inst-h', text: 'λ and the blend' }),
        h('p', { class: 'inst-note' }, h('b', { text: `λ = ${wfmt(S.kBlend)} / (${wfmt(S.kBlend)} + ${f3(sigma)}) = ${f3(d.lambda)}` }), ` · ${REGION_NAME[S.region]}’s synthetic sales speak with weight ${f3(d.lambda)}, her own vector with ${f3(1 - d.lambda)}.`));
      const bl = [];
      for (const dim of LEARN_DOC.regional.dimensions) {
        const vals = d.affinity[dim] || {};
        const top = Object.entries(vals).sort((x, y) => y[1] - x[1]).slice(0, 3);
        if (top.length) bl.push(`${dim}: ${top.map(([v, a]) => `${v} ${f3(a)}`).join(', ')}`);
      }
      left.append(h('p', { class: 'inst-note', text: `ã: ${bl.join(' · ')}` }));
      // The deals module
      left.append(h('p', { class: 'inst-h', text: 'The deals module: the four, then the ranking' }));
      const bx = h('div', { class: 'boxes' });
      d.take.served.forEach((s, i) => bx.append(h('div', { class: i === 0 ? 'box box--lead' : 'box' }, h('p', { class: 'box-k' }, h('span', { text: `container ${i + 1}` }), h('span', { text: s.piece.tags.brand ? s.piece.tags.brand[0] : 'no brand' })), h('p', { class: 'box-t', text: s.piece.title }), h('p', { class: 'box-s', text: f3(round3(s.score)) }))));
      left.append(bx);
      const tb = h('tbody');
      const ranked = d.take.ranked.slice(0, 8);
      ranked.forEach((r) => {
        const pos = d.take.served.findIndex((s) => s.piece.id === r.piece.id);
        const yielded = (d.take.yielded || []).some((s) => s.piece.id === r.piece.id);
        tb.append(h('tr', { class: pos >= 0 ? 'is-served' : null },
          h('td', { 'data-k': 'candidate' }, h('div', { class: 'ttl', text: r.piece.title })),
          h('td', { 'data-k': 'the sum' }, sumLine(r, { blended: true })),
          h('td', { class: 'num', 'data-k': 'score', text: f3(round3(r.score)) }),
          h('td', { 'data-k': 'outcome' }, h('span', { class: pos >= 0 ? 'out out--served' : yielded ? 'out out--yield' : 'out', text: pos >= 0 ? `container ${pos + 1}` : yielded ? 'yielded: 2 per brand' : 'not in the four' }))));
      });
      left.append(h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'candidate' }), h('th', { text: 'Σ ã × w + seeds × multiplier' }), h('th', { class: 'num', text: 'score' }), h('th', { text: 'outcome' }))), tb)));
      // Measured, beside it: FACTS.md §12, under the conditions it was measured in, and only those.
      clear(right);
      const ul = h('ul');
      const C = FACTS.conditions;
      const asMeasured = S.region === C.region && S.ad === C.ad && S.device === C.device;
      let src = FACTS.steps[S.step].src;
      if (asMeasured) for (const line of FACTS.steps[S.step].rows) ul.append(h('li', { text: line }));
      else if (S.step === 0 && S.device === 'desktop' && S.region === 'US-TX') { for (const line of (S.ad ? FACTS.texas.ad : FACTS.texas.noAd)) ul.append(h('li', { text: line })); src = FACTS.texas.src; }
      else if (S.step === 0 && S.device === 'desktop' && S.region === 'US-NY' && !S.ad) { for (const line of FACTS.newYorkNoAd.rows) ul.append(h('li', { text: line })); src = FACTS.newYorkNoAd.src; }
      else { ul.append(h('li', { text: 'No measured row for these settings. The suites run in New York (the labelled override), from the ad, with no platform header; Texas was measured on arrival only.' })); src = null; }
      right.append(ul);
      right.append(h('p', { class: 'inst-h', text: 'Recomputed here, on the same documents' }));
      const ul2 = h('ul');
      const launchRow = d.rows.find((r) => r.piece.id === 'promo-iphone-18-pro-launch');
      const fourLine = `the four: ${d.take.served.map((s) => `${s.piece.title.replace(/[.:].*$/, '')} ${f3(round3(s.score))}`).join(' · ')}`;
      if (S.step === 0 || S.step >= 4) ul2.append(h('li', { text: fourLine }));
      if (launchRow && !launchRow.why && S.ad && (S.step === 0 || S.step === 4)) ul2.append(h('li', { text: `the campaign seed applied on the launch offer: +${f3(launchRow.seedApplied)}` }));
      if (sam !== undefined) ul2.append(h('li', { text: `brand samsung ${f3(sam)}${S.step === 5 ? `, ecosystem android ${f3((st.snap.dims.ecosystem || {}).android || 0)}` : ''}` }));
      if (S.step >= 1 && S.step <= 3) ul2.append(h('li', { text: 'the homepage is not asked while she browses; the four above are what it would answer' }));
      right.append(ul2);
      right.append(h('p', { class: 'src', text: src ? `Measured: ${src}, quoted from ${FACTS.sheet}.` : `Measured numbers: ${FACTS.sheet}.` }));
      const timed = S.gapS === EX_DEFAULTS.gapS && S.toPixelS === EX_DEFAULTS.toPixelS && S.reaskS === EX_DEFAULTS.reaskS;
      right.append(h('p', { class: 'src', text: timed
        ? 'The timings are fitted defaults, not the hosted suite’s pace: with them the page reproduces the suite’s third-touch reading, its brand reading at the hinge and its exit reading. The suite’s touches land 1 to 2.5 s apart and are read about a second later, which is why its first two touches read a little lower there than at the instant of the touch here.'
        : 'Your timings differ from the fitted defaults: brand forgets on 60 s, so a second of spacing moves the third decimal.' }));
    }
    render();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 7 · Learning what works
  // ══════════════════════════════════════════════════════════════════════════
  function initS7() {
    const mount = $('s7-inst');
    if (!mount) return;
    const base = (() => { const st = runScenario({})[4]; const r = st.decision.rows.find((x) => x.piece.id === 'promo-galaxy-s26-new-line'); return round3(r.score); })();
    const S = { n: 400, s: 22, p0: 0.04, n0: LEARN_DOC.stats.n0, gamma: 0, base, fan: 3 };
    const sS = slider({ label: 's, successes (clicks) in her cell', tip: TIPS.s7s, min: 0, max: 400, step: 1, value: S.s, fmt: (v) => String(v), on: (v) => { S.s = Math.min(v, S.n); if (S.s !== v) sS.set(S.s); render(); } });
    const nS = slider({ label: 'n, exposures of this item in her cell', tip: TIPS.s7n, min: 0, max: 3000, step: 10, value: S.n, fmt: (v) => String(v), sub: 'Decayed over the 21-day horizon.', on: (v) => { S.n = v; if (S.s > v) { S.s = v; sS.set(v); } sS.input.max = String(Math.max(1, v)); render(); } });
    sS.input.max = String(S.n);
    const pS = slider({ label: 'p0, the slot’s rate in this cell', tip: TIPS.s7p0, min: 0.005, max: 0.2, step: 0.005, value: S.p0, fmt: (v) => `${(v * 100).toFixed(1)} %`, on: (v) => { S.p0 = v; render(); } });
    const n0S = slider({ label: 'n0, the shrinkage strength', tip: TIPS.s7n0, min: 1, max: 300, step: 1, value: S.n0, fmt: (v) => String(v), sub: 'Published: 30.', on: (v) => { S.n0 = v; render(); } });
    const gS = slider({ label: 'γ, the trust dial', tip: TIPS.s7gamma, min: 0, max: 1, step: 0.05, value: S.gamma, fmt: f2, sub: 'Published: 0 on every slot.', on: (v) => { S.gamma = v; render(); } });
    const bS = slider({ label: 'the base score it multiplies', tip: TIPS.s7base, min: 0, max: 1, step: 0.001, value: S.base, fmt: f3, sub: 'Default: the Galaxy S26 offer at the hinge (worked example, step 4).', on: (v) => { S.base = v; render(); } });
    const fanS = slider({ label: 'each coarser cell holds × more exposures', tip: TIPS.s7fan, min: 1, max: 8, step: 0.5, value: S.fan, fmt: (v) => `× ${v}`, sub: 'Illustrative counts you set, for the ladder below.', on: (v) => { S.fan = v; render(); } });
    const read = h('div', { class: 'readout' });
    const sentence = h('p', { class: 'inst-sentence inst-sentence--big' });
    const chart = h('div');
    const ladderBody = h('tbody');
    mount.append(
      instHead('Instrument · one item, one cell, one dial', [LOCAL_TAG, ['inputs here are yours, not measurements', true]], TIPS.s7head),
      h('div', { class: 'ctrls' }, nS.el, sS.el, pS.el, n0S.el, gS.el, bS.el),
      ih('The estimate and the score', TIPS.s7read), read, sentence,
      h('div', { class: 'cols cols--wide' }, framed('chart-wrap', chart, TIPS.s7chart, 'the chart of the pooled rate'), h('div', null, ih('The ladder: the finest cell with n ≥ nMin 30 answers', TIPS.s7ladder), fanS.el,
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'the cell, and its key' }), h('th', { class: 'num', text: 'n' }), h('th', { text: '' }))), ladderBody))),
      h('p', { class: 'inst-note', text: 'Every served decision is an exposure and every credited click a success, recorded from day one (src/learn/stats.ts:162-183). With γ at 0 those counts are kept and move nothing; once a cell has a lift in force, it is recorded on the receipt and ignored. On stage no cell has one yet, so the receipts read lift: null.' }),
    );
    function render() {
      const { liftMin, liftMax, nMin } = LEARN_DOC.stats;
      const pHat = pooled(S.s, S.n, S.n0, S.p0);
      const raw = S.p0 > 0 ? pHat / S.p0 : 1;
      const lift = liftOf(pHat, S.p0, liftMin, liftMax);
      const fin = liftedScore(S.base, lift, S.gamma);
      clear(read).append(
        readoutCell('p̂, the pooled rate', `${(pHat * 100).toFixed(2)} %`, `(${S.s} + ${S.n0} × ${(S.p0 * 100).toFixed(1)} %) / (${S.n} + ${S.n0})`),
        readoutCell('its own rate s / n', S.n ? `${((S.s / S.n) * 100).toFixed(2)} %` : '–', 'what shrinkage pulls toward p0'),
        readoutCell('lift', f3(lift), raw !== lift ? `p̂ / p0 = ${f3(raw)}, clamped to [0.5, 2]` : `p̂ / p0 = ${f3(raw)}`),
        readoutCell('lift^γ', f3(Math.pow(lift, S.gamma)), `γ = ${f2(S.gamma)}`),
        readoutCell('score', `${f3(S.base)} → ${f3(fin)}`, `base × lift^γ, a change of ${f3(fin - S.base)}`, S.gamma === 0 ? null : 'in'),
      );
      sentence.textContent = S.gamma === 0
        ? `γ = 0: the lift of ${f3(lift)} is computed and printed, and the score does not move. Records from day one; moves nothing until you turn this.`
        : `γ = ${f2(S.gamma)}: the score moves by ${f3(fin - S.base)}, never more than the clamp allows (× ${f2(Math.pow(liftMax, S.gamma))} at most).`;
      // p̂ against n, at her own observed rate
      const rate = S.n ? S.s / S.n : S.p0;
      const yMax = Math.max(S.p0 * 2.2, rate * 1.25, 0.02);
      const fr = frame({ w: 560, h: 250, x: [0, 3000], y: [0, yMax], xTicks: [0, 500, 1000, 1500, 2000, 2500, 3000], yTicks: [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax], yFmt: (v) => `${(v * 100).toFixed(1)}%`, xLabel: 'exposures n', label: 'pooled estimate against exposures' });
      fr.band(0, 3000, 'band faint');
      fr.hline(S.p0, 'th-out', `p0 ${(S.p0 * 100).toFixed(1)} %`);
      if (2 * S.p0 <= yMax) fr.hline(2 * S.p0, 'th-in', 'lift 2: the clamp');
      fr.hline(0.5 * S.p0, 'th-in', 'lift 0.5');
      const pts = [];
      for (let i = 0; i <= 150; i++) { const n = (i / 150) * 3000; pts.push([n, pooled(rate * n, n, S.n0, S.p0)]); }
      fr.path(pts, 'curve');
      fr.hline(rate, 'curve curve--b proj', `s / n ${(rate * 100).toFixed(1)} %`, 'lbl lbl--b');
      fr.dot(S.n, pHat, 'dot dot--w', 4.5);
      clear(chart).append(h('p', { class: 'chart-k', text: `p̂ = (s + n0·p0)/(n + n0) at her rate s/n, n0 = ${S.n0}` }), fr.svg);
      // The ladder
      // The six keys a cell materialises (src/learn/stats.ts:47-50), for a paid-social first visit in New York leaning Android.
      const keys = ['*', 'c=paid_social', 'c=paid_social|v=1', 'c=paid_social|v=1|s=early', 'c=paid_social|v=1|s=early|r=US-NY', 'c=paid_social|v=1|s=early|r=US-NY|a=ecosystem:android'];
      const words = ['everyone', 'channel', '+ visit', '+ stage', '+ region', '+ her leading interest'];
      const ns = keys.map((_, lvl) => Math.round(S.n * Math.pow(S.fan, 5 - lvl)));
      let answers = -1;
      for (let lvl = 5; lvl >= 0; lvl--) if (ns[lvl] >= nMin) { answers = lvl; break; }
      clear(ladderBody);
      keys.forEach((k, lvl) => ladderBody.append(h('tr', { class: lvl === answers ? 'is-served' : null },
        h('td', { 'data-k': 'cell' }, h('div', { class: 'ttl', text: `${lvl} · ${words[lvl]}` }), h('div', { class: 'madds', text: k })),
        h('td', { class: 'num', 'data-k': 'n', text: ns[lvl].toLocaleString('en-US') }),
        h('td', { 'data-k': '' }, h('span', { class: lvl === answers ? 'out out--served' : 'out', text: lvl === answers ? 'answers' : ns[lvl] >= nMin ? 'coarser' : 'under 30' })))));
    }
    render();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 8 · The knobs are the model: the documents, annotated
  // ══════════════════════════════════════════════════════════════════════════
  const NOTES = {
    registry: {
      K: 'The evidence constant: a = R / (R + K). One view gives 0.357.',
      thetaIn: 'Enter an audience at 0.60 (evidence R ≥ 2.7).',
      thetaOut: 'Leave under 0.45 (R < 1.4727). The validator keeps it under thetaIn.',
      tauMs: 'The memory of a dimension that names none: 14 days. The validator caps any τ at 90 days.',
      epsilon: 'Evidence decayed under 0.01 is dropped, so the state stays small. The engine default is 0.0001.',
      maxValuesPerDim: 'At most 64 values per dimension; the weakest is evicted. The engine default is 24.',
      eventAttributes: 'Score the attributes the event carries when the engine holds no catalog for the product, within the registry and the tenant’s vocabulary.',
      version: 'Every write stamps it with its revision (+r3 here), so a receipt names the exact tuning it ran under.',
      dimensions: 'The axes. Each names the product or event field it reads; a field no dimension names is ignored.',
      'dimensions[0]': 'Category, read as it stands; the 14-day default memory.',
      'dimensions[1]': 'Brand forgets on 60 s: compressed for the room. The engine default is 14 days.',
      'dimensions[2]': 'Ecosystem keeps the 14-day default: the slow lean.',
      'dimensions[3].derive': 'Derived from a number, not read as a word.',
      'dimensions[3].cuts': 'Under $400 entry, under $900 core, else premium, on full retail.',
      'dimensions[3].tauMs': 'Ten minutes for the room. The engine default is 35 days.',
      'dimensions[4]': 'Intent is a list: every value on the event is touched. Ten minutes for the room.',
      'dimensions[5]': 'Perk, a list, ten minutes for the room.',
      'dimensions[6]': 'Lines: moved by behaviour only, never seeded from census household tables.',
      'dimensions[7]': 'Content type: 60 s for the room.',
      journey: 'Stage thresholds: six product views in a visit is thinking (the content fits call it considering); the first cart add or purchase is deciding.',
      weights: 'What each action adds to R. An action this table does not name adds 0.',
      'weights.product_view': 'A view: 1, as the engine ships it.',
      'weights.page_view': 'Published by Vantage. The engine’s shipped table has no page_view, search, select, filter, compare or start_order, so an untuned tenant weighs them 0.',
      'weights.search': 'A search: 1.5 (Vantage’s).',
      'weights.select': 'A declared selector (lines, storage, the intent toggle): 2 (Vantage’s).',
      'weights.compare': 'A compare: 2 (Vantage’s).',
      'weights.start_order': 'A started order or an address check: 3 (Vantage’s).',
      'weights.add_to_cart': 'A cart add: 3, as shipped.',
      'weights.purchase': 'A purchase: 5, as shipped.',
      'weights.content_impression': 'An impression is involuntary and never reads as interest: 0.',
    },
    slots: {
      version: 'The slots document at revision 51: per page, the slots in page order. Beat 13 adds pinnedPieceIds to deals.',
      'pages.home[0]': null,
      'pages.home[0].take': 'The hero: one piece.',
      'pages.home[0].weights': 'The hero’s own dimension weights.',
      'pages.home[0].stage': 'The continue hero is multiplied by 0 outside its stages and gains 0.5 inside them.',
      'pages.home[0].seeds': 'The same campaign seed as deals, at 0.2.',
      'pages.home[1].take': 'Four containers.',
      'pages.home[1].weights': 'The deals slot’s vector of weights, 0 to 1 each.',
      'pages.home[1].weights.intent': 'Declared intent is the carrier’s own merchandising axis: 1.',
      'pages.home[1].weights.lines': 'The lines she declares count 0.4 here. On the hosted suite at beat 9b the four-line offer reached 0.601, level with the watch line (the demo’s facts sheet §12).',
      'pages.home[1].weights.campaign': 'Not a registry dimension: no event builds it, so only the seed scores it.',
      'pages.home[1].diversity': 'At most two per brand; a third yields its container to the next ranked piece.',
      'pages.home[1].merchandising': 'The launch offer carries promotion 1: × (1 + 0.1 × 1) = 1.1, clamped to 0.7..1.6. A multiplier tilts; it never overrides.',
      'pages.home[1].seeds[0]': 'utm_term iphone-18-pro adds 0.2 on the campaign tag.',
      'pages.home[1].seeds[1]': 'An iPhone adds 1 on ecosystem ios; ×0.5 while she holds intent switch, ×0 once she holds android.',
      'pages.home[1].seeds[2]': 'The same for an Android phone.',
      'pages.phone[0]': null,
      'pages.phone[0].take': 'The phone page’s modules: six of seven, ordered. The order returned is the sequence.',
      'pages.phone[1].take': 'Plan pairing: three of four, ordered.',
    },
    learn: {
      version: 'What the slots learn, and how the prior blends, at revision 3.',
      holdout: 'Holdout 0 on stage, shown not run: assignment is a sticky hash, and a 5 percent arm could put the presenter’s own visitor in the default arm.',
      regional: 'The prior. A published learn document without this block turns it off.',
      'regional.enabled': 'On.',
      'regional.kBlend': 'λ = 0.5 / (0.5 + Σa): the prior gives way twice as fast as at the compiled default of 1.',
      'regional.minEvents': 'A region answers at 30 events; else its country; else everyone.',
      'regional.dimensions': 'The prior blends only what the seeded sales speak for. Without the list, a walkthrough’s intent, lines, perk and content-type touches reached full share for the next stranger.',
      policy: 'Attribution: session scope, a direct match, the last decision gets the credit.',
      'policy.windowsMs': 'A click counts for 30 minutes, a wishlist or bag add for 6 hours, a purchase for 7 days.',
      stats: 'n0 30, the shrinkage strength; 21 days of memory for exposures and successes; lift clamped to [0.5, 2]; a cell answers at nMin 30 exposures.',
      'slots.deals': 'γ = 0 and exploration off on every slot: once a lift is in force it is computed, recorded and ignored.',
      'slots.deals.gamma': 'The trust dial, 0 to 1 per slot.',
    },
  };

  /** JSON, two-space indented, one line per key, with the note for each path beside it. */
  function annotatedLines(doc, notes) {
    const lines = [];
    const emit = (text, path) => lines.push({ text, note: path !== null && notes[path] ? notes[path] : null });
    const inlineable = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 5
      && Object.values(v).every((x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => typeof y !== 'object'))) && JSON.stringify(v).length <= 72;
    const inline = (v) => (Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${Array.isArray(x) ? inline(x) : JSON.stringify(x)}`).join(', ')} }`);
    function walk(v, path, depth, key, last) {
      const pad = '  '.repeat(depth);
      const k = key === null ? '' : `${JSON.stringify(key)}: `;
      const comma = last ? '' : ',';
      if (Array.isArray(v)) {
        if (v.every((x) => x === null || typeof x !== 'object')) { emit(`${pad}${k}${inline(v)}${comma}`, path); return; }
        emit(`${pad}${k}[`, path);
        v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1, null, i === v.length - 1));
        emit(`${pad}]${comma}`, null);
      } else if (v && typeof v === 'object') {
        if (path !== '' && inlineable(v)) { emit(`${pad}${k}${inline(v)}${comma}`, path); return; }
        emit(`${pad}${k}{`, path === '' ? null : path);
        const keys = Object.keys(v);
        keys.forEach((kk, i) => walk(v[kk], path ? `${path}.${kk}` : kk, depth + 1, kk, i === keys.length - 1));
        emit(`${pad}}${comma}`, null);
      } else emit(`${pad}${k}${JSON.stringify(v)}${comma}`, path);
    }
    walk(doc, '', 0, null, true);
    return lines;
  }
  function annotatedBlock(doc, notes) {
    const wrap = h('div', { class: 'annot' });
    for (const ln of annotatedLines(doc, notes)) {
      wrap.append(h('div', { class: ln.note ? 'ln ln--noted' : 'ln' }, h('span', { class: 'code-l', text: ln.text }), h('span', { class: 'note-l', text: ln.note || '' })));
    }
    return wrap;
  }
  function initS8() {
    const mount = $('s8-docs');
    if (!mount) return;
    const docs = [
      ['The dimension registry', 'PUT /config/reflex · served at reflex r3, published 2026-10-01 14:34:48 UTC · seed: scripts/seed-vantage.mjs:100-144 at c720907', PUBLISHED.registry, NOTES.registry, true],
      ['The slots', 'PUT /content/slots · served at slots r51, the opening state · seed: scripts/seed-vantage.mjs:577-610 at c720907', PUBLISHED.slots, NOTES.slots, false],
      ['What the slots learn', 'PUT /content/learn · served at learn r3, published 14:34:53 UTC · seed: scripts/seed-vantage.mjs:621-638 at c720907', PUBLISHED.learn, NOTES.learn, false],
    ];
    const wrap = h('div', { class: 'docs' });
    const tips = [TIPS.s8reg, TIPS.s8slots, TIPS.s8learn];
    docs.forEach(([title, ref, doc, notes, open], i) => {
      const details = h('details', { class: 'doc', open: open || null }, h('summary', null, h('span', { class: 'doc-t', text: title }), h('span', { class: 'doc-r', text: ref })), annotatedBlock(doc, notes));
      wrap.append(h('div', { class: 'doc-wrap has-hint' }, h('div', { class: 'hint-corner' }, hint(tips[i], title)), details));
    });
    mount.append(h('p', { class: 'note', text: 'As served on the demo worker on 1 October 2026 (the demo’s facts sheet, §10), identical to the seed’s own definitions; annotated for reading, published as plain JSON. The arithmetic on this page reads the same values.' }), wrap);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 9 · The receipt
  // ══════════════════════════════════════════════════════════════════════════
  /** What each field of the receipt means: FACTS.md §9's field table, in the page's words. */
  const RECEIPT_NOTES = {
    decision_id: 'tenant : time in base 36 : visitor : page : slot : position : n1 : nonce. The owner is checked before any read.',
    ts: 'The engine’s clock, in milliseconds, never the browser’s.',
    page: 'The page the slot was asked for, by name.',
    slot: 'The slot, by name: one slot name is one statistics object.',
    position: 'Where it was served, counting from 0.',
    ranking_position: 'Its rank after any pinned prefix.',
    item_id: 'The engine’s id for the piece.',
    customer_item_id: 'The customer’s own content id: what the page renders.',
    arm: 'personalized. The holdout’s default arm would see the site’s defaults; the holdout is 0 on stage.',
    authority: 'engine: ranked. The other two are pin and default.',
    explored: 'Exploration is off on stage.',
    cell: 'The edge’s region (North Carolina, where the read ran), though the prior was New York, asserted; visit unknown, none recorded yet; no leading interest yet; stage early.',
    journey: 'The engine’s stage word and the registry revision that derived it.',
    versions: 'The document revisions in force, so the decision can be replayed. lift: 0 means no lift snapshot.',
    config_label: 'The registry revision the decision ran under.',
    candidates: 'The top 10 at the moment of decision. The iPhone 17 offer tied the Duo at 0.55 and yielded to the brand cap.',
    explain: null,
    'explain.drivers': 'The four strongest tag terms by a × w, then the region’s part and the multiplier. a is the blended value: for a stranger, the region’s share at λ = 1, not her own affinity.',
    'explain.score_base': 'Before the multiplier: the tag sum 0.55 plus the seed 0.06.',
    'explain.regional': 'λ, the level that answered, its version and events, asserted, and Σ λ·share·w over the piece’s tags.',
    'explain.lift': 'null: no learned lift in force. At γ = 0 one would be recorded and ignored.',
    'explain.score_final': 'After the multiplier and the lift: the score that ranked it.',
    'explain.contextual': 'The seed as it landed, measured after the multiplier by rerunning without it.',
    'explain.merchandising': 'The per-term deltas, which sum to final minus base.',
    measurementBasis: 'served-v1: counted as served; the page sends no page instance.',
    featured_product_ids: 'The phones that credit this decision when an outcome names one.',
    asserted: 'Added by the route: the region from the record, the intent from the page, because the ledger stores no asserted intent.',
  };
  function initS9() {
    const mount = $('s9-receipt');
    if (!mount) return;
    // The same decision recomputed here: New York's synthetic sales, a stranger from the ad, a laptop, intent new.
    const d = runScenario({ region: 'US-NY', ad: true, device: 'desktop' })[0].decision;
    const row = d.rows.find((r) => r.piece.id === 'promo-iphone-18-pro-launch');
    const mine = d.take.ranked.slice(0, 10).map((s) => ({ contentId: s.piece.id.replace(/-/g, '_'), score: round3(s.score) }));
    const theirs = RECEIPT.candidates;
    let agree = 0;
    const body = h('tbody');
    theirs.forEach((c, i) => {
      const m = mine[i];
      const same = m && m.contentId === c.contentId && Math.abs(m.score - c.score) < 5e-4;
      if (same) agree += 1;
      body.append(h('tr', null,
        h('td', { class: 'mono', 'data-k': 'candidate', text: c.contentId }),
        h('td', { class: 'num', 'data-k': 'service', text: f3(c.score) }),
        h('td', { class: 'num', 'data-k': 'this page', text: m ? `${f3(m.score)}${m.contentId === c.contentId ? '' : ` (${m.contentId})`}` : '–' }),
        h('td', { 'data-k': '' }, h('span', { class: same ? 'out out--served' : 'out out--yield', text: same ? 'agrees' : 'differs' }))));
    });
    const drv = recordDrivers(row, d.lambda, 'US-NY');
    const sameDrivers = drv.length === RECEIPT.explain.drivers.length && drv.every((x, i) => {
      const y = RECEIPT.explain.drivers[i];
      return x.dim === y.dim && x.value === y.value && Math.abs(x.a - y.a) < 5e-4 && Math.abs(x.weight - y.weight) < 5e-4;
    });
    const sumTags = row.terms.filter((t) => t.w && t.a > 0).reduce((s, t) => s + t.a * t.w, 0);
    mount.append(
      h('p', { class: 'rcpt-meta' }, h('span', null, h('b', { text: 'The launch offer, container 1, for a stranger from the ad' }), hint(TIPS.s9receipt, 'the receipt')),
        h('span', { text: 'New York asserted through the labelled rehearsal override · intent new · no platform header · read 2026-10-01 22:29:44 UTC · the demo’s facts sheet, §9' })),
      annotatedBlock(RECEIPT, RECEIPT_NOTES),
      h('div', { class: 'inst recompute' },
        instHead('Recompute it from the receipt, then from the documents', [LOCAL_TAG], TIPS.s9recompute),
        h('p', { class: 'inst-note', text: `From the receipt: the tag terms 1 × 0.2 + 1 × 0.15 + 1 × 0.1 + 1 × 0.1 = 0.55, all of it regional at λ = 1; plus the seed 0.06 = score_base 0.61; × 1.1 = 0.671 = score_final. Without the ad: 0.55 × 1.1 = 0.605. The seed’s share of the final score: 0.671 − 0.605 = +0.066, which is contextual.applied.` }),
        h('p', { class: 'inst-note', text: `From the documents, on this page: the tag terms ${f3(sumTags)}, score_base ${f3(round3(row.scoreBase))}, score_final ${f3(round3(row.score))}, the seed applied +${f3(row.seedApplied)}; the record’s drivers ${sameDrivers ? 'agree term for term' : 'differ'}.` }),
        h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'the receipt’s candidates' }), h('th', { class: 'num', text: 'the service' }), h('th', { class: 'num', text: 'this page' }), h('th', { text: '' }))), body),
        h('p', { class: 'inst-sentence', text: `${agree} of ${theirs.length} candidates agree to the third decimal, in the same order, ties broken by catalogue order and the iPhone 17 offer yielding to the cap.` }),
      ),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Section 10 · What we need from the customer: the mapping
  // ══════════════════════════════════════════════════════════════════════════
  function initS10() {
    const mount = $('s10-map');
    if (!mount) return;
    const rule = (spec) => (spec.derive === 'band' ? `banded at ${spec.cuts.join(' and ')}: ${spec.labels.join(', ')}` : spec.multi ? 'a list: each value is touched' : 'read as it stands');
    const body = h('tbody');
    for (const spec of REGISTRY.dimensions) {
      body.append(h('tr', null,
        h('td', { class: 'mono', 'data-k': 'dimension', text: spec.key }),
        h('td', { class: 'mono', 'data-k': 'feed field', text: spec.source }),
        h('td', { 'data-k': 'how', text: rule(spec) }),
        h('td', { class: 'mono', 'data-k': 'values', text: VOCAB[spec.key].join(', ') })));
    }
    // A promotion feed's fields and what the engine does with each: FACTS.md §11.
    const FEED = [
      ['Brand', '`brand` on events, on /sort and in tags', 'scored'],
      ['OS', '`ecosystem` (an event’s `os` field is ignored)', 'scored'],
      ['Storage', 'the configured price rides the event', 'through the price band'],
      ['Full retail price', '`price_usd` → `priceBand` at 400 / 900, by configuration', 'scored, as a band'],
      ['Offer type', '`badge`, display only', 'no'],
      ['Eligible intents, line requirement', '`eligibleWhen.context.intent` (fails closed), plus `tags.intent`', 'gated and scored'],
      ['Plan requirement', 'the offer’s terms, display only', 'no'],
      ['Priority flag', '`merchandising.promotion` with the slot’s dial, or a pin', 'a multiplier or a prefix'],
      ['Flash end date', '`window.to`', 'eligibility'],
      ['Not combinable', 'the offer’s terms; no stacking logic exists', 'no'],
      ['Coverage', '`eligibleWhen.regions`', 'eligibility'],
      ['Maximum flag, monthly price', 'buy-box content', 'never'],
    ];
    const feedBody = h('tbody');
    for (const [field, where, decided] of FEED) {
      feedBody.append(h('tr', null,
        h('td', { 'data-k': 'feed field', text: field }),
        h('td', { class: 'mono', 'data-k': 'where it goes', text: where.replace(/`/g, '') }),
        h('td', { 'data-k': 'decided?', text: decided })));
    }
    mount.append(
      h('p', { class: 'mini-k' }, 'The registry’s dimensions, and the feed field each reads', hint(TIPS.s10dims, 'the dimension table')),
      h('table', { class: 'maptbl' }, h('thead', null, h('tr', null, h('th', { text: 'dimension' }), h('th', { text: 'feed field' }), h('th', { text: 'how it is read' }), h('th', { text: 'values (exact)' }))), body),
      h('p', { class: 'refline', text: 'The registry and the vocabulary as served (scripts/seed-vantage.mjs:81-112 at c720907; the demo’s facts sheet, §10 and §11).' }),
      h('p', { class: 'mini-k' }, 'A promotion feed’s fields, and what the engine does with each', hint(TIPS.s10feed, 'the promotion-feed table')),
      h('table', { class: 'maptbl' }, h('thead', null, h('tr', null, h('th', { text: 'feed field' }), h('th', { text: 'where it goes' }), h('th', { text: 'decided?' }))), feedBody),
      h('p', { class: 'refline', text: 'The demo’s facts sheet, §11. Several fields are eligibility or display, never scored: eligibility runs before scoring and the offer book goes to the page.' }),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // The side navigation follows the reader
  // ══════════════════════════════════════════════════════════════════════════
  function initToc() {
    const links = [...document.querySelectorAll('.toc a[href^="#"]')];
    const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    if (!('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links) a.removeAttribute('aria-current');
        const a = map.get(e.target.id);
        if (a) a.setAttribute('aria-current', 'true');
      }
    }, { rootMargin: '-35% 0px -60% 0px' });
    for (const id of map.keys()) { const el = $(id); if (el) obs.observe(el); }
  }

  /** The numbers this page must reproduce, for a reviewer's console: window.__howItWorks.selfTest(). */
  function selfTest() {
    const K = REGISTRY.K, floor = (K * REGISTRY.thetaOut) / (1 - REGISTRY.thetaOut);
    const at = (steps, n, id) => { const r = steps[n].decision.rows.find((x) => x.piece.id === id); return r && !r.why ? round3(r.score) : null; };
    const ny = runScenario({ region: 'US-NY', ad: true }), nyNo = runScenario({ region: 'US-NY', ad: false });
    const tx = runScenario({ region: 'US-TX', ad: true }), txNo = runScenario({ region: 'US-TX', ad: false });
    const launch = 'promo-iphone-18-pro-launch', s26 = 'promo-galaxy-s26-new-line';
    const lrow = ny[4].decision.rows.find((x) => x.piece.id === launch);
    const four = (steps, n) => steps[n].decision.take.served.map((s) => round3(s.score));
    const mine = ny[0].decision.take.ranked.slice(0, 10).map((s) => ({ contentId: s.piece.id.replace(/-/g, '_'), score: round3(s.score) }));
    const lrow0 = ny[0].decision.rows.find((x) => x.piece.id === launch);
    return {
      oneTouch: round3(affinityOf(1, K)), twoTouches: round3(affinityOf(2, K)), threeTouches: round3(affinityOf(3, K)), exitFromThreeS: round3((60 * Math.log(3 / floor))),
      entryR: round4((K * REGISTRY.thetaIn) / (1 - REGISTRY.thetaIn)), exitR: round4(floor),
      nyStrangerAd: { four: four(ny, 0), seedApplied: lrow0.seedApplied, scoreBase: round3(lrow0.scoreBase), drivers: recordDrivers(lrow0, ny[0].decision.lambda, 'US-NY'),
        receiptCandidatesAgree: RECEIPT.candidates.every((c, i) => mine[i] && mine[i].contentId === c.contentId && Math.abs(mine[i].score - c.score) < 5e-4) },
      nyStrangerNoAd: { launch: at(nyNo, 0, launch) },
      txStrangerAd: { four: four(tx, 0) },
      txStrangerNoAd: { first: txNo[0].decision.take.served[0].piece.id, s26: at(txNo, 0, s26) },
      brandSamsungByTouch: [1, 2, 3].map((n) => ny[n].snap.dims.brand.samsung),
      step4: { four: four(ny, 4), ids: ny[4].decision.take.served.map((s) => s.piece.id), brandSamsung: ny[4].snap.dims.brand.samsung, launchSeedApplied: lrow.seedApplied, lambda: ny[4].decision.lambda },
      step5: { brandSamsung: ny[5].snap.dims.brand.samsung, ecosystemAndroid: ny[5].snap.dims.ecosystem.android, ids: ny[5].decision.take.served.map((s) => s.piece.id) },
      txHingeAtPress1: at(tx, 1, s26) > at(tx, 1, launch), nyHingeAtPress1: at(ny, 1, s26) > at(ny, 1, launch), nyHingeAtPress2: at(ny, 2, s26) > at(ny, 2, launch),
    };
  }

  function boot() {
    const parts = [initDiagram, initS2, initS3, initS4, initS5, initS6, initEx, initS7, initS8, initS9, initS10, initToc];
    for (const init of parts) { try { init(); } catch (err) { console.error(`how-it-works: ${init.name} failed`, err); } }
    Object.defineProperty(window, '__howItWorks', { value: Object.freeze({ selfTest }), configurable: false, writable: false });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
