# Lane brief, version 3: the approved design, built visually

**Status.** The owner approved the design on 2026-10-03 ("It's a proposal, let's go ahead and do it") as the three
mocks in `docs/enablement/mocks/`, with one condition for the build: **no section is just a text dump**, in any piece,
the solutions engineers' included. "This is not about taking more text and throwing it into a book report or a
document that is just text after text like if it was a legal brief."

**What is law.** This brief governs the form, the structure and the tooling of every piece. `LANE-BRIEF-V2.md`
still governs what the material says: the finished product as capabilities, the story, every capability and every
reason, the four fixed sentences verbatim, quotations by industry, no customer, prospect or competitor name, no
build state. `LANE-BRIEF-COMMON.md` still governs conduct, ownership, formats, gender-neutral language and the
glossary's words. Where this brief conflicts with `BTI-Enablement-Design.md` (version 2), this brief wins; the design
document's §7 (the site) and §9 (the gate) stand except where §5 and §7 below change them.

Read in this order: this brief; the three mocks (open them in a browser, read their comments); V2; COMMON;
`research/live-experience-vs-recommendations.source.html` (the six-slide visual brief whose side by side the spine
reuses); `GLOSSARY.md`; `research/S4-story-sources.md` and `research/S5-product-as-designed.md` for facts and
quotations; `../verizon/explainer/FACTS.md` for the engine's constants; then your own section in §4 and §6.

## 1. The owner's three rules, 2026-10-03

1. **Story first, then show.** Before anything moves or any instrument appears, the reader is told what they are
   looking at: we built an engine that follows each visitor's interest in real time and decides the page at that
   point in time; how it differs from a recommendations engine, from rule-based personalization and from AI that
   decides, and why. Only then does the page show it.
2. **The reader is not the customer.** The reader is an Optimizely marketer, account executive or solutions
   engineer. They have no site, no recommendations engine and no rules. The brand and its people are in the third
   person: "the brand's team publishes the rules", "a pin holds the section a merchandiser sold", "the brand's
   recommendation engine". Never "what you already have", "your team", "your carousel", "everything you already
   run". The only "you" in a piece is the reader as reader: what to say, what never to say, the questions they will
   be asked. Those elements carry `data-reader`.
3. **No section is only text.** Every section of every piece pairs a visual (a figure, a flow, an instrument, a
   storyboard frame, cards, tiles, a worked example in a card, a table) with short text beside it. Words are
   headlines, captions, one-liners and short lines. No paragraph over 60 words on the marketing, sellers', tour and
   battlecard pages; none over 120 words on the engineers' page, where the arithmetic is shown as worked examples
   in cards, never as paragraphs. Correct content in the wrong form fails.

Gender neutral, always (COMMON). American English. No em-dashes. Headings are statements.

## 2. The approved mocks

| File | What it fixes |
|---|---|
| `mocks/02-page-opening-story-first.html` | The opening of every piece: the story (headline and three beats), the three contrast cards, "Now watch it", the five-frame walk-through, and the order of the sections that follow |
| `mocks/01-marketing-page-lower-half.html` | The kinds of visual for the sections after the opening: pillar cards with one picture each, the three-step strip, proof as quote cards, one step of the guided tour (a simplified storefront, one callout, "Step n of 7"), the battlecard's layout |
| `mocks/03-shared-spine-three-audiences.html` | The shared spine's four blocks and, under them, the section list for each reader, with the kind of visual per section |

The mocks are wireframes: layout, order, motion concept and the kind of visual per section. Colors, type and
chrome come from `enablement/site/site.css`. Icons in the mocks are Tabler names; on the site every icon is an inline
SVG drawn in the page (no font, no external file). The motion in the mocks (one click, two sections trade places,
the receipt card slides in; bars that fill and drain) is the motion to build.

## 3. The shared spine

Every piece (marketing, the tour, the sellers' page, the battlecard, the engineers' page) opens with the same four
blocks, from one partial that lane S1 writes. Its text of record is `docs/enablement/content/spine.md`; S1 writes it
from this section, verbatim, and every page names it as a source.

**Block 1, the story.** Heading: "What we built". Headline (large, not the h1): "We built an engine that follows
each visitor's interest in real time and decides the page at that point in time." Three beats, each with an icon:

1. "Most visitors to a brand's site arrive as strangers, and most buying happens before any profile exists. Tools
   built for known customers are blind in that window."
2. "The engine watches what a visitor does on this visit and arranges the page around it, click by click, from the
   first page on."
3. "The brand's team publishes the rules, keeps the last word, and can read the reason behind every decision."

**Block 2, the side by side.** Heading: "How it differs from recommendations and from personalization, and why".
Three contrast cards, each the other system above a rule and the engine below it, the first also drawn as two
flows (the visual brief's slides 2 and 3, redrawn: "History → Ranks products → Product row" against "Observe this
visit → Interpret interest → Act on the page"):

1. "A recommendations engine" / "Ranks the past: what people like this visitor bought before." then "The engine" /
   "Decides the page from what this visitor is doing now. The brand's carousel is one of the modules it orders."
   and the fixed sentence: "Recommendations rank the past; the engine decides the page at the point in time, and
   the two work side by side."
2. "Rule-based personalization" / "Sorts visitors into segments written in advance. The rules go stale, multiply
   and fight." then "The engine" / "Needs no segment and no expiration rule. Interest fills with each action and
   drains on its own, like a bucket."
3. "AI that decides" / "Chooses in the moment and cannot show its work." then "The engine" / "Every decision is
   arithmetic a person can recompute, on a receipt." and the fixed sentence: "The engine calls no AI model to
   decide. Opal is where people ask and generative AI creates, and that is where credits apply."

**Block 3, both engines on one page.** Heading: "Both engines on one page". Lead: "One engine keeps choosing the
products. The other decides the experience around them." Visual (the visual brief's slide 4, redrawn): a page
skeleton with "Lead image · chosen by the engine", "Story · chosen by the engine", "Recommended for you · the
brand's recommendation engine", and five marks: "same products", "same order", "different lead image", "different
story", "different module". Closing line: "Same product recommendations. A page arranged for this visitor."

**Block 4, watch it move.** Heading: "Now watch it: one visitor, one click". Lead: "A visitor lands on the brand's
page, clicks one boot banner, and the page rearranges around that interest. The card that appears is the receipt:
why this page, in words." Second line: "Same catalog, same rules. Only what the visitor did changed." The six-second
loop from mock 2 (hero skeleton; the click ring; the boots section and the hero trade places; the receipt card
slides in: "Why this page", "Clicked a boot banner, +", "Regional start, fading, −"), with a "Play again" control
(`data-chrome`) and the end state shown still under `prefers-reduced-motion: reduce`. Then the walk-through,
heading "Then go through it, one moment at a time", five frames with captions:

1. "The first page feels local, before the first click."
2. "The first click changes the page."
3. "Interest fills and drains like buckets. Nobody writes expiration rules."
4. "A pin holds the section a merchandiser sold."
5. "Every decision has a receipt a person can recompute."

## 4. Each piece after the spine

Every section below has a visual and short text. Each page lane keeps the existing piece's text as its quarry
(`content/what-it-is.md`, `content/selling-it.md`, `content/how-it-works-and-where-it-runs.md`, `content/see-it-work.md`)
and cuts it to headlines, captions and lines; the facts and the fixed sentences stay, the paragraphs do not.

### 4.1 Marketing, `/what-it-is` (lane M2)

Title "What it is", reader "For marketing". After the spine, in this order:

1. **Capabilities as pillars.** Four pillar cards, each with one drawn picture (the kinds in mock 1: buckets that
   fill and drain; a pinned section above ranked ones; a page recomposing; the visitor, the edge and the brand's
   systems) and one benefit line: "Decides from this minute, not the past"; "The brand's team keeps the wheel";
   "Recomposes the page, not a banner"; "Runs at the edge, with everything the brand already runs". Under each
   pillar, the capabilities it groups as small cards (icon, name, one-line use case), so that all thirteen
   capabilities of V2 §2.3 appear, none left out; the lane note lists which capability sits under which pillar.
   The performance sentence sits verbatim under the edge pillar.
2. **How it works in three steps.** A strip of three: watches what the visitor does; rearranges the page around
   it; writes the receipt and learns what worked. The learning sentence verbatim under the third.
3. **Why customers choose it.** The weighing sentence as the lead, then ten tiles, unranked (V2 §2.4), one line each.
4. **Proof by industry.** Quote cards from S4, each attributed by industry only, none with a gendered pronoun.
5. **What to say and never say.** Card pairs (say / never say, with the replacement), from the design's §5.3 and
   the current piece's table. `data-reader`.
6. **Questions marketing will be asked.** `<details>` items that open on click, from the current piece.
   `data-reader`.
7. **Into the tour.** A card linking `/see-it-work`, and one linking `/how-it-works-interactive` for the arithmetic.

### 4.2 The guided tour, `/see-it-work` (lane T1)

Title "See it work", reader "For marketing". The page replaces the current four-scene page. After the spine, one
simplified storefront (the current sample store Morrow & Vale, its products, tags and regional leans, all invented
and said so; the engine's arithmetic at its defaults, reused from the current `see-it-work.js`) and a stepper,
"Step n of 7" with Back and Next, one callout per step pointing at what changed, the storefront re-rendered per
step and a receipt panel updating. The steps:

1. **The first page feels local.** The visitor's region is chosen on the page, labelled as chosen ("Pick where this
   visitor is"); it is never pre-set, and the frame says the regional leans are invented. The sections that match
   come first.
2. **The first click changes the page.** The reader clicks one card; the two sections trade places; the receipt
   records the click.
3. **A second interest fills.** Another click; a second bucket fills; the page leans on both.
4. **The first drains and releases.** "A few minutes pass" advances time; the first bucket drains past the release
   line; its section drops back; the receipt shows the release.
5. **A pin holds its place.** A merchandiser's pin on a sold section; it holds while the rest reorder; the receipt
   names the pin.
6. **The receipt.** The whole receipt for this page, as a person would recompute it.
7. **The dial.** Learning records what worked from the first day and changes nothing until the brand turns the
   dial; the holdout. The learning sentence verbatim.

Without script the page shows the seven steps as a static storyboard: a still frame and its caption per step, so
the page reads in full. Every control reachable by keyboard; the callout readable by a screen reader.

### 4.3 Account executives, `/selling-it` (lane A1)

Title "Selling it", reader "For account executives". After the spine, in this order:

1. **Seven scenes.** A storyboard: the current piece's seven scenes, one drawn frame each (a still of the page at
   that moment) with a caption of one or two lines.
2. **Why customers choose it.** The weighing sentence, then ten tiles, unranked.
3. **What a customer can measure, and the questions that surface it.** A table with an icon per row.
4. **Objections.** Card pairs: the objection, the sentence to say, the sentence never to say. `data-reader`.
5. **What a customer provides and what we use it for.** A table: what we need, what we use it for (every ask says
   both).
6. **Which demo shows which story.** Cards linking the demos named in `content/demos.md`, one line each on what the
   demo shows.
7. **The battlecard.** A card linking `/battlecard`.

The four fixed sentences appear verbatim on the page (recommendations and AI in the spine; performance and learning
in the tiles or the scenes).

### 4.4 The battlecard, `/battlecard` (lane A1)

A new piece. Title "Battlecard", reader "For account executives", nav label "Battlecard". One screen that prints on
one sheet: the pitch line (the spine's headline); the four pillars with one proof point each; the ten reasons as a
compact grid; the top six objections as say / never-say pairs (`data-reader`); six discovery questions and the six
measures they lead to (`data-reader`); the demo map in one row; the four fixed sentences. It opens with a short form
of the spine: block 1's headline and the three contrast lines, not the animation (S1's partial has a `compact`
variant for this page).

### 4.5 Solutions engineers, `/how-it-works` (lane G1)

Title "How it works and where it runs", reader "For solutions engineers". After the spine, in this order, each
section a figure, an instrument card or a worked example beside short lines:

1. **One visitor walked through end to end.** The five-box signal chain (an event, dimension values, the visitor's
   vector, a score for each piece, the slot's answer; redraw `../verizon/explainer/figures/signal-chain.svg` for
   the engine's defaults as `figures/se-signal-chain.svg`) and the existing `figures/decision-path.svg`, with one
   line per box.
2. **The mechanism, then the arithmetic.** Instrument cards, one per quantity, each with a small drawing, one
   worked example with the engine's default numbers (FACTS.md), and one sentence of meaning: interest
   a = R/(R+K) with K = 1.8 (a curve); decay R·e^(−Δt/τ) (a draining bar with a number); entry 0.60 and release
   0.45 (a threshold band); a piece's score as a dot product under the slot's weights (a small grid); the regional
   prior λ = K/(K+Σa) (a fading share); the diversity cap and the pin (a page skeleton).
3. **Learning behind the dial, and the receipt.** A figure: the dial, the holdout, a sample receipt. The learning
   sentence verbatim.
4. **Where it runs, and how it is configured.** The existing `figures/architecture.svg`, then a figure of the
   published documents (registry, catalog, slots, learn) and the console, versioned. The performance sentence
   verbatim.
5. **Integration and privacy.** A figure: the site connects once; Opal, ODP and Feature Experimentation beside the
   engine; a short table for privacy as a property of every request.
6. **What a customer provides and what we use it for.** A table.
7. **The interactive page.** A card linking `/how-it-works-interactive`.

Existing figures may be reused as they are; new ones are SVG under `docs/enablement/figures/se-*.svg` with a PNG of
the same name for Word (D1's method, `lanes/D1.md`).

### 4.6 Unchanged

`/how-it-works-interactive`, `/credits`, `/glossary`, `/demos` and the 404 page keep their content; S1 re-stamps
their chrome (the navigation gains "Battlecard") and the landing page `/` lists the pieces with their readers.

## 5. The tooling contract

- **Hand-written pages.** `/what-it-is`, `/see-it-work`, `/selling-it`, `/battlecard` and `/how-it-works` are written by
  hand, as lanes M1 and H1 wrote the interactive pages: `enablement/site/<name>.html`, `enablement/site/<name>.css`
  and, where needed, `enablement/site/<name>.js`. S1 changes the builder so it no longer renders `what-it-is`,
  `selling-it` or `how-it-works` from markdown; it keeps the landing page, credits, glossary and demos. **Until S1's
  change is in, no page lane runs plain `node enablement/render-pages.mjs`** (it would overwrite a hand-written
  page). Page lanes run only `node enablement/render-pages.mjs --stamp` (below) and the checks.
- **The text of record.** Each page's visible text in order is `docs/enablement/content/<name>.md`: `#` once, `##`
  per section, every headline, caption, card line, tile, table and step in the order the page shows them. The
  article names two sources: `<article class="piece" data-source="docs/enablement/content/spine.md docs/enablement/content/<name>.md">`.
  Chrome text carries `data-chrome` with a reason, a lead above an instrument `data-lead`, and text a script
  generates (a receipt line, a step counter) `data-added` with a reason, as today.
- **Stamped blocks.** Three marker pairs, filled from `enablement/partials/` by `node enablement/render-pages.mjs --stamp`
  (S1's step, idempotent, run by any lane): `<!-- chrome:header:start -->…<!-- chrome:header:end -->` (skip link,
  masthead, navigation with the current page marked), `<!-- spine:start -->…<!-- spine:end -->` (the four blocks;
  `<!-- spine:compact:start -->…<!-- spine:compact:end -->` on the battlecard) and
  `<!-- chrome:footer:start -->…<!-- chrome:footer:end -->`. The check fails a page whose stamped block differs from
  its partial. A page lane writes the markers empty and stamps once `enablement/partials/spine.html` exists.
- **Files a page may load**, each exactly once, in this form: `<link rel="stylesheet" href="/site.css">`,
  `<link rel="stylesheet" href="/spine.css">`, `<link rel="stylesheet" href="/<name>.css">`,
  `<script src="/site.js" defer></script>`, `<script src="/spine.js" defer></script>`, `<script src="/<name>.js" defer></script>`.
  S1 widens `check-site.mjs` for the spine pair and the new pages' own files. Nothing else is loaded, inline or
  from anywhere; the Content-Security-Policy does not change.
- **Visuals.** Inline SVG, HTML with CSS, or a `<table>`. Each section's visual element carries `data-visual`; the
  check fails any `<section>` of a hand-written page without one. Icons are inline SVG with `aria-hidden="true"`.
  Motion is CSS keyframes, paused and shown at its end state under `prefers-reduced-motion: reduce`; scripts are
  progressive enhancement, and every page reads in full without them. Do not use the class names `chip`, `label`
  or `legend` or any label word (Built, Designed, Open); the check refuses them. The "what changed" marks are
  `.mark` elements.
- **Pictures for Word.** Where the Word copy shows a section as a picture, the section's visual element carries
  `data-shot="<name>"` and the markdown has `![caption](../figures/shot-<name>.png)` at that point, the caption
  being a sentence visible inside that element. Lane W2 captures the PNGs from the built pages; S1's check requires
  the matching `data-shot` for every such figure line. Every visual section of the marketing, sellers',
  battlecard and tour pages has a shot; on the engineers' page the SVG figures are embedded as PNGs of the same
  name as before, and the instrument cards have shots.
- **The reader scan.** Outside `[data-reader]` elements, `\byou\b` and `\byour\b` fail on the five hand-written
  pages. **The prose budget.** A `<p>` over 60 words fails on four of them; over 120 on the engineers' page.
- **The stamp** is "Updated October 3, 2026" on every page (S1 sets it in the builder and the check).
- **Colors and type** are site.css tokens; a new token goes in `spine.css` under `:root`, with its dark value.
- **Checks, run before handing over:** `node enablement/render-pages.mjs --stamp`, `node enablement/render-check.mjs`,
  `node enablement/check-site.mjs`, and the headless Chrome pass of the design's §9 on the built files served
  locally (1440×800, 1366×768, 390×844; light and dark; no horizontal overflow; no console error; no outside
  request; the page complete without script).

## 6. Lanes, paths and order

One writer per path. Read anything, write only yours. No git command that changes anything, no install, no delete,
no deploy, no process kill. Save files whole. Never run plain `node enablement/render-pages.mjs` unless you are S1.

| Lane | Writes only | Delivers |
|---|---|---|
| **S1** spine and tooling | `enablement/partials/**`, `enablement/site/spine.css`, `enablement/site/spine.js`, `enablement/site/index.html`, `enablement/site/404.html`, the chrome of `how-it-works-interactive.html`, `credits.html`, `glossary.html`, `demos.html` through the builder, `enablement/render-pages.mjs`, `enablement/render-check.mjs`, `enablement/check-site.mjs`, `docs/enablement/content/spine.md`, `docs/enablement/lanes/S1.md` | First, within its first minutes: the builder stops rendering the three pieces. Then the partials, the spine's styles and motion, `--stamp`, the widened checks (§5), the landing page, the chrome everywhere |
| **M2** marketing | `enablement/site/what-it-is.html`, `what-it-is.css`, `what-it-is.js`, `docs/enablement/content/what-it-is.md`, `docs/enablement/figures/mk-*.svg`, `docs/enablement/lanes/M2.md` | §4.1 |
| **T1** the tour | `enablement/site/see-it-work.html`, `see-it-work.css`, `see-it-work.js`, `docs/enablement/content/see-it-work.md`, `docs/enablement/lanes/T1.md` | §4.2 |
| **A1** sellers and battlecard | `enablement/site/selling-it.html`, `selling-it.css`, `selling-it.js`, `enablement/site/battlecard.html`, `battlecard.css`, `docs/enablement/content/selling-it.md`, `docs/enablement/content/battlecard.md`, `docs/enablement/figures/ae-*.svg`, `docs/enablement/lanes/A1.md` | §4.3, §4.4 |
| **G1** engineers | `enablement/site/how-it-works.html`, `how-it-works.css`, `how-it-works.js`, `docs/enablement/content/how-it-works-and-where-it-runs.md`, `docs/enablement/figures/se-*.svg` and `.png`, `docs/enablement/lanes/G1.md` | §4.5 |
| **W2** Word | `docs/enablement/word/**`, `docs/enablement/figures/shot-*.png`, `docs/enablement/lanes/W.md` (appended) | After the pages: `Enablement-What-It-Is-v3.0.docx`, `Enablement-Selling-It-v3.0.docx`, `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx`, `Enablement-Battlecard-v3.0.docx`, pictures with captions, the v2.0 files of those pieces moved out |
| **R** review | `docs/enablement/lanes/R.md` (round four appended) | A verdict per page, source, figure and Word copy against §7 |

**Order.** S1's builder change first. Then S1, M2, T1, A1 and G1 in parallel. The lead stamps, runs the checks,
commits by path, dispatches W2 and R, fixes through the owners, deploys from WSL with the design's §7 command and
verifies from outside.

**The lane note** (`docs/enablement/lanes/<lane>.md`): what you wrote, path by path; what you checked, with the
commands and their results; where each fact and quotation came from; anything in this brief you could not honor
and why. Report the same in your final message, in prose, no file dumps.

## 7. The gate

The design's §9 gate stands (the story in order, the fixed sentences verbatim, no build-state or stage words, no
labels, no names, quotations by industry, the pronoun scan at zero, every instrument explained before it is shown),
with these added, each checked by script where §5 says so:

1. **Story first.** The spine opens every piece, byte-identical to the partial.
2. **Third person.** No "you" or "your" outside `[data-reader]` on the five hand-written pages.
3. **A visual in every section.** Every `<section>` has a `data-visual` element; no paragraph over the budget.
4. **The mocks.** The section order and the kind of visual per section are the mocks'.
5. **Motion.** The watch-it loop runs and replays; everything is still and complete under reduced motion and
   without script.
6. **Word.** Each copy opens with the spine, then its sections as pictures with captions; built by the unchanged
   converter; a linked contents; every link resolving; named `-v3.0.docx`.
7. **The look.** On the built files in headless Chrome: no horizontal overflow at the three widths, light and dark;
   WCAG AA contrast; no console message; same-origin requests only.

## 8. Amendment, 2026-10-03: the tour as one player, and one full opening

**Status.** The owner opened the deployed version 3 and found the tour unusable: Back and Next sat under the
spine's "Now watch it" animation and looked attached to it; Next was greyed out until the reader scrolled a full
screen down and acted in the store; three paragraphs pushed the store out of view. The owner also found the
identical openings of What it is, See it work and Selling it repetitive. The owner approved the fix ("GO") as
`mocks/04-tour-player-and-openings.html`. This section overrides §3's "every piece opens with the same four blocks",
§4.2's page structure and §7.1 where they differ.

### 8.1 The openings

- **What it is** keeps the full spine, unchanged.
- **Selling it** and **How it works** open with **the band**: one strip, the headline and three contrast cells in a
  row at desktop widths (stacked on a phone), and a link to the full story. Its text of record is
  `docs/enablement/content/spine-band.md`, verbatim:

  ```
  # Behavioral Targeting and Intelligence: the spine, one band

  ![We built an engine that follows each visitor's interest in real time and decides the page at that point in time.](../figures/shot-spine-band.png)

  We built an engine that follows each visitor's interest in real time and decides the page at that point in time.

  **Beside a recommendations engine**

  Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side.

  **Instead of rules written in advance**

  Interest fills with each action and drains on its own, like a bucket, so nobody writes segments or expiration rules.

  **Unlike AI that decides**

  The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply.

  [The full story, with the pictures, is on What it is.](https://edge-platform-bti.expedge.workers.dev/what-it-is)
  ```

  Marker pair `<!-- spine:band:start -->…<!-- spine:band:end -->`, partial `enablement/partials/spine-band.html`,
  `data-shot="spine-band"`. The page's article names `spine-band.md` in place of `spine.md`.
- **The battlecard** keeps the compact spine.
- **See it work** carries no spine and no animation above the tour: its title, reader tag and one intro line, then
  the player.

### 8.2 The tour player (`/see-it-work`)

1. **Intro line**, the only text above the player: "One visitor, seven moments, on a sample store: press Show me, or
   click what is highlighted." (`data-reader`).
2. **One player frame** (`section.tour-player`, `data-visual`) holds everything for a step: the bar, one explanation
   line, the store on the left, the buckets, the lean bar and the receipt on the right. At 1366×768 and 1440×900 the
   whole frame, bar to bottom, fits inside the window (height at most the window height less 24 px) with all six of
   the store's sections visible without scrolling inside the frame (compact rows: a section title and its three
   cards on one line each). When the reader presses any control, the frame is scrolled so its top meets the
   window's top (instantly under reduced motion). The bar is `position: sticky; top: 0` while the frame is on screen,
   so the controls never leave the window.
3. **The bar**: Back (absent on step 1), "Step n of 7 · <step title>", seven dots, then the step's controls:
   - step 1: "Pick where this visitor is:" and two buttons, Washington State and Florida. Nothing is pre-set. A pick
     shows that region's first page; Next then appears beside the buttons, which stay switchable.
   - steps 2 to 5: **Show me** and **Next**. Show me performs the step's action in front of the reader and stays on
     the step; clicking the highlighted target in the store does the same. After the action, Show me disappears.
     **Next is never disabled or greyed out**: pressed before the action, it performs the action, holds 1.2 seconds so
     the result is seen (instant under reduced motion), then advances.
   - step 6: Next. Step 7: **Start again**, which returns to step 1 with no region picked.
4. **The target and its callout** are inside the store: the target card is outlined, pulses three times (none under
   reduced motion), and carries its callout attached beside it, naming the action ("Add the cardigan to the bag, or
   press Show me. Watch the top two sections."). The callout is `data-reader`.
5. **The explanation line** under the bar: at most two short sentences and 45 words, plus the step's fixed sentence
   where it has one, in smaller type. The four fixed sentences sit verbatim in the steps, since the tour no longer
   carries the spine: performance in step 2; recommendations in step 3 (the second interest's section climbs past
   the brand's recommendations carousel); AI in step 6 (the receipt); learning in step 7.
6. **What changes is marked where it changes**: moved sections say "moved up", "moved down" or "pinned"; the bucket
   fills or drains in view; the new receipt line appears at the top of the receipt and is announced (`aria-live`).
7. **Phone (390×844)**: the bar sticks to the top of the window; store above, panel below; after each action the
   changed section scrolls into view under the bar, and the callout stays with its target.
8. **Keyboard and screen reader**: every control reachable by Tab in visual order (Back, the step's controls, the
   target); after a step change focus moves to the bar's primary control; the step title and the result are
   announced.
9. **Without script**: the seven-frame storyboard, as now, each frame a still with its caption (`data-shot`
   tour-step-1 to tour-step-7).
10. **Unchanged**: the sample store, its products, tags and invented regional leans, the engine's arithmetic at its
    defaults, the five-minute memory said on the page, the honesty rules (region chosen, never pre-set; nothing called
    a demo or a customer).

### 8.3 Acceptance, by a person and by script

At 1366×768, 1440×900 and 390×844, light and dark: from the page's load, pressing only the bar's controls reaches step
7 without scrolling the page by hand, and at the moment of every action the target, the section that moves, the
bucket that changes and the new receipt line are all inside the window; the same walk clicking each target instead
of Show me; Back from step 7 to step 1 restores each step's state exactly; Start again returns to a clean step 1. The
lane records a screenshot of every step at each size and looks at every one. The lead walks it by hand before
reporting it done.
