# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 57/63 · W closed 0/26 (W16–W41) · suite 1847/1932 · residual 85 in 10 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 2 | 1 | no | — | — |
| W06 | 2 | 0 | no | — | — |
| W09 | 1 | 0 | no | — | — |
| W11 | 1 | 0 | no | — | — |
| W16 | 47 | 47 | no | — | — |
| W17 | 9 | 9 | no | — | — |
| W37 | 1 | 0 | no | — | — |

## Units

| Unit | Status | Tests matched |
|---|---|---|
| W05.BASE.01 | red | 1 |
| W05.BASE.05 | green | 2 |
| W06.BASE.01 | red | 1 |
| W06.BASE.02 | red | 1 |
| W09.BASE.02 | red | 1 |
| W11.BASE.01 | red | 2 |
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
| W17.L1.01 | green | 1 |
| W17.L1.02 | green | 1 |
| W17.L1.02b | green | 1 |
| W17.L1.03 | green | 1 |
| W17.L1.04 | green | 1 |
| W17.L1.05 | green | 1 |
| W17.L1.06 | green | 1 |
| W17.L1.07 | green | 1 |
| W17.L1.08 | green | 1 |
| W37.BASE.01 | red | 1 |

## Failing tests outside the baseline

_None._

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 87ace4d120df45ce6ef4cb402b3863ae171eaf00c1ae88a63730db9eca50dd03 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | suite.json (outside the checkout) |
| vitest report sha256 | 4f3429efcf95dd505a12e2df2843ce148a49e6a2e690a9c55dece52a956c0cbd |
| commit | 70830044ce31e1ab8f0de8dc90356f5fa84a04fa |
| generated | 2026-09-19T09:28:09.099Z |
