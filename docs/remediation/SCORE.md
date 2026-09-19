# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 140/144 · W closed 3/26 (W16–W41) · suite 1962/2043 · residual 81 in 10 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 2 | 2 | no | — | — |
| W06 | 2 | 1 | no | — | — |
| W09 | 1 | 1 | no | — | — |
| W11 | 1 | 1 | no | — | — |
| W16 | 68 | 68 | yes | PASS | b496f72e31a06ee2d997deb3b70b1941fbbf39b7 |
| W17 | 13 | 13 | yes | PASS | 4e2ba2d412602738cfa125d603b9ed29ceb1013d |
| W18 | 9 | 9 | yes | PASS | d78b8140f28386b07a8027da72629bd560c6d947 |
| W19 | 22 | 21 | no | — | — |
| W20 | 16 | 16 | no | — | — |
| W21 | 9 | 7 | no | — | — |
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
| W16.C2.16 | green | 1 |
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
| W16.C5.06 | green | 1 |
| W16.C5.07 | green | 1 |
| W16.C5.08 | green | 1 |
| W16.C5.09 | green | 2 |
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
| W16.C6.13 | green | 3 |
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
| W16.C8.09 | green | 1 |
| W16.C8.10 | green | 1 |
| W16.C8.11 | green | 2 |
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
| W19.F3.01 | green | 1 |
| W19.F3.02 | green | 1 |
| W19.F3.03 | green | 1 |
| W19.F3.04 | green | 2 |
| W19.F3.05 | green | 1 |
| W19.F3.06 | green | 1 |
| W19.F3.07 | green | 1 |
| W19.F3.08 | green | 2 |
| W19.L1.01 | green | 1 |
| W19.L1.02 | green | 2 |
| W19.L1.03 | green | 1 |
| W19.P1.01 | unspecified | 0 |
| W19.S1.01 | green | 1 |
| W19.S1.02 | green | 1 |
| W19.T1.01 | green | 3 |
| W19.T1.02 | green | 2 |
| W20.G1.01 | green | 2 |
| W20.G1.02 | green | 1 |
| W20.G1.03 | green | 1 |
| W20.G1.04 | green | 2 |
| W20.G1.05 | green | 1 |
| W20.G1.06 | green | 2 |
| W20.G1.07 | green | 2 |
| W20.G1.08 | green | 2 |
| W20.G1.09 | green | 2 |
| W20.G2.01 | green | 1 |
| W20.G2.02 | green | 1 |
| W20.G2.03 | green | 1 |
| W20.G2.04 | green | 1 |
| W20.G2.05 | green | 1 |
| W20.G2.06 | green | 1 |
| W20.G2.07 | green | 1 |
| W21.C1.01 | red | 2 |
| W21.C1.02 | green | 1 |
| W21.C1.03 | green | 1 |
| W21.C1.04 | green | 2 |
| W21.E1.01 | green | 2 |
| W21.E1.02 | green | 2 |
| W21.E1.03 | green | 1 |
| W21.E1.04 | green | 2 |
| W21.P1.01 | unspecified | 0 |
| W37.BASE.01 | green | 1 |

## Failing tests outside the baseline

-  W12.02 real native source delivery, both hosts and tenants preserve customer namespaces
-  unit:W21.C1.01 logic: the relative interval is Katz's log interval from the raw rates, and the report vocabulary stays a diagnostic one

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 06b12b3d5a715dc686f99d7be70f7c95b658afdd4cb0f5698255ad6eed83c394 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest.json (outside the checkout) |
| vitest report sha256 | ece524fe2ad3f6de8213795872af7f3dce125992f0729c6e1c60f624c7c834f6 |
| commit | 8ef5ebb0a0940de0c5ac2b9c6d7fbb6fa46bf123 |
| generated | 2026-09-19T22:50:11.874Z |
