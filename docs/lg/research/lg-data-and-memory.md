# LG: memory, identity and cold start, and what the engine can promise

Prepared 2026-10-01 for the LG US consumer demo. Code is cited as `path:line` in `C:\Users\LAH\Documents\__Development\Optimizely\__cloudflare_base` (`feature/real-time-personalization`, `5ddc64d`). **(inference)** marks a conclusion no source states. Retention values are the local demo configuration (`.dev.vars` `RETENTION`, durations only); hosted Vantage copied them from `shn` (`docs/verizon/lanes/L1.md:56`).

## The three answers LG asked for

**1. How long does a profile last at the edge?** Four clocks:
- **The anonymous session token lasts 24 hours**, not renewed (`src/identity/sessionCapability.ts:13-14`). After that she is recognised only if she signs in or the tenant has published a return-recognition window. None is published today (`src/reflex/core.ts:88-96`), so an anonymous return after 24 hours starts fresh.
- **The stored profile lasts the tenant's `RETENTION.profile` period from its first event**, never extended by later visits (`src/retention.ts:24-25, 94-101`; `docs/kit/02-api-reference.md:36`). There is no product default; every demo tenant uses 30 days.
- **Each dimension's interest fades at its own rate τ**: 14 days shipped, 35 for price band, up to 90 allowed (`src/reflex/core.ts:214, 259`; `src/reflex/configStore.ts:134`).
- **Consent lasts 30 days from each explicit choice**, a code constant (`src/content/consent.ts:17`).

**2. Can we use their CDP?** Yes, today, through four routes: person-level history import keyed by account id and discounted by age; CDP attributes and audiences for eligibility (never scoring); aggregate priors; and a scheduled Snowflake delivery of every decision, outcome and behaviour record under a pseudonym LG can join. Live streaming exists only for Optimizely Data Platform (ODP); a connector for LG's CDP (public evidence: Treasure Data) is a build item modelled on it.

**3. Can we recognise a shopper three to six weeks later and continue?**
- **Signed in:** yes, on any device, once LG's page signs her in; she sees her merged, faded interest. Under today's 30-day period, though, a profile older than 30 days is already deleted and she is a cold start again.
- **Anonymous, same device:** only once LG publishes a return window of at least six weeks.
- **Anonymous, another device:** no, by design (no fingerprinting); signing in there joins it.

To make "six weeks later" true: profile and identity retention of 120–180 days, slow τ on taste dimensions, a published return window, and consent re-sent by LG's consent platform each visit.

## A1. Profile longevity

| Clock | Today | Code | Set by |
|---|---|---|---|
| Visit | Ends after 30 minutes idle. The journey stage belongs to the visit and restarts; taste and visit count carry on | `src/services/visit.ts:24-30`; `src/services/JourneyStage.ts:360-365` | code |
| Anonymous session token | 24 hours, not renewed. When it expires the browser is issued a new anonymous visitor id (`vis-`) | `sessionCapability.ts:180-182`; `src/sdk/core.ts:695-699` | code |
| Anonymous return recognition (same device) | Off until a window is published. The window is fixed when issued and never extended | `core.ts:81-115`; `configStore.ts:236-292`; `src/routes/identity.ts:288-308` | tenant; an open owner decision (`docs/handover/HANDOFF-2026-09-18.md:366`) |
| Consent | 30 days per explicit choice. Browsing, sign-in and logout never renew it; an expired choice reads as OFF | `consent.ts:17, 44, 112`; `src/sdk/README.md:258` | code |
| Profile (the taste vector) | `RETENTION.profile`, counted from the first event and never renewed. A merge keeps the earliest start date | `retention.ts:88-109`; `src/durable-objects/ShopperReflex.ts:630, 1108-1111, 2853-2856`; `src/services/SessionManager.ts:534-560` | tenant; 30 days in all demos |
| Session-host storage copy | Also expires 30 days after the last write | `SessionManager.ts:96, 352-353` | code |
| Identity link (which browsers belong to the person) | `RETENTION.identity`, counted from the first link. Each sign-in links again | `ShopperReflex.ts:2723-2728, 2777`; `src/identity/store.ts:81-88` | tenant; 30 days |
| Records log (ledger) / hourly / online counters | 90 / 90 / 30 days | `retention.ts:5` | tenant |
| Decay | Raw score R fades as R·e^(−Δt/τ); affinity a = R/(R+K) with K = 1.8; audience entry and exit thresholds θ = 0.60 / 0.45 | `core.ts:12-14, 39-44, 259-262, 276-298` | tenant (reflex document) |

The shopper object's "idle self-expiry" alarm fires at the fixed expiry date, not after idle time, and deletes the profile then (`ShopperReflex.ts:313-332, 1525-1528, 1605-1608`).

**A return after three weeks, worked through.** She viewed three French-door refrigerators and added one to cart: R ≈ 6 on `productType=french-door`, a = 0.77. Ranking uses the continuous affinity, not only membership: each matching tag adds a·w (`src/reflex/contentCompose.ts:258-263`).

| | τ = 14 days (shipped) | τ = 90 days (maximum) |
|---|---|---|
| Day 21 | a = 0.43. She left the audience on day 19.7, but French-door content still ranks for her | a = 0.73, still a member |
| Day 42 | a = 0.14, and under a 30-day profile period the record was deleted on day 30 | a = 0.68, but only if profile retention exceeds 42 days |

A "moment" dimension at τ = 10 minutes (Vantage's `intent`) keeps under 0.3% of its strength after an hour (`scripts/seed-vantage.mjs:93-111`).

Under the demo configuration, day 21 keeps her faded taste, visit count (bucket 2–3), consent (if chosen within 30 days) and identity link, and restarts the journey stage, entry channel and browsing session. By day 42 the profile and consent are gone: she opens on the regional prior plus her channel, unless she signs in and an imported history rebuilds her interest. As her interest fades the prior speaks louder: λ = kBlend/(kBlend + Σa) (`src/reflex/regionTrend.ts:217-222`), so a = 0.43 and kBlend 1 give λ = 0.70.

**Settings so taste lasts months and the moment lasts minutes:**
1. `RETENTION.profile` and `.identity` at 120–180 days, with privacy-owner approval; there is no default by design (`retention.ts:52-54`).
2. In the reflex document, τ of 60–90 days on category, product type, configuration (door style, fuel, screen technology), size band and price band; minutes on intent, promotion and content type, as Vantage does (`seed-vantage.mjs:93-111`). The cap is 90 days (`configStore.ts:129-134`).
3. Publish `{mode: 'broker', windowMs, purpose, retentionApproved: true}` (`core.ts:99-115`). This is LG's privacy decision; the 30-day consent record does not approve a 30-day credential (`HANDOFF-2026-09-18.md:588`).
4. Consent: LG's consent platform re-sends the standing choice within each 30 days. Making the lifetime a tenant value is a build item at `consent.ts:17`.
5. Session host: build item so its storage expiry follows only the retention stamp (`SessionManager.ts:96, 352`). The object host already does, but its ledger-consumer finding stands (`L1.md:98`).

## A2. Identity and stitching

- **Issued at the edge.** `POST /v1/:tenant/identity/session` mints a fresh anonymous visitor and signed token; caller ids and old cookies carry no authority (`docs/architecture/25-identity-stitching.md:47`; `routes/identity.ts:275-341`).
- **Sign-in links.** `POST /v1/:tenant/identity/link {visitorId, accountId, exp, assertion}`: LG's backend signs HMAC-SHA256 over tenant⏎visitorId⏎accountId⏎exp, valid up to 24 hours (`src/identity/assertion.ts:11-19, 32`). A browser already carrying a person gets 409 (`routes/identity.ts:355-359`). Public links run in the shopper object (`src/identity/link.ts:75-94`).
- **Hashed account id.** `sh_` plus 32 hex of SHA-256(IDENTITY_SALT⏎tenant⏎accountId); the raw id is read once and stored nowhere. `POST identity/resolve` gives the warehouse the join key without the salt (`src/identity/shopperId.ts:36-55`; doc 25 lines 50, 113-114).
- **The merge keeps both histories.** Each value is carried to the later touch and summed; memberships are combined and re-checked; counters add; earliest first-seen wins (`src/reflex/identityMerge.ts:48-90`; `ShopperReflex.ts:2853-2877`). Retention takes the earliest start, so linking an old anonymous profile shortens the remaining period.
- **Relink** is detach then link: it moves the browser and folds nothing (doc 25 lines 106-107).
- **SDK:** `identify(accountId, {exp, assertion | getAssertion})` and `logout()` (`src/sdk/identify.ts:67-111`; `docs/kit/01-integration-guide.md:190-215`).
- **A second device is a separate visitor** until it signs in; no fingerprinting or probabilistic matching (`docs/BTI-Parity-and-Mechanism.md:292`).

**The plain answer.** Yes, if she signs in on both. Each sign-in folds that device's current anonymous profile into the same person, because the same account always hashes to the same id. Both devices then read one profile, the sum of both devices' faded interest: the laptop's French-door interest and the phone's OLED interest both rank, and the regional prior quietens. The page carries the person's id and reconnects (doc 25 lines 68-77). Signing in on one device brings only that device's history. Anonymous history joins only while the device still holds its id (24 hours today, or the return window once published) and while it is retained (30 days in the demos).

**The CDP.**
- **ODP, the only live connector:** every behavioural event goes to `/v3/events`; audiences are read from ODP GraphQL once per session and refreshed every ~2 minutes; affinity scores are written to the ODP profile through a configured mapping (`src/services/odpLoop.ts:1-27, 395-449`; `src/connectors/config.ts:41-44`). ODP sees a destination-specific pseudonym, never the account id (`odpLoop.ts:105-107`; `config.ts:165-168`).
- **Outbound, any CDP:** scheduled Snowflake SQL API delivery of decision, outcome, behaviour and product-sort records, each under a destination-specific pseudonym, no session ids, original expiry kept; the receiver's current view hides expired rows (`src/ledger/warehouse.ts:14, 135-141`; `docs/kit/02-api-reference.md:15-17`; `scripts/sql/snowflake-warehouse-v1.sql`). That LG's CDP ingests from Snowflake is **(inference)**.
- **Inbound, per person:** `POST identity/events` takes rows keyed by accountId, shopperId or visitorId with action, time and product attributes, up to 1,000 per request, JSON or CSV, each discounted by age (`src/identity/history.ts:1-20, 37`; `identityMerge.ts:92-128`). "Profile" rows carry typed CDP fields and audiences (8 sources × 32 entries, 64 KiB) for eligibility, never scoring (`src/identity/profileEnrichment.ts:1-34, 81-90`).
- **Erasure** reaches link table, profiles and records log; destination copies become listed obligations (doc 25 line 53; `src/identity/erase.ts:120-141`).
- **Build items:** a streaming destination and audience read for LG's CDP, modelled on the ODP connector (`config.ts:41-44`, `odpLoop.ts`), and a history pull at sign-in, since import is an operator batch today **(inference)**.
- **Design note (inference):** a refrigerator purchase or registration should land as an "owns" enrichment field, to suppress replacements and lead with accessories; shipped weights treat a purchase as five views of interest (`core.ts:232`).

## A3. Cold start from LG's own data

- **The regional prior.** Every scored event adds its attribute values to one shared object per tenant and region; it holds population counts only, no visitor ids. The object publishes to KV, and the published shares are blended into each shopper's affinity as ã = (1 − λ)·a_personal + λ·share_region. Where a region has too few events, the prior rolls up from region to country to everyone, gated on `minEvents` (`regionTrend.ts:7-18, 153-165, 194-252`). Defaults: kBlend 1, minEvents 30 (`src/content/kinds.ts:683-687`); Vantage uses kBlend 0.5 (`L1.md:20`).
- **The dimension list.** `learn.regional.dimensions` limits the blend to the dimensions a tenant names (`kinds.ts:530-545, 571-573`; `src/content/types.ts:262-267`). LG would name product type, configuration, size band and price band, and leave out intent.
- **The regional prior fades with a fixed 24-hour τ** (`regionTrend.ts:28`). A prior fed from the warehouse therefore needs either a daily reseed or a tenant-set τ (build item).
- **How it is seeded.** Vantage seeds through `POST /vantage/api/coldstart/prior`, which runs only on demo deployments, accepts a closed vocabulary and caps each region at 800 units (`src/routes/vantageColdStart.ts:9-17, 56-66`; `scripts/seed-vantage-region.mjs:54-61`). Build item: turn it into a tenant-scoped operator import that carries a weight per row.
- **The census read.**
  - `geo_census` holds B19013 income and B25077 home value, from national down to ZIP; `geo_xref` maps ZIP → metro (CBSA) → state (`migrations/0004_geo_census.sql:1-40`; `docs/architecture/13-geo-cohort-coldstart-prd-tdd.md:59-62`).
  - Census figures are shown as the public explanation and are never a score input (`vantageColdStart.ts:18-23`; `seed-vantage-region.mjs:48-52`).
  - Grain is state or metro, never ZIP (`vantageColdStart.ts:24-27`). The roll-up ladder is gated on LG's own purchase count, not on census reliability (doc 13 lines 33-35).
- **Priors (`PUT /content/priors`).** Each row gives, for one slot, one item and one ladder cell, a rate and a pseudo-count (`n_equiv`). Cells use the keys channel `c=`, visit bucket `v=`, journey stage `s=`, region `r=` and affinity `a=`. JSON or CSV, at most 4,096 rows (`src/learn/priors.ts:1-17, 50-56, 162-187`; `src/learn/stats.ts:47-49`; `src/routes/content.ts:72-73, 336`).

What LG would supply, from its warehouse:

```
region,period,category,productType,configuration,sizeBand,priceBand,units
US-TX,2025Q3,refrigerators,french-door,counter-depth,28cu,premium,1840
US-TX,2025Q3,refrigerators,side-by-side,standard,26cu,core,2210
US-NY,2025Q3,tvs,oled,,77in,premium,960
```

Optionally, priors in the form `slot,item,cell,p_prior,n_equiv`, for example `hero,oled77-g5,c=paid_search|v=1|s=early|r=US-TX,0.031,200`.

"Income level" enters only as LG's own sales by price band in each state. The census figure is the labelled explanation beside it. The demo opens on the visitor's real edge location, seeds every state and labels the data "synthetic → warehouse" (`seed-vantage-region.mjs:11-14`). Any region override is a labelled presenter action, never the default.

## B4. Public data for an appliance cold start

ACS 1-year estimates cover areas of 65,000 people or more (states, most metros); 5-year estimates reach tracts [Census].

| Source, table | Grain | What it honestly tells a merchandiser |
|---|---|---|
| ACS B25024 Units in structure | state, metro (1-yr); tract, ZIP area (5-yr) | Detached share: full-size laundry pairs, large refrigerators. Multi-unit share: stacked laundry, counter-depth, 24-inch dishwashers **(inference)** |
| ACS B25003 Tenure | same | Owner share: replacement suites, packages, installation. Renter share: portable, plug-in **(inference)** |
| ACS B25077 home value; B19013, B19001 income | same | Premium-band prominence in the curated edit; never price, financing, rebates or rewards |
| ACS B25041 Bedrooms (rooms: B25017, B25018) | same | Larger stock: large capacity, second refrigerator (34% of homes have two or more [EIA]) |
| ACS B25034 Year built | same | Older stock: replacement and fit limits, e.g. counter-depth, 30-inch slide-ins **(inference)** |
| ACS B25040 Heating fuel | same | Utility-gas share orders gas against electric or induction ranges and dryers; a proxy, since heating fuel is not cooking fuel |
| EIA RECS 2020 | state (50 + DC); climate region | Range fuel directly (US: 59% electric, 31% gas, 5% dual-fuel, 4% propane), refrigerators, freezers, laundry, TVs. TV display type is one "LED or OLED" category; 23.7 M of 123.5 M homes' most-used TV is 60 inches or more [EIA HC 4.6] |
| Building Permits Survey | state, metro, county, place; monthly, annual; 1, 2, 3–4, 5+ units | New-build momentum: new-home and kitchen packages; 5+ unit share: compact |
| IECC / Building America climate zones | county | Seasonal timing for air conditioners, dehumidifiers, heat pumps |
| American Housing Survey | national, selected metros | Kitchen and laundry equipment present; validation |

**Never used:** age (B01001), race and ethnicity (B02001, B03002), language, disability, household and family tables (B11xxx; B25010 household size), or single-ZIP targeting. The engine reads no census figure when it decides.

**No public data:** TV technology share by region (RECS lumps OLED with LED; Circana and OpenBrand/TraQline are licensed); appliance brand share by region (licensed); gas against induction by metro (RECS is state-only). **First-party substitute:** LG's own sales and registrations by state × product type × price band; a registration's model number gives technology, size and configuration, plus retailer sell-through where shared.

## B5. The lines LG must not cross

1. **Price, promotions, MyLG Rewards rates, financing (Klarna on LG.com) and rebate eligibility never vary by geography or inferred income.** Curate the selection; never set the price (doc 13 lines 108, 124-126, citing the Staples and Princeton Review ZIP-pricing cases).
2. **Financing is credit** under ECOA and Regulation B. No geographic cohort or inferred income may sit near a financing offer. LG's own policy says it does not profile for decisions with legal or similarly significant effects [LG].
3. **No protected class, and no proxy for one.** That rules out ZIP as a stand-in for race (doc 13 line 109, citing [FTC 2016]), familial status read from household tables, and age. LG collects date of birth and gender; none of it may enter the edge profile or an enrichment field.
4. **Housing data is for aggregate curation only:** state or metro grain, additive, with the grain shown (doc 13 line 110; `vantageColdStart.ts:18-27`).
5. **Energy rebates are the program's own facts.** The federal Home Electrification and Appliance Rebates program (HEAR) is run by the states and qualifies by household income:
   - up to 100% of cost below 80% of area median income, and up to 50% between 80% and 150%;
   - an $840 cap for an electric or induction range, and $840 for a heat-pump dryer [DOE].

   Show rebates only through the shopper's own lookup; LG.com already loads EcoRebates **(inference)**. Never pre-qualify anyone from region or income.
6. **TV viewing data stays out of site personalization.** Texas's May 11, 2026 settlement requires consent and disclosure before LG collects viewing data through automatic content recognition (ACR) [KVIA].
7. **LG's own privacy policy (effective April 29, 2026)** lists personalization as a use. It combines data across services and devices, honours Global Privacy Control (GPC) as an opt-out of sharing and targeted advertising, and says it does not intentionally collect protected classifications [LG]. **(inference)** The edge should treat GPC and LG's opt-outs as consent restrictions.

## B6. LG's public data and stack

- **lg.com/us home page (public HTML, read 2026-10-01):** a preconnect to an Optimizely CDN host (`a6686257430921216.cdn.optimizely.com`), and a content block `OBS_HP_Redisign_Optimizely_Product_Rec` (tagged optimizely and product recommendation, updated 2026-06-10) that waits for `window.recs` and writes a 30-day `optimizelyRecommendedProducts` cookie. LG US looks like an existing Optimizely web customer **(inference; confirm in the account record)**. Also loaded: Transcend (its privacy center), EcoRebates, Datadog, Akamai mPulse, Next.js, Bazaarvoice, Attentive; the content data follows Contentstack conventions **(inference)**. The privacy policy names Hotjar and Google Analytics.
- **CDP and analytics:** Treasure Data lists LG as a customer, entity unspecified [AdExchanger, Oct 2020]. LG Electronics built a Databricks plus Mellerikat analytics platform scoring a "Customer Index" for personalised search and recommendations on its online brand shop (1.5× conversion, 3.6× click-through; Korea Sales Division named) [Databricks]. Searches and the page scan found no evidence of Adobe Real-Time CDP, Salesforce Data Cloud, Tealium, mParticle, Dynamic Yield or Bloomreach at LG US.
- **MyLG:** free membership; Rewards give 5% back at 100 points = $1, usable only on LG.com, available after the 20–35-day return period, expiring after 5 years. The Ownership Program costs $79.99 a year (Pro) or $169.99 (Pro Care) for refrigerators, washers and dishwashers; its 2-year warranty requires ThinQ registration.
- **Registration and ThinQ:** registration asks for serial, model, product name, purchase date, purchase price and place of purchase; ThinQ collects device model, status, settings, sensor data and location [LG].
- **Stated ambitions:** "qualitative growth" businesses (B2B, webOS, direct-to-consumer including subscriptions and online) are nearly half of revenue [LG, Jan 9, 2026]; a dedicated direct-to-consumer organisation markets from customer data [KED Global, Apr 2023]; LG Ad Solutions sells US viewing data from over 33 million opted-in TVs through Databricks Marketplace [PPC Land, Oct 22, 2025].

## B7. Measurement when the win is often a retailer sale

| Metric | What the edge can report as attribution | What needs LG's holdout and warehouse |
|---|---|---|
| Where-to-buy or retailer click | Yes, as a `custom` reward with its own window, per slot and item (`kinds.ts:576, 586-590`) | — |
| The retailer sale | No | Join retailer or affiliate data to the delivered decisions; the holdout difference is the lift |
| Registration after purchase | No | Join the registration (model, date, retailer, price) to the account, then via `identity/resolve` to the shopper id, then to the decisions. Each step is limited to the records log's retention (90 days in the demos) |
| Assisted-conversion windows | Windows are configurable per reward. Defaults: purchase 7 days, add-to-bag 6 hours, click 30 minutes; scope is session or visitor; credit goes to the last or first decision (`kinds.ts:580-590, 690`) | Multi-week windows longer than retention |
| Direct-to-consumer conversion and order value | Yes, for LG.com orders sent as `purchase` with a value; the default holdout is 5% (`kinds.ts:683-686`) | Margin and returns |
| Attach (soundbar, pedestal, protection plan) and package take rate | On LG.com, if the order event carries its line items **(inference)** | Attach on retailer sales |
| Return-visit rate across weeks | Only for shoppers recognised by sign-in or a return window; a visit ends after 30 minutes idle | Anonymous returns come from LG's own analytics |

A daily report per slot and item already exists (Vantage `/report`, `L1.md:24`).

## Sources

**Census:**
- ACS 1-year availability: https://www.census.gov/programs-surveys/acs/news/data-releases/2024/release.html
- Building Permits Survey: https://www.census.gov/construction/bps/
- AHS: https://www.census.gov/programs-surveys/ahs.html

**EIA:**
- State release: https://www.eia.gov/pressroom/releases/press510.php
- RECS HC 4.6: https://www.eia.gov/consumption/residential/data/2020/hc/pdf/HC%204.6.pdf
- Range fuel (summary of RECS): https://www.npga.org/news-resources/2020-residential-energy-consumption-survey-recs/

**Climate zones:** https://www.osti.gov/servlets/purl/1893981

**DOE HEAR:**
- https://www.energy.gov/node/4835380
- https://www.homeenergyrebates.oregon.gov/hear

**Texas settlement:** https://kvia.com/news/top-stories/2026/05/11/lg-settles-with-texas-attorney-general-over-user-data-concerns/

**FTC, Big Data (2016):** https://www.ftc.gov/reports/big-data-tool-inclusion-or-exclusion-understanding-issues-ftc-report

**Market trackers:**
- https://www.insightplatforms.com/platforms/traqline/
- https://www.circana.com/industries/consumer-technology

**LG:**
- Privacy policy: https://privacy.us.lg.com/policies
- Registration: https://www.lg.com/us/support/product-registration
- MyLG Rewards: https://www.lg.com/us/mylg-membership-rewards
- Ownership Program: https://www.lg.com/us/mylg-ownership-program
- Klarna financing: https://www.lg.com/us/flexible-payments-klarna
- Earnings: https://www.lg.com/global/newsroom/news/corporate/lg-electronics-releases-preliminary-earnings-for-fourth-quarter-and-full-year-2025/
- Home page: https://www.lg.com/us

**Industry:**
- Databricks: https://www.databricks.com/customers/lg-electronics/mellerikat
- AdExchanger: https://www.adexchanger.com/data-exchanges/softbank-owned-treasure-data-on-the-nascent-but-growing-opportunity-of-iot/
- KED Global: https://www.kedglobal.com/electronics/newsView/ked202304240019
- PPC Land: https://ppc.land/lg-ad-solutions-integrates-acr-data-with-databricks-marketplace/
