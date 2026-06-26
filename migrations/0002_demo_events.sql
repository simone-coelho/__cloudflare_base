-- =============================================================================
-- 0002_demo_events.sql  ·  Coach / Tapestry personalization demo — demo-captured
--                         event isolation + Opal union audience surface
-- =============================================================================
-- Target: Cloudflare D1 (SQLite engine). Apply with:
--   npx wrangler d1 migrations apply coach-demo-db --local      (then --remote)
--
-- WHY A SEPARATE TABLE (not a `source` column on the historical tables):
--   The brief allows either (a) a dedicated demo_events table, or (b) a
--   `source TEXT DEFAULT 'historical'` column on an existing events table. We
--   choose (a). The historical synthetic data is NOT in one "events" table — it
--   is spread across coach_odp_profiles (session snapshot), coach_transactions
--   and coach_purchase_items (orders), all consumed through v_profiles. Option
--   (b) would mean back-filling 'historical' on every one of those tables and a
--   multi-table `DELETE ... WHERE source='demo'` on a demo reset — more surfaces,
--   more ways to delete the wrong row.
--
--   With a dedicated table the safety is STRUCTURAL, not procedural: a demo reset
--   is `DELETE FROM demo_events` and is therefore *physically incapable* of
--   touching a historical row. We add the belt-and-braces `CHECK (source='demo')`
--   so the table can only ever hold demo rows. The proven seed (seed-d1.mjs,
--   v_profiles, meta_attribute_catalog) is left byte-identical — we ADD, never
--   ALTER, so no re-seed of the 3,200 / 7,293 / 8,760 historical rows is needed.
--
-- WHAT OPAL READS:
--   v_audience_base = v_profiles (historical)  UNION ALL  v_demo_profiles (demo).
--   Identical column names to v_profiles, so the estimate_audience/sample compiler
--   only swaps its FROM target (v_profiles -> v_audience_base); every condition
--   tree and the meta_attribute_catalog allow-list keep working unchanged. Demo
--   shoppers add live rows so audience sizes stay meaningful, not tiny.
-- =============================================================================


-- =============================================================================
-- 1. demo_events — the demo-run live event firehose (append-only, demo-only).
-- =============================================================================
-- Mirrors the storefront's audience-relevant signals (product_view, add_to_cart,
-- wishlist_add, page_view, search, ...). product_id is a SOFT reference to
-- coach_catalog(id) — intentionally NOT a hard FK so a stray/unknown product id
-- from a live click can never reject the capture insert (the demo must not break).
-- line / category / price_band are enriched authoritatively in v_demo_profiles by
-- LEFT JOIN to coach_catalog, so we store only what the click carried.
CREATE TABLE IF NOT EXISTS demo_events (
  id            INTEGER PRIMARY KEY,                 -- rowid alias
  event_id      TEXT,                                -- client/generated id (best-effort idempotency)
  ts            INTEGER NOT NULL,                    -- epoch MILLIS (< 2^53, safe as INTEGER)
  vuid          TEXT    NOT NULL,                    -- storefront anon id (this.anonId, e.g. 'v-AB12CD34E')
  session_id    TEXT,                                -- storefront session id (this.sessionId, e.g. 's-...')
  demo_run_id   TEXT,                                -- optional grouping for per-run reset (defaults to session_id at capture)
  event_type    TEXT    NOT NULL,                    -- product_view | add_to_cart | wishlist_add | page_view | search | ...
  product_id    TEXT,                                -- SOFT ref to coach_catalog(id); nullable, NO hard FK
  product_name  TEXT,
  line          TEXT,                                -- line as carried by the click (catalog wins in v_demo_profiles)
  price_usd     INTEGER,                             -- whole USD as carried by the click
  path          TEXT,                                -- page_view path
  label         TEXT,                                -- freeform (e.g. the search query)
  dwell_ms      INTEGER,                             -- optional dwell carried by product_view/page_view
  raw_json      TEXT,                                -- full event payload, for fidelity / replay
  -- Provenance + the structural guarantee: every row is demo, full stop.
  source        TEXT    NOT NULL DEFAULT 'demo' CHECK (source = 'demo'),
  -- ISO date for cheap "last N days" filters, consistent with the commerce tables.
  event_date    TEXT    GENERATED ALWAYS AS (date(ts/1000,'unixepoch')) STORED
) STRICT;

-- Reset + aggregation indexes.
CREATE INDEX IF NOT EXISTS idx_demo_vuid      ON demo_events(vuid);
CREATE INDEX IF NOT EXISTS idx_demo_run       ON demo_events(demo_run_id);
CREATE INDEX IF NOT EXISTS idx_demo_session   ON demo_events(session_id);
CREATE INDEX IF NOT EXISTS idx_demo_type      ON demo_events(event_type);
CREATE INDEX IF NOT EXISTS idx_demo_product   ON demo_events(product_id);
CREATE INDEX IF NOT EXISTS idx_demo_vuid_ts   ON demo_events(vuid, ts);


-- =============================================================================
-- 2. v_demo_profiles — aggregate demo_events per vuid into the SAME attribute
--    shape v_profiles exposes, so a live demo shopper unions cleanly with the
--    3,200 historical ODP profiles. Behaviour attributes are computed from the
--    captured events; profile / purchase / identity attributes are unknown for an
--    anonymous live shopper and are surfaced as NULL/0 (AVG() ignores NULLs, so
--    they never distort historical averages).
-- =============================================================================
-- Count synonyms + journey_stage thresholds mirror RealtimeSegmentEngine
-- (updateAttributesWithEvent) and JourneyStage.deriveStage EXACTLY:
--   late : cart_adds > 0 OR purchases > 0
--   mid  : product_views >= 2 OR wishlist_adds > 0 OR category_dwell_ms > 120000
--   early: otherwise
CREATE VIEW IF NOT EXISTS v_demo_profiles AS
WITH agg AS (
  SELECT
    e.vuid AS vuid,
    SUM(CASE WHEN e.event_type IN ('product_view','pdp_view','view_product') THEN 1 ELSE 0 END) AS product_views,
    SUM(CASE WHEN e.event_type IN ('page_view') THEN 1 ELSE 0 END)                              AS page_views,
    SUM(CASE WHEN e.event_type IN ('add_to_cart','cart_add') THEN 1 ELSE 0 END)                 AS cart_adds,
    SUM(CASE WHEN e.event_type IN ('wishlist_add','wishlist','add_to_wishlist','save_for_later') THEN 1 ELSE 0 END) AS wishlist_adds,
    SUM(CASE WHEN e.event_type IN ('purchase','checkout','order_complete') THEN 1 ELSE 0 END)   AS purchases,
    COALESCE(SUM(e.dwell_ms), 0)                                                                AS category_dwell_ms
  FROM demo_events e
  GROUP BY e.vuid
)
SELECT
  a.vuid                                                            AS vuid,
  NULL                                                             AS customer_id,
  -- latest viewed line (catalog-authoritative, fallback to the click's own line)
  (SELECT COALESCE(c2.line, e2.line)
     FROM demo_events e2 LEFT JOIN coach_catalog c2 ON c2.id = e2.product_id
    WHERE e2.vuid = a.vuid AND COALESCE(c2.line, e2.line) IS NOT NULL
    ORDER BY e2.ts DESC LIMIT 1)                                    AS viewed_product_line,
  CASE
    WHEN a.cart_adds > 0 OR a.purchases > 0                         THEN 'late'
    WHEN a.product_views >= 2 OR a.wishlist_adds > 0 OR a.category_dwell_ms > 120000 THEN 'mid'
    ELSE 'early'
  END                                                              AS journey_stage,
  a.product_views                                                  AS product_views,
  a.page_views                                                     AS page_views,
  a.cart_adds                                                      AS cart_adds,
  a.wishlist_adds                                                  AS wishlist_adds,
  CASE WHEN a.cart_adds > 0 AND a.purchases = 0 THEN 1 ELSE 0 END  AS cart_abandoned,
  -- latest viewed price band (catalog-authoritative, fallback to the click's price)
  (SELECT CASE
            WHEN COALESCE(c3.price_usd, e3.price_usd) IS NULL THEN NULL
            WHEN COALESCE(c3.price_usd, e3.price_usd) < 150 THEN 'entry'
            WHEN COALESCE(c3.price_usd, e3.price_usd) < 400 THEN 'core'
            ELSE 'elevated' END
     FROM demo_events e3 LEFT JOIN coach_catalog c3 ON c3.id = e3.product_id
    WHERE e3.vuid = a.vuid AND COALESCE(c3.price_usd, e3.price_usd) IS NOT NULL
    ORDER BY e3.ts DESC LIMIT 1)                                    AS price_band_viewed,
  -- profile aggregates / predictions: unknown for an anonymous live shopper
  NULL AS favorite_line,
  NULL AS preferred_category,
  NULL AS preferred_price_band,
  NULL AS loyalty_tier,
  NULL AS loyalty_member,
  NULL AS gifter,
  NULL AS engagement_rank,
  NULL AS order_likelihood,
  NULL AS churn_risk_score,
  NULL AS predicted_ltv_usd,
  NULL AS lifetime_value_usd,
  NULL AS average_order_value_usd,
  NULL AS lifetime_orders,
  NULL AS persona,
  NULL AS country,
  NULL AS region,
  NULL AS segments_json,
  -- purchase aggregates: a live demo shopper has no completed order history
  NULL AS bought_lines,
  NULL AS bought_categories,
  0    AS orders_all,
  NULL AS spend_all_usd,
  NULL AS aov_all_usd,
  0    AS orders_90d,
  0    AS spend_90d_usd,
  NULL AS aov_90d_usd,
  NULL AS last_order_ts
FROM agg a;


-- =============================================================================
-- 3. v_audience_base — the UNION surface Opal builds audiences over.
--    Historical (v_profiles) UNION ALL demo (v_demo_profiles), tagged by `source`.
--    Column list is explicit and identical in both branches so the union is well
--    defined; names match v_profiles, so the condition compiler only needs to
--    point its FROM at v_audience_base instead of v_profiles.
-- =============================================================================
CREATE VIEW IF NOT EXISTS v_audience_base AS
SELECT
  vuid, 'historical' AS source, customer_id,
  viewed_product_line, journey_stage, product_views, page_views, cart_adds,
  wishlist_adds, cart_abandoned, price_band_viewed,
  favorite_line, preferred_category, preferred_price_band, loyalty_tier,
  loyalty_member, gifter, engagement_rank, order_likelihood, churn_risk_score,
  predicted_ltv_usd, lifetime_value_usd, average_order_value_usd, lifetime_orders,
  persona, country, region, segments_json,
  bought_lines, bought_categories, orders_all, spend_all_usd, aov_all_usd,
  orders_90d, spend_90d_usd, aov_90d_usd, last_order_ts
FROM v_profiles
UNION ALL
SELECT
  vuid, 'demo' AS source, customer_id,
  viewed_product_line, journey_stage, product_views, page_views, cart_adds,
  wishlist_adds, cart_abandoned, price_band_viewed,
  favorite_line, preferred_category, preferred_price_band, loyalty_tier,
  loyalty_member, gifter, engagement_rank, order_likelihood, churn_risk_score,
  predicted_ltv_usd, lifetime_value_usd, average_order_value_usd, lifetime_orders,
  persona, country, region, segments_json,
  bought_lines, bought_categories, orders_all, spend_all_usd, aov_all_usd,
  orders_90d, spend_90d_usd, aov_90d_usd, last_order_ts
FROM v_demo_profiles;

-- =============================================================================
-- END 0002_demo_events.sql
-- =============================================================================
