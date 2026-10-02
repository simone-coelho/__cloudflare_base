# The enablement package: what is in this folder

A reader starts at https://edge-platform-bti.expedge.workers.dev, enters the passphrase they were given, and picks the page written for them.

A lane starts with `LANE-BRIEF-COMMON.md`, then `BTI-Enablement-Design.md`, and writes only the paths the design gives it.

| Path | What it holds | Written by |
|---|---|---|
| `LANE-BRIEF-COMMON.md` | The law every lane follows: the name, the only source of facts, the design rules, the voice, the formats, ownership | The lead |
| `BTI-Enablement-Design.md` | The governing design: the pieces and their readers, the rows of what is built, designed and open, the facts discipline, formats, the site, what is superseded, lanes and gates, and the decisions log | E1, then the lead |
| `GLOSSARY.md` | The package's one glossary, and the source of the glossary page | E1 |
| `research/` | S1, the inventory of what exists; S2, the engine facts sheet and the only source of engine facts; S3, the name and what has worked; the shared credits page, filed as a source | S1, S2, S3; the lead |
| `content/` | One markdown source per piece, the status page and the demo map included, plus the credits page's corrected HTML; each page and each Word copy is rendered from them (the landing page renders the design's §3.2) | C1, C2, C3; P1 for the credits page and the demo map |
| `figures/` | Each figure drawn once as SVG, with a PNG beside it for Word | D1 |
| `word/` | The Word copies, built from the sources by `scripts/md2docx.mjs` and named with their version | W |
| `lanes/` | One note per lane: what it did, why, and what it checked | Each lane |

Outside this folder: the pages in `enablement/site/`, the checks `enablement/check-site.mjs` and `enablement/check-text.mjs`, and the site's worker, `edge-platform-bti`, which serves the pages behind the passphrase gate and is recorded by lane E2 in `lanes/E2.md`.

Three rules hold everything together. S2 is the only source of engine facts. Each path has one writer. A change is made in the markdown source first, and the page and the Word copy follow it.
