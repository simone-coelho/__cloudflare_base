# W07.01 independent review

Disposition at 2026-09-07T11:53:38.012Z: **C1–C3 pass for the admitted bounded local containment; recommend lead acceptance.** No implementation blocker. Reviewer: /root/w0202_review, gpt-6-astra/xhigh, distinct from implementation; no delegation.

Contract: `7092d0d7077f844850c745b7061c08fb6b6f22e9f2a10f71803b70d244509cb0` (plan-v2 incorporates v1).
Frozen artifact: `4a552d73e7174b089dfb5a4556e101c02991f2e43f9fbd06ea5027dae238df7f`; manifest file SHA-256 `9b9f21d6a0e995ddc6af794fd005f6aad9c8d1a977b9a0d117d2a336bd20eb28`.

## Independent results

Exact commands and full outputs are in [review-checks-v1.json](review-checks-v1.json), SHA-256 `e570b020b47c3424d64364c338d1affd7d5a4604bebfe33c6cdfda0e90738e99`.

- K1: `node node_modules/vitest/vitest.mjs run src/telemetry.boundary.test.ts src/routes/identity.test.ts src/ledger/ledger.test.ts --maxWorkers=1 --minWorkers=1` — exit 0, **54/54 passed**, 13.03s.
- K2: `node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1 -t W07.01` — exit 0, **5/5 passed**, 11.87s; nineteen historical cases deliberately unselected. Actual workerd, compatibility date 2025-06-01 and nodejs_compat, synthetic bindings/outbound blocked.
- Both launched 11:46:47.624Z; completed outputs collected 11:50:38Z. Identity verification completed 11:52:20.143Z: all **184 physical pins**, reproduced **168 local inputs**, all ten worker output hashes and nine retained original source bodies match. Exact local graph coverage has no omissions. Selected W34 service/consent, W03 routers and shared-auth hashes remain unchanged.

## Findings and preserved behavior

**C1:** Independently read the actual baseline probe/nine observations/original sources, current diffs and assertions. Eight raw AE route blocks are withdrawn without replacement. Absent/throwing ANALYTICS controls retain real dispatcher queue/destination payloads (external fetch intercepted), Optimizely service arguments, partial-batch behavior, malformed responses and exact GIF behavior. Health and ledger aggregate controls pass. Erasure operations are unchanged; two unconditional historical AE/log limitations follow unchanged ODP in the receipt.

**C2:** Blanket request logging and default queue-body/scene-success logging are removed; named router/global/entry failure logs emit constant labels. Actual request-path/query/refusal and queue tests preserve default ack/catch retry, cached-scene success/missing-model failure, and ledger write/R2-failure outcomes. Public error-response details intentionally remain.

**C3:** Read complete worker evidence, including successful final app noEmit and scoped diff-check outputs; no duplicate application compile. Worker report SHA-256 `19102ab703f441d5945b4e8e861072aacbf4a6cc33e8b7b4869a3a3547728454`; checks `74cba4d924eaf54859faffb731b1a54e74c09bb4b141301534111a4974c1e9b9`.

History remains intact: v2 corrects only C2's impossible evidence floor; empirical requirements are unchanged. Initial worker TypeScript errors were fixture mock-generic declarations, corrected without assertion/production relaxation; final K1 and noEmit passed. One reviewer read-only identity command had a quoting/parser failure; corrected execution passed, both outputs retained.

## Limits and handoff

Other EventDispatcher/OptimizelyService/scene-generation/WebSocket/scheduled/route logs remain open. Dispatch, ledger and domain writes continue under existing policy; no all-logs-clean or nothing-written-under-refusal claim. Historical deletion, retention/disposition, consent/privacy and dataset authority/attestation remain unresolved.

The graph externalizes packages; no installed-runner/native/full-TypeScript-program or complete baseline-dependency attestation. No deployed, real external-delivery, performance, full W07/finding/gate/customer/release acceptance or prior-proof reclosure. All reviewer processes completed; only these two new review files written. Lead owns final acceptance and governance.

