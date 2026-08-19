# Replication Bootstrap — Edge Personalization Platform (this POC → the open-source mirror)

**You are:** an agent tasked with implementing, in a separate open-source project, the capabilities this repository proves.
**Your mission:** a *loyal* implementation of what has been **promised**, not a port of every line of code. This document tells you what we landed on, which documents are authoritative, where the code is the reference and where it is knowingly behind the design, and what must never leak into an open-source codebase.

Read this file completely before opening anything else.

---

## 1. What this repository is

A **real-time edge personalization platform POC** on Cloudflare Workers (live at `edge-platform.expedge.workers.dev`, working branch `feature/real-time-personalization`). It began as a demo vehicle and evolved into the reference implementation for a productized capability set: **behavioral affinity scoring at the edge, self-building audiences, product recommendations, and (as committed design) content recommendations** — all deterministic, explainable, and CDP-connected.

Two warnings before you trust anything you find:

1. **This repo hosts MULTIPLE demos.** Anything about banking / "First National Bank" / Revenue Radar / experiment-surface runbooks is a *different* demo sharing the codebase. It is not superseded, not deprecated, and **not part of your scope**. The authoritative set for your mission is exactly the documents mapped in §3 — treat every doc not listed there as historical/other-demo unless told otherwise.
2. **The POC contains demo shortcuts that are NOT the design** (§7). Replicating them faithfully would be a mistake. Where code and design diverge, **the design wins** — the divergences are enumerated in §6 so you never have to guess.

## 2. The three layers of truth

| Layer | What it is | Where it lives |
|---|---|---|
| **PROMISED** | The capability set committed to design-partner customers — the semantics your mirror MUST reproduce | `docs/content-personalization-design-tapesrty.html` (the "Solution & Algorithm" document — yes, the filename has a typo; it is the canonical spec of the promise) + `docs/architecture/18-content-affinity-engine.md` |
| **BUILT** | Code verified live: the reflex engine, audience generator, ODP loop, product recs, DO host | `src/` — map in §5; audit with file:line evidence in `docs/architecture/19-tapestry-delivery-ledger.md` §3 |
| **DIVERGENT** | Places the POC knowingly lags or contradicts the design (defects, debts, demo shortcuts) | §6 of this file — implement the design, not the defect |

## 3. Reading order (do this in sequence)

1. **`docs/architecture/16-edge-affinity-reflex.md`** — the engine: math, config model, audience generator, the ShopperReflex Durable Object spec, hardening. The heart of everything.
2. **`docs/architecture/18-content-affinity-engine.md`** — the content-recommendations architecture (the "final architecture" you were told about): content catalog, telemetry, two-level scoring, delivery contract, learning ladder, locked decisions D-1…D-6.
3. **`docs/content-personalization-design-tapesrty.html`** — open in a browser. The customer-facing Solution & Algorithm document: the 8-dimension registry (incl. location/regional trending), the model math, strategies, the four learning layers, control/DS-injection surfaces, the delivery contract JSON, the acceptance bar. **This is the promise, written for external data scientists to pressure-test — your mirror is measured against it.**
4. **`docs/architecture/19-tapestry-delivery-ledger.md`** — INTERNAL. Requirement-by-requirement built-vs-gap audit (R1–R15 with file:line evidence), the workstream plan (CW0–CW14), the regional-trending design sketch, risks. This is your built-vs-designed truth table.
5. **`docs/Coach-ODP-Wiring-Spec.md`** + **`docs/ODP-Recent-Events-Reference.md`** — the CDP ("durable memory") connector as-built: event forwarding, profile upsert, instant segment seeding, the gotchas.
6. **`docs/Edge-Affinity-Reflex-Technical-Design.md`** — the standalone technical explainer of the engine (gentler than doc 16; good cross-check).
7. **`docs/architecture/15-edge-composition-design.md`** — the longer-horizon experience/layout lane (modules by ID, composition manifest). Context for why the delivery contract carries `order` from day one.
8. **`docs/architecture/13-geo-cohort-coldstart-prd-tdd.md`** — the geo cold-start work that seeds the location dimension (note: its demo used real geo + swapped data; the production design is §4.6 below).
9. Optional context: `docs/Content-Personalization-Explained-Simply.md` (plain-language framing, incl. why this is NOT a CMAB), `docs/Productization-Roadmap.md` (W1–W10 productization workstreams), `docs/architecture/14-architecture-and-optimizely-capability-map.md` (platform capability map).

**Not for replication** (commercial/internal context only — do not mine these for scope): `Edge-Unit-Economics.md`, `GTM-Delivery-Playbook.md`, `Opal-Credit-Boundary-Pricing-Guide.md`, `Product-Gaps-Assessment.md`, `Tapestry-Implementation-Plan.md`, the proposal/overview/talk-track/field-brief docs.

## 4. The capability inventory — what we landed on

### 4.1 The affinity engine ("the reflex") — BUILT, live

Deterministic, per-shopper, per-dimension interest scoring. **No ML in the serving path — by design, not by limitation** (transparency, speed, cost-predictability; it is the anti-black-box argument). The canonical math:

```
R[d,g] ← R[d,g] · e^(−Δt/τ_d) + w_action · s        // decay the past, add the signal
a[d,g] = R[d,g] / (R[d,g] + K_d)                     // saturation → a ∈ [0,1)
membership: enter at a ≥ θ_in (0.6), exit at a < θ_out (0.45)   // hysteresis
```

- **Lazy decay**: state stores `(R, tLast)`; decay applies at read. Mathematically identical to continuous decay; no timers needed for scoring.
- **Action weights** (defaults, all tunable): view 1 · wishlist 2 · add-to-cart 3 · purchase 5; content: impression 0.25 · click 1 · dwell 2 · attributed conversion 5.
- **Per-dimension overrides**: each dimension carries its own τ, K, θ (price band deliberately short-τ — "price sensitivity is a state, not a trait").
- **Dimensions are catalog-driven** — tag vocabularies come from the tenant's catalog/content metadata, never a hard-coded list. Six behavioral dims live today: line, category, subcategory, silhouette, occasion, priceBand. The registry entry type (`DimensionSpec`, `src/reflex/core.ts:26-44`) IS the extensibility mechanism.
- **Explain record on every transition/decision** — generated at source, carrying drivers (dim/tag/score), context, weights.

### 4.2 Catalog-driven audience generator — BUILT, live

Audiences generate themselves from catalog values: catalog value `tote` → audience `silhouette_tote_affinity` ("Tote Affinity"). Population filter (min product count), dimension-namespaced keys, **diff-regeneration that respects human edits** (pinned audiences and hand-renames survive regeneration via a generator hash). 37 generated audiences live in the POC. `src/reflex/audienceGenerator.ts`.

### 4.3 Two host modes — BUILT

The engine runs in two interchangeable hosts behind a flag (`REFLEX_HOST`):
- **Session host** (`src/services/RealtimeSegmentEngine.ts` + `SessionManager.ts`) — per-session, in-Worker.
- **ShopperReflex Durable Object** (`src/durable-objects/ShopperReflex.ts`, ~816 lines) — the production-shape host: SQLite-backed, keyed by stable visitor ID, WebSocket Hibernation, two ingest doors (WS message + `POST /ingest`), state in `ctx.storage` (never the ~2KB socket attachment), and **closed-form alarm scheduling** for membership exit (no polling):
  `t* = tLast + τ · ln(R(1−θ_out) / (K·θ_out))`
  Your mirror needs an equivalent of this actor model: per-visitor single-threaded stateful compute with durable storage, timers, and socket push.

### 4.4 The CDP loop (ODP here; a connector ROLE for your mirror) — BUILT, live-verified

The edge decides; the CDP remembers. **Split by responsibility, never by latency**: edge = decay/scoring/instant membership; CDP = durable facts, profile, cross-session memory, audience sharing with the rest of the stack. As built against ODP:

- Every event forwarded (flattened `product_*` fields; PDP views as `action:"detail"`).
- Profile upsert with computed traits.
- **Instant seed at session start**: a GraphQL `recent_events` inline query (~85–200ms) — gotcha: the audience subset must **enumerate the mirrored audience names explicitly**; a bare `["realtime"]` subset silently returns nothing.
- Visitor identity to the CDP: currently `SHA-256(sessionId)` as dashless 32-hex — **a known debt; the design is the stable first-party visitor ID** (§6).
- Segment union at decision time: `segments = local ∪ reflex ∪ cdpSeed`.
- **Additive**: the engine runs fully with the connector absent (gated on creds only, `NotWiredError` seam in `src/connectors/`). Preserve that property — your mirror's CDP integration must be a pluggable connector, never a dependency.

### 4.5 Product recommendations — BUILT

`src/services/CatalogService.ts`: item-similarity ranking (weighted attribute overlap) + segment-aware sorting/boosts, invoked at decision time by the hosts. Pattern to preserve: **memberships gate, scores rank** — audiences select the lane, live affinity orders the items. Product recs remain their own machinery when content personalization arrives; the content engine fills the slots *around* a recs widget, driven by the same shopper vector.

### 4.6 Location / regional trending — DESIGNED (the one genuinely new algorithm; ledger §4-CW6)

Population-level trending as a cold-start prior, reusing the identical decay machinery:
- Per region r and tag g: decayed population accumulators `P[r,g]` (τ_region in hours–days), fed by all shoppers' interactions in the region. **Aggregates only — per-shopper geo history is never stored** (this is the privacy answer; keep it).
- **Regional lift** = share of engagement g gets in r ÷ its global share ("disproportionately loved there").
- **Blend as a prior — never contaminate the personal vector** (preserves determinism/replay):
  `ã = (1−λ)·a_personal + λ·â_regional`, `λ = K_blend / (K_blend + Σ_d R_personal[d])`
  New visitor: λ≈1 (regionally-informed first paint from request geo); engaged visitor: λ→0.
- Sparse-region fallback ladder: region → country → global, gated on minimum event mass.
- POC mapping: a `RegionTrend` DO per `{tenant}:{region}` publishing snapshots to KV, hot path reads via an in-process version-marker cache. D1 daily rollup for history.

### 4.7 The Content Affinity Engine (content recommendations) — DESIGNED, committed (docs 18 + the HTML)

This is the centerpiece your mirror must implement. The final architecture:

1. **Content catalog** — parallel to the product catalog: `{systemId (ours), customerContentId (theirs — echoed back in every decision), type, url, tags, metadata.slotTypes, lifecycle, brand}`. Ingested via a `ContentSourceProvider` adapter per CMS **into immutable snapshots** (build → validate → activate atomically; requests never see a half-loaded catalog). A manual JSON/CSV import path exists from day one so nothing waits on adapter work.
2. **Content-type taxonomy is first-class** (on-model, silo, detail/zoom, construction/sole, flat-lay, video, ugc, editorial) — the engine can only serve the right *form* if it knows the form; content-format affinity (e.g., video affinity) is a scored dimension.
3. **Enrichment is design-time only**: an LLM proposes tags for sparse metadata; a human approves before catalog entry. **No model call ever in the serving path** (locked decision D-1).
4. **Content telemetry**: `content_impression` / `content_click` / `content_dwell` through the same ingestion seam as product events, tags flattened.
5. **Two-level scoring — the scale answer** (locked D-2): the shopper's vector scores **tags/dimensions** (bounded state, per-dim caps + ε-pruning — never a score per item); **items** rank only at decision time: `score(item|slot) = Σ_d w_d^(slot) · Σ_{g∈tags(item)∩d} ã[d,g]` (× outcome lift once learning activates). Scales from 71 SKUs to an arbitrarily large catalog.
6. **Strategies** — the unit of operator control: `{slots, weights per dimension, candidate constraints, mode: configured | autonomous}`. Autonomous mode adjusts weights from outcome statistics **with full visibility** — every adjustment logged, reversible, pinnable. Autonomy is a per-slot dial.
7. **Delivery contract** — one push per page, a **page-level ordered decision set**:
   ```json
   { "kind": "content_decisions", "page": "home",
     "decisions": [ { "slot": "home-hero", "order": 1,
       "content": { "customerContentId": "…", "systemId": "…", "type": "image", "url": "…" },
       "score": 0.78,
       "explain": { "drivers": [{"dim":"occasion","tag":"evening","a":0.72}],
                    "context": {"channel":"paid_social","visit":2,"region":"…"} } } ],
     "ts": 0 }
   ```
   Invariants: `order` ships from day one (echoes the template until layout personalization — reordering must be a data change, not a re-integration); cross-slot dedupe; off-limits slots never touched; absent decision → host default renders (never blocked, never arbitrary fill); snapshot endpoint for first paint (no flash). **The host application always paints — the engine never renders, injects, or touches the DOM.**
8. **The learning ladder** (locked D-3 — each stage's exhaust feeds the next; rungs cannot be skipped):
   - **S1 — learns the shopper**: affinity-matched content (everything above).
   - **S2 — learns what works**: per-item, context-conditioned outcome statistics over the open catalog — smoothed conversion lift vs the context baseline (empirical-Bayes toward 1.0, configurable prior strength), folded into ranking multiplicatively; a configurable deterministic **exploration share** per slot (default 10%) so new content accumulates evidence. **Item-level statistics, never variation buckets — explicitly NOT bandit-dependent.** A contextual bandit remains an optional per-slot instrument, never the engine.
   - **S3 — learns what matters**: offline discovery over accumulated decisions/outcomes → human-approved proposals. Never self-activating.
9. **The v1 dimension registry** (the HTML §06): location/regional (4.6), visit number (bucketed 1 / 2–3 / 4+, seeded defaults reweighted by outcomes), entry channel (UTM+referrer taxonomy; context attribute + optional strategy override), content-type affinity, + the behavioral core (line, silhouette/category, occasion, price band). Registry is **versioned**; adding a dimension later = registry change + backfill decision (learns from activation forward; backfill where raw events were retained).
10. **Control & DS-injection surfaces**: every constant above is a visible, versioned, hot-editable parameter (no redeploy); full decision/outcome egress; priors import (externally-derived seed weights entering as labeled prior mass under the same decay); custom scoring hooks as a defined extension point.

### 4.8 Identity — design target

Stable, device-scoped, first-party visitor ID (`opt_visitor_id`: localStorage + 1-year cookie; no fingerprinting). Sessions = inactivity gap (30 min default); **visit number increments per visit boundary, not per event** (POC bug — see §6). Anonymous-first is the founding premise: everything works from the first click of a first visit; identity (e.g., hashed email → CDP stitching) only ever lengthens memory. Erasure = one call (`POST /reset` on the DO).

### 4.9 The AI boundary (architectural invariant)

**"The engine decides; AI creates and explains."** Generative AI appears in exactly three places, none in the serving path: design-time content enrichment (human-approved), operator-facing authoring/insight (optional assistant layer), and optional shopper-facing AI features (search/advisor/scene-gen — separate, metered, cacheable). The decision path is arithmetic, always.

## 5. Code map (reference implementation)

| Path | Role | Status |
|---|---|---|
| `src/reflex/core.ts` | The math: DimensionSpec, decay/saturation/hysteresis, touch extraction, explain records, DEFAULT_REFLEX_CONFIG | BUILT (config compile-time — see §6) |
| `src/reflex/audienceGenerator.ts` | Catalog→audience generation, diff-regen, pin/hash protection | BUILT |
| `src/durable-objects/ShopperReflex.ts` | The DO host: SQLite state, hibernation, ingest doors, closed-form alarms, push | BUILT (dark behind `REFLEX_HOST`) |
| `src/services/RealtimeSegmentEngine.ts` + `SessionManager.ts` | Session host + session/attribute machinery | BUILT (visit-count bug §6) |
| `src/services/odpLoop.ts` | CDP connector: forward/upsert/seed, vuid, mirrored audiences | BUILT-VERIFIED (debts §6) |
| `src/services/CatalogService.ts` | Product catalog + similarity recs + segment sort | BUILT |
| `src/services/geo/cohort.ts`, `src/routes/geo.ts` | Geo detection, grain ladder, cohort cold-start (demo data) | BUILT (demo-swapped data) |
| `src/routes/realtime.ts` | Ingestion seam (`actionEventSchema`), capture chokepoint, snapshot | BUILT |
| `src/routes/operator.ts` + `public/operator-console.js` | Operator API + console (audience review; suggest→approve pattern) | BUILT (unauthenticated §6) |
| `src/services/cmab.ts`, `optimizelyFx.ts`, `experimentFx.ts` | Experimentation integration (optional instrument) | BUILT |
| `src/services/sceneGen.ts` + queue consumer in `src/index.ts` | Async LLM job plumbing (the pattern for design-time enrichment) | BUILT (for another feature; reuse the shape) |
| `public/storefront.js` | Demo client — contains the SDK-to-be (~300 lines of connect/emit/listen buried in 4,192 demo lines) | BUILT-IN-MONOLITH |
| `migrations/` (0001–0005) | D1 schema: events capture, geo census, dimension enrichment views | BUILT |
| `wrangler.toml` | Bindings truth (note: `[env.staging]`/`[env.production]` are name-only shells — dev bindings are top-level) | — |

Tests: `src/reflex/*.test.ts` — **56 real test cases** (an older doc claims 112 — wrong). The harness in this checkout is broken (missing `vitest-environment-miniflare`); fix before trusting a green/red signal.

## 6. Known divergences — implement the DESIGN, not these

1. **Visit counting is wrong in the POC**: increments per update/event, not per visit boundary (`SessionManager.ts:121`; DO `:508`). Design: idle-gap visit boundaries on the visitor record.
2. **Purchases are not forwarded to the CDP** (`odpLoop.ts:82-104` has no purchase case). Design: all outcome events forwarded — S2 depends on it.
3. **CDP identity is session-derived** (vuid = SHA-256(sessionId)) so cross-session memory doesn't accrue to one profile. Design: stable visitor ID.
4. **Config is compile-time** (`DEFAULT_REFLEX_CONFIG` imported as const everywhere; the designed KV-versioned hot-editable ReflexConfig is not yet coded). Design: every parameter versioned + hot-editable — this is a headline promise (tuning UI).
5. **Operator routes are unauthenticated and CORS reflects any origin with credentials** (`index.ts:47-71`; auth middleware exists in `src/middleware/auth.ts` but is applied nowhere). Design: SDK-key auth on client surface, operator auth on config surface, origin allowlist.
6. **Regional trending, the content engine (catalog/telemetry/ranker/assembler), strategies, tenancy, priors import, decision persistence/egress, and the packaged SDK are DESIGNED, not coded.** The designs are complete (docs 18/19 + the HTML); treat them as the spec.
7. **Explain records are generated but not persisted** (no last-N ring, no export).
8. **Demo artifacts** — do not replicate: the `/__shot` screenshot-verification route (internal testing only; gate/remove in production), geo-cohort's swapped demo data, `demo_events` in D1 as a telemetry store (hits the 10GB cap ~100K sessions/mo — a real product uses a proper analytics store), hardcoded Coach-isms in engine defaults (e.g., `upsertOdpProfile` attribute names — tenancy work removes them).
9. **One hard-won testing lesson** (bake into your mirror's test culture): verify **rendered state, not attributes** — a demo bug passed tests that asserted a `hidden` attribute while CSS specificity kept the element visible. Assert computed display/geometry or behavioral outcomes.

## 7. The loyalty test — invariants your mirror must satisfy

- [ ] Deterministic serving path; no model call at decision time; identical inputs → identical scores, reproducible from the explain record.
- [ ] Decay/saturation/hysteresis semantics exactly as §4.1 (lazy decay; per-dimension τ/K/θ).
- [ ] Dimensions/audiences generated from the tenant's catalog — zero hard-coded taxonomies.
- [ ] Two-level scoring: bounded per-shopper tag state; items ranked only at decision time.
- [ ] Page-level ordered decision set with `order` from day one; dedupe; off-limits slots; absent → default; first-paint snapshot; **host always paints**.
- [ ] Content addressed by the customer's own ID, echoed back in every decision.
- [ ] Explain record on every decision; every constant a visible, versioned, hot-editable parameter.
- [ ] Regional trending as a blend-time prior over anonymous aggregates — never written into the personal vector, never storing per-shopper location history.
- [ ] Standalone serving: no experiment required for any decision; bandits strictly optional per slot.
- [ ] Anonymous-first identity; erasure as a first-class operation; CDP as a pluggable, additive connector (engine fully functional without it).
- [ ] Outcome learning = item-level context-conditioned statistics + deterministic exploration share — never variation buckets.
- [ ] Immutable catalog snapshots; enrichment human-approved and design-time only.

## 8. Platform primitive → role mapping (if the mirror's substrate differs)

| Cloudflare primitive (here) | Abstract role your mirror needs |
|---|---|
| Durable Object (+SQLite, alarms, hibernation) | Per-visitor single-threaded stateful actor: durable state, timers, socket push, cheap at rest |
| Workers KV + version-marker in-process cache | Low-latency versioned config/read-mostly data with near-zero per-request reads |
| D1 (SQLite) | Relational capture/rollups (POC-grade; product-grade telemetry belongs in a real analytics store) |
| Queues | Async fan-out for enrichment jobs and CDP forwarding (`waitUntil` for fire-and-forget) |
| R2 | Blob cache (generated assets, cached once per new asset) |
| WebSockets (hibernatable) | Live decision push + ingest door; SDK fallback to polling/snapshot |
| `request.cf` geo | Coarse request geolocation (country/region/metro) with zero client permissions |

## 9. Open-source hygiene — the never-carry list

The **capabilities** mirror; the **context** does not. None of the following may appear in the open-source project in any form — code, comments, docs, fixtures, commit messages, test data:

- Customer and person names, brands, or engagements visible in this repo (retailer names, banking demo names, partner-project codenames, people). Genericize: "the tenant," "the pilot brand," "a reference storefront."
- Contract details, milestones, calendar dates, acceptance bars tied to a customer, internal effort estimates, anything from `Tapestry-Implementation-Plan.md` or ledger §§1–2/4–5.
- All commercial material: pricing, unit economics, margins, GTM plays, credit/packaging models.
- Secrets and credentials: `llm-models-keys.md` (gitignored), `.dev.vars`, any ODP/CDP keys, API keys. Never echo, never commit, anywhere.
- Vendor-specific integrations as *dependencies*: ODP/Opal/Feature Experimentation appear here as connectors behind seams. In the mirror, keep the seams (`CDP connector`, `assistant layer`, `experimentation adapter`) pluggable; include vendor implementations only if that project explicitly chooses to.
- Demo assets (product images, brand copy, synthetic schemas named after brands) and demo-only routes (`/__shot`).

Working-agreement gotchas if you operate inside THIS repo: never run `npm ci` (use `npm install`); do not restore `.npmrc.bak`; no `@optimizely/*` private packages; deploy only via `npm run deploy` (`--env production|staging` ships binding-less workers today); commit/push only when explicitly asked.

## 10. Your first hour

1. Read §§1–9 above, then docs in the §3 order (1–5 minimum).
2. Open `docs/content-personalization-design-tapesrty.html` in a browser and click through the persona and ordering widgets — they encode the product intent better than any prose.
3. `npm install` (never `ci`), then skim `src/reflex/core.ts` end to end (~400 lines) — the whole engine's semantics live there.
4. Trace one event's life: `public/storefront.js` (emit) → `src/routes/realtime.ts` (ingest/capture) → host (`RealtimeSegmentEngine`/`ShopperReflex`) → `core.ts` (score) → push/audiences → `odpLoop.ts` (forward/seed).
5. Diff your understanding against ledger §3 (built-vs-gap) and §6 here (divergences). Anything you'd port from code, check it isn't on the divergence list first.
6. Write your mirror's plan against §7's checklist — that checklist is the definition of "loyal."
