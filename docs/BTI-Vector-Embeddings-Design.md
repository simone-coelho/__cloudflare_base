# 1. What this document decides

The working session confirmed embeddings in scope, and the parity document set the position: semantic meaning enters a decision as one weighted term computed from vectors prepared in advance, and an encoder runs live only where a shopper is searching and expects to wait. This document turns that position into a design, and it decides five things:

1. What gets a vector, and where the vector lives.
2. Which encoder produces it, and how many numbers each vector holds.
3. How a shopper's semantic taste is formed and updated.
4. How the semantic term enters the score, and what it is allowed to do.
5. How dense and sparse are evaluated side by side on your content, and what we report back.

It also states what changes when an encoder is replaced, which is the operational question this kind of design usually leaves out.

**Vocabulary.** A **vector** is a list of numbers standing for an item, a concept, a shopper or a query. An **encoder** is the fixed function that turns text or an image into that list. **Cosine similarity** measures how closely two vectors point in the same direction, 1.0 being identical in direction and 0 unrelated. **Dense** means every number in the vector carries part of the meaning and none of them has a name. **Sparse** means one number per named thing, mostly zeros. Section 4 of the parity document compares the two in full.

---

# 2. What gets a vector

| Thing | Gets a vector | From what | When |
|---|---|---|---|
| Content piece | Yes | Its title, copy, tags, and its primary image | When it is registered or changed |
| Experience module | Yes | Its name, its purpose, the kinds of thing it shows | When it is registered or changed |
| Merchandising concept | Yes | The phrase a merchandiser typed, for example a module named for an intent | When the merchandiser saves it |
| Product | Optional, phase two | Title, description, attributes, primary image | With the feed |
| Shopper | Yes, but computed | The vectors of the items she has touched. No encoder involved. | On every action |
| Search query | Yes | The text the shopper typed | At request time, only in search |

Products are deliberately second. Content and modules are the first assignment, the corpus is small, and adding products multiplies the corpus by two orders of magnitude, which changes where retrieval can live. Section 8 sets the threshold.

---

# 3. Where vectors live, and what they cost

Vectors are stored with the catalog they belong to and versioned with it, so a decision can always name the vector version it used.

**The packed form.** All of a brand's content vectors are held as one packed block of numbers, loaded into the worker's memory on first use and kept there. There is no database call on the decision path.

**The size arithmetic**, at 8 bits per number, which is the standard compact form and costs very little accuracy:

| Corpus | 64 numbers per vector | 128 numbers per vector |
|---|---|---|
| 2,000 pieces | 128 KB | 256 KB |
| 10,000 pieces | 640 KB | 1.3 MB |
| 50,000 pieces | 3.2 MB | 6.4 MB |

**The cost of using them.** Comparing one shopper against 2,000 pieces at 128 numbers each is about 256,000 multiply-and-add operations, which is well under a millisecond. This is the whole reason the design puts arithmetic on the decision path and keeps the encoder off it.

**The shopper's own vector** is the same width, so 64 or 128 numbers, which is 64 to 128 bytes in compact form. It sits on her profile beside the per-dimension affinities that are already there.

---

# 4. The encoder

## 4.1 What we are choosing between

Two kinds of input, and the choice is per kind:

- **Text.** A sentence embedding model, the class of model that turns a paragraph into a few hundred numbers such that paragraphs about the same thing land close together. These are small, fast, and run at the edge or in a batch job equally well.
- **Imagery.** A vision and language model, the class that puts an image and a caption in the same space, so "structured black shoulder bag" lands near a photograph of one. This matters for your corpus specifically, because a lookbook image may carry three tags and a thousand words of visual information.

A piece's final vector is the combination of its text vector and its image vector, weighted, then reduced to the working width. The weighting between text and image is one of the numbers the evaluation in section 7 settles.

## 4.2 How the width is set

Encoders in this class output more numbers than we need, commonly 384 to 768. We fit a single projection on your corpus, once, that reduces those to the working width while keeping as much of the separation between your pieces as possible. The evaluation reports the quality at 64 and at 128 so the choice is made on your content rather than on a default.

## 4.3 Where it runs

| Case | Where | Why |
|---|---|---|
| Content, modules, concepts | A batch job at design time, outside the request path | They exist before any shopper asks for them |
| A search query | At request time, at the edge, with a cache in front and a hard timeout | The text did not exist until the shopper typed it |
| Anything on the decision path | Nowhere | A decision returns in a few hundred milliseconds and never waits on a call that can fail |

The batch job is ordinary work: it reads the catalog, encodes what changed, writes the packed block, and publishes it as a new catalog version. It runs when content changes, not on a schedule for its own sake.

---

# 5. The shopper's semantic taste

## 5.1 How it is formed

The shopper's semantic vector is the weighted, time-decayed sum of the vectors of the items she has touched, then normalised to unit length.

In words: each touch contributes that item's vector, multiplied by the weight of the behaviour (a purchase weighs more than a view) and by how recent it is (a click from a minute ago weighs more than one from last month). Those are the same behaviour weights and the same decay horizon the existing per-dimension affinities use, read from the same configuration. There is one semantic vector per shopper, not one per dimension.

## 5.2 How it is updated

On each action: decay what is there, add the touched item's vector at its behaviour weight, renormalise. The item's vector is already in memory as part of the packed block, so the update costs a few hundred additions. This is the same decay-then-accumulate step the engine already performs for affinities, extended to one more quantity.

## 5.3 What it inherits for free

Consent, erasure and retention already govern the shopper profile, and the semantic vector lives on that profile. Tracking refused means it is never written. An erasure removes it with everything else. It carries no identifiers of its own.

---

# 6. The semantic term in the score

## 6.1 The arithmetic

For each candidate the engine computes the cosine similarity between the candidate's stored vector and the shopper's semantic vector, floors it at zero so an unrelated item contributes nothing rather than a negative, multiplies it by the weight configured for that slot, and adds it to the score beside the other terms.

On the receipt it appears as its own line, with the encoder version named so the number can be reproduced:

| Term | Value | Weight | Contribution |
|---|---|---|---|
| silhouette: structured | 0.62 | 0.35 | 0.22 |
| colour: black | 0.58 | 0.20 | 0.12 |
| semantic similarity, encoder v3 | 0.71 | 0.20 | 0.14 |
| population prior, paid social, first visit | 0.30 | 0.15 | 0.05 |

## 6.2 What it is not allowed to do

Three limits, all configuration rather than code:

- **It starts low and it is capped.** The proposed starting weight is 0.20, and its contribution is capped so it cannot outrank the categorical terms a merchandiser can see and tune. Semantic similarity is a useful hint, not the author of the decision.
- **It never outranks a rule.** Off-limits, pins, exclusions and eligibility windows all resolve before scoring, exactly as they do today.
- **Zero disables it.** Set the weight to zero and the engine's behaviour is identical to today's, term for term. That is the rollback, and it needs no deployment.

## 6.3 Where it reuses existing machinery

The engine already carries a place for a term that comes from outside the categorical model: a named, versioned, weighted contribution with a hard time budget, itemised on the receipt, which is omitted with a stated reason if it cannot be produced. The semantic term uses that same shape. If your data science team later supplies its own model instead, it enters the same way, and nothing downstream changes.

---

# 7. Evaluating dense against sparse on your content

This was offered on the call and it is the part that decides the numbers above. It needs a sample and a short session with your content team.

## 7.1 What we need from you

1. **A content sample.** One hundred to five hundred pieces with whatever metadata exists, sparse is fine, and their imagery.
2. **Ten to twenty merchandising concepts** in the words you would actually use. "Bags for Gen Z" is one. "Quiet luxury", "work to weekend", "gifting under two hundred" are the shape.
3. **For each concept, the pieces that belong.** A quick pass by the person who would merchandise it. This is the ground truth, and it is the only manual step.
4. **Confirmation that we may encode your imagery** in the batch job.

## 7.2 What we measure

For each concept, both methods retrieve a ranked list, and we compare them against your labels:

| Measure | What it answers |
|---|---|
| Precision in the top five and top ten | Of what it surfaced, how much belonged |
| Recall at ten and twenty | Of what belonged, how much it found |
| Overlap between the two methods | How often they agree |
| **Found by dense only** | The pieces tags could not reach. This is the case for embeddings. |
| **Found by sparse only** | The pieces meaning could not reach. This is the case for keeping tags. |
| Behaviour on thin pieces | Quality on pieces carrying two tags or fewer, where sparse is weakest |

## 7.3 What we report

One page per concept and one summary: the two methods side by side, the pieces each found alone, the recommended working width, the recommended text and image weighting, and the recommended starting weight for the semantic term. Where dense adds nothing on your corpus, we will say so and the weight stays at zero until it earns more.

---

# 8. When retrieval has to move

Everything above assumes the comparison happens in memory on the decision path, which holds while the corpus fits. The threshold is not a mystery, it is the size table in section 3.

| Corpus | Where the comparison happens |
|---|---|
| Up to roughly 50,000 vectors | In memory on the decision path, no database |
| Beyond that, for example a full product catalog | A vector index, reached as a network call, used for **search and retrieval only** and never on the decision path |

In the second case the shape of the design does not change: the index narrows a large corpus to a few hundred candidates, and the engine ranks those candidates per shopper exactly as it ranks any candidate set today.

---

# 9. Replacing an encoder

The operational question that matters, and the one most designs omit.

**Vectors from two different encoders are not comparable.** Replacing an encoder moves every vector in the corpus, and it also invalidates every shopper's semantic vector, because that vector is a sum of item vectors in the old space.

The procedure:

1. The new encoder is pinned to a new catalog version. The old version keeps serving.
2. The whole corpus is re-encoded in the batch job, into the new version.
3. The switch is atomic, the same way a catalog activation is atomic today.
4. Shopper semantic vectors are rebuilt rather than carried over. Two ways, and the choice is yours: recompute from the items each shopper recently touched, which is exact and costs a pass over the profiles, or let the old vector decay out over the decay horizon while the new one accumulates, which costs nothing and is approximate for a few days.
5. Receipts written before the switch keep naming the old encoder version, so a decision from last month still reproduces.

We propose recomputing, because the decay path leaves a window where a receipt names a version that no longer matches the corpus.

---

# 10. Risks, and what we do about each

| Risk | What we do |
|---|---|
| The semantic term swamps the signals a merchandiser can see and tune | Starts at 0.20, capped, and visible on every receipt. Zero disables it. |
| An encoder carries associations nobody intended, and a concept vector encodes a stereotype | Concept vectors are reviewed by a person before publishing, in the same approval step the enrichment proposals already use. This is a governance step, not a technical one. |
| Thin or missing imagery on part of the corpus | The text vector stands alone. The evaluation reports quality with and without imagery so the gap is known rather than discovered. |
| Corpus growth past the in-memory threshold | Section 8. The move is planned, not forced. |
| A search encoder call is slow or unavailable | Cache in front, hard timeout, and a fall back to structured search. Search degrades, decisions are untouched. |
| Two catalog versions in flight during a re-encode | Section 9. Activation is atomic and receipts name their version. |

---

# 11. What this needs, and in what order

| # | Step | Owner | Needs |
|---|---|---|---|
| 1 | Content sample, concepts, and the labels | Tapestry | Section 7.1 |
| 2 | Encoder evaluation and the recommendation | Optimizely | Step 1 |
| 3 | Batch encoding job and the packed block | Optimizely | Step 2 |
| 4 | The semantic term on the decision path, at weight zero | Optimizely | Step 3 |
| 5 | Shopper semantic vector on the profile | Optimizely | Step 3 |
| 6 | Raise the weight on one slot, watch the receipts | Joint | Steps 4 and 5 |
| 7 | Search path: encode, cache, timeout, fallback | Optimizely | Step 2 |

Steps 3 to 5 are days of work, not weeks, and they are additive: until step 6 raises a weight above zero, the engine's decisions are byte for byte what they are today, with one more line on the receipt reading zero contribution. That is deliberate, because it means the mechanism can be inspected on live traffic before it is allowed to change anything.

---

# 12. Two open questions for your data science team

1. **Do you want to supply the encoder?** If your team already has a model it trusts on your catalogue, it plugs into the same place and we skip the selection in section 4. The evaluation in section 7 is still worth running, because it tells both of us what the semantic term is adding.
2. **Do you want the shopper's semantic vector exported?** It is 64 or 128 numbers per shopper and it joins to your warehouse on the same identifiers as everything else. It is not in the export today. If your analysts want it, say so and it goes in the same delivery.
