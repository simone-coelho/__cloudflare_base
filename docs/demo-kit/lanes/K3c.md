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

(the lane writes here)
