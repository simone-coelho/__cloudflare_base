# Storefront & Operator UX (as-built)

**Status:** as-built, verified 2026-07-08. Supersedes the June UX spec (preserved at [legacy/07-storefront-ux-2026-06.md](./legacy/07-storefront-ux-2026-06.md)) — the beats and zone concepts shipped; names, wiring, and layout evolved, and the storefront grew major surfaces the spec predates.

---

## 1. Surface map

| Surface | File(s) | Notes |
|---|---|---|
| **Coach storefront** | `public/storefront.html` + `storefront.js` | Home / PLP / PDP / cart, real product photography (`public/images/COA-*.jpg`) |
| **Demo Director** | bottom bar in the storefront | 15 scripted beats + the Signal-Led encore; Back/Next/Auto |
| **Affinity Instrument** | sidebar **Affinity** tab | live per-dimension bars with θ_in/θ_out tick marks, honest 300 ms decay drain, enter/exit log, member chips with **· ODP** confirmation badges |
| **ODP memory-sync feed** | sidebar panel | per-action dispatch rows upgraded to ✓ by `odp_receipt` pushes; seed confirmations |
| **Experiment surface** | `#xsurf` | A/B · MAB · CMAB takeovers incl. the TikTok moment (render-gated: explicit creative/encore only) |
| **Signal feed** | `#signal-feed` | Signal-Led Moment toast + countdown, honesty chips ("SIMULATED · not Optimizely") |
| **AI surfaces** | search modal, Style Concierge | Gemini search with generated Edit-hero; streaming concierge with PICKS grounding |
| **Geo ribbon / banner** | `#welcome-ribbon`, `#pz-banner` | geo-cohort cold-start greeting; personalized-banner preview |
| **Opal chat** | sidebar tab (`public/opal-chat.js`) | the agent island (see [doc 08](./08-opal-chat-plan.md)) |
| **Engineer overlay** | slide-in panel | on-demand telemetry (replaces the old always-on right rail) |
| **Operator console** | `public/operator-console.html/.js` | audience suggest → publish (routes: `POST /operator/audiences/suggest`, `POST /operator/audiences/publish`, `GET /operator/audiences`, `GET /operator/insights`) |

Catalog data: `public/data/coach-catalog.json` (71 SKUs). The old `visual-demo.html` is the banking demo — not part of this UX.

## 2. Zone registry (actual ids) and what updates each

| Zone | Id | Updated by |
|---|---|---|
| Hero | `#hero` | decisions (`hero_module`, incl. `affinity_hero`), geo cold start, moment takeover (`#xsurf` overlays) |
| Story strip | `#story` | decisions |
| Curated grid | `#curated-grid` | recommendations + geo cohort ranking |
| PLP grid + sort | `#plp-grid`, `#plp-sort` | `sortOrder` (`plp_sort` decision, `line_first` under affinity) |
| Category rail | `#category-rail` | static + sort |
| Complete the look | `#ctl` | `complete_the_look` decision |
| PLP "why" note | `#why-body` | decision reason copy |

## 3. The wiring contract

- **Transport:** `POST /realtime/action` (synchronous response) + `WSS /realtime/ws?userId=` (push) — the dual channel. First-class retail events: `product_view`, `add_to_cart`, `wishlist_add`, `page_view` (plus legacy types).
- **Payload (`update.data`)** — what the client actually consumes: `segments[]`, `decisions{5 flag keys}`, `recommendations[]`, `sortOrder[]`, `journeyStage`, `affinity{dims, audiences, changed, odpConfirmed}`; the response additionally carries `odp{receiptId,…}`. (The old spec's `featureVariables{hero_content…}` path was superseded — content flows through `DecisionProvider` + catalog.)
- **Hydration:** `GET /realtime/reflex` snapshot on boot (no flash); `POST /realtime/session/reset` = "New shopper".
- **WS types:** `personalization_update`, `segment_update`, `audience_published` (operator publish → qualifying shoppers), `odp_receipt`. Protocol: [../api/02-websocket-protocol.md](../api/02-websocket-protocol.md).

## 4. Journey stage (as-built)

`deriveStage()` returns **`early / mid / late`** directly from behavioral counts + segments (`JourneyStage.ts`) — the old five-stage engagement-score gating is gone. Stage feeds `journey_message` and module choices.

## 5. Design tokens (as-built)

`--ink #1C1A17` · `--paper #FBF9F5` · `--tan #B8915A`; type = Playfair Display + Inter (`storefront.html:22-38`). (The spec's Tiempos/#C8A063 palette was refined during build.)

## 6. Verification

UI states are verified with `/__shot` (Browser Rendering) asserting **computed rendered state** — display/geometry, not attributes. Demo choreography: doc 16 §10; beats runbook: `docs/EXPERIMENT-SURFACE-RUNBOOK.md`, `docs/DEMO-MASTER-PLAYBOOK.md`.
