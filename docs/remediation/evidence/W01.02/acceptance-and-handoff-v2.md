# W01.02 — accepted current-source revalidation and handoff

Lead /root, actor w01-lead, accepts bounded C1–C3 at 2026-09-07T01:12:39Z. Independent Astra/xhigh worker /root/w0102_reval_worker and reviewer /root/w0102_reval_review are distinct. This episode changed no engine/test/example code: it revalidates the accepted raw-API removal after W02.01 changed shared auth.

The removed /api surface still fails before dispatch, bindings, logs and protected effects. Worker and reviewer each passed the unchanged20-test actual-default-export workerd suite:400 denied probes and11 retained-route controls, including negative credential controls. The reviewer separately reproduced the original route exposure in memory:10successful requests,3private reads,6actual mutations. That replay combines original index/api with current shared auth; it is not the complete old dependency tree.

## Reviewed basis

- [895-file artifact](artifact-manifest-v2.json) digest9b401e92a09329e30a7c747e0a1d53de23976fa95dad756bbea01ad1dfc02ada; fileSHA1abe4e8644afa5be814c716f7a4eca99fcde2cc46c07054e80f7f420ef2240e4. Independent rebuild verified871graph inputs; only auth.ts differs from v1.
- E3 [worker proof](worker-revalidation-v2.md) SHA2f9cacc1c8aad6a16e1873f7a30bb3d11ab217b62e0f3037c5219b409a53c478; complete [actual K1 output](worker-k1-v2.txt) SHA4a769b0cb925d6e788fbb25f1fd94860459de0a20aef9c8ffbeda782aaeebab8.
- E4 [independent review](review-v2.md) SHA58f40e4b3fbe456eb9e231aba170b5321a5614b17451ae22b92c9f4ed6ec5481; exact accepted review-metadata SHAc3b2d2f9f97e8ea8d545b92399df7be47d99754299a188a425866d478a0cfb13.
- [Independent runtime/replay evidence](reviewer-runtime-v2.json) SHA008ae45c76a28c6c46b46ad902e51333e8095a2997c92ca9697364f932db9de7 and [artifact probe](reviewer-artifact-v2.mjs) SHAf71785432e72aefd44789a74bba81d2e71b67ff83989b34e78b3285dd7c39756.

Lead read the complete worker/reviewer reports and primary runtime traces, actual current guard/path oracle, scoped removal diff and artifact probe. The independent review establishes technical C1–C3 and this separate disposition/handoff completes lead acceptance. No required current test failed or was skipped. The reproduction's expected failure/filter and truncated repetitive middle diagnostics remain honestly qualified; all10effect traces and final summary are retained.

At01:09:07.691Z the lead rehashed the original330-file source baseline: only authorized index.ts/auth.ts and api.ts deletion differ. Scoped git diff --check passed. W02.01's separately accepted75-test/typecheck proof is not relabelled as a new W01 run. [Seq35/current versus trustedseq28 admission validation](admission-validation-v2.json) passed with zero errors; final seq41 closure validation and board commands are retained separately after actual completion.

## Boundaries and next code fix

Old acceptance, source snapshots, v1 evidence and actor identities are unchanged; E1/E2 are superseded only by fresh E3/E4. W01.01's historical inventory warnings are not a new inventory assignment. Full W01/W02, findings, gates, customer/SLO and release obligations remain unaccepted. Proof is local workerd with synthetic working adapters and blocked application egress, not deployed/native resource/assets/customer acceptance.

HEAD e49aef83c9a9843dd21479f1b08d53e7709fac41 and canonical doc35 SHA34b5c7d286650d879223062be352d244b176c9def6d2ebfb543a2dd7e985aedf remain unchanged. Protected bundle/audit/SQLite-sidecar/user edits remain. No deploy, cloud change, real credentials/data, install/seed, staging/commit/push or unrelated cleanup occurred. Worker/reviewer commands are finished and runtimes disposed. Everything remains local/uncommitted.

Next executable action under the standing local G0 mandate: admit a bounded W02 signing-configuration readiness fix after reading complete W02/F02/F09/N02/N14 and actual health/auth/tool paths. Source-confirmed /health/ready always reports ready; login writes account/legacy-migration state before signing. A shared check must precede those effects, not only token minting. Define safe synthetic-key/issuer/audience criteria, preserve legitimate untyped credentials/JSON renewal and account for existing short-key fixtures and eight development tools' unsafe configuration fallback. The proposed minimum-key contract/tool compatibility still needs explicit lead admission; this handoff changes no signing policy. A fresh Astra read-only preflight identified these paths, not customer/deployment acceptance.

Actual secret replacement/attestation, deployment, secure operator recovery and human policy remain outside current authority. Do not read back secret values or invoke provisioning to repair readiness. N02's missing/zero-length-key workerd forgery remains refuted. Revalidate affected W02.01/W01.02 proof on the next source delta without repeating the inventory programme. This evidence-only episode has no engine rollback; reversing either accepted code fix reopens its exposure.
