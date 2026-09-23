# Current checkpoint

**2026-09-23: the remediation runs under the Closure Ledger** (the owner's go, 2026-09-23). Read `AGENTS.md`, then `tools/closure-ledger/BOOTSTRAP-MEMO.md`.

- Integration branch `rem/integration`, from `798f2a7` (the state at the 2026-09-20 stop; last product merge `ee44579`), checked out at `/home/simonecoelho/rem/integration`. The `/mnt/c` working tree and `feature/real-time-personalization` are another team's demo work: never commit there.
- Step 1 done: Closure Ledger 0.1.0 in `tools/closure-ledger/`; the 26-ticket scaffold W16–W41 in `docs/remediation/delivery-control/`. It fails `check` by design until every work order is filled.
- Next, step 2: the lead drafts the 26 work orders and the owner freezes them in one review. Then the specification gates (new tests for W33–W41), one adoption pass over W16–W29, and one ticket at a time.
- Under the frozen method, 4/26 were closed (W16, W17, W18, W20). Unmerged builds are kept on `rem/w30-b1-build` `1c4d153`, `rem/w31-b1-build` `36f3e72` and `rem/w32-b1-build` `e97fa8b`; evidence in `/home/simonecoelho/rem/_evidence/`. Nothing pushed; push authority not granted.
