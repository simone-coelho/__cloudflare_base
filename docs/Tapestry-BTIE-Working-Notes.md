# Tapestry BTIE: working notes

**INTERNAL. Delivery team only.** Never send it, quote it, or paraphrase it outside the team. Same rule as documents 20 and 26.

A running scratchpad for the technical implementation conversations. **Live state at the top, dated log at the bottom.** Append to the log as things happen; promote anything durable up into sections 1 and 2.

Started 2026-09-18.

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

Nothing is committed yet.

### 1.2 Positions we have taken

Do not contradict these without changing them here first.

| # | Their ask or question | Our position | Why it is this way |
|---|---|---|---|
| 1 | Cross-device identity for anonymous visitors | We link on a signed backend assertion at sign-in. **No device fingerprinting.** | Deliberate. Fingerprinting anonymous visitors collides with their own day-one privacy requirement. |
| 2 | Learned dense user embeddings | The profile is an interpretable vector over the agreed registry. Their model enters as a weighted term, itemised on the receipt. | Explainability and no model on the decision path. |
| 3 | Semantic understanding of language, for example "bags for Gen Z" | Feasible, upstream of the decision. Four attachment points, see 2.2. | It is interpretation and retrieval, not decisioning. |
| 4 | Real-time copy generation | Design-time enrichment with human approval. Nothing generative on the serving path. | Their own no-click-bait policy implies the same. |
| 5 | Deep reinforcement learning for lifetime value | Out of scope. A research programme, not a pilot capability. | |
| 6 | Scroll depth and hover as signals | Not captured. They can arrive as custom events. | |
| 7 | Impressions as a negative signal | Captured, weighted zero by default. Used for fatigue and denominators, not as preference. | Seeing is not choosing. |
| 8 | Incrementality reporting | We deliver arm-tagged decision and outcome records. **The comparison is computed on their side, on their numbers.** Our reports are attribution diagnostics. | We do not mark our own homework. |
| 9 | First paint with no flash | Three rendering patterns, their choice per placement. We do not claim no-flash by itself. | Section 5.8 of the guide. |
| 10 | Mid-session updates | Build against "update arrives, then re-ask". A pushed full decision set is a supported frame shape with no production sender yet. | Works today, no rework later. |
| 11 | Erasure | Bounded and resumable, with a receipt that names what it did not reach. Never "one call and it is done". | |
| 12 | Any technical document we hand over | **No contract language. No milestones, no Order Form, no Scope of Services, no commercial framing.** Phases and durations only. | Simone, 2026-09-18. |

### 1.3 Open questions for them

**Strategic**

1. Is our engine the delivery vehicle for BTIE Phase 1 and 2, or is it running parallel to their own build? Section 5.3.1 of their document is a build charter in which we appear once, as a reference implementation for contextual bandits.
2. Who owns the semantic and interpretation layer, if they want one? Natural split: they own understanding and retrieval, we own decisioning, governance, explainability and delivery.

**Scope and data**

3. Which content number is real: section 4.1 read per product, or appendix A.3.7 read site-wide? Their Phase 1 exit is written against the first.
4. If Profit is the first objective, margin has to be in the feed and on the order event. It appears nowhere in their data requirements.
5. Which pages and templates are in launch scope.
6. Device and daypart: scoring dimensions only, or do they want them in the learning grain? Adding them fragments evidence.

**Measurement**

7. Anchor on their own minimum success of +10 percent rather than the 40 to 60 percent headline.
8. Holdout assignment identifier. They say device fingerprint for anonymous; ours is the first-party visitor id. Agree the unit or the holdout leaks.
9. Minimum detectable effect at their traffic with a 5 percent permanent holdout. Offer to compute it.

**Delivery mechanics**

10. Last date code can ship before the freeze, and the exception process.
11. Consent framework, and the behavior required when consent is withheld.
12. Retention per category, residency per market.
13. First-party subdomain or platform hostname, per environment.

### 1.4 Watch list

| Risk | Why it matters | Mitigation |
|---|---|---|
| The build charter | Their technical team may treat our integration as a stopgap | Settle question 1 above, early and explicitly |
| 40 to 60 percent CVR target | No published personalization programme delivers it; we will be measured against it | Anchor on their stated +10 percent minimum |
| Content commitment gating Phase 1 exit | As written it is unachievable, so the programme stalls and we stall inside it | The pool sizing paper; agree coverage metrics before launch |
| Thin or badly spread pool at launch | A weak result gets attributed to the engine, unprovably | Coverage per dimension and exposures-to-floor per item, reported from week one |
| Latency expectations | Their "<100ms P99" and "sub-10ms" are different measurements from ours | State the returning-shopper and first-request split now, measure jointly in their environment |
| Fingerprinting expectation | Two of their foundation features assume it; we do not do it | Position 1 above, raised as a privacy service to them |

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

**Where a vector genuinely earns its place:** open-ended shopper language, and cold start for new items inheriting priors from nearest neighbours. Both are good joint projects with their data science team.

**Constraint to state early:** scoring dimensions are a curated vocabulary with exact values, capped at 32. A semantic layer emitting arbitrary concepts has to be curated down into that vocabulary or evidence fragments and nothing learns.

### 2.3 BTIE v2.0 against what is built

Document 26 has the clause-by-clause. The short version: of their five Phase 1 MVP capabilities we deliver four and deliver the fifth differently. The nine build deltas from document 27 are all verified built as of 2026-09-18: journey stage on the decision and as a learning level, freshness, fatigue, diversity, the stock gate, featured product identifiers, value and margin weighted rewards, consent enforcement, and erasure across the ledger.

---

## 3. Log

### 2026-09-18

- Wrote the implementation guide. First cut was rejected: an ASCII diagram wrapped and shredded in Word, and it carried contract language throughout. Rebuilt as v1.1 with tables instead of diagrams, every code line under 76 characters, and every contract reference removed.
- Produced the implementation one-pager for a quick walkthrough.
- Reviewed BTIE v2.0 again against current code. Confirmed the nine deltas are closed.
- Produced the content pool sizing one-pager after the variant arithmetic came up.
- Live meeting question on embeddings, specifically "show me bags for Gen Z". Position recorded at 2.2. They mean semantic understanding, not a learned user model, so it is compatible and sits upstream of the decision.
