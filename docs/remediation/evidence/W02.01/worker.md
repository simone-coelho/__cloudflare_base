# W02.01 worker handoff

Implementer /root/w0201_impl, gpt-6-astra/xhigh; lead /root; independent reviewer /root/w0201_review. Local implementation under [plan-v1](../../design/W02.01/plan-v1.md), admission seq28, and explicit production-edit release after the lead's current/prior validation passed at 2026-09-07 00:38:40Z. This supports C1/C2 and supplies implementation evidence for C3; independent review and lead acceptance remain separate.

Only src/middleware/auth.ts and the new src/middleware/auth.refresh-boundary.test.ts changed outside this worker's evidence. After successful jose.jwtVerify, the middleware rejects payload.type === 'refresh' with 401 Invalid token before authority checks, auth context and next. No issuance/session/SDK behavior was changed. The source diff is four added guard/comment lines plus a terminal newline. No other implementation/config/dependency/SDK/bundle edits were made.

Frozen source SHA256: a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea. Frozen final test SHA256: 11628a318420ddb8d2d269373a7f23a46f7ad4b7913648db565b0dedd07ee177. [source-test-dependencies-v1.json](source-test-dependencies-v1.json) records transitive source inputs, configuration/lockfile fingerprints and installed version records. This is an esbuild dependency inventory only, not the executed Vitest runner: bundle=true, write=false, metafile=true, platform=node, packages=external from the new test entry; Vitest/packages and Node builtins remain external, and no bundled output was executed. Canonical document35 basis SHA25634b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf; HEAD e49aef83c9a9843dd21479f1b08d53e7709fac41. Lead owns final artifact manifests and governance records.

## Before and after

K1 command for every recorded focused run:

```bash
node node_modules/vitest/vitest.mjs run src/middleware/auth.refresh-boundary.test.ts --maxWorkers=1 --minWorkers=1
```

The actual prechange source was SHA25665a1553ae0d93627f82f5c6dd3f5acb8ee3a8b94b7d82955c15098d3c1317492. Lead retained before-auth.ts.txt with one additional terminal newline; remove only that retained-file addition when replaying, never restore live source. [baseline-test-v1.ts.txt](baseline-test-v1.ts.txt) is byte-identical to the executed initial test, SHA256321d8a931d9700fd09fb9d0f54392aa30873b932b123825f35aa4ae1ab60261f. It was recovered by reversing only the subsequent typed-fixture edit and verified against its originally captured hash.

At 2026-09-07 00:39:31Z, [k1-baseline-v1.log](k1-baseline-v1.log) recorded exit1: 14 expected failures and 14 compatibility passes, 28 total, duration5.65s. Four scenarios independently covered fresh/revoked real-issued refresh in open/enforced modes. In every scenario a successful real access-token PATCH first created revision1/K3/history1 with three KV writes. The refresh then returned200 from /auth/me and PATCH /config/reflex, read the actual account once, wrote three KV records, advanced revision/version/history1→2 and changed K3→99. Revoked scenarios first executed real logout, observed zero remaining session rows and verified JSON refresh refusal. Edge middleware also admitted all six fresh/revoked refresh requests into the instrumented shopper/operator handlers. Soft assertions ensured these effects were executed and retained after the initial unexpected status.

The source guard was applied immediately after that red baseline. [k1-green-v1.log](k1-green-v1.log) recorded the same28 cases passing at00:39:52Z, exit0, duration7.80s. Initial application typecheck then reported a readonly tuple mismatch in the new test only; [typecheck-initial-failure-v1.log](typecheck-initial-failure-v1.log) retains it. The fixture table was given explicit mutable option types without changing runtime cases. The application typecheck passed, and [k1-type-corrected-v1.log](k1-type-corrected-v1.log) recorded28/28 passing at00:41:04Z, duration6.37s. These earlier runs remain historical.

Lead requested two additional controls: an untyped sub-only tool token and cryptographic-failure precedence for a wrong-signature refresh. [k1-final-v1.log](k1-final-v1.log) records the frozen final artifact: **30/30 passed, zero skips/failures**, exit0, at00:41:52Z, duration6.64s. The final application typecheck also passed. For all four real-route scenarios, both protected responses are401, account reads0, KV operations0, unchanged byte snapshots of KV/accounts/sessions/audit, unchanged revision/version/K/history, and no auth context. Readback invalidates the isolate config cache first, preventing cached values from hiding KV mutation.

Compatibility coverage includes real login/renewed access reads and writes; untyped tool tokens with and without roles; typed access/service reads and writes; genuine JSON renewal before logout and refusal after session deletion; absent optional auth; role-any/permission-all behavior and403 failures; malformed, bad-signature, expired, wrong-issuer, wrong-audience, future-not-before and unsigned token refusals. Refresh rejection precedes roles, permissions, auth context and next, including optional auth. A wrong-signature refresh returns the existing cryptographic Authentication failed response before the purpose guard. Actual sdkKey/operatorWrites reject refresh delegation while access, header/query SDK keys and a valid independent SDK key accompanied by a refresh header retain successful handler effects. Edge handlers are deliberately instrumented local destinations, not whole shopper routes.

## Other checks and limits

Retained [regressions-v1.log](regressions-v1.log): exit0, **45/45 tests** across five existing suites, at00:40:13Z, duration24.61s:

```bash
node node_modules/vitest/vitest.mjs run src/routes/auth.test.ts src/auth/accounts.test.ts src/middleware/edgeAccess.test.ts src/routes/content.test.ts src/routes/identity.test.ts --maxWorkers=1 --minWorkers=1
node node_modules/typescript/bin/tsc --noEmit --composite false --incremental false
node node_modules/typescript/bin/tsc -p src/sdk --noEmit --composite false --incremental false
git diff --check -- src/middleware/auth.ts
```

The final app and SDK typechecks and scoped diff whitespace check returned0 with no output. Production source did not change during any green/regression run; only the new test fixture was corrected and extended. Lead is independently repeating frozen regression checks. Vite's existing CJS deprecation notice is retained; no dependency change was made to suppress it.

Environment: Node22.15.0, Vitest1.6.1, Hono4.12.27, jose5.10.0, TypeScript5.9.2. All accounts, signing material, site keys, scope IDs and data were generated/local synthetic fixtures; no real credentials/data, network/cloud/deploy/install/seed or git mutation was used. This is local synthetic Node integration through actual auth/config/account code, not workerd/native-D1/KV, the complete Worker entrypoint, customer, deployed, performance or release acceptance. No claim of zero global tenancy/logging before auth is made; only protected destination effects were measured.

Full W02 typed-credential migration, mandatory identity/authority claims, session/access revocation after logout/disable/delete/demotion/password/rotation, temporary-password restrictions, membership, signing readiness and bounded abuse/audit policy remain open. N02 absent/zero-length-key forgery stays refuted as required by the canonical record. No package/finding/G0/G1/customer/release claim is made. The shared-auth change affects W01.02 current artifact identity; lead retains historical proof and schedules its unchanged actual-default-export workerd suite under a separate revalidation episode.

Rollback is selective reversal of this task's auth diff from the retained original and reopens the bypass; no stored data was touched. Code/test frozen and lead notified. No worker test/build process remains. Next action: independent reviewer challenges the frozen artifact/evidence, then lead records disposition and durable tracker/journal/checkpoint handoff. This implementer cannot self-close.
