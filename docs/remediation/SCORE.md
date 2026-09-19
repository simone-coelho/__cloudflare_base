# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 46/54 · W closed 0/26 (W16–W41) · suite 1829/1923 · residual 94 in 13 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 2 | 1 | no | — | — |
| W06 | 2 | 0 | no | — | — |
| W09 | 1 | 0 | no | — | — |
| W11 | 1 | 0 | no | — | — |
| W16 | 47 | 45 | no | — | — |
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
| W16.C4.05 | red | 2 |
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
| W16.C6.10 | red | 2 |
| W16.C6.11 | green | 1 |
| W16.C6.12 | green | 1 |
| W16.C7.01 | green | 2 |
| W16.C7.02 | green | 2 |
| W16.C8.01 | green | 2 |
| W37.BASE.01 | red | 1 |

## Failing tests outside the baseline

-  alarm — lazy re-evaluation, exits pushed, retention deleteAll a fresh instance rehydrates from storage (hibernation wake) and still exits on alarm
-  alarm — lazy re-evaluation, exits pushed, retention deleteAll fires at the crossing, pushes the exit envelope (hero reverts), re-arms for the slower dimension
-  applyHistorical: an action arriving late a row older than the last touch is discounted and never moves t backwards
-  computeNextAlarm — closed-form crossing vs retention horizon per-dimension τ overrides are respected (priceBand crosses later than line)
-  ingest — one reducer behind both doors GET /snapshot returns the GET /realtime/reflex shape
-  ingest — one reducer behind both doors three brisk views enter the affinity audiences and push the full envelope over the DO’s own socket
-  mergeReflexStates: the sum of what each device knew respects a per-dimension horizon
-  unit:W16.C4.05 host: a new threshold version applies to subsequent decisions, an invalid set is refused, and nothing published fails closed to the first stage, on both hosts
-  unit:W16.C6.10 sdk: the real SDK entry keeps a direct-mode proof in tenant-scoped storage and presents it on the next cold start, and in broker mode never holds one

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 2ee8c5ccd28234e5bcb623c16d718106bffb9e6f45c93423f7a6751380e0e720 |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | suite.json (outside the checkout) |
| vitest report sha256 | fb46df9e13b642be8c3be3828faaba8ff49f88c31239f7e1b45431f005af38a9 |
| commit | 14180b51747efb07f120001424655d13c6aa1fb0 |
| generated | 2026-09-19T05:12:52.794Z |
