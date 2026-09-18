# Remediation execution entry point

[Document 35](../architecture/35-audit-verification-and-source-of-truth.md) says what is wrong and what full remediation requires. [Document 36](../architecture/36-remediation-governance-and-execution.md) says how the lead and Astra team execute and verify it. [tracker.json](tracker.json) is the only mutable execution register; [RESUME.md](RESUME.md) is the next-session checkpoint.

Start here in every new session:

```bash
git status --short
node scripts/remediation/board.mjs check
node scripts/remediation/board.mjs status
```

Then read the checkpoint, governance protocol, assigned task and complete parent W scope. A source-hash mismatch requires reconciliation, not regenerating the register.

Test the framework itself:

```bash
node --test scripts/remediation/board.test.mjs
```

The board commands are read-only. A successful check means **tracker consistency verified**, not that the engine is safe, a customer accepted it, or a release is authorized.

All W01–W41 are retained. Initially only W01.01 is drafted, with the rest explicitly awaiting decomposition. No engine task is completed or authorized by this setup. The user requires delegated agents to be gpt-6-astra at xhigh/max/ultra; the implementer and independent reviewer must be different runs.

Templates: [task](templates/TASK.md), [evidence](templates/EVIDENCE.md), [handoff](templates/HANDOFF.md), [decision](templates/DECISION.md), [new observation](templates/OBSERVATION.md). These support the JSON records; do not create a competing manual “done” checklist.

The lead updates the JSON and its retained history deliberately; there is no mutating board command. The checker supports bounded task acceptance, explicitly reviewed full-package/containment acceptance and recorded human decisions. Finding, gate and release approval are not implemented in version 1 and cannot be enabled by changing a status label. Their later support requires an explicit governance change and the applicable evidence/authority.

Decision IDs D01–D10 identify the ten questions in document 35 §7. They are not the D1–D13 customer-paper dispositions in §4; cite the source section and record type to avoid conflating them. Detailed customer-clause-to-task mapping remains pending decomposition.

For record updates, follow the executable schema in [board.mjs](../../scripts/remediation/board.mjs) and the synthetic lifecycle examples in [board.test.mjs](../../scripts/remediation/board.test.mjs):

- Task transitions retain the then-assigned actor/run snapshots; starting work also retains the exact approved preflight snapshot. A later lead must not rewrite earlier actors.
- Source, mandate, decision, evidence, package and task-contract changes use `record_change` journal entries with a retained JSON `{ "before": ..., "after": ... }` record and the corresponding digests. The record is evidence of the change, not a substitute for actual approval.
- Preserve previous accepted artifact/review/signoff snapshots in `acceptance_history`. Mark invalidated proof `revalidation_required` while replacement is pending; retain supersession chains rather than deleting history.
- To verify append-only changes, use the exported `validateTracker(current, { rootDir, previousTracker: trustedPrior })` with an independently retained prior tracker. The CLI checks the current register only; without a trusted prior it cannot establish that history was not rewritten.

Do not commit/push, deploy, provision, rotate credentials, run customer-data operations or amend scope without the applicable authority. Preserve the user's existing worktree changes.
