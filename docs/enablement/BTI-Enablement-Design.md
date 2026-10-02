# The enablement package: design and build brief

**Internal. Design and build brief.** Opened 2026-10-02 by lane E1 for the lead. This is the governing document for the enablement package: every lane reads it after `LANE-BRIEF-COMMON.md`, and every deviation is recorded in §12 before it ships. The three research lanes landed on 2026-10-02 and are folded in: S1 (`research/S1-inventory.md`, what exists), S2 (`research/S2-engine-facts.md`, the only source of engine facts, pinned to code commit `8b4f74c`) and S3 (`research/S3-naming-and-narrative.md`, the name and what has worked).

Companions: `LANE-BRIEF-COMMON.md` (the law), `GLOSSARY.md` (the package's one glossary, and the glossary page's source), `README.md` (the folder map).

Where this document and the common brief differ, the common brief governs and the difference is a defect in this document; §12 records every place this document settles something the brief left open.

---

## 1. Purpose and audiences

**What we are making.** An internal enablement package that explains the engine to three Optimizely audiences who are not engineers: marketing, account executives (AEs) and pre-sales solutions engineers (SEs). It is published on the internal site `https://edge-platform-bti.expedge.workers.dev`, behind a passphrase gate in the site's own worker (§7), and every piece except the landing page also exists as a Word document for sharing in Teams. We provide the content; the receiving teams decide how they present it. There are no slide decks.

**Why now** (S1 §6). Nothing in the repository is at once plain, current and customer-neutral. There is no single name, glossary or set of numbers. Several field statements no longer match the code. Almost nothing explanatory is hosted. The facts exist, scattered; S2 now holds them in one place. S1 §4 lists twelve gaps; the package closes each:

| S1 §4 gap | Closed by |
|---|---|
| 1. A plain, current "what is it" page | (b) What it is |
| 2. Where it runs, and the stack | (d) How it works and where it runs |
| 3. How it is configured, for a non-engineer | (c) "Who sets what"; (d) the documents section |
| 4. Built against designed, as a status ladder | (h) What is built, designed and open, with every row in §3.1; (b), (c) and (d) carry their own rows |
| 5. The pricing boundary, AE-safe | (e) the credits page, and its summary in (b), (c), (d) |
| 6. The privacy posture | (d) privacy section; (c) the stored-data answer |
| 7. The implementation path, told once | (c) short form; (d) full form |
| 8. A single glossary | (f) `GLOSSARY.md` |
| 9. Which demo for which audience | (g) the demo map |
| 10. Claims never to make, consolidated | §4.9, and each piece's own list |
| 11. Anything that is not markdown | Pages and Word copies (§6) |
| 12. From a demo to a customer's own version, in AE words | (g), last section |

**Posture.** Confident and plain. The engine is described as it is: what is built is said without hedging, what is designed is labeled once as designed, and what is open is labeled once as open and never promised. A gap is a labeled row, never a paragraph of caveats. No customer, prospect or competitor is named; we explain our own reasoning and never describe or judge another system.

**The three readers.**

| Reader | Who they are | Comes for | Leaves with | Never needs |
|---|---|---|---|---|
| Marketer | Writes about and positions the product; not technical | What the engine is and why it matters, in words to reuse | The rule, one visitor's story, the words to use and to avoid | Formulas, the stack, commands |
| Account executive | Sells and qualifies; promises only what is true | What is built, designed and open; the questions customers ask; which demo to show | Sentences to say and never to say, the customer's asks, when to bring an SE | The arithmetic, binding names |
| Solutions engineer | Semi-technical; explains concepts and brings an engineer when it gets deep | How a decision is made, where it runs, what a customer provides | The walk, the arithmetic at published constants, the stack, the honest open items | Deploy commands; code paths appear only in (d)'s column headed "Where in the code (for engineers)", for the engineer an SE brings (§3.5) |

**One reader per piece.**

| Piece | Reader | Source | Page | Word copy |
|---|---|---|---|---|
| (a) Landing page | An Optimizely colleague choosing what to read | §3.2 of this design | `/` | none (§12) |
| (b) What it is | A marketer | `content/what-it-is.md` | `/what-it-is` | `word/What-It-Is-v1.0.docx` |
| (c) Selling it | An account executive | `content/selling-it.md` | `/selling-it` | `word/Selling-It-v1.0.docx` |
| (d) How it works and where it runs | A pre-sales solutions engineer | `content/how-it-works-and-where-it-runs.md` | `/how-it-works` | `word/How-It-Works-v1.0.docx` |
| (e) Where Opal and AI credits fit | An account executive who quotes | `content/credits-source.html` for the page; `content/credits.md`, the same text, for Word | `/credits` | `word/Where-AI-Credits-Fit-v1.0.docx` |
| (f) The glossary | A marketer; every entry holds for the other two | `GLOSSARY.md` | `/glossary` | `word/Glossary-v1.0.docx` |
| (g) The demo map | An account executive | `content/demos.md` | `/demos` | `word/Demo-Map-v1.0.docx` |
| (h) What is built, designed and open | Anyone at Optimizely who must know what may be claimed today (§12) | `content/status.md` | `/status` | `word/Status-v1.0.docx` |

Paths in this table are relative to `docs/enablement/`; pages are addresses on the enablement site.

---

## 2. The name and its conditions

**The name: Behavioral Targeting and Intelligence.** It is the working name of the package and of the offering. A piece writes it in full on first use and says "the engine" afterwards. The spelling is American. "BTIE" is never used: it is the title of a customer's own paper. The abbreviation "BTI" appears in no piece's visible text and in no file name a reader sees. The site's own address, which the owner chose, carries it in its host name, so pieces link to the site by a page's title, with the address as the link's target and never as its visible text (§6). "Intelligence" means counted learning behind a dial, never AI.

**Why this name** (S3 §1.8, restated without customer names).

1. It is the only name with commercial standing: a contracted customer's documents carry it, and Optimizely's product and commercial lead took it under advisement as the product name, with the owner's endorsement.
2. Its reason is the thesis that sells: the engine serves visitors nobody has identified, which is why the initiative was named this and not "site personalization".
3. Its two halves describe the mechanism: behavioral targeting is the rules and weights a brand's team writes; intelligence is counted learning that refines them behind a dial.
4. It names neither a channel nor an infrastructure.

**Conditions.**

1. **Marketing owns the final choice.** The package presents the name as the working name (§11). It is written once per page and once per source (below), so a rename is one edit per file.
2. **Keep it apart from the behavioral targeting Optimizely already sells.** Always the four words and the anonymous-first reason, so nobody hears "we already sell behavioral targeting". The glossary's entry for behavioral targeting says so.
3. **Never present the name as a customer's own**, never cite the customer paper it came from or that paper's sources, and never write "BTIE".
4. **Define "Intelligence" as counted learning behind a dial**, as the glossary does, never as AI.
5. **Map no customer's order form.** The credits page describes the commercial lines generically and labels them (§3, piece e).

**Where it is written.** On each page, once, in an element with the id `package-name` inside the page's `h1`. In each markdown source, once, in its title line (`# Behavioral Targeting and Intelligence: <title>`). In each Word copy, through the converter's title argument, which lane W copies from the markdown title, so the name is typed nowhere else. The converter also prints its title in every page header of the Word copy; that is generated, not written, and a rename regenerates it. Everywhere else, "the engine".

**What the scaffold carries today.** Lane E0 built the landing page before this ruling, with a different working string in `#package-name`. Lane P1 replaces it with the name (§12).

**Retired names** (S3 §1.8, S1 §2.1).

| Name in older material | Becomes |
|---|---|
| BTIE | Never used. A citation of a customer's paper, in that customer's material only |
| Affinity engine, Edge Affinity Engine, Content Affinity Engine, Edge Affinity Reflex, the reflex | Retired; "the engine". "Interest" is the reader's word for affinity |
| Content decision service, Generation 2, publication set, the reflex document | Engineering vocabulary; the glossary maps each to the package's word |
| Edge personalization, Real-Time Personalization Platform, Optimizely Edge Platform, Cloudflare Edge Platform | Retired as product names; "at the edge" stays as a description |
| Signal system | One demo's name for the engine; "the engine" |
| Experience personalization, content personalization | Not used in this release: S2 does not define them (§4.8) |
| Outcome Learning | "Learning", as the glossary defines it |
| Vantage, Top Offers (Lantern & Lane), Meridian (Calder), The Bright Hour, First National Bank, OH | Demo names; never the engine |

---

## 3. The pieces

### 3.0 What every piece shares

Every piece except the glossary and the status page follows this shape; their exceptions are in §3.7 and §3.10. Pieces (b) and (d) as accepted depart in the ways §3.3 and §3.5 record, and the credits page keeps the shared page's own shape (§3.6).

1. **Title line:** `# Behavioral Targeting and Intelligence: <title>`, the only place the name is written.
2. **Reader line:** the first paragraph names the one reader, for example "For account executives."
3. **The rule:** the second paragraph, in bold, is the piece's one sentence. The same bold sentence is the piece's last paragraph.
4. **An example before any mechanism:** the visitor's session told as a short story, with no number in it, in gender-neutral words (§5, the voice).
5. **The session tables:** what happens before, during and after the visitor's session, one table per part, columns `What happens` and `Verdict`. Rows come from §3.1, worded as there. The verdict is exactly one of Built, Designed, Open. A condition sits in the row's text, once.
6. **The one exception, flagged once:** the row with a conditional verdict that the reader must keep straight is named once, under the tables, beginning "The one exception to keep straight:". It is not repeated elsewhere in the piece.
7. **Where AI and credits fit:** in (b), (c) and (d), a section of that name carries paragraph P2 verbatim and the credits page's full address.
8. **Sentences to say, and sentences never to say:** a list to say, and a two-column table, `Never say` and `Say instead`, drawn from §4.9 plus the piece's own lines.
9. **The rule again,** as the last paragraph.

**Verbatim paragraphs.** Pieces use these exactly as written; a change is made here first and recorded in §12.

| Id | Paragraph | Used in | Basis in S2 |
|---|---|---|---|
| C | A visitor's behavior sets their interests. The brand's team sets the rules. The engine ranks what is left, and gives its reasons. | (a), as the lede and the last line; (b) as accepted has its own rule (§3.3) | §3.3 to §3.4, §3.9 to §3.12, §3.14 |
| P1 | The engine decides which of the brand's own content each visitor sees, and in what order. For every visitor who has agreed to it, it keeps a graded, fading interest in each value of each dimension the brand chooses to score on, built from what they do on the site. When a page asks, it ranks the brand's own published content for each slot on the page against that interest, leaning, where the brand turns it on, on what their region is interested in until they have shown interests of their own. It answers with the brand's own content ids in order, each with the reasons that placed it there. It runs on Cloudflare's network, calls no AI model to decide, and every setting that can change an answer lives in published, versioned documents that the brand's team changes without a software release. | (c) | §1, edited as §4.7 item 1 records |
| P2 | The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open. | (b), (c), (d), (h); (e) as its summary | §6.1 to §6.3 |
| P3 | Nothing is personalized or recorded until the site passes the visitor's explicit consent choice. Without it, the visitor sees the site's own defaults. | (c); (b) and (d) in their own words | §3.2 |
| P4 | Learning is built, and it changes nothing until a person raises the learning dial. | (c); (b) and (d) in their own words | §5.2 |
| P5 | Receipts, outcomes and learning counts are recorded only with the visitor's consent. A page that asks the engine directly is recorded; with the SDK as shipped, a slot is recorded only when it is set to count rendered pieces and durable recovery is on, and no configuration has it on yet. | (c); (d) in its own words | §3.15, §5.1 |
| P6 | The site sends events and asks for decisions. The engine answers with the brand's own content ids in order, each with its reasons. The site renders them, and renders its own defaults whenever the engine is silent. | (c); (d) in its own words | §1, §7.1, §7.7 |
| P7 | It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons. | (c); (b) and (d) in their own words | §1, §6.1, §3.14 |
| P8 | Each customer gets its own deployment on Cloudflare's network, one per environment, with its own storage. The workflow that sets one up stops before the customer's first configuration; that step, the ODP and Feature Experimentation connectors, measurement on the SDK, retention periods and the billing meter are open. | (c); (d) in its own words | §0 Stamp, §10.2, §10.3 |
| P9 | ODP, Feature Experimentation and Opal are not in the decision path, and none is connected to it today. | (c); (b) and (d) in their own words | §6.2, §7.3, §7.4 |
| P10 | For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step. | (b), (c), (d), (g), (h) | §10.4 item 4 |

**Word budgets** (S1 §3: a read-alone piece stays under about 2,200 words). (a) about 290 as built, with the three card rules. (b) 1,200 to 1,800. (c) 1,800 to 2,400. (d), as accepted, a walk of about 1,250 words and a detail of about 2,200 words of prose, plus tables. (e) up to 1,600. (f) as needed. (g) up to 1,100. (h) as its tables need, with little prose around them.

### 3.1 The rows: before, during and after the session

One master list. A piece copies the rows it carries (the last columns), keeps the wording, and may shorten a row only by dropping a clause, never by changing a verdict. The S2 column is for the lane note and the review, never for the piece's prose. The status page, piece (h), carries every row, with a caveat column (§3.10); piece (d) carries its rows in its own prose and in B.8's ten-row summary. Rows B14 to B16 and D20 to D22, from lane C3, complete S2 §10.1 and are carried by (h) alone.

**Before: what the brand sets up before the visitor arrives**

| Id | What happens | Verdict | S2 | b | c | d |
|---|---|---|---|---|---|---|
| B1 | The brand chooses the dimensions it scores on, the attribute each reads, how much each action counts and how long interest lasts, in its registry. | Built | §4.2, §3.17 | ✓ | ✓ | ✓ |
| B2 | The brand's own content pieces arrive by import or pull, tagged in the registry's vocabulary; no console screen edits them. | Built | §4.2, §4.5, §7.7 | ✓ | ✓ | ✓ |
| B3 | The brand maps its pages and slots: how many pieces each slot shows, its weights, pins, rules, exclusions and off-limits places. | Built | §4.2, §3.10 | ✓ | ✓ | ✓ |
| B4 | The site keeps its own defaults, and they render whenever the engine is silent. | Built | §7.1, §7.7 | ✓ | ✓ | ✓ |
| B5 | The site's consent banner passes the visitor's explicit choice; nothing happens without it. | Built | §3.2, §7.7 | ✓ | ✓ | ✓ |
| B6 | Product events carry the attributes the registry reads, because the engine holds no product catalog for a customer. | Built | §3.3, §7.7 | | ✓ | ✓ |
| B7 | Every setting is a published, versioned document, in force without a software release, with its history and a rollback that is itself a new revision. | Built | §4.1, §4.6 | ✓ | ✓ | ✓ |
| B8 | The brand's team works in the operator console; engineers set the deployment's own settings, such as its tenants, keys, allowed origins and retention. | Built | §4.5, §4.6 | | ✓ | ✓ |
| B9 | A customer deployment is set up by a workflow that stops before the tenant has its first configuration. | Open | §4.7, §10.2 | | ✓ | ✓ |
| B10 | A customer deployment admits connectors for telemetry, design-time tagging, search, catalog search and the warehouse. | Built | §10.2 | | | ✓ |
| B11 | Connecting ODP or Feature Experimentation to a customer deployment. | Open | §7.3, §7.4 | | ✓ | ✓ |
| B12 | Retention periods for each category of data. | Open | §8.8 | | ✓ | ✓ |
| B13 | Imported priors from a warehouse's own history; built, and not yet used on a hosted demo. | Built | §5.6, §10.1 | | | ✓ |
| B14 | Each brand is a tenant: everything it owns sits under its own prefix, and nothing pools across brands; engineers declare a deployment's tenants. | Built | §8.1, §8.2, §10.1 | | | |
| B15 | Design-time tagging with the brand's own AI model, outside the decision; a person approves every tag before anything is published, and it is off by default. | Built | §6.1, §10.1 | | | |
| B16 | Opal authoring and explanation: not connected to the engine today, and the demos' assistant is a stand-in, demo only. | Open | §6.2, §10.1 | | | |

**During: what the engine does while the visitor is on the site**

| Id | What happens | Verdict | S2 | b | c | d |
|---|---|---|---|---|---|---|
| D1 | Nothing is personalized or recorded until the visitor's consent choice arrives; without it they see the site's defaults. | Built | §3.2 | ✓ | ✓ | ✓ |
| D2 | A stranger is served from their first event, on how they arrived: the campaign term, the channel, the referring network and the operating system family of their phone. | Built | §3.11, §10.1 | ✓ | ✓ | ✓ |
| D3 | Where the brand turns it on, a stranger leans on what their region is interested in, from the site's own events, until their own interests take over. | Built | §3.6, §10.1 | ✓ | ✓ | ✓ |
| D4 | Each action adds to a graded, fading interest per dimension value, and audiences form and dissolve on two lines. | Built | §3.4 | ✓ | ✓ | ✓ |
| D5 | The brand's rules come first: eligibility (windows, stock, regions and named conditions), pins, exclusions and off-limits slots, all before any ranking. A pinned piece that cannot be served empties its whole slot. | Built | §3.9, §3.10, §9.4 | ✓ (first sentence) | ✓ | ✓ |
| D6 | The score ranks what is left: the visitor's interests times the slot's weights, then arrival seeds, journey stage, freshness, fatigue and merchandising weights, in that order, and learning only once its dial is raised. | Built | §3.11 | | ✓ | ✓ |
| D7 | A diversity cap per slot, and no piece twice on a page. | Built | §3.12 | | | ✓ |
| D8 | The answer is the brand's own content ids in order, each with its reasons, and the site renders them. | Built | §1, §3.14 | ✓ | ✓ | ✓ |
| D9 | A product list from the commerce platform is re-ranked by the visitor's interests, with nothing removed. | Built | §7.2 | | ✓ | ✓ |
| D10 | At sign-in the visitor's anonymous and signed-in profiles merge, overriding nothing. | Built | §3.1 | | ✓ | ✓ |
| D11 | A returning visitor can be recognized without signing in, once the brand publishes the rules for it. | Built | §3.1 | | | ✓ |
| D12 | The production window and purpose for recognizing a returning visitor. | Open | §3.1, §10.3 | | | ✓ |
| D13 | Typed search with the brand's own AI model, outside the decision; off by default. | Built | §6.1, §10.1 | | ✓ | ✓ |
| D14 | No AI model in the decision. | Built | §6.1 | ✓ | ✓ | ✓ |
| D15 | A first paint decided on the site's own server: a source module exists, and acceptance on a real site is the open part. | Open | §7.1 | | | ✓ |
| D19 | The engine orders whatever sits in a slot for each visitor, a stack of page modules included, and shows why. | Built | §10.4 item 1, §3.12 | ✓ | ✓ | ✓ |
| D16 | Configuring a page's layout per context, such as by channel or visit; where each slot sits on the page stays the site's own template. | Designed | §10.4 item 3, §10.1 | | ✓ | ✓ |
| D17 | A semantic term from embeddings. | Designed | §10.1 | | | ✓ |
| D18 | An exit pushed at the exact moment an interest crosses its line runs on the object host, which no deployment uses today; on the session host the exit is computed at the next read. | Built | §10.1, §2.5 | | | ✓ |
| D20 | Census figures beside a stranger's regional lean, on one demo's screen: shown, never scored, and not an input to the engine (demo only). | Built | §10.1 | | | |
| D21 | Pieces that complete the product on the page, the anchor product, are preferred where a slot asks for it; not yet on a hosted demo. | Built | §3.11, §10.1 | | | |
| D22 | A paid-search arrival is classified from an auto-tagged click; the classification only, because the event contract still refuses the click id. | Built | §10.1 | | | |

**After: what is counted once the visitor has been answered**

| Id | What happens | Verdict | S2 | b | c | d |
|---|---|---|---|---|---|---|
| A1 | Receipts, outcomes and learning counts are recorded only with the visitor's consent. A page that asks the engine directly is recorded; with the SDK as shipped, a slot is recorded only when it is set to count rendered pieces and durable recovery is on, and no configuration has it on yet. | Built | §3.15, §5.1 | ✓ (first sentence, plus "once recording is switched on") | ✓ | ✓ |
| A2 | A receipt records what was served and why; the brand's operators read it in the console, and replay is exact for one slot. | Built | §3.14 | ✓ | ✓ | ✓ |
| A3 | Outcomes are credited to the decision that earned them, within windows the brand can set; a named partner outcome is never reported as a sale. | Built | §3.15 | | ✓ | ✓ |
| A4 | The day report is an attribution diagnostic, with no claim of lift. | Built | §3.16 | ✓ | ✓ | ✓ |
| A5 | Learning computes how much better each piece does in each context, and moves nothing until a person raises the learning dial. | Built | §5.2, §3.13 | ✓ | ✓ | ✓ |
| A6 | Holdout arms; the demos run none. | Built | §5.3 | | ✓ | ✓ |
| A7 | The design of a production experiment. | Open | §5.3, §10.3 | | ✓ | ✓ |
| A8 | Exploration, built and off by default. | Built | §5.4 | | ✓ | ✓ |
| A9 | Which form of exploration a customer is offered. | Open | §5.4, §10.3 | | ✓ | ✓ |
| A10 | Position-bias correction. | Designed | §5.5 | | | ✓ |
| A11 | Erasure: bounded and resumable, and not proof of physical erasure. | Built | §8.8 | | ✓ | ✓ |
| A12 | A daily listing of the ledger for a warehouse job; direct warehouse delivery is built, off by default, and not yet verified live. | Built | §7.5 | | | ✓ |
| A13 | A usage meter for billing, and its rates. | Open | §6.3 | | ✓ | |

**Never rows.** Things in the code but switched off by policy (autonomy, Thompson sampling, a customer's own model in the score) and things not built (a native app SDK) are not rows: they appear only in the never-say list, as "switched off by policy and not offered" or "not built; never sell it" (§4.2).

### 3.2 (a) The landing page

- **Reader:** an Optimizely colleague choosing what to read. **Owner:** P1. **Source:** the text below, which the page builder renders; no `content/landing.md` is written. **Address:** `/`. **Word copy:** none. **As built:** about 290 words, the three card rules included.
- **Rule:** paragraph C, as the lede and again as the last line above the footer.
- **Text, in order, verbatim:**
  1. `h1`: the name, in `#package-name`.
  2. The lede: paragraph C.
  3. The access note, replacing lane E0's: "This site is for Optimizely employees; it opens with the passphrase you were given."
  4. `## Each page is written for one reader`, then three cards:
     - "For marketing", linking to "What it is": "What the engine does before, during and after a visitor's session, and the words to use about it."
     - "For account executives", linking to "Selling it": "What is built, designed and open, the questions customers ask, and the sentences to say and never to say."
     - "For solutions engineers", linking to "How it works and where it runs": "How a decision is made, where it runs on Cloudflare's network, and what a customer provides."
     - Each card also carries its piece's rule, which the page builder reads from the piece's source and the render check compares with it.
  5. `## Four references serve every reader`, then four links:
     - "What is built, designed and open": "Every capability with its verdict, and every open decision with its owner."
     - "Where Opal and AI credits fit": "Where AI and its cost live, and the sentences that settle the question."
     - "Glossary": "One word for each meaning, defined once."
     - "Demo map": "Which demo to show, to whom, and what each one proves."
  6. Paragraph C again.
- **Figures:** none. **Rows:** none. The legend and the version stamp come with the chrome (§7).

### 3.3 (b) What it is, for marketing

This section describes the piece as lane C1 built it and the lead accepted it, with review R's round-one edits applied (`lanes/R.md` §4; the lead's ruling, option 1, §12). Where it departs from §3.0, the departure is recorded here.

- **Reader:** a marketer; the reader line is "For marketing, writing about the engine for customers and the market." **Owner:** C1. **Source:** `content/what-it-is.md`. **Address:** `/what-it-is`. **Word copy:** `word/What-It-Is-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: what it is`
- **Rule:** C1's, first and last, in bold: "With consent, the engine remembers what each visitor is interested in, not who they are, and ranks your content by the rules your team publishes." Paragraph C stays the landing page's.
- **Sections, in order, as built:**
  1. No heading: the reader line and the rule.
  2. `## What it is not`: three contrasts, each with a class of system, phrased as what the engine does instead, under the lead's allowance (§5) in place of R-b1's deletion. "Segments" appears once, as the other class's own word. The receipt clause in its third contrast follows R's receipt edits ("every answer carries its reasons"), and its link follows the renamed heading of item 4.
  3. `## How it works, in five steps`: one visitor's session as the example, five bold-led steps, then R-b7's four-column table (`Step`, `When`, `What happens`, `Verdict`, one word per verdict), then "The one exception to keep straight:", which is recording (R-b8).
  4. `## Where AI and credits fit` (R-b9): P2 verbatim, the two sentences R-b10 gives on visitor-facing AI and on tags proposed by the brand's own model, and a link to the credits page by its title.
  5. `## What is true today`: the hosted demos with their addresses, P10 verbatim, and a three-row table of Built, Designed and Open, with R-b12 to R-b14 applied, so module order sits under Built (row D19) and per-context layout under Designed (row D16).
  6. `## Sentences to say`, then `## Sentences never to say, and what to say instead`.
  7. `## Questions marketing will be asked`: eight answers, with R-b15 and R-b16 applied.
  8. `## See also`: real links to the other pieces (R-b17) and to the status page (R-b21).
  9. The rule again.
- **Figures:** the session figure, D1's `before-during-after`, added on the page as a Before / During / After switcher, marked as an addition; without JavaScript it is the plain figure (§3.9).
- **Accepted departures from §3.0:** C1's rule, not paragraph C; C1's sections and noun-phrase headings, not statements; the five-step table in place of the session tables, so the rows are carried in its own words; the one exception is recording (A1), not A5; P2 and P10 verbatim, and P3, P4, P7 and P9 in its own words; C1's own sentences to say and never to say.
- **Built, designed and open content:** as its table says, with D19 Built and D16 Designed; the exception is A1.

### 3.4 (c) Selling it, for account executives

Piece (c) is rebuilt to this section, with review R's round-one edits applied where they still apply after the rebuild (`lanes/R.md` §5; the lead's ruling, option 2, §12). Its demo table moves to the demo map, and (c) links to it.

- **Reader:** an account executive. **Owner:** C2. **Source:** `content/selling-it.md`. **Address:** `/selling-it`. **Word copy:** `word/Selling-It-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: selling it`
- **Rule:** "Sell what is built, label what is designed, and promise nothing that is open."
- **Sections, in order:**
  1. No heading: "For account executives." and the rule.
  2. `## One visitor, three moments`: the example in three to five sentences, before, during and after.
  3. `## What you are selling fits in one paragraph`: P1, then: "Write its name in full the first time, then say the engine. It is not the behavioral targeting in other Optimizely products."
  4. `## What is built, designed and open, in the visitor's order`: three tables. Before: B1 to B9, B11, B12. During: D1 to D6, D8 to D10, D13, D14, D19, D16. After: A1 to A9, A11, A13. Then: "The one exception to keep straight: everything after the answer depends on recording. With the SDK as shipped, recording is not switched on yet, because it needs each slot set to count rendered pieces and durable recovery, which no configuration has."
  5. `## The customer provides these, and here is what each is for`: S2 §7.7 with three columns, `What we need`, `What we use it for`, `Who provides it`, every row stating both the need and the purpose.
  6. `## Who sets what`: a table. The brand's team in the console: weights, pins, windows, rules, take, the learning dials, the holdout share. The brand's team through the API, without a release: the catalog, arrival seeds, dimensions and their sources, journey thresholds. An engineer: tenants, keys, allowed origins, retention, where visitor state lives (S2 §4.5, §4.6).
  7. `## The questions customers ask have true answers`: the answers below, each two or three sentences, verbatim unless the review finds a fault.
  8. `## Where AI and credits fit`: P2, and the credits page's address.
  9. `## Bring a solutions engineer when the question is how, not what`: architecture and the stack; the arithmetic; integration and the events; data, privacy and retention detail; any question this page answers with "open".
  10. `## Sentences to say, and sentences never to say`.
  11. The rule again.
- **Figures:** D1's `architecture`, where C2 placed it, captioned with its SVG title (§3.9).
- **The answers, verbatim:**
  - *Is it AI?* "No. It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons. AI belongs to authoring and analysis, in Opal, which is not connected to the engine today."
  - *Isn't this CMAB, or an A/B test?* "No. It ranks the brand's own content for each visitor and depends on no experiment. It measures itself with its own holdout; Optimizely's CMAB is a separate capability of Feature Experimentation."
  - *Isn't this a recommendations engine?* "It decides what each decided place on a page shows, and in what order, for a visitor nobody has identified, and it says why. It ranks the brand's own published content, and it can also re-rank a product list the commerce platform supplies."
  - *Does it need to know who the visitor is?* "No. It works from the visitor's first event, knowing them only by a random id. When they sign in, their anonymous and signed-in profiles merge, and nothing is overridden."
  - *Does every page view spend AI credits?* "No. Serving a page calls no AI model, so it spends no credit, however much traffic grows."
  - *How fast is it?* "We quote no timing figure. Timing is measured on the customer's own deployment, once it exists."
  - *Will it lift conversion?* "We make no lift claim. The day report credits outcomes to decisions as an attribution diagnostic. The design of a production experiment is open and belongs to the customer's data science and business owners."
  - *What does it store, and for how long?* "With consent: random visitor and session ids, interests per dimension value, visit counters, receipts and outcomes. Never: the account id itself, any device detail beyond the phone's operating system family, or conditions a page asserts. How long each category is kept is set per customer, and the periods are open."
  - *Can it use our ODP data?* "Not in the decision today. The decision reads no ODP data, and connecting ODP to a customer deployment is open."
  - *How long does implementation take?* "This material gives no date. The path is described, and the step that gives a customer deployment its first configuration is open."
  - *Does it work in our native apps?* "There is no native app SDK."
  - *Which demo should I show?* "The demo map answers that:" and the demo map's address.
- **Sentences to say:** the rule; P1's first sentence; P3; P4; P6; P7; P9; P10; "The brand's rules come first; the engine ranks what is left."
- **Never say, beyond §4.9:**

| Never say | Say instead |
|---|---|
| "We already sell this as behavioral targeting" | "It is the engine described here, not the behavioral targeting in other Optimizely products." |
| "It is live at a customer", any case study | "We name no customer and cite no case study." |
| "Implementation takes two weeks", any date | "This material gives no date; plans are agreed per customer." |
| "It runs in your native app" | "There is no native app SDK." |

- **Built, designed and open content:** as the rows say; the exception is A1.

### 3.5 (d) How it works and where it runs, for solutions engineers

This section describes the piece as lane C3 built it and the lead accepted it (§12). Where it departs from §3.0, the departure is recorded here and in the log.

- **Reader:** a pre-sales solutions engineer. **Owner:** C3. **Source:** `content/how-it-works-and-where-it-runs.md`. **Address:** `/how-it-works`. **Word copy:** `word/How-It-Works-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: how it works and where it runs`
- **Rule:** "Every setting that can change an answer lives in a published, versioned document; the engine does the arithmetic at the edge, calls no AI model to decide, and shows its work on a receipt." It stands as a bold quotation under the reader line and again as the piece's last paragraph. "The unit of state is the dimension value, not the click" is A.1's heading. "Shows its work on a receipt" holds together with the recording condition, which A.5 and A.8 state (P5).
- **Front matter, no heading:** the reader line ("For pre-sales solutions engineers."); the rule; the three labels in one sentence each; that no latency or throughput figure appears, with a link to B.7; a link to the glossary by its title.
- **Shape:** Part A, the walk, then "Where AI and credits fit", then Part B, the detail. Each walk section links to its detail, and each detail section links back, with in-document links (§6). The two part headings are labels, not statements, as accepted.
- **Headings, in order, verbatim:**
  1. `## Part A. The walk`
  2. `## A.1 The unit of state is the dimension value, not the click`, with figure `decision-path`
  3. `## A.2 Ten steps run from the visitor's first call to the learning dial`
  4. `## A.3 It runs on Cloudflare, in a separate deployment for each customer`, with figure `architecture`
  5. `## A.4 Four published documents configure it, and changing them needs no deploy`
  6. `## A.5 Learning counts outcomes and moves nothing until the dial moves`
  7. `## A.6 The site sends events and paints what the engine returns`
  8. `## A.7 Consent comes first, identities are pseudonymous, and tenants are kept apart`
  9. `## A.8 Every claim carries a label: built, designed or open`: the labels in one paragraph, the one exception (recording, with a link to A.5), and the piece's never-say table, which carries P10 verbatim
  10. `## Where AI and credits fit`: P2 verbatim, and a link to the credits page by its title
  11. `## Part B. The detail`
  12. `## B.1 The decision path runs in a fixed order`
  13. `## B.2 The published documents hold the settings an operator changes`, with `## B.2.1 The registry says what is scored and how fast it fades`, `## B.2.2 The catalog lists the pieces and their tags`, `## B.2.3 The slots document sets each slot's weights and rules` and `## B.2.4 The learn document holds the dials`
  14. `## B.3 The receipt shows the arithmetic, and the day report counts outcomes`
  15. `## B.4 A customer deployment has its own store of every kind`
  16. `## B.5 Integration is a session, a consent choice, events and snapshots`
  17. `## B.6 Privacy and security are enforced in the request path`
  18. `## B.7 Limits are budgets in the code, and no timing may be quoted`
  19. `## B.8 Ten statuses come up most, and the status page holds the rest`: a ten-row summary in the master list's wording (D2, D3, D9, D19, D16, D15, A2, A5, B9 and B11), then one sentence linking the status page, piece (h), for every other row, the path to a customer deployment and the open decisions
  20. `## B.9 A worked example and the engineering documents go deeper`
  21. The rule again.
- **Figures:** D1's `decision-path` and `architecture` (§3.9), each captioned with its SVG title: "From an event to a decision" and "Where the engine runs on Cloudflare".
- **Verbatim paragraphs:** P2 in its own section and P10 in A.8's table, verbatim. P5, P6, P7 and P8 are carried in the piece's own words, as accepted.
- **Length, as accepted:** a walk of about 1,250 words and a detail of about 2,200 words of prose, plus tables.
- **Numbers it may quote:** the published constants in S2 §3.17 and the worked arithmetic in S2 §3.4 (with the weight stated); the limits in S2 §9.3, labeled "budgets in the code, not measured capacity". Never a timing, and never a cache lifetime presented as how fast a change reaches visitors (§4.3).
- **Never say:** the piece's table in A.8, plus §4.9. These stay available to it:

| Never say | Say instead |
|---|---|
| "A stateful object per visitor" (as today's deployment) | "Visitor state lives in a KV record on the session host; the object host is built and held back by a known finding." |
| "The answer is cached" or "changes propagate in 30 seconds" | "A save is in force without a software release; no propagation time is promised." |
| "The receipt itemizes every term" | "The receipt lists the four strongest tag terms and every adjustment; weaker tag terms are inside the base score." |
| "The census drives the cold start" | "Census figures are shown in one demo, never scored; the cold start reads the arrival and the region's own counts." |

- **The lead's rulings after review round one** (`lanes/R.md` §6, L-d1 to L-d5; §12):
  - B.6's code-path column stays, headed "Where in the code (for engineers)" (§1).
  - The latency documents are not linked.
  - Engineering documents are named only by their paths, and only by paths that carry no customer name.
  - "GA4" stays only with its trace to S2 (§7.1).
  - "brand = samsung" stays: a real product brand may be an example dimension value (§5).
  - References to the other pieces are real links (§6).
- **Built, designed and open content:** as the rows say; the exception is A1, recording, flagged in A.8.

### 3.6 (e) The credits page, standalone and restyled

- **Reader:** an account executive who quotes the engine alongside Opal. **Owner:** P1, which wrote both sources below. **Address:** `/credits`. **Word copy:** `word/Where-AI-Credits-Fit-v1.0.docx`.
- **Sources:** `content/credits-source.html`, the page that was shared, kept whole with its corrections, from which the page is built; and `content/credits.md`, the same text in order as markdown, from which lane W builds the Word copy. The render check compares the page with both. The original stays filed, untouched, at `docs/enablement/research/opal-ai-credits-placement.source.html`. This is the one piece whose page is built from HTML, not markdown (§6).
- **The corrections rule** (the lead's ruling, §12): corrections make false statements true, with the design's labels (Built, Designed, Open; "demo only"; "switched off by policy and not offered"). The structure, order, devices and voice stay. Every candidate P1 found on the page as built (`lanes/P1.md` §5) is checked against S2: a statement S2 shows false is corrected; anything that is only the original's voice stays.
- **Rule:** the original's, "The engine decides. Opal creates and explains." It is followed at once by "Opal is not connected to the engine today." (S2 §6.2), marked on the page as an addition.
- **As built** (lane P1): the page carries the source whole and in its order: the masthead, the rule, the timeline's three phases with every row, the scaling cards, the three meters, the three sentences, the five questions, the order form and the closing lines. The original script's data became static HTML. Without JavaScript, the three phases read one after another. With it, `site.js` turns them into tabs, Before first, with the original's behavior, plus the arrow keys, Home and End.
- **Marked additions on the page:** the package name in `#package-name`; the title "Where Opal and AI Credits Fit, and Where They Never Do", which replaces the original's; the sentence after the rule; the legend; the session figure; and the lead line "Each question opens to its answer." above the questions.
- **Credit verdicts are words, never colors.** Each is a bold word or phrase, with no fill and no color of its own, in the session figure as on the page: "No AI · no credits", "Credits apply", "Metered per use", "Credits not decided", and "Own licensing" for the products under their own licenses. The package legend (Built, Designed, Open) is the only legend on the page and in the figure. P1 aligns the page's credit chips to words on the next render.
- **Summary carried into (b), (c), (d) and (h):** P2.
- **Figures:** D1's `before-during-after`, static in section 01 with a lead line, because the timeline above it is already a before, during and after switcher; captioned with its SVG title (§3.9).

### 3.7 (f) The glossary page

- **Reader:** a marketer, the least technical reader; every definition also holds for an account executive and a solutions engineer. **Owner:** E1 (`GLOSSARY.md`). **Renders it:** P1. **Address:** `/glossary`. **Word copy:** `word/Glossary-v1.0.docx`, built by W.
- **Rule:** "One word for each meaning, defined once, in plain words."
- **Sections:** the reader line; the rule; `## How to read it`; one `##` section per letter; the rule again.
- **Where it departs from §3.0, on purpose:** its source sits at `docs/enablement/GLOSSARY.md`, not under `content/`, because the lead assigned that path; it has no session tables, no example and no never-say table, because it is the reference every piece points to; its letter headings are labels, not statements.
- **On the page:** P1 gives each entry an `id` made by the GitHub anchor rule from the term, with any bracketed symbol dropped (so "Learning dial (γ)" is `learning-dial`), so a piece's page can link to `/glossary#learning-dial`. Deprecated entries may be styled differently; their text is unchanged.
- **Changes:** a lane that needs a term the glossary lacks asks E1, or the lead once E1 has closed. Content lanes adopt the glossary's words; a deprecated word in a piece is a review failure.

### 3.8 (g) The demo map

- **Reader:** an account executive. **Owner:** P1, which wrote the source from this section. **Source:** `content/demos.md`, the page's and the Word copy's. **Address:** `/demos`. **Word copy:** `word/Demo-Map-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: which demo to show to whom`
- **Rule:** "Choose the demo by the question your customer is asking, and show today's engine on Vantage or Top Offers."
- **Facts:** the demos' addresses, rooms and beats come from `docs/demos/BOOTSTRAP.md` §2, §3, §5 and §6 and S1 tables F and I, by the lead's ruling; every statement about the engine inside it still traces to S2. No demo is described by the customer it was built for; a vertical ("a carrier's online shop", "a retailer's promotions module") is enough.
- **As built** (lane P1): `content/demos.md` holds this section as revised at 14:08 on 2026-10-02, as markdown, and the page and the Word copy are built from it. Three items in it are not this section's original words: each is marked on the page as an addition, and each is marked "Addition, as built" below.
- **Sections, in order:**
  1. No heading: "For account executives." and the rule.
  2. `## Two demos run today's engine`: a table with columns `Demo`, `Address`, `The question it answers`, `What the room sees`, `What it never claims`.
     - **Vantage**, `https://edge-platform-vantage.expedge.workers.dev/vantage/`. Question: what can the engine do for a visitor nobody has identified, from the first click? Sees: a carrier's online shop in which a stranger is served from the first paint on how they arrived and their region's synthetic sales; the page following them away from the ad; a phone page whose modules below the buy box the engine orders for them as they browse, while the buy box stays off limits; a merchandiser's pin and availability rule shown as overrides; receipts behind every card. Never claims: any decision on price, financing or credit; anything geographic beyond availability; a reorder when an interest fades; a lift number; that the engine places the homepage's areas, which the page's own template places, standing in for the customer's content system (demo only).
     - **Top Offers** (on screen, Lantern & Lane), `https://edge-platform-top-offers.expedge.workers.dev/top-offers/`. Question: can the merchandiser keep control while each visitor earns their own offers? Sees: a retailer's four-container promotions module filled from a pool; the visitor earning it; a merchandiser's day of real, versioned publishes (a window closing, a new promotion with no history, a weight, a pin); a weather and location rule; the module moved on the page by the page's own template, standing in for the customer's content system, while its four promotions stay the engine's (demo only); the click report, labeled attribution. Never claims: products (the pool is promotions); incrementality; a lift number; that the engine moved the module.
     - Under the table, P10, so the room's "the page rearranges itself" is said exactly.
  3. `## Two older demos show one idea each, on the older pipeline`: the same columns.
     - **Meridian** (on screen, Calder), `https://edge-platform.expedge.workers.dev/meridian/`. Question: does it work across industries, and whom does the page believe, the ad or the visitor? Sees: one brand, two businesses, with a live swap from retail to a bank; the hinge from the advertised product to what the visitor looks at; an interest fading out while the presenter waits, which the page shows on its own timer as the engine's decay re-asked, never as a pushed alarm. Never claims (addition, as built, from (c)'s caution for this demo): "Its hands-off change is the fading arithmetic checked again on a timer. Never call it a push from the engine."
     - **The Bright Hour**, `https://edge-platform.expedge.workers.dev/live/`, with its Offer Desk at `/live/ops`. Question: what about offers that live for hours? Sees: a live-shopping retailer deciding under expiry; a new offer born and ranked with no history; an item selling out mid-session; receipts. Never claims (addition, as built, from (c)'s caution for this demo): "It runs on the shared demo deployment's older build, not today's engine. Never present it as the product."
     - One shared line under the table: "Both run Generation 1, the older demo pipeline, at an older version of the code. Their memories are compressed to seconds for the room, and their AI chat and experiment screens are demo seams, not the engine."
  4. `## Engineers who saw a demo can move the numbers themselves`: Vantage's interactive explainer, `https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works`, for a customer's engineers or an SE: every constant on a slider, recomputed in the browser, naming no customer.
  5. `## Three things are not for showing as the engine`: First National Bank (`/visual-demo` on the shared worker) shows the 2025 platform, not this engine; the storefront at `/storefront` on the shared worker was built for one customer with its own brand and products and is never shown to another; OH, a home-appliances demo, is scaffolded and not yet hosted. The page at `/` on every worker is the 2025 dashboard, not the product.
  6. `## Before you show a demo`: open it from where you are, because the region on screen is the request's real one, and any other region is asserted by a press and labeled; regional data in the demos is synthetic and labeled; Vantage shows real phone makers' product images, and legal confirms before any public or recorded use; Vantage's regional data has a one-day memory and is reseeded before a showing, so ask the demos' owner (Simone Coelho) before a customer sees any demo.
  7. `## A demo for your own customer is a restyle, not a rebuild`: a demo is a palette, a product feed and a set of beats on a shared kit; it takes the customer's colors and never its logo; it may show real names for the products the customer itself sells; an SE follows the demo kit's how-to (`docs/demo-kit/HOWTO.md`), and nothing is created in the cloud without the owner's approval.
  8. The rule again.
- **Figures:** none.
- **Never say, beyond §4.9.** On the page, under the heading "Sentences never to say, and what to say instead" (addition, as built: this section lists the table without a heading):

| Never say | Say instead |
|---|---|
| The customer a demo was built for | "A carrier's online shop", "a retailer's promotions module" |
| A demo's numbers as the engine's | "Measured on synthetic data, with memories compressed for the room." |
| "The AI chat is the engine" | "The older demos' AI and experiment screens are demo seams, not the engine." |
| "We can put Vantage's images in a public deck" | "Legal confirms before any public or recorded use." |

### 3.9 The figures, drawn once

The figures as lane D1 drew them (`lanes/D1.md`). Each caption is the figure's SVG title, verbatim.

| File, under `docs/enablement/figures/` | What it shows | Caption | Used in |
|---|---|---|---|
| `architecture.svg`, `architecture.png` | The customer's site and the operator each talking to one worker on Cloudflare's network, with the stores it keeps, those it shares with the demo workers, and those a customer's deployment holds of its own; two points are open. The customer's backend and the optional outside services are left out on purpose (D1 §2.1, from S2 §2.2 to §2.7) | "Where the engine runs on Cloudflare" | (d), A.3; (c) |
| `decision-path.svg`, `decision-path.png` | The path from a visitor's event to a decision, step by step, with the published document that governs each step (D1 §2.2, from S2 §3) | "From an event to a decision" | (d), A.1 |
| `before-during-after.svg`, `before-during-after.png` | The credits page's device: the rule in two halves, the three parts of one session, the credit verdict as bold words at the top of every card and a status chip from the one legend, the one exception flagged once, a takeaway per part (D1 §2.3, from S2 §6 and the pricing guide under S2's corrections) | "One visitor's session: what happens before, during and after" | (e), static in section 01; (b), as a Before / During / After switcher at the end of a section, marked as an addition |

**Not drawn in this release:** the session strip planned for (b) and (c), the seam between site and engine, and the credits page's two scaling lines. Piece (b) carries the session figure instead, as a switcher; (c) carries `architecture` only; the credits page keeps its own scaling cards.

**How the pages show them** (lane P1): inlined verbatim and captioned with their SVG titles, on a white panel in both themes. Below 720 pixels the frame scrolls sideways, under the line "The figure scrolls sideways." The switcher on (b) has a lead paragraph and three buttons, Before, During and After. A button brings its part forward and fades the other two, and pressing it again shows all three. Without JavaScript, every figure is the plain figure.

**Rules for every figure.** Drawn once by D1 as SVG, with presentation attributes only: no `style` attribute, no `<style>` element, no script, no external reference, no embedded font or image, so each is safe to inline as it is. Ids are prefixed per figure, and each has a `<title>` and a `<desc>` through `aria-labelledby`. Text is real `<text>` in the pages' system font stack. Labels use the glossary's words and are gender neutral; no customer name, no timing figure, and no number beyond the product names R2 and D1. The legend's pills are the package's one legend (Built, Designed, Open), each with its word. A PNG at twice the drawn size sits beside each SVG for Word.

**One legend, and credit verdicts as words.** The session figure has one legend only, Built, Designed and Open. It gives each card's credit verdict as bold words at the top of the card, with no fill and no second legend. The credits page's credit tags follow the same rule (§3.6). Review lane R checks, in round two, that no color or fill carries a credit verdict anywhere (§12).

### 3.10 (h) What is built, designed and open

- **Reader:** anyone at Optimizely who must know what may be claimed today; the reader line is "For anyone at Optimizely who must know what may be claimed today." Like the glossary, it serves every reader, by the lead's ruling (§12). **Owner:** C3. **Source:** `content/status.md`. **Address:** `/status`. **Word copy:** `word/Status-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: what is built, designed and open`
- **Rule:** "Claim only what is Built; name what is Designed; say what is Open." As a bold quotation under the reader line, and again as the last paragraph.
- **What it holds:** S2 §10's tables in full, once for the whole package: every row of §3.1 (B1 to B16, D1 to D22, A1 to A13), in its wording and with its verdict; S2 §10.2's path to a customer deployment; S2 §10.3's open decisions, each with the owner the record names. No other piece repeats them in full: (d)'s B.8 is a ten-row summary that links here, and (b) and (c) carry only their own rows.
- **Front matter:** the reader line; the rule; the legend, verbatim; the stamp "Engine facts as of commit 8b4f74c", with its date; links to the glossary and to (d) by their titles.
- **Sections, in order, verbatim:**
  1. `## Before the visitor arrives, the brand sets the rules`
  2. `## While the visitor browses, the engine ranks what is left`
  3. `## After each answer, the engine counts what worked`, ending with the one exception to keep straight, recording, worded as in (c)
  4. `## The path to a customer deployment is built up to its first configuration`
  5. `## Fourteen decisions are open, and none may be answered before its owner decides`
  6. `## Where AI and credits fit`: P2 verbatim, and a link to the credits page by its title
  7. `## Say these sentences, and never these`: the sentences, and the never-say table, which carries P10
  8. The rule again.
- **Its tables:** the session tables have three columns, `What happens`, `Verdict` and `Caveat`. The caveat column adds S2 §10.1's caveat once and never repeats a condition the row already states. "Demo only" sits in a caveat as words, never as a fourth label.
- **Where it departs from §3.0, on purpose:** it serves every reader; it has no example story, because it is a reference, as the glossary is; its session tables carry a third column. Never rows stay off it, on its never-say table, as §3.1 says.
- **Figures:** none.

---

## 4. The facts discipline

### 4.1 One source

S2 (`research/S2-engine-facts.md`, code commit `8b4f74c`) is the only source for any statement about what the engine does, where it runs, what it stores, what is configured and how, and what is built, designed or open. A lane cites the S2 section for every such statement in its lane note, never in the piece's prose. A fact that is not in S2 is not used: the lane stops and asks the lead, and the lead either adds it to S2 or rules it out. Content lanes do not read the code to fill a gap.

Two sanctioned exceptions, both the lead's: the demo map's facts about the demos themselves (addresses, rooms, beats, imagery rules) come from `docs/demos/BOOTSTRAP.md` and S1; and naming comes from S3 Part 1. Neither may carry a statement about the engine that S2 does not hold.

### 4.2 The labels and the legend

The package has three labels, used the same way in every piece:

- **Built:** in the code and exercised.
- **Designed:** in an architecture document, not in the code.
- **Open:** no decision yet.

**The legend, verbatim, on every page that shows a label** (as built, every page but the demo map): "Built: in the code and exercised. Designed: in an architecture document, not in the code. Open: no decision yet." Each label has one color, the same on every page and in every figure, chosen by P1 from the brand palette; every chip also carries its word, so the meaning never rests on color alone. In Word the label is the word, in bold, in the verdict column.

**S2's other three labels** map as follows, so the legend stays at three:

| S2 label | In the package |
|---|---|
| Withdrawn (in the code, switched off by policy) | Not a row. Named only on the never-say list: "switched off by policy and not offered" (autonomy, Thompson sampling, a customer's own model in the score) |
| Demo only | Words in the row's text ("demo only"), mostly in the demo map; never a fourth color |
| Unverified | Not stated in any piece. If a piece needs it, the lead verifies it first (S2 Appendix B) |

A condition such as "off by default" or "not yet used on a hosted demo" sits in the row's text with the label Built, once.

### 4.3 No timing figures

No latency or throughput figure appears anywhere, for any reason (common brief; S2 §9.1 and §9.2 explain why none may be quoted). That covers every form: "under 200 ms", "sub-50 ms", "single-digit milliseconds", "tens of milliseconds", any median or percentile, "instant", and "real-time" used as a speed. `docs/demos/BOOTSTRAP.md` §7 and older presenter material carry such figures; the package does not inherit them.

A duration that is a constant in the code may be stated as a constant where a piece needs it: the memory's default and cap, the region's one-day memory, the consent life of 30 days, the attribution windows, the 30-minute visit gap, the 24-hour shopper capability. One exception: the document cache's lifetime is never quoted, because it reads as a promise of how fast a change reaches visitors, which the integration kit explicitly does not make (S2 §4.1). Say "in force without a software release".

### 4.4 The facts every piece respects

| Fact (common brief, S2) | The words pieces use |
|---|---|
| Nothing is personalized or recorded until the site passes an explicit consent choice (S2 §3.2) | P3, in the before or during table |
| A customer tenant holds no product catalog, so product events build interest only when its registry reads attributes from the events and the events carry them (S2 §3.3) | Row B6, in (c) and (d); the glossary's catalog entry |
| Learning moves nothing until the dial is raised; with the SDK as shipped nothing is recorded yet, because recording needs the slot set to count rendered pieces plus durable recovery, which is off in every configuration (S2 §3.15, §5) | P4 everywhere; P5 in (c) and (d) |
| ODP, Feature Experimentation and Opal are not in the decision path and not wired to it (S2 §6.2, §7.3, §7.4) | P9 |
| The customer deployment workflow stops before any tenant has documents; provisioning, connectors, measurement, retention and the commercial meter are open (S2 §10) | P8, and rows B9, B11, B12, A7, A13 |

### 4.5 "Calls no AI model to decide"

Say "It calls no AI model to decide" (S2 §1, §6.1). Never say "we don't use a model": a seam for a customer's own model exists in the code, switched off by policy, and the product does call a model outside the decision, in typed search and design-time tagging, both off by default (S2 §6.1). P7 is the full sentence.

### 4.6 Numbers

- **May be quoted, in (d) only:** S2 §3.17's published constants and S2 §3.4's worked arithmetic, with the view weight stated; S2 §9.3's limits, labeled as budgets in the code, not measured capacity.
- **May be quoted anywhere:** the consent life (30 days); "a default memory of 14 days, at most 90, with the production value open"; the attribution windows; the fact that the learning dial runs from 0 to 1 and starts at 0.
- **Demo-only numbers, never the engine's:** the memories of seconds and minutes in demos (S1 §2.2 lists 60 seconds, 90 seconds and about ten minutes, found in demo configurations); the weights compiled for two older demo scopes (S2 §3.4, §3.17); holdouts of zero on stage (S2 §5.3); the synthetic regional sales seeded into demos (S2 §3.6); census figures shown on a demo's panel (S2 §10.1). A piece that mentions any of these says "compressed for the room" or "synthetic, labeled".
- **Never:** a timing (§4.3); a lift, conversion or revenue figure; a cost per session or per visitor (S2 §6.3 says the cost model assumes a host no deployment runs); a share of anonymous traffic (not in S2).

### 4.7 S2 wording the package does not reuse as written

1. **S2 §1's corrected paragraph** is carried as P1 with three edits, each from S2 itself: "A content decision service." becomes "The engine decides which of the brand's own content each visitor sees, and in what order." (S3 §1.8 keeps that name for engineers); "each with a receipt that shows the arithmetic" becomes "each with the reasons that placed it there" (S2 §3.14: the page's answer carries the drivers; S2 §3.15 and §5.1: a receipt is recorded only with consent and, with the SDK as shipped, not yet); "a merchandiser changes" becomes "the brand's team changes" (S2 §4.5: the catalog, seeds and dimensions have no console screen and go through the API).
2. **S2 §3.4, "an interest halves every τ · ln 2".** Strictly it is the raw score that halves (S2 §0, τ); interest, R/(R + K), falls by less. The package says "the evidence behind an interest halves".
3. **S2 §3.4, "worked arithmetic at the defaults".** A view weight of 1 is compiled only for two older demo scopes (S2 §3.3 item 4, §3.17). The package says "with each view weighted 1".
4. **S2 §5.7's honesty wording**, "It records from day one and moves nothing until the dial moves" and "Stage two moves nothing until γ moves": the first needs the recording condition (S2 §3.15, §5.1); the second uses "stage" for learning. Pieces use P4 and P5.
5. **"Trust dial"** (S2 §0, and the common brief's facts list): the package says learning dial, as the brief's voice list asks.

These are notes for the lead's next revision of S2, not corrections made to it.

### 4.8 Facts a piece may want that S2 does not hold

Not used until the lead adds them to S2 or rules them out.

1. **Ordering a page's modules: settled by S2 §10.4 (2026-10-02).** On the Vantage phone page the engine decides the module order: `pdp-modules` is a normal slot whose pieces are modules, ranked like any other (Built, row D19). On the demo homepages the engine decides what is inside each slot, while the page's own script places the slots from a template standing in for the customer's CMS (Demo only; the demo map says so for Vantage and Top Offers). Per-context layout configuration stays Designed (row D16). The claim a piece may make is P10, from S2 §10.4 item 4.
2. **A share of anonymous traffic.** No figure in S2. Never quoted; say "visitors nobody has identified".
3. **The demos' compressed memories.** Their values are in S1 §2.2, not S2. Never quoted; say "compressed for the room".
4. **Content personalization and experience personalization** as names of two activations (S3 §1.8 keeps them). Not defined in S2; not used in this release.
5. **Who implements a customer deployment.** The delivery model is not in S2; no piece states it.
6. **The executed order-form line names.** Not in the repository (S3 §1.8, condition 5); the credits page stays generic.

### 4.9 The never-say list, shared by every piece

| Never say | Say instead | Basis |
|---|---|---|
| "BTIE"; "BTI" in a piece | The name in full on first use, then "the engine" | §2 |
| "It's AI", "AI-powered decisions", "the AI decides" | "It calls no AI model to decide." | S2 §6.1 |
| "We don't use a model", "there is no model anywhere" | "It calls no AI model to decide." | S2 §1 |
| Any timing or throughput figure, "instant", "real-time" as a speed | "We quote no timing figure; timing is measured on the customer's own deployment." "In the visitor's session, from their first event." | §4.3; S2 §9 |
| "Changes go live in seconds" | "A save is in force without a software release." | S2 §4.1, §4.6 |
| "It learns from day one", "it records from day one" | P4; in (c) and (d), P5 as well | S2 §3.15, §5.1, §5.2 |
| "Every decision is recorded", "a receipt for every decision" | "Every answer carries its reasons; receipts are kept with the visitor's consent once recording is on." | S2 §3.14, §3.15 |
| "It optimizes itself", "it finds the winner", "autonomous", "a bandit picks the winner" | "Nothing learned moves a score until a person raises the learning dial. Automatic weight changes and Thompson sampling are switched off by policy and not offered." | S2 §5.2, §5.4, §5.6 |
| Any lift, conversion or revenue figure or promise | "We make no lift claim; the day report is an attribution diagnostic." | S2 §3.16, §5.7 |
| "ODP is the backbone", "ODP is the memory; the edge is the reflex" | "The decision reads no ODP data, and ODP is not connected to it today." | S2 §7.3 |
| "Opal explains every decision", "Opal is built in" | "The engine's reasons are arithmetic it produces itself; Opal is not connected to it today." | S2 §6.2 |
| "It's CMAB", "it runs on experiments" | "It is not CMAB and depends on no experiment." | S2 §7.4 |
| "Nothing flashes", "no flicker" | In (d): "Deciding the first paint on the site's server has a source module; its acceptance is open." Elsewhere, say nothing | S2 §7.1 |
| "It works in native apps", "our mobile SDK" | "There is no native app SDK." | S2 §7.1 |
| "It replays the whole page exactly" | "Replay is exact for one slot." | S2 §3.14 |
| "No limit" | The limit, labeled as a budget in the code, or nothing | S2 §9.3 |
| "Erased in one call", "guaranteed deletion" | "Erasure is bounded and resumable, and it is not proof of physical erasure." | S2 §8.8 |
| "It knows who they are", "identity resolution" | "It knows the visitor by a random id until they sign in; then the two profiles merge." | S2 §3.1 |
| "Fingerprinting", "device detection" | "It reads no device detail beyond the operating system family of the visitor's phone." | S2 §8.5 |
| A share of anonymous traffic, such as "90 percent" | "Visitors nobody has identified." | §4.8 |
| "It holds your product catalog" | "It holds no product catalog for a customer; product events carry the attributes it scores." | S2 §3.3 |
| "Live in two weeks", any delivery date | "This material gives no date; the step that gives a deployment its first configuration is open." | S2 §10.2, §10.3 |
| "Census targeting", "income targeting" | "Census figures are shown in one demo, never scored." | S2 §10.1 |
| "The engine rearranges the page", "the engine decides the layout" | P10 | S2 §10.4 |
| "They score people; we decide pages", or any line that describes or judges another system | Our own reasoning. A "what it is not" contrast with a class of system is allowed, phrased as what the engine does instead (§5) | common brief; the lead's ruling |
| A customer, prospect or competitor name; a case study | No name; a vertical for a demo | common brief |
| A deprecated word | The glossary's word | `GLOSSARY.md` |

---

## 5. The design rules, and how each piece applies them

The common brief adopts S3 Part 2's first five rules as binding. Rules 6 to 10 apply where they fit; S3 §2.6's list of what to avoid applies everywhere.

| Rule | (a) Landing | (b) What it is | (c) Selling it | (d) How it works | (e) Credits | (f) Glossary | (g) Demo map | (h) Status |
|---|---|---|---|---|---|---|---|---|
| 1. One reader, named at the top | A colleague choosing | A marketer | An AE | A pre-sales SE | An AE who quotes | A marketer, holding for all | An AE | Anyone who must know what may be claimed (§12) |
| 2. One rule first, the same rule last | C | C | "Sell what is built…" | "Every setting that can change an answer…" | "The engine decides. Opal creates and explains." | "One word for each meaning…" | "Choose the demo by the question…" | "Claim only what is Built…" |
| 3. Before, during, after; a verdict per row; one exception | Not applicable: a choice of page | Tables; exception A5 | Tables; exception A1 | The walk's labels in A.8 and B.8's summary; exception A1 | The original's three parts; credit verdicts as words; exception: shopper-facing AI features | Not applicable: a reference | Not applicable; every demo row carries "what it never claims" | Every row, with a caveat column; exception A1 |
| 4. Sentences to say and never to say | §4.9 applies | §3.3 lists | §3.4 answers and lists | Its never-say table in A.8 | The original's three sentences | Deprecated entries | §3.8 list | Its sentences and never-say table |
| 5. Examples before mechanism; instruments explained first | Cards say what each page gives | The visitor's story first | Three moments first | The unit of state first, with its figure | The rule, then the session | Plain words before any symbol | The question before the demo | Not applicable: a reference; the legend and the stamp come before any table |

**On the pages, rule 5 means:** a plain lead paragraph sits above every figure, every switcher and every group of disclosures. Pages load one same-origin script, `/site.js`, as progressive enhancement only (§7): the credits page's tabs, the session figure's buttons, keyboard scrolling of wide figures, and opening every answer before print. Without it, every page reads in full.

**Rules 6 to 10** (S3 §2.5). 6, an FAQ of the questions that actually come up: (c) and (e). 7, a map of the order form, in the same color language: (e), labeled Designed and Open. 8, honesty in one ledger and confidence everywhere else: reconciled with the brief's "honesty inline" as one label on the row it qualifies, never a repeated caveat, with the never-say table as the ledger. 9, one word per meaning: the glossary. 10, no customer names, no judgement of anyone's system, no stale dates: every piece.

**What to avoid** (S3 §2.6): the point after a long sequence (every piece leads with its rule); terms never defined (every term at first use, and the glossary); instruments before explanation; one page for several readers; caveats on every screen; state carried across screens (none: `/site.js` keeps no state between pages); numbers that differ from the engine's; a stale structure, such as a ladder of offerings that cannot be skipped; several names for one thing; density.

**The voice** (the common brief's, restated so a lane has it in one place):

- **Gender neutral, everywhere** (owner's ruling, 2026-10-02). The visitor is "the visitor", or "they", "them" and "their", with the verb that "they" takes ("they arrive"). No piece, page, figure or Word copy matches the pattern `\b(she|her|hers|he|him|his)\b`, in any case, quoted lines and never-say tables included; lane R scans for it and fails a piece on any match (§9).
- Plain words; every term defined the first time; the glossary's words only.
- No customer, prospect or competitor name; demos by their fictional brands and their addresses.
- **"What it is not" is allowed** (the lead's ruling, 2026-10-02). A piece may contrast the engine with a class of system, under these conditions:
  - each contrast is phrased as what the engine does instead, for example "It is not a tool that sorts visitors into segments by rule. For each visitor, it keeps a graded interest…";
  - it never names a product or a vendor, and never judges the other class;
  - it may use the other class's own word once, even a word the glossary deprecates for the engine, such as "segments".
  Review lane R does not fail a contrast that meets these conditions.
- **A real product brand may be an example dimension value** (the lead's ruling), as in "brand = samsung". It is an example of a value, not a customer or a vendor of ours.
- **A third-party product name stays only with its trace to S2**, as "GA4" does in (d) (S2 §7.1).
- Honesty inline: one label on the row it qualifies; "synthetic" where data is synthetic; "designed, not built" where so.
- American English.
- Short sentences, one idea each; no em-dashes; headings are statements, except the glossary's letter headings and the noun-phrase headings accepted in (b) (§3.3).

---

## 6. Formats and the single-source rule

**One source per piece.** Each piece's source is one markdown file: `docs/enablement/content/<piece>.md`, and the glossary at `docs/enablement/GLOSSARY.md`. Three exceptions, as built:
- The credits page has two sources: its page is built from the corrected HTML `docs/enablement/content/credits-source.html`, and its Word copy from `docs/enablement/content/credits.md`, the same text in markdown (§3.6). The render check holds the page to both.
- The landing page renders §3.2's text.
- The demo map's source is `docs/enablement/content/demos.md`, which P1 wrote from §3.8 (§3.8).

The page and the Word copy are renderings of the source. A change is made in the source first; the page is then re-rendered and the Word copy rebuilt. A Word file is never edited by hand.

**The markdown, written for both renderings.**

- `#` once, for the title; `##` for sections. The converter starts a new page at every `#` and lists `#` and `##` in Word's contents, so deeper headings are not used.
- Tables in pipe syntax with short cells; no ASCII diagrams; code fences only where a reader must see literal text, with lines of 76 characters or fewer (converter rules 1 to 3).
- Figures as `![caption](../figures/<name>.png)`, alone on a line; the page shows the SVG of the same name.
- Links within a piece as `[text](#heading-anchor)`, with GitHub's anchor rule: the heading's text without markup, lower-case, every character that is not a letter, digit, underscore, hyphen or space removed, each space a hyphen. A link to a missing anchor fails the Word build, by design.
- Every reference to another piece is a real link, never an italic title alone (the lead's ruling). Links to another piece or to the site show the page's title as their visible text and carry the full address as their target, for example `[Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it)`, with no trailing slash. They work in Word for anyone past the gate, and the address, whose host name carries the abbreviation §2 keeps out of visible text, is never shown. On the page, P1 may make same-site targets relative without changing their text. Links to a demo may show the demo's address, which carries no such abbreviation.
- No HTML in the markdown, no em-dash, American English.

**The Word copy.** Lane W builds each with the repository's converter, unchanged:

```
node scripts/md2docx.mjs <source.md> docs/enablement/word/<File>-v1.0.docx \
  "<the source's title line, verbatim>" "<Subtitle>" "<Prepared for>" \
  "1.0" "<Month D, YYYY>" "Internal: Optimizely only"
```

The subtitle is the reader and the facts stamp, for example "For marketing · engine facts as of commit 8b4f74c". "Prepared for" is the reader's team, for example "Optimizely marketing". The version is the bare number, because the converter prints its own "Version" label. File names carry no package name, so a rename does not rename files, and carry their version; when a new version replaces an old one, the lead removes the old file (lanes do not delete). The converter needs the `docx` package installed once per machine, outside the repository (its header says how); W uses an existing install and installs nothing.

**The page, a designed rendering of the same text.** Each content page wraps the piece in `<article data-source="docs/enablement/content/<piece>.md">` (the glossary names `docs/enablement/GLOSSARY.md`). Everything inside it is the source's text; everything outside it is the chrome in §7. P1 may choose any layout, type and color inside the brand, but may not drop or reword text inside the article. A word that is not the source's, such as a rule's label or the session figure on (b), is marked on the page as an addition (`data-added`, or `data-replaces` for a replaced title). The figure's internal text sits inside an inline SVG and is outside the comparison; its caption is a `<figcaption>` and is inside it.

**The page builder:** `enablement/render-pages.mjs` (lane P1) renders every page from its source, with the one stylesheet `/site.css` and the one script `/site.js`, so a change to a source is re-rendered, never hand-edited on a page.

**The text check:** `node enablement/render-check.mjs` (lane P1). It compares each page with its source sentence by sentence, in both directions, and fails on any missing source sentence and on any page sentence that is neither in the source nor marked as an addition. It also fails on an inline figure that differs from its file, a caption that is not its figure's title, missing chrome (the package name, the stamp, the footer line, the skip link, or the legend on a page that shows a label), and any scan hit: a gendered pronoun, a customer or person name the brief lists, a timing figure, or the abbreviation §2 keeps out of visible text. `--verbose` lists every marked addition. It runs before every deploy, beside the preflight.

**Figures.** Drawn once by D1 under `docs/enablement/figures/` (§3.9). Pages embed the SVG inline, copied verbatim from the figure file, so no figure is a request of its own and the image policy is unchanged; the render check confirms each inline copy matches its file.

---

## 7. The site

- **The worker.** `edge-platform-bti`, at `https://edge-platform-bti.expedge.workers.dev`. It serves the pages P1 builds under `enablement/site/`, and nothing else; it shares nothing with the demo workers. Lane E2 owns its code, `enablement/worker.mjs` with its tests `enablement/worker.test.mjs`, and its configuration, `wrangler.enablement.toml`, which now names `edge-platform-bti`, runs the worker before the assets and keeps preview addresses off (`docs/enablement/lanes/E2.md`). The first worker, `edge-platform-enablement`, stays behind Cloudflare Access and is no longer deployed to (§12).
- **The gate: a passphrase, in the worker itself** (lane E2). One passphrase, held as a worker secret, with a second secret, the key that signs the cookie; a signed cookie that lasts seven days; failed attempts slowed; nothing served without it. The values live only in the worker and in the owner's local `.dev.vars`. It replaced Cloudflare Access on 2026-10-02, after Access's one-time email codes did not reach the owner (§12). It is temporary, until the material moves inside Optimizely and the Microsoft sign-in takes over.
- **The gate is not a content page.** Its own sign-in page at `/auth` and its cookie belong to lane E2. Content pages still hold no form, inline script, cookie or storage (below), and nothing on them depends on the gate.
- **What the gate means for verification.** No script holds the passphrase, so hosted pages are not checked by script. Every page is proven as built files before a deploy: the preflight, the render check and the headless Chrome checks in §9 run against the built files locally. After a deploy, an outside check without the passphrase proves that every address, unknown ones included, serves no page content. With the passphrase, a person sees the pages in a browser. Whether a script may ever hold the passphrase is the owner's decision (§11).
- **The pages and their addresses, with no trailing slash:** `/` (a), `/what-it-is` (b), `/selling-it` (c), `/how-it-works` (d), `/status` (h), `/credits` (e), `/glossary` (f), `/demos` (g), plus E0's 404 page for any other address. As built, the pages are flat files (`what-it-is.html` and the rest), served without the extension by the assets binding's default handling, beside `/site.css`, `/site.js` and `figures/`.
- **The chrome, on every content page, verbatim, as built:**
  - the skip link, "Skip to the page", the first Tab stop;
  - the eyebrow, "Internal · Optimizely";
  - the navigation, linking to every page, with the current page marked: "All pages" (`/`), "What it is", "Selling it", "How it works", "Status", "AI credits", "Glossary", "Demo map";
  - the reader tag at the top of each piece: "For marketing", "For account executives", "For solutions engineers" or "For everyone";
  - the legend (§4.2), on every page that shows a label;
  - the version stamp: "Updated <Month D, YYYY> · engine facts as of commit 8b4f74c", where the date is the day the page's text last changed and the commit is the one S2 is pinned to;
  - a footer listing every piece by its full title and reader, ending with the line "Internal · Optimizely · do not forward outside Optimizely".
  - The package name is written once per page, in `#package-name` inside the `h1`; the page's `<title>` never repeats it.
- **The version stamp's rule.** When S2 is revised and pinned to a new commit, every page's stamp changes with it, and every piece is reviewed against the difference in S2 before the new stamp ships. The Word copy carries the same commit in its subtitle and the build date on its cover.
- **The headers,** in `enablement/site/_headers`, which the assets binding applies to every page the gate serves (E2 measured it): a Content-Security-Policy of `default-src 'none'; style-src 'self'; script-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, never `unsafe-inline` or `unsafe-eval`; `nosniff`; frame denial; `no-referrer`; a closed Permissions-Policy; HSTS; `Cache-Control: private, no-store`; `X-Robots-Tag: noindex, nofollow, noarchive`. Every style lives in `/site.css` and all behavior in `/site.js`, so no page carries an inline style or script; `img-src data:` stays for the tab icon. E0's 404 page still carries an inline style, which needs its hash kept in `style-src` or a move onto `/site.css` (P1 §4, item 2).
- **What a page may hold.** Static HTML that loads only `/site.css` and `/site.js` from its own site, with inline SVG figures; no inline style or script, no form, no font or image from anywhere, no storage, no cookie (the gate's cookie is the gate's), no API call. `/site.js` is progressive enhancement only (§5): without it, every page reads in full. Each page makes only same-origin requests: the page, the stylesheet and the script. Links (`<a href>`) go to the site's own pages, to the demo workers' addresses in §3.8, and to nothing else.
- **The preflight,** `node enablement/check-site.mjs`, lane E2's since it widened E0's checks for the gate: the configuration may now name `main`, the assets binding and `run_worker_first`, and the gate's own checks are added. For the pages as built it widens on purpose, as P1 §4 sets out: the eight pages, `site.css`, `site.js` and the figures as required files; `style-src 'self'` and `script-src 'self'` with no hash; exactly one empty `<script src="/site.js" defer>` and one `<link rel="stylesheet" href="/site.css">` allowed; `<a href>` to the allowlist (the site itself and the three demo workers) kept apart from anything that loads, which stays same-origin; the package name once per page, inside the `h1`. The chrome is proven by the render check, which the preflight may call. Each widened check is proven by a mutation that fails for the right reason.
- **The deploy, the lead's, from WSL** (`docs/enablement/lanes/E2.md` §5):

```
node enablement/check-site.mjs && node enablement/render-check.mjs && \
  npx wrangler deploy --config wrangler.enablement.toml
```

  A first deploy sets the two secrets after it, as E2's note says; until both exist, the worker answers 503 to everything. Never a plain `npx wrangler deploy` from the repository root: `wrangler.toml` names the shared demo worker.
- **After the deploy,** verify the responses, not that a page opens. From outside, without the passphrase: every address answers with the gate and carries no page content. With the passphrase: the pages, the 404 page for an unknown address, and the headers above. E0's items 1 to 4 (status, the 404 page, the headers, the requests per page) are proven on the built files before the deploy.
- **Deployed and verified, 2026-10-02** (the lead, `lanes/E2.md`). `edge-platform-bti` version `8388fa81`, from commit `8086cb1`, deployed from a clean worktree with both secrets already set. Checked from outside:

| Request | Answer |
|---|---|
| `/`, with no session | 302 to `/auth` |
| `/auth` | 200, with the strict headers and one password field |
| A wrong passphrase | 401, and no cookie |
| The right passphrase | 303, setting the session cookie |
| `/`, with that cookie | 200 |
| An unknown address, with that cookie | 404 |
| `/`, with a forged cookie | 302 to `/auth` |

---

## 8. What is superseded

The older documents S1 and S2 mark as unsafe to reuse for these readers, with the reason and what replaces them in this package, so `docs/README.md` can be corrected later (§10). Paths are quoted exactly because this section exists to correct the repository's front door; some contain customer names, and nothing in this section is rendered on the site or copied into a piece. No document's body is changed by this release.

**Front doors that mislead**

| Document | Why it is unsafe to reuse | Replaced, for these readers, by |
|---|---|---|
| `docs/README.md` | Dated January 2025; 34 of its 50 links are dead; it never mentions the demos, the kit or this package (S1 table A) | `docs/enablement/README.md`; `docs/demos/BOOTSTRAP.md` for the demos |
| `README.md` (after its first screen) | The 2025 scaffold's README; its demo list omits Vantage; it lists two demo workers where `AGENTS.md` lists three; its pixel sample documents a route that now serves an inert image (S1 table A) | (d); BOOTSTRAP for the demos |
| `public/index.html` (the page at `/` on every worker, the customer deployments included) | The 2025 dashboard; it links to no demo (S1 table I) | (g) names it as not the product |
| `ONBOARDING.md` | Its status calls are wrong: tenancy and the content engine "designed, not coded", the content weights, six dimensions, the regional blend over the raw score, operator routes unauthenticated, a path that does not exist (S1 table A) | S2 for status; (d) for readers |

**The 2025 scaffold, which is not this engine**

| Document | Why | Replaced by |
|---|---|---|
| `COMPLETE_ARCHITECTURE_DOCUMENTATION.md` and `COMPLETE_ARCHITECTURE_DOCUMENTATION copy.md` (byte-identical) | The 2025 platform, with speed claims (S1 table B) | (d) |
| `REAL_TIME_PERSONALIZATION_ARCHITECTURE.md` | The 2025 flow through Feature Experimentation (S1 table B) | (d) |
| `docs/SOLUTIONS_ARCHITECT_GUIDE.md` | Current only for the bank demo; its FAQ puts consent out of scope, quotes a speed and makes Feature Experimentation the decision engine (S1 table B) | (c), (d); (g) for the demo |
| `docs/DEMO_EXPLANATION.md` | Describes segment rules evaluated per event, the opposite of the engine; speed and "production-ready" claims (S1 table B; S3 §2.2) | (g) |
| `docs/guides/01-quick-start.md`, `docs/integration/01-web-integration.md`, `docs/components/01-segment-engine.md` | 2025 developer guides (S1 table B) | `docs/kit/` for developers; (d) |
| `docs/OPTIMIZELY_SETUP.md`, `docs/optimizely-setup-instructions.md`, `docs/optimizely-feature-config.md` | Wiring the 2025 bank demo to Feature Experimentation (S1 table B) | Not needed by these readers |
| `docs/architecture/legacy/`, `docs/api/legacy-01-rest-endpoints-2025.md` | Historical by design (S1 tables B, G) | Kept as history; never cited |
| `.claude/worktrees/agent-a96c30a326d3da233/` | An accidental copy of the 2025 repository (S1 table B) | Ignore |

**Explainers written before today's engine**

| Document | Why | Replaced by |
|---|---|---|
| `docs/Content-Personalization-Explained-Simply.md` | July: the catalog "being built now", the foundation deploying in weeks, ODP "the backbone", a ladder of offerings "customers can't skip", 19 customer and competitor mentions (S1 table D; S3 §2.2) | (b), (c) |
| `docs/GTM-Delivery-Playbook.md` | July statuses and a content-first ladder since reversed; customer positions and dates; its honesty rules and glossary are superseded (S1 table E) | (c) and §4.9; (f) |
| `docs/Edge-Affinity-Reflex-Technical-Design.md` | Its worked example and configuration use a demo memory of 60 seconds (S1 table G) | (d); (f), memory |
| `docs/architecture/16-edge-affinity-reflex.md` | Calls τ a half-life and makes a speed a design decision (S1 table G) | (d); (f), half-life |
| `docs/architecture/14-architecture-and-optimizely-capability-map.md` | Frames AI as central to the decision, the opposite of the engine's rule (S1 table G) | (d), (e) |
| `docs/architecture/00-architect-walkthrough.md`, `docs/architecture/01-system-overview.md` | Generation 1 as built in July: no tenants, published documents or receipts (S1 table G) | (d) |
| `docs/api/01-rest-endpoints.md` | Says most endpoints are open, which is false under enforced access (S1 table G) | `docs/kit/02-api-reference.md` for developers |
| `docs/Productization-Roadmap.md`, `docs/Product-Gaps-Assessment.md` | List built things as missing (S1 table E) | S2 §10; (c) |
| `docs/qvc/BrightHour-Engine-Explainer.md` | Current for its own demo, but says a 90-second memory halves in about 90 seconds; it halves in about 62 (S1 table F2) | (f), memory; the rest only for that demo |
| `docs/REVENUE-RADAR-EXPLAINER.md` | An Opal and experimentation feature that a reader can mistake for the engine; a speed claim (S3 §2.2) | (g) |
| `docs/Click-Through-Seam-Perspective.md` | Its state table says the engine is "being productized" (S1 table E) | (b) for what it is now |

**Customer and account material, never reused across customers**

| Document | Why | Replaced by |
|---|---|---|
| `docs/content-personalization-design-tapestry.html` | In a customer's hands; shows automatic optimization as available and says every mechanism runs today; calls ODP the backbone; written in that customer's voice (S1 table C) | (d) |
| `docs/Tapestry-Outcome-Learning-Design.html`, `docs/Affinity-Outcome-Learning-Design.html` (byte-identical) | Older than their own source; still offer Thompson sampling and an autonomous mode (S1 table C; S3 §2.1) | `docs/architecture/22-outcome-learning-design.md` for engineers; (d) |
| `docs/Tapestry-BTI-Deliverables.md` | Its "stateful actor per visitor" describes the object host, which no deployment runs (S1 table C) | (d) |
| `docs/Tapestry-BTI-System-Architecture.md` | Says D1 holds every event, decision and receipt; the ledger is in R2 (S1 table C) | (d) |
| `docs/ASOS-Edge-Personalization-Overview.md`, `docs/Coach-Realtime-Behavioral-Personalization-Architecture.md` | Named for customers; a 60-second memory; speed claims; content "being built" (S1 table C) | (b), (d) |
| `TAPESTRY-POC-EXEC-ONEPAGER.md`, `TAPESTRY-POC-TEAM-BRIEF.md`, `TAPESTRY-ROLLOUT-AE-GUIDANCE.md` | Superlatives, competitor comparisons, dates and percentages from before the contract (S1 table D) | (c) |
| `docs/Tapestry-AE-*.md`, `docs/Tapestry-Scope-*.md`, `docs/Coach-*.md`, `docs/Tapestry-Capability-Breakdown-v2.md`, `docs/Tapestry-CFO-Capability-Doc-Review.md` | Deal threads and field material for one account (S1 tables D, F1) | (c) |
| `docs/BTI-Content-Pool-Sizing.md` and `.docx` | Page-scoped arithmetic, since superseded by slot scoping (S1 table C) | Not needed by these readers |
| `docs/BTI-Implementation-Guide-v1.0.docx` | Superseded by v1.1 the same day and still beside it (S1 table J) | v1.1, a customer document |
| `docs/Quin-vs-Platform-At-a-Glance.md`, `docs/Competitive-Quin-Comparison.md` and their Word copies | Name a competitor; this package explains only our own reasoning (common brief) | (c), (d) |

**Commercial and delivery material on a planned architecture**

| Document | Why | Replaced by |
|---|---|---|
| `docs/Edge-Unit-Economics.md` | Costs the object host, which serves no deployment today (S2 §6.3, Appendix A) | No cost figure in this package |
| `docs/Monetization-Legal-Brief.md` | The same cost basis; illustrative figures; still the recommendation S2 §6.3 quotes as Designed | (e), for the lines as Designed and the rates as Open |
| `docs/Opal-Credit-Boundary-Pricing-Guide.md` | Mostly current, but says Opal creates audiences in ODP and lists touchpoints that are switched off or undefined (S2 §6.2; S3 §2.2) | (e) |
| `docs/PS-Implementation-Runbook.md` | Its account of a customer deployment's parts is wrong in four places, its audiences generate automatically only in a demo, and it says deployment "arrives automated" (S2 Appendix A; S1 table E) | (d); S2 §10.2 |
| `docs/PS-Implementation-Delivery-Guide.md` | Scores an embedding model through a term that is switched off; its delivery model is not current (S2 §7.6; S1 table E) | (d) |

---

## 9. Lanes and ownership

One writer per path. Every lane reads anything and writes only its own paths; no lane runs a git command that changes anything, installs, deletes or deploys; the lead commits and deploys. Each lane records what it did and why in `docs/enablement/lanes/<lane>.md`. Paths below are relative to the repository root.

| Lane | Writes only | Delivers | Starts when |
|---|---|---|---|
| **E1** design | `docs/enablement/BTI-Enablement-Design.md`, `docs/enablement/GLOSSARY.md`, `docs/enablement/README.md`, `docs/enablement/lanes/E1.md` | The glossary, this design, the folder map | Now; the glossary first |
| **C1** marketing | `docs/enablement/content/what-it-is.md`, `docs/enablement/lanes/C1.md` | (b) | The glossary lands |
| **C2** account executives | `docs/enablement/content/selling-it.md`, `docs/enablement/lanes/C2.md` | (c), rebuilt to §3.4 | The glossary lands; the rebuild follows the lead's ruling after review round one |
| **C3** solutions engineers | `docs/enablement/content/how-it-works-and-where-it-runs.md`, `docs/enablement/content/status.md`, `docs/enablement/lanes/C3.md` | (d), (h) | The glossary lands |
| **D1** diagrams | `docs/enablement/figures/**`, `docs/enablement/lanes/D1.md` | Three figures, SVG and PNG (§3.9) | This design lands |
| **P1** pages and site | `enablement/site/**` (the pages, `site.css`, `site.js`, the figures' copies), `enablement/render-pages.mjs`, `enablement/render-check.mjs`, `docs/enablement/content/credits-source.html`, `docs/enablement/content/credits.md`, `docs/enablement/content/demos.md`, `docs/enablement/lanes/P1.md` | (a); the chrome; the pages for (b) to (h); the sources of (e) and (g); the page builder and the render check | This design lands (chrome, checks and landing page first); each content page once its source has passed review round 1 |
| **E2** the site's worker and gate | `enablement/worker.mjs`, `enablement/worker.test.mjs`, `wrangler.enablement.toml`, `enablement/check-site.mjs`, `docs/enablement/lanes/E2.md` | The worker `edge-platform-bti`, the passphrase gate, the preflight, the deploy command | The owner's instruction of 2026-10-02 |
| **W** Word builds | `docs/enablement/word/**`, `docs/enablement/lanes/W.md` | Seven Word copies, one for each piece but the landing page | Each source has passed review round 1 and the lead's read |
| **R** independent review | `docs/enablement/lanes/R.md` (rounds appended) | A verdict per piece, page and Word copy | Round 1 when every source and figure has a draft; round 2 when the pages and Word copies exist |

**The lead** commits by path at each integration point; answers §4.8 (item 1 settled by S2 §10.4; the shared credits page filed in `research/`); revises S2 when a fact is added; deploys the site's worker with lane E2's command and checks from outside that no address serves content without the passphrase (§7).

**The order.**

1. E1: the glossary, then this design, the folder map and the lane note.
2. In parallel: C1, C2 and C3 write their sources from the glossary, S2 and this design; D1 draws the figures; P1 builds the chrome, the widened checks and the landing page.
3. R, round 1: every source and figure.
4. Owners fix; the lead reads each source.
5. P1 renders (b) to (g); W builds the Word copies.
6. R, round 2: every page and Word copy.
7. The lead commits and deploys, with the built files already proven, then checks from outside that no address serves content without the passphrase.

**The gates.**

- **E1:** every glossary entry traces to S2, or to the common brief for the package's own conventions, in `lanes/E1.md`; the lead accepts the design.
- **C1, C2, C3:** every engine statement traces to an S2 section, listed in the lane note against each section of the piece; the shape in §3.0; the rows from §3.1 with their wording and verdicts; the verbatim paragraphs as written; glossary words only, and a search for every deprecated term finds none in the piece; no customer, prospect or competitor name; no timing figure; no em-dash; American English; gender-neutral wording, with no match for `\b(she|her|hers|he|him|his)\b` in any case; headings as statements; `#` once and `##` for sections; figures and links as §6 says; the name once; the word budget.
- **D1:** the rules in §3.9; each PNG matches its SVG; captions verbatim; each figure checked in light and dark on a test page; labels in the glossary's words and gender neutral.
- **P1:** the preflight passes with its widened checks, each proven by a mutation that fails for the right reason; `node enablement/render-check.mjs` passes for every page; on the built files, served locally, because no script holds the passphrase (§7), in headless Chrome at 320, 375, 768 and 1280 pixels, light and dark: no horizontal scroll, only same-origin requests (the page, `/site.css` and `/site.js`), no console message, WCAG AA contrast for every text and background pair, the legend on every page that shows a label, the stamp and the footer line present, the skip link the first Tab stop, and every page complete without JavaScript.
- **W:** each copy built by the unchanged converter; a title page and a linked contents; every in-document link resolves (the build fails otherwise); each figure renders; the file is named with its version. Not machine-verifiable: Ctrl+Click in Word and a PDF export; the owner tries one link on first opening.
- **R:** a PASS or FAIL per piece, page and Word copy, every finding located to a line, covering facts against S2, the rules, the voice, the never-say list, the render check, the preflight, the rendering and the Word structure. R scans every piece, page, figure and Word copy for `\b(she|her|hers|he|him|his)\b`, in any case, and fails the piece on any match. R reviews pages as built files, since no script holds the passphrase. R writes nothing else.

---

## 10. Out of scope for this release

- A generalized interactive "how it works" for the engine beyond the Vantage one; (d) and (g) link to the Vantage page instead.
- Slide decks of any kind.
- Any change to the bodies of older documents, including `docs/README.md`; §8 is the list for a later correction.
- Anything customer-specific: no customer, prospect or competitor name, no customer's order form, no description of any customer's own systems, no customer-facing version of a piece.
- Any change to the engine, the demo workers, their settings or their secrets, and any deploy by a lane.
- New engine facts: S2 changes only through the lead.
- The passphrase itself, which is the owner's, and the Microsoft sign-in that takes over from the gate when the material moves inside Optimizely.
- Moving the material inside Optimizely, a later step.
- Search, analytics, forms or any script on the site.

---

## 11. Open decisions for the owner

| Decision | Owner | Until it is made |
|---|---|---|
| The final name of the package and the offering | Marketing | "Behavioral Targeting and Intelligence" is the working name, written once per page and once per source, so a rename is one edit per file |
| Whether a script may hold the passphrase, so hosted pages can be checked by script | The owner | Not needed for this release: pages are proven as built files before a deploy, and the gate is checked from outside after it (§7) |

No other owner decision is known that the package needs. The questions in §4.8 are facts for the lead to add to S2 or rule out, not owner decisions.

---

## 12. Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-02 | **The name.** Behavioral Targeting and Intelligence: the full four words on first use in a piece, then "the engine"; never "BTIE"; "Intelligence" means counted learning behind a dial, never AI; written once per page in `#package-name` and once in each source's title, because marketing may rename it (S3 Part 1) | lead |
| 2026-10-02 | **The credits page stays standalone and is restyled**, and its one-paragraph summary is carried into (b), (c) and (d) | lead |
| 2026-10-02 | **Page plus Word, no decks** | lead |
| 2026-10-02 | **The internal site** `edge-platform-enablement`, with a sign-in for @optimizely.com emails, temporary until the material moves inside Optimizely | lead |
| 2026-10-02 | **The facts sheet is the only source** of engine facts: S2, pinned to code commit `8b4f74c` | lead |
| 2026-10-02 | **No timing figures,** anywhere, for any reason | lead |
| 2026-10-02 | **`docs/enablement`** is the folder's working name | lead |
| 2026-10-02 | From the common brief: American English; S3 Part 2's rules 1 to 5 as binding; the voice; customer names nowhere; demos named by their fictional brands and shown by address | lead |
| 2026-10-02 | **Everything is gender neutral.** The visitor is "the visitor" or "they", "them" and "their", never a gendered pronoun. Review lane R scans every piece, page, figure and Word copy for `\b(she|her|hers|he|him|his)\b`, in any case, and fails on any match (§5, §9) | owner |
| 2026-10-02 | **Cloudflare Access is on** for `edge-platform-enablement`: "Protect this Worker behind Access", all traffic, policy "Email domain" `optimizely.com`, signing in by a one-time code emailed to the address. Verified from outside: every address, unknown ones included, answers 302 to the Zero Trust team's login page on `black-shape-7747.cloudflareaccess.com`, and no page content is served without a session. Temporary, until the material moves inside Optimizely | owner |
| 2026-10-02 | Because no script passes the sign-in, pages are proven as built files before a deploy (the preflight, the text check, the headless Chrome checks), and after a deploy an outside check proves the redirect on every address; a Cloudflare Access service token for scripted checks is an owner decision (§11) | lead |
| 2026-10-02 | Three labels only. S2's Withdrawn becomes "switched off by policy and not offered" on the never-say list; Demo only becomes words in a row; Unverified is never stated (§4.2) | E1, on the lead's brief |
| 2026-10-02 | One color legend per page. The credits page's credit verdicts become words in their own column, because a second color legend would break the common brief's one legend on every page. (The words were first given as "Credits apply", "No credits" and "Per use"; they are now the figure's: "No AI · no credits", "Credits apply", "Metered per use", "Credits not decided" and "Own licensing", in bold and without color, §3.6.) | E1, on the lead's brief |
| 2026-10-02 | The glossary's source is `docs/enablement/GLOSSARY.md`, the one piece source outside `content/`, as the lead assigned; it names the marketer as its reader and every entry holds for all three; it has no session tables, and its letter headings are labels (§3.7) | E1, on the lead's brief |
| 2026-10-02 | The landing page is navigation and has no Word copy; its text is fixed in §3.2 and transcribed by P1 to `content/landing.md` | E1, on the lead's brief |
| 2026-10-02 | S2 §1's corrected paragraph is carried as P1 with three edits, each from S2 itself (§4.7 item 1) | E1, on the lead's brief |
| 2026-10-02 | The learning sentence never says "from day one" without the recording condition; P4 everywhere, P5 in (c) and (d) (§4.7 item 4) | E1, on the lead's brief |
| 2026-10-02 | The cover rule is S3's candidate, adapted: American spelling, "the brand's" for "your", and "gives its reasons" for "writes down why", because a receipt is recorded only under the conditions in P5, while every answer carries its reasons | E1, on the lead's brief |
| 2026-10-02 | Three of S3's rule sentences are not used: "ODP is the memory; the edge is the reflex" (S2 §7.3: the decision reads no ODP data), "They score people; we decide pages" (it describes another system), and "This initiative is about the other 90 percent" (the share is not in S2) | E1, on the lead's brief |
| 2026-10-02 | The Opal rule, "The engine decides. Opal creates and explains.", is kept as the boundary rule, with "Opal is not connected to the engine today." beside it (S2 §6.2) | E1, on the lead's brief |
| 2026-10-02 | The demo map leads with Vantage and Top Offers; Meridian and The Bright Hour are labeled as the older pipeline; the bank demo, the storefront built for one customer and OH are not shown as the engine | E1, on the lead's brief |
| 2026-10-02 | The preflight widens on purpose: the package name once per page instead of once per site, `https` links to an allowlist, and the chrome present on every page (§7). The landing page's earlier working string in `#package-name` is replaced by the name | E1, on the lead's brief |
| 2026-10-02 | Figures are inline SVG, themed through classes, with a PNG beside each for Word, so a page stays one request and needs no change to the image policy | E1, on the lead's brief |
| 2026-10-02 | Links between pieces, to demos and to the site use full addresses, so they work in Word too | E1, on the lead's brief |
| 2026-10-02 | Vocabulary: interest (affinity for engineers); receipt (never explain record); learning dial (not trust dial); visit band (not bucket); regional fallback and pooling levels (not ladder); journey stage the only stage, and no "phase"; context (cell for engineers); customer deployment (stamp for engineers); visitor (shopper in retail examples); the engine's catalog is content, never products (`GLOSSARY.md`) | E1, on the lead's brief |
| 2026-10-02 | The document cache's lifetime is never quoted, because it reads as a propagation promise the kit does not make; "in force without a software release" instead (§4.3) | E1, on the lead's brief |
| 2026-10-02 | Word file names carry their version and no package name; superseded versions are removed by the lead, never by a lane | E1, on the lead's brief |
| 2026-10-02 | **Module order and page layout, per S2 §10.4.** On the phone page the engine decides the module order: `pdp-modules` is a normal slot (Built). On the homepages the engine decides what is inside each slot, while the demo page's own script places the slots from a template standing in for the customer's CMS (Demo only). Per-context layout configuration stays Designed. Applied as rows D19 (Built) and D16 (Designed), paragraph P10, the glossary's module entry, the demo map's Vantage and Top Offers lines, and a never-say row; §4.8 item 1 is settled. C1 adds D19 to (b) | lead, on S2 §10.4 |
| 2026-10-02 | The shared credits page is filed at `docs/enablement/research/opal-ai-credits-placement.source.html`, and C2 reads it there | lead |
| 2026-10-02 | **The site moves to a new worker,** `edge-platform-bti`, at `https://edge-platform-bti.expedge.workers.dev`, because Cloudflare Access's one-time email codes did not reach the owner. A passphrase gate in the worker itself protects it (lane E2): one passphrase held as a worker secret, a signed seven-day cookie, failed attempts slowed, nothing served without it. Temporary, until the material moves inside Optimizely and the Microsoft sign-in takes over. Page addresses carry no trailing slash. The Cloudflare Access entries above stay as history | owner's instruction after the one-time codes failed to arrive |
| 2026-10-02 | Because no script holds the passphrase, pages are proven as built files before a deploy, and an outside check after it proves that no address serves content without the passphrase; whether a script may ever hold it is the owner's decision (§11). This replaces the earlier service-token question | lead |
| 2026-10-02 | **A status page, piece (h),** "What is built, designed and open" (`content/status.md`, lane C3), for anyone at Optimizely who must know what may be claimed today, with the rule "Claim only what is Built; name what is Designed; say what is Open", S2 §10's tables once for the whole package and the stamp "Engine facts as of commit 8b4f74c". Like the glossary, it serves every reader and tells no example story; its session tables carry a caveat column. (d)'s B.8 becomes a ten-row summary linking to it (§3.10) | lead |
| 2026-10-02 | **Piece (d) as accepted:** its file `content/how-it-works-and-where-it-runs.md`; its rule "Every setting that can change an answer lives in a published, versioned document; the engine does the arithmetic at the edge, calls no AI model to decide, and shows its work on a receipt."; its headings as written, in Part A and Part B; D1's figures `architecture` and `decision-path`, captioned with their SVG titles; a walk of about 1,250 words and a detail of about 2,200 words of prose plus tables; P2's section kept, P10 verbatim in A.8's table, and P5 to P8 in its own words. §3.5 describes it as built | lead |
| 2026-10-02 | Six rows from lane C3 join the master list so that S2 §10.1 is there in full, each with S2 §10.1's verdict: B14 tenancy and isolation (Built), B15 design-time tagging (Built, off by default), B16 Opal authoring and explanation (Open), D20 the census figures (Built, demo only), D21 the anchor product (Built, not yet on a hosted demo), D22 paid-search classification (Built, the classification only) | lead |
| 2026-10-02 | The figures are D1's three, `architecture`, `decision-path` and `before-during-after` (the credits page's), each captioned with its SVG title; the session strip, the seam and the credits page's two scaling lines are not drawn in this release; the credits page's verdict words follow D1's figure (§3.6, §3.9) | E1, reconciling with lane D1 |
| 2026-10-02 | Links show a page's title and carry its address as their target, because the site's host name carries the abbreviation that §2 keeps out of visible text (§2, §6) | E1, from lane C3's practice |
| 2026-10-02 | **The pages as built** (lane P1), described in §3, §5, §6 and §7. Eight pages, built by `enablement/render-pages.mjs` and checked by `enablement/render-check.mjs`, which replaces the planned `check-text.mjs`. They share one stylesheet `/site.css` and one script `/site.js`, progressive enhancement only, under `style-src 'self'; script-src 'self'; img-src data:`, so each page makes a few same-origin requests instead of one. The footer line is "Internal · Optimizely · do not forward outside Optimizely". The landing page runs to about 290 words, with each card's piece rule. The session figure is a Before / During / After switcher on (b) and static on (e). The demo map renders §3.8, with its three additions marked. Every word not in a source is marked as an addition | lead |
| 2026-10-02 | **The credits page's corrected source** is kept as `docs/enablement/content/credits-source.html`. Corrections make false statements true, with the design's labels; the structure, order, devices and voice stay. The original stays filed in `research/` (§3.6) | lead (ruling) |
| 2026-10-02 | **Deployed and verified:** `edge-platform-bti` version `8388fa81` from commit `8086cb1`. Outside checks: 302 to `/auth` with no session, 401 for a wrong passphrase, 303 with the session cookie for the right one, 200 with it, 404 for an unknown address, 302 for a forged cookie (§7) | lead |
| 2026-10-02 | **After review round one** (`lanes/R.md`): **piece (b) is accepted as built**, with the review's edits applied (option 1). Its rule, sections and noun-phrase headings are C1's. §3.3 describes it, and the review's structural items S-b1 to S-b6 are waived on this record | lead |
| 2026-10-02 | **Piece (c) is rebuilt to §3.4,** with the review's edits applied where they still apply (option 2); its demo table moves to the demo map | lead |
| 2026-10-02 | **"What it is not" is allowed:** a piece may contrast classes of system, phrased as what the engine does instead, never naming a product or vendor, with the other class's own word allowed once (§5). In (b) this replaces R-b1's deletion | lead |
| 2026-10-02 | **A real product brand may be an example dimension value,** as in "brand = samsung" (review L-d1 and L-f1); the glossary keeps its examples | lead |
| 2026-10-02 | **In (d):** the code-path column stays, headed "Where in the code (for engineers)"; the latency documents are not linked; engineering documents are named only by their paths, and only by paths without customer names; "GA4" stays only with its trace (review L-d2 to L-d5, §3.5) | lead |
| 2026-10-02 | **Cross-piece references are real links,** never italic titles alone (§6) | lead |
| 2026-10-02 | From review round one: the glossary's Outcome entry names the two fixed partner outcomes, a pickup at a partner store and a referral to a partner retailer, instead of "an outcome the brand names" (R-f1, S2 §3.15); Designed takes the legend's words (R-f2). The design's defects are fixed: D-2 in §3.9, D-3 in §3.0, D-4 in the color-legend entry above, D-5 in §1, D-7 by the two entries on (b) and (c). D-1 was fixed earlier. D-6 is the common brief's, the lead's file: its address is fixed, and "personalised" and "trust dial" remain | E1, from review R |
| 2026-10-02 | **The demo map** is titled "which demo to show to whom", and its source is `content/demos.md`, which P1 wrote from §3.8 as revised at 14:08, with its three additions marked. **The credits page's Word copy** is built from `content/credits.md`, the same text as `credits-source.html` in markdown (§3.6, §3.8, §6) | lead |
| 2026-10-02 | **Credit verdicts are words.** The session figure keeps one legend, Built, Designed and Open, and gives each card's credit verdict as bold words at its top, with no fill and no second legend. The credits page's credit tags follow the same rule, and P1 aligns the page's chips on the next render (§3.6, §3.9) | lead |
