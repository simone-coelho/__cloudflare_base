# Task contract — <task ID>

Template only. Current status/assignments live in tracker.json; this document is the reviewed scope/plan artifact. Preserve previous approved versions.

## Identity and authority

- Task / parent W / linked criteria:
- Linked F/N and customer clauses:
- Canonical audit path and hash:
- Tracker kind: design / implementation. Describe the purpose separately: inventory, containment, remediation, capability or verification.
- Intended bounded outcome; what remains undelivered:
- User authorization record and permitted actions:
- Lead; implementer run; independent verifier run:
- Delegation configuration: gpt-6-astra, xhigh/max/ultra.
- Risk-domain reviewers and accountable acceptance owners:

## Scope and ownership

- Files/interfaces to read:
- Exclusive files/directories allowed to change:
- Protected existing worktree changes:
- Explicit non-goals and prohibited external/data operations:
- Current branch/HEAD, scoped diff and relevant deployed-state unknowns:

## Preflight: check before implementation

- Observed baseline, reproduction command and exact failure/side effect:
- Evidence classification: source_confirmed / locally_reproduced / verifier_reported / unverified.
- For design-only work, the justified question and required source/decision artifact:
- Proposed behavior/interface and alternatives:
- Tenant/identity/consent/erasure consequences:
- Determinism, candidate/eligibility, replay and measurement consequences:
- Schema/rollout/compatibility/rollback approach:
- Source/fixture/artifact fingerprint:
- Lead plan approval and its evidence record:

## Acceptance criteria and checks

| Criterion ID | Canonical scope fragment / customer requirement | Observable pass condition | Required check/evidence and runtime | Acceptance owner |
|---|---|---|---|---|
| <ID> | <full obligation; no hidden remainder> | <what distinguishes correct from broken> | <exact command/fixture or required external attestation> | <role/run/person> |

Define test classes appropriate to risk: happy/negative path, no-side-effect checks, tenancy, consent, identity, concurrency/retry, stale/partial failure, runtime limits, compatibility, reconstruction, browser/feed and measurement.

For performance, define population, workload, sample size, CPU/request/browser timing, errors/timeouts, budget and retained output. A smoke or local microbenchmark is not an SLO.

## Dependencies and decisions

| Output/decision ID | Source-explicit or proposed | Blocks start or acceptance | Required accepted artifact | Resolving owner |
|---|---|---|---|---|
| <ID> | <classification> | <stage> | <contract/test/customer record> | <owner> |

Do not invent whole-package cycles. A missing customer choice must not block unrelated safe inventory work.

## Handoff requirements

- Changed artifact/file manifest and configuration/workload basis:
- Each check's actual command, exit/result and evidence path/hash:
- Regression/compatibility/rollback results:
- Independent verdict and exact reviewed artifact:
- Lead disposition:
- Residual criteria, new observations and next proposed task:

No result in this template is a pass until supported by evidence and reflected through the validated tracker/journal.
