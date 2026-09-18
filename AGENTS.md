# Remediation execution instructions

These instructions govern work on the content/personalization remediation programme in document 35. They do not authorize unrelated changes or external operations.

The user's latest explicit instructions take precedence. Where older execution documents conflict with the standing agreement below, apply this agreement while preserving document 35's full original requirements.

## Standing execution agreement — 2026-09-16

- The lead delegates all product implementation to agents and coordinates independent review; the lead does not implement engine fixes. The lead retains ownership of the existing execution records.
- Complete the original W01–W41 items in their original order and full scope, preserving existing fixes. Do not silently reduce scope, skip a blocked item, substitute a roadmap, or treat a completed subtask as a completed W item. Surface the exact blocker and required owner decision.
- The user explicitly authorized continuing W02–W41 local implementation in order after each item's independent local review, leaving live acceptance open and batching deployment-dependent checks at the end. A live-only acceptance dependency does not block the next local item. Reuse this mandate without asking again per item; it does not authorize deployment, cloud/resource mutation, credential operations or full acceptance without evidence.
- Before every delegation, change of direction, or completion report, check the current W item's complete requirements and these instructions. Each assignment identifies the W scope, exclusive file ownership and focused acceptance checks. A distinct reviewer checks the actual artifact against the whole W requirement before full-item acceptance.
- Keep documentation to essential, concise admission, completion, handoff and real-issue records in the existing system. Do not create another tracker, framework or documentation programme. Documentation and test counts are not implementation progress.
- Use the smallest sufficient checks and reuse valid evidence. Broaden testing only for a concrete defect, affected dependency or documented requirement, stating the reason. Do not run broad CI pipelines routinely for small changes.
- Deliver coherent implementation batches. Do not automatically commit, merge, push or deploy individual fixes; those operations require their applicable separate authority.
- On every resume or context change, reread this agreement and the latest checkpoint. Keep the actual active W item, assigned agents, unfinished requirements, review failures and exact next action in the existing records. Report only completion supported by evidence; a deadline does not justify claiming unfinished work is done.

## Read before remediation work

1. Read [the execution entry point](docs/remediation/README.md).
2. Read [the governance protocol](docs/architecture/36-remediation-governance-and-execution.md) and [the resume checkpoint](docs/remediation/RESUME.md).
3. The lead runs `node scripts/remediation/board.mjs check` and `node scripts/remediation/board.mjs status` at session bootstrap and relevant task admission/acceptance checkpoints. Reuse the result while relevant inputs are unchanged; workers do not duplicate these checks. Conversation-only turns and unrelated documentation edits do not require another run.
4. Read the assigned task, its complete parent W scope in document 35, linked findings/requirements, and applicable source. Do not substitute an agent summary for these instructions or the acceptance contract.

If the checker reports source drift or inconsistent state, reconcile it before changing implementation. A valid tracker is not a passing engine, customer acceptance, or release approval.

## Agent policy and ownership

- The user requires all delegated agents to use **gpt-6-astra** with **xhigh, max, or ultra** reasoning. Never silently fall back to a weaker model/effort. Escalate if the requested configuration is unavailable.
- The lead owns task admission, dependency and integration coordination, the existing execution records, source-of-truth maintenance and final acceptance. Assign product edits and integration fixes to workers; coordination does not authorize the lead to implement them.
- A worker owns only its explicitly assigned task files. Independent reviewers inspect the actual artifact and evidence; an implementer cannot independently verify its own work.
- Use one active implementation/integration task by default. Read-only investigation and independent review may run in parallel. Do not allow overlapping file ownership or concurrent edits to governance records.
- Subagents must not create further delegations unless the lead explicitly assigns that authority, still subject to the same model/effort policy.

## Measure before, verify after

### Throughput and North Star — standing user direction, 2026-09-07

- Prioritize implemented remediation against document 35 and the customer-neutral engine's relevance, latency, explainability and trustworthy measurement. Documentation and test counts are not product progress.
- Keep plans, evidence and handoffs concise. Reuse the existing tracker and checks; do not create another framework, infrastructure-validation programme or broad test matrix for a small change.
- Set the smallest sufficient acceptance checks before coding. Expand only for a concrete defect, affected dependency or documented requirement, with an explicit reason. Prefer coherent in-scope fixes to repeatedly revisiting the same source for tiny edits.
- Preserve independent review, truthful evidence and required safety checks. Reuse valid accepted dependency assurance where the task contract permits; never hide stale proof, backdate execution or call housekeeping a new remedy.

Before each coherent implementation assignment, keep one concise preflight in the existing task record: scope, relevant baseline/reproduction or justified design case, acceptance criteria, dependencies/decisions, test/measurement plan, rollback and lead approval. Reuse unchanged scope and valid dependency evidence; do not create separate documents for each field or restart preflight for every small edit.

After implementation, preserve exact artifact identity, checks and results, limitations, independent review, lead disposition and handoff. Missing, failed, skipped or stale required evidence is not a pass. Record rework and superseding validation rather than rewriting history.

Task completion, verified containment, verified W-package scope, finding closure, contractual acceptance and release approval are different states. Do not automatically promote one into another. In particular, W36 does not close F14, gamma zero is not a learning-ingestion kill switch, and a helper test is not customer or deployed-runtime acceptance.

## Authority and safety

Current authority is recorded in the tracker and checkpoint. Framework setup alone does not authorize engine fixes. Once the user grants a bounded implementation mandate, record and reuse it; do not ask again for every already authorized local step.

Deployment, cloud/resource mutation, credential rotation, destructive cleanup, customer-data operations, external messages and customer-scope amendments require their own applicable authority. Agents cannot approve a customer/privacy/business decision by voting among themselves.

Preserve pre-existing worktree changes. Never restore/delete unrelated files, commit/push, or invoke provisioning/deploy/seed scripts merely to make a check green. Keep credentials and customer records out of evidence.

## Durable handoff

Update the existing tracker/journal and RESUME.md when execution state, assignments, evidence, decisions or the next action actually change. Before yielding, switching ownership or starting a fresh context, ensure those records are current; unchanged state needs no new entry or repeated history. Keep failures and unresolved requirements visible. Only the lead marks task/package acceptance after independent evidence has been checked.
