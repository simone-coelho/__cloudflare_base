# Behavioral Targeting and Intelligence — Implementation Plan

**Prepared for:** Tapestry (Mandeep, Nitin, platform & data science teams)
**Status:** DRAFT FOR YOUR RESPONSE — as agreed on our call: this is the plan as we would hand it to our own engineering team, with our fastest realistic sequence. Nothing here is a hard commitment yet; you adjust dates against your side's calendar and send it back, and the agreed result becomes the milestone set we commit to contractually.
**Companion document:** *Behavioral Targeting and Intelligence — Solution & Algorithm* (the what and the how; this document is the when and the who).

---

## 1. The one-paragraph plan

Stand the platform up brand-by-brand, **Coach first**: lock the dimension registry and content taxonomy with your data science team in the first working sessions; bring your content into the content catalog and calibrate tagging together; deliver the decision service, the SDK, and the tuning surface into a staging environment your teams can integrate against — **SDK and integration documentation in your developers' hands by mid-October, the full content-recommendations API accepted in your lower environments by end of October** — so integration work can start before your November code freeze; then integrate and test through your freeze window on your calendar, and launch on one page in January with a joint announcement. Every date past end-October is deliberately left open for you to shape in your response.

## 2. What this builds on (why the sequence is short)

Version 1 is a **fusion of two systems we have already proven**, not a from-scratch build:

- **The behavioral engine is live today.** The real-time affinity scoring you saw demonstrated — decayed per-dimension interest, self-building audiences, instant response, wired into ODP — is running in production form now. The work in this plan extends it (location/regional trending, visit and channel dimensions, content-type affinity); it does not create it.
- **The delivery contract is proven at enterprise scale.** We operate a deterministic content-by-ID delivery engine in production for a major enterprise: multi-widget pages resolved per request, duplicates removed across the page, a governed fallback per slot, content addressed purely by ID so the customer's front end always paints. Version 1 reuses that contract shape — with live behavioral scoring doing the picking instead of fixed business rules.

What is genuinely new — and therefore what this plan sequences carefully — is the content catalog and its adapters, the content decision service, the per-slot strategy layer, the regional trending dimension, the tuning surface, multi-brand provisioning, and the packaged SDK.

## 3. Scope of version 1 (the acceptance bar)

Defined fully in the Solution & Algorithm document; restated here because milestones point at it:

> On the pilot brand's homepage, with a candidate pool of 20–30 assets, **different visitors verifiably see different content, chosen by the agreed dimension registry** — location (with regional trending), visit number, entry channel, content-type affinity, and the behavioral affinities — with **weight configurability live** in the tuning surface, an **explain record behind every decision**, and your defaults rendering wherever no decision applies.

Working in spirit and in behavior from day one; tuning after launch sharpens it. The dimension registry ships with the agreed 6–8 dimensions — **location in from the start**.

## 4. Workstreams

| # | Workstream | What it delivers |
|---|---|---|
| W1 | **Registry & taxonomy working sessions** | The agreed 6–8 dimensions with default weights; the content-type taxonomy; the slot map per template; the payload contract reviewed with your front-end team |
| W2 | **Content catalog** | Your content registered (your IDs, types, tags, slot eligibility, lifecycle, brand), immutable catalog snapshots, a source adapter for your CMS/DAM — with a manual import path available immediately so nothing waits on adapter work |
| W3 | **Content telemetry** | Impression / click / dwell / video-completion signals flowing per content item, feeding both per-shopper scoring and outcome learning |
| W4 | **Decision service** | Per-slot ranking over the catalog, page-level ordered decision payloads, first-paint snapshot endpoint, cross-slot dedupe, off-limits enforcement, default fallback |
| W5 | **Dimension build-out** | Regional trending (population-level, aggregates only — no per-shopper location state), visit-number boundaries, entry-channel classification, content-type affinity |
| W6 | **Strategies & tuning surface** | Per-slot strategy profiles (configured and autonomous modes) and the tuning UI: every weight, decay horizon, and threshold visible and editable by your team, versioned, effective immediately |
| W7 | **Multi-brand provisioning** | Coach as the launch tenant — its own catalog, configuration, audiences, credentials — with hard data isolation between brands, so extending to Kate Spade and the rest of the portfolio later is provisioning, not re-engineering |
| W8 | **SDK & integration kit** | A small versioned client (connect / emit / listen + first-paint hydration), integration guide, payload schema reference — the artifact your developers integrate before the freeze |
| W9 | **Staging environment & security** | The staging platform your lower environments consume: authenticated APIs (SDK keys for the client surface, operator auth for configuration), CORS allow-listing for your origins, deployment runbook |
| W10 | **Transparency & data science surfaces** | Explain-record persistence and export, decision/outcome data egress, priors import (seed the model from your Snowflake-derived analyses), debug endpoints |
| W11 | **Content enrichment pipeline** | Design-time AI tagging proposals over sparse metadata with your team's approval step — calibrated on an early sample batch, never in the serving path |
| W12 | **Outcome-learning design (learning stage 2)** | The design for context-conditioned outcome statistics and the exploration policy is finalized during this plan; the learning itself activates after launch, once live traffic accumulates — that gate is data volume, not build time |

## 5. Milestones

Dates assume kickoff within two weeks of this document and the dependency dates in §6. **M0–M4 are the proposal we are asking you to pressure-test; M5–M6 are deliberately open for you to shape.**

| Milestone | What is true when it's done | Target |
|---|---|---|
| **M0 — Working sessions complete** | Dimension registry signed off (6–8 dims, location included); content-type taxonomy agreed; slot map for the pilot page(s) defined; payload contract reviewed with your front-end team; first content sample received | Within 2 weeks of kickoff |
| **M1 — Content catalog live** | Your first content batch registered and enriched (tagging calibrated together); catalog snapshots activating in our staging | Mid-September |
| **M2 — Feature-complete demonstration** | The full v1 running in our staging against your content: per-visitor decisions on the agreed dimensions, strategies per slot, tuning surface live — demonstrated to your team, feedback round taken | End of September |
| **M3 — Integration kit in your hands** | SDK + integration guide + API reference delivered; your staging origins connected (auth, CORS, network path verified); your developers can begin integration — **this is the line that protects your November freeze** | Mid-October |
| **M4 — Acceptance in your lower environment** | The §3 acceptance bar demonstrated end-to-end in *your* staging: 20–30 homepage assets, verifiably different per visitor, weights live-tunable, every decision explainable | **End of October** |
| **M5 — Integration & test window** | Your teams integrate and test inside your environments through the freeze window; we support with fixes, tuning sessions, and joint test runs | November–December — **your calendar; to be shaped in your response** |
| **M6 — First page live + joint announcement** | Launch on one page (homepage proposed) on the pilot brand; co-built-innovation announcement | January — **proposed, to confirm together** |

## 6. Dependencies — both sides, stated plainly

**What we need from Tapestry (gating milestone in parentheses):**

| # | Item | Needed by |
|---|---|---|
| D1 | Working-session participants: data science/analytics for the registry, front-end lead for the payload contract, content ops for the taxonomy | Kickoff (M0) |
| D2 | Content sample (~100–500 assets) with whatever metadata exists — sparse is fine | M0 |
| D3 | Content feed access: CMS/DAM API credentials *or* an export path (JSON/CSV) — the manual path unblocks us immediately if API access takes longer | M1 |
| D4 | Slot map + default content per slot for the pilot page(s) | M0 |
| D5 | Staging origins list + network review: confirm your environments can reach our staging endpoints incl. WebSockets, or tell us early if a custom domain is required (DNS lead time) | Before M3 |
| D6 | Conversion/order event (order ID, items, value) — one integration point, needed for outcome learning | With M5 integration |
| D7 | ODP instance decision for the pilot brand (durable memory + audience sharing); the engine runs standalone if this lands later — the profile memory story simply joins when it does | Before M4 (flexible) |
| D8 | Security review inputs (auth expectations for operator access), if your security team wants more than API-key + SSO-backed operator auth | Before M3 |
| D9 | Front-end integration capacity between M3 and your freeze | M3→M5 |

**What we own:** everything in §4; the working-session materials arriving *before* each session (nobody workshops a blank page); staging operations; integration support through M5; the acceptance run at M4 as a scripted, repeatable demonstration — not a hand-wave.

## 7. The data questions, answered directly

Your team asked where the data comes from, how it's aggregated, who can access it, and at what latency:

- **Where it comes from.** First-party only: behavioral events from your site via the SDK; your content and product feeds; coarse request geolocation from the edge network (country/region/metro — no device permissions, no PII, no third-party data); your ODP profiles; optionally, priors your data scientists derive in Snowflake and push to us.
- **How it's aggregated.** Three layers, deliberately separate: per-shopper interest vectors (bounded, decaying, held at the edge keyed to a first-party visitor ID); population-level regional aggregates for trending (anonymous counts only — no per-shopper location history is ever stored); and aggregate outcome statistics (content × context × outcome) for learning stage 2.
- **Who can access it.** Your team — via the tuning surface, the operator APIs, and full export of decision/explain/outcome records; durable profile facts live in *your* ODP instance. Shopper erasure is a single API call. Nothing is locked in a place you can't see.
- **At what latency.** In-session decisions are computed at the edge in milliseconds; first paint is served from a snapshot endpoint so there is no flash of default content; cross-session memory re-seeds at session start in under a second; regional trends publish continuously on a minutes-scale cadence; exports are on demand.

## 8. Learning logic in this plan

Stage 1 — *learning the shopper* — is what launches: everything in the Solution & Algorithm document's registry and scoring sections. Stage 2 — *learning what works* — is **designed inside this plan (W12) and activates after launch**: it requires weeks of live decision-and-outcome data before its statistics mean anything, so its gate is data volume, not engineering. Stage 3 — *discovery* — follows as a governed, human-approved surface. We will show the stage-2 design at M2 so your data scientists can critique it long before it turns on.

## 9. How we run it together

A short weekly checkpoint (30 minutes) from kickoff through M4; a live demonstration at every milestone — M1, M2, M4 are shown running, not reported; a shared tracker of the §6 dependencies so nothing surprises either side; and your data science team invited into the registry, the stage-2 design review, and the tuning surface from the first session — this system is designed to be *theirs to drive*, and the earlier they have their hands on the weights, the better the launch tuning will be.

## 10. Assumptions & open items

- Kickoff within two weeks of this document; the §6 dependency dates hold.
- Launch brand is Coach, launch page is the homepage (the page is changeable in your response — the plan shape doesn't move).
- Our staging runs in our cloud account; your environments consume it over authenticated APIs. If your security or network teams require a custom domain or additional auth arrangements, we accommodate — flagged early via D5/D8 because they carry lead time.
- M5's shape (what "integration complete" means inside your freeze process) and M6's launch date are yours to define in the response round — we have left them open on purpose.

---

*Send back your adjusted dates and the D1–D9 owners on your side, and we'll return the final milestone set for the contract.*
