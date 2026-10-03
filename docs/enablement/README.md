# The enablement package: what is in this folder

A reader starts at https://edge-platform-bti.expedge.workers.dev, enters the passphrase they were given, and picks the page written for them.

A lane starts with `LANE-BRIEF-V2.md`, then `BTI-Enablement-Design.md`, and writes only the paths the design gives it.

| Path | What it holds | Written by |
|---|---|---|
| `LANE-BRIEF-V2.md` | The law: the finished product told as one story, in one order, with four fixed sentences, the rules on quotations and names, the readers and pieces, and the devices | The lead |
| `LANE-BRIEF-COMMON.md` | Conduct and format rules, where they agree with version 2: the voice, one writer per path, and no git change, install, delete or deploy by a lane | The lead |
| `BTI-Enablement-Design.md` | The governing design: the readers and pieces, the name, each piece's reader, rule, sections and devices, the story and the fixed sentences as law, quotations, names and the voice, formats, the site, what is retired, lanes and gates, and the decisions log | E1, then the lead |
| `GLOSSARY.md` | The package's one glossary, and the source of the glossary page | E1 |
| `research/` | S5, the product as designed and the source of truth for every capability; S4, the story's sources and quotations; S2, the engineering view; S1 and S3, the inventory and the naming history; the shared credits page, filed as a source; and the engineering records that version 2 retires from the material (design §8), among them the status piece, `status-engineering-record.md` | The research lanes; the lead |
| `content/` | The sources each page and Word copy is rendered from: the three narratives (`what-it-is.md`, `selling-it.md`, `how-it-works-and-where-it-runs.md`); the visible text of the two interactive pages (`see-it-work.md`, `how-it-works-interactive.md`), for the text check only, since those pages have no Word copy; the credits page's corrected HTML and its markdown twin; and the demo map (`demos.md`) | C1, C2, C3; M1 and H1 for the interactive pages' text; P1 for the credits page and the demo map |
| `figures/` | Each figure drawn once as SVG, with a PNG beside it for Word | D1 |
| `word/` | The six Word copies, built from the sources by `scripts/md2docx.mjs` and named with their version, `-v2.0.docx` | W |
| `lanes/` | One note per lane: what it did, why, and what it checked | Each lane |

Outside this folder: the pages in `enablement/site/`, where M1 and H1 build the two interactive pages with their own scripts and stylesheets and `enablement/render-pages.mjs` renders the rest; the checks `enablement/check-site.mjs` and `enablement/render-check.mjs`; and the site's worker, `edge-platform-bti`, which serves the pages behind the passphrase gate and is recorded by lane E2 in `lanes/E2.md`.

Three rules hold everything together. Every piece tells the finished product as one story, in one order. Each path has one writer. A change is made in the source first, and the page and the Word copy follow it.
