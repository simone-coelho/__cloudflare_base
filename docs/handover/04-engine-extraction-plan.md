# 04 · Engine extraction plan: a clean repository engineers can work in

**Status:** draft for review, 2026-09-14. Nothing has been moved, committed or deployed.
**Basis:** measurements of the working tree on `feature/real-time-personalization` at `f13d761`, plus the uncommitted remediation changes (§2).
**Companion:** [05 · Engine file review register](05-engine-file-review-register.md), the file-by-file checklist.
**Replaces:** the whole-repository push in [00](00-readiness-summary.md) Track A and [01](01-code-audit.md) §8b. That approach moved every demo along with the engine; this one does not. Its cleanup items that still apply are folded in below.

---

## 0 · On one page

**The goal.** A new repository that holds only the engine. That covers the worker that makes decisions, the operator console, the customer SDK, the scripts to build, deploy and operate it, its tests, and documents an engineer can learn from. An engineer who has never seen this repository should be able to clone it, understand it and change it. We should be able to deploy it for one customer without editing code. Demos stay in this repository.

**How big it is.** The engine is 155 files and 33,591 lines, plus about 70 test files. The engine never imports 90 source files (38,059 lines) of demo and legacy code, and those stay behind. So do about 30,700 lines of demo pages, about 72 MB of demo images, and every demo migration and seed file.

**What stands in the way.**

1. **Eight tangles.** Engine code imports demo code, demo data or a built-in demo brand in eight places (§2.3). These have to be cut before the engine can build on its own.
2. **No safe per-customer deployment.** Today one configuration file carries one Cloudflare account's resource IDs and every demo binding. The provisioning scripts have been retired as unsafe, and no replacement exists yet (§3).
3. **Hard to read.** 15 files are over 500 lines and 46 functions run 80 lines or more. Only 434 of 963 exports have a comment. Comments carry 625 internal work references that mean nothing outside this repository, and 32 outside names: 29 customer or people names, 2 mentions of an event and 1 of a competitor (§8).
4. **Unknown test baseline.** 116 of 1,646 tests fail in the current working tree, which is mid-change (§2.1).

**How we get there.** Five phases (§5), run by seven workstreams (§6). Phases 3 and 4 run in parallel once the repository exists.

| Phase | What happens | Done when |
|---|---|---|
| 0 · Decide and freeze | The decisions in §4 are made. Remediation work is committed and a baseline commit is tagged. | Decisions recorded, baseline tagged, test failures on it explained |
| 1 · Untangle in place | Cut the eight tangles in this repository and give the engine its own entry point. Add an automated check that builds the engine alone. | The check is green and the demos still work |
| 2 · Cut the repository | Copy the engine files from the baseline into a new repository as its first commit, with new configuration, CI and README | A fresh clone installs, lints, typechecks and passes tests in CI |
| 3 · Make every file readable | Work through the register tier by tier, one owner per file | Every register item is ticked and second-read |
| 4 · Deploy for one customer | Requirements R1 to R10 in §3 | Someone who did not build it creates a stamp for a test customer on a fresh account from the runbook alone |

**Not in this plan.** Fixing the defects listed in document 35. Extraction makes the engine shareable and deployable. Document 35's gates G0 and G1 still decide when real customer data may enter a stamp. A clean repository is not a ready product.

---

## 1 · Words used in this plan

| Word | Meaning here |
|---|---|
| **Engine** | The code that receives shopper events, keeps each shopper's affinity profile, makes content and product decisions, and records what was decided and what happened after. It also includes the operator API and console and the customer SDK. |
| **Demo** | Any code, page, data or script that exists to show the engine on a made-up storefront: the Coach storefront, Bright Hour (`/live`), Meridian, the visual banking demo, Revenue Radar, the Opal chat agent and the screenshot route. |
| **Stamp** | One deployed copy of the engine worker with its own Cloudflare stores (KV, R2, D1, queues, Durable Objects) and its own secrets. Deploying for one customer means creating one stamp. |
| **Tenant** | A brand inside a stamp. Each request resolves to one tenant; the tenant ID is data, not code. |
| **Decision path** | The route an event takes: ingest (`POST /realtime/action`), update the shopper profile, score, compose a decision, deliver it (`GET /v1/:tenant/decisions/snapshot`, the socket, or `POST /sort`). |
| **Host** | Where a shopper's live profile is kept. The *session host* keeps it in a KV session with a socket relay object. The *object host* keeps it in the `ShopperReflex` Durable Object. `REFLEX_HOST` selects one. |
| **Durable Object** | A Cloudflare object with its own storage that handles one request at a time. |
| **Binding** | A named handle to a Cloudflare resource, declared in `wrangler.toml` and read as `env.NAME`. |
| **Tangle** | A place where engine code imports demo code, imports demo data or defaults to a demo brand. |
| **Internal work reference** | A label like `CW10`, `W09.06`, `doc 22 §15`, `ledger 20 row 9` or `scope appendix §1.4`. It points to this repository's planning documents, which do not move. |
| **Remediation program** | The defect register in [document 35](../architecture/35-audit-verification-and-source-of-truth.md), executed under [document 36](../architecture/36-remediation-governance-and-execution.md). `W01`–`W41` are its work packages, `D01`–`D10` its open decisions, and `G0`–`G4` its gates. |
| **Baseline commit** | The tagged commit the new repository is copied from. |

---

## 2 · Where things stand (measured)

### 2.1 The repository

| Check | Result |
|---|---|
| Commit | `feature/real-time-personalization` at `f13d761`. 196 tracked files are changed and uncommitted (+29,134 / −6,031 lines), plus 2,400+ untracked files under `docs/remediation/` |
| Typecheck | Passes for both the worker and the SDK (`npm run typecheck`) |
| Lint | 0 errors, 494 warnings; the allowed maximum is 503 (`npm run lint`) |
| Tests | 1,646 tests in 102 files, run on this machine in 165 seconds. **116 fail, in 24 files.** Four of those files are `node:test` scripts under `scripts/` that vitest collects and cannot run. The rest were not diagnosed: the tree is mid-change, and the failures may belong to work in progress. |
| CI | `.github/workflows/ci.yml` runs lint, typecheck and tests on every push |
| History | 375 commits since 2025-08-15, hosted under a personal GitHub account |
| Tracked clutter | A 96-file copy of an old agent worktree under `.claude/worktrees/`, a local SQLite cache under `data/`, `.npmrc.bak`, a duplicate architecture document, reference text dumps at the root |

### 2.2 What the engine is, by import trace

The trace starts from what a customer stamp keeps and follows every runtime import:

- **Routes:** `/health`, `/auth`, `/operator`, `/config`, `/content`, `/sort`, `/realtime`, `/v1` decisions and identity, `/geo`
- **Durable Objects:** `ShopperReflex`, `PersonalizationWebSocket`, `RegionTrend`, `DecisionRing`, `LearnStats`, `RateLimiter`
- **Scheduled and queue jobs:** the monitor, the hourly fold, the day report, the erasure rewrite, the trend roll-up, and the ledger consumer
- **Also:** the middleware and the SDK

| Part | Files | Lines |
|---|---:|---:|
| Engine source the trace reaches | 119 | 27,792 |
| Engine files in the register (adds the SDK, console, types, configuration, engine scripts and the two schema migrations) | 155 | 33,591 |
| Source the engine never imports: demos, the chat agent, demo and legacy routes and services | 90 | 38,059 |
| Public demo pages and scripts (storefront, `/live`, `/meridian`, visual demo, Revenue Radar, landing page) | 32 | about 30,700 |
| Public legacy operator pages, replaced by `/console/` (`tuning.*`, `learning.*`, `legacy/`) | 6 | 2,059 |
| Public demo images and media (`public/images`, `public/live`, `public/meridian`) | | about 72 MB |
| Demo migrations and seeds (`0001`–`0009`, `migrations/seed/`) | 20 | about 22,000 |

**Only three database tables belong to the engine:** `operator_accounts`, `operator_sessions` and `operator_audit`, created by migrations `0010` and `0011` and read by `src/auth/store.ts`. Every other D1 table is demo data.

**Bindings.** The engine needs `CACHE` and `SESSIONS` (KV), `STORAGE` (R2), `EVENT_QUEUE` and its dead-letter queue, `ANALYTICS`, `DB`, `ASSETS` and the six Durable Objects above. `BROWSER`, `OpalAgent` and `MERIDIAN_REFLEX` are demo only, and so are the `GEMINI_*` and `BRIGHTHOUR_*` settings. `StateManager` is legacy.

**Dependencies.** The engine uses `hono`, `jose`, `zod` and, behind the experimentation connector, `@optimizely/optimizely-sdk`. These are demo only: `ai`, `@ai-sdk/google`, `@ai-sdk/react`, `@cloudflare/ai-chat`, `agents`, `@cloudflare/puppeteer`, `react` and `react-dom`. So are the `optly` scripts in `package.json`.

### 2.3 The eight tangles

| # | Where | What it pulls in | Direction of the fix |
|---|---|---|---|
| 1 | `src/demos/registry.ts` is imported by seven engine files: `content/service.ts`, `durable-objects/ShopperReflex.ts`, `identity/history.ts`, `identity/link.ts`, `routes/realtime.ts`, `routes/sort.ts`, `services/RealtimeSegmentEngine.ts` | The demo "surface" concept (`coach` or `brighthour`). Through dynamic imports it also pulls the Bright Hour catalog (a 10,311-line JSON file), its offer lifecycle and its demo clock. | Config and catalog resolution becomes per tenant inside the engine (`tenancy`, `configStore`). The engine loses the surface concept. The demos keep their own registry. |
| 2 | `src/reflex/configStore.ts` | A dynamic import of `src/demos/brighthour/reflexConfig.ts`; `DEFAULT_SCOPE = 'coach'` (line 54) | One generic compiled default. A demo loads its tuning as stored configuration. |
| 3 | `src/services/CatalogService.ts` | `src/data/coach-catalog.json`, bundled into the worker as *the* catalog | The catalog comes from the stored catalog. Import and pull routes already exist in `routes/content.ts`. |
| 4 | `src/services/RealtimeSegmentEngine.ts` and `src/routes/operator.ts` `/insights` | `src/data/seed-audiences.ts` and `src/data/insights.json` | Audiences start empty or come from the audience generator. Demo seeding moves to the demos. |
| 5 | `src/connectors/SignalProvider.ts` | `src/data/signals.json` (mock trend feed) | The mock becomes a test fixture. The live provider stays behind the connector. |
| 6 | `src/routes/realtime.ts` and `src/routes/operator.ts` | `POST /realtime/demo/trigger`, `captureDemoEvent`, `services/demoEventCapture.ts`; `/operator/events/reset` and `/events/stats` read the demo `demo_events` table | Removed from the engine routers |
| 7 | `src/routes/geo.ts` | `GET /geo/cohort` → `services/geo/cohort.ts` (demo cold start over synthetic purchases) | `GET /geo` stays. The cohort route stays with the demos. |
| 8 | Built-in demo brand | `DEFAULT_TENANT = 'coach'` (`src/tenancy/tenant.ts:36`). The default tenant's KV keys have no prefix. Session and audience `surface` fields default to `coach`, and `TREND_ROLLUP_TENANTS = "coach"`. | A stamp must name its tenants, with no brand built in. A tenant called `coach` is still allowed as data. |

**The entry point is also mixed.** `src/index.ts` mounts 15 demo or legacy route groups plus the Agents router, and exports `OpalAgent` and `MeridianReflex`. `src/types/env.ts` declares the demo bindings. In enforced mode, `src/index.ts:179-198` already answers 404 for most demo paths. That hides the demos in a shared build; it does not remove them.

---

## 3 · What "deploy for one customer" requires

**The target.** An engineer who did not build the engine runs a documented sequence against a Cloudflare account. It creates a stamp for one customer without editing committed files. It ends with a healthy stamp, an operator who can sign in, a site key, and a first decision served to a test page. The same sequence can be run again safely and can add a second brand.

**Today.**

- **Configuration.** `wrangler.toml` declares three environments: the demo worker, `staging` and `production`. Each one declares every binding again, demo bindings included, with one account's resource IDs committed. Every environment serves the whole `public/` folder, demo pages included.
- **Provisioning.** In the working tree, the remediation program has retired `provision-stamp.sh`, `provision-staging.sh`, `setup.sh` and `seed-d1.mjs` as unsafe; each now refuses and exits. `deploy.sh` refuses an unprovisioned environment and builds the Meridian demo bundle on every deploy. `docs/deployment/01-deploy.md` is marked historical and not to be followed.
- **Per-customer settings.** The customer's settings are scattered across `wrangler.toml` variables and secrets: `TENANTS` (JSON), `CORS_ORIGINS`, `AUTH_MODE`, `SDK_KEYS`, `JWT_SECRET`, `IDENTITY_SALT`, `IDENTITY_SECRETS`, `ALERT_WEBHOOK_URL`, `LEDGER_RETENTION_DAYS` and `TREND_ROLLUP_TENANTS`. No single page lists them.

**The requirements.** Most already exist as remediation work packages; this plan orders them rather than repeating them.

| # | Requirement | Existing package or decision |
|---|---|---|
| R1 | **Engine-only build.** The deployed worker contains no demo code, routes, bindings, assets or dependencies. | D01, W01 |
| R2 | **Stamp manifest.** One file per stamp names the account, environment, worker name, tenants and hosts, allowed origins, retention and alert destination. The Wrangler configuration is generated from it. No resource IDs live in the engine repository. | W37, W08 |
| R3 | **Provisioning that can be rerun.** It creates and reconciles resources and adds a brand, never replaces existing secret values, and fails visibly. | W08 |
| R4 | **Engine schema only.** The first migration creates the three operator tables. There are no demo tables or seeds, and a forward migration can be rolled back in a test. | W08, W39 |
| R5 | **No built-in brand.** Tangle 8 is fixed and every stamp names its tenants. | W37, W03 |
| R6 | **One configuration reference.** A `.dev.vars.example` plus a page that lists every variable and secret: required or optional, default, and what it controls. | W39 |
| R7 | **Release from green CI only.** The deployed worker bundle, SDK bundles, console assets and migrations trace to one commit. | W13 |
| R8 | **Operable.** Readiness and liveness checks, the five-minute monitor with an alert destination, and logs that carry no shopper data. | W12, W07 |
| R9 | **First-run runbook.** Tested by someone who did not build the engine, on a fresh account, including teardown. | W39 |
| R10 | **Customer integration kit.** A versioned SDK artifact and an integration guide free of internal references. | W40, W15 |

---

## 4 · Decisions needed before Phase 1

These are yours and leadership's. Each has a recommendation.

| # | Decision | Recommendation and why |
|---|---|---|
| 1 | **Separate engine and demos (D01)?** The choice is separate deployables, or one build with demo parts switched off. | **Separate.** The new repository holds only the engine. Switching demos off in a shared build leaves demo code, bindings and assets inside every customer stamp. |
| 2 | **What is one stamp (D08)?** | **One stamp per customer per environment.** Brands within a customer are tenants of that stamp. Staging and production are separate stamps. |
| 3 | **Git history: full, or a fresh start?** | **A fresh first commit from the baseline.** This repository keeps the full history as the record. The history holds demo assets, customer and pursuit documents and a tracked agent worktree copy, none of which belong in the new repository. |
| 4 | **What goes in?** | The engine worker, operator console, SDK, the engine scripts in register Tier 7, engine tests, and rewritten engine documents (§9). Out: demos, customer and pursuit documents, and the remediation evidence archive. |
| 5 | **How do the demos keep working after the cut?** | **They keep a frozen copy of the engine code here at the baseline and keep working as today.** Later they call a deployed stamp through the SDK and API. Nobody edits two live copies of the engine. |
| 6 | **Where does the remediation program live after the cut?** | Open work packages move to the new repository as customer-neutral issues. The tracker, evidence, and documents 35 and 36 stay here as the record, because they name customers and contract terms. |
| 7 | **When is the cut?** | **During a short pause in remediation work.** The remediation owner commits, the baseline is tagged, and engine changes then happen only in the new repository. |
| 8 | **Name, GitHub organization, visibility, owners, license.** | To be named. `package.json` currently declares the MIT license, which needs a deliberate decision for internal code. |
| 9 | **Keep the CDP and experimentation integrations?** | **Keep** the ODP loop and the live Optimizely decision provider as optional connectors behind the existing seams, off by default. |
| 10 | **The old operator pages** (`public/tuning.*`, `public/learning.*`, `public/legacy/`) | **Leave them behind.** `/console/` replaced them. |

---

## 5 · Phases

### Phase 0 · Decide and freeze

- Record decisions 1 to 8.
- The remediation owner commits the working tree, and the commit is tagged as the extraction baseline.
- Run the full test suite on the baseline in a clean worktree. Explain every failure, then fix it or list it as known. Without a known baseline, nobody can tell whether a later split broke something.
- Fix the harness so the `node:test` files under `scripts/` run under `node --test` and vitest stops collecting them.

**Done when:** decisions are recorded, the baseline is tagged, and its test results are explained.

### Phase 1 · Untangle in place (this repository)

- **Cut the tangles.** Fix the eight tangles in §2.3. Do tangles 1 and 8 together because both change how a tenant's configuration and catalog are found. Tangles 2 to 7 are independent of each other.
- **Split the entry point.** Give the engine its own worker entry, with only engine routes, objects and jobs. Keep the current `src/index.ts` as the demo worker, which mounts the engine plus the demos.
- **Add the extraction check.** Write `scripts/extraction-check`. It copies only the engine files into an empty temporary folder, then runs install, typecheck, lint and tests there. Run it in CI. This check is what lets several engineers untangle in parallel and know they are done.
- **Keep demo behavior unchanged.** Run the demo rehearsal scripts before and after.

**Why in place:** each tangle is small, and the demos must keep working. Proving the engine builds alone before anything moves is cheaper than finding out in the new repository.

**Done when:** the extraction check is green in CI, the demo rehearsals pass, and enforced-mode behavior is unchanged.

### Phase 2 · Cut the repository

- **First commit.** Copy the engine file list from the baseline into the new repository as its first commit.
- **Configuration.**
  - A `package.json` with engine dependencies only.
  - A `wrangler` template generated from a stamp manifest, with no committed IDs.
  - One migration for the three operator tables.
  - `.dev.vars.example`.
  - Lint with a warning budget that only goes down.
- **Documents and ownership.** `README.md`, `CONTRIBUTING.md` and `CODEOWNERS`.
- **CI.** Lint, typecheck, tests and the SDK build. Add a name check that fails the build on any customer or people name, or any demo brand name outside test fixtures.

**Done when:** a fresh clone installs, lints, typechecks, builds the SDK and passes tests in CI. Running locally serves the console and a decision for a local tenant.

### Phase 3 · Make every file readable (new repository)

Work through [the register](05-engine-file-review-register.md) in tier order, one owner per file, using the definition of done in §7. Splits are their own changes, with no behavior change, and tests pass before and after. Tier 1 comes first because every engineer joining needs it.

**Done when:** every register item is ticked and second-read.

### Phase 4 · Deploy for one customer (new repository, alongside Phase 3)

Deliver R1 to R10 from §3.

**Done when:** an engineer who did not build it creates a stamp for a test customer on a fresh Cloudflare account from the runbook alone. They sign in, issue a site key, serve a first decision to a test page, add a second brand, rerun provisioning with no damage, and tear the stamp down.

---

## 6 · Workstreams and how to staff them

**Sizes are provisional:** **S** is a few days for one engineer; **M** is one to two weeks for one engineer; **L** is several engineer-weeks and can be split across people.

| Workstream | Scope | Starts after | Parallel work inside it | Size |
|---|---|---|---|---|
| **A · Lead** | Phase 0, decisions, cut timing, file ownership, merge order, the register | now | one person | ongoing |
| **B · Untangling** | Tangles 1 to 8, engine entry point, extraction check | Decisions 1, 4, 5 | tangles 1 and 8 together, 2 to 7 independently | M |
| **C · Repository and CI** | Phase 2 scaffold, dependency trim, harness split, name check, lint budget | B | one or two people | S–M |
| **D · File readability** | Register tiers 1 to 7 | C | many engineers, one owner per file | L |
| **E · Deployment** | R1 to R9, delivering W08, W37, W39, W13, W12 | Decisions 1, 2; C | provisioning, stamp manifest, schema and runbook can split | M–L |
| **F · Documentation** | The document set in §9 | C; stays in step with D | per document | M |
| **G · SDK and console** | R10 and W40: versioned SDK artifact, console assets shipped with the worker, console tests | C | SDK and console separately | M |

**Working rules:**

- **One file, one owner at a time.** This already applies here, and it becomes a CODEOWNERS and claim rule in the new repository.
- **No mixing.** A split, a rename or a comment rewrite is never combined with a behavior change.
- **Engine changes land in one place.** After the cut, that place is the new repository.
- **Keep the check green.** The extraction check (Phase 1) and the name check (Phase 2) stay green on every change.

---

## 7 · What "done" means for one file

A file is done when all nine are true:

1. **Header.** The top of the file says what it is for, who calls it, what it calls, and the rules it must keep. A file path alone is not a header.
2. **Every export has a comment** saying what it takes, what it returns and what happens on failure.
3. **Plain reasons, not internal labels.** Each `CW10`, `W09.06`, `doc 22 §15` or `ledger 20 row 9` is replaced by the reason it stands for. Link a document only if that document ships in the new repository.
4. **No customer, prospect or people names.** Demo names (`coach`, `brighthour`, `meridian`) appear only as test fixture data, never as defaults or types.
5. **Size.**
   - Over 500 lines: split by responsibility, or state in the header why it stays whole.
   - A function over 80 lines: split it, or say why not.
   - Factory functions that build and return a client, such as `createCore`, `createEmit` and `createListen` in the SDK, are judged by their inner functions.
6. **No dead code.** Exports nothing imports are removed or justified.
7. **Tested.** A test covers the file. Test titles describe the behavior checked ("rejects a refresh token used as an access token"), not a work-package ID; 308 test titles carry one today.
8. **Lint clean.** No warnings in the file.
9. **Second reader.** An engineer who did not write the file reads only the file and can explain it back in two minutes. If they cannot, it is not done.

---

## 8 · What the register found

| Tier | What it covers | Files | Lines | Over 500 | Functions 80+ | No header | Exports with a comment | Internal references | Outside names |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Decision path | 26 | 9,248 | 7 | 16 | 6 | 106 / 177 | 284 | 15 |
| 2 | Tenants, access, accounts, identity, consent | 28 | 4,420 | 1 | 6 | 10 | 63 / 169 | 23 | 3 |
| 3 | Configuration and catalog | 13 | 3,278 | 1 | 3 | 2 | 60 / 119 | 105 | 3 |
| 4 | Learning, ledger, measurement | 28 | 6,330 | 2 | 5 | 1 | 152 / 361 | 79 | 7 |
| 5 | Connectors, audiences, operator API | 15 | 3,762 | 2 | 1 | 2 | 32 / 62 | 57 | 1 |
| 6 | SDK and console | 21 | 4,092 | 2 | 14 | 2 | 16 / 64 | 25 | 0 |
| 7 | Operations, scripts, schema, configuration | 24 | 2,461 | 0 | 1 | 5 | 5 / 11 | 52 | 3 |
| | **All** | **155** | **33,591** | **15** | **46** | **28** | **434 / 963** | **625** | **32** |

**The hardest files are the first ones a new engineer opens.** Tier 1 holds the seven largest engine files:

| File | Lines | What makes it hard | Proposed split (the owner confirms by reading) |
|---|---:|---|---|
| `src/durable-objects/ShopperReflex.ts` | 1,490 | `ingest` 260 lines, `fetch` 232, `alarm` 103 | Request dispatch · ingest pipeline · alarms and expiry · identity absorb and import. The class becomes a thin dispatcher. |
| `src/services/RealtimeSegmentEngine.ts` | 1,280 | `processAction` 237 lines; two more functions over 100 | Attribute updates · audience seeding · the action pipeline · session from cookies |
| `src/services/SessionManager.ts` | 971 | No header; `createOrUpdateSession` 139 lines | Session schema · create and update · identity absorb and import · cookies · preferences |
| `src/routes/realtime.ts` | 875 | No header; `POST /action` 160 lines; the demo trigger lives here | Socket upgrade · action ingest · read endpoints. The demo trigger leaves. |
| `src/routes/decisions.ts` | 765 | 30 routes and 49 internal references in one router | Five routers under `/v1/:tenant`: shopper snapshot · learning · ledger and erasure · reports · trend and monitor |
| `src/reflex/configStore.ts` | 518 | Demo import and demo default (tangle 2) | Validation · storage and revisions |
| `src/reflex/core.ts` | 517 | The scoring math; well commented, 16 internal references | Probably stays whole; replace the references and record why in the header |

`src/content/decide.ts` is only 327 lines, but 255 of them are one function, `decideContent`. `src/reflex/contentCompose.ts` has a 195-line function. In Tier 4, `src/learn/report.ts` (909 lines) and `src/learn/hourly.ts` (829) are the ones to split. In Tier 6, `createCore` in `src/sdk/core.ts` is a single 519-line factory.

---

## 9 · Documents

**Carry forward, rewritten.** Remove internal references and customer names, and check each against the code.

| Today | State | In the new repository |
|---|---|---|
| `README.md` | Describes an older, generic product | Rewrite: what the engine is, a five-minute local start, where to go next |
| `ONBOARDING.md` | The best map of the engine today, but written for an agent rebuilding it elsewhere; 29 internal references, customer names | `ARCHITECTURE.md` and `CONTRIBUTING.md` |
| `docs/api/01-rest-endpoints.md`, `02-websocket-protocol.md` | Short; few internal references | API reference, checked route by route |
| `docs/kit/00`–`04` | Integration kit; customer names in 00, 01, 02 and 04 | SDK integration guide and payload reference |
| `docs/architecture/16-edge-affinity-reflex.md` | Engine math; 14 internal references | Design reference: scoring |
| `docs/architecture/18-content-affinity-engine.md` | Content engine design; 11 internal references, 10 customer names | Design reference: content decisions |
| `docs/architecture/22-outcome-learning-design.md` | 1,112 lines, 59 internal references | Split into ledger, statistics and reporting references |
| `docs/architecture/25-identity-stitching.md`, `30-operator-credentials-and-invitations.md` | Design and operation | Design references: identity, operator accounts |
| `docs/architecture/31-load-test-2026-09-05.md`, `32-latency-numbers.md` | Measurements from one environment | Performance notes, dated, with the method to rerun them |
| `docs/Edge-Affinity-Reflex-Technical-Design.md` | Plain-language engine explainer | Folded into `ARCHITECTURE.md` |

**Stay here.** Customer and pursuit documents, demo runbooks, documents 19 to 21 and 23 to 29 (delivery ledgers and session handshakes), documents 33 to 36 and `docs/remediation/` (the audit and its record), and `docs/handover/`.

**New.**

- A one-page architecture overview with a diagram of the decision path, every box explained
- A glossary
- The configuration reference (R6)
- The stamp runbook (R9)
- The operator console guide
- Short decision records for the choices an engineer will question: deterministic serving, the two hosts, the ledger design, and tenancy per stamp

---

## 10 · Risks

| Risk | What prevents it |
|---|---|
| Two copies of the engine drift apart | After the cut, engine changes land only in the new repository; the demos here run a frozen copy (decision 5) |
| Readability work collides with remediation work on the same files | One owner per file; the cut happens during a pause; a split is never mixed with a fix |
| A split changes behavior by accident | Known test baseline first (Phase 0); splits carry no logic change; tests pass before and after |
| Hidden demo dependence through data, not imports (KV keys, audience keys and config scopes that assume `coach`) | The extraction check runs the tests with the demo folders absent; tangle 8 removes the built-in brand |
| The existing staging and production stamps hold data under the unprefixed default-tenant keys | Deploy new stamps from the new repository. Existing stamps keep running from this repository until they are retired, or until a data migration is written and tested. |
| Customer names leak into the new repository's history | Fresh first commit (decision 3) and the name check in CI from the first commit |
| "Extracted" is heard as "ready" | This plan says it plainly, and document 35's gates stay the readiness authority |

---

## 11 · Start here

1. Record decisions 1 to 8 (§4).
2. The remediation owner commits the working tree, and the baseline is tagged.
3. Run and explain the test suite on the baseline, and fix the `node:test` collection.
4. Write the extraction check.
5. Start tangles 1 and 8 together; hand tangles 2 to 7 to separate engineers.
6. Name the repository and its owners, then scaffold it (Phase 2).
7. Assign Tier 1 files in the register to owners.

---

**How the numbers were measured.**

- **Engine files:** a runtime import trace from the routes, objects and jobs listed in §2.2.
- **Function lengths and export comments:** the TypeScript parser.
- **Header presence, internal references and names:** text counts.
- **Line counts:** include blank and comment lines.
- **Build health:** `npm run typecheck`, `npm run lint` and `npx vitest run` on this machine against the working tree described in §2.1.

All of these are a snapshot. Regenerate the register on the baseline commit before Phase 3.
