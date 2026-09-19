# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 0/0 · W closed 0/26 (W16–W41) · suite 1658/1854 · residual 196 in 24 files · typecheck GREEN

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
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest-serial.json (outside the checkout) |
| vitest report sha256 | 7f4cc0ea4c7f88d1c9cdfbb29aa04d16af24120a9f5df833ad27ea5a2476d4a1 |
| commit | 4cbc56420bd6733e76a7b94e9303a27eac605c86 |
| generated | 2026-09-19T00:22:11.079Z |
