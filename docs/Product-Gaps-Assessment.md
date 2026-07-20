# Product Gaps Assessment — what we built vs. what the product provides

**Audience:** INTERNAL — CPO + product research team. Candid by design; do not share externally.
**Context:** the Tapestry demo/win (and the ASOS + other-customer interest behind it). This lists what was custom-built or worked around to deliver the experience, organized by product priority. Fairness note up front: the **FX REST APIs and the ODP event/GraphQL/profile APIs did real product work** — audiences, flags, A/B·MAB·CMAB rules, event ingest, real-time segments are genuinely product. The gaps below are what we had to build *around* them.

---

## Tier 1 — Missing product layers (we built entire subsystems)

1. **Real-time behavioral affinity engine — THE gap.** Decayed per-dimension affinity scoring (recency/frequency-weighted, shoppers flow *in and out*), **auto-generated affinity audiences from the catalog taxonomy** ("Tote Affinity" = catalog value + threshold), per-dimension tunable weights/decay/thresholds, explain records on every membership change. This is Dynamic Yield's core affinity capability; no Optimizely product has it — ODP segments are rule counters with fixed windows (no scores, no decay → members never exit). 100% custom (the "Edge Affinity Reflex"). **Market signal: four independent customers have now asked for exactly this layer** (Tapestry, ASOS, plus two others who hand-built equivalents — one on Redis counters, one as a bespoke deterministic content resolver we delivered). This is the productization candidate.

2. **Edge / in-session decisioning runtime.** Per-visitor live state at the CDN edge (per-shopper Durable Object), millisecond re-decisioning on each event, WebSocket **push** of decisions to the page, closed-form decay timers, session/visitor identity. FX SDKs are pull-and-decide on attributes you supply; there is no product concept of per-visitor in-session state or a push channel. Fully custom.

3. **Headless delivery SDK (push-by-ID contract).** Customers' engineering teams (both Tapestry and ASOS are headless) want decisions pushed as `{content/module ID, type, score, explain}` over a socket, their front end paints. No product SDK does server-push personalization delivery; we built the socket layer and are packaging the thin client. This contract is what won the Tapestry engineering room.

4. **Content catalog + content-level recommendation.** The committed next capability for two customers: register CMS content (their IDs, tags, metadata) and **recommend content the way we recommend products**, scored on live behavior, then outcome-optimized. No product covers it — Recommendations products are product-catalog only with ~24h regeneration and no in-session dimension; Content Recs (Idio) is legacy. Being designed/built custom now (with a design-time LLM auto-tagging pipeline for sparse CMS metadata — also custom).

5. **Operator agent that can act.** Our "Opal" in the demo is a custom-built agent (Cloudflare Agents DO + Gemini) with tools that query the data and **create real audiences/flags/experiments live** via the FX REST API behind a write gate. We could not use product Opal for this: the MCP path is draft-only (human must publish — can't take an action live), credit-based, there is **no ODP MCP server at all**, and there's no embedding story for a customer-facing surface. The agent-that-acts (governed) is the gap.

6. **Shopper-facing AI surfaces** *(the ones already known)*: the stylist/concierge agent, NL intent search over the catalog, and generative scene imagery of real products — all custom Gemini builds, including the async generation pipeline (queue + object storage + cache) we hand-rolled. No product equivalent exists.

7. **Anonymous cold start.** First-paint personalization for a no-history visitor from edge geolocation + public census data (curate-not-price guardrails). Custom; no product addresses the anonymous cold-start moment.

## Tier 2 — Existing products with gaps / sharp edges we worked around

8. **ODP.** (a) No scored/decaying affinity — segment conditions are event counters in fixed windows (e.g., ≥3 in 1 hour), so membership is sticky and coarse; the entire "affinity" semantic had to live in our engine with ODP mirroring named segments. (b) **Anonymous-visitor support is weak**: vuid is a low-confidence identifier with a hard char(32) format, no profile UI for vuid-only visitors. (c) The **`recent_events` instant-evaluation path (~85–200ms) is excellent but semi-documented** — we got the contract from a PM's reference notes, not public docs; it should be a headline documented capability. (d) GraphQL sharp edge: `audiences(subset:)` requires enumerating audience **names** — passing a category like `["realtime"]` silently returns nothing. (e) Event-taxonomy mapping (segments fire on `product`/`action:"detail"`, not intuitive names) required insider knowledge to discover.

9. **CMAB / Feature Experimentation.** (a) **No live bandit telemetry/readout API** — allocation updates are hourly with no surface to show convergence/decisioning live; we displayed representative visualizations (labeled) because nothing real can be shown at demo timescale. (b) **Dashboard transparency is insufficient for brand trust** — the customer said on a recorded call that they won't hand keys to autonomy without seeing per-decision why/weights; this is a reporting gap, and it's the adoption blocker for autonomous personalization. (c) CMAB accepts **event metrics only** (no revenue metric). (d) **Variations are fixed, pre-created sets** — the exact "hand-coded variations" complaint driving the content-personalization ask; no concept of dynamic/catalog-driven arms at scale. (e) REST API **documentation drift** (ruleset rule shapes, metric requirements, the custom-events endpoint path) cost us live-validation cycles to discover the real contracts.

10. **Datafile freshness choreography.** Default SDK polling is too slow for the operator moment ("I launched it — it's live"). We hand-built webhook-purge + no-store fetch + revision-polling to make launches feel event-driven. Should be a product pattern, not per-project engineering.

11. **Tuning & authoring surfaces.** No UI anywhere for: per-dimension affinity weights/decay/thresholds; reviewing/pinning auto-generated audiences; mapping audiences/affinities to next-best content. We committed the first cut of this UI to Tapestry **this week** — it's being built custom.

12. **Identity utilities.** Stable anonymous visitor identity (persistent id, rotation on "new shopper," mapping to ODP vuid) — hand-rolled; no product utility exists for the anonymous-first world these experiences live in.

## Tier 3 — Simulated because no product exists (labeled honestly in-demo)

13. **Social/trend signal ingestion** (the "Signal-Led Moment" DETECT stage) — fixture data badged "SIMULATED · not Optimizely"; partner-integration space.
14. **Live lift/readout at demo timescale** — representative numbers, clearly labeled; follows from 9(a).

---

## If the team prioritizes only three things

1. **Productize the affinity layer** (Tier 1 #1–2 together: scoring + decay + auto-audiences + edge state + push) — four-customer demand, direct DY displacement.
2. **CMAB transparency + dynamic arms** (Tier 2 #9 b/d) — the trust blocker and the variation-scale blocker for the whole autonomous-personalization story.
3. **First-class documented `recent_events` + anonymous identity in ODP** (Tier 2 #8 b/c) — small lifts, big integration-credibility wins.
