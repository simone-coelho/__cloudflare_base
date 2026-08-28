# How personalization engines show impact — research for the Opticon demo

**Date:** 2026-08-28 · **Method:** agent with web access; every claim carries a URL; UNVERIFIED marks snippet-only sources.

**Report: how leading personalization engines make impact visible/explainable in demos** (~1000 words excl. URLs; numbers 1–7 map to your question list; "UNVERIFIED" flags snippet-only or unreachable sources)

**Access notes.** DY support KB is bot-blocked; read via the r.jina.ai reader proxy (content verbatim). DY product-demo video is cookie-walled; G2/Gartner/TrustRadius review pages blocked (captcha/404) — reviewer quotes below are search-snippet level. Salesforce Help pages are JS-rendered (two cites snippet-only). Bloomreach/Insider interactive tours exist but caption text is not fetchable.

**Dynamic Yield**
1. Affinity is per attribute-value integer scores (`categories`, `color`, `in_sale`… e.g. `"black": 214`), AffinityML floats 0–1: https://dy.dev/reference/affinity-client-side. Score = Σ(engagement-type weight × count) with recency tiers 48h / 30d / 12mo: https://support.dynamicyield.com/hc/en-us/articles/360005773198-Affinity-based-Personalization. No operator-facing "affinity panel" documented (UNVERIFIED).
2. Affinity audience = attribute + value + level "from highest to within the top 10": https://support.dynamicyield.com/hc/en-us/articles/360025623873-Affinity-based-Audiences. "Users enter audiences in real time, [but] reports are updated once a day": https://support.dynamicyield.com/hc/en-us/articles/15804454530077-Audience-Reports. Conflict rule: "If the targeting conditions of multiple experiences are met - only the experience defined with the highest priority is served"; priority = list order; no match → campaign not served: https://support.dynamicyield.com/hc/en-us/articles/360022725293-Targeting-Conditions. Report widget per primary audience: share of traffic, winning variation, uplift: https://support.dynamicyield.com/hc/en-us/articles/5589842867229-Primary-Audiences.
3/4. Preview has conditional and forced modes; debugger "specifies which conditions failed"; Variation Navigator shows variation/experience/campaign: https://www.mastercard.com/us/en/news-and-trends/Insights/2020/easy-previewing-experiments.html; "a message appears, explaining why the variation wasn't served": https://support.dynamicyield.com/hc/en-us/articles/360022065253-Previewing-Site-Personalization-Campaigns.
5. Experience Reports: uplift vs control, 95% credible-interval graphics, tables broken down by audience: https://support.dynamicyield.com/hc/en-us/articles/15159975159453-Experience-Reports. Predictive Targeting cards = audience + variation to serve + expected uplift, top 5 ranked: https://support.dynamicyield.com/hc/en-us/articles/360022724793-Personalization-Opportunities-Predictive-Targeting; "1 click" deploy + email: https://www.mastercard.com/us/en/business/consumer-acquisition-and-engagement/personalization/dynamic-yield/use-cases/targeting/predictive-targeting.html.
6. Pin "overriding the widget's recommendation strategy… Pin rules always apply": https://support.dynamicyield.com/hc/en-us/articles/360022549994-Recommendation-Custom-Filter-Rules. Affinity Allocation: tag variations with affinity values; highest score wins: https://support.dynamicyield.com/hc/en-us/articles/5283245548317-Affinity-Allocation.
7. Demo video inaccessible: https://www.mastercard.com/us/en/business/consumer-acquisition-and-engagement/personalization/dynamic-yield.html (UNVERIFIED).

**Adobe Target**
1. No per-visitor affinity view; Important Attributes = multi-colored bar graph, top-10 of 100 attributes summing to 100%: https://experienceleague.adobe.com/en/docs/target/using/reports/insights/important-attributes-report. Automated Segments: pink conversion bar vs grey dotted overall line: https://experienceleague.adobe.com/en/docs/target/using/reports/insights/automated-segments-report.
2. Priority Low/Med/High or 0–999; ties: only-one-with-audience wins, else first-approved; content applied lowest→highest, highest overwrites: https://experienceleague.adobe.com/en/docs/target/using/activities/priority. Collisions tab lists status+priority: https://experienceleague.adobe.com/en/docs/target/using/experiences/vec/activity-collisions.
3. Debugger trace: Matched vs Evaluated activities, "Matched Audiences and Unmatched Audiences with human-readable rules", Profile Snapshot: https://github.com/adobe-target/clientside/wiki/A6.-Troubleshoot-with-Adobe-Experience-Cloud-Debugger.
4. Activity QA toggles "Match audience rules to see experiences" and "Show default content for other activities"; QA traffic kept out of reports: https://experienceleague.adobe.com/en/docs/target/using/activities/activity-qa/activity-qa.
5. Columns: conversion rate, lift vs control, confidence, CI as grey ±: https://experienceleague.adobe.com/en/docs/target/using/integrate/a4t/a4t-faq/a4t-faq-lift-and-confidence.
6. Promotions "take precedence over criteria results and backup recommendations", N slots front/back: https://experienceleague.adobe.com/en/docs/target/using/recommendations/recommendations-activity/adding-promotions.
7. Adobe's own live demo script: "Open the demo site in multiple browser windows or incognito"; "Visit any biking-related adventure… then navigate to the Adventures page"; "Sign in with rwilson/rwilson and refresh": https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/personalization/live-demo.

**Bloomreach**
1/2. Profile: predictions are attributes (probability 0–1, recalculated on request) under Properties > Predictions: https://documentation.bloomreach.com/engagement/docs/predictions-generally; segment membership is a real-time-computed attribute; profile shows "which products would be shown to this customer": https://documentation.bloomreach.com/engagement/docs/customers.
3/5. Contextual personalization picks per-customer variant from device/location/time/history; Comparative A/B 80/20: https://documentation.bloomreach.com/engagement/docs/weblayers-in-contextual-personalization; evaluate via `variant_type` segments (CP / A / B) funnels: https://documentation.bloomreach.com/engagement/docs/evaluate-contextual-personalization. Experiments: control group + built-in evaluation dashboard: https://documentation.bloomreach.com/engagement/docs/experiments.
6. Grid editor: Boost to Top, Lock Position #, Lock in Place, green up-arrow, "Preview function will show the exact API output": https://documentation.bloomreach.com/discovery/docs/boost-and-position-lock-your-first-product; Strength slider + right-side preview: https://documentation.bloomreach.com/discovery/docs/boost-attributes-in-search-results.
7. 5-minute "Launch Tour" click-throughs; captions unreachable: https://visit.bloomreach.com/engagement-tour.

**Salesforce Personalization**
1. Ecommerce profile has an affinities graph: "four color-coded types, e.g., brand, style, category, features", hover reveals top four items "with color-coded bars that indicate the percentage": https://help.salesforce.com/s/articleView?id=sf.mc_pers_unified_customer_profile_for_ecommerce.htm&language=en_US&type=5.
2. "In Segments" tab per user (UNVERIFIED, snippet): https://help.salesforce.com/s/articleView?language=en_US&id=sf.mc_pers_segment_user_membership.htm&type=5.
3/4. Campaign Debugger: experience ID, control vs not, non-return reasons ("user doesn't meet the rule criteria", zone absent, disabled, items unavailable); Testing Mode forces experiences: https://developer.salesforce.com/docs/marketing/personalization/guide/campaign-debugger.html.
5/6. Einstein Decisions = contextual bandit; expected value = completion chance × business value; eligibility rules constrain: https://trailhead.salesforce.com/content/learn/modules/einstein-recipes-and-decisions-quick-look/explore-einstein-recipes-and-einstein-decisions; ~10,000 impressions/promotion before lift; no sorting/pinning: https://help.salesforce.com/s/articleView?id=sf.mc_pers_einstein_decision_promote.htm&language=en_US&type=5. Einstein Reports "how and why" decisions (UNVERIFIED, snippet): https://help.salesforce.com/s/articleView?id=mktg.mc_pers_einstein_report_view.htm&language=en_US&type=5.

**Optimizely**
2. "Visitors see the highest priority experience for which they qualify": https://support.optimizely.com/hc/en-us/articles/27733776221453-Core-concepts-of-Optimizely-Personalization; console `window.optimizely.get('data').campaigns[id].experiments` lists audiences by priority: https://support.optimizely.com/hc/en-us/articles/27733954090125-Not-seeing-the-right-experience-in-a-campaign; ODP profile "Memberships displays the customer's real-time audience memberships": https://support.optimizely.com/hc/en-us/articles/4407775257613-Manage-customer-profiles.
4. Preview panel tabs Currently Viewing / Override / Feed; "Browse for Audiences… Apply Changes to preview the page as that audience": https://support.optimizely.com/hc/en-us/articles/4410289461133.
5. 95/5 holdback; Overall Improvement + CI; Impact column vs holdback; per-audience graph: https://support.optimizely.com/hc/en-us/articles/27733844950669-Optimizely-Personalization-Campaign-Results-page.
1. Content Recs per-visitor topic UI: UNVERIFIED (only aggregate dashboards documented): https://support.optimizely.com/hc/en-us/articles/38808188840589-Overview-of-Content-Recommendations.

**Insider**
1. Profile Overview: LTP "High, Low, NA"; Discount Affinity "Low/Mid/High Predicted/Calculated"; Lifecycle status; "Presence in Lists and Segments" counts; Product History: https://academy.insiderone.com/docs/elements-of-a-user-profile. LTP is a real-time score vs threshold: https://academy.insiderone.com/docs/predictive-segments-likelihood-to-purchase.
5. OnSite analytics: "With Control Group" tab, incremental conversions, significance, probability of win: https://academy.insiderone.com/docs/faq-about-onsite-analytics.
6. Eureka pin/boost/bury/hide: https://insiderone.com/eureka-search/; recs Attribute Affinity boost (≤5 attributes): https://academy.insiderone.com/docs/recommendation-strategy-settings.
7. 80+ self-guided tours, 1–10 min: https://insiderone.com/product-demo-hub/.

**Algolia**
1. User Inspector: affinities 1–20, grouped by attribute, "last computed" date: https://www.algolia.com/doc/guides/personalization/advanced-personalization/monitor/in-depth/inspect-a-user-profile.
3. `_rankingInfo`: `promoted: true`, `appliedRules`, `personalization`: https://www.algolia.com/doc/api-reference/api-parameters/getRankingInfo; `initialPosition` vs `newPosition` (UNVERIFIED, page 403): https://support.algolia.com/hc/en-us/articles/38735932015249-How-do-Dynamic-Re-Ranking-and-Personalization-work-together.
4/5. Simulator: non-personalized left vs personalized right, ↗/↘ position deltas, "Personalized" label revealing facet values + affinity scores; impact slider 0–100: https://www.algolia.com/doc/guides/personalization/classic-personalization/personalizing-results/in-depth/configuring-personalization.
6. Recommend rules pin/hide/boost/bury/filter with preview before save: https://www.algolia.com/ecommerce-merchandising-playbook/recommendations-rules.

**Coveo**
3. Relevance Inspector: 5-step query journey, per-result score per ranking factor incl. ML; Alt/Option double-click: https://docs.coveo.com/en/mbad0273/. "Preview section can't simulate a specific visitor" → use RI: https://docs.coveo.com/en/o9ia2221/.
6. Order: pins → exclude → include → boost/bury; card icons include/boost/bury/pin/lock/sponsored: https://docs.coveo.com/en/o4nh0587/; drag-drop pinning, "approximate simulation": https://docs.coveo.com/en/o5sf0214/.
7. Narrated 2–16 min videos ("1:1 Personalization in Anonymous Sessions", 5 min): https://www.coveo.com/en/demo-video-hub/all/coveo-feature-spotlight.

**(a) Recurring patterns**
1. Scored affinity profile per attribute→value (DY ints, Algolia 1–20, SF bars, Insider labels, BR probabilities).
2. Ordered priority list; "highest wins, none → nothing" (DY, OPT, Adobe + tiebreaks).
3. Trace overlay: matched vs unmatched audiences in human-readable rules + failure reasons (Adobe Debugger, SF Debugger, DY preview).
4. Forced vs conditional preview toggle (Adobe QA, DY, OPT Override, SF Testing Mode).
5. Side-by-side with position deltas + reason label (Algolia simulator; Coveo/BR icons).
6. Rule-stack badges + declared precedence (Coveo order, DY "pin always applies", Adobe promotions).
7. Holdback/control uplift with CI, per audience (OPT, DY, Adobe, Insider, BR).
8. Predict-then-deploy cards (DY Predictive Targeting).

**(b) Why DY wins (cited by reviewers/analysts):** campaigns "previewed and published in real-time", "easy to identify different audience segments and serve the most relevant content" (snippet-level; page 404 via proxy): https://www.trustradius.com/products/dynamic-yield/reviews/pros-and-cons?f=25; "predictive targeting spots opportunities proactively", "more agile… without siloed tools": https://adtools.org/buyers-guide/adobe-target-vs-dynamic-yield-vs-insider-vs-braze-personalization-engines-buyer-s-guide; "intuitive testing and merchandising": https://www.statsig.com/perspectives/adobe-target-dynamic-yield-ab-testing-comparison.

**(c) Recommendations for our demo**
1. Persistent "visitor lens" panel: attribute→value→score rows (DY JSON shape) that animate deltas on every click, with a "last computed" stamp (Algolia) — pattern 1.
2. Audience strip with numbered priority column; when two chips light up, the slot caption reads "Slot won by #1 Red-affinity (0.82) over #2 Sale-seeker (0.61)" and lists the loser as "matched, outranked" (Adobe matched/unmatched vocabulary; DY highest-priority rule) — patterns 2/3.
3. Per-slot "Why this" toast carrying: matched audiences, unmatched + failed condition, rule applied, affinity values used, score, latency (fields from Adobe trace + SF Debugger reasons + Algolia `_rankingInfo`) — pattern 3.
4. QA toggle on stage: flip "match audience rules" off→on to prove targeting, not scripting (Adobe/DY) — pattern 4.
5. Predict-then-prove: before the click, show a DY-style card "Next: view red dress → color:red +40 → enters Red-affinity → hero swaps to B (weight 0.82)"; perform click; card lines tick green as panel deltas confirm — patterns 5/8.
6. Override beat: apply a pin live; card shows pin icon; toast says "Rule beat model: pin (precedence 1) > affinity" (Coveo order, DY pin-always-applies) — pattern 6.
7. Impact: split-screen holdback vs personalized session with running counters and per-audience improvement bars; close on 95/5 holdback slide (OPT/DY) — pattern 7.
8. Choreography: two visible browser windows (Adobe's own live-demo guidance), narrate the reason before each click, hotspot-annotated cursor as in vendor tours — pattern 3/5 and https://www.arcade.software/post/navattic-vs-storylane-vs-arcade-which-should-you-choose-in-2024.