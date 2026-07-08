# Cold Start & Affinity (as-built)

**Status:** as-built, verified 2026-07-08. The June design (per-click graph-spread scoring, four precomputed KV artifacts, referrer/UTM context priors, nightly cron) was **superseded before build** — none of those artifacts exist. It is preserved at [legacy/06-cold-start-affinity-2026-06.md](./legacy/06-cold-start-affinity-2026-06.md). What shipped is simpler and stronger.

---

## 1. Cold start — the geo-cohort opening prior

A no-history shopper's **first paint** adapts to where they are: real edge geolocation (`request.cf`) + real public census data, rolled up ZIP → metro → region → national with a first-party N≥30 gate (`src/services/geo/cohort.ts`; routes `GET /geo`, `GET /geo/cohort`). Policy: **curate, never price**. Full spec: [doc 13](./13-geo-cohort-coldstart-prd-tdd.md). The referrer/UTM priors table from the old design was never built — geo replaced it.

## 2. In-session affinity — the Edge Affinity Reflex

From the first engagement, behavior takes over via the reflex (`src/reflex/core.ts`): a **decayed per-dimension vector** — `R ← R·e^(−Δt/τ) + w`, read lazily as `a = R/(R+K)`, hysteresis θ_in/θ_out — over the catalog's six axes, with audiences **generated from the catalog** and protected diff-regeneration. Deterministic; every membership change carries an explain record. This is **different math** from the old design (no multiplicative per-click spread, no static artifacts — scores are computed from raw `(R, tLast)` at read time). Design: [doc 16](./16-edge-affinity-reflex.md) · hand-over: [technical design](../Edge-Affinity-Reflex-Technical-Design.md).

Tunables live in `DEFAULT_REFLEX_CONFIG` (τ=60s demo, K=1.8, θ 0.6/0.45) with the `REFLEX_ENABLED` kill switch — **not** in an Optimizely feature variable as the old design proposed. Audience generation runs lazily at engine boot behind a KV version marker (`reflex:audgen:v1`) — no nightly cron exists (the `scheduled` handler is a stub).

## 3. Item-item similarity (what survived the old design)

The 7-dimension weighted attribute kernel lives in `CatalogService.sim()` (weights in the single `ATTR_WEIGHTS` const: line 0.30 · category 0.22 · occasion 0.14 · silhouette 0.10 · color 0.08 · material 0.08 · priceBand 0.08), precomputed into a top-12 neighbor graph. It drives `getRecommendations`, `sortForSegments`, and `completeTheLook`. Fully attribute-driven → catalog-agnostic.

## 4. Cross-session warm start — ODP

Durable memory is ODP, not a local artifact: qualified ODP audiences seed the session via the `recent_events` GraphQL read and **union** into the segment set (`local ∪ reflex ∪ odpSeed`), and the reflex's scores are upserted onto the ODP profile. See [doc 16 §8](./16-edge-affinity-reflex.md) and the [ODP wiring spec](../Coach-ODP-Wiring-Spec.md).

## 5. Honesty boundary

Deterministic scoring, not ML (ODP's predictive insights are the ML layer). Real: edge geo, census, catalog, behavioral events, the reflex math. Synthetic: first-party purchase history (real schemas, sample rows, labeled).
