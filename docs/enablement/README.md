# The enablement package: what is in this folder

A reader starts at https://edge-platform-enablement.expedge.workers.dev, signs in with an Optimizely email and the one-time code it is sent, and picks the page written for them.

A lane starts with `LANE-BRIEF-COMMON.md`, then `BTI-Enablement-Design.md`, and writes only the paths the design gives it.

| Path | What it holds | Written by |
|---|---|---|
| `LANE-BRIEF-COMMON.md` | The law every lane follows: the name, the only source of facts, the design rules, the voice, the formats, ownership | The lead |
| `BTI-Enablement-Design.md` | The governing design: the pieces and their readers, the rows of what is built, designed and open, the facts discipline, formats, the site, what is superseded, lanes and gates, and the decisions log | E1, then the lead |
| `GLOSSARY.md` | The package's one glossary, and the source of the glossary page | E1 |
| `research/` | S1, the inventory of what exists; S2, the engine facts sheet and the only source of engine facts; S3, the name and what has worked | S1, S2, S3 |
| `content/` | One markdown source per piece; each page and each Word copy is rendered from it | C1, C2, C3; P1 for the landing page |
| `figures/` | Each figure drawn once as SVG, with a PNG beside it for Word | D1 |
| `word/` | The Word copies, built from the sources by `scripts/md2docx.mjs` and named with their version | W |
| `lanes/` | One note per lane: what it did, why, and what it checked | Each lane |

Outside this folder: the pages in `enablement/site/`, the checks `enablement/check-site.mjs` and `enablement/check-text.mjs`, and the worker's configuration `wrangler.enablement.toml`.

Three rules hold everything together. S2 is the only source of engine facts. Each path has one writer. A change is made in the markdown source first, and the page and the Word copy follow it.
