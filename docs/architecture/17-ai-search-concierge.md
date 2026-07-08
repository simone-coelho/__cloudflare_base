# Plan: make AI Search + Style Concierge genuinely Gemini-powered

Status: **BUILT and verified live on prod** (see `docs/PROJECT_LEDGER.md`) — shipped as specced, plus post-plan growth: `/ai/search` also authors the Edit-hero copy + sceneContext feeding `/ai/scene`; the concierge gained multi-turn refinement + `avoidIds` anti-repeat. *(Renumbered 12 → 17 to resolve the duplicate number with the Signal-Led Moment build brief.)*

## Recommendation (TL;DR)
- **AI Search → Gemini `generateObject` (NL → structured intent) → compile to a real catalog filter + rank, blended with the shopper's live affinity.** NOT Vectorize: at 71 richly-attributed products, intent-parse is more controllable, enforces hard constraints (price/in-stock/category) that vectors can't, personalizes cleanly, adds zero infra, ~1 model call (~0.5–1s). Vectorize/hybrid is the **scale path** (thousands of SKUs).
- **Style Concierge → dedicated streaming `POST /ai/concierge` (AI SDK `streamText`), compact catalog in-context (~4.2K tokens), model returns `product_id`s the client resolves against the real catalog.** NOT a 2nd AIChatAgent DO (heavier: new DO + migration + a React island replacing the working modal).
- **No new deps, no new secrets, no infra.** Reuses `ai` v6 + `@ai-sdk/google` + `GEMINI_API_KEY` + `gemini-2.5-flash` — the same backend as Opal. So "Search + Concierge, powered by Opal" becomes literally true.
- **Keep the existing heuristics (`searchCatalog`, `conciergeReply`) as graceful fallbacks** → the demo never hard-fails on a key/quota/timeout.

## Anti-hallucination (critical)
The model only ever proposes `product_id`s; the server intersects them with `CatalogService` and the client drops any not in `this.byId`. **A fake SKU cannot reach the screen.** If <2 concierge picks resolve, fall back to `completeTheLook`/recommendations.

## Why this is genuinely "real AI"
The catalog has no `wedding` occasion tag — so "something for a winter wedding" forces Gemini to *map* free text onto the real tags (`winter` + `special-occasion` + `evening`). Regex can't; the LLM does. That's the proof the understanding is real, not scripted.

## Build (≈2.5–3 dev-days)
New files:
- `src/routes/ai.ts` — Hono sub-app: `POST /ai/search` (`generateObject` + `IntentSchema`), `POST /ai/concierge` (`streamText`).
- `src/services/CatalogIntent.ts` — `buildCompactCatalog()`, `rankByIntent()`, `IntentSchema` (zod; `.nullable()` not `.optional()` for Gemini structured output). Reuses `CatalogService`.

Edited:
- `src/index.ts` — `app.route('/ai', aiRoutes)`.
- `public/storefront.js` — `runSearch` → async fetch `/ai/search` (keep `searchCatalog` fallback); `conciergeAsk` → stream `/ai/concierge`, parse a trailing `PICKS: <ids>` line, resolve ids, render existing cards (keep `conciergeReply` fallback). Beat 14 `await this.runSearch(...)`.
- No HTML change; no island rebuild (consumer features are vanilla JS).

Ranking (search): hard filter (in_stock, category/line if named, price range) → soft score (occasion Jaccard 0.34, category 0.22, line 0.18, silhouette 0.12, color 0.10, priceBand 0.10, token 0.05) + **personalization** (dominantLine +0.16, in recommendations +0.06). Relax priceMin/silhouette if <3 results so the grid is never empty.

## Demonstrable queries (validated against real catalog facets)
**Search:** "structured work bag in black leather under $400" · "something for a winter wedding" (the killer — no wedding tag) · "crossbody for travel under $300" · "an investment top-handle bag" · "a gift for my sister under $150" · "everyday Tabby shoulder bag in a neutral" · "a fun festival bag in a bold color" · "a date-night bag that isn't black".
**Concierge:** "What should I carry to a winter wedding?" · "Build me a capsule around the Tabby 26" · "What pairs with the Tabby for the office?" · "a gift under $200 for my mom" · "put together a travel look" · "I love the Brooklyn line — complete the look" · multi-turn "…now show me that in black".

## Honesty tiers
- **Real:** Gemini NL understanding (both), model-authored streamed concierge prose, every result/pick a real catalog SKU (resolved), in-session affinity personalization, same infra as Opal.
- **Representative:** ranking weights are hand-tuned heuristics (not trained LTR); affinity is the engine heuristic; catalog is synthetic-but-real-shaped; no semantic embeddings (Vectorize is the next tier).
- **Stage line:** "Search and the concierge run on the same Gemini model as Opal — it genuinely understands the shopper's words and reasons over our real catalog and her live affinity; every recommendation is grounded to a real SKU so it can't invent products."

## Scale path (note, not now)
At thousands of SKUs: add Cloudflare Vectorize + Workers AI embeddings for semantic recall, then LLM/affinity rerank (hybrid). Justified only past in-context limits.
