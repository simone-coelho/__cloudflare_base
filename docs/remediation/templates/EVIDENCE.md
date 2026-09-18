# Evidence record — <evidence ID>

Immutable once referenced by acceptance. Supersede with a new record; do not rewrite a previous run. Do not include secrets, customer records or full binding/environment dumps.

This retained report can describe a blocked or inconclusive investigation. The version-1 tracker stores executed check/evidence results as `pass` or `fail`; an unexecuted check stays `not_run` with no fabricated execution evidence. An executed check that did not establish its pass condition is nonpassing (`fail`), with the reason—assertion failure, blocked environment or insufficient evidence—preserved here. Keep review unaccepted and record a task blocker where applicable. These labels must never turn an inconclusive run into proof of a defect or a pass.

Report provenance below is distinct from the tracker's supported claim levels: `source_confirmed`, `local_synthetic`, `local_runtime`, `deployed`, `customer_accepted`. Choose only the level actually established by the required evidence kind. A verifier-reported or unverified historical observation is not promoted into an independently executed check.

## Claim and provenance

- Task/package and criterion IDs:
- Evidence kind:
- Claim this evidence supports; claims it does not support:
- Provenance: source_confirmed / locally_reproduced / verifier_reported / unverified / deployed_attestation / customer_acceptance.
- Captured UTC time:
- Actor and exact independent agent run ID, or accountable human:
- Requested/recorded model and reasoning effort, with provenance:
- Actual role: implementer / independent verifier / lead / human acceptance owner.

## Reviewed basis

- Canonical audit hash and task-plan version:
- Base commit and relevant source/artifact manifest:
- Relevant dependency, SDK/build, schema and configuration fingerprints:
- Runtime/tool versions, environment and enabled feature modes:
- Fixture/workload and synthetic versus actual/customer data classification:
- Deployment/resource evidence, if actually obtained; otherwise explicitly unverified:

Hash only appropriate non-secret artifacts. Secret names/resource identifiers may be recorded when safe; never copy values to prove configuration.

## Execution and observation

- Exact command or inspection procedure:
- Expected before-change behavior:
- Actual before-change observation:
- Expected after-change/pass condition:
- Actual after-change observation:
- Exit code/result, stdout/stderr or safely redacted retained output:
- Checks not run, skipped, failed or inconclusive and why:
- Timing/size/count measurements with units, population, sample count and error handling:
- Safety/negative/concurrency/retry/rollback cases exercised:

Use actual readings. Do not fabricate observations or label a planned command as executed. If a baseline unexpectedly passes, investigate the assertion/fixture before concluding the defect is absent.

## Disposition and revalidation

- Verdict: pass / fail / blocked / insufficient_evidence.
- Exact criteria met and unmet:
- Limitations, remaining risks and external acceptance outstanding:
- Changes that invalidate this proof (source/interface/configuration/data/workload/topology):
- Supersedes evidence ID, if any; retain that record:
- Review/acceptance actor and the artifact fingerprint they actually reviewed:

A file hash detects edits; it does not establish that the command ran or that a human/cloud state was verified.
