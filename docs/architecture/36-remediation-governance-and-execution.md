# 36 · Remediation governance and execution protocol

Internal. Established 2026-09-06. This creates the execution framework requested by the user; it does not start or authorize engine fixes.

## 1 · Purpose and authority

The lead architect coordinates a reusable, customer-neutral engine remediation programme. Astra workers perform bounded assignments; independent Astra reviewers challenge the artifacts; the lead accepts or returns work. Tapestry/Coach supplies customer requirements and acceptance scenarios, not the platform's identity.

There is one source for each kind of truth:

| Record | Authority |
|---|---|
| [Document 35](35-audit-verification-and-source-of-truth.md) | Reconciled defect/requirement meaning, qualifications, canonical W01–W41 scope and G0–G4 obligations. Raw verifiers remain evidence, not competing backlogs. |
| [tracker.json](../remediation/tracker.json) | Current execution state, package/task coverage, assignments, evidence references, decisions and transition history. Do not maintain separate editable checkbox counts. |
| This document | Rules for admission, delegation, validation, acceptance, escalation and handoff. |
| [RESUME.md](../remediation/RESUME.md) | A short navigation/checkpoint record. It points to the tracker; it does not override it. |
| Evidence/decision records linked by the tracker | Durable support for a particular claim, artifact, configuration and approving authority. A link without verification is not acceptance. |

The audit's source text is fingerprinted. If it changes, stop silent propagation: inspect the change, record which scope/dependencies/evidence it affects, reconcile the tracker deliberately and retain history. Never rebuild a fresh tracker over ongoing work. A hash pins local content; a commit or dashboard label alone does not prove the deployed configuration.

At bootstrap the user has authorized this framework, not the W-package implementations. No engine, cloud, credential, customer-data, release or commercial authority is inferred from an audit recommendation. Once a bounded implementation mandate is explicitly given, record it and proceed autonomously within it; repeated permission prompts for ordinary approved work are unnecessary.

## 2 · Roles and review independence

| Role | Responsibility and limit |
|---|---|
| User / accountable customer and delivery owners | Implementation mandate and applicable deployment, scope, identity/privacy, experiment, entitlement and commercial decisions. An agent cannot impersonate these approvals. |
| Lead architect | Select the next eligible task, approve its design/test contract, assign exclusive scope, resolve technical tradeoffs, integrate, inspect independent evidence, accept/reopen work and maintain durable records. |
| Astra implementer | Reproduce/understand the bounded issue, implement only the assigned artifact, run declared checks and report failures/residual work. Cannot self-close the task or widen scope silently. |
| Independent Astra verifier | Inspect the changed artifact and source, challenge the original reproduction and acceptance criteria, independently run relevant checks, measure the actual workload and record a separate verdict. Cannot treat the implementer's summary as proof. |
| Specialist reviewers as needed | Security/privacy/tenancy, runtime/performance, learning/statistics or customer/SDK review. Review the relevant risk domains; multiple agent opinions do not replace empirical evidence or human authority. |

All delegated agents use **gpt-6-astra at xhigh or higher** (xhigh/max/ultra). Record model, effort and distinct run IDs. If that configuration is unavailable, escalate; do not downgrade silently. The lead has final technical integration responsibility, but is not a substitute for the customer's privacy owner or scientific/business acceptance owner.

One active implementation/integration task is the default. Parallel read-only investigation, requirements work and verification are encouraged when independently useful. Additional writers require explicitly separated task/file ownership and an approved concurrency policy. In the shared worktree, an agent's changes are immediately visible to others; assume no automatic isolation.

The lead alone edits tracker/journal, package scope, source-of-truth dispositions and governance policy. Workers may write only their assigned implementation and own evidence/handoff files. The verifier records its own review. Avoid two agents editing the same file or accepting a moving artifact.

## 3 · What a status means

The task lifecycle is:

`draft → ready → in_progress → verification → closed`

A rejection returns work for correction. A genuine blocker records its reason, resolving owner and next action; it is never completion. Reopened work preserves the original acceptance evidence and records what invalidated it. The validator's supported transition rules are the executable contract.

| Outcome | Meaning; what it does not mean |
|---|---|
| Task closed | A bounded deliverable met its own criteria on the reviewed artifact, with independent evidence, lead acceptance and a handoff. A design inventory can close without delivering the route fix. |
| Containment verified | A tested restriction prevents a stated risk within an explicit configuration/operating boundary. The capability and historical-data obligations may remain open. |
| Package scope verified | All applicable criteria in the complete W scope have accepted coverage; no omitted obligation is hidden behind a smaller completed task. W36 can satisfy its containment-only package scope without closing F14. |
| Finding closed with evidence | All relevant cross-package obligations and the required acceptance are satisfied in document 35. A package checkbox does not automatically change finding disposition. |
| Gate/release accepted | A separately reviewed operating boundary and a specific candidate artifact/configuration/environment have the necessary proof and authority. A count of closed tasks is not an approval to use real data or deploy. |

Preserve finding meanings: open, contained, remediated pending acceptance, closed with evidence. N04 aliases N01; N28 aliases N06's isolation subpart; N21 is a model question; N30 is assurance, not a defect. Do not inflate progress with alias or clean-check counts.

All 41 W packages are registered. Most initially remain explicitly **unscoped for execution**: their canonical scope is retained, but atomic tasks and criteria have not yet been designed. This is visible unfinished planning, not missing work and not permission to start coding. W01.01 is the sole draft first task; no W task is completed during framework bootstrap.

## 4 · The two checks around every implementation

### Check one: define and challenge the change before cutting code

The lead admits a task only after these are recorded:

- Parent W scope, linked findings/customer clauses and **which portion** this task addresses. Identify containment versus full remedy, residual work and non-goals.
- Current source/worktree baseline and protected user changes. Confirm cited behavior still exists; distinguish source-confirmed, locally reproduced, verifier-reported and unverified evidence.
- A minimal failure reproduction or an explicitly justified design/verification case. For a defect, show the relevant bad state/side effect, not merely a status code.
- Intended interface/behavior, candidate and eligibility invariants, consent/tenant/identity effects, data/schema/rollout implications and failure/rollback approach.
- Stable criterion IDs with objective pass/fail checks, required evidence class, runtime/fixture/workload, measurement boundaries and acceptance owner.
- Start-blocking versus acceptance-blocking dependencies and the exact output each consumes. Record unresolved customer decisions without blocking unrelated read-only design.
- Named implementer and independent verifier, exclusive file ownership, allowed commands/effects and lead plan approval under recorded user authority.

A test that cannot distinguish the current failure from the proposed correct behavior must be corrected before implementation acceptance. Do not set optional/skip flags merely to bypass a required check. Unsupported N/A decisions need explicit rationale and acceptance; they cannot erase a promised capability.

### Execution: bounded implementation with visible exceptions

The worker changes only the admitted scope. New requirements, unexpected shared-file changes, missing authority or new material findings return to the lead. Preserve source/fixture evidence of the new issue and register it; do not silently fix an adjacent issue, bury it in chat or omit it to finish the task.

Run relevant targeted tests first, then integration/regression checks proportionate to risk. Separate local tests from workerd/runtime proof, deployed-resource attestation, browser/feed acceptance and customer sign-off. Do not deploy or exercise credentials as an incidental “test.”

### Check two: independently verify the actual resulting artifact

The worker hands off an identified artifact/diff and evidence; the verifier reviews that frozen scope, not a continuously changing branch. The independent review must:

- Reproduce or inspect the before/after behavior and exercise negative, failure, concurrency/retry and cross-boundary cases appropriate to the change.
- Confirm every required criterion and the residual scope. Inspect assertions for tests that pass for the wrong reason.
- Check compatibility, regression, privacy/tenancy, deterministic decision/replay behavior and the affected data/measurement semantics.
- Measure performance where affected using declared workload, population, runtime and meter; preserve failures/timeouts, sample counts and limitations.
- Record exact commands/results, artifact/configuration identity and a separate pass, fail, blocked or insufficient-evidence verdict.

The lead inspects that review and the actual evidence, resolves disagreements, and either returns the task for work or signs off the bounded result. Update tracker, journal, residual package criteria and handoff **before selecting the next implementation**. Neither a subagent's final message nor a merged commit counts as independent verification.

## 5 · Coverage and dependency discipline

Package decomposition must cover the full canonical W scope, with a reviewer checking that no clause disappeared. Each criterion needs source traceability, applicability, evidence requirements, task coverage, acceptance owner and residual/unverified state. A task may help several criteria, but finishing it only satisfies the criteria the evidence actually proves.

W14 requires explicit coverage for enrichment/review/publication, product-decision persistence, product entitlement, generic AI Search, actual external/SFCC acceptance, typed attributes/audiences, scheduled warehouse destination/readback/deletion, tag-plan deliverables and approved substitutions. Its conditional §2.3 widget/template entitlement is no-cost optional handoff **as available**, not an invented January widget build. W40 packaging and W41 ODP restoration remain separate obligations. Keep document 35 §4's twelve clauses, D1–D13, document 20 dispositions and contractual/scientific distinctions.

Use typed output dependencies rather than blanket package ordering:

| Dependency | Example |
|---|---|
| Start prerequisite | Applying an autonomy proposal transactionally consumes the accepted W11 precondition/write interface, not necessarily every unrelated W11 acceptance task. |
| Shared interface/design | W03/W37 tenant context; W04/W05/W06/W35 ownership, consent and deletion epoch; W09/W22/W24/W26/W30 event identity, generations and history. Co-design these without cycles that prohibit all progress. |
| Acceptance prerequisite | Full replay depends on retained immutable snapshots; valid long-window inference depends on enrollment, outcomes and mature coverage. Useful implementation need not wait six months to begin. |
| Human/external acceptance | Customer feed, SSO, ODP, warehouse, entitlement, scope substitution and conditional widget availability require named owners and evidence. Agents do not invent that approval. |

Source-explicit dependencies and proposed architectural dependencies must be labeled separately. Check task graphs for cycles and dangling references. The first inventory task does not need a completed demo topology decision merely to list reachable surfaces.

## 6 · Gates, measurements and non-negotiable boundaries

G0 **and G1** precede real-data pilot operation, including shadow collection. G2 engineering readiness remains distinct from v8 §3.2's observable Content/Experience contractual milestone. G3 distinguishes safe feature enablement from proof of business incrementality. G4 requirements move earlier where current Tapestry-wide isolation/capacity promises require them.

The tracker must never derive a gate pass or release authorization from task/package totals. Gate/finding/release approval is a separate review; the initial checker is not a release approval engine. Unimplemented automated acceptance operations must fail closed, not accept an unchecked “passed” label. Actual approvals require scoped evidence and the appropriate authority, retained in the governing audit/decision records.

Preserve the audit's hard distinctions during implementation:

- W36 mitigates parts of the session path; W35/W11 authoritative correctness remains. A host toggle or read/check/write sequence does not prove atomicity.
- W09/W22/W30 jointly establish delivery and reconstruction. A DLQ cannot capture producer rejection; logging is not recovery.
- W21 enrollment, production control, eligibility, outcome capture and protocol precede collection of experiment evidence. Mature-window acceptance follows collection.
- W23/W24 resets are not historical reconstruction. Record lost history, generations, stale caller/cached-snapshot behavior and recovery.
- Gamma zero does not stop ingestion or all exploration. Feature withdrawal must be enforced and tested across all exposed paths.
- Minimizing future telemetry does not erase historic subject data. Manifest values do not attest deployed resources.
- Correct helper algebra is not a valid experimental unit/control or proven lift. Global-item fatigue and reference choices require the documented model contract, not automatic rewrites.
- Preserve a customer-neutral deterministic core; do not introduce a runtime model, fingerprinting, customer-specific constants or new infrastructure as an unapproved remedy.

Performance evidence states the fixture/workload, catalog/vector/position size, environment/configuration, cold/warm/fresh/returning population, sample size, CPU versus request versus browser timing, error treatment and resource limits. Local microbenchmarks and a green unit suite do not close an SLO or customer acceptance. Reuse document 35's evidence instead of silently changing the target.

## 7 · Evidence, source drift and revalidation

Use [the evidence template](../remediation/templates/EVIDENCE.md). Evidence is a retained record of a specific test/review against a specified basis, not just “tests passed.” Attach safe outputs and their hashes; never store credentials, full secret bindings or customer records.

Identify relevant source files, dependencies, generated SDK/build artifacts, schema, configuration, data generations, topology, workload and enabled capabilities. Evidence files are immutable once used for acceptance; corrections are superseding records and journal entries.

A source/artifact/configuration change that invalidates reviewed assumptions requires **revalidation**, preserving the earlier result as historical. Do not overwrite a previous verdict to make it appear it reviewed new code. Dependency-scoped manifests avoid invalidating a proof for an unrelated documentation change; a changed approval/evidence file itself must still be detected. Historical task success is not automatic readiness of a new release candidate.

The JSON checker verifies record consistency, hashes, relationships and supported closure rules. It cannot prove that an agent actually ran a command, that two named actors are independently controlled, that a human approved a decision, or that a cloud deployment matches a manifest. The lead must inspect primary evidence and obtain external attestation where required.

Reviewers must also establish that the manifest includes every relevant changed/output file and dependency, and that the criteria and checks actually discharge the canonical scope. Matching declared hashes and copied scope fragments is not proof of semantic completeness. Review the actual diff and source, not just the JSON.

An append-only journal is verified against a trusted earlier snapshot when available. Sequence validation without a trusted prior cannot prove history was not rewritten. Keep reviewable version-control checkpoints under the user's commit authority. Do not add automatic commits, staging, reset/checkout, pushes or deployments to the board command.

## 8 · Context preservation and handoff

Before yielding, changing task ownership or losing a working context:

1. Update the tracker and journal with actual transitions, evidence references, failures/rework, pending decisions and residual scope.
2. Write the task [handoff](../remediation/templates/HANDOFF.md). Record exact source/artifact state, pending commands/sessions, validation results, limitations and next action.
3. Update [RESUME.md](../remediation/RESUME.md) with a concise pointer to the active/draft task and the next executable action. Do not duplicate all mutable status in prose.
4. Run `node scripts/remediation/board.mjs check` and `node scripts/remediation/board.mjs status`. Investigate inconsistencies; never reset the tracker to make the checks pass.
5. Report what is actually accepted, what remains open and whether the next step requires a user/customer decision.

A new lead starts from the entry point, checkpoint, validated tracker, canonical task scope and evidence—not recollection of chat or raw agent conclusions. Record unexpected new findings using [the observation template](../remediation/templates/OBSERVATION.md); triage them into the canonical audit/coverage before they can be forgotten. New scope IDs require an explicit reconciled source change and corresponding validator/coverage update, not a hidden extra task.

## 9 · Initial execution boundary and first action

The bootstrap leaves all 41 packages unfinished, findings unchanged and gates not assessed. W01.01 is a **draft read-only inventory/design task** for the real route/method/upgrade/binding table, side effects and proposed customer-boundary negative tests. It removes no route and closes no perimeter finding.

After the user authorizes the intended remediation/design phase, the lead admits W01.01 with its preflight and reviewers. Subsequent bounded implementation may follow accepted contracts and recorded authority. Customer decisions are requested when they materially block the selected work—not as a substitute for safe investigation and not after their outcome has already been assumed.
