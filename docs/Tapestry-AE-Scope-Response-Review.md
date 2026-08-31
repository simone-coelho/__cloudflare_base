# Scope response: review notes before it goes to Mandeep and Nitin

**Who this is for: our account executive.** Notes on the draft *Response to Clarifying Questions*.
The draft is good, the structure is right, and most of it can go as written. **Six items need changing
first**, and three of those conflict with a document Mandeep and Nitin already hold, which means they
would be found rather than missed.

Full replacement wording is given for each. All of it is safe to paste.

---

## Six changes before it goes

### 1 · Third-party data needs one clause of history (Item 1)

The draft says third-party data can be incorporated once it is available in a system we can reference.
That is correct, and it is what we told them: a readable format, they point us at it, and a stable
identifier that lets us link a record to a visitor.

What is missing is the history. As written it reads as though third-party data was part of the
arrangement from the beginning, and it was not. The Implementation Plan they already hold describes
the scoped build as first-party only. Both statements can stand together, but only if we say which
is which.

**Replacement:**

Third-party attributes were not part of the original scope, and nothing in the design forecloses them.
Once a field sits in your repository and you point us at it, the origin of that field makes no
difference to the engine. The requirement is practical rather than architectural: a stable identifier
we can link to a visitor, and a documented meaning per field. One distinction is worth preserving,
because it governs where the value shows up. A person-level record is actionable for a visitor we can
match to that person, while in-session behaviour is what covers the cold-start majority who have not
been identified yet.

*Why it matters:* it keeps the accommodation generous and keeps the record accurate. Without it, the
first time anyone reads the Implementation Plan next to this document, our answer sounds like a
retraction rather than an addition.

### 2 · There is no model here, so "model calibration" has to go (Item 1 and summary row 1)

Two places say historical data informs the engine for *model calibration*. **We are assuming you mean
the engine itself**, and if so the phrase should change, because Item 8 of your own draft says,
correctly, that no model sits on the decision path. Nothing trains. The engine is arithmetic over
named weights, which is the whole no-black-box argument and one of the two stated reasons we were
selected. "Calibration" quietly hands that back.

**Replacement:**

Historical performance and transaction data sit outside the decision path. Decision and outcome
records export to your Snowflake environment for your own analysis, and your data science team can
push priors they derive there back into the engine. Neither trains a model, because no model runs on
the decision path.

If you were reaching for something else, there is a second reading worth having ready, and it is the
more useful one. If the question is whether the events already sitting in their warehouse can be put
to work, the answer is yes wherever a row can be stitched to a visitor, and the mechanism is not
calibration. **Those rows become actions**, exactly like a live event arriving from the site. Part 3
gives you the language.

### 3 · Item 1 scopes the profile to a single session; the rest of the document does not

Item 1 says interest accumulates on the signals the shopper gives us *in that session*. Item 4 then
lists **visit number** as a scoring attribute, and Item 8 says identity lengthens the profile's memory.
Three different scopes in one document, and visit number is one of the dimensions Mandeep named
himself, on his own statistic that most purchases land on the second and third visit.

**Replacement:** change "in that session" to **"in this session and across their previous visits."**
One phrase, and the document stops contradicting itself.

### 4 · Cut the contextual-bandit sentence in Item 5

*"Contextual bandit formats will remain the default for digital estates that have not yet implemented
this solution footprint."*

Two reasons to delete it outright. Mandeep repeated, for zero ambiguity, that content decisioning must
be **standalone**: no experiments required, no bandit required, treat the content ID like a product ID.
And the sentence tells a customer who runs a contextual bandit today that their current approach is
what people who have not bought this use. There is nothing to win in it and a needless argument to
lose. The rest of Item 5 is strong and needs no replacement.

### 5 · Put "weights live-tunable by your team" back into the delivery definition (Item 7)

Our proposed wording carried that clause and the draft does not, which leaves the two delivery
definitions saying different things about the same product.

It should go back, and the reason is worth understanding rather than just applying. **If the definition
does not say the customer tunes the weights, the next question is who picks the numbers**, and the only
remaining answer is that we do. That is the black box every document in this programme exists to
remove, and live-tunable weights are one of the two reasons we were selected.

**Replacement, parallel to the content definition:**

On the launch brand's homepage, a first-time visitor and a returning high-intent shopper verifiably
receive a different order of page modules, chosen by the agreed dimension registry, with weights
live-tunable by your team, an explain record behind the ordering decision, and your default template
rendering wherever no decision applies. Demonstrated end to end in your own lower environment, as a
scripted, repeatable run. This is an observable state, not a performance or revenue outcome.

That final sentence was in our version and dropped out of the draft. Keep it. It is one line of
insurance against "delivered" being read as "it worked" at acceptance.

**And have this ready, because they will ask who sets the weights before they start tuning:**

We propose the starting weights and the rationale for each. You agree them at registry sign-off in the
working sessions, and your team tunes from there. We do not invent values for your system, and nobody
is handed an empty form on day one.

### 6 · Remove the hover and scroll parenthetical from Recommended Next Steps

The next-steps section refers to *"the Item 4 attribute set (including hover/scroll instrumentation)"*,
but Item 4's list contains neither. As written it implies both are already in. Delete the parenthetical
and use the general answer in part 3 instead, which covers hover, scroll, and everything that comes
after them.

---

## The framing that ends this whole class of question

Several questions in this round, hover and scroll among them, are the same question wearing different
clothes: *is signal X supported?* There is one general answer, and using it means never fielding that
question again.

**The system takes any event Tapestry can dispatch and treats it as an action. The only prerequisite is
that their site or their systems emit it.**

That holds because the transport is generic and the weighting is configuration rather than code. An
incoming event becomes an action when it carries three things: a **subject** we can resolve to a
visitor, an **object** we can map onto the registry, and a **weight** saying how much that action type
counts, which is a registry entry alongside product view, wishlist add, cart add and purchase.

One precision keeps that sentence safe, and it is the distinction this round of questions keeps
collapsing:

- **Actions** are the signals that move affinity. Any event they can send can become one. That is
  configuration.
- **Dimensions** are the axes affinity is held on. Adding one is a governed registry change: named,
  documented, weighted, agreed.

So *"is hover supported"* is an actions question and the answer is yes. *"Can we personalise on a new
attribute"* is a dimensions question and the answer is yes, through the registry process. Said without
the split, "any event" invites the reading that new dimensions are free, and Mandeep has already
accepted that they are not.

This also settles the second reading in change 2. **A warehouse row that can be stitched to a visitor
is an action arriving late, not a training set.**

---

## Three sentences worth adding back

We gave you these and they dropped out. Each is short and each earns its place.

**The pagination ceiling (Item 3).** This is the one limitation that prevents an argument at
acceptance:

We order what the feed returns. If your platform hands us a page of twenty-four, personalization works
within those twenty-four; it cannot lift an item from page four into position three, because it never
sees it. Putting a whole category in play is a catalog feed on a sync cadence, which is available and
worth deciding deliberately rather than assuming.

**The parity proof (Item 3).** The best trust line we have for a commerce team, and it costs a
sentence:

Set the affinity weight to zero and the engine reproduces your existing sort exactly. Parity is a
configuration of the same engine, not a fallback mode.

**Usage rights (Item 1).** Better named now than at signature:

Usage rights for any purchased data, and the privacy posture in EMEA and Japan, sit with Tapestry to
warrant.

---

## Three small things

- **Item 2's "Recommendation" line** tells the reader to use one framing "in place of" another. That
  note was written for you, not for them, and it reads as correcting a phrase they never used. Keep
  the mechanic, cut the meta-line.
- **The dateline.** Our standing rule on this account is that August never appears in anything the
  customer reads, because of how an August date was received once before. A letterhead date is not a
  commitment date, so this is probably fine, but it will stop anyone applying the usual pre-send sweep.
  Your call.
- **Item 3's "Confirmed as described"** settles product-grid sorting as in-scope. Three of our own
  documents currently say three different things about that. Fine if it is a decision; worth being
  sure it is one.

---

## What not to change

Said plainly, because most of the draft is right and should go out as it stands.

- It **never names the launch brand**, which sidesteps a live inconsistency between our documents.
- It **routes items 9 and 10** exactly as we did, and keeps the observation that the "Contractual
  milestone" labels and the day-for-day extension clause have to be read together.
- It **carries both of our corrections** cleanly, including the commercially important one: identity
  lengthens the memory, it is not a handoff.
- It says **"periodic cadence"** where we had written "hourly," which is both safer and more accurate.
- It **drops the notes that were written for you rather than for them**, which is the audience split
  working as intended.

---

*Prepared by the delivery side. Scope, acceptance criteria and the dependency list are unchanged by any
of these edits.*
