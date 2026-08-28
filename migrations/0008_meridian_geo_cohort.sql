-- =============================================================================
-- 0008_meridian_geo_cohort.sql · Meridian (Opticon) — the geo-cohort cold start
-- =============================================================================
-- Target: Cloudflare D1 (SQLite engine). Apply with:
--   npx wrangler d1 migrations apply coach-demo-db --local      (then --remote)
--
-- WHAT THIS IS (docs/architecture/13-geo-cohort-coldstart-prd-tdd.md, ported):
--   A brand-new visitor with no history → the edge resolves where they are (REAL,
--   a property of the connection) → we ask OUR OWN first-party purchase history
--   what shoppers from that geography actually bought (REAL query, representative
--   data today, the customer's warehouse later) → enriched with REAL public census
--   figures. Geo is a coarse opening prior the engine replaces the moment they act.
--
-- WHY MERIDIAN-OWNED TABLES (src/demos/meridian/README.md, the isolation charter):
--   Meridian may WRITE only to mrd_* tables. Coach's cohort lives in
--   coach_transactions / coach_purchase_items and is Coach's to reseed, reset and
--   regenerate; a Meridian rehearsal must be physically incapable of touching it,
--   and vice versa. So the first-party layer is forked into two mrd_ tables. The
--   REFERENCE layer (geo_census, geo_xref) is shared, read-only, published public
--   data — copying a table of census figures would buy nothing (charter, "SHARED-
--   DATA EXCEPTION"). This migration only ADDS reference rows (INSERT OR IGNORE)
--   and upgrades ONE clearly-labelled proxy row to the real figure (see §2).
--
-- HONESTY (doc 13 §3/§10 — load-bearing on the Opticon stage):
--   * geo_census rows below are REAL public-domain data (17 U.S.C. §105), cited
--     per row in `source` + `vintage`: U.S. Census ACS 2024 1-year, tables B19013
--     (median household income) and B25077 (median home value). Verified against
--     the ACS 2024 1-year release via api.censusreporter.org on 2026-08-28; the
--     national / NY / NC / Winston-Salem figures match the rows seed_011 already
--     carries to the dollar.
--   * The first-party rows (mrd_transactions / mrd_purchase_items) are
--     REPRESENTATIVE / SYNTHETIC — generated DETERMINISTICALLY from a counter (no
--     RNG), so a rehearsal and the room see identical numbers. The route labels
--     them dataSource:'synthetic', firstParty:'representative'.
--   * We CURATE (which lines lead) — we NEVER price or gate by geography.
--
-- IDEMPOTENT: re-apply is safe — the seed DELETEs only the rows it owns (order_id
-- prefix 'mrdo-') before re-inserting; reference rows are INSERT OR IGNORE.
-- =============================================================================


-- =============================================================================
-- 1. Meridian-owned first-party tables.
-- =============================================================================
CREATE TABLE IF NOT EXISTS mrd_transactions (
  order_id            TEXT    NOT NULL,            -- 'mrdo-<metro>-<r|f>-<nnnn>'
  vuid                TEXT    NOT NULL,            -- 'mrd-<metro>-<r|f>-<nnnn>' — one shopper, one order
  vertical            TEXT    NOT NULL DEFAULT 'retail',   -- retail | financial (the swap survives the cohort)
  billing_region      TEXT,                        -- 2-letter state
  billing_postal_code TEXT,                        -- 5-digit ZIP, TEXT (leading zeros survive)
  order_total_usd     INTEGER NOT NULL,
  item_count          INTEGER NOT NULL,            -- > 1 means an attach
  ts                  INTEGER NOT NULL,            -- epoch ms
  PRIMARY KEY (order_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_mrd_tx_zip      ON mrd_transactions(billing_postal_code);
CREATE INDEX IF NOT EXISTS idx_mrd_tx_region   ON mrd_transactions(billing_region);
CREATE INDEX IF NOT EXISTS idx_mrd_tx_vertical ON mrd_transactions(vertical);

CREATE TABLE IF NOT EXISTS mrd_purchase_items (
  order_id  TEXT    NOT NULL,
  item_id   TEXT    NOT NULL,                      -- MRD-R### | MRD-F### (the live catalogue's ids)
  line      TEXT,                                  -- retail: product line; financial: subFamily
  family    TEXT,                                  -- retail: the family; financial: the product name
  category  TEXT,
  value_usd INTEGER NOT NULL,                      -- the band source, exactly as the catalogue carries it
  PRIMARY KEY (order_id, item_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_mrd_pi_line ON mrd_purchase_items(line);


-- =============================================================================
-- 2. Shared reference layer — REAL public census, ADD-ONLY.
--    Source: U.S. Census ACS 2024 1-year, B19013 / B25077, verified 2026-08-28 via
--    api.censusreporter.org/1.0/data/show/acs2024_1yr (release "ACS 2024 1-year").
-- =============================================================================
-- (a) Rows the cohort ladder needs. OR IGNORE: where seed_011 already carries the
--     identical figure the existing row is left byte-for-byte untouched.
INSERT OR IGNORE INTO geo_census (geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage) VALUES
  ('national', 'US',    'United States',                            81604, 360600, 'Census ACS 2024 1-yr', '2024'),
  ('region',   'NY',    'New York',                                 85820, 449800, 'Census ACS 2024 1-yr', '2024'),
  ('region',   'NC',    'North Carolina',                           73958, 333000, 'Census ACS 2024 1-yr', '2024'),
  ('metro',    '49180', 'Winston-Salem, NC Metro (Piedmont Triad)', 65903, 270700, 'Census ACS 2024 1-yr', '2024');

-- (b) New York metro (CBSA 35620). seed_011 carries this grain only as a CLEARLY
--     LABELLED state-level proxy ("Representative (NY state ACS 2023 / Zillow 2025
--     proxy)"). A proxy is honest but weak on a stage; the real ACS 2024 1-year
--     metro figure exists, so the proxy row — and only a row still labelled as a
--     proxy — is replaced with it. A real row already present is never touched.
DELETE FROM geo_census WHERE geo_level = 'metro' AND geo_key = '35620' AND source LIKE 'Representative%';
INSERT OR IGNORE INTO geo_census (geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage) VALUES
  ('metro', '35620', 'New York-Newark-Jersey City, NY-NJ Metro', 99852, 648800, 'Census ACS 2024 1-yr', '2024');

-- (c) ZIP → metro → region crosswalk for every ZIP the seed below uses. The
--     fourteen Manhattan / Brooklyn ZIPs are all genuinely in CBSA 35620; the
--     fourteen Piedmont Triad ZIPs are the same set seed_011 uses (Forsyth + Davie).
INSERT OR IGNORE INTO geo_xref (zip, metro_cbsa, region, country) VALUES
  ('10001', '35620', 'NY', 'US'),  -- Chelsea / Penn
  ('10003', '35620', 'NY', 'US'),  -- East Village
  ('10011', '35620', 'NY', 'US'),  -- Chelsea
  ('10012', '35620', 'NY', 'US'),  -- SoHo
  ('10013', '35620', 'NY', 'US'),  -- Tribeca
  ('10014', '35620', 'NY', 'US'),  -- West Village
  ('10016', '35620', 'NY', 'US'),  -- Murray Hill
  ('10021', '35620', 'NY', 'US'),  -- Upper East Side
  ('10023', '35620', 'NY', 'US'),  -- Upper West Side
  ('10024', '35620', 'NY', 'US'),  -- Upper West Side
  ('11201', '35620', 'NY', 'US'),  -- Brooklyn Heights
  ('11215', '35620', 'NY', 'US'),  -- Park Slope
  ('11217', '35620', 'NY', 'US'),  -- Boerum Hill
  ('11231', '35620', 'NY', 'US'),  -- Carroll Gardens
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


-- =============================================================================
-- 3. The representative first-party cohort — DETERMINISTIC, no RNG.
--    Four blocks: {New York metro, Piedmont Triad} × {retail, financial}. Each
--    block is 320 shoppers with one order each, spread over 14 ZIPs (22–23 per
--    ZIP, every ZIP UNDER the 30-shopper roll-up gate) so a visitor rolls up
--    ZIP → metro (N=320) and the grain used is shown as the metro.
--
--    Every choice is a function of the counter i:
--      ZIP        = i % 14
--      line       = i % 20 (the weights are exact twentieths: 7/20 = 35%, …)
--      colourway  = (i / 20) % 4  (a pool of four per line)
--      attach?    = a modulus coprime with 20, so it does not track the line
--      attach pick= a second modulus, chosen so it is uniform across the attachers
--    The attach pools are DISJOINT from the primary pools within a block, so an
--    order never carries the same item twice, and attach lines are chosen so they
--    never overtake the block's intended leaders.
--
--    Items are written first; each block's transactions are then derived from its
--    own items (total, count) so the two tables cannot disagree.
-- =============================================================================
DELETE FROM mrd_purchase_items WHERE order_id LIKE 'mrdo-%';
DELETE FROM mrd_transactions   WHERE order_id LIKE 'mrdo-%';


-- ── (A) New York metro · retail ─────────────────────────────────────────────
--    Drover 35% / Linden 25% (tote-led) / Holloway 15% / Fenwick 15% /
--    Ridgeline 5% / Halden 5%. Attach ≈45% from four lines outside that set.
--    Headline items land mostly in the premium band (≥ $250).
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320),
pool(line, k, item_id, family, category, value) AS (VALUES
  ('Drover',    0, 'MRD-R001', 'Drover Field Jacket',       'Outerwear', 298),
  ('Drover',    1, 'MRD-R002', 'Drover Field Jacket',       'Outerwear', 298),
  ('Drover',    2, 'MRD-R003', 'Drover Field Jacket',       'Outerwear', 298),
  ('Drover',    3, 'MRD-R002', 'Drover Field Jacket',       'Outerwear', 298),
  ('Linden',    0, 'MRD-R016', 'Linden Structured Tote',    'Bags',      320),
  ('Linden',    1, 'MRD-R017', 'Linden Structured Tote',    'Bags',      320),
  ('Linden',    2, 'MRD-R018', 'Linden Structured Tote',    'Bags',      320),
  ('Linden',    3, 'MRD-R013', 'Linden Leather Crossbody',  'Bags',      248),
  ('Holloway',  0, 'MRD-R019', 'Holloway Weekender',        'Bags',      385),
  ('Holloway',  1, 'MRD-R020', 'Holloway Weekender',        'Bags',      385),
  ('Holloway',  2, 'MRD-R021', 'Holloway Weekender',        'Bags',      385),
  ('Holloway',  3, 'MRD-R020', 'Holloway Weekender',        'Bags',      385),
  ('Fenwick',   0, 'MRD-R007', 'Fenwick Fisherman Sweater', 'Knitwear',  165),
  ('Fenwick',   1, 'MRD-R008', 'Fenwick Fisherman Sweater', 'Knitwear',  165),
  ('Fenwick',   2, 'MRD-R010', 'Fenwick Merino Crew',       'Knitwear',  128),
  ('Fenwick',   3, 'MRD-R011', 'Fenwick Merino Crew',       'Knitwear',  128),
  ('Ridgeline', 0, 'MRD-R022', 'Ridgeline Chelsea Boot',    'Footwear',  320),
  ('Ridgeline', 1, 'MRD-R023', 'Ridgeline Chelsea Boot',    'Footwear',  320),
  ('Ridgeline', 2, 'MRD-R024', 'Ridgeline Chelsea Boot',    'Footwear',  320),
  ('Ridgeline', 3, 'MRD-R023', 'Ridgeline Chelsea Boot',    'Footwear',  320),
  ('Halden',    0, 'MRD-R028', 'Halden Signet Ring',        'Jewellery', 210),
  ('Halden',    1, 'MRD-R029', 'Halden Signet Ring',        'Jewellery', 210),
  ('Halden',    2, 'MRD-R030', 'Halden Signet Ring',        'Jewellery', 210),
  ('Halden',    3, 'MRD-R028', 'Halden Signet Ring',        'Jewellery', 210)),
attach(k, line, item_id, family, category, value) AS (VALUES
  (0, 'Shorewell', 'MRD-R005', 'Shorewell Rain Shell',    'Outerwear', 186),
  (1, 'Harlow',    'MRD-R031', 'Harlow Aviator',          'Eyewear',   215),
  (2, 'Aster',     'MRD-R034', 'Aster Silk Square',       'Scarves',   165),
  (3, 'Solstice',  'MRD-R038', 'Solstice Amber Absolute', 'Fragrance', 215)),
deriv AS (
  SELECT i,
    CASE WHEN i % 20 < 7 THEN 'Drover' WHEN i % 20 < 12 THEN 'Linden' WHEN i % 20 < 15 THEN 'Holloway'
         WHEN i % 20 < 18 THEN 'Fenwick' WHEN i % 20 < 19 THEN 'Ridgeline' ELSE 'Halden' END AS line,
    (i / 20) % 4 AS k,
    CASE WHEN i % 9 < 4 THEN 1 ELSE 0 END AS att,
    (i * 7) % 4 AS ak
  FROM seq)
INSERT INTO mrd_purchase_items (order_id, item_id, line, family, category, value_usd)
SELECT 'mrdo-ny-r-' || printf('%04d', d.i), p.item_id, p.line, p.family, p.category, p.value
  FROM deriv d JOIN pool p ON p.line = d.line AND p.k = d.k
UNION ALL
SELECT 'mrdo-ny-r-' || printf('%04d', d.i), a.item_id, a.line, a.family, a.category, a.value
  FROM deriv d JOIN attach a ON a.k = d.ak
 WHERE d.att = 1;

WITH zips(z, zip) AS (VALUES
  (0,'10001'),(1,'10003'),(2,'10011'),(3,'10012'),(4,'10013'),(5,'10014'),(6,'10016'),
  (7,'10021'),(8,'10023'),(9,'10024'),(10,'11201'),(11,'11215'),(12,'11217'),(13,'11231')),
o AS (
  SELECT order_id, SUM(value_usd) AS total, COUNT(*) AS n, CAST(substr(order_id, -4) AS INTEGER) AS i
    FROM mrd_purchase_items WHERE order_id LIKE 'mrdo-ny-r-%' GROUP BY order_id)
INSERT INTO mrd_transactions (order_id, vuid, vertical, billing_region, billing_postal_code, order_total_usd, item_count, ts)
SELECT o.order_id, 'mrd-ny-r-' || printf('%04d', o.i), 'retail', 'NY', z.zip, o.total, o.n,
       1777593600000 + o.i * 27000000
  FROM o JOIN zips z ON z.z = o.i % 14;


-- ── (B) Piedmont Triad (Winston-Salem, CBSA 49180) · retail ─────────────────
--    A DIFFERENT lead so the two geographies visibly differ:
--    Shorewell 35% / Fenwick 30% / Ridgeline 15% (sneaker-led) / Linden 10%
--    (crossbody) / Drover 5% / Aster 5%. Attach ≈40%. Headline band: core.
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320),
pool(line, k, item_id, family, category, value) AS (VALUES
  ('Shorewell', 0, 'MRD-R004', 'Shorewell Rain Shell',      'Outerwear', 186),
  ('Shorewell', 1, 'MRD-R005', 'Shorewell Rain Shell',      'Outerwear', 186),
  ('Shorewell', 2, 'MRD-R006', 'Shorewell Rain Shell',      'Outerwear', 186),
  ('Shorewell', 3, 'MRD-R005', 'Shorewell Rain Shell',      'Outerwear', 186),
  ('Fenwick',   0, 'MRD-R007', 'Fenwick Fisherman Sweater', 'Knitwear',  165),
  ('Fenwick',   1, 'MRD-R009', 'Fenwick Fisherman Sweater', 'Knitwear',  165),
  ('Fenwick',   2, 'MRD-R010', 'Fenwick Merino Crew',       'Knitwear',  128),
  ('Fenwick',   3, 'MRD-R012', 'Fenwick Merino Crew',       'Knitwear',  128),
  ('Ridgeline', 0, 'MRD-R025', 'Ridgeline Court Sneaker',   'Footwear',  110),
  ('Ridgeline', 1, 'MRD-R026', 'Ridgeline Court Sneaker',   'Footwear',  110),
  ('Ridgeline', 2, 'MRD-R027', 'Ridgeline Court Sneaker',   'Footwear',  110),
  ('Ridgeline', 3, 'MRD-R022', 'Ridgeline Chelsea Boot',    'Footwear',  320),
  ('Linden',    0, 'MRD-R013', 'Linden Leather Crossbody',  'Bags',      248),
  ('Linden',    1, 'MRD-R014', 'Linden Leather Crossbody',  'Bags',      248),
  ('Linden',    2, 'MRD-R015', 'Linden Leather Crossbody',  'Bags',      248),
  ('Linden',    3, 'MRD-R013', 'Linden Leather Crossbody',  'Bags',      248),
  ('Drover',    0, 'MRD-R001', 'Drover Field Jacket',       'Outerwear', 298),
  ('Drover',    1, 'MRD-R002', 'Drover Field Jacket',       'Outerwear', 298),
  ('Drover',    2, 'MRD-R003', 'Drover Field Jacket',       'Outerwear', 298),
  ('Drover',    3, 'MRD-R003', 'Drover Field Jacket',       'Outerwear', 298),
  ('Aster',     0, 'MRD-R034', 'Aster Silk Square',         'Scarves',   165),
  ('Aster',     1, 'MRD-R035', 'Aster Silk Square',         'Scarves',   165),
  ('Aster',     2, 'MRD-R036', 'Aster Silk Square',         'Scarves',   165),
  ('Aster',     3, 'MRD-R035', 'Aster Silk Square',         'Scarves',   165)),
attach(k, line, item_id, family, category, value) AS (VALUES
  (0, 'Halden',   'MRD-R029', 'Halden Signet Ring',     'Jewellery', 210),
  (1, 'Solstice', 'MRD-R039', 'Solstice Fig & Neroli',  'Fragrance', 130),
  (2, 'Harlow',   'MRD-R032', 'Harlow Aviator',         'Eyewear',   215),
  (3, 'Holloway', 'MRD-R019', 'Holloway Weekender',     'Bags',      385)),
deriv AS (
  SELECT i,
    CASE WHEN i % 20 < 7 THEN 'Shorewell' WHEN i % 20 < 13 THEN 'Fenwick' WHEN i % 20 < 16 THEN 'Ridgeline'
         WHEN i % 20 < 18 THEN 'Linden' WHEN i % 20 < 19 THEN 'Drover' ELSE 'Aster' END AS line,
    (i / 20) % 4 AS k,
    CASE WHEN i % 5 < 2 THEN 1 ELSE 0 END AS att,
    (i * 7) % 4 AS ak
  FROM seq)
INSERT INTO mrd_purchase_items (order_id, item_id, line, family, category, value_usd)
SELECT 'mrdo-nc-r-' || printf('%04d', d.i), p.item_id, p.line, p.family, p.category, p.value
  FROM deriv d JOIN pool p ON p.line = d.line AND p.k = d.k
UNION ALL
SELECT 'mrdo-nc-r-' || printf('%04d', d.i), a.item_id, a.line, a.family, a.category, a.value
  FROM deriv d JOIN attach a ON a.k = d.ak
 WHERE d.att = 1;

WITH zips(z, zip) AS (VALUES
  (0,'27106'),(1,'27101'),(2,'27103'),(3,'27104'),(4,'27105'),(5,'27107'),(6,'27127'),
  (7,'27012'),(8,'27023'),(9,'27040'),(10,'27045'),(11,'27050'),(12,'27284'),(13,'27028')),
o AS (
  SELECT order_id, SUM(value_usd) AS total, COUNT(*) AS n, CAST(substr(order_id, -4) AS INTEGER) AS i
    FROM mrd_purchase_items WHERE order_id LIKE 'mrdo-nc-r-%' GROUP BY order_id)
INSERT INTO mrd_transactions (order_id, vuid, vertical, billing_region, billing_postal_code, order_total_usd, item_count, ts)
SELECT o.order_id, 'mrd-nc-r-' || printf('%04d', o.i), 'retail', 'NC', z.zip, o.total, o.n,
       1777593600000 + o.i * 27000000
  FROM o JOIN zips z ON z.z = o.i % 14;


-- ── (C) New York metro · financial ──────────────────────────────────────────
--    Same geography, the other business. `line` is the subFamily (the narrow
--    dimension financial reads: fixed / variable / revolving / deposit / managed),
--    `family` is the product. Revolving 35% / managed 25% / deposit 20% /
--    fixed 15% / variable 5%; attach ≈30% (a second product opened).
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320),
pool(line, k, item_id, family, category, value) AS (VALUES
  ('revolving', 0, 'MRD-F009', 'Platinum Rewards Card',    'Card',      12000),
  ('revolving', 1, 'MRD-F012', 'Voyager Travel Card',      'Card',      15000),
  ('revolving', 2, 'MRD-F010', 'Everyday Cashback Card',   'Card',       6000),
  ('revolving', 3, 'MRD-F009', 'Platinum Rewards Card',    'Card',      12000),
  ('managed',   0, 'MRD-F017', 'Self-Directed Brokerage',  'Investing', 60000),
  ('managed',   1, 'MRD-F018', 'Roth Retirement Account',  'Investing', 48000),
  ('managed',   2, 'MRD-F019', 'Managed Portfolio',        'Investing', 120000),
  ('managed',   3, 'MRD-F018', 'Roth Retirement Account',  'Investing', 48000),
  ('deposit',   0, 'MRD-F014', 'High-Yield Savings',       'Savings',   18000),
  ('deposit',   1, 'MRD-F016', 'Money Market Account',     'Savings',   42000),
  ('deposit',   2, 'MRD-F015', '12-Month Certificate',     'Savings',   25000),
  ('deposit',   3, 'MRD-F014', 'High-Yield Savings',       'Savings',   18000),
  ('fixed',     0, 'MRD-F001', '30-Year Fixed Mortgage',   'Mortgage',  385000),
  ('fixed',     1, 'MRD-F002', '15-Year Fixed Mortgage',   'Mortgage',  310000),
  ('fixed',     2, 'MRD-F001', '30-Year Fixed Mortgage',   'Mortgage',  385000),
  ('fixed',     3, 'MRD-F006', 'New Auto Loan',            'Auto',      34000),
  ('variable',  0, 'MRD-F003', '7/1 Adjustable Mortgage',  'Mortgage',  420000),
  ('variable',  1, 'MRD-F004', 'Home Equity Line',         'Mortgage',  75000),
  ('variable',  2, 'MRD-F003', '7/1 Adjustable Mortgage',  'Mortgage',  420000),
  ('variable',  3, 'MRD-F004', 'Home Equity Line',         'Mortgage',  75000)),
attach(k, line, item_id, family, category, value) AS (VALUES
  (0, 'variable',  'MRD-F013', 'Personal Line of Credit', 'Card',     20000),
  (1, 'fixed',     'MRD-F008', 'Auto Refinance',          'Auto',     18500),
  (2, 'variable',  'MRD-F005', 'Renovation Loan',         'Mortgage', 65000),
  (3, 'revolving', 'MRD-F011', 'Secured Starter Card',    'Card',      1000)),
deriv AS (
  SELECT i,
    CASE WHEN i % 20 < 7 THEN 'revolving' WHEN i % 20 < 12 THEN 'managed' WHEN i % 20 < 16 THEN 'deposit'
         WHEN i % 20 < 19 THEN 'fixed' ELSE 'variable' END AS line,
    (i / 20) % 4 AS k,
    CASE WHEN i % 10 < 3 THEN 1 ELSE 0 END AS att,
    (i / 10) % 4 AS ak
  FROM seq)
INSERT INTO mrd_purchase_items (order_id, item_id, line, family, category, value_usd)
SELECT 'mrdo-ny-f-' || printf('%04d', d.i), p.item_id, p.line, p.family, p.category, p.value
  FROM deriv d JOIN pool p ON p.line = d.line AND p.k = d.k
UNION ALL
SELECT 'mrdo-ny-f-' || printf('%04d', d.i), a.item_id, a.line, a.family, a.category, a.value
  FROM deriv d JOIN attach a ON a.k = d.ak
 WHERE d.att = 1;

WITH zips(z, zip) AS (VALUES
  (0,'10001'),(1,'10003'),(2,'10011'),(3,'10012'),(4,'10013'),(5,'10014'),(6,'10016'),
  (7,'10021'),(8,'10023'),(9,'10024'),(10,'11201'),(11,'11215'),(12,'11217'),(13,'11231')),
o AS (
  SELECT order_id, SUM(value_usd) AS total, COUNT(*) AS n, CAST(substr(order_id, -4) AS INTEGER) AS i
    FROM mrd_purchase_items WHERE order_id LIKE 'mrdo-ny-f-%' GROUP BY order_id)
INSERT INTO mrd_transactions (order_id, vuid, vertical, billing_region, billing_postal_code, order_total_usd, item_count, ts)
SELECT o.order_id, 'mrd-ny-f-' || printf('%04d', o.i), 'financial', 'NY', z.zip, o.total, o.n,
       1777593600000 + o.i * 27000000
  FROM o JOIN zips z ON z.z = o.i % 14;


-- ── (D) Piedmont Triad · financial ──────────────────────────────────────────
--    Fixed 40% (mortgage + auto) / deposit 20% / variable 15% / revolving 15% /
--    managed 10%; attach ≈33%. The lead ('fixed') differs from New York's.
WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 320),
pool(line, k, item_id, family, category, value) AS (VALUES
  ('fixed',     0, 'MRD-F001', '30-Year Fixed Mortgage',   'Mortgage',  385000),
  ('fixed',     1, 'MRD-F006', 'New Auto Loan',            'Auto',      34000),
  ('fixed',     2, 'MRD-F007', 'Used Auto Loan',           'Auto',      21000),
  ('fixed',     3, 'MRD-F001', '30-Year Fixed Mortgage',   'Mortgage',  385000),
  ('variable',  0, 'MRD-F004', 'Home Equity Line',         'Mortgage',  75000),
  ('variable',  1, 'MRD-F005', 'Renovation Loan',          'Mortgage',  65000),
  ('variable',  2, 'MRD-F003', '7/1 Adjustable Mortgage',  'Mortgage',  420000),
  ('variable',  3, 'MRD-F004', 'Home Equity Line',         'Mortgage',  75000),
  ('deposit',   0, 'MRD-F014', 'High-Yield Savings',       'Savings',   18000),
  ('deposit',   1, 'MRD-F015', '12-Month Certificate',     'Savings',   25000),
  ('deposit',   2, 'MRD-F016', 'Money Market Account',     'Savings',   42000),
  ('deposit',   3, 'MRD-F014', 'High-Yield Savings',       'Savings',   18000),
  ('revolving', 0, 'MRD-F010', 'Everyday Cashback Card',   'Card',       6000),
  ('revolving', 1, 'MRD-F011', 'Secured Starter Card',     'Card',       1000),
  ('revolving', 2, 'MRD-F009', 'Platinum Rewards Card',    'Card',      12000),
  ('revolving', 3, 'MRD-F010', 'Everyday Cashback Card',   'Card',       6000),
  ('managed',   0, 'MRD-F018', 'Roth Retirement Account',  'Investing', 48000),
  ('managed',   1, 'MRD-F017', 'Self-Directed Brokerage',  'Investing', 60000),
  ('managed',   2, 'MRD-F018', 'Roth Retirement Account',  'Investing', 48000),
  ('managed',   3, 'MRD-F019', 'Managed Portfolio',        'Investing', 120000)),
attach(k, line, item_id, family, category, value) AS (VALUES
  (0, 'fixed',     'MRD-F008', 'Auto Refinance',          'Auto', 18500),
  (1, 'variable',  'MRD-F013', 'Personal Line of Credit', 'Card', 20000),
  (2, 'revolving', 'MRD-F012', 'Voyager Travel Card',     'Card', 15000)),
deriv AS (
  SELECT i,
    CASE WHEN i % 20 < 8 THEN 'fixed' WHEN i % 20 < 11 THEN 'variable' WHEN i % 20 < 15 THEN 'deposit'
         WHEN i % 20 < 18 THEN 'revolving' ELSE 'managed' END AS line,
    (i / 20) % 4 AS k,
    CASE WHEN i % 3 = 0 THEN 1 ELSE 0 END AS att,
    (i / 3) % 3 AS ak
  FROM seq)
INSERT INTO mrd_purchase_items (order_id, item_id, line, family, category, value_usd)
SELECT 'mrdo-nc-f-' || printf('%04d', d.i), p.item_id, p.line, p.family, p.category, p.value
  FROM deriv d JOIN pool p ON p.line = d.line AND p.k = d.k
UNION ALL
SELECT 'mrdo-nc-f-' || printf('%04d', d.i), a.item_id, a.line, a.family, a.category, a.value
  FROM deriv d JOIN attach a ON a.k = d.ak
 WHERE d.att = 1;

WITH zips(z, zip) AS (VALUES
  (0,'27106'),(1,'27101'),(2,'27103'),(3,'27104'),(4,'27105'),(5,'27107'),(6,'27127'),
  (7,'27012'),(8,'27023'),(9,'27040'),(10,'27045'),(11,'27050'),(12,'27284'),(13,'27028')),
o AS (
  SELECT order_id, SUM(value_usd) AS total, COUNT(*) AS n, CAST(substr(order_id, -4) AS INTEGER) AS i
    FROM mrd_purchase_items WHERE order_id LIKE 'mrdo-nc-f-%' GROUP BY order_id)
INSERT INTO mrd_transactions (order_id, vuid, vertical, billing_region, billing_postal_code, order_total_usd, item_count, ts)
SELECT o.order_id, 'mrd-nc-f-' || printf('%04d', o.i), 'financial', 'NC', z.zip, o.total, o.n,
       1777593600000 + o.i * 27000000
  FROM o JOIN zips z ON z.z = o.i % 14;


-- ── Verify (the same queries src/demos/meridian/geoCohort.ts runs) ──
--   SELECT billing_postal_code, COUNT(DISTINCT vuid) FROM mrd_transactions
--    WHERE vertical='retail' GROUP BY 1;                                      -- every ZIP 22–23 (< 30)
--   SELECT x.metro_cbsa, COUNT(DISTINCT t.vuid) FROM mrd_transactions t
--     JOIN geo_xref x ON x.zip = t.billing_postal_code
--    WHERE t.vertical='retail' GROUP BY 1;                                    -- 35620: 320 · 49180: 320
--   SELECT i.line, COUNT(DISTINCT t.vuid) FROM mrd_purchase_items i
--     JOIN mrd_transactions t ON t.order_id = i.order_id
--    WHERE t.billing_region='NY' AND t.vertical='retail' GROUP BY 1 ORDER BY 2 DESC;  -- Drover > Linden > …
-- =============================================================================
-- END 0008_meridian_geo_cohort.sql
-- =============================================================================
