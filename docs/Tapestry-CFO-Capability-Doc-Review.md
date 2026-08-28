# Review — "Tapestry / Coach Personalization Capability Breakdown" (AE draft, 2026-08-20)

**Reviewer:** Simone Coelho · **Status:** INTERNAL — feedback for the account team before this reaches a CFO
**Reviewed against:** the Solution & Algorithm document, the Implementation Plan, and the 2026-07-24 contract call.
**Companion:** `Tapestry-Capability-Breakdown-v2.md` — the corrected draft, ready for Mark to format.

---

## Bottom line

The structure is right and the instinct is right: separate what they own today from what we are building, and let the CFO see both. But the draft cannot go to a CFO as written. There is a business-case number that does not survive its own arithmetic, and the delivery table commits to a scope materially larger than anything we have put in writing — under a sentence about contractual remedies. Those two things sit within one page of each other, and either one alone loses the room.

Below: what must change (§A), line-by-line accuracy corrections (§B), what is missing (§C), the business case rebuilt (§D), what the account team must verify before it ships (§E), and a reply for the thread (§F).

---

## A. Five things that must change before a CFO sees this

### A1. The $69M does not reconcile with the $4.5B — MUST FIX

The table states Coach DTC revenue of ~$4.5B, then states that a 1% conversion uplift returns ~$69M. One percent of $4.5B is $45M. The $69M appears to be one percent of Tapestry's *total company* revenue (~$6.9B scale), not Coach DTC. Two different bases, one paragraph apart, in a document whose entire persuasive weight rests on that ratio.

A CFO reconciles those numbers before they finish the page, and the moment they do, every other figure in the document becomes suspect — including the ones that are right.

There is a second, deeper problem underneath the arithmetic. **DTC includes physical stores.** Only *digital* revenue is addressable by this system, and within digital, only the traffic that lands on personalized surfaces, and within that, only the share actually exposed rather than held out for measurement. Presenting a store-inclusive base against a digital-only capability is the kind of overreach a retail CFO recognizes instantly, because channel mix is the number they know best in the building.

**Fix:** rebuild the case as a ladder from digital revenue, with the lift stated as *relative lift on exposed traffic*, measured against a holdout. Full replacement in §D. The rebuilt number is smaller. It is also defensible, and defensible is what gets signed.

### A2. "Content personalization fully active January — Coach North America + EMEA" — MUST FIX

Our Implementation Plan, the document Mandeep was asked to pressure-test, says January is **launch on one page (homepage proposed) on the pilot brand.** The AE draft turns that into two regions, fully active, on a different brand.

That is not a rounding difference. It is a different program. And it appears in a table titled Delivery Commitments, immediately above a sentence granting Tapestry a contractual remedy if the commitments are missed.

**Fix:** January = first page live on the pilot brand, with region and surface expansion sequenced after launch on a schedule set jointly. Exact replacement language in §C6.

### A3. The pilot brand is wrong — MUST VERIFY, THEN FIX

Every document currently in Mandeep's and Nitin's hands says **Kate Spade is the pilot**, with the pattern carried to Coach afterward. That was their call on the 2026-07-24 contract call, made deliberately because Kate Spade carries lower business impact during the shakedown. This draft is Coach-only, start to finish.

Either the customer has flipped the pilot back to Coach and nobody told engineering, or the AE is writing from a pre-contract frame. Both are fixable; guessing is not. If two documents describing the same contract name two different pilot brands, procurement will catch it and it will read as an internal alignment problem.

**Fix:** confirm the pilot brand with Holly and Mandeep before this ships. The v2 draft names the pilot explicitly and shows the brand sequence, so whichever answer comes back drops into one field.

### A4. "First container live for testing, October 1, unpaid beta" — MUST FIX

Three problems in one row.

*The date is early.* Our committed anchors are the integration kit in their hands **mid-October** and acceptance in *their* lower environment **end of October** — the latter chosen specifically to protect their November freeze. October 1 is three to four weeks ahead of the anchor we actually negotiated, and it is the earliest date in a table with a remedy attached to it.

*"Container" is undefined.* Nowhere in the algorithm or implementation documents does that word appear. Their team reads in slots, assets, and pages. Introducing new vocabulary in the CFO document is how two sides end up disagreeing about what was delivered.

*"Unpaid beta" is a commercial term in a capability document.* It implies a payment trigger. Whatever the commercial construct is, it belongs in the order form, phrased by the people who own it, not in a capability breakdown as an aside.

**Fix:** use the milestone language from the Implementation Plan verbatim. If the two documents describe the same milestones in the same words, there is nothing to litigate later.

### A5. The contractual-remedy sentence — REMOVE FROM THIS DOCUMENT

"Tapestry retains a contractual remedy if these delivery commitments are not met" should not be paraphrased in a capability document. Two reasons.

First, if the wording does not match the executed contract exactly, we have just created a second, looser description of a legal term — and in any dispute, the loose one gets quoted back at us.

Second, and more practically: this sentence tells the CFO what happens when we fail, in the same table where we tell them what we will deliver. It shifts the reading from *what does this buy* to *what is my recourse when it slips*. That is the wrong frame for an approval document, and it is a frame we volunteered.

**Fix:** delete it. The contract carries the remedy; the contract is where the CFO's counsel will look for it. Replace with the dependency ledger (§C4) — which is the honest, and far more useful, way to talk about delivery risk.

---

## B. Accuracy corrections, line by line

### B1. Core Platform — the entitlement problem

Everything in §1 is presented as "available today." Some of these capabilities live in different SKUs. Feature flagging and Feature Experimentation are not the same entitlement as Web Experimentation; Optimizely Analytics is a distinct product from the experiment results dashboards; Recommendations is its own product line.

If this document lists as "available today" anything Coach would actually have to buy, the first procurement pass finds it and the entire capability inventory loses credibility — including the parts that are genuinely already theirs.

**Action:** before this ships, annotate every §1 line against Coach's actual order form: *entitled and in use · entitled and unused · requires a separate SKU.* The "entitled and unused" column is a gift to the AE, incidentally — it is budget the customer has already spent and is not yet extracting value from, which is a far easier internal conversation for a CFO than new spend.

### B2. Specific wording corrections

| As written | The problem | Corrected wording |
|---|---|---|
| "Contextual Multi-Armed Bandit (CMAB) campaigns — automatically optimize toward the best-performing variation in real time" | This describes a **standard MAB**, not a CMAB. CMAB's whole point is that it picks *per visitor based on their attributes* — different visitors get different winners. It also does not update "in real time"; bandit allocation updates on an hourly cadence. And a real constraint the AE needs to know: **CMAB optimizes against event metrics; revenue metrics are not supported.** If a CFO asks "does it optimize to revenue," the answer today is a proxy event, not revenue directly. | "Multi-armed and contextual bandits — automatically shift traffic toward better-performing variations, with contextual bandits selecting per visitor based on their attributes rather than picking one global winner." Then, in the talk track, know the revenue-metric limitation before you are asked. |
| "Real-time audience membership — visitors move in and out of audiences as their behavior changes" | Listed under *available today*, but this is the flagship behavior of the thing we are **building**. Today's platform refreshes real-time segments on a sub-90-second qualification cadence over a 28-day window, and it depends on ODP. In-session entry and exit — a visitor qualifying and then de-qualifying within the same visit as their behavior decays — is new. Claiming it as current capability quietly deletes the reason to fund the new one. | Today: "Real-time audience qualification — segments refresh continuously as behavior and transactions land, typically within seconds." New: "In-session audience entry **and exit** — visitors qualify within their current session and drop out as interest decays, without waiting for a segment refresh cycle." |
| "Eight configurable dimensions (location, visit number, content type, product line affinity, and others defined by Coach)" | The contract language is **six to eight dimensions, agreed and explicitly documented, with location non-negotiable in v1.** "Eight" hardens a range into a commitment for no benefit. Worse — the named list omits **marketing/entry channel**, which Mandeep identified as his single strongest predictor. His top dimension is missing from his own capability document. | "Six to eight agreed dimensions, documented explicitly and configurable by your team — including location with regional trending, visit number, entry channel, and content type and metadata, plus the behavioral affinities derived from your catalog." |
| "Automatic affinity audiences — no manual segmentation required" | "No manual segmentation required" reads as *the model decides and merchandising is cut out.* Tapestry and ASOS both told us, in the same words, that they will not let a model make determinations without guards and constraints. This line triggers exactly that objection. | "Audiences generated from your catalog — the engine proposes audiences in your own merchandising language, your team reviews and approves them, and pinned or blocked content always outranks the engine." |
| "Front-end rendering — Coach's site continues to render as it does today" (out of scope) versus "Dynamic module reordering — reorders the page itself" and "delivered over a persistent connection" | These contradict each other on the same page. If we do not render, how do we reorder? The real answer is the agreed contract and it is better than either sentence: **we return a page-level ordered decision set addressed by content ID; their front end paints it.** A technical reviewer will find this contradiction in one pass, and Nitin is exactly that reviewer. | Keep the out-of-scope line, and change the capability line to: "Page-level ordered decisions — we return which content wins each slot **and the order of the slots**, addressed by your content IDs. Your front end renders, exactly as it does today. Reordering becomes a data change, not a re-integration." |
| "Real-time page composition — no page-load penalty" | An unquantified performance claim invites a challenge we can win, so win it with numbers. | "First paint is served from a snapshot endpoint so there is no flash of default content; in-session decisions are computed at the edge in milliseconds and delivered over a persistent connection; cross-session memory re-seeds in under a second." |
| "No competitor in evaluation offers this" | An absolute competitive claim, in writing, in a CFO document, about a category where competitors publish layout capabilities. It only takes one competitor slide to make this a liability, and it makes us sound like the vendor rather than the partner. | Replace the category claim with the mechanism, which is the part that is actually hard to match: "What distinguishes this is the mechanism: a live per-visitor affinity vector maintained at the edge, page-level ordering rather than content swapping inside fixed slots, and an explain record behind every decision. We are comfortable being evaluated on that mechanism directly." |
| "Recent DTC growth rate — high double-digit teens" | Self-contradictory. "Double-digit teens" is 13–19%; "high double-digit" is 70–99%. Small thing, but it is in the business-case table, and sloppiness there is expensive. | "High-teens" — and source it to Tapestry's own reporting, since the CFO wrote the original number. |
| "Data warehouse connectivity — Tapestry's Snowflake connection" | Direction and product are unstated. It matters, because for the new engine Snowflake plays a specific and limited role: their data scientists derive priors and push them to us; Snowflake supplements, it does not drive in-session decisioning. | "Warehouse connectivity — behavioral and decision data exports to Tapestry's Snowflake environment for independent analysis, and your data science team can push derived priors back into the engine." |
| "Cold-start handling — personalizes from the first session" | True, but it undersells the one genuinely new build in v1 and it drops Mandeep's non-negotiable dimension. | "Cold start from the first impression — a new, unrecognized visitor is served against first-party regional trending signals, which is what content and products are performing in their region right now, and the personal profile takes over within the same session as behavior accumulates. No third-party data, no waiting for a segment to populate." |
| "Stats Engine — results valid at any point" | Accurate, and underplayed for this audience. | Add: "and it controls false-discovery rate across metrics, so the business team is not acting on statistical noise." That is a CFO-grade credibility point. |

### B3. One structural correction

The new capability reads as though it sits on top of the experimentation platform. Mandeep made a point of repeating, for zero ambiguity, that **content decisioning must be standalone — no experiments required, no CMAB required.** Treat the content ID like a product ID.

If the CFO concludes the new capability depends on experimentation entitlements, we have created a false dependency, and we have contradicted the customer's own stated requirement in their own document.

**Fix:** one sentence, placed early in §2 of the v2 draft: *"Content decisioning runs standalone. It does not require an experiment to be running, and it does not depend on the experimentation platform to make decisions. Experimentation is how you measure the value it creates, and it is optional."*

---

## C. What is missing

Seven gaps. The first three are the ones that decide the outcome.

### C1. The anonymous majority — the single biggest omission

Nowhere does this document say why the initiative exists.

Between 90 and 95 percent of their traffic is unidentified. Roughly 80 percent has never been seen before. Email is about 10 percent, and clickthroughs arrive unidentified. **Every personalization capability listed in §1 as available today reaches the identified minority.** That is the gap. That is why the initiative is called Behavioral Targeting and Intelligence and deliberately not Site Personalization.

For a CFO, this reframes the entire investment from *better personalization* to *personalization for the 90% of traffic we currently cannot personalize at all.* That is a market-expansion argument, not an optimization argument, and it is worth several times more in an approval meeting. Leaving it out is the most expensive thing about this draft.

### C2. How the value gets measured — absent entirely

After "what does it cost," the CFO's next question is "how will I know it worked." There is no answer in this document.

It needs its own short section: a **holdout group** that never receives personalized decisions, a **primary metric agreed before launch**, results read through Stats Engine's always-valid inference, and reporting the business team runs themselves rather than receiving from us. The measurement design is what converts the business case from a projection into an auditable claim, and it is also our best answer to the honest skeptic in the room — because we are volunteering the mechanism that could prove us wrong.

### C3. Multi-brand leverage — absent, and it is the strongest economic argument available

The contract is Tapestry-wide. The platform is built multi-brand from the first line: per-brand catalogs, configurations, audiences, hard data isolation between brands. Extending from the pilot brand to the next is provisioning, not re-engineering.

For a *Tapestry* CFO, that is the whole economic story: **one investment, amortized across the brand portfolio, where each additional brand costs configuration rather than another build.** The draft mentions cross-market awareness as a bullet buried under experience personalization. It belongs near the top, in the money section.

### C4. What Tapestry has to provide — absent

Delivery dates are only real if the dependencies behind them are stated. The Implementation Plan carries nine (D1–D9): working-session participants including data science, a content sample, content feed access, the slot map and defaults, staging origins and network review, the conversion event, an ODP decision, security review inputs, and front-end integration capacity before their freeze.

Omitting these from the CFO document has an effect the account team may not have considered: it places 100% of the delivery risk on us, in the same table where we grant them a remedy for delay. A short "what we need from your side" section is not a hedge. It is how a CFO recognizes a real plan, and it is how the dates survive contact with their own organization.

### C5. Governance, explainability, and control — thin

There is one line about configurable weights. The actual governance model is stronger and it is what this specific customer asked for:

- **Eligibility gates run before scoring** — out of stock, expired, off-limits. An item drops out; shopper affinity is untouched.
- **Pins and blocks outrank the engine.** Merchandising authority is absolute and survives audience regeneration.
- **Season, promotion, and margin apply as tunable multipliers**, itemized in the explain record.
- **Precedence is declared:** gates, then pins, then weighted ranking.
- **Every decision carries an explain record** — the drivers, the scores, the context, exportable.
- **Their data scientists can inject their own math**, as priors and as derived weights. Mandeep specifically valued this; keep it visible.

One line for the CFO: *rules decide what can and must show; affinity decides what does show in the space left; every placement shows its receipts.*

### C6. Delivery commitments — replacement table

Replace the current table with milestone language taken verbatim from the Implementation Plan, so the two documents cannot be read against each other:

| Milestone | What is true when it is done | Target |
|---|---|---|
| Integration kit delivered | SDK, integration guide, and API reference in your developers' hands; staging origins connected and verified — **this is the line that protects your November freeze** | Mid-October |
| Acceptance in your environment | On the pilot brand's homepage, with 20–30 assets, different visitors verifiably see different content chosen by the agreed dimensions, weights live-tunable, every decision explainable — demonstrated in **your** lower environment | End of October |
| Integration and test window | Your teams integrate and test through your freeze window, on your calendar | November–December, your calendar |
| First page live | Launch on one page on the pilot brand, with joint announcement | January |
| Expansion | Additional pages, regions, and brands, sequenced jointly after launch performance is measured | Set together at launch |
| Experience personalization | Page-level module ordering | Roadmap direction, sequenced after the content capability is live and measured |

Two notes on that last row. Experience personalization was **parked by Mandeep himself** as a later-stage item on roughly a six-month horizon. Promoting a parked item into a dated commitment table — with a remedy attached — creates a liability in exchange for nothing, because it is not what they are buying now and not what they will judge us on in January. Show it as direction. And if the current draft's March/April is already in front of the customer, say so and we will handle it deliberately rather than by silence.

### C7. Two smaller gaps

**Privacy, residency, and data handling.** EMEA and Japan are named in the current draft. That means GDPR and APPI questions, and a CFO review usually loops legal. We have good answers and they should be in the document: first-party data only, no PII in the decision path, coarse geolocation only, population-level regional aggregates with no per-shopper location history stored, durable profile facts in their own ODP instance, shopper erasure as a single API call.

**Site search is listed as "not in scope."** If the customer saw natural-language search in a demonstration, this line will read as a retraction. It is also inaccurate as a category statement, since search is a separate Optimizely product line. Change to: *"Not included in this investment; available separately."*

---

## D. The business case, rebuilt

Delete the current table. Replace with a ladder the CFO can audit, then a payback line.

**The structure:**

> Coach digital DTC revenue in the launch market: **A** *(from Tapestry's own reporting — the CFO wrote this number, so use theirs)*
> Share of digital sessions touching the personalized surfaces in scope: **B**
> Share of that traffic exposed, excluding the measurement holdout: **C**
> Relative conversion lift on exposed traffic: **L**
> **Incremental revenue = A × B × C × L**

Run it at three lift bands — conservative, expected, strong — and show all three. A CFO trusts a range with a floor far more than a single large number, because the range tells them someone thought about being wrong.

**Then the line that actually closes it:**

> Year-one investment: **[figure]**. At the conservative band, payback is **[N] months**. Every band above conservative shortens it.

Payback period is the number a CFO carries into their own approval conversation. It is more persuasive than a large headline because it is a claim about *risk*, not about upside.

**Three supporting points, kept secondary so they do not dilute the primary math:**

- Order value, not just conversion rate — better content changes what gets discovered, not only whether a visit converts.
- Content operations effort — slot curation moves from manual scheduling to reviewing what the engine proposes.
- Portfolio amortization — the second brand costs configuration, not another build (§C3).

**And fix the investment figure itself.** The table asks for "Total annual investment (Year 1)" while the prose says "low single-digit millions across three years." Those are different quantities. Pick one and make the other consistent, or a CFO will assume the number is soft.

**On "Implementation at no cost."** Quantify it. "Included as part of the Lighthouse partnership" is a giveaway with no stated value. If the services engagement would normally be scoped at a given range, say so and then say it is included. Unpriced generosity is invisible on a spreadsheet.

---

## E. Verification checklist before this ships

1. **Pilot brand** — Kate Spade or Coach? Confirm with Holly and Mandeep. Blocking (§A3).
2. **Which CFO, which entity** — Coach brand or Tapestry corporate? It changes whether the multi-brand argument leads or supports.
3. **Entitlement audit** — every §1 line marked entitled-and-in-use, entitled-and-unused, or requires-a-SKU (§B1).
4. **Revenue figures** — the digital DTC base, the growth rate, and the lift math all sourced to Tapestry's own reporting, not ours (§D).
5. **Contract language** — the remedy sentence removed here and verified against executed wording wherever it does live (§A5).
6. **Initiative naming** — the contract calls this **Behavioral Targeting and Intelligence**. The capability document, the Solution and Algorithm document, the Implementation Plan, and the contract line items should all use one name. Right now we have three names for one program.
7. **"5–15 campaigns per month"** — verify with Seth and Jen before a CFO sees a productivity figure attributed to their team.
8. **Milestone parity** — the delivery table matches the Implementation Plan word for word (§C6).

---

## F. Reply for the thread

Plain text, no formatting, ready to paste.

Thanks for pulling this together, this is the right structure and the side by side is exactly what a CFO wants to see. I went through it against the algorithm doc, the implementation plan, and what we agreed on the July 24 call. Five things I would fix before it goes over, and a few additions that I think make it land harder.

The one that matters most: the business case says Coach DTC is about 4.5 billion and then says a 1 percent conversion uplift returns about 69 million. One percent of 4.5 billion is 45 million. The 69 looks like it came off a total company number. A CFO will reconcile those two figures before they finish the page, and once they do, every other number in the document is in question. There is a second issue underneath it, which is that DTC includes stores, and this only touches digital, and inside digital only the surfaces we personalize and only the traffic we expose. I have rebuilt the math as a ladder from digital revenue with a conservative, expected and strong band, plus a payback line. The number comes down. It also holds up, and it lets us put a floor under it.

Second, the delivery table commits to content personalization fully active across Coach North America and EMEA in January. Everything we have in writing with Mandeep says January is first page live on the pilot brand. That is a much bigger commitment than we made, and it is sitting right above the line about contractual remedy. I would take the milestone language straight out of the implementation plan so the two documents say the same thing in the same words.

Third, and I need your help here: every document Mandeep and Nitin currently have says Kate Spade is the pilot brand, with the pattern carried to Coach afterward. That was their decision on the contract call. This draft is Coach throughout. Has that changed on their side? If it has, great, we just need to know. If it has not, we cannot have two documents naming two different pilot brands.

Fourth, I would take the contractual remedy sentence out of this document. If the wording does not match the contract exactly we have created a looser second version of a legal term, and more practically it points the CFO at what happens when we fail, in the same table where we are telling them what we will deliver. The contract carries it. What I would put there instead is a short list of what we need from their side, the content sample, the feed access, the slot map, the front end capacity before their freeze. That is what makes the dates look real to a CFO rather than looking like a vendor promise.

Fifth, on the capabilities themselves, a few are described in ways that will not survive a technical reader. The CMAB line actually describes a standard bandit, and it is worth knowing before you are asked that contextual bandits optimize to event metrics, not revenue metrics. Real time audience membership is listed as available today, but in session entry and exit is the thing we are building, so listing it as current quietly removes the reason to fund the new one. And the document says front end rendering is out of scope in one section and that we reorder the page in another. The real answer is better than both, which is that we return an ordered decision set by content ID and their front end paints it.

The biggest thing that is missing is the reason the program exists. Ninety to ninety five percent of their traffic is unidentified and about eighty percent has never been seen before. Everything in the available today column reaches the identified minority. That is the gap, and it is why this is called Behavioral Targeting and Intelligence and not site personalization. For a CFO that turns this from better personalization into personalization for the ninety percent we cannot reach at all, which is a much stronger argument. I would also add how we measure it, meaning a holdout and an agreed primary metric, because after what does it cost the next question is how do I know it worked, and right now there is no answer in the document. And I would move the multi brand point up, because one investment amortized across the portfolio, where the next brand is configuration and not another build, is the strongest economics we have for a Tapestry CFO.

I have written all of this up with corrected language for each line, and a full rewritten draft that Mark can format directly. Sending both now. Happy to walk through it live if that is faster.
