# Revenue Radar — Plain-English Explainer & Runbook

**Read this first if you've never seen the demo.** It explains, in plain language: what we built, why it matters, exactly what's real vs. faked, how to run it, and where everything lives. Written so anyone — sales, SE, exec — can pick it up cold.

_Last updated: 2026-06-26 · Demo: Mon 2026-06-29 (Tapestry experimentation team) · Live at https://edge-platform.expedge.workers.dev/storefront_

---

## 1. What it is (in one breath)

**Revenue Radar is an AI copilot that finds where a store is losing checkout money, and lets any team member fix it in one click — then proves the fix worked.** It runs on a live Coach storefront. You ask "where are we losing Gen-Z checkout revenue?", it shows you the leak with a dollar figure, recommends a fix, and when you click **Launch** it creates a **real Optimizely experiment** and the storefront visibly changes for those shoppers. Diagnose → recommend → activate → prove, in one conversation, no engineer, no analyst.

That full loop is the thing the competitor (Dynamic Yield) structurally cannot do.

---

## 2. Why it exists (the sales story)

- **The customer:** Tapestry — the parent of **Coach, Kate Spade, and Stuart Weitzman**. Their goal right now: **capture the Gen-Z market.**
- **The competitor:** Dynamic Yield pitches personalization powered by "Mastercard predictive data." In reality that's **geo-aggregate** data — *"shoppers in this zip code spend ~$420 on average."* It has **no idea what any individual person actually did.**
- **Our wedge:** real **first-party, individual, in-session behavior**, decided at the **edge (<50ms)**, run through a **closed loop any business user can drive.** We personalize a *person*; they personalize a *postal code*.
- **Monday's audience:** Tapestry's **experimentation & personalization team** (they own conversion + the cart/checkout experience). They run experiments for a living — so the demo leans into *real* experiments and a *pokeable* funnel, not hand-waving.

---

## 3. The demo — what you SEE and DO

Open `https://edge-platform.expedge.workers.dev/storefront`, open the **Demo Director** sidebar (right edge), click the **Radar** tab. Then either drive it manually or hit **▶ Play story** to auto-run it.

**The manual walkthrough (≈90 seconds):**

1. **Radar tab, brand = Coach, cohort = All.** The funnel looks healthy — nothing jumps out. *"Across Coach, checkout looks fine."*
2. **Click the Gen-Z cohort pill.** The truth appears: the **Payment → Purchase** step collapses **44%**, flagged red, **$7,623 recoverable**, *"gen_z 1.5× the drop."* → *"Filter to Gen-Z and a big leak appears that the average hid."*
3. **Click "◑ DY vs us"** → the **Neighborhood vs Shopper** card: DY sees *"ZIP 33139 · ~$420 avg"*; we see *this* shopper — Tabby ×3, $575 bag added, 40s stall at payment, Gen-Z BNPL cohort, bailed on shipping twice. → *"DY knows the neighborhood. We know the shopper."*
4. **Click "Simulate drop-off."** Synthetic Gen-Z shoppers pour in and abandon at payment — the leak **swells live to 81% / $61.7k** (bars animate). → *"And it's happening at scale right now."*
5. **On the BNPL recommendation card, click "⚡ Launch experiment."** → *"⚡ Experiment live — 563864 · control vs bnpl · +48% lift · 96% conf."* A **real Optimizely experiment** is created, and the funnel **recovers** on screen.
6. **Go to the storefront, add a Tabby bag, click Checkout.** The payment step now shows the **"Pay in 4 with Tabby — $143.75 × 4 · 0% APR"** save + social proof (before the launch it was a plain card form). → *"The fix is live for that shopper, in-session."*

**The kicker line:** *"Diagnose, decide, activate, measure — one conversation, no engineer, no analyst, live at the edge, across all three brands."*

**You can also drive it from Opal chat** (the Opal tab): type *"Where are we losing the most checkout revenue for Gen-Z?"* — Opal runs the same diagnosis and answers in plain English with the leak, the dollars, and the BNPL recommendation.

**The other two brands** (Kate Spade, Stuart Weitzman) are in the brand selector and have their own signature leaks — Kate Spade leaks at the cart step, Stuart Weitzman at shipping — so you can show the parent-level multi-brand story.

---

## 4. What's REAL vs REPRESENTATIVE (say this if asked — it builds trust)

| Piece | Real or representative? |
|---|---|
| The audience (e.g. "Gen-Z BNPL Hesitators") | **Real** — created in Optimizely |
| The experiment you Launch (e.g. id 563864) | **Real** — a live Optimizely experiment object you can open in the Optimizely UI |
| The in-session personalization (the BNPL save) | **Real** — decided + rendered at the edge |
| The edge decisioning, the storefront, Opal | **Real** |
| The **funnel numbers / traffic volumes** | **Representative synthetic** — our own tuned dataset ("owned data"), so it's stable and we control the story |
| The **lift figure** (+48%) | **Representative** — labeled illustrative; the measurement apparatus is real, the number is demo data until it runs on Tapestry's real site |

**The line we never cross:** we never claim these are Tapestry's real production numbers. If someone asks "is this simulated?" the confident answer is *"the traffic is representative; the audience, experiment, and personalization are real — here's the experiment in Optimizely."*

**Why we own the data (not the analytics team's):** their product is mid-upgrade and we can't guarantee its stability for a high-stakes demo. Owning a synthetic-but-realistic dataset means the demo is rock-solid and we control exactly which story the numbers tell.

---

## 5. What exists under the hood (the moving parts, explained simply)

**The data (in our Cloudflare D1 database):**
- `funnel_seed` — the baseline "representative day" funnel: per brand × cohort × stage session counts, hand-tuned so the leaks tell the story. This is the stable backbone.
- `funnel_live` — a scratch overlay the **simulator** writes to (ambient traffic + the "Simulate drop-off" bursts). Wiped by Reset; never touches the seed.
- `demo_events` — **real** events captured as people use the store, including the checkout steps. The funnel adds these on top (for Coach).
- `v_audience_base` — 3,200 customer profiles (historical + live) that **Opal** queries to build audiences.

**The endpoints (the "API" behind it):**
- `GET /funnel?brand=&cohort=` → the funnel: every stage, the leaks, the recoverable dollars. (Leak severity is **anomaly-based** — a *normal* drop doesn't flag; only a drop *worse than expected* does, which is why Gen-Z's payment step lights up but the routine steps don't.)
- `GET /funnel/diagnose?brand=&cohort=` → the ranked **recommendations** (the audience + the remedy + the experiment to launch). Same logic Opal's `diagnoseFunnel` tool uses.
- `POST /funnel/event` → records a real checkout step (begin_checkout / shipping / payment / purchase) into `demo_events`.
- `POST /funnel/sim/{tick,burst,reset}` → the **traffic simulator**: `tick` = ambient trickle, `burst` = the "Simulate drop-off / Recover" amplify, `reset` = clear the overlay.
- `POST /experiment/launch` → **the cross-team seam.** Built by the A/B+CMAB engineer; our Launch button calls it; it creates the **real Optimizely experiment** and returns the lift readout.
- `POST /operator/events/reset` → wipes `demo_events` (the pre-demo clean-up). Historical data is never touched.

**The screens:**
- **Radar tab** (sidebar) — the funnel chart, brand + cohort selectors, the demo controls, the recommendation cards with **Launch**.
- **Checkout overlay** — the real Shipping → Payment → Done flow; the payment step is where the **BNPL save** appears after Launch.
- **Neighborhood vs Shopper** modal — the anti-DY contrast.
- **Opal chat** (Opal tab) — the conversational way to run the same diagnosis.

**The files (where to look):**
- `public/revenue-radar.js` — the **entire client**: the Radar tab, the live-motion controls, the Play story, the contrast modal, and the checkout. (Self-contained; attaches to the storefront, doesn't touch the A/B+CMAB code.)
- `src/services/funnel/contract.ts` — the shared definitions (brands, cohorts, stages, types).
- `src/services/funnel/compute.ts` — the funnel math + anomaly leak scoring.
- `src/services/funnel/diagnose.ts` — turns a leak into a launchable recommendation.
- `src/services/funnel/sim.ts` — the traffic simulator.
- `src/routes/funnel.ts` — all the `/funnel*` endpoints.
- `src/agents/tools/diagnoseFunnel.ts` — the Opal tool (thin wrapper over `diagnose.ts`).
- `migrations/0003_funnel_seed.sql` + `scripts/seed-funnel.mjs` — the seed dataset + its generator.

---

## 6. How to run it (runbook)

**Before the demo — start clean (≈10s):**
```bash
B=https://edge-platform.expedge.workers.dev
curl -s -X POST "$B/operator/events/reset" -H 'content-type: application/json' -d '{"scope":"all"}'   # wipe captured events
curl -s -X POST "$B/funnel/sim/reset"       -H 'content-type: application/json' -d '{}'                # clear the sim overlay
```
After this, Coach·Gen-Z reads the clean baseline: **$7,623 recoverable, 44.3% payment leak.**

**The Radar panel controls (presenter buttons):**
- **Live traffic** — toggles the ambient stream (the shopper counter climbs, the funnel "breathes").
- **Simulate drop-off** — Gen-Z shoppers abandon at payment → the leak swells.
- **Recover** — they convert → the leak shrinks. (Launching the fix triggers this automatically.)
- **Reset** — clears the sim overlay back to the seed baseline.
- **▶ Play story** — auto-runs the whole narrated sequence hands-free.
- **◑ DY vs us** — opens the Neighborhood-vs-Shopper contrast.

**During the demo:** follow §3. Between takes, click **Reset** (and re-run the curl cleanup if you also did real checkouts).

**To prove the experiment is real:** open the Optimizely FX UI and show the experiment that Launch created (the id shown in the green "Experiment live" box, e.g. 563864).

---

## 7. How it was built (context)

Revenue Radar was built **in parallel** with a separate A/B + CMAB workstream (the Engine-tab readouts + the experiment engine). The two streams shared one rule: substantial work lives in its own files; they meet at exactly one function — `POST /experiment/launch`. The handover contract is in `docs/MEMO-parallel-build.md`. The Revenue Radar foundation (data, compute, simulator, Opal tool) was built by four parallel max-reasoning sub-agents against a shared contract, then integrated and screenshot-verified on prod at each step. Full build log: `docs/REVENUE-RADAR-TDD.md`.

---

## 8. FAQ / troubleshooting

- **"Is any of this real?"** → Yes — the audience, the experiment, and the personalization are real Optimizely objects/decisions. The traffic numbers are representative synthetic (our owned dataset). See §4.
- **"The funnel numbers look wrong / inflated."** → Someone left the simulator running or did real checkouts. Click **Reset** and/or run the §6 cleanup curl. Clean baseline = Coach·Gen-Z $7,623.
- **"The BNPL save isn't showing in checkout."** → It only appears *after* you Launch the BNPL fix (or set `store._rrBnplLive = true` in the console). Before that, the payment step is a plain card form — that's the "before" state on purpose.
- **"Where's the experiment?"** → In the Optimizely FX UI; the id is in the green Launch confirmation. The readout link points to the Engine tab.
- **"Can I show the other brands?"** → Yes — the brand selector (Coach / Kate Spade / Stuart Weitzman). Each has its own signature leak.
- **"Opal didn't call the funnel tool."** → Ask explicitly about checkout/funnel/revenue (e.g. "where are we losing Gen-Z checkout revenue?"); that triggers `diagnoseFunnel`.
