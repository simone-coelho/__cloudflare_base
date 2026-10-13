# LG on the Vantage chassis: the engineering map

Read-only, 2026-10-01, at `5ddc64d`. Nothing was run against a worker. "Computed" means worked from the engine's formula, not measured.

## 1. Vantage as a chassis

| Component | Vantage today | For LG |
|---|---|---|
| Own worker, config builder | `scripts/build-demo-worker-config.mjs` | **Reuse as is**: `--name edge-platform-lg --queue events-lg --dev-port 9120`; add `wrangler triggers deploy` (RESUME-vantage.md:173) |
| Tenant and secrets | `TENANTS`, `SDK_KEYS`, `RETENTION`, `JWT_SECRET`, `IDENTITY_SALT` (L1.md:53-58) | **Re-skin** (owner's go). Add `IDENTITY_SECRETS` if sign-in is shown (`src/identity/assertion.ts:15-18`) |
| Registry | 8 dimensions, room-compressed memory (`scripts/seed-vantage.mjs:100-144`) | **Build**: LG taxonomy (§2.1) |
| Catalog shape | promotions, heroes, PDP modules, plans; windows, `eligibleWhen`, `merchandising`, `journeyStageFit` (`seed-vantage.mjs:212-445`) | **Generalise**: promotions, heroes and modules carry over; plans become packages; add companion tiles and where-to-buy pieces |
| Slots | hero (stage rule), deals (diversity, promotion dial, seeds), pdp-modules, plan-pairing (`seed-vantage.mjs:577-610`) | **Re-skin**, plus a companions slot and a packages slot |
| Learn | holdout 0, γ 0, regional `{kBlend 0.5, dimensions}`, `policy.scope: session` (`seed-vantage.mjs:622-638`) | **Re-skin**; `scope: visitor` for weeks-long journeys (§3) |
| Beats as publishes | closed list in the route, documents in `public/vantage/beats/`, written by the seed; reseed then redeploy (`src/routes/vantage.ts:50-59`, `:222-267`) | **Generalise** |
| Route: beat, reset, receipt, report; 60 s minted operator token | `src/routes/vantage.ts`, a fork of `topOffers.ts` | **Generalise** (seams below) |
| Receipt action | own decisions only, projection without ids or replay inputs (`vantage.ts:100-125`, `:309-345`) | **Reuse through the factory**; asserted values per demo (`:128`) |
| Cold-start route | region resolution, census ladder, lean label, seed door (`src/routes/vantageColdStart.ts`) | **Generalise** |
| Region seed, all-states model | TX and NY rows plus an income-tilt model for 49 states, read-back, `--regions here` (`scripts/seed-vantage-region.mjs:16-52`) | **Re-skin data, generalise script** |
| Arrival seeds | `campaign_term` and `platform` with `dampen` (`public/vantage/seeds.json`) | **Re-skin**: keyword rules; the platform seed has no LG use |
| Page: transport, visitor, consent, events, ask | `public/vantage/vantage.js:326-475` | **Extract** |
| Director, runner, presses, `?debug`, `?wait`, `?region`, `?fixtures` | `vantage.js:2780-2830`, `2992-3050`; beats `2385-2753` | **Extract** the runner; the beats are LG's |
| Before/now row and deltas | `vantage.js:871-973`, `1227-1252` | **Generalise** (slot-keyed) |
| Predict-then-prove | `vantage.js:2869-2960` | **Extract** |
| Compare | `vantage.js:1997-2045` (capture, diff by position) | **Extract**; each page's lists are config |
| Cold-start panel, meters, why panel, report panel | `vantage.js:1672-1830`, `1822-1970` | **Extract**, labels from config |
| Vertical rendering | deal cards, buy box, module bodies (`vantage.js:680-1440`) | **Build** |
| Imagery and manifest | 17 devices, 4.7 MB of a 25 MB budget (design §7) | **Re-skin, scale** (§5) |
| Two suites | `scripts/rehearse-vantage-page.mjs` (787 lines), `-dom.mjs` (566) | **Generalise** the harness; outcomes per demo |
| Resume routine | morning reseed, redeploy, region seed (RESUME-vantage.md:127-151) | **Re-skin** |

**Extract once instead of copying a third time.** Top Offers was copied into Vantage; LG would be copy three.

- `src/routes/demoKit.ts`: `demoActionRoutes({ tenant, operator, beats, reset, reportSlots, asserted })` returning `/beat /reset /receipt /report`, with today's pure helpers lifted from `vantage.ts`. The seams are the constants `VANTAGE_TENANT` (`:41`), `VANTAGE_BEATS` (`:50-56`), `VANTAGE_RESET` (`:59`), `VANTAGE_REPORT_SLOTS` (`:62`), `OPERATOR` (`:65`), `ASSERTED_INTENTS` (`:128`) and the tenant prefix hard-coded in `ownDecisionId` (`:103`). Leave `topOffers.ts` and the QVC worker alone.
- `src/routes/demoColdStart.ts`: `demoColdStartRoutes({ tenant, vocabulary, sentence })`. `resolveRegion`, `censusFor` and `estimateOf` are already tenant-free (`vantageColdStart.ts:103-179`). The seams are `VANTAGE_TENANT` (`:52`), `SEED_VOCABULARY` (`:58-63`), the marker key (`:66`) and `objectCall`/`seedPrior` (`:282-325`).
- `public/demo-kit/kit.js` and `kit.css`, configured by `{ tenant, api, pages, slots, dimLabels, beats, renderers }`. `public/lg/lg.js` keeps only the vertical renderers and the beats.
- `scripts/lib/demo-seed.mjs` (windows, beat envelopes, bootstrap publish, local checks, `seed-vantage.mjs:927-929`), `demo-region.mjs`, `demo-rehearse.mjs` (request helpers, `rehearse-vantage-page.mjs:198-320`) and `demo-cdp.mjs` (Chrome over DevTools, computed visibility, wire audit, `rehearse-vantage-dom.mjs:44-240`).
- Gate: Vantage moves onto the kit first and must hold its suites (111/111 request level, 221/221 DOM, hosted, RESUME-vantage.md:71). It redeploys only on the owner's go.

## 2. What LG's shape needs beyond Vantage

### 2.1 A deep catalog under one registry

- Products stay out of the content catalog, as Vantage's phones do: attributes travel on `/sort` and on events (design §4, line 85). The catalog holds promotions, heroes, modules, packages, companions and where-to-buy pieces.
- **One registry per tenant** (`src/reflex/configStore.ts:59-62`), **at most 32 dimensions** (`:135`), each reading one product field (`src/reflex/core.ts:26-44`). A field an event lacks produces no touch (`core.ts:309-336`), so per-category dimensions coexist without effort: a TV event carries no `capacity_cuft`. Each dimension still spends one of the 32. About 16 suffice: category, subcategory, type (French door, front-load), series (OLED evo, InstaView), panel, sizeBand, capacityTier, fuel, finish, priceTier, room, feature, intent, contentType, retailer, package.
- **One band per dimension.** `derive: 'band'` holds one cut list (`configStore.ts:191-210`). One price band cannot fit a $250 monitor, a $900 dishwasher and a $25,000 TV, and cubic feet mean different things for a washer and a fridge. The feed should send category-relative tiers as plain values (`priceTier: better`).
- **Exact vocabularies cut silently.** Once any published piece tags a dimension, an event value that no piece names builds no taste on that dimension (`core.ts:451-471`, vocabulary from catalog tags, `src/content/service.ts:276-300`). Pieces and products must share banded values, or the dimension stays untagged on pieces.
- Values: up to 1000 per dimension per shopper (`configStore.ts:318`; Vantage uses 64); 8 per multi-valued attribute per event, 64 characters each (`core.ts:340-341`); **32 per dimension in a region's prior** (`src/reflex/regionTrend.ts:29`). There is no category tree: each level is its own dimension with its own τ, K and θ (`configStore.ts:216-219`).

### 2.2 Packages and bundles

- **Built.** `featuredProductIds` is carried and validated (`src/content/kinds.ts:187-191`), copied to the record as `featured_product_ids` (`src/content/decide.ts:514`), and credits the package when an outcome names a member under `match: 'direct'` (`src/learn/policy.ts:172-176`). The report counts it (`src/learn/report.ts:262`).
- **Configuration.** Tags are arrays, so a kitchen package can carry its members' subcategories, finish and fuel and score on her taste (`kinds.ts:89-95`). `inStock` is one flag (`:192`), so the feed computes "all members in stock". Price and savings are content, as in Vantage.
- **Missing.** Member-level attributes on the receipt, and "this completes what she viewed".

### 2.3 Room-level cross-sell (washer, dryer, pedestals)

- There is **no `complements` relation**: the piece fields are listed at `kinds.ts:34-36`. The composer has a `prefer` hook ("content that completes it", `src/reflex/contentCompose.ts:48-54`, `:265-267`), and the receipt already has words for a `completes` driver (`src/learn/receipts.ts:127`). No Gen 2 slot can set the hook: `decide.ts:169-179` never passes it. Meridian's Gen 1 fork scores complements (`src/demos/meridian/composer.ts:381-421`).
- **Honest today:**
  1. A companions slot on the PDP. The page asserts the anchor family (`ctx.anchor=front-load-washer`), and each companion piece carries `eligibleWhen.context.anchor`. That gate fails closed, holds 32 values per signal and 8 signals per request (`kinds.ts:140-155`, `src/routes/decisions.ts:580`).
  2. Her taste then ranks the companions on finish and capacity.
  3. `featuredProductIds` credits a sale.
- **Build:** a `complements` field plus a slot `prefer` rule, wired to the existing hook and itemised on the receipt.

### 2.4 Where to buy, with partner retailers counted as a win

- The learn document can **name** `reward: 'custom'` (`kinds.ts:576`, `:629`), but **no wire action produces it**: `REWARD_OF` has no custom row (`src/ledger/records.ts:198-205`). A slot that learns on `custom` learns nothing.
- **Honest today:** the retailer button sits inside a decided container and sends `content_click`, which counts as a `click` credited to that decision. That is Vantage's `creditDecided` (`vantage.js:1520`). Label it "a referral, not a sale".
- **Build:** one `REWARD_OF` row for a retailer click. The record already keeps the custom event's own name (`records.ts:134-135`).
- Attribution reach: Vantage uses `scope: 'session'`, which credits only the same session (`policy.ts:169`). The ring holds 7 days and 200 decisions (`src/learn/stats.ts:34`, `src/durable-objects/DecisionRing.ts:36`). There is no server door for a partner's conversion postback, so a retailer sale joins offline through the ledger export (§3).

### 2.5 A `/sort` grid of hundreds

- At most **500 candidates**, a 2 MiB body (`src/routes/sort.ts:38`, `:104`). `/sort/intent` allows 16 filters of 8 values and a 256 KiB body (`:150-158`, `:173`). A category page fits in one call; the whole catalog does not, and paging belongs to the platform (`src/reflex/sortCandidates.ts:26-27`).
- **`/sort` reads her personal vector only, with no regional prior** (`sort.ts:56-102`). A stranger's grid opens in the site's order (L5.md finding 12). **Build:** blend the prior in `affinityFor`, as `service.ts:447-463` does.

### 2.6 The ad-click arrival with Google's parameters

- The entry contract is utm_medium, utm_source, utm_term, referrer and site host (`src/services/visit.ts:39-57`). `validEntry` refuses any other key (`:112-118`), so an `entry` carrying `gclid` answers **400 Invalid entry context** on the snapshot (`decisions.ts:507-508`, `:549-557`) and is refused on actions (`src/routes/realtime.ts:124`). The SDK reads only the three UTMs (`src/sdk/identity.ts:71-88`). `gclid`, `gbraid`, `g_keyword`, `g_campaign` and `utm_campaign` are never read.
- **Auto-tagged clicks with no UTM classify as `organic`**: the Google referrer matches the search hosts (`visit.ts:425-433`). With `utm_source=google&utm_medium=cpc` the cell is `paid_search` (`:403-411`). The channel is fixed for the visit (`:179-184`).
- With `utm_term=lg+tvs`, a `campaign_term` rule whose value is `lg tvs` fires on an exact, trimmed, lower-cased match (`decide.ts:250-254`). It adds `weight × the slot's weight` to every piece carrying the rule's tags, for example `category: tv` (`decide.ts:261-279`), and shows on the receipt. A ValueTrack keyword such as "lg oled 65 inch" needs a rule of its own (up to 100 rules per slot, `kinds.ts:246`). `/sort` ignores seeds. The term is never stored, so the page re-sends `entry` on every snapshot (`visit.ts:42-47`; L4.md §5.4).
- Recognising `gclid` as paid search belongs to W16 C2's ruled classification (units cited throughout `visit.ts`). It needs a ruling, not a demo patch.

## 3. Memory and identity, exactly

| | Shipped and Vantage | LG setting | Kind |
|---|---|---|---|
| τ per dimension | 14 d by default, price band 35 d (`core.ts:259`, `:214`); Vantage compresses brand and content type to 60 s and three dimensions to 10 min (`seed-vantage.mjs:93-111`); at most 90 d (`configStore.ts:134`) | taste dimensions 60–90 d; the moment (contentType, deal interest) 10–30 min | configuration |
| Profile lifetime | `RETENTION.profile`; no default; **fixed from the first event, never renewed** (`src/retention.ts:19-26`, `:52-54`; `src/services/SessionManager.ts:320-323`; `ShopperReflex.ts:630`) | 120 d or more, owner-approved | configuration |
| Idle expiry | session host: KV record expires at min(30 d after the last write, retention expiry) (`SessionManager.ts:96`, `:352`); object host: deleted at retention expiry (`ShopperReflex.ts:1605-1607`) | a gap over 30 d loses her on the session host; the 30 d is a constant | built; longer is new |
| Shopper capability | 24 h (`src/identity/sessionCapability.ts:14`) | — | built |
| Anonymous return | off unless `continuity` is published; a return after the capability lapses is a cold shopper (`src/routes/identity.ts:291-308`; test `src/units/W16/C6.unit.test.ts:660`). Vantage publishes none and keeps visitors in page memory (`vantage.js:395-407`) | `continuity { mode: broker, windowMs: 90 d, purpose, retentionApproved: true }` (`configStore.ts:276-293`); the window is fixed at issue | configuration, an owner decision; the page or SDK stores the proof (`src/sdk/core.ts:219-625`) |
| Consent | **30 d from the choice, in code**; missing or expired means off (`src/content/consent.ts:7-8`, `:17`, `:112`) | record the choice on every visit | built, not configurable |
| Visit and stage | 30 min gap (`visit.ts:30`); journey counters are per visit (`src/services/JourneyStage.ts:152-153`) | a third-visit researcher reads "exploring" again | cross-visit stage is new |
| Online attribution | 7 d ring; Vantage `scope: session` | `scope: visitor` | configuration |

**Six weeks of taste (computed).** Five touches give R = 5 and a = R/(R+K) = 0.735. After 42 days:

- at τ 14 d, a = 0.12, gone;
- at τ 60 d, a = 0.58, still a member if she had entered;
- at τ 90 d, a = 0.64.

Continuity and retention decide whether the vector exists; τ decides what is left. Continuity is tested returning the same subject after 7 and 14 days on both hosts (`C6.unit.test.ts:1313`). Continuity never restores tracking without a current choice (`:1069`).

**The second device.** A laptop and a phone are two anonymous subjects, two objects and two consents. Nothing joins them until a **signed link** (`identity.ts:343-384`). The link needs an HMAC from the site's backend over tenant, visitor, account and expiry, valid for at most 24 h, keyed by `IDENTITY_SECRETS` (`assertion.ts:11-18`, `:32`). The link always runs through the shopper's own object (`src/identity/link.ts:75-93`). The merge keeps both: it brings the older entry forward and sums at the later touch (`src/reflex/identityMerge.ts:20-24`, `:49-50`). The SDK's `identify()` adopts the person's session (`src/sdk/identify.ts:79-109`).

**A live demo of it:**

1. The laptop browses OLED 65".
2. The phone opens as a stranger, on her real region's prior.
3. Sign in on both through a **named demo action** that signs the assertion in the worker for a closed set of fictional accounts (the receipt-action pattern).
4. The phone's next snapshot opens on the laptop's taste.

New: the action, the page's link call, an owner-set `IDENTITY_SECRETS` (the sign-in hand-off is "designed, not built", RESUME-vantage.md:174). Measure the merge on the session host first. The engine clock is real, so show "weeks later" as a new session in the same browser presenting its proof, labelled.

**CDP.**

- **ODP today** forwards every behavioural event to `/v3/events` and seeds audiences from GraphQL about every 2 minutes (`src/services/odpLoop.ts:5-8`). For a tenant other than Coach it runs only through a `TENANT_CONNECTORS.odp` block (actions up to 64, audiences up to 100, profile mappings up to 100, `src/connectors/config.ts:41-44`) with its own retention category (`odpLoop.ts:61-74`). The vuid is session-derived, so ODP sees a browser, not a person, until the identity cutover (`ShopperReflex.ts:46-49`).
- **A non-ODP CDP**, inbound, uses `POST /v1/:tenant/identity/events` (operator; up to 1000 rows; applied as late actions through the registry, `src/identity/history.ts:1-20`) and the link.
- Outbound, it uses `GET /v1/:tenant/ledger/batches` (decision, outcome, product-sort and behaviour streams, by day or window, `decisions.ts:675-700`) or the Snowflake delivery (`config.ts:78-87`).
- `WEBHOOK_ENDPOINTS` (segment, amplitude, mixpanel) feeds only the legacy `/track` and `/webhook` (`config.ts:198-208`; `src/index.ts:103`, `:105`). A Gen 2 CDP forwarder is new.

## 4. Cold start from LG's data

- **Shape.** Per region, per dimension, per value: a decayed R and a share relative to that dimension's leader (`regionTrend.ts:109-131`). Dimensions are independent: there are no joint cells and no income conditioning. The ladder runs region, country, everyone, gated by `minEvents`, which counts frames (`:194-210`). λ = kBlend / (kBlend + Σa) (`:217-222`). `dimensions` lists what may blend (`:230-234`; `kinds.ts:530-545`). Regions are country plus state, never metro (`:41-46`).
- **The 24-hour horizon** is a compiled constant (`regionTrend.ts:28`). KV is republished only on ingest (`RegionTrend.ts:86-113`), and live traffic outweighs an ageing seed. So for a demo, keep the morning reseed. **Build** for a prior that lasts: a `learn.regional.tauMs`. `applyTrend` already takes τ as a parameter (`regionTrend.ts:86`); the object passes the constant (`RegionTrend.ts:91`).
- **Priors import, `PUT /content/priors`, is the wrong vehicle for the first paint.**
  - Rows are pseudo-counts on the *learned lift* per slot, item and cell (`src/learn/priors.ts:1-9`). They act only through lift^γ (`decide.ts:365`), and LG would run γ 0, as Vantage does.
  - A cell is a prefix of channel, visit, stage, region, affinity (`priors.ts:50-56`; `stats.ts:47-49`), so a regional row must also name a channel, a visit bucket and a stage. There is no income key.
  - It is the right home later, for "model X converts at 3% in US-NY" once γ is raised (4096 rows, 256 KiB, `src/durable-objects/LearnStats.ts:27`).
  - **"French door outsells side-by-side here"** is a seeded regional lean on `type` at state grain, labelled synthetic → warehouse.
  - "At this income band" is not supported. The census has medians, not bands, and the Vantage rule (census shown, never scored, `vantageColdStart.ts:248`) stands.
- **Census tables.**
  - `geo_census` holds B19013 and B25077 only (`migrations/0004_geo_census.sql:36-45`): 1 national row, 51 state rows including DC, 18 metros, plus single county, city and two ZIP rows (`migrations/seed/seed_011_geo.sql`).
  - `geo_xref` maps ZIP to CBSA to state (`0004:54-59`; 42 rows on the shared D1, design §12).
  - Candidates that would explain appliance leans, shown and never scored: B25040 (house heating fuel, for gas against induction), B25003 (tenure), B25024 (units in structure). None is loaded.
- **A metro rung** is new: region keys allow three characters after the dash (`kinds.ts:136`), and the edge's `metroCode` is a DMA, not a CBSA (`src/demos/brighthour/geoCohort.ts:386`).
- **Two regions honestly.** The Vantage rule carries over unchanged:
  - The edge region leads; beat 1 asserts nothing.
  - The contrast is an explicit, labelled assertion on the demo profile only (`service.ts:327-331`, `:451-462`).
  - A metro is used only when asserted and cross-checked against `geo_xref` (`vantageColdStart.ts:149-153`).
  - Every state is seeded, so the real region always has data. The seed door's vocabulary must become LG's: category, subcategory, type, panel, sizeBand, priceTier, fuel.

## 5. Engine findings LG inherits, and new limits

| Finding | Evidence | For LG |
|---|---|---|
| The object host stalls the ledger consumer after 20–40 quick snapshots | L1.md §6; `src/identity/sessionAuthority.ts:178`; an untimed forward inside the object's chain (L4.md §7) | run the session host, which brings the 30-day sliding expiry (§3) |
| The session host consumer stalled twice after report builds | L5.md finding 4 | restart the rig before a show |
| Slow meter reads, up to 15.8 s locally and 140 s once | L1.md §6; F1.md finding 4; the 5 s `ownerFetch` abort (`sessionAuthority.ts:299`) | the page says "asking the engine" |
| **`LearnStats.priorsFor` errors on every build** | `LearnStats.ts:855` reads the priors member unguarded; `readPinnedPublication` throws "authority unavailable" on a missing member (`src/config/publication.ts:20`, `:339`); the demo bootstrap publishes no priors member (`src/routes/demoBootstrap.ts:46`) | likely cause, read from code and **untested**: publish an empty priors document at bootstrap and check |
| The day report covers a whole UTC day; the raw build is refused past 16 MiB; folded hours only, after a 5 min grace, two per run; a busy hour can fail silently | `src/learn/report.ts:27-28`; `src/learn/hourly.ts:42`; L5.md finding 6; `src/index.ts:289` | clicks appear after their hour folds; log `failed[].error` |
| Crons not attached on a worker born from `secret put` | RESUME-vantage.md:173 | run `wrangler triggers deploy` |
| A receipt waited 35 s after a build | RESUME-vantage.md:161 | click first, build second |
| Forward-only deploys; D1's remote splitter breaks migration 0012 | L4.md §8.6; design §12 | carry to the checklist |
| `regional.dimensions` is not checked against the registry at publish | F3.md finding 3 | the seed checks it locally |

**New limits LG's shape would meet**

- **Catalog document: 2 MiB of canonical JSON** (`publication.ts:7`, `:58`; kit 02:532). Vantage pieces average 559 bytes, max 738, measured on `open-catalog.json`, so about 3,700 pieces fit. Every snapshot reads the whole catalog and scores every eligible piece for each slot (`service.ts:372`, `:497`; `decide.ts:185-189`), so measure the CPU at LG's size.
- **Snapshot answer** over 2 MiB returns 503 (`decisions.ts:641`). **Import** takes at most 2 MiB and 10,000 records per request (`src/config/input.ts:2-3`).
- **Ledger:** 120,000 bytes per record (`src/ledger/enqueue.ts:19`, `:78`), and every record repeats the page's affinity and regional shares (`src/content/types.ts:402-408`). A 16-dimension registry at 64 values per dimension inflates every record, so keep `maxValuesPerDim` modest. The lift snapshot is capped at 2 MiB (`LearnStats.ts:27`).
- **Slots:** take at most 50, 50 pins, weights 0 to 1, 100 seed rules (`kinds.ts:320-331`, `:246`); one diversity rule per slot (`kinds.ts:409-414`). Slot names are unique across pages (`kinds.ts:476-483`), so per-category PDP templates either use distinct slot names or one `pdp-modules` slot gated by `ctx.category`. The receipt action takes 12 ids per call (`vantage.ts:71`). `/sort` takes 500 candidates and gets no prior (§2.5).
- **Region seed:** one object call per synthetic sale, at most 800 per region (`vantageColdStart.ts:68`, `:306-310`).
- **Imagery:** hundreds of SKUs in three encodings far exceed the 25 MB budget; ship webp only.

## 6. Recommendation

Build LG on the Vantage chassis: Generation 2, its own worker `edge-platform-lg` on the session host, and the same tenant, document, beat, receipt and cold-start pattern.

First extract the kit once (§1), with Vantage as the proving consumer behind its two suites and Top Offers untouched. LG then builds only its vertical layer and its beats.

The three riskiest pieces:

1. **Memory across weeks.** "She comes back" needs a continuity block, a profile retention policy and a fresh consent choice, all owner decisions. It also meets the session host's 30-day sliding expiry, while the object host, which has no idle expiry, is the one whose consumer stalls. Script it as a labelled return in the same browser plus a signed second-device link, measured on the session host.
2. **The taxonomy.** One 32-dimension registry with exact vocabularies and one band per dimension fails silently when a field or a value is wrong, and `/sort` gets no regional prior. Settle the registry and measure the grid before building pages.
3. **The arrival and the win.** Auto-tagged Google clicks read as organic and carry no keyword, and a retailer click is not a reward. Both are small, general engine changes, but they sit in W16 C2 and the outcome contract, so they need rulings and tests.

Publish an empty priors document at bootstrap and add `triggers deploy` to the checklist on day one.
