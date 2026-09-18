# W02.03 — JWT identity and authority shape guard

Lead preflight under the standing local G0 mandate; this plan is not full W02 approval.

## Scope, baseline and decisions

Read doc35 complete W02 and F02/F09/N02/N14, their qualified evidence, and actual auth/account/config/edge/tool sources. Full W02 requires refresh rejection, access/service migration, temporary-password/account/session revocation, signing readiness, abuse budgets, bounded lockout/audit growth and tested logout/disable/delete/demotion/password/rotation recovery. This slice addresses only required identity/authority claim shapes. Tenant privileges remain W03; provisioning/recovery W08. The engine remains customer-neutral, with no scoring/learning changes or new I/O.

Trusted journal77 tracker and338-path protected baseline are retained in this directory's evidence folder, with exact original auth source SHA71b8bff20c06df6fdcbddd37678a73fcdfe7b0b3dcafbfba49d16b70587c1316. Root's board check/status both passed. Existing modified/untracked files and deleted SQLite sidecars belong to the user/prior work and stay untouched.

Worker's actual in-memory Node preflight (2026-09-07T02:56:21.148Z, exit0,198 inputs, zero outbound) ran25 fixtures/100 operations. All8 malformed subject shapes reached real account list200/create201 and config PATCH200 with1 list/1 account put/1 audit and3 KV puts per config write. Missing/null subjects lost actor identity. A roles string "not-admin" and mixed array also reached real admin operations. Malformed roles/permissions reached role-free config writes. Permission-string substring acceptance used an explicitly composed jwt({permissions:['write']}) harness; no existing product route supplies that option. Three valid controls distinguish intended behavior. Exact probe/output are retained before code release; initial output truncation is recorded separately from the complete repeat.

No customer decision blocks this already-declared shape enforcement. All ten decisions remain pending. Blank dev-token --sub overrides and malformed stored account identities may mint unusable credentials; rejecting them is intentional, not a claim of issuer/data repair.

## Behavior and exclusive ownership

After signature/issuer/audience/time verification and the existing refresh-purpose rejection, require a nonblank string sub and, when roles or permissions are present, arrays containing only strings. Return existing generic401 Invalid token on malformed shapes before authority checks, authenticated context, downstream request-body access or protected store work. Validate both arrays even on role-free routes.

Do not coerce, trim or normalize accepted values. Preserve padded/non-ASCII subjects, omitted/empty arrays, empty/unknown string entries, literal '*' values, role-any and permission-all exact membership. Preserve existing untyped access/service/tool tokens, standard eight tool forms including no-role tools, real login/JSON renewal, expired/bad-signature/issuer/audience behavior, header/config503 precedence, optional anonymous flow and independent SDK-key path.

Worker /root/w0202_impl (gpt-6-astra/xhigh) alone owns src/middleware/auth.ts, new src/middleware/auth.claims-boundary.test.ts, and its explicitly named new evidence/probe files. Root alone owns tracker/journal, plan, manifests and acceptance; /root/w0202_review (gpt-6-astra/xhigh) owns independent review evidence after freeze. No further delegation. Old tests/probes remain immutable; no other engine/tool/config files may change.

## Acceptance and execution

The task JSON supplies stable C1-C3 and K1-K2. K1 executes the new focused test in Node plus a bounded real-module local workerd matrix. C1 measures actual account reads/create/audit and config revision/index/state effects, authenticated context and downstream body access, not only statuses. Cover absent/empty/blank/null/number/boolean/object/array subjects; scalar/null/object/mixed/nested authority arrays on role-free and restricted routes; exact legitimate forms and error ordering. C2 runs representative invalid and successful account/config/JWT/edge cases in workerd with blocked/count-checked outbound and disposed runtime. Baseline and current bundles must retain every physical dependency, including baseline-only inputs; virtual wrappers are pinned by their containing source. Original replay composes retained original auth with current unchanged dependencies, not a complete historical deployment.

K2 independently inspects actual code, full assertions and before/after evidence, reruns K1 and these unchanged regressions:
- node node_modules/vitest/vitest.mjs run src/middleware/auth.refresh-boundary.test.ts src/auth/signing-config.boundary.test.ts src/index.api-boundary.test.ts src/routes/auth.test.ts src/auth/accounts.test.ts src/middleware/edgeAccess.test.ts src/routes/content.test.ts src/routes/identity.test.ts --maxWorkers=1 --minWorkers=1
- node --test scripts/lib/tool-token.test.mjs
- Application and SDK TypeScript checks with noEmit and task-temporary tsBuildInfoFile, using supported installed compiler options; retain exact commands/results and all failures.

No absent-key forgery claim, native/deployed-resource, browser/customer, SLO/lift or full W02 acceptance. Performance assurance here is bounded source work (string/array validation), no added network/account/session access; local test duration is not latency acceptance.

Before auth edits, root preserves then reopens all three affected current-source task acceptances and marks their old proof revalidation_required. Required W02.03 regressions are fresh assurance, not automatic reclosure of those historical episodes. After W02.03 acceptance, admit only necessary evidence revalidation sequentially; retain old snapshots and superseding proof. No inventory restart.

## Failure, rollback and approval

Preserve failed baseline and test results, correct only admitted code/test and refreeze if rework is required. Rollback is a selective reviewed reversal of this exact auth/test diff, which reopens malformed-claim acceptance; never restore unrelated files or delete user data. No deployments, provisioning, live tools, credentials/customer data, installations, seeds, commits/staging/push or cleanup.

Lead approves only after inspecting retained baseline and independent review of this exact plan. The hash-bound approval timestamp and role/run assignments are recorded in the ready/in_progress journal. Worker handoff freezes exact source/probe/test/dependency identities, results and limits; reviewer independently challenges them; root separately signs acceptance and updates RESUME before the next task.
