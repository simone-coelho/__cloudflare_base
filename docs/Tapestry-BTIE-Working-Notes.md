# Tapestry BTIE: working notes

**INTERNAL. Delivery team only.** Never send it, quote it, or paraphrase it outside the team. Same rule as documents 20 and 26.

A running scratchpad for the technical implementation conversations. **Live state at the top, dated log at the bottom.** Append to the log as things happen; promote anything durable up into sections 1 and 2.

Started 2026-09-18.

---

---

## 0. Cold resume, written 2026-09-25 at a credit-reset pause

Assume no context. Nothing of this lane is running: no background job, no watcher, no rig, no container, no worktree, no branch. This lane writes customer documents in the primary checkout on `/mnt/c`; it has never created a worktree or branch.

**Branch** `feature/real-time-personalization`, HEAD `f42c085` at the pause. **Another lane commits in this same checkout**, so stage only named paths, never `-A`.

**Uncommitted at the pause, and the only work at risk**

| Path | State | Why it matters |
|---|---|---|
| `docs/BTI-Parity-and-Mechanism.md` | Untracked | The Monday and 24 Sep deliverable. Section 3 is the module-sequencing mechanism, section 4 the embeddings position. |
| `docs/BTI-Parity-and-Mechanism-v1.0.docx` | Untracked | Generated from the markdown above |
| `docs/Tapestry-BTIE-Working-Notes.md` | Tracked, modified | This file. The uncommitted edit adds the parity document to §1.1 and three log lines. |

The four earlier documents (implementation guide v1.1, the implementation one-pager, the content pool sizing one-pager, and the requirements extraction) are already committed by the other lane and are not at risk.

**The single next action.** Ask the owner whether to commit those three paths. Nothing else in this lane is pending a decision from us. If the answer is yes: `git add` the three paths by name and commit locally, no push.

**Owed.** The vector-embeddings design document is written (25 Sep). Still not started: the identifier handshake specification (SDK-loaded hook, the call that passes their identifier, the signed link at recognition).

**Two things a new reader would otherwise get wrong**

- The Word files are generated from the markdown masters by `scripts/md2docx.mjs`, which is committed. It needs the `docx` package installed once per machine, outside the repo: `npm install --prefix ~/.md2docx docx`. It is deliberately not a repo dependency, because adding it to package.json without regenerating package-lock.json breaks `npm ci`, which is what CI runs. The seven rules that took a rejected draft to learn are in the script's own header.
- `docs/BTI-Content-Pool-Sizing` is the one stale document. It argues the 180,000-variant figure at page scope, which the 18 September session superseded by scoping decisions to the slot. Re-issue at slot scope before it goes in any pack.

---

## 1. Live state

### 1.1 What exists

| Artifact | Path | State |
|---|---|---|
| Implementation guide, full | `docs/BTI-Implementation-Guide.md` and `-v1.1.docx` | Written 2026-09-18. 13 chapters, 8 appendices. Customer-safe. No contract language anywhere. |
| Implementation one-pager | `docs/BTI-Implementation-One-Pager.md` and `.docx` | Steps, what each side does, requirements, the five that move the date. |
| Content pool sizing one-pager | `docs/BTI-Content-Pool-Sizing.md` and `.docx` | The variant arithmetic. Customer-safe cut. |
| BTIE clause-by-clause review | `docs/architecture/26-btie-requirements-gap-review.md` | 2026-09-04, against BTIE v2.0. Internal. |
| BTIE build deltas | `docs/architecture/27-btie-deltas-handover.md` | Nine items handed to the outcome-learning session. **All nine now verified built** (2026-09-18). |
| **Parity and mechanism document** | `docs/BTI-Parity-and-Mechanism.md` and `-v1.0.docx` | The Monday deliverable, written 18 Sep. One document: vocabulary, the module-sequencing mechanism (section 3, the 24 Sep answer), embeddings with the revised explainability sentence, B1 to B12 mapped, identity and first paint, proposed defaults, edge discipline, the ask list. Customer-safe. |
| **Vector embeddings design** | `docs/BTI-Vector-Embeddings-Design.md` and `-v1.0.docx` | Written 25 Sep, the second item owed from the session. Decides what gets a vector, where they live and what they cost, the encoder, the shopper's semantic taste, the term in the score, the dense-versus-sparse evaluation on their sample, and the encoder-replacement procedure. Customer-safe. |
| **Requirements extraction, 18 Sep working session** | `docs/architecture/tapestry-requirements-extraction-2026-09-18.md` | Transcript-derived. B1 to B12 requirements, D the sequencing reversal, E dependencies, G gaps, H decisions, I engineering questions. **The source of truth for what they asked.** |

Nothing is committed yet.

### 1.2 Positions we have taken

Do not contradict these without changing them here first.

| # | Their ask or question | Our position | Why it is this way |
|---|---|---|---|
| 1 | Cross-device identity for anonymous visitors | We link on a signed backend assertion at sign-in. **No device fingerprinting.** | Deliberate. Fingerprinting anonymous visitors collides with their own day-one privacy requirement. |
| 2 | Embeddings (confirmed in scope, 18 Sep) | **Accepted.** "Model" means the encoder that makes a vector. Encoder calls happen at design time for items and concepts, and at request time only for a typed search query. **Decisions never call an encoder:** item vectors are precomputed, the shopper's semantic taste is a decay-weighted sum of touched item vectors, scoring is a dot product. See 2.2. | Search is where a user expects to wait. A decision returns in a few hundred ms and cannot depend on a call that is not 100 percent reliable. |
| 3 | The explainability sentence in the Solution and Algorithm doc | Revise it **with them**: "no model call at decision time; semantic vectors precomputed and versioned; every term itemised with its contribution." Not "everything recomputable by hand from named dimensions." | The axes of a vector have no human names. Say it before they find it. |
| 4 | Real-time copy generation | Design-time enrichment with human approval. Nothing generative on the serving path. | Their own no-click-bait policy implies the same. |
| 5 | Deep reinforcement learning for lifetime value | Out of scope. A research programme, not a pilot capability. | |
| 6 | Scroll depth and hover as signals | Not captured. They can arrive as custom events. | |
| 7 | Impressions as a negative signal | Captured, weighted zero by default. Used for fatigue and denominators, not as preference. | Seeing is not choosing. |
| 8 | Incrementality reporting | We deliver arm-tagged decision and outcome records. **The comparison is computed on their side, on their numbers.** Our reports are attribution diagnostics. | We do not mark our own homework. |
| 9 | First paint with no flash | Three rendering patterns, their choice per placement. We do not claim no-flash by itself. | Section 5.8 of the guide. |
| 10 | Mid-session updates | Build against "update arrives, then re-ask". A pushed full decision set is a supported frame shape with no production sender yet. | Works today, no rework later. |
| 11 | Erasure | Bounded and resumable, with a receipt that names what it did not reach. Never "one call and it is done". | |
| 12 | Any technical document we hand over | **No contract language. No milestones, no Order Form, no Scope of Services, no commercial framing.** Phases and durations only. | Simone, 2026-09-18. |
| 13 | Sequencing reversal: experience (module ordering) first | **Yes, on today's engine.** Modules registered as items, one layout slot per page with take = N, the returned `order` is the sequence. Evidence per (slot, module, cell). Ordering is ranking, never permutation search. | It is the easier problem: every page view observes every module, so it learns faster than content variants. |
| 14 | "How does it learn without variations?" (Mandeep, gates 24 Sep) | Bootstraps from their current page order as the baseline. Trust dial starts at zero. Small rotation of adjacent positions on a slice of traffic to correct position bias. Channel and visit number are already the learning cell. | No variation sets. Sixty estimands for six modules and ten cells, not 720 permutations. |
| 15 | Cross-device identity | Deferred by them to priority 2. Do not build. Keep a later hashed-IP-plus-device join possible. Any identity-adjacent work needs privacy review. | Their words: capability matters, not the fingerprinting mechanism. |
| 16 | Tone of every document to them | **Confident, "we anticipated this", never "everything is missing".** Call out only what the edge makes impossible or complicated. Days of human work is hours for us; do not let them think it is years. | Simone, 2026-09-18, after the working session. |

### 1.3 Open questions for them, as of the 18 Sep working session

The decisions log in the extraction (section H) is authoritative. The ones that matter for 24 September:

**Theirs to answer**

1. Code-freeze date for the pilot site. Asked, not answered.
2. Pilot brand and first target page. The reversal came from the Coach team; Mandeep demonstrated on both Kate Spade and Coach.
3. Content ID and module ID: current state, date, and the naming convention. Their own critical path. Recommend keeping the page out of the module ID so one module on two pages does not accumulate evidence twice.
4. The starting list of attributes and behaviours (Nitin committed, no date). Blocks the registry.
5. Module count for the pilot PDP: five, six or ten.
6. Magnitude and baseline of the paid-social grid experiment, the only evidence behind the reversal.

**Ours to propose, with reasoning**

7. Signals before first personalization: propose three signals, fire on the fourth action, and adopt their counting language.
8. Content impression floor per page type, and down-weight rather than ignore below it.
9. Behaviour versus content performance default split, exposed as a percentage dial that maps onto the trust exponent.
10. First-paint behaviour: resolve immediately from region and channel, never wait; the socket push-back stitches their ID afterwards.
11. The locked glossary, and the two senses of "slot" (a position inside a module versus the module-level container).

### 1.4 Watch list

| Risk | Why it matters | Mitigation |
|---|---|---|
| The build charter | Their technical team may treat our integration as a stopgap | Settle question 1 above, early and explicitly |
| 40 to 60 percent CVR target | No published personalization programme delivers it; we will be measured against it | Anchor on their stated +10 percent minimum |
| Content commitment gating Phase 1 exit | As written it is unachievable, so the programme stalls and we stall inside it | The pool sizing paper; agree coverage metrics before launch |
| Thin or badly spread pool at launch | A weak result gets attributed to the engine, unprovably | Coverage per dimension and exposures-to-floor per item, reported from week one |
| Latency expectations | Their "<100ms P99" and "sub-10ms" are different measurements from ours | State the returning-shopper and first-request split now, measure jointly in their environment |
| Fingerprinting expectation | Two of their foundation features assume it; we do not do it | Position 1 above, raised as a privacy service to them |
| The 180,000 figure now in their hands | Page-scoped, superseded by slot scoping; overstates the problem and dents the credibility of the next numbers | Re-issue at slot scope once "slot" is disambiguated; do not substitute 18, it is one observed page |
| Position bias in module ordering | The first module gets clicks for being first; naive learning entrenches the current order | Rotation exploration on a slice of traffic, explained to them as not being A/B testing |

---

## 2. The analysis behind the positions

### 2.1 Content pool sizing

**Their two asks, which differ by orders of magnitude.** Section 4.1: 40+ photos per page, 15 variations of the 12 pieces on each product page, 20+ See and Think pieces per product. Read per product that is 180 variants per page and roughly 180,000 assets at 1,000 products. Appendix A.3.7: "50-100+ pieces", "2-3 variants per piece", which is 150 to 300 assets in total.

**Their own evidence floors**, both from appendix A.3, quoted:

- A.3.5, Cold Content Handling: "Gets exploration bonus until we have 500+ impressions."
- A.3.6, `min_impressions`: "1000 (for hero), 500 (for modules)".

Note A.2 is labelled "fully generated using AI". A.3 is not labelled, but reads like the same template, so treat its numbers as illustrative rather than considered.

**What evidence actually costs.** Two-proportion test, 2 percent baseline click rate, two-sided, 95 percent confidence, 80 percent power:

| To detect | Impressions per variant | 180 variants on one page |
|---|---|---|
| Their exploration floor | 500 | 90,000 page views |
| Their hero floor | 1,000 | 180,000 page views |
| 2.0 to 3.0 percent, a 50 percent relative lift | 3,825 | 688,000 page views |
| 2.0 to 2.6 percent, a 30 percent relative lift | 9,797 | 1,764,000 page views |
| 2.0 to 2.4 percent, a 20 percent relative lift | 21,108 | 3,800,000 page views |

**Sizing formula.** Assets for a slot = items the slot shows × dimension values to cover × journey stages to serve. A homepage hero at 1 item, 4 style clusters and 3 stages is 12 to 24 assets. A six-item carousel is 30 to 50. A launch page totals 50 to 80, which is their appendix number, not their section 4.1 number.

**One nuance to keep straight.** The large figures above are what cell-specific evidence costs. They are not the point at which the engine starts working: evidence pools up a ladder and the finest level with enough of it answers, shrinking each item toward the slot baseline until its own evidence earns the move. A thin variant is not broken, it simply never earns cell-specific treatment.

### 2.2 Embeddings: where they attach

Three different things get called embeddings. Query and concept understanding, item similarity, and learned user vectors. Their "bags for Gen Z" example is the first. Only the third conflicts with our design.

| Attachment point | What it does | Cost | Verdict |
|---|---|---|---|
| Design-time tagging | A model proposes tags, a person approves, serving unchanged | None at serving | Preferred for anything merchandisers govern |
| Query-time interpretation | A phrase becomes structured intent over registered dimensions, then deterministic ranking | An interpretation call, so cache it, hard timeout, deterministic fallback | Right answer for open-ended shopper language |
| Candidate retrieval | Their vector index returns candidates, we order them per shopper | Their infrastructure | Clean two-stage split; our sort endpoint already takes a candidate list |
| A term in the score | Their per-item score for this shopper enters weighted and itemised on the explain record | Offline table, governed | Keeps their model and our explainability |

**The caution on "Gen Z" specifically.** It is not a property of a bag, it is a claim about who likes the bag. Embedding product copy and imagery and querying the phrase returns whatever the encoder associates with it, usually a vague aesthetic. The defensible version uses their own first-party cohort data: items that over-index with 18 to 27 year olds become a tag, refreshed periodically. Explainable, instant at serving time, governable, and defensible to legal. Age-based targeting also carries regulatory exposure in some markets and is safer as an internal merchandising concept than a shopper-facing label.

**The clarification that settled it (18 Sep, after the session).** Two operations, two places. *Making* a vector needs the encoder: once at design time for items and merchandising concepts, and at request time only for a typed search query. *Comparing* vectors is a dot product, no model, sub-millisecond over a few thousand content vectors in the isolate, no database needed at that scale. The shopper's semantic taste is the decay-weighted sum of the vectors of items she touched, updated on each event like affinity. So the decision path stays encoder-free, and search is the only place an encoder is called live, with a timeout and a structured fallback. Cloudflare Vectorize is the edge-native index if a corpus ever reaches catalog scale. The external seam in `src/learn/external.ts` already has the three shapes (table in KV, service, workers_ai), a 20 ms budget and omit-on-miss.

**Where a vector genuinely earns its place:** open-ended shopper language, and cold start for new items inheriting priors from nearest neighbours. Both are good joint projects with their data science team.

**Constraint to state early:** scoring dimensions are a curated vocabulary with exact values, capped at 32. A semantic layer emitting arbitrary concepts has to be curated down into that vocabulary or evidence fragments and nothing learns.

### 2.3 BTIE v2.0 against what is built

Document 26 has the clause-by-clause. The short version: of their five Phase 1 MVP capabilities we deliver four and deliver the fifth differently. The nine build deltas from document 27 are all verified built as of 2026-09-18: journey stage on the decision and as a learning level, freshness, fatigue, diversity, the stock gate, featured product identifiers, value and margin weighted rewards, consent enforcement, and erasure across the ledger.

---

### 2.4 The requirements extraction, mapped to the build (18 Sep)

| | Requirement | Where we are | How we get there |
|---|---|---|---|
| B1 | Embeddings, semantic retrieval | Seam built: table, service, workers_ai; itemised; 20 ms budget | Table-first, semantic vectors at design time; live encoder only for search; revise the one explainability sentence |
| B2 | Slot as the unit of decision | Already slot-scoped throughout | Re-issue the evidence numbers at slot scope after the glossary is locked |
| B3 | Six strategy properties | Five map directly | Positional strategy inside a module: two slots, or add position bands. Small. |
| B4 | Score, rank, return the top | Exactly the engine | Nothing |
| B5 | Behaviour over content performance, 90/10 configurable | Both exist; ours is a trust exponent, theirs a percentage | Expose a percentage dial that maps onto it. "Ship on behaviour first" is the dial at zero. |
| B6 | Three clicks; geo and channel pre-click | Region and channel available before the first click; the vector updates from action one | Configurable signal floor; adopt their counting language |
| B7 | Content cold start, evidence floor | Priors, shrinkage to the slot baseline, exploration floor, exposures-to-floor per item | Propose per-page-type defaults with reasoning. We down-weight rather than ignore. |
| B8 | Merge, do not override | Exactly how linking works; decay already makes live signal outrank history | Accept their hashed identifier as the account identifier |
| B9 | Edge and origin handshake | We mint identity at the edge; first paint never waits | Write the SDK contract and the socket push-back |
| B10 | Geo as a signal | Coarse region from the request; population trends carry no visitor identifiers | Nothing |
| B11 | Configurability | Versioned documents and the tuning UI; per-action weights exist | Two small builds: per-product-type action weighting; per-content-piece objective |
| B12 | Tapestry owns the taxonomy | Engine agnostic; up to 32 dimensions; exact-value vocabulary | Their starting list |
| C1 | Cross-device identity | Not built, deliberately | Keep a later join possible |
| D | Experience first | Works on today's engine | Module registration, module-level events, position-bias handling, per-cell slot configuration for day-one ordering |

Nothing in B, D or E is blocked by their content and module IDs: an ID is an opaque string, so build and test against synthetic IDs and swap them.

### 2.5 The module-sequencing mechanism (the 24 Sep deliverable)

1. **Ordering is ranking.** Score each module for this shopper in this context, sort. Six modules and ten cells is sixty estimands, not 720 permutations. Ten modules is one hundred, not 3.6 million.
2. **It runs on what exists.** Modules are items with their module ID; the page has one layout slot with take = N; the returned `order` is the sequence. Dedupe, pins as an ordered prefix, exclusions, off-limits, diversity, fatigue and the per-cell evidence ladder apply unchanged.
3. **It bootstraps from their page.** The merchandiser's current order is the baseline. The trust dial starts at zero; nothing moves until evidence earns it. It starts as their page and earns permission to change.
4. **It learns fast.** Every page view observes every module. Five thousand PDP views a day is about five hundred exposures per module per cell per day across ten cells. Days, not months.
5. **Position bias is the one real hazard.** Correct it with a small rotation of adjacent positions on a slice of traffic (our rotation exploration mode), or an estimated position discount, or both. A few percent of impressions, not variation sets. Explain it, because it is the part that sounds like A/B testing and is not.
6. **The one gap.** Learned ordering by channel and visit is free, they are already the cell. Configured ordering on day one, before evidence, needs slot configuration addressable per cell. Small, well-shaped, and it is Mandeep's "holy grail" combination, so do it first.
7. **Does it depend on the content stage?** No. Both are consumers of the same shopper vector. Sequencing has fewer items and a fixed candidate set. The reversal is feasible and the easier problem.

### 2.6 What the edge constrains, and the way through

| Constraint | Path |
|---|---|
| No training at the edge | Offline, serve the output. Nobody trains at request time. |
| A catalog-scale vector index does not fit the isolate | Content scale fits: a few thousand vectors is under a megabyte, dot product sub-millisecond. Vectorize for catalog scale, as a network call, for search. |
| A request-time encoder call is tens of milliseconds and not 100 percent reliable | Decisions never make one. Search may, with a timeout and a structured fallback. The external seam enforces 20 ms and omit-on-miss. |
| No shared memory across requests | State lives in the shopper object and KV already. Not an issue. |
| First paint arrives before the origin | We mint identity at the edge and serve immediately; their ID stitches afterwards. The edge is what makes first paint possible. |

## 3. Log

### 2026-09-18

- Wrote the implementation guide. First cut was rejected: an ASCII diagram wrapped and shredded in Word, and it carried contract language throughout. Rebuilt as v1.1 with tables instead of diagrams, every code line under 76 characters, and every contract reference removed.
- Produced the implementation one-pager for a quick walkthrough.
- Reviewed BTIE v2.0 again against current code. Confirmed the nine deltas are closed.
- Produced the content pool sizing one-pager after the variant arithmetic came up.
- Live meeting question on embeddings, specifically "show me bags for Gen Z". Position recorded at 2.2. They mean semantic understanding, not a learned user model, so it is compatible and sits upstream of the decision.
- Working session ended. Simone produced the requirements extraction (1.1). Two things change the build: embeddings confirmed in scope, and experience personalization now ships first. Full map at 2.4, mechanism at 2.5, edge constraints at 2.6.
- Simone's ruling on the parity document: read as requirements, not a negotiation. Confident tone, "we anticipated this". Call out only what the edge makes impossible or complicated. Position 16.
- Embeddings clarified after the session: "model" means the encoder. Design-time for items and concepts, request-time only for typed search. Decisions stay encoder-free. Position 2 rewritten.
- Committed for Monday 21 Sep: the parity document and the vector-embeddings design. Committed for 24 Sep: the module-sequencing mechanism (2.5), which gates the wider meeting.
- Parity document written as one document with the mechanism at its centre (Simone's choice). Word and markdown in docs/. Still owed: the vector-embeddings design document and the identifier handshake.
- **2026-09-25, credit-reset pause.** Nothing running in this lane. Cold-resume note added as §0. Cleanup the day before: freed 305 KB of Word smoke-test artifacts; observed 2.0 GB of stale August worktrees under `.claude/worktrees/` that belong to other sessions and were left alone. Not committed at the pause: the commit decision is the owner's, and a peer relaying it does not substitute.
