# D1 Schema — `coach-demo-db` (as-built)

**Status:** seeded and live, verified 2026-07-08. The original design doc (with the full type-mapping rationale) is preserved at [legacy/10-d1-schema-2026-06-design.md](./legacy/10-d1-schema-2026-06-design.md); this doc reflects what exists. **Migrations are normative** — when in doubt, read `migrations/`.

- Database `coach-demo-db`, binding `DB` (`wrangler.toml`). All tables STRICT; snowflake-style ids as TEXT; money as INTEGER whole USD with STORED generated helper columns; partial indexes on hot paths.
- **Seed state:** applied. Synthetic base = 3,200 profiles / 7,293 orders / ~8,760 line items (`migrations/seed/seed_001…seed_011_geo.sql`; generator `scripts/generate-synthetic-data.mjs`, epoch 2026-06-25, seeded RNG). Live tables accrue at runtime.

## Inventory — 14 tables + 3 views

| Object | Migration | Content | Consumers |
|---|---|---|---|
| `coach_catalog` | 0001 | 71 SKUs, full 6-axis taxonomy (line/category/subcategory/silhouette/occasion/price + generated `price_band`) | Opal `queryData`, reflex dimensions, recs |
| `coach_transactions` | 0001 | synthetic order headers (7,293) | Opal, insights |
| `coach_purchase_items` | 0001 | line items, denormalized line/category/price_band | Opal, geo cohort |
| `coach_odp_profiles` | 0001 | ODP-shaped profiles (~60 cols: identity, aggregates, favorites, realtime snapshot, predictions, persona) | Opal, geo cohort |
| `meta_attribute_catalog` | 0001 (seeded in `seed_001`) | the 35-attribute audience whitelist (condition-compiler guard) | audience tooling |
| `odp_events` | 0001 | 58-col ODP event-export mirror — **schema-fidelity artifact, currently unseeded/empty** | none (excluded from Opal) |
| `odp_customers_authenticated`, `conversions`, `decisions` | 0001 | export-mirror fidelity tables — **unseeded/empty** | none |
| `v_profiles` (view) | 0001 | profiles ⋈ purchase aggregates (incl. 90-day windows, `bought_lines`) | Opal |
| `demo_events` | 0002 | **live** storefront/funnel event capture (product_id, line, price, path, dwell); reset via `POST /operator/events/reset` | Opal, experiment readouts, operator stats |
| `v_demo_profiles` (view) | 0002 | live demo events rolled up to the profile shape | Opal |
| `v_audience_base` (view) | 0002 | `v_profiles UNION ALL v_demo_profiles` — **the audience-building surface** (Opal's primary) | Opal system prompt + tools |
| `funnel_seed`, `funnel_live` | 0003 | Revenue Radar funnel baseline + live counters | funnel compute/sim |
| `geo_census`, `geo_xref` | 0004 | **real** public census (income/home value) + ZIP→metro/region crosswalk (seeded by `seed_011_geo`) | geo cohort |

Notes: no `ALTER TABLE` anywhere — evolution is add-only objects per migration. The four export-mirror tables exist to prove schema fidelity and are deliberately empty (decide at productization: seed or remove).

## Access surface (as-built)

The chat/tool surface is **one guarded read-only tool**: Opal's `queryData` — single-SELECT only, table allow-list (`coach_catalog, coach_transactions, coach_purchase_items, coach_odp_profiles, meta_attribute_catalog, v_profiles, v_demo_profiles, v_audience_base, demo_events, geo_census, geo_xref`), forced `LIMIT 200`. Schema knowledge lives in the Opal system prompt. (The design doc's `list_attributes()/estimate_audience()/sample()` trio was superseded by this.)

## Operations

```bash
# local
npx wrangler d1 migrations apply coach-demo-db --local
for f in migrations/seed/seed_*.sql; do npx wrangler d1 execute coach-demo-db --local --file "$f"; done
# remote: same commands with --remote
```

Demo-run hygiene: `POST /operator/events/reset` clears **only** `demo_events` (synthetic history is never touched).
