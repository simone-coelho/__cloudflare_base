# Tapestry / Experience & Content Personalization — answer pack for the account team

**Who this is for: our account executive.** It answers the eight follow-up questions raised against the
scope responses, gives you sentences you can put in front of Mandeep as they are, names the phrasings
that would cost us, and routes the two questions that belong to Professional Services and legal.

It is deliberately shorter than the technical material. That is the point — see *How we should work
this* at the end.

---

## The eight answers

### 1 · Data used for scoring, and first versus third party

**Correct, and yes: drop the ingestion and formatting language.** If the data is in their repository and
they point us at it, the provenance makes no difference to us. A field is a field.

Keep one line, because it is not a formatting point but an addressability one: a person-level record
helps for a visitor we can match to that record. So first-party or third-party attributes apply where
identity is resolved, and in-session behaviour is what carries the anonymous majority. Worth one sentence
because it sets the expectation of where purchased data actually pays for itself.

### 2 · The affinity engine and weighting

**Accurate, with one precision that prevents an argument later.** The weighting sits on the **placement**,
not inside the rules. Rules are a separate and higher layer:

- **Eligibility gates** run before any scoring: out of stock, expired, off limits.
- **Pins and blocks** outrank the engine outright and survive regeneration.
- **Weighted ranking** then orders whatever is left.

Order: gates, then pins, then weighted ranking. So they can weight the attributes that drive scoring, per
placement, and they can override the outcome entirely with a rule, and both appear in the explain record.

### 3 · Sorting on top of what their search returns

**Correct.** We re-rank the products their search or commerce platform returns, per shopper, and hand back
the reordered IDs for their front end to paint. Their platform stays authoritative for availability,
price and entitlements.

Two things worth saying once, so they are never a surprise:

- We can only order what the feed gives us. If it returns twenty-four, we order those twenty-four.
- Set the affinity weight to zero and the engine reproduces their existing sort exactly. Parity is a
  configuration of the same engine, not a fallback mode.

### 4 · The attributes that contribute to content scoring

Two sets of attributes meet at the decision.

**What the content is:** content type (on model, silo, video, editorial), its tags expressed in the same
vocabulary as the product catalogue (line, category, occasion, style world, colour, price band), plus slot
eligibility and its lifecycle window.

**What the visitor has shown:** location and regional trending, visit number, entry channel, and their
behavioural affinities.

**On behavioural signals specifically,** since the question named hover and scroll: the engine accumulates
on interaction events. Product views, saves and wishlist adds, cart adds, purchases, and declared signals
from off-site surfaces such as an email open or a form submission. Dwell already feeds journey-stage
inference. Hover time and scroll depth are not part of the registry today; either can be added as a named
signal with its own weight, which is instrumentation on their side and a configuration entry on ours.

**Recommendation:** list the agreed registry rather than raw event names. The registry is the thing they
sign off in writing, and it is the artefact their data science team asked to review.

### 5 · How Experience Personalization is scored

**Same mechanism, one level up.** Experience personalization scores the boxes rather than the items inside
them. Each section declares which dimensions it answers and how strongly; its score is the visitor's
affinity on those dimensions multiplied by those weights; and journey stage can outrank score, which is how
an offer moves up the page once someone is deciding.

Same visitor profile, same explain record, different grain. If it helps: content decides *what goes in
each box*, experience decides *what order the boxes come in*.

### 6 · Reprioritising the delivery sequence

Nothing to add. The material stands as sent.

### 7 · Two examples under "what Delivered means"

**Not overlap — two different observable outcomes**, and one sentence each removes the ambiguity:

- Content personalization: different shoppers see **different content in the same boxes**.
- Experience personalization: different shoppers see **the boxes in a different order**.

Proposed wording for the second delivery definition, parallel to the existing one:

> On the launch brand's homepage, a first-time visitor and a returning high-intent shopper verifiably
> receive a different order of page modules, chosen by the agreed dimension registry, with an explain
> record behind the ordering decision and the default template rendering wherever no decision applies.
> Demonstrated end to end in your own lower environment, as a scripted, repeatable run.

### 8 · What is becoming autonomous

**The first half of your reading is exactly right.** Their current environment is static in the sense that
a person authors and maintains the rules. The objective here is content and experience personalization
running at scale from the first click of an unknown visitor.

**One correction on the second half, and it matters commercially.** This is not a handoff at
identification. Identity does not end our involvement; it lengthens the memory. The engine keeps deciding
for known visitors and can take their existing profile data as additional input. Described as running
"up to the point they share zero-party data", we scope ourselves out of their most valuable traffic and
describe the product incorrectly.

**On the word autonomous itself**, so it is precise in front of Seth:

- **Autonomous:** audiences form and dissolve from behaviour, with nobody writing an exit rule. Weight
  mixing can run autonomously per slot, with every adjustment logged, reversible, and any weight pinnable.
- **Human approved:** changes to the dimension registry, publishing an audience, and activating anything
  the discovery layer proposes. This is Seth's own stated condition, not a limitation of ours, and it is
  worth presenting as compliance with what he asked for.

---

## Sentences you can put in front of Mandeep as they are

Plain text, no jargon, each one safe to send.

**On data:** We use whatever data you point us at, in your own repository. Whether a field originated first
party or third party makes no difference to the engine. The only practical limit is matching: a record
about a person applies to a visitor we can identify as that person, and in-session behaviour is what
covers the visitors nobody can identify yet.

**On weighting and control:** You weight the attributes that drive the scoring, per placement, and you can
override any outcome with a rule. Rules run first and outrank the engine: eligibility gates, then pins and
blocks, then the weighted ranking fills what is left. Every decision carries the drivers, the scores, and
which authority produced it.

**On sort:** We re-rank what your platform returns, per shopper, and hand back the reordered IDs. Your
platform stays authoritative for availability, price and entitlements. Turn the affinity weight to zero
and you get your existing sort back exactly.

**On content scoring:** Content is scored on what it is (type, tags in your own vocabulary, slot
eligibility, lifecycle) against what the visitor has shown (location and regional trending, visit number,
entry channel, behavioural affinity). The list is the dimension registry, and you agree it in writing
before launch.

**On experience:** Content personalization decides what goes in each box. Experience personalization
decides what order the boxes come in. Same profile, same explain record.

**On autonomy:** Audiences build and dissolve themselves from behaviour, with no exit rule written by
anyone, and weight mixing can adjust itself per slot with every change logged and reversible. Anything
that changes the registry, publishes an audience, or activates a discovery stays human approved, which is
the condition your team asked for.

**On scope of the visitor journey:** The engine starts at the first click of an unknown visitor and keeps
going once they are known. Identity makes the memory longer; it does not pass the visitor to a different
system.

---

## Phrasings that would cost us

Five sentences that are easy to say and expensive to retract. Each has a replacement.

| Do not say | Say instead | Why |
|---|---|---|
| "It personalizes up to the point the visitor identifies themselves, then hands off" | "It starts at the first click of an unknown visitor and continues once they are known" | Scopes us out of their highest-value traffic, and is not how it works |
| "You weight the attributes in the rules" | "You weight the attributes per placement; rules are a separate layer that outranks the engine" | Merges two layers we keep apart on purpose; sets an expectation the product will not meet |
| "The edge signals are probabilistic" | "The edge signals are lightweight, and every one of them is readable" | Ours is deterministic arithmetic with no model on the decision path. "Probabilistic" hands back the black box that the whole no-black-box argument removes |
| "It does fraud detection at the edge" (from the edge-computing brief) | "The same architectural pattern that banking trusts for authorisation, making a merchandising decision" | We do not do fraud. The pattern is shared; the capability is not |
| "Third-party data works the same way as behaviour" | "Third-party attributes are additive where identity is resolved; behaviour is what covers the anonymous majority" | Overstates it in a way that becomes a disappointment at the first measurement |

---

## Not ours to answer

Two of the original questions are commercial and contractual, and nothing in the capability material
addresses them. They should be routed rather than improvised.

- **The services agreement** (Seth's question). Professional Services / Expert Services owns the statement
  of work. What delivery owns and can supply into it: deliverable definitions, acceptance criteria, the
  customer dependency list with its Needed By dates, and the timeline logic. All four exist and are
  current.
- **Year 2 continuation, missed milestones, vendor switching.** No document we have produced addresses
  continuation terms, a threshold number or percentage of milestones, or transition. This is legal and
  commercial.

**One observation to hand to whoever owns those, because the two facts interact:** the milestone table
labels two dates "Contractual milestone" without defining what follows from missing one, while the
dependency section extends every milestone day for day where a customer dependency lands late. Those
should be read together, and any remedy belongs in the contract in the contract's own words rather than
paraphrased in a capability appendix.

---

## Four open items that are not questions, they are decisions

These will surface at signature whatever we answer. Naming them now is cheaper than discovering them then.

1. **The launch brand.** The documents Mandeep and Nitin hold name Kate Spade as the pilot; the current
   framing says Coach. We can write it either way and cannot write it both ways.
2. **Product grid sorting, in or out.** Our own material has said both. Item 3 above answers the mechanism;
   whether it is in the contracted scope is a commercial decision, and it adds a commerce-platform
   integration to the schedule if it is in.
3. **Who delivers the tuning interface.** The acceptance definition says weights are live-tunable by their
   team. Whoever delivers that surface should be named with a date, or the acceptance wording has to change.
4. **Production or lower environment.** No deliverable currently commits to production, while the customer's
   stated objective is production before the holiday period. Say which, in writing.

---

## How we should work this

Half of the last round trip happened because one document was written for two readers who need different
things. Going forward:

- **For you:** one sentence of answer, one sentence of the single constraint that changes a decision, and a
  sentence you can paste. That is this document.
- **For Nitin and the data science team:** the full mechanism, the registry, and the arithmetic. That is
  the Solution & Algorithm document and the architecture note.
- **When you need something confirmed,** ask it exactly as you did here: as a proposition to be confirmed
  or corrected. It is the fastest format for both of us, and every one of your eight was well formed.

*Prepared by the delivery side. The scope, acceptance criteria and dependency list are unchanged by these
answers.*
