# Tapestry / Coach Personalization Demo — PROJECT LEDGER

**This is the single source of truth.** Update it every turn: mark items ✅ when done, 🔵 when in progress, ⏳ pending, 🔲 blocked-on-user. If another engineer picks this up, this file + the brief tells them everything.

_Last updated: 2026-06-25_

Status legend: ✅ done · 🔵 in progress · ⏳ pending · 🔲 blocked on user

---

## North Star (locked)
A live **Coach storefront** where:
1. An **anonymous, signed-out** shopper gets **real-time, individual** personalization at the edge (<50ms) that specializes in-session; and
2. A **merchandiser talks to Opal in plain language** to create an audience/experience that **goes live** — simpler than Dynamic Yield, and (now) creating a **real Optimizely experiment** via API.

One line: *"Talk to Optimizely; watch Coach's storefront personalize itself for an anonymous shopper, live — AI creates the audiences, the edge delivers them."*

Demo must be **self-driving and guided** (a presenter clicks through; it narrates each beat), **professional/luxury**, and **business-first** (out-simplify DY; keep plumbing on-demand).

## Competitive frame (vs Dynamic Yield) — validated
DY is a **mature AI personalization product** (Shopping Muse, Experience Search) now with **Mastercard predictive data** — NOT "rules-based." Our real wedge: **edge <50ms decisioning · operator-side conversational audience creation (DY's conversational AI is shopper-facing only) · native experimentation · ODP+CMS span · first-party data sovereignty.** Out-simplify, don't out-engineer.

## Honesty tiers (carry into every claim)
- **Real:** real-time personalization, anon profiles, recs, sort, page structure/content, journey stage, search, the storefront, and (target) live Optimizely flag/audience/experiment creation via API.
- **Representative:** A/B / MAB / CMAB results shown with labeled illustrative numbers (Optimizely capability is GA; demo simulates the outcome).
- **The line we will NOT cross:** proven lift on Coach's real traffic (measurement apparatus real; numbers are demo data until it runs on their site).

## Validated Optimizely facts → see memory `optimizely-capabilities-2026` and `docs/Tapestry-Coach-North-Star-Brief.md`.

---

## Architecture
- **Edge:** Cloudflare Workers + Hono. `CONNECTOR_MODE=mock` — **"real seams, mocked calls."**
- **Connector layer** (`src/connectors/`): `SegmentProvider` (ODP), `AudienceAuthoring` (Opal), `DecisionProvider` (FX) — each Mock + inert Live stub; one config flag flips mock↔live.
- **Engine:** `RealtimeSegmentEngine` — connector-driven, catalog-aware; `JourneyStage`, `CatalogService` (in-memory item-item affinity).
- **Storefront** (`public/storefront.{html,js}`): self-driving guided demo, 15 beats + requirements checklist + telemetry overlay. Operator console at `public/operator-console.*`.
- **Data:** 71 real Coach product images (self-hosted `public/images/`, from StockX/Klarna CDNs); synthetic ODP-schema customers/events (`data/synthetic/`).

### Target additions (this phase)
- **Tabbed push-left sidebar** (Chrome-extension style): tabs **Opal · Capabilities · Engine**; opening it **reflows the page left**, never covers content. Persistent scroll-safe markers on personalized elements.
- **D1 database** seeded to the Optimizely/ODP schema (`docs/architecture/coach_synthetic_schema.json`) **+ new payment/purchase-history tables** (Coach-themed) so the chat can answer rich questions.
- **Real OPAL chat:** built on the **Cloudflare Agents SDK** (chat-agent starter), powered by a **strong model — Gemini** (matches Opal's underlying model), with **tools** that (a) query D1 with aggregate-then-reason and (b) create **real Optimizely flags/audiences/experiments via REST API** (token-gated). Type-anything, not scripted.

---

## STATUS

### ✅ Done
- North Star + brief (`docs/Tapestry-Coach-North-Star-Brief.md`); competitive frame corrected; Optimizely capabilities validated (sourced).
- Connector layer (Order-0 + adapters) · engine refactor · routes · operator route.
- Coach catalog with **71 real self-hosted images**; synthetic ODP-schema data + generator.
- Guided storefront: **15 beats** covering every Coach feature (Recs distinct from Personalization) + **requirements checklist** + telemetry overlay; card-consistency fixed.
- **Deployed:** https://edge-platform.expedge.workers.dev/storefront (and `/operator-console`).
- Visual verification pipeline (Playwright screenshots).
- **This ledger.**
- **Director UX polish (verified):** scroll-into-view before every click (no off-screen clicks), persistent "Personalized" markers, before→after annotations, cold-start welcome + anonymous-profile beat, clickable Capabilities rows; permanent `storefront.js` cache-bust (`?t=` + no-cache meta).
- **Comprehensibility overhaul (verified — all 15 beats, 0 console errors):** explicit **Signal → Decision → Why** card in the always-visible sidebar (causal reasoning, not just labels); highlight markers now render **above** product images (z-index overlay, fixes the "covered" bug); header-aware scrolling so content never tucks under the sticky header. Recovered cleanly from an `npm ci` detour (private `@optimizely/mcp-server-exp` removed — it was never used).
- **Highlight + toast overlay RE-ARCHITECTED for reliability (verified on prod — geometry asserted across 8 beats + scroll, 0 errors):** The old in-flow `::after` border + zone-absolute pill kept failing (slid under the sticky header; on zones taller than the viewport the side/bottom lines fell below the fold). Replaced with a **fixed overlay layer**: every marker is a `position:fixed` frame in `#pz-layer`, recomputed from its target's `getBoundingClientRect()` every animation frame (`repositionMarkers` on a rAF loop + scroll/resize) and **clamped to the safe area** = `[headerBottom+8 … vh−8] × [8 … vw−sidebar−8]`. A rectangle clamped into the visible box always shows all four sides; clamped edges render dashed to hint "continues past the fold". Toasts moved to a **fixed stack `#pz-toasts`** below the header (de-duped by before|after key, ×-dismiss, no auto-timer) so they can never tuck under the chrome. Automated check (`scratchpad/verify-overlay.mjs`): all frames + toasts inside the safe viewport on every beat incl. the tall cold-start zone (`1032×800`, clamped) — local + prod identical.
- **Overlay + Opal-panel follow-ups (verified prod, geometry + screenshots, 0 errors):** (1) **removed the frame outset** — borders now hug each zone's own edge, which for padded sections lands in the padding, OFF the content (cold-start top border measured **72px above** the heading, `clipTop:false`); (2) **adjacent-frame separation pass** in `repositionMarkers` splits the shared boundary so two highlighted zones never touch/overlap (hero/curated was overlapping by 6px → now a clean **7px gap**: hero `[90–638]`, curated `[645–892]`); (3) **Opal result no longer clipped** — `.opal-result.show` `max-height` 520px→2400px so the full card incl. the "✓ Live now…" publish confirmation shows (was losing **88px**; `clippedBy:0` now), and `scrollOpalPanelTo()` auto-scrolls the short Opal panel to the revealed result/confirmation so it's never stranded below the fold.
- **D1 built + seeded (local, verified):** `coach-demo-db` (binding `DB`, id `80fcd6e1-…dc73`) provisioned; schema `0001` applied; reproducible `scripts/seed-d1.mjs` (deterministic, seed 20260625) emits chunked SQL under `migrations/seed/` → **71 catalog · 35 attribute-catalog · 3,200 profiles · 7,293 transactions · 8,760 purchase items** (tender mix incl. Tabby BNPL; ~3% refunds; gifts/gift-wrap). Doc-10 "high-AOV Tabby buyers, last 90d" query returns **1,017 rows, avg 90-day AOV $582**. Remote apply pending at deploy time.
- **Mode-B real SDK wired:** `LiveDecisionProvider` decides flags against the live FX datafile (no-store fetch via `cf.cacheTtl:0`; workerd rejects the `cache` field), maps OptimizelyDecision→`Decision`, and **degrades per-flag to the mock** (project has 0 flags → revision 1). Selectable via new `DECISION_SOURCE=optimizely` (default `mock`); verified in workerd. `OPTIMIZELY_SDK_KEY` + `DB` in `env.ts`/`wrangler.toml`.

### 🔵 In progress
- **Opal chat build** — Gemini + Cloudflare Agents SDK in the sidebar's Opal tab; tools: query D1 (aggregate-then-reason, real) + create Optimizely audience/flag/rule via FX REST (**dry-run during build**; live writes gated). Requires wrangler v3→v4 + React/AI-SDK/agents deps. Working state backed up to scratchpad/backup-pre-chat first.

### ⏳ Pending
- Real OPAL chat (Gemini + CF Agents SDK + tools over D1, aggregate-then-reason) — **data foundation now ready** (`DB` + `v_profiles` + `meta_attribute_catalog` allow-list seeded).
- Remote D1 apply at deploy time (schema `0001` + `migrations/seed/*.sql` with `--remote`).
- **Live** Optimizely flag/audience/experiment creation via REST API (Feature Experimentation) — once flags exist, `LiveDecisionProvider` (Mode B) serves them automatically.
- One-page presenter run-of-show.
- Re-deploy after each milestone.

### 🔲 Blocked on user
- ✅ **Gemini API token** — received → `llm-models-keys.md` + `.dev.vars` (gitignored). Also have Claude + OpenAI keys.
- ✅ **Optimizely API token** — received. **FX** project `4919568555048960`, account `8543082612`. Model = **Gemini** confirmed.
- ✅ **Optimizely SDK key / datafile URL** — received (dev env, in `.dev.vars` + `wrangler.toml [vars]`; not secret). Datafile fetches live: `https://cdn.optimizely.com/datafiles/<key>.json` → revision 1, 0 flags. Mode-B engine reads it on demand.
- ⏳ **Cleanup expectation** — tear down AI-created flags/audiences/experiments after demos? (your call)

### 🌟 Stretch — "wow" use case (LAST, after the core demo)
- **Signal-led / social personalization** — Comprend "From Product-Led to Signal-Led" POV → `docs/architecture/comprend_signal_led_brief.md`. Real-time signals (TikTok velocity, weather, influencer, geo, POS) → Opal generates creative variants → Web Experimentation serves → **MAB** optimizes → measure, inside a ~30-min window. Aimed squarely at winning Coach back ("Coach said no last time"). **Detect stage = mocked** (signal ingestion is a partner layer, not native Optimizely); generate→serve→optimize is real/demo-able. ✅ Plan written → `docs/architecture/11-signal-led-stretch-plan.md` (TikTok-velocity signal; new `SignalProvider` mock; reuse Opal+MAB; a 3-beat "Signal-Led Moment" encore; ~1–1.5d). **Build LAST.**

---

## Decisions log
1. Reuse the existing Cloudflare Workers edge platform (was a banking demo) → re-theme to Coach.
2. **Real seams, mocked calls** (`CONNECTOR_MODE`); mock the ODP/Opal data (volume + reliability).
3. Self-host product images (coach.com/scene7 are 403; scraper codes fabricated) → real images from retailer CDNs.
4. Demo is **self-driving + guided**, business-first; telemetry on-demand only.
5. UI: **tabbed sidebar that pushes the page left** (not an overlay).
6. OPAL chat must be **genuinely functional** (type-anything), not scripted — else it embarrasses us live.
7. Chat model: **strong model, Gemini** (matches Opal) via user token. Built on **Cloudflare Agents SDK** starter.
8. **Create real Optimizely entities via REST API** (flags/audiences/experiments) with a user-provided token — a real experiment, not a mock. Scope to a sandbox project; confirm before first live write.
9. All spawned agents run at **max reasoning**.
10. **Secrets:** API tokens live in `llm-models-keys.md` (gitignored, never committed); local dev → `.dev.vars`, production → `wrangler secret put`. Never echo token values.
11. **Stretch use case** (do last): signal-led / social personalization — see Stretch above + `docs/architecture/comprend_signal_led_brief.md`.
12. **Data reuse + demo-event reset** (user decision, 2026-06-25): historical synthetic D1 data (payment terms, past behaviour/events) is **representative and REUSABLE — never wiped by a demo reset**. Demo-run events are captured as a **separate source**; a **button beside "Reset demo"** clears ONLY demo-captured events. Opal builds audiences over the **UNION** (historical + demo) so sizes are meaningful. Live-created Optimizely entities are demo-labelled and kept (teardown TBD).
13. **Parallel build kickoff (2026-06-25):** real Opal chat + close-the-live-loop built simultaneously via 3 max-reasoning agents (chat foundation in an isolated worktree; FX REST validated live; D1 demo-event model). Integrate to `main` only after each is proven.

## Open questions / to discuss
- Which Optimizely product for the live experiment: Feature Experimentation (leaning) vs Web Experimentation.
- Sandbox project + naming + teardown for live-created entities.
- How the storefront consumes live-created Optimizely state (datafile refresh vs direct).

## Key files / URLs / commands
- Storefront: `public/storefront.{html,js}` · Operator: `public/operator-console.*`
- Connectors: `src/connectors/` · Engine: `src/services/RealtimeSegmentEngine.ts`
- Data: `data/synthetic/`, `public/images/`, schema `docs/architecture/coach_synthetic_schema.json`
- Brief: `docs/Tapestry-Coach-North-Star-Brief.md` · Architecture specs: `docs/architecture/0*.md`
- Run local: `npm run dev` (→ http://localhost:9100/storefront) · Deploy: `npx wrangler deploy`
- Live: https://edge-platform.expedge.workers.dev/storefront
