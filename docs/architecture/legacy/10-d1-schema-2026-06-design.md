# 10 — D1 Database Schema + Chat Tool/Query Surface

**Status:** design + DDL written, **seed planned (not run).**
**DDL:** [`migrations/0001_d1_init.sql`](../../migrations/0001_d1_init.sql) (applies cleanly; validated on SQLite 3.37.2 and the all-INTEGER money/STORED-generated-column path is portable to D1's newer engine).
**Source schema:** [`docs/architecture/coach_synthetic_schema.json`](./coach_synthetic_schema.json) · **Catalog:** [`data/coach-catalog.json`](../../data/coach-catalog.json) · **Synthetic data:** [`data/synthetic/`](../../data/synthetic/)

---

## 1. Why D1, and how it fits the demo

The real OPAL chat (Gemini on the Cloudflare Agents SDK) needs a **queryable Coach dataset** so it can answer "type-anything" merchandiser questions and draft audiences grounded in real numbers. D1 (Cloudflare's serverless SQLite at the edge) is the natural home: it sits in the same Worker runtime as the engine, needs no external dependency, and keeps us inside **"real seams, mocked calls"** — the chat's queries are real SQL over real (synthetic) rows; only the Optimizely *write* path is token-gated.

This schema also **demonstrates the fix to the brief's landmine #1** (the "Opal spinning on data" problem). The chat tools are **aggregate-then-reason**: they hand Gemini *counts and averages*, never raw warehouse rows. That is exactly the ODP pattern the brief argues for — query/aggregate first, give the model a workable representation.

### Table inventory (9 tables + 1 view)

| Layer | Table | Role | Seeded from |
|---|---|---|---|
| **Commerce (NEW)** | `coach_transactions` | (a) order/payment header — tender, tax/ship, status, gift | derived from `events.json` purchases + generated payment fields |
| **Commerce (NEW)** | `coach_purchase_items` | (b) purchase-history line items, FK to real catalog ids | `events.json` purchase `line_items[]` |
| **Dimension (NEW)** | `coach_catalog` | product dimension (71 real SKUs) so (b) FKs to real ids | `coach-catalog.json` |
| **Profile** | `coach_odp_profiles` | the **ODP runtime profile** the chat reasons over | `customers.json` (3,200) |
| **Export mirror** | `odp_events` | ODP/Zaius event export shape (58 populated cols) | generated to schema, Coach-themed |
| **Export mirror** | `odp_customers_authenticated` | ODP authenticated-customer export (36 cols) | generated, Coach-themed |
| **Export mirror** | `conversions` | Optimizely event export (22 cols) | generated, Coach-themed |
| **Export mirror** | `decisions` | Optimizely decision export (22 cols) | generated, Coach-themed |
| **Tooling** | `meta_attribute_catalog` | backs `list_attributes()` **and** is the condition allow-list | seed constant |
| **Tooling (view)** | `v_profiles` | profile ⨝ per-shopper purchase aggregates — the surface `estimate_audience`/`sample` read | — |

The four **export-mirror** tables prove schema fidelity to a technical buyer (they match the real Optimizely/ODP warehouse export exactly). The **profile + commerce** tables are what the chat actually queries.

---

## 2. SQLite/D1 type-mapping decisions

Source types come from `coach_synthetic_schema.json` `x-generator`/`x-dict`. Mapping into D1 (SQLite):

| Source | D1/SQLite | Notes |
|---|---|---|
| `str` | `TEXT` | |
| `int64` (epoch s/ms, counts, ids < 2^53) | `INTEGER` | |
| `int64` **snowflake ids** (`event_id`, `session_id`, `zaius_id` ≈ 3.8e18) | **`TEXT`** | D1's Workers API has **no BigInt** and is only safe to `Number.MAX_SAFE_INTEGER` (2^53 ≈ 9.0e15); storing these as INTEGER silently loses precision when read in the Worker. [1] |
| `float64` | `REAL` | enrichment metrics only (6sense revenue, timings, scroll). |
| `bool` | `INTEGER` (0/1) | D1 casts JS booleans to INTEGER. [1] |
| `0/1 flag stored as float` | `INTEGER` | normalized to a clean 0/1. |
| nested Optimizely BQ JSON wrapper | `TEXT` | `attributes`/`layer_states`/`experiments` keep `{"v":[{"v":{"f":[...]}}]}` verbatim. |
| display datetime (`"May 20, 8:03PM"`) | `TEXT` | schema note says **recommend ISO 8601 in DB** — seed writes ISO. |

Cross-cutting choices:

- **`STRICT` tables everywhere** — D1 best practice to prevent type drift. [2] (STRICT allows only INT/INTEGER/REAL/TEXT/BLOB/ANY, which our mapping respects.)
- **Money is `INTEGER` whole USD** across `coach_catalog`, `coach_transactions`, `coach_purchase_items`. This matches the whole-dollar source (`order_total_usd`, catalog `price_usd`) and the INTEGER profile `average_order_value_usd`, and it is fully STRICT-safe with STORED generated columns on every SQLite version (a REAL generated total trips a STRICT-table bug in SQLite < 3.38). Cents add nothing to a synthetic demo.
- **STORED generated columns** [3] for deterministic derivations: `coach_catalog.price_band` (entry/core/elevated from `price_usd`), `coach_purchase_items.line_total_usd` (`unit_price × qty`), `coach_transactions.amount_usd` (`subtotal − discount + tax + shipping`), and `*.order_date` = `date(order_ts/1000,'unixepoch')` so "last 90 days" is a cheap indexed `WHERE order_date >= date('now','-90 days')`.
- **Populated columns only.** The ~63–74% of superset columns empty in the sample are omitted (schema-present null); this is documented in the DDL header.
- **Partial indexes** [3] on known-identity cuts (`WHERE customer_id IS NOT NULL`).

### Per-table conventions preserved (do **not** normalize across tables)

From `coach_synthetic_schema.json` `x-conventions`:

| Convention | `odp_events` | `odp_customers_authenticated` | `conversions`/`decisions` | commerce/profile (new) |
|---|---|---|---|---|
| **country** | ISO-3 lowercase `usa` | full name `United States` | n/a | ISO-2 `US` (profile, as `customers.json`); ISO-3 lowercase `usa` (`coach_transactions.billing_country`) |
| **ip** | **full** ipv4 | n/a | **anonymized** (last octet `.0`) | none (PII minimization) |
| **sparsity** | preserve (nullable PII/enrichment stays mostly NULL) | preserve (B2B enrichment sparse) | preserve | profile PII sparse; `customer_id`/`email` NULL for anonymous-first |

---

## 3. The chat's tool / query surface (aggregate-then-reason, never raw rows)

Three tools, exposed to Gemini. **All three compile to parameterized SQL; none ever returns raw warehouse rows to the model.** Conditions use the **same `AudienceCondition` tree** as `src/connectors/types.ts` (`['and'|'or'|'not', {attribute, operator, value}, …]`), so an audience the chat estimates here maps 1:1 onto what `MockSegmentProvider`/Opal publishes — same field-name contract as `data/synthetic/README.md`.

### 3.1 `list_attributes()` → attribute catalog

Returns the queryable attribute registry from `meta_attribute_catalog`: `{ key, kind, sql_type, domain_kind, operators[], enum_values[]?, example, description }`. Two jobs:
1. Tells Gemini **what it can filter on** (profile, behavior, purchase, product, identity) and the legal operators/domains per attribute.
2. Is the **allow-list / injection guard** — the condition compiler rejects any `attribute` not present here *before* building SQL.

Representative attributes (full set seeded in migration 0002):

| key | kind | type | maps to |
|---|---|---|---|
| `viewed_product_line`, `journey_stage`, `cart_adds`, `product_views`, `cart_abandoned` | behavior | TEXT/INT | `coach_odp_profiles.*` |
| `favorite_line`, `loyalty_tier`, `engagement_rank`, `order_likelihood`, `predicted_ltv_usd`, `average_order_value_usd` | profile | TEXT/INT/REAL | `coach_odp_profiles.*` |
| `bought_line`, `orders_90d`, `spend_90d_usd`, `aov_90d_usd`, `aov_all_usd`, `last_order_ts` | purchase | TEXT/INT | `v_profiles.*` (purchase aggregates) |
| `segment` | identity | TEXT | `segments_json` (LIKE) |

### 3.2 `estimate_audience(conditions)` → evidence (aggregates only)

Compiles `conditions` → a `WHERE` over **`v_profiles`**, runs two aggregate queries (scalar stats + a small grouped "top lines/products"), and returns the **same evidence shape as `insights.json` `stats`**:

```jsonc
{ "size": 114, "pct_of_base": 3.6, "avg_order_value": 320, "avg_order_likelihood": 0.259,
  "avg_lifetime_value": 1180, "avg_predicted_ltv": 1450, "known_identity_pct": 60.5,
  "top_lines": [{"line":"Tabby","n":71}, …], "top_products": [{"product_id":"COA-CY201","n":33}, …] }
```

Scalar query (validated):

```sql
SELECT COUNT(*) AS size,
       ROUND(100.0*COUNT(*)/(SELECT COUNT(*) FROM coach_odp_profiles),1) AS pct_of_base,
       ROUND(AVG(average_order_value_usd),0) AS avg_order_value,
       ROUND(AVG(order_likelihood),3)        AS avg_order_likelihood,
       ROUND(AVG(lifetime_value_usd),0)      AS avg_lifetime_value,
       ROUND(AVG(predicted_ltv_usd),0)       AS avg_predicted_ltv,
       ROUND(100.0*SUM(customer_id IS NOT NULL)/COUNT(*),1) AS known_identity_pct
FROM v_profiles
WHERE <compiled conditions>;
```

### 3.3 `sample(conditions, n)` → bounded, redacted examples

`SELECT … FROM v_profiles WHERE <compiled> LIMIT min(n, 25)` projecting **only non-PII** fields — masked vuid, `favorite_line`, `journey_stage`, `engagement_rank`, AOV bucket, `known` boolean. **Never** `email`/`name`/`ip`/full `vuid`. `n` is hard-capped (25) so a tool call can't exfiltrate the table.

### 3.4 Condition compiler (operator → SQL)

| op | SQL | notes |
|---|---|---|
| `eq`/`neq` | `= ?` / `!= ?` | value bound as parameter |
| `gt`/`gte`/`lt`/`lte` | `> ? / >= ? / < ? / <= ?` | numeric range |
| `in` | `IN (?,?,…)` | |
| `contains` | `col LIKE '%'||?||'%'` | for comma-list cols (`bought_lines`, `bought_categories`) and `segments_json` |
| `exists` | `col IS NOT NULL` | |

`['and'|'or'|'not', …]` → nested `AND`/`OR`/`NOT (...)`. Every `attribute` is validated against `meta_attribute_catalog`; every value is a bound parameter (`?`) — **no string interpolation**.

**Worked example — "high-AOV customers who bought Tabby in the last 90 days"** (validated end-to-end):

```
["and", {"attribute":"bought_line","operator":"contains","value":"Tabby"},
        {"attribute":"aov_90d_usd","operator":"gte","value":400},
        {"attribute":"orders_90d","operator":"gt","value":0}]
```
compiles to:
```sql
SELECT COUNT(*) AS size, ROUND(AVG(aov_90d_usd),0) AS avg_aov_90d
FROM v_profiles
WHERE bought_lines LIKE '%'||?||'%' AND aov_90d_usd >= ? AND orders_90d > ?;
```
`v_profiles` supplies `bought_lines` (`group_concat(DISTINCT line)` from `coach_purchase_items`), `aov_90d_usd`/`orders_90d` (from `coach_transactions WHERE order_date >= date('now','-90 days')`, excluding refunds). Demo data is anchored to ~now (generator `EPOCH_NOW = 2026-06-25`), so the 90-day window lands on real rows.

---

## 4. Seeding plan (NOT run yet)

Add a deterministic emitter `scripts/seed-d1.mjs` (same contract as `scripts/generate-synthetic-data.mjs`: seeded **Mulberry32 PRNG**, fixed `EPOCH_NOW = 2026-06-25T17:00:00Z`, no `Math.random`/`Date.now` — byte-identical re-runs). It **writes SQL files** (does not call the network):

| Output file | Rows | Source → transform |
|---|---|---|
| `migrations/0002_seed_catalog.sql` | 71 + attribute catalog | `coach-catalog.json` → `coach_catalog` (`colors`/`occasion` → JSON strings, `lead_color = colors[0]`); `meta_attribute_catalog` constant. |
| `migrations/0003_seed_profiles.sql` | 3,200 | `customers.json` → `coach_odp_profiles` (identifiers + attributes + `segments` → `segments_json`). Anonymous-first sparsity preserved (`customer_id`/`email` NULL ≈ 1,141 rows). |
| `migrations/0004_seed_commerce.sql` | 7,293 orders + ~9k items | `events.json` purchases → one `coach_transactions` per `order_id` (map `order_total_usd→subtotal_usd`, `is_gift`, `item_count`, `device`, identifiers; **generate** `tender_type` (weighted: card 62% / paypal / apple_pay / google_pay / affirm / afterpay / gift_card), `card_network`+`card_last4` (NULL for wallets/BNPL), whole-dollar `tax_usd ≈ round(0.08875×subtotal)`, `shipping_usd` (0 above free-ship threshold), `status` (~3% refunded), `gift_wrap` ⊂ `is_gift`, `billing_country='usa'`). `line_items[]` → `coach_purchase_items` with `line`/`category`/`subcategory`/`price_band`/`colorway` denormalized via catalog lookup. |
| `migrations/0005_seed_export_mirror.sql` | ~8k events / ~2k auth / ~1k conv / ~1k dec | Generate per `coach_synthetic_schema.json` `x-generator` hints, **Coach-themed**: `page='/products/tabby-shoulder-bag-26/CH857.html'`, `hostname='www.coach.com'`, `title='… | Coach'`, `country='usa'` (events) / `'United States'` (customers); preserve population_rate sparsity, full IP (events) vs anonymized `.0` (conv/dec), and exp_id→var_id consistency in the BQ JSON. |

**Generation rules to honor the import constraints** [4]: emit `CREATE TABLE IF NOT EXISTS` is already in 0001; seed files contain **only INSERTs**, **no `BEGIN TRANSACTION`/`COMMIT`**, batched to **≤ ~50–100 rows per `INSERT`** to avoid "Statement too long".

**Apply order** (parents before children for FKs; or `PRAGMA defer_foreign_keys=true`): 0001 schema → 0002 catalog → 0003 profiles → 0004 commerce → 0005 mirror.

```bash
# wrangler.toml: add the binding
# [[d1_databases]]
#   binding = "DB"
#   database_name = "coach_demo"
#   database_id = "<from: wrangler d1 create coach_demo>"
#   migrations_dir = "migrations"

npx wrangler d1 create coach_demo
npx wrangler d1 migrations apply coach_demo --local     # then: --remote
# (alternatively per file:)  npx wrangler d1 execute coach_demo --local --file=migrations/0004_seed_commerce.sql
npx wrangler d1 execute coach_demo --local --command "SELECT name FROM sqlite_schema WHERE type='table';"
```

Sizing: ~3.2k profiles + ~7.3k orders + ~9k items + ~12k mirror rows ≈ a few MB — far under D1's **10 GB** ceiling and **1 MiB** row limit. [5] `wrangler d1 execute --file` allows up to 5 GiB. [4]

---

## 5. Sources

1. Workers Binding API — type conversion (INTEGER 64-bit / no BigInt / safe to `Number.MAX_SAFE_INTEGER`; booleans → INTEGER): https://developers.cloudflare.com/d1/worker-api/
2. Query a database — recommends STRICT tables to avoid type mismatches: https://developers.cloudflare.com/d1/best-practices/query-d1/
3. SQL statements / feature support — STRICT, generated columns, partial indexes, CHECK constraints: https://developers.cloudflare.com/d1/sql-api/sql-statements/
4. Import & export data — `wrangler d1 execute --file` (5 GiB limit), drop `BEGIN/COMMIT`, split large INSERTs: https://developers.cloudflare.com/d1/best-practices/import-export-data/
5. Limits — 10 GB max database size, 1 MiB max row size, 6 connections/invocation: https://developers.cloudflare.com/d1/platform/limits/
