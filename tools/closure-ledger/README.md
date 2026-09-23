# Closure Ledger

Closure Ledger is a small, dependency-free Node.js toolkit for running agent-led delivery programs without allowing the tracking system to become the work.

It is designed for programs where:

- the owner has a fixed list of outcomes;
- requirement rows contain several acceptance clauses;
- agents implement and verify the work;
- existing work may need to be reconciled rather than rebuilt;
- live or customer acceptance happens separately from local engineering; and
- progress must remain mechanically truthful.

The central rule is simple:

> The owner-visible ticket is the completion unit. Acceptance clauses prove the ticket; they never become a second progress denominator.

Closure Ledger does not implement product features, run deployments, write agent prompts, or decide business policy. It freezes work orders, validates that they are executable, derives completion from receipts, and identifies the next ticket without skipping blockers.

## What this prevents

The validator and status engine are specifically intended to prevent these failure modes:

- changing 26 owner-visible items into hundreds of scored sub-units;
- increasing the denominator while work is in progress;
- counting tests, commits, documents, reviews, or hours as product progress;
- treating an unresolved decision as a test that can never pass;
- declaring a ticket complete by manually editing a status field;
- allowing an implementer to verify its own work;
- allowing implementation to begin before an independent reviewer has judged the acceptance specification and its negative control;
- closing later delivery tickets while an earlier ticket remains open;
- hiding deferred live acceptance inside local engineering status;
- silently changing a work order after implementation; and
- dispatching work orders containing `TBD`, `TODO`, `no-witness`, placeholders, or similarly ambiguous language.

## Guarantees

When `closure-ledger check` passes:

1. The ticket denominator is explicit, ordered, unique, and complete.
2. There is exactly one work order for every frozen ticket ID.
3. At most one ticket is marked `ACTIVE`.
4. No ticket is manually marked `DONE`.
5. Every ticket has authoritative scope, a single outcome, acceptance criteria, remaining work, a write boundary, one acceptance command, and explicit completion conditions.
6. Decisions are either resolved with authority or deliberately classified as deferred live acceptance.
7. Known blockers are explicit and owned.
8. Read-only reconciliation and verification tickets cannot grant writable paths.
9. Implementation tickets must grant at least one exact writable path.
10. A specifier and a distinct reviewer have approved one exact acceptance-test revision, including negative-control evidence, before implementation begins.

When `closure-ledger status` reports a ticket as locally done:

1. A receipt exists for the ticket.
2. The receipt is pinned to the current work-order hash.
3. The ticket acceptance command is recorded as `PASS`.
4. The program integration gate is recorded as `PASS`.
5. A distinct verifier records `PASS`.
6. The exact artifact revision and evidence references are present.
7. Every deferred live-acceptance row is explicitly `PENDING` or `PASS`.

## Non-goals

Closure Ledger intentionally does not:

- execute the acceptance or integration commands;
- determine whether cited evidence is truthful;
- replace CI, code review, or a deployment system;
- infer decisions from product code;
- create new requirements;
- authorize Git, cloud, credential, customer-data, or deployment operations;
- generate agent prompts; or
- calculate percentage-complete estimates.

The tool verifies the delivery contract and its receipts. Your existing test runner, CI system, and authorized reviewers produce the evidence.

## Requirements

- Node.js 20 or newer
- No npm install is required
- No runtime dependencies

## Package layout

```text
closure-ledger/
├── BOOTSTRAP-MEMO.md            # operational onboarding for an engineering-agent team
├── bin/closure-ledger.mjs       # CLI entry point
├── src/core.mjs                 # validation, hashing, status, rendering
├── src/cli.mjs                  # filesystem-safe CLI commands
├── examples/basic/              # validated three-ticket example
├── test/                        # node:test coverage
├── package.json
└── README.md
```

## Quick start

Run the included example:

```bash
cd tools/closure-ledger
npm test
npm run check:example
npm run status:example
node ./bin/closure-ledger.mjs render T01 --program ./examples/basic/program.json
```

Create a new 26-ticket program:

```bash
node ./bin/closure-ledger.mjs init \
  --dir /path/to/my-program/closure-ledger \
  --ids W16-W41 \
  --program-id personalization-remediation \
  --title "Personalization Remediation W16-W41"
```

`init` creates:

```text
closure-ledger/
├── program.json
├── README.md
└── receipts/
```

The generated program intentionally contains `TBD` markers and fails validation. This is a safety property: a scaffold is not an executable work order.

Replace every placeholder, then run:

```bash
node /path/to/closure-ledger/bin/closure-ledger.mjs check \
  --program /path/to/my-program/closure-ledger/program.json
```

Do not begin delivery until this command passes.

## The data model

One `program.json` is the source of truth. It contains the program configuration and exactly one work order for every frozen ticket ID.

### Program fields

```json
{
  "schemaVersion": 1,
  "program": {
    "id": "personalization-remediation",
    "title": "Personalization Remediation W16-W41",
    "ticketIds": ["W16", "W17", "W18"],
    "maxActive": 1,
    "completionPolicy": "LOCAL_WITH_SEPARATE_LIVE",
    "integrationGateCommand": "npm test",
    "sequencePolicy": {
      "mode": "STRICT",
      "grandfatheredDoneTicketIds": []
    }
  },
  "tickets": []
}
```

| Field | Meaning |
|---|---|
| `ticketIds` | The immutable owner-visible denominator and execution order. |
| `maxActive` | Must be `1`. The method does not permit parallel active tickets. |
| `completionPolicy` | Must be `LOCAL_WITH_SEPARATE_LIVE`. Local delivery and final live acceptance are reported independently. |
| `integrationGateCommand` | The one exact integration command recorded by every delivery receipt. |
| `sequencePolicy.mode` | Must be `STRICT`. The next unfinished ticket cannot be skipped. |
| `grandfatheredDoneTicketIds` | Existing work that may receive an `ADOPTION` receipt even if an earlier ticket remains open. This list grants no completion by itself. |

Changing the ticket list or any program-level contract field changes applicable work-order hashes. Existing receipts then fail closed.

### Work-order fields

Each ticket has this structure:

```json
{
  "id": "W19",
  "title": "Lossless content contract",
  "state": "READY",
  "executionMode": "IMPLEMENTATION",
  "authority": {
    "source": "docs/architecture/requirements.md",
    "locator": "section 5, W19",
    "requirement": "The original requirement copied verbatim."
  },
  "outcome": "One complete observable result.",
  "criteria": [],
  "existingEvidence": [],
  "remainingWork": [],
  "decisions": [],
  "deferredLiveAcceptance": [],
  "allowedPaths": [],
  "acceptanceCommand": "node --test ./test/W19.acceptance.test.mjs",
  "specificationGate": {
    "specifier": "specifier-agent",
    "reviewer": "reviewer-agent",
    "reviewedRevision": "test-contract-w19-r1",
    "verdict": "PASS",
    "evidence": ["evidence/W19/specification-review.json"],
    "negativeControlEvidence": ["evidence/W19/negative-control.tap"]
  },
  "doneWhen": [],
  "blockers": []
}
```

The authoritative requirement is quoted verbatim. The other fields translate it into an executable closure contract without reducing its scope.

### Routing states

Authored state is a mutable routing fact, not completion evidence. A valid receipt overrides it in derived status.

| State | Meaning |
|---|---|
| `NOT_STARTED` | The frozen ticket has no delivery work in progress. |
| `RECONCILE` | Existing evidence must be mapped to the frozen contract without writing product files. |
| `READY` | The ticket is executable and may become active when it is next. |
| `ACTIVE` | The single ticket currently being delivered. |
| `INACTIVE` | No actor is currently assigned; use this after rotating off a receipt-complete ticket. |
| `BUILT_PENDING_VERIFY` | An implementation exists and only the frozen verification path is authorized. |
| `PARTIAL` | Product work exists but the frozen remaining-work list is incomplete. |
| `BLOCKED` | One or more exact, owned blocking conditions prevent execution. |

`DONE`, `DONE_LOCAL`, and `DONE_FINAL` are not legal authored states. They are derived from receipts. Routing state is deliberately excluded from the work-order hash, so the lead can change a completed ticket from `ACTIVE` to `INACTIVE` and activate the next ticket without invalidating evidence. All closure-contract fields remain hash-pinned.

### Execution modes

| Mode | Write policy |
|---|---|
| `IMPLEMENTATION` | `allowedPaths` must name at least one writable path. |
| `RECONCILIATION` | Read-only; `allowedPaths` must be empty. |
| `VERIFICATION_ONLY` | Read-only; `allowedPaths` must be empty. |

If reconciliation or verification exposes product defects, amend the work order through the program's authority process before changing the execution mode or write boundary. Do not let an agent silently convert a read-only assignment into implementation.

## Acceptance criteria are not tickets

Criteria translate a paragraph into finite proof obligations while preserving one owner-visible ticket.

```json
{
  "id": "A1",
  "kind": "LOCAL",
  "observable": "A conflicting identity is refused before state mutation.",
  "proof": "The acceptance test compares state before and after the mounted request."
}
```

There are three criterion kinds:

| Kind | Purpose | Required reference |
|---|---|---|
| `LOCAL` | Code, documentation, or locally executable behavior. | None beyond the explicit proof. |
| `DECISION` | A settled policy or architecture choice required by the ticket. | `decisionId` naming a decision in the same ticket. |
| `DEFERRED_LIVE` | Deployment, customer, browser, workload, or operational acceptance intentionally performed later. | `deferredAcceptanceId` naming a deferred row in the same ticket. |

Criteria IDs may be numerous, but Closure Ledger never reports `criteria passed / criteria total`. The ticket either has a valid receipt or it does not.

## Specification gate

Every ticket has one acceptance command and one specification gate. The gate records that the test contract was reviewed before product implementation began:

```json
{
  "specifier": "specifier-agent",
  "reviewer": "reviewer-agent",
  "reviewedRevision": "test-contract-w19-r1",
  "verdict": "PASS",
  "evidence": ["evidence/W19/specification-review.json"],
  "negativeControlEvidence": ["evidence/W19/negative-control.tap"]
}
```

The validator requires:

- a `PASS` verdict;
- different specifier and reviewer identities;
- an exact reviewed revision;
- review evidence; and
- evidence that a negative control fails for the intended reason.

The implementation actor must differ from both identities. The reviewer named here must issue the final receipt verdict. This preserves the successful sequence—specify, review the specification, build, judge—without turning those stages into scored units. The program denominator remains the owner-visible ticket list.

## Decisions

Decisions must be recovered before a work order is executable.

```json
{
  "id": "D1",
  "status": "RESOLVED",
  "authorityRef": "ADR-004 section 3",
  "effect": "The server-validated identity takes precedence."
}
```

Allowed statuses:

- `RESOLVED`: the work order cites the authority and states its concrete effect;
- `DEFERRED_LIVE`: the decision applies only to separately tracked live acceptance and must include `deferredAcceptanceId` naming that row.

There is no `UNRESOLVED` or `NO_WITNESS` decision status. A genuinely missing decision is a blocker, not a test and not an item in the progress denominator.

### Decision-recovery process

Before delivery starts:

1. Search existing decision records, handoffs, architecture rulings, and owner instructions.
2. Cite the exact durable authority.
3. State the decision's concrete effect on this ticket.
4. Classify deployment-only values under deferred live acceptance.
5. If authority is genuinely absent, put the ticket in `BLOCKED` with one exact condition and owner.
6. Consolidate missing authority into one review packet instead of interrupting implementation ticket by ticket.

## Deferred live acceptance

Local engineering completion and final acceptance are distinct facts.

```json
{
  "id": "LIVE1",
  "description": "Run the released flow through both deployed hosts.",
  "owner": "deployment owner",
  "proof": "A release-stamped walkthrough records both results."
}
```

A valid receipt lists every deferred item as:

- `PENDING`: the ticket is `DONE_LOCAL`; or
- `PASS`: the deferred proof exists.

A ticket with no pending deferred rows is `DONE_FINAL`. The program status reports local and final completion separately.

This avoids two opposite errors:

- hiding completed local engineering because deployment was intentionally batched; and
- claiming production/customer completion from local tests alone.

## Receipts

A receipt is the only way a ticket becomes done.

Generate a template:

```bash
node ./bin/closure-ledger.mjs receipt-template W19 \
  --program /path/to/program.json \
  --out /path/to/receipts/W19.json
```

The template contains the current work-order hash and exact commands, but intentionally contains `REPLACE_WITH` markers. It is invalid until exact evidence replaces them.

A completed receipt contains:

```json
{
  "schemaVersion": 1,
  "kind": "DELIVERY",
  "ticketId": "W19",
  "workOrderHash": "sha256:...",
  "artifact": {
    "revision": "exact artifact revision",
    "repository": "repository or artifact identity"
  },
  "implementation": {
    "actor": "implementer identity",
    "evidence": ["evidence/W19/implementation.json"]
  },
  "acceptance": {
    "command": "the frozen ticket command",
    "result": "PASS",
    "evidence": ["evidence/W19/acceptance.tap"]
  },
  "integration": {
    "command": "the frozen program integration command",
    "result": "PASS",
    "evidence": ["evidence/W19/integration.tap"]
  },
  "verification": {
    "verdict": "PASS",
    "verifier": "independent verifier identity",
    "evidence": ["evidence/W19/verification.json"]
  },
  "completedAt": "2026-09-20T16:00:00.000Z",
  "deferredLiveAcceptance": []
}
```

The implementation actor and verifier must differ. Evidence strings are references; the toolkit does not copy evidence or secrets into the ledger.

The implementation actor must also differ from the ticket's specifier and specification reviewer. The final verifier must match the reviewer frozen in `specificationGate`; this prevents the builder from substituting a friendly or self-reviewing judge after implementation.

### Receipt kinds

| Kind | Use |
|---|---|
| `DELIVERY` | Work completed under Closure Ledger. Strict order applies. |
| `ADOPTION` | Pre-existing completed work reconciled into the new system. The ticket must be explicitly listed in `grandfatheredDoneTicketIds`. |

Grandfathering is narrow:

- it allows an adoption receipt to preserve historical completion out of order;
- it does not mark a ticket done;
- it does not waive receipt validation;
- it does not authorize new out-of-order delivery; and
- it changes the applicable work-order hashes because it is part of the program contract.

## Work-order hashes

Run:

```bash
node ./bin/closure-ledger.mjs hash W19 --program /path/to/program.json
```

The SHA-256 hash covers:

- schema version;
- program identity;
- frozen ticket denominator and order;
- active-work limit;
- completion policy;
- integration command;
- sequence policy; and
- every ticket closure-contract field except mutable routing `state`.

It deliberately excludes other tickets' content. Editing W20 does not invalidate W19, but changing the denominator, execution law, global gate, or W19 contract does.

Routing state is excluded because advancing `ACTIVE` from one ticket to the next is scheduling, not a change to accepted scope. Changing authority, outcome, criteria, evidence inventory, remaining work, decisions, deferred acceptance, write boundaries, commands, the specification gate, completion conditions, or blockers still invalidates the receipt.

If a work order changes after a receipt is written, that receipt becomes invalid automatically.

## Commands

### `init`

Safely creates a new draft. It refuses to write into a non-empty directory.

```bash
closure-ledger init \
  --dir ./delivery-control \
  --ids W16-W41 \
  --program-id remediation \
  --title "Remediation Program"
```

Ticket expressions support:

- `W16-W41`
- `T01-26`
- `A1,B2,C3`

Descending ranges, mixed prefixes, duplicates, and ranges larger than 1,000 entries are refused.

### `check`

Validates the program alone:

```bash
closure-ledger check --program ./program.json
```

Validate the program, receipts, and ordering:

```bash
closure-ledger check \
  --program ./program.json \
  --receipts ./receipts
```

Machine-readable output:

```bash
closure-ledger check --program ./program.json --json
```

### `status`

```bash
closure-ledger status --program ./program.json
```

When `--receipts` is omitted, the default is the `receipts/` directory beside `program.json`.

Example output:

```text
Program: Personalization Remediation W16-W41 (personalization-remediation)
Local done: 4/26
Final accepted: 1/26
Deferred live pending: 12 ticket(s)
Next: W19 [RECONCILE]

Ticket  State                 Live pending  Artifact
W16     DONE_LOCAL            1             8aa71c2
W17     DONE_FINAL            0             c19fe32
W19     RECONCILE             1             —
```

No criterion count, test count, commit count, percent, or estimated duration appears.

### `next`

```bash
closure-ledger next --program ./program.json
```

This prints the first ticket not locally done. A blocked ticket is printed with `do not skip`; the tool does not advance to a later ticket.

### `render`

```bash
closure-ledger render W19 --program ./program.json
```

This renders a complete, hash-pinned Markdown work order to stdout. Redirect it to a temporary handoff location if needed. The canonical source remains `program.json`.

The rendered document is a work order, not an agent prompt. Agent behavior and tool permissions remain owned by the surrounding platform and coordinator.

### `receipt-template`

```bash
closure-ledger receipt-template W19 \
  --program ./program.json \
  --kind DELIVERY \
  --out ./receipts/W19.json
```

The command uses exclusive creation and refuses to overwrite an existing receipt.

## Operating workflow

### Starting a new program

1. Establish the authoritative ticket list.
2. Run `init` with the complete list.
3. Fill every work order from the authoritative requirements.
4. Recover and cite decisions.
5. Separate deferred live acceptance.
6. Make every acceptance criterion finite and observable.
7. Have the specifier create the acceptance test and negative control.
8. Have the designated reviewer judge that specification and record its exact revision and evidence.
9. Set the exact write boundary and commands.
10. Run `check` until it passes.
11. Freeze the program through the repository's authorized change process.
12. Render and assign only the next ticket.

### Adopting an existing program

1. Preserve the old tracking system as history; do not rewrite it.
2. Define the fixed owner-visible denominator.
3. Create the new work orders without importing old sub-unit scores.
4. Classify current tickets as `RECONCILE`, `BUILT_PENDING_VERIFY`, `PARTIAL`, or `NOT_STARTED`.
5. List historically completed tickets under `grandfatheredDoneTicketIds` only after identifying their evidence.
6. Reconcile each candidate against its frozen whole-ticket contract.
7. Create an `ADOPTION` receipt only when the complete contract is proven.
8. If proof is incomplete, keep the ticket open and put the finite delta in `remainingWork`.
9. Use `next` to resume at the first unfinished ticket.

Existing test suites may remain as evidence. They do not become the new backlog and their assertion count is not reported as progress.

### Delivering one ticket

1. Confirm `check` passes.
2. Confirm `next` names the intended ticket.
3. Render that ticket's work order.
4. Confirm the specification gate is already `PASS`; product work must not begin before that review.
5. Give the implementer only the work order and necessary source references.
6. Keep every other ticket inactive.
7. Run the frozen ticket acceptance command.
8. Run the integration gate once at the same artifact revision.
9. Have the reviewer named by the specification gate judge that revision.
10. Generate and complete the receipt.
11. Run `check --receipts` and `status`.
12. After the receipt validates, change the completed ticket's routing state to `INACTIVE` and the reported next ticket to `ACTIVE`.
13. Run `check --receipts` again, then assign the next ticket.

If verification fails, return a finite defect list to the same ticket. Do not create new scored units.

## Role boundaries

Closure Ledger separates contract authority from four operating roles, regardless of the model or platform used:

| Responsibility | May do | Must not do |
|---|---|---|
| Contract authority | Freeze ticket scope, decisions, boundaries, and commands. | Implement the product or silently narrow the original requirement. |
| Lead | Select the next ticket, render its work order, coordinate actors, report derived status. | Add stages, invent tests, implement, verify, or manually mark completion. |
| Specifier | Create the acceptance test and negative control from the frozen criteria, then record the exact test revision. | Edit product code, weaken a criterion, or implement the solution. |
| Implementer | Change only authorized product paths and produce implementation/acceptance evidence. | Act as specifier or reviewer, edit the frozen contract/tests, expand scope, or verify its own delivery. |
| Reviewer | Judge the specification before build, then judge the exact delivered artifact and record one verdict. | Edit tests or product files, alter criteria, or substitute a new requirement. |

These are responsibility boundaries, not prompt templates. The coordinator remains responsible for platform-specific agent instructions.

## Scope changes and discoveries

Use this decision rule:

1. If the discovery is required by an existing acceptance clause, it stays inside the active ticket.
2. If it proves a completed ticket no longer satisfies its frozen clause, that ticket is reopened by invalidating or superseding its receipt through the authorized process.
3. If it is unrelated to every frozen ticket, it is outside the program unless the owner explicitly changes the denominator.
4. A contract amendment changes the work-order hash, invalidating any earlier receipt for that ticket.

Do not create a new scored unit merely because implementation exposed another internal step.

## Blockers

A blocked ticket must identify:

- a stable blocker ID;
- blocker kind;
- exact condition that must change;
- the owner of that condition; and
- evidence that the condition currently exists.

Example:

```json
{
  "id": "B1",
  "kind": "EXTERNAL_AUTHORITY",
  "condition": "The approved retention duration is absent from the ratified policy record.",
  "owner": "privacy owner",
  "evidence": "decision-census-2026-09-20.json section 4"
}
```

The next-ticket command stops on this ticket. It does not select later work to keep agents busy.

## CI integration

A minimal CI job needs only Node.js:

```yaml
- name: Validate closure program
  run: >-
    node tools/closure-ledger/bin/closure-ledger.mjs check
    --program path/to/program.json
    --receipts path/to/receipts

- name: Publish closure status
  run: >-
    node tools/closure-ledger/bin/closure-ledger.mjs status
    --program path/to/program.json
    --receipts path/to/receipts
    --json
```

Recommended protections:

- require `check` before merging program or receipt changes;
- protect the authoritative requirement source;
- require coordinator approval for denominator or sequence-policy changes;
- require verifier ownership for receipt changes;
- retain acceptance and integration logs outside the receipt; and
- publish `status --json` as the only program-progress feed.

Closure Ledger does not perform the merge and does not grant Git authority.

## Sharing the method with other agents

The directory is self-contained and has no runtime dependencies. Copy it or pin it as a repository dependency, run `npm test` inside it, and invoke `bin/closure-ledger.mjs` with Node 20 or newer. The package exports the core API from `src/core.mjs` for integrations and exposes `closure-ledger` as its command-line binary.

Give a new engineering-agent team `BOOTSTRAP-MEMO.md` first. It is the concise operating handoff; this README remains the normative schema and command reference.

To reuse the method in another project, provide only:

1. this toolkit directory or a pinned package revision;
2. the validated `program.json`;
3. the output of `render` for the current ticket;
4. the authoritative source files named by that ticket; and
5. the existing evidence named by that ticket.

Do not give a delivery agent the entire historical lane log, every old handoff, or an editable progress score unless the active work order expressly requires it. Historical material remains available to the contract authority for reconciliation.

Agents should report facts that can populate a receipt:

- exact artifact revision;
- changed paths;
- acceptance command and evidence reference;
- integration command and evidence reference;
- unresolved defect, if any; and
- deferred live-acceptance evidence, if performed.

An agent's narrative claim of completion never changes status. Only a valid receipt does.

## Security and evidence hygiene

- Keep credentials, customer records, and secret-bearing command output out of `program.json` and receipts.
- Reference protected evidence by stable identifier or safe path rather than embedding it.
- Do not place connection strings or environment dumps in acceptance commands.
- A receipt proves the declared workflow completed; it is not a signature or identity system.
- Protect receipt write access through the repository or CI controls appropriate to the project.
- If cryptographic actor signatures are required, add them outside this version of the schema and increment `schemaVersion` before treating them as authoritative.

## Failure behavior

The toolkit fails closed when:

- JSON is malformed;
- unknown fields appear;
- the denominator and ticket list differ;
- ticket order differs from `ticketIds`;
- more than one ticket is active;
- ambiguous executable language is present;
- a decision or deferred reference is missing;
- a specification gate lacks independent review or negative-control evidence;
- a read-only assignment grants write paths;
- a blocker is unnamed;
- a receipt hash is stale;
- recorded commands differ from frozen commands;
- an acceptance, integration, or verification result is not `PASS`;
- the implementer and verifier are the same actor;
- the implementer is the specifier/reviewer, or the final verifier is not the designated specification reviewer;
- deferred rows are missing or reordered;
- a normal delivery receipt closes work out of sequence; or
- an adoption receipt is not explicitly grandfathered.

The CLI returns a non-zero exit code for these conditions.

## Troubleshooting

### `program is invalid; run check before rendering`

Run:

```bash
closure-ledger check --program ./program.json
```

Correct every reported field. Rendering an ambiguous ticket is deliberately prohibited.

### `workOrderHash does not match`

The ticket or a program-level contract field changed after the receipt template was generated. Re-evaluate the ticket under the amended contract and generate a new receipt template. Do not copy the new hash into an old receipt without rerunning proof.

### `closes out of order`

A later `DELIVERY` receipt exists while an earlier ticket remains unfinished. Remove the invalid later receipt from the authoritative receipt set or complete the earlier ticket. For genuinely pre-existing completion, use the explicit adoption process.

### `ADOPTION is allowed only for a ticket explicitly grandfathered`

Add the ticket to `grandfatheredDoneTicketIds` only through the program's authorized contract-change process, then regenerate its receipt template. Adding it changes the work-order hash.

### `ACTIVE but the next unfinished ticket is ...`

The authored operational state does not match derived sequence state. Only the first unfinished ticket may be active.

### A draft created by `init` fails validation

That is expected. Replace every `TBD` value with an exact contract. `init` creates structure, not authority.

## Anti-patterns

Do not:

- add an assertion count to the status line;
- create one ticket per acceptance criterion;
- add an unresolved decision as a criterion that can never pass;
- write `DONE` into `program.json`;
- issue a receipt before the exact artifact exists;
- change a work order and preserve its old receipt;
- use `ADOPTION` for new work;
- mark live acceptance `PASS` without its evidence;
- put several active tickets in separate worktrees;
- insert broad phrases such as “handle edge cases” without enumerating the observable cases;
- treat documentation volume as completion evidence; or
- allow a lead to add review stages after the contract is frozen.

## Testing the toolkit

```bash
cd tools/closure-ledger
npm test
```

The tests cover:

- denominator preservation;
- placeholder rejection;
- receipt-derived completion;
- pre-build specification review and role separation;
- separate local and final status;
- work-order hash invalidation;
- routing-state advancement without receipt invalidation;
- implementer/verifier separation;
- strict delivery order;
- grandfathered adoption;
- rejection of delivery-order bypass on grandfathered tickets;
- deferred-decision linkage;
- strict receipt timestamps and receipt kinds;
- invalid receipt templates;
- work-order rendering;
- ticket range parsing; and
- CLI behavior.

## Versioning

`schemaVersion` is currently `1`.

Increment it for incompatible changes to:

- program or ticket semantics;
- receipt closure requirements;
- hash inputs;
- sequence rules; or
- status derivation.

Do not silently reinterpret an existing schema version. Programs and receipts should be pinned to a known toolkit revision when used across repositories.

## Current limitations

- Evidence references are not dereferenced or hashed by this version.
- Actor identities are strings, not signed identities.
- Commands are recorded and compared but not executed by the CLI.
- There is no remote service or database; files are the source of truth.
- Contract authority remains organizational. The tool cannot determine whether a human decision was validly authorized.

Those limits are deliberate. The first version stays small enough to audit and portable enough to share with other agents and repositories.
