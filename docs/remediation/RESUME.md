# Current checkpoint

**2026-09-23: the remediation runs under the Closure Ledger** (the owner's go, 2026-09-23). Read `AGENTS.md`, then `tools/closure-ledger/BOOTSTRAP-MEMO.md`.

## Current state (2026-09-25)

- Status: Local done 4/26 (W16 delivered at `db0ef5c`, merged `491ffc4`; W17, W18, W31 adopted at `0c19026`) · Final 0/26. No owner question is open.
- W19 ACTIVE: build from its specification `6af410e` (rem/spec-w19-w20) merged with `rem/integration`; the remaining work is the three product defects the corrected legacy test W19.02 exposes (D-a serving cache, D-b bare 500 on the object host, D-c catalogue read with REFLEX_ENABLED false). Brief findings: `/home/simonecoelho/rem/_evidence/W19-delivery/implementer/BRIEF-draft-findings.md`.
- The owner approved A43–A46 on 2026-09-25 ("It is approved."), applied with `/home/simonecoelho/rem/_evidence/step3/apply-amendments-2.mjs`: W30 becomes an implementation ticket after W29 (L1 late-row republish, S1 repaired wording); W37 gains T7 (fresh-stamp creation) and the four export paths; W40 gains P6 (the release lint excludes `src/units/**`, cap 582). Before those builds, a specifier adds the W30 L1/S1 and W37 T7 tests and the reviewer re-gates them; W40 P6 rides the existing deploy test.

- Integration branch `rem/integration`, from `798f2a7` (the state at the 2026-09-20 stop; last product merge `ee44579`), checked out at `/home/simonecoelho/rem/integration`. The `/mnt/c` working tree and `feature/real-time-personalization` are another team's demo work: never commit there.
- Step 1 done: Closure Ledger 0.1.0 in `tools/closure-ledger/`; the 26-ticket scaffold W16–W41 in `docs/remediation/delivery-control/`. It fails `check` by design until every work order is filled.
- Step 2 done: all 26 work orders are in `program.json`, frozen by the owner on 2026-09-24 ("Let's go with your recommendation"), the ten pre-filled decisions included. `check` fails only on the 26 specification gates (four TBD fields each).
- Step 3 done (2026-09-24): every ticket has a reviewed acceptance test (26 specification gates in `program.json`; evidence under `/home/simonecoelho/rem/_evidence/step3/`); `check` passes; `next` is W16. The frozen integration gate passes at the head. Spec branches `rem/spec-*` hold each ticket's reviewed tests (not merged until its build lands). Owner questions open: A43 (W37 paths), A44 (release lint), A45 (fresh-stamp creation), A46 (W30 becomes a build ticket) in `_evidence/step3/AMENDMENTS.md`.
- Adoption done (2026-09-24): W17, W18 and W31 have ADOPTION receipts at `0c19026` (candidate `rem/adopt-2` = the W31 build merged; reviewer reports under `/home/simonecoelho/rem/_evidence/adoption-2/`). W30 failed its adoption on two defects (`_evidence/adoption-1/reviewer/REPORT.md`) and is not merged. W16 is ACTIVE; its build runs on `rem/w16-build`.
- Under the frozen method, 4/26 were closed (W16, W17, W18, W20). Unmerged builds are kept on `rem/w30-b1-build` `1c4d153`, `rem/w31-b1-build` `36f3e72` and `rem/w32-b1-build` `e97fa8b`; evidence in `/home/simonecoelho/rem/_evidence/`. Nothing pushed; push authority not granted.
