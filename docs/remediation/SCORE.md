# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 0/0 · W closed 0/26 (W16–W41) · suite 1616/1854 · residual 238 in 29 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| _none declared_ | 0 | 0 | no | — | — |

## Units

| Unit | Status | Tests matched |
|---|---|---|
| _none declared_ | — | 0 |

## Failing tests outside the baseline

_None._

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570 |
| reviews | docs/remediation/reviews (absent) |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest-baseline-7b01c14.json (outside the checkout) |
| vitest report sha256 | 1c5234cd1912625722ffb21982ef21e129c238b3961c6080538bcd62925d4ca6 |
| commit | 5b0b0ae8edf20318f68963c34cffe0dd5c25c3e9 |
| generated | 2026-09-18T23:13:41.048Z |
