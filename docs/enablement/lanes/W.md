# Lane W: the Word copies of the enablement package

**Status, 2026-10-02, review round three built at 21:54 from HEAD `b36098c`: six Word documents sit in `docs/enablement/word/`, exactly these six and nothing else, as `Enablement-…-v2.0.docx`. They tell the finished product as a story (`LANE-BRIEF-V2.md`). Round three's committed edits changed five of the six sources (the marketing, sellers' and engineers' pieces, the credits page and the glossary), so those five documents were rebuilt in place; the demo map's source is unchanged by hash (`d4ab29196b9961d5`) and its document is unchanged by hash (`f440d4707df6eeb9`), so it was not rebuilt. The documented steps ran: sources snapshotted from their HEAD blobs, each source's title line stripped for the build, covers per design section 6 (the subtitle is the reader alone, the version is 2.0). All six pass all 16 checks (96 of 96), the vocabulary check (check 15) included, with the coordinator's allow-list (section 4). The credits page, having lost its legend row, is back to 7 pages after spilling onto an eighth. The three figures are unchanged and equal HEAD, and every embedded image is byte-identical to its repository PNG. The name scan of every part of every document is zero. The seven `-v1.0.docx` files, the retired status piece's included, stay in the scratchpad, none deleted.** I committed, pushed, installed and deployed nothing, and edited no source. Two earlier slips are recorded in section 7; this round had none.

This lane's files: the six documents in `docs/enablement/word/`, and this note. The tools stay in the session scratchpad (section 7); none is in the repository.

## 1. What was built

All six carry "Prepared by Optimizely" (the converter's fixed line), version "2.0" (bare), the build date "October 2, 2026" and classification "Internal: Optimizely only". The subtitle is the reader line alone; the design's section 6 says it "names no code commit", and the facts stamp of version 1 is retired (design section 8).

| Word document | Bytes | Pages | Prepared for | Subtitle on the cover |
|---|---|---|---|---|
| `Enablement-What-It-Is-v2.0.docx` | 19,976 | 7 | Marketing | For marketing |
| `Enablement-Selling-It-v2.0.docx` | 543,293 | 12 | Account executives | For account executives |
| `Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx` | 832,009 | 16 | Solutions engineers | For solutions engineers |
| `Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx` | 314,436 | 7 | Account executives | For account executives |
| `Enablement-Which-Demo-Shows-Which-Story-v2.0.docx` | 21,640 | 8 | Account executives | For account executives |
| `Enablement-Glossary-v2.0.docx` | 25,206 | 12 | Everyone at Optimizely | For everyone at Optimizely |

The cover title is each source's first line, verbatim. These are the sources, all committed, taken from their HEAD blobs at 21:54 (HEAD `b36098c`). Five changed in review round three and one did not; the earlier commit and hash of each changed source, as of the 20:31 build, is in the State column. The six hashes below are the ones every document in the folder was built from:

| Source | Cover title | State | sha-256 (first 16 hex) |
|---|---|---|---|
| `docs/enablement/content/what-it-is.md` | Behavioral Targeting and Intelligence: what it is | committed, 025aa29 (21:37; was 9fef834, `6c87a3edc6e408e3`) | `63ffb02d5fd96aeb` |
| `docs/enablement/content/selling-it.md` | Behavioral Targeting and Intelligence: selling it | committed, af02596 (21:37; was 9d615d1, `5421ef594a706153`) | `a447033ba914f917` |
| `docs/enablement/content/how-it-works-and-where-it-runs.md` | Behavioral Targeting and Intelligence: how it works and where it runs | committed, a4036c3 (21:37; was 4670c3a, `c296543ef69e38ff`) | `97f5c3dd2b038182` |
| `docs/enablement/content/credits.md` | Behavioral Targeting and Intelligence: Where Opal and AI Credits Fit, and Where They Never Do | committed, 3a6c45e (21:38; was c0be7ae, `e38f7913b5bf0e71`) | `1cb802a9de306ca2` |
| `docs/enablement/content/demos.md` | Behavioral Targeting and Intelligence: which demo shows which story | committed, c0be7ae (20:23); unchanged | `d4ab29196b9961d5` |
| `docs/enablement/GLOSSARY.md` | Behavioral Targeting and Intelligence: the glossary | committed, 354eafd (21:36; was c4f4f5f, `c1cc85bd480acee8`) | `c030f69ed7d4371b` |

**Two sources were uncommitted when I built, and are committed now.** The first instruction was to build from committed sources, but at 20:17 the committed blobs of `credits.md` and `demos.md` were the text before the rewrite, so building from HEAD would have produced stale documents. I built them from the working copies, said so in the snapshot step (the `--working` option, which prints "WORKING COPY, UNCOMMITTED" unless the copy equals HEAD), and recorded the hashes. `credits.md` changed after my first snapshot: at 20:17 I snapshotted `fcefca82…` and built from it at 20:18; at 20:19 the file was modified (it gained the fixed AI sentence and the "style concierge" and "generated imagery" wording), and I rebuilt the credits document at 20:20 from `e38f7913…`. `demos.md` did not change after 20:16. The coordinator then committed both at `c0be7ae` (20:23) and asked for the two documents to be built from HEAD. I snapshotted again at 20:25 with no `--working`: the committed blobs hash to `e38f7913b5bf0e71` and `d4ab29196b9961d5`, the same as the working copies I had built from, so the two documents already in the folder are built from the committed text and were not rebuilt. To be sure, I rebuilt both from the HEAD snapshot into scratch and compared them with the documents in the folder part by part: every part is equal once the converter's random link ids and build timestamps are set aside (the demos file differs by 3 bytes from those, the credits file by none).

The converter is `scripts/md2docx.mjs`, sha-256 `0b2159ee…`, the version that numbers bookmarks uniquely; `docx` 9.7.2 from `~/.md2docx`; Node 22.15.0 in WSL Ubuntu-22.04. Document hashes, to tell whether a later build replaced a file (first 16 hex digits of the sha-256): What-It-Is `2d6fd285a1fefe6d`, Selling-It `9070b93553902422`, How-It-Works `9c7062fa3c7a4ad2`, Credits `d22c979ce42b338f`, Demos `f440d4707df6eeb9`, Glossary `6ad12ffe19bf1629`. Before round three the five that changed were What-It-Is `a50056f37009b3cf`, Selling-It `d6e1e0ca4bf22bb0`, How-It-Works `8e026e67bdea72ff`, Credits `f775061badf560a5` and Glossary `a6ccf13d7ff9bc9b`; the demo map's has been `f440d4707df6eeb9` since its 20:28 rebuild (the file built at 20:20 under its earlier name was `2e46d051100dc7ab`). If a content lane commits a change to a source after 21:54, the matching document is stale: compare the hash above.

**Line endings.** The sources are LF in the index and the working copy; the snapshot removes any carriage return anyway, because `core.autocrlf=true` here and the converter fails on CRLF.

**Both names, and where the old files went.** Version 2.0 replaces version 1.0 under new names, as the coordinator ruled after the rewrite ("the rewritten content is a new version of the package"). Every `-v1.0.docx` file was moved out of `docs/enablement/word/` at about 20:19 with `mv -n`, into `scratchpad\w\retired\v1.0\`; the hashes before and after each move are equal, and nothing was deleted.

| Version 1.0 name (moved, last built) | Version 2.0 name (built) | Bytes of the v1.0 file | sha-256 of the v1.0 file (16 hex) |
|---|---|---|---|
| `Enablement-What-It-Is-v1.0.docx` | `Enablement-What-It-Is-v2.0.docx` | 19,638 | `da7db4114fa58cdf` |
| `Enablement-Selling-It-v1.0.docx` | `Enablement-Selling-It-v2.0.docx` | 539,914 | `ccc2d802d0d555c4` |
| `Enablement-How-It-Works-and-Where-It-Runs-v1.0.docx` | `Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx` | 887,824 | `ef77cd66fca1c246` |
| `Enablement-Where-Opal-and-AI-Credits-Fit-v1.0.docx` | `Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx` | 424,432 | `536d548f6d5ede0d` |
| `Enablement-Which-Demo-to-Show-to-Whom-v1.0.docx` | `Enablement-Which-Demo-Shows-Which-Story-v2.0.docx` (built at 20:18 as `Enablement-Which-Demo-to-Show-to-Whom-v2.0.docx`, moved at 20:28) | 17,254 | `fc184b3682ed7e19` |
| `Enablement-Glossary-v1.0.docx` | `Enablement-Glossary-v2.0.docx` | 25,389 | `b686dc17f59ef438` |
| `Enablement-What-Is-Built-Designed-and-Open-v1.0.docx` | none: the status piece is retired (design section 8); its source is `research/status-engineering-record.md` | 23,411 | `f9a4684e70453422` |

**The demo map's name, 20:28.** I first named it as the coordinator had, `Enablement-Which-Demo-to-Show-to-Whom-v2.0.docx`. The design's section 6 names it `Enablement-Which-Demo-Shows-Which-Story-v2.0.docx`, which is what its source and page are titled ("which demo shows which story"), and at about 20:27 the coordinator ruled that the Word copy takes that name. I moved the file with `mv -n` at 20:28: the bytes were the same (sha-256 `2e46d051100dc7ab`, 21,676 bytes, before and after the move), and its cover title, which comes from the source's first line, already read "Behavioral Targeting and Intelligence: which demo shows which story", so the move alone needed no rebuild. The same coordinator's earlier ruling asked for one rebuild with "Prepared for: Account executives" (section 2.1), and that rebuild then wrote the file under the new name, so the file in the folder has the new hash. Both names are recorded here and in `pieces.txt`; the old name is gone from the folder, and no file was deleted.

**History.** First build 13:58 as `BTI-…-v1.0.docx` (title repeated in the body, plain verdict words); moved to the `Enablement-` names at 14:09; rebuilt in place at 14:17 (title line stripped, covers per design section 6 of version 1, bold verdict words), at 14:56 (post-review sources, corrected figures, two new pieces), at 15:04 and at 15:27 (the final edits); the coordinator committed those at `a412113`, `b32f360` and later. At 20:12 the package was rewritten under `LANE-BRIEF-V2.md`, and version 2.0 was built at 20:18 and rebuilt in part at 20:20, 20:28 and 20:31. At 21:54, after review round three's commits (`354eafd`, `a4036c3`, `af02596`, `025aa29` and `3a6c45e`), five documents were rebuilt in place from HEAD `b36098c`; the demo map was not, its source being unchanged. A set built in scratch for the first covers is superseded and sits in `scratchpad\w\superseded\alt-old-covers\`: it must not be copied over these files.

## 2. The rulings, and what each did

### 2.1 The brief, the sources and the covers

`LANE-BRIEF-V2.md` changes what the sources say, not the method. The build is unchanged except where the rulings below say otherwise. Under the brief the documents carry no build-state words; section 4 shows that all six pass the vocabulary check, with the coordinator's allow-list.

Covers, per the design's section 6 and the coordinator's rulings:

| Item | As built | Source of the rule |
|---|---|---|
| File names | `Enablement-<Title>-v2.0.docx`, no package name | design section 6; the coordinator's names |
| Title | the source's first line, verbatim | design section 6 |
| Subtitle | the reader line alone, e.g. "For marketing"; no commit stamp | design section 6 and section 8 (the stamp is retired) |
| Prepared for | the reader's team, as the coordinator ruled earlier: Marketing; Account executives; Solutions engineers; Everyone at Optimizely (glossary); Account executives (credits); Account executives (demos, ruled at about 20:26 to match its source and the design) | the coordinator; the design's "Optimizely marketing" is an example |
| Version | 2.0, bare | design section 6; the coordinator |
| Date | the build date, October 2, 2026 | design section 6 |
| Classification | Internal: Optimizely only | design section 6 |

The demos cover first kept the earlier ruling, "Account executives and solutions engineers". The demos source says "For account executives, who choose which demo shows each part of the story" and the design names an account executive as its reader, so the coordinator ruled that the cover match them. The 20:28 rebuild reads "Prepared for: Account executives", and its subtitle, which is the reader line, reads "For account executives"; both are changed in the one line of the piece table (section 3).

### 2.2 The title line is stripped from the Word build

The converter prints the title on the cover and in the running header. A `#` title line in the markdown would print it again as page 3's heading and as the first contents entry, so the build feeds the converter a copy of the source without that line. The step is mechanical and reproducible (section 3), and check 0 proves it for each document: the cover title is the source's first line verbatim; the copy is the source less that line and the one blank line after it, and nothing else; no paragraph in the body or the contents reads the title; and the figures the copy reaches are byte-identical to the repository's. The contents lists sections only, all at one level.

### 2.3 The two interactive pages have no Word copy

Design section 6 says so. Their markdown, `content/how-it-works-interactive.md` and `content/see-it-work.md`, exists for the text check; both are untracked at HEAD `890d76d`, and I built nothing from them.

### 2.4 The figures were redrawn; the embedded images were re-verified

All three figures were redrawn as the finished product, with no legend, labels or numbers (`74ec6a1`; the repository's copies equal HEAD). Verified three ways: check 11 compares each embedded image with the PNG of the same name in `docs/enablement/figures/`, byte for byte; check 0 does the same for the build folder's copies; and, independent of the checks, I unzipped every media part of every document and matched its sha-256 against the repository's three PNGs. The snapshot step also stops unless the figures equal HEAD.

| Document | Embedded image | sha-256 (12) | Bytes | Prints at text width |
|---|---|---|---|---|
| How it works | `decision-path.png` | `9816ac3f772e` | 297,788 | 6.50 × 5.20 in |
| How it works | `architecture.png` | `466c9e12146e` | 536,136 | 6.50 × 7.92 in |
| Selling it | `architecture.png` | `466c9e12146e` | 536,136 | 6.50 × 7.92 in |
| Credits | `before-during-after.png` | `1c2e5899de59` | 308,554 | 6.50 × 4.83 in |

The captions are the figures' SVG titles ("From an event to a decision", "Where the engine runs on Cloudflare", "One visitor's session: what happens before, during and after").

**Round three, 21:54.** The figures did not change: the repository's three PNGs still hash to `466c9e12146e`, `1c2e5899de59` and `9816ac3f772e`, equal HEAD, and the four embedded images in the rebuilt documents match them byte for byte (check 11, check 0, and the independent unzip and hash). The SVG text of the three figures was read again by check 15 and holds none of the forbidden words.

## 3. The documented build step, with the exact commands

Three scratchpad tools, none in the repository. `pieces.txt` is the table of pieces: the key, the source, the output name, the reader line and the team for "Prepared for". The key is what `--only` takes; the status piece has no line, because it is retired.

```
what-it-is|docs/enablement/content/what-it-is.md|Enablement-What-It-Is-v2.0.docx|For marketing|Marketing
selling-it|docs/enablement/content/selling-it.md|Enablement-Selling-It-v2.0.docx|For account executives|Account executives
how-it-works|docs/enablement/content/how-it-works-and-where-it-runs.md|Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx|For solutions engineers|Solutions engineers
credits|docs/enablement/content/credits.md|Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx|For account executives|Account executives
demos|docs/enablement/content/demos.md|Enablement-Which-Demo-Shows-Which-Story-v2.0.docx|For account executives|Account executives
glossary|docs/enablement/GLOSSARY.md|Enablement-Glossary-v2.0.docx|For everyone at Optimizely|Everyone at Optimizely
```

Step 1, `snapshot-sources.sh`, in Git Bash. A tracked source is taken from its blob at HEAD, so an edit still in the working tree is never built. `--working key,key` is the one exception, explicit and recorded, for a source whose committed blob is stale. The figures must equal HEAD.

```
#!/usr/bin/env bash
# Lane W, step 1 of the Word build: snapshot what the build reads. A tracked source comes from its blob at HEAD, so an edit
# still in the working tree is never built. A source named in --working (an explicit, recorded exception, for a source whose
# committed blob is known to be stale) comes from the working tree, and the line says whether that copy is committed. A
# source not committed at all comes from the working tree and says so. The figures must equal HEAD. Run in Git Bash.
#   snapshot-sources.sh [--scratch <dir>] [--working key,key]
set -euo pipefail
REPO=/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
S=/c/Users/LAH/AppData/Local/Temp/claude/C--Users-LAH-Documents---Development-Optimizely---cloudflare-base/6d912628-2c4c-48d2-9676-33d6a79a76ce/scratchpad/w/build
WORKING=
while [ $# -gt 0 ]; do
  case "$1" in
    --scratch) S=$2; shift 2 ;;
    --working) WORKING=$2; shift 2 ;;
    *) echo "snapshot: unknown argument $1" >&2; exit 2 ;;
  esac
done
TOOLS=$(cd "$(dirname "$0")" && pwd)
cd "$REPO"
git diff --quiet HEAD -- docs/enablement/figures || { echo "snapshot: the figures differ from HEAD" >&2; exit 1; }
mkdir -p "$S/src" "$S/figures"
echo "HEAD $(git rev-parse --short HEAD)"
while IFS='|' read -r key src out reader team; do
  [ -n "$key" ] || continue
  name=$(basename "$src")
  if [ -n "$WORKING" ] && [[ ",$WORKING," == *",$key,"* ]]; then
    tr -d '\r' < "$src" > "$S/src/$name"
    if git cat-file -e "HEAD:$src" 2>/dev/null && [ "$(git show "HEAD:$src" | tr -d '\r' | sha256sum)" = "$(sha256sum < "$S/src/$name")" ]; then
      state="HEAD blob, equal to the working copy, last commit $(git log -1 --format=%h -- "$src")"
    else
      state="WORKING COPY, UNCOMMITTED (last commit $(git log -1 --format=%h -- "$src")), used because --working names it"
    fi
  elif git cat-file -e "HEAD:$src" 2>/dev/null; then
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

Step 2, `build-word.sh`, in WSL. The first line of each snapshot is the cover title, verbatim; the copy the converter reads is the snapshot less that line and the one blank line after it, beside the figures, so that `../figures/…` resolves. The subtitle is the reader line alone.

```
#!/usr/bin/env bash
# Lane W, step 2 of the Word build. For each piece, take the first line of its snapshot as the cover title, verbatim,
# write a copy without that line (and the one blank line after it) into $S/content, beside the figures in $S/figures,
# and feed that copy to the converter. The subtitle is the reader line alone (design 6: it names no code commit).
# Run in WSL, after snapshot-sources.sh.
#   build-word.sh [--out <dir>] [--scratch <dir>] [--only key,key]
set -euo pipefail
REPO=/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base
OUT=$REPO/docs/enablement/word
S=/mnt/c/Users/LAH/AppData/Local/Temp/claude/C--Users-LAH-Documents---Development-Optimizely---cloudflare-base/6d912628-2c4c-48d2-9676-33d6a79a76ce/scratchpad/w/build
ONLY=
VERSION=2.0
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
DATE=$(date '+%B %-d, %Y')
mkdir -p "$S/content" "$OUT"
while IFS='|' read -r key src out reader team; do
  [ -n "$key" ] || continue
  if [ -n "$ONLY" ] && [[ ",$ONLY," != *",$key,"* ]]; then continue; fi
  name=$(basename "$src")
  title=$(head -n 1 "$S/src/$name" | sed -n 's/^# //p')
  [ -n "$title" ] || { echo "build-word: line 1 of $name is not a # title" >&2; exit 1; }
  tail -n +2 "$S/src/$name" | sed '1{/^$/d}' > "$S/content/$name"
  node scripts/md2docx.mjs "$S/content/$name" "$OUT/$out" "$title" "$reader" "$team" "$VERSION" "$DATE" "Internal: Optimizely only"
done < "$TOOLS/pieces.txt"
```

What ran (`<w>` is `C:\Users\LAH\AppData\Local\Temp\claude\C--Users-LAH-Documents---Development-Optimizely---cloudflare-base\6d912628-2c4c-48d2-9676-33d6a79a76ce\scratchpad\w`, in its Git Bash or WSL spelling):

```
bash <w>/tools/snapshot-sources.sh --working credits,demos
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash <w>/tools/build-word.sh"
bash <w>/tools/check-all.sh docs/enablement/word <w>/build
```

That was at 20:17 and 20:18. At 20:20, after `credits.md` changed, the same snapshot ran again and then `build-word.sh --only credits,demos` and `check-all.sh … --only credits,demos`; the other four documents were not touched by that run, and their sources' hashes were the same. At 20:25, after the commit `c0be7ae`, `snapshot-sources.sh` ran once more without `--working` (every source a HEAD blob, every hash unchanged), and `build-word.sh --only credits,demos --out <w>/dry4/word` rebuilt the two into scratch to compare them with the documents in the folder (section 1). The converter printed no warning and no problem message:

```
md2docx: wrote docs/enablement/word/Enablement-What-It-Is-v2.0.docx, 19 KB, 69 blocks from 114 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Selling-It-v2.0.docx, 531 KB, 56 blocks from 141 markdown lines
md2docx: wrote docs/enablement/word/Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx, 812 KB, 135 blocks from 303 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx, 307 KB, 72 blocks from 152 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Which-Demo-to-Show-to-Whom-v2.0.docx, 21 KB, 83 blocks from 134 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Glossary-v2.0.docx, 24 KB, 147 blocks from 290 markdown lines
```

**The demo map again, 20:28.** After the two rulings (its "Prepared for", and its name) I changed its line in `pieces.txt`, ran the snapshot once more (HEAD `9a86d0c`; the six hashes unchanged), ran `build-word.sh --only demos`, and ran the checks on all six:

```
bash <w>/tools/snapshot-sources.sh
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash <w>/tools/build-word.sh --only demos"
bash <w>/tools/check-all.sh docs/enablement/word <w>/build
```

The converter printed no warning: "md2docx: wrote docs/enablement/word/Enablement-Which-Demo-Shows-Which-Story-v2.0.docx, 21 KB, 83 blocks from 134 markdown lines". The file is 21,640 bytes, eight pages as before (the last 73 % full), and the lead's rougher estimator still says 8. I did not rebuild the other five at that point: their sources hashed as they had, and their documents were unchanged.

**The glossary again, 20:31.** While I was writing this note the coordinator committed `c4f4f5f` at 20:30, "the journey stage entry without the bare word": the Journey stage entry now says "with the middle one reported as thinking" where it said "with the middle stage reported as thinking". The glossary's snapshot at 20:31 hashed `c1cc85bd480acee8` against the `ff13f1aa7a49e2fb` the document was built from, so I rebuilt it from HEAD (`snapshot-sources.sh`, then `build-word.sh --only glossary`, then `check-all.sh` on all six): "md2docx: wrote docs/enablement/word/Enablement-Glossary-v2.0.docx, 24 KB, 147 blocks from 290 markdown lines". The file is 24,994 bytes, twelve pages as before (the last 16 % full), the new sentence is in it and the old one is not, and the other five sources hashed as before. The Glossary's check 15 now meets one allowed phrase less ("middle stage" 0); the "Stage." entry is still there and still allowed.

**Round three, 21:54.** The coordinator committed review round three's edits and asked for the four narrative documents, and the credits page, to be rebuilt from HEAD, with the demo map's source confirmed unchanged by hash. I saved the hashes of the snapshots the folder was built from (`last-built-hashes-4.txt`), took a new snapshot from the HEAD blobs (HEAD `b36098c`, no `--working`), and compared. Five sources had changed and the demo map's had not:

| Source | Hash it was built from | Hash at HEAD `b36098c` | |
|---|---|---|---|
| `what-it-is.md` | `6c87a3edc6e408e3` | `63ffb02d5fd96aeb` | changed (`025aa29`) |
| `selling-it.md` | `5421ef594a706153` | `a447033ba914f917` | changed (`af02596`) |
| `how-it-works-and-where-it-runs.md` | `c296543ef69e38ff` | `97f5c3dd2b038182` | changed (`a4036c3`) |
| `credits.md` | `e38f7913b5bf0e71` | `1cb802a9de306ca2` | changed (`3a6c45e`) |
| `demos.md` | `d4ab29196b9961d5` | `d4ab29196b9961d5` | **same** |
| `GLOSSARY.md` | `c1cc85bd480acee8` | `c030f69ed7d4371b` | changed (`354eafd`) |

```
bash <w>/tools/snapshot-sources.sh
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash <w>/tools/build-word.sh --only what-it-is,selling-it,how-it-works,credits,glossary"
bash <w>/tools/check-all.sh docs/enablement/word <w>/build
```

The converter printed no warning and no problem message:

```
md2docx: wrote docs/enablement/word/Enablement-What-It-Is-v2.0.docx, 20 KB, 71 blocks from 116 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Selling-It-v2.0.docx, 531 KB, 56 blocks from 141 markdown lines
md2docx: wrote docs/enablement/word/Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx, 813 KB, 135 blocks from 303 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Where-Opal-and-AI-Credits-Fit-v2.0.docx, 307 KB, 68 blocks from 148 markdown lines
md2docx: wrote docs/enablement/word/Enablement-Glossary-v2.0.docx, 25 KB, 149 blocks from 294 markdown lines
```

The demo map was not rebuilt. Its source hash is the one it was built from, and the file in the folder is the 20:28 build, byte for byte: 21,640 bytes, sha-256 `f440d4707df6eeb9`, modified 20:28. The edits of round three, as the commits show them: the marketing piece says the retailer "chose to build it with us", rewords the sentence that says the engine is not a recommendations engine, adds the consent choice to what a customer provides, uses the fixed AI sentence in its never-say table and links to See it work, the credits page and the demo map by their titles; the sellers' piece names "the same customer", lists a catalog-search service, not a model key, among the optional items, and links the demo map by its title; the engineers' piece says time never switches a seed off and adds the dampening factor the brand publishes, and moves arrival seeds into the console's list; the credits page lost its legend row, the three bullets "Credits apply", "Deterministic engine · no credits" and "Conditional / exception" (the document has no list paragraphs now, where it had three, and the one "Credits apply" left is a table header); the glossary gained a Gate entry, under a new G heading (22 contents entries, where it had 21), and its Pin and Placement entries say a pin holds the place the brand sets.

**Run first into scratch.** `--scratch` and `--out` point the same scripts away from the repository (the snapshot takes `--scratch` too, so that the build finds its sources). I ran the sequence into `scratchpad\w\dry3\` first (at 20:17; then the same four passed 16 of 16 and the same two failed check 15, on the same hits, which the ruling of about 20:26 has since allowed). For the 20:28 and 21:54 rebuilds I made no dry run: the first changed a cover argument and a file name, the allow-list was proved with a control (section 4), and round three changed only the sources, which the snapshot step pins to HEAD and check 0 compares with the document. The folder `docs/enablement/word/` is made by the script, and a document open in Word locks its file (the converter's rule 6). The moves of the v1.0 files were separate commands, `mv -n` each, run after the checks.

## 4. The checks

One script, `check-docx.mjs`, reads each document straight from its zip parts (`word/document.xml`, `numbering.xml`, `settings.xml`, the relationships, headers, footers and properties) and compares it with the copy the converter was given. It re-implements the converter's block grammar, so the expected text, lists, tables, links and figures are computed independently of the converter's output. `check-all.sh` runs it on the six with the cover values from `pieces.txt`, the snapshot as `--source` and the repository's `docs/enablement/figures` as `--figures`. I also unzipped each document for the page measure.

| # | Check | Result |
|---|---|---|
| 0 | The title is on the cover and in the running header only: no other paragraph, in the body or the contents, reads it; the cover title is the source's first line verbatim; the build copy is the source less that line and the blank line after it and does not open with a `#` heading; the build folder's figures are byte-identical to the repository's | Pass on all six |
| 1 | The cover reads "Prepared for: <the reader's team>" and "Version: 2.0", with Prepared by Optimizely, the date and the classification; the subtitle is exactly the reader line; the running header is the title and "Internal: Optimizely only"; the footer starts "<team> · 2.0"; the document properties carry the title, subtitle and creator | Pass on all six |
| 2 | A real contents field, `TOC \h \o "1-2"`, marked dirty, with `updateFields` in the settings and one field end; one entry per `#` and `##` heading, in order, at the right level, each linked to a bookmark that sits on the paragraph of its own heading | Pass on all six |
| 3 | Bookmark ids unique and paired: each start has exactly one end, the ends follow in order, none overlap, none left open, ids run 1 to n, names unique; the count equals every `##` heading plus each deeper heading a link names | Pass on all six |
| 4 | Every numbered list restarts at 1: its own numbering instance, each with a start override of 1; the number of lists and items equals the markdown's | Pass on all six |
| 5 | Every table, grid and row is 9,360 twips wide, all in dxa; each data table matches its markdown table (rows, cells, header text, header row repeating); one-cell boxes match the callouts and code blocks | Pass on all six |
| 6 | Nothing lost, nothing added, order kept: every markdown block against the document's text, in order, and the same non-ASCII characters in the same counts | Pass on all six |
| 7 | Headings: level, text and order against the markdown outline | Pass on all six |
| 8 | No leaked markdown markers in any run outside code; an asterisk is a leak unless the markdown writes it as text, and the count outside code must equal the markdown's | Pass on all six, no hits |
| 9 | Every in-document link: the count equals the markdown's, each anchor is a bookmark, and each lands on the bookmark of the heading its anchor names | Pass on all six |
| 10 | The external links: text, target and an External relationship, all https, the same list as the markdown | Pass on all six |
| 11 | Every figure: the same count as the markdown, exactly the text width (5,943,600 EMU, 6.50 in), height from the source's aspect ratio, embedded bytes identical to the repository's PNG of the same name, alt text equal to the caption, the caption beneath and centred, picture ids unique | Pass on all six |
| 12 | Whole-word scan of the body, contents, headers, footers and properties for she, her, hers, he, him, his (and herself, himself); for the customer names in the common brief; for the lead's other vendor and customer names from the C3 checks; for em-dashes and en-dashes | Zero hits in every scan |
| 13 | Package integrity: every internal relationship target is in the package, every part is well-formed XML, the PNG content type is declared, compatibility mode 15 | Pass on all six |
| 14 | Every verdict word in a verdict column is bold, and every label the markdown bolds on its own is a bold run of exactly that word | Pass on all six, and vacuous: version 2 has no labels, so there are no verdict cells and no bold labels to count |
| 15 | **New.** No visible text carries "designed", "built" (except inside "built it with us", "built for", "built on" and "built once"), "stage" (except "journey stage", "journey-stage", "middle stage" and the glossary's "Stage." entry), "open" as a label, or "today" (rules below) | Pass on all six, with the allow-list; before the coordinator's ruling it failed on two (below) |

**Check 15, as I implemented it.** Visible text is every `w:t` in the body, the contents, the cover, the tables, the headers and footers, and the document properties, plus the text of each embedded figure, read from the SVG whose PNG is embedded (that is what the picture draws). Whole words, any case. `designed` and `today` are flagged wherever they occur. `built` is flagged except inside the exact phrases "built it with us" (the brief's fixed quotation) and, by the coordinator's ruling, "built for", "built on" and "built once". `stage` and `stages` are flagged except as "journey stage", "journey stages" or "journey-stage" (the hyphen form, as in "journey-stage fit", is the same concept; I allowed it and count it) and, by the same ruling, "middle stage" and the uses inside the glossary's "Stage." entry (a paragraph that begins with the term "Stage."). Every allowance is counted per document in the output, so a reader can see what the allow-list let through. "Open" as a label is flagged in four forms: a bold run that is only the word, text that begins "Open:", text that is only "Open", and a verdict-column cell that begins with it. Other uses of the word, "open it from where you are" or "in the open", are listed for a person to judge and do not fail. The brief's other build-state words ("not yet", "remediation", "rollout") are counted as information only; they are zero in all six.

| Document | Hits | Allowed by the brief ("built it with us"; "journey stage") | Allowed by the ruling | Other uses of "open" (not labels) | Figure text read |
|---|---|---|---|---|---|
| What it is | 0 | 0; 0 (1; 0 before round three) | none | 0 | none |
| Selling it | 0 | 0; 0 (1; 0 before round three) | none | 0 | `architecture.png`, 102 items, 0 hits |
| How it works | 0 (6 before the ruling) | 0; 5 | "built for" 4, "built on" 1, "built once" 1 | 0 | `decision-path.png` 93 items and `architecture.png` 102, 0 hits |
| Credits | 0 | 0; 0 | none | 0 | `before-during-after.png`, 53 items, 0 hits |
| Demo map | 0 | 0; 0 | none | 4 ("open it from where you are" three times, in the rule at the top, in a bullet and in the rule repeated at the end; "in the open" once) | none |
| Glossary | 0 (4 before the ruling; at 20:18 build) | 0; 6 | the "Stage." entry 1 paragraph, 3 uses of the word inside it; "middle stage" 1 in the 20:18 build, 0 since the source changed at 20:30 | 0 | none |

**The ruling, and the ten hits it covers.** At about 20:26 the coordinator ruled that the six "built" hits in the engineers' piece are the ordinary verb ("tools built for known customers", "built for that window", "the front end is built once"), not build-state framing, and that the glossary's "stage" hits are its own deprecation entry and the journey stage's middle stage; allow-list those exact phrases, no source changes. I did that: the allow-list above is the ruling, and the sources are as committed. The ten hits, with their source lines (the sources are committed; I changed neither them nor the check's other rules):

- `how-it-works-and-where-it-runs.md`, six hits for "built". Line 9 is the `A.1` heading, "Most visitors are strangers, and the tools built for known customers cannot see them", which prints twice: as the heading and as its contents entry. Line 11 carries three: "tools built for known customers are blind in that window", "The retailer's own setup, built on eight to ten audience lists" and "The engine is built for that window." Line 259 has "The front end is built once, and later capabilities are switched on in configuration". The brief's fixed quotation, "built it with us", is not in this piece.
- `GLOSSARY.md`, four hits for "stage". Line 133, the Journey stage entry: "with the middle stage reported as thinking". Line 259, the Stage entry: its term "Stage." and two more uses in its text ("the only stage in this package", "a part of learning, or a step in delivering the product, a stage"). That entry exists to say that "stage" is not used for anything but the journey, so it is the rule's own subject; the ruling allows it.

Both documents were built regardless of the finding, a vocabulary finding not being a build failure, and neither needed a rebuild when the ruling came: the ruling changed the check, not the sources, so the documents in the folder are the ones built at 20:18, and the checks on them now pass. If a source later gains another "built", "stage", "designed", "today" or a label "Open", the check fails again for that phrase alone.

What each document contains, as the checks counted it:

| | What it is | Selling it | How it works | Credits | Demos | Glossary |
|---|---|---|---|---|---|---|
| Contents entries (all one level) | 10 | 10 | 18 | 6 | 12 | 22 |
| Headings | 10 | 10 | 18 | 6 | 12 | 22 |
| Bookmarks | 10 | 10 | 18 | 6 | 12 | 22 |
| Numbered lists | 0 | 0 | 0 | 0 | 5 (5, 5, 5, 9, 8 items) | 0 |
| Bulleted lists | 4 | 1 | 2 | 0 | 2 | 0 |
| Tables, with the cover and the one-cell boxes | 4 | 8 | 17 | 10 | 5 | 3 |
| Data tables | 1 | 5 | 9 | 6 | 2 | 0 |
| Table rows, all tables | 18 | 57 | 82 | 40 | 30 | 7 |
| In-document links in the body | 0 | 0 | 50 | 0 | 0 | 0 |
| External links (distinct targets) | 6 (6) | 11 (11) | 4 (4) | 0 | 9 (9) | 0 |
| Figures | 0 | 1 | 2 | 1 | 0 | 0 |
| Words in the build copy (W1's rule) | 2,287 | 3,748 | 4,850 | 1,441 | 2,536 | 4,492 |

The engineers' piece has 50 in-document links, the walk and the detail pointing at each other. The demos piece has five numbered lists, each instance restarting at 1. The glossary has no data table: its three tables are the cover and the two one-cell callouts that carry the rule.

**The checks can fail.** Controls, each run against a deliberately flawed or altered input:

- Check 15 on a small document with the forbidden words and the allowed ones: it flagged "designed", a stray "built", "stage" in "rollout stage", "Today", a bold run that is only "Open", "Open:" at the start of text, a bare "Open" line, a verdict-cell "Open" and a plain "Built" cell; it allowed "built it with us" once and "journey stage" and "journey-stage" twice; it did not flag "Open the console from where you are" or "in the open", which it listed as other uses.
- Check 15, the figure-text branch: a figures folder whose `architecture.svg` carries "designed today" (the PNG byte-identical) produced two hits against the figure.
- Check 15, the allow-list (run at about 20:27 on a small document): it allowed "built it with us" once, "journey stage" and "journey-stage" three times, "built for" twice, "built on" twice, "built once" twice, "middle stage" once, and the paragraph that begins "Stage." (three uses of the word inside it). It still flagged "designed", "built" in "was built last year", "Built into the product", "built in" and "built twice", "stage" in "a rollout stage" and "a stage on its own", and "today": eight hits. (The control has a single heading, which trips check 2 on its own; every real document passes check 2.)
- Check 0: given the unstripped source in place of the build copy, a document fails checks 0, 2, 3, 6 and 7; given a title argument that is not the source's first line, it fails checks 0 and 1 (run on version 1 documents; the check is unchanged).
- Check 11 against the repository's figures: a figures folder whose copy of `architecture.png` differs by one byte makes it fail.
- Check 8, asterisks: a document whose markdown lacks the asterisk the document carries fails it; against its own markdown it passes.
- A dead link is stopped by the converter itself, which writes nothing: "md2docx: … NOT written; … has 1 problem(s): line 3: link "dead" points to #nowhere, but no heading has that anchor". None of the six hit it.

In addition, at 21:54: `unzip -t` reports no errors on all six; a raw scan of every XML and relationship part of the six, freshly unzipped, for the customer names, the owner's family and given names, the user name and local paths finds nothing in any (zero hits in each); the whole-word scan found no customer name. The full output of the 16 checks on the six is saved as `final-check-output-v2b.txt` (after the credits rebuild) and again as `final-check-output-v2c.txt` (at 20:25, against the snapshot taken from HEAD `890d76d`): 94 PASS lines and 2 FAIL, both check 15, and the two runs agree line for line. After the ruling and the demo map's rebuild, the run of 20:29, `final-check-output-v2d.txt`, has 96 PASS lines and no FAIL; after the glossary's rebuild, the run of 20:31, `final-check-output-v2e.txt`, has the same 96 and no FAIL; after round three's rebuild, the run of 21:54, `final-check-output-v2f.txt`, has 96 PASS lines and no FAIL: all six documents pass all 16 checks. In round three the brief's "built it with us" allowance is unused (the marketing piece now says "chose to build it with us" and the sellers' piece no longer carries the quotation); it stays in the check. The allowances in use at 21:54 are "journey stage" (five times in the engineers' piece, six in the glossary), "built for" four times, "built on" once and "built once" once in the engineers' piece, and the "Stage." entry (one paragraph, three uses of the word) in the glossary.

## 5. Page counts

**Method.** W1's `pages.mjs`: greedy line breaking on the real Calibri and Consolas advance widths from `C:\Windows\Fonts`, Word's line height, paragraph spacing, page breaks, keep-with-next, table rows that split at line boundaries and repeating header rows. The tool was in lane W1's session scratchpad and is copied here unchanged; `pages-fill.mjs` is the same model with more lines of output: each page's fill, the page a heading lands on and where a figure lands.

**Calibration, run again at this build.**

- The Word-saved Scope of Services v7, the document W1 used: Word records 7 pages, the model gives 7 (last page 43 %).
- W1's technical note v1.1, built by this converter: 21 pages, the last 98 % full, exactly W1's recorded measure.
- W2's one-pager v1.3: 3 pages, the body page 95 % full, exactly W2's recorded measure.
- The lead's rougher estimator (`pages-c3.mjs`, about ±15 %), run on the build copies, gives 7, 11, 15, 7, 8 and 13, within a page of the model on every document.

It is a layout measurement, not Word's own count: expect Word to differ by about a page. It models the contents as the cached entries without page numbers; Word adds the numbers and no lines.

| Document | Pages | Cover | Contents | Body | Last page filled |
|---|---|---|---|---|---|
| What it is | 7 | 1 | 1 | pp. 3 to 7 | 67 % |
| Selling it | 12 | 1 | 1 | pp. 3 to 12 | 33 % |
| How it works and where it runs | 16 | 1 | 1 | pp. 3 to 16: Part A pp. 3 to 5, Part B pp. 5 to 16 | 71 % |
| Where Opal and AI credits fit | 7 | 1 | 1 | pp. 3 to 7 | 90 % |
| Which demo shows which story | 8 | 1 | 1 | pp. 3 to 8 | 73 % |
| Glossary | 12 | 1 | 1 | pp. 3 to 12 | 35 % |

The credits document is back to 7 pages, the last 90 % full. It had spilled 14 % of a page onto an eighth page at 20:20, when the fixed AI sentence was added; round three's removal of the legend row took the room back. The glossary's last page went from 16 % to 35 % full with its new Gate entry and G heading, and the marketing piece's from 58 % to 67 %; the page counts did not change. Against the 20:31 build: what it is 7 (was 7), selling it 12 (12), how it works 16 (16), credits 7 (8), demos 8 (8), glossary 12 (12). Against version 1: what it is 7 (was 7), selling it 12 (11), how it works 16 (20), credits 7 (9), demos 8 (5), glossary 12 (12).

**Gaps the figures leave.** An inline picture cannot split, so Word moves it, with its caption, to the top of the next page when it does not fit. "Selling it": the architecture figure (7.92 in, near the cap of 8 in) tops page 5 and leaves page 4 at 26 % full. "How it works": the decision-path figure (5.20 in) tops page 11 and the architecture figure tops page 12, leaving pages 10 and 11 at 63 % and 64 %. "Where Opal and AI credits fit": the session figure (4.83 in) tops page 5, and page 4 is 98 % full, so there is no gap. The figure positions are the same as at 20:31 in "Selling it" and "How it works". A wider, shorter architecture figure would close the larger gaps.

## 6. Not verified, and things to know

- **Not machine-verified:** Word's own pagination, following a link with Ctrl+Click, and Save as PDF. Word may not be automated on this machine and there is no LibreOffice. The owner is asked to open "How it works" (50 in-document links, two figures), accept the offer to update fields, Ctrl+Click one contents entry and one link, and try Save as PDF.
- **External link targets** were checked as present and https, not requested over the network (the site sits behind its gate, and the brief is "present").
- **Style.** The documents carry the converter's house look (Calibri; navy `11142A` and blue `0B5CAD`), as every earlier Word deliverable does. That is not the current Optimizely brand set out in the `optimizely-brand` skill (green-led palette; VC Nudge and Die Grotesk, or Roboto as the sanctioned alternative). The fonts and colors are constants in `scripts/md2docx.mjs`, so applying the brand is a converter change for the coordinator to order; I did not change it.
- **Informational scan hits, not failures.** "Selling it" and the demos document name fictional demo screens by their on-screen brands (three in "Selling it", twelve mentions in the demos document), which the common brief allows (demos are named by fictional brand and shown by URL) and which the lead's C3 name list would flag. The glossary's own deprecated entry for "BTIE" is one hit. No customer name and no personal name appears anywhere.
- **Cross-document references.** Where the markdown names another piece with a link, the link is live; the pieces link to the site's pages at `edge-platform-bti.expedge.workers.dev`.
- **Nothing was dropped silently.** The converter ignores any cell beyond a table's header width and drops a lone `|` line. The checks compared every markdown table row with its header's cell count and looked for lone pipe lines: none.

## 7. Process notes

- **Scratch, all in the session scratchpad** (`<w>` as in section 3): `tools\` holds `pieces.txt`, `snapshot-sources.sh` and `build-word.sh` (texts in section 3), `check-docx.mjs` and `check-all.sh` (the checks), `pages.mjs` (W1's, unchanged) and `pages-fill.mjs`; `build\` holds the snapshots (`src\`), the stripped copies the converter read (`content\`) and the figure copies (`figures\`); `dry3\` and `dry3-build\` are the run into scratch; `unz\` holds each document unzipped for the page measure (`v2-…`, `v2b-…`, `v2c-…`, `v2d-Demos` for the demo map of 20:28, `v2e-Glossary` for the glossary of 20:31, `v2f-…` for round three's six documents of 21:54); `retired\v1.0\` holds the seven version 1.0 documents; `superseded\alt-old-covers\` is the set built for the first covers; `neg\`, `neg2\`, `neg3\`, `neg4\`, `neg5\` (the allow-list control), `trial\`, `landscape-try\` are the controls and trials. `final-check-output-v2.txt`, `-v2b.txt`, `-v2c.txt` and `-v2d.txt` are the full output of the checks at 20:18, after the credits rebuild, at 20:25 against the HEAD snapshot, at 20:29 after the ruling and the demo map's rebuild, (`-v2e.txt`) at 20:31 after the glossary's, and (`-v2f.txt`) at 21:54 after round three; `last-built-hashes.txt`, `-2.txt`, `-3.txt` and `-4.txt` hold the source hashes before the snapshots of 20:24, 20:26, 20:31 and 21:54; `dry4\` holds the credits and demos documents rebuilt from that snapshot for the comparison. Nothing there is needed by the repository, and nothing was added to it. If the coordinator wants the build step or the checker kept in the repo, it belongs beside the converter; say so and I will propose a path.
- **Rebuilding.** Run the snapshot, the build and the checks as in section 3, then unzip each document and run `node pages-fill.mjs <dir> --trace`. After a change to a source, to a figure or to the converter, run all of it again; `--only key,key` limits the build and the check to some pieces, and `--working key,key` names a source to take from the working tree.
- **Two slips from earlier rounds, the same kind.** About 14:54, in a command that ran the dry run's snapshot, I included `rm -rf /tmp/none`, a leftover; the path does not exist, so nothing was removed. At 15:04, in a command that ran the demos checks, I included `rm -f /dev/null`, which had no purpose; it failed ("Operation not permitted") and `/dev/null` is intact. The rules forbid deletes, and I should not have typed either. Nothing was deleted. This round I typed no delete command: every file that left `docs/enablement/word/` was moved with `mv -n` and checked by hash.
- **A false alarm, resolved earlier.** My first line-ending count of the sources came back as CRLF on every line: a shell quoting slip in the count, not the files (`od`, `tr -cd '\r'` and `git ls-files --eol` all show LF).
- Git was used read-only (`status`, `log`, `diff`, `show`, `cat-file`, `rev-parse`, `ls-files --eol`, `config --get`). Nothing was installed or killed, and nothing was deployed. The folder `docs/enablement/word/` and this note are the only repository paths written.
