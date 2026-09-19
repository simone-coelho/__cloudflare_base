# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 99/102 · W closed 2/26 (W16–W41) · suite 1904/1985 · residual 81 in 10 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 2 | 2 | no | — | — |
| W06 | 2 | 1 | no | — | — |
| W09 | 1 | 1 | no | — | — |
| W11 | 1 | 1 | no | — | — |
| W16 | 59 | 59 | no | — | — |
| W17 | 13 | 13 | yes | PASS | 4e2ba2d412602738cfa125d603b9ed29ceb1013d |
| W18 | 9 | 9 | yes | PASS | d78b8140f28386b07a8027da72629bd560c6d947 |
| W19 | 14 | 12 | no | — | — |
| W37 | 1 | 1 | no | — | — |

## Units

| Unit | Status | Tests matched |
|---|---|---|
| W05.BASE.01 | green | 1 |
| W05.BASE.05 | green | 2 |
| W06.BASE.01 | green | 1 |
| W06.BASE.02 | red | 1 |
| W09.BASE.02 | green | 1 |
| W11.BASE.01 | green | 2 |
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
| W16.C3.01 | green | 3 |
| W16.C3.02 | green | 1 |
| W16.C3.03 | green | 1 |
| W16.C3.04 | green | 2 |
| W16.C3.05 | green | 1 |
| W16.C3.06 | green | 1 |
| W16.C3.07 | green | 1 |
| W16.C3.08 | green | 2 |
| W16.C3.09 | green | 2 |
| W16.C4.01 | green | 1 |
| W16.C4.02 | green | 2 |
| W16.C4.03 | green | 1 |
| W16.C4.04 | green | 1 |
| W16.C4.05 | green | 2 |
| W16.C4.06 | green | 1 |
| W16.C4.07 | green | 1 |
| W16.C4.08 | green | 3 |
| W16.C5.01 | green | 2 |
| W16.C5.02 | green | 1 |
| W16.C5.03 | green | 1 |
| W16.C5.04 | green | 1 |
| W16.C5.05 | green | 1 |
| W16.C6.01 | green | 1 |
| W16.C6.02 | green | 2 |
| W16.C6.03 | green | 1 |
| W16.C6.04 | green | 1 |
| W16.C6.05 | green | 1 |
| W16.C6.06 | green | 1 |
| W16.C6.07 | green | 1 |
| W16.C6.08 | green | 1 |
| W16.C6.09 | green | 1 |
| W16.C6.10 | green | 2 |
| W16.C6.11 | green | 1 |
| W16.C6.12 | green | 1 |
| W16.C7.01 | green | 2 |
| W16.C7.02 | green | 2 |
| W16.C8.01 | green | 2 |
| W16.C8.02 | green | 1 |
| W16.C8.03 | green | 1 |
| W16.C8.04 | green | 1 |
| W16.C8.05 | green | 1 |
| W16.C8.06 | green | 1 |
| W16.C8.07 | green | 2 |
| W16.C8.08 | green | 1 |
| W17.L1.01 | green | 1 |
| W17.L1.02 | green | 1 |
| W17.L1.02b | green | 1 |
| W17.L1.03 | green | 1 |
| W17.L1.04 | green | 1 |
| W17.L1.05 | green | 1 |
| W17.L1.06 | green | 1 |
| W17.L1.07 | green | 1 |
| W17.L1.08 | green | 1 |
| W17.L1.09 | green | 1 |
| W17.L1.10 | green | 1 |
| W17.L1.11 | green | 1 |
| W17.L1.12 | green | 1 |
| W18.O1.01 | green | 2 |
| W18.O1.02 | green | 2 |
| W18.O2.01 | green | 2 |
| W18.O2.02 | green | 3 |
| W18.O3.01 | green | 2 |
| W18.O3.02 | green | 1 |
| W18.O4.01 | green | 1 |
| W18.O4.02 | green | 1 |
| W18.O4.03 | green | 2 |
| W19.F1.01 | green | 1 |
| W19.F1.02 | green | 1 |
| W19.F1.03 | green | 1 |
| W19.F2.01 | green | 2 |
| W19.F2.02 | green | 2 |
| W19.F2.03 | green | 1 |
| W19.L1.01 | green | 1 |
| W19.L1.02 | green | 2 |
| W19.L1.03 | green | 1 |
| W19.P1.01 | unspecified | 0 |
| W19.S1.01 | red | 1 |
| W19.S1.02 | green | 1 |
| W19.T1.01 | green | 3 |
| W19.T1.02 | green | 2 |
| W37.BASE.01 | green | 1 |

## Failing tests outside the baseline

-  W07.05 W04.03 W05.10 native shopper socket capability boundary (retained W04.02 oracles) owns bootstrap, frames and post-upgrade private delivery on session
-  unit:W19.S1.01 host: a stored piece naming a slot type no page of the tenant's slots document defines is named in the diagnostics of every write answer and of the catalogue read, counted, and compared against the slots document the answer names

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | b6340dc54b9d951d2e4d823e6f8d9256edf654bd7bbe4c01d246aa940e743ad6 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest.json (outside the checkout) |
| vitest report sha256 | f304e554295688353984068687bf6fff1552f2e3ba3872c514810d09c140fad1 |
| commit | 2e4dfad43390a702b0b7ed20213fe9fdf453afa5 |
| generated | 2026-09-19T17:50:05.190Z |
