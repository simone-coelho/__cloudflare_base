# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 15/15 · W closed 0/26 (W16–W41) · suite 1707/1876 · residual 169 in 23 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W16 | 15 | 15 | no | — | — |

## Units

| Unit | Status | Tests matched |
|---|---|---|
| W16.C2.01 | green | 1 |
| W16.C2.02 | green | 1 |
| W16.C2.03 | green | 1 |
| W16.C2.04 | green | 3 |
| W16.C2.05 | green | 2 |
| W16.C2.06 | green | 3 |
| W16.C2.07 | green | 2 |
| W16.C2.08 | green | 1 |
| W16.C2.09 | green | 1 |
| W16.C2.10 | green | 1 |
| W16.C2.11 | green | 1 |
| W16.C2.12 | green | 1 |
| W16.C2.13 | green | 2 |
| W16.C2.14 | green | 1 |
| W16.C2.15 | green | 1 |

## Failing tests outside the baseline

_None._

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 962a062edf2c0f52990586bd24eff6d3c25a68a1b7ac6f21188549f3ac7f0cd5 |
| reviews | docs/remediation/reviews (absent) |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest.json (outside the checkout) |
| vitest report sha256 | e31c060e4e889c71bfe23a30c030c362334e108a6a6cba0720d77452086737e6 |
| commit | 05751ac4f56c64f67cc26b265e181703946a8408 |
| generated | 2026-09-19T02:05:18.483Z |
