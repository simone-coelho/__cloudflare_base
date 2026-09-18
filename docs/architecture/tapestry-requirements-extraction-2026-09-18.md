# Tapestry Technical Working Session — Requirements Extraction & Gap Analysis

**Source:** TapestryOptimizely Technical Working Session, 18 September 2026, 15:41, duration 1h 23m 48s. Full transcript.
**Prepared for:** Agentic engineering team — evaluation of the current build against customer requirements
**Prepared by:** Simone Araujo Coelho
**Version:** 1.0, 18 September 2026

**How to read this document.** Sections A–F are extraction from the transcript. Every customer requirement is attributed to a named speaker, and most carry a transcript timestamp. Where a paragraph is Optimizely-side interpretation rather than something a participant said, it is tagged **`[ANNOTATION]`** — these are judgement calls, open to challenge. Sections G–I are analysis in full: gap assessment, an open-decisions log, and the evaluation questions this handoff exists to support. Nothing in G–I is a customer statement.

**Participants**

| Name | Org | Role in this session |
|---|---|---|
| Mandeep Bhatia | Tapestry | Author of the BTI white paper. Sets direction and priority. Made the sequencing decision. |
| Nitin Tyagi | Tapestry | Co-author. Signal design, thresholds, configurability. Explicitly method-agnostic. |
| Simone Araujo Coelho | Optimizely | Architect and builder of the Edge Affinity Engine. |
| Mark Kolanach | Optimizely | Product and commercial. Terminology, scope, contract track. |
| William LaPuma | Optimizely | Document logistics. |
| "Tim" | Tapestry (assumed) | Named once by Mandeep re: a malfunctioning recommendations module. Not otherwise identified. |

---

## Read this first

Two things in this session change the current build.

**1. Embeddings are a confirmed requirement.** Two justifications were given and both were accepted: holistic attribute and behaviour coverage (Nitin), and semantic retrieval that structured attributes cannot deliver (Mandeep). The semantic argument is the one that changed Simone's position on the call. Simone committed to restructuring the model.

**2. Tapestry has reversed the delivery sequence.** Experience / module-sequencing personalization ships first; content personalization second. In the current Affinity Engine staging, layout personalization is stage four at roughly six months out. It is now stage one.

Everything else here is downstream of those two facts. The gating deliverable for the 24 September call is a defensible mechanism for learning module *sequence* without pre-built variation sets — Mandeep has said plainly that he does not understand how that can work, and has made answering it the condition for widening the group.

---

## Table of contents

- [A. Naming, framing, documents in play](#a-naming-framing-and-documents-in-play)
- [B. Requirements](#b-requirements)
  - [B1. Embeddings and semantic retrieval](#b1-embeddings-and-semantic-retrieval--confirmed-in-scope)
  - [B2. The slot as the unit of decision](#b2-the-slot-as-the-unit-of-decision--confirmed-cardinality-unsourced)
  - [B3. Strategy model, observed in product recommendations](#b3-strategy-model-observed-in-product-recommendations--observed-not-yet-confirmed-for-content)
  - [B4. Scoring and ranking](#b4-scoring-and-ranking--confirmed)
  - [B5. Two scoring factors and their weighting](#b5-two-scoring-factors-and-their-weighting--confirmed)
  - [B6. Cold start: three-click hyper-personalization](#b6-cold-start-three-click-hyper-personalization--confirmed-in-principle-values-open)
  - [B7. Content cold start and the evidence floor](#b7-content-cold-start-and-the-evidence-floor--mechanism-confirmed-values-open)
  - [B8. Identity and profile continuity](#b8-identity-and-profile-continuity--confirmed)
  - [B9. The edge/origin cold-start handshake](#b9-the-edgeorigin-cold-start-handshake--partially-resolved)
  - [B10. Geo signal](#b10-geo-signal--desirable-not-a-hard-requirement)
  - [B11. Configurability surface](#b11-configurability-surface--confirmed-in-principle-surface-not-agreed)
  - [B12. Taxonomy ownership](#b12-taxonomy-ownership--confirmed-tapestry-owns-it)
- [C. Deferred and out of scope](#c-deferred-and-out-of-scope)
  - [C1. Cross-device identity](#c1-cross-device-identity--priority-2-explicitly-not-v1)
- [D. The sequencing reversal](#d-the-sequencing-reversal)
  - [D1. The question Mandeep wants answered on 24 September](#d1-the-question-mandeep-wants-answered-on-24-september)
- [E. Hard dependencies on Tapestry](#e-hard-dependencies-on-tapestry)
- [F. Commitments, dates and process](#f-commitments-dates-and-process)
- [G. Gap analysis](#g-gap-analysis)
- [H. Open decisions log](#h-open-decisions-log)
- [I. Questions for the engineering team](#i-questions-for-the-engineering-team)
- [Appendix: quotations of record](#appendix-quotations-of-record)

---

## A. Naming, framing and documents in play

**BTI — Behavioral Targeting and Intelligence.** Nitin's term, from the Tapestry white paper (≈02:53). Mark liked it and took it "under advisement" as a candidate name for the Optimizely product. Simone endorsed it.

The rationale matters more than the label, because it defines scope:

- **Nitin (≈03:41):** content is the medium. "We are doing it on content, on experience, on some functional units, but the whole, the driver is the behavior of the consumer or the user."
- **Simone (≈03:29):** "it's not just about content. It's about the behavior and intelligence. What you do with that is irrelevant."
- **Mark (≈04:00):** "past behavior predicting current and future behavior."

**`[ANNOTATION]`** The behavioural model is the product. Content, experience/layout and "functional units" are three consumers of one shopper vector. Do not build a content-specific scoring path that cannot serve module sequencing — the reversal in Section D makes experience the first consumer, not content.

### Documents in play

| Document | Owner | What engineering needs to know |
|---|---|---|
| **Tapestry BTI white paper** (referred to as "BTI 26", "BTI 27 Architecture") | Mandeep + Nitin | Written around January 2026; Mandeep estimated nine to ten months on the call (≈1:19:32), actual elapsed is about eight. A **two-to-three-year holistic vision**, explicitly *not* the starting scope (Nitin, ≈08:54). **Section 3** contains the three-click adaptive experience example; Mark flagged it twice (≈35:24, ≈1:06:45) as the most pragmatic baseline in the document. Also the source of: dense embeddings + vector DB, device fingerprinting, the 15×12 variant figures, impression floors, multi-arm bandit for content, and reinforcement learning. |
| **BTI · Solution & Algorithm** | Simone (Optimizely) | Prepared for Tapestry; emailed during the call (≈36:17) after Teams blocked external document upload. Audience-tagged sections (front-end engineering, commerce/CMS owner, analytics & data science, security/privacy), "system in one page", visitor journey end-to-end, dependency list. **Contains the explainability commitment that Section G3 turns on:** it states there is no black box anywhere in the serving path — no runtime model call — and that the serving path is arithmetic recomputable by hand from the explain record. It also contains the four-stage plan that Section D reverses. |
| **Outcome-learning document** | Simone | Written previously, already sent to Tapestry. Simone committed to highlighting the D1 sequencing-learning question inside it (≈1:20:12). Mark asked that it be re-checked against Nitin's newer material to "eliminate confusion" (≈1:20:28). |
| **Evidence-cost-per-variant analysis** | Simone | Emailed during the call (≈36:17, screen-shared ≈38:20). Page-scoped; superseded by B2. |
| **Prior nine-delta review** | Simone | Nine deltas identified against an **earlier version** of the Tapestry paper; Simone states they were closed (≈04:22–05:29). |

**`[ANNOTATION]` Provenance caution.** The paper Nitin shared in this session is newer than the version the nine-delta review was run against, and Simone read it for the first time during the opening seven minutes of the call. Treat "nine deltas closed" as applying to the superseded version, and re-run the pass (gap G14).

---

## B. Requirements

Status labels below describe **how firmly the requirement is settled**, not how important it is. Section B mixes Tapestry requirements with Optimizely positions; the speaker attribution on each item tells you which is which.

### B1. Embeddings and semantic retrieval — **confirmed, in scope**

The white paper asked for learned dense embeddings and a vector database. Simone opened by pushing back (≈11:31): the engine coordinates per agreed dimension, and a true embedding model would have to be ingested as an **external** model — feedable into the engine, but not the model behind it. Her stated concern was the deep-reinforcement path: how it learns.

Mandeep did not accept the explanation — "No, it doesn't [make sense]. You have to explain it a bit more" (≈12:02) — and switched to a live demonstration. Two distinct justifications emerged. **Both were accepted; engineering needs both, because they imply different things.**

**Justification 1 — coverage (Nitin, ≈12:34).** One-to-one personalization needs all attributes and all behaviours. "It's not just that we can only store one attribute and two attribute… It needs to be like holistic."

**Justification 2 — semantics (Mandeep, ≈13:03–14:56). This is the one that moved Simone.** Live on Kate Spade Outlet he navigated to a listing merchandised as *bags for Gen Z*, then into a content module on a "view all" page. His point: from structured attributes alone there is **no way to know the intent** that merchandising expresses. With an embedding model you can take the semantic meaning of the module and personalize against it. "When you create embeddings, you can also do semantic aspects of personalization, which you cannot do otherwise."

Simone accepted fully and withdrew her position (≈14:58): *"Yeah, absolutely, 100%. That makes sense. You can drop what I was saying before. Ignore it. We're good in there."*

**Dense vs. sparse is the engineering team's call.** Nitin (≈19:15): "dense is one way to do it and sparse is one way to do it. Like technical implementation, like doesn't matter, the functional is what we need to achieve here."

**Acceptance criterion, verbatim (Nitin, ≈19:41):** "It should be able to understand the intent and semantic what Mandeep talked about exactly and it will and should give us right results."

**Sizing — Optimizely's assessment, not Tapestry's.** Simone (≈19:26): *"The reality is that this is not going to be that big of an embeddings database that is going to be unmanageable."* Read as: the corpus is small enough to remain manageable. She also offered to evaluate dense, then sparse, or both.

**Committed action.** Simone committed to restructuring the model so embeddings are used "in a different way," characterised as "a simple change," with a vector-embeddings design document to follow (≈43:27, ≈55:45). **`[ANNOTATION]`** The "simple change" characterisation is not yet substantiated by a written design, and it collides with the explainability commitment — see gap G3.

### B2. The slot as the unit of decision — **confirmed; cardinality unsourced**

This resolved Simone's combinatorics objection. **`[ANNOTATION]`** It is the most consequential architectural agreement in the session.

**Simone's objection (≈15:05, ≈38:20).** From the white paper: 15 variations × 12 pieces per product page = **180 variants per page**. At roughly 1,000 active products that is about **180,000 assets** — the figure she screen-shared. The paper separately cites 40 photos and 20 "see and think" pieces per product; those are *additional* figures from the paper and are **not** folded into the 180,000. Her point was evidence cost per variant: at that cardinality no variant accumulates enough evidence to be scored reliably.

**Nitin's qualifier (≈39:03).** Those figures are **maximums**. Most pages carry far less — the first PDP Mandeep opened had almost no content modules. But scenarios at that density will exist and must work the same way.

**Mandeep's resolution (≈20:13).** Scope decisions to the slot, not the page: *"If you look at content, you're only dealing with the content modules within that slot. You're not dealing with infinite number of combinations. You're dealing with 18 combinations for that particular slot."*

**Where the 18 comes from, and the caution attached to it. `[ANNOTATION]`** The figure is not derived from the paper's arithmetic — the paper's own decomposition (15 variations × 12 pieces) implies roughly **15** candidates per piece, not 18. Immediately before saying "18," Mandeep had counted content on a live Kate Spade PDP out loud and reached "20-ish, because it rotates" (≈16:22). The 18 therefore reads as an approximation from one observed page, not a specification. Mandeep also said "combinations," which for an ordered carousel is not the same count as *candidates*. **Do not treat ~18 as a design constant. Establish real candidate-set cardinality per slot type from the pilot slot map.**

**Simone's acceptance (≈38:20).** The engine already contemplates per-slot decisioning, but her **variation-count scoping** was page-level and must change: "I need to change internally how I do this to make sure that I'm not scoping it as a one pager… but treating each one of them individually." She reserved an unspecified thought experiment but expected no issue.

**`[ANNOTATION]` Engineering consequence.** The evidence-cost model must be recomputed at slot scope. The 180,000 figure now in Tapestry's hands is the wrong unit and should be re-issued (gap G4).

### B3. Strategy model, observed in product recommendations — **observed, not yet confirmed for content**

**`[ANNOTATION]` Read this status carefully.** Mandeep walked live Kate Spade and Coach PDPs and described how Tapestry's *existing product-recommendations* machinery works. No one is quoted confirming the six properties below as *content* requirements. They are the mental model the customer reasons with and will measure the build against, which makes them high-value — but they are inference, not agreed specification. Confirm them explicitly on 24 September.

His method throughout: "Let's not talk in abstracts. Let's talk in concrete terms" (≈16:01).

**Current-state weakness observed on the call.** A Kate Spade PDP carried "20-ish pieces of content, because it rotates" (≈16:22). Of the compare module: "Compare module sucks." A "visually similar" module returned a result similar only in being black — *"this is effed. I need to talk to Tim about this"* (≈18:35). On Coach, the Brooklyn 26 PDP's "We think you would like this" module was cited as a better, non-visually-similar strategy (≈20:13).

**The six properties to replicate for content:**

1. **Strategy is per module.** Different strategy types apply to different modules.
2. **Strategies take tuning parameters** — restrict to this category, or draw from all categories; restrict to these product types; "people who viewed this bag."
3. **Strategy can vary by position within a module.** "For the first two slots, show this strategy. For second three slots, do this strategy." *(transcript verbatim; "second three" is garbled, presumably "the next three")*
4. **Strategy scope is hard-bounded to the module.** *"The product recommendations are only for that particular slot. We don't take that strategy and apply it to the whole site, because if we start applying it to the whole site, it'll create problems."* **`[ANNOTATION]`** Treat as a constraint, not a preference.
5. **Page, category and product type are filtering dimensions.** "Page is a dimension… on PDP. Our categories are dimensions, specifically category, product type — they are dimensions within which the filtering is happening."
6. **Module ID is mandatory.** "We will need the concept of a module ID for every single thing, for experience layout anyway."

**⚠ "Slot" is used in two incompatible senses, and the collision is in the source.** In properties 3 and 4 above, and in B2's "18 combinations for that particular slot," Mandeep uses *slot* to mean both a position **inside** a module (property 3: first two slots, next three slots of a carousel) and the module-level container **holding** that carousel (B2, and Simone's B11 usage: "one that's just product catalog, or a carousel. Another one might be just a hero"). These differ by an order of magnitude in candidate-set size, and the evidence-cost recomputation in G4 depends on which is meant. **This must be disambiguated before any cardinality work — see gap G7.**

**Mandeep's canonical statement of the content problem — the YouTube-PDP analogy (≈24:06).** Imagine a YouTube version of a PDP. The shopper's "main movie watched" is the Brooklyn 26. Now show 20 different shots and determine which shots work best *for the person who just watched the Brooklyn 26*.

Inputs he named, in order: **recency**, **affinity**, "probably some other things," **their attributes** — "and I have to map it." **`[ANNOTATION]`** The unspecified remainder is not covered by any gap below; surface it at the next call rather than guessing.

**Two layers, stated by Mandeep and easily conflated.** A content module may itself contain a video and "a bunch of things" (≈18:27). So: (i) module-level personalization — which module, in what sequence; (ii) within-module content personalization — which asset, and its internal order. Both are in scope, and under Section D they belong to different delivery phases (gap G10).

### B4. Scoring and ranking — **confirmed**

Mark summarised (≈25:01) and Nitin confirmed (≈25:10): score each piece of content across a number of dimensions, then prioritise.

**Nitin's articulation.** A user arrives; there are ten content pieces on the page; scoring runs against everything the user has done so far **and** against the behaviours the brand has designated as most important to score against; each piece is scored, the list is ranked, "only the one on the top are kind of returned." Explicitly the same mechanism as product-recommendation re-ranking, where "we only bring up the products which are on the top of the funnel." **`[ANNOTATION]`** In context this means top of the *ranked list*, not the marketing funnel.

**Mark's version for unknown visitors (≈25:53):** take the attributes you hold on the visitor, align them against the selected dimensions, score, prioritise a piece of content.

**Terminology is not locked, and both sides noticed.** Mark first said attributes and dimensions are "the same thing, the dimension is in aggregate" (≈26:36), then refined to: **attributes are the data points you hold on the visitor; dimensions are the metrics aggregated from existing data** (age, propensity to buy, specific products). He then conceded: "I almost use them interchangeably, but they're not specifically. I should be more specific in my language." Nitin: "we'll have to start using exact examples." See gap G7.

**⚠ The ordering statement here is superseded.** Nitin said (≈26:24) "once we solve it for content, I think similar could be done for experience as well." Roughly forty minutes later Mandeep reversed it (≈58:02). **Section D governs.**

### B5. Two scoring factors and their weighting — **confirmed**

| Factor | What it is | Priority |
|---|---|---|
| User behavior | What this user is doing in session | **Takes priority** |
| Content performance | How the content performs across all users | Secondary; augments |

Nitin's illustration of factor two (≈31:11): "if there's a module everyone is clicking on and it probably has 100% click rate, then we would want to push it up for every user, irrespective of what they're doing in their session."

The priority is explicit: *"user behavior, I think, takes more priority over content impressions and content performance."*

**Suggested implementation sequencing (Nitin).** Ship on user behaviour alone first, then augment with content performance.

**Configurability is a requirement, with the shape stated (≈34:10):** "90% weightage to user attributes, 10% weightage to content performance, or like 60-40." The structure he describes is dimension → attributes: dimension *user behavior* contains roughly five attributes (clicks, add-to-cart and search named); dimension *content performance* is separate. **`[ANNOTATION]`** Note the slip in his own phrasing — "user attributes" in the quote, "user behavior" as the dimension name. Exactly the ambiguity G7 exists to fix.

### B6. Cold start: three-click hyper-personalization — **confirmed in principle, values open**

Simone raised the need for a floor (≈27:28): it takes time to accumulate enough contextual data to return anything meaningful, so there must be a threshold below which the default experience is served.

Nitin agreed and pointed to the white paper's **three-click hyper-personalization** (≈27:50). Three clicks means three actions.

**The signal ladder as Nitin walked it (≈1:07:14, elaborating white-paper Section 3):**

| Stage | Signals acquired |
|---|---|
| Pre-click | **Channel** (e.g. arriving from Instagram) and **region from IP**, if obtainable. Available before any interaction. |
| Action 1 | Lands on a page; taps or clicks a product or a CTA. *(bundles two events)* |
| Action 2 | Lands on a PDP with a certain price and colour → builds **category, product and price** profile. May move to accessories. |
| Action 3 | Continues exploring, goes inactive, adds to cart, or searches → **intent resolves**: browsing vs. buying vs. seeking inspiration. |
| Action 4 | **First personalization target.** |

**⚠ Definitional ambiguity engineering must close.** "Three clicks" means *three actions collected as signal*; the first personalized response lands on the **fourth** action. Any counter must state whether N is the signal count or the action index, or the implementation will be off by one against the customer's expectation.

**Worked example given:** search "black bags" → land on a PDP → the content or image assets should surface black-colour-specific assets.

**The two-sided constraint, and it is hard.** Not too delayed, not too early. Users "come, they'll browse for a minute, and then they'll maybe just become inactive." *"We definitely cannot be 15 or 20… It has to be early in the session because if we don't get their attention early on, they're gonna just bounce"* (≈29:36).

**Open:** three, four or five actions. Nitin: "We felt that three, we can do it, but let's see what's technically possible."

**Programme framing (Mark, ≈1:09:20):** "the original premise was accelerate conversion from cold start. Once we've done that, then we start looking at lifetime value." **`[ANNOTATION]`** Optimise v1 against cold-start conversion, not LTV.

### B7. Content cold start and the evidence floor — **mechanism confirmed, values open**

Distinct from B6: B6 is a cold *user*, B7 is cold *content*.

Simone queried the evidence floors in the white paper — minimum impressions on the order of 500 or 1,000 for a hero — and asked whether they were grounded in anything (≈30:03). The relevant white-paper provisions: multi-arm bandit for content; new content starts with a prior from similar content.

**Nitin's mechanism (≈31:11).** A carousel with performance history is replaced by a new carousel. The new one has no data. In that case: shift weight to user behaviour, and blend in the **prior carousel's performance data from previous sessions**, until the current asset has accumulated enough impressions to stand alone. **`[ANNOTATION]`** This is cold-start handling; it does not make the system bandit-dependent.

**Thresholds are not fixed and are page-type dependent.** "500 is just a threshold. It could be okay 300 or 400. It will depend upon the page as well." Homepage accumulates impressions faster than PDP — he estimated roughly 60% of users land on the homepage, so PDP impressions arrive more slowly. "It is subjected to discussion."

**Two options Nitin left open:** ignore content-performance data entirely below threshold, or blend it at reduced weight. Not decided.

### B8. Identity and profile continuity — **confirmed**

**What Tapestry already has (Nitin, ≈1:11:17).** A hashed string generated when a user lands on the site for the first time, used for all subsequent actions across the session. Once an email is known it is replaced by the hashed-email version — *still anonymous*, same hashed unique identifier. Nitin believes an identifier may already be in use via Tapestry's existing Optimizely experiments (≈1:12:40).

**Continuity requirement (Nitin, ≈1:11:57). Merge, do not override.** Simone asked whether the anonymous history should be retained on login. Nitin: "We would want to keep it same." Login yields past purchases and possibly gender, "but the real-time signals are more important, they supersede everything they have done in the past. So you want to keep whatever profile you have built in an anonymous session. Maybe merge it at some point of time, **but not override**."

**`[ANNOTATION]` Engineering consequence.** Real-time in-session signal outranks warehouse history in the ranking function. An identity join must not reset or dominate the live vector.

### B9. The edge/origin cold-start handshake — **partially resolved**

A genuine architectural gap, surfaced and worked live. **`[ANNOTATION]`** Worth scrutiny: the resolution came together in about ninety seconds and has not been written down.

**The problem (Simone, ≈1:12:55).** The engine runs at the edge in a serverless environment. For a brand-new visitor the request reaches the edge **before** it reaches Tapestry's origin — no cookie, no identifier. Tapestry's ID is therefore generated after the fact. "If it's a brand new visitor and lands there, I will not get anything from you guys. I think that we should have some type of contract where it says, if it's a brand new visitor, I can generate that identifier."

Nitin initially believed Tapestry generates it on first landing (≈1:13:38); he conceded the ordering problem once Simone pointed out the edge sees the request first.

**The resolution (Simone, ≈1:14:12 and ≈1:14:43).** The SDK supplies a WebSocket connection. Sequence: request arrives with no identifier → edge marks the decision pending → page loads → SDK loads → WebSocket established → Tapestry pushes the identifier back. "I forgot, I'm giving you a web socket connection… you can just push it back to me and say, here it is, I got it, never mind." Requires a hook on Tapestry's side: "SDK loaded, there's an ID to be able to grab."

**Left open:**

- How Tapestry stores it — cookie or otherwise. Simone: "I'm not sure how you guys are storing."
- Nitin to check what Optimizely server-side testing / Full Stack does for identifiers in the same position, though Simone noted that too would be after the fact.
- **The case the section exists to solve is still open: what the edge serves on that very first paint, before any identifier exists.** See gap G8.

### B10. Geo signal — **desirable, not a hard requirement**

**`[ANNOTATION]`** Included here because it carries design consequences, but note Nitin's own framing: geo is not a hard requirement.

Simone cautioned that mobile IPs change frequently (≈1:09:31). Nitin agreed it is "not a hard requirement." Mandeep clarified their prior work used **GeoIP, not individual user IP** (≈1:10:32). Mark's framing (≈1:10:40): until conversion, use geo purely as a signal — "then it doesn't matter if we can capture the IP or not… at that point you're going to have first party signals to utilize," which he corrected to zero-party.

**Tapestry's supporting evidence (Nitin, ≈1:09:38–1:10:07).** A fall/October test: users from New York vs. California or Miami were shown a jacket/outerwear content module vs. regular footwear and clothing. It ran on "some kind of IP or proximity detection algorithm that was part of the product" — product unnamed, mechanism unspecified. "We were able to give relevant content in that case." **`[ANNOTATION]`** No magnitude or baseline given. Treat as directional support for regional affinity over hand-written geo rules, not as a measured result.

### B11. Configurability surface — **confirmed in principle, surface not agreed**

Simone's position (≈54:24): "this is not like you have to go programming, it's basically configured." **`[ANNOTATION]`** Note this is an Optimizely product property that Tapestry welcomed, not a requirement Tapestry originated.

**Committed to be exposed:**

- **Per-action weights**, defaults from Optimizely, sliders for tuning — Simone's example: move a value from 1 to 2.5 (≈54:00).
- **Per-product-type action weighting.** "Add to cart for a particular product, like purses, to be different than an add to cart for a trinket."
- Behaviour-vs-content-performance weighting (B5).
- Thresholds and dials generally (≈36:17): "even those dials, if we wanted to tweak them and you wanted to control them, we could expose them."
- "Memory, tile and all the different components" in the first configuration screen (≈52:27). **`[ANNOTATION]`** Undefined on the call; needs naming before the UI review.
- **Slot declaration — what a slot is interested in** (≈54:24): "when you have a slot, you're going to tell it what it's interested in. That slot needs to be looking for something that is going to pull in. You might have one that's just product catalog, or a carousel. Another one might be just a hero." *(This is the module-level sense of "slot" — see the warning in B3.)*

**New requirement raised late by Nitin (≈51:47) — per-content objective selection.** The optimisation objective must be selectable **per piece of content**: "on one piece of content, engagement as a metric is the priority… impressions should have more weightage, but for other piece of content, I might say because it has an add to click CTA, CTA clicks is my objective *[presumably add-to-cart]*. So how do we configure or how do we influence the output?" He flagged it as possibly early but "that is the level of detail we need to get into."

**`[ANNOTATION]`** This is per *content piece*, not per slot. Since a slot can hold many pieces, the two are materially different requirements with different reconciliation problems. Not in the current design — see gap G11.

**Access.** Token-based. Simone has credentials provisioned; Tapestry pastes a token to reach the UI, connected to Simone's demo engine (≈55:45).

### B12. Taxonomy ownership — **confirmed, Tapestry owns it**

**Nitin's ask (≈51:27):** "we should also start with the attributes which influence this. What are those attributes going to be? What do we mean by a behavior? It's behavioral targeting, but what behaviors are going to influence it? The list of those behaviors."

**Simone's position — the engine is agnostic (≈52:27).** It "doesn't care what the attribute is or what it represents. That's really up to you and those names get defined by you." Candidate attribute types offered as examples, not constraints: category, line, colour, product material. "We're not married or tied to anything that's written to the engine."

**Mark's restatement (≈53:33):** Optimizely cares only that Tapestry defines clear inputs and provides them to the affinity engine.

**Nitin's commitment (≈53:32):** *"We can, we can get you the starting list."* No date attached — see gap G12.

---

## C. Deferred and out of scope

### C1. Cross-device identity — priority 2, explicitly not v1

The white paper lists probabilistic cross-device identity via **device fingerprinting** as a foundation/feature-2 capability. It was Simone's first of five foundational questions (≈07:28) and was deferred on the call.

- **Nitin (≈07:28, ≈09:40):** in the roadmap and on the wish list, "but not where we start." Priority 1 is content and experience, "getting the basics working."
- Nitin acknowledged it likely needs a proprietary or external service; named Merkle and others who build and share identity maps.
- **Key instruction to engineering (Nitin, ≈08:54):** *"Don't go into the solution too much. It's the capability which matters."* Fingerprinting was Tapestry's guess at a mechanism, not a requirement. They are "very much open to discussing what are possible solutions."
- **Simone's compliance flag (≈08:18):** Tapestry's own document raises GDPR and CCPA. "The moment you start fingerprinting them, you need to take that into account."
- **Simone's practical flag (≈10:57):** multiple fingerprinting solutions exist, some open source and reasonably effective, but from personal experience "this is hit or miss." Mandeep agreed: "it is hit or miss and we are not looking at it."
- **Mandeep's preferred alternative if ever pursued (≈10:00):** the Quantum Metric pattern — Tapestry vendor, stated not to be an Optimizely competitor — captures a **hashed IP address**; compose hashed IP + device hash. "If you want to do it, do it with an IP hash. I think that works."
- **Logged-in is a non-problem.** With a login and an email, identity travels. The hard case is anonymous, and that is what is deferred.

**`[ANNOTATION]` Verdict for the build.** Do not implement. Do not let v1 architecture foreclose a later hashed-IP-plus-device-hash join. Anything identity-adjacent carries GDPR/CCPA obligations and needs privacy review regardless of the deferral.

---

## D. The sequencing reversal

**Tapestry has reversed the delivery order. Experience / module-sequencing personalization ships first. Content personalization second.**

Mandeep (≈58:02): *"We want to implement the experience personalization first, not content personalization — experience, like module sequencing personalization. That's what we have to implement first."*

The driver (≈1:15:12): *"first I was going for content, but then the Coach team said we want to… We wanted to do experience personalization first."* Simone confirmed this had been raised in a prior session.

**Timing.** Explicitly not before the holiday season — "it would not make sense to do it before holiday season because it would be too risky."

**Code freeze — asked and not answered.** Mark asked directly whether an explicit code-freeze date exists for the pilot site (≈57:10). Mandeep began to answer, audibly doubtful — "it's already September, and I… I just think that we're not, we're gonna… Unless Simone, I don't know how" — then pivoted to the sequencing discussion. **No date was given.** See gap G5.

**Mandeep's conviction on the biggest unlocks, stated twice (≈1:15:12):**

> "I think primarily the visit number, I'm even more convinced is the biggest unlock."

> "The visit number and the channel are the most biggest, the biggest unlocks. If we can personalize that experience for channel, visit, and then their affinity, that's the holy grail in my mind, but we'll see."

**Supporting experiment.** A grid-type layout of broader categories, shown below the fold to visitors arriving from **paid social**. "They converted at a much higher level, like much higher level." **`[ANNOTATION]`** Party withheld ("I will not say with who"), no magnitude, no baseline, no date. This is the sole evidence cited for the conviction that drives the entire sequencing reversal. Ask for the numbers.

**Scope of the first assignment.** A PDP with **six modules** and "four or five parameters" (≈1:15:12); two minutes later described as "five modules" (≈1:16:51). Collect all signals; serve those modules **in the right sequence**. Note also that in D1 Mandeep hypothesises "a test setup with 10 modules" — the module count is not settled, and it matters (see G2).

**Module ID convention Mandeep coined live, offered as illustrative (≈1:16:51):** `module.PDP.grid.1`, `module.PDP.reco.1` — "something like that."

### D1. The question Mandeep wants answered on 24 September

This gates the broader-audience meeting, and he said plainly that he does not understand it.

> "I will have to assume that can only happen if there are multiple versions from which it's learning. How else would it learn? I don't understand." (≈1:16:51)

> "How will it initially start? Would it start as a test setup with 10 modules? And how would you determine the sequencing? I think if you can come in the next call and say this is the mechanism behind it, then we can go and bring everyone together." (≈1:19:52)

The origin of his assumption: the January 2026 white paper specifies **reinforcement learning**, "and the fact that we wrote the reinforcement learning, it essentially starts with some kind of different variations, because how else you know what works" (≈1:19:48).

**Simone's answer on the call (≈1:20:55), which needs expanding and writing down:**

> "You don't necessarily need a test. We need an outcome that tells us… if that is the purchase or the conversion, we're going to be able to do it, but that reinforcement can come in multiple ways."

Simone has already written an outcome-learning document and committed to highlighting this question inside it. Mark asked that it be re-checked for consistency against the newer material Nitin shared, "to eliminate confusion."

**`[ANNOTATION]` Engineering task.** Produce a defensible mechanism for learning module *sequence* — an ordering over five or six modules conditioned on channel, visit number and affinity — without requiring pre-built variation sets. Explain how it bootstraps and how long it takes to converge. This is the single highest-value deliverable for 24 September.

---

## E. Hard dependencies on Tapestry

Mandeep raised this himself and framed it as the schedule risk (≈44:38):

> "Minimally, you will need each content piece to have an ID, a unique ID. Each experience module to have a unique ID…"

Simone replied "I have that already. I'll send it to you now" (≈44:57) — **`[ANNOTATION]`** referring to the dependency being documented on the Optimizely side, not to the IDs existing at Tapestry. Mandeep then made the risk explicit (≈45:06):

> "I want to make sure that even before you begin to implement, on our end we are starting to implement those things, because **if those things do not exist, then it's going to create a problem on our end. And hence it's going to delay everything.**"

**`[ANNOTATION]`** Note that Mandeep stated this conditionally. Nothing in the transcript establishes whether the IDs currently exist. The status column below reflects that: unconfirmed, not confirmed-absent.

| # | Dependency | Owner | Status |
|---|---|---|---|
| E1 | **Unique ID per content piece** | Tapestry | Critical path. Existence unconfirmed; implementation not started per Mandeep. No date. |
| E2 | **Unique ID per experience module**, with naming convention (`module.PDP.grid.1` pattern) | Tapestry | Critical path. Existence unconfirmed. Convention floated, not agreed. No date. |
| E3 | Starting list of attributes and behaviours that influence scoring | Nitin — committed (≈53:32) | No date |
| E4 | Per-action weight preferences, including per-product-type variation | Tapestry, on Optimizely defaults | Pending UI review |
| E5 | Per-**content-piece** optimisation objective (engagement/impressions vs. CTA clicks) | Requirement: Tapestry (Nitin). Design: Optimizely. | New ask; undesigned. See G11, H15. |
| E6 | Visitor identifier contract, plus the SDK-loaded hook for WebSocket push-back | Joint | Resolved in principle, unwritten. See G8. |
| E7 | Slot map for the pilot page — slot IDs, module IDs, off-limits regions, defaults | Tapestry | Implied, never explicitly committed. Blocked by the pilot-brand decision (H6). |
| E8 | Code-freeze date for the pilot site | Tapestry — Mandeep | **Asked and unanswered.** See G5, H4. |
| E9 | Shared repository for document exchange | Simone — committed same day | Teams blocks external documents; email is the stopgap. See G15. |

---

## F. Commitments, dates and process

**Simone — by EOD 18 September through Monday 21 September.** "Between today and Monday you're going to get multiple things from me."

- **Parity document:** where the current design stands against what was discussed, what will be tweaked and how — with the embeddings change called out so Tapestry can confirm direction before it is built.
- **Vector embeddings design** (weekend allocated).
- **UI components, attributes and windows**; token access to the configuration UI on the demo engine.
- **This document** — the transcript-derived record.
- **Outcome-learning document**, with D1 explicitly addressed and reconciled against Nitin's newer material.
- **Shared repository** with Tapestry access, replacing email exchange. Simone also intends to publish as a **live, tweakable document in a repo**.
- **The Affinity Engine PPTX**, which Mandeep asked for directly (≈48:42). Note: it is the generic London presentation and does not cover what was discussed here.

**Tapestry.** Nitin: "we will go through it line by line and let you know" (≈43:22). Mandeep will send questions in writing from his offsite.

**Next call: Thursday 24 September 2026, 2–3 PM.** Nitin to send the invite. Mandeep is at a three-day offsite in New York (his boss's) but will read material and respond in writing.

**Then, roughly a week later:** bring in "a couple of people" to see the UI and the broader UX, and what is required on Tapestry's side (≈55:29). **`[ANNOTATION]`** Note the transcript describes this next meeting three different ways — "a couple of people" (≈55:29), "the broader audience" (≈1:18:10), "bring everyone together" (≈1:19:52). Since G2 identifies this as the gating event, confirm its actual size and attendee list.

**Commercial track (Mark).** Tapestry legal red lines were due by 2 PM on 18 September. Abbie and Catherine connecting with Bill and Chris after they return (≈1:23:06). Mandeep: "hopefully contract will get close between today and the next few days."

**Process design (Mandeep, ≈41:25).** Keep it to Mandeep, Nitin and Simone until firm, then widen. "I don't want any secrets from anyone. It's a fully transparent process, but we want to form it up enough where… it doesn't get derailed."

**Version discipline (Simone, ≈45:29).** "The document is based on where we currently are now. Whatever you see there that might not make sense, we're going to change. I want to make sure that you don't say 'oh no, that's not what we talked about.' What is there is where I was at." **`[ANNOTATION]`** Worth keeping as a working norm for the shared repo.

**Comprehension risk, raised as a live problem.**

- Mandeep circulated the white paper widely inside Tapestry and received **no feedback at all** (≈41:25): "either you have a clear idea or you don't." Simone's reply: "did you send it to people that understood it?" — she noted she had to work through the flow herself to hold it.
- At Opticon New York a customer repeatedly collapsed the concept into "just a standard recommendations engine" (≈49:19). Simone's positioning: a recommendations engine and this are **complementary, not competing**.
- **Mandeep's guidance on explaining it (≈50:28):** examples only, no technology. "You can't go in and give them any tech. They get bored."
- Both liked Simone's interactive side-navigation HTML format for architecture documents. Mandeep: "I like it. This is really good" (≈51:21).

---

## G. Gap analysis

*Analysis, not extraction. Severity below is **impact on the build**; whether an item blocks progress is tracked in the H column, and the two do not always align.*

### G1. The sequencing reversal invalidates the current build order — **critical**

The Affinity Engine's staged plan runs: foundation (live) → content personalization (in build) → learning → **layout personalization at roughly six months**. Tapestry now wants layout/experience first. Stage four becomes stage one, and the stages were designed to depend on each other, each generating the data the next needs.

**To answer:** does module-sequencing personalization genuinely depend on the content-personalization stage, or was that ordering a convenience? If it genuinely depends, say so on 24 September — Mandeep has already decided the order and is preparing to socialise it.

### G2. The learning mechanism for module sequencing is unagreed, and the customer says so — **critical; gates the broader meeting**

Mandeep has stated he does not understand how sequencing can be learned without pre-built variations, and has made answering it the condition for widening the group. Simone's position — outcome-based learning without a test — is correct in principle but was asserted in one sentence. It needs a written mechanism: bootstrap behaviour, how order is derived, how exploration works, and how it converges at realistic PDP traffic.

**State the difficulty honestly.** Ranking items within a slot is well understood. Learning an *ordering of modules* is harder: the action space is permutations, not items, and the reward is page-level, not slot-level. The module count is also unsettled — five or six per Section D, but Mandeep floated ten in D1, and 5! = 120 versus 10! = 3,628,800 permutations is not a difference in degree. Do not present the two problems as equivalent.

### G3. The embeddings change collides with the explainability commitment — **high**

Simone described restructuring the model to use embeddings as "a simple change." The problem is not effort, it is consistency. The **BTI · Solution & Algorithm** document — prepared for Tapestry and emailed to them during this call — commits in writing to no black box anywhere in the serving path, no runtime model call, and a serving path recomputable by hand from the explain record. An embedding-based semantic match is not hand-recomputable in the same way.

**Resolve deliberately, two options:**

1. Embeddings computed at **design time**, entering serving as precomputed vectors and tags → explainability claim survives intact.
2. Semantic similarity evaluated at **request time** → the written claim must be revised, and revised with Tapestry rather than quietly.

Pick one and say which. This is the highest-consequence unforced error available.

### G4. The evidence-cost model must be recomputed at slot scope — **high**

The 180,000-asset analysis was emailed to Tapestry during the call, page-scoped, and is now the wrong unit per B2. But **do not simply substitute 18** — that figure is an approximation from one observed PDP, not a specification, and it conflicts with the 15 implied by the paper's own arithmetic. Derive real candidate-set cardinality per slot type from the pilot slot map, establish what evidence volume each slot type actually accumulates given the homepage/PDP asymmetry, and re-issue. The figure Tapestry currently holds overstates the problem, which undermines the credibility of the next set of numbers.

**Blocked by G7** — the recomputation is meaningless until "slot" means one thing.

### G5. No code-freeze date — **high; schedule risk**

Mark asked directly, Mandeep began to answer doubtfully and then pivoted. Holiday season is the stated constraint, it is mid-September, and the contract has not closed. Without a freeze date no delivery commitment for the pilot is meaningful. Get it in writing before 24 September.

### G6. Content and module IDs are unconfirmed on Tapestry's side — **high; critical path**

Mandeep identified this himself as the thing that would "delay everything," and it is owned entirely by Tapestry with no date. Everything the engine does is keyed on these IDs. Note the transcript does not establish that they are absent — only that Tapestry had not yet started implementing them and that their absence would be fatal. Establish current state, get a date, and get the naming convention signed off; `module.<page>.<type>.<n>` was floated but not agreed.

### G7. "Slot" is used in two incompatible senses, and the glossary is unlocked — **high** *(raised from medium: G4 and H12 both depend on it)*

Two distinct problems, one fix.

**The specific collision.** Mandeep uses *slot* to mean a position **inside** a module ("for the first two slots, show this strategy") and the module-level container **holding** that module (B2's "18 combinations for that particular slot"; Simone's "one that's just product catalog, or a carousel"). These differ by an order of magnitude in candidate-set size. Every cardinality and evidence-volume conclusion depends on which is meant.

**The general problem.** *attribute* vs. *dimension* were used interchangeably by Mark, who conceded the imprecision; Nitin asked for the distinction and for exact examples. Nitin's own 90/10 quote says "user attributes" where the dimension is named "user behavior." Also unlocked: *content*, *experience*, *module*, *functional unit*, *variant*, *variation*.

One page, agreed at the next call. With a broader audience coming, ambiguity here produces exactly the derailment Mandeep is trying to avoid.

### G8. First-paint behaviour before an identifier exists is undefined — **high** *(raised from medium: blocks the SDK contract)*

The WebSocket push-back closes the loop for subsequent requests but not the first one. What does the edge serve on the very first paint of a brand-new anonymous visitor — the default, or a decision informed by GeoIP and channel alone, both of which are available pre-click per B6? The latter is more valuable and consistent with the cold-start blending already in the design, but it must be specified, along with whether the first paint waits and what the timeout is.

### G9. Every threshold is unfixed — **medium**

Clicks to first personalization: three, four or five. Content impression floor: 300, 400, 500 or 1,000, varying by page type. Whether content performance is ignored or down-weighted below threshold. Nitin called the impression thresholds "subjected to discussion" and said of the click count "let's see what's technically possible."

**Propose defaults with reasoning rather than waiting.** Tapestry has offered no evidential basis for the numbers in their paper, so a reasoned proposal is likely to be accepted — but treat that as an expectation to test, not a certainty.

### G10. Two personalization layers are conflated in places — **medium**

Module-level (which module, what order) and within-module (which asset, what internal order) are different decisions with different candidate sets, different evidence volumes and — under Section D — different delivery phases. Mandeep noted a module "could have a video and a bunch of things." Make the boundary explicit, because the first deliverable is now the module layer while the existing document is written around the asset layer.

### G11. Per-content-piece objective selection is a new, undesigned requirement — **medium**

Nitin's ask (B11) is that the optimisation target be selectable **per content piece** — impressions/engagement for one, CTA clicks for another. The current design optimises toward a conversion-lift signal.

Two questions, and note they are different because a slot holds many pieces: (i) can pieces within one slot carry different objectives, and how are they compared during ranking? (ii) how are decisions across slots with different objectives reconciled into one page-level outcome? Neither is addressed anywhere.

### G12. Attribute and behaviour list has no date — **high** *(raised from medium: blocks the dimension registry)*

Nitin committed to a starting list. Without it the dimension registry cannot be locked and the taxonomy workshop cannot happen. Attach a date at the next call.

### G13. Pilot brand is now ambiguous — **high** *(raised from medium: determines slot map, catalog feed and freeze date)*

The current design document states: pilot on Kate Spade, carry the pattern to Coach. But the sequencing reversal came from **the Coach team** ("then the Coach team said we want to…"), and Mandeep demonstrated across both Kate Spade and Coach properties. Which brand is the pilot, and whose PDP is the first target? This determines E7, the catalog feed and the freeze date, and should not stay ambiguous.

### G14. The nine-delta review is against a superseded document — **low, but redo it**

Simone's nine deltas were closed against an earlier version of the Tapestry paper; the version Nitin shared is newer, and Simone read it for the first time during the call. Re-run the delta pass before 24 September.

Separately: Simone opened by asking five foundational questions (≈07:28). **Four are traceable in the transcript** — cross-device identity, dense embeddings, content variant volume, evidence floors. The fifth was never enumerated and should be recovered from her notes.

### G15. Document exchange is still broken — **low, but it blocks the promised review**

Teams blocks external documents; Simone could not post. Email is the stopgap. The shared repository was committed for the same day and is the dependency for the line-by-line review Nitin promised.

### G16. Comprehension risk is a delivery risk, not just a marketing one — **medium**

Mandeep circulated the white paper widely and got zero feedback. A customer at Opticon collapsed the concept into "a standard recommendations engine." Simone has had to work through the flow herself to hold it. The gating meeting is roughly two weeks out and will include people who have not been in these sessions — though its size is described three different ways in the transcript (see F). Mandeep's prescription — examples only, no technology — should shape that material, and engineering should expect to supply worked examples rather than architecture diagrams for that audience.

---

## H. Open decisions log

Every gap with a decision attached appears here. Gaps G4, G10, G14, G15 and G16 are work items rather than decisions and are tracked in G only.

| # | Decision | Gap | Owner | Blocking | Target |
|---|---|---|---|---|---|
| 1 | Mechanism for learning module sequence without pre-built variations | G2 | Optimizely — Simone | Yes — gates broader socialisation | 24 Sep call |
| 2 | Does module sequencing depend on the content-personalization stage? | G1 | Optimizely — engineering | Yes — determines whether the reversal is feasible | 24 Sep call |
| 3 | Embeddings: design-time precompute vs. request-time similarity | G3 | Optimizely — engineering | Yes — the explainability commitment turns on it | With embeddings design |
| 4 | Code-freeze date for the pilot site | G5 | Tapestry — Mandeep | Yes — no delivery commitment without it | 24 Sep call |
| 5 | Content ID and module ID current state, implementation date, naming convention | G6 | Tapestry | Yes — critical path for everything | 24 Sep call |
| 6 | Pilot brand and first target page — Kate Spade or Coach | G13 | Tapestry — Mandeep | Yes — determines E7 slot map and catalog feed | 24 Sep call |
| 7 | Attribute and behaviour starting list | G12 | Tapestry — Nitin | Yes — blocks dimension registry | Date needed at 24 Sep call |
| 8 | Locked glossary, and specifically the two senses of "slot" | G7 | Joint — both sides asked | Yes — blocks the G4 cardinality work | 24 Sep call |
| 9 | First-paint behaviour before an identifier exists | G8 | Optimizely | Yes — blocks the SDK contract | With SDK spec |
| 10 | Identifier contract and SDK-loaded hook specification | G8 | Joint | Yes | With SDK spec |
| 11 | Module count for the pilot PDP — five, six, or ten | G2 | Tapestry | Yes — sets the permutation space | 24 Sep call |
| 12 | Clicks to first personalization: 3, 4 or 5, and whether N is signal count or action index | G9 | Joint | No — propose a default | Propose 3 signals / fire on 4th |
| 13 | Content impression floor, per page type | G9 | Joint | No — propose a default | Propose with reasoning |
| 14 | Below threshold: ignore content performance or down-weight it | G9 | Joint | No | Propose down-weight |
| 15 | Behaviour-vs-content-performance default split | G9 | Joint | No | Propose, expose as a dial |
| 16 | Per-content-piece objective selection, and cross-slot reconciliation | G11 | Requirement Tapestry; design Optimizely | No — later phase | Design needed |
| 17 | Magnitude and baseline for the paid-social grid experiment | — | Tapestry — Mandeep | No, but it is the only evidence for the reversal | 24 Sep call |
| 18 | Cross-device identity approach, if ever pursued | C1 | Deferred — priority 2 | No | Post-v1 |
| 19 | GDPR/CCPA review for all identity-adjacent handling | C1 | Joint | Should gate any identity-adjacent work | Before identity work |

---

## I. Questions for the engineering team

These are the evaluation prompts this handoff exists to support.

1. **Can we learn an ordering over five or six modules, conditioned on channel and visit number, from outcome data alone — no pre-built variation sets?** If yes: what is the bootstrap, and how long until convergence at realistic PDP traffic? If no: what is the minimum variation scaffolding, and can it be framed so it does not read to Tapestry as the A/B testing they are trying to move past? Answer for ten modules as well as five — the count is unsettled.
2. **Does experience/module sequencing genuinely depend on the content-personalization stage?** If it does, we have to say so on 24 September. If it does not, what is the shortest path to a module-sequencing v1?
3. **Where do embeddings sit relative to the serving path?** Design-time precompute or request-time similarity — and what does the answer do to the no-runtime-model-call, recomputable-by-hand explainability commitment already made in writing in the BTI · Solution & Algorithm document?
4. **What is the real evidence-cost picture at slot scope?** Not at 18 — 18 is an approximation from one observed page. Derive cardinality per slot type from the pilot slot map, and test whether it holds for a PDP slot given the homepage/PDP impression asymmetry Nitin described.
5. **What does the edge serve on the first paint of a brand-new visitor,** using only GeoIP and channel? Does it wait for the WebSocket identifier, or resolve immediately with defaults, and what is the timeout?
6. **Can content pieces carrying different optimisation objectives be ranked against each other within one slot,** and can slots with different objectives coexist on one page? How is a page-level outcome computed when the objectives disagree?
7. **Is `module.<page>.<type>.<n>` sufficient as an ID convention** for both module-level sequencing and within-module asset personalization, across brands?
8. **What in the current build is genuinely blocked by Tapestry's content and module IDs,** and what can proceed against synthetic IDs meanwhile? Mandeep believes this dependency will delay everything — confirm or correct that.

---

## Appendix: quotations of record

Verbatim from the transcript, with approximate timestamps. Elisions are marked with "…"; nothing else is altered, including disfluencies. These are the statements the design will be measured against.

**On embeddings and semantics — Mandeep, ≈13:03**
> "Not just that, not just that. It's also when you create embeddings, you can also do semantic aspects of personalization, which you cannot do otherwise."

**On implementation freedom — Nitin, ≈19:15**
> "all zeros and one or like 0 and one combined. Like technical implementation, like doesn't matter, the functional is what we need to achieve here."

**On the acceptance criterion — Nitin, ≈19:41**
> "It should be able to understand the intent and semantic what Mandeep talked about exactly and it will and should give us right results, right? I think that is what matters."

**On embeddings sizing — Simone, ≈19:26**
> "The reality is that this is not going to be that big of an embeddings database that is going to be unmanageable, right?"

**On slot scoping — Mandeep, ≈20:13**
> "If you look at content, you're only dealing with the content modules within that slot, right? You're not dealing with infinite number of combinations. You're dealing with 18 combinations for that particular slot."

**On strategy scope as a constraint — Mandeep, ≈20:13**
> "But the product recommendations are only for that particular slot. We don't take that strategy and apply it to the whole site, because if we start applying it to the whole site, it'll create problems. So page is a dimension."

**On positional strategy within a module — Mandeep, ≈20:13**
> "For the first two slots, show this strategy. For second three slots, do this strategy."

**On module IDs — Mandeep, ≈24:03**
> "Because we will need the concept of a module ID for every single thing, for experience layout anyway."

**On the content problem — Mandeep, ≈24:06**
> "imagine that we were building a YouTube version of PDP. where the customer comes in, their main movie that they have watched is, what do you call, Brooklyn 26 movie. Now I want to show them 20 different shots and I need to figure out which shots work best for the person who just watched the Brooklyn 26, right? So that is the idea of content personalization. So I have to take recency into account. I have to take their affinity into account… I have to take probably some other things into account. I have to take their attributes and I have to map it."

**On ranking — Nitin, ≈25:10**
> "each content is scored and like in product recommendations, you know, we say, okay, this product is re-ranked, this list is re-ranked, and we only bring up the products which are on the top of the funnel. So we feel the same ranking approach will work for content as well, right? So each content piece is scored… Ranked, and you know only the one on the top are kind of returned."

**On factor priority — Nitin, ≈31:11**
> "Again, user behavior, I think, takes more priority over content impressions and content performance."

**On configurability — Nitin, ≈34:10**
> "And we should be able to say that, okay, 90% weightage to user attributes, 10% weightage to content performance, or like 60-40, right? So this goes into the configurability. which we should be able to tweak."

**On the cold-start window — Nitin, ≈29:36**
> "We felt that three, we can do it, but let's see what's technically possible. Is it four? Is it five? We definitely cannot be 15 or 20, right? It has to be early in the session because if we don't get their attention early on, they're gonna just… Bounce, right?"

**On per-content objectives — Nitin, ≈51:47**
> "on one piece of content, engagement is, as a metric, is the is the priority, right? And, like, I wanna say, okay, this give like, okay, impressions should have more weightage, but for other piece of content, I might say. because it has a add to click CTA, CTA clicks is my objective, right? So how do we configure or how do we influence the output?"

**On profile continuity — Nitin, ≈1:11:57**
> "We would want to keep it same, right? Because once they log in, yes, you do get other signals, but then you get to know their past purchases, you know, maybe their gender. But the real-time signals are more important, right? Like they supersede everything they have done in the past, right? So you want to keep whatever profile you have built in an anonymous session. Yeah. Maybe merge it at some point of time, but not override."

**On capability over solution — Nitin, ≈08:54**
> "We are not the experts, we are very much open to discussing what are possible solutions, opportunities… So don't go into the solution too much. It's the capability which matters."

**On the sequencing reversal — Mandeep, ≈58:02**
> "So that is something that we have to implement. first, not content personalization, experience like module sequencing personalization. That's what we have to implement first."

**On what drove the reversal — Mandeep, ≈1:15:12**
> "first I was going for content, but then the coach team said we want to, and I can understand that they were like. We wanted to do experience personalization first, even if it does not before holiday season. In fact, it would not make sense to do it before holiday season because it would be too risky"

**On the biggest unlocks — Mandeep, ≈1:15:12**
> "I think primarily the visit number, I'm even more convinced is the biggest unlock… and the channel are the most biggest, the biggest unlocks. If we can personalize that experience for channel. visit, and then their affinity, that's the holy grail in my mind, but we'll see."

**On the open learning question — Mandeep, ≈1:16:51**
> "I will have to assume that can only happen if there are multiple versions from which it's learning. How else would it learn? I don't understand. But once it learns enough, then it is serving those five modules which are there in the right sequence. That is what our first assignment is."

**On what he needs on 24 September — Mandeep, ≈1:19:52**
> "How will it initially start? Would it start as a test setup with 10 modules? And how would you determine the sequencing? I think if you can come in the next call and say this is the mechanism behind it, then we can go and bring everyone together and see how close it out."

**On the critical path — Mandeep, ≈45:06**
> "I want to make sure that even before you get, as you begin to implement, like on our end, we are starting to implement those things because if those things do not exist, then it's going to create a problem on our end. And hence it's going to delay everything."

**On outcome learning without a test — Simone, ≈1:20:55**
> "you don't necessarily need a test, we need an outcome that tells us, you know, like what is it, and if that is, you know, like the purchase, right, or the conversion, we're going to be able to do it, but that reinforcement can cope in multiple ways"

---

*Extracted from the 18 September 2026 session transcript. Sections A–F are extraction with attribution; passages tagged `[ANNOTATION]` are Optimizely-side interpretation. Sections G–I are analysis and contain no customer statements. Where the transcript is ambiguous, garbled, or a point was raised but never resolved, this document says so rather than filling the gap.*
