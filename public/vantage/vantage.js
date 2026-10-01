/* public/vantage/vantage.js
 * Vantage: a carrier's homepage and phone page, driven by the engine.
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
 * Where each thing comes from:
 *   public/vantage/phones.json, plans.json, catalog.json   lane L1 (content)
 *   public/vantage/beats/*.json, beats/anchor.json          lane L1 (engine documents, page facts)
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
(() => {
  'use strict';

  const BRAND = { name: 'Vantage', tagline: 'See further.' };
  const TENANT = 'vantage';
  let SOURCE = 'vantage-demo';            // lane L1's anchor names it (events.source); read again at boot
  const API = {
    reset: '/vantage/api/reset', beat: '/vantage/api/beat', report: '/vantage/api/report',
    receipt: '/vantage/api/receipt', coldstart: '/vantage/api/coldstart',
  };
  const QS = new URLSearchParams(location.search);
  const FIXTURE = QS.has('fixtures');
  // ?region=US-NY is a REHEARSAL OVERRIDE, never the default: the suites pass it so their figures stay
  // reproducible, and the panel labels it. Without it the arrival asserts no region and the edge locates the
  // request (lane F2, 2026-10-01: the real location always leads).
  const regionParam = (s) => { const k = String(s || '').trim().toUpperCase(); return /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(k) ? k : null; };
  const OVERRIDE = { region: regionParam(QS.get('region')), metro: QS.get('metro'),
    ignored: QS.has('region') && !regionParam(QS.get('region')) ? String(QS.get('region')).slice(0, 16) : null };
  /** Under local wrangler dev, request.cf is the runtime's stand-in, not an edge's reading of the request; the panel says so. */
  const LOCAL_RUNTIME = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /\.localhost$/.test(location.hostname);

  let PAGES = { home: 'home', phone: 'phone' };
  let SLOTS = { hero: 'hero', deals: 'deals', rail: 'phones-rail', modules: 'pdp-modules', plans: 'plan-pairing', offer: null };

  const $ = (id) => document.getElementById(id);
  const el = {
    cursor: $('demo-cursor'), fixtureFlag: $('fixtureFlag'),
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
    whoChip: $('whoChip'), armChip: $('armChip'), ctxChips: $('ctxChips'),
    vectors: $('vectors'), priorLine: $('priorLine'),
    coldStart: $('coldStart'), journey: $('journey'), whyBody: $('whyBody'),
    reportBody: $('reportBody'), buildReport: $('buildReport'), roadmap: $('roadmap'),
    captureBtn: $('captureBtn'), compareBtn: $('compareBtn'), captureNote: $('captureNote'),
    sheetBack: $('sheetBack'), sheetBody: $('sheetBody'), sheetClose: $('sheetClose'),
    pdBack: $('pdBack'), pdMode: $('pdMode'), pdDone: $('pdDone'), pdAct: $('pdAct'), pdArith: $('pdArith'), pdArithK: $('pdArithK'),
    pdWill: $('pdWill'), pdNow: $('pdNow'), pdNowK: $('pdNowK'), pdWhyWrap: $('pdWhyWrap'), pdWhy: $('pdWhy'), pdWhyHead: $('pdWhyHead'),
    pdMapNow: $('pdMapNow'), pdMapAfter: $('pdMapAfter'), pdGo: $('pdGo'), pdPill: $('pdPill'), pdNote: $('pdNote'),
    cmpBack: $('cmpBack'), cmpCols: $('cmpCols'), cmpSub: $('cmpSub'), cmpTitle: $('cmpTitle'), cmpClose: $('cmpClose'), cmpFoot: $('cmpFoot'),
    beatNo: $('beatNo'), engineLine: $('engineLine'), nextBeat: $('nextBeat'), nextLabel: $('nextLabel'),
    explainBtn: $('explainBtn'), directorHandle: $('directorHandle'), presses: $('presses'), status: $('status'),
    assertRegion: $('assertRegion'), assertIntent: $('assertIntent'), compareTools: $('compareTools'),
  };

  const state = {
    phones: [], phoneById: new Map(), phonesDoc: null, details: {}, plans: null, plansFx: null,
    display: new Map(), engine: null, catalogName: null,
    anchor: {}, registry: null, manifest: null, engineFx: null, sources: {},
    visitors: {}, who: null,
    view: 'home', phoneId: null, pageKey: null, pageFrom: null, phonesBrand: null,
    ctx: { region: null }, regionSource: 'edge',
    own: null,                            // her own region, as the arrival read it: { key, label, source: edge | override | none }
    home: { previous: null, current: null, set: null, pos: 5, prevDecisions: null, curDecisions: null },
    phone: { previous: null, current: null, set: null },
    rail: { status: 'site', order: null, items: null, off: false },
    beat: null, busy: false, fixtureStep: null, fixtureDone: new Set(), showBefore: false,
    receipts: new Map(), coldstart: null, lastVector: {}, fresh: new Set(),
    capture: null, socket: null, exitArmedAt: 0, exitNote: null, pdProof: null, sheet: null,
  };

  const say = (t, tone) => { el.status.textContent = t; el.status.dataset.tone = tone || ''; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => (typeof n === 'number' ? n : Number(n));
  const money = (n) => (n == null || !Number.isFinite(num(n)) ? '' : `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const money0 = (n) => (n == null || !Number.isFinite(num(n)) ? '' : (num(n) % 1 ? money(n) : `$${num(n).toLocaleString('en-US')}`));
  const trunc2 = (n) => Math.floor(n * 100 + 1e-6) / 100;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt3 = (n) => (Number.isFinite(num(n)) ? num(n).toFixed(3) : '—');
  const fmt2 = (n) => (Number.isFinite(num(n)) ? num(n).toFixed(2) : '—');
  const hhmm = (t) => new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const sdkKey = ((document.querySelector('meta[name="edge-sdk-key"]') || {}).content) || 'demo-site';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : String(Date.now()) + Math.random().toString(16).slice(2));
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

  // ════════════════════════════════════════════════════════════════════════
  // CONTENT. Lane L1's files first; the page names what it fell back to.
  // ════════════════════════════════════════════════════════════════════════
  async function tryJson(url) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return null;
      const type = r.headers.get('content-type') || '';
      if (type && !/json/.test(type)) return null;          // a static host's HTML fallback is not a document
      return await r.json();
    } catch { return null; }
  }
  async function firstJson(label, urls) {
    for (const url of urls) {
      const doc = await tryJson(url);
      if (doc) { state.sources[label] = url.replace('/vantage/', ''); return doc; }
    }
    state.sources[label] = 'missing';
    return null;
  }
  /** A beat file wraps the engine document it publishes: { name, kind: 'publish', publish: { kind, document } }. */
  const unwrap = (doc) => (doc && doc.publish && doc.publish.document ? doc.publish.document : doc);

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

  // ════════════════════════════════════════════════════════════════════════
  // TRANSPORT. Exactly the Top Offers pattern: direct routes, X-SDK-Key,
  // X-Tenant, and the shopper capability on every shopper call.
  // ════════════════════════════════════════════════════════════════════════
  const cur = () => (state.who ? state.visitors[state.who] : null);
  async function api(path, payload, opts = {}) {
    if (FIXTURE) return fixtureApi(path, payload, opts);
    const v = Object.prototype.hasOwnProperty.call(opts, 'visitor') ? opts.visitor : cur();
    const headers = { 'X-SDK-Key': sdkKey, 'Content-Type': 'application/json', 'X-Tenant': TENANT };
    if (v && v.session) headers['X-Shopper-Session'] = v.session.capability;
    try {
      const res = await fetch(path, { method: payload === undefined ? 'GET' : 'POST', headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
    } catch (error) {
      return { status: 0, ok: false, body: { error: String((error && error.message) || error) } };
    }
  }
  /** The demo route: a named beat, applied by the worker. No document crosses from the page. */
  async function demoRoute(path, body) {
    if (FIXTURE) { await sleep(120); return { ok: true }; }
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT }, body: JSON.stringify(body || {}) })
      .catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || out.ok !== true) {
      // The route's own answer rides on the error, so a named refusal (the report's 413) can be shown as itself.
      const error = new Error((out && out.error) || `${path} failed (${res.status})`);
      error.status = res.status; error.body = out;
      throw error;
    }
    return out;
  }
  const applyBeat = (kind, name, note) => {
    if (!name) throw new Error(`no ${kind} document is named for this beat`);
    return demoRoute(API.beat, { kind, name, note });
  };
  async function resetTenant() {
    try { return await demoRoute(API.reset, {}); } catch (error) {
      if (!/404|Not Found/i.test(String(error.message))) throw error;
      await applyBeat('slots', beatName('open', 'slots'), 'the opening slots');
      return applyBeat('catalog', beatName('open', 'catalog'), 'the opening pool');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // VISITORS. Session first, then her explicit consent, as Top Offers.
  // ════════════════════════════════════════════════════════════════════════
  /** The landing's arrival signals: exactly the fields the engine's entry contract names. */
  function landingEntry(params) {
    const q = params || new URLSearchParams(location.search);
    const entry = {};
    const source = q.get('utm_source'), medium = q.get('utm_medium'), term = q.get('utm_term');
    if (source) entry.utmSource = source.slice(0, 256);
    if (medium) entry.utmMedium = medium.slice(0, 128);
    if (term) entry.utmTerm = term.slice(0, 256);
    const referrer = (params && params.get('referrer')) || document.referrer || '';
    if (referrer) { entry.referrer = referrer; entry.siteHost = location.host; }
    return entry;
  }
  const directEntry = () => ({});
  /** Snapshot URLs carry a host-only referrer, never a path or query (src/services/visit.ts snapshotEntry). */
  function snapshotEntry(entry) {
    if (!entry || !Object.keys(entry).length) return null;
    const out = { ...entry };
    if (out.referrer) { try { out.referrer = new URL(out.referrer).hostname; } catch { out.referrer = ''; } }
    return JSON.stringify(out);
  }
  const defaultIntent = () => ((state.anchor.ctx && state.anchor.ctx.intent && state.anchor.ctx.intent.default) || 'new');

  async function mintVisitor(key, entry, label) {
    const { status, body } = await api(`/v1/${TENANT}/identity/session`, {}, { visitor: null });
    if (!body || !body.session) throw new Error(`the engine did not mint a shopper session (${status}${body && body.error ? `: ${body.error}` : ''})`);
    const s = body.session;
    const v = { key, label: label || `Shopper ${key}`, session: s, entry, journey: [], lines: 1, plan: null, intent: defaultIntent(),
      config: null, lastHomeLead: null, homeSet: null, phoneSet: null, vector: {}, cart: 0 };
    const { body: pref } = await api('/realtime/session/preferences', {
      userId: s.subject, trackingConsent: true, personalizationEnabled: true,
      choice: { id: uid(), expectedRevision: null, grantId: s.grantId, iat: s.iat, exp: s.exp },
    }, { visitor: v });
    if (!pref || !pref.consent || !pref.consent.personalization) throw new Error('the visitor did not grant consent');
    state.visitors[key] = v;
    return v;
  }
  function useVisitor(key) {
    state.who = key;
    const v = cur();
    state.lastVector = (v && v.vector) || {};
    renderWho();
    renderJourney();
  }
  /** Any press or any hand on the page mints a visitor if none exists: nothing waits on beat 1. */
  async function ensureVisitor() {
    if (cur()) return cur();
    const v = await mintVisitor('A', landingEntry());
    useVisitor('A');
    note('arrived', 'A new visitor', `anonymous · consent granted · ${describeEntry(v.entry)}`);
    return v;
  }
  function describeEntry(entry) {
    if (!entry || (!entry.utmMedium && !entry.utmSource && !entry.utmTerm && !entry.referrer)) return 'arrived direct';
    return [entry.utmMedium, entry.utmSource, entry.utmTerm && `term “${entry.utmTerm}”`].filter(Boolean).join(' · ');
  }

  // ── The events. Sent BECAUSE a real control ran. ─────────────────────────
  function send(type, data, v = cur()) {
    if (!v) return Promise.resolve(null);
    return api('/realtime/action', { userId: v.session.subject, sessionId: v.session.sessionId, source: SOURCE, type, data,
      ...(v.entry && Object.keys(v.entry).length ? { entry: v.entry } : {}) }, { visitor: v });
  }
  /**
   * A selector, a compare, a filter or a start: a custom event, named by its
   * event field (the engine reads it to weigh the touch) with the control that
   * sent it. The shapes are lane L1's beat documents, as measured.
   */
  const sendCustom = (event, data, v) => send('custom', { event, ...data }, v);
  const linesWord = (n) => (n >= 3 ? 'family' : n === 2 ? 'duo' : 'solo');

  // ── This session, written down as it happens ─────────────────────────────
  function note(verb, what, detail, v = cur()) {
    if (!v) return;
    v.journey.push({ verb, what, detail, at: Date.now() });
    if (v === cur()) renderJourney();
  }
  function renderJourney() {
    const v = cur();
    if (!v || !v.journey.length) { el.journey.innerHTML = '<li class="journey-empty">Nobody has arrived yet.</li>'; return; }
    const cls = (verb) => (['published', 'tuned', 'asserted'].includes(verb) ? ' verb--merch' : verb === 'engine' ? ' verb--engine' : verb === 'opened' ? ' verb--open' : '');
    el.journey.innerHTML = v.journey.map((j, i) => `<li${i === v.journey.length - 1 ? ' class="fresh"' : ''}>
      <span class="verb${cls(j.verb)}">${esc(j.verb)}</span>
      <span class="what">${esc(j.what)}${j.detail ? `<em>${esc(j.detail)}</em>` : ''}</span></li>`).join('');
    const panels = el.journey.closest('.mpanels');
    if (panels && !el.journey.parentElement.hidden) panels.scrollTop = panels.scrollHeight;
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE QUESTION. One snapshot per page view; the page renders what it says.
  // ════════════════════════════════════════════════════════════════════════
  async function ask(pageKey, v = cur()) {
    const q = new URLSearchParams({ page: PAGES[pageKey] || pageKey });
    const entry = snapshotEntry(v && v.entry);
    if (entry) q.set('entry', entry);
    if (state.ctx.region) q.set('ctx.region', state.ctx.region);
    q.set('ctx.intent', (v && v.intent) || defaultIntent());   // always asserted: gated offers fail closed without it
    const r = await api(`/v1/${TENANT}/decisions/snapshot?${q}`, undefined, { visitor: v });
    if (!r.ok || !r.body || !Array.isArray(r.body.decisions)) {
      return { ok: false, status: r.status, error: (r.body && r.body.error) || `the decision service answered ${r.status || 'nothing'}` };
    }
    return { ok: true, set: { ...r.body, asked: { intent: q.get('ctx.intent'), region: q.get('ctx.region') } } };
  }
  const bySlot = (set, slot) => ((set && set.decisions) || []).filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);

  function renderWho() {
    const v = cur();
    el.whoChip.textContent = v ? `${v.label} · anonymous · consent on` : 'No visitor yet';
    el.whoChip.classList.toggle('who--b', Boolean(v && v.key !== 'A'));
    const set = state.view === 'phone' ? state.phone.set : state.home.set;
    if (set && set.arm) {
      el.armChip.hidden = false;
      el.armChip.textContent = `arm ${set.arm}`;
      el.armChip.classList.toggle('arm--default', set.arm !== 'personalized');
      el.armChip.title = set.arm === 'personalized' ? 'Served decisions.' : 'The holdout: the site default for this shopper.';
    } else el.armChip.hidden = true;
    const own = state.own;
    const chips = [state.ctx.region
      ? `<span title="${state.regionSource === 'rehearsal override' ? 'A rehearsal override (?region=): asserted on the request, labelled' : 'Asserted on the request, labelled: not observed'}">region <b>${esc(state.ctx.region)}</b> · ${esc(state.regionSource)}</span>`
      : own && own.key
        ? `<span title="${LOCAL_RUNTIME ? 'From the request, as the local runtime fills request.cf' : 'From the request: the edge located her, nothing asserted'}">region <b>${esc(own.key)}</b> · from the request</span>`
        : `<span title="Nothing asserted: the region comes from the request when it carries one">region <b>${own ? 'none on this request' : 'from the request'}</b></span>`];
    if (v && v.intent) chips.push(`<span title="Asserted, as her account would; it gates offers and never prices">intent <b>${esc(v.intent)}</b> · asserted</span>`);
    if (v && v.stage) chips.push(`<span title="The journey stage the engine reads from her profile">stage <b>${esc(v.stage)}</b></span>`);
    el.ctxChips.innerHTML = chips.join('');
    renderAsserts();
  }

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
  const scrollTop = () => { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* optional */ } };
  function focusOn(node, block) {
    if (!node) return;
    try { node.scrollIntoView({ behavior: 'smooth', block: block || 'start' }); } catch { /* optional */ }
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
    const sayAfter = () => { const b = state.lineBeat; const said = b && b.after ? b.after() : null; if (said) el.engineLine.innerHTML = said; };
    sayAfter();
    await Promise.all([sortRail(), renderVectors()]);
    renderPool();
    renderWhy();
    void prefetchReceipts([...hero, ...deals], r.set.asked).then(() => {
      renderDealsChanges(); renderWhy(); refreshReceiptLines(); renderPool();
      sayAfter();
    });
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

  /** Off the homepage the four have not been asked again, and the strip says so rather than keep a stale line. */
  function renderPending(where) {
    const top = topSignal();
    el.dealsDeltas.innerHTML = `<li class="delta-none">${esc(where)}: the homepage has not been asked again yet.${top
      ? ` Her strongest signal is <b>${esc(top.value)}</b> (${esc(DIM_LABEL[top.dim] || top.dim)}) at <b>${fmt2(top.a)}</b>, ${top.a >= thetaIn()
        ? `past the ${fmt2(thetaIn())} entry threshold.` : `under the ${fmt2(thetaIn())} entry threshold.`}` : ''}</li>`;
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
  /**
   * The arrival seeds a receipt records (`explain.contextual`), named for what
   * fired. `applied` is what they moved the score together, measured where it
   * lands. On a phone the platform seed fires beside the campaign, so a single
   * name carries that total only when that seed alone contributed; otherwise the
   * total is "seeds" and each one is listed (R1 N6).
   */
  const SEED_NAME = { campaign_term: 'campaign', platform: 'platform', entry_channel: 'channel', referrer_network: 'referrer' };
  function seedsFired(c) {
    const by = new Map();
    for (const x of arr(c && c.drivers)) {
      const k = SEED_NAME[x.signal] || String(x.signal || 'seed').replace(/_/g, ' ');
      by.set(k, (by.get(k) || 0) + num(x.contribution));
    }
    return [...by].filter(([, v]) => v > 0);
  }
  /** `campaign +0.066` on a desktop; `seeds +0.231 (campaign · platform)` when both fired. Plain text; `bold` wraps the figure. */
  function seedLabel(c, bold) {
    const fired = seedsFired(c), figure = bold ? `<b>+${fmt3(c.applied)}</b>` : `+${fmt3(c.applied)}`;
    return fired.length === 1 ? `${fired[0][0]} ${figure}` : `seeds ${figure}${fired.length ? ` (${fired.map(([k]) => k).join(' · ')})` : ''}`;
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
  const OWN = (x) => !['regional', 'merchandising', 'stage', 'freshness', 'fatigue', 'external'].includes(x.dim);
  /** An intent she gave with the buy-box toggle is declared, not observed: the receipt line says so. */
  const declaredMark = (x) => (x && x.dim === 'intent' && cur() && cur().declared && cur().declared.has(x.value) ? ' (declared)' : '');
  function driverSummary(d, n) {
    const drivers = (d.explain && d.explain.drivers) || [];
    const own = drivers.filter(OWN).sort((a, b) => num(b.a) * num(b.weight) - num(a.a) * num(a.weight)).slice(0, n).map((x) => `${esc(DIM_LABEL[x.dim] || x.dim)} ${esc(x.value)}${declaredMark(x)}`);
    const r = drivers.find((x) => x.dim === 'regional');
    const merch = drivers.find((x) => x.dim === 'merchandising');
    return [...own, ...(r ? [`region ${esc(r.value)}`] : []), ...(merch ? ['promotion weight'] : [])].join(' · ');
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
  function renderDeals(decisions, site) {
    const previousOrder = (state.home.current || []).map((c) => c.id);
    const after = decisions.map(dealView);
    if (!site) {
      state.home.previous = state.home.current; state.home.current = after;
      state.home.prevDecisions = state.home.curDecisions; state.home.curDecisions = decisions;
    }
    const moves = {};
    const prev = state.home.previous;
    if (prev && !site) {
      const ids = prev.map((b) => b.id);
      after.forEach((a, i) => {
        const was = ids.indexOf(a.id);
        if (decisions[i].strategy === 'tenant-pinned' && was !== i) moves[a.id] = { cls: 'pin', text: 'pinned' };
        else if (was === -1) moves[a.id] = { cls: 'in', text: 'new' };
        else if (prev[was].title !== a.title || prev[was].art !== a.art) moves[a.id] = { cls: 'swap', text: 'new creative' };
        else if (was > i) moves[a.id] = { cls: 'up', text: `↑${was - i}` };
        else if (was < i) moves[a.id] = { cls: 'down', text: `↓${i - was}` };
      });
    }
    el.deals.setAttribute('aria-busy', 'false');
    el.deals.dataset.take = String(decisions.length || 4);
    el.deals.innerHTML = decisions.map((d, i) => dealCardHtml(d, i, { moves, entered: (j, x) => !site && previousOrder[j] !== x.customerContentId })).join('')
      || '<p class="fine">The slot returned nothing, and the page shows nothing rather than invent a module.</p>';
    if (!site) renderDealsChanges();
    renderBeforeRow();
  }
  function dealsDiff(before, after) {
    if (!before) return [{ sign: '·', cls: 'in', what: 'The opening four', why: 'the first decision this visitor was served' }];
    const out = [];
    const beforeIds = before.map((b) => b.id), afterIds = after.map((a) => a.id);
    const now = Date.now();
    // Why a piece left, read off the engine: its window, or the receipt's own candidate list. The page tests no rule.
    const cands = dealCandidates();
    const wentWhy = (id) => {
      const p = pieceOf(id);
      if (!p) return 'left the pool entirely';
      if (p.window && p.window.to && Date.parse(p.window.to) <= now) return 'its window closed';
      if (!cands) return 'out of the four';
      if (cands.has(p.id)) return 'still a candidate, outranked';
      return p.eligibleWhen ? 'not a candidate for this request: it has a rule' : 'not a candidate for this request';
    };
    before.forEach((b, i) => { if (!afterIds.includes(b.id)) out.push({ sign: '−', cls: 'out', what: b.title, why: `left container ${i + 1} · ${wentWhy(b.id)}` }); });
    after.forEach((a, i) => {
      const was = beforeIds.indexOf(a.id);
      if (was === -1) { out.push({ sign: '+', cls: 'in', what: a.title, why: `entered at container ${i + 1}` }); return; }
      if (before[was].title !== a.title || before[was].art !== a.art) out.push({ sign: '⟳', cls: 'swap', what: a.title, why: 'same content id, new creative' });
      if (was > i) out.push({ sign: '↑', cls: 'up', what: a.title, why: `container ${was + 1} → ${i + 1}` });
      else if (was < i) out.push({ sign: '↓', cls: 'down', what: a.title, why: `container ${was + 1} → ${i + 1}` });
    });
    return out;
  }
  /**
   * The hinge, read off the receipts rather than asserted: a piece the campaign
   * lifted was overtaken by pieces her own behaviour carries. The words appear
   * only when the receipts say so.
   */
  function hingeLine() {
    const set = state.home.set;
    const before = state.home.previous, after = state.home.current;
    if (!set || !before || !after) return null;
    const decisions = bySlot(set, SLOTS.deals);
    const seeded = [...(state.home.prevDecisions || []), ...decisions].find((d) => {
      const rec = d.decisionId && state.receipts.get(d.decisionId);
      return rec && rec.explain && rec.explain.contextual && num(rec.explain.contextual.applied) > 0;
    });
    if (!seeded) return null;
    const was = before.findIndex((b) => b.id === seeded.customerContentId);
    const now = after.findIndex((a) => a.id === seeded.customerContentId);
    if (was === -1 || (now !== -1 && now <= was)) return null;
    const leader = decisions[0];
    if (!leader || leader.customerContentId === seeded.customerContentId) return null;
    const own = ((leader.explain && leader.explain.drivers) || []).filter(OWN);
    if (!own.length) return null;
    const c = state.receipts.get(seeded.decisionId).explain.contextual;
    const sig = arr(c.drivers).find((x) => x.signal === 'campaign_term') || arr(c.drivers)[0];
    const dampedDriver = arr(c.drivers).find((x) => x.dampened);
    const damp = dampedDriver ? arr(dampedDriver.dampened)[0] : null;   // the engine lists each applied dampen
    const fired = seedsFired(c);
    const sp = pieceOf(seeded.customerContentId), lp = pieceOfDecision(leader);
    // "the campaign (+x)" only when the campaign alone contributed; with the platform seed too, the total is the seeds'.
    const led = fired.length > 1 ? `its arrival seeds (+${fmt3(c.applied)}: ${fired.map(([k, v]) => `${esc(k)} +${fmt3(v)} at entry`).join(', ')}`
      : `the campaign (+${fmt3(c.applied)}${sig ? ` from ${esc(String(sig.signal).replace(/_/g, ' '))} “${esc(sig.value)}”` : ''}`;
    return `<li class="delta-hinge"><span class="hk">Campaign context superseded by observed behaviour</span>
      <b>${esc(sp ? sp.title : seeded.customerContentId)}</b> led on ${led}${damp ? `, dampened ×${fmt2(damp.factor)} once she held ${esc(damp.dimension)} ${esc(damp.value)}` : ''}).
      <b>${esc(lp ? lp.title : leader.customerContentId)}</b> now leads on her own browsing: ${own.slice(0, 3).map((x) => `${esc(DIM_LABEL[x.dim] || x.dim)} ${esc(x.value)} ${fmt2(x.a)} × ${x.weight}`).join(', ')}.</li>`;
  }
  function renderDealsChanges() {
    const before = state.home.previous, after = state.home.current || [];
    el.dealsGhosts.innerHTML = before && before.length
      ? before.map((b, i) => `<span class="ghost"><span class="gart">${b.art ? `<img src="${esc(b.art)}" alt="" data-ph="">` : ''}</span><span class="gn">${i + 1}</span></span>`).join('')
        + `<span class="ghost-hint">${state.showBefore ? 'Hide the before row' : 'Show it full size, above'}</span>`
      : '<span class="ghost-empty">The visitor had not seen the module yet.</span>';
    const rows = dealsDiff(before, after);
    const hinge = hingeLine();
    const exit = state.exitNote ? `<li class="delta-engine"><span class="hk">The engine, on its own</span>${state.exitNote}</li>` : '';
    if (!rows.length) {
      // The order held: say what the answer did to each score, so a withdrawal that moves nothing is still read off the engine.
      const was = new Map((state.home.prevDecisions || []).map((d) => [d.customerContentId, num(d.score)]));
      const held = (state.home.curDecisions || []).filter((d) => was.has(d.customerContentId) && Math.abs(num(d.score) - was.get(d.customerContentId)) >= 0.01)
        .map((d, i) => `<li><span class="sign sign--${num(d.score) < was.get(d.customerContentId) ? 'down' : 'up'}">${num(d.score) < was.get(d.customerContentId) ? '↘' : '↗'}</span>
          <span><b>${esc((pieceOfDecision(d) || {}).title || d.customerContentId)}</b> <em>held container ${bySlot(state.home.set, SLOTS.deals).indexOf(d) + 1} · score ${fmt3(was.get(d.customerContentId))} → ${fmt3(d.score)}${(() => {
            const d0 = (state.home.prevDecisions || []).find((x) => x.customerContentId === d.customerContentId);
            const shift = d0 ? driverShift(d0, d) : '';
            return shift ? ` · ${shift}` : '';
          })()}</em></span></li>`);
      if (held.length) { el.dealsDeltas.innerHTML = exit + (hinge || '') + '<li class="delta-none">The order held; the scores moved.</li>' + held.join(''); return; }
      const top = topSignal();
      el.dealsDeltas.innerHTML = exit + (hinge || '') + `<li class="delta-none">Nothing moved in the four.${top
        ? ` Her strongest signal is <b>${esc(top.value)}</b> (${esc(DIM_LABEL[top.dim] || top.dim)}) at <b>${fmt2(top.a)}</b>, ${top.a >= thetaIn()
          ? 'past the entry threshold: what she has earned is already being served.' : `under the ${fmt2(thetaIn())} entry threshold.`}`
        : ' She has sent no signal yet.'}</li>`;
      return;
    }
    el.dealsDeltas.innerHTML = exit + (hinge || '') + rows.map((r) => `<li><span class="sign sign--${r.cls}">${r.sign}</span>
      <span><b>${esc(r.what)}</b> <em>${esc(r.why)}</em></span></li>`).join('');
  }
  function renderBeforeRow() {
    const on = Boolean(state.showBefore && state.home.prevDecisions && state.home.prevDecisions.length);
    el.dealsBeforeRow.hidden = !on;
    el.dealsNowLabel.hidden = !on;
    el.dealsBeforeFour.innerHTML = on ? state.home.prevDecisions.map((d, i) => dealCardHtml(d, i, { before: true })).join('') : '';
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
  async function sortRail() {
    const v = cur();
    if (!v) { state.rail = { ...state.rail, status: 'site', order: null, items: null }; renderRail(); return; }
    const candidates = state.phones.map((p) => ({ id: p.id, brand: p.brand, ecosystem: ecoOf(p), os: ecoOf(p), price_usd: num(p.price_usd) }));
    const r = await api('/sort', { userId: v.session.subject, sessionId: v.session.sessionId, candidates, weights: railWeights() }, { visitor: v });
    const prevOrder = state.rail.order;
    if (!r.ok || !r.body || !Array.isArray(r.body.order)) {
      state.rail = { ...state.rail, status: r.status === 503 ? 'no-capture' : 'down', order: null, items: null, prevOrder, error: (r.body && r.body.error) || String(r.status) };
    } else {
      state.rail = { ...state.rail, status: 'sorted', order: r.body.order, items: r.body.items || [], prevOrder, affinityWeight: r.body.affinityWeight };
    }
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
  const INTENTS = [['new', 'New line'], ['add-line', 'Add a line'], ['upgrade', 'Upgrade'], ['byod', 'Bring your own']];
  const INTENT_WORD = Object.fromEntries(INTENTS);
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
    if (rotate) { state.phone.previous = state.phone.current; state.phone.current = { modules: after, plans: planOrder }; }
    const prev = state.phone.previous;
    if (rotate) {
      const moves = {};
      if (prev) {
        const ids = prev.modules.map((m) => m.id);
        after.forEach((a, i) => {
          const was = ids.indexOf(a.id);
          if (was === -1) moves[a.id] = { cls: 'in', text: 'new' };
          else if (was > i) moves[a.id] = { cls: 'up', text: `↑${was - i}` };
          else if (was < i) moves[a.id] = { cls: 'down', text: `↓${i - was}` };
        });
      }
      state.phone.moves = moves;
    }
    const mv = state.phone.moves || {};
    const total = piecesFor(SLOTS.modules).length || 7;
    el.modulesWhere.innerHTML = `Below the buy box &middot; slot <b>${esc(SLOTS.modules)}</b> &middot; ${mods.length} of ${total}, in the order the engine returned`;
    el.modules.innerHTML = mods.map((d, i) => moduleHtml(d, i, plans, offers, mv[d.customerContentId], rotate && prev && !prev.modules.some((m) => m.id === d.customerContentId))).join('')
      || '<p class="fine">The slot returned no modules, and the page shows none rather than invent an order.</p>';
    if (rotate) renderPdpChanges();
  }
  function renderPdpChanges() {
    const prev = state.phone.previous, now = state.phone.current;
    el.pdpBefore.innerHTML = prev && prev.modules.length ? prev.modules.map((m) => `<li>${esc(m.title)}</li>`).join('')
      : '<li class="ghost-empty">She had not seen this page’s modules yet.</li>';
    if (!prev) {
      el.pdpDeltas.innerHTML = `<li class="delta-none">The first decision for this page: <b>${esc(now.modules.map((m) => m.title).join(' → '))}</b>. Plans lead with <b>${esc(now.plans[0] || '—')}</b>. ${isTemplate(now.modules) ? 'Nothing she has done weighs on a module yet, so this is the template order.' : 'The order her browsing already earns; <b>Why these</b> explains each one, and <b>Compare → Fresh visitor</b> shows the template order beside it.'}</li>`;
      return;
    }
    const rows = [];
    const ids = prev.modules.map((m) => m.id);
    now.modules.forEach((m, i) => {
      const was = ids.indexOf(m.id);
      if (was === -1) rows.push({ sign: '+', cls: 'in', what: m.title, why: `entered at position ${i + 1}` });
      else if (was > i) rows.push({ sign: '↑', cls: 'up', what: m.title, why: `position ${was + 1} → ${i + 1}` });
      else if (was < i) rows.push({ sign: '↓', cls: 'down', what: m.title, why: `position ${was + 1} → ${i + 1}` });
    });
    prev.modules.forEach((m) => { if (!now.modules.some((x) => x.id === m.id)) rows.push({ sign: '−', cls: 'out', what: m.title, why: 'left the page · outranked, or its rule stopped holding' }); });
    if (prev.plans[0] !== now.plans[0] && now.plans[0]) rows.push({ sign: '↑', cls: 'up', what: now.plans[0], why: `now leads Pair with a plan (was ${prev.plans[0] || '—'})` });
    el.pdpDeltas.innerHTML = rows.length ? rows.map((r) => `<li><span class="sign sign--${r.cls}">${r.sign}</span><span><b>${esc(r.what)}</b> <em>${esc(r.why)}</em></span></li>`).join('')
      : '<li class="delta-none">Nothing moved on this page: the same modules in the same order, the same plan leading.</li>';
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
  function openSheet(kind, html) {
    state.sheet = { kind, from: state.view };
    el.sheetBody.innerHTML = html;
    el.sheetBack.hidden = false;
  }
  /** Back on the phone page after an interaction, the page asks again, as the SDK refreshes after an acknowledged interaction. */
  async function closeSheet() {
    if (el.sheetBack.hidden) return;
    const was = state.sheet;
    el.sheetBack.hidden = true;
    state.sheet = null;
    if (was && was.from === 'phone' && state.view === 'phone') await refreshPhone();
  }
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
  /** A click inside a decided container is the reward it is judged on; nested containers credit each level, as nested data-op-content would. */
  async function creditDecided(target) {
    if (!cur() || !target || !target.closest) return 0;
    let node = target.closest('[data-op-content]');
    const sends = [];
    while (node) {
      const decisionId = node.getAttribute('data-op-decision-id');
      if (decisionId) sends.push(send('content_click', { contentId: node.getAttribute('data-op-content'), slot: node.getAttribute('data-op-slot'), decisionId, customerContentId: node.getAttribute('data-cid') }));
      node = node.parentElement ? node.parentElement.closest('[data-op-content]') : null;
    }
    if (sends.length) await Promise.all(sends);
    return sends.length;
  }
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
      if (state.sheet) { el.sheetBack.hidden = true; state.sheet = null; }
      await openPhone(t.dataset.open, { event: !t.dataset.back });   // a back link restores the page; it is not a new view
      return;
    }
    if (t.dataset.quick) { await quickLook(t.dataset.quick); return; }
    if (t.dataset.nav) {
      if (state.sheet) { el.sheetBack.hidden = true; state.sheet = null; }
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
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-act],[data-nav],[data-open],[data-quick],[data-jump]') : null;
    if (!t) return;
    if (t.closest('.director') || t.closest('.machine') || t.closest('.pd-back') || t.closest('.cmp-back') || t.closest('.terms')) return;
    e.preventDefault();
    if (state.busy) { say('a beat is running; the page is frozen until it lands', 'bad'); return; }
    void handleControl(t).catch((error) => say(String(error.message || error), 'bad'));
  });
  el.sheetBack.addEventListener('click', (e) => { if (e.target === el.sheetBack && !state.busy) void closeSheet(); });
  el.sheetClose.addEventListener('click', () => { if (!state.busy) void closeSheet(); });
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
  el.dealsGhosts.addEventListener('click', () => { state.showBefore = !state.showBefore; renderBeforeRow(); renderDealsChanges(); });

  // ════════════════════════════════════════════════════════════════════════
  // THE MACHINE: meters, cold start, why these, what it learned, roadmap.
  // ════════════════════════════════════════════════════════════════════════
  const reg = () => state.registry || {};
  const thetaIn = () => num(reg().thetaIn != null ? reg().thetaIn : 0.6);
  const thetaOut = () => num(reg().thetaOut != null ? reg().thetaOut : 0.45);
  const K = () => num(reg().K != null ? reg().K : 1.8);
  const DIM_LABEL = { category: 'category', brand: 'brand', ecosystem: 'ecosystem', os: 'ecosystem', priceBand: 'price band', intent: 'intent', perk: 'perk', lines: 'lines', contentType: 'content' };
  const leanShare = () => { const l = state.coldstart && state.coldstart.lean; return (l && (l.share || l.shares)) || {}; };

  async function renderVectors() {
    const v = cur();
    if (!v) { el.vectors.innerHTML = '<p class="m-empty">No dimension has evidence yet.</p>'; return; }
    const { body } = await api('/realtime/reflex', undefined, { visitor: v });
    const dims = (body && body.affinity && body.affinity.dims) || {};
    if (body && body.journeyStage && body.journeyStage !== v.stage) { v.stage = body.journeyStage; if (v === cur()) renderWho(); }
    const prev = v.vector || {};
    const rows = [];
    for (const [dim, values] of Object.entries(dims)) for (const [value, a] of Object.entries(values || {})) rows.push({ dim, value, a: num(a) || 0 });
    state.fresh = new Set(rows.filter((r) => Math.abs(r.a - num(((prev[r.dim] || {})[r.value]) || 0)) > 0.004).map((r) => `${r.dim}\u0000${r.value}`));
    v.vector = dims;
    if (v === cur()) state.lastVector = dims;
    rows.sort((x, y) => y.a - x.a);
    const lean = leanShare();
    const leanOf = (dim, value) => { const d = lean[dim] || {}; return typeof d[value] === 'number' ? d[value] : null; };
    const th = thetaIn();
    el.vectors.innerHTML = rows.length ? rows.slice(0, 8).map((r) => {
      const l = leanOf(r.dim, r.value);
      return `<div class="vecrow${state.fresh.has(`${r.dim}\u0000${r.value}`) ? ' vecrow--fresh' : ''}">
        <div class="vectop"><span>${esc(r.value)}<em>${esc(DIM_LABEL[r.dim] || r.dim)}${roomOf(r.dim) ? ` · ${esc(roomOf(r.dim))} memory` : ''}</em></span><b class="${r.a >= th ? 'over' : ''}">${r.a.toFixed(2)}</b></div>
        <div class="track"><span class="fill${r.a >= th ? ' fill--over' : ''}" style="width:${Math.min(100, r.a * 100)}%"></span>
          <span class="thresh" style="left:${th * 100}%"></span>${l !== null ? `<span class="lean" style="left:${Math.min(100, l * 100)}%" title="the region’s lean: ${Math.round(l * 100)}%"></span>` : ''}</div></div>`;
    }).join('') : '<p class="m-empty">No evidence of her own yet. The first paint is the region and the campaign, not her.</p>';
    const reg0 = state.home.set && bySlot(state.home.set, SLOTS.deals).map((d) => ((d.explain && d.explain.drivers) || []).find((x) => x.dim === 'regional')).find(Boolean);
    el.priorLine.innerHTML = reg0
      ? `The region (${esc(reg0.value)}) speaks for <b>λ = ${fmt2(reg0.a)}</b> of the blend, λ = K / (K + Σa): it gives way as her own evidence grows. Hollow marks: the region’s lean. Green tick: the ${fmt2(th)} entry threshold.`
      : `a = R / (R + K) with K = ${K()}, from the published registry. Green tick: the ${fmt2(th)} entry threshold; hollow marks: the region’s lean.`;
    const mem = memoryLine();
    if (mem) el.priorLine.insertAdjacentHTML('beforeend', `<span class="memline">${mem}</span>`);
  }
  /** The registry's per-dimension memory, as lane L1 labels it: compressed for this room, days in production. */
  const memoryDims = () => (((state.anchor.registry || {}).memory || {}).dimensions || []).filter((d) => d.compressed);
  const roomOf = (dim) => { const d = memoryDims().find((x) => x.key === dim); return d ? d.room : null; };
  function memoryLine() {
    const dims = memoryDims();
    if (!dims.length) return '';
    const byRoom = new Map();
    dims.forEach((d) => byRoom.set(d.room, [...(byRoom.get(d.room) || []), DIM_LABEL[d.key] || d.key]));
    const parts = [...byRoom.entries()].map(([room, names]) => `${names.join(', ')} ${room}`);
    return ` Memory is <b>compressed for this room</b> (${esc(parts.join('; '))}); production runs days.`;
  }
  function topSignal() {
    let best = null;
    for (const [dim, values] of Object.entries(state.lastVector || {})) for (const [value, a] of Object.entries(values || {})) {
      if (!best || num(a) > best.a) best = { dim, value, a: num(a) };
    }
    return best;
  }

  /** The label the region wears on the page: the census row's own name when the grain is a state. */
  function coldLabel() {
    const c = state.coldstart;
    if (!c) return null;
    const cen = c.census || {};
    if (cen.label && cen.grain !== 'national') return cen.label;
    const r = c.region || {};
    return r.label || r.city || regionName(r.key) || r.key || null;
  }
  /** A region key's name as lane L1's anchor gives it (rehearsed and uncovered regions), else the key itself. */
  function regionName(key) {
    const R = state.anchor.regions || {};
    const hit = [...arr(R.rehearsed), R.uncoveredRegion].find((x) => x && x.key === key);
    return hit ? hit.label : null;
  }
  /**
   * The Arrival panel's read. A region goes on the query only when one is asserted (beat 2's contrast,
   * 14a/14b, the hand's assert buttons, or the ?region= rehearsal override); otherwise the route reads the
   * region the edge put on the request, and the page records that as her own.
   */
  async function loadColdStart() {
    const q = new URLSearchParams();
    if (state.ctx.region) q.set('region', state.ctx.region);
    if (OVERRIDE.metro) q.set('metro', OVERRIDE.metro);
    let doc = null, why = null;
    if (!FIXTURE) {
      const r = await api(`${API.coldstart}${q.toString() ? `?${q}` : ''}`, undefined, { visitor: cur() });
      doc = r.ok && r.body && r.body.ok !== false ? r.body : null;
      if (!doc) why = `The cold-start read did not answer (${r.status}); lane L2’s labelled fixture is shown.`;
    }
    if (!doc) {
      // A fixture never names a place nobody asked for: with nothing asserted it is the no-region fixture.
      const fx = await tryJson(`/vantage/fixtures/coldstart-${state.ctx.region || 'none'}.json`) || await tryJson('/vantage/fixtures/coldstart-none.json');
      if (fx) doc = { ...fx, fixture: why || fx.fixture || 'lane L2 fixture' };
    }
    state.coldstart = doc;
    const r = (doc && doc.region) || {};
    if (doc && !state.ctx.region) state.own = { key: r.source === 'edge' && r.key ? r.key : null, label: r.source === 'edge' && r.key ? coldLabel() : null, source: r.source === 'edge' && r.key ? 'edge' : 'none' };
    else if (doc && OVERRIDE.region && state.ctx.region === OVERRIDE.region) state.own = { key: OVERRIDE.region, label: coldLabel(), source: 'override' };
    renderColdStart();
    renderWho();
    return doc;
  }
  function renderColdStart() {
    const c = state.coldstart;
    if (!c) { el.coldStart.innerHTML = '<p class="m-empty">The cold-start read did not answer, and nothing is shown in its place.</p>'; return; }
    const r = c.region || {}, cen = c.census || {}, lean = c.lean || {};
    const leanInForce = Boolean(c.lean && Object.keys(c.lean.share || c.lean.shares || {}).length);
    const grain = typeof c.grain === 'string' ? c.grain : (c.grain && (c.grain.label || c.grain.used)) || cen.grain || '—';
    // How the region is known: a rehearsal override, asserted, from the request, or not at all.
    const override = Boolean(OVERRIDE.region) && state.ctx.region === OVERRIDE.region;
    const asserted = override || r.source === 'asserted' || Boolean(state.ctx.region);
    const located = !asserted && r.source === 'edge' && Boolean(r.key);
    const src = override ? 'a rehearsal override (?region=), asserted and labelled'
      : asserted ? 'asserted on the request, labelled'
        : located ? (LOCAL_RUNTIME ? 'from the request, as the local runtime fills it' : 'from the request: the edge located her')
          : 'no region on this request';
    // "geo real" only when the edge located her; an asserted region is labelled as asserted, never as real (R1 N8),
    // and under local wrangler dev request.cf is the runtime's stand-in, so it is not called real either.
    const geoTag = asserted ? '<span class="tg tg--rep">region asserted, not observed</span>'
      : located ? (LOCAL_RUNTIME ? '<span class="tg tg--rep">region from the local runtime, not an edge</span>' : '<span class="tg tg--real">geo real</span>')
        : '<span class="tg tg--rep">no region on this request</span>';
    const shares = [];
    for (const [dim, values] of Object.entries(lean.share || lean.shares || {})) for (const [value, s] of Object.entries(values || {})) shares.push({ dim, value, s: num(s) });
    shares.sort((a, b) => b.s - a.s);
    const income = cen.medianHouseholdIncomeUsd != null ? cen.medianHouseholdIncomeUsd : cen.medianHhIncomeUsd;
    const synthetic = /synthetic/i.test(`${lean.dataSource || ''} ${lean.label || ''}`);
    // What the lean counts (seeded sales, plus this worker's own visits from the region) and the grain that
    // answered: doc 13 §4, the roll-up ladder names its grain.
    const seeded = lean.seeded && Number(lean.seeded.units) > 0 ? Number(lean.seeded.units) : 0;
    const live = Number(lean.liveEvents) || 0;
    const counted = !leanInForce || !lean.events ? '' : seeded
      ? `${seeded.toLocaleString('en-US')} synthetic sales${live ? ` + ${live.toLocaleString('en-US')} live events from the region` : ''}`
      : `${Number(lean.events).toLocaleString('en-US')} events`;
    const answered = lean.level === 'region' ? `answered at ${lean.answered}` : lean.level === 'country' ? `rolled up to ${lean.answered}` : lean.level === 'global' ? 'rolled up to everyone' : '';
    el.coldStart.innerHTML = `<div class="cold">
      <div class="cold-row"><span>Region</span><b>${esc([coldLabel(), r.key].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' · ') || 'none on this request')}</b></div>
      <div class="cold-row"><span>How it is known</span><b>${esc(src)}</b></div>
      <div class="cold-row"><span>Grain used</span><b>${esc(grain)}${r.metro ? ` · metro ${esc(r.metro)}` : ''}</b></div>
      ${income != null ? `<div class="cold-row"><span>Median household income</span><b>${money0(income)}</b></div>` : ''}
      ${cen.medianHomeValueUsd != null ? `<div class="cold-row"><span>Median home value</span><b>${money0(cen.medianHomeValueUsd)}</b></div>` : ''}
      <div class="cold-row"><span>Census</span><b>${esc([cen.grain === 'national' ? cen.label : null, cen.estimate || cen.source, cen.vintage && `vintage ${cen.vintage}`].filter(Boolean).join(' · ') || '—')}</b></div>
      ${lean.lambdaForStranger != null ? `<div class="cold-row"><span>The prior’s share for a stranger</span><b>λ = ${fmt2(lean.lambdaForStranger)}</b></div>` : ''}
    </div>
    <p class="cold-h">Regional lean${leanInForce ? ` · relative to each leader · ${esc(lean.label || lean.dataSource || 'representative')}${counted ? ` · ${esc(counted)}` : ''}${answered ? ` · ${esc(answered)}` : ''}` : ''}</p>
    <div class="cold-lean" title="Each value relative to its dimension's leader in the region's sales">${shares.slice(0, 6).map((x) => `<div><span>${esc(x.value)} <em>${esc(DIM_LABEL[x.dim] || x.dim)}</em></span><i><s style="width:${Math.round(Math.min(1, x.s) * 100)}%"></s></i><b>${fmt2(x.s)}</b></div>`).join('') || '<p class="m-empty">No regional lean is in force for this region yet: the prior waits for the carrier’s regional sales, and the page shows none rather than invent one.</p>'}</div>
    ${leanInForce && lean.seeded && lean.seeded.label ? `<p class="m-note" style="margin-top:8px">${esc(lean.seeded.label)}${lean.swapTo ? ` · swaps to the ${esc(lean.swapTo)}` : ''}</p>` : ''}
    ${live && seeded ? `<p class="m-note">Also counted: this worker’s own visits from the region (${live.toLocaleString('en-US')}), on every dimension; the seed writes only brand, ecosystem, price band and category.</p>` : ''}
    ${cen.fellBack ? `<p class="m-note" style="margin-top:8px">${esc(cen.fellBack)}</p>` : ''}
    ${located && LOCAL_RUNTIME ? '<p class="m-note">Local wrangler dev: request.cf is the runtime’s stand-in, not an edge’s reading of this request: Miniflare’s cached copy of Cloudflare’s location for this machine, or a fixed Austin, Texas placeholder when it cannot fetch one. Hosted, the edge locates every request.</p>' : ''}
    ${c.scored && c.scored.sentence ? `<p class="m-note">${esc(c.scored.sentence)}</p>` : ''}
    ${arr(r.notes).map((n) => `<p class="m-note">${esc(n)}</p>`).join('')}
    <p class="cold-sentence">${esc((c.sentence || 'aggregate, never the individual; we curate, never price.').replace(/^./, (x) => x.toUpperCase()))}</p>
    <div class="tags">${geoTag}<span class="tg tg--real">census real · shown, never scored</span><span class="tg tg--rep">${!leanInForce ? 'regional sales: none in force yet' : synthetic ? 'regional sales synthetic → warehouse' : 'regional sales: this worker’s own'}</span>${c.fixture ? '<span class="tg tg--fx">L2 fixture</span>' : ''}</div>
    ${c.fixture ? `<p class="m-note" style="margin-top:8px">${esc(typeof c.fixture === 'string' ? c.fixture : 'lane L2 fixture')}</p>` : ''}`;
  }

  // ── Receipts: the full record behind a decision, from lane L1's receipt action ──
  /**
   * The ledger consumer writes a record a few seconds after the answer, so the
   * route answers 202 and pending until then, and the page asks again. It tells
   * the route what it asserted on that snapshot (intent, region), so the record
   * can say which of its inputs were asserted rather than observed.
   */
  async function prefetchReceipts(decisions, asked) {
    const ids = [...new Set(decisions.map((d) => d.decisionId).filter((id) => id && !state.receipts.has(id)))];
    const context = asked && asked.intent ? { intent: asked.intent, ...(asked.region ? { region: asked.region } : {}) } : undefined;
    const owner = cur();          // the receipts are hers: asked with her capability even if the page has moved on to another shopper
    for (let attempt = 0; attempt < 10 && ids.length; attempt += 1) {
      const batch = ids.slice(0, 12);
      const r = FIXTURE ? fixtureReceipts(batch) : await api(API.receipt, { decisionIds: batch, ...(context ? { context } : {}) }, { visitor: owner });
      const list = (r.body && (r.body.records || r.body.receipts || (r.body.record ? [r.body.record] : r.body.receipt ? [r.body.receipt] : []))) || [];
      list.forEach((rec) => { if (rec && rec.decision_id) state.receipts.set(rec.decision_id, rec); });
      for (let i = ids.length - 1; i >= 0; i -= 1) if (state.receipts.has(ids[i])) ids.splice(i, 1);
      if (!ids.length) break;
      if (!(r.status === 202 || r.status === 200)) break;       // refused or unprovisioned: ask no more
      await sleep(2000);
    }
  }
  function whyRows(decisions) {
    return decisions.map((d, i) => {
      const piece = pieceOfDecision(d);
      const title = d.slot === SLOTS.plans ? ((tierOfDecision(d) || {}).name || d.customerContentId) : d.slot === SLOTS.modules ? moduleTitle(d) : (piece ? piece.title : d.customerContentId);
      const lines = ((d.explain && d.explain.drivers) || []).map((x) => `<span${x.dim === 'regional' ? ' class="reg"' : ''}>${esc(DIM_LABEL[x.dim] || x.dim)} ${esc(x.value)}${declaredMark(x)} <b>${fmt3(num(x.a) * num(x.weight))}</b></span>`);
      const rec = d.decisionId && state.receipts.get(d.decisionId);
      const ex = (rec && rec.explain) || {};
      if (ex.contextual && num(ex.contextual.applied) > 0) {
        lines.push(`<span class="ctx">${esc(seedLabel(ex.contextual))} applied: ${arr(ex.contextual.drivers).map((x) => `${esc(String(x.signal).replace(/_/g, ' '))} “${esc(x.value)}” → ${esc(x.dimension)} ${esc(x.tag)} +${fmt3(x.contribution)} at entry${arr(x.dampened).length ? ` (dampened ${arr(x.dampened).map((m) => `×${fmt2(m.factor)}: she holds ${esc(m.dimension)} ${esc(m.value)}`).join(', ')})` : ''}`).join('; ')}</span>`);
      }
      if (ex.regional) lines.push(`<span class="reg">regional prior ${esc(ex.regional.region)} (${esc(ex.regional.level)}) λ ${fmt2(ex.regional.lambda)} +${fmt3(ex.regional.contribution)}</span>`);
      for (const k of ['merchandising', 'stage', 'freshness', 'fatigue']) if (ex[k] && ex[k].sentence) lines.push(`<span>${esc(ex[k].sentence)}</span>`);
      const div = (ex.diversity && ex.diversity.sentence) || (d.explain && d.explain.diversity && d.explain.diversity.sentence);
      if (div) lines.push(`<span>${esc(div)}</span>`);
      if (d.explain && d.explain.note) lines.push(`<span>${esc(d.explain.note)}</span>`);
      if (ex.score_base != null) lines.push(`<span>base ${fmt3(ex.score_base)} → final ${fmt3(ex.score_final)}${ex.lift && ex.lift.gamma != null ? ` · γ ${ex.lift.gamma}` : ''}${rec.authority ? ` · authority ${esc(rec.authority)}` : ''}</span>`);
      if (rec && rec.asserted) lines.push(`<span class="asr">asserted, not observed: ${Object.entries(rec.asserted).map(([k, x]) => `${esc(k)} = ${esc(x.value)} (${x.from === 'record' ? 'on the record' : 'as the page asked'})`).join(' · ')}</span>`);
      if (!lines.length) lines.push(d.strategy === 'tenant-pinned' ? 'pinned: ranking never ran for it' : d.strategy === 'site' ? 'the site’s own default: no visitor, no decision' : 'no dimension has evidence yet: the catalog’s order, the same for everyone');
      return `<div class="drv"><div class="drvtop"><span class="pos${d.strategy === 'tenant-pinned' ? ' pos--pin' : ''}">${i + 1}</span><span class="drvname">${esc(title)}</span></div>
        <div class="drvline">${lines.join('<br>')}</div></div>`;
    }).join('');
  }
  function renderWhy() {
    const parts = [];
    const onPhone = state.view === 'phone' && state.phone.set;
    if (onPhone) {
      parts.push(`<p class="why-h">Phone page · slot ${esc(SLOTS.modules)}</p>${whyRows(bySlot(state.phone.set, SLOTS.modules))}`);
      parts.push(`<p class="why-h">Inside Pair with a plan · slot ${esc(SLOTS.plans)}</p>${whyRows(bySlot(state.phone.set, SLOTS.plans))}`);
    } else if (state.home.set) {
      const hinge = hingeLine();
      if (hinge) parts.push(`<div class="hinge">${hinge.replace(/<\/?li[^>]*>/g, '')}</div>`);
      parts.push(`<p class="why-h">Homepage · slot ${esc(SLOTS.hero)}</p>${whyRows(bySlot(state.home.set, SLOTS.hero))}`);
      parts.push(`<p class="why-h">Homepage · slot ${esc(SLOTS.deals)}</p>${whyRows(bySlot(state.home.set, SLOTS.deals))}`);
    }
    el.whyBody.innerHTML = parts.join('') || '<p class="m-empty">Press a beat to begin.</p>';
    const set = onPhone ? state.phone.set : state.home.set;
    const missing = set ? set.decisions.filter((d) => d.decisionId && !state.receipts.has(d.decisionId)).length : 0;
    if (missing) el.whyBody.insertAdjacentHTML('beforeend', `<p class="m-note" style="margin-top:10px">${missing} full receipt${missing === 1 ? ' is' : 's are'} still being written to the ledger (it records just after the answer). Above is the thin receipt the snapshot itself carries.</p>`);
  }

  // ── What it learned: the day report, labelled what it is ─────────────────
  /**
   * The ledger is partitioned by UTC day, and one whole day is the narrowest
   * window the engine builds a report for (it has no slot or hour filter), so the
   * window is the UTC day of the clicks. The build is asked once, with the deals
   * slot; the other slots are read from the day it built, never rebuilt, and only
   * when that answered. A refusal is shown once, as itself (R1 7b-iii).
   */
  async function loadReport(build) {
    const date = new Date().toISOString().slice(0, 10);
    el.reportBody.innerHTML = '<p class="m-empty">Reading the ledger&hellip;</p>';
    const slots = [SLOTS.deals, SLOTS.modules, SLOTS.plans, SLOTS.hero];
    if (FIXTURE) { renderReport(slots.map((slot) => ({ slot, error: 'fixture mode: the report is read from a live ledger only' })), date); return; }
    let lead;
    try { lead = await demoRoute(API.report, { date, slot: SLOTS.deals, build: Boolean(build) }); }
    catch (error) { renderReportRefused(error, date); return; }
    const reports = [{ slot: SLOTS.deals, report: lead.report }];
    for (const slot of slots.slice(1)) {
      try { reports.push({ slot, report: (await demoRoute(API.report, { date, slot })).report }); }
      catch (error) { reports.push({ slot, error: String(error.message || error) }); }
    }
    renderReport(reports, date);
  }
  /** The report's own window, as the report states it: its UTC day, what it was read from, when it was built, what it holds. */
  function reportWindowLine(rep, date) {
    if (!rep) return `<p class="rep-window"><b>Window</b>the UTC day ${esc(date)}</p>`;
    const h = rep.hours || {}, c = rep.counts || {};
    const two = (n) => String(n).padStart(2, '0');
    const built = arr(h.built), missing = arr(h.missing);
    const from = h.source === 'aggregates'
      ? `summed from the folded hours${built.length ? ` ${two(Math.min(...built))}:00–${two(Math.max(...built) + 1)}:00 UTC` : ''}; the hour in progress is not in it until it closes${missing.length ? `, and ${missing.map(two).join(', ')} UTC ${missing.length === 1 ? 'is' : 'are'} not folded yet` : ''}`
      : 'read from the ledger itself: everything recorded until it was built';
    const counts = [c.decisions, c.outcomes, c.visitors].every((n) => typeof n === 'number')
      ? ` · ${c.decisions.toLocaleString('en-US')} decisions, ${c.outcomes.toLocaleString('en-US')} outcomes, ${c.visitors.toLocaleString('en-US')} visitors` : '';
    return `<p class="rep-window"><b>Window</b>the UTC day ${esc(rep.date || date)} · ${from}${rep.builtAt ? ` · built ${esc(hhmm(rep.builtAt))}` : ''}${counts}</p>`;
  }
  /** The build or read was refused: the engine's reason, once, where the report would be. No older count stands in for it. */
  function renderReportRefused(error, date) {
    const b = (error && error.body) || {};
    const head = `<p class="rep-k">Attribution per promotion · the deals four · ${esc(date)}</p>`;
    if (b.code !== 'report_too_large') { el.reportBody.innerHTML = `${head}<p class="m-empty">${esc(String((error && error.message) || error))}</p>`; return; }
    const w = b.window || {};
    const unit = /bytes$/i.test(String(b.budget || '')) ? ' bytes' : '';
    const amount = (n) => (typeof n === 'number' ? `${n.toLocaleString('en-US')}${unit}` : '—');
    el.reportBody.innerHTML = `${reportWindowLine(null, w.date || date)}${head}
      <p class="m-empty rep-refused"><b>Report too large for the window (413).</b> The engine builds a report for one whole ${esc(w.unit || 'UTC day')}, ${esc(w.date || date)}: the narrowest window it accepts. This day’s ledger is past its report budget (${esc(b.budget || 'a budget')}: ${amount(b.observed)} against ${amount(b.limit)}), so it cannot be built on demand, and the page shows no older count in its place.</p>`;
  }
  function reportRows(rep, slot) {
    const grid = (rep && rep.grids && rep.grids[slot] && rep.grids[slot].learning) || null;
    return Object.entries((grid && grid.items) || {}).map(([id, cells]) => {
      const c = cells['*'] || Object.values(cells)[0] || {};
      const piece = pieceOf(id);
      const title = slot === SLOTS.plans ? ((tierById((piece && piece.tier) || String((piece && piece.customerContentId) || id).replace(/^plan[-_]/, '')) || {}).name || (piece && piece.title) || id)
        : slot === SLOTS.modules ? (piece && piece.title) || MODULE_TITLE[String(id).replace(/_/g, '-')] || id : piece ? piece.title : id;
      return { key: String((piece && piece.customerContentId) || id), title, n: num(c.n) || 0, s: num(c.s) || 0, rate: typeof c.p_hat === 'number' ? c.p_hat : null };
    }).sort((a, b) => b.n - a.n);
  }
  function renderReport(reports, date) {
    const label = { [SLOTS.deals]: 'Attribution per promotion · the deals four', [SLOTS.modules]: 'Module engagement · the phone page', [SLOTS.plans]: 'Plan mix · clicks per plan in Pair with a plan', [SLOTS.hero]: 'The hero' };
    let contract = null, measurement = null;
    const blocks = reports.map(({ slot, report, error }) => {
      if (error) return `<p class="rep-k">${esc(label[slot] || slot)}</p><p class="m-empty">${esc(error)}</p>`;
      contract = contract || report.attributionContract || null;
      measurement = measurement || report.measurement || null;
      const rows = reportRows(report, slot);
      const table = rows.length ? `<div class="rep-row rep-head"><span>Item</span><span class="n">shown</span><span class="s">clicks</span><span class="r">est. rate</span></div>`
        + rows.map((r) => `<div class="rep-row"><span class="nm" title="${esc(r.title)}">${esc(r.title)}</span><span class="n">${r.n.toFixed(0)}</span><span class="s">${r.s.toFixed(0)}</span><span class="r">${r.rate === null ? '&mdash;' : `${(r.rate * 100).toFixed(1)}%`}</span></div>`).join('')
        : '<p class="m-empty">Nothing recorded for this slot yet today.</p>';
      let attach = '';
      if (slot === SLOTS.modules && rows.length) {
        const row = (k, name) => { const r = rows.find((x) => x.key.toLowerCase().includes(k)); return r ? `<div class="rep-row"><span class="nm">${esc(name)}</span><span class="n">${r.n.toFixed(0)}</span><span class="s">${r.s.toFixed(0)}</span><span class="r">${r.n ? `${((r.s / r.n) * 100).toFixed(1)}%` : '&mdash;'}</span></div>` : ''; };
        attach = row('protection', 'Protection attach') + row('accessories', 'Accessory attach') + row('home-bundle', 'Bundle mix: home internet') + row('connected-devices', 'Connected-device lines');
        if (attach) attach = `<p class="rep-k">Attach and mix · clicks per exposure</p>${attach}`;
      }
      return `<p class="rep-k">${esc(label[slot] || slot)} · ${esc(report.date || date)}</p>${table}${attach}`;
    }).join('');
    const h = (contract && contract.history) || {};
    const holdout = ((state.anchor.learn || {}).holdout || {}).share;
    const first = (reports.find((r) => r.report) || {}).report || null;
    el.reportBody.innerHTML = `${reportWindowLine(first, date)}${blocks}
      <div class="rep-contract">credit <b>${esc(h.credit || 'last')}</b> touch · match <b>${esc(h.match || 'direct')}</b> · scope <b>${esc(h.scope || 'session')}</b>${holdout != null ? ` · holdout on stage <b>${Math.round(num(holdout) * 100)}%</b>, a setting` : ''}</div>
      <div class="rep-flag"><b>Attribution, not incrementality.</b> The engine labels its own report <code>${esc((measurement && measurement.kind) || 'attribution_diagnostic')}</code> with inference <code>${esc((measurement && measurement.inference) || 'unavailable')}</code>: credited clicks per promotion and per module, never a lift number.</div>
      <p class="rep-theirs">Lines per order, the share of switchers, conversion, revenue per account and churn are read in your warehouse from orders, against a holdout assigned by account so one account’s lines never split. The rows above are what we hand you to run it on.</p>`;
  }
  function renderRoadmap() {
    const items = [
      ['built', 'eligibleWhen { regions, context }', 'The home bundle only where 5G Home is available, and offers that need an answer to “new line, add a line, upgrade or bring your own”. A condition the request does not carry fails closed.'],
      ['built', 'slot seeds', 'The campaign lifts the promotion its utm_term names, as context, never as evidence about her; the receipt itemises it.'],
      ['built', 'learn.regional', 'The carrier’s own regional sales blended by λ = K / (K + Σa), giving way as her evidence grows.'],
      ['built', 'one slot, many modules', 'The phone page’s modules are pieces of one slot; the order the engine returns is the order on the page.'],
      ['built', 'POST /sort', 'The phones rail; at an affinity weight of zero the engine returns the site’s own order exactly.'],
      ['designed', 'the sign-in hand-off', 'At sign-in the session’s signals travel to their own decisioning as context; nothing personal is used before it.'],
      ['designed', 'census as explanation only', 'Shown on the arrival panel, never scored: no neighbourhood figure reaches a price, a plan or financing.'],
    ];
    el.roadmap.innerHTML = items.map(([s, b, t]) => `<li class="${s === 'built' ? 'built' : ''}"><span class="dialflag${s === 'built' ? ' dialflag--built' : ''}">${s}</span><b>${esc(b)}</b><span>${esc(t)}</span></li>`).join('');
  }

  const tabs = Array.from(document.querySelectorAll('.mtabs button'));
  function selectTab(id) {
    tabs.forEach((t) => {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (id === 'tab-why') { renderWhy(); const set = state.view === 'phone' ? state.phone.set : state.home.set; if (set) void prefetchReceipts(set.decisions, set.asked).then(renderWhy); }
  }
  tabs.forEach((t) => t.addEventListener('click', () => selectTab(t.id)));
  el.buildReport.addEventListener('click', () => { void loadReport(true); });

  // ════════════════════════════════════════════════════════════════════════
  // COMPARE: capture, then compare. The Meridian manner, on decided state.
  // ════════════════════════════════════════════════════════════════════════
  function snapshotOfPage() {
    const v = cur();
    const vec = [];
    for (const [dim, values] of Object.entries((v && v.vector) || {})) for (const [value, a] of Object.entries(values || {})) vec.push({ dim, value, a: num(a) });
    vec.sort((a, b) => b.a - a.a);
    const base = { who: v ? v.label : 'no visitor', at: Date.now(), view: state.view, vector: vec.slice(0, 6), intent: v && v.intent, region: regionShown() };
    if (state.view === 'phone' && state.phone.set) {
      const p = phone(state.phoneId);
      return { ...base, where: `${p ? p.name : 'phone'} page`,
        lists: [['Modules, in the order returned', bySlot(state.phone.set, SLOTS.modules).map((d) => ({ id: d.customerContentId, t: moduleTitle(d), s: d.score }))],
          ['Pair with a plan', bySlot(state.phone.set, SLOTS.plans).map((d) => ({ id: d.customerContentId, t: (tierOfDecision(d) || {}).name || d.customerContentId, s: d.score }))]] };
    }
    return { ...base, where: 'homepage',
      lists: [['Hero', bySlot(state.home.set, SLOTS.hero).map((d) => ({ id: d.customerContentId, t: (pieceOfDecision(d) || {}).title || d.customerContentId, s: d.score }))],
        ['The deals four', bySlot(state.home.set, SLOTS.deals).map((d) => ({ id: d.customerContentId, t: (pieceOfDecision(d) || {}).title || d.customerContentId, s: d.score }))],
        ['Phones for you', (state.rail.order || state.phones.map((p) => p.id)).slice(0, railTake()).map((id) => ({ id, t: (phone(id) || {}).name || id, s: null }))]] };
  }
  function capture() {
    state.capture = snapshotOfPage();
    el.compareBtn.disabled = false;
    el.captureNote.textContent = `Captured ${state.capture.who} on the ${state.capture.where} at ${hhmm(state.capture.at)}. Change something, or bring in another shopper, then Compare.`;
    note('captured', `The ${state.capture.where}`, `for Compare · ${hhmm(state.capture.at)}`);
  }
  function openCompare(title, live) {
    if (!state.capture) return;
    const now = live || snapshotOfPage();
    const col = (s, other, k) => `<div class="cmp-col"><p class="ck">${k}</p><h3>${esc(s.who)} · ${esc(s.where)}</h3>
      <p class="cwhen">${esc(hhmm(s.at))}${s.intent ? ` · intent ${esc(s.intent)} (asserted)` : ''}${s.region ? ` · region ${esc(s.region)}` : ''}</p>
      ${s.lists.map(([name, rows], li) => {
        const o = (other.lists[li] || [null, []])[1];
        return `<p class="cmp-sec">${esc(name)}</p><ol class="cmp-list">${rows.map((r, i) => `<li class="${o[i] && o[i].id === r.id ? '' : 'diff'}"><span class="cn">${i + 1}</span><span>${esc(r.t)}</span><span class="cs">${r.s == null ? '' : fmt3(r.s)}</span></li>`).join('') || '<li><span></span><span>nothing returned</span><span></span></li>'}</ol>`;
      }).join('')}
      <p class="cmp-sec">Strongest signals</p><div class="cmp-sig">${s.vector.map((x) => `<div><span>${esc(x.value)} · ${esc(DIM_LABEL[x.dim] || x.dim)}</span><b>${x.a.toFixed(2)}</b></div>`).join('') || '<div><span>none yet</span><b></b></div>'}</div></div>`;
    el.cmpTitle.textContent = title || 'Compare';
    el.cmpSub.textContent = `Captured at ${hhmm(state.capture.at)}, against ${live ? 'the second shopper' : 'now'}. A row in red differs from the other column at the same position.`;
    el.cmpCols.innerHTML = col(state.capture, now, 'Captured') + col(now, state.capture, live ? 'Second shopper' : 'Now');
    el.cmpBack.hidden = false;
  }
  el.captureBtn.addEventListener('click', () => { if (!state.busy) capture(); });
  el.compareBtn.addEventListener('click', () => { if (!state.busy) openCompare(); });
  el.cmpClose.addEventListener('click', () => { el.cmpBack.hidden = true; });
  el.cmpBack.addEventListener('click', (e) => { if (e.target === el.cmpBack) el.cmpBack.hidden = true; });

  /**
   * The streaming shopper, for Compare (a tool, not a beat): capture what the
   * first shopper sees, then a second, direct visitor opens the streaming
   * starter on the phone page, and the two sit side by side. Then back to her.
   */
  async function streamingShopper() {
    if (state.busy) return;
    state.busy = true;
    say('the streaming shopper is browsing…');
    try {
      await ensureVisitor();
      // Her phone-page state too: the second shopper's presses rotate state.phone, and her next press
      // must diff against what SHE last saw, not against his page (R1 7b-i).
      const back = { who: state.who, view: state.view, phoneId: state.phoneId, url: location.pathname + location.search,
        phone: { previous: state.phone.previous, current: state.phone.current, moves: state.phone.moves, set: state.phone.set } };
      capture();                                   // her page as it is now, beside the second shopper
      state.quietRoute = true;                     // his pages take her history entry for the moment; it is handed back below
      const cfg = state.anchor.streamingShopper || {};
      const pid = cfg.phone && phone(cfg.phone) ? cfg.phone : (state.phoneId || focusPhone());
      const plan = String(cfg.plan || 'max').replace(/^plan[-_]/, '');
      const perk = cfg.perk || 'streaming';
      const b = await mintVisitor('B', directEntry(), 'Shopper B');
      useVisitor('B');
      note('arrived', 'A second visitor', 'direct · consent granted · for Compare', b);
      await openPhone(pid);
      const btn = el.modules.querySelector(`[data-perk="${perk}"][data-plan="${plan}"]`) || el.modules.querySelector(`[data-perk="${perk}"]`);
      if (btn) { await performClick(`#modules [data-ctl="${btn.getAttribute('data-ctl')}"]`); await sleep(500); await performClick('#sheetBody [data-ctl="sheet-done"]'); }
      const live = snapshotOfPage();
      useVisitor(back.who);
      const v = cur();
      state.phoneId = back.phoneId;
      Object.assign(state.phone, back.phone);      // her before and now, her move chips, her answer
      state.quietRoute = false;
      try { history.replaceState({ vantage: true }, '', back.url); } catch { /* a sandboxed document has no history */ }   // her address, not his
      if (back.view === 'phone' && v && v.phoneSet) {
        showView('phone'); renderBuyBox(); renderStaticPdp(); state.phone.set = v.phoneSet; renderModules(v.phoneSet, { rotate: false });
        if (state.phone.current) renderPdpChanges();   // the before/now row as she left it, not his
      } else if (v && v.homeSet) { showView('home'); state.home.set = v.homeSet; }
      renderWho(); await renderVectors();
      openCompare('Two shoppers, one phone page, one engine', live);
      el.cmpFoot.textContent = 'Same page, same catalog, same buy box, same public prices. Only what each of them did is different.';
      note('returned', `Back to ${v ? v.label : 'the first shopper'}`, 'her page as she left it · nothing re-asked');
      say('done', 'good');
    } catch (error) { say(String(error.message || error), 'bad'); }
    finally { el.cursor.classList.remove('show'); state.busy = false; state.quietRoute = false; }
  }

  /**
   * A fresh visitor, for Compare: the same phone page asked for someone who has
   * done nothing yet, beside her, so the template order (with the region's
   * prior) sits next to the order her browsing earned. It sends no event.
   */
  async function freshVisitor() {
    if (state.busy) return;
    if (state.view !== 'phone' || !state.phoneId || !cur()) { say('open a phone page first: Compare puts a fresh visitor beside her there', 'bad'); return; }
    state.busy = true;
    say('a fresh visitor is asking…');
    try {
      const back = { who: state.who, phoneId: state.phoneId };
      const p = phone(back.phoneId);
      capture();                                   // her phone page as it is now
      const f = await mintVisitor('F', directEntry(), 'Fresh visitor');
      f.config = { phoneId: p.id, color: defaultColorOf(p), storage: optionsOf(p)[0].storage, term: 36 };
      note('arrived', 'A fresh visitor', 'direct · consent granted · no event sent', f);
      const r = await ask('phone', f);
      if (!r.ok) throw new Error(r.error);
      const live = { who: f.label, at: Date.now(), view: 'phone', vector: [], intent: f.intent, region: regionShown(), where: `${p.name} page`,
        lists: [['Modules, in the order returned', bySlot(r.set, SLOTS.modules).map((d) => ({ id: d.customerContentId, t: moduleTitle(d), s: d.score }))],
          ['Pair with a plan', bySlot(r.set, SLOTS.plans).map((d) => ({ id: d.customerContentId, t: (tierOfDecision(d) || {}).name || d.customerContentId, s: d.score }))]] };
      useVisitor(back.who);
      openCompare('Her phone page, and a fresh visitor’s', live);
      el.cmpFoot.textContent = 'Same phone, same moment, same region. The fresh visitor has sent nothing: the template order, with the region’s prior. The left column is what her browsing earned.';
      say('done', 'good');
    } catch (error) { say(String(error.message || error), 'bad'); } finally { state.busy = false; }
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE EXIT. Behind a flag: the object host's alarm, pushed over the socket.
  // ════════════════════════════════════════════════════════════════════════
  const exitOn = () => (QS.get('exit') === '1') || (QS.get('exit') !== '0' && state.anchor.exitBeat === true);
  function connectSocket(v) {
    if (!exitOn() || FIXTURE || !v || typeof WebSocket === 'undefined') return;
    try { if (state.socket) state.socket.close(); } catch { /* closing */ }
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/realtime/ws?tenant=${TENANT}`;
    const key = btoa(unescape(encodeURIComponent(sdkKey))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    let ws;
    try { ws = new WebSocket(url, ['shopper-session-v1', v.session.capability, `sdk-key-v1.${key}`]); } catch { return; }
    state.socket = ws;
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      const data = (msg && msg.data) || {};
      const exits = arr(data.affinity && data.affinity.changed).filter((c) => c && c.direction === 'exit');
      if (msg.type === 'personalization_update' && (data.source === 'reflex_alarm' || exits.length)) void onEngineExit(exits, v);
    };
    ws.onclose = () => { if (state.heartbeat) clearInterval(state.heartbeat); };
    ws.onopen = () => { state.heartbeat = setInterval(() => { try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* dying */ } }, 25000); };
  }
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
  // THE DIRECTOR'S HAND
  // ════════════════════════════════════════════════════════════════════════
  async function performClick(selector) {
    const target = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!target) throw new Error(`nothing on the page matches ${selector}`);
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* optional */ }
    await sleep(320);
    const r = target.getBoundingClientRect();
    el.cursor.classList.add('show');
    el.cursor.style.left = `${r.left + r.width / 2}px`;
    el.cursor.style.top = `${r.top + Math.min(r.height / 2, 30)}px`;
    await sleep(680);
    el.cursor.classList.remove('click'); void el.cursor.offsetWidth; el.cursor.classList.add('click');
    target.classList.remove('clicked'); void target.offsetWidth; target.classList.add('clicked');
    await sleep(260);
    await handleControl(target);
    await sleep(340);
    target.classList.remove('clicked');
  }
  const ctl = (container, name) => `#${container} [data-ctl="${name}"]`;
  async function clickIf(selector) { if (document.querySelector(selector)) { await performClick(selector); return true; } return false; }
  /** Open a phone the way she would: its card on the rail if it is there, otherwise the grid. */
  async function openPhoneVia(id) {
    if (state.view === 'home' && await clickIf(ctl('rail', `rail-${id}`))) return;
    if (state.view !== 'phones') { await performClick(ctl('mainnav', 'nav-phones')); await sleep(300); }
    await performClick(ctl('phoneGrid', `open-${id}`));
  }
  const goHome = () => performClick('.mast a[data-ctl="home"]');
  /** The cursor goes to a control without running anything: the browser's own Back is not the page's. */
  async function pointAt(node) {
    const r = node.getBoundingClientRect();
    el.cursor.classList.add('show');
    el.cursor.style.left = `${r.left + r.width / 2}px`;
    el.cursor.style.top = `${r.top + Math.min(r.height / 2, 30)}px`;
    await sleep(680);
    el.cursor.classList.remove('click'); void el.cursor.offsetWidth; el.cursor.classList.add('click');
    await sleep(260);
  }
  /**
   * The browser's Back, as she would press it. The page restores the page she
   * left and asks again; a restore from history is not a new view, so it sends
   * no event (a bfcache restore runs no page script either). The chip at the
   * corner stands for the browser's own button while the hand presses it.
   */
  async function browserBack() {
    let chip = $('backChip');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'backChip'; chip.className = 'back-chip';
      chip.innerHTML = '<b>&lsaquo; Back</b><em>the browser’s own button</em>';
      document.body.appendChild(chip);
    }
    chip.hidden = false;
    await pointAt(chip);
    await new Promise((resolve) => {
      const done = () => { window.removeEventListener('popstate', done); resolve(); };
      window.addEventListener('popstate', done);
      setTimeout(done, 1500);
      history.back();
    });
    chip.hidden = true;
    await restoreFromUrl();
  }
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
  /** Back to a phone as she would get there: the browser's Back when that is the page she came from, else its card. */
  const canBackTo = (id) => Boolean(state.view === 'home' && state.backTarget && state.backTarget.id === id);
  async function backToPhone(id) {
    if (canBackTo(id)) { await browserBack(); return; }
    await openPhoneVia(id);
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE BEATS. Lane L1's beat index (beats/anchor.json), one visible change per
  // press: where a design beat touches two surfaces it is two presses (9a/9b,
  // 10a/b/c, 14a/b, 15a/b/c). Shopper beats are performed through the cursor.
  // ════════════════════════════════════════════════════════════════════════
  const ACTS = { 1: 'The arrival', 2: 'The visitor earns it', 3: 'The phone page follows intent', 4: 'The merchandiser’s day', 5: 'Order and metric' };
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
  const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
  /** Content notes carry their sources for the build; the site shows the sentence, never the citation. */
  const customerCopy = (s) => String(s || '').replace(/\s*\([^)]*(?:seen on|\.com\b|brief)[^)]*\)/gi, '').replace(/\s+;/g, ';').trim();
  /** Beat 5's minute, on screen: the page waits, then asks again. It counts nothing for the engine. */
  async function exitTimer(seconds) {
    const end = Date.now() + seconds * 1000;
    focusOn(el.dealsModule);
    while (Date.now() < end) {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      const html = `<li class="delta-timer"><span class="hk">Nobody touches the page</span><span><b class="tmr">${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</b> The page asks again after a minute; the engine’s answer, not the page’s.</span></li>`;
      const node = el.dealsDeltas.querySelector('.delta-timer');
      if (node) node.outerHTML = html; else el.dealsDeltas.insertAdjacentHTML('afterbegin', html);
      say(`the page asks again in ${left} s`);
      await sleep(250);
    }
  }
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
  /** How one decision's own drivers moved between two answers: the largest fall, and what carries it now. */
  function driverShift(d0, d1) {
    const key = (x) => `${x.dim}\u0000${x.value}`;
    const m1 = new Map(((d1.explain && d1.explain.drivers) || []).filter(OWN).map((x) => [key(x), x]));
    const drops = ((d0.explain && d0.explain.drivers) || []).filter(OWN)
      .map((x) => ({ x, b: num(x.a), a: m1.has(key(x)) ? num(m1.get(key(x)).a) : 0 }))
      .filter((r) => r.b - r.a > 0.1).sort((p, q) => (q.b - q.a) - (p.b - p.a));
    const carry = [...m1.values()].sort((p, q) => num(q.a) * num(q.weight) - num(p.a) * num(p.weight))[0];
    return [drops[0] && `${DIM_LABEL[drops[0].x.dim] || drops[0].x.dim} ${drops[0].x.value} ${fmt2(drops[0].b)} → ${fmt2(drops[0].a)}`,
      carry && `${DIM_LABEL[carry.dim] || carry.dim} ${carry.value} carries it`].filter(Boolean).map((s) => esc(s)).join(' · ');
  }
  const regionKey = (x) => (x && typeof x === 'object' ? x.key : x) || null;
  /**
   * Regions (lane F2, 2026-10-01). Her own region leads: the edge locates the request and the page asserts
   * nothing, unless the address bar carries the ?region= rehearsal override (the suites pass US-NY, where
   * lane L1 measured beats 3 to 15). An assertion is for beat 2's contrast and 14a/14b's availability pair:
   * the contrast is Texas unless her own region is Texas, then New York (the anchor's two rehearsed regions);
   * 5G Home is shown in the anchor's covered region (New York) and withdrawn in the uncovered one (Montana).
   */
  const regions = () => {
    const r = state.anchor.regions || {};
    const first = regionKey(r.first) || 'US-NY', second = regionKey(r.second) || 'US-TX';
    return { first, second, covered: regionKey(r.covered) || first, uncovered: regionKey(r.uncoveredRegion) || regionKey(r.uncovered) || 'US-MT' };
  };
  /** Her own region: the rehearsal override when the address bar carries one, else null (nothing asserted: the request's own). */
  const ownRegion = () => OVERRIDE.region || null;
  const ownSource = () => (OVERRIDE.region ? 'rehearsal override' : 'edge');
  const ownName = () => (state.own && (state.own.label || state.own.key)) || (OVERRIDE.region ? regionName(OVERRIDE.region) || OVERRIDE.region : 'her own region');
  /** Beat 2's asserted contrast: the anchor's second rehearsed region (Texas), unless that is her own, then its first (New York). */
  const contrast = () => { const r = regions(); const own = OVERRIDE.region || (state.own && state.own.key) || null; return own === r.second ? r.first : r.second; };
  /** The region a frame was decided in, with how it is known, for Compare's columns. */
  const regionShown = () => (state.ctx.region ? `${state.ctx.region} (${state.regionSource === 'rehearsal override' ? 'rehearsal override' : 'asserted'})`
    : state.own && state.own.key ? `${state.own.key} (from the request)` : null);
  const act = (type, attrs, action) => ({ type, attrs: attrs || {}, ...(action ? { action } : {}) });
  function setRegion(region, source) { state.ctx.region = region || null; state.regionSource = source || (region ? 'asserted' : 'edge'); renderWho(); }
  /** Back in her own region (from the request, or the rehearsal override), and said so on screen. */
  async function restoreRegion() {
    const own = ownRegion();
    if ((state.ctx.region || null) === own) return;
    setRegion(own, ownSource());
    if (own) note('asserted', `region = ${own}`, 'back in the rehearsal override’s region (?region=), labelled');
    else note('located', `back in ${ownName()}`, 'her own region: from the request, nothing asserted');
    await loadColdStart();
  }
  function storageStep(id) {
    const p = phone(id);
    const opts = p ? optionsOf(p) : [];
    const o = opts[1] || opts[0] || { storage: '', label: 'storage' };
    return { ...o, label: optLabel(o) };
  }

  const BEATS = [
    { key: 'arrive', no: '1', act: 1, who: 'shopper', label: 'A stranger arrives from the ad',
      declare: () => [`<b>Taps</b> a paid-social ad and lands on the homepage (${esc(describeEntry(landingEntry(adParams())))})`,
        OVERRIDE.region ? `<b>Rehearsal override</b>: region = ${esc(OVERRIDE.region)} from the address bar (?region=), asserted and labelled`
          : 'Her region comes <b>from the request</b>: the edge locates her, and nothing is asserted'],
      acts: () => [act('page_view', {})],
      will: () => ['The hero and the four answer <b>the ad and her region</b>: the campaign lifts its promotion, her region’s own sales lean the rest',
        `The Arrival panel names ${OVERRIDE.region ? 'the override’s region, labelled as asserted' : 'the region <b>the edge located, from the request</b>'}, the grain, the census figure and the regional lean, each labelled`,
        'Her own meters are empty: nothing about <b>her</b> is known yet'],
      line: () => `A stranger taps a paid-social ad. The first paint answers <b>the ad and where she is</b>: ${OVERRIDE.region ? 'her region is a rehearsal override, labelled' : 'her region comes from the request'}, the campaign lifts its promotion and the carrier’s own regional sales lean the rest. Aggregate, never the individual; we curate, never price.`,
      async run() {
        await resetTenant();
        await useCatalog(beatName('open', 'catalog'));
        state.visitors = {}; state.who = null; state.capture = null; el.compareBtn.disabled = true; state.receipts.clear();
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
        connectSocket(v);
        selectTab('tab-arrival');
        await openHome({ quiet: true, focus: 'hero' });
      } },

    { key: 'region', no: '2', act: 1, who: 'merch', label: 'The same visitor, another region',
      declare: () => [`<b>Asserts</b> region = ${esc(contrast())}${regionName(contrast()) ? ` (${esc(regionName(contrast()))})` : ''} on the request: asserted, not observed; nothing about her changes`],
      acts: () => [],
      will: () => ['A <b>different opening four</b>: only the region changed', 'The Arrival panel shows the asserted region’s grain, census figure and lean, labelled <b>asserted, not observed</b>', 'Her meters do not move: a region is context, never evidence about her'],
      line: () => `Same visitor, same ad. Only the region changes, to <b>${esc(regionName(contrast()) || contrast())}</b>, asserted, not observed, and the page opens differently: the prior is that region’s own sales. The census figure explains the lean and is never scored.`,
      async run() {
        const to = contrast();
        setRegion(to, 'asserted');
        note('asserted', `region = ${to}`, 'asserted, not observed · context on the request · never evidence about her');
        await loadColdStart();
        selectTab('tab-arrival');
        await refreshHome();
        focusOn(el.dealsModule);
      } },

    { key: 'browse', no: '3', act: 2, who: 'shopper', label: 'She browses Samsung',
      declare: () => [...((state.ctx.region || null) !== ownRegion() ? [`<b>Back</b> in ${esc(ownName())}, her own region (${OVERRIDE.region ? 'the rehearsal override, labelled' : 'from the request, nothing asserted'})`] : []),
        '<b>Opens</b> Phones', ...browseTouches().map((t) => (t.view === 'page' ? `<b>Opens</b> the ${esc(phone(t.id).name)} page` : `<b>Quick look</b> on the ${esc(phone(t.id).name)}`))],
      acts: () => {
        const out = [act('page_view', {})];
        let onGrid = true;
        browseTouches().forEach((t) => {
          if (t.view !== 'page' && !onGrid) { out.push(act('page_view', {})); onGrid = true; }
          out.push(act('product_view', phoneAttrs(phone(t.id), { view: t.view })));
          if (t.view === 'page') onGrid = false;
        });
        return out;
      },
      will: () => ['<b>brand samsung</b> crosses the entry threshold on three touches; ecosystem and price band accumulate over the regional prior', 'The homepage is not asked while she browses, so the four do not move yet'],
      line: () => 'Back in her own region, she browses <b>Samsung</b>: the Galaxy S26 card, its page, then the S26 Ultra. Each is a real event, and <b>brand samsung</b> crosses the entry threshold on her own meters. The four are not asked again until she goes home.',
      async run() {
        await restoreRegion();
        if (state.view !== 'phones') { await performClick(ctl('mainnav', 'nav-phones')); await sleep(300); }
        for (const t of browseTouches()) {
          if (t.view === 'page') {
            if (!await clickIf(ctl('sheetBody', `sheet-open-${t.id}`))) {
              if (state.view !== 'phones') { await performClick(ctl('mainnav', 'nav-phones')); await sleep(300); }
              await performClick(ctl('phoneGrid', `open-${t.id}`));
            }
            await sleep(900);
          } else {
            if (state.sheet) { await performClick(ctl('sheetBody', 'sheet-done')); await sleep(250); }
            if (state.view !== 'phones') { await performClick(ctl('pdpCrumbs', 'phones-crumb')); await sleep(300); }
            await performClick(ctl('phoneGrid', `quick-${t.id}`));
            await sleep(800);
          }
        }
        if (state.sheet) await performClick(ctl('sheetBody', 'sheet-done'));
      } },

    { key: 'hinge', no: '4', act: 2, who: 'shopper', label: () => `The hinge: the ${phone(hingePhone()) ? phone(hingePhone()).name : 'Pixel'}, then home`,
      declare: () => [`<b>Opens</b> the ${esc((phone(hingePhone()) || {}).name || 'Pixel')} page`, '<b>Returns</b> to the homepage'],
      acts: () => [act('product_view', phoneAttrs(phone(hingePhone()), { view: 'page' })), act('page_view', {})],
      will: () => ['Her <b>Android</b> interest now spans two makers; <b>brand samsung</b> is past the entry threshold', 'Android promotions overtake the lifted launch promotion; the receipts say what carried each one'],
      line: () => 'The hinge. The ad said iPhone; she has been looking at Android. She opens a Pixel and comes back, and the four follow <b>her</b>. <b>Why these</b> shows what carried each one.',
      // Said only once the receipts say it: a lifted promotion overtaken by pieces her own browsing carries.
      after: () => (hingeLine() ? 'The hinge. The ad said iPhone; she has been looking at Android. The four follow <b>her</b>, and the receipt says why: <b>campaign context superseded by observed behaviour</b>.' : null),
      async run() { await openPhoneVia(hingePhone()); await sleep(900); await goHome(); selectTab('tab-why'); } },

    { key: 'exit', no: '5', act: 2, who: 'engine', label: 'She stops touching it',
      declare: () => ['<b>Nothing.</b> Nobody touches the page for a minute; then the page asks again'],
      acts: () => [],
      will: () => [`Brand memory is ${esc(roomOf('brand') || 'short')} in this room: <b>brand samsung</b> decays below the <b>${fmt2(thetaOut())} exit threshold</b> on the meter`,
        'The Galaxy receipts lose their Samsung driver; the <b>Phones for you</b> rail re-sorts on the same answer', 'The four can keep their order: ranking is continuous, and <b>ecosystem android</b> still carries them'],
      line: () => 'Everyone shows joining an audience. Watch her <b>leave</b> one. Nobody touches the page for a minute; the page asks again, and <b>the engine’s answer</b> withdraws the Samsung claim while her Android lean holds.',
      async run() {
        if (state.view !== 'home') await goHome();
        // Her meters read before the minute and after it (beat 5's document); a slow read shows as reading, not as a stalled page.
        el.dealsDeltas.insertAdjacentHTML('afterbegin', '<li class="delta-timer"><span class="hk">Reading her meters</span><span><b class="tmr">…</b> Before the minute starts: the engine’s own read.</span></li>');
        await renderVectors();
        const before = JSON.parse(JSON.stringify(state.lastVector || {}));
        const four = (state.home.current || []).map((c) => c.id).join('|');
        note('waited', 'Nobody touches the page', 'a minute; the page asks again after it');
        const doc = await tryJson('/vantage/beats/05-stop-touching.json');
        await exitTimer(num(QS.get('wait')) || (doc && num(doc.waitSeconds)) || 60);
        // A slow read shows as the page asking, never as a stalled clock; the page has no order of its own to fall back to.
        const row = el.dealsDeltas.querySelector('.delta-timer');
        if (row) row.innerHTML = '<span class="hk">Asking the engine</span><span><b class="tmr">…</b> The minute is up and the page is asking again: the engine’s answer, not the page’s.</span>';
        say('asking the engine…');
        await refreshHome();
        const said = exitSentence(before, state.lastVector || {}, (state.home.current || []).map((c) => c.id).join('|') === four);
        state.exitNote = said.four;
        note('engine', 'The engine withdrew a claim', stripTags(said.four).slice(0, 160));
        renderDealsChanges();
        const railMoved = renderRailDeltas(said.rail);
        focusOn(railMoved ? $('railModule') : el.dealsModule);
      } },

    { key: 'open', no: '6', act: 3, who: 'shopper', label: () => `She opens the ${focusName()}`,
      declare: () => [`<b>Opens</b> the ${esc(focusName())} page`],
      acts: () => [act('product_view', phoneAttrs(phone(focusPhone()), { view: 'page' }))],
      will: () => ['Six modules below the buy box, in the order <b>her browsing already earns</b>; Why these explains each one', '<b>Compare → Fresh visitor</b> shows the template order beside hers', '<b>One decision on every surface</b>: the trade-in module explains the offer the homepage led with; the buy box is marked <b>off limits</b>'],
      line: () => 'The phone page. The buy box is <b>off limits</b>: never decided, never personalised. Below it, six modules in the order her browsing already earns, and the trade-in module carries <b>the same offer the homepage chose</b>, explained, not decided again.',
      async run() { await openPhoneVia(focusPhone()); } },

    { key: 'compare', no: '7', act: 3, who: 'shopper', label: 'She steps storage and compares the camera',
      declare: () => [`<b>Selects</b> ${esc(storageStep(focusPhone()).label)} in the buy box`, '<b>Compares</b> storage, then the camera'],
      acts: () => {
        const p = phone(focusPhone()); const o = storageStep(focusPhone()); const price = num(o.price_usd);
        return [act('custom', { productId: p.id, storage: o.storage, price_usd: price }, 'select'),
          act('custom', { productId: p.id, storage: o.storage, price_usd: price, contentType: 'compare' }, 'compare'),
          act('custom', { productId: p.id, brand: p.brand, os: ecoOf(p), ecosystem: ecoOf(p), price_usd: price, contentType: 'compare' }, 'compare')];
      },
      will: () => ['<b>Price band</b> and <b>contentType compare</b> rise; a storage step that crosses $900 moves the band', `<b>Storage &amp; memory</b> rises, leading with ${esc(storageStep(focusPhone()).label)} at its real monthly delta`],
      line: () => { const p = phone(focusPhone()); const o = storageStep(focusPhone()); return `She steps to <b>${esc(o.label)}</b> and compares the camera. The monthly figure rises by the real delta, <b>+${money(deltaOf(p, o))}</b>, and the page states the maths. <b>Storage &amp; memory</b> rises.`; },
      async run() {
        const o = storageStep(focusPhone());
        await clickIf(ctl('bbStorage', `storage-${o.storage}`));
        await sleep(500);
        await performClick(ctl('modules', 'storage-compare'));
        await sleep(700);
        await performClick(ctl('sheetBody', 'cmp-camera'));
        await sleep(700);
        await performClick(ctl('sheetBody', 'sheet-done'));
      } },

    { key: 'perk', no: '8', act: 3, who: 'shopper', label: 'She opens the hotspot & travel starter',
      declare: () => [`<b>Opens</b> the hotspot &amp; travel starter on ${esc(tierName('more'))}, in Pair with a plan`],
      acts: () => [act('page_view', { page: 'perk', category: 'plans', perk: 'hotspot-travel' })],
      will: () => ['<b>perk hotspot-travel</b> and <b>category plans</b> move', `<b>Pair with a plan</b> rises; ${esc(tierName('more'))} leads on the hotspot &amp; travel starter`, `Capture it, then Compare with the streaming shopper: ${esc(tierName('max'))} leads with the streaming bundle`],
      line: () => `She opens the <b>hotspot &amp; travel</b> starter. Pair with a plan rises and <b>${esc(tierName('more'))}</b> leads. Capture it, and the Compare tool shows the streaming shopper beside her.`,
      async run() {
        const btn = el.modules.querySelector('[data-perk="hotspot-travel"][data-plan="more"]') || el.modules.querySelector('[data-perk="hotspot-travel"]');
        if (!btn) throw new Error('no plan card on this page offers the hotspot & travel starter');
        await performClick(`#modules [data-ctl="${btn.getAttribute('data-ctl')}"]`);
        await sleep(800);
        await performClick(ctl('sheetBody', 'sheet-done'));
      } },

    { key: 'lines', no: '9a', act: 3, who: 'shopper', label: 'Four lines, then the kids’ watch',
      declare: () => ['<b>Sets</b> the line selector to four lines', '<b>Opens</b> the kids’ smartwatch', '<b>Goes back</b> to the phone page'],
      acts: () => [act('custom', { lines: 'family', count: 4 }, 'select'), act('page_view', KIDS_WATCH)],
      will: () => ['<b>lines family</b> moves on the selector, then with <b>intent add-line</b> and <b>category watches-tablets</b> on the watch page', 'Watch, tablet and more lines rises with the four-line per-line price; a household total appears', `The family starter (${esc(tierName('go'))}) leads in Pair with a plan`],
      line: () => 'She sets the lines to <b>four</b> and looks at a kids’ watch. The connected-devices module rises with the four-line price, a household total appears, and the family starter leads.',
      async run() {
        await performClick(ctl('modules', 'lines-4'));
        await sleep(500);
        if (!await clickIf(ctl('modules', 'kids-watch'))) { await performClick(ctl('mainnav', 'nav-add-a-line')); await sleep(500); await performClick(ctl('pageBody', 'kids-watch')); }
        await sleep(800);
        await performClick(ctl('pageCrumbs', 'back-phone'));
        focusOn($('modulesModule'));
      } },

    { key: 'home-family', no: '9b', act: 3, who: 'shopper', label: 'Home: the family hero and the four-line offer',
      declare: () => ['<b>Returns</b> to the homepage'],
      acts: () => [act('page_view', {})],
      will: () => ['The <b>family hero</b> leads the page', 'The <b>four-line promotion enters the four</b>: what she did on the phone page reaches the homepage'],
      line: () => 'Back on the homepage the hero and the four follow what she did on the phone page: the <b>family hero</b>, and the <b>four-line promotion</b> enters. One profile, every surface.',
      async run() { await performClick(ctl('pdpCrumbs', 'home-crumb')); focusOn(el.heroModule); } },

    { key: 'byod', no: '10a', act: 3, who: 'shopper', label: 'She will bring her own phone',
      declare: () => [(canBackTo(focusPhone()) ? `<b>Goes back</b> to the ${esc(focusName())} page (the browser’s Back)` : `<b>Opens</b> the ${esc(focusName())} again`), '<b>Answers</b> “bring your own” in the buy box'],
      acts: () => [...(canBackTo(focusPhone()) ? [] : [act('product_view', phoneAttrs(phone(focusPhone()), { view: 'page' }))]), act('custom', { intent: 'byod' }, 'select')],
      will: () => ['<b>ctx.intent = byod</b> is asserted on every decision, labelled, as her account would', 'Offers that need another answer <b>fail closed</b>', '<b>Simple</b> leads Pair with a plan for the switcher; the public prices do not change'],
      line: () => 'She says she will <b>bring her own phone</b>. The answer is asserted on the request, as her account would, and it routes the propositions: <b>Simple</b> leads for the switcher. Same public prices.',
      async run() { await backToPhone(focusPhone()); await sleep(400); await performClick(ctl('bbIntent', 'intent-byod')); focusOn(el.modules.querySelector('[data-module="plan-pairing"]') || el.modules); } },

    { key: 'home-byod', no: '10b', act: 3, who: 'shopper', label: 'Home: the switcher’s homepage',
      declare: () => ['<b>Returns</b> to the homepage'],
      acts: () => [act('page_view', {})],
      will: () => ['The <b>switch hero</b> leads', '<b>Bring your phone</b> enters the four on her declared answer; the offers that need a new line fail closed, and the ungated pre-order can still rank above it'],
      line: () => 'On the homepage her answer routes the offers too: the <b>switch hero</b>, and <b>bring your own phone</b> enters the four. The offers that need a new line fail closed.',
      async run() { await performClick(ctl('pdpCrumbs', 'home-crumb')); focusOn(el.heroModule); } },

    { key: 'upgrade', no: '10c', act: 3, who: 'shopper', label: 'Then she is upgrading',
      declare: () => [(canBackTo(focusPhone()) ? `<b>Goes back</b> to the ${esc(focusName())} page (the browser’s Back)` : `<b>Opens</b> the ${esc(focusName())} again`), '<b>Answers</b> “upgrade”', '<b>Chooses</b> the plan that leads'],
      acts: () => [...(canBackTo(focusPhone()) ? [] : [act('product_view', phoneAttrs(phone(focusPhone()), { view: 'page' }))]), act('custom', { intent: 'upgrade' }, 'select'), act('custom', { plan: 'more' }, 'select')],
      // Protection's rise is timing-dependent (R1 7b-ii), so the beat claims only the flip, the plan and, on 10d, the offer.
      will: () => ['Her answer flips from “bring your own” to <b>upgrade</b>: <b>ctx.intent = upgrade</b> is asserted on every decision, labelled', `<b>${esc(tierName('more'))}</b> leads Pair with a plan for the trade-in shopper`, 'Her plan choice is kept for the continue hero: her selections, nothing inferred', 'Watch protection; it rises when the premium band is strong'],
      line: () => `She is <b>upgrading</b> instead: her answer flips from bring-your-own to upgrade, asserted on the request. <b>${esc(tierName('more'))}</b> leads Pair with a plan for the trade-in shopper. She picks the plan that leads; it is her selection, and the page keeps it. Watch protection; it rises when the premium band is strong.`,
      async run() {
        await backToPhone(focusPhone());
        await sleep(400);
        await performClick(ctl('bbIntent', 'intent-upgrade'));
        await sleep(500);
        const first = el.modules.querySelector('.plan [data-act="choose-plan"]');
        if (first) await performClick(`#modules [data-ctl="${first.getAttribute('data-ctl')}"]`);
      } },

    { key: 'home-intent', no: '10d', act: 3, who: 'shopper', label: 'Home: the upgrade offer leads',
      declare: () => ['<b>Returns</b> to the homepage'],
      acts: () => [act('page_view', {})],
      will: () => ['The <b>new-line offers leave</b>: their rule needs a new line', 'The <b>upgrade offer leads</b>, with its terms: what it requires and what ends the credit'],
      line: () => 'On the homepage the new-line offers are gone, because their rule needs a new line, and the <b>upgrade offer leads</b> with its terms: what it requires, and what ends the credit.',
      // Named only when the engine's leader really is an upgrade-only offer (the Galaxy S26 Ultra's, as measured); else the line above stands.
      after: () => {
        const lead = bySlot(state.home.set, SLOTS.deals)[0];
        const p = lead && pieceOfDecision(lead);
        const intents = arr(p && p.tags && p.tags.intent);
        return p && intents.length === 1 && intents[0] === 'upgrade'
          ? `On the homepage the new-line offers are gone, because their rule needs a new line, and the <b>upgrade offer leads</b>: <b>${esc(p.title)}</b>, with its terms: what it requires, and what ends the credit.`
          : null;
      },
      async run() { await performClick(ctl('pdpCrumbs', 'home-crumb')); focusOn(el.dealsModule); } },

    { key: 'two-weeks', no: '11', act: 4, who: 'merch', label: 'Merchandiser: two weeks pass',
      target: () => anchorId('closesAtBeat11') || anchorId('launch'),
      declare: () => [...(cur() && cur().intent !== defaultIntent() ? [`<b>Asserts</b> her answer back to “${esc(INTENT_WORD[defaultIntent()] || defaultIntent())}” for the merchandiser’s day`] : []), '<b>The CMS clock</b> moves two weeks on'],
      acts: () => [],
      will: () => ['A launch promotion’s window closes: it <b>leaves its container</b> and stops being a candidate', 'Its successor takes the container; nothing was switched off and no test ended'],
      line: () => 'Two weeks pass. A launch promotion’s window closes and the next promotion takes the container. <b>No test ended, no winner was declared, nobody configured anything.</b>',
      async run() {
        // Act 4 is seen as a new line, as lane L1 measured beats 11 to 15; the change is asserted and labelled, never silent.
        const v = cur();
        if (v && v.intent !== defaultIntent()) {
          v.intent = defaultIntent();
          note('asserted', `ctx.intent = ${v.intent}`, 'the merchandiser’s day, seen as a new line');
          renderWho();
        }
        await useCatalog(beatName('twoWeeks', 'catalog'));
        await applyBeat('catalog', beatName('twoWeeks', 'catalog'), 'two weeks pass');
        note('published', 'Two weeks pass', 'a launch window closes');
        await refreshHome(); focusOn(el.dealsModule);
      } },

    { key: 'black-friday', no: '12', act: 4, who: 'merch', label: 'Merchandiser: Black Friday arrives',
      target: () => anchorId('blackFriday'),
      declare: () => ['<b>Publishes</b> the Black Friday switcher offer, live from this minute'],
      acts: () => [],
      will: () => ['A promotion <b>nobody has ever clicked</b> reaches the module on its metadata alone', 'It reaches the shopper whose behaviour says switch'],
      line: () => 'Black Friday: the <b>switcher offer, no trade-in</b>, live this minute. Nobody has clicked it, so it is placed on its metadata alone.',
      async run() {
        state.fixtureDone.add('black-friday');
        await useCatalog(beatName('blackFriday', 'catalog'));
        await applyBeat('catalog', beatName('blackFriday', 'catalog'), 'Black Friday arrives');
        note('published', 'Black Friday arrives', 'a new piece, no history');
        await refreshHome(); focusOn(el.dealsModule);
      } },

    { key: 'pin', no: '13', act: 4, who: 'merch', label: 'Merchandiser: pin the iPhone Duo pre-order',
      target: () => anchorId('duo'),
      declare: () => ['<b>Pins</b> the iPhone Duo pre-order (16 October) for everyone'],
      acts: () => [],
      will: () => ['The pre-order takes <b>container one</b> for everyone (a pin is a required prefix); its receipt reads <b>ranking skipped</b>', 'The other three are still ranked for her'],
      line: () => 'Launch week for the foldable: the <b>iPhone Duo pre-order is pinned to container one</b> for everyone. Ranking never ran for it; the other three are still hers.',
      async run() {
        await applyBeat('slots', beatName('pinDuo', 'slots'), 'iPhone Duo pre-order pinned');
        note('tuned', 'iPhone Duo pinned', 'container one for everyone · ranking skipped');
        await refreshHome(); focusOn(el.dealsModule);
      } },

    { key: 'covered', no: '14a', act: 4, who: 'shopper', label: '5G Home where it is available',
      target: () => anchorId('homeBundle'),
      declare: () => [`In ${esc(regionName(regions().covered) || regions().covered)}, where 5G Home is available`,
        ...(state.view === 'phone' && state.phoneId === focusPhone() ? [] : [canBackTo(focusPhone()) ? `<b>Goes back</b> to the ${esc(focusName())} page (the browser’s Back)` : `<b>Opens</b> the ${esc(focusName())}`]),
        '<b>Opens</b> Home Internet and <b>checks an address</b>', '<b>Goes back</b> to the phone page'],
      acts: () => [...(state.view === 'phone' && state.phoneId === focusPhone() || canBackTo(focusPhone()) ? [] : [act('product_view', phoneAttrs(phone(focusPhone()), { view: 'page' }))]),
        act('page_view', PAGE_EVENTS['home-internet']), act('custom', { category: 'home-internet', intent: 'home', contentType: 'tool' }, 'start_order')],
      will: () => ['<b>intent home</b> and <b>category home-internet</b> move: the address check is a start order, the heaviest touch here', '<b>Add home internet</b> carries a rule (only where 5G Home is available): eligible here, it rises on her address check'],
      line: () => `In ${esc(regionName(regions().covered) || regions().covered)} she checks an address for 5G Home. The home-internet module carries a rule, <b>only where 5G Home is available</b>: here it is eligible, and her address check moves it up the page. A condition the request does not carry fails closed.`,
      async run() {
        if (state.ctx.region !== regions().covered) { setRegion(regions().covered, 'asserted'); note('asserted', `region = ${regions().covered}`, 'covered by 5G Home'); await loadColdStart(); }
        if (state.view !== 'phone' || state.phoneId !== focusPhone()) { await backToPhone(focusPhone()); await sleep(400); }
        await performClick(ctl('mainnav', 'nav-home-internet'));
        await sleep(600);
        await performClick(ctl('pageBody', 'page-address-check'));
        await sleep(600);
        await performClick(ctl('pageCrumbs', 'back-phone'));
        focusOn($('modulesModule'));
      } },

    { key: 'uncovered', no: '14b', act: 4, who: 'merch', label: 'The same shopper where it is not',
      target: () => anchorId('homeBundle'),
      declare: () => [`<b>Asserts</b> region = ${esc(regions().uncovered)}${regionName(regions().uncovered) ? ` (${esc(regionName(regions().uncovered))})` : ''}; nothing about her changes`],
      acts: () => [],
      will: () => ['<b>Add home internet</b> leaves the six: still published, still in its window, simply not eligible here'],
      line: () => `The same shopper in ${esc(regionName(regions().uncovered) || regions().uncovered)}. Nothing about her changed; the module is gone because its rule does not hold here. A rule on the piece, not a preference.`,
      async run() {
        setRegion(regions().uncovered, 'asserted');
        note('asserted', `region = ${regions().uncovered}`, 'not covered by 5G Home');
        await loadColdStart();
        if (state.view === 'phone') { await refreshPhone(); focusOn($('modulesModule')); } else { await refreshHome(); focusOn(el.dealsModule); }
      } },

    { key: 'cart', no: '15a', act: 5, who: 'shopper', label: 'She adds it to her cart and comes back',
      declare: () => [...((state.ctx.region || null) !== ownRegion() ? [`<b>Back</b> in ${esc(ownName())}, her own region`] : []),
        `<b>Adds</b> the ${esc(focusName())} to her cart`, '<b>Returns</b> to the homepage'],
      acts: () => {
        const p = phone(focusPhone()); const v = cur();
        const o = p && v && v.config && v.config.phoneId === p.id ? optionOf(p, v.config.storage) : optionsOf(p)[0];
        return [act('add_to_cart', phoneAttrs(p, { price_usd: num(o.price_usd), storage: o.storage })), act('page_view', {})];
      },
      will: () => ['Her first cart add makes her <b>deciding</b>, so the <b>continue hero</b> is in stage', 'The hero is now <b>her own priced configuration</b> with one next step: her selections, nothing inferred'],
      line: () => 'She adds the phone to her cart and comes back. The hero is now <b>her priced configuration</b>, with one next step. Their homepage stayed static after the same journey.',
      async run() {
        await restoreRegion();
        if (state.view !== 'phone' || state.phoneId !== focusPhone()) { await openPhoneVia(focusPhone()); await sleep(400); }
        await performClick('#buyBox [data-ctl="add-to-cart"]');
        await sleep(400);
        await performClick(ctl('pdpCrumbs', 'home-crumb'));
        focusOn(el.heroModule);
      } },

    { key: 'template', no: '15b', act: 5, who: 'merch', label: 'Tomorrow’s template puts deals first',
      declare: () => ['<b>Tomorrow’s homepage template</b> moves the deals module to position one'],
      acts: () => [],
      will: () => ['The module renders <b>first</b>', '<b>The same four, in the same order</b>: a slot is addressed by name, not position'],
      line: () => `Tomorrow’s template moves the deals module to <b>position one</b>, and the four do not change. <code>${esc(SLOTS.deals)}</code> is <code>${esc(SLOTS.deals)}</code> wherever their template puts it, and its evidence follows the name.`,
      async run() {
        const doc = await tryJson('/vantage/beats/15-continue-and-report.json');
        placeDeals((doc && doc.template && doc.template.home) || [SLOTS.deals, SLOTS.hero, SLOTS.rail], 'tomorrow’s');
        note('published', 'Tomorrow’s template', 'their CMS moves the deals module to position one');
        await refreshHome(); focusOn(el.dealsModule);
      } },

    { key: 'clicks', no: '15c', act: 5, who: 'shopper', label: 'The clicks, and the day report',
      declare: () => ['<b>Clicks</b> two of the four, as a shopper would'],
      acts: () => [],
      will: () => ['Each click is credited to the promotion that held the container', 'The report: attribution per promotion and per module, <b>not incrementality</b>'],
      line: () => 'Two clicks, each credited to what held the container. <b>Learned</b> shows attribution per promotion and per module: module engagement, attach, plan mix. Never a lift number; lift is theirs to read against a holdout.',
      async run() {
        for (const n of [1, 2]) { await clickIf(ctl('deals', `deal-${n}`)); await sleep(300); }
        selectTab('tab-report');
        await loadReport(true);
      } },
  ];
  const beats = () => BEATS.filter((b) => !b.flag);
  const labelOf = (b) => (typeof b.label === 'function' ? b.label() : b.label);
  function adParams() {
    const a = state.anchor.arrival || {};
    const q = new URLSearchParams();
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term']) if (a[k]) q.set(k, a[k]);
    if (a.referrer) q.set('referrer', a.referrer);
    const keep = new URLSearchParams(location.search);
    for (const k of ['fixtures', 'exit', 'region', 'metro', 'debug']) if (keep.has(k)) q.set(k, keep.get(k));
    return q;
  }

  function renderPresses() {
    el.presses.innerHTML = beats().map((b, i) => `<button class="press${b.who === 'merch' ? ' press--merch' : b.who === 'engine' ? ' press--engine' : ''}" type="button" aria-pressed="${state.beat === i}" data-i="${i}">`
      + `<span class="n">${esc(b.no)}</span>${esc(labelOf(b))}</button>`).join('');
  }
  function renderNext() {
    const list = beats();
    const next = state.beat === null ? 0 : state.beat + 1;
    if (next >= list.length) { el.nextBeat.disabled = true; el.nextLabel.textContent = 'the walkthrough is complete'; return; }
    el.nextBeat.disabled = false;
    el.nextLabel.textContent = `${list[next].no} · ${labelOf(list[next])}`;
  }
  function closeDirector() {
    const bar = el.directorHandle.closest('.director');
    bar.classList.remove('director--open');
    el.directorHandle.setAttribute('aria-expanded', 'false');
    el.directorHandle.textContent = 'All beats';
  }
  function go(i) {
    if (state.busy) return undefined;
    if (!el.pdBack.hidden) el.pdBack.hidden = true;
    if (!el.cmpBack.hidden) el.cmpBack.hidden = true;
    closeDirector();
    return runBeat(i);
  }
  async function runBeat(i) {
    const b = beats()[i];
    if (!b || state.busy) return;
    state.busy = true;
    const before = { home: state.home.current, phone: state.phone.current };
    el.presses.querySelectorAll('.press').forEach((node, j) => node.setAttribute('aria-pressed', String(j === i)));
    el.beatNo.innerHTML = `<b class="act">Act ${b.act} &middot; ${esc(ACTS[b.act])}</b><span class="bn">Beat ${esc(b.no)} / 15</span>`;
    el.engineLine.innerHTML = b.line();
    state.lineBeat = b;
    if (b.key !== 'exit') { state.exitNote = null; const rd = $('railDeltas'); if (rd) rd.hidden = true; }
    state.fixtureStep = b.key;
    if (FIXTURE) state.fixtureDone.add(b.key);
    say('working…');
    try {
      if (!cur() && b.key !== 'arrive') await ensureVisitor();
      await b.run();
      say('done', 'good');
    } catch (error) {
      const m = String((error && error.message) || error);
      say(m, 'bad');
      engineDown(state.view === 'phone' ? el.modulesDown : el.dealsDown, m);
    } finally {
      el.cursor.classList.remove('show');
      state.busy = false;
      state.beat = i;
      renderPresses();
      renderNext();
      captureProof(b, before);
    }
  }
  el.presses.addEventListener('click', (e) => { const btn = e.target.closest('.press'); if (btn) void go(Number(btn.dataset.i)); });
  el.nextBeat.addEventListener('click', () => { if (!state.busy && !el.nextBeat.disabled) void go(state.beat === null ? 0 : state.beat + 1); });
  el.directorHandle.addEventListener('click', () => {
    const bar = el.directorHandle.closest('.director');
    const open = bar.classList.toggle('director--open');
    el.directorHandle.setAttribute('aria-expanded', String(open));
    el.directorHandle.textContent = open ? 'Hide beats' : 'All beats';
  });

  /** What the presenter may assert by hand: the region and her answer, both labelled on screen. */
  function renderAsserts() {
    const r = regions();
    const list = [null, ...new Set([OVERRIDE.region, r.first, r.second, r.covered, r.uncovered].filter(Boolean))];
    el.assertRegion.innerHTML = '<span class="wlabel">region</span>' + list.map((x) => `<button type="button" data-region="${esc(x || '')}" aria-pressed="${(state.ctx.region || null) === x}"`
      + ` title="${x ? (x === OVERRIDE.region ? 'The rehearsal override, asserted and labelled' : 'Assert this region on the request, labelled') : 'Assert nothing: the region comes from the request'}">${esc(x || 'from the request')}</button>`).join('');
    const v = cur();
    // Always one answer: without ctx.intent the gated offers fail closed and the four come back short.
    el.assertIntent.innerHTML = '<span class="wlabel">intent</span>' + INTENTS.map(([k, l]) => `<button type="button" data-intent="${k}" aria-pressed="${((v && v.intent) || defaultIntent()) === k}">${esc(l)}</button>`).join('');
    el.compareTools.innerHTML = '<span class="wlabel">compare</span><button type="button" data-tool="capture">Capture</button><button type="button" data-tool="compare">Compare</button><button type="button" data-tool="fresh">Fresh visitor</button><button type="button" data-tool="streaming">Streaming shopper</button>';
  }
  el.assertRegion.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.busy) return;
    const to = btn.dataset.region || null;
    setRegion(to, to ? (to === OVERRIDE.region ? 'rehearsal override' : 'asserted') : 'edge');
    await loadColdStart();
    if (state.view === 'home') await refreshHome(); else if (state.view === 'phone') await refreshPhone();
  });
  el.assertIntent.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.busy || !cur()) return;
    cur().intent = btn.dataset.intent || defaultIntent();
    cur().intentByHand = true;
    renderWho();
    if (state.view === 'phone') { renderBuyBox(); await refreshPhone(); } else if (state.view === 'home') await refreshHome();
  });
  el.compareTools.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.busy) return;
    if (btn.dataset.tool === 'capture') capture();
    if (btn.dataset.tool === 'compare') openCompare();
    if (btn.dataset.tool === 'streaming') void streamingShopper();
    if (btn.dataset.tool === 'fresh') void freshVisitor();
  });

  // ════════════════════════════════════════════════════════════════════════
  // PREDICT, THEN PROVE. The arithmetic is published, so a touch's effect can
  // be stated before it happens and checked by hand. The constants and the
  // action weights are read from the published registry, never typed here.
  // ════════════════════════════════════════════════════════════════════════
  const rOf = (a) => (a >= 1 ? Infinity : (a * K()) / (1 - a));
  const aOf = (r) => r / (r + K());
  function touchesOf(attrs) {
    const out = [];
    for (const spec of (reg().dimensions || [])) {
      const raw = attrs[spec.source];
      if (raw === undefined || raw === null) continue;
      if (spec.derive === 'band') {
        const n = num(raw);
        if (!Number.isFinite(n) || !spec.cuts || !spec.labels) continue;
        let idx = spec.cuts.findIndex((c) => n < c); if (idx === -1) idx = spec.cuts.length;
        if (spec.labels[idx]) out.push({ dim: spec.key, value: spec.labels[idx] });
      } else if (Array.isArray(raw)) raw.forEach((x) => { if (typeof x === 'string' && x) out.push({ dim: spec.key, value: x }); });
      else if (typeof raw === 'string' && raw) out.push({ dim: spec.key, value: raw });
    }
    return out;
  }
  function predictArithmetic(acts) {
    const w = reg().weights || {};
    const added = new Map();
    acts.forEach((a) => {
      const weight = num(w[a.action || a.type] != null ? w[a.action || a.type] : 0);
      if (!weight) return;
      touchesOf(a.attrs || {}).forEach((t) => { const k = `${t.dim}\u0000${t.value}`; added.set(k, (added.get(k) || 0) + weight); });
    });
    return [...added.entries()].map(([k, delta]) => {
      const [dim, value] = k.split('\u0000');
      const before = num(((state.lastVector[dim] || {})[value]) || 0);
      const after = aOf(rOf(before) + delta);
      return { dim, value, before, after, delta, crosses: before < thetaIn() && after >= thetaIn() };
    }).sort((x, y) => y.after - x.after);
  }
  const slotColour = (i) => ['#111111', '#B80000', '#0A7A3D', '#5B5B5B', '#0A6C86', '#6B4E00'][i % 6];
  const mapHtml = (rows) => (rows && rows.length ? rows.map((r, i) => `<div class="pd-slot" style="background:${slotColour(i)}" title="${esc(r)}">${i + 1} · ${esc(r)}</div>`).join('') : '<p class="pd-empty" style="font-size:12.5px">nothing yet</p>');

  function renderPredict(b) {
    if (!b) {
      el.pdMode.textContent = 'the walkthrough is complete';
      el.pdAct.innerHTML = '<li class="pd-empty">No press remains.</li>';
      el.pdArith.innerHTML = '';
      el.pdWill.innerHTML = '<li class="pd-empty">&mdash;</li>';
      renderDone(); return;
    }
    const acts = b.acts ? b.acts() : [];
    el.pdMode.textContent = `before beat ${b.no}: ${labelOf(b)}`;
    renderDone();
    el.pdAct.innerHTML = (b.declare ? b.declare() : [labelOf(b)]).map((l) => `<li>${l}</li>`).join('');
    const rows = predictArithmetic(acts);
    el.pdArithK.textContent = `The arithmetic · score before → after · entry threshold ${fmt2(thetaIn())} · K = ${K()} · from ${state.sources.registry || 'the shipped constants'}`;
    el.pdArith.innerHTML = rows.length ? rows.map((r) => `<div class="pd-row${r.crosses ? ' crosses' : ''}"><span>${esc(DIM_LABEL[r.dim] || r.dim)} · ${esc(r.value)}</span>
      <span class="from">${r.before.toFixed(3)} + ${r.delta} →</span><span class="to">${r.after.toFixed(3)}</span><span class="th">θ ${fmt2(thetaIn())}</span></div>`).join('')
      : `<p class="pd-empty" style="font-size:12.5px">${b.who === 'merch' ? 'This press is the merchandiser or the request’s context, not the visitor: no meter moves.' : b.who === 'engine' ? 'Nothing is sent. The engine’s own clock does this one.' : 'A page view that carries no attribute, or a reward: no meter moves.'}</p>`;
    const target = b.target && b.target();
    const standing = target ? (() => {
      const at = (state.home.current || []).findIndex((c) => c.id === target);
      const p = pieceOf(target);
      return `<li><b>${esc(p ? p.title : target)}</b> ${at > -1 ? `holds container <b>${at + 1}</b> right now.` : 'is not in the four right now.'}</li>`;
    })() : '';
    el.pdWill.innerHTML = standing + (b.will ? b.will() : []).map((w) => `<li>${w}</li>`).join('');
    const onPhone = state.view === 'phone' && state.phone.current;
    el.pdNowK.textContent = onPhone ? 'The modules right now' : 'The four right now';
    el.pdNow.innerHTML = onPhone ? mapHtml(state.phone.current.modules.map((m) => m.title))
      : (state.home.current && state.home.current.length ? mapHtml(state.home.current.map((c) => c.title)) : '<p class="pd-empty" style="font-size:12px">The homepage has not been asked yet.</p>');
  }
  function renderDone() {
    const v = cur();
    el.pdDone.innerHTML = v && v.journey.length ? v.journey.map((j) => `<li><b>${esc(j.verb)}</b> ${esc(j.what)}${j.detail ? `<div class="pd-tags">${esc(j.detail)}</div>` : ''}</li>`).join('')
      : '<li class="pd-empty">Nothing yet: the visitor has not arrived.</li>';
  }
  function captureProof(b, before) {
    const onPhone = state.view === 'phone' && state.phone.set;
    const set = onPhone ? state.phone.set : state.home.set;
    const decisions = onPhone ? [...bySlot(set, SLOTS.modules), ...bySlot(set, SLOTS.plans)] : set ? [...bySlot(set, SLOTS.hero), ...bySlot(set, SLOTS.deals)] : [];
    if (!decisions.length) { state.pdProof = null; return; }
    const beforeRows = onPhone ? ((before.phone && before.phone.modules) || []) : (before.home || []);
    const beforeIds = beforeRows.map((x) => x.id);
    const authority = (d) => (FIXTURE ? { cls: 'fixture', text: 'fixture' } : d.strategy === 'tenant-pinned' ? { cls: 'pinned', text: 'merchandiser · pinned' }
      : d.strategy === 'default' ? { cls: 'default', text: 'catalog order' }
        : (pieceOfDecision(d) || {}).eligibleWhen ? { cls: 'rule', text: 'rule, then engine' } : { cls: 'engine', text: 'engine' });
    const rows = decisions.map((d) => {
      const i = bySlot(set, d.slot).indexOf(d);
      const title = d.slot === SLOTS.plans ? ((tierOfDecision(d) || {}).name || d.customerContentId) : d.slot === SLOTS.modules ? moduleTitle(d) : ((pieceOfDecision(d) || {}).title || d.customerContentId);
      const drivers = (d.explain && d.explain.drivers) || [];
      const why = drivers.length ? drivers.map((x) => `${esc(DIM_LABEL[x.dim] || x.dim)}·${esc(x.value)} ${fmt3(x.a)} × ${x.weight}`).join('<br>') + `<br>score ${fmt3(d.score)}`
        : d.strategy === 'tenant-pinned' ? 'ranking never ran for it' : 'no dimension has evidence · the catalog’s order';
      const was = beforeIds.indexOf(d.customerContentId);
      const against = d.slot === SLOTS.hero || d.slot === SLOTS.plans ? `slot ${d.slot}` : was === -1 ? 'entered this press' : was === i ? 'held its place' : was > i ? `up from ${was + 1}` : `down from ${was + 1}`;
      const a = authority(d);
      return `<tr><td class="what">${esc(title)} → ${d.slot === SLOTS.deals ? 'container' : 'position'} ${i + 1}</td><td class="num">${why}</td><td class="against">${esc(against)}</td><td><span class="pd-auth pd-auth--${a.cls}">${esc(a.text)}</span></td></tr>`;
    }).join('');
    const main = onPhone ? bySlot(set, SLOTS.modules).map(moduleTitle) : bySlot(set, SLOTS.deals).map((d) => (pieceOfDecision(d) || {}).title || d.customerContentId);
    state.pdProof = { label: `${b.no} · ${labelOf(b)}`, why: rows, now: mapHtml(beforeRows.map((x) => x.title)), after: mapHtml(main) };
  }
  function openExplain() {
    const next = state.beat === null ? 0 : state.beat + 1;
    renderPredict(beats()[next]);
    if (state.pdProof) {
      el.pdWhy.innerHTML = state.pdProof.why;
      el.pdMapNow.innerHTML = state.pdProof.now;
      el.pdMapAfter.innerHTML = state.pdProof.after;
      el.pdWhyHead.textContent = `Why: every decision the last press made (${state.pdProof.label})`;
      el.pdWhyWrap.hidden = false;
    } else el.pdWhyWrap.hidden = true;
    el.pdNote.textContent = `Above: computed from her real profile on the published registry: a = R / (R + K), K = ${K()}, checkable by hand. Below: what the engine actually did on the last press, read off its receipts. Nothing runs from this panel.`;
    el.pdBack.hidden = false;
  }
  const closeExplain = () => { el.pdBack.hidden = true; };
  el.pdGo.addEventListener('click', closeExplain);
  el.pdBack.addEventListener('click', (e) => { if (e.target === el.pdBack) closeExplain(); });
  el.pdPill.addEventListener('click', openExplain);
  el.explainBtn.addEventListener('click', openExplain);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!el.pdBack.hidden) closeExplain(); else if (!el.cmpBack.hidden) el.cmpBack.hidden = true; else if (!el.sheetBack.hidden && !state.busy) void closeSheet(); }
    else if ((e.key === 'e' || e.key === 'E') && el.pdBack.hidden && !state.busy && !/input|textarea/i.test((e.target && e.target.tagName) || '')) openExplain();
  });
  window.addEventListener('popstate', () => {
    if (state.busy || !cur()) return;          // a beat's own Back restores the page itself (browserBack)
    void restoreFromUrl().catch((e) => say(e.message, 'bad'));
  });

  // ════════════════════════════════════════════════════════════════════════
  // FIXTURE MODE (?fixtures=1). Canned answers in the engine's own shapes, for
  // laying out and photographing the pages before lane L1's worker existed.
  // Labelled on screen; never used against a live worker.
  // ════════════════════════════════════════════════════════════════════════
  function fixtureState() {
    const steps = (state.engineFx && state.engineFx.steps) || {};
    const order = BEATS.map((b) => b.key);
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
      const [phonesDoc, details, plans, plansFx, anchor, reflex, display, manifest, engineFx] = await Promise.all([
        firstJson('phones', ['/vantage/phones.json']),
        firstJson('details', ['/vantage/fixtures/phone-details.json']),
        firstJson('plans', ['/vantage/plans.json', '/vantage/fixtures/plans.json']),
        tryJson('/vantage/fixtures/plans.json'),
        firstJson('anchor', ['/vantage/beats/anchor.json', '/vantage/fixtures/anchor.json']),
        Promise.resolve(null),                       // the registry travels in the anchor (beats/anchor.json registry)
        firstJson('display', ['/vantage/catalog.json', '/vantage/fixtures/catalog.json']),
        tryJson('/vantage/img/MANIFEST.json'),
        FIXTURE ? tryJson('/vantage/fixtures/engine.json') : Promise.resolve(null),
      ]);
      if (!phonesDoc || !Array.isArray(phonesDoc.phones)) throw new Error('phones.json is missing: lane L1 writes public/vantage/phones.json');
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
      if (state.anchor.pages) PAGES = { ...PAGES, ...state.anchor.pages };
      if (state.anchor.slots) SLOTS = { ...SLOTS, ...state.anchor.slots };
      if (state.anchor.events && state.anchor.events.source) SOURCE = state.anchor.events.source;
      if (state.anchor.brand && state.anchor.brand.name) { BRAND.name = state.anchor.brand.name; el.wordmark.textContent = BRAND.name; }
      await useCatalog(beatName('open', 'catalog'));
      // The rehearsal override applies from the first read, a direct phone-page load included; without it nothing is asserted.
      if (OVERRIDE.region) { state.ctx.region = OVERRIDE.region; state.regionSource = 'rehearsal override'; }
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
      if (QS.has('debug')) window.__vantage = { state, go, beats, handleControl, performClick };
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
