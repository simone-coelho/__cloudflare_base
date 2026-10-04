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

## Version 3.0, 2026-10-03

Lane W2, under `LANE-BRIEF-V3.md` (sections 1, 5, 6 and 7), this note's method, `LANE-BRIEF-COMMON.md`, the design's section 6 and `../verizon/lanes/W4.md`. Paths written: `docs/enablement/figures/shot-*.png` (37 at 10:24 and 10:40, 9 more and 5 replaced at 11:01, 1 more and 14 replaced at 11:15, 21 replaced at 11:57, the band added at 21:58; the folder holds 46 since two stale ones left it, section V3.12), the four `docs/enablement/word/Enablement-*-v3.0.docx`, `scripts/md2docx.mjs` (by the lead's rulings of 10:50, 22:03 and 22:12, sections V3.10, V3.14 and V3.15) and this section, appended. No source, page or partial was edited. Git was used read-only; nothing was installed, deployed or killed, and nothing was deleted; three version 2.0 files were moved out of `docs/enablement/word/` with `mv -n`, as the brief asks (section V3.10).

**Status, 22:20 EDT. Converter rule 16 (the tallest picture 7.5 in, aspect kept; sha-256 `49458ca7…`, proved by paired builds) is in, and all four documents were rebuilt with it and pass all 18 checks: What it is 16 pages (`76ac8094…`), Selling it 17 (`fb092885…`), How it works and where it runs 18 (`b030553e…`), the Battlecard 10 (`0766246c…`). No picture is parted from its heading or lead line in any of them; the edge section now sits whole on page 12 of How it works (section V3.15). The statuses below are kept as they were written.**

**Status, 22:15 EDT. Converter rule 15 (a paragraph a picture follows keeps with it; sha-256 `5e4594f8…`, proved by paired builds) is in, and all four documents were rebuilt with it and pass all 18 checks: What it is 16 pages (`c6bbd8f2…`), Selling it 17 (`98ea88b5…`), How it works and where it runs 19 (`715a9b08…`), the Battlecard 10 (`6112e74f…`). One section still parts its picture from its heading and lead line: How it works, "It runs at the edge, and every setting is a published document", whose run is taller than a page (section V3.14). The statuses below are kept as they were written.**

**Status, 22:05 EDT. Under the brief's section 8 (`6434b4f1`), Selling it and How it works open with the band in place of the spine: its picture `shot-spine-band.png` was captured and placed, and the two documents were rebuilt; every other shot's element is unchanged, the tour's frames included, so their committed files stand (section V3.13). What it is and the Battlecard were not rebuilt, being byte for byte what they were built from. All four pass all 18 checks: What it is 16 pages (`8d6eb9a2…`), Selling it 17 (`93d527fa…`), How it works and where it runs 18 (`2e09ed8b…`), the Battlecard 10 (`adb51ecf…`). The statuses below are kept as they were written.**

**Status, 12:05 EDT. After review round four's fixes (`6aa479f5`) all 45 shots were captured again and 21 changed (section V3.12). Selling it and How it works were rebuilt; What it is and the Battlecard were not, their sources and pictures being byte for byte what they were built from. All four pass all 18 checks: What it is 16 pages (`8d6eb9a2…`), Selling it 20 (`a92316b9…`), How it works and where it runs 22 (`c65c6fa5…`), the Battlecard 10 (`adb51ecf…`). The statuses below are kept as they were written.**

**Status, 11:20 EDT. All four documents are built with the converter as the lead ruled it changed (sha-256 `224fa972…`, proved by paired builds), sit in `docs/enablement/word/` and pass all 18 checks: What it is (16 pages), Selling it (20), How it works and where it runs (22) and the Battlecard (10). The shots of the twice-corrected sellers' and engineers' pages were captured again from `e82925bc` (section V3.11); the two pictures no source names any more are left in place and listed (section V3.10). The three superseded version 2.0 files are moved out, intact. The statuses of 11:06 and 10:46 below are kept as they were written.**

**Status, 11:06 EDT. All four documents are built with the converter as the lead ruled it changed (sha-256 `224fa972…`, proved by paired builds) and sit in `docs/enablement/word/`: What it is (16 pages), Selling it (20), How it works and where it runs (29) and the Battlecard (10). Three pass all 18 checks; Selling it passes 17, failing check 17 in one section, its objections, where the quote card and its two lines come before the first picture (section V3.10, item 6). The shots of the two corrected pages were captured again; the two pictures no source names any more are left in place and listed. The three superseded version 2.0 files are moved out, intact. The status of 10:46 below is kept as it was written.**

**Status, 10:46 EDT. Delivered: the 37 pictures (the 30 the four Word copies name, and the tour's 7), and `Enablement-Battlecard-v3.0.docx`, which passes all 18 checks (the 16 of this note plus two for version 3). Stopped, under the brief's rule ("stop, record exactly what and where, and report it; do not edit the source"): `Enablement-What-It-Is-v3.0.docx`, `Enablement-Selling-It-v3.0.docx` and `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx`. Their sources hold 12 links written inside bold, `**[text](url)**`, a construct the converter does not know: it prints such a line as literal bold markdown, with the address showing and no link (section V3.2). Because those three were not built, their version 2.0 files were not moved (section V3.5).**

### V3.1 The pictures

**How they were captured.** `capture-shots.mjs` (scratch, below) serves a copy of `enablement/site` from its own process the way Workers static assets do, with the site's Content-Security-Policy from `_headers`, and drives headless Chrome 154 on its own profile over CDP, closed with `Browser.close`: 1100 CSS px wide, light scheme, device scale factor 2, `prefers-reduced-motion: reduce`, script on. For each `[data-shot="<name>"]` element it makes the viewport taller than the element, scrolls the element wholly into view, and captures the element's own box (rounded outward to whole pixels), so every picture is pixels on screen. It records the box, the PNG's size, bytes and hash, the element's visible text, and what any descendant paints outside the box. The spine's five pictures come from `what-it-is.html`, the short form's from `battlecard.html`, as the brief says. The tour's frames were captured with script off at load, as lane T1's note asks (with script on, the frames give way to the live board): the page loads with script execution disabled, so its scripts are never run, and only then is evaluation switched back on for the harness's measurements (no `.is-live` element, no script fetched, four requests: the page and its three stylesheets).

**What the captured pages were.** The site copy was taken at 10:18:49 and hashed file by file. The lead's commit `5083fab6` (10:19:06) holds the same pages: 29 of the 32 files are byte-identical to their blobs, and the other three (`how-it-works.html`, `figures/architecture.svg`, `figures/before-during-after.svg`) differ only by carriage returns in the working copy (`core.autocrlf=true`; `git status` clean). At 10:23:20 the live folder still equaled the copy, and the second copy, taken at 10:37:44 for the tour, equaled the first.

**Checks on the pictures.**

- Every element exists once, sits wholly in the viewport at capture, and no visible text runs outside its box. The tool's three kinds of report were each inspected: the walk-through heading's line box starts 0.83 px above its element (the outward rounding includes it); the `mk-stop` spans are 1 px screen-reader full stops; the overflow under `mk-questions` is the answers inside closed `<details>`, laid out but not painted (M2 asked for the questions closed).
- Every caption in the markdown is visible inside its element (quotes folded): 30 of 30, and 7 of 7 for the tour (`shot-report.mjs`).
- No console message, no request outside the origin, no running animation at any capture; "Play again" hidden; every picture at its end state (the watch-it loop with boots first, hero second and the receipt in; the bucket drawings at their last frame).
- All 37 pictures were opened and looked at, whole: no neighbor, no cut-off text.
- The capture is reproducible: a second run of the 30 produced byte-identical PNGs.
- The PNGs carry only `IHDR`, `IDAT` and `IEND` chunks, no text metadata (the seven drawn figures likewise).

| Picture | Element captured | Page | CSS px | PNG px | Bytes | sha-256 (16) | In Word |
|---|---|---|---|---|---|---|---|
| `shot-spine-story.png` | `<div class="spine-story-card">` | what-it-is | 928 x 442 | 1856 x 884 | 126,836 | `aedc0370b2aa297e` | 6.50 x 3.10 in |
| `shot-spine-side-by-side.png` | `<ul class="spine-cards">` | what-it-is | 928 x 531 | 1856 x 1064 | 183,160 | `4bf08260779461e2` | 6.50 x 3.73 in |
| `shot-spine-both-on-one-page.png` | `<div class="spine-both-card">` | what-it-is | 928 x 398 | 1856 x 798 | 79,898 | `a3b795ed1716b4b6` | 6.50 x 2.79 in |
| `shot-spine-watch-it.png` | `<div class="spine-watch-card">` | what-it-is | 928 x 298 | 1856 x 598 | 98,857 | `53975d2be7886086` | 6.50 x 2.09 in |
| `shot-spine-walk-through.png` | `<div class="spine-walk">` | what-it-is | 928 x 237 | 1856 x 476 | 67,816 | `f52da989e89b0f5e` | 6.50 x 1.67 in |
| `shot-spine-compact.png` | `<div class="spine-compact-card">` | battlecard | 1036 x 321 | 2072 x 644 | 110,286 | `f8f5c3637783972c` | 6.50 x 2.02 in |
| `shot-mk-pillars.png` | `<figure class="mk-fig mk-pillars">` | what-it-is | 928 x 1058 | 1856 x 2116 | 423,819 | `e971732847f9ceb0` | 6.50 x 7.41 in |
| `shot-mk-three-steps.png` | `<figure class="mk-fig mk-steps">` | what-it-is | 928 x 366 | 1856 x 732 | 106,585 | `f783e4a3d6277052` | 6.50 x 2.56 in |
| `shot-mk-reasons.png` | `<figure class="mk-fig mk-reasons">` | what-it-is | 928 x 328 | 1856 x 656 | 81,556 | `151eca2cda84105c` | 6.50 x 2.30 in |
| `shot-mk-proof.png` | `<figure class="mk-fig mk-proof">` | what-it-is | 928 x 852 | 1856 x 1706 | 215,839 | `a9b09181d6a2068d` | 6.50 x 5.97 in |
| `shot-mk-say.png` | `<figure class="mk-fig mk-say">` | what-it-is | 928 x 1139 | 1856 x 2280 | 322,548 | `d6f596de034c4e70` | 6.50 x 7.98 in |
| `shot-mk-questions.png` | `<figure class="mk-fig mk-qs">` | what-it-is | 928 x 509 | 1856 x 1020 | 93,446 | `85c5d08989a5a231` | 6.50 x 3.57 in |
| `shot-mk-next.png` | `<figure class="mk-fig mk-next">` | what-it-is | 928 x 349 | 1856 x 700 | 110,865 | `36a2d00881e88be8` | 6.50 x 2.45 in |
| `shot-ae-scenes.png` | `<figure class="ae-board">` | selling-it | 928 x 769 | 1856 x 1540 | 386,716 | `a863213799235965` | 6.50 x 5.39 in |
| `shot-ae-reasons.png` | `<figure class="ae-reasons">` | selling-it | 928 x 695 | 1856 x 1392 | 230,519 | `d4ada48cc10795ea` | 6.50 x 4.88 in |
| `shot-ae-measures.png` | `<figure class="ae-measures">` | selling-it | 928 x 676 | 1856 x 1354 | 266,240 | `5b4e0549aca6c5e8` | 6.50 x 4.74 in |
| `shot-ae-objections.png` | `<figure class="ae-objections">` | selling-it | 928 x 1639 | 1856 x 3280 | 503,426 | `f68bfadf25052ec9` | 4.53 x 8.00 in, held to 8 in |
| `shot-ae-asks.png` | `<figure class="ae-asks">` | selling-it | 928 x 1260 | 1856 x 2520 | 384,318 | `119abcf7a7ba04c9` | 5.89 x 8.00 in, held to 8 in |
| `shot-ae-demos.png` | `<figure class="ae-demos">` | selling-it | 928 x 856 | 1856 x 1714 | 420,727 | `1ec99078b16c964d` | 6.50 x 6.00 in |
| `shot-ae-battlecard.png` | `<figure class="ae-battle">` | selling-it | 704 x 168 | 1408 x 338 | 28,956 | `55e1650b7313e28d` | 6.50 x 1.56 in |
| `shot-bc-pillars.png` | `<figure class="bc-pillars">` | battlecard | 1036 x 296 | 2072 x 594 | 113,532 | `f13cdcd8838d9d90` | 6.50 x 1.86 in |
| `shot-bc-reasons.png` | `<figure class="bc-reasons">` | battlecard | 1036 x 183 | 2072 x 366 | 71,844 | `204ac305663eb93a` | 6.50 x 1.15 in |
| `shot-bc-objections.png` | `<figure class="bc-objs">` | battlecard | 592 x 654 | 1184 x 1310 | 209,717 | `b0f0222fc411efbf` | 6.50 x 7.19 in |
| `shot-bc-discovery.png` | `<figure class="bc-disc">` | battlecard | 414 x 569 | 830 x 1138 | 162,227 | `240d625a16f0d0e2` | 5.83 x 8.00 in, held to 8 in |
| `shot-bc-demos.png` | `<figure class="bc-demos">` | battlecard | 1036 x 180 | 2072 x 364 | 60,389 | `c517dd5104b182e5` | 6.50 x 1.14 in |
| `shot-bc-sentences.png` | `<figure class="bc-fixed-fig">` | battlecard | 1036 x 239 | 2072 x 480 | 99,806 | `0720dbf6a578313b` | 6.50 x 1.51 in |
| `shot-se-reasons.png` | `<figure class="se-reasons">` | how-it-works | 928 x 263 | 1856 x 526 | 61,064 | `02f7d281b2efd794` | 6.50 x 1.84 in |
| `shot-se-instruments.png` | `<div class="se-instruments">` | how-it-works | 928 x 2514 | 1856 x 5030 | 851,990 | `5048dc9d1af5f5cc` | 2.95 x 8.00 in, held to 8 in |
| `shot-se-privacy.png` | `<div class="tbl se-tbl se-privacy">` | how-it-works | 928 x 516 | 1856 x 1036 | 171,177 | `b26d6e524902f9e0` | 6.50 x 3.63 in |
| `shot-se-asks.png` | `<div class="tbl se-tbl se-asks">` | how-it-works | 928 x 979 | 1856 x 1960 | 312,686 | `4a2d9dd5a0dc294d` | 6.50 x 6.86 in |
| `shot-tour-step-1.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 357 | 1130 x 718 | 86,405 | `521345e19a775b01` | no Word copy |
| `shot-tour-step-2.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 336 | 1130 x 672 | 110,094 | `a83e407c1261b70c` | no Word copy |
| `shot-tour-step-3.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 357 | 1130 x 718 | 109,184 | `707edaf9179f0c4a` | no Word copy |
| `shot-tour-step-4.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 357 | 1130 x 716 | 112,498 | `c6ed64106b3a67de` | no Word copy |
| `shot-tour-step-5.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 357 | 1130 x 716 | 118,704 | `aee156e8c9bde223` | no Word copy |
| `shot-tour-step-6.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 357 | 1130 x 718 | 113,605 | `b3fdc77265086ff4` | no Word copy |
| `shot-tour-step-7.png` | `<figure class="tour-still">` | see-it-work (script off) | 565 x 357 | 1130 x 716 | 115,747 | `5ae5ec7b9dbed9a8` | no Word copy |

37 pictures, 7,123,082 bytes. "In Word" is the size the converter gives each picture: the text width (6.50 in) with the aspect ratio kept, unless that is taller than 8 in, when it is set 8 in tall and narrower.

**The tour.** Its page and markdown were complete and consistent when I got there: committed in `5083fab6` with T1's note, and `node enablement/render-check.mjs` passes on it (37 of 37 sentences). I captured its seven frames, script off as T1 asks, and saved them beside the others. The tour has no Word copy, so they are embedded nowhere; the text check now lists no picture as missing.

**Legibility in Word, for the page owners.** Four pictures are taller than the converter allows at text width and print narrower. The text each picture shows also follows it in the document, so nothing is lost, but on paper:

- `shot-se-instruments.png` prints 2.95 in wide; its most common text comes out near 3.4 pt and its smallest near 2.5 pt, too small to read on paper (it is sharp on screen when zoomed). Six shorter pictures, one per instrument card, would print at text width; that is a change to G1's page and markdown.
- `shot-ae-objections.png` prints 4.53 in wide, its text near 5.3 pt; `shot-ae-asks.png` 5.89 in, near 6.9 pt; `shot-bc-discovery.png` 5.83 in, near 14 pt (a narrow element, so it reads well).
- At text width most pictures set their common text at 7 to 9 pt. The smallest labels inside some drawings print at about 4 to 4.5 pt (`mk-next`, `ae-scenes`, `ae-demos`, `bc-demos`).

### V3.2 What stopped the three documents: a link inside bold

The converter's inline grammar (`runs()` in `scripts/md2docx.mjs`) tries bold before a link, so `**[See it work](https://…)**` matches as bold and its inside is printed as it stands. A probe built into scratch with the unchanged converter showed it: the bold-wrapped lines came out as the literal text `[See it work](https://edge-platform-bti.expedge.workers.dev/see-it-work).` and `[Vantage](https://edge-platform-vantage.expedge.workers.dev/vantage/)`, in bold, with no hyperlink, while a plain link beside them was a working link. Built that way, the three documents would show raw markdown, 12 dead links, and host names carrying the abbreviation the design keeps out of visible text. The converter writes no warning for it, so `build-word.sh` now runs a preflight that refuses such a copy before the converter is called, lists every line, and writes nothing for that piece.

| Source (as committed in `5083fab6`) | Line | The construct |
|---|---|---|
| `content/what-it-is.md` | 148 | `- **[See it work](https://edge-platform-bti.expedge.workers.dev/see-it-work).** A guided tour of …` |
| `content/what-it-is.md` | 149 | `- **[How it works, with every constant on a slider](https://edge-platform-bti.expedge.workers.dev/how-it-works-interactive).** The arithmetic …` |
| `content/what-it-is.md` | 150 | `- **[Battlecard](https://edge-platform-bti.expedge.workers.dev/battlecard).** The whole story …` |
| `content/selling-it.md` | 193 | `**[Vantage](https://edge-platform-vantage.expedge.workers.dev/vantage/)**` |
| `content/selling-it.md` | 201 | `**[Vantage's interactive explainer](https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works)**` |
| `content/selling-it.md` | 209 | `**[Top Offers](https://edge-platform-top-offers.expedge.workers.dev/top-offers/)**` |
| `content/selling-it.md` | 217 | `**[Meridian](https://edge-platform.expedge.workers.dev/meridian/)**` |
| `content/selling-it.md` | 225 | `**[The Bright Hour](https://edge-platform.expedge.workers.dev/live/)**` |
| `content/selling-it.md` | 233 | `**[OH](https://edge-platform-oh.expedge.workers.dev/oh/)**` |
| `content/selling-it.md` | 241 | `**[The storefront](https://edge-platform.expedge.workers.dev/storefront)**` |
| `content/selling-it.md` | 249 | `**[Which demo shows which story](https://edge-platform-bti.expedge.workers.dev/demos)**` |
| `content/how-it-works-and-where-it-runs.md` | 190 | `**[How it works, interactive](https://edge-platform-bti.expedge.workers.dev/how-it-works-interactive)**` |

The battlecard and both spines hold none. Nothing else in the six sources is outside the converter's grammar: no HTML, code fence, rule, deeper heading, nested list, tab, figure inside text, single-asterisk italic or carriage return, and every table row has its header's cell count. Two ways to unblock, neither mine: the page owners (M2, A1, G1) drop the bold around those 12 links in the markdown, so each reads `[text](url)` (the page may keep its styling; whether the text check needs anything else is for S1 to confirm), or the coordinator orders a converter change that parses a link inside bold, proved on the existing documents by W4's seeded build pair. Either way the three documents then build with the steps below, unchanged.

### V3.3 The order of the copy: the reader line first

Every page opens with its h1, its reader line, then the spine. The brief composes each copy as "the spine's text … followed by the piece's markdown without its title line, so the document opens the way the page opens". Taken literally, that puts the piece's reader line after the spine, under the walk-through's last frame, which is not how the page opens. So the copy is composed in the page's order (`compose.mjs`): the piece's lines between its title and its first `##` (the reader line), then the spine less its title line and the blank line after it, then the piece from its first `##` on, one blank line at each join. Nothing is added, dropped or reworded, and check 0 proves it against both sources; a control built the literal way fails checks 0 and 6. On the battlecard the copy opens with the reader line, then the short form's picture and its lines (the short form has no `##`, so it sits before the first section and the contents list), then the six sections. If the lead wants the literal order, it is a one-line change in `compose.mjs` and a rebuild.

### V3.4 The document built

Built at 10:34 EDT with the unchanged converter (`scripts/md2docx.mjs`, sha-256 `0b2159ee053a1055`, equal to HEAD), `docx` 9.7.2 from `~/.md2docx` and Node 22.15.0 in WSL Ubuntu-22.04. The sources were taken from the working tree, as the brief says; by the time of the snapshot (10:30:59) the lead had committed them, and each working copy equals its blob at `5083fab6` (no carriage returns). The cover per the design's section 6: the title is the piece's first line, verbatim; the subtitle is the reader line alone; version "3.0", bare; the build date; "Internal: Optimizely only".

| Word document | Cover | Sources, sha-256 | Document | Pages |
|---|---|---|---|---|
| `Enablement-Battlecard-v3.0.docx` | "Behavioral Targeting and Intelligence: battlecard"; "For account executives"; Prepared for: Account executives; Version: 3.0; Date: October 3, 2026 | `battlecard.md` `2e0d099de412f3be1cd665b9acb0800d276aa19f94f193512a00794b7525db98`; `spine-compact.md` `aedd6042be556d9876fe678a5e080461bbf682feba464589f3425acbe9315abc` | 811,946 bytes, sha-256 `c96a8ce2ca30df32bc739f4d802e96cea7e3143da96440f4eb77c01e29293380` | 10 |

What it holds, as the checks counted it: 6 contents entries (all `##`, linked), 6 headings and 6 bookmarks, 7 pictures (all captured; 6 at text width, `shot-bc-discovery.png` held to 8 in), 3 bulleted lists, 1 data table, 7 external links (the demos), 0 in-document links, 88 text blocks, 921 words in the copy. In its XML: 7 `w:drawing` elements, 7 image relationships, 7 media files, each byte-identical to its PNG; "3.0" once in `word/document.xml` (the cover's Version cell) and once in the running footer.

The other sources, hashed at the same snapshot for the documents still to build (each equal to its blob at `5083fab6`): `what-it-is.md` `9708d0cf2581def067107f952734666d3f505d0d05ad528a982cda8ed2bf31cc`, `selling-it.md` `90c4c9e311517909680d7856e9cbae89c75147be68ca3d5efdb3d0c9c3f51321`, `how-it-works-and-where-it-runs.md` `71c52892b55367c2d2b76743f163ade196aff60dff1648fbee51021d820a5c07`, `spine.md` `a6a59bc852d5b7bf0928c1ea07dedc3c8f07cd74c18fb82849628c0202a5645a`. The drawn figures the engineers' copy names are tracked and equal HEAD: `se-signal-chain.png` `fd43b42be6a38a34`, `decision-path.png` `9816ac3f772e1730`, `se-learning-and-receipt.png` `3295907ea4d34e22`, `architecture.png` `466c9e12146e6a6c`, `se-published-documents.png` `1d59e70302a91b18`, `se-integration.png` `a3c4c2492b03d564`.

**What ran** (`<w3>` is `C:\Users\LAH\AppData\Local\Temp\claude\C--Users-LAH-Documents---Development-Optimizely---cloudflare-base\6d912628-2c4c-48d2-9676-33d6a79a76ce\scratchpad\w3`, in its Git Bash or WSL spelling):

```
node <w3>/tools/capture-shots.mjs --site <w3>/site-snapshot-1 --out <w3>/shots-run2 --plan "<page>:<shot>,…"
node <w3>/tools/capture-shots.mjs --site <w3>/site-snapshot-2 --out <w3>/shots-tour --plan "see-it-work!noscript:tour-step-1,…"
node <w3>/tools/shot-report.mjs <w3>/shots-run2/shots.json docs/enablement/content/<the six sources>
bash <w3>/tools/snapshot-sources.sh
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash <w3>/tools/build-word.sh --out <w3>/dry/word --allow-unknown"
bash <w3>/tools/check-all.sh <w3>/dry/word <w3>/build
wsl.exe -d Ubuntu-22.04 -e bash -lc "bash <w3>/tools/build-word.sh"
bash <w3>/tools/check-all.sh docs/enablement/word <w3>/build --only battlecard
```

The real build printed "md2docx: wrote …/Enablement-Battlecard-v3.0.docx, 793 KB, 86 blocks from 139 markdown lines" and, for the other three, "NOT built (stop and report)" with their lines; the converter printed no warning. The battlecard built into scratch first and the one in the folder are equal part by part, once the converter's random link ids are renumbered and the build time set aside (rule 13).

### V3.5 The superseded version 2.0 files: not moved

The brief asks for the three version 2.0 files of the marketing, sellers' and engineers' pieces to be moved out with `mv -n`. Their version 3.0 replacements were not built (section V3.2), and moving them would leave the folder with no Word copy of those pieces, so I left them in place: the move belongs with the rebuild. Nothing in the folder was moved or changed but the new battlecard. The six version 2.0 files hash as section 1 records: What-It-Is `2d6fd285a1fefe6d`, Selling-It `9070b93553902422`, How-It-Works `9c7062fa3c7a4ad2`, Credits `d22c979ce42b338f`, Demos `f440d4707df6eeb9`, Glossary `6ad12ffe19bf1629`. The glossary, credits and demo map files stay, as the brief says.

### V3.6 The checks

`check-docx.mjs` is this note's checker, copied to `<w3>/tools` and adapted (the copy in `w\tools` is unchanged). Changed for version 3:

- **Check 0** takes `--spine` and proves the composed copy (section V3.3) against both sources: the order, every non-blank line once, nothing else.
- **Check 1** also counts the version: once in `word/document.xml`, once in the footer.
- **Check 11** accepts the converter's cap: at the text width with the aspect ratio kept, or exactly 8 in tall and narrower; never wider than the text width (the widest figure is reported).
- **Check 12** also scans what every embedded picture shows (a captured picture's element text, a drawn figure's SVG text) and every XML and relationship part read raw (text and attribute values), for the pronouns, the customer names, the C3 list, the owner's and user's names and local paths, and every part's text for dashes. A dash in markup is reported apart: the converter's numbering defines an en-dash bullet for a second-level list, and the check fails if any list paragraph sits below the first level.
- **Check 15** reads the pictures' text too, and allows the spine's verbatim heading "What we built" and headline "We built an engine …" (`LANE-BRIEF-V3.md` section 3), counted.
- **Check 16 (new):** every picture line resolves to a PNG in `docs/enablement/figures`, each is embedded byte for byte, and no other media part exists.
- **Check 17 (new), the owner's rule 3:** every section has a picture, opens with it and its caption, and no paragraph, list item or quotation line is over 60 words (120 in the engineers' document); table cells are reported, not budgeted.

**Results on `Enablement-Battlecard-v3.0.docx`: 18 of 18 pass** (`final-check-output-v3.txt`). Pronouns, customer names and the C3 list: 0 in the body, headers, footers, properties, the seven pictures' text and every package part. Informational only: "The Bright Hour", a fictional demo name, twice. Vocabulary: 0 hits; "We built an engine" allowed 3 times (the caption, the headline, the picture). Rule 3: the six sections open with their pictures; the longest running text is 33 words. `unzip -t`: no errors.

**Controls**, each a deliberately flawed input against the real document, all failing where they should while the unchanged inputs pass 18 of 18: the copy composed the literal way (fails 0 and 6); the copy less one line (0 and 6); the version argument "2.0" (1); a figure forged wider than the text width (11); a held figure forged taller than 8 in (11); a picture whose text gains a gendered pronoun and two state words (12 and 15); a customer name hidden in a style attribute (12, through the raw-part scan); a picture whose text says "built" outside the allowances (15); a figures folder lacking one picture (0, 11, 12, 15, 16); a stray media part (16); a word budget of 20 (17).

### V3.7 The three blocked documents, built into scratch for diagnosis

So that the next round fixes everything at once, the three were built into `<w3>\dry\word\` with `--allow-unknown` (which refuses the repository's folder) and checked. Not delivered.

| Document (scratch) | Bytes | Pages | Checks | What fails |
|---|---|---|---|---|
| What it is | 1,844,509 | 16 | 15 of 18 | 8 and 10, the 3 bold links; 17, one section |
| Selling it | 2,684,825 | 19 | 15 of 18 | 8 and 10, the 8 bold links; 17, one section |
| How it works and where it runs | 3,852,159 | 19 | 15 of 18 | 8 and 10, the 1 bold link; 17, eight sections |

Rule 3 (check 17), read against them; no running text is over its budget in any (longest: 51, 38 and 77 words):

- In all three, the spine's own "Both engines on one page" opens with its 13-word lead before its picture, as `spine.md` and the brief's block 3 order it. The battlecard's short form has no such lead.
- In the engineers' document, seven sections open with text before the picture: "One visitor's first click …" (42 words), "Six quantities …" (77), "Learning waits behind the dial …" (17 and 23), "It runs at the edge …" (39, 32 and 21), "The site connects once …" (51), "Every ask says …" (16) and the spine's section above. One has no picture at all: "The interactive page puts every constant on a slider" (a link and one sentence of 29 words). The page shows a card there; the markdown has no picture line for it.

Everything else passes in all three: the pronoun and name scans at zero across every part and picture, the vocabulary, every picture embedded byte for byte at its size, the contents linked, every heading bookmarked, every table at full width.

### V3.8 The page layout of the battlecard

W1's model (`pages-fill.mjs`, unchanged; about a page either way against Word) gives 10 pages: the cover, the contents, the body on pages 3 to 10, the last 40 % full. Four of the six section headings land at the foot of a page with their picture at the top of the next (pages 3, 5, 7 and 9), and page 5 is 18 % full, because the objections picture (7.19 in) cannot follow its heading there. The cause is the converter's, not the source's: the heading styles it writes (`Heading1` to `Heading6`, from the `docx` package's defaults) carry no keep-with-next, and the heading paragraphs do not set it, so Word is free to end a page after a heading. A converter change (keep-with-next on each heading) would hold them together; it is for the coordinator to order, like the brand fonts in section 6.

### V3.9 What I could not honor, and process notes

- **Three of the four documents were not built**, by the brief's own stop rule (section V3.2), and so **their version 2.0 files were not moved** (section V3.5).
- **The order of the copy** follows the page, reader line first, rather than the brief's literal "spine, then the piece" (section V3.3).
- **Two slips, both harmless, both recorded.** At 10:26, a probe command included `rm -rf unz` on a scratch subfolder that did not yet exist, so nothing was removed; the rules forbid typing it, and every later step used a fresh folder name instead. Earlier, checking Chrome's version, I ran `chrome.exe --version` on Windows, which does not print a version but hands off to the running browser ("Opening in existing browser session"); it may have opened an empty window in the owner's Chrome. Every capture afterwards used headless Chrome on its own scratch profile.
- **Not machine-verified:** Word's own pagination, Ctrl+Click on a contents entry, and Save as PDF (as in section 6). External link targets were checked as present, https and External, not requested.
- **For the review lane:** the spine's pictured carousels read "Recommended for you", the carousel's own title under the lead's `data-ui-label` ruling; the Word copies carry it in the pictures and, in the three full-spine copies, in text. The Word checks scan for gendered pronouns, not for "you".
- **Scratch, all in `<w3>`:** `tools\` (`capture-shots.mjs`, `shot-report.mjs`, `pieces.txt`, `snapshot-sources.sh`, `compose.mjs`, `build-word.sh`, `check-docx.mjs`, `check-all.sh`, `forge.py`, and W1's `pages.mjs` and `pages-fill.mjs`, unchanged); `site-snapshot-1\` and `site-snapshot-2\` with their `.sums`; `shots\` and `shots-run2\` (the two identical runs, with `shots.json`), `shots-tour\`, `trial-shots\`; `build\` (`src\` the snapshots, `content\` the composed copies, `figures\`); `dry\word\` (the diagnostics); `unz\` (the documents unzipped for the page model); `neg\` (the controls); `probe\` (the bold-link probe); the logs `capture-1.log`, `capture-2.log`, `capture-tour.log`, `snapshot-1.txt`, `dry-check-1.txt`, `dry-check-2.txt`, `final-check-output-v3.txt`, `shot-report.txt`, `shot-report-tour.txt`, `word-folder-hashes.txt`; and `retired\v2.0\`, made for the moves and left empty. Nothing there is needed by the repository.

### V3.10 The lead's rulings, and the work they ordered (10:50 to 11:05)

The lead ruled on the report of 10:46: change the converter, minimally, for a link inside bold and for headings that keep with what follows them (`scripts/md2docx.mjs` added to this lane's paths for that purpose); read check 17 as the design's rule 5 reads the owner's rule; build What it is and move its version 2.0 file. Then pages corrected by A1 and G1 were committed (`3c3e5418`, 10:56:35), and the lead asked for their shots to be captured again, Selling it and How it works to be rebuilt, all 18 checks to be run on all four documents, and the remaining version 2.0 files to be moved. The reader line's place and the tour's frames captured with script off were accepted.

**1. The converter.** Two changes and a header rule, nothing else (`git diff`: 16 insertions, 7 deletions, of which 5 lines are rule 14's comment). `runs()`: when a bold span holds a link, its inside is laid out again with bold on, so the text around the link stays bold and the link becomes a hyperlink whose run is bold too; a bold span without a link takes the old path unchanged, and a link outside bold gets no new property. `heading()`: every heading paragraph carries `keepNext`. sha-256 `224fa972560ffc4881499bc92bc2a8465f733dcb04db66290996c203f2e715d8`, where it was `0b2159ee053a1055…` (HEAD `7190647f`); the lead commits it with the documents.

**Proved with paired builds in scratch** (`<w3>\conv\`): the converter at HEAD and the changed one, each with a seeded `Math.random` preloaded (rule 13; the `docx` package draws its ids from `nanoid/non-secure`), over 12 inputs: a probe with a bold link in each place one can sit (a list item ending in a bold full stop, a bold line, a link inside bold text, an internal link inside bold, a table cell, a quotation, beside plain bold and plain links), the four version 3 copies, the six version 2 build copies of section 3, and W4's own proof document, the technical note. `compare-pair.py` replaces every relationship id with its target, so no random id can make a difference, and compares the two builds part by part and block by block:

- Every heading of every document gained keep-with-next: 157 headings, none had it before.
- The eight documents without a bold link (the Battlecard, the six version 2 documents, the technical note): no other difference in any part; every part but `document.xml`, its relationships and `core.xml` byte-identical; `core.xml` equal but for its build time; no relationship added or removed.
- The three version 3 documents with bold links, and the probe: exactly the bold-link paragraphs differ (3 in What it is, 8 in Selling it, 1 in How it works, 6 in the probe), each now a bold hyperlink carrying only its text, with no `](` or `**` left; the only relationships added are those links' addresses; no other block differs. In the XML the link's run has `w:b`, the link color `0B5CAD` and the underline, the full stop after it stays bold, and the rest of the line is plain.

**The Battlecard rebuilt** at 10:56 with the changed converter, from the same composed copy: against the 10:34 document, the only differences are the six `<w:keepNext/>` on its headings (78 characters of `document.xml`); every other part is identical and `core.xml` differs only in its build time. Now 811,941 bytes, sha-256 `adb51ecf0b260c27f949fa041a2d4f403a73f9d414b0bb520e4d38cb77a9cb82`.

**2. The checks.** Check 17 now allows a section to open with its heading and one plain lead line (one paragraph) before its picture; a section must have a picture, and anything more before it fails. The spine's "Both engines on one page" passes. Check 6's copy of the converter's grammar learned rule 14 (a link inside bold is its text), and check 7 now also requires every heading to keep with the next paragraph. Two controls added: the 10:34 Battlecard fails check 7 (0 of 6 headings keep with the next); the What it is built by the old converter at 10:31 fails checks 6, 7, 8 and 10. The build step's preflight now refuses only a link inside single-asterisk italic, which the converter still prints as markdown; no source has one.

**3. What it is**, built at 10:56:58 from sources equal to `5083fab6` (`what-it-is.md` `9708d0cf…`, `spine.md` `a6a59bc8…`, as in section V3.4): 18 of 18. Its three bold links are bold links; its 12 headings keep with what follows them.

**4. The shots of the corrected pages.** The site copy taken at 10:58:07 equals `3c3e5418` file by file (line endings aside); against the first copy only `selling-it.html`, `selling-it.css`, `how-it-works.html` and `how-it-works.css` changed, so the spine, marketing, battlecard and tour pictures stand. The 18 shots the two pages name were captured as in section V3.1, all wholly in view, nothing outside their boxes, no console message, no running animation; every caption visible inside its element; a second run byte-identical, 18 of 18; the 14 new or changed ones looked at, whole. The previous files are kept in `<w3>\prev-shots\`.

| Picture | Element captured | CSS px | PNG px | Bytes | sha-256 (16) | Against the 10:24 file | In Word |
|---|---|---|---|---|---|---|---|
| `shot-ae-scenes.png` | `<figure class="ae-board">` | 928 x 769 | 1856 x 1540 | 386,716 | `a863213799235965` | identical | 6.50 x 5.39 in |
| `shot-ae-reasons.png` | `<figure class="ae-reasons">` | 928 x 695 | 1856 x 1392 | 230,519 | `d4ada48cc10795ea` | identical | 6.50 x 4.88 in |
| `shot-ae-measures.png` | `<figure class="ae-measures">` | 928 x 676 | 1856 x 1354 | 266,240 | `5b4e0549aca6c5e8` | identical | 6.50 x 4.74 in |
| `shot-ae-objections-1.png` | `<div class="ae-objs-part">` | 928 x 851 | 1856 x 1704 | 266,925 | `87b82cedd04a5661` | new | 6.50 x 5.97 in |
| `shot-ae-objections-2.png` | `<div class="ae-objs-part">` | 928 x 647 | 1856 x 1296 | 207,089 | `bdb13560752f9c71` | new | 6.50 x 4.54 in |
| `shot-ae-asks.png` | `<figure class="ae-asks">` | 928 x 1260 | 1856 x 2520 | 384,264 | `04a77e5afb7ae461` | changed | 5.89 x 8.00 in, held to 8 in |
| `shot-ae-demos.png` | `<figure class="ae-demos">` | 928 x 856 | 1856 x 1714 | 420,707 | `1a538953fb64cafc` | changed | 6.50 x 6.00 in |
| `shot-ae-battlecard.png` | `<figure class="ae-battle">` | 704 x 168 | 1408 x 338 | 28,984 | `ac400a6b88ea1023` | changed | 6.50 x 1.56 in |
| `shot-se-reasons.png` | `<figure class="se-reasons">` | 928 x 263 | 1856 x 526 | 61,064 | `02f7d281b2efd794` | identical | 6.50 x 1.84 in |
| `shot-se-instrument-interest.png` | `<li class="se-card">` | 456 x 615 | 912 x 1234 | 106,263 | `fa0ddb56d647aaf1` | new | 5.91 x 8.00 in, held to 8 in |
| `shot-se-instrument-decay.png` | `<li class="se-card">` | 456 x 541 | 912 x 1084 | 96,172 | `f7406988371d1d21` | new | 6.50 x 7.73 in |
| `shot-se-instrument-entry-release.png` | `<li class="se-card">` | 456 x 632 | 912 x 1264 | 125,439 | `3f6943c1899f8181` | new | 5.77 x 8.00 in, held to 8 in |
| `shot-se-instrument-score.png` | `<li class="se-card">` | 456 x 1103 | 912 x 2206 | 242,168 | `cd12c7f2faee4fff` | new | 3.31 x 8.00 in, held to 8 in |
| `shot-se-instrument-prior.png` | `<li class="se-card">` | 456 x 680 | 912 x 1362 | 134,260 | `0af331b99c6b745b` | new | 5.36 x 8.00 in, held to 8 in |
| `shot-se-instrument-cap-pin.png` | `<li class="se-card">` | 456 x 830 | 912 x 1662 | 193,282 | `12db4c52b35ee839` | new | 4.39 x 8.00 in, held to 8 in |
| `shot-se-privacy.png` | `<div class="tbl se-tbl se-privacy">` | 928 x 516 | 1856 x 1034 | 171,172 | `1ae4e5288cbfc6f3` | changed | 6.50 x 3.62 in |
| `shot-se-asks.png` | `<div class="tbl se-tbl se-asks">` | 928 x 979 | 1856 x 1960 | 315,057 | `7b70913996e94f8a` | changed | 6.50 x 6.86 in |
| `shot-se-next.png` | `<div class="se-linkcard">` | 668 x 151 | 1338 x 304 | 44,373 | `ac7327559c2a9840` | new | 6.50 x 1.48 in |

The five changed files replace those of the table in section V3.1. Measured pixel by pixel (`pngdiff.py`, standard library only): `ae-asks`, `ae-demos` and `ae-battlecard` differ in 849, 251 and 236 scattered antialiasing pixels (0.02 % or less), their sections having moved down the page; `se-privacy` is 2 device pixels shorter, from rounding at its new offset; `se-asks` differs in its caption and header rows, where G1 wrote the caption as a sentence. The per-card pictures cure the legibility finding of section V3.1: the instrument cards print with their common text at 7.3 to 15.4 pt, where the group picture gave about 3.4 pt.

**Left in place, as the lead asked, and named by no source now:** `docs/enablement/figures/shot-se-instruments.png` (851,990 bytes, `5048dc9d1af5f5cc`) and `docs/enablement/figures/shot-ae-objections.png` (503,426 bytes, `f68bfadf25052ec9`). The folder holds 46 shot files: the 44 the sources and the tour name, and these two.

**5. Selling it and How it works**, rebuilt at 11:01:36 with the changed converter from sources equal to `3c3e5418`: `selling-it.md` `8b868c6879c2ee08ec8bf0b4052330be3e301323898a47310c1db5beb8330cc7`, `how-it-works-and-where-it-runs.md` `41e344871d7b9c73baf9163da01f1944fd16d46119c65b314034b0cdc147566a`, each with `spine.md` `a6a59bc8…`. The converter printed no warning.

**6. All 18 checks on all four documents** (`final-check-output-v3b.txt`, with every picture's text from the merged capture records, each matched to its file in the folder):

| Word document | Bytes | sha-256 | Pages | Checks | Headings keeping with the next | Pictures | External links |
|---|---|---|---|---|---|---|---|
| `Enablement-What-It-Is-v3.0.docx` | 1,844,626 | `8d6eb9a2e1da1b6426d81cb154bad40f40f82eee8ed5d56a0615e12f1da9d7f7` | 16 | 18 of 18 | 12 of 12 | 12 | 4 |
| `Enablement-Selling-It-v3.0.docx` | 2,659,080 | `0337a88c2b3b1bdc9a80a44cd2640f6eb895a5637c9330b54fd7f1b05266e400` | 20 | 17 of 18 | 12 of 12 | 13 | 12 |
| `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` | 3,941,303 | `5830ba4b1c886a16462405ca98485ed1d76c1957df650671a013f0564b3c5fef` | 29 | 18 of 18 | 13 of 13 | 21 (15 captured, 6 drawn) | 2 |
| `Enablement-Battlecard-v3.0.docx` | 811,941 | `adb51ecf0b260c27f949fa041a2d4f403a73f9d414b0bb520e4d38cb77a9cb82` | 10 | 18 of 18 | 6 of 6 | 7 | 7 |

In all four: the pronoun, customer-name and C3 scans at zero in the text, in every picture's text and in every package part read raw; no vocabulary hit (the allowances counted as before); every picture line embedded byte for byte, none wider than the text width; "3.0" once in `word/document.xml` and once in the footer; a linked contents of every section; `unzip -t` clean.

**The one failure: Selling it, check 17.** "Objections have short, true answers" opens with its 14-word lead line, then the quote card and its two lines (20 and 10 words), and only then `shot-ae-objections-1.png`: more than one lead line before the picture, in the order A1 chose and the committed source has (lines 75 to 81 of `selling-it.md`, before the picture at line 83). Moving the quote card and its two lines after the two pictures, or giving the quote card a picture of its own as the section's first, would pass; that is A1's change, then a rebuild of this one document. Everything else in Selling it passes, and How it works now passes rule 3 with six sections opening on one lead line.

**7. The moves.** With `mv -n` into `<w3>\retired\v2.0\`, each hash equal before and after, nothing deleted: `Enablement-What-It-Is-v2.0.docx` at 10:57:28 (19,976 bytes, `2d6fd285a1fefe6d…`), `Enablement-Selling-It-v2.0.docx` at 11:03:43 (543,293 bytes, `9070b93553902422…`) and `Enablement-How-It-Works-and-Where-It-Runs-v2.0.docx` at 11:03:44 (832,009 bytes, `9c7062fa3c7a4ad2…`). The glossary, credits and demo map version 2.0 files stay, unchanged by hash.

**8. Pages.** Keep-with-next did what it was for: every heading in all four documents sits above its picture (W1's model, which honors it). Gaps remain where a tall picture cannot follow the text before it. In the Battlecard, page 5 holds only the end of the reasons list (18 %). In How it works, which now runs 29 pages, each instrument card's picture is held to about 8 in, so each card takes a page for its picture and spills the end of its text onto the next: pages 11, 13, 15 and 19 are 8 to 13 % full, and the companion card's last line makes a page 29 that is 2 % full. On the page the cards sit two to a row at 1100 px (456 px each); one card to a row would print each at text width and about half the height, which is a choice for G1 and the lead.

### V3.11 The last two page corrections (11:12 to 11:20)

The lead committed `e82925bc` (11:12:13): on `/how-it-works` the six instrument cards sit one per row, landscape from 760 px up, with the same shot names and captions; on `/selling-it` the quote card is the objections section's first picture, `data-shot="ae-objections-quote"`, its picture line right after the section's lead. The lead asked for every shot the two pages name to be captured again from the committed tree, the two documents rebuilt with the changed converter, and all 18 checks run on all four.

**The shots.** The site copy taken at 11:13:31 equals `e82925bc` file by file (line endings aside); against the copy of 10:58 only `selling-it.html`, `selling-it.css`, `how-it-works.html` and `how-it-works.css` changed. The 19 shots the two pages now name were captured as in section V3.1: all wholly in view, nothing outside their boxes, no console message, no running animation; every caption visible inside its element (19 of 19); a second run byte-identical (19 of 19). The new picture and the six cards were looked at, whole: complete, nothing cut off.

| Picture | Element captured | CSS px | PNG px | Bytes | sha-256 (16) | Against the 11:01 file | In Word |
|---|---|---|---|---|---|---|---|
| `shot-ae-scenes.png` | `<figure class="ae-board">` | 928 x 769 | 1856 x 1540 | 386,716 | `a863213799235965` | identical | 6.50 x 5.39 in |
| `shot-ae-reasons.png` | `<figure class="ae-reasons">` | 928 x 695 | 1856 x 1392 | 230,519 | `d4ada48cc10795ea` | identical | 6.50 x 4.88 in |
| `shot-ae-measures.png` | `<figure class="ae-measures">` | 928 x 676 | 1856 x 1354 | 266,240 | `5b4e0549aca6c5e8` | identical | 6.50 x 4.74 in |
| `shot-ae-objections-quote.png` | `<div class="ae-quote-part">` | 928 x 190 | 1856 x 382 | 52,679 | `3b1fb0ab80311a47` | new | 6.50 x 1.34 in |
| `shot-ae-objections-1.png` | `<div class="ae-objs-part">` | 928 x 851 | 1856 x 1704 | 266,811 | `bad3d024ebb3c74a` | changed | 6.50 x 5.97 in |
| `shot-ae-objections-2.png` | `<div class="ae-objs-part">` | 928 x 647 | 1856 x 1296 | 207,935 | `5048b5b5ee9bc759` | changed | 6.50 x 4.54 in |
| `shot-ae-asks.png` | `<figure class="ae-asks">` | 928 x 1260 | 1856 x 2520 | 384,350 | `c092008c31d35735` | changed | 5.89 x 8.00 in, held to 8 in |
| `shot-ae-demos.png` | `<figure class="ae-demos">` | 928 x 856 | 1856 x 1714 | 420,729 | `b518c87024cb28ec` | changed | 6.50 x 6.00 in |
| `shot-ae-battlecard.png` | `<figure class="ae-battle">` | 704 x 168 | 1408 x 338 | 28,971 | `6654ad925aef7053` | changed | 6.50 x 1.56 in |
| `shot-se-reasons.png` | `<figure class="se-reasons">` | 928 x 263 | 1856 x 526 | 61,064 | `02f7d281b2efd794` | identical | 6.50 x 1.84 in |
| `shot-se-instrument-interest.png` | `<li class="se-card">` | 928 x 361 | 1856 x 724 | 107,432 | `c4f387d253c3ac56` | changed | 6.50 x 2.54 in |
| `shot-se-instrument-decay.png` | `<li class="se-card">` | 928 x 357 | 1856 x 716 | 98,937 | `b1185e17bbc9ddf5` | changed | 6.50 x 2.51 in |
| `shot-se-instrument-entry-release.png` | `<li class="se-card">` | 928 x 380 | 1856 x 762 | 127,676 | `372dd2d236ba1313` | changed | 6.50 x 2.67 in |
| `shot-se-instrument-score.png` | `<li class="se-card">` | 928 x 580 | 1856 x 1162 | 240,558 | `5df9d99cdb6b38f6` | changed | 6.50 x 4.07 in |
| `shot-se-instrument-prior.png` | `<li class="se-card">` | 928 x 425 | 1856 x 852 | 133,807 | `6b2584c9eff8c59b` | changed | 6.50 x 2.98 in |
| `shot-se-instrument-cap-pin.png` | `<li class="se-card">` | 928 x 521 | 1856 x 1044 | 197,103 | `b43c9248a7d59665` | changed | 6.50 x 3.66 in |
| `shot-se-privacy.png` | `<div class="tbl se-tbl se-privacy">` | 928 x 516 | 1856 x 1034 | 171,154 | `511c30565a3ebc51` | changed | 6.50 x 3.62 in |
| `shot-se-asks.png` | `<div class="tbl se-tbl se-asks">` | 928 x 979 | 1856 x 1960 | 315,047 | `aa2ecb0e7f487d39` | changed | 6.50 x 6.86 in |
| `shot-se-next.png` | `<div class="se-linkcard">` | 668 x 151 | 1338 x 304 | 44,359 | `31cdb1bd0620b358` | changed | 6.50 x 1.48 in |

**What changed, against the files placed at 11:01:** one new (`ae-objections-quote`); fourteen changed; four identical (`ae-scenes`, `ae-reasons`, `ae-measures`, `se-reasons`). Six of the fourteen are the cards in their new layout, each now at text width and 2.51 to 4.07 in tall, with their common text at 7.1 to 7.6 pt and their smallest at 5.5 pt. The other eight only moved on their pages, with the same visible text and size: `ae-objections-1`, `ae-objections-2`, `ae-asks`, `ae-demos`, `ae-battlecard`, `se-privacy` and `se-next` differ in 111 to 1,013 scattered antialiasing pixels (0.05 % or less); `se-asks` differs in 4.6 % of its pixels, in bands along its text rows, because it now sits at a different fractional offset (y .77 became .86) and every text row is antialiased anew. The previous files are kept in `<w3>\prev-shots-2\`. The folder holds 47 shot files: the 45 the sources and the tour name, and the two stale pictures of section V3.10, still left in place.

**The documents.** Rebuilt at 11:16:22 with the changed converter (`224fa972…`) from sources equal to HEAD `e82925bc`: `selling-it.md` `6630c6bce52e0af223ff0479734f51fd47d777dd5b5fe7ef68e014234c6deee5` (changed in that commit), `how-it-works-and-where-it-runs.md` `41e344871d7b9c73…` (unchanged since `3c3e5418`; only its pictures changed), each with `spine.md` `a6a59bc8…`. The converter printed no warning. What it is and the Battlecard were not rebuilt: their sources and pictures are unchanged, and their files are the ones of section V3.10.

| Word document | Bytes | sha-256 | Pages | Checks |
|---|---|---|---|---|
| `Enablement-What-It-Is-v3.0.docx` | 1,844,626 | `8d6eb9a2e1da1b6426d81cb154bad40f40f82eee8ed5d56a0615e12f1da9d7f7` | 16 | 18 of 18 |
| `Enablement-Selling-It-v3.0.docx` | 2,709,590 | `00e0fc150ef854710ed4d914efb79449fe55380a40be1410e492c65c7c2bee75` | 20 | 18 of 18 |
| `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` | 3,953,750 | `49382a0c7d8238fdd9d22e9265ce65b963b8df94ee5fb636b1dc49ae971c9759` | 22 | 18 of 18 |
| `Enablement-Battlecard-v3.0.docx` | 811,941 | `adb51ecf0b260c27f949fa041a2d4f403a73f9d414b0bb520e4d38cb77a9cb82` | 10 | 18 of 18 |

**All 18 checks pass on all four** (`final-check-output-v3c.txt`, the pictures' text from the merged capture records, 40 records each matched to its file). Selling it's objections section now opens with its 14-word lead and then `shot-ae-objections-quote.png`, so check 17 passes. How it works has no picture held to 8 in any more; its widest picture is the text width. In all four the scans are at zero across the text, every picture's text and every package part; every heading keeps with the next paragraph; every picture line is embedded byte for byte; "3.0" reads once in `word/document.xml`; `unzip -t` is clean.

**Pages** (W1's model). How it works runs 22 pages, where it ran 29. Its two sparsest body pages:

- Page 15 is 8 % full. It holds only the heading "It runs at the edge, and every setting is a published document" and its one lead line: the architecture figure after them is 7.92 in tall, nearly a page, and cannot follow them, so it opens page 16. No keep-with-next could seat them together: by W1's model the heading and lead line take about 52 pt, the figure with its spacing about 579 pt and its caption about 21 pt, some 652 pt in all, more than the 648 pt a page holds. Only a shorter architecture figure (D1's drawing) would close this gap.
- Page 22 is 2 % full. It is the companion card's link line, after its picture and caption at the foot of page 21.

Every other body page of How it works is 70 % full or more (page 9, 70 %; page 3, 73 %; the rest 79 % and up). The other documents are as before: Selling it 20 pages (its sparsest body page 21 %), What it is 16 (10 %), the Battlecard 10 (18 %).

### V3.12 Review round four's fixes (11:53 to 12:05)

The lead committed my work of V3.10 and V3.11 at `819c6d9c`, then review round four's fixes at `6aa479f5` (11:52:58): the sellers' storyboard frames redrawn with larger text; on the engineers' page the reasons heading "Customers choose it for different reasons", a price-band line in the prior's card and the blend constant defined at first use; `data-reader` moved onto leaf elements on the marketing and sellers' pages (no visible change); the spine printing as ink on white; the tour's fixes. The lead asked for every shot the four pieces name to be captured again from the committed tree, the documents whose source or pictures changed to be rebuilt (What it is and the Battlecard checked by hash), and all 18 checks on all four. `4419a253` (11:54:55) followed, touching only the design document and M2's note.

**Between 11:20 and 11:54 the two stale pictures of section V3.10 (`shot-se-instruments.png`, `shot-ae-objections.png`) left the folder.** Neither was committed, and I did not remove them; both are kept in `<w3>\prev-shots\`, unchanged. The folder now holds 45 shot files, exactly the ones the four pieces and the tour name.

**The shots.** The site copy taken at 11:54:27 equals `6aa479f5` file by file (line endings aside); against the copy of 11:13 nine files changed (`battlecard.html`, `how-it-works.html`, `selling-it.html`, `selling-it.css`, `spine.css`, `what-it-is.html` and the tour's three). All 38 shots the four pieces name were captured as in section V3.1, and the tour's 7 with script off as before: all wholly in view, nothing outside their boxes but the known cases of section V3.1, no console message, no running animation; every caption visible inside its element (38 of 38, and 7 of 7); a second run byte-identical (45 of 45; one second tour run failed to start, Chrome not answering on its port within 20 s, left nothing running, and was run again). The marketing page's four moving pictures carry a bare `data-motion` attribute that its script, idle under reduced motion, never sets to "armed", so they show their end state, as the identical hashes confirm.

**What changed, against the files in the folder:** 21 of 45. The other 24 are byte-identical: the six spine pictures, the seven marketing, the six battlecard, `se-reasons` and four instrument cards (interest, decay, entry and release, score).

| Picture | What changed | CSS px | PNG px | Bytes | sha-256 (16) | In Word |
|---|---|---|---|---|---|---|
| `shot-ae-scenes.png` | its content | 928 x 787 | 1856 x 1574 | 404,629 | `190ec425173e748e` | 6.50 x 5.51 in |
| `shot-ae-reasons.png` | moved down 17.6 px; same text, size and fonts | 928 x 695 | 1856 x 1390 | 230,533 | `e27a92a2f8e32394` | 6.50 x 4.87 in |
| `shot-ae-measures.png` | moved down 17.6 px; same text, size and fonts | 928 x 676 | 1856 x 1354 | 266,179 | `4b9a29d6974204f0` | 6.50 x 4.74 in |
| `shot-ae-objections-quote.png` | moved down 17.6 px; same text, size and fonts | 928 x 190 | 1856 x 382 | 52,680 | `285e17fa20bc27ee` | 6.50 x 1.34 in |
| `shot-ae-objections-1.png` | moved down 17.6 px; same text, size and fonts | 928 x 851 | 1856 x 1704 | 268,008 | `b8590aa417c1bd8b` | 6.50 x 5.97 in |
| `shot-ae-objections-2.png` | moved down 17.6 px; same text, size and fonts | 928 x 647 | 1856 x 1296 | 207,168 | `a01af6bc97e2ff4c` | 6.50 x 4.54 in |
| `shot-ae-asks.png` | moved down 17.6 px; same text, size and fonts | 928 x 1260 | 1856 x 2522 | 384,276 | `adb890f82fdf7042` | 5.89 x 8.00 in, held to 8 in |
| `shot-ae-demos.png` | moved down 17.6 px; same text, size and fonts | 928 x 856 | 1856 x 1714 | 421,000 | `5edb9573fa19eb8a` | 6.50 x 6.00 in |
| `shot-ae-battlecard.png` | moved down 17.6 px; same text, size and fonts | 704 x 168 | 1408 x 338 | 29,409 | `dfce53a6ec2fb620` | 6.50 x 1.56 in |
| `shot-se-instrument-prior.png` | its content | 928 x 478 | 1856 x 958 | 162,861 | `dceff43d1735b98d` | 6.50 x 3.36 in |
| `shot-se-instrument-cap-pin.png` | moved down 52.5 px; same text, size and fonts | 928 x 521 | 1856 x 1044 | 197,072 | `49f78eeee5b71b48` | 6.50 x 3.66 in |
| `shot-se-privacy.png` | moved down 52.5 px; same text, size and fonts | 928 x 516 | 1856 x 1034 | 171,137 | `9b4de448a23fd953` | 6.50 x 3.62 in |
| `shot-se-asks.png` | moved down 52.5 px; same text, size and fonts | 928 x 979 | 1856 x 1958 | 315,020 | `4001d127a3baaf6c` | 6.50 x 6.86 in |
| `shot-se-next.png` | moved down 52.5 px; same text, size and fonts | 668 x 151 | 1338 x 302 | 44,355 | `5a2865d02624764d` | 6.50 x 1.47 in |
| `shot-tour-step-1.png` | its size | 928 x 538 | 1856 x 1078 | 123,986 | `61ad07352e55db27` | no Word copy |
| `shot-tour-step-2.png` | its size | 928 x 516 | 1856 x 1032 | 180,612 | `a3aa5682ba998a7a` | no Word copy |
| `shot-tour-step-3.png` | its size | 928 x 538 | 1856 x 1076 | 175,628 | `02b38732f6222d2d` | no Word copy |
| `shot-tour-step-4.png` | its content | 928 x 538 | 1856 x 1076 | 182,098 | `0c3adb19b8663dbe` | no Word copy |
| `shot-tour-step-5.png` | its size | 928 x 538 | 1856 x 1076 | 188,726 | `4a6834e727898a2f` | no Word copy |
| `shot-tour-step-6.png` | its size | 928 x 538 | 1856 x 1078 | 189,524 | `7cdfd990c23c9cc5` | no Word copy |
| `shot-tour-step-7.png` | its size | 928 x 538 | 1856 x 1078 | 183,204 | `32e1128318d9f5da` | no Word copy |

`ae-scenes` carries A1's redrawn frames, its smallest text now 10.2 CSS px where it was 8.5 (about 5.1 pt in Word, where it was 4.3). `se-instrument-prior` gained its price-band line and names the blend constant in its formula; the twelve shots below those two only moved down their pages, so their text, size and fonts are those of section V3.11, and a PNG one device pixel taller or shorter is the outward rounding at a new fractional offset. The tour's frames are wider on the page now (928 px, where they were 565), and step 4's frame changed three characters. All 21 were placed at 11:57:53 over the old files (kept in `<w3>\prev-shots-3\`); the new content and step 4 were looked at, whole.

**The documents.** What it is and the Battlecard were not rebuilt. Their sources equal HEAD and are those they were built from (their composed copies, made again from the snapshot of 11:59, equal the copies of 10:56 byte for byte), and every picture embedded in them is byte-identical to its PNG in the folder today (12 of 12 and 7 of 7). Selling it and How it works were rebuilt at 11:59:53 with the converter as committed (`224fa972…`, equal to HEAD), from `selling-it.md` `6630c6bc…` (unchanged since `e82925bc`; its pictures changed) and `how-it-works-and-where-it-runs.md` `06e74bf11290494fa2010f1501a8aed95f1bd196efecb699cf4d797b6b95071c` (changed in `6aa479f5`), each with `spine.md` `a6a59bc8…`. The converter printed no warning. The snapshot step now requires only the drawn figures to equal HEAD and lists the captured pictures that differ from it (21, this lane's recaptures, not yet committed), where it had refused any tracked figure that differed.

| Word document | Bytes | sha-256 | Pages | Checks |
|---|---|---|---|---|
| `Enablement-What-It-Is-v3.0.docx` (not rebuilt) | 1,844,626 | `8d6eb9a2e1da1b6426d81cb154bad40f40f82eee8ed5d56a0615e12f1da9d7f7` | 16 | 18 of 18 |
| `Enablement-Selling-It-v3.0.docx` | 2,729,271 | `a92316b9b38d390129dd024da2ea35028828ff876b34fc7e78f21ab9083e413b` | 20 | 18 of 18 |
| `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` | 3,982,035 | `c65c6fa52da6bcc7a18cf771efc14818adb5422b8c6c43a879d316380a6eb59c` | 22 | 18 of 18 |
| `Enablement-Battlecard-v3.0.docx` (not rebuilt) | 811,941 | `adb51ecf0b260c27f949fa041a2d4f403a73f9d414b0bb520e4d38cb77a9cb82` | 10 | 18 of 18 |

**All 18 checks pass on all four** (`final-check-output-v3d.txt`, the pictures' text from the 45 capture records of this round, each matched to its file in the folder): the scans at zero across the text, every picture's text and every package part; every heading keeping with the next paragraph; every picture line embedded byte for byte, none wider than the text width; "3.0" once in `word/document.xml`; a linked contents; rule 3 as section V3.10 reads it; `unzip -t` clean. The page counts are unchanged; How it works' sparsest body pages are still page 15 (8 %, the heading and lead line before the architecture figure) and page 22 (2 %, the companion card's link line).

### V3.13 The band in place of the spine, under the brief's section 8 (21:53 to 22:05)

The lead committed my work of V3.12 at `03104fbe`. Since then: `518d520f` changed only print rules (`site.css` table headers and the spine in ink on white); `3e19ccbe` added the brief's section 8 and mock 4 (the owner's approved fix); `6434b4f1` (21:52:27) built it. What it is keeps the full spine, the battlecard the compact one; Selling it and How it works open with **the band**, whose text of record is `docs/enablement/content/spine-band.md` (picture line `shot-spine-band.png`, `data-shot="spine-band"` on both pages); the tour is one player and carries no spine. The lead asked for the band's picture from `selling-it.html`, the two documents rebuilt to open with the band in place of the spine, What it is and the Battlecard checked by hash, the tour's frames captured again with script off, any other shot whose element changed captured again, and all 18 checks on all four.

**The composition.** Both pages read: h1, reader line, band, sections. The piece table now names `spine-band.md` as the opening of `selling-it` and `how-it-works`, so `compose.mjs` gives, unchanged in method: the reader line, the band less its title line and the blank line after it, then the piece's sections. Like the compact spine, the band has no `##` heading, so it sits after the reader line and before the first section, outside the contents. Check 0 proves each copy against both sources.

**The pictures.** The site copy taken at 21:54:53 equals `6434b4f1` file by file (line endings aside). Captured as in section V3.1: the 39 shots the four pieces name, the band among them, and the tour's 7 with script off; the band again from `how-it-works.html`. All wholly in view, no console message, no running animation, every caption visible (39 of 39 and 7 of 7).

- **New: `shot-spine-band.png`**, the element `<div class="spine-band-card">` on `/selling-it`, 928 x 281 CSS px, 1856 x 564 PNG, 104,007 bytes, sha-256 `2866b6fd1a733be5df8b9976fa2706861734d93a15f100a3e998ed5cee18b5b7`, 6.50 x 1.98 in in Word. Its caption, the headline, is visible inside it; a second capture is byte-identical; the band from `/how-it-works` is byte-identical to it. Looked at, whole: the headline, the three contrast cells in a row and the link to the full story. Placed at 21:58:43.
- **Identical, 20:** the six spine pictures of What it is and the battlecard's short form, the seven marketing, the six battlecard, and `ae-objections-quote`.
- **Moved only, 25, the committed files kept:** every other sellers' and engineers' shot (8 and 10), now higher on their pages under the shorter opening, and the tour's seven frames, near the top of a page with no spine. Each has the same visible text, size and fonts as its committed file; the pixels differ only by antialiasing at a new fractional offset (from 5 pixels to 3.4 % of `se-asks`, along its text rows), and five come out one CSS px taller or shorter by the outward rounding. The commit's changes to the two pages touch only their openings, and its new styles are scoped to the band or to print, so none of these elements changed. As the lead asked for the shots whose element changed, these files were left as committed; the fresh captures are in `<w3>\shots-run6\` and `<w3>\shots-tour-6\`. For the tour, captured again as asked: the same seven frames.

The folder holds 46 shot files: the 45 of section V3.12 and the band. Two harness points: the allowance for Chrome to open its DevTools port went from 20 to 60 s, after two starts failed to answer in time (each left nothing running, and was run again); and the snapshot step had stopped silently when no tracked shot differed from HEAD (a `grep` that found nothing, under `pipefail`); it now counts, and also lists new untracked pictures.

**The documents.** What it is and the Battlecard were not rebuilt: their sources equal HEAD and what they were built from (the composed copies made again at 21:59 equal those of 10:56), and every picture embedded in them is byte-identical to its PNG in the folder (12 of 12, 7 of 7). Selling it and How it works were rebuilt at 21:59:43 with the converter as committed (`224fa972…`, equal to HEAD), from `selling-it.md` `6630c6bc…` and `how-it-works-and-where-it-runs.md` `06e74bf1…`, both unchanged, and `spine-band.md` `8f4b59ff5fa5a4c4a11321e3c514a460db09530a385641e8d9c14fe662f213d5`. The converter printed no warning.

| Word document | Opens with | Bytes | sha-256 | Pages | Checks |
|---|---|---|---|---|---|
| `Enablement-What-It-Is-v3.0.docx` (not rebuilt) | the full spine | 1,844,626 | `8d6eb9a2e1da1b6426d81cb154bad40f40f82eee8ed5d56a0615e12f1da9d7f7` | 16 | 18 of 18 |
| `Enablement-Selling-It-v3.0.docx` | the band | 2,295,185 | `93d527facb7b3c1525d0892d3c7282591b40c3189e5a38f71fa7fe51f311c49f` | 17 (was 20) | 18 of 18 |
| `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` | the band | 3,547,974 | `2e09ed8bf6de6d161c9fecdb0710a52b219bef7750749626067c8c628b067900` | 18 (was 22) | 18 of 18 |
| `Enablement-Battlecard-v3.0.docx` (not rebuilt) | the compact spine | 811,941 | `adb51ecf0b260c27f949fa041a2d4f403a73f9d414b0bb520e4d38cb77a9cb82` | 10 | 18 of 18 |

**All 18 checks pass on all four** (`final-check-output-v3e.txt`, the pictures' text from the 46 capture records that match the folder's files). In the two rebuilt documents the contents list only the piece's own sections now (7 and 8, where the spine had added five), each carries one more external link (the band's link to What it is), "We built an engine" is allowed three times (the band's caption, its headline and its picture) and "What we built" no longer occurs, and rule 3 passes with the band before the first section. The scans are at zero across the text, every picture's text and every package part; every heading keeps with the next paragraph; every picture line is embedded byte for byte, none wider than the text width; "3.0" reads once in `word/document.xml`.

**Pages** (W1's model). Selling it: 17, its sparsest body page 21 % and its last 28 %. How it works: 18; its sparsest body pages are page 7 (59 %) and the last page (2 %, the companion card's link line), and the rest are 74 % full or more. No page holds only a heading and its lead line any more, but in two sections, the learning one and the edge one, the heading and its one lead line end a page (pages 10 and 11) and the picture opens the next: the converter keeps a heading with its next paragraph, which is that lead line. Keeping the lead line with its picture too would take keep-with-next on such a paragraph (a converter change); it would join the learning section, while the edge section's heading, lead line and 7.92 in architecture figure still exceed one page (section V3.11).

### V3.14 Converter rule 15: a lead line keeps with its picture (22:03 to 22:15)

The lead committed V3.13 at `42882d26` and asked for one more minimal converter change: a paragraph immediately followed by a picture paragraph carries keep-with-next, so a heading, its one lead line and its picture travel together; nothing else changes. Proof by paired builds as for rule 14, all four documents rebuilt, the 18 checks, and the pages that still end with a heading or a lead line whose picture opens the next page.

**The change.** `scripts/md2docx.mjs`, 6 insertions and 1 deletion: header rule 15 (three comment lines), a helper `beforeFigure` that looks past blank lines (which build nothing) for a figure line, and the paragraph branch gaining `keepNext` when it is true. Lists, tables, quotations, captions and the empty spacer paragraphs the converter writes are untouched. sha-256 `5e4594f80c6805a8949741157f653d4cfe1cb265425bdab5826fc85c7bc7f859`, where it was `224fa972…` (HEAD `42882d26`).

**The proof.** The converter at HEAD against the changed one, each with the seeded `Math.random` (rule 13), over 12 inputs: a probe (a lead line before a picture, with and without a blank line between; a paragraph after a caption; a heading straight above a picture; a list, a table and a quotation each right above a picture; a paragraph before a heading; the file's last paragraph), the four version 3 copies as composed now, the six version 2 copies and W4's technical note. `compare-pair2.py` resolves every relationship id to its target and compares block by block. In all 12, every part but `document.xml` is identical, `core.xml` equal but for its build time, the relationships the same, and every block either identical or differing only by one added `<w:keepNext/>`, on a paragraph whose next block is a picture, never on a heading (which kept already). Every paragraph a picture follows is accounted for: a heading keeps (rule 14), a markdown paragraph now keeps, an empty spacer after a list, table or quotation does not. The probe's two lead lines gained it; nothing else in it changed.

What gained it, as the rule's words reach further than lead lines: What it is 1 (the lead of "Both engines on one page"); Selling it 4 (the reader line above the band, the objections lead, the quote card's last line above the first objections picture, and the last line of the first seven objections above the second); How it works 13 (the reader line above the band, five section leads, the lines before the decision path and before the published-documents figure, the closing line of four instrument cards above the next card's picture, and the AI sentence above the privacy table's picture); the Battlecard 1 (the reader line above the short form); in the six version 2 copies 0, 1, 2, 1, 0 and 0, and in the technical note 1.

**The documents**, rebuilt at 22:06:17 with the changed converter from sources equal to HEAD (the composed copies unchanged since 21:59). Each differs from the document it replaces only by those properties (`compare-pair2.py`, prior builds kept in `<w3>\prev-docs-2\`).

| Word document | Bytes | sha-256 | Pages | Checks |
|---|---|---|---|---|
| `Enablement-What-It-Is-v3.0.docx` | 1,844,616 | `c6bbd8f2de40a62db2b26727e55af999f4c83b83e76aed885367042ddcbc06f2` | 16 | 18 of 18 |
| `Enablement-Selling-It-v3.0.docx` | 2,295,199 | `98ea88b5916d0c655787166a4929f6b3683c6640b964fa5afae464096c86bfe3` | 17 | 18 of 18 |
| `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` | 3,547,980 | `715a9b089d8beb90ffe27189b1b04912145189a702aa29db812a35722c17a06d` | 19 | 18 of 18 |
| `Enablement-Battlecard-v3.0.docx` | 811,949 | `6112e74fcad100ab96194440910d6a0e8e25c5a1bbab8133ba6b24ac84c44743` | 10 | 18 of 18 |

**The checks** (`final-check-output-v3f.txt`): all 18 pass on all four. Check 11 now also requires converter rule 15: every markdown paragraph a figure follows keeps with it, and no paragraph keeps with the next but the headings, the captioned pictures and those paragraphs (What it is 25 = 12 + 12 + 1; Selling it 21 = 7 + 10 + 4; How it works 38 = 8 + 17 + 13; the Battlecard 14 = 6 + 7 + 1). Control: the Selling it built at 21:59, before the rule, fails check 11 on exactly its four paragraphs.

**Pages, and pictures still parted from their heading or lead line.** W1's model applies keep-with-next one pair at a time, but Word applies it to a run: when a paragraph must move to the next page to stay with what follows it, the paragraphs just before it that keep with the next move too, unless the first of them already starts a page, when Word breaks the run instead. A copy of W1's model with that cascade (`pages-chain.mjs`, otherwise unchanged) gives the page counts above; W1's own model gives the same, but for How it works, where it gives 18. It also lists every page that ends with a heading or a lead line whose picture opens the next page:

- **What it is, Selling it, the Battlecard: none.**
- **How it works: one, the section "It runs at the edge, and every setting is a published document".** Its heading, its lead line, the architecture figure (7.92 in tall) and the figure's caption need about 653 pt, more than the 648 pt a page holds, so Word cannot keep them together: page 12 holds only the heading and the lead line (8 %), and the figure and caption open page 13. Any one of three changes would let the run fit: a one-line lead line there (G1's text), a shorter architecture drawing (D1's), or a lower cap on a figure's height in the converter.
- The two other sections where this happened before rule 15 now move whole: "Learning waits behind the dial…" (to page 11) and "The site connects once…" (to page 15). Control: the How it works of 21:59 shows three such pages (10, 11 and 13: learning, the edge, integration) under the same model.

How it works' sparsest body pages are page 12 (8 %, the edge section's heading and lead line) and its last page (2 %, the companion card's link line); the others are 54 % full or more. Word's own pagination cannot be run here; expect it to differ by about a page.

### V3.15 Converter rule 16: the tallest picture is 7.5 in (22:12 to 22:20)

The lead committed V3.14 at `741cc42d` and asked to close the last parted section with the converter: lower the picture height cap so a captioned picture never exceeds 7.5 in tall, aspect ratio kept, nothing else changing; prove it on before-and-after builds, listing the pictures that change size; rebuild the four documents; run the 18 checks; confirm that the edge section's heading, lead line and figure share a page.

**The change.** `scripts/md2docx.mjs`, 5 insertions and 2 deletions: the cap `FIG_H` is 7.5 in for portrait (`12960 - 2160` twips), where it was 8 in (`12960 - 1440`); landscape keeps its 5.5 in; the header's figure paragraph says 7.5 in, and rule 16 records why. sha-256 `49458ca79b84ce269e27602813b753d49ed3da9a7f3342b3c975d396f5bdbe54`, where it was `5e4594f8…` (HEAD `741cc42d`).

**The proof.** The same 12 inputs as rule 15's, built with the converter at HEAD and the changed one, seeded (`pair3.sh`), compared by `compare-pair3.py` (every part identical but for the build time, the relationships the same with every id resolved to its target, `document.xml` identical once picture sizes are set aside, and each picture that changed size taller than 7.5 in before and exactly 7.5 in after, its aspect kept, no wider than the text width): all 12 pass. The pictures that changed size, and only these:

| Document | Picture | Before | After |
|---|---|---|---|
| What it is | `shot-mk-say.png`, "Each card pairs a phrase never to say with the sentence to say instead." | 6.50 x 7.98 in | 6.11 x 7.50 in |
| Selling it | `shot-ae-asks.png`, "Each ask comes with its reason." | 5.89 x 8.00 in | 5.52 x 7.50 in |
| How it works | `architecture.png`, "Where the engine runs on Cloudflare" | 6.50 x 7.92 in | 6.16 x 7.50 in |
| Battlecard | `shot-bc-discovery.png`, "Each question opens a measure the customer can track on their own numbers." | 5.83 x 8.00 in | 5.47 x 7.50 in |
| (not delivered) version 2's Selling it and How it works | `architecture.png` | 6.50 x 7.92 in | 6.16 x 7.50 in |

Every other picture in the 12 inputs is at most 7.5 in tall and kept its size. A first run of the comparison on the real (unseeded) builds reported differences beyond picture sizes: a backslash in the script's relationship pattern had been lost on its way through a shell heredoc, so no link id was resolved. With the pattern repaired, every comparison passes.

**The documents**, rebuilt at 22:15:35 from sources equal to HEAD (composed copies unchanged). Each differs from the 22:06 document only in its one resized picture.

| Word document | Bytes | sha-256 | Pages | Checks |
|---|---|---|---|---|
| `Enablement-What-It-Is-v3.0.docx` | 1,844,641 | `76ac8094201c7488d21ddff770afe293de581a26ccb11e8e2c7d83269a4c05fe` | 16 | 18 of 18 |
| `Enablement-Selling-It-v3.0.docx` | 2,295,210 | `fb0928854d29c1c6a9813160a7a66bb1454675c2fe53bfd912f0ea22a5039f13` | 17 | 18 of 18 |
| `Enablement-How-It-Works-and-Where-It-Runs-v3.0.docx` | 3,547,994 | `b030553eefe7c548e6f20be9937072d34237fd3a83cce499d2987e4a21756629` | 18 | 18 of 18 |
| `Enablement-Battlecard-v3.0.docx` | 811,950 | `0766246cccbafb8fbe6b43e096d8b3a7b55447cf2a39616f5bb54c714317ba2f` | 10 | 18 of 18 |

**The checks** (`final-check-output-v3g.txt`): all 18 pass on all four, check 11 now holding a picture to 7.5 in.

**The pages.** W1's model and its copy with Word's cascade (section V3.14) now agree: 16, 17, 18 and 10. No page in any of the four ends with a heading or a lead line whose picture opens the next page. The edge section, "It runs at the edge, and every setting is a published document", sits whole on page 12 of How it works: the heading at the top, the lead line at 26 pt, the architecture figure (540 pt) from 67 pt and its caption at 610 pt. In the 22:06 build the figure opened page 13. The learning and integration sections still move whole to pages 11 and 14. How it works' sparsest body pages are page 7 (54 %) and its last (2 %, the companion card's link line).
