# Remediation execution instructions

These instructions govern the content/personalization remediation programme W16–W41 of [document 35](docs/architecture/35-audit-verification-and-source-of-truth.md) §5. They do not authorize unrelated changes or external operations.

The user's latest explicit instructions take precedence. On 2026-09-23 the owner adopted the Closure Ledger for W16–W41 and moved the remediation onto its own integration branch. The law for execution is [tools/closure-ledger/BOOTSTRAP-MEMO.md](tools/closure-ledger/BOOTSTRAP-MEMO.md), with [tools/closure-ledger/README.md](tools/closure-ledger/README.md) as its normative reference. It replaces `docs/remediation/METHOD.md`. That file, `LANE-LOG.md`, `units.json`, `SCORE.md`, `reviews/`, the old tracker and the handoffs are frozen history: never edited, never used to count progress. Document 35's full original requirements are preserved.

## Where the work lives

- Integration branch `rem/integration`, checkout `/home/simonecoelho/rem/integration`. The lead edits governance files, files receipts and merges only there.
- The working tree at `/mnt/c/users/lah/documents/__development/optimizely/__cloudflare_base` and the branch `feature/real-time-personalization` carry another team's demo work since 2026-09-23 (`82f41b8`). Never commit, stage, clean or merge there.
- The ledger is `docs/remediation/delivery-control/program.json` with its `receipts/`, driven by `node tools/closure-ledger/bin/closure-ledger.mjs check | status | next | render | receipt-template`.

## The programme

- The denominator is exactly 26 tickets, W16–W41, delivered in order and in full original scope; each work order quotes its document 35 row verbatim. W01–W15 keep their frozen dispositions; a regression in their area stays inside the ticket whose acceptance requires it. Never silently reduce scope or skip a blocked ticket.
- One ticket is ACTIVE at a time, the one `next` names. A blocked ticket records its exact condition and owner, and `next` stays on it.
- A ticket is done only by a valid receipt: acceptance, integration and reviewer PASS at one artifact revision. Every report opens with `Local engineering done: x/26` and `Final/live accepted: y/26` from `status`, then the current ticket, blocker and next action. Tests, commits, reviews and documents are evidence, never progress. Never invent an ETA, a live acceptance or a completed feature.
- A local receipt is not customer or deployed-runtime acceptance. W36 does not close F14; gamma zero is not a learning-ingestion kill switch.
- The owner is the contract authority. The lead drafts the work orders; the owner freezes them. The denominator, criteria, decisions, commands and write boundaries change only with the owner's approval, and a change invalidates that ticket's receipt.
- Owner decisions are cited from the records or the as-built state and confirmed by the owner once, in the freeze review: never asked piecemeal, never invented. Production and customer values are deferred live acceptance rows, not blockers to local work. The settled decisions in [HANDOFF-2026-09-18](docs/handover/HANDOFF-2026-09-18.md) §7 are not reopened.
- The integration gate keeps the ratchet: `docs/remediation/baseline-failures.json` (79 tests) stays live and changes only with the owner's approval. Checks are the ticket's acceptance command and the integration command, once each at one artifact; broaden only for a concrete defect.
- Standing mandate (2026-09-16): local implementation W16–W41 in order; live acceptance batched at the end. It does not authorize deployment, cloud or resource mutation, credential operations, customer-data operations or live acceptance without evidence.
- Push, pull request and merge to any remote are not granted. A ticket stops at a local receipt.

## Roles

- Agents are the project roles in `.claude/agents/`: `rem-specifier`, `rem-implementer`, `rem-reviewer`, on Claude Opus at xhigh effort; Fable 5.1 is the escalation model for a ticket whose second build fails. Never silently fall back to a weaker model or effort.
- Specifier: one acceptance test and one negative control per ticket, from the frozen criteria. Never product code.
- Reviewer: judges the specification before any build and the exact artifact after it; the same reviewer identity gives the receipt verdict. Edits nothing.
- Implementer: changes only the work order's `allowedPaths`, never the reviewed test, and never judges its own work.
- Lead: runs `check`, `status`, `next` and `render`, assigns only the next ticket, files receipts from the reviewer's verdict and the recorded evidence, merges and reports. Never implements, specifies or reviews; never adds stages, scored subtasks or progress logs.
- One writer per checkout. Agents work in their own checkouts under `/home/simonecoelho/rem/`, never in the integration checkout, read only what their work order names, and do not delegate further.

## Authority and safety

Deployment, cloud/resource mutation, credential rotation, destructive cleanup, customer-data operations, external messages and customer-scope amendments require their own applicable authority. Agents cannot approve a customer, privacy or business decision among themselves.

Preserve pre-existing worktree material. The owner's settings deny `git checkout`, `git reset` and `git stash`; agents also never use `git restore`, `git switch`, `git rm`, `rm -rf`, installs or process kills. Never invoke provisioning, deploy or seed scripts to make a check green. Keep credentials and customer records out of evidence. `docs/Tapestry-BTIE-Working-Notes.md` and `docs/BTI-Parity-and-Mechanism.*` are the owner's internal documents: never quote them into evidence or send them anywhere.

## Durable handoff

A new lead starts from this file, the memo, and `check`, `status` and `next`, not from chat or old logs. `docs/remediation/RESUME.md` stays a few lines. No other tracker, log or documentation programme.
