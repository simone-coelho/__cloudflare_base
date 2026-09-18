# W05.03 worker handoff

Source/tests frozen at 2026-09-07T20:12:15.358Z; exact identities and complete command output are in worker-checks.json. Independent K2 and lead acceptance remain pending.

Product sort now uses one strict owned session read or the existing signed, serialized DO snapshot request with a sort-only projection. Stored consent intersects false-only cookie/body hints; either refused switch yields empty affinity, neutral normalized order, zero scores and no private drivers. Necessary refusal persistence precedes acknowledgment. Cold sort no longer creates behavioral state. General snapshot and consenting scoring behavior remain unchanged.

Checks (UTC):

- K1 launched 20:09:03.832Z, completion observed 20:09:53.442Z: **42/42 tests, four suites**, exit 0.
- Application noEmit launched 20:09:05.206Z, completion observed 20:09:53.444Z: exit 0; build metadata stayed in a task-specific /tmp directory.
- Scoped four-file git diff --check: exit 0.

Exact commands/timestamps/raw outputs are retained in worker-checks.json. No worker validation failures or source corrections occurred; expected synthetic error-path diagnostics are not failed tests. Root's earlier baseline setup failure/correction remains in baseline-v1.json, not rewritten here.

Grouped real-route controls cover both hosts/all four consent combinations, genuine consenting reorder/drivers, zero/nonzero dials, cookie/body refusal persistence and explicit enablement, one-read/one-RPC cold behavior, necessary-only records, strict owner/forward/recognized/read/malformed/write failures and DO envelopes. A poisoned private snapshot getter proves refused DO sort skips private computation; general snapshot compatibility is separately asserted.

Limits: local synthetic evidence only; no deployed-runtime/SLO/customer/release claim. General snapshot disclosure, absent-state policy, config/surface mismatch, other ingress, historic privacy, transactional withdrawal/revocation and D03/D06 remain open. No SDK/build/native/network/operational checks or new harness. No pending processes or further edits.
