-- =============================================================================
-- 0001_d1_init.sql  ·  Coach / Tapestry personalization demo — Cloudflare D1 schema
-- =============================================================================
-- Target: Cloudflare D1 (SQLite engine). Apply with:
--   npx wrangler d1 migrations apply coach_demo --local      (then --remote)
--
-- DESIGN NOTES (see docs/architecture/10-d1-schema.md for the full writeup):
--   * STRICT tables everywhere — D1 best practice to avoid type drift
--     (https://developers.cloudflare.com/d1/best-practices/query-d1/).
--     STRICT allows only INT/INTEGER/REAL/TEXT/BLOB/ANY; booleans are stored
--     as INTEGER 0/1 (D1 casts JS booleans to INTEGER:
--     https://developers.cloudflare.com/d1/worker-api/).
--   * 64-bit "snowflake" ids (event_id, session_id, zaius_id ≈ 3.8e18) are
--     stored as TEXT, not INTEGER. The D1 Workers API has no BigInt and is only
--     safe to Number.MAX_SAFE_INTEGER (2^53 ≈ 9.0e15); storing those ids as
--     INTEGER would silently lose precision when read in the Worker.
--     (https://developers.cloudflare.com/d1/worker-api/) Ids comfortably under
--     2^53 (account_id 2.7e10, activation_id 1.8e12, epoch-ms 1.8e12) stay INTEGER.
--   * Generated columns (STORED) are used for deterministic derivations
--     (price_band, line_total_usd, order_date) — supported by D1
--     (https://developers.cloudflare.com/d1/sql-api/sql-statements/).
--   * Timestamps: source carries epoch (s/ms) + a display string. We keep the
--     epoch as the sortable truth and add a STORED `order_date` (ISO date) so the
--     chat can answer "last 90 days" with date('now','-90 days').
--
-- PER-TABLE CONVENTIONS (preserved from docs/architecture/coach_synthetic_schema.json
--   x-conventions — do NOT normalize across tables):
--   * country : odp_events = ISO-3 lowercase ('usa'); odp_customers_authenticated
--               = full name ('United States'); coach_odp_profiles / commerce =
--               ISO-2 ('US') as carried by data/synthetic/customers.json.
--   * ip      : odp_events stores the FULL ipv4; conversions/decisions ANONYMIZE
--               (last octet .0). Commerce tables carry NO ip (PII minimization).
--   * sparsity: low population on PII/enrichment is SIGNAL (anonymous-first; few
--               authenticate). Nullable columns below are meant to stay mostly
--               NULL — do not over-fill on seed.
--   * nested_json: conversions/decisions attributes/layer_states/experiments keep
--               the Optimizely BigQuery wrapper {"v":[{"v":{"f":[...]}}]} as TEXT.
-- =============================================================================


-- =============================================================================
-- SECTION A — Coach commerce + product dimension (NEW; the demo enrichment)
-- =============================================================================

-- A1. Product dimension — seeded verbatim from data/coach-catalog.json (71 SKUs).
--     Gives coach_purchase_items.product_id a REAL foreign key to enforce
--     "tied to real catalog product ids".
CREATE TABLE IF NOT EXISTS coach_catalog (
  id            TEXT    PRIMARY KEY,                 -- 'COA-<style_code>' e.g. COA-CH857
  style_code    TEXT    NOT NULL,                    -- real Coach SKU code, e.g. CH857
  name          TEXT    NOT NULL,                    -- 'Tabby Shoulder Bag 26'
  line          TEXT    NOT NULL,                    -- Tabby | Pillow Tabby | Brooklyn | Lana | ...
  category      TEXT    NOT NULL,                    -- Handbags | Small Leather Goods | Accessories
  subcategory   TEXT,                                -- Shoulder Bags | Crossbody Bags | Wallets | ...
  price_usd     INTEGER NOT NULL,                    -- whole-dollar Coach pricing (65..795)
  currency      TEXT    NOT NULL DEFAULT 'USD',
  material      TEXT,                                -- 'Polished pebble leather'
  silhouette    TEXT,                                -- shoulder | crossbody | tote | ...
  size          TEXT,                                -- '26 (medium)'
  lead_color    TEXT,                                -- colors[0] (default colorway)
  colors_json   TEXT,                                -- JSON array of colorways
  occasion_json TEXT,                                -- JSON array of occasion tags
  image_url     TEXT,                                -- coach.scene7.com/... (constructed)
  product_url   TEXT,                                -- coach.com canonical (real where scraped)
  region        TEXT    NOT NULL DEFAULT 'North America',
  in_stock      INTEGER NOT NULL DEFAULT 1,          -- 0/1
  -- derived band used by sort/targeting/insights (entry<150, core<400, else elevated)
  price_band    TEXT    GENERATED ALWAYS AS (
                  CASE WHEN price_usd < 150 THEN 'entry'
                       WHEN price_usd < 400 THEN 'core'
                       ELSE 'elevated' END) STORED
) STRICT;

-- A2. (a) TRANSACTIONS / PAYMENTS — one row per order (order header).
--     Derived from data/synthetic/events.json purchase events (7,293 orders),
--     enriched with payment fields (tender, tax/shipping, status) at seed time.
--     vuid is a SOFT reference to coach_odp_profiles (orders may exist for vuids
--     outside the profile sample) so it is intentionally NOT a hard FK.
CREATE TABLE IF NOT EXISTS coach_transactions (
  order_id        TEXT    PRIMARY KEY,               -- 'ord_000136_2_4' (from purchase event)
  vuid            TEXT    NOT NULL,                  -- ODP visitor id — always present (anon-first)
  customer_id     TEXT,                              -- resolved on sign-in; SPARSE
  email           TEXT,                              -- SPARSE (known identities only)
  session_id      TEXT,                              -- 'sess_000136_2'
  order_ts        INTEGER NOT NULL,                  -- epoch MILLIS (< 2^53, safe as INTEGER)
  -- money: subtotal is whole-dollar (matches order_total_usd); tax/ship/discount
  -- added at seed; amount_usd is the gross charged total (generated for integrity).
  -- All money is INTEGER whole USD: matches the whole-dollar source data
  -- (order_total_usd) and the INTEGER profile AOV, and is fully STRICT-safe with
  -- STORED generated columns across all SQLite/D1 versions (a REAL generated total
  -- hits a STRICT-table bug in SQLite < 3.38). Cents are unnecessary for the demo.
  subtotal_usd    INTEGER NOT NULL,                  -- sum of line items, whole USD
  discount_usd    INTEGER NOT NULL DEFAULT 0,
  tax_usd         INTEGER NOT NULL DEFAULT 0,
  shipping_usd    INTEGER NOT NULL DEFAULT 0,
  amount_usd      INTEGER GENERATED ALWAYS AS
                    (subtotal_usd - discount_usd + tax_usd + shipping_usd) STORED,
  currency        TEXT    NOT NULL DEFAULT 'USD',
  tender_type     TEXT    NOT NULL,                  -- card|paypal|apple_pay|google_pay|affirm|afterpay|gift_card
  card_network    TEXT,                              -- visa|mastercard|amex|discover (NULL for wallets/BNPL)
  card_last4      TEXT,                              -- '4242' (NULL for wallets/BNPL/gift_card)
  status          TEXT    NOT NULL DEFAULT 'completed', -- completed|refunded|partially_refunded
  item_count      INTEGER NOT NULL,
  is_gift         INTEGER NOT NULL DEFAULT 0,        -- 0/1
  gift_wrap       INTEGER NOT NULL DEFAULT 0,        -- 0/1 (Coach signature box) — subset of is_gift
  device          TEXT,                              -- desktop|mobile|tablet
  channel         TEXT,                              -- acquisition channel of the order session
  billing_country TEXT,                              -- ISO-3 lowercase ('usa') — ODP-Events convention
  billing_region  TEXT,                              -- e.g. 'NY'
  billing_postal_code INTEGER,
  -- ISO date for cheap "last N days" filters (date('now','-90 days'))
  order_date      TEXT    GENERATED ALWAYS AS (date(order_ts/1000,'unixepoch')) STORED
) STRICT;

-- A3. (b) PURCHASE HISTORY (line items) — one row per product per order.
--     Tied to REAL catalog ids via FK to coach_catalog(id). line/category/
--     price_band are denormalized from the catalog so "bought Tabby" needs no join.
CREATE TABLE IF NOT EXISTS coach_purchase_items (
  item_id        INTEGER PRIMARY KEY,                -- rowid alias (autoincrement-ish)
  order_id       TEXT    NOT NULL REFERENCES coach_transactions(order_id),
  vuid           TEXT    NOT NULL,                   -- denormalized for per-shopper queries
  customer_id    TEXT,                               -- denormalized; SPARSE
  product_id     TEXT    NOT NULL REFERENCES coach_catalog(id),  -- REAL catalog id
  product_name   TEXT,
  line           TEXT    NOT NULL,                   -- denormalized (Tabby, Brooklyn, ...)
  category       TEXT,
  subcategory    TEXT,
  colorway       TEXT,
  unit_price_usd INTEGER NOT NULL,                   -- whole USD
  quantity       INTEGER NOT NULL DEFAULT 1,
  line_total_usd INTEGER GENERATED ALWAYS AS (unit_price_usd * quantity) STORED,
  price_band     TEXT,                               -- entry|core|elevated (from catalog)
  is_gift_item   INTEGER NOT NULL DEFAULT 0,         -- 0/1
  order_ts       INTEGER NOT NULL,                   -- denormalized epoch ms
  order_date     TEXT    GENERATED ALWAYS AS (date(order_ts/1000,'unixepoch')) STORED
) STRICT;


-- =============================================================================
-- SECTION B — Coach ODP runtime profile (the chat's PRIMARY reasoning surface)
-- =============================================================================
-- Seeded from data/synthetic/customers.json (3,200 profiles). This is the live
-- ODP profile the edge engine evaluates audience conditions against; column names
-- match src/connectors/types.ts QualificationContext.attributes 1:1 (a contract —
-- see data/synthetic/README.md "Field-name contract"). The four export tables in
-- Section C are the warehouse-export *shape*; THIS is the working profile.
CREATE TABLE IF NOT EXISTS coach_odp_profiles (
  vuid                   TEXT    PRIMARY KEY,        -- ODP visitor id (always present)
  customer_id            TEXT,                       -- resolved on sign-in; SPARSE (anon-first)
  email                  TEXT,                       -- SPARSE
  fs_user_id             TEXT,                       -- SPARSE (cross-system id)
  -- (a) demographic / marketing / lifetime aggregates
  first_name             TEXT,                       -- SPARSE PII
  last_name              TEXT,                       -- SPARSE PII
  country                TEXT,                       -- ISO-2 'US' (customers.json convention)
  region                 TEXT,
  city                   TEXT,
  locale                 TEXT,
  timezone               TEXT,
  preferred_device       TEXT,                       -- desktop|mobile|tablet
  acquisition_channel    TEXT,                       -- organic|paid_social|email|referral|direct
  email_subscriber       INTEGER,                    -- 0/1
  sms_subscriber         INTEGER,                    -- 0/1
  loyalty_member         INTEGER,                    -- 0/1
  loyalty_tier           TEXT,                       -- member|silver|gold|platinum
  first_seen_ts          INTEGER,                    -- epoch ms
  last_seen_ts           INTEGER,                    -- epoch ms
  session_count          INTEGER,
  lifetime_orders        INTEGER,
  lifetime_value_usd     INTEGER,
  average_order_value_usd INTEGER,                   -- profile AOV (chat's avg_order_value source)
  favorite_line          TEXT,                       -- Tabby | Brooklyn | ...
  preferred_category     TEXT,
  preferred_price_band   TEXT,                       -- entry|core|elevated
  gifter                 INTEGER,                    -- 0/1
  persona                TEXT,                       -- demo metadata (tabby_enthusiast, window_shopper, ...)
  -- (b) real-time session snapshot — the engine's qualification attributes
  viewed_product_line    TEXT,
  product_views          INTEGER,
  page_views             INTEGER,
  category_dwell_ms      INTEGER,
  cart_adds              INTEGER,
  wishlist_adds          INTEGER,
  purchases              INTEGER,
  price_band_viewed      TEXT,
  journey_stage          TEXT,                       -- early|mid|late
  cart_abandoned         INTEGER,                    -- 0/1
  sessions_since_cart    INTEGER,
  email_opens            INTEGER,
  lifetime_product_views INTEGER,
  lifetime_cart_adds     INTEGER,
  lifetime_purchases     INTEGER,
  -- (c) ODP insight-style predictions
  order_likelihood       REAL,                       -- 0..1
  engagement_rank        TEXT,                       -- low|medium|high|vip
  churn_risk_score       REAL,                       -- 0..1
  predicted_ltv_usd      INTEGER,
  -- persisted ODP segment keys this snapshot qualifies for (JSON array of strings)
  segments_json          TEXT
) STRICT;


-- =============================================================================
-- SECTION C — Optimizely / ODP warehouse-export mirror (the fidelity layer)
-- =============================================================================
-- Faithful to docs/architecture/coach_synthetic_schema.json (POPULATED columns
-- only; the ~63–74% empty superset columns are intentionally omitted — treat as
-- schema-present null). Re-themed to Coach at seed time (coach.com pages, etc.),
-- conventions preserved per-table.

-- C1. ODP Events (sheet 'ODP Events') — 58 populated cols. country = ISO-3
--     lowercase; ip = FULL ipv4. event_id/session_id/zaius_id = TEXT (>2^53).
CREATE TABLE IF NOT EXISTS odp_events (
  _fivetran_id              TEXT    PRIMARY KEY,      -- hex32
  event_id                  TEXT    NOT NULL,         -- 64-bit id → TEXT (precision)
  session_id                TEXT    NOT NULL,         -- 64-bit id → TEXT (precision)
  zaius_id                  TEXT    NOT NULL,         -- 64-bit id → TEXT (precision)
  vuid                      TEXT    NOT NULL,         -- hex32 (joins coach_odp_profiles.vuid)
  ts                        INTEGER NOT NULL,         -- epoch seconds
  zaius_ts_received_ms      INTEGER NOT NULL,         -- epoch millis
  event_type                TEXT    NOT NULL,         -- pageview | scroll_depth | ...
  -- geo / network (FULL ip per ODP-Events convention)
  ip                        TEXT    NOT NULL,         -- full ipv4
  country                   TEXT    NOT NULL,         -- ISO-3 lowercase: 'usa','can','mex'
  region                    TEXT    NOT NULL,
  postal_code               INTEGER NOT NULL,
  isp                       TEXT    NOT NULL,
  -- page / referrer
  hostname                  TEXT    NOT NULL,         -- 'www.coach.com'
  page                      TEXT    NOT NULL,         -- '/products/tabby-shoulder-bag-26/CH857.html'
  title                     TEXT    NOT NULL,
  referrer                  TEXT,                     -- pop 0.9
  referral_host             TEXT,                     -- pop 0.9
  referral_path             TEXT,                     -- pop 0.9
  source                    TEXT    NOT NULL,         -- google | direct | ...
  medium                    TEXT    NOT NULL,         -- organic | referral | none
  -- device / client
  browser                   TEXT    NOT NULL,
  browser_version           TEXT    NOT NULL,
  os                        TEXT    NOT NULL,
  os_version                TEXT    NOT NULL,
  device_type               TEXT    NOT NULL,         -- PC | Phone
  model                     TEXT,                     -- pop 0.5
  mobile                    INTEGER NOT NULL,         -- 0/1
  resolution                TEXT    NOT NULL,
  viewport                  TEXT    NOT NULL,
  viewport_height           REAL,                     -- pop 0.6
  color_depth               TEXT    NOT NULL,
  character_set             TEXT    NOT NULL,
  language                  TEXT    NOT NULL,
  java                      INTEGER NOT NULL,         -- 0/1
  browser_dnt               INTEGER,                  -- 0/1, pop 0.1
  new_user                  INTEGER NOT NULL,         -- 0/1
  active_event              INTEGER NOT NULL,         -- 0/1
  interaction               INTEGER NOT NULL,
  -- scroll / engagement (nullable, sparse)
  scroll_depth_pixels       REAL,                     -- pop 0.6
  scroll_depth_percentage   REAL,                     -- pop 0.6
  is_final_depth            INTEGER,                  -- 0/1, pop 0.6
  document_height           REAL,                     -- pop 0.6
  landing                   INTEGER,                  -- 0/1, pop 0.3
  days_since_last_visit     REAL,                     -- pop 0.1
  -- performance timings (sparse)
  server_response_time      REAL,                     -- pop 0.4
  page_download_time        REAL,                     -- pop 0.4
  domain_lookup_time        REAL,                     -- pop 0.2
  server_connect_time       REAL,                     -- pop 0.2
  -- data-source provenance
  data_source               TEXT    NOT NULL,         -- 'JavaScript'
  data_source_type          TEXT    NOT NULL,         -- 'sdk'
  data_source_instance      TEXT    NOT NULL,         -- 'www.coach.com'
  data_source_version       TEXT    NOT NULL,
  -- cross-system ids (sparse)
  event_sixsense_vuid_hash_id TEXT,                   -- uuid, pop 0.4
  event_opti_exp_cookie_id  TEXT,                     -- 'oeu{ms}r{rand}', pop 0.4
  -- fivetran bookkeeping
  _fivetran_deleted         INTEGER NOT NULL,         -- 0/1
  _fivetran_synced          TEXT    NOT NULL,         -- recommend ISO 8601 on seed
  zaius_ts_received         TEXT    NOT NULL          -- recommend ISO 8601 on seed
) STRICT;

-- C2. ODP Customers (authenticated) (sheet 'ODP Customers (authenticated)') —
--     36 populated cols. country = FULL name. B2B-flavoured enrichment is SPARSE.
CREATE TABLE IF NOT EXISTS odp_customers_authenticated (
  _fivetran_id                     TEXT    PRIMARY KEY,  -- hex32
  zaius_id                         TEXT    NOT NULL,     -- 64-bit id → TEXT (precision)
  vuid                             TEXT,                 -- hex32, pop 0.9
  last_modified_at                 INTEGER NOT NULL,     -- epoch seconds
  -- identity / PII (SPARSE — few authenticate)
  first_name                       TEXT,                 -- pop 0.1
  last_name                        TEXT,                 -- pop 0.1
  name                             TEXT,                 -- pop 0.1
  email                            TEXT,                 -- pop 0.1
  gender                           TEXT,                 -- pop 0.1
  country                          TEXT,                 -- FULL name ('United States'), pop 0.1
  job_title                        TEXT,                 -- pop 0.1
  company_name                     TEXT,                 -- pop 0.1
  -- optimizely visitor / content-intelligence ids
  opti_exp_cookie_id               TEXT,                 -- pop 0.8
  content_intelligence_id          TEXT,                 -- uuid, pop 0.3
  -- 6sense B2B enrichment (SPARSE)
  sixsense_vuid_hash_id            TEXT,                 -- uuid, pop 0.8
  sixsense_company_region          TEXT,                 -- pop 0.3
  sixsense_company_state           TEXT,                 -- pop 0.3
  sixsense_company_name            TEXT,                 -- pop 0.3
  sixsense_industry                TEXT,                 -- pop 0.3
  sixsense_confidence              TEXT,                 -- pop 0.1
  sixsense_naics                   REAL,                 -- pop 0.3
  sixsense_sic                     REAL,                 -- pop 0.3
  sixsense_annual_revenue          REAL,                 -- pop 0.1
  sixsense_annual_company_revenue  REAL,                 -- pop 0.2
  sixsense_employee_count          REAL,                 -- pop 0.1
  -- salesforce CRM sync (SPARSE)
  salesforce_crm_sync_lead_id      TEXT,                 -- pop 0.1
  salesforce_crm_sync_lead_status  TEXT,                 -- pop 0.1
  salesforce_crm_sync_is_lead      INTEGER,              -- 0/1, pop 0.1
  salesforce_crm_sync_is_converted INTEGER,              -- 0/1, pop 0.1
  -- data-source provenance
  data_source                      TEXT    NOT NULL,     -- JavaScript | profiles
  data_source_type                 TEXT    NOT NULL,     -- sdk | api
  data_source_instance             TEXT    NOT NULL,     -- www.coach.com | api
  data_source_version              TEXT    NOT NULL,
  data_source_details              TEXT,                 -- pop 0.1
  -- fivetran bookkeeping
  _fivetran_deleted                INTEGER NOT NULL,     -- 0/1
  _fivetran_synced                 TEXT    NOT NULL      -- recommend ISO 8601 on seed
) STRICT;

-- C3. conversions (sheet 'conversions') — 22 populated cols. ip ANONYMIZED (.0).
--     attributes/tags/properties/layer_states/experiments keep the Optimizely
--     BigQuery wrapper {"v":[{"v":{"f":[...]}}]} as TEXT.
CREATE TABLE IF NOT EXISTS conversions (
  uuid              TEXT    PRIMARY KEY,              -- uuid4
  timestamp         TEXT    NOT NULL,                -- recommend ISO 8601 on seed
  process_timestamp TEXT    NOT NULL,                -- recommend ISO 8601 on seed
  account_id        INTEGER NOT NULL,                -- 2.69e10 (< 2^53)
  project_id        INTEGER NOT NULL,
  visitor_id        TEXT    NOT NULL,                -- 'oeu{ms}r{rand}'
  activation_id     INTEGER NOT NULL,                -- 1.78e12 (< 2^53)
  session_id        TEXT    NOT NULL,                -- 'AUTO'
  entity_id         REAL,                            -- float in source, pop 0.5
  event_type        TEXT    NOT NULL,                -- view_activated | client_activation
  event_name        TEXT,                            -- pop 0.5
  user_ip           TEXT    NOT NULL,                -- ANONYMIZED ipv4 (last octet .0)
  user_agent        TEXT    NOT NULL,
  anonymize_ip      INTEGER NOT NULL,                -- 0/1 (True in source)
  client_engine     TEXT    NOT NULL,                -- 'js'
  client_version    TEXT    NOT NULL,
  revision          INTEGER NOT NULL,
  attributes        TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  tags              TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  properties        TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  layer_states      TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  experiments       TEXT    NOT NULL                 -- Optimizely BQ wrapper JSON (exp_id→var_id consistent)
) STRICT;

-- C4. decisions (sheet 'decisions') — 22 populated cols. Same shape/conventions
--     as conversions; ip ANONYMIZED.
CREATE TABLE IF NOT EXISTS decisions (
  uuid              TEXT    PRIMARY KEY,              -- uuid4
  timestamp         TEXT    NOT NULL,                -- recommend ISO 8601 on seed
  process_timestamp TEXT    NOT NULL,                -- recommend ISO 8601 on seed
  account_id        INTEGER NOT NULL,
  project_id        INTEGER NOT NULL,
  visitor_id        TEXT    NOT NULL,                -- 'oeu{ms}r{rand}'
  activation_id     INTEGER NOT NULL,
  session_id        TEXT    NOT NULL,                -- 'AUTO'
  entity_id         REAL,                            -- float in source, pop 0.3
  event_type        TEXT    NOT NULL,                -- client_activation | view_activated
  event_name        TEXT,                            -- pop 0.3
  user_ip           TEXT    NOT NULL,                -- ANONYMIZED ipv4 (last octet .0)
  user_agent        TEXT    NOT NULL,
  anonymize_ip      INTEGER NOT NULL,                -- 0/1
  client_engine     TEXT    NOT NULL,                -- 'js'
  client_version    TEXT    NOT NULL,
  revision          INTEGER NOT NULL,
  attributes        TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  tags              TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  properties        TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  layer_states      TEXT    NOT NULL,                -- Optimizely BQ wrapper JSON
  experiments       TEXT    NOT NULL                 -- Optimizely BQ wrapper JSON
) STRICT;


-- =============================================================================
-- SECTION D — Chat tool surface support: attribute allow-list + profile view
-- =============================================================================

-- D1. meta_attribute_catalog — backs list_attributes() AND is the WHITELIST the
--     condition compiler validates every attribute against (anything not here is
--     rejected before SQL is built — the injection guard). Seeded in 0002.
CREATE TABLE IF NOT EXISTS meta_attribute_catalog (
  key          TEXT    PRIMARY KEY,                  -- attribute name used in conditions
  source_table TEXT    NOT NULL,                     -- v_profiles | coach_purchase_items | ...
  column_expr  TEXT    NOT NULL,                     -- the SQL column/expr it maps to
  kind         TEXT    NOT NULL,                     -- profile | behavior | purchase | product | identity
  sql_type     TEXT    NOT NULL,                     -- INTEGER | REAL | TEXT
  domain_kind  TEXT    NOT NULL,                     -- enum | numeric | boolean | text
  operators    TEXT    NOT NULL,                     -- JSON array: ["eq","in","gte",...]
  enum_values  TEXT,                                 -- JSON array (NULL for numeric/text)
  example      TEXT,                                 -- human example value
  description  TEXT
) STRICT;

-- D2. v_profiles — the single surface estimate_audience() and sample() read.
--     Joins the ODP profile to per-shopper purchase aggregates (lifetime + 90-day)
--     so conditions can mix behaviour, predictions, and purchase facts in one WHERE.
--     'last 90 days' is relative to date('now'); demo data is anchored to ~now
--     (generator EPOCH_NOW = 2026-06-25).
CREATE VIEW IF NOT EXISTS v_profiles AS
SELECT
  p.*,
  COALESCE(t.orders_all, 0)            AS orders_all,
  t.last_order_ts                      AS last_order_ts,
  t.spend_all_usd                      AS spend_all_usd,
  t.aov_all_usd                        AS aov_all_usd,
  COALESCE(t90.orders_90d, 0)          AS orders_90d,
  COALESCE(t90.spend_90d_usd, 0)       AS spend_90d_usd,
  t90.aov_90d_usd                      AS aov_90d_usd,
  bl.bought_lines                      AS bought_lines,        -- comma list for 'contains'
  bl.bought_categories                 AS bought_categories
FROM coach_odp_profiles p
LEFT JOIN (
  SELECT vuid,
         COUNT(*)         AS orders_all,
         SUM(amount_usd)  AS spend_all_usd,
         AVG(amount_usd)  AS aov_all_usd,
         MAX(order_ts)    AS last_order_ts
  FROM coach_transactions
  WHERE status <> 'refunded'
  GROUP BY vuid
) t   ON t.vuid = p.vuid
LEFT JOIN (
  SELECT vuid,
         COUNT(*)         AS orders_90d,
         SUM(amount_usd)  AS spend_90d_usd,
         AVG(amount_usd)  AS aov_90d_usd
  FROM coach_transactions
  WHERE status <> 'refunded'
    AND order_date >= date('now','-90 days')
  GROUP BY vuid
) t90 ON t90.vuid = p.vuid
LEFT JOIN (
  SELECT vuid,
         group_concat(DISTINCT line)     AS bought_lines,
         group_concat(DISTINCT category) AS bought_categories
  FROM coach_purchase_items
  GROUP BY vuid
) bl  ON bl.vuid = p.vuid;


-- =============================================================================
-- SECTION E — Indexes (query-surface performance)
-- =============================================================================
-- Commerce / profile: support estimate_audience() filters + v_profiles joins.
CREATE INDEX IF NOT EXISTS idx_txn_vuid           ON coach_transactions(vuid);
CREATE INDEX IF NOT EXISTS idx_txn_orderdate      ON coach_transactions(order_date);
CREATE INDEX IF NOT EXISTS idx_txn_tender         ON coach_transactions(tender_type);
CREATE INDEX IF NOT EXISTS idx_txn_cust           ON coach_transactions(customer_id) WHERE customer_id IS NOT NULL; -- partial: known identities
CREATE INDEX IF NOT EXISTS idx_txn_vuid_date      ON coach_transactions(vuid, order_date);

CREATE INDEX IF NOT EXISTS idx_items_order        ON coach_purchase_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_vuid         ON coach_purchase_items(vuid);
CREATE INDEX IF NOT EXISTS idx_items_product      ON coach_purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_items_line         ON coach_purchase_items(line);              -- "bought Tabby"
CREATE INDEX IF NOT EXISTS idx_items_line_vuid    ON coach_purchase_items(line, vuid);

CREATE INDEX IF NOT EXISTS idx_cat_line           ON coach_catalog(line);
CREATE INDEX IF NOT EXISTS idx_cat_category       ON coach_catalog(category);
CREATE INDEX IF NOT EXISTS idx_cat_band           ON coach_catalog(price_band);

CREATE INDEX IF NOT EXISTS idx_prof_favline       ON coach_odp_profiles(favorite_line);
CREATE INDEX IF NOT EXISTS idx_prof_viewedline    ON coach_odp_profiles(viewed_product_line);
CREATE INDEX IF NOT EXISTS idx_prof_journey       ON coach_odp_profiles(journey_stage);
CREATE INDEX IF NOT EXISTS idx_prof_engagement    ON coach_odp_profiles(engagement_rank);
CREATE INDEX IF NOT EXISTS idx_prof_loyalty       ON coach_odp_profiles(loyalty_tier);
CREATE INDEX IF NOT EXISTS idx_prof_band          ON coach_odp_profiles(preferred_price_band);
CREATE INDEX IF NOT EXISTS idx_prof_persona       ON coach_odp_profiles(persona);
CREATE INDEX IF NOT EXISTS idx_prof_aov           ON coach_odp_profiles(average_order_value_usd);
CREATE INDEX IF NOT EXISTS idx_prof_known         ON coach_odp_profiles(customer_id) WHERE customer_id IS NOT NULL; -- partial

-- Export mirror: join/filter keys only (kept modest).
CREATE INDEX IF NOT EXISTS idx_oe_vuid            ON odp_events(vuid);
CREATE INDEX IF NOT EXISTS idx_oe_ts              ON odp_events(ts);
CREATE INDEX IF NOT EXISTS idx_oe_eventtype       ON odp_events(event_type);
CREATE INDEX IF NOT EXISTS idx_oe_country         ON odp_events(country);
CREATE INDEX IF NOT EXISTS idx_oca_vuid           ON odp_customers_authenticated(vuid);
CREATE INDEX IF NOT EXISTS idx_oca_email          ON odp_customers_authenticated(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_visitor       ON conversions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_dec_visitor        ON decisions(visitor_id);

-- =============================================================================
-- END 0001_d1_init.sql
-- =============================================================================
