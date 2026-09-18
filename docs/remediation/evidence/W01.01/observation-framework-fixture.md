# OBS-FW01 — regression fixtures depend on the live execution tracker

Lead triage: open, independently reproduced framework-test defect; not an engine F/N entry or a W01.01 C1–C3 blocker. Fix it before treating future full-suite output as assurance. No script fix is authorized in this task.

## Discovery, authority and reviewed basis

- Reviewer/run: `/root/framework_governance_review`; assigned `gpt-6-astra`, `xhigh`. These are recorded orchestration/assignment identities, not independent provider attestation.
- Task context: W01.01 source-only inventory. The lead requested this bounded read-only diagnosis after legitimate tracker admission/start caused the unchanged framework suite to fail. The reviewer may create only this observation file; no checker/test/tracker or engine edits were authorized.
- Recorded UTC checkpoint: `2026-09-06T21:39:35Z`; Node.js `v22.15.0`.
- Board SHA256: `bca77e89af7d9f627e3b6ea8fc9e8a5e3fc781ec973873c8c753a9aeb6e98377`.
- Test SHA256: `db6d3d0e61895c0ad2b02760a141c29ee88ce08e6014117abf9734ef54f8b3cc`.
- Observed live tracker SHA256: `cba173b3eb191294cd4d5b5b0f71eedfe02f2fe8289ed800a8494969d24543cd`; W01.01 in progress at journal sequence 5.
- Retained bootstrap tracker SHA256: `3bab9f0407f98c0d7047c7dabd69f068e36852c3ac98755ff41a860105beb91a`, in `tracker-before-admission.json`, sequence 1.
- Retained READY tracker SHA256: `d0a5bcd403c5a2b8f624099a92d8e471e07140efa2e905e8cfaebdb710be7821`, in `tracker-after-ready.json`, sequence 4.

The board and test hashes match the independently reviewed framework bootstrap. The live tracker has legitimately changed under the authorized design task. No source hash was repinned and no historical tracker was restored by this diagnosis.

## Independently observed results

| Check | Result |
|---|---|
| `node scripts/remediation/board.mjs check` | Exit 0; valid framework-only register with one in-progress design task and all 41 packages open. |
| `node scripts/remediation/board.mjs status` | Exit 0; same actual state. |
| `validateTracker(current, { rootDir, previousTracker: beforeAdmission })` | `ok: true`, no errors; sequence 1 to sequence 5. |
| `validateTracker(current, { rootDir, previousTracker: afterReady })` | `ok: true`, no errors; sequence 4 to sequence 5. |
| Unchanged `node --test scripts/remediation/board.test.mjs` | Exit 1; 85 tests, 62 pass, 23 fail, zero skipped/cancelled/todo. |
| Same test source evaluated in memory with the retained bootstrap tracker as its seed | Exit 0; 85 tests, 85 pass, zero failures/skips/cancellations/todo. Repository test/checker/tracker files unchanged. |

Commands used a Node `spawnSync` wrapper to retain the actual suite exit status and summarize failures. The controlled run used `node --input-type=module -e <in-memory test source>` with line 13's seed read changed to `docs/remediation/evidence/W01.01/tracker-before-admission.json`; repository/import paths were adapted for in-memory evaluation. No other test behavior changed. This is a diagnostic experiment, not a passing result for the shipped command.

Both suite runs used fresh temporary fixtures and their existing cleanup callbacks. No application modules, handlers, network/app tools, deployed runtime, credentials or customer records were exercised. Repository script/tracker hashes remained unchanged.

## Cause and consequence

Source-confirmed and locally reproduced anchors in `scripts/remediation/board.test.mjs`:

- Lines 13/22 load and clone the live tracker, including real governance/approval references whose files are absent from the synthetic temporary root. The first fixture reports missing `change-002-authority.json`, `change-003-task-contract.json` and `plan-v1.md`; actual-repository validation finds these files successfully.
- Lines 60–67 append synthetic sequences 2–5 after real sequence 5, rewrite copied assignment snapshots, and set a preflight snapshot at hard-coded index 2. Synthetic ordering, transitions and plan/actor/digest relationships become invalid.
- Lines 111–114 assume a single draft task despite legitimate progress.
- Lines 141–142 mutate `actors[1]`, now human `w01-user`, so they no longer test the intended synthetic agent's model/effort.

Thus the ordinary suite is not isolated from operational state. The 23 failures are not evidence that 23 checker invariants broke or that the admitted W01.01 register is invalid. The 62 passes also cannot all be treated as reliable isolated negative regressions: many mutation cases begin from an already-invalid fixture. The controlled bootstrap-seed result isolates the live seed as the cause for this observed state; it does not prove there are no other future-state weaknesses.

This is a new framework-harness observation discovered during W01.01, related to the execution protocol's regression and durable-history assurance. It is not a duplicate of an engine F/N finding. The earlier 85-pass bootstrap result remains a true historical result for its recorded seed and artifacts; it did not qualify the suite after the operational tracker progressed.

## Effect on W01.01 acceptance

This defect does not by itself invalidate the actual W01.01 records or require stopping the authorized source inventory. The approved plan and the actual task's required checks K1/K2 concern source inventory and independent source/design/handoff review; they do not make this synthetic framework suite a required W01.01 acceptance check. Current and retained-prior validation both pass on the real register with its real evidence paths.

Bounded task acceptance still requires its actual K1/K2 criteria, frozen evidence, independent review, handoff, lead disposition, current/prior validation and no-engine-change check. Preserve this open observation. Do not call the ordinary suite passing, suppress failures, weaken required checks, reset the live tracker or promote inventory completion into W01/F/G/release acceptance.

The defect blocks a claim that the framework's shipped regression command remains reliable after routine tracker progress. Any future change that relies on this suite needs corrected fixtures and independent rerun before that regression evidence can support acceptance. This conclusion is scoped to the actual source-only task and observed unchanged checker; a future task with an explicit suite-passing prerequisite must honor that prerequisite.

## Proposed future remedy and regression scope — not implemented

- Replace the live seed with a dedicated deterministic test fixture/builder. Keep canonical audit checks and actual current/prior register checks separate; do not use this operational backup permanently as test infrastructure.
- Use stable actor/task/event IDs and assert valid baselines before negative mutations. Test independence from a separately progressing READY/in-progress/closed/reopened tracker, extra governance records/evidence and reordered actors.
- Independently rerun the repaired suite and actual current/prior checks under a future bounded framework-change mandate. Preserve chronology, source-drift, independence and append-only enforcement.

The lead will link `OBS-FW01` from the final task handoff/RESUME and retain it as open future framework work. No new canonical audit ID or document-35 change is proposed. Only this observation file was created.
