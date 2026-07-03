# 13 — Geo-Cohort Cold Start (the anti-MasterCard cold start) — PRD + TDD

**Status:** ✅ **BUILT & VERIFIED on the dev worker (2026-06-27)** — all §9 decisions approved by the SA and shipped. This doc is the **shareable spec** (design + sources + as-built) for the product/eng teams. See **§12 (as-built & verified)** for what shipped + how it was verified.
**Owner:** Solutions Architecture (the SA presenting the Coach/Tapestry renewal).
**Reads against:** [`../DEMO-MASTER-PLAYBOOK.md`](../DEMO-MASTER-PLAYBOOK.md) · [`../REVENUE-RADAR-TDD.md`](../REVENUE-RADAR-TDD.md) · existing cold start (`applyGeoColdStart`/`_coldHero` in `public/storefront.js`, `src/routes/geo.ts`) · the "Neighborhood vs Shopper" anti-DY button in `public/revenue-radar.js`.

---

## 0. The problem (why cold start is the weak beat today)
Today's cold start = edge geolocation → "Hello from {city}" + a season swap. It proves we **know where you are** — not the **value**. The whole pitch is "use *your own* data warehouse"; the cold start should *show that*.

## 1. The idea (one line)
A brand-new visitor with **no profile** → infer a **geo-cohort** from (a) the customer's OWN first-party purchase history for that geography and (b) **free public census income data**, and open the store on **what shoppers like them, from there, actually buy.** The first-party, intent-rich answer to Dynamic Yield's MasterCard neighborhood targeting.

## 2. The anti-Dynamic-Yield narrative (SCRIPT-READY)
- **DY genuinely ships a Mastercard-powered cold-start geo product** ("Element" / "Geo-based Predictive Targeting," 2023): it targets **anonymous first-time visitors by ZIP** using Mastercard's **aggregated, anonymized category-spend AVERAGES** to guess what they want. Our premise is **accurate — not a strawman.**
- **Two precision facts keep us honest AND sharp:** it's **ZIP/city, not "neighborhood"** ("neighborhood" is DY's 2018 marketing glossary, not a real product granularity); and the Mastercard signal is a **third-party, market-wide AVERAGE — historical spend across all merchants, never your customers' purchase intent.**
- **Our answer (the wow):** (a) your OWN customers' actual purchases in that geography — **first-party intent, owned, a moat** no competitor can rent; (b) **free public census income**, which recovers most of the neighborhood-affluence signal **at the aggregate level**; (c) we treat geo as a **coarse opening prior we REPLACE with real behavior the instant they engage.** Tapestry already has the first-party hooks: store ZIP, online shipping/billing ZIP, registration ZIP (the extended-warranty signup — a real ZIP + a real SKU).
- **Don't overclaim:** third-party spend still earns its keep for net-new prospecting / share-of-wallet / category whitespace — we're **complementary** there, not opposed.
- **The lines:**
  - *"Dynamic Yield rents the neighborhood's average wallet. We use your own receipts — and the census data is free."*
  - *"DY knows this neighborhood spends $X on apparel. We know your customers here carry the Tabby in pebbled leather at the $395 band — because they told you when they bought one."*
  - *"They guess the neighborhood. We know what shoppers like them, from right here, actually bought — even someone we've never seen."*
- **It compounds:** geo-cohort is the opening hypothesis → sharpens into a live **persona** the moment they engage (existing engine). Geo-cohort → persona is the staircase.

## 3. The honesty model (CRITICAL — why it's believable)
> **Identification is REAL** (edge geolocation via `request.cf` — the visitor really is in Winston-Salem). **The query is REAL** (the same op as production). **Only the data is SWAPPED** — synthetic Tapestry data today → the customer's real warehouse later. *"A real operation querying synthetic data, but the identification was real and the query was real. We just swapped their data — and people can relate to that."*

Stronger than "simulate a visitor": nothing about the *operation* is faked; only the data content is swapped, via a real query, **swappable to prod with zero change to the operation.** We never fabricate the location. **Implement it by mirroring `src/routes/signals.ts`** (which already overlays the REAL `request.cf` region onto mock data + rides honesty metadata) — every cohort payload carries `granularityUsed`, `sampleSize`, `dataSource:'synthetic'→'warehouse'`, `censusSource`.

## 4. Granularity & realism — the "Winston-Salem problem" (now quantified)
- **Never fake the location.** Use the real detected geo. `/geo` already returns real `city/region/regionCode/postalCode/colo` from `request.cf` (`geo.ts:25-38`) — the identification side needs nothing. (Caveat: `request.cf` is empty under local preview; `city/postalCode` best-effort even live — degrade to national if null; keep the ⌘K force-geo path as labeled QA only.)
- **Counter-intuitive finding (research B):** census median income stays **reliable all the way down to the ZIP** in Winston-Salem (coefficient of variation < 8%). **The census layer does NOT break at ZIP.** What actually forces a roll-up is **your own first-party purchase count** — one store's buyers from a single ZIP may be N=4.
- **Roll-up ladder (gate on first-party N, not census):** **ZIP** (use only if census CV ≤ 15% **and** first-party N ≥ ~30–50 buyers) → **metro/CSA (Piedmont Triad)** → **region (NC)** → **national.** Stop at the first level that clears the threshold, and **surface the grain used** ("cohort = Piedmont Triad metro, N=312") — which *strengthens* realism and is the fair-use posture (§10).
- Don't render income **below ZIP** (tract/block group) without a CV check; don't surface a cohort below the first-party threshold (reads as redlining + is noise).

## 5. The demo moment (draft — refine after thread A)
1. New visitor, no profile → real geo resolves (Winston-Salem, NC, ZIP 27101/27106, colo CLT).
2. **Activity panel / Opal** narrates the *real query*: *"Cold start, no history. This geo: median HH income ~$65.9k metro (Census ACS 2024) · N past Coach shoppers from {grain used} — they bought Tabby & Brooklyn, $300–450 band, high charm-attach. Opening on the geo-cohort edit."*
3. **Hero + curated grid** lead with that cohort's real winners (lines/products/price band).
4. **Punchline — re-enable the hidden "◑ DY vs us" modal:** DY/MasterCard "ZIP avg, third-party, no intent" vs your first-party "shoppers from here bought these — real intent, your own data."
5. First browse/click → existing realtime persona engine takes over.

## 6. MasterCard ≈ census — the proof (the "money shot")
**The neighborhood-affluence axis MasterCard sells is sitting in free public data, and the gradient inside one city is dramatic** (real ACS 2024, research B):
- **Winston-Salem ZIP 27106 ≈ $68,568 HH income / $313,100 home value** (affluent NW) vs **ZIP 27101 ≈ $44,198 / $221,000** (central/east) — a **~$24k income / ~$92k home-value gap between two ZIPs in the same city.**
- Metro contrast: **WS metro ≈ $65,903** vs **Charlotte ≈ $85,938**, **Raleigh ≈ $102,144**; **NC ≈ $73,958**, **US ≈ $81,604.**
- **Data sources (free, public domain — 17 U.S.C. §105):** Census **ACS** — median HH income `B19013`, median home value `B25077` (home value often discriminates *luxury* affluence better than income), down to ZIP/tract via the 5-yr file; **IRS SOI** — share of **$200k+ AGI returns** per ZIP as an enrichment (ZIP-only, lagged, suppressed in thin ZIPs). Lead with ACS income + home value; tilt with IRS high-AGI share.
- **The correlation is real and peer-reviewed (research A):** census income ↔ the SES/home-value bundle **r = 0.82–0.98** (Oka 2022); card-spend ↔ official retail sales **r = 0.94** (Fed 2024); top-income-quartile ZIPs drove **41%** of the COVID spending drop vs **12%** for the bottom (Chetty, QJE 2024); the top income quintile spends **4.3×** the bottom (BLS 2024). The paid third-party spend premium largely buys what **free census income already implies — at the neighborhood-aggregate level.**
- **⚠️ The caveat that makes us bulletproof (do NOT ignore it):** the Fed's "Lost in Aggregation" (2025) shows ZIP-median income mismeasures *households* by **35–75%**, and ZIP aggregation can flatten real spending differences. So "spend ≈ census income" holds at the **aggregate/segment level, NOT the household level** — which is *exactly* why geo is only our **opening prior** and we **replace it with first-party behavior the moment the visitor engages.** Framed this way, no analyst can dent it.

## 7. TDD — technical design (from the codebase audit, research C)
**Audit (what we have today):**
- **Identification (REAL):** `GET /geo` returns full `request.cf` (`geo.ts:25-38`) — complete, no work needed.
- **Synthetic geo (the gap):** finest grain = **US-state + one token city/state**; **ZIP is random noise** (`seed-d1.mjs:320`); **no metro tier; NC does not exist at all** (region distribution: CA/NY/TX/FL/ON…; `'NC'` = 0 rows in profiles and transactions). So a real Winston-Salem cold start rolls all the way to national → **a minimum data extension is required** (§8).
- `v_audience_base` exposes `country,region` but **not city/postal** → metro/ZIP cohorts must read base tables (`coach_transactions` ⋈ `coach_purchase_items` + a crosswalk), region cohorts can use the view.

**Design:**
- **`geo_census`** (NEW table) — `geo_level, geo_key, label, median_hh_income_usd, median_home_value_usd, source, vintage`; **real public ACS/IRS rows** (the only real-public layer).
- **`geo_xref`** (NEW table) — `zip → metro(CBSA) → region(state) → country`; lets the roll-up map a real ZIP to metro/region **without trusting the random `billing_postal_code`**, and is exactly the dimension a real warehouse has (swap-equivalent).
- **Cohort aggregate — computed live, never stored** (so it's identical against a warehouse): resolved geo → `coach_transactions ⋈ coach_purchase_items` → top lines, top SKUs, modal price band, attach rate, AOV, browse→buy; `+ geo_census` for income.
- **`resolveGeoRollup(geo)`** — the ladder in §4 (gate on first-party N + census CV), returns `granularityUsed` + `sampleSize`.
- **Source-agnostic `GeoCohortSource`** interface — `D1SyntheticSource` now, `WarehouseSource` stub later; service depends on the interface (mirrors `getConnectors(env)`). Swap = change the impl, **zero change** to route/tool/UI.
- **Shared brain `src/services/geo/cohort.ts`** (`computeGeoCohort` + `resolveGeoRollup`) consumed by BOTH a thin `GET /geo/cohort` route AND an Opal `geoCohort` tool — the same triangle as `diagnose.ts / funnel.ts / diagnoseFunnel.ts` (chat & storefront produce identical numbers).
- **Opal vs query → both, split by role:** the mechanical query is the **engine** (deterministic, <50ms, no LLM in the first-paint path); **Opal narrates on top** via a `geoCohort` tool wrapping the same `computeGeoCohort` (so its words match the painted numbers). `queryData` can already answer "what do NC shoppers buy?" the moment NC data exists.
- **End-to-end (Winston-Salem):** land → `/geo` (real) → `applyGeoColdStart` also calls `/geo/cohort?zip=27101&region=NC` → `resolveGeoRollup` → cohort aggregate + census → cohort hero (`_coldHero` branch) + cohort grid (`curatedItems` ranks by `topLines`/`priceBand`) + rich `logActivity` card + the re-enabled DY-vs-us modal → first click → persona engine.

**File-by-file:**
- **ADD:** `migrations/0004_geo_census.sql` (`geo_census`+`geo_xref`), `migrations/seed/seed_011_geo.sql` (real census + xref + additive NC/Triad cohort), `src/services/geo/cohort.ts` (shared brain), `src/agents/tools/geoCohort.ts` (Opal tool), optional `src/data/geo-census.json`.
- **TOUCH:** `src/routes/geo.ts` (add `GET /geo/cohort`; already mounted), `public/storefront.js` (`applyGeoColdStart`/`_coldHero`/`curatedItems` cohort branches + a Winston-Salem ⌘K entry), `public/revenue-radar.js` (un-comment the `◑ DY vs us` button `:356-357`; parameterize `buildContrast(opts)` with real geo+census+cohort), `src/agents/OpalAgent.ts` + `tools.ts` (register `geoCohort`; add `geo_census`/`geo_xref` to `ALLOWED_TABLES`).

## 8. Research findings folded in
**Real demo figures (ACS 2024; cite on stage) — research B:**

| Geography | Median HH income | Median home value | Note |
|---|---|---|---|
| United States | $81,604 | $360,600 | reference |
| North Carolina | $73,958 | $333,000 | state |
| **Winston-Salem METRO** (CBSA 49180) | **$65,903** | $270,700 | **headline grain (most stable)** |
| Forsyth County | $65,768 | $290,400 | |
| Winston-Salem CITY | $57,758 | $281,200 | city < county < metro (grain matters) |
| **ZIP 27106** (NW, affluent) | **$68,568** | **$313,100** | the gradient ↓ |
| **ZIP 27101** (central/east) | **$44,198** | **$221,000** | ~$24k / ~$92k gap, same city |
| Charlotte METRO | $85,938 | $400,400 | contrast |
| Raleigh METRO | $102,144 | $465,800 | contrast |

Sources: Census ACS via Census Reporter / data.census.gov tables B19013 (income), B25077 (home value), 2024 vintage; IRS SOI ZIP data (TY2022) for $200k+ AGI share. All public domain.

**Synthetic-data audit + minimum extension — research C:** today there is **no NC coverage**; finest grain = state; ZIP random; no metro tier. **Minimum extension (no full regen, additive like `0002_demo_events.sql`):** (1) `geo_census` real rows (ZIP 27101/27106, Triad CSA, Forsyth, NC, the 15 existing-state metros, national); (2) `geo_xref` zip→metro→region; (3) `seed_011_geo.sql` — a few hundred `coach_odp_profiles`+`transactions`+`purchase_items` rows tagged NC/Triad/realistic Triad ZIPs so `region=NC` (and metro) clears the threshold. Existing seed untouched.

**DY / Mastercard mechanics — research A (verified, adversarially fact-checked; citations in the agent memo):**
- **Ownership:** McDonald's acquired DY (2019, ~$300M *reported*), **sold it to Mastercard (closed Apr 2022)**; now branded **"Dynamic Yield by Mastercard."**
- **The exact product we're countering:** DY **"Element"** (2023) embeds Mastercard's **aggregated/anonymized geo spend insights + SpendingPulse + propensity models**; its **"Geo-based Predictive Targeting"** is an explicit **cold-start** tool for anonymous/first-time visitors, **ZIP-level**, scoring "locations with high probability/history to spend" across preset categories. (So DY *does* have a geo cold-start — our edge is the *kind* of data, not a missing feature.)
- **Mastercard data products:** SpendingPulse (county, all tender), **Mastercard Audiences** (Zip+4 aggregated spend segments), Test & Learn, Geo Insights — ~25 paid products. **Limits (the wedge):** aggregated AVERAGES not individual intent; historical not forward; Mastercard-network-only; sparse cells suppressed; "anonymized ≠ anonymous" (MIT: 4 purchases re-identify 90%); licensing cost + privacy scrutiny.
- **First-party wins where it counts (peer-reviewed):** off-the-shelf **third-party segments perform no better than random**, while **first-party outperforms both** (Neumann/Tucker, QME 2023); first-party is deterministic, owned (no per-impression CPM), and a moat. Honest complement: third-party still helps for net-new / share-of-wallet / whitespace.
- **Overreaches to avoid** (baked into §11): no "$320M Mastercard price" (undisclosed; ~$300M was McDonald's 2019 buy); not "neighborhood/household-level" (it's ZIP/city); DY does **not** hand merchants individual transactions; census ≠ an individual's income; first-party isn't automatically "cleaner."

## 9. Decisions (for us to make together)
1. **Granularity to ship:** recommend **metro/region as the headline** for WS (most stable; ZIP only when N+CV clear), per §4. ✅?
2. **Synthetic-data extension:** the **additive `seed_011_geo.sql` + `geo_census`/`geo_xref`** (no full regen). ✅?
3. **Re-enable the "◑ DY vs us" button** as the anchor (it's intact, one-line un-comment). ✅?
4. **Opal + query split** (query = engine, Opal = narration backed by the same numbers). ✅?
5. **Build scope:** extend `applyGeoColdStart` (not a rebuild) + the 2 new tables + the shared `cohort.ts` + the `/geo/cohort` route + the Opal tool.

## 10. Honesty & fairness guardrails (research B — load-bearing)
- **Never claim we have/replicate MasterCard data** — the point is we don't need it.
- Census = **real public** (cite, with vintage); first-party patterns = **representative/synthetic** (labeled, swap-to-warehouse); geo = **real**. Never invent figures. Never say census tells you *this visitor's* income (it's a neighborhood aggregate — say "shoppers *like* them, from here").
- **Personalize MERCHANDISING only — curate, never gate or price.** This is the bright line between "tailored storefront" (normal retail) and "digital redlining" (the Staples / Princeton Review ZIP-pricing cases). Fair-lending law (ECOA/FHA) governs **credit/housing**, not which handbag you feature — but **never tie the geo-cohort signal to any credit/BNPL/financing decision** (that pulls ECOA in), and **FTC §5 + optics always apply.**
- Use **affluence (income/home value) + first-party purchase intent — NEVER protected classes** (race, national origin, religion, sex, age, disability, familial status) **or a ZIP used as a proxy for one** (FTC 2016: ZIP can implicate race → disparate impact).
- **Aggregate, never individual; additive, never suppressive; show the grain used.**

## 11. Script-safe vs DO-NOT-SAY (carry verbatim — research B)
**SAY (backed):**
- *"Dynamic Yield — now owned by Mastercard — ships a Mastercard-powered cold-start tool that targets anonymous visitors **by ZIP** using **aggregated category-spend averages**. A third-party market average, no purchase intent. That same affluence signal is in free, public-domain census data."*
- *"The correlation is peer-reviewed: neighborhood income tracks the home-value/SES bundle at **r = 0.82–0.98** — so free census recovers most of what that paid signal implies, **at the aggregate level.**"*
- *"Independent research finds off-the-shelf **third-party segments are no better than random**, and **first-party outperforms both** — first-party is deterministic, owned, and a moat; third-party is modeled, rented, available to every competitor."*
- *"Third-party spend still earns its keep for net-new prospecting and share-of-wallet — we're complementary there, not opposed."* (credibility-builder)
- *"You're really in the Winston-Salem metro — median household income ≈ $65,900 (Census ACS 2024). Raleigh runs ≈ $102,100, Charlotte ≈ $85,900 — the metro tier shows up in the data."*
- *"Even within Winston-Salem: ZIP 27106 ≈ $68,600 / $313,000 homes vs ZIP 27101 ≈ $44,200 / $221,000 — that's the 'neighborhood' axis, free."*
- *"Census is reliable down to the ZIP here; what we roll up is your own purchase counts — ZIP → Triad metro → NC — until the cohort is sound. We show the grain we used."*
- *"MasterCard guesses the neighborhood's wallet. We use your own receipts — and we enrich, never gate: we curate the storefront, never the price or who gets in."*

**DO NOT SAY / RED LINES:**
- Never vary **price/discount/access** by geography or affluence (the Staples/Princeton Review third rail). Curation only.
- Never use or **proxy a protected class**; never use ZIP as a stand-in for race/ethnicity.
- Never tie the geo signal to **credit/BNPL/financing**.
- Never claim census tells you **this visitor's** income (ecological fallacy).
- Never say **"we have/replicate MasterCard data."**
- Never **exclude or down-rank** a neighborhood; the feature is additive.
- Never say **"Mastercard paid $320M for Dynamic Yield"** (terms undisclosed; the ~$300M figure is McDonald's *2019 purchase*, itself reported-not-official).
- Never claim **DY does "neighborhood-/household-level" targeting** — it's ZIP/city ("neighborhood" is marketing copy). Don't claim that precision for us either.
- Never imply **DY hands merchants individual cardholder transactions** — the data is aggregated/anonymized.
- Never claim **first-party data is always "cleaner"** (≈41% of marketers cite first-party accuracy issues; it can't see net-new or off-store spend).
- Avoid inflated stats: **~2×** (not 2.9×) incremental revenue; skip unsourced "5–8× ROI" daisy-chains.

## 12. As-built & verified (2026-06-27 — live on the dev worker)
All §9 decisions approved + shipped. Verified on `https://edge-platform.expedge.workers.dev`:
- **Real WS cohort:** `GET /geo/cohort` from the REAL edge geo (Winston-Salem, NC, ZIP 27101) rolls **ZIP (23, below threshold) → metro (320, cleared)** → **Tabby 50% / Brooklyn 30% / Pillow Tabby 20%**, core band, AOV $448, census **$65,903 / $270,700 (ACS 2024)**, `dataSource:'synthetic'`, full honesty metadata + the roll-up `ladder`. Existing-state geos (e.g. CA → region, N=270) roll up with real census.
- **Single hero paint (no flash):** hero-title load sequence verified `[(empty) → cohort hero]` (one change). Preserves the recent cold-start flash fix; also fixed a force-geo-switch **stale-grain** by keying `renderHero` on title+eyebrow.
- **Cold-start render:** cohort hero ("The {topLine} leads near you"), cohort-ranked grid ("What shoppers near you carry · {grain}"), a rich Activity provenance card (real geo + grain + N + census $ + "aggregate, never the individual · we curate, never price"), and a cohort welcome ribbon.
- **Anti-DY anchor:** the "◑ DY vs us" modal re-enabled + parameterized LIVE — DY column = real ZIP + real census (proxy · neighborhood AVERAGE · no intent) vs Optimizely column = the first-party cohort (Tabby/Brooklyn/Pillow Tabby, N=320, "real intent · your own receipts · curation only").
- **Opal:** the `geoCohort` tool returns the same numbers the storefront paints; `queryData` can read `geo_census`/`geo_xref`; the system prompt carries the honesty/fairness rules.
- **Honesty/fairness (verified on screen):** geo REAL · query REAL · first-party REPRESENTATIVE (synthetic, swap to warehouse via `GEO_COHORT_SOURCE`) · census REAL public (cited ACS 2024); curate-not-price; aggregate-not-individual; the grain used is always shown; no protected-class/credit signals.

**Files shipped** — ADD: `migrations/0004_geo_census.sql`, `migrations/seed/seed_011_geo.sql`, `src/services/geo/cohort.ts`, `src/agents/tools/geoCohort.ts`. TOUCH: `src/routes/geo.ts`, `src/agents/tools.ts`, `src/agents/OpalAgent.ts`, `public/storefront.js`, `public/revenue-radar.js`. Remote D1: migration + seed applied (additive; base 3,200/7,293 untouched).
**Swap to production:** set `GEO_COHORT_SOURCE='warehouse'` + implement `WarehouseSource` — zero change to route/tool/UI.
**QA note:** the ⌘K "Winston-Salem (forced location · QA)" entry forces the cohort for non-WS presenters; on a real Winston-Salem machine the cold start fires from real edge geo with no override.

## 12a. Representative fallback + 50-state census + force-city (2026-06-28)
**Why:** so the demo is presenter-agnostic — any teammate (NY, PA, Austin, SF, Chicago, anywhere in the US) gets a compelling local cold start even though first-party shoppers are only seeded for NC/Triad. No risk if the WS presenter is out.

- **Representative fallback (`computeGeoCohort`, the `synthesized` flag):** when nothing local clears the first-party gate (we land on the national floor) but the visitor's REAL region has a census row, we present the national (representative) leaders **at that region**, with the region's **REAL** census. `granularityUsed:'region'`, `synthesized:true`. The UI **suppresses the borrowed N** and labels it a **"representative cohort"** with the note *"in production this is your {State} customers' own purchase history."* **Honesty is unchanged** — `firstParty` was always `'representative'`; geo + census stay REAL. Against a real warehouse a populated region returns its OWN cohort, so this branch is a demo stand-in only.
- **50 states + DC census backfilled:** `geo_census` region rows now cover all 50 states + DC, **U.S. Census ACS 2024 1-yr** (income B19013, home value B25077, `api.census.gov/data/2024/acs/acs1`) — one consistent source/vintage (matches the national row), replacing the old 15-state ACS-2023/Zillow mix. Real public; safe to cite on stage.
- **Force-city for presenters:** ⌘K "Preview as location" gains **New York / San Francisco / Austin / Philadelphia / Chicago** (each `cohort:true`, real state census via the fallback). Plus a deep-link **`/storefront?cohort=<2-letter state | city slug>`** (e.g. `?cohort=NY`, `?cohort=austin`) — a bookmarkable one-click force if edge geo misfires on a VPN.
- **Verified (deployed Version 8bbdf7b4):** WS → metro, real NC, `$65,903`, not synthesized. CA/NY/TX → **real region** cohorts (base data has shoppers there; N=270/216/174) with real state income ($100,149 / $85,820 / $79,721). OH → **synthesized** region fallback, real `$72,212`, N suppressed, "representative cohort" + the production note rendered (screenshot-verified). Invalid region → national/generic (correct degradation). Hero load sequence `[(empty) → cohort hero]` (single paint, no flash) for both real-region and synthesized.
- **Files touched:** `src/services/geo/cohort.ts` (fallback + `synthesized`), `public/storefront.js` (N suppression, provenance framing, ⌘K force-city, `?cohort=` deep-link), `migrations/seed/seed_011_geo.sql` (50 states + DC). Remote D1 reseeded (additive; base data untouched).
