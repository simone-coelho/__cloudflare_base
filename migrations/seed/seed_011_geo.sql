-- =============================================================================
-- seed_011_geo.sql  ·  Geo-Cohort Cold Start — REAL census + ZIP xref + additive
--                      NC/Piedmont-Triad first-party cohort (ADDITIVE — never alters
--                      the proven base seed seed_001..010).
--   Requires migrations/0004_geo_census.sql (geo_census + geo_xref) applied first.
--   Apply LOCAL then REMOTE:
--     npx wrangler d1 execute coach-demo-db --local  --file=migrations/seed/seed_011_geo.sql
--     npx wrangler d1 execute coach-demo-db --remote --file=migrations/seed/seed_011_geo.sql
--   (or via the seed loop:  for f in migrations/seed/*.sql; do wrangler d1 execute … --file="$f"; done)
--
-- HONESTY (doc 13 §3/§10):
--   * geo_census rows below are REAL public-domain data, cited per row in `source`+`vintage`:
--       - the NC / Piedmont-Triad / Charlotte / Raleigh / US set are the EXACT ACS 2024
--         figures verified in doc 13 §8 (source 'Census ACS 2024', vintage '2024').
--       - the 15 existing-state REGION rows use REAL ACS 2023 1-yr median HH income +
--         REAL Zillow ZHVI 2025 median home value (cited).
--       - the 15 representative METRO rows are CLEARLY-LABELED representative values
--         (state-level proxy) per doc 13 §70's explicit allowance — `source` says so.
--   * The first-party cohort rows (coach_odp_profiles / coach_transactions /
--     coach_purchase_items tagged region='NC') are REPRESENTATIVE / SYNTHETIC — the
--     /geo/cohort payload surfaces them as dataSource:'synthetic' (swap to a real
--     warehouse with zero change to the query). They model "shoppers LIKE them, from
--     here" — aggregate, never an individual.
--   * We curate (lines / price band) — we NEVER price or gate by geography.
-- =============================================================================

-- ── Idempotent re-apply: remove ONLY the rows this seed owns (FK-safe order:
--    children → parents). The base seed's rows are untouched. ──
DELETE FROM coach_purchase_items WHERE vuid LIKE 'v-nc-%';
DELETE FROM coach_transactions   WHERE order_id LIKE 'ordnc-%';
DELETE FROM coach_odp_profiles   WHERE vuid LIKE 'v-nc-%';
DELETE FROM geo_xref;
DELETE FROM geo_census;


-- =============================================================================
-- geo_census — REAL public ACS / Zillow figures.
-- =============================================================================

-- (a) The verified ACS 2024 demo set (doc 13 §8 — cite these on stage). REAL public.
INSERT INTO geo_census (geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage) VALUES
  ('national', 'US',               'United States',                                81604, 360600, 'Census ACS 2024', '2024'),
  ('region',   'NC',               'North Carolina',                               73958, 333000, 'Census ACS 2024', '2024'),
  ('metro',    '49180',            'Winston-Salem, NC Metro (Piedmont Triad)',     65903, 270700, 'Census ACS 2024', '2024'),
  ('county',   '37067',            'Forsyth County, NC',                           65768, 290400, 'Census ACS 2024', '2024'),
  ('city',     'winston-salem-nc', 'Winston-Salem city, NC',                       57758, 281200, 'Census ACS 2024', '2024'),
  ('zip',      '27106',            'Winston-Salem ZIP 27106 (NW, affluent)',       68568, 313100, 'Census ACS 2024', '2024'),
  ('zip',      '27101',            'Winston-Salem ZIP 27101 (central/east)',       44198, 221000, 'Census ACS 2024', '2024'),
  ('metro',    '16740',            'Charlotte-Concord-Gastonia, NC-SC Metro',      85938, 400400, 'Census ACS 2024', '2024'),
  ('metro',    '39580',            'Raleigh-Cary, NC Metro',                      102144, 465800, 'Census ACS 2024', '2024');

-- (b) Region rows for the 15 states present in the base seed. REAL public:
--     income = Census ACS 2023 1-yr (B19013); home value = Zillow ZHVI Jul-2025.
INSERT INTO geo_census (geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage) VALUES
  ('region', 'CA', 'California',     95521, 809227, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'NY', 'New York',       82095, 487737, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'TX', 'Texas',          75780, 308212, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'FL', 'Florida',        73311, 405280, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'IL', 'Illinois',       80306, 292156, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'NJ', 'New Jersey',     99781, 588776, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'MA', 'Massachusetts',  99858, 685886, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'WA', 'Washington',     94605, 626603, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'PA', 'Pennsylvania',   73824, 286397, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'GA', 'Georgia',        74632, 338734, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'NV', 'Nevada',         76364, 472477, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'VA', 'Virginia',       89931, 416516, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'CO', 'Colorado',       92911, 567724, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'AZ', 'Arizona',        77315, 440228, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025'),
  ('region', 'MI', 'Michigan',       69183, 259702, 'Census ACS 2023 1-yr (income); Zillow ZHVI 2025 (home value)', '2023/2025');

-- (c) Representative metro rows for those 15 states (largest metro). CLEARLY LABELED
--     representative (state-level proxy) per doc 13 §70 — first-party never rolls up to
--     these grains for the synthetic data (random historical ZIPs), so they exist for
--     completeness/contrast only; the demo path uses the REAL ACS 2024 metros above.
INSERT INTO geo_census (geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage) VALUES
  ('metro', '31080', 'Los Angeles-Long Beach-Anaheim, CA Metro',    95521, 809227, 'Representative (CA state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '35620', 'New York-Newark-Jersey City, NY-NJ Metro',    82095, 487737, 'Representative (NY state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '19100', 'Dallas-Fort Worth-Arlington, TX Metro',       75780, 308212, 'Representative (TX state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '33100', 'Miami-Fort Lauderdale-West Palm Beach, FL Metro', 73311, 405280, 'Representative (FL state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '16980', 'Chicago-Naperville-Elgin, IL-IN Metro',       80306, 292156, 'Representative (IL state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '45940', 'Trenton-Princeton, NJ Metro',                 99781, 588776, 'Representative (NJ state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '14460', 'Boston-Cambridge-Newton, MA-NH Metro',        99858, 685886, 'Representative (MA state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '42660', 'Seattle-Tacoma-Bellevue, WA Metro',           94605, 626603, 'Representative (WA state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '38300', 'Pittsburgh, PA Metro',                        73824, 286397, 'Representative (PA state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '12060', 'Atlanta-Sandy Springs-Alpharetta, GA Metro',  74632, 338734, 'Representative (GA state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '29820', 'Las Vegas-Henderson-Paradise, NV Metro',      76364, 472477, 'Representative (NV state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '40060', 'Richmond, VA Metro',                          89931, 416516, 'Representative (VA state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '19740', 'Denver-Aurora-Lakewood, CO Metro',            92911, 567724, 'Representative (CO state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '38060', 'Phoenix-Mesa-Chandler, AZ Metro',            77315, 440228, 'Representative (AZ state ACS 2023 / Zillow 2025 proxy)', '2023/2025'),
  ('metro', '19820', 'Detroit-Warren-Dearborn, MI Metro',          69183, 259702, 'Representative (MI state ACS 2023 / Zillow 2025 proxy)', '2023/2025');


-- =============================================================================
-- geo_xref — ZIP → metro(CBSA) → region(state) → country.
-- =============================================================================

-- (a) Winston-Salem metro (CBSA 49180 / Piedmont Triad) ZIPs — the cohort's geography.
--     All genuinely in the Winston-Salem MSA (Forsyth + Davie counties).
INSERT INTO geo_xref (zip, metro_cbsa, region, country) VALUES
  ('27101', '49180', 'NC', 'US'),
  ('27103', '49180', 'NC', 'US'),
  ('27104', '49180', 'NC', 'US'),
  ('27105', '49180', 'NC', 'US'),
  ('27106', '49180', 'NC', 'US'),
  ('27107', '49180', 'NC', 'US'),
  ('27127', '49180', 'NC', 'US'),
  ('27012', '49180', 'NC', 'US'),  -- Clemmons
  ('27023', '49180', 'NC', 'US'),  -- Pfafftown
  ('27040', '49180', 'NC', 'US'),  -- Rural Hall
  ('27045', '49180', 'NC', 'US'),  -- Tobaccoville
  ('27050', '49180', 'NC', 'US'),  -- Walkertown
  ('27284', '49180', 'NC', 'US'),  -- Kernersville
  ('27028', '49180', 'NC', 'US');  -- Mocksville (Davie)

-- (b) Token ZIP per existing-state metro (lets a real detected ZIP there resolve
--     metro+region; first-party rolls up to region for the synthetic data).
INSERT INTO geo_xref (zip, metro_cbsa, region, country) VALUES
  ('90001', '31080', 'CA', 'US'),
  ('10001', '35620', 'NY', 'US'),
  ('75201', '19100', 'TX', 'US'),
  ('33101', '33100', 'FL', 'US'),
  ('60601', '16980', 'IL', 'US'),
  ('08608', '45940', 'NJ', 'US'),
  ('02108', '14460', 'MA', 'US'),
  ('98101', '42660', 'WA', 'US'),
  ('15201', '38300', 'PA', 'US'),
  ('30303', '12060', 'GA', 'US'),
  ('89101', '29820', 'NV', 'US'),
  ('23219', '40060', 'VA', 'US'),
  ('80202', '19740', 'CO', 'US'),
  ('85001', '38060', 'AZ', 'US'),
  ('48201', '19820', 'MI', 'US');


-- =============================================================================
-- Additive NC / Piedmont-Triad first-party cohort — 320 distinct shoppers, each with
-- one completed order, generated DETERMINISTICALLY from i (no RNG) via a recursive CTE.
-- Distributed across 14 Triad ZIPs (~23/ZIP → each ZIP stays under the ~30-50
-- distinct-shopper roll-up threshold, so a Winston-Salem visitor rolls ZIP → metro),
-- while region='NC' AND metro 49180 both clear comfortably (N≈320).
-- Lines: Tabby (≈50%), Brooklyn (≈30%), Pillow Tabby (≈20%); modal price band 'core'
-- ($300–450); ~45% charm/SLG attach. REPRESENTATIVE/synthetic (dataSource:'synthetic').
-- =============================================================================

-- ── (1) Profiles ──
WITH RECURSIVE seq(i) AS (
  SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320
),
zips(z, zip, city) AS (VALUES
  (0,'27106','Winston-Salem'),(1,'27101','Winston-Salem'),(2,'27103','Winston-Salem'),
  (3,'27104','Winston-Salem'),(4,'27105','Winston-Salem'),(5,'27107','Winston-Salem'),
  (6,'27127','Winston-Salem'),(7,'27012','Clemmons'),(8,'27023','Pfafftown'),
  (9,'27040','Rural Hall'),(10,'27045','Tobaccoville'),(11,'27050','Walkertown'),
  (12,'27284','Kernersville'),(13,'27028','Mocksville')
),
bags(line, ce, pid, pname, cat, sub, price, band) AS (VALUES
  ('Tabby','core','COA-CY201','Tabby Shoulder Bag 20','Handbags','Shoulder Bags',375,'core'),
  ('Tabby','elevated','COA-CH857','Tabby Shoulder Bag 26','Handbags','Shoulder Bags',475,'elevated'),
  ('Brooklyn','core','COA-CU068','Brooklyn Shoulder Bag 28','Handbags','Shoulder Bags',295,'core'),
  ('Brooklyn','elevated','COA-CCU00','Brooklyn Shoulder Bag 34','Handbags','Shoulder Bags',425,'elevated'),
  ('Pillow Tabby','core','COA-CP149','Tabby Shoulder Bag 20 With Pillow Quilting','Handbags','Shoulder Bags',450,'elevated'),
  ('Pillow Tabby','elevated','COA-CP149','Tabby Shoulder Bag 20 With Pillow Quilting','Handbags','Shoulder Bags',450,'elevated')
),
deriv AS (
  SELECT i,
    i % 14 AS z,
    CASE WHEN i % 10 < 5 THEN 'Tabby' WHEN i % 10 < 8 THEN 'Brooklyn' ELSE 'Pillow Tabby' END AS line,
    CASE WHEN (i * 7) % 10 < 7 THEN 'core' ELSE 'elevated' END AS ce
  FROM seq
),
shopper AS (
  SELECT d.i, z.zip, z.city, b.line, b.price AS bag_price, b.band AS bag_band,
         (1772323200000 + d.i * 27000000) AS ots
  FROM deriv d JOIN zips z ON z.z = d.z JOIN bags b ON b.line = d.line AND b.ce = d.ce
)
INSERT INTO coach_odp_profiles
  (vuid, country, region, city, locale, timezone, preferred_device, acquisition_channel,
   email_subscriber, sms_subscriber, loyalty_member, loyalty_tier, first_seen_ts, last_seen_ts,
   session_count, lifetime_orders, lifetime_value_usd, average_order_value_usd, favorite_line,
   preferred_category, preferred_price_band, gifter, persona, viewed_product_line, product_views,
   page_views, category_dwell_ms, cart_adds, wishlist_adds, purchases, price_band_viewed,
   journey_stage, cart_abandoned, order_likelihood, engagement_rank, churn_risk_score,
   predicted_ltv_usd, segments_json)
SELECT
  'v-nc-' || printf('%04d', i), 'US', 'NC', city, 'en-US', 'America/New_York',
  CASE i % 3 WHEN 0 THEN 'desktop' WHEN 1 THEN 'mobile' ELSE 'tablet' END,
  CASE i % 4 WHEN 0 THEN 'organic' WHEN 1 THEN 'paid_social' WHEN 2 THEN 'email' ELSE 'direct' END,
  CASE WHEN i % 4 = 0 THEN 0 ELSE 1 END, CASE WHEN i % 3 = 0 THEN 1 ELSE 0 END,
  CASE WHEN i % 5 = 4 THEN 0 ELSE 1 END,
  CASE i % 4 WHEN 0 THEN 'platinum' WHEN 1 THEN 'gold' WHEN 2 THEN 'silver' ELSE 'member' END,
  ots - 2592000000, ots, 2 + i % 6, 1, bag_price, bag_price, line, 'Handbags', bag_band,
  CASE WHEN i % 7 = 0 THEN 1 ELSE 0 END,
  CASE line WHEN 'Tabby' THEN 'tabby_enthusiast' WHEN 'Brooklyn' THEN 'high_intent_browser' ELSE 'luxe_collector' END,
  line, 6 + i % 9, 9 + i % 13, 90000 + (i % 240) * 1000, 1, i % 2, 1, bag_band, 'late', 0,
  0.60 + (i % 30) / 100.0,
  CASE i % 4 WHEN 0 THEN 'vip' WHEN 1 THEN 'high' WHEN 2 THEN 'medium' ELSE 'low' END,
  0.08 + (i % 18) / 100.0, bag_price * 3 + 200, '["geo_cold_start","piedmont_triad_nc"]'
FROM shopper;

-- ── (2) Transactions (one completed order per shopper) ──
WITH RECURSIVE seq(i) AS (
  SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320
),
zips(z, zip, city) AS (VALUES
  (0,'27106','Winston-Salem'),(1,'27101','Winston-Salem'),(2,'27103','Winston-Salem'),
  (3,'27104','Winston-Salem'),(4,'27105','Winston-Salem'),(5,'27107','Winston-Salem'),
  (6,'27127','Winston-Salem'),(7,'27012','Clemmons'),(8,'27023','Pfafftown'),
  (9,'27040','Rural Hall'),(10,'27045','Tobaccoville'),(11,'27050','Walkertown'),
  (12,'27284','Kernersville'),(13,'27028','Mocksville')
),
bags(line, ce, pid, pname, cat, sub, price, band) AS (VALUES
  ('Tabby','core','COA-CY201','Tabby Shoulder Bag 20','Handbags','Shoulder Bags',375,'core'),
  ('Tabby','elevated','COA-CH857','Tabby Shoulder Bag 26','Handbags','Shoulder Bags',475,'elevated'),
  ('Brooklyn','core','COA-CU068','Brooklyn Shoulder Bag 28','Handbags','Shoulder Bags',295,'core'),
  ('Brooklyn','elevated','COA-CCU00','Brooklyn Shoulder Bag 34','Handbags','Shoulder Bags',425,'elevated'),
  ('Pillow Tabby','core','COA-CP149','Tabby Shoulder Bag 20 With Pillow Quilting','Handbags','Shoulder Bags',450,'elevated'),
  ('Pillow Tabby','elevated','COA-CP149','Tabby Shoulder Bag 20 With Pillow Quilting','Handbags','Shoulder Bags',450,'elevated')
),
slg(slgk, pid, pname, cat, sub, price, band) AS (VALUES
  (0,'COA-CR551','Essential Small Zip Around Card Case','Small Leather Goods','Card Cases',95,'entry'),
  (1,'COA-CR554','Essential Billfold Wallet','Small Leather Goods','Wallets',150,'core'),
  (2,'COA-CZ111','Essential Card Holder Wallet','Small Leather Goods','Card Cases',75,'entry'),
  (3,'COA-CH818','Essential Small Wristlet','Small Leather Goods','Wristlets',125,'entry')
),
deriv AS (
  SELECT i, i % 14 AS z,
    CASE WHEN i % 10 < 5 THEN 'Tabby' WHEN i % 10 < 8 THEN 'Brooklyn' ELSE 'Pillow Tabby' END AS line,
    CASE WHEN (i * 7) % 10 < 7 THEN 'core' ELSE 'elevated' END AS ce,
    CASE WHEN i % 20 < 9 THEN 1 ELSE 0 END AS attach,
    (i * 13) % 4 AS slgk
  FROM seq
),
shopper AS (
  SELECT d.i, z.zip, b.price AS bag_price, d.attach, s.price AS slg_price,
         (1772323200000 + d.i * 27000000) AS ots
  FROM deriv d JOIN zips z ON z.z = d.z JOIN bags b ON b.line = d.line AND b.ce = d.ce
       JOIN slg s ON s.slgk = d.slgk
)
INSERT INTO coach_transactions
  (order_id, vuid, customer_id, email, session_id, order_ts, subtotal_usd, discount_usd,
   tax_usd, shipping_usd, currency, tender_type, card_network, card_last4, status, item_count,
   is_gift, gift_wrap, device, channel, billing_country, billing_region, billing_postal_code)
SELECT
  'ordnc-' || printf('%04d', i), 'v-nc-' || printf('%04d', i), NULL, NULL,
  'sessnc-' || printf('%04d', i), ots,
  bag_price + CASE WHEN attach = 1 THEN slg_price ELSE 0 END, 0,
  ((bag_price + CASE WHEN attach = 1 THEN slg_price ELSE 0 END) * 675) / 10000, 0, 'USD',
  CASE i % 5 WHEN 3 THEN 'affirm' WHEN 4 THEN 'tabby' ELSE 'card' END,
  CASE WHEN i % 5 IN (3, 4) THEN NULL WHEN i % 2 = 0 THEN 'visa' ELSE 'mastercard' END,
  CASE WHEN i % 5 IN (3, 4) THEN NULL ELSE printf('%04d', 1000 + (i * 7) % 9000) END,
  'completed', CASE WHEN attach = 1 THEN 2 ELSE 1 END,
  CASE WHEN i % 9 = 0 THEN 1 ELSE 0 END, CASE WHEN i % 9 = 0 THEN 1 ELSE 0 END,
  CASE i % 3 WHEN 0 THEN 'desktop' WHEN 1 THEN 'mobile' ELSE 'tablet' END,
  CASE i % 4 WHEN 0 THEN 'organic' WHEN 1 THEN 'paid_social' WHEN 2 THEN 'email' ELSE 'direct' END,
  'usa', 'NC', CAST(zip AS INTEGER)
FROM shopper;

-- ── (3) Purchase items (the bag for every order + the SLG/charm attach where attach=1) ──
WITH RECURSIVE seq(i) AS (
  SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320
),
bags(line, ce, pid, pname, cat, sub, price, band) AS (VALUES
  ('Tabby','core','COA-CY201','Tabby Shoulder Bag 20','Handbags','Shoulder Bags',375,'core'),
  ('Tabby','elevated','COA-CH857','Tabby Shoulder Bag 26','Handbags','Shoulder Bags',475,'elevated'),
  ('Brooklyn','core','COA-CU068','Brooklyn Shoulder Bag 28','Handbags','Shoulder Bags',295,'core'),
  ('Brooklyn','elevated','COA-CCU00','Brooklyn Shoulder Bag 34','Handbags','Shoulder Bags',425,'elevated'),
  ('Pillow Tabby','core','COA-CP149','Tabby Shoulder Bag 20 With Pillow Quilting','Handbags','Shoulder Bags',450,'elevated'),
  ('Pillow Tabby','elevated','COA-CP149','Tabby Shoulder Bag 20 With Pillow Quilting','Handbags','Shoulder Bags',450,'elevated')
),
slg(slgk, pid, pname, cat, sub, price, band) AS (VALUES
  (0,'COA-CR551','Essential Small Zip Around Card Case','Small Leather Goods','Card Cases',95,'entry'),
  (1,'COA-CR554','Essential Billfold Wallet','Small Leather Goods','Wallets',150,'core'),
  (2,'COA-CZ111','Essential Card Holder Wallet','Small Leather Goods','Card Cases',75,'entry'),
  (3,'COA-CH818','Essential Small Wristlet','Small Leather Goods','Wristlets',125,'entry')
),
deriv AS (
  SELECT i,
    CASE WHEN i % 10 < 5 THEN 'Tabby' WHEN i % 10 < 8 THEN 'Brooklyn' ELSE 'Pillow Tabby' END AS line,
    CASE WHEN (i * 7) % 10 < 7 THEN 'core' ELSE 'elevated' END AS ce,
    CASE WHEN i % 20 < 9 THEN 1 ELSE 0 END AS attach,
    (i * 13) % 4 AS slgk
  FROM seq
)
INSERT INTO coach_purchase_items
  (order_id, vuid, customer_id, product_id, product_name, line, category, subcategory,
   colorway, unit_price_usd, quantity, price_band, is_gift_item, order_ts)
SELECT
  'ordnc-' || printf('%04d', d.i), 'v-nc-' || printf('%04d', d.i), NULL,
  b.pid, b.pname, b.line, b.cat, b.sub, 'Black', b.price, 1, b.band, 0,
  1772323200000 + d.i * 27000000
FROM deriv d JOIN bags b ON b.line = d.line AND b.ce = d.ce
UNION ALL
SELECT
  'ordnc-' || printf('%04d', d.i), 'v-nc-' || printf('%04d', d.i), NULL,
  s.pid, s.pname, 'Essential', s.cat, s.sub, 'Black', s.price, 1, s.band, 0,
  1772323200000 + d.i * 27000000
FROM deriv d JOIN slg s ON s.slgk = d.slgk
WHERE d.attach = 1;

-- ── Verify (region='NC' clears; ZIPs stay under threshold; census join works) ──
--   SELECT COUNT(DISTINCT vuid) FROM coach_transactions WHERE billing_region='NC';            -- ~320
--   SELECT x.metro_cbsa, COUNT(DISTINCT t.vuid) FROM coach_transactions t
--     JOIN geo_xref x ON x.zip = CAST(t.billing_postal_code AS TEXT)
--    WHERE x.metro_cbsa='49180' GROUP BY 1;                                                    -- ~320
--   SELECT i.line, COUNT(DISTINCT i.vuid) FROM coach_purchase_items i
--    WHERE i.vuid LIKE 'v-nc-%' GROUP BY i.line ORDER BY 2 DESC;                                -- Tabby > Brooklyn > Pillow Tabby
-- =============================================================================
-- END seed_011_geo.sql
-- =============================================================================
