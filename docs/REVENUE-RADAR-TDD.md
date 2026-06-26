# Revenue Radar — Technical Design & Build Ledger

**Working title:** _Opal Revenue Radar_ — the diagnose → decide → activate → prove loop for the checkout funnel.
**This is the build source of truth for this feature.** Update every task: `[x]` done · `[~]` in progress · `[ ]` pending · `[!]` blocked on user. Pair with `docs/PROJECT_LEDGER.md` (high-level).

_Created: 2026-06-26 · Demo: **Mon 2026-06-29** · Owner: SA_

---

## 0. Why this exists (the point)

**Customer's real objective:** capture the **Gen Z** market.

**Dynamic Yield's pitch and its hole:** DY claims its **Mastercard predictive data** powers personalization. In reality it's **geo-aggregate** — *"shoppers in this postal code spend ~$X on average."* It has **no individual purchase or behavioral context** — it doesn't know what any one person actually bought or is doing right now.

**Our wedge:** real **first-party, individual, in-session behavior** decided at the **edge (<50ms)**, run through a closed loop **any team member** can drive — no engineers, no analysts, no waiting for a batch.

**One line:** _"From a business question to a live, measured revenue fix — in one conversation — and Dynamic Yield structurally cannot do it."_

**The slogan beat:** **"Dynamic Yield knows the neighborhood. Optimizely knows the shopper."**

---

## 1. Monday audience → framing rules

Presenting to the **experimentation & personalization team** (owns SEO/conversion + the checkout/cart experience). Implications baked into every beat:

- **The experiment must be real** — they will not forgive fake numbers. We create a real Optimizely audience + experiment via API (already working); lift figures are clearly labeled representative.
- **The funnel must be real and pokeable** — drop-off computed from actual events, reacting live to the demo.
- **Velocity is the pain we relieve** — "ship a real experiment from a sentence, no dev/analyst ticket." Frame as **empowering them**, not replacing them.
- **Segmentation depth** — show individual behavioral signals, not cohort averages (the anti-DY point).

---

## 2. The money metric (everything ladders to this)

**Headline:** _Recoverable checkout revenue_ (per year and/or per 1,000 sessions).
**Mechanism:** checkout **completion-rate lift** on the hero segment.
_(Decision [!]: confirm label — see §9.)_

---

## 3. The hero fix

**Gen-Z, high-intent shopper hesitating at payment on a high-AOV item ($575 Tabby) → surface installments (BNPL) + light social proof, in-session at the edge → recover the sale.**

- BNPL is the Gen-Z checkout lever; **Tabby BNPL is already in the seeded data**.
- Trigger is **individual behavioral context** (viewed Tabby ×3, added $575 quilted, stalled at payment, Gen-Z BNPL-affinity cohort) — the thing DY's geo data cannot do.

---

## 4. Competitive centerpiece — "Neighborhood vs Shopper"

A side-by-side beat:

| Dynamic Yield sees | Optimizely sees |
|---|---|
| Postal code → *"avg spend ~$420"* | *This* shopper, live: Tabby ×3 · added $575 quilted · 40s stall at payment · Gen-Z BNPL cohort · bailed on shipping ×2 |
| Third-party, aggregate, static | First-party, individual, in-session, edge |

Then the fix fires on the **person**. _(Decision [!]: explicit head-to-head vs softer "first-party vs third-party" framing — see §9.)_

---

## 5. Demo choreography (acts)

0. **Cold open — the leak.** The live multi-brand funnel: *"Here's where Tapestry loses checkout revenue right now."*
1. **The question.** A team member asks Opal: *"Where are we losing Gen-Z checkout revenue?"* → Opal diagnoses with evidence (drop-off + dollars).
2. **The recommendation.** Opal proposes the Gen-Z BNPL-hesitator audience + the fix, ranked by recoverable $.
3. **Neighborhood vs Shopper.** The contrast beat (§4).
4. **One click, no developer.** Launch → real audience + experiment + edge personalization.
5. **Proof, live.** Storefront in-session save (BNPL + social proof) at the edge → the funnel leak **shrinks live** → Engine tab shows the experiment + representative lift. Loop closed.
   - **Kicker:** _"Diagnose, decide, activate, measure — one conversation, no engineer, no analyst, live at the edge, across all three brands."_

---

## 6. Architecture & data model

**Data = seed + live, sculptable (the core mechanic the SA specified):**

- **Seed layer (persistent baseline):** a per-brand funnel dataset (Coach + Kate Spade + Stuart Weitzman) with stage counts + dimensions (`traffic_source`, `device`, AOV band, **Gen-Z cohort**, BNPL-affinity), hand-tuned so the leaks read cleanly. Lives in D1; survives demo resets.
- **Live layer (accumulates):** the demo's own clicks land in `demo_events` (already captured). **Funnel = seed + live**, so it **moves as we navigate** (abandon → leak grows; fix → leak shrinks).
- **Sculptable per demoed shopper:** the active persona (reuse `forceGeo`/cold-start machinery) sets the cohort slice Opal diagnoses and the storefront renders — so "whatever user is being demoed" shapes the numbers.

**New/changed pieces:**

- **Checkout funnel UI:** `begin_checkout → shipping → payment → purchase` steps (synthetic but believable, luxury-styled), each emitting a GA4-shaped event (`begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`) into `demo_events`.
- **Funnel compute endpoint:** computes stage-over-stage drop-off from seed + live, filterable by brand/persona.
- **Opal `diagnoseFunnel` capability:** genuinely reads the data, computes the biggest $-weighted leaks, proposes audiences (honest: Opal really did the math).
- **Activation = reuse what's real:** `createOptimizelyAudience` / `createFlag` / experiment + edge personalization (already built).

**Traffic Simulator (makes the motion meaningful) — server-side, emits synthetic sessions into `demo_events`; funnel computes honestly from them. Three layers:**

1. **Baseline seed** — ~3,000 sessions/brand pre-loaded → stable funnel shape + obvious leak from second one.
2. **Ambient stream** — ~20–40 sessions/sec trickle → shopper counter climbs, funnel breathes (feels like a live console).
3. **Amplify-on-action** — presenter's hero move injects a **matching cohort**: abandon at payment → leak swells ("others like me right now"); launch fix → treatment cohort converts → leak recovers + recoverable-$ ticks up. Ties the individual to the aggregate.

**Volume/motion targets:** action-burst ~500–1,500 matching sessions over 5–10s visibly bends a stage bar. Show the **lift on the cohort/experiment readout** (control vs treatment), not the global funnel — the persona-filtered slice moves cleanly from a few hundred sessions (e.g. payment→purchase ~62% → ~73%). **Honesty:** presented as "representative traffic," never Tapestry production traffic; the generator is shown on request.

---

## 7. Honesty tiers

- **Real:** funnel computed from real (seed + live) data; audience/experiment creation via API; edge personalization; the in-session save.
- **Representative (labeled):** lift figures; DY's geo numbers are illustrative of their *approach*, not scraped from DY.
- **Will not cross:** claiming proven lift on Tapestry's real production traffic.

---

## 8. Task checklist (mark every task)

**Phase 0 — Design sign-off**
- [x] Vision + "go bigger" scope agreed
- [x] Hero fix (Gen-Z BNPL) confirmed (SA deferred the call to me; no objection)
- [x] Brand depth decided — Coach full checkout + KS/SW in the brand selector
- [x] Anti-DY beat tone decided — pointed but confident ("Neighborhood vs Shopper")
- [x] Opal vehicle confirmed — extend the EXISTING Opal agent with a `diagnoseFunnel` tool (not a new chat)

**Phase 1 — Data & funnel foundation**
- [x] Shared funnel contract — `src/services/funnel/contract.ts` (stages, brands, cohorts, types, table spec, AOV, baseline conv)
- [x] Seed funnel dataset — `migrations/0003_funnel_seed.sql` + `scripts/seed-funnel.mjs` (72 rows; Coach·gen_z payment→purchase **55.7%** hero leak, KS cart-persistence, SW shipping). Validated on local D1.
- [x] `demo_events` event types — no schema change needed (free-form `event_type`; client emits in Phase 2)
- [x] Funnel compute endpoint — `src/services/funnel/compute.ts` + `src/routes/funnel.ts` (anomaly/excess-over-baseline severity; defensive). _Mount + remote D1 apply at integration._
- [x] Traffic Simulator — `src/services/funnel/sim.ts` + `src/routes/funnelSim.ts` (`/tick` ambient, `/burst` amplify-on-action, `/reset`). Verified on prod: burst swelled Coach·gen_z payment leak 44%→79%.
- [x] `diagnoseFunnel` Opal tool — `src/agents/tools/diagnoseFunnel.ts`, registered in `OpalAgent.ts` (+ system-prompt section).
- [x] **INTEGRATION + DEPLOY** — `/funnel`, `/funnel/sim` mounted; migration applied to remote D1 (72 rows); tsc-clean; deployed. **Opal end-to-end VERIFIED on prod via `/__shot`:** asked "where are we losing Gen-Z checkout revenue?" → Opal called `diagnoseFunnel` → returned the payment→purchase leak (44.3%, 1.5× skew, **$7,623 recoverable**) + the **Gen-Z BNPL Hesitators** audience + BNPL remedy + experiment. 🎉 Phase 1 COMPLETE.

**Phase 2 — Checkout funnel UI** — ✅ done (real multi-step checkout in `revenue-radar.js`, overrides `beginCheckout`)
- [x] `begin_checkout` (on open) · Shipping step (+`add_shipping_info`) · Payment step (+`add_payment_info`) · Place order (+`purchase`)
- [x] Events written to `demo_events` via new `POST /funnel/event` (the `/realtime/action` enum doesn't allow checkout types). **Verified on prod:** begin_checkout/add_shipping_info/add_payment_info captured (distinct sessions); funnel counts them for Coach.
- [x] Abandonment = close overlay → no further events → the session stays at its last stage in the funnel.

**Phase 3 — Opal diagnosis + viz**
- [x] `diagnoseFunnel` Opal tool (done in Phase 1)
- [x] Funnel viz component — `public/revenue-radar.js` + Radar tab (multi-brand + cohort selector, anomaly-highlighted leaks). Verified on prod: Coach·Gen-Z payment leak 44.3% / $7,623 / 1.5× skew renders.
- [x] Recommendation cards + **Launch** → `GET /funnel/diagnose` (shared `src/services/funnel/diagnose.ts`, also feeds the Opal tool) + `POST /experiment/launch`. **Verified on prod:** BNPL card → Launch → **real Optimizely experiment 563864** · +48% lift · 96% conf. 🎉 Closed loop works in the panel (and in Opal chat).

**Phase 4 — Hero fix + contrast**
- [x] Gen-Z BNPL hesitation save (in-session) — the checkout payment step shows "Pay in 4 with Tabby · $143.75 × 4 · 0% APR" + social proof, gated on `_rrBnplLive` (set by Launch). **Verified on prod:** before = plain card form (hesitation); after Launch = the BNPL save. The visible in-session fix.
- [x] "Neighborhood vs Shopper" contrast — full-viewport modal (◑ DY vs us in the Radar panel). Verified on prod: the anti-DY centerpiece ("Mastercard geo · ZIP avg $420" vs "this shopper: Tabby ×3, $575 added, 40s payment stall, Gen-Z BNPL cohort").
- [x] Experiment lift readout — Launch returns +48% lift / 96% conf inline (panel) + `readoutUrl` → Engine tab (A/B+CMAB zone).

**Phase 5 — Choreography & verification**
- [x] Live-funnel-reacts mechanic verified end-to-end — "Simulate drop-off" swelled Coach·gen_z payment 44%→81% / $7.6k→$61.7k, "Recover" + auto-recover-on-launch shrink it; in-place animated bars/numbers/headline.
- [x] Guided beat — **▶ Play story** in the Radar panel (self-driving reset→all→gen_z→simulate→Opal fix→Launch→recover, narrated). Verified on prod. _(Standalone in the Radar panel, not inserted into the 15-beat array — avoids count surgery; presenter can also drive manually via the controls.)_
- [x] `/__shot` screenshot verification of every new surface — funnel viz, recos, Launch (real exp 563864), live motion, Play story, contrast modal, checkout (both BNPL states). ALL verified on prod.
- [~] `PROJECT_LEDGER.md` updated + this ledger marked complete

---

## ✅ STATUS: Revenue Radar COMPLETE (all phases) — built + screenshot-verified on prod, 2026-06-26.
Closed loop end-to-end (panel + Opal chat): diagnose funnel → recommend fix → Launch real Optimizely experiment → in-session BNPL save + funnel recovers. Anti-DY "Neighborhood vs Shopper" + self-driving "Play story" + real multi-brand funnel. Cross-team seam (`launchExperiment`) integrated. **Uncommitted** (per "commit only when asked").

---

## 9. Decisions (resolved 2026-06-26)

- [x] **Brand depth:** Coach = full clickable checkout; **Kate Spade + Stuart Weitzman = funnels in the brand selector** (seed-level). Must visibly identify all three brands on screen.
- [x] **Anti-DY tone:** explicit **"Neighborhood vs Shopper"** head-to-head — pointed but confident.
- [x] **Money-metric label:** **"recoverable checkout revenue"** (revisit if the team frames it differently).

## 11. Parallel-work plan (two streams, no collisions)

Revenue Radar (Claude) and A/B+CMAB (other engineer) run in parallel. Principle: **substantial work lives in new exclusively-owned files; the shared monolith takes only additive hook-points; the two meet at one defined seam.**

**Ownership:**
- _Revenue Radar (me):_ `migrations/000X_funnel_seed.sql`, `src/routes/funnel.ts`, `src/services/funnelCompute.ts`, `src/services/funnelSim.ts`, `src/agents/tools/diagnoseFunnel.ts`, **new `public/revenue-radar.js`** (checkout + funnel viz + BNPL + simulator client).
- _A/B+CMAB (them):_ CMAB decision service, experiment creation, their migration(s), Engine-tab readouts in `storefront.js`, `src/agents/tools/experiment*.ts`.

**Shared-file protocols:**
1. **`storefront.{js,html}` — extract, don't edit.** My client code attaches to `window.store` from `revenue-radar.js`; `storefront.js` gets ~5–10 additive hook lines (load script · checkout button · register beats in a fenced `/* REVENUE RADAR BEATS */` block · funnel tab). Their work stays in the **Engine-tab zone**. Nobody edits the other's fenced region.
2. **`OpalAgent.ts` — one tool per file** under `src/agents/tools/`; the agent imports + registers (additive lines only).
3. **`src/index.ts`** route mounts are append-only (trivial merge). `wrangler.toml`/`package.json` coordinated in chat.
4. **Branches/worktrees:** `feature/revenue-radar` (worktree) + `feature/ab-cmab`; daily integration merge, **contract seams first**.

**The one integration seam:** my Opal "Launch" calls their engine —
`launchExperiment({ audienceId, variations, metric }) → { experimentId, readoutUrl }`.
Both build to this signature blind; it composes at merge.

**Blocked-on-other-engineer [!]:** (a) their `launchExperiment` signature; (b) the `demo_events` `event_type` names they emit (I claim `add_shipping_info`/`add_payment_info`/`purchase`/`checkout_*`).

---

## 10. How the loop stays IMPACTFUL (not just a chart)

The funnel measures the **same storefront on screen**, and the fix runs on **that same storefront** — so diagnosis, action, and proof are one connected live loop, not three disconnected screens. The conversation with Opal ends in **real artifacts + visible change**, never a slide:

1. Opal's recommendation carries a **Launch** button → creates a **real Optimizely audience + experiment + flag** via API.
2. The **storefront reshapes in-session** for that segment (the Gen-Z BNPL save) at the edge.
3. The **funnel moves** — keep shopping and the leak **shrinks on the chart Opal just drew** (loop visibly closes). _Design note: weight recent/live events or show the persona-filtered slice so a few demo clicks are perceptibly visible against the seed baseline._
4. **Proof:** pull up the real Optimizely UI and show the audience/experiment Opal just created — "not a mockup."
5. **Measurement:** Engine tab shows it as A/B → MAB with representative lift.
6. **Takeaway (optional):** Opal generates a shareable "leak → fix → projected recoverable revenue" summary.
