# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 10/14 · W closed 0/26 (W16–W41) · suite 1731/1869 · residual 138 in 14 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 1 | 0 | no | — | — |
| W06 | 1 | 0 | no | — | — |
| W09 | 1 | 0 | no | — | — |
| W11 | 1 | 1 | no | — | — |
| W16 | 9 | 9 | no | — | — |
| W37 | 1 | 0 | no | — | — |

## Units

| Unit | Status | Tests matched |
|---|---|---|
| W05.BASE.01 | red | 1 |
| W06.BASE.01 | red | 1 |
| W09.BASE.02 | red | 1 |
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
| W37.BASE.01 | red | 1 |

## Failing tests outside the baseline

_None._

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 8d1219d38f00fb2de1cf65720de20f35122e1aff02899457d3e6d659dbad6b39 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest.json (outside the checkout) |
| vitest report sha256 | 3abda9eb85d42f433199acc83011fb9fe8e0243ac55ecd159a419eb4e1f62411 |
| commit | c70c29ed847538975a287153e8ddaef5e342a688 |
| generated | 2026-09-19T03:06:41.320Z |
