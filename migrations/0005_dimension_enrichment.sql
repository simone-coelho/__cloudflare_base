-- =============================================================================
-- 0005_dimension_enrichment.sql · P5 — silhouette / subcategory / occasion
--                                 dimensions on the DURABLE data surface
-- =============================================================================
-- WHY (docs/architecture/16-edge-affinity-reflex.md §13 P5; fidelity audit 2026-07-08):
--   The Edge Affinity Reflex already scores silhouette/subcategory/occasion LIVE
--   (generator audiences like "Tote Affinity" exist in KV), but the durable
--   D1/Opal surface only carried line + category + price band — so Opal could
--   not build a first-class "Tote Affinity"-style audience over v_audience_base.
--   This migration closes that gap: capture → rollup → whitelist.
--
-- Semantics (stated honestly, mirrored in meta descriptions):
--   • demo (live) shoppers: latest VIEWED silhouette/subcategory/occasions,
--     catalog-authoritative with click-carried fallback (the 0002 pattern).
--   • historical profiles: the synthetic view-level rollup was not retained at
--     seed time, so values derive from PURCHASES (modal purchased silhouette/
--     subcategory; occasion tags of purchased items). Documented in the
--     attribute descriptions.
-- Apply: npx wrangler d1 migrations apply coach-demo-db --local (then --remote)
-- =============================================================================

-- 1. demo_events — carry the flattened dimensions on the captured row (server-
--    enriched from coach_catalog at capture time; self-contained for direct
--    demo_events queries and a fallback when a stray product id misses the join).
ALTER TABLE demo_events ADD COLUMN silhouette  TEXT;
ALTER TABLE demo_events ADD COLUMN subcategory TEXT;
ALTER TABLE demo_events ADD COLUMN occasions   TEXT;  -- comma list, e.g. 'evening,date-night'

-- 2. Rebuild the demo rollup + the union surface with the three new attributes.
--    (SQLite has no CREATE OR REPLACE VIEW — drop then recreate; column lists in
--    the union stay explicit and identical in both branches.)
DROP VIEW IF EXISTS v_audience_base;
DROP VIEW IF EXISTS v_demo_profiles;

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
  -- NEW (0005): latest viewed silhouette / subcategory / occasions — same
  -- catalog-authoritative + click-fallback + latest-by-ts pattern as above.
  (SELECT COALESCE(c4.silhouette, e4.silhouette)
     FROM demo_events e4 LEFT JOIN coach_catalog c4 ON c4.id = e4.product_id
    WHERE e4.vuid = a.vuid AND COALESCE(c4.silhouette, e4.silhouette) IS NOT NULL
    ORDER BY e4.ts DESC LIMIT 1)                                    AS viewed_silhouette,
  (SELECT COALESCE(c5.subcategory, e5.subcategory)
     FROM demo_events e5 LEFT JOIN coach_catalog c5 ON c5.id = e5.product_id
    WHERE e5.vuid = a.vuid AND COALESCE(c5.subcategory, e5.subcategory) IS NOT NULL
    ORDER BY e5.ts DESC LIMIT 1)                                    AS viewed_subcategory,
  (SELECT COALESCE(
            REPLACE(REPLACE(REPLACE(c6.occasion_json, '[', ''), ']', ''), '"', ''),
            e6.occasions)
     FROM demo_events e6 LEFT JOIN coach_catalog c6 ON c6.id = e6.product_id
    WHERE e6.vuid = a.vuid
      AND COALESCE(c6.occasion_json, e6.occasions) IS NOT NULL
    ORDER BY e6.ts DESC LIMIT 1)                                    AS viewed_occasions,
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

CREATE VIEW IF NOT EXISTS v_audience_base AS
SELECT
  vuid, 'historical' AS source, customer_id,
  viewed_product_line, journey_stage, product_views, page_views, cart_adds,
  wishlist_adds, cart_abandoned, price_band_viewed,
  -- NEW (0005) historical values derive from PURCHASES (view-level rollup was
  -- not retained at seed time): modal purchased silhouette/subcategory; the
  -- occasion tags of purchased items (comma list, de-bracketed from JSON).
  (SELECT c.silhouette
     FROM coach_purchase_items pi JOIN coach_catalog c ON c.id = pi.product_id
    WHERE pi.vuid = v_profiles.vuid AND c.silhouette IS NOT NULL
    GROUP BY c.silhouette ORDER BY COUNT(*) DESC, c.silhouette LIMIT 1) AS viewed_silhouette,
  (SELECT pi2.subcategory
     FROM coach_purchase_items pi2
    WHERE pi2.vuid = v_profiles.vuid AND pi2.subcategory IS NOT NULL
    GROUP BY pi2.subcategory ORDER BY COUNT(*) DESC, pi2.subcategory LIMIT 1) AS viewed_subcategory,
  (SELECT REPLACE(REPLACE(REPLACE(group_concat(DISTINCT c2.occasion_json), '[', ''), ']', ''), '"', '')
     FROM coach_purchase_items pi3 JOIN coach_catalog c2 ON c2.id = pi3.product_id
    WHERE pi3.vuid = v_profiles.vuid AND c2.occasion_json IS NOT NULL)   AS viewed_occasions,
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
  viewed_silhouette, viewed_subcategory, viewed_occasions,
  favorite_line, preferred_category, preferred_price_band, loyalty_tier,
  loyalty_member, gifter, engagement_rank, order_likelihood, churn_risk_score,
  predicted_ltv_usd, lifetime_value_usd, average_order_value_usd, lifetime_orders,
  persona, country, region, segments_json,
  bought_lines, bought_categories, orders_all, spend_all_usd, aov_all_usd,
  orders_90d, spend_90d_usd, aov_90d_usd, last_order_ts
FROM v_demo_profiles;

-- 3. Whitelist the new attributes (the audience condition-compiler injection
--    guard). INSERT OR REPLACE = idempotent on re-apply; seed_001.sql carries
--    the same rows so a full reseed retains them.
INSERT OR REPLACE INTO meta_attribute_catalog
  (key, source_table, column_expr, kind, sql_type, domain_kind, operators, enum_values, example, description) VALUES
  ('viewed_silhouette', 'v_audience_base', 'viewed_silhouette', 'behavior', 'TEXT', 'enum',
   '["eq","neq","in","exists"]',
   '["bag charm","billfold","card case","card holder","chain wallet","coin case","crossbody","hobo","shoulder","slim wallet","strap","top-handle","tote","wristlet","zip wallet","zip-around wallet"]',
   'tote',
   'Most-engaged product silhouette — latest viewed for live demo shoppers; most-purchased for historical profiles.'),
  ('viewed_subcategory', 'v_audience_base', 'viewed_subcategory', 'behavior', 'TEXT', 'enum',
   '["eq","neq","in","exists"]',
   '["Bag Charms","Bag Straps","Card Cases","Crossbody Bags","Keychains","Shoulder Bags","Top-Handle Bags","Totes & Carryalls","Wallets","Wristlets"]',
   'Totes & Carryalls',
   'Most-engaged product subcategory — latest viewed for live demo shoppers; most-purchased for historical profiles.'),
  ('viewed_occasions', 'v_audience_base', 'viewed_occasions', 'behavior', 'TEXT', 'text',
   '["contains","exists"]',
   '["date-night","evening","everyday","festival","gift","special-occasion","travel","winter","work"]',
   'evening',
   'Occasion tags engaged with (comma list; use contains) — latest viewed item''s tags for live shoppers; purchased items'' tags for historical profiles.');

-- =============================================================================
-- END 0005_dimension_enrichment.sql
-- =============================================================================
