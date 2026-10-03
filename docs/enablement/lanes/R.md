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

---

# Round two, 2026-10-02

**Scope, from the coordinator:** (1) the four pieces and the glossary against round one's edits and the lead's rulings; (2) the rendered pages in `enablement/site/`; (3) the credits page against `content/credits-source.html` and `content/credits.md`; (4) the demo map against design §3.8, and the glossary page against `GLOSSARY.md`; (5) no credential and no form on any page. The gate is out of scope.

**Commit.** Reviewed at `8a4252c`, the commit after `39e7ec9`. Three commits landed while the round ran: `a412113` and `b32f360` (Word copies) and `748f976`, which replaces a person's name with "the demo owner" in §3.8, `demos.md` and `demos.html`. Every page I audited is byte-identical to its copy at `b32f360`, so the verdicts hold there. The next commit, `2aefcf7`, touches only the OH demo's files and nothing under `docs/enablement`, `enablement` or BOOTSTRAP, so they hold at that HEAD too. The working tree also carries uncommitted edits to `enablement/render-check.mjs` and `lanes/C3.md`; I ran the committed check as well (R2.2).

## R2.1 Verdicts

| Piece or page | Verdict | Required | Recommended |
|---|---|---|---|
| (b) What it is | **Ready.** Every round-one edit landed; R-b1 is replaced by the lead's contrast ruling, whose conditions it meets | 0 | 0 |
| (c) Selling it, rebuilt | **Ready after one edit** | 1 | 1 |
| (d) How it works and where it runs | **Ready.** R-d1 to R-d9 landed; L-d1 to L-d5 as ruled; C3's full trace restored | 0 | 0 |
| (h) What is built, designed and open | **Ready** | 0 | 0 |
| Glossary, source and page | **Ready** | 0 | 1 |
| Figures | **Ready.** R-F1 and R-F2 landed, with both recommendations | 0 | 2 |
| (e) The credits page | **Ready after two edits** | 2 | 3 |
| (g) The demo map | **Ready after one edit** | 1 | 1 |
| The site: chrome, links, figures, keyboard, console, requests, contrast, no script | **Ready** | 0 | 3 |
| Credentials and forms | **None on any page** | 0 | 0 |

**Deploy verdict: deploy after the four required edits in R2.8.** Each is one phrase, in a source, so the order is: edit the source, run `node enablement/render-pages.mjs`, then `node enablement/render-check.mjs` and `node enablement/check-site.mjs`. Rebuild the Word copies of (c), (e) and (g), which carry the same four phrases. Nothing else blocks the deploy. **4 required edits, 11 recommendations, 6 items for the lead's record** (R2.10).

## R2.2 What I ran

- **The text check:** `node enablement/render-check.mjs` passes on every page, 0 missing and 0 unexplained sentences. It also passes in its committed form on HEAD's own tree, which I extracted read-only with `git archive` into the scratchpad.
- **The preflight:** `node enablement/check-site.mjs` passes 116 of 116, the gate's 33 unit tests and the text check included.
- **The pages are what the sources make.** A dry run of the builder (`render-pages.mjs --out`, into the scratchpad) is byte-identical to the working tree's `enablement/site/`. From HEAD's sources it gives all 15 committed files exactly, once line endings are ignored. The only difference anywhere is CRLF in the Windows working copies of the three figure files, which the checkout's `core.autocrlf` adds; the committed files are LF. It is harmless to rendering, and a deploy from a clean WSL worktree carries LF.
- **Headless Chrome over CDP.** A copy of the site was served from the scratchpad on port 9431 the way the assets binding serves it: `/x` gives `x.html`, an unknown address gives `404.html` with status 404, and `_headers` is applied to every answer. The server exited by itself, and Chrome ran headless on its own profile and was closed with `Browser.close`. The runs:
  - 54 loads: the eight addresses and an unknown one, at 1440×800, 1366×768 and 390×844, light and dark;
  - 16 keyboard runs, every page at 1366 and 390;
  - 18 loads with JavaScript off;
  - captures of every page's top, figures and end, and of its tables and cards at 390 and 1440, light and dark, all of which I viewed.

## R2.3 Round one's edits, landed or ruled

| Piece | Status |
|---|---|
| (b) | R-b2 to R-b21 landed as written. R-b1 gave way to the lead's ruling (design §5, §12; brief, last section). Its conditions hold: each contrast says what the engine does instead, none names a product or vendor, none judges, and "segments" appears once. S-b1 to S-b6 are waived on the record (§12) |
| (c) | Rebuilt to §3.4, and every R-c edit is absorbed or landed. The rule, the sections, P1, P2, P3, P4, P6, P7, P9 and P10, the twelve answers and "Who sets what" are in place. The session tables carry exactly §3.4's 35 rows, verbatim and with their verdicts. There are 11 asks, the demo table moved to the demo map, and no `###` heading is left. C2's five adjustments are sound, including windows placed under the API (R2.10) |
| (d) | R-d1 to R-d9 landed: the per-dimension override; the pins reserved before scoring; the vocabulary clause; "the two profiles merge"; the runbook row gone; add to cart; product re-ranking; the Opal line; the technical note sentence. L-d1 to L-d5 are as ruled: samsung kept; GA4 kept with its trace (C3.md, the B.5 row); the column headed "Where in the code (for engineers)"; no latency link; folder paths and file names that carry no customer name, with "never forward one to a customer". P-d1 is closed: C3.md now traces (d) section by section |
| (h) | R-h1 and R-h2 landed. Rows B7 and A1 and the P5 sentence take the lead's new wording verbatim |
| Glossary | R-f1 and R-f2 landed; the Recording entry takes the served-basis clause; samsung stays by ruling (L-f1) |
| Figures | R-F1 landed: the bands became bold words, the "Verdict:" key is gone, the note was reworded, "tags for content", "would", "three parts". R-F2 landed: "Pinned pieces first, unscored". The recommended "Worker" capitals in `architecture.svg` were not taken (still optional) |
| Design and brief | D-2 to D-5 and D-7 fixed; D-6 fixed in full, since the brief now has the new address, "personalized" and "learning dial" |
| S2 | All nine corrections made (its third revision). The pin stays at `8b4f74c`, so every page's stamp stays true |

## R2.4 The pages (scope 2)

Every check passed at every size, in both themes:

- **Text:** each page equals its sources, by the text check and by my reading of the credits page in full and of spot passages elsewhere.
- **Chrome:**
  - the skip link is first in the body and the first Tab stop on every page;
  - the eyebrow and the eight navigation labels are on every page, the current page marked;
  - every piece names its reader at the top;
  - the rule stands first and last, identical, on (b), (c), (d), (h), the glossary and the demo map, and paragraph C opens and closes the landing page. The credits page keeps the original's rule block first and its colophon repeating the rule last;
  - the legend appears exactly on the pages that show a label, and on no other (the landing page and the demo map carry none);
  - the package name appears once per page, in `#package-name` inside the `h1`, and nowhere else in the visible text; the 404 page carries none;
  - the stamp "Updated October 2, 2026 · engine facts as of commit 8b4f74c" is on every piece;
  - the footer lists every piece and ends "Internal · Optimizely · do not forward outside Optimizely".
- **Links:** every link resolves to one of the eight addresses, an anchor that exists, or one of the three demo workers.
- **Figures:** five inline figures on four pages, each caption equal to its SVG's title. At 390 each frame scrolls sideways under its hint, becomes a labeled region with tab index 0, and scrolls with the arrow key.
- **Keyboard:**
  - the credits tabs are reached by Tab, which lands on the selected tab and then its panel;
  - at 1366 the right and left arrows, Home and End move between the tabs, and at 390, where the list stacks, the up and down arrows do;
  - the switcher's three buttons on (b) are each reached by Tab; Enter brings a part forward, Space shows all three again, and the arrows move between the buttons.
- **Console and requests:** no console message, apart from the browser's own log of the intended 404. Only same-origin requests, two or three per page, the icon being a data URI. No CSP violation.
- **Layout:** no horizontal scroll at any size.
- **Contrast:** every text passes WCAG AA, at least 5.12:1 in light and 7.72:1 in dark. Figures sit on their white panel in both themes.
- **Without JavaScript:** every page reads in full; the credits panels all show, with no horizontal scroll.

Recommended, none blocking:

- **RR-1.** `enablement/site/site.css`: the reader tags and the landing cards' number badges reuse the label fills. "For marketing" is LF green like Built, and "For solutions engineers" is light blue like Designed, beside the legend that defines those fills. Give the reader tags and badges a neutral fill, so the three fills mean only Built, Designed and Open.
- **RR-2.** `enablement/site/site.js`, `initTabs`: when the list stacks (`flex-direction: column`, as on the phone), set `aria-orientation="vertical"` on the tablist, so assistive technology announces the up and down arrows the code already honors.
- **RR-3.** `enablement/site/site.css`: on the phone, the formula block in (d)'s B.1 wraps mid-formula ("ã" ends one line and "= (1 − λ) · a + λ · share" starts the next). Let preformatted blocks keep their lines and scroll sideways.

## R2.5 The credits page (scope 3)

- **Structure kept.** The page has the original's six numbered sections in order, each heading as written. Its devices are kept: the boxed rule in two halves; the timeline with its three tabs; the scaling cards; three meters; three sentences; the FAQ; the order form; the colophon. The corrected source keeps the original's classes, adding only the label classes and a note. The marked additions are the package name, the title, the line after the rule, the legend, the session figure with its lead line, and the FAQ's lead line.
- **The corrections.** P1.md §5 lists 55: the coordinator's 54, plus change 55, which drops the sentence about a color language. I checked each against S2 and the never-say list, and each is justified. 51 cite an S2 section, a never-say row, a deprecated word or the voice rule. Change 48 adds the order form's column headings, by the owner's instruction to reformat anything unclear. Changes 7 and 35 rest on "the coordinator's illustration ruling", which is not recorded in the design or the brief, and they cite design §3.6 item 5, which no longer exists (R2.10).
- **Credit verdicts are words.** I compared computed styles across the 15 timeline rows by their credit kind (credit, free, warn, open, off), the rule's halves, the tab meters, the four category words, the meters, the scaling verdicts and the order tags. No background, border, shadow or color varies with a credit verdict. All 36 verdict phrases are bold, in the body's ink color, with no fill, in both themes. The figure gives its verdicts as bold words, with one legend (RF-1 notes one remnant).
- **"Opal is not connected to the engine today."** is under the rule, and repeated where the rows need it.
- **False statements left: two, both required** (R2.8: R2-2, R2-3).
  - The Opal half of the rule says generative AI creates "an audience, a test, a label, an image, an analysis" and is "credit-metered". The page's own tagging row says labels come from the brand's own model, with "Credits not decided" (change 14). S2 §6.1 and §6.3 agree with the row: tagging uses the tenant's own key, and whether it is billed as credits is Open.
  - The FAQ asks "Is the content auto-tagging a recurring cost?". Every tag is proposed and then approved by a person (S2 §6.1), and change 14 renamed the touchpoint "design-time tagging".
- **Kept on purpose by P1, and I agree:** "No AI · no credits · ever" and "deterministic" (S2 §6.1); "credit-consuming exception" (S2 §6.3 leaves the unit open); "Never blend lines 1 and 2" (true, though narrower than the guardrail); "shopper" (a retail framing the glossary allows); "&" in labels (the original's voice).
- **Recommended:**
  - **RE-1.** The row name "ODP event ingest, seed, profile updates" uses "seed" for ODP's audience seeding, while the glossary keeps the word for an arrival rule. Make it "ODP event ingest, audience seeding, profile updates" (`credits-source.html:523`, `credits.md:48`).
  - **RE-2.** Meter 3, "Optional add-on line: metered per invocation …", carries no label, while meter 1 says "Designed, a recommendation". Begin it "Optional add-on line, as designed:" (`credits-source.html:380`, `credits.md:102`).
  - **RE-3.** "Tap through them." asks for tabs, which the Word copy does not have. Make it "Read each part in turn." in both sources.

## R2.6 The demo map and the glossary page (scope 4)

- **The demo map.**
  - It follows §3.8 section by section, with its three marked additions: Meridian's never-claims, The Bright Hour's never-claims, and the never-say heading. Each addition is true to its source in (c) and BOOTSTRAP.
  - The text check holds the page to `demos.md` and to §3.8's verbatim items. Since `748f976` it names the role, not a person.
  - **One false statement, required** (R2-1): "OH, a home-appliances demo, is scaffolded and not yet hosted." OH has been hosted since `6484544` at 14:37 today. BOOTSTRAP, the demo map's sanctioned source, now lists it as the home demo for one prospect, at `edge-platform-oh.expedge.workers.dev`.
  - **Recommended, RG-1:** "a retailer's four-container promotions module" uses "container", which the glossary retires in favor of slot. Make it "four-place" in §3.8 (line 375) and `demos.md:12` together.
- **The glossary page.** 127 entries under 21 letters, each with the anchor id the design's rule gives (`learning-dial`, `memory`, `raw-score`, `regional-prior`, `slot-weight`). The text check finds 411 sentences each way, and the page carries the legend for its three label entries.
  - **Recommended, RF-2:** its reader tag reads "For everyone", while its reader line and the design (§1, §3.7) name a marketer. Consider "For marketing" (the lead's call).

## R2.7 Credentials and forms (scope 5)

- No page holds a form, an input, a text area, a select or editable content. The only buttons are the tabs and the figure's three, which `site.js` adds.
- In the markup, "passphrase" (the landing page's access note), "secret" ("it is not a secret"; the identity secret a customer provides) and "password" (the first operator's temporary password, on the status page) are mentions only.
- The preflight's own scans find no credential in anything served or configured, and nothing from the local `.dev.vars` in any file.

## R2.8 Required edits

Each is one phrase. Both copies of the credits text and of the demo map must change together, because the text check holds each page to both.

- **R2-1, the demo map.** `docs/enablement/content/demos.md:33`, "- OH, a home-appliances demo, is scaffolded and not yet hosted." → "- OH, a home-appliances demo built for one prospect, is hosted; ask the demo owner before showing it." And the same clause in `docs/enablement/BTI-Enablement-Design.md:382` (§3.8 item 5): "OH, a home-appliances demo, is scaffolded and not yet hosted" → "OH, a home-appliances demo built for one prospect, is hosted; ask the demo owner before showing it". The wording is a suggestion; the fact is BOOTSTRAP's. Whether OH still belongs under "not for showing as the engine" is the lead's call, since it runs today's engine.
- **R2-2, the credits page.** `docs/enablement/content/credits-source.html:271` and `docs/enablement/content/credits.md:12`, "an audience, a test, a label, an image, an analysis" → "an audience, a test, an image, an analysis".
- **R2-3, the credits page.** `docs/enablement/content/credits-source.html:421` and `docs/enablement/content/credits.md:134`, "Is the content auto-tagging a recurring cost?" → "Is design-time tagging a recurring cost?"
- **R2-4, the sales piece.** `docs/enablement/content/selling-it.md:173`, '"Real-time interest", "sub-second decisions", "instant", or any timing or throughput figure' → '"Real-time interest", "instant", or any timing or throughput figure'. "Sub-second" is a timing figure, which §4.3 bars "anywhere, for any reason", never-say columns included; (b) describes such figures rather than printing one.

Then re-render, run the text check and the preflight, and rebuild the Word copies `Enablement-Selling-It`, `Enablement-Where-Opal-and-AI-Credits-Fit` and `Enablement-Which-Demo-to-Show-to-Whom`. All three carry the phrases today.

## R2.9 Recommended edits, none blocking

RR-1 to RR-3 (site), RE-1 to RE-3 (credits), RG-1 (demo map) and RF-2 (glossary tag) are above. Three more:

- **RF-1, `before-during-after.svg`.** The rule's two halves keep their fills: dark fir under "The engine decides … no credits", light fir under "Opal creates and explains. Credits apply". Those were the old credit bands' colors. No key ties a fill to a credit verdict now, so I pass it. A white or dark fill for the Opal half would remove the last trace.
- **RC-1, `selling-it.md:197`.** The never-say row "Any line that describes another kind of system → Our own reasoning only: what the engine does" omits the allowance the lead made. Use §4.9's updated wording, so (c) does not contradict (b)'s contrasts.
- **RF-3, `architecture.svg`.** "worker" → "Worker" in the box titles and zones, as in round one; optional.

## R2.10 For the lead's record

- **The illustration ruling.** Credits changes 7 and 35 keep the session counts as "one million sessions or ten million". P1 cites a coordinator's ruling that neither the design's §12 nor the brief records, and a design item (§3.6 item 5) that the rewritten §3.6 no longer has. Record the ruling, or use the old item's words: "However much a customer's traffic grows, its credit use does not move with it."
- **The length of (c):** 3,265 words, 1,519 of prose and 1,673 in tables, against §3.0's 1,800 to 2,400. The design's own required content is most of it; C2's note gives the cheapest cuts. Restate the budget or cut.
- **P8:** the design's P table lists (c) for P8, but §3.4's sentences to say omit it, and (c) does not carry it. Align one or the other.
- **Design §3.4 item 6** still puts "windows" in the console row. S2 §4.5 says catalog fields have no console screen. (c) has it right; fix the design.
- **Two uncommitted edits** in the working tree: `enablement/render-check.mjs` (a ruled phrase read as a pattern) and `lanes/C3.md`. The committed check passes at HEAD without them; commit or drop them before the deploy.
- **The Word copies** were outside this round's scope. A spot check shows round one's fixes in them. They are named `Enablement-…-v1.0.docx`, which is not how the design's §1 table names them, and three need the rebuild in R2.8.

## R2.11 Conduct

No git command that changes anything; `git archive`, which only reads, extracted HEAD's tree into the scratchpad. No install, deploy or kill. Every server exited by itself, and every Chrome run was headless on its own profile and closed with `Browser.close`. One slip: before copying the site into my scratchpad, I ran `rm -rf` on the copy's target folder, `scratchpad/r2/site`, out of habit. The folder did not exist yet, so nothing was removed, and no other delete was run. Scratch work is in `scratchpad/r2/`: the audit scripts, `out/` and `out2/` (captures and `results.json`), `build/` and `headbuild/` (dry runs) and `head/` (HEAD's tree).

# Round three, 2026-10-02

Under the new law: `LANE-BRIEF-V2.md`, then the design's version 2 (§4 the story and the fixed sentences, §5 quotations and voice, §9 the gate), with S4 and S5 as the dossiers and S2 as the engineering view. The sources were reviewed as committed at `f15a10e`, and the rendered site as committed at `08b9287`. Neither has changed through HEAD `5042804`: `git diff 08b9287 HEAD -- enablement docs/enablement` is empty. Wherever version 2 contradicts rounds one and two (labels, the legend, the receipt never-say, the consent conditions, the ban on timing), those rounds' findings are withdrawn.

## R3.1 Verdicts

| Piece | Source | Page | Verdict |
|---|---|---|---|
| (a) Landing | `enablement/render-pages.mjs` | `/` | Ready |
| (b) What it is | `content/what-it-is.md` | `/what-it-is` | Ready after R3-1 to R3-4 |
| (c) Selling it | `content/selling-it.md` | `/selling-it` | Ready after R3-5 to R3-7 |
| (d) How it works and where it runs | `content/how-it-works-and-where-it-runs.md` | `/how-it-works` | Ready after R3-8 |
| (e) How it works, interactive | `content/how-it-works-interactive.md`, with its page and script | `/how-it-works-interactive` | Ready after R3-9 to R3-12 |
| (f) See it work | `content/see-it-work.md`, with its page and script | `/see-it-work` | Ready |
| (g) Where Opal and AI Credits Fit | `content/credits.md`, `content/credits-source.html` | `/credits` | Ready after R3-13 |
| (h) The glossary | `GLOSSARY.md` | `/glossary` | Ready after R3-14 |
| (i) Which demo shows which story | `content/demos.md` | `/demos` | Ready |
| The three figures | `figures/*.svg` and `*.png` | inlined | Pass |
| Not found | | `/status` and any unknown address | Pass |

There are 14 required edits (R3.5) and 13 recommended ones (R3.6). None of the recommended edits blocks the deploy. The deploy can follow once:

1. the required edits are made;
2. P1 re-renders (b), (c), (d), (g) and (h), and H1 edits its page and script with its markdown;
3. the text check and the preflight pass again.

## R3.2 What I ran

- **Read in full:**
  - the brief, the design's version 2 (§1 to §12), S4 and S5;
  - every source named in the round's message, the three figures (SVG text and PNG by eye), and the lane notes P1, M1 and H1 where they bear on a finding.
- **Recomputed (d)'s arithmetic.** I recomputed every number in its walk and tables:
  - interest after one, two and three views, the entry and exit lines in evidence, and the exit at 14 × ln(3/1.4727) = 9.96 days;
  - λ at 1.07 and 2.13, the hero's 0.46, 0.52 and 0.572, and the return's 0.41 and 0.32.
  - Every one holds, and the constants match S2 (`S2-engine-facts.md:417`, `:459`, `:539`, `:573-575`, `:640-641`, `:677-690`).
- **Scans:** `scratchpad/r3/scan3.mjs` read the sources and the figures' text. It scanned for:
  - the four fixed sentences, counted verbatim per file, and their near misses;
  - gendered pronouns, build-state, stage and label words, and names;
  - timing figures, the never-say phrases, the constants and every address;
  - the rule first and last, the glossary's deprecated words, em-dashes and British spellings.
- **The text check:** `node enablement/render-check.mjs`, run on a `git archive` copy of HEAD in the scratchpad:
  - 11 page-source pairs on 10 pages, with 0 missing and 0 unexplained sentences in every pair;
  - every scan at 0;
  - the marked additions listed and read (`--verbose`).
- **Headless Chrome** (`scratchpad/r3/audit3.mjs` and its probes). The copy was served with `_headers` the way the assets binding serves it.
  - **Page loads:** 66, one for each of 11 addresses at 1440×800, 1366×768 and 390×844, in light and dark.
  - **Keyboard:** 18 runs, Tab through every page at 1366 and 390.
  - **No script:** 22 loads.
  - **Interaction:** both interactive pages, driven at 1366 and 390.
  - **Element screenshots:** taken where a judgment needed the eye.
- **Quotations:** I checked every quotation against its file and line through S4 (R3.3, gate f).

## R3.3 The gate, piece by piece

| Gate | (b) | (c) | (d) | (e) | (f) | (g) | (h) | (i) |
|---|---|---|---|---|---|---|---|---|
| (a) The story in order, retellable | Pass, with R3-1 and R3-2 | Pass | Pass | Pass | Pass | Its own shape | Its own shape | Its own shape |
| (b) Every capability | 13 of 13 | 13 of 13 | 13 of 13 | 13 of 13 | The four moves and the rest in "more moves" and the reasons | Not required | Not required | 13 rows |
| (c) Ten reasons, unranked, with the weighing sentence | Pass | Pass | Pass | Pass | Pass | Not required | Not required | Not required |
| (d) Fixed sentences verbatim; performance once; no other timing figure | Pass | Pass (L3-1) | Pass | R3-9 | Pass | AI sentence, pass | Learning sentence, pass | Pass |
| (e) No build state, stage, label, legend or verdict | Pass | Pass | Pass (RR3-5) | R3-10 to R3-12 | Pass | R3-13 | Pass | Pass |
| (f) No names; quotations by industry; no pronoun | Pass | Pass | Pass | Pass | Pass | Pass | Pass | Pass |
| (g) The rule first and last, as a callout, identical | Pass | Pass | Pass | Pass | Pass on the page (RR3-12) | The original's rule and closing line | Pass | Pass |
| (h) The devices | Pass | Pass | Pass | Pass (RR3-8) | Pass | Pass | Pass | Pass |
| (i) Consistency across pieces | R3-3, R3-4 | R3-5 | Pass (RR3-6, RR3-7) | R3-10, R3-11 | Pass | Pass | R3-14 | Pass |
| (j) True to S4 and S5 | Pass | R3-5 | Pass | R3-10 to R3-12 | Pass | Pass | R3-14 | Pass |
| Design §2, condition 3 (the customer paper) | Pass | R3-6, R3-7 | R3-8 | Pass | Pass | Pass | Pass | Pass |

**(a), as a reader.**
- **(b)** A marketer comes away knowing four things. What the engine is: a stylist for every visitor that decides the page at the point in time and lives beside recommendations. What it does: nine scenes that between them carry all thirteen capabilities. What it solves: strangers, and rules that go stale and fight. What to do with it: the four sentences, the say and never-say table, and five answers. The scenes come before "Underneath", and there is no arithmetic. It is retellable.
- **(c)** An account executive gets the pitch in the story's order:
  - seven scenes a customer would recognize;
  - the reasons as a table, with the instruction to lead with the two or three a customer raises first;
  - outcomes paired with discovery questions, and the asks with what each is for and who provides it;
  - objections with say and never-say, a demo table, and the four sentences.

  It is retellable.
- **(d)** Part A tells the whole story in two pages, each part linked to its detail. Part B follows the Vantage note: one visitor end to end with numbers that recompute, then interest, the score, the stranger's start, learning and the receipt, the architecture with both figures, configuration, integration, privacy and the asks.
- **(e)** Every one of its ten instruments sits under a lead in three parts ("What you are looking at", "Try", "Watch for") and after the section's words and formulas. It runs at the engine's defaults, and its self-test passes 22 of 22.
- **(f)** Each of the four moves is told in plain words above its instrument, with a one-line how-to between the words and the instrument. The reasons and the two links follow.

**(b) and (c), counted.** All thirteen capabilities of design §4.2 appear in (b), (c), (d) and (e), each with a use case, and all ten reasons of §4.3 appear in (b) to (f). The weighing sentence is in each:
- (b:43) "Each customer weighs these reasons differently."
- (c:47) "Each customer weighs them differently".
- (d:43) "Each customer weighs them differently, so no list ranks them."
- (e:35) "each customer weighs them differently".
- (f:59) "Each customer weighs these reasons differently."

None of them ranks the reasons or tells a win.

**(d), counted (verbatim occurrences).**

| Sentence | (b) | (c) | (d) | (e) | (f) | (g) | (h) | (i) |
|---|---|---|---|---|---|---|---|---|
| Performance | 1 | 3 | 1 | 1 | 1 | 0 | 0 | 1 |
| Learning | 3 | 3 | 2 | 2 | 1 | 0 | 1 | 1 |
| AI | 2 | 3 | 2 | 2 | 1 | 1 | 0 | 1 |
| Recommendations | 3 | 3 | 1 | 1 | 1 | 0 | 0 | 0 |

Each narrative carries all four. The performance sentence sits where design §3 places it:
- (b), in the closing list;
- (d), in B.6 where it speaks of the edge;
- (e), in the edge capability;
- (f), under the first-click scene;
- (i), as a never-say replacement.

On (c), see L3-1.

The other durations are configuration constants, which S2 states as constants (S2 `:43`): memory, attribution windows, consent's 30 days, the 24-hour pass and the 21-day learning memory. The one timing claim is (e)'s 30-second cache (R3-9).

**(e).** No "today", "not yet", "designed", "planned", "roadmap", "open" or label word appears about the product. "Stage" appears only as journey stage, or as the glossary's own retired entries. The hits I read and passed:
- "tools built for known customers";
- "in the open" (transparency);
- "Three weeks later", a demo beat;
- the verb "withdrawn" for a seed dampened to zero (e:158);
- (d)'s "later capabilities", which is borderline (RR3-5).

**(f).** No customer, prospect or competitor name appears; only real product brands appear, as example dimension values and products in (e) (design §5.1). The pronoun scan is 0 in every source, in the figures' text, and in the three served scripts' strings and comments. Every quotation is attributed by industry, carries no gendered pronoun, and traces to S4:
- "It works, but it caps out." (b:11, c:11, d:11): S4 8.32, the white paper's line 103.
- "a site that feels like a stylist who remembers" (b:15, c:17, d:17): S4 8.33, line 126.
- "none of them offer real-time, ML-driven content or experience personalization at the individual level." (d:11): S4 8.30, line 243.
- "How else would it learn? I don't understand." (c:103, d:146): S4 8.13, the session transcript's extraction line 604.
- "reinforce it while it is live, or let the shopper drift" (b:27): S4 5.12. It is in the use-case document's table of asks at line 35, written as our team's summary "from the transcript", not between quotation marks (RR3-2).

**(g).**
- (b), (c), (d), (e), (h) and (i) open and close on the same callout.
- (f)'s markdown sets its rule as bold paragraphs. Its page sets them as callouts with the rule labels (RR3-12).
- (g) keeps the original's one-rule panel with the AI sentence beside it, and its closing line, as design §3.7 keeps the standalone page's structure.

**(h).** Examples come before mechanism everywhere. Every figure, table of numbers, switcher and instrument has a plain lead above it. Each narrative has its say and never-say table with replacements. The glossary's deprecated words do not appear, except "container" for a slot's positions in (e) (RR3-8); "real-time" is no longer deprecated (design §3.8).

**(i).** The constants agree wherever they appear:
- K 1.8 in (d:98, :106), (e:7, :74) and the glossary's K entry;
- entry 0.60 or 0.6, and release 0.45, in (d:98-108), (e:7, :78) and the glossary's entry and exit lines;
- a 14-day default memory, set per dimension up to 90, in (d:105) and (e:66, :164), with the glossary's Memory entry giving the 14-day default and the 90-day cap.

Both interactive scripts use K 1.8, 0.6, 0.45 and 14 days. See it work's regional blend runs at kBlend 0.5 (L3-5).

Every site address is `https://edge-platform-bti.expedge.workers.dev/<page>`, with no trailing slash, and every demo address is one of the four workers. `/see-it-work` is linked from (f), the landing page and the navigation, but not from (b) (R3-3). `/how-it-works-interactive` is linked from (d), (f), (i) and the landing page.

The disagreements across pieces:
- **Pins.** (c) and (d) put a pin at any position; (e) and the glossary make it a prefix (R3-10, R3-11, R3-14).
- **AI search.** (c:99) has it on the brand's own model key; (b), (d), the credits page and the glossary have it switched on with credits (R3-5).
- **Arrival seeds.** The glossary's Console entry changes them in the console; (d)'s table says the API only (RR3-7).

**(j).** S5 is the finished product:
- C1, V7, and ticket P04 through S4 5.5: a pinned module holds "any position rather than only the first".
- The brief: the AI add-ons "a customer may switch on with their credits".

(e) and the glossary teach S2's current prefix pin. (e) also teaches S2's finding 8, "A pin whose piece is ineligible empties the whole slot … W20's territory" (S2 `:1212`), which document 35's W20 replaces with "dead-pin diagnostics … and default fallback". Version 2 keeps remediation out of the material (brief §1). Everything else the stories assert about the mechanism holds against S5, and against S2 for the arithmetic.

## R3.4 The pages

- **The text check.** It passes on the committed site (R3.2). Read as a reader, the pages say what the sources say, with the marked additions as listed: the rule labels, scroll hints, (e)'s section labels and numbers, (f)'s four how-to leads, and the session figure placed by ruling on `/what-it-is` and `/credits`.
- **The 66 loads.**
  - The nine pages answer 200, and `/status` and an unknown address answer 404 with the not-found page.
  - No request leaves the origin, and no load fails. There is no CSP violation and no horizontal scroll at any width, in either theme.
  - There is no form, no storage and no cookie.
  - The only console messages are the two expected 404 responses.
  - Every page carries:
    - the skip link as the first element, aimed at `#main`;
    - "Internal · Optimizely" and the nine-link navigation with the current page marked;
    - the reader tag, and "Updated October 2, 2026" once;
    - the package name once, in `#package-name` inside the `h1`;
    - the piece list, and the footer line.
  - At 390, every inlined figure scrolls sideways in its labeled region with its hint.
- **What a reader sees and hears.** The scan covered visible text, `aria-label`s, titles and SVG text, after the scripts have run and after the interactions below:
  - no gendered pronoun, no customer name and no state word;
  - no timing figure but the performance sentence and the configuration durations;
  - the one exception: (e)'s cache sentence (R3-9).
- **Links.** All of them resolve: to the nine pages, to an existing anchor, or to the four demo workers (`edge-platform`, `-vantage`, `-top-offers`, `-oh`).
- **Legends and chips.**
  - **The credits page:** one legend in form remains, the timeline's three-word row "Credits apply · Deterministic engine · no credits · Conditional / exception". It is the old color legend with its swatches stripped. It keys nothing, since no row's look changes with its verdict, and it reads as a row of headers above the tabs (R3-13). The verdicts themselves are bold words in the ink color, with no fill (37 checked).
  - **Passed, and why:**
    - the charts' own keys (See it work's entry and release line key and its "Their region / Their own clicks" bar; (e)'s series swatches);
    - (e)'s two tags, "recomputed in your browser" and "regional sales: synthetic, for the example";
    - See it work's "Pinned" and "pinned" markers.
  - None of these says anything about the product's state. The synthetic tag is the marking the demo rules require.
- **Keyboard.**
  - The skip link is the first Tab stop on all nine pages, at 1366 and 390.
  - The credits tabs move with the left and right arrows, Home and End at 1366, and with up and down when they stack at 390 (L3-4).
  - The marketing figure's switch works with Enter and Space.
- **See it work, by keyboard, at 1366 and 390:**
  - **Region switch:** an arrow moves between Washington State and Florida, and Enter or Space selects. The sections, the hero and the receipt change, and the page labels the two as example visitors, never as the reader.
  - **First click:** Enter on a card fills its buckets, reorders the sections, changes the hero and adds receipt lines.
  - **Fade:** "Step forward" releases the interest past its line, the receipt records the release, and the sections settle back. The clock runs on its own.
  - **The wheel:** pin and gate hold the partner spotlight first and hide the out-of-stock jacket, which returns when the gate is off. The pin holds when the visitor's interest changes.
  - Once, at each width, the first interaction run logged "`<rect>` attribute width: A negative value is not valid" from `see-it-work.js`. Two reruns did not reproduce it, and I traced it to the easing at `see-it-work.js:203` (RR3-13).
- **How it works, interactive, by keyboard, focus, hover and tap:**
  - The self-test passes 22 of 22, and the page shows "10 of 10 candidates agree to the third decimal".
  - Sliders move with the arrow keys, and the readouts follow: K went from 1.8 to 2.1 in three presses.
  - Hints:
    - Focus opens 79 of the 86. The other 7 sit in panes that stay hidden until chosen.
    - Escape closes all 86.
    - Hover opened 12 of 12 visible hints sampled at 1366, and tap 12 of 12 at 390.
  - "Run it on 10,000 synthetic candidates" counts the work and times nothing.
  - 4 of the 27 sliders, and 7 of the hints, are in hidden panes, so they are out of the Tab order until shown.
- **Without script.** Every page reads in full. See it work shows its twelve still pictures. (e)'s instruments in sections 1 to 9 are empty boxes under leads that describe them (RR3-11).
- **Contrast.** The lowest pairs are 4.91 on `/see-it-work` and 5.12 or more everywhere else, except `/how-it-works-interactive`. There, the dimmed zero-contribution tags (`.tg--zero`, at opacity 0.55) read 3.51 to 3.58, in about 52 places, and the hint glyph reads 3.65 in light and 4.18 in dark (RR3-9). P1's note reports a lowest of 4.91 on every page; that misses these.

## R3.5 Required edits

Each edit reads "file:line, current text → required text".

**(b) `content/what-it-is.md`, lane C1**
- **R3-1** (gate a: the brief's §2.2 and design §4.6, "It is not a recommendations engine and does not replace one").
  - what-it-is.md:19, "The engine needs no purchase history, so it works for a visitor nobody has met, and it replaces no recommendations product."
  - → "It is not a recommendations engine and does not replace one: it needs no purchase history, so it works for a visitor nobody has met."
- **R3-2** (design §4.2: "'what a customer provides' names the visitor's choice that the site passes"; (c:93) and (d:297) do).
  - what-it-is.md:67, after the events bullet, insert the bullet "- The visitor's consent choice, which the site passes from its consent banner and the engine follows."
- **R3-3** (gate i, and design §3.2's device "a link to See it work").
  - what-it-is.md:107, before the "Selling it" bullet, insert "- [See it work](https://edge-platform-bti.expedge.workers.dev/see-it-work), the stylist's four moves on a page."
- **R3-4** (gate i: the page's title is "Which demo shows which story", in demos.md:1, the navigation's footer list and design §3.9).
  - what-it-is.md:110, "[Which demo to show to whom](https://edge-platform-bti.expedge.workers.dev/demos)"
  - → "[Which demo shows which story](https://edge-platform-bti.expedge.workers.dev/demos)"

**(c) `content/selling-it.md`, lane C2**
- **R3-5** (gates i and j). The brief §1 has the add-ons "a customer may switch on with their credits". The credits page (credits.md:49, :65), the glossary's Typed search entry, (c:39) itself and (d:276, :302) agree, and (d) asks for a catalog-search service.
  - selling-it.md:99, "the brand's own AI model key, for AI search and tagging;"
  - → "a catalog-search service, for AI search;"
- **R3-6** (design §2, condition 3, kept by version 2's §8: "never cite the customer paper it came from"). The words stay; the reference to the paper goes.
  - selling-it.md:11, "A luxury retailer's own brief said of its rule-based personalization:"
  - → "One of our customers in luxury retail said of its rule-based personalization:"
- **R3-7** (the same condition; it also joins the two references to one customer, and keeps the claim true: S4 7.8 records a signature, not a finished build).
  - selling-it.md:17, "A luxury retailer's own brief asked for exactly this: "a site that feels like a stylist who remembers". One of our customers in luxury retail concluded that this capability did not exist off the shelf, and built it with us."
  - → "The same customer asked for exactly this: "a site that feels like a stylist who remembers". It concluded that this capability did not exist off the shelf, and chose to build it with us."

**(d) `content/how-it-works-and-where-it-runs.md`, lane C3**
- **R3-8** (the same condition).
  - how-it-works-and-where-it-runs.md:17, "The same retailer's paper asked for"
  - → "The same retailer asked for"

**(e) How it works, interactive, lane H1: the markdown, `enablement/site/how-it-works-interactive.html` and `.js`**
- **R3-9** (gate d: a propagation time is a timing figure beyond the performance sentence, and the design's never-say turns "Changes go live in seconds" into "A change is in force without a software release." S2 `:716-717` says the cache "does not establish a deployed propagation SLO").
  - how-it-works-interactive.md:202, "A change is in force without a release: at once where it is written, and everywhere within the documents' 30-second cache."
  - → "A change is in force without a software release."
  - Make the same change on the page, `how-it-works-interactive.html:300`.
- **R3-10** (gates e, i and j: S2's finding 8, a remediation item, told as the product; it also contradicts (c:35) and (d:135), "at any position").
  - how-it-works-interactive.md:130, delete "A pin is a required prefix: if the pinned piece is not eligible for the request, the whole slot serves nothing, so a pin needs care."
  - Make the same change on the page, `how-it-works-interactive.html:208`.
- **R3-11** (the same).
  - how-it-works-interactive.md:136, "or pin an upgrade offer under intent new. **Watch for:** a piece over the cap yielding its place to the next ranked piece, and an ineligible pin emptying the whole slot."
  - → "or pin an offer. **Watch for:** a piece over the cap yielding its place to the next ranked piece, and a pinned piece holding its place while ranking skips it."
  - Make the same change on the page, `how-it-works-interactive.html:215`.
- **R3-12** (the same, in the instrument).
  - The hint `TIPS.s4pin` at `how-it-works-interactive.js:881` currently says "A pinned piece is a required prefix … the whole slot serves nothing and records a pin diagnostic, so a pin needs care."
  - The Pin control's note at `:1508` currently says "A required prefix: container 1, never ranked. If the pinned piece is not eligible for this request, the whole slot serves nothing. Try an upgrade offer under intent new."
  - The refused branch at `:1575-1579` currently writes "empty: the slot served nothing" and "A pin is a required prefix, and a prefix that cannot be served refuses the slot".
  - Required: the instrument neither shows nor narrates an ineligible pin emptying the slot. For example, it offers only the pins eligible under the chosen condition. The hint and the note become "A pinned piece holds the place the brand set, here the first, and is never ranked; its receipt says ranking was skipped." The mechanics are H1's choice. None of the self-test's 22 checks depends on the refusal.

**(g) The credits page, lane P1**
- **R3-13** (gate e: "no legend"; design §7, "No legend and no label, anywhere on the site"). The timeline's three-word row is the old color legend with its swatches removed, and it keys nothing.
  - credits.md:25-27, the three bullets "**Credits apply**", "**Deterministic engine · no credits**" and "**Conditional / exception**": delete them.
  - credits-source.html:288-292, the `<div class="tl-legend">` block: delete it.
  - `enablement/render-check.mjs:344`: drop the exemption `&& !/\bcr-tl-legend\b/.test(n.attrs.class || '')`.
  - Re-render `/credits`.

**(h) `GLOSSARY.md`, lane E1**
- **R3-14** (gates i and j: S5 V7 and P04; (c:35), (d:135) and the glossary's own Module and Placement entries).
  - GLOSSARY.md:185, "**Pin.** The brand's instruction that named pieces fill a slot's first positions before any ranking, such as the placements the brand sells; the rest of the slot is still ranked. The receipt says ranking never ran for the pinned pieces."
  - → "**Pin.** The brand's instruction that a named piece holds the place the brand sets in a slot, first or any other, before any ranking, such as a placement the brand sells; the rest of the slot is still ranked around it. The receipt says ranking never ran for the pinned piece."

## R3.6 Recommended edits, none blocking

- **RR3-1**
  - what-it-is.md:15, "and built it with us." → "and chose to build it with us."
  - This is the same truth as R3-7.
- **RR3-2**
  - what-it-is.md:27, "whether to "reinforce it while it is live, or let the shopper drift"." → "whether to reinforce it while it is live or let the shopper drift."
  - The source line is our team's summary of the ask, so it reads as a paraphrase.
- **RR3-3**
  - what-it-is.md:83, "The engine calls no AI model to decide; Opal and the optional add-ons are where AI works." → the AI sentence verbatim.
  - Design §3.0 item 7 says a piece that touches the subject uses the fixed sentence's words.
- **RR3-4** (links show the page's title, design §6).
  - what-it-is.md:109, selling-it.md:39 and how-it-works-and-where-it-runs.md:272: "Where Opal and AI credits fit" → "Where Opal and AI Credits Fit, and Where They Never Do".
  - selling-it.md:123: "[Demo map]" → "[Which demo shows which story]".
- **RR3-5**
  - how-it-works-and-where-it-runs.md:259, "and later capabilities are switched on in configuration" → "and every other capability is switched on in configuration".
  - This keeps clear of the design's "later".
- **RR3-6** (seeds and dampening: a dampen factor runs from 0 to 1, `src/content/kinds.ts:291`, and (e:158) withdraws the platform seed at 0).
  - how-it-works-and-where-it-runs.md:79, "a seed never switches off" → "time never switches a seed off".
  - how-it-works-and-where-it-runs.md:173, "A seed never switches off. It is dampened when the visitor's own audiences point elsewhere and outscored as their interests grow" → "Time never switches a seed off. A dampening factor the brand publishes, from 1 down to 0, lowers it when the visitor's own audiences point elsewhere, and the visitor's growing interests outscore it".
  - GLOSSARY.md:235, "A seed adds a fixed amount to matching pieces" → "A seed adds an amount the brand publishes to matching pieces, lowered when the visitor's own audiences point elsewhere".
- **RR3-7** (S5 C7 and the glossary's Console entry).
  - how-it-works-and-where-it-runs.md:249-250: move "arrival seeds" from the API row to the console row.
  - Row 249: "Weights, memory, lines, slot rules, pins, arrival seeds, learning dials, the holdout share | The console, or the API".
  - Row 250: "The catalog, the dimensions and the attribute each reads | The API, without a release".
- **RR3-8**
  - how-it-works-interactive.md:136, :172 and :208, and the instrument's labels ("container 1", "THE FOUR CONTAINERS"): "container" → "place", or "position".
  - The glossary retires "container" as a word for a slot.
- **RR3-9** (contrast on `/how-it-works-interactive`).
  - Raise `.tg--zero` (opacity 0.55) and the hint glyph (opacity 0.82) to at least 4.5:1 in both themes. The figures are in R3.4.
- **RR3-10**
  - how-it-works-interactive.html:345: give the closing rule the label `<p class="rule-label" data-chrome="rule label">The one rule, again</p>`, as every other page has.
- **RR3-11** (design §7: "the interactive pages show their explanations with static illustrations").
  - Without script, (e)'s instrument boxes are empty. At least, put one line in each box, or hide the "What you are looking at" leads when the script has not run.
- **RR3-12**
  - see-it-work.md:5 and :82: set the rule as callouts (`> **…**`), as the page already shows them and as every other source does.
- **RR3-13**
  - see-it-work.js:203, `const k = Math.min(1, (t - t0) / ms);` → `const k = Math.max(0, Math.min(1, (t - t0) / ms));`.
  - A frame's timestamp can precede the `performance.now()` taken in the same frame. The cubic ease then returns a negative fraction, and the region-lean fill at `:547` gets a negative width.

## R3.7 For the lead

- **L3-1. (c)'s performance sentence.** (c) carries it three times: in the stranger's scene (c:27), in the objections (c:109) and in the closing list (c:137). Design §3.3 says (c) carries the fixed sentences "in their scenes, in the objections and in the closing list", while this round's gate says "the performance sentence once". I passed (c) under §3.3, the more specific rule. Rule it if "once" is to govern (c) too.
- **L3-2. Design §2, condition 3, and the brief's §4.** The brief lets customers' words be quoted by industry. The design keeps "never cite the customer paper it came from". R3-6 to R3-8 satisfy both: they keep the words and attribute them to the retailer, not to its paper. If condition 3 is read as covering only the name, R3-6 to R3-8 become optional, though R3-7's "chose to build" stays a truth fix.
- **L3-3. The text check's exemption.** The text check passes the credits legend only by an exemption written for it (`render-check.mjs:344`). R3-13 removes both the legend and the exemption.
- **L3-4. RR-2 (design §10) is still open.** On the phone the credits tabs stack and answer the up and down arrows, but the tab list carries no `aria-orientation`.
- **L3-5. See it work's regional blend.** See it work runs the blend at kBlend 0.5, the value the example demo publishes. The engine's default is 1, and design §3.6 says the page's arithmetic is at the defaults. M1 records why in `lanes/M1.md` ("Why kBlend 0.5": at 1, a stranger's first click almost never moves a section). No number on the page shows it. I pass it as a recorded, deliberate setting; rule it if the defaults are to be literal.
- **L3-6. The Word copies.** The six `-v2.0.docx` were built from these sources. R3-1 to R3-8, R3-13 and R3-14 change five of them, so lane W rebuilds:
  - What It Is;
  - Selling It;
  - How It Works and Where It Runs;
  - the credits page;
  - the glossary.

  (b)'s Word copy carries no session figure, because the page adds it by ruling (`RULED_FIGURES` in `render-check.mjs`) and the markdown does not name it. Decide whether Word should have it.
- **L3-7. The keys and tags I passed.** In R3.4, I list the keys and tags I passed as not being legends or labels. Overrule this if "no legend" is to cover a chart's own key.

## R3.8 Where S4 and S5 are wrong or in conflict

- **S4 row 5.12.** It gives the home-shopping ask as "transcript". The use-case document's table row is our team's summary of the ask, without quotation marks (RR3-2).
- **S5 row V11.** It has AI search read the query with "the brand's own AI model". The brief makes the AI add-ons something a brand switches on with its credits. The brief governs; S5 should say so (R3-5).
- **S5 §1.2 C1, and S4 row 5.3.** Both record today's prefix pin and the empty slot as conditions. S5's rows C1 and V7 and ticket P04 are the finished product. (e) and the glossary followed the conditions (R3-10 to R3-12, R3-14).

## R3.9 Conduct

- **What I wrote.** I wrote only this file.
- **Git.** No git command that changes anything. `git archive`, which only reads, extracted HEAD's `enablement` and `docs/enablement` into the scratchpad.
- **Repository.** No install, deploy, delete or kill in the repository.
- **Servers and Chrome.** Every server ran on a port above 9400 (9441 to 9452) and exited by itself. Every Chrome run was headless on its own profile in the scratchpad and closed with `Browser.close`.
- **Scripts and outputs.** All of them are in `scratchpad/r3`.
- **The gate.** It was out of scope and was not touched.

# Round three, confirmation, 2026-10-02

**Verdict: all fourteen required edits are in place**, in their sources and on the rendered pages, and the full preflight passes. The site can stay as deployed.

- **What I checked:** the folder deployed from `2e6436e`, compared at HEAD `bce8cdd`.
- **Unchanged since the deploy:** sources, figures, `enablement/` and `wrangler.enablement.toml` are identical between the two commits.
- **Exactness:** three edits carry one added sentence each, all making the same claim. That claim is the lead's ruling, recorded in the design's §12. I accept it (below).

## RC.1 Each edit

| Edit | In the source | On the page | Exactly as written |
|---|---|---|---|
| R3-1 not a recommendations engine | yes | yes | yes |
| R3-2 consent choice in what a customer provides | yes, after the events item | yes, same place | yes |
| R3-3 See it work link | yes, before Selling it | yes, `href="/see-it-work"` | yes |
| R3-4 demo map title | yes | yes | yes |
| R3-5 catalog-search service | yes | yes | yes |
| R3-6 "One of our customers in luxury retail said" | yes | yes | yes |
| R3-7 "The same customer … chose to build it with us" | yes | yes | yes |
| R3-8 "The same retailer asked for" | yes | yes | yes |
| R3-9 the cache sentence | yes | yes | yes |
| R3-10 the empty-slot sentence | deleted | deleted | no: one clause added, below |
| R3-11 Try and Watch for | yes | yes | yes |
| R3-12 the instrument | the hint, the note, the branch | in the browser, below | the note yes; the hint has one sentence added |
| R3-13 the legend row | gone from both sources | gone from the page | yes |
| R3-14 Pin entry | yes | yes | no: one sentence added, below |

Notes on three of the rows:

- **R3-12, the refusal.** No "required prefix", "serves nothing", "served nothing", "refuses the slot", "needs care" or `refused` is left in `how-it-works-interactive.js`.
- **R3-13, the builder and the check.**
  - `render-check.mjs:344` has no exemption left.
  - The builder now fails on any legend row.
  - The legend's styles are gone from `site.css`.
- **The old wording elsewhere.** None of the replaced wording survives on any served page. The one "serves nothing" left is the glossary's Off limits entry, which is correct.

## RC.2 The three additions

The required text landed in all three. Each also carries one more statement: an ineligible pinned piece is not shown, and the rest of the slot ranks as usual.

- **R3-10, `how-it-works-interactive.md:130` and the page.** It now reads "a pinned piece holds the place the brand set in the slot and is never ranked, and one that is not eligible for the request is simply not shown; then the ranking fills the other places".
- **R3-12, the hint `TIPS.s4pin`.** It opens with the required text, then adds "A pinned piece that is not eligible for the request is not shown, and the rest of the slot ranks as usual." The control's note is exactly the required text. The mechanics are H1's, as R3-12 allowed: an ineligible pin is left out and the four places rank.
- **R3-14, `GLOSSARY.md`.** The entry adds "A pinned piece that may not show, such as one out of stock, is simply not shown, and the rest of the slot ranks as usual." The Placement entry follows it, and a new Gate entry (121 entries) says the same.

**Why I accept them:**

- The design's §12 records the ruling ("From review round three (R3-14 and RR3-6), the glossary: …").
- The claim agrees with document 35's own words for the finished product: "Reserve valid pins and reject document-local contradictions at write time" (`35-audit-verification-and-source-of-truth.md:213`).
- It agrees across pieces. (c) and (d) say a pin holds its place at any position, and say nothing that contradicts it.

**One optional wording note on the new Gate entry.** It says "the receipt names which of the three decided each place". That follows S5 row C1 ("which tier decided"). But a gate only removes pieces, and (d)'s receipt table names the deciders as "the engine, a pin or the default". I suggest "the receipt names whether a pin, the ranking or the site's default decided each place". This does not block the deploy.

## RC.3 The pages, headless

I served a `git archive` copy of HEAD from the scratchpad with `_headers`, as the assets binding serves it. Chrome ran headless, as in round three.

- **The text check:** it passes on all 10 pages and 11 page-source pairs, with 0 missing and 0 unexplained sentences, and every scan at 0.
- **The page audit:** 66 loads, every address at 1440×800, 1366×768 and 390×844, in light and dark.
  - The nine pages answer 200, and `/status` and an unknown address answer 404.
  - No request leaves the origin, no load fails, and there is no CSP violation or horizontal scroll.
  - No page has a form, storage or a cookie. The chrome is complete on every page.
  - **Contrast:** the engineers' page is now at 5.12 or better, up from 3.51, because RR3-9 was taken. The lowest pair on the site is 4.91, on `/see-it-work`.
- **The credits page.** It has no legend row:
  - no element with a legend or `cr-lg` class;
  - no "Deterministic engine · no credits" or "Conditional / exception" anywhere on the page;
  - the timeline opens straight onto its three tabs.

  The tabs still work by arrow keys, Home and End.
- **The engineers' page, at all three sizes:**
  - **No pin:** four ranked places.
  - **An eligible pin** (the Galaxy S26 new-line offer, intent new): place 1 reads "pinned … ranking skipped", the other three are ranked, and the note says the other three places rank as usual.
  - **An ineligible pin** (the S26 Ultra upgrade offer, intent new): the piece is not shown, and its row reads "pinned, not shown: needs intent upgrade: fails closed". All four places are filled by ranking, and the note explains why.
  - **The same pin under intent upgrade:** it takes place 1.
  - **Self-test:** 22 of 22.
  - **Sliders:** they answer the arrow keys and Home; K went from 1.8 to 2.1 and down to its minimum.
  - **Hints:**
    - Focus opens 79 of the 86, and the other 7 sit in hidden panes.
    - Escape closes all 86.
    - Hover and tap each open every visible hint sampled.
  - **The closing rule** carries its label (RR3-10).
  - **The rendered text, tooltips included:** no "30-second", "required prefix", "serves nothing" or "needs care", no state word and no gendered pronoun.
  - No console message.
- **See it work, at all three sizes:**
  - The region switch, the first click, the fade and the wheel all work by keyboard.
  - No console message, including the old negative-width error (RR3-13 was taken).
- **Keyboard:** 27 runs, nine pages at three sizes. The skip link is the first Tab stop everywhere. The only controls off the Tab order are the credits page's two inactive tabs, which the arrow keys reach.
- **Without script:** 22 loads. Every page reads in full, and See it work shows its twelve stills.

## RC.4 The preflight

`node enablement/check-site.mjs`, run in the repository on the committed files: 161 of 161 checks pass, exit 0, "All checks passed." It includes:

- the comparison with the local `.dev.vars` values, which it compares and never prints;
- the gate's 33 of 33 unit tests;
- the text check.

The only uncommitted file in the tree is `docs/enablement/lanes/M1.md`, which the preflight does not read.

## RC.5 What was not taken

These were recommendations, not required edits:

- **RR3-11:** without script, the engineers' instrument boxes are still empty.
- **RR3-12:** `see-it-work.md` still sets its rule as bold paragraphs, not callouts.
- **L3-4:** the stacked credits tabs still have no `aria-orientation`.

RR3-1 to RR3-10 and RR3-13 are all in.

## RC.6 Conduct

- **What I wrote.** I wrote only this file.
- **Git.** No git command that changes anything. `git archive`, which only reads, extracted HEAD into the scratchpad.
- **The repository.** The preflight ran there; it reads and changes nothing. No install, deploy, delete or kill.
- **Servers and Chrome.** Servers ran on ports 9461 to 9464 and exited by themselves. Every Chrome run was headless on its own profile in the scratchpad and closed with `Browser.close`.
- **One probe crashed** on a malformed regular expression before it could close Chrome. I checked its debug port: nothing was listening, so nothing was left running.
- **The live worker** behind the gate was out of scope and not checked.

# Round four, 2026-10-03: version 3, the visual rebuild

Under `LANE-BRIEF-V3.md` (the owner's three rules, the spine of §3, the pieces of §4, the tooling of §5, the gate of §7), the three approved mocks, `LANE-BRIEF-V2.md`, `LANE-BRIEF-COMMON.md`, the design's §9, the glossary, `../verizon/explainer/FACTS.md` and S2 for the constants, S4 for the quotations, and the six-slide visual brief. The lane notes S1, M2, T1, A1, G1 and W's version 3 section were read as claims and checked, never taken as evidence.

**What was reviewed, and when.** The tree moved four times while I worked, so the scope is stated exactly:

- **In full:** every page, partial, source, figure and tooling file as committed in `5083fab6` (10:19). The working tree equaled it when I began (10:29, checksums of all 137 files under `enablement/` and `docs/enablement/`).
- **Two deltas** on the sellers' and engineers' pages:
  - `3c3e5418` (10:56): one picture per instrument card; the objections as two pictures.
  - `e82925bc` (11:12): instrument cards one per row; the objections' quote card as the section's first picture.

  For each, I read the changed sources, reran the text check and the preflight, and reran the headless pass on the two pages from copies taken at about 11:05 and 11:18.
- **The Word copies** as committed in `819c6d9c` (11:20), read part by part (byte-identical to the files I unzipped at 11:17). The builds of 10:56 to 11:01, which they replaced, were read too, and the differences are noted.
- **The converter change** in `scripts/md2docx.mjs`, committed in `819c6d9c` under the lead's ruling.

## R4.1 Verdicts

| Item | Verdict | Findings |
|---|---|---|
| `/` (landing) | PASS | none |
| `/what-it-is` | PASS | none |
| `/see-it-work` | FAIL | B4-1; minor M4-1, M4-6, M4-7, M4-8 |
| `/selling-it` (at `5083fab6`, `3c3e5418` and `e82925bc`) | PASS | minor M4-6 |
| `/battlecard` | PASS | minor M4-2 |
| `/how-it-works` (at `5083fab6`, `3c3e5418` and `e82925bc`) | PASS | minor M4-3, M4-4, M4-5 |
| `/how-it-works-interactive`, `/credits`, `/glossary`, `/demos`, the 404 page | PASS (chrome re-stamped, content unchanged by V3 §4.6) | none new |
| `enablement/partials/header.html`, `footer.html`, `spine.html`, `spine-compact.html` | PASS | none |
| `content/spine.md`, `content/spine-compact.md` | PASS | none |
| `content/what-it-is.md` | PASS | none |
| `content/see-it-work.md` | FAIL | B4-1 |
| `content/selling-it.md` | PASS | none |
| `content/battlecard.md` | PASS | none |
| `content/how-it-works-and-where-it-runs.md` | PASS | minor M4-3, M4-4, M4-5 |
| `figures/se-signal-chain`, `se-learning-and-receipt`, `se-published-documents`, `se-integration` (SVG and PNG) | PASS | none |
| `figures/architecture`, `decision-path` (reused, inlined verbatim) | PASS | none |
| `figures/shot-*.png` (45 at `819c6d9c`) | PASS | none |
| `enablement/render-pages.mjs` | PASS | none |
| `enablement/render-check.mjs` | PASS | minor M4-9 (holes beyond V3 §5's letter) |
| `enablement/check-site.mjs` | PASS | none |
| `word/Enablement-What-It-Is-v3.0.docx` | PASS | none |
| `word/Enablement-Selling-It-v3.0.docx` (the build of 11:16) | PASS | none (the build of 11:01 failed, R4.4, resolved) |
| `word/Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` (the build of 11:16) | PASS | none |
| `word/Enablement-Battlecard-v3.0.docx` | PASS | none |

One blocking finding, which may be one ruling away from a pass (D1), and nine minor ones. Three earlier findings were resolved by the lanes and the lead during the round (R4.4).

## R4.2 What I ran

- **The three commands.**
  - **The stamp.** `node enablement/render-pages.mjs --stamp` was not run on the tree: the permission classifier refused it as a possible write, and I write only this file. I ran the same step into scratch instead (`--stamp --out <scratch>`, which copies the served folder first): all eleven pages "already current" and "figure copies … none needed", so the step on the tree is a no-op at `5083fab6`. Checked by bytes (LF-normalized, the page's own `aria-current` aside), every header, footer, spine and compact block on all eleven pages is identical to its partial.
  - **The text check.** `node enablement/render-check.mjs`: exit 0, "Every page says what its sources say. All checks passed.", at all three commits:
    - at `5083fab6`: battlecard 78 and 78 sentences, what-it-is 136 and 158, see-it-work 37 and 37, selling-it 207 and 207, how-it-works 172 and 172; every scan 0, the reader scan 0;
    - at `3c3e5418`: selling-it 209 and 209, how-it-works 175 and 175;
    - at `e82925bc`: selling-it 210 and 210, how-it-works 175 and 175, and no picture left uncaptured.
  - **The preflight.** `node enablement/check-site.mjs`: exit 0, 188 checks passed, at all three.
- **Headless Chrome 153** over CDP, each run on its own scratch profile, closed with `Browser.close`, on copies of the served folder served with `_headers` the way the assets binding serves it:
  - 66 loads (11 addresses, 1440×800, 1366×768 and 390×844, light and dark), scrolled through.
  - Contrast: 44 loads under reduced motion, every HTML text by computed color and every inline SVG text against the pixels behind it in a full-page capture.
  - 20 reduced-motion runs, 44 loads without script, 20 keyboard runs.
  - 16 motion runs on the four full-spine pages, plus the marketing page's own pictures.
  - The tour walked by keyboard only in both regions at 1366 and 390, and by mouse at 1440 dark.
  - Six battlecard PDFs (Letter and A4; light, dark, and browser defaults) and a print-media contrast probe.
  - For each delta: 12 loads, 8 contrast, 8 no-script, 8 reduced and 4 keyboard runs on the two pages.
  - Every full page looked at, at 1440 and 390, light and dark, in pieces.
- **Recomputation.** My own implementation of the tour's model, from FACTS §1 to §3 and S2 §3.4, §3.6 and §3.10 to §3.12 (not from `see-it-work.js`), against every step in both regions; the engineers' worked numbers by hand. The four new figures rendered afresh at device scale 2 and compared with their PNGs: the differences are scattered antialiasing, never more than 66 strongly different pixels in any 100-pixel square.
- **Mutation proofs:** 30 cases on fresh scratch copies of `enablement/` and `docs/enablement/` (R4.5).
- **Static scans** of 52 files: the five pages' sources, the partials, every served page, stylesheet, script and figure, and the three tooling files (pronouns, names, the abbreviation, dashes, label and state words, British spellings, timing figures, deprecated glossary words, first-person voice).
- **The Word copies** unzipped into scratch and read part by part (R4.6).
- **Quotations** checked against their source lines through S4 (R4.3, item 5).

## R4.3 The gate, item by item

1. **Rule 3, as the owner will read it.** Every section of the five pages is a picture, a flow, an instrument, a storyboard, cards, tiles or a table with short text beside it. I looked at each one as its reader would. The densest are the marketing page's twelve say and never-say pairs, the sellers' thirteen objection pairs and the thirteen capability cards under the pillars; all three are the card pairs and cards V3 §4 prescribes, not prose. No section reads as a paragraph wall. At `e82925bc` the engineers' instrument cards read as instruments: drawing on the left, formula, worked example and meaning on the right. Scripted parts: every `<section>` has a `data-visual` element, and no text block is over 60 words (over 120 on the engineers' page; the longest there is 78).
2. **Story first.** The spine opens every piece, byte-identical to its partial, the compact one on the battlecard (R4.2). The spine's text equals V3 §3: all 46 quoted strings of §3 are in `spine.md` and the partial verbatim, "Play again" being chrome. The two recorded departures are as ruled: the carousel title "Recommended for you" carries `data-ui-label`, and the loop plays once and holds, with "Play again".
3. **Third person.** No "you", "your", "yours" or "yourself" outside `[data-reader]` and `data-ui-label` on the five pages, by the text check and by my own browser scan of what each page shows and says aloud. The brand, its merchandisers and its systems are in the third person ("the brand's team", "the brand's carousel", "the pins for what the brand sells"). The only second person is inside the never-say quotations and the objections a customer asks ("Will it override our merchandisers?"), all inside `data-reader`.
4. **The mocks.** Section order and kind of visual match mock 2's opening and list, mock 1's kinds and mock 3's three columns, with these departures, each recorded and ruled: the engineers' page adds "Why customers choose it" before its first section (the lead's ruling, `lanes/G1.md` §8); the marketing page ends with three link cards where V3 §4.1 names two and mock 2 names the tour and the battlecard (`lanes/M2.md` §8 item 1); the tour's first click is an add to the bag (`lanes/T1.md`, departure 2).
5. **The material's law.**
   - Present tense, no build-state, stage or label word, no chip or legend: clean on all five pages and their sources.
   - The thirteen capabilities of V2 §2.3 are all on the marketing page, as cards under the four pillars, mapped as `lanes/M2.md` §3 says (each checked against design §4.2, K1 to K13). They are also on the sellers' and engineers' pages.
   - The ten reasons, unranked, with "Each customer weighs these reasons differently.", are on the marketing page, the sellers' page, the battlecard and the engineers' page.
   - The four fixed sentences: verbatim on the marketing page, the sellers' page, the battlecard and the engineers' page. The tour carries the recommendations and AI sentences (spine) and the learning sentence (step 7), but not the performance sentence (B4-1).
   - No other performance or speed figure anywhere. What remains are constants (14 days, 9.96 days, 30 minutes for a click), the tour's declared 5-minute memory and clock, and "Live in two weeks" as a never-say.
   - No customer, prospect or competitor name in any page, source, figure, script, comment, alt text, SVG text, file name or Word part (the tooling's own scan patterns name them, as before).
   - Quotations by industry only, each the customer's own words, none with a gendered pronoun:
     - "This capability doesn't exist off the shelf; we need to build it.": S4 8.30, `tapestry_requirements.txt:243`.
     - "A site that feels like a stylist who remembers.": S4 8.33, line 126.
     - "It works, but it caps out.": S4 8.32, line 103.
     - "The differentiation opportunity is in content and experience.": S4 4.1, line 239.
     - "It's snowing in the Pacific Northwest, we might want to display relevant content to those customers.": S4 1.13, `QVC-Use-Cases-and-Engine-Fit.md:59`.
     - "How else would it learn? I don't understand.": S4 8.13, extraction line 604.
     - The home-shopping question (S4 5.12) is a paraphrase without quotation marks.
   - The pronoun scan is 0 everywhere. American English. No em-dash on the five pages or in their sources. Headings are statements but one (M4-3). The glossary's words are used; "segment" appears only in the spine's V3-verbatim contrast.
6. **Honesty.**
   - The tour's region is chosen on the page ("Pick where this visitor is"). No button is pressed and Next is disabled until the reader picks, and the receipt says "picked on this page".
   - The store is called a sample, and its leans invented, on the page and in the callout. Nothing in the tour is called a demo or a customer.
   - The 5-minute memory is said on the page beside the engine's 14-day default (step 4).
   - My recomputation agrees with every step in both regions: the orders, the heroes, the levels with their entry and release, the region's share (62, 51, 66 and 60 percent), the release at 4:03 (0:30 plus 5 × ln(3/1.4727) = 3.558 minutes), the pin, and the holdout's page in the brand's own order with the pin kept. Every printed line of step 6's receipt recomputes: 1 ÷ 1.670 = 0.599; 0.401 × 0.514 + 0.599 × 0.75 = 0.655; 0.599; 0.063.
   - The engineers' numbers equal FACTS and S2. One view gives 0.357, two 0.526, three 0.625. Entry needs R ≥ 2.7 and release comes below R = 1.4727, after 9.96 days. 3 × e^(−12/14) = 1.27, so coats reads 0.41, and evidence halves every 9.7 days. λ = 1/(1 + 1.07) = 0.48 and λ = 1/3.13 = 0.32. The coat story scores 0.46, then 0.52, then 0.572. On arrival the edit reads 0.56, 0.52, 0.36 (yielding to the cap) and 0.34; after the first view 0.374, 0.357 and 0.201. The receipt reads 0.200 + 0.114 + 0.060 = 0.374 with λ 0.483. Sixty against 720 is 6 × 10 against 6!. The blend constant is FACTS's kBlend at its compiled default of 1, kept apart from K. One example cannot be recomputed from the page as written (M4-4).
7. **The look.** At 1440×800, 1366×768 and 390×844, light and dark:
   - No horizontal overflow; no console message (the 404 page logs its own 404 status, as it must); only same-origin requests (the page, `site.css`, `spine.css`, its own stylesheet, `site.js`, `spine.js`, its own script); no policy report.
   - Contrast: every HTML text at least 4.91 to 1 in light (the tour) and 5.54 in dark (the interactive page); every SVG text measured at least 5.12.
   - The skip link is the first Tab stop on every page, and every control is reached by Tab.
   - The watch-it loop waits while out of view, plays when it comes into view (the ring at about 1.2 s, the trade at 2.4 s, the receipt by 3.6 s), holds its end state, and replays by mouse and by Enter, on all four full-spine pages.
   - Under reduced motion nothing runs, every picture shows its end state and "Play again" is hidden. Without script every page reads in full, the spine at its end state, the tour as its seven-frame storyboard.
   - The tour is walkable by keyboard in both regions, and its callout and new receipt lines are polite live regions; but focus is lost after the region is picked (M4-1).
   - The battlecard prints on one sheet on Letter and A4, light, dark and with the browser's default margins; printed from a dark-mode browser, three labels fall to 1.15 to 1 (M4-2).
8. **The tooling.** The five kinds of mutation the brief names are each caught; the new checks do what V3 §5 says, and S1 widened several beyond its letter. A page can still pass them while failing rule 2 or rule 3 (R4.5, M4-9). None of the pages does.
9. **Word.** Four copies, each opening with the spine, its sections as pictures with captions (one plain lead line before a picture where the design's rule 5 puts one, as the lead read it). Every picture is byte-identical to its repository PNG, the contents are linked, every internal link resolves, the version is "3.0", the names end `-v3.0.docx`, the three superseded v2.0 files are out of the folder and the glossary, credits and demo map v2.0 files are still there. The pronoun and name scans are 0 in every part. They were built with the converter as the lead ruled it changed, a link inside bold becoming a bold link and every heading keeping with the next; that is not the "unchanged converter" of V3 §7.6, but the change is the lead's ruling, recorded in `lanes/W.md` V3.10 and committed with the documents.
10. **The two-minute test** (R4.7): passed by all four pages.

## R4.4 Findings

### Blocking

- **B4-1. The tour lacks the performance sentence.** `docs/enablement/content/see-it-work.md` (no line holds it) and `enablement/site/see-it-work.html` (no step holds it; V2's tour carried it under the first-click scene, design §3.6). The gate as briefed asks for the four fixed sentences verbatim on every piece. V3 §4.2 names only the learning sentence for the tour, and the tour makes no speed claim, so this is the lead's call (D1). One line in step 2's text and the markdown, then the stamp and the text check, would pass it.

### Minor

- **M4-1. The tour drops keyboard focus after the region is picked.** `enablement/site/see-it-work.js`: `pickRegion()` (line 930) moves no focus, and `render()` re-inserts the picker with `callout.actions.replaceChildren(...)` (lines 912 and 919), which takes the focused button out of the document. Focus falls to the body; one Tab returns to the first region button and two more reach "Next step", in both regions at 1366 and 390. Every later action does land focus usefully, as `lanes/T1.md` says. Calling `focusNext()` from `pickRegion()`, or keeping the picker node in place, would fix it.
- **M4-2. The battlecard printed from a dark-mode browser shows "The engine" at 1.15 to 1.** `enablement/site/spine.css:27` sets `--spine-accent` to lime under `prefers-color-scheme: dark`, and `:84` colors `.spine-who-engine` with it. Neither `spine.css:282` nor `battlecard.css:165` resets it for print, while the rest of the sheet prints light. The result is three lime labels on near-white in the compact rows (measured `rgb(171,255,68)` on `rgb(246,248,243)`). The other 121 texts measured on that printed sheet pass AA, and in a light-mode print every text is at least 5.65 to 1.
- **M4-3. One heading is not a statement.** "Why customers choose it", `content/how-it-works-and-where-it-runs.md:5`, `how-it-works.html:151`, set by the lead's ruling. The other three pages say "Customers choose it for different reasons".
- **M4-4. One worked number cannot be recomputed from the engineers' page.** Line numbers are at `e82925bc`. The prior card says "after three views, Σa = 2.13 and λ = 0.32" (`how-it-works-and-where-it-runs.md:106`), and the interest card says "The visitor views three tailored coats" (`:50`). A reader who takes all three as premium computes Σa = 3 × 0.625 = 1.875 and λ = 0.35. The 2.13 is right only with one coat at the core price (coats 0.625, tailored 0.625, premium 0.526, core 0.357), as version 2's walk said and this page no longer does. Name the price bands, or use 1.875 and 0.35.
- **M4-5. Since `3c3e5418` the engineers' page uses k before it defines it.** The sentence naming "a blend constant k of 1" moved below the six cards (`:122` at `e82925bc`), so the prior card's `λ = k / (k + Σa)` (`:102`) meets k undefined. Design §3.0 item 8 asks for every instrument explained before it is shown.
- **M4-6. Text inside drawn frames is small at desktop widths.** The sellers' storyboard frames set their 55 labels at 9.3 px at 1440 and 1366, and the tour's stills at 7.8 to 10 px. At 390 they read at 15.2 and 10.1 to 13 px. The captions carry the meaning, so this is legibility, not content.
- **M4-7. The tour's target card pulses without end under motion.** `see-it-work.css:231` and `:233`, `tour-beckon … infinite`: a blinking box shadow with no pause other than acting on it (WCAG 2.2.2). It stops under reduced motion and when the reader acts.
- **M4-8. The tour's store palette is a set of new tokens in `see-it-work.css:12` to `:29`, not in `spine.css`.** V3 §5: "a new token goes in `spine.css` under `:root`, with its dark value". They are scoped to the article and carry dark values, so the intent holds; `lanes/T1.md` does not record the departure.
- **M4-9. `render-check.mjs` can be passed by a page that fails rule 2 or rule 3** (R4.5):
  - `data-visual` is an attribute test (`hasAttrInside`, line 395, used at 643), so a `div` of text carrying it passes;
  - `data-reader` exempts any subtree of any size (line 377), so the attribute on a section or the `<article>` silences the reader scan;
  - the prose budget counts only `PROSE_BLOCKS` (line 167), so text in a heading or a `span` is not counted;
  - `REFUSED_CLASS_PARTS` (line 169) misses "chips" or "labels";
  - the state words find "Open" only before "." or ":" (line 103) and do not list "coming soon";
  - story first refuses only a section or heading before the spine (line 715), not a picture;
  - the timing scan finds milliseconds only (line 779), so "0.2 seconds" passes;
  - the name scan lists six names (line 778).

  No page exploits any of them now.

### Resolved during the round

- **Selling it's Word copy of 11:01 opened its objections section with four text blocks before its first picture.** These were the lead, the quote and its two lines, from `selling-it.md:73` to `:83` at `3c3e5418`; it was blocking under the gate's Word item, and lane W's check 17 failed it. `e82925bc` gave the quote card its own picture (`shot-ae-objections-quote.png`), and the build of 11:16 opens the section with one lead line and that picture. Committed in `819c6d9c`; rechecked.
- **The engineers' instrument cards printed as tall pictures held to 8 in.** At first the six cards were one picture; then, at `3c3e5418`, each card was one but tall. Either way they made near-empty pages in the Word copy. Since `e82925bc` they sit one per row, and each prints at text width, 2.5 to 4.1 in tall. Word's pagination was not remeasured by me.
- **The converter change was uncommitted when the copies were first built.** It is committed in `819c6d9c`, and the lead's ruling is recorded. It also settles lane W's finding of twelve links inside bold (`what-it-is.md:148` to `:150`, the demo cards of `selling-it.md`, `how-it-works-and-where-it-runs.md:206`): my reading of the copies shows them as hyperlinks with no markdown left.
- **Two pictures named by no source, `shot-se-instruments.png` and `shot-ae-objections.png`,** are no longer in the folder.

**Noted, not findings.**

- The credits page still speaks to the reader as the brand ("your shoppers' clicks"), outside V3's scope (§4.6).
- The interactive page shows a dash placeholder for a missing readout, unchanged since round three.
- The luxury retailer's "It then chose to build the capability with us." was accepted in round three (RR3-1).
- The quotations rest on the lead's ruling that V2 §4 is the owner's ruling S4's rule 3 asked for.
- The marketing page carries about 2,000 visible words against the owner's earlier guidance of about 600, as the lead ruled (`lanes/M2.md` §8 item 7).

## R4.5 The tooling, by mutation

Each case ran on a fresh scratch copy of `enablement/` and `docs/enablement/` whose base passes both checks; a case is judged by the failures it adds.

| # | Mutation | Expected | Result |
|---|---|---|---|
| 1 | A section of two paragraphs and no `data-visual` (what-it-is) | caught | caught: no `data-visual`, no `data-shot` |
| 2 | "Your team" in a capability card | caught | caught |
| 3 | "your team" in an `aria-label` (selling-it) | caught | caught |
| 4 | "your carousel" in a string of `see-it-work.js` | caught | caught |
| 5 | A 70-word `<p>` (selling-it) | caught | caught |
| 6 | One word changed in the stamped spine | caught | caught |
| 7 | A class added inside the stamped header | caught | caught |
| 8 | The spine moved below the tour's first section | caught | caught |
| 9 | `class="chip"` (battlecard) | caught | caught, twice |
| 10 | A visible "Built" on a card | caught | caught |
| 11 | The performance sentence reworded, page and markdown | caught | caught |
| 12 | A gendered pronoun in a tour caption and markdown | caught | caught |
| 13 | Five 100-word paragraphs in a `div` marked `data-visual` (engineers) | hole if it passes | passes |
| 14 | "Your team" inside a section carrying `data-reader` | hole if it passes | passes |
| 15 | "what you already have" with `data-reader` on the `<article>` | hole if it passes | passes |
| 16 | The 70 words in a `<span>` inside the figure | hole if it passes | passes |
| 17 | The 70 words in an `<h3>` (battlecard) | hole if it passes | passes |
| 18 | Two adjacent 59-word paragraphs | by design | passes |
| 19 | A picture placed between the h1 and the spine | hole if it passes | passes |
| 20 | `class="chips"` | hole if it passes | passes |
| 21 | A pill reading "Open", page and markdown | hole if it passes | passes |
| 22 | A pill reading "Coming soon", page and markdown | hole if it passes | passes |
| 23 | "It decides in 0.2 seconds." | hole if it passes | passes |
| 24 | A customer's brand in a quote attribution, page and markdown | hole if it passes | passes |
| 25 | A pill reading "Open", page only | caught | caught, by the text comparison alone |
| 26 to 30 | `check-site.mjs`: `/spine.css` twice; `/spine.js` without `defer`; another page's stylesheet; a network call in `spine.js`; a `style` attribute | caught | all five caught |

## R4.6 The Word copies

As committed in `819c6d9c`:

| Copy | Bytes, sha-256 (16) | Sections | Pictures, all byte-identical to the repository's | Contents and links | Version | Scans |
|---|---|---|---|---|---|---|
| What it is | 1,844,626, `8d6eb9a2e1da1b64` | the spine's 5, then 7 | 12 | 12 linked entries; 12 internal links, all resolve; 4 external | 3.0 on the cover and in the footer | 0 pronouns, 0 names, 0 dashes, no literal markdown, no visible host name |
| Selling it | 2,709,590, `00e0fc150ef85471` | the spine's 5, then 7 | 14 | 12; 12, all resolve; 12 external | 3.0 | 0, 0, 0 |
| How it works and where it runs | 3,953,750, `49382a0c7d8238fd` | the spine's 5, then 8 | 21 (15 captured, 6 drawn) | 13; 13, all resolve; 2 external | 3.0 | 0, 0, 0 |
| Battlecard | 811,941, `adb51ecf0b260c27` | the short spine before the first section, then 6 | 7 | 6; 6, all resolve; 7 external | 3.0 | 0, 0, 0 |

- **Order.** Each copy opens with its cover, the contents, the reader line, then the spine, then its sections, each opening with its picture and caption.
- **Lead lines before a picture.** The spine's "Both engines on one page" opens with its 13-word lead, as `spine.md` orders it. The engineers' sections and the sellers' objections open with one lead line before the picture, as the design's rule 5 reads (the lead's ruling).
- **"You" in the copies.** Only "Recommended for you" (the carousel's own title) and the never-say quotations, as on the pages.
- **Headings.** Every heading keeps with the next paragraph.
- **The folder.** The v2.0 copies of what it is, selling it and how it works are gone; the glossary, credits and demo map v2.0 files are in place.
- **Not machine-verified:** Word's own pagination, a Ctrl+Click and Save as PDF, as in earlier rounds.

## R4.7 The two-minute test

Each, from what the page showed me and nothing else:

- **What it is.** The engine follows what each visitor does on this visit and rearranges the brand's page around it, click by click, while the brand's team sets the rules, pins what it sold and can read a receipt for every decision. It differs because it decides from what the visitor is doing now rather than ranking past purchases, needs no segments or expiration rules because interest fills and drains like buckets, and calls no AI model to decide.
- **See it work.** A stranger's first page leans toward what visitors in their region like; each action fills an interest bucket that reorders the page's sections, the bucket drains and releases on its own, a merchandiser's pin holds its place, and a receipt shows the arithmetic for every place. It differs because it reacts within the visit with arithmetic a person can recompute, and learning changes nothing until the brand turns the dial.
- **Selling it.** The engine turns a stranger's first clicks into a page arranged around their interest, keeps the brand's gates and sold placements first and writes every decision on a receipt. A customer can measure strangers' conversion, rule upkeep, placements kept and lift against a holdout. It differs from recommendations, which rank the past, and from rules, which go stale, by deciding at the point in time; customers choose it for different reasons, and the seller listens for theirs.
- **How it works and where it runs.** Each event adds its weight to the raw score of every dimension value it touches. Interest a = R/(R + 1.8) fades with τ, 14 days by default; a visitor joins at 0.60 and is released below 0.45; the region blends in by λ = k/(k + Σa). Each piece scores Σ ω × ã after gates and pins, with a cap per value, a receipt for every decision and learning held at γ = 0 until the brand turns it. It runs as one Worker per deployment at the edge, configured by four published, versioned documents, and calls no AI model to decide.

All four pass. The marketing page tells it fastest, from the spine's first two blocks and the pillars.

## R4.8 For the lead to decide

1. **D1.** Whether the tour must carry the performance sentence (B4-1): add one line, as V2's tour did, or waive it, since V3 §4.2 does not ask for it.
2. **D2.** Whether to close the check's holes now (M4-9). Closing them would mean bounding `data-reader` to a section or smaller, requiring a drawn element (SVG, image or table) inside a `data-visual` element, counting every element's own text in the budget, refusing class names that merely contain chip, label or legend, scanning for a whole element reading a label word, and widening the name list. They let a page pass while failing the owner's rules, though none does.
3. **D3.** Whether V3 §7.6's "built by the unchanged converter" should now read as the converter at `819c6d9c`, so that the next build and the next review hold to the same rule.

When resumed: B4-1 if the lead adds the line, and any of M4-1 to M4-8 the owners take up.

## R4.9 Conduct

- **What I wrote.** Only this section of this file. The checksums of all 137 files under `enablement/` and `docs/enablement/`, taken at 10:29, were compared again before writing. Every difference was made by other lanes and the lead: the commits `3c3e5418`, `e82925bc` and `819c6d9c`, and the files W wrote on the way to the last.
- **Git and the tree.** No git command that changes anything. No install, deploy, delete or kill. The stamp was run only into scratch after the classifier refused it on the tree.
- **Scratch.** Every copy, script, mutation tree, screenshot, PDF and unzipped document is in `scratchpad/r4/`. The mutation trees were made in new folders, so nothing needed deleting.
- **Chrome.** Every Chrome run was headless on its own profile and closed with `Browser.close`. Two harness runs stopped early (a missing favicon in one server; a path the shell rewrote in another). I checked their debug ports afterwards: nothing was listening, so nothing was left running.
- **Out of scope.** The live worker behind the gate was not checked.

# Round four, delta, 2026-10-03: the committed fixes, pages only

**Scope.** This pass covers the pages, partials, sources, figures and checks as committed in two commits: `6aa479f5`, which closed the findings, and `4419a253`, which records the lead's rulings in design §12. I worked from a scratch copy of the tree at `4419a253`.

`03104fbe` was committed while I worked, and it changes only the Word copies and their pictures. `git diff --stat 4419a253 03104fbe` is empty over `enablement/site`, `enablement/partials`, the two checks, the name file and `docs/enablement/content`, so every result below holds at `03104fbe` too.

The two rebuilt Word copies are not in this pass; they follow when lane W2 reports.

## Verdicts

| Page | Verdict | Still open |
|---|---|---|
| `/what-it-is` | PASS | none |
| `/see-it-work` | PASS | none; M4-8 stands as T1's departure 12, by the lead's ruling |
| `/selling-it` | PASS | M4-10 by the shared table rule (not printed in this pass) |
| `/battlecard` | PASS | minor M4-10 |
| `/how-it-works` | PASS | M4-10 by the shared table rule (not printed in this pass) |

Every finding of round four is closed as its owner's note says, except one remainder of M4-9 in the name file. One new minor finding, M4-10, came from printing to PDF rather than emulating print.

## Each finding against its owner's note

- **B4-1, closed (T1).**
  - The performance sentence is verbatim in `content/see-it-work.md:19` and in step 2 of `see-it-work.html:166`.
  - In the browser, with script, it is in step 2's visible text at 1366, with and without reduced motion.
  - The tour now carries all four fixed sentences, as design §12 records (D1).
- **M4-1, closed (T1).** I walked the tour by keyboard only, in both regions, at 1366 and 390.
  - After Enter on a region, focus stays on that region's button, never on the body.
  - "Next step" is one Tab away from Florida and two from Washington State, with the other region's button between.
  - All seven steps, the pin and the holdout equal my independent recomputation in all four walks.
  - The callout is a polite live region, and no console message appeared.
- **M4-2, closed (S1).**
  - Printed from a dark-mode browser, the three "The engine" labels are #197050, 6.04 to 1 on white.
  - The text colors in the dark and light PDFs are identical, except 23 runs in the dark scheme's numbered badges, which print fir instead of white.
- **M4-3, closed (G1).** The heading reads "Customers choose it for different reasons" at `how-it-works-and-where-it-runs.md:5` and `how-it-works.html:151`.
- **M4-4, closed (G1).**
  - `how-it-works-and-where-it-runs.md:108` now reads "Of the three tailored coats, two are premium and one is at the core price".
  - From that line, Σa = 2.133: coats (three views) 0.625, tailored (three) 0.625, premium (two) 0.526 and core (one) 0.357.
  - Then λ = 1/3.133 = 0.32, as printed.
- **M4-5, closed (G1).**
  - The formula defines k where it first appears: "λ = k / (k + Σa), with k the blend constant" (`:102`, `how-it-works.html:579`).
  - The worked example under it opens with k's default of 1.
- **M4-6, closed (A1, T1).** The smallest text inside a drawn frame, before and after:

  | Frames | At 1366 and 1440 | At 390 |
  |---|---|---|
  | Sellers' storyboard | 11.2 px (was 9.3) | 18.3 px (was 15.2) |
  | Tour stills | 13.9 px (was 7.8 to 10) | 11.3 px (was 10.1 to 13) |

  The tour figures agree with T1's note.
- **M4-7, closed (T1).**
  - On the target card, `tour-beckon` runs three iterations of 1.8 s.
  - At 6.2 s no animation remains on the card.
  - Under reduced motion, none starts.
- **M4-8, recorded.** T1's departure 12 carries the lead's ruling. Nothing is asked of the page.
- **M4-9, closed except for the name file (S1, A1, M2).**
  - `data-reader` now sits on leaf blocks only. On the marketing page it covers 31% of the words, and the check now refuses more than half on any page.
  - The hardened checks catch ten of the eleven holes (below).

## The checks

- `node enablement/render-check.mjs` exits 0. `node enablement/check-site.mjs` exits 0 with 189 checks.
- **Mutations.** I reran all thirty of round four's mutations, plus four new probes, on a scratch copy of `4419a253`:
  - The eighteen mutations caught in the round are still caught.
  - Ten of the eleven former holes are now caught: #13 to #17 and #19 to #23.
  - #18 (two adjacent 59-word paragraphs) still passes, by design.
  - #24 still passes: a quote attributed to one of the customer's other brands, in the page and the markdown, is not refused.
  - Probe #34 (a 70-word SVG text in a storyboard frame) is caught.
  - Probe #33 (a reader-voice line in a leaf with `data-reader`) passes, as it should.
- **Still open (minor, for S1 and the lead).**
  - **The name file covers less than its header claims.** `enablement/name-patterns.txt` holds 28 patterns.
    - It names the customer and one of its brands, but not the brand used in #24. S3 names that brand, and the header does not claim to cover S3.
    - It also omits the two customer people S4 names at rows 1.13 and 5.12, although its header says it holds "the customer people those files name".
    - Adding the other brands in the customer's group, and those two people, would close #24.
  - **Probe #31 passes.** Five 100-word paragraphs in a `data-visual` div pass when the div also holds one empty span that the stylesheet draws.
  - **Probe #32 passes.** "It decides in under a second." (no digit) passes the timing scan.
  - Both probes need a reader's judgment, and no page does either.
- **Two notes are stale on one point.**
  - S1 §9's row for #23 and T1's M4-9 bullet say the timing scan reads minutes.
  - The check (`render-check.mjs:117`) and design §12 ("Minutes leave the timing scan") say it does not.
  - The pages are unaffected.

## The browser pass

I loaded the five pages from the scratch copy of `4419a253` at 390, 1366 and 1440, in light and dark. The first three runs below each covered all 30 combinations of page, width and scheme:

- **With script.** All 30 loads were clean: status 200, no request off origin, no failed request, no console message, no horizontal scroll.
- **Reduced motion, 30 loads.** Every page opens at its end state, and nothing runs at load or after scrolling.
- **Without script, 30 loads.** No section is hidden, and the text is as long as the scripted page's. There was no horizontal scroll and no console message.
- **Contrast.** At 1440 and 390, HTML text is at least 4.91 to 1 in light and 6.7 to 1 in dark; SVG text is at least 5.12 to 1.
- **Keyboard.** At 1366 and 390, the skip link is the first stop on every page.

I also printed the battlecard to PDF from a light-mode and a dark-mode browser. Each was printed on Letter with and without background graphics, and on A4 without:

- It prints on one page every time.
- Every text passes AA against its background as computed under print media; the lowest is 5.65 to 1, in both schemes.
- The four fixed-sentence bands print dark, with white and lime text, in both schemes. This is by design: `print-color-adjust: exact` keeps their background even with background graphics off.

## New finding

**M4-10 (minor).** Table headers print light gray on white when background graphics are off, which is Chrome's default.

- **The cause.** In `enablement/site/site.css:229-230`, `.rt th` takes `--th-bg` (fir) and `--th-ink` (white), and the print block (`:549`) keeps both. Unlike the fixed-sentence bands, the rule sets no `print-color-adjust: exact`. Without background graphics, Chrome drops the fir and darkens the white text to #ABABAB, 2.3 to 1 on white.
- **The evidence.** I read the text colors out of the PDFs' content streams. In all four no-background PDFs (light and dark, Letter and A4), exactly 42 text runs are #ABABAB. That is the character count of the battlecard's two headers, "The question to ask" and "The measure it leads to". With background graphics on, those runs print white on fir.
- **Why round four missed it.** Round four measured under emulated print media, where backgrounds are always drawn.
- **Other pages.** The same rule styles the tables on `/selling-it` (8 headers) and `/how-it-works` (5). I did not print those pages.
- **The fix.** Add `print-color-adjust: exact` to `.rt th`, or print the header as ink on a light fill.
- **The owner.** The stylesheet is shared, so the lead assigns it.

## Conduct

- **What I wrote.** Only this section, appended to this file.
- **Git and the tree.** No git command that changes anything. No install, delete, kill or deploy.
- **Scratch.** The copies, the probes (`tourkeys4.mjs`, `probe-print4.mjs`, `pdfcolors.cjs`), the PDFs and the results are in `scratchpad/r4/`, under `out/` and `out4/`.
- **Chrome.** Each run was headless on its own profile and closed with `Browser.close`.

When resumed: the two rebuilt Word copies, plus M4-10 and the name file if their owners take them up.
