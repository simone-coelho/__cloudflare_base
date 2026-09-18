# W01.02 independent review

Reviewer `/root/w0102_review`, gpt-6-astra/xhigh, separate from implementer `/root/w0102_impl`; reviewed 2026-09-06. **PASS for the bounded local W01.02 contract C1–C3.** This E2 independently corroborates and accepts the bounded implementation/runtime claims in [E1 worker handoff](worker.md), SHA256 `22cdb63db48c38e55be2a99bdd2d0fa64f5a98240782078b25157e36a7efcdc9`. E1 and this E2 support task acceptance; the lead retains final disposition. No full W01/N01/finding, customer, gate or release closure is asserted.

## Frozen artifact and source review

Read the admitted plan, full canonical W01 scope/linked findings, actual Worker entry, deleted router, caller sites, auth/Hono/Agents dispatch and complete scoped diff. The guard uses Hono's actual strict-path decoder and rejects exact `/api` and `/api/...` before binding discovery, middleware, logging or CORS. Router implementation/import/mount, raw rate-limiter attachment/import and API advertisement are removed; `/api-info` remains reachable. No product-runtime raw-route caller was found in source/scripts/public/bundles; obsolete example functions were removed. Repository absence does not establish absence of external callers.

Reviewed identity:

| Artifact | SHA256 |
|---|---|
| `src/index.ts` | `840a34f2ebe134ed3e584870b03034f7bef2c1c9c8203123791546c42419aac7` |
| `src/index.api-boundary.test.ts` | `fa0226efd8c6cf5aef7cead7ca20c2a202c56eb3df73fb455dca9274319bf997` |
| [artifact-manifest-v1.json](artifact-manifest-v1.json) | `72ebbfbd17e6cac4826f0c3b03a04cca61a540f3b15f5d25d40ed83fdf288ea5` |

Manifest artifact digest: `d086724c1a705e182ba0061b48a701e09621fc13c5518ce305012c9d4c636e6a`. Independently rebuilt the frozen test's embedded wrapper with its esbuild resolution settings: all **871 inputs matched**, no missing/surplus input, current index included and deleted API absent. Read and hashed all **895 manifest files**, with zero mismatches and all 870 real build inputs covered; the virtual wrapper is in the pinned test. Live scoped `git diff` exactly matched [implementation.patch](implementation.patch); `src/routes/api.ts` is absent. Independently checked original source snapshots against prechange hashes after stripping their single added terminal newline.

## Independent execution

All runs used installed local Miniflare/workerd and the real Worker default export, Hono, JWT verifier and StateManager; no replacement router or auth mock. Synthetic successful stores, account records, credentials and namespace spies; outbound service denied/counts attempts; runtimes disposed. Node v22.15.0, Vitest 1.6.1, esbuild 0.28.1, Miniflare 4.20260625.0, workerd 1.20260625.1; compatibility date 2025-06-01 with nodejs_compat. The test's native path/createRequire and installed unenv/os compatibility adapters were inspected.

Original-source replay, independently run at 23:47:15Z:

```bash
W01_02_BEFORE=1 W01_02_TRACE=1 node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1 -t 'AUTH_MODE=enforced.*rejects all ten raw operations for operator|uses real JWT|retains SDK'
```

Expected exit 1: one denial test failed, two JWT/SDK controls passed, 17 tests unselected by the reproduction filter; 13.21s. All ten raw operations returned 200 with a valid synthetic read-role operator JWT: CACHE/R2/StateManager GET disclosed private values; CACHE/R2 PUT/DELETE, queue POST and real StateManager PUT changed the synthetic destinations (six mutations). Each request made rate-limiter calls and two captured Hono log writes. Analytics GET only echoed the query; it made no Analytics Engine query. This failure establishes genuine before/after discrimination, not rejection caused by missing credentials, absent destinations or fixture exceptions.

Fixed-source command, independently run at 23:47:15Z with `W01_02_EXTRA_CASES` set to the JSON below:

```bash
node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1
```

Exit 0: **32/32 passed, zero skips/failures**, 14.29s. All 20 mandatory tests remained enabled: 400 denied requests plus 11 retained controls. Twelve additional denied probes also passed, for **412 denied requests**. C1's complete negative oracles passed: 404, zero environment/binding access, destination calls, before/after changes, logs, deferred work, private output, cookies and CORS advertisement; HEAD body empty. C2 passed real JWT and SDK acceptance/rejection with exact account/scoped CACHE destinations, health readiness/liveness, `/api-info` and a noncolliding missing path. `/api-info` produced the required two observed log lines, positively checking the logger sensor. Zero outbound attempts.

Exact independent additional cases (default synthetic admin credentials supplied by the frozen harness):

```json
[
  {"path":"/%61%70%69/cache/t%3Aglobex%3Aprivate%3Acatalog"},
  {"path":"/%61%70%69?secret=W0102_REQUEST_MARKER","method":"HEAD"},
  {"path":"/api/nested/%2e%2e/storage/globex%2F2026-09-06%2F13%2Fdecisions%2Fprivate.ndjson","method":"DELETE"},
  {"path":"/api///state/state/t%3Aglobex%3Aprivate-state","method":"PUT","body":"{\"key\":\"other-private-key\",\"value\":\"W0102_REQUEST_MARKER\"}"},
  {"path":"/api/state/unknown/t%3Aglobex%3Aprivate-state","method":"PUT","body":"{\"value\":\"W0102_REQUEST_MARKER\"}"},
  {"path":"/api/state/state/t%3Aglobex%3Aprivate-state","method":"PUT","body":"{\"key\":\"other-private-key\",\"value\":\"W0102_REQUEST_MARKER\"}"},
  {"path":"/api/queue/send","method":"POST","body":"{\"kind\":\"scene\",\"productId\":\"W0102_REQUEST_MARKER\",\"sceneId\":\"foreign\"}"},
  {"path":"/api/queue/send","method":"POST","body":"{\"kind\":\"unvalidated\",\"value\":\"W0102_REQUEST_MARKER\"}"},
  {"path":"/api?marker=W0102_REQUEST_MARKER","method":"OPTIONS","headers":{"Access-Control-Request-Method":"DELETE"}},
  {"path":"/api/analytics/query?query=W0102_REQUEST_MARKER","method":"HEAD","headers":{"Upgrade":"WebSocket","Connection":"Upgrade"}},
  {"path":"/api/storage/%00%GG%2FPRIVATE","method":"DELETE"},
  {"path":"/api/c%61che/t%3Aglobex%3Aprivate%3Acatalog","method":"REPORT","headers":{"Upgrade":"websocket","Connection":"Upgrade"},"body":"{malformed"}
]
```

## Evidence disposition and handoff

C3 passes source/caller/diff review, independent red/green execution, artifact verification and inspection of E1's actual handoff/rollback/limits. Inspected [lead-checks-v1.json](lead-checks-v1.json), SHA256 `7cb2d3c3c97feab9b726563beb44a59405bb7cef1f68c55df3374699213bd2e9`: its retained outputs show 52/52 targeted regressions before and after, separate 20/20 K1, TypeScript and example checks, and only index/API changes among 330 protected baseline files. These are lead-executed checks, not additional reviewer reruns. Reviewer separately ran scoped `git diff --check` successfully. E1 records earlier harness-startup failures and superseded logger instrumentation transparently; the frozen replay independently validates the corrected sensor.

The proof is actual Worker-default-export **local runtime containment with synthetic bindings**. It does not attest native/deployed resource state, assets/SPA routing, existing sockets, historical queued work, customer-browser behavior, complete tenant authority or SLOs. Generic Agents' nine-namespace exposure and wider demo/operator/document/webhook boundaries remain open; OBS-FW01 remains unrelated open framework work. No real data, credentials, cloud/deploy, staging/commit/push or destructive store operation was used. Selectively reversing the retained source diff would reopen the exposure and invalidate this acceptance basis.

No review finding requires rework within C1–C3. Next action: lead bind E1/E2 to the exact artifact, record bounded task disposition and durable handoff, and retain the remaining W01 and broader G0 obligations.
