# W01.02 worker handoff

Implementer `/root/w0102_impl`, gpt-6-astra/xhigh; lead `/root`; independent reviewer `/root/w0102_review`. Work executed under [plan-v1](../../design/W01.02/plan-v1.md) after lead admission/release at tracker sequence 17. This is a local raw-API remedy awaiting independent disposition, not full W01, finding, customer or release acceptance.

## Artifact and scope

Removed the unused generic router/mount/import, its rate-limiter attachment/import and `/api-info` advertisement. The actual Worker fetch rejects Hono-normalized exact `/api` and `/api/...` before Agent binding discovery, tenant middleware, logging and CORS; response is generic 404 with bodyless HEAD. Encoded unreserved-prefix aliases use the same `getPath` as the real Hono router. `/api-info` and unrelated paths still dispatch normally.

Only the admitted production/document/example files changed; `src/routes/api.ts` was deleted. This source deletion can be recovered from the retained original/HEAD; stored data was not touched. Repository caller search found only historical docs and three scaffold functions, which were removed. No product-runtime caller was identified; absence in the repository is not an external-caller attestation. Search after removal found no raw API caller in src/scripts/examples/public, excluding the new boundary test and bundles. Existing bundle, audit edits and SQLite-sidecar deletions were preserved.

Frozen SHA256s:

| File | SHA256 |
|---|---|
| src/index.ts | 840a34f2ebe134ed3e584870b03034f7bef2c1c9c8203123791546c42419aac7 |
| src/index.api-boundary.test.ts | fa0226efd8c6cf5aef7cead7ca20c2a202c56eb3df73fb455dca9274319bf997 |
| examples/usage-examples.js | 7118d4a27491ce569eddf9f553dd287429b2218d65c896703356d7aa9a799368 |
| docs/api/01-rest-endpoints.md | 1beaa00aafb1396eb0c27c734aab28078ab43b9859737c7322c9dfccbde54f41 |
| runtime-inputs.json | fc1b7b782ea399c0bfd79fe341d6d9cdc4df089d0df62062b40b6bf48e64f1d1 |

[runtime-inputs.json](runtime-inputs.json) retains all 871 esbuild inputs, including the virtual wrapper identified by the test file. Lead owns the dependency/artifact hash manifest and acceptance records.

## Before and after evidence

Baseline command, first run against unchanged live source and then replayed after fixing log instrumentation:

```bash
W01_02_BEFORE=1 W01_02_TRACE=1 node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1 -t 'AUTH_MODE=enforced.*rejects all ten raw operations for operator|uses real JWT|retains SDK'
```

`W01_02_BEFORE=1` uses an esbuild source override, never restores live files. It reads the two retained before-source text files, removes their single apply_patch-added terminal newline and checks exact original SHA256s: index `a9ca5ae49c3741d9375bd0245c7e377bfd779021055df9d90671b0f580f9f4f1`, api `905f2512b23e6639441067a45864fe25634b3fbf2d9fc977b34370fbd90dca58`.

Corrected replay at 2026-09-06 23:44:10Z: expected exit 1; one negative test failed, two retained JWT/SDK controls passed, 17 tests unselected by the baseline filter; duration 13.30s. All ten requests used a valid synthetic operator JWT with read permission and acme caller context against globex raw destinations. Observations were:

| Operations | Status and observed bad behavior |
|---|---|
| CACHE GET, R2 GET, StateManager GET | 200; private destination marker disclosed, exact destination read recorded |
| CACHE PUT/DELETE, R2 PUT/DELETE | 200; exact seeded destination overwritten/deleted in before/after snapshots |
| queue POST | 200; caller-supplied globex ledger message appended to synthetic EVENT_QUEUE |
| StateManager PUT | 200; real exported StateManager changed synthetic DurableObjectStorage |
| analytics GET | 200; query marker echoed (existing stub, no Analytics Engine query) |

Every raw baseline request also performed three rate-limiter operations, environment enumeration/access and two captured Hono log writes. No outbound network attempt occurred. Both positive controls used real auth middleware: invalid/absent JWTs and SDK keys were denied; valid credentials reached exactly ACCOUNTS.getById or CACHE.get('trend:acme:US-NY').

Final fixed-artifact command:

```bash
W01_02_INPUTS=1 node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1
```

At 2026-09-06 23:45:11Z: exit 0, **20/20 tests passed, zero failures/skips**, duration 18.09s. This executes 400 denied probes: 160 combinations of ten operations/four credentials/four AUTH_MODE values, plus 240 HEAD/OPTIONS/unsupported verb/encoded alias/dot-segment/malformed body/upgrade probes across four credentials and open/enforced modes. Eleven controls exercise `/api-info`, live/ready health, an unrelated missing path, JWT acceptance/rejection and a non-default tenant's SDK-authorized scoped CACHE read. Positive `/api-info` requires two actual captured log lines, validating the negative-log sensor.

All denied probes assert zero environment access (including enumeration), destination attempts, state changes, logs, pending work, CORS capability headers, cookies and private response data. Every successful read/write fixture can actually read/mutate its synthetic store. Promises registered by waitUntil are drained. The wrapper resets only its imported trend memo before each probe so warm-runtime positive reads still reach the intended fixture.

Worker checks also passed: `node node_modules/typescript/bin/tsc --noEmit --composite false --incremental false`; the corresponding `-p src/sdk` check; `node --check examples/usage-examples.js`; scoped `git diff --check`. Related retained regression suites and protected-source reconciliation are lead-owned evidence, not claimed as independently verified by this implementer.

Harness corrections retained here: initial starts failed before application handlers on a bare Node path import, Miniflare's dynamic-module scanner, unavailable old-date native node:os and undefined old-date import.meta.url. Resolved using native node:path/createRequire with an explicit synthetic module path, explicit in-memory modules and installed unenv/node/os fallback. The first successful baseline exposed the desired storage/queue effects, but per-request console replacement missed Hono's captured logger function; module-initialization capture replaced it and the original-source replay above supersedes its log evidence. No production workaround or dependency install was made.

## Environment, limits and next action

Node v22.15.0; Vitest 1.6.1; esbuild 0.28.1; Miniflare 4.20260625.0; workerd 1.20260625.1; Hono 4.12.27; jose 5.10.0; Agents 0.16.2; Partyserver 0.5.8; unenv 2.0.0-rc.24. Workerd compatibility date 2025-06-01 with nodejs_compat. Only the test transport uses loopback; application outbound service throws and counts attempts. All credentials, tenants, account records, KV/R2/queue/DO destinations are synthetic. No Wrangler config, secret files, real stores or customer data loaded; no deploy/install/seed/cloud mutation, staging, commit or push occurred.

This is actual Worker-default-export local runtime proof with synthetic bindings, not deployed/native resource, asset-router, existing socket, cron/queue backlog, customer-browser or SLO acceptance. Wider Agent/demo/perimeter and tenant-membership obligations remain open under W01/W03/W08/W37; no customer-policy decision is inferred. Rollback is a selective reviewed reversal using retained original source and would reopen this exposure.

Code/test frozen and reviewer notified. Reviewers can add cases without changing the artifact through `W01_02_EXTRA_CASES='[{"path":"/%61pi/cache/x","method":"REPORT"}]'`; accepted fields are path/method/headers/body/mode, with default synthetic admin authorization. It adds tests and cannot skip the mandatory suite. `W01_02_INPUTS=1` prints the metafile input list; `W01_02_TRACE=1` prints safe request/status/effect summaries.

No worker process remains. Exact next action: independent reviewer runs/challenges the frozen artifact, then lead records disposition, retained regression evidence, tracker/journal and checkpoint. Implementer does not self-close.
