#!/usr/bin/env node
/**
 * generate-synthetic-data.mjs
 * --------------------------------------------------------------------------
 * Reproducible generator of synthetic Coach NORTH AMERICA behavioural data,
 * SHAPED TO OPTIMIZELY ODP'S SCHEMA, for the Tapestry/Coach real-time
 * personalization sales demo.
 *
 * Architecture principle: "REAL SEAMS, MOCKED CALLS".
 *   - These files are the synthetic payload the MOCK connectors return
 *     (src/connectors: MockSegmentProvider, MockAudienceAuthoring,
 *      MockDecisionProvider) instead of calling live ODP / Opal / FX.
 *   - Customer attributes + events are shaped to ODP profiles & events so
 *     swapping mock -> live ODP is a config change, not a reshape.
 *   - The pre-aggregated INSIGHT VIEWS are what the mocked Opal
 *     audience-suggestion moment serves from, so suggestions are
 *     believable and data-grounded.
 *
 * DETERMINISM: a single integer seed (arg or --seed=) drives a Mulberry32
 * PRNG. There are NO calls to Math.random / Date.now / crypto.randomUUID in
 * the data path — re-running with the same seed reproduces byte-identical
 * output. A fixed EPOCH anchors all timestamps.
 *
 * USAGE:
 *   node scripts/generate-synthetic-data.mjs [seed] [--customers=N] [--out=dir]
 *   node scripts/generate-synthetic-data.mjs 42
 *   node scripts/generate-synthetic-data.mjs --seed=20260625 --customers=3500
 *
 * DEFAULTS: seed=20260625, customers=3200, out=data/synthetic
 * Reads the REAL catalog from data/coach-catalog.json (product IDs are real).
 *
 * OUTPUTS (written into <out>/):
 *   - customers.json   ODP-style customer profiles (identifiers + attributes + insights)
 *   - events.json      ODP-style behavioural events referencing real catalog product IDs
 *   - insights.json    pre-aggregated audience/insight views for the Opal mock
 * --------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// --------------------------------------------------------------------------
// 0. ARGS
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { seed: 20260625, customers: 3200, out: 'data/synthetic' };
  for (const a of argv) {
    if (/^\d+$/.test(a)) { out.seed = parseInt(a, 10); continue; }
    const m = a.match(/^--([a-zA-Z]+)=(.+)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'seed') out.seed = parseInt(v, 10);
    else if (k === 'customers') out.customers = parseInt(v, 10);
    else if (k === 'out') out.out = v;
  }
  if (!Number.isFinite(out.seed)) out.seed = 20260625;
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));

// --------------------------------------------------------------------------
// 1. SEEDED PRNG (Mulberry32) + helpers  — the ONLY source of randomness
// --------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(ARGS.seed);

const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
function weightedPick(entries) {
  // entries: [value, weight][]
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
  return entries[entries.length - 1][0];
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Deterministic zero-padded id
const pad = (n, w) => String(n).padStart(w, '0');
// Deterministic pseudo-uuid (vuid) from a counter — stable, no crypto
function deterministicVuid(n) {
  // ODP VUIDs look like: vuid_<32 hex>. We derive 32 hex chars from the PRNG.
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(rand() * 16).toString(16);
  return `vuid_${s}`;
}

// --------------------------------------------------------------------------
// 2. TIME MODEL — fixed epoch so timestamps are deterministic & seasonal
// --------------------------------------------------------------------------
// Anchor "now" = 2026-06-25T17:00:00Z (matches the demo brief's date).
const EPOCH_NOW = Date.UTC(2026, 5, 25, 17, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;               // events span the trailing 90 days
const WINDOW_START = EPOCH_NOW - WINDOW_DAYS * DAY;

// Seasonality multiplier by day-offset-from-start (0..89). Luxury retail NA:
// steady spring, a Mother's-Day-ish bump early, ramp toward late June.
// (Synthetic but plausible; drives event density per day.)
function seasonalWeight(dayOffset) {
  const t = dayOffset / WINDOW_DAYS;           // 0..1 across the window
  const base = 0.8 + 0.5 * t;                  // gentle upward trend to "now"
  const wave = 0.15 * Math.sin(t * Math.PI * 6); // weekly-ish ripple
  const promoBump = dayOffset >= 40 && dayOffset <= 47 ? 0.6 : 0; // a promo week
  return Math.max(0.2, base + wave + promoBump);
}

// --------------------------------------------------------------------------
// 3. LOAD REAL CATALOG (product IDs/lines/prices are REAL Coach values)
// --------------------------------------------------------------------------
const catalogPath = resolve(REPO_ROOT, 'data/coach-catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const PRODUCTS = catalog.products;
if (!Array.isArray(PRODUCTS) || PRODUCTS.length === 0) {
  throw new Error('coach-catalog.json has no products');
}

// Price-band classifier — aligned to the engine's `price_band_viewed`
// attribute (entry / core / elevated). Luxe folded into elevated for the
// 3-band signal the connector spec lists; a finer `price_tier` is also kept.
function priceBand(p) {
  if (p < 150) return 'entry';
  if (p < 400) return 'core';
  return 'elevated';
}
function priceTier(p) {
  if (p < 150) return 'entry';
  if (p < 400) return 'core';
  if (p < 600) return 'elevated';
  return 'luxe';
}

// Build fast lookups + popularity weights.
// Tabby is the hero line (brief): give Tabby/Pillow Tabby a popularity boost,
// Brooklyn second, then the rest. Within a line, cheaper SKUs skew popular.
const LINE_POPULARITY = {
  Tabby: 3.4, 'Pillow Tabby': 2.2, Brooklyn: 1.9, Lana: 1.2, Mollie: 1.1,
  Kira: 1.0, Nolita: 0.95, Rogue: 0.9, Willow: 0.8, Teri: 0.8, Cary: 0.8,
  Bandit: 0.75, Kisslock: 0.7, Nora: 0.7, Hadley: 0.6, Essential: 1.3,
  Signature: 0.8, Novelty: 0.7,
};
function productPopularity(p) {
  const lineW = LINE_POPULARITY[p.line] ?? 0.7;
  // price skew: lower price -> higher view propensity (entry/core skew)
  const priceW = p.price_usd < 150 ? 1.5 : p.price_usd < 400 ? 1.2 : p.price_usd < 600 ? 0.85 : 0.55;
  // handbags get more traffic than SLG/accessories
  const catW = p.category === 'Handbags' ? 1.3 : p.category === 'Small Leather Goods' ? 0.9 : 0.7;
  return lineW * priceW * catW;
}
const PRODUCT_WEIGHTS = PRODUCTS.map((p) => [p, productPopularity(p)]);

// Group products by line/category for affinity-coherent browsing & recs.
const byLine = {};
const byCategory = {};
const bySubcategory = {};
for (const p of PRODUCTS) {
  (byLine[p.line] ||= []).push(p);
  (byCategory[p.category] ||= []).push(p);
  (bySubcategory[p.subcategory] ||= []).push(p);
}
const ALL_LINES = Object.keys(byLine);
const HANDBAG_LINES = [...new Set(PRODUCTS.filter((p) => p.category === 'Handbags').map((p) => p.line))];

// Complete-the-look pairing: an anchor handbag line -> matching accessory/SLG.
function completeTheLook(anchorLine) {
  const charm = PRODUCTS.find((p) => p.category === 'Accessories' && p.line === anchorLine)
    || PRODUCTS.find((p) => p.subcategory === 'Bag Charms');
  const wallet = PRODUCTS.find((p) => p.category === 'Small Leather Goods' && p.line === anchorLine)
    || PRODUCTS.find((p) => p.subcategory === 'Wallets');
  return [charm, wallet].filter(Boolean);
}

// --------------------------------------------------------------------------
// 4. CUSTOMER POPULATION MODEL (ODP profile shape)
// --------------------------------------------------------------------------
// ODP North America locale data (synthetic but realistic).
const US_STATES = [
  ['CA', 'Los Angeles', 0.14], ['NY', 'New York', 0.11], ['TX', 'Houston', 0.09],
  ['FL', 'Miami', 0.08], ['IL', 'Chicago', 0.06], ['NJ', 'Newark', 0.05],
  ['MA', 'Boston', 0.045], ['WA', 'Seattle', 0.045], ['PA', 'Philadelphia', 0.04],
  ['GA', 'Atlanta', 0.04], ['VA', 'Arlington', 0.03], ['NV', 'Las Vegas', 0.03],
  ['AZ', 'Phoenix', 0.03], ['CO', 'Denver', 0.025], ['MI', 'Detroit', 0.02],
];
const CA_PROV = [['ON', 'Toronto', 0.5], ['BC', 'Vancouver', 0.22], ['QC', 'Montreal', 0.18], ['AB', 'Calgary', 0.1]];

const FIRST_NAMES = ['Olivia', 'Emma', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn',
  'Grace', 'Chloe', 'Zoe', 'Lily', 'Nora', 'Aria', 'Layla', 'Riley', 'Madison', 'Scarlett',
  'Jasmine', 'Priya', 'Mei', 'Sofia', 'Camila', 'Valentina', 'Aaliyah', 'Naomi', 'Leah', 'Hannah',
  'James', 'Michael', 'David', 'Daniel', 'Ethan', 'Lucas', 'Noah', 'Liam', 'Alexander', 'Benjamin'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Lee', 'Chen',
  'Patel', 'Nguyen', 'Kim', 'Singh', 'Wong', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen'];
const EMAIL_DOMAINS = [['gmail.com', 0.55], ['icloud.com', 0.18], ['yahoo.com', 0.12], ['outlook.com', 0.08], ['hotmail.com', 0.04], ['proton.me', 0.03]];
const DEVICES = [['mobile', 0.62], ['desktop', 0.30], ['tablet', 0.08]];
const CHANNELS = [['organic_search', 0.26], ['paid_social', 0.22], ['email', 0.16], ['direct', 0.14], ['paid_search', 0.12], ['referral', 0.06], ['affiliate', 0.04]];

// Behavioural personas — drive event volume, funnel depth, line affinity.
// Weights sum ~1. These are the spine of the realistic distributions.
const PERSONAS = [
  // key, weight, {viewsRange, addProb, purchaseProb (given add), gifter, lineBias, priceBias}
  ['tabby_enthusiast', 0.16, { views: [4, 14], addProb: 0.55, buyProb: 0.32, gifter: 0.08, lineBias: 'Tabby', priceBias: 'core_elevated' }],
  ['high_intent_browser', 0.13, { views: [6, 20], addProb: 0.62, buyProb: 0.18, gifter: 0.06, lineBias: null, priceBias: 'core' }],
  ['window_shopper', 0.24, { views: [1, 6], addProb: 0.12, buyProb: 0.05, gifter: 0.04, lineBias: null, priceBias: 'any' }],
  ['loyal_repeat', 0.11, { views: [3, 10], addProb: 0.5, buyProb: 0.45, gifter: 0.12, lineBias: null, priceBias: 'core_elevated' }],
  ['gifter', 0.09, { views: [2, 9], addProb: 0.4, buyProb: 0.38, gifter: 0.85, lineBias: null, priceBias: 'gift' }],
  ['luxe_collector', 0.06, { views: [3, 11], addProb: 0.45, buyProb: 0.4, gifter: 0.1, lineBias: null, priceBias: 'luxe' }],
  ['accessory_addon', 0.08, { views: [2, 7], addProb: 0.35, buyProb: 0.3, gifter: 0.2, lineBias: 'Essential', priceBias: 'entry' }],
  ['email_reengaged', 0.07, { views: [1, 5], addProb: 0.22, buyProb: 0.12, gifter: 0.05, lineBias: null, priceBias: 'any' }],
  ['lapsed_returning', 0.06, { views: [1, 4], addProb: 0.18, buyProb: 0.1, gifter: 0.06, lineBias: null, priceBias: 'any' }],
];

function pickPersona() {
  return weightedPick(PERSONAS.map(([k, w]) => [k, w]));
}
function personaCfg(key) {
  return PERSONAS.find(([k]) => k === key)[2];
}

// Choose a product for a customer given persona price/line bias.
function pickProductFor(cfg) {
  // Line bias: with prob 0.6 stay in the biased line if it exists
  if (cfg.lineBias && byLine[cfg.lineBias] && chance(0.6)) {
    return weightedPick(byLine[cfg.lineBias].map((p) => [p, productPopularity(p)]));
  }
  // Price bias filter
  let pool = PRODUCT_WEIGHTS;
  if (cfg.priceBias === 'entry') pool = PRODUCT_WEIGHTS.filter(([p]) => p.price_usd < 200);
  else if (cfg.priceBias === 'core') pool = PRODUCT_WEIGHTS.filter(([p]) => p.price_usd >= 150 && p.price_usd < 450);
  else if (cfg.priceBias === 'core_elevated') pool = PRODUCT_WEIGHTS.filter(([p]) => p.price_usd >= 250 && p.price_usd < 650);
  else if (cfg.priceBias === 'elevated') pool = PRODUCT_WEIGHTS.filter(([p]) => p.price_usd >= 400);
  else if (cfg.priceBias === 'luxe') pool = PRODUCT_WEIGHTS.filter(([p]) => p.price_usd >= 550);
  else if (cfg.priceBias === 'gift') pool = PRODUCT_WEIGHTS.filter(([p]) => p.occasion?.includes('gift') || p.category !== 'Handbags');
  if (!pool.length) pool = PRODUCT_WEIGHTS;
  return weightedPick(pool);
}

// --------------------------------------------------------------------------
// 5. EVENT MODEL (ODP event shape)
// --------------------------------------------------------------------------
// ODP events: type, action, identifiers (vuid/customer), data fields.
// We emit: page_view, product_view, add_to_cart, purchase, email_open.
// Funnel: page_view -> product_view(s) -> add_to_cart -> purchase, with
// realistic drop-off controlled by persona probabilities.

let EVENT_SEQ = 0;
function nextEventId() {
  EVENT_SEQ += 1;
  return `evt_${pad(EVENT_SEQ, 8)}`;
}

// Build one event record (ODP-shaped).
function makeEvent({ type, action, ts, customer, product, extra }) {
  const ev = {
    event_id: nextEventId(),
    // ODP "type" is the event collection / namespace; "action" the verb.
    type,
    action,
    timestamp: ts,             // epoch ms (UTC); derive ISO downstream if needed
    // ODP identifiers carried on every event:
    identifiers: {
      vuid: customer.identifiers.vuid,
      // signed-in events also carry the customer id / email; anon ones don't
      ...(customer._signedInAtMs && ts >= customer._signedInAtMs
        ? { customer_id: customer.identifiers.customer_id, email: customer.identifiers.email }
        : {}),
    },
    session_id: extra?.session_id,
    data: {},
  };
  if (product) {
    ev.data.product_id = product.id;
    ev.data.product_name = product.name;
    ev.data.line = product.line;
    ev.data.category = product.category;
    ev.data.subcategory = product.subcategory;
    ev.data.price_usd = product.price_usd;
    ev.data.price_band = priceBand(product.price_usd);
    ev.data.currency = 'USD';
  }
  if (extra) Object.assign(ev.data, extra.data || {});
  return ev;
}

// --------------------------------------------------------------------------
// 6. GENERATE CUSTOMERS + THEIR EVENTS
// --------------------------------------------------------------------------
const customers = [];
const events = [];

// Engagement rank buckets (ODP insight-style static field).
const ENGAGEMENT_RANKS = ['low', 'medium', 'high', 'vip'];

function buildCustomer(i) {
  const persona = pickPersona();
  const cfg = personaCfg(persona);

  // Geography (NA: ~88% US, 12% CA)
  const isUS = chance(0.88);
  const geo = isUS
    ? weightedPick(US_STATES.map(([s, c, w]) => [{ country: 'US', region: s, city: c }, w]))
    : weightedPick(CA_PROV.map(([s, c, w]) => [{ country: 'CA', region: s, city: c }, w]));

  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  const emailDomain = weightedPick(EMAIL_DOMAINS);
  const num = randInt(1, 999);
  const email = `${first}.${last}${num}@${emailDomain}`.toLowerCase();

  const customerId = `coach_cust_${pad(100000 + i, 7)}`;
  const vuid = deterministicVuid(i);

  // Identity state: a share of profiles are anonymous-only (no email/customer_id
  // resolved) — important for the "anonymous shopper" hero moment.
  const isKnown = chance(0.66); // 66% known (have email/customer id), 34% anon-only

  // First/last seen within the window.
  const firstSeenOffset = randInt(0, WINDOW_DAYS - 1);
  const firstSeen = WINDOW_START + firstSeenOffset * DAY + randInt(0, DAY - 1);
  const lastSeen = Math.min(EPOCH_NOW, firstSeen + randInt(0, (WINDOW_DAYS - firstSeenOffset) * DAY));

  // Lifetime / loyalty (static ODP-style attributes)
  const sessionCount = persona === 'loyal_repeat' ? randInt(4, 22)
    : persona === 'window_shopper' ? randInt(1, 3)
      : randInt(1, 8);
  const lifetimeOrders = persona === 'loyal_repeat' ? randInt(2, 9)
    : persona === 'luxe_collector' ? randInt(1, 6)
      : weightedPick([[0, 0.6], [1, 0.25], [2, 0.1], [3, 0.05]]);
  const aov = cfg.priceBias === 'luxe' ? randInt(450, 780)
    : cfg.priceBias === 'core_elevated' ? randInt(280, 560)
      : cfg.priceBias === 'entry' ? randInt(80, 220)
        : randInt(150, 480);
  const lifetimeValue = lifetimeOrders * aov;

  const loyaltyTier = lifetimeValue > 2500 ? 'platinum'
    : lifetimeValue > 1200 ? 'gold'
      : lifetimeValue > 400 ? 'silver'
        : 'member';

  // ----- Generate this customer's SESSIONS & EVENTS (the funnel) -----
  const nSessions = Math.max(1, Math.min(sessionCount, persona === 'loyal_repeat' ? 5 : 3));
  let totalProductViews = 0, totalAddToCart = 0, totalPurchases = 0, totalEmailOpens = 0, totalPageViews = 0;
  const viewedLineCounts = {};
  const viewedPriceBands = {};
  const viewedProductIds = new Set();
  const addedProductIds = new Set();
  const purchasedProductIds = new Set();
  let lastViewedLine = null;
  let categoryDwellMs = 0;
  let revenueUsd = 0;
  // Per-session current-state snapshot (the realtime engine works on the
  // LIVE session, so the qualification attributes reflect the LAST session,
  // not lifetime totals). Cart abandonment is a cross-session persisted flag.
  let lastSessionViews = 0;
  let lastSessionCartAdds = 0;
  let lastSessionPurchases = 0;
  let lastSessionDwellMs = 0;
  let lastSessionLine = null;
  let lastSessionPriceBands = {};
  let cartAbandoned = false;       // added to cart in a PRIOR session, never bought
  let sessionsSinceCart = 0;

  // signed-in moment (for known customers): some point after firstSeen
  const signedInAtMs = isKnown ? firstSeen + randInt(0, Math.max(1, lastSeen - firstSeen)) : null;

  for (let s = 0; s < nSessions; s++) {
    const sessionId = `sess_${pad(i, 6)}_${s}`;
    // session start time within [firstSeen, lastSeen], seasonal weighting
    const dayOffset = randInt(firstSeenOffset, WINDOW_DAYS - 1);
    const seasonW = seasonalWeight(dayOffset);
    let ts = WINDOW_START + dayOffset * DAY + randInt(8 * 3600 * 1000, 23 * 3600 * 1000); // daytime-ish

    const device = weightedPick(DEVICES);
    const channel = weightedPick(CHANNELS);

    // Carry forward cart abandonment from any prior session that added but
    // never purchased; reset the per-session snapshot for this new session.
    if (s > 0 && lastSessionCartAdds > 0 && lastSessionPurchases === 0) {
      cartAbandoned = true;
      sessionsSinceCart += 1;
    }
    lastSessionViews = 0; lastSessionCartAdds = 0; lastSessionPurchases = 0;
    lastSessionDwellMs = 0; lastSessionLine = null; lastSessionPriceBands = {};

    // A realistic share of sessions are shallow "bounces" (land, glance, leave)
    // — these keep the early-journey / cold-start audience meaningfully sized.
    const isBounce = chance(persona === 'window_shopper' ? 0.45 : persona === 'lapsed_returning' ? 0.5 : 0.18);

    // page_view (landing)
    events.push(makeEvent({
      type: 'pageview', action: 'page_view', ts, customer: { identifiers: { vuid, customer_id: customerId, email }, _signedInAtMs: signedInAtMs },
      product: null,
      extra: { session_id: sessionId, data: { page_type: 'home', device, channel, url: 'https://www.coach.com/' } },
    }));
    totalPageViews++;
    ts += randInt(2000, 30000);

    // number of product views this session (seasonal + persona)
    let nViews = Math.round(randInt(cfg.views[0], cfg.views[1]) * (0.6 + 0.7 * seasonW) / 1.3);
    nViews = Math.max(0, Math.min(nViews, 24));
    if (isBounce) nViews = weightedPick([[0, 0.35], [1, 0.5], [2, 0.15]]); // shallow landing

    let sessionAdded = false;
    for (let v = 0; v < nViews; v++) {
      const product = pickProductFor(cfg);
      // category PLP page_view sometimes precedes a PDP
      if (chance(0.4)) {
        events.push(makeEvent({
          type: 'pageview', action: 'page_view', ts, customer: { identifiers: { vuid, customer_id: customerId, email }, _signedInAtMs: signedInAtMs },
          product: null,
          extra: { session_id: sessionId, data: { page_type: 'category', category: product.category, line: product.line, device, channel } },
        }));
        totalPageViews++;
        ts += randInt(1500, 12000);
      }
      const dwell = randInt(3000, 90000);
      categoryDwellMs += dwell;
      lastSessionDwellMs += dwell;
      events.push(makeEvent({
        type: 'product', action: 'product_view', ts, customer: { identifiers: { vuid, customer_id: customerId, email }, _signedInAtMs: signedInAtMs },
        product,
        extra: { session_id: sessionId, data: { dwell_ms: dwell, device, channel, page_type: 'pdp' } },
      }));
      totalProductViews++;
      lastSessionViews++;
      viewedProductIds.add(product.id);
      viewedLineCounts[product.line] = (viewedLineCounts[product.line] || 0) + 1;
      const pb = priceBand(product.price_usd);
      viewedPriceBands[pb] = (viewedPriceBands[pb] || 0) + 1;
      lastSessionPriceBands[pb] = (lastSessionPriceBands[pb] || 0) + 1;
      lastViewedLine = product.line;
      lastSessionLine = product.line;
      ts += dwell + randInt(1000, 20000);

      // add_to_cart (funnel step)
      if (chance(cfg.addProb)) {
        const qty = chance(0.85) ? 1 : 2;
        events.push(makeEvent({
          type: 'cart', action: 'add_to_cart', ts, customer: { identifiers: { vuid, customer_id: customerId, email }, _signedInAtMs: signedInAtMs },
          product,
          extra: { session_id: sessionId, data: { quantity: qty, cart_value_usd: product.price_usd * qty, device } },
        }));
        totalAddToCart++;
        lastSessionCartAdds++;
        addedProductIds.add(product.id);
        sessionAdded = true;
        cartAbandoned = false;       // active cart this session clears prior abandonment
        sessionsSinceCart = 0;
        ts += randInt(2000, 40000);

        // purchase (final funnel step), gated on having added
        if (chance(cfg.buyProb)) {
          const orderId = `ord_${pad(i, 6)}_${s}_${v}`;
          const lineItems = [{ product_id: product.id, line: product.line, qty, price_usd: product.price_usd }];
          // gifters / loyal sometimes add a complete-the-look accessory to the order
          let orderTotal = product.price_usd * qty;
          if (chance(cfg.gifter * 0.6 + 0.1)) {
            const addon = completeTheLook(product.line)[0];
            if (addon) {
              lineItems.push({ product_id: addon.id, line: addon.line, qty: 1, price_usd: addon.price_usd });
              orderTotal += addon.price_usd;
              purchasedProductIds.add(addon.id);
            }
          }
          events.push(makeEvent({
            type: 'order', action: 'purchase', ts, customer: { identifiers: { vuid, customer_id: customerId, email }, _signedInAtMs: signedInAtMs },
            product,
            extra: {
              session_id: sessionId,
              data: {
                order_id: orderId,
                order_total_usd: orderTotal,
                currency: 'USD',
                item_count: lineItems.reduce((s2, li) => s2 + li.qty, 0),
                line_items: lineItems,
                is_gift: chance(cfg.gifter),
                device,
              },
            },
          }));
          totalPurchases++;
          lastSessionPurchases++;
          purchasedProductIds.add(product.id);
          revenueUsd += orderTotal;
          cartAbandoned = false;
          ts += randInt(5000, 60000);
        }
      }
    }

    // email_open events (decoupled from browse; email persona heavier)
    const emailLambda = persona === 'email_reengaged' ? 3 : persona === 'loyal_repeat' ? 2 : 1;
    const nEmails = Math.max(0, Math.round((rand() + rand()) / 2 * emailLambda * 1.5));
    for (let e = 0; e < nEmails; e++) {
      const ets = WINDOW_START + randInt(firstSeenOffset, WINDOW_DAYS - 1) * DAY + randInt(0, DAY - 1);
      events.push(makeEvent({
        type: 'email', action: 'email_open', ts: ets, customer: { identifiers: { vuid, customer_id: customerId, email }, _signedInAtMs: signedInAtMs },
        product: null,
        extra: { session_id: sessionId, data: { campaign_id: `camp_${pad(randInt(1, 24), 3)}`, campaign_name: pick(['Summer Edit', 'New Tabby Colors', 'Members Only', 'Complete the Look', 'Back in Stock', 'Gift Guide']) } },
      }));
      totalEmailOpens++;
    }
  }

  // Finalize cross-session abandonment: if the LAST session added to cart but
  // never purchased, that cart is currently abandoned too.
  if (lastSessionCartAdds > 0 && lastSessionPurchases === 0) {
    cartAbandoned = true;
  }

  // ----- Derive the REAL-TIME ENGINE ATTRIBUTES (connector spec §2.2) -----
  // These names match exactly what the mock SegmentProvider qualifies against
  // and what JourneyStage.deriveStage / DecisionProvider read. The realtime
  // signals reflect the CURRENT (last) session — that is what a live edge
  // engine sees — while lifetime fields below use all-time totals.
  const viewed_product_line = lastSessionLine
    || Object.entries(viewedLineCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const dominantPriceBand = Object.entries(lastSessionPriceBands).sort((a, b) => b[1] - a[1])[0]?.[0]
    || Object.entries(viewedPriceBands).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // journey_stage: early/mid/late from THIS session's funnel depth
  // (mirrors JourneyStage.deriveStage intent).
  let journey_stage = 'early';
  if (lastSessionPurchases > 0 || lastSessionCartAdds > 0) journey_stage = 'late';
  else if (lastSessionViews >= 5 || lastSessionDwellMs > 120000) journey_stage = 'mid';
  else if (lastSessionViews >= 2) journey_stage = 'mid';

  // ODP INSIGHT-style static fields (synthetic predictive scores).
  // order_likelihood: 0..1, correlated with funnel behaviour + persona.
  let order_likelihood = 0.05
    + Math.min(0.45, lastSessionViews * 0.03)
    + (lastSessionCartAdds > 0 ? 0.25 : 0)
    + (cartAbandoned ? 0.1 : 0)
    + (lifetimeOrders > 0 ? 0.12 : 0)
    + (persona === 'loyal_repeat' || persona === 'luxe_collector' ? 0.1 : 0);
  order_likelihood = Math.max(0.01, Math.min(0.98, +(order_likelihood + (rand() - 0.5) * 0.06).toFixed(3)));

  // engagement_rank: bucketed ODP insight
  const engScoreRaw = totalProductViews * 2 + totalAddToCart * 8 + totalPurchases * 20 + totalEmailOpens * 3 + sessionCount * 2;
  const engagement_rank = engScoreRaw > 70 ? 'vip' : engScoreRaw > 35 ? 'high' : engScoreRaw > 12 ? 'medium' : 'low';

  // churn_risk_score: higher for lapsed/low engagement (ODP insight-style)
  let churn_risk_score = 0.5 - Math.min(0.4, engScoreRaw * 0.004) + (persona === 'lapsed_returning' ? 0.3 : 0);
  churn_risk_score = Math.max(0.02, Math.min(0.97, +(churn_risk_score + (rand() - 0.5) * 0.08).toFixed(3)));

  // predicted_ltv (ODP insight-style)
  const predicted_ltv = Math.round(lifetimeValue * (1 + order_likelihood) + order_likelihood * aov * 3);

  const isGifter = chance(cfg.gifter);

  const customer = {
    // ----- ODP IDENTIFIERS (identity graph) -----
    identifiers: {
      vuid,                                   // ODP visitor id (anonymous device id)
      customer_id: isKnown ? customerId : null, // ODP customer id (resolved on sign-in)
      email: isKnown ? email : null,            // ODP email identifier
      fs_user_id: isKnown ? `fs_${pad(i, 7)}` : null, // fullstory-style cross id (optional)
    },
    // ----- ODP PROFILE ATTRIBUTES (snake_case, the ODP convention) -----
    attributes: {
      // demographic / geo
      first_name: isKnown ? first : null,
      last_name: isKnown ? last : null,
      country: geo.country,
      region: geo.region,
      city: geo.city,
      locale: geo.country === 'US' ? 'en-US' : 'en-CA',
      timezone: geo.country === 'US' ? 'America/New_York' : 'America/Toronto',
      preferred_device: weightedPick(DEVICES),
      acquisition_channel: weightedPick(CHANNELS),
      // marketing
      email_subscriber: isKnown ? chance(0.7) : false,
      sms_subscriber: isKnown ? chance(0.35) : false,
      loyalty_member: isKnown ? chance(0.55) : false,
      loyalty_tier: isKnown ? loyaltyTier : null,
      // lifetime (static aggregates ODP would hold on the profile)
      first_seen_ts: firstSeen,
      last_seen_ts: lastSeen,
      session_count: sessionCount,
      lifetime_orders: lifetimeOrders,
      lifetime_value_usd: lifetimeValue,
      average_order_value_usd: aov,
      // taste / affinity (derived, ODP-friendly)
      favorite_line: viewed_product_line || (cfg.lineBias ?? pick(HANDBAG_LINES)),
      preferred_category: pick(Object.keys(byCategory)),
      preferred_price_band: dominantPriceBand || 'core',
      gifter: isGifter,
      persona,                                // synthetic label (handy for the demo, not a real ODP field)
      // ----- REAL-TIME SESSION SIGNALS (engine attributes; connector spec §2.2) -----
      // These are the attributes the MOCK SegmentProvider evaluates audience
      // condition-trees against. They reflect the customer's CURRENT (last)
      // session snapshot — exactly what the live edge engine would present —
      // so the mock can qualify immediately on load.
      viewed_product_line,
      product_views: lastSessionViews,
      page_views: totalPageViews,
      category_dwell_ms: lastSessionDwellMs,
      cart_adds: lastSessionCartAdds,
      wishlist_adds: weightedPick([[0, 0.7], [1, 0.2], [2, 0.07], [3, 0.03]]),
      purchases: lastSessionPurchases,
      email_opens: totalEmailOpens,
      price_band_viewed: dominantPriceBand || 'core',
      journey_stage,
      cart_abandoned: cartAbandoned,          // cart left without purchase (this or prior session)
      sessions_since_cart: sessionsSinceCart, // recency of the abandoned cart
      // lifetime browse totals (kept distinct from the live-session signals)
      lifetime_product_views: totalProductViews,
      lifetime_cart_adds: totalAddToCart,
      lifetime_purchases: totalPurchases,
      // ----- ODP INSIGHT-STYLE STATIC PREDICTIONS -----
      order_likelihood,
      engagement_rank,
      churn_risk_score,
      predicted_ltv_usd: predicted_ltv,
    },
    // ----- segments the profile already carries (ODP would return these) -----
    segments: [],
    // ----- denormalised per-customer rollup (handy for insights & QA) -----
    _rollup: {
      viewed_product_ids: [...viewedProductIds],
      added_product_ids: [...addedProductIds],
      purchased_product_ids: [...purchasedProductIds],
      viewed_line_counts: viewedLineCounts,
      revenue_usd: revenueUsd,
      is_known: isKnown,
    },
  };

  // Pre-attach the static ODP segment keys this profile's CURRENT snapshot
  // qualifies for. These mirror the insight `conditions` 1:1 (the realtime
  // engine will recompute live; these are the persisted snapshot).
  const a = customer.attributes;
  const seg = customer.segments;
  if (a.journey_stage === 'early' && a.cart_adds === 0) seg.push('early_journey_cold_start');
  if (a.viewed_product_line === 'Tabby' && a.product_views >= 3 && a.cart_adds === 0) seg.push('high_intent_tabby_browser');
  if (a.viewed_product_line === 'Brooklyn' && a.product_views >= 2) seg.push('brooklyn_browser');
  if (a.journey_stage === 'mid' && a.product_views >= 5) seg.push('mid_journey_considering');
  if (a.cart_adds >= 1 && a.purchases === 0) seg.push('late_journey_ready_to_buy');
  if (a.cart_abandoned === true && a.purchases === 0) seg.push('cart_abandoner');
  if (a.gifter === true && a.average_order_value_usd >= 300) seg.push('high_aov_gifter');
  if (['gold', 'platinum'].includes(a.loyalty_tier) && ['high', 'vip'].includes(a.engagement_rank)) seg.push('vip_loyalist');
  if (a.price_band_viewed === 'elevated' || a.average_order_value_usd >= 500) seg.push('luxe_affinity');
  if (a.churn_risk_score >= 0.6 && a.product_views >= 1) seg.push('lapsed_reengagement');

  return customer;
}

for (let i = 0; i < ARGS.customers; i++) {
  customers.push(buildCustomer(i));
}

// Sort events chronologically (deterministic — stable on event_id tiebreak).
events.sort((a, b) => a.timestamp - b.timestamp || a.event_id.localeCompare(b.event_id));

// --------------------------------------------------------------------------
// 7. PRE-AGGREGATED INSIGHT VIEWS  (what the Opal mock serves from)
// --------------------------------------------------------------------------
// Each insight is an ODP-shaped audience definition the MockAudienceAuthoring
// can return as a "suggested" audience, PLUS the pre-computed evidence
// (size, sample, top products) that makes the suggestion look data-grounded.
//
// The `conditions` use the SAME attribute names + ['and'|'or'|'not', ...]
// tree shape that src/connectors/types.ts -> AudienceCondition defines and
// that MockSegmentProvider.evaluateCondition runs. So an Opal-suggested
// audience drops straight into the AudienceStore and qualifies live.

function customerMatches(c, predFn) {
  return predFn(c.attributes, c._rollup, c);
}

function topProductsForMatches(matchedCustomers, n = 8) {
  const counts = {};
  for (const c of matchedCustomers) {
    for (const pid of c._rollup.viewed_product_ids) counts[pid] = (counts[pid] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([product_id, views]) => {
      const p = PRODUCTS.find((x) => x.id === product_id);
      return { product_id, name: p?.name, line: p?.line, price_usd: p?.price_usd, viewers: views };
    });
}

// Definition list: human prompt + ODP condition tree + a JS predicate mirror
// (the predicate is ONLY used here to compute the evidence; at runtime the
// connector evaluates the `conditions` tree itself).
const INSIGHT_DEFS = [
  {
    key: 'high_intent_tabby_browser',
    name: 'High-Intent Tabby Browsers (no add-to-cart)',
    description: 'Shoppers viewing Tabby 3+ times this session who have not added to cart — the hero "complete the look" target.',
    nlPrompt: 'high-intent Tabby browsers who haven\'t added to cart',
    evaluation: 'realtime',
    recommended_module: 'complete_the_look',
    anchor_line: 'Tabby',
    conditions: ['and',
      { attribute: 'viewed_product_line', operator: 'eq', value: 'Tabby' },
      { attribute: 'product_views', operator: 'gte', value: 3 },
      { attribute: 'cart_adds', operator: 'eq', value: 0 },
    ],
    predicate: (a) => a.viewed_product_line === 'Tabby' && a.product_views >= 3 && a.cart_adds === 0,
  },
  {
    key: 'early_journey_cold_start',
    name: 'Early-Journey Cold-Start Shoppers',
    description: 'Anonymous or shallow sessions (few views, no cart) — bootstrap with curated/trending merchandising.',
    nlPrompt: 'brand-new anonymous shoppers just landing',
    evaluation: 'realtime',
    recommended_module: 'curated_grid',
    conditions: ['and',
      { attribute: 'journey_stage', operator: 'eq', value: 'early' },
      { attribute: 'cart_adds', operator: 'eq', value: 0 },
    ],
    predicate: (a) => a.journey_stage === 'early' && a.cart_adds === 0,
  },
  {
    key: 'mid_journey_considering',
    name: 'Mid-Journey Considerers',
    description: 'Engaged browsers (5+ views or deep dwell) weighing options — show social proof + complete-the-look.',
    nlPrompt: 'shoppers actively comparing products mid-journey',
    evaluation: 'realtime',
    recommended_module: 'social_proof',
    conditions: ['and',
      { attribute: 'journey_stage', operator: 'eq', value: 'mid' },
      { attribute: 'product_views', operator: 'gte', value: 5 },
    ],
    predicate: (a) => a.journey_stage === 'mid' && a.product_views >= 5,
  },
  {
    key: 'late_journey_ready_to_buy',
    name: 'Late-Journey Ready-to-Buy (active cart)',
    description: 'Items added in the CURRENT session, not yet purchased — reassure with shipping/returns + checkout nudge.',
    nlPrompt: 'shoppers with items in their cart right now who are close to buying',
    evaluation: 'realtime',
    recommended_module: 'checkout_nudge',
    conditions: ['and',
      { attribute: 'cart_adds', operator: 'gte', value: 1 },
      { attribute: 'purchases', operator: 'eq', value: 0 },
    ],
    predicate: (a) => a.cart_adds >= 1 && a.purchases === 0,
  },
  {
    key: 'cart_abandoner',
    name: 'Cart Abandoners (returning)',
    description: 'Added to cart in a prior/this session and left without buying — retarget with the abandoned line + urgency. Distinct from active-cart shoppers.',
    nlPrompt: 'people who added to cart but abandoned without buying',
    evaluation: 'realtime',
    recommended_module: 'cart_recovery',
    conditions: ['and',
      { attribute: 'cart_abandoned', operator: 'eq', value: true },
      { attribute: 'purchases', operator: 'eq', value: 0 },
    ],
    predicate: (a) => a.cart_abandoned === true && a.purchases === 0,
  },
  {
    key: 'high_aov_gifter',
    name: 'High-AOV Gifters',
    description: 'Gift-oriented shoppers with elevated order value — surface gift sets, charms, and gift wrap.',
    nlPrompt: 'high-AOV gifters shopping for presents',
    evaluation: 'realtime',
    recommended_module: 'gift_edit',
    conditions: ['and',
      { attribute: 'gifter', operator: 'eq', value: true },
      { attribute: 'average_order_value_usd', operator: 'gte', value: 300 },
    ],
    predicate: (a) => a.gifter === true && a.average_order_value_usd >= 300,
  },
  {
    key: 'luxe_affinity',
    name: 'Luxe / Elevated-Price Affinity',
    description: 'Shoppers browsing the elevated price band or with high AOV — promote Rogue, crystal Tabby, premium leathers.',
    nlPrompt: 'customers who love our most premium pieces',
    evaluation: 'realtime',
    recommended_module: 'premium_hero',
    conditions: ['or',
      { attribute: 'price_band_viewed', operator: 'eq', value: 'elevated' },
      { attribute: 'average_order_value_usd', operator: 'gte', value: 500 },
    ],
    predicate: (a) => a.price_band_viewed === 'elevated' || a.average_order_value_usd >= 500,
  },
  {
    key: 'vip_loyalist',
    name: 'VIP Loyalists',
    description: 'Gold/Platinum loyalty with high engagement — early access + concierge messaging.',
    nlPrompt: 'our most loyal VIP customers',
    evaluation: 'realtime',
    recommended_module: 'vip_early_access',
    conditions: ['and',
      { attribute: 'loyalty_tier', operator: 'in', value: ['gold', 'platinum'] },
      { attribute: 'engagement_rank', operator: 'in', value: ['high', 'vip'] },
    ],
    predicate: (a) => ['gold', 'platinum'].includes(a.loyalty_tier) && ['high', 'vip'].includes(a.engagement_rank),
  },
  {
    key: 'brooklyn_browser',
    name: 'Brooklyn Line Affinity',
    description: 'Shoppers gravitating to the Brooklyn line — workhorse leather; pair with straps and totes.',
    nlPrompt: 'shoppers interested in the Brooklyn collection',
    evaluation: 'realtime',
    recommended_module: 'line_spotlight',
    anchor_line: 'Brooklyn',
    conditions: ['and',
      { attribute: 'viewed_product_line', operator: 'eq', value: 'Brooklyn' },
      { attribute: 'product_views', operator: 'gte', value: 2 },
    ],
    predicate: (a) => a.viewed_product_line === 'Brooklyn' && a.product_views >= 2,
  },
  {
    key: 'lapsed_reengagement',
    name: 'Lapsed but Re-Engaging',
    description: 'High churn-risk profiles showing fresh activity — win-back offer + bestsellers.',
    nlPrompt: 'lapsed customers who just came back',
    evaluation: 'realtime',
    recommended_module: 'winback_offer',
    conditions: ['and',
      { attribute: 'churn_risk_score', operator: 'gte', value: 0.6 },
      { attribute: 'product_views', operator: 'gte', value: 1 },
    ],
    predicate: (a) => a.churn_risk_score >= 0.6 && a.product_views >= 1,
  },
];

const insightViews = INSIGHT_DEFS.map((def) => {
  const matched = customers.filter((c) => customerMatches(c, def.predicate));
  const size = matched.length;
  const sizePct = +((size / customers.length) * 100).toFixed(1);
  // aggregate stats
  const avgViews = size ? +(matched.reduce((s, c) => s + c.attributes.product_views, 0) / size).toFixed(1) : 0;
  const avgOrderLikelihood = size ? +(matched.reduce((s, c) => s + c.attributes.order_likelihood, 0) / size).toFixed(3) : 0;
  const avgAov = size ? Math.round(matched.reduce((s, c) => s + (c.attributes.average_order_value_usd || 0), 0) / size) : 0;
  const knownPct = size ? +((matched.filter((c) => c._rollup.is_known).length / size) * 100).toFixed(1) : 0;
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    nl_prompt: def.nlPrompt,
    evaluation: def.evaluation,
    recommended_module: def.recommended_module,
    anchor_line: def.anchor_line ?? null,
    // ODP-shaped condition tree (AudienceCondition) — runtime-evaluable
    conditions: def.conditions,
    // pre-aggregated EVIDENCE for the Opal review card
    stats: {
      audience_size: size,
      audience_pct_of_base: sizePct,
      avg_product_views: avgViews,
      avg_order_likelihood: avgOrderLikelihood,
      avg_order_value_usd: avgAov,
      known_identity_pct: knownPct,
    },
    top_products: topProductsForMatches(matched, 8),
    complete_the_look: def.anchor_line ? completeTheLook(def.anchor_line).map((p) => ({ product_id: p.id, name: p.name, price_usd: p.price_usd })) : [],
    sample_vuids: matched.slice(0, 5).map((c) => c.identifiers.vuid),
  };
});

// --------------------------------------------------------------------------
// 8. GLOBAL AGGREGATES (catalog/funnel summaries for dashboards & QA)
// --------------------------------------------------------------------------
const eventCountsByAction = {};
for (const e of events) eventCountsByAction[e.action] = (eventCountsByAction[e.action] || 0) + 1;

const viewsByLine = {};
const viewsByPriceBand = {};
const productViewCounts = {};
let totalRevenue = 0;
for (const e of events) {
  if (e.action === 'product_view') {
    viewsByLine[e.data.line] = (viewsByLine[e.data.line] || 0) + 1;
    viewsByPriceBand[e.data.price_band] = (viewsByPriceBand[e.data.price_band] || 0) + 1;
    productViewCounts[e.data.product_id] = (productViewCounts[e.data.product_id] || 0) + 1;
  }
  if (e.action === 'purchase') totalRevenue += e.data.order_total_usd || 0;
}
const topProducts = Object.entries(productViewCounts)
  .sort((a, b) => b[1] - a[1]).slice(0, 15)
  .map(([product_id, views]) => {
    const p = PRODUCTS.find((x) => x.id === product_id);
    return { product_id, name: p?.name, line: p?.line, price_usd: p?.price_usd, views };
  });

// Funnel (views -> adds -> purchases) global drop-off
const funnel = {
  page_view: eventCountsByAction.page_view || 0,
  product_view: eventCountsByAction.product_view || 0,
  add_to_cart: eventCountsByAction.add_to_cart || 0,
  purchase: eventCountsByAction.purchase || 0,
};
funnel.view_to_cart_rate = funnel.product_view ? +((funnel.add_to_cart / funnel.product_view) * 100).toFixed(1) : 0;
funnel.cart_to_purchase_rate = funnel.add_to_cart ? +((funnel.purchase / funnel.add_to_cart) * 100).toFixed(1) : 0;

// Daily event volume (seasonality curve, for charts)
const dailyVolume = {};
for (const e of events) {
  const d = new Date(e.timestamp).toISOString().slice(0, 10);
  dailyVolume[d] = (dailyVolume[d] || 0) + 1;
}

// --------------------------------------------------------------------------
// 9. WRITE OUTPUTS
// --------------------------------------------------------------------------
const OUT_DIR = resolve(REPO_ROOT, ARGS.out);
mkdirSync(OUT_DIR, { recursive: true });

const meta = {
  generated_for: 'Tapestry/Coach real-time personalization demo (synthetic ODP-schema data)',
  brand: 'Coach',
  parent_company: 'Tapestry, Inc.',
  region: 'North America',
  currency: 'USD',
  schema: 'optimizely_odp',
  seed: ARGS.seed,
  generator: 'scripts/generate-synthetic-data.mjs',
  generator_version: '1.0.0',
  epoch_now_iso: new Date(EPOCH_NOW).toISOString(),
  window_days: WINDOW_DAYS,
  catalog_source: 'data/coach-catalog.json',
  catalog_product_count: PRODUCTS.length,
  note: 'REAL SEAMS, MOCKED CALLS — synthetic data shaped to ODP. No live external dependency. Product IDs are real Coach catalog IDs.',
};

const customersDoc = {
  _meta: { ...meta, record_type: 'odp_customer_profiles', count: customers.length },
  customers,
};
const eventsDoc = {
  _meta: {
    ...meta, record_type: 'odp_events', count: events.length,
    event_actions: Object.keys(eventCountsByAction).sort(),
    event_counts_by_action: eventCountsByAction,
  },
  events,
};
const insightsDoc = {
  _meta: { ...meta, record_type: 'odp_insight_views', count: insightViews.length, consumed_by: 'MockAudienceAuthoring.suggestAudiences (Opal mock) + MockSegmentProvider' },
  // global context for dashboards & the operator console
  aggregates: {
    total_customers: customers.length,
    total_events: events.length,
    event_counts_by_action: eventCountsByAction,
    funnel,
    total_revenue_usd: totalRevenue,
    views_by_line: viewsByLine,
    views_by_price_band: viewsByPriceBand,
    top_products: topProducts,
    daily_event_volume: dailyVolume,
  },
  // the pre-aggregated audiences the Opal mock serves
  insights: insightViews,
};

// customers.json + insights.json are pretty-printed (human-readable, small).
// events.json is the high-volume file (tens of thousands of records) so it is
// written MINIFIED to keep the asset small enough to load in a Worker.
writeFileSync(join(OUT_DIR, 'customers.json'), JSON.stringify(customersDoc, null, 2));
writeFileSync(join(OUT_DIR, 'events.json'), JSON.stringify(eventsDoc));
writeFileSync(join(OUT_DIR, 'insights.json'), JSON.stringify(insightsDoc, null, 2));

// --------------------------------------------------------------------------
// 10. CONSOLE SUMMARY (the return value the build swarm reads)
// --------------------------------------------------------------------------
const knownCount = customers.filter((c) => c._rollup.is_known).length;
console.log('='.repeat(70));
console.log('SYNTHETIC ODP-SCHEMA DATA GENERATED');
console.log('='.repeat(70));
console.log(`seed                 : ${ARGS.seed}`);
console.log(`out dir              : ${OUT_DIR}`);
console.log(`customers            : ${customers.length}  (known ${knownCount}, anon-only ${customers.length - knownCount})`);
console.log(`events               : ${events.length}`);
console.log('event counts         :', JSON.stringify(eventCountsByAction));
console.log(`funnel view->cart    : ${funnel.view_to_cart_rate}%   cart->purchase: ${funnel.cart_to_purchase_rate}%`);
console.log(`total revenue (USD)  : ${totalRevenue.toLocaleString()}`);
console.log('views by line        :', JSON.stringify(viewsByLine));
console.log('views by price band  :', JSON.stringify(viewsByPriceBand));
console.log('insight views        :', insightViews.length);
for (const iv of insightViews) {
  console.log(`  - ${iv.key.padEnd(28)} size=${String(iv.stats.audience_size).padStart(5)} (${iv.stats.audience_pct_of_base}%)  module=${iv.recommended_module}`);
}
console.log('='.repeat(70));
