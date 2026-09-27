# Closure Ledger: Engineering-Team Bootstrap Memo

**Toolkit:** Closure Ledger 0.1.0 / schema 1  
**Audience:** coordinator, lead, specifier, implementer, reviewer, and CI owner  
**Normative reference:** `README.md`

This is an operational handoff, not an agent prompt. The coordinator owns repository-specific agent definitions, models, permissions, and prompt text.

## Mission

Use Closure Ledger to finish a fixed list of owner-visible tickets without turning tests, review stages, commits, or acceptance clauses into a second backlog.

The governing equation is:

```text
progress = tickets with valid receipts / frozen owner-visible tickets
```

If the program begins with 26 tickets, every report remains `x/26`. Criteria and tests prove a ticket; they never increase the denominator.

## The five rules to remember

1. `program.json` contains the exact ticket list and complete work orders.
2. `next` identifies the only normal delivery target; a blocker is never skipped.
3. Specification is reviewed before implementation, and specifier, implementer, and reviewer are separate.
4. A ticket becomes done only through a valid, hash-pinned receipt.
5. `status` is the score. Nobody types `DONE`, percentages, or alternative progress counts.

## Bootstrap packet

Give a newly assigned team only:

1. Repository instructions such as `AGENTS.md`.
2. This memo and the toolkit `README.md`.
3. The validated `program.json` and its `receipts/` directory.
4. Current `status --json` output.
5. The rendered work order for the current ticket.
6. Authority sources and evidence named by that ticket.

Do not make the team reconstruct state from lane logs, chats, old handoffs, or manually maintained scores.

## Sources of truth

| Source | Purpose |
|---|---|
| Repository instructions | Safety, architecture, Git, database, and permission rules. |
| `program.json` | Frozen denominator, order, and executable ticket contracts. |
| `receipts/*.json` | Evidence-backed ticket closure. |
| `status` output | Derived program progress and next ticket. |
| Rendered work order | Read-only view of one ticket; regenerate rather than editing it. |
| Referenced evidence | Actual test, integration, review, artifact, or live-acceptance proof. |

If a work order conflicts with its cited authoritative requirement, stop and return the conflict to the contract authority.

## Roles

| Role | Does | Never does |
|---|---|---|
| Contract authority | Freezes ticket scope, decisions, paths, commands, and denominator changes. | Silently narrows the original requirement. |
| Lead | Runs the ledger, assigns only `next`, coordinates roles, and reports derived status. | Implements, specifies, reviews, hand-edits status, or creates scored subtasks. |
| Specifier | Writes the acceptance test and negative control from the frozen criteria. | Edits product code, weakens criteria, or implements the solution. |
| Implementer | Changes only allowed product paths and produces evidence at one exact artifact. | Edits reviewed tests/contracts or reviews itself. |
| Reviewer | Reviews the specification before build and judges the delivered artifact afterward. | Edits tests, product code, or criteria to manufacture a pass. |

The reviewer named in `specificationGate` must issue the final receipt verdict. The implementation actor must differ from both the specifier and reviewer.

## What the tool verifies

Closure Ledger verifies:

- exact ticket count, identity, and order;
- one work order per ticket and at most one `ACTIVE` ticket;
- absence of placeholders and ambiguous executable language;
- complete criteria, decisions, blockers, commands, and write boundaries;
- independent specification review and negative-control evidence;
- receipt hashes, exact commands, role separation, and evidence fields;
- strict delivery order; and
- separate local and final/live completion.

It does **not** run tests, inspect evidence truth, write code, grant Git/deployment authority, or merge changes. CI and the reviewer must produce and judge real evidence.

## Day-zero commands

Verify the toolkit:

```bash
npm --prefix tools/closure-ledger test
npm --prefix tools/closure-ledger run check:example
```

For an existing program:

```bash
node tools/closure-ledger/bin/closure-ledger.mjs check \
  --program path/to/delivery-control/program.json \
  --receipts path/to/delivery-control/receipts

node tools/closure-ledger/bin/closure-ledger.mjs status \
  --program path/to/delivery-control/program.json \
  --receipts path/to/delivery-control/receipts

node tools/closure-ledger/bin/closure-ledger.mjs next \
  --program path/to/delivery-control/program.json \
  --receipts path/to/delivery-control/receipts
```

All commands must succeed before assigning work. Continue the reported state; do not redesign the queue or recalculate the denominator.

## Creating a new 26-ticket program

```bash
node tools/closure-ledger/bin/closure-ledger.mjs init \
  --dir path/to/delivery-control \
  --ids W16-W41 \
  --program-id project-remediation \
  --title "Project Remediation W16-W41"
```

The scaffold contains exactly 26 tickets and deliberately fails validation because it contains `TBD` markers.

Before product work begins, the contract authority must replace every placeholder with:

- verbatim authority and exact locator;
- one observable whole-ticket outcome;
- finite criteria covering the complete requirement;
- existing evidence and remaining work;
- resolved decisions or linked deferred-live decisions;
- exact writable paths and commands;
- specification-review and negative-control evidence;
- explicit completion conditions; and
- exact owned blockers where applicable.

Then run `check`. A scaffold is not an executable plan until it passes.

## The one-ticket loop

### 1. Lead selects

Run `next`. Render only that ticket:

```bash
node tools/closure-ledger/bin/closure-ledger.mjs render W16 \
  --program path/to/delivery-control/program.json
```

Every other ticket remains inactive.

### 2. Specification passes before build

The specifier creates the ticket's one mechanical acceptance test and a negative control. The reviewer judges the test before product implementation.

The frozen `specificationGate` must contain:

- distinct specifier and reviewer identities;
- exact reviewed test revision;
- `verdict: PASS`;
- review evidence; and
- negative-control evidence.

If this gate fails, return it to the specifier. Do not dispatch implementation.

### 3. Implementer builds

The implementer changes only `allowedPaths`, does not edit reviewed tests or fixtures, and works toward the complete ticket—not individual criteria as separate units.

If the work needs missing authority, a wider write boundary, or changed acceptance, stop and request a contract ruling. Do not improvise or create another scored ticket.

### 4. Evidence is produced at one artifact

Run and retain evidence for:

1. the exact ticket acceptance command;
2. the exact program integration command; and
3. independent reviewer verification.

All three must refer to the same artifact revision. Any failure leaves the ticket open.

### 5. Reviewer judges

The reviewer named in `specificationGate` judges the exact artifact without editing it. A `FAIL` or incomplete result becomes a finite defect list inside the same ticket.

### 6. Receipt closes the ticket

After all three legs pass, generate a receipt without overwriting an existing one:

```bash
node tools/closure-ledger/bin/closure-ledger.mjs receipt-template W16 \
  --program path/to/delivery-control/program.json \
  --kind DELIVERY \
  --out path/to/delivery-control/receipts/W16.json
```

Replace every `REPLACE_WITH` value with exact artifact, actor, command, timestamp, and evidence facts. A narrative claim does not close a ticket.

### 7. Lead validates and advances

```bash
node tools/closure-ledger/bin/closure-ledger.mjs check \
  --program path/to/delivery-control/program.json \
  --receipts path/to/delivery-control/receipts

node tools/closure-ledger/bin/closure-ledger.mjs status \
  --program path/to/delivery-control/program.json \
  --receipts path/to/delivery-control/receipts
```

Only after both succeed:

1. change the completed ticket's routing state to `INACTIVE`;
2. change the reported next ticket to `ACTIVE`;
3. rerun `check --receipts`; and
4. assign the next ticket.

Routing state is mutable and excluded from the hash. Any closure-contract change invalidates the old receipt.

## Definition of done

`DONE_LOCAL` requires a valid receipt proving:

- the current work-order hash;
- exact artifact revision;
- separate specifier, implementer, and reviewer;
- acceptance `PASS` with evidence;
- integration `PASS` with evidence;
- reviewer `PASS` with evidence; and
- every deferred-live row recorded as `PENDING` or evidence-backed `PASS`.

`DONE_FINAL` requires every deferred-live row to be `PASS`.

Always report both:

```text
Local engineering done: x/26
Final/live accepted: y/26
```

## Stop conditions

Stop the current ticket and report one exact condition when:

- authority or a required decision is missing;
- the reviewed test is wrong or insufficient;
- required work falls outside `allowedPaths`;
- acceptance, integration, or review fails;
- the receipt hash is stale;
- required evidence is unavailable; or
- repository permissions prohibit the next action.

A blocked ticket records blocker ID, kind, condition, owner, and evidence. `next` must remain on it. Do not skip forward to keep agents busy.

If a work-order amendment is approved, regenerate its hash-bound evidence. Never copy a new hash into an old receipt.

## Existing work

Existing code is not complete merely because a handoff says so.

To preserve historical completion:

1. reconcile it against the complete current ticket;
2. explicitly list the ticket in `grandfatheredDoneTicketIds`;
3. produce a fully validated `ADOPTION` receipt; and
4. retain the same acceptance, integration, reviewer, artifact, and deferred-live evidence.

Grandfathering grants no completion by itself. It cannot allow a new `DELIVERY` receipt to bypass sequence.

## Owner-facing report

Every report begins with ledger-derived facts:

```text
Local engineering done: 4/26
Final/live accepted: 1/26
Current ticket: W20 [ACTIVE]
Blocker: none
Next action: implement the frozen W20 work order
```

Tests, commits, changed files, reviews, agents, hours, and documentation may be cited as evidence. They are never reported as progress.

## Minimal CI gate

```yaml
- name: Test Closure Ledger
  run: npm --prefix tools/closure-ledger test

- name: Validate program and receipts
  run: >-
    node tools/closure-ledger/bin/closure-ledger.mjs check
    --program path/to/delivery-control/program.json
    --receipts path/to/delivery-control/receipts
```

Protect denominator, specification-gate, and receipt changes with the repository's approved review process. This memo does not grant permission to change CI or perform merges.

## Readiness checklist

Before the first implementation assignment, confirm:

- [ ] Toolkit tests pass.
- [ ] The owner-visible denominator is final and exact.
- [ ] Every requirement is preserved in one ticket contract.
- [ ] Every criterion is finite and observable.
- [ ] Decisions are resolved or linked to deferred live acceptance.
- [ ] Every ticket has one exact acceptance command.
- [ ] Every specification and negative control has passed independent review.
- [ ] Role identities are separate.
- [ ] Write boundaries and repository permissions are understood.
- [ ] The integration command is runnable.
- [ ] Evidence locations are durable and contain no secrets.
- [ ] `check --receipts` passes.
- [ ] `next` identifies exactly one target or one explicit blocker.

If any required box is unchecked, product implementation has not started.

## Cold-handoff rule

A new lead must be able to run `check`, `status`, and `next`, render the current ticket, and continue without interpreting prose history. If it cannot, the handoff is incomplete.

