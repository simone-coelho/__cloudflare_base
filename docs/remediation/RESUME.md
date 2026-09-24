# Current checkpoint

**2026-09-23: the remediation runs under the Closure Ledger** (the owner's go, 2026-09-23). Read `AGENTS.md`, then `tools/closure-ledger/BOOTSTRAP-MEMO.md`.

- Integration branch `rem/integration`, from `798f2a7` (the state at the 2026-09-20 stop; last product merge `ee44579`), checked out at `/home/simonecoelho/rem/integration`. The `/mnt/c` working tree and `feature/real-time-personalization` are another team's demo work: never commit there.
- Step 1 done: Closure Ledger 0.1.0 in `tools/closure-ledger/`; the 26-ticket scaffold W16–W41 in `docs/remediation/delivery-control/`. It fails `check` by design until every work order is filled.
- Step 2 done: all 26 work orders are in `program.json`, frozen by the owner on 2026-09-24 ("Let's go with your recommendation"), the ten pre-filled decisions included. `check` fails only on the 26 specification gates (four TBD fields each).
- Step 3 (acceptance tests, one review per ticket): the owner approved the 42 step-3 amendments on 2026-09-24; 17 specification gates are recorded in `program.json`; `check` fails only on the gates of W16, W22, W26, W27, W35, W37, W38, W39 and W40. The frozen integration gate passes at the head (4fbdddc: 79 failures, 0 outside the baseline). Evidence and the durable generator are in `/home/simonecoelho/rem/_evidence/step3/`. Then the adoption pass (W17, W18; W30 and W31 verified) and one ticket at a time.
- Under the frozen method, 4/26 were closed (W16, W17, W18, W20). Unmerged builds are kept on `rem/w30-b1-build` `1c4d153`, `rem/w31-b1-build` `36f3e72` and `rem/w32-b1-build` `e97fa8b`; evidence in `/home/simonecoelho/rem/_evidence/`. Nothing pushed; push authority not granted.
