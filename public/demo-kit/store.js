/* public/demo-kit/store.js
 * The working store, the demo kit's (lane K5): the plumbing that makes a demo a working site before any beat exists.
 * It generalises OH's store (public/oh/oh-store.js, lane M3) with the same API, so a demo built on either can switch
 * to the other: the cart, navigation and the browser's Back, the manual events and the re-ask, search, where to buy,
 * the sign-in sheet on every page, the toast. It carries no demo's words and no demo's lists: every visible label is
 * read from the page's settings (site.labels, which the scaffold writes from scripts/demo-kit/lib/config.mjs
 * STORE_LABELS, the kit's neutral defaults, with demo.config.json's `labels` over them), and every seller, set price
 * and route comes from the demo's own documents and hooks.
 *
 * ── THE CONTRACT (the same as public/oh/oh-store.js's) ────────────────────────────────────────────────────────────
 *
 *   import { store } from '/demo-kit/store.js';     (one store per page; createStore() makes another, for a test)
 *
 * The page's shared section binds it once, right after createDemo: store.bind(host). Every method works from then on;
 * store.ready resolves once the documents it reads itself (the catalog's pieces, when the host does not hand them over)
 * are in. A method that needs the kit before the bind throws "store: not bound", never fails quietly. The store keeps
 * the page's rules: it never ranks (every list it shows is the feed's order or POST /sort's), it opens no door of its
 * own (the kit's transport only, X-Tenant on every call), it carries no credential, and it sends exactly the shapes the
 * beat verbs send. The buy box stays off limits to the ENGINE (nothing decided inside it); it is not dead: its controls
 * call the store.
 *
 * store.visitor   ensure() → Promise<visitor>: the visitor on the page, minted now if there is none (concurrent calls
 *                 share one mint; her cold start is read with it). The dispatcher calls it before a control, so the
 *                 first click mints her and the load never does: the boot page is the published template.
 *                 current() → the visitor or null.
 * store.events    send(type, attrs = {}, opts = {}) → Promise<{ ok, status, body } | null> (null: nobody here yet)
 *                   product_view   { sku, ...extra }: data = the product's attributes (host.productAttrs) with view: 'page'
 *                   page_view      { page }, as the engine names the page
 *                   the engine's other first-class types (add_to_cart, purchase, wishlist_add, content_click, …): data as
 *                                  given; with { sku } the product's attributes join it
 *                   anything else  (select, filter, search, compare, start_order, find_a_retailer, partner_pickup,
 *                                  retailer_referral, …): type custom, data = { event: <type>, ...attrs }, the shape the
 *                                  beats' transport.sendCustom gives; with { sku } the product's attributes join it
 *                   opts.reask     true (the page on screen) or a page key: store.reask after the send
 *                   opts.note      [verb, what, detail]: the machine's Session line (a default line otherwise; false: none)
 *                 weight(type) → the published registry's weight for that action (0: no taste).  on('sent', fn).
 * store.reask(pageKey?) → Promise<boolean>: the decided slots of a page asked again (default: the page on screen), one
 *                 call at a time; a second call for the same page while one waits joins it. Navigation asks by itself.
 * store.nav       go(path, opts) → Promise: the routes under the demo's base (site.base, '/<slug>/'):
 *                   <base>                     home          <base>m                  phone
 *                   <base>?view=<name>         grid { view } (a grid page, or a room of the store)
 *                   <base>product?id=<id>      product { id }
 *                   <base>?q=<text>            search { q }  (<base>search?q= parses too; ?q= is the canonical path, so a
 *                                                              reload reaches the shell)
 *                 It mints the visitor, then calls the page's renderer host.lanes.routes[name](route, opts) when one is
 *                 registered, else the host's openPage / openProduct (a grid no page carries goes home with a toast;
 *                 search shows its results in a sheet). The address bar gets the route by pushState unless the renderer
 *                 set it. opts.event === false: no view event (a restore). While a beat runs, a call that does not come
 *                 through the dispatcher ({ dispatched: true }) is refused, said.
 *                 back(), restore(), parse(path), href(route), navPath(name), onRoute(fn), current().
 * store.cart      add(sku, { options, addOns, fromDecisionId, qty, target, unitPrice }) → Promise<line>
 *                   options { Size: '65 in', … } shown on the line; addOns [{ id, label, price }] per unit (price null:
 *                   included); fromDecisionId the decision that put the control there, else the clicked control's decided
 *                   container, else the decided presses that opened the product (store.trail); unitPrice a configuration's
 *                   own catalog price. It refuses, with the reason, what host.sellable(p) refuses (default: out of stock,
 *                   no price). Every add sends add_to_cart with the product's attributes, { quantity, lineId, options,
 *                   addOns } and the decisions that led to it (decisionId with its contentId, slot and customerContentId;
 *                   decisionIds, newest first).
 *                 remove(lineId), setQty(lineId, n) (0 removes), clear(), lines() → [{ lineId, sku, name, image, qty,
 *                 unitPrice, listPrice, options, addOns, decisionIds, at }], count(), total() → { subtotal, addOns,
 *                 savings: [{ kind, id, title, amount, lineIds, why }], saving, total, count }: a saving only when the lines
 *                 hold every member of a set the catalog publishes a saving for (host.sets(), default: a piece in force
 *                 whose display names savings and whose featured products are its members), never a computed price.
 *                 open(), close(): the cart sheet; checkout(): the sheet that says what the demo records (one purchase
 *                 per line, against the decisions that led to it) and nothing else. on(event, fn): change, add, remove,
 *                 open, close, order. Any [data-cart-count] shows count() by itself.
 * store.search    index(products), match(text) → products in the feed's order, query(text, { event }) → Promise<{ q,
 *                 skus, status: 'sorted' | 'site' | 'none', regional, label, matched, items }>: the search event (custom
 *                 search { control, query, results }), then POST /sort over the matches. A form[data-store-search] with
 *                 an input named q goes to the search route on submit.
 * store.retailers open(product, decision?) → Promise: where to buy: buying here first, then the pickup partners, the
 *                 online sellers and the nearby stores (host.retailers(p), else the catalog's where-to-buy piece's
 *                 display.retailers, else the store's own list for the product's category); sends find_a_retailer, and
 *                 each button its named outcome (partner_pickup, retailer_referral) with the decision that earned it.
 * store.signin    open() (host.signIn.open, else the kit's sheet: a fictional account from the closed list, the worker
 *                 signs the link), account(), mount() (the header's sign-in, search and cart controls).
 * store.ui        toast(text, tone?).
 * store.trail     note(target): the dispatcher's record of a press inside a decided container; ledTo(sku); entry(id).
 * store.control(target) → Promise<boolean>: the page's dispatcher hands every [data-act="store-…"] here.
 * store.label(key, vars) → the page's words for a label (an error when the settings lack it, never an empty button).
 * store.bind(host): host = { demo, site, lanes, base, productOf, productAttrs, idOf, productName, priceOf, imageOf, field,
 *                 products(), openPage, openProduct, askPage, homeKey, pageOf, phoneKey, signIn?, outcome?(record),
 *                 and the kit's optional hooks: listPriceOf(p), pieces(), retailers(p), sets(), whereToBuy(),
 *                 sellable(p), artOf(p), weights(railName) }.
 *
 * And the kit's own, beyond OH's: store.template.of(pageName, docs) (the published template from the opening
 * documents: the pins, then the catalog's order, to the take, before anyone is decided for), store.filters (groups,
 * apply and eventOf, derived from the products' attribute map), store.variants.of(p) (sibling rows and the row's own
 * configurations), store.sort.ask(list, { weights }) (POST /sort, or the site's own order with the reason).
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * No DOM or window access at import time.
 */
import { arr, esc, hhmm, money, num, uid } from './util.js';

/** The engine's closed type list (src/events/actionTypes.ts); any other name goes as custom with data.event. */
const FIRST_CLASS = new Set(['email_open', 'form_submit', 'page_view', 'button_click', 'product_view', 'add_to_cart', 'wishlist_add',
  'purchase', 'content_impression', 'content_click', 'content_dwell', 'video_complete']);
const OUTCOMES = Object.freeze({ retailer_referral: 'a referral to a retailer, never a sale', partner_pickup: 'a pickup at a partner, never a second purchase' });
const KEPT = ['debug', 'fixtures', 'region', 'metro', 'wait', 'present'];
const MAX_CANDIDATES = 500;   // POST /sort's own bound (src/routes/sort.ts)
const words = (s) => String(s == null ? '' : s).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const whole = (n) => money(n).replace(/\.00$/, '');

/** A tiny emitter per part. */
function emitter() {
  const subs = new Map();
  return {
    on(event, fn) { if (!subs.has(event)) subs.set(event, new Set()); subs.get(event).add(fn); return () => subs.get(event).delete(fn); },
    emit(event, payload) { for (const fn of subs.get(event) || []) { try { fn(payload); } catch (error) { console.error(error); } } },
  };
}
const safe = { get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

export function createStore() {
  let H = null;
  let readyNow;
  const ready = new Promise((r) => { readyNow = r; });
  const need = () => { if (!H) throw new Error('store: not bound (the page binds the store right after createDemo)'); return H; };
  const T = () => need().demo.transport;
  const S = () => need().demo.state;
  const P = () => need().demo.panels;
  const base = () => need().base || need().site.base || '/';
  const note = (verb, what, detail) => { try { P().note(verb, what, detail); } catch { /* no panel */ } };

  // ── The words: the page's own, never this module's ─────────────────────────────────────────────
  function label(key, vars = {}) {
    const text = need().site && need().site.labels && need().site.labels[key];
    if (typeof text !== 'string') throw new Error(`the page's settings carry no "${key}" label (the scaffold writes them from demo.config.json labels over the kit's defaults)`);
    return text.replace(/\{([a-z]+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
  }
  const L = (key, vars) => esc(label(key, vars));
  const items = (n) => `${n} ${label(n === 1 ? 'itemOne' : 'itemMany')}`;

  // ── The documents the store reads: the catalog's pieces (with their page fields) ─────────────
  const DOCS = { pieces: [] };
  const pieces = () => (H && H.pieces ? arr(H.pieces()) : DOCS.pieces);
  async function loadDocs() {
    if (H.pieces) return;
    const cat = await T().tryJson(`${base()}catalog.json`);
    DOCS.pieces = arr(cat && cat.pieces);
  }
  /** A piece is in force when the document the page last read (state.pieces) holds it, its window covers now and it is in stock. */
  function inForce(piece) {
    if (!piece) return false;
    const live = S().pieces && S().pieces.size ? S().pieces.get(piece.customerContentId) : piece;
    if (!live) return false;
    const w = live.window || piece.window || null, now = Date.now();
    if (w && w.to && Date.parse(w.to) <= now) return false;
    if (w && w.from && Date.parse(w.from) > now) return false;
    return live.inStock !== false;
  }
  const artOf = (p) => (p ? (H.artOf ? H.artOf(p) : H.imageOf(p)) || null : null);
  const artHtml = (p, cls) => {
    const src = artOf(p), name = need().productName(p) || '';
    return `<span class="st-art${cls ? ` ${cls}` : ''}">${src ? `<img src="${esc(src)}" alt="${esc(name)}" loading="lazy" decoding="async" data-store-name="${esc(name)}">` : `<span class="st-noimg">${esc(name)}</span>`}</span>`;
  };
  const priceNum = (p) => { const v = num(need().priceOf(p)); return Number.isFinite(v) && v > 0 ? v : null; };
  const listNum = (p) => { const v = num(H.listPriceOf ? H.listPriceOf(p) : p && p.listPrice); return Number.isFinite(v) && v > 0 ? v : null; };
  const productOfAny = (x) => (x && typeof x === 'object' ? x : need().productOf(x));
  const fields = () => ((need().site.store || {}).fields || {});
  const fieldOf = (p, path) => (path ? need().field(p, path) : undefined);
  const inStockOf = (p) => (fields().inStock ? fieldOf(p, fields().inStock) : p && p.inStock) !== false;
  const categoryOf = (p) => fieldOf(p, (need().site.products || {}).category || 'category');
  /** What stops a product going in the cart, said, or null: the host's rule, else out of stock or no price of ours. */
  function unsellable(p) {
    if (H.sellable) return H.sellable(p) || null;
    const name = need().productName(p);
    if (!inStockOf(p)) return label('outOfStockHere', { name });
    if (priceNum(p) === null) return label('noPrice', { name });
    return null;
  }
  /** The decision a control sits in: its innermost decided container. */
  function decisionOf(target) {
    const node = target && target.closest ? target.closest('[data-op-decision-id]') : null;
    if (!node || !node.getAttribute('data-op-decision-id')) return null;
    return { decisionId: node.getAttribute('data-op-decision-id'), contentId: node.getAttribute('data-op-content') || null, slot: node.getAttribute('data-op-slot') || null, customerContentId: node.getAttribute('data-cid') || null };
  }
  const decisionData = (d) => (d && d.decisionId ? { decisionId: d.decisionId, ...(d.contentId ? { contentId: d.contentId } : {}), ...(d.slot ? { slot: d.slot } : {}), ...(d.customerContentId ? { customerContentId: d.customerContentId } : {}) } : {});

  // ── The visitor: the first click mints her, never the load ───────────────────────────────────
  let minting = null;
  async function ensure() {
    const t = T();
    if (t.cur()) { persist(t.cur()); return own(t.cur()); }
    if (!minting) {
      minting = t.ensureVisitor()
        // Kept the moment the mint answers (her session, then her consent), before the cold-start read: a reload inside
        // that read continues her. Then her arrival, as beat 1 reads it: the region from the request (never asserted), the
        // lean there, the census shown.
        .then(async (v) => { persist(v); try { await P().loadColdStart(); } catch { /* the panel says what it could not read */ } return v; })
        .finally(() => { minting = null; });
    }
    const v = own(await minting);
    persist(v);   // again after the cold-start read: it writes only when the record has changed
    return v;
  }
  /** The store's own fields on a visitor (carried over when the sign-in swaps her session: the page spreads the visitor). */
  function own(v) { if (v && !v.kitStore) v.kitStore = { id: uid().slice(0, 16), trail: [] }; return v; }

  // ── Her visitor, kept in this browser: a full load continues the same person (OH's store, lanes M3 and M3b) ────
  // The engine's shopper capability (its own 24-hour bearer) is kept as the SDK keeps it, under the SDK's own key
  // (public/sdk/edge-personalization.js: opt_shopper_session:<endpoint>:<tenant>, the endpoint being this origin), in
  // localStorage with a sessionStorage mirror; beside it, under the SDK's family of names, the record of who she is: the
  // tenant, the visitor id (subject), the session id, kind, the claims' times and grant, her consent, the cart's owner id
  // and the fictional account she signed in as. Nothing else, and no secret: the capability is her own token, signed by
  // the engine, the thing the SDK stores.
  const CAPABILITY = /^ss1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const tenantOf = () => need().site.tenant || 'demo';
  const capKey = () => `opt_shopper_session:${encodeURIComponent(location.origin)}:${encodeURIComponent(tenantOf())}`;
  const recKey = () => `opt_shopper_visitor:${encodeURIComponent(location.origin)}:${encodeURIComponent(tenantOf())}`;
  const areas = () => ['localStorage', 'sessionStorage'].map((n) => { try { return globalThis[n] || null; } catch { return null; } }).filter(Boolean);
  /** The capability's own claims (its payload is the engine's signed JSON; read here only to match the record). */
  function claimsOf(cap) {
    try { return JSON.parse(atob(cap.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
  }
  /** Keep her (visitor A, this browser's own; a second device or a fresh visitor for Compare is never kept). Writes only a change. */
  function persist(v) {
    if (!H || !v || v.key !== 'A' || !v.session || !CAPABILITY.test(String(v.session.capability || ''))) return false;
    const s = v.session;
    const rec = { version: 1, tenant: tenantOf(), subject: s.subject, sessionId: s.sessionId, kind: s.kind, grantId: s.grantId || null,
      authorityEpoch: s.authorityEpoch || null, iat: s.iat, exp: s.exp,
      // Her consent as granted at the mint (the kit's mint refuses a visitor without it); a recognized session's own
      // answer says it after the sign-in. A fresh anonymous session's consent field predates the grant, so it is not read.
      consent: { tracking: true, personalization: s.kind === 'recognized' && s.consent && typeof s.consent.personalization === 'boolean' ? s.consent.personalization : true },
      owner: own(v).kitStore.id, linked: v.linked && v.linked.account ? { account: v.linked.account } : null };
    const text = JSON.stringify(rec);
    for (const area of areas()) {
      try { if (area.getItem(capKey()) !== s.capability || area.getItem(recKey()) !== text) { area.setItem(capKey(), s.capability); area.setItem(recKey(), text); } } catch { /* storage refused */ }
    }
    return true;
  }
  /**
   * The demo's reset, or "Forget this browser": a new person from the next mint. What this browser kept goes from both
   * storage areas (her capability, her record and the cart's lines, every visitor's), whether or not anyone is on the page,
   * and the cart on screen empties: nothing of hers comes back with the next person.
   */
  function forget() {
    if (!H) return;
    for (const area of areas()) for (const key of [capKey(), recKey(), storeKey()]) { try { area.removeItem(key); } catch { /* storage refused */ } }
    LINES = []; cartOwner = null;
    try { changed(false); } catch { /* nothing on screen to redraw */ }
  }
  /** What this browser kept, when it is for this tenant, names the same visitor as its capability, and has a minute left. */
  function kept() {
    for (const area of areas()) {
      try {
        const cap = area.getItem(capKey()), rec = JSON.parse(area.getItem(recKey()) || 'null');
        if (!cap || !CAPABILITY.test(cap) || !rec || rec.version !== 1 || rec.tenant !== tenantOf()) continue;
        if (!['anonymous', 'recognized'].includes(rec.kind) || typeof rec.subject !== 'string' || typeof rec.sessionId !== 'string') continue;
        if (!Number.isSafeInteger(rec.exp) || rec.exp * 1000 <= Date.now() + 60000) continue;
        const c = claimsOf(cap);
        if (!c || c.tenant !== rec.tenant || c.subject !== rec.subject || c.sessionId !== rec.sessionId || c.exp !== rec.exp) continue;
        return { cap, rec };
      } catch { /* this area's copy is unreadable: the other may serve */ }
    }
    return null;
  }
  /**
   * On a page load (the page's boot calls it first): her visitor from this browser, continued, with no identity call and no
   * new consent, so the next action is the same person and the panel reads her accumulated profile. One read of her own
   * profile (GET /realtime/reflex, her capability, not an identity call) confirms the engine still knows the session;
   * refused (a reset, an expiry, another state), what was kept is forgotten and the page is a stranger's until her first
   * click. host.visitorFields() (optional) gives the vertical's own fields on a visitor, as the kit's mint does.
   */
  async function resume() {
    const t = T();
    if (t.cur()) return t.cur();
    const got = kept();
    if (!got) return null;
    const { cap, rec } = got;
    const session = { capability: cap, tenant: rec.tenant, subject: rec.subject, sessionId: rec.sessionId, kind: rec.kind,
      ...(rec.grantId ? { grantId: rec.grantId } : {}), ...(rec.authorityEpoch ? { authorityEpoch: rec.authorityEpoch } : {}), iat: rec.iat, exp: rec.exp,
      ...(rec.kind === 'recognized' ? { consent: rec.consent } : {}) };
    const v = { key: 'A', label: 'Shopper A', session, entry: t.landingEntry(), journey: [], ...(H.visitorFields ? H.visitorFields() : {}),
      intent: t.defaultIntent(), vector: {}, kitStore: { id: rec.owner || uid().slice(0, 16), trail: [] }, continued: true,
      ...(rec.linked && rec.linked.account ? { linked: { account: rec.linked.account, at: Date.now() } } : {}) };
    const probe = await t.api('/realtime/reflex', undefined, { visitor: v });
    if (probe.status === 401 || probe.status === 403) { forget(); return null; }
    S().visitors.A = v;
    t.useVisitor('A');
    note('continued', `Shopper A, from this browser (${rec.subject.slice(-8)})`,
      `the same visitor as before: the session kept in this browser, no identity call and no new consent · ${rec.kind} · until ${new Date(rec.exp * 1000).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`);
    return v;
  }
  const visitor = { ensure, current: () => (H ? T().cur() : null), resume, persist, forget };

  // ── The decisions that led somewhere: decided presses, by the product they opened ─────────────
  const trail = {
    note(target) {
      const v = H && T().cur();
      if (!v || !target || !target.closest) return;
      const d = decisionOf(target);
      if (!d) return;
      const sku = (target.dataset && (target.dataset.open || target.dataset.sku || target.dataset.goId)) || (target.closest('[data-open]') || { dataset: {} }).dataset.open || null;
      const list = own(v).kitStore.trail;
      list.unshift({ ...d, sku, page: S().viewPage, productId: S().productId || null, at: Date.now() });
      if (list.length > 60) list.length = 60;
    },
    ledTo(sku) {
      const v = H && T().cur();
      if (!v || !v.kitStore) return [];
      const out = [];
      for (const e of v.kitStore.trail) if (e.sku === String(sku) && !out.includes(e.decisionId)) out.push(e.decisionId);
      return out;
    },
    entry(decisionId) { const v = H && T().cur(); return (v && v.kitStore && v.kitStore.trail.find((e) => e.decisionId === decisionId)) || null; },
  };

  // ── Events: exactly the beat verbs' shapes ───────────────────────────────────────────────────
  const weight = (type) => { const w = ((S().registry || {}).weights || {})[type]; return Number.isFinite(num(w)) ? num(w) : 0; };
  const eventsBus = emitter();
  async function send(type, attrs = {}, opts = {}) {
    const h = need(), t = T();
    const v = opts.visitor || t.cur();
    if (!v) return null;
    const { sku, ...rest } = attrs || {};
    const p = sku != null ? h.productOf(sku) : (type === 'product_view' && rest.productId ? h.productOf(rest.productId) : null);
    let r, data;
    if (type === 'product_view') { data = p ? h.productAttrs(p, { view: 'page', ...rest }) : rest; r = await t.send('product_view', data, v); }
    else if (FIRST_CLASS.has(type)) { data = p ? h.productAttrs(p, rest) : rest; r = await t.send(type, data, v); }
    else {
      const name = type === 'custom' ? rest.event : type;
      if (!name) throw new Error('a custom event needs its name (data.event)');
      const { event, ...more } = rest;
      data = p ? h.productAttrs(p, more) : more;
      r = await t.sendCustom(name, data, v);
    }
    const named = type === 'custom' ? rest.event : type;
    if (opts.note !== false) {
      const [verb, what, detail] = opts.note || ['sent', named, `${p ? `${h.productName(p)} · ` : ''}by hand${weight(named) ? ` · weighs ${weight(named)} on the profile` : ' · no taste'}`];
      note(verb, what, detail);
    }
    eventsBus.emit('sent', { type, data, ok: Boolean(r && r.ok) });
    if (opts.reask) await reask(opts.reask === true ? undefined : opts.reask);
    return r;
  }
  const events = { send, weight, on: (e, fn) => eventsBus.on(e, fn) };

  // ── The re-ask: one at a time, a second call for the same page joins the first ─────────────
  let chain = Promise.resolve(true);
  const waiting = new Map();
  function reask(pageKey) {
    const h = need();
    const key = pageKey || S().viewPage;
    if (!key) return Promise.resolve(false);
    if (waiting.has(key)) return waiting.get(key);
    const run = chain.then(async () => {
      waiting.delete(key);
      if (!T().cur()) return false;
      return h.askPage(key);
    }).catch((error) => { toast(String((error && error.message) || error), 'bad'); return false; });
    waiting.set(key, run);
    chain = run;
    return run;
  }

  // ── Navigation: the routes, pushState, the browser's Back ────────────────────────────────────
  const navBus = emitter();
  let lastRoute = null;
  function parse(path) {
    let u;
    try { u = new URL(path, location.origin); } catch { return null; }
    const B = base();
    const p = u.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
    const q = u.searchParams;
    const searchRoute = (text) => { const t = String(text || '').slice(0, 120); return { name: 'search', q: t, path: `${B}?q=${encodeURIComponent(t)}` }; };
    if (p === `${B}m`) return { name: 'phone', path: `${B}m` };
    if (p === `${B}product`) return { name: 'product', id: q.get('id') || null, path: `${B}product?id=${encodeURIComponent(q.get('id') || '')}` };
    if (p === `${B}search`) return searchRoute(q.get('q'));
    if (p === B || p === B.replace(/\/$/, '') || p === `${B}grid`) {
      if (q.has('q')) return searchRoute(q.get('q'));
      const view = q.get('view');
      return view ? { name: 'grid', view, path: `${B}?view=${encodeURIComponent(view)}` } : { name: 'home', path: B };
    }
    return null;
  }
  /** Whether two addresses (or routes) are the same place: the same route, its view, product or query. */
  function same(a, b) {
    const x = typeof a === 'string' ? parse(a) : a, y = typeof b === 'string' ? parse(b) : b;
    return Boolean(x && y && x.name === y.name && (x.view || null) === (y.view || null) && (x.id || null) === (y.id || null) && (x.q || '') === (y.q || ''));
  }
  /** The canonical address of a path: the route's own (<base>search?q=x → <base>?q=x), else the path as given. */
  const canonical = (path) => { const r = parse(path); return r ? r.path : path; };
  const href = (r) => (r && r.path) || base();
  function navPath(name) {
    const B = base();
    if (!name || name === 'home') return B;
    if (name === 'phone') return `${B}m`;
    if (name === 'search') return `${B}?q=`;
    return `${B}?view=${encodeURIComponent(name)}`;
  }
  /** The address bar without the rehearsal flags the page keeps (debug, region, …). */
  function bare(loc) {
    const u = new URL(loc, location.origin);
    for (const k of KEPT) u.searchParams.delete(k);
    return u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '');
  }
  function withKept(path) {
    const q = new URLSearchParams(location.search), keep = new URLSearchParams();
    for (const k of KEPT) if (q.has(k)) keep.set(k, q.get(k));
    const extra = keep.toString();
    return extra ? `${path}${path.includes('?') ? '&' : '?'}${extra}` : path;
  }
  async function paint(r, opts) {
    const h = need();
    const lane = ((h.lanes || {}).routes || {})[r.name];
    if (lane) return lane(r, opts);
    const quietly = { event: opts.event };
    if (r.name === 'home') return h.openPage(h.homeKey(), quietly);
    if (r.name === 'phone') return h.openPage(h.phoneKey ? h.phoneKey() : h.homeKey(), quietly);
    if (r.name === 'product') return h.openProduct(r.id, quietly);
    if (r.name === 'grid') {
      if (h.pageOf(r.view)) return h.openPage(r.view, quietly);
      toast(label('notOnPage', { view: r.view }), 'bad');
      return h.openPage(h.homeKey(), quietly);
    }
    if (r.name === 'search') return searchSheet(r.q, opts);
    return false;
  }
  async function go(path, opts = {}) {
    const r = typeof path === 'string' ? parse(path) : path;
    if (!r) throw new Error(`no route of this store for ${path}`);
    if (S().busy && !opts.dispatched) { need().demo.director.say('a beat is running; the page is frozen until it lands', 'bad'); return false; }
    await ensure();
    const before = location.href;
    const out = await paint(r, opts);
    if (!opts.restore && location.href === before && bare(before) !== r.path) {
      try { history.pushState({ kitStore: true }, '', withKept(r.path)); } catch { /* sandboxed */ }
    }
    lastRoute = r;
    navBus.emit('route', r);
    mount();
    return out;
  }
  async function restore() {
    const r = parse(location.pathname + location.search) || { name: 'home', path: base() };
    const out = await paint(r, { event: false, restore: true });
    lastRoute = r;
    navBus.emit('route', r);
    mount();
    return out;
  }
  const nav = { go, back: () => history.back(), restore, parse, same, canonical, href, navPath, onRoute: (fn) => navBus.on('route', fn), current: () => lastRoute };

  // ── The cart ─────────────────────────────────────────────────────────────────────────────────
  const cartBus = emitter();
  let LINES = [];
  let cartOwner = null;            // the visitor key the lines on screen belong to
  const storeKey = () => `demo-kit:${need().site.tenant || 'demo'}:cart:v1`;
  function stored() { return safe.get(storeKey()) || {}; }
  function save() {
    const v = T().cur();
    if (!v) return;
    const all = stored();
    if (!LINES.length && !all[v.key]) return;   // an empty cart is not written where none was kept: a forgotten browser stays empty
    all[v.key] = { owner: own(v).kitStore.id, lines: LINES };
    safe.set(storeKey(), all);
  }
  /** The lines of the visitor on the page: hers from this tab's storage; a line from an earlier visitor keeps no decision. */
  function sync() {
    const v = H && T().cur();
    const key = v ? v.key : null;
    if (key === cartOwner) return;
    cartOwner = key;
    const e = key ? stored()[key] : null;
    LINES = e && Array.isArray(e.lines) ? e.lines.map((l) => (e.owner === own(v).kitStore.id ? l : { ...l, decisionIds: [], restored: true })) : [];
    changed(false);
  }
  function changed(persist = true) {
    if (persist) save();
    const t = total();
    for (const node of document.querySelectorAll('[data-cart-count]')) { node.textContent = String(t.count); node.hidden = t.count === 0 && node.hasAttribute('data-hide-empty'); node.dataset.count = String(t.count); }
    const btn = document.querySelector('[data-act="store-cart-open"][aria-label]');
    if (btn) btn.setAttribute('aria-label', `${label('cart')}, ${items(t.count)}`);
    cartBus.emit('change', { lines: lines(), total: t });
    if (S().sheet && S().sheet.kind === 'cart') openCart(true);
  }
  const lines = () => { sync(); return LINES.map((l) => ({ ...l, options: { ...l.options }, addOns: l.addOns.map((a) => ({ ...a })), decisionIds: [...l.decisionIds] })); };
  const count = () => { sync(); return LINES.reduce((n, l) => n + l.qty, 0); };
  const sameAddOns = (a, b) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));
  const sameOptions = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  function cleanAddOns(list) {
    return arr(list).filter((a) => a && (a.id || a.key || a.label)).map((a) => ({ id: String(a.id || a.key || a.label), label: String(a.label || a.id || a.key), price: Number.isFinite(num(a.price)) && num(a.price) >= 0 ? num(a.price) : null }));
  }
  async function add(sku, opts = {}) {
    const h = need();
    const v = await ensure();
    sync();
    const p = productOfAny(sku);
    const refuse = (m) => { toast(m, 'bad'); throw new Error(m); };
    if (!p) refuse(label('noProduct', { sku }));
    const id = h.idOf(p), name = h.productName(p);
    const why = unsellable(p);
    if (why) refuse(why);
    const own = num(opts.unitPrice);
    const price = Number.isFinite(own) && own > 0 ? own : priceNum(p);
    const qty = Math.max(1, Math.min(9, Math.floor(num(opts.qty) || 1)));
    const options = opts.options && typeof opts.options === 'object' ? Object.fromEntries(Object.entries(opts.options).filter(([, x]) => x !== null && x !== undefined && x !== '').map(([k, x]) => [k, String(x)])) : {};
    const addOns = cleanAddOns(opts.addOns);
    const explicit = arr(opts.fromDecisionId).filter(Boolean).map(String);
    const fromClick = opts.target ? decisionOf(opts.target) : null;
    const decisionIds = [...new Set([...explicit, ...(fromClick ? [fromClick.decisionId] : []), ...trail.ledTo(id)])];
    const lead = decisionIds[0] || null;
    const leadEntry = lead ? (fromClick && fromClick.decisionId === lead ? fromClick : trail.entry(lead) || { decisionId: lead }) : null;
    let line = LINES.find((l) => l.sku === id && l.unitPrice === price && sameOptions(l.options, options) && sameAddOns(l.addOns, addOns));
    if (line) { line.qty = Math.min(9, line.qty + qty); line.decisionIds = [...new Set([...decisionIds, ...line.decisionIds])]; }
    else {
      line = { lineId: uid().slice(0, 12), sku: id, name, image: artOf(p), qty, unitPrice: price, listPrice: listNum(p), options, addOns, decisionIds, at: Date.now() };
      LINES.push(line);
    }
    const r = await send('add_to_cart', { sku: id, quantity: qty, lineId: line.lineId, ...(Object.keys(options).length ? { options } : {}),
      ...(addOns.length ? { addOns: addOns.map((a) => a.id) } : {}), ...decisionData(leadEntry), ...(decisionIds.length ? { decisionIds } : {}) },
    { visitor: v, note: ['added', `${name}${qty > 1 ? ` ×${qty}` : ''}`, `add_to_cart, the order-start action, with its attributes${lead ? `, credited to the decision that led here (${decisionIds.length} on the trail)` : ' · no decided press led here'}`] });
    if (!r || !r.ok) toast(label('addFailed', { status: (r && r.status) || '—' }), 'bad');
    else toast(label('added', { name }), 'good');
    cartBus.emit('add', { ...line });
    changed();
    return { ...line };
  }
  function remove(lineId) {
    sync();
    const i = LINES.findIndex((l) => l.lineId === lineId);
    if (i < 0) return false;
    const [line] = LINES.splice(i, 1);
    note('removed', line.name, 'from the cart: nothing is sent, a removal is not a taste');
    cartBus.emit('remove', line);
    changed();
    return true;
  }
  function setQty(lineId, n) {
    sync();
    const line = LINES.find((l) => l.lineId === lineId);
    if (!line) return false;
    const q = Math.floor(num(n));
    if (!Number.isFinite(q) || q <= 0) return remove(lineId);
    line.qty = Math.min(9, q);
    changed();
    return true;
  }
  function clear() { sync(); LINES = []; changed(); }
  function clearAll() { safe.set(storeKey(), {}); LINES = []; cartOwner = null; changed(false); }
  /**
   * The sets the catalog prices lower: the host's (a demo's own pair rule), else every piece whose page fields publish a
   * saving (display.savings) for its featured products (display.members when it names them instead), in force now.
   */
  function sets() {
    if (H.sets) return arr(H.sets());
    return pieces().filter((x) => x && x.display && num(x.display.savings) > 0 && inForce(x)).map((x) => ({
      kind: arr(x.display.members || x.featuredProductIds).length > 2 ? 'package' : 'pair', id: x.customerContentId, title: x.title,
      members: arr(x.display.members || x.featuredProductIds).map(String), amount: num(x.display.savings),
      why: x.display.price != null && x.display.memberSum != null ? label('setWhy', { price: money(x.display.price), sum: money(x.display.memberSum) }) : label('setWhyShort'),
    })).filter((s) => s.members.length > 1);
  }
  function total() {
    sync();
    const subtotal = LINES.reduce((n, l) => n + l.unitPrice * l.qty, 0);
    const addOns = LINES.reduce((n, l) => n + l.addOns.reduce((m, a) => m + (a.price || 0), 0) * l.qty, 0);
    const used = new Set(), savings = [];
    for (const s of H ? sets() : []) {
      const found = arr(s.members).map((sku) => LINES.find((l) => l.sku === sku && !used.has(l.lineId)));
      if (!found.length || found.some((x) => !x) || !(num(s.amount) > 0)) continue;
      found.forEach((l) => used.add(l.lineId));
      savings.push({ kind: s.kind || 'package', id: s.id, title: s.title, amount: num(s.amount), lineIds: found.map((l) => l.lineId), why: s.why || '' });
    }
    const saving = savings.reduce((n, s) => n + s.amount, 0);
    return { subtotal, addOns, savings, saving, total: Math.max(0, subtotal + addOns - saving), count: LINES.reduce((n, l) => n + l.qty, 0) };
  }
  function lineHtml(l) {
    const p = need().productOf(l.sku);
    const opts = Object.entries(l.options || {}).map(([k, x]) => `${esc(k)} ${esc(x)}`).join(' · ');
    return `<div class="st-line" data-line="${esc(l.lineId)}">${p ? artHtml(p, 'st-art--line') : ''}<div class="st-line-main">
      <b class="st-line-name">${esc(l.name)}</b><span class="st-line-sku">${esc(l.sku)}${opts ? ` · ${opts}` : ''}</span>
      ${l.addOns.map((a) => `<span class="st-line-add">+ ${esc(a.label)} <em>${a.price ? money(a.price) : L('included')}</em></span>`).join('')}
      ${l.restored ? `<span class="st-line-add"><em>${L('restoredLine')}</em></span>` : ''}
      <span class="st-qty"><button type="button" class="st-qbtn" data-act="store-cart-qty" data-line="${esc(l.lineId)}" data-qty="${l.qty - 1}" data-ctl="cart-less-${esc(l.sku)}" aria-label="${L('qtyDown')}">&minus;</button>
      <b data-qty-of="${esc(l.lineId)}">${l.qty}</b><button type="button" class="st-qbtn" data-act="store-cart-qty" data-line="${esc(l.lineId)}" data-qty="${l.qty + 1}" data-ctl="cart-more-${esc(l.sku)}" aria-label="${L('qtyUp')}"${l.qty >= 9 ? ' disabled' : ''}>+</button>
      <button type="button" class="st-link" data-act="store-cart-remove" data-line="${esc(l.lineId)}" data-ctl="cart-remove-${esc(l.sku)}">${L('remove')}</button></span></div>
      <span class="st-line-price">${money(l.unitPrice * l.qty)}${l.listPrice && l.listPrice > l.unitPrice ? `<s>${money(l.listPrice * l.qty)}</s>` : ''}</span></div>`;
  }
  function openCart(refresh) {
    const t = total(), ls = lines();
    const body = `<p class="sk">${L('cartTitle')}</p><h2 id="sheetTitle">${ls.length ? `${L('cartTitle')} · ${esc(items(t.count))}` : L('cartEmpty')}</h2>`
      + (ls.length ? `<div class="st-lines">${ls.map(lineHtml).join('')}</div>`
        + `<div class="srow"><span>${L('subtotal')}</span><b>${money(t.subtotal)}</b></div>`
        + (t.addOns ? `<div class="srow"><span>${L('addOnsTotal')}</span><b>${money(t.addOns)}</b></div>` : '')
        + t.savings.map((s) => `<div class="srow st-saving" data-saving="${esc(s.kind)}"><span>${L(s.kind === 'pair' ? 'pairSaving' : 'packageSaving')} · ${esc(s.title)}${s.why ? `<br><span class="nper">${esc(s.why)}</span>` : ''}</span><b>&minus;${money(s.amount)}</b></div>`).join('')
        + `<div class="srow st-total"><span>${L('total')}</span><b data-cart-total>${money(t.total)}</b></div>`
        + `<p class="st-fine">${L('cartNote')}</p>`
        + `<div class="sactions"><button type="button" class="btn btn--brand" data-act="store-cart-checkout" data-ctl="cart-checkout">${L('checkout')}</button>`
        + `<button type="button" class="btn btn--line" data-act="store-cart-close" data-ctl="cart-continue">${L('continueShopping')}</button></div>`
        : `<p>${L('cartEmptyHint')}</p><div class="sactions"><button type="button" class="btn btn--line" data-act="store-cart-close" data-ctl="cart-continue">${L('continueShopping')}</button></div>`);
    need().demo.sheets.open('cart', body);
    if (!refresh) cartBus.emit('open', { lines: ls, total: t });
  }
  async function closeCart() { if (S().sheet && ['cart', 'checkout'].includes(S().sheet.kind)) { await need().demo.sheets.close(); cartBus.emit('close', {}); } }
  function checkoutSheet() {
    const ls = lines(), t = total();
    if (!ls.length) { openCart(); return; }
    const credited = ls.filter((l) => l.decisionIds.length).length;
    need().demo.sheets.open('checkout', `<p class="sk">${L('checkoutKicker')}</p><h2 id="sheetTitle">${L('checkoutTitle')}</h2>`
      + `<p>${L('checkoutNote', { lines: ls.length, total: money(t.total), credited, all: ls.length })}</p>`
      + `<p>${L('checkoutNothing')}</p>`
      + ls.map((l) => `<div class="srow"><span>${esc(l.name)} ×${l.qty}<br><span class="nper">${l.decisionIds.length ? L('creditedTo', { id: l.decisionIds[0].slice(-10) }) : L('noDecision')}</span></span><b>${money(l.unitPrice * l.qty)}</b></div>`).join('')
      + `<div class="sactions"><button type="button" class="btn btn--brand" data-act="store-cart-place" data-ctl="cart-place">${L('placeOrder')}</button>`
      + `<button type="button" class="btn btn--line" data-act="store-cart-open" data-ctl="cart-back">${L('backToCart')}</button></div>`);
  }
  async function placeOrder() {
    const ls = lines();
    if (!ls.length) return false;
    const v = await ensure();
    const orderId = `${need().site.slug || 'demo'}-order-${uid().slice(0, 10)}`;
    let ok = 0;
    for (const l of ls) {
      const lead = l.decisionIds[0] || null;
      const e = lead ? trail.entry(lead) || { decisionId: lead } : null;
      const r = await send('purchase', { sku: l.sku, orderId, quantity: l.qty, value: l.unitPrice * l.qty, currency: 'USD', ...decisionData(e) },
        { visitor: v, note: ['ordered', `${l.name} ×${l.qty}`, `purchase, the demo order ${orderId}${lead ? ', against the decision that led to it' : ''} · no payment`] });
      if (r && r.ok) ok += 1;
    }
    cartBus.emit('order', ls);
    LINES = [];
    changed();
    await need().demo.sheets.close();
    toast(ok === ls.length ? label('ordered', { lines: ls.length }) : label('orderPartial', { ok, all: ls.length }), ok === ls.length ? 'good' : 'bad');
    return true;
  }
  const cart = { add, remove, setQty, clear, lines, count, total, open: () => openCart(false), close: closeCart, on: (e, fn) => cartBus.on(e, fn), checkout: checkoutSheet, placeOrder };

  // ── Search: the feed by name, id and the configured fields; the order is POST /sort's ───────
  let INDEX = null;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function index(products) {
    const h = need();
    const extra = arr(((h.site.store || {}).search || {}).fields);
    INDEX = arr(products).map((p) => ({ p, hay: ` ${norm([h.idOf(p), h.productName(p), ...extra.map((f) => arr(h.field(p, f)).join(' '))].join(' '))} ` }));
    return INDEX.length;
  }
  /** Every word must match; a plural also matches its singular ("washers" finds "washer"). The feed's own order. */
  function match(text) {
    if (!INDEX) index(need().products());
    const want = norm(text).split(' ').filter(Boolean);
    if (!want.length) return [];
    return INDEX.filter((x) => want.every((w) => x.hay.includes(w) || (w.length > 3 && w.endsWith('s') && x.hay.includes(w.slice(0, -1))))).map((x) => x.p);
  }
  /** "leans with <region>'s sales · synthetic → warehouse", from the answer's own regional label; "(asserted)" when it says so. */
  function leanLabel(reg) {
    if (!reg || !reg.region) return '';
    const st = S(), key = reg.region;
    const cold = st.coldstart && st.coldstart.region && st.coldstart.region.key === key ? st.coldstart : null;
    const name = reg.level === 'global' ? label('everyRegion') : (cold && P().coldLabel()) || P().regionName(key) || key;
    const source = /synthetic/i.test(String(reg.dataSource || reg.label || 'synthetic')) ? label('leanSynthetic') : label('leanOwn');
    return `${label('leansWith', { region: name })}${reg.asserted ? ` ${label('leanAsserted')}` : ''} · ${source}`;
  }
  /** The /sort weights for a named rail of the demo config (its published weights over the registry's dimensions). */
  function weightsFor(name) {
    if (H.weights) return H.weights(name);
    let rail = null;
    for (const pg of arr(need().site.pages)) for (const r of arr(pg.sorted)) if (r && r.slot === name) rail = r;
    if (!rail || !rail.weights) return { affinity: 1 };
    const zero = Object.fromEntries(arr((S().registry || {}).dimensions).map((d) => [d.key, 0]));
    return { affinity: 1, dims: { ...zero, ...rail.weights } };
  }
  async function query(text, opts = {}) {
    const h = need();
    const q = String(text || '').trim().slice(0, 120);
    const found = match(q).filter((p) => priceNum(p) !== null);
    const v = await ensure();
    const cats = [...new Set(found.map(categoryOf).filter(Boolean))];
    if (opts.event !== false && q) await send('search', { control: 'search', query: q, results: found.length, ...(cats.length === 1 ? { category: cats[0] } : {}) }, { visitor: v, note: ['searched', `“${q}”`, `${found.length} in the feed · custom search, the beat verbs’ shape`] });
    if (!found.length) return { q, skus: [], status: 'none', regional: null, label: '', matched: 0, items: [] };
    const answer = await sort.ask(found, { weights: weightsFor('search') });
    return { q, skus: answer.order, status: answer.status === 'sorted' ? 'sorted' : 'site', regional: answer.regional, label: leanLabel(answer.regional), matched: found.length, items: answer.items, ...(answer.status === 'sorted' ? {} : { error: answer.why }) };
  }
  /** The search route until the page registers its own renderer: the results in a sheet, in /sort's order. */
  async function searchSheet(q, opts = {}) {
    const h = need();
    const res = await query(q, { event: opts.event });
    const cards = res.skus.slice(0, 24).map((sku) => {
      const p = h.productOf(sku);
      if (!p) return '';
      const price = priceNum(p), list = listNum(p);
      return `<button type="button" class="st-result" data-open="${esc(sku)}" data-ctl="result-${esc(sku)}">${artHtml(p, 'st-art--result')}<span class="st-result-name">${esc(h.productName(p))}</span>`
        + `<span class="st-result-price">${money(price)}${list && list > price ? ` <s>${money(list)}</s>` : ''}</span></button>`;
    }).join('');
    h.demo.sheets.open('search', `<p class="sk">${L('search')}</p><h2 id="sheetTitle">${res.matched ? L(res.matched === 1 ? 'resultFor' : 'resultsFor', { count: res.matched, query: res.q }) : L('noResults', { query: res.q })}</h2>`
      + (res.matched ? `<p class="st-fine">${L(res.status === 'sorted' ? 'searchSorted' : 'searchSite')}${res.label ? ` · <span class="st-lean">${esc(res.label)}</span>` : ''}</p><div class="st-results">${cards}</div>` : `<p>${L('searchHint')}</p>`));
    return res;
  }
  const search = { index, match, query };

  // ── Where to buy: buying here first, then the outcomes ──────────────────────────────────────
  const M = { sku: null, decision: null, pickup: null };
  /** The sellers for a product: the host's, else the where-to-buy piece's for its category or room, else the store's list. */
  function retailerLists(p) {
    if (H.retailers) return H.retailers(p);
    const cat = categoryOf(p);
    const room = fieldOf(p, 'attributes.room') || p.room || null;
    for (const piece of pieces()) {
      const r = piece && piece.display && piece.display.retailers;
      if (!r || Array.isArray(r) || typeof r !== 'object') continue;
      const from = r[cat] || (room && r[room]) || null;
      if (from && (from.online || from.nearby || from.pickup)) return { online: arr(from.online), nearby: arr(from.nearby), pickup: arr(from.pickup), source: 'catalog' };
    }
    const mine = arr((need().site.store || {}).retailers).filter((r) => r && r.key && r.name && (!r.categories || r.categories.includes(cat)));
    return { online: mine.filter((r) => r.kind !== 'store').map((r) => [r.key, r.name]), nearby: mine.filter((r) => r.kind === 'store' && !r.pickup).map((r) => [r.key, r.name]),
      pickup: mine.filter((r) => r.pickup).map((r) => [r.key, r.name]), source: 'store' };
  }
  /** The where-to-buy decision on the page on screen: the host's, else a decided piece whose page fields name sellers or an outcome. */
  function onScreen() {
    if (H.whereToBuy) return H.whereToBuy();
    const st = S();
    const set = st.sets[st.viewPage] || null;
    const ds = arr(set && set.decisions);
    const byCid = new Map(pieces().map((x) => [x.customerContentId, x]));
    const i = ds.findIndex((d) => { const x = byCid.get(d.customerContentId); return x && x.display && (x.display.retailers || x.display.outcome); });
    return i < 0 ? null : { decisionId: ds[i].decisionId, contentId: ds[i].contentId, slot: ds[i].slot, customerContentId: ds[i].customerContentId, position: i + 1 };
  }
  async function openRetailers(product, decision) {
    const h = need();
    const p = productOfAny(product || S().productId);
    if (!p) throw new Error('where to buy belongs to a product');
    await ensure();
    const sku = h.idOf(p), name = h.productName(p);
    M.sku = sku;
    M.decision = decision && decision.decisionId ? decision : onScreen();
    M.pickup = M.decision;
    const lists = retailerLists(p);
    const region = (S().own && (S().own.label || S().own.key)) || P().ownName();
    const sold = !unsellable(p);
    const row = (key, name2, where) => `<div class="srow"><span><b>${esc(name2)}</b><br><span class="nper">${where === 'nearby' ? L('nearbyNote', { region }) : L('onlineNote')}</span></span>`
      + `<button type="button" class="btn btn--line btn--sm" data-act="store-referral" data-sku="${esc(sku)}" data-retailer="${esc(key)}" data-retailer-name="${esc(name2)}" data-where="${where}" data-ctl="retailer-${where === 'nearby' ? 'nearby-' : ''}${esc(key)}">${L('referral')}</button></div>`;
    const pickupRow = (key, name2) => `<div class="srow"><span><b>${L('pickupAt', { partner: name2 })}</b><br><span class="nper">${L('pickupNote')}</span></span>`
      + `<button type="button" class="btn btn--line btn--sm" data-act="store-pickup" data-sku="${esc(sku)}" data-retailer="${esc(key)}" data-retailer-name="${esc(name2)}" data-ctl="retailer-pickup-${esc(key)}">${L('pickup')}</button></div>`;
    h.demo.sheets.open('retailers', `<p class="sk">${L('findRetailer')} · ${esc(sku)}</p><h2 id="sheetTitle">${L('retailersTitle', { name })}</h2>`
      + `<p class="st-h">${L('buyDirect')}</p>`
      + (sold ? `<div class="srow"><span><b>${L('fromStore', { store: h.site.name || '' })}</b> ${money(priceNum(p))}<br><span class="nper">${L('samePrice')}</span></span><button type="button" class="btn btn--brand btn--sm" data-act="store-retailer-buy" data-sku="${esc(sku)}" data-ctl="retailer-buy-direct">${L('addToCart')}</button></div>`
        : `<div class="srow"><span><b>${L('fromStore', { store: h.site.name || '' })}</b><br><span class="nper">${esc(unsellable(p))}</span></span></div>`)
      + arr(lists.pickup).map(([k, l]) => pickupRow(k, l)).join('')
      + (arr(lists.online).length ? `<p class="st-h">${L('onlineSellers')}</p>${arr(lists.online).map(([k, l]) => row(k, l, 'online')).join('')}` : '')
      + (arr(lists.nearby).length ? `<p class="st-h">${L('nearbyStores')}</p>${arr(lists.nearby).map(([k, l]) => row(k, l, 'nearby')).join('')}` : '')
      + (!arr(lists.pickup).length && !arr(lists.online).length && !arr(lists.nearby).length ? `<p class="st-fine">${L('noSellers')}</p>` : '')
      + `<p class="st-fine">${L(M.decision ? 'outcomeCredited' : 'outcomeUncredited')} ${L('outcomeNote')}</p>`);
    await send('find_a_retailer', { sku, retailer: 'find-a-retailer', control: decision ? 'where-to-buy' : 'buy-box' }, { note: ['opened', `where to buy · ${name}`, M.decision ? 'from a decided module: its outcomes are credited to it' : 'the buy box’s own button, the same for everyone'] });
    return true;
  }
  async function outcome(event, t) {
    const h = need();
    const p = productOfAny((t && t.dataset && t.dataset.sku) || M.sku);
    if (!p) throw new Error('where to buy first: the outcome belongs to a product');
    const at = event === 'partner_pickup' ? M.pickup : M.decision;
    const key = (t && t.dataset && t.dataset.retailer) || '', partner = (t && t.dataset && t.dataset.retailerName) || key;
    const r = await send(event, { sku: h.idOf(p), ...decisionData(at), retailer: event === 'partner_pickup' ? key : 'find-a-retailer', ...(event === 'retailer_referral' ? { partner: key, where: (t && t.dataset.where) || 'online' } : {}) },
      { note: ['outcome', `${event} · ${partner}`, `${h.productName(p)} · ${at ? `credited to the decision that earned it${at.position ? ` (#${at.position})` : ''}` : 'credited to no decision'} · ${OUTCOMES[event]}`] });
    if (!r || !r.ok || (r.body && r.body.success === false)) throw new Error(`the engine did not take the ${event} (${(r && r.status) || 'no answer'})`);
    if (h.outcome) h.outcome({ event, sku: h.idOf(p), cid: at ? at.customerContentId : null, decisionId: at ? at.decisionId : null, position: at ? at.position || null : null, retailerName: partner, at: Date.now(), credited: Boolean(at) });
    await h.demo.sheets.close();
    toast(label(event === 'partner_pickup' ? 'pickupChosen' : 'referred', { partner, name: h.productName(p) }), 'good');
    return true;
  }
  /**
   * A decided pickup module's own button: the same partner_pickup as the sheet's pickup row, at the product's first pickup
   * partner in its lists, credited to that module's decision (else the where-to-buy decision on the page).
   */
  async function pickup(product, decision) {
    const h = need();
    const p = productOfAny(product || S().productId);
    if (!p) throw new Error('a pickup belongs to a product');
    const [key, partner] = arr(retailerLists(p).pickup)[0] || [];
    if (!key) throw new Error(`no pickup partner is listed for ${h.productName(p)}`);
    await ensure();
    M.sku = h.idOf(p);
    M.pickup = decision && decision.decisionId ? decision : onScreen();
    return outcome('partner_pickup', { dataset: { sku: M.sku, retailer: key, retailerName: partner || key } });
  }
  const retailers = { open: openRetailers, pickup };

  // ── Sign in, from any page's header ──────────────────────────────────────────────────────────
  const accounts = () => arr(need().site.signIn && need().site.signIn.accounts);
  const linkOf = (v) => (v && v.linked) || null;
  const firstName = (name) => String(name || '').split(' ')[0];
  function openSignIn() {
    if (H.signIn && H.signIn.open) return H.signIn.open();
    const v = T().cur(), link = linkOf(v);
    const rows = accounts().map((name) => `<div class="srow"><span><b>${esc(name)}</b><br><span class="nper">${L('demoAccount')}</span></span>`
      + `<button type="button" class="btn btn--brand btn--sm" data-act="store-signin-as" data-account="${esc(name)}" data-ctl="sign-in-as"${link ? ' disabled' : ''}>${L('signInAs', { name: firstName(name) })}</button></div>`).join('');
    need().demo.sheets.open('sign-in', `<p class="sk">${L('signIn')}</p><h2 id="sheetTitle">${link ? L('signedInAs', { account: link.account }) : L('signInTo', { store: need().site.name || '' })}</h2>`
      + `<p>${L('signInNote')}</p>${rows || `<p>${L('noAccounts')}</p>`}<p class="st-fine">${L('signInFine')}</p>`);
    return true;
  }
  /** The kit's sign-in: the demo's own route signs the link (src/routes/<slug>.ts); the page receives the session it carries next. */
  async function signInAs(name) {
    if (!accounts().includes(name)) throw new Error(`${name} is not one of the demo accounts`);
    let v = await ensure();
    if (linkOf(v)) { await need().demo.sheets.close(); return true; }
    const route = (need().site.signIn && need().site.signIn.route) || `${base()}api/sign-in`;
    const r = await T().api(route, { account: name }, { visitor: v });
    const b = r.body || {};
    if (r.status === 404) throw new Error(`this demo's worker mounts no sign-in route yet (${route} answered 404): the sign-in is the demo's own route, in src/routes/<slug>.ts`);
    if (!r.ok || b.ok !== true || b.linked !== true || !b.session || !b.session.capability) throw new Error(`the sign-in was refused: ${b.error || `the route answered ${r.status || 'nothing'}`}`);
    // The person's session from now on: the link retired her anonymous one.
    v = { ...v, session: b.session, linked: { account: name, at: Date.now() } };
    S().visitors[v.key] = v;
    T().useVisitor(v.key);
    await need().demo.sheets.close();
    note('signed in', name, 'the worker signed the link for this browser; the page never held the secret · the next request is the person’s');
    const node = document.getElementById('signIn');
    if (node) node.textContent = label('greeting', { name: firstName(name) });
    await reask();
    return true;
  }
  /** The header on the page carries a sign-in control, a search form and a cart button with its count; what is there is kept. */
  function mount() {
    if (!H) return;
    const header = document.querySelector('#site .site-header');
    if (!header) return;
    for (const node of header.querySelectorAll('[data-cart-count]')) node.textContent = String(count());
    if (header.dataset.storeHeader === 'own') return;      // a header that carries its own pieces is left as it is
    const sign = document.getElementById('signIn');
    if (sign && !sign.dataset.act) { sign.dataset.act = 'store-signin'; sign.dataset.ctl = 'sign-in'; sign.setAttribute('role', 'button'); sign.tabIndex = 0; }
    const mast = header.querySelector('.mast') || header;
    if (!sign && !header.querySelector('[data-act="store-signin"],[data-act="sign-in"]')) mast.insertAdjacentHTML('beforeend', `<button type="button" class="u-sign st-sign" id="signIn" data-act="store-signin" data-ctl="sign-in">${L('signIn')}</button>`);
    if (!header.querySelector('form[data-store-search]')) {
      mast.insertAdjacentHTML('beforeend', `<form class="st-search" data-store-search role="search"><input name="q" type="search" placeholder="${L('searchPlaceholder')}" aria-label="${L('search')}" autocomplete="off" data-ctl="search-input"><button type="submit" class="st-search-go" data-ctl="search-go" aria-label="${L('search')}">${L('search')}</button></form>`);
    }
    if (!header.querySelector('[data-act="store-cart-open"]')) {
      mast.insertAdjacentHTML('beforeend', `<button type="button" class="st-cart" data-act="store-cart-open" data-ctl="cart-open" aria-label="${L('cart')}">${L('cart')} <span class="st-cart-n" data-cart-count>0</span></button>`);
    }
    for (const node of header.querySelectorAll('[data-cart-count]')) node.textContent = String(count());
  }
  const signin = { open: openSignIn, account: () => (H && H.signIn && H.signIn.account ? H.signIn.account() : (linkOf(H && T().cur()) || {}).account || null), mount, as: signInAs };

  // ── The toast ────────────────────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, tone) {
    let node = document.getElementById('storeToast');
    if (!node) {
      document.body.insertAdjacentHTML('beforeend', '<div class="st-toast" id="storeToast" role="status" aria-live="polite" hidden></div>');
      node = document.getElementById('storeToast');
    }
    node.textContent = String(text || '');
    node.dataset.tone = tone || '';
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4000);
  }
  const ui = { toast };

  // ── POST /sort: the engine's order for her, or the site's own with the reason ───────────────
  const sort = {
    /**
     * The engine's order over a candidate set (the products as the feed lists them, each with its attributes). With
     * no visitor, the site's own order and why; a 503 before her first captured event is said as such.
     * → { status: sorted | site | no-capture | down, why, order: [ids], items, regional, label }
     */
    async ask(list, o = {}) {
      const h = need();
      const pool = arr(list).slice(0, MAX_CANDIDATES);
      const siteOrder = pool.map((p) => String(h.idOf(p)));
      const v = T().cur();
      if (!v) return { status: 'site', why: label('sortNoVisitor'), order: siteOrder, items: [], regional: null, label: '' };
      if (!pool.length) return { status: 'site', why: label('sortEmpty'), order: [], items: [], regional: null, label: '' };
      const candidates = pool.map((p) => { const { productId, ...attrs } = h.productAttrs(p); return { id: String(productId ?? h.idOf(p)), ...attrs }; });
      const asserted = S().ctx && S().ctx.region;
      const r = await T().api('/sort', { userId: v.session.subject, sessionId: v.session.sessionId, candidates, weights: o.weights || weightsFor(o.rail || null),
        ...(asserted ? { context: { region: asserted } } : {}) }, { visitor: v });
      if (!r.ok || !r.body || !Array.isArray(r.body.order)) {
        const why = r.status === 503 ? label('sortNoCapture') : label('sortDown', { why: (r.body && r.body.error) || r.status || '—' });
        return { status: r.status === 503 ? 'no-capture' : 'down', why, order: siteOrder, items: [], regional: null, label: '' };
      }
      return { status: 'sorted', why: label('sortDecided'), order: r.body.order.map(String), items: arr(r.body.items), regional: r.body.regional || null, label: leanLabel(r.body.regional) };
    },
    weights: (name) => weightsFor(name),
  };

  // ── The published template: what the site shows before anyone is decided for ────────────────
  const template = {
    /**
     * Per slot of a page: the opening slots document's pins, then the pieces that name the slot, in the catalog's
     * order (display.order, then the file's), live, in window at the documents' own anchor, in stock and with no
     * eligibility rule (a rule fails closed with no context), to the slot's take. docs: { catalog, slots, display, anchor }.
     */
    of(pageName, docs) {
      const { catalog, slots, display = new Map(), anchor } = docs || {};
      const all = arr(catalog && catalog.pieces);
      const at = Number.isFinite(Date.parse(anchor || '')) ? Date.parse(anchor) : Date.now();
      const open = (p) => (!p.lifecycle || !p.lifecycle.status || p.lifecycle.status === 'live') && p.inStock !== false && !p.eligibleWhen
        && (!p.window || ((!p.window.from || Date.parse(p.window.from) <= at) && (!p.window.to || Date.parse(p.window.to) > at)));
      const byId = new Map(all.map((p) => [p.id, p]));
      const orderOf = (p) => { const d = display.get(p.customerContentId) || {}; return d.order !== null && d.order !== undefined && d.order !== '' && Number.isFinite(Number(d.order)) ? Number(d.order) : Infinity; };
      const out = {};
      for (const s of arr(slots && slots.pages && slots.pages[pageName])) {
        const pinned = arr(s.pinnedPieceIds).map((id) => byId.get(id)).filter((p) => p && open(p));
        const rest = all.map((p, i) => ({ p, i })).filter(({ p }) => arr(p.slotTypes).includes(s.slot) && open(p) && !pinned.includes(p))
          .sort((a, b) => (orderOf(a.p) - orderOf(b.p)) || (a.i - b.i)).map(({ p }) => p);
        out[s.slot] = [...pinned, ...rest].slice(0, s.take || 1);
      }
      return out;
    },
  };

  // ── Filters, derived from the attribute map ─────────────────────────────────────────────────
  const onSaleOf = (p) => { const l = listNum(p), s = priceNum(p); return l !== null && s !== null && l > s; };
  const NICE = [1, 2, 2.5, 5, 10];
  const nice = (x) => { if (!(x > 0)) return 0; const e = 10 ** Math.floor(Math.log10(x)); return NICE.map((n) => n * e).reduce((b, n) => (Math.abs(n - x) < Math.abs(b - x) ? n : b)); };
  /** Price bands: the configured edges, else round edges near the candidates' quartiles. */
  function bandsOf(prices) {
    let e = arr((need().site.store || {}).priceBands).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (!e.length) {
      const s = prices.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      if (s.length < 4) return [];
      e = [...new Set([0.25, 0.5, 0.75].map((q) => nice(s[Math.floor(q * (s.length - 1))])))].filter((x) => x > s[0] && x < s[s.length - 1]);
    }
    const out = [];
    for (let i = 0; i <= e.length; i += 1) {
      const lo = i ? e[i - 1] : null, hi = i < e.length ? e[i] : null;
      out.push({ value: `${lo ?? 0}-${hi ?? 'up'}`, lo, hi, label: lo === null ? label('under', { price: whole(hi) }) : hi === null ? label('andUp', { price: whole(lo) }) : label('range', { lo: whole(lo), hi: whole(hi) }) });
    }
    return out;
  }
  function parseBand(v) { const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?|up)$/.exec(String(v)); return m ? { lo: Number(m[1]) || null, hi: m[2] === 'up' ? null : Number(m[2]) } : null; }
  function inBand(x, b) { return Number.isFinite(x) && (b.lo === null || b.lo === undefined || x >= b.lo) && (b.hi === null || b.hi === undefined || x < b.hi); }
  const attributes = () => ((need().site.products || {}).attributes || {});
  const filters = {
    /**
     * The filter groups for a candidate set: each attribute of the products map (or of store.filters, in its order) with
     * two values or more among them, then the price band, in stock and on sale. Value counts are over the candidates.
     */
    groups(list, o = {}) {
      const st = need().site.store || {};
      const attrs = attributes();
      const keys = arr(st.filters).length ? arr(st.filters) : Object.keys(attrs).filter((k) => !/price/i.test(k));
      const max = Number(st.filterValues) || 14;
      const out = [];
      for (const key of keys) {
        const path = attrs[key];
        if (!path) continue;
        const counts = new Map();
        for (const p of list) for (const v of arr(fieldOf(p, path))) if (v !== null && v !== undefined && v !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1);
        if (counts.size < 2 || counts.size > max) continue;
        out.push({ key, label: (o.labels && o.labels[key] && words(o.labels[key])) || words(key), values: [...counts].map(([value, n]) => ({ value, count: n, label: (o.valueLabel ? o.valueLabel(key, value) : null) || words(value) })) });
      }
      const bands = bandsOf(list.map(priceNum));
      if (bands.length > 1) {
        const values = bands.map((b) => ({ ...b, count: list.filter((p) => inBand(priceNum(p), b)).length })).filter((b) => b.count > 0);
        if (values.length > 1) out.push({ key: 'price', label: label('filterPrice'), values });
      }
      const flags = [];
      if (list.some((p) => !inStockOf(p)) && list.some(inStockOf)) flags.push({ value: 'in-stock', label: label('inStock'), count: list.filter(inStockOf).length });
      if (list.some(onSaleOf)) flags.push({ value: 'on-sale', label: label('onSale'), count: list.filter(onSaleOf).length });
      if (flags.length) out.push({ key: 'show', label: label('filterShow'), values: flags });
      return out;
    },
    /** The candidates that pass every chosen group (one value of a group is enough; every group must pass). */
    apply(list, chosen = {}) {
      const attrs = attributes();
      const groups = Object.entries(chosen).filter(([, set]) => set && set.size);
      if (!groups.length) return list.slice();
      const bands = bandsOf(list.map(priceNum));
      return list.filter((p) => groups.every(([key, set]) => {
        if (key === 'price') return [...set].some((v) => { const b = bands.find((x) => x.value === v) || parseBand(v); return b && inBand(priceNum(p), b); });
        if (key === 'show') return [...set].every((v) => (v === 'in-stock' ? inStockOf(p) : v === 'on-sale' ? onSaleOf(p) : true));
        const path = attrs[key];
        return path ? arr(fieldOf(p, path)).some((v) => set.has(String(v))) : true;
      }));
    },
    /** What a filter's event carries: the attribute it narrows under the dimension's own key, so it is taste the engine reads. */
    eventOf(key, value) { return key === 'price' || key === 'show' ? { control: 'filter', filter: key, value } : { control: 'filter', filter: key, value, [key]: value }; },
  };

  // ── Variants: the selectors a product page offers ────────────────────────────────────────────
  const variants = {
    /**
     * [{ label, kind: 'sibling' | 'config', options: [{ id, label, on, price }] }]. A sibling selector lists the rows that
     * share every `by` field with this one, one per value of its `option` field (a size, a colour); a config selector
     * lists the row's own configurations (products.variants: { list, key, attributes }), each with its own price.
     */
    of(p, o = {}) {
      if (!p) return [];
      const h = need();
      const out = [];
      const all = arr(h.products());
      const blank = (v) => v === null || v === undefined || v === '';
      for (const def of arr((h.site.store || {}).variants)) {
        if (!def || !def.option || !arr(def.by).length) continue;
        const mine = arr(def.by).map((f) => fieldOf(p, f));
        if (mine.some(blank) || blank(fieldOf(p, def.option))) continue;
        const byValue = new Map();
        for (const x of all) {
          if (!arr(def.by).every((f, i) => fieldOf(x, f) === mine[i])) continue;
          const v = fieldOf(x, def.option);
          if (blank(v)) continue;
          if (!byValue.has(String(v)) || h.idOf(x) === h.idOf(p)) byValue.set(String(v), x);
        }
        if (byValue.size < 2) continue;
        const numeric = [...byValue.keys()].every((v) => Number.isFinite(Number(v)));
        const sorted = [...byValue.entries()].sort((a, b) => (numeric ? Number(a[0]) - Number(b[0]) : 0));
        out.push({ label: def.label || words(String(def.option).split('.').pop()), kind: 'sibling', options: sorted.map(([v, x]) => ({ id: String(h.idOf(x)),
          label: `${def.prefix || ''}${numeric ? v : (o.valueLabel ? o.valueLabel(def.option, v) : null) || words(v)}${def.suffix || ''}`, on: h.idOf(x) === h.idOf(p), price: priceNum(x) })) });
      }
      const inline = h.site.products && h.site.products.variants;
      if (inline && inline.list) {
        const list = arr(fieldOf(p, inline.list));
        if (list.length > 1) {
          const priceKey = Object.entries(inline.attributes || {}).find(([k]) => /price/i.test(k));
          out.push({ label: inline.label || words(inline.key), kind: 'config', options: list.map((c, i) => ({ id: String(c[inline.key]), label: String(c.label || c[inline.key]), on: o.config ? String(c[inline.key]) === String(o.config) : i === 0,
            price: priceKey ? num(c[priceKey[1]]) : null })) });
        }
      }
      return out;
    },
  };

  // ── The dispatcher's share ───────────────────────────────────────────────────────────────────
  async function control(t) {
    const act = t && t.dataset ? t.dataset.act : null;
    if (!act || !act.startsWith('store-')) return false;
    const d = t.dataset;
    switch (act) {
      case 'store-cart-open': openCart(false); return true;
      case 'store-cart-close': await closeCart(); return true;
      case 'store-cart-qty': setQty(d.line, d.qty); return true;
      case 'store-cart-remove': remove(d.line); return true;
      case 'store-cart-checkout': checkoutSheet(); return true;
      case 'store-cart-place': return placeOrder();
      case 'store-add': await add(d.sku, { target: t, qty: d.qty, ...(H.selection ? H.selection(d.sku) || {} : {}) }); return true;
      case 'store-retailers': return openRetailers(d.sku, decisionOf(t));
      case 'store-retailer-buy': await need().demo.sheets.close(); await add(d.sku, { fromDecisionId: M.decision ? M.decision.decisionId : null, ...(H.selection ? H.selection(d.sku) || {} : {}) }); return true;
      case 'store-pickup': return outcome('partner_pickup', t);
      case 'store-referral': return outcome('retailer_referral', t);
      case 'store-nav': return go(d.href || base(), { dispatched: true });
      case 'store-signin': openSignIn(); return true;
      case 'store-signin-as': return signInAs(d.account);
      case 'store-search': {
        const form = t.closest ? t.closest('form[data-store-search]') : null;
        const q = String((d.q !== undefined ? d.q : form && form.elements.q ? form.elements.q.value : '') || '').trim();
        if (!q) { if (form && form.elements.q) form.elements.q.focus(); return true; }
        return go(`${base()}?q=${encodeURIComponent(q)}`, { dispatched: true });
      }
      default: return false;
    }
  }

  // ── The bind ─────────────────────────────────────────────────────────────────────────────────
  function bind(host) {
    if (H) throw new Error('store: bound twice');
    H = host;
    if (!H.lanes) H.lanes = {};
    if (!H.lanes.routes) H.lanes.routes = {};
    // Visitor A is kept the moment the kit mints her (ensureVisitor: a press, a direct product address, the director's first
    // press) and whenever the page switches to her (useVisitor('A'): the arrival, the sign-in's swap, back from a phone).
    const t = T(), useVisitor = t.useVisitor, ensureVisitor = t.ensureVisitor;
    if (typeof useVisitor === 'function') t.useVisitor = (key) => { useVisitor(key); if (key === 'A') persist(t.cur()); };
    if (typeof ensureVisitor === 'function') t.ensureVisitor = async () => { const v = await ensureVisitor(); persist(v); return v; };
    // A new walk (beat 1's arrival) is a new stranger: her cart starts empty.
    if (Array.isArray(H.lanes.beforeBeat)) H.lanes.beforeBeat.push((b) => { if (b && b.data && b.data.arrives) clearAll(); });
    // An image that cannot load becomes its product's name on the tile: never a broken image.
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-store-name')) return;
      const tile = document.createElement('span');
      tile.className = 'st-noimg';
      tile.textContent = img.getAttribute('data-store-name') || '';
      img.replaceWith(tile);
    }, true);
    // The header's search: a submit is a press like any other, refused while a beat runs.
    document.addEventListener('submit', (e) => {
      const form = e.target && e.target.closest ? e.target.closest('form[data-store-search]') : null;
      if (!form) return;
      e.preventDefault();
      const q = String((form.elements.q && form.elements.q.value) || '').trim();
      if (!q) return;
      void go(`${base()}?q=${encodeURIComponent(q)}`).catch((error) => toast(String((error && error.message) || error), 'bad'));
    });
    void loadDocs().then(() => { mount(); readyNow(true); }).catch(() => readyNow(false));
    return api;
  }

  const api = {
    bind, ready, control, visitor, events, reask, nav, cart, search, retailers, signin, ui, trail,
    template, filters, variants, sort, label,
    /** For the suites and the console under ?debug: what the store holds, read-only. */
    debug: () => ({ lines: H ? lines() : [], total: H ? total() : null, route: lastRoute, trail: (H && T().cur() && T().cur().kitStore) ? [...T().cur().kitStore.trail] : [], when: hhmm(Date.now()) }),
  };
  return api;
}

/** The page's store: one per page, bound by the page's shared section. */
export const store = createStore();
