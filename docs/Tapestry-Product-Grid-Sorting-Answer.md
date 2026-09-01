# Can we match their SFCC sort-rule behaviour? — the product grid question

> **SUPERSEDED IN PART, 2026-08-31.** The closing section of this document says product grid
> sorting is "not in the contracted scope." **That is no longer true.** We told Mandeep and Nitin
> we would support their Salesforce Commerce Cloud feed, and that commitment stands. Everything
> here about the two integration patterns and their costs remains accurate and useful; only the
> scope statement is stale. Do not quote the scope statement.

**Prepared by:** Simone Coelho · **Date:** 2026-08-21 · **Status:** INTERNAL, with a paste-ready answer at the end
**Question from the account team:** *today they pass a sort rule / query parameter to SFCC, which returns the ordered product grid. Would they be able to easily configure the order with the edge solution, or are the sorting rules defined once and then AI does its thing?*

---

## The short answer

**Yes, configurable — and the premise of the question is the thing to correct.**

The choice is not between *a rule you configure* and *AI doing its thing*. Our engine is neither. **There is no model anywhere on the decision path** — that is a standing architectural invariant, not a policy we chose for this account. The ordering is a deterministic scoring function whose inputs, weights, and precedence are visible and editable.

Put in their vocabulary: **their sort rule and our ranking are the same kind of object.** A sort rule is a function that turns a candidate set into an order. Theirs weighs merchandising attributes. Ours weighs the same attributes plus the visitor's live affinity, with every coefficient exposed. Swapping one for the other is a change of function, not a change of philosophy.

And the cleanest proof point for a sceptical merchandiser: **turn the affinity weight down to zero and you reproduce a fixed, non-personalized sort exactly.** Parity is a configuration of the same engine, not a fallback mode or a separate build.

---

## What "configurable" actually means — three layers, declared precedence

This is the merchandising model already documented in the architecture, and it is the answer to "who is in control."

**1. Eligibility gates, before any scoring.** Out of stock, price invalid, expired, off-limits for this grid. Gates are **item properties, never visitor properties** — a sold-out SKU drops out of the candidate set; the visitor's affinity is untouched. This is the layer that prevents the classic failure of recommending things that cannot be bought.

**2. Pins and blocks — merchandiser authority outranks the engine.** A merchandiser pins the new-season styles to positions 1 and 2 for everyone; the engine orders everything below. Pins survive regeneration; they are not suggestions the model can overrule.

**3. Weighted ranking — the configurable sort itself.** Everything not gated or pinned is ordered by a weighted score. The weight profile *is* the sort rule. A merchandiser can express any of these as configuration, not code:

- "Best-seller order, with affinity only breaking ties" → high best-seller weight, low affinity weight.
- "Personalize hard on this category" → affinity dominant.
- "Margin matters this quarter" → margin as a weighted multiplier, itemized in the explain record.
- "This curated launch grid is fixed" → affinity weight zero. Static order, same engine.

**Precedence is declared rather than implicit:** gates, then pins, then weighted ranking. Conflicts resolve up-stack and get logged. In one line for the customer: *rules decide what can and must show; affinity decides what does show in the space that is left; and every placement shows its receipts.*

---

## This is not aspirational — it is the shape of the code today

The engine's product ranking is already a hard-filter plus soft-score function (`src/services/CatalogIntent.ts`). Stripped down, it does exactly this:

- **Hard filter** = the gates. Out of stock is excluded, category and line constraints applied, price bounds enforced. Structurally identical to a sort rule's filter clause.
- **Soft score** = additive weighted terms with explicit coefficients — occasion match, category match, line match, silhouette, colour, price-band proximity — **and personalization is one term among them**, a bounded weight applied when the item matches the visitor's dominant affinity.
- **Sort descending, return the ordered list.**

That last point is the whole answer in miniature. Personalization is a *term in the scoring function*, not a separate system that takes over. It can be weighted up, weighted down, or zeroed, exactly like every other term.

The architecture document already names sort order as a first-class output of the product pipeline: *"a ranked product list into a widget, carousel, **or sort order** — with each item's explain reference."*

**The honest gap:** those coefficients are currently constants in code, tuned for the demo catalog. Exposing them in the tuning surface — per dimension, per audience, versioned, effective immediately — is workstream W6 in the implementation plan. **That is a build item, not an architectural change.** The mechanism is proven; the dial is what gets built. Worth stating that way rather than implying the merchandiser UI exists today.

---

## The part nobody has asked yet: where does this sit relative to SFCC?

This is the question that determines cost and feasibility, and it should be settled before anyone promises parity.

Today SFCC owns retrieval: their site sends a sort rule and query parameters, SFCC decides *which* products match and returns them ordered. We do not replace that. We reorder. **How much we can reorder depends entirely on which seam we integrate at**, and there are two patterns with very different profiles.

### Pattern A — re-rank what SFCC returns

Their page calls SFCC exactly as it does today. The returned candidate IDs go to our decision endpoint, which returns the same IDs in a per-visitor order. Their front end paints.

- **Keeps everything SFCC guarantees:** inventory, pricing, entitlements, existing business rules. No catalog duplication, no feed to maintain.
- **Fastest to integrate**, and it is the same contract we already use for content: we return ordered IDs, they render.
- **The honest limitation:** we can only reorder what SFCC handed us. If SFCC returns a paginated set of 24, personalization operates within those 24. It cannot lift item 97 from page four into position three, because it never sees item 97.
- Adds one hop to the page flow. Real, but small, and it can be overlapped with their existing call.

### Pattern B — we hold a catalog snapshot and rank the eligible set

We ingest a product feed, hold an immutable snapshot, and rank the full eligible set for the category.

- **Deeper personalization:** the whole category is in play, so genuinely relevant items surface regardless of where SFCC's default sort buried them.
- **The cost:** a product feed and its sync cadence, inventory freshness, and SFCC's own merchandising rules either mirrored or explicitly gated. This is where integrations get expensive and where staleness bugs live.

**Recommendation:** start at Pattern A. It delivers configurable per-visitor ordering with no catalog liability, it proves the value on real traffic, and Pattern B remains available afterwards as a data-integration decision rather than a re-architecture. The decision payload shape does not change between them.

---

## What OOTB Product Recommendations does and does not do here

Worth closing cleanly, because it is the first half of the question.

**Optimizely's Product Recommendations products fill recommendation slots** — carousels and strips such as viewed-together, bought-together, trending, personalized. That is what they are designed for and they do it well.

**Two properties make them the wrong tool for this specific job:**

1. **They populate a slot; they do not re-sort a category grid** that a separate commerce platform has returned. A recommendation strip and a personalized PLP ordering are different products of different shapes.
2. **Regeneration is on a batch cadence** (roughly daily), with best-sellers as the cold-start fallback. So the ordering does not respond to what the visitor did ninety seconds ago — which is precisely the behaviour being asked about, and precisely what the edge engine exists to provide.

**So the honest framing:** OOTB Product Recs is not a sort-rule engine for an SFCC-returned grid, and positioning it as one would not survive first contact with their commerce team. The edge solution is the path for that behaviour.

**One caveat to respect.** My validated notes on the Recommendations product line are from June and are a summary, not a current product briefing. Before any of this goes to the customer in writing, have the Recommendations product team confirm current capability and cadence. If there is an argument that another product in the portfolio covers SFCC-fronted grid sorting, I have not seen it and would want product to say so rather than us guessing.

---

## Scope warning — read this before answering the customer

**Product grid sorting is not in the contracted scope.** The engagement is content and experience decisioning. Mandeep was explicit that product recommendations are solved and not the prize.

The engine can absolutely do this — product ranking is the older and more proven of its two pipelines — but saying yes has consequences the account team should weigh first:

- It introduces **a new integration seam with SFCC** that does not exist in the current plan.
- Against an October test and a possible November production date, a new commerce-platform integration is exactly the kind of addition that turns a plausible schedule into an implausible one.
- The v1 acceptance bar is one container on one page. A personalized PLP is a different surface with a different dependency chain.

**The answer I would give:** yes, the capability is real and it is configurable, here is precisely how it works — *and* it is an adjacent capability we should scope deliberately rather than fold into the current milestones. Answering the technical question honestly and holding the scope line are not in conflict, and doing both is what keeps the October and November dates credible.

---

## Answer for the thread

Plain text, ready to paste.

Good question and it is worth answering carefully, because the way it is framed contains an assumption we should correct.

The choice is not between a sort rule they configure and AI doing its thing. Our engine is neither of those. There is no model anywhere on the decision path, and that is an architectural invariant rather than a preference. The ordering is a deterministic scoring function where every input, every weight and the precedence between them is visible and editable.

In their language, their sort rule and our ranking are the same kind of object. A sort rule is a function that takes a candidate set and produces an order. Theirs weighs merchandising attributes. Ours weighs the same attributes plus the visitor's live affinity, with every coefficient exposed. That is a different function, not a different philosophy, and it is the reason parity is straightforward.

The cleanest way to prove it to a sceptical merchandiser is this. Turn the affinity weight down to zero and you get a fixed non personalized sort, exactly like today. Parity is a configuration of the same engine, not a fallback mode and not a separate build.

Concretely, ordering happens in three layers with declared precedence. First, eligibility gates run before any scoring, so out of stock, invalid price and off limits items drop out. Gates are item properties and never visitor properties, so a sold out item disappears while the visitor's affinity is untouched. Second, pins and blocks outrank the engine, so a merchandiser can pin the new season styles to positions one and two for everyone and the engine orders everything below that. Pins are authority, not suggestions. Third, everything left over is ordered by a weighted score, and that weight profile is the sort rule. Best seller order with affinity only breaking ties is a configuration. Personalize hard on this category is a configuration. Margin matters this quarter is a configuration, and it shows up itemized in the explain record. This curated grid is fixed is also a configuration, it is just affinity set to zero.

One point of honesty on maturity. That mechanism exists and runs today, hard filter then weighted score then sort, with personalization as one weighted term among several rather than a separate system that takes over. What is still to build is exposing those weights in the tuning surface so their merchandisers set them without code. That is already a workstream in the implementation plan and it is a build item rather than an architectural change, so I would describe it that way rather than implying the merchandiser UI is there today.

Now the part that actually determines cost, which I do not think anyone has raised yet. SFCC owns retrieval today, meaning it decides which products match and returns them ordered. We do not replace that, we reorder. How much we can reorder depends on where we integrate, and there are two options.

The first is that we re rank what SFCC returns. Their page calls SFCC exactly as it does now, the returned product IDs come to our decision endpoint, and we return the same IDs in a per visitor order for their front end to paint. This keeps everything SFCC guarantees, inventory, pricing, entitlements and their existing rules, with no catalog duplication and no feed to maintain, and it is the same contract we already use for content. The honest limitation is that we can only reorder what SFCC handed us, so if it returns a page of twenty four products we personalize within those twenty four and cannot pull item ninety seven from page four into position three.

The second is that we hold a product catalog snapshot and rank the full eligible set for the category. That gives much deeper personalization because the whole category is in play, and the cost is a product feed and its sync cadence, inventory freshness, and their SFCC merchandising rules either mirrored or explicitly gated.

My recommendation is to start with the first. It delivers configurable per visitor ordering with no catalog liability, it proves the value on real traffic, and the second option stays open afterwards as a data integration decision rather than a re architecture. The payload shape does not change between them.

On what Product Recs does out of the box, it fills recommendation slots, the viewed together and bought together and trending and personalized strips, and it does that well. Two things make it the wrong tool for this particular job. It populates a slot rather than re sorting a category grid that another commerce platform returned, and its regeneration runs on a batch cadence of roughly a day with best sellers as the cold start. So it does not respond to what the shopper did ninety seconds ago, which is exactly the behaviour being asked about. I would not position it as a sort rule engine for an SFCC grid, because that will not survive contact with their commerce team. One caveat, my notes on the Recommendations line are a couple of months old, so please have that product team confirm current capability before we put any of it in writing.

Last thing, and I want to flag it rather than bury it. Product grid sorting is not in the contracted scope. The engagement is content and experience decisioning, and Mandeep was explicit that product recs are solved and not the prize. The engine can do this and product ranking is actually the older and more proven of its two pipelines, but saying yes introduces a new integration seam with SFCC that is not in the current plan. Against an October test and a possible November production date, a new commerce platform integration is exactly the kind of addition that turns a workable schedule into one we miss. So I would answer the technical question fully, which is yes and here is how it is configured, and at the same time treat it as an adjacent capability we scope deliberately rather than fold into the current milestones.
