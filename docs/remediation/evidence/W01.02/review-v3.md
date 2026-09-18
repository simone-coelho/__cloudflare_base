# W01.02 episode 3 — independent review

PASS C1–C2 and the independent technical portion of C3 on superseding artifact v4. The baseline-only identity omission discovered during review is corrected; no implementation rework remains. Reviewer `w0202-reviewer`, `/root/w0202_review`, gpt-6-astra/xhigh, distinct from worker `/root/w0202_impl`. Results retained by 2026-09-07T02:35:07Z. Lead acceptance/handoff remains separate.

## Contract, source and corrected artifact

Read the actual task, approved plans, complete canonical W01 and linked F01/F03/F25/F33/N01/N03/N04 scope, original reports/probes, current source/tests and scoped removal diff. Episode admitted seq69 at 02:21:29.026Z; plan-v3 SHA256 `30c318176001f8ac1f6315f070e978b0879af2774b5274c1856df631ffcd9493`, unchanged contract `cfcf38ed052aa9348d113240d6bdaff626e811e4938033077025a1c2e0ffaeb5`.

Final [manifest v4](artifact-manifest-v4.json), frozen seq71 at 02:33:09.266Z: **901 files**, digest `a4aec28dea2bf9c8709bd5c00a2a70f93101b898acba9c4cd9a3298cc42f0505`, file SHA256 `140bce9704266da733e706a48d2a8792d7804f1287522cec54dc2a51b527448d`.

The frozen v3 checker independently verified all 900 v3 files and the complete 872-input current Worker graph: no missing, surplus or uncovered inputs. Exactly four retained source/config files differ from v2: middleware auth, auth routes, health and tsconfig; the new signing helper is the sole graph addition. Source review confirms the unchanged `/api` rejection still precedes Agent/Hono/environment/logging dispatch. Scoped source/deletion/example/documentation diff exactly matches the retained patch; api.ts remains absent, and the bounded caller search found no orphan raw-route references. That search does not establish external caller absence.

Independent reconstruction then found one baseline-only input omitted from v3: `src/middleware/rate-limiter.ts`, SHA256 `2ecf40ca0f70d7b0e6848c1c11927a22896db9e295320db60e40d803d5510fe6`, unchanged from the initial protected baseline. The lead retained the incomplete v3 disposition as E7 and issued v4. My fresh v4 check at 02:34:19.248Z rehashed all 901 files, verified the manifest digest/unchanged contract, and proved **all 900 v3 entries identical, exactly that one source added**. The 874-input composed-original graph now has all 871 physical inputs covered; original index/api bytes are separately hash-checked and the virtual wrapper is pinned by the unchanged test. No frozen file was edited.

## Independently executed evidence

Current K1, invoked 02:26:32Z after v3 freeze:

```bash
node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1
```

Exit 0, **20/20 passed**, no skips/failures, 17.75s. C1 covers 400 denials: 160 former-operation/auth-mode/credential combinations and 240 method/path/HEAD/OPTIONS/upgrade variants. Assertions cover generic 404, bodyless HEAD, zero environment access/enumeration, destination calls/state changes, logs and deferred work, and no private/capability disclosure. C2's 11 retained probes include negative controls, not 11 successes: api-info, live/ready health, real JWT account reads and independently SDK-authorized non-default-tenant state behave as expected. Positive logging and successful account/CACHE destinations validate the denial sensors.

This K1 run and the worker's 20/20 run remain applicable to v4 through the verified **unchanged complete current input graph and file identities**. They were not rerun or relabelled as executions after v4 freeze. Index SHA256 `840a34f2ebe134ed3e584870b03034f7bef2c1c9c8203123791546c42419aac7` and test SHA256 `fa0226efd8c6cf5aef7cead7ca20c2a202c56eb3df73fb455dca9274319bf997` remain unchanged.

Selected composed-original replay was freshly repeated after v4 freeze, 02:34:08.786Z–02:34:25.605Z:

```bash
W01_02_BEFORE=1 W01_02_TRACE=1 node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1 -t 'AUTH_MODE=enforced.*rejects all ten raw operations for operator|uses real JWT|retains SDK'
```

Expected exit **1**: one selected denial test fails with 80 expected soft assertions, two JWT/SDK controls pass, 17 explicitly filter-unselected cases; 13.93s. All ten raw requests return 200 with a valid untyped read-role token. Three GETs disclose private sentinels; CACHE/R2 PUT/DELETE, queue POST and real StateManager PUT cause six state mutations. Every request invokes the rate limiter and two logs. Analytics only echoes the marker; it does not query Analytics Engine. This composes retained original index/api with current dependencies in memory, not a complete historical tree, and is not a current product regression.

[Initial executions and identity-gap evidence](reviewer-runtime-v3.json), SHA256 `4578e0126d23b6e50fc4b320caac154cdd8e7ccdb000f419b58c297fefee04f4`, remain unchanged. [Final v4 checks, identity bridge and fresh replay](reviewer-supplement-v4.json), SHA256 `f56ba42e4207c9348be31054851a530310463c335f6f2323387313f014a0ba40`, retain exact commands/timestamps, all ten traces and complete stdout/stderr without truncation. The capture wrapper's exit 0 is explicitly separate from the expected nested test exit 1.

## Corroboration, limits and handoff

Read and independently corroborated the worker report SHA256 `09904f7457063f54f54457fe39207a5251285270fb84bbb0e400b4300857a0c2` and actual log SHA256 `e30f1a140a4fc92380cc667d14a5073b3c18508aa9ba8aee217a4e3fe27f7799`. Accepted W02.02 regression/application/SDK TypeScript and W02.01 current-source proof were inspected as separately attributed dependency assurance, not new W01 executions.

Node22.15.0, Vitest1.6.1, esbuild0.28.1, Miniflare4.20260625.0/workerd1.20260625.1, Hono4.12.27; actual default Worker export, compatibilityDate2025-06-01/nodejs_compat, existing native-path/createRequire/unenv-os adapters, synthetic working bindings, loopback transport and blocked/count-checked outbound. Runtime disposal completed; no reviewer process remains. This does not attest native/deployed resources, assets/SPA behavior, other Agent/demo/operator/scoped-read/webhook surfaces, membership, customer behavior, SLOs, full W01/W02, findings, gates or release.

Only new reviewer evidence was written. Source/tests/examples, frozen probes, historical evidence and governance were preserved; no real credentials/data, external operations, deploy/install/seed/git mutation or cleanup occurred. Lead next: inspect and separately accept the exact v4 evidence, resolve E7 through this correction and supersede only affected proof while preserving history. No source reversal or broader authority follows from this evidence-only episode.
