# Common brief for every enablement lane

Read this before your own brief. It is the law for the package; your lane brief adds only what is yours.

## What we are making

An internal enablement package about the engine for three Optimizely audiences who are not engineers:
marketing, account executives (AEs) and pre-sales solutions engineers (SEs, semi-technical: they explain
concepts and bring an engineer when it gets deep). The package is hosted on the internal site
`https://edge-platform-enablement.expedge.workers.dev` (sign-in for @optimizely.com emails) and each piece
also exists as a Word document for sharing in Teams. We provide the content; the receiving teams decide how
they present it. No slide decks.

## The name

**Behavioral Targeting and Intelligence**, always the full four words on first use in a piece, then "the
engine". Never "BTIE" (that is the title of a customer's own paper). "Intelligence" means counted learning
behind a dial, never AI. The name is written once per page in a single element with the id `package-name`
(and once in each markdown source's title), because marketing may rename it. Lane S3's reasoning is in
`research/S3-naming-and-narrative.md` Part 1.

## The only source of facts

`research/S2-engine-facts.md`, pinned to commit `8b4f74c`. Every statement about what the engine does, where
it runs, what it stores, what is configured and how, and what is built, designed or open, must be traceable
to a section of that sheet; if you need a fact that is not there, stop and ask the lead rather than inventing
it or reading the code yourself. Labels, used consistently in every piece and in one colour legend on every
page: **Built** (in the code and exercised), **Designed** (in an architecture document, not in the code),
**Open** (no decision yet). Never a latency or throughput figure, anywhere, for any reason: the sheet explains
why none may be quoted. Say "calls no AI model to decide"; never "we don't use a model".

Facts the sheet establishes that every piece must respect:

- Nothing is personalised or recorded until the site passes an explicit consent choice.
- A customer tenant holds no product catalog unless its registry reads attributes from events and the
  events carry them.
- Learning counts outcomes and moves nothing until the trust dial (γ) is raised; with the shipped SDK nothing
  is recorded yet, because recording needs the slot set to count rendered pieces plus durable recovery, which
  is off in every configuration in the repository.
- ODP, Feature Experimentation and Opal are not in the decision path and are not wired to it today.
- The customer deployment workflow stops before any tenant has documents; provisioning, connectors,
  measurement, retention and the commercial meter are open decisions, named in the sheet's §10.

## The design rules (lane S3, Part 2, proven by the credits page)

1. **One reader per piece, named at the top.** Never write for two readers at once.
2. **One rule first, and the same rule last.** The piece opens with its one sentence and closes by repeating it.
3. **Organise by the shopper's session: before, during, after.** Give every row a verdict in one colour
   legend, and flag the one exception once.
4. **Give the sentences to say, and the sentences never to say with their replacements.**
5. **Examples before mechanism, and every instrument explained before it is shown.** A reader sees what a
   thing is for before how it works; on a page, a plain lead paragraph sits above every interactive element.

## The voice

- Plain words. Define every term the first time; use the package glossary (`GLOSSARY.md`, written by the
  design lane; until it exists, use these: *interest* not affinity; *dimension value* for brand = samsung;
  *the engine*; *published documents* for the registry, catalog, slots and learn document; *receipt* not
  explain record; *regional prior*; *learning dial* for γ; *consent*; *piece* for a unit of content; *slot* for
  a place on a page that is decided).
- No customer or prospect names anywhere, including Tapestry, Verizon, Coach, QVC. Demos are named by their
  fictional brands (Vantage, Top Offers, Meridian) and shown by URL.
- No competitor names. We explain our own reasoning; we never describe or judge another system.
- Honesty inline, not in a footnote: built, designed, open; "synthetic" where data is synthetic; "designed,
  not built" where so.
- American English (the brand guideline for global material).
- Sentences short, one idea each. No em-dashes. Headings are statements.

## Formats

- Each piece's source is one markdown file under `docs/enablement/content/`, written for both renderings:
  headings `#` and `##`, tables, figures as `![caption](../figures/<name>.png)` alone on a line, in-document
  links as `[text](#heading-anchor)` with GitHub's anchor rule (lower-case, punctuation removed, spaces to
  hyphens). The Word copy is built from it with `scripts/md2docx.mjs` (lane W4's conventions in
  `../verizon/lanes/W4.md`); the page is a designed rendering of the same text, checked by a script that
  compares the visible text of the page with the markdown.
- Figures are drawn once as SVG under `docs/enablement/figures/` by the diagram lane, with a PNG capture for
  Word; pages embed the SVG.
- Pages live under `enablement/site/`, static, no external scripts or fonts, inline CSS allowed only through
  the hash preflight (`node enablement/check-site.mjs --hashes` after any style change), no storage, no
  cookies, no forms, no API call. The landing page is the reader's choice of audience.

## Ownership and conduct

One writer per path; your brief names your paths. Read anything; write only yours. No git commands that
change anything (the lead commits), no installs, no deletes, no `rm -rf`, no process kills, no deploys (the
lead deploys). Save files whole. Record what you did and why in `docs/enablement/lanes/<lane>.md`. Report with
what you built, what you checked, and anything in this brief you could not honour and why.
