# W22.09 — Same-brand online attribution

Scope: document35 W22 attribution/reconciliation/faults, with W26 page/brand/placement identity; F16/F17/F19/F21/F22, N10/N23 and F03/customer §1.7 boundary context. This is one forward online attribution fix, not full package or hard-isolation acceptance.

Source-confirmed case: DecisionRing is tenant+visitor scoped and legitimately retains multiple brands. Uncorrelated outcome currently selects all personalized records, then sends the winning credit into the outcome brand's LearnStats. Shared attribute does not check brand on this branch; hourly already does. A foreign earlier/later candidate can win first/last and corrupt the destination's statistics. No failed baseline runtime claimed.

Change only the uncorrelated DecisionRing predicate to require exact outcome.brand alongside personalized arm. Preserve the full correlated candidate set so cross-brand duplicate IDs remain ambiguous. Shared policy's legacy optional-brand contract, W22.08 stable sort, retention/index/caps, timestamps, erasure, receipts and statistics arithmetic remain unchanged. No schema, rollout, history reconstruction or lifecycle decision needed.

Acceptance: one grouped regression in existing learn.test.ts runs actual DecisionRing into actual LearnStats with synthetic cloned storage, one non-default tenant and two distinct brands. Cover direct item, featured product and any; first/last; own positive and foreign-only zero, including foreign candidates that would otherwise win. Assert selected identity, exact destination and stored success counts/original timestamps, not just HTTP status. Preserve existing W26.02 correlated ambiguity/holdout control and both W22.08 ordering/correlation controls unchanged.

Fixed4 command (worker and distinct reviewer once each):

`node node_modules/vitest/vitest.mjs run src/learn/learn.test.ts -t 'W22[.]09|W26[.]02 narrows|W22[.]08' --maxWorkers=1 --minWorkers=1`

Static: existing no-emit compiler with1536MiB; two-file ESLint with three inherited warnings and no new signatures; two-file git diff --check. Reviewer may reuse same-byte static. No broader suite/build/benchmark; candidate filtering remains O(n) on the existing bounded ring, no SLO claim.

Worker w2206-worker (/root/w2206_worker) owns only src/durable-objects/DecisionRing.ts, src/learn/learn.test.ts and evidence/W22.09/worker.json after root GO. Independent w2205-reviewer (/root/late_hour_next_review) owns final review only. Both Astra/xhigh, no further delegation. Lead owns admission, freeze, journal and acceptance. Preserve all W22.07 accepted pins/review; qualify W22.08 overlapping exact artifact proof prospectively, retaining its implementation/history and unchanged dependency assurance.

Rollback is a reviewed reverse patch of this task's baseline-relative two-file delta only; no restore/reset of inherited work. Required failures/rework stay recorded. No new privacy/history/science decisions, personal retention, replay of customer data, install, emitted build, stage/commit/push, deployment, cloud/credentials/destructive/external operation or release authority. Existing user Continue authorizes this bounded local remediation; lead approval is recorded on admission.
