# 26 · Tapestry's BTIE requirements against what is built

*Internal, delivery team only — the same rule as doc 20. Reviewed 2026-09-04 against
`tapestry_requirements.txt` (BTIE v2.0, January 2026, "From Segments to Individual Intelligence").
Every "built" below points at a file; every "gap" says whose lane and roughly how long.*

## 0 · How to read this

The BTIE document is Tapestry's **vision**: Avinash's manifesto, a three-phase roadmap that runs to
deep reinforcement learning, natural-language generation and an in-house recommendation platform. What
Tapestry **contracted** is the Scope of Services v8: twelve capabilities, a Coach pilot, dates in October and
January. The two are not the same document, and the most useful thing this review can do is keep them
apart:

- Where BTIE asks for something the contract also promises, a gap is a gap and goes on ledger 20.
- Where BTIE asks for something the contract does not promise, the question is **position**, not build:
  what we say when Tapestry's team holds the vision document next to our engine.
- Where BTIE asks for a *mechanism* (embeddings, Kafka, a vector database) rather than an *outcome*,
  the honest answer names the outcome we deliver and the different mechanism we deliver it with. Their
  document says it itself: "either can get us where we need to go."

One structural fact to keep in front of everyone: §5.3.1 of their document says they evaluated ten-plus
vendors, none offered real-time individual-level content and experience personalization, and "we need to
build it." **They then contracted us to build exactly that.** Our engine is the Phase 1 MVP their document
describes, and Phase 1's exit criterion — "working ML prototype demonstrating lift vs. segment rules" —
is precisely the number ledger row 12 exists to produce.

## 1 · The verdict in one paragraph

Of BTIE's five Phase 1 MVP capabilities, three are built and proven (real-time event streaming, the
unified profile with cross-device identity, the content ranking model), one is built in a different form
than they name (the contextual bandit: a per-cell learning loop with three exploration modes, Thompson
sampling among them, rather than a bandit library), and one is deliberately built another way (user and
content "embeddings": an interpretable vector over the agreed registry rather than a learned dense one,
with the external-model hook as the seam for theirs). Of the nine design principles, seven hold today, one
is partial (implicit signals: dwell and video yes, scroll depth and hover no), and one we contradict on
purpose and must say so (fingerprint-based identity for anonymous visitors; the scope says no
fingerprinting). Of their current-state gaps, four of five are closed. The real deltas — the ones worth
building before the pilot — are journey stage on the content decision, a freshness term, value-weighted
rewards, consent enforcement, and erasure across the ledger. None is large. The measurement chapter is the
one place where their document is stricter than ours in a way we should simply adopt.

## 2 · The Phase 1 MVP five

| BTIE capability | State | Where | The honest sentence |
|---|---|---|---|
| **Real-Time Event Streaming** — "can't personalize on click 2 if we don't know about click 1 until tomorrow" | ✅ | `POST /realtime/action`, the socket, `ShopperReflex` / the session host; the SDK's emit | Every interaction is scored at the edge on arrival and the profile is updated in the same request; the push comes back over the socket. No batch anywhere on the path. The ledger (Phase 0) is the durable stream: R2 partitions by brand and hour, Analytics Engine per record. Their "<10ms from event to consumer" is a Kafka number; ours is measured per request on staging when it exists (D12) |
| **Unified Customer Profile** — one view per visitor, logged-in cross-device and anonymous session-based | ✅ | the shopper's session/object, CW7 visits and entry channel, CW25 identity (`docs/architecture/25`) | One profile per visitor from the first click; on sign-in the browser's profile folds into the person's and every device of that person shares it; ODP holds the CRM-facing copy. Both of their "optimization classes" (§5.2.1) exist: anonymous is session-and-visitor based, recognised is the person |
| **User & Content Embeddings** — vector representations for similarity and cold start | ◐ different by design | `src/reflex/core.ts` (the vector), the content catalog's tags, `src/learn/external.ts` (the seam) | The visitor's profile **is** a vector: one coordinate per (dimension, value) of the agreed registry, decaying in real time. Content carries tags over the same dimensions, so "this content fits this taste" is a dot product a merchandiser can read. What it is not is a learned dense embedding. Cold start is population priors (regional trend, entry-channel cell) rather than nearest-neighbour users. Their embedding model, if they build one, plugs in as the external model term with a hard latency budget, itemised on the receipt (Phase 3, live) |
| **Content Ranking Model** — "THE CORE INTELLIGENCE" | ✅ | `src/content/service.ts`, `decide.ts`, `src/reflex/contentCompose.ts` | Every eligible piece is scored against the individual: affinity × slot weights, the regional prior, learned lift^γ, their model's term, merchandising multipliers, exploration, pins — each itemised on a receipt. Their five ranking factors map onto it (§5 below) with one hole: journey fit |
| **Contextual Bandit** — Thompson sampling, 48–72 h to signal, per-audience arms | ◐ built differently, and partly the same | `src/learn/` (stats, fan-in, snapshots, `explore.ts`), the learn document's dials | Evidence is pooled per (slot, item, context cell) with shrinkage to coarser cells — that is their "per-audience arms". Exploration has three modes: rotation (under-observed items get shown), epsilon, and **Thompson** (a Beta sample per item on its own counts). The trust dial γ is per slot and starts at 0 (shadow), so learning runs and shows before it changes anything. Not a bandit library, and we should not call it one; "a contextual learning loop with Thompson-sampled exploration" is true. **Blind today under the default policy until R12-1 lands** (plan 21) |

## 3 · The nine design principles (§5.2)

| # | Principle | Holds? | Evidence / the gap |
|---|---|---|---|
| 1 | One visitor, one profile; recognise the same person across devices and sessions | ✅ | CW25: deterministic on sign-in, durable first-party id otherwise. See D7 on "probabilistic" |
| 2 | Learn immediately, not overnight | ✅ | The reflex updates in the request; the lift snapshot publishes on a coalesced write, not a nightly job |
| 3 | Recency-weighted signals, exponential decay | ✅ | Exactly the engine's invariant: s·e^(−Δt/τ), per dimension, tunable live (`/tuning.html`) |
| 4 | Multi-modal signal fusion: implicit (scroll, hover, dwell) + explicit, calibrated weights | ◐ | Dwell, impression (weight 0 by default, deliberately), video completion, click, cart, purchase — each weighted in the registry. Scroll depth and hover are not captured (D6) |
| 5 | Similar users like similar things (cold start from lookalikes) | ◐ | Population priors by region and entry channel (regional trend, CW6; geo cohort), the pooling ladder by cell. Not nearest-neighbour users (D8) |
| 6 | Explore-exploit balance | ✅ | `explore.ts`, per slot, three modes, flagged on every receipt |
| 7 | Graceful degradation | ✅ | Every failure resolves to a default: config, cold shopper, external model budget, missing snapshot, pinned piece. Nothing on the path can take a decision down |
| 8 | Policy & governance layer: guardrails, data minimisation, consent, right to be forgotten, GDPR/CCPA | ◐ | Pins, blocks, eligibility windows, clamped multipliers, no raw account id stored, erasure of the profile. **Consent flags exist but nothing enforces them (D10); erasure does not reach the ledger (D9); no explicit diversity or inventory rule (D11)** |
| 9 | Embedding-first architecture | ◐ | Interpretable-vector-first, by design; the embedding seam is the external model term (D8) |

## 4 · The capability matrix (§5.3.1, fourteen rows)

| Capability | State | Note |
|---|---|---|
| Real-Time Event Streaming | ✅ | above |
| Impression Tracking | ◐ | The SDK captures viewport impressions and dwell automatically; every decision served is a record in the ledger (what was shown). Missing: **using** it — a "seen before" penalty on the next decision (D2) |
| Unified Customer Profile | ✅ | above |
| Real-time Feature Store (<100 ms) | ✅ in effect | The profile lives where the decision runs (edge KV / the shopper object); the lift snapshot is a KV read. No separate store to size. Latency to be measured on staging (D12) |
| User & Content Embeddings | ◐ | above (D8) |
| Vector Database (<75 ms similarity) | — | Not needed for the mechanism we use; catalogs of thousands, not millions, rank in-request. Position, not build |
| Journey Stage Classifier (See/Think/Do) | ◐ | `src/services/JourneyStage.ts`: early / mid / late from counters (deep browse, wishlist, cart, purchase) — rule-based, on the demo's decision path and in the audience layer. **Not a dimension of the content decision's context cell, and content carries no stage fit (D1)** |
| Content Ranking Model | ✅ | above |
| Experience Orchestration (which modules, what order) | ◐ | Slot strategies per page (take, weights, pin), section ordering (Meridian), hero module by journey stage (demo, FX flags). Stage-aware module selection on the content service waits on D1 |
| Contextual Bandit | ◐ | above |
| Deep Reinforcement Learning | — | Their Phase 2 pilot, Phase 3 deployment. Out of scope; the ledger and replay are what a DRL team would train and evaluate against |
| Natural Language Generation | — | Out of scope. Adjacent and demonstrable: the Signal-Led Moment generates hero image and copy variants through Opal (`/ai/scene`), which is the shape of their "NLG pilot". Say it as a demo, not a deliverable |
| Multi-Objective Optimization | ◐ | Margin, season and promotion are tunable, clamped, itemised multipliers (row 6). Profit as the *learning objective* needs value-weighted rewards (D3). Returns, LTV, brand equity: out of scope |
| Causal Inference Measurement | ◐ | Holdout assignment, the arm report, intervals and needed-n (`src/measure/holdout.ts`), replay as counterfactual, policy comparison. Uplift modelling: no. Blind until R12-1 |
| Policy & Governance Layer | ◐ | §3 row 8 |

## 5 · The content strategy (A.3)

**A.3.3, their five ranking factors → ours.**

| Their factor (weight) | Ours |
|---|---|
| Style similarity (35 %) | Affinity × the slot's dimension weights — the merchandiser sets the split per slot, which is their 35 % made tunable |
| Journey fit (25 %) | **Missing on the content decision** (D1). Exists on the demo path as the hero-module choice by stage |
| Engagement prediction (25 %) | lift^γ from pooled outcomes per cell, plus their model's term if they bring one |
| Freshness (10 %): new content, and has the user seen it | Lifecycle and publish windows gate eligibility; nothing scores recency or "seen before" (D2) |
| Exploration (5 %) | The exploration share per slot (default 10 %) and the rotation floor |

**A.3.4, the journey stage × content matrix** — needs D1: stage on the cell, `journeyStageFit` on the piece,
and a slot rule that filters or demotes content outside the visitor's stage. The matrix itself is content
metadata plus one rule; it is not a model.

**A.3.5, the bandit specifics.** Thompson sampling: a mode we have. "New content ~10 % of impressions,
poor performers fade in 48–72 h": exploration share 0.1 and the rotation floor cover the first half; the lift
decays on a 21-day horizon (`tauLearnMs`) which is the second half at a slower pace, and it is a dial. "Bandits
run per-audience segment": the cell ladder. "Reward: CTR primary, dwell > 30 s, scroll > 50 %, conversion":
click, dwell, video, wishlist, add-to-bag, purchase are rewards today; scroll is not (D6). "Cold content starts
with a prior from similar content": priors import exists per item and per coarser key; automatic inheritance
from a style cluster does not (small, their lane, low priority).

**A.3.6, the metadata schema → our piece schema.**

| Their field | Ours today | Gap |
|---|---|---|
| `style_cluster` | a tag dimension (`styleWorld` on Meridian; any registry dimension on a customer scope) | naming only |
| `journey_stage_fit` | — | D1 |
| `occasion_tags` | `occasion` tag | — |
| `featured_product_ids` | — | D5: add to the piece schema so content inherits product affinity and links to the product decision |
| `price_tier` | `priceBand` exists for products; a piece can carry it as a tag | naming only |
| `content_format` | `type` (video, editorial, on-model, silo) | — |
| `content_embedding` | — | D8: the external model term is where an embedding score enters |
| `freshness_date` | `window.from/to` for eligibility | D2 for scoring |
| `min_impressions` | the rotation `floor` (default 50) | naming only |

**A.3.7, content operations** — volume, variants, metadata discipline, per-segment visibility, auto-fade,
validate-before-publish. The catalog is validated on every write (CW2), versioned, with lifecycle and
windows; the learning console shows per-cell performance and lets a merchandiser freeze, reset or reject an
item. Auto-fade is the lift decay plus a merchandiser's reject. This section is largely theirs to operate;
our part exists.

## 6 · Measurement (§6) — adopt their rules

Their chapter is the best-written part of the document and it is stricter than our defaults in three places
we should simply match:

| Their rule | Ours | Do |
|---|---|---|
| Holdout 5–10 %, **permanent**, assigned on a persistent identifier | 5 % default, deterministic on the visitor id, sticky; the salt can rotate | Document that the salt is set once per brand and never rotated during a measurement period; the hash fix R12-3 before launch, because a rotation later is what they warn against |
| Holdout sees the current production experience (segment rules) | The `default` arm serves no personalization: the site's own defaults | Same thing, said the same way |
| 90 %+ significance | 95 % intervals in `compareArms` | ✅ D4 (2026-09-05): a confidence parameter, and the verdict at the other level always beside it |
| Pre-set targets: minimum +10 % CVR lift, target +40 %, stretch +60 %; RPV +10/+25/+40; returns < +5 % | Nothing compares against a pre-set target | ✅ D4 (2026-09-05): the CVR-lift targets are read on the low end of the relative interval, in the sentence. RPV and returns need a value-weighted rate (CW27's objective) and a returns feed; not yet |
| Aggregate over windows, not point-in-time; monthly, quarterly, bi-annual | `pooled()` exists; the report is per day | ✅ D4 (2026-09-05): `GET …/learn/report/window?from=&to=` pools the day reports and names the days without one |
| Attribution is not incrementality | Our word for it: the arm report is the incrementality number; the attribution policies are for learning, and the console shows them side by side | Keep saying it their way |
| IABI reporting: insight, action, business impact | The sentence `compareArms` writes is an insight with an action ("needs about N more decisions per arm"); business impact is not computed | Position: the console is the operating surface; IABI is the analyst's document over it |

## 7 · Policy and governance (A.4)

| Their constraint | Ours | Gap |
|---|---|---|
| No click-bait patterns | The reward is what the merchandiser names per slot; a purchase-weighted reward cannot be gamed by a click | D3 makes this concrete |
| No over-emphasis on discount signals | The promotion multiplier is clamped (at most 2×, at least 0.5×) and itemised; a merchandiser can set it to zero | Say it |
| Diversity constraints | Within one page a piece is used once; no cross-category rule | D11 |
| Legal compliance, GDPR/CCPA | No raw account id stored; profile erasure exists; consent flags exist | D9, D10 |
| Merchandising commitments | Pins, outranking the engine absolutely and surviving regeneration | ✅ |
| Inventory constraints | Lifecycle and publish windows; no stock signal | D11 |

## 8 · The top 22 features (A.1) — whose they are

Engine-provided today, the site renders: **1** journey stage (rule-based; D1 makes it decision-native),
**2** cross-device identity (deterministic; see D7), **3** three-click cold start (population priors, first view
initialises the profile, three brisk views cross the threshold — this is literally the demo cadence), **4**
personalized homepage, **8** intelligent default sort (`POST /sort`: any candidate set, re-ranked by affinity and
price posture), **10** style-intelligent recommendations (cross-category by registry dimensions), **11**
adaptive media gallery (content type affinity chooses on-model vs studio vs video when the pieces are
typed), **13** intelligent cross-sells (the seam exists: pieces linked to products — D5), **22** behaviour→CRM
(ODP loop, Snowflake share).

Engine-provided as signals and audiences, the site builds the experience: **5** adaptive navigation, **6**
personalized search (the sort route re-ranks results; suggestions-as-you-type are the site's), **7** inspiration
mode and **17** journey-aware overlays (an audience of explorers exists the moment the registry names it; the
overlay is the site's), **16** comparison intelligence (a ≥3-PDP-revisits audience is one registry rule), **19**
guided discovery.

Not ours: **9** facets and badges, **12** copy emphasis (NLG), **14** size and fit, **15** shoppable video hub,
**18** cart intelligence, **20** care follow-ups, **21** loyalty tiers. Product recommendations (their "table
stakes") stay with their existing vendor by their own plan.

## 9 · The deltas worth deciding

Ordered by how much they matter to the pilot. Effort is honest, not padded.

| # | Delta | What BTIE asks | What we have | Recommendation | Effort · lane |
|---|---|---|---|---|---|
| **D1** | **Journey stage on the content decision** | See/Think/Do drives which content and CTAs; their foundation feature #1 | Rule-based stage on the demo path and in audiences; absent from the content decision's cell and from content metadata | Build: stage as a cell dimension (pooling ladder level), `journeyStageFit` on the piece, a slot rule that demotes content outside the stage. The classifier stays rule-based and explainable; "ML classifier" is their Phase 2 wording, not a Phase 1 need | 2 days · content service (theirs) + JourneyStage (mine) |
| **D2** | Freshness and "seen before" | Avoid fatigue; new content gets a lift | Eligibility windows only; the visitor's ring holds what was shown but nothing reads it at decision time | Build: a freshness term (days since publish) and a fatigue penalty (times served to this visitor in the ring), both itemised drivers | 1 day · theirs |
| **D3** | Value-weighted rewards | Phase 1 optimises a single objective, Profit | Rewards are counted, weight 1; outcomes carry `value` | Build: per-slot objective `click \| purchase \| value`, credits weighted by the outcome's value (or margin when the feed gives it). This is what makes "optimise to profit" true and answers "no click-bait" | 1 day · theirs |
| **D4** | Measurement rules | 90 % significance, pre-set targets, windows | 95 % intervals, per-day report, `pooled()` unwired | Build: confidence parameter, target comparison in the sentence, pooled window on the report route. After R12-1 | ½ day · mine |
| **D5** | Content schema alignment | A.3.6 fields | Most exist under other names | Build: `featuredProductIds`, `journeyStageFit`, `freshnessDate` on the piece schema with validation; a one-page mapping in the PS guide so their team tags once and correctly | ½ day · theirs (schema) + mine (guide) |
| **D6** | Implicit signals: scroll depth, hover | Multi-modal fusion | Dwell, impression, video | Optional: SDK auto-capture of scroll depth and hover with registry weights, impression-like defaults (low). Ask Tapestry whether they want it in the pilot; it is cheap but it is more events | 1 day · SDK (theirs) |
| **D7** | **Anonymous cross-device: probabilistic / fingerprint** | "Device fingerprint + behaviour pattern matching" | Deterministic on sign-in, durable first-party id; the scope says **no fingerprinting** | **Decide the position, build nothing.** We keep the no-fingerprinting line: it is a privacy commitment in their own appendix (GDPR/CCPA "from day one") and a brand-safety one. If Tapestry runs an identity graph, its links enter through the same `identity/link` route with `source: import`. This needs a sentence in the customer answer before someone reads A.1 #2 and asks | 0 · position |
| **D8** | Embeddings, vector DB, lookalike users | Embedding-first | Interpretable vector, pooling ladder, external model seam | **Position, build nothing now.** "Concede then claim": we do not learn dense embeddings; the profile is a vector a merchandiser can read and tune, cold start pools evidence by context cell, and their own embedding model plugs in as a term with a latency budget. If Phase 2 wants nearest-neighbour cold start, the seam is there | 0 · position |
| **D9** | Right to be forgotten across the ledger | RTBF built in from day one | Profile erasure yes; the ledger's NDJSON batches keep `visitor_id` and are append-only | Design then build: visitor ids in the ledger are already pseudonymous; erasure = a tombstone list the export honours plus a scheduled rewrite of affected batches. Needs a decision on retention windows with Tapestry's privacy team | 2 days · ledger (theirs), after the design |
| **D10** | Consent enforcement | Consent management built in | `trackingConsent` / `personalizationEnabled` stored on the session, honoured nowhere | Build: consent off ⇒ the default arm, no profile writes, no ODP forward. One switch in the engine, tested | 1 day · shared (session host mine, content service theirs) |
| **D11** | Diversity and inventory rules | Diversity across categories and price; don't over-promote low stock | Per-page uniqueness; lifecycle windows | Build: an optional `inStock` gate when the catalog carries it; a per-slot "at most N pieces per dimension value" rule, itemised | 1 day · theirs |
| **D12** | Latency numbers | <10 ms signal, <100 ms P99 serving | Design says milliseconds; nothing measured on real infrastructure | Measure on staging the week it exists; publish P50/P99 for action, snapshot, sort. Until then, quote no number | ½ day · mine, needs the account |
| **D13** | Phase 2/3: DRL, NLG, multi-objective beyond margin, foundation model, in-house product recs | Their roadmap | Adjacent demos (Opal hero generation), the ledger as the training corpus, the external model hook | **Position.** Not in the contract, not promised, not disparaged: the ledger, replay and the model hook are what those teams would build on, and that is a true and useful thing to say | 0 |

## 10 · What to say carefully

- **Fingerprinting.** Their A.1 #2 and §5.2.1 want it; the scope forbids it; the privacy language in their
  own A.4 is on our side. Say the position before they ask (D7).
- **"ML".** Their document uses it for everything. Ours learns from outcomes, explores, and pools evidence
  — and every number on a receipt can be recomputed by hand. "Learned, and explainable" is the phrase;
  "not ML" is not a phrase we use, and "AI" is not one we claim.
- **Thompson sampling.** We have it as a mode. Say exactly that; do not say "contextual bandit platform".
- **Embeddings.** Concede that we do not learn dense vectors; claim the interpretable vector and the seam.
- **The 40–60 % lift.** Theirs, from benchmarks, marked "assumed" in their own text. Ours will be the arm
  report's sentence, with its interval. Never quote their number as ours.
- **The Optimizely product line.** Feature Experimentation is the experimentation platform their matrix
  lists; ODP is the CRM sync their #22 wants; both are ours already. Say so once, plainly, without making the
  engine sound like a feature of either.

## 11 · Scorecard

| Their current-state gaps (§2) | Now |
|---|---|
| No unified profile across touchpoints | Closed |
| No real-time signal processing | Closed |
| No journey stage detection | Half: rule-based on the demo path; D1 puts it on the content decision |
| No cross-device identity for anonymous users | Closed deterministically on sign-in; probabilistic by position (D7) |
| Content decisions locked in rules rather than learning | Closed, pending R12-1 so the learning is fed |

Phase 1 MVP: **3 built, 1 built differently, 1 by design**. Design principles: **7 of 9**. Capability
matrix: **5 built, 7 partial, 2 out of scope**. Deltas to build before the pilot: **D1–D5, D10**, about
seven working days across both lanes. Positions to write once: **D7, D8, D13**.
