# W01.01 — handoff acceptance contract v1

Lead-owned contract for independent C3 review, not a completion or approval record. Created during source-only execution on 2026-09-06. The final handoff is [handoff-v1.md](handoff-v1.md); its actual existence, contents and hash must be checked by the lead before closing the task. A future link does not constitute evidence.

## Bounded outcome and authority

The deliverable is the source-linked route inventory, source-route manifest and proposed boundary/negative-test matrix under [plan-v1](../../design/W01.01/plan-v1.md). The user's [authorization](authorization.md) covers this task alone. No engine/configuration change, deployed operation, credential/customer-data operation, commit/push or customer-scope decision is authorized. Model/run assignments remain worker /root/w01_inventory, independent reviewer /root/w01_boundary_review and lead /root; delegated runs are gpt-6-astra at xhigh.

Only W01.01 may close. Full W01, all other packages, linked findings, customer-clause acceptance, gates and release remain open/unassessed. The customer-neutral engine and legitimate shopper/operator capabilities must be retained; Tapestry/Coach is a customer requirement source, not a platform-wide hardcoded identity.

## Evidence and identity required before closure

1. Retain the actual frozen artifact basis: exact approved task-contract digest, source/configuration/dependency/public-asset hashes, three design outputs and the source-inspection helper. Use an artifact-manifest record and its computed digest. Review/evidence/lead/final-handoff records remain outside their own artifact basis to avoid circular hashes.
2. Register W01.01-E1 for executed K1 source inspection, backed by the worker's actual commands, output identity, counts, limitations and report hash. K1 is not a runtime test. Preserve unsuccessful inspection attempts with their actual scope.
3. Register W01.01-E2 for the independent K2 source/design review. The reviewer must inspect all C1/C2/C3 obligations, the actual frozen outputs and E1, then author a separate [independent-review-v1.md](independent-review-v1.md) or later version. The review must identify its exact artifact, primary-source checks, actual UTC time, E1/E2 coverage, disagreements, limitations and verdict. E2 can use the same report as its evidence file; it must not be represented as a separate application execution.
4. The lead must inspect the actual independent report, reconcile any rework, verify current hashes and the final handoff, then retain a separate [lead-acceptance-v1.md](lead-acceptance-v1.md) binding the artifact and exact independent-review metadata. A proposed or pending review is not a pass. If the source/output changes, stop acceptance and record rework/revalidation.
5. Before reporting closure, validate the tracker both currently and against a separately retained prior snapshot; preserve all prior journal and evidence records. Verify the original 330-file protected baseline and the frozen route/source/asset manifest. Record actual commands/results, any discrepancies and what was not executed. No resetting the tracker or unrelated user work is allowed.

## Final handoff contents

The final handoff must identify branch/HEAD, the canonical audit hash, the artifact digest/manifest, evidence IDs/file hashes, separate independent review and lead disposition, actual check results, remaining sessions/partial work and the current journal/checkpoint pointers. It must state that files are workspace-local/uncommitted, rather than presenting HEAD as a commit of these deliverables.

Retain these limits explicitly: source-confirmed only; no application handlers, Worker/browser/socket, cloud/customer-data probes, SLO or business-lift measurements. A status code, route count, parser exit, governance consistency check or synthetic fixture result does not establish operational authorization, no side effects, isolation or customer acceptance. The matrix's proposed tests remain unexecuted.

Carry forward [OBS-FW01](observation-framework-fixture.md): the shipped framework regression command uses the live tracker as a bootstrap fixture and failed after legitimate progress (62 passes, 23 failures at sequence 5). An independent controlled bootstrap-seed diagnostic passed 85 tests, but is not a passing run of the shipped command. Current/prior tracker validation passed. The observation remains an open framework defect with a separate proposed isolated-fixture repair; do not silently repair scripts, suppress failures or add it as a new engine finding. It is not a required K1/K2 check and does not by itself invalidate this source-only task.

## Residual work and next action

The handoff must point to the matrix's proposed narrow implementation slices, their acceptance outputs and cross-package interfaces, without admitting them automatically. Retain full doc35 W01 scope and W03/W08/W37 isolation/identity dependencies; route inventory is not implemented enforcement or full package decomposition. D01 and D08 remain pending with accountable human owners; they inform this task but their absence does not prevent source inspection. Later implementation must distinguish decision-dependent demo/asset topology from independently actionable technical restrictions.

Next action after accepted W01.01 is a lead/user selection and bounded admission of the next remediation task with concrete before/after tests and rollback; no implementation starts on the strength of this handoff. Propose repairing OBS-FW01's fixture isolation before relying on the ordinary framework regression suite for continued execution. Do not reinterpret that repair proposal as authority to change scripts in W01.01.

Update [RESUME.md](../../RESUME.md) and tracker/journal before yielding. Final task state comes from the validated tracker and actual retained evidence, not this contract's existence.
