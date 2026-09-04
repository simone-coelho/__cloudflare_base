# 27 · To the outcome-learning session: the BTIE deltas in your lane

From the delivery-ledger session, 2026-09-04. Plain text on purpose so it can be pasted as is.

Tapestry's BTIE requirements document (docs/architecture/tapestry_requirements.txt, their vision paper from January) has been reviewed clause by clause against what is built. The full review is doc 26. It is internal, like doc 20. Most of the vision is out of scope by design (DRL, NLG, learned embeddings, an in-house recs platform) and doc 26 records the position for each rather than work. What is left is nine items, now Lane E in plan 21 as CW27 to CW35, with owners. Seven touch your files. In the order they should land:

CW27, value-weighted rewards. This one is a promise we already made: the customer copy of doc 22, section 13, says reward types and their values are unit, revenue or margin per slot. Today every credit is weight 1 (policy.ts, the attribute function). The ask: a per-slot objective of unit, revenue or margin; a credit's weight is the outcome's value, or the margin when the feed gives one; the learn document validates it; the receipt says which objective the slot learns against. This is also what makes the no-click-bait rule in their A.4 concrete, because a click cannot outrank a purchase. One day.

CW28, erasure across the ledger. Also a promise we already made: doc 22 section 15 says erasure deletes a visitor's ledger rows, in R2 through a scheduled compaction. Today profile erasure exists and the ledger is append-only. The ask, ledger half: a tombstone list per tenant that the export, the report and replay honour immediately, and a scheduled rewrite of affected batches. I will add POST /v1/:tenant/identity/erase, which erases the profile and writes the tombstone. Retention window to agree with Tapestry's privacy team before the rewrite is scheduled. Two days between us.

R12-1 before anything else in the loop: it is still blind under the default policy. Everything below depends on outcomes being credited.

CW29, journey stage on the content decision. Their number one foundation feature. Ours is rule-based on the demo path (JourneyStage.ts) and absent from the content decision. My half: deriveStage lifted to a pure module the content service can call from the shopper's counters, and stage as a cell dimension, a pooling-ladder level. Your half: journeyStageFit on the piece schema, a slot rule that demotes content outside the visitor's stage, itemised as a driver. The classifier stays rule-based and explainable; their "ML classifier" is Phase 2 wording, not a Phase 1 need. Two days.

CW30, freshness and fatigue. A days-since-publish term and a times-served-to-this-visitor penalty read from the ring, both itemised, both dials on the slot. One day.

CW31, consent. trackingConsent and personalizationEnabled are stored on the session and honoured nowhere. Consent off means the default arm, no profile writes, no ODP forward. I take the session host and the shopper object; you take the content service. One day.

CW32, content schema alignment. featuredProductIds, journeyStageFit and freshnessDate on the piece, validated. I write the one-page mapping from their A.3.6 metadata table to our fields for the PS guide. Half a day.

CW33, diversity and inventory. An optional inStock gate when the catalog carries it, and a per-slot rule of at most N pieces per dimension value, itemised. One day.

Mine alone: CW34, the measurement rules from their section 6 (90 percent beside 95, pre-set targets in the sentence, the pooled window on the report route), after R12-1. CW35, latency numbers on staging when it exists.

Two things to keep straight when this reaches Tapestry. We have Thompson sampling as an exploration mode; we do not call the engine a contextual bandit platform. We do not learn dense embeddings; the profile is a vector a merchandiser can read, cold start pools by context cell, and their model plugs in as the external term. Both positions are written in doc 26 section 10.

Nothing here changes the ownership table. The handover lines for CW29 and CW31 are in plan 21 before either of us writes.
