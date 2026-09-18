# W02.01 episode 2 — independent review

PASS C1–C2 and the independent technical portion of C3; no bounded rework required. Reviewer `w0202-reviewer`, `/root/w0202_review`, gpt-6-astra/xhigh, distinct from worker `/root/w0202_impl`. Results collected by 2026-09-07T02:17:36Z. Lead acceptance/handoff remains separate; this review does not close a package, finding or gate.

## Contract and identity

Read the actual admitted task, complete approved plan and canonical W02/F02/F09/N02/N14 scope, applicable source/tests and retained baseline evidence. Episode admitted seq60 at 02:12:36.471Z; frozen verification released seq61 at 02:15:19.876Z. Plan SHA256 `c71b54e6c39048392ff9ae73c4c2fd4125d325f8a28b780399daa58223e65863`; contract `c391f6996f7c663430ade90dfe707bc5a330a99929c738b381b05a247c76cde6`.

[Manifest v2](artifact-manifest-v2.json): digest `7fdffd2cd80790ce59805565314dfbab1138b054c93fb3dce1d2a798232ac009`, file SHA256 `3f65e7ac45e08d2961eeaeff5ca7ac825e5b710225dad5f29ceac1363763ff40`. Independently read/hashed all 224 files after execution: zero mismatches. Exactly three prior manifest files changed: middleware auth, auth routes and tsconfig; all are accepted W02.02 dependencies. New `signingConfig.mjs` is included. The focused test remains SHA256 `11628a318420ddb8d2d269373a7f23a46f7ad4b7913648db565b0dedd07ee177`.

Actual source retains signature/issuer/audience verification before the refresh-purpose rejection, which still precedes authority checks, auth context and protected dispatch. W02.02 adds validated signing snapshots without replacing that guard. Missing/optional-header behavior, untyped credentials and independent SDK credentials remain compatible within the tested contract. No application or fixture change belongs to this episode.

## Fresh independent checks

All three commands invoked at 2026-09-07T02:16:03Z, after frozen release; all exited 0:

```bash
node node_modules/vitest/vitest.mjs run src/middleware/auth.refresh-boundary.test.ts --maxWorkers=1 --minWorkers=1
node docs/remediation/evidence/W02.01/reviewer-probe-v2.mjs
node docs/remediation/evidence/W02.01/lead-artifact-v2.mjs --verify
```

[K1 output](reviewer-k1-v2.log): 30/30 passed, no skips/failures, 6.31s. Four fresh/revoked × open/enforced cases deny real-issued refresh account reads and configuration patches with 401, zero protected account reads/KV writes, unchanged bytes, revision, K and history. Real access, untyped/sub-only tools, access/service shapes, JSON renewal/logout, optional/cryptographic/role/permission and actual SDK/operator middleware controls pass. The retained CJS deprecation warning is non-failing.

[Replay output](reviewer-probe-v2.log): the hash-checked original verifier composed with CURRENT auth routes/dependencies admits all 16 GET/HEAD/PUT/rollback attempts, causing eight account reads and 24 KV writes across four fixtures; revision advances 2→4 and K changes 7→3. Current source denies all 16 with 401, zero protected effects and unchanged state/revision/K. Eight sub-only tool PUT/rollback controls, four malformed-body denials, optional purpose/signature/expiry ordering, three edge refresh denials, three edge tool successes, independent SDK-key success and wrong-key refusal pass. This is a composed baseline, not a reconstruction of the full historical tree. The v2 probe changes only its expected current auth hash and explicit baseline label; v1 and every assertion remain unchanged.

[Collector output](reviewer-identity-v2.log): 224 files, 12 focused local inputs and 199 replay inputs. A separate read-only reconstruction at 02:16:58.849Z independently reproduced BOTH executed bundle hashes and input graphs: 198 physical inputs each, zero uncovered files, plus the wrapper pinned by the probe. The original middleware bytes are separately checked against their retained hash; the current helper is present in both composed/current graphs.

[Exact commands, timestamps, outputs and graph/hash comparison](reviewer-checks-v2.json), SHA256 `20ffe2097db1fc98c7320b7eaf04e05de64fda62097cc486f5fefd22d90e0fe4`, retain the complete execution evidence.

## Corroboration and limits

Read the frozen worker report and actual fresh 30/30 output: report SHA256 `7492db450bd84a03d083c4fb69cb8efde788741b2241e1978be2aeb21006557b`, log SHA256 `5786c61c80fe5f1668e447d6015155cc2c4b4754c3c062511a8f9e5d2d73f788`. Independently corroborated its bounded claims; its run is not mine. Inspected accepted W02.02 regression/typecheck checks and handoff: 108 tests and ordinary application/SDK TypeScript passed, prior compiler failures retained. Those provide attributed current-dependency assurance, not newly executed W02.01 evidence.

Node v22.15.0, Vitest1.6.1, Hono4.12.27, jose5.10.0, esbuild0.28.1; real selected modules with synthetic successful in-memory stores and credentials. This episode is not workerd/default-export, native/deployed-resource, full runner-binary, customer, SLO or release acceptance. Full W02 account/session/service-token/tenant/onboarding/abuse obligations remain open. No source/test/governance/history edits, external services, real credentials/data, deploy/install/seed/git mutation or destructive operation occurred; no reviewer process remains.

Lead next: inspect and separately accept/register current evidence, superseding only affected proof while preserving history; then separately admit W01.02 plan-v3. W01.02 has not been executed in this episode. Evidence-only rollback never means reversing either accepted engine fix.
