# Remediation execution instructions

These instructions govern two Closure Ledger programmes on this branch: the content/personalization remediation programme W16–W41 of [document 35](docs/architecture/35-audit-verification-and-source-of-truth.md) §5, and since the owner's freeze of 2026-10-08 the parity programme `tapestry-parity-build` (25 tickets). They do not authorize unrelated changes or external operations.

The user's latest explicit instructions take precedence. On 2026-09-23 the owner adopted the Closure Ledger for W16–W41 and moved the remediation onto its own integration branch. The law for execution is [tools/closure-ledger/BOOTSTRAP-MEMO.md](tools/closure-ledger/BOOTSTRAP-MEMO.md), with [tools/closure-ledger/README.md](tools/closure-ledger/README.md) as its normative reference. It replaces `docs/remediation/METHOD.md`. That file, `LANE-LOG.md`, `units.json`, `SCORE.md`, `reviews/`, the old tracker and the handoffs are frozen history: never edited, never used to count progress. Document 35's full original requirements are preserved.

## Where the work lives

- Integration branch `rem/integration`, checkout `/home/simonecoelho/rem/integration`. The lead edits governance files, files receipts and merges only there.
- The working tree at `/mnt/c/users/lah/documents/__development/optimizely/__cloudflare_base` and the branch `feature/real-time-personalization` carry another team's demo work since 2026-09-23 (`82f41b8`). Never commit, stage, clean or merge there.
- The remediation ledger is `docs/remediation/delivery-control/program.json` with its `receipts/`; the parity ledger is `docs/parity/delivery-control/program.json` with its `receipts/`. Both are driven by `node tools/closure-ledger/bin/closure-ledger.mjs check | status | next | render | receipt-template --program <that program.json>`.
- The parity programme's quoted authority is the frozen copy under `docs/parity/authority/`: the ticket file, the freeze sheet with the owner's answers, and sections G and H of the kickoff investigation. The parity document itself is cited by section number only.

## The programmes

- The remediation denominator is exactly 26 tickets, W16–W41, delivered in order and in full original scope; each work order quotes its document 35 row verbatim. W01–W15 keep their frozen dispositions; a regression in their area stays inside the ticket whose acceptance requires it, and a regression in a closed ticket's area becomes a new criterion of that ticket, closed by a superseding receipt (the W22 R10 correction and W27 R5 are the precedents). Never silently reduce scope or skip a blocked ticket.
- The parity denominator is exactly 25 tickets in the order of work of the frozen ticket file (P02, P01, P28, P03, P10, P07, P04, P29, P31, P05, P06, P12, P13, P34, P30, P33, P32, P09, P11, P14, P35, P08, P15, P16, P26); the vector tickets P17–P25 and P27 wait for a second programme; P36 is out. Each work order quotes its ticket's Done-when text verbatim.
- One ticket is ACTIVE at a time per programme, the one `next` names; the lead merges one artifact at a time into this branch. A blocked ticket records its exact condition and owner, and `next` stays on it.
- A ticket is done only by a valid receipt: acceptance, integration and reviewer PASS at one artifact revision. Every report opens with the two score lines from `status`: `Local engineering done: x/26 · Final/live accepted: y/26` and `Parity local: a/25 · Parity final: b/25`, then the current ticket, blocker and next action. Tests, commits, reviews and documents are evidence, never progress. Never invent an ETA, a live acceptance or a completed feature.
- A local receipt is not customer or deployed-runtime acceptance. W36 does not close F14; gamma zero is not a learning-ingestion kill switch; a green parity unit is not the customer's front end drawing the modules.
- The owner is the contract authority. The lead drafts the work orders; the owner freezes them. The denominator, criteria, decisions, commands and write boundaries change only with the owner's approval, and a change invalidates that ticket's receipt. The lead's pre-freeze rulings for the parity programme (R-P1 onward) are recorded in `/home/simonecoelho/rem/_evidence/parity-step3/AMENDMENTS.md` and confirmed by the owner at the freeze.
- Owner decisions are cited from the records or the as-built state and confirmed by the owner once, in the freeze review: never asked piecemeal, never invented. Production and customer values are deferred live acceptance rows, not blockers to local work. The settled decisions in [HANDOFF-2026-09-18](docs/handover/HANDOFF-2026-09-18.md) §7 are not reopened.
- The integration gate keeps the ratchet for both programmes: `docs/remediation/baseline-failures.json` stays live and changes only with the owner's approval. Checks are the ticket's acceptance command and the integration command, once each at one artifact; broaden only for a concrete defect.
- Standing mandate (2026-09-16, extended to the parity programme at the freeze): local implementation in order; live acceptance batched at the end. It does not authorize deployment, cloud or resource mutation, credential operations, customer-data operations or live acceptance without evidence.
- Push, pull request and merge to any remote are not granted. A ticket stops at a local receipt.

## Roles

- Agents are the project roles in `.claude/agents/`: `rem-specifier`, `rem-implementer`, `rem-reviewer`, on Claude Opus, builders and specifiers at high effort and reviewers at xhigh (owner delegation 2026-10-29: the lead sets the levels); a build that fails its delivery review once is rebuilt at xhigh; No subagent ever runs on Fable 5.1 (owner rule 2026-10-30: its token cost is not justified by results); a ticket whose second build fails its review gets a design note from its Opus builder, ruled by the lead, before any further code. Never silently fall back to a weaker model or effort.
- Specifier: the RED acceptance tests and negative controls of a ticket, from the frozen criteria; in the parity programme a batch specification branch holds one commit per ticket and the lead cuts per-ticket branches by plumbing. Never product code.
- Reviewer: judges the specification before any build and the exact artifact after it; the same reviewer identity gives the receipt verdict. Edits nothing.
- Implementer: changes only the work order's `allowedPaths`, never the reviewed test, and never judges its own work.
- Lead: runs `check`, `status`, `next` and `render`, assigns only the next ticket, files receipts from the reviewer's verdict and the recorded evidence, merges and reports. Never implements, specifies or reviews; never adds stages, scored subtasks or progress logs.
- One writer per checkout. Agents work in their own checkouts under `/home/simonecoelho/rem/`, never in the integration checkout, read only what their work order names, and do not delegate further.

## Authority and safety

Deployment, cloud/resource mutation, credential rotation, destructive cleanup, customer-data operations, external messages and customer-scope amendments require their own applicable authority. Agents cannot approve a customer, privacy or business decision among themselves.

Preserve pre-existing worktree material. The owner's settings deny `git checkout`, `git reset` and `git stash`; agents also never use `git restore`, `git switch`, `git rm`, `rm -rf`, installs or process kills. Never prune worktrees from either side. Never invoke provisioning, deploy or seed scripts to make a check green. Keep credentials and customer records out of evidence. `docs/Tapestry-BTIE-Working-Notes.md` and `docs/BTI-Parity-and-Mechanism.*` are the owner's internal documents: never quote them into evidence or send them anywhere.

## Durable handoff

A new lead starts from this file, the memo, and `check`, `status` and `next` on both programmes, not from chat or old logs. `docs/remediation/RESUME.md` stays a few lines. No other tracker, log or documentation programme.

---

# Demo operations

**Not part of the remediation programme above.** These are operating rules for the hosted demos; they authorize
nothing in document 35 and nothing above authorizes them.

## The two demo workers — read this before any deploy

There are **two** demo workers, because no single version of the code can run every demo.

| Worker | URL | Runs | Deploy with |
|---|---|---|---|
| `edge-platform` (shared) | `edge-platform.expedge.workers.dev` | Coach storefront, Bright Hour `/live`, Meridian `/meridian`, the bank demo — on commit `26e2db1`, exactly as they were built and rehearsed | `bash scripts/deploy-legacy-demos.sh --deploy` **and nothing else** |
| `edge-platform-top-offers` | `edge-platform-top-offers.expedge.workers.dev` | the QVC Top Offers demo `/top-offers` — on today's engine | `node scripts/build-top-offers-config.mjs && npx wrangler deploy --config wrangler.top-offers.toml` (the builder delegates to `scripts/build-demo-worker-config.mjs`, which also renames the recovery queues; a config whose `LEDGER_RECOVERY_CONFIG` still names the shared `events` queue leaves that worker's ledger unconsumed and its day report empty, as it was from 2026-09-23 to 2026-09-30) |
| `edge-platform-vantage` | `edge-platform-vantage.expedge.workers.dev` | the Verizon demo `/vantage` — on today's engine, session host | `node scripts/build-demo-worker-config.mjs --name edge-platform-vantage --queue events-vantage --dev-port 9110 && npx wrangler deploy --config wrangler.vantage.toml`, from WSL; after a reseed, redeploy, then `scripts/seed-vantage-region.mjs`; see `docs/verizon/RESUME-vantage.md` |
| `edge-platform-oh` | `edge-platform-oh.expedge.workers.dev` | the LG demo OH `/oh` — on today's engine and the demo kit, session host | `node scripts/demo-kit/host.mjs --config oh --from secrets --confirm edge-platform-oh` from WSL (one command: secrets, database check, deploy from a clean worktree, crons, the hosted seed then the redeploy it requires, the region seed, the hosted suites); never plain `npx wrangler deploy`; see `docs/oh/RESUME-oh.md` |
| `edge-platform-bti` | `edge-platform-bti.expedge.workers.dev` | the internal enablement site for Optimizely staff (Behavioral Targeting and Intelligence), a static site behind a passphrase gate in the worker (`enablement/worker.mjs`); no engine code, no bindings but assets; the passphrase and cookie secret live only in the worker and the owner’s `.dev.vars` | `node enablement/check-site.mjs && npx wrangler deploy --config wrangler.enablement.toml`, from WSL and from a clean worktree of the commit; see `docs/enablement/BTI-Enablement-Design.md` §7. The earlier worker `edge-platform-enablement` sits behind a Cloudflare Access sign-in whose emailed codes never arrived and is not deployed to |

**Never run plain `npx wrangler deploy` from the repo root.** `wrangler.toml` names the shared worker, so it
ships today's code onto it, and today's code cannot run the older demos: it requires a shopper session on every
shopper call, which the Coach storefront and Bright Hour never create, and under `AUTH_MODE=enforced` it
deliberately answers 404 for `/meridian/api`, `/live/api`, `/geo/cohort`, `/ai`, `/agents`, `/experiment`,
`/signals` and `/funnel`. That is precisely how all three broke on 2026-09-23 and stayed broken for a week.

**Verify a deploy through the APIs, never the pages.** Every page returned 200 throughout that week; the APIs
behind them returned 404 and 403. After a shared-worker deploy, run
`MERIDIAN_BASE=https://edge-platform.expedge.workers.dev node scripts/meridian-rehearsal.mjs` and
`node scripts/meridian-isolation.mjs` (which exercises Coach's pipeline). After a Top Offers deploy, run both
`scripts/rehearse-top-offers-*.mjs` with `--base https://edge-platform-top-offers.expedge.workers.dev`.

**Do not change a demo worker's settings or secrets without the owner.** Adding `TENANTS` to the shared worker
removed its implicit `coach` tenant and cut Coach off even from basic calls. Staging and production are
`DEPLOYMENT_PROFILE=customer` and are never demo targets; `npm run deploy staging|production` is the guarded
customer-stamp workflow and is a different thing entirely.

## A reseed must be followed by a deploy

`scripts/seed-shn.mjs` (and any seed shaped like it) **re-anchors every content window to now and rewrites the
beat documents under `public/`**. The worker reads those documents from its own `ASSETS` binding when it applies
a beat. So after seeding the Top Offers worker, redeploy it:

```bash
node scripts/seed-shn.mjs --base https://edge-platform-top-offers.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.top-offers.toml
```

Skip the deploy and the served assets drift from what was published: a beat then applies a *different* document
than the one that was seeded, and the demo misbehaves in a way that looks like an engine fault. Seeding a hosted
demo is two steps, never one. Before any deploy, `npm run check:generated` must pass: `npm run dev` rebuilds the
Meridian and SDK bundles, but a deploy does not.

## No demo page carries a credential

`public/` is served wholesale (`wrangler.toml [assets]`), so a token written into a static directory is a
credential anyone with the URL can fetch. A demo page names an action and the worker performs it
(`src/routes/topOffers.ts` is the pattern): mounted only where `DEPLOYMENT_PROFILE` is `demo`, accepting a
closed set of names and no caller-supplied document, minting genuine short-lived operator authority and
re-entering the ordinary route pipeline. Never hand the configuration store a permissive `authorize` to skip
that — it is shorter and it is a hole in the authority model.

A demo page must send `X-Tenant` on its own API calls. Without it the app-level tenant middleware falls back to
the default tenant, which a single-tenant demo worker does not provision, and every call fails with "Tenant
unavailable" before reaching the handler. This passes locally whenever the local registry happens to contain the
default tenant, so it surfaces only once deployed.
