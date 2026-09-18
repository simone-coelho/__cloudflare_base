# W01.02 — episode 2 worker runtime revalidation

Verdict: **PASS for K1 / C1–C2 on the current source**. Actor `w0102-v2-worker`, run `/root/w0102_reval_worker`, requested gpt-6-astra/xhigh. This is worker evidence, not an independent review or lead acceptance. Lead admitted episode 2 at journal sequence 35, 2026-09-07T01:05:55Z; the test began afterward. I read the root instructions, execution entry point, complete governance, checkpoint, both plans, actual task acceptance contract, complete canonical W01 and linked F01/F03/F25/F33/N01/N03/N04, prior acceptance and actual source/test/auth delta.

## Basis and bounded change

This episode makes no engine, example or test edits. W01.02's raw `/api` router remains removed and its early normalized-path rejection remains unchanged. W02.01 added the signed refresh-token purpose rejection in shared JWT middleware. The previous raw-boundary acceptance therefore needs current-source runtime proof; it is retained as history, not overwritten.

Admitted [plan-v2](../../design/W01.02/plan-v2.md) SHA256 `4052a4f294dd033e9cd292f4b5db93d7ffe8f86a4a19a7b62d68df115b25fd94`; contract `1f49f73b5ebd0d4a2b25fe6c52325d22113c704c24cacffbf72ad72644f4fc7c`; [artifact-manifest-v2](artifact-manifest-v2.json) digest `9b401e92a09329e30a7c747e0a1d53de23976fa95dad756bbea01ad1dfc02ada`, file SHA256 `1abe4e8644afa5be814c716f7a4eca99fcde2cc46c07054e80f7f420ef2240e4`.

At 2026-09-07T01:02:43.749Z I independently hashed all 895 file entries in the prepared v2 manifest: zero mismatches. Comparison with v1 found exactly one changed entry, `src/middleware/auth.ts`; all other 894 entries matched v1. The lead subsequently updated only episode actor/contract metadata, changing the manifest digest before admission. At 01:06:55.494Z, after the test had finished, I rechecked the admitted manifest and relevant source identities:

| File | SHA256 |
|---|---|
| src/index.ts | 840a34f2ebe134ed3e584870b03034f7bef2c1c9c8203123791546c42419aac7 |
| src/index.api-boundary.test.ts | fa0226efd8c6cf5aef7cead7ca20c2a202c56eb3df73fb455dca9274319bf997 |
| src/middleware/auth.ts | a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea |

`src/routes/api.ts` remains absent. HEAD `e49aef83c9a9843dd21479f1b08d53e7709fac41`, branch `feature/real-time-personalization`; canonical document 35 SHA256 `34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf` unchanged. Both required preflight board check/status commands returned exit 0 and `Tracker VALID` on their captured pre-admission register, with the expected historical W01 source/revalidation notes. Those commands validate consistency only; lead owns subsequent current/prior and closure validation.

## Actual execution

```bash
node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1
```

Invocation 2026-09-07T01:06:31Z; Vitest start 01:06:33Z; completion observed 01:06:55Z. Exit 0, **20/20 tests passed; no failed or skipped tests**. Vitest duration 13.48 seconds, test execution 5.207 seconds. [Retained actual stdout/stderr](worker-k1-v2.txt), with only ANSI colors removed, SHA256 `4a769b0cb925d6e788fbb25f1fd94860459de0a20aef9c8ffbeda782aaeebab8`. The existing Vite CJS deprecation warning is retained and did not fail execution.

C1: 400 denied probes pass the unchanged assertions: 160 combinations of ten former raw operations, four credential states and four AUTH_MODE values; 240 HEAD/OPTIONS/unsupported-method/encoded-path/dot-segment/malformed-input/upgrade combinations. Every denial requires generic 404, bodyless HEAD, zero environment access/enumeration, destination attempts, before/after state changes, logs and deferred work, with no CORS capability, cookie, rate-limit header or private response marker. The actual Worker default export, Hono normalization and real middleware are used; destinations have working synthetic reads/writes rather than throwing or always missing.

C2: 11 retained-route probes pass for `/api-info`, live/ready health, an unrelated missing path, real JWT `/auth/me` authorization and SDK-authorized non-default-tenant trend reads. Accepted account and SDK requests reach their exact synthetic destinations; missing/invalid credentials deny without destination reads. The `/api-info` control requires two captured log lines so the zero-log denial sensor cannot silently fail. These 11 controls include negative controls; they are not 11 successful HTTP responses.

Original pre-fix successful-effect evidence remains in [worker.md](worker.md) and [review-v1.md](review-v1.md). I did not rerun that baseline in this worker episode: the separate reviewer owns the explicitly composed original-index/api replay with current shared-auth dependencies and K2/C3. The new K1 above is the complete current-source suite, without a filter or source override. I did not rerun unrelated regression/typecheck suites because this evidence-only episode changes no implementation beyond the already accepted W02 guard; W02's fresh regression proof and W01's prior evidence remain separately attributed. No required worker K1 case was omitted.

## Environment, limitations and handoff

Locally confirmed versions: Node v22.15.0, Vitest 1.6.1, esbuild 0.28.1, Miniflare 4.20260625.0, workerd 1.20260625.1, Hono 4.12.27, jose 5.10.0, Agents 0.16.2, Partyserver 0.5.8 and unenv 2.0.0-rc.24. Existing compatibility date 2025-06-01 and nodejs_compat adapters are unchanged. Workerd executes the real bundled default export with synthetic binding adapters/data; application outbound service throws/counts attempts and the teardown's zero-outbound assertion passed. The local test transport uses loopback. Runtimes were disposed and no worker command remains active.

This supports `runtime_test` / `local_runtime` C1–C2 only. It does not attest deployed routing/assets, native cloud resources, customer behavior, SLOs, other mounted surfaces, tenant membership, full W01/W02, findings, gates or release. Source, dependency, configuration or workload changes affecting these assumptions require fresh scoped proof. No real credentials/customer data, deploy/cloud operation, install/seed, git mutation, unrelated cleanup or v1 evidence edit occurred. The only worker writes are this report and its new output file.

Next action: independent `/root/w0102_reval_review` evaluates C1–C3 and its own runtime/replay results; lead `/root` checks evidence, accepts or returns the bounded task, and updates tracker/journal/checkpoint. Worker does not self-close. This episode has no engine rollback; reversing either accepted source fix would reopen its exposure and invalidate proof.
