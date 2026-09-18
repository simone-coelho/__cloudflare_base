# W01.02 — episode 2 independent review

Reviewer /root/w0102_reval_review, actor w0102-v2-reviewer, gpt-6-astra/xhigh; distinct from worker /root/w0102_reval_worker. Reviewed 2026-09-07 after episode admission at 01:05:55Z, journal sequence35.

**PASS: C1–C2 and the independent technical review required by C3. No bounded rework required.** This E4 independently corroborates and accepts the bounded E3 current-source runtime claims in [worker-revalidation-v2.md](worker-revalidation-v2.md), SHA256 2f9cacc1c8aad6a16e1873f7a30bb3d11ab217b62e0f3037c5219b409a53c478, and its actual [K1 output](worker-k1-v2.txt), SHA256 4a769b0cb925d6e788fbb25f1fd94860459de0a20aef9c8ffbeda782aaeebab8. E3 and this E4 support fresh bounded task acceptance. Lead disposition and a final accepted handoff remain the lead's separate C3 obligation; this review does not close the task or any package/finding/gate.

## Scope and actual artifact

Read root AGENTS, README, complete governance36/RESUME, the actual task C1–C3/K1/K2, both plans, complete canonical W01 and linked F01/F03/F25/F33/N01/N03/N04 plus customer §1.7, prior worker/review/acceptance, actual entry/test/auth source and full scoped removal diff. Required preflight board check/status both returned exit0, Tracker VALID, with expected historical-source revalidation warnings; the lead owns admission/closure consistency validation.

The current artifact is [manifest-v2](artifact-manifest-v2.json), digest 9b401e92a09329e30a7c747e0a1d53de23976fa95dad756bbea01ad1dfc02ada, file SHA256 1abe4e8644afa5be814c716f7a4eca99fcde2cc46c07054e80f7f420ef2240e4. Approved plan SHA256 4052a4f294dd033e9cd292f4b5db93d7ffe8f86a4a19a7b62d68df115b25fd94; contract 1f49f73b5ebd0d4a2b25fe6c52325d22113c704c24cacffbf72ad72644f4fc7c. Fresh actor/contract metadata was registered before either new runtime run; previous runs and accepted v1 evidence remain historical.

I independently read/hashed all895 declared current files, first in preflight and again after runtime execution. Zero mismatches. Exactly one v1 input differs: shared auth.ts changed from 65a1553ae0d93627f82f5c6dd3f5acb8ee3a8b94b7d82955c15098d3c1317492 to a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea. The other894 identities match v1. Index SHA256840a34f2ebe134ed3e584870b03034f7bef2c1c9c8203123791546c42419aac7 and test SHA256fa0226efd8c6cf5aef7cead7ca20c2a202c56eb3df73fb455dca9274319bf997 are unchanged. Raw api.ts remains absent, and live scoped git diff exactly matches retained implementation.patch. Caller search found no remaining raw-route reference in scoped src/scripts/examples/public, excluding tests/maps/JSON; repository absence is not evidence about external callers.

The four-line W02 guard rejects a cryptographically verified refresh payload before roles, auth context or protected dispatch. Existing untyped JWT controls still pass. The raw-API rejection remains before all auth/Agent/environment dispatch and uses the same Hono path decoder as routing; this shared-auth change does not bypass that boundary. No new customer-specific behavior or engine edit belongs to this episode.

[Independent read-only artifact probe](reviewer-artifact-v2.mjs), SHA256 f71785432e72aefd44789a74bba81d2e71b67ff83989b34e78b3285dd7c39756, rebuilt the actual frozen wrapper with the same esbuild resolution/configuration. At01:07:58.931Z all871 dependency inputs matched the retained graph: zero missing/surplus/uncovered inputs; all870 real files covered and virtual wrapper pinned by test identity. Original index/api snapshots also matched their recorded original hashes after removing their one retained-file terminal newline.

## Independently executed checks

[Retained runtime and graph evidence](reviewer-runtime-v2.json), SHA256 008ae45c76a28c6c46b46ad902e51333e8095a2997c92ca9697364f932db9de7, contains exact commands, timestamps, outputs and all ten replay trace records.

K1, invoked01:06:44UTC (Vitest local start21:06:46, equivalent01:06:46UTC):

```bash
node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1
```

Exit0: **20/20 tests passed, zero skips/failures**,13.37s. C1 covers400 denied requests:160 former-operation/auth-mode/credential combinations plus240 method, HEAD, OPTIONS, encoded/dot-segment/malformed and upgrade variants. Every denial asserts generic404, bodyless HEAD, zero environment access/enumeration, destination calls, state changes, logs and deferred work, without private output, cookies or CORS/rate-limit capability headers. C2's11 retained-route probes passed, including negative credential controls; these are not11 successful HTTP responses. Real JWT/SDK acceptance reaches exact synthetic account/CACHE destinations, and the positive two-line /api-info log assertion verifies the negative-log sensor.

Composed original-route replay, independently invoked01:06:44UTC:

```bash
W01_02_BEFORE=1 W01_02_TRACE=1 node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1 -t 'AUTH_MODE=enforced.*rejects all ten raw operations for operator|uses real JWT|retains SDK'
```

Expected exit1: one selected denial test failed, two retained JWT/SDK control tests passed,17 cases unselected by the explicit reproduction filter;12.49s. This **composes hash-checked original index/api with CURRENT shared-auth dependencies in memory**, not the complete historical pre-W02 tree. No live source was restored. All ten raw requests returned200 using a valid untyped read-role JWT. CACHE/R2/StateManager GET disclosed three private sentinels; CACHE/R2 PUT/DELETE, queue POST and real StateManager PUT made six actual state mutations. Each request executed rate-limit calls and two logs. Analytics GET only echoed the supplied marker; it performed no Analytics Engine query.

The replay produced80 expected soft-assertion failures within its one denial test. The tool truncated repetitive middle diagnostic detail; the evidence explicitly retains all ten complete operation/effect trace records and the final test summary, not a falsely claimed complete diagnostic transcript. The current-source K1 output is complete. Before/after discrimination therefore rests on working destinations and successful valid-credential controls, not missing stores, invalid authorization or sensor failure.

The worker separately ran unchanged K1 after admission:20/20 passed,13.48s. I read its full frozen report and actual output and checked their hashes. I did not relabel that run as mine. No further engine change occurred, so unrelated regression/typecheck suites were not repeated; the accepted W02 guard's separate75-test/typecheck evidence and prior W01 evidence remain independently attributed.

## Limits and handoff

Node v22.15.0 with installed Vitest1.6.1, esbuild0.28.1, Miniflare4.20260625.0/workerd1.20260625.1 and Hono4.12.27. Actual bundled Worker default export and real authorization/router modules execute with synthetic working binding adapters, compatibilityDate2025-06-01/nodejs_compat and the existing native-path/createRequire/unenv-os adapters. Loopback test transport only; outbound application service denies/counts attempts and the zero-outbound teardown assertion passed. Runtime instances were disposed; no reviewer process remains.

This verifies the bounded current-source raw-path containment in local workerd. It does not attest native/deployed resource state, assets/SPA routing, other Agent/demo/operator/document/webhook surfaces, tenant membership, historical background work, customer behavior, SLOs or full W01/W02/G0/G1 closure. Previous v1 proof and history were preserved. Reviewer writes are only this new report, its new runtime evidence and read-only artifact probe. No source/test/example/v1/governance edit, real data/credential operation, external deployment, install/seed, git mutation or storage cleanup occurred.

Next: lead inspect this technical review and the exact evidence, complete separate acceptance/handoff, register fresh runtime/design-review proof, and supersede only the affected current-source evidence while retaining v1 history. Reversing either accepted engine change would reopen its exposure and require new proof. No implementation rollback belongs to this evidence-only episode.
