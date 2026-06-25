#!/usr/bin/env node
/**
 * seed-d1.mjs
 * --------------------------------------------------------------------------
 * Deterministic D1 seed emitter for the Coach / Tapestry personalization demo.
 * Implements docs/architecture/10-d1-schema.md §4 "Seeding plan".
 *
 * Same determinism contract as scripts/generate-synthetic-data.mjs:
 *   - seeded Mulberry32 PRNG (no Math.random)
 *   - fixed EPOCH_NOW (no Date.now)
 *   => byte-identical re-runs.
 *
 * It only WRITES SQL files (no network). Apply them to LOCAL D1 with:
 *   npx wrangler d1 execute coach-demo-db --local --file=migrations/0002_seed_catalog.sql
 *   npx wrangler d1 execute coach-demo-db --local --file=migrations/0003_seed_profiles.sql
 *   npx wrangler d1 execute coach-demo-db --local --file=migrations/0004_seed_commerce.sql
 * (swap --local for --remote at deploy time).
 *
 * SOURCES (read-only):
 *   data/coach-catalog.json          -> coach_catalog (71 real SKUs) + meta_attribute_catalog
 *   data/synthetic/customers.json    -> coach_odp_profiles (3,200 ODP profiles)
 *   data/synthetic/events.json       -> coach_transactions + coach_purchase_items
 *                                       (ONLY purchase events are read — the rest of the
 *                                        51MB event stream is intentionally NOT loaded)
 *
 * Payment / commerce fields (tender, tax, shipping, discount, status, card, billing)
 * are GENERATED here per doc 10 — preserving conventions (billing_country ISO-3 'usa',
 * customer_id/email sparsity from event identifiers) and STRICT-table types.
 * --------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'migrations', 'seed');
const SEED = 20260625; // matches generate-synthetic-data.mjs
// Two independent workerd local-D1 limits force chunking:
//   1. per-statement SQL length  -> keep BATCH small (~80 rows/INSERT, ~36KB; 500 trips SQLITE_TOOBIG)
//   2. per-file statement COUNT  -> keep MAX_STMTS_PER_FILE low (hundreds of statements in one
//      file trips a statement-cache bug "statementCache.map.eraseMatch"; ~40 only warns).
// Both stay comfortably within D1's --remote import limits too (1MB/statement, 5GiB/file).
const BATCH = 80;
const MAX_STMTS_PER_FILE = 25;

// --------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32) + helpers — the ONLY source of randomness.
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
const rng = mulberry32(SEED);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p) => rand() < p;
function weightedPick(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
  return entries[entries.length - 1][0];
}

// --------------------------------------------------------------------------
// SQL literal helpers (STRICT-safe).
// --------------------------------------------------------------------------
function sTxt(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sInt(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? String(n) : 'NULL';
}
function sReal(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}
function sBool(v) {
  if (v === null || v === undefined) return 'NULL';
  return v ? '1' : '0';
}

/** Return an ARRAY of batched multi-row INSERT statements (each row = array of SQL literals). */
function emitInserts(table, columns, rows) {
  const out = [];
  const colList = `(${columns.join(', ')})`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const values = slice.map((r) => `(${r.join(', ')})`).join(',\n  ');
    out.push(`-- ${table} rows ${i + 1}..${i + slice.length}\nINSERT INTO ${table} ${colList} VALUES\n  ${values};`);
  }
  return out;
}

/**
 * Flush an ordered list of INSERT statements into sequential part-files
 * (migrations/seed/seed_NNN.sql), each holding <= MAX_STMTS_PER_FILE statements.
 * All DELETEs are prepended to the FIRST file only, so the whole set is an
 * idempotent re-seed when applied in lexical order. The statement order is
 * already FK-safe (catalog/meta/profiles -> transactions -> items), so chunk
 * boundaries never split a parent away from a later child.
 */
function writeChunks(deletes, statements) {
  mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  let fileIdx = 0;
  for (let i = 0; i < statements.length; i += MAX_STMTS_PER_FILE) {
    fileIdx += 1;
    const chunk = statements.slice(i, i + MAX_STMTS_PER_FILE);
    const name = `seed_${String(fileIdx).padStart(3, '0')}.sql`;
    const head =
      `-- ${'='.repeat(73)}\n-- ${name}  ·  Coach D1 seed part ${fileIdx}` +
      ` (generated by scripts/seed-d1.mjs, deterministic seed=${SEED}). DO NOT hand-edit.\n` +
      `-- Apply in order:  for f in migrations/seed/*.sql; do wrangler d1 execute coach-demo-db --local --file=\"$f\"; done\n` +
      `-- No BEGIN/COMMIT (D1 import constraint); <=${BATCH} rows/INSERT, <=${MAX_STMTS_PER_FILE} stmts/file.\n` +
      `-- ${'='.repeat(73)}`;
    const body = [];
    if (fileIdx === 1) {
      body.push('-- FK-safe idempotent reset (children before parents):', deletes.join('\n'), '');
    }
    body.push(chunk.join('\n\n'));
    writeFileSync(join(OUT_DIR, name), `${head}\n${body.join('\n')}\n`);
    written.push(name);
  }
  return written;
}

// (legacy single-file `header()` helper removed — chunked files carry their own header.)

// --------------------------------------------------------------------------
// Load sources.
// --------------------------------------------------------------------------
const catalog = JSON.parse(readFileSync(join(REPO_ROOT, 'data/coach-catalog.json'), 'utf8')).products;
const customers = JSON.parse(readFileSync(join(REPO_ROOT, 'data/synthetic/customers.json'), 'utf8')).customers;
const allEvents = JSON.parse(readFileSync(join(REPO_ROOT, 'data/synthetic/events.json'), 'utf8')).events;
const purchases = allEvents.filter((e) => e.action === 'purchase'); // SAMPLE: only purchases, not the full stream

const catById = new Map(catalog.map((p) => [p.id, p]));
const profByVuid = new Map(customers.map((c) => [c.identifiers.vuid, c]));
const priceBand = (p) => (p < 150 ? 'entry' : p < 400 ? 'core' : 'elevated');

// ==========================================================================
// FILE 0002 — coach_catalog (71) + meta_attribute_catalog (attribute allow-list)
// ==========================================================================
function buildCatalogFile() {
  const catCols = [
    'id', 'style_code', 'name', 'line', 'category', 'subcategory', 'price_usd', 'currency',
    'material', 'silhouette', 'size', 'lead_color', 'colors_json', 'occasion_json',
    'image_url', 'product_url', 'region', 'in_stock',
  ];
  const catRows = catalog.map((p) => [
    sTxt(p.id), sTxt(p.style_code), sTxt(p.name), sTxt(p.line), sTxt(p.category), sTxt(p.subcategory),
    sInt(p.price_usd), sTxt(p.currency || 'USD'), sTxt(p.material), sTxt(p.silhouette), sTxt(p.size),
    sTxt(Array.isArray(p.colors) && p.colors.length ? p.colors[0] : null),
    sTxt(p.colors ? JSON.stringify(p.colors) : null),
    sTxt(p.occasion ? JSON.stringify(p.occasion) : null),
    sTxt(p.image_url), sTxt(p.product_url), sTxt(p.region || 'North America'), sBool(p.in_stock),
  ]);

  // ---- meta_attribute_catalog: backs list_attributes() AND is the condition allow-list.
  const lines = [...new Set(catalog.map((p) => p.line))].sort();
  const categories = [...new Set(catalog.map((p) => p.category))].sort();
  const bands = ['entry', 'core', 'elevated'];
  const stages = ['early', 'mid', 'late'];
  const tiers = ['member', 'silver', 'gold', 'platinum'];
  const ranks = ['low', 'medium', 'high', 'vip'];
  const segs = [...new Set(customers.flatMap((c) => c.segments || []))].sort();

  const NUM = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists'];
  const ENUM = ['eq', 'neq', 'in', 'exists'];
  const TXT = ['eq', 'neq', 'contains', 'exists'];
  const HAS = ['contains', 'eq', 'exists'];
  const BOOL = ['eq', 'neq', 'exists'];

  // [key, source_table, column_expr, kind, sql_type, domain_kind, operators, enum_values, example, description]
  const attrs = [
    // behaviour (real-time session snapshot — coach_odp_profiles via v_profiles p.*)
    ['viewed_product_line', 'v_profiles', 'viewed_product_line', 'behavior', 'TEXT', 'enum', ENUM, lines, 'Tabby', 'Most-viewed product line this session.'],
    ['journey_stage', 'v_profiles', 'journey_stage', 'behavior', 'TEXT', 'enum', ENUM, stages, 'late', 'Funnel stage derived from this session.'],
    ['product_views', 'v_profiles', 'product_views', 'behavior', 'INTEGER', 'numeric', NUM, null, '3', 'PDP views this session.'],
    ['page_views', 'v_profiles', 'page_views', 'behavior', 'INTEGER', 'numeric', NUM, null, '5', 'All page views (lifetime).'],
    ['cart_adds', 'v_profiles', 'cart_adds', 'behavior', 'INTEGER', 'numeric', NUM, null, '0', 'Add-to-cart count this session.'],
    ['wishlist_adds', 'v_profiles', 'wishlist_adds', 'behavior', 'INTEGER', 'numeric', NUM, null, '1', 'Wishlist adds.'],
    ['cart_abandoned', 'v_profiles', 'cart_abandoned', 'behavior', 'INTEGER', 'boolean', BOOL, null, 'true', 'Added to cart then left without buying.'],
    ['price_band_viewed', 'v_profiles', 'price_band_viewed', 'behavior', 'TEXT', 'enum', ENUM, bands, 'elevated', 'Dominant viewed price band this session.'],
    // profile (static aggregates / predictions)
    ['favorite_line', 'v_profiles', 'favorite_line', 'profile', 'TEXT', 'enum', ENUM, lines, 'Tabby', 'Profile favourite product line.'],
    ['preferred_category', 'v_profiles', 'preferred_category', 'profile', 'TEXT', 'enum', ENUM, categories, 'Handbags', 'Profile preferred category.'],
    ['preferred_price_band', 'v_profiles', 'preferred_price_band', 'profile', 'TEXT', 'enum', ENUM, bands, 'core', 'Profile preferred price band.'],
    ['loyalty_tier', 'v_profiles', 'loyalty_tier', 'profile', 'TEXT', 'enum', ENUM, tiers, 'gold', 'Loyalty tier.'],
    ['loyalty_member', 'v_profiles', 'loyalty_member', 'profile', 'INTEGER', 'boolean', BOOL, null, 'true', 'Is a loyalty member.'],
    ['gifter', 'v_profiles', 'gifter', 'profile', 'INTEGER', 'boolean', BOOL, null, 'true', 'Tends to shop for gifts.'],
    ['engagement_rank', 'v_profiles', 'engagement_rank', 'profile', 'TEXT', 'enum', ENUM, ranks, 'vip', 'Bucketed engagement.'],
    ['order_likelihood', 'v_profiles', 'order_likelihood', 'profile', 'REAL', 'numeric', NUM, null, '0.6', 'Propensity to order (0..1).'],
    ['churn_risk_score', 'v_profiles', 'churn_risk_score', 'profile', 'REAL', 'numeric', NUM, null, '0.3', 'Churn risk (0..1).'],
    ['predicted_ltv_usd', 'v_profiles', 'predicted_ltv_usd', 'profile', 'INTEGER', 'numeric', NUM, null, '1450', 'Predicted lifetime value (USD).'],
    ['lifetime_value_usd', 'v_profiles', 'lifetime_value_usd', 'profile', 'INTEGER', 'numeric', NUM, null, '1180', 'Lifetime spend to date (USD).'],
    ['average_order_value_usd', 'v_profiles', 'average_order_value_usd', 'profile', 'INTEGER', 'numeric', NUM, null, '320', 'Profile AOV (USD).'],
    ['lifetime_orders', 'v_profiles', 'lifetime_orders', 'profile', 'INTEGER', 'numeric', NUM, null, '2', 'Lifetime order count.'],
    ['persona', 'v_profiles', 'persona', 'profile', 'TEXT', 'enum', ENUM, [...new Set(customers.map((c) => c.attributes.persona).filter(Boolean))].sort(), 'tabby_enthusiast', 'Demo persona label.'],
    ['country', 'v_profiles', 'country', 'identity', 'TEXT', 'text', TXT, null, 'US', 'ISO-2 country (customers.json convention).'],
    ['region', 'v_profiles', 'region', 'identity', 'TEXT', 'text', TXT, null, 'NY', 'State/region.'],
    // purchase aggregates (v_profiles purchase joins)
    ['bought_line', 'v_profiles', 'bought_lines', 'purchase', 'TEXT', 'text', HAS, lines, 'Tabby', 'A product line the shopper has purchased (comma list; use contains).'],
    ['bought_category', 'v_profiles', 'bought_categories', 'purchase', 'TEXT', 'text', HAS, categories, 'Handbags', 'A category the shopper has purchased (comma list; use contains).'],
    ['orders_all', 'v_profiles', 'orders_all', 'purchase', 'INTEGER', 'numeric', NUM, null, '2', 'Lifetime non-refunded orders.'],
    ['spend_all_usd', 'v_profiles', 'spend_all_usd', 'purchase', 'INTEGER', 'numeric', NUM, null, '640', 'Lifetime non-refunded spend (USD).'],
    ['aov_all_usd', 'v_profiles', 'aov_all_usd', 'purchase', 'REAL', 'numeric', NUM, null, '320', 'Average non-refunded order value, all-time (USD).'],
    ['orders_90d', 'v_profiles', 'orders_90d', 'purchase', 'INTEGER', 'numeric', NUM, null, '1', 'Orders in the last 90 days.'],
    ['spend_90d_usd', 'v_profiles', 'spend_90d_usd', 'purchase', 'INTEGER', 'numeric', NUM, null, '400', 'Spend in the last 90 days (USD).'],
    ['aov_90d_usd', 'v_profiles', 'aov_90d_usd', 'purchase', 'REAL', 'numeric', NUM, null, '400', 'Average order value, last 90 days (USD).'],
    ['last_order_ts', 'v_profiles', 'last_order_ts', 'purchase', 'INTEGER', 'numeric', NUM, null, '1782193047953', 'Epoch ms of most recent order.'],
    // identity
    ['segment', 'v_profiles', 'segments_json', 'identity', 'TEXT', 'text', HAS, segs, 'high_intent_tabby_browser', 'An ODP segment key the profile qualifies for (use contains).'],
    ['known_identity', 'v_profiles', 'customer_id', 'identity', 'TEXT', 'boolean', ['exists'], null, 'true', 'Whether the profile has a resolved customer_id.'],
  ];

  const metaCols = ['key', 'source_table', 'column_expr', 'kind', 'sql_type', 'domain_kind', 'operators', 'enum_values', 'example', 'description'];
  const metaRows = attrs.map((a) => [
    sTxt(a[0]), sTxt(a[1]), sTxt(a[2]), sTxt(a[3]), sTxt(a[4]), sTxt(a[5]),
    sTxt(JSON.stringify(a[6])), a[7] ? sTxt(JSON.stringify(a[7])) : 'NULL', sTxt(a[8]), sTxt(a[9]),
  ]);

  return { catCols, catRows, metaCols, metaRows };
}

// ==========================================================================
// FILE 0003 — coach_odp_profiles (3,200)
// ==========================================================================
function buildProfilesFile() {
  const cols = [
    'vuid', 'customer_id', 'email', 'fs_user_id', 'first_name', 'last_name', 'country', 'region', 'city',
    'locale', 'timezone', 'preferred_device', 'acquisition_channel', 'email_subscriber', 'sms_subscriber',
    'loyalty_member', 'loyalty_tier', 'first_seen_ts', 'last_seen_ts', 'session_count', 'lifetime_orders',
    'lifetime_value_usd', 'average_order_value_usd', 'favorite_line', 'preferred_category', 'preferred_price_band',
    'gifter', 'persona', 'viewed_product_line', 'product_views', 'page_views', 'category_dwell_ms', 'cart_adds',
    'wishlist_adds', 'purchases', 'price_band_viewed', 'journey_stage', 'cart_abandoned', 'sessions_since_cart',
    'email_opens', 'lifetime_product_views', 'lifetime_cart_adds', 'lifetime_purchases', 'order_likelihood',
    'engagement_rank', 'churn_risk_score', 'predicted_ltv_usd', 'segments_json',
  ];
  const rows = customers.map((c) => {
    const id = c.identifiers || {};
    const a = c.attributes || {};
    return [
      sTxt(id.vuid), sTxt(id.customer_id), sTxt(id.email), sTxt(id.fs_user_id),
      sTxt(a.first_name), sTxt(a.last_name), sTxt(a.country), sTxt(a.region), sTxt(a.city),
      sTxt(a.locale), sTxt(a.timezone), sTxt(a.preferred_device), sTxt(a.acquisition_channel),
      sBool(a.email_subscriber), sBool(a.sms_subscriber), sBool(a.loyalty_member), sTxt(a.loyalty_tier),
      sInt(a.first_seen_ts), sInt(a.last_seen_ts), sInt(a.session_count), sInt(a.lifetime_orders),
      sInt(a.lifetime_value_usd), sInt(a.average_order_value_usd), sTxt(a.favorite_line),
      sTxt(a.preferred_category), sTxt(a.preferred_price_band), sBool(a.gifter), sTxt(a.persona),
      sTxt(a.viewed_product_line), sInt(a.product_views), sInt(a.page_views), sInt(a.category_dwell_ms),
      sInt(a.cart_adds), sInt(a.wishlist_adds), sInt(a.purchases), sTxt(a.price_band_viewed),
      sTxt(a.journey_stage), sBool(a.cart_abandoned), sInt(a.sessions_since_cart), sInt(a.email_opens),
      sInt(a.lifetime_product_views), sInt(a.lifetime_cart_adds), sInt(a.lifetime_purchases),
      sReal(a.order_likelihood), sTxt(a.engagement_rank), sReal(a.churn_risk_score), sInt(a.predicted_ltv_usd),
      sTxt(JSON.stringify(c.segments || [])),
    ];
  });

  return { profCols: cols, profRows: rows };
}

// ==========================================================================
// FILE 0004 — coach_transactions (orders) + coach_purchase_items (line items)
// ==========================================================================
function buildCommerceFile() {
  const txnCols = [
    'order_id', 'vuid', 'customer_id', 'email', 'session_id', 'order_ts', 'subtotal_usd', 'discount_usd',
    'tax_usd', 'shipping_usd', 'currency', 'tender_type', 'card_network', 'card_last4', 'status', 'item_count',
    'is_gift', 'gift_wrap', 'device', 'channel', 'billing_country', 'billing_region', 'billing_postal_code',
  ];
  const itemCols = [
    'item_id', 'order_id', 'vuid', 'customer_id', 'product_id', 'product_name', 'line', 'category',
    'subcategory', 'colorway', 'unit_price_usd', 'quantity', 'price_band', 'is_gift_item', 'order_ts',
  ];

  // Tender mix (doc 10) + 'tabby' BNPL (Coach demo emphasises Tabby; real BNPL provider).
  const TENDERS = [['card', 62], ['paypal', 12], ['apple_pay', 9], ['google_pay', 5], ['affirm', 4], ['afterpay', 3], ['tabby', 3], ['gift_card', 2]];
  const CARD_NETWORKS = [['visa', 55], ['mastercard', 28], ['amex', 12], ['discover', 5]];
  const CHANNELS = [['organic_search', 26], ['paid_social', 20], ['email', 16], ['direct', 14], ['paid_search', 12], ['referral', 8], ['affiliate', 4]];
  const STATES = ['NY', 'CA', 'TX', 'FL', 'IL', 'NJ', 'PA', 'MA', 'WA', 'GA', 'VA', 'NC', 'MI', 'OH', 'AZ'];
  const isCard = (t) => t === 'card';

  const txnRows = [];
  const itemRows = [];
  let itemId = 1;

  // Determinism note: purchases are already time-sorted in events.json, so iteration
  // order is stable; the PRNG advances identically on every run.
  for (const e of purchases) {
    const d = e.data || {};
    const ids = e.identifiers || {};
    const prof = profByVuid.get(ids.vuid);
    const subtotal = Math.round(Number(d.order_total_usd) || 0);

    const tender = weightedPick(TENDERS);
    const card = isCard(tender);
    const cardNet = card ? weightedPick(CARD_NETWORKS) : null;
    const cardLast4 = card ? String(randInt(1000, 9999)) : null;
    const discount = chance(0.12) ? Math.round(subtotal * weightedPick([[0.1, 5], [0.15, 3], [0.2, 2]])) : 0;
    const tax = Math.round(0.08875 * (subtotal - discount));
    const shipping = subtotal >= 150 ? 0 : 10;
    const status = (() => { const r = rand(); return r < 0.03 ? 'refunded' : r < 0.045 ? 'partially_refunded' : 'completed'; })();
    const isGift = d.is_gift ? 1 : 0;
    const giftWrap = isGift && chance(0.6) ? 1 : 0;
    const channel = prof?.attributes?.acquisition_channel || weightedPick(CHANNELS);
    const billingRegion = prof?.attributes?.region || STATES[randInt(0, STATES.length - 1)];
    const billingZip = randInt(10001, 99950);

    txnRows.push([
      sTxt(d.order_id), sTxt(ids.vuid), sTxt(ids.customer_id), sTxt(ids.email), sTxt(e.session_id),
      sInt(e.timestamp), sInt(subtotal), sInt(discount), sInt(tax), sInt(shipping), sTxt('USD'),
      sTxt(tender), sTxt(cardNet), sTxt(cardLast4), sTxt(status), sInt(d.item_count || (d.line_items || []).length),
      sBool(isGift), sBool(giftWrap), sTxt(d.device), sTxt(channel), sTxt('usa'), sTxt(billingRegion), sInt(billingZip),
    ]);

    for (const li of d.line_items || []) {
      const cat = catById.get(li.product_id);
      const unit = Math.round(Number(li.price_usd) || (cat ? cat.price_usd : 0));
      const band = cat ? priceBand(cat.price_usd) : priceBand(unit);
      const colorway = cat && Array.isArray(cat.colors) && cat.colors.length ? cat.colors[0] : null;
      itemRows.push([
        sInt(itemId++), sTxt(li.order_id || d.order_id), sTxt(ids.vuid), sTxt(ids.customer_id),
        sTxt(li.product_id), sTxt(cat ? cat.name : li.product_name), sTxt(li.line || (cat ? cat.line : null)),
        sTxt(cat ? cat.category : null), sTxt(cat ? cat.subcategory : null), sTxt(colorway),
        sInt(unit), sInt(li.qty || 1), sTxt(band), sBool(isGift ? 1 : 0), sInt(e.timestamp),
      ]);
    }
  }

  return { txnCols, txnRows, itemCols, itemRows };
}

// --------------------------------------------------------------------------
// Assemble all INSERTs in FK-safe order, then flush into chunked part-files.
// --------------------------------------------------------------------------
const cat = buildCatalogFile();
const prof = buildProfilesFile();
const com = buildCommerceFile();

const deletes = [
  'DELETE FROM coach_purchase_items;',  // child of coach_transactions + coach_catalog
  'DELETE FROM coach_transactions;',
  'DELETE FROM coach_odp_profiles;',
  'DELETE FROM coach_catalog;',         // parent of coach_purchase_items
  'DELETE FROM meta_attribute_catalog;',
];

const statements = [
  ...emitInserts('coach_catalog', cat.catCols, cat.catRows),
  ...emitInserts('meta_attribute_catalog', cat.metaCols, cat.metaRows),
  ...emitInserts('coach_odp_profiles', prof.profCols, prof.profRows),
  ...emitInserts('coach_transactions', com.txnCols, com.txnRows),       // parent before...
  ...emitInserts('coach_purchase_items', com.itemCols, com.itemRows),   // ...child
];

const files = writeChunks(deletes, statements);

console.log(`seed-d1: wrote ${files.length} part-file(s) to migrations/seed/ (${files[0]}..${files[files.length - 1]})`);
console.log('  coach_catalog          :', cat.catRows.length);
console.log('  meta_attribute_catalog :', cat.metaRows.length);
console.log('  coach_odp_profiles     :', prof.profRows.length);
console.log('  coach_transactions     :', com.txnRows.length);
console.log('  coach_purchase_items   :', com.itemRows.length);
console.log('Apply (local):  for f in migrations/seed/*.sql; do npx wrangler d1 execute coach-demo-db --local --file="$f"; done');
