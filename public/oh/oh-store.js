/* public/oh/oh-store.js
 * OH's store: the plumbing that makes OH a working site (docs/lg/OH-Demo-Design.md §9, lane M3).
 *
 * ── THE CONTRACT ── published 2026-10-02 15:11 EDT for lanes M1 and M2, who build against it ─────────────────────
 *
 *   import { store } from '/oh/oh-store.js';      (oh.js imports it once, at the top; every section shares it)
 *
 * oh.js's shared section binds it once, right after createDemo: store.bind(host). Every method works from then on;
 * store.ready resolves once the documents it reads itself (catalog.json, img/index.json) are in. A method that needs
 * the kit before the bind throws "oh-store: not bound", never fails quietly. The store keeps the page's rules: it never
 * ranks (no sort, no score: every list it shows is the feed's order or POST /sort's), it opens no door of its own (the
 * kit's transport only, X-Tenant on every call), it carries no credential, and it sends exactly the shapes the beat
 * verbs send. The buy box stays off limits to the ENGINE (nothing decided inside it); it is not dead: its controls
 * call the store.
 *
 * store.visitor
 *   ensure()          → Promise<visitor>. The visitor on the page, minted now if there is none. The dispatcher calls it
 *                       before every control, so the first click mints her and the load never does (the boot page is
 *                       the published template, M1's). Concurrent calls share one mint.
 *   current()         → the visitor or null.
 *   resume()          → Promise<visitor | null>. oh.js's boot calls it first: her visitor kept in this browser, continued
 *                       with no identity call and no new consent (localStorage, the SDK's key opt_shopper_session:<origin>
 *                       :<tenant> for the capability and opt_shopper_visitor:<origin>:<tenant> for the record, with a
 *                       sessionStorage mirror); null when nothing valid is kept or the engine refuses the session.
 *   persist(v)        keeps visitor A the moment the mint answers (the kit's ensureVisitor, wrapped at the bind: the first
 *                     click, a direct product address, the director's first press), and on the arrival, the sign-in's
 *                     swap (useVisitor('A'), wrapped) and the boot. It writes only when the record has changed.
 *   forget()          the demo's reset and "Forget this browser": a new person from the next mint; the capability, the
 *                     record and every visitor's cart leave both storage areas, and the cart on screen empties.
 *
 * store.events
 *   send(type, attrs = {}, opts = {}) → Promise<{ ok, status, body } | null>   (null: nobody on the page yet)
 *     product_view    attrs { sku, ...extra }: type product_view, data = the product's own attributes as productAttrs
 *                     builds them ({ productId, category, …, price_usd, view: 'page', ...extra }): P2's beat shape
 *     page_view       { page } as the engine names it ('home', 'tvs', 'product')
 *     add_to_cart, purchase, wishlist_add, content_click: the engine's first-class types, data as given (with { sku }
 *                     the product's attributes join it)
 *     anything else   (select, filter, search, compare, start_order, find_a_retailer, partner_pickup,
 *                     retailer_referral, …): type 'custom', data = { event: <type>, ...attrs }, the shape the beats'
 *                     transport.sendCustom gives; with { sku } the product's attributes join it. The engine's type
 *                     list is closed (src/events/actionTypes.ts), so a manual action maps to one of its types or to
 *                     custom with data.event, never to a new type.
 *     opts.reask      true (the page on screen) or a page key: store.reask after the send.
 *     After every send that lands, the panel's dimension rows are drawn at once from the action's own answer when it
 *     carries the state after the event (update.data.affinity.dims), then her profile is read again and "What has been
 *     signalled", the who chip, Why these and the before/now strips on screen are redrawn (refreshSignals), as after a
 *     director's press; with opts.reask the rows are drawn from the answer (or her profile read at once, when the
 *     answer carries no state) before the page is asked again, and the re-ask's read confirms them. An event about a
 *     product always carries productAttrs(p) under its own fields; a sku the feed does not hold is sent with its id
 *     only, and the Session panel says so. The page's own sends straight to the kit's transport (a page view, a product
 *     view, a declared fit) get the same early draw by hand, never in a beat (the bind wraps transport.send).
 *     opts.note       [verb, what, detail]: the machine's Session line (a default line is written otherwise).
 *   weight(type)      → the published registry's weight for that action (anchor.json registry.weights); 0 = no taste.
 *
 * store.reask(pageKey?) → Promise<boolean>
 *   Asks the decided slots of a page again (default: the page on screen) through the sections' own question
 *   (LANES.ask, then the shared askPage): the slots repaint in the engine's order, the before/now rows rotate, the
 *   receipts are read again, the meters and Why these refresh. Calls are queued one at a time (parallel asks met a 503
 *   on a fresh state) and a second call for the same page while one waits joins it. Call it after an event that
 *   changes taste on a page that stays put (a filter, a selector); navigation asks by itself.
 *
 * store.nav
 *   go(path, opts = {}) → Promise. Routes, all under /oh/:
 *       /oh/                                 home
 *       /oh/?view=tvs|laundry|kitchen|offers grid   { view }
 *       /oh/product?id=<sku>                 product { id }
 *       /oh/?q=<text>                        search  { q }   (/oh/search?q= is read too, client only, and
 *                                            written back as /oh/?q=: the worker serves /oh/ on a reload)
 *       /oh/m                                phone
 *     It mints the visitor, then calls the section's renderer LANES.routes[name](route, opts) when one is registered,
 *     else the shared one (openPage / openProduct; a grid view no page carries yet goes home with a toast; search
 *     shows its results in a sheet). The address bar gets the route by pushState, so the browser's Back works; a
 *     renderer that already set it is not pushed twice. opts.event === false: no page_view/product_view (a restore).
 *     While a beat runs, a call that does not come through the dispatcher ({ dispatched: true }) is refused, said.
 *     A route renderer receives (route, opts) with route = { name, path, view?, id?, q? } and returns when painted.
 *   back()            the browser's own Back (history.back(); the kit's popstate restores through store.nav.restore).
 *   restore()         paints the route the address bar holds, sending no view event (oh.js's restoreFromUrl).
 *   parse(path)       → route | null.        href(route) → its canonical path.     canonical(path) → the same.
 *   same(a, b)        → whether two addresses or routes are the same place (route, view, product, query).
 *   navPath(name)     → the path a data-nav name goes to ('home', 'tvs', 'laundry', 'kitchen', 'offers', 'phone').
 *   onRoute(fn)       fn(route) after every route is painted; returns an unsubscribe function.
 *   current()         → the route last painted, or null.
 *   Markup: any [data-nav="<name>"] or [data-open="<sku>"] goes through go(); [data-act="store-nav"][data-href] too.
 *
 * store.cart (persisted per visitor in sessionStorage; a new walk, beat 1's arrival, empties it)
 *   add(sku, { options, addOns, fromDecisionId, qty }) → Promise<line>
 *       options        { size: '65 in', color: 'White', … } shown on the line; a variant with its own sku is added by
 *                      that sku. addOns [{ id, label, price }] per unit (protection, installation, haul-away; price
 *                      null = included). fromDecisionId: the decision that put the control there (a string or a list),
 *                      else read from the clicked control's decided container. It refuses, with the reason, a product
 *                      not sold here (cta retailer: Find a Retailer), out of stock, or with no price of ours.
 *       Every add sends the engine's order-start action, add_to_cart (weight 3, the add_to_bag reward), with the
 *       product's attributes, { quantity, lineId, options, addOns }, and the decisions that led to it: decisionId (the
 *       one the ledger credits: fromDecisionId, else the latest decided click that opened this product) with its
 *       contentId, slot and customerContentId, and decisionIds (all of them, newest first).
 *   remove(lineId)    setQty(lineId, n)   (0 removes)     clear()
 *   lines()           → [{ lineId, sku, name, image, qty, unitPrice, listPrice, options, addOns, decisionIds, at }]
 *   count()           → units in the cart
 *   total()           → { subtotal, addOns, savings: [{ kind: 'package'|'pair', id, title, amount, lineIds, why }],
 *                         saving, total, count }. A package saving when the lines hold every member of one of the
 *                       catalog's packages in force with a saving it publishes (display.savings, memberSum known); a
 *                       pair saving when a washer the catalog's bundle offer names and a dryer from that washer's own
 *                       companions (products.json) are both in, at the offer's own figure. Never a computed price.
 *   open() close()    the cart drawer (the kit's sheet): lines, quantities, remove, add-ons, savings, total, Checkout;
 *                     Checkout opens a sheet saying what the demo records (one purchase event per line, against the
 *                     decisions that led to it) and nothing else: no payment, no address.
 *   on(event, fn)     'change' ({ lines, total }), 'add' (line), 'remove' (line), 'open', 'close', 'order' (lines);
 *                     returns an unsubscribe function. Any [data-cart-count] element shows count() by itself.
 *   Markup: [data-act="store-cart-open"]; [data-act="store-add"][data-sku] adds that product (its decided container,
 *   if any, is the decision that led to it).
 *
 * store.search
 *   index(products)   builds the index over name, SKU, type, category, subcategory, series, panel, finish and fuel
 *                     (the bind indexes the feed itself; call again only with another list). → the number indexed.
 *   match(text)       → the products every word matches, in the feed's own order (no request).
 *   query(text, { event = true } = {}) → Promise<{ q, skus, status: 'sorted'|'site'|'none', regional, label,
 *                       matched, items }>. Sends the search event (custom 'search' { control: 'search', query,
 *                       results, category when every result shares one }), then POST /sort over the matches (at most
 *                       500, her vector, the engine's default weights or a published 'search' rail's), and returns
 *                       the skus in /sort's own order with the regional label ("leans with North Carolina’s sales ·
 *                       synthetic → warehouse", "(asserted)" when the region is asserted).
 *   Markup: a form[data-store-search] with an input named q goes to /oh/?q= on submit. A direct load or a reload of
 *   /oh/?q=<text> paints the results in the site's own order with nobody minted (M1's boot reads store.nav.parse);
 *   the first click brings her, and from then on the order is POST /sort's.
 *
 * store.retailers
 *   open(product, decision?) → Promise. product: a sku or a row. decision: { decisionId, contentId, slot,
 *     customerContentId } that earned the outcome, else the where-to-buy decision on the page on screen, else none
 *     (the modal says so). Sends find_a_retailer (custom, data.event the channel, the product's attributes as the
 *     feed has them, its own retailer value kept, and { control }: no event overwrites a product attribute) and opens the Find a Retailer modal: "Buy directly" first (Add to Cart through store.cart when sold
 *     here), then Best Buy pickup when the product offers it, then the online sellers, then the nearby stores (her
 *     region from the request), from the where-to-buy piece's display.retailers in the catalog document the page loads
 *     (D1's groups by product family; entries { name, kind, distanceMiles, note }; its source line shown as the label
 *     that it is the demo's own list), else the store's PriceSpider-shaped list per room only when the piece has none
 *     for the product; the modal says which is in use (data-retailer-source="catalog" | "store"). A nearby store's
 *     distance shows only when the list carries one: nothing is invented for her region.
 *     Pickup sends partner_pickup and a store button sends retailer_referral: type custom, data.event the channel,
 *     the product's own attributes as the feed has them (its own retailer value kept), data.store the store chosen
 *     ('best-buy', 'costco', …), data.where online | nearby for a referral, and the decision that earned it; the named
 *     outcomes E1 credits. The modal says a referral is not a sale.
 *   pickup(product, decision?) → Promise. The pickup module's own button (P3's section): the same partner_pickup as the
 *     modal's pickup button, with that module's decision (else the pickup decision on the page).
 *   Markup: [data-act="store-retailers"][data-sku] opens it (its decided container, if any, is the decision).
 *
 * store.signin
 *   open()            the sign-in sheet (P3's: the fictional account; the worker mints the link) from any header.
 *   account()         → the account she is signed in as, or null.
 *   mount()           makes sure the header on the page carries a sign-in control (#signIn or [data-act="sign-in"]),
 *                     a search form (form[data-store-search]) and a cart button ([data-act="store-cart-open"] with a
 *                     [data-cart-count]); the bind and every route run it, and a section that redraws the header runs
 *                     it again. Pieces already there are kept as they are; a header marked data-store-header="own"
 *                     (M1's, carrying those three by those selectors) is left alone, its cart count kept current.
 *
 * store.ui
 *   toast(text, tone?) a short line at the foot of the page, gone after four seconds (tone 'good' | 'bad').
 *
 * store.trail
 *   note(target)      the dispatcher's record of a press inside a decided container (oh.js calls it on every control).
 *   ledTo(sku)        → the decision ids, newest first, of decided presses that opened that product.
 *
 * store.control(target) → Promise<boolean>   oh.js's dispatcher hands every [data-act="store-…"] here.
 * store.bind(host)      oh.js's shared section only. host = { demo, site, lanes, base, productOf, productAttrs, idOf,
 *                       productName, priceOf, imageOf, field, products(), openPage, openProduct, askPage, homeKey,
 *                       pageOf, phoneKey, signIn: { open, account }, beforeOutcome(), outcome(record) }.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { esc, money, uid, arr, num, hhmm } from '/demo-kit/util.js';

const BASE = '/oh/';
/** The engine's closed type list (src/events/actionTypes.ts); any other name goes as custom with data.event. */
const FIRST_CLASS = new Set(['email_open', 'form_submit', 'page_view', 'button_click', 'product_view', 'add_to_cart', 'wishlist_add',
  'purchase', 'content_impression', 'content_click', 'content_dwell', 'video_complete']);
const PICKUP_CID = 'mod-where-to-buy-pickup', RETAIL_CID = 'mod-where-to-buy-retailer';
/** A PriceSpider-shaped list per room, the same for everyone, with no price of theirs: the catalog piece's own list replaces it. */
const RETAILERS = {
  'living-room': { online: [['best-buy', 'Best Buy'], ['amazon', 'Amazon'], ['walmart', 'Walmart'], ['costco', 'Costco']], nearby: [['best-buy', 'Best Buy'], ['costco', 'Costco'], ['walmart', 'Walmart']] },
  'laundry-room': { online: [['home-depot', 'The Home Depot'], ['lowes', 'Lowe’s'], ['best-buy', 'Best Buy'], ['costco', 'Costco']], nearby: [['home-depot', 'The Home Depot'], ['lowes', 'Lowe’s'], ['best-buy', 'Best Buy']] },
  kitchen: { online: [['home-depot', 'The Home Depot'], ['lowes', 'Lowe’s'], ['best-buy', 'Best Buy'], ['costco', 'Costco']], nearby: [['home-depot', 'The Home Depot'], ['lowes', 'Lowe’s'], ['best-buy', 'Best Buy']] },
};
const STORE_KEY = 'oh:store:cart:v1';

let H = null;
let raw = null;   // the kit's own cur, send and sendCustom, as they were before the bind (the store's events go out on them)
let readyNow;
const ready = new Promise((r) => { readyNow = r; });
const need = () => { if (!H) throw new Error('oh-store: not bound (oh.js binds the store right after createDemo)'); return H; };
const T = () => need().demo.transport;
const S = () => need().demo.state;
const P = () => need().demo.panels;

/** A tiny emitter per part. */
function emitter() {
  const subs = new Map();
  return {
    on(event, fn) { if (!subs.has(event)) subs.set(event, new Set()); subs.get(event).add(fn); return () => subs.get(event).delete(fn); },
    emit(event, payload) { for (const fn of subs.get(event) || []) { try { fn(payload); } catch (error) { console.error(error); } } },
  };
}
const safe = { get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
const note = (verb, what, detail) => { try { P().note(verb, what, detail); } catch { /* no panel */ } };

// ── The documents the store reads itself ─────────────────────────────────────
const DOCS = { pieces: [], images: {}, rails: {} };
async function loadDocs() {
  const t = T();
  const [cat, idx, cfg] = await Promise.all([t.tryJson('/oh/catalog.json'), t.tryJson('/oh/img/index.json'), t.tryJson('/oh/demo.config.json')]);
  DOCS.pieces = arr(cat && cat.pieces);
  DOCS.images = (idx && idx.products) || {};
  for (const pg of arr(cfg && cfg.pages)) for (const r of arr(pg.sorted)) if (r && r.slot) DOCS.rails[r.slot] = r;
}
/** A piece is in force when the document the page last read (state.pieces) holds it and its window covers now. */
function inForce(piece) {
  if (!piece) return false;
  const live = S().pieces && S().pieces.size ? S().pieces.get(piece.customerContentId) : piece;
  if (!live) return false;
  const w = live.window || piece.window || null, now = Date.now();
  if (w && w.to && Date.parse(w.to) <= now) return false;
  if (w && w.from && Date.parse(w.from) > now) return false;
  return live.inStock !== false;
}
function artOf(p) {
  if (!p) return null;
  const e = DOCS.images[need().idOf(p)];
  if (e && e.verdict === 'accept' && e.src) return e.src;
  if (e && e.verdict && e.verdict !== 'accept') return null;
  return need().imageOf(p);
}
const artHtml = (p, cls) => {
  const src = artOf(p), name = need().productName(p) || '';
  return `<span class="st-art${cls ? ` ${cls}` : ''}">${src ? `<img src="${esc(src)}" alt="${esc(name)}" loading="lazy" decoding="async" data-store-name="${esc(name)}">` : `<span class="st-noimg">${esc(name)}</span>`}</span>`;
};
const priceNum = (p) => { const v = num(need().priceOf(p)); return Number.isFinite(v) && v > 0 ? v : null; };
const listNum = (p) => { const v = num(p && p.listPrice); return Number.isFinite(v) && v > 0 ? v : null; };
const productOfAny = (x) => (x && typeof x === 'object' ? x : need().productOf(x));
const roomOf = (p) => (p && p.attributes && p.attributes.room) || 'living-room';
/** The decision a control sits in: its innermost decided container. */
function decisionOf(target) {
  const node = target && target.closest ? target.closest('[data-op-decision-id]') : null;
  if (!node || !node.getAttribute('data-op-decision-id')) return null;
  return { decisionId: node.getAttribute('data-op-decision-id'), contentId: node.getAttribute('data-op-content') || null, slot: node.getAttribute('data-op-slot') || null, customerContentId: node.getAttribute('data-cid') || null };
}
const decisionData = (d) => (d && d.decisionId ? { decisionId: d.decisionId, ...(d.contentId ? { contentId: d.contentId } : {}), ...(d.slot ? { slot: d.slot } : {}), ...(d.customerContentId ? { customerContentId: d.customerContentId } : {}) } : {});

// ── The visitor: the first click mints her, never the load ───────────────────
let minting = null;
async function ensure() {
  const t = T();
  if (t.cur()) { persist(t.cur()); return own(t.cur()); }
  if (!minting) {
    minting = t.ensureVisitor()
      // Kept the moment the mint answers (her session, then her consent), before the cold-start read: a reload inside that
      // read continues her. Then her arrival, as beat 1 reads it: the region from the request (never asserted), the
      // brand's lean there, the census shown.
      .then(async (v) => { persist(v); try { await P().loadColdStart(); } catch { /* the panel says what it could not read */ } return v; })
      .finally(() => { minting = null; });
  }
  const v = own(await minting);
  persist(v);   // again after the cold-start read: it writes only when the record has changed
  return v;
}
/** The store's own fields on a visitor (carried over when the sign-in swaps her session: the page spreads the visitor). */
function own(v) { if (v && !v.ohStore) v.ohStore = { id: uid().slice(0, 16), trail: [] }; return v; }

// ── Her visitor, kept in this browser: a full load continues the same person ──
// The engine's shopper capability (its own 24-hour bearer, SHOPPER_MAX_AGE in src/identity/sessionCapability.ts) is
// kept as the SDK keeps it, under the SDK's own key (public/sdk/edge-personalization.js: opt_shopper_session:<endpoint>
// :<tenant>, the endpoint being this origin), in localStorage, with a sessionStorage mirror. Beside it, under the SDK's
// family of names, the record of who she is: tenant, visitor id (subject), session id, kind, the claims' times and grant,
// her consent, the cart's owner id and the fictional account she signed in as. Nothing else, and no secret: the
// capability is her own token, signed by the engine, the same thing the SDK stores.
const CAPABILITY = /^ss1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const capKey = () => `opt_shopper_session:${encodeURIComponent(location.origin)}:${encodeURIComponent(need().site.tenant)}`;
const recKey = () => `opt_shopper_visitor:${encodeURIComponent(location.origin)}:${encodeURIComponent(need().site.tenant)}`;
const areas = () => ['localStorage', 'sessionStorage'].map((n) => { try { return window[n]; } catch { return null; } }).filter(Boolean);
/** The capability's own claims (its payload is the engine's signed JSON; read here only to match the record). */
function claimsOf(cap) {
  try { return JSON.parse(atob(cap.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}
/** Keep her (visitor A, this browser's own; a second device or a fresh visitor for Compare is never kept). */
function persist(v) {
  if (!H || !v || v.key !== 'A' || !v.session || !CAPABILITY.test(String(v.session.capability || ''))) return false;
  const s = v.session, linked = v.p3 && v.p3.linked;
  const rec = { version: 1, tenant: need().site.tenant, subject: s.subject, sessionId: s.sessionId, kind: s.kind, grantId: s.grantId || null,
    authorityEpoch: s.authorityEpoch || null, iat: s.iat, exp: s.exp,
    // Her consent as granted at the mint (the kit's mint refuses a visitor without it); a recognized session's own
    // answer says it after the sign-in. A fresh anonymous session's consent field predates the grant, so it is not read.
    consent: { tracking: true, personalization: s.kind === 'recognized' && s.consent && typeof s.consent.personalization === 'boolean' ? s.consent.personalization : true },
    owner: own(v).ohStore.id, linked: linked ? { account: linked.account, consented: linked.consented, receipt: linked.receipt } : null };
  const text = JSON.stringify(rec);
  for (const area of areas()) {
    try { if (area.getItem(capKey()) !== s.capability || area.getItem(recKey()) !== text) { area.setItem(capKey(), s.capability); area.setItem(recKey(), text); } } catch { /* storage refused */ }
  }
  return true;
}
/**
 * The demo's reset, or "Forget this browser", starts a new person: what this browser kept goes from both storage areas
 * (her capability, her record and the cart's lines, every visitor's), whether or not anyone is on the page, and the cart
 * on screen empties, so nothing of hers comes back with the next person.
 */
function forget() {
  if (!H) return;
  for (const area of areas()) for (const key of [capKey(), recKey(), STORE_KEY]) { try { area.removeItem(key); } catch { /* storage refused */ } }
  LINES = []; cartOwner = null;
  try { changed(false); } catch { /* nothing on screen to redraw */ }
}
/** What this browser kept, when it is for this tenant, names the same visitor as its capability, and has a minute left. */
function kept() {
  for (const area of areas()) {
    try {
      const cap = area.getItem(capKey()), rec = JSON.parse(area.getItem(recKey()) || 'null');
      if (!cap || !CAPABILITY.test(cap) || !rec || rec.version !== 1 || rec.tenant !== need().site.tenant) continue;
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
 * On a page load: her visitor from this browser, continued, with no identity call and no new consent, so the next
 * action is the same person and the panel reads her accumulated profile. One read of her own profile (GET
 * /realtime/reflex, her capability, not an identity call) confirms the engine still knows the session; refused (a
 * reset, an expiry, another state), what was kept is forgotten and the page is a stranger's until her first click.
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
  const v = { key: 'A', label: 'Shopper A', session, entry: t.landingEntry(), journey: [], cart: 0, intent: t.defaultIntent(), vector: {},
    ohStore: { id: rec.owner || uid().slice(0, 16), trail: [] }, continued: true,
    ...(rec.linked ? { p3: { linked: { ...rec.linked, at: Date.now(), taste: null } } } : {}) };
  const probe = await t.api('/realtime/reflex', undefined, { visitor: v });
  if (probe.status === 401 || probe.status === 403) { forget(); return null; }
  S().visitors.A = v;
  t.useVisitor('A');
  note('continued', `Shopper A, from this browser (${rec.subject.slice(-8)})`,
    `the same visitor as before: the session kept in this browser, no identity call and no new consent · ${rec.kind} · until ${new Date(rec.exp * 1000).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}`);
  return v;
}
const visitor = { ensure, current: () => (H ? T().cur() : null), resume, persist, forget };

// ── The decisions that led somewhere: decided presses, by the product they opened ─
const trail = {
  note(target) {
    const v = H && T().cur();
    if (!v || !target || !target.closest) return;
    const d = decisionOf(target);
    if (!d) return;
    const sku = (target.dataset && (target.dataset.open || target.dataset.sku)) || (target.closest('[data-open]') || { dataset: {} }).dataset.open || null;
    const list = own(v).ohStore.trail;
    list.unshift({ ...d, sku, page: S().viewPage, productId: S().productId || null, at: Date.now() });
    if (list.length > 60) list.length = 60;
  },
  ledTo(sku) {
    const v = H && T().cur();
    if (!v || !v.ohStore) return [];
    const out = [];
    for (const e of v.ohStore.trail) if (e.sku === String(sku) && !out.includes(e.decisionId)) out.push(e.decisionId);
    return out;
  },
  entry(decisionId) { const v = H && T().cur(); return (v && v.ohStore && v.ohStore.trail.find((e) => e.decisionId === decisionId)) || null; },
};

// ── Events: exactly the beat verbs' shapes ───────────────────────────────────
const weight = (type) => { const w = ((S().registry || {}).weights || {})[type]; return Number.isFinite(num(w)) ? num(w) : 0; };
async function send(type, attrs = {}, opts = {}) {
  const h = need(), t = raw || T();   // the kit's own sends, as before the bind: the store draws its own panel (refreshSignals, or before its re-ask)
  const v = opts.visitor || t.cur();
  if (!v) return null;
  const { sku, ...rest } = attrs || {};
  const p = sku != null ? h.productOf(sku) : (type === 'product_view' && rest.productId ? h.productOf(rest.productId) : null);
  // The guard: an event about a product carries the product's attributes (productAttrs, exactly as product_view does),
  // with the event's own fields over them. A sku the feed does not hold cannot: it goes with its id and says so.
  if (sku != null && !p) {
    rest.productId = String(sku);
    console.warn(`oh-store: ${type} about ${sku}, a sku the feed does not hold: sent without the product's attributes`);
    note('warned', `${type} · ${sku}`, 'not in the feed: sent with its id and without its attributes, so no dimension moves');
  }
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
  if (opts.note !== false) {
    const [verb, what, detail] = opts.note || ['sent', type === 'custom' ? rest.event : type, `${p ? `${h.productName(p)} · ` : ''}by hand${weight(type === 'custom' ? rest.event : type) ? ` · weighs ${weight(type === 'custom' ? rest.event : type)} on the profile` : ' · no taste'}`];
    note(verb, what, detail);
  }
  eventsBus.emit('sent', { type, data, ok: Boolean(r && r.ok) });
  if (opts.reask) { drawEarly(r, type === 'custom' ? rest.event : type, v); await reask(opts.reask === true ? undefined : opts.reask); }   // the re-ask's own read confirms it
  else if (r && r.ok) await refreshSignals(r.body, type === 'custom' ? rest.event : type);
  return r;
}
/**
 * What the action's own answer says about her after the event. POST /realtime/action answers { success, message,
 * update: { type, userId, data: { affinity: { dims, audiences, changed, odpConfirmed }, journeyStage, … } }, signals,
 * sessionId, cookiesUpdated, consent } on both engine hosts (src/services/RealtimeSegmentEngine.ts, ShopperReflex.ts),
 * and its dims are the profile read's own shape ({ category: { washers: 0.64, … }, … }, reflex snapshot()). The engine
 * sends update only when an audience or the stage moved; otherwise the answer says "no personalization changes" and
 * carries no dims. → { dims | null, changed } for an event taken as sent, or null for one that was not (refused,
 * buffered, dropped, no consent to personalize): nothing is drawn early for that one.
 */
function afterOf(answer) {
  const b = answer && typeof answer === 'object' ? answer : null;
  if (!b || b.success !== true || b.processing === 'buffered' || b.dropped) return null;
  if (b.consent && (b.consent.tracking === false || b.consent.personalization === false)) return null;
  const aff = (b.update && ((b.update.data && b.update.data.affinity) || b.update.affinity)) || b.affinity || null;
  return { dims: aff && aff.dims && typeof aff.dims === 'object' ? aff.dims : null, changed: aff && Array.isArray(aff.changed) ? aff.changed : [] };
}
/** Whether an answer is about the visitor on screen (its session is hers). */
const forHer = (answer, v) => { const c = H && T().cur(); return Boolean(c && (!v || v === c) && c.session && (!answer || !answer.sessionId || answer.sessionId === c.session.sessionId)); };
/**
 * The panel the moment an answer lands, before anything else is asked: its meters drawn from the answer's dims, or,
 * when the engine sent none, her profile read at once rather than after the page's question; the audiences the answer
 * reports entering or leaving move the chips under the meters, and trigger names the event in their caption (none: the
 * caption keeps the last change). The read that follows, the page's after its question, confirms it.
 */
function drawEarly(r, trigger, v) {
  const a = r && r.ok ? afterOf(r.body) : null;
  if (!a || !forHer(r.body, v)) return;
  const said = trigger ? { changed: a.changed, trigger } : {};
  try { Promise.resolve(P().renderVectors(a.dims ? { ...said, dims: a.dims } : { ...said, early: true })).catch(() => {}); } catch { /* no panel */ }
}
/**
 * After an event the store sent (a manual add, select, filter, search, wishlist, outcome): the panel's rows drawn at once
 * from the action's own answer when it carries them, then her profile read again (GET /realtime/reflex, through the
 * kit's panels), which confirms them, and what shows it redrawn, with no press and no navigation: "What has been
 * signalled" (the meters, the moved rows marked fresh), the who chip and her stage, Why these (the receipts of the set on
 * screen), and the before/now strips on the page, whose quiet line names her strongest signal: those stay on the read.
 * The decided slots are not asked again here: store.reask does that, on navigation or when a caller asks for it. Calls
 * that land while one runs are each drawn from their answer at once and folded into one more read.
 */
let refreshing = null, refreshAgain = false, lastAnswer = null;
function refreshSignals(answer, type) {
  // The action's own answer: the state after the event (dims), the audiences it reports entering or leaving and its
  // trigger (the event's own name): the panel's meters are redrawn from it at once and its audience chips move.
  const a = afterOf(answer);
  lastAnswer = { changed: a ? a.changed : [], trigger: type || null };
  if (a && a.dims && forHer(answer)) { try { Promise.resolve(P().renderVectors({ ...lastAnswer, dims: a.dims })).catch(() => {}); } catch { /* no panel */ } }
  if (refreshing) { refreshAgain = true; return refreshing; }
  refreshing = (async () => {
    do {
      refreshAgain = false;
      try {
        const said = lastAnswer;
        await P().renderVectors(said || {});
        P().renderWho();
        P().renderWhy();
        if (!S().busy) {
          const rows = need().lanes.rows || {};
          for (const [slot, R] of Object.entries(rows)) {
            const strip = R && R.deltas;
            if (!strip || !strip.isConnected || !strip.offsetParent) continue;   // only the strips on the page on screen
            try { need().demo.deltas.render(slot); } catch { /* a strip with nothing to compare yet */ }
          }
        }
      } catch (error) { console.warn('oh-store: the signals could not be read again', error); }
    } while (refreshAgain);
  })().finally(() => { refreshing = null; });
  return refreshing;
}
const eventsBus = emitter();
const events = { send, weight, on: (e, fn) => eventsBus.on(e, fn) };

// ── The re-ask: one at a time, a second call for the same page joins the first ─
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

// ── Navigation: the routes, pushState, the browser's Back ────────────────────
const navBus = emitter();
let lastRoute = null;
function parse(path) {
  let u;
  try { u = new URL(path, location.origin); } catch { return null; }
  const p = u.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
  const q = u.searchParams;
  const text = (q.get('q') || '').slice(0, 120);
  // The search's address is /oh/?q=<text>: a path the worker serves (an unknown path gets the root's page on a reload).
  // /oh/search?q= is read too, in the client only, and written back as /oh/?q=.
  const searchRoute = { name: 'search', q: text, path: `${BASE}?q=${encodeURIComponent(text)}` };
  if (p === `${BASE}m`) return { name: 'phone', path: `${BASE}m` };
  if (p === `${BASE}product`) return { name: 'product', id: q.get('id') || null, path: `${BASE}product?id=${encodeURIComponent(q.get('id') || '')}` };
  if (p === `${BASE}search`) return searchRoute;
  if (p === BASE || p === BASE.replace(/\/$/, '') || p === `${BASE}grid`) {
    const view = q.get('view');
    if (view) return { name: 'grid', view, path: `${BASE}?view=${encodeURIComponent(view)}` };
    return q.has('q') ? searchRoute : { name: 'home', path: BASE };
  }
  return null;
}
/** Whether two addresses (or routes) are the same place: the same route, its view, product or query. */
function same(a, b) {
  const x = typeof a === 'string' ? parse(a) : a, y = typeof b === 'string' ? parse(b) : b;
  return Boolean(x && y && x.name === y.name && (x.view || null) === (y.view || null) && (x.id || null) === (y.id || null) && (x.q || '') === (y.q || ''));
}
/** The canonical address of a path: the route's own (/oh/search?q=x → /oh/?q=x), else the path as given. */
const canonical = (path) => { const r = parse(path); return r ? r.path : path; };
const href = (r) => (r && r.path) || BASE;
function navPath(name) {
  if (!name || name === 'home') return BASE;
  if (name === 'phone') return `${BASE}m`;
  if (name === 'search') return `${BASE}?q=`;
  return `${BASE}?view=${encodeURIComponent(name)}`;
}
/** The address bar without the rehearsal flags the page keeps (debug, region, …). */
const KEPT = ['debug', 'fixtures', 'region', 'metro', 'wait'];
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
  const lane = (h.lanes.routes || {})[r.name];
  if (lane) return lane(r, opts);
  const quietly = { event: opts.event };
  if (r.name === 'home') return h.openPage(h.homeKey(), quietly);
  if (r.name === 'phone') return h.openPage(h.phoneKey(), quietly);
  if (r.name === 'product') return h.openProduct(r.id, quietly);
  if (r.name === 'grid') {
    if (h.pageOf(r.view)) return h.openPage(r.view, quietly);
    toast(`The ${r.view} grid is not on this page yet; here is the homepage`, 'bad');
    return h.openPage(h.homeKey(), quietly);
  }
  if (r.name === 'search') return searchSheet(r.q, opts);
  return false;
}
async function go(path, opts = {}) {
  const r = typeof path === 'string' ? parse(path) : path;
  if (!r) throw new Error(`no OH route for ${path}`);
  if (S().busy && !opts.dispatched) { need().demo.director.say('a beat is running; the page is frozen until it lands', 'bad'); return false; }
  await ensure();
  const out = await paint(r, opts);
  // The address bar holds the route: pushed when the renderer did not set it, made canonical when it set another form.
  if (!opts.restore) {
    try {
      if (!same(location.pathname + location.search, r)) history.pushState({ oh: true }, '', withKept(r.path));
      else if (bare(location.href) !== r.path) history.replaceState({ oh: true }, '', withKept(r.path));
    } catch { /* sandboxed */ }
  }
  lastRoute = r;
  navBus.emit('route', r);
  mount();
  return out;
}
async function restore() {
  const r = parse(location.pathname + location.search) || { name: 'home', path: BASE };
  if (r.name === 'search') await ensure();          // the results are POST /sort's order, which needs her
  const out = await paint(r, { event: false, restore: true });
  lastRoute = r;
  navBus.emit('route', r);
  mount();
  return out;
}
const nav = { go, back: () => history.back(), restore, parse, same, canonical, href, navPath, onRoute: (fn) => navBus.on('route', fn), current: () => lastRoute };

// ── The cart ─────────────────────────────────────────────────────────────────
const cartBus = emitter();
let LINES = [];
let cartOwner = null;            // the visitor key the lines on screen belong to
function stored() { return safe.get(STORE_KEY) || {}; }
function save() {
  const v = T().cur();
  if (!v) return;
  const all = stored();
  if (!LINES.length && !all[v.key]) return;   // an empty cart is not written where none was kept: a forgotten browser stays empty
  all[v.key] = { owner: own(v).ohStore.id, lines: LINES };
  safe.set(STORE_KEY, all);
}
/** The lines of the visitor on the page: hers from this tab's storage; a line from an earlier visitor keeps no decision. */
function sync() {
  const v = H && T().cur();
  const key = v ? v.key : null;
  if (key === cartOwner) return;
  cartOwner = key;
  const e = key ? stored()[key] : null;
  LINES = e && Array.isArray(e.lines) ? e.lines.map((l) => (e.owner === own(v).ohStore.id ? l : { ...l, decisionIds: [], restored: true })) : [];
  changed(false);
}
function changed(persist = true) {
  if (persist) save();
  const t = total();
  for (const node of document.querySelectorAll('[data-cart-count]')) { node.textContent = String(t.count); node.hidden = false; node.dataset.count = String(t.count); }
  cartBus.emit('change', { lines: lines(), total: t });
  if (S().sheet && S().sheet.kind === 'cart') openCart(true);
}
const lines = () => { sync(); return LINES.map((l) => ({ ...l, options: { ...l.options }, addOns: l.addOns.map((a) => ({ ...a })), decisionIds: [...l.decisionIds] })); };
const count = () => { sync(); return LINES.reduce((n, l) => n + l.qty, 0); };
const sameAddOns = (a, b) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));
const sameOptions = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
function cleanAddOns(list) {
  return arr(list).filter((a) => a && (a.id || a.label)).map((a) => ({ id: String(a.id || a.label), label: String(a.label || a.id), price: Number.isFinite(num(a.price)) && num(a.price) >= 0 ? num(a.price) : null }));
}
async function add(sku, opts = {}) {
  const h = need();
  const v = await ensure();
  sync();
  const p = productOfAny(sku);
  const refuse = (m) => { toast(m, 'bad'); throw new Error(m); };
  if (!p) refuse(`No product ${sku} in the feed`);
  const id = h.idOf(p), name = h.productName(p);
  if (p.cta && p.cta !== 'cart') refuse(`${name} is sold through retailers, not here: Find a Retailer`);
  if (p.inStock === false) refuse(`${name} is out of stock here: Notify Me`);
  const price = priceNum(p);
  if (price === null) refuse(`${name} has no price of ours in the feed, so it cannot go in the cart`);
  const qty = Math.max(1, Math.min(9, Math.floor(num(opts.qty) || 1)));
  const options = opts.options && typeof opts.options === 'object' ? Object.fromEntries(Object.entries(opts.options).filter(([, x]) => x !== null && x !== undefined && x !== '').map(([k, x]) => [k, String(x)])) : {};
  const addOns = cleanAddOns(opts.addOns);
  const explicit = arr(opts.fromDecisionId).filter(Boolean).map(String);
  const fromClick = opts.target ? decisionOf(opts.target) : null;
  const decisionIds = [...new Set([...explicit, ...(fromClick ? [fromClick.decisionId] : []), ...trail.ledTo(id)])];
  const lead = decisionIds[0] || null;
  const leadEntry = lead ? (fromClick && fromClick.decisionId === lead ? fromClick : trail.entry(lead) || { decisionId: lead }) : null;
  let line = LINES.find((l) => l.sku === id && sameOptions(l.options, options) && sameAddOns(l.addOns, addOns));
  if (line) { line.qty = Math.min(9, line.qty + qty); line.decisionIds = [...new Set([...decisionIds, ...line.decisionIds])]; }
  else {
    line = { lineId: uid().slice(0, 12), sku: id, name, image: artOf(p), qty, unitPrice: price, listPrice: listNum(p), options, addOns, decisionIds, at: Date.now() };
    LINES.push(line);
  }
  const r = await send('add_to_cart', { sku: id, quantity: qty, lineId: line.lineId, ...(Object.keys(options).length ? { options } : {}),
    ...(addOns.length ? { addOns: addOns.map((a) => a.id) } : {}), ...decisionData(leadEntry), ...(decisionIds.length ? { decisionIds } : {}) },
  { visitor: v, note: ['added', `${name}${qty > 1 ? ` ×${qty}` : ''}`, `add_to_cart, the order-start action, with its attributes${lead ? `, credited to the decision that led here (${decisionIds.length} on the trail)` : ' · no decided press led here'}`] });
  if (!r || !r.ok) toast(`The engine did not take the add (${(r && r.status) || 'no answer'}); the cart keeps the line`, 'bad');
  else toast(`Added to your cart: ${name}`, 'good');
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
function clearAll() { safe.set(STORE_KEY, {}); LINES = []; cartOwner = null; changed(false); }
/** The bundle offers and packages of the catalog, in the catalog's own order. */
function packagePieces() { return DOCS.pieces.filter((x) => x.type === 'package' && x.display && x.display.packageSku && num(x.display.savings) > 0 && x.display.memberSum != null); }
function pairPieces() {
  return DOCS.pieces.filter((x) => x.display && x.display.badge === 'bundle' && arr(x.featuredProductIds).length && amountOf(x) !== null
    && arr(x.tags && x.tags.category).includes('washers') && arr(x.tags && x.tags.category).includes('dryers'));
}
function amountOf(piece) {
  const text = `${(piece.display && piece.display.grammar && piece.display.grammar.value) || ''} ${piece.title || ''}`;
  const m = /\$([\d,]+(?:\.\d{2})?)/.exec(text);
  return m ? num(m[1].replace(/,/g, '')) : null;
}
function membersOf(piece) {
  const pk = need().productOf(piece.display.packageSku);
  const fromFeed = arr(pk && pk.companions && pk.companions.members);
  return fromFeed.length ? fromFeed : arr(piece.featuredProductIds).filter((x) => x !== piece.display.packageSku);
}
function total() {
  sync();
  const subtotal = LINES.reduce((n, l) => n + l.unitPrice * l.qty, 0);
  const addOns = LINES.reduce((n, l) => n + l.addOns.reduce((m, a) => m + (a.price || 0), 0) * l.qty, 0);
  const used = new Set(), savings = [];
  const lineOf = (sku) => LINES.find((l) => l.sku === sku && !used.has(l.lineId));
  for (const piece of packagePieces()) {
    if (!inForce(piece)) continue;
    const members = membersOf(piece);
    const found = members.map(lineOf);
    if (!members.length || found.some((x) => !x)) continue;
    found.forEach((l) => used.add(l.lineId));
    savings.push({ kind: 'package', id: piece.customerContentId, title: piece.title, amount: num(piece.display.savings), lineIds: found.map((l) => l.lineId),
      why: `together ${money(piece.display.price)} · apart ${money(piece.display.memberSum)}, the catalog’s own figures` });
  }
  const pair = pairPieces().find(inForce);
  if (pair) {
    for (const w of LINES) {
      if (used.has(w.lineId) || !arr(pair.featuredProductIds).includes(w.sku)) continue;
      const wp = need().productOf(w.sku);
      const dryers = Object.values((wp && wp.companions && wp.companions.dryers) || {}).flatMap(arr);
      const d = LINES.find((l) => !used.has(l.lineId) && l !== w && dryers.includes(l.sku));
      if (!d) continue;
      used.add(w.lineId); used.add(d.lineId);
      savings.push({ kind: 'pair', id: pair.customerContentId, title: pair.title, amount: amountOf(pair), lineIds: [w.lineId, d.lineId],
        why: `${w.name} with ${d.name}, its own series’ dryer (the feed’s companions) · the offer’s own figure` });
    }
  }
  const saving = savings.reduce((n, s) => n + s.amount, 0);
  return { subtotal, addOns, savings, saving, total: Math.max(0, subtotal + addOns - saving), count: LINES.reduce((n, l) => n + l.qty, 0) };
}
function lineHtml(l) {
  const p = need().productOf(l.sku);
  const opts = Object.entries(l.options || {}).map(([k, x]) => `${esc(k)} ${esc(x)}`).join(' · ');
  return `<div class="st-line" data-line="${esc(l.lineId)}">${p ? artHtml(p, 'st-art--line') : ''}<div class="st-line-main">
    <b class="st-line-name">${esc(l.name)}</b><span class="st-line-sku">${esc(l.sku)}${opts ? ` · ${opts}` : ''}</span>
    ${l.addOns.map((a) => `<span class="st-line-add">+ ${esc(a.label)} <em>${a.price ? money(a.price) : 'included'}</em></span>`).join('')}
    ${l.restored ? '<span class="st-line-add"><em>kept from an earlier visit in this tab: no decision is credited</em></span>' : ''}
    <span class="st-qty"><button type="button" class="st-qbtn" data-act="store-cart-qty" data-line="${esc(l.lineId)}" data-qty="${l.qty - 1}" data-ctl="cart-less-${esc(l.sku)}" aria-label="One fewer">−</button>
    <b data-qty-of="${esc(l.lineId)}">${l.qty}</b><button type="button" class="st-qbtn" data-act="store-cart-qty" data-line="${esc(l.lineId)}" data-qty="${l.qty + 1}" data-ctl="cart-more-${esc(l.sku)}" aria-label="One more"${l.qty >= 9 ? ' disabled' : ''}>+</button>
    <button type="button" class="st-link" data-act="store-cart-remove" data-line="${esc(l.lineId)}" data-ctl="cart-remove-${esc(l.sku)}">Remove</button></span></div>
    <span class="st-line-price">${money(l.unitPrice * l.qty)}${l.listPrice && l.listPrice > l.unitPrice ? `<s>${money(l.listPrice * l.qty)}</s>` : ''}</span></div>`;
}
function openCart(refresh) {
  const t = total(), ls = lines();
  const body = `<p class="sk">Your cart</p><h2 id="sheetTitle">${ls.length ? `Your cart · ${t.count} item${t.count === 1 ? '' : 's'}` : 'Your cart is empty'}</h2>`
    + (ls.length ? `<div class="st-lines">${ls.map(lineHtml).join('')}</div>`
      + `<div class="srow"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>`
      + (t.addOns ? `<div class="srow"><span>Add-ons</span><b>${money(t.addOns)}</b></div>` : '')
      + t.savings.map((s) => `<div class="srow st-saving" data-saving="${esc(s.kind)}"><span>${esc(s.kind === 'package' ? 'Package saving' : 'Pair saving')} · ${esc(s.title)}<br><span class="nper">${esc(s.why)}</span></span><b>−${money(s.amount)}</b></div>`).join('')
      + `<div class="srow st-total"><span>Total</span><b data-cart-total>${money(t.total)}</b></div>`
      + '<p class="st-fine">Prices are the catalog’s, the same for everyone; a saving shows only when the lines complete a set the catalog prices lower.</p>'
      + '<div class="sactions"><button type="button" class="btn btn--brand" data-act="store-cart-checkout" data-ctl="cart-checkout">Checkout</button>'
      + '<button type="button" class="btn btn--line" data-act="store-cart-close" data-ctl="cart-continue">Continue shopping</button></div>'
      : '<p>Add something from a product page and it shows here, with its add-ons and any set saving.</p><div class="sactions"><button type="button" class="btn btn--line" data-act="store-cart-close" data-ctl="cart-continue">Continue shopping</button></div>');
  need().demo.sheets.open('cart', body);
  if (!refresh) { cartBus.emit('open', { lines: ls, total: t }); }
}
async function closeCart() { if (S().sheet && ['cart', 'checkout'].includes(S().sheet.kind)) { await need().demo.sheets.close(); cartBus.emit('close', {}); } }
function checkoutSheet() {
  const ls = lines(), t = total();
  if (!ls.length) { openCart(); return; }
  const credited = ls.filter((l) => l.decisionIds.length).length;
  need().demo.sheets.open('checkout', `<p class="sk">Checkout · a demonstration</p><h2 id="sheetTitle">What this demo records</h2>`
    + `<p>Placing this order sends the engine <b>one order event per line</b> (<code>purchase</code>, ${ls.length} in all, ${money(t.total)}), each against the decision that led to it: ${credited ? `${credited} of ${ls.length} line${ls.length === 1 ? '' : 's'} carry one` : 'none of these lines came from a decided press, so none is credited'}.</p>`
    + '<p><b>Nothing else.</b> No payment is taken, no card or address is asked for, nothing ships. The day report counts the order beside the pickups and the referrals; attribution, never a lift.</p>'
    + ls.map((l) => `<div class="srow"><span>${esc(l.name)} ×${l.qty}<br><span class="nper">${l.decisionIds.length ? `credited to decision ${esc(l.decisionIds[0].slice(-10))}` : 'no decision led here'}</span></span><b>${money(l.unitPrice * l.qty)}</b></div>`).join('')
    + '<div class="sactions"><button type="button" class="btn btn--brand" data-act="store-cart-place" data-ctl="cart-place">Place the demo order</button>'
    + '<button type="button" class="btn btn--line" data-act="store-cart-open" data-ctl="cart-back">Back to the cart</button></div>');
}
async function placeOrder() {
  const ls = lines();
  if (!ls.length) return false;
  const v = await ensure();
  const orderId = `oh-demo-${uid().slice(0, 10)}`;
  const t = total();
  let ok = 0;
  for (const l of ls) {
    const lead = l.decisionIds[0] || null;
    const e = lead ? trail.entry(lead) || { decisionId: lead } : null;
    // value is the line at the catalog's price; the order's own saving and total ride beside it, never spread over lines.
    const r = await send('purchase', { sku: l.sku, orderId, quantity: l.qty, value: l.unitPrice * l.qty, currency: 'USD', orderTotal: t.total, orderSaving: t.saving, ...decisionData(e) },
      { visitor: v, note: ['ordered', `${l.name} ×${l.qty}`, `purchase, the demo order ${orderId}${lead ? ', against the decision that led to it' : ''} · no payment`] });
    if (r && r.ok) ok += 1;
  }
  cartBus.emit('order', ls);
  LINES = [];
  changed();
  await need().demo.sheets.close();
  toast(ok === ls.length ? `Demo order recorded: ${ls.length} line${ls.length === 1 ? '' : 's'}, no payment taken` : `The engine took ${ok} of ${ls.length} order lines`, ok === ls.length ? 'good' : 'bad');
  return true;
}
const cart = { add, remove, setQty, clear, lines, count, total, open: () => openCart(false), close: closeCart, on: (e, fn) => cartBus.on(e, fn), checkout: checkoutSheet };

// ── Search: the feed by name, SKU and type; the order is POST /sort's ────────
let INDEX = null;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function index(products) {
  const h = need();
  INDEX = arr(products).map((p) => {
    const a = p.attributes || {};
    return { p, hay: ` ${norm([h.idOf(p), h.productName(p), a.type, a.category, a.subcategory, a.series, a.panel, a.finish, a.fuel, a.sizeBand].join(' '))} ` };
  });
  return INDEX.length;
}
/** Every word must match; a plural also matches its singular ("washers" finds "washer"). The feed's own order. */
function match(text) {
  if (!INDEX) index(need().products());
  const words = norm(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  return INDEX.filter((x) => words.every((w) => x.hay.includes(w) || (w.length > 3 && w.endsWith('s') && x.hay.includes(w.slice(0, -1))))).map((x) => x.p);
}
function leanLabel(reg) {
  if (!reg || !reg.region) return '';
  const st = S(), key = reg.region;
  const cold = st.coldstart && st.coldstart.region && st.coldstart.region.key === key ? st.coldstart : null;
  const name = reg.level === 'global' ? 'every region' : (cold && P().coldLabel()) || P().regionName(key) || (key === 'US' ? 'the US' : key);
  return `leans with ${name}’s sales${reg.asserted ? ' (asserted)' : ''} · synthetic → warehouse`;
}
function weightsFor() {
  const r = DOCS.rails.search;
  if (!r || !r.weights) return { affinity: 1 };
  const zero = Object.fromEntries(arr((S().registry || {}).dimensions).map((d) => [d.key, 0]));
  return { affinity: 1, dims: { ...zero, ...r.weights } };
}
async function query(text, opts = {}) {
  const h = need();
  const q = String(text || '').trim().slice(0, 120);
  const found = match(q).filter((p) => priceNum(p) !== null);
  const v = await ensure();
  const cats = [...new Set(found.map((p) => p.attributes && p.attributes.category).filter(Boolean))];
  if (opts.event !== false && q) await send('search', { control: 'search', query: q, results: found.length, ...(cats.length === 1 ? { category: cats[0] } : {}) }, { visitor: v, note: ['searched', `“${q}”`, `${found.length} in the feed · custom search, the beat verbs’ shape`] });
  if (!found.length) return { q, skus: [], status: 'none', regional: null, label: '', matched: 0, items: [] };
  const list = found.slice(0, 500);
  const asserted = S().ctx.region || null;
  const r = await T().api('/sort', { userId: v.session.subject, sessionId: v.session.sessionId, candidates: list.map((p) => { const { productId, ...attrs } = h.productAttrs(p); return { id: productId, ...attrs }; }),
    weights: weightsFor(), ...(asserted ? { context: { region: asserted } } : {}) }, { visitor: v });
  if (!r.ok || !r.body || !Array.isArray(r.body.order)) return { q, skus: list.map(h.idOf), status: 'site', regional: null, label: '', matched: found.length, items: [], error: (r.body && r.body.error) || String(r.status) };
  return { q, skus: r.body.order, status: 'sorted', regional: r.body.regional || null, label: leanLabel(r.body.regional), matched: found.length, items: r.body.items || [] };
}
/** The search route until a section registers its own renderer: the results in a sheet, in /sort's order. */
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
  h.demo.sheets.open('search', `<p class="sk">Search</p><h2 id="sheetTitle">${res.matched ? `${res.matched} result${res.matched === 1 ? '' : 's'} for “${esc(res.q)}”` : `Nothing in the feed matches “${esc(res.q)}”`}</h2>`
    + (res.matched ? `<p class="st-fine">${res.status === 'sorted' ? 'In the engine’s order, POST /sort over every match' : 'In the site’s own order: POST /sort did not answer'}${res.label ? ` · <span class="st-lean">${esc(res.label)}</span>` : ''}</p><div class="st-results">${cards}</div>` : '<p>Try a type (OLED, front-load), a category (dishwashers) or a model number.</p>'));
  return res;
}
const search = { index, match, query };

// ── Find a Retailer: buy directly first, then the outcomes ───────────────────
const M = { sku: null, decision: null };
/** A list entry as the catalog may write it: { name, kind, distanceMiles?, note? } (D1's), [key, name], or a bare name. */
const slugOf = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function entryOf(x) {
  if (Array.isArray(x)) return { key: String(x[0]), name: String(x[1] != null ? x[1] : x[0]), note: null, miles: null };
  if (x && typeof x === 'object') {
    const name = String(x.name || x.label || x.key || x.id || '');
    const miles = x.distanceMiles !== null && x.distanceMiles !== undefined && Number.isFinite(num(x.distanceMiles)) ? num(x.distanceMiles) : null;
    return { key: String(x.key || x.id || slugOf(name)), name, note: x.note ? String(x.note) : null, miles };
  }
  return { key: slugOf(x), name: String(x), note: null, miles: null };
}
/**
 * The stores the modal lists, read from the catalog document the page loads (/oh/catalog.json; the engine's answer
 * carries no display fields): the where-to-buy piece's display.retailers, D1's { source, groups: [{ label, families,
 * online, nearby }] }, the group whose families hold the product's family. Only when the piece has no list for it, the
 * store's own per room. `fromCatalog` and `label` say which is in use; the modal shows it.
 */
function retailerLists(p) {
  const piece = DOCS.pieces.find((x) => x.customerContentId === RETAIL_CID);
  const own = piece && piece.display && piece.display.retailers;
  const fam = need().field(p, 'family') || p.family || null;
  const group = own && arr(own.groups).find((g) => g && arr(g.families).includes(fam));
  if (group && (arr(group.online).length || arr(group.nearby).length)) {
    const source = String(own.source || 'the demo’s own list');
    return { online: arr(group.online).map(entryOf), nearby: arr(group.nearby).map(entryOf), fromCatalog: true, group: group.label || group.key || null,
      label: source.split(':')[0].trim(), source };
  }
  const mine = RETAILERS[roomOf(p)] || RETAILERS['living-room'];
  return { online: mine.online.map(entryOf), nearby: mine.nearby.map(entryOf), fromCatalog: false, group: null,
    label: 'the store’s own list for this room, until the catalog’s where-to-buy piece carries one for it', source: 'oh-store.js RETAILERS' };
}
/** The where-to-buy decision on the page on screen for that module, with its position. */
function onScreen(cid) {
  const st = S();
  const set = st.sets[st.viewPage] || null;
  const mods = T().bySlot(set, 'pdp-modules');
  const i = mods.findIndex((d) => d.customerContentId === cid);
  return i < 0 ? null : { decisionId: mods[i].decisionId, contentId: mods[i].contentId, slot: mods[i].slot, customerContentId: mods[i].customerContentId, position: i + 1 };
}
const offersPickup = (p) => arr(p && p.attributes && p.attributes.retailer).includes('best-buy-pickup') || (p && p.bestBuyPickup === true);
async function openRetailers(product, decision) {
  const h = need();
  const p = productOfAny(product || S().productId);
  if (!p) throw new Error('Find a Retailer belongs to a product');
  await ensure();
  const sku = h.idOf(p), name = h.productName(p);
  M.sku = sku;
  M.decision = decision && decision.decisionId ? decision : onScreen(RETAIL_CID);
  // A pickup pressed in the modal is credited to the pickup module's decision on the page, else to the decision that opened it.
  M.pickup = (decision && decision.customerContentId === PICKUP_CID ? decision : null) || onScreen(PICKUP_CID) || M.decision;
  const lists = retailerLists(p);
  M.source = lists.fromCatalog ? 'catalog' : 'store';
  const region = (S().own && (S().own.label || S().own.key)) || P().ownName();
  const sold = p.cta === 'cart' && p.inStock !== false && priceNum(p) !== null;
  // A nearby store's distance shows only when the list carries one: no address or distance is invented for her region.
  const row = (e, where) => `<div class="srow"><span><b>${esc(e.name)}</b><br><span class="nper">${where === 'nearby' ? `in store near you${e.miles !== null ? ` · ${esc(e.miles)} mi` : ''} · ${esc(region)}, from the request` : 'online'}${e.note ? ` · ${esc(e.note)}` : ''} · price and stock at the retailer</span></span>`
    + `<button type="button" class="btn btn--line btn--sm" data-act="store-referral" data-sku="${esc(sku)}" data-retailer="${esc(e.key)}" data-retailer-name="${esc(e.name)}" data-where="${where}" data-ctl="retailer-${where === 'nearby' ? 'nearby-' : ''}${esc(e.key)}">Shop at ${esc(e.name)}</button></div>`;
  h.demo.sheets.open('retailers', `<p class="sk">Find a Retailer · ${esc(sku)}</p><h2 id="sheetTitle">Where to buy the ${esc(name)}</h2>`
    + '<p class="st-h">Buy directly</p>'
    + (sold ? `<div class="srow"><span><b>From OH.</b> ${money(priceNum(p))}<br><span class="nper">the same price for everyone · delivered, or picked up where offered</span></span><button type="button" class="btn btn--brand btn--sm" data-act="store-retailer-buy" data-sku="${esc(sku)}" data-ctl="retailer-buy-direct">Add to Cart</button></div>`
      : `<div class="srow"><span><b>From OH.</b><br><span class="nper">${p.inStock === false ? 'out of stock here: Notify Me on the product page' : 'not sold here: the stores below carry it'}</span></span></div>`)
    + (offersPickup(p) ? `<div class="srow"><span><b>Pick up at Best Buy</b><br><span class="nper">an OH order, handed over by a partner · often ready in about two hours</span></span><button type="button" class="btn btn--line btn--sm" data-act="store-pickup" data-sku="${esc(sku)}" data-ctl="retailer-pickup">Choose Best Buy pickup</button></div>` : '')
    + `<p class="st-fine st-source" data-retailer-source="${lists.fromCatalog ? 'catalog' : 'store'}" title="${esc(lists.source)}">The stores below are ${esc(lists.label)}${lists.group ? ` (${esc(lists.group)})` : ''}.</p>`
    + `<p class="st-h">Online</p>${arr(lists.online).map((e) => row(e, 'online')).join('')}`
    + `<p class="st-h">Nearby stores</p>${arr(lists.nearby).map((e) => row(e, 'nearby')).join('')}`
    + `<p class="st-fine">${M.decision ? `A press is sent as <code>retailer_referral</code> (pickup as <code>partner_pickup</code>) with the decision that earned it${M.decision.position ? `, #${M.decision.position} on this page` : ''}.` : 'No decided where-to-buy module earned this press, so an outcome here is sent and credited to no decision.'}`
    + ` <b>A referral is not a sale</b>: what the retailer sells is the retailer’s ledger, and registration is how a sale finds its way back. A pickup is an order of ours, never a second purchase. The list is the same for everyone and nothing leaves this page.</p>`);
  // The product's own retailer value is kept: the channel is data.event, and no event overwrites a product attribute.
  await send('find_a_retailer', { sku, control: decision ? 'where-to-buy' : 'buy-box' }, { note: ['opened', `Find a Retailer · ${name}`, M.decision ? 'from a decided module: its outcomes are credited to it' : 'the buy box’s own button, the same for everyone'] });
  return true;
}
/**
 * One outcome, recorded, for the modal's buttons and the pickup module's own: type custom, data.event the channel, the
 * product's own attributes as the feed has them (its own retailer value kept), data.store the store chosen, data.where
 * online | nearby for a referral, and the decision that earned it. P3's section reads the day's baseline before it and
 * records it after it (the host's beforeOutcome and outcome).
 */
async function outcome(event, t) {
  const h = need();
  const p = productOfAny((t && t.dataset && t.dataset.sku) || M.sku);
  if (!p) throw new Error('Find a Retailer first: the outcome belongs to a product');
  const at = event === 'partner_pickup' ? M.pickup : M.decision;
  const key = event === 'partner_pickup' ? 'best-buy' : t.dataset.retailer, label = event === 'partner_pickup' ? 'Best Buy' : (t.dataset.retailerName || key);
  await ensure();
  if (h.beforeOutcome) await h.beforeOutcome();
  const r = await send(event, { sku: h.idOf(p), ...decisionData(at), store: key, ...(event === 'retailer_referral' ? { where: t.dataset.where || 'online' } : {}) },
    { note: ['outcome', `${event} · ${label}`, `${h.productName(p)} · ${at ? `credited to the decision that earned it${at.position ? ` (#${at.position})` : ''}` : 'credited to no decision'}${event === 'retailer_referral' ? ' · a referral is not a sale' : ' · never a purchase'}`] });
  if (!r || !r.ok || (r.body && r.body.success === false)) throw new Error(`the engine did not take the ${event} (${(r && r.status) || 'no answer'})`);
  if (h.outcome) h.outcome({ event, sku: h.idOf(p), store: key, decisionId: at ? at.decisionId : null, position: at ? at.position || null : null, retailerName: label, at: Date.now(), credited: Boolean(at) });
  await h.demo.sheets.close();
  toast(event === 'partner_pickup' ? `Best Buy pickup chosen for the ${h.productName(p)}` : `Referred to ${label}: a referral, not a sale`, 'good');
  return true;
}
/** Best Buy pickup from the decided pickup module's own button: the same outcome, with that module's decision (else the one on the page). */
async function pickup(product, decision) {
  const p = productOfAny(product || S().productId);
  if (!p) throw new Error('Best Buy pickup belongs to a product');
  if (!offersPickup(p)) { const m = `Best Buy pickup is not offered for the ${need().productName(p)}`; toast(m, 'bad'); throw new Error(m); }
  M.sku = need().idOf(p);
  M.pickup = decision && decision.decisionId ? decision : onScreen(PICKUP_CID);
  return outcome('partner_pickup', { dataset: { sku: M.sku } });
}
const retailers = { open: openRetailers, pickup };

// ── Sign-in: P3's sheet, from any page's header ──────────────────────────────
function mount() {
  if (!H) return;
  const header = document.querySelector('#site .site-header');
  if (!header) return;
  for (const node of header.querySelectorAll('[data-cart-count]')) node.textContent = String(count());
  if (header.dataset.storeHeader === 'own') return;      // a header that carries its own pieces (M1's) is left as it is
  const sign = document.getElementById('signIn');
  if (sign && !sign.dataset.act) { sign.dataset.act = 'sign-in'; sign.dataset.ctl = 'sign-in'; sign.setAttribute('role', 'button'); sign.tabIndex = 0; }
  if (!sign && !header.querySelector('[data-act="sign-in"]')) {
    const slot = header.querySelector('.u-right') || header;
    slot.insertAdjacentHTML('beforeend', '<button type="button" class="u-sign st-sign" id="signIn" data-act="sign-in" data-ctl="sign-in">Sign in</button>');
  }
  const mast = header.querySelector('.mast') || header;
  if (!header.querySelector('form[data-store-search]')) {
    mast.insertAdjacentHTML('beforeend', '<form class="st-search" data-store-search role="search"><input name="q" type="search" placeholder="Search TVs, laundry, kitchen" aria-label="Search the store" autocomplete="off" data-ctl="search-input"><button type="submit" class="st-search-go" data-ctl="search-go" aria-label="Search">Search</button></form>');
  }
  if (!header.querySelector('[data-act="store-cart-open"]')) {
    mast.insertAdjacentHTML('beforeend', '<button type="button" class="st-cart" data-act="store-cart-open" data-ctl="cart-open" aria-label="Cart">Cart <span class="st-cart-n" data-cart-count>0</span></button>');
  }
  for (const node of header.querySelectorAll('[data-cart-count]')) node.textContent = String(count());
}
const signin = { open: () => need().signIn.open(), account: () => (H && H.signIn && H.signIn.account ? H.signIn.account() : null), mount };

// ── The toast ────────────────────────────────────────────────────────────────
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

// ── The dispatcher's share ───────────────────────────────────────────────────
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
    case 'store-add': await add(d.sku, { target: t, qty: d.qty }); return true;
    case 'store-retailers': return openRetailers(d.sku, decisionOf(t));
    case 'store-retailer-buy': await need().demo.sheets.close(); await add(d.sku, { fromDecisionId: M.decision ? M.decision.decisionId : null }); return true;
    case 'store-pickup': return outcome('partner_pickup', t);
    case 'store-referral': return outcome('retailer_referral', t);
    case 'store-nav': return go(d.href || BASE);
    case 'store-signin': signin.open(); return true;
    default: return false;
  }
}

// ── The store's few styles (oh.css is M1's; these are the store's own pieces, in OH's tokens) ─
function style() {
  if (document.getElementById('store-style')) return;
  const css = [
    '.st-toast{position:fixed;left:18px;bottom:calc(var(--bar-h) + 16px);z-index:960;max-width:min(460px,80vw);background:var(--ink);color:var(--on-dark);font-size:14px;line-height:1.4;padding:10px 14px;border-radius:6px;box-shadow:0 6px 22px var(--shade-28)}',
    '.st-toast[data-tone="bad"]{background:var(--brand-deep)}',
    '.st-search{display:flex;align-items:center;gap:6px;margin-left:auto;min-width:0;flex:0 1 260px}',
    '.st-search input{width:100%;min-width:60px;flex:1 1 auto;font:inherit;font-size:14px;border:1px solid var(--line-2);border-radius:4px;padding:7px 10px;background:var(--paper);color:var(--ink)}',
    '.st-search-go,.st-cart,.st-sign{font:inherit;font-size:13.5px;font-weight:600;border:1px solid var(--ink);background:var(--paper);color:var(--ink);border-radius:4px;padding:7px 11px;cursor:pointer}',
    '.st-cart{display:inline-flex;gap:6px;align-items:center;margin-left:8px}',
    '.st-cart-n{display:inline-block;min-width:20px;text-align:center;background:var(--brand);color:var(--on-dark);border-radius:10px;font-size:12px;padding:1px 6px}',
    '.st-lines{display:grid;gap:12px;margin:12px 0 6px}',
    '.st-line{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;align-items:start;border-top:1px solid var(--line);padding-top:12px}',
    '.st-line-main{display:grid;gap:3px;min-width:0}',
    '.st-line-name{font-size:14px;color:var(--ink)}',
    '.st-line-sku,.st-line-add{font-size:12.5px;color:var(--muted)}',
    '.st-line-add em{font-style:normal;color:var(--ink)}',
    '.st-line-price{font-weight:700;color:var(--ink);text-align:right;display:grid}',
    '.st-line-price s{font-weight:400;color:var(--muted);font-size:12.5px}',
    '.st-qty{display:flex;align-items:center;gap:8px;margin-top:4px}',
    '.st-qbtn{width:28px;height:28px;border:1px solid var(--line-2);background:var(--paper);border-radius:4px;cursor:pointer;font-size:16px;line-height:1}',
    '.st-link{border:0;background:none;color:var(--brand);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline;padding:0 0 0 6px}',
    '.st-art{display:block;aspect-ratio:1/1;background:var(--soft);border-radius:4px;overflow:hidden}',
    '.st-art img{width:100%;height:100%;object-fit:contain;display:block}',
    '.st-noimg{display:flex;align-items:center;justify-content:center;height:100%;padding:6px;font-size:10.5px;color:var(--muted);text-align:center}',
    '.sheet .st-saving b{color:var(--brand)}',
    '.sheet .st-total{font-size:16px}',
    '.sheet .st-fine{font-size:12.5px;color:var(--muted);margin-top:10px}',
    '.sheet .st-h{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-deep);margin:16px 0 2px}',
    '.st-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:12px}',
    '.st-result{display:grid;gap:5px;text-align:left;border:1px solid var(--line);background:var(--paper);border-radius:6px;padding:8px;cursor:pointer;font:inherit}',
    '.st-result-name{font-size:13px;color:var(--ink);line-height:1.3}',
    '.st-result-price{font-size:13px;font-weight:700}',
    '.st-result-price s{font-weight:400;color:var(--muted)}',
    '.st-lean{color:var(--brand-deep)}',
  ].join('\n');
  document.head.insertAdjacentHTML('beforeend', `<style id="store-style">${css}</style>`);
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
    void go(`${BASE}?q=${encodeURIComponent(q)}`).catch((error) => toast(String((error && error.message) || error), 'bad'));
  });
}

// ── The bind ─────────────────────────────────────────────────────────────────
function bind(host) {
  if (H) throw new Error('oh-store: bound twice');
  H = host;
  if (!H.lanes.routes) H.lanes.routes = {};
  const t = T(), useVisitor = t.useVisitor, ensureVisitor = t.ensureVisitor;
  t.useVisitor = (key) => { useVisitor(key); if (key === 'A') persist(t.cur()); };
  // The kit's own mint (a direct product address, the director's first press; the store's ensure goes through it too):
  // visitor A is kept the moment it answers, not when the page around it has finished asking.
  t.ensureVisitor = async () => { const v = await ensureVisitor(); persist(v); return v; };
  // The page's own events straight to the kit (a page view, a product view, a declared fit), by hand, never in a beat:
  // the panel is drawn the moment the answer lands, with the event's name, so the audience chips mark what its answer
  // reported, while the page asks its question, whose read confirms it. The
  // store's own events go out on the kit's sends as they were (raw) and draw in send().
  raw = { cur: t.cur, send: t.send, sendCustom: t.sendCustom };
  t.send = async (type, data, v) => { const who = v || t.cur(), r = await raw.send(type, data, v); if (!S().busy) drawEarly(r, type, who); return r; };
  t.sendCustom = async (name, data, v) => { const who = v || t.cur(), r = await raw.sendCustom(name, data, v); if (!S().busy) drawEarly(r, name, who); return r; };
  // A new walk (beat 1's arrival) is a new stranger: her cart starts empty.
  H.lanes.beforeBeat.push((b) => { if (b && b.data && b.data.arrives) clearAll(); });
  style();
  void loadDocs().then(() => { mount(); readyNow(true); }).catch(() => readyNow(false));
  return store;
}

export const store = {
  bind, ready, control, visitor, events, reask, nav, cart, search, retailers, signin, ui, trail,
  /** For the suites and the console under ?debug: what the store holds, read-only. */
  debug: () => ({ lines: lines(), total: total(), route: lastRoute, trail: (H && T().cur() && T().cur().ohStore) ? [...T().cur().ohStore.trail] : [], when: hhmm(Date.now()) }),
};
