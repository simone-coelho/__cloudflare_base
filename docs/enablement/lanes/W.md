# Lane W: the Word copies of the enablement package

**Status, 2026-10-02, rebuilt at 14:56: seven Word documents sit in `docs/enablement/word/` as `Enablement-…-v1.0.docx`, the five rebuilt in place and two new, all from the blobs at HEAD `8a4252c`. The documented steps ran: sources snapshotted from HEAD, each source's title line stripped for the build, covers per design section 6. All 15 checks pass on each of the seven (105 of 105). Every embedded image is byte-identical to the repository's figure, which equals HEAD; two of the three figures changed since the last build. Both P5 commits (`d694b91`, `39e7ec9`) were in before the snapshot, so this one build carries the refined sentence and no second pass was needed. Nothing failed to build.** Nothing was committed, pushed, installed or deployed, and no source was edited. One slip is recorded in section 7.

This lane's files: the seven documents in `docs/enablement/word/`, and this note. The tools stay in the session scratchpad (section 7); none is in the repository.

## 1. What was built

All seven carry "Prepared by Optimizely" (the converter's fixed line), version "1.0" (bare), the build date "October 2, 2026" and classification "Internal: Optimizely only". The subtitle is the reader line, a middle dot, and the facts stamp "Engine facts as of commit 8b4f74c".

| Word document | Bytes | Pages | Prepared for | Subtitle on the cover |
|---|---|---|---|---|
| `Enablement-What-It-Is-v1.0.docx` | 19,638 | 7 | Marketing | For marketing · Engine facts as of commit 8b4f74c |
| `Enablement-Selling-It-v1.0.docx` | 539,913 | 11 | Account executives | For account executives · Engine facts as of commit 8b4f74c |
| `Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx` | 887,824 | 20 | Solutions engineers | For solutions engineers · Engine facts as of commit 8b4f74c |
| `Enablement-What-Is-Built-Designed-and-Open-v1.0.docx` | 23,411 | 9 | Everyone at Optimizely | For everyone at Optimizely · Engine facts as of commit 8b4f74c |
| `Enablement-Where-Opal-and-AI-Credits-Fit-v1.0.docx` | 424,440 | 9 | Account executives | For account executives · Engine facts as of commit 8b4f74c |
| `Enablement-Which-Demo-to-Show-to-Whom-v1.0.docx` | 17,263 | 5 | Account executives and solutions engineers | For account executives and solutions engineers · Engine facts as of commit 8b4f74c |
| `Enablement-Glossary-v1.0.docx` | 25,389 | 12 | Everyone at Optimizely | For everyone at Optimizely · Engine facts as of commit 8b4f74c |

The cover title is each source's first line, verbatim. The sources are what the documents were built from; all seven were committed at the snapshot, `credits.md` and `demos.md` by `8a4252c`:

| Source | Cover title | Last commit | sha-256 (first 16 hex) |
|---|---|---|---|
| `docs/enablement/content/what-it-is.md` | Behavioral Targeting and Intelligence: what it is | 631027a | `47a39588bf66c262` |
| `docs/enablement/content/selling-it.md` | Behavioral Targeting and Intelligence: selling it | 39e7ec9 | `fb012e0b4999b092` |
| `docs/enablement/content/how-it-works-and-where-it-runs.md` | Behavioral Targeting and Intelligence: how it works and where it runs | 80abe23 | `13a84b0041c8702f` |
| `docs/enablement/content/status.md` | Behavioral Targeting and Intelligence: what is built, designed and open | d694b91 | `44cc590b3017490f` |
| `docs/enablement/content/credits.md` | Behavioral Targeting and Intelligence: Where Opal and AI Credits Fit, and Where They Never Do | 8a4252c | `5261dc1de2c59da5` |
| `docs/enablement/content/demos.md` | Behavioral Targeting and Intelligence: which demo to show to whom | 8a4252c | `2296125b2a09c21e` |
| `docs/enablement/GLOSSARY.md` | Behavioral Targeting and Intelligence: the glossary | 36b271e | `83a46642eb7cb339` |

The converter is `scripts/md2docx.mjs`, sha-256 `0b2159ee…`, the version that numbers bookmarks uniquely; `docx` 9.7.2 from `~/.md2docx`; Node 22.15.0 in WSL Ubuntu-22.04. The engine facts sheet (S2) is pinned to `8b4f74c` at HEAD and in the working tree; the snapshot step stops if it is not. Document hashes, to tell whether a later build replaced a file (first 16 hex digits of the sha-256): What-It-Is `da7db4114fa58cdf`, Selling-It `3c4c039562671df9`, How-It-Works `ef77cd66fca1c246`, What-Is-Built `f9a4684e70453422`, Credits `4d477557e99bb2db`, Demos `90065026e0b5e658`, Glossary `b686dc17f59ef438`. If a content lane commits a change to a source after 14:56, the matching document is stale: compare the hash above.

**Line endings.** The sources are LF in the index and in the working copy (`git ls-files --eol`: `i/lf w/lf`; no carriage return in any). Lane C1 notes that `core.autocrlf=true` here and that the converter fails on CRLF, so the snapshot step removes any carriage return, and the converter reads that LF copy, never the working file.

**History.** First build 13:58, named `BTI-…`, title repeated in the body, plain verdict words. Moved to the `Enablement-` names at 14:09 (the package name stays out of file names), bytes unchanged. Rebuilt in place at 14:17 with the title line stripped, the design's covers and bold verdict words. Rebuilt in place at 14:56, with the post-review sources, the two corrected figures and two new pieces. The set built in scratch for the first covers is superseded and was moved, not deleted, to `scratchpad\w\superseded\alt-old-covers\`: it must not be copied over these files.

## 2. The rulings, and what each did

### 2.1 The title line is stripped from the Word build

The converter prints the title on the cover and in the running header. A `#` title line in the markdown would print it again as page 3's heading and as the first contents entry, so the build feeds the converter a copy of the source without that line. The step is mechanical and reproducible (section 3), not a hand edit, and check 0 proves it for each document: the cover title is the source's first line verbatim; the copy is the source less that line and the one blank line after it, and nothing else; no paragraph in the body or the contents reads the title; and the figures the copy reaches are byte-identical to the repository's. The contents lists sections only, all at one level.

### 2.2 The covers follow design section 6

| Item | As built | Design section 6 |
|---|---|---|
| File names | `Enablement-<piece>-v1.0.docx`, no package name | "no package name" |
| Title | the source's title line, verbatim; the glossary's is "…: the glossary", the credits page's is in title case as its first line is | "the source's title line, verbatim" |
| Subtitle | the reader line, a middle dot, "Engine facts as of commit 8b4f74c" | "the reader and the facts stamp"; the ruling's capital E is used |
| Prepared for | the reader's team, as ruled: Marketing; Account executives; Solutions engineers; Everyone at Optimizely (status and glossary); Account executives (credits); Account executives and solutions engineers (demos) | "the reader's team" |
| Date | the build date, October 2, 2026 | `<Month D, YYYY>` |
| Classification | Internal: Optimizely only | "Internal: Optimizely only" |
| Version | 1.0, bare | the bare number |

The stamp is the commit S2 is pinned to. Both the snapshot step and the build step refuse to run if S2 no longer says `Code is cited at commit 8b4f74c`, so a re-pin cannot slip through under the old stamp; after a re-pin all seven are rebuilt with the new one. The build date is computed from the clock, so a rebuild on another day carries that day.

Two choices of mine, each a one-line change in the piece table (section 3). The reader line on the demos cover is "For account executives and solutions engineers", to agree with its "Prepared for"; the source's own reader line reads "For account executives." The subtitle joins the reader line and the stamp with the middle dot of the design's example.

Every cover subtitle fits on one line (264 to 439 pt of 468; the longest is the demos'), and so do the running headers with "Internal: Optimizely only" (at most 415 pt, the credits page's) and the footers. The credits cover title wraps to three lines; the others take two.

### 2.3 The verdict words are bold

Design section 4.2 asks that in Word the label is the word, in bold, in the verdict column. The markdown has them bold now. Check 14 counts the label cells in every verdict column (headed Verdict, Label or Status) and finds the first run bold in all of them: 8 of 8 in "What it is", 35 of 35 in "Selling it", 10 of 10 in "How it works" and 62 of 62 in "What is built, designed and open". It also checks every label the markdown writes in bold on its own (`**Built**`, `**Designed**`, `**Open**`) against the document's bold runs of exactly that word: the counts are equal in all seven (11, 35, 13, 62, 22, 0 and 0), which covers the credits page, whose labels sit inside its table cells.

### 2.4 Two new Word copies

- **`Enablement-Where-Opal-and-AI-Credits-Fit-v1.0.docx`**, from `credits.md`. It carries the page's own eyebrow lines ("01 · THE TOUCHPOINT MAP") as plain paragraphs and the interactive wording "Tap through them", as the markdown does. One table header ends in a footnote asterisk ("No credits*"), which is written text: check 8 compares the asterisks outside code, 1 in the document and 1 in the markdown, so it is not flagged as a leak. Its one figure, "One visitor's session: what happens before, during and after", prints 6.50 × 5.72 in, lands at the top of page 6 and leaves page 5 at 48 % full.
- **`Enablement-Which-Demo-to-Show-to-Whom-v1.0.docx`**, from `demos.md`. It has two five-column tables, set in portrait at 0.66 / 1.73 / 1.08 / 1.62 / 1.41 in and 0.78 / 1.87 / 1.09 / 1.51 / 1.25 in, so each demo's address wraps over four or five lines and its long columns run to tall rows. The converter's landscape option, tried in scratch, also gives five pages, so I did not use it. It names a person once, the demos' owner, in "Before you show a demo": the only personal name in any of the seven, found by the raw scan below.

### 2.5 The figures changed; the embedded images were re-verified

Two figures changed since the 14:17 build: `decision-path.png` (`67bf30b8…` before, `519c0882163d` now) and `before-during-after.png` (`bef1b101…` before, `3d47aeafb27b` now). `architecture.png` is unchanged (`c61a7788db9d`). Verified three ways:

- check 11 compares each embedded image with the PNG of the same name in `docs/enablement/figures/`, byte for byte, and check 0 does the same for the build folder's copies;
- independent of the checks, I unzipped every media part of every document, took its sha-256 and matched it against the repository's three PNGs: all four embedded images match;
- the snapshot step stops unless the figures equal HEAD (`git diff --quiet HEAD -- docs/enablement/figures`), and it did not stop.

| Document | Embedded image | sha-256 (12) | Bytes |
|---|---|---|---|
| How it works | `decision-path.png` | `519c0882163d` | 349,905 |
| How it works | `architecture.png` | `c61a7788db9d` | 533,355 |
| Selling it | `architecture.png` | `c61a7788db9d` | 533,355 |
| Credits | `before-during-after.png` | `3d47aeafb27b` | 417,472 |

The SVG text of all three figures holds no pronoun and no name, and the two captions in the documents are their SVGs' titles ("From an event to a decision"; "One visitor's session: what happens before, during and after"). Sizes in print: `architecture.png` 6.50 × 7.80 in, `decision-path.png` 6.50 × 5.39 in, `before-during-after.png` 6.50 × 5.72 in.

### 2.6 The P5 sentence

"A page that asks the engine directly is recorded when its slots use the default served basis; with the SDK as shipped, …" was committed to `status.md` in `d694b91` and to `selling-it.md` in `39e7ec9`, both before the 14:56 snapshot (HEAD `8a4252c`). The documents carry it, in the same number as their sources: "Selling it" once, "What is built, designed and open" twice, the glossary's own version once; the earlier wording is in none. The coordinator's plan of seven documents and then a rebuild of two collapsed into the one build.

## 3. The documented build step, with the exact commands

Three scratchpad tools, none in the repository. `pieces.txt` is the table of pieces: the key, the source, the output name, the reader line and the team for "Prepared for". The key is what `--only` takes.

```
what-it-is|docs/enablement/content/what-it-is.md|Enablement-What-It-Is-v1.0.docx|For marketing|Marketing
selling-it|docs/enablement/content/selling-it.md|Enablement-Selling-It-v1.0.docx|For account executives|Account executives
how-it-works|docs/enablement/content/how-it-works-and-where-it-runs.md|Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx|For solutions engineers|Solutions engineers
status|docs/enablement/content/status.md|Enablement-What-Is-Built-Designed-and-Open-v1.0.docx|For everyone at Optimizely|Everyone at Optimizely
credits|docs/enablement/content/credits.md|Enablement-Where-Opal-and-AI-Credits-Fit-v1.0.docx|For account executives|Account executives
demos|docs/enablement/content/demos.md|Enablement-Which-Demo-to-Show-to-Whom-v1.0.docx|For account executives and solutions engineers|Account executives and solutions engineers
glossary|docs/enablement/GLOSSARY.md|Enablement-Glossary-v1.0.docx|For everyone at Optimizely|Everyone at Optimizely
```

Step 1, `snapshot-sources.sh`, in Git Bash. A tracked source is taken from its blob at HEAD, so an edit still in the working tree is never built; the figures must equal HEAD.

```
#!/usr/bin/env bash
# Lane W, step 1 of the Word build: snapshot what the build reads. A tracked source comes from its blob at HEAD, so an edit
# still in the working tree is never built; a source not committed yet comes from the working tree. The figures must equal
# HEAD. The engine facts sheet (S2) must be pinned to the commit the covers stamp. Run in Git Bash.
#   snapshot-sources.sh [--scratch <dir>]
set -euo pipefail
REPO=/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
S=/c/Users/LAH/AppData/Local/Temp/claude/C--Users-LAH-Documents---Development-Optimizely---cloudflare-base/6d912628-2c4c-48d2-9676-33d6a79a76ce/scratchpad/w/build
[ "${1:-}" = "--scratch" ] && S=$2
TOOLS=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
S2=docs/enablement/research/S2-engine-facts.md
pin() { grep -m1 -o 'Code is cited at commit `[0-9a-f]*`' | grep -o '[0-9a-f]\{7,40\}'; }
[ "$(git show "HEAD:$S2" | pin)" = "8b4f74c" ] && [ "$(pin < "$S2")" = "8b4f74c" ] || { echo "snapshot: S2 is not pinned to 8b4f74c at HEAD and in the working tree; the stamp would be wrong" >&2; exit 1; }
git diff --quiet HEAD -- docs/enablement/figures || { echo "snapshot: the figures differ from HEAD" >&2; exit 1; }
mkdir -p "$S/src" "$S/figures"
echo "HEAD $(git rev-parse --short HEAD)"
while IFS='|' read -r key src out reader team; do
  [ -n "$key" ] || continue
  name=$(basename "$src")
  if git cat-file -e "HEAD:$src" 2>/dev/null; then
    git show "HEAD:$src" | tr -d '\r' > "$S/src/$name"
    state="HEAD blob, last commit $(git log -1 --format=%h -- "$src")"
    git diff --quiet HEAD -- "$src" || state="$state; the working copy differs and is NOT used"
  else
    tr -d '\r' < "$src" > "$S/src/$name"
    state="NOT COMMITTED: the working copy"
  fi
  printf '%s  %-34s %s\n' "$(sha256sum "$S/src/$name" | cut -c1-16)" "$name" "$state"
done < "$TOOLS/pieces.txt"
cp docs/enablement/figures/*.png "$S/figures/"
```

Step 2, `build-word.sh`, in WSL. The first line of each snapshot is the cover title, verbatim; the copy the converter reads is the snapshot less that line and the one blank line after it, beside the figures, so that `../figures/…` resolves.

```
#!/usr/bin/env bash
# Lane W, step 2 of the Word build. For each piece, take the first line of its snapshot as the cover title, verbatim,
# write a copy without that line (and the one blank line after it) into $S/content, beside the figures in $S/figures,
# and feed that copy to the converter. Run in WSL, after snapshot-sources.sh.
#   build-word.sh [--out <dir>] [--scratch <dir>] [--only key,key]
set -euo pipefail
REPO=/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
OUT=$REPO/docs/enablement/word
S=/mnt/c/Users/LAH/AppData/Local/Temp/claude/C--Users-LAH-Documents---Development-Optimizely---cloudflare-base/6d912628-2c4c-48d2-9676-33d6a79a76ce/scratchpad/w/build
ONLY=
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT=$2; shift 2 ;;
    --scratch) S=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    *) echo "build-word: unknown argument $1" >&2; exit 2 ;;
  esac
done
TOOLS=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
COMMIT=8b4f74c
[ "$(grep -m1 -o 'Code is cited at commit `[0-9a-f]*`' docs/enablement/research/S2-engine-facts.md | grep -o '[0-9a-f]\{7,40\}')" = "$COMMIT" ] || { echo "build-word: S2 is not pinned to $COMMIT; the stamp would be wrong" >&2; exit 1; }
DATE=$(date '+%B %-d, %Y')
mkdir -p "$S/content" "$OUT"
while IFS='|' read -r key src out reader team; do
  [ -n "$key" ] || continue
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$key,"* ]]; then continue; fi
  name=$(basename "$src")
  title=$(head -n 1 "$S/src/$name" | sed -n 's/^# //p')
  [ -n "$title" ] || { echo "build-word: line 1 of $name is not a # title" >&2; exit 1; }
  tail -n +2 "$S/src/$name" | sed '1{/^$/d}' > "$S/content/$name"
  node scripts/md2docx.mjs "$S/content/$name" "$OUT/$out" "$title" "$reader · Engine facts as of commit $COMMIT" "$team" "1.0" "$DATE" "Internal: Optimizely only"
done < "$TOOLS/pieces.txt"
```

What ran, at 14:56 (`<w>` is `C:\Users\LAH\AppData\Local\Temp\claude\C--Users-LAH-Documents---Development-Optimizely---cloudflare-base\6d912628-2c4c-48d2-9676-33d6a79a76ce\scratchpad\w`, in its Git Bash or WSL spelling):

```
bash <w>/tools/snapshot-sources.sh
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash <w>/tools/build-word.sh"
bash <w>/tools/check-all.sh docs/enablement/word <w>/build
```

The converter printed no warning and no problem message:

```
md2docx: wrote docs/enablement/word/Enablement-What-It-Is-v1.0.docx, 19 KB, 54 blocks from 109 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Selling-It-v1.0.docx, 527 KB, 74 blocks from 198 markdown lines
md2docx: wrote docs/enablement/word/Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx, 867 KB, 157 blocks from 372 markdown lines
md2docx: wrote docs/enablement/word/Enablement-What-Is-Built-Designed-and-Open-v1.0.docx, 23 KB, 37 blocks from 145 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Where-Opal-and-AI-Credits-Fit-v1.0.docx, 414 KB, 74 blocks from 155 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Which-Demo-to-Show-to-Whom-v1.0.docx, 17 KB, 34 blocks from 59 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Glossary-v1.0.docx, 25 KB, 153 blocks from 306 markdown lines
```

**Run first into scratch.** `--scratch` and `--out` point the same scripts away from the repository. I ran the whole sequence into `scratchpad\w\dry2\` first and ran the checks on that output: 105 of 105 passed. The real build produced the same documents: compared part by part, every part is equal once the converter's random link ids and build timestamps are set aside. To rebuild one or two pieces, add `--only key,key` to the build and the check. The folder `docs/enablement/word/` is made by the script, and a document open in Word locks its file (the converter's rule 6).

## 4. The checks

One script, `check-docx.mjs`, reads each document straight from its zip parts (`word/document.xml`, `numbering.xml`, `settings.xml`, the relationships, headers, footers and properties) and compares it with the copy the converter was given. It re-implements the converter's block grammar, so the expected text, lists, tables, links and figures are computed independently of the converter's output. `check-all.sh` runs it on the seven with the cover values from `pieces.txt`, the snapshot as `--source` and the repository's `docs/enablement/figures` as `--figures`. I also unzipped each document for the page measure.

| # | Check | Result on all seven |
|---|---|---|
| 0 | The title is on the cover and in the running header only: no other paragraph, in the body or the contents, reads it; the cover title is the source's first line verbatim; the build copy is the source less that line and the blank line after it and does not open with a `#` heading; the build folder's figures are byte-identical to the repository's | Pass |
| 1 | The cover reads "Prepared for: <the reader's team>" and "Version: 1.0", with Prepared by Optimizely, the date and the classification; the subtitle is exactly the reader line, the dot and the stamp; the running header is the title and "Internal: Optimizely only"; the footer starts "<team> · 1.0"; the document properties carry the title, subtitle and creator | Pass |
| 2 | A real contents field, `TOC \h \o "1-2"`, marked dirty, with `updateFields` in the settings and one field end; one entry per `#` and `##` heading, in order, at the right level, each linked to a bookmark that sits on the paragraph of its own heading | Pass |
| 3 | Bookmark ids unique and paired: each start has exactly one end, the ends follow in order, none overlap, none left open, ids run 1 to n, names unique; the count equals every `##` heading plus each deeper heading a link names | Pass |
| 4 | Every numbered list restarts at 1: its own numbering instance, each with a start override of 1; the number of lists and items equals the markdown's | Pass |
| 5 | Every table, grid and row is 9,360 twips wide, all in dxa; each data table matches its markdown table (rows, cells, header text, header row repeating); one-cell boxes match the callouts and code blocks | Pass |
| 6 | Nothing lost, nothing added, order kept: every markdown block against the document's text, in order, and the same non-ASCII characters in the same counts | Pass |
| 7 | Headings: level, text and order against the markdown outline | Pass |
| 8 | No leaked markdown markers in any run outside code (`**`, backtick, `](`, `![`, `[text](`, `<br>`, a table pipe, `~~`, `__`, an escaped entity, a heading or quote marker at a paragraph start); an asterisk is a leak unless the markdown writes it as text, and the count outside code must equal the markdown's | Pass, no hits |
| 9 | Every in-document link: the count equals the markdown's, each anchor is a bookmark, and each lands on the bookmark of the heading its anchor names | Pass |
| 10 | The external links: text, target and an External relationship, all https, the same list as the markdown | Pass |
| 11 | Every figure: the same count as the markdown, exactly the text width (5,943,600 EMU, 6.50 in), height from the source's aspect ratio, embedded bytes identical to the repository's PNG of the same name, alt text equal to the caption, the caption beneath and centred, picture ids unique | Pass |
| 12 | Whole-word scan of the body, contents, headers, footers and properties for she, her, hers, he, him, his (and herself, himself); for the customer names in the common brief; for the lead's other vendor and customer names from the C3 checks; for em-dashes and en-dashes | Zero hits in every scan |
| 13 | Package integrity: every internal relationship target is in the package, every part is well-formed XML, the PNG content type is declared, compatibility mode 15 | Pass |
| 14 | Every verdict word in a verdict column (header Verdict, Label or Status) is bold, and every label the markdown bolds on its own is a bold run of exactly that word | Pass |

Changes to the checker since 14:17: check 8 counts asterisks against the markdown (the credits page writes one), checks 0 and 11 take the figures from the repository's folder, and check 14 gained its second half. That is 15 of 15 on each document, 105 of 105. In addition: `unzip -t` reports no errors on all seven; a raw scan of every XML and relationship part of the seven for the customer names, the owner's family and given names, the user name and local paths finds only the one personal name in the demos document (section 2.4); the whole-word scan found no customer name.

What each document contains, as the checks counted it:

| | What it is | Selling it | How it works | What is built | Credits | Demos | Glossary |
|---|---|---|---|---|---|---|---|
| Contents entries (all one level) | 8 | 9 | 24 | 7 | 6 | 7 | 22 |
| Headings | 8 | 9 | 24 | 7 | 6 | 7 | 22 |
| Bookmarks | 8 | 9 | 24 | 7 | 6 | 7 | 22 |
| Numbered lists (items) | 0 | 1 (5) | 3 (10, 11, 10) | 0 | 0 | 0 | 0 |
| Bulleted lists | 2 | 1 | 0 | 1 | 1 | 3 | 0 |
| Tables, with the cover and the one-cell boxes | 4 | 7 | 17 | 9 | 10 | 4 | 1 |
| Data tables | 3 | 6 | 13 | 6 | 6 | 3 | 0 |
| Table rows, all tables | 24 | 86 | 130 | 102 | 40 | 16 | 5 |
| In-document links in the body | 1 | 0 | 30 | 0 | 0 | 0 | 0 |
| External links (distinct targets) | 10 (7) | 5 (5) | 5 (5) | 3 (3) | 0 | 6 (6) | 0 |
| Figures | 0 | 1 | 2 | 0 | 1 | 0 | 0 |
| Bold verdict cells | 8 of 8 | 35 of 35 | 10 of 10 | 62 of 62 | none | none | none |
| Bold labels the markdown writes | 11 | 35 | 13 | 62 | 22 | 0 | 0 |
| Words in the build copy (W1's rule) | 1,938 | 3,259 | 5,902 | 2,503 | 1,783 | 881 | 4,711 |

"How it works" has three numbered lists, A.2's ten steps, B.1's eleven and B.7's ten findings, on numbering instances 2, 3 and 4. "Selling it" has one, five sentences about where the engine runs.

**The checks can fail.** Controls, each run against a real or deliberately flawed document:

- A small document with deliberate faults (a stray asterisk, three pronouns, a customer name) failed checks 8 and 12 on exactly those, and the same document against a different markdown failed 11 of 14 (run on the first version of the script).
- Check 0: given the unstripped source in place of the build copy, "What it is" failed checks 0, 2, 3, 6 and 7; given a title argument that is not the source's first line, the glossary failed checks 0 and 1.
- Check 14: the superseded set, built before the bold change, failed it with 62 label cells and none bold.
- Check 11 against the repository's figures: a figures folder whose copy of `architecture.png` differs by one byte makes it fail ("picture bytes differ from the source PNG").
- Check 8, asterisks: a document whose markdown lacks the asterisk the document carries fails it ("1 literal asterisks outside code, the markdown's visible text has 0"); against its own markdown it passes.
- A dead link is stopped by the converter itself, which writes nothing: "md2docx: … NOT written; … has 1 problem(s): line 3: link "dead" points to #nowhere, but no heading has that anchor". None of the seven hit it.

## 5. Page counts

**Method.** W1's `pages.mjs`: greedy line breaking on the real Calibri and Consolas advance widths from `C:\Windows\Fonts`, Word's line height, paragraph spacing, page breaks, keep-with-next, table rows that split at line boundaries and repeating header rows. The tool was in lane W1's session scratchpad and is copied here unchanged; `pages-fill.mjs` is the same model with more lines of output: each page's fill, the page a heading lands on and where a figure lands.

**Calibration, run again at this build.**

- The Word-saved Scope of Services v7, the document W1 used: Word records 7 pages, the model gives 7 (last page 43 %).
- W1's technical note v1.1, built by this converter: 21 pages, the last 98 % full, exactly W1's recorded measure.
- W2's one-pager v1.3: 3 pages, the body page 95 % full, exactly W2's recorded measure.
- The lead's rougher estimator (`pages-c3.mjs`, about ±15 %), run on the build copies, gives 7, 11, 19, 10, 8, 5 and 13, within a page of the model on every document.

It is a layout measurement, not Word's own count: expect Word to differ by about a page. It models the contents as the cached entries without page numbers; Word adds the numbers and no lines.

| Document | Pages | Cover | Contents | Body | Last page filled |
|---|---|---|---|---|---|
| What it is | 7 | 1 | 1 | pp. 3 to 7 | 20 % |
| Selling it | 11 | 1 | 1 | pp. 3 to 11 | 47 % |
| How it works and where it runs | 20 | 1 | 1 | pp. 3 to 20: Part A pp. 3 to 9, Part B pp. 9 to 20 | 37 % |
| What is built, designed and open | 9 | 1 | 1 | pp. 3 to 9 | 77 % |
| Where Opal and AI credits fit | 9 | 1 | 1 | pp. 3 to 9 | 29 % |
| Which demo to show to whom | 5 | 1 | 1 | pp. 3 to 5 | 79 % |
| Glossary | 12 | 1 | 1 | pp. 3 to 12 | 70 % |

Earlier build, for comparison: 6, 11, 20, 9 and 12 pages for the five that existed (the marketing piece grew by a page with its review changes).

W1's rule of thumb, about 270 words a page, overshoots all but the credits piece (it gives about 10, 15, 24, 12, 9, 6 and 20 pages in all). The documents hold 255 to 471 words a body page, because much of the text is in tables set at 9.5 pt and in short entries. Use the measure, not the rule of thumb.

**Gaps the tall figures leave.** An inline picture cannot split, so Word moves it, with its caption, to the top of the next page when it does not fit. "How it works": the decision-path figure (5.39 in) tops page 4 and leaves page 3 at 55 % full; the architecture figure (7.80 in) tops page 6 and leaves page 5 at 50 %. "Where Opal and AI credits fit": the session figure (5.72 in) tops page 6 and leaves page 5 at 48 %. In "Selling it" the architecture figure lands near the top of page 6 and leaves no gap. A wider, shorter architecture figure would close the larger gaps; the converter's cap is 8 in.

## 6. Not verified, and things to know

- **Not machine-verified:** Word's own pagination, following a link with Ctrl+Click, and Save as PDF. Word may not be automated on this machine and there is no LibreOffice. The owner is asked to open "How it works" (30 in-document links, two figures), accept the offer to update fields, Ctrl+Click one contents entry and one link, and try Save as PDF.
- **External link targets** were checked as present and https, not requested over the network (the site sits behind its gate, and the brief is "present"). "What it is" and "Selling it" now link to the site's pages (status, glossary, demos, credits, how it works, selling it) as external links to `edge-platform-bti.expedge.workers.dev`, and the demos are linked by address.
- **Style.** The documents carry the converter's house look (Calibri; navy `11142A` and blue `0B5CAD`), as every earlier Word deliverable does. That is not the current Optimizely brand set out in the `optimizely-brand` skill (green-led palette; VC Nudge and Die Grotesk, or Roboto as the sanctioned alternative). The fonts and colors are constants in `scripts/md2docx.mjs`, so applying the brand is a converter change for the coordinator to order; I did not change it.
- **Informational scan hits, not failures.** The demos document names three fictional demo screens, "The Bright Hour", "Calder" and "Lantern & Lane", which the common brief allows (demos are named by fictional brand and shown by URL) and which the lead's C3 name list would flag. The glossary's own deprecated entry for "BTIE" is one hit. No customer name appears anywhere. The one personal name, the demos' owner in the demos document, is content the demos source writes; it is flagged here only because the package's name rules are about customers.
- **Long addresses wrap.** The demos document prints each address as its link text in a 1.1 in column, over four or five lines, breaking at an arbitrary character; the links work.
- **Cross-document references.** Where the markdown names another piece in italics, in Word it carries no link; only the links the markdown writes out are live.
- **Nothing was dropped silently.** The converter ignores any cell beyond a table's header width and drops a lone `|` line. The checks compared every markdown table row with its header's cell count and looked for lone pipe lines: none.

## 7. Process notes

- **Scratch, all in the session scratchpad** (`<w>` as in section 3): `tools\` holds `pieces.txt`, `snapshot-sources.sh` and `build-word.sh` (texts in section 3), `check-docx.mjs` and `check-all.sh` (the checks), `pages.mjs` (W1's, unchanged) and `pages-fill.mjs`; `build\` holds the snapshots (`src\`), the stripped copies the converter read (`content\`) and the figure copies (`figures\`); `dry2\` is the run into scratch; `unz\` holds each document unzipped for the page measure; `superseded\alt-old-covers\` is the set built for the first covers; `neg\`, `neg2\`, `trial\`, `landscape-try\` are the controls and trials. `final-check-output-7.txt` is the full output of the 15 checks on the seven. Nothing there is needed by the repository, and nothing was added to it. If the coordinator wants the build step or the checker kept in the repo, it belongs beside the converter; say so and I will propose a path.
- **Rebuilding.** Run the snapshot, the build and the checks as in section 3, then unzip each document and run `node pages-fill.mjs <dir> --trace`. After a change to a source, to a figure, to S2's pin or to the converter, run all of it again; `--only key,key` limits the build and the check to some pieces.
- **A slip.** In the command that ran the dry run's snapshot I included `rm -rf /tmp/none`, a leftover. The path does not exist, so nothing was removed, but the rules forbid `rm -rf` and I should not have typed it. It was the only delete command of the session, and nothing was deleted.
- **The renames.** The 14:09 rename used `mv -n` (no overwrite); the old sets of 13:58 and 14:17 are replaced, not deleted by hand. The scratch set for the first covers was moved, not deleted.
- **A false alarm, resolved earlier.** My first line-ending count of the sources came back as CRLF on every line: a shell quoting slip in the count, not the files (`od`, `tr -cd '\r'` and `git ls-files --eol` all show LF).
- Git was used read-only (`status`, `log`, `diff`, `show`, `cat-file`, `rev-parse`, `ls-files --eol`, `config --get`). Nothing was installed or killed, and nothing was deployed. The folder `docs/enablement/word/` and this note are the only repository paths written.
