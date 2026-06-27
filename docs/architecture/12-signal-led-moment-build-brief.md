# 12 — Signal-Led Moment: Build Brief (DECIDED — the as-built target)

**Status:** APPROVED design, ready to build. This is the **authoritative, persisted context** for the "TikTok Signal-Led Moment" encore — written so a build agent (or a future session after context loss) can execute it without missing the mark.
**Supersedes:** the *Phase-0 mechanics* of [`./11-signal-led-stretch-plan.md`](./11-signal-led-stretch-plan.md) (that plan predates the experiment-surface architecture). Doc 11 remains the **rationale + honesty source**; build against THIS doc.
**Source of the use case:** [`./comprend_signal_led_brief.md`](./comprend_signal_led_brief.md) (the Comprend "Product-Led → Signal-Led" POV deck).
**Reconciliation that informed it:** see §6 (current-code mapping); the experiment-surface path already does SERVE + OPTIMIZE + real-MAB-rule, so this is mostly *reuse + a new scenario + a real generated hero*, not new plumbing.

---

## 0. The North Star — what we are proving

Coach's incumbent (Dynamic Yield) personalizes off **stored profiles/segments** — a postal-code average. The Signal-Led counter-argument: **Gen-Z is won by reacting to a real-time cultural signal** (a bag blowing up on TikTok) and standing up a tailored, optimized experience **fast enough to catch a window that closes in ~30 minutes.** No human team is that fast — the AI must detect → generate → serve → optimize inside the window.

**One-sentence proof:** *"Optimizely + Opal can take a live external signal and, right in front of you, **generate a real hero (real bag, AI-generated scene) and real copy**, deliver them as **feature variables** into a real experiment, push it live, and let a bandit optimize to the winner — before the window closes — while being honest that only the signal detection is a mocked partner layer."*

This is the "Coach said no last time" rebuttal made literal. It is an **encore**, not part of Coach's 15-beat RFP checklist.

---

## 1. LOCKED DECISIONS (read this first — every choice we made)

| # | Decision | Locked choice | Notes |
|---|---|---|---|
| 1 | **Signal to feature** | **TikTok velocity** — Coach **Tabby** (`COA-CH857`) spiking in NY | The deck's hero; a real Coach phenomenon; carries the 30-min window |
| 2 | **DETECT (signal source)** | **Mocked** — fixture standing in for a partner social-listening layer | Badged on-screen; the ONLY mocked stage. Feed the *real* `/geo` region in as a genuine tell |
| 3 | **GENERATE — copy** | **Real** — Opal/Gemini writes the copy (eyebrow/headline/offer/CTA). Presenter may also **dictate**; deterministic canned fallback for stage safety | "Opal suggests OR the user says" — both supported |
| 4 | **GENERATE — image** | **Real** — reuse `/ai/scene` (Gemini 3.1 Flash Image "nano banana") to composite the **real Tabby photo** into a generated cinematic hero scene | The scene prompt already leaves headline negative space + bakes NO text |
| 5 | **Image latency** | **Live generation (~8s) shown HONESTLY** with progress feedback. **No faking.** | User: *"I'd rather have something realistic than something false… make sure we provide honest feedback so the user doesn't think it got stuck."* Pre-warm allowed ONLY as an R2 cache; the real generation must be demonstrable |
| 6 | **Delivery** | **Discrete, named feature variables** (`hero_image`, `headline`, `eyebrow`, `offer`, `cta_label`, `theme`, `layout`, …) | User: *"break it into structured payload variables… so if we show it in the UI, it can visually make sense."* Keep the existing `payload` too (back-compat for the other 5 scenarios) |
| 7 | **No HTML, ever** | The **module is ours**; only the **values** (image URL + copy + settings) are generated and flow through the variables | Opal/MCP cannot author HTML — this is honest AND the real Optimizely model |
| 8 | **SERVE surface** | A **distinct full-bleed "takeover" hero** (the climax), reusing the `#xsurf` wiring (real launch, tracking) | More dramatic than the beats-11–13 banner; this is the awe moment |
| 9 | **OPTIMIZE** | **Real `multi_armed_bandit` rule created** (token-gated, via existing `launchExperiment`) **+ representative convergence animation** | Real rule = "genuinely creatable"; animation is representative because true convergence needs real traffic/time |
| 10 | **MEASURE** | **Representative** lift figures; presenter narrates; nothing in UI claims they're measured | Honesty tier held |
| 11 | **Encore placement** | **Button after beat 15** ("Show the Signal-Led Moment ▸") — core demo stays exactly 15 beats | Easily switchable to inline beats 16–18 if preferred; flagged as the one soft choice |
| 12 | **Window drama** | A live **countdown** (e.g. `28:00`) is the spine; the loop visibly **closes before zero** | The countdown is the one genuinely new UI primitive |

---

## 2. The experience, scene by scene (what's on screen)

A 3-scene arc inside the existing storefront (same storefront, Opal tab, Engine tab, experiment surface).

**Entry.** After beat 15 completes, a button appears: **"Show the Signal-Led Moment ▸"**. Click it.

**Scene 1 — DETECT (signal arrives).** A toast slides in:
> 📈 **SIGNAL** — Coach Tabby spiking on TikTok · *#CoachTabby +480% views/hr · NY metro*

A live **countdown** starts: **`Window 28:00 ⏳`**. Honesty chip on the toast: **"SIMULATED · partner social-listening layer — not Optimizely. Velocity figures illustrative."**
*Say:* "A bag is going viral right now. ~28 minutes before it cools. No human team reacts this fast."

**Scene 2 — GENERATE (Opal builds the moment, live).** The signal flows to Opal. Then, with **honest progress the whole time** (Decision #5):
1. `Reading signal…`
2. `Opal is writing the moment copy…` → eyebrow/headline/offer appear (real Gemini text)
3. `Generating the hero image from the real Tabby… (~8s)` with an elapsed indicator + shimmer on the hero placeholder (real Gemini image via `/ai/scene`)
4. `Hero ready — going live.`
Chip: **"Model-written copy + AI-generated scene of the real product, delivered as feature variables over our module. No bespoke HTML. Draft → a human clicks Launch (governance beat)."**

**Scene 3 — SERVE + OPTIMIZE + MEASURE.** The storefront does a **full-bleed takeover**: a photoreal hero of the **actual Tabby** in a generated scene, with Opal's headline overlaid in the negative space (this is REAL — a real flag + real `multi_armed_bandit` rule were created; the image + copy came from feature variables). The Engine tab shows the **MAB readout**: arms 33/33/33 → traffic auto-shifts to the winner (→ ~73% on "As seen on TikTok") over rounds, **inside the still-ticking window**. Stat lands: **"Loop closed in 4:12 of 28:00 — winner promoted automatically."** Chip: **"Representative figures · Optimizely MAB is GA. Real `multi_armed_bandit` rule is creatable."**
*Close:* "We detected a cultural moment, generated the experience, served it, and let the bandit find the winner — automatically, before the window shut. DY reacts to the neighborhood. We react to what's happening in the world *right now*."

---

## 3. Honesty grid (real vs mocked + exact on-screen labels — carry verbatim)

| Stage | Real / mocked | On-screen label |
|---|---|---|
| **DETECT** (TikTok signal) | **Mocked** (partner layer; no native listener in Opal) | "SIMULATED · partner social-listening layer, not Optimizely · velocity illustrative" |
| **GENERATE — copy** | **Real** (Gemini) | "Model-written copy" |
| **GENERATE — image** | **Real** (Gemini nano-banana, real product ref) | "AI-generated scene of the real product · no text baked in" |
| **GENERATE — delivery** | **Real** (discrete feature variables) | "Delivered as feature variables over our module · no bespoke HTML · draft→Launch" |
| **SERVE** | **Real** (flag + surface render) | — |
| **OPTIMIZE** (MAB) | Real rule created; animation representative | "Representative · MAB is GA · real rule creatable" |
| **MEASURE** | Representative | (spoken line; no UI claim) |
| **Autonomy** ("act without sign-off") | **Roadmap** | "Today the loop closes with a human Launch click (governance). Autonomy is roadmap." |
| **Economics** (100x/60%/80-20) | Comprend narrative, unsourced | If ever shown: "Comprend POV — illustrative, not Optimizely-measured" |

---

## 4. GENERATE in detail (the crux — how text AND image are made)

Two generated artifacts, **both real**, both delivered as feature variables, both rendered by **our** module.

### 4.1 The copy (text)
- Opal (real Gemini chat) reads the signal (`headline`, `anchorLine`, `skus`, `windowMinutes`) and writes the moment copy. The presenter can dictate instead ("make the headline about the viral moment").
- **Fallback (stage safety):** if the live model is slow/unavailable, use the scenario's canned on-brand copy. Identical downstream.

### 4.2 The image (hero scene) — reuse `/ai/scene`
- Mechanism: `src/services/sceneGen.ts` → Gemini `gemini-3.1-flash-image`. It loads the **real on-white product shot** (`/images/COA-CH857.jpg`) as a reference and generates a **wide cinematic editorial banner** with the bag composited into a generated scene.
- The existing `searchHeroPrompt` (`sceneGen.ts:24`) already specifies **16:9, "generous negative space on the left for a headline," photorealistic, "reproduce the EXACT bag," and "NO text/watermarks."** It is purpose-built to be a hero with room for overlaid copy — exactly what we need.
- Call: `POST /ai/scene { productId: "COA-CH857", sceneId: "signal-tabby-tiktok", type: "search", sceneContext: "<moment vibe, e.g. 'spotlit on a glossy after-hours editorial set, bold trending energy, current and Gen-Z, refined Coach palette'>", aspect: "16:9" }`. Returns a **stable URL**: `/ai/scene/COA-CH857/signal-tabby-tiktok`. Async by default (~8s, polled); cached in R2 forever after first gen.
- **The headline is NOT in the image** — our module overlays Opal's headline (a feature variable) onto the generated scene's negative space. Image variable + text variables **compose in our module.**

### 4.3 Delivery — discrete feature variables (the "as-if-real-experiment" model)
The variation is defined by named feature variables (not one opaque blob). Change the variables → change the experience; the MAB picks the winning variation.

| Variable key | Type | Example | Source | Consumed by |
|---|---|---|---|---|
| `hero_image` | string | `/ai/scene/COA-CH857/signal-tabby-tiktok` | Gemini image-gen (4.2) | hero render |
| `eyebrow` | string | `As seen on TikTok` | Opal copy (4.1) | hero render |
| `headline` | string | `The Tabby everyone's talking about` | Opal copy | hero render (overlaid) |
| `subcopy` | string | `Trending in NY right now` | Opal copy | hero render |
| `offer` | string | `Trending now` | Opal copy | hero render |
| `cta_label` | string | `Shop the Tabby` | Opal copy | hero CTA |
| `cta_action` | string | `navigate` | scenario | hero CTA |
| `theme` | string | `tan` | scenario | hero skin |
| `layout` | string | `hero` | scenario | hero skin |
| `badge` | string | `Signal-led · trending` | scenario | hero chip |

Keep `payload` (JSON) populated too for back-compat with the other 5 scenarios; the moment render **prefers the discrete variables** when present. These map 1:1 onto the existing `XsurfCreative` fields — we are *promoting* them from inside the JSON to top-level flag variables so they show clearly in the Optimizely UI.

### 4.4 Sequencing / timeline (on stage)
DETECT (signal + countdown starts) → Opal writes copy → trigger `/ai/scene` (honest "~8s, generating…" with elapsed) → **Launch** real MAB experiment with variation variables (we can launch immediately; `hero_image` URL is stable; render polls until image ready) → hero takeover reveals (SERVE) → MAB readout animates within the window (OPTIMIZE/MEASURE) → "loop closed before zero," driven off the **actual** image-ready/MAB-finish event, not a blind timer.

---

## 5. Architecture mapping (current code — reuse vs new)

Reuse the **experiment-surface** path; do NOT use the old operator/AudienceAuthoring/`showMab`-clone path.

- **DECIDE+GENERATE delivery + SERVE + OPTIMIZE + real-MAB-rule** already exist: a new MAB scenario flows through `runExperimentScenario` → `POST /experiment/launch` → `launchExperiment` (real `multi_armed_bandit` rule) → `#xsurf` render → `showMab()` readout, with **zero plumbing changes**. Opal can launch it via `{ scenario: 'tiktok_tabby_moment' }` (the tool already accepts `scenario`).
- **Image-gen** already exists: `/ai/scene` + `sceneGen.ts` (used today by Search/Concierge).
- **Genuinely new:** the DETECT layer (mock signal), the discrete feature variables, the honest progress UX, the window countdown, and the encore wiring.

---

## 6. Implementation steps (the to-do — ordered, with context)

> Each step carries enough context to execute. Group = phase. Reuse existing patterns (cite files).

### Phase A — DETECT layer (mocked signal, honestly labeled)
- **A1.** Add `src/data/signals.json`: the Tabby TikTok signal — real SKUs (`COA-CH857`, `COA-CY201`), `velocityPct: 480`, `windowMinutes: 28`, `region: "US-NY"`, `simulated: true`, `source: "partner_social_listening"`, `nlSeed` (the prompt handed to Opal), `_meta` note that DETECT is a mocked partner layer. At runtime, overlay the **real** region from `/geo` (`src/routes/geo.ts`) for a genuine tell.
- **A2.** Add `src/connectors/SignalProvider.ts`: `TrendSignal` interface + `SignalProvider` interface + `MockSignalProvider` (reads `signals.json`) + inert `LiveSignalProvider` (throws `NotWiredError`). Clone the Mock+inert-Live pattern from `src/connectors/AudienceAuthoring.ts`.
- **A3.** Register `signals` in `src/connectors/index.ts` (add to `Connectors` interface + both `CONNECTOR_MODE` branches).
- **A4.** Add `src/routes/signals.ts`: `GET /signals/next` (→ `MockSignalProvider.nextSignal()`), `POST /signals/ingest` (live partner-push seam; mock echoes/queues). Mount in `src/index.ts` next to the other `app.route(...)` lines.

### Phase B — the moment experiment + discrete feature variables (GENERATE delivery)
- **B1.** Extend `ensureFlag` in `src/services/experimentFx.ts` `variable_definitions` to add the discrete variables from §4.3 (`hero_image`, `eyebrow`, `headline`, `subcopy`, `offer`, `cta_label`, `cta_action`, `theme`, `layout`, `badge`) — **additive**; keep `variant`/`module_enabled`/`payload`.
- **B2.** Extend the variation→variables mapping (`toVariations` in `experimentScenarios.ts`, or a moment-specific mapper) so the moment scenario sets the discrete vars per arm (and still populates `payload`).
- **B3.** Add the **`tiktok_tabby_moment`** MAB scenario to `SCENARIOS` in `src/services/experimentScenarios.ts`: `type: 'mab'`, `metric: add_to_cart`, 3 arms — `control_new` (control), `as_seen_tiktok` (winner; `hero_image` = the `/ai/scene` URL), `complete_tabby`. Uses `TABBY = 'COA-CH857'`.

### Phase C — image generation wired into the moment (the hero)
- **C1.** On moment launch, trigger `POST /ai/scene` for `COA-CH857` with the moment `sceneContext` (16:9, type `search`, `sceneId: "signal-tabby-tiktok"`); set `hero_image` to the returned stable URL.
- **C2.** Extend the `#xsurf` render in `public/storefront.js` (`renderExperimentSurface` / `_xsurfCreative`, ~lines 374–404) to **read discrete variables** (prefer them over `payload`), render the **takeover hero**: generated `hero_image` as backdrop + Opal copy overlaid in negative space + offer/CTA/badge from variables. **Poll the `/ai/scene` GET url** until the image is ready before revealing.
- **C3.** Honest progress UX (Decision #5): explicit states — `Reading signal…` → `Opal is writing the moment copy…` → `Generating the hero image from the real Tabby… (Ns)` with elapsed counter + shimmer → `Hero ready — going live.` Never a blank/frozen state; if gen runs long, keep the status truthful.

### Phase D — GENERATE via Opal (copy) + fallback
- **D1.** The Scene-2 step dispatches `CustomEvent('opal:ask', { text: signal.nlSeed })` (mirror `runOpalStep` ~`storefront.js:2304`) so the **real Opal chat** writes copy + launches the moment. Presenter can also type a directive.
- **D2.** Ensure the Opal `launchExperiment` tool (`src/agents/tools/experimentTools.ts`) launches `{ scenario: 'tiktok_tabby_moment' }`; if the model writes custom headline/eyebrow, flow them into the discrete variables (extend tool input to accept copy overrides if needed). Verify the `opal:experiment` bridge (`island/opal-chat.tsx` ~100) carries enough detail (or the storefront re-fetches the variation).
- **D3.** Deterministic fallback: if Opal text is slow/unavailable, fall back to the scenario's canned copy + `runExperimentScenario('tiktok_tabby_moment','as_seen_tiktok')`. Identical downstream.

### Phase E — encore arc + countdown + readout
- **E1.** Add `buildSignalArc()` in `public/storefront.js`: 3 micro-beats (S1 DETECT, S2 GENERATE, S3 SERVE+OPTIMIZE+MEASURE) shaped like the existing `this.steps[]` objects (incl. the `callout` object).
- **E2.** Encore button after beat 15 ("Show the Signal-Led Moment ▸"); keep core at 15 (don't touch `featureList`/the "Step X of 15" count). (Switchable to inline 16–18.)
- **E3.** Window **countdown** UI + `#signal-feed` panel in `public/storefront.html` (near `#xsurf`): real ticking clock from `windowMinutes`; "loop closed in m:ss of 28:00" stat driven off the **actual** image-ready/MAB-finish event.
- **E4.** `#signal-feed` toast for the DETECT signal + the verbatim honesty chip.
- **E5.** OPTIMIZE readout: reuse `showMab()` (or a small moment variant) into `#mab-readout`, arms = the moment variants; keep the "Representative · MAB is GA" chip.

### Phase F — honesty labels + guardrails
- **F1.** Carry every label from §3 verbatim. **F2.** Never render Comprend economic figures as Optimizely numbers.

### Phase G — verification
- **G1.** `/__shot` screenshots of each scene (DETECT toast+countdown, GENERATE progress states, takeover hero, MAB readout).
- **G2.** Confirm the real flag `xsurf_tiktok_tabby_moment` + `multi_armed_bandit` rule are created (token-gated) and the **discrete variables are visible in the Optimizely UI**.
- **G3.** Confirm `/ai/scene` generates the Tabby hero (real bytes in R2) and the hero reveals after the honest wait.
- **G4.** Full end-to-end run of the encore against prod/dev.

### Phase H — docs / ledger
- **H1.** Update `docs/PROJECT_LEDGER.md` (signal-led item → "in build; brief = doc 12").
- **H2.** Add the encore presenter script to `docs/EXPERIMENT-SURFACE-RUNBOOK.md` (or the DEMO-MASTER-PLAYBOOK).

---

## 7. What we will NOT claim (guardrails)
- No native social-listening in Opal — DETECT is mocked, the `LiveSignalProvider` stub shows where a partner plugs in.
- Velocity numbers ("+480%/hr", "28-min window") are invented demo props; the *phenomenon* is plausible, the metrics are not measured. Label them.
- Autonomy ("act without sign-off") is roadmap; today the loop closes with a human Launch click (governance beat).
- CMAB on Feature Experimentation is beta/access-gated — keep MAB (or A/B) for any *real* rule.
- Lift figures are representative; never present as Coach's measured results.
- Economic figures (100x/60%/80-20) are Comprend's unsourced framing.

## 8. Open / soft items (decide if/when relevant)
- **Encore placement** — locked to "button after 15"; trivially switchable to inline 16–18 if the room prefers one continuous run.
- **Weather as a genuinely-live 2nd signal** (free Open-Meteo, no key) — optional honesty-hardening for a technical buyer who pushes on "is any detect real?" Not in first cut.
- **Copy-override plumbing** into Opal's tool (D2) — only if we want the model's exact words (vs. canned) to land in the discrete variables on stage.

## 9. Cross-references
- Rationale + 6 signals + abstracted loop: [`./comprend_signal_led_brief.md`](./comprend_signal_led_brief.md)
- Original stretch plan (rationale; Phase-0 mechanics superseded here): [`./11-signal-led-stretch-plan.md`](./11-signal-led-stretch-plan.md)
- Honesty tiers, MAB/CMAB GA status, draft-only governance: [`../Tapestry-Coach-North-Star-Brief.md`](../Tapestry-Coach-North-Star-Brief.md)
- Experiment surface scenarios + launch path: `src/services/experimentScenarios.ts`, `src/services/experimentFx.ts`, `src/routes/experiment.ts`, `public/storefront.js` (`#xsurf`)
- Image-gen reused for the hero: `src/services/sceneGen.ts`, `src/routes/aiScene.ts`
- Opal chat + tools: `src/agents/tools/experimentTools.ts`, `island/opal-chat.tsx`
</content>
</invoke>
