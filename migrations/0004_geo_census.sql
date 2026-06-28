-- =============================================================================
-- 0004_geo_census.sql  ·  Coach / Tapestry — Geo-Cohort Cold Start
--   Two NEW reference tables for the "anti-MasterCard" cold start:
--     geo_census — REAL public ACS/IRS figures (median HH income + home value)
--     geo_xref   — ZIP → metro(CBSA) → region(state) → country crosswalk
--   See docs/architecture/13-geo-cohort-coldstart-prd-tdd.md §7 (TDD) / §8 (figures).
-- =============================================================================
-- Target: Cloudflare D1 (SQLite engine, STRICT tables). Apply LOCAL then REMOTE:
--   npx wrangler d1 execute coach-demo-db --local  --file=migrations/0004_geo_census.sql
--   npx wrangler d1 execute coach-demo-db --remote --file=migrations/0004_geo_census.sql
-- then seed with migrations/seed/seed_011_geo.sql.
--
-- ADD-ONLY, exactly like 0002_demo_events.sql / 0003_funnel_seed.sql: we CREATE …
-- IF NOT EXISTS and never ALTER an existing table, so the proven base seed (3,200 /
-- 7,293 / 8,760 rows) is left byte-identical and needs no re-seed.
--
-- HONESTY (doc 13 §3/§10 — load-bearing):
--   * geo_census rows are REAL public-domain data (17 U.S.C. §105), cited per-row in
--     `source` + `vintage`. NEVER invent figures; representative rows say so in `source`.
--   * geo_xref is the warehouse-equivalent dimension a real customer already has, so the
--     roll-up maps a REAL detected ZIP to metro/region WITHOUT trusting the random
--     synthetic billing_postal_code on the historical commerce rows.
--   * NO foreign keys: these are dimension/reference tables, not commerce — and a stray
--     ZIP from a live edge hit must never reject a lookup (the demo must not break).
-- =============================================================================


-- =============================================================================
-- 1. geo_census — REAL public median household income + median home value, keyed by
--    (geo_level, geo_key). The ONLY real-public layer in the cohort payload.
--      geo_level : 'national' | 'region' | 'metro' | 'county' | 'city' | 'zip'
--      geo_key   : 'US' | 2-letter state | CBSA code | county FIPS | city slug | ZIP
--    Income = ACS table B19013; home value = ACS table B25077 (home value often
--    discriminates LUXURY affluence better than income). vintage = the data year.
-- =============================================================================
CREATE TABLE IF NOT EXISTS geo_census (
  geo_level             TEXT    NOT NULL,            -- national|region|metro|county|city|zip
  geo_key               TEXT    NOT NULL,            -- US | NC | 49180 | 37067 | winston-salem-nc | 27106
  label                 TEXT    NOT NULL,            -- human-facing geography label (cite on stage)
  median_hh_income_usd  INTEGER,                     -- ACS B19013 (nullable — not every row has it)
  median_home_value_usd INTEGER,                     -- ACS B25077 (nullable)
  source                TEXT    NOT NULL,            -- e.g. 'Census ACS 2024' | 'IRS SOI TY2022' | representative
  vintage               TEXT    NOT NULL,            -- e.g. '2024'
  PRIMARY KEY (geo_level, geo_key)
) STRICT;


-- =============================================================================
-- 2. geo_xref — ZIP → metro(CBSA) → region(state) → country crosswalk.
--    Lets resolveGeoRollup() walk a REAL detected ZIP up the ladder
--    (ZIP → metro → region → national) and join to geo_census at each grain,
--    independent of the historical rows' random billing_postal_code.
-- =============================================================================
CREATE TABLE IF NOT EXISTS geo_xref (
  zip        TEXT PRIMARY KEY,                       -- 5-digit ZIP (TEXT preserves leading zeros)
  metro_cbsa TEXT,                                   -- CBSA code → geo_census(geo_level='metro', geo_key)
  region     TEXT,                                   -- 2-letter state → geo_census(geo_level='region', geo_key)
  country    TEXT                                    -- ISO-2 country ('US')
) STRICT;


-- =============================================================================
-- 3. Indexes — roll-up + census-join access paths (the PKs cover the rest).
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_geo_census_level  ON geo_census(geo_level);
CREATE INDEX IF NOT EXISTS idx_geo_xref_metro    ON geo_xref(metro_cbsa);
CREATE INDEX IF NOT EXISTS idx_geo_xref_region   ON geo_xref(region);

-- =============================================================================
-- END 0004_geo_census.sql
-- =============================================================================
