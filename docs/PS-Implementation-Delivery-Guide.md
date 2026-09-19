# Implementation & Delivery Guide — Edge Personalization Platform

## Current accountable handoff qualification

Use the signed-session, explicit-consent, recoverable publication and run-owned cleanup kit. Local engineering checks do not automatically accept a customer milestone. Delivery includes generic model-assisted sample enrichment with per-label human review, dedicated catalog-grounded search, durable behavior/ranking/decision/outcome sources and disabled scheduled Snowflake SQL API delivery with locally supplied receiver SQL.

Provider egress/metering/retention approval, real taxonomy/feed/identity mapping, receiver installation/concurrency/history deletion, sample calibration and actual customer acceptance remain named live work. Product Rec entitlement is commercial evidence, not a new recommendation engine. SFCC D4/candidate-preserving rendering is joint customer integration. Existing SSO and typed CSV/JSON attributes/audience handoffs remain commitments. Optional no-additional-cost widget/template handoff is availability-triggered, not January widget construction.

**Audience:** INTERNAL — Professional Services, solutions/enterprise engineering, monetization & procurement.
**Purpose:** what it actually takes to implement this platform for a customer: the deployment and isolation model, who does what (RACI), the phase-by-phase playbook with effort ranges, the SDK and instrumentation work, customer prerequisites, and Day-2 operations — so PS can run a repeatable motion and monetization can package it with real units.
**What this guide is NOT:** pricing (it provides effort units; pricing is monetization's call), the customer-facing solution documents (those exist per engagement), or the platform build plan (internal ledger: `docs/architecture/19-tapestry-delivery-ledger.md`). This guide is customer-generic by design.

---

## 1. What the customer gets (one page)

A real-time edge personalization platform, deployed and operated by Optimizely on Cloudflare, delivering:

- **Behavioral affinity engine** — deterministic, per-shopper interest scoring on an agreed registry of 6–8 dimensions (location/regional trending, visit number, entry channel, content-type affinity, plus catalog-driven behavioral dimensions). Works for fully anonymous traffic from the first click. No ML call in the serving path — every decision is transparent arithmetic with an explain record.
- **Self-building audiences** — generated from the customer's own catalog vocabulary, human-reviewable (rename/pin/prune), instantly responsive to behavior.
- **Product recommendations** — item-similarity ranking with segment-aware ordering ("memberships gate, scores rank").
- **Content recommendations** — the customer's content registered by *their* IDs in a content catalog, ranked per shopper per slot, delivered as a page-level ordered decision set over WebSocket/snapshot. **The customer's front end always paints** — we never inject into their pages.
- **Strategies & tuning** — per-slot dimension-weight profiles (customer-configured or engine-autonomous), every parameter visible and hot-editable in the tuning UI.
- **CDP integration (optional, additive)** — ODP as durable memory (profile, cross-session facts, audience sharing). The engine runs fully without it.

Commercial boundary worth repeating to every internal audience: **the live decision path consumes zero AI credits** — see `docs/Opal-Credit-Boundary-Pricing-Guide.md`. Cost basis: `docs/Edge-Unit-Economics.md`.

## 2. Deployment & isolation model — DECIDED: stamp per customer

**One codebase, deployed as a separate Cloudflare Worker per customer** ("a stamp"), each with its own Durable Object namespaces, KV, D1, queues, R2, secrets, and domain. Two levels of isolation:

- **Customer = stamp — hard isolation.** No shared compute, no shared storage, no shared keys between customers. The one-sentence answer for any customer's security review.
- **Brand = tenant inside the stamp — logical isolation.** A multi-brand customer runs all brands in one stamp with per-brand catalogs, configuration, audiences, and credentials, namespaced throughout.

| Layer | Isolation guarantee (per customer) |
|---|---|
| Compute | Dedicated worker; independent limits; no noisy neighbor |
| Shopper state | Dedicated Durable Object namespace (per-visitor actors) |
| Config & catalogs | Dedicated KV namespaces |
| Event capture / rollups | Dedicated D1 database |
| Async jobs & generated assets | Dedicated queues + R2 bucket |
| Credentials | Per-stamp secrets; per-brand CDP/SDK keys inside |
| Network | Custom domain or scoped workers.dev; per-customer CORS allowlist |
| **Releases** | **Version pinned per stamp** — one customer can hold through a code freeze while another upgrades |
| Observability | Per-worker logs/analytics streams |

**Provisioning is scripted** (templated wrangler configuration + CI deploy matrix): target ≤1 day of solutions-engineering effort per stamp at steady state (2–3 days for the first few while automation matures). "Scoping to a customer" concretely = bindings + secrets + domain/DNS + CORS allowlist + dimension-registry config + catalog source wiring + brand tenants.

Scale path: at a handful-to-dozens of enterprise customers, stamps are the right ops model. If this ever becomes self-serve at volume, Cloudflare's Workers for Platforms (dispatch namespaces) is the migration path — the tenant-agnostic core required for stamps is the same core that model needs.

## 3. Who does what — DECIDED: PS owns implementation

| Actor | Owns | Explicitly does NOT own |
|---|---|---|
| **Product engineering** | The platform codebase, releases, SDK artifact, platform docs; L3 escalation | Anything per-customer |
| **Solutions / enterprise engineering** | Stamp provisioning & scoping, infra changes (domains, network), upgrades/rollbacks; L2 escalation | Customer-facing implementation work |
| **Professional Services** | The implementation motion end-to-end: workshops, tag plan & instrumentation QA, catalog onboarding, SDK integration support, tuning & acceptance, launch & hypercare; L1 during implementation | Platform code, stamp infrastructure |
| **Customer** | Front-end SDK integration, content feed/access, conversion event, slot map ownership, network/security approvals, a named tuning owner | — |

This split is what makes the motion repeatable and priceable: engineering effort per customer is a provisioning script, and everything customer-paced lives in PS where it can be packaged as an SOW.

## 4. The implementation playbook — phases, effort, drivers

Effort in person-days (pd). Calendar durations are dominated by *customer* scheduling, not our work.

| Phase | What happens | Owner | Effort | Variance drivers |
|---|---|---|---|---|
| **P0 — Handoff & readiness** | Pre-sales → PS handoff; prerequisites checklist (§8) scored; gaps flagged into the SOW | PS | 1–2 pd | Checklist completeness at sale time |
| **P1 — Discovery & design workshops** | Three sessions: (a) dimension registry + content-type taxonomy sign-off, (b) slot map + delivery-contract review with their front-end team, (c) data & integration planning (events, conversion, environments). PS brings pre-filled straw-man materials — nobody workshops a blank page | PS (+ customer DS/FE/content leads) | 4–6 pd over 1–2 wks | Number of brands/page types; DS team depth |
| **P2 — Stamp provisioning & scoping** | Worker + bindings + secrets + domain + CORS + registry config + brand tenants | Solutions eng | 0.5–1 pd (first-of-fleet 2–3) | Custom domain/DNS lead time; their network review |
| **P3 — Catalog onboarding** | Feed mapping (CMS/DAM API or export), source adapter config, enrichment calibration (AI proposes tags on the sample batch; customer approves), snapshot activation | PS (+ customer content team 2–4 pd) | 3–8 pd | API vs manual export; metadata sparsity; asset volume |
| **P4 — Instrumentation & tagging** | Tag plan from template; dataLayer/GTM adapter mapping OR declarative attributes; commerce events; conversion event; QA with the event-validation overlay | PS 3–5 pd; customer 2–5 pd | see drivers → | **The #1 driver: dataLayer maturity.** No dataLayer = 10–15 customer pd — surface this in the SOW as customer scope, never absorb it silently |
| **P5 — SDK integration** | Listen module install, slot wiring, first-paint hydration, default-fallback verification | Customer FE 2–5 pd; PS support 1–3 pd | Framework/SSR complexity; slot count |
| **P6 — Tuning & acceptance** | Seed strategy weights per slot; per-visitor variation QA **verified on rendered state, not attributes**; scripted acceptance run (N-asset pool, verifiably different picks per visitor, live weight change re-ranks, explain record behind every decision) | PS | 3–5 pd | Slot/strategy count |
| **P7 — Launch & hypercare** | Go-live, monitoring watch, weekly tuning session, 2-week hypercare window | PS | 2–4 pd spread | — |

**Typical totals (one brand, one page type, mature dataLayer):** PS **17–33 pd**, customer 6–14 pd, solutions eng ~1 pd, over **6–10 calendar weeks**. Each **additional brand** in the same stamp: ~5–8 PS pd (catalog + tuning; the stamp already exists). **No dataLayer:** add 10–15 customer pd and 2–4 calendar weeks.

## 5. The SDK — DECIDED: one package, two modules

One npm package (+ CDN script build), tree-shakeable, browser-first:

- **Core (shared, mandatory):** server-issued signed shopper/profile authority (cookie/body hints only restrict; no fingerprinting), session boundaries, the WebSocket + snapshot transport, SDK-key auth. Shared core is non-negotiable: events and decisions must be keyed to the *same* visitor ID, and one socket serves both directions.
- **Emit module (tracking):** four capture paths, used together —
  1. *Automatic:* renderer callback plus exact durable ACK for the actually painted original receipt; receipt of a choice alone is not capture;
  2. *Declarative:* `data-*` attributes on slots/elements for view/click capture;
  3. *Adapter:* dataLayer/GTM mapping for sites with an existing tag layer (most retail sites — this is the cheap path);
  4. *Explicit API:* commerce events (add-to-cart, purchase/conversion) — the conversion event is non-negotiable for outcome learning.
- **Listen module (decisions):** supported coalesced snapshot refresh and per-slot callbacks; local same-grant server-first-paint adoption implements the conditional no-repaint path, while real customer SSR/browser/no-flash acceptance remains open, graceful absence (no decision → customer default renders; the page never waits on us).
- **Listen-only mode** is supported for customers who insist on keeping their existing analytics pipeline — ordinary commerce/page events can use the adapter; rendered admission is suppressed, so content outcomes need the supported exact ACK and cannot bypass it. PS must QA the actual pipeline.
- **Native apps:** later port, by design — the contract is transport-level JSON; nothing about it is browser-specific. Do not sell native as available; sell the contract as portable.

## 6. Instrumentation — the chapter PS lives in

Nothing works without events. The engine scores what it receives; a silent site is an empty thermometer.

**The event schema (what the tag plan must produce):** page/product views · product interactions (view/wishlist/add-to-cart with product attributes flattened) · content interactions (impression/click/dwell/video-completion with content tags) · purchase/conversion (order ID, items, value) · context (entry channel from UTM/referrer — captured automatically by the SDK core; coarse geo comes from the edge, zero client work).

**Consent:** both hosts require the server-issued signed shopper capability and an explicit preference choice with original choice ID, expected consent revision and signed grant ID/iat/exp. Missing/legacy choice is OFF; cookies and body hints can only restrict. Personalization off gives customer defaults; independently approved tracking can still produce measurement, while tracking off blocks behavioral capture/forwarding/learning. `POST /v1/:tenant/identity/erase` uses current operator authority and returns bounded, resumable local progress plus frozen destination reconciliation obligations. It is not proof that every provider or historical copy was deleted.

**Method selection:** dataLayer adapter first wherever a tag layer exists; declarative attributes for slot-level capture; explicit API for commerce. The tag plan template (page types × events × method × owner × status) is filled in during P1 and executed in P4.

**QA:** PS can opt into the redacted SDK debug view for dispatch counts, response counts, closed socket states and RTT; it retains no full schema, score, ID/token or raw payload and is not a consumer receipt. Tagging is DONE only after the accountable tag-plan owner verifies each page/event against approved source/consumer evidence and the actual rendered experience, not after a debug dispatch or code merge.

## 7. Content pipeline onboarding

Per brand: content feed (their ID, type from the agreed taxonomy, render URL, tags, slot eligibility, lifecycle) via CMS/DAM API or JSON/CSV export → source adapter → **immutable snapshots** (build → validate → activate; requests never see a half-loaded catalog). Sparse metadata is expected: the enrichment pipeline proposes tags (design-time AI, never in the serving path) and **the customer approves them** — calibrated on an early ~100–500-asset sample during P3. Merchandiser controls carry over from day one: per-slot pinned overrides ("this campaign owns the hero during the promo window"), priority rules, exclusions, off-limits slots.

### 7.1 Content metadata: the customer's fields to ours

*Added 2026-09-04 (CW32). Tapestry's BTIE document (appendix A.3.6) names the metadata an ML-ranked content
library needs. Every one of them has a home in our piece schema; most already existed under another name.
The authoritative field list is `docs/kit/03-payload-schemas.md`, "The content piece". This page is the
translation, so a content team tags once and correctly.*

| Their field (A.3.6) | Ours | How it is used | Note |
|---|---|---|---|
| `style_cluster` (classic, contemporary, minimalist, maximalist) | a tag on a registry dimension, e.g. `tags: { styleWorld: ["minimalist"] }` | Scored against the shopper's affinity for that dimension, weighted per slot | The dimension's name is the brand's choice at registry time; `styleWorld` is what the demo uses |
| `journey_stage_fit` (`[explore, consider]`, `[decide]`) | `journeyStageFit: ["exploring", "considering"]` | A slot's `stage` rule demotes a piece made for another stage and can bonus one made for the shopper's | Their words are accepted as written; `early` / `mid` / `late` also accepted. Absent fits every stage |
| `occasion_tags` (work, evening, weekend, travel, special-event) | `tags: { occasion: [...] }` | A registry dimension like any other | Multi-valued |
| `featured_product_ids` (`["SKU123", "SKU456"]`) | `featuredProductIds: ["SKU123", "SKU456"]` | Carried on the piece and the receipt, in the customer's product ids, validated, never rewritten | Links content to product decisions |
| `price_tier` (entry, core, aspirational) | `tags: { priceBand: ["core"] }` | Scored against the shopper's price posture, the same dimension products carry | Our bands are `entry` / `core` / `elevated`; a brand may name its own cuts in the registry |
| `content_format` (hero-image, carousel, video, editorial, lookbook) | `type`, and `tags: { contentType: [...] }` | Known content events learn the held catalog's format tags, the same keys ranking uses | `type` stays the rendering kind; an absent own format tag uses safe `type` on non-default live input only. Explicit tags win, so film/video and lookbook/on-model need no hard-coded alias |
| `content_embedding` (64-dim vector) | not stored | An embedding model scores as the external model term (`learn.external`), with a latency budget, itemised on the receipt | We do not learn dense vectors; the profile is a readable vector over the registry. Their model plugs in |
| `freshness_date` | `freshnessDate` (ISO 8601) | A slot's `freshness` rule gives a bonus that halves per half-life from this date | Absent: ages from `window.from` |
| `min_impressions` (1000 hero, 500 modules) | the slot's exploration `floor` on the learn document | Explicitly enabled rotation considers eligible under-observed pieces; it does not guarantee a minimum impression count | Per slot, not per piece; shipped exploration is off. The UI initializes a floor of 50 only when enabled |
| *(implied by A.4)* inventory | `inStock` (`in_stock` / `ats` in a feed) | `false` removes the piece from every decision | Absent means in stock |
| *(implied by A.3.5)* seen-before | nothing to tag | A slot's `fatigue` rule penalises what this shopper was served inside a window, from the ledger's ring | Automatic |

What a content team therefore supplies per piece, beyond the required id, type, title, tags and slot types:
`journeyStageFit`, `freshnessDate`, `featuredProductIds`, `inStock`, and the `merchandising` signals
(`season`, `promotion`, `margin`, each 0 to 1) when the multipliers are on. Everything else is a slot
setting a merchandiser makes once.

The bounded format-learning contract is in the kit's **Content format affinity** section: a complete
safe 1–8-value list, non-derived registered `contentType`, tenant-owned cached lookup and failure
refusal. Raw-event source/multiplicity does not reduce a held catalog's dimension-keyed list. Catalogs
and historical profiles are not rewritten; old receipts replay tags-only scoring via the absent
content-type policy marker. Idless/unknown-ID compatibility is not proof of an authenticated exposure.
Registry vocabulary, locale, inheritance and end-to-end customer feed acceptance remain separate.

A feed answer is never silent about what it could not use. An accepted import or pull says how many
stored pieces it created or altered (`changed`, counted from the stored values, so a re-import of the
same export answers zero), how many it dropped (`removed`, so a replace that empties the catalog says
so instead of reporting no change), and what both were measured against (`changedBasis`: `stored`, or
`unavailable` with null counts when the base revision cannot be read, rather than counting every
stored piece as created). Its advisory `diagnostics` name every field or column the contract does not
list, every key the submitted catalog document itself carries beside its pieces and version label,
every tag value whose spellings differ only by case, every slot type the tenant's slots document does
not define, and every dimension the tenant's published registry does not hold — named, never
rewritten — beside the slots document they were compared against. The channel counts each code
exactly (`counts`) and always shows at least one warning of every code that occurred, so its
50-warning sample can never hide a whole class of defect. A CSV header that matches a documented
column only when case is ignored is refused rather than imported into an empty taxonomy — including a
header-only or all-blank export, because the columns are read from the header — as is a journey-stage
word outside the accepted vocabulary, and both refusals name what the feed sent. This is feedback on
one submitted feed, not registry vocabulary, case or locale normalization.

## 8. Customer prerequisites checklist (the qualification list)

Score at P0; every "no" is SOW scope or a timeline risk:

1. Content inventory with stable IDs and render URLs
2. CMS/DAM API access **or** export capability (JSON/CSV)
3. A slot-map owner (someone empowered to name personalizable slots + defaults per template)
4. Front-end capacity: one workshop + 2–5 integration days
5. dataLayer / tag-manager status known (**the #1 cost driver — ask this at pre-sales**)
6. Conversion/order event feasible
7. Network: WebSocket egress permitted; custom-domain decision made (DNS lead time)
8. A named tuning owner (merchandiser/analyst) for the weights
9. Optional: ODP instance (per brand) for durable memory — the platform runs without it
10. Privacy review inputs accepted: first-party ID only, coarse geo, population-level aggregates (no per-shopper location history), one-call erasure

## 9. Day-2 operations

- **We operate the stamps** (managed-service posture): monitoring (worker analytics, DO health, event-flow alarms — "no events for N minutes" pages someone), upgrades on the per-stamp pinning policy with scheduled windows and changelogs, backup/retention per data store.
- **Incident tiers:** L1 PS (during implementation/hypercare) → L2 solutions engineering (stamp/infra) → L3 product engineering (platform).
- **Customer self-serve surfaces:** the tuning UI (weights/decay/thresholds per dimension and per slot), audience review (rename/pin/prune), catalog refresh, decision/outcome exports.
- **Recurring PS attach:** quarterly tuning reviews and post-launch optimization blocks — a natural, valuable recurring line (the system exposes every lever; most customers want a guide for the first pulls).

## 10. Monetization inputs — the SOW units

| Line | Type | Unit basis |
|---|---|---|
| Standard implementation (1 brand, 1 page type, mature dataLayer) | One-time SOW | ~20 PS pd (range 17–33) + ~1 solutions-eng pd |
| Extended implementation (multi-page, no dataLayer, complex CMS) | One-time SOW | 30–45 PS pd; customer-side tagging scope stated explicitly |
| Additional brand (same customer stamp) | One-time SOW increment | 5–8 PS pd |
| Platform operation | Recurring | Per stamp — cost basis in `Edge-Unit-Economics.md` (traffic-scaled; no AI cost in the decision path) |
| Support | Recurring | Tiered per §9 |
| Tuning/optimization blocks | Recurring attach | PS pd blocks (e.g., quarterly) |
| Optional AI features & credits | Separate meters | See `Opal-Credit-Boundary-Pricing-Guide.md` — never blended with traffic pricing |

These are **effort units, not prices** — packaging and pricing are monetization's decisions.

## 11. FAQ

**"Are we reusing the Java CRePE solution from the earlier enterprise engagement?"** — No, and we don't need to. Its *contract and invariants* (content-by-ID, atomic catalog snapshots, slot eligibility/exclusions, per-slot fallbacks, cross-page dedupe, explain metadata) are reimplemented natively in the edge content engine, with the picker upgraded from fixed business rules to live affinity scoring — plus per-slot pins and priority rules for full rules-lane parity. Reimplementation from first principles also keeps the IP story clean: no code from a customer engagement enters the product line.
**"Can multiple customers really share this?"** — Each customer gets their own stamp: separate worker, storage, keys, domain. Brands within a customer share their stamp with logical isolation. Nothing is commingled across customers.
**"What if the customer doesn't have ODP?"** — The CDP connector is additive. The engine is fully functional standalone; ODP joins when they're ready and the memory story gets deeper.
**"Native apps?"** — Browser-first today. The delivery contract is transport-level JSON; a native SDK is a port on the roadmap, not a redesign.
**"Does shopper traffic consume AI credits?"** — Ordinary personalization ranking is deterministic and consumes no runtime-model credits. Separately enabled enrichment/insight/NL-search features have their own provider/metering policy (see the credit-boundary guide).
**"What's built vs. in build?"** — The behavioral engine, audiences, product recs, and CDP loop are live; the content engine, tuning UI, tenancy, and SDK packaging are in active build. Current truth lives in the internal ledger — check it before making customer commitments.

---

🔗 `ONBOARDING.md` (engineer bootstrap) · `docs/architecture/16-edge-affinity-reflex.md` + `18-content-affinity-engine.md` (architecture) · `docs/Content-Personalization-Explained-Simply.md` (plain-language) · `docs/Edge-Unit-Economics.md` + `docs/Opal-Credit-Boundary-Pricing-Guide.md` (commercial) · `docs/architecture/19-tapestry-delivery-ledger.md` (INTERNAL build truth)
