# Lane K3 (part c): the rehearsal harness as kit libraries

**Opened 2026-10-01 by the lead; starts when K2 is committed**, because the two Vantage suites must be stable while K2 is reviewed. Design: [Demo-Kit-Design.md](../Demo-Kit-Design.md) §2.3. Parts a and b: [K3.md](K3.md).

## Scope

1. `scripts/demo-kit/lib/rehearse.mjs`: the request helpers lifted from `scripts/rehearse-vantage-page.mjs` (the visitor minting, the ask, the event send, the receipt read, the checks' vocabulary: `ok`, `info`, the `!` lines, the summary and exit code).
2. `scripts/demo-kit/lib/cdp.mjs`: Chrome over DevTools from `scripts/rehearse-vantage-dom.mjs` (a fresh profile per run, the viewport, computed visibility, the wire audit, `--shots`, the press-to-landing timer, the capture-timing summary).
3. The two Vantage suites become the vertical's outcomes on top of the libraries: every assertion keeps its text and its order; the counts do not change (279 DOM, 113 request level at the time of writing).
4. `scripts/demo-kit/rehearse.mjs --config <demo> --suite page|dom --base <url>` runs a demo's suites through the config; `check-demo.mjs` uses it.
5. `seeds.json`: nothing reads it since K2 (the slots documents hold the seeds). Retire it: remove it from the request-level suite's two served-file lists, delete the file, and update `anchor.json`'s mention if the seed binds it (K3b's anchor check). If the explainer's comments name it, say so in the report and leave the explainer alone; it is another session's.
6. Tests with `node:test`: the check vocabulary, the exit code on a `!` line, the visibility predicate on a fixture DOM, the config-driven suite selection.

## Definition of done

Both Vantage suites green through the libraries with unchanged counts and unchanged assertion texts (diff the two suites' printed lines before and after: identical apart from timings); `check-demo` green on your own rig (port 9115, `.wrangler/state-k3c`); `node --test` green; the Report section written with files, counts and anything not done.

## Ownership

Writer of: `scripts/demo-kit/**`, `scripts/rehearse-vantage-page.mjs`, `scripts/rehearse-vantage-dom.mjs`, `public/vantage/seeds.json` (deletion) and `public/vantage/beats/anchor.json` only for the `seeds.json` mention, and the Report section of this file. Nothing else under `public/`, nothing under `src/`, no document.

## Rules

As every lane: no commit, no deploy, no push, nothing against the hosted worker; no `git checkout/reset/stash/restore/switch/rm`, no `rm -rf`, no installs, no process kills except your dev server; secrets only from the local `.dev.vars`, never printed or written; preserve every pre-existing uncommitted file; snapshot and restore the 19 seed-written files if you seed.

## Report

**Lane K3, part c, builder, 2026-10-02, 00:05–01:00 EDT. Done: the two libraries, both Vantage suites on them with every assertion text and its order unchanged, `scripts/demo-kit/rehearse.mjs`, `check-demo` through it, `seeds.json` retired, 22 new `node:test` tests. Nothing committed, deployed or pushed; nothing sent to the hosted worker.**

### Results

| Check | Result |
|---|---|
| DOM suite, before (head `9596406`'s suite) | **292 of 292** |
| DOM suite on the libraries: the documented command, then through `rehearse.mjs --suite dom` (in `check-demo`), then through `rehearse.mjs` with `--wait 45 --size 1440x900 --chrome <path> --strict --shots <dir>` | **292 of 292** each time, no `!` line; the four shots written as `C1-1440-01-seam.png` … `04-fresh-visitor-home.png`, as before |
| Request-level suite, before | **116 of 116** |
| Request-level suite on the libraries, `seeds.json` still listed | **116 of 116** |
| Request-level suite after `seeds.json` is retired: through `rehearse.mjs --suite page`, then in `check-demo` | **115 of 115** both times (one check is gone: `/vantage/seeds.json → 200`) |
| `check-demo --config vantage --base http://localhost:9115` | **5 of 5**: generated (through WSL), typecheck no error, credentials 151 files and 5 config files with no finding, request level 115 of 115, DOM 292 of 292 |
| `node --test scripts/demo-kit/lib/*.test.mjs` | **91 tests: the 69 from before plus 22 new.** WSL (Node 22.15): 90 pass, 1 skip (the real-Chrome test; WSL has no browser). Windows (Node 22.17): 89 pass, 2 skip (the two sharp tests, as before). Every test passes where it runs; none fails anywhere. `build-demo-worker-config.test.mjs` 6 of 6 |
| `npm run check:generated` (WSL) | passes: all three bundles are exact |

### The line-diff proof

Every run's printed lines are in the scratchpad (`k3c/logs/`). `linediff.cjs` there compares two runs line by line: raw, then with every digit run masked, and the assertion texts (each `✓`/`✗`/`!` line's label up to its detail) in order. Scores move with real-time decay, so a second run of the **unchanged** DOM suite was taken as a control.

| Pair | Lines | Raw lines that differ | Differ with digits masked | Assertion texts that differ |
|---|---|---|---|---|
| DOM: before against the unchanged suite run again (control) | 392 / 392 | 62 | 2 | 0 (one label carries the call count: 248 / 250 calls) |
| DOM: before against the libraries (`rehearse.mjs`, in `check-demo`) | 392 / 392 | 55 | 2, the same two lines as the control | 0 (248 / 249 calls) |
| DOM: before against the libraries (documented command) | 392 / 392 | 68 | 5: the control's two, plus three lines at 14b | 0 (248 / 251 calls) |
| Request level: before against the libraries | 211 / 211 | 23 | 0 | 0 |
| Request level: libraries, before and after retiring `seeds.json` | 211 / 210 | (one line removed) | the removed line and one info line | the removed check only; two labels change their count |

- **Numbers only.** Every line that differs only in numbers is a timing ("1.8 s (the press 0.3 s)", "cloned 71 ms after the press", "130 ms"), a clock time on Compare's tags and titles ("00:18" against "00:31"), a score under real-time decay ("samsung 0.622" against "0.621"), a revision ("open-slots@3" against "@10"), the day report's clicks so far ("0.00 → 1.00" against "2.00 → 3.00"), or the wire's call count, which depends on how often the receipts answered 202.
- **The control's two lines appear in every pair.** Line 8 is the order of the request-located stranger's four in North Carolina: each walk nudges the regional prior there (RESUME finding 9). Line 147 is the decision id inside the trade-in module's citation.
- **The documented-command run had three more lines, all at 14b.** "Protect your phone" sat above "Pair with a plan" in Montana in that run's details, and the order depends on timing; the suite deliberately watches protection rather than claiming it. The later runs on the libraries had the before order again.
- **`seeds.json` retirement.** The masked diff between the two request-level runs is exactly `✓ /vantage/seeds.json → #` removed, plus line 49 (the same North Carolina order). Two labels change their count: "no served page or document carries a token (40 checked)" becomes 39, and "no file this demo ships carries a token (95 read from the checkout)" becomes 94.

### Files

| File | What it is now |
|---|---|
| `scripts/demo-kit/lib/rehearse.mjs` (new, 297 lines) | The checks' vocabulary, `createChecks({ infoIndent, strict, defectsDoc })`: `ok`, `info`, `known` (the `!` line), `fail`, `summary`, `exitCode`, and `suiteSummary`, moved here from `check-demo.mjs`, which re-exports it. The request client, `createClient({ base, tenant, source, assets, api })`: navigate, asset, the API call with X-Tenant and the site key, the demo route by name, the minted visitor with consent, events retried once and listed, content clicks, the snapshot with its asserted context, meters, `/sort`, receipts, the cold-start read. Also `codeOnly` (the kit-boundary guard's comment stripper), `flagReader` and `ids` |
| `scripts/demo-kit/lib/cdp.mjs` (new, 293 lines) | `findChrome`, `launchChrome` (a fresh profile under the OS temp directory per run, the viewport, the protocol, `close`), `visibility` (computed visibility up the chain and a real box, plain JavaScript over a window), `pageReaders` and `inPage` (the page's `vis`, `txt`, `own`, `shown`), the wire audit (`recordWire`, `auditWire`, `checkDemoRouteBodies`, `tallyWire`, `checkScriptErrors`, `apiPaths`), `screenshotter` (`--shots`), `pressTimer` and `captureTimingLines` |
| `scripts/demo-kit/rehearse.mjs` (new, 87 lines) | `--config <slug or file> --suite page\|dom --base <url>`, with every other flag passed through in order. It exits with the suite's own code, or 2 for a wrong command line or config |
| `scripts/rehearse-vantage-page.mjs` | 921 lines become 757: the vertical's outcomes on `lib/rehearse.mjs` and `lib/credentials.mjs` (its token shapes and walk are the kit's own, which were lifted from this file). `seeds.json` is out of both served-file lists |
| `scripts/rehearse-vantage-dom.mjs` | 1,039 lines become 895: the page's hooks, the 22 presses and their outcomes on `lib/cdp.mjs` and the vocabulary. `pageHelpers` receives the kit's readers |
| `scripts/demo-kit/check-demo.mjs` | Runs each suite as `rehearse.mjs --config <file> --suite <kind> --base <url>`, and `--config` takes a slug too |
| `scripts/demo-kit/lib/config.mjs` | `SUITE_KINDS`; each suite in `check.suites` needs a `kind` (page or dom, one of each); `configFileFor` (slug or path), which both command lines share |
| `scripts/demo-kit/configs/vantage.json` | `"kind": "page"` and `"kind": "dom"` on its two suites |
| `scripts/demo-kit/lib/credentials.test.mjs` | Its scratch copy of `check-demo` now carries `lib/rehearse.mjs`, and its config names the suite's kind |
| `scripts/demo-kit/lib/rehearse.test.mjs` (new, 14 tests) | The vocabulary's exact lines; info indents; the last line read back; the `!` line at exit 0, failing under `--strict` (in process and as a process); flags; `codeOnly`; the client's wire against a local stub server; suite selection, the command line and refusals; the config's kind rule; `rehearse.mjs` and `check-demo` end to end on a scratch tree |
| `scripts/demo-kit/lib/cdp.test.mjs` (new, 8 tests) | `visibility` on a fixture DOM (display none, visibility hidden or collapse, opacity 0 up to the root, no box, not in the page, below the fold, scroll offset); the readers through `inPage`; `findChrome` and `parseSize`; the wire audit, each rule failing for what it names; the press timer; the capture timings; `--shots`; and the same predicate in real headless Chrome on a fixture page (Windows) |
| `public/vantage/seeds.json` | Deleted with the file system. Both slots documents that carry seeds (`open-slots.json`, `13-pin-duo-preorder.json`) hold its hero and deals rules exactly, checked before the deletion. Nothing fetches it: not `vantage.js`, the kit, the suites or the configs |
| `public/vantage/beats/anchor.json` | One value, at the coordinator's request after the first hand-back: `seeds.source` was "public/vantage/seeds.json (lane L4)" and is now "public/vantage/beats/open-slots.json and 13-pin-duo-preorder.json (seeds.json retired, lane K3c)". The diff is one line (1 added, 1 removed); the parsed document equals HEAD's in everything else |

### The anchor.json value, proven

The seed's anchor check (`lib/seed.mjs` `anchorCopyProblems`) does not read `seeds`, which is why the value was first left as it was.

- **Offline.** `scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/vantage.json --files-only --out <scratchpad>` passed every local check and exited 0. It wrote the 18 documents with no warning, and the written `anchor.json` carries the new value.
- **On my rig.**
  - I took a new snapshot of the 19 files, since `anchor.json` now differs from HEAD. Then I restarted 9115 on `.wrangler/state-k3c` and reseeded with `seed-vantage.mjs`: four writes `ok` at revisions 3, 44, 35 and 3.
  - The served `beats/anchor.json` carries the new value under the new anchor.
  - The request-level suite, run through `rehearse.mjs --suite page`, gave **115 of 115**. That includes "the 18 beat documents are served (18/18)", "no served page or document carries a token (39 checked)" and "no file this demo ships carries a token (94 read from the checkout)".
- **Restored.** The reseed changed the same four files; they are back from the new snapshot, 19 of 19 OK. `anchor.json` differs from HEAD by that one value only.

### Not done, and why

- **The explainer named `seeds.json`, and I left it alone (another session's):**
  - `public/vantage/how-it-works.js` lines 8 and 91 (comments);
  - `public/vantage/how-it-works.html` line 188, which is visible text on the page: "the rules: public/vantage/seeds.json".

  Both files were changed by another session at 01:02:59, after my report; I did not touch them. Documents that name it, none of them mine: `docs/verizon/explainer/FACTS.md:159`, `Demo-Kit-Design.md` §1's table, `docs/lg/research/lg-framework-map.md:20` and `docs/verizon/Vantage-Demo-Design.md`.
- **Counts in the documents.** `docs/demos/BOOTSTRAP.md` still says "110 checks" and "221 checks" for the suites (not mine to edit). From this lane on, the request-level suite counts 115, or 114 when the day report reads folded hours (the clicks check then does not appear); it was 116 and 115. The DOM suite stays at 292. Every documented command and flag works unchanged.
- **The real-Chrome test skips in WSL,** which has no browser; it runs and passes on Windows, where the DOM suite runs.

### Rig and restoration

- **The rig.** `wrangler dev --config wrangler.vantage.toml --port 9115 --persist-to .wrangler/state-k3c --inspector-port 9265`, from WSL, on a fresh state: migrations, census rows, `seed-vantage.mjs` with local minting from `.dev.vars` (never printed), and `seed-vantage-region.mjs` (51 of 51). The suites ran one at a time: the request-level suite from WSL, the DOM suite and `check-demo` from Windows. I stopped the rig with SIGINT to its own processes, and 9115 and 9265 are free. The state is kept. A rerun on it needs `seed-vantage.mjs` again, with the snapshot and restore of the 19 files, because the beat files are back at HEAD.
- **The 19 seed-written files.** They were hashed and copied before the seed. The seed changed four of them (`11-two-weeks-pass`, `12-black-friday`, `anchor`, `open-catalog`). All four were put back, and `sha256sum -c` reports 19 of 19 OK. Every file under `public/vantage` and `public/demo-kit` matches its hash from the start except three: the deleted `seeds.json`, `anchor.json` with its one new value, and the explainer files the other session changed at 01:02:59.
- **The second reseed (the anchor.json check), 01:01 to 01:03 EDT.** The rig is stopped again and 9115 and 9265 are free. Another lane's `wrangler dev` on 9112 (`.wrangler/state-w3`) started at 01:03:19, two seconds before my restore at 01:03:21, and reads the same `public/vantage/beats/`. If it listed or served the four re-anchored files in those two seconds, a reseed of its own sets them right. I did not touch it.
- **Ports and checkout.** No other port was touched. No other lane's file was written. Every pre-existing uncommitted file is as it was.
