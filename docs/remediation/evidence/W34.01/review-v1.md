# W34.01 independent review

2026-09-07T04:42:56Z — `w0202-reviewer`, `/root/w0202_review`, gpt-6-astra/xhigh, independent of implementer. **C1 and C2 pass; recommend bounded OFF-only containment acceptance.** Lead disposition remains separate.

Artifact [artifact-v1.json](artifact-v1.json): digest `eba761398a7fc71b7e9e7a05d45ed9ff061ddd14a849b13432b0ca1c95a53b1b`, file SHA256 `6ef43a4a16bc810a3b6b9a9739d9915a6fdd8e7f1a508093902eee2dc34d133a`. Contract `493bc4435de040b1db24f8b58a9aec18bb80e8681d917bd8018a515aadce6dd9`; plan SHA256 `a89dc247a159a1ede3a07ecd3b66e777d0d47b673ca3958d62c4de00fac58e3f`.

## Evidence and verdict

Read actual complete parent W34/F30 scope, approved plan/task, retained five-case baseline command/output/original sources, frozen two-file diff and fixture, applicable service/external/scorer/replay source, worker results and failures. No acceptance from an agent summary.

C1: the sole production external-scoring import/call, request construction and adapter dependency construction are removed. Stored URL, binding, AI or table settings cannot enable them. Weighted non-default receipts truthfully report unavailable/deployment-disabled, ms0, no contribution or captured external scores. Existing ordinary, inactive, consent, holdout and gamma behavior is preserved; historical replay continues from recorded inputs.

Independently ran exactly:

```sh
node node_modules/vitest/vitest.mjs run src/content/consent.test.ts src/learn/phase3.test.ts src/content/decide.test.ts src/learn/holdoutArms.test.ts --maxWorkers=1 --minWorkers=1
```

Started 04:41:20Z; completed output collected 04:42:17Z. **Exit0, 33/33 across four suites**, reported duration13.81s. Four configured adapters have zero calls/property reads/ext:* reads despite successful configured stubs, while real fixture choices and shopper/ring effects succeed. Disabled table receipt and historical external-score replay pass; inactive/default terms remain absent.

C2: all71 manifest file hashes and digest verified; all60 declared local graph entries are pinned, and parsed graph equals its actual retained output. Baseline original sources match their hashes and HEAD; parsed baseline observations equal retained output. Worktree-status delta from admission adds only service.ts and consent.test.ts; scoped whitespace check passes. Auth hash remains unchanged. Service SHA256 `dff26109e9389cacb1f2bfae4db220f926bbaca6b10376023535e46a3b1a2bf8`; fixture `83bd9de816cb610913a80e45df44ca32742f566a8281ad0961e991a073f37b09`.

Inspected actual worker application noEmit command/output: exit0 at04:37:09Z–04:37:33Z, task-temporary build metadata. No duplicate reviewer compile claimed. [worker-checks.json](worker-checks.json) SHA256 `f14856ac4ecfc21215970a87f6e8456d597bda1f98d9adbc1632595127f30e17` retains initial wrong shopper-label assertion and cleanup-return typing failures, corrections and final exact-source success. No production/external-effect assertion weakened.

Full independent commands/results and limits: [reviewer-checks-v1.json](reviewer-checks-v1.json), SHA256 `155597dc18a59ee1f9bc08a1c98235cf5b4552f15b937e587c57f56fcb1ca3ea`.

## Limits and handoff

Local synthetic Node/source containment only. The static current graph keeps packages external; it is not full installed-library/runner/native-binary or TypeScript-program attestation. Original baseline retained52-input count, not its full graph; none reconstructed. Existing helper timeout proves omission, not cancellation.

Table publication/enablement, authorized seams and cancellation/privacy, customer wording/D05, deployed correctness, SLO, full W34/F30 and gate/release acceptance remain open. Earlier authentication code is unchanged, but historical broad proof remains reopened; these tests do not reclose it.

No blocking defect found. No reviewer acceptance failure, new harness or expanded checks. All reviewer processes completed; only this report/checks written. Return to lead for separate bounded acceptance and final consistency checks.

