<!-- INTERNAL - pursuit ammunition. Produced by a dedicated deep-research pass 2026-08-18; every claim carries source + date + confidence. Read the Corrections section (§7) before any customer conversation. Companion docs: README in this folder. -->

# QVC × Optimizely — Competitive & Technical Ammunition
**Compiled 2026-08-18.** Every claim carries a source and a date. Confidence is **HIGH / MEDIUM / LOW**. Adobe mechanics come from Adobe's own Experience League docs (page stamps May–Aug 2026 — they cannot be dismissed as stale or biased). Anything I could not verify is marked **UNVERIFIED** rather than smoothed over.

**Two facts that reframe the whole pursuit, both verified today:**

**(a) QVC.com already runs Adobe Target — on the legacy stack.** I parsed QVC's live Adobe Launch container (`assets.adobedtm.com/79d1461f1c71/ae670640d4df/launch-f971ccb45a97.min.js`, fetched 2026-08-18): Target v2 at.js with `clientCode:"qvc"`, `imsOrgId:"C2717067604046AD0A495CC2@AdobeOrg"`, `serverDomain:"target.qvc.com"` (first-party CNAME). Also present: Adobe Analytics/AppMeasurement, ECID, `demdex` (Audience Manager), AEM (`/etc.clientlibs/qvc-common/`, `jcr:`), Scene7 (`qvc.scene7.com`), **Constructor.io** (`cnstrc.com/js/cust/qurate-retail-group_7xf32q.js`), Granify, Qualtrics. **`alloy` / Platform Web SDK count = 0.** They are on at.js + AppMeasurement + ECID, *not* AEP Web SDK, with no client-side evidence of Real-Time CDP. **HIGH** (first-party observation, single snapshot, unauthenticated homepage, US IP).

**(b) HSN.com is a completely different stack.** No Adobe Launch, no Scene7, no Granify; Akamai mPulse RUM on legacy `hsni.com` infrastructure; Constructor.io present but on a **separate account** (`cnstrc.com/js/cust/hsn_1oWza0.js`, `indexKey 'key_G06XdhqNNY39pTcu'`); residual `unbxd_autoSuggest.css` indicates a prior Unbxd search deployment. **HIGH.** Cross-brand personalization is not achievable on their current architecture — Constructor is the only shared layer.

**Commercial context you must price in:** QVC Group filed **prepackaged Chapter 11 on 2026-04-16** (S.D. Tex.) and **emerged 2026-08-06 — twelve days ago** — cutting debt by **>$5B to ~$1.3B**, with a **$600M ABL** led by Strategic Value Partners and Oaktree, relisting on Nasdaq as **QVCG**. **David Rawlinson stepped down; Mike George returned as Interim CEO and Chair.** The new creditor-appointed board includes executives from Amazon, Netflix, Walmart, Mattel, Michaels, David's Bridal and McKinsey. Q1 2026 revenue was **$1,957M, −7% YoY**, with QVC US + HSN segment **−10.0% to $1.23B**. Sources: [PR Newswire 2026-08-06](https://www.prnewswire.com/news-releases/qvc-group-announces-successful-completion-of-financial-restructuring-process-and-leadership-transition-plan-302845644.html), [Q1 2026 10-Q](https://www.stocktitan.net/sec-filings/QVCGQ/10-q-qvc-group-inc-quarterly-earnings-report-031dc889f2d8.html). **HIGH.** → *Design a POC that is small, fast, and self-funding. A large platform commitment in the next two quarters is a hard ask against an interim CEO and a brand-new board.*

---

## §1 — Adobe Target: how it works, and where it strains for 24-hour offers

### 1.0 The three ML activity types, precisely

| Activity | Algorithm | Models built | Tier |
|---|---|---|---|
| **Auto-Allocate** | Multi-armed bandit; **confidence intervals based on the Bernstein Inequality** (not Thompson sampling); 80% intelligent / 20% random | none (no personalization) | Standard |
| **Auto-Target** | **Random Forest**, "one model is built per **experience**", plus MAB online exploration | per experience | **Premium** |
| **Automated Personalization (AP)** | **Random Forest**, "one model is built per **offer**"; Thompson Sampling used "to determine which experience is the best overall (non-personalized)" | per offer | **Premium** |

Sources: [Auto-Allocate](https://experienceleague.adobe.com/en/docs/target/using/activities/auto-allocate/automated-traffic-allocation) (upd. 2026-05-12), [Auto-Target](https://experienceleague.adobe.com/en/docs/target/using/activities/auto-target/auto-target-to-optimize) (upd. 2026-03-26), [Random Forest](https://experienceleague.adobe.com/en/docs/target/using/activities/automated-personalization/algo-random-forest) (upd. 2026-05-12), [AP](https://experienceleague.adobe.com/en/docs/target/using/activities/automated-personalization/automated-personalization) (upd. 2026-05-12). **HIGH.**

Feature space fed to the models (Adobe's list): environment (OS, browser, **time of day/week**), geography (city/country/state/DMA/lat-long/zip/ISP/carrier), mobile device, Target reporting segments, session behavior (page views, visit duration, conversion history, recency), and custom attributes (mbox params, profile attributes/scripts, Customer Attributes, Experience Cloud shared audiences, RTCDP audiences via Destinations). [ap-data](https://experienceleague.adobe.com/en/docs/target/using/activities/automated-personalization/ap-data) (upd. 2026-05-12). **HIGH.**

### 1.1 Pain: the learning floor is expressed *per day, per experience* — a 24-hour offer gets one shot at it
**Mechanism.** Auto-Target requires **"1,000 visits and at least 50 conversions per day per experience"**, and activity-wide **"at least 7,000 visits and 350 conversions"** (conversion goal) or **"at least 1,000 conversions per experience"** (RPV goal). Auto-Allocate's bandit **"starts working after all experiences in the activity have a minimum of 1,000 visitors and 50 conversions"** — until then traffic splits equally. Models are **"rebuilt every 24 hours."** Adobe adds: **"it usually takes more than the minimum number of conversions before each model is valid"** (models are gated on AUC validation).
**Evidence.** Auto-Target page (2026-03-26); Auto-Allocate page (2026-05-12); Random Forest page (2026-05-12). **HIGH.**
**So what for QVC.** A TSV lives ~24 hours. The model rebuild cadence *is* the offer's entire lifetime. On an RPV goal — the metric that actually matters to QVC — the floor is 1,000 conversions per experience. Adobe's own AP FAQ concedes the workaround: *"If your success metric is set to RPV, can you change to conversion? Conversion activities tend to require less traffic to build models."* ([AP FAQ](https://experienceleague.adobe.com/en/docs/target/using/activities/automated-personalization/automated-personalization-faq), upd. 2026-05-12.) **HIGH.**

### 1.2 Pain: personalization does not begin until ≥2 models exist
**Mechanism.** *"There must be at least two models built within your activity for personalization to begin."* Before that, AP/Auto-Target is not personalizing.
**Evidence.** AP FAQ (2026-05-12). **HIGH.**
**So what.** For a same-day offer, the "personalized" experience is, for most of the window, un-personalized allocation.

### 1.3 Pain: explainability requires the activity to be alive for 15 days
**Mechanism.** Personalization Insights (the **Automated Segments** and **Important Attributes** reports — Adobe's answer to "how does the algorithm work?") requires the activity to have **"Live status and have been activated and receiving traffic for at least 15 days"**, be **Target Premium**, use a **conversion-based** goal, run in the **default environment only**, and it **excludes control and winner-model traffic**. Models are trained on **the last 45 days** of behavior; training data is retained 90 days.
**Evidence.** [Personalization Insights reports](https://experienceleague.adobe.com/en/docs/target/using/reports/insights/personalization-insights-reports) (upd. 2026-05-12). **HIGH.**
**So what — this is the single sharpest fact in the deck.** For an offer that lives 24 hours to 5 days, **the explainability report can never be generated.** QVC's team is black-box-sensitive; Adobe's own transparency surface is structurally unavailable at their offer cadence. And it is RPV-incompatible: *"Not available for revenue optimization goals."*

### 1.4 Pain: Recommendations cannot see a new item inside its own lifetime
**Mechanism.** Adobe documents the full clock:
- **"Algorithm runs are scheduled every 12 hours for 1-2 day algorithms and every 24 hours for 7+ day algorithms."** Runs "can take up to 24 hours to be completed."
- New item via **feed**: ingest **2–8 hours**, then the next algorithm run → **"Recommendations are updated within 2-32 hours total."**
- New item via **mbox/API**: "Recommendations are updated after algorithm run" (12–24h).
- **Feed scheduling maxes out at Daily** (Daily / Weekly / Every 2 Weeks / Never).
- Lookback→refresh table: 6-hour lookback → every **3–6 h**; 1-day → **12–24 h**; 1-week+ → **24–48 h**.
- First use of an Analytics report suite with a given lookback: **"can take from two to seven days to fully download the behavioral data."**
- Entities/attributes **expire after 61 days**.
- Cold-start fallback is **backup recommendations** = "top 500 most-viewed products across the entire site," one-week window; changing that behavior "requires contacting your account manager."

**Evidence.** [Recommendations FAQ](https://experienceleague.adobe.com/en/docs/target/using/recommendations/recommendations-faq/recommendations-faq), [criteria](https://experienceleague.adobe.com/en/docs/target/using/recommendations/criteria/create-new-algorithm), [feeds](https://experienceleague.adobe.com/en/docs/target/using/recommendations/entities/feeds) — all upd. 2026-05-12. **HIGH.**
**So what.** A TSV that goes live at midnight is, in the best documented case, recommendable by behavioral criteria **3–6 hours in** and more typically **12–32 hours in** — i.e. after it is gone. Adobe's only in-window answer is the **content-similarity** criterion (TF-IDF + cosine over catalog metadata), which Adobe explicitly frames as the cold-start path: it can "drive recommendations in so-called 'cold-start' scenarios, where no behavioral data has been collected." ([recommendations-algorithms](https://experienceleague.adobe.com/en/docs/target/using/recommendations/criteria/recommendations-algorithms), 2026-05-12.) **HIGH.** *That is metadata matching, not learning — and it depends entirely on QVC's catalog attribute quality.*

### 1.5 Pain: Automated Personalization cannot use Adobe Analytics as a reporting source — at all
**Mechanism.** A4T support table lists AP as **"No."** Corroborated: *"Automated Personalization activities are not supported when you choose Adobe Analytics as the reporting source."* Auto-Allocate and Auto-Target **are** A4T-supported. Under CJA as reporting source: Auto-Allocate yes, **Auto-Target no**, AP no (**MEDIUM-HIGH**).
**Evidence.** [A4T](https://experienceleague.adobe.com/en/docs/target/using/integrate/a4t/a4t) (2026-05-12); [reporting](https://experienceleague.adobe.com/en/docs/target/using/administer/reporting/reporting). **HIGH.**
**So what.** Adobe's flagship personalization activity is measurable only in Target's own UI — the exact dependency QVC's data science team is trying to escape.

### 1.6 Pain: the reporting latency stack
| Measure | Documented value |
|---|---|
| Target-native reports | "latency of four minutes" |
| **A4T, initial** | **"It generally takes between 24 to 72 hours for activity data to appear in the reports"** (rows show "Unspecified" until classification completes) |
| A4T breakdown by experience | "up to 24 hours after the activity is initially saved" |
| A4T, ongoing | "approximately an hour after it is collected" |
| **Cost of A4T to *all* Analytics data** | "extra 5-10 minutes of latency in Analytics"; current data / finalized / **data feeds "delayed an extra 5-7 minutes"** |
| **Auto-Target + A4T** | Analytics conversion data "delayed by an extra **6 to 24 hours**"; Target and Analytics numbers mirror after **~5 days**; "Sessions end after six hours… Conversions occurring after six hours are not counted" |
| Classification updates | "24-72 hours" |

Sources: [a4t/reporting](https://experienceleague.adobe.com/en/docs/target/using/integrate/a4t/a4t), a4t-faq-viewing-reports, a4t-at-aa, before-implement — all upd. 2026-05-12. **HIGH.**
**So what.** A 24-hour offer can be **over before its first A4T report exists**, and the same-day merchandising decision has no data behind it.

### 1.7 Pain: Adobe documents its own reporting discrepancies
**Mechanism.** Analytics Workspace *"displays the raw metrics, which can appear inflated due to persistence of the Target dimension"* (Same-Touch attribution required to reconcile); the Target variable has a **default 90-day expiration**, so metrics keep accruing after an activity is deactivated; UV counts differ when the reporting window is shorter than the test duration. Adobe Consulting Services publishes an article titled *"When Adobe Target Reporting Does Not Match Expectations."*
**Evidence.** [a4t-faq-viewing-reports](https://experienceleague.adobe.com/en/docs/target/using/integrate/a4t/a4t-faq/a4t-faq-viewing-reports) (2026-05-12) — **HIGH**; the consulting article's existence — **HIGH** (it is on Adobe's own community). Live unresolved 2026 community threads (**anecdotal, MEDIUM**): [A4T tracking-server mismatch under-reporting UVs](https://experienceleaguecommunities.adobe.com/adobe-target-14/a4t-tracking-server-mismatch-causing-underreported-unique-visitors-251371) (Jun 25–Jul 15 2026, unresolved); [a sample-ratio-mismatch thread](https://experienceleaguecommunities.adobe.com/adobe-target-14/adobe-target-one-variant-with-significantly-less-traffic-than-the-other-explain-sample-mismatch-251238) where a participant writes *"that's a structural problem… you can't fully trust its numbers"* (2026-06-22, unresolved at 2026-08-03).
**So what.** When you ask "what were the hurdles," reporting trust is the likeliest answer and Adobe has documented the mechanism itself.

### 1.8 Pain: the exports are thin, and the good one is a separate purchase
- **Target UI CSV**: *"includes only raw data and does not include calculated metrics such as revenue per visitor, lift, or confidence"*; *"Audiences applied in the Target reporting UI do not carry over to the download report"*; order data retained **4 weeks** (default env) / **2 weeks** (non-default). **HIGH.**
- **Reporting API**: aggregate per activity per interval (`/{tenant}/target/activities/ab/{id}/report/performance?reportInterval=…`); Adobe's own KB advises looping a request per day. Rate limit **50 calls/min** → 503. **HIGH.**
- **Response tokens**: real per-decision metadata client-side — activity/experience/offer IDs and names, `profile.tntId`, `marketingCloudVisitorId`, geo, `categoryAffinity`, and (AP/Auto-Target only) `experience.trafficAllocationId` + `experience.trafficAllocationType` ("control"/"targeted"). Adobe explicitly blesses forwarding: *"extra response data to share with internal or 3rd-party tools."* **But no token exposes a model score, propensity, predicted lift, or reason.** ([response-tokens](https://experienceleague.adobe.com/en/docs/target/using/administer/response-tokens), 2026-05-12.) **HIGH** on the token list; **MEDIUM-HIGH** on the negative — frame it as *"Adobe documents no such token."*
- **Analytics Data Feeds** (the real per-impression path): hourly or daily batches to S3/GCP/Azure/SFTP; Target columns `tnt`/`post_tnt` formatted `TargetCampaignID:TargetRecipeID:TargetType|Event/Action` (Auto-Allocate/Auto-Target adds `algorithmId`); identity via `visid_high/low`, `mcvisid`, `hit_time_gmt`. Hourly files "typically written out within 15-30 min after the hour, but there is no set time period," occasionally "up to 12 hours or more." Requires an **Adobe Analytics licence + A4T**, carries **no model score**, and **excludes AP entirely**. ([data-feed-overview](https://experienceleague.adobe.com/en/docs/analytics/export/analytics-data-feed/data-feed-overview) 2026-05-26; datafeeds-reference 2026-05-19.) **HIGH.**
- **Streaming to a QVC endpoint**: only via **Event Forwarding**, which *"is a paid feature that is included as part of the Adobe Real-Time Customer Data Platform Connections, Prime, or Ultimate offerings"* (30-second per-event rule timeout). Datastreams otherwise forward to Adobe services only. ([Event Forwarding overview](https://experienceleague.adobe.com/en/docs/experience-platform/tags/event-forwarding/overview), 2026-05-23.) **HIGH.**

**Precise, fair statement for the room:** *Adobe documents no way to get per-decision rows out of Target itself. The documented routes are (a) Analytics Data Feeds via A4T — per-impression, score-less, AP-excluded, Analytics-licensed; or (b) customer-built instrumentation logging response tokens / Delivery API responses. Near-real-time streaming to your own endpoint means buying RTCDP and building it.* **HIGH on "undocumented"** — not "impossible" (Engineering Services side arrangements exist for classification lookups).

### 1.9 Pain: operational overhead and "real-time" caveats
- **Profile scripts** run *"with every single mbox call"*; 2,000 JS instructions per script, *"fewer than 5,000 instructions in total"*, ≤1,300 chars, ≤50 loop iterations, ≤300 active (2,000/account); **"The order of profile script execution is not guaranteed"**; auto-disabled silently if slow/invalid; *"If profile scripts do not execute correctly, mbox requests take longer to execute, which can impact traffic and conversion."* **HIGH.**
- **Visitor profile lifetime: 14 days of inactivity by default**, extendable to a maximum of 90 days only via Client Care, not retroactive. ([visitor-profile-lifetime](https://experienceleague.adobe.com/en/docs/target/using/audiences/visitor-profiles/visitor-profile-lifetime), 2026-05-12.) **HIGH.**
- **AAM→Target profile refresh is billable**, and Adobe's documented mitigation is to downgrade freshness from Real-Time to **Once-Per-Session** (KB ka-20535 / ka-20675, both updated 2026-08-18). **HIGH.**
- **Customer Attributes: 5 on Target Standard vs 200 on Premium**; *"up to 0.1% of large production batches might not be onboarded."* **HIGH.**
- **Flicker**: Adobe's own default pre-hiding is `body { opacity: 0 !important }` for up to **3,000 ms**. **HIGH.**
- **Activity QA has five documented failure modes**, including *"Activity QA mode is not sticky if you use Safari or another browser that blocks 3rd-party cookies."* **HIGH.**
- **Limits**: offers **1024 KB**; 2,000 experiences per A/B/XT/MVT/Auto-Target and **30,000 per AP** (best <10,000); **50 audiences per mbox**; 200 success metrics/activity; 100 concurrent delivery requests/session; catalog <1M entities recommended (10M max/environment). ([target-limits](https://experienceleague.adobe.com/en/docs/target/using/troubleshoot/target-limits), 2026-05-12.) **HIGH.**

### 1.10 What Adobe does NOT document (do not assert the opposite)
Effect of adding/removing an offer or experience mid-flight on the models — **not addressed** on the AP page, AP FAQ, Auto-Target page, or edit-activity page. The AP FAQ only notes visitor-side behavior (*"visitors will see the new content along with the previously shown offers"*) and recommends **reporting groups** when *"You plan on replacing or adding new offers while the activity is running."* It also warns: *"Adobe does not recommend that you change the goal metric midway through an activity."* **This is a question to ask Adobe in writing, not a claim to make.** **HIGH** that it is undocumented.

---

## §2 — The likely hurdles QVC hit, ranked

Each: hypothesis → evidence basis → how a POC proves we clear it.

**H1 — Learning time exceeds offer life. (Highest confidence.)**
*Evidence:* §1.1–1.4. Per-day/per-experience thresholds, 24-hour model rebuilds, 12–32h recommendation refresh, daily-max feeds. QVC's core mechanic is a **registered-trademark 24-hour offer** (Today's Special Value®, live on `qvc.com/collections/deals-todays-special-value.html`, surfaced in the site `<title>` and primary nav — **HIGH**), on a network broadcasting live **20/7** with the 3am–7am ET block looping the TSV feature (**MEDIUM-HIGH**, Wikipedia).
*POC proof:* Run a decisioning surface where the arm set is **created and live within minutes** of an offer's creation, first decision is non-random from impression #1 (deterministic cold-start prior), and allocation adapts intra-session — then show a same-day readout while the offer is still live. Success criterion QVC can score: **time from "offer exists" to "personalized, non-random decision"** measured in minutes, not hours.

**H2 — Reporting trust broke.**
*Evidence:* §1.6–1.7. 24–72h to first A4T data; Target-vs-Analytics discrepancies documented by Adobe; a consulting article devoted to explaining them; unresolved 2026 community threads including an SRM complaint.
*POC proof:* Ship **row-level assignment logs** to their warehouse and let their team compute the split, run their own SRM check, and reproduce our number. Do not ask them to trust a UI. (Optimizely's decision export carries `uuid` for dedupe and `is_holdback` per row — §4.)

**H3 — They cannot get decisioning data into their warehouse without buying more Adobe.**
*Evidence:* §1.8. No per-decision API; CSV without lift/confidence/RPV; per-impression only via Analytics Data Feeds + A4T (score-less, AP-excluded); customer-endpoint streaming gated behind RTCDP Connections/Prime/Ultimate. **And QVC shows no client-side evidence of RTCDP today** (§(a)) — so that path is a net-new purchase for them.
*POC proof:* Land `decisions` and `conversions` tables in their Snowflake/BigQuery/Databricks with a documented schema, and — separately — demonstrate a real-time tee of the decision stream via SDK notification listeners into their own pipeline. Be honest about which is next-day and which is live (§4).

**H4 — Black-box refusal.**
*Evidence:* §1.3 (Insights needs 15 days live, Premium, conversion-goal only, excludes control traffic) and §1.8 (no score in response tokens; the Models API only blocklists features from the model — it does not expose them).
*POC proof:* Emit a **per-decision explain record** — which signals fired, their weights, the resulting score, and the chosen arm — visible in the same session, and exportable. This is the difference between "trust the forest" and "read the reason."

**H5 — Operational drag on a fast merchandising calendar.**
*Evidence:* §1.9. Profile scripts on every mbox call with unguaranteed execution order; 3,000 ms pre-hiding; QA failure modes incl. Safari; 50 audiences per mbox; 50 API calls/min; PeerSpot reviewer (Brillio) reporting *"system slows down, and we need to move certain campaigns into the archive folder"* (**anecdotal, LOW-MEDIUM**, small n).
*POC proof:* Time a real merchandiser doing setup→QA→launch for one offer. Target the whole loop in minutes with no engineering ticket.

**H6 — "Real-time" was not real-time.**
*Evidence:* §1.9. 14-day default profile; AAM refresh **billable** with the documented mitigation being once-per-session; 5 Customer Attributes on Standard; AEP→Target has **no published latency SLA** and *"identity reconciliation may take several minutes."*
*POC proof:* Show in-session state changing the next decision on the next interaction, with the latency on screen.

**H7 — Two brands, two stacks.**
*Evidence:* §(b). QVC.com has Adobe Target; HSN.com has no Adobe Launch at all. Only Constructor spans both.
*POC proof:* Run the same decisioning contract against both properties from one control plane. This is a capability they demonstrably do not have today — and it is a strong reason for a *platform* conversation rather than a tool swap.

**H8 — Item recs were the wrong tool for the job.** (See §3.) *POC proof:* the rubric conversation itself — reframe from "recommendations" to "decisioning under expiry."

---

## §3 — Content/offer decisioning vs product recommendations

### 3.1 The structural framing: the analysts split it into two markets
- **Forrester runs two separate Waves.** *Experience Optimization Solutions, Q4 2024* covers experimentation plus **"next-best product, offer, or action"** and "next-best experience," 11 vendors ([Forrester blog, 2025-01-10](https://www.forrester.com/blogs/key-insights-from-the-forrester-experience-optimization-solutions-wave-q4-2024/)). *Commerce Search & Product Discovery* covers "presenting the right products to a shopper by personalizing the shopper's searching, browsing, and product discovery processes" ([Forrester blog, 2023-03-17](https://www.forrester.com/blogs/announcing-a-new-forrester-wave-commerce-search-product-discovery/)). Forrester's own position: [**"There Is No Single Personalization Technology Category"**](https://www.forrester.com/blogs/there-is-no-single-personalization-technology-category/) (Jessica Liu, 2023-06-06), decomposing personalization into recognition, insights, decisioning, delivery, optimization. **HIGH.**
- **Gartner collapses what Forrester splits.** *Magic Quadrant for Personalization Engines*, published **2026-02-03**, 12 vendors (Gillespie, Daigler, Ro, Cosner). Its market definition is object-agnostic — "create and deliver an optimum experience" — never distinguishing creative from SKU. **HIGH** on date/analysts/vendor count (corroborated independently by Optimizely and Insider One); **MEDIUM** on the verbatim definition (single-source quotation of a paywalled report).

**The seam:** the category definition hides the hardest engineering question — *how long does the thing you are choosing between survive?*

### 3.2 How the vendors actually draw the line
- **Adobe runs three decisioning engines and documents running them in parallel**: **Target** (on-page visual optimization, default `__view__` scope), **Offer Decisioning** (API-driven offers on AEP profiles, custom scopes), **AJO Decisioning** ("dynamic offer selection based on business rules, constraints, and AI-powered ranking," custom scopes). ([Adobe perspective: running multi-engine personalization with Target, AJO-D and Offer Decisioning](https://experienceleague.adobe.com/en/perspectives/running-multi-engine-personalization-with-target-ajo-d-and-offer-decisioning).) **HIGH.**
  - **Adobe's offer-side ML, verbatim:** the auto-optimization model is *"a reinforcement learning model which maximizes offer click-through rate (CTR) by exploring all offers (or content), then ranking items based on predicted CTR"* — Thompson sampling with Beta priors, **10% exploration / 90% exploitation**. Hard threshold: *"At least 2 offers in the dataset must have at least **100 display events and 5 click events within the last 14 days**."* Below threshold, offers *"are treated as new and only served through exploration."* Before first training, *"offers … will be served at random."* ([auto-optimization model](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/decisioning/offer-decisioning/rankings/ai-models/auto-optimization-model).) **HIGH.**
  - 🎯 **The tell:** Adobe's own documented example of a ranking formula is **"Boost offers expiring within 24 hours."** Adobe ships *deterministic, merchandiser-authored expiry logic* on the offer side — because the ML side cannot learn fast enough. ([ranking formulas](https://experienceleague.adobe.com/en/docs/journey-optimizer/using/decisioning/experience-decisioning/experience-decisioning-rankings/ranking-formulas).) **HIGH.**
- **Mastercard Dynamic Yield** — cleanest single sentence of the three-object split: DY lets teams *"algorithmically match **content, products, and offers** to each individual customer."* ([mastercard.com](https://www.mastercard.com/us/en/business/consumer-acquisition-and-engagement/personalization/dynamic-yield.html).) **HIGH.**
- **Bloomreach** — splits **Discovery** (search, product recs, categories) from **Engagement** (CDP, journeys, its own product recs). Engagement's rec templates split into **"Ready to use templates"** — *"Based on fixed rules, ready to serve results immediately"* — and **"Loomi templates"**, which *"can't be used immediately as they need data and learning time to generate recommendations."* A **"New items"** template exists that *"requires a datetime column."* ([documentation.bloomreach.com](https://documentation.bloomreach.com/engagement/docs/product-recommendations).) **HIGH** — *a vendor conceding that rules beat ML at t=0.*
- **Coveo** is the one vendor that names both sides as separate ML models: **Content Recommendation (CR)** *and* **Product Recommendations (PR)**, alongside ART, QS, DNE. ([docs.coveo.com](https://docs.coveo.com/en/2778/).) **MEDIUM.**
- **Algolia Recommend** — models train on *"data corresponding to the past 30 days."* ([algolia.com](https://www.algolia.com/products/recommendations/).) **HIGH.** *A 30-day window is structurally incompatible with a 24-hour item.*
- **Constructor** — *"Product discovery for commerce is all we do."* No banner/content/site personalization anywhere on their site. **And QVC's logo is in Constructor's customer carousel** (`constructor.com/hubfs/qvc-black.svg`) — consistent with the Constructor bundles found on both qvc.com and hsn.com. **HIGH.**
- **Braze Intelligent Selection** — a bandit over **message variants**, analyzed "twice a day," requiring a **"Recurring schedule"**: *single-send campaigns are unsupported*. ([braze.com/docs](https://www.braze.com/docs/user_guide/intelligence/intelligent_selection).) **HIGH.** *A one-off flash drop cannot use it at all.*
- **Salesforce — UNVERIFIED.** Six URL attempts returned 403/404/JS-shell. Do not assert Marketing Cloud Personalization / Einstein / Agentforce naming, SKUs, or algorithms.

### 3.3 The literature: why item recs break on short-lived items
- **Li, Chu, Langford & Schapire (2010), "A Contextual-Bandit Approach to Personalized News Article Recommendation"** — [arXiv:1003.0146](https://arxiv.org/abs/1003.0146). Verbatim: *"dynamically changing pools of content, **rendering traditional collaborative filtering methods inapplicable**."* LinUCB delivered **+12.5% clicks** over a context-free bandit on 33M+ events, *with advantages increasing as data becomes scarcer.* **HIGH.** *This is the intellectual foundation: small, fast-turning decision space → contextual bandit, not CF.*
- **Swezey & Chung (2021), short-lived golf packages** — [arXiv:2103.07779](https://arxiv.org/pdf/2103.07779): *"the short life of the items, which puts the system in a state of a **permanent cold start**"*, compounded by *"the uninformative nature of the package attributes."* **HIGH.** *Note the second clause: content-based rescue only works if metadata is discriminative.*
- **Pembek et al. (2025)** — [arXiv:2507.19473](https://arxiv.org/abs/2507.19473): items with few/no interactions *"cannot be effectively used by the model due to the absence of a trained embedding."* **HIGH.**
- **Peng et al. (2026-07-23)** — [arXiv:2607.21101](https://arxiv.org/html/2607.21101v1): semantic-ID generative recommenders *"struggle with unseen atomic tokens and unsupported SID paths"*; *"SID generation is compositional but not fully open-ended."* **HIGH.** *One month old — use this to close the "just use LLM embeddings / generative recs" objection.*
- **Luo et al. (KDD '25)** — [arXiv:2411.11225](https://arxiv.org/abs/2411.11225): offline cold-start schemes are *"infeasible for online recommendation on streaming data pipelines."* **HIGH.**

### 3.4 The recommended decision rubric

| # | Dimension | → Content / offer decisioning | → Product recommendations | Anchor |
|---|---|---|---|---|
| 1 | Decision space size | ~2–20 curated arms | 10³–10⁶ SKUs | Adobe needs ~100 impressions + 5 clicks **per arm** |
| 2 | **Item lifetime** | **Hours to days** | Weeks to years | "permanent cold start" (2103.07779); Algolia 30-day window |
| 3 | Data volume per item | Sparse by design; bandits built for it | Needs dense co-occurrence | LinUCB "advantages increasing as data becomes scarcer" |
| 4 | Time-to-first-useful-decision | Immediate (rules/priority/formula) | Days–weeks | Bloomreach: rules "immediately" vs Loomi "need … learning time" |
| 5 | Merchandiser control | High — collections, priority, expiry boosts | Low, algorithmic | Adobe "boost offers expiring within 24 hours" |
| 6 | Object type | Creative, layout, hero, offer, next-best-action | SKU | DY: "content, products, and offers"; Coveo's CR vs PR |
| 7 | Measurement granularity | Clean per-variant lift, A/B-legible | Aggregate ranking metrics | — |
| 8 | Channel breadth | Cross-channel by design (API/JSON) | Mostly on-site surfaces | Adobe OD/AJO-D custom scopes vs Target `__view__` |
| 9 | Metadata-quality dependency | Low — arms are human-curated | **High** — cold-start rescue fails on weak attributes | 2103.07779 "uninformative … attributes" |
| 10 | Campaign cadence | Handles one-off drops | Assumes continuous accrual | Braze: single-send unsupported |

**The line to use with QVC:** *You do not have a recommendations problem. You have a decisioning-under-expiry problem.* Rows 2, 4 and 10 are where QVC sits, and all three point the same way. Note also that **Constructor already owns product discovery on both properties** — arguing item-recs is arguing on their incumbent's turf; arguing offer/content decisioning is the open lane.

---

## §4 — Warehouse & measurement

### 4.1 What Optimizely can actually put in their warehouse (public docs, verified today)

**Experimentation Events Export** — [docs](https://docs.developers.optimizely.com/experimentation-data/docs/enriched-events-export) (page dated **2026-08-04**):
- *"Daily Parquet-formatted files with **one row per decision or conversion event**."*
- **"Each daily export is available the next day by 13:00 UTC."**
- Retention one year. GCS (all customers; EU is GCS-only). ⚠️ **"Starting November 30, 2026, Optimizely will stop delivering … data through Amazon S3."** GCS holds data from **June 2026 onward**. **HIGH.**

**Decision schema** ([data spec](https://docs.developers.optimizely.com/experimentation-data/docs/enriched-events-data-specification), dated **2026-08-06**) — the two fields a DS team cares about are both first-class:
`uuid` (*"Used to deduplicate events"*), `timestamp`, `process_timestamp`, `visitor_id`, `experiment_id`, `variation_id`, **`is_holdback` (boolean)**, `attributes[]`, `campaign_id`, `account_id`. Conversions: `uuid`, `timestamp`, `visitor_id`, `revenue` (**cents**), `value`, `entity_id`, `event_name`, `event_type`, `properties{}`, `tags{}`. **HIGH.**
⚠️ **Disclose:** `session_id` and the conversion-side `experiments[]` array are **no longer populated** (since 2023-10-09). QVC joins decisions→conversions themselves on `visitor_id` + time. Do not imply conversions arrive pre-attributed.

**Zero-ETL shares:**
- **Snowflake Secure Data Sharing** — `decisions` and `conversions` tables; *"Data from the previous day is typically available the next day"*; ⚠️ **"The integration accepts up to 1 billion events per month"**; six AWS regions. ([doc](https://docs.developers.optimizely.com/experimentation-data/docs/snowflake-integration), dated 2026-07-23.) **HIGH.** *Size this against QVC's traffic before the technical meeting.*
- **BigQuery Analytics Hub** — authorized view, region-locked, `experiment_id_hash` for partitioning. **HIGH.** ⚠️ The BigQuery overview page says data is accessible *"in real time"*, which contradicts the daily-load model everywhere else. **Do not repeat the "real time" claim** — say next-day and let it over-deliver. **LOW** on "real time."
- **Fivetran** — six tables; sync frequency undocumented; **not supported for EU-hosted data**. **MEDIUM.**

**Warehouse-Native Experimentation Analytics** — *the direct answer to their ask.* [Get started](https://support.optimizely.com/hc/en-us/articles/34425355043469-Get-started-with-Warehouse-Native-Experimentation-Analytics) (upd. **2026-03-18**):
- **Snowflake, BigQuery, Databricks, Amazon Redshift.** *"Your data warehouse remains the single source of truth."* Materialized intermediate tables are created in the customer's warehouse. **HIGH.**
- **Decision dataset** config: required = actor dataset, experiment ID, variation, timestamp; optional = **Is holdback**. **HIGH.**
- **Health checks including SRM** ("Check SRM status"), plus primary-key uniqueness, actor-identifier alignment, single-variation-per-actor. **HIGH** — lead with this; it is the credibility artifact.
- **CUPED**, regression-based, default **two-week** pre-experiment lookback. **HIGH.**
- ⚠️ Provisioning is **not self-serve** — prerequisite is emailing support@optimizely.com. **HIGH.**

**Real-time tee** — SDK **notification listeners** (DECISION, TRACK, LOG_EVENT) plus a **custom event dispatcher**, which Optimizely recommends overriding "based on the specifics of your environment." Optimizely's own doc names the tradeoff: *"Historical data cannot be used, and customers are responsible for managing retries and batching."* ([notification listeners](https://docs.developers.optimizely.com/feature-experimentation/docs/notification-listeners); [Send decision events to Snowflake](https://support.optimizely.com/hc/en-us/articles/39254129268749-Send-experimentation-decision-events-to-Snowflake), 2025-12-09.) **HIGH.**

### 4.2 The competitive comparison

| Vendor | Per-decision rows to customer warehouse | Latency | Confidence |
|---|---|---|---|
| **Optimizely** | Yes — documented schema, `uuid` dedupe, `is_holdback`; plus Snowflake/BigQuery share; plus warehouse-native analysis | **Next day by 13:00 UTC** (batch); real-time only via self-built listener tee | HIGH |
| **Adobe** | Not from Target. Per-impression via Analytics Data Feeds + A4T (no scores, AP excluded, Analytics licence); response tokens = customer-built pipeline; customer-endpoint streaming requires **RTCDP** | A4T 24–72h initial / ~1h ongoing; feeds hourly (15–30 min post-hour, occasionally 12h+) | HIGH |
| **Dynamic Yield** | **No public documentation found.** `dy.dev/docs` covers inbound product feeds and event tracking; `dy.dev/reference` lists only "Experience APIs." Multiple export-path URLs 404/403 | — | **Absence of public docs, not absence of capability** |
| **Eppo (now Eppo by Datadog)** | *"Eppo processes experiment data within your data warehouse environment… you have full visibility into the SQL logic"* | in-warehouse | HIGH |
| **Statsig** | Warehouse-native; *"your warehouse holds all queries, intermediate datasets, and final results."* Enterprise tier only | in-warehouse | HIGH |
| **Braze Currents** | Avro per-message stream to S3/Snowflake/Redshift/BigQuery/Azure | **Flush interval not documented** | HIGH / latency UNVERIFIED |

**On Dynamic Yield, say this and only this:** *"We could not find public documentation for their per-decision export — ask them to show you the doc."* Never *"DY cannot do this."* The safe, winning move is to make **public, self-serviceable documentation** an evaluation criterion.

### 4.3 What their data science team will actually demand — and where we must concede
1. **Row-level assignment logs so they can run their own SRM.** Eppo's published production practice is the bar: Pearson chi-squared at **α = 0.001** on active variations, plus dimensional-imbalance checks with **Bonferroni correction** — with a documented rationale (continuous monitoring inflates effective alpha; false-positive investigations erode trust). ([docs.geteppo.com/statistics/sample-ratio-mismatch](https://docs.geteppo.com/statistics/sample-ratio-mismatch).) **HIGH.**
2. **Deterministic dedupe.** Optimizely's `uuid` and Eppo's documented "deduplicates assignments" pipeline step confirm this is table stakes. **HIGH.**
3. **Variance reduction.** **CUPED** is verified from the source PDF: *Deng, Xu, Kohavi & Walker, "Improving the Sensitivity of Online Controlled Experiments by Utilizing Pre-Experiment Data," WSDM 2013* — abstract: *"we can reduce variance by about 50%, effectively achieving the same statistical power with only half of the users, or half the duration."* ([PDF](https://exp-platform.com/Documents/2013-02-CUPED-ImprovingSensitivityOfControlledExperiments.pdf).) **HIGH — safe to quote verbatim.** *The argument that lands: CUPED requires row-level outcomes joined to pre-period covariates from QVC's own history. That join is only possible in their warehouse. Warehouse-native is a requirement, not a preference.*
   ⚠️ **Concede cleanly:** Optimizely's CUPED is **numeric-metrics-only**, with no user-defined covariates. Eppo's **CUPED++** uses ridge regression over other metrics' history (default 30-day lookback) *and* assignment properties as covariates, delivering variance reduction **even for new users with no pre-period data**. If QVC has evaluated Eppo, expect this exact question.
4. **A holdout, because personalization has no natural control.** Optimizely supports this structurally in both paths (`is_holdback` on every exported decision row; an optional "Is holdback" field in the warehouse-native decision dataset). Adobe's parallel is `experience.trafficAllocationType` ("control"/"targeted") for AP/Auto-Target. **HIGH.**
5. **Bandit measurement caveats — they will raise these.** Chris Stucchio, *"Don't use Bandit Algorithms — they probably won't work for you"* (2015-01-27, [link](https://www.chrisstucchio.com/blog/2015/dont_use_bandits.html)) documents three failure modes: **non-stationarity** (the Saturday/Tuesday problem — day-of-week effects drive premature convergence with slow recovery), **delayed feedback**, and **correlated samples** (per-visit rather than per-user measurement breaks IID). **HIGH.** Adobe's Auto-Allocate page independently concedes the first: *"time-correlated … conversion rates can skew allocation amounts"* (Friday vs Monday messaging). **HIGH.** *For QVC — whose traffic is driven by a live broadcast schedule — non-stationarity is not a corner case, it is the baseline condition.*
6. **Propensity logging.** To do true off-policy/counterfactual evaluation you must log the **score at decision time** — it is unrecoverable afterwards. Neither Optimizely's decision export nor Adobe's response tokens document a propensity field. **State this as an engineering design point for the POC (custom fields on the listener tee), not as a shipped feature.** **HIGH** on the docs gap.
7. ⚠️ **Do not cite by name without verification:** Kohavi/Tang/Xu and Twyman's law; the Fabijan et al. SRM paper title (the **DOI 10.1145/3292500.3330722, KDD 2019** is confirmed; the title string is **MEDIUM**); Johari et al. on always-valid inference; Hadad/Athey/Imbens on adaptive-experiment CIs. All real, none verified this session.

---

## §5 — Optimizely honesty ledger: available today vs emerging (public docs only)

| Capability | Status | Evidence |
|---|---|---|
| Web Experimentation, Feature Experimentation | **GA** | Continuous 2026 release notes (FX upd. 2026-08-08) — HIGH |
| Web Personalization campaigns | **GA** — but core user docs last touched **June 2024** | HIGH |
| **Multi-Armed Bandit** | **GA** | [Maximize lift with MAB](https://support.optimizely.com/hc/en-us/articles/4410289035405-Maximize-lift-with-multi-armed-bandit-optimizations) — HIGH |
| **Contextual MAB** | **GA, no beta label** | [Contextual bandits](https://support.optimizely.com/hc/en-us/articles/29328842964109-Contextual-bandits) (upd. 2026-07-15) + [FX CMAB](https://docs.developers.optimizely.com/feature-experimentation/docs/run-contextual-multi-armed-bandits) (2026-07-23); per-SDK cache docs for ~10 SDKs; production CMAB shipped in Agent 4.3.0 (Nov 2025) — HIGH |
| Stats Engine (sequential) | **GA, and the default** | [Statistical analysis methods overview](https://support.optimizely.com/hc/en-us/articles/39714777161229-Statistical-analysis-methods-overview) (2026-05-09) — HIGH |
| Frequentist (Fixed Horizon) + Bayesian stats | ⚠️ **BETA, CSM-gated** | Verbatim: *"are in beta. Contact your Customer Success Manager"* — HIGH |
| ODP real-time audiences | **GA** | <90s refresh, most <10s; **28-day event window**; ⚠️ *"You cannot export these audiences out of ODP"* — HIGH |
| ODP → Feature Experimentation audience builder | ⚠️ **BETA** | ODP release notes, Feb 2026: *"(Beta)"* — HIGH |
| Product Recommendations | **GA — 74 named algorithms** (51 base + 23 variants) | [Algorithms for widgets](https://support.optimizely.com/hc/en-us/articles/28617777662861-Algorithms-for-widgets) (upd. 2026-07-22) — HIGH. Heritage: the acquired **Peerius** engine (a "Peerius tracking tag" doc still ships) |
| **Catalog/feed refresh cadence for Recs** | ❌ **NO PUBLIC DOC FOUND** | Neither the dev `llms.txt` index nor the support category documents it — **do not quote a number** |
| Content Recommendations (Idio) | **GA but visibly de-prioritized** | Docs real ([overview](https://support.optimizely.com/hc/en-us/articles/38808188840589-Overview-of-Content-Recommendations), 2025-11-24) — but **no 2026 release-notes article** (latest entry 2025-12-23), not listed on [optimizely.com/products](https://www.optimizely.com/products/), deploys as a **CMS 12 NuGet package** (PaaS only). No EOL notice — MEDIUM-HIGH |
| **Content personalization on SaaS CMS** | ❌ **NOT DOCUMENTED** | SaaS CMS dev doc index (191 pages): `personaliz*` = **0**, `visitor group` = **0**, `audience` = **0**. 2026 SaaS CMS release notes (upd. 2026-08-17): zero personalization entries all year — **HIGH** |
| **Content personalization on CMS 12 (PaaS)** | **GA, complete** | [Personalize content](https://docs.developers.optimizely.com/content-management-system/docs/personalization) (2026-07-20): rule-based audiences + Content Recommendations; ODP page titled *"Configure Real-Time Audiences to personalize **CMS 12**"* — HIGH |
| **Limitless 1:1 Personalization** | **Shipped & buyable — but not what the press release implies** | [Support doc](https://support.optimizely.com/hc/en-us/articles/45290790435085-Limitless-1-1-Personalization) (upd. 2026-06-29) has a section headed **"What this is not"**: *"**Real-time personalization** – Sets pages per account or segment, **not dynamically per visitor session**"*; *"not microsites."* Requires a **dedicated new CMS instance**, CMS+CMP+ODP+Opal, an assigned **Field Delivery Engineer**, and AE/CSM-led onboarding — HIGH |
| Opal / Agent Platform | **GA**; 45–50+ prebuilt agents | [Opal overview](https://support.optimizely.com/hc/en-us/articles/36354416686477-Optimizely-Opal-overview) (2026-08-12). ⚠️ **Opal chat for Product Recommendations is the one explicit `(Beta)`** in the whole 2026 Opal release notes — HIGH |
| Warehouse-Native Experimentation Analytics | **GA** (no beta label) | §4.1 — HIGH; ⚠️ provisioning requires emailing support |
| Experimentation Events Export | **GA** | §4.1 — HIGH; ⚠️ **S3 ends 2026-11-30** |
| Feature Rollouts | ⚠️ **BETA** | FX release notes, 2026-05-18: *"(Beta)"* — HIGH |
| Graph Search Management Portal | ⚠️ **BETA** | CMS SaaS release notes, 2026-05-21 — HIGH |

### The honest answer to "is Optimizely's content personalization still in discovery?"
**No — but the customer is directionally right, and here is the precise version:**
- Optimizely **ships documented content personalization on CMS 12 (PaaS)**: rule-based audiences + ODP real-time audiences + Content Recommendations NLP. That is not discovery. **HIGH.**
- Optimizely has **no documented content-personalization capability on SaaS CMS** — zero hits across 191 doc pages and a full year of release notes. If QVC's target architecture is SaaS CMS, the honest answer is *"that path is not documented today."* **HIGH.**
- The 2026 flagship, **Limitless 1:1 Personalization**, is real and buyable but is a **field-delivered engagement** publishing durable per-account/per-segment landing pages to a subdomain — and **Optimizely's own doc says it is not real-time and not per-session.**
- Where Optimizely is genuinely strongest today: **experimentation and measurement** — CMAB GA across ~10 SDKs, mature Stats Engine, warehouse-native analytics on four warehouses. That is also what [Forrester Wave: Experience Optimization Solutions, Q3 2026](https://www.optimizely.com/company/press/forrester-eos-wave-2026/) (2026-08-17) rewarded; our own release quotes highest marks for *"vision, innovation, roadmap"* and *"web and feature experimentation"* — and notably **does not** claim leadership on personalization delivery.

⏰ **Timing risk: Camp Opticon NY is 2026-09-01 — two weeks out.** Expect new personalization/agentic announcements. Do **not** let QVC-facing material absorb an Opticon announcement as available-today; the [product-updates hub](https://www.optimizely.com/product-updates/) carries an explicit disclaimer that unreleased features *"may not be delivered as planned or at all."* The public [Personalization roadmap](https://www.optimizely.com/product-updates/personalization/) shows three "Coming soon" Q3 items — all authoring productivity, **none** personalization intelligence.

---

## §6 — Live-commerce personalization: genuine white space

**QVC's strategic center of gravity is the live/social pivot.** Qurate Retail became **QVC Group on 2025-02-21** explicitly to support *"growth strategy to expand into a **live social shopping company**."* On **2025-04-02** they launched the first U.S. **24/7 live social shopping experience on TikTok Shop** — 40,000+ hours of live shoppable content annually, 100+ celebrity/host-creator partnerships, 400,000 products, 200M+ homes across 15 TV channels; **74,000+ creators** have featured QVC items since Aug 2024; **TikTok Shop "Seller of the Year" 2025**. ([QVC Group newsroom](https://www.qvcgrp.com/newsroom/pressrelease/qvc-group-launches-first-u-s-24-7-live-social-shopping-experience-with-tiktok-shop/).) **HIGH.**
⚠️ **Critically: that announcement contains no mention of personalization, data, or decisioning technology.** The pivot is framed entirely as content, talent and distribution. **HIGH** (verified absence in the primary source). And [Retail TouchPoints](https://www.retailtouchpoints.com/news/qvc-reframes-itself-as-a-live-social-shopping-company-plans-24-7-livestreams-on-tiktok/151103/) reported the social shift did not stop the Q1 revenue decline — the Chapter 11 filing a year later confirms it. **The framing has to change before a personalization budget exists.**

**The published state of the art is almost entirely Chinese, and overwhelmingly Kuaishou.** Verified via the arXiv API:
| Paper | ID | Date | Point |
|---|---|---|---|
| KuaiLive (real-time interactive live dataset) | 2508.05633 | 2025-08-07 | First dataset with **precise live-room start/end timestamps**; enables simulating **dynamic candidate items** |
| Sliding Window Data Stream Paradigm | 2402.14399 | 2024-02-22 | Cuts request→impression latency; time-sensitive **re-recommendation** |
| Moment&Cross | 2408.05709 | 2024-08-11 | Content quality varies **moment-to-moment**; borrows short-video signal for sparse live data |
| LiveForesighter | 2502.06557 | 2025-02-10 | Predicts upcoming engaging moments in a stream |
| SSRLive | 2606.06970 | 2026-06-05 | Semantic IDs that **mutate as live-room content changes** |
| HarmonRank | 2601.02955 | 2026-01-06 | Deployed in Kuaishou live e-commerce (400M DAU); **+2.6% purchase** |
| Alibaba DBMTL | 1902.09154 | 2019-02-25 | Deployed in **Taobao Live**; Bayesian multi-target (CTR, watch time, purchase) |
| LSEC-GNN | 2106.03415 | 2021-06-07 | **Tripartite streamer–user–product** graph — streamer as a first-class entity |

**HIGH** on IDs/dates/existence; **MEDIUM** on my one-line characterizations.

**Four technical distinctives, evidenced:** (1) **inverted cold start** — KuaiLive logs **23,772 users vs 452,621 streamers** over 21 days; the item space is ~19× the user space, the inverse of normal retail recsys. (2) **The item is the stream/host, not the SKU.** (3) **Intra-stream non-stationarity** — the same stream is a different item at different moments. (4) **Cross-domain transfer is the standard cold-start remedy** — borrow short-video behavior to seed live. *QVC's direct analogue: use on-site and broadcast behavior to seed the TikTok/streaming surface.* **HIGH** on the technique, **MEDIUM** on the analogy.

**The white space is real.** Case-study libraries fetched and keyword-scanned on 2026-08-18 (searching *live shopping, livestream, live commerce, video commerce, flash sale, daily deal, live selling, shoppable video, QVC, HSN, home shopping*):

| Vendor | Result |
|---|---|
| Bloomreach (512KB), Coveo (317KB), Insider (387KB), Nosto (116KB), **Optimizely (959KB)**, Monetate | **ZERO hits each** |
| Constructor | QVC logo present in the carousel — **no live-commerce case study** |
| Dynamic Yield (403), Adobe (connection failed), Salesforce/Algolia/Klevu/Attraqt | **NOT TESTED** — genuine gap |

**HIGH** for the six zero-hit libraries. And from the other direction: the **live-commerce platforms do not do algorithmic personalization**. Bambuser's eight "personaliz" hits all refer to **human 1:1 video consultation**; Firework's "AI" is a **conversational shopping agent**, not audience decisioning or ranking; Channelize has zero. **HIGH.**

**Verdict: the live-commerce platforms sell video infrastructure and human presence; the personalization vendors sell static-catalog decisioning. Neither sells real-time decisioning over ephemeral, time-boxed inventory. The seam is unoccupied in the West** — while the technical problem is well-mapped by Kuaishou, Taobao, and the bandit literature: **recovering rewards** ([arXiv:2106.14813](https://arxiv.org/abs/2106.14813), Simchi-Levi/Zheng/Zhu, 2021 — explicitly applied to *live-streaming commerce promotions*; an offer's value decays when shown and recovers over time — the closest formal match to a TSV rotation I found), **limited supply** ([arXiv:2603.18702](https://arxiv.org/abs/2603.18702), coupon allocation under supply constraint, 2026-03-19), and **bandits as a product surface** (Expedia's AdaptEx, [arXiv:2308.08650](https://arxiv.org/abs/2308.08650)). **HIGH.**

---

## §7 — Corrections: things to get right in the room

1. ❌ **"Dynamic Yield is Deloitte-owned."** **It is Mastercard-owned.** Acquired for **$325M cash, closed April 2022**; branded **Mastercard Dynamic Yield**; `dynamicyield.com` now **301-redirects to mastercard.com** (verified 2026-08-18). Prior owner was McDonald's (2019, ~$300M). The only Deloitte link is a 2018 *Deloitte Fast 500* award. **HIGH.**
2. ❌ **"Adobe Target is being sunset."** It is not. Releases shipped **2026-08-04, 08-11, 08-13**; a Target **MCP server** GA'd May 2026; AJO Experimentation Accelerator is positioned as *complementing* Target. at.js 1.x is in "maintenance mode" and mbox.js is "deprecated" — but **no EOL dates are published**. Do not claim one. **HIGH.**
   ✅ *The defensible wedge instead:* AJO's Web channel now ships visual/non-visual web editing, SPA support, click tracking and page personalization (AJO web docs, Apr–Jun 2026) with **zero mention of Adobe Target and no coexistence guidance anywhere**. Ask Adobe to put its three-year web-personalization direction **in writing**. **MEDIUM-HIGH** (absence-of-content, verified across multiple pages).
3. ❌ **"Adobe can't get per-decision data out."** Too strong. Say: *"Adobe documents no per-decision export from Target itself. The documented paths are Analytics Data Feeds via A4T — per-impression, score-less, AP-excluded, requiring an Analytics licence — or customer-built instrumentation. Streaming to your own endpoint requires RTCDP."* **HIGH.**
4. ❌ **"A4T doesn't work with Adobe's ML activities."** Only **Automated Personalization** is unsupported. **Auto-Allocate and Auto-Target ARE A4T-supported.** (Under CJA: Auto-Target is not.) Getting this wrong is the easiest way to lose the room. **HIGH.**
5. ❌ **"Adobe Recommendations is ancient tech from acquisition X."** The **platform** lineage is verifiable — Omniture acquired **Touch Clarity** ($51.5M) and **Offermatica** ($65M) in 2007; Adobe acquired Omniture in 2009 ($1.8B). But **the Recommendations engine's specific lineage and GA dates are UNVERIFIED.** Safe framing: *"platform lineage traces to Omniture's 2007 acquisitions."* Attack the **documented cadence** (12–32h), not the pedigree.
6. ❌ **"Optimizely gives you a microsite for every buyer."** Our **press release** says microsite; our **support doc** says *"not microsites"* and *"not real-time personalization."* Two Optimizely surfaces contradict each other. **Use the doc's language.**
7. ❌ **"Optimizely does sub-90-second real-time personalization."** 90s is **ODP segment-membership freshness**, not decision latency. The decision path is an **async ODP lookup with a 2-second maximum wait that fails closed** — *"If the API response does not return within 2 seconds, the audience is evaluated as false, and the visitor is not bucketed"* — plus a documented **first-page-view race condition**. Never present 90s as decision latency. **HIGH.**
8. ❌ **Do not quote an Optimizely Recommendations catalog refresh cadence.** **NO PUBLIC DOC FOUND.** **HIGH.**
9. ⚠️ **CMAB reporting.** The public FX doc says the CMAB *"Results page … (Currently in development.)"* (2026-07-23). Also public: CMAB has **no sticky bucketing**, exploration starts at 100% under the default Automated goal and decays to a 5% floor, and revenue is discouraged as the primary metric. Disclose these before their DS team finds them. **HIGH.**
10. ⚠️ **Disclose proactively:** Optimizely S3 export ends **2026-11-30**; the Snowflake share is documented at **up to 1B events/month**; **CUPED is numeric-metrics-only** with no user-defined covariates (narrower than Eppo's CUPED++); and **how the warehouse-native decision dataset gets populated is not publicly documented** — get a PM answer before the technical meeting, because it is the first question their data engineers will ask.
11. ❌ **Do not assert HSN's personalization history** (Certona / RichRelevance). **UNVERIFIED** — no evidence found.
12. ❌ **Do not assert the "4–5 day offer window."** The TSV collection page is Akamai-bot-blocked (HTTP 418); the 24-hour TSV mechanic and the 4–5 day window are **uncorroborated from public sources**. Ask QVC to describe their own windows — it is a better question than a claim.
13. ❌ **Do not cite Groupon, Ibotta, Instacart or Etsy engineering on expiring-offer ranking.** `engineering.groupon.com` returned 522 and its Medium successor 403. The only signal is a 13-year-old search snippet. Likely exists; not verified.
14. ❌ **Do not quote G2/TrustRadius/Gartner Peer Insights/Reddit verbatims.** All blocked (403) this session. The usable review data is thin: **PeerSpot** (3.9/5, n=20; a Target-vs-Optimizely comparison shows **7.8 vs 9.2**, small n) and **SoftwareReviews 2026** (n=22; composite 6.9/10, lowest scores **Vendor Support 64**, Training 67, Usability 68, Product Strategy 72). ⚠️ **Counter-fact to anticipate: SoftwareReviews shows Plan to Renew = 100.**
15. ❌ **Do not use the MiaProva "reporting bridge" quote** circulating in competitive decks — it describes a **third-party feature-flag tool, not Adobe Target.** Misattribution would be caught immediately.
16. ❌ **Do not claim OpenAI acquired Statsig.** UNVERIFIED. (Eppo→Datadog **is** confirmed by site branding.)

---

## §8 — The five sharpest competitive facts, ranked

1. **Adobe's own model-explainability report cannot exist for a QVC-length offer:** Personalization Insights requires the activity to be *"Live … and receiving traffic for at least 15 days"*, Target Premium, and a conversion-based goal, and it excludes control traffic — so for a 24-hour TSV, the black box can never be opened. ([Adobe, upd. 2026-05-12](https://experienceleague.adobe.com/en/docs/target/using/reports/insights/personalization-insights-reports) — **HIGH**)
2. **A new item takes 2–32 hours to become recommendable in Adobe, and catalog feeds max out at Daily** — *"Recommendations are updated within 2-32 hours total"*; *"Algorithm runs are scheduled every 12 hours for 1-2 day algorithms and every 24 hours for 7+ day algorithms"* — meaning a 24-hour deal is frequently gone before Adobe can rank it on behavior. ([Adobe Recommendations FAQ / feeds, upd. 2026-05-12](https://experienceleague.adobe.com/en/docs/target/using/recommendations/recommendations-faq/recommendations-faq) — **HIGH**)
3. **Adobe's flagship ML activity cannot report through Adobe Analytics at all** — Automated Personalization is listed *"No"* for A4T, and *"Automated Personalization activities are not supported when you choose Adobe Analytics as the reporting source"* — so the one activity type QVC would most want to measure independently is the one locked inside Target's UI. ([Adobe A4T, upd. 2026-05-12](https://experienceleague.adobe.com/en/docs/target/using/integrate/a4t/a4t) — **HIGH**)
4. **Optimizely ships QVC's data-science requirement as documented product: one row per decision with a dedupe UUID and an `is_holdback` flag, next-day by 13:00 UTC, plus zero-ETL Snowflake/BigQuery shares and warehouse-native analysis with built-in SRM checks on Snowflake, BigQuery, Databricks and Redshift** — against Adobe's ~1-hour-at-best A4T path that carries no model score and excludes AP, and a Dynamic Yield export path for which **no public documentation could be found at all**. ([Optimizely docs dated 2026-08-04 / 2026-08-06 / 2026-03-18](https://docs.developers.optimizely.com/experimentation-data/docs/enriched-events-export) — **HIGH**; DY = absence of public docs, not absence of capability)
5. **Every major vendor concedes ML cannot cover the cold window — Adobe's own documented ranking-formula example is literally "Boost offers expiring within 24 hours," and Bloomreach ships rules-based templates because Loomi ML templates *"can't be used immediately as they need data and learning time"*** — which means QVC's problem is not a recommendations problem, it is decisioning-under-expiry, and **no Western personalization vendor has a published live-commerce reference story** (zero keyword hits across the Bloomreach, Coveo, Insider, Nosto, Monetate and Optimizely case-study libraries, scanned 2026-08-18). (**HIGH**)

---

### Open gaps worth one more research pass (search budget was exhausted at 200/200 mid-task)
Adobe / Dynamic Yield / Salesforce / Algolia case-study libraries (untested); Salesforce product naming and algorithms (all six URL attempts blocked); Groupon / Instacart / Ibotta offer-decisioning engineering; the exact TSV mechanic and the "4–5 day window"; QVC's "WIN strategy" pillars (named in the 10-Q, defined nowhere public); HSN's personalization history; Opticon 2025 announcements and Optimizely's Gartner MQ 2026 position/cautions; and most of the off-policy-evaluation and adaptive-inference literature. None are dead ends — all are budget casualties.
