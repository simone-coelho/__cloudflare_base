# W02.01 independent review — PASS

Captured 2026-09-07 00:47:17 UTC. Independent verifier /root/w0201_review, actor w0201-reviewer, assigned gpt-6-astra/xhigh; distinct from implementer /root/w0201_impl and lead /root. Evidence W02.01-E2: design review plus independently executed local synthetic integration. **Accept E1 and E2 as technical evidence for the bounded C1–C3 remedy; no implementation rework required.** The lead's separate disposition, final handoff and tracker registration remain required to close the task. This report cannot supply those approvals itself.

I read AGENTS.md, remediation README, document36, checkpoint, actual seq28 task/contract and complete admitted plan, canonical W02/F02/F09/N02/N14 and their linked reports (including N02's workerd correction), relevant issuer/account/store/config/edge-access source and tests. Initial board check and status both returned VALID with already recorded W01.01 historical warnings. Current admission validation retains the trusted-prior check and explicit W01.02 revalidation state. No unreconciled source drift was used as acceptance proof.

## Frozen basis

- Canonical document35: `34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf`; HEAD `e49aef83c9a9843dd21479f1b08d53e7709fac41`. Plan SHA256 `41407896da9ebbf2ac9bea4091162266d304640c26667555edf65510a37a3074`; contract `5e1783439aecaa644f802b0e9c3cdaaa5555ca2f93be7968209a0dd91279063b`.
- [33-file artifact](artifact-manifest-v1.json): digest `4e20a5d6f511d3e8c36451d14e99318a26e4d7ac126e9e676c3319ace4fa35ef`; manifest file SHA256 `bfd0f41cb72f8240df2d31044e74c712309693c4ffd4b3ab46c4e251754bc171`.
- Auth source: `a3a7be192b89395fed567d59b48aed6076f7e80797c8a6c175bff20ff6fce5ea`; final focused test: `11628a318420ddb8d2d269373a7f23a46f7ad4b7913648db565b0dedd07ee177`. These matched before and after my executions.
- [E1 worker report](worker.md): `06396188652f16d9e69f6e5295e24ee1042940a829972c4e4f2979746a2bf8bf`; [lead checks](lead-checks-v1.json): `99ffa3a3829d2786f26b686dff3a7eb036c790d15fa14c6c3bdeb6533d8336c4`.
- Independent retained [probe](reviewer-probe-v1.mjs): `ab5cffd535c7278ebdc93a8115da563eaf6dfa89f701fa1a6050156e340b1020`. Lead expressly assigned this reviewer-only evidence probe in addition to this report. Neither frozen source nor test was edited.

I recomputed all 33 artifact and 23 dependency-record file hashes with Node fs/crypto; none differed. Repeating the esbuild source traversal (`entryPoints: ['src/middleware/auth.refresh-boundary.test.ts'], bundle:true, write:false, metafile:true, platform:'node', packages:'external'`) found 11 source inputs, all included. Recomputed `artifactDigest` from the actual board module also matched. This scope includes actual config/versioned-store dependencies. Package versions/configuration and lockfiles are pinned; installed runner/library executable bytes are not comprehensively attested. The evidence does not claim otherwise.

## Independent execution

Executed, not inferred from the worker's report:

```bash
node node_modules/vitest/vitest.mjs run src/middleware/auth.refresh-boundary.test.ts --maxWorkers=1 --minWorkers=1
node docs/remediation/evidence/W02.01/reviewer-probe-v1.mjs
node node_modules/typescript/bin/tsc -p src/sdk --noEmit --composite false --incremental false
```

K1 began at 00:43:08 UTC and exited0: **30/30 passed**, no skips, duration8.76s; test bodies354ms. Each fresh/revoked × open/enforced case observed me401/PATCH401, accountReads0, kvWrites0, revision[1,1], K[3,3], history[1,1]. The usual Vite CJS deprecation notice remained. SDK TypeScript exited0 with no output. No performance/SLO conclusion is drawn from these durations.

The independent probe uses real Hono, jose, auth/config/account modules and actual SDK/operator middleware. Only accounts, sessions, keys and KV destinations are synthetic. It bundles in memory and checks the retained original auth's SHA256 `65a1553ae0d93627f82f5c6dd3f5acb8ee3a8b94b7d82955c15098d3c1317492` after removing exactly the snapshot's added terminal newline. An esbuild onLoad supplies that original only to the replay; live source is never restored or changed.

The probe exited0. Original bundle SHA256 `a63ed12eadab510c2bcf7e811488ea1f8db218c606bec4ec0ddbc9c5d3942756` at00:45:33Z; current bundle `60b0fc946e2bb56b2d15258ed27abf003cc2a1e03ab6ed1576dc71f2506dd07f` at00:45:34Z. Both had198 esbuild inputs. Printed results, retained here in tabular form (four statuses are GET /auth/me, HEAD /auth/me, config PUT and config rollback POST):

| Auth basis | Mode | Refresh | Statuses | Account reads | KV writes | Final revision / K |
|---|---|---|---|---:|---:|---|
| Original | open | fresh | 200,200,200,200 | 2 | 6 | 4 / 3 |
| Original | open | revoked | 200,200,200,200 | 2 | 6 | 4 / 3 |
| Original | enforced | fresh | 200,200,200,200 | 2 | 6 | 4 / 3 |
| Original | enforced | revoked | 200,200,200,200 | 2 | 6 | 4 / 3 |
| Frozen | open | fresh | 401,401,401,401 | 0 | 0 | 2 / 7 |
| Frozen | open | revoked | 401,401,401,401 | 0 | 0 | 2 / 7 |
| Frozen | enforced | fresh | 401,401,401,401 | 0 | 0 | 2 / 7 |
| Frozen | enforced | revoked | 401,401,401,401 | 0 | 0 | 2 / 7 |

Every scenario started with two successful access-token config writes, revision2/K7. Original replay therefore independently demonstrated16 unauthorized successes,8 account reads and24 KV writes. The frozen result denied all16 with zero KV operations and byte-identical cache/account/session/audit snapshots. Readback invalidates the config cache. Real logout removed the session and JSON renewal failed in revoked scenarios; fresh JSON renewal remained successful.

Additional printed current-artifact results:

```json
{"optionalInvalidPurposeSignatureExpired":"passed","edgeRefreshDenied":3,"edgeToolAllowed":3,"independentKeyAllowed":1,"wrongKeyDenied":1,"malformedBodiesDenied":4,"subOnlyToolPutRollbackControls":8}
```

The eight sub-only tool PUT/rollback controls actually advanced stored revisions and preserved actor attribution. Four malformed-body refresh PUTs failed before any KV operation. Optional-auth tests with refresh credentials carrying admin/write authority still stopped before auth context/handler; wrong-signature and expired refresh credentials retained their cryptographic error responses. Real sdkKey/operatorWrites middleware denied all three refresh delegations with zero handler effects, admitted the sub-only tool on all three, admitted an independently valid SDK key accompanied by a refresh header, and rejected a wrong SDK key even with a valid tool bearer.

## Criterion and evidence assessment

C1 passes: both the retained worker baseline and my independent source replay demonstrate actual read/mutation effects before the guard. The final tests check raw stored bytes, no destination calls, account/audit/session state, config revision/version/body/index and uncached readback. These distinguish rejection from broken routing or a broken fixture. Guard placement is exactly after successful jwtVerify and before payload cast, roles, permissions, auth context or next.

C2 passes: independently executed K1 covers real login-issued and renewed untyped access, untyped tools with and without authority arrays, existing typed access/service shapes, JSON renewal/logout, optional absent auth, crypto/issuer/audience/not-before/unsigned failures and role/permission semantics. Independent PUT/rollback and edge challenges corroborate compatibility and the common verifier's propagation. No mandatory type/session/tenant claim was introduced.

C3's technical evidence passes: I inspected the actual four-line guard/comment plus terminal-newline diff, final test, baseline-to-final test differences, E1 and actual logs. Historical baseline14 failures/14 passes, initial readonly-fixture TypeScript error, subsequent correction and additional two controls are retained, not overwritten as final proof. The frozen root check records75/75 across six suites and application TypeScript exit0. Worker45-case historical regressions are not substituted for that frozen result; my SDK check independently passed. Worker handoff states scope, ownership, residuals, rollback and next action. Final lead acceptance/handoff/registration remain lead-owned closure steps.

## Limits and handoff

No required technical check was skipped or left failing. No concurrent-state algorithm changed; these claims concern rejection before downstream effects, not transactional/session concurrency correctness. All evidence here is source-confirmed/local synthetic Node22.15.0 integration (Vitest1.6.1, Hono4.12.27, jose5.10.0), not native KV/D1, workerd, complete Worker entrypoint, deployment, customer traffic or performance acceptance. Global tenancy/logging may precede JWT; zero protected effects is the measured boundary.

Full W02 token/service migration, required claims, account/access/session revocation transitions, onboarding, membership, readiness, abuse budgets and bounded audit/lockout work remain open. N02 absent/zero-length-key forgery remains canonically refuted. No package, finding, gate, customer, privacy/business or release approval follows from this report.

W01.02's old accepted artifact/evidence remain historical and its current source proof requires the separately admitted revalidation episode after W02.01 closes. I did not execute or relabel that proof during W02.01. No deployment/cloud operation, real credential/customer-data use, install/seed, external message, git mutation or unrelated source cleanup occurred. This review supersedes no prior acceptance. Relevant source/test/config/dependency or evidence changes require scoped revalidation. No reviewer process remains. Next: lead inspect this report, record bounded disposition/handoff and close W02.01; then admit W01.02 current-source revalidation.
