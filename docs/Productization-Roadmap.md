# Productization Roadmap — From the Tapestry Build to a Product

**Audience:** INTERNAL — engineering + leadership. This is the build plan: how we go from what exists today (a single-tenant, Coach-themed, demo-instrumented system) to a **multi-tenant, onboardable, priced product**. Companion docs: [GTM-Delivery-Playbook](./GTM-Delivery-Playbook.md) (the sales/CSM half), [Edge-Unit-Economics](./Edge-Unit-Economics.md) (the cost basis), doc 18 (content engine design), doc 16 (reflex engineering).
**Timeline convention:** all estimates below are the **internal (AI-speed) track** — real build effort. External commitments stay as published; we beat them.

---

## 1. What "the product" means (the target state)

A customer we've never met can be onboarded by: pointing the engine at **their catalog** (products and, later, content), connecting **their ODP**, dropping **our SDK** into their front end, and tuning **their weights** in a UI — with their tenant fully isolated, their costs metered, the demo scaffolding gone, and nothing about Coach anywhere in the path. Everything below is the distance between today and that sentence.

## 2. Current state (verified, as of this writing)

| Area | State |
|---|---|
| Affinity engine (scoring, decay, hysteresis, explain) | **Product-grade and live** — pure core, 112 tests, per-dimension config |
| Catalog-generated audiences | **Live** — generator + diff-regeneration + human-edit protection |
| ODP loop (events out, instant seed, profile upsert) | **Live-verified** against a real ODP instance |
| P2 hot-path hosting (per-shopper hibernating DO) | **Built, shipped dark** — flag not flipped |
| Affinity Instrument / demo storefront | Live — but it *is* the Coach demo, not a product surface |
| Tuning UI | **Not built** — committed externally (this week) |
| Content catalog / content personalization (S1) | **Designed** (doc 18) — not built |
| Customer SDK | Mechanics exist inside `storefront.js` — **not packaged** |
| Multi-tenancy | **None** — single tenant, Coach-themed, one config |
| Production telemetry | **Demo-grade** — D1 `demo_events` (10GB cap ≈ 100K sessions/mo) |
| Security posture | Demo trust model — operator/experiment routes **unauthenticated** |
| Deploy environments | One worker; staging/prod envs declare no bindings |
| Cost posture | $12.95/1K engaged sessions; known levers to ~$1.19 |

## 3. The workstreams — here to there

Each entry: what it is → what exists to build on → internal estimate.

**W1 — Tuning UI** *(the external commitment; first)*
Per-dimension AND per-audience weight / decay (τ) / threshold (θ) editing over the versioned ReflexConfig (KV-backed — tuning without redeploy), audience review (rename/pin/prune — `AudienceDef.pinned`/`source` already support it), per-audience content association (the S1 mapping surface). Build on: the config model + `GET /realtime/reflex` already exposing `config.dims`. **Internal: 1–2 days.**

**W2 — P2 cutover + cost levers** *(the margin decision)*
Flip `REFLEX_HOST='do'` per the cutover runbook; migrate the relay-DO broadcasters (operator publish, feature-override, demo trigger) to the ShopperReflex socket; retire the relay DO. Apply **Lever A** (cache audience defs in-process on the existing `reflex:audgen:v1` marker — kills ~59 KV reads/event, −$5–6/1K, and the biggest hot-path latency) and **Lever C** (demo_events index diet). Build on: everything's built; this is wiring + verification. **Internal: 1–2 days.** Effect: COGS −44% immediately, ~10× with levers.

**W3 — Production telemetry + the database decision** *(resolves the D1 red flag)*
Replace demo-grade `demo_events` capture with a production event store. **Decision for leadership (options, not a decree):**
- *(a)* **Neon/Postgres via Hyperdrive** — no 10GB cap, real SQL analytics surface for S2 outcome aggregation, familiar ops; adds an external dependency + per-query latency (fine — telemetry is off the hot path).
- *(b)* **D1 with aggressive pruning/rollup** — zero new infra; requires retention discipline and per-tenant DB sharding at scale.
- *(c)* **Analytics Engine for metrics + object storage for raw events** — cheapest; weakest ad-hoc query story.
Recommendation: **(a)** for the product (it also becomes the S2 aggregation store), (b) acceptable for early single-tenant deployments. Build on: capture is a single chokepoint (`captureDemoEvent`) — swapping the sink is contained. **Internal: 1–2 days** once the decision is made.

**W4 — Multi-tenancy** *(the biggest structural lift)*
Per-tenant: catalog + content-catalog namespaces, ReflexConfig, audience store, ODP credentials, DO key-spacing (`tenant:visitor`), D1/DB isolation, and theming stripped out of the engine (Coach becomes tenant #1's config, not the code). Build on: doc 15's D-2 portability posture, the config-driven design, the single-sourcing already done. **Internal: ~1 week.** This is the gate between "reference customer" and "product."

**W5 — Customer SDK packaging**
Extract connect/emit/listen from `storefront.js` into a versioned, embeddable client (`@optimizely/edge-personalization` shape): stable visitor identity, event emission, decision listener, content-decision payloads (doc 18 §7), snapshot hydration. Build on: every mechanic exists and is proven; this is extraction + API design + docs. **Internal: 2–3 days** (+ the payload workshop with each customer's front-end team).

**W6 — Content Affinity S1** *(task #10; the Tapestry rung-2 commitment)*
Content catalog + source adapter + LLM enrichment pass + content telemetry + decision-time ranker, per doc 18. Engine-side work is independent of customer inputs; the adapter needs their CMS access. **Internal: 3–4 days engine-side.**

**W7 — Identity unification**
`opt_visitor_id` ⇄ ODP vuid mapping (today vuid is session-derived); cross-session continuity end-to-end; "new shopper" semantics preserved. **Internal: ~1 day.**

**W8 — Security & platform hardening**
Auth on operator/experiment/tuning routes (today: demo trust model — a blocker for any real tenant), rate limits beyond `/api/*`, per-env deploy bindings (staging/prod currently ship binding-less — documented, not fixed), secrets/tenancy review. **Internal: 2–3 days.**

**W9 — Observability & the transparency surface**
Analytics Engine metrics wired on the personalization path (entries/exits, latencies, decision rates — currently `/health` counters only), plus the Opal-backed reporting the customers demanded on-call (what was decided, for whom, why, at what lift). This is also the productized answer to the CMAB-transparency product gap. **Internal: 2–3 days.**

**W10 — Onboarding automation**
The §1 sentence made real: a tenant-provisioning path (catalog ingest → audience generation → config scaffold → SDK keys) so onboarding is configuration, not engineering. Build on: W4's tenant model + the generator (already catalog-agnostic). **Internal: 2–3 days after W4.**

## 4. Sequencing

```
PHASE A — commitments + margin (days, all parallel):
  W1 tuning UI  ·  W2 cutover + levers  ·  W8-lite (auth on operator/tuning routes)
PHASE B — the product core (week ~2):
  W6 content S1 (engine-side)  ·  W5 SDK  ·  W3 telemetry (decision then build)  ·  W7 identity
PHASE C — productization proper (weeks 3–4):
  W4 multi-tenancy  →  W10 onboarding automation  ·  W9 observability  ·  W8 full hardening
```

Gating logic: Phase A is externally committed and margin-critical — nothing blocks it. W4 (tenancy) gates W10 and true "product" status. W3's *decision* gates its build but nothing else. Tapestry's rung-3 (~2-month outcome learning) rides on W6 shipping and traffic accumulating — the calendar there is data physics, not build time.

**Total internal build effort, here → product: roughly 3–4 working weeks at AI speed.** The external ladder (weeks / ~2 months / ~6 months) remains comfortably beatable — the buffer absorbs customer-side inputs (CMS access, workshops, approvals), which are the true long poles.

## 5. Decisions leadership owns (the roadmap's open switches)

1. **Telemetry database (W3):** Neon/Postgres vs D1-with-discipline vs AE+objects — recommendation (a); resolves the scale red flag.
2. **P2 cutover window (W2):** engineering is ready; it's a −44% COGS decision — pick a quiet window.
3. **Branding/packaging** of the offering (deliberately left open in all docs; marketing's call).
4. **Pricing structure** from the economics annex floors (pricing team's call).
5. **Design-partner terms** for ASOS (what rung-2/3 shaping rights they get).

---

*This document is the "here to there." The playbook tells the field teams how to sell and run the ladder; this tells us how the ladder becomes a product. Both carry the dual-track dating rule: everything above is the internal track.*
