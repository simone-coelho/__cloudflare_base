# W04.01 — mandatory backend account proof and fresh SDK retry

Lead-approved local G0 implementation slice; full W04 remains open. Exact ownership, criteria and commands: [task contract](task-contract-v1.json).

## Before / scope

Root read README, protocol36, checkpoint, complete W04 parent scope, linked F04/F06/N05 and applicable identity/SDK/session source. Entry board check/status are VALID at trusted sequence177 (tracker SHA922c1a207b8e8d4c7fae6ab3342a0680eb64af04d5eea984d19bcdd2dd5d1cfc). Canonical35 is unchanged, SHA5ab5f66c6f79e702535e09e13e0489a790b1c3aeae6ca683ea6baeafe5edc4c4.

Frozen baseline.json/probe reproduce absent, empty and other-tenant-only config accepting unsigned links with private audiences, session reads/writes and cookies. Configured unsigned proof is denied before effects. Actual SDK+router signed conflict takes409→detach200→401 by reusing old-visitor proof; fresh proof succeeds. Existing3 suites pass40/40. Two initial probe failures (syntax, missing /v1 mapping) and corrected run are retained, not passing evidence. No external traffic.

Require verification secrets in every mode; retain HMAC binding/rotation/wildcard and historical 'site' record compatibility. Add optional synchronous/asynchronous getAssertion({tenant,visitorId,accountId}) returning {assertion,exp}. Provider wins over static options, never falls back on error/invalid output. Capture visitor before awaiting proof, send exactly it; reject visitor changes after proof and before adopting response. On409 with static proof return409 without detach/retry. With provider detach successfully (transport and application), obtain fresh proof for newly minted visitor, retry only once. Failed detach/provider prevents another link. Existing public logout/session rotation stays outside scope.

Preserve route400/409 pre-proof ordering. Comments in route/env and current README/doc25 contract must no longer promise unsigned links; qualify old historical closure prose narrowly. Rebuild both existing SDK bundles using local scripts/build-sdk.mjs. Preserve original dirty route fixture and all unrelated work.

## Verification / rollback / authority

K1 is the exact3-suite command in the contract; extend existing fixtures only. Verify zero denial effects and signed controls, both host choices; use real signed requests. Never auto-sign SDK transport. Actual SDK+router integration belongs in route fixture, since browser-only SDK tsconfig excludes Worker aliases/types. Compact provider-failure, delayed proof/response and retry controls suffice.

Worker also runs application noEmit with task-temporary tsbuildinfo, separate SDK noEmit, inspected local SDK build, syntax on both outputs and scoped diff. Retain exact commands/results/failures. Independent reviewer reruns K1 and inspects actual source/baseline/fixtures/compiler/build proof and frozen relevant artifact. No new harness/runtime/measurement programme. No customer, workerd/deployed, latency/lift or full prior-contract acceptance.

Before edits qualify W07.04's3 changing shared inputs, preserving its accepted artifact/review/lead and3 evidence snapshots; its fixes remain implemented, without full revalidation. Root owns all governance; worker alone owns contract write paths, reviewer read-only except own review evidence. Existing local G0 mandate covers this code, not backend/SSO/credentials/cloud/deploy/customer decisions or commits.

Rollback is a scoped reverse patch against retained original11 files/bundles, preserving prior route-test changes; fail-open production verification is not an acceptable release rollback. No rollback/deploy is authorized automatically.

Full session ownership/capabilities, SDK session rotation and forwarding revocation, old cookies/stale tabs/in-flight generation protection, erasure and D07 onboarding remain open. The raw verifier's caller-ID equality shortcut is explicitly rejected because it is bypassable and can run after victim writes. This task neither closes F04/F06/N05 nor W04/gates/release.

