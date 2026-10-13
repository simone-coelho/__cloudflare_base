#!/usr/bin/env node
// scripts/seed-shn.mjs — "Top Offers": the QVC four-container module, seeded.
//
// Lantern & Lane is the representative retailer. The brand lives in BRAND below
// and nowhere else, so renaming it is one line.
//
// THE POOL IS PROMOTIONS, NOT PRODUCTS. Garrett's FPO visual shows "Spring
// Beauty Event", "Refresh Your Home", "Fashion Essentials", "Top Kitchen Picks":
// an editorial image, a promotion title, a badge, one Shop Now. No price, no
// strikethrough, no rating, no Add to Cart. That is not decoration — our own
// competitive dossier says Constructor already owns product discovery on both
// their properties, so a module dressed as a product grid argues on the
// incumbent's turf by accident. The pool lives in lib/shn-promotions.mjs and the
// creative is generated once by generate-shn-art.mjs.
//
// This script is the only place the demo's world is defined. It publishes, to
// the `shn` scope:
//
//   • the dimension registry  (PUT /config/reflex)   — five dimensions
//   • the promotion pool      (PUT /content/catalog) — pieces with real windows
//   • the slots               (PUT /content/slots)   — top-offers and the banner
//   • what the slots learn    (PUT /content/learn)   — the click reward
//
// and it writes the per-beat documents the page's director bar publishes on
// stage, to public/top-offers/beats/. Every director press is a real versioned
// write through the real API, so each one lands in the document history the
// operator console already shows. There is no second path into the engine.
//
//   node scripts/seed-shn.mjs [--base http://localhost:9100] [--scope shn] [--token <jwt>]
//
// Use --token or OPERATOR_TOKEN. Local minting requires explicit JWT_SECRET,
// JWT_ISSUER and JWT_AUDIENCE; remote targets require an existing operator token.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';
import { CATEGORIES, LIVE, GROWTH, WINTER, DEFAULT_IDS, ALL } from './lib/shn-promotions.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope', 'shn');
const writeOnly = argv.includes('--files-only');

const HOUR = 3_600_000, DAY = 24 * HOUR, MINUTE = 60_000;
const iso = (ms) => new Date(ms).toISOString();

/** The retailer. One constant, referenced everywhere, so a rename is one line. */
const BRAND = { name: 'Lantern & Lane', dailyDeal: 'The Lantern Pick' };

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The registry. Five dimensions, on the SHIPPED tuning constants.
//
// Nothing here is demo-rate. τ = 14 days, K = 1.8, θin = 0.60, θout = 0.45 are
// the engine's own defaults, so the arithmetic on stage is the arithmetic a
// customer gets. Price posture is the one dimension with its own horizon (35
// days), because what someone will spend outlasts what they are browsing.
//
// The five are QVC's own words. Category, subcategory and brand are Jamie's
// three metadata fields verbatim. offerType is the badge in Garrett's own
// screenshot — free metadata and a real audience split, since people who
// respond to clearance and people who respond to easy pay are different people.
// ─────────────────────────────────────────────────────────────────────────────
const reflex = {
  version: 'reflex-lantern-v2',
  dimensions: [
    { key: 'category', source: 'category' },
    { key: 'subcategory', source: 'subcategory' },
    { key: 'brand', source: 'brand' },
    { key: 'offerType', source: 'offerType', multi: true },
    { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [40, 120, 300], labels: ['entry', 'core', 'elevated', 'premium'], tauMs: 35 * DAY },
  ],
  weights: {
    // A category page view is the signal their `uattr` cookie already computes,
    // so it is the one that has to count. The rest are the shipped scale.
    page_view: 1,
    product_view: 1,
    pdp_view: 1,
    content_impression: 0,
    content_dwell: 0.5,
    content_click: 1,
    add_to_cart: 3,
    purchase: 5,
    tick: 0,
  },
  tauMs: 14 * DAY,
  K: 1.8,
  thetaIn: 0.6,
  thetaOut: 0.45,
  epsilon: 0.01,
  maxValuesPerDim: 64,
  // Their product catalog is never loaded for this use case: a view of a product
  // we do not hold still moves affinity when the event carries its attributes.
  // "We hold your offers, not your catalog."
  eventAttributes: 'event-when-unknown',
};

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The pool.
//
// Jamie Simpson, 22 September: "Typical size for each day is 12 - but want to
// work our way up to 20 offers in the pool. Offers live for approx 3-7 days at a
// time, and a new offer always follows one that leaves. 2 offers per category
// today (beauty, jewelry, fashion, home, cook, electronics)."
// ─────────────────────────────────────────────────────────────────────────────
const artDir = new URL('../public/top-offers/art/', import.meta.url);
const artUrl = (id) => (existsSync(new URL(`${id}.jpg`, artDir)) ? `/top-offers/art/${id}.jpg` : null);

const BAND_PRICE = { entry: 29.98, core: 79.98, elevated: 199.98, premium: 449.98 };

/** Windows in the range Jamie gave: three to seven days, staggered so the pool looks live. */
function windowFor(index, anchor, opts = {}) {
  if (opts.closesIn !== undefined) return { from: iso(anchor - 3 * DAY), to: iso(anchor + opts.closesIn) };
  const lives = [3 * DAY, 5 * DAY, 7 * DAY, 4 * DAY, 6 * DAY, 3 * DAY + 12 * HOUR][index % 6];
  const started = [8 * HOUR, 2 * DAY, DAY, 3 * HOUR, 30 * HOUR, 12 * HOUR][index % 6];
  return { from: iso(anchor - started), to: iso(anchor - started + lives) };
}

function pieceOf(promo, index, anchor, opts = {}) {
  return {
    id: promo.id.toLowerCase().replace(/-/g, '_'),
    customerContentId: promo.id,
    type: 'promotion',
    title: opts.title ?? promo.title,
    subtitle: opts.subtitle ?? promo.blurb,
    tags: {
      category: [promo.category],
      subcategory: [promo.subcategory],
      brand: [promo.brand],
      offerType: [promo.badge],
      priceBand: [promo.band],
    },
    slotTypes: ['top-offers', 'banner-category', 'banner-search'],
    lifecycle: { status: 'live' },
    window: opts.window ?? windowFor(index, anchor, opts),
    ...(artUrl(opts.art ?? promo.id) ? { renderUrl: artUrl(opts.art ?? promo.id) } : {}),
    freshnessDate: opts.freshnessDate ?? iso(anchor - (index % 6) * DAY),
    inStock: true,
    ...(opts.eligibleWhen ? { eligibleWhen: opts.eligibleWhen } : {}),
    ...(opts.merchandising ? { merchandising: opts.merchandising } : {}),
  };
}

/** The beats turn on four named pieces. Declared, so the rehearsals can assert them. */
const EXPIRING_ID = 'SHN-KIT-02';   // its window closes an hour after the reset
const ARRIVAL_ID = 'SHN-KIT-03';    // published on stage, with no history at all
const SWAP_ID = 'SHN-KIT-01';       // Final Hours creative, same content id
const SHOWCASE_ID = 'SHN-BEA-01';   // the day's pick, deliberately NOT cook

const anchor = Date.now();
const basePieces = LIVE.map((p, i) => pieceOf(p, i, anchor, p.id === EXPIRING_ID ? { closesIn: HOUR } : {}));

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The slots.
//
// One slot, take 4, the whole pool as candidates. There is nothing to arrange:
// twelve promotions is twelve scores, not four hundred and ninety-five orderings
// of twelve-choose-four.
//
// And the Contextual Banner, Garrett's SECOND use case: one container, category
// and search pages only, the same pool and the same windows — and it must not
// show to new customers, which the page enforces as the inverse of the Top
// Offers gate.
// ─────────────────────────────────────────────────────────────────────────────
function slotsDoc({ promotion = 0, pinned = null } = {}) {
  const topOffers = {
    slot: 'top-offers',
    take: 4,
    weights: { category: 0.40, subcategory: 0.22, brand: 0.18, offerType: 0.12, priceBand: 0.08 },
    // Two promotions per category (Jamie's number) means four containers already
    // span at least two categories by construction, so at twelve this cap is a
    // no-op and we say so rather than claim it is doing work. It binds at the
    // twenty Jamie wants to grow to, where some categories carry three.
    diversity: { dimension: 'category', max: 2 },
    freshness: { weight: 0.08, halfLifeDays: 5 },
    merchandising: { promotion, maxBoost: 1.6, minBoost: 0.7 },
    ...(pinned ? { pinnedPieceIds: [pinned] } : {}),
  };
  // The engine refuses one slot name on two pages, because one slot name is one
  // statistics object. That is the right answer here anyway: a banner beside
  // category results and a banner beside search results are different contexts
  // and must not pool their evidence.
  const banner = (slot) => ({
    slot,
    take: 1,
    weights: { category: 0.45, subcategory: 0.25, brand: 0.15, offerType: 0.15 },
    freshness: { weight: 0.05, halfLifeDays: 5 },
  });
  return { version: `slots-${scope}`,
    pages: { home: [topOffers], category: [banner('banner-category')], search: [banner('banner-search')] } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · The beat documents. Each is the whole catalog at that point in the story,
// so a press is one full versioned publish and any beat can be entered directly.
// ─────────────────────────────────────────────────────────────────────────────
const shifted = (pieces, byMs) => pieces.map((p) => ({ ...p,
  window: { from: iso(Date.parse(p.window.from) - byMs), to: iso(Date.parse(p.window.to) - byMs) } }));

/** Two hours pass, so EXPIRING_ID's window has closed. */
const clock = shifted(basePieces, 2 * HOUR);

/** The arrival — a new promotion follows the one that left, Jamie's own sentence. */
const arrivalPromo = GROWTH.find((p) => p.id === ARRIVAL_ID);
const arrival = [...clock, pieceOf(arrivalPromo, basePieces.length, anchor, {
  window: { from: iso(anchor - 2 * MINUTE), to: iso(anchor + 4 * DAY) },
  freshnessDate: iso(anchor - 2 * MINUTE),
})];

/** The closing creative, behind the SAME content id. */
const finalHours = arrival.map((p) => (p.customerContentId !== SWAP_ID ? p : {
  ...p,
  title: `Final Hours: ${p.title}`,
  subtitle: 'Ends tonight — the last of the season’s picks.',
  ...(artUrl(`${SWAP_ID}-final`) ? { renderUrl: artUrl(`${SWAP_ID}-final`) } : {}),
}));

/** The merchandiser reinforces the day's pick. */
const showcase = finalHours.map((p) => (p.customerContentId !== SHOWCASE_ID ? p : {
  ...p,
  tags: { ...p.tags, offerType: [...new Set([...p.tags.offerType, BRAND.dailyDeal])] },
  merchandising: { promotion: 1 },
}));

/**
 * The snow rule. Simone promised QVC this one in writing: "a snow condition
 * surfacing a winter offer for a shopper in Washington and not for one in
 * Florida". The piece is never eligible without BOTH halves of its rule, so it
 * sits in the published pool from the very first beat and still nobody sees it.
 * That is the honest demonstration — it was there all along, gated.
 */
const winter = pieceOf(WINTER, basePieces.length + 1, anchor, {
  window: { from: iso(anchor - DAY), to: iso(anchor + 5 * DAY) },
  // Published TODAY, so that when its rule finally admits it, it competes on the
  // same footing as the rest of the home pieces rather than losing on age. The
  // category cap holds "For the Home" at two containers either way, so what the
  // room sees is the winter piece TAKING a home slot from another home piece —
  // which is the honest picture: eligibility admits it, ranking still decides.
  freshnessDate: iso(anchor),
  eligibleWhen: { regions: ['US-WA', 'US-OR'], context: { weather: ['snow'] } },
});
const withWinter = (pieces) => [...pieces, winter];

/** The twenty Jamie wants to reach. */
const grown = [...showcase, ...GROWTH.filter((p) => p.id !== ARRIVAL_ID)
  .map((p, i) => pieceOf(p, basePieces.length + 10 + i, anchor))];

const catalogDoc = (pieces, label) => ({ version: `content-shn-${label}`, pieces });

const BEATS = {
  'catalog-1': catalogDoc(withWinter(basePieces), 'open'),
  'catalog-clock': catalogDoc(withWinter(clock), 'clock'),
  'catalog-arrival': catalogDoc(withWinter(arrival), 'arrival'),
  'catalog-final': catalogDoc(withWinter(finalHours), 'final-hours'),
  'catalog-showcase': catalogDoc(withWinter(showcase), 'showcase'),
  'catalog-grown': catalogDoc(withWinter(grown), 'grown-to-twenty'),
  'slots-1': slotsDoc({ promotion: 0 }),
  // MEASURED against the field the beat actually acts on, not guessed. At that
  // point the ranked scores are 0.4440 / 0.3840 / 0.3300 (the pick) / 0.3300.
  // The promotion term is a multiplier, so 0.25 puts the pick at 0.4125: past
  // second place and short of first. The visitor's own cook affinity still leads.
  //
  // Note what is NOT claimed here. The slot's 1.6x clamp would allow 0.5280,
  // which is above first place — so in THIS field the clamp is not what holds
  // the pick back; the chosen weight is. Say the true thing: a weight lifts by
  // an amount the merchandiser picks, and if they want first place for everyone
  // regardless of the shopper, that is a pin and it looks like one.
  'slots-promo': slotsDoc({ promotion: 0.25 }),
  'slots-pin': slotsDoc({ promotion: 0.25, pinned: SHOWCASE_ID.toLowerCase().replace(/-/g, '_') }),
  // Garrett: "what if the layout of the content for a personalised module
  // changes? Say today it expects 2 pieces of content, and tomorrow 4?" It is
  // one field on a published document, with history and rollback.
  // Built from the PINNED document, not a fresh one: the beat that follows the
  // pin must change exactly one thing. Dropping the pin here made the top two
  // reorder, which would have been two changes presented as one.
  'slots-take2': (() => {
    const d = slotsDoc({ promotion: 0.25, pinned: SHOWCASE_ID.toLowerCase().replace(/-/g, '_') });
    d.pages.home[0].take = 2;
    return d;
  })(),
};

/** What the slots learn against: a click into the module, counted as a unit. */
const LEARN_BASELINE = {
  version: 'learn-shn',
  holdout: { share: 0, salt: 'lantern', arms: ['default'] },
  slots: {
    'top-offers': { reward: 'click', objective: 'unit' },
    'banner-category': { reward: 'click', objective: 'unit' },
    'banner-search': { reward: 'click', objective: 'unit' },
  },
};

/**
 * THE SHOP THE VISITOR WALKS THROUGH — products, not promotions.
 *
 * This is the distinction their site already makes and ours must too. The
 * MODULE decides promotions; the SHOP is where the visitor browses, and browsing is
 * what builds the affinity the module then reads. A department page view and a
 * product view carry category, subcategory and brand, which is exactly the
 * metadata Jamie said travels with each piece of content — so the signal the visitor
 * produces and the pieces it scores speak the same vocabulary.
 *
 * The rows come from the generated packshot catalog; none of that demo's
 * storyline comes with them.
 */
const shopSource = JSON.parse(readFileSync(new URL('../src/demos/brighthour/catalog.data.json', import.meta.url), 'utf8')).items;
const products = shopSource.filter((i) => CATEGORIES.includes(i.category)).map((i) => ({
  id: i.id,
  title: i.shortDubner ?? i.name,
  name: i.name,
  brand: i.brandName,
  category: i.category,
  subcategory: i.subcategory,
  price: i.pricing?.currentSellingPrice ?? null,
  was: i.pricing?.ourPrice ?? null,
  pays: i.pricing?.brightPay?.phrasing ?? null,
  priceBand: i.pricing?.priceBand ?? 'core',
  image: i.image_url,
  bullets: (i.bulletedDescription ?? []).slice(0, 4),
  rating: i.reviews?.averageRating ?? null,
  reviews: i.reviews?.count ?? null,
}));
writeFileSync(new URL('../public/top-offers/products.json', import.meta.url),
  `${JSON.stringify({ categories: CATEGORIES, products }, null, 1)}\n`);

const beatsDir = new URL('../public/top-offers/beats/', import.meta.url);
mkdirSync(beatsDir, { recursive: true });
for (const [name, document] of Object.entries(BEATS)) {
  writeFileSync(new URL(`${name}.json`, beatsDir), `${JSON.stringify(document, null, 1)}\n`);
}

/**
 * What the PAGE needs that the engine does not decide: which four are QVC's
 * defined defaults, the page count that releases them, and the ids the beats
 * turn on. Jamie: "We would use static, defined content until the customer
 * interacts with ideally 5+ pages on the website (in their lifetime), to then
 * trigger personalized content."
 */
writeFileSync(new URL('anchor.json', beatsDir), `${JSON.stringify({
  anchor: iso(anchor), scope, brand: BRAND,
  defaults: DEFAULT_IDS,
  personalizeAfterPages: 5,
  expiringId: EXPIRING_ID, arrivalId: ARRIVAL_ID, swapId: SWAP_ID, showcaseId: SHOWCASE_ID,
  winterId: WINTER.id,
  pieces: basePieces.length, grown: grown.length,
  categories: CATEGORIES,
  promotions: ALL.map((p) => ({ id: p.id, title: p.title, blurb: p.blurb, category: p.category,
    subcategory: p.subcategory, brand: p.brand, badge: p.badge, band: p.band,
    art: artUrl(p.id), price: BAND_PRICE[p.band] ?? null })),
}, null, 1)}\n`);

console.log(`pool: ${basePieces.length} promotions across ${CATEGORIES.length} categories (grows to ${grown.length}), anchored ${iso(anchor)}`);
console.log(`art: ${ALL.filter((p) => artUrl(p.id)).length}/${ALL.length} frames present`);
console.log(`shop: ${products.length} browsable products across ${CATEGORIES.length} departments`);
console.log(`beats: wrote ${Object.keys(BEATS).length + 1} documents to public/top-offers/beats/`);

if (writeOnly) process.exit(0);

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Publish.
// ─────────────────────────────────────────────────────────────────────────────
const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'seed-shn', roles: ['operator'] },
  expiresIn: '30m', allowMint: isLoopbackTarget(base) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };

/**
 * No merchandiser token is written any more, anywhere. The page applies beats
 * BY NAME through /top-offers/api/beat and the worker holds the credential
 * (src/routes/topOffers.ts), because `public/` is served wholesale and a token
 * in a static directory on a hosted worker is a credential anyone can fetch.
 */

/**
 * One versioned publish, with the preconditions the configuration authority
 * requires: the authored document identity AND the publication-set identity in
 * one If-Match, plus an Idempotency-Key carrying the expected revision. Read
 * first, then write against exactly what was read, so two writers seconds apart
 * cannot silently overwrite one another. The page does the same handshake.
 */
const put = async (path, document, note) => {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}scope=${encodeURIComponent(scope)}`;
  const read = await fetch(url, { headers: auth });
  const current = await read.json().catch(() => null);
  if (!read.ok || !current || current.ok === false || !current.publication) {
    return { status: read.status, ok: false, error: (current && current.error) || `could not read ${path}` };
  }
  const headers = { ...auth,
    'If-Match': `"${current.revision}/${current.publication.revision}/${current.publication.digest}"`,
    'Idempotency-Key': `${current.revision}:${crypto.randomUUID()}` };
  // /config/reflex takes { config, note }; /content/:kind takes { document, note }.
  const envelope = path.startsWith('/config/') ? { config: document, note } : { document, note };
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(envelope) });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...body };
};

const report = (what, r) => {
  console.log(`${what}:`, JSON.stringify({ ok: r.ok, status: r.status, revision: r.revision, version: r.version, errors: r.errors, error: r.error }));
  return r.ok;
};

// The scope needs a configuration publication set before any route can read or
// write it. This creates one, once; it refuses a scope that already has one, so
// a re-run falls straight through to the ordinary versioned writes below.
const boot = await fetch(`${base}/ops/demo-bootstrap?scope=${encodeURIComponent(scope)}`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ reflex, catalog: BEATS['catalog-1'], slots: BEATS['slots-1'], learn: LEARN_BASELINE }),
});
const bootBody = await boot.json().catch(() => ({}));
if (boot.ok && bootBody.ok) console.log(`bootstrap: created the publication set for "${scope}"`);
else if (bootBody.code === 'already_initialized') console.log(`bootstrap: "${scope}" already has a publication set`);
else { console.log('bootstrap:', JSON.stringify({ status: boot.status, ...bootBody })); process.exit(1); }

let ok = true;
ok = report('reflex', await put('/config/reflex', reflex, 'Lantern & Lane registry: category, subcategory, brand, offerType, priceBand on the shipped tuning constants')) && ok;
ok = report('catalog', await put('/content/catalog', BEATS['catalog-1'], `Lantern & Lane pool: ${basePieces.length} promotions with CMS windows`)) && ok;
ok = report('slots', await put('/content/slots', BEATS['slots-1'], 'top-offers take 4 on home; a banner take 1 on category and on search')) && ok;

const current = await (await fetch(`${base}/content/learn?scope=${encodeURIComponent(scope)}`, { headers: auth })).json();
const learnDoc = current.document || {};
ok = report('learn', await put('/content/learn', {
  ...learnDoc,
  slots: { ...(learnDoc.slots || {}), ...LEARN_BASELINE.slots },
}, 'both modules are judged on clicks into them')) && ok;

process.exit(ok ? 0 : 1);
