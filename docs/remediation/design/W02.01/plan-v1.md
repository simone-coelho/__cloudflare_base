# W02.01 — reject refresh tokens as access credentials

Standing local G0 mandate: ../..//evidence/W01.02/authorization.md; user confirmed continuation. Lead /root; worker /root/w0201_impl; independent reviewer /root/w0201_review; all Astra/xhigh. Canonical W02/F02 plus F09/N02/N14 retain their full scope; this task covers only refresh-as-access containment. No deployment, credential operation or customer-policy change is authorized.

## Approved bounded change

After real jose.jwtVerify succeeds in src/middleware/auth.ts, reject signed payload.type === 'refresh' with401 Invalid token, before roles/permissions, auth context or next. Preserve untyped issued access/tool tokens, existing typed access/service behavior, optional absent auth, normal cryptographic/role failures, JSON refresh renewal and independent SDK-key authorization. Do not add session lookup, mandatory type/claims, issuer migration, SSO/membership rules, onboarding/abuse policy or readiness checks.

Worker writes only src/middleware/auth.ts, new src/middleware/auth.refresh-boundary.test.ts and own evidence under docs/remediation/evidence/W02.01. Lead owns tracker, plan, baseline and handoff. Reviewer owns review-v1.md only. No other engine/config/dependency/SDK/bundle edit, install/seed/cloud/network/customer data, staging/commit/push or delegation. All fixtures and credentials synthetic; apply_patch edits only.

## Measure and verify

Prechange middleware SHA25665a1553ae0d93627f82f5c6dd3f5acb8ee3a8b94b7d82955c15098d3c1317492; HEAD e49aef83c9a9843dd21479f1b08d53e7709fac41. Current seq21 tracker and source snapshots retained before edits. Both independent preflights and lead source review confirm the shared-purpose verifier and in-repo untyped issuers. Initial board check/status valid; existing historical W01.01 warnings are already reconciled.

K1: node node_modules/vitest/vitest.mjs run src/middleware/auth.refresh-boundary.test.ts --maxWorkers=1 --minWorkers=1. Focused Node22/Vitest integration using real Hono/jose/auth/config/accounts code and successful in-memory account/session/KV destinations; no replacement auth/router logic. First run establishes fresh and logged-out real-issued refresh bearer access to /auth/me and valid PATCH config with actual version/history/body side effects. Use soft assertions or a separately explicit baseline so the first failure cannot hide mutation evidence. Preserve original source and command/output; do not reverse live source for later replay. Then apply the guard immediately and rerun.

C1: fresh and revoked refresh bearers receive401 on protected reads/mutations with no protected account/config/version/index effects; guard rejects before roles/auth context/next. C2: real login access, untyped tool and typed access/service positives read/write successfully; JSON renewal works before logout and fails after actual session deletion. Optional absent auth, invalid/expired/signature/issuer/audience and role/permission cases preserve behavior. Actual sdkKey and operatorWrites deny refresh bearer delegation with zero protected destination effects while legitimate access/site-key controls work. A valid SDK key plus refresh header remains SDK-authorized. Global tenancy/logging before JWT is outside the zero-protected-effect claim.

K2: independent frozen source/test/evidence review, K1 rerun and challenges; retain exact commands/verdict in review-v1.md. C3: actual bounded diff, negative and legitimate controls, scoped regression/typecheck results, full W02 residuals, exact artifact and completed lead handoff checked independently. Run existing auth/account/edgeAccess/content/identity regressions and TypeScript checks proportionately; retain failures, never bypass required checks.

The shared auth change invalidates W01.02's full-entrypoint source identity. Preserve its accepted artifact/evidence in history and mark current proof for revalidation before editing. After this implementation is accepted, revalidate W01.02 with the unchanged actual-default-export workerd suite under a separately recorded continuation episode; no new engine edit or inventory programme is needed. Do not relabel old evidence as new proof.

Rollback: selective reversal of this task's auth diff from retained original, which reopens the vulnerability; never broad reset. No stored data touched. Full typed credential migration, revocation/onboarding/membership/readiness/abuse policy and all gate/customer/deployment obligations remain open. N02 absent/zero-length-key forgery remains refuted. D01-D10 do not block this narrow guard.
