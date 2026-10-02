# The enablement package: design and build brief

**Internal. Design and build brief.** Opened 2026-10-02 by lane E1 for the lead. This is the governing document for the enablement package: every lane reads it after `LANE-BRIEF-COMMON.md`, and every deviation is recorded in §12 before it ships. The three research lanes landed on 2026-10-02 and are folded in: S1 (`research/S1-inventory.md`, what exists), S2 (`research/S2-engine-facts.md`, the only source of engine facts, pinned to code commit `8b4f74c`) and S3 (`research/S3-naming-and-narrative.md`, the name and what has worked).

Companions: `LANE-BRIEF-COMMON.md` (the law), `GLOSSARY.md` (the package's one glossary, and the glossary page's source), `README.md` (the folder map).

Where this document and the common brief differ, the common brief governs and the difference is a defect in this document; §12 records every place this document settles something the brief left open.

---

## 1. Purpose and audiences

**What we are making.** An internal enablement package that explains the engine to three Optimizely audiences who are not engineers: marketing, account executives (AEs) and pre-sales solutions engineers (SEs). It is published on the internal site `https://edge-platform-enablement.expedge.workers.dev`, behind a Cloudflare Access sign-in for @optimizely.com emails (§7), and every piece except the landing page also exists as a Word document for sharing in Teams. We provide the content; the receiving teams decide how they present it. There are no slide decks.

**Why now** (S1 §6). Nothing in the repository is at once plain, current and customer-neutral. There is no single name, glossary or set of numbers. Several field statements no longer match the code. Almost nothing explanatory is hosted. The facts exist, scattered; S2 now holds them in one place. S1 §4 lists twelve gaps; the package closes each:

| S1 §4 gap | Closed by |
|---|---|
| 1. A plain, current "what is it" page | (b) What it is |
| 2. Where it runs, and the stack | (d) How it works and where it runs |
| 3. How it is configured, for a non-engineer | (c) "Who sets what"; (d) the documents section |
| 4. Built against designed, as a status ladder | The rows in §3.1, carried by (b), (c) and (d) |
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
| Solutions engineer | Semi-technical; explains concepts and brings an engineer when it gets deep | How a decision is made, where it runs, what a customer provides | The walk, the arithmetic at published constants, the stack, the honest open items | Code paths, deploy commands |

**One reader per piece.**

| Piece | Reader | Source | Page | Word copy |
|---|---|---|---|---|
| (a) Landing page | An Optimizely colleague choosing what to read | `content/landing.md` | `/` | none (§12) |
| (b) What it is | A marketer | `content/what-it-is.md` | `/what-it-is/` | `word/What-It-Is-v1.0.docx` |
| (c) Selling it | An account executive | `content/selling-it.md` | `/selling-it/` | `word/Selling-It-v1.0.docx` |
| (d) How it works and where it runs | A solutions engineer | `content/how-it-works.md` | `/how-it-works/` | `word/How-It-Works-v1.0.docx` |
| (e) Where Opal and AI credits fit | An account executive who quotes | `content/credits.md` | `/credits/` | `word/Where-AI-Credits-Fit-v1.0.docx` |
| (f) The glossary | A marketer; every entry holds for the other two | `GLOSSARY.md` | `/glossary/` | `word/Glossary-v1.0.docx` |
| (g) The demo map | An account executive | `content/demo-map.md` | `/demos/` | `word/Demo-Map-v1.0.docx` |

Paths in this table are relative to `docs/enablement/`; pages are addresses on the enablement site.

---

## 2. The name and its conditions

**The name: Behavioral Targeting and Intelligence.** It is the working name of the package and of the offering. A piece writes it in full on first use and says "the engine" afterwards. The spelling is American. "BTIE" is never used: it is the title of a customer's own paper. The abbreviation "BTI" appears in no piece and in no file name a reader sees. "Intelligence" means counted learning behind a dial, never AI.

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

Every piece except the glossary follows this shape. The glossary's exceptions are in §3.7.

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
| C | A visitor's behavior sets their interests. The brand's team sets the rules. The engine ranks what is left, and gives its reasons. | (a), (b) as the rule | §3.3 to §3.4, §3.9 to §3.12, §3.14 |
| P1 | The engine decides which of the brand's own content each visitor sees, and in what order. For every visitor who has agreed to it, it keeps a graded, fading interest in each value of each dimension the brand chooses to score on, built from what they do on the site. When a page asks, it ranks the brand's own published content for each slot on the page against that interest, leaning, where the brand turns it on, on what their region is interested in until they have shown interests of their own. It answers with the brand's own content ids in order, each with the reasons that placed it there. It runs on Cloudflare's network, calls no AI model to decide, and every setting that can change an answer lives in published, versioned documents that the brand's team changes without a software release. | (b), (c), (d) | §1, edited as §4.7 item 1 records |
| P2 | The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open. | (b), (c), (d); (e) as its summary | §6.1 to §6.3 |
| P3 | Nothing is personalized or recorded until the site passes the visitor's explicit consent choice. Without it, the visitor sees the site's own defaults. | (b), (c), (d) | §3.2 |
| P4 | Learning is built, and it changes nothing until a person raises the learning dial. | (b), (c), (d) | §5.2 |
| P5 | Receipts, outcomes and learning counts are recorded only with the visitor's consent. A page that asks the engine directly is recorded; with the SDK as shipped, a slot is recorded only when it is set to count rendered pieces and durable recovery is on, and no configuration has it on yet. | (c), (d) | §3.15, §5.1 |
| P6 | The site sends events and asks for decisions. The engine answers with the brand's own content ids in order, each with its reasons. The site renders them, and renders its own defaults whenever the engine is silent. | (b), (c), (d) | §1, §7.1, §7.7 |
| P7 | It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons. | (b), (c), (d) | §1, §6.1, §3.14 |
| P8 | Each customer gets its own deployment on Cloudflare's network, one per environment, with its own storage. The workflow that sets one up stops before the customer's first configuration; that step, the ODP and Feature Experimentation connectors, measurement on the SDK, retention periods and the billing meter are open. | (c), (d) | §0 Stamp, §10.2, §10.3 |
| P9 | ODP, Feature Experimentation and Opal are not in the decision path, and none is connected to it today. | (b), (c), (d) | §6.2, §7.3, §7.4 |
| P10 | For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step. | (b), (c), (d), (g) | §10.4 item 4 |

**Word budgets** (S1 §3: a read-alone piece stays under about 2,200 words). (a) under 200. (b) 1,200 to 1,800. (c) 1,800 to 2,400. (d) the walk up to 2,200, the detail up to 2,800. (e) up to 1,600. (f) as needed. (g) up to 1,100.

### 3.1 The rows: before, during and after the session

One master list. A piece copies the rows it carries (the last columns), keeps the wording, and may shorten a row only by dropping a clause, never by changing a verdict. The S2 column is for the lane note and the review, never for the piece's prose.

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

- **Reader:** an Optimizely colleague choosing what to read. **Owner:** P1. **Source:** `content/landing.md`, transcribed from the text below. **Address:** `/`. **Word copy:** none.
- **Rule:** paragraph C, as the lede and again as the last line above the footer.
- **Text, in order, verbatim:**
  1. `h1`: the name, in `#package-name`.
  2. The lede: paragraph C.
  3. The sign-in note, kept from lane E0: "This site is for Optimizely employees; you were asked for your Optimizely email to open it."
  4. `## Each page is written for one reader`, then three cards:
     - "For marketing", linking to "What it is": "What the engine does before, during and after a visitor's session, and the words to use about it."
     - "For account executives", linking to "Selling it": "What is built, designed and open, the questions customers ask, and the sentences to say and never to say."
     - "For solutions engineers", linking to "How it works and where it runs": "How a decision is made, where it runs on Cloudflare's network, and what a customer provides."
  5. `## Three references serve every reader`, then three links:
     - "Where Opal and AI credits fit": "Where AI and its cost live, and the sentences that settle the question."
     - "Glossary": "One word for each meaning, defined once."
     - "Demo map": "Which demo to show, to whom, and what each one proves."
  6. Paragraph C again.
- **Figures:** none. **Rows:** none. The legend and the version stamp come with the chrome (§7).

### 3.3 (b) What it is, for marketing

- **Reader:** a marketer. **Owner:** C1. **Source:** `content/what-it-is.md`. **Address:** `/what-it-is/`. **Word copy:** `word/What-It-Is-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: what it is`
- **Rule:** paragraph C.
- **Sections, in order** (headings verbatim):
  1. No heading: the reader line ("For marketing.") and the rule.
  2. `## One visitor shows what it does`: the example. A stranger arrives from an ad for one product; the page answers how they arrived and where they are; they look at something else; the page follows them; they leave, and their session is counted. No numbers and no customer. It may close by naming Vantage as the hosted demo where this can be seen, with its address.
  3. `## The engine in one paragraph`: P1 verbatim.
  4. `## Before the visitor arrives, the brand sets the rules`: rows B1, B2 (without its last clause), B3, B4, B5, B7. Figure F1 sits above this section's table, with a one-sentence lead.
  5. `## While the visitor browses, the engine ranks what is left`: rows D1, D2, D3, D4, D5 (first sentence), D8, D19, D14.
  6. `## After the visitor leaves, the engine counts what worked`: rows A1 (first sentence, ending "once recording is switched on"), A2, A4, A5. Then: "The one exception to keep straight: learning is built, and it changes nothing until a person raises the learning dial."
  7. `## The name has two halves`: behavioral targeting is the rules and weights the brand's team writes, in force without a software release; intelligence is counted learning behind a dial, never AI; and the name is not the behavioral targeting in other Optimizely products. The full name is not repeated here.
  8. `## Where AI and credits fit`: P2, and the credits page's address.
  9. `## What it does not do`: these sentences, verbatim. "It calls no AI model to decide." "It does not paint the page; the site renders what it is sent." "It does not need to know who the visitor is." "It reads no device detail beyond the operating system family of the visitor's phone." "It never stores the visitor's account id." P9.
  10. `## Words to use, and words to avoid`: the lists below.
  11. The rule again.
- **Figures:** F1.
- **Sentences to say:** C; "It works for visitors nobody has identified, from their first event, once they have consented."; "The brand's rules come first; the engine ranks what is left."; "Every answer carries its reasons."; P7's first clause; "Interest builds with what the visitor does and fades with time."; P4; P10; "Every setting is published and versioned, and changes without a software release."
- **Never say, beyond §4.9:**

| Never say | Say instead |
|---|---|
| "AI-powered personalization" | "Personalization that calls no AI model to decide." |
| "It reads their mind", "it knows what they want" | "It counts what the visitor does." |
| "One-to-one in real time" | "In the visitor's session, from their first event." |
| "A recommendations engine" | "It ranks the brand's own content for each decided place on a page." |

- **Built, designed and open content:** all Built except as the rows say; the exception is A5.

### 3.4 (c) Selling it, for account executives

- **Reader:** an account executive. **Owner:** C2. **Source:** `content/selling-it.md`. **Address:** `/selling-it/`. **Word copy:** `word/Selling-It-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: selling it`
- **Rule:** "Sell what is built, label what is designed, and promise nothing that is open."
- **Sections, in order:**
  1. No heading: "For account executives." and the rule.
  2. `## One visitor, three moments`: the example in three to five sentences, before, during and after.
  3. `## What you are selling fits in one paragraph`: P1, then: "Write its name in full the first time, then say the engine. It is not the behavioral targeting in other Optimizely products."
  4. `## What is built, designed and open, in the visitor's order`: figure F1 with a one-sentence lead; three tables. Before: B1 to B9, B11, B12. During: D1 to D6, D8 to D10, D13, D14, D19, D16. After: A1 to A9, A11, A13. Then: "The one exception to keep straight: everything after the answer depends on recording. With the SDK as shipped, recording is not switched on yet, because it needs each slot set to count rendered pieces and durable recovery, which no configuration has."
  5. `## The customer provides these, and here is what each is for`: S2 §7.7 with three columns, `What we need`, `What we use it for`, `Who provides it`, every row stating both the need and the purpose. Figure F2 above it, with a one-sentence lead.
  6. `## Who sets what`: a table. The brand's team in the console: weights, pins, windows, rules, take, the learning dials, the holdout share. The brand's team through the API, without a release: the catalog, arrival seeds, dimensions and their sources, journey thresholds. An engineer: tenants, keys, allowed origins, retention, where visitor state lives (S2 §4.5, §4.6).
  7. `## The questions customers ask have true answers`: the answers below, each two or three sentences, verbatim unless the review finds a fault.
  8. `## Where AI and credits fit`: P2, and the credits page's address.
  9. `## Bring a solutions engineer when the question is how, not what`: architecture and the stack; the arithmetic; integration and the events; data, privacy and retention detail; any question this page answers with "open".
  10. `## Sentences to say, and sentences never to say`.
  11. The rule again.
- **Figures:** F1, F2.
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

- **Reader:** a solutions engineer. **Owner:** C3. **Source:** `content/how-it-works.md`. **Address:** `/how-it-works/`. **Word copy:** `word/How-It-Works-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: how it works and where it runs`
- **Rule:** "The unit of state is the dimension value, not the click." (S2 §3.4: what is stored is, per dimension and value, a raw score and the time of the last touch.)
- **Shape:** a walk that a reader can stop after, then the detail. Each walk section ends with a link to its detail ("The detail: …"), and each detail section opens with a link back ("Back to the walk: …"), using in-document links (§6). Greek letters stay off the first screen and are defined at first use.
- **The walk, in order:**
  1. No heading: "For solutions engineers." and the rule.
  2. `## One product view becomes several interests`: the example. A view of a product tagged with a brand, a category and a price band produces three touches; each adds the view's weight to that value's raw score; interest is the raw score divided by itself plus K. With each view weighted 1, at the default K of 1.8: 0.357, then 0.526, then 0.625 (S2 §3.4, with the weight stated, §4.7 item 3). Figure F3 above the section's arithmetic, with a one-sentence lead.
  3. `## Interest is counted, and it fades on a memory the brand sets`: the memory τ is a time constant, not a half-life; the default is 14 days, the cap 90, the production value open; a demo's much shorter memory is compressed for the room and never the default; the entry and exit lines, 0.6 and 0.45; time alone can take a visitor out of an audience, never put one in (S2 §3.4, §3.17).
  4. `## A stranger starts from how they arrived and where they are`: seeds; the regional prior and λ, 1 for a stranger; the regional fallback; the region's one-day memory and its counts with no visitor ids; demos seed synthetic regional data and label it; in a demo the opening region is the visitor's real one (S2 §3.6, §3.11).
  5. `## The brand's rules come first, and the score ranks what is left`: eligibility, pins, exclusions, off limits, then the score and its adjustments in order; the diversity cap; the pin that empties its slot, said once (S2 §3.9 to §3.12).
  6. `## Every answer carries its reasons, and the receipt carries the arithmetic`: the drivers on the answer; what a receipt records and what it does not; the four strongest tag terms; replay exact for one slot; operators read receipts (S2 §3.14).
  7. `## Learning counts what worked and moves nothing until the dial is raised`: lift per piece per context, the pooling levels, the counts' 21-day memory, the dial at 0, holdouts, exploration off. Then the one exception: P5, with the reason in one sentence (the SDK's snapshot is a read-only offer; a rendered slot records only when the page acknowledges the paint, which needs durable recovery) (S2 §3.13, §3.15, §5).
  8. `## Every setting is a published document, and three kinds of people change them`: the four documents and the two others; the console; the API for what has no screen; the engineer's settings; revisions and rollback (S2 §4).
  9. `## It runs on Cloudflare's network, one deployment per customer environment`: figure F4 with a one-sentence lead; the stack in plain words; visitor state on the session host today; P8; the demo workers are separate from any customer deployment, and the enablement site runs no engine code (S2 §2).
  10. `## The customer provides the content, the events and the consent`: S2 §7.7 summarized, with need and purpose in every row; what stays the customer's: rendering, sign-in and the identity proof, the content source, the commerce platform (S2 §2.7 boxes B1 to B4). Figure F2 here.
  11. `## Privacy and security are built in, and retention periods are open`: consent; what is stored and never stored; tenant isolation; the site key and the shopper capability; the salted identity; erasure bounded; retention periods open (S2 §8).
  12. `## Bring an engineer when the question leaves this page`: the triggers.
  13. `## Where AI and credits fit`: P2, and the credits page's address.
  14. `## Sentences to say, and sentences never to say`.
- **The detail, in order** (each heading starts "The detail:"):
  1. `## The detail: interest is arithmetic anyone can check`: the update on an event, the read, entry and exit, the closed-form exit time, the defaults table, the worked numbers with the weight stated (S2 §3.4, §3.17).
  2. `## The detail: the score adds its terms in a fixed order`: S2 §3.11's terms in order, the withdrawn external term named as switched off by policy, and the holdout arms (S2 §3.11).
  3. `## The detail: a receipt holds what was served and why`: S2 §3.14, what it records and what it does not, and who reads it.
  4. `## The detail: four published documents hold every setting`: S2 §4.2.
  5. `## The detail: each part of the stack has one job`: S2 §2.2 to §2.4 in plain words, with the Cloudflare names (Worker, Durable Object, KV, R2, D1, queue) defined at first use.
  6. `## The detail: integrations are built, off by default, or open`: the SDK, product re-ranking, typed search, ODP, Feature Experimentation, warehouse and history, each with its verdict (S2 §7).
  7. `## The detail: the limits in the code are budgets, not capacity`: S2 §9.3, labeled exactly so.
  8. `## The detail: the full list of what is built, designed and open`: every row marked for (d) in §3.1.
  9. The rule again, as the last paragraph of the piece.
- **Figures:** F2, F3, F4.
- **Numbers it may quote:** the published constants in S2 §3.17 and the worked arithmetic in S2 §3.4 (with the weight stated); the limits in S2 §9.3, labeled "budgets in the code, not measured capacity". Never a timing, and never a cache lifetime presented as how fast a change reaches visitors (§4.3).
- **Sentences to say:** the rule; P6; P7; P5; P8; P10; "Every term on a receipt is one the engine computed; nothing is inferred by a model."; "The brand's rules come first; the engine ranks what is left."
- **Never say, beyond §4.9:**

| Never say | Say instead |
|---|---|
| "A stateful object per visitor" (as today's deployment) | "Visitor state lives in a KV record on the session host; the object host is built and held back by a known finding." |
| "The answer is cached" or "changes propagate in 30 seconds" | "A save is in force without a software release; no propagation time is promised." |
| "The receipt itemizes every term" | "The receipt lists the four strongest tag terms and every adjustment; weaker tag terms are inside the base score." |
| "The census drives the cold start" | "Census figures are shown in one demo, never scored; the cold start reads the arrival and the region's own counts." |

- **Built, designed and open content:** as the rows say; the exception is A1.

### 3.6 (e) The credits page, standalone and restyled

- **Reader:** an account executive who quotes the engine alongside Opal. **Owner:** C2. **Source:** `content/credits.md`. **Address:** `/credits/`. **Word copy:** `word/Where-AI-Credits-Fit-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: where Opal and AI credits fit, and where they never do`
- **Rule:** "The engine decides. Opal creates and explains." It is followed at once by: "Opal is not connected to the engine today." (S2 §6.2.)
- **Source material.** `docs/Opal-Credit-Boundary-Pricing-Guide.md`, and the page that was shared, which adds two sections (the two scaling lines; the order-form map) and the takeaway lines (S3 §2.1). The lead has filed the shared page at `docs/enablement/research/opal-ai-credits-placement.source.html`; C2 reads it there.
- **What stays.** The page's structure and devices, in S3 §2.3's order: one question in the title; one reader; the rule, boxed, first; the session's three parts as the spine; a verdict on every row; a takeaway per part; one picture of the consequence; three lines and three meters, never blended; three sentences to say; the questions that come up; the order form; the rule again, last.
- **What changes, and only this** (each change forced by S2 or the voice):
  1. The inline sentence under the rule (above).
  2. "Opal creates audiences in ODP" goes: no Opal integration is wired, and the demo stand-in creates audiences elsewhere (S2 §6.2, Appendix A).
  3. "Discovery proposals (stage 3)" goes: automatic proposals are switched off by policy (S2 §5.6), and "stage" belongs to the journey.
  4. "CMAB serving decisions" either goes or is defined as a Feature Experimentation capability outside the engine (S2 §7.4); "Analytics via OptiAnalytics" goes, because S2 does not hold it.
  5. The traffic example with session counts becomes "However much a customer's traffic grows, its credit use does not move with it." (no figures, §4.3).
  6. The two scaling graphs are redrawn by D1 as F5, without numbers; the platform meter's line is labeled Designed, because no usage meter exists in the code (S2 §6.3).
  7. The order-form section describes the lines as the pricing guide does, labeled Designed, with "rates and packaging are monetization's decision" labeled Open; ODP and Feature Experimentation are their own licenses, outside the decision path, and the word "memory" for ODP goes (S2 §6.3, §7.3).
  8. **One color legend.** The original colors its rows by credit verdict. On this page the package's one legend (Built, Designed, Open) keeps its colors, and the credit verdicts become words in a column of their own: "Credits apply", "No credits", "Per use". No second color legend (§12).
  9. The voice: no dash in the title, "and" for "&", American English, "receipt" for "explain record", headings as statements.
- **Sections, in order:**
  1. No heading: the reader line ("For account executives who quote the engine with Opal.") and the rule, with its inline sentence.
  2. `## Every touchpoint falls before, during or after the visitor's session`: three tables with columns `Touchpoint`, `Credits`, `Verdict`; a takeaway sentence under each. The one exception to keep straight, under "During": shopper-facing AI features are metered per use as designed; typed search is built and off by default, and the advisor and generated imagery are demo only (S2 §6.3).
  3. `## The consequence is two lines`: figure F5, with a one-sentence lead.
  4. `## Three revenue lines, three meters`: the platform, Opal credits and shopper-facing AI features, each Designed, with its meter as described; "Never blend the platform meter with credits or AI features." (S2 §6.3 guardrails).
  5. `## Three sentences settle the AI-cost question`: from the original, checked against S2.
  6. `## The questions that come up on every deal`: the original five, each answer checked against S2.
  7. `## The order form, line by line`: as change 7 says.
  8. The rule again.
- **Summary carried into (b), (c) and (d):** P2.
- **Figures:** F5.

### 3.7 (f) The glossary page

- **Reader:** a marketer, the least technical reader; every definition also holds for an account executive and a solutions engineer. **Owner:** E1 (`GLOSSARY.md`). **Renders it:** P1. **Address:** `/glossary/`. **Word copy:** `word/Glossary-v1.0.docx`, built by W.
- **Rule:** "One word for each meaning, defined once, in plain words."
- **Sections:** the reader line; the rule; `## How to read it`; one `##` section per letter; the rule again.
- **Where it departs from §3.0, on purpose:** its source sits at `docs/enablement/GLOSSARY.md`, not under `content/`, because the lead assigned that path; it has no session tables, no example and no never-say table, because it is the reference every piece points to; its letter headings are labels, not statements.
- **On the page:** P1 gives each entry an `id` made by the GitHub anchor rule from the term, with any bracketed symbol dropped (so "Learning dial (γ)" is `learning-dial`), so a piece's page can link to `/glossary/#learning-dial`. Deprecated entries may be styled differently; their text is unchanged.
- **Changes:** a lane that needs a term the glossary lacks asks E1, or the lead once E1 has closed. Content lanes adopt the glossary's words; a deprecated word in a piece is a review failure.

### 3.8 (g) The demo map

- **Reader:** an account executive. **Owner:** C2. **Source:** `content/demo-map.md`. **Address:** `/demos/`. **Word copy:** `word/Demo-Map-v1.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: which demo to show, and to whom`
- **Rule:** "Choose the demo by the question your customer is asking, and show today's engine on Vantage or Top Offers."
- **Facts:** the demos' addresses, rooms and beats come from `docs/demos/BOOTSTRAP.md` §2, §3, §5 and §6 and S1 tables F and I, by the lead's ruling; every statement about the engine inside it still traces to S2. No demo is described by the customer it was built for; a vertical ("a carrier's online shop", "a retailer's promotions module") is enough.
- **Sections, in order:**
  1. No heading: "For account executives." and the rule.
  2. `## Two demos run today's engine`: a table with columns `Demo`, `Address`, `The question it answers`, `What the room sees`, `What it never claims`.
     - **Vantage**, `https://edge-platform-vantage.expedge.workers.dev/vantage/`. Question: what can the engine do for a visitor nobody has identified, from the first click? Sees: a carrier's online shop in which a stranger is served from the first paint on how they arrived and their region's synthetic sales; the page following them away from the ad; a phone page whose modules below the buy box the engine orders for them as they browse, while the buy box stays off limits; a merchandiser's pin and availability rule shown as overrides; receipts behind every card. Never claims: any decision on price, financing or credit; anything geographic beyond availability; a reorder when an interest fades; a lift number; that the engine places the homepage's areas, which the page's own template places, standing in for the customer's content system (demo only).
     - **Top Offers** (on screen, Lantern & Lane), `https://edge-platform-top-offers.expedge.workers.dev/top-offers/`. Question: can the merchandiser keep control while each visitor earns their own offers? Sees: a retailer's four-container promotions module filled from a pool; the visitor earning it; a merchandiser's day of real, versioned publishes (a window closing, a new promotion with no history, a weight, a pin); a weather and location rule; the module moved on the page by the page's own template, standing in for the customer's content system, while its four promotions stay the engine's (demo only); the click report, labeled attribution. Never claims: products (the pool is promotions); incrementality; a lift number; that the engine moved the module.
     - Under the table, P10, so the room's "the page rearranges itself" is said exactly.
  3. `## Two older demos show one idea each, on the older pipeline`: the same columns.
     - **Meridian** (on screen, Calder), `https://edge-platform.expedge.workers.dev/meridian/`. Question: does it work across industries, and whom does the page believe, the ad or the visitor? Sees: one brand, two businesses, with a live swap from retail to a bank; the hinge from the advertised product to what the visitor looks at; an interest fading out while the presenter waits, which the page shows on its own timer as the engine's decay re-asked, never as a pushed alarm.
     - **The Bright Hour**, `https://edge-platform.expedge.workers.dev/live/`, with its Offer Desk at `/live/ops`. Question: what about offers that live for hours? Sees: a live-shopping retailer deciding under expiry; a new offer born and ranked with no history; an item selling out mid-session; receipts.
     - One shared line under the table: "Both run Generation 1, the older demo pipeline, at an older version of the code. Their memories are compressed to seconds for the room, and their AI chat and experiment screens are demo seams, not the engine."
  4. `## Engineers who saw a demo can move the numbers themselves`: Vantage's interactive explainer, `https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works`, for a customer's engineers or an SE: every constant on a slider, recomputed in the browser, naming no customer.
  5. `## Three things are not for showing as the engine`: First National Bank (`/visual-demo` on the shared worker) shows the 2025 platform, not this engine; the storefront at `/storefront` on the shared worker was built for one customer with its own brand and products and is never shown to another; OH, a home-appliances demo, is scaffolded and not yet hosted. The page at `/` on every worker is the 2025 dashboard, not the product.
  6. `## Before you show a demo`: open it from where you are, because the region on screen is the request's real one, and any other region is asserted by a press and labeled; regional data in the demos is synthetic and labeled; Vantage shows real phone makers' product images, and legal confirms before any public or recorded use; Vantage's regional data has a one-day memory and is reseeded before a showing, so ask the demos' owner (Simone Coelho) before a customer sees any demo.
  7. `## A demo for your own customer is a restyle, not a rebuild`: a demo is a palette, a product feed and a set of beats on a shared kit; it takes the customer's colors and never its logo; it may show real names for the products the customer itself sells; an SE follows the demo kit's how-to (`docs/demo-kit/HOWTO.md`), and nothing is created in the cloud without the owner's approval.
  8. The rule again.
- **Figures:** none.
- **Never say, beyond §4.9:**

| Never say | Say instead |
|---|---|
| The customer a demo was built for | "A carrier's online shop", "a retailer's promotions module" |
| A demo's numbers as the engine's | "Measured on synthetic data, with memories compressed for the room." |
| "The AI chat is the engine" | "The older demos' AI and experiment screens are demo seams, not the engine." |
| "We can put Vantage's images in a public deck" | "Legal confirms before any public or recorded use." |

### 3.9 The figures, drawn once

| Id | File, under `docs/enablement/figures/` | What it shows | Caption, verbatim | Used in | Drawn from |
|---|---|---|---|---|---|
| F1 | `session.svg`, `session.png` | Three columns, before, during and after one visitor's session, each listing what happens in a few words, each item with its verdict chip | "Before, during and after one visitor's session: what the brand sets up, what the engine does, and what is counted." | (b), (c) | §3.1 rows |
| F2 | `seam.svg`, `seam.png` | Three lanes: the site (sends events, asks for decisions, renders, renders its defaults when the engine is silent); the engine on Cloudflare's network (keeps interests, applies the brand's rules, ranks, answers with content ids and reasons); the brand's team (publishes the documents). Arrows: events in; ids with reasons out; documents published | "The site sends events and renders; the engine decides; the brand's team publishes the rules." | (c), (d) | S2 §1, §2.7 arrows 3, 7 and 16 |
| F3 | `chain.svg`, `chain.png` | Five boxes, left to right: an event; touches on dimension values; the visitor's interests; a score for each piece; the slot's answer, in order, with reasons | "One event, from the page to the slot's answer." | (d) | S2 §3.3 to §3.12; the layout of `docs/verizon/explainer/figures/signal-chain.svg`, with neutral labels only |
| F4 | `architecture.svg`, `architecture.png` | The customer's side (the page and the SDK; the backend with sign-in; the content source; the commerce platform; the operator in the console); Cloudflare's network (the Worker; per-visitor objects; KV; region objects; learning objects; the queue; R2; D1; the scheduled jobs); optional outside services, off by default. Arrows: events; decisions; region counts; documents published; receipts and outcomes to the ledger; lift snapshots; content import; the sign-in proof; product re-ranking | "Where it runs: the customer's systems on the left, the engine on Cloudflare's network in the middle, and optional services, all off by default, on the right." | (d) | S2 §2.7 boxes B1 to B17 and arrows 1 to 22, simplified to at most 14 boxes and 12 arrows |
| F5 | `credits.svg`, `credits.png` | Two small charts over growing traffic, with no numbers: the platform meter rising with traffic, labeled Designed; AI credits flat | "As traffic grows, the platform meter grows with it as designed; AI credits do not move, because serving a page calls no AI model." | (e) | S2 §6.3 |

**Rules for every figure.** Drawn once by D1 as SVG; text as real `<text>` in the pages' system font stack; colors as presentation attributes for the light theme, plus classes that the page's stylesheet uses for the dark theme (D1 and P1 agree the class list); no `style` attribute, no `<style>` element, no script, no external reference, no embedded font or image; verdict chips in the legend's colors with the word on every chip, never color alone; labels in the glossary's words; no customer name, no timing figure, no number. A PNG at twice the drawn size goes beside each SVG for Word, rendered from the light theme. The caption is the markdown figure's caption, verbatim.

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

**The legend, verbatim, on every content page:** "Built: in the code and exercised. Designed: in an architecture document, not in the code. Open: no decision yet." Each label has one color, the same on every page and in every figure, chosen by P1 from the brand palette; every chip also carries its word, so the meaning never rests on color alone. In Word the label is the word, in bold, in the verdict column.

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
| "They score people; we decide pages", or any line about another system | Our own reasoning only | common brief |
| A customer, prospect or competitor name; a case study | No name; a vertical for a demo | common brief |
| A deprecated word | The glossary's word | `GLOSSARY.md` |

---

## 5. The design rules, and how each piece applies them

The common brief adopts S3 Part 2's first five rules as binding. Rules 6 to 10 apply where they fit; S3 §2.6's list of what to avoid applies everywhere.

| Rule | (a) Landing | (b) What it is | (c) Selling it | (d) How it works | (e) Credits | (f) Glossary | (g) Demo map |
|---|---|---|---|---|---|---|---|
| 1. One reader, named at the top | A colleague choosing | A marketer | An AE | An SE | An AE who quotes | A marketer, holding for all | An AE |
| 2. One rule first, the same rule last | C | C | "Sell what is built…" | "The unit of state…" | "The engine decides. Opal creates and explains." | "One word for each meaning…" | "Choose the demo by the question…" |
| 3. Before, during, after; a verdict per row; one exception | Not applicable: a choice of page | Tables; exception A5 | Tables; exception A1 | The walk follows the session; exception A1 | The original's three parts; credit verdicts as words; exception: shopper-facing AI features | Not applicable: a reference | Not applicable; every demo row carries "what it never claims" |
| 4. Sentences to say and never to say | §4.9 applies | §3.3 lists | §3.4 answers and lists | §3.5 lists | The original's three sentences | Deprecated entries | §3.8 list |
| 5. Examples before mechanism; instruments explained first | Cards say what each page gives | The visitor's story first | Three moments first | One product view first | The rule, then the session | Plain words before any symbol | The question before the demo |

**On the pages, rule 5 means:** a plain lead paragraph sits above every figure and every group of disclosures. Pages run no script (§7), so the only interactive elements are links and `<details>` disclosures.

**Rules 6 to 10** (S3 §2.5). 6, an FAQ of the questions that actually come up: (c) and (e). 7, a map of the order form, in the same color language: (e), labeled Designed and Open. 8, honesty in one ledger and confidence everywhere else: reconciled with the brief's "honesty inline" as one label on the row it qualifies, never a repeated caveat, with the never-say table as the ledger. 9, one word per meaning: the glossary. 10, no customer names, no judgement of anyone's system, no stale dates: every piece.

**What to avoid** (S3 §2.6): the point after a long sequence (every piece leads with its rule); terms never defined (every term at first use, and the glossary); instruments before explanation; one page for several readers; caveats on every screen; state carried across screens (none: no script); numbers that differ from the engine's; a stale structure, such as a ladder of offerings that cannot be skipped; several names for one thing; density.

**The voice** (the common brief's, restated so a lane has it in one place):

- **Gender neutral, everywhere** (owner's ruling, 2026-10-02). The visitor is "the visitor", or "they", "them" and "their", with the verb that "they" takes ("they arrive"). No piece, page, figure or Word copy matches the pattern `\b(she|her|hers|he|him|his)\b`, in any case, quoted lines and never-say tables included; lane R scans for it and fails a piece on any match (§9).
- Plain words; every term defined the first time; the glossary's words only.
- No customer, prospect or competitor name; demos by their fictional brands and their addresses.
- Honesty inline: one label on the row it qualifies; "synthetic" where data is synthetic; "designed, not built" where so.
- American English.
- Short sentences, one idea each; no em-dashes; headings are statements, except the glossary's letter headings.

---

## 6. Formats and the single-source rule

**One source per piece.** Each piece's source is one markdown file: `docs/enablement/content/<piece>.md`, and the glossary at `docs/enablement/GLOSSARY.md`. The page and the Word copy are renderings of that file. A change is made in the source first; the page is then re-rendered and the Word copy rebuilt. A Word file is never edited by hand.

**The markdown, written for both renderings.**

- `#` once, for the title; `##` for sections. The converter starts a new page at every `#` and lists `#` and `##` in Word's contents, so deeper headings are not used.
- Tables in pipe syntax with short cells; no ASCII diagrams; code fences only where a reader must see literal text, with lines of 76 characters or fewer (converter rules 1 to 3).
- Figures as `![caption](../figures/<name>.png)`, alone on a line; the page shows the SVG of the same name.
- Links within a piece as `[text](#heading-anchor)`, with GitHub's anchor rule: the heading's text without markup, lower-case, every character that is not a letter, digit, underscore, hyphen or space removed, each space a hyphen. A link to a missing anchor fails the Word build, by design.
- Links to another piece, a demo or the site use the full address (`https://edge-platform-enablement.expedge.workers.dev/selling-it/`), so they work in Word for anyone signed in, and on the page P1 may make the same-site ones relative without changing their text.
- No HTML in the markdown, no em-dash, American English.

**The Word copy.** Lane W builds each with the repository's converter, unchanged:

```
node scripts/md2docx.mjs <source.md> docs/enablement/word/<File>-v1.0.docx \
  "<the source's title line, verbatim>" "<Subtitle>" "<Prepared for>" \
  "1.0" "<Month D, YYYY>" "Internal: Optimizely only"
```

The subtitle is the reader and the facts stamp, for example "For marketing · engine facts as of commit 8b4f74c". "Prepared for" is the reader's team, for example "Optimizely marketing". The version is the bare number, because the converter prints its own "Version" label. File names carry no package name, so a rename does not rename files, and carry their version; when a new version replaces an old one, the lead removes the old file (lanes do not delete). The converter needs the `docx` package installed once per machine, outside the repository (its header says how); W uses an existing install and installs nothing.

**The page, a designed rendering of the same text.** Each content page wraps the piece in `<article data-source="docs/enablement/content/<piece>.md">` (the glossary names `docs/enablement/GLOSSARY.md`). Everything inside it is the source's text; everything outside it is the chrome in §7. P1 may choose any layout, type and color inside the brand, but may not add, drop or reword text inside the article. The figure's internal text sits inside an inline SVG and is outside the comparison; its caption is a `<figcaption>` and is inside it.

**The text check.** P1 writes `enablement/check-text.mjs`. For every page with a `data-source`, it extracts the article's visible text (tags removed, entities decoded, inline SVG skipped, whitespace collapsed, typographic quotes and apostrophes normalized), renders the source to text by the same rule (markup removed, a figure reduced to its caption, list markers and table pipes removed), and compares the two as word sequences. Any difference fails and prints the first place they diverge. It runs before every deploy, beside the preflight.

**Figures.** Drawn once by D1 under `docs/enablement/figures/` (§3.9). Pages embed the SVG inline, copied verbatim from the figure file, so a page stays one request and its dark theme reaches the figure through classes; the text check, or a separate step in it, confirms the inline copy matches the file.

---

## 7. The site

- **The worker.** `edge-platform-enablement`, at `https://edge-platform-enablement.expedge.workers.dev`, configured by `wrangler.enablement.toml`: assets only, serving `enablement/site/`, with no program, binding, variable or secret, preview addresses off, and a 404 page for unknown addresses (lane E0, `lanes/E0.md`). It shares nothing with the demo workers.
- **The sign-in: Cloudflare Access, in place since 2026-10-02.** The owner enabled it on the worker (Workers & Pages, the worker, Access, "Protect this Worker behind Access"): all traffic, one policy, "Email domain" `optimizely.com`, signing in by a one-time code emailed to the address. Verified from outside: every address, unknown ones included, answers 302 to the Zero Trust team's login page on `black-shape-7747.cloudflareaccess.com`, and no page content is served without a session. Nothing on the site depends on it, and no page carries anything for it. It is temporary, until the material moves inside Optimizely (§12).
- **What the sign-in means for verification.** No script can pass the sign-in, so hosted pages are not checked by script. Every page is proven as built files before a deploy: the preflight, the text check and the headless Chrome checks in §9 run against `enablement/site/` locally. After a deploy, an outside check proves the redirect is in place on every address. Anything else is seen in a signed-in browser. A Cloudflare Access service token would let scripts check the hosted pages later; that is the owner's decision (§11).
- **The pages and their addresses.** `/` (a), `/what-it-is/` (b), `/selling-it/` (c), `/how-it-works/` (d), `/credits/` (e), `/glossary/` (f), `/demos/` (g), each an `index.html` in a folder of that name under `enablement/site/`, plus E0's `404.html`.
- **The chrome, on every content page, verbatim:**
  - the skip link, "Skip to the page";
  - the eyebrow, "Internal · Optimizely";
  - the navigation, linking to every page: "All pages" (`/`), "What it is", "Selling it", "How it works", "AI credits", "Glossary", "Demo map";
  - the legend (§4.2);
  - the version stamp: "Updated <Month D, YYYY> · engine facts as of commit 8b4f74c", where the date is the day the page's text last changed and the commit is the one S2 is pinned to;
  - the footer, kept from E0: "Internal reference · do not forward outside Optimizely".
- **The version stamp's rule.** When S2 is revised and pinned to a new commit, every page's stamp changes with it, and every piece is reviewed against the difference in S2 before the new stamp ships. The Word copy carries the same commit in its subtitle and the build date on its cover.
- **The headers,** in `enablement/site/_headers` as E0 built them: a Content-Security-Policy of `default-src 'none'`, each page's inline style allowed by its SHA-256 and never by `unsafe-inline`, `img-src data:`, and `base-uri`, `form-action` and `frame-ancestors` set to `'none'`; `nosniff`; frame denial; `no-referrer`; a closed Permissions-Policy; HSTS; `Cache-Control: private, no-store`; `X-Robots-Tag: noindex, nofollow, noarchive`. After any style change, `node enablement/check-site.mjs --hashes` gives the new `style-src` value.
- **What a page may hold.** Static HTML with one inline `<style>` and inline SVG figures; no script, no form, no font or image from anywhere, no storage, no cookie, no API call. Links (`<a href>`) to the site's own pages, to the demo workers' addresses in §3.8 and to nothing else.
- **The preflight,** `node enablement/check-site.mjs` (E0's 38 checks). P1 widens three of them on purpose, each with a mutation test that fails for the right reason:
  1. **The package name**, from "once in the whole site" to: every content page has exactly one element with `id="package-name"`, inside its `h1`; every page carries the same string; the string appears nowhere else on that page.
  2. **Links out**, from "no address with a scheme" to: an `<a href>` may name an `https` address on an allowlist (the enablement site and the three demo workers); nothing else may name another address, and nothing may be loaded from one.
  3. **The chrome:** every content page carries the legend and the version stamp exactly, and one `<article data-source>`.
- **The deploy, the lead's, from WSL:**

```
node enablement/check-site.mjs && node enablement/check-text.mjs && \
  npx wrangler deploy --config wrangler.enablement.toml
```

  Never a plain `npx wrangler deploy` from the repository root: `wrangler.toml` names the shared demo worker.
- **After the deploy,** verify the responses, not that a page opens. From outside, with no session: every address in this section, and one that does not exist, answers 302 to the login page on `black-shape-7747.cloudflareaccess.com`, and the response carries no page content (E0's checklist, `lanes/E0.md` §4, item 6). E0's items 1 to 4 (status, the 404 page, the headers, one request per page) cannot be run anonymously while the sign-in is on: they are proven on the built files before the deploy, and may be seen in a signed-in browser's developer tools.

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

One writer per path. Every lane reads anything and writes only its own paths; no lane runs a git command that changes anything, installs, deletes or deploys; the lead commits, deploys and adds the sign-in. Each lane records what it did and why in `docs/enablement/lanes/<lane>.md`. Paths below are relative to the repository root.

| Lane | Writes only | Delivers | Starts when |
|---|---|---|---|
| **E1** design | `docs/enablement/BTI-Enablement-Design.md`, `docs/enablement/GLOSSARY.md`, `docs/enablement/README.md`, `docs/enablement/lanes/E1.md` | The glossary, this design, the folder map | Now; the glossary first |
| **C1** marketing | `docs/enablement/content/what-it-is.md`, `docs/enablement/lanes/C1.md` | (b) | The glossary lands |
| **C2** account executives | `docs/enablement/content/selling-it.md`, `docs/enablement/content/credits.md`, `docs/enablement/content/demo-map.md`, `docs/enablement/lanes/C2.md` | (c), (e), (g) | The glossary lands; for (e), the shared credits page is filed at `docs/enablement/research/opal-ai-credits-placement.source.html` |
| **C3** solutions engineers | `docs/enablement/content/how-it-works.md`, `docs/enablement/lanes/C3.md` | (d) | The glossary lands |
| **D1** diagrams | `docs/enablement/figures/**`, `docs/enablement/lanes/D1.md` | F1 to F5, SVG and PNG | This design lands |
| **P1** pages and site | `enablement/site/**`, `enablement/check-site.mjs`, `enablement/check-text.mjs`, `docs/enablement/content/landing.md`, `docs/enablement/lanes/P1.md` | (a); the chrome; the pages for (b) to (g); the widened preflight and the text check | This design lands (chrome, checks and landing page first); each content page once its source has passed review round 1 |
| **W** Word builds | `docs/enablement/word/**`, `docs/enablement/lanes/W.md` | Six Word copies | Each source has passed review round 1 and the lead's read |
| **R** independent review | `docs/enablement/lanes/R.md` (rounds appended) | A verdict per piece, page and Word copy | Round 1 when every source and figure has a draft; round 2 when the pages and Word copies exist |

**The lead** commits by path at each integration point; answers §4.8 (item 1 settled by S2 §10.4; the shared credits page filed in `research/`); revises S2 when a fact is added; deploys the enablement worker and verifies the redirect from outside. The sign-in is already in place (the owner, 2026-10-02, §7).

**The order.**

1. E1: the glossary, then this design, the folder map and the lane note.
2. In parallel: C1, C2 and C3 write their sources from the glossary, S2 and this design; D1 draws the figures; P1 builds the chrome, the widened checks and the landing page.
3. R, round 1: every source and figure.
4. Owners fix; the lead reads each source.
5. P1 renders (b) to (g); W builds the Word copies.
6. R, round 2: every page and Word copy.
7. The lead commits and deploys, with the built files already proven, then checks from outside that every address still answers with the sign-in's redirect.

**The gates.**

- **E1:** every glossary entry traces to S2, or to the common brief for the package's own conventions, in `lanes/E1.md`; the lead accepts the design.
- **C1, C2, C3:** every engine statement traces to an S2 section, listed in the lane note against each section of the piece; the shape in §3.0; the rows from §3.1 with their wording and verdicts; the verbatim paragraphs as written; glossary words only, and a search for every deprecated term finds none in the piece; no customer, prospect or competitor name; no timing figure; no em-dash; American English; gender-neutral wording, with no match for `\b(she|her|hers|he|him|his)\b` in any case; headings as statements; `#` once and `##` for sections; figures and links as §6 says; the name once; the word budget.
- **D1:** the rules in §3.9; each PNG matches its SVG; captions verbatim; each figure checked in light and dark on a test page; labels in the glossary's words and gender neutral.
- **P1:** the preflight passes with its three widened checks, each widened check proven by a mutation that fails for the right reason; the text check passes for every content page; on the built files, served locally, because no script passes the sign-in (§7), in headless Chrome at 320, 375, 768 and 1280 pixels, light and dark: no horizontal scroll, exactly one request per page, no console message, WCAG AA contrast for every text and background pair, the legend and stamp present, the skip link the first Tab stop.
- **W:** each copy built by the unchanged converter; a title page and a linked contents; every in-document link resolves (the build fails otherwise); each figure renders; the file is named with its version. Not machine-verifiable: Ctrl+Click in Word and a PDF export; the owner tries one link on first opening.
- **R:** a PASS or FAIL per piece, page and Word copy, every finding located to a line, covering facts against S2, the rules, the voice, the never-say list, the text check, the preflight, the rendering and the Word structure. R scans every piece, page, figure and Word copy for `\b(she|her|hers|he|him|his)\b`, in any case, and fails the piece on any match. R reviews pages as built files, since no script passes the sign-in. R writes nothing else.

---

## 10. Out of scope for this release

- A generalized interactive "how it works" for the engine beyond the Vantage one; (d) and (g) link to the Vantage page instead.
- Slide decks of any kind.
- Any change to the bodies of older documents, including `docs/README.md`; §8 is the list for a later correction.
- Anything customer-specific: no customer, prospect or competitor name, no customer's order form, no description of any customer's own systems, no customer-facing version of a piece.
- Any change to the engine, the demo workers, their settings or their secrets, and any deploy by a lane.
- New engine facts: S2 changes only through the lead.
- The sign-in's own configuration: the owner's Cloudflare Access setup, which this release does not change.
- Moving the material inside Optimizely, a later step.
- Search, analytics, forms or any script on the site.

---

## 11. Open decisions for the owner

| Decision | Owner | Until it is made |
|---|---|---|
| The final name of the package and the offering | Marketing | "Behavioral Targeting and Intelligence" is the working name, written once per page and once per source, so a rename is one edit per file |
| A Cloudflare Access service token, so scripts can check the hosted pages through the sign-in | The owner | Not needed for this release: pages are proven as built files before a deploy, and the redirect is checked from outside after it (§7) |

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
| 2026-10-02 | One color legend per page. The credits page's credit verdicts become words in their own column ("Credits apply", "No credits", "Per use"), because a second color legend would break the common brief's one legend on every page | E1, on the lead's brief |
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
