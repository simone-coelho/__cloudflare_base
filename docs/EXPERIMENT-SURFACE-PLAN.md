# Experiment Surface — Build Plan ("Opal dictates → launches → comes to life")

_Consolidated from 3 max-reasoning planning agents (placement · component · wiring). Goal: a single self-contained, prominent banner/hero that hosts many variations purely via data, driven by a real Optimizely experiment, with real events — results narrated by the SA (no "fake" UI labels)._

## The key insight (why this is cheaper than it sounds)
**The North Star loop already exists for one surface — `#pz-banner`:** Opal → `opal:experience` → `previewAudience()` → real Optimizely decision via `POST /optimizely/preview` → `renderBanner()` (pure data, zero structural change). We **extend that proven path** to experiments instead of building new plumbing. And we act on the **unused buy signal**: `deriveStage()` computes ready-to-buy but only swaps two tiny text spans today — that's the headroom.

## 1. The component (one block, N variations via data)
A self-contained surface (extend `#pz-banner`, and/or a richer `#xsurf` hero) whose **only** per-variation changes are slot content + two attributes `data-layout` (hero|banner|card) and `data-theme` (noir|paper|sale|tan) — **no structural HTML change between variations**, matched to the existing luxury tokens (`--ink/--paper/--tan/--font-display`).
**Variation schema:** `{ key, name, layout, theme, image|productId, eyebrow, headline, subcopy, offer, ctaLabel, ctaAction(capture|navigate|addToCart), captureType(none|email|phone), successEvent }`.
Two ways to carry the creative (pick at build): (a) **client registry** keyed by `variant`, or (b) **server-driven** — add `headline/subcopy/cta/theme` (or a `payload` JSON) to the flag's variation variables so the datafile drives it. Recommend (b) for credibility (the copy lives in Optimizely).

## 2. Scenario registry (what to test — pick for Monday)
Real SKUs from `public/data/coach-catalog.json`. Each maps directly to `launchExperiment({type, variations, metric:{eventKey}})`.
- **S1 · A/B — First-order welcome:** "email → 15% off" vs "phone → 10% off". Primary event `lead_capture`. *Awe: learn whether customers trade email or phone, at what discount, before it hits the CRM.*
- **S2 · MAB — Hero creative bandit:** 4 non-discount creatives (editorial / best-seller / free charm / monogram), auto-optimized. Primary `add_to_cart`. *Awe: 4 ideas, 0 meetings; watch the loser starve hourly.*
- **S3 · CMAB — Context-aware welcome (the DY wedge):** different offer per `device/persona/journey_stage` (Gen-Z mobile drop vs returning VIP edit vs first-timer value). Primary `add_to_cart` (CMAB needs an event metric). *Awe: one experiment, a different winning offer per shopper — what DY's shopper-facing AI can't do.*
- **S4 · MAB — Move Brooklyn without a markdown:** sell a slow, non-Tabby line via the best story (craft / alt-to-Tabby / scarcity / styling), no discount. Primary `add_to_cart`. *Awe: sell-through without touching price — a merchandising lever, not a discount.*
- **S5 · A/B — Pay-in-4 on the $595 Rogue:** price-forward vs "pay over time". Primary `add_to_cart`. *Awe: quantify BNPL lift before integrating a provider.*

## 3. The loop (decide → render → force → track)
1. **Dictate in Opal** → `launchExperiment` tool → real `a/b`/`multi_armed_bandit`/`contextual_multi_armed_bandit` rule + custom-event metric (already built).
2. **Decide → render:** clone `previewAudience()` → `previewExperiment({experimentKey, variationKey, attributes})` → `POST /optimizely/preview` → `renderExperimentBanner()`.
3. **Force a specific arm (presenter control):** add `variationKey` to `/optimizely/preview` → `ctx.setForcedDecision({flagKey},{variationKey})` (SDK v5.3.4 confirmed). Expose via a new ⌘K mode "Preview as experiment variation" (lists `GET /experiment`).
4. **Buy-signal trigger:** fire the banner on `deriveStage()==='late'` (from `addToCart`/`renderCart`) and/or payment-stall (revenue-radar `rrcoToPayment` timeout).
5. **Track → metric:** new `trackOptimizely(eventKey, tags)` → `POST /optimizely/track` (exists) on click/capture/add-to-cart/purchase → **real conversions in Optimizely** + mirror to our Engine readout.
6. **Auto-preview the wow moment:** `launchExperiment` tool returns `{experimentKey, variations, firstVariationKey, metricEventKey}` → `island/opal-chat.tsx` dispatches `opal:experiment` → storefront auto-renders variation 1.

## 4. Build order for Mon 2026-06-29 (all additive)
**Must-have (smallest path to the demo moment):**
1. `src/routes/optimizely.ts` — `/optimizely/preview` accepts `variationKey` → `setForcedDecision` (~3 lines).
2. `src/services/experimentFx.ts` + `experimentRun.ts` — variations carry `headline/subcopy/cta/theme` (+ sensible defaults).
3. `public/storefront.js` — `previewExperiment()` + `renderExperimentBanner()` (reuse `#pz-banner` first) + read `?experiment=` in `init()` + `clearForcedExperiment()`.
4. `public/storefront.js` — ⌘K "experiment variation" mode (uses `GET /experiment`).
5. `src/agents/tools/experimentTools.ts` richer return + `island/opal-chat.tsx` `opal:experiment` dispatch + storefront listener.
→ **Demo moment:** "Opal, launch an A/B test of three hero banners measuring add-to-cart" → real flag created → banner swaps to variation 1 live → ⌘K flips through 2 & 3 in the room.

**Nice-to-have (priority order):** 6. `trackOptimizely` real conversions · 7. Engine readout from `GET /experiment/:key/readout` · 8. richer `#xsurf` hero card · 9. one-shot targeting (`launchExperiment` creates the audience from `conditions`) · 10. CMAB context demo (⌘K passes `device/persona/journey_stage`).

**Do NOT:** add the experiment flag to `CATALOG_FLAG_KEYS` (entangles the mock engine); add "this is fake" labels; rely on live bandit lift numbers (representative, SA-narrated).

## 5. Honesty seam (state it plainly to the room — not in the UI)
- **Real:** the experiment artifact (flag/rule/metric), the variation the shopper sees (forced decision), and the **conversion events** tracked to Optimizely.
- **Representative:** the lift/allocation numbers — `/optimizely/preview` uses a no-op event dispatcher + `DISABLE_DECISION_EVENT`, so impressions aren't logged and live reallocation isn't statistically real in a demo window. The SA explains this verbally.

## 6. Files
`public/storefront.{js,html}` · `src/routes/optimizely.ts` · `src/services/experimentFx.ts` · `src/services/experimentRun.ts` · `src/agents/tools/experimentTools.ts` · `src/agents/OpalAgent.ts` (one prompt line: create audience before a targeted launch) · `island/opal-chat.tsx`. No change to `DecisionProvider.ts`, `routes/experiment.ts`, `OptimizelyService.ts` (track already present). Config: real artifacts need `OPTIMIZELY_WRITE_ENABLED='true'`; otherwise it runs simulated and the render/force/track path still works.
