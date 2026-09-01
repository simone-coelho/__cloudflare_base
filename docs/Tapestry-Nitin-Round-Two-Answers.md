# Nitin's second round: replies and document edits

**Who this is for: our account executive.** Five items, each with reply text that can be sent as it
stands and, where he has asked for one, the exact replacement wording for the appendix.

**Read this first.** All five of his items are edit instructions to the Scope of Services, not requests
for explanation. He wants the document amended. Replying in prose is what has kept this going, so each
item below gives the reply *and* the amended section, and the covering note should say the revised
appendix follows.

One item needs an internal decision before it goes: see item 5.

---

## 1 · Third-party data in Section 1.1

**What he asked:** §1.1 says first-party signals only, and it should reflect that historical or other
user data, through Snowflake or another integration such as Merkle, will continue to be supported in
future.

**Reply, ready to send:**

Agreed, and we will amend 1.1. The distinction the section was drawing is between what the scoped build
consumes and what the architecture accommodates, and the current wording collapses the two.

To be precise about the mechanism, because it is the part that determines feasibility rather than
willingness: once a field sits in your repository and you point us at it, the origin of that field makes
no difference to the engine. What we need is practical rather than architectural, being a stable
identifier we can link to a visitor and a documented meaning per field. One distinction is worth
preserving, because it governs where the value shows up. A person-level record is actionable for a
visitor we can match to that person, while in-session behaviour is what covers the cold-start majority
who have not been identified yet. So external data is additive where identity is resolved, and
first-party behaviour is what makes the larger anonymous share of your traffic addressable at all.

**Amended §1.1, replacing the first-party signals only sentence:**

Real-time behavioural profiling runs on first-party signals: the shopper's own in-session behaviour on
your domain, scored at the edge, with no fingerprinting and no purchased audience data on the decision
path. This describes what the launch scope consumes, not a limit of the architecture. Historical
records, warehouse data through Snowflake, and third-party attributes from a provider such as Merkle
can be brought in as additional scoring dimensions or as pre-computed audiences, subject to a stable
identifier we can link to a visitor and a documented meaning per field. These were not part of the
original scope and are supported as a scoped addition; usage rights for purchased data, and the privacy
posture in each market, remain Tapestry's to warrant.

---

## 2 · Tighter definitions and per-page examples for Sections 2.1 and 2.2

**What he asked:** concrete examples per page type, homepage and PDP, so the boundary between the two
milestones is unambiguous.

**Reply, ready to send:**

The boundary is one sentence, and everything else follows from it. Content Personalization changes what
fills a slot. Experience Personalization changes which slots come first, and in what order.

On a homepage, the slots are the modules. Content Personalization means the hero, the category tile
imagery, the editorial module's story and the imagery inside the recommendation rail are each chosen per
shopper. A first-time visitor arriving from paid social sees an on-model lifestyle image from the line
she has been browsing; a returning visitor who has already seen it sees the silo or the video from that
same line. The page is laid out identically for both. Experience Personalization then changes the
sequence of those modules. The first-time visitor leads with the seasonal story; the returning shopper
with saved items leads with what she saved and sees the story further down, and in season the gifting
rail moves above both. Nobody authored either arrangement in advance.

On a product page, the slots are the imagery set and the modules below the buy box. Content
Personalization decides which images lead and which supporting content appears: on-model imagery for the
first visit, when the shopper is still being persuaded, and the silo, the zoom, the sole shot and the
fit content on a return visit, when she has moved from inspiration to evaluation. This is the behaviour
Mandeep described himself. Experience Personalization then decides the order of what sits below the buy
box: styling and the brand story ahead of reviews for a first-time visitor, and reviews, fit guidance
and returns promoted above styling for a shopper who is deciding, with complete-the-look rising for a
shopper who already has something in the bag.

**The unambiguous test between the two milestones, which is what makes them separately verifiable:**

Put two visitors' pages side by side after the Content milestone. The modules are in the same order and
the content inside them is different. Put them side by side after the Experience milestone and the
modules are in a different order as well. Each milestone can be accepted on its own evidence, and
neither depends on the other being finished.

Same engine, same visitor profile, same explain record behind every decision. The only difference is
grain: one ranks the items that go into a container, the other ranks the containers.

**On page scope:** the launch milestone is the homepage, as the acceptance definitions state. The same
mechanism applies to a product page without a further integration, because it is the same decision
returned against your own content IDs; extending to a second page is configuration and front-end work.
Which pages are in the launch scope is set at kickoff.

---

## 3 · An Experience acceptance criterion in Section 3.2

**What he asked:** the current "Delivered" definition only tests Content Personalization.

**Reply, ready to send:**

Agreed. 3.2 should carry a definition for each contractual milestone, parallel in structure. Proposed
wording for the second:

On the launch brand's homepage, a first-time visitor and a returning high-intent shopper verifiably
receive a different order of page modules, chosen by the agreed dimension registry, with weights
live-tunable by your team, an explain record behind the ordering decision, and your default template
rendering wherever no decision applies. Demonstrated end to end in your own lower environment, as a
scripted, repeatable run. This is an observable state, not a performance or revenue outcome.

**If he asks who sets the weights before his team starts tuning, which is the natural next question:**

We propose the starting weights and the rationale for each. Your team agrees them at registry sign-off
in the working sessions and tunes from there. We do not invent values for your system, and nobody is
handed an empty form on day one.

---

## 4 · Making autonomy explicit per capability

**What he asked:** expand the capability descriptions to say what runs autonomously, what needs human
approval, and what the roadmap is for autonomous tuning or optimization.

**Reply, ready to send:**

Agreed, and we will carry an autonomy marker on each capability rather than leaving it to be inferred.
Your example is correct as stated: content is decided and served autonomously, and the layout is decided
and served autonomously. There is no queue of proposals waiting for a person to approve them.

Three states, applied consistently:

Autonomous from day one, the decisions themselves. Which content fills a slot, which order the sections
appear in, how a candidate set is ranked, and who is in an audience and who has left it. No person
authors these and no person is in the loop for any individual decision. Audience membership is the
clearest case, since a shopper qualifies from behaviour within the session and exits on their own as
interest decays, with no exit rule written by anyone.

Human-configured, autonomous within the frame. The dimension registry and the starting weights are set
by people, and the engine decides freely inside that frame. Per-slot weight mixing can additionally be
switched to an autonomous mode where the engine adjusts the mix from outcome statistics, with every
adjustment logged, reversible, and any individual weight pinnable so it stops moving. Autonomy here is a
setting per slot rather than a property of the whole system.

Human-approved by design. Changes to the dimension registry, publishing an audience, and activating
anything the discovery layer proposes. This is the condition your own team set, that the brand will not
hand its pages to a system it cannot see into, and it is the boundary we built to rather than a
limitation of the engine.

The roadmap for autonomous tuning is the learning ladder already described in the Implementation Plan.
Stage one, learning the shopper, launches with the first milestone. Stage two, learning what works,
where per-item and per-slot outcome statistics feed back into ranking, is designed inside the plan and
activates after launch; its gate is data volume rather than engineering, because outcome statistics need
weeks of live decisions before they mean anything. Stage three, discovery, follows as a governed surface
that proposes rather than acts. We will show the stage-two design at M2 so your data science team can
critique it long before it turns on.

Worth restating for the record: no model runs on the decision path at any stage. The engine is
arithmetic over named weights, which is what makes every decision explainable after the fact. AI appears
once in the lifecycle, as optional design-time enrichment of content metadata, human-approved before
anything is served.

---

## 5 · Section 1.11, custom sort and the SFCC feed

**What he asked:** it says custom sort "will be enhanced" to support SFCC feeds while sitting in the
section headed available on signature. Either it is available today and the language should be fixed, or
it belongs in Section 2 with a delivery date.

**Before sending, confirm with the commercial owner whether SFCC grid sorting is inside contracted
scope.** Our own documents currently take more than one position on this, and his question cannot be
answered without settling it. The reply below is written to be true either way, and the final clause is
the one that changes.

**Reply, ready to send:**

A fair catch, and the sentence is conflating two different things. We will split it.

The ranking capability is real and present-tense. The engine re-ranks a candidate set per shopper against
the same affinity profile that drives content, and returns the reordered IDs for your front end to
paint. That belongs in Section 1 and the language should say so plainly, with no future tense.

The connection to any given commerce source is an integration rather than a product feature, and it
depends on an endpoint your side provides. It should carry a date. Which date depends on which of two
patterns you want, and they have materially different costs:

Re-ranking what the platform returns. Your page calls Salesforce Commerce Cloud exactly as it does now,
the returned candidate IDs come to our decision endpoint, and we return the same IDs in a per-visitor
order. This keeps everything the platform guarantees, being inventory, pricing, entitlements and your
existing merchandising rules, with no catalog duplication and no feed to maintain. The honest limitation
is that we order what the feed hands us, so if it returns a page of twenty-four we personalize within
those twenty-four and cannot lift an item from page four into position three, because we never see it.

Ranking the full eligible set. We hold a product catalog snapshot and rank the whole category, which
personalizes far more deeply. The cost is a product feed and its sync cadence, inventory freshness, and
your commerce merchandising rules either mirrored or explicitly gated.

One proof point worth having, because commerce teams ask for it: set the affinity weight to zero and the
engine reproduces your existing sort exactly. Parity is a configuration of the same engine, not a
fallback mode or a separate build.

**Amended §1.11, the part that stays in Section 1:**

Custom product sort. The engine re-ranks a candidate product set per shopper, using the same affinity
profile that drives content decisions, and returns the reordered product IDs for Tapestry's front end to
render. Tapestry's commerce platform remains authoritative for availability, price and entitlements.
Ranking operates within the candidate set returned.

**And the sentence that moves, to Section 2 with a date if it is contracted, or out of the appendix and
into a separately scoped addendum if it is not:**

Connection to a specific commerce source, including a Salesforce Commerce Cloud feed, is a joint
integration. Tapestry provides an endpoint returning a candidate set carrying the attributes the engine
scores against, and the delivery date depends on which integration pattern is selected.

---

## The covering note

Suggested framing for the message these go out with, because the pattern in his five items is that he
wants the document changed rather than explained:

All five are accepted. The revised Scope of Services follows with 1.1, 1.11, 2.1, 2.2 and 3.2 amended
and an autonomy marker added to each capability in Sections 1 and 2. The notes below explain each change
so the redline reads without needing a call, and we are glad to walk through any of it live.

---

*Prepared by the delivery side. Nothing in these replies changes acceptance criteria or the customer
dependency list. Item 5 is the one that needs a commercial decision before it is sent.*
