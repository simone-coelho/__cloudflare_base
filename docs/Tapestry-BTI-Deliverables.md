# Behavioral Targeting and Intelligence — What Tapestry Receives

**Product definition and deliverables for the SOW.** This is what we are committing to deliver. Package, format, and price it as needed.

---

## What the product is

**A real-time behavioral decisioning engine that runs at the edge of the network, holds a live interest profile for every visitor including the ones you cannot identify, and changes what the page shows at the moment that interest changes.**

It is not a segmentation tool that assigns visitors to buckets overnight, and it is not a model that decides for reasons nobody can inspect. Six properties define it, and each one is a departure from how personalization engines conventionally work.

**1. It decides in the request path, at the edge.** Decisions are computed in the same network hop that serves the visitor, in milliseconds. There is no round trip to a central decisioning service, and therefore no latency budget to negotiate against page performance.

**2. Every visitor has a live profile, not an assigned segment.** Each visitor is backed by their own stateful actor holding a per-dimension interest vector that updates on every interaction. Interest is a continuously recalculated quantity, not a label applied by a nightly job.

**3. The connection stays open, and decisions are pushed.** This is the property that most distinguishes the product. First paint is served from a snapshot, so nothing flashes or reflows. Then a persistent connection stays open for the duration of the session, and when the visitor's interest shifts, **the new decision is pushed to the page that is already open.** Conventional engines make one decision, at page load, and are then blind until the next navigation. This one keeps deciding, and the page keeps reflecting it. A shopper who reveals what they want in their third click does not have to load a new page to be understood.

**4. Interest decays, so visitors leave audiences as well as join them.** Affinity has a half-life. A visitor who stops engaging with a category exits that audience on their own, in session, without anyone writing an exit rule. Almost nothing else in the market models the exit, which is why stale personalization is the industry's most common failure.

**5. It is deterministic. No model sits on the decision path.** Every score is a readable number, every weight is editable, every decision carries an explain record naming the drivers that produced it. Merchandising authority sits above the engine: eligibility gates run before scoring, pins and blocks outrank it, and the weighted ranking operates only in the space that is left. The team can inspect it, tune it, override it, and inject their own math into it.

**6. Per-visitor state is held per dimension, never per item.** This is why the same engine ranks the hero images on one page and an entire product catalog at identical cost per decision, and why adding catalog volume is a data-ingestion exercise rather than a scaling problem.

### What those properties make possible

- Personalization for visitors who have never been seen before and are not identified, from the first click of a first visit.
- A page that reorganizes itself mid-session as intent becomes clear, rather than at the next page load.
- Audiences that build and dissolve themselves from behavior, in the merchandising team's own vocabulary, without anyone authoring rules.
- A single interest profile driving both product ranking and content selection, so the merchandising and the storytelling agree with each other.
- An auditable answer to "why did this shopper see this," available for every decision the system has ever made.

---

## The deliverables

The components below are what constitutes that product.

**1. Decision service.** A running service that returns, for each visitor, which items win each personalized slot and in what order, addressed by Tapestry's own IDs. It serves **both content decisions and product decisions** from one engine and one per-visitor affinity vector. Tapestry's front end renders. We never inject into or modify their pages.

**2. Catalogs.** Two, both registered under Tapestry's own IDs:
   - **Content catalog** — content type, tags, per-slot eligibility, and lifecycle windows, with a source adapter for their CMS or DAM plus a manual import path available from day one so nothing waits on adapter work.
   - **Product catalog** — the product feed and its attribute taxonomy, which serves two purposes: it is the candidate set for product ranking, and it defines the dimension vocabulary that content is tagged against.

**2a. Product recommendations.** Per-visitor ranked product lists, delivered into a widget, a carousel, or as a sort order, each item carrying its explain reference. Eligibility gates (inventory, price validity) run before scoring, merchandiser pins and blocks outrank the engine, and the weight profile is configurable per placement in the same tuning surface as content.

**2b. Ranking against Salesforce Commerce Cloud.** Where Tapestry's commerce platform returns a product set, the engine re-ranks and re-sorts that set per shopper and returns the reordered IDs for Tapestry's front end to paint. This requires the returned set to carry the attributes the engine scores against, either inline in the commerce response or resolvable through a product feed keyed to the same IDs. Salesforce Commerce Cloud remains authoritative for availability and price; the engine decides the order within what it returns. Where the commerce platform paginates server-side, ranking operates within the returned page.

**3. Dimension registry.** Every dimension the engine scores on, documented explicitly, with default weights: location including regional trending, visit number, entry channel, content type and metadata, and the behavioral affinities derived from their catalogs. The registry is versioned and extensible, so dimensions are added by configuration as Tapestry's team learns what matters. No undocumented dimensions, no hidden logic.

**4. Per-slot strategies.** A configurable weight profile per slot, so different slots on the same page can be driven by different logic. Supports both configured weights and engine-autonomous modes.

**5. Tuning surface.** Every weight, decay horizon, and threshold visible and editable by Tapestry's team, versioned, effective immediately, with no deployment required.

**6. Explain records.** Every decision carries the drivers, scores, and context that produced it. Persisted and exportable.

**7. SDK and integration kit.** A versioned client library (connect, emit, listen, plus first-paint hydration), an integration guide, and a payload schema reference. This is the artifact their developers integrate.

**8. Behavioral telemetry.** Product signals (view, save, cart, purchase) and content signals (impression, click, dwell, video completion) captured per item, feeding both per-visitor scoring and outcome learning. Content signals are exposure-normalized, since an impression is nearly intent-free while a cart add is not.

**9. Staging environment.** The platform their lower environments consume: authenticated APIs, SDK keys for the client surface, operator authentication for configuration, CORS allow-listing for their origins, and a deployment runbook.

**10. Data science surfaces.** Explain-record export, decision and outcome data egress, priors import so their data scientists can seed the model from their own Snowflake analyses, and debug endpoints.

**11. Content enrichment pipeline.** Design-time AI tagging proposals over sparse metadata, with their team's approval step. Calibrated on an early sample batch. Never in the serving path.

**12. Multi-brand provisioning.** Per-brand content catalogs, configurations, strategy profiles, and audiences, with hard data isolation between brands. Extending to the next brand is provisioning, not re-engineering.

**13. Outcome-learning design.** The design for context-conditioned outcome statistics and the exploration policy, delivered and reviewed with their data science team. Activation follows launch, gated on live data volume rather than build time.

---

### Shopper-facing AI surfaces

Three conversational surfaces, all built on the same principle as the rest of the platform: **the model interprets language, the deterministic engine decides what is shown.** Every result resolves to a real catalog ID, so nothing can be hallucinated into the experience.

**14. AI Search.** A natural-language search surface. The shopper's query is parsed into structured intent — categories, product lines, occasions, colors, silhouettes, price floor and ceiling, price band, gift mode — and that intent is then ranked **deterministically** over Tapestry's real catalog, blended with the shopper's live affinity. The model never selects products; it only interprets the request. Results are always real, in stock, and personalized. The same call also authors the editorial copy that headlines the results — headline, supporting line, and the scene direction for the hero image — at no additional latency.

**15. Style Concierge.** A streaming conversational stylist that builds looks and capsules rather than returning a list. It holds the catalog in context, pairs an anchor piece with complementary items, and gives on-brand rationale referencing pieces by name. It is genuinely conversational: each message can refine or correct the last, it honors the most recent request, it respects colour preferences and avoid-lists, and it will not repeat pieces it has already shown while a shopper is refining. It leans toward the shopper's demonstrated affinity, but an explicit request always wins, and it will say plainly when the catalog cannot satisfy a request rather than substituting silently. Every recommendation is emitted as real catalog IDs that the client resolves.

**16. Editorial scene generation.** Styled hero imagery generated for search results and concierge recommendations, staging a real product in a scene matched to the shopper's request. Generation runs asynchronously on a queue so no shopper request ever waits on it; images are cached in object storage and served to everyone thereafter, and the surface falls back cleanly to standard imagery if a scene is not yet ready.

**Commercial note.** These three surfaces consume AI capacity per use, unlike the decision engine, which is deterministic and consumes none. They are metered separately from platform usage and from authoring credits. Scene generation is billed per new image generated, not per view, because images are cached after first generation.

---

## What "delivered" means

> On the launch brand's homepage, different visitors verifiably see different content, chosen by the agreed dimension registry, with weight configurability live in the tuning surface, an explain record behind every decision, and Tapestry's defaults rendering wherever no decision applies.

Demonstrated end to end in Tapestry's own lower environment, as a scripted, repeatable run.

**On volumes.** **Nothing in this scope is bounded by catalog size.** Per-visitor state is held per dimension, never per item, so the engine's architecture and its cost per decision are identical whether it is ranking the hero images on one page or Tapestry's full product catalog. Catalog volume is a data-ingestion question, not a capability question. Any figures appearing in the working documents describe demonstration scenarios and are not system limits.

---

## What Tapestry provides

1. Working-session participants: data science for the registry, a front-end lead for the payload contract, content operations for the taxonomy.
2. Content feed access: CMS or DAM credentials, or an export path. Whatever metadata exists is enough to start; the enrichment pipeline fills the gaps.
3. Product feed access: the product catalog and its attribute taxonomy.
4. Slot map and default content for the launch page.
5. Staging origins list and network review, including WebSocket access.
6. Conversion and order event, one integration point.
7. ODP instance decision for the launch brand.
8. Security review inputs, if more than API-key and SSO-backed operator access is required.
9. Front-end integration capacity between delivery of the integration kit and their code freeze.

---

## Not included

This section states what we do not deliver. It makes no assumption about what Tapestry runs today or what they choose to keep, retire, or run alongside. Those are their decisions.

- A content management system.
- A commerce platform, merchandising rules engine, or inventory system.
- Front-end rendering. We return decisions by ID; Tapestry's applications render them.

---

## Sequence

The milestone sequence, the workstream detail behind each deliverable above, and the dependency dates are in the Implementation Plan already sent to Mandeep. That document was written to be answered: his adjusted dates and named owners come back, and the agreed result becomes the contractual milestone set.
