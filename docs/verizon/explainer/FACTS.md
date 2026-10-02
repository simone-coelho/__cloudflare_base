# Vantage explainers: the facts sheet

**Internal. Lane E1, 2026-10-01.** The writers' only source; anything missing goes to the lead.

**Revised 2026-10-01 by lane W3, at review R2's request:** §2's order of terms is corrected. The external term comes before stage (`decide.ts:291-294`, then `:295-304`). At the coordinator's request, §12's hosted-suite provenance now cites the transcript in the repo, and notes that the suite asserts New York from beat 3 onward. In a third round, §2's per-promotion count of multiply-adds is corrected for the deals slot, and §10 gains two definitions, objective and governanceVersion, for the technical note's appendix.

**References.** `path:line` is code at commit `5ddc64d`; every engine path cited is identical at HEAD (`c720907`). Three files have changed since and are cited as at `5ddc64d`: `src/routes/vantage.ts` (its code now in `src/demos/kit/helpers.ts`), `src/routes/vantageColdStart.ts` (now `src/demos/kit/coldStartRoutes.ts`) and `public/vantage/vantage.js`. `L1 §5` is `docs/verizon/lanes/L1.md` §5. **E1 hosted** means read by this lane from `edge-platform-vantage`, 2026-10-01, 22:25–22:39 UTC: snapshots only (no event moved a prior), documents read with a five-minute read-only operator token, tenant reset at the end (open-slots r52, open-catalog r62).

## 1. The affinity arithmetic (`src/reflex/core.ts`)

**State.** Per dimension value: a raw score R and its last touch, never stored decayed (`:117-121`, `:11-14`).

**An event.** For every value the event touches, R ← R·e^(−Δt/τ) + w and t ← now (`:580-592`). w is the action's registry weight (0 if unnamed; `:50`, `:574`). Then prune and cap (`:594-610`).

**A read.** R(t) = R·e^(−Δt/τ), computed lazily (`:290-293`). Then **a = R/(R+K)** with K = 1.8, so a = 0.5 at R = K (`:296-298`).

**Hysteresis.**

- A value enters at a ≥ **0.60** and leaves only at a < **0.45** (`:618-628`). The validator enforces θ_out < θ_in (`src/reflex/configStore.ts:157-161`).
- Entry needs R ≥ 2.7; exit comes below R = 1.4727.
- Time alone can cause an exit, never an entry.

**Exit time.** t* = t_last + τ·ln(R(1−θ_out)/(Kθ_out)) = t_last + τ·ln(R/1.4727) (`:704-731`).

**Action weights.**

- **The engine ships** (`:221-244`): product_view, pdp_view, view_product 1; wishlist forms 2; add_to_cart, cart_add 3; purchase, checkout, order_complete 5; content_impression 0, content_dwell 0.5, content_click 1, video_complete 2.
- **Vantage publishes** that table plus page_view 1, search 1.5, select 2, filter 2, compare 2 and start_order 3 (`scripts/seed-vantage.mjs:113-125`).
- Every value above is confirmed in the published registry (§10).
- **Correction.** The engine table lacks page_view, search, select, compare, filter and start_order, so an untuned tenant weighs them 0. Design §4's "the engine's own table" has the shape of Meridian's demo table (`src/demos/meridian/reflexConfig.ts:157-165`).
- A `custom` event is named by `data.action`, `data.eventName` or `data.event` (`src/reflex/contentTelemetry.ts:77-83`), so `custom {event: "select"}` weighs 2.

**One view, several dimensions.**

- `extractTouches` emits one touch per registry dimension whose `source` field is present; bands bucket by cuts, multi dimensions touch every entry (`:309-337`).
- With no product catalog held, Vantage publishes `eventAttributes: 'event-when-unknown'`: the event's own registry-sourced attributes count, at most 8 values per array, 64 characters each (`:340-373`, `:491-506`), each admitted only if the catalog's tags name it (`:466-471`; `src/content/service.ts:276-319`).
- **Example.** The Galaxy S26 card view `{productId, category: phones, brand: samsung, os: android, ecosystem: android, price_usd: 899.99, view: card}` (L2 §3) adds 1 to four values at once: phones, samsung, android and core. The `os` and `view` fields are ignored.
- **Storage is not a dimension.** The configured price rides the event, so 512 GB at $1,099.99 touches premium (`seed-vantage.mjs:76-77`).

**Horizons (τ).**

| Dimension | Room (published) | Engine default | Design §4, production |
|---|---|---|---|
| brand, contentType | 60 s | 14 d | not named |
| priceBand | 10 min | 35 d (`core.ts:214`) | 60 d |
| intent | 10 min | 14 d | 14 d |
| perk | 10 min | 14 d | not named |
| ecosystem, lines | 14 d | 14 d | 90 d |
| category | 14 d | 14 d | not named |

- The global default is 14 d (`core.ts:259`) and the validator caps τ at 90 d (`configStore.ts:134`).
- The room's label: "memory compressed for this room; production runs days" (`seed-vantage.mjs:94`).
- **Cap and prune.** Vantage keeps 64 values per dimension with ε 0.01; the engine defaults are 24 and 0.0001 (`core.ts:263-264`). Pruning runs only when an event or tick is applied (`:567-610`).

**Worked numbers.**

| Case | Result |
|---|---|
| One touch, R = 1 | a = 1/2.8 = **0.357** |
| Two together, R = 2 | 0.526 |
| Three together, R = 3 | 3/4.8 = **0.625**, a member |
| R = 3 at τ 60 s | below 0.45 after 60·ln(3/1.4727) = **42.7 s** |
| R = 3 at τ 10 min, 14 d | 7.1 min, 9.96 d |
| Four touches at τ 14 d | 0.690 (android, beats 4–5) |

Touches land 1–2.5 s apart, so R ≈ 2.9 after the third (measured 0.61–0.62, §12).

## 2. Scoring a candidate (`src/reflex/contentCompose.ts`, `src/content/decide.ts`)

**Eligibility comes first.** A piece counts only if live, inside [from, to), not `inStock: false`, and its `eligibleWhen` holds (`src/content/lifecycle.ts:29-73`; `decide.ts:180-189`). `regions` match exactly or by country and fail closed without a region; `context` signals must equal a listed value (`lifecycle.ts:46-62`). `ctx.*` parameters (≤ 8, ≤ 64 characters) "can never boost a piece, re-rank the slot, or become behavioural evidence" (`src/routes/decisions.ts:567-582`). For eligibility an asserted region beats the edge's on every profile (`service.ts:500-517`).

**The base** (`contentCompose.ts:253-264`):

```
B0 = Σ_d ω[S,d] · m_d(p),   m_d(p) = Σ_{v ∈ tags_d(p)} ã_d(v)
```

- ω is the slot's weight, from 0 to 1 (`kinds.ts:323-326`).
- m_d is a plain sum of her blended affinities (§3) over the piece's values on d: no per-tag weight, mean or normalisation; two values both count.
- An untagged `contentType` scores as the piece's `type` (`decide.ts:183-188`).

**Then, in this order** (`decide.ts:288-368`):

1. **Seeds:** add rule weight × dampen × ω for each fired tag, where the tag sum lands (`:337-340`; §4).
2. **External:** the external model term, its weight × its score (`:291-294`); built, unused by Vantage (withdrawn, §13).
3. **Stage:** a piece whose `journeyStageFit` holds her stage gains `inStage`; one outside it is × `outOfStage`; no fit, untouched (`:295-304`).
4. **Freshness, fatigue:** built; unused by Vantage (`:305-323`).
5. **Merchandising:** if the score is above 0, multiply by clamp(Π(1 + w·v), minBoost, maxBoost) over season, promotion and margin (`src/reflex/merchandising.ts:101-160`).
   - The default clamp is 0.5–2 (`:84-85`).
   - Vantage deals: promotion 0.1, clamp 0.7–1.6; only the launch offer carries a signal (1), so ×1.1.
6. **Lift:** multiply by lift^γ (`decide.ts:349-367`), with γ = 0 (§5).

On the receipt, `score_base` is the score after step 4 and `score_final` after step 6 (`decide.ts:324`, `:516`).

**Ranking and take.**

- Sort by score, then catalog order, then id (`contentCompose.ts:271`).
- **Diversity:** a piece over `max` for a value yields to the next. Yielded pieces refill only empty positions, marked `relaxed` (`:299-339`). Vantage deals allow two per brand; unbranded offers never count.
- Then `take` (`:323-334`).
- If every score is zero, the slot serves catalog order, labelled as the default (`:316-321`).

**Pins.**

- Pins are a **required prefix**: reserved before ranking, served first at score 0 as `tenant-pinned` ("ranking never ran for this piece"); the rest are ranked (`contentCompose.ts:182-206`, `:230-235`, `:249`).
- If any pinned piece is ineligible for this request, **the whole slot serves nothing** and records a pin diagnostic (`:187-199`, `:229`; `decide.ts:400-401`).
- Beat 13 pins the Duo, which is gated to device-purchase intents. The walk asserts `new` first (L2 §7.4).

**Exclusions** (`excludedPieceIds`, `excludedTags`, `allowedTypes`, `offLimits`) apply before ranking (`contentCompose.ts:169-180`, `:252`); Vantage publishes none. **The buy box is not a slot**: the engine is never asked about it.

**Cost.** Per candidate: one lookup and multiply-add per tag value on a weighted dimension (in the deals slot, 2–6 for each of the opening catalog's 17 promotions, and 7 for the Black Friday offer that arrives at beat 12), a check per seed tag, up to 3 merchandising factors, one power. 10,000 candidates at seven values is about 70,000 multiply-adds plus a sort of about 133,000 comparisons; the blend runs once per shopper. **None of this has been timed**: a deployed Worker's clock advances with I/O, not CPU, so a pure stage reads 0 ms (`docs/architecture/35-audit-verification-and-source-of-truth.md:494`; E1's hosted snapshot read `decide: 0`).

**`POST /sort`** (`src/reflex/sortCandidates.ts:109-150`) runs the same multiply over attributes carried on the request (the rail sends `id, brand, ecosystem, price_usd`): score = dial × Σ a·w. Differences: weights clamp 0–10, default 1 (`:115-116`); case-insensitive (`:94-107`); her own affinity only, with no blend, seeds, merchandising, stage, learning or pins (`src/routes/sort.ts:93-101`); never filters (`sortCandidates.ts:22-24`); stable on feed order, so dial 0 returns the feed (`:142-146`); ≤ 500 candidates (`sort.ts:38`). Rail weights: affinity 1, brand 1, ecosystem 0.6, priceBand 0.8 (`public/vantage/phones.json` `rail`).

## 3. The regional prior (`src/reflex/regionTrend.ts`, `service.ts`)

**Counts.**

- Every scored event's touches fan into the edge region's object (`RealtimeSegmentEngine.ts:563-566`; `regionTrend.ts:153-165`).
- The key is `country-region` from the request (`:41-46`). An asserted region never feeds it.
- τ is 24 h, with at most 32 values and ε 0.001 (`:28-30`).

**Shares** are R/max R within each dimension (`:123-131`): the leader is 1; not probabilities. New York's brand shares: apple 1, samsung 0.438, google 0.167, motorola 0.063 (E1 hosted).

**Roll-up.**

- Region, then country, then everyone: the finest level with ≥ `minEvents` (30) events answers, else the last found (`:194-210`).
- Roll-ups sum leaf R hourly (`:134-146`, `:259-283`; F3 §4.1).

**The blend** (`service.ts:441-464`).

- **λ = kBlend/(kBlend + Σa)**, where Σa runs over all her values on every dimension (`regionTrend.ts:217-222`; `service.ts:454`).
- **ã = (1−λ)·a + λ·share** (`regionTrend.ts:238-252`).
- At kBlend 0.5: a stranger has λ = 1; Σa = 0.5 gives λ = 0.5; Σa = 3 gives λ = 0.14.
- On a dimension the prior does not blend, her own value is still multiplied by (1−λ).

**The allowlist.**

- `learn.regional.dimensions` limits what is blended; absent means all (`regionTrend.ts:224-234`).
- Vantage lists brand, ecosystem, priceBand and category.
- **Why:** without the list, a walkthrough's lines, intent, perk and content-type touches reached full share for the next stranger (F2 §5 finding 1; F3 §3).

**Off** when a published learn document lacks `regional` (`service.ts:444`; hence Vantage's `enabled: true`) and on the default arm (`:447`). With no learn document at all, the compiled default has it on at kBlend 1 (`service.ts:375`; `kinds.ts:684-693`).

**Asserted region.**

- It selects the prior only on `DEPLOYMENT_PROFILE=demo`, and only with tracking consent (`service.ts:327-331`, `:451-452`).
- The record says `asserted: true` (`:461-462`), and the cell keeps the edge's region. E1's receipt shows a NY prior with `cell.region` US-NC.
- On other profiles it has no effect on the prior (L4 §4).

**Census.**

- It is shown, never scored: `scored: {census: false}` (`src/routes/vantageColdStart.ts:248`).
- Nothing under `src/content`, `src/reflex` or `src/learn` mentions census.

## 4. Seeds (`decide.ts:235-279`; validation `kinds.ts:243-310`)

**Grammar:** signals entry_channel, campaign_term, referrer_network, platform; weight 0–1; ≤ 4 dampen entries; tags only on weighted dimensions.

**Vantage's seeds** (`public/vantage/seeds.json`).

- **Hero and deals:** `campaign_term iphone-18-pro → campaign: iphone-18-pro` at weight **0.2**.
  - It fires when `entry.utmTerm` matches, case-insensitively (`decide.ts:250-254`).
  - The term is not persisted, so the page sends the landing entry on every snapshot (L4 §5.4).
  - `campaign` is not a registry dimension, so no event builds it (`seed-vantage.mjs:524-527`). The catalog diagnostics flag it `unknown_dimension` (E1 hosted).
- **Deals:** `platform ios → ecosystem: ios`, and the Android mirror, at weight **1**.
  - The value comes from `Sec-CH-UA-Platform`, else the user agent, and is ios, android or nothing (`src/services/platform.ts:29-45`; `decisions.ts:594`).
  - A desktop never fires it.

**Contribution.**

- The rule adds weight × dampen × ω for the tag's dimension, before merchandising (`decide.ts:260-279`, `:332-340`).
- `contextual.applied` is measured after merchandising, by rerunning without the seeds (`:341-348`).
- **Launch offer:** 0.2 × 0.3 × 1.1 = **+0.066**. **Launch hero:** **+0.060** (E1 hosted; F1 item 5).
- The platform seed on deals adds 1 × 0.15 = 0.15.

**Dampen.**

- Each entry whose interest she holds as **her own** membership multiplies the weight by its factor. It never reads the prior or asserted context (`decide.ts:94-99`, `:257-270`).
- The iOS rule is ×0.5 while she holds intent switch, and ×0 once she holds android; the Android rule mirrors it.
- Every applied dampen is on the receipt (`:274-275`).

**"Superseded" is arithmetic.**

- The seed never switches off. The launch offer keeps +0.066 while her own affinities grow, λ falls, and the Android offers pass it.
- Hosted, the launch offer is fourth at beat 4, still carrying +0.066 (§12).
- "Campaign context superseded by observed behaviour" is **the page's sentence**, written when the record shows that a seeded piece fell and that the leader rests on her own drivers (`public/vantage/vantage.js:901-930`).

## 5. Learning what works (`src/learn/stats.ts`)

**The cell** (`src/content/cell.ts:51-72`): channel (direct, paid_social, paid_search, email, organic, referral; `visit.ts:37`), visit (1, 2–3, 4+, unknown), the edge's region, the leading affinity above θ_in, and stage (early, mid, late).

**The ladder** has six levels: everyone; channel; + visit; + stage; + region; + affinity cell (`:37-50`). The finest level whose exposures reach nMin answers (`:483-496`).

**The estimate.**

- n and s are decayed with τ_learn **21 d** (`:20`, `:90-97`).
- The slot rate shrinks toward the parent cell's rate (`:411-420`).
- **p̂ = (s + n0·p0)/(n + n0)**, where p0 is the slot's rate in that cell.
- **lift = clamp(p̂/p0, 0.5, 2)**, or 1 when p0 = 0; n0 = nMin = 30 (`:449-450`).

**The dial γ.**

- The score is multiplied by lift^γ (`decide.ts:365`), with γ from 0 to 1 per slot (`kinds.ts:628`). It defaults to 0 (`service.ts:490`), and Vantage publishes **0** everywhere.
- At γ = 0 the lift is computed, recorded and ignored (`decide.ts:61-62`). E1's receipts carry `lift: null` (`:353`, `:361`).

**Exploration is off** (`src/learn/explore.ts:35`).

- When on, a visitor-slot-hour hash decides; rotation serves the least-observed item under `floor`, epsilon a uniform pick (`:7-11`, `:160-180`).
- **Thompson sampling is withdrawn.** It is refused at publish (`kinds.ts:637-638`) and inert if retained (`explore.ts:38-40`, `:142`).
- Position-bias correction is a parity build item (parity §1); no position-discount term exists yet.

**The ledger.**

- **One record per served position** (`src/content/types.ts:433`; `decide.ts:491-531`): ids and time; page, slot, position, item; top 10 candidates; cell, stage, arm, experiment, authority, explored, versions; the itemised `explain`; replay inputs (her vector, the regional shares, `:471-488`).
- **Each outcome:** the decision, type (click, dwell, video_complete, wishlist, add_to_bag, purchase, custom), item, slot, value, currency, margin, products, arm (`src/ledger/records.ts:108`, `:121-151`).
- **Credit:** session scope, direct match, last credit; click window 30 min, purchase 7 d (`src/learn/fan.ts:1-5`).
- **The day report** labels itself `attribution_diagnostic`, with inference `unavailable` (`src/learn/report.ts:613-618`). It covers one UTC day of folded hours, so a click shows only after its hour folds (F1; RESUME-vantage.md).

**Holdout arms:** `default` serves the site's defaults with pins kept (`decide.ts:165-168`); `no_learning` personalises at γ 0 (`:196-198`); assignment is a sticky hash (`src/content/holdout.ts:280-289`). Vantage's share is 0: shown, not run.

## 6. Journey stage (`src/services/JourneyStage.ts`)

**One stage, three vocabularies.** The engine reports exploring, thinking and deciding (`:124`), stores early, mid and late (`:135-139`), and content fits say exploring, considering and deciding (`STAGE_WORDS`, `:33-37`; `decide.ts:215`).

**Counting** is per visit; 30 idle minutes starts a new one (`visit.ts:30`; `JourneyStage.ts:305-327`). Card quick looks count as product views (`:292`).

**Thresholds:** thinking at **six product views**, deciding at the **first cart add or purchase** (reflex r3); engine default 3 interactions / first purchase (`:181-186`).

**Where the stage is used.**

- Only the hero slot scores on it (`inStage` 0.5, `outOfStage` 0); the learning cell also records it. The continue hero is multiplied by 0 until then and gets +0.5 after; it scored 0.500 at 15a.
- Module stage fits are inert, because `pdp-modules` has no stage rule.

## 7. Audiences

**Memberships.**

- Each touched value is a membership named `<dim>_<value>_affinity` (`core.ts:181-192`). It enters at θ_in and exits below θ_out (`:618-628`).
- Transitions are recorded with their score, thresholds, trigger and version (`:146-160`, `:634-651`).
- Vantage shows these, for example `brand_samsung_affinity` (L4 §6).

**Governed definitions.**

- The generator mints "<Value> Affinity", with the condition `<dim>_affinity.<value> gte θ_in`, for any value carried by at least 3 catalog products, and stamps each with a content hash (`src/reflex/audienceGenerator.ts:54-56`, `:96-150`).
- Regeneration is a diff that never touches pinned or human-edited definitions (`:152-225`).
- Operator verbs: rename (label only; the key is fixed), pin, and prune (archive; the key stays resolvable) (`src/routes/operator.ts:441`, `:463`, `:491`).
- The generator runs only for the default demo tenant (`RealtimeSegmentEngine.ts:328`). So Vantage shows memberships, not definitions or verbs.

**Membership versus ranking.** On the session host a membership flag updates at her next event, while ranking reads the decayed score (RESUME-vantage.md finding 4).

## 8. Identity and memory

- **Session.** Random `vis-<uuid>` visitor and `s-<uuid>` session ids (`src/identity/sessionCapability.ts:181`). They travel in an HMAC-SHA-256-signed capability valid for at most 24 h (`:14`, `:66-73`).
- **Link at sign-in.**
  - The site's backend signs HMAC(tenant, visitorId, accountId, exp), valid for at most 24 h (`src/identity/assertion.ts:11-17`, `:32`). The route verifies it before any merge (`src/routes/identity.ts:361`).
  - The merge sums both profiles' decayed scores at the later touch and unions their memberships (`src/reflex/identityMerge.ts:49-52`, `:65-90`; `SessionManager.ts:619`).
  - Nothing is overridden, and recent behaviour leads.
- **30 days.** A session expires at the earlier of 30 days and the tenant's retention (`src/services/SessionManager.ts:96`, `:352-353`); affinity also decays on its τ.
- **No fingerprinting.** The browser carries a random id; the only device read is the OS family (`platform.ts:13-16`).
- **Erasure.** The code describes "Bounded, manually resumable LOCAL erasure steps", and says this is not "proof of physical/external erasure" (`src/identity/erase.ts:1-2`; route `identity.ts:525`).

## 9. The receipt (E1 hosted, 22:29:44 UTC)

Taken as the page does: mint a session, grant consent, snapshot home with entry `{utmSource: tiktok, utmMedium: paid-social, utmTerm: iphone-18-pro}`, `ctx.region=US-NY` (the labelled override), `ctx.intent=new`, no platform header; then `POST /vantage/api/receipt` (202 at 2.5 s, 200 at about 6 s). Visitor id and nonce redacted; the route already omits visitor, session and replay inputs (`src/routes/vantage.ts:111-125`).

```json
{
  "decision_id": "vantage:muq3x3y9:<visitor>:home:deals:0:n1:<nonce>",
  "ts": 1790893784385, "page": "home", "slot": "deals", "position": 0, "ranking_position": 0,
  "item_id": "promo_iphone_18_pro_launch", "customer_item_id": "promo-iphone-18-pro-launch",
  "arm": "personalized", "authority": "engine", "explored": false,
  "cell": {"channel": "paid_social", "visit_bucket": "unknown", "region": "US-NC", "affinity": null, "stage": "early"},
  "journey": {"stage": "exploring", "version": "reflex-vantage-v2-room-memory+r3"},
  "versions": {"config": 3, "catalog": 61, "slots": 51, "learn": 3, "lift": 0, "prior": 0, "policy": 3},
  "config_label": "reflex-vantage-v2-room-memory+r3",
  "candidates": [
    {"contentId": "promo_iphone_18_pro_launch", "score": 0.671}, {"contentId": "promo_iphone_duo_preorder", "score": 0.55},
    {"contentId": "promo_iphone_17_new_line", "score": 0.55}, {"contentId": "promo_galaxy_z_fold8_trade_in", "score": 0.388},
    {"contentId": "promo_galaxy_s26_new_line", "score": 0.338}, {"contentId": "promo_pixel_11_launch", "score": 0.284},
    {"contentId": "promo_razr_new_line", "score": 0.263}, {"contentId": "promo_edge_flash", "score": 0.263},
    {"contentId": "promo_moto_g_new_line", "score": 0.223}, {"contentId": "promo_5g_home", "score": 0.006}
  ],
  "explain": {
    "drivers": [
      {"dim": "brand", "value": "apple", "a": 1, "weight": 0.2}, {"dim": "ecosystem", "value": "ios", "a": 1, "weight": 0.15},
      {"dim": "category", "value": "phones", "a": 1, "weight": 0.1}, {"dim": "priceBand", "value": "premium", "a": 1, "weight": 0.1},
      {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.55}, {"dim": "merchandising", "value": "promotion", "a": 1, "weight": 0.1}
    ],
    "score_base": 0.61,
    "regional": {"region": "US-NY", "level": "region", "lambda": 1, "version": 1790865492056, "events": 425, "asserted": true, "contribution": 0.55},
    "lift": null,
    "score_final": 0.671,
    "contextual": {"applied": 0.066, "drivers": [
      {"signal": "campaign_term", "value": "iphone-18-pro", "dimension": "campaign", "tag": "iphone-18-pro", "weight": 0.2, "contribution": 0.066}]},
    "merchandising": {"boost": 1.1, "clamped": false,
      "drivers": [{"term": "promotion", "value": 1, "weight": 0.1, "boost": 1.1, "contribution": 0.061}],
      "sentence": "promotion 1.00 at weight 0.10 gives 1.10x; 0.6100 to 0.6710"}
  },
  "measurementBasis": "served-v1",
  "featured_product_ids": ["iphone-18-pro", "iphone-18-pro-max"],
  "asserted": {"ctx.region": {"value": "US-NY", "from": "record"}, "ctx.intent": {"value": "new", "from": "request"}}
}
```

**Arithmetic:** 0.2 + 0.15 + 0.1 + 0.1 = 0.55 (all regional, λ 1); + 0.06 seed = 0.61; × 1.1 = **0.671**. Without the ad: 0.605 (F2 §3).

| Field | Meaning |
|---|---|
| `decision_id` | `tenant:time36:visitor:page:slot:position:n1:nonce` (`decide.ts:506`); the owner is checked before any read (`vantage.ts:96-109`) |
| `ranking_position`, `authority` | Rank after any pins (`decide.ts:500`); engine, pin or default (`:158-159`) |
| `cell` | The edge's region (NC), though the prior was NY; visit unknown (none recorded yet); no leading affinity |
| `versions` | The document revisions in force; `lift: 0` means no lift snapshot |
| `candidates` | The top 10 (`contentCompose.ts:293-297`); the iPhone 17 offer tied at 0.55 and yielded to the brand cap |
| `drivers` | The top four by a × ω, then regional and merchandising (`contentCompose.ts:309-321`; `decide.ts:436-451`). **`a` is the blended value: for a stranger, the region's share** |
| `score_base` | Before merchandising: the tag sum plus the seed |
| `regional` | λ, level, version, events, `asserted`, and Σ λ·share·ω |
| `contextual`, `merchandising` | The seed as it landed, and the per-term deltas, which sum to final − base (`merchandising.ts:20-25`) |
| `measurementBasis` | `served-v1`: counted as served; the page sends no `pageInstance` (L2 §7.7) |
| `featured_product_ids` | The phones that credit this decision when an outcome names one (`decide.ts:514`) |
| `asserted` | Added by the route: region from the record, intent from the page, because the ledger stores no asserted intent (`vantage.ts:155-171`) |

**The hero record's `explain`:**

```json
{"candidates": [{"contentId": "hero_launch", "score": 0.26}, {"contentId": "hero_switch", "score": 0},
                {"contentId": "hero_family", "score": 0}, {"contentId": "hero_continue", "score": 0}],
 "explain": {"drivers": [{"dim": "brand", "value": "apple", "a": 1, "weight": 0.1}, {"dim": "ecosystem", "value": "ios", "a": 1, "weight": 0.1},
                         {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.2}],
   "score_base": 0.26, "lift": null, "score_final": 0.26,
   "regional": {"region": "US-NY", "level": "region", "lambda": 1, "version": 1790865492056, "events": 425, "asserted": true, "contribution": 0.2},
   "contextual": {"applied": 0.06, "drivers": [
     {"signal": "campaign_term", "value": "iphone-18-pro", "dimension": "campaign", "tag": "iphone-18-pro", "weight": 0.2, "contribution": 0.06}]}}}
```

**The snapshot's thin explains** (drivers only; design §4): the hero, then the third deal.

```json
{"contentId": "hero_launch", "score": 0.26, "strategy": "affinity",
 "explain": {"drivers": [{"dim": "brand", "value": "apple", "a": 1, "weight": 0.1},
   {"dim": "ecosystem", "value": "ios", "a": 1, "weight": 0.1}, {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.2}]}}

{"contentId": "promo_galaxy_z_fold8_trade_in", "score": 0.388, "strategy": "affinity",
 "explain": {
   "drivers": [{"dim": "ecosystem", "value": "android", "a": 0.667, "weight": 0.15}, {"dim": "category", "value": "phones", "a": 1, "weight": 0.1},
     {"dim": "priceBand", "value": "premium", "a": 1, "weight": 0.1}, {"dim": "brand", "value": "samsung", "a": 0.438, "weight": 0.2},
     {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.388}, {"dim": "merchandising", "value": "promotion", "a": 0, "weight": 0.1}],
   "diversity": {"dimension": "brand", "max": 2, "skipped": ["promo_iphone_17_new_line"], "relaxed": false,
     "sentence": "promo_iphone_17_new_line yielded: at most 2 per brand in this slot"}}}
```

The envelope's timings (documents 438, shopper 7, trend 104, lift 108, decide 0 ms) are one cold reading: not quotable.

## 10. The published documents (E1 hosted; identical to `scripts/seed-vantage.mjs`)

Served: reflex r3, slots r51, learn r3, catalog r61 (17 promotions, 4 heroes, 7 modules, 4 plans).

**Registry** (published 2026-10-01 14:34:48 UTC):

```json
{
  "K": 1.8, "thetaIn": 0.6, "thetaOut": 0.45, "tauMs": 1209600000, "epsilon": 0.01, "maxValuesPerDim": 64,
  "eventAttributes": "event-when-unknown", "version": "reflex-vantage-v2-room-memory+r3",
  "dimensions": [
    {"key": "category", "source": "category"},
    {"key": "brand", "source": "brand", "tauMs": 60000},
    {"key": "ecosystem", "source": "ecosystem"},
    {"key": "priceBand", "source": "price_usd", "derive": "band", "cuts": [400, 900], "labels": ["entry", "core", "premium"], "tauMs": 600000},
    {"key": "intent", "source": "intent", "multi": true, "tauMs": 600000},
    {"key": "perk", "source": "perk", "multi": true, "tauMs": 600000},
    {"key": "lines", "source": "lines"},
    {"key": "contentType", "source": "contentType", "tauMs": 60000}
  ],
  "journey": {"stages": [{"stage": "thinking", "anyOf": {"product_views": 6}}, {"stage": "deciding", "anyOf": {"cart_adds": 1, "purchases": 1}}]},
  "weights": {"product_view": 1, "pdp_view": 1, "view_product": 1, "page_view": 1, "search": 1.5, "select": 2, "filter": 2, "compare": 2,
    "wishlist": 2, "wishlist_add": 2, "add_to_wishlist": 2, "save_for_later": 2, "start_order": 3, "add_to_cart": 3, "cart_add": 3,
    "purchase": 5, "checkout": 5, "order_complete": 5, "content_impression": 0, "content_dwell": 0.5, "content_click": 1, "video_complete": 2, "tick": 0}
}
```

**Slots** (the opening state, reset 21:12:09 UTC; beat 13 adds `"pinnedPieceIds": ["promo_iphone_duo_preorder"]` to deals):

```json
{
  "version": "slots-vantage+r51", "governanceVersion": 3,
  "pages": {
    "home": [
      {"slot": "hero", "take": 1, "weights": {"brand": 0.1, "campaign": 0.3, "ecosystem": 0.1, "intent": 0.5, "lines": 0.35},
       "stage": {"inStage": 0.5, "outOfStage": 0},
       "seeds": [{"signal": "campaign_term", "value": "iphone-18-pro", "tags": [{"dimension": "campaign", "value": "iphone-18-pro"}], "weight": 0.2}]},
      {"slot": "deals", "take": 4,
       "weights": {"brand": 0.2, "campaign": 0.3, "category": 0.1, "ecosystem": 0.15, "intent": 1, "lines": 0.4, "perk": 0.1, "priceBand": 0.1},
       "merchandising": {"maxBoost": 1.6, "minBoost": 0.7, "promotion": 0.1},
       "diversity": {"dimension": "brand", "max": 2},
       "seeds": [
         {"signal": "campaign_term", "value": "iphone-18-pro", "tags": [{"dimension": "campaign", "value": "iphone-18-pro"}], "weight": 0.2},
         {"signal": "platform", "value": "ios", "tags": [{"dimension": "ecosystem", "value": "ios"}], "weight": 1,
          "dampen": [{"dimension": "intent", "value": "switch", "factor": 0.5}, {"dimension": "ecosystem", "value": "android", "factor": 0}]},
         {"signal": "platform", "value": "android", "tags": [{"dimension": "ecosystem", "value": "android"}], "weight": 1,
          "dampen": [{"dimension": "intent", "value": "switch", "factor": 0.5}, {"dimension": "ecosystem", "value": "ios", "factor": 0}]}]}
    ],
    "phone": [
      {"slot": "pdp-modules", "take": 6, "weights": {"category": 0.15, "contentType": 0.2, "intent": 0.2, "lines": 0.3, "perk": 0.35, "priceBand": 0.2}},
      {"slot": "plan-pairing", "take": 3, "weights": {"intent": 0.5, "lines": 0.25, "perk": 0.35}}
    ]
  }
}
```

**Learn** (published 14:34:53 UTC):

```json
{
  "version": "learn-vantage+r3",
  "holdout": {"share": 0, "salt": "vantage", "arms": ["default"]},
  "regional": {"enabled": true, "kBlend": 0.5, "minEvents": 30, "dimensions": ["brand", "ecosystem", "priceBand", "category"]},
  "policy": {"scope": "session", "match": "direct", "credit": "last",
    "windowsMs": {"click": 1800000, "dwell": 1800000, "video_complete": 1800000, "custom": 1800000, "wishlist": 21600000, "add_to_bag": 21600000, "purchase": 604800000}},
  "stats": {"n0": 30, "tauLearnMs": 1814400000, "liftMin": 0.5, "liftMax": 2, "nMin": 30},
  "slots": {
    "deals": {"gamma": 0, "reward": "click", "objective": "unit", "exploration": {"mode": "off", "share": 0, "floor": 0}},
    "hero": {"gamma": 0, "reward": "click", "objective": "unit", "exploration": {"mode": "off", "share": 0, "floor": 0}},
    "pdp-modules": {"gamma": 0, "reward": "click", "objective": "unit", "exploration": {"mode": "off", "share": 0, "floor": 0}},
    "plan-pairing": {"gamma": 0, "reward": "click", "objective": "unit", "exploration": {"mode": "off", "share": 0, "floor": 0}}
  }
}
```

| Knob | What it does |
|---|---|
| registry `dimensions` | Names the axes, the field each reads, `multi` arrays, and bands cut at 400 and 900 |
| registry `tauMs`, `K`, `thetaIn`, `thetaOut` | Memory horizon; saturation; the entry and exit lines |
| registry `weights` | What each action adds to R |
| registry `epsilon`, `maxValuesPerDim` | The prune floor; how many values are kept |
| registry `eventAttributes`, `journey` | Lets event attributes count without a catalog; sets the stage thresholds |
| slots `take`, `weights` | How many pieces are returned; ω, from 0 to 1 |
| slots `stage`, `seeds` | The stage bonus and multiplier; the arrival rules |
| slots `merchandising`, `diversity`, `pinnedPieceIds` | The promotion multiplier and its clamp; the per-value cap; the prefix |
| learn `holdout`, `regional` | Share, salt and arms; the prior, kBlend, minEvents and the allowlist |
| learn `policy`, `stats`, `slots[]` | Attribution windows; n0, horizon, clamp and nMin; γ, reward and exploration |

**Two definitions** (for the technical note's appendix, verbatim; checked at HEAD `2dfb352`):

- **objective `unit`** counts each credited outcome as one. `revenue` would weigh it by the outcome's value and `margin` by its margin, and either needs a reward that carries a value, `purchase` or `add_to_bag` (`src/content/kinds.ts:630-633`; `src/learn/policy.ts:78-82`).
- **governanceVersion 3** names the generation of slot-control rules the slots document is checked and decided under. Version 1 admits off-limits and excluded pieces, version 2 adds allowed types and excluded tags, and version 3 adds pin prefixes (`src/content/types.ts:186-187`; `src/content/kinds.ts:438-440`, the controls at `:329-371`).

## 11. What a catalog needs

**Piece fields** (`kinds.ts:34-36`; validated at `:79-210`).

- **Required:** `id`, `customerContentId`, `type`, `title`, `tags` (dimension → string[]) and `slotTypes`.
- **Optional:** `subtitle`, `excerpt`, `runtime`, `lifecycle`, `window`, `eligibleWhen`, `art`, `renderUrl`, `merchandising` (0–1 signals), `journeyStageFit`, `freshnessDate`, `featuredProductIds` and `inStock`.
- `eligibleWhen` takes 1–64 regions and 1–8 context signals.

**The vocabulary** (`seed-vantage.mjs:81-90`):

| Dimension | Values |
|---|---|
| category | phones, plans, home-internet, accessories, watches-tablets |
| brand | apple, samsung, google, motorola |
| ecosystem | ios, android |
| priceBand | entry, core, premium |
| intent | new, switch, upgrade, add-line, byod, home |
| perk | streaming, music-games, hotspot-travel, international, family |
| lines | solo, duo, family |
| contentType | deal, compare, explainer, tool |

**Reads.** Events carry the product id: a held product's attributes win, else the event's own count, bounded as in §1 (`core.ts:481-506`); `/sort` carries attributes on the request. The offer book (`grammar`, `badge`, `cta`) goes to the page's `catalog.json`, never the engine (`seed-vantage.mjs:201-203`).

**Verizon's grid fields** (research brief: "type, eligible intents, plan and line requirements, flash end date, priority, maximum flag and resulting monthly price", session scratchpad `research-telco-buying.md:105`; priority flag `:76`; not combinable `:102`):

| Grid field | In Vantage | Decided? |
|---|---|---|
| Brand | `brand` on events, on `/sort` and in `tags` | Scored |
| OS | `ecosystem` (the event's `os` is ignored) | Scored |
| Storage | The configured price rides the event | Through the band |
| Full retail price | `price_usd` → `priceBand` at 400 / 900 (configuration) | Scored, as a band |
| Offer type | `badge`, display only | No |
| Eligible intents, line requirement | `eligibleWhen.context.intent` (fails closed) plus `tags.intent` | Gated and scored |
| Plan requirement | `grammar.plan`, display only | No |
| Priority flag | `merchandising.promotion` with the slot's dial, or a pin | Multiplier or prefix |
| Flash end date | `window.to` | Eligibility |
| Not combinable | `grammar.combinable`; no stacking logic exists | No |
| Coverage | `eligibleWhen.regions` | Eligibility |
| Maximum flag, monthly price | Buy-box content | Never |

**Per product: attributes only.** Per slot: weights, take, stage rule, seeds, merchandising, diversity, pins, exclusions, learning dials. Per piece: tags, window, rule, signals, stage fit.

## 12. Measured numbers

**Sources:** E1 hosted (22:29–22:38 UTC); **hosted suite** = the request-level output, `docs/verizon/lanes/evidence/suite-page-hosted-2026-10-01.txt` (an unchanged copy, 15:22 UTC; the README beside it names the script, the host, the time and the 112-of-112 result), whose revisions match F3's closing 112/112 run on worker `a04595db` (F3 §6); the rest as their lane notes say. The suite asserts New York from beat 3 onward (the transcript's beat-3 header: "back in New York").

| Beat | Figure | Source |
|---|---|---|
| 1, NC stranger, ad, clean seed | launch 0.651 · Duo 0.532 · Fold8 0.497 · S26 0.485; hero 0.248 | F2 §3, F3 §3 hosted |
| 1, NC today (40 live events) | 0.638 · 0.520 · 0.513 · 0.502; hero 0.240. No ad: launch 0.572, hero 0.180 | E1 hosted |
| 1, NY override, ad | hero 0.260; 0.671 · 0.550 · 0.388 · 0.338; +0.066 and +0.060 | E1 hosted; hosted suite; L5 §6 local |
| 2, Texas | 0.563 · S26 0.550 · Fold8 0.524 · Duo 0.452; hero 0.214. No ad: S26 first, 0.550 | Hosted suite; L4 §2 |
| 1, all 51 regions | launch first with the ad, 0.623–0.671 | F2 §3 local |
| 3, Samsung after 1, 2, 3 touches | 0.352, 0.513, 0.612 (local 0.356, 0.523, 0.621; D1 third touch 0.614) | Hosted suite; L5 §6; design §12 |
| 4, hinge | S26 offer 0.353 first · Fold8 0.336 · Pixel 0.302 · launch **0.245 fourth, +0.066 applied**; brand 0.601 | Hosted suite; L1 §5 |
| 5, exit, re-asked at 52 s | brand **0.398** < 0.45, android **0.690**; order held (D1 0.406; local 0.35–0.41) | Hosted suite; design §12; L1, L5 |
| 6 | storage 0.085, protection 0.085; fresh visitor 0.200 | Hosted suite |
| 7 | storage **0.294** first, protection **0.163**; +$5.56 a month | Hosted suite; phones.json |
| 8 | plan pairing second (0.229), More **0.115**; streaming shopper gets Max 0.106 | Hosted suite |
| 9a | connected devices **0.404** first, Go 0.146; household $112.00 (4 × $28) | Hosted suite; L2 §4 |
| 9b | family hero 0.205; four-line offer 0.601, level with the watch line | Hosted suite |
| 10 | Simple 0.248, switch hero 0.247, watch line 0.602, bring-your-phone 0.528; on upgrade, More 0.363 and S26 Ultra 0.879 | Hosted suite |
| 11–13 | successor 0.774; Black Friday 0.836; Duo pinned | Hosted suite |
| 14 | home bundle 0.349, second, in NY; absent in Montana | Hosted suite |
| 15a | continue hero 0.500 | Hosted suite |

**Census, ACS 2024 1-year** (B19013, B25077; E1 hosted):

| State | Median household income | Median home value | Synthetic sales |
|---|---|---|---|
| NC | $73,958 | $333,000 | 458 seeded + 40 live |
| NY | $85,820 | $449,800 | 425 |
| TX | $79,721 | $313,200 | 490 |

**Suites:**

| Suite | Results |
|---|---|
| Hosted request-level | 111/111 (D1); 112/112 (F2, F3) |
| Hosted DOM | 221/221 (D1); 225/225 (F2); 224/225, then 225/225 (F3) |
| Local | 112/112 and 225/225 (F3 §2) |

## 13. The honesty ledger

**Real:** the arithmetic, every constant published; windows; `eligibleWhen`, failing closed; pins; the brand cap; receipts; versioned publishes; the edge region; the OS seed (phones only); census, shown never scored; the report, as attribution.

**Labelled:** synthetic regional sales (NY and TX are L4's; the other 49 modelled from census income, F2 §2); room-compressed memory; the asserted override region; simulated visitors.

**Designed, not live.**

- Stage two moves nothing until γ moves.
- The external model term is an input seam, itemised before the lift (`decide.ts:199-202`, `:291-294`) and withdrawn by policy (`service.ts:471-479`).
- Exploration is off, and Thompson sampling is withdrawn.
- The holdout is shown, not run.
- The sign-in hand-off and ASN seeding are not built (RESUME-vantage.md; design §5); the `?exit=1` push is unused; position-bias correction is a build item.

**Never say:**

- **"We don't use a model."** The decision is itemised arithmetic, but a model seam exists. The room heard "No hidden model; it fits on an envelope" (script, beat 3); go no further.
- **Any lift or revenue claim.** Inference is `unavailable`.
- **"Under 200 ms."** The only sourced figure is doc 32 §5, from staging on 2026-09-05: 235 ms P50 inside the worker for a never-seen shopper, and 5 ms for a returning one (`docs/architecture/32-latency-numbers.md:14-17`, `:88-89`). Nothing has been timed on Vantage.
- **Anything judging Verizon's past work**, "no limit", a bandit winner, or another customer's name (design §6).

**Corrections to carry:** the engine's table lacks six weights (§1); "superseded" is the page's sentence (§4); the buy box is not a slot (§2); the four usually hold their order at the exit (L4 §6).

## Not sourced

1. The 235 ms and "tens of ms" lines: doc 32 only (§13).
2. The hosted suite figures for each beat: now in the repo, `docs/verizon/lanes/evidence/suite-page-hosted-2026-10-01.txt` (§12).
3. +1.00 per click is a local figure (L5 §5). On the hosted worker, D1 recorded only that the report grew.
4. Nothing has been measured at production τ.
5. Nothing has been timed at 10,000 candidates.
