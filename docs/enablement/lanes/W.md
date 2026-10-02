# Lane W: the Word copies of the enablement package

**Status, 2026-10-02, rebuilt at 14:17 under the coordinator's three rulings: five Word documents sit in `docs/enablement/word/` as `Enablement-…-v1.0.docx`, built in place from the five markdown sources at HEAD `4052d71`. The Word build strips each source's title line, because the converter puts the title on the cover (section 3 has the exact commands). The covers follow design section 6. The verdict words are bold. All 13 house checks pass on each document, with check 0 reworked and one check added (section 4). Nothing failed to build.** Nothing was committed, pushed, installed, deleted or deployed, and no source was edited. The credits page and the demo map follow when their markdown sources land; the coordinator will send them.

This lane's files: the five documents in `docs/enablement/word/`, and this note. The tools stay in the session scratchpad (section 7); none is in the repository.

## 1. What was built

All five carry "Prepared by Optimizely" (the converter's fixed line), version "1.0" (bare), date "October 2, 2026" (the build date) and classification "Internal: Optimizely only". The subtitle is the reader line, a middle dot, and the facts stamp "Engine facts as of commit 8b4f74c".

| Word document | Bytes | Pages | Prepared for | Subtitle on the cover |
|---|---|---|---|---|
| `Enablement-What-It-Is-v1.0.docx` | 18,971 | 6 | Marketing | For marketing · Engine facts as of commit 8b4f74c |
| `Enablement-Selling-It-v1.0.docx` | 540,368 | 11 | Account executives | For account executives · Engine facts as of commit 8b4f74c |
| `Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx` | 887,416 | 20 | Solutions engineers | For solutions engineers · Engine facts as of commit 8b4f74c |
| `Enablement-What-Is-Built-Designed-and-Open-v1.0.docx` | 23,332 | 9 | Everyone at Optimizely | For everyone at Optimizely · Engine facts as of commit 8b4f74c |
| `Enablement-Glossary-v1.0.docx` | 25,364 | 12 | Everyone at Optimizely | For everyone at Optimizely · Engine facts as of commit 8b4f74c |

The cover title is each source's first line, verbatim, and the sources are what the documents were built from:

| Source | Cover title | Last commit | sha-256 (first 16 hex) |
|---|---|---|---|
| `docs/enablement/content/what-it-is.md` | Behavioral Targeting and Intelligence: what it is | 4052d71 | `59d4b15fa47eda40` |
| `docs/enablement/content/selling-it.md` | Behavioral Targeting and Intelligence: selling it | 8f244b4 | `07b1401dbec3194a` |
| `docs/enablement/content/how-it-works-and-where-it-runs.md` | Behavioral Targeting and Intelligence: how it works and where it runs | f732eaf | `af6910544668920e` |
| `docs/enablement/content/status.md` | Behavioral Targeting and Intelligence: what is built, designed and open | f732eaf | `4f5b1b09c544acf7` |
| `docs/enablement/GLOSSARY.md` | Behavioral Targeting and Intelligence: the glossary | c158e2e | `97c88e784447b939` |

The converter is `scripts/md2docx.mjs`, sha-256 `0b2159ee…`, the version that numbers bookmarks uniquely; `docx` 9.7.2 from `~/.md2docx`; Node 22.15.0 in WSL Ubuntu-22.04. The sources and the converter were hashed before the build and again afterwards: unchanged. If a content lane edits a source after 14:17, the matching document is stale; compare the hash above.

Document hashes, to tell whether a later build replaced a file (first 16 hex digits of the sha-256): What-It-Is `b162e63c1de854b4`, Selling-It `a1929e96f6f4872d`, How-It-Works `a09c706d6526768b`, What-Is-Built `f0e29b3aa9808242`, Glossary `8de7dff2ff0ffcb2`.

**Line endings.** The sources are LF in the working copy and in the index (`git ls-files --eol`: `i/lf w/lf`; no carriage return in any). Lane C1 notes that `core.autocrlf=true` here and that the converter fails on CRLF, so the build step also removes any carriage return from the copy it feeds the converter (section 3). The converter reads that LF copy, never the working file.

**History.** The first build was at 13:58, named `BTI-…`, with the brief's first covers, the title heading repeated in the body and plain verdict words. The files were moved to the `Enablement-` names at 14:09 on the coordinator's instruction (the package name stays out of file names), bytes unchanged. This build replaced them in place at 14:17. The set of five built in scratch for the first covers is superseded and was moved, not deleted, to `scratchpad\w\superseded\alt-old-covers\`: it must not be copied over these files.

## 2. The rulings, and what each did

### 2.1 The title line is stripped from the Word build

The converter prints the title on the cover and in the running header. A `#` title line in the markdown would print it again as page 3's heading and as the first contents entry, so the Word build feeds the converter a copy of the source without that line. The step is mechanical and reproducible (section 3), not a hand edit, and check 0 proves it for each document: the cover title is the source's first line verbatim; the copy is the source less that line and the one blank line after it, and nothing else; no paragraph in the body or the contents reads the title; and the figures the copy reaches are byte-identical to `docs/enablement/figures/`.

Effects. The contents lists sections only (8, 8, 24, 7 and 22 entries, all at one level). Page 3 opens with the lead paragraph. Page counts did not change (6, 11, 20, 9, 12). The construct whose Word rendering could not be machine-verified, a page-break paragraph followed by a heading with its own page break before it, no longer occurs in these five.

### 2.2 The covers follow design section 6

| Item | As built | Design section 6 |
|---|---|---|
| File names | `Enablement-<piece>-v1.0.docx`, no package name | "no package name"; the names for pieces (d) and (h) are the coordinator's longer ones |
| Title | the source's title line, verbatim; the glossary's is "…: the glossary" | "the source's title line, verbatim" |
| Subtitle | the reader line, a middle dot, "Engine facts as of commit 8b4f74c" | "the reader and the facts stamp", its example in lower case ("engine"); the ruling's capital E is used |
| Prepared for | the reader's team: Marketing; Account executives; Solutions engineers; Everyone at Optimizely for the status piece and the glossary | "the reader's team" |
| Date | October 2, 2026 | `<Month D, YYYY>`, the build date |
| Classification | Internal: Optimizely only | "Internal: Optimizely only" |
| Version | 1.0, bare | the bare number |

The stamp is the commit the engine facts sheet (S2) is pinned to. The build step refuses to run if the first 40 lines of S2 no longer mention `8b4f74c`, so a re-pin cannot slip through under the old stamp. When S2 is re-pinned, all five documents are rebuilt with the new stamp. The date is the build date and is written in the script: set it to the day of any later rebuild.

I joined the reader line and the stamp with the middle dot of the design's example. Each cover subtitle fits on one line (264 to 333 pt of 468), and so do the running headers with "Internal: Optimizely only" (at most 329 pt) and the footers.

### 2.3 The verdict words are bold

Design §4.2 asks that in Word the label is the word, in bold, in the verdict column. The content lanes bolded the words in the markdown: `f732eaf` (the engineers' piece and the status piece) and `4052d71` (the marketing piece). I compared the new versions with the ones the first build used (`969aee9` and `c67eea6`): once the `**` markers are removed, the text is identical (8, 10 and 62 lines changed, nothing else), so the pages' text check is unaffected. "Selling it" was already bold. The documents were rebuilt after both commits. Check 14 counts the label cells in every verdict column (headed Verdict, Label or Status) and finds the first run bold in all of them: 8 of 8 in "What it is", 17 of 17 in "Selling it", 10 of 10 in "How it works" and 62 of 62 in "What is built, designed and open".

### 2.4 Still to come

The credits page and the demo map each get a Word copy when their markdown sources land (the credits source is HTML today, `content/credits-source.html`, and the converter reads markdown only). The coordinator will send them; the build step in section 3 takes one more `build` line each.

## 3. The documented build step, with the exact commands

It ran as follows, in WSL; the script changes into the repository itself:

```
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash /mnt/c/Users/LAH/AppData/Local/Temp/claude/C--Users-LAH-Documents---Development-Optimizely---cloudflare-base/6d912628-2c4c-48d2-9676-33d6a79a76ce/scratchpad/w/tools/build-word.sh"
```

`build-word.sh` is a scratchpad tool, not in the repository. Its whole text is below, so the step can be reproduced from this note alone. For each source it takes the first line as the cover title, writes a copy without that line (and the one blank line after it) into `$S/content/`, beside a fresh copy of the figures in `$S/figures/` so that `../figures/…` resolves, and feeds that copy to the converter. `$S` is `scratchpad\w\build` for the real build.

```
#!/usr/bin/env bash
# Lane W: the Word build. For each source, take its title line verbatim for the cover, write a copy of the source
# without that line (and the one blank line after it) into a scratch folder that also holds a copy of the figures,
# and feed that copy to the converter. Run in WSL.
#   build-word.sh [--out <dir>] [--scratch <dir>]
# The same commands are written out in docs/enablement/lanes/W.md section 3.
set -euo pipefail
REPO=/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
OUT=$REPO/docs/enablement/word
S=/mnt/c/Users/LAH/AppData/Local/Temp/claude/C--Users-LAH-Documents---Development-Optimizely---cloudflare-base/6d912628-2c4c-48d2-9676-33d6a79a76ce/scratchpad/w/build
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT=$2; shift 2 ;;
    --scratch) S=$2; shift 2 ;;
    *) echo "build-word: unknown argument $1" >&2; exit 2 ;;
  esac
done
cd "$REPO"
head -n 40 docs/enablement/research/S2-engine-facts.md | grep -q '8b4f74c' || { echo "build-word: S2 is no longer pinned to 8b4f74c; the stamp would be wrong" >&2; exit 1; }
mkdir -p "$S/content" "$S/figures" "$OUT"
cp docs/enablement/figures/*.png "$S/figures/"
STAMP="Engine facts as of commit 8b4f74c"
build() {   # build <source.md> <output file name> <reader line> <prepared for>
  local src=$1 out=$2 reader=$3 team=$4 name title
  name=$(basename "$src")
  title=$(head -n 1 "$src" | tr -d '\r' | sed -n 's/^# //p')
  [ -n "$title" ] || { echo "build-word: line 1 of $src is not a # title" >&2; return 1; }
  tr -d '\r' < "$src" | tail -n +2 | sed '1{/^$/d}' > "$S/content/$name"
  node scripts/md2docx.mjs "$S/content/$name" "$OUT/$out" "$title" "$reader · $STAMP" "$team" "1.0" "October 2, 2026" "Internal: Optimizely only"
}
build docs/enablement/content/what-it-is.md Enablement-What-It-Is-v1.0.docx "For marketing" "Marketing"
build docs/enablement/content/selling-it.md Enablement-Selling-It-v1.0.docx "For account executives" "Account executives"
build docs/enablement/content/how-it-works-and-where-it-runs.md Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx "For solutions engineers" "Solutions engineers"
build docs/enablement/content/status.md Enablement-What-Is-Built-Designed-and-Open-v1.0.docx "For everyone at Optimizely" "Everyone at Optimizely"
build docs/enablement/GLOSSARY.md Enablement-Glossary-v1.0.docx "For everyone at Optimizely" "Everyone at Optimizely"
```

What the three lines inside `build` do: `head -n 1 … | sed -n 's/^# //p'` is the title, verbatim, and stops the build if line 1 is not a `# ` title; `tr -d '\r' < "$src" | tail -n +2 | sed '1{/^$/d}'` is the stripped LF copy, the source less its first line and the blank line after it; the `node` line is the converter, whose input is that copy and whose output is the document in `docs/enablement/word/`.

**Run first into scratch.** `--out` and `--scratch` point the same script away from the repository. At 14:17 I ran it into `scratchpad\w\dry\` first and ran the checks on that output; the five passed. The real build then produced the same documents: compared part by part, every part is equal once the converter's random link ids and its build timestamps are set aside (the files differ in size by 2 to 9 bytes). The converter printed no warning and no problem message for either run:

```
md2docx: wrote docs/enablement/word/Enablement-What-It-Is-v1.0.docx, 19 KB, 51 blocks from 101 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Selling-It-v1.0.docx, 528 KB, 73 blocks from 152 markdown lines
md2docx: wrote docs/enablement/word/Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx, 867 KB, 156 blocks from 372 markdown lines
md2docx: wrote docs/enablement/word/Enablement-What-Is-Built-Designed-and-Open-v1.0.docx, 23 KB, 37 blocks from 145 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Glossary-v1.0.docx, 25 KB, 153 blocks from 306 markdown lines
```

The folder `docs/enablement/word/` has to exist (the script makes it), and a document open in Word locks its file (the converter's rule 6).

## 4. The checks

One script, `check-docx.mjs`, reads each document straight from its zip parts (`word/document.xml`, `numbering.xml`, `settings.xml`, the relationships, headers, footers and properties) and compares it with the copy the converter was given. It re-implements the converter's block grammar, so the expected text, lists, tables, links and figures are computed independently of the converter's output. Run as `node check-docx.mjs <docx> <build copy> "<title>" "<subtitle>" "<prepared for>" "1.0" "October 2, 2026" "Internal: Optimizely only" --source <the original source>`; the wrapper `check-all.sh` runs the five. I also unzipped each document for the page measure.

| # | Check | Result on all five |
|---|---|---|
| 0 | **Reworked.** The title is on the cover and in the running header only: no other paragraph, in the body or the contents, reads it; the cover title is the source's first line verbatim; the build copy is the source less that line and the blank line after it; the copy does not open with a `#` heading; the figures the copy reaches are byte-identical to the repository's | Pass |
| 1 | The cover reads "Prepared for: <the reader's team>" and "Version: 1.0", with Prepared by Optimizely, the date and the classification; the subtitle is exactly the reader line, the dot and the stamp; the running header is the title and "Internal: Optimizely only"; the footer starts "<team> · 1.0"; the document properties carry the title, subtitle and creator | Pass |
| 2 | A real contents field, `TOC \h \o "1-2"`, marked dirty, with `updateFields` in the settings and one field end; one entry per `#` and `##` heading, in order, at the right level, each linked to a bookmark that sits on the paragraph of its own heading | Pass |
| 3 | Bookmark ids unique and paired: each start has exactly one end, the ends follow in order, none overlap, none left open, ids run 1 to n, names unique; the count equals every `##` heading plus each deeper heading a link names | Pass |
| 4 | Every numbered list restarts at 1: its own numbering instance, each with a start override of 1; the number of lists and items equals the markdown's | Pass |
| 5 | Every table, grid and row is 9,360 twips wide, all in dxa; each data table matches its markdown table (rows, cells, header text, header row repeating); one-cell boxes match the callouts and code blocks | Pass |
| 6 | Nothing lost, nothing added, order kept: every markdown block against the document's text, in order, and the same non-ASCII characters in the same counts | Pass |
| 7 | Headings: level, text and order against the markdown outline | Pass |
| 8 | No leaked markdown markers in any run outside code (`**`, `*`, backtick, `](`, `![`, `[text](`, `<br>`, a table pipe, `~~`, `__`, an escaped entity, a heading or quote marker at a paragraph start) | Pass, no hits |
| 9 | Every in-document link: the count equals the markdown's, each anchor is a bookmark, and each lands on the bookmark of the heading its anchor names | Pass |
| 10 | The external links: text, target and an External relationship, all https, the same list as the markdown | Pass |
| 11 | Every figure: the same count as the markdown, exactly the text width (5,943,600 EMU, 6.50 in), height from the source's aspect ratio, bytes identical to the PNG in `docs/enablement/figures/`, alt text equal to the caption, the caption beneath and centred, picture ids unique | Pass |
| 12 | Whole-word scan of the body, contents, headers, footers and properties for she, her, hers, he, him, his (and herself, himself); for the customer names in the common brief; for the lead's other vendor and customer names from the C3 checks; for em-dashes and en-dashes | Zero hits in every scan |
| 13 | Package integrity: every internal relationship target is in the package, every part is well-formed XML, the PNG content type is declared, compatibility mode 15 | Pass |
| 14 | **Added.** Every verdict word in a verdict column (header Verdict, Label or Status) is bold in the document | Pass |

That is 15 of 15 on each document. In addition: `unzip -t` reports no errors on all five; the whole-word scan found no customer name; the three figures' SVG text holds no pronoun and no name, and each caption is its SVG's title (checked at the first build; the figures have not changed).

What each document contains, as the checks counted it:

| | What it is | Selling it | How it works | What is built | Glossary |
|---|---|---|---|---|---|
| Contents entries (all one level) | 8 | 8 | 24 | 7 | 22 |
| Headings | 8 | 9 (one H3) | 24 | 7 | 22 |
| Bookmarks | 8 | 9 | 24 | 7 | 22 |
| Numbered lists (items) | 0 | 1 (5) | 3 (10, 11, 10) | 0 | 0 |
| Bulleted lists | 2 | 4 | 0 | 1 | 0 |
| Tables, with the cover and the one-cell boxes | 4 | 9 | 17 | 9 | 1 |
| Data tables | 3 | 6 | 13 | 6 | 0 |
| Table rows, all tables | 21 | 57 | 132 | 102 | 5 |
| In-document links in the body | 1 | 3 | 30 | 0 | 0 |
| External links (distinct targets) | 2 (2) | 7 (7) | 5 (5) | 3 (3) | 0 |
| Figures | 0 | 1 | 2 | 0 | 0 |
| Bold verdict cells | 8 of 8 | 17 of 17 | 10 of 10 | 62 of 62 | none |
| Words in the build copy (W1's rule) | 1,807 | 2,836 | 5,860 | 2,431 | 4,696 |

The figures: "Where the engine runs on Cloudflare" (`architecture.png`) prints 6.50 × 7.80 in, in "Selling it" and "How it works"; "From an event to a decision" (`decision-path.png`) prints 6.50 × 5.39 in, in "How it works". "Selling it" has one numbered list, the five sentences under "Where it runs, in one picture"; "How it works" has three, A.2's ten steps, B.1's eleven and B.7's ten findings, on numbering instances 2, 3 and 4. The one H3 in "Selling it", "The one exception to keep straight: recording", has a bookmark because two table cells link to it.

**The checks can fail.** Controls, each run against a real or deliberately flawed document:

- A small document with deliberate faults (a stray asterisk, three pronouns, a customer name) failed checks 8 and 12 on exactly those, and the same document against a different markdown failed 11 of 14 (run on the first version of the script, before the build).
- Check 0: given the unstripped source in place of the build copy, "What it is" fails checks 0, 2, 3, 6 and 7; given a title argument that is not the source's first line, the glossary fails checks 0 and 1.
- Check 14: the superseded set, built before the bold change, fails it with 62 label cells and none bold.
- A dead link is stopped by the converter itself, which writes nothing: "md2docx: … NOT written; … has 1 problem(s): line 3: link "dead" points to #nowhere, but no heading has that anchor". None of the five hit it.

## 5. Page counts

**Method.** W1's `pages.mjs`: greedy line breaking on the real Calibri and Consolas advance widths from `C:\Windows\Fonts`, Word's line height, paragraph spacing, page breaks, keep-with-next, table rows that split at line boundaries and repeating header rows. The tool was in lane W1's session scratchpad and is copied here unchanged; `pages-fill.mjs` is the same model with two more lines of output, each page's fill and the page a heading lands on.

**Calibration.**

- The Word-saved Scope of Services v7, the document W1 used: Word records 7 pages, the model gives 7 (last page 43 %).
- W1's technical note v1.1, built by this converter: 21 pages, the last 98 % full, exactly W1's recorded measure.
- W2's one-pager v1.3: 3 pages, the body page 95 % full, exactly W2's recorded measure.
- The lead's rougher estimator (`pages-c3.mjs`, about ±15 %), run on the build copies, gives 6, 11, 19, 10 and 13, within a page of the model on every document.

It is a layout measurement, not Word's own count: expect Word to differ by about a page. It models the contents as the cached entries without page numbers; Word adds the numbers and no lines.

| Document | Pages | Cover | Contents | Body | Last page filled |
|---|---|---|---|---|---|
| What it is | 6 | 1 | 1 | pp. 3 to 6 | 82 % |
| Selling it | 11 | 1 | 1 | pp. 3 to 11 | 49 % |
| How it works and where it runs | 20 | 1 | 1 | pp. 3 to 20: Part A pp. 3 to 9, Part B pp. 9 to 20 | 40 % |
| What is built, designed and open | 9 | 1 | 1 | pp. 3 to 9 | 68 % |
| Glossary | 12 | 1 | 1 | pp. 3 to 12 | 70 % |

W1's rule of thumb, about 270 words a page, would overstate these pieces (about 9, 13, 24, 12 and 20 pages in all). They hold 315 to 470 words a body page, because most of the text is in tables set at 9.5 pt and in short entries. Use the measure, not the rule of thumb.

**Gaps the tall figures leave.** The architecture figure is 7.80 in tall and never fits under a paragraph, so Word moves it, with its caption, to the top of the next page: "Selling it" page 5 is 64 % full, and "How it works" page 5 is 50 % full. The 5.39 in decision-path figure leaves "How it works" page 3 at 55 %. A wider, shorter version of the architecture figure would close the gaps; the converter's cap is 8 in.

## 6. Not verified, and things to know

- **Not machine-verified:** Word's own pagination, following a link with Ctrl+Click, and Save as PDF. Word may not be automated on this machine and there is no LibreOffice. The owner is asked to open "How it works" (30 in-document links, two figures), accept the offer to update fields, Ctrl+Click one contents entry and one link, and try Save as PDF.
- **External link targets** were checked as present and https, not requested over the network (the site sits behind its gate, and the brief is "present").
- **Style.** The documents carry the converter's house look (Calibri; navy `11142A` and blue `0B5CAD`), as every earlier Word deliverable does. That is not the current Optimizely brand set out in the `optimizely-brand` skill (green-led palette; VC Nudge and Die Grotesk, or Roboto as the sanctioned alternative). The fonts and colors are constants in `scripts/md2docx.mjs`, so applying the brand is a converter change for the coordinator to order; I did not change it.
- **Informational scan hits, not failures.** "Selling it" names three fictional demo screens in its demo table, "The Bright Hour", "Calder" and "Lantern & Lane" (four hits), which the common brief allows (demos are named by fictional brand and shown by URL) and which the lead's C3 name list would flag. The glossary's own deprecated entry for "BTIE" is one hit. No customer name appears anywhere.
- **Long addresses wrap.** The demo table in "Selling it" prints each address as its link text in a 2.0 in column, so each wraps over several lines, breaking at an arbitrary character. The links work.
- **Cross-document references are plain text.** "See also" names the other pieces in italics, as the markdown does, so in Word they carry no link. Only the links the markdown writes out are live: the glossary, credits, status and how-it-works pages are external links to `edge-platform-bti.expedge.workers.dev`, and the demos are linked by address.
- **Nothing was dropped silently.** The converter ignores any cell beyond a table's header width and drops a lone `|` line. The checks compared every markdown table row with its header's cell count and looked for lone pipe lines: none.

## 7. Process notes

- **Scratch, all in the session scratchpad** (`C:\Users\LAH\AppData\Local\Temp\claude\C--Users-LAH-Documents---Development-Optimizely---cloudflare-base\6d912628-2c4c-48d2-9676-33d6a79a76ce\scratchpad\w\`): `tools\build-word.sh` (the build step, text in section 3), `tools\check-docx.mjs` and `tools\check-all.sh` (the checks), `tools\pages.mjs` (W1's, unchanged) and `tools\pages-fill.mjs`; `build\` (the stripped copies the converter read, and the figure copies); `dry\` (the run into scratch); `unz\` (each document unzipped, for the page measure); `superseded\alt-old-covers\` (the set built for the first covers); `neg\` and `trial\` (the controls and a trial build). Nothing there is needed by the repository, and nothing was added to it. If the coordinator wants the build step or the checker kept in the repo, it belongs beside the converter; say so and I will propose a path.
- **Rebuilding.** Run `build-word.sh`, then `check-all.sh docs/enablement/word <scratchpad>\w\build` (add `--brief` for result lines only), then unzip each document and run `node pages-fill.mjs <dir> --trace`. After any change to a source, to the figures, to S2's pin, or to the converter, run all three again.
- **The rename, 14:09, and the rebuild, 14:17.** The files were moved with `mv -n` (no overwrite) to the `Enablement-` names, then replaced in place by the converter at 14:17 on the coordinator's go. Nothing was deleted by hand; the old set of 13:58 survives only in this note's history.
- **A false alarm, resolved.** My first line-ending count of the sources came back as CRLF on every line. That was a shell quoting slip in the count, not the files: `od`, `tr -cd '\r'` (zero) and `git ls-files --eol` all show LF. The build step strips any carriage return anyway.
- Git was used read-only (`status`, `log`, `diff`, `show`, `ls-files --eol`, `config --get`). Nothing was installed or killed, and nothing was deployed. The folder `docs/enablement/word/` and this note are the only repository paths written.
