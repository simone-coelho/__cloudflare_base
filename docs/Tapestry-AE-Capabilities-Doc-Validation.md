# Validation — AE "Experience & Content Personalization: Capabilities and deliverables"

**Date:** 2026-08-21 · **Status:** INTERNAL · Validated against Doc 1 (Solution & Algorithm), Doc 2 (Implementation Plan), the 2026-07-24 contract call record, and the deliverables definition.

---

## Overall

Materially better than the previous draft. The measurement section is right and complete, including the line that a holdout must exist at launch because traffic cannot be re-run. The six-property table survives intact and reads well. The "what this lets you do" pattern under each item is the correct register for this audience. The dataLayer warning is well placed.

Five items would cause a problem if this went out as written. Two of them are contradictions inside the document, which a technical reader will find on one pass.

---

## Blocking — fix before issue

### 1. Products and the AI surfaces have been removed from scope

The document is content-only, and Not Included says: *"Product recommendations and product-grid ranking. This is an experience and content personalization platform. Ranking, re-sorting, or recommending commerce catalog items ... is not in scope."*

That is a scope reduction against what we deliver. Product ranking is the older and more proven of the engine's two pipelines and it is what the demonstrations run on. Also absent entirely: **AI Search** and the **Style Concierge**, both built and running.

There is an internal coherence problem underneath this. AI Search and the Concierge operate over the product catalog. A content-only platform that excludes commerce catalog items cannot deliver either of them. So the exclusion and the omission are the same decision, and if the AI surfaces are meant to be in the deal, the product exclusion cannot stand.

**Decide deliberately, then make the document consistent.** If products are in: restore product ranking, the product catalog, AI Search, the Concierge, and scene generation, and narrow the exclusion to re-sorting the SFCC-returned grid only. If products are genuinely out: the AI surfaces cannot be promised anywhere else either, and someone needs to tell the AE that, because he has already told the customer search is in scope via Opal.

### 2. The title promises Experience personalization; the scope excludes it

Titled *Experience & Content Personalization*. Not Included says: *"Personalizing the arrangement of the page itself ... Reordering the slots is a longer-horizon capability."*

Slot arrangement is what "experience personalization" means. The title and the exclusion list contradict each other, and a CFO or procurement reader will notice.

**Fix:** either retitle to Content Personalization, or keep the title and state plainly in the body that Experience is the roadmap horizon the architecture is already carrying — the order value per slot is delivered from day one, so it becomes a data change and not a re-integration. That second sentence is already in the exclusion and it is good; it is just in the wrong place to defend the title.

### 3. The operator interface is excluded, but the acceptance criterion requires it

Two places exclude it: item 08 and Not Included, both saying the interface is *"a separate component, delivered outside this framework."*

But *What "delivered" means* says: **"with weights live-tunable by your team."** A team cannot live-tune weights through a versioned API as a business user. Item 03 has the same problem: *"Your team renames, pins, or prunes anything the engine proposes"* — through what?

This also collides with two things on the record. Mandeep's v1 acceptance was images served differently per user **with weight configurability**, working in spirit and in behaviour from day one. And the AE has told us the reason we were selected is twofold, one being that **his team can analyse and impact scoring**. Delivering that as an API contradicts the stated basis of the win.

**Fix:** if the UI is delivered by another team or another product, say who delivers it and when, in this document. If it is not delivered at all, the acceptance criterion must stop saying weights are live-tunable by their team, and someone must reset that expectation with Mandeep before launch rather than after.

### 4. There is no production environment anywhere in the document

Item 12 delivers a *"Lower-environment platform."* The acceptance criterion is demonstrated *"in your own lower environment."* Nothing in the document commits to production.

Mandeep's stated objective is to impact Coach NA in production before the holiday. As written, this document does not deliver that.

**Fix:** either add production as a deliverable, or state explicitly that production deployment is a separate phase with its own dates. Silence here becomes a dispute in November.

### 5. Historical data has been promoted from optional supplement to gating dependency

Three places now make Tapestry's historical record the basis of cold start: the premise, item 02, and the dependency table (*"Read access to your existing record of content performance and buying journeys. This is what the engine calibrates against before live data accumulates."*)

Three problems.

**It inverts the customer's own model.** On the contract call Mandeep was explicit that anonymous-first on-session affinity is the only viable mechanism and that the warehouse **supplements only**. This document makes the warehouse the primary cold-start input.

**It displaces the mechanism we actually built.** Cold start in our design is first-party **regional trending** — what content and products are performing in this visitor's region right now — which is Mandeep's non-negotiable location dimension and the one genuinely new build in v1. Regional trending survives only as three words inside item 06. It should be the cold-start story in the premise.

**It creates a dependency that can delay the whole program.** Read access to enterprise historical data is a data-governance negotiation, not a task. Making it gating puts the dates at the mercy of their data team. Our engine does not need it to cold start.

**Fix:** demote it to optional, exactly as ODP is handled in the same table — an enhancement that sharpens the opening decisions, not a precondition. Put regional trending back in the premise as the out-of-the-box mechanism. This also repairs the small tension in the premise, which currently says "no login and no prior profile" and then immediately leans on their historical record.

---

## Second tier — should fix

### 6. This is now the third name for the same program

The contract calls it **Behavioral Targeting and Intelligence**. Doc 1 and Doc 2 use that name. This document uses *Experience & Content Personalization*.

Mandeep chose BTI deliberately, and specifically rejected "site personalization" because the anonymous-traffic problem is the reason the program exists. The current title is closer to what he rejected than to what he chose. Contract line items, the two documents he holds, and this one should carry one name.

### 7. The standalone statement is missing

Mandeep repeated, for zero ambiguity, that content decisioning must be **standalone** — no experiments required, no CMAB required, treat the content ID like a product ID. Nothing in this document says so, and item 13 invokes Stats Engine, which could read as a dependency on the experimentation platform.

**Add one sentence:** the decision engine runs standalone and does not require an experiment to be running; experimentation is how the value is measured and it is optional.

### 8. The premise softened his own numbers

*"The majority of Tapestry's digital traffic arrives unidentified, and a large share has never visited before."*

His figures were 90 to 95 percent unidentified, roughly 80 percent never seen before, email around 10 percent. Those are his numbers about his business, and they are the entire justification for the program. "The majority" understates the case and loses the signal that we listened.

**Restore them, attributed to their own data.** These are not scope numbers and they do not become caps.

### 9. No consolidated data-handling section

Good facts are scattered — no fingerprinting, nothing acquired outside Tapestry, content referenced never copied, history not rehosted. But there is no single place a legal or privacy reviewer can read: first-party only, no PII on the decision path, coarse geolocation, population-level regional aggregates with no per-visitor location history, durable facts in their own ODP instance, erasure in one call.

This matters more now that the document requests read access to historical customer data, and it matters again the moment EMEA or Japan enters the conversation.

### 10. The volume number came back

*"Content sample — Roughly 100–500 assets."*

More defensible here than in a deliverables list, since this section is asking them for something. But it was removed deliberately: in a document that feeds an SOW, a number becomes a cap or a scope statement. If it stays, frame it as an initial batch for the first working session rather than a quantity.

---

## Minor

**11.** The dedicated-deployment commitment — own compute, storage, secrets, domain, and pinned version, shared with no other customer — is buried inside item 12 as if it applied only to lower environments. It is one of the strongest facts in the document and it applies to the whole engagement. Give it its own line.

**12.** "Bring your own math" is under-represented. It appears only as *"push priors derived in your own warehouse."* Mandeep specifically valued the option for his data scientists to inject their own math. Worth stating as its own capability.

**13.** Item 06's dimension list and the eligibility-gate examples were both narrowed to content ("expired, superseded, off-limits"). If products return to scope, inventory and price validity go back into the gates, and item 06's closing phrase reverts from "content library" to both catalogs.

---

## Verified correct — no change needed

- The six-property table, including the persistent-connection framing.
- Merchandising authority: gates, then pins, then weighted ranking, with the receipts line.
- Measurement design, including the holdout-at-launch warning. This closes the gap identified earlier.
- Multi-brand provisioning and the amortization argument.
- Enrichment at design time with human approval, explicitly never in the serving path.
- Ordered decision sets carrying an order value per slot from day one.
- ODP correctly positioned as optional.
- The dataLayer maturity warning.
- Native mobile SDK correctly described as a roadmap port.
- Launch brand correctly left as a field to complete.
