# Opticon — the abstract, claim by claim

The marketing abstract for the session is Coach/Tapestry, line for line. This is the checklist the Meridian deck is judged against: every claim, where Coach already does it in this repo, what Meridian has, and what is being ported. Nothing in the abstract is new; the only genuinely new piece is marked.

> Most personalization pitches start with a segment and someone else's data. This one starts with what shoppers from your visitor's actual neighborhood actually bought: first-party purchase history enriched with free public Census data. No licensing fees. Real purchase intent. And it compounds over time because it's yours.
> Simone Araujo Coelho walks through a live, working retail personalization platform built end to end on Optimizely, covering the full stack: a viral TikTok signal that triggers a bandit test and optimizes the winner inside a 30-minute window; a revenue radar that surfaces a 44% Gen-Z checkout drop (roughly $7.6K recoverable) and proves the fix in the room; and an AI concierge that delivers taste and advice, not just product rankings. All 15 personalization capabilities, running on real infrastructure. No mockups, no Figma. The experiments are real flags you can open in Optimizely right now.
> This is what the whole machine looks like when you own it.

## Coverage

| # | Claim | Coach — where it is built | Meridian — status | Port |
|---|---|---|---|---|
| 1 | **Neighbourhood cold start** — first-party purchase history by geography, enriched with free public Census data | `docs/architecture/13-geo-cohort-coldstart-prd-tdd.md` (spec, as-built §12/§12a) · `src/services/geo/cohort.ts` (ladder ZIP→metro→state→national gated on first-party N≥30; representative 50-state fallback; `synthesized` flag) · `src/routes/geo.ts` · `migrations/seed/seed_011_geo.sql` (320 NC shoppers, below-threshold ZIPs) · `public/storefront.js` 1264–1339, 2029–2102 (hero *"The Tabby leads near you"*, row *"What shoppers near you carry"*, ribbon *"Welcome from {city}…"*, provenance card with `geo REAL · query REAL · first-party REPRESENTATIVE · census REAL public`) | `coldstart.ts` reads census, derives a price-band prior, shows it in a tab. No cohort, no ladder, no fallback, nothing on the page. | **IN PROGRESS — the first thing the room sees.** `src/demos/meridian/geoCohort.ts` + `GET /meridian/api/cohort` against Meridian-owned `mrd_transactions` / `mrd_purchase_items`, seeded for the **New York metro** (the room) and the **North Carolina Triad**, with the 50-state fallback. The arrival is a gated act: the band declares the geo, the census, the receipts and what the page will open on; OK → hero, first line, ribbon, provenance. First engagement hands off. Curate, never price. |
| 2 | "No licensing fees… compounds over time because it's yours" | `TAPESTRY-POC-TEAM-BRIEF.md` §1 · runbook §2 *Say* lines · the DY-vs-us contrast modal (`public/revenue-radar.js buildContrast`) | Absent | Port the contrast modal and the *Say* line into the cold-start beat; the provenance card says "your warehouse in production"; "Show the receipts" shows the rows. |
| 3 | **TikTok signal → bandit → winner inside 30 minutes** | `docs/architecture/12-signal-led-moment-build-brief.md` · `public/storefront.js` 3479–3715 (three scenes, 28:00 countdown, `showMab` allocation 33/34/33 → 11/73/16, *"Loop closed in 4:12 of 28:00 — winner promoted automatically"*) · `src/services/experimentFx.ts` (real `multi_armed_bandit` rule) | Signal → Opal writes → real flag works (beats 36–38). No bandit half, no countdown, no allocation readout. | Port the readouts and the countdown; allocation on the demo clock; honesty grid verbatim from doc 12. |
| 4 | **Create A/B · MAB · CMAB** visibly, "Opal doing it" | `experimentFx.ts` + `experimentRun.ts` (real Flags v1 + v2 API; `live · plan · writes off · simulated` status) · readout cards `showAbReadout / showMab / showCmab` · `island/opal-chat.tsx` `ToolCard` (`⚙ launchExperiment · running… → live`, Flag/Rule/Variation rows) | `experiment.ts` has the rule-type map and dispatch; no card, no readout. | Port the cards, the tool card and the status line. CMAB may land as a draft needing review — the card says so, as Coach does. |
| 5 | **Revenue Radar: 44% Gen-Z drop, ~$7.6K recoverable, proves the fix in the room** | `src/services/funnel/compute.ts` (44.3% and $7,623 *computed* from `migrations/0003_funnel_seed.sql` Coach·gen_z 298→166, × anomaly-excess × $385 AOV × 30%) · cohorts `gen_z/millennial/gen_x/boomer` · `revenue-radar.js rrLaunch` → real audience + real experiment → `rr:launched` → payment step becomes *Pay in 4* in-session, 600 converting sessions burst, funnel recovers · Coach's modal padding grammar | Radar exists (mobile×premium defect); no generational cohort; no prove-the-fix; no padding. | Port the cohort dimension, the seed shape for Calder's AOV, launch → in-session fix → recovery, and the padding. |
| 6 | **AI concierge — taste and advice** | `docs/architecture/17-ai-search-concierge.md` (streaming, catalogue in context, picks structurally real) | Built (enum-bounded, never repeats, says "we don't carry that"). | Presence only: Coach's modal sizes. |
| 7 | **AI search** | Doc 17 + `docs/search-query-catalog.md` (chips + *"Type a request…"* before; Edit hero + ranked grid after) | Built and correct; named "Ask in words"; short card. | Rename to **AI search**; full height. **New (not in Coach either):** before a query, her affinity picks and *"shoppers near you bought"*. |
| 8 | **"All 15 personalization capabilities"** | Coach's RFP checklist — `public/storefront.js featureList`; `docs/EXPERIMENT-SURFACE-RUNBOOK.md` §3 | 10 solid; 5 to complete: cold start, MAB, CMAB, AI search presence, Opal audience *publish* (verify). | A visible 15/15 checklist that ticks as beats land. |
| 9 | "Real flags you can open in Optimizely right now" | `OPTIMIZELY_WRITE_ENABLED` gate; readout status line | Same gate | Same status line on every card. |
| 10 | "No mockups, no Figma" | `TAPESTRY-POC-EXEC-ONEPAGER.md` | Meridian is code | — |

## The 15, mapped to Meridian beats

| # | Capability (Coach's list) | Meridian |
|---|---|---|
| 1 | Customer profile (no sign-in) | ✓ `mrd_visitor_id`, no login |
| 2 | Cold-start data | **porting** — beat 4 (the arrival) + beat 10 (the receipts, DY vs us) |
| 3 | Real-time updates | ✓ every act repaints in the click |
| 4 | Recommendations | ✓ the picks, first line |
| 5 | Sort rules (baseline) | ✓ the standard order / Compare's Before |
| 6 | Personalized sort | ✓ |
| 7 | Personalized page structure | ✓ section order, Complete the look |
| 8 | Personalized page content | ✓ hero, story |
| 9 | Journey-stage detection | ✓ the stage dimension; add-to-bag → deciding |
| 10 | Opal audience creation | ✓ propose; **verify publish** |
| 11 | A/B testing | ✓ real (gated) — **make it visible** |
| 12 | Multi-armed bandit | **porting** |
| 13 | Contextual bandit | **porting** |
| 14 | AI search | ✓ engine; **presence** |
| 15 | AI Style Concierge | ✓ |

## Honesty (carried verbatim from the Coach specs)

- Cold start: *geo REAL (edge) · query REAL · first-party REPRESENTATIVE (synthetic; swap to the warehouse via `MRD_GEO_COHORT_SOURCE`) · census REAL public (ACS 2024 1-yr, cited per row)*. Curate, never price. Aggregate, never the individual. Show the grain used.
- Signal-led moment: *the social-listening signal is SIMULATED and badged; copy and scene are model-generated; delivered as feature variables; the bandit rule is REAL; convergence is REPRESENTATIVE; autonomy is roadmap.*
- Revenue Radar: *audience REAL · experiment REAL · in-session fix REAL · funnel volumes REPRESENTATIVE · lift REPRESENTATIVE.* Never claim these are the customer's production numbers.

## Order of work (agreed 2026-08-28)

1. Cold start on the page — the premise, first thing the room sees.
2. Experiments visible — readouts, Opal tool card, the bandit half of the TikTok beat with the 28:00 window on the demo clock.
3. Revenue Radar — Gen-Z cohort, 44.3% / $7,623, prove the fix in-session, padding.
4. AI search — rename, full height, affinity + neighbourhood rows before a query.
5. Modal exclusivity + the 15/15 checklist.

Compare must be reliable throughout (under investigation, root cause required).
