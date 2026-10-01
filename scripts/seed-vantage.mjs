#!/usr/bin/env node
// scripts/seed-vantage.mjs — "Vantage": the carrier demo for Verizon, seeded.
//
// Vantage is a fictional carrier. The brand lives in BRAND below and nowhere
// else, so renaming it is one line. The phones are real (public/vantage/phones.json),
// the plan and promotion SHAPES are real (research-telco-buying.md, seen
// 2026-09-30), the names and prices of our plans are ours.
//
// This script is the only place the demo's world is defined. It publishes, to
// the `vantage` scope:
//
//   • the dimension registry   (PUT /config/reflex)   — eight dimensions
//   • the catalog              (PUT /content/catalog) — promotions, heroes,
//                                                       phone-page modules, plans
//   • the slots                (PUT /content/slots)   — hero, deals, pdp-modules,
//                                                       plan-pairing
//   • what the slots learn     (PUT /content/learn)   — holdout 0, γ 0, the
//                                                       regional prior ON
//
// and it writes, deterministically from the same definitions:
//
//   public/vantage/catalog.json      the display catalog the page paints cards
//                                    from (the snapshot answers ids; the grammar
//                                    of every offer is content, never decided)
//   public/vantage/beats/*.json      the opening documents, the fifteen beat
//                                    documents and anchor.json
//
// Every merchandiser beat is a real versioned publish through the real API,
// applied BY NAME by src/routes/vantage.ts from the worker's own copy of these
// files. That is why A RESEED MUST BE FOLLOWED BY A DEPLOY on a hosted worker:
// the seed re-anchors every window to now and rewrites the beat documents, and
// the worker reads them from its own ASSETS binding.
//
//   node scripts/seed-vantage.mjs [--base http://localhost:9110] [--token <jwt>] [--files-only]
//
// Local minting needs JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE and
// DEPLOYMENT_PROFILE=demo in the environment; a remote target needs --token.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9110')).replace(/\/+$/, '');
const scope = 'vantage';
const writeOnly = argv.includes('--files-only');

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

/** The carrier. One constant, referenced everywhere, so a rename is one line. */
const BRAND = { name: 'Vantage', tagline: 'See further.', rewards: 'Vantage Rewards', home: 'Vantage 5G Home' };

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const PHONES = read('../public/vantage/phones.json');
const PLANS = read('../public/vantage/plans.json');
const phone = (id) => {
  const found = PHONES.phones.find((p) => p.id === id);
  if (!found) throw new Error(`phones.json has no phone "${id}"`);
  return found;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The registry. Eight dimensions, each on one of the engine's existing
// shapes (research-telco-data.md §3; design §4), exact-value vocabularies, on
// the shipped K 1.8 and θ 0.60 / 0.45.
//
// MEMORY IS COMPRESSED FOR THE ROOM, on two speeds, and labelled so wherever it
// shows (the lead's ruling, 2026-09-30): brand and contentType forget in a
// minute (τ 60 s), priceBand, intent and perk in about ten (τ 10 min), and
// ecosystem, lines and category keep the shipped fourteen days. The exit beat
// is the fast brand-specific claim withdrawing while the slow ecosystem lean
// holds. Production runs days on every dimension (the shipped 14; price band
// 2.5× that), which is what the label says.
//
// Storage is not a dimension: it folds into the price band (a 512 GB step on a
// $899.99 phone is a $1,099.99 touch, and that crosses into premium). Plan tier
// is expressed through `perk` and the plan pieces' own tags. `lines` is moved by
// behaviour only and is never seeded from census household or family tables.
// ─────────────────────────────────────────────────────────────────────────────
const VOCABULARY = {
  category: ['phones', 'plans', 'home-internet', 'accessories', 'watches-tablets'],
  brand: ['apple', 'samsung', 'google', 'motorola'],
  ecosystem: ['ios', 'android'],
  priceBand: ['entry', 'core', 'premium'],
  intent: ['new', 'switch', 'upgrade', 'add-line', 'byod', 'home'],
  perk: ['streaming', 'music-games', 'hotspot-travel', 'international', 'family'],
  lines: ['solo', 'duo', 'family'],
  contentType: ['deal', 'compare', 'explainer', 'tool'],
};

/** The room's memory. The label is printed on the receipt and the panel beside every compressed dimension. */
const MEMORY = {
  label: 'memory compressed for this room; production runs days',
  fast: 60_000,
  medium: 10 * MINUTE,
  production: { default: '14 days (shipped)', priceBand: '35 days (shipped: 2.5× the global horizon)' },
};

const reflex = {
  version: 'reflex-vantage-v2-room-memory',
  dimensions: [
    { key: 'category', source: 'category' },
    { key: 'brand', source: 'brand', tauMs: MEMORY.fast },
    { key: 'ecosystem', source: 'ecosystem' },
    // On full retail, the research brief's cuts: entry under $400, core $400–899, premium $900+.
    { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [400, 900], labels: ['entry', 'core', 'premium'], tauMs: MEMORY.medium },
    { key: 'intent', source: 'intent', multi: true, tauMs: MEMORY.medium },
    { key: 'perk', source: 'perk', multi: true, tauMs: MEMORY.medium },
    { key: 'lines', source: 'lines' },
    { key: 'contentType', source: 'contentType', tauMs: MEMORY.fast },
  ],
  weights: {
    // The engine's compiled table (src/reflex/core.ts, DEFAULT_REFLEX_CONFIG.weights), verbatim…
    product_view: 1, pdp_view: 1, view_product: 1,
    wishlist: 2, wishlist_add: 2, add_to_wishlist: 2, save_for_later: 2,
    add_to_cart: 3, cart_add: 3,
    purchase: 5, checkout: 5, order_complete: 5,
    content_impression: 0, content_dwell: 0.5, content_click: 1, video_complete: 2,
    tick: 0,
    // …and the five actions it does not name, at the research table's weights
    // (view 1, search 1.5, a declared selector or compare 2, start order 3).
    // A selector or a tool arrives as `custom` with data.action set to its name.
    page_view: 1, search: 1.5, select: 2, filter: 2, compare: 2, start_order: 3,
  },
  tauMs: 14 * DAY,
  K: 1.8,
  thetaIn: 0.6,
  thetaOut: 0.45,
  epsilon: 0.01,
  maxValuesPerDim: 64,
  // We hold their offers, not their catalog: a phone view moves affinity through
  // the attributes the event carries, bounded to the registry's dimensions and
  // to the values this tenant's own published catalog names.
  eventAttributes: 'event-when-unknown',
  // The tenant's journey thresholds (W16 C4), published and versioned on this
  // document. A shopper is COMPARING (the engine's word: thinking) after six
  // phone pages in a visit and DECIDING at her first add to cart or purchase.
  // Only the hero slot reads the stage; the continue hero waits for it.
  journey: { stages: [
    { stage: 'thinking', anyOf: { product_views: 6 } },
    { stage: 'deciding', anyOf: { cart_adds: 1, purchases: 1 } },
  ] },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2 · The catalog. Four kinds of piece: promotions (deals), heroes (hero),
// phone-page modules (pdp-modules) and plans (plan-pairing).
//
// Windows are relative to the reset (`anchor`), in days: launch offers run about
// six to eight weeks from pre-order, switch offers for months, flash cuts days.
// Anchor = 2026-09-30 reads as the calendar: iPhone 18 Pro pre-order opened
// 12 Sep (−18 d), Pixel 11 pre-order 12 Aug (−49 d), iPhone Duo was announced
// 9 Sep (−21 d) and goes on sale 23 Oct (+23 d).
//
// `gate` is an eligibility rule on the request, never a preference: the buy-box
// toggle asserts `ctx.intent` (new | add-line | upgrade | byod; the page's
// default for a signed-out visitor is `new`) and a gated offer fails CLOSED
// when the request does not carry an admitted value. It never re-ranks.
// ─────────────────────────────────────────────────────────────────────────────
const NEW_LINE = ['new', 'add-line'];
const UPGRADE = ['upgrade'];
const SWITCHER = ['new', 'byod'];

/**
 * Where Vantage 5G Home is available. REPRESENTATIVE coverage for a fictional
 * network, by state, labelled so on screen; no real carrier's map.
 */
const HOME_COVERAGE = ['US-TX', 'US-NY', 'US-NJ', 'US-PA', 'US-MA', 'US-IL', 'US-FL', 'US-GA', 'US-NC', 'US-CA',
  'US-AZ', 'US-CO', 'US-WA', 'US-MI', 'US-OH', 'US-VA', 'US-MN', 'US-TN'];

/**
 * The two rehearsed regions and the uncovered contrast. Lane L4 owns the regional
 * lean behind them. The lead's ruling (2026-09-30): Acts 1 to 3 and the rest of
 * the demo run in New York, the first; Texas is only beat 2's asserted contrast.
 */
const REGIONS = {
  rehearsed: [
    { key: 'US-NY', label: 'New York', lean: 'iPhone, premium band (seeded, synthetic)', homeCovered: true },
    { key: 'US-TX', label: 'Texas', lean: 'Android, core band (seeded, synthetic)', homeCovered: true },
  ],
  uncovered: { key: 'US-MT', label: 'Montana', homeCovered: false },
  coverage: HOME_COVERAGE,
};

/** The paid-social ad the stranger taps (design §5). `campaign_term` seeds read utm_term. */
const LANDING = {
  url: '/vantage/?utm_source=tiktok&utm_medium=paid-social&utm_campaign=iphone-18-pro-launch&utm_term=iphone-18-pro',
  entry: { utmSource: 'tiktok', utmMedium: 'paid-social', utmTerm: 'iphone-18-pro' },
  campaignTerm: 'iphone-18-pro',
};

const PROMO_SLOTS = ['deals'];

/**
 * The promotion pool, in the site's own order. The FIRST FOUR are the site's
 * defaults: what the module shows with nothing known (catalog order is the
 * engine's zero-signal answer), what the default arm is served, and what a
 * visitor who declines personalization sees.
 *
 * Content fields (`grammar`, `badge`, `cta`) are the offer book: they are
 * published to catalog.json for the page, never to the engine, because the
 * engine decides which offer leads and nothing about what an offer is worth.
 *
 * Device and offer figures are the real ones seen on verizon.com on
 * 2026-09-30 (lane L3's realism table, docs/verizon/lanes/L3.md), on our plan
 * names: their top tier is our Unlimited Max and their middle tier our
 * Unlimited More. Two offers are real SHAPES rather than sightings and say so in
 * `seen`: the Galaxy S26 new-line offer and Black Friday. Plan prices are ours.
 */
const SEEN = 'verizon.com, 2026-09-30 (docs/verizon/lanes/L3.md)';
const PROMOTIONS = [
  {
    cid: 'promo-iphone-18-pro-launch', title: 'iPhone 18 Pro. Up to $1,200 off.',
    subtitle: 'With an eligible trade-in on a new line with Unlimited Max.', badge: 'trade-in', cta: 'Shop iPhone 18 Pro',
    tags: { category: ['phones'], brand: ['apple'], ecosystem: ['ios'], priceBand: ['premium'], intent: ['new'], contentType: ['deal'], campaign: [LANDING.campaignTerm] },
    gate: NEW_LINE, window: [-18, 31], merchandising: { promotion: 1 }, featured: ['iphone-18-pro', 'iphone-18-pro-max'],
    grammar: { who: 'A new line, or a line added to an account', plan: 'Unlimited Max', consideration: 'Trade in an eligible phone',
      value: 'Up to $1,200 in bill credits over 36 months ($33.33 a month)',
      ends: 'Credits stop if the line is cancelled, moves to a lower plan, or the phone is paid off early',
      combinable: false, endsOn: 'launch window', seen: SEEN },
    role: 'the launch promotion: the ad’s own offer, lifted by the campaign seed and carrying the promotion signal',
  },
  {
    cid: 'promo-galaxy-s26-new-line', title: 'Galaxy S26 on us with a new line.',
    subtitle: 'On Unlimited More or Max. No trade-in needed.', badge: 'new-line', cta: 'Shop Galaxy S26',
    tags: { category: ['phones'], brand: ['samsung'], ecosystem: ['android'], priceBand: ['core'], intent: ['new'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-60, 60], featured: ['galaxy-s26'],
    grammar: { who: 'A new line, or a line added to an account', plan: 'Unlimited More or Unlimited Max', consideration: 'None',
      value: '$899.99 in bill credits over 36 months ($24.99 a month)',
      ends: 'Credits stop if the line is cancelled, changes plan below Unlimited More, or the phone is paid off early', combinable: false,
      seen: 'a shape, not a sighting: the Galaxy S26+ was $0 on a new middle- or top-tier line in February 2026 (buying brief [33])' },
  },
  {
    cid: 'promo-four-lines', title: 'Four lines, $28 a line.',
    subtitle: 'Unlimited Go for the whole household, with AutoPay.', badge: 'new-line', cta: 'Build a family plan',
    tags: { category: ['plans'], intent: ['add-line', 'new'], lines: ['family'], perk: ['family'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-90, 180],
    grammar: { who: 'Four or more lines on one account', plan: 'Unlimited Go', consideration: 'AutoPay and paper-free billing',
      value: '$28 a line a month at four lines ($60 for one line)', ends: 'The per-line price rises if the account drops below four lines',
      combinable: true, seen: 'our plan price (plans.json)' },
  },
  {
    cid: 'promo-bring-your-phone', title: 'Bring your phone. Keep your number.',
    subtitle: 'Switch on Simple for $28 a line, and we pay off your old phone, up to $800.', badge: 'switch', cta: 'Check your phone',
    tags: { category: ['plans'], intent: ['byod', 'switch'], lines: ['solo'], contentType: ['deal'] },
    gate: SWITCHER, window: [-45, 120],
    grammar: { who: 'A new customer bringing a compatible phone and porting a number in', plan: 'Simple',
      consideration: 'Port a number in from another carrier', value: 'Up to $800 toward the old phone’s balance, and the $28 switcher price per line',
      ends: 'The payoff is made against the old carrier’s final bill', combinable: false,
      seen: 'the $800 switcher payoff, verizon.com and t-mobile.com, 2026-09-30 (buying brief (b))' },
  },
  {
    cid: 'promo-pixel-11-launch', title: 'Pixel 11 on us, on a new line or upgrade.',
    subtitle: 'A $900 bill credit on any Unlimited plan, or up to $900 off an upgrade with trade-in. Ends next week.', badge: 'new-line', cta: 'Shop Pixel 11',
    tags: { category: ['phones'], brand: ['google'], ecosystem: ['android'], priceBand: ['core'], intent: ['new', 'upgrade'], contentType: ['deal'] },
    gate: ['new', 'add-line', 'upgrade'], window: [-49, 7], featured: ['pixel-11', 'pixel-11-pro'],
    grammar: { who: 'A new line or an added line; or an upgrade with a trade-in', plan: 'Any Unlimited plan',
      consideration: 'None on a new line; an eligible trade-in on an upgrade', value: '$900 in bill credits over 36 months ($25 a month)',
      ends: 'Credits stop if the line is cancelled or the phone is paid off early', combinable: false, endsOn: 'launch window', seen: SEEN },
    role: 'closes when two weeks pass (beat 11)',
  },
  {
    cid: 'promo-pixel-11-season', title: 'Pixel 11. Up to $900 off with trade-in.',
    subtitle: 'On a new line or an upgrade.', badge: 'trade-in', cta: 'Shop Pixel 11',
    tags: { category: ['phones'], brand: ['google'], ecosystem: ['android'], priceBand: ['core'], intent: ['new', 'upgrade'], contentType: ['deal'] },
    gate: ['new', 'add-line', 'upgrade'], window: [7, 90], featured: ['pixel-11'],
    grammar: { who: 'A new line, an added line or an upgrade', plan: 'Any Unlimited plan', consideration: 'Trade in an eligible phone',
      value: 'Up to $900 in bill credits over 36 months ($25 a month)', ends: 'Credits stop if the line is cancelled or the phone is paid off early',
      combinable: false, seen: SEEN },
    role: 'the scheduled successor: its window opens as the launch offer’s closes',
  },
  {
    cid: 'promo-iphone-duo-preorder', title: 'iPhone Duo. Pre-order 16 October.',
    subtitle: 'Apple’s first foldable. Trade in and save up to $1,200.', badge: 'pre-order', cta: 'Get ready',
    tags: { category: ['phones'], brand: ['apple'], ecosystem: ['ios'], priceBand: ['premium'], intent: ['new', 'upgrade'], contentType: ['deal'] },
    // A pre-order is not for someone bringing her own phone (the lead's ruling,
    // 2026-09-30): device-purchase intents only. Beat 13's pin needs one of them
    // asserted, which the page does (new, or upgrade after the toggle).
    gate: ['new', 'add-line', 'upgrade'], window: [-21, 23], featured: ['iphone-duo'],
    grammar: { who: 'Anyone buying a device: a new line, an added line or an upgrade', plan: 'Any plan', consideration: 'An eligible trade-in for the savings',
      value: 'Pre-orders open 16 October, in stores 23 October; trade in and save up to $1,200 on a new line or $1,020 on an upgrade',
      ends: 'Pre-order window', combinable: true, endsOn: '2026-10-23', seen: SEEN },
    role: 'pinned in beat 13 for every device shopper; gated to new, add-line and upgrade, so it never reaches someone bringing her own phone',
  },
  {
    cid: 'promo-galaxy-s26-ultra-upgrade', title: 'Galaxy S26 Ultra. Up to $900 off your upgrade.',
    subtitle: 'Trade in an eligible phone when you upgrade a line.', badge: 'trade-in', cta: 'Upgrade now',
    tags: { category: ['phones'], brand: ['samsung'], ecosystem: ['android'], priceBand: ['premium'], intent: ['upgrade'], contentType: ['deal'] },
    gate: UPGRADE, window: [-30, 60], featured: ['galaxy-s26-ultra'],
    grammar: { who: 'An existing line upgrading', plan: 'Unlimited More or Unlimited Max', consideration: 'Trade in an eligible phone',
      value: 'Up to $900 in bill credits over 36 months ($25 a month)',
      ends: 'Credits stop if the line is cancelled, changes plan below Unlimited More, or the phone is paid off early; a trade-in still locked or late is charged back',
      combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-iphone-18-pro-upgrade', title: 'iPhone 18 Pro. Up to $1,020 off your upgrade.',
    subtitle: 'With an eligible trade-in on Unlimited Max.', badge: 'trade-in', cta: 'Upgrade now',
    tags: { category: ['phones'], brand: ['apple'], ecosystem: ['ios'], priceBand: ['premium'], intent: ['upgrade'], contentType: ['deal'] },
    gate: UPGRADE, window: [-18, 31], featured: ['iphone-18-pro'],
    grammar: { who: 'An existing line upgrading', plan: 'Unlimited Max', consideration: 'Trade in an eligible phone',
      value: 'Up to $1,020 in bill credits over 36 months ($28.33 a month)',
      ends: 'Credits stop if the line is cancelled, moves to a lower plan, or the phone is paid off early', combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-galaxy-z-fold8-trade-in', title: 'Galaxy Z Fold8. Up to $1,100 off.',
    subtitle: 'With an eligible trade-in on a new line with Unlimited Max.', badge: 'trade-in', cta: 'Shop Galaxy Z Fold8',
    tags: { category: ['phones'], brand: ['samsung'], ecosystem: ['android'], priceBand: ['premium'], intent: ['new'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-70, 45], featured: ['galaxy-z-fold8'],
    grammar: { who: 'A new line, or a line added to an account', plan: 'Unlimited Max', consideration: 'Trade in an eligible phone',
      value: 'Up to $1,100 in bill credits over 36 months ($30.55 a month)',
      ends: 'Credits stop if the line is cancelled, changes plan, or the phone is paid off early', combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-iphone-17-new-line', title: 'iPhone 17 on us with a new line.',
    subtitle: 'A $930 bill credit on Unlimited More or Max.', badge: 'new-line', cta: 'Shop iPhone 17',
    tags: { category: ['phones'], brand: ['apple'], ecosystem: ['ios'], priceBand: ['premium'], intent: ['new'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-60, 90], featured: ['iphone-17'],
    grammar: { who: 'A new line, or a line added to an account', plan: 'Unlimited More or Unlimited Max', consideration: 'None',
      value: '$930 in bill credits over 36 months ($25.83 a month)',
      ends: 'Credits stop if the line is cancelled, changes plan below Unlimited More, or the phone is paid off early', combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-razr-new-line', title: 'razr 2026 on us with a new line.',
    subtitle: 'An $800 bill credit on Unlimited Max.', badge: 'new-line', cta: 'Shop razr',
    tags: { category: ['phones'], brand: ['motorola'], ecosystem: ['android'], priceBand: ['core'], intent: ['new'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-6, 60], featured: ['razr-2026'],
    grammar: { who: 'A new line, or a line added to an account', plan: 'Unlimited Max', consideration: 'None',
      value: '$800 in bill credits over 36 months ($22.22 a month)', ends: 'Credits stop if the line is cancelled or the phone is paid off early',
      combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-moto-g-new-line', title: 'moto g 2026 on us with a new line.',
    subtitle: 'A $280 bill credit on any plan.', badge: 'new-line', cta: 'Shop moto g',
    tags: { category: ['phones'], brand: ['motorola'], ecosystem: ['android'], priceBand: ['entry'], intent: ['new'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-60, 90], featured: ['moto-g-2026'],
    grammar: { who: 'A new line', plan: 'Any plan', consideration: 'None', value: '$280 in bill credits over 36 months ($7.77 a month)',
      ends: 'Credits stop if the line is cancelled or the phone is paid off early', combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-edge-flash', title: 'edge 2026: $289.99 off.',
    subtitle: 'Flash sale on a new line with Simple. Ends tomorrow.', badge: 'flash', cta: 'Shop edge',
    tags: { category: ['phones'], brand: ['motorola'], ecosystem: ['android'], priceBand: ['core'], intent: ['new'], contentType: ['deal'] },
    gate: NEW_LINE, window: [-2, 1], featured: ['edge-2026'],
    grammar: { who: 'A new line', plan: 'Simple', consideration: 'None', value: '$289.99 off the $529.99 retail price',
      ends: 'Ends tomorrow', combinable: false, endsOn: 'flash: days', seen: `${SEEN}: “Save $289.99. Ends Wednesday.”` },
    role: 'a flash cut: its window is days, so it has closed by the time two weeks pass',
  },
  {
    cid: 'promo-watch-tablet-line', title: 'Add a watch or tablet line.',
    subtitle: 'Up to $500 off a watch or $600 off a tablet on a new line; watch lines from $10.', badge: 'new-line', cta: 'Shop connected devices',
    tags: { category: ['watches-tablets'], intent: ['add-line'], lines: ['duo', 'family'], perk: ['family'], contentType: ['deal'] },
    // Open to bring-your-own (the lead's ruling): once the Duo pre-order is gated,
    // the bring-your-own four would otherwise show three. A watch line needs no new phone.
    gate: ['new', 'add-line', 'byod'], window: [-90, 180],
    grammar: { who: 'A new connected-device line', plan: 'Any Unlimited plan', consideration: 'None',
      value: 'Up to $500 off a watch or $600 off a tablet, in bill credits over 36 months', ends: 'Credits stop if the line is cancelled',
      combinable: false, seen: SEEN },
  },
  {
    cid: 'promo-streaming-perk', title: 'The streaming bundle, three months on us.',
    subtitle: 'With Unlimited Max; $12 a line after.', badge: 'bundle', cta: 'See perks',
    tags: { category: ['plans'], perk: ['streaming'], contentType: ['deal'] },
    window: [-30, 120],
    grammar: { who: 'Any Unlimited Max line', plan: 'Unlimited Max', consideration: 'None', value: 'Three months of the streaming bundle, then $12 a line',
      ends: 'The perk ends if the line leaves Unlimited Max', combinable: true, seen: 'our perk price (plans.json); perks run $10–15 a line on verizon.com' },
  },
  {
    cid: 'promo-5g-home', title: 'Add 5G Home for $35 a month.',
    subtitle: 'With any mobile plan, where 5G Home is available.', badge: 'bundle', cta: 'Check your address',
    tags: { category: ['home-internet'], intent: ['home'], lines: ['duo', 'family'], contentType: ['deal'] },
    regions: HOME_COVERAGE, window: [-60, 180],
    grammar: { who: 'An address our 5G Home network covers', plan: 'Any mobile plan', consideration: 'An address check',
      value: '$35 a month with a mobile plan ($60 without)', ends: 'The bundle price ends if the mobile plan is cancelled', combinable: true,
      seen: `${SEEN}: home internet from $35 with any mobile plan` },
    role: 'eligible only where 5G Home is available: regions, failing closed (beat 14)',
  },
];

/** Black Friday arrives in beat 12 with no history: the switcher offer, no trade-in (the 2025 precedent). */
const BLACK_FRIDAY = {
  cid: 'promo-black-friday-switch', title: 'Black Friday, early: switch and get a phone on us.',
  subtitle: 'No trade-in needed. iPhone 18 Pro, Galaxy S26 or Pixel 11 on a new line.', badge: 'switch', cta: 'Switch now',
  tags: { category: ['phones'], intent: ['switch', 'byod'], ecosystem: ['android', 'ios'], priceBand: ['core', 'premium'], contentType: ['deal'] },
  gate: ['new'], featured: ['iphone-18-pro', 'galaxy-s26', 'pixel-11'],
  grammar: { who: 'A new customer porting a number in, on a new line', plan: 'Unlimited More or Unlimited Max', consideration: 'None: no trade-in',
    value: 'Up to $1,199.99 in bill credits over 36 months ($33.33 a month)',
    ends: 'Credits stop if the line is cancelled or ported out, changes plan below Unlimited More, or the phone is paid off early', combinable: false,
    seen: 'a shape, not a sighting: in 2025 switchers got the iPhone 17 family free with no trade-in (buying brief (c), [31])' },
  role: 'new piece, no history: reaches the module on its metadata (beat 12)',
};

/** The homepage hero. The launch hero is the site's own default: first in catalog order. */
const HEROES = [
  { cid: 'hero-launch', title: 'iPhone 18 Pro is here.', subtitle: 'Variable aperture, the A20 Pro, and our launch trade-in offer.', cta: 'Shop iPhone 18 Pro',
    tags: { category: ['phones'], brand: ['apple'], ecosystem: ['ios'], priceBand: ['premium'], contentType: ['deal'], campaign: [LANDING.campaignTerm] },
    featured: ['iphone-18-pro'], role: 'the default hero' },
  { cid: 'hero-switch', title: 'Switch in minutes. Keep your number.', subtitle: 'Bring your phone or pick a new one; we move your number for you.', cta: 'Start switching',
    tags: { intent: ['switch', 'byod'], contentType: ['tool'] }, gate: SWITCHER },
  { cid: 'hero-family', title: 'Four lines. One simple bill.', subtitle: 'Unlimited Go at $28 a line for four, with AutoPay.', cta: 'Build a family plan',
    tags: { lines: ['family'], perk: ['family'] } },
  { cid: 'hero-continue', title: 'Pick up where you left off.', subtitle: 'Your selections, nothing inferred: the page paints them from the configuration you built.', cta: 'Continue',
    tags: {}, journeyStageFit: ['considering', 'deciding'],
    role: 'eligible only once the shopper is comparing or deciding (the slot’s stage rule); its body is the shopper’s own priced configuration, rendered by the page' },
];

/**
 * The modules below the buy box, in the TEMPLATE ORDER, which mirrors
 * verizon.com's phone page as seen 2026-09-30 (landscape brief §3): trade-in,
 * their "offers" block, storage, their watch-and-tablet bundle, accessories,
 * then protection (which their page sells in a later step) and home internet.
 * With nothing known the slot answers exactly this order (the catalogue order)
 * and says so on every position.
 */
const MODULES = [
  { cid: 'trade-in', title: 'Trade in and save', subtitle: 'Your trade-in value, shown per plan.',
    tags: { intent: ['upgrade', 'switch'], contentType: ['tool'] }, stage: ['considering', 'deciding'] },
  { cid: 'plan-pairing', title: 'Pair with a plan', subtitle: 'Simple or Unlimited, and the starter it opens on.',
    tags: { category: ['plans'], perk: ['streaming', 'music-games', 'hotspot-travel', 'international', 'family'] }, stage: ['considering'] },
  { cid: 'storage-memory', title: 'Storage & memory', subtitle: '256 GB base; each step at its real monthly delta, and what it does to a capped trade-in.',
    tags: { priceBand: ['premium'], contentType: ['compare'] }, stage: ['considering'] },
  { cid: 'connected-devices', title: 'Watch, tablet and more lines', subtitle: 'Watch and tablet lines on new lines; add a line at the per-line price.',
    tags: { category: ['watches-tablets'], intent: ['add-line'], lines: ['duo', 'family'], perk: ['family'] }, stage: ['considering', 'deciding'] },
  { cid: 'accessories', title: 'Accessories', subtitle: 'Buy more, save more: 20, 25 or 30 percent.',
    tags: { category: ['accessories'], contentType: ['deal'] }, stage: ['deciding'] },
  { cid: 'protection', title: 'Protect your phone', subtitle: 'Cover for loss, theft and cracks, per phone or per account.',
    tags: { priceBand: ['premium'], intent: ['upgrade'], contentType: ['explainer'] }, stage: ['deciding'] },
  { cid: 'home-bundle', title: 'Add home internet', subtitle: 'Vantage 5G Home for $35 a month with any Unlimited plan.',
    tags: { category: ['home-internet'], intent: ['home'], contentType: ['tool'] }, stage: ['considering', 'deciding'], regions: HOME_COVERAGE },
];

/** The plans inside "Pair with a plan", in the site's order: Simple first, as their 2026 site leads with it. */
const PLAN_PIECES = [
  { cid: 'plan-simple', tier: 'simple', tags: { intent: ['switch', 'byod'], lines: ['solo'] } },
  { cid: 'plan-go', tier: 'go', tags: { perk: ['family'], lines: ['duo', 'family'] } },
  { cid: 'plan-more', tier: 'more', tags: { perk: ['hotspot-travel', 'music-games'], intent: ['upgrade'], lines: ['duo'] } },
  { cid: 'plan-max', tier: 'max', tags: { perk: ['streaming', 'international'], intent: ['upgrade'] } },
].map((p) => {
  const tier = PLANS.tiers.find((t) => t.id === p.tier);
  if (!tier) throw new Error(`plans.json has no tier "${p.tier}"`);
  return { ...p, title: tier.name, subtitle: tier.starter.label };
});

// ── Piece construction ──────────────────────────────────────────────────────
const idOf = (cid) => cid.replace(/-/g, '_');

const IMAGE_DIRS = { promotion: 'promos', hero: 'heroes', module: 'modules', plan: 'plans' };
/**
 * Lane L3's art (public/vantage/img/<dir>/<piece id>.<ext>, provenance in its
 * MANIFEST.json). A file named for the piece's own id wins; this map is the
 * fallback for a renamed piece. Used only when the file is there: a missing
 * image paints the placeholder, never a broken tag.
 */
const ART = {
  // Renamed from promo-moto-g-flash when the offer became the real $280 new-line credit; same phone, no text on the tile.
  'promo-moto-g-new-line': 'promos/promo-moto-g-flash.jpg',
};
const imageExists = (rel) => existsSync(new URL(`../public/vantage/img/${rel}`, import.meta.url));
function imageOf(kind, cid) {
  const dir = IMAGE_DIRS[kind];
  if (dir) for (const ext of ['jpg', 'png', 'webp', 'svg']) if (imageExists(`${dir}/${cid}.${ext}`)) return `/vantage/img/${dir}/${cid}.${ext}`;
  return ART[cid] && imageExists(ART[cid]) ? `/vantage/img/${ART[cid]}` : null;
}

const windowAt = (anchorMs, [fromDays, toDays]) => ({ from: iso(anchorMs + fromDays * DAY), to: iso(anchorMs + toDays * DAY) });

function eligibilityOf(def) {
  const rule = {};
  if (def.regions) rule.regions = [...def.regions];
  if (def.gate) rule.context = { intent: [...def.gate] };
  return Object.keys(rule).length ? rule : undefined;
}

function pieceOf(kind, def, slotTypes, anchorMs, windowOverride) {
  const renderUrl = imageOf(kind, def.cid);
  const eligibleWhen = eligibilityOf(def);
  return {
    id: idOf(def.cid),
    customerContentId: def.cid,
    type: kind,
    title: def.title,
    ...(def.subtitle ? { subtitle: def.subtitle } : {}),
    tags: Object.fromEntries(Object.entries(def.tags).map(([k, v]) => [k, [...v]])),
    slotTypes,
    lifecycle: { status: 'live' },
    window: windowOverride ?? windowAt(anchorMs, def.window ?? [-180, 365]),
    ...(renderUrl ? { renderUrl } : {}),
    inStock: true,
    ...(eligibleWhen ? { eligibleWhen } : {}),
    ...(def.merchandising ? { merchandising: { ...def.merchandising } } : {}),
    ...(def.stage || def.journeyStageFit ? { journeyStageFit: [...(def.journeyStageFit ?? def.stage)] } : {}),
    ...(def.featured ? { featuredProductIds: def.featured.map((id) => phone(id).id) } : {}),
  };
}

const anchor = Date.now();

function openingPieces(anchorMs) {
  return [
    ...PROMOTIONS.map((d) => pieceOf('promotion', d, PROMO_SLOTS, anchorMs)),
    ...HEROES.map((d) => pieceOf('hero', d, ['hero'], anchorMs)),
    ...MODULES.map((d) => pieceOf('module', d, ['pdp-modules'], anchorMs)),
    ...PLAN_PIECES.map((d) => pieceOf('plan', d, ['plan-pairing'], anchorMs)),
  ];
}

const catalogDoc = (pieces, label) => ({ version: `content-vantage-${label}`, pieces });

const opening = openingPieces(anchor);

/** Time passes by publishing: every window moves back by the same amount, and the real clock is untouched. */
const shifted = (pieces, byMs) => pieces.map((p) => (!p.window ? p : { ...p,
  window: { from: iso(Date.parse(p.window.from) - byMs), to: iso(Date.parse(p.window.to) - byMs) } }));

const TWO_WEEKS = 14 * DAY;
const afterTwoWeeks = shifted(opening, TWO_WEEKS);
const blackFriday = [...afterTwoWeeks, pieceOf('promotion', BLACK_FRIDAY, PROMO_SLOTS, anchor,
  { from: iso(anchor - 2 * MINUTE), to: iso(anchor + 28 * DAY) })];

// ─────────────────────────────────────────────────────────────────────────────
// 3 · The slots. Page order is the slots' order within a page. Slot names are
// unique across pages because one slot name is one statistics object.
//
// `campaign` is weighted on the hero and deals slots although it is not a
// registry dimension: no event ever builds it, so it scores only through a W16
// seed rule, and exactly one promotion and one hero carry it. That is how the
// arrival lifts THE launch promotion and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
const WEIGHTS = {
  hero: { intent: 0.5, lines: 0.35, brand: 0.1, ecosystem: 0.1, campaign: 0.3 },
  // lines 0.4: calibration on the lead's ruling (2026-09-30), measured in New York.
  // At 0.25 the four-line offer missed the homepage four at beat 9. The ruling named
  // 1.5, which the engine refuses (slot weights are 0..1, src/content/kinds.ts:324);
  // at 1 the lines-tagged offers took the four from beat 9 on, so the upgrade offer
  // lost container one at beat 10 and Black Friday fell to fourth at beat 12.
  // intent 1: declared intent is the carrier's own merchandising axis (the lead's ruling).
  deals: { brand: 0.2, ecosystem: 0.15, priceBand: 0.1, intent: 1, lines: 0.4, perk: 0.1, category: 0.1, campaign: 0.3 },
  'pdp-modules': { priceBand: 0.2, contentType: 0.2, perk: 0.35, intent: 0.2, lines: 0.3, category: 0.15 },
  'plan-pairing': { intent: 0.5, perk: 0.35, lines: 0.25 },
};

/**
 * The arrival seeds (W16 C3). Lane L4 owns their values and hands them over as
 * public/vantage/seeds.json; this script merges them into the slots they name.
 * Until that file exists the deals slot carries a placeholder of weight 0, so
 * the rule is visible on every receipt and moves nothing.
 *
 * Accepted shapes: an array (the deals slot's rules), { "seeds": [...] }
 * (the same), or { "<slot>": [...], ... } for any of the slots above.
 */
const SEEDS_FILE = new URL('../public/vantage/seeds.json', import.meta.url);
const PLACEHOLDER_SEEDS = { deals: [{ signal: 'campaign_term', value: LANDING.campaignTerm,
  tags: [{ dimension: 'campaign', value: LANDING.campaignTerm }], weight: 0 }] };

function arrivalSeeds() {
  if (!existsSync(SEEDS_FILE)) return { source: 'placeholder (weight 0) until lane L4 delivers public/vantage/seeds.json', bySlot: PLACEHOLDER_SEEDS };
  const raw = JSON.parse(readFileSync(SEEDS_FILE, 'utf8'));
  const bySlot = Array.isArray(raw) ? { deals: raw }
    : Array.isArray(raw?.seeds) ? { deals: raw.seeds }
      : Object.fromEntries(Object.entries(raw ?? {}).filter(([slot, rules]) => Object.hasOwn(WEIGHTS, slot) && Array.isArray(rules)));
  const pieces = [...opening, pieceOf('promotion', BLACK_FRIDAY, PROMO_SLOTS, anchor)];
  for (const [slot, rules] of Object.entries(bySlot)) {
    for (const [i, rule] of rules.entries()) {
      for (const tag of rule?.tags ?? []) {
        if (!Object.hasOwn(WEIGHTS[slot], tag.dimension)) {
          throw new Error(`seeds.json ${slot}[${i}]: '${tag.dimension}' is not a dimension the ${slot} slot weights (${Object.keys(WEIGHTS[slot]).join(', ')})`);
        }
        const carried = pieces.some((p) => p.slotTypes.includes(slot) && (p.tags[tag.dimension] ?? []).includes(tag.value));
        if (!carried) console.warn(`seeds.json ${slot}[${i}]: no ${slot} piece carries ${tag.dimension}=${tag.value}; that tag lifts nothing`);
      }
    }
  }
  return { source: 'public/vantage/seeds.json (lane L4)', bySlot };
}
const SEEDS = arrivalSeeds();

function slotsDoc({ pinned = null } = {}) {
  const seedsFor = (slot) => (SEEDS.bySlot[slot] ? { seeds: SEEDS.bySlot[slot].map((r) => structuredClone(r)) } : {});
  return {
    version: 'slots-vantage',
    pages: {
      home: [
        {
          slot: 'hero', take: 1, weights: { ...WEIGHTS.hero },
          // The continue hero fits comparing and deciding. Outside them its score
          // is multiplied by zero, so it can never lead; inside them it gains a
          // bonus. A piece with no stage fit (the other three) is untouched.
          stage: { outOfStage: 0, inStage: 0.5 },
          ...seedsFor('hero'),
        },
        {
          slot: 'deals', take: 4, weights: { ...WEIGHTS.deals },
          // Two per brand. A brand-agnostic offer (plans, lines, home) carries no
          // brand tag and never counts against it.
          diversity: { dimension: 'brand', max: 2 },
          // The launch promotion carries the promotion signal; this is the dial.
          // 0.1, measured by lane L4: at 0.25 the launch offer led Texas even
          // without the ad, so the ad changed nothing and the hinge had nothing to hand off.
          merchandising: { promotion: 0.1, maxBoost: 1.6, minBoost: 0.7 },
          ...(pinned ? { pinnedPieceIds: [pinned] } : {}),
          ...seedsFor('deals'),
        },
      ],
      phone: [
        { slot: 'pdp-modules', take: 6, weights: { ...WEIGHTS['pdp-modules'] }, ...seedsFor('pdp-modules') },
        { slot: 'plan-pairing', take: 3, weights: { ...WEIGHTS['plan-pairing'] }, ...seedsFor('plan-pairing') },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · What the slots learn. Holdout 0 ON STAGE: assignment is hash-sticky and a
// 5 percent arm could put the presenter's own visitor in the default arm; the
// holdout is shown as a setting in beat 15, not run. γ 0 on every slot (the lift
// is computed, shown and ignored until a person raises the dial), exploration
// off, the regional prior ON (an absent block means OFF, service.ts:430), and
// the shipped policy and the 21-day learning horizon.
// ─────────────────────────────────────────────────────────────────────────────
const DIALS = { reward: 'click', objective: 'unit', gamma: 0, exploration: { mode: 'off', share: 0, floor: 0 } };
const learnDoc = {
  version: 'learn-vantage',
  holdout: { share: 0, salt: 'vantage', arms: ['default'] },
  // kBlend 0.5 (the lead's dial, 2026-09-30): λ = k / (k + Σa), so the prior gives
  // way to her own behaviour twice as fast as at the shipped 1.
  regional: { enabled: true, kBlend: 0.5, minEvents: 30 },
  policy: { scope: 'session', match: 'direct', credit: 'last',
    windowsMs: { click: 1_800_000, dwell: 1_800_000, video_complete: 1_800_000, wishlist: 21_600_000, add_to_bag: 21_600_000, purchase: 604_800_000, custom: 1_800_000 } },
  stats: { n0: 30, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 },
  slots: Object.fromEntries(Object.keys(WEIGHTS).map((slot) => [slot, structuredClone(DIALS)])),
};

// ─────────────────────────────────────────────────────────────────────────────
// 5 · The beat documents (design §9). Each is a PUBLISH (the whole document at
// that point in the story, so any beat can be entered directly and one press is
// one versioned write) or a CONTEXT assertion (what the page sends: the landing
// entry, ctx.* signals, the events a real control fires, and which snapshot it
// asks). The page drives real controls; these say what those controls send, so
// the page, the rehearsals and the script replay the same journey.
//
// The events are lane L2's event contract (docs/verizon/lanes/L2.md), control
// for control: POST /realtime/action as { userId, sessionId, source, type, data,
// entry }. A selector or a compare is `custom` with data.event naming the action
// (actionOf reads action, eventName, then event); a phone page is a
// `product_view` with view 'page' (the realtime door accepts no pdp_view TYPE).
// Every attribute is a registry source; `os` rides beside `ecosystem` and is
// ignored; the engine derives the price band from price_usd. The numbers in the
// `sees` lines were MEASURED on the local worker with exactly these events: if a
// control's event changes, measure again.
// ─────────────────────────────────────────────────────────────────────────────
const SOURCE = 'vantage-demo';
const phoneAttrs = (id, overrides = {}) => {
  const p = phone(id);
  return { productId: p.id, category: 'phones', brand: p.brand, os: p.ecosystem, ecosystem: p.ecosystem, price_usd: p.price_usd, ...overrides };
};
const storagePrice = (id, storage) => {
  const option = phone(id).storageOptions.find((o) => o.storage === storage);
  if (!option) throw new Error(`${id} has no ${storage} option in phones.json`);
  return option.price_usd;
};
const ev = (type, data, note) => ({ type, data, ...(note ? { note } : {}) });
const pageView = (page, data, note) => ev('page_view', { page, ...data }, note);
const card = (id, note) => ev('product_view', { ...phoneAttrs(id), view: 'card' }, note);
const phoneView = (id, note) => ev('product_view', { ...phoneAttrs(id), view: 'page' }, note);
const select = (control, data, note) => ev('custom', { event: 'select', control, ...data }, note);
const compare = (spec, data, note) => ev('custom', { event: 'compare', spec, ...data, contentType: 'compare' }, note);

const ACTS = [
  { n: 1, through: 2, name: 'The arrival' },
  { n: 2, through: 5, name: 'The visitor earns it' },
  { n: 3, through: 10, name: 'The phone page follows intent' },
  { n: 4, through: 14, name: 'The merchandiser’s day' },
  { n: 5, through: 15, name: 'Order and metric' },
];
const actOf = (beat) => ACTS.find((a) => beat <= a.through);

const NEW_STRANGER = { ctx: { intent: 'new', region: REGIONS.rehearsed[0].key } };
const home = (ctx = NEW_STRANGER.ctx, extra = {}) => ({ page: 'home', slots: ['hero', 'deals'], ctx: { ...ctx }, ...extra });
const phonePage = (id, ctx = NEW_STRANGER.ctx) => ({ page: 'phone', phone: id, slots: ['pdp-modules', 'plan-pairing'], ctx: { ...ctx } });

const DUO_ID = idOf('promo-iphone-duo-preorder');

// Beat 3 is three Samsung touches (the lead's ruling, 2026-09-30: thresholds stay
// at 0.60 / 0.45, so brand has to earn θin on its own), and beat 4 is the Pixel
// page. The page (lane L2) reads both from the anchor; the events below are the
// ones it sends, including the grid page views between the touches.
const BROWSE_TOUCHES = [{ id: 'galaxy-s26', view: 'card' }, { id: 'galaxy-s26', view: 'page' }, { id: 'galaxy-s26-ultra', view: 'card' }];
const HINGE_PHONE = 'pixel-11';
const browseEvents = () => {
  const out = [pageView('phones', {}, 'the phones grid')];
  let onGrid = true;
  for (const t of BROWSE_TOUCHES) {
    if (t.view !== 'page' && !onGrid) { out.push(pageView('phones', {}, 'back to the grid')); onGrid = true; }
    out.push(t.view === 'page' ? phoneView(t.id, `the ${phone(t.id).name} page`) : card(t.id, `quick look: ${phone(t.id).name}`));
    if (t.view === 'page') onGrid = false;
  }
  return out;
};

const CONTEXT_BEATS = {
  '01-arrival': {
    beat: 1, press: 'A stranger lands from the paid-social ad',
    visitor: { id: 'shopper-1', fresh: true, consent: { tracking: true, personalization: true } },
    landing: LANDING.url, entry: LANDING.entry, snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    engine: 'The entry sets the paid-social channel and fires the campaign_term seed on utm_term; the regional prior blends the region’s seeded sales into an empty vector; the page asserts ctx.intent=new (a signed-out visitor) and the rehearsed region.',
    sees: 'The hero and the deals module answer the ad (the iPhone 18 Pro launch) and the region; the cold-start panel names the grain.',
  },
  '02-another-region': {
    beat: 2, press: 'Same visitor, another region',
    visitor: { id: 'shopper-1' },
    snapshot: home({ intent: 'new', region: REGIONS.rehearsed[1].key }, { entry: LANDING.entry }),
    engine: 'Only the asserted region changes. On the demo profile ctx.region also selects the regional prior (lane L4’s override); eligibility reads it everywhere.',
    sees: 'The same four in a different order (measured: Texas puts the Galaxy S26 offer second, New York the Duo pre-order); the grain and the census figure shown for the other region.',
  },
  '03-browse-galaxy-pixel': {
    beat: 3, press: 'Browse Samsung: the Galaxy S26 card, its page, then the S26 Ultra card',
    visitor: { id: 'shopper-1' },
    events: browseEvents(),
    meters: 'GET /realtime/reflex after each touch; the homepage is not asked while she browses',
    engine: 'Three Samsung touches at product_view weight 1: brand samsung crosses θin 0.60 on the third (R ≈ 3, a = R / (R + K) ≈ 0.62 on K 1.8) and she joins the audience. Ecosystem and price band accumulate over the regional prior (λ = K / (K + Σa) falls as her own affinity grows).',
    sees: 'The meters move; brand samsung crosses the entry threshold on the third touch (measured 0.61 to 0.62 with the touches 1 to 2.5 s apart; the three must land within about 12 s to cross). The four do not move until she goes home.',
  },
  '04-the-hinge': {
    beat: 4, press: 'Open the Pixel 11 page, then back to the homepage',
    visitor: { id: 'shopper-1' },
    events: [phoneView(HINGE_PHONE, `the ${phone(HINGE_PHONE).name} page`), pageView('home', {}, 'back to the homepage')],
    snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    engine: 'Her Android affinity now spans two makers and outgrows the campaign seed, which still fires on every page load of the visit at its constant weight. Brand samsung decays on its 60 s room memory from the third touch; she stays in the audience while it is at or above θout 0.45 (hysteresis).',
    sees: 'Android promotions overtake the lifted launch promotion; the receipt reads “campaign context superseded by observed behaviour”. Brand samsung has already decayed under the entry line by now (measured 0.53 to 0.55, 16 to 19 s after the third touch at 15 s between presses) and she is still in the audience: it holds above θout 0.45.',
  },
  '05-stop-touching': {
    beat: 5, press: 'Stop touching it: a visible minute, then the page asks again',
    visitor: { id: 'shopper-1' },
    waitSeconds: 60,
    snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry, on: 'when the on-screen minute ends' }),
    meters: 'GET /realtime/reflex before the minute and after it',
    engine: 'REFLEX_HOST=session: the engine decays every interest at read (R·e^(−Δt/τ)), so the re-asked snapshot and meters are the engine’s own answer and the page decides nothing. Brand samsung (τ 60 s, room memory) falls below θout 0.45 about 40 s after her last Samsung touch; ecosystem android (14 days) holds. The object host’s alarm push over /realtime/ws stays behind ?exit=1, an upgrade once the ledger stall is fixed (docs/verizon/lanes/L1.md, finding 9).',
    sees: 'The Samsung-specific claim withdraws while the Android lean holds, and the diff row names both (measured in New York: brand samsung under 0.45 about 38 s after her third Samsung touch; re-asked 45 s after the hinge press it reads 0.35 on her meters and 0.36 as the Samsung offers’ driver, both under θout; ecosystem android 0.69 throughout). The four keep their order, the Galaxy S26 offer first on her Android lean; what withdraws is the Samsung driver behind it.',
  },
  '06-open-the-galaxy': {
    beat: 6, press: 'Open the Galaxy',
    visitor: { id: 'shopper-1' },
    events: [phoneView('galaxy-s26', 'the Galaxy S26 phone page')],
    snapshot: phonePage('galaxy-s26'),
    engine: 'pdp-modules opens in the order her homepage behaviour already earns: the S26 Ultra card was a premium-band touch, and the regional prior blends the region’s shares in at λ = k / (k + Σa) with kBlend 0.5, so the premium-tagged modules score above the template’s zeros, and the receipt names the drivers; plan-pairing answers its default order.',
    sees: 'Six modules in the order her behaviour earns: storage & memory and protection lead lightly (measured 0.085 each in New York, priceBand premium 0.43 on the receipt), the home bundle third, the rest in verizon.com’s order. The Compare tool’s frame is a fresh visitor in the same region (measured: storage & memory and protection 0.2 on the region’s premium lean, λ = 1 for a stranger); the published slots document’s template order is listed on the receipt as the reference, not shown as a frame. The buy box marked off limits; the trade-in module cites the offer the homepage led with (one decision on every surface: the page reads the deals decision, it does not re-decide).',
  },
  '07-compare-storage': {
    beat: 7, press: 'Compare storage, camera specs',
    visitor: { id: 'shopper-1' },
    events: [
      select('storage', { productId: 'galaxy-s26', storage: '512gb', price_usd: storagePrice('galaxy-s26', '512gb') }, 'the storage step: 256 GB → 512 GB'),
      compare('storage', { productId: 'galaxy-s26', storage: '512gb', price_usd: storagePrice('galaxy-s26', '512gb') }, 'compare: the storage row'),
      compare('camera', { productId: 'galaxy-s26', brand: 'samsung', os: 'android', ecosystem: 'android', price_usd: storagePrice('galaxy-s26', '512gb') }, 'compare: the camera row'),
    ],
    snapshot: phonePage('galaxy-s26'),
    engine: 'The 512 GB step is a $1,099.99 touch, so priceBand premium rises; the compare moves contentType compare.',
    sees: 'Storage & memory rises and leads with 512 GB at its real monthly delta (+$5.56 on this phone); protection follows the premium band.',
  },
  '08-hotspot-perk': {
    beat: 8, press: 'Open the hotspot perk',
    visitor: { id: 'shopper-1' },
    events: [pageView('perk', { category: 'plans', perk: 'hotspot-travel' }, 'perk details: hotspot & travel')],
    snapshot: phonePage('galaxy-s26'),
    compareVisitor: {
      id: 'streaming-shopper', fresh: true, consent: { tracking: true, personalization: true },
      events: [
        phoneView('iphone-18-pro-max', 'a premium phone page'),
        pageView('perk', { category: 'plans', perk: 'streaming' }, 'perk details: the streaming bundle'),
      ],
      snapshot: phonePage('iphone-18-pro-max'),
    },
    engine: 'perk hotspot-travel moves; plan-pairing weighs perk, intent and lines.',
    sees: 'Pair with a plan rises; Unlimited More leads on the hotspot & travel starter. The Compare tool shows the streaming shopper beside her: Unlimited Max leads with the streaming bundle.',
  },
  '09-four-lines': {
    beat: 9, press: 'Step the line selector from one to four; visit the kids’ watch',
    visitor: { id: 'shopper-1' },
    events: [
      select('lines', { lines: 'family', count: 4 }, 'the line selector at four lines'),
      pageView('kids-watch', { category: 'watches-tablets', intent: 'add-line', lines: 'family' }, 'the kids’ watch page'),
    ],
    snapshot: phonePage('galaxy-s26'),
    then: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    engine: 'lines family moves on the selector (a declared selector weighs 2) and again on the watch page, with intent add-line and category watches-tablets.',
    sees: 'Connected devices rises to the top of the six with the four-line per-line price (measured in New York: 0.29 against 0.26 at 15 s between presses, 0.291 against 0.289 at fast presses); the family starter (Unlimited Go) leads in plan pairing; on the homepage the hero becomes the family hero and the four-line promotion enters the four (measured: first, 0.595, level with the watch-and-tablet line; deals weights intent 1 and lines 0.4).',
  },
  '10-intent-toggle': {
    beat: 10, press: 'Flip the toggle to “bring your own”, then to “upgrade”',
    visitor: { id: 'shopper-1' },
    steps: [
      { label: 'bring your own', ctx: { intent: 'byod', region: REGIONS.rehearsed[0].key },
        events: [select('intent', { intent: 'byod' }, 'the buy-box toggle: bring your own phone')],
        snapshot: [phonePage('galaxy-s26', { intent: 'byod', region: REGIONS.rehearsed[0].key }), home({ intent: 'byod', region: REGIONS.rehearsed[0].key }, { entry: LANDING.entry })] },
      { label: 'upgrade', ctx: { intent: 'upgrade', region: REGIONS.rehearsed[0].key },
        events: [select('intent', { intent: 'upgrade' }, 'the buy-box toggle: upgrade a line')],
        snapshot: [phonePage('galaxy-s26', { intent: 'upgrade', region: REGIONS.rehearsed[0].key }), home({ intent: 'upgrade', region: REGIONS.rehearsed[0].key }, { entry: LANDING.entry })] },
    ],
    engine: 'ctx.intent is asserted (labelled): intent-gated offers fail closed. The toggle press is also behaviour (a selector), so intent moves.',
    sees: 'Two propositions routed by behaviour, same public prices. For the switcher: Simple leads plan pairing, the switch hero leads, and the toggle’s select touch puts intent byod at 0.53. The deals module puts the watch-and-tablet line first, on the added line she showed at the kids’ watch and her four lines, and bring-your-phone second (measured in New York: 0.592 against 0.522; the receipt names intent add-line, lines family and intent byod). The Duo pre-order is not offered to someone bringing her own phone, and the Unlimited-only trade-in offer fails closed. On upgrade: the new-line offers leave, the Galaxy S26 Ultra upgrade offer leads (measured 0.844) with its receipt (what it requires, what ends the credit), Unlimited More leads plan pairing and protection rises above plan pairing.',
  },
  '14-5g-home': {
    beat: 14, press: '5G Home where available',
    visitor: { id: 'shopper-1' },
    events: [
      pageView('home-internet', { category: 'home-internet', intent: 'home' }, 'the home internet page'),
      ev('custom', { event: 'start_order', control: 'address', category: 'home-internet', intent: 'home', contentType: 'tool' }, 'the address check (a start order, weight 3; lane L2 to add the control)'),
    ],
    snapshots: [
      phonePage('galaxy-s26', { intent: 'new', region: REGIONS.rehearsed[0].key }),
      phonePage('galaxy-s26', { intent: 'new', region: REGIONS.uncovered.key }),
      home({ intent: 'new', region: REGIONS.rehearsed[0].key }, { entry: LANDING.entry, label: `covered: ${REGIONS.rehearsed[0].label}` }),
      home({ intent: 'new', region: REGIONS.uncovered.key }, { entry: LANDING.entry, label: `not covered: ${REGIONS.uncovered.label}` }),
    ].map((s, i) => ({ ...s, label: s.label ?? `phone page, ${i === 0 ? `covered: ${REGIONS.rehearsed[0].label}` : `not covered: ${REGIONS.uncovered.label}`}` })),
    engine: 'eligibleWhen.regions on the home-bundle module and the 5G Home offer, evaluated before scoring, failing closed: a region that is not named, or no region at all, does not admit either. The address check moves intent home and category home-internet.',
    sees: 'On the phone page “Add home internet” leads the six in the covered region and is absent in the other. On the homepage the same rule gates the 5G Home offer: for her it takes container two in New York, behind the pin (measured 0.96, on the home intent her address check declared), and is absent in Montana. Nothing else about her changed.',
  },
  '15-continue-and-report': {
    beat: 15, press: 'Back to the homepage, then the template changes; clicks; the day report',
    visitor: { id: 'shopper-1' },
    events: [ev('add_to_cart', phoneAttrs('galaxy-s26', { price_usd: storagePrice('galaxy-s26', '512gb'), storage: '512gb' }), 'add to cart: Galaxy S26, 512 GB')],
    snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    template: { home: ['deals', 'hero', 'phones-rail'], note: 'Their CMS, not our decision: the page moves the deals module to position one; every slot is addressed by NAME, so the four and their learning are unchanged.' },
    clicks: [
      { slot: 'deals', position: 0, type: 'content_click' },
      { slot: 'deals', position: 1, type: 'content_click' },
      { slot: 'pdp-modules', position: 0, type: 'content_click' },
    ],
    report: { route: 'POST /vantage/api/report', slots: ['deals', 'pdp-modules'] },
    engine: 'The first add to cart makes her deciding, so the continue hero is in stage; slots answer by name; clicks are rewards, attributed per promotion and per module.',
    sees: 'The hero is now her priced configuration with one next step; the deals module moves, its four unchanged; the report per promotion and per module (attribution, labelled; lift is computed in their warehouse against a holdout).',
  },
};

const PUBLISH_BEATS = {
  '11-two-weeks-pass': {
    beat: 11, press: 'Two weeks pass', kind: 'catalog', document: catalogDoc(afterTwoWeeks, 'two-weeks-later'),
    visitor: { id: 'shopper-1' }, snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    turnsOn: { leaves: 'promo-pixel-11-launch', arrives: 'promo-pixel-11-season', alsoCloses: ['promo-edge-flash'] },
    engine: 'Every window moves back fourteen days in one versioned publish; the real clock is untouched. The Pixel 11 launch offer’s window closes and its scheduled successor’s opens.',
    sees: 'The launch offer leaves; the next promotion takes its container.',
  },
  '12-black-friday': {
    beat: 12, press: 'Black Friday arrives', kind: 'catalog', document: catalogDoc(blackFriday, 'black-friday'),
    visitor: { id: 'shopper-1' }, snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    turnsOn: { arrives: BLACK_FRIDAY.cid },
    engine: 'A new piece with no history at all: the switcher offer, no trade-in. It is scored on its tags like every other piece.',
    sees: 'It reaches the module on its metadata for the shopper whose behaviour says switch (measured in New York: first container, 0.845), and the watch-and-tablet line yields its place in the four.',
  },
  '13-pin-duo-preorder': {
    beat: 13, press: 'Pin the iPhone Duo pre-order (16 October) for everyone', kind: 'slots', document: slotsDoc({ pinned: DUO_ID }),
    visitor: { id: 'shopper-1' }, snapshot: home(NEW_STRANGER.ctx, { entry: LANDING.entry }),
    turnsOn: { pinned: 'promo-iphone-duo-preorder', container: 1 },
    engine: 'pinnedPieceIds on deals: a REQUIRED PREFIX, so the pin takes container one (the engine pins a prefix; there is no positional pin). Ranking never runs for it; the other three stay ranked, and its brand counts toward the cap.',
    sees: 'The Duo pre-order in container one with “ranking skipped”; the other three still ranked.',
  },
};

const OPEN = {
  'open-catalog': { kind: 'catalog', document: catalogDoc(opening, 'open'), press: 'Reset: the opening catalog' },
  'open-slots': { kind: 'slots', document: slotsDoc(), press: 'Reset: the opening slots' },
};

/** The envelope every beat document shares. The route publishes `publish.document` for the names on its closed list. */
function envelope(name, def) {
  const act = def.beat ? actOf(def.beat) : null;
  const { kind, document, beat, press, engine, sees, ...rest } = def;
  return {
    name,
    ...(beat ? { beat, act: act.n, actName: act.name } : { beat: 0, act: 0, actName: 'Reset' }),
    press,
    kind: document ? 'publish' : 'context',
    ...(document ? { publish: { kind, document } } : {}),
    ...rest,
    ...(engine ? { engine } : {}),
    ...(sees ? { sees } : {}),
  };
}

const BEAT_FILES = {
  ...Object.fromEntries(Object.entries(OPEN).map(([n, d]) => [n, envelope(n, d)])),
  ...Object.fromEntries(Object.entries({ ...CONTEXT_BEATS, ...PUBLISH_BEATS }).map(([n, d]) => [n, envelope(n, d)])),
};
const BEAT_ORDER = Object.entries(BEAT_FILES).filter(([, d]) => d.beat > 0).sort((a, b) => a[1].beat - b[1].beat).map(([n]) => n);
if (BEAT_ORDER.length !== 15 || BEAT_ORDER.some((n, i) => BEAT_FILES[n].beat !== i + 1)) throw new Error('the beats must be exactly 1..15');

// ─────────────────────────────────────────────────────────────────────────────
// 6 · Local checks before anything is written: every vocabulary value is named
// by at least one piece (a value no piece names builds no taste at all, by the
// engine's own rule), every tag is in the vocabulary, every slot weights only
// dimensions its pieces can carry.
// ─────────────────────────────────────────────────────────────────────────────
{
  const all = [...opening, pieceOf('promotion', BLACK_FRIDAY, PROMO_SLOTS, anchor)];
  const named = new Map();
  for (const p of all) for (const [dim, values] of Object.entries(p.tags)) {
    if (dim === 'campaign') continue;
    if (!Object.hasOwn(VOCABULARY, dim)) throw new Error(`${p.customerContentId}: tag dimension "${dim}" is not in the registry`);
    for (const v of values) {
      if (!VOCABULARY[dim].includes(v)) throw new Error(`${p.customerContentId}: ${dim}=${v} is not in the vocabulary`);
      if (!named.has(dim)) named.set(dim, new Set());
      named.get(dim).add(v);
    }
  }
  for (const [dim, values] of Object.entries(VOCABULARY)) {
    const missing = values.filter((v) => !named.get(dim)?.has(v));
    if (missing.length) throw new Error(`no piece names ${dim}=${missing.join(', ')}; events carrying it would build no taste`);
  }
  if (reflex.dimensions.map((d) => d.key).join() !== Object.keys(VOCABULARY).join()) throw new Error('registry and vocabulary disagree');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · Files: the display catalog, the beat documents and anchor.json.
// ─────────────────────────────────────────────────────────────────────────────
const vantageDir = new URL('../public/vantage/', import.meta.url);
const beatsDir = new URL('../public/vantage/beats/', import.meta.url);
mkdirSync(beatsDir, { recursive: true });
const write = (url, value) => writeFileSync(url, `${JSON.stringify(value, null, 1)}\n`);

/** Deterministic (no timestamps), so a reseed does not churn it. */
const displayOf = (kind, def, slot, extra = {}) => {
  const p = pieceOf(kind, def, [slot], 0);
  return {
    customerContentId: def.cid, id: p.id, kind, slot, title: def.title, ...(def.subtitle ? { subtitle: def.subtitle } : {}),
    ...(def.badge ? { badge: def.badge } : {}), ...(def.cta ? { cta: def.cta } : {}),
    ...(() => { const image = imageOf(kind, def.cid); return image ? { image } : { image: kind === 'promotion' || kind === 'hero' ? '/vantage/img/placeholder-promo.svg' : null, imagePending: true }; })(),
    tags: p.tags,
    ...(def.gate ? { gate: { 'ctx.intent': [...def.gate] } } : {}),
    ...(def.regions ? { regions: [...def.regions] } : {}),
    ...(def.window ? { windowDays: { from: def.window[0], to: def.window[1] } } : {}),
    ...(def.merchandising ? { merchandising: def.merchandising } : {}),
    ...(p.journeyStageFit ? { journeyStageFit: p.journeyStageFit } : {}),
    ...(def.featured ? { featuredProductIds: def.featured } : {}),
    ...(def.grammar ? { grammar: def.grammar } : {}),
    ...(def.role ? { role: def.role } : {}),
    ...extra,
  };
};

write(new URL('catalog.json', vantageDir), {
  about: `${BRAND.name} display catalog: what the page paints for each decided id. The snapshot answers ids; everything an offer IS (its grammar: who, plan, consideration, value, what ends the credit, stacking, dates) is content, published here and never to the engine. Generated by scripts/seed-vantage.mjs; do not edit by hand.`,
  brand: BRAND,
  offerTypes: ['trade-in', 'new-line', 'switch', 'flash', 'bundle', 'upgrade', 'pre-order'],
  ctxIntent: { values: ['new', 'add-line', 'upgrade', 'byod'], default: 'new', note: 'Asserted by the buy-box toggle and labelled as asserted; it gates offers (failing closed) and never prices.' },
  pieces: [
    ...PROMOTIONS.map((d, i) => displayOf('promotion', d, 'deals', { order: i, ...(i < 4 ? { siteDefault: true } : {}) })),
    displayOf('promotion', BLACK_FRIDAY, 'deals', { arrivesIn: '12-black-friday' }),
    ...HEROES.map((d, i) => displayOf('hero', d, 'hero', { order: i, ...(i === 0 ? { siteDefault: true } : {}) })),
    ...MODULES.map((d, i) => displayOf('module', d, 'pdp-modules', { templatePosition: i + 1 })),
    ...PLAN_PIECES.map((d, i) => displayOf('plan', d, 'plan-pairing', { order: i, tier: d.tier })),
  ],
});

for (const [name, document] of Object.entries(BEAT_FILES)) write(new URL(`${name}.json`, beatsDir), document);

write(new URL('anchor.json', beatsDir), {
  anchor: iso(anchor), tenant: scope, scope, brand: BRAND,
  pages: { home: 'home', phone: 'phone' },
  slots: { hero: 'hero', deals: 'deals', rail: 'phones-rail', modules: 'pdp-modules', plans: 'plan-pairing' },
  pageSlots: { home: ['hero', 'deals', 'phones-rail'], phone: ['pdp-modules', 'plan-pairing'] },
  decidedBy: { hero: 'snapshot', deals: 'snapshot', 'pdp-modules': 'snapshot', 'plan-pairing': 'snapshot', 'phones-rail': 'POST /sort (phones.json rail)' },
  // The deals module's four site defaults (catalog order), and every slot's zero-signal answer.
  defaults: PROMOTIONS.slice(0, 4).map((p) => p.cid),
  slotDefaults: { hero: 'hero-launch', deals: PROMOTIONS.slice(0, 4).map((p) => p.cid), 'pdp-modules': MODULES.slice(0, 6).map((m) => m.cid), 'plan-pairing': PLAN_PIECES.slice(0, 3).map((p) => p.cid) },
  templates: { home: ['hero', 'deals', 'phones-rail'], modules: MODULES.map((m) => m.cid), plans: PLAN_PIECES.map((p) => p.cid) },
  ids: {
    launch: 'promo-iphone-18-pro-launch', upgrade: 'promo-iphone-18-pro-upgrade', blackFriday: BLACK_FRIDAY.cid,
    duo: 'promo-iphone-duo-preorder', homeBundle: 'promo-5g-home', family: 'promo-four-lines', byod: 'promo-bring-your-phone',
    closesAtBeat11: 'promo-pixel-11-launch', successorAtBeat11: 'promo-pixel-11-season', upgradeAndroid: 'promo-galaxy-s26-ultra-upgrade',
    continueHero: 'hero-continue', familyHero: 'hero-family', switchHero: 'hero-switch',
  },
  focusPhone: 'galaxy-s26',
  browse: [...new Set(BROWSE_TOUCHES.map((t) => t.id))],
  browseTouches: BROWSE_TOUCHES,
  hingePhone: HINGE_PHONE,
  streamingShopper: { phone: 'iphone-18-pro-max', plan: 'plan-max', perk: 'streaming' },
  arrival: { utm_source: LANDING.entry.utmSource, utm_medium: LANDING.entry.utmMedium, utm_term: LANDING.entry.utmTerm, utm_campaign: 'iphone-18-pro-launch' },
  landing: LANDING,
  regions: { rehearsed: REGIONS.rehearsed, coverage: REGIONS.coverage, uncoveredRegion: REGIONS.uncovered,
    first: REGIONS.rehearsed[0].key, second: REGIONS.rehearsed[1].key, covered: REGIONS.rehearsed[0].key, uncovered: REGIONS.uncovered.key },
  // The alarm push stays off (the page connects the socket only when this is true);
  // the exit is the timed re-ask on the session host's lazy decay.
  exitBeat: false,
  exit: { mode: 're-ask', host: 'session', beat: '05-stop-touching', waitSeconds: 60,
    withdraws: { dim: 'brand', value: 'samsung', tauMs: MEMORY.fast }, holds: { dim: 'ecosystem', value: 'android' },
    thetaIn: reflex.thetaIn, thetaOut: reflex.thetaOut,
    push: 'the object host’s alarm over /realtime/ws, behind ?exit=1; off while the ledger stall stands (docs/verizon/lanes/L1.md, finding 9)' },
  measurementBasis: 'served-v1',
  ctx: { intent: { values: ['new', 'add-line', 'upgrade', 'byod'], default: 'new' }, region: 'US-XX, asserted by the page for rehearsal and labelled' },
  registry: { version: reflex.version, dimensions: reflex.dimensions, vocabulary: VOCABULARY, weights: reflex.weights,
    tauMs: reflex.tauMs, K: reflex.K, thetaIn: reflex.thetaIn, thetaOut: reflex.thetaOut, journey: reflex.journey,
    memory: { label: MEMORY.label, dimensions: reflex.dimensions.map((d) => {
      const tauMs = d.tauMs ?? reflex.tauMs, compressed = tauMs < reflex.tauMs;
      return { key: d.key, tauMs, room: tauMs <= MEMORY.fast ? '60 s' : tauMs <= MEMORY.medium ? '10 min' : '14 days',
        compressed, ...(compressed ? { label: MEMORY.label, production: MEMORY.production[d.key] ?? MEMORY.production.default } : {}) };
    }) } },
  slotWeights: WEIGHTS,
  seeds: { source: SEEDS.source, bySlot: SEEDS.bySlot },
  learn: { holdout: learnDoc.holdout, regional: learnDoc.regional, gamma: 0, exploration: 'off' },
  events: { endpoint: 'POST /realtime/action', source: SOURCE, body: '{ userId, sessionId, source, type, data }', customActions: ['select', 'filter', 'compare', 'search', 'start_order'] },
  routes: {
    beat: 'POST /vantage/api/beat { name, note? } — names: open-catalog, open-slots, 11-two-weeks-pass, 12-black-friday, 13-pin-duo-preorder',
    reset: 'POST /vantage/api/reset — open-slots then open-catalog',
    receipt: 'POST /vantage/api/receipt { decisionId } → { ok, record }, or { decisionIds: [...] } → { ok, records, pending }, with the shopper’s own X-Shopper-Session; 202 and pending while the ledger consumer has not written it yet',
    report: 'POST /vantage/api/report { date, slot, build? }',
    headers: 'Every call sends X-Tenant: vantage',
  },
  // The publishable names by the role the page gives them (the route's closed list), then every beat in order.
  beats: { open: { slots: 'open-slots', catalog: 'open-catalog' }, twoWeeks: { catalog: '11-two-weeks-pass' },
    blackFriday: { catalog: '12-black-friday' }, pinDuo: { slots: '13-pin-duo-preorder' } },
  beatIndex: BEAT_ORDER.map((n) => ({ beat: BEAT_FILES[n].beat, act: BEAT_FILES[n].act, actName: BEAT_FILES[n].actName, name: n, kind: BEAT_FILES[n].kind, press: BEAT_FILES[n].press })),
  acts: ACTS,
  reset: ['open-slots', 'open-catalog'],
});

const promos = opening.filter((p) => p.type === 'promotion');
console.log(`anchor ${iso(anchor)} · ${promos.length} promotions (+1 in beat 12), ${HEROES.length} heroes, ${MODULES.length} modules, ${PLAN_PIECES.length} plans`);
console.log(`art: ${[...PROMOTIONS, BLACK_FRIDAY].filter((p) => imageOf('promotion', p.cid)).length}/${PROMOTIONS.length + 1} promotion tiles, ${HEROES.filter((h) => imageOf('hero', h.cid)).length}/${HEROES.length} heroes present`);
console.log(`seeds: ${SEEDS.source}`);
console.log(`wrote public/vantage/catalog.json and ${Object.keys(BEAT_FILES).length + 1} documents to public/vantage/beats/`);

if (writeOnly) process.exit(0);

// ─────────────────────────────────────────────────────────────────────────────
// 8 · Publish.
// ─────────────────────────────────────────────────────────────────────────────
const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'seed-vantage', roles: ['operator'] },
  expiresIn: '30m', allowMint: isLoopbackTarget(base) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };

/**
 * One versioned publish with the preconditions the configuration authority
 * requires: read first, then write against exactly what was read (revision and
 * publication digest in If-Match, the expected revision in Idempotency-Key).
 */
const put = async (path, document, note) => {
  const url = `${base}${path}?scope=${encodeURIComponent(scope)}`;
  const current = await fetch(url, { headers: auth });
  const head = await current.json().catch(() => null);
  if (!current.ok || !head || head.ok === false || !head.publication) {
    return { status: current.status, ok: false, error: (head && head.error) || `could not read ${path}` };
  }
  const headers = { ...auth,
    'If-Match': `"${head.revision}/${head.publication.revision}/${head.publication.digest}"`,
    'Idempotency-Key': `${head.revision}:${crypto.randomUUID()}` };
  const envelopeOf = path.startsWith('/config/') ? { config: document, note } : { document, note };
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(envelopeOf) });
  const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return { status: res.status, ...body };
};

const report = (what, r) => {
  console.log(`${what}:`, JSON.stringify({ ok: r.ok, status: r.status, revision: r.revision, version: r.version, errors: r.errors, error: r.error }));
  return r.ok === true;
};

// The scope needs a publication set before anything can read or write it. This
// creates one, once; a re-run is refused with already_initialized and falls
// through to the ordinary versioned writes below.
const opened = { reflex, catalog: OPEN['open-catalog'].document, slots: OPEN['open-slots'].document, learn: learnDoc };
const boot = await fetch(`${base}/ops/demo-bootstrap?scope=${encodeURIComponent(scope)}`, { method: 'POST', headers: auth, body: JSON.stringify(opened) });
const bootBody = await boot.json().catch(() => ({}));
if (boot.ok && bootBody.ok) console.log(`bootstrap: created the publication set for "${scope}"`);
else if (bootBody.code === 'already_initialized') console.log(`bootstrap: "${scope}" already has a publication set`);
else { console.log('bootstrap:', JSON.stringify({ status: boot.status, ...bootBody })); process.exit(1); }

let ok = true;
ok = report('reflex', await put('/config/reflex', reflex, `${BRAND.name} registry, eight dimensions: ${MEMORY.label}`)) && ok;
ok = report('catalog', await put('/content/catalog', opened.catalog, `${BRAND.name} opening catalog: ${promos.length} promotions, heroes, modules, plans; windows anchored ${iso(anchor)}`)) && ok;
ok = report('slots', await put('/content/slots', opened.slots, 'hero take 1 with a stage rule; deals take 4, two per brand; pdp-modules take 6; plan-pairing take 3')) && ok;
ok = report('learn', await put('/content/learn', learnDoc, 'holdout 0 on stage; γ 0; exploration off; the regional prior on')) && ok;
process.exit(ok ? 0 : 1);
