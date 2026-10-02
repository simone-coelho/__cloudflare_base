/* public/vantage/vantage.js
 * Vantage: a carrier's homepage and phone page, driven by the engine, on the demo kit.
 *
 * THE RULES THIS FILE EXISTS TO KEEP (docs/demos/BOOTSTRAP.md section 0).
 *
 * 1. THE PAGE NEVER RANKS. There is no sorting, scoring, choosing or eligibility
 *    test in here. The page sends events and asks questions, and renders what
 *    comes back in the order it comes back: the hero, the four deals, the six
 *    phones (POST /sort), the phone page's modules and the plans inside "Pair
 *    with a plan". When the engine cannot answer, the page says so and keeps
 *    what was on screen; it never invents an order.
 * 2. THE CAUSE IS VISIBLE. A shopper beat moves a cursor to a real control and
 *    runs that control's own handler. The event goes out because the control
 *    ran; a module changes because the next decision answered differently.
 * 3. THE BUY BOX IS OFF LIMITS. Price, monthly financing, the term, the trade-in
 *    maths and legal are catalog content, identical for everyone, and the page
 *    says so on screen. Its selectors send behaviour; nothing in it is decided.
 * 4. NO CREDENTIAL IN THE PAGE. Merchandiser beats are applied BY NAME by the
 *    worker (src/routes/vantage.ts); the page holds no operator token.
 *
 * The chassis is the demo kit's (public/demo-kit/, wired by createDemo below): the
 * transport (X-Tenant on every call, the visitor and her consent, the events, the
 * snapshot, the receipts), the director (the beats as data and their runner, the
 * performed presses with the visible cursor, the keyboard, ?debug ?wait ?region
 * ?fixtures), the machine's panels (meters, the cold start, Why these, the day's
 * report), the before/now rows and their chips, predict-then-prove, the sheets
 * and Compare. This file is Vantage's vertical layer: the renderers (the hero,
 * the deal cards, the rail, the pool, the buy box and the module bodies), the
 * facts its beats speak about, the few verbs the kit lacks, and its data.
 *
 * Where each thing comes from:
 *   public/vantage/phones.json, plans.json, catalog.json   lane L1 (content)
 *   public/vantage/beats/*.json, beats/anchor.json          lane L1 (engine documents, page facts)
 *   public/vantage/beats.json                               the director's script: the beats as data (lane K2)
 *   public/vantage/img/MANIFEST.json                        lane L3 (every image, by file)
 *   GET /vantage/api/coldstart                              lane L4 (the arrival panel)
 *   public/vantage/fixtures/*                               lane L2 (labelled build fixtures)
 *
 * Routes, the same shape Top Offers uses, with X-Tenant: vantage on every call:
 *   POST /v1/vantage/identity/session           mint the shopper capability
 *   POST /realtime/session/preferences          her explicit consent choice
 *   POST /realtime/action                       behaviour, and click rewards
 *   GET  /realtime/reflex                       the meters, from her profile
 *   GET  /v1/vantage/decisions/snapshot         hero, deals, modules, plans
 *   POST /sort                                  the "Phones for you" rail
 *   POST /vantage/api/reset | beat | receipt | report
 *   GET  /vantage/api/coldstart
 *   WS   /realtime/ws?tenant=vantage            the exit beat, behind a flag
 */
import { createDemo, util } from '/demo-kit/kit.js';

(() => {
  'use strict';

  const { esc, num, money, money0, trunc2, sleep, fmt3, fmt2, hhmm, uid, arr, stripTags, idle, focusOn, scrollTop } = util;

  const BRAND = { name: 'Vantage', tagline: 'See further.' };
  const TENANT = 'vantage';
  const API = {
    reset: '/vantage/api/reset', beat: '/vantage/api/beat', report: '/vantage/api/report',
    receipt: '/vantage/api/receipt', coldstart: '/vantage/api/coldstart',
  };
  // The engine's page and slot names; lane L1's anchor may rename them at boot (merged in place, so the kit sees them too).
  const PAGES = { home: 'home', phone: 'phone' };
  const SLOTS = { hero: 'hero', deals: 'deals', rail: 'phones-rail', modules: 'pdp-modules', plans: 'plan-pairing', offer: null };
  const DIM_LABEL = { category: 'category', brand: 'brand', ecosystem: 'ecosystem', os: 'ecosystem', priceBand: 'price band', intent: 'intent', perk: 'perk', lines: 'lines', contentType: 'content' };
  const INTENTS = [['new', 'New line'], ['add-line', 'Add a line'], ['upgrade', 'Upgrade'], ['byod', 'Bring your own']];
  const INTENT_WORD = Object.fromEntries(INTENTS);
  /** In a frame the sticky price bar sits where the page puts it: a full-page frame has no viewport to stick it to. */
  const FREEZE_EXTRA = '.stickybar{position:relative!important;bottom:auto!important}';
  /**
   * Left out of every clone: the chrome outside the site, and the site's views that are not on screen. None of it
   * shapes what is (the machine sits in a grid column its template fixes, or below the site on a narrow screen; the
   * rest is fixed or closed; a hidden view has no box, and no rule selects a view by its position among them), and
   * the clone of the whole document is the only thing a beat waits for when it takes its Before.
   */
  const CLONE_IGNORE = '.machine, .director, .pd-back, .sheet-back, .pd-pill, #demo-cursor, .back-chip, .fixture-flag, .skip, #site > .stage > .view[hidden]';
  /** The sentence under every comparison: what is the same on both sides, and the one thing that is not. */
  const FOOT = {
    moment: 'Same page, same catalog, same buy box and the same public prices. Only what each moment knew about the shopper is different.',
    // The streaming shopper on her own phone page; when he opens another phone, twoShoppersFoot names the two pages.
    streaming: 'Same page, same catalog, same buy box, same public prices. Only what each of them did is different.',
    phone: 'Same phone, same moment, same region, same buy box and the same public prices. The fresh visitor has sent nothing: the template order, with the region’s prior. Hers, on the left, is what her browsing earned.',
    home: 'Same homepage, same moment, same region, same catalog and the same public prices. The fresh visitor has sent nothing: the region’s prior alone. Hers, on the left, is what her visit earned.',
  };
  /** The machine's Roadmap tab: what is built and what is designed. */
  const ROADMAP = [
    ['built', 'eligibleWhen { regions, context }', 'The home bundle only where 5G Home is available, and offers that need an answer to “new line, add a line, upgrade or bring your own”. A condition the request does not carry fails closed.'],
    ['built', 'slot seeds', 'The campaign lifts the promotion its utm_term names, as context, never as evidence about her; the receipt itemises it.'],
    ['built', 'learn.regional', 'The carrier’s own regional sales blended by λ = K / (K + Σa), giving way as her evidence grows.'],
    ['built', 'one slot, many modules', 'The phone page’s modules are pieces of one slot; the order the engine returns is the order on the page.'],
    ['built', 'POST /sort', 'The phones rail; at an affinity weight of zero the engine returns the site’s own order exactly.'],
    ['designed', 'the sign-in hand-off', 'At sign-in the session’s signals travel to their own decisioning as context; nothing personal is used before it.'],
    ['designed', 'census as explanation only', 'Shown on the arrival panel, never scored: no neighbourhood figure reaches a price, a plan or financing.'],
  ];

  // ════════════════════════════════════════════════════════════════════════
  // THE KIT. Every hook below is Vantage's answer to a question the chassis
  // asks; the module headers in public/demo-kit/ name each one.
  // ════════════════════════════════════════════════════════════════════════
  const demo = createDemo({
    tenant: TENANT, api: API, pageNames: PAGES, slots: SLOTS, dimLabels: DIM_LABEL, source: 'vantage-demo', docBase: '/vantage/',
    debugName: '__vantage', intents: INTENTS, roadmap: ROADMAP,
    state: {
      phones: [], phoneById: new Map(), phonesDoc: null, details: {}, plans: null, plansFx: null,
      display: new Map(), engine: null, catalogName: null,
      anchor: {}, manifest: null, engineFx: null,
      view: 'home', phoneId: null, pageKey: null, pageFrom: null, phonesBrand: null,
      home: { previous: null, current: null, set: null, pos: 5, prevDecisions: null, curDecisions: null },
      phone: { previous: null, current: null, set: null },
      rail: { status: 'site', order: null, items: null, off: false },
      socket: null, exitArmedAt: 0, exitNote: null,
    },
    // The transport: her own fields on a new visitor, the answer always asserted, the opening documents, the fixtures.
    visitor: () => ({ lines: 1, plan: null, config: null, lastHomeLead: null, homeSet: null, phoneSet: null, cart: 0 }),
    defaultIntent: () => defaultIntent(),
    beatName: (key, kind) => beatName(key, kind),
    fixtures: { api: (path, payload, opts) => fixtureApi(path, payload, opts), receipts: (ids) => fixtureReceipts(ids) },
    // The director: the one dispatcher, the router, the facts the beats read, the pages and verbs they drive.
    control: (t) => handleControl(t),
    controls: { skip: '.terms' },
    restore: () => restoreFromUrl(),
    view: () => state.view,
    facts: () => facts(),
    pages: {
      home: { open: (o) => openHome(o), refresh: () => refreshHome(), place: (slots, label) => placeDeals(slots, label) },
      phone: { refresh: () => refreshPhone() },
    },
    verbs: { arrive: () => arrive(), readMetersBefore: () => readMetersBefore(), askAgainAfterTheMinute: () => askAgainAfterTheMinute() },
    publishing: async (kind, name) => { if (kind === 'catalog') await useCatalog(name); },
    published: async (kind) => { if (kind === 'reset') await useCatalog(beatName('open', 'catalog')); },
    beforeBeat: (b) => { if (!b.data.engineNote) { state.exitNote = null; const rd = $('railDeltas'); if (rd) rd.hidden = true; } },
    beatFailed: (m) => engineDown(state.view === 'phone' ? el.modulesDown : el.dealsDown, m),
    assertRegions: () => assertableRegions(),
    intentAsserted: async () => { if (state.view === 'phone') { renderBuyBox(); await refreshPhone(); } else if (state.view === 'home') await refreshHome(); },
    compareTools: [['fresh', 'Fresh visitor', () => freshVisitor()], ['streaming', 'Streaming shopper', () => streamingShopper()]],
    // Predict, then prove: what the last press decided, where a target stands, what is on screen.
    proofBefore: () => ({ home: state.home.current, phone: state.phone.current }),
    proof: (before) => proofOf(before),
    standing: (target) => standingLine(target),
    nowMap: () => nowMap(),
    // The panels: the set on screen, the regional driver, the registry's memory, names, fixtures, Why these, the report.
    currentSet: () => (state.view === 'phone' ? state.phone.set : state.home.set),
    regionalDriver: () => state.home.set && bySlot(state.home.set, SLOTS.deals).map((d) => ((d.explain && d.explain.drivers) || []).find((x) => x.dim === 'regional')).find(Boolean),
    memoryDims: () => (((state.anchor.registry || {}).memory || {}).dimensions || []),
    regionName: (key) => regionName(key),
    coldStartFixture: async (region) => (await tryJson(`/vantage/fixtures/coldstart-${region || 'none'}.json`)) || tryJson('/vantage/fixtures/coldstart-none.json'),
    coldStart: { seeded: 'brand, ecosystem, price band and category', salesOf: 'the carrier’s', fixture: { why: 'lane L2’s labelled fixture is shown', label: 'lane L2 fixture', tag: 'L2 fixture' } },
    why: () => whyGroups(),
    titleOf: (d) => titleOf(d),
    report: {
      slots: () => [SLOTS.deals, SLOTS.modules, SLOTS.plans, SLOTS.hero],
      labels: () => ({ [SLOTS.deals]: 'Attribution per promotion · the deals four', [SLOTS.modules]: 'Module engagement · the phone page', [SLOTS.plans]: 'Plan mix · clicks per plan in Pair with a plan', [SLOTS.hero]: 'The hero' }),
      row: (slot, id) => reportRow(slot, id),
      attach: { get slot() { return SLOTS.modules; }, rows: [['protection', 'Protection attach'], ['accessories', 'Accessory attach'], ['home-bundle', 'Bundle mix: home internet'], ['connected-devices', 'Connected-device lines']] },
      holdout: () => ((state.anchor.learn || {}).holdout || {}).share,
      theirs: 'Lines per order, the share of switchers, conversion, revenue per account and churn are read in your warehouse from orders, against a holdout assigned by account so one account’s lines never split. The rows above are what we hand you to run it on.',
    },
    // The before/now rows, keyed by slot; the sheets; Compare.
    rows: () => deltaRows(),
    sheetClosed: async (was) => { if (was && was.from === 'phone' && state.view === 'phone') await refreshPhone(); },
    compare: { root: '#site', freezeCss: FREEZE_EXTRA, ignore: CLONE_IGNORE, foot: FOOT.moment, where: () => whereNow(), snapshot: () => snapshotOfPage() },
  });
  const { state, flags, transport, panels, deltas, director, sheets } = demo;

  // The kit's functions under the names this file has always used, so its renderers read as they did.
  const QS = flags.qs;
  const FIXTURE = flags.fixtures;
  // ?region=US-NY is a REHEARSAL OVERRIDE, never the default (the director reads it): the suites pass it so their
  // figures stay reproducible, and the panel labels it. Without it the arrival asserts no region and the edge
  // locates the request (lane F2, 2026-10-01: the real location always leads).
  const OVERRIDE = { region: flags.region, metro: flags.metro, ignored: flags.regionIgnored };
  const LOCAL_RUNTIME = transport.localRuntime;
  const { api, cur, send, sendCustom, ask, bySlot, mintVisitor, useVisitor, ensureVisitor, landingEntry, directEntry, describeEntry,
    tryJson, firstJson, unwrap, creditDecided, prefetchReceipts, connectSocket } = transport;
  const { note, renderWho, renderVectors, loadColdStart, coldLabel, roomOf, thetaIn, thetaOut, setRegion, ownRegion, ownSource, ownName,
    regionShown, seedLabel, driverSummary, renderWhy, renderRoadmap } = panels;
  const { say, performClick, renderAsserts, renderPresses, renderNext } = director;
  const openSheet = (kind, html) => sheets.open(kind, html);
  const closeSheet = () => sheets.close();
  const kit = () => demo.compare.load();
  const takeBaseline = (reason, renderAfter) => demo.compare.takeBaseline(reason, renderAfter);
  const afterDecidedPaint = (viewKey) => demo.compare.afterDecidedPaint(viewKey);
  const { frameLabel, whoNow } = demo.compare;
  const compareCols = (a, b, keys) => demo.compare.columns(a, b, keys);
  const renderDealsChanges = () => deltas.render(SLOTS.deals);
  const renderBeforeRow = () => deltas.renderBeforeRow(SLOTS.deals);
  const renderPdpChanges = () => deltas.render(SLOTS.modules);
  /** Off the homepage the four have not been asked again, and the strip says so rather than keep a stale line. */
  const renderPending = (where) => deltas.pending(SLOTS.deals, where);
  /** The hinge, read off the receipts: the deals strip's line, or null. */
  const hingeLine = () => deltas.superseded(SLOTS.deals);

  const $ = (id) => document.getElementById(id);
  const el = {
    cursor: $('demo-cursor'), fixtureFlag: $('fixtureFlag'), site: $('site'),
    wordmark: $('wordmark'), tagline: $('tagline'), mainnav: $('mainnav'), cartCount: $('cartCount'),
    viewHome: $('viewHome'), viewPhones: $('viewPhones'), viewPhone: $('viewPhone'), viewPage: $('viewPage'),
    hero: $('hero'), heroModule: $('heroModule'),
    dealsModule: $('dealsModule'), dealsWhere: $('dealsWhere'), deals: $('deals'), dealsDown: $('dealsDown'),
    dealsGhosts: $('dealsGhosts'), dealsDeltas: $('dealsDeltas'), dealsBeforeRow: $('dealsBeforeRow'),
    dealsBeforeFour: $('dealsBeforeFour'), dealsNowLabel: $('dealsNowLabel'),
    rail: $('rail'), railChip: $('railChip'), railForYou: $('railForYou'), railSite: $('railSite'),
    pool: $('pool'), poolCount: $('poolCount'),
    phonesSub: $('phonesSub'), brandChips: $('brandChips'), phoneGrid: $('phoneGrid'),
    pdpCrumbs: $('pdpCrumbs'), pdpTitle: $('pdpTitle'), pdpRating: $('pdpRating'),
    bbImage: $('bbImage'), bbDots: $('bbDots'), bbFee: $('bbFee'), bbColorName: $('bbColorName'), bbColors: $('bbColors'),
    bbStorage: $('bbStorage'), bbMaths: $('bbMaths'), bbShip: $('bbShip'), bbPickup: $('bbPickup'),
    bbIntent: $('bbIntent'), bbIntentNote: $('bbIntentNote'), bbTerm: $('bbTerm'), bbPrice: $('bbPrice'),
    bbTrade: $('bbTrade'), bbLegal: $('bbLegal'),
    modules: $('modules'), modulesDown: $('modulesDown'), modulesWhere: $('modulesWhere'),
    pdpBefore: $('pdpBefore'), pdpDeltas: $('pdpDeltas'), pdpCompareTable: $('pdpCompareTable'), pdpSpecs: $('pdpSpecs'),
    sbWhat: $('sbWhat'), sbPrice: $('sbPrice'),
    pageCrumbs: $('pageCrumbs'), pageBody: $('pageBody'),
  };

  // ════════════════════════════════════════════════════════════════════════
  // CONTENT. Lane L1's files first; the page names what it fell back to.
  // ════════════════════════════════════════════════════════════════════════

  /** The engine's own catalog document for the current beat: windows and rules; the pool view reads these. */
  async function useCatalog(name) {
    const doc = unwrap(await firstJson('catalog', [`/vantage/beats/${name}.json`, '/vantage/fixtures/catalog.json']));
    if (doc && Array.isArray(doc.pieces)) { state.engine = fixtureWindows(doc); state.catalogName = name; }
    return state.engine;
  }
  function fixtureWindows(doc) {
    const now = Date.now();
    const pieces = doc.pieces.filter((p) => !p.fixtureStep || state.fixtureDone.has(p.fixtureStep)).map((p) => {
      if (!Array.isArray(p.fixtureWindow) || (p.window && p.window.from)) return p;
      const [a, b] = p.fixtureWindow;
      return { ...p, window: { from: new Date(now + a * 3600e3).toISOString(), to: new Date(now + b * 3600e3).toISOString() } };
    });
    return { ...doc, pieces };
  }
  const enginePieces = () => (state.engine && state.engine.pieces) || [];
  const cleanPath = (s) => (typeof s === 'string' && s.startsWith('/') ? s.split(/\s/)[0] : null);
  /** A placeholder is not art: the page paints its own labelled placeholder instead. */
  const realArt = (s) => (s && !/placeholder-/.test(s) ? s : null);
  /** One piece as the page paints it: the engine document's facts under lane L1's display content. */
  function pieceOf(id) {
    if (!id) return null;
    const e = enginePieces().find((p) => p.customerContentId === id || p.id === id) || null;
    const cid = e ? e.customerContentId : id;
    const d = state.display.get(cid) || [...state.display.values()].find((p) => p.id === id) || null;
    if (!e && !d) return null;
    return {
      ...(e || {}),
      id: (e || d).id, customerContentId: (e || d).customerContentId,
      type: (e && e.type) || (d && d.kind), title: (d && d.title) || (e && e.title) || cid,
      subtitle: d && d.subtitle != null ? d.subtitle : e && e.subtitle,
      tags: (e && e.tags) || (d && d.tags) || {},
      badge: d && d.badge, cta: d && d.cta, grammar: d && d.grammar,
      // The engine document's renderUrl is the creative live now (a beat can republish it); the display entry's is the fallback.
      image: realArt(cleanPath(e && e.renderUrl)) || realArt(cleanPath(d && d.image)),
      gate: (d && d.gate) || null, regions: (d && d.regions) || null,
      featuredProductIds: (d && d.featuredProductIds) || (e && e.featuredProductIds) || [], role: d && d.role,
      tier: d && d.tier, siteDefault: d && d.siteDefault, excerpt: (e && e.excerpt) || null,
    };
  }
  const pieceOfDecision = (d) => pieceOf(d.customerContentId) || pieceOf(d.contentId);
  const piecesFor = (slot) => {
    const ids = new Set(enginePieces().filter((p) => arr(p.slotTypes).includes(slot)).map((p) => p.customerContentId));
    for (const [cid, d] of state.display) if (d.slot === slot) ids.add(cid);
    return [...ids].map(pieceOf).filter(Boolean);
  };
  const beatName = (key, kind) => ((state.anchor.beats || {})[key] || {})[kind]
    || ({ open: { slots: 'open-slots', catalog: 'open-catalog' }, twoWeeks: { catalog: '11-two-weeks-pass' },
      blackFriday: { catalog: '12-black-friday' }, pinDuo: { slots: '13-pin-duo-preorder' } }[key] || {})[kind];
  const anchorId = (key) => (state.anchor.ids || {})[key] || null;

  // ── Phones: lane L1's phones.json is the catalog of record ────────────────
  const phone = (id) => state.phoneById.get(id) || null;
  const detail = (p) => (p && state.details[p.id]) || {};
  /** Swatches: lane L1 names the colours; their shades come from lane L2's fixture (colorHex), else a neutral. */
  const hexOf = (p, name) => ((detail(p).colors || []).find((c) => c && c.name === name) || {}).hex
    || (((state.detailsDoc || {}).colorHex) || {})[name] || '#8A8A8E';
  const colorsOf = (p) => {
    const list = (p.colors && p.colors.length ? p.colors : detail(p).colors) || [];
    const named = list.map((c) => (typeof c === 'string' ? { name: c, hex: hexOf(p, c) } : c));
    return named.length ? named : [{ name: 'Standard', hex: '#2B2B2E' }];
  };
  const defaultColorOf = (p) => { const c = colorsOf(p); return (c.find((x) => x.name === p.defaultColor) || c[0]).name; };
  const specsOf = (p) => p.specs || detail(p).specs || {};
  const ratingOf = (p) => ({ rating: p.rating != null ? p.rating : detail(p).rating, reviews: p.reviews != null ? p.reviews : detail(p).reviews });
  const ecoOf = (p) => p.ecosystem || p.os || '';
  const storageLabel = (s) => String(s || '').replace(/^(\d+)gb$/i, '$1 GB').replace(/^(\d+)tb$/i, '$1 TB');
  const optionsOf = (p) => (Array.isArray(p.storageOptions) && p.storageOptions.length ? p.storageOptions
    : [{ storage: p.storage, label: storageLabel(p.storage), price_usd: p.price_usd, monthly36: p.monthly36, deltaMonthly: 0 }]);
  const optionOf = (p, storage) => optionsOf(p).find((o) => o.storage === storage) || optionsOf(p)[0];
  const optLabel = (o) => o.label || storageLabel(o.storage);
  const monthlyOf = (o, months) => (months === 36 && o.monthly36 != null ? num(o.monthly36) : trunc2(num(o.price_usd) / months));
  const deltaOf = (p, o) => (o.deltaMonthly != null ? num(o.deltaMonthly) : trunc2(monthlyOf(o, 36) - monthlyOf(optionsOf(p)[0], 36)));
  const tradeMonthly = (p) => (p && p.tradeInUpTo ? trunc2(num(p.tradeInUpTo) / 36) : 0);
  const tradeUpgrade = (p) => (p && p.tradeInUpgradeUpTo ? num(p.tradeInUpgradeUpTo) : 0);
  /** The attributes an event carries, named as the registry reads them. The page never bands a price. */
  const phoneAttrs = (p, extra) => (p ? { productId: p.id, category: 'phones', brand: p.brand, os: ecoOf(p), ecosystem: ecoOf(p), price_usd: num(p.price_usd), ...(extra || {}) } : {});
  const brandName = (b) => ({ apple: 'Apple', samsung: 'Samsung', google: 'Google', motorola: 'Motorola' }[b] || b);

  // ── Plans: lane L1's plans.json, read in either of its two shapes ────────
  function normPlans(doc, fx) {
    const d = doc || {}, f = fx || {};
    const fxPerks = f.perks && !Array.isArray(f.perks) ? f.perks : {};
    const tiers = (d.tiers || d.plans || f.tiers || f.plans || []).map((t) => ({
      id: t.id, name: t.name, family: /simple/i.test(t.family || '') ? 'Simple' : 'Unlimited',
      perLine: t.perLine || {}, switcher: t.switcherPerLine != null ? t.switcherPerLine : t.switcher != null ? t.switcher : null,
      starter: t.starter ? { perk: t.starter.perk || null, intent: t.starter.intent || null, label: t.starter.label || '', line: t.starter.line || '' } : null,
      includes: t.includes || t.features || [], legal: t.legal || '',
    }));
    const perks = new Map();
    const src = d.perks || f.perks || [];
    if (Array.isArray(src)) src.forEach((p) => perks.set(p.id, { id: p.id, name: p.name, perLine: p.perLine, body: (fxPerks[p.id] || {}).body, fine: (fxPerks[p.id] || {}).fine }));
    else Object.entries(src).forEach(([id, p]) => perks.set(id, { id, name: p.title || p.name, perLine: p.price != null ? p.price : p.perLine, body: p.body, fine: p.fine }));
    const pr = d.protection || {};
    const acc = d.accessories || {};
    const cd = d.connectedDevices || {};
    const fc = f.connected || {};
    const hi = d.homeInternet || {};
    return {
      tiers, perks,
      autopay: (d.autopay && (d.autopay.note || d.autopay)) || f.autopay || '',
      protection: { from: (pr.perPhone && pr.perPhone.from) || 15, to: (pr.perPhone && pr.perPhone.to) || 18, multi: pr.multiLine || pr.multi || {}, note: pr.note || '' },
      accessories: { tiers: acc.buyMoreSaveMore || acc.tiers || { 2: 20, 3: 25, 4: 30 }, items: acc.items || (f.accessories && f.accessories.items) || [], note: acc.note || '' },
      connected: { watchLine: cd.watchLine != null ? cd.watchLine : (fc.watch || {}).line, tabletLine: cd.tabletLine != null ? cd.tabletLine : (fc.tablet || {}).line,
        watchOff: cd.watchOffUpTo != null ? cd.watchOffUpTo : (fc.watch || {}).offUpTo, tabletOff: cd.tabletOffUpTo != null ? cd.tabletOffUpTo : (fc.tablet || {}).offUpTo, note: cd.note || '' },
      home: { name: hi.name || 'Vantage 5G Home', withMobile: hi.withMobile != null ? hi.withMobile : (f.homeInternet || {}).withPlan, alone: hi.alone, note: hi.note || '' },
      bundle: d.bundle || (f.homeInternet || {}).bundle || null,
      loyalty: d.loyalty ? { name: d.loyalty.name, fee: d.loyalty.activationFeeWaived } : { name: (f.fees || {}).waivedWith || 'Vantage Rewards', fee: (f.fees || {}).activation || 40 },
      storageMaths: d.storageMaths || null,
    };
  }
  const tiers = () => (state.plans && state.plans.tiers) || [];
  const tierById = (id) => tiers().find((t) => t.id === id || `plan-${t.id}` === id) || null;
  const tierName = (id) => (tierById(id) || {}).name || id;
  const tierOfDecision = (d) => {
    const p = pieceOfDecision(d);
    return tierById((p && p.tier) || String(d.customerContentId || '').replace(/^plan[-_]/, ''));
  };
  const perkName = (id) => ((state.plans && state.plans.perks.get(id)) || {}).name || id;
  const perLineAt = (t, lines) => {
    const n = String(Math.max(1, Math.min(4, lines || 1)));
    return num(t.perLine[n] != null ? t.perLine[n] : t.perLine['1']);
  };

  // ── Images: lane L3's manifest names every file; anything else is a labelled placeholder ──
  function readManifest(doc) {
    const files = new Set();
    const walk = (v) => {
      if (typeof v === 'string') { if (/\.(png|jpe?g|webp|avif|svg)$/i.test(v)) files.add(v.replace(/^\/?vantage\/img\//, '')); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(doc);
    return { files, devices: new Map((doc.devices || []).map((d) => [d.id, d.files || {}])), promos: doc.promos || [], placeholders: doc.placeholders || {} };
  }
  const imgPath = (f) => `/vantage/img/${String(f).replace(/^\/?vantage\/img\//, '')}`;
  const manifestHas = (src) => Boolean(src && (!state.manifest || state.manifest.files.has(String(src).replace(/^\/?vantage\/img\//, ''))));
  /** A phone's files, transparent only: the .webp offered first, the .png as the fallback; the .jpg (white ground) never. */
  function deviceFiles(p) {
    if (!p) return null;
    const f = state.manifest && state.manifest.devices.get(p.id);
    if (f && (f.png || f.webp || f.transparent)) return { webp: f.webp ? imgPath(f.webp) : null, png: imgPath(f.png || f.transparent || f.webp) };
    const own = p.image && /\.png$/i.test(p.image) && manifestHas(p.image) ? p.image : null;
    return own ? { webp: manifestHas(own.replace(/\.png$/i, '.webp')) ? own.replace(/\.png$/i, '.webp') : null, png: own } : null;
  }
  /** A promotion's art: the file its display entry names, or the manifest entry made for it. Never a guess by likeness. */
  function promoSrc(piece) {
    if (!piece) return null;
    if (piece.image && manifestHas(piece.image)) return piece.image;
    if (!state.manifest) return null;
    const cid = piece.customerContentId;
    const hit = state.manifest.promos.find((x) => x.key === cid && !x.variantOf);
    return hit && hit.file ? imgPath(hit.file) : null;
  }
  const phBack = () => (state.manifest && state.manifest.placeholders.promo ? `<img class="ph-bg" src="${esc(imgPath(state.manifest.placeholders.promo))}" alt="">` : '');
  const phPromo = (title, badge) => `<div class="ph ph--red">${phBack()}<b>${esc(title)}</b><i>${esc(badge ? `${badge} · ` : '')}art pending</i></div>`;
  const phPhone = (p, hex) => `<div class="ph ph--light"><span class="phone-ph" style="--ph-hue:${esc(hex || '#2B2B2E')}"></span><i>${esc(p ? p.name : '')} · image pending</i></div>`;
  const imgTag = (src, alt, placeholder, cls) => (src ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" data-ph="${esc(placeholder)}">` : placeholder);
  const phoneImg = (p, hex) => {
    const f = deviceFiles(p);
    const ph = phPhone(p, hex);
    if (!f) return ph;
    return `<picture class="dev">${f.webp ? `<source type="image/webp" srcset="${esc(f.webp)}">` : ''}<img src="${esc(f.png)}" alt="${esc(p ? `${p.maker} ${p.name}` : '')}" loading="lazy" data-ph="${esc(ph)}"></picture>`;
  };
  // A broken image is replaced by its placeholder; a broken tag is never left on screen.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.dataset || t.dataset.ph === undefined) return;
    const holder = document.createElement('div');
    holder.innerHTML = t.dataset.ph || '';
    const node = t.parentElement && t.parentElement.tagName === 'PICTURE' ? t.parentElement : t;
    if (holder.firstElementChild) node.replaceWith(holder.firstElementChild); else node.remove();
  }, true);

  /** Her answer when she has given none: lane L1's anchor names it (a signed-out visitor is a new line). */
  const defaultIntent = () => ((state.anchor.ctx && state.anchor.ctx.intent && state.anchor.ctx.intent.default) || 'new');
  const linesWord = (n) => (n >= 3 ? 'family' : n === 2 ? 'duo' : 'solo');

  // ════════════════════════════════════════════════════════════════════════
  // VIEWS AND ROUTES
  // ════════════════════════════════════════════════════════════════════════
  function showView(view) {
    state.view = view;
    el.viewHome.hidden = view !== 'home';
    el.viewPhones.hidden = view !== 'phones';
    el.viewPhone.hidden = view !== 'phone';
    el.viewPage.hidden = view !== 'page';
    document.body.classList.toggle('on-phone', view === 'phone');
    requestAnimationFrame(() => syncSticky());
    Array.from(el.mainnav.querySelectorAll('button')).forEach((b) => b.setAttribute('aria-current', String(
      ((view === 'phones' || view === 'phone') && b.dataset.nav === 'phones') || (view === 'page' && b.dataset.nav === state.pageKey))));
  }
  function route(path) {
    try {
      const keep = new URLSearchParams(location.search);
      ['id', 'view', 'brand'].forEach((k) => keep.delete(k));
      const [p, q] = path.split('?');
      const next = new URLSearchParams(q || '');
      keep.forEach((v, k) => { if (!next.has(k)) next.set(k, v); });
      const url = `${p}${next.toString() ? `?${next}` : ''}`;
      // A Compare shopper's pages replace the entry rather than add one: her history stays hers (L5 finding 1).
      if (url !== location.pathname + location.search) history[state.quietRoute ? 'replaceState' : 'pushState']({ vantage: true }, '', url);
    } catch { /* a sandboxed document has no history */ }
  }

  /** Content pages: landing on one IS the event, with that page's own attributes. */
  const PAGE_EVENTS = {
    plans: { category: 'plans' },
    deals: { contentType: 'deal' },
    'home-internet': { category: 'home-internet', intent: 'home' },
    'mobile-home': { category: 'home-internet', intent: 'home' },
    switch: { intent: 'switch' },
    byod: { intent: 'byod' },
    'add-a-line': { intent: 'add-line' },
  };
  /** The kids' watch page: a page view carrying the watch line's attributes, as beat 9's document measured it. */
  const KIDS_WATCH = { page: 'kids-watch', category: 'watches-tablets', intent: 'add-line', lines: 'family' };

  async function openHome(opts = {}) {
    await ensureVisitor();
    const from = state.view === 'phone' && state.phoneId ? { view: 'phone', id: state.phoneId } : null;
    showView('home');
    state.backTarget = from;     // what the browser's Back returns to from here
    route('/vantage/');
    if (opts.event !== false) {
      await send('page_view', { page: 'home' });
      if (!opts.quiet) note('viewed', 'The homepage', 'the hero, the four and the rail are asked again');
    }
    await refreshHome();
    if (opts.focus === 'hero') focusOn(el.heroModule);
    else if (opts.focus) focusOn(el.dealsModule);
    else scrollTop();
  }
  async function refreshHome() {
    const v = cur();
    const r = await ask('home', v);
    if (!r.ok) { engineDown(el.dealsDown, r.error); say(r.error, 'bad'); await renderVectors(); return false; }
    engineUp(el.dealsDown);
    state.home.set = r.set;
    v.homeSet = r.set;
    const hero = bySlot(r.set, SLOTS.hero);
    const deals = bySlot(r.set, SLOTS.deals);
    renderHero(hero[0] || null);
    renderDeals(deals, false);
    if (deals[0]) v.lastHomeLead = { decision: deals[0], piece: pieceOfDecision(deals[0]), at: Date.now(), intent: v.intent, region: state.ctx.region };
    renderWho();
    // The beat's sentence about this answer: once with the answer (10d names its leader from the decision alone),
    // and again once the receipts are read (the hinge needs the campaign seed's record). Null keeps the line.
    const sayAfter = () => director.sayAfter();
    sayAfter();
    await Promise.all([sortRail(), renderVectors()]);
    renderPool();
    renderWhy();
    void prefetchReceipts([...hero, ...deals], r.set.asked).then(() => {
      renderDealsChanges(); renderWhy(); refreshReceiptLines(); renderPool();
      sayAfter();
    });
    afterDecidedPaint('home');
    return true;
  }
  function engineDown(node, message) {
    if (!node) return;
    node.hidden = false;
    node.textContent = `The page is keeping what it last showed: ${message}. Nothing here ranks in the browser, so there is nothing to show instead.`;
  }
  const engineUp = (node) => { if (node) node.hidden = true; };

  async function openPhones(brand, opts = {}) {
    await ensureVisitor();
    state.phonesBrand = brand || null;
    state.backTarget = null;
    renderPhonesGrid();
    showView('phones');
    route(`/vantage/?view=phones${brand ? `&brand=${brand}` : ''}`);
    scrollTop();
    if (brand) await sendCustom('filter', { control: 'brand', category: 'phones', brand });
    else await send('page_view', { page: 'phones' });   // the grid itself: the product views carry the category
    if (!opts.quiet) note(brand ? 'filtered' : 'viewed', brand ? `Phones · ${brandName(brand)}` : 'Phones', brand ? `brand ${brand}` : 'the grid, in the site’s own order');
    await renderVectors();
    renderPending('On the phones grid');
  }

  async function openPhone(id, opts = {}) {
    const p = phone(id);
    if (!p) throw new Error(`phones.json has no phone "${id}"`);
    const v = await ensureVisitor();
    if (!v.config || v.config.phoneId !== id) v.config = { phoneId: id, color: defaultColorOf(p), storage: optionsOf(p)[0].storage, term: 36 };
    if (state.phoneId !== id) { state.phone.previous = null; state.phone.current = null; }
    state.phoneId = id;
    state.backTarget = null;
    renderBuyBox();
    renderStaticPdp();
    showView('phone');
    route(`/vantage/phone?id=${encodeURIComponent(id)}`);
    if (opts.scroll !== false) scrollTop();
    const o = optionOf(p, v.config.storage);
    // The phone page's own view. `pdp_view` is not an accepted action type, so it
    // travels as product_view, which the registry weighs the same.
    if (opts.event === false) {
      // Back to a page she already opened, as the browser's back restores it: asked again, no new view.
      note('returned', `${p.maker} ${p.name}`, 'back to the phone page · asked again, no new view');
    } else {
      await send('product_view', phoneAttrs(p, { price_usd: num(o.price_usd), view: 'page' }));
      note('opened', `${p.maker} ${p.name}`, `${ecoOf(p)} · ${money(o.price_usd)} retail`);
    }
    await refreshPhone();
  }
  async function refreshPhone() {
    const v = cur();
    const r = await ask('phone', v);
    if (!r.ok) { engineDown(el.modulesDown, r.error); say(r.error, 'bad'); await renderVectors(); return false; }
    engineUp(el.modulesDown);
    state.phone.set = r.set;
    v.phoneSet = r.set;
    renderModules(r.set);
    renderWho();
    await renderVectors();
    renderWhy();
    void prefetchReceipts([...bySlot(r.set, SLOTS.modules), ...bySlot(r.set, SLOTS.plans)], r.set.asked).then(renderWhy);
    afterDecidedPaint(`phone:${state.phoneId}`);
    return true;
  }

  async function openPage(key, opts = {}) {
    await ensureVisitor();
    const from = state.view === 'phone' ? state.phoneId : state.view === 'page' ? state.pageFrom : null;
    state.pageKey = key;
    state.pageFrom = from;
    state.backTarget = null;
    renderPage(key);
    showView('page');
    route(`/vantage/?view=${key}`);
    scrollTop();
    if (key === 'kids-watch') {
      await send('page_view', KIDS_WATCH);
      if (!opts.quiet) note('viewed', 'Kids’ smartwatch', 'category watches-tablets · intent add-line · lines family');
    } else {
      await send('page_view', { page: key, ...(PAGE_EVENTS[key] || {}) });
      if (!opts.quiet) note('viewed', pageTitle(key), Object.entries(PAGE_EVENTS[key] || {}).map(([k, x]) => `${k} ${arr(x).join('+')}`).join(' · ') || 'a content page');
    }
    await renderVectors();
    renderPending(`On ${pageTitle(key)}`);
  }


  // ════════════════════════════════════════════════════════════════════════
  // THE HERO. Slot hero, take 1. Whichever hero piece the decision returns.
  // ════════════════════════════════════════════════════════════════════════
  function renderHero(d) {
    const cid = d ? d.customerContentId : ((state.anchor.slotDefaults || {}).hero || 'hero-launch');
    const piece = pieceOf(cid);
    const prevKey = el.hero.dataset.key;
    el.hero.dataset.key = cid;
    const decided = d ? ` data-op-slot="${esc(d.slot)}" data-op-content="${esc(d.contentId)}" data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}"` : '';
    const featured = piece && piece.featuredProductIds.map(phone).find(Boolean);
    const isContinue = /continue/.test(cid);
    const copy = isContinue ? continueHeroHtml(piece)
      : `<p class="hero-k">${esc(piece && arr(piece.tags && piece.tags.category)[0] === 'phones' ? 'New' : BRAND.name)}</p>
        <h1 class="hero-h">${esc(piece ? piece.title : 'See further.')}</h1>
        <p class="hero-sub">${esc((piece && piece.subtitle) || '')}</p>
        <div class="hero-ctas">
          <button type="button" class="btn btn--white" data-act="hero-cta" data-ctl="hero-shop"${featured ? ` data-open="${esc(featured.id)}"` : ''}>${esc((piece && piece.cta) || (featured ? `Shop ${featured.name}` : 'Get started'))}</button>
          <button type="button" class="btn btn--ghost" data-act="hero-cta" data-ctl="hero-details">See details</button>
        </div>`;
    const cfgPhone = isContinue && cur() && cur().config ? phone(cur().config.phoneId) : null;
    const artPhone = cfgPhone || featured;
    const heroSrc = piece && piece.image && manifestHas(piece.image) && state.manifest ? piece.image : null;
    const art = heroSrc ? imgTag(heroSrc, piece.title, '', 'hero-img')
      : artPhone ? `<div class="hero-device">${phoneImg(artPhone, colorsOf(artPhone)[0].hex)}</div>`
        : `<div class="hero-type"><span>${esc(BRAND.name)}</span></div>`;
    el.hero.className = `hero-card${prevKey && prevKey !== cid ? ' hero-card--entered' : ''}${isContinue ? ' hero-card--continue' : ''}`;
    el.hero.innerHTML = `<div class="hero-copy"${decided}>${copy}</div><div class="hero-art">${art}</div>
      <span class="hero-slotlabel">slot ${esc(SLOTS.hero)}</span><span class="hero-receipt">${esc(d ? heroReceipt(d) : 'the site’s own hero · no visitor yet, nothing decided')}</span>`;
  }
  function heroReceipt(d) {
    const parts = [d.strategy === 'tenant-pinned' ? 'pinned' : d.strategy === 'default' ? 'the catalog’s order' : `decided · score ${fmt3(d.score)}`];
    const rec = d.decisionId && state.receipts.get(d.decisionId);
    const c = rec && rec.explain && rec.explain.contextual;
    if (c && num(c.applied) > 0) parts.push(seedLabel(c));
    if (rec && rec.explain && rec.explain.stage && rec.explain.stage.sentence) parts.push(rec.explain.stage.sentence);
    const reg0 = ((d.explain && d.explain.drivers) || []).find((x) => x.dim === 'regional');
    if (reg0) parts.push(`region ${reg0.value}`);
    return parts.join(' · ');
  }
  /** The continue hero: her own selections, priced, and one next step. Nothing inferred. */
  function continueHeroHtml(piece) {
    const v = cur();
    const cfg = v && v.config;
    const p = cfg && phone(cfg.phoneId);
    const title = (piece && piece.title) || 'Pick up where you left off.';
    if (!p) return `<span class="hero-label">your selections, nothing inferred</span><h1 class="hero-h">${esc(title)}</h1><p class="hero-sub">Choose a phone and the page keeps your configuration here.</p>`;
    const o = optionOf(p, cfg.storage);
    const device = monthlyOf(o, cfg.term);
    const t = v.plan && tierById(v.plan);
    const perLine = t ? perLineAt(t, v.lines) : null;
    const planMonthly = t ? trunc2(perLine * v.lines) : null;
    const total = t ? trunc2(device + planMonthly) : null;
    return `<span class="hero-label">your selections, nothing inferred</span>
      <h1 class="hero-h hero-h--sm">${esc(title)}</h1>
      <div class="hero-config">
        <div class="hc-row"><span>${esc(p.maker)} ${esc(p.name)} · ${esc(optLabel(o))} · ${esc(cfg.color)}</span><b>${money(device)}/mo</b></div>
        <div class="hc-row hc-sub"><span>${cfg.term} months at 0% APR · retail ${money(o.price_usd)}</span></div>
        <div class="hc-row"><span>${v.lines} line${v.lines === 1 ? '' : 's'} · ${t ? esc(t.name) : 'plan not chosen yet'}</span><b>${t ? `${money(planMonthly)}/mo` : '—'}</b></div>
        ${t ? `<div class="hc-row hc-total"><span>Monthly total, with AutoPay</span><b>${money(total)}</b></div>` : ''}
      </div>
      <div class="hero-ctas"><button type="button" class="btn btn--white" data-act="hero-cta" data-ctl="hero-continue" data-open="${esc(p.id)}">${t ? 'Continue to checkout' : 'Choose your plan'}</button></div>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE DEALS MODULE. Slot deals, take 4: the Top Offers chassis.
  // ════════════════════════════════════════════════════════════════════════
  const BADGE = { 'trade-in': 'Trade-in', 'new-line': 'New line', switch: 'Switch', flash: 'Flash', bundle: 'Bundle', upgrade: 'Upgrade', 'pre-order': 'Pre-order', loyalty: 'Rewards' };
  const badgeOf = (piece) => {
    if (!piece) return '';
    const raw = piece.badge || arr(piece.tags && piece.tags.offerType).slice(-1)[0] || '';
    return BADGE[raw] || String(raw).replace(/-/g, ' ');
  };
  const isBundle = (piece) => Boolean(piece && (arr(piece.tags && piece.tags.category).includes('home-internet') || (piece.eligibleWhen && piece.eligibleWhen.regions)));
  const regionLabel = () => coldLabel() || state.ctx.region || 'your area';
  const dealView = (d) => {
    const p = pieceOfDecision(d);
    return { id: d.customerContentId, title: p ? p.title : d.customerContentId, art: promoSrc(p), badge: badgeOf(p) };
  };
  function termsHtml(g) {
    if (!g) return '';
    const rows = [['Who', g.who], ['Plan', g.plan], ['Needs', g.consideration], ['Value', g.value], ['Ends', g.ends], ['Combinable', g.combinable === false ? 'No, not with other offers' : g.combinable ? 'Yes' : null]]
      .filter(([, x]) => x);
    return `<details class="terms"><summary>What it requires, what ends it</summary><dl>${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></details>`;
  }
  function dealCardHtml(d, i, opts) {
    const p = pieceOfDecision(d);
    const title = p ? p.title : d.customerContentId;
    const badge = badgeOf(p);
    const mv = opts.moves && opts.moves[d.customerContentId];
    const bundle = isBundle(p);
    const decided = d.strategy !== 'site'
      ? ` data-op-slot="${esc(d.slot || SLOTS.deals)}" data-op-content="${esc(d.contentId)}" data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}"` : '';
    const g = p && p.grammar;
    return `<article class="deal${opts.entered && opts.entered(i, d) ? ' deal--entered' : ''}"${decided}>
      ${mv ? `<span class="delta-chip delta-chip--${mv.cls}">${esc(mv.text)}</span>` : ''}
      <div class="frame">${imgTag(promoSrc(p), '', phPromo(title, badge))}<span class="badge${/flash/i.test(badge) ? ' badge--flash' : ''}">${esc(badge)}</span></div>
      <div class="dbody">
        <h3 class="dtitle">${esc(title)}</h3>
        <p class="dsub">${esc((p && p.subtitle) || '')}</p>
        ${g && g.value ? `<p class="dfine">${esc(g.value)}${g.plan ? `. ${esc(g.plan)}` : ''}.</p>` : (p && p.excerpt ? `<p class="dfine">${esc(p.excerpt)}</p>` : '<p class="dfine"></p>')}
        ${opts.before ? '' : `<div class="dcta">
          <button type="button" class="btn btn--dark btn--sm" data-act="deal-cta" data-ctl="deal-${i + 1}"${bundle ? ' data-address="1"' : ''}>${esc(bundle ? 'Check your address' : (p && p.cta) || 'Shop the deal')}</button>
          ${bundle && d.strategy !== 'site' ? `<span class="covered-chip" title="Eligible by region only; no address was used">${esc(regionLabel())} is served · no address used</span>` : ''}
        </div>
        ${termsHtml(g)}
        <p class="receipt" data-receipt="${esc(d.decisionId || '')}">${dealReceipt(d, i)}</p>`}
      </div></article>`;
  }
  function dealReceipt(d, i) {
    if (d.strategy === 'site') return 'the site’s own default · no visitor yet, nothing decided';
    if (d.strategy === 'tenant-pinned') return `<span class="rc-pin">pinned · container ${i + 1} for everyone · ranking skipped</span>`;
    const head = d.strategy === 'default' ? `container ${i + 1} · the catalog’s order, nothing known yet` : `rank <b>${i + 1}</b> · score <b>${fmt3(d.score)}</b>`;
    const drv = driverSummary(d, 3);
    const rec = d.decisionId && state.receipts.get(d.decisionId);
    const c = rec && rec.explain && rec.explain.contextual;
    return `${head}${drv ? `<br>${drv}` : ''}${c && num(c.applied) > 0 ? ` · ${seedLabel(c, true)}` : ''}`;
  }
  function refreshReceiptLines() {
    const deals = bySlot(state.home.set, SLOTS.deals);
    el.deals.querySelectorAll('.receipt[data-receipt]').forEach((node) => {
      const d = deals.find((x) => x.decisionId === node.getAttribute('data-receipt'));
      if (d) node.innerHTML = dealReceipt(d, deals.indexOf(d));
    });
    const hr = el.hero.querySelector('.hero-receipt');
    const hd = bySlot(state.home.set, SLOTS.hero)[0];
    if (hr && hd) hr.textContent = heroReceipt(hd);
  }
  /** The site's own four, before anyone arrives: static content, the same for everyone, labelled so. */
  function siteDefaultDeals() {
    const ids = (state.anchor.slotDefaults && state.anchor.slotDefaults.deals) || state.anchor.defaults
      || piecesFor(SLOTS.deals).filter((p) => p.siteDefault).map((p) => p.customerContentId);
    return arr(ids).slice(0, 4).map((id, i) => {
      const p = pieceOf(id);
      return { customerContentId: id, contentId: p ? p.id : id, slot: SLOTS.deals, order: i, score: 0, strategy: 'site', explain: { drivers: [] } };
    });
  }
  /** opts.rotate false repaints what state already holds (her page back after Compare): no new before, no entrance. */
  function renderDeals(decisions, site, opts = {}) {
    const rotate = !site && opts.rotate !== false;
    const previousOrder = (state.home.current || []).map((c) => c.id);
    const after = decisions.map(dealView);
    if (rotate) deltas.rotate(SLOTS.deals, after, decisions);
    // The chip on each card that moved: the kit's, keyed by this slot (pinned and new creative included).
    const moves = site ? {} : deltas.moves(SLOTS.deals, state.home.previous, after, decisions);
    el.deals.setAttribute('aria-busy', 'false');
    el.deals.dataset.take = String(decisions.length || 4);
    el.deals.innerHTML = decisions.map((d, i) => dealCardHtml(d, i, { moves, entered: (j, x) => rotate && previousOrder[j] !== x.customerContentId })).join('')
      || '<p class="fine">The slot returned nothing, and the page shows nothing rather than invent a module.</p>';
    if (!site) renderDealsChanges();
    renderBeforeRow();
  }
  /** Where the deals module sits on today's homepage template. Its decision does not know or care. */
  /**
   * Where the deals module sits on the homepage template: their CMS's call, never
   * the engine's. The template names slots; the decision behind the module is
   * asked by name and does not know or care where it is painted.
   */
  function placeDeals(template, which, quiet) {
    const t = arr(template).length ? arr(template) : [SLOTS.hero, SLOTS.deals, SLOTS.rail];
    const position = t.indexOf(SLOTS.deals) + 1 || 2;
    state.home.pos = position;
    state.home.template = t;
    el.dealsModule.style.order = String(position === 1 ? 2 : 5);
    el.dealsWhere.innerHTML = `Position <b>${position}</b> on ${esc(which || 'today’s')} homepage template (${t.map((x) => esc(x)).join(', ')}) &middot; slot <b>${esc(SLOTS.deals)}</b> &middot; decided per visitor`;
    if (quiet) return;
    el.dealsModule.classList.remove('module--moved'); void el.dealsModule.offsetWidth; el.dealsModule.classList.add('module--moved');
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE RAIL. POST /sort over the site's own grid; at affinity 0 it is that grid.
  // ════════════════════════════════════════════════════════════════════════
  const railDoc = () => (state.phonesDoc && state.phonesDoc.rail) || {};
  const railTake = () => railDoc().take || 6;
  function railWeights() {
    const w = railDoc().weights || { affinity: 1 };
    return state.rail.off ? { ...w, affinity: 0 } : w;
  }
  /** POST /sort for one visitor: the rail as the engine answers it for her, on top of `base` (default: the rail on screen). */
  async function askRail(v, base) {
    const candidates = state.phones.map((p) => ({ id: p.id, brand: p.brand, ecosystem: ecoOf(p), os: ecoOf(p), price_usd: num(p.price_usd) }));
    const r = await api('/sort', { userId: v.session.subject, sessionId: v.session.sessionId, candidates, weights: railWeights() }, { visitor: v });
    const from = base || state.rail;
    const prevOrder = from.order;
    if (!r.ok || !r.body || !Array.isArray(r.body.order)) {
      return { ...from, status: r.status === 503 ? 'no-capture' : 'down', order: null, items: null, prevOrder, error: (r.body && r.body.error) || String(r.status) };
    }
    return { ...from, status: 'sorted', order: r.body.order, items: r.body.items || [], prevOrder, affinityWeight: r.body.affinityWeight };
  }
  async function sortRail() {
    const v = cur();
    if (!v) { state.rail = { ...state.rail, status: 'site', order: null, items: null }; renderRail(); return; }
    state.rail = await askRail(v);
    renderRail();
  }
  function renderRail() {
    const take = railTake();
    const byId = new Map((state.rail.items || []).map((x) => [x.id, x]));
    const order = state.rail.order || state.phones.map((p) => p.id);
    const prev = state.rail.prevOrder || null;
    el.railChip.textContent = state.rail.status === 'sorted'
      ? (state.rail.off ? 'affinity 0 · the site’s order, returned by the engine' : 'decided · re-ranked by POST /sort')
      : state.rail.status === 'no-capture' ? 'the site’s own order · /sort answers once she has a captured event'
        : state.rail.status === 'down' ? `the site’s own order · /sort did not answer (${state.rail.error})` : 'the site’s own order · no visitor yet';
    el.railChip.classList.toggle('rail-chip--live', state.rail.status === 'sorted' && !state.rail.off);
    el.railForYou.setAttribute('aria-pressed', String(!state.rail.off));
    el.railSite.setAttribute('aria-pressed', String(state.rail.off));
    el.rail.innerHTML = order.slice(0, take).map((id, i) => {
      const p = phone(id);
      if (!p) return '';
      const it = byId.get(id);
      const was = prev ? prev.indexOf(id) : -1;
      const moved = prev ? (was === -1 || was >= take ? 'new' : was > i ? `↑${was - i}` : was < i ? `↓${i - was}` : '') : '';
      const top = it && (it.drivers || []).slice().sort((a, b) => num(b.contribution) - num(a.contribution))[0];
      const rank = state.rail.status === 'sorted'
        ? `rank <b>${i + 1}</b> · site ${Number.isFinite(num(it && it.feedRank)) ? num(it.feedRank) + 1 : '—'}${it && num(it.score) > 0 ? ` · ${fmt3(it.score)}` : ''}${top ? ` · ${esc(DIM_LABEL[top.dim] || top.dim)} ${esc(top.value)}` : ''}`
        : `site position <b>${i + 1}</b>`;
      return phoneCardHtml(p, { ctl: `rail-${p.id}`, rank, moved, entered: prev && was !== i });
    }).join('');
  }
  function phoneCardHtml(p, o) {
    const c = colorsOf(p);
    const r = ratingOf(p);
    return `<button type="button" class="pcard${o.entered ? ' pcard--entered' : ''}" data-open="${esc(p.id)}" data-ctl="${esc(o.ctl)}"
        data-op-track="product_view" data-op-product="${esc(p.id)}">
      ${o.moved ? `<span class="delta-chip delta-chip--${/^↓/.test(o.moved) ? 'down' : 'up'}">${esc(o.moved)}</span>` : ''}
      <span class="pshot">${phoneImg(p, c[0].hex)}</span>
      <span class="pbody">
        <span class="pmaker">${esc(p.maker)}</span>
        <span class="pname">${esc(p.name)}</span>
        ${r.rating ? `<span class="pstars"><b>★ ${esc(r.rating)}</b> (${esc(Number(r.reviews || 0).toLocaleString('en-US'))})</span>` : ''}
        <span class="pmonthly">${money(p.monthly36)}<small>/mo for 36 mo</small></span>
        <span class="pretail">Retail ${money(p.price_usd)} · 0% APR</span>
        <span class="pdots">${c.slice(0, 5).map((x) => `<i style="background:${esc(x.hex)}" title="${esc(x.name)}"></i>`).join('')}</span>
        ${o.rank ? `<span class="prank">${o.rank}</span>` : ''}
      </span></button>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE POOL: every promotion, where it is in its window, and which container.
  // ════════════════════════════════════════════════════════════════════════
  /** Which pieces this request admitted, read off a current deals receipt's own candidate list; null until one is written. */
  function dealCandidates() {
    const served = bySlot(state.home.set, SLOTS.deals).filter((d) => d.strategy !== 'tenant-pinned');
    const rec = served.map((d) => d.decisionId && state.receipts.get(d.decisionId)).find((x) => x && Array.isArray(x.candidates) && x.candidates.length);
    return rec ? new Set(rec.candidates.map((c) => c.contentId)) : null;
  }
  function renderPool() {
    const promos = enginePieces().filter((p) => arr(p.slotTypes).includes(SLOTS.deals)).map((p) => pieceOf(p.customerContentId)).filter(Boolean);
    const now = Date.now();
    const served = bySlot(state.home.set, SLOTS.deals);
    const at = (id) => served.findIndex((d) => d.customerContentId === id);
    const cands = dealCandidates();
    el.poolCount.textContent = String(promos.filter((p) => !p.window || !p.window.to || Date.parse(p.window.to) > now).length);
    el.pool.innerHTML = promos.map((p) => {
      const from = p.window && p.window.from ? Date.parse(p.window.from) : -Infinity;
      const to = p.window && p.window.to ? Date.parse(p.window.to) : Infinity;
      const pos = at(p.customerContentId);
      const d = pos > -1 ? served[pos] : null;
      let cls = 'pchip', st = 'live', slot = '';
      if (to <= now) { cls += ' pchip--expired'; st = 'window closed'; }
      else if (from > now) { cls += ' pchip--soon'; st = `live from ${new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; }
      else if (d && d.strategy === 'tenant-pinned') { cls += ' pchip--pinned'; st = `pinned · container ${pos + 1}`; slot = `<span class="slotno slotno--pin">${pos + 1}</span>`; }
      else if (pos > -1) { cls += p.eligibleWhen ? ' pchip--gated' : ' pchip--served'; st = `${p.eligibleWhen ? 'rule met · ' : 'in the four · '}container ${pos + 1}`; slot = `<span class="slotno">${pos + 1}</span>`; }
      else if (cands && cands.has(p.id)) { st = now - from < 15 * 60 * 1000 ? 'new · a candidate, outranked' : 'a candidate · outranked'; }
      else if (cands) { cls += p.eligibleWhen ? ' pchip--held' : ''; st = p.eligibleWhen ? 'not a candidate here · it has a rule' : 'not a candidate here'; }
      else if (p.eligibleWhen) { cls += ' pchip--gated'; st = 'has a rule · not in the four'; }
      else if (now - from < 15 * 60 * 1000) { cls += ' pchip--new'; st = 'new · no history'; }
      const left = Number.isFinite(to) && to > now && from <= now ? ` · ${Math.max(1, Math.round((to - now) / 86400e3))} d left` : '';
      const badge = badgeOf(p);
      return `<div class="${cls}"><div class="frame">${imgTag(promoSrc(p), '', phPromo(p.title, badge))}
        <span class="badge${/flash/i.test(badge) ? ' badge--flash' : ''}">${esc(badge)}</span>${slot}</div>
        <div class="cbody"><div class="cn">${esc(p.title)}</div><div class="state">${esc(st)}${esc(left)}</div></div></div>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE PHONES GRID: the site's own order. Never re-ranked by this page.
  // ════════════════════════════════════════════════════════════════════════
  function renderPhonesGrid() {
    const brands = [...new Set(state.phones.map((p) => p.brand))];
    el.brandChips.innerHTML = [`<button type="button" data-act="brand" data-brand="" data-ctl="brand-all" aria-pressed="${!state.phonesBrand}">All</button>`]
      .concat(brands.map((b) => `<button type="button" data-act="brand" data-brand="${esc(b)}" data-ctl="brand-${esc(b)}" aria-pressed="${state.phonesBrand === b}">${esc(brandName(b))}</button>`)).join('');
    const list = state.phones.filter((p) => !state.phonesBrand || p.brand === state.phonesBrand);
    el.phonesSub.textContent = `${list.length} phones, in the site’s own order. Prices are the catalog’s and the same for everyone.`;
    el.phoneGrid.innerHTML = list.map((p) => {
      const c = colorsOf(p), r = ratingOf(p);
      return `<article class="gcard">
        <button type="button" class="pshot" data-open="${esc(p.id)}" data-ctl="grid-${esc(p.id)}" aria-label="${esc(p.name)}">${phoneImg(p, c[0].hex)}</button>
        <div class="pbody">
          <span class="pmaker">${esc(p.maker)}</span><span class="pname">${esc(p.name)}</span>
          ${r.rating ? `<span class="pstars"><b>★ ${esc(r.rating)}</b> (${esc(Number(r.reviews || 0).toLocaleString('en-US'))})</span>` : ''}
          <span class="pmonthly">${money(p.monthly36)}<small>/mo for 36 mo</small></span>
          <span class="pretail">Retail ${money(p.price_usd)} · 0% APR</span>
          <span class="pdots">${c.slice(0, 5).map((x) => `<i style="background:${esc(x.hex)}" title="${esc(x.name)}"></i>`).join('')}</span>
        </div>
        <div class="gactions">
          <button type="button" class="btn btn--line" data-quick="${esc(p.id)}" data-ctl="quick-${esc(p.id)}" data-op-track="product_view" data-op-product="${esc(p.id)}">Quick look</button>
          <button type="button" class="btn btn--dark" data-open="${esc(p.id)}" data-ctl="open-${esc(p.id)}">See details</button>
        </div></article>`;
    }).join('');
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE PHONE PAGE: the buy box (off limits) and the decided modules below it.
  // ════════════════════════════════════════════════════════════════════════
  function renderBuyBox() {
    const v = cur(), p = phone(state.phoneId);
    if (!p || !v) return;
    const cfg = v.config;
    const colors = colorsOf(p);
    const color = colors.find((c) => c.name === cfg.color) || colors[0];
    const o = optionOf(p, cfg.storage), base = optionsOf(p)[0];
    const r = ratingOf(p);
    el.pdpCrumbs.innerHTML = `<a data-nav="home" data-ctl="home-crumb">Home</a><span>/</span><a data-nav="phones" data-ctl="phones-crumb">Phones</a><span>/</span><span>${esc(p.maker)}</span><span>/</span><span>${esc(p.name)}</span>`;
    el.pdpTitle.textContent = `${p.maker} ${p.name}`;
    el.pdpRating.innerHTML = r.rating ? `<span class="stars">${'★'.repeat(Math.round(r.rating))}${'☆'.repeat(5 - Math.round(r.rating))}</span> <b>${esc(r.rating)}</b> (${esc(Number(r.reviews || 0).toLocaleString('en-US'))} reviews)` : '';
    el.bbImage.innerHTML = phoneImg(p, color.hex);
    el.bbDots.innerHTML = '<i></i><i></i><i></i>';
    const loyalty = (state.plans && state.plans.loyalty) || { name: 'Vantage Rewards', fee: 40 };
    el.bbFee.innerHTML = `Save <b>${money0(loyalty.fee)}</b>: no activation or upgrade fee when you join ${esc(loyalty.name)}.`;
    el.bbColorName.textContent = color.name;
    el.bbColors.innerHTML = colors.map((c) => `<button type="button" data-act="color" data-color="${esc(c.name)}" data-ctl="color-${esc(c.name.toLowerCase().replace(/\W+/g, '-'))}"
      aria-pressed="${c.name === color.name}" title="${esc(c.name)}" style="background:${esc(c.hex)}"></button>`).join('');
    el.bbStorage.innerHTML = optionsOf(p).map((x) => {
      const delta = deltaOf(p, x);
      return `<button type="button" data-act="storage" data-storage="${esc(x.storage)}" data-ctl="storage-${esc(x.storage)}"
        data-op-track="custom" data-op-label="select" aria-pressed="${x.storage === o.storage}">${esc(optLabel(x))}
        <small>${delta > 0 ? `+${money(delta)}/mo` : 'base'}</small></button>`;
    }).join('');
    // The storage maths, honest: the monthly rises by the real delta while the trade-in credit stays capped.
    const delta = deltaOf(p, o), credit = tradeMonthly(p);
    el.bbMaths.innerHTML = o.storage === base.storage ? '' : credit
      ? `<b>${esc(optLabel(o))}</b> adds <b>+${money(delta)}/mo</b> over 36 months (${money(o.price_usd)} retail). The trade-in credit stays capped at <b>${money(credit)}/mo</b>, built on the ${esc(optLabel(base))} price, so the net monthly change is <b>+${money(delta)}</b>.`
      : `<b>${esc(optLabel(o))}</b> adds <b>+${money(delta)}/mo</b> over 36 months (${money(o.price_usd)} retail).`;
    el.bbShip.textContent = `Ships ${shipWindow()}.`;
    const place = coldLabel();
    el.bbPickup.hidden = !place;
    el.bbPickup.textContent = place ? `Pickup at a store in ${place} in about an hour` : '';
    el.bbPickup.title = 'From the request’s region, as information. Never a decision.';
    el.bbIntent.innerHTML = INTENTS.map(([k, label]) => `<button type="button" data-act="intent" data-intent="${k}" data-ctl="intent-${k}"
      data-op-track="custom" data-op-label="select" aria-pressed="${v.intent === k}">${label}</button>`).join('');
    el.bbIntentNote.textContent = v.intent
      ? `Asserted on every decision as ctx.intent = ${v.intent}${v.intentByHand ? '' : ' (a signed-out visitor is a new line until she says otherwise)'}. It decides which offers she can see, failing closed, and never a price.`
      : 'Nothing asserted: offers that need an answer here stay out of the page until she gives one.';
    el.bbTerm.innerHTML = [12, 24, 36, 48].map((m) => `<button type="button" data-act="term" data-term="${m}" data-ctl="term-${m}"
      data-op-track="custom" data-op-label="select" aria-pressed="${cfg.term === m}">${m} mo<small>${money(monthlyOf(o, m))}/mo</small></button>`).join('');
    const mo = monthlyOf(o, cfg.term);
    el.bbPrice.innerHTML = `<span class="mo">${money(mo)}<small>/mo for ${cfg.term} months, 0% APR</small></span><span class="rt">Retail price <b>${money(o.price_usd)}</b></span>`;
    const up = tradeUpgrade(p);
    el.bbTrade.innerHTML = p.tradeInUpTo || up
      ? `<b>Trade in a phone:</b> ${[p.tradeInUpTo && `up to <b>${money0(p.tradeInUpTo)}</b> on a new line (${money(credit)}/mo)`, up && `up to <b>${money0(up)}</b> on an upgrade (${money(trunc2(up / 36))}/mo)`].filter(Boolean).join(', ')}, as bill credits over 36 months on the plans that carry the offer.`
      : '<b>Trade in:</b> no trade-in credit on this phone today.';
    el.bbLegal.textContent = `0% APR over ${cfg.term} months, beside the retail price. Taxes and fees extra. Every figure in this box is the catalog’s, identical for every visitor; nothing in it is decided or personalised.`;
    el.sbWhat.textContent = `${p.name} · ${optLabel(o)} · ${color.name}`;
    el.sbPrice.innerHTML = `<b>${money(mo)}</b>/mo for ${cfg.term} mo · retail ${money(o.price_usd)}`;
  }
  function shipWindow() {
    const d = (n) => new Date(Date.now() + n * 86400e3).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `${d(1)} – ${d(9)}`;
  }
  function renderStaticPdp() {
    const p = phone(state.phoneId);
    if (!p) return;
    const peers = [p, ...state.phones.filter((x) => x.id !== p.id && x.brand !== p.brand && num(x.price_usd) >= 800).slice(0, 3)];
    const rows = [['Starts at', (x) => `${money(x.monthly36)}/mo`], ['Retail', (x) => money(x.price_usd)], ['Storage', (x) => optionsOf(x).map(optLabel).join(', ')],
      ['Camera', (x) => specsOf(x).camera || '—'], ['Display', (x) => specsOf(x).display || '—'], ['Battery', (x) => specsOf(x).battery || '—']];
    el.pdpCompareTable.style.gridTemplateColumns = `150px repeat(${peers.length}, minmax(0, 1fr))`;
    el.pdpCompareTable.innerHTML = `<div class="ch rh"></div>${peers.map((x, i) => `<div class="ch${i === 0 ? ' cur' : ''}">${esc(x.name)}${i === 0 ? ' · viewing' : ''}</div>`).join('')}`
      + rows.map(([label, f]) => `<div class="rh">${esc(label)}</div>${peers.map((x, i) => `<div${i === 0 ? ' class="cur"' : ''}>${esc(f(x))}</div>`).join('')}`).join('');
    const s = specsOf(p);
    el.pdpSpecs.innerHTML = [['Specs', Object.entries(s).map(([k, x]) => `${k}: ${x}`).join(' · ') || 'Specs from the maker.'],
      ['Reviews', `${ratingOf(p).rating || '—'} out of 5 from ${Number(ratingOf(p).reviews || 0).toLocaleString('en-US')} reviews.`],
      ['FAQs', 'Can I keep my number? Yes. Do offers combine? Offers shown on this site are not combinable unless they say so.']]
      .map(([h, t]) => `<details><summary>${esc(h)}</summary><p>${esc(t)}</p></details>`).join('');
  }

  const moduleKey = (d) => {
    const piece = pieceOfDecision(d);
    return String((piece && piece.customerContentId) || d.customerContentId || '').toLowerCase().replace(/^(vnt-|vtg-)?(mod|module)[-_]/, '').replace(/_/g, '-');
  };
  const MODULE_TITLE = { 'trade-in': 'Trade in and save', 'plan-pairing': 'Pair with a plan', 'storage-memory': 'Storage & memory',
    'connected-devices': 'Watch, tablet and more lines', accessories: 'Accessories', protection: 'Protect your phone', 'home-bundle': 'Add home internet' };
  const moduleTitle = (d) => { const p = pieceOfDecision(d); return (p && p.title) || MODULE_TITLE[moduleKey(d)] || d.customerContentId; };

  function renderModules(set, opts = {}) {
    const mods = bySlot(set, SLOTS.modules);
    const plans = bySlot(set, SLOTS.plans);
    const offers = SLOTS.offer ? bySlot(set, SLOTS.offer) : [];
    const after = mods.map((d) => ({ id: d.customerContentId, title: moduleTitle(d) }));
    const planOrder = plans.map((d) => (tierOfDecision(d) || {}).name || d.customerContentId);
    const rotate = opts.rotate !== false;
    if (rotate) deltas.rotate(SLOTS.modules, { modules: after, plans: planOrder });
    const prev = state.phone.previous;
    if (rotate) state.phone.moves = deltas.moves(SLOTS.modules, prev ? prev.modules : null, after);
    const mv = state.phone.moves || {};
    const total = piecesFor(SLOTS.modules).length || 7;
    el.modulesWhere.innerHTML = `Below the buy box &middot; slot <b>${esc(SLOTS.modules)}</b> &middot; ${mods.length} of ${total}, in the order the engine returned`;
    el.modules.innerHTML = mods.map((d, i) => moduleHtml(d, i, plans, offers, mv[d.customerContentId], rotate && prev && !prev.modules.some((m) => m.id === d.customerContentId))).join('')
      || '<p class="fine">The slot returned no modules, and the page shows none rather than invent an order.</p>';
    if (rotate) renderPdpChanges();
  }
  const isTemplate = (mods) => {
    const t = (state.anchor.templates && state.anchor.templates.modules) || [];
    return t.length > 0 && mods.every((m, i) => String(m.id).toLowerCase() === t[i]);
  };
  function moduleReceipt(d, i) {
    if (d.strategy === 'site') return '<b>template order</b><span class="rm">no visitor yet, nothing decided</span>';
    if (d.strategy === 'tenant-pinned') return `<b>#${i + 1} · pinned</b><span class="rm">ranking skipped</span>`;
    if (d.strategy === 'default') return `<b>#${i + 1} · template order</b><span class="rm">nothing she has shown moves it yet</span>`;
    const drv = driverSummary(d, 3);
    return `<b>#${i + 1} · score ${fmt3(d.score)}</b>${drv ? `<span class="rm">${drv}</span>` : ''}`;
  }
  function moduleHtml(d, i, plans, offers, mv, entered) {
    const key = moduleKey(d);
    const p = phone(state.phoneId);
    const piece = pieceOfDecision(d);
    const body = ({
      'trade-in': () => tradeInBody(p, offers),
      'plan-pairing': () => planPairingBody(plans),
      'storage-memory': () => storageBody(p),
      'connected-devices': () => connectedBody(plans),
      accessories: () => accessoriesBody(p),
      protection: () => protectionBody(p),
      'home-bundle': () => homeBundleBody(),
    }[key] || (() => ''))();
    return `<section class="pmod${entered ? ' pmod--entered' : ''}" data-module="${esc(key)}" data-op-slot="${esc(d.slot)}" data-op-content="${esc(d.contentId)}" data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}">
      <header class="pmod-head"><div><h2><span class="pmod-pos">${i + 1}</span>${esc(moduleTitle(d))}${mv ? `<span class="delta-chip delta-chip--${mv.cls}">${esc(mv.text)}</span>` : ''}</h2>
        ${piece && piece.subtitle ? `<p class="pmod-sub">${esc(piece.subtitle)}</p>` : ''}</div>
        <p class="rchip">${moduleReceipt(d, i)}</p></header>
      ${body}</section>`;
  }

  /** Trade-in: value per plan, as content; and the SAME offer the homepage led with, carried across, not re-decided. */
  /**
   * Trade-in: the SAME offer the homepage led with, carried across and explained,
   * never decided again; then this phone's own trade-in values, and which plans
   * carry the offer, both read as content (phones.json, and the offer's own plan
   * line in catalog.json). Nothing in this module is computed from her.
   */
  function tradeInBody(p, offers) {
    const v = cur();
    const newLine = p && p.tradeInUpTo ? num(p.tradeInUpTo) : 0;
    const upgrade = tradeUpgrade(p);
    const lead = v && v.lastHomeLead;
    const lp = lead && (lead.piece || pieceOf(lead.decision.customerContentId));
    const changed = lead && (lead.intent || null) !== (v.intent || null);
    const g = lp && lp.grammar;
    const cite = lead && lp
      ? `<div class="cite"><span class="ck">The offer her homepage led with · decision ${esc(shortId(lead.decision.decisionId))} · ${esc(hhmm(lead.at))}</span>
          <b>${esc(lp.title)}</b>
          ${g ? `<dl class="cite-g">${[['Who', g.who], ['Plan', g.plan], ['Needs', g.consideration], ['Value', g.value], ['Ends', g.ends]].filter(([, x]) => x).map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>` : `<span>${esc(lp.subtitle || '')}</span>`}
          <span class="cite-n">${changed ? `Decided when her answer was “${esc(INTENT_WORD[lead.intent] || lead.intent || 'none')}”; she now says “${esc(INTENT_WORD[v.intent] || v.intent)}”, and the homepage decides again on her next visit.` : 'One decision, carried to this page and explained, not decided again.'}</span></div>`
      : '<div class="cite cite--none"><span class="ck">No homepage offer yet</span><span>She has not seen the homepage on this visit, so there is no offer to carry across.</span></div>';
    const now = offers && offers[0] ? (() => {
      const op = pieceOfDecision(offers[0]);
      return `<div class="cite"><span class="ck">For her now, on this page · slot ${esc(offers[0].slot)}</span><b>${esc(op ? op.title : offers[0].customerContentId)}</b></div>`;
    })() : '';
    const own = !p ? '' : newLine || upgrade
      ? `<div class="lead-line"><strong>${esc(p.name)}: up to ${money0(Math.max(newLine, upgrade))} with a trade-in</strong><span>${[newLine && `up to <b>${money0(newLine)}</b> on a new line (${money(trunc2(newLine / 36))}/mo for 36 months)`,
        upgrade && `up to <b>${money0(upgrade)}</b> on an upgrade (${money(trunc2(upgrade / 36))}/mo)`].filter(Boolean).join('; ')}, paid as bill credits.</span></div>`
      : `<div class="lead-line"><strong>No trade-in credit on the ${esc(p.name)} today</strong><span>A trade-in still counts toward the offers on other phones; every value is the catalog’s.</span></div>`;
    const planLine = String((g && g.plan) || '');
    const carries = (t) => Boolean(planLine) && (/any/i.test(planLine) || planLine.includes(t.name));
    const plans = g ? `<div class="trade-plans">${tiers().slice().reverse().map((t) => `<div${carries(t) ? ' class="on"' : ''}><b>${esc(t.name)}</b>
        <span>${carries(t) ? 'carries this offer' : 'not with this offer'}</span><small>${!carries(t) && t.switcher ? `switchers: ${money0(t.switcher)} a line` : ''}</small></div>`).join('')}</div>` : '';
    return `${cite}${now}${own}${plans}
      <div class="mfoot"><span class="mnote">Your current phone:</span>
        <button type="button" class="btn btn--line btn--sm" data-act="trade-est" data-brand="apple" data-eco="ios" data-ctl="trade-apple">An iPhone</button>
        <button type="button" class="btn btn--line btn--sm" data-act="trade-est" data-brand="samsung" data-eco="android" data-ctl="trade-samsung">A Galaxy</button>
        <button type="button" class="btn btn--line btn--sm" data-act="trade-est" data-brand="google" data-eco="android" data-ctl="trade-google">A Pixel</button>
        <span class="mnote" id="tradeEst">${esc(v && v.tradeEst ? v.tradeEst : 'Values are confirmed when we receive and assess the phone.')}</span></div>`;
  }
  const shortId = (id) => (id ? String(id).split(':').slice(-3).join(':') : 'not tracked');

  function planPairingBody(plans) {
    const v = cur();
    const lines = (v && v.lines) || 1;
    const sel = [1, 2, 3, 4].map((n) => `<button type="button" data-act="lines" data-lines="${n}" data-ctl="lines-${n}" data-op-track="custom" data-op-label="select" aria-pressed="${lines === n}">${n === 4 ? '4+' : n}</button>`).join('');
    const perksAll = state.plans ? [...state.plans.perks.values()] : [];
    const cards = plans.map((d, i) => {
      const t = tierOfDecision(d);
      if (!t) return `<article class="plan"><h3>${esc(d.customerContentId)}</h3><p class="fine">plans.json names no such plan.</p></article>`;
      const per = perLineAt(t, lines);
      const hh = trunc2(per * lines);
      const chosen = v && v.plan === t.id;
      const starter = t.starter;
      const starterBtn = starter ? `<button type="button" class="starter" data-act="perk" data-perk="${esc(starter.perk || '')}" data-intent="${esc(starter.intent || '')}" data-plan="${esc(t.id)}" data-ctl="starter-${esc(t.id)}">
          <b>Starter${starter.perk ? ` · ${esc(perkName(starter.perk))}` : starter.intent ? ` · ${esc(starter.intent)}` : ''}</b>${esc(starter.label || starter.line)}</button>` : '';
      const addPerks = t.family === 'Unlimited' ? perksAll.filter((x) => !starter || x.id !== starter.perk).map((x) =>
        `<button type="button" data-act="perk" data-perk="${esc(x.id)}" data-plan="${esc(t.id)}" data-ctl="perk-${esc(t.id)}-${esc(x.id)}">${esc(x.name)} <small>${x.perLine ? `$${x.perLine}/line` : ''}</small></button>`).join('') : '';
      return `<article class="plan${i === 0 ? ' plan--lead' : ''}" data-plan-card="${esc(t.id)}" data-op-slot="${esc(d.slot)}" data-op-content="${esc(d.contentId)}" data-op-decision-id="${esc(d.decisionId || '')}" data-cid="${esc(d.customerContentId)}">
        <span class="plan-fam">${esc(t.family)}${i === 0 && d.strategy !== 'site' ? ' · leads for her' : ''}</span>
        <h3>${esc(t.name)}</h3>
        ${starterBtn}
        <p class="plan-price">${money0(per)}<small>/line${t.switcher ? ` · ${money0(t.switcher)} for switchers` : ` at ${lines === 4 ? '4+' : lines} line${lines === 1 ? '' : 's'}`}</small></p>
        ${lines > 1 ? `<p class="plan-hh">Household: <b>${money(hh)}/mo</b> for ${lines === 4 ? '4' : lines} lines</p>` : ''}
        <ul>${t.includes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${addPerks ? `<div class="perks"><span class="perks-k">Add a perk</span>${addPerks}</div>` : ''}
        <button type="button" class="btn ${chosen ? 'btn--line' : 'btn--dark'} btn--sm" data-act="choose-plan" data-plan="${esc(t.id)}" data-ctl="choose-${esc(t.id)}" data-op-track="custom" data-op-label="select">${chosen ? 'Chosen' : `Choose ${esc(t.name)}`}</button>
        <p class="rc">${d.strategy === 'default' ? `#${i + 1} · the catalog’s order` : d.strategy === 'site' ? 'no visitor yet' : `#${i + 1} · score <b>${fmt3(d.score)}</b>${driverSummary(d, 2) ? ` · ${driverSummary(d, 2)}` : ''}`}</p>
      </article>`;
    }).join('');
    return `<div class="lines-sel"><p class="bb-label">How many lines?</p><div class="seg">${sel}</div>
        <span class="household">${lines > 1 ? `${lines === 4 ? '4' : lines} lines: the per-line price falls as lines are added.` : esc((state.plans && state.plans.autopay) || '')}</span></div>
      <div class="plans">${cards || '<p class="fine">The slot returned no plans.</p>'}</div>`;
  }
  function storageBody(p) {
    if (!p) return '';
    const opts = optionsOf(p), base = opts[0];
    const credit = tradeMonthly(p);
    const cmp = '<div class="mfoot"><button type="button" class="btn btn--dark btn--sm" data-act="compare-open" data-ctl="storage-compare">Compare storage and camera</button><span class="mnote">Every step and the camera side by side, at the catalog’s prices.</span></div>';
    if (opts.length < 2) return `<div class="lead-line"><strong>${esc(optLabel(base))}</strong><span>${esc(p.name)} comes in one storage size.</span></div>${cmp}`;
    const step = opts[1];
    const delta = deltaOf(p, step);
    const tiles = opts.map((o, i) => {
      const d = deltaOf(p, o);
      return `<div class="tile${i === 1 ? ' tile--lead' : ''}">${i === 1 ? '<span class="tlabel">the step up</span>' : ''}<b>${esc(optLabel(o))}</b>
        <span>${money(monthlyOf(o, 36))}/mo${d > 0 ? ` · +${money(d)}` : ' · base'}</span><small>${money(o.price_usd)} retail</small></div>`;
    }).join('');
    return `<div class="lead-line"><strong>Go to ${esc(optLabel(step))}</strong><span>for <b>+${money(delta)}/mo</b> over 36 months: twice the room for 4K video, photos and offline maps.</span></div>
      <div class="mgrid mgrid--${Math.min(4, opts.length)}">${tiles}</div>
      <p class="bb-maths" style="margin-top:12px">${credit ? `The trade-in credit stays capped at <b>${money(credit)}/mo</b>, the ${esc(optLabel(base))} price, so ${esc(optLabel(step))} costs <b>+${money(delta)}/mo</b> net.` : `${esc(optLabel(step))} costs <b>+${money(delta)}/mo</b>.`}</p>${cmp}`;
  }
  function connectedBody(plans) {
    const v = cur();
    const lines = (v && v.lines) || 1;
    const c = (state.plans && state.plans.connected) || {};
    const chosen = v && v.plan && tierById(v.plan);
    const leading = plans && plans[0] ? tierOfDecision(plans[0]) : null;
    const t = chosen || leading || tierById('go');
    const n = Math.max(2, lines);
    const per = t ? perLineAt(t, n) : null;
    const hh = t ? trunc2(perLineAt(t, lines) * lines) : null;
    const tile = (name, line, off, ctlName, label) => `<div class="tile"><b>${esc(name)}</b><span>${line != null ? `${money0(line)}/mo a line` : ''}${off ? ` · up to ${money0(off)} off the device` : ''}</span>
      ${ctlName ? `<button type="button" class="mlink" data-nav="${ctlName}" data-ctl="${ctlName}">${esc(label)}</button>` : ''}</div>`;
    return `${t ? `<div class="lead-line"><strong>${n === 4 ? '4' : n} lines from ${money0(per)} a line</strong><span>on ${esc(t.name)}${chosen ? ', the plan she chose' : ', the plan leading for her'}.${lines > 1 ? ` Household total: <b>${money(hh)}/mo</b> for ${lines === 4 ? '4' : lines} lines.` : ''}</span></div>` : ''}
      <div class="mgrid mgrid--3">${tile('Add a line', per, null, 'add-a-line', 'Add a line')}${tile('Smartwatch line', c.watchLine, c.watchOff, 'kids-watch', 'Kids’ watch')}${tile('Tablet line', c.tabletLine, c.tabletOff, '', '')}</div>
      ${c.note ? `<p class="mnote" style="margin-top:10px">${esc(customerCopy(c.note))}</p>` : ''}`;
  }
  function accessoriesBody(p) {
    const a = (state.plans && state.plans.accessories) || { tiers: {}, items: [] };
    const t = a.tiers || {};
    return `<p class="bb-maths" style="margin:0 0 12px">Buy more, save more: <b>${t['2'] || 20}% off 2</b>, <b>${t['3'] || 25}% off 3</b>, <b>${t['4'] || 30}% off 4 or more</b>.</p>
      <div class="mgrid mgrid--4">${(a.items || []).map((x) => `<div class="tile"><b>${esc(x.name)}</b><span>${money(x.price)}</span><small>${esc(p ? `Fits ${p.name}` : '')}</small></div>`).join('')}</div>`;
  }
  function protectionBody() {
    const pr = (state.plans && state.plans.protection) || { from: 15, to: 18, multi: {} };
    const m = pr.multi || {};
    return `<div class="lead-line"><strong>${money0(pr.from)}–${money0(pr.to)} a month per phone</strong><span>Loss, theft and cracked screens, with same-day replacement in most areas.</span></div>
      <div class="mgrid mgrid--3">${['2', '3', '4'].filter((k) => m[k]).map((k) => `<div class="tile"><b>${k === '4' ? '4 or more' : k} phones</b><span>${money0(m[k])}/mo for the account</span></div>`).join('')}</div>
      ${pr.note ? `<p class="mnote" style="margin-top:10px">${esc(pr.note)}</p>` : ''}`;
  }
  function homeBundleBody() {
    const h = (state.plans && state.plans.home) || { withMobile: 35 };
    const b = state.plans && state.plans.bundle;
    return `<div class="lead-line"><strong>${esc(h.name || '5G Home')} for ${money0(h.withMobile)}/mo</strong><span>with any Unlimited plan${b ? `, or ${esc(b.name)} at ${money0(b.price)} with taxes and fees included` : ''}.</span></div>
      <div class="mfoot"><button type="button" class="btn btn--dark btn--sm" data-act="address" data-ctl="home-bundle-check">Check your address</button>
        <span class="covered-chip">${esc(regionLabel())} is served · no address used</span></div>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CONTENT PAGES: the site's own. Landing on one is the event.
  // ════════════════════════════════════════════════════════════════════════
  const pageTitle = (k) => ({ plans: 'Plans', deals: 'Deals', 'home-internet': 'Home Internet', 'mobile-home': 'Mobile + Home', switch: 'Switch to Vantage',
    byod: 'Bring your phone', 'add-a-line': 'Add a line', 'kids-watch': 'Kids’ smartwatch' }[k] || k);
  function renderPage(key) {
    const back = state.pageFrom && phone(state.pageFrom);
    el.pageCrumbs.innerHTML = `<a data-nav="home" data-ctl="page-home">Home</a><span>/</span>${back ? `<a data-open="${esc(back.id)}" data-back="1" data-ctl="back-phone">${esc(back.name)}</a><span>/</span>` : ''}<span>${esc(pageTitle(key))}</span>`;
    const P = state.plans || { tiers: [], connected: {}, home: {} };
    const planTiles = P.tiers.map((x) => `<div class="tile"><b>${esc(x.name)}</b><span>${money0(perLineAt(x, 1))}/mo for 1 line · ${money0(perLineAt(x, 4))}/line at 4</span><small>${esc((x.starter && x.starter.label) || '')}</small></div>`).join('');
    const c = P.connected || {};
    const body = {
      plans: ['Two ways to pay for your lines.', `Simple is one price at any line count, and less for switchers. ${P.tiers.filter((x) => x.family === 'Unlimited').map((x) => x.name).join(', ').replace(/, ([^,]*)$/, ' and $1')} get cheaper per line as you add lines.`, `<div class="mgrid mgrid--4">${planTiles}</div>`],
      deals: ['Phone deals', 'Every deal the site runs today, with what it requires and what ends the credit.', '<p class="fine">The homepage’s four are decided per visitor; this page lists the whole offer book.</p>'],
      'home-internet': [`${(P.home && P.home.name) || '5G Home'}, from ${money0((P.home && P.home.withMobile) || 35)} a month with a phone plan.`, 'Check an address to see availability; nothing is assumed from where you are browsing.',
        `<div class="cpage-actions"><button type="button" class="btn btn--dark" data-act="address" data-ctl="page-address-check">Check your address</button>
          <span class="mnote">Availability is confirmed at a street address, never from a location guess. The demo stops before an address is entered.</span></div>`],
      'mobile-home': [P.bundle ? `${P.bundle.name}, one price.` : 'Mobile + Home, one price.', P.bundle ? P.bundle.note || '' : '', ''],
      switch: ['Switch in about 15 minutes.', 'Keep your number and your phone. We move the number for you.', ''],
      byod: ['Bring your phone.', 'Check your phone in 30 seconds with its IMEI, then choose Simple or any Unlimited plan.', ''],
      'add-a-line': ['Add a line.', 'The per-line price falls as lines are added.',
        `<div class="mgrid mgrid--3"><div class="tile"><b>Smartwatch line</b><span>${money0(c.watchLine)}/mo a line</span></div><div class="tile"><b>Tablet line</b><span>${money0(c.tabletLine)}/mo a line</span></div></div>
         <div class="cpage-actions"><button type="button" class="btn btn--dark" data-nav="kids-watch" data-ctl="kids-watch">A kids’ smartwatch</button></div>`],
      'kids-watch': ['A smartwatch for the youngest on the plan.', `Calls, texts and location sharing, on a watch line from ${money0(c.watchLine || 10)} a month. Parents choose the contacts and the school hours.`, ''],
    }[key] || [pageTitle(key), '', ''];
    el.pageBody.innerHTML = `<section class="cpage-hero"><span class="nper">not personalised</span><h1>${esc(body[0])}</h1><p>${esc(body[1])}</p></section>
      <div class="cpage-body">${body[2] || ''}${back ? `<div class="cpage-actions"><button type="button" class="btn btn--line" data-open="${esc(back.id)}" data-back="1" data-ctl="back-phone-btn">Back to ${esc(back.name)}</button></div>` : ''}</div>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SHEETS: quick look, a plan's starter or perk, compare storage and camera.
  // ════════════════════════════════════════════════════════════════════════
  async function quickLook(id) {
    const p = phone(id);
    if (!p) return;
    await ensureVisitor();
    const c = colorsOf(p), s = specsOf(p);
    openSheet('quick', `<p class="sk">Quick look</p><h2 id="sheetTitle">${esc(p.maker)} ${esc(p.name)}</h2>
      <div class="shot">${phoneImg(p, c[0].hex)}</div>
      <div class="srow"><span>From</span><b>${money(p.monthly36)}/mo for 36 months · ${money(p.price_usd)} retail</b></div>
      <div class="srow"><span>Storage</span><b>${esc(optionsOf(p).map(optLabel).join(', '))}</b></div>
      <div class="srow"><span>Colors</span><b>${esc(c.map((x) => x.name).join(', '))}</b></div>
      ${s.camera ? `<div class="srow"><span>Camera</span><b>${esc(s.camera)}</b></div>` : ''}
      <div class="sactions"><button type="button" class="btn btn--dark" data-open="${esc(p.id)}" data-ctl="sheet-open-${esc(p.id)}">See details</button>
        <button type="button" class="btn btn--line" data-act="close-sheet" data-ctl="sheet-done">Close</button></div>`);
    await send('product_view', phoneAttrs(p, { view: 'card' }));
    note('looked', `${p.maker} ${p.name}`, `a phone card · ${ecoOf(p)} · ${money(p.price_usd)}`);
    await renderVectors();
  }
  /** A plan's starter or an added perk: the plan builder's selector (beat 8's document names it a select). */
  async function perkSheet(perk, intent, planId) {
    const t = tierById(planId);
    const info = (perk && state.plans && state.plans.perks.get(perk)) || { name: perk || (intent ? `For ${intent}` : 'Starter') };
    const fx = perk && state.plansFx && state.plansFx.perks && !Array.isArray(state.plansFx.perks) ? (state.plansFx.perks[perk] || {}) : {};
    const isStarter = Boolean(t && t.starter && (perk ? t.starter.perk === perk : t.starter.intent === intent));
    openSheet('perk', `<p class="sk">${esc(t ? t.name : 'Plan')} · ${isStarter ? 'starter' : 'add a perk'}</p><h2 id="sheetTitle">${esc(info.name)}</h2>
      <p style="margin-top:12px">${esc(info.body || fx.body || (t && t.starter && t.starter.label) || '')}</p>
      ${info.perLine ? `<div class="srow"><span>Price</span><b>$${esc(info.perLine)}/mo per line</b></div>` : ''}
      ${t ? `<div class="srow"><span>On ${esc(t.name)}</span><b>${money0(perLineAt(t, 1))}/mo for one line</b></div>` : ''}
      ${t && t.legal ? `<p class="fine">${esc(t.legal)}</p>` : ''}
      <div class="sactions"><button type="button" class="btn btn--dark" data-act="close-sheet" data-ctl="sheet-done">Done</button></div>`);
    // Opening a perk's details is a view of that perk's page (beat 8's document), not a selection.
    await send('page_view', perk ? { page: 'perk', category: 'plans', perk } : { page: 'starter', category: 'plans', intent });
    note('viewed', `${info.name}${t ? ` on ${t.name}` : ''}`, perk ? `perk ${perk} · category plans` : `intent ${intent} · category plans`);
    await renderVectors();
  }
  async function compareSheet(tab, opening) {
    const p = phone(state.phoneId);
    if (!p) return;
    const opts = optionsOf(p);
    const peers = [p, ...state.phones.filter((x) => x.id !== p.id && num(x.price_usd) >= 900 && x.brand !== p.brand).slice(0, 2)];
    const stor = `<div class="stbl" style="grid-template-columns:120px repeat(${opts.length}, minmax(0,1fr))">
      <div class="ch rh"></div>${opts.map((o) => `<div class="ch">${esc(optLabel(o))}</div>`).join('')}
      <div class="rh">Monthly</div>${opts.map((o) => `<div>${money(monthlyOf(o, 36))}</div>`).join('')}
      <div class="rh">Over base</div>${opts.map((o) => { const d = deltaOf(p, o); return `<div>${d > 0 ? `+${money(d)}/mo` : 'base'}</div>`; }).join('')}
      <div class="rh">Retail</div>${opts.map((o) => `<div>${money(o.price_usd)}</div>`).join('')}</div>`;
    const cam = `<div class="stbl" style="grid-template-columns:110px repeat(${peers.length}, minmax(0,1fr))">
      <div class="ch rh"></div>${peers.map((x, i) => `<div class="ch${i === 0 ? ' on' : ''}">${esc(x.name)}</div>`).join('')}
      ${['camera', 'zoom', 'display'].map((k) => `<div class="rh">${k}</div>${peers.map((x, i) => `<div class="${i === 0 ? 'on' : ''}">${esc(specsOf(x)[k] || '—')}</div>`).join('')}`).join('')}</div>`;
    openSheet('compare', `<p class="sk">Compare</p><h2 id="sheetTitle">${esc(p.name)}: storage and camera</h2>
      <div class="tabs"><button type="button" data-act="cmp-tab" data-ctl="cmp-storage-tab" aria-pressed="${tab !== 'camera'}">Storage</button>
        <button type="button" data-act="cmp-camera" data-ctl="cmp-camera" aria-pressed="${tab === 'camera'}">Camera</button></div>
      ${tab === 'camera' ? cam : stor}
      <p class="fine">The catalog’s prices: the monthly figure at 0% APR over 36 months beside the retail price.</p>
      <div class="sactions"><button type="button" class="btn btn--dark" data-act="close-sheet" data-ctl="sheet-done">Done</button></div>`);
    if (opening || tab === 'camera') {
      const o = optionOf(p, cur().config.storage);
      // Beat 7's two compares, as measured: the storage row carries the storage step, the camera row the phone's brand and ecosystem.
      await sendCustom('compare', tab === 'camera'
        ? { spec: 'camera', productId: p.id, brand: p.brand, os: ecoOf(p), ecosystem: ecoOf(p), price_usd: num(o.price_usd), contentType: 'compare' }
        : { spec: 'storage', productId: p.id, storage: o.storage, price_usd: num(o.price_usd), contentType: 'compare' });
      note('compared', `${p.name} ${tab === 'camera' ? 'camera' : 'storage'}`, 'a spec compare · contentType compare');
      await renderVectors();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ONE DISPATCHER. The cursor and a human hand run the same handler.
  // ════════════════════════════════════════════════════════════════════════
  async function handleControl(t) {
    if (!t || !t.dataset) return;
    const actName = t.dataset.act;
    if (actName === 'close-sheet') { await closeSheet(); return; }
    if (actName === 'rail') {
      await ensureVisitor();
      state.rail.off = t.dataset.off === '1';
      await sortRail();
      note('asserted', state.rail.off ? 'The rail at affinity 0' : 'The rail at her affinity', state.rail.off ? 'the parity check: the engine returns the site’s order exactly' : 'the rail follows her again');
      return;
    }
    await ensureVisitor();
    const credited = await creditDecided(t);
    const v = cur();
    const p = phone(state.phoneId);
    if (t.dataset.open && actName !== 'deal-cta' && actName !== 'hero-cta') {
      sheets.dismiss();
      await openPhone(t.dataset.open, { event: !t.dataset.back });   // a back link restores the page; it is not a new view
      return;
    }
    if (t.dataset.quick) { await quickLook(t.dataset.quick); return; }
    if (t.dataset.nav) {
      sheets.dismiss();
      const nav = t.dataset.nav;
      if (nav === 'home') await openHome({ focus: state.busy ? 'deals' : false });
      else if (nav === 'phones') await openPhones();
      else await openPage(nav);
      return;
    }
    if (t.dataset.jump) { focusOn($(t.dataset.jump)); return; }
    switch (actName) {
      case 'brand': await openPhones(t.dataset.brand || null); return;
      case 'color': v.config.color = t.dataset.color; renderBuyBox(); return;
      case 'storage': {
        v.config.storage = t.dataset.storage; renderBuyBox();
        const o = optionOf(p, v.config.storage);
        await sendCustom('select', { control: 'storage', productId: p.id, storage: o.storage, price_usd: num(o.price_usd) });
        note('selected', `${optLabel(o)} storage`, `${money(o.price_usd)} retail · the band follows the price`);
        await renderVectors(); return;
      }
      case 'term': {
        v.config.term = Number(t.dataset.term); renderBuyBox();
        await sendCustom('select', { control: 'term', productId: p.id, months: v.config.term });
        note('selected', `${v.config.term}-month term`, 'a buy-box selector, never decided'); await renderVectors(); return;
      }
      case 'intent': {
        v.intent = t.dataset.intent; v.intentByHand = true; (v.declared = v.declared || new Set()).add(v.intent); renderBuyBox(); renderWho();
        await sendCustom('select', { control: 'intent', intent: v.intent });
        note('asserted', `ctx.intent = ${v.intent}`, 'as her account would · gates offers, never price');
        await refreshPhone(); return;
      }
      case 'lines': {
        v.lines = Number(t.dataset.lines);
        if (state.phone.set) renderModules(state.phone.set, { rotate: false });
        await sendCustom('select', { control: 'lines', lines: linesWord(v.lines), count: v.lines });
        note('selected', `${v.lines === 4 ? '4+' : v.lines} line${v.lines === 1 ? '' : 's'}`, `lines ${linesWord(v.lines)}`);
        await renderVectors(); return;
      }
      case 'choose-plan': {
        v.plan = t.dataset.plan;
        const tier = tierById(v.plan);
        if (state.phone.set) renderModules(state.phone.set, { rotate: false });
        await sendCustom('select', { control: 'plan', plan: v.plan });
        note('selected', tier ? tier.name : v.plan, 'her own choice · no dimension moves · the continue hero carries it');
        await renderVectors(); return;
      }
      case 'perk': await perkSheet(t.dataset.perk || null, t.dataset.intent || null, t.dataset.plan); return;
      case 'compare-open': await compareSheet('storage', true); return;
      case 'cmp-tab': await compareSheet('storage', false); return;
      case 'cmp-camera': await compareSheet('camera', false); return;
      case 'trade-est': {
        v.tradeEst = p && (p.tradeInUpTo || p.tradeInUpgradeUpTo)
          ? `An eligible ${brandName(t.dataset.brand)} phone: up to ${money0(p.tradeInUpTo || p.tradeInUpgradeUpTo)} toward the ${p.name}, confirmed when we assess it.`
          : `An eligible ${brandName(t.dataset.brand)} phone: its value is confirmed when we receive and assess it.`;
        const node = $('tradeEst'); if (node) node.textContent = v.tradeEst;
        await sendCustom('select', { control: 'trade-in', category: 'phones', brand: t.dataset.brand, os: t.dataset.eco, ecosystem: t.dataset.eco, contentType: 'tool' });
        note('selected', `Trade-in: ${brandName(t.dataset.brand)}`, 'her current phone · a trade-in quote');
        await renderVectors(); return;
      }
      case 'address': {
        await sendCustom('start_order', { control: 'address', category: 'home-internet', intent: 'home', contentType: 'tool' });
        note('started', 'An address check for 5G Home', 'a start order · this demo stops before any address is entered');
        say('address check started: the demo stops before an address is entered', 'good');
        await renderVectors(); return;
      }
      case 'add-to-cart': {
        const o = optionOf(p, v.config.storage);
        await send('add_to_cart', phoneAttrs(p, { storage: o.storage, price_usd: num(o.price_usd) }));
        v.cart = (v.cart || 0) + 1; el.cartCount.hidden = false; el.cartCount.textContent = String(v.cart);
        note('added', `${p.name} ${optLabel(o)}`, 'to the cart · the heaviest signal on this page');
        await renderVectors(); return;
      }
      case 'deal-cta': case 'hero-cta': {
        if (t.dataset.address) { await handleControl({ dataset: { act: 'address' } }); flash(t.closest('.deal') || t); return; }
        if (t.dataset.open && actName === 'hero-cta') { await openPhone(t.dataset.open); return; }
        say(credited ? 'click credited to the decision that held it' : 'no decision held this card, so there is nothing to credit', credited ? 'good' : '');
        note('clicked', actName === 'hero-cta' ? 'The hero' : 'A deal in the four', credited ? 'the reward this slot is judged on' : 'site default · not credited');
        flash(t.closest('.deal') || t); return;
      }
      case 'sticky-next': focusOn(el.modules.querySelector('[data-module="plan-pairing"]') || el.modules); return;
      default:
    }
  }
  function flash(node) {
    if (!node || !node.classList) return;
    node.classList.remove('clicked'); void node.offsetWidth; node.classList.add('clicked');
    setTimeout(() => node.classList.remove('clicked'), 1200);
  }
  // The sticky summary: shown only once the buy box's own Add to cart has scrolled up out of view, on the phone page.
  function syncSticky() {
    const bar = $('stickyBar'), add = $('bbAdd');
    if (!bar || !add) return;
    bar.classList.toggle('stickybar--on', state.view === 'phone' && add.getBoundingClientRect().bottom < 0);
  }
  let stickyQueued = false;
  window.addEventListener('scroll', () => {
    if (stickyQueued) return;
    stickyQueued = true;
    requestAnimationFrame(() => { stickyQueued = false; syncSticky(); });
  }, { passive: true });
  el.railForYou.addEventListener('click', () => { if (!state.busy) void handleControl({ dataset: { act: 'rail', off: '0' } }); });
  el.railSite.addEventListener('click', () => { if (!state.busy) void handleControl({ dataset: { act: 'rail', off: '1' } }); });
  el.dealsGhosts.addEventListener('click', () => deltas.toggleBefore(SLOTS.deals));

  // ════════════════════════════════════════════════════════════════════════
  // COMPARE: the demo kit's widget, wired by the kit (a Before always exists:
  // one after each view's first decided paint, one as every performed beat
  // starts, and Capture's own). Here: where a frame is taken, the decided state
  // a frame keeps for What changed, and Vantage's two compare tools, the fresh
  // visitor and the streaming shopper. Nothing here ranks, asserts or asks the
  // engine anything new: the frames are the page.
  // ════════════════════════════════════════════════════════════════════════
  /** Where a frame was taken, as its tag and the Compare buttons name it. */
  const whereNow = () => (state.view === 'phone' ? `${(phone(state.phoneId) || {}).name || 'phone'} page`
    : state.view === 'phones' ? 'phones grid' : state.view === 'page' ? `${pageTitle(state.pageKey)} page` : 'homepage');
  /** The decided state on screen: what each list returned, in order, and her strongest signals. */
  function snapshotOfPage() {
    const v = cur();
    const vec = [];
    for (const [dim, values] of Object.entries((v && v.vector) || {})) for (const [value, a] of Object.entries(values || {})) vec.push({ dim, value, a: num(a) });
    vec.sort((a, b) => b.a - a.a);
    const base = { who: whoNow(), at: Date.now(), view: state.view, where: whereNow(), vector: vec.slice(0, 6), intent: v && v.intent, region: regionShown() };
    if (state.view === 'phone') {
      const set = state.phone.set;
      return { ...base,
        lists: [['Modules, in the order returned', set ? bySlot(set, SLOTS.modules).map((d) => ({ id: d.customerContentId, t: moduleTitle(d), s: d.score })) : []],
          ['Pair with a plan', set ? bySlot(set, SLOTS.plans).map((d) => ({ id: d.customerContentId, t: (tierOfDecision(d) || {}).name || d.customerContentId, s: d.score })) : []]] };
    }
    if (state.view !== 'home') return { ...base, lists: [] };
    // Before anyone arrives the homepage is the site's own: the same for everyone, labelled so, nothing decided.
    const set = state.home.set;
    const own = (id) => ({ id, t: `${(pieceOf(id) || {}).title || id} (the site’s own)`, s: null });
    return { ...base,
      lists: [['Hero', set ? bySlot(set, SLOTS.hero).map((d) => ({ id: d.customerContentId, t: (pieceOfDecision(d) || {}).title || d.customerContentId, s: d.score })) : [own(el.hero.dataset.key)]],
        ['The deals four', set ? bySlot(set, SLOTS.deals).map((d) => ({ id: d.customerContentId, t: (pieceOfDecision(d) || {}).title || d.customerContentId, s: d.score }))
          : siteDefaultDeals().map((d) => own(d.customerContentId))],
        ['Phones for you', (state.rail.order || state.phones.map((p) => p.id)).slice(0, railTake()).map((id) => ({ id, t: (phone(id) || {}).name || id, s: null }))]] };
  }

  /**
   * A second shopper's decided set on the live page, for one clone: drawn by the page's own renderers, as the
   * streaming shopper's pages are, with no event, no route and no meter read. Returns the function that puts her
   * page back from state, with no re-ask: her answer, her before and now, her chips, her scroll and her address.
   */
  function paintQuietly(f, set, rail, onPhone) {
    const railDeltas = $('railDeltas');
    const keep = { who: state.who, home: state.home, phone: state.phone, rail: state.rail, exitNote: state.exitNote, heroKey: el.hero.dataset.key,
      railDeltasHidden: railDeltas ? railDeltas.hidden : true, scroll: window.scrollY, url: location.pathname + location.search };
    state.who = f.key;          // the renderers read cur(): her selections stay off the stranger's page
    state.exitNote = null;
    if (onPhone) {
      state.phone = { previous: null, current: null, set, moves: {} };
      renderBuyBox();
      renderModules(set);       // the stranger's first answer on this page: no before of hers, no move chips
    } else {
      state.home = { ...keep.home, previous: null, current: null, set, prevDecisions: null, curDecisions: null };
      state.rail = rail || { status: 'site', order: null, items: null, off: keep.rail.off };
      renderHero(bySlot(set, SLOTS.hero)[0] || null);
      renderDeals(bySlot(set, SLOTS.deals), false);
      renderRail();
      if (railDeltas) railDeltas.hidden = true;
      renderPool();
    }
    return () => {
      state.who = keep.who; state.home = keep.home; state.phone = keep.phone; state.rail = keep.rail; state.exitNote = keep.exitNote;
      if (onPhone) {
        renderBuyBox();
        if (state.phone.set) renderModules(state.phone.set, { rotate: false });
        if (state.phone.current) renderPdpChanges();
      } else {
        el.hero.dataset.key = keep.heroKey || '';     // her hero comes back without an entrance
        renderHero(state.home.set ? (bySlot(state.home.set, SLOTS.hero)[0] || null) : null);
        if (state.home.set) renderDeals(bySlot(state.home.set, SLOTS.deals), false, { rotate: false });
        else renderDeals(siteDefaultDeals(), true);
        renderRail();
        if (railDeltas) railDeltas.hidden = keep.railDeltasHidden;
        renderPool();
        refreshReceiptLines();
      }
      try { window.scrollTo({ top: keep.scroll, behavior: 'instant' }); } catch { /* optional */ }
      try { if (location.pathname + location.search !== keep.url) history.replaceState({ vantage: true }, '', keep.url); } catch { /* a sandboxed document has no history */ }
    };
  }

  /**
   * The streaming shopper, for Compare (a tool, not a beat): a Before of what the
   * first shopper sees, then a second, direct visitor opens the streaming
   * starter on the phone page, on screen, with the cursor; his page is the Now
   * frame. Then her page comes back from state and the two open side by side.
   */
  async function streamingShopper() {
    if (state.busy) { say('a beat is running; the page is frozen until it lands', 'bad'); return; }
    let m;
    try { m = await kit(); } catch (error) { say(`Compare could not load the compare kit: ${String(error.message || error)}`, 'bad'); return; }
    state.busy = true;
    demo.compare.supersede();                      // a Compare still waiting for a press gives way to this one
    say('the streaming shopper is browsing…');
    const keys = ['Her page', 'The streaming shopper'];
    let restore = null;
    try {
      await ensureVisitor();
      await takeBaseline('tool');                  // her page as it is now: the Before, pixels and decided state
      // Her phone-page state too: the second shopper's presses rotate state.phone, and her next press
      // must diff against what SHE last saw, not against his page (R1 7b-i).
      const back = { who: state.who, view: state.view, phoneId: state.phoneId, url: location.pathname + location.search, scroll: window.scrollY,
        phone: { previous: state.phone.previous, current: state.phone.current, moves: state.phone.moves, set: state.phone.set } };
      restore = () => {
        useVisitor(back.who);
        const v = cur();
        state.phoneId = back.phoneId;
        Object.assign(state.phone, back.phone);    // her before and now, her move chips, her answer
        state.quietRoute = false;
        try { history.replaceState({ vantage: true }, '', back.url); } catch { /* a sandboxed document has no history */ }   // her address, not his
        if (back.view === 'phone' && v && v.phoneSet) {
          showView('phone'); renderBuyBox(); renderStaticPdp(); state.phone.set = v.phoneSet; renderModules(v.phoneSet, { rotate: false });
          if (state.phone.current) renderPdpChanges();   // the before/now row as she left it, not his
        } else if (back.view === 'home' && v && v.homeSet) { showView('home'); state.home.set = v.homeSet; }
        else showView(back.view);
        renderWho();
        try { window.scrollTo({ top: back.scroll, behavior: 'instant' }); } catch { /* optional */ }
      };
      state.quietRoute = true;                     // his pages take her history entry for the moment; it is handed back below
      const cfg = state.anchor.streamingShopper || {};
      const pid = cfg.phone && phone(cfg.phone) ? cfg.phone : (state.phoneId || focusPhone());
      const title = twoShoppersTitle(back, pid);   // true to the two phones: hers, and the one he opens
      const foot = twoShoppersFoot(back, pid);     // and so is the sentence under the comparison
      const plan = String(cfg.plan || 'max').replace(/^plan[-_]/, '');
      const perk = cfg.perk || 'streaming';
      const b = await mintVisitor('B', directEntry(), 'Shopper B');
      useVisitor('B');
      note('arrived', 'A second visitor', 'direct · consent granted · for Compare', b);
      await openPhone(pid);
      const btn = el.modules.querySelector(`[data-perk="${perk}"][data-plan="${plan}"]`) || el.modules.querySelector(`[data-perk="${perk}"]`);
      if (btn) { await performClick(`#modules [data-ctl="${btn.getAttribute('data-ctl')}"]`); await sleep(500); await performClick('#sheetBody [data-ctl="sheet-done"]'); }
      const live = snapshotOfPage();
      const theirs = m.captureFrame(el.site, { kind: 'streaming', label: frameLabel, meta: () => ({ where: whereNow(), who: whoNow(), snap: live }) });
      await theirs.cloned;                         // his page is in the frame; it may leave the screen now
      el.cursor.classList.remove('show');
      m.showWaiting({ title, heading: 'Back to her page', text: 'His frame is taken; hers comes back as she left it.' });
      restore(); restore = null;
      await renderVectors();
      await m.openCompare(el.site, { now: theirs, title, tags: { before: keys[0], now: keys[1] }, foot,
        details: (bf, nf) => compareCols(bf.meta && bf.meta.snap, nf.meta && nf.meta.snap, keys),
        sameNote: 'Her page and his are the same: nothing either of them did weighs on it yet.',
        nearNote: 'Her page and his differ only in small print: What changed has the answers behind both.' });
      note('returned', `Back to ${cur() ? cur().label : 'the first shopper'}`, 'her page as she left it · nothing re-asked');
      say('done', 'good');
    } catch (error) { say(String(error.message || error), 'bad'); }
    finally {
      if (restore) { try { restore(); } catch { /* her page, as far as it can be put back */ } }
      el.cursor.classList.remove('show'); state.busy = false; state.quietRoute = false;
    }
  }

  /**
   * A fresh visitor, for Compare, on the homepage or the phone page: the same
   * page asked for someone who has done nothing yet, in the same region, with no
   * event sent. Her page is the Before; the stranger's decided set is drawn on the
   * live page under the overlay for one frame; then her page and address come back
   * from state, with no re-ask, and the two open side by side.
   */
  async function freshVisitor() {
    if (state.busy) { say('a beat is running; the page is frozen until it lands', 'bad'); return; }
    let m;
    try { m = await kit(); } catch (error) { say(`Compare could not load the compare kit: ${String(error.message || error)}`, 'bad'); return; }
    const onPhone = state.view === 'phone' && Boolean(state.phoneId && phone(state.phoneId));
    const title = onPhone ? 'Her phone page, and a fresh visitor’s' : 'Her homepage, and a fresh visitor’s';
    if (!cur() || !(onPhone || state.view === 'home')) {
      m.showMessage({ title, heading: 'No shopper on a page yet:', text: 'Fresh visitor sets a stranger’s homepage or phone page beside hers. Bring her in with Next, then press it again.' });
      say('open the homepage or a phone page with her first: Compare puts a fresh visitor beside her there', 'bad');
      return;
    }
    state.busy = true;
    demo.compare.supersede();                      // a Compare still waiting for a press gives way to this one
    say('a fresh visitor is asking…');
    const keys = ['Her page', 'A fresh visitor, same region'];
    m.showWaiting({ title, heading: 'Her page, then a fresh visitor’s', text: 'Same region, nothing sent.' });
    let restore = null;
    try {
      await takeBaseline('tool');                  // her page as it is now: the Before, pixels and decided state
      const p = onPhone ? phone(state.phoneId) : null;
      const f = await mintVisitor('F', directEntry(), 'Fresh visitor');
      f.fresh = true;
      if (p) f.config = { phoneId: p.id, color: defaultColorOf(p), storage: optionsOf(p)[0].storage, term: 36 };
      note('arrived', 'A fresh visitor', 'direct · consent granted · no event sent', f);
      const r = await ask(onPhone ? 'phone' : 'home', f);
      if (!r.ok) throw new Error(r.error);
      const rail = onPhone ? null : await askRail(f, { status: 'site', order: null, items: null, off: state.rail.off });
      restore = paintQuietly(f, r.set, rail, onPhone);
      const live = snapshotOfPage();               // the stranger's decided state, read off the page as drawn
      const theirs = m.captureFrame(el.site, { kind: 'fresh', label: frameLabel, meta: () => ({ where: whereNow(), who: whoNow(), snap: live }) });
      await theirs.cloned;                         // the stranger's page is in the frame; hers comes back now
      restore(); restore = null;
      await m.openCompare(el.site, { now: theirs, title, tags: { before: keys[0], now: keys[1] }, foot: onPhone ? FOOT.phone : FOOT.home,
        details: (bf, nf) => compareCols(bf.meta && bf.meta.snap, nf.meta && nf.meta.snap, keys),
        sameNote: 'Her page and the fresh visitor’s are the same: nothing she has done weighs on it yet.',
        nearNote: 'Her page and the fresh visitor’s differ only in small print: What changed has the answers behind both.' });
      say('done', 'good');
    } catch (error) {
      say(String(error.message || error), 'bad');
      if (m.isOpen()) m.showMessage({ title, heading: 'No fresh visitor’s page:', text: String(error.message || error) });
    } finally {
      if (restore) { try { restore(); } catch { /* her page, as far as it can be put back */ } }
      state.busy = false;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE EXIT. Behind a flag: the object host's alarm, pushed over the socket.
  // ════════════════════════════════════════════════════════════════════════
  const exitOn = () => (QS.get('exit') === '1') || (QS.get('exit') !== '0' && state.anchor.exitBeat === true);
  async function onEngineExit(exits, v) {
    if (v !== cur()) return;
    const waited = state.exitArmedAt ? Math.round((Date.now() - state.exitArmedAt) / 1000) : null;
    const what = exits.length ? exits.map((x) => `${x.value} (${DIM_LABEL[x.dim] || x.dim}) fell below ${fmt2(thetaOut())}`).join(', ') : 'an interest decayed below the exit threshold';
    state.exitNote = `Nobody pressed anything. At ${hhmm(Date.now())} ${esc(what)}${waited != null ? `, ${waited} s after she stopped` : ''}; the object host’s alarm fired and the page asked again.`;
    note('engine', 'The engine withdrew a claim', `${what} · no press`);
    if (state.view === 'phone') await refreshPhone(); else if (state.view === 'home') await refreshHome();
    say(`the engine moved the page on its own${waited != null ? ` after ${waited} s` : ''}`, 'good');
    state.exitArmedAt = 0;
    setTimeout(() => { state.exitNote = null; }, 60000);
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE ADDRESS BAR: what it names, restored, as the browser's Back and Forward do.
  // ════════════════════════════════════════════════════════════════════════
  /** What the address bar names, restored: a phone page without a new view; anything else as the page would open it. */
  async function restoreFromUrl() {
    const q = new URLSearchParams(location.search);
    const pathId = (location.pathname.match(/\/phone\/([^/?#]+)$/) || [])[1];
    const id = q.get('id') || (pathId && decodeURIComponent(pathId));
    if (/\/phone(\.html)?(\/[^/?#]+)?$/.test(location.pathname) && id && phone(id)) return openPhone(id, { event: false });
    if (q.get('view') === 'phones') return openPhones(q.get('brand'));
    if (q.get('view')) return openPage(q.get('view'));
    return openHome({ event: false });
  }
  /** Whether the browser's Back returns to this phone: she is on the homepage, reached from that phone's page. */
  const canBackTo = (id) => Boolean(state.view === 'home' && state.backTarget && state.backTarget.id === id);

  // ════════════════════════════════════════════════════════════════════════
  // THE BEATS' FOOTING. The beats themselves are data (public/vantage/beats.json),
  // run by the kit's director; these are the readings of Vantage's documents they
  // rest on, and the two sentences the exit beat writes.
  // ════════════════════════════════════════════════════════════════════════
  const focusPhone = () => (state.anchor.focusPhone && phone(state.anchor.focusPhone) ? state.anchor.focusPhone : (state.phones.find((p) => p.brand === 'samsung') || state.phones[0] || {}).id);
  const focusName = () => { const p = phone(focusPhone()); return p ? p.name : 'the phone'; };
  /**
   * Beat 3's touches: three Samsung touches, as lane L1 measured them (the
   * Galaxy S26 card, its page, the S26 Ultra card), so brand samsung crosses the
   * entry threshold by beat 4. The anchor may name them (browseTouches).
   */
  const browseTouches = () => (arr(state.anchor.browseTouches).length ? arr(state.anchor.browseTouches)
    : [{ id: focusPhone(), view: 'card' }, { id: focusPhone(), view: 'page' }, { id: 'galaxy-s26-ultra', view: 'card' }]).filter((t) => t && phone(t.id));
  /** Beat 4's phone: a Pixel page, then home (the hinge). */
  const hingePhone = () => (state.anchor.hingePhone && phone(state.anchor.hingePhone) ? state.anchor.hingePhone
    : (state.phones.find((p) => p.id === 'pixel-11') || state.phones.find((p) => p.brand === 'google') || {}).id);
  /** Content notes carry their sources for the build; the site shows the sentence, never the citation. */
  const customerCopy = (s) => String(s || '').replace(/\s*\([^)]*(?:seen on|\.com\b|brief)[^)]*\)/gi, '').replace(/\s+;/g, ';').trim();
  /**
   * What the minute did to her meters, named, read off the reflex before and
   * after: the claim that fell under the exit threshold, and the lean that held.
   * Ranking is continuous, so the four can keep their order; the sentence says so.
   */
  function exitSentence(before, after, fourHeld) {
    const rows = [];
    for (const [dim, values] of Object.entries(before || {})) for (const [value, a0] of Object.entries(values || {})) {
      rows.push({ dim, value, b: num(a0), a: num(((after[dim] || {})[value]) || 0) });
    }
    const fell = rows.filter((r) => r.b - r.a > 0.02).sort((x, y) => (y.b - y.a) - (x.b - x.a));
    const out = fell.filter((r) => r.b >= thetaOut() && r.a < thetaOut());
    const held = rows.filter((r) => r.b >= thetaIn() && r.a >= thetaIn() && r.b - r.a < 0.05)
      .sort((x, y) => (x.dim === 'category') - (y.dim === 'category') || y.a - x.a);
    const name = (r) => (r.dim === 'brand' ? brandName(r.value) : r.dim === 'ecosystem' ? ({ android: 'Android', ios: 'iOS' }[r.value] || r.value) : r.value);
    const row = (r) => `${esc(DIM_LABEL[r.dim] || r.dim)} ${esc(r.value)} ${fmt2(r.b)} → ${fmt2(r.a)}${roomOf(r.dim) ? ` (${esc(roomOf(r.dim))} memory)` : ''}`;
    const gone = out.length ? out : fell.slice(0, 1);
    const hold = held[0];
    // "Claim withdrawn" only when this minute carried it across the exit line; a fading value says where it stands now
    // (L5 saw "0.42 → 0.25, still above the 0.45 exit threshold" when the minute started late).
    const where = (r) => (r.a < thetaOut() ? `under the ${fmt2(thetaOut())} exit line` : `still above the ${fmt2(thetaOut())} exit threshold`);
    const claim = out.length ? `<b>${esc(name(out[0]))} claim withdrawn:</b> ${out.map(row).join('; ')}, under the ${fmt2(thetaOut())} exit threshold.`
      : gone.length ? `<b>${esc(name(gone[0]))} fading:</b> ${row(gone[0])}, ${where(gone[0])}.` : 'Nothing decayed far enough to withdraw a claim.';
    const holds = hold ? ` <b>${esc(name(hold))} holds:</b> ${row(hold)}.` : '';
    const tail = ' Nobody pressed anything; the page asked again after a minute.';
    return {
      four: `${claim}${holds}${fourHeld && hold ? ` Order unchanged in the four, because ${esc(DIM_LABEL[hold.dim] || hold.dim)} still carries it.` : ''}${tail}`,
      rail: `${claim}${holds} The rail re-sorts on the same answer.`,
    };
  }
  /** The rail's own change line: what one re-ask did to the six. Returns whether the order moved. */
  function renderRailDeltas(noteHtml) {
    const node = $('railDeltas');
    if (!node) return false;
    const take = railTake();
    const a = (state.rail.prevOrder || []).slice(0, take), b = (state.rail.order || []).slice(0, take);
    const rows = [];
    if (a.length && b.length) {
      b.forEach((id, i) => {
        const was = a.indexOf(id), p = phone(id);
        if (!p) return;
        if (was === -1) rows.push(`<li><span class="sign sign--in">+</span><span><b>${esc(p.name)}</b> <em>entered the six at ${i + 1}</em></span></li>`);
        else if (was > i) rows.push(`<li><span class="sign sign--up">↑</span><span><b>${esc(p.name)}</b> <em>${was + 1} → ${i + 1}</em></span></li>`);
        else if (was < i) rows.push(`<li><span class="sign sign--down">↓</span><span><b>${esc(p.name)}</b> <em>${was + 1} → ${i + 1}</em></span></li>`);
      });
      a.forEach((id, i) => { if (!b.includes(id) && phone(id)) rows.push(`<li><span class="sign sign--out">−</span><span><b>${esc(phone(id).name)}</b> <em>left the six (was ${i + 1})</em></span></li>`); });
    }
    // The note travels with the rail only when the same answer re-sorted it; otherwise the rail says nothing.
    node.innerHTML = rows.length ? (noteHtml ? `<li class="delta-engine"><span class="hk">The engine, on its own</span>${noteHtml}</li>` : '') + rows.join('') : '';
    node.hidden = !rows.length;
    return rows.length > 0;
  }
  const regionKey = (x) => (x && typeof x === 'object' ? x.key : x) || null;
  /**
   * Regions (lane F2, 2026-10-01). Her own region leads: the edge locates the request and the page asserts
   * nothing, unless the address bar carries the ?region= rehearsal override (the suites pass US-NY, where
   * lane L1 measured beats 3 to 15). An assertion is for beat 2's contrast and 14a/14b's availability pair:
   * the contrast is Texas unless her own region is Texas, then New York (the anchor's two rehearsed regions);
   * 5G Home is shown in her own region when it is available there, else in the anchor's covered region (New
   * York), asserted (lane F3), and withdrawn in the uncovered one (Montana).
   */
  const regions = () => {
    const r = state.anchor.regions || {};
    const first = regionKey(r.first) || 'US-NY', second = regionKey(r.second) || 'US-TX';
    return { first, second, covered: regionKey(r.covered) || first, uncovered: regionKey(r.uncoveredRegion) || regionKey(r.uncovered) || 'US-MT' };
  };
  /** Beat 2's asserted contrast: the anchor's second rehearsed region (Texas), unless that is her own, then its first (New York). */
  const contrast = () => { const r = regions(); const own = OVERRIDE.region || (state.own && state.own.key) || null; return own === r.second ? r.first : r.second; };
  /**
   * Beat 14a's region (lane F3, 2026-10-01). Where 5G Home is available is the catalog's own rule:
   * eligibleWhen.regions on the home-bundle module, else on the 5G Home offer, else the anchor's coverage list.
   * When her own region (the edge's, or the ?region= override) is on it, 14a asserts nothing; otherwise, or with
   * no region on her request, it asserts the anchor's covered region (New York), labelled asserted, not observed.
   */
  const homeCoverage = () => {
    const rule = (id) => { const e = id && enginePieces().find((p) => p.customerContentId === id); return e && e.eligibleWhen && Array.isArray(e.eligibleWhen.regions) ? e.eligibleWhen.regions : null; };
    return rule('home-bundle') || rule(anchorId('homeBundle')) || arr((state.anchor.regions || {}).coverage);
  };
  const homeRegion = () => {
    const own = OVERRIDE.region || (state.own && state.own.key) || null;
    return own && homeCoverage().includes(own) ? { key: own, own: true } : { key: regions().covered, own: false };
  };
  const homeName = () => { const h = homeRegion(); return h.own ? ownName() : regionName(h.key) || h.key; };
  /** Why 14a asserts the covered region: her own region has no 5G Home, or her request carried no region. */
  const notHomeWhy = () => (state.own && state.own.key ? `5G Home is not available in ${ownName()}` : 'her request carried no region');
  function storageStep(id) {
    const p = phone(id);
    const opts = p ? optionsOf(p) : [];
    const o = opts[1] || opts[0] || { storage: '', label: 'storage' };
    return { ...o, label: optLabel(o) };
  }
  function adParams() {
    const a = state.anchor.arrival || {};
    const q = new URLSearchParams();
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term']) if (a[k]) q.set(k, a[k]);
    if (a.referrer) q.set('referrer', a.referrer);
    const keep = new URLSearchParams(location.search);
    for (const k of ['fixtures', 'exit', 'region', 'metro', 'debug']) if (keep.has(k)) q.set(k, keep.get(k));
    return q;
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE FACTS the beats speak about (public/vantage/beats.json). Read fresh at
  // every step, so a guard sees the page as it is when the step runs. Each
  // value is this page's own reading of its documents and its state.
  // ════════════════════════════════════════════════════════════════════════
  function facts() {
    const v = cur();
    const r = regions();
    const to = contrast();
    const fp = phone(focusPhone()), hp = phone(hingePhone());
    const step = storageStep(focusPhone());
    const home = homeRegion();
    const here = state.view === 'phone' && state.phoneId === focusPhone();
    const canBack = canBackTo(focusPhone());
    const lead = bySlot(state.home.set, SLOTS.deals)[0];
    const leadPiece = lead && pieceOfDecision(lead);
    const leadIntents = arr(leadPiece && leadPiece.tags && leadPiece.tags.intent);
    // Beat 3's touches as she makes them: a card looked at after a page is a return to the grid, which is a page view.
    let onGrid = true;
    const touches = browseTouches().map((t) => {
      const page = t.view === 'page';
      const returnsToGrid = !page && !onGrid;
      if (returnsToGrid) onGrid = true;
      if (page) onGrid = false;
      return { id: t.id, name: phone(t.id).name, page, returnsToGrid, attrs: phoneAttrs(phone(t.id), { view: t.view }) };
    });
    const o = fp ? (v && v.config && v.config.phoneId === fp.id ? optionOf(fp, v.config.storage) : optionsOf(fp)[0]) : null;
    return {
      view: { home: state.view === 'home', phones: state.view === 'phones', phone: state.view === 'phone', page: state.view === 'page' },
      sheet: { open: Boolean(state.sheet) },
      arrival: { entry: describeEntry(landingEntry(adParams())) },
      region: { override: OVERRIDE.region, away: (state.ctx.region || null) !== ownRegion(), ownName: ownName(), contrast: to, contrastName: regionName(to) },
      regions: { uncovered: r.uncovered, uncoveredName: regionName(r.uncovered) },
      home: { own: home.own, key: home.key, keyName: regionName(home.key), name: homeName(), asserted: state.ctx.region === home.key,
        notWhy: notHomeWhy(), notWhyCap: notHomeWhy().replace(/^./, (c) => c.toUpperCase()) },
      focus: { id: focusPhone(), name: focusName(), brand: fp ? fp.brand : null, ecosystem: fp ? ecoOf(fp) : null, here, canBack, reached: here || canBack,
        pageAttrs: phoneAttrs(fp, { view: 'page' }) },
      hinge: { id: hingePhone(), name: hp ? hp.name : null, pageAttrs: phoneAttrs(hp, { view: 'page' }) },
      browse: { touches },
      storageStep: { label: step.label, storage: step.storage, price: num(step.price_usd), delta: fp ? money(deltaOf(fp, step)) : '' },
      plans: { more: tierName('more'), max: tierName('max'), go: tierName('go') },
      intent: { default: defaultIntent(), defaultWord: INTENT_WORD[defaultIntent()] || defaultIntent(), changed: Boolean(v && v.intent !== defaultIntent()) },
      exit: { room: roomOf('brand') || 'short', thetaOut: fmt2(thetaOut()), seconds: state.exitSeconds ?? null },
      deals: { superseded: Boolean(hingeLine()), leadUpgradeOnly: Boolean(leadPiece && leadIntents.length === 1 && leadIntents[0] === 'upgrade'), leadTitle: leadPiece ? leadPiece.title : '' },
      // The anchor's ids the beats name: null when an anchor does not name one (the fixture anchor has no
      // closesAtBeat11), so a fallback reads it as not set; a name the beats do not have is the director's error.
      ids: { launch: null, closesAtBeat11: null, blackFriday: null, duo: null, homeBundle: null, ...(state.anchor.ids || {}) },
      beatNames: { twoWeeks: beatName('twoWeeks', 'catalog'), blackFriday: beatName('blackFriday', 'catalog'), pinDuo: beatName('pinDuo', 'slots') },
      events: { kidsWatch: KIDS_WATCH, homeInternet: PAGE_EVENTS['home-internet'] },
      cart: { attrs: fp ? phoneAttrs(fp, { price_usd: num(o.price_usd), storage: o.storage }) : {} },
      slots: SLOTS,
      // Tomorrow's homepage template, as the published beat document names it (read at boot).
      templates: { tomorrow: (state.templateDoc && state.templateDoc.template && state.templateDoc.template.home) || [SLOTS.deals, SLOTS.hero, SLOTS.rail] },
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE VERBS THE KIT LACKS (beats.json `call`): the arrival, and the minute.
  // ════════════════════════════════════════════════════════════════════════
  /**
   * Beat 1's arrival, after the tenant's reset: the page's own state cleared, the address bar the ad's landing,
   * the stranger minted from it, her region read from the request (or the rehearsal override, labelled), the
   * socket behind its flag. The landing itself is the beat's next step.
   */
  async function arrive() {
    // The Before taken as this press landed (the page before she arrives) stays: it is beat 1's own comparison.
    state.visitors = {}; state.who = null; state.receipts.clear();
    state.home = { previous: null, current: null, set: null, pos: 5, prevDecisions: null, curDecisions: null };
    state.phone = { previous: null, current: null, set: null };
    state.rail = { status: 'site', order: null, items: null, off: false };
    el.cartCount.hidden = true; placeDeals((state.anchor.templates || {}).home, 'today’s');
    const params = adParams();
    try { history.replaceState({ vantage: true }, '', `/vantage/?${params}`); } catch { /* sandboxed */ }
    const v = await mintVisitor('A', landingEntry(params));
    useVisitor('A');
    note('arrived', 'A stranger, from a paid-social ad', `${describeEntry(v.entry)} · anonymous · consent granted`);
    // Her own region leads: nothing is asserted unless the address bar carries the ?region= rehearsal override.
    state.own = null;
    setRegion(ownRegion(), ownSource());
    if (OVERRIDE.region) note('asserted', `region = ${OVERRIDE.region}`, 'a rehearsal override (?region=), labelled · never the default');
    else if (OVERRIDE.ignored) note('ignored', `?region=${OVERRIDE.ignored}`, 'not a region key, so nothing is asserted');
    note('asserted', `ctx.intent = ${v.intent}`, 'a signed-out visitor is a new line until she says otherwise');
    await loadColdStart();
    if (!OVERRIDE.region) {
      const o = state.own || {};
      note('located', o.key ? `region ${o.key}${o.label && o.label !== o.key ? ` (${o.label})` : ''}` : 'no region on this request',
        o.key ? (LOCAL_RUNTIME ? 'from the request, as the local runtime fills request.cf · nothing asserted' : 'from the request: the edge located her · nothing asserted')
          : 'the national figure is shown · nothing invented');
    }
    if (exitOn()) connectSocket(v, onEngineExit);
  }
  /** Beat 5, before the minute: her meters read (the engine's own read, which a slow answer shows as reading) and kept. */
  let exitRun = { before: {}, four: '' };
  async function readMetersBefore() {
    // Her meters read before the minute and after it (beat 5's document); a slow read shows as reading, not as a stalled page.
    el.dealsDeltas.insertAdjacentHTML('afterbegin', '<li class="delta-timer"><span class="hk">Reading her meters</span><span><b class="tmr">…</b> Before the minute starts: the engine’s own read.</span></li>');
    await renderVectors();
    exitRun = { before: JSON.parse(JSON.stringify(state.lastVector || {})), four: (state.home.current || []).map((c) => c.id).join('|') };
    note('waited', 'Nobody touches the page', 'a minute; the page asks again after it');
    const doc = await tryJson('/vantage/beats/05-stop-touching.json');
    state.exitSeconds = doc ? num(doc.waitSeconds) : null;
  }
  /** Beat 5, after the minute: the page asks again, and names what the engine's answer withdrew and what held. */
  async function askAgainAfterTheMinute() {
    // A slow read shows as the page asking, never as a stalled clock; the page has no order of its own to fall back to.
    const row = el.dealsDeltas.querySelector('.delta-timer');
    if (row) row.innerHTML = '<span class="hk">Asking the engine</span><span><b class="tmr">…</b> The minute is up and the page is asking again: the engine’s answer, not the page’s.</span>';
    say('asking the engine…');
    await refreshHome();
    const said = exitSentence(exitRun.before, state.lastVector || {}, (state.home.current || []).map((c) => c.id).join('|') === exitRun.four);
    state.exitNote = said.four;
    note('engine', 'The engine withdrew a claim', stripTags(said.four).slice(0, 160));
    renderDealsChanges();
    const railMoved = renderRailDeltas(said.rail);
    focusOn(railMoved ? $('railModule') : el.dealsModule);
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE KIT'S QUESTIONS, answered for Vantage's two pages.
  // ════════════════════════════════════════════════════════════════════════
  /** A decision's title as the page shows it: a plan by its tier, a module by its own title, anything else by its piece. */
  const titleOf = (d) => (d.slot === SLOTS.plans ? ((tierOfDecision(d) || {}).name || d.customerContentId)
    : d.slot === SLOTS.modules ? moduleTitle(d) : ((pieceOfDecision(d) || {}).title || d.customerContentId));
  /** Why these: on the phone page its two slots; on the homepage the hinge, if the receipts say it, then its two slots. */
  function whyGroups() {
    const onPhone = state.view === 'phone' && state.phone.set;
    if (onPhone) {
      return { set: state.phone.set, groups: [[`Phone page · slot ${SLOTS.modules}`, bySlot(state.phone.set, SLOTS.modules)],
        [`Inside Pair with a plan · slot ${SLOTS.plans}`, bySlot(state.phone.set, SLOTS.plans)]] };
    }
    if (state.home.set) {
      return { set: state.home.set, lead: hingeLine(), groups: [[`Homepage · slot ${SLOTS.hero}`, bySlot(state.home.set, SLOTS.hero)],
        [`Homepage · slot ${SLOTS.deals}`, bySlot(state.home.set, SLOTS.deals)]] };
    }
    return { set: state.home.set, groups: [] };
  }
  /** One row of the day's report: the item's key and its title, a plan by its tier and a module by its own name. */
  function reportRow(slot, id) {
    const piece = pieceOf(id);
    const title = slot === SLOTS.plans ? ((tierById((piece && piece.tier) || String((piece && piece.customerContentId) || id).replace(/^plan[-_]/, '')) || {}).name || (piece && piece.title) || id)
      : slot === SLOTS.modules ? (piece && piece.title) || MODULE_TITLE[String(id).replace(/_/g, '-')] || id : piece ? piece.title : id;
    return { key: String((piece && piece.customerContentId) || id), title };
  }
  /** Predict-then-prove's proof: every decision the last press made on the page it landed on. */
  function proofOf(before) {
    const onPhone = state.view === 'phone' && state.phone.set;
    const set = onPhone ? state.phone.set : state.home.set;
    const decisions = onPhone ? [...bySlot(set, SLOTS.modules), ...bySlot(set, SLOTS.plans)] : set ? [...bySlot(set, SLOTS.hero), ...bySlot(set, SLOTS.deals)] : [];
    return {
      set, decisions,
      beforeRows: onPhone ? ((before.phone && before.phone.modules) || []) : (before.home || []),
      main: onPhone ? bySlot(set, SLOTS.modules).map(moduleTitle) : bySlot(set, SLOTS.deals).map((d) => (pieceOfDecision(d) || {}).title || d.customerContentId),
      context: [SLOTS.hero, SLOTS.plans],
      unitOf: (d) => (d.slot === SLOTS.deals ? 'container' : 'position'),
      titleOf,
      ruleOf: (d) => (pieceOfDecision(d) || {}).eligibleWhen,
    };
  }
  /** Where a merchandiser beat's target stands right now, in the four. */
  function standingLine(target) {
    const at = (state.home.current || []).findIndex((c) => c.id === target);
    const p = pieceOf(target);
    return `<li><b>${esc(p ? p.title : target)}</b> ${at > -1 ? `holds container <b>${at + 1}</b> right now.` : 'is not in the four right now.'}</li>`;
  }
  /** What is on screen right now, for the Explain panel. */
  function nowMap() {
    if (state.view === 'phone' && state.phone.current) return { label: 'The modules right now', rows: state.phone.current.modules.map((m) => m.title) };
    return state.home.current && state.home.current.length ? { label: 'The four right now', rows: state.home.current.map((c) => c.title) }
      : { label: 'The four right now', empty: '<p class="pd-empty" style="font-size:12px">The homepage has not been asked yet.</p>' };
  }
  /** What the presenter may assert by hand: nothing (the request's own region), the override, and the anchor's regions. */
  function assertableRegions() {
    const r = regions();
    return [null, ...new Set([OVERRIDE.region, r.first, r.second, r.covered, r.uncovered].filter(Boolean))];
  }
  /** Why a piece left the four, read off the engine: its window, or the receipt's own candidate list. The page tests no rule. */
  function wentWhy(id) {
    const now = Date.now();
    const cands = dealCandidates();
    const p = pieceOf(id);
    if (!p) return 'left the pool entirely';
    if (p.window && p.window.to && Date.parse(p.window.to) <= now) return 'its window closed';
    if (!cands) return 'out of the four';
    if (cands.has(p.id)) return 'still a candidate, outranked';
    return p.eligibleWhen ? 'not a candidate for this request: it has a rule' : 'not a candidate for this request';
  }
  /** The before/now rows, keyed by slot: the four on the homepage, the modules on the phone page. */
  function deltaRows() {
    return {
      [SLOTS.deals]: {
        state: () => state.home,
        get: () => ({ before: state.home.previous, after: state.home.current || [] }),
        set: () => state.home.set,
        mode: 'ghosts', before: el.dealsGhosts, deltas: el.dealsDeltas, unit: 'container', pins: true, swaps: true, leftFirst: true,
        opening: { sign: '·', cls: 'in', what: 'The opening four', why: 'the first decision this visitor was served' },
        emptyBefore: 'The visitor had not seen the module yet.',
        left: (b, i) => `left container ${i + 1} · ${wentWhy(b.id)}`,
        // The engine's own note (beat 5, or the alarm behind ?exit=1), then the hinge when the receipts say it.
        lead: () => (state.exitNote ? `<li class="delta-engine"><span class="hk">The engine, on its own</span>${state.exitNote}</li>` : '') + (hingeLine() || ''),
        held: { title: (d) => (pieceOfDecision(d) || {}).title || d.customerContentId, index: (d) => bySlot(state.home.set, SLOTS.deals).indexOf(d) },
        nothing: { text: 'Nothing moved in the four.' },
        pending: 'the homepage has not been asked again yet',
        beforeRow: { row: el.dealsBeforeRow, label: el.dealsNowLabel, four: el.dealsBeforeFour, card: (d, i) => dealCardHtml(d, i, { before: true }) },
        title: (d) => (pieceOfDecision(d) || {}).title || d.customerContentId,
        titleOfId: (id) => (pieceOf(id) || {}).title || id,
      },
      [SLOTS.modules]: {
        state: () => state.phone,
        get: () => ({ before: state.phone.previous ? state.phone.previous.modules : null, after: state.phone.current ? state.phone.current.modules : [],
          prev: state.phone.previous, now: state.phone.current }),
        mode: 'list', before: el.pdpBefore, deltas: el.pdpDeltas, unit: 'position', tight: true,
        emptyBefore: 'She had not seen this page’s modules yet.',
        first: (g) => {
          const now = g.now;
          const fresh = Boolean(cur() && cur().fresh);   // Compare's fresh visitor: nothing sent, so nothing of hers to credit
          return `<li class="delta-none">The first decision for this page: <b>${esc(now.modules.map((m) => m.title).join(' → '))}</b>. Plans lead with <b>${esc(now.plans[0] || '—')}</b>. ${fresh ? 'A fresh visitor has sent nothing: the template order, with the region’s prior.'
            : isTemplate(now.modules) ? 'Nothing she has done weighs on a module yet, so this is the template order.' : 'The order her browsing already earns; <b>Why these</b> explains each one, and <b>Compare → Fresh visitor</b> shows the template order beside it.'}</li>`;
        },
        left: () => 'left the page · outranked, or its rule stopped holding',
        extra: (g) => (g.prev.plans[0] !== g.now.plans[0] && g.now.plans[0] ? [{ sign: '↑', cls: 'up', what: g.now.plans[0], why: `now leads Pair with a plan (was ${g.prev.plans[0] || '—'})` }] : []),
        nothing: '<li class="delta-none">Nothing moved on this page: the same modules in the same order, the same plan leading.</li>',
      },
    };
  }
  /** The streaming shopper's title, true to the two phones involved: one phone page only when he opens hers. */
  function twoShoppersTitle(back, pid) {
    const his = phone(pid);
    const hers = back.view === 'phone' ? phone(back.phoneId) : null;
    if (hers && his && hers.id === his.id) return `Two shoppers, one phone page, one engine: the ${his.name}`;
    if (hers && his) return `Two shoppers, two phone pages, one engine: the ${hers.name} and the ${his.name}`;
    return `Two shoppers, one engine: her ${whereNow()} and the ${his ? `${his.name} page` : 'phone page'}`;
  }
  /**
   * The sentence under the streaming shopper's comparison, true to the same two phones: the same page, the same buy
   * box (FOOT.streaming) only when he opens hers; two phone pages, named, when he opens another.
   */
  function twoShoppersFoot(back, pid) {
    const his = phone(pid);
    const hers = back.view === 'phone' ? phone(back.phoneId) : null;
    if (hers && his && hers.id === his.id) return FOOT.streaming;
    if (hers && his) return `Two phone pages, the ${hers.name} and the ${his.name}, from the same catalog; each buy box shows the public price anyone sees. Only what each of them did is different.`;
    return `Two pages, her ${whereNow()} and the ${his ? `${his.name} page` : 'phone page'}; same catalog, same public prices. Only what each of them did is different.`;
  }
  /** A region key's name as lane L1's anchor gives it (rehearsed and uncovered regions), else null. */
  function regionName(key) {
    const R = state.anchor.regions || {};
    const hit = [...arr(R.rehearsed), R.uncoveredRegion].find((x) => x && x.key === key);
    return hit ? hit.label : null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // FIXTURE MODE (?fixtures=1). Canned answers in the engine's own shapes, for
  // laying out and photographing the pages before lane L1's worker existed.
  // Labelled on screen; never used against a live worker.
  // ════════════════════════════════════════════════════════════════════════
  function fixtureState() {
    const steps = (state.engineFx && state.engineFx.steps) || {};
    const order = director.keys();
    const upto = state.fixtureStep ? order.indexOf(state.fixtureStep) : -1;
    const acc = { vector: {} };
    order.slice(0, upto + 1).forEach((k) => { const s = steps[k]; if (s) Object.assign(acc, s, { vector: s.vector || acc.vector }); });
    return acc;
  }
  function fixtureDecision(id, slot, i, fx, pinned) {
    const p = pieceOf(id);
    const drivers = arr((fx.drivers || {})[id]).map(([dim, value, a, weight]) => ({ dim, value, a, weight }));
    const score = drivers.reduce((s, x) => s + x.a * x.weight, 0) || Math.max(0.05, 0.4 - i * 0.05);
    return { contentId: p ? p.id : id, customerContentId: id, type: p ? p.type : 'piece', slot, order: i, score: Math.round(score * 1000) / 1000,
      strategy: pinned ? 'tenant-pinned' : 'affinity', decisionId: `vantage:fx:${state.fixtureStep || 'boot'}:${slot}:${i}:${id}`, explain: { drivers } };
  }
  async function fixtureApi(path) {
    await sleep(50);
    const fx = fixtureState();
    const ok = (body) => ({ status: 200, ok: true, body });
    if (path.includes('/identity/session')) { const n = Math.floor(Date.now() / 1000); return ok({ session: { capability: 'fixture', subject: `vis-fx-${uid().slice(0, 8)}`, sessionId: `s-fx-${uid().slice(0, 8)}`, grantId: 'fixture', iat: n, exp: n + 3600 } }); }
    if (path.includes('/session/preferences')) return ok({ consent: { tracking: true, personalization: true } });
    if (path.startsWith('/realtime/action')) return ok({ success: true });
    if (path.startsWith('/realtime/reflex')) return ok({ affinity: { dims: fx.vector || {} } });
    if (path.startsWith('/sort')) {
      const site = state.phones.map((p) => p.id);
      const order = state.rail.off || !fx.rail ? site : [...fx.rail.filter((id) => site.includes(id)), ...site.filter((id) => !fx.rail.includes(id))];
      return ok({ ok: true, order, affinityWeight: state.rail.off ? 0 : 1, items: order.map((id, rank) => ({ id, rank, feedRank: site.indexOf(id), score: fx.rail && !state.rail.off && fx.rail.includes(id) ? Math.round((0.6 - fx.rail.indexOf(id) * 0.07) * 1000) / 1000 : 0, drivers: [] })) });
    }
    if (path.includes('/decisions/snapshot')) {
      const page = new URLSearchParams(path.split('?')[1] || '').get('page');
      const decisions = [];
      if (page === PAGES.home) {
        arr(fx.hero || ['hero-launch']).forEach((id, i) => decisions.push(fixtureDecision(id, SLOTS.hero, i, fx)));
        arr(fx.deals).forEach((id, i) => decisions.push(fixtureDecision(id, SLOTS.deals, i, fx, arr(fx.pinned).includes(id))));
      } else {
        arr(fx.modules).forEach((id, i) => decisions.push(fixtureDecision(id, SLOTS.modules, i, fx)));
        arr(fx.plans).forEach((id, i) => decisions.push(fixtureDecision(id, SLOTS.plans, i, fx)));
      }
      decisions.forEach((d, i) => { d.order = i; });
      return ok({ ok: true, tenant: TENANT, page, arm: 'personalized', decisions, sources: {} });
    }
    return { status: 404, ok: false, body: { error: 'fixture mode has no answer for this route' } };
  }
  function fixtureReceipts(ids) {
    const fx = fixtureState();
    const term = (state.anchor.arrival || {}).utm_term || 'iphone-18-pro';
    return { status: 200, ok: true, body: { ok: true, receipts: ids.map((decisionId) => {
      const id = String(decisionId).split(':').pop();
      const applied = (fx.contextual || {})[id];
      return { decision_id: decisionId, authority: 'engine', explain: { ...(applied ? { contextual: { applied, drivers: [{ signal: 'campaign_term', value: term, dimension: 'campaign', tag: term, weight: 0.6, contribution: applied }] } } : {}) } };
    }) } };
  }

  // ════════════════════════════════════════════════════════════════════════
  // BOOT. The site's own defaults are on screen before any press: static
  // content, labelled, never a placeholder that reads as broken.
  // ════════════════════════════════════════════════════════════════════════
  /** A cold load of the phone page (phone.html, /vantage/phone?id=): the template order, undecided, until a press. */
  function bootPhoneView() {
    const q = new URLSearchParams(location.search);
    const onPhone = document.body.dataset.entry === 'phone' || /\/phone(\.html)?\/?$/.test(location.pathname) || /\/phone\/[^/]+$/.test(location.pathname);
    const pathId = (location.pathname.match(/\/phone\/([^/?#]+)$/) || [])[1];
    const id = q.get('id') || (pathId && decodeURIComponent(pathId)) || (onPhone ? focusPhone() : null);
    if (!onPhone || !id || !phone(id)) return null;
    const p = phone(id);
    state.phoneId = id;
    state.visitors.boot = { key: 'boot', label: 'nobody', config: { phoneId: id, color: defaultColorOf(p), storage: optionsOf(p)[0].storage, term: 36 }, intent: null, lines: 1, journey: [] };
    state.who = 'boot';
    renderBuyBox(); renderStaticPdp();
    const t = state.anchor.templates || {};
    const defaults = state.anchor.slotDefaults || {};
    const modIds = arr(defaults[SLOTS.modules] || t.modules).slice(0, 6);
    const planIds = arr(defaults[SLOTS.plans] || t.plans).slice(0, 3);
    const site = (cid, slot, i) => ({ customerContentId: cid, contentId: (pieceOf(cid) || {}).id || cid, slot, order: i, score: 0, strategy: 'site', explain: { drivers: [] } });
    renderModules({ decisions: [...modIds.map((c, i) => site(c, SLOTS.modules, i)), ...planIds.map((c, i) => site(c, SLOTS.plans, 6 + i))] });
    el.pdpDeltas.innerHTML = '<li class="delta-none">No visitor yet: the modules are in the <b>template order</b>, undecided. Press <b>Next</b> to begin.</li>';
    delete state.visitors.boot; state.who = null;
    state.phone = { previous: null, current: null, set: null };
    showView('phone');
    return id;
  }

  (async () => {
    try {
      el.wordmark.textContent = BRAND.name;
      el.tagline.textContent = BRAND.tagline;
      if (FIXTURE) el.fixtureFlag.hidden = false;
      const [phonesDoc, details, plans, plansFx, anchor, reflex, display, manifest, engineFx, beatsDoc, templateDoc] = await Promise.all([
        firstJson('phones', ['/vantage/phones.json']),
        firstJson('details', ['/vantage/fixtures/phone-details.json']),
        firstJson('plans', ['/vantage/plans.json', '/vantage/fixtures/plans.json']),
        tryJson('/vantage/fixtures/plans.json'),
        firstJson('anchor', ['/vantage/beats/anchor.json', '/vantage/fixtures/anchor.json']),
        Promise.resolve(null),                       // the registry travels in the anchor (beats/anchor.json registry)
        firstJson('display', ['/vantage/catalog.json', '/vantage/fixtures/catalog.json']),
        tryJson('/vantage/img/MANIFEST.json'),
        FIXTURE ? tryJson('/vantage/fixtures/engine.json') : Promise.resolve(null),
        firstJson('beats', ['/vantage/beats.json']),             // the director's script: the beats as data
        tryJson('/vantage/beats/15-continue-and-report.json'),   // tomorrow's homepage template, which beat 15b places
      ]);
      if (!phonesDoc || !Array.isArray(phonesDoc.phones)) throw new Error('phones.json is missing: lane L1 writes public/vantage/phones.json');
      if (!beatsDoc || !Array.isArray(beatsDoc.beats)) throw new Error('beats.json is missing: the director’s script is public/vantage/beats.json');
      director.setBeats(beatsDoc);
      state.templateDoc = templateDoc;
      state.phonesDoc = phonesDoc;
      state.phones = phonesDoc.phones;
      state.phones.forEach((p) => state.phoneById.set(p.id, p));
      state.details = (details && details.phones) || {};
      state.detailsDoc = details || {};
      state.plansFx = plansFx;
      state.plans = normPlans(plans, plansFx);
      // The static blocks quote lane L1's plans.json, so a price changes in one place.
      const P = state.plans, hb = $('homebandCopy'), lc = $('loyaltyCopy');
      if (hb && P.home && P.home.withMobile != null) {
        hb.innerHTML = `${esc(P.home.name)} for <b>${money0(P.home.withMobile)}/mo</b> with any mobile plan${P.bundle
          ? `, or <b>${esc(P.bundle.name)}</b> for ${money0(P.bundle.price)}: ${esc(String(P.bundle.note || '').replace(/^./, (c) => c.toLowerCase()))}` : '.'}`;
      }
      if (lc && P.loyalty && P.loyalty.fee != null) lc.textContent = `Members pay no activation or upgrade fee: ${money0(P.loyalty.fee)} waived when you join.`;
      state.anchor = anchor || {};
      // The registry the arithmetic reads: the published document if the seed wrote it, else the anchor's copy of it.
      state.registry = reflex || state.anchor.registry || (await tryJson('/vantage/fixtures/reflex.json'));
      state.sources.registry = reflex ? 'beats/reflex.json' : state.anchor.registry ? `${state.sources.anchor} registry` : 'fixtures/reflex.json';
      (display && display.pieces ? display.pieces : []).forEach((p) => state.display.set(p.customerContentId, p));
      state.manifest = manifest ? readManifest(manifest) : null;
      state.engineFx = engineFx;
      if (state.anchor.pages) Object.assign(PAGES, state.anchor.pages);
      if (state.anchor.slots) Object.assign(SLOTS, state.anchor.slots);
      if (state.anchor.events && state.anchor.events.source) transport.configure({ source: state.anchor.events.source });
      if (state.anchor.brand && state.anchor.brand.name) { BRAND.name = state.anchor.brand.name; el.wordmark.textContent = BRAND.name; }
      await useCatalog(beatName('open', 'catalog'));
      // The rehearsal override applies from the first read, a direct phone-page load included; without it nothing is asserted.
      if (OVERRIDE.region) { state.ctx.region = OVERRIDE.region; state.regionSource = 'rehearsal override'; }
      // Every template in beats.json resolves against the facts, or the page names what does not before anyone presses.
      const unresolved = director.validate();
      if (unresolved.length) throw new Error(`beats.json: ${unresolved.join(' · ')}`);
      renderRoadmap();
      renderAsserts();
      renderPresses();
      renderNext();
      renderWho();
      placeDeals((state.anchor.templates || {}).home, 'today’s', true);
      renderHero(null);
      renderDeals(siteDefaultDeals(), true);
      el.dealsDeltas.innerHTML = '<li class="delta-none">Before anyone arrives the module shows <b>the site’s own four</b>: static content, the same for everyone, nothing decided. Press <b>Next</b> and a stranger lands from the ad.</li>';
      renderRail();
      renderPool();
      const directPhone = bootPhoneView();
      const loaded = ['phones', 'plans', 'anchor', 'display', 'catalog'].map((k) => `${k}: ${state.sources[k] || 'missing'}`).join(' · ');
      say(`ready · ${loaded} · registry: ${state.sources.registry} · images: ${state.manifest ? 'MANIFEST' : 'no manifest'}`, 'good');
      demo.debug({ handleControl });   // under ?debug, window.__vantage: the hook the DOM suite drives
      // The compare kit and html2canvas, fetched in idle time, so the first Before is quick to take.
      idle(() => { kit().then((m) => m.preload()).catch(() => { /* Compare says so when it is pressed */ }); });
      // A direct load of the phone page is a real arrival on it: a visitor, her view of the phone, and the live answer.
      if (directPhone) {
        await openPhone(directPhone, { scroll: false }).then(() => loadColdStart())
          .then(() => say('ready · this phone page was decided live for a direct visitor; Next starts the walkthrough', 'good'))
          .catch((error) => { engineDown(el.modulesDown, String(error.message || error)); say(String(error.message || error), 'bad'); });
      }
    } catch (error) {
      say(String(error.message || error), 'bad');
      engineDown(el.dealsDown, String(error.message || error));
    }
  })();
})();
