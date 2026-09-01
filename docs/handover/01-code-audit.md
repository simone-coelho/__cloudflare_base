# Auditor 1 — Code-State Audit

Scope: full repo, read-only, evidence cited as `path:line`. Commands run: `npx tsc --noEmit`, `npx vitest run`, `npx eslint src --ext .ts`, plus `git ls-files` / `git grep` / `wc -l` / `find` / `du`. Nothing was started, deployed, installed, or committed. `.claude/`, `.wrangler/`, `node_modules/`, `.git/` were skipped except where noted (git-tracking checks and total size only).

This repo is under active multi-agent development: 10 `.claude/worktrees/agent-*` directories exist as of this audit (9 untracked, from other concurrent sessions; 1 — `agent-a96c30a326d3da233` — accidentally committed to git, see §6). Figures below are a snapshot as of 2026-08-29.

---

## 1. Top-level map

| Path | What it is | Owner |
|---|---|---|
| `src/index.ts` | Hono app entrypoint, route mounting, Worker `fetch`/`scheduled`/`queue` exports | Shared |
| `src/routes/` (21 files) | HTTP route handlers: `auth`, `api`, `tracking`, `pixel`, `webhook`, `cdp`, `operator`, `realtime`, `ai*`, `shot`, `geo`, `funnel*`, `experiment`, `signals`, `health` = shared/Coach infra; `live.ts`/`liveOps.ts` = Bright Hour (QVC) data plane | Mixed (mostly shared) |
| `src/services/` (18 files) | `OptimizelyService`, `CDPService`, `EventDispatcher`, `SessionManager`, `RealtimeSegmentEngine`, `FeatureVariableManager`, `CatalogService`, `PixelDecoder`, `cmab`/`optimizelyFx`/`experimentFx`/`experimentRun`/`experimentScenarios` (A/B+CMAB workstream), `odpLoop`, `sceneGen`, `funnel/*`, `geo/cohort.ts` | Shared |
| `src/durable-objects/` | `StateManager`, `RateLimiter`, `PersonalizationWebSocket`, `ShopperReflex` (Coach's per-shopper reflex host) | Shared |
| `src/reflex/` | The affinity-scoring engine core (`core.ts`, `audienceGenerator.ts`) + its own test suite | Shared (imported, never forked — see §3) |
| `src/connectors/` | CDP/experimentation connector seam (`DecisionProvider`, `SegmentProvider`, `SignalProvider`, `AudienceAuthoring`, `AudienceStore`) | Shared |
| `src/demos/brighthour/` (18 files) | The Bright Hour — QVC live-shopping demo (catalog, composer, offer desk, geo cohort, experiment, demo clock) | QVC demo |
| `src/demos/meridian/` (34 files incl. 5 `.mjs` build scripts) | Meridian/Calder — the Opticon retail+financial demo (catalog, composer, layout, search, geo cohort, concierge, funnel, reflex config) | Meridian/Opticon demo |
| `src/demos/registry.ts` | The shared seam that resolves `coach` vs `brighthour` per-event and late-binds brighthour modules so Coach never evaluates them | Shared |
| `src/agents/` | `OpalAgent` (Cloudflare Agents SDK chat DO) + tool definitions | Shared |
| `src/middleware/`, `src/types/`, `src/utils/` | Auth, error, rate-limit, request-id middleware; `Env`/event types; context/pixel utils | Shared |
| `public/storefront.html` + `storefront.js` | Coach retail storefront (flagship demo) | Coach demo |
| `public/visual-demo.html` + `visual-demo.js` | **First National Bank** demo page (no dedicated `src/demos/` backend — rides the generic `/api`, `/realtime`, `/cdp` routes) | Banking demo |
| `public/index.html` + `demo.js`/`scenarios.js`/`optimizely-content.js`/`ab-cmab.js` | Generic "Edge Platform" landing/demo page, older/parallel to storefront | Shared/legacy demo |
| `public/operator-console.html/js` | Coach merchandising × Opal operator console | Coach demo |
| `public/revenue-radar.js`, `docs/REVENUE-RADAR-*.md` | "Revenue Radar" checkout-funnel demo (funded by `migrations/0003`, `src/services/funnel/*`) — a distinct demo per `ONBOARDING.md` §1, grouped with banking | Revenue Radar demo |
| `public/opal-chat.js` + `island/opal-chat.tsx` | Opal chat widget (React island, built via `scripts/build-island.mjs`) | Shared |
| `public/live/` (`index.html`, `live.js`, `live.css`, `ops.html`, `ops.js`) | The Bright Hour storefront + Offer Desk operator UI | QVC demo |
| `public/meridian/` (page title "Calder") | Meridian client: `meridian.js`, `engine.bundle.js` (esbuild output of `src/demos/meridian/client-engine.ts`, committed deliberately unminified — see `scripts/build-meridian.mjs:18`), `beats.js`, `moments.js`, `layout.js`, `compare.js`, `surfaces.js` | Meridian/Opticon demo |
| `data/`, `data/synthetic/` | Coach catalog schema/JSON + synthetic customer/event fixtures; **also contains a committed SQLite cache DB** (see §6) | Mixed |
| `migrations/` + `migrations/seed/` | D1 schema (8 numbered migrations) + 11 seed files (~22K lines, mostly generated) | Shared DB, demo-partitioned tables — full map in §7 |
| `scripts/` | Build (`build-meridian.mjs`, `build-island.mjs`), data generation (`generate-synthetic-data.mjs`, `generate-bh-images.mjs`), seeding (`seed-d1.mjs`, `seed-funnel.mjs`), rehearsal/isolation checks (`meridian-rehearsal.mjs`, `meridian-isolation.mjs`) | Shared/tooling |
| `docs/architecture/` | Numbered technical spec series (00–19) + `legacy/` archive; mixed shared-engineering and customer-pursuit content — full split in §8b | Mixed |
| `docs/qvc/`, `docs/nyt/`, `docs/pizzahut/`, `docs/opticon/` | Pursuit/presenter docs, one folder per demo/pitch | Pursuit docs (see §8b) |
| `docs/*.md` (top-level, ~65 files) | Mostly customer-named (Tapestry-*, Verizon-*, ASOS-*) or commercial (GTM, pricing, legal) docs; some generic (`README.md`, `SOLUTIONS_ARCHITECT_GUIDE.md`) | Mixed — full split in §8b |
| `examples/` | Generic Optimizely API reference docs/screenshots **plus one customer PRD** (`crepe-prd-v2.md`, for **HD Supply** — a customer name not in the original brief's list; see §8b) | Mixed |
| `optimizely-mcp-docs/` | Vendored docs for the `optly` CLI/MCP tool (unrelated to the Worker app) | Reference, not app code |
| Root `.md`/`.txt`/`.html` dumps (`llms.txt`, `saas1.html` 728KB, `saas_llms.txt`, `feature-experimentation.txt`, `optimizely-data-platform.txt`, `pr.txt`, `recommendations.txt`, `web-experimentation.txt`, `optimizely-banking-architecture.html`) | Scraped/reference material, not imported by any source file (verified: no `src/`/`public/` reference to these paths) | Reference, not app code |
| `ONBOARDING.md` | A **different** bootstrap doc: instructions for an agent replicating this platform's design into a separate open-source project. Names an explicit "never-carry" list (§9) that substantially overlaps with, but is not identical to, this audit's push question (open-source vs. Optimizely-internal have different bars) | Shared, high-value |
| `.claude/worktrees/` | Agent worktree scratch dirs. One (`agent-a96c30a326d3da233`) is **committed to git** — a full stale repo snapshot, 96 files, see §6 | Hygiene issue |

---

## 2. Module-size table (files >500 lines)

### `src/**/*.ts`

| Lines | File |
|---:|---|
| 2037 | `src/demos/brighthour/composer.ts` |
| 1520 | `src/demos/brighthour/composer.test.ts` |
| 1354 | `src/demos/brighthour/offerDesk.ts` |
| 1065 | `src/services/RealtimeSegmentEngine.ts` |
| 934 | `src/demos/brighthour/experiment.ts` |
| 933 | `src/routes/live.ts` |
| 876 | `src/durable-objects/ShopperReflex.ts` |
| 736 | `src/routes/realtime.ts` |
| 681 | `src/demos/brighthour/surface.test.ts` |
| 671 | `src/demos/brighthour/offerLifecycle.ts` |
| 658 | `src/demos/brighthour/offerLifecycle.test.ts` |
| 632 | `src/demos/meridian/geoCohort.ts` |
| 609 | `src/demos/meridian/funnel.ts` |
| 582 | `src/demos/brighthour/offerDesk.test.ts` |
| 549 | `src/services/geo/cohort.ts` |
| 531 | `src/services/OptimizelyService.ts` |
| 530 | `src/demos/meridian/search.ts` |
| 512 | `src/demos/brighthour/experiment.test.ts` |

### `public/**/*.js`

| Lines | File |
|---:|---|
| 4782 | `public/live/live.js` |
| 4192 | `public/storefront.js` |
| 3514 | `public/meridian/meridian.js` |
| 1178 | `public/visual-demo.js` |
| 1108 | `public/meridian/engine.bundle.js` (generated — see §1) |
| 909 | `public/operator-console.js` |
| 646 | `public/meridian/compare.js` |
| 615 | `public/revenue-radar.js` |
| 570 | `public/meridian/moments.js` |
| 563 | `public/live/ops.js` |

### `*.mjs` (repo-wide)

| Lines | File |
|---:|---|
| 999 | `scripts/generate-synthetic-data.mjs` |
| 596 | `scripts/generate-bh-images.mjs` |

No file in the repo reaches 10,000 lines. But two files are the concrete version of the "nobody can read this" fear, and both are precise, citable cases:

**`public/storefront.js` — 4192 lines, ONE class.** `class CoachStorefront` opens at line 23 and does not close until EOF: **285 methods in a single class in a single file** (verified via `grep -c` on method-signature lines). Individual methods aren't the problem (median is short); the problem is 285 concerns — rendering, cart, PDP, quiz, concierge, A/B readouts, command-palette, toasts, signal-arc, moment-loop, geo cohort fetch — with zero module boundary between any of them. `ONBOARDING.md` (§5, code map) already names this: *"contains the SDK-to-be (~300 lines of connect/emit/listen buried in 4,192 demo lines)"*. **Recommended decomposition** (not applied): pull the connect/emit/listen transport layer out first (it's the one piece another surface would ever reuse), then split by UI region — cart, PDP, quiz/concierge, signal-arc/moment-loop, A/B readout — into one module each communicating through a small shared store object, rather than 285 methods closing over `this`.

**`src/services/RealtimeSegmentEngine.ts` — 1065 lines, 762 of them (lines 303–1065) are ONE class.** Inside it, `processActionEvent` (lines 59–264, verified) is a single 205-line method. Six of the class's methods (lines 637–760) are feature-variable-override CRUD that largely re-wraps `FeatureVariableManager` — a service that already exists as its own file — suggesting a misplaced-responsibility split, not just a size problem. **Recommended decomposition**: extract `processActionEvent`'s body into 2–3 named steps (qualify → score → assemble-update); move the feature-variable-override methods (lines 637–760) onto `FeatureVariableManager` where the same-named concept already lives.

**`src/demos/brighthour/composer.ts` — 2037 lines, ~85 top-level exports.** Well-factored *internally* (one function per concern — `composeHeroBillboard`, `composeDailyDeal`, `composeSpotlight`, `composeDealsRail`, `composeOnAirRail`, `composeCategoryRail`, `composeEventModule`, `composeDiscoveryRail` are each their own function, lines 1062–1685), just all in one file. **Recommended decomposition**: types/interfaces (lines 71–545) → `composer.types.ts`; the eight `compose*` slot functions → one file each under a `slots/` directory; ranking/candidate machinery (546–920) → `ranking.ts`; catalog load + D1 row writing (1931–2037) → `catalog-load.ts`. This is the file most ready to split with the least risk — the seams already exist as function boundaries.

**`src/demos/brighthour/offerDesk.ts` — 1354 lines.** Similar shape to composer.ts: taxonomy constants (61–292) → `taxonomy.ts`; AI-tag proposal/normalize (369–770) → `proposal.ts`; approval workflow (770–1055) → `approval.ts`; status computation (1056–1126) → `status.ts`; KV persistence (1196–1354) → `store.ts`.

**`public/live/live.js` (4782 lines, 200 top-level `function` declarations) and `public/meridian/meridian.js`** (3514 lines, ~129 top-level functions/consts) are the flat-file version of the same problem — not one unreadable class, but zero file-level module boundary across 130–200 functions each. Lower urgency than storefront.js (functions are individually short and named) but the same medicine applies: split by feature area once either file needs its next serious feature.

`public/meridian/engine.bundle.js` is a **build artifact** (esbuild output of `src/demos/meridian/client-engine.ts`, regenerated by `npm run build:meridian`) — deliberately committed unminified per its own build script comment (`scripts/build-meridian.mjs:18`, *"readable on purpose: an engineer in the room may open it"*). Not a hand-written-code decomposition candidate; flagged in §4 only as a generated-artifact-in-git question.

---

## 3. Shared vs. demo boundaries

**The database is ONE D1 instance shared by every demo.** `wrangler.toml:114-118` binds a single `database_name = "coach-demo-db"` — Coach, Bright Hour, Meridian, and Revenue Radar all read/write the same physical D1 database. Isolation is enforced entirely by **table-name prefix discipline**, not by separate schemas or databases: `coach_*` / `odp_*` / `demo_events` / `conversions` / `decisions` (Coach, `migrations/0001`), `funnel_*` (Revenue Radar, `0003`), `geo_census`/`geo_xref` (shared reference layer, `0004`), `bh_*` (Bright Hour, `0006`), `mrd_*` (Meridian, `0007`/`0008`). This is a real architectural fact worth a new engineer knowing up front — there is no per-demo database boundary to lean on.

**The demo-surface registry (`src/demos/registry.ts`)** is the shared seam for Coach vs. Bright Hour: `resolveSurface()` (lines 66-77) defaults to `'coach'` on any absent/unrecognized signal, and Bright Hour's modules are dynamic-`import()`-ed (lines 92-142) so a broken Bright Hour build can never throw on the Coach path. Durable Object bindings for both live in `wrangler.toml:46-69`.

**Meridian is isolated differently: its own Durable Object class, not the registry.** `wrangler.toml:75-77` and `src/demos/meridian/README.md` ("isolation charter") document this explicitly: `REFLEX_HOST` is a single global env var, so routing Meridian through it would put Coach on a DO code path that has never run in production — so Meridian gets `MeridianReflex`, its own class, always used, no shared toggle. The charter enumerates ~10 specific coupling traps (own capture table, own audience-key namespace `mrd:`, own identity `mrd_visitor_id`/`credentials:'omit'`, own reset scope, surface-scoped ODP credentials) and states the isolation rule plainly: *"Everything this demo needs lives in this directory and in `public/meridian/`... nothing in here may be imported by another demo"* — with one stated exception, `src/reflex/core.ts`, imported (not forked) because it's pure math.

**A shared table WAS identified and engineered around once already: `demo_events`.** `migrations/0007_meridian_decisions.sql:1-8` states the reasoning directly: Coach's operator reset runs `DELETE FROM demo_events WHERE source='demo'` with a default scope of "all", which would delete another demo's rows if they lived in the same table — so Meridian's decisions get their own table (`mrd_decisions`) instead. Verified safe in practice: `src/routes/operator.ts:326-336` scopes every DELETE branch to `source = 'demo'`, and the only other writer into `demo_events`, `src/routes/funnel.ts:54`, also hardcodes `source: 'demo'` and is explicitly commented `// Counts as Coach` — so the partition holds.

**A second shared table was NOT engineered around, and the coupling is live.** This is the specific class of bug the brief asked me to verify:

- `migrations/seed/seed_011_geo.sql:32-33` — unconditional, unscoped:
  ```sql
  DELETE FROM geo_xref;
  DELETE FROM geo_census;
  ```
  (contrast with the DELETEs three lines above it, which ARE scoped: `WHERE vuid LIKE 'v-nc-%'`, `WHERE order_id LIKE 'ordnc-%'`.)
- `migrations/0008_meridian_geo_cohort.sql:92-94` upgrades one specific proxy row Meridian depends on — the New York metro (CBSA 35620) — from a "Representative (state-proxy)" value to a real ACS 2024 metro figure, via a narrowly-scoped `DELETE ... WHERE geo_level='metro' AND geo_key='35620' AND source LIKE 'Representative%'` followed by `INSERT OR IGNORE`. It also adds 14 Manhattan/Brooklyn ZIP→metro crosswalk rows Meridian's NYC cohort needs (`0008:99-113`).
- **If `seed_011_geo.sql` is re-run after `0008` has run** (e.g., any "reseed the Coach demo data" or fresh-D1-setup workflow that loops over `migrations/seed/*.sql`, per `seed_011`'s own header comment: *"or via the seed loop: for f in migrations/seed/*.sql; do wrangler d1 execute … --file="$f"; done"*), `DELETE FROM geo_census;` wipes 0008's real NY-metro row, and `seed_011`'s own re-insert (`seed_011_geo.sql:116`) puts the **old** `'Representative (NY state ACS 2023 / Zillow 2025 proxy)'` row straight back — silently reverting Meridian's upgrade. Worse for `geo_xref`: `seed_011` only re-inserts a single token ZIP for New York (`'10001'`, line 158) — 13 of Meridian's 14 Manhattan/Brooklyn ZIPs (`10003, 10011, 10012, 10013, 10014, 10016, 10021, 10023, 10024, 11201, 11215, 11217, 11231`) are deleted and **never restored** by the seed. Meridian's NYC geo-cohort (`0008`'s own verify query expects N=320 across those 14 ZIPs rolling up to metro 35620) would silently degrade to whatever 1 ZIP's shoppers can supply, with no error anywhere.
- The risk is **asymmetric**: re-running `0008` after `seed_011` is safe (it's `INSERT OR IGNORE` + one narrowly-scoped DELETE); re-running `seed_011` after `0008` is destructive. `0008`'s authors clearly designed defensively for this (see its own header comment, lines 14-22, "SHARED-DATA EXCEPTION"); `seed_011` (written earlier, for Coach alone) was not.
- Recovery is not automatic: `0008` is a tracked D1 **migration** (`wrangler.toml:100-102`, tag `v5`), so `wrangler d1 migrations apply` will not re-run it once applied — fixing a clobbered geo table requires someone to remember to manually re-run `wrangler d1 execute --file=migrations/0008_meridian_geo_cohort.sql`, which is not part of any documented reseed step I found.

**Recommendation**: scope `seed_011_geo.sql:32-33` the same way its neighboring DELETEs already are (e.g., `DELETE FROM geo_census WHERE source NOT LIKE 'Representative%' OR geo_key NOT IN (<Meridian's keys>)` is fragile; better: give `seed_011` the same `INSERT OR IGNORE`-plus-narrow-DELETE shape `0008` already uses, or split `geo_census`/`geo_xref` seeding into its own idempotent, demo-agnostic seed file that neither demo's reseed script touches).

---

## 4. Code-quality findings

**TODO/FIXME/HACK/XXX: 1 hit in the entire tracked repo**, and it's in a doc, not code (`docs/opticon/Opticon-Task-List.md:206`). This is not "no debt" — `ONBOARDING.md` §6 ("Known divergences") is where debt is actually tracked: 9 enumerated items with file:line citations (e.g., visit-counting bug at `SessionManager.ts:121`; purchases not forwarded to CDP, `odpLoop.ts:82-104`; operator routes unauthenticated, `index.ts:47-71`). Worth knowing before assuming "no TODOs" means "no debt" — it means debt lives in one doc instead of inline comments.

**`console.*` calls**: 220 in `src/`, 65 in `public/`. No logging abstraction exists anywhere in `src/` (the one `logger` hit is the Optimizely SDK's own `optimizely.logging.createLogger`, `OptimizelyService.ts:228` — not repo code). Top offenders: `src/services/OptimizelyService.ts` (22), `src/demos/meridian/build-content.mjs` (18), `src/routes/realtime.ts` (12), `src/services/SessionManager.ts` (10), `src/routes/api.ts` (10), `src/durable-objects/PersonalizationWebSocket.ts` (10); client-side `public/optimizely-content.js` (18), `public/visual-demo.js` (12).

**`any` usage in `src/*.ts`**: 172 instances. Top offenders: `OptimizelyService.ts` (20), `optimizelyFx.ts` (14), `src/demos/meridian/routes.ts` (14), `EventDispatcher.ts` (9), `src/routes/shot.ts` (9).

**`@ts-ignore`/`@ts-nocheck`/`eslint-disable`: only 5**, all narrowly-scoped `eslint-disable-next-line` comments (`src/services/geo/cohort.ts:372,376,380,384`, `src/demos/brighthour/experiment.ts:162`) — low, disciplined usage.

**`docs/README.md` is a broken index: 23 of its 29 linked files do not exist** (79%). Verified by extracting every `](./...)` link and checking each path. Fully missing sections: `docs/deployment/` (README links to 5 files under names like `01-environments.md`; the one file that actually exists there, `01-deploy.md`, doesn't even match the linked name). Mostly missing: `docs/guides/` (4 of 5 links dead), `docs/components/` (4 of 5), `docs/integration/` (4 of 5), `docs/architecture/` (4 of 5, though `01-system-overview.md` is real), `docs/api/` (2 of 4). A new engineer's very first click from the docs index has a 79% chance of a dead link.

**Stray/junk files** (all trivial, all cited): `docs/qvc/Untitled` — untracked, one line of unrelated text ("For the banking demo."), clearly an accidental file. `.npmrc.bak` and `"COMPLETE_ARCHITECTURE_DOCUMENTATION copy.md"` — the latter is byte-identical to `COMPLETE_ARCHITECTURE_DOCUMENTATION.md` (verified via `diff -q`, zero output). `public/meridian/_meridian-v1.js.bak` — an old version kept alongside the live file.

**Doc/comment drift**: `wrangler.toml:112` and `scripts/seed-d1.mjs:14` both instruct `--file=migrations/0002_seed_catalog.sql` — that file does not exist (the real file is `migrations/0002_demo_events.sql`). Copy-paste drift from an earlier migration-naming scheme.

**Not a finding (checked and cleared)**: `src/services/` mixes PascalCase (`OptimizelyService.ts`, `CDPService.ts`, …) and camelCase (`cmab.ts`, `odpLoop.ts`, `optimizelyFx.ts`, …) filenames. Verified this is a consistent, meaningful convention, not drift: every PascalCase file exports a class of that exact name; every camelCase file sampled (`cmab.ts`, `odpLoop.ts`) exports only functions/consts, no class.

**Not dead code (checked and cleared)**: `EventDispatcher.ts`'s `transformToSegment`/`transformToAmplitude`/`transformToMixpanel` destinations (lines 48-79) all have `enabled: false` and placeholder credentials (`'your-write-key'`, `'your-api-key'` at line 200) — these read like stubs but the class itself is live (imported by `pixel.ts`, `tracking.ts`, `webhook.ts`); they're inert default extension points, not orphaned code. The placeholder strings are harmless (see §6) but could confuse a first-time reader into thinking a real key belongs there.

---

## 5. Test state

**23 test files, 430 `it()`/`test()` cases** (counted directly via grep — not taken from any doc). All 23 live under exactly three directories: `src/reflex/` (5 files, 56 cases — matches the `ONBOARDING.md` §5 count, which also notes *"an older doc claims 112 — wrong"*), `src/demos/brighthour/` (7 files, 254 cases: `composer.test.ts` alone has 73), `src/demos/meridian/` (11 files, 120 cases). **This is the third distinct test-count figure across this repo's own docs (112 → 56 → now 430) — treat any doc's stated test count as stale on sight; measure it fresh.**

**Zero test files exist for**: `src/routes/*` (all 21 route files — no route/HTTP-layer test coverage at all), `src/durable-objects/*` (no direct DO test — `src/reflex/shopperReflex.test.ts` exists but lives under `reflex/`, not `durable-objects/`), `src/services/*` (no direct test for `OptimizelyService`, `CDPService`, `SessionManager`, `RealtimeSegmentEngine`, `EventDispatcher`, `CatalogService`), `src/connectors/*`, `src/middleware/*`, `src/agents/*`. Coverage is concentrated entirely in the pure-function scoring/composition layer (reflex core, brighthour/meridian composers) — the HTTP and stateful-hosting layers have no automated tests.

**Do the suites run green? No — verified empirically, not assumed:**

- **`npx tsc --noEmit`: clean.** Exit code 0, zero output.
- **`npx vitest run`: fails before executing a single test.** Actual output:
  ```
  MISSING DEPENDENCY  Cannot find dependency 'vitest-environment-miniflare'
  ```
  `vitest.config.ts:9` sets `environment: 'miniflare'`, which requires the npm package `vitest-environment-miniflare`. It is absent from `package.json` devDependencies, `package-lock.json`, and `node_modules/` (confirmed all three). This corroborates `ONBOARDING.md` §5's claim ("harness in this checkout is broken... fix before trusting a green/red signal") — confirmed here by actually running it, not by citing the doc.
- **`npx eslint src --ext .ts`: also fails before linting a single file.**
  ```
  ESLint couldn't find the config "@typescript-eslint/recommended" to extend from.
  ```
  Root cause, `.eslintrc.json:4`: the extends entry is `"@typescript-eslint/recommended"`, missing the required `plugin:` prefix (should be `"plugin:@typescript-eslint/recommended"`). One-line, precisely diagnosed fix.

Net: the two automated quality gates that exist (`npm test`, `npm run lint`) are both currently non-functional out of the box. `npm run typecheck` (`tsc --noEmit`) is the only gate that currently works.

---

## 6. Config and secrets hygiene

**wrangler.toml** (`wrangler.toml`, 158 lines) bindings: KV `CACHE`, `SESSIONS`; R2 `STORAGE`; Queue `events` (producer `EVENT_QUEUE` + consumer, batch config lines 34-39); Browser Rendering `BROWSER` (for `/__shot`); 6 Durable Object classes (`StateManager`, `RateLimiter`, `PersonalizationWebSocket`, `OpalAgent`, `ShopperReflex`, `MeridianReflex`) across 5 versioned migration tags (v1-v5); Analytics Engine `ANALYTICS`; one D1 database `coach-demo-db`; static assets binding `ASSETS`. `[vars]` block (lines 121-143) is all non-secret config (`ENVIRONMENT`, `CONNECTOR_MODE`, `DECISION_SOURCE`, `ODP_API_HOST`, `REFLEX_HOST`, `BRIGHTHOUR_CLOCK_MULTIPLIER`) plus two items worth a second look:
- `JWT_SECRET = "development-secret-key-change-in-production"` (`wrangler.toml:130`) — a real default secret value, hardcoded and committed, even though self-labeled as dev-only. Low severity (it's clearly not a production value and the pattern is common for local dev), but it IS a literal secret string sitting in a tracked file — should move to `wrangler secret put JWT_SECRET` before this ever runs anywhere real, and the placeholder removed from the committed default.
- `OPTIMIZELY_SDK_KEY = "RLCQEiLW3ifgVH5fwuHoo"` (`wrangler.toml:134`) — explicitly commented as NOT secret (the Optimizely datafile it points to is public); no action needed.

**`.dev.vars` key names** (gitignored, confirmed NOT tracked — `git ls-files | grep .dev.vars` returns nothing): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPTIMIZELY_API_TOKEN`, `OPTIMIZELY_PROJECT_ID`, `OPTIMIZELY_ACCOUNT_ID`, `OPTIMIZELY_SDK_KEY`, `OPTIMIZELY_ENVIRONMENT`, `ODP_API_HOST`, `ODP_PUBLIC_KEY`, `OPTIMIZELY_WRITE_ENABLED`, `SHOT_TOKEN`. No values reproduced here per instruction; hygiene is correct (gitignored, not tracked).

**`.env` key names** (also gitignored, not tracked — a *different* tool's config, the `optly` CLI/MCP cache sync, unrelated to the Worker app): `OPTIMIZELY_API_TOKEN`, `OPTIMIZELY_PROJECT_IDS`, `STORAGE_DATABASE_PATH`, plus 18 more sync/pagination/debug flags. Hygiene correct.

**`.env.example`** (tracked, meant to be tracked): every line is commented out with placeholder values (`your-sdk-key-here`, etc.). Clean.

**CRITICAL — a live-looking secret IS committed and tracked.** `.cursor/mcp.json:14` (tracked in git, confirmed via `git ls-files`; `.cursor/` has no `.gitignore` entry):
```
"OPTIMIZELY_API_TOKEN": "2:K0omY...(redacted in this report)...ROYd88jc"
```
This has the exact shape of a real Optimizely personal-access-token (colon-delimited, ~50 chars) — not a placeholder like the `.env.example` entries. The same file also hardcodes a real-looking `OPTIMIZELY_PROJECT_IDS` (`5463296774504448`) and a local filesystem path. **This token is also duplicated** inside the accidentally-committed worktree snapshot at `.claude/worktrees/agent-a96c30a326d3da233/.cursor/mcp.json` (same value, confirmed via direct string grep — 21 more occurrences across `.claude/`, all inside that one committed worktree). Value intentionally NOT reproduced in full above.
**Action needed regardless of the push decision**: rotate this token now (it is already in this branch's git history); add `.cursor/mcp.json` to `.gitignore` (or template it and inject the token via env var at Cursor-launch time); if this repo's *history* (not just a fresh snapshot) moves to the shared repo, it needs history-scrubbing (`git filter-repo`/BFG), not just a future `.gitignore` entry.

**`data/optimizely-cache.db`** (+ `-shm`, `-wal`, `.optimizely-cache.db.lock`) — a 757KB SQLite cache file for the same `optly` MCP tool (`STORAGE_DATABASE_PATH` in `.cursor/mcp.json:16` points straight at it), **tracked in git**. Not a source file, not something that should ever have been committed — it's a local tool cache, and its content wasn't audited further (out of scope, binary). Also duplicated inside the committed worktree.

**`EventDispatcher.ts:200`**: `api_key: 'your-api-key'` — a placeholder inside a disabled default destination (see §4), not a real secret; flagged only so it isn't mistaken for one during a future secret-scan.

**Everything else clean**: no `sk-…`, `AIza…`, `ghp_…`, or `xox[baprs]-…`-shaped strings anywhere in tracked files (checked repo-wide).

---

## 7. D1 migrations state

| Migration | Lines | Creates | Owner |
|---|---:|---|---|
| `0001_d1_init.sql` | 494 | `coach_catalog`, `coach_transactions`, `coach_purchase_items`, `coach_odp_profiles`, `odp_events`, `odp_customers_authenticated`, `conversions`, `decisions`, `meta_attribute_catalog`, view `v_profiles` | Coach core schema |
| `0002_demo_events.sql` | 192 | `demo_events` (shared, partitioned by `source` col — see §3), views `v_demo_profiles`/`v_audience_base` | Shared (Coach-owned, safely multi-writer) |
| `0003_funnel_seed.sql` | 138 | `funnel_seed`, `funnel_live` — **generated by `scripts/seed-funnel.mjs`, header says "DO NOT hand-edit"** | Revenue Radar demo |
| `0004_geo_census.sql` | 71 | `geo_census`, `geo_xref` | **Shared reference layer — the coupling risk, §3** |
| `0005_dimension_enrichment.sql` | 185 | (no new tables) `ALTER TABLE demo_events ADD COLUMN` ×3; correctly `DROP VIEW IF EXISTS` before redefining `v_demo_profiles`/`v_audience_base` (verified — not a bug) | Coach |
| `0006_brighthour_decisions.sql` | 93 | `bh_decisions` | Bright Hour (QVC) — own table |
| `0007_meridian_decisions.sql` | 36 | `mrd_decisions` — header explicitly explains why it's separate from `demo_events` (§3) | Meridian — own table |
| `0008_meridian_geo_cohort.sql` | 408 | `mrd_transactions`, `mrd_purchase_items`; also additive/scoped writes into shared `geo_census`/`geo_xref` | Meridian — own tables + careful shared-table additions |

`migrations/seed/` holds 11 files (`seed_001`…`seed_011_geo`, ~22,125 lines total); most (`002–005, 007–009`) are exactly 2079 lines each, consistent with template-generated synthetic data. `seed_011_geo.sql` (348 lines) is the one with the unscoped-DELETE coupling risk detailed in §3 — it is Coach's, not auto-applied by `wrangler d1 migrations apply` (seeds are run manually/by script, unlike the numbered migrations).

---

## 8. The deliverable

### 8a. Prioritized cleanup checklist

**Must do before pushing to the shared repo**

1. Rotate the Optimizely API token committed at `.cursor/mcp.json:14` (and duplicated in the committed worktree copy) — it is a live-shaped credential in git history today, independent of any push decision.
2. Add `.cursor/mcp.json` to `.gitignore`; replace its committed token with an env-var reference or template.
3. Remove `.claude/worktrees/agent-a96c30a326d3da233/` from git (96 files, a stale full-repo snapshot including its own copy of the leaked token and its own `data/optimizely-cache.db`); add `.claude/worktrees/` to `.gitignore` so this can't recur (9 more such directories exist untracked right now).
4. Remove `data/optimizely-cache.db`, `-shm`, `-wal`, `.optimizely-cache.db.lock` from git; add `data/*.db*` to `.gitignore`.
5. Fix `npx vitest run`: add `vitest-environment-miniflare` (or migrate to `@cloudflare/vitest-pool-workers`, the actively-maintained replacement) so the 430 existing test cases can run at all.
6. Fix `.eslintrc.json:4`: `"@typescript-eslint/recommended"` → `"plugin:@typescript-eslint/recommended"`.
7. Decide and execute the push manifest in §8b (customer-named/pursuit material out; move `JWT_SECRET`'s placeholder out of the committed `wrangler.toml:130` default and into `wrangler secret put`).
8. Fix the dead-file references at `wrangler.toml:112` / `scripts/seed-d1.mjs:14` (`migrations/0002_seed_catalog.sql` doesn't exist; real file is `migrations/0002_demo_events.sql`).
9. Scope `migrations/seed/seed_011_geo.sql:32-33`'s unconditional `DELETE FROM geo_xref; DELETE FROM geo_census;` so re-running it can no longer revert `migrations/0008`'s rows (§3).

**Should do**

10. Delete `.npmrc.bak`, `"COMPLETE_ARCHITECTURE_DOCUMENTATION copy.md"` (byte-identical dupe, verified), `public/meridian/_meridian-v1.js.bak`, `docs/qvc/Untitled`.
11. Rewrite or trim `docs/README.md` — 23 of 29 links are dead (§4); either write the missing files or cut the index down to what exists.
12. Split `public/storefront.js`'s 285-method `CoachStorefront` class and `src/demos/brighthour/composer.ts`'s 2037 lines along the seams identified in §2.
13. Introduce a minimal structured-logging helper for `src/` to replace the 220 ad hoc `console.*` calls (top offenders: `OptimizelyService.ts`, `SessionManager.ts`, `routes/realtime.ts`).
14. Add test coverage for `src/routes/*` and `src/durable-objects/*` — currently zero, despite being the two layers actually exercised in production.
15. Decide whether `public/meridian/engine.bundle.js` (a committed build artifact) should stay committed (current rationale: readable-on-purpose, `scripts/build-meridian.mjs:18`) or move to a build/CI step — currently a judgment call, not a defect.

**Nice to have**

16. Reduce `any` usage in `OptimizelyService.ts` (20), `optimizelyFx.ts` (14), `demos/meridian/routes.ts` (14).
17. Clean up the root-level reference dumps (`llms.txt`, `saas1.html` 728KB, `saas_llms.txt`, etc. — ~1.06MB, confirmed unreferenced by any source file) — relocate to a `reference/` dir or drop from the shared repo; team call, not a defect.
18. Delete the local, gitignored `w31.log`–`w35.log` (up to 1.1MB) — already excluded from git, purely local disk hygiene.

### 8b. Proposed push manifest

Nothing below is a deletion recommendation. Every "stays behind" path remains exactly where it is in this working repo (per the standing rule: never delete another demo's material) — this is only about what crosses into the new shared Optimizely-internal repo.

**Stays behind — unambiguous, customer- or pursuit-named:**

*Tapestry/Coach:*
`TAPESTRY-POC-EXEC-ONEPAGER.md`, `TAPESTRY-POC-TEAM-BRIEF.md`, `TAPESTRY-ROLLOUT-AE-GUIDANCE.md`, `docs/Tapestry-AE-Capabilities-Doc-Validation.md`, `docs/Tapestry-AE-Questions-Answered.md`, `docs/Tapestry-BTI-Deliverables.md`, `docs/Tapestry-BTI-System-Architecture.md`, `docs/Tapestry-CFO-Capability-Doc-Review.md`, `docs/Tapestry-Capability-Breakdown-v2.md`, `docs/Tapestry-Coach-North-Star-Brief.md`, `docs/Tapestry-Content-Personalization-Proposal.md`, `docs/Tapestry-Customer-Obligations.md`, `docs/Tapestry-Implementation-Plan.md`, `docs/Tapestry-Recency-Leads-Addendum.md`, `docs/Tapestry-SOW-Scope-Ask-Decoded.md`, `docs/content-personalization-design-tapestry.html`, `docs/architecture/19-tapestry-delivery-ledger.md`, `docs/architecture/comprend_signal_led_brief.md`, `docs/CPO-Affinity-Model-Answer.md`, `docs/Mandeep-Reply-Email.md`.

*ASOS:* `docs/ASOS-Edge-Personalization-Overview.md`.

*QVC / Bright Hour docs (code stays — this is docs only):* `docs/qvc/BrightHour-Cheat-Sheet.md`, `BrightHour-Demo-Runbook.md`, `BrightHour-Engine-Explainer.md`, `BrightHour-Imagery-QA.md`, `QVC-Business-Intelligence-Dossier.md`, `QVC-Competitive-Measurement-Dossier.md`, `QVC-Demo-Design-Brief.md`, `QVC-Site-Recon-Demo-Design.md`, `README.md`, `Untitled` (junk, §4).

*NYT:* all of `docs/nyt/` (4 files).

*Verizon:* `docs/Verizon-Media-Edge-Perspective.md`, `docs/Verizon-Media-Research-Dossier.md`.

*Pizza Hut docs (code stays):* all of `docs/pizzahut/` (5 files).

*HD Supply — found during this audit, not in the original customer list:* `examples/crepe-prd-v2.md` (its own frontmatter: "for HD Supply"); also referenced in `docs/Coach-Component-Personalization-Field-Brief.md`, `docs/Coach-Conversation-Guide.md`, `docs/Content-Personalization-Explained-Simply.md`, `docs/Edge-Visitor-State-Redis-Counter-Brief.md`, `docs/architecture/14-...capability-map.md`, `docs/architecture/18-content-affinity-engine.md` (mentions only, not primarily about HD Supply — see borderline list below).

*First National Bank:* no dedicated customer document set found (unlike the others, there's no `docs/firstnational/`). It appears only as a fictional demo-bank persona inside Meridian and cross-demo docs. Code stays (`public/visual-demo.html`, `visual-demo.js`).

**Stays behind — Opticon session material** (not a customer name, but bullet 3 of this audit's brief groups it with the pursuit docs, and several files carry real Tapestry-deal specifics, confirmed by mention count): all of `docs/opticon/` (9 files) — `Opticon-Task-List.md` (5 Tapestry mentions), `Opticon-Talk-Track.md` (4), `Opticon-Abstract-Coverage.md` (3), `Opticon-Presenter-Companion.md` (2), plus `Controls-Guide`, `Demo-Design`, `Layout-Spec`, `Run-Of-Show`, `Research-Personalization-Demos` (0 direct mentions but same category).

**Borderline — generic filename/numbering, but centrally about a customer pursuit (owner should review, not auto-include or auto-exclude):**

`docs/architecture/18-content-affinity-engine.md` — the most important one to get right. `ONBOARDING.md` calls this the canonical internal engineering spec (not a sales doc), but its own header names the Tapestry proposal and ASOS overview as "derivatives of this doc" and it references Coach/Tapestry/ASOS/HD Supply by name 5+ times throughout. Recommend a redaction pass (genericize the customer examples) rather than a blanket exclude — the underlying design (content catalog, two-level scoring, delivery contract) is genuinely shared IP.
`docs/architecture/09-optimizely-api-plan.md` (1 Tapestry mention), `11-signal-led-stretch-plan.md` (2), `12-signal-led-moment-build-brief.md` (1), `13-geo-cohort-coldstart-prd-tdd.md` (3, self-labeled "Owner: the SA presenting the Coach/Tapestry renewal"), `docs/architecture/coach_synthetic_schema.json` (low sensitivity — a data-shape doc, not deal terms), `docs/architecture/legacy/05-demo-build-spec-2026-06.md` and `legacy/07-storefront-ux-2026-06.md` (their current, non-legacy counterparts have zero customer mentions — these older archived versions still carry the text that was later cleaned out).
`docs/Content-Personalization-Explained-Simply.md` (9 mentions — highest of this group, but `ONBOARDING.md` §3 lists it as legitimate "optional context"), `docs/PROJECT_LEDGER.md` (5), `docs/DEMO-MASTER-PLAYBOOK.md` (5), `docs/Product-Gaps-Assessment.md` (4 — `ONBOARDING.md` independently flags this as commercial/internal), `docs/Productization-Roadmap.md` (3), `docs/PS-Implementation-Runbook.md` (3), `docs/PS-Implementation-Delivery-Guide.md` (2), `docs/EXPERIMENT-USE-CASES.md` (3), `docs/GTM-Delivery-Playbook.md` (2 — also independently flagged commercial by `ONBOARDING.md`), `docs/MEMO-parallel-build.md` (2), `docs/EXPERIMENT-SURFACE-RUNBOOK.md` (1), `docs/EXPERIMENTATION-DEMO-GUIDE.md` (1), `docs/REVENUE-RADAR-EXPLAINER.md` (5), `docs/REVENUE-RADAR-TDD.md` (3), `docs/REVENUE-RADAR-PRESENTER-GUIDE.md` (1) — note: Revenue Radar is a *different* demo per `ONBOARDING.md` §1; its Tapestry mentions read as incidental cross-references, likely fine to keep after a spot-check.

**Stays behind — commercial-sensitive but not customer-named** (flagged separately from the brief's literal customer list, same underlying concern — pricing/margin data doesn't belong in a shared engineering repo regardless of which customer it's about): `docs/Edge-Unit-Economics.md`, `docs/Opal-Credit-Boundary-Pricing-Guide.md`, `docs/Monetization-Legal-Brief.md`.

**Repo-hygiene excludes (not customer-related, just cruft — see §6/§8a #1-4):** `.claude/worktrees/` (all of it), `data/optimizely-cache.db*`, `.npmrc.bak`, `"COMPLETE_ARCHITECTURE_DOCUMENTATION copy.md"`, `public/meridian/_meridian-v1.js.bak`.

**Team judgment call, not customer-related — reference material with no source-file dependency on it** (verified: nothing in `src/`/`public/` imports or reads these paths): root-level `llms.txt`, `saas1.html`, `saas_llms.txt`, `feature-experimentation.txt`, `optimizely-data-platform.txt`, `pr.txt`, `recommendations.txt`, `web-experimentation.txt`, `optimizely-banking-architecture.html`; `optimizely-mcp-docs/` (vendored `optly` CLI docs, unrelated tool); most of `examples/` (generic Optimizely API reference + screenshots, minus `crepe-prd-v2.md` above).

**Explicitly fine to keep — checked and generic:** `README.md`, `ONBOARDING.md` (genuinely valuable repo map; mentions demo names structurally, not deal specifics — recommend keep, optional light scrub), `COMPLETE_ARCHITECTURE_DOCUMENTATION.md`, `REAL_TIME_PERSONALIZATION_ARCHITECTURE.md` (both verified zero customer-name mentions), `SOLUTIONS_ARCHITECT_GUIDE.md`, all of `src/**`, `public/**`, `migrations/**`, `scripts/**`, and the non-flagged majority of `docs/architecture/` (`00`, `01`, `05`(current), `06`, `07`(current), `08`, `10`, `14`, `15`, `16`, `17`, `Optimizely-Experimentation-MCP-Server-Technical-Reference.md`, `legacy/00`, `legacy/01`, `legacy/06`, `legacy/08`, `legacy/10` — all verified zero customer-name mentions), `docs/api/`, `docs/components/`, `docs/deployment/`, `docs/guides/`, `docs/integration/`.
