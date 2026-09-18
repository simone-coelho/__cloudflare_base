# Remediation method — the law for W16–W41

Owner-ordered 2026-09-18 at the lead takeover. This is the method that moved another codebase's score from 0 to 111 accepted units in a day, adapted to this repository. [Document 35](../architecture/35-audit-verification-and-source-of-truth.md) §5 still says **what** must be true for W01–W41; this document says **how** it is proven. Where `AGENTS.md`, document 36, the frozen tracker or older handoffs conflict with this method, this method applies. Document 35's scope is never reduced by it.

## 1. The idea in five sentences

1. Work is split into units. A unit is one requirement clause with ONE mechanical vitest test. Done means that test is green on the integration branch with the gate green.
2. The people are separate: a specifier writes the test, a different implementer makes it pass, a reviewer judges both. None of them shares a context window.
3. The lead names batches, writes briefs, sequences checkouts, validates only by re-running the score, and records every lesson. The lead never implements, never writes tests, never reviews.
4. The score is derived by code from the test results. Nobody types it. `score.mjs --check` refuses a hand-edited score.
5. Merging belongs to the pipeline: reviewer PASS, lead validation, the implementer arms auto-merge, the required checks merge. No human merges. Push and merge authority for this repository is recorded in `LANE-LOG.md`; until it is granted a batch stops at "ready to push".

## 2. The roles

| Role | Does | Never does | Model |
|---|---|---|---|
| **Lead** (the session owner's agent) | Names batches, writes briefs, sequences agents and checkouts, validates by re-running the score on the exact commit, reports to the owner, writes lessons into `.claude/agents/rem-*.md` | Writes code, writes tests, reviews, runs heavy tooling by hand inside an agent's checkout | Fable 5.1 |
| **Specifier** `rem-specifier` | Writes the RED unit tests and their `units.json` rows for a batch, from document 35, the customer requirements and the admitted criteria | Edits product code; weakens an assertion; asserts the current defect | Opus, xhigh |
| **Implementer** `rem-implementer` | Turns exactly the named units green with general, customer-neutral code, in its own checkout and branch; runs the gate; one push | Edits `src/units/**` or any test or fixture; pushes red; reviews itself; widens scope | Opus, xhigh; Fable on a unit's second failed build |
| **Reviewer** `rem-reviewer` | On the exact commit: reruns, judges test honesty and code generality, probes unseen inputs, runs negative controls, returns PASS/FAIL/INCOMPLETE per unit and a whole-W verdict when briefed; triages failures when briefed | Edits anything | Opus, xhigh |

Each role is a file under `.claude/agents/`. They are the institutional memory: every process defect becomes one sentence there the same hour.

## 3. The unit and the definition of done

- **ID**: `W16.C2.01` = W item, criterion (the W's admitted criteria or its document 35 clause), ordinal. Declared in `docs/remediation/units.json` with the lead's one-line ruled outcome and its witness.
- **Test**: in `src/units/<W>/<batch>.unit.test.ts`, one `describe('unit:W16.C2.01', …)` per unit with one `it` per leg. A unit is green when every test under that block passed and at least one ran.
- **Legs** (the ruled outcome names which apply):
  - `logic`: the exported function or module, with real inputs (actual customer taxonomy and event shapes where document 35 requires them).
  - `host`: the real mounted app or Durable Object class in process, through the path production runs (`src/index.ts`, `ShopperReflex`, `SessionManager`). "Both hosts" means both paths, as `src/routes/realtime.sdkContract.test.ts` does.
  - `native`: workerd via Miniflare with real local bindings, as `src/index.api-boundary.test.ts` does. The judge for DO, KV, D1, queue, alarm and socket state. It runs for real, locally, before any push.
  - `sdk`: jsdom through the real `src/sdk` entry and, when the outcome says shipped, the regenerated `public/sdk` bundle.
- **Witness rule**: expected values come from document 35 (§2–§5), `docs/architecture/tapestry_requirements.txt`, the admitted criteria and the settled decisions in `docs/handover/HANDOFF-2026-09-18.md` §7. Never from what the code currently returns, never from a wish. No witness means the row is `no-witness` and stays unclaimed. Nobody invents one.
- **RED for the right reason**: the failing assertion names the missing behavior. A test that asserts the current defect (`not.toBe`, `length === 0`, `toBeUndefined` for an outcome the name says is expected) blocks its own fix and is INVERTED.
- **Unit done**: green on the integration branch with the gate green.
- **W item closed**: every declared unit of the W is green, a reviewer whole-W verdict PASS at a named commit exists in `docs/remediation/reviews/<W>.json`, and residuals are named. Live and customer acceptance remain OPEN and are batched at the end (user decision 2026-09-16). W01–W15 keep their retained local dispositions in the frozen records and are not re-scored; a regression the suite finds in their area becomes a unit under that W.

## 4. The score and the ratchet

- `node scripts/remediation/score.mjs --from <vitest.json>` derives units green/declared per W, W items closed, suite passed/failed, and typecheck state, and writes `docs/remediation/SCORE.md`. `--check` re-derives and refuses a committed score that differs. CI runs both. Counts are never stored by hand anywhere.
- Every lead report begins with the score line, for example: `Units 0/9 · W closed 0/26 (W16–W41) · suite 1616/1854 · residual 238 in 29 files · typecheck RED`.
- **Baseline residual**: `docs/remediation/baseline-failures.json` lists the full names of the tests failing at the checkpoint commit, derived by the tool. Gate rule: no failing test outside that list, and the list only shrinks. A batch that fixes some regenerates it in the same change. Every entry is owed work with an owner W.
- `units.json` row: `{ "id", "w", "criterion", "outcome", "legs": [], "witness", "status": "declared" | "specified" | "no-witness", "batch" }`.

## 5. The loop for one batch

1. **Name** (lead): 5–20 units that share one rule family. The first batch of a new family stays small. One brief per role: checkout path, base commit, branch, units, ruled outcomes, sequence, time box, report fields, evidence directory.
2. **Specify** (specifier): RED tests and `units.json` rows on the spec branch, committed by path. No pull request.
3. **Specification pass** (reviewer): judges the tests alone. Each unit is HONEST, INVERTED, UNSATISFIABLE or FAÇADE, with the line. The specifier corrects. Nothing is built before this passes.
4. **Build** (implementer): forks the build branch from the spec head in its own checkout. If a unit cannot go green without editing its test, STOP and report the assertion; the lead sends it back to the specifier.
5. **Local review** (reviewer) on the implementer's local commit, before any push.
6. **One push**: merge the integration branch, regenerate generated files, run the full gate, push once, open the pull request unarmed. Needs the recorded push authority.
7. **Confirm** on the pushed commit (the diff from the reviewed commit is only the merge), quote CI's own lines, the lead re-runs the score, the implementer arms auto-merge.
8. The pipeline merges. The next pull request merges the integration branch and pushes once.

Keep every checkout busy: while one batch is in review, the next is building and the one after is being specified.

## 6. Rules that paid for themselves

- **Red for the right reason** (§3). The specification pass is mandatory because a specifier inverted fourteen tests in one batch elsewhere.
- **The real leg is the judge and runs locally.** Simulations of the last step passed while the real path threw. Here the real path is the mounted app, the DO class, Miniflare and the regenerated SDK bundle, never a helper called directly.
- **Test the path production runs.** Both hosts. The shipped bundle: when `src/sdk` changes, `node scripts/build-sdk.mjs` regenerates `public/sdk` and `--check` must be exact.
- **"The codebase has no X" is usually false.** Read `src/services`, `src/reflex`, `src/identity`, `src/content`, `src/learn`, `src/sdk` before declaring a gap. Reuse before writing.
- **Report and stop.** A wrong test, a permission lock, a red gate, an ungranted path: stop and name it. Never push red, never work around a guard, never `skip`/`todo`/`only`.
- **Negative control for every tool or check.** The reviewer breaks it in a scratch copy and confirms it fails. A check that cannot fail has no teeth.
- **Name residuals.** Anything not fixed is written in the report as owed work. Silence is the forbidden outcome.
- **Self-report rule breaches.**
- **Customer-neutral core.** No customer-specific constants, runtime model, fingerprinting or new infrastructure as an unapproved remedy (document 35 §6). Coach taxonomy lives in fixtures, not product code.
- **Settled decisions** (`HANDOFF-2026-09-18.md` §7) are not reopened. Open owner decisions (§8) are not invented; configurable fail-closed code is written, activation is left absent.
- **No deploy, cloud or resource mutation, credential operation, customer-data operation, seed or provisioning script, or external message.** Local Miniflare only.

## 7. Checkouts, commands, gate, evidence

- **Control checkout** `/mnt/c/users/lah/documents/__development/optimizely/__cloudflare_base`: lead only, governance files only. No agent runs anything there.
- **Builder checkouts** are git worktrees under `/home/simonecoelho/rem/<lane>` with `node_modules` symlinked to `/home/simonecoelho/rem/_deps/node_modules`. One writer per checkout, ever. A reviewer measures a builder's checkout only while the builder holds still, or its own detached checkout at the exact commit.
- **Command rules.** The owner's settings deny `git checkout`, `git reset` and `git stash`; a denied command stalls the session. Also never `git restore`, `git switch`, `git rm`, `rm -rf`, `cd` inside a command, package installs, docker, kill/pkill. Use absolute paths and `git -C <checkout>`. Long commands: `setsid nohup <cmd> > <log> 2>&1 & disown`, then poll the log.
- **Git recipe.** Commit by path: `git -C $WT add -- <paths>` then `git -C $WT commit -m "<title>" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`. Refresh on a clean tree: `git -C $WT merge --no-edit feature/real-time-personalization`. Push only when the brief grants it: `git -C $WT push origin HEAD:refs/heads/<branch>`. The integration branch is `feature/real-time-personalization`.
- **The gate**, all before any push, each logged to the evidence directory:
  1. `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --incremental false --composite false` and `node node_modules/typescript/bin/tsc -p src/sdk/tsconfig.json --noEmit`
  2. `node node_modules/vitest/vitest.mjs run src --maxWorkers=1 --minWorkers=1 --reporter=default --reporter=json --outputFile=<evidence>/vitest.json`
  3. `node scripts/remediation/score.mjs --from <evidence>/vitest.json --check-ratchet`
  4. `node scripts/build-sdk.mjs --check` and `node scripts/build-meridian.mjs --check`
  5. `node node_modules/eslint/bin/eslint.js <changed .ts and .js files>` with zero new diagnostics versus the base commit (the repository tolerates 582 legacy warnings; do not add one).
- **Evidence** per batch and role: `/home/simonecoelho/rem/_evidence/<batch>/<role>/` holding the brief, the report and the logs. The lead mirrors reports to `C:\Users\LAH\Documents\Remediation-Evidence\cloudflare_base\`. Reports are facts in a fixed order: score line, commit, changed paths, tests run with log paths, what could not be done. A builder never says PASS.

## 8. What the lead does each turn

Writes complete briefs. Sequences by message, one writer per checkout. Rules on ambiguity once, in writing, in `LANE-LOG.md`; every later batch follows it. Validates narrowly: the score on the exact commit, changed paths in scope, the reviewer's verdict, nothing else, never inside a checkout an agent is using. Writes lessons into the agent definitions the same hour. Keeps the dated lane log current: what is in flight, commit ids, who holds which checkout, what was ruled. Reports in plain words: the score line, what is ready, the one thing blocking, what happens next.

## 9. Records

| Record | Role |
|---|---|
| `docs/architecture/35-audit-verification-and-source-of-truth.md` | Scope authority for W01–W41. Unchanged. |
| `docs/remediation/METHOD.md`, `units.json`, `SCORE.md`, `baseline-failures.json`, `reviews/<W>.json`, `LANE-LOG.md`, `RESUME.md` | The execution register from 2026-09-18. Short, derived where possible. |
| `docs/handover/HANDOFF-2026-09-18.md` | Settled decisions (§7), open owner decisions (§8), the W17–W41 starting map (§6). |
| `docs/remediation/tracker.json` (journal 2284), `evidence/**`, `history/RESUME-frozen-2026-09-18.md`, document 36, `scripts/remediation/board.mjs` | Frozen history at the takeover. Retained immutably, not updated, not a second backlog. |
