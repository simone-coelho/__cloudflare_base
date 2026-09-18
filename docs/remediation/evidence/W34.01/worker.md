# W34.01 worker handoff

OFF-only production containment is implemented and frozen. `serveContentDecisions` no longer imports/invokes `scoreExternal`, constructs its request, reads its adapter bindings, or waits for its promise. Configured positive-weight/non-default terms receive existing unavailable metadata: `external scoring disabled by deployment policy`, `ms: 0`, no contribution or captured external scores. Table lookup is also withdrawn. No enabling flag or helper/schema/replay/UI change was made.

Source SHA256:

- service.ts: `dff26109e9389cacb1f2bfae4db220f926bbaca6b10376023535e46a3b1a2bf8`
- consent.test.ts: `83bd9de816cb610913a80e45df44ca32742f566a8281ad0961e991a073f37b09`

The existing successful KV/DO fixture gained six bounded cases: HTTP, binding, AI, table, zero-weight and default arm. Adapter calls/property reads and ext:* lookups stay zero while ordinary choices and shopper/ring effects succeed. The disabled table receipt replays equal. Existing suites retain gamma, consent, deterministic scoring and historical external-score replay.

Exact commands, complete outputs, UTC start/collection times and failures are in [worker-checks.json](worker-checks.json). Final declared four-suite K1 passed 33/33 in 15.33s; application noEmit TypeScript and scoped diff check exited 0. TypeScript metadata is only under /tmp/w3401-typecheck.Afav3u.

Retained failures: initial K1 passed 29/33 because the new positive-control shopper label incorrectly included the default tenant prefix; corrected against existing tenancy code. Initial TypeScript caught cleanup returning VitestUtils; changed its callback to return void. Production and external-effect assertions were not weakened. The final exact-source rerun passed after both fixture corrections.

Baseline remains immutable with its reported 52-input/full-graph-not-captured limitation. This is local synthetic containment, not deployed/native-runtime, latency, customer, full W34/F30 or release acceptance. Immutable table publication and any authorized seam remain open. No pending processes; independent review and lead disposition are next.
