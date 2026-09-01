# Demo Handover Readiness — Audit

**Auditor 2 of the handover review.** Scope: can an Optimizely engineer or sales engineer who did not build this repo (a) get a dev server running from a fresh clone, (b) find and run each demo, and (c) present/extend Meridian (Opticon) alone. Method: static inspection only — no server started, no wrangler/git command executed, no code edited (per mandate). Every claim below is cited to a file path and line number, or to a `git log` result (also verifiable, also cited). Repo snapshot: branch `feature/real-time-personalization`, audited 2026-08-29. Note for the reader: this repo has multiple `.claude/worktrees/agent-*` directories at the root, meaning other agents may be committing in parallel — treat commit hashes here as a snapshot, not a fixed target.

---

## 0. Executive summary

The codebase is in materially better shape than its documentation describes. The engine, the routes, and the newest demo (Meridian/Opticon) are current and well-commented in-code. But the **onboarding path is not just incomplete, it actively misdirects**: the root `README.md` describes a different, generic product and its own setup instructions reference a file (`wrangler.toml.example`) that does not exist anywhere in the repo. A stranger following the root README literally cannot reach a working demo.

Top five things that block a stranger, ranked by how early they'd hit them:

1. **`README.md`'s own Quick Start is not executable.** `cp wrangler.toml.example wrangler.toml` (README.md:151) — that file does not exist (§2). The real `wrangler.toml` is already committed, with a **real Cloudflare account's** KV namespace IDs, R2 bucket name and D1 `database_id` baked in (wrangler.toml:15,20,117) — it is not a template.
2. **No secrets template exists.** There is no `.dev.vars.example` in the repo (§1.2) — a new engineer must reverse-engineer the ten `.dev.vars` keys from `src/types/env.ts`, which is accurate but nowhere signposted as the source of truth.
3. **`npm test` fails out of the box.** `vitest.config.ts:15` hardcodes `environment: 'miniflare'` as the default for every suite, but `package.json`'s `devDependencies` (package.json:33-44) contain no `vitest-environment-miniflare` / `@cloudflare/vitest-pool-workers` package. `ONBOARDING.md` §5 independently confirms this ("The harness in this checkout is broken… fix before trusting a green/red signal") (§1.6).
4. **The D1 setup instructions are wrong in the two places most likely to be read first** — the `wrangler.toml` comment itself and the `seed-d1.mjs` docstring both cite migration filenames (`migrations/0002_seed_catalog.sql` etc.) that don't exist — while the *correct* instructions sit one click away in `docs/architecture/10-d1-schema.md` (§1.4).
5. **There is no map of the demos.** Nothing in the repo lists "here are the 4 live demo surfaces and their URLs" in one place. The root URL (`/`) is a 13-month-stale unrelated demo with zero links to any of the others (§2, §3).

None of this reflects badly on the newest work — Meridian/Opticon's in-repo isolation charter (`src/demos/meridian/README.md`) and the Bright Hour presenter runbook (`docs/qvc/BrightHour-Demo-Runbook.md`) are genuinely good models. The gap is entry, not depth.

---

## 1. Cold-clone setup: the real path vs. the documented path

This section walks the actual sequence a new engineer needs, established by reading the code (`src/types/env.ts`, `wrangler.toml`, `package.json`), not by trusting any single doc. Each step is marked with what documentation exists for it and where it's wrong.

### 1.1 Install

```bash
git clone <repo>
npm install
```
No issues. `package.json` has no `preinstall`/`postinstall` hooks that assume anything external. One scale note: the clone pulls a **53MB** `data/synthetic/events.json` (`data/synthetic/events.json`, 53,242,719 bytes) plus a 763KB pre-populated `data/optimizely-cache.db` SQLite file (both already-generated, checked-in fixtures — see §1.4) — not a blocker, but worth knowing before assuming a slow clone means something is wrong.

### 1.2 Secrets — `.dev.vars` (undocumented in full)

`src/types/env.ts` is the actual source of truth for every binding and var the Worker reads (confirmed by cross-referencing every `env.` reference in `src/**/*.ts` against it — the two lists match with one exception noted below). The keys a fresh `.dev.vars` needs, per `src/types/env.ts`:

| Key | Required? | Purpose | Where it's explained |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yes** — not optional in the `Env` interface (env.ts:77) | Opal chat + `/ai/scene` image generation | Nowhere in README/quick-start; only in `env.ts` comment and `docs/deployment/01-deploy.md:12` |
| `SHOT_TOKEN` | No (optional) — but gates the whole `/__shot` route (env.ts:5) | Visual verification harness (§5) | `src/routes/shot.ts:28-32` (code comment only) |
| `ODP_PUBLIC_KEY` + `ODP_API_HOST` | No | Live ODP/CDP loop; engine runs without it (`NotWiredError` seam) | `docs/deployment/01-deploy.md:11` |
| `OPTIMIZELY_API_TOKEN`, `OPTIMIZELY_PROJECT_ID`, `OPTIMIZELY_ACCOUNT_ID`, `OPTIMIZELY_ENVIRONMENT`, `OPTIMIZELY_WRITE_ENABLED` | No | Real FX API writes (create flags/experiments live) | `docs/deployment/01-deploy.md:11` |
| `GEMINI_MODEL`, `GEMINI_IMAGE_MODEL` | No | Model overrides | `env.ts:78-79` only |
| `SIGNAL_API_HOST`/`SIGNAL_API_KEY` | No | Signal-Led Moment live feed (absent → mock fixture) | `env.ts:73-75` only |
| `OPTIMIZELY_WEBHOOK_SECRET` | No | Datafile webhook HMAC | `docs/deployment/01-deploy.md:11` |

**No `.dev.vars.example` file exists anywhere in the repo** (checked at repo root; `.dev.vars` itself is correctly gitignored — `.gitignore:96-97`). The current checkout's `.dev.vars` additionally carries `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` — **neither is referenced anywhere in `src/`, `scripts/`, or `island/`** (confirmed by grep across all three; `env.ts` has no such fields). These are vestigial, presumably from before the Gemini switch, and would confuse a new engineer copying this file as a template into thinking they're required.

`.env` / `.env.example` at the repo root are a red herring for a Workers project: Wrangler does not load `.env` for `wrangler dev` (it reads `.dev.vars`). `.env.example` (tracked) even says as much in its own comments ("these are set in wrangler.toml", `.env.example:7-11`) but its existence next to `.dev.vars` invites a new engineer to configure the wrong file.

### 1.3 `wrangler.toml` is not a template — it is live configuration

`wrangler.toml` is tracked in git (`git ls-files wrangler.toml` confirms) and contains a real, working Cloudflare account's resource identifiers: KV namespace ids at wrangler.toml:15 and :20, R2 bucket name at wrangler.toml:23-24, D1 `database_id` at wrangler.toml:117, all four Durable Object class bindings, and the deployed hostname `edge-platform.expedge.workers.dev` (cited from `docs/opticon/Opticon-Task-List.md:341` and `ONBOARDING.md` §1 — not from wrangler.toml itself, which doesn't name the account). There is **no `account_id` field** in `wrangler.toml` at all — `wrangler dev`/`deploy` will silently use whatever account the logged-in Cloudflare identity defaults to, or prompt if there's more than one.

Practical consequence: a new engineer cannot "just" `wrangler dev` against their own blank Cloudflare account and expect the KV/R2/D1 bindings to resolve — those specific IDs belong to one account. They either need access added to that account, or need to create matching KV namespaces/R2 bucket/D1 database in their own account and edit `wrangler.toml` in place (there is no separate personal-override file). **This is never stated anywhere.** The root README's own instruction — "`cp wrangler.toml.example wrangler.toml` … Edit wrangler.toml with your Cloudflare settings" (README.md:150-152) — implies a template workflow that does not exist in this repo; `docs/guides/01-quick-start.md:23` repeats the identical dead instruction.

### 1.4 D1 database: schema + seed (right answer exists, wrong answer sits closer to the surface)

The **correct**, verified sequence is in `docs/architecture/10-d1-schema.md:36-37`:
```bash
npx wrangler d1 migrations apply coach-demo-db --local      # (then --remote for deploy)
for f in migrations/seed/seed_*.sql; do npx wrangler d1 execute coach-demo-db --local --file "$f"; done
```
This picks up all 8 schema migrations in `migrations/` (`0001_d1_init.sql` … `0008_meridian_geo_cohort.sql`) and all 11 pre-generated seed files in `migrations/seed/` (`seed_001.sql` … `seed_011_geo.sql`, already committed — running `scripts/generate-synthetic-data.mjs`/`scripts/seed-d1.mjs` again is **not** required for a fresh clone, only to regenerate). `docs/deployment/01-deploy.md:27-29` repeats this correctly for `--remote`.

But the two places a new engineer is most likely to look first are wrong:
- `wrangler.toml:111-112`, in the comment directly above the `[[d1_databases]]` block, says to run `wrangler d1 execute --file=migrations/0002_seed_catalog.sql (then 0003, 0004)`. **No such files exist** — `migrations/0002_demo_events.sql` is a schema migration, not a seed file (verified: `ls migrations/0002*` → only `0002_demo_events.sql`).
- `scripts/seed-d1.mjs:14-16`'s own header docstring repeats the identical wrong filenames. The script **contradicts its own header**: the message it actually prints when it finishes (`scripts/seed-d1.mjs:377`) gives the correct `migrations/seed/*.sql` glob form.

Net effect: someone who opens `wrangler.toml` (the natural first stop) or reads `seed-d1.mjs` top-to-bottom before running it will try to execute files that were never committed, and get file-not-found errors, before ever finding the doc that has it right.

### 1.5 Dev server, port, and the Meridian build step

```bash
npm run dev     # = npm run build:meridian && wrangler dev   (package.json:7)
```
Serves on **port 9100** (`wrangler.toml:156`, correctly matched by `docs/guides/01-quick-start.md:34` and `docs/SOLUTIONS_ARCHITECT_GUIDE.md:42`). `build:meridian` (`scripts/build-meridian.mjs`) bundles `src/demos/meridian/client-engine.ts` → `public/meridian/engine.bundle.js` via esbuild — this step **is** wired into both `npm run dev` and `npm run deploy` (package.json:7-8), so it's not something a new engineer has to remember.

**`build:island` is not wired in anywhere.** `island/opal-chat.tsx` (the Opal chat React island) is bundled by a *separate*, never-auto-invoked script, `npm run build:island` (package.json:10). It's mentioned once, tersely, in `docs/deployment/01-deploy.md:38`, but nothing tells a new engineer "run this after editing `island/opal-chat.tsx` or your changes won't appear in `public/opal-chat.js`." In the current checkout the two are in sync (both last touched in commit `3b1cc52`, 2026-07-03), so this isn't broken today — it's a silent trap for the next person who edits the island.

**`scripts/deploy.sh` bypasses the Meridian build entirely.** Unlike `npm run deploy` (package.json:8, which runs `build:meridian` first), `scripts/deploy.sh:30` calls `wrangler deploy` directly. `scripts/deploy.sh` predates Meridian (its last real edit is commit `bd13c34`, before Meridian's first commit `7abec86` — confirmed by `git log --diff-filter=A -- scripts/build-meridian.mjs`), so running `./scripts/deploy.sh` instead of `npm run deploy` would ship a stale `engine.bundle.js` if `client-engine.ts` had changed since the last manual build. The script otherwise correctly guards the `--env staging|production` landmine (scripts/deploy.sh:23-28) that `docs/deployment/01-deploy.md` still flags as unfixed — that part of the doc is itself now stale.

**`npm run rehearse` defaults to the wrong port.** `scripts/meridian-rehearsal.mjs:2` and `scripts/meridian-isolation.mjs:2` both default `MERIDIAN_BASE` to `http://127.0.0.1:8799` — not 9100, where `npm run dev` actually serves. Nothing in the repo documents this (grepped `docs/`, `scripts/`, all `*.md`, `package.json`, `wrangler.toml` for `8799`/`MERIDIAN_BASE`: zero hits outside the two script files themselves). A new engineer running `npm run dev` then `npm run rehearse` in a second terminal will get every check failing on connection refused, with no clue that they need `MERIDIAN_BASE=http://localhost:9100 npm run rehearse` instead.

### 1.6 Tests — broken by default, and the fix is undocumented

`vitest.config.ts:15` sets `environment: 'miniflare'` globally. `package.json` `devDependencies` (lines 33-44) list `vitest` itself but no `vitest-environment-miniflare` or `@cloudflare/vitest-pool-workers`. Running the literal `npm test` script (`"test": "vitest"`, package.json:15) against any suite will fail to resolve that environment. `ONBOARDING.md` (§5, "Code map" table, and the note under "Tests") independently states the same conclusion ("56 real test cases… The harness in this checkout is broken (missing `vitest-environment-miniflare`); fix before trusting a green/red signal") — two independent sources agree, though neither was executed as part of this audit (no processes were run, per the read-only mandate). The one documented workaround is buried in `docs/deployment/01-deploy.md:38`: `npx vitest run src/reflex --environment node` — a hand override that only covers the reflex suites, not the 23 `*.test.ts` files across the repo (`find src -name "*.test.ts" | wc -l` → 23), several of which (e.g. `src/demos/meridian/layout.test.ts`) exercise D1/DO bindings that a plain `node` environment can't provide.

### 1.7 No CI

There is no `.github/workflows/` directory (or any other CI config) in the repo. `docs/README.md`'s own navigation promises a CI/CD doc (`docs/deployment/03-cicd.md`) that doesn't exist (§2). Nothing runs typecheck/lint/test on a PR; the only enforcement is `scripts/deploy.sh`'s manual pre-deploy `typecheck`/`lint`/`test` sequence (scripts/deploy.sh:9-19), which per §1.6 will itself fail on the broken test harness.

### 1.8 The condensed, correct cold-clone sequence

For the handover doc this audit recommends (§6), the actual sequence — reconstructed from code, not from any single existing doc — is:

```bash
git clone <repo> && cd <repo>
npm install
# create .dev.vars by hand — see src/types/env.ts; GEMINI_API_KEY is the only
# strictly required key for the app to boot without runtime errors on /ai/* routes
cp wrangler.toml <no-op — it's already the real config; get added to the
   Cloudflare account that owns the IDs at wrangler.toml:15,20,117, or swap
   them for your own KV/R2/D1 resources>
npx wrangler d1 migrations apply coach-demo-db --local
for f in migrations/seed/seed_*.sql; do npx wrangler d1 execute coach-demo-db --local --file "$f"; done
npm run dev                      # builds Meridian automatically, serves :9100
curl http://localhost:9100/health
```

---

## 2. Repo-root README state

**`README.md` exists but describes a different, earlier product than what's in the repo today, and its own instructions don't execute.**

- Zero mentions of any current demo: grepped `README.md` case-insensitively for `storefront|meridian|opticon|bright hour|coach|calder|visual-demo|restaurant|pizza` — **no matches**. It documents a generic "tracking, personalization, and experimentation" scaffold (README.md:1-9) with Mermaid diagrams of routes like `/track`, `/pixel`, `/cdp` that are real but incidental — none of `/storefront`, `/meridian`, `/live`, `/visual-demo.html`, `/operator-console.html` appear anywhere in the file.
- `cp wrangler.toml.example wrangler.toml` (README.md:151) references a file that does not exist in the repo (confirmed: `find . -maxdepth 1 -iname "wrangler*"` returns only `wrangler.toml`).
- Quick Start says "Optimizely account (optional)" (README.md:112) — true only for the generic scaffold; the actual Opal chat requires `GEMINI_API_KEY` unconditionally (§1.2), which the README never mentions at all.
- Deploy section (README.md:118-127) is the one part that's current — it correctly warns against `--env staging|production` and points to `docs/deployment/01-deploy.md`.
- History: `README.md`'s last commit is `bd13c34` (2026-07-08, "doc housekeeping" per its own message), but its last *substantive* content rewrite was `a15fd79` (2025-08-16) — over a year before this audit, and before Coach, Meridian, or Bright Hour existed as demos.

**`docs/README.md`** (the docs-folder index) has the same problem at a smaller scale, and it's quantifiable: it links to 29 files across 6 categories (Architecture, Guides, API, Components, Integration, Deployment; docs/README.md:9-46). Checking every linked filename against what actually exists in each directory:

| Category | Promised | Exist under that exact name |
|---|---|---|
| architecture/ | 5 | 1 (`01-system-overview.md`) |
| guides/ | 5 | 1 (`01-quick-start.md`) |
| api/ | 4 | 2 (`01-rest-endpoints.md`, `02-websocket-protocol.md`) |
| components/ | 5 | 1 (`01-segment-engine.md`) |
| integration/ | 5 | 1 (`01-web-integration.md`) |
| deployment/ | 5 | 0 (the real file is `01-deploy.md`, not `01-environments.md`) |
| **Total** | **29** | **6** |

23 of 29 links in the docs index's own table of contents are dead. Meanwhile `docs/architecture/` alone has grown to 17 numbered documents (00, 01, 05-19) that the index doesn't mention at all — the real content moved on; the index didn't follow.

What a correct root README needs to contain (input to §6): a one-paragraph "what this repo is" that names all current demos, a link to a demo index, the real `.dev.vars` keys, the real D1 setup sequence, and the fact that `wrangler.toml` ships pre-filled and needs either account access or ID substitution.

---

## 3. Per-demo inventory

Entry URLs are confirmed by reading each page's own `<title>`/route declaration and, for API routes, `src/index.ts`'s `app.route()` mounts (src/index.ts:65-91). "State" is judged from the last commit touching each surface's core files (`git log -1 --format=%ad --date=short`) plus what documentation exists — **no server was started to verify this**, so "presentable" below means "code and docs suggest it renders," not "confirmed working."

| Demo | Entry URL(s) | Last touched | State | Docs that exist |
|---|---|---|---|---|
| **Coach storefront** ("Tapestry") | `/storefront.html` (title "Coach") | `public/storefront.js` → 2026-07-08 (`5600a2a`) | Presentable per docs; ~7.5 weeks since last core change at audit time — long by this repo's pace but not evidence of decay | `docs/architecture/00-architect-walkthrough.md` (2026-07-08, accurate), `docs/DEMO-MASTER-PLAYBOOK.md` (2026-06-26), `docs/SOLUTIONS_ARCHITECT_GUIDE.md` (partial — doesn't mention Coach at all, §3 below), `docs/PROJECT_LEDGER.md`, plus ~15 more `docs/Coach-*.md` files |
| **Banking** ("First National Bank") | `/visual-demo.html` (confirmed via `<title>`, visual-demo.html:6) | 2025-09-24 (`25a3185`) | Code/docs suggest it still renders (static HTML/JS, no external deps found), but **11 months** stale — oldest actively-referenced surface in the repo | `docs/architecture/legacy/00-architect-walkthrough-2025-platform.md`, and §4-6 of `docs/SOLUTIONS_ARCHITECT_GUIDE.md` (2026-04-30) — the only demo with a genuine "run it alone" doc (see callout below) |
| **`/restaurant` (Pizza Hut)** | — none | — | **Not built.** `src/demos/registry.ts:25` types `DemoSurface` as `'coach' \| 'brighthour'` only — there is no third surface in code, and no route or public file anywhere matches "restaurant" (grepped `src/`, `public/`) | Planning-only: `docs/pizzahut/` (5 docs — proposal, use-cases, research, build spec, README). `docs/pizzahut/README.md:2` itself says "Status: INTERNAL — pursuit stage. Nothing in this folder is customer-facing yet." Matches the task brief's framing of this as an active demo — **it is not one yet.** |
| **Meridian / Opticon** ("Calder" on screen) | `/meridian` (page), `/meridian/api/*` (data) — per `src/demos/meridian/README.md:60` | `public/meridian/` and `src/demos/meridian/` → 2026-08-29 (same day as this audit, `5cd1631`/`48aadd6`) | Most active surface in the repo; deployed and verified live at `https://edge-platform.expedge.workers.dev/meridian/` per `docs/opticon/Opticon-Task-List.md:341` | 9 docs in `docs/opticon/` — assessed in full in §4 |
| **Bright Hour** (QVC-representative) | `/live` (page), `/live/api/*`, `/live/ops.html` (Offer Desk) | `public/live/`, `src/demos/brighthour/` → 2026-08-19 (`06ad7ea`) | Presentable; has the best presenter documentation of any demo in the repo | `src/demos/brighthour/README.md` (data contract), `docs/qvc/BrightHour-Demo-Runbook.md`, `docs/qvc/BrightHour-Cheat-Sheet.md`, `docs/qvc/BrightHour-Engine-Explainer.md`, `docs/qvc/BrightHour-Imagery-QA.md` — see the callout below |
| **Operator console** | `/operator-console.html` | 2026-06-25 (`82688cb`) | Unauthenticated by design-debt, not by demo choice — `ONBOARDING.md` §6 item 5 flags operator routes as unauthenticated in `src/index.ts`, auth middleware exists (`src/middleware/auth.ts`) but is wired nowhere | None dedicated; mentioned in passing in `docs/architecture/00-architect-walkthrough.md` |
| **Root (`/`)** | `/` (title "Real-Time Personalization Demo \| Optimizely Edge Platform") | `public/index.html` → 2025-08-16 (`a15fd79`) | The oldest surface (13 months stale) and the **only thing at the bare domain** — grepped `public/index.html` for any link or text mention of `meridian`, `storefront`, `/live`, `calder`: zero. A stranger opening the root URL cold has no path to any other demo. | `docs/DEMO_EXPLANATION.md` (2025-08-16, same vintage), §5 of `docs/SOLUTIONS_ARCHITECT_GUIDE.md` |

**Naming note that affects every future search of this repo:** the on-screen brand for the Meridian demo was changed to **"Calder"** (`docs/opticon/Opticon-Task-List.md` §0, decision D12: *"Demo brand = Calder — Calder & Co. (retail) / Calder Financial (bank). Moved off 'Meridian' because real Meridian banks exist… Code namespace stays meridian/mrd_."*). `public/meridian/index.html:6` already shows `<title>Calder</title>`. So: code, routes, file paths, KV prefixes, and most docs say **Meridian**; the projector, the newest presenter docs, and anyone in the room say **Calder**. No document currently explains this mapping to a newcomer outside that one line in the Task List — worth one explicit sentence in whatever top-level index gets built (§6).

**Two callouts on what "good" looks like here**, both worth reusing as templates:
- `docs/SOLUTIONS_ARCHITECT_GUIDE.md` (220 lines) is a genuine self-serve doc — prerequisites, exact URLs, a talk track with quoted lines, a pre-demo checklist, a gotchas table, an FAQ. Its only flaw is scope: written in 2026-04-30 before Coach/Meridian/Bright Hour existed, its "Two demos ship in this repo" framing (line 14) is now off by two or three.
- `docs/qvc/BrightHour-Demo-Runbook.md` + `BrightHour-Cheat-Sheet.md` are the strongest presenter pair in the repo: a numbered "SETUP (10 minutes before)" with the deployed URL preferred over local (`BrightHour-Demo-Runbook.md:16-24`), a documented local fallback command, a "Fresh start" reset checklist, and — critically — a one-page "If something goes sideways" recovery section including an offline mode (`?mock=1`, confirmed live at `public/live/live.js:1718-1723,4764`). Meridian/Opticon has no equivalent of either document.

---

## 4. The Meridian/Opticon doc set

`docs/opticon/` holds **9** documents, not 5 — the task brief names `Opticon-Presenter-Companion.md`, `Opticon-Controls-Guide.md`, `Opticon-Talk-Track.md`, `Opticon-Abstract-Coverage.md`, `Opticon-Task-List.md`; also present and relevant: `Opticon-Demo-Design.md`, `Opticon-Layout-Spec.md`, `Opticon-Run-Of-Show.md`, `Research-Personalization-Demos.md`.

| Doc | Length | Actual audience | Fit for a solo sales engineer |
|---|---|---|---|
| `Opticon-Presenter-Companion.md` | 654 lines | **One named person.** Line 1: *"For Simone. Study material, not a stage script."* | Poor as-is — it's addressed to a specific presenter by name, assumes they'll memorize it, and is dense with competitive-intel prose meant to be internalized, not consulted mid-demo. |
| `Opticon-Talk-Track.md` | 683 lines | Presenter, any | Good, self-aware: line 3 states it's generated (`node src/demos/meridian/build-talk-track.mjs`) and warns not to hand-edit it, and documents the `?prompter=1` reveal hook (line 4). Assumes the show is already running. |
| `Opticon-Controls-Guide.md` | 97 lines | Presenter (control-by-control reference) | Good, and doubles as in-app copy (line 3: on-hover tooltips carry a 2-line version of this text). Assumes the demo is already open in a browser — no URL, no setup. |
| `Opticon-Abstract-Coverage.md` | 58 lines | Internal build-tracking (claim-by-claim, cites file:line) | Not presenter- or engineer-onboarding material; it's a marketing-claim audit. |
| `Opticon-Task-List.md` | 352 lines | Internal engineering ledger | The most information-dense doc in the set (it's where the deployed URL, the `/__shot` gating rationale, and the `.dev.vars`-needs-a-restart gotcha all live — see §5), but it's a running checklist, not something a newcomer would read start to finish, and load-bearing facts (deployed URL, line 341) are buried among ~150 checked items. |
| `Opticon-Demo-Design.md` | 203 lines | Internal design rationale | Historical context ("why legibility over density"), not operational. |
| `Opticon-Layout-Spec.md` | 198 lines | Engineer/designer implementing the CSS | Dev reference, not presenter-facing; correctly scoped for what it is. |
| `Opticon-Run-Of-Show.md` | 167 lines | Design target, explicitly not build status (line 5: *"Build status lives in Opticon-Task-List.md — the Real? column below states the TARGET state"*) | Useful context, but a newcomer reading only this would not know which parts are real today. |
| `Research-Personalization-Demos.md` | 80 lines | Internal competitive research (for whoever is writing the pitch) | Not operational. |

### What's missing for a sales engineer to demo Opticon alone

None of the 9 documents is a quick-start. Specifically absent, contrasted against what Bright Hour already has (§3 callout):

1. **No runsheet.** No single doc says: here's the URL, here's what to check first, here's the order to open things in. (Bright Hour has this in `BrightHour-Demo-Runbook.md` §1.)
2. **No reset/recovery procedure beyond the in-app "↻ Restart" button** (documented only as a UI control in `Opticon-Controls-Guide.md` §1, which resets one visitor's profile client + server side). There is no bulk/operator-level reset for Meridian's D1 rows: `src/demos/meridian/routes.ts` has 20 route handlers (grepped `meridian.get`/`meridian.post`) and exactly one, `POST /reset` (routes.ts:211), which calls the per-visitor Durable Object's own `/reset` — there is no route that clears `mrd_decisions` (written by every decision at `src/demos/meridian/receipts.ts:104`). Every rehearsal, every dev session, and every live run accumulates rows with no documented or automated cleanup — the same class of problem `ONBOARDING.md` §6 item 8 already flags for Coach's `demo_events` table ("hits the 10GB cap ~100K sessions/mo").
3. **No offline/network-failure fallback.** Bright Hour has `?mock=1` (`public/live/live.js:1718-1723`) for presenting with no network. Meridian has no documented equivalent — if it has one in code, it isn't surfaced in any doc.
4. **`/__shot` is essentially undocumented outside the code itself** — see §5; the only doc mention is one buried checklist line (`Opticon-Task-List.md:344`) and a one-line exclusion note in the API reference (`docs/api/01-rest-endpoints.md:96`, which explicitly lists it as something to *exclude* from partner docs, not explain).
5. **The Meridian/Calder naming split (§3) is not explained to a newcomer anywhere except one locked-decision line** (`Opticon-Task-List.md`, D12) — someone reading the Controls Guide or Talk Track first would just see "Calder" and have no link back to the `/meridian` route or the `meridian`/`mrd_` code namespace.
6. **No "what if it breaks mid-demo" page.** Bright Hour's Cheat Sheet has an explicit "If something goes sideways" section (skip/stop/New-Viewer, ordering dependencies between beats). Nothing equivalent exists for Meridian.
7. **Known landmines are scattered, not centralized.** Example: `Opticon-Task-List.md`'s final section notes an *open, unresolved* question — "Is the Coach bank-demo Reset defect ours to fix? (it calls a global that doesn't exist; presenter-path)" — a real, citable bug, sitting at the bottom of a 352-line checklist where a solo presenter would never find it before walking on stage.

---

## 5. The `/__shot` verification harness (reference)

Documented today only in code (`src/routes/shot.ts`, 129 lines) and one buried checklist entry (`docs/opticon/Opticon-Task-List.md:344`). Full mechanism, extracted from the code:

**What it is.** A same-origin-only headless-Chromium screenshot route (`src/routes/shot.ts:1-12`), built on Cloudflare Browser Rendering (`@cloudflare/puppeteer`) and the `[browser]` binding `BROWSER` (`wrangler.toml:26-27`). It drives the Worker's *own* deployed pages in a real browser so a change can be verified visually rather than trusted.

**Auth (`shot.ts:20-44`).** Gated by the `SHOT_TOKEN` secret (`env.ts:5`). If `SHOT_TOKEN` is unset, the route **does not exist** — every request 404s. If it is set, a request must present the same value via `?token=` or the `x-shot-token` header, compared with a timing-safe constant-time loop (shot.ts:39-43). Both "no token configured" and "wrong token" return 404, not 401 — deliberately, so an outside prober can't distinguish "route absent" from "route present but locked" (shot.ts:29-30). **Operational gotcha, from `Opticon-Task-List.md:344`:** changing `SHOT_TOKEN` in `.dev.vars` requires a full restart of `wrangler dev`, not a hot reload. The code comment (shot.ts:31-32) explicitly instructs: set it in `.dev.vars` locally, and leave it **unset** on the conference/production deployment, since nothing on stage needs the route and it's a real remote-code-execution surface if left open (shot.ts:20-26).

**Endpoint:** `GET /__shot` (mounted at `src/index.ts:78`).

**Query parameters** (all optional except that at least a target page is implied by the default):

| Param | Default | Meaning |
|---|---|---|
| `path` | `/storefront` | Same-origin path to load (resolved against the Worker's own origin — shot.ts:73) |
| `w`, `h` | `1440`, `1600` | Viewport size, capped at 2000×4000 (shot.ts:74-75) |
| `wait` | `1400` ms | Settle time after load and after each click, capped at 8000 (shot.ts:76) |
| `clicks` | — | Comma-separated CSS selectors to click **in order** (URL-encode `#` as `%23`); each click is logged and reported back via the `x-shot-clicks` response header as `ok:<selector>` or `FAIL:<selector>` — a failed click sets `x-shot-ok: false` rather than silently passing (shot.ts:87-102, with an explicit comment on why: *"A swallowed click is how a screenshot 'verifies' something that never happened"*) |
| `clip` | — | CSS selector to crop the screenshot to; falls back to full viewport if not found (shot.ts:106-108) |
| `full` | — | `full=1` captures the full scrollable page instead of just the viewport |
| `js` | — | Arbitrary JS string, `eval`'d in the page after clicks (shot.ts:103) — this is the "remote code execution surface" the auth model exists to close off |
| `rec` | — | Injects `REC_SCRIPT` (shot.ts:46-48) before page load via `evaluateOnNewDocument`, which polls `#hero-content .hero-title` every 16ms and logs every text change with a timestamp to `window.__herolog`; with `rec` set, the route returns that log as JSON instead of a PNG — built specifically to catch a during-load flash (e.g., a hero title that briefly shows the wrong text before settling) that a single post-load screenshot would miss |
| `diag` | — | `diag=1` returns live Browser Rendering session/limit diagnostics instead of taking a screenshot (shot.ts:66-72) — the documented way to answer "why is my browser acquisition failing" without guessing |

**Session reuse (`shot.ts:50-60`).** Browser Rendering session *acquisition* is rate-limited account-wide; the route first checks for a free existing session via `puppeteer.sessions()` and reconnects to it before launching a new one, and on completion it disconnects (keeping the session warm, `keep_alive: 60000`) rather than closing it — so a burst of shots doesn't each burn a fresh, rate-limited acquisition (shot.ts:116-124).

**Example** (matching the format used in-repo, e.g. `Opticon-Task-List.md`'s own verification entries):
```
GET /__shot?path=/meridian&w=1920&h=1080&clicks=%23dir-next,%23dir-ok&wait=1500&clip=%23stage&token=<SHOT_TOKEN>
```

**Related debug hooks** (not part of `/__shot` itself, but the same family of "tribal knowledge" the task asked about — found by grepping every `public/*.js` for `URLSearchParams`/`window.__` patterns):

| Hook | Where | Effect |
|---|---|---|
| `?debug` (presence, any value) | `public/meridian/meridian.js:3508` | Exposes the internal state object and beat-driver function as `window.__S` / `window.__goBeat` |
| `?prompter` (presence, any value) | `public/meridian/meridian.js:2825-2826` | Reveals the presenter's spoken line (`say`) on the director bar, normally hidden (`public/meridian/beats.js:20`) |
| `?region=`, `?zip=`, `?city=`, `?country=` | `src/demos/meridian/routes.ts:127`, `public/meridian/meridian.js:432-453` | Overrides the geo-cohort cold-start's resolved location, for rehearsing a specific region without needing to physically be there — verified for `CA`/`NC`/`TX` per `Opticon-Task-List.md:342` |
| `?mock=1` | `public/live/live.js:1718-1723,4764` | Forces Bright Hour's offline/mock data path — the presenting-with-no-network fallback |

None of these four are collected anywhere outside the source files that implement them.

---

## 6. Deliverable: the documentation set this repo needs

Ordered by what blocks a stranger soonest. "Effort" is a rough order-of-magnitude estimate for a writer who already has this audit's findings in hand, not a re-investigation.

### Gap list (severity order)

1. **A repo-root `README.md` rewrite** — currently actively misleading (§2). Blocks step one for everyone.
2. **A `.dev.vars.example`** — currently doesn't exist at all (§1.2). Blocks the first `wrangler dev`.
3. **A one-page demo index** naming all current surfaces, their URLs, and their state — currently doesn't exist anywhere; root `/` is not it and links to nothing (§3).
4. **A Meridian/Opticon quick-start + reset/recovery runsheet**, on the model of `BrightHour-Demo-Runbook.md` + `BrightHour-Cheat-Sheet.md` — the CEO-facing, 30-customer demo currently has the *least* self-serve documentation of the three active demos (§4).
5. **Fix or flag the D1 setup instructions** in `wrangler.toml:112` and `scripts/seed-d1.mjs:14-16` (§1.4) — two-line changes, but they're wrong in exactly the two spots a newcomer reads first.
6. **A test-harness fix or a documented workaround note in `package.json`/root README** — `npm test` failing silently-by-environment-error on a fresh clone erodes trust in everything else (§1.6).
7. **A `/__shot` + debug-hooks reference doc** — currently only in code comments (§5); low effort since this audit already assembled it.

### Proposed file set

| File | Audience | Outline | Effort |
|---|---|---|---|
| `README.md` (rewritten) | Anyone landing on the repo | What this repo is (multi-demo platform, not a single product) · the demo index (link to next file) · true Quick Start (install → `.dev.vars` → D1 → `npm run dev`) · pointer to `docs/deployment/01-deploy.md` for real deploys · explicit note that `wrangler.toml` ships pre-filled, not a template | M (half day — mostly assembling facts this audit already verified) |
| `.dev.vars.example` | Anyone running `npm run dev` for the first time | Every key from `src/types/env.ts` (§1.2 table), commented with required-vs-optional and one-line purpose, values blank/placeholder | S (1-2 hrs) |
| `docs/DEMOS.md` (new demo index) | Engineer or SE orienting for the first time | Table: demo name · entry URL(s) · one-line pitch · state (presentable/stale/not-built) · primary doc to read next · the Meridian/Calder naming note (§3) | S (2-3 hrs — this audit's §3 table is most of the content) |
| `docs/opticon/Opticon-Quickstart.md` | Sales engineer demoing Meridian/Opticon solo, first time | Modeled on `BrightHour-Demo-Runbook.md`: deployed URL first, local fallback second · fresh-start checklist · the vertical swap (Calder & Co. / Calder Financial) · a "print this" one-pager equivalent to the Bright Hour Cheat Sheet, including an "if something goes sideways" section and the open Coach-reset-defect note surfaced, not buried | M (half day — needs a walkthrough of `beats.js`/the Controls Guide to extract the beat sequence, but the Bright Hour docs are a structural template to copy) |
| `docs/opticon/Opticon-Reset-Recovery.md` (or a section of the above) | Sales engineer, mid-demo or pre-show | The in-app Restart button's actual scope (per-visitor only) · how to clear accumulated `mrd_decisions` rows (needs a route or a documented manual `wrangler d1 execute DELETE` — currently neither exists, so this doc also doubles as the spec for a small code fix) · what to do if the DO or D1 state looks wrong on stage | S–M (spec is straightforward; may require requesting the missing reset route be built first) |
| `docs/VERIFICATION-HARNESS.md` (`/__shot` + debug hooks) | Engineer verifying a change before calling it done | Full `/__shot` reference (§5 of this audit, near copy-paste ready) · the four query-param debug hooks table · `SHOT_TOKEN` setup and the restart-required gotcha | S (this audit's §5 is essentially the draft) |
| `docs/README.md` (index, repaired) | Anyone browsing `docs/` | Either delete the 23 dead links (§2 table) or regenerate them against what actually exists; add the 14 un-indexed `docs/architecture/06-19` documents | S (mechanical — remove/relink, no new investigation) |
| Fix `wrangler.toml:112` + `scripts/seed-d1.mjs:14-16` | N/A (code comments) | Replace the `migrations/000X_seed_*.sql` filenames with the correct `migrations/seed/seed_*.sql` glob, matching `docs/architecture/10-d1-schema.md:36-37` and what `seed-d1.mjs:377` already prints at runtime | S (two comment edits) |
