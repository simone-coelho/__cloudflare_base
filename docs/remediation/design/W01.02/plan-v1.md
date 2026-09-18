# W01.02 — remove the unused generic raw API

Lead /root; implementer /root/w0102_impl; independent reviewer /root/w0102_review. Delegated model gpt-6-astra, effort xhigh. Authority: [approved local G0 mandate](../../evidence/W01.02/authorization.md). Canonical doc35 SHA256 34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf; parent W01/N01 (N04 alias), F01/F03 exposure and customer §1.7 isolation. This is one partial W01 remedy, not full perimeter, finding, pilot or release acceptance.

## Before changing engine code

HEAD e49aef83c9a9843dd21479f1b08d53e7709fac41; retain prior tracker/source baseline and old index/api source for reproducible red/green checks. Source confirms ten mounted methods expose raw CACHE/STORAGE, queue and StateManager after JWT alone. Both worker and reviewer found no product-runtime caller, but scaffold examples and the API reference still advertise this surface. Before removal, execute a synthetic actual-default-export/workerd baseline showing a valid read-role JWT reaches private sentinel reads/writes/deletes, queue submission and StateManager. Capture the expected failing fixed-behavior tests or an explicit baseline mode that establishes these effects. Do not accept a fixture whose destinations simply throw/miss.

## Bounded change and ownership

Worker exclusively owns src/index.ts, deletion of src/routes/api.ts, src/index.api-boundary.test.ts, the obsolete raw-API examples in examples/usage-examples.js and current surface entry in docs/api/01-rest-endpoints.md, plus concise evidence/W01.02/worker.md. No other src/routes files may change; the tracker uses that directory only because its file-manifest schema cannot represent an exact deleted output path. A task-local fixture/config inside evidence/W01.02 may be added if necessary, with lead notice; do not alter shared test configuration or dependencies.

Remove the unused router import/mount/implementation, its rate-limiter attachment/import and /api-info advertisement. Reject exact /api and /api/... at the actual Worker fetch boundary before Agents and Hono dispatch, with a non-disclosing 404 (bodyless HEAD). Do not match /api-info or unrelated paths. No new customer/demo toggle, credential policy, tenant model, storage schema, external service or customer-specific default is introduced. Retained Agents/demo/asset/background paths remain unchanged and explicitly outside this narrow fix.

Preserve the pre-modified public/meridian/engine.bundle.js, deleted SQLite sidecars, audit edits, all prior evidence and unrelated user work. No cloud/network egress, secret/customer material, seed/install/deploy/default wrangler dev, commit/push or real-data operations. Tests may use installed Miniflare/workerd, esbuild and Vitest, entirely synthetic bindings/keys, in-memory artifacts/storage and blocked outbound service. Dispose local runtimes. Use apply_patch for repository edits.

## Acceptance and checks

- C1: actual default-export runtime rejects all ten former operations, four GET-derived HEAD paths, OPTIONS, unsupported methods, representative encoded keys/path variants and upgrades, in open/enforced auth modes for absent/invalid/read-role/admin synthetic JWT. No binding/environment dispatch, business read/write/delete, queue, StateManager/rate-limit operation, private output or sensitive log occurs. K1 runtime_test/local_runtime.
- C2: actual retained /api-info and health routes work; real JWT accepts/rejects /auth/me correctly; SDK-authorized non-default tenant trend request reads the expected synthetic scoped CACHE value, with invalid credentials denied. No authorization/router module mocks or miniature replacement app. K1 runtime_test/local_runtime.
- C3: independent source/diff and executed-test review verifies the actual removal, caller search, red/green evidence, regression result and exclusions; concise handoff records exact artifact, residual scope and next task. K2 design_review/source_confirmed plus lead check of actual records.

K1 command: node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1. Node v22.15.0 hosts installed Miniflare 4.20260625.0/workerd 1.20260625.1, Hono 4.12.27; all bindings, actors and data synthetic, outbound network denied. Record actual baseline mode/command and test counts/failures. Run proportionate existing related regression suites and typecheck if feasible, retaining existing failures without expanding this fix. No deployment or SLO claim is made from this local workload.

K2 procedure: reviewer independently reads frozen code/test/caller diff, reruns K1 against the actual default export and challenges zero-effect and legitimate controls, then writes review-v1.md with actual results, hashes and limits. Missing or failed required checks block this task; OBS-FW01's known unrelated live-fixture failures are not hidden or made a prerequisite.

## Dependencies, rollback and handoff

Consume W01.01 as historical pre-change inventory, not evidence that new code remains at its old hash. Its accepted records remain immutable; mark old current-source proof as requiring revalidation before changing indexed source, with no inventory-only rerun blocking this remedy. D01/D08 do not block removal of an unused generic route; broader demo/asset separation and membership/identity work remain separate.

Rollback is a selective reviewed reversal of this task's source diff using retained original source/HEAD, never broad reset or unrelated work deletion. Such reversal reopens the exposure and invalidates acceptance; do not deploy it implicitly. Lead records authority, preflight, artifact/evidence, independent acceptance, residual W01 scope and next action in tracker/RESUME. Keep handoff concise. No package/finding/gate/release closure is inferred from this task.
