# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 9/9 · W closed 0/26 (W16–W41) · suite 1700/1869 · residual 169 in 23 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W16 | 9 | 9 | no | — | — |

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

## Failing tests outside the baseline

_None._

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | c783fcbcc0b9ce498a6592347b81a6810e78a117aad97c4e3aeb3e74bb17f8d6 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest-serial.json (outside the checkout) |
| vitest report sha256 | a4e8a089596966147981e9b7aef68777fc7b7bd03d273d30cc50d4cd0ce3e9a7 |
| commit | 1b92df9340bd6f77060c99837d5c59b80a529b03 |
| generated | 2026-09-19T01:07:27.056Z |
