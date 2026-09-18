# W06.05 worker handoff

Frozen local candidate for independent review; no worker self-acceptance. Sole worker `w0602-worker`, gpt-6-astra/xhigh, no subdelegation. Contract `c1c24e03164a9cd5e9913747ef8aed4c4548a4967b9dd270f34d296c476f412b`.

The strict exact-key reader reuses active-tombstone validation, including completed scans; only an explicit absent key is no barrier. History checks normalized event time against both supplied visitor and resolved target cutoffs before any session/DO/history mutation. Skips retain request indexes; post-cutoff rows remain eligible. A DO import requires successful HTTP plus `ok:true`, exact `applied` count and valid audiences before reporting applied/history metadata. Online fan-out validates ID-carrier/envelope agreement and checks the retained cutoff before ring append, personalized exposures or outcome attribution. Missing/unavailable/corrupt STORAGE fails closed; the background API remains nonthrowing.

Exact K1 passed50/50 on its first run: identity31, holdout5, consent14 (16.76s). App noEmit, six-file admission-before/current diff and whitespace passed. Full commands/timestamps/outputs and all six original source contents/hashes are in worker-checks.json; no failed check attempts. Grouped existing fixtures exercise both actual history hosts, actual DecisionRing/LearnStats state and credits over synthetic backing storage, complete cutoff/tenant/subject/report checks, storage/carrier/DO-ack failures, holdout and consent positives. A held barrier read proves fan I/O waits while the content response returns; this is an ordering assertion, not a latency benchmark. Positive fixtures explicitly provide empty STORAGE.

Only three production modules, three existing fixtures and these two worker evidence files changed. Final source SHA256:

- `src/ledger/erasure.ts`: `e5508888c2491dab8b5bbe0ec9d5e01c4beb68be63e96d6e6761281b0ffc530b`
- `src/identity/history.ts`: `77d37606e7c386c2f0bb2609f44c13b8329111c7bb7e904dbc4293c8a36faf84`
- `src/learn/fan.ts`: `110192a195b7d18d001e17ba657ddd54adb96d30823262ee74ef9ddeabaf3273`
- `src/routes/identity.test.ts`: `8f09f1c653e9919dc98fdd52a97bc29d31a5b758a44ebd0fc4ee98e4a4826f2b`
- `src/learn/holdoutArms.test.ts`: `1ffabd622521b181662fc6271fa5602db4ad1ab3f6a446c32ddae50ef7c4ea8d`
- `src/content/consent.test.ts`: `53f073abe810512a571c5dafd7f9c91a73f2fb2342776c06a316128556a17a73`

Limits: point-in-time entry suppression, not D03 concurrent/deferred-writer fencing or D06 retention/re-entry policy. No stale capability/socket revocation, existing-ring reader filtering, seen migration, orphan discovery, D1/telemetry/log/external erasure, historical-statistics rebuild or full W06/physical/customer/release acceptance. History import is not a durable transaction: an accepted target may precede a later-target failure, and replay idempotency/partial-import recovery remain outside this remedy. Rollback must retain equivalent active-cutoff enforcement and existing barriers; removing it reopens the two replay paths. Independent review/lead disposition is next; no further worker writes after freeze.
