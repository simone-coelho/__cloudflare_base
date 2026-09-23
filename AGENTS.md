# Remediation execution instructions

These instructions govern work on the content/personalization remediation programme in document 35. They do not authorize unrelated changes or external operations.

The user's latest explicit instructions take precedence. On 2026-09-18 the user transferred the lead to a Claude session and ordered the delegated-agent method that succeeded on another codebase. That method is written in [docs/remediation/METHOD.md](docs/remediation/METHOD.md) and is the law for execution. Where older execution documents (document 36, the frozen tracker, older handoffs, earlier versions of this file) conflict with METHOD.md, METHOD.md applies while document 35's full original W01–W41 requirements are preserved.

## Standing execution agreement — 2026-09-18 (method takeover)

- The lead delegates all product implementation, test writing and review to agents. The lead never implements, never writes tests, never reviews. The lead names batches, writes briefs, sequences checkouts, validates by re-running the score on the exact commit, keeps `docs/remediation/LANE-LOG.md` and writes every process lesson into `.claude/agents/rem-*.md` the same hour.
- Complete the original W16–W41 items in order and full scope, preserving existing fixes. W01–W15 keep their retained local dispositions in the frozen records; a regression found in their area becomes a unit under the owning W. Do not silently reduce scope, skip a blocked item, or treat a completed unit as a completed W item. Surface the exact blocker and the required owner decision.
- The unit of work, the definition of done, the score, the ratchet, the batch loop and the gate are defined in METHOD.md §3–§7. Progress is the derived score line, never a count typed by anyone.
- Standing user mandate (2026-09-16, reused without asking again): continue local implementation W16–W41 in order after each item's independent review; batch live acceptance at the end. It does not authorize deployment, cloud/resource mutation, credential operations, customer-data operations or full acceptance without evidence.
- Commits on lane branches and the integration branch are part of the method. Push, pull request and auto-merge authority is recorded in LANE-LOG.md when the user grants it; until then a batch stops at "ready to push".
- Documentation is limited to METHOD.md, `units.json`, `SCORE.md`, `baseline-failures.json`, `reviews/<W>.json`, LANE-LOG.md and a short RESUME.md. No other tracker, framework or documentation programme.
- Use the smallest sufficient checks: the batch's units plus the gate. Broaden only for a concrete defect or a documented requirement, stating the reason.

## Read before remediation work

1. [docs/remediation/METHOD.md](docs/remediation/METHOD.md).
2. [docs/remediation/LANE-LOG.md](docs/remediation/LANE-LOG.md): rulings, lanes in flight, authority, baseline.
3. [Document 35](docs/architecture/35-audit-verification-and-source-of-truth.md) §5 for the active W item and its linked findings; [HANDOFF-2026-09-18](docs/handover/HANDOFF-2026-09-18.md) §5–§8 for the W16 detail, the W17–W41 starting map, settled decisions and open owner decisions.

The old board check (`scripts/remediation/board.mjs`) and the 27 MB tracker are frozen history and are not run or edited at bootstrap. Agents read only what their brief names.

## Agent policy and ownership

- Delegated agents are the three project roles in `.claude/agents/`: `rem-specifier`, `rem-implementer`, `rem-reviewer`, on Claude Opus at xhigh effort; Fable 5.1 is the escalation model for a unit whose second build fails. This replaces the earlier gpt-6-astra requirement (user direction 2026-09-18). Never silently fall back to a weaker model or effort.
- One writer per checkout, ever. The specifier owns `src/units/**` and `docs/remediation/units.json` for its batch; the implementer owns the product paths its brief grants; the reviewer owns nothing. The lead alone edits governance files, in the control checkout on `/mnt/c`.
- Builders and reviewers never run inside the control checkout. Subagents do not delegate further.

## Measure before, verify after

- The baseline at checkpoint `7b01c14` is recorded in LANE-LOG.md: 238 failing tests in 29 files, app typecheck green only with the no-composite flags. The gate ratchets from there; a batch never adds a failure and names what it did not fix.
- Every lead report starts with the derived score line. Documentation, test counts and tracker validity are not product progress. Never invent an ETA, a live acceptance or a completed feature.
- Unit completion, W item closure, finding closure, gate acceptance and release approval are different states. A green unit is not customer or deployed-runtime acceptance. W36 does not close F14; gamma zero is not a learning-ingestion kill switch.

## Authority and safety

Deployment, cloud/resource mutation, credential rotation, destructive cleanup, customer-data operations, external messages and customer-scope amendments require their own applicable authority. Agents cannot approve a customer, privacy or business decision by voting among themselves. The settled decisions in HANDOFF-2026-09-18 §7 are not reopened; the open owner decisions in §8 are not invented.

Preserve pre-existing worktree material. The owner's settings deny `git checkout`, `git reset` and `git stash`; agents also never use `git restore`, `git switch`, `git rm`, `rm -rf`, installs or process kills. Never invoke provisioning, deploy or seed scripts to make a check green. Keep credentials and customer records out of evidence.

## Durable handoff

The lead updates LANE-LOG.md whenever lanes, commits, rulings or authority change, and keeps RESUME.md to a few lines pointing at METHOD.md and LANE-LOG.md. A new lead starts from those two files and the score, not from chat recollection. Unresolved requirements and named residuals stay visible in LANE-LOG.md.

---

# Demo operations

**Not part of the remediation programme above.** These are operating rules for the hosted demos; they authorize
nothing in document 35 and nothing above authorizes them.

## The demo worker

Demo surfaces live on the DEFAULT wrangler environment — `edge-platform`, `ENVIRONMENT=development`,
`DEPLOYMENT_PROFILE=demo`, deployed with plain `npx wrangler deploy`. Staging and production are
`DEPLOYMENT_PROFILE=customer`: `/ops/demo-bootstrap` refuses there by design, the customer-stamp workflow
deliberately omits demo bindings and assets, and demo API roots are 404'd under `AUTH_MODE=enforced`. A demo
does not go there. `npm run deploy staging|production` is the guarded customer-stamp workflow and is a
different thing entirely.

## A reseed must be followed by a deploy

`scripts/seed-shn.mjs` (and any seed shaped like it) **re-anchors every content window to now and rewrites the
beat documents under `public/`**. The worker reads those documents from its own `ASSETS` binding when it applies
a beat. So after seeding a deployed demo, redeploy:

```bash
node scripts/seed-shn.mjs --base https://<worker> --token <operator token>
npx wrangler deploy
```

Skip the deploy and the served assets drift from what was published: a beat then applies a *different* document
than the one that was seeded, and the demo misbehaves in a way that looks like an engine fault. This is the
coupling to remember — seeding a hosted demo is two steps, never one.

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
