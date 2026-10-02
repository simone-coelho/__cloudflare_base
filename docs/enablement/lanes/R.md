# Lane R: independent review, round 1

**Status, 2026-10-02.** Round one covers the four content sources as committed (`content/what-it-is.md`, `content/selling-it.md`, `content/how-it-works-and-where-it-runs.md`, `content/status.md`), the glossary, the three figures with `lanes/D1.md`, and a Word build of each source. The review was made at `91377a8`. Two commits landed while it ran, `f732eaf` and `4052d71`; they only make the verdict words in table cells bold in (b), (d) and (h). With the bold markers removed, all three files are identical to `91377a8`, and no line moved, so every reference below holds at `4052d71`; the quotations show the bold form. The design changed too (`074034d`), and §9.2 says what that changed for this review. The pages in `enablement/site/` are not reviewed: that is round two. This lane wrote this note and nothing else in the repository; scratch work is in the session scratchpad under `r1/`.

## 1. Verdicts

| Piece | Verdict | Required edits | Lead decisions | Recommended |
|---|---|---|---|---|
| (b) What it is | **Ready after listed edits** (round-one FAIL as committed) | 17 | 6 structural (§3.3 against the piece) | 4 |
| (c) Selling it | **Ready after listed edits** (round-one FAIL as committed) | 27 | 6 structural (§3.4 against the piece) | 2 |
| (d) How it works and where it runs | **Ready after listed edits** | 7 | 5 rulings | 2 |
| (h) What is built, designed and open | **Ready after one edit** | 1 | none | 1 |
| (f) Glossary | **Ready after one edit** | 1 | 1 ruling | 1 |
| Figure `architecture` | **Ready** | 0 | none | 1 |
| Figure `decision-path` | **Ready after one edit** | 1 | none | 0 |
| Figure `before-during-after` | **Ready after listed edits** | 4 | none | 2 |
| Word builds (all five sources) | **Build clean** | 0 | none | 0 |

**58 required edits, 12 structural decisions, 6 rulings and 13 recommendations.** Separately, 6 open defects in the design document and the common brief (§9.2; a seventh was fixed by `074034d` while this review ran) and 9 places where S2 itself is wrong or stale (§10).

The headline: (d), (h), the glossary and the figures are close. (b) and (c) carry the package's most dangerous sentences: "every decision gets a receipt" (in five places in (b) and four in (c), one of them labeled Built), "from the first day" and "it records from day one", a real-time claim labeled Built, a sub-second claim, and lines that describe other kinds of system. Both also depart from the design's §3.3 and §3.4 throughout (rule, headings, rows, P1, P2), and no §12 entry accepts that, as one does for (d). Section 2 states the decision the lead must take first.

## 2. The decision the lead must take before (b) and (c) can be fixed

(b) and (c) were committed in `5d23585`, before the design (`f4aa7ce`). The design then specified both pieces differently (§3.3, §3.4) and was never reconciled with them; (d) was, by the §12 entry "Piece (d) as accepted". The lead's rulings that kept C1's and C2's rules and headings (`lanes/C1.md` §8, `lanes/C2.md` §3) live only in lane notes, while the design says "every deviation is recorded in §12 before it ships". Two ways to close it:

1. **Accept (b) and (c) as built,** record them in §12, and rewrite §3.3 and §3.4 to describe them, as was done for (d). Then the required edits in §4 and §5 are enough, and the structural items S-b and S-c are waived on the record.
2. **Bring both to §3.3 and §3.4.** C1 and C2 rebuild on the design's shape, reusing what is sound. Most of (c)'s required edits are then absorbed by the rebuild; (b)'s are small either way.

My recommendation: option 1 for (b), because it satisfies the five binding rules once R-b1 puts the example before the mechanism, and its edits are local. Option 2 for (c), because its claims table labels never-say claims as Built, it lacks P1, P2, the twelve verbatim answers and the "Who sets what" table, and it does the demo map's job from sources the design reserves for the demo map; the fix list costs about as much as the rebuild.

## 3. Method

- **Read first:** `LANE-BRIEF-COMMON.md`; the design in full; `GLOSSARY.md`; S2 in full; the lane notes C1, C2, C3, D1 and E1.
- **Facts (check a).** For (b), all 75 rows of C1's trace table; for (c), all 49 rows of C2's; for (d), about 120 claims read against S2 section by section, because C3's note carries only round two's trace (P-d1); for (h), all 51 rows, the 11 path steps and the 14 decisions against S2 §10.1 to §10.3. Each piece was then read once for claims outside its trace table. Where S2 cites code, the lines were opened at `8b4f74c` with `git show` (list in §11.1).
- **Labels (check b)** against S2 §10.1, §10.2 and §10.4 and the design's §3.1. (h)'s rows and (d)'s B.8 were compared with the master list by script: all 51 rows are present in (h), 45 verbatim and 6 with their condition moved to the caveat column, which §3.1 permits.
- **Mechanical scans** over the four sources, the glossary and the three SVGs, by script: the design's gendered-pronoun pattern plus its two reflexive forms, whole word, any case; em and en dashes; British spellings; the glossary's deprecated words; timing words; model wording; "demo only"; receipt and day-one phrasing; customer, prospect, competitor and other real company or person names; links, anchors and site addresses; the verbatim paragraphs; the rule first and last; the package name (§11.2).
- **Figures (check j):** each re-captured in headless Chrome over CDP at device scale 2, as D1 did, served from the scratchpad on port 9417 by a server that exits by itself, Chrome closed with `Browser.close`; captures compared with the committed PNGs pixel by pixel; text placement audited; each PNG viewed.
- **Word (check k):** each source built with `scripts/md2docx.mjs` (sha256 `0b2159ee…`, W4's final, unchanged) in WSL into the scratchpad; the XML checked for unresolved links, bookmark ids, grids, figures, leaked markdown and gendered words; pages estimated from the XML with a layout model (TrueType metrics) that an earlier Word lane calibrated against a Word-saved document (§11.3).

## 4. (b) What it is, for marketing

**Verdict: ready after the 17 required edits below,** once the lead has taken the decision in §2.

**What holds.** One reader, named at the top. The rule is identical first and last (lines 5 and 102) and true to S2 §1, §3.1 and §4. The consent gate is stated (lines 21, 59, 77), "calls no AI model to decide" is present, P10 is verbatim (line 49), no latency figure appears, no em-dash, American spelling apart from "afterwards", zero gendered words, the package name once. Of C1's 75 trace rows, 67 hold against S2. The eight that fail, rows 11, 30, 33, 43, 57, 58, 60 and 71, are addressed below, and so are the sentences no row traces: the three contrasts (lines 9 to 15) and the receipt clauses at lines 25 and 37. The one in-document link resolves.

**Findings.**

1. *Receipt for every decision* (§4.9; S2 §3.15: receipts only with tracking consent, and through the SDK only on rendered slots with durable recovery on, which no configuration has): lines 15, 25, 37, 60, 81. C1 traces these to S2 §10.1's row "Receipts for every decision", which is S2's own error (S2-1).
2. *"From the first day"* (§4.9 "It learns from day one", "it records from day one"): line 29.
3. *Another kind of system described* (common brief: "we never describe or judge another system"; §4.9, last rows): lines 9, 11, 13, 15, the three contrasts. Line 13 also uses "segments", which the glossary deprecates, and §3.7 makes a deprecated word a review failure. The section also puts mechanism before the visitor's example, against binding rule 5.
4. *Untraceable constant:* "from minutes to weeks" (line 27). S2 §3.17 gives 14 days by default and at most 90, and no lower bound; minutes are the demos' memories, which §4.6 says are never the engine's.
5. *Factual error:* line 45 puts "tags for content that a person approves" under Opal. S2 §6.1 and §6.3: design-time tagging uses the brand's own model key, outside Opal, and its billing is open.
6. *P2 and the credits page's address are missing* (§3.0 item 7, §3.3 item 8); the section is called "Where the AI is".
7. *Links:* the other pieces and the credits page are italic titles with no address (lines 45, 91, 95 to 98), against §6. The credits title is in title case, unlike every other mention.
8. *Labels inconsistent with (d), (h) and S2:* the Designed row (line 54) reads as module order, which is Built (S2 §10.4 item 1, row D19), and D19 is absent from the Built row; the Open row (line 55) labels the whole deployment path Open, while S2 §10.2 and (h) show its first steps Built; the legend (line 31) adds "yet".
9. *Verdict cells carry text* (lines 35 to 39), against §3.0 item 5.
10. *Small wording:* "add to their bag" against the glossary's "add to cart"; demo addresses without the trailing slash that §3.8, (c) and (d) use; "native mobile app kit" against "native app SDK"; "The one exception:" without "to keep straight".

**Required edits.**

- **R-b1.** `what-it-is.md:7-15`, the section "## What it is not" with its four paragraphs, beginning "Three contrasts place it, each with a kind of system, never a product." → delete the section; move line 13's sentence "Even an audience follows from it: a visitor joins at one line and leaves only below a lower one, so no one flickers in and out." to the end of step 2 (line 23); and insert, after the "Where AI and credits fit" section, the design's §3.3 item 9 section, verbatim:
  "## What it does not do" / "It calls no AI model to decide. It does not paint the page; the site renders what it is sent. It does not need to know who the visitor is. It reads no device detail beyond the operating system family of the visitor's phone. It never stores the visitor's account id. ODP, Feature Experimentation and Opal are not in the decision path, and none is connected to it today."
  C1 may keep, as one more sentence there, "It needs no purchase history: with consent, it starts from the first thing a visitor does, even as a stranger."
- **R-b2.** `what-it-is.md:21`, "save, buy or add to their bag." → "save, buy or add to their cart."
- **R-b3.** `what-it-is.md:25`, "The brand's own page renders the answer, and every decision gets a receipt." → "The brand's own page renders the answer, and every answer carries its reasons."
- **R-b4.** `what-it-is.md:27`, "Each dimension can have its own memory, from minutes to weeks." → "Each dimension can have its own memory: 14 days by default, and at most 90."
- **R-b5.** `what-it-is.md:29`, "From the first day, the engine counts what each piece earned" → "With the visitor's consent, the engine counts what each piece earned"
- **R-b6.** `what-it-is.md:31`, "**Designed**, in an architecture document, not yet in the code" → "**Designed**, in an architecture document, not in the code"
- **R-b7.** `what-it-is.md:33-39`, the table "| Step | When | Verdict |", whose verdict cells read "**Built**: nothing, until the visitor makes an explicit choice" and so on → a four-column table with one word per verdict:

  | Step | When | What happens | Verdict |
  |---|---|---|---|
  | 1. What is watched | Before and on arrival | Nothing, until the visitor makes an explicit choice | **Built** |
  | 2. What is remembered | As the visitor browses | A graded interest per dimension value | **Built** |
  | 3. How a decision is made | Each time a page asks | The brand's rules first, then the visitor's interests; every answer carries its reasons | **Built** |
  | 4. What fades, and when | When the visitor leaves | Every interest, on a memory set per dimension | **Built** |
  | 5. How it learns | Afterward | It counts, and moves nothing until a person raises the learning dial; the one exception is below | **Built** |

- **R-b8.** `what-it-is.md:41`, "The one exception: on a customer's site," → "The one exception to keep straight: on a customer's site," (stands while the exception stays recording; see S-b4).
- **R-b9.** `what-it-is.md:43`, "## Where the AI is" → "## Where AI and credits fit"
- **R-b10.** `what-it-is.md:45`, the paragraph "The engine calls no AI model to decide, and even its receipts are written as data. Generative AI belongs to Opal, … *Where Opal and AI Credits Fit, and Where They Never Do*." → three paragraphs. First, P2 verbatim: "The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open." Then: "AI features a visitor uses directly, such as typed search, are separate and off by default. Tags for the brand's content can be proposed by the brand's own AI model, with a person approving each one, outside the decision; how that is billed is still open." Then: "The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits)."
- **R-b11.** `what-it-is.md:49`, "(https://edge-platform-vantage.expedge.workers.dev/vantage)" → "(https://edge-platform-vantage.expedge.workers.dev/vantage/)"; "(https://edge-platform-top-offers.expedge.workers.dev/top-offers)" → "(https://edge-platform-top-offers.expedge.workers.dev/top-offers/)"; "there is no native mobile app kit" → "there is no native app SDK"
- **R-b12.** `what-it-is.md:53`, "…and the other merchandising controls; receipts;" → "…and the other merchandising controls; the order of whatever sits in a slot, a stack of page modules included; receipts;" (row D19, which the design's §12 module ruling gives to (b)).
- **R-b13.** `what-it-is.md:54`, "Ordering a page's modules, its blocks such as a hero or a row of products, for each context;" → "Configuring a page's layout per context, such as by channel or visit;"
- **R-b14.** `what-it-is.md:55`, "The customer deployment path, from a customer's first settings to going live;" → "A customer deployment's first configuration, and the live gates before going live;"
- **R-b15.** `what-it-is.md:60`, "every decision is arithmetic, with a receipt that shows it." → "every decision is arithmetic, and every answer carries its reasons."
- **R-b16.** `what-it-is.md:81`, "No. Every decision has a receipt showing what was served and why." → "No. Every answer carries its reasons, and with the visitor's consent a receipt records what was served and why once recording is on."
- **R-b17.** Links, §6. `:91`, "See the credits page and *Selling it*, the account executive piece." → "See [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits) and [Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it), the account executive piece."; `:95`, "*Selling it*" → "[Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it)"; `:96`, "*How it works and where it runs*" → "[How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works)"; `:97`, "*Where Opal and AI Credits Fit, and Where They Never Do*" → "[Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits)"; `:98`, "*The glossary*" → "[Glossary](https://edge-platform-bti.expedge.workers.dev/glossary)".

**Recommended.**

- **R-b18.** `what-it-is.md:19`, "and afterwards." → "and afterward." (the American form most style guides prefer; line 39 is covered by R-b7).
- **R-b19.** `what-it-is.md:71`, the say-instead "It runs on Cloudflare's network, in the data center nearest each visitor." → "We quote no timing figure; timing is measured on the customer's own deployment." (§4.9's replacement, as (c) and (h) say it).
- **R-b20.** `what-it-is.md:77`, "keeps no device detail beyond iOS or Android, and does no fingerprinting." → "reads no device detail beyond the operating system family of the visitor's phone, and does no fingerprinting."
- **R-b21.** After `what-it-is.md:98`, add "- [What is built, designed and open](https://edge-platform-bti.expedge.workers.dev/status), every capability with its verdict."

**Structural, against §3.3 (required unless §12 records (b) as built).**

- **S-b1.** The rule (lines 5, 102) is C1's, not paragraph C ("A visitor's behavior sets their interests. The brand's team sets the rules. The engine ranks what is left, and gives its reasons."), which the landing page carries.
- **S-b2.** The sections and headings are C1's, not §3.3's (One visitor shows what it does; The engine in one paragraph, with P1; the three session sections; The name has two halves; Where AI and credits fit; What it does not do; Words to use, and words to avoid).
- **S-b3.** No session tables: rows B1, B2, B3, B4, B5, B7, D1, D2, D3, D4, D5 (first sentence), D8, D19, D14, A1, A2, A4 and A5 are not carried in the master list's wording.
- **S-b4.** The one exception is recording (line 41); §3.3 item 6 makes it A5, "learning is built, and it changes nothing until a person raises the learning dial."
- **S-b5.** The sentences to say and the never-say table are C1's; §3.3's (C, P4, P10, and the four never-say rows "AI-powered personalization", "It reads their mind", "One-to-one in real time", "A recommendations engine") are not used.
- **S-b6.** The headings are noun phrases ("What is true today", "Sentences to say"), against the common brief's "Headings are statements", while (d) and (h) use statements. The lead's waiver (C1.md §8 item 1) is not in §12.

## 5. (c) Selling it, for account executives

**Verdict: ready after the 27 required edits below,** or after the rebuild recommended in §2, which absorbs most of them.

**What holds.** One reader, named at the top; the rule identical first and last (lines 5, 153); the consent gate stated (lines 31, 98, 137); P10 verbatim (line 34); "Opal is not connected to the engine today" (line 67); the figure line alone and captioned with the SVG's title; both in-document anchors resolve; zero gendered words; no em-dash; no customer, prospect or competitor name. The customer table (lines 93 to 100), the commercial table (lines 64 to 70), the first four sentences of the recording exception (line 44) and most objections are accurate. Of C2's 49 trace rows, 31 hold against S2. The eighteen that fail, rows 1, 4, 7, 9, 13, 15, 16, 17, 18, 19, 21, 34, 35, 36, 40, 41, 46 and 48, are addressed below, and so is the untraced last sentence of line 44.

**Findings.**

1. *Never-say claims labeled Built:* "Real-time interest at the edge" (line 30), "A receipt for every decision" (line 38), "Learning that counts from day one" (line 39). Line 23 says that where the label is Built the claim stands, so the table licenses them.
2. *Receipt for every decision* in prose: lines 38, 54, 136 ("itemized on its receipt") and 141.
3. *Day one:* line 44 tells the reader to say "it records from day one" of the demos.
4. *Never rows given the label Open* (§3.1, "Never rows"): native apps (line 36; S2 §7.1 and §10.1: not built, "never sell it as available"), "It learns automatically" (line 40; autonomy is switched off by policy, S2 §5.6), "Sub-second decisions" (line 37; a timing figure in a form §4.3 bars outright).
5. *Module order labeled Designed* (line 34), against D19 (Built) in (d), (h) and S2 §10.4 item 1.
6. *Factual errors:* line 28, "only older demos show them, on demo data", includes Opal, of which no integration exists at all (S2 §6.2); the demos show a stand-in. Line 116 lists warehouse, search and tagging connectors, which are Built (S2 §10.2, row B10), under "all Open". Line 143, "every change is a published, versioned document", is not true of worker settings (S2 §4.6).
7. *Not in S2* (§4.1, §4.8): "the entire addressable population" (the rule); "It works alongside product recommendations" (line 135, which C1 declined for the same reason); the demo kit (line 111); the two tellings, "Who implements" and content and experience personalization "for one engagement" (lines 121 to 124), which §4.8 items 4 and 5 bar by name; the demo table's facts (lines 76 to 87), which the design sources from BOOTSTRAP for the demo map only.
8. *Another kind of system, and a share:* line 11, "site personalization for the few visitors a brand already knows".
9. *P2 and the credits page's address missing* (§3.0 item 7); the credits page is an italic title (line 72), and so are the other pieces (lines 147 to 150), against §6.
10. *Demos:* "Six hosted demos are ready to show" (line 76) includes the storefront, which §3.8 item 5 says is never shown to another company, and the bank demo, which shows the 2025 platform.
11. *Format and words:* `###` at line 42 (§6 allows `#` and `##` only); the legend's Designed reads "a design document" (line 20); "shopper traffic" (lines 62, 67, 142) where the glossary says visitor outside retail examples; "first click" (lines 5, 7) where S2 says first event.

**Required edits.**

- **R-c1.** `selling-it.md:5` and `:153`, "**With consent, the engine personalizes for the entire addressable population from the first click, by interest, not identity; claim only what is Built.**" → "**The engine personalizes for every visitor who consents, from their first event, by interest, not identity; claim only what is Built.**" (moot under S-c1).
- **R-c2.** `selling-it.md:7`, "For every visitor who consents, from their first click," → "For every visitor who consents, from their first event,"
- **R-c3.** `selling-it.md:11`, "It is not site personalization for the few visitors a brand already knows: it serves every visitor who consents, known or not." → "It serves every visitor who consents, known or not, from their first event."
- **R-c4.** `selling-it.md:20`, "Written in a design document, not in the code" → "In an architecture document, not in the code"
- **R-c5.** `selling-it.md:28`, the sentence cell "None of them is in the decision path: the engine decides on its own. How each connects to a customer deployment is being defined; only older demos show them, on demo data." → "None of them is in the decision path, and none is connected to it today. Connecting ODP or Feature Experimentation to a customer deployment is open; their connections run only for the default demo tenant, and the demos' Opal assistant is a stand-in."
- **R-c6.** `selling-it.md:30`, the claim cell "Real-time interest at the edge" → "Interest built in the visitor's session"
- **R-c7.** `selling-it.md:34`, the row "| During | The page rearranges itself for each visitor | **Designed** | For each visitor, … a designed next step. |" → two rows, and one objections row:
  "| During | It orders a page's modules for each visitor | **Built** | The engine orders whatever sits in a slot for each visitor, a stack of page modules included, and shows why. |"
  "| During | The page's layout changes with the context | **Designed** | Configuring a page's layout per context, such as by channel or visit; where each slot sits on the page stays the site's own template. |" (rows D19 and D16, verbatim)
  In the objections table: "| Does the page rearrange itself? | For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step. | The page rearranges itself for each visitor. |"
- **R-c8.** `selling-it.md:36`, delete the row "| During | It works in our native mobile apps | **Open** | … |"; add to the objections table "| Does it work in our native apps? | There is no native app SDK. | It runs in your native app. |"
- **R-c9.** `selling-it.md:37`, delete the row "| During | Sub-second decisions | **Open** | … |" (the objection "How fast is it?" already answers).
- **R-c10.** `selling-it.md:38` → "| During | Receipts that show why | **Built** | Every answer carries its reasons. With the visitor's consent, and once recording is on, a receipt keeps what was served, its strongest reasons and the arithmetic behind it, and your operators read it in the console ([the one exception](#the-one-exception-to-keep-straight-recording)). |"
- **R-c11.** `selling-it.md:39` → "| After | Learning that counts outcomes | **Built** | Learning is built, and it changes nothing until a person raises the learning dial, which starts at zero. On a customer's site it counts from the day recording is on ([the one exception](#the-one-exception-to-keep-straight-recording)). |"
- **R-c12.** `selling-it.md:40`, the row "| After | It learns automatically | **Open** | … |" → two rows (A8, A9), and one objections row:
  "| After | It explores less-tried pieces | **Built** | Exploration is built and off by default: it deliberately shows less-tried pieces so learning can find out how they do. |"
  "| After | Our choice of exploration | **Open** | Which form of exploration a customer is offered is open. |"
  In the objections table: "| Does it learn on its own? | It counts outcomes, and they move a ranking only as far as your team's learning dial allows. The engine changing its own weights is switched off by policy and never offered. | It learns automatically. |"
- **R-c13.** `selling-it.md:42`, "### The one exception to keep straight: recording" → "## The one exception to keep straight: recording" (the anchor is unchanged).
- **R-c14.** `selling-it.md:44`, the last sentence, 'So say "it records from day one" only of the demos, and "from the day recording is switched on" of a customer's site.' → "So say that the hosted demos record today, and that a customer's site records from the day recording is switched on."
- **R-c15.** `selling-it.md:54`, "5. Every decision has a receipt, the record of what was served and why, kept wherever recording is on." → "5. Every answer carries its reasons; receipts, the record of what was served and why, are kept with the visitor's consent once recording is on."
- **R-c16.** `selling-it.md:60`, "## The commercial lines and where credits apply" → "## Where AI and credits fit"; and `:62`, "The one rule, from the credits page: the engine decides and Opal creates and explains, so shopper traffic never consumes AI credits, and credits follow the team's activity." → P2 verbatim (the text given in R-b10).
- **R-c17.** `selling-it.md:72`, "The full map is the standalone credits page, *Where Opal and AI credits fit, and where they never do*." → "The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits)."
- **R-c18.** `selling-it.md:76`, "Six hosted demos are ready to show. Vantage and Top Offers run today's engine, each in its own deployment: show them as the product. Meridian, The Bright Hour, the bank demo and the storefront share an older build." → "Six demos are hosted. Vantage and Top Offers run today's engine, each in its own deployment: show them as the product. Meridian, The Bright Hour, the bank demo and the storefront share an older build, and the bank demo and the storefront are never shown as the engine." (S-c4 moves the section.)
- **R-c19.** `selling-it.md:111`, delete "- For demos, a kit that turns an existing demo into a new customer's demo, run by solutions engineers." (the demo map's §3.8 item 7 carries it).
- **R-c20.** `selling-it.md:116`, "- Connectors: ODP and Feature Experimentation are not yet admitted on a customer deployment; warehouse, search and tagging connectors are." → "- Connectors: ODP and Feature Experimentation are not yet admitted on a customer deployment."; and add under "What exists": "- Connectors for telemetry, design-time tagging, search, catalog search and the warehouse, admitted by the workflow (**Built**)."
- **R-c21.** `selling-it.md:121-124`, delete "**Two tellings in our own material disagree.** Treat both as open and promise neither." and both of its bullets.
- **R-c22.** `selling-it.md:135`, "It works alongside product recommendations: it ranks your own content for each place on the page, for visitors nobody has identified, and gives the reason for every choice." → the design's answer, "It decides what each decided place on a page shows, and in what order, for a visitor nobody has identified, and it says why. It ranks the brand's own published content, and it can also re-rank a product list the commerce platform supplies."
- **R-c23.** `selling-it.md:136`, "It calls no AI model to decide. Every decision is arithmetic, itemized on its receipt; its intelligence is counted learning behind a dial your team controls." → the design's answer, "No. It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons. AI belongs to authoring and analysis, in Opal, which is not connected to the engine today."
- **R-c24.** `selling-it.md:141`, "Yes. Every decision has a receipt with what was served, its strongest reasons and the arithmetic; your operators read it in the console once recording is on." → "Yes. Every answer carries its reasons. With the visitor's consent, and once recording is on, a receipt keeps what was served, its strongest reasons and the arithmetic, and your operators read it in the console."
- **R-c25.** `selling-it.md:143`, "every change is a published, versioned document that records who changed it and why" → "every change to a published document is a new revision that records who changed it and why"
- **R-c26.** Links, §6. `:147`, "*What it is*" → "[What it is](https://edge-platform-bti.expedge.workers.dev/what-it-is)"; `:148`, "*How it works and where it runs*" → "[How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works)"; `:149`, "*Where Opal and AI credits fit, and where they never do*" → "[Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits)"; `:150`, "*Glossary*" → "[Glossary](https://edge-platform-bti.expedge.workers.dev/glossary)".
- **R-c27.** `selling-it.md:67`, "never shopper traffic" → "never the site's traffic"; `:142`, "so shopper traffic never consumes credits" → "so the site's traffic never consumes credits" (line 62 goes with R-c16).

**Recommended.**

- **R-c28.** `selling-it.md:25`, the column header "Label" → "Verdict", as in (d), (h) and the design's tables.
- **R-c29.** Define "slot" and "piece" at first use (lines 34 and 40); the definitions now arrive at lines 99 and 96.

**Structural, against §3.4 (required unless §12 records (c) as built).**

- **S-c1.** The rule is C2's, not "Sell what is built, label what is designed, and promise nothing that is open."
- **S-c2.** The sections are C2's. Missing: One visitor, three moments; What you are selling fits in one paragraph (P1 and the name sentence); Who sets what; The questions customers ask have true answers (§3.4's twelve verbatim answers; the storage and retention answer is wholly absent); Bring a solutions engineer when the question is how, not what; Sentences to say, and sentences never to say (a two-column table carrying §3.4's four rows). The customer table carries six of S2 §7.7's eleven asks.
- **S-c3.** No session tables in the master list's wording. Not carried at all: A11 (erasure), A6 (holdout, apart from the commercial table), D2 (arrival seeds), D6 (the score's order), B12 (retention, apart from the customer table).
- **S-c4.** "Which demo to show to whom" (lines 74 to 87) belongs to the demo map: §3.4 answers "Which demo should I show?" with "The demo map answers that:" and its address, and §4.1 sources demo facts from BOOTSTRAP for the demo map only. Move the table to `content/demo-map.md`, reconciled with §3.8, link [Demo map](https://edge-platform-bti.expedge.workers.dev/demos), and keep line 87's legal sentence.
- **S-c5.** The headings are noun phrases, against the common brief; the waiver (C2.md §3) is not in §12.
- **S-c6.** Length: 2,842 words with tables (1,059 of prose) against §3.0's 1,800 to 2,400. The coordinator kept it (C2.md §5); §12 does not record it.

## 6. (d) How it works and where it runs, for solutions engineers

**Verdict: ready after the 7 required edits below,** with the lead's five rulings.

**What holds.** One reader, named at the top; the rule identical first and last (lines 5, 373) and true to S2 §1, §3.14 and §6.1, with the recording condition stated in A.5 and A.8 as §3.5 accepts. P2 verbatim (line 110) and the credits page linked by its title at its address (line 112); P10 verbatim in A.8's table; B.8's ten rows exactly the master list's wording and verdicts; all 30 in-document links resolve; the site addresses are /glossary, /credits and /status with no trailing slash; both captions equal their SVG titles; the formulas are exactly S2 §3.4, §3.6 and §3.11; every published constant and budget I checked matches S2 §3.17 and §9.3 and the code (§11.1). No timing figure; the staging account in B.7 quotes none. Zero gendered words; no em-dash; no deprecated word (the `stage`, `shopper` and `realtime` hits are journey stage, the shopper capability, a console screen's name and route paths).

**Required edits.**

- **R-d1.** `how-it-works-and-where-it-runs.md:125`, "a pruning floor of 0.0001 and 24 values per dimension, each open to a per-dimension override." → "a pruning floor of 0.0001 and 24 values per dimension; τ, K and both lines can each be set per dimension." S2 §3.4; at `8b4f74c`, `src/reflex/core.ts:39-43` and `:276-283` override τ, K, θ_in and θ_out only.
- **R-d2.** `how-it-works-and-where-it-runs.md:32`, "Pinned pieces come first. The rest follow by score, with a cap on pieces that share one value." → "Pinned pieces come first, and are never scored. The rest follow by score, with a cap on pieces that share one value." S2 §1 ("eligibility and pins first; then the interest sum"), §3.10; `src/reflex/contentCompose.ts:182` ("Reserve before any ranking") and `:233-234` (score 0, "ranking never ran for this piece"). B.1 steps 8 and 9 already have it right, so the walk and the detail now disagree. Paired with R-F2.
- **R-d3.** `how-it-works-and-where-it-runs.md:124`, "A value outside the catalog's vocabulary builds nothing on that dimension." → "Where the catalog names values on a dimension, an event value outside them builds nothing on it." (S2 §3.3 item 7: a dimension the catalog names nothing on admits every value.)
- **R-d4.** `how-it-works-and-where-it-runs.md:256`, "The merged profile" → "The two profiles merge" (S2 §2.7 arrow 18 says what happens, not what the call returns).
- **R-d5.** `how-it-works-and-where-it-runs.md:367`, delete the row "| `docs/PS-Implementation-Runbook.md` | The services motion |". The design's §8 lists that document as unsafe to reuse for these readers (wrong in four places; "arrives automated"), replaced by (d) and S2 §10.2.
- **R-d6.** `how-it-works-and-where-it-runs.md:185`, "6 hours for wishlist and add to bag" → "6 hours for wishlist and add to cart" (the glossary's word).
- **R-d7.** `how-it-works-and-where-it-runs.md:94`, "product re-ordering" → "product re-ranking" (the glossary's entry; B.8 and (h)'s row D9).

**For the lead's ruling.**

- **L-d1.** `:13`, "brand = samsung" names a real company. The common brief itself uses it, and so does the glossary, three times (L-f1). If ruled out: "category = coats", the marketing piece's example.
- **L-d2.** `:264`, "a dataLayer adapter with GA4 names" names a real company's product (S2 §7.1). If ruled out: "a dataLayer adapter with standard analytics event names".
- **L-d3.** `:290-302`, B.6's "In the code" column gives source paths; the design's §1 says this reader never needs code paths. Drop the column, or record the exception with (d)'s acceptance.
- **L-d4.** `:370`, the two staging measurement documents hold the figures §4.3 bars, and pointing an SE at them invites a quote. Suggest dropping the row; S2 §9.1 already describes the method.
- **L-d5.** `:362-371`, six of B.9's eight rows point at documents that carry customer names (from 2 to 15 mentions a file, most in the integration kit and the audit). Keep them as engineer-only references, with a line saying they are never forwarded to a customer, or drop them.

**Recommended.**

- **R-d8.** `:104`, "The engine decides; Opal creates and explains." → "The engine decides; Opal creates and explains. Opal is not connected to the engine today." (the design keeps that sentence beside the Opal rule, §12).
- **R-d9.** `:360`, a reader cannot find the Vantage technical note from this sentence; say how to obtain it, or drop the sentence.

**Process.** **P-d1.** C3's note traces only round two's changes to (d) and says round one's trace "stands as written then", but that trace is not in the committed note. The C gate asks for every engine statement traced in the lane note. I checked (d) against S2 directly instead; C3 should restore the full trace.

## 7. (h) What is built, designed and open, for anyone at Optimizely

**Verdict: ready after one edit.** Every one of the master list's 51 rows is present, in order, with its verdict; the six rows from C3 move their condition into the caveat column, which §3.1 permits. Every caveat matches S2 §10.1, and none repeats its row. The path matches S2 §10.2 step for step. The fourteen open decisions and their owners match S2 §10.3, with vendor names generalized. The front matter carries the legend verbatim and the stamp "Engine facts as of commit 8b4f74c, October 2, 2026". P2, P4, P5, P7, P8, P9 and P10 are verbatim; the sections follow §3.10 exactly; "demo only" appears only as words in caveats; the rule is identical first and last; zero gendered words.

- **R-h1.** `status.md:108`, "The production memory and its entry and exit lines" → "The production memory, K and the entry and exit lines" (S2 §10.3: "τ, K, lines").
- **R-h2** (recommended). `status.md:144`, "The module sentence above" → P10 verbatim, since §3.10 says the never-say table carries P10.

## 8. The glossary, and the figures

### 8.1 Glossary

**Verdict: ready after one edit.** I checked all 104 defined entries against S2, with the code lines in §11.1 behind the numbers, and the 23 deprecated ones against the design's vocabulary ruling (§12); every one holds but Outcome. The order is alphabetical throughout; zero gendered words; no em-dash; American spelling. It builds to Word with all 23 links landing.

- **R-f1.** `GLOSSARY.md:191`, "or an outcome the brand names. A named partner outcome, such as a referral, is credited like a click and never reported as a sale." → "or one of two named partner outcomes, a pickup at a partner store or a referral to a partner retailer. A named partner outcome is credited like a click and never reported as a sale." The named outcomes are a fixed list in code (S2 §3.15; `src/ledger/records.ts:207` and `:211-219`); a brand cannot name its own.
- **L-f1** (ruling, with L-d1). `:15`, "brand_samsung_affinity" → "category_coats_affinity"; `:83`, "brand = samsung" → "category = coats"; `:283`, "brand: samsung" → "category: coats".
- **R-f2** (recommended). `:79`, "Written in an architecture or planning document, not in the code." → "In an architecture document, not in the code.", the legend's words, as (d) and (h) give them.

### 8.2 Figures

All three keep §3.9's rules: presentation attributes only, prefixed ids, a title and a description through `aria-labeledby`, no digit but "R2" and "D1", no timing word, no em-dash, zero gendered words, the one legend. Each re-capture matches its committed PNG: at most 17 pixels in a figure differ by more than a quarter of the range, and the rest is anti-aliasing, so each PNG is its SVG. No text runs off the canvas or out of its box. The smallest text is 18 px, 7.7 pt at 6.5 in, as D1 states. Every arrow in the architecture figure matches an arrow in S2 §2.7 in direction, and every box and step traces to S2.

- **R-F1, `before-during-after.svg`: the bands read as a second legend** (the design's §3.9 asks R to check this; §12, one legend). The row at lines 162 to 166 is a color key headed "Verdict:", the word every table in the package uses for Built, Designed and Open, and its "Credits not decided" band (lines 64 and 166) is drawn exactly as the Open chip is: white, with a 2 px dashed Dark Fir border, dashes 5 and 4. Required:
  - (a) `:162`, "Verdict:" → "Credits:", or delete the key row at lines 162 to 166, since every band carries its own words;
  - (b) `:64` and `:166`, the "Credits not decided" band, white with `stroke-dasharray="5 4"` → a style no status chip uses, for example white with a solid 2 px Neutral 5 (`#C3CEAF`) border;
  - (c) `:183`, "Verdicts follow the documented credit rule, which is Designed; the billing meter is Open." → "The credit bands follow the documented credit rule, which is Designed; the billing meter is Open.";
  - (d) `:65-67`, "A model on the customer's own key suggests content labels; a person approves each one." → "A model on the customer's own key suggests tags for content; a person approves each one." (the glossary's word; the package's "labels" are its three).
  The description at line 3 follows each change; D1 re-audits and re-captures the PNG. Since `074034d` this figure is also shown on (b)'s page, as a switcher (design §3.3), so the fix matters there too. Recommended: `:157-158`, "asking Opal about it does." → "asking Opal about it would." (Opal is not wired today); and the comment at line 5, "three phases" → "three parts".
- **R-F2, `decision-path.svg:152-156`,** step 8's body "Pinned pieces first; the rest by score, with a cap on pieces that share a value." → "Pinned pieces first, unscored; the rest by score, capped where they share a value." (five lines that fit the box: "Pinned pieces / first, unscored; / the rest by score, / capped where they / share a value."), with the description at line 3 to match. The figure orders the score before the pins, while S2 §1 and §3.10 and the code reserve pins before any score; the words fix it without moving a box. Paired with R-d2.
- **`architecture.svg`: ready.** Recommended: "worker" → "Worker" in the box titles and zones (lines 83, 91, 121, 147), as the glossary and (d)'s A.3 table spell it.

## 9. Across the pieces, and in the design and the brief

### 9.1 Consistency (check i)

| Item | (b) | (c) | (d) | (h) and the glossary | Edits |
|---|---|---|---|---|---|
| Legend, Designed | "not yet in the code" | "a design document" | verbatim | verbatim; glossary "architecture or planning" | R-b6, R-c4, R-f2 |
| Module order | Designed row reads as module order; no D19 | one row, Designed | order Built, layout Designed | D19 Built, D16 Designed | R-b12, R-b13, R-c7 |
| Native app SDK | "mobile app kit" | labeled Open | none | never-say; "native app SDK" | R-b11, R-c8 |
| Autonomy | never-say | labeled Open | never-say | never-say | R-c12 |
| Timing | never-say | "Sub-second", Open | never-say | never-say | R-c9 |
| Receipts | five "every decision" lines | four, one labeled Built | consent and recording | rows A1, A2 | R-b3, R-b7, R-b15, R-b16, R-c10, R-c15, R-c23, R-c24 |
| Day one | "From the first day" | "counts from day one" (Built); "say it records from day one" | none | never-say | R-b5, R-c11, R-c14 |
| Deployment path | all Open | Open, with Built items mixed in | the first configuration is open | built up to the first configuration | R-b14, R-c20 |
| Memory | "minutes to weeks" | none | 14 days, at most 90 | the same | R-b4 |
| Credits page link | italic, title case | italic | linked by title | linked by title | R-b10, R-b17, R-c17, R-c26 |
| Demo addresses | no trailing slash | trailing slash | trailing slash | none | R-b11 |
| Add to cart | "add to their bag" | none | "add to bag" | glossary "add to cart" | R-b2, R-d6 |
| Opal in the demos | none | "older demos show them" | "a stand-in" | B16's caveat | R-c5 |

C2's note (§3) says the SE piece labels native apps the same way; it does not, and (h) holds it as a never-say. The constants agree wherever they appear: consent 30 days; the shopper capability 24 hours; the attribution windows of 30 minutes, 6 hours and 7 days; K 1.8 with 0.357, 0.526 and 0.625 at a view weight of 1; the lines 0.6 and 0.45; lift and the merchandising clamp from half to double; a take of 1 to 50. The titles match §3.3 to §3.10; every site address in (d) and (h) is on §7's list without a trailing slash; both captions equal their SVG titles.

### 9.2 Defects in the design document and the common brief (for the lead and E1)

Checked at `074034d`, which landed during this review. That commit changes nothing in §3.3 or §3.4, so the decision in §2 stands; it adds the session figure to (b)'s page as a switcher (§3.3), makes `content/credits-source.html` the credits page's source (§3.6, §6), and asks R to check the credits page's credit tags as well as the figure's bands (§3.9).

- **D-1.** Fixed by `074034d`: §3.9 had captioned `before-during-after` "One shopper's session …"; it now carries the SVG's title, "One visitor's session: what happens before, during and after".
- **D-2.** §3.9 says `architecture` shows "the optional outside services, all off by default"; D1 left them out (D1.md §2.1), and (d) says so.
- **D-3.** §3.0's verbatim table lists (d) under P1, P3, P4, P6, P7 and P9, but §3.5, (d) as accepted, carries only P2 and P10 verbatim, with P5 to P8 in its own words; P1, P3, P4 and P9 are not addressed for (d).
- **D-4.** The §12 entry "One color legend per page" names the credit words "Credits apply", "No credits" and "Per use"; §3.6 change 8 and the figure use "No AI · no credits", "Credits apply", "Metered per use" and "Credits not decided".
- **D-5.** §1's SE reader "never needs" code paths, while (d)'s B.6 and B.9 give them (L-d3).
- **D-6.** The common brief, the law, still says the site is `edge-platform-enablement` with an @optimizely.com sign-in (line 10), "trust dial (γ)" (line 37) and "personalised" (line 34); the design and E1's note settled all three otherwise.
- **D-7.** The rulings that keep C1's and C2's rules and headings are only in lane notes (§2).

### 9.3 Not reviewed in round one

- **(a), (e) and (g) had no committed source.** Since `074034d` the landing page renders the design's §3.2 and the demo map its §3.8, until `content/demo-map.md` exists; the credits page's source is `content/credits-source.html`. During this review three uncommitted files appeared in `content/`: `credits-source.html`, `credits.md` and `demos.md`. None is committed or in this round's brief, so none is reviewed. `demos.md` is not the name the design gives the demo map's source (`content/demo-map.md`). Each of (a), (e) and (g) needs its round one, and (e)'s must include the check §3.9 now asks for, that the credit tags cannot be read as a second label legend.
- **Word copies already built.** `docs/enablement/word/` holds four uncommitted Word copies, built before this round finished (the design's order puts W after round one and the lead's read), and named differently from the design's §1 table, for example `Enablement-Glossary-v1.0.docx` against `word/Glossary-v1.0.docx`. They are round two's. C1's note warns that with `core.autocrlf` set, a checkout can turn a source's line endings to CRLF, which the converter refuses; the working copies are LF today.
- **The pages** under `enablement/site/`, by the brief: round two.

## 10. Where S2 itself is wrong or stale

- **S2-1.** §10.1's row title "Receipts for every decision", labeled Built, is the never-say phrase and contradicts S2's own §3.15. C1 cites it (rows 11 and 39) for the receipt claims corrected above, and (c)'s claim "A receipt for every decision" (line 38) repeats its words. Suggest "Receipts", with the recording condition as its caveat.
- **S2-2.** §5.1's heading "What is recorded from day one" is the basis C1 cites (row 33) for "From the first day". Suggest "What is recorded, and when".
- **S2-3.** §10.1 keeps the row "Module sequencing and per-context layout | Designed" although §10.4 replaces it. A reader of §10.1 alone labels module order Designed, as (b) and (c) did. Suggest editing the row in place to point at §10.4's three labels.
- **S2-4.** §3.4, "an interest halves every τ · ln 2": it is the raw score that halves (the design's §4.7 item 2).
- **S2-5.** §3.4's "worked arithmetic at the defaults" assumes a view weight of 1, compiled only for two older demo scopes (§4.7 item 3).
- **S2-6.** §1's corrected paragraph: "each with a receipt that shows the arithmetic" and "a merchandiser changes" (§4.7 item 1).
- **S2-7.** §5.7's honesty wording, "It records from day one", contradicts §3.15 and §5.1 (§4.7 item 4).
- **S2-8.** §0, and the brief, say "trust dial"; the package says learning dial (§4.7 item 5).
- **S2-9.** §2.6 describes the enablement site as `edge-platform-enablement`, with "No engine code, no bindings, no variables, no secrets". The site moved to `edge-platform-bti` behind a passphrase gate, which holds a secret (the design's §7; `8086cb1`). Not an engine fact, but stale.

Since `8b4f74c` the engine code has changed only for the OH demo (`src/demos/oh.config.ts`, `src/routes/oh.ts` with its test, and its mount in `src/index.ts`), so no claim reviewed here moves.

## 11. Evidence

### 11.1 Code lines opened at `8b4f74c`

Consent: `src/content/consent.ts:1-20`, `:170-190`. Interest: `src/reflex/core.ts:18-24`, `:24-58`, `:60-72`, `:78-116`, `:240-265`, `:270-300`, `:488-512`, `:570-578`; `src/reflex/configStore.ts:125-137`, `:405-420`, and its τ bounds (above 0, at most 90 days). Catalog: `src/demos/registry.ts:215-228`. Composition: `src/reflex/contentCompose.ts:140-345`. Learning: `src/learn/stats.ts:15-25`, `:445-452`; `src/content/service.ts:469-480`, `:486-492`; `src/content/kinds.ts:320-342`, `:474-498`, `:648-656`, `:695-708`; `src/content/decide.ts:1-8`, `:368-392`; `src/learn/cycle.ts:1-4`, `:42-46`; `src/content/holdout.ts:278-290`. Recording: `src/sdk/listen.ts:174-182`; `src/sdk/README.md:58-68`; `src/content/service.ts:550-565`, `:592-602`; `src/ledger/recovery.ts:295-300`; `src/content/renderOffer.ts:96-100`; `wrangler.toml:150-158`, `:234-238`, `:333-337`; `wrangler.vantage.toml:122-128`; and a `git grep` finding no page instance in `public/top-offers`, `public/vantage` or `public/demo-kit`. Outcomes: `src/learn/policy.ts:20-30`; `src/learn/report.ts:610-620`; `src/ledger/records.ts:100-160`, `:194-225`. Identity: `src/identity/sessionCapability.ts:10-16`; `src/identity/shopperId.ts:1-18`; `src/reflex/identityMerge.ts:6-24`. Visit and region: `src/services/visit.ts:28-38`; `src/services/JourneyStage.ts:120-140`, `:178-188`; `src/reflex/regionTrend.ts:26-32`, `:214-224`. Products and models: `src/reflex/sortCandidates.ts:5-34`; `src/routes/sort.ts:36-42`; `src/routes/search.ts:35-48`; `src/content/enrichmentGeneration.ts:10-30`. Deployment: `scripts/stamp-workflow.mjs:226-230`; `src/routes/demoBootstrap.ts:5-15`; `src/identity/erase.ts:1-3`; `src/ledger/erasure.ts:63-66`; `src/retention.ts:49-60`. Requests: `src/services/platform.ts:1-16`; `src/routes/decisions.ts:565-582`, `:596-615`, `:636-642`. Module order: `public/vantage/vantage.js:40-48`, `:715-733`, `:948-968`; `public/top-offers/top-offers.js:206-214`; `public/demo-kit/transport.js:196-201`; `public/vantage/beats/open-slots.json:120-140`. Every cited line says what S2 says; the two places where a piece goes beyond its S2 line are R-d1 and R-f1.

### 11.2 Scans (four sources, the glossary and three SVGs)

| Scan | Result |
|---|---|
| The design's gendered-pronoun pattern with its two reflexive forms, whole word, any case | 0 in all eight files, and 0 in the text of all five Word builds |
| Em and en dashes | 0 |
| British spellings | 0; "afterwards" twice in (b) (R-b18) and once in the glossary, where it may stay |
| Deprecated words | (b) "segments", line 13; (c) "Real-time", line 30, and "shopper traffic", lines 62, 67, 142; none in (d), (h) or the figures' visible text |
| Timing | no figure outside never-say columns, except (c)'s "Sub-second", line 37 |
| Names | none of the brief's names anywhere; "samsung" in (d) and the glossary, "GA4" in (d), "iOS or Android" in (b), "SWAT" in (c) |
| "Calls no AI model to decide" | in every source; the figures say "Calls no AI model to decide" (before-during-after), "Nothing in this picture calls an AI model to decide" (architecture) and "No step here calls an AI model to decide" (decision-path) |
| "Demo only" | only as words: (c) line 68, (d) line 244, (h)'s caveats, the figure's chip text |
| Package name | once in each source, in its title |

### 11.3 Word builds (check k)

Arguments: each source's title line as the title; the subtitle "For <reader> · engine facts as of commit 8b4f74c"; prepared for "Optimizely staff"; version "1.0"; the date "October 2, 2026"; "Confidential". Built twice, at `91377a8` (`r1/word/`) and again at `4052d71` (`r1/word2/`) after the bold change; both sets give the figures below. Every build ran with no warning and no problem list. The page counts are a layout estimate, not Word's.

| Source | Blocks | Internal links, all landing | External links | Figures | Table grids | Pages (body) |
|---|---|---|---|---|---|---|
| what-it-is | 52 from 103 lines | 10 | 2 | 0 | all 9,360 | 6 (4) |
| selling-it | 74 from 154 | 12 | 7 | 1 | all 9,360 | 11 (9) |
| how-it-works-and-where-it-runs | 157 from 374 | 55 | 5 | 2 | all 9,360 | 20 (18): Part A pages 3 to 9, Part B 9 to 20 |
| status | 38 from 147 | 8 | 3 | 0 | all 9,360 | 9 (7) |
| GLOSSARY | 154 from 308 | 23 | 0 | 0 | all 9,360 | 12 (10) |

Bookmark ids are unique, no markdown leaks into the text, and each figure's description is its caption. The cover, the contents and the title heading each print the package name, three times in all, which the converter generates (the design's §2).

## 12. Conduct

No git command that changes anything, no install, no delete, no deploy, no kill. Scratch files are in `scratchpad/r1/` (scans, the builds in `r1/word/` and `r1/word2/`, the captures in `r1/fig/`). One slip: a version probe ran `chrome.exe` without `--headless`, and Chrome answered "Opening in existing browser session", so it may have opened a window in the owner's running Chrome. Nothing was closed; the owner may close that window. Every later Chrome run was headless on its own profile and ended with `Browser.close`.

## 13. For round two

Each required edit above verified in its source before P1 renders; the pages reviewed as built files against their sources (the render check, the preflight, the four widths in light and dark, and the session switcher on (b)'s page); each Word copy rebuilt from the edited sources and named as the design's §1 table names it; and round one for (a), (e) and (g), with (e)'s credit tags checked against the one-legend ruling.
