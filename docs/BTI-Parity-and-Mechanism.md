# 1. Where we are, in one page

The 18 September session confirmed the shape the engine was designed around: **one behavioural model of the shopper, with content, experience and functional units as consumers of it.** Two decisions were taken in the session. Both fit the engine as it stands.

**Experience personalization ships first.** The sequence of modules on a page is the first assignment; content personalization inside modules follows. This runs on the existing decision path with modules as the items and the page layout as the decision. Section 3 gives the mechanism, written for the question that was asked: how does it learn a sequence without multiple versions to learn from.

**Embeddings are in scope.** Semantic understanding enters the score as one weighted term computed from vectors prepared in advance, and an encoder is called live only where a shopper is searching and expects to wait. Section 4 defines dense and sparse embeddings, shows which the engine uses for what, says where the design departs from the white paper and why, and proposes one sentence to revise in the Solution and Algorithm document so that what we say and what we build stay identical.

| What was decided or asked | How the engine serves it today | What we add | Size |
|---|---|---|---|
| Module sequencing first | Per-slot ranking with a returned order, pins, off-limits, de-duplication, per-context learning | Modules registered as items; module-level events; position-bias correction; configured ordering per context for day one | Days |
| Embeddings and semantic retrieval | The external-term seam: a weighted, itemised term with a hard time budget | Item and concept vectors at design time; a semantic taste vector per shopper; live encoding in search only | Days, plus the design review with your team |
| Slot as the unit of decision | Already the unit throughout | Re-issue the evidence figures at slot scope | Small, under a day |
| Two factors, behaviour over performance, configurable | Both terms exist, with a trust dial | A percentage dial that maps onto the trust dial | Small, under a day |
| Three-click cold start | Region and channel before the first click; the profile updates from the first action | A configurable signal floor | Small, under a day |
| Content cold start and floors | Priors, shrinkage toward the baseline, exposures-to-floor reported per item | Per-page-type defaults, proposed in section 7 | Small, under a day |
| Merge, never override, on login | Already how linking works; recent behaviour already outranks history | Accept your hashed identifier | Small, under a day |
| Configurability | Versioned configuration, effective without deployment, and the tuning surface | Per-product-type action weights; per-piece objective, designed with you | Days |
| Taxonomy owned by Tapestry | The engine is agnostic to attribute names | Your starting list | Yours |

Nothing in the session is constrained by running at the edge. One thing is bounded by it, which is how large a vector corpus can sit inside the decision path, and the content corpus is well inside the bound. Section 8 states the discipline plainly.

---

# 2. Vocabulary

The session used *slot* in two senses and *attribute* and *dimension* interchangeably, and both sides asked for exact terms. These are the terms this document uses. We propose adopting them jointly.

| Term | Meaning | Example |
|---|---|---|
| **Attribute** | A data point on a visitor, a product or a piece of content | Colour: black. Channel: paid social. Visit: second. |
| **Behaviour** | An action a shopper takes, carrying a weight | Product view, add to cart, purchase, content click, dwell |
| **Dimension** | An axis the engine scores on. It groups the values of one attribute. | Colour is a dimension; black is one of its values |
| **Affinity** | A shopper's interest in one value of one dimension, from 0 to 1. Rises with behaviour, decays with time. | Affinity to "structured" within silhouette: 0.7 |
| **Module** | A container on a page, with a module ID | The recommendations carousel, the category grid, an editorial video |
| **Slot** | The unit the engine decides. In this document a slot is a **module-level container**. A page's layout is also a slot, whose items are the modules. | The PDP layout slot holds six modules |
| **Position** | A place inside a slot | The first two cards of a carousel |
| **Piece** | One item of content, with a content ID | One hero image, one video, one editorial story |
| **Context** | The situation a decision is made in: channel, visit number, leading affinity, journey stage | Paid social, first visit, no affinity yet, exploring |
| **Journey stage** | Exploring, considering or deciding, derived from behaviour | Two product views and a size guide: considering |
| **Receipt** | The record of why a decision was made: every term and its contribution | "Structured silhouette 0.7 × weight 0.35 = 0.25" |

Mandeep's rule from the session applies to positions: "for the first two positions use one strategy, for the next three use another". That is a position rule inside a slot. His statement that a strategy is scoped to its module and never applied site-wide is the definition of a slot.

---

# 3. Learning the sequence of modules

## 3.1 The question

The reinforcement-learning framing in the white paper starts from several versions of a page and learns which wins. From there the natural question is: without versions, what is there to learn from?

## 3.2 The answer in one sentence

**An ordering is a ranking.** The engine scores each module for this shopper in this context, then sorts. It never enumerates orderings, so there is nothing to build versions of. Six modules in ten contexts is sixty quantities to estimate, not seven hundred and twenty permutations. Ten modules is one hundred, not three and a half million.

## 3.3 A worked example: a product page with six modules

Take a Coach product page. Below the gallery sit six modules, each with an ID:

| Module ID | What it is |
|---|---|
| `module.PDP.grid.1` | A grid of broad categories |
| `module.PDP.reco.1` | "We think you would like this" |
| `module.PDP.reco.2` | "Complete the look" |
| `module.PDP.editorial.1` | A styling story or video |
| `module.PDP.reviews.1` | Reviews and fit |
| `module.PDP.recent.1` | Recently viewed |

Today they appear in one fixed order. Under the engine:

1. Each module is registered as an item, with its ID, its kind, and the journey stages it suits.
2. The page layout is declared as one slot: six positions, these six modules eligible.
3. For each page view the engine scores each module for this shopper, sorts, and returns the six IDs in order. Your front end renders them in that order. A module you mark off-limits is never moved. A module you pin holds its position.

Two shoppers, illustrative values only:

| Module | Paid social, first visit, exploring | Direct, third visit, considering, two views of a structured shoulder bag |
|---|---|---|
| Category grid | **1st** | 4th |
| We think you would like this | 2nd | **1st** |
| Complete the look | 4th | 2nd |
| Styling story | 3rd | 5th |
| Reviews and fit | 5th | **3rd** |
| Recently viewed | Not shown, nothing to show | 6th |

Same six modules. No versions. Two orders, each explained on its receipt.

## 3.4 How each module's score is made

Three parts, each shown on the receipt with its contribution:

1. **What is known before any behaviour.** Region, channel, visit number, and the population prior: what shoppers in this region and context engage with. This is what carries a brand-new visitor.
2. **The shopper's affinity** to what the module carries: its kind, the categories it shows, the journey stage it suits. Rises with behaviour, decays with time.
3. **The module's learned performance in this context.** How this module has performed for shoppers in this same context, expressed as a lift against the page's baseline.

Merchandising rules sit outside the score and outrank it: off-limits, pins, exclusions.

The third part is the one that answers "how does it learn", so its arithmetic is written out. For one module in one context:

| Symbol | Meaning |
|---|---|
| **n** | Exposures of the module to shoppers in this context, decayed over the learning horizon |
| **s** | Engagements credited to it in this context, decayed the same way. "Engagement" is the outcome you choose: click, add to cart, purchase. |
| **p0** | The baseline rate for the page in this context: what a module gets on average |
| **n0** | How many observations the baseline is worth. It pulls a module's estimate toward the baseline until its own evidence outweighs it. |
| **p̂** | The smoothed estimate: (s + n0 × p0) / (n + n0) |
| **lift** | p̂ / p0, clamped. 1 means no evidence either way. |
| **γ (gamma)** | The trust dial, 0 to 1. How much the lift is allowed to move the score. |

The module's score is its base (parts 1 and 2) multiplied by lift to the power γ. At γ = 0 the learned term changes nothing. At γ = 1 it is applied in full.

## 3.5 How it starts: your page is the baseline

There is no test to set up. The order you run today is the baseline, and the trust dial starts at zero. From the first day the engine records, for every page view, what it would have shown and how each module performed, but the page keeps your order. When you raise the dial, the order moves only as far as the evidence supports, and every move is explained.

This is the difference from a test with variants: nothing is randomized to a population, nothing is held to a fixed allocation, and no version has to be designed. The learning happens on the page you already have.

## 3.6 How it learns: every page view observes every module

This is why sequencing learns faster than content. A content variant is one item in one slot and accumulates evidence one impression at a time. A module is on every page view, so **one page view is six observations**, one per module, each carrying the module's position and the decision receipt.

Evidence is kept per module per context. When a context is thin, the engine pools up a ladder: paid social on a first visit, then paid social overall, then everyone, shrinking toward the baseline at each step. So the page can move on the evidence that exists without waiting for every context to fill.

The arithmetic, at five thousand product-page views a day: thirty thousand module observations a day, about three thousand per context across ten contexts, about five hundred per module per context per day. That is the order of a day per context to reach a usable estimate. At a tenth of that traffic, about ten days. Compare a versions-based test: seven hundred and twenty orderings, each needing hundreds of views, on the same page.

## 3.7 Position bias, and how it is corrected

The one hazard worth naming plainly. A module in first position gets attention for being first, not only for being good. Learn naively and today's order entrenches itself.

Two corrections, both already in the engine's exploration modes:

- **Rotation.** On a small share of page views, around five percent, two adjacent modules swap places. Every module is then observed at more than one position, and the page still shows the same six modules.
- **Position discount.** From those observations the engine estimates how much each position is worth on its own, and normalizes engagement by where the module sat.

Neither creates a version of the page. This is the part of the mechanism that sounds like the testing the white paper is moving away from, and it is not: nobody is assigned to a variant, nothing is held constant for a measurement period, and the share is a dial you set.

## 3.8 Channel and visit number from the first day

The two signals identified as the biggest unlocks need no learning to be useful. "Paid social, first visit: the category grid first" is a rule a merchandiser writes, and it is in force the moment it is saved. Learning then refines it per context and reports where the evidence disagrees with the rule.

This is the one addition the first assignment needs: the layout slot's configuration made addressable per context, so a merchandiser can set an order for paid social on a first visit and a different one for a returning direct visitor. It is a small, well-shaped change, and because it is where the value was identified, it is the first thing we build.

## 3.9 Does it depend on content personalization coming first?

No. Both are consumers of the same shopper model. Sequencing has fewer items, a fixed candidate set, and richer evidence per page view, so it is the smaller problem of the two. Content personalization inside a module follows and reuses the same mechanism one level down: the module becomes the slot, and its pieces become the items.

## 3.10 What the first assignment needs from you

1. The page and the modules: the six IDs, what each is, and today's order.
2. Module-level events: an impression when a module is on screen and an engagement when it is used. The SDK's `rendered` call does both once a module container is marked with its ID.
3. The outcome the assignment optimizes: engagement with the module, add to cart, or purchase.
4. The starting rules you already believe: which order for which channel and visit.

---

# 4. Embeddings

This section is written to be argued with. It defines the two kinds of embedding that came up in the session, shows the same shopper in both forms, says which the engine uses for what, and where the design does not follow the white paper, says why.

## 4.1 What an embedding is

An embedding is a vector: a list of numbers that stands for something, an item, a concept, a shopper, a typed query. Two vectors can be compared by measuring how closely they point in the same direction. That measure is **cosine similarity**: 1.0 means the same direction, 0 means unrelated. Everything an embedding does for personalization comes down to "how similar is this to that", computed as arithmetic over two lists of numbers.

The thing that turns text or an image into a vector is an **encoder**. It is a fixed function, not a reasoning system: text in, numbers out, the same numbers every time for the same input. It is the only model involved anywhere in this design, and section 4.6 says exactly where it runs.

## 4.2 Dense and sparse, side by side

The session mentioned that there are two kinds. There are, and the difference is not technical detail, it decides what a merchandiser can see and touch.

**A sparse vector** has one coordinate per named thing, and most coordinates are zero. Each coordinate means something a person can read: "structured silhouette", "black", "evening". The vector is long, hundreds or thousands of coordinates, but almost all of them are empty for any one shopper.

**A dense vector** has a fixed, small number of coordinates, typically 64 to 512, every one of them non-zero, and none of them has a name. The encoder decides what each coordinate captures, and it captures meaning in the aggregate: two items with similar copy, imagery and use sit close together even if they share no tag. This is where "bags for Gen Z" can be near "playful mini crossbody" without anyone having tagged either.

The same shopper, after two views of a structured black shoulder bag in the core price band, in both forms. Illustrative values.

| Sparse: named coordinates | Value |
|---|---|
| silhouette: structured | 0.62 |
| colour: black | 0.58 |
| category: shoulder bags | 0.55 |
| price band: core | 0.41 |
| occasion: evening | 0.22 |
| every other coordinate | 0 |

| Dense: 64 unnamed coordinates | Value |
|---|---|
| coordinate 1 | 0.12 |
| coordinate 2 | -0.31 |
| coordinate 3 | 0.07 |
| coordinate 4 | 0.44 |
| coordinates 5 to 64 | ... |

Neither is "the right one". They answer different questions, and the comparison table is the reason the design uses both.

| | Sparse | Dense |
|---|---|---|
| Can a merchandiser read it | Yes, every coordinate is a word | No, coordinates have no names |
| Can a merchandiser edit it | Yes, by tagging | No |
| Understands synonyms and intent | No, "evening" and "night out" are different coordinates | Yes, they sit close together |
| Works when tags are thin | Only as far as tags exist | Yes, from copy and imagery |
| Needs an encoder | No | Yes, at design time |
| Stable when the encoder changes | Yes, tags do not move | No, every vector moves and must be recomputed |
| Governance rules can key off it | Yes: pins, exclusions, off-limits, diversity all name values | No |
| Cold start for a new item | Needs tags | Inherits from its nearest neighbours automatically |

## 4.3 What the engine already holds is a sparse vector, and more than a set of flags

The shopper profile the engine keeps today **is** a sparse vector: one coordinate per value of each registered dimension, up to 32 dimensions, with the values a shopper actually touches held per dimension. That is the "one attribute or two" concern from the session answered directly: the profile is holistic across every dimension you register, and every behaviour with a weight feeds it.

It is not a vector of zeros and ones. Each coordinate is a graded value between 0 and 1 that rises with behaviour and decays with time, so "structured 0.62 and fading" is a different fact from "structured 0.62 and rising". A flag cannot say that. This is the form that makes the receipt readable and the tuning surface possible, and it is the form the learning evidence and the merchandising rules are keyed to.

## 4.4 What dense adds, and why we are adding it

Three things the sparse form cannot do, all of which came up in the session:

1. **Intent and semantics.** A module a merchandiser names "bags for Gen Z" expresses an intent that no combination of structured attributes states. A dense vector of that module, compared to the shopper's dense taste, captures it.
2. **Coverage where tags are thin.** Content is the stated number one barrier, and thin metadata is the usual form of it. A dense vector comes from the piece's own copy and imagery, so a piece with three tags still has a full semantic position.
3. **Cold start for a new piece.** A new asset with no history inherits relevance from the pieces its vector sits nearest. This is the white paper's own argument for an embedding-first architecture, and it is the one we agree with entirely.

The white paper's metadata table already specifies this: `content_embedding`, a 64-dimensional vector, pre-computed for real-time similarity scoring. That is the design. Vectors are computed at design time, stored with the catalog, and compared at decision time.

## 4.5 How the dense side works, without training a model

**Items and concepts, at design time.** Every piece and every module is encoded once when it is registered, from its copy, its imagery and its tags, and the vector is stored with its catalog record and versioned with it. A merchandising concept is encoded the same way when the merchandiser creates it. Recompute happens when the catalog changes or the encoder version changes, in a batch, never on a request.

**The shopper, by arithmetic.** The shopper's dense taste is the **centroid** of the vectors of the items she has touched: the weighted average, with the same behaviour weights and the same time decay the sparse profile uses. Two views of a structured black shoulder bag place her near those two items; a purchase pulls her harder; last month's browsing fades. Updated on each action, no encoder involved.

**Scoring, as one term.** For each candidate the engine computes the cosine similarity between the candidate's stored vector and the shopper's taste, multiplies it by a weight you set, and adds it beside the other terms. On the receipt:

| Term | Value | Weight | Contribution |
|---|---|---|---|
| silhouette: structured | 0.62 | 0.35 | 0.22 |
| colour: black | 0.58 | 0.20 | 0.12 |
| semantic similarity to recently viewed | 0.71 | 0.20 | 0.14 |
| population prior, paid social, first visit | 0.30 | 0.15 | 0.05 |

The categorical terms say why in words. The semantic term says how close, as a number. Set its weight to zero and the engine behaves exactly as it does today.

## 4.6 Where we do not follow the white paper, and why

The paper's reference architecture describes three things this design deliberately does differently. Each is a choice with a reason, and each leaves a door open.

**1. We do not train a user-embedding model to do the ranking.** The paper describes transformer-based user embeddings retrained daily and fine-tuned in real time, the pattern used by very large streaming services. In that pattern the model learns the shopper's vector from millions of interactions. Here, the shopper's dense taste is computed from the item vectors she touched, by arithmetic, with no training loop. Why: the content corpus is small, hundreds to a few thousand pieces, and at that size a trained user model adds little over a centroid while costing three things that matter more, a training pipeline to operate, drift every time it is retrained, and a shopper vector nobody can explain or reset. **The door left open:** if your team builds one, its scores enter the decision as the external term, weighted and itemised, under a twenty millisecond budget, with no visitor identifier crossing the boundary.

**2. We do not match shoppers to similar shoppers.** The paper's cold-start method is "find users who behave like this one and use their preferences". Here, cold start is by **context**: what shoppers arriving from paid social on a first visit engage with, what shoppers in this region engage with, learned per context and pooled up a ladder when a context is thin. Why: it answers the same question, what do people like this person do, in a form that is explainable ("first-visit paid-social shoppers engage with the category grid") and that never compares one shopper's profile to another's. **Where dense similarity does the matching, it is item to item:** a new piece inherits from its nearest pieces, which needs no shopper data at all.

**3. We do not put a vector database or an encoder on the decision path.** The paper places a vector store with a 75 millisecond query budget and a feature store with a 100 millisecond budget inside the request. Here, a decision is arithmetic over stored vectors held in memory at the edge, sub-millisecond, and the only live encoder call is in search, where a shopper has typed and expects a moment's wait. Why: a decision returns in a few hundred milliseconds on every request and never waits on a call that can fail. **Where the corpus is large,** hundreds of thousands of product vectors, the edge platform's own vector index serves search as a network call, and stays off the decision path.

In every case the functional requirement stated in the session, understand the intent and semantics of a merchandised module and return the right results, is met. The difference is where the work happens and what can be explained afterwards.

## 4.7 Search

When a shopper types "bags for Gen Z", the query is new text and must be encoded live. That is tens of milliseconds and sometimes more, and it is the one place a live encoder belongs, because the shopper has asked and is waiting. The call runs with a timeout and falls back to structured search if it does not return. The retrieved candidates are then ranked for that shopper by the same engine, with the same receipt.

## 4.8 Size at the edge

A content corpus of a few thousand pieces at 64 dimensions is a few hundred kilobytes, at 128 dimensions under a megabyte. Comparing a shopper against all of it is sub-millisecond, in memory, on the decision path, with no database. The dimension count is a choice we make on your sample in the design document, trading size against how well the encoder separates your content.

## 4.9 The explainability sentence, revised openly

The Solution and Algorithm document says there is no model call in the serving path and that the path is recomputable by hand from the receipt. With a semantic term, the accurate statement is:

> **No model is called at decision time. Semantic vectors are computed in advance and versioned with the catalog. Every term in a decision, including the semantic term, is shown on the receipt with its weight and its contribution.**

What the semantic term cannot do is name its axes. "Similarity 0.71" is explainable as a quantity and a contribution; the sixty-four numbers inside the vector have no human names. We would rather say that ourselves than have it found.

## 4.10 What the design document decides, and how we demonstrate it

The design document that follows this one decides three things on your content sample: which encoder, text and image, at design time; the dimension count; and the weight the semantic term starts at. It evaluates dense and sparse side by side on the same sample, as offered in the session, and reports where each one finds relevance the other misses.

The demonstration against the acceptance criterion from the session: a module named for an intent carries that intent's vector; a shopper whose touched items sit near it sees the module ranked up, and her receipt shows the semantic term that did it; a shopper far from it sees it ranked down; and beside the semantic term, her categorical affinities are shown in words, so both views of her taste can be compared on one screen.

---

# 5. Each requirement against the engine

| | Requirement, as stated in the session | Served today | What we add |
|---|---|---|---|
| B1 | Embeddings and semantic retrieval | The weighted, itemised, time-budgeted term. | Section 4. |
| B2 | Decide per slot, not per page | Every decision, weight, pin, exclusion and evidence record is per slot. | The evidence figures re-issued at slot scope, once the vocabulary in section 2 is agreed. |
| B3 | Strategy per module, with parameters, position rules, hard-bounded scope, page and category as filters, module IDs | Per-slot weights and rules; scope bounded to the slot by construction; page and category as filtering dimensions; IDs are the unit. | Position rules inside a slot: either two slots, or position bands on one. Small. |
| B4 | Score every piece across dimensions, rank, return the top | This is the decision path. | Nothing. |
| B5 | Behaviour first, performance second, configurable 90/10 or 60/40 | Behaviour is the base; performance is the learned term behind a trust dial. "Ship on behaviour alone first" is the dial at zero. | A percentage dial that maps onto the trust dial, so the configuration reads the way you think of it. |
| B6 | Three clicks; channel and region before the first click | Region and channel are read before any interaction; the profile updates from the first action; with no signal, your default renders. | A configurable signal floor. Proposed default in section 7. |
| B7 | New content starts from a prior; a threshold before performance counts | A new item inherits a prior from similar items; below its floor its estimate is pulled toward the baseline rather than ignored; the engine reports per item how many exposures it still needs. | Per-page-type floors, proposed in section 7. |
| B8 | Keep the anonymous profile on login; merge, do not override | This is how linking works. Decay already makes live behaviour outrank history. | Accept your hashed identifier as the account identifier. |
| B9 | Who generates the identifier when the edge sees the request first | The engine issues identity at the edge on the first request and never waits. Section 6. | The identifier handshake written down, with the SDK-loaded hook. |
| B10 | Geo as a signal, not a hard requirement | Coarse region from the request, never an individual address. Population trends hold no visitor identifiers. | Nothing. |
| B11 | Per-action weights, per-product-type weights, slot declarations, a token-accessed tuning surface | Versioned configuration effective without deployment; per-action weights; slot declarations; the tuning surface. | Per-product-type action weights, small. Per-piece objective: a design question, section 7. |
| B12 | Tapestry defines the attributes and behaviours | The engine is agnostic. Up to 32 dimensions, exact values. | Your starting list. |
| C1 | Cross-device identity, deferred | Not built, deliberately. Anonymous identity is first-party; recognised identity is a signed link. | Nothing now. The design leaves a later join open. |
| D | Experience personalization first | Section 3. | Modules as items; module events; position correction; per-context configuration. |

Nothing here is blocked by content and module IDs existing on your side yet. An ID is an opaque string to the engine. We build and test against synthetic IDs and swap them when yours land.

---

# 6. Identity and the first paint

**Who generates the identifier.** For a brand-new visitor the request reaches the edge before it reaches your origin. The engine issues the visitor identity itself, at the edge, on that first request, as a signed session. Nothing waits.

**What the first paint gets.** Region and channel are known before any click. The first decision is made from them and from the population prior, and it returns immediately. Where there is nothing to say, your default renders. The page never waits on the engine.

**How your identifier joins.** The page loads, the SDK loads, the live channel connects, and your hashed identifier is passed to the engine. From then on both identifiers travel together, and your warehouse can join our records to yours. When an email becomes known and your identifier changes to its hashed-email form, your backend signs the link and the two identities merge: the anonymous history is kept, the recognised history is added, and recent behaviour continues to outrank both.

**The handshake we will write down:** the SDK-loaded hook, the call that passes your identifier, and the signed link at recognition.

---

# 7. Proposed defaults for the open thresholds

Every threshold raised in the session was left open. Rather than wait, we propose defaults with reasoning, each a dial in the configuration.

| Threshold | Proposed default | Reasoning |
|---|---|---|
| Signals before first personalization | Three signals; the first personalized response on the fourth action | Matches the white paper's three clicks and removes the off-by-one: N counts signals, not the action that shows the result. Region and channel still shape the first paint. |
| Content impression floor | Homepage 500, product page 300 | Product pages accumulate more slowly. Below the floor the estimate is pulled toward the baseline, not ignored, so a new piece is neither trusted nor silenced. |
| Behaviour versus performance | Ninety percent behaviour, ten percent performance, exposed as a percentage | Ship on behaviour first, as suggested; raise the performance share as evidence accrues. |
| Rotation share for position correction | Five percent of page views | Enough to observe every module at more than one position within days; small enough to be invisible in the aggregate. |
| Learning horizon | Twenty-eight days | Long enough to smooth weekly patterns, short enough to follow a season. |

**Per-piece objective.** The session raised that one piece might optimize for engagement and another for add to cart. Today the objective is set per slot. Our proposal, to work through with Nitin: the slot sets the currency a decision is measured in; a piece may declare which event counts as its success; both are converted to the slot's currency with a value you set, so two pieces with different objectives can still be ranked in one slot. The design conversation is a session; the build is days.

---

# 8. Design discipline at the edge

The engine makes its decisions in the data centre nearest the shopper, in a few hundred milliseconds, on every request. That is what makes personalization on the first paint possible, and it sets three rules we hold to.

- **A decision never waits on a call that can fail.** Anything live, an encoder, an external model, a service, runs under a hard budget and is omitted from the decision if it does not return. The receipt says so.
- **Encoders are called where waiting is expected.** Search, where a shopper has typed. Never on the decision path.
- **Vectors on the decision path are prepared in advance and small enough to sit in memory.** A content corpus qualifies. A catalog-scale index serves search as a network call.

Training happens offline, as it does everywhere. Nothing in the session requires anything the edge cannot do.

---

# 9. Before 24 September

**What we bring:** this document, the vector design, the tuning surface with your token access, and the identifier handshake.

**What we need from you:**

1. The pilot brand and the first target page.
2. The code-freeze date for that page, and the exception process.
3. Content ID and module ID: current state, the date they will exist, and the naming convention. The `module.PDP.grid.1` pattern works. One nuance: if the same module appears on more than one page, keep the page out of the ID so its evidence pools once, and let the page be context.
4. The starting list of attributes and behaviours.
5. The module count for the first page, and today's order.
6. The outcome the first assignment optimizes.
7. The paid-social grid result, so the first configured rules start from what you already know.
