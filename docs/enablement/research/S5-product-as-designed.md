# The product as designed: one capability map

**Internal. Research lane S5, 2026-10-02. For the lead.** This sheet describes Behavioral Targeting and Intelligence
as designed: where the engine will be once the current remediation (W16 to W41, document 35 §5) and the design
completion (the parity build, tickets P01 to P27) land, because that is what will be sold. S2
(`docs/enablement/research/S2-engine-facts.md`) stays the engineering view, pinned to today's code; this sheet is the
product view. Every row is a product feature a marketer can name: what it does, what the brand gets, the design
document that defines it, and the rollout stage it lands in. The last column is today's state in one word from S2, for
the lead only; it never appears as a label in the material.

**Revised the same day, at the coordinator's request, on the owner's ruling.** Performance is a capability of the
product, and the material will claim it with a realistic measured range. Row A9 and §1.1 give the targets, the
measured basis with file, line and measurement date, and what makes the difference. §4 item 3 now reads "any latency
figure beyond the design target and the measured basis above". Two corrections to the request are recorded in §1.1 and
in §5, Q4.

## How to read this sheet

- **Capability text** (the first three columns) is the product as designed, in present tense, in the package's words
  (`docs/enablement/GLOSSARY.md`): interest, dimension value, piece, slot, receipt, regional prior, learning dial,
  audience, visitor. It names no customer and no competitor.
- **Design source** cites file and section, with the short names in the key below. Customer names appear only there,
  inside file names.
- **Stage** is the deck's slide 14: **1** Foundation, **2** Content launch, **3** Algorithmic lift, **4** Layout
  composition, or **every stage**. Where the deck and the design place a capability differently, the design decides the
  column and §5 names the disagreement.
- **Today** is one word from S2's labels: Built, Designed, Open, Withdrawn, Demo only (S2, "How to read this sheet").
  §1.2 lists the rows where the one word hides a condition.

**Source key.**

| Short name | File |
|---|---|
| Deck | The sales deck text, slides 1 to 15: `C:\Users\LAH\AppData\Local\Temp\claude\C--Users-LAH-Documents---Development-Optimizely---cloudflare-base\6d912628-2c4c-48d2-9676-33d6a79a76ce\scratchpad\deck\deck-text.txt` |
| S&A | `docs/content-personalization-design-tapestry.html`, the Solution and Algorithm document. § numbers are its own section numbers, 01 to 18 |
| Parity | `docs/BTI-Parity-and-Mechanism.md`, the build plan |
| Vectors | `docs/BTI-Vector-Embeddings-Design.md` |
| Phase 1 | `docs/BTI-Phase-1-Foundation.md`: asks T1 to T34, our work O1 to O9, the later phases in §5 |
| Tickets | `docs/BTI-Parity-Build-Tickets.md`: P01 to P27 (an untracked working file) |
| Guide | `docs/BTI-Implementation-Guide.md`. Its product-sort passage sits at lines 614 to 681, between §5.5 and §5.8, with no heading of its own |
| Doc 13, 15, 18, 22, 26, 28, 31, 32, 35 | `docs/architecture/13-geo-cohort-coldstart-prd-tdd.md`, `15-edge-composition-design.md`, `18-content-affinity-engine.md`, `22-outcome-learning-design.md`, `26-btie-requirements-gap-review.md`, `28-operator-surfaces-evaluation.md`, `31-load-test-2026-09-05.md`, `32-latency-numbers.md`, `35-audit-verification-and-source-of-truth.md` |
| Handoff | `docs/handover/HANDOFF-2026-09-18.md` |
| Reflex | `docs/Edge-Affinity-Reflex-Technical-Design.md` |
| RT arch | `docs/Coach-Realtime-Behavioral-Personalization-Architecture.md` |
| Roadmap, Gaps | `docs/Productization-Roadmap.md`, `docs/Product-Gaps-Assessment.md` |
| Opal guide | `docs/Opal-Credit-Boundary-Pricing-Guide.md` |
| GTM | `docs/GTM-Delivery-Playbook.md` (the four-rung ladder is its §2) |
| Grid answer | `docs/Tapestry-Product-Grid-Sorting-Answer.md` |
| Extraction | `docs/architecture/tapestry-requirements-extraction-2026-09-18.md` |
| Explained | `docs/Content-Personalization-Explained-Simply.md`. It predates the build and S2 rules it out as a source of claims, so it is cited only for the owner's framing |
| Vantage | `docs/verizon/Vantage-Demo-Design.md` |
| OH, LG | `docs/lg/OH-Demo-Design.md` (its decisions log), `docs/lg/LG-Understanding-and-Use-Cases.md` |
| S2 | `docs/enablement/research/S2-engine-facts.md` |

---

## 1. The capability map

Sixty-three rows in six groups, following the visitor's session: what the brand sets up before the visit, what happens
on arrival, as the visitor browses, when their attention moves, afterwards, and the controls the brand holds throughout.

### Before the visit

| # | Capability | What it does | What the brand gets | Design source | Stage | Today |
|---|---|---|---|---|---|---|
| B1 | The brand's own vocabulary of interest | The brand names the dimensions interest is measured on (such as brand, category, occasion and price band, up to 32), how much each action counts, with an action able to count differently by product type, and how long interest lasts on each dimension. | Relevance described in the brand's own words, versioned, so the vocabulary grows without a rebuild. | S&A §06; Phase 1 T6 to T10, App. B; Guide §4.4; Parity §5 B11, B12; Tickets P14 | 1 | Built |
| B2 | Content by the brand's own ids | The brand's images, text blocks, modules and layouts are registered from its own feed (an import, an export or a URL the engine pulls), each with its id, labels, the slots it may fill and its publish window, and the engine answers with those ids. | The content library the brand already has becomes the material every decision is made from; nothing is rebuilt, copied or hosted elsewhere. | S&A §03, §15 item 1; doc 18 §3; Guide §4.2, §7.1; Phase 1 T12, T14, T15 | 1 | Built |
| B3 | Tagging help, approved by a person | Where content is thinly labeled, AI proposes tags from the brand's own vocabulary while content is prepared, and a person approves, edits or rejects each one before it is used. | Thin metadata becomes usable without a tagging project, and nothing reaches the site unapproved. | S&A §04 step 1, §15 item 1; doc 18 §3; Guide §4.2 ("Sparse metadata and enrichment"), §9.7; Opal guide §2 (Before); Phase 1 T14 | 1 | Built |
| B4 | Matching on meaning | Every piece and module carries a meaning vector prepared in advance, so a module named for an intent, such as "work to weekend", rises for a visitor whose browsing sits near it, as one weighted, capped line on the receipt. | Relevance that reaches content tags alone miss, while every decision stays explainable and a weight of zero switches it off. | Vectors §2 to §6, §11; Parity §4.4 to §4.10; Tickets P17 to P25, P27; Phase 1 T11, T16, O6 | 3 | Designed |
| B5 | Self-building audiences | Audiences form from the brand's own catalog vocabulary (such as "tote interest") and fill and empty by behavior, and the brand's team renames, pins or prunes them, with its edits kept through every regeneration. | No hand-built audience list to maintain. | Reflex §5; S&A §14 (the foundation); doc 35 §4, clause §1.2 (line 317); RT arch §3, §6; Roadmap W1 | 2 | Demo only |
| B6 | Starting beliefs from the brand's own analyses | The brand's data science team imports what it already knows, a rate and how strongly to believe it, per piece and context, and live evidence then confirms or corrects it. | A slot starts warm on the brand's existing knowledge instead of relearning it. | doc 22 §8; S&A §12 ("Priors import"); Guide §4.10, §13.2 item 11 | 3 | Built |
| B7 | The regional prior from the warehouse | What the brand's own customers in each region have bought, read from its warehouse, sets each region's starting lean before the site has traffic of its own, labeled with its source and the grain used; public census figures can explain the lean on screen and never enter the score. | A local first page from the first day, built on the brand's own sales rather than rented data. | doc 13 §1 to §4, §7 (`WarehouseSource`), §10; S&A §12 ("regional seasonal priors"); Vantage §5 ("Census is shown, not scored"); Deck slide 7 | 3 | Designed |
| B8 | Known customers start warm | For customers the brand already knows, it imports past behavior or profile facts, applied as if the actions had arrived late, so their interests are warm when they are recognized. | Recognized customers are recognized, not relearned. | Guide §7.5, §4.1 item 16 | 3 | Built |
| B9 | One connection for the site | One script on the site opens the visitor's session, sends events (or reads the brand's existing data layer), receives every slot's decision by id in one call, and lets the site's own default stand whenever no answer arrives in time. | The front end is built once; each later capability is switched on in configuration, not integrated again. | Guide §5.1 to §5.4, §5.8; Phase 1 T17 to T21, App. A; doc 18 §7; doc 35 W15, W17, W40 | 1 | Built |
| B10 | Opal backstage | The brand's team asks Opal in plain words to draft audiences, tests, analyses, labels and imagery, or to explain a result, and Opal never takes part in a live decision. | Faster authoring and plain-language answers, with AI cost that follows the team's work, never the site's traffic. | Opal guide §1 to §4; S&A §10, §18 ("Is it AI?"); doc 18 D-1, D-6; Roadmap W9; Deck slide 11 | every stage | Open |

### On arrival

| # | Capability | What it does | What the brand gets | Design source | Stage | Today |
|---|---|---|---|---|---|---|
| A1 | Nothing until the visitor chooses | The engine personalizes and records nothing until the site passes the visitor's explicit choice, with two switches, tracking and personalization, each lasting 30 days, and a request can withdraw a choice but never grant one. | Consent built in: a visitor who declines sees the brand's own site, and nothing about them is written. | Guide §4.8, §9.5; Handoff §7 ("Consent"); doc 35 W05; doc 26 D10; Phase 1 T33 | 1 | Built |
| A2 | Curate, never price | Place and context decide which content leads, never a price, a discount, financing, credit or who may enter; no protected class or proxy for one is used, regional counts carry no visitor id, no third-party data enters the decision, and a known customer is stored under a salted one-way hash. | Personalization the brand's legal and privacy teams can approve. | doc 13 §10, §11; Vantage §6; Guide §9.3, §9.7; Reflex §9; doc 22 §15 | every stage | Built |
| A3 | The first page already feels local | A first-time visitor's first page leans on what visitors in their real region, read from the request, are interested in, and that lean steps back as the visitor's own interests grow. | A relevant first impression for a visitor with no history, with no regional rule list to maintain. | S&A §06 (Dimension 1), §16; Guide §3.1; doc 13 §3, §4; Parity §6; Deck slide 7 | 2 | Built |
| A4 | Every channel seeds the visit | How the visitor arrived (the channel, such as email, paid social or a partner's link; the campaign term on the link; the referring network; the phone's operating system family) lifts matching content on the first page, before any click. | Every channel the brand already runs shapes the on-site experience from the first page. | Handoff §5 C3; doc 35 W16; S&A §06 (Dimension 3); Parity §3.8; Vantage §5 ("Arrival, as built"); Deck slide 8 (see §5, Q6) | 2 | Built |
| A5 | What visitors who arrive the same way respond to | For a stranger, what visitors arriving through the same channel on the same visit number engage with shapes the first decision beside the regional lean, as its own line on the receipt. | A first visitor from paid social starts on what paid-social first visitors respond to. | Parity §3.4 (part 1), §4.6 (point 2), §6; Tickets P07 | 3 | Designed |
| A6 | Picks up where they left off | A returning visitor's interests carry over between visits, cooling on each dimension's own memory rather than resetting, and where the brand approves it a returning visitor is recognized without signing in. | Second and third visits, where many purchases happen, start from what the visitor already showed. | S&A §05 ("Session-over-session learning"), §06 (Dimension 2), §09 (L2); Handoff §5 C6, §7 ("W16 continuity"), §8; doc 35 W16 | 2 | Built |
| A7 | Starting orders for each arrival context | A merchandiser saves the order of a page's modules for an arrival context, such as paid social on a first visit, and it is in force the moment it is saved, with learning later reporting where the evidence disagrees. | What the brand already knows about each channel goes live on the first day, before anything is learned. | Parity §3.8; Tickets P01; Phase 1 T4, O4, App. B ("Example: starting orders") | 4 | Designed |
| A8 | Decided at the edge, nearest each visitor | Each decision is made in the data center nearest the visitor, as arithmetic over the visitor's state and the brand's published settings held there, with no AI model and no round trip to a central database. | Relevance on every page from the first request, with no model or central system for a decision to wait on. | Parity §8, §4.6 (point 3); Guide §2.1, §2.3; Reflex §1, §6; doc 22 §1 (principle 1), §14; Vectors §3, §8; doc 18 D-2 | every stage | Built |
| A9 | Decisions at the edge, fast | A visitor seen before gets a decision in about 35 ms end to end, 5 ms of it inside the platform, and a stranger's first request takes 285.3 ms end to end, 235 ms inside the worker, because their state is created and looked up for the first time (staging, measured 2026-09-05; §1.1 has the targets and the full basis). | Personalization that does not make the visitor wait, with a measured range the brand can retest on its own deployment. | Targets: doc 26 line 195 (D12, reviewed 2026-09-04: the customer paper's ask); doc 31 line 45 and Guide lines 1109 to 1117 (ours); Reflex line 29. Measured: doc 32 lines 16, 17, 59, 88, 89, 95 to 98; doc 31 lines 19 to 21, 80, 87. Qualified: doc 35 lines 483 to 494 | every stage | Open |
| A10 | The site's own page always wins the race | When a slot has no decision, the network is slow or the visitor has not consented, the site renders exactly what it would have rendered anyway, and the page never waits on the engine. | No empty boxes, and no risk to the brand's own site. | Guide §2.4, §3.5, §5.8; S&A §07 ("Page assembly"); Phase 1 App. A | every stage | Built |
| A11 | The first page decided before it is drawn | The brand's own server fetches the first page's decisions before the page is sent and hands them to the script, so the content above the fold arrives already chosen. | A personalized first view without a visible change after it loads. | Guide §5.2 (`listen.apply`), §5.8 (pattern A); Phase 1 T17; doc 35 W15; Reflex §6 (the snapshot for first paint) | 2 | Open |

### As the visitor browses

| # | Capability | What it does | What the brand gets | Design source | Stage | Today |
|---|---|---|---|---|---|---|
| V1 | First click, tailored page | With consent, the visitor's first action is scored as it arrives and the next page or slot they ask for reflects it, with no login and no history, and a brand may set a floor of a few signals before the first change. | Relevance for the anonymous majority from the first click, not the third visit. | S&A §01, §04; Guide §3.2; Reflex §1, §6; Parity §5 B6, §7; Tickets P10; Deck slide 6 | 2 | Built |
| V2 | Interest that builds and fades | Each action adds weight to the dimension values it touches (a purchase more than a view, a mere impression nothing), every interest fades on its dimension's own clock, and a visitor joins an audience at an entry line and leaves only below a lower exit line. | Relevance that follows what the visitor does now, with no audience to write, refresh or retire. | Reflex §2 to §4; S&A §05; Guide §3.2, §4.4; Phase 1 App. B ("Behaviours and starting weights"); Deck slide 9 | 2 | Built |
| V3 | Where the visitor is in the visit | Each visit is read as exploring, considering or deciding from the visitor's own actions, content made for that stage is favored, and a new visit starts the journey again while taste carries over. | Inspiration for browsers, and reassurance such as detail and reviews for visitors close to buying. | doc 22 §5.4; Handoff §5 C4; Parity §2 ("Journey stage"); Guide §4.2 (`journeyStageFit`), §4.5 ("Stage"); doc 26 D1 | 2 | Built |
| V4 | The cap | Interest saturates, so the tenth click counts for less than the first, and a slot's diversity cap keeps one value from filling it, such as at most two pieces from one line. | One obsession cannot take over the page. | Reflex §2 (stage 3, saturating normalization); S&A §05 ("Normalization"); Guide §4.4, §4.5 ("Diversity"); doc 22 §6.5; doc 26 D11; Deck slide 9 | 2 | Built |
| V5 | Fresh content, no repeats | A slot favors newer pieces with a boost that halves over a period the brand sets, and lowers a piece the visitor has already been served. | New campaigns get seen, and a returning visitor does not see the same piece again and again. | doc 22 §6.4; Guide §4.5; doc 26 D2 | 2 | Built |
| V6 | The right pieces in every slot | For each slot on the page, the engine ranks the brand's eligible pieces against the visitor's interests under that slot's own weights and returns them in order, by the brand's ids, in one answer for the whole page with no piece shown twice. | Different pages for different visitors, from the content the brand already has. | S&A §04, §07; Guide §2.1, §2.4, §5.2; doc 18 §5, §7; Deck slide 14 (stage 2) | 2 | Built |
| V7 | Modules and sections in the visitor's order | A page's modules, such as a recommendations carousel, a category grid, reviews and a styling story, are the pieces of one layout slot, so the engine returns their order for each visitor and context, with pinned and locked modules held where the brand put them. | The section each visitor needs comes first, without designing versions of the page. | Parity §2 ("Module", "Slot"), §3.2 to §3.6, §3.9; Tickets P02, P04; Phase 1 App. A; S2 §10.4 item 1; Deck slides 4, 5 | 4 | Built |
| V8 | Layout composition | The engine assembles the page for each visitor from approved modules and content under the brand's layout rules (which sections are fixed, movable or required), chooses the content inside each module in the same decision, and falls back to a declared layout when a rule cannot be met. | A page that builds itself, always on-brand, never in an arrangement the brand did not approve. | doc 15 §1, §6, §10; S&A §03 ("Layout"), §07, §08; GTM §2 (rung 4); Parity §3.9; Tickets P26; doc 18 §7; Deck slides 5, 14 | 4 | Designed |
| V9 | Pieces that complete what is on the page | On a product page, a slot can favor pieces that complete the product in view, such as its matching accessory or add-on, as its own line on the receipt. | Attach and bundle content that fits the product the visitor is looking at. | OH decisions log (2026-10-02, `complements`); LG ("What is new engine work"); Parity §3.3 ("Complete the look") | 2 | Built |
| V10 | Product lists in the visitor's order | The engine reorders a product list that the commerce platform or a recommendations system supplies, by the visitor's interests, removing nothing, and at a dial of zero the platform's own order comes back unchanged. | Personal grids and carousels, with the commerce platform still the authority on price, stock and entitlement. | Guide §4.3 and the sort passage (lines 614 to 681); Grid answer ("Pattern A"); doc 35 §4 clause §1.11 (line 326); Phase 1 §5 (phase 5) | 3 | Built |
| V11 | Search that knows the visitor | When a visitor types, the brand's own AI model reads the query, the brand's catalog search fetches results, and the engine ranks them for that visitor with the same receipt, falling back to structured search when the model is slow. | Results in the visitor's taste, with AI used only where the visitor asked and is waiting. | Parity §4.7; Vectors §4.3, §11 step 7; Tickets P23; doc 35 §4 clause §1.10 (line 325); Opal guide §2 (shopper-facing AI features) | 3 | Built |
| V12 | Hand-off at sign-in | When a visitor signs in, the brand's server signs a short proof, the anonymous and known profiles merge with nothing overridden, the brand's own hashed identifier travels with the engine's so its warehouse can join the records, and the session's signals can be handed to the brand's own systems as context. | Nothing the visitor did before signing in is lost, and the brand's own systems take over a warm visitor. | Parity §5 B8, B9, §6; Guide §4.7, §7.5; Phase 1 T25, T26, O7; Tickets P12, P13; Vantage §6 ("Complement, never critique") | 2 | Built |

### When attention moves

| # | Capability | What it does | What the brand gets | Design source | Stage | Today |
|---|---|---|---|---|---|---|
| M1 | Follows a shift of attention | When the visitor moves on, say from coats to shoes, the new interest rises while the old one fades, and the next decision follows. | Content shifts with the visitor, not with a nightly refresh. | Reflex §3 (the worked example); S&A §04; Deck slide 4 | 2 | Built |
| M2 | Context hands over to behavior | The regional lean and the arrival seeds give way as the visitor's own interests grow: the region's share shrinks with every interest the visitor shows, and a seed is dampened once the visitor's own audiences point elsewhere. | A smooth hand-off from first impression to what each visitor really does; a campaign never traps a visitor. | S&A §06 ("Cold-start blending"); Handoff §5 C3; Vantage §5 ("The hinge"); Deck slides 7, 8 | 2 | Built |
| M3 | Automatic release | When an interest fades below its exit line, the visitor leaves that audience by time alone, at a moment the engine computes exactly, the content it drove steps back, and the exit is recorded like the entry. | Relevance that expires on its own, with no hours spent cleaning up stale audiences. | Reflex §4, §7; S&A §05 ("Membership with hysteresis"); Deck slides 9, 12 | 2 | Built |

### Afterwards

| # | Capability | What it does | What the brand gets | Design source | Stage | Today |
|---|---|---|---|---|---|---|
| F1 | Why this piece: the reasons and the receipt | Every answer carries the reasons that placed each piece (the strongest interests and their weights, the regional lean, any rule), and every served decision has a receipt with the full arithmetic, the learned adjustment and the version of every setting in force. | "Why did this visitor see this?" is a lookup, not an investigation, with a full audit trail. | doc 22 §3.1, §12.1; Guide §6.2 to §6.4, App. A.4; S&A §12; Parity §2 ("Receipt"); Reflex §7; Deck slides 10, 11 | 2 | Built |
| F2 | Replay | Given a decision's id, the engine decides again from the recorded inputs and reports whether the answer matches. | Proof that the receipt is the truth, not a story told afterwards. | doc 22 §12.3; Guide §6.4, §7.3; S&A §12 | 2 | Built |
| F3 | Outcomes credited to decisions | A click, an add to cart or a purchase is credited to the decision that earned it, within windows the brand sets, including a purchase of a product the piece featured. | Content gets credit for the sales it helps make. | doc 22 §4; Guide §4.6 ("The field that couples decisions to outcomes"), App. E | 2 | Built |
| F4 | Partner outcomes, counted as themselves | A pickup at a partner store or a referral to a partner retailer counts as its own named outcome, credited like a click and never reported as a sale. | A brand that sells through partners learns from the outcomes it can actually see. | OH decisions log (2026-10-02, E1); LG ("What is new engine work") | 3 | Built |
| F5 | The daily report | Each day, per brand, a report lists what was served and what was credited, by slot and by group, and labels itself an attribution diagnostic. | A daily readout that says plainly what it is and what it is not. | doc 22 §12.2; Guide §7.3, §10.1 | 2 | Built |
| F6 | Decisions in the brand's own warehouse | Every decision and outcome record lands in the brand's warehouse on a cadence it sets, from a minute to a day, with visitor ids replaced by a pseudonymous subject and erasures carried with the data. | The brand's analysts read results on their own numbers and models. | Guide §7.4, §10.4; doc 22 §3, §12.4; S&A §12 ("Full data egress"); Handoff §7 ("Snowflake engineering"); doc 35 §4 clause §1.12 (line 327); Deck slide 11 | 2 | Built |
| F7 | Learning behind a dial | The engine counts which pieces earn outcomes in which contexts, pooling similar contexts when one is thin, and changes nothing until a person raises each slot's learning dial (shown as a share of behavior against performance), while at zero every receipt shows what learning would have changed. | Relevance that tunes itself from results, at the pace the brand chooses, with the brand's own page as the baseline. | doc 22 §0 to §6, §16; S&A §09 (L3); Parity §3.4 to §3.6, §5 B5, §7; Tickets P06, P09; Phase 1 T3, T9 | 3 | Built |
| F8 | Each slot learns toward its goal | Each slot learns toward the outcome the brand names (clicks, adds to cart, purchases, revenue or margin), and a piece can declare its own success event. | An awareness slot and a late-journey slot each optimize for what they are for. | doc 22 §13, §17 item 1; Parity §7 ("Per-piece objective"); Tickets P16; doc 26 D3 | 3 | Built |
| F9 | A fair start for new content | A new piece starts from its slot's usual rate, or from the pieces most like it, and its own results count for more as evidence grows past floors the brand sets per page type. | New content is neither trusted blindly nor silenced. | doc 22 §5.2, §8, §15; Parity §5 B7, §7; Tickets P11, P21 | 3 | Built |
| F10 | A fair trial for untried pieces | On a share of decisions the brand sets, a slot deliberately shows a less-tried piece so learning finds out how it does, and it stays off unless the brand turns it on. | Learning that does not just entrench today's favorites. | doc 22 §7; S&A §09 (L3) | 3 | Built |
| F11 | Correcting for position | On a small share of page views two neighboring modules or items swap places, so the engine can tell how much engagement came from where a piece sat rather than from what it was. | Learning that rewards what works, not what happened to be first. | Parity §3.7, §7; doc 22 §5.5; Tickets P05 | 3 | Designed |
| F12 | Holdout groups | A stable share of visitors, assigned before the first decision is recorded, sees the brand's own defaults, or personalization without learning, so there is always something to compare against. | The value of personalization can be shown later, because the comparison ran from the start. | doc 22 §10; Guide §4.10, §10.2; Phase 1 T22, §5 (phase 3) | 2 | Built |
| F13 | Lift measured on the brand's own numbers | The brand's analysts compare the holdout and the personalized groups on their own metric and definitions, from the records the engine hands over, under an experiment design agreed before launch. | Lift the brand trusts, because the brand measured it. | Guide §4.10, §10.1 to §10.3; doc 22 §10; doc 35 W21, W31; Handoff §8 D04; Deck slide 13 | 3 | Open |
| F14 | The engine proposes what matters | Offline analysis of the brand's decisions and outcomes surfaces patterns, such as a behavior that predicts conversion for paid-social visitors, as proposals with their evidence through Opal, and a person approves each one. | The vocabulary and the weights grow from evidence, never on their own. | S&A §09 (L4); doc 22 §0 (level 3), §16 (phase 3); doc 18 D-3 (S3), §6; Opal guide §2 (After); GTM §8 item 4 | 3 | Designed |
| F15 | Suggested weight changes | A scheduled job proposes small, bounded changes to a slot's weights with the evidence attached, and a person approves or rejects each one. | Tuning informed by results, with a person deciding every change. | doc 22 §11, §13 ("Autonomy"); S&A §07 (the two modes); doc 35 W29; Handoff §8 D05 | 3 | Withdrawn |
| F16 | Long-term memory in the brand's data platform | Events, the audiences the engine forms and the visitor's journey stage land as durable facts in the brand's customer data platform, a returning recognized visitor's interests can be restored from it, and decisions never wait on it. | The brand's other teams see the same interests where they already work. | Phase 1 T27 to T29, O5, App. A; Reflex §8; Guide §2.2 (channel 5), §13.3 item 16; doc 35 W41; S&A §05 | 3 | Demo only |
| F17 | Forgetting on request, keeping only what is agreed | A visitor who asks to be forgotten is hidden from every report at once and removed from stored records by a scheduled rewrite, with a receipt naming anything outside the engine's reach, and each category of data is kept only for the period the brand agreed. | Subject requests and retention handled inside the product. | Guide §9.4, §9.6; doc 22 §15; Handoff §7 ("Retention"); doc 35 W06; Phase 1 T33, App. B | every stage | Built |

### The brand's controls

| # | Capability | What it does | What the brand gets | Design source | Stage | Today |
|---|---|---|---|---|---|---|
| C1 | Gates, then pins, then ranking, with every override on the record | In a fixed order, gates remove what may not show (out of stock, outside its window, outside its region), pins place funded campaigns first, and the engine ranks only what is left, with every receipt naming which tier decided and the pieces ranking would have chosen kept on the record with their scores. | The brand's rules always win, and every override is auditable. | Guide §2.4, §4.5; S&A §07; doc 22 §3.1 (`candidates`, `authority`), §5.5; doc 15 §10; doc 35 W20; Parity §3.8; Deck slide 10 (see §5, Q7) | 2 | Built |
| C2 | Exclusions and off-limits slots | The brand lists pieces, tags or kinds of content a slot never shows, and marks whole slots, such as a buy box or the legal footer, that the engine never touches. | Brand safety is a setting, not a hope. | Guide §4.5, App. A.2, App. C; S&A §18; Parity §3.3 | 2 | Built |
| C3 | A strategy for each slot | Each slot has its own weight for each dimension, so the homepage hero can lean on location and channel while a product gallery leans on visit number and content type. | Each place on the page cares about what matters there. | S&A §07; Guide §4.5; Parity §2 ("Slot"), §5 B3 | 2 | Built |
| C4 | Different rules for different positions | The first positions of a slot follow one strategy and the next positions another, with one result and no repeats. | Patterns such as "lead with the campaign, then personalize" inside one slot. | Parity §2 ("Position"), §5 B3; Tickets P15 | 3 | Designed |
| C5 | Merchandising weights | The brand dials season, promotion and margin for each slot, as a bounded multiplier on the pieces that carry those values. | Business priorities shape the order without overriding the visitor's relevance or the brand's rules. | Guide §4.2 (`merchandising`), App. A.2; doc 22 §3.1 (`explain`) | 2 | Built |
| C6 | Keep a piece under manual control | The brand freezes a piece's learned adjustment, has learning ignore it, or resets its evidence. | A hero campaign or a sensitive piece stays under manual control while the rest learns. | doc 22 §12.2 ("Item controls"), §7; Guide §7.3 | 3 | Built |
| C7 | The console and the published documents | Every weight, memory, threshold, slot rule, pin, seed and learning dial lives in versioned documents the brand's team reads and changes in the console or through the API, in force without a release, with who changed what and a one-step rollback. | Full control and full visibility: the brand's team tunes the engine without engineers or releases. | S&A §12; doc 28 §3, §6; doc 22 §13; Guide §7.2, §11.2 (phase 7), §12.2; Parity §5 B11; Deck slide 11 | every stage | Built |
| C8 | Experiments on any slot, with Opal drafting them | Where the brand wants a test, an experiment or a contextual bandit can be pointed at any slot as an optional instrument, and Opal drafts the test from a plain-language request; neither is how the engine decides. | Testing stays available for the questions it answers best, without pre-built variations being the only way to personalize. | S&A §01 (commitment 1), §10, §11; doc 18 D-3, §6; doc 15 §6.1; Opal guide §2 (Before); GTM §2 (rung 3); Gaps #9 | 3 | Demo only |
| C9 | Each brand its own space | One deployment serves several brands, each with its own catalog, settings, audiences, learning and credentials, nothing pools across brands, and what carries from one brand to the next is configuration, never visitor data. | A portfolio rolls out brand by brand as setup, not re-engineering. | S&A §17; Guide §8.1, §12.4; doc 22 §15; doc 35 W37; Phase 1 §5 (phase 5) | every stage | Built |
| C10 | The brand's own model, as one term | The brand's data science team plugs its own model in as one named, weighted term on the receipt, under a hard time budget after which the term is left out and the decision says so. | The brand's own science shapes the ranking without making the decision a black box. | S&A §12 ("Your own model, as one term"); doc 22 §9; Parity §4.6 (point 1); Vectors §6.3, §12 item 1; doc 35 W34; Handoff §8 D05 | 3 | Withdrawn |

**Counts.** 63 rows. By stage: 1, five rows; 2, twenty-six; 3, twenty-one; 4, three; every stage, eight. By today's state:
Built 46, Designed 8, Open 4, Withdrawn 2, Demo only 3.

### 1.1 Row A9 in full: the targets, the measured basis, and what makes the difference

Every figure below is quoted from its file at the line given. Every measurement was taken on staging on 2026-09-05 and
has not been repeated since (S2 §9.1, line 1156). Doc 32 measured from one machine, forty calls per row after five
thrown away (doc 32 lines 3 to 4). Doc 31 ran three load tests the same afternoon from one machine in the eastern
United States against the Atlanta edge, each shopper a new visitor, forty a second (doc 31 lines 3 to 5, 13 to 15).

**The targets, and whose each one is.**

| Target | Quoted | Where | Whose |
|---|---|---|---|
| Signal and serving | "<10 ms signal, <100 ms P99 serving" | doc 26 line 195 (row D12; the document was reviewed 2026-09-04) | The customer paper's ask, in the row's column for what that paper asks. The same row records of us: "Design says milliseconds; nothing measured on real infrastructure", and recommends "Until then, quote no number". Doc 35 line 488: these "differ from the team's <200 ms server P95 decision / <300 ms event targets" |
| Decision and event | "a decision under 200 ms at the 95th percentile on the server, an event under 300 ms" | doc 31 line 45; also Guide line 1115: "The targets we design to are a decision under 200 milliseconds at the 95th percentile measured at the platform, and an event under 300 milliseconds" | Ours. The Guide calls its measurements "not a service level commitment" (line 1109) and says the joint test in the brand's environment "is what sets the numbers we both sign up to" (line 1117) |
| The event-to-decision path | "the target budget is sub-50 ms" | Reflex line 29 (§1, "Fast"); line 148 (§6) | The original technical design, for the path running "in one process at the edge with no external calls" |

**The measured basis.**

| Who and what | Quoted figures | Where |
|---|---|---|
| A visitor seen before, the snapshot (the page's decisions) | P50 35.2 ms, P95 44.6 ms, P99 365.1 ms at the caller; inside the worker P50 5 ms, P99 29 ms | doc 32 line 17 |
| The same, as the document says it | "A returning shopper gets a decision in about 35 ms end to end, 5 ms of it inside the platform." | doc 32 line 59 |
| A visitor never seen, the snapshot, before the same-evening change | P50 627.5 ms at the caller; inside the worker P50 591 ms, P99 708 ms | doc 32 line 16 |
| A visitor never seen, the snapshot, after the same-evening change (CW37) | P50 285.3 ms at the caller (from 627.5 ms); 235 ms inside the worker (from 591 ms) | doc 32 lines 88 to 89 |
| New visitors under sustained load, per decision | p50 632 ms (session host, run 1), 192 ms (object host, run 2), 630 ms (session host, run 3); p95 957, 665 and 750 ms; p99 1,348, 795 and 1,103 ms | doc 31 lines 19 to 21 |
| The same, as the document says it | "192 ms median decisions against 632" | doc 31 line 80 |
| The session host, a decision for a visitor KV has not cached | "580 to 720 ms per decision for a visitor KV has not cached" | doc 31 line 87 |
| The event that carries a click (`POST /realtime/action`) | A visitor seen before: P50 641.3 ms at the caller, 547 ms inside the worker. A visitor never seen: P50 1,896.1 ms, then 1,731 ms after the same-evening change | doc 32 lines 18, 19, 91 |

Doc 32 quotes each pair together: the caller's figure includes the network, the inside figure is the route's own
timing, and "the pair is quoted together or not at all" (doc 32 lines 23 to 25). Doc 31's latency is "the server's own
time from its `Server-Timing` header where it says so, else the round trip from the client" (doc 31 lines 6 to 7), and
doc 35 records run 2's figures as "caller wall" (line 486).

**What makes the difference.**

1. **Where the visitor's state lives.** On the session host it is a record in KV; on the object host it is the visitor's
   own Durable Object. Doc 32 line 76: "Doc 31 measured it at 192 ms P50 for a decision, three times faster." The object
   host was held back first because its ingest refused the content events (doc 31 lines 77 to 81) and is now held back by
   the ledger-stall finding, so every configuration runs the session host (S2 §2.5, §9.4 item 1).
2. **The KV reads that miss for a stranger.** "What is left in the 235 ms. Three KV reads that all miss for a shopper
   nobody has seen" (doc 32 line 95). They run "one after another because each only runs when the one before it missed"
   (doc 32 lines 96 to 97), the right shape for a returning visitor and the wrong one for a new visitor.
3. **The KV write that used to sit on the request path.** On the session host, "a KV write costs half a second or more
   from a Worker" (doc 32 line 44). The same evening's change took it off the decision path (doc 32 lines 82 to 84), which is the step
   from 591 ms to 235 ms.
4. **For the event:** the pipeline "resolves the surface's catalog, the reflex configuration and the audience seeding
   before it touches the event, on every event" (doc 31 lines 40 to 42): "seconds cold, above a second warm" (line 88).

**The decision step itself cannot be timed from inside a Worker.** The `decide` stage, which is "the affinity
arithmetic, the slot rules, the holdout and the learned lift together", reads 0 ms in both populations (doc 32 lines 41
to 43; doc 31 line 33). Doc 35 line 494: "A deployed Worker clock advances with I/O, not synchronous CPU work; a pure
scoring stage can report zero without being free." What may be said is doc 32's own line 57: "The engine's own decision
cost is not measurable at this resolution."

**Limits the material keeps.** Forty samples per row is "weak tail evidence, not stable production assurance" (doc 35
line 492). New, returning, cold-isolate and cold-cache visitors "are different populations" (doc 35 line 485). For a
stranger after the change, "The observed median already exceeds the team's 200 ms server P95 budget" (doc 35 line 483),
and doc 32 line 62 says "No pilot target is met yet on the first request", while the returning rows "clear it
comfortably" (line 64). The faster object-host figure comes from a run in which every click was refused (doc 31 line 14)
and from a host that serves no configuration today.

**Two corrections to the request.** First, the "under 10 ms ... under 100 ms at the 99th percentile" figures are not
the design's own target: doc 26 places them in the customer paper's column and doc 35 line 488 contrasts them with ours.
Second, 591 ms and 235 ms are not two populations ("cold" and "a stranger"): both are a visitor never seen, inside the
worker, before and after the same evening's change (doc 32 lines 16, 89). The table above quotes them that way.

**A realistic range the material can state, for the owner to confirm (see §5, Q4).** "For a visitor the engine has
seen before, a decision arrives in about 35 ms end to end, 5 ms of it inside the platform. A stranger's first request
takes 285.3 ms end to end, 235 ms inside the worker. Measured on staging on 2026-09-05."

### 1.2 Where one word hides a condition (for the lead)

- **F1, F3, F5, F7 (the receipt, credit, the daily report, learning).** Recorded only with the visitor's tracking
  consent. With the SDK as shipped no decision is recorded yet: recording needs a slot set to count rendered pieces and
  durable recovery, which no configuration turns on. Pages that call the engine directly, as the demos do, are
  recorded (S2 §3.15, §5.1).
- **V1, V2 (first click, interest).** A customer tenant holds no product catalog, so product events build interest only
  when the registry reads attributes from the events and the events carry them (S2 §3.3 item 5).
- **M3 (automatic release).** The push at the exact moment runs on the object host, which serves no configuration; on
  the session host the exit is computed at the next read (S2 §10.1, §2.5).
- **C1 (gates, pins, ranking).** A prefix pin that cannot be served empties the whole slot, W20's territory (S2 §3.10,
  §9.4 item 8).
- **A6 (return memory).** Recognition without sign-in is off until a brand publishes its continuity block with a
  retention approval; the production window is open (S2 §3.1).
- **V7 (modules in order).** Module order inside a slot is built; where each slot sits on a page is the site's own
  template today (S2 §10.4).
- **V11, B3 (search, tagging).** Built locally, off by default, on the brand's own model key (S2 §6.1).
- **V12 (sign-in).** The merge is built; the brand's own hashed identifier as the account id and the script's loaded
  hook are designed (Tickets P12, P13).
- **F6 (warehouse).** The export listing is built; scheduled delivery to the warehouse is built locally, off by default
  and not verified live (S2 §7.5).
- **F2 (replay).** Exact for one slot, never claimed for a whole page (S2 §3.14).
- **F8, F9 (goals, new content).** Per-slot goals, shrinkage and imported priors are built; a goal per piece, floors per
  page type and the prior from a piece's nearest neighbors are designed (Tickets P16, P11, P21).
- **C7 (console).** The catalog, the seeds, the regional dimension list, the dimensions and the journey thresholds have
  no console screen and are changed through the API, still without a release; a few constants are fixed in code
  (S2 §4.5, §3.17).
- **B5, F16 (audiences, the data platform).** Run only for the default demo tenant on the demo profile (S2 §2.5, §7.3).
- **C8 (experiments).** Demo seams; Feature Experimentation cannot be configured on a customer deployment (S2 §7.4).
- **A9 (fast).** Measured once, on staging, on 2026-09-05; the team's target is met for a visitor seen before and not
  for a stranger's first request (doc 32 lines 62 to 64).

---

## 2. Inside a slot, and the page around it

The owner's distinction is also the design's: with one reading of the visitor's interests the engine makes two
different decisions, and a recommendations product the brand already runs sits inside both without being replaced.

**Deciding what goes inside a slot.** The site's template places the slot; the engine decides which of the brand's
eligible pieces fill it, in what order, for this visitor now. One answer covers every slot on the page, carries an order
for each slot, and never shows a piece twice. The Guide states it as the one question the platform answers for every
personalizable space: "of the candidates you have registered, which one belongs here, for this shopper, right now, and
why" (Guide §2.1). Design: S&A §07 ("A strategy is dimensions, weighted, applied to a slot"; "Page assembly"), doc 18
§5. Rows V6, V9, C1 to C5.

**Organizing the page and its sections by interest.** The engine also decides which section leads, which follows and,
under the brand's layout rules, which appears, for each visitor and context. It is the same mechanism one level up: the
page's layout is a slot whose items are its modules, and "An ordering is a ranking" (Parity §3.2). The engine scores each
module for this visitor in this context and sorts; it never builds versions of the page, so six modules in ten contexts
is sixty quantities to estimate, not 720 orderings to test (Parity §3.2). A merchandiser sets the starting order for
each arrival context on the first day (Parity §3.8), learning refines it per context (§3.6), and a correction for
position keeps the first module from winning for being first (§3.7). The content inside each module follows the same
way: "the module becomes the slot, and its pieces become the items" (Parity §3.9; Tickets P26), under layout rules
saying which sections are fixed, movable or required, with a declared fallback layout (doc 15 §6.2 step 4, §6.3). Rows
A7, V7, V8, F11.

**The three orderings** (S&A §08). The order inside a slot, such as a carousel's sequence; which content leads across
the slots the template fixes; and moving the slots themselves. All three travel in one answer that carries an order for
every slot from the first day, echoing the template, so that page-level ordering later is "a data change rather than a
re-integration" (S&A §07; doc 18 §7). Today's line, for the lead: the engine orders whatever sits in a slot, including a
stack of modules, and where each slot sits is the site's template (S2 §10.4).

**Living alongside a recommendations product.**

- **It does not replace one.** The scope reads the recommendations line as "not a mandate to replace the customer's
  product recommendation platform" (doc 35 line 324, clause §1.9). The design treats product recommendations as solved
  and makes content and experience the new work (S&A §01; Grid answer, "Scope warning"). The owner's positioning, from
  the session record: the two are "complementary, not competing" (Extraction, §F).
- **Inside a slot,** the recommendations module keeps choosing its products with its own machinery, and the engine
  chooses the content in the slots around it from the same live interests (Explained, "a wall of frames").
- **Organizing the page,** the recommendations carousel is one of the modules the engine orders for each visitor. In the
  parity's worked example, "We think you would like this" sits second for a first visitor from paid social and first for
  a returning visitor who has looked twice at one style (Parity §3.3, illustrative values). The engine organizes the page
  by interest around the recommendations module, within the session.
- **Product lists.** Where the recommendations or commerce system returns a list, the engine can reorder it for the
  visitor, removing nothing, with the platform still the authority on price, stock and entitlement (Guide §4.3 and the
  sort passage; Grid answer, "Pattern A": "We do not replace that. We reorder.").
- **How to say it.** Describe what the engine does instead, never another product's limits, per the lead's ruling on
  "What it is not" (`docs/enablement/LANE-BRIEF-COMMON.md`, rulings after review round one). The Grid answer's notes on
  the recommendations line date from June and carry its own instruction to confirm current capability with that product
  team before anything is written.

---

## 3. The four stages as the rollout story

The deck's slide 14 gives four stages and one list of what we need. The design has the same four in the Solution and
Algorithm document (S&A §14) and the go-to-market ladder (GTM §2), the work in finer steps in the Guide (§11), and the
learning's own rollout in doc 22 §16. The deck's list of needs is S&A §15 items 1 to 5, nearly word for word.

| Deck stage (slide 14) | S&A §14 | GTM §2 | Guide §11 | Learning rollout (doc 22 §16) | The lighthouse plan (Phase 1 §5) |
|---|---|---|---|---|---|
| 1 Foundation: "Map slots, connect feeds, add the SDK" | "The foundation" (see §5, Q3) | Rung 1, Foundation | Phases 0 Design to 5 Verification | none | Phase 1 Foundation; Phase 2 Integration |
| 2 Content launch: "Go live with content scoring" | "Content personalization" | Rung 2, Content personalization | Phases 6 Test window and 7 Launch readiness | 0 Record; 1 Shadow | Phase 4 Content and meaning, after layout |
| 3 Algorithmic lift: "Add decay and regional tuning" | "Learning" | Rung 3, Outcome learning | Phase 8, including "the activation of outcome learning once the data volume supports it" | 2 Apply; 3 Extend | Phase 4, the semantic term; raising the learning dial is a joint step (Tickets, "Not tickets") |
| 4 Layout composition: "Unlock full page assembly" | "Layout personalization" | Rung 4, Experience personalization | After launch: App. H.1 sequences experience after content | none | Phase 3 Live: module order first |

**Stage 1. Foundation.** The deck: "Map slots, connect feeds, add the SDK"; the brand gets "A connected sandbox".

- *What the brand gets.* Its own content, slot map and events flowing into its own space on a test deployment, the
  console open to its team, and a scripted run in its own lower environment showing that different visitors see
  different content, that a weight change takes effect with no deployment, that every decision on screen is explained,
  and that the defaults stand with the engine switched off (Guide §11.2, phases 1 and 5; Phase 1 §1, "Phase 1 is
  complete when").
- *What we need.* The deck's five, as the design specifies them: the content feed, the page slot map with a default for
  every slot, the behavior events with the conversion event, the product catalog or its attribute list, and sandbox
  access with the origins, the allow-listing and the connection check run from inside the brand's network (S&A §15 items
  1 to 5; Guide §4.1; Phase 1 T12 to T24, T30 to T32). Also: the registry signed off in one working session (S&A §15
  item 6; Phase 1 T6 to T10), a named owner per area (Phase 1 T1; Guide §4.11), the consent framework and a retention
  period per category (Guide §4.8, §9.4; Phase 1 T33), the code-freeze dates (Guide §4.1 item 5; Phase 1 T5), and the
  people who need the console (Phase 1 T34).
- *What lands.* B1, B2, B3, B9, A1; and from here on the every-stage rows A2, A8, A9, A10, B10, C7, C9, F17.

**Stage 2. Content launch.** The deck: "Go live with content scoring"; the brand gets "Different pages for different
visitors".

- *What the brand gets.* Live traffic personalized from the first click with the content it already has; the regional
  first page and the channel seeds on arrival; a receipt behind every decision; the holdout running from the first
  personalized page; decisions and outcomes in its warehouse; and learning recording from the first day while moving
  nothing, with every receipt showing what it would change (doc 22 §16, phases 0 and 1). The design's acceptance bar:
  on the launch page, with a candidate pool of 20 to 30 pieces, "different visitors verifiably see different content,
  chosen by the agreed dimension registry", with weights live in the tuning surface, the reasons behind every decision,
  and the defaults wherever no decision applies (S&A §16).
- *What we need.* The go-live gates (Guide §11.2, phase 7; App. F): privacy and security sign-off; the primary metric in
  writing and the holdout share approved before the first personalized page, because it "cannot be taken retroactively"
  (Guide §10.2); a named tuning owner; consent behavior per market; retention configured; production origins and a
  release slot; and the small sign-in endpoint on the brand's backend (Guide §4.7; Phase 1 T25).
- *What lands.* B5, A3, A4, A6, A11, V1 to V6, V9, V12, M1 to M3, F1 to F3, F5, F6, F12, C1 to C3, C5.

**Stage 3. Algorithmic lift.** The deck: "Add decay and regional tuning"; the brand gets "Relevance that tunes itself".

- *What the brand gets.* Learning raised slot by slot where the evidence supports it, toward each slot's own goal;
  memory and the regional lean calibrated to its own traffic and its warehouse's sales; exploration and the position
  correction where it turns them on; lift measured on its own numbers against the holdout; proposals from the engine for
  a person to approve; and the first expansions, which the design sequences after the content launch: product lists in
  the visitor's order (Guide §13.1 item 3), search that knows the visitor, and matching on meaning.
- *What we need.* Weeks of live traffic, because learning needs outcomes to learn from (GTM §6 calls it data physics,
  not build time); the outcome each slot learns toward (doc 22 §17 item 1; Phase 1 T3); the data science review (Guide
  §4.11); an experiment design agreed before any lift is claimed (Handoff §8 D04; doc 35 W21); a person's approval to
  raise each learning dial (doc 22 §1 item 4); optionally the brand's own priors, history and regional sales from its
  warehouse (Guide §4.1 item 16, §13.2 item 11; doc 13 §7); for matching on meaning, a content sample with concepts,
  labels and permission to encode imagery (Vectors §7.1; Phase 1 T16); for product lists, the commerce integration point
  and candidates that carry the registry's attributes (Guide §4.3, §13.2 item 9).
- *What lands.* B4, B6, B7, B8, A5, V10, V11, F4, F7 to F11, F13 to F16, C4, C6, C8, C10.

**Stage 4. Layout composition.** The deck: "Unlock full page assembly"; the brand gets "A page that builds itself".

- *What the brand gets.* Each page's modules in the visitor's order; starting orders for each arrival context, in force
  the moment they are saved; and the page assembled per visitor from approved modules and content under its layout
  rules, with the content inside each module chosen in the same decision.
- *What we need.* Each page's map, with an id for every module, today's order, and which modules are fixed, pinned or
  free (Phase 1 T12, T13; Parity §3.10 item 1); confirmation that each page can draw its modules in the order it receives
  (Phase 1 T18); module impression and engagement events (Parity §3.10 item 2; Phase 1 T21); the outcome the order
  optimizes (Parity §3.10 item 3; Phase 1 T3); the starting orders by channel and visit (Parity §3.10 item 4; Phase 1
  T4); and the layout rules and a fallback layout per template, with governance sign-off (doc 15 §6.3, §11 inputs II-2
  and II-6; GTM §2, rung 4).
- *What lands.* A7, V7, V8, with F11's position correction carried over from stage 3.
- *The order is the brand's choice.* The design says content or layout "can lead" (Guide §13.1 item 2), that ordering
  the modules does not depend on content coming first (Parity §3.9), and the lighthouse plan leads with module order
  (Phase 1 §5). See §5, Q1.

---

## 4. What the design does not promise

No design document commits to any of these. Writers do not promise them.

1. **Replacing a recommendations engine, the commerce platform's search and retrieval, or the brand's data platform,
   experimentation or next-best-action systems.** Doc 35 line 324 (clause §1.9); Grid answer ("We do not replace that. We
   reorder."); Guide §4.3 ("We do not hold a copy of your product catalog"); Reflex §8 and RT arch §6 (the data platform
   is fed, never replaced); S&A §01 (experimentation is optional); Vantage §6 ("the anonymous front door to their
   next-best-action, not its replacement").
2. **An AI model or an agent deciding in the flow.** Guide §2.4 ("No model runs on the decision path, at any stage of the
   learning ladder"), §9.7; Opal guide §1; doc 18 D-1; Parity §4.9; doc 22 §1 items 1 and 4; S&A §09, L4 (proposals are
   "never self-activating"). Even the designed autonomy is bounded weight changes, launched with a person approving
   (doc 22 §11), and it is withdrawn today (doc 35 W29). Say "calls no AI model to decide", never "we don't use a model" (S2 §1).
3. **Any latency figure beyond the design target and the measured basis above** (§1.1). The deck's "under 50 ms" and
   "Sub-50 millisecond reaction" for a new visitor, its "300–500 ms" for tools that wait on a database and its "up to 7%"
   per 100 ms are commitments no design document makes. The Guide says its measurements are "not a service level
   commitment" (line 1109), and latency acceptance is open (doc 35 line 343, D12; Handoff §8 D03).
4. **A guaranteed lift, revenue or conversion result.** Doc 35 line 346 ("Neither this audit nor the customer paper
   converts those targets into a contractual revenue/performance guarantee"); Guide §7.3 (the per-piece numbers are
   "attribution diagnostics, not a controlled experiment"), §10.1; the deck's own slide 13 models the lift together.
5. **A capacity figure: visitors, concurrency or catalog size.** Doc 35 line 348 (the "millions-concurrent ambition"
   needs "separately scoped qualification") and line 531 (no universal limit was established); doc 35 W38; Guide §4.2
   (the catalog as a whole is capped at 2 MiB, "a real planning constraint"); Vectors §8 (about 50,000 vectors in memory
   is a planning threshold).
6. **Recognizing an anonymous visitor across devices, or fingerprinting.** Parity §5 C1 ("Not built, deliberately");
   doc 26 D7; doc 35 §4 (D7); Handoff §7 ("W16 continuity": "not expired-session extension or fingerprinting"); S&A §06,
   Dimension 2. A known visitor follows across devices only through sign-in.
7. **Matching visitors to similar visitors, a trained visitor model, or a vector database in the decision.** Parity §4.6
   points 1 to 3; doc 35 §4 (D8); doc 26 D8.
8. **Changing price, discount, financing, credit or access by place or affluence; using a protected class or a proxy for
   one; any third-party data in the decision.** Doc 13 §10, §11; Vantage §6; Guide §9.7.
9. **Injecting markup into the brand's pages, hosting its assets, or a native app SDK.** Guide §2.1 ("We never inject
   markup into your pages and never host your assets"); doc 15 §1; S&A §01 (commitment 2); S2 §7.1 (no native SDK:
   "never sell it as available").
10. **A page that never flashes.** Guide §5.8 ("What the platform does not decide: whether the shopper sees a flash");
    doc 35 W15.
11. **An evaluated bandit, an exploration-quality guarantee, or a declared winner.** Doc 22 §7 ("nothing here is an
    evaluated exposure or exploration-quality guarantee"); S&A §09, L3 ("an evaluated contextual-bandit instrument
    remains separate work, not a delivered option"); doc 35 W28.
12. **A delivery date.** Handoff §8 D02 ("No defensible finish date is established"); Guide §1.2 (durations are "planning
    guidance"); GTM §6 (the external dates "came from the customer").

---

## 5. Open questions for the owner

Each is a place where the design documents disagree with each other or with the deck. Each carries a recommendation, so
the owner can rule in a line.

**Q1. Content first, or layout first?** The deck (slide 14), the S&A (§14: the stages "run in order rather than being
skipped"), the GTM ladder (§2: "rungs cannot be skipped"; layout at rung 4, about six months in §6), the Guide's default
(§13.1 item 2, "Content first"; App. H.1) and the contracted scope (doc 35 line 350: "January content selection and later
experience composition") put layout last. Since 18 September the lighthouse plan puts module order first: Parity §1 and
§3.9 (it does not depend on content coming first and is "the smaller problem of the two"), Phase 1 §5 (module order live
in phase 3, content in phase 4), Tickets P01, and Extraction G1 ("Stage four becomes stage one"). The Guide says either
"can lead". *Recommended:* keep the deck's four stages in order and add one line: "A brand may start with layout; the
same integration serves both."

**Q2. What stage 3 adds.** The deck says "Add decay and regional tuning". In the design, interest fades from the first
event, by construction (S&A §05; Reflex §2.1); location is "in from day one" and regional trending is in the
content launch's acceptance bar (S&A §06, §16); and the third stage is learning from outcomes behind the dial (S&A §14;
GTM §2, rung 3; doc 22 §16). *Recommended:* "Turn on learning, and tune memory and the regional lean to your own
results", which keeps "decay and regional tuning" as calibration (the production memory is an owner input, S2 §3.4; the
regional prior from the warehouse is doc 13 §7).

**Q3. What stage 1 is.** The deck's Foundation is setup that yields "a connected sandbox", matching the Guide's phases 0
to 5 and the lighthouse plan's phases 1 and 2. The S&A's foundation (§14) is "Live interest scoring, self-building
audiences, and instant response, wired into your ODP", and GTM rung 1 adds the data-platform loop and "platform
activation (campaigns + CMAB)". *Recommended:* the deck's definition; the data platform is optional and additive in the
Guide (§13.3 item 16).

**Q4. Performance: which target, and which figures.** (a) Doc 26 D12 (line 195) lists "<10 ms signal, <100 ms P99
serving" as the customer paper's ask and records of us "Design says milliseconds; nothing measured on real
infrastructure". Doc 35 line 488 says those figures differ from "the team's <200 ms server P95 decision / <300 ms event
targets" (doc 31 line 45; Guide line 1115), and the Reflex design states "the target budget is sub-50 ms" (line 29). The
material should name one target and say whose it is. (b) The deck's "under 50 ms" and "Sub-50 millisecond reaction"
(slides 6, 11, 13) describe a new visitor's first click. The measured basis gives tens of milliseconds at the median only
for a visitor seen before (doc 32 line 17); a stranger's first snapshot took 235 ms inside the worker after the
same-evening change (doc 32 line 89); and the event that carries a click took 641.3 ms at the median for a visitor seen
before (doc 32 line 19). None has been re-measured since 2026-09-05 (S2 §9.1). (c) The deck's "300–500 ms" and "up to 7%"
have no source in the corpus. (d) The common brief ("Never a latency or throughput figure, anywhere, for any reason") and
the glossary ("Edge": "never attach a speed to either"; "Real-time": "this package quotes no timing figure") contradict
the ruling. *Recommended:* state the range in §1.1 with its date and name the 200 ms target as ours; drop the deck's
sub-50 ms for new visitors and its two outside figures; re-measure on the target deployment before a customer document
quotes anything (doc 32 §6; S2 §9.1); and have the lead update the common brief and the glossary before any writer uses
row A9.

**Q5. First click, or a floor of signals?** The deck says the first click tailors the next page (slide 6). The parity
proposes "Three signals; the first personalized response on the fourth action" as the lighthouse default (Parity §7;
Phase 1 App. B). The ticket makes the floor a dial with existing tenants at 0 (Tickets P10). *Recommended:* "from the
first click", with the floor as a dial a brand can raise.

**Q6. Slide 8's channels and its profile.** No design document defines a partner site's quiz feeding the engine, and
SMS is not one of the six channel words: direct, paid social, paid search, email, organic and referral, with partner
traffic counted as referral (S&A §06, Dimension 3; doc 22 §5.4). As designed, a quiz or text-message link carries a
campaign term that seeds the first page (Handoff §5 C3), and a known customer's quiz answers can arrive through history
import as profile facts (Guide §7.5). A seed lifts matching content; it does not write interest, since seeds "are not
learned weighting" (Handoff §5 C3). So the slide's single profile card, filled by four channels (occasion, silhouette,
line, price band), goes beyond the design. *Recommended:* reword to "the link from an email, an ad, a text or a
partner's quiz shapes the first page", or commission a quiz intake as a design item.

**Q7. "Logged with the relevance it cost."** Slides 10 and 13 promise the cost of each override ("Cost of an overridden
campaign" is a KPI). The design records which tier decided and the top candidates with their scores (doc 22 §3.1; Guide
App. A.4), and learning "reports where the evidence disagrees with the rule" (Parity §3.8). No document defines a
computed cost per override, or a report of one. Whether a one-position slot taken by a single pin still records ranked
candidates is not established in S2 (§3.10). *Recommended:* say "the receipt shows the pin decided, and the scores of
what it set aside"; commission the cost figure if the owner wants the KPI.

**Q8. The data platform's role.** "ODP is the memory", with events, scores and audiences forwarded from the first phase
(Phase 1 T27 to T29, O5, App. A), and "ODP is the backbone" (S&A §10; RT arch, where Feature Experimentation is
"driving the decisions"), against "Optional and strictly additive" with a default to launch without it (Guide §13.3 item
16) and the glossary's "older material that calls it the backbone or the memory is out of date". *Recommended:* the
Guide's line, with Reflex §8 item 4: decisions never wait on it.

**Q9. Experiments and bandits.** "Required primitive" with a governed mode per slot (doc 15 §1 D-3, §4), against an
optional instrument per slot, "never the engine and never a prerequisite" (S&A §01; doc 18 D-3), and GTM's rung 1
"platform activation (campaigns + CMAB)" and rung 3 "aggregation + CMAB with content as the arms". *Recommended:*
S&A §01, which row C8 follows.

**Q10. Autonomy and the brand's own model.** Both are designed per slot (doc 22 §9, §11; S&A §07, §12; Parity §4.6 point
1), both are withdrawn today (doc 35 W29, W34), D05 is open (Handoff §8), and the glossary says autonomy is "never
offered". Rows F15 and C10 carry them as designed and withdrawn. The semantic term is designed not to reopen the model
path (Tickets P19). *Recommended:* the owner rules whether the material names either; until then writers leave both out.

**Q11. Pushed decisions.** Decisions pushed over the live socket (doc 18 D-4; Reflex §6), against the script's contract
of refreshing after interactions, with no production push promised (S2 §7.1); doc 35 W15 leaves "refresh or genuine
push" to be chosen. The deck needs only "the next page reflects" it. *Recommended:* say that the next page or slot
reflects it, and never promise a push.

**Q12. "Every constant" or "every weight and threshold".** S&A §12: "Every constant in this document is a visible,
editable parameter", including the region's memory and grain (§06, Dimension 1); some constants are fixed in code
(S2 §3.17). The deck says "Every weight and threshold is visible and adjustable" (slide 11). *Recommended:* the deck's
narrower words.

**Q13. The deck's statistics.** Slide 2's "up to 90%" anonymous, "80%+" first-time and "40%" of transactions on visit one
match one customer's own figures in the S&A (§01: 90 to 95 percent anonymous and roughly 80 percent never seen; §06: the
40/60 split of purchases by visit), while the deck calls them typical ranges. Slide 3's "more than half their hours" and
slide 11's "up to 7%" have no source in the corpus. *Recommended:* source them, or present them as the brand's own
numbers to fill in, as slide 2 already offers.

**Wording notes, not disagreements of substance.**

- Slide 5's four asset classes ("Image assets", "Text modules", "Styling modules", "Layout pantry") are the design's four
  content forms, image, text, module and layout (S&A §03; doc 18 §3); "pantry" echoes the S&A's chef analogy (§11). Use
  the design's names.
- Slide 9's "A passive view adds a little": the design weighs a mere impression at zero ("Seeing is not choosing",
  Phase 1 App. B; S&A §05), a dwell past a threshold at 0.5 and a product view at 1 by default. Name the action.
- "Stage": the glossary deprecates the word except for journey stage and uses "step" for the implementation path
  (GLOSSARY, "Stage" and "Phase"). The lead rules on what the material calls the four.

---

## 6. What this lane did and did not do

- **Read in full:** the deck text; S2; Parity; Vectors; Phase 1; Tickets; the Guide; doc 35 §1, §4 to §8; the Handoff
  §1, §5 to §8; doc 22 §0 to §17; doc 13; Reflex; RT arch; doc 28; Roadmap; Gaps; and, to source rows the brief named,
  the S&A, doc 15, doc 18, the Opal guide, GTM §2, §6 and §8, the Grid answer's comparison sections, Extraction §F and G1,
  Explained §"a wall of frames", Vantage §5 and §6, the OH and LG passages on `complements`, doc 26 D1 to D13, doc 31 and
  doc 32, `docs/enablement/LANE-BRIEF-COMMON.md` and the glossary.
- **Did not:** read or run code; run tests; re-measure anything; check whether a slot taken by a single pin still records
  ranked candidates (Q7); check the deck's market statistics against outside sources (Q13); examine the Opal product
  itself; read `docs/Tapestry-BTIE-Working-Notes.md` in full.
- **Wrote only this file.** No git command that changes anything; nothing installed, deleted or deployed.
