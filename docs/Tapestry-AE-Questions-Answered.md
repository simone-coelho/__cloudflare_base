# Tapestry — AE follow-up questions, answered from the record

**Prepared by:** Simone Coelho · **Date:** 2026-08-21 · **Status:** INTERNAL
**Answers sourced from:** the Solution & Algorithm document (`content-personalization-design-tapestry.html`), the Implementation Plan (`Tapestry-Implementation-Plan.md`), the Content Personalization Proposal, the Opal Credit Boundary guide, and the 2026-07-24 contract call record.

---

## Verdict

Nine items came back. **Seven are already answered in documents that exist**, most of them customer-facing and some already in Mandeep's and Nitin's hands. **One is genuinely missing** and needs writing (measurement design). **One is a factual correction** that has to happen before it reaches the customer (Opal and search).

Nothing here requires inventing a new position. It requires assembly, one correction, and one date from Mandeep that nobody can schedule around until we have it.

---

## 1. "Is the BTI doc the one we'd work with Mandeep to define specifics?"

**Yes, and it is two documents, built for exactly the end goal stated: a set of requirements and agreed deliverable dates.**

| | Document | What it settles |
|---|---|---|
| Doc 1 | *Behavioral Targeting and Intelligence — Solution & Algorithm* | The **what and how**: the anonymous-first premise, the 6–8 dimension registry, per-slot strategies, the scoring model, learning logic, the data-science injection surfaces, and the v1 acceptance bar |
| Doc 2 | *Behavioral Targeting and Intelligence — Implementation Plan* | The **when and who**: twelve workstreams, milestones M0–M6, and nine named customer dependencies D1–D9 |

Doc 2 was written as a response-round instrument, deliberately. Mandeep said on the contract call that he would adjust dates on his side and come back, and that only then do agreed dates become contractual milestones. The document closes with exactly that request: *send back your adjusted dates and the D1–D9 owners on your side, and we'll return the final milestone set for the contract.*

So the requirements-and-dates vehicle the account team is asking for **already exists and is waiting on a response round.** The remaining specifics are nailed down in the M0 working sessions: dimension registry sign-off, content-type taxonomy, the slot map for the pilot page, and the payload contract reviewed with their front-end team.

---

## 2. "Are the gaps tied to customer docs or internal docs?"

Important clarification: those were **gaps in the capability breakdown**, not gaps in the program. Almost every one is already answered in material written for the customer. Here is the mapping.

| Gap flagged in the review | Where it is already answered | Customer-facing? |
|---|---|---|
| The anonymous 90–95% premise | Doc 1 §01, *The premise: anonymous first* — the 90–95%, 80%-never-visited, and email-at-10% figures are already in there verbatim, with the naming rationale | Yes, already sent |
| Six to eight dimensions, entry channel included | Doc 1 dimension registry — entry/marketing channel is row 3, explicitly noted as *"your strongest single predictor"* | Yes |
| Governance, pins, explain records | Doc 1 (explain record behind every decision) and Proposal §6, *Explainability and Opal — the condition for trusting autonomy* | Yes |
| Their team can analyze and impact scoring | Doc 1, *Injection surfaces — bring your own math*, plus the tuning surface with live weight configurability | Yes |
| What Tapestry must provide | Implementation Plan §6 — D1 through D9, each with a gating milestone | Yes |
| Milestones and sequence | Implementation Plan §5 — M0 through M6 | Yes |
| Privacy, residency, data handling | Implementation Plan §7 — where data comes from, how it aggregates, who can access it, at what latency | Yes |
| Multi-brand leverage | Doc 1 §17 and Implementation Plan W7 — per-brand catalogs, configurations and audiences with hard isolation | Yes |
| **Measurement design: holdout, primary metric** | **Nowhere. Verified across all three customer documents: it does not exist.** | **No — genuinely new** |
| **The business case model** | Never been ours. It needs Tapestry's actuals. | **No — the account team owns it** |
| Entitlement audit of the "available today" list | The order form, not our documents | CSM / account team |

**Net:** one genuinely missing piece. Everything else is assembly from documents that already say it, often better than the breakdown does.

**On the missing piece.** Measurement is worth writing properly rather than bolting on, because it does two jobs at once: it answers the CFO's second question ("how will I know it worked"), and it is the only mechanism that can ever substantiate the revenue claim the business case makes. A holdout group, a primary metric agreed before launch, read through Stats Engine, reported by their team in their own environment. It becomes more urgent, not less, if the launch moves to Coach NA in the holiday window — see §5.

---

## 3. Professional services and the Lighthouse fee

The commercial call belongs to the people who own it, and it has been routed there. One correction for the record and one consequence.

**The correction:** the "implementation at no cost, included as part of the Lighthouse partnership" line originated in the capability breakdown itself. The review did not recommend waiving anything. It said only that *if* the document claims implementation is free, the value being given away should be stated, because unpriced generosity is invisible on a CFO's spreadsheet.

**The consequence, which does need resolving:** if a PS quote has been issued and is not being waived, then the capability breakdown cannot say implementation is included at no cost. Those two artifacts will meet each other at contract time. Whichever way the commercial decision goes, that line has to change to match it.

---

## 4. "One container" — Mandeep's word, and it helps us

This corrects a point in the earlier review. "Container" was flagged as invented vocabulary because it appears nowhere in our documents. If Mandeep used it on the call, it is **the customer's vocabulary and we should adopt it** — but define it once, in writing, because an undefined unit of scope is what two sides argue about at acceptance.

**Recommended definition:** one content container = one slot, on one page, decisioned per visitor from an agreed pool of candidate assets.

The useful part: **his "one container" and our v1 acceptance bar are the same size.** The acceptance bar reads *"on the pilot brand's homepage, with a candidate pool of 20–30 assets, different visitors verifiably see different content."* That is one container. There is no gap between what he asked for and what we already committed to demonstrate, which is worth saying back to him plainly.

One caution: container, brand, and date are three separate variables and the thread is currently blending them. "One container" says how much surface. It says nothing about which brand.

---

## 5. Pilot brand — the color resolves it, with two consequences

The account team's read is almost certainly right, and it is better information than ours: Mandeep sits at Tapestry, operates a shared-services model for the brands, and the engagement originated with Coach. Our Kate Spade framing came from the 2026-07-24 contract call, where Kate Spade was named as the pilot **specifically because it carries lower business impact during the shakedown.** That may well have been superseded.

Two things follow.

**Documents to update.** Kate Spade is named as the pilot in three places in the Implementation Plan (§1, W7, §10) and in Doc 1 §17, which is headed *"Pilot on Kate Spade. Carry the pattern to Coach."* If Coach is the launch brand, those need correcting before Nitin or Mandeep reads either document again. Otherwise we recreate the exact problem the review flagged, only reversed: two documents naming two different pilot brands.

**A risk note, stated once and not as an argument.** Kate Spade was chosen to absorb the first production run of a new system on lower stakes. Launching first on Coach North America, into the holiday window, inverts that posture. It is a legitimate decision and it may well be the right one commercially. It should just be made knowingly, and it raises the value of two things that are cheap to add now and impossible to retrofit: **a holdout, and a staged traffic rollout** — start at a small percentage of Coach NA traffic and open it up as it proves out. That converts a holiday-season launch from a bet into a controlled one.

---

## 6. Oct 1 and Nov 1 — the feasibility question

This is the one that matters, and it cannot be answered yes or no yet. Here is what is knowable.

### First, an ambiguity to close

"Something to test by Oct 1" — **tested where?** In our staging environment against their content, or in *their* lower environment? Those are different milestones roughly three to four weeks apart (M2 versus M4), and the whole schedule reads differently depending on the answer.

### Oct 1, one container, in a lower environment: feasible

That is essentially our M2, *feature-complete demonstration*, currently targeted end of September. Achievable, on these conditions:

- The build starts now.
- Content sample (D2), roughly 100–500 assets with whatever metadata exists — sparse is fine — within about a week of kickoff.
- Slot map and default content for the one container (D4).
- Working-session participants named (D1): data science for the registry, a front-end lead for the payload contract, content operations for the taxonomy.
- Scope holds at one container, one page, one brand, one market.

### Nov 1, live in production impacting Coach NA: conditionally feasible, and the critical path is theirs

Our SDK and integration kit land mid-October (M3). What sits between that and a Nov 1 production launch is entirely on their side: front-end integration, their QA, security and network sign-off, and a production release slot. That is dependency D9, and it is the binding constraint on the date — not our build.

### The question that unlocks the schedule

Mandeep told us November is their code freeze. He is now saying Nov 1 is his deadline to impact Coach NA. Those two facts collide, and how they resolve changes everything:

> **If the integration has to land before the freeze, the real deadline is not November 1. It is the last date their code can ship before the freeze — likely mid-to-late October — which pulls our SDK delivery earlier than mid-October and compresses every milestone behind it.**

**Ask Mandeep for that exact date, and ask whether this gets a freeze exception.** Nobody on either side can commit to a schedule until we have it. That single question is worth more than another round of estimates.

### One distinction worth closing now

"Impact Coach NA before the holiday deadline" reads two ways. If it means *the system is running during holiday traffic*, a Nov 1 launch delivers that. If it means *proven lift by Nov 1*, that is not achievable by anyone — a holiday-season lift cannot be measured before the holiday season. Better to settle which he means now than to discover the gap in December.

### What makes the date credible

Scope discipline, and he has already supplied it. **One container is the thing that makes his own date achievable.** Every surface added past that converts a plausible date into an implausible one. That is a genuinely good-news message to give him.

And the holdout must be configured at launch. If the system goes live on Nov 1 with no control group, the revenue impact can never be substantiated to the CFO afterwards — the traffic is gone and it cannot be re-run.

### Internal note

Our build has not started. The standing rule is that no build phase begins until the document set is approved. If Oct 1 is now a real external date, that approval is the gating item on our side and it is worth making a decision on this week.

---

## 7. Revenue figures

The sourcing rationale is reasonable. The presentation is the problem, and one arithmetic issue survives it.

**The presentation.** Directional figures are fine — but they sit in a table headed *Metric / Figure*, which reads as fact, not illustration. Two fixes, and the second is an upgrade rather than a concession: label them as illustrative, and give the CFO the **model with the inputs exposed**, so they can substitute their own actuals. A CFO trusts a model they can populate more than a number handed to them, and it moves the conversation from defending our figure to discussing their own.

**The arithmetic still needs resolving.** If DTC is approximately 87% of total net sales, then DTC is close to $6B at a company of Tapestry's size, not $4.5B. So $4.5B is most likely *Coach brand* DTC while $69M is one percent of *Tapestry* net sales. Two different entities inside one calculation. Pick one entity and hold it across every line.

**And the base is still wrong in kind, not just in size.** DTC includes physical stores. This system touches digital only, and within digital only the surfaces being personalized, and within those only the traffic actually exposed rather than held out. Tapestry reports digital penetration; use their figure. If it is not separately disclosed, state it in the document as a labeled assumption rather than as a base.

**One more:** "digital revenue grew at a high-teens percentage rate" is a *growth rate*. It does not size the opportunity. Sizing needs digital as a share of sales, which is a different number.

---

## 8. Multi-brand leverage and "no black box"

If those are the two stated reasons we were selected, then they are the two things the CFO document should lead with — and right now neither one is a headline in it. Both are already fully specified and the language can be lifted directly:

- **Multi-brand:** Doc 1 §17 and Implementation Plan W7. Per-brand content catalogs, configurations, strategy profiles, and audiences, with hard data isolation between brands. What transfers between brands is configuration patterns and learnings, never shopper data. Extending to the next brand is provisioning, not re-engineering. For a Tapestry-level CFO this is the strongest economics in the deal: one investment, amortized across the portfolio.
- **No black box:** Doc 1's injection surfaces (*bring your own math*), the tuning surface with per-dimension and per-audience weights, decay horizons and thresholds editable live and versioned, an explain record behind every decision, and priors their data scientists derive in Snowflake pushed back into the engine.

**One consequence worth stating internally:** if "his team can analyze and impact scoring" is a stated reason we won, then the tuning surface is not a phase-two nicety, it is a v1 acceptance item. Our plan already treats it that way — weight configurability is written into the acceptance bar — and it should stay there under any schedule compression.

---

## 9. Opal, search, and dynamic audiences — correction needed before this reaches the customer

This is the one item in the thread that is not supported by anything we have written, and it needs care.

### Dynamic audiences via Opal: real, with three constraints

Opal can suggest and create ODP audiences. It is GA. But three constraints have to travel with the claim:

- **US-only** at present. That matters, because EMEA and Japan are in the expansion story.
- **Human-approved**, not autonomous. Opal proposes; a person publishes. This is a feature for this customer, not a limitation — it is the same posture as everything else in the design.
- **It works off the ODP schema**, not raw warehouse rows.

Confirm the US-only status with the product team before it is promised in writing for a multi-region program.

### Do not blur two different audience mechanisms

Our engine generates affinity audiences from the content and product catalog, at the edge, in the customer's own merchandising language. Opal generates ODP audiences from the ODP schema. **Different mechanisms, different surfaces, different constraints.** The capability document should not merge them into a single bullet, because the moment a technical reviewer pulls on it they come apart.

### Search: Opal is not a site search product

This is the correction. Opal is the agent and assistant layer — Opal Chat, specialized agents, workflow agents in private GA. "Search capabilities" could mean two very different things and they need separating before it lands in a scope list:

- **Shopper-facing search on the storefront** — a search box a customer types into. Opal does not provide this. That is a different product line entirely.
- **The team asking questions in natural language over their own data and results** — "which content is winning for paid-social arrivals on second visits." That is real, it is Opal plus the analytics surface, and it is already how our documents describe Opal's role: the surface that explains, and eventually proposes.

Those are not close to the same thing to a CFO reading a scope list, and the second one is what our documents actually support. Worth asking which was intended before it goes further.

### Credits have to be answered

Opal is credit-based and the pool is shared across products. "Included in scope" without a credit position is how this resurfaces as a finance question later. The boundary is already documented in `docs/Opal-Credit-Boundary-Pricing-Guide.md` and the rule is simple:

> **The engine decides; Opal creates and explains.**

The live decision path — scoring, ranking, serving, explain records, outcome statistics — consumes **zero Opal credits, ever**. Credits apply to authoring (natural language to audiences, flags, content tagging) and to insight (analytics queries, narrating results). Those scale with team activity, not with traffic.

**Quote them as separate meters and never blend them.** If finance models credit consumption against traffic volume, the number becomes unpredictable and the deal stalls on a cost question that does not actually exist.

---

## Two things to send back to Mandeep

1. **The last date their code can ship before the November freeze**, and whether this gets a freeze exception. Everything else in the schedule is downstream of that one fact.
2. **The response round on the Implementation Plan** — his adjusted dates and named owners for D1 through D9. That document was written to be answered, and answering it is what converts proposed dates into contractual ones.

---

## Reply for the thread

Plain text, ready to paste.

Really useful, thank you, and most of this is already answered in documents we have written. Going through them in order.

On whether the Behavioral Targeting and Intelligence doc is the one we use to define specifics with Mandeep, yes, and it is actually two documents. Doc 1 is the Solution and Algorithm document, which settles the what and the how, the dimension registry, the scoring model, the acceptance bar. Doc 2 is the Implementation Plan, which settles the when and the who, twelve workstreams, milestones M0 through M6, and nine named dependencies on their side. Doc 2 was deliberately written as a response round document, because Mandeep said on the contract call that he would adjust dates and come back and only then do they become contractual. It literally ends by asking him to send back his adjusted dates and the owners for each dependency. So the requirements and dates instrument you are describing already exists and is waiting on his response.

On the gaps, those were gaps in the capability breakdown, not gaps in the program. Almost all of them are already answered in customer facing material. The anonymous ninety to ninety five percent premise is Doc 1 section one, with those exact figures. The six to eight dimensions including entry channel are the dimension registry, where channel is called out as his strongest single predictor. Governance and explain records are in Doc 1 and in the proposal. His team being able to impact scoring is the injection surfaces section, bring your own math. The customer dependencies are Implementation Plan section six. Privacy and data handling are section seven. Multi brand is in both. The one genuine gap is measurement, meaning a holdout and an agreed primary metric, which is not written anywhere yet and which I will write, because it is the only thing that can ever substantiate the revenue number to the CFO afterwards.

On professional services, that is not my call and I have routed it. One correction for the record though, the implementation at no cost line came from the capability breakdown itself, not from my review. My only point was that if the document says implementation is free, we should state what is being given away, because unpriced generosity does not show up on a CFO spreadsheet. The thing that does need resolving is that if a PS quote has been issued and is not being waived, the capability doc cannot say implementation is included at no cost. Those two artifacts meet each other at contract time.

On one container, that is genuinely useful and it corrects me. I flagged container as invented vocabulary because it appears nowhere in our documents. If Mandeep used it on the call then it is his word and we should use it, we just need to define it once in writing, because an undefined unit of scope is exactly what people argue about at acceptance. I would define it as one slot on one page, decisioned per visitor from an agreed pool of candidate assets. And here is the good news, that is the same size as the acceptance bar we already committed to, which reads as the pilot brand homepage with a pool of twenty to thirty assets where different visitors verifiably see different content. His one container and our acceptance bar are the same thing. Worth saying that back to him.

On pilot brand, your read is better information than mine and I will take it. Ours came from the July 24 call where Kate Spade was named as the pilot specifically because it carries lower business impact for the first production run. If that has been superseded by Coach, two things follow. First, Kate Spade is named as the pilot in three places in the Implementation Plan and in a section heading in Doc 1, so those need correcting before Nitin or Mandeep reads either again, or we recreate the same problem in reverse. Second, and I will say this once and not push it, launching first on Coach North America into the holiday window inverts the risk posture that Kate Spade was chosen for. That may well be right commercially. It just makes two cheap things worth adding now that cannot be retrofitted later, a holdout and a staged traffic rollout, so we start on a small percentage of Coach NA traffic and open it up as it proves out.

On Oct 1 and Nov 1, I cannot give you a yes or no yet and here is exactly why. First, something to test by Oct 1, tested where, in our staging against their content or in their lower environment. Those are different milestones about three to four weeks apart. If it is one container in a lower environment, Oct 1 is feasible, it is essentially the feature complete demonstration we already have targeted for end of September, and it holds as long as the build starts now, we get a content sample of roughly one hundred to five hundred assets within about a week of kickoff, we have the slot map for that one container, and the working session participants are named.

Nov 1 live in production on Coach NA is conditionally feasible, but the critical path is theirs, not ours. Our SDK and integration kit land mid October. Everything between that and a production launch is their front end integration, their QA, their security and network sign off, and a production release slot.

And this is the question that actually unlocks the schedule. Mandeep told us November is their code freeze, and he is now saying Nov 1 is his deadline to impact Coach NA. If the integration has to land before the freeze then the real deadline is not Nov 1, it is the last date their code can ship before the freeze, probably mid to late October, and that pulls our SDK delivery earlier and compresses everything behind it. Please ask him for that exact date and whether this gets a freeze exception. Nobody can commit to a schedule until we have it, and that one question is worth more than another round of estimates from us.

One more thing to close with him. Impact Coach NA before the holiday reads two ways. If it means the system is running during holiday traffic, Nov 1 delivers that. If it means proven lift by Nov 1, nobody can do that, because a holiday lift cannot be measured before the holiday. Better to settle that now than to find it in December. And the thing that makes his date credible is his own scope discipline, one container, one page, one brand, one market. Every surface added past that turns a plausible date into an implausible one. That is a good news message to give him.

On the revenue figures, the sourcing rationale is fine, the presentation is the issue. They sit in a table headed metric and figure, which reads as fact rather than illustration. Two fixes and the second one is an upgrade. Label them illustrative, and give the CFO the model with the inputs exposed so they can put their own actuals in. A CFO trusts a model they can populate more than a number we hand them. The arithmetic still needs a pass though. If DTC is around eighty seven percent of net sales then DTC is close to six billion, not four and a half, so the four and a half is probably Coach brand DTC while the sixty nine million is one percent of Tapestry net sales. Two entities in one calculation. Pick one and hold it across every line. And the base is still wrong in kind rather than in size, because DTC includes stores and this only touches digital. Use their reported digital penetration, or state it as a labeled assumption. Last thing, digital revenue grew high teens is a growth rate, it does not size the opportunity, that needs digital as a share of sales which is a different number.

On multi brand and no black box being the two reasons we were selected, that is exactly right and it means both should lead the CFO document, because right now neither is a headline in it. Both are already fully specified and you can lift the language. Multi brand is per brand catalogs, configurations and audiences with hard data isolation, where the next brand is provisioning and not another build. No black box is the injection surfaces, the tuning surface with weights and decay and thresholds editable live and versioned, the explain record behind every decision, and their data scientists pushing priors from Snowflake back into the engine. One internal consequence, if his team impacting scoring is a stated reason we won, then the tuning surface is a version one acceptance item and not a phase two nicety. Our plan already treats it that way and it should stay that way under any schedule compression.

Last one, and this is the one I would fix before it goes anywhere near the customer. Dynamic audiences through Opal is real, it is generally available, but three constraints have to travel with it. It is US only right now, which matters because EMEA and Japan are in the expansion story, it is human approved rather than autonomous, which is a feature for this customer rather than a limitation, and it works off the ODP schema rather than raw warehouse rows. Worth confirming the US only status with product before we put it in writing for a multi region program. I would also keep two audience mechanisms separate rather than blurring them into one bullet, because our engine generates affinity audiences from the catalog at the edge, and Opal generates ODP audiences from the ODP schema, and they are different things with different constraints.

On search, Opal is not a site search product. Opal is the agent and assistant layer. Search could mean two very different things here. If it means a search box a shopper types into on the storefront, Opal does not provide that, that is a different product line. If it means their team asking questions in natural language over their own data and results, which content is winning for paid social arrivals on second visits, that is real and that is exactly how our documents already describe Opal, as the surface that explains and eventually proposes. Those are not close to the same thing to a CFO reading a scope list, so worth checking which one was intended.

And Opal is credit based with a shared pool, so included in scope needs a credit position or it comes back as a finance question later. The rule we have documented is that the engine decides and Opal creates and explains. The live decision path, the scoring and ranking and serving and explain records, consumes zero Opal credits ever. Credits apply to authoring and to insight, and those scale with team activity rather than with traffic. Quote them as separate meters and never blend them, because if finance models credit consumption against traffic volume the number becomes unpredictable and the deal stalls on a cost problem that does not actually exist.

Two things I would send back to Mandeep now. The last date their code can ship before the November freeze, and whether this gets an exception. And his response round on the Implementation Plan, his adjusted dates and the owners for each dependency, because that document was written to be answered and answering it is what turns proposed dates into contractual ones.
