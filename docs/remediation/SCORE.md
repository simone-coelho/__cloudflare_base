# SCORE — remediation W16–W41

Derived by `scripts/remediation/score.mjs` from the vitest JSON report. No count in this file is
typed by hand: `--check` re-derives every line above the provenance marker and exits non-zero on
any difference. A W item is closed only when it has declared units, all of them are green, and
`docs/remediation/reviews/<W>.json` records a reviewer PASS at a named commit.

Units 19/25 · W closed 0/26 (W16–W41) · suite 1747/1887 · residual 140 in 15 files · typecheck GREEN

## W items

| W | Declared | Green | Closed | Review | Review sha |
|---|---|---|---|---|---|
| W05 | 1 | 0 | no | — | — |
| W06 | 1 | 0 | no | — | — |
| W09 | 1 | 0 | no | — | — |
| W11 | 1 | 0 | no | — | — |
| W16 | 20 | 19 | no | — | — |
| W37 | 1 | 0 | no | — | — |

## Units

| Unit | Status | Tests matched |
|---|---|---|
| W05.BASE.01 | red | 1 |
| W06.BASE.01 | red | 1 |
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
| W16.C3.01 | green | 3 |
| W16.C3.02 | green | 1 |
| W16.C3.03 | green | 1 |
| W16.C3.04 | green | 2 |
| W16.C3.05 | green | 1 |
| W16.C3.06 | red | 1 |
| W16.C3.07 | green | 1 |
| W16.C3.08 | green | 2 |
| W16.C3.09 | green | 2 |
| W16.C7.01 | green | 2 |
| W16.C7.02 | green | 2 |
| W37.BASE.01 | red | 1 |

## Failing tests outside the baseline

-  W04.02 owned shopper lane unit:W09.BASE.02 /sort answers 200 read-only for a linked non-default-tenant owned profile; recovery admission while durable recovery is disabled never surfaces as an untyped 500 on a read path preserves working non-default-tenant profiles on both hosts, signed upgrade, actual SIDs and owned operation counts
-  W05.10 explicit timed authority on do unit:W11.BASE.01 a typed owner or consent refusal raised inside a publication storage read propagates as the 401 refusal on both hosts; it is never rewritten into a configuration-authority error rechecks the choice at the actual post-config behavioral commit
-  W35.02 visit context unit:W06.BASE.01 a cold /realtime/personalization/:subject read on a consent-only owned record serves without write activity instead of answering 500 for a missing retention birth carries first-paint and live return context into actual both-host cells without read activity
-  W37.04 tenant-owned runtime configuration unit:W37.BASE.01 with the configuration publication authority absent, invalid or unreadable, every shopper route including /realtime/personalization/:subject and /realtime/action answers a 4xx/5xx refusal; none serves fails explicitly on missing/invalid/outage tenant config before behavior/link/import, preserving refusal and retention
-  absorbIntoShopper: the first link unit:W05.BASE.01 after a link, a browser write under the old cookie lands on the person record; the consent-scope check honours the linked owner (forwardTo/identity.shopperId), not only raw.userId the old cookie reads the person, and a write from the browser lands on the person without renaming it
-  unit:W16.C3.06 logic: the learned lift applies on top of the seeded base, and the seeds change neither the learned statistics nor the receipt's learned-influence field

## Derivation inputs

| Input | Value |
|---|---|
| units | docs/remediation/units.json |
| units sha256 | 97c41c8fa4a9def53daff32243ed15c12d7934a2b3e5a3f1b3db221a4090d18c |
| reviews | docs/remediation/reviews |
| baseline | docs/remediation/baseline-failures.json |
| typecheck | GREEN (from --typecheck) |

<!-- provenance below is derived per run and is NOT compared by --check -->

## Provenance

| Input | Value |
|---|---|
| vitest report | vitest.json (outside the checkout) |
| vitest report sha256 | 02fd67e09aedbe0e9a43af1cbf019594b0fa95e6d4a5281cabcdb4ea15fe6116 |
| commit | a75e8734ceda44eb5bff6bba484671cd89fc0a8e |
| generated | 2026-09-19T02:39:41.593Z |
