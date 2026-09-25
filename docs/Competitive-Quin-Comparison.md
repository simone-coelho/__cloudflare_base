# Quin against the platform

**Internal. For our teams.** It names a competitor and dissects their published claims, so it is not a customer handout. Section 10 is the part that can be said out loud in front of a customer, without naming anyone.

**Audience: product management, and anyone deciding what we build next.** Researched 25 September 2026 from their public site, their SDKs, their DNS and their CDN. Their claims are quoted with the source. Our capabilities are as built in this engine. Customer requirements quoted here come from the 18 September technical working session with a named retail customer, attributed line by line in `docs/architecture/tapestry-requirements-extraction-2026-09-18.md`. Anything inferred is marked.

---

---

# 0. For product management: what to conclude, and what not to

A competitor teardown is easy to misread. This section exists so that the conclusions drawn from it are the ones the evidence supports.

## 0.1 Start from what a customer actually asked for

Not from what a competitor's homepage says. In a technical working session on 18 September, a retail customer with a published behavioural-targeting strategy asked for, in their own words and in this order:

| What they asked for | Status with us |
|---|---|
| Experience personalization first: the **order of modules on a page**, not content inside them | Runs on today's engine. Modules become items, the page layout becomes a slot, the returned order is the sequence. |
| **Semantic understanding** so a module merchandised as an intent can be matched, which structured attributes cannot express | Designed. Vectors at design time, one weighted term on the decision, encoder in search only. |
| Decisions scoped to **the slot**, not the page | Already how every decision, weight, rule and evidence record works |
| **Configurability**: weights per behaviour, per product type, and an optimisation objective per piece of content | Two of three exist. The third is a design conversation. |
| Personalization by the **third or fourth action**, from channel and region before that | Region and channel are read pre-click; the profile updates from the first action |
| Identity that **merges and never overrides** on sign-in | Exactly how linking behaves |
| A taxonomy **they own**, with the engine agnostic to attribute names | By design, up to 32 dimensions |

That is the demand signal, and it came from a conversation rather than an analyst report. None of it asks for a large language model, a vector database, or intent prediction.

## 0.2 What the competitor evidence actually supports

1. **The market is validating in-session anonymous intent.** Their entire product is "score the 85 to 95 percent who are anonymous, in session, with no history". Real demand, and they are good at it.
2. **Their speed is precomputation, not a breakthrough.** Classify, then look up a pre-built creative. Their own publicly listable CDN bucket and the pre-rendered HTML in their mobile SDK show it.
3. **They sit beside us, not on top of us.** They feed Optimizely and Contentsquare deliberately. Their output is a signal our decision can consume.

## 0.3 Five conclusions not to draw

**"We need a language model on the decision path."** No. The physics excludes one from *their* path too: generating even a few tokens costs hundreds of milliseconds against a decision budget of tens. Generation belongs at design time, where content and tags are prepared, and in search, where a person has typed and expects to wait. Putting one in the serving path trades away the two things this platform is bought for, a reproducible decision and a receipt.

**"We need a vector database."** Only above roughly fifty thousand vectors, and only for retrieval and search, never on the decision path. A content corpus of a few thousand pieces is a few hundred kilobytes and compares in under a millisecond in memory at the edge. Buying an index for a corpus that fits in memory adds a network call and removes a guarantee.

**"We should build intent prediction."** Consuming it is better than building it. A clickstream classifier is close to a commodity, it is what this competitor and several others already sell, and building one puts an inference call on a path we keep model-free on purpose. The external-model term already accepts someone else's score, weighted, versioned, itemised and time-budgeted. Spend the engineering on the decision layer nobody else has.

**"Our cold start is behind theirs."** It is not, and the first draft of this document had it backwards. We cover a new visitor, from region, channel, visit number and the population prior with a pooling ladder, and a new item, which inherits from similar items and reports how many exposures it still needs. They cover the first well and the second not at all.

**"Deterministic means we do not do machine learning."** This sentence costs us credibility with exactly the audience reading this. Two things learn continuously from real behaviour: the shopper's decaying per-dimension state, updated on every event, and per-item performance within a context, accumulated from decisions served and outcomes credited. What we decline is an inference call at decision time. Section 5 has the language to use instead.

## 0.4 The backlog this actually implies

Everything the customer asked for that is not already built, sized honestly. None of it is a quarter.

| Item | Why it matters | Size |
|---|---|---|
| Slot configuration addressable per context cell | Day-one ordering by channel and visit number, before any learning. The customer called channel and visit the biggest unlocks. | Days |
| Modules registered as items, plus module-level impression and engagement events | The first assignment they named | Days |
| Position-bias correction for ordering | Without it, learning entrenches today's order | Days |
| Semantic term on the decision, at weight zero first | Their confirmed embeddings requirement | Days |
| Action weights per product type | Their configurability ask | Under a day |
| Optimisation objective per content piece | Their late ask, and undesigned | A design session, then days |

## 0.5 The positioning ask

Two sentences are worth defending in every deck and every roadmap review, because they are what survives a model arms race:

- **This is a decision and delivery platform, not a personalization feature.** The unit is a decision for a space on a page, governed by merchandising rules, delivered by the customer's own identifiers.
- **The differentiators are the receipt and the dial.** Every decision explains itself and can be replayed; every parameter is versioned configuration that changes behaviour in seconds without a release. Neither is something a trained model can offer, and both are what a regulated buying centre asks for after the demo.

# 1. The category correction, first

The two products are not in the same category, and every honest comparison starts there.

| | Quin | This platform |
|---|---|---|
| What it produces | A **signal**, then one ready-made action to inject | A **decision** for every personalizable space on a page, delivered by your own identifiers |
| The unit | An "action": overlay, promo, recommendation, with pre-rendered HTML | A piece, a product, or a module, ranked into a slot, with an order across the page |
| What it replaces | The audience and triggering layer | Nothing. The front end still renders; we decide what it renders. |
| Its relationship to us | An input we can consume | The layer that acts on inputs, governs them, explains them and delivers them |

**They are an intent predictor. We are a decision and delivery platform.** The strongest and most honest framing is that their score is a candidate input to our external-model term: additive, weighted, itemised on the receipt. Not a competitor to be beaten, a signal to be consumed.

---

# 2. The 70 millisecond question, answered

**Their own site gives three different numbers.**

| Claim | Where |
|---|---|
| "Anticipate each visitor's next move in just 70 ms" | their homepage |
| "predict customer behavior in just 17ms and deliver personalized interactions in 79ms" | their product overview |
| "data streaming speeds under 70 ms" | the Optimizely connector listing |

**What is missing from all three:** the percentile, the region, whether it is inference or an API call or end to end, the load, and whether it assumes a warm connection or a cache hit. Single unconditioned numbers.

**What the physics says.**

- A browser to regional-cloud round trip is roughly 10 to 30 ms in region and 75 to 150 ms transatlantic. **17 ms is therefore server-side compute only, excluding the network.** That is entirely plausible for a small clickstream classifier.
- **79 ms end to end requires the shopper, the termination point and the inference to be in one region, on an already-open connection, at roughly the median.** They run on Google Cloud and are London based, so a United States shopper against a European region exceeds 79 ms on round trip alone.
- **No large language model is in that path.** Generating even a few tokens costs 200 ms to 2 seconds, with time to first token commonly 150 to 500 ms. 17 ms excludes it by two orders of magnitude. Their "generative behavioral AI" is positioning; their own technical wording, "deep learning" and "neural networks", is consistent with a small discriminative model.
- **The speed comes from precomputation, and there is evidence.** Their production CDN resolves to a publicly listable Google Cloud Storage bucket holding `promos__<hash>__<hash>__<timestamp>` objects, and their Android SDK's response object carries a pre-rendered `html` field. The runtime is classify, then select from a pre-built set. Newest object observed 21 September 2026, so this is live.

**What their numbers do not cover:** tag load, event dispatch, the network leg, and injection into the page. That is the merchant's actual time to an offer appearing. Because the action is injected after render, a late paint is a live risk (inferred, not stated by them).

**What ours covers, and why it is a different claim.** A decision is computed at the point of presence nearest the shopper, so the number includes the network leg that theirs excludes. A returning shopper is answered in tens of milliseconds end to end. A brand-new visitor's first request costs more because it creates state. We publish the conditions with the number, which is the part that makes it a claim rather than a slogan.

---

# 3. What we do that they do not

This is the section the first draft of this comparison missed entirely.

| Capability | Us | Them |
|---|---|---|
| Content catalog as a versioned store: import, pull, validate, revisions, rollback, immutable snapshots | Yes | No. Catalog reaches them through a third party, for recommendations only. |
| Content ranked by the same machinery as products | Yes. Content is treated as a product. | No |
| Experience and module sequencing, the order of a page | Yes | No. Their unit is one injected action. |
| Product grid sorting over a candidate set, with parity at weight zero | Yes | Recommendations only |
| Page-level assembly: several slots, one order, de-duplication across the page | Yes | No |
| Merchandising governance: gates, then pins, then ranking; off-limits, exclusions, allowed types | Yes | Not found anywhere |
| Diversity, fatigue, freshness and journey-stage rules per slot | Yes | Not found |
| Business weighting with caps: season, promotion, margin | Yes | Not found |
| Self-building audiences generated from the catalog vocabulary, published and pruned by a merchandiser | Yes | Predictive audiences, model-defined |
| Durable cross-session memory in the customer data platform, additive, degrading to edge-only | Yes, through the ODP connector | **Explicitly not.** "using only in-session data … without relying on past data" |
| Identity: anonymous first-party, signed link at sign-in, merge and never override, resolve for warehouse joins | Yes | In-session, cookie-free |
| Explain record on every decision, with each term and its contribution | Yes | No explainability claim found |
| Replay a specific past decision and prove it reproduces | Yes | Not found |
| Per-item, per-context outcome evidence with a shrinkage ladder | Yes | Not exposed |
| Holdout arms recorded on every decision for incrementality | Yes | Not found |
| Decision and outcome export, and scheduled warehouse delivery | Yes | Not found |
| Configuration versioned, effective with no deployment, and rollback-able | Yes | No-code portal; cadence not found |
| Consent enforced so that refusal writes nothing, proven by a self-check every five minutes | Yes | First-party, no personal data claimed |
| Erasure with a receipt that names what it did not reach | Yes | Not found |
| Multi-brand isolation | Yes | Not found |

Their site has no public API reference, no pricing page, no security or trust page, no status page, and no careers page. Their case studies are multipliers with no baselines, and one customer appears as 5.61x in one place and 125x in another.

---

# 4. Cold start: our strength, not our gap

The first draft had this backwards. There are two cold starts and we address both.

**A brand-new visitor, before any click.** Coarse region from the request, entry channel, visit number. Then the population prior: what shoppers in this region and this context are engaging with right now, held as decaying counts with no visitor identifiers anywhere in it. Evidence pools up a ladder, from the full context cell to channel, to region, to everyone, so a thin context still answers. And priors imported from the customer's own warehouse can seed the model before launch, so day one is not a blank slate.

**A brand-new piece of content or a new product.** It inherits a prior from similar items, its estimate is pulled toward the slot baseline until its own evidence outweighs it, and the platform reports per item how many exposures it still needs. Nothing starves and nothing is trusted early.

**Theirs.** New-visitor intent is their design centre and they are strong at it. For new content or a new product, nothing was found: catalog-side cold start is not addressed anywhere on their site.

---

# 5. "It learns": what learns, from what, and how fast

Deterministic **at decision time** does not mean static. Two things learn continuously from real behaviour.

| What learns | From what | How fast |
|---|---|---|
| The shopper's affinity per dimension | Every event, weighted by behaviour and decayed by time | Within the request. The next decision reflects it. |
| Per-item performance, per context cell | Decisions served and the outcomes credited to them | Days at realistic traffic, and it is reported as evidence rather than asserted |

What we do not do is call a neural network when a decision is made. That is a deliberate trade: the arithmetic is reproducible, a receipt explains it, and a merchandiser can move it. The learning is in the state and the statistics, not in an opaque forward pass.

Saying "we do not use a model" is the wrong sentence and it undersells us. The right sentence is: **the model is the shopper's decaying behavioural state plus per-context outcome statistics, both learned from real data, and neither requires an inference call to serve.**

---

# 6. The tuning surface, which an intent model cannot match

Every number below is versioned configuration. Change it and the next decision reflects it, with no deployment, with an author and a note, and with a rollback that is just another revision.

| Knob | What it controls |
|---|---|
| Weight per behaviour | How much a view, a save, an add to cart or a purchase counts |
| Weight per dimension, per slot | What this particular slot cares about |
| Decay horizon | How fast interest fades on each dimension |
| Half-saturation point | How much repetition it takes to reach half the maximum |
| Enter and exit thresholds | When a shopper joins and leaves an audience, with a gap so membership does not flicker |
| Trust dial | How much learned performance is allowed to move a score, from nothing to fully |
| Exploration share and mode | How much traffic tests what is not yet known |
| Fatigue, freshness, diversity, journey stage | Per-slot behaviour rules |
| Business weighting and its cap | Season, promotion and margin influence, bounded so it cannot take over |
| Holdout share | The measurement reserve |
| Semantic term weight | How much meaning similarity counts, zero disabling it |

Two consequences worth stating plainly to a customer. **Time to change a behaviour is seconds, not a retraining cycle.** And **parity is a setting**: set the affinity weight to zero and the engine reproduces the existing order exactly, which makes a first rollout safe.

A trained classifier cannot offer this. Its behaviour is in its weights, and changing those means retraining, revalidating and redeploying. That is not a criticism of their design, it is the cost of their design.

---

# 7. Content as a product, which is why the platform generalises

The architectural claim, in one paragraph. Content pieces carry tags on the same dimensions products carry, are addressed by the customer's own identifier, and are ranked by the same scoring path. So the machinery that sorts a product grid also fills a hero slot from twenty editorial assets, and also orders six modules on a page. Three consumers, one shopper model.

This is why module sequencing needs no new engine: register the modules as items, declare the page layout as a slot that takes six, and the returned order is the sequence. It is also why an intent engine cannot follow us here. Their output is one action for one place. Reorganising a page means ranking a candidate set into positions with de-duplication, pins and off-limits regions, and that is a different kind of machine.

---

# 8. Where they are genuinely stronger

Say these out loud. Pretending otherwise gets caught.

1. **Anonymous first-session intent.** A trained sequence model over clickstream will beat hand-tuned arithmetic at "will this person convert, bounce, or need a nudge". That is their whole design centre and they are good at it.
2. **Time to value with no engineering.** One tag, no catalog needed for the audience products, results claimed in fifteen days. We need catalog, tags and dimension design first.
3. **Easy yes for an existing stack.** They deliberately feed Optimizely and Contentsquare rather than replace them, which makes them additive rather than a migration.

**And the move that follows from all three:** their intent score is a legitimate input to our decision. It enters as the external-model term, weighted, versioned, itemised on the receipt, under a hard time budget, omitted if it does not answer in time. A customer running both gets their intent signal governed and explained by our platform. That is a better conversation than a bake-off.

---

# 9. Three questions to ask them

1. "Your site says 17 ms to predict and 79 ms to deliver, and also 70 ms. Which is it, at what percentile, measured where, and from which region to which region? Show the 95th percentile time from the shopper's click to the offer on screen."
2. "When a decision is made, what runs, and where does the creative come from? Are the candidate offers precomputed per tenant, and if so, how does that differ from a lookup?"
3. "For one named session, export the reason a specific action was chosen and the alternatives it beat. And who approves an offer before it can appear?"

---

# 10. How to say this in front of a customer, without naming anyone

**On latency.** "Ask any vendor what their number covers. Inference alone, the API call, or the shopper's click to the pixel on screen. Ask for the percentile and the region. Ours is measured at the point of presence nearest the shopper, so it includes the network leg, and we publish the conditions with it. A returning shopper is answered in tens of milliseconds. A first-ever request costs more, because it creates state, and we say so."

**On intent scores.** "Intent prediction is a useful signal and we consume it. What we add is the decision: which of your assets goes in which space, in what order, governed by your merchandising rules, with a receipt that explains why and a replay that proves it. A score tells you someone is likely to buy. It does not tell your page what to show."

**On learning.** "The engine learns continuously from real behaviour, in two places: the shopper's own decaying interest, updated on every event, and per-item performance within a context, accumulated from what was served and what followed. What it does not do is call a model when it answers, which is why every decision can be explained and any parameter changed without a release."

**On cold start.** "Two cold starts matter. A visitor with no history is served from region, channel, visit number and what the population in that context is engaging with right now. A brand-new asset inherits from similar assets and is reported as still gathering evidence. Ask a vendor about the second one; it is the one usually missing."

**On control.** "Every weight, horizon, threshold and cap is configuration with a version and a rollback, effective without a deployment. Set the affinity weight to zero and you get exactly your current order back. That is what makes a first rollout safe, and it is not something a trained model can offer."
