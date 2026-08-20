<!-- INTERNAL - pursuit research. Compiled 2026-08-20. Method: NO search engines available - every claim from direct fetches of primary sources, live page payloads, DNS records; secondary sources flagged. Read the Open Items before any customer conversation. Companion: NYT-Pursuit-Research-Brief.md -->

# NYT / Publisher Martech Vendor Landscape

## Headline answer

**NYT builds experimentation, personalization, paywall decisioning, CDP/audience, analytics and privacy in-house — and has said so on the record, including a section literally titled "Built, Not Bought."** The one material exception, and the most actionable finding: **NYT runs Statsig (third-party) for feature gating at the Fastly edge alongside in-house ABRA — and Statsig's ownership changed twice in ~12 months (team to OpenAI; product to Amplitude, May 5, 2026).** That is the realistic Optimizely wedge, not an ABRA rip-and-replace.

---

## 1. What NYT actually uses today

### Experimentation — in-house "ABRA" + Statsig
- **VERIFIED — ABRA (A/B Reporting and Allocation architecture) is in-house; vendors were evaluated and rejected.** open.nytimes.com, 2017-08-30. Verbatim, from the section headed **"Built, Not Bought"**: *"Our most important tests (e.g. home page redesign, meter rule and paywall testing, ad pattern changes) required experiments to live deeper in our infrastructure than vendor solutions would allow. So we decided to build ABRA ourselves."* Consolidated five prior testing platforms.
- **VERIFIED — ABRA live in production today.** Live nytimes.com HTML: `window.Abra`, `abra-overrides`/`abra-nuke`, public configs at `a1.nyt.com/abra-config/current/vi-prd.json` (ver 29813, 25 tests), `games-prd.json` (48 tests), `hybrid-prd.json`. Live test names: `SUBX_regi_traffic_controller`, `CONV_WELCOME_AD_BANDIT_258`, `OMA_PAYWALL_SPELLING_BEE`, `OFFERS_STRATEGY_PRESENTATION_ROLLOUT_06_2025`. Rules in JSONLogic (github.com/nytimes/jsonlogic).
- **VERIFIED — standardization program with named owner.** "Milestones on Our Journey to Standardize Experimentation," Kathy Yang (Director of Experimentation), 2024-03-26. ABRA has its own Stats Engine; dual-tier metric governance; daily t-tests/CIs/MDE; non-inferiority testing; bootstrapped quantile metrics.
- **VERIFIED — in-house mobile A/B SDK** (2021-03-04 post): GitHub-repo-configured tests; Duktape/JavaScriptCore evaluation.
- **VERIFIED payload / HIGH-CONFIDENCE INFERRED vendor — Statsig in production.** Live homepage, /subscription and Wordle pages carry `fastlyStatsigUsedAssignments: {"gates":{...}}` (real gates: `home_non_tristate_0925`, `free_always_homescreen`, `journeys_free_month_front_end_gate`, `one_tap_web`…) and an `x-statsig-home-curator-assignments` header with Statsig's exact gates/layers/configs data model, evaluated server-side in **Fastly Compute**. Not confirmed by any NYT statement.
- **VERIFIED — Statsig ownership churn.** statsig.com banner: "Statsig is part of the Amplitude family." Statsig blog 2026-06-17: *"Statsig joined the Amplitude family on May 5"*; *"the original Statsig team, now at OpenAI"*; data-layer integration "over the next four months," full interoperability only in "Phase 2." **Live continuity-risk talking point.**

### Paywall / personalization — in-house, advanced
- **VERIFIED.** "Scaling Subscriptions with Real-Time Causal Machine Learning," Rohit Supekar (Lead ML Scientist), 2025-10-03 — millisecond regwall/paywall/allow decisions; S-Learner causal models on an always-on RCT; weights re-tuned daily (U-NSGA-III) against business constraints; teams: Algorithmic Targeting, ML Platform, Meter.
- **VERIFIED — predecessor Dynamic Meter** (2022-08-10). Notable: no demographic/psychographic features by policy.
- **VERIFIED — in-house recommender bandits** (2019-10-17): contextual geo-bandits, +55% CTR on Editors' Picks, redeployed every 15 min, BigQuery + BigTable.
- **VERIFIED infra:** `meter-svc.nytimes.com`, `als-svc.nytimes.com`, `messaging.nytimes.com`, `a.nytimes.com` all CNAME to NYT's own AWS region selector.

### CDP / customer data — in-house
- **VERIFIED** (2020-12-17): *"The Times opted to build an in-house solution so we could control our data and audience targeting."* GCP Dataflow → BigQuery → survey-trained ML → Airflow → Go microservices + Memorystore, <100ms activation.

### Privacy — in-house "PURR" + Sourcepoint CMP
- **VERIFIED** (2021-05-06): PURR serves 8 directives to 70+ products; `PURR_AdConfiguration` visible live. CMP: Sourcepoint. OneTrust TXT records exist (INFERRED: internal DSR use).

### Analytics / email / billing / ads / cloud
- **VERIFIED on live pages:** first-party collector (`a.nytimes.com`, `UnifiedTracking`), Chartbeat, Comscore, GTM + GA, Datadog RUM, Sentry, Akamai mPulse.
- **VERIFIED via SPF/DNS — email:** SparkPost + Amazon SES sending, Valimail auth, DMARC `p=reject`. INFERRED: newsletter orchestration in-house; no Braze/Iterable/SFMC/Sailthru evidence. Klaviyo (×3) and Segment TXT records exist — prove a relationship somewhere in NYT Co., **not** core-product use.
- **Billing: not publicly confirmed.** Weak signals: `braintree_java` GitHub fork; Apple Pay express-checkout ABRA tests; entitlements look in-house (`fastlyEntitlements`). No Zuora/Recurly/Piano VX evidence.
- **VERIFIED ad stack:** Prebid.js, Google Ad Manager, Amazon APS, **LiveRamp ATS (pid 14158)**, UID2, Google PAIR, Media.net, GeoEdge; AppsFlyer as MMP.
- **VERIFIED cloud/CMS:** GCP + AWS; CDN Fastly incl. Fastly Compute; GraphQL gateway "Samizdat"; CMS in-house (Oak/Scoop lineage).
- **⚠️ Adobe caveat:** the `adobe-idp-site-verification` TXT record is Creative Cloud SSO — **not** evidence of Adobe Target/AEP.
- **NOT FOUND on any NYT page scanned:** Optimizely, Adobe Target/demdex, Braze, Airship, Iterable, Salesforce MC, Amplitude, Piano/Tinypass, Cxense, Zuora, Zephr, Recurly, Segment code, Tealium, mParticle, BlueConic, Permutive, LaunchDarkly, Split, VWO, Dynamic Yield, Monetate, Kameleoon, AB Tasty.

---

## 2. Piano.io — the incumbent-thinking competitor

- **VERIFIED:** >1,000 clients, >400bn monthly events, 14 offices. **New CEO Nick Worth 2026-04-27**; "Piano Activation" renamed **Piano Subscriptions** 2026-07-01.
- **Products:** **Composer** = "the intelligence layer… deciding who sees which offer, when, and why" (AI propensity + real-time segmentation + MVT). **VX/Billing** — now **Stripe Billing at the core**. **ID**, **Analytics** (+MCP 2026-06-29), **Audience** (Cxense inheritance), **Amplifier** (SocialFlow inheritance).
- **Propensity models:** Likelihood to Subscribe / Return / Register / Content Likelihood to Convert; dynamic paywall can optimize **total revenue** incl. forfeited ad revenue.
- **⚠️ KEY FINDING:** Piano's SocialFlow acquisition release (2022-02-09) lists clients incl. **The New York Times**. **As of Feb 2022 NYT was a SocialFlow customer — and Piano bought SocialFlow.** Piano likely has a live account/foot in the door. Current status **unverified — ask directly.**
- **Named publisher customers:** CNBC, DMG Media, El Mundo, iNews, Kathimerini, Le Devoir, Blick, Salt Lake Tribune, The Spectator, Sifted, et al.
- **Strengths:** owns the transaction (offer→billing→entitlement), publisher-specific propensity models, total-revenue optimization, category default. **Weaknesses:** testing scoped to monetization journeys (cannot host the deep-infrastructure tests NYT says it needs); black-box models = a *downgrade* from NYT's published causal-ML meter; CEO change + rebrand + billing re-platform all in 2026.

---

## 3. Other vendors pitching publishers (one-liners)

- **Adobe** (Target+AEP+AJO+AEM) — integrated-stack pitch. ⚠️ Adobe pages unreachable this session; INFERRED, verify before quoting.
- **Braze** — VERIFIED Media & Entertainment vertical (RTL, Virgin O2 Media). Cross-channel lifecycle messaging + BrazeAI Decisioning Studio. Engagement layer only.
- **BlueConic** — VERIFIED publisher case studies (**Hearst "up to 38% lift in subscription acquisitions," Boston Globe Media**, et al.) but GTM visibly pivoted to retail/CPG; "acquires Blueshift" banner.
- **Zephr (Zuora)** — VERIFIED alive; customers **Forbes, The Irish Times, The Globe and Mail**. "AI paywalls, no developers required" — the opposite of NYT's stated need.
- **Poool** — VERIFIED live; European mid-market Piano challenger.
- **Mather Economics** — VERIFIED, **now operates Sophi** (Sophi Paywall / Dynamic Paywall Engines). Economists + pricing/churn/forecasting.
- **Marfeel** — VERIFIED: newsroom-first analytics (Compass), headline A/B (HUD), newsroom AI Copilot. Editorial-side.
- **Permutive** — VERIFIED: repositioned "Predictive data collaboration" — clean room + curation + first-party activation. Ad-side; complements, never displaces experimentation.
- **Optable** — VERIFIED: "The Agentic Audience Platform," News vertical. Permutive competitor, ad-side.
- **LiveRamp** — VERIFIED Publishers vertical. **NYT already uses LiveRamp** (ATS pid 14158) — incumbent to complement.

---

## 4. Optimizely's position in media/publishing — be factual

- **VERIFIED — full customer-story enumeration (98 stories via sitemap): zero news publishers.** Media-adjacent only: **Channel 4** (best reference — A/B testing across web/apps/smart TVs/consoles), **Discovery** (older; ad viewability), **National Rugby League**. **Do not cite a news-publisher case study — none exists.**
- **VERIFIED relevant products:** Experimentation ("agentic experimentation"), **Feature Management** (<1ms, 20+ SDKs, 99.9% — the direct Statsig competitor), Personalization, Data Platform/ODP, Content Management ("Agentic CMS"), CMP, Opal + ~101 published agents.
- **The read (INFERRED, stated plainly):** NYT will not replace ABRA — their staffing and published posture make that pitch a credibility-killer. The realistic wedge is **Feature Management + Experimentation displacing Statsig** — a slot where NYT already accepted a vendor, now mid-ownership churn (team at OpenAI — NYT's courtroom adversary; product at Amplitude mid-migration), and the Fastly-edge integration pattern is already proven at NYT. Secondary wedge: CMS/CMP for a peripheral property (Wirecutter, The Athletic, Games marketing).

---

## 5. NYT on buy-vs-build — quotable, on the record

1. **"Built, Not Bought"** (section heading), 2017 ABRA post — vendor solutions "would not allow" experiments deep enough.
2. CDP, 2020: *"The Times opted to build an in-house solution so we could control our data and audience targeting."*
3. Privacy, 2021: react vs. invest — *"The Times has chosen the latter."*
4. **The pragmatism tell:** the 2024 post twice says "whether you are building **or buying**…" — and Statsig is in production. NYT buys where it's not differentiating. **That's the door.**
5. **Named people:** Kathy Yang (Dir. Experimentation), Rohit Supekar (Lead ML Scientist, Algorithmic Targeting), Kendell Timmers (VP Ad & Growth Data), Cindy Taibi (CIO), Chris Wiggins (Chief Data Scientist).

---

## Open items / could not verify
1. Whether NYT still uses SocialFlow/Piano Amplifier today (confirmed only as of Feb 2022) — **highest-value open question**.
2. Statsig-the-vendor vs. an internal namesake (very high confidence, no NYT statement).
3. NYT's newsletter orchestration layer above SparkPost/SES.
4. Purpose of the Klaviyo (×3) and Segment TXT records.
5. Subscription billing vendor (entitlements look in-house).
6. NYT Workday jobs API 422'd — job postings not retrieved.
7. Adobe's own pages unreachable — §3 Adobe line unverified this session.
8. Piano/Cxense announcement date (2019 via Wikipedia only).
