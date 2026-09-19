# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 40/46 · W closed 0/26 (W16–W41) · suite 1823/1908 · residual 85 in 10 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 2 | 1 | no | — | — |
| W06 | 2 | 0 | no | — | — |
| W09 | 1 | 0 | no | — | — |
| W11 | 1 | 0 | no | — | — |
| W16 | 26 | 26 | no | — | — |
| W17 | 13 | 13 | no | — | — |
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
| W16.C7.01 | green | 2 |
| W16.C7.02 | green | 2 |
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
| W37.BASE.01 | red | 1 |

## Failing tests outside the baseline

_None._

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 29247d480665daece2fe0a68e393539353e244a5f56326b053f1d77b38f323b6 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | suite-final.json (outside the checkout) |
| vitest report sha256 | 178744461ca2d9cd7a47623c6dc89f38e2eb8378f78d79f24b257181b6feedcf |
| commit | 70534345f72056f39db695cd3c86d676583186e5 |
| generated | 2026-09-19T10:10:00.818Z |
