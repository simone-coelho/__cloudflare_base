# Coach / Tapestry — Demo Master Playbook

**The single source of truth for running this demo.** Everything below is grounded in the actual code (verified 2026-06-26), not in older planning docs. It tells you, the presenter: what Opal can do, the exact prompts that work, what's **real vs representative**, what's **wired vs not-yet-wired**, and what each capability looks like on screen. (Older docs are reconciled in §8 — use this one.)

_Demo: Mon 2026-06-29 · Storefront (dev): https://edge-platform.expedge.workers.dev/storefront_

---

## 0. The frame (say this)
A live Coach storefront where an **anonymous shopper** gets real-time, individual personalization at the edge, and an **operator talks to Opal in plain English** to query data, build audiences, launch experiments, and fix revenue leaks — live, no developer. *"Dynamic Yield knows the neighborhood; Optimizely knows the shopper."*

**Your honesty line (verbal — nothing in the UI says "fake"):** *"The experiences, the audiences, the flags, and the experiments are real and live at the edge. The lift/allocation figures are illustrative for today — the measurement is GA and runs on real traffic over time."*

---

## 1. REAL vs REPRESENTATIVE (the honesty grid)
| Real (live, defensible) | Representative (illustrative numbers / synthetic volume) |
|---|---|
| Opal data Q&A over real seeded data (3,200 profiles + commerce) | Experiment **lift / confidence** (e.g. "+18%", "96%", "+48%") |
| Real Optimizely **audiences, flags, banners** via REST | Funnel **volumes** + simulated traffic (our owned dataset) |
| Real **A/B, MAB, CMAB** experiment rules + custom events | Recoverable-$ coefficients; DY "ZIP ~$420" (illustrates DY's *approach*) |
| Edge personalization + the in-session BNPL save | CMAB per-context "winners" (real decision logic, illustrative outcome) |
| Funnel computed from real seed+live events | |
**Never** call the volumes Tapestry production traffic.

---

## 2. Opal — what it can do (6 tools, all grounded in code)
Opal is a Gemini tool-loop. Tools: `queryData`, `createOptimizelyAudience`, `createFlag`, `targetMessageToAudience`, `launchExperiment`, `diagnoseFunnel`. Tool budget per turn ≈ 5 steps (keep multi-step asks to ~2 tool calls).

### 2A. Data Q&A — "dice & slice" (`queryData`, read-only, NOT gated)
Queries real D1 (one guarded SELECT; tables: `v_audience_base` [one row/customer], `coach_catalog`, `coach_transactions`, `coach_purchase_items`, `demo_events`). **12 prompts that work** (exact words → result):
1. `High-intent Tabby browsers who haven't added to cart — how many, and their AOV?` → 114 shoppers, $320 AOV
2. `How many gifters have a predicted LTV above $2,000?` → 88
3. `Average order-likelihood: window shoppers vs loyal-repeat customers?` → 27% vs 68%
4. `Which persona has the highest predicted lifetime value?` → luxe_collector (~$4,904)
5. `How many platinum members are at high churn risk (score > 0.6)?` → ~none
6. `Top 5 best-selling products by units, with revenue?` → Tabby Bag Charm (477, $71,550)…
7. `Which product line has the highest cart-abandonment rate?` → Novelty (~56%)
8. `90-day revenue from BNPL (Tabby/Affirm/Afterpay)?` → $322,116
9. `What share of orders are gifts, and the average gift order value?` → 16.8%, $374
10. `Compare average order value: US vs Canada.` → $350 vs $351
11. `Total revenue in the last 30 days?` → $2,361,529
12. `How many orders in the last 90 days?` → 7,293

(Full validated set: `docs/opal-question-catalog.md`. Don't ask about `v_profiles`/`coach_odp_profiles` by name — un-documented to Opal.)

### 2B. Entity creation (write tools — REAL via REST, **gated** by `OPTIMIZELY_WRITE_ENABLED`)
| Tool | Say this to Opal | Creates |
|---|---|---|
| `createOptimizelyAudience` | `Create an audience of US luxe collectors with predicted LTV over $3,000.` | real FX audience (+ attributes) |
| `createFlag` | `Launch a flag called complete_the_look to that audience.` | flag + variation + targeted rule, live |
| `targetMessageToAudience` | `Show a banner to cart-abandoners: "Complete your Tabby — free monogramming this week."` | cascading message rule on `personalized_banner` |
| `launchExperiment` | see §3 | real A/B / MAB / CMAB experiment |

### 2C. "Optimizely currently supports…" (WIRED vs NOT — **for you, the SA**)
**✅ Wired & live today (REST):** audiences · flags + targeted delivery · personalized banner · **A/B (`a/b`)** · **MAB (`multi_armed_bandit`)** · **CMAB (`contextual_multi_armed_bandit`)** · auto custom-event creation · data Q&A · funnel diagnosis. (CMAB is full-access on the Tapestry account; public docs may still say "beta.")
**◐ Representative:** all experiment lift/allocation numbers (artifact real, stats need traffic).
**✗ Not yet wired → "comes via Opal's MCP / native Optimizely":** real measurement / stat-sig (Analytics MCP `oa_*`) · real-time ODP segments + `fetchQualifiedSegments()` + Opal ODP audience tools · the Experimentation MCP (`exp_*`, *draft-then-human-Publish*) · Recommendations products · Email/SMS activation · CMS MCP.
**Say:** *"Entity creation — audiences, flags, banners, and A/B/MAB/CMAB — is real and live today through REST. The measurement layer and real-time ODP segments productionize through Opal's MCP servers."*

---

## 3. Experiments & flags you can START (the 5 scenarios)
Each is a real Optimizely flag `xsurf_<id>` that renders on the storefront **experiment surface** (`#xsurf`, a data-driven banner — one block, many variations).
| `scenario` id | Type → rule | Variations | Say this to Opal |
|---|---|---|---|
| `welcome_email_phone` | **A/B** | email_15 vs phone_10 | `Launch the welcome A/B — email 15% off vs phone 10%.` |
| `hero_creative_bandit` | **MAB** | editorial / bestseller / free_charm / monogram | `Run the hero creative bandit on the Tabby.` |
| `context_welcome` | **CMAB** | new_value / gen_z_drop / mobile_quick / returning_elevated | `Launch a context-aware welcome experiment.` |
| `move_brooklyn` | **MAB** | craft / alt_to_tabby / scarcity | `Move Brooklyn without a markdown.` |
| `bnpl_rogue` | **A/B** | price_forward vs pay_in_4 ($595 Rogue, 4×$148.75) | `Test pay-in-4 on the Rogue.` |

**3 ways to start one (all create the real flag + render the banner live):**
1. **Hands-free** — clicking **Next** to beats **11 (A/B)**, **12 (MAB)**, **13 (CMAB)** auto-launches `welcome_email_phone` / `hero_creative_bandit` / `context_welcome` and shows the Engine readout.
2. **Opal** — say the phrase above; the banner comes to life on its own.
3. **⌘K → "Show experiment variation"** — grouped by experiment (TYPE · name · key), pick any of all 5 scenarios' variations to show on demand. (Has a "Default — clear" reset.)
*(`move_brooklyn` is only reachable via Opal/⌘K, not a guided beat. `bnpl_rogue` is the buy-signal scenario — see §5 beat 9.)*

---

## 4. Revenue Radar — operations (the diagnose → fix → prove loop)
A checkout-funnel intelligence layer (Radar sidebar tab + Opal). Hero story: **Coach · Gen-Z payment→purchase collapses ~44%, $7,623 recoverable** → BNPL fix. **12 operations:**
- **Opal diagnose** (say checkout/funnel/revenue words): 1. `Where are we losing the most checkout revenue for Gen-Z?` → the $7,623 leak + Gen-Z BNPL audience + fix. 2. `Diagnose the Coach checkout funnel.` 3. `Where do Kate Spade shoppers abandon checkout?` → cart-recovery nudge. 4. `What's our biggest revenue leak on Stuart Weitzman?` → shipping estimator. 5. `How much can we recover on Coach for Gen-Z?` → leads with $7,623.
- **Radar tab clicks:** 6. click **Coach → Gen-Z pill** → headline jumps to $7,623/44.3%, payment step turns red (the "All-average hid it" reveal). 7. **⚡ Launch experiment** on the BNPL card → `Experiment live — <id> · +48% lift · 96% conf`; funnel auto-recovers. 8. **Simulate drop-off** → leak swells live ~44%→81% ($7.6k→$61.7k). 9. **Live traffic** toggle → shopper counter climbs. 10. **▶ Play story** → the whole Coach·Gen-Z arc, narrated. 11. **↺ Reset demo**.
- **In-session save:** 12. after Launch, on the storefront add a Tabby → **Checkout → Continue to payment** → the payment step shows **"Pay in 4 — interest-free with Tabby · 4×$143.75 · 0% APR"** + social proof (before Launch it was a plain card form).
- **Anti-DY beat:** the "Neighborhood vs Shopper" modal (`store.rrContrast()` — the toolbar button is currently hidden; trigger from console or re-enable).
**Real:** funnel compute, captured checkout events, audience/experiment creation, the edge save. **Representative:** volumes, simulated traffic, the +48%/96%. The Radar **Launch** is the same seam as §3 (`POST /experiment/launch`).

---

## 5. The guided demo — 15 beats (FROM → TO) + Compare
The Demo Director steps through 15 beats (Start ▶ → Next, or Auto-play). Each posts a **Signal → Segment → Decision** card to the Personalization Activity panel, with a **⤢ Compare before / now** split-slider of full-page screenshots (drag the seam, zoom Fit/1.5×/2.2×/3.2×) — on **every beat except #5** (#5 *is* the "before").

| # · capability | FROM → TO (what you see) |
|---|---|
| 1 · Customer profile (no sign-in) | no identity → anon vuid minted in Engine + welcome ribbon |
| 2 · Cold-start data | generic grid → confident catalog-affinity edit |
| 3 · Real-time updates | views Tabby ×3 → hero reshapes **live, no reload** (generic → Tabby) |
| 4 · Recommendations | "best-sellers (same for all)" → her specific product picks |
| 5 · Sort rules · Baseline *(the control; no Compare)* | home → standard rule-based PLP order |
| 6 · Personalized sort | same PLP **re-ranks (FLIP)** → her favorites rise |
| 7 · Page structure | PDP gallery-only → **"Complete the Look" module assembles** |
| 8 · Page content | generic hero copy/image → Tabby copy/image (same layout) |
| 9 · Journey-stage | adds bag → "ready-to-buy" tone **+ fires the buy-signal → BNPL surface** (see below) |
| 10 · Opal audience builder | plain-English prompt → **real audience published**, banner can go live |
| 11 · A/B testing | **email-vs-phone surface** renders live + A/B readout |
| 12 · MAB | **4 hero creatives** surface + traffic auto-allocates |
| 13 · CMAB | **different offer per context** surface + per-context winners (anti-DY) |
| 14 · AI search | NL "bags for a winter wedding" → ranked real catalog + **AI-styled Edit** |
| 15 · AI Style Concierge | styling question → on-brand reply + styled look + **real catalog picks** |

**Buy-signal (acts on intent we used to ignore):** the first **add-to-cart** (incl. beat 9) fires the **Pay-over-time (BNPL)** experiment surface + a "BUY SIGNAL · READY-TO-BUY → pay-over-time experiment" Activity card.

---

## 6. Other surfaces
- **Cold-start / geo** (on load): edge geo → season hero + welcome ribbon. **⌘K → "Preview as location"** = Miami/Sydney/Chicago/Singapore (the **hemisphere flip**: same date, Miami summer vs Sydney winter).
- **Style quiz**: welcome-ribbon "Personalize in 30s" → 4 taps → "Your Edit" (zero-party).
- **Personalized banner** (`#pz-banner`): Opal-created message; **⌘K → "Preview as audience"** forces any.
- **Personalization Activity panel**: the movable provenance log (minimizes to a pill) — every decision lands here; the **Compare** button lives on its cards.
- **Engine tab**: the A/B/MAB/CMAB readouts (illustrative figures).

---

## 7. Presenter gotchas
1. **Write-gate:** set `OPTIMIZELY_WRITE_ENABLED='true'` + token **before** a live-write demo, or write tools return only a plan ("stubbed").
2. **stubbed ≠ simulated:** with writes off, audiences/flags/banners render **nothing** live; **experiments still render** the surface + readout (representative). So experiments demo even with writes off.
3. **Datafile lag (~20-30s):** a new flag is live in FX instantly but the storefront SDK serves it after the datafile regenerates. The surface pre-renders the creative immediately while it catches up — don't expect the storefront to flip on the dot.
4. **CMAB** may be created as a **draft** (`enabled:false`) pending review — that's expected; the rule is real + pullable in the UI.
5. **Fallback:** if a typed rule is rejected, `launchExperiment` falls back to a targeted-delivery rule (`fellBack:true`) — check before claiming "A/B is live."
6. **Reset** between runs (Radar ↺ / Director Restart) clears the surface, buy-signal, and funnel sim.

---

## 8. Doc map — what to use for THIS demo

> ⚠️ **This repo is a base/template for several demos.** Docs that aren't about Coach/Tapestry (e.g. the banking / "First National Bank" demo) are **NOT superseded or dead** — they belong to *other* demos that share this base. Leave them in place; just use the **USE** list below when running the Coach/Tapestry demo.

**USE (this demo, current):** this playbook · `PROJECT_LEDGER.md` (build log/SoT) · `EXPERIMENT-SURFACE-RUNBOOK.md` · `EXPERIMENT-USE-CASES.md` · `opal-question-catalog.md` · `search-query-catalog.md` · `REVENUE-RADAR-{TDD,PRESENTER-GUIDE,EXPLAINER}.md` · `Tapestry-Coach-North-Star-Brief.md` · `MEMO-ab-cmab-handoff.md`.
**REFERENCE only:** `examples/*` (vendor REST + agent cheat-sheets), `docs/architecture/*MCP*`.
**OTHER DEMOS / SHARED BASE (not this demo — leave in place, don't delete):** `DEMO_EXPLANATION.md`, `SOLUTIONS_ARCHITECT_GUIDE.md`, `OPTIMIZELY_SETUP.md`, `optimizely-feature-config.md`, `optimizely-setup-instructions.md`, `_context_recovery.md`, `README.md`, `notes.md`, and parts of `docs/architecture/0*` + `docs/{guides,api,integration,components}/*` describe another demo and/or the shared base — out of scope here, but valid.
**DRAFT — this demo's planning (rationale only, not as-built):** `EXPERIMENT-SURFACE-PLAN.md`, `MEMO-parallel-build.md`, `docs/architecture/05-12`.

_Corrections folded in: BNPL = the **$595 Rogue** (not "$575 Tabby"); beats 11–13 = **real surface + real flag, illustrative readout numbers**; operator routes are **plural** `/operator/audiences/{suggest,publish}`._
