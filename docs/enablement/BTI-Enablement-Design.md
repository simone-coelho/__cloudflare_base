# The enablement package: design and build brief

> **Version 3, 2026-10-03.** The owner approved a visual rebuild as three mocks in `mocks/`, with the condition that no section of any piece is only text. `LANE-BRIEF-V3.md` is the law for form, structure and tooling; this document's §3 to §6 describe version 2 and are superseded where V3 differs; §7 (the site) and §9 (the gate) stand as V3 §5 and §7 extend them. The version 3 rows at the end of §12 record the rulings.

**Internal. Design and build brief, version 2.** Rewritten on 2026-10-02 by lane E1, after the owner rejected the first foundation. `LANE-BRIEF-V2.md` is the law: it overrides every conflicting rule in `LANE-BRIEF-COMMON.md` and in the first version of this document. Every lane reads the brief, then this document, then the sources it names, and every deviation is recorded in §12 before it ships.

**Sources.**

- `research/S5-product-as-designed.md`: the product as designed, the source of truth for every capability the material names. Its "today" and stage columns are for the lead only and never reach the material.
- `research/S4-story-sources.md`: the story's sources and its quotations, each with its file and line, used under §5's rules.
- `research/S2-engine-facts.md`: the engineering view, pinned to code commit `8b4f74c`, for the arithmetic, the constants, the architecture and the configuration at a solutions engineer's depth. Its labels are not for the material.
- The sales deck: instruction, not script (§4.5).

**Companions:** `LANE-BRIEF-V2.md` (the law); `LANE-BRIEF-COMMON.md`, where it agrees with the brief; `GLOSSARY.md` (the package's one glossary, and the glossary page's source); `README.md` (the folder map). The first version of this document, with its rows, verdicts and facts discipline, is an engineering record (§8).

---

## 1. Purpose and readers

**What we are making.** An internal enablement package that tells the finished product as one story, at each reader's depth: marketing, account executives (AEs), pre-sales solutions engineers (SEs) and the engineers an SE brings. It is published on the internal site `https://edge-platform-bti.expedge.workers.dev`, behind a passphrase gate (§7), and six pieces also exist as Word documents for sharing in Teams (§6). We provide the content; the receiving teams decide how they present it. There are no slide decks.

**What the material describes.** The finished product, Behavioral Targeting and Intelligence, as it is when the current work is complete: its capabilities in the present tense. Every capability we can deliver counts, including one built once for a customer or shown in an earlier demo. The AI add-ons a customer may switch on with credits (AI search, the style concierge, generated imagery) count too, told as optional. Nothing about build state, plans, stages, rollout order, "designed", "not yet", "today versus later" or "open" appears anywhere in the material (the brief's §1; §9's gate).

**The readers.**

| Reader | Who they are | Comes for | Leaves with |
|---|---|---|---|
| Marketer | Writes about and positions the product; not technical | The story, in words to retell | The stylist and the buckets, the use cases as short scenes, the reasons customers choose it, the sentences to say and never to say, the questions marketing will be asked |
| Account executive | Sells and qualifies | The story with every use case, and what to ask | The reasons customers choose it, what a customer can measure, discovery questions, what a customer provides, objections with answers, which demo shows which story |
| Solutions engineer | Semi-technical; explains concepts and brings an engineer when it gets deep | The story, then how it works | One visitor walked through, the mechanism, the arithmetic, the architecture on Cloudflare, configuration, integration and privacy |
| The engineer an SE brings | Technical | The arithmetic, to try for themselves | The interactive how-it-works, with every constant on an instrument |

**One reader per piece.**

| Piece | Reader | Source | Page | Word copy |
|---|---|---|---|---|
| (a) The landing page | An Optimizely colleague choosing what to read | §3.1 of this design | `/` | none |
| (b) The marketing narrative | A marketer | `content/what-it-is.md` | `/what-it-is` | `word/Enablement-What-It-Is-v2.0.docx` |
| (c) The account executives' narrative | An account executive | `content/selling-it.md` | `/selling-it` | `word/Enablement-Selling-It-v2.0.docx` |
| (d) The solutions engineers' narrative | A solutions engineer | `content/how-it-works-and-where-it-runs.md` | `/how-it-works` | `word/Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx` |
| (e) How it works, interactive | A solutions engineer, or the engineer they bring | `content/how-it-works-interactive.md` for its words; its own page, script and stylesheet for its instruments | `/how-it-works-interactive` | none |
| (f) See it work | A marketer | `content/see-it-work.md` for its words; its own page, script and stylesheet for its instruments | `/see-it-work` | none |
| (g) Where Opal and AI Credits Fit, and Where They Never Do | An account executive who quotes the engine beside Opal | `content/credits-source.html` for the page; `content/credits.md`, the same text, for Word | `/credits` | `word/Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx` |
| (h) The glossary | A marketer; every entry holds for the other readers | `GLOSSARY.md` | `/glossary` | `word/Enablement-Glossary-v2.0.docx` |
| (i) Which demo shows which story | An account executive | `content/demos.md` | `/demos` | `word/Enablement-Which-Demo-Shows-Which-Story-v2.0.docx` |

Paths are relative to `docs/enablement/`; pages are addresses on the site. The two interactive pages have no Word copy: their point is the instruments, and their markdown exists for the text check only.

---

## 2. The name and its conditions

**The name: Behavioral Targeting and Intelligence.** It is the working name of the package and of the offering. A piece writes it in full on first use and says "the engine" afterwards. The spelling is American. "BTIE" is never used: it is the title of a customer's own paper. The abbreviation "BTI" appears in no piece's visible text and in no file name a reader sees. The site's own address, which the owner chose, carries it in its host name, so pieces link to the site by a page's title, with the address as the link's target and never as its visible text (§6). "Intelligence" means counted learning behind a dial, never AI.

**Why this name** (S3 §1.8, restated without customer names).

1. It is the only name with commercial standing: a contracted customer's documents carry it, and Optimizely's product and commercial lead took it under advisement as the product name, with the owner's endorsement.
2. Its reason is the thesis that sells: the engine serves visitors nobody has identified, which is why the initiative was named this and not "site personalization".
3. Its two halves describe the mechanism: behavioral targeting is the rules and weights a brand's team writes; intelligence is counted learning that refines them behind a dial.
4. It names neither a channel nor an infrastructure.

**Conditions.**

1. **Marketing owns the final choice.** The package presents the name as the working name. It is written once per page and once per source (below), so a rename is one edit per file.
2. **Keep it apart from the behavioral targeting Optimizely already sells.** Always the four words and the anonymous-first reason, so nobody hears "we already sell behavioral targeting". The glossary's entry for behavioral targeting says so.
3. **Never present the name as a customer's own**, never cite the customer paper it came from or that paper's sources, and never write "BTIE".
4. **Define "Intelligence" as counted learning behind a dial**, as the glossary does, never as AI.
5. **Map no customer's order form.** The credits page describes the commercial lines generically (§3.7).

**Where it is written.** On each page, once, in an element with the id `package-name` inside the page's `h1`. In each markdown source, once, in its title line (`# Behavioral Targeting and Intelligence: <title>`). In each Word copy, through the converter's title argument, which lane W copies from the markdown title, so the name is typed nowhere else. The converter also prints its title in every page header of the Word copy; that is generated, not written, and a rename regenerates it. Everywhere else, "the engine".

**Retired names** (S3 §1.8, S1 §2.1).

| Name in older material | Becomes |
|---|---|
| BTIE | Never used. A citation of a customer's paper, in that customer's material only |
| Affinity engine, Edge Affinity Engine, Content Affinity Engine, Edge Affinity Reflex, the reflex | Retired; "the engine". "Interest" is the reader's word for affinity |
| Content decision service, Generation 2, publication set, the reflex document | Engineering vocabulary; the glossary maps each to the package's word |
| Edge personalization, Real-Time Personalization Platform, Optimizely Edge Platform, Cloudflare Edge Platform | Retired as product names; "at the edge" stays as a description |
| Signal system | One demo's name for the engine; "the engine" |
| Experience personalization, content personalization | Not used: the story says what each does instead, ordering a page's sections and modules, and choosing what fills each slot (§4.2) |
| Outcome Learning | "Learning", as the glossary defines it |
| Vantage, Top Offers (Lantern & Lane), Meridian (Calder), The Bright Hour, First National Bank, OH | Demo names; never the engine |

---

## 3. The pieces

### 3.0 What every piece shares

1. **Title line:** `# Behavioral Targeting and Intelligence: <title>`, the only place a markdown source writes the name.
2. **Reader line:** the first paragraph names the one reader.
3. **The rule:** one sentence, set as a callout (`> **…**`) after the reader line and again as the piece's last line, word for word. The lane chooses it, and the landing page reads it from the source. Where this section quotes a rule, the source governs if the two differ.
4. **The story, in its order** (§4.1): the problem; what it is; what it does; why customers choose it; how it works; what a customer provides. A reader's own sections, such as an AE's discovery questions, sit between the story's parts or after them, never so that the parts change order. The three narratives tell every part at their reader's depth. The two interactive pages tell the parts their instruments show, in the same order, and link to their narrative for the rest. The credits page, the glossary and the demo map are references with their own shapes (§3.7 to §3.9).
5. **Every capability, none left out,** each with a use case, in each narrative (§4.2).
6. **Every reason customers choose it,** in each narrative and on See it work: never ranked, never attributed to one deal, with the sentence that each customer weighs them differently (§4.3).
7. **The fixed sentences, verbatim** (§4.4): each narrative carries all four, and any piece that touches their subject uses their words.
8. **Examples before mechanism, and every instrument explained before it is shown:** a plain lead above every figure, table of numbers, switcher and instrument.
9. **Sentences to say, and sentences never to say with their replacements** (§5.3), in each narrative.
10. **The voice** (§5.2): gender neutral, plain words, the glossary's terms, American English, no em-dashes.

### 3.1 (a) The landing page

- **Reader:** an Optimizely colleague choosing what to read. **Owner:** P1. **Words:** in the page builder, `enablement/render-pages.mjs`, since the page has no source of its own. **Address:** `/`. **Word copy:** none.
- **Rule:** the lede, the brief's own two sentences on what the engine is, quoted from it: "A personal stylist for every visitor at internet scale. It decides the page at the point in time from what the visitor is doing now." It opens the page and closes it.
- **The page, in order:**
  1. `h1`: the name, in `#package-name`.
  2. The lede.
  3. The sign-in note: "This site is for Optimizely employees; it opens with the passphrase you were given."
  4. "Each page is written for one reader", then three cards. Each card names its reader, carries its piece's rule read from the source, says in one line what the piece gives, and links the piece:
     - For marketing: What it is, and See it work.
     - For account executives: Selling it.
     - For solutions engineers: How it works and where it runs, and How it works, interactive.
  5. "Three references serve every reader": Where Opal and AI Credits Fit, and Where They Never Do; the glossary; Which demo shows which story; each with one line on what it settles.
  6. The lede again.
- **Checked:** the text check holds each card's rule to its piece's rule and the lede to the brief.

### 3.2 (b) The marketing narrative

- **Reader:** a marketer who has never seen the product and must explain what it is, what it does and what problems it solves, in their own words. **Owner:** C1. **Source:** `content/what-it-is.md`. **Address:** `/what-it-is`. **Word copy:** `word/Enablement-What-It-Is-v2.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: what it is`
- **Rule:** the stylist, for every visitor including a stranger, with the brand keeping the last word. As the source states it at this writing: "The engine is a personal stylist for every visitor, even a stranger: it arranges the page around what they are doing now, and your team keeps the last word."
- **Length:** about 1,500 to 2,000 words of prose.
- **Sections, in the story's order** (headings are statements; the wording is the lane's):
  1. The reader line and the rule.
  2. The problem: most visitors are strangers, and tools made for known customers cannot see them.
  3. What it is: the stylist and its four moves, and the page decided at the point in time, to §4.6's points.
  4. What it does: every capability in §4.2 as a short scene, among them a stranger from an ad, a visitor who drifts from coats to shoes and is released, a merchandiser's pinned section, a signal arriving from another channel, a tagged catalog, and a decision read off a receipt.
  5. Why customers choose it: every reason in §4.3, unranked, with the weighing sentence.
  6. How it works: underneath, the buckets feed a ranking with a receipt, in plain words.
  7. What a customer provides, and what we use each thing for.
  8. The four fixed sentences, word for word, then the sentences to say and never to say.
  9. The questions marketing hears, each answered in two or three sentences in the story's words. Consent appears here once, as a fact inside the privacy answer.
  10. The other pages, as real links.
  11. The rule again.
- **Devices:** the stylist; the buckets that fill, drain, enter, release and cap, so nobody writes expiration rules; scenes before mechanism; no arithmetic and no constant; a link to See it work, where the four moves happen on a page; the session figure (§3.10) as a Before / During / After switcher with its lead, where the piece speaks of AI and credits.

### 3.3 (c) The account executives' narrative

- **Reader:** an account executive, who tells the story to a customer and answers what comes back. **Owner:** C2. **Source:** `content/selling-it.md`. **Address:** `/selling-it`. **Word copy:** `word/Enablement-Selling-It-v2.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: selling it`
- **Rule,** as the source states it: "Sell a personal stylist for every visitor, show the receipt behind every decision, and leave the wheel with the brand."
- **Length:** about 2,000 to 2,500 words of prose, plus the tables the story needs.
- **Sections, in the story's order:**
  1. The reader line and the rule.
  2. The problem: most visitors are strangers, and most buying happens before anyone knows them.
  3. What it is: the stylist at internet scale, to §4.6's points.
  4. What it does: seven scenes the seller can retell, which between them carry every capability in §4.2: the stranger from an ad; the drift and release; the pinned paid section; the signal from another channel; the catalog tagged by Opal; the receipt read aloud; the data scientist tuning a constant.
  5. Why customers choose it: every reason, with the sentence that each customer weighs them differently.
  6. How it works: one visitor, then the mechanism in plain words; the arithmetic is the solutions engineers' piece.
  7. What a customer can measure, each outcome with the discovery question that surfaces it, in our words, shaped by the deck's six as instruction and never copied (§4.5).
  8. What a customer provides, and what we use each thing for.
  9. Objections, each with the sentence to say and the sentence never to say.
  10. Which hosted demo shows which part of the story, by address, agreeing with (i).
  11. The four fixed sentences, word for word.
  12. The rule again.
- **Devices:** scenes a customer would recognize; quotations by industry (§5.1); the four fixed sentences in their scenes, in the objections and in the closing list; no deal told as won for a reason; the architecture figure where the story speaks of the edge, captioned with its title, once the redraw is confirmed (§3.10).

### 3.4 (d) The solutions engineers' narrative, the Vantage way

- **Reader:** a pre-sales solutions engineer, who carries the story into a technical room and answers how it works. **Owner:** C3. **Source:** `content/how-it-works-and-where-it-runs.md`. **Address:** `/how-it-works`. **Word copy:** `word/Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: how it works and where it runs`
- **Rule:** the page decided at the point in time, under rules the brand publishes, with every decision written out as arithmetic a person can recompute. As the source states it at this writing: "The engine decides each page at the point in time from what the visitor is doing now, under rules the brand publishes, and writes every decision out as arithmetic a person can recompute."
- **Length:** about 3,500 words of prose, plus the tables the mechanism needs.
- **The model:** the Vantage technical note (`docs/verizon/Vantage-Signal-System-Technical-Note.md`): the story first, then the detail, with links both ways between each part of the story and its detail.
- **Sections, in the story's order:**
  1. The reader line and the rule.
  2. Part A, the story, in about two pages: the problem; what it is; what it does, all thirteen capabilities; why customers choose it, all ten reasons with the weighing sentence; how it works, in a few sentences; what a customer provides. Each part links to its detail.
  3. Part B, the detail, each section linking back:
     - one visitor walked through, end to end, as a narrative;
     - interest as a number anyone can check: how a touch fills a dimension value's bucket, how it fades, and the entry and exit lines;
     - a piece's score as a dot product under the slot's weights, with gates, pins and the cap;
     - a stranger's start from the region and the arrival: the regional prior and the seeds;
     - learning behind the dial, and the receipt;
     - the architecture on Cloudflare, with the architecture and decision-path figures, the performance sentence, and the decisions landing in the brand's warehouse;
     - configuration through published, versioned documents and the console;
     - integration: the site's one connection, events and decisions, ODP, Feature Experimentation and Opal, the AI add-ons, and identity across sign-in;
     - privacy as a property of every request;
     - what a customer provides, and what we use each thing for.
  4. The rule again.
- **Devices:** one visitor before the mechanism, and the mechanism before the arithmetic; every symbol defined at its first use; the engine's defaults (K of 1.8; the entry and exit lines at 0.6 and 0.45; a memory of 14 days by default, which a brand sets per dimension up to 90); the performance sentence once, where the piece speaks of the edge; the companion page, (e), linked by its title on this site. Code paths sit only in a column headed "Where in the code (for engineers)"; engineering documents are named only by paths that carry no customer name; the latency documents are not linked; "GA4" stays only with its trace to S2; "brand = samsung" may stand as an example dimension value.

### 3.5 (e) How it works, interactive

- **Reader:** a solutions engineer, or the engineer they bring. **Owner:** H1, which builds the page (`enablement/site/how-it-works-interactive.html`, `.js` and `.css`) and writes its visible text as `content/how-it-works-interactive.md`. **Address:** `/how-it-works-interactive`. **Word copy:** none; the markdown text exists for the text check only.
- **Rule:** the lane's, first and last.
- **What it is:** the Vantage page (`public/vantage/how-it-works.html`, `.js` and `.css`; how it was built and reviewed is in `docs/verizon/lanes/W3.md`), grown for the product. Its storefront becomes a neutral example brand; its demo beats become examples; its demo-specific sentences are removed or made general; its constants are the engine's defaults from `docs/verizon/explainer/FACTS.md` §2: K of 1.8, a memory of 14 days by default with the note that a brand sets each dimension's memory, and the entry and exit lines at 0.60 and 0.45.
- **The instruments, kept from the Vantage page, in its order:** interest on sliders for K, the memory, the entry and exit lines and the next touch's weight; a live visitor with meters; one slot scored in full, with its weights, its cap and its pins; the regional prior and how it blends away; memory on two horizons; learning behind the dial; the published documents; the receipt, recomputed; and the self-test, which recomputes the published arithmetic on the page's own worked example, a record the page names as an example.
- **Devices:** above each instrument, a lead in plain words in three parts: what you are looking at, what to try, what to watch for. A hint on every control group and instrument, opening by hover, focus and tap. The learning and AI sentences verbatim; the performance sentence once, where the page speaks of the edge. No figure but the engine's constants and the self-test's computed values.

### 3.6 (f) See it work

- **Reader:** a marketer who has never seen the product. **Owner:** M1, which builds the page (`enablement/site/see-it-work.html`, `.js` and `.css`) and writes its visible text as `content/see-it-work.md`. **Address:** `/see-it-work`. **Word copy:** none; the markdown text exists for the text check only.
- **Rule:** the lane's, first and last.
- **What it is:** the stylist's four moves, happening on a mock storefront of a fictional fashion-and-home brand as the reader clicks. Each move is explained above its instrument in plain words before anything is shown.
- **The four scenes, in order:**
  1. **The first page already feels local.** A toggle between two example regions changes the opening page's sections. The reader picks the region, and the page never claims to know where the reader is.
  2. **The first click changes the page.** The reader clicks a product or editorial card; that interest's bucket fills, and the next page's sections reorder by interest, not only what sits inside a slot. The performance sentence sits under this scene.
  3. **Relevance that expires on its own.** A clock runs and the buckets drain. When a bucket falls below its line, the visitor is released from that interest, the sections settle back, and the receipt records the release. Nobody wrote an expiration rule. The learning sentence sits under this scene.
  4. **The merchandiser keeps the wheel.** The reader pins a paid section and sets a gate. The pinned section holds its place, the gated item never appears, and the receipt shows the override beside what interest alone would have ranked.
- **Then:** "Why customers choose it", every reason in §4.3 as plain cards, never ranked; the AI sentence beside a card saying that Opal authors, explains and tags behind the scenes; and two links, "Read the whole story" to (b) and "See the arithmetic" to (e).
- **Devices:** the arithmetic behind the instruments is the engine's, at its defaults, but the page shows buckets and sections in words, never formulas; no figure except the performance sentence; every control reachable by keyboard; without its script, the page shows the four explanations with static illustrations.

### 3.7 (g) Where Opal and AI Credits Fit, and Where They Never Do

- **Reader:** an account executive who quotes the engine beside Opal. **Owner:** P1, which keeps both sources. **Address:** `/credits`. **Word copy:** `word/Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx`.
- **Sources:** `content/credits-source.html`, the shared page kept whole, for the page; `content/credits.md`, the same text in markdown, for Word. The original stays filed, untouched, at `research/opal-ai-credits-placement.source.html`.
- **Rule:** the original's, "The engine decides. Opal creates and explains.", with the AI sentence (§4.4) beside it.
- **Standalone, as before:** its title, structure, order, devices and voice stay. Its corrections make false statements true to the finished product: Opal works with the engine, as §4.2 tells it; the AI add-ons are optional, and a brand switches them on with its credits; credit verdicts are bold words, never fills or colors; no label, no chip and no state word. The first version's added line on Opal's connection is removed. The illustration ruling holds: a scaling illustration such as "whether a site has one million sessions or ten million" is allowed when it is plainly an illustration, never a measurement or a timing figure.
- **Carried into the narratives:** where AI fits, in each piece's own words, to §4.6's points, with a link to this page by its title.
- **Figure:** the session figure, redrawn (§3.10).

### 3.8 (h) The glossary

- **Reader:** a marketer, the least technical reader; every definition also holds for an account executive and a solutions engineer. **Owner:** E1 (`GLOSSARY.md`). **Rendered by:** P1, with the reader tag "For everyone". **Address:** `/glossary`. **Word copy:** `word/Enablement-Glossary-v2.0.docx`.
- **Rule:** "One word for each meaning, defined once, in plain words."
- **Shape:** the reader line; the rule; how to read it; one section per letter; the rule again. Its letter headings are labels, and it has no story sections: it is the reference every piece points to.
- **For version 2:** 121 entries, 101 defined and 20 deprecated. The definitions describe the finished product in the present tense. The three label entries, "Demo only", "Durable recovery", "Generation 1, Generation 2" and the deprecation of "real-time" are gone; "Bucket" is the story's image of an interest; "Before, during, after" names the parts of a session, no longer the order of every piece; "Placement" is defined, not deprecated, because the story says the engine honors the placements a brand sells; the bans on "stage" and "phase" as build words stay (§12).
- **On the page:** each entry carries an `id` made by the GitHub anchor rule from its term, with any bracketed symbol dropped, so a page can link to `/glossary#learning-dial`.

### 3.9 (i) Which demo shows which story

- **Reader:** an account executive, who chooses which demo shows each part of the story. **Owner:** P1, which writes the source and renders it. **Source:** `content/demos.md`, the page's only source. **Address:** `/demos`. **Word copy:** `word/Enablement-Which-Demo-Shows-Which-Story-v2.0.docx`.
- **Title:** `# Behavioral Targeting and Intelligence: which demo shows which story`
- **Rule,** as the source states it: "Choose the demo by the part of the story your customer needs to see, and open it from where you are."
- **Its demo facts agree with (c)'s demo table and with `docs/demos/BOOTSTRAP.md`:** (c) gives a row per demo; the demo map gives the beats and the cautions.
- **Sections, in order:**
  1. The reader line and the rule.
  2. Each part of the story has a demo that shows it: a table of the capabilities in §4.2, in the story's order, each with the demos that show it and what the room sees.
  3. What each demo shows, in the order it runs, one subsection per demo, each with its address and one thing to keep in mind:
     - **Vantage**, a carrier's online shop, `https://edge-platform-vantage.expedge.workers.dev/vantage/`: its regional sales are synthetic and marked so on screen, and its real phone makers' images need legal's confirmation before any public or recorded use.
     - **Vantage's interactive explainer**, `https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works`: made for a customer's engineers; (e) is the package's own.
     - **Top Offers**, on screen Lantern & Lane, a retailer's four-place promotions module, `https://edge-platform-top-offers.expedge.workers.dev/top-offers/`: its click report is attribution, and lift is measured on the brand's own numbers.
     - **Meridian**, on screen Calder, one brand with two businesses, `https://edge-platform.expedge.workers.dev/meridian/`: the page shows a fade on its own timer, told as the interest falling below its release line.
     - **The Bright Hour**, a live-shopping retailer, `https://edge-platform.expedge.workers.dev/live/`, with its Offer Desk at `/live/ops`: its memories are compressed to seconds for the room.
     - **OH**, a home-appliances store made for one prospect, `https://edge-platform-oh.expedge.workers.dev/oh/`: ask the demo owner before showing it.
     - **The storefront**, `https://edge-platform.expedge.workers.dev/storefront`: for internal viewing only, because it carries one brand's own products and is never shown to another company.
  4. Before you show a demo: open it from where you are, because the region on screen is the request's real one and any other region is asserted by a press and labeled; regional data is synthetic and labeled; ask the demo owner before a customer sees any demo; show only the demos on this page, since the other pages at the same addresses belong to other products.
  5. A demo for your own customer is a restyle, not a rebuild: a palette, a product feed and a set of beats on a shared kit; the customer's colors, never its logo; real names for the products the customer itself sells; a solutions engineer follows `docs/demo-kit/HOWTO.md`, and nothing is created in the cloud without the owner's approval.
  6. Sentences never to say, and what to say instead, among them a demo's numbers as the engine's, a click report as lift, and a change "pushed" to the page.
  7. The rule again.
- **Devices:** the story's order in the first table; the demos' on-screen names, never the customers they were made for; the real region, never a pre-set one; the fixed sentences where their subject comes up.

### 3.10 The figures

- **D1 draws three,** under `docs/enablement/figures/`, as SVG for the pages and PNG at device scale 2 for Word: `architecture` ("Where the engine runs on Cloudflare"), `decision-path` ("From an event to a decision") and `before-during-after` ("One visitor's session: what happens before, during and after"). Each is captioned with its SVG title; if the redraw changes a title, the caption follows it.
- **For version 2, D1 redraws all three** to show the finished product: no legend of any kind, no label chips, no "Open", "Designed" or "Demo only", no stage word, and every capability drawn as a capability. The architecture figure draws the published documents, the warehouse feed, Opal behind the scenes and ODP as the product's parts. The decision path keeps its ten steps, with pins reserved before scoring. The session figure shows the team publishing documents and Opal authoring, explaining and tagging before the session; the engine deciding at the edge from published rules during it, calling no AI model to decide; and outcomes counted behind the dial afterwards, with the credits line as words where the AI sentence puts it.
- **Where they appear:** (d) carries the architecture and decision-path figures; (c) places the architecture figure where its story speaks of the edge, once the lead confirms the redraw; (b) carries the session figure as a Before / During / After switcher; (g) carries it static.
- **New figures** come only when a piece asks for one, under the same rules: presentation attributes only, no script or external reference, prefixed ids, a title and a description, gender-neutral labels in the glossary's words, no customer or competitor name, and no number.
- **On the pages:** inlined verbatim, captioned with their titles, on a white panel in both themes, scrolling sideways below 720 pixels under a line that says so.

---

## 4. The story and the fixed sentences: the law for every piece

### 4.1 The story, in this order, in every piece (the brief's §2)

1. **The problem.** Most visitors are strangers; most buying happens before any profile exists; tools built for known customers are blind in that window; the rules written to compensate go stale, multiply and fight.
2. **What it is.** A personal stylist for every visitor at internet scale: it reads the room, watches without interrogating, rearranges the table, and pivots when attention moves. It decides the page at the point in time from what the visitor is doing now; recommendations rank the past. It is not a recommendations engine and does not replace one: it lives alongside whatever recommendations exist and organizes the page by interest in real time around them.
3. **What it does:** every capability in §4.2, with its use case.
4. **Why customers choose it:** every reason in §4.3.
5. **How it works,** told the Vantage way: one visitor walked through, then the mechanism, then the arithmetic where the reader is technical.
6. **What a customer provides, and what we use it for.**

### 4.2 What it does: every capability, none left out

Each narrative tells all thirteen, at its reader's depth, each with a use case. The S5 rows are for the lane note and the review, never for the prose.

| # | Capability | A use case to tell | S5 |
|---|---|---|---|
| K1 | The first page feels local before the first click | A first-time visitor's first page leans on what visitors in their region are interested in, from the site's own events and the brand's own sales by region, and the lean steps back as the visitor's own interests grow | A3, B7, M2 |
| K2 | The first click changes the page | The visitor's first action is scored as it arrives, and the next page reflects it, with no login and no history | V1 |
| K3 | Channels seed the visit: an email, an ad, a social signal, a partner quiz, a campaign term | A visitor who taps an ad for one product lands on a page that answers the ad, and the page lets go of the ad as the visitor's own interest moves elsewhere | A4, M2 |
| K4 | Interest fills and drains like buckets, per dimension, with entry, release and a cap, so nobody writes expiration rules, and the release is on the receipt | A visitor who stops looking at one brand leaves that audience by time alone, at a moment the engine computes, and the content it drove steps back | V2, V4, M3 |
| K5 | The page's sections and modules reorganize by interest, not only what goes inside a slot; a recommendations carousel is one of the modules it orders | On a product page, the storage options rise for a visitor comparing storage, while the carousel leads for a visitor still browsing | V7, V8, V6 |
| K6 | Merchandisers keep the wheel: gates, pins for the sections they sell, then ranking, with every override and every decision written out as arithmetic on a receipt a person can recompute | A funded campaign pinned first stays first, content out of stock or out of its window never shows, and the receipt says ranking never ran for the pin | C1, C2, F1, F2 |
| K7 | Marketers and data scientists tune every constant in the open, through published, versioned documents and the console | A merchandiser changes a slot's weights in the console, and the change is in force without a release, with who changed it and a one-step rollback | C7, C3, C5 |
| K8 | It learns from outcomes behind a dial the brand controls, with holdouts and measured lift | A slot learns which pieces earn clicks or sales in each context; the brand turns the dial when it trusts the evidence, and its holdout shows the lift on its own numbers | F3, F7, F8, F12, F13 |
| K9 | Opal works with it: authoring audiences and tests, explaining results, tagging content, proposing and launching experiments and CMAB tests on signals, while the serving path calls no AI model to decide | A merchandiser asks Opal in plain words for an audience or a test, and approves each tag Opal proposes for thinly labeled content | B3, B10, C8, F14 |
| K10 | It links with ODP and with Feature Experimentation | The audiences the engine forms land in ODP as lasting facts for the brand's other teams, and an experiment or a CMAB test can run on any slot | F16, C8 |
| K11 | The optional AI add-ons for shoppers: AI search, the style concierge, generated imagery | A visitor types a search, an AI model reads the query, and the engine ranks the results in the visitor's taste | V11 |
| K12 | Identity carried across sign-in | When a visitor signs in, the anonymous and known profiles merge with nothing overridden, and the brand's own systems take over a warm visitor | V12, A6, B8 |
| K13 | It runs at the edge, close to the visitor, on Cloudflare, with the decisions landing in the brand's own warehouse | Each decision is made in the data center nearest the visitor, and every decision and outcome lands in the brand's warehouse on the cadence the brand sets | A8, A9, F6 |

**Consent is a fact of the product, told where privacy comes up:** nothing is personalized or recorded until the visitor chooses, and a visitor who declines sees the brand's own site (S5 A1). Marketing's piece states it once, inside the privacy answer; the solutions engineers' piece states it in its privacy section; "what a customer provides" names the visitor's choice that the site passes. It is never a headline, and never a condition repeated on every claim (§8).

### 4.3 Why customers choose it: every reason, never ranked

| # | Reason |
|---|---|
| R1 | They can control it. |
| R2 | It decides at the point in time. |
| R3 | It is performant at the edge. |
| R4 | Every decision is explainable. |
| R5 | It hooks to Opal. |
| R6 | AI is theirs to use or not. |
| R7 | It learns to the degree they govern. |
| R8 | It links with ODP. |
| R9 | It works alongside their recommendations. |
| R10 | It honors the placements they sell. |

Every narrative lists all ten, in any order, never ranked, never attributed to one deal and never told as a win story, and it says, in these words or close to them: "Each customer weighs these reasons differently."

### 4.4 The fixed sentences, verbatim (the brief's §3)

- **Performance:** "We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor."
- **Learning:** "It records what works from the first day and changes nothing until the brand turns the dial."
- **AI:** "The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply."
- **Recommendations:** "Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side."

No other performance figure appears, no SLA language, and no comparison figure from anyone's deck.

### 4.5 Sources, and the deck

- **S5 is the source of truth** for what the product does, in the present tense. S4 supplies the story's sources and quotations. S2 supplies the engineering depth, the arithmetic, the constants, the architecture and the configuration, for (d) and (e).
- **A fact in none of them** goes to the lead; a lane does not read the code to fill a gap. S5's "today" and stage columns and S2's labels never reach the material.
- **The deck is instruction, not script** (the owner's ruling). It tells us what the story must carry; no piece copies its slides, its wording or its figures.

### 4.6 What every "what it is" says, and where AI fits

- **What it is,** in each narrative's own words: the stylist's four moves (it reads the room, watches without interrogating, rearranges the table, and pivots when attention moves); it decides the page at the point in time from what the visitor is doing now; it is not a recommendations engine and does not replace one; it lives alongside whatever recommendations exist and organizes the page around them by interest in real time; and the recommendations sentence, verbatim.
- **Where AI fits,** in each narrative: the AI sentence, verbatim; what Opal does with the engine (K9); the optional AI add-ons a brand switches on with its credits (K11); and a link to (g) by its title.
- **Nothing else is carried word for word** between pieces: only the four fixed sentences are verbatim. The first version's carried paragraphs, P1 to P10, are retired with it (§8).

---

## 5. Quotations, names and the voice

### 5.1 Quotations and names (the brief's §4)

- **Customers' words may be quoted when the customer is not named:** "one of our customers in luxury retail said", "a home-shopping retailer told us". Each quotation comes from S4 with its file and line, and the lane note keeps the trace.
- **No customer, prospect or competitor name** appears in any piece, page, figure or Word copy.
- **The working notes' positions become our statements,** in our voice and unattributed.
- **A quotation that carries a gendered pronoun is paraphrased,** not quoted.
- **Names the material uses:** Optimizely's own products (Opal, ODP, Feature Experimentation); Cloudflare, where the engine runs; the demos by their on-screen names (§3.9).
- **A real product brand may be an example dimension value,** as in "brand = samsung": it names a product, not a customer or a vendor of ours.
- **"What it is not" contrasts** stay allowed, as the story's own "It is not a recommendations engine and does not replace one" shows: a class of system, phrased as what the engine does instead, never a product or a vendor, and never judged.
- **Any other third-party product name** stays only with its trace to S2, as "GA4" does in (d).

### 5.2 The voice

- **Gender neutral, everywhere** (the owner's ruling). The visitor is "the visitor", or "they", "them" and "their". No piece, page, figure or Word copy matches the pattern `\b(she|her|hers|he|him|his)\b`, in any case, quotations included.
- **Plain words** a non-technical marketer can retell; every term defined the first time; the glossary's words only.
- **American English;** short sentences, one idea each; no em-dashes; headings are statements, except the glossary's letter headings.
- **One rule first and last; examples before mechanism; every instrument explained before it is shown.**
- **No build state:** capabilities in the present tense, with no label, no stage or phase of a rollout, and no "designed", "not yet", "today", "later", "open" or "roadmap" about the product.

### 5.3 Sentences never to say, shared by every piece

| Never say | Say instead |
|---|---|
| "BTIE"; "BTI" in a piece | The name in full on first use, then "the engine" |
| Any build-state word about the product: "not yet", "designed", "planned", "on the roadmap", "today" against "later", "open", "in a later stage", "phase two" | The capability in the present tense |
| Built, Designed or Open as a label | No label |
| "It's AI", "AI-powered decisions", "the AI decides" | The AI sentence (§4.4) |
| "We don't use a model" | "It calls no AI model to decide." |
| Any performance figure other than the performance sentence; "guaranteed", "SLA"; a figure from anyone's deck | The performance sentence (§4.4) |
| "It learns on its own", "it optimizes itself", "autonomous" | The learning sentence (§4.4) |
| "A recommendations engine", "it replaces your recommendations" | The recommendations sentence (§4.4) |
| "The main reason customers choose it", any ranking of the reasons; "we beat", "we displaced", "won because" | "Customers choose it for different reasons, and each customer weighs them differently." |
| A customer, prospect or competitor name | The industry: "one of our customers in luxury retail" |
| A quotation with a gendered pronoun | A paraphrase in our voice |
| "Changes go live in seconds" | "A change is in force without a software release." |
| "It knows who they are", "identity resolution", "fingerprinting" | "It knows the visitor by a random id until they sign in, and then the two profiles merge; it never fingerprints a device." |
| "It sets prices by location" | "It curates content, and never decides a price, a discount, financing or credit." |
| "It never flashes", "no flicker" | "When a decision is not ready, the site shows its own page, so the visitor never waits." |
| "The engine pushes changes to the page" | "Each time the page asks, the engine answers from the visitor's latest interests." |
| A lift or revenue figure of ours | "The brand measures lift on its own numbers, against its holdout." |
| A deprecated word | The glossary's word |

---

## 6. Formats and the single-source rule

**One source per piece.** Each piece's text lives in one source, and its renderings are made from it:

- (b), (c) and (d): `docs/enablement/content/<piece>.md`.
- (e) and (f): the page's visible text, in order, as `content/how-it-works-interactive.md` and `content/see-it-work.md`, for the text check only; neither has a Word copy. The instruments are the page's own HTML, script and stylesheet, which the lane builds by hand.
- (g): two sources. The page is built from the corrected HTML `content/credits-source.html`, and the Word copy from `content/credits.md`, the same text in markdown (§3.7). The text check holds the page to both.
- (h): `docs/enablement/GLOSSARY.md`.
- (i): `content/demos.md`, which P1 writes from §3.9.
- (a): its words in the page builder (§3.1).

The page and the Word copy are renderings of the source. A change is made in the source first; the page is then re-rendered, or for (e) and (f) edited by its lane together with its text, and any Word copy is rebuilt. A Word file is never edited by hand.

**The markdown, written for both renderings.**

- `#` once, for the title; `##` for sections. The converter starts a new page at every `#` and lists `#` and `##` in Word's contents, so deeper headings are not used.
- Tables in pipe syntax with short cells; no ASCII diagrams; code fences only where a reader must see literal text, with lines of 76 characters or fewer (converter rules 1 to 3).
- Figures as `![caption](../figures/<name>.png)`, alone on a line; the page shows the SVG of the same name.
- Links within a piece as `[text](#heading-anchor)`, with GitHub's anchor rule: the heading's text without markup, lower-case, every character that is not a letter, digit, underscore, hyphen or space removed, each space a hyphen. A link to a missing anchor fails the Word build, by design.
- Every reference to another piece is a real link, never an italic title alone. Links to another piece or to the site show the page's title as their visible text and carry the full address as their target, for example `[Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it)`, with no trailing slash. They work in Word for anyone past the gate, and the address, whose host name carries the abbreviation §2 keeps out of visible text, is never shown. On the page, P1 may make same-site targets relative without changing their text. Links to a demo may show the demo's address, which carries no such abbreviation.
- No HTML in the markdown, no em-dash, American English.

**The Word copy.** Lane W builds each with the repository's converter, unchanged:

```
node scripts/md2docx.mjs <source.md> docs/enablement/word/Enablement-<Title>-v2.0.docx \
  "<the source's title line, verbatim>" "<Subtitle>" "<Prepared for>" \
  "2.0" "<Month D, YYYY>" "Internal: Optimizely only"
```

The subtitle is the reader, for example "For marketing"; it names no code commit. "Prepared for" is the reader's team, for example "Optimizely marketing". The version is the bare number, because the converter prints its own "Version" label. File names are `Enablement-<Title>-v2.0.docx`, the piece's title in capitalized words: they carry no package name, so a rename does not rename files, and they carry their version. There are six: `Enablement-What-It-Is`, `Enablement-Selling-It`, `Enablement-How-It-Works-and-Where-It-Runs`, `Enablement-Where-Opal-and-AI-Credits-Fit` (built from `content/credits.md`), `Enablement-Which-Demo-Shows-Which-Story` and `Enablement-Glossary`, each `-v2.0.docx`. The landing page and the two interactive pages have none: the landing page is navigation, and the interactive pages' point is their instruments. The seven `-v1.0.docx` files are superseded, the status piece's and the old demo map's among them; the lead removes them, since lanes delete nothing. The converter needs the `docx` package installed once per machine, outside the repository (its header says how); W uses an existing install and installs nothing.

**The page, a designed rendering of the same text.** Each content page wraps its text in `<article data-source="…">`, naming its source or sources. Everything inside the article is the source's text; everything outside it is the chrome in §7. A page may choose any layout, type and color inside the brand, but may not drop or reword text inside the article. Words that are not the source's are marked on the page as additions: `data-chrome` for a rule's label or a scroll hint, `data-lead` for a lead line above an interactive element, `data-added` for an addition a ruling made, with its reason. A figure's own text sits inside its inline SVG, outside the comparison; its caption is a `<figcaption>`, inside it. The interactive pages follow the same rule: the article names their markdown text, and the words their scripts draw are either in that text or held as data the check can read without running a script.

**The page builder:** `enablement/render-pages.mjs` (P1) renders (a), (b), (c), (d), (g), (h) and (i) from their sources, with the one stylesheet `/site.css` and, where a page needs it, the one script `/site.js`, so a change to a source is re-rendered, never hand-edited on a page. M1 and H1 build (f) and (e) by hand with the same chrome, adding each page's own stylesheet and script.

**The text check:** `node enablement/render-check.mjs` (P1). It compares each page with its sources sentence by sentence, in both directions, and fails on any missing source sentence and on any page sentence that is neither in a source nor marked as an addition. On the landing page, it holds each card's rule to its piece's rule. It also fails on an inline figure that differs from its file, a caption that is not its figure's title, missing chrome (the package name, the stamp, the footer line, the skip link), any label, chip or legend on a page, a label in an inlined figure, and any scan hit: a gendered pronoun, a customer name, a timing figure other than the performance sentence, a build-state word, or the abbreviation §2 keeps out of visible text. `--verbose` lists every marked addition. It covers (e) and (f) once P1 extends it from M1's and H1's notes. It runs before every deploy, beside the preflight.

**Figures.** Drawn once by D1 under `docs/enablement/figures/` (§3.10). Pages embed the SVG inline, copied verbatim from the figure file, so no figure is a request of its own and the image policy is unchanged; the text check confirms each inline copy matches its file.

---

## 7. The site

- **The worker.** `edge-platform-bti`, at `https://edge-platform-bti.expedge.workers.dev`. It serves the pages under `enablement/site/`, and nothing else; it shares nothing with the demo workers. Lane E2 owns its code, `enablement/worker.mjs` with its tests `enablement/worker.test.mjs`, and its configuration, `wrangler.enablement.toml`, which names `edge-platform-bti`, runs the worker before the assets and keeps preview addresses off (`docs/enablement/lanes/E2.md`). The first worker, `edge-platform-enablement`, stays behind Cloudflare Access and is no longer deployed to (§12).
- **The gate: a passphrase, in the worker itself** (lane E2). One passphrase, held as a worker secret, with a second secret, the key that signs the cookie; a signed cookie that lasts seven days; failed attempts slowed; nothing served without it. The values live only in the worker and in the owner's local `.dev.vars`. It replaced Cloudflare Access on 2026-10-02, after Access's one-time email codes did not reach the owner (§12). It stays until the material moves inside Optimizely and the Microsoft sign-in takes over.
- **The gate is not a content page.** Its own sign-in page at `/auth` and its cookie belong to lane E2. Content pages hold no form, inline script, cookie or storage (below), and nothing on them depends on the gate.
- **Verification through the gate.** No script holds the passphrase, so hosted pages are not checked by script. Every page is proven as built files before a deploy: the preflight, the text check and the headless Chrome checks in §9 run against the built files locally. After a deploy, an outside check without the passphrase proves that every address, unknown ones included, serves no page content. With the passphrase, a person sees the pages in a browser.
- **The pages and their addresses, with no trailing slash:** `/` (a), `/what-it-is` (b), `/selling-it` (c), `/how-it-works` (d), `/how-it-works-interactive` (e), `/see-it-work` (f), `/credits` (g), `/glossary` (h), `/demos` (i), plus the 404 page for any other address. `/status` is retired: `status.html` leaves the served folder, so the address answers the 404 page (§8). The pages are flat files (`what-it-is.html` and the rest), served without the extension by the assets binding's default handling, beside `/site.css`, `/site.js`, each interactive page's own stylesheet and script, and `figures/`.
- **The chrome, on every content page, verbatim:**
  - the skip link, "Skip to the page", the first Tab stop;
  - the eyebrow, "Internal · Optimizely";
  - the navigation, linking to every page, with the current page marked: "All pages", "What it is", "See it work", "Selling it", "How it works", "How it works, interactive", "AI credits", "Glossary", "Demo map";
  - the reader tag at the top of each piece: "For marketing", "For account executives", "For solutions engineers" or "For everyone";
  - the stamp, "Updated <Month D, YYYY>", the day the page's text last changed; it names no code commit;
  - a footer, "Every piece, by title", listing every piece by its full title with its reader, ending with the line "Internal · Optimizely · do not forward outside Optimizely".
  - No legend and no label, anywhere on the site.
  - The package name is written once per page, in `#package-name` inside the `h1`; the page's `<title>` never repeats it.
- **The headers,** in `enablement/site/_headers`, which the assets binding applies to every page the gate serves: a Content-Security-Policy of `default-src 'none'; style-src 'self'; script-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, never `unsafe-inline` or `unsafe-eval`; `nosniff`; frame denial; `no-referrer`; a closed Permissions-Policy; HSTS; `Cache-Control: private, no-store`; `X-Robots-Tag: noindex, nofollow, noarchive`. The interactive pages' own stylesheets and scripts are served from the site, so `'self'` covers them, and the policy does not change. `img-src data:` stays for the tab icon.
- **What a page may hold.** Static HTML that loads `/site.css` and, where it needs it, `/site.js`; each interactive page also loads its own stylesheet and script from the site, and nothing else. Inline SVG figures; no inline style or script, no form, no font or image from anywhere, no storage, no cookie (the gate's cookie is the gate's), no API call and no request to any other address. The interactive pages compute everything in the browser. Every script is progressive enhancement: without it, every page reads in full, and the interactive pages show their explanations with static illustrations. Links (`<a href>`) go to the site's own pages and to the demo addresses in §3.9: the shared demo worker, Top Offers, Vantage and OH.
- **The preflight,** `node enablement/check-site.mjs`, lane E2's. For version 2 it widens on purpose, each widened check proven by a mutation that fails for the right reason:
  - the required pages lose `status` and gain `see-it-work` and `how-it-works-interactive`;
  - the served folder may hold each interactive page's own stylesheet and script, scanned as `site.css` and `site.js` are: they load and store nothing, make no network call and build no code or HTML from a string;
  - each interactive page may load exactly its own stylesheet and script, beside the shared ones;
  - the link allowlist adds OH's worker, `edge-platform-oh.expedge.workers.dev`, which (c) links.
- **The deploy, the lead's, from WSL** (`docs/enablement/lanes/E2.md` §5):

```
node enablement/check-site.mjs && node enablement/render-check.mjs && \
  npx wrangler deploy --config wrangler.enablement.toml
```

  Never a plain `npx wrangler deploy` from the repository root: `wrangler.toml` names the shared demo worker.
- **After the deploy,** verify the responses, not that a page opens. From outside, without the passphrase: every address answers with the gate and carries no page content. With the passphrase: the pages, the 404 page for an unknown address and for `/status`, and the headers above.
- **The first version's deploy, 2026-10-02** (the lead, `lanes/E2.md`): `edge-platform-bti` version `8388fa81`, from commit `8086cb1`, deployed from a clean worktree with both secrets already set. Checked from outside:

| Request | Answer |
|---|---|
| `/`, with no session | 302 to `/auth` |
| `/auth` | 200, with the strict headers and one password field |
| A wrong passphrase | 401, and no cookie |
| The right passphrase | 303, setting the session cookie |
| `/`, with that cookie | 200 |
| An unknown address, with that cookie | 404 |
| `/`, with a forged cookie | 302 to `/auth` |

  Version 2's deploy is recorded the same way, in `lanes/E2.md` and in §12, when the lead makes it.

---

## 8. What is retired from the material

Version 2 retires the following from every piece, page, figure and Word copy. Each is kept as an engineering record under `docs/enablement/research/`, where the lead files it; lanes move and delete nothing.

| Retired | Where it lived | What becomes of it |
|---|---|---|
| The status piece, "What is built, designed and open", with its page `/status` and its Word copy | `content/status.md`, `enablement/site/status.html`, `word/Enablement-What-Is-Built-Designed-and-Open-v1.0.docx` | C3 marked the markdown at its top as an engineering record kept out of the material, and the lead moved it to `research/status-engineering-record.md`. P1 removes the page from the served folder and from every navigation and landing link. The lead removes the Word copy |
| The Built / Designed / Open legend, every label and chip, verdict colors, and points marked open | Every page, the builder, the credits page, the three figures, the glossary's label entries | P1 removes them from the site and the builder, with credit verdicts kept as bold words; D1 redraws the figures; the glossary's label entries are gone (§3.8). The labels stay in S2 and S5, which are engineering records |
| The master list of rows before, during and after the session, with their verdicts and caveats | The first version's §3.1, the narratives' tables and the status piece | Kept in the first version of this design, filed under `research/` |
| The consent caveat as a headline: consent as the spine of the material and a condition on every claim | The first version's pieces and its never-say list | Consent stays as a fact of the product, told where privacy comes up (§4.2) |
| The first version of this design: its facts discipline, its carried paragraphs P1 to P10, its open decisions, its list of superseded documents and its follow-ups | `BTI-Enablement-Design.md` as committed at `d41b4f6` | Kept whole as an engineering record; the lead files that commit's copy under `research/` |
| The facts stamp, "engine facts as of commit 8b4f74c", on pages and Word covers | Every page's stamp; every Word subtitle | The stamp names the day the text last changed (§7); a Word subtitle names the reader (§6) |
| The ban on every timing figure | The first version's §4.3 | Replaced by the performance sentence, the one figure the material carries (§4.4) |

**What stays:** the name and its conditions (§2); the formats (§6); the site and its gate (§7); the gender-neutral voice and the glossary's words; the "what it is not" allowance and the illustration ruling (§3.7, §5.1); the code-path column and the rules for engineering documents in (d) (§3.4); and every ruling in §12 that version 2 does not contradict.

---

## 9. Lanes and gates

One writer per path. Every lane reads anything and writes only its own paths; no lane runs a git command that changes anything, installs, deletes or deploys; the lead commits and deploys. Each lane records what it did and why in `docs/enablement/lanes/<lane>.md`. Paths are relative to the repository root.

| Lane | Writes only | Delivers in version 2 |
|---|---|---|
| **E1** design | `docs/enablement/BTI-Enablement-Design.md`, `docs/enablement/GLOSSARY.md`, `docs/enablement/README.md`, `docs/enablement/lanes/E1.md` | The glossary for version 2, this design, the folder map |
| **C1** marketing | `docs/enablement/content/what-it-is.md`, `docs/enablement/lanes/C1.md` | (b), rewritten from scratch |
| **C2** account executives | `docs/enablement/content/selling-it.md`, `docs/enablement/lanes/C2.md` | (c), rewritten from scratch |
| **C3** solutions engineers | `docs/enablement/content/how-it-works-and-where-it-runs.md`, `docs/enablement/lanes/C3.md` | (d), rewritten from scratch; it marked the status piece as an engineering record, which the lead moved to `research/status-engineering-record.md` |
| **M1** See it work | `enablement/site/see-it-work.html`, `enablement/site/see-it-work.js`, `enablement/site/see-it-work.css`, `docs/enablement/content/see-it-work.md`, `docs/enablement/lanes/M1.md` | (f) |
| **H1** How it works, interactive | `enablement/site/how-it-works-interactive.html`, `enablement/site/how-it-works-interactive.js`, `enablement/site/how-it-works-interactive.css`, `docs/enablement/content/how-it-works-interactive.md`, `docs/enablement/lanes/H1.md` | (e) |
| **D1** figures | `docs/enablement/figures/**`, `docs/enablement/lanes/D1.md` | The three figures, redrawn (§3.10) |
| **P1** pages and site | `enablement/site/**` except M1's and H1's files, `enablement/render-pages.mjs`, `enablement/render-check.mjs`, `docs/enablement/content/credits-source.html`, `docs/enablement/content/credits.md`, `docs/enablement/content/demos.md`, `docs/enablement/lanes/P1.md` | (a); (i), rewritten from §3.9; (g)'s corrections; the chrome; the pages for (b), (c), (d), (g), (h) and (i); the builder and the text check, extended to (e) and (f) |
| **E2** worker, gate and preflight | `enablement/worker.mjs`, `enablement/worker.test.mjs`, `wrangler.enablement.toml`, `enablement/check-site.mjs`, `docs/enablement/lanes/E2.md` | The preflight, widened for version 2 (§7) |
| **W** Word builds | `docs/enablement/word/**`, `docs/enablement/lanes/W.md` | Six Word copies, `-v2.0.docx` (§6) |
| **R** independent review | `docs/enablement/lanes/R.md` (rounds appended) | A verdict per piece, page, figure and Word copy |

**The lead** commits by path at each integration point; moves the retired records into `research/` and removes the superseded Word copies (§8); answers any fact that none of S5, S4 and S2 holds; deploys the site's worker with lane E2's command and checks from outside (§7).

**The order.**

1. E1: the glossary, then this design.
2. In parallel: C1, C2 and C3 rewrite the narratives; M1 and H1 build the interactive pages; D1 redraws the figures; P1 removes the labels, retires `/status`, adds the two pages to the chrome and the landing page, and prepares the builder and the check.
3. R, round 1: every source, page and figure.
4. Owners fix; the lead reads each.
5. P1 re-renders every page in one pass and rewrites the demo map; E2 widens the preflight; W builds the Word copies.
6. R, round 2: every page and Word copy.
7. The lead commits and deploys, with the built files already proven, and checks from outside.

**The review gate,** which R applies to every piece, page, figure and Word copy, and every owner applies before handing over:

1. **The story in order** (§4.1): the problem, what it is, what it does, why customers choose it, how it works, what a customer provides; in the narratives, every capability (§4.2) and every reason, unranked, with the weighing sentence (§4.3).
2. **The fixed sentences verbatim** (§4.4), each narrative carrying all four, and no other performance figure.
3. **No build-state or stage words** about the product: no "designed", "not yet", "today" against "later", "open", "planned" or "roadmap", and no stage or phase of a rollout.
4. **No labels:** no Built, Designed or Open, no chip, no legend, no verdict color.
5. **No customer, prospect or competitor name.**
6. **Quotations by industry,** each traced to S4, none carrying a gendered pronoun.
7. **The pronoun scan at zero:** no match for `\b(she|her|hers|he|him|his)\b`, in any case, in any piece, page, figure or Word copy.
8. **Every instrument explained before it is shown:** a plain lead above every figure, table of numbers, switcher and instrument.

**Each lane's own gate, beside it.**

- **E1:** the glossary's words are the material's words; no entry carries build state; the lead accepts the design.
- **C1, C2, C3:** a trace table in the lane note from each claim to S5, S4 or S2; the shape in §3.0 and the piece's own section in §3; the glossary's words only, and a search for every deprecated term finds none; no em-dash; American English; headings as statements; `#` once and `##` for sections; figures and links as §6 says; the name once; the word budget.
- **M1, H1:** the page and its markdown text agree; the arithmetic is the engine's, at its defaults; no request to any other address, no storage, no form, no inline style or script; every control reachable by keyboard, and every hint opening by hover, focus and tap; the page complete without its script; in headless Chrome at 1440×800, 1366×768 and 390×844, light and dark, no horizontal overflow, no console error and no outside request; H1's self-test passing.
- **D1:** §3.10's rules; no legend, chip or label word; each PNG matching its SVG; no text overflowing its box, in the three fonts; captions as titles; labels in the glossary's words.
- **P1:** the preflight and the text check pass for every page; on the built files, served locally, in headless Chrome at 1440×800, 1366×768 and 390×844, light and dark: no horizontal scroll, only same-origin requests, no console message, WCAG AA contrast for every text and background pair, the stamp and the footer line present, the skip link the first Tab stop, every page complete without JavaScript, and no legend anywhere.
- **E2:** each widened check in the preflight proven by a mutation that fails for the right reason; the worker's tests passing.
- **W:** each copy built by the unchanged converter; a title page and a linked contents; every in-document link resolving (the build fails otherwise); each figure rendering; the file named with its version. Not machine-verifiable: Ctrl+Click in Word and a PDF export; the owner tries one link on first opening.
- **R:** a PASS or FAIL per piece, page, figure and Word copy, every finding located to a line, covering the review gate above, the text check, the preflight, the rendering and the Word structure. R reviews pages as built files, since no script holds the passphrase, and writes nothing but `lanes/R.md`.

---

## 10. Out of scope

- Slide decks of any kind. The sales deck is instruction for the story, not material to copy (§4.5).
- Any change to the bodies of older documents, including `docs/README.md`. The first version of this design, filed under `research/`, keeps its list of superseded documents for a later correction.
- Anything customer-specific: no customer, prospect or competitor name, no customer's order form, no description of any customer's own systems, no customer-facing version of a piece.
- Any change to the engine, the demo workers, their settings or their secrets, and any deploy by a lane.
- New facts: S5 changes only through the lead, as S2 does.
- The passphrase itself, which is the owner's; the Microsoft sign-in that takes over from the gate; moving the material inside Optimizely.
- Search, analytics or forms on the site, and any script beyond `/site.js` and the two interactive pages' own scripts.

**Follow-ups carried from the first version's review** (`lanes/R.md`, R2.4 to R2.9), where their subject survives version 2 and the work is still to do. RE-1, RE-3 and RG-1 are done in the version 2 sources (`credits-source.html`, `credits.md`, `demos.md`), and the others went with the labels.

| Id | Where | The follow-up | Owner |
|---|---|---|---|
| RR-2 | `enablement/site/site.js`, `initTabs` | Set `aria-orientation="vertical"` on the tab list when it stacks on a phone, so assistive technology announces the up and down arrows the code already honors | P1 |
| RR-3 | `enablement/site/site.css` | Keep preformatted blocks on their lines on a phone and let them scroll sideways, so a formula in (d) does not wrap mid-formula | P1 |

---

## 11. Open decisions

None. The owner has ruled on everything the package needs (§12, 2026-10-02), and nobody asks again about a settled question. The name stays the working name under §2's conditions; its final choice belongs to marketing and is not a question this package raises.

---

## 12. Decisions log

Rows before the one marked **Version 2 begins** are the first version's history. Where version 2 contradicts them, version 2 governs.

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
| 2026-10-02 | **Row B7 reworded,** because "Every setting is a published, versioned document" overstated S2 §4.6: some settings are worker configuration that an engineer sets. It now reads "Every rule and weight the brand sets is a published, versioned document, in force without a software release, with its history and a rollback that is itself a new revision; identity and access settings are worker configuration set by an engineer." The verdict stays Built; C2 and C3 mirror it in (c) and (h). P1 and (d)'s rule use the similar phrase "every setting that can change an answer", left as they are | lead |
| 2026-10-02 | **P5 corrected,** from S2's correction round: "A page that asks the engine directly is recorded" becomes "A page that asks the engine directly is recorded when its slots use the default served basis", because a direct call that includes any slot on the rendered basis records nothing (`src/content/service.ts:557` at `8b4f74c`). The rest of P5 is unchanged. Row A1 repeats P5's words and takes the same insertion, as does the glossary's Recording entry; C2 and C3 make it in their verbatim copies | lead |
| 2026-10-02 | From review round two (R2-1): **OH is hosted** since `6484544`. §3.8 item 5 now reads "OH, a home-appliances demo built for one prospect, is hosted; ask the demo owner before showing it", and it stays under "not for showing as the engine" | lead |
| 2026-10-02 | **The illustration ruling:** a scaling illustration ("whether a site has one million sessions or ten million") is allowed when it is plainly an illustration and not a measurement, and never a timing figure. The credits page's corrections 7 and 35 rest on it (§4.3, §4.6) | lead |
| 2026-10-02 | §3.4 item 6 follows C2's reading: windows and eligibility rules are catalog fields, set through the API, not in the console (S2 §4.5) | lead |
| 2026-10-02 | **(c) as rebuilt is accepted** with two departures: it omits P8, whose content sits in the figure's lead and in rows B9, B11, B12 and A13; and it runs to about 3,260 words, because the tables the design mandates drive it (§3.0, §3.4) | lead |
| 2026-10-02 | **The Word copies** are named `Enablement-<Title>-v1.0.docx`, with no package name, and there are seven, the credits page's and the demo map's included. §1, §3 and §6 name them as built | lead |
| 2026-10-02 | Review round two's eleven non-blocking recommendations are listed in §10 as follow-ups for the next release, each with its owner | lead |
| 2026-10-02 | **Version 2 begins.** The owner rejected the package's foundation: facts in tables, no story, consent and labels as the spine. `LANE-BRIEF-V2.md` replaces the brief and overrides every conflicting rule in this design and in `LANE-BRIEF-COMMON.md`; the rows above stand as history wherever version 2 contradicts them | owner |
| 2026-10-02 | **The finished product only.** The material describes the product as it is when the current work is complete, in the present tense. Nothing about build state, build plans, stages, rollout order, "designed", "not yet", "today versus later" or "open" appears anywhere (the brief's §1; §5.2) | owner |
| 2026-10-02 | **Every capability counts,** including one built once for a customer or shown in an earlier demo, and the AI add-ons a customer may switch on with credits (AI search, the style concierge, generated imagery), told as optional (§4.2) | owner |
| 2026-10-02 | **All the reasons customers choose it, never ranked and never a win story.** Every reason, never attributed to one deal; each customer weighs them differently, and the material says so (§4.3) | owner |
| 2026-10-02 | **Performance as an aim and an average,** in one fixed sentence: "We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor." No other figure, no SLA language, no comparison figures. It replaces the first version's ban on every timing figure (§4.4) | owner |
| 2026-10-02 | **Quotations by industry.** Customers' words are quoted without the customer's name ("one of our customers in luxury retail said"); the working notes' positions become our unattributed statements; a quotation with a gendered pronoun is paraphrased (§5.1) | owner |
| 2026-10-02 | **The deck is instruction, not script.** It tells us what the story must carry; no piece copies its slides, its wording or its figures (§4.5) | owner |
| 2026-10-02 | **No re-asking.** The owner has ruled; a settled question is not raised again, and §11 lists no open decision | owner |
| 2026-10-02 | **One story, in one order, in every piece, and four fixed sentences verbatim:** the problem, what it is, what it does, why customers choose it, how it works, what a customer provides; the performance, learning, AI and recommendations sentences (the brief's §2 and §3; §4.1, §4.4) | owner |
| 2026-10-02 | **The lanes of version 2.** C1, C2 and C3 rewrite the three narratives from scratch. M1 builds See it work and H1 builds How it works, interactive, each with its markdown text. D1 redraws the three figures without legend or labels. P1 removes every label, chip and legend, retires `/status`, adds the two pages to the chrome and the landing page, and keeps the credits page and the demo map. C3 marks `status.md` as an engineering record, which the lead moves to `research/` (§9) | lead |
| 2026-10-02 | **The landing page** carries the brief's own two sentences on what the engine is as its lede, first and last; each card carries its piece's rule, read from the source; the interactive pages are linked from the marketing and solutions engineers' cards (§3.1, as P1 builds it) | lead |
| 2026-10-02 | **This design is rewritten as version 2,** §1 to §12 describing the rebuilt package. The first version, committed at `d41b4f6`, is kept whole as an engineering record, with its master rows and verdicts, facts discipline, carried paragraphs, open decisions, list of superseded documents and follow-ups, for the lead to file under `research/` (§8) | E1, on the lead's brief |
| 2026-10-02 | **The glossary for version 2.** Removed: the three label entries (Built, Designed, Open), "Demo only", "Durable recovery", "Generation 1, Generation 2" (whose words the text check's state-word scan fails on any page), the deprecation of "real-time", and the sentence on labels in "How to read it". Rewritten in the present tense: every entry that carried build state, among them Opal, ODP, Feature Experimentation, CMAB, Learning, Recording, Receipt, Memory, Console, Action weight and Typed search; the clauses that forbade a speed or a timing figure are gone from Edge and First paint. "Bucket" becomes the story's image of an interest, and "Before, during, after" no longer claims to be every piece's order. Kept: the bans on "stage" and "phase" as build words, with "Stage" now naming delivery too, and everything else. With the placement ruling below, 120 entries, 100 defined and 20 deprecated. This goes beyond the literal instruction, which named only what forbids a performance figure or the story's words, because version 2 bars build-state words anywhere and the review gate checks for labels (§3.8) | E1, on the lead's brief |
| 2026-10-02 | **Only the four fixed sentences are carried word for word.** The first version's carried paragraphs, P1 to P10, are retired; each narrative writes "what it is" and "where AI fits" in its own words to §4.6's points | E1 |
| 2026-10-02 | **Six Word copies, version 2.0:** what it is, selling it, how it works and where it runs, the credits page, the demo map and the glossary. The two interactive pages have no Word copy; their markdown exists for the text check only. The seven `-v1.0.docx` files are superseded, and the lead removes them (§6) | lead |
| 2026-10-02 | **The demo map is rewritten under version 2** by P1 as `content/demos.md`, its page's only source: each part of the story with the demos that show it, then each demo's beats, agreeing with (c)'s demo table, with OH by its address and the storefront for internal viewing only; §3.9 describes it as written | P1; recorded by E1 |
| 2026-10-02 | **The preflight widens for version 2** (§7): the page list loses `status` and gains the two interactive pages; each interactive page may load its own stylesheet and script from the site; the link allowlist adds OH's worker, which (c) links | E1, for lane E2 |
| 2026-10-02 | **Placement is defined, not deprecated.** The brief's reason "it honors the placements they sell" uses the word, so the glossary defines a placement as a section of a page that a merchandiser sells or reserves, honored through a pin; "slot" stays the word for the place the engine decides, and the pin entry names placements (§3.8) | lead |
| 2026-10-02 | **The status piece is filed** at `docs/enablement/research/status-engineering-record.md`, an engineering record outside the material (§8) | lead |
| 2026-10-02 | **The demo map's Word copy follows the page's title,** "Which demo shows which story": `Enablement-Which-Demo-Shows-Which-Story-v2.0.docx` (§1, §3.9, §6) | lead |
| 2026-10-02 | **From review round three (R3-14 and RR3-6), the glossary:** a pin holds the place the brand sets in a slot, first or any other, and a pinned piece that may not show is simply not shown while the rest ranks as usual; Placement says the same; a Gate entry is added, since the story's "gates, then pins, then ranking" had none; a seed adds an amount the brand publishes, lowered when the visitor's own audiences point elsewhere. 121 entries, 101 defined and 20 deprecated (§3.8) | lead, from R3-14 and R3.6 |
| 2026-10-03 | **Version 3 begins: the visual rebuild.** The owner approved the design as three mocks (`mocks/01`, `02`, `03`) and set three rules: story first, then show; the reader is an Optimizely colleague, never the customer, so the brand is in the third person; no section of any piece is only text. `LANE-BRIEF-V3.md` governs form, structure and tooling | owner; written by the lead |
| 2026-10-03 | **One spine for every reader,** reused from the six-slide visual brief "Keep your recommendations. Make the experience respond." (`research/live-experience-vs-recommendations.source.html`): the story, three contrasts (a recommendations engine, rule-based personalization, AI that decides), both engines on one page, the watch-it loop and the walk-through; stamped from one partial into every piece | owner's direction; lead |
| 2026-10-03 | **Hand-written pages** for what it is, see it work (the guided tour), selling it, the battlecard (new) and how it works, each with a markdown text of record and section pictures (`data-shot`) for Word; the builder renders only the landing page, credits, glossary and demos; the text check requires a drawing in every section, refuses "you" outside the reader's own elements, budgets prose, and reads customer and competitor names from `enablement/name-patterns.txt` | lead; lane S1 |
| 2026-10-03 | **The carousel keeps its real title "Recommended for you"** in the spine's pictures, as an interface label marked `data-ui-label` and exempt from the reader scan; the watch-it loop plays once and holds, with Play again (WCAG's five-second rule) | lead, on S1's report |
| 2026-10-03 | **The ten reasons appear on every audience piece,** the engineers' included (V2 §5: each piece the whole story at its reader's depth); the tour carries all four fixed sentences, the performance sentence in its step 2 | lead, on G1's and R's reports |
| 2026-10-03 | **Quotations come only from customers' own recorded words** (S4), by industry: luxury retail and home shopping; no other industry has such a source, so none is quoted | lead, on M2's report |
| 2026-10-03 | **A section opens with its heading and at most one lead line before its picture,** on the page and in Word; the instrument cards are one per row in landscape with one picture each so they print legibly | lead, on W2's findings |
| 2026-10-03 | **The converter changes:** a link inside bold builds as a bold hyperlink, and every heading keeps with its next paragraph; "the unchanged converter" in V3 §7.6 means the converter as committed in `819c6d9c` | lead, on W2's report |
| 2026-10-03 | **Minutes leave the timing scan:** a figure in minutes is an attribution window or a visit gap, never a speed claim; milliseconds and seconds stay | lead, on S1's question |
| 2026-10-03 | **Four Word copies, version 3.0:** what it is, selling it, how it works and where it runs, and the battlecard, each opening with the spine and carrying every section as a picture with its caption; the glossary, credits and demo map stay at 2.0 | lead |
| 2026-10-03 | **Version three deployed:** `edge-platform-bti` version `ab1d06c6` from commit `518d520f`, from a clean worktree, verified from outside (`lanes/E2.md`, "Version three deployed and verified"); review round four, its delta pass and its Word pass are in `lanes/R.md` | lead |
| 2026-10-03 | **The tour becomes one player, and the full opening appears once** (`LANE-BRIEF-V3.md` §8, `mocks/04`): the owner found the deployed tour unusable and the identical openings repetitive; What it is keeps the full spine, Selling it and How it works open with a one-band short form, See it work starts on the player, whose Next never greys out because Show me performs each step | owner ("GO"); written by the lead |
