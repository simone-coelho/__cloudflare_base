# Scope of Services — answers to the account team's questions

**Audience: our account executive.** These are answers to the ten questions raised against the
Experience & Content Personalization scope appendix. Written for the AE to work from when preparing
the response — plain, complete, and consistent with the documents Mandeep and Nitin already hold
(Solution & Algorithm, Implementation Plan, BTI Deliverables, Customer Obligations).

Where a question is commercial or contractual rather than technical, it is marked and routed. Two of
them are.

---

## 1 · Real-time behavioral profiling and third-party data (Section 1.1)

**How it works.** Every visitor — identified or not — has their own live interest profile. It updates on
each interaction, scored at the network edge in milliseconds. Interest accumulates on the signals the
visitor gives, decays on a per-dimension clock, and crosses documented thresholds to qualify or drop
out of an audience within the session. There is no fingerprinting: identity is a first-party identifier
on the customer's own domain.

The reason the profile is built on first-party behaviour is not a restriction we are working around —
it is the point. Roughly 90–95% of the traffic this initiative exists to serve is anonymous, and a large
share has never been seen before. A profile built from what the visitor is doing right now is the only
mechanism that reaches them. That is why the initiative is named Behavioral Targeting and Intelligence
rather than site personalization.

**On supplementing with externally purchased data.** Nothing in the design prevents it, and there is no
statement in any document we have shared that forecloses it. We have never proposed third-party data
and it is not part of the current scope — but it is a reasonable direction and the architecture
accommodates it. The practical answer has three parts:

1. **Format.** We can consume a third-party file in any structured, keyed form — CSV, JSON/NDJSON,
   or a REST push — delivered by scheduled drop (S3/SFTP) or API. Nothing exotic is required. What we
   need is a stable key and a documented column meaning per field.
2. **Two ways it can be used, and they behave differently.**
   *As attributes* — the fields become dimensions the engine scores on, alongside behavioural
   affinities. This requires the dimension to be added to the registry with an agreed weight, which is
   the same governed process as any other dimension: named, documented, weighted, and tunable.
   *As membership* — a pre-computed audience list is carried as an audience the engine can target,
   gate, or pin against, without becoming a scoring dimension.
3. **The real constraint is identity resolution, not ingestion.** Purchased data is keyed to a person —
   email, postal address, device graph. Our profile is anonymous-first. For a visitor who has not
   identified themselves in the session, a person-keyed file has nothing to join on, so the enrichment
   lands only where identity is already resolved. Where Tapestry resolves identity in ODP, that path
   already exists and third-party attributes carried in ODP reach the decisioning layer today.

**The honest framing for the customer:** first-party behaviour is what makes the anonymous majority
addressable, and that is not replaceable by purchased data. Purchased data is additive on the identified
minority, and the ceiling on its usefulness is how much of their traffic they can resolve. We are happy
to support it; we would want to size it against that ratio before anyone pays for a feed.

**Licensing and privacy sit with the customer.** Usage rights for purchased data, and the privacy
posture in EMEA and Japan, are theirs to warrant. Worth naming early rather than at signature.

---

## 2 · What the engine is, who determines affinity, how merchandising rules enter (Section 1.5)

**One engine, one profile, both catalogs.** The same per-visitor affinity vector ranks products and
content. Per-visitor state is held per dimension, never per item — which is why the same engine ranks
the hero images on one page and an entire product catalog at the same cost per decision.

**Who determines affinity: the shopper does, and the arithmetic is readable.** Affinity is computed
deterministically from the visitor's own behaviour. No model sits on the decision path. Every score is a
number, every weight is a named piece of configuration, and every decision carries an explain record
listing the drivers that produced it.

**How merchandising input enters — three layers, in declared precedence:**

1. **Eligibility gates, before any scoring.** Out of stock, expired, off-limits for this placement.
   Gates are item properties, never visitor properties: the item drops out, the shopper's profile is
   untouched.
2. **Pins and blocks — merchandising authority outranks the engine absolutely.** A merchandiser pins
   the new-season styles to positions one and two for everyone and the engine orders everything below.
   Pins survive audience regeneration; they are not suggestions the engine may overrule.
3. **Weighted ranking — the configurable part.** Season, promotion and margin apply as weighted terms
   on top of affinity, each itemised in the explain record so a placement can always be accounted for.

Precedence is declared rather than implicit: **gates, then pins, then weighted ranking.** The sentence
that carries this best, and which already appears in the material they hold: *rules decide what can and
must show; affinity decides what does show in the space that is left; and every placement shows its
receipts.*

**Is it for recommendations or also sort?** Both, and content, and — at the Experience milestone — the
order of the page itself. They are the same decision expressed at different grains: which item wins a
slot, what order a set is returned in, which content fills a box, which boxes come first.

---

## 3 · Custom product sort (Section 1.11)

**Correct — it is our ranking applied to their feed, not a replacement for it.** The engine re-ranks a
candidate set per shopper and returns the reordered IDs; their front end paints. Their commerce
platform remains authoritative for availability, price and entitlements.

**What was agreed with Mandeep, and what the appendix reflects:** the connection is theirs to provide.
They expose an endpoint we can call and return a candidate set carrying the attributes the engine scores
against. As long as we can retrieve the data, we will sort it. Building or maintaining the commerce
integration itself is not our responsibility, and the appendix language — "any other source, provided the
feed returns a sufficient candidate set to sort" — is deliberately written that way.

**The one limitation worth stating plainly, because it prevents a later argument:** we can only order
what the feed hands us. If the platform returns a paginated set of twenty-four, personalization operates
within those twenty-four; it cannot lift item ninety-seven from page four into position three, because it
never sees item ninety-seven. If they want the whole category in play, that is a catalog feed on a sync
cadence — available, but a data-integration decision to take deliberately rather than an assumption.

**A proof point that lands well with commerce teams:** set the affinity weight to zero and the engine
reproduces their fixed, non-personalized sort exactly. Parity is a configuration of the same engine, not
a fallback mode or a separate build.

---

## 4 · What Content Personalization unlocks (Section 2.1)

Today content placement is manually curated, largely static, and tuned for the identified visitor. Every
image, banner and module is a decision someone made in advance for everybody.

Content Personalization makes each of those slots work against demonstrated intent, per shopper,
**including for the anonymous majority**, and it does so mid-session rather than at the next campaign
cycle — with no additional operational lift from the merchandising team, and an explain record behind
every placement.

The distinction from what variation-based tools do today is the important one: those choose between a
few versions someone already built. This ranks the whole content catalog for each visitor. Mandeep's own
framing is still the clearest statement of the value: *"the same layout, but the content that goes into
the different things is different — that alone will be a huge, huge, huge win."*

---

## 5 · Experience Personalization versus a contextual bandit (Section 2.2)

**They are different mechanisms, and the difference is what gets composed.**

A contextual bandit **chooses among page arrangements that someone has already built.** Each arrangement
must be authored as a variation in advance; the bandit learns which of those pre-built options performs
best for a given context, and allocation shifts on an hourly cadence. It optimises against event metrics.

Experience Personalization **composes the arrangement from the catalog, per visitor, and returns it as an
ordered decision set** addressed by the customer's own content IDs. Nobody pre-builds the arrangements.
A first-time visitor and a returning high-intent shopper receive a structurally different page — not one
of three layouts a team designed in advance.

The practical consequence for their roadmap: because the decision set carries an order value per slot,
**reordering becomes a change in the data rather than a re-integration.** Adding a module, changing what
can move, or turning ordering on for a new page is configuration and front-end work, not another
integration project.

Worth saying to them directly, because it is their own stated complaint about variation testing: the
value here is precisely that no one has to guess which arrangements to build.

---

## 6 · Reprioritising Experience ahead of Content (Section 3.1)

**Yes — the sequence is a choice, not a technical dependency, and it is theirs to set.**

To be precise about what *is* dependent: the outcome-learning stage — the engine improving from what
actually performs — genuinely requires weeks of live decision-and-outcome data before its statistics
mean anything. That is a data dependency and it cannot be compressed.

Page-level ordering is not part of that dependency. It was sequenced second because Mandeep placed it on
a roughly six-month horizon himself, and we paced behind him. The architecture carries the ordering
decision from day one.

**The trade-off to put in front of them, so they choose with open eyes:** leading with Experience means
reordering boxes whose contents are not yet personalized — the page rearranges, but each module still
shows what it shows for everyone. It also defers the telemetry that makes every later decision sharper.
Leading with Content produces visible per-shopper difference sooner and generates the data the ordering
stage benefits from.

If they want the order changed, we should take it as a deliberate joint decision at kickoff and adjust
the milestone table accordingly, rather than treating it as a variation.

---

## 7 · An Experience Personalization example under "What Delivered means" (Section 3.2)

Agreed — the section should carry one for each contractual milestone. Proposed wording, parallel to the
existing content example:

> On the launch brand's homepage, a first-time visitor and a returning high-intent shopper verifiably
> receive a different order of page modules, chosen by the agreed dimension registry, with weights
> live-tunable by your team, an explain record behind the ordering decision, and your default template
> rendering wherever no decision applies.
>
> Demonstrated end to end in your own lower environment, as a scripted, repeatable run. This is an
> observable state — not a performance or revenue outcome.

---

## 8 · Autonomy beyond autonomous segmentation

Not a misreading — autonomy is deliberately scoped, and the boundary is one the customer asked for.

**What operates autonomously:**
- **Audiences build and dissolve themselves.** A visitor qualifies from behaviour within the session and
  exits on their own as interest decays — with no exit rule written by anyone. Modelling the exit is the
  rarer half and almost nothing else in the market does it.
- **Weight mixing per slot.** Each slot can run with configured weights or in an autonomous mode where
  the engine adjusts the mix from outcome statistics. Every adjustment is logged, inspectable and
  reversible, and any individual weight can be pinned so it stops moving. Autonomy is a dial per slot,
  not a philosophy applied to the whole system.

**What stays human-approved, by design:** changes to the dimension registry, publishing an audience, and
activating anything the discovery layer proposes. This is not caution on our part — it is Seth's own
condition, stated on the call: the brand will not hand its pages to a system it cannot see into. The same
surface that explains decisions is the one that will eventually propose them, which is the order trust
has to be earned in.

Worth stating for the record: **no model runs on the decision path.** AI appears once in the lifecycle —
optional design-time enrichment of content metadata, human-approved, before content is ever served.

---

## 9 · The services agreement (Seth's question, and ours)

**Not a technical question, and not ours to answer.** Professional Services / Expert Services owns the
statement of work; the account executive owns commercial terms; legal owns the contract shell.

What the delivery side owns and can supply into it: deliverable definitions, acceptance criteria, the
customer dependency list with its Needed By dates, and the timeline logic. All four exist and are current.

Please route the services agreement question to Professional Services with that material attached, rather
than answering it from the capability documents.

---

## 10 · Year 2 continuation, milestones and vendor switching

**Commercial and legal, not delivery.** No document we have produced addresses Year 2 continuation,
termination for missed milestones, a threshold number or percentage of milestones, or vendor transition.
Nothing should be improvised in reply.

Two things the delivery side should put in front of whoever owns the answer, because they interact:

1. The milestone table labels two dates **"Contractual milestone"** without defining what follows from
   missing one. Whatever the remedy is, it belongs in the contract and should be described there once,
   in the contract's own words — not paraphrased in a capability appendix, where a looser second
   description becomes the one quoted back at us.
2. Section 3.3 makes every milestone extend **day for day** where a customer dependency lands late.
   That mechanism and any remedy have to be read together, or the same slip is counted twice.

---

*Prepared for the account team. Questions 1–8 are answerable from the material Mandeep and Nitin already
hold; 9 and 10 are routed. Delivery scope, acceptance criteria and the dependency list are unchanged by
these answers.*
