# The engine: the facts sheet

**Internal. Research lane S2, 2026-10-02.** The single source of facts for the documents that will explain this
engine to marketing, account executives and semi-technical pre-sales solutions engineers. Writers draw from this
sheet and from nothing else; a fact that is missing goes back to the lead. This is not a customer document.

## How to read this sheet

- **Sources.** Every statement carries one: `path:line` for code, or a document with its section (§) or line.
  Paths are relative to the repository root.
- **Labels.**
  - **Built**: in the code and exercised by tests or by a hosted demo.
  - **Designed**: written in an architecture or planning document, not in the code.
  - **Open**: no decision yet, or the decision belongs to an owner who has not given it.
  - Three more where they help. **Withdrawn**: in the code, switched off by policy. **Demo only**: runs only on
    the demo deployment profile. **Unverified**: this lane could not confirm it from the code or the documents.
- **Code version.** Code is cited at commit `8b4f74c` (2026-10-02); read any line with `git show 8b4f74c:<path>`.
  The shared checkout kept moving while this sheet was researched (`a409fc8` → `2313527` → `8b4f74c` → `22bf36e`).
  `2313527` changed ten engine files: the "complements" slot rule, two named partner outcomes, the regional prior
  on `/sort`, and a paid-search classification; all of it is described here. The commits after `8b4f74c` touched
  only demo, demo-kit and enablement files, plus two new OH demo files in `src`, and changed no cited line. At the
  last check another lane had an uncommitted edit to `src/index.ts` mounting the OH demo's routes, which moves that
  file's later line numbers in the working tree by up to three; the citations here are the commit's.
- **No timing figures.** A duration that is a constant in the code (a decay horizon, a cache lifetime, an
  attribution window) is stated as a constant. Measured latencies exist in two documents (§9.1); this sheet names
  them and quotes none of their numbers.
- **Names.** Tenant ids and demo names appear as the code spells them (`coach`, `shn`, `vantage`). Some file paths
  contain customer names; material written from this sheet for customers must not (the owner's rule: "the
  customer", "this use case"). This sheet describes no customer's own systems.
- **What this lane did not do.** It read code and documents only. It ran no test suite and called no hosted
  worker. Anything that would have needed either is marked unverified.

---

## 0. Words used in this sheet

| Term | Plain meaning | Defined at |
|---|---|---|
| Worker | A program that runs on Cloudflare's network, in the data centre nearest the request | `wrangler.toml:1-4` |
| Durable Object ("object") | A small named program with its own private storage. Exactly one copy exists per name, so it is the single writer for what it holds (one per visitor, one per region, and so on) | `wrangler.toml:48-98` |
| KV | Cloudflare's key-value store: fast reads, eventually consistent writes | `wrangler.toml:7-16` |
| R2 | Cloudflare's file (object) storage | `wrangler.toml:18-22` |
| D1 | Cloudflare's SQL database | `wrangler.toml:138-148` |
| Queue | A message queue: work handed off now and processed moments later, off the request | `wrangler.toml:24-42` |
| Tenant | One brand's isolated space inside a deployment. Every key it owns carries the prefix `t:<tenant>:`, except the default demo tenant `coach`, which is unprefixed | `src/tenancy/tenant.ts:36`, `:156-166` |
| Stamp | One customer's own deployment: one Worker per environment (staging, production), with its own storage | `wrangler.toml:205-214`, `:327-329`; `docs/PS-Implementation-Runbook.md` §2 |
| Deployment profile | `demo` or `customer`; decides which routes and bindings may exist | `src/customerBoundary.ts:3-8` |
| `AUTH_MODE` | `open` or `enforced`; decides whether site keys, operator tokens and the origin allow-list are checked | `src/middleware/edgeAccess.ts:4-12` |
| Dimension, value | An axis the brand scores on (brand, category, price band) and one entry on it (`samsung`) | `src/reflex/core.ts:24-46` |
| Registry | The brand's list of dimensions, the product or event field each one reads, how much each shopper action counts, and the memory settings. It is the `reflex` configuration document | `src/reflex/core.ts:47-97` |
| Touch | One (dimension, value) hit that an event produces | `src/reflex/core.ts:134-138` |
| Raw score R | A running total of touches, each weighted by its action, fading over time | `src/reflex/core.ts:117-121` |
| Interest (the code says "affinity") a | R turned into a number between 0 and just under 1: a = R / (R + K) | `src/reflex/core.ts:295-298` |
| τ (tau) | The memory constant. R fades by the factor e^(−elapsed/τ), so it halves every τ × ln 2 | `src/reflex/core.ts:52-53`, `:289-293` |
| K | How much evidence makes an interest half-strength (a = 0.5 when R = K) | `src/reflex/core.ts:54-55` |
| θ_in, θ_out | The line an interest must reach to join an audience, and the lower line it must fall below to leave. The gap between them (hysteresis) stops a visitor flickering in and out | `src/reflex/core.ts:56-59` |
| Membership (audience) | The flag `<dimension>_<value>_affinity`, held while the interest stays inside the lines | `src/reflex/core.ts:189-192`, `:612-628` |
| Piece | One content item in the brand's catalog, addressed by the brand's own content id (`customerContentId`) | `src/content/types.ts:13-61` |
| Slot, slot strategy | One place on one page that shows pieces; its strategy is its weights and rules | `src/content/types.ts:85-129` |
| ω (slot weight) | How much a dimension counts in a slot, from 0 to 1 | `src/content/kinds.ts:329-333` |
| Pin | A merchandiser forcing named pieces into a slot's first positions | `src/reflex/contentCompose.ts:41-43` |
| Eligibility | Whether a piece may be served at all: its status, window, stock flag and its own rule | `src/content/lifecycle.ts:65-73` |
| Seed | A rule that uses how the visitor arrived (campaign term, channel, referring network, phone OS family) before she has shown interest | `src/content/types.ts:140-192` |
| Regional prior, λ (lambda) | What shoppers in the visitor's region are interested in, blended in while her own evidence is thin. λ is the region's share of the blend | `src/reflex/regionTrend.ts:3-18` |
| Cell | The context a decision was made in: arrival channel, visit-number band, region, leading interest, journey stage | `src/content/types.ts:383-391` |
| Lift, γ (gamma) | Lift: how much better a piece does than its slot's own rate in the same cell. γ: the trust dial (0 to 1) that decides how much lift moves a score | `src/learn/stats.ts:1-6`; `src/content/decide.ts:60-62` |
| Holdout arm | A share of visitors served the site's own defaults (`default`) or personalization without learning (`no_learning`) | `src/content/types.ts:210-221`, `:259-266` |
| Decision record ("receipt") | One record per served position: what was served and the arithmetic behind it | `src/content/types.ts:451-548` |
| Ledger | The append-only store of decision and outcome records, in R2 | `src/ledger/records.ts:1-5` |
| Outcome | A reward-bearing event: click, dwell, video complete, wishlist, add to bag, purchase, or a named custom outcome | `src/ledger/records.ts:108`, `:121-152` |
| Attribution | Crediting an outcome to the decision that earned it | `src/learn/policy.ts:1-4` |
| Day report | The daily attribution diagnostic | `src/learn/report.ts:613-618` |
| Publication set, revision | The coherent, versioned set of a tenant's configuration documents; a revision is one saved version of one document | `src/config/publication.ts:1-2` |
| Operator, operator token | A person with an account and a grant for a tenant; the short-lived signed token (a JWT) they act with | `src/middleware/operatorAuth.ts:10-48` |
| Site key (SDK key) | Identifies the site and binds the tenant on shopper calls; it travels in the page | `src/middleware/edgeAccess.ts:76-121`; `docs/kit/00-README.md:24` |
| Shopper capability | A short-lived token the server signs for one visitor and one session; the browser presents it on every shopper call | `src/identity/sessionCapability.ts:10-25` |
| Session host, object host | The two places a visitor's interest state can live: a record in KV (`session`) or her own object (`do`). `REFLEX_HOST` chooses | `src/types/env.ts:109-112` |
| Generation 1, Generation 2 | The older shared demo pipeline; and the content decision service, which the newest demos and the contracted delivery run on | `docs/demos/BOOTSTRAP.md` §4 |

---

## 1. What it is

**The sentence to check:** "a content decision service that keeps a graded, fading interest per dimension value for
each visitor and scores published content against it at the edge, with everything that moves an answer in
published, versioned documents."

**Verdict: right in shape, with two corrections and three omissions** (table below). The corrected paragraph,
which a marketer can repeat:

> A content decision service. For every visitor who has agreed to it, it keeps a graded, fading interest in each
> value of each dimension the brand chooses to score on, built from what she does on the site. When a page asks,
> it ranks the brand's own published content for each slot on the page against that interest (leaning, where the
> brand turns it on, on what her region is interested in until she has shown interests of her own), and answers
> with the brand's own content ids in order, each with a receipt that shows the arithmetic. It runs on Cloudflare's
> network, calls no AI model to decide, and every setting that can change an answer lives in published, versioned
> documents that a merchandiser changes without a software release.

Wording rule: "calls no AI model to decide" is true and may be said. "We don't use a model" may not: a seam for the
customer's own model exists in the code, withdrawn by policy (`src/content/service.ts:471-479`;
`docs/verizon/explainer/FACTS.md:544`).

| Phrase | What the code says | Source |
|---|---|---|
| "content decision service" | Correct. The service resolves the documents, the visitor's state and the regional prior, then decides. The answer is the brand's content ids in slot order. The same interest also re-orders a product list that a commerce platform supplies (`POST /sort`) | `src/content/service.ts:1-5`, `:333`; `src/reflex/contentCompose.ts:6-9`; `src/reflex/sortCandidates.ts:5-10` |
| "graded" | Correct. a = R/(R+K) is continuous between 0 and 1. Audience membership is a separate yes/no derived from it with two lines | `src/reflex/core.ts:295-298`, `:612-628` |
| "fading" | Correct. R fades exponentially and is computed at the moment it is read, never stored faded; each dimension may have its own τ | `src/reflex/core.ts:11-14`, `:289-293`, `:43-46` |
| "per dimension value" | Correct. State is, per dimension and value, a raw score and the time of the last touch | `src/reflex/core.ts:124-132` |
| "for each visitor" | **Correction: for each visitor who has consented.** Tracking and personalization start off; missing or expired consent means the site's own defaults. State is per visitor id inside a tenant, and two profiles merge on a signed sign-in | `src/content/consent.ts:1-8`; `src/sdk/README.md:258`; `src/tenancy/objects.ts:43-45`; `src/reflex/identityMerge.ts:6-8` |
| "scores published content against it" | Correct, in a fixed order: eligibility and pins first; then the interest sum; then arrival seeds, journey stage, freshness, fatigue, merchandising multipliers and the learned lift | `src/content/decide.ts:202-211`, `:310-390`; `src/reflex/contentCompose.ts:181-247`, `:253-271` |
| "at the edge" | Correct: Cloudflare Workers. The state it reads lives in KV, R2 and objects (§2) | `wrangler.toml:1-4` |
| "everything that moves an answer in published, versioned documents" | **Correction: every setting does; not every input.** Weights, memory, thresholds, slot rules, pins, seeds, learning dials, holdout and regional settings live in the `reflex`, catalog, `slots`, `learn` and `prior` documents. Inputs that also move an answer: the visitor's own events; her region's population counts; the request itself (time, edge region, campaign term, OS family, named conditions); the learned statistics (inert while γ is 0). A few constants are fixed in code (the region's 24-hour memory, ten candidates recorded, four drivers listed). Worker settings (tenants, retention, host, profile) need an engineer (§4.6) | `src/config/publication.ts:11`; `src/reflex/regionTrend.ts:28-30`; `src/content/decide.ts:409`; `src/reflex/contentCompose.ts:321` |
| Omitted: "calls no model to decide" | The external model term is withdrawn from live decisions; the decision function is pure arithmetic with no I/O | `src/content/service.ts:471-479`; `src/content/decide.ts:1-6`; `src/reflex/core.ts:21-22` |
| Omitted: "the site paints" | The engine returns ids, order and reasons; the customer's front end renders | `docs/PS-Implementation-Runbook.md` §1 |
| Omitted: "receipts" | One record per served position, with the arithmetic itemised | `src/content/decide.ts:521-562` |

---

## 2. Where it runs, and the stack

### 2.1 Runtime

- One codebase, one Worker script per deployment, entry `src/index.ts`, built on the Hono web framework with
  Cloudflare's Node compatibility flag (`wrangler.toml:1-4`; `src/index.ts:11`, `:63`). **Built.**
- Every request passes, in order: timing, a request id, standard security headers, the cross-origin (CORS) policy,
  tenant resolution, then the access gates on `/realtime/*`, `/v1/:tenant/*` and `/operator/*`
  (`src/index.ts:65-97`).
- Three entry points: `fetch` (requests), `scheduled` (the crons), `queue` (the ledger consumer)
  (`src/index.ts:197-388`).

### 2.2 Storage and service bindings

| Binding | Kind | What it holds | On a customer stamp | Across the demo workers |
|---|---|---|---|---|
| `CACHE` | KV | What the hot path reads quickly: published regional snapshots `trend:v2:<tenant>:<region>`, published lift snapshots `lift:<tenant>:<brand>:<slot>`, audience definitions, monitor results, job cursors | Its own namespace | Shared: the same namespace id in all three demo configs | 
| `SESSIONS` | KV | Session-host visitor records `session:<id>`, which carry the interest vector; identity link records | Its own namespace | Shared |
| `STORAGE` | R2 | Configuration publication sets and their immutable revisions; the ledger, filed `{tenant}/{date}/{hour}/{stream}/`; hour aggregates; day reports; lift archives; erasure tombstones; demo generated images | Its own bucket | Shared bucket |
| `DB` | D1 | Demo: the default demo tenant's dataset (profiles, commerce, census, demo events) behind the demo chat and the geo cohort. Customer: operator accounts, sign-in sessions, tenant memberships, service credentials, the audit trail and SSO links | Its own database, product migrations only | Shared |
| `EVENT_QUEUE` | Queue and dead-letter queue | Ledger messages (decision sets, outcomes, product-sort receipts, behaviour records) consumed into R2; demo image-generation jobs | Its own pair | Each worker has its own pair |
| `ANALYTICS` | Analytics Engine | Operational monitor points only, and only when a telemetry retention policy admits them; ledger capture to it is held | `edge_ops_<environment>_v1` | Shared dataset `edge_ops_development_v1` |
| `BROWSER` | Browser Rendering | The `/__shot` screenshot route for visual verification, closed unless a token is configured | Must be absent | Present; the route is refused under `AUTH_MODE=enforced` |
| `ASSETS` | Static files | `public/`: demo pages, the SDK bundles, the operator console | Only the console, the SDK files, the operator sign-in script and two redirect pages are served | Each worker serves the whole folder |

Sources, row by row: `CACHE` `wrangler.toml:8-11`, `src/reflex/regionTrend.ts:48`, `src/learn/fan.ts:72`,
`src/connectors/AudienceStore.ts:46`, `src/ops/monitor.ts:560-563`, `src/index.ts:266`; `SESSIONS`
`wrangler.toml:13-16`, `src/services/SessionManager.ts:352-353`, `src/identity/store.ts:1-12`; `STORAGE`
`wrangler.toml:19-22`, `src/config/publication.ts:67-71`, `src/ledger/writer.ts:1-7`, `src/learn/hourly.ts:63`,
`src/learn/report.ts:1286`, `src/learn/fan.ts:74`, `docs/architecture/22-outcome-learning-design.md` §15; `DB`
`wrangler.toml:138-148`, `src/types/env.ts:50-55`, `migrations/product/0010_operator_accounts.sql` to
`0013_operator_oidc.sql`, `docs/deployment/01-deploy.md:42`; `EVENT_QUEUE` `wrangler.toml:25-42`,
`src/index.ts:328-387`, `src/ledger/records.ts:102`, `scripts/build-demo-worker-config.mjs:13-16`; `ANALYTICS`
`wrangler.toml:134-136`, `:310-312`, `:408-410`, `src/ops/monitor.ts:565-567`, `src/ledger/enqueue.ts:1-5`;
`BROWSER` `wrangler.toml:44-46`, `src/routes/shot.ts:17-27`, `src/customerBoundary.ts:10-14`,
`src/index.ts:233`; `ASSETS` `wrangler.toml:190-197`, `src/customerBoundary.ts:132-149`. Shared ids across the
demo configs: `wrangler.vantage.toml:11-24`, `:112-120`; `wrangler.top-offers.toml:11-24`, `:112-120`.

### 2.3 Durable Object classes

| Class (binding) | One object per | What it holds | Customer stamp | Source |
|---|---|---|---|---|
| `StateManager` (`STATE_MANAGER`) | name | A generic get, set and list store with session helpers (legacy) | Omitted | `src/durable-objects/StateManager.ts`; `src/customerBoundary.ts:10` |
| `RateLimiter` (`RATE_LIMITER`) | name | Windowed request counters and the operator sign-in budget | Yes | `src/durable-objects/RateLimiter.ts`; `wrangler.toml:286-288` |
| `PersonalizationWebSocket` (`PERSONALIZATION_WEBSOCKET`) | visitor | The visitor's live socket on the session host, which pushes segment and personalization updates | Yes | `src/routes/realtime.ts:77-90`; `src/durable-objects/PersonalizationWebSocket.ts` |
| `OpalAgent` (`OpalAgent`) | chat session | A demo conversational agent: chat history, a Gemini model, a read-only query tool over the demo D1, gated write tools for Feature Experimentation | Omitted | `src/agents/OpalAgent.ts:18`; `src/agents/tools.ts:46-140`; `wrangler.toml:61-65` |
| `ShopperReflex` (`SHOPPER_REFLEX`) | visitor, within a tenant | On both hosts: her session grants and her consent record. On the object host also: her interest state, her socket, and alarms set for the exact moment an interest will cross its exit line | Yes | `src/identity/consentContinuity.ts:8-45`; `src/routes/realtime.ts:620-633`; `src/durable-objects/ShopperReflex.ts:1-28`, `:1884-1952` |
| `MeridianReflex` (`MERIDIAN_REFLEX`) | visitor of one demo | The Meridian demo's own per-visitor object | Omitted | `src/demos/meridian/MeridianReflex.ts:1-23` |
| `RegionTrend` (`REGION_TREND`) | tenant and region | The region's population interest counts. No visitor ids. Publishes a snapshot to KV on a short coalesced alarm | Yes | `src/durable-objects/RegionTrend.ts:1-6`, `:16` |
| `DecisionRing` (`DECISION_RING`) | visitor | Her last 200 served decisions within 7 days, a 90-day index of decision ids, and the online attribution of her outcomes | Yes | `src/durable-objects/DecisionRing.ts:1-6`, `:36-37`; `src/learn/stats.ts:34` |
| `LearnStats` (`LEARN_STATS`) | tenant, brand and slot | Fading counts of exposures and successes per piece per cell; publishes lift snapshots to KV and archives them to R2 | Yes | `src/durable-objects/LearnStats.ts:1-3`, `:23`; `src/learn/fan.ts:71-74` |

Object classes belong to one Worker script, so each demo worker's visitors and statistics are its own even though
KV, R2 and D1 are shared (`scripts/build-demo-worker-config.mjs:42-47`).

### 2.4 Scheduled jobs (crons) — Built

Declared in `wrangler.toml:228-229`; dispatched in `src/index.ts:253-327`. Each job runs over the worker's own
provisioned tenant list (`src/index.ts:260-262`), so one tenant must never be provisioned on two cron-running
workers (`scripts/build-demo-worker-config.mjs:44-47`).

| Schedule | What runs | Source |
|---|---|---|
| Every five minutes | Quarantine expiry (when recovery is configured); warehouse deliveries; the monitor (a refused default probe plus approved synthetic work, per tenant); the hourly fold of closed hours into aggregates, two hours per run over a 26-hour lookback; day-report retries | `src/index.ts:264-296`; `src/ops/monitor.ts:1-7`; `src/learn/hourly.ts:1703`, `:1785` |
| Every hour | The regional roll-up: each tenant's regions summed into countries and into everyone | `src/index.ts:316-325`; `src/reflex/regionTrend.ts:254-283` |
| 03:00 UTC | Yesterday's day report; the nightly erasure rewrite of the ledger | `src/index.ts:297-315` |

`TREND_ROLLUP_TENANTS` (`wrangler.toml:187-188`) is declared but read by nothing; the roll-up covers every
provisioned tenant (`src/types/env.ts:30-31`; `docs/verizon/Vantage-Demo-Design.md` §12, 2026-10-01 F2/F3 entry).

### 2.5 Deployment profiles and access modes

| Setting | What it changes | Source |
|---|---|---|
| `DEPLOYMENT_PROFILE` missing or misspelt | Every entry point answers 503: a typo can never select the demo deployment | `src/customerBoundary.ts:3-8`; `src/index.ts:209-210`, `:254-255`, `:329-333` |
| `customer` (requires `AUTH_MODE=enforced`) | Only the listed operations answer (99 route patterns, each with its allowed methods), plus the console and SDK files; `/` redirects to `/console/`; demo bindings must be absent or everything answers 503; a tenant list (`TENANTS`) is required; operator authority comes from D1 accounts and memberships; demo routes do not exist; an asserted region never selects the regional prior | `src/customerBoundary.ts:20-166`; `src/index.ts:211-225`; `src/tenancy/middleware.ts:53`; `src/auth/authority.ts:27`; `src/middleware/operatorAuth.ts:17-18`; `src/content/service.ts:322-331` |
| `demo` | Every route is mounted, including the demo routes `/top-offers/api`, `/vantage/api` and `/ops/demo-bootstrap`; an asserted `ctx.region` may select the regional prior and is labelled `asserted`; the automatic audience generator runs, for the default demo tenant only; the legacy ODP and Feature Experimentation connectors apply, for the default demo tenant only | `src/index.ts:131-156`; `src/content/service.ts:447-462`; `src/services/RealtimeSegmentEngine.ts:328`; `src/connectors/config.ts:106` |
| `AUTH_MODE=open` | Site-key and operator gates pass through; CORS reflects any origin unless `CORS_ORIGINS` is set. The shopper capability is still required on shopper routes ("there is no open-mode bypass") | `src/middleware/edgeAccess.ts:4-12`, `:56-67`, `:138`, `:184-188`; `src/sdk/README.md:214` |
| `AUTH_MODE=enforced` | The site key must belong to the resolved tenant on `/realtime/*` and `/v1/:tenant/*`; operator routes need a JWT plus a grant for that tenant; CORS answers only `CORS_ORIGINS`, the same origin and the local dev server; the Generation 1 demo roots answer 404 | `src/index.ts:90-97`, `:226-246`; `src/middleware/edgeAccess.ts:100-153`; `src/middleware/operatorAuth.ts:31-48` |
| Every configuration in the repository sets `enforced` | The `open` default in the code is not used by any checked-in configuration | `wrangler.toml:165`, `:241`, `:340`; `wrangler.vantage.toml:127`; `wrangler.top-offers.toml:127` |
| `REFLEX_HOST` | `session` (the visitor's state in KV) on every configuration; `do` (state in her object) is built and held back by the ledger-stall finding (§9.4) | `wrangler.toml:179-182`, `:252`, `:351` |

### 2.6 The demo workers and the customer stamps

- **The rule.** `AGENTS.md`, "The two demo workers — read this before any deploy". Its table now lists three demo
  workers: the shared `edge-platform` (the older demos, on commit `26e2db1`, deployed only with
  `scripts/deploy-legacy-demos.sh`), `edge-platform-top-offers` and `edge-platform-vantage` (today's engine).
  A fourth, `edge-platform-oh`, is being built: its config `wrangler.oh.toml` and its routes `src/routes/oh.ts`
  are committed (`2fdef50`), and their mount in `src/index.ts` was an uncommitted edit at the last check. A separate
  `edge-platform-enablement` worker serves static enablement pages only: "No engine code, no bindings, no variables,
  no secrets" (`wrangler.enablement.toml:1-13`, at `22bf36e`).
- **Never** a plain `npx wrangler deploy` from the repository root: it ships today's engine onto the shared worker,
  which breaks the older demos (`AGENTS.md`; `docs/demos/BOOTSTRAP.md` §0 rule 1, §4).
- **Verify a deploy through the APIs, never the pages** (`AGENTS.md`; `docs/demos/BOOTSTRAP.md` §0 rule 2).
- A demo worker's configuration is generated from `wrangler.toml` by `scripts/build-demo-worker-config.mjs`. Only
  the name, the queue pair and the recovery queue names change; the customer `env.*` stamps are removed
  (`scripts/build-demo-worker-config.mjs:27-47`, `:96-121`).
- A reseed must be followed by a deploy; a demo worker's settings and secrets change only with the owner
  (`AGENTS.md`, "A reseed must be followed by a deploy" and "Do not change a demo worker's settings").
- **Customer stamps.** Staging `edge-platform-staging` and production `edge-platform-production` are declared with
  their own KV, R2, queues, D1 and Analytics dataset, profile `customer`, `AUTH_MODE` enforced and an empty origin
  allow-list (`wrangler.toml:231-423`). They are changed only through `npm run deploy staging|production`, which
  runs `scripts/deploy.sh` and then `scripts/stamp-workflow.mjs` (`package.json` scripts; `scripts/deploy.sh`;
  `AGENTS.md`). `wrangler.toml:328` records production as provisioned on 2026-09-05, and staging was measured that
  day (`docs/architecture/32-latency-numbers.md:1-5`). The live state of either stamp today: **unverified**.

### 2.7 Material for the architecture diagram

**Boxes**

| # | Box | Owner |
|---|---|---|
| B1 | The visitor's browser: the customer's page and the SDK | Customer |
| B2 | The customer's backend: sign-in, the identity proof, an optional server-first-paint bridge | Customer |
| B3 | The customer's content source: a CMS or DAM feed (JSON over HTTPS, or CSV) | Customer |
| B4 | The customer's commerce platform: candidate product lists; optionally a catalog-search API | Customer |
| B5 | The operator (merchandiser) in the console | Person |
| B6 | The edge Worker: tenancy, access gates, routes, the decision | Ours |
| B7 | The visitor's own objects: `ShopperReflex`, `PersonalizationWebSocket`, `DecisionRing` | Ours |
| B8 | KV `SESSIONS`: visitor records with the interest vector (session host); identity links | Ours |
| B9 | KV `CACHE`: published regional and lift snapshots; audiences; monitor results | Ours |
| B10 | `RegionTrend` objects, one per tenant and region | Ours |
| B11 | `LearnStats` objects, one per tenant, brand and slot | Ours |
| B12 | The queue and its dead-letter queue | Ours |
| B13 | R2: publication sets; ledger; hour aggregates; day reports; lift archive; erasure tombstones | Ours |
| B14 | D1: operator accounts, grants and audit (customer); demo datasets (demo) | Ours |
| B15 | The crons | Ours |
| B16 | Analytics Engine; the alert webhook | Ours |
| B17 | Optional outside services, all off by default: the tenant's own Google Gemini key (typed search, design-time tagging); Snowflake (warehouse delivery); ODP and Feature Experimentation (default demo tenant only, today) | Third party |

**Arrows** (from → to: what crosses)

1. B1 → B6, `POST /v1/{tenant}/identity/session` with the site key and `X-Tenant`; back: a signed shopper
   capability, a visitor id `vis-<uuid>` and a session id `s-<uuid>` (`src/routes/identity.ts:275-341`;
   `src/identity/sessionCapability.ts:181`).
2. B1 → B6 → B7, `POST /realtime/session/preferences`: the visitor's explicit consent choice, bound to her grant,
   stored in her `ShopperReflex` (`src/routes/realtime.ts:600-633`).
3. B1 → B6, `POST /realtime/action`: one JSON event (type, visitor and session ids, data with the product id and
   the registry's attribute fields, arrival signals, a timestamp), with `X-Shopper-Session`, the site key and
   `X-Tenant` (`src/routes/realtime.ts:138-194`; `src/sdk/README.md:197-233`).
4. B6 ↔ B8 (session host) or B6 ↔ B7 (object host): her interest vector, visit and journey counters, read and
   written (`src/services/RealtimeSegmentEngine.ts:534-576`; `src/durable-objects/ShopperReflex.ts:1-28`).
5. B6 → B10: the event's touches and its action weight, with the tenant and the region key; no visitor id
   (`src/reflex/regionTrend.ts:148-165`).
6. B10 → B9: the region's snapshot of shares per dimension value; B15 → B9 hourly: country and everyone roll-ups
   (`src/durable-objects/RegionTrend.ts:1-6`; `src/reflex/regionTrend.ts:254-283`).
7. B1 → B6, `GET` or `POST /v1/{tenant}/decisions/snapshot`: page, brand, channel, the arrival as JSON, the
   browsing session id, consent-withdrawal hints, a page instance; on `GET`, up to eight `ctx.<name>` conditions.
   Back: per slot, ordered decisions (the customer's content id, score, drivers), the document versions, the
   sources block (consent, per-stage timings), the experiment assignment, and a `Server-Timing` header
   (`src/routes/decisions.ts:502-641`).
8. B13 → B6: the pinned publication set (registry, catalog, slots, learn), through a per-isolate cache that lives
   at most 30 seconds (`src/content/service.ts:354-363`; `src/config/publication.ts:8`).
9. B9 → B6: the regional snapshot and the lift snapshots, each through a 60-second cache; a lift snapshot is used
   only after a health check against B11 (`src/reflex/regionTrend.ts:31`, `:175-187`;
   `src/content/service.ts:85-117`; `src/learn/fan.ts:10-25`).
10. B7 (`DecisionRing`) → B6: how often she was served each piece, only when a slot has a fatigue rule
    (`src/content/service.ts:484-488`).
11. B6 → B12: decision records after the answer (§3.15 says when) and outcome records from reward-bearing events
    (`src/routes/decisions.ts:611-614`; `src/routes/realtime.ts:215-240`).
12. B6 → B7 (`DecisionRing`): served decisions; outcomes go to the ring, which credits them and forwards credited
    pairs to B11 (`src/durable-objects/DecisionRing.ts:1-6`; `src/learn/fan.ts:1-5`).
13. B11 → B9 and B13: lift snapshots and their archive (`src/durable-objects/LearnStats.ts:23`;
    `src/learn/fan.ts:72-74`).
14. B12 → B6 (consumer) → B13: ledger batches, one R2 object per batch, filed by tenant, date, hour and stream
    (`src/index.ts:356-366`; `src/ledger/writer.ts:1-7`).
15. B15 → B13: hour aggregates every five minutes; the day report and the erasure rewrite at 03:00 UTC
    (`src/index.ts:284-315`).
16. B5 → B6: sign-in (`/auth/login`, or a configured SSO) returns an operator token; document reads and writes on
    `/config/reflex` and `/content/{kind}` carrying `If-Match` and `Idempotency-Key`; reads of reports, receipts
    and learned rows (`src/customerBoundary.ts:27-121`; `src/config/publication.ts:96-104`).
17. B6 → B13: each save becomes an immutable revision and a new publication set (`src/config/publication.ts:1-2`,
    `:67-71`).
18. B2 → B1 → B6: at sign-in, the backend's signature over tenant, visitor id, account id and expiry, sent to
    `POST /v1/{tenant}/identity/link`; the two profiles merge (`src/identity/assertion.ts:11-18`;
    `src/routes/identity.ts:343`; `src/reflex/identityMerge.ts:6-8`).
19. B4 or B1 → B6, `POST /sort`: up to 500 candidates carrying the registry's attribute fields; back: the same ids
    in a per-visitor order, with drivers; a product-sort receipt goes to the ledger (`src/routes/sort.ts:39`,
    `:112-151`).
20. B3 → B6 (by an operator): `POST /content/catalog/import` (JSON or CSV) or `/content/catalog/pull` (a JSON URL)
    (`src/routes/content.ts:7-15`).
21. B6 → B17, only when configured: a typed query to the tenant's model and a catalog-search call (`/search`);
    design-time tagging proposals; warehouse delivery. Never on the snapshot path (`src/routes/search.ts:35-71`;
    `src/content/enrichmentGeneration.ts:10-30`; `src/connectors/config.ts:78-89`).
22. B15 → B16: monitor results; an alert post to the configured webhook (`src/ops/monitor.ts:555-580`).

---

## 3. The decision path, end to end

One request, from the visitor's first event to the answer the page paints. Everything in §3 is **Built** unless a
line says otherwise.

### 3.1 Identity and session

- The first call mints an anonymous visitor (`vis-<uuid>`) and a session (`s-<uuid>`), and a capability signed
  with HMAC-SHA-256 under the prefix `ss1`, valid for at most 24 hours (`src/identity/sessionCapability.ts:14`,
  `:58-73`, `:181`). The browser presents it as `X-Shopper-Session` (`:10`). Caller-chosen ids, old cookies and
  profile copies confer no authority (`src/sdk/README.md:197-200`).
- **Sign-in.** The customer's backend signs tenant, visitor id, account id and expiry with the tenant's identity
  secret, valid for at most 24 hours (`src/identity/assertion.ts:11-18`, `:32`). The person becomes `sh_` plus 32
  hex characters of a salted hash of the account id; the raw account id is never a key (`src/identity/shopperId.ts:1-17`,
  `:44-55`). The two profiles merge: each value's faded scores are added at the later touch and memberships are
  unioned, so nothing is overridden (`src/reflex/identityMerge.ts:6-24`, `:49`, `:65`).
- **Anonymous return recognition** (a visitor recognised on her next visit without signing in). Built, and off
  until a tenant publishes a complete `continuity` block on its registry with a retention approval
  (`src/reflex/core.ts:81-115`; `src/reflex/configStore.ts:240-297`). **Open:** the production window and covered
  purpose (`docs/handover/HANDOFF-2026-09-18.md` §8, first row).

### 3.2 Consent

- **Off until an explicit choice.** "Missing, expired or legacy boolean-only state is OFF; only a scoped explicit
  instruction grants a purpose" (`src/content/consent.ts:7`; `src/sdk/README.md:258`). Each choice lasts 30 days
  (`src/content/consent.ts:17`; `docs/handover/HANDOFF-2026-09-18.md` §7, "Consent").
- The choice is made with `POST /realtime/session/preferences`, carrying an operation bound to the visitor's own
  grant, and is stored by her `ShopperReflex` on both hosts (`src/routes/realtime.ts:590-633`). Cookies and request
  hints can only refuse, never grant (`docs/kit/01-integration-guide.md:5`).
- Two switches. Personalization needs both tracking and personalization (`src/content/consent.ts:176`). Either off:
  the site's own defaults, with a note on every receipt (`src/content/service.ts:550`; `src/content/consent.ts:186`).
  Tracking off: nothing about the request is written, anywhere (`src/content/consent.ts:5-6`;
  `src/content/service.ts:553-564`).
- Tracking on and personalization off: on the session host the visitor's interest vector is still updated and
  stored and her region's counts still grow, while she is served the defaults
  (`src/services/RealtimeSegmentEngine.ts:534-576`).

### 3.3 The event: from the wire to touches

1. **Accepted types**: `email_open`, `form_submit`, `page_view`, `button_click`, `custom`, `product_view`,
   `add_to_cart`, `wishlist_add`, `purchase`, `content_impression`, `content_click`, `content_dwell`,
   `video_complete` (`src/events/actionTypes.ts:16-25`).
2. **The action's name** is `data.action`, else `data.eventName`, else `data.event`, else the type. So a `custom`
   event with `data.event: "search"` counts as `search` (`src/reflex/contentTelemetry.ts:69-84`).
3. **The engine's clock rules.** A timestamp later than now is admitted at now; an older one is admitted as given
   (`src/routes/realtime.ts:157-175`). The interest arithmetic uses the engine's own clock
   (`src/services/RealtimeSegmentEngine.ts:529-533`).
4. **Weight**: the registry's weight for that name, or 0 when the registry does not name it
   (`src/reflex/core.ts:574`). Only the two legacy demo scopes inherit the engine's compiled weights; every other
   tenant counts exactly the weights it publishes (`src/reflex/configStore.ts:93-98`, `:409-417`).
5. **Where the touches come from.** A product the engine holds wins. Otherwise the event's own attributes count
   only when the registry says `eventAttributes: 'event-when-unknown'`; the default, `catalog-only`, counts nothing
   (`src/reflex/core.ts:62-71`, `:491-510`). **Only the default demo tenant holds a product catalog**; for every
   other tenant the engine holds none (`src/demos/registry.ts:220-225`). So a customer tenant's product events
   build interest only if its registry is set to `event-when-unknown` and its events carry the attribute fields.
6. **The registry's touch rules.** For each dimension whose `source` field is present: a number is cut into named
   bands; a multi-valued field touches every entry; a string touches one value (`src/reflex/core.ts:303-337`).
   Event attributes are trimmed, capped at 64 characters and at 8 values per field, and refused if they contain
   control or angle-bracket characters (`src/reflex/core.ts:340-373`).
7. **The vocabulary check.** Where the tenant's published catalog names values on a dimension, an event value
   outside that list builds nothing on that dimension; a dimension the catalog names nothing on admits every value
   (`src/reflex/core.ts:452-471`; `src/content/service.ts:221-320`). The answer reports which product references
   could not be placed (`src/reflex/core.ts:393-410`).
8. **Content events** take their content-type touch from the catalog piece's own format tags when the piece is
   known (`src/reflex/contentTelemetry.ts:107-126`).
9. **Side effects of one event**: the visit's journey counters advance; the same touches, at the same weight, go
   to the region's object (`src/services/RealtimeSegmentEngine.ts:516-567`).

### 3.4 The interest arithmetic

| Step | Formula | Source |
|---|---|---|
| What is stored | Per (dimension, value): R and the time of the last touch. Never a faded number | `src/reflex/core.ts:11-14`, `:117-121` |
| An event | R ← R · e^(−Δt/τ) + w, and the last touch becomes now | `src/reflex/core.ts:580-592` |
| A read | R(now) = R · e^(−(now − t_last)/τ); a = R/(R + K) | `src/reflex/core.ts:289-298` |
| Pruning | A value whose faded R falls below ε is dropped; at most `maxValuesPerDim` values per dimension, weakest evicted first | `src/reflex/core.ts:594-610` |
| Entry and exit | Joins at a ≥ θ_in; once in, stays until a < θ_out. The validator refuses θ_out ≥ θ_in | `src/reflex/core.ts:612-628`; `src/reflex/configStore.ts:157-166`, `:319` |
| Time alone | Any re-evaluation, including a zero-weight `tick`, can produce an exit; time can never produce an entry | `src/reflex/core.ts:553-566`, `:660-662` |
| Closed-form exit | t* = t_last + τ · ln( R(1 − θ_out) / (K θ_out) ): the exact moment a member will cross her exit line | `src/reflex/core.ts:704-731` |

**Defaults** (`src/reflex/core.ts:259-264`): τ 14 days, K 1.8, θ_in 0.6, θ_out 0.45, ε 0.0001, 24 values per
dimension. Each dimension may override τ, K and both lines (`src/reflex/core.ts:43-46`, `:276-283`). τ is capped at
90 days (`src/reflex/configStore.ts:128-134`). The 14 days is "a documented ENGINEERING default, not a customer
calibration"; the production number is an open owner input (`src/reflex/core.ts:245-258`). **Open.**

The compiled default registry (dimensions line, category, subcategory, silhouette, occasion, price band cut at 150
and 400 with τ 35 days, content type) and its action weights (view 1, wishlist 2, cart 3, purchase 5,
content impression 0, dwell 0.5, content click 1, video complete 2) apply only to the two legacy demo scopes
(`src/reflex/core.ts:201-244`; `src/reflex/configStore.ts:409-417`).

**Worked arithmetic at the defaults** (published constants, not measurements): one product view gives
a = 1/2.8 = 0.357; two give 0.526; three give 3/4.8 = 0.625, a member. Entry needs R ≥ 2.7; exit comes when R
falls below 1.4727. A member at R = 3 who stops leaves after τ · ln(3/1.4727) ≈ 9.96 days at τ = 14 days; an
interest halves every τ · ln 2 ≈ 9.7 days.

### 3.5 Visit and journey stage

- A new visit begins after 30 idle minutes (`src/services/visit.ts:30`). Journey counters are per visit, and a
  purchase closes the visit's journey for the next one (`src/services/JourneyStage.ts:313-327`, `:423-428`).
- One stage, three vocabularies: the engine reports exploring, thinking, deciding (`src/services/JourneyStage.ts:124`);
  it stores early, mid, late (`:135-139`); content fits say exploring, considering, deciding (`:33-37`;
  `src/content/kinds.ts:64-77`).
- Default thresholds: thinking at the third interaction of a visit, deciding at the first purchase
  (`src/services/JourneyStage.ts:181-186`). A tenant's `journey` block on its registry replaces them wholesale; a
  block that cannot be read fails closed to the first stage (`src/services/JourneyStage.ts:443-473`).
- Used by a slot's stage rule (§3.11) and by the learning cell (`src/content/cell.ts:70`).

### 3.6 The regional prior and λ

- **Counting.** Every scored event's touches go to the object for the request's region (`<country>-<region>`, as
  the edge resolves it) at the action's weight, with no visitor id (`src/services/RealtimeSegmentEngine.ts:560-567`;
  `src/reflex/regionTrend.ts:40-46`, `:148-165`). The region's memory constant is 24 hours, with at most 32 values
  per dimension and ε 0.001, fixed in code (`src/reflex/regionTrend.ts:28-30`).
- **Shares.** Within each dimension, each value's faded R divided by the largest; the leader is 1. Shares are not
  probabilities (`src/reflex/regionTrend.ts:109-131`).
- **The ladder.** The region answers when it has at least `minEvents` events; else its country; else everyone; the
  last level found answers if none qualifies (`src/reflex/regionTrend.ts:189-210`). Roll-ups run hourly (§2.4).
- **λ = kBlend / (kBlend + Σa)**, where Σa adds the visitor's own interests over every value of every dimension
  (`src/reflex/regionTrend.ts:216-222`; `src/content/service.ts:454`). A stranger has λ = 1; when Σa equals kBlend,
  λ = 0.5.
- **The blend**: ã = (1 − λ) · a + λ · share (`src/reflex/regionTrend.ts:238-252`), only on the dimensions
  `learn.regional.dimensions` lists, or all when it lists none (`src/reflex/regionTrend.ts:224-234`;
  `src/content/kinds.ts:544-559`). On a dimension left out, her own value is still multiplied by (1 − λ).
- **When it is off.** When the learn document has no `regional` block, and on the holdout's default arm
  (`src/content/service.ts:441-447`). The compiled learn default, used when a scope has no learn document, has it
  on with kBlend 1 and minEvents 30 (`src/content/kinds.ts:697-707`).
- **An asserted region** (a region the caller names, rather than the edge's) selects the prior only on the demo
  profile with tracking consent, and the receipt says `asserted` (`src/content/service.ts:322-331`, `:447-462`).
  Elsewhere it only gates eligibility (§3.9). The owner's rule for demos: the opening region is always the real
  edge region; an asserted one is an explicit, labelled presenter action (`docs/verizon/Vantage-Demo-Design.md`
  §12, 2026-10-01 "Reversed" entry).

### 3.7 The shopper vector the decision reads

The visitor's interests read at the moment of the request (`src/reflex/core.ts:665-676`), blended with the regional
prior (`src/content/service.ts:445-463`); her own memberships, for seed dampening (`:532`); her journey stage and
visit (`:387-405`). The vector exactly as scored is copied onto every decision record so the decision can be
replayed (`src/content/decide.ts:500-519`).

### 3.8 The snapshot request

- Route: `GET` or `POST /v1/{tenant}/decisions/snapshot`, behind the shopper capability and, under enforced mode,
  the site key (`src/routes/decisions.ts:530`; `src/index.ts:91`).
- Body or query: `page` (default `home`), `brand`, `channel`, `entry` (the arrival, as JSON), `browsingSessionId`,
  `trackingConsent` and `personalizationEnabled` (refusal hints only), `pageInstance` (`src/routes/decisions.ts:502-528`).
- `ctx.<name>=<value>` conditions, on `GET` only: at most eight, names of up to 32 characters, values of up to 64.
  They gate pieces whose rule names them "and do nothing else" (`src/routes/decisions.ts:567-582`).
- The OS family (`ios` or `android`) is read from the request's own headers (`src/routes/decisions.ts:594`;
  `src/services/platform.ts:29-45`).
- The answer is refused (503) above 2 MiB, and is never cached (`src/routes/decisions.ts:612-641`).

### 3.9 Eligibility gates

A piece exists for a decision only if its status is `live`, the time is inside its window [from, to), it is not
marked `inStock: false`, and its own `eligibleWhen` rule holds (`src/content/lifecycle.ts:29-73`;
`src/content/decide.ts:202-211`). Region rules match exactly or by country (a rule naming `US` admits `US-WA`) and
fail closed when the request has no region; condition rules must equal one of the listed values, and a missing
condition fails (`src/content/lifecycle.ts:37-63`). The region used is the asserted one, else the edge's, and only
with tracking consent (`src/content/service.ts:498-517`). Bounds: 1 to 64 regions; 1 to 8 conditions with 1 to 32
values each (`src/content/kinds.ts:126-160`).

### 3.10 Slot controls and pins

- **Off-limits**: the slot serves nothing (`src/reflex/contentCompose.ts:169-180`, `:226-227`).
- **Exclusions**: excluded piece ids, excluded tags and an allowed-types list, all applied before ranking
  (`src/reflex/contentCompose.ts:169-180`, `:251-252`; `src/content/kinds.ts:343-378`). `governanceVersion` 1 to 3
  says which controls a document uses (`src/content/kinds.ts:449-468`; `src/content/types.ts:202-207`).
- **Pins.** `pinnedPieceIds` is a required prefix of up to 50 pieces: reserved before any ranking, served first at
  score 0 as `tenant-pinned` ("ranking never ran for this piece"), with the remaining positions ranked
  (`src/reflex/contentCompose.ts:158-206`, `:230-235`, `:249`; `src/content/kinds.ts:336-341`). A single
  `pinnedPieceId` takes a one-position slot outright (`src/reflex/contentCompose.ts:207-247`;
  `src/content/kinds.ts:502`).
- **If any prefix pin cannot be served** (missing, ineligible, excluded, wrong slot type, or pinned elsewhere), the
  whole slot serves nothing and a pin diagnostic is recorded (`src/reflex/contentCompose.ts:184-199`, `:229`).
  Engine finding, in W20's territory (`docs/verizon/RESUME-vantage.md` finding 8).
- A pinned slot that serves fewer pieces than it takes says so on every record it writes (`shortTake`)
  (`src/content/decide.ts:419-442`).
- Slot names must be unique across a brand's pages, because one slot name is one statistics object
  (`src/content/kinds.ts:476-497`).

### 3.11 The score

**The base**: B0 = Σ over the piece's tags of ω[slot, dimension] × ã(value) (`src/reflex/contentCompose.ts:253-264`).
A plain sum: no per-tag weight, no averaging. A piece with no `contentType` tag scores as its own `type`
(`src/content/typeAffinity.ts:23-28`; `src/content/decide.ts:205-208`).

**Then, in this order** (`src/content/decide.ts:310-390`):

| # | Term | Arithmetic | Source |
|---|---|---|---|
| 0 | Completes (since `2313527`) | + the slot's `complements` weight when the piece lists the product the request names in `ctx.anchor`; fails closed without an anchor; never on the default arm | `src/content/decide.ts:103-110`, `:177-189`, `:200`; `src/reflex/contentCompose.ts:265-268`; `src/content/kinds.ts:416-422` |
| 1 | Seeds | + rule weight × the product of any dampen factors × ω for the tag's dimension, for each fired rule tag the piece carries. Signals: entry channel (six channel words), campaign term (case-insensitive), referring network, platform (`ios` or `android`). Dampening reads only her own memberships, never the region's or an asserted context | `src/content/decide.ts:257-301`, `:356-370`; `src/content/kinds.ts:251-317` |
| 2 | External model | **Withdrawn.** The seam would add w × the model's score; the service always marks it unavailable | `src/content/decide.ts:313-316`; `src/content/service.ts:471-479` |
| 3 | Journey stage | Inside the piece's stage fit: + `inStage`; outside: × `outOfStage`; no fit: untouched; unknown stage: off | `src/content/decide.ts:233-240`, `:317-326` |
| 4 | Freshness | + weight × 2^(−age in days / half-life), from `freshnessDate`, else the window's start | `src/content/decide.ts:241-256`, `:327-335` |
| 5 | Fatigue | − weight × min(times served, cap) / cap, never below zero; "times served" counts this visitor anywhere in the brand inside the window, read from her ring | `src/content/decide.ts:336-345`, `:484-489` |
| — | `score_base` | Recorded here | `src/content/decide.ts:346` |
| 6 | Merchandising | If the score is above 0: × clamp(Π(1 + w·v), minBoost, maxBoost) over season, promotion and margin. v (0–1) is the piece's; w (−1 to 1) is the slot's; the default clamp is 0.5 to 2 | `src/reflex/merchandising.ts:84-85`, `:101-160`; `src/content/decide.ts:347-351`; `src/content/kinds.ts:161-171`, `:379-392` |
| 7 | Learned lift | × lift^γ, with γ 0 by default. Item controls: `reject` ignores the lift; `freeze` uses a chosen one | `src/content/decide.ts:371-389`; `src/content/service.ts:490`; `src/content/kinds.ts:668-677` |
| — | `score_final` | After step 7 | `src/content/decide.ts:547` |

**Arms.** The `default` arm sees no interest, so every score is 0 and the slot serves catalog order; no seeds,
stage, freshness, fatigue, regional prior or learning apply, and pins are kept (`src/content/decide.ts:173-176`,
`:218-220`, `:237`, `:247-248`, `:265`; `src/content/service.ts:447`). `no_learning` is personalized with γ 0 and no
exploration (`src/content/decide.ts:218-220`).

### 3.12 Ranking and the take

- Sort by score, then catalog order, then id (`src/reflex/contentCompose.ts:271`).
- An exploration rule, off by default (§5.4), may move one piece first or replace the ranking
  (`src/reflex/contentCompose.ts:273-291`).
- The top ten are recorded as the slot's candidates (`src/reflex/contentCompose.ts:293-297`;
  `src/content/decide.ts:409`).
- **Diversity cap**: at most `max` pieces sharing one value of a dimension; a piece over the cap yields to the next,
  and yielded pieces fill only positions that would otherwise be empty, marked `relaxed`
  (`src/reflex/contentCompose.ts:299-339`).
- No piece appears twice on a page (`src/reflex/contentCompose.ts:152`, `:252`).
- With no signal at all, the slot serves catalog order, labelled as the default (`src/reflex/contentCompose.ts:316-321`).

### 3.13 The learning stage (recorded; inert while γ is 0)

- **The cell**: channel (direct, paid social, paid search, email, organic, referral), visit band (1, 2–3, 4+,
  unknown), the edge region, the leading interest above its entry line, the stage (`src/content/cell.ts:51-72`;
  `src/services/visit.ts:37`).
- **The pooling ladder**: six levels from "everyone" to the full cell; the finest level whose exposures (plus any
  imported prior's strength) reach `nMin` answers (`src/learn/stats.ts:36-50`, `:482-496`).
- **Counts fade** with τ_learn 21 days (`src/learn/stats.ts:20`, `:90-97`).
- **Shrinkage.** The slot's rate at each level is pulled toward its parent level's rate. The piece's estimate is
  p̂ = (s + n0 · p0) / (n + n0), where p0 is the slot's rate in that cell, or an imported prior
  (`src/learn/stats.ts:409-449`).
- **Lift** = clamp(p̂ / p0, 0.5, 2), or 1 when p0 is 0; n0 and nMin are 30 (`src/learn/stats.ts:20`, `:450`).
- **Reward and objective per slot**: click by default; `revenue` and `margin` need a reward that carries a value
  (purchase or add to bag) (`src/content/kinds.ts:590`, `:643-648`; `src/content/service.ts:120-123`).
- Statistics are kept per tenant, brand and slot, with a budget of 256 pieces per slot object
  (`src/learn/fan.ts:71`; `src/learn/stats.ts:118`; `src/durable-objects/LearnStats.ts:24-27`).
- The merchandiser's receipt says the lift is "not corrected for position or placement" (`src/learn/receipts.ts:160-167`).

### 3.14 The receipt (decision record)

**What it records**, one per served position (`src/content/types.ts:451-548`; `src/content/decide.ts:521-562`):

- the decision id, built as `tenant:time:visitor:page:slot:position` plus a nonce (`src/content/decide.ts:537`);
  tenant, brand, visitor, session, the identity anchor, time;
- page, slot, position, rank after any pins, the internal and the customer's content ids;
- the top ten candidates with scores;
- the cell; the journey stage and its threshold version; the arm served and the experiment assignment;
  whether it was explored; the authority (`engine`, `pin` or `default`);
- the revisions of every document in force and the configuration label; the featured product ids;
- `explain`: the drivers; a note; `score_base`; the regional block (λ, level, events, version, asserted, its
  contribution); the seed block (`contextual`); the lift block; `score_final`; exploration, control, merchandising,
  stage, freshness, fatigue, diversity and short-take blocks, each with a sentence where it applied;
- the replay inputs: the vector as scored, the regional shares, served counts;
- the measurement basis and the retention stamp.

**What it does not contain:**

- **Every tag term.** The drivers list only the four strongest tag terms, ranked by interest × weight; weaker terms
  are inside `score_base` but not itemised (`src/reflex/contentCompose.ts:309-321`). After them come the
  completes, regional, merchandising, stage, freshness and fatigue entries (`src/content/decide.ts:458-482`). The
  merchandiser's sentence form names the top three interest terms (`src/learn/receipts.ts:124-125`).
- The interest shown on a driver is the blended ã, so for a stranger it is the region's share
  (`docs/verizon/explainer/FACTS.md` §9).
- Asserted conditions such as an intent: never recorded. An asserted region is recorded only when it selected the
  prior on the demo profile (`src/demos/kit/helpers.ts:94-108`).
- The raw event history, the account id, the documents themselves (named by revision only), candidates beyond ten
  (`src/content/types.ts:399-407`; `src/identity/shopperId.ts:5-11`).

**Who reads it**: operators, through `/v1/{tenant}/visitors/{id}/receipts` and the console's "Why a shopper saw this"
(`src/routes/decisions.ts:390`; `src/learn/receipts.ts:1-4`; `public/console/views-explore.js:104-106`); point
lookups and replays through `/v1/{tenant}/ledger/{id}` and `/v1/{tenant}/replay/{id}` (`src/routes/decisions.ts:847`,
`:887`; `src/learn/replay.ts:1-8`). Replay is claimed exact for one slot, never for a whole multi-slot page
(`docs/demos/BOOTSTRAP.md:277-281`). The page's own answer carries only each decision's drivers and diversity note,
not the base, lift or seed blocks (`src/reflex/contentCompose.ts:64-78`).

### 3.15 After the answer

- **Only with tracking consent**, and after the answer is sent: decision records go to the queue and then R2; the
  visitor's ring receives the served decisions; each slot's statistics receive exposures
  (`src/routes/decisions.ts:611-614`; `src/content/service.ts:553-564`; `src/learn/fan.ts:1-5`).
- **Which snapshots are recorded.** A direct snapshot call with no page instance is recorded when every slot uses
  the served basis (`src/content/service.ts:556-558`). The SDK always sends a page instance
  (`src/sdk/listen.ts:176-181`), which makes its snapshot "a read-only offer: receiving or polling a choice creates no
  behavioral, ledger or learning exposure" (`src/sdk/README.md:62`). A slot on the served basis then records
  nothing; a slot on the `rendered-v1` basis gets a render offer, recorded when the page acknowledges the paint
  (`src/content/service.ts:594-601`). That acknowledgment needs durable recovery switched on
  (`src/ledger/recovery.ts:298-299`; `src/content/renderOffer.ts:98-99`), and every configuration in the repository
  holds it off (`wrangler.toml:155`, `:237`, `:336`; `wrangler.vantage.toml:125`). The Top Offers and Vantage pages call
  the snapshot directly and send no page instance (a search of `public/top-offers`, `public/vantage` and
  `public/demo-kit` finds none), which is why they record (`public/top-offers/top-offers.js:210`;
  `public/vantage/vantage.js:44`; `docs/verizon/explainer/FACTS.md` §9).
- **Outcomes**: reward-bearing actions become outcome records, carrying the visitor's experiment assignment
  (`src/ledger/records.ts:121-152`, `:196-219`; `src/routes/realtime.ts:215-240`). Since `2313527`,
  `partner_pickup` and `retailer_referral` are named custom outcomes: credited like a click, reported under their
  own names, never as a sale (`src/ledger/records.ts:196-208`; `src/learn/report.ts:725`, `:872`).
- **Attribution**, online in the visitor's ring: same session, the same piece, the last decision before the
  outcome; windows of 30 minutes for click, dwell, video and custom outcomes, 6 hours for wishlist and add to bag,
  7 days for purchase (`src/learn/policy.ts:24-29`; `src/content/kinds.ts:704`). A purchase can credit a piece that
  featured one of its products (`src/content/types.ts:497-498`; `src/ledger/records.ts:142-143`).
- On a customer stamp each tracked event is also written as a durable behaviour record through the same recovery
  path (`src/ledger/behavior.ts:1-3`, `:21`, `:43`; `src/identity/sessionAuthority.ts:368-371`). How a tracked
  event is answered on a customer stamp while recovery is off was not exercised here: **unverified**.

### 3.16 The day report

- One UTC day per tenant and brand. Built at 03:00 UTC for yesterday and retried every five minutes from folded
  hours (`src/index.ts:284-306`; `src/learn/hourly.ts:1703-1785`). Stored at `reports/{tenant}/{brand}/{date}.json`
  (`src/learn/report.ts:1286`); read through `/v1/{tenant}/learn/report` and the console's Measurement view
  (`src/routes/decisions.ts:1177`, `:1281`; `public/console/views-measure.js:112-114`).
- Contents: counts, the attribution policies, per-slot grids, exploration rows, holdout rows by arm, visitor
  outcomes, named outcomes, hour coverage (`src/learn/report.ts:831-880`).
- **Its own label**: kind `attribution_diagnostic`, unit "credited outcomes per content-item decision", inference
  `unavailable`, experimental coverage `not_assessed` (`src/learn/report.ts:613-618`).
- Limits: 50,000 records, 16 MiB of raw input, 800 objects, 6 policies, called "application refusal budgets, not
  measured Worker capacity" (`src/learn/report.ts:26-31`).
- Behaviour to know: no window narrower than a UTC day; once any hour of the day is folded, the report sums folded
  hours only, so a click appears after its hour closes and folds (`docs/verizon/Vantage-Demo-Design.md` §12,
  2026-09-30 F1 entry).

### 3.17 Constants and where they are published

| Constant | Default | Defined at | A tenant changes it in |
|---|---|---|---|
| K | 1.8 | `src/reflex/core.ts:260` | `reflex.K`, or per dimension |
| θ_in, θ_out | 0.6, 0.45 | `src/reflex/core.ts:261-262` | `reflex.thetaIn`, `reflex.thetaOut`, or per dimension |
| τ | 14 days (at most 90) | `src/reflex/core.ts:259`; `src/reflex/configStore.ts:134` | `reflex.tauMs`, `dimensions[].tauMs` |
| ε, values per dimension | 0.0001, 24 (at most 1,000) | `src/reflex/core.ts:263-264`; `src/reflex/configStore.ts:317-318` | `reflex.epsilon`, `reflex.maxValuesPerDim` |
| Action weights | Demo scopes only (view 1 … purchase 5) | `src/reflex/core.ts:221-244` | `reflex.weights` (a customer tenant names every one it wants) |
| Event attributes | `catalog-only` | `src/reflex/core.ts:62-71` | `reflex.eventAttributes` |
| Journey thresholds | Thinking at 3 interactions; deciding at the first purchase | `src/services/JourneyStage.ts:181-186` | `reflex.journey` |
| Dimensions, values, weights | At most 32 dimensions and 200 weights | `src/reflex/configStore.ts:134-136` | `reflex.dimensions`, `reflex.weights` |
| Visit gap | 30 minutes | `src/services/visit.ts:30` | Code only |
| Region memory | 24 hours, 32 values, ε 0.001 | `src/reflex/regionTrend.ts:28-30` | Code only |
| kBlend, minEvents | 1 and 30 in the compiled learn default | `src/content/kinds.ts:701` | `learn.regional` (kBlend in (0, 100]) |
| Regional dimensions | All | `src/reflex/regionTrend.ts:224-234` | `learn.regional.dimensions` |
| Holdout | 5 % to `default` in the compiled learn default | `src/content/kinds.ts:700` | `learn.holdout` |
| Attribution policy | Session, direct, last; 30 min / 6 h / 7 days | `src/content/kinds.ts:704`; `src/learn/policy.ts:24-29` | `learn.policy` |
| Learning statistics | n0 30, τ_learn 21 days, lift 0.5–2, nMin 30 | `src/learn/stats.ts:20`; `src/content/kinds.ts:705` | `learn.stats` |
| γ | 0 | `src/content/service.ts:490` | `learn.slots[slot].gamma` (0–1) |
| Reward, objective, basis | Click, unit, served | `src/content/service.ts:120-123`, `:537` | `learn.slots[slot]` |
| Exploration | Off (floor 50 when enabled) | `src/learn/explore.ts:26-35` | `learn.slots[slot].exploration` |
| Merchandising clamp | 0.5 to 2 | `src/reflex/merchandising.ts:84-85` | `slots[].merchandising.minBoost`, `maxBoost` |
| Slot take, weight | 1–50 pieces; 0–1 | `src/content/kinds.ts:327`, `:331` | `slots[]` |
| Candidates recorded, drivers listed | 10, 4 | `src/content/decide.ts:409`; `src/reflex/contentCompose.ts:321` | Code only |
| Ring | 200 decisions, 7 days | `src/durable-objects/DecisionRing.ts:36`; `src/learn/stats.ts:34` | Code only |
| Caches | Documents 30 s; regional and lift snapshots 60 s; object publish delay 30 s | `src/config/publication.ts:8`; `src/reflex/regionTrend.ts:31`; `src/content/service.ts:85`; `src/durable-objects/RegionTrend.ts:16`; `src/durable-objects/LearnStats.ts:23` | Code only |
| Credentials | Shopper capability ≤ 24 h; sign-in proof ≤ 24 h; consent 30 days; operator access 15 min, refresh 7 days | `src/identity/sessionCapability.ts:14`; `src/identity/assertion.ts:32`; `src/content/consent.ts:17`; `src/routes/auth.ts:39-41` | Code only |
| Session record lifetime | The earlier of 30 days and the retention policy | `src/services/SessionManager.ts:96`, `:352-353` | `RETENTION` (worker setting) |
| Ledger window for the erasure rewrite | 90 days | `src/ledger/erasure.ts:65`, `:121-125` | `LEDGER_RETENTION_DAYS` (worker setting) |

---

## 4. Configuration

### 4.1 The publication set — Built

- Each tenant's configuration is one coherent set in R2: a head, immutable sets, and immutable revisions of each
  document (`src/config/publication.ts:1-2`, `:67-71`). The kinds are `content` (the catalog), `slots`, `learn`,
  `reflex` (the registry), `prior` (imported priors) and `proposals` (retained autonomy proposals)
  (`src/config/publication.ts:11`).
- **A save** validates the whole document and returns every error (`src/config/versionedStore.ts:74-75`), records
  who changed it and why, and stamps its label with the revision (`name+rN`) so two revisions never share a label
  (`src/content/kinds.ts:18-22`; `src/reflex/configStore.ts:25-34`). It must carry `If-Match: "N/S/H"` (the
  document revision, the set revision, the set's digest) and `Idempotency-Key: N:UUID`, so two people cannot
  overwrite each other (`src/config/publication.ts:87-104`; `docs/kit/02-api-reference.md:532`). Each document is
  at most 2 MiB (`src/config/publication.ts:7`). A document save can publish up to five more of the same tenant's
  documents in one activation (`docs/kit/02-api-reference.md:534`).
- **Rollback rolls forward**: the old value is written as a new revision, so the history shows the rollback
  (`src/config/versionedStore.ts:114-118`; `public/console/views-measure.js:282-284`). The audit index keeps the
  last 50 entries; every revision stays addressable (`src/config/versionedStore.ts:6`;
  `docs/kit/02-api-reference.md:532`).
- **Serving reads** pin one coherent set per decision (`src/content/service.ts:354-363`) through a per-isolate
  cache of at most 30 seconds (`src/config/publication.ts:8`). The kit says plainly that this "does not establish
  a deployed propagation SLO or customer immediate-effect acceptance" (`docs/kit/02-api-reference.md:536`).

### 4.2 What each document holds

| Document | Holds | Source |
|---|---|---|
| `reflex` (registry) | Dimensions (key, source field, multi-valued, band cuts and labels, per-dimension τ, K and lines); action weights; τ, K, θ_in, θ_out, ε, values per dimension; event-attribute mode; journey thresholds; return-continuity block | `src/reflex/core.ts:24-115`; `src/reflex/configStore.ts:299-365` |
| `content` (catalog) | Pieces. Required: `id`, `customerContentId`, `type`, `title`, `tags` (dimension → values), `slotTypes`. Optional: `subtitle`, `excerpt`, `runtime`, `lifecycle`, `window`, `eligibleWhen`, `art`, `renderUrl`, `merchandising` (season, promotion, margin, 0–1), `journeyStageFit`, `freshnessDate`, `featuredProductIds`, `complements`, `inStock` | `src/content/kinds.ts:34-36`, `:79-217` |
| `slots` | Pages, each a list of slots: `slot`, `take`, `weights`, pins, off-limits, exclusions, allowed types, `stage`, `freshness`, `fatigue`, `complements`, `diversity`, `merchandising`, `seeds`. A starting homepage proposal exists, on the default registry's dimensions | `src/content/kinds.ts:319-447`, `:515-529` |
| `learn` | Holdout; regional prior; attribution policy; statistics constants; external model (withdrawn); per slot γ, reward, objective, measurement basis, exploration, autonomy (withdrawn), external weight (withdrawn), item controls | `src/content/kinds.ts:561-695` |
| `prior` | Rows of slot, piece, cell, prior rate and its strength in observations | `src/learn/priors.ts:1-15` |
| `proposals` | Retained autonomy proposals, read-only | `public/console/views.js:523-525` |

### 4.3 Who may change it

- **Operators.** On a customer stamp: accounts in D1 with a role (`operator` or `admin`) per tenant
  (`src/auth/authority.ts:7-27`), an access token of 15 minutes renewed by a 7-day refresh token
  (`src/routes/auth.ts:39-41`), optional SSO through a configured OIDC provider (`src/types/env.ts:60-61`;
  `src/auth/oidc.ts`), and individually revocable service credentials for machines (`src/auth/authority.ts:9-12`;
  `docs/handover/HANDOFF-2026-09-18.md` §7). Under enforced mode every configuration operation needs a grant for the
  resolved tenant, and a tenant role never inherits a global one (`src/middleware/operatorAuth.ts:11-48`;
  `docs/kit/02-api-reference.md:530`).
- On a demo worker, grants come from `TENANTS.operatorGrants` (`src/middleware/operatorAuth.ts:19-26`). Demo pages
  hold no credential: a named beat mints a genuine 60-second operator token inside the worker and re-enters the
  ordinary routes (`src/routes/topOffers.ts:16-31`, `:54`).

### 4.4 The routes

`/config/reflex` (read, replace, patch, history, revisions, validate, rollback); `/content/{catalog|slots|learn|priors}`
(the same); `/content/catalog/import` and `/pull`; `/content/catalog/publication` and `/recover`; the enrichment
proposal routes; `/v1/{tenant}/learn/items/reset`; the ledger erasure routes; `/operator/audiences` (publish,
rename, pin, prune) (`src/customerBoundary.ts:45-73`, `:118-121`; `src/routes/config.ts:1-15`;
`src/routes/content.ts:1-15`).

### 4.5 The operator console — Built

There is a console, at `/console/` ("Operator — the console for the engine", design document 28), with sign-in by
email and password or a configured SSO (`public/console/index.html:6`, `:205-216`). Older `/tuning.html` and
`/learning.html` links redirect into it (`public/tuning.html:6-18`). Render tests: `src/console/console.render.test.ts`,
`src/console/learning.render.test.ts`.

| View | What it shows or changes | Source |
|---|---|---|
| Work | Counts of what needs a person, and where to go | `public/console/views.js:50-52` |
| Proposals | Historical proposals, read-only: "Autonomy is unavailable" | `public/console/views.js:523-525` |
| Erasures | Visitors who asked to be forgotten; starts the ledger rewrite | `public/console/views.js:550-552`, `:583` |
| Interests | The registry's action weights (every one the document names), τ, K, θ_in, θ_out, ε, values per dimension, and per-dimension τ, K and lines. "They take effect without a deployment" | `public/console/views-config.js:92-108`, `:141-143` |
| Slots | Every slot and what is set on it | `public/console/views.js:285-287` |
| Why a shopper saw this | One visitor's receipts, newest first, a sentence per reason | `public/console/views-explore.js:104-106` |
| Measurement | The day report, labelled "Attribution diagnostics" | `public/console/views-measure.js:112-114` |
| History | Every document's revisions, with rollback | `public/console/views-measure.js:243-247`, `:282-284` |
| Slot rules | Take, pins, exclusions, dimension weights, stage, freshness, fatigue, diversity, merchandising | `public/console/views-config.js:443-445`, `:482-567` |
| What is exploring | Pieces under the slot's observation floor | `public/console/views-explore.js:42-44` |
| What it has learned | Learned rows per piece; freeze, reject or clear a piece's lift; reset its evidence | `public/console/views.js:135-172` |
| Dials | Per slot: γ, reward, objective, measurement basis, exploration, external weight. Per brand: holdout share and arms, attribution policy and windows, statistics constants, regional prior on or off with kBlend and minEvents, external model. The external model controls are inert (`src/content/service.ts:471-479`) | `public/console/views.js:401-492` |
| Accounts | Who may sign in: temporary passwords, resets, SSO links | `public/console/views-accounts.js:83-85`, `:141-159` |

**No console screen for**: catalog content (it arrives by import or pull; History can roll it back), seed rules,
the regional dimension list, adding or removing a dimension, changing a dimension's source or bands, the
event-attribute mode, journey thresholds, the continuity block. Each of these is a published change made through
the API, with no deploy (`src/reflex/configStore.ts:561-579`; `src/routes/content.ts:7-15`).

### 4.6 What needs no deploy, and what needs an engineer

- **No deploy** (Built): any document above, through the console or the API. A save is in force on a request once
  that isolate's document cache refreshes, a constant of at most 30 seconds (`src/config/publication.ts:8`;
  `public/console/views-config.js:137`).
- **Needs an engineer** (worker settings and secrets): `TENANTS` (brands, hosts, operator grants), `SDK_KEYS`,
  `CORS_ORIGINS`, `IDENTITY_SALT`, `IDENTITY_SECRETS`, `RETENTION`, `TENANT_CONNECTORS`, `REFLEX_HOST`, `AUTH_MODE`,
  `DEPLOYMENT_PROFILE`, the recovery switch and its queues, `JWT_*`, `OPERATOR_OIDC`, `ALERT_WEBHOOK_URL`
  (`src/types/env.ts:1-168`; `docs/deployment/01-deploy.md:32-36`). On a stamp, each change is a stamp-workflow
  operation (`add-brand`, `rotate`, `upload`, `promote`) behind a protected authorization record
  (`docs/deployment/01-deploy.md:11-24`). A new capability needs code.

### 4.7 A new tenant

Every configuration read and write needs one initialized publication set; a brand-new scope answers
"uninitialized" to everything, reads included (`src/routes/demoBootstrap.ts:6-11`). A tenant other than the two
legacy demo scopes also needs its own registry, because only those scopes have a compiled default
(`src/reflex/configStore.ts:409-417`). "No HTTP endpoint initializes configuration" for customers; initialization is
a library capability (`docs/kit/02-api-reference.md:530`). A demo tenant uses `POST /ops/demo-bootstrap`, which
creates the set once with four documents (`reflex`, `catalog`, `slots`, `learn`), in the development environment
only and never on the customer profile (`src/routes/demoBootstrap.ts:45-46`, `:68-72`). For customer stamps the code
says: "Safe desired-state provisioning for CUSTOMER stamps is still remediation item W08 and decision D01"
(`src/routes/demoBootstrap.ts:12-14`). **Open.**

---

## 5. Learning

### 5.1 What is recorded from day one

With tracking consent, and subject to the capture rule in §3.15: every served decision, every outcome, the
visitor's ring, each slot's exposures and successes, the published lift snapshots, the hour aggregates and the day
report (`src/content/service.ts:553-564`; `src/routes/decisions.ts:611-614`; `src/index.ts:284-306`). **Built.** On
an SDK integration, decisions are recorded only for slots on the rendered basis with durable recovery on (§3.15).

### 5.2 What moves nothing until γ moves

The lift is computed, recorded on the receipt and multiplied in only as lift^γ, and γ is 0 unless a person raises
it (`src/content/decide.ts:60-62`, `:371-389`; `src/content/service.ts:490`). The compiled learn default says
"Every slot runs at γ = 0 (shadow)" (`src/content/kinds.ts:702-703`). At γ 0 a lift in force is recorded with an
applied change of 0; the lift block is null only when nothing has been learned for that piece in that cell
(`src/content/decide.ts:387-389`; `docs/verizon/Vantage-Demo-Design.md` §12, 2026-10-01 explainer entry).

### 5.3 Holdout arms — Built

- Assignment is a stable hash of the visitor and the salt (the brand when no salt is set); the held-out share is
  split evenly across the configured arms, `default` and `no_learning` (`src/content/holdout.ts:280-289`;
  `src/content/types.ts:259-266`).
- Enrollment is recorded against a persistent anchor; a visitor without personalization consent is never drawn
  and is labelled `ineligible`, so a control group holds randomised visitors only (`src/content/service.ts:406-437`;
  `src/content/types.ts:210-256`).
- The compiled learn default holds out 5 % (`src/content/kinds.ts:700`); the demos publish 0, "shown, not run"
  (`docs/verizon/explainer/FACTS.md` §5).
- **Open**: the production experiment design (enrollment unit, metrics, allocation, windows, stopping)
  (`docs/handover/HANDOFF-2026-09-18.md` §8, D04).

### 5.4 Exploration — off; Thompson withdrawn

Exploration is off by default (`src/learn/explore.ts:26-35`). Two modes can be published per slot: rotation, which
serves the least-observed piece on a hashed share of visitor, slot and hour; and epsilon, which picks uniformly
(`src/learn/explore.ts:7-11`, `:37-43`; `src/content/kinds.ts:649-654`). Thompson sampling is withdrawn: refused at
publish and inert if retained (`src/content/kinds.ts:652`; `src/learn/explore.ts:37-43`). **Open**: which
exploration is offered to a customer (`docs/handover/HANDOFF-2026-09-18.md` §8, D05).

### 5.5 Position-bias correction — Designed, not built

No position term exists in the learning code; the receipt says the lift is "not corrected for position or
placement" (`src/learn/receipts.ts:167`; `src/learn/stats.ts:47-50`, whose cell keys carry no position). The design
is in `docs/BTI-Parity-and-Mechanism.md` §3.7 and ticket P05 of `docs/BTI-Parity-Build-Tickets.md` (an untracked
working file). **Correction to carry:** parity §3.7 says rotation and a position discount are "both already in the
engine's exploration modes"; the code's rotation serves the least-observed piece (`src/learn/explore.ts:7-11`) and
has no position discount. Build item: starts at `src/learn/explore.ts` (rotation) and the exposure keys in
`src/learn/stats.ts:47-50`.

### 5.6 Other learning features

| Feature | Status | Source |
|---|---|---|
| Imported priors (a warehouse's starting beliefs per piece and cell) | Built | `src/learn/priors.ts:1-15`; `src/learn/stats.ts:421-435` |
| Item controls (freeze, reject, reset) | Built | `src/content/kinds.ts:668-677`; `public/console/views.js:135-160` |
| Revenue and margin objectives | Built | `src/content/kinds.ts:643-648` |
| Autonomy (the engine proposing or applying weight changes) | Withdrawn: "Autonomy cycles and proposal changes are unavailable" | `src/learn/cycle.ts:2`, `:44-45` |
| External model term (the customer's own model in the score) | Withdrawn by deployment policy | `src/content/service.ts:471-479`; test `src/content/consent.test.ts:1059` |

### 5.7 The honesty wording, reused exactly

- From the Vantage facts sheet: "Stage two moves nothing until γ moves." (`docs/verizon/explainer/FACTS.md:536`).
- As published in the explainers: "It records from day one and moves nothing until the dial moves."
  (`docs/verizon/Vantage-Signal-System-Technical-Note.md:231`); "Learning records from day one and moves nothing
  until the dial moves" (`public/vantage/how-it-works.html:310`).
- The Vantage sheet's "Never say" list: "We don't use a model." ("The decision is itemised arithmetic, but a model
  seam exists"); "Any lift or revenue claim." ("Inference is `unavailable`"); any latency claim; anything judging
  the customer's past work, "no limit", a bandit winner, another customer's name (`docs/verizon/explainer/FACTS.md:542-547`).

---

## 6. The Opal boundary and the commercial lines

### 6.1 What in the decision path calls a model: nothing

- The decision function is pure: "No I/O, no clock, no randomness" (`src/content/decide.ts:1-6`). The interest
  arithmetic: "NO ML" (`src/reflex/core.ts:21-22`). The external model term is withdrawn: "Stored settings cannot
  authorize runtime inference or external work" (`src/content/service.ts:471-479`). **Built**, with a test
  (`src/content/consent.test.ts:1059`). `/sort` calls no model (`src/reflex/sortCandidates.ts:126-177`).
- **Where this repository does call a model**, always outside the snapshot path:
  - **Typed search** (`POST /search`): the tenant's own Google Gemini key reads the shopper's query, then the
    tenant's catalog-search service fetches candidates; only when both connectors are configured
    (`src/routes/search.ts:35-71`; `src/connectors/config.ts:66-70`; `src/connectors/model.ts:68-101`). Built
    locally, off by default.
  - **Design-time tagging** ("enrichment"): an operator asks for label proposals from the tenant's Gemini key; a
    person approves, rejects or edits each label before anything is published (`src/content/enrichmentGeneration.ts:10-30`;
    `src/content/enrichment.ts:1-26`). Built locally, off by default.
  - **Demo only**: the `OpalAgent` chat (Gemini 2.5 Flash by default), the `/ai` concierge and `/ai/scene` image
    generation. All are refused under enforced mode and absent on customer stamps (`src/agents/OpalAgent.ts:18`;
    `src/index.ts:226-246`; `src/customerBoundary.ts:10`).

### 6.2 What Opal does, and what of it is in this repository

- The documented rule: "The engine decides; Opal creates and explains." Live decisions use no AI and consume no
  credits; authoring, explaining and analysis are Opal and are credit-metered
  (`docs/Opal-Credit-Boundary-Pricing-Guide.md:8-14`, §2).
- **Not wired**: no integration with the Opal product. Live audience authoring through the Opal MCP endpoint throws
  "not wired" (`src/connectors/AudienceAuthoring.ts:190-211`; `src/connectors/index.ts:46`). **Open.**
- The `OpalAgent` here is a **demo stand-in** built on Gemini: it queries the demo D1 and creates real Feature
  Experimentation audiences and flags only behind a write switch (`src/agents/OpalAgent.ts:1-60`;
  `src/agents/tools.ts:46-140`; `docs/demos/BOOTSTRAP.md` §5.1 "Landmines"). **Correction to carry:** the pricing
  guide says Opal creates audiences "in ODP" (`docs/Opal-Credit-Boundary-Pricing-Guide.md:23`); the demo agent
  creates them in Feature Experimentation (`src/agents/tools.ts:71-76`).
- The engine's own explanations (receipts and their sentences) are produced as data, with no model
  (`src/learn/receipts.ts:1-4`; `src/reflex/merchandising.ts:162-170`).

### 6.3 The commercial lines, as the repository describes them

| Line | Meter | As described | Status |
|---|---|---|---|
| The engine (platform) | Traffic: platform fee plus usage (per monthly tracked visitor or per thousand sessions) | `docs/Opal-Credit-Boundary-Pricing-Guide.md` §3 item 1. The monetization brief recommends a monthly platform fee per stamp, banded by engaged sessions, plus a one-time implementation SOW and a support tier; or a per-MAU add-on with a stated engagement envelope on existing order forms (`docs/Monetization-Legal-Brief.md:13-16`) | **Designed** (a recommendation). Rates and packaging "are monetization's decisions" (`docs/Monetization-Legal-Brief.md:5`): **Open**. No usage meter exists in the code (a search of `src` for billing, metering, MAU or engaged-session counters finds none): build item. The cost model assumes the object host (`docs/Edge-Unit-Economics.md` §3), which serves no stamp today (`wrangler.toml:252`, `:351`) |
| Opal credits | Team activity, never traffic | `docs/Opal-Credit-Boundary-Pricing-Guide.md` §1, §3 item 2 | Nothing in this repository consumes Opal credits, because no Opal integration is wired. Whether design-time tagging, which calls Google under the tenant's own key here, is billed as Opal credits is not decided in any document found: **Open** |
| Shopper-facing AI features (search, advisor, generated imagery) | Per use | `docs/Opal-Credit-Boundary-Pricing-Guide.md` §2 "DURING", §3 item 3 | Typed search: built locally, off by default (`src/routes/search.ts:40`). Advisor and generated imagery: demo only (`src/index.ts:231-233`) |
| ODP and Feature Experimentation | Their own licences | "ODP (the memory), Feature Experimentation (activation/testing), Opal credits (authoring + insight), plus the engine itself … and optional shopper AI features" (`docs/Opal-Credit-Boundary-Pricing-Guide.md:68`) | Neither is in the content decision path; neither can be configured on a customer stamp today (§7.3, §7.4) |

Guardrails as written: never price per event; never blend the platform meter with credits or AI features
(`docs/Monetization-Legal-Brief.md:16`, §4.4). An older explainer (`docs/Content-Personalization-Explained-Simply.md`
§7–§8) predates the build and quotes deployment times and speed; it is not a source for claims.

---

## 7. Integrations

### 7.1 How a site sends events and receives decisions

- **The SDK** (Built): served by the platform at `/sdk/edge-personalization.js` and `.esm.js`
  (`src/customerBoundary.ts:144-146`). Three parts: Core (the server-issued capability, sessions, transport), Emit
  (events up), Listen (decisions down) (`src/sdk/README.md:1-11`). Four capture paths: an explicit API for commerce
  events, declarative `data-op-*` attributes, a dataLayer adapter with default GA4 names, and the renderer callback
  that acknowledges a paint (`src/sdk/README.md:85-120`). A listen-only mode for a site that
  keeps its own analytics pipeline; `identify` and `logout` (`src/sdk/README.md:152-195`). If no decision arrives
  within a configurable deadline (`hydrateTimeoutMs`), subscribers receive an empty set and the site's default
  renders (`src/sdk/README.md:53-58`, `:247`).
- **Events**: `POST /realtime/action` (§3.3). **Decisions**: the snapshot route (§3.8), refreshed after acknowledged
  interactions and on reconnect. "No production `content_decisions` push is promised"
  (`src/sdk/README.md:60`).
- **Server-first paint**: a source module, `src/sdk/server.ts`, "not a browser global or a claimed published npm
  artifact"; "Real host SSR/browser/no-flash and latency acceptance remain open" (`src/sdk/README.md:68`, `:83`).
  **Open.**
- **Native apps**: no native SDK; "never sell it as available" (`docs/PS-Implementation-Runbook.md:142`).

### 7.2 Products: sort and search

- **`POST /sort`** (Built): up to 500 candidates, each carrying the registry's attribute fields; the same ids come
  back in a per-visitor order. Score = dial × Σ (interest × dimension weight), weights clamped 0 to 10 with a
  default of 1 (`src/routes/sort.ts:39`, `:112-151`; `src/reflex/sortCandidates.ts:126-177`). It never filters ("If
  the platform sent it, it is eligible") and is stable on the platform's order, so a dial of 0 returns the
  platform's order exactly (`src/reflex/sortCandidates.ts:12-33`, `:169-174`). It uses the visitor's own interest; no
  seeds, merchandising, stage, learning or pins. Since `2313527` it also applies the regional prior, but only for a
  tenant that publishes `learn.regional.dimensions` (`src/content/sortPrior.ts:1-19`; `src/routes/sort.ts:124-141`).
- **`POST /sort/intent`** (Built): structured filters with a required stock flag per candidate
  (`src/routes/sort.ts:155-225`).
- **`POST /search`** (Built locally, off by default): §6.1.
- **The commerce-grid patterns.** Pattern A, re-ranking what the commerce platform returns, is the `/sort` contract.
  Pattern B, the engine holding a product catalog snapshot, is not built for customer tenants
  (`docs/Tapestry-Product-Grid-Sorting-Answer.md`, "Pattern A", "Pattern B"; `src/demos/registry.ts:220-225`).

### 7.3 ODP

- **Built for the default demo tenant**: behavioural events forwarded to ODP's events API, and qualified real-time
  audiences seeded back from its GraphQL API, live-verified against a demo instance on 2026-07-03
  (`src/services/odpLoop.ts:1-27`, `:52-64`).
- A per-tenant ODP connector schema exists (`src/connectors/config.ts:41-44`), but the customer stamp workflow admits
  only telemetry, enrichment, search, catalog-search and warehouse connectors (`scripts/stamp-workflow.mjs:228`;
  `docs/deployment/01-deploy.md:32`, `:36`: "behavioral external connectors remain disabled").
- ODP data does not reach the content decision: the decision reads the interest vector and its memberships only
  (`src/content/service.ts:205`, `:532`); ODP's audiences ride the session's segment list
  (`src/services/SessionManager.ts:640`).
- **Open** for customer stamps (`docs/handover/HANDOFF-2026-09-18.md` §8, D10).

### 7.4 Feature Experimentation and CMAB

- **Generation 1 demo path**: flags decided through the FX SDK and its public datafile when
  `DECISION_SOURCE=optimizely` (`src/connectors/index.ts:53-61`; `wrangler.toml:167-178`); the demo agent creates
  real FX audiences and flags behind `OPTIMIZELY_WRITE_ENABLED` (`docs/demos/BOOTSTRAP.md` §5.1).
- **`/experiment`** (A/B, MAB, CMAB): a demo seam with representative numbers; "the demo simulates the outcome, it
  does not run a live bandit" (`src/services/cmab.ts:1-13`). Refused under enforced mode (`src/index.ts:233`).
  Optimizely's own CMAB product is outside this codebase.
- **Customer stamp**: no FX connector is admitted (`scripts/stamp-workflow.mjs:228`). The content engine measures
  itself with its own holdout (§5.3). **Open.**

### 7.5 Warehouse and history

- Export listing: `GET /v1/{tenant}/ledger/batches` names a day's ledger objects for a warehouse job
  (`src/routes/decisions.ts:681-697`). Built.
- Snowflake delivery through its SQL API: built locally, disabled by default, not live-verified
  (`src/connectors/config.ts:78-89`; `docs/handover/HANDOFF-2026-09-18.md` §7 "Snowflake engineering", §8 risks).
- Historical import: `POST /v1/{tenant}/identity/events`, by an operator, at most 1,000 rows per request, each row
  faded as an action that arrived late (`src/identity/history.ts:1-20`; `src/routes/identity.ts:462`). Built.

### 7.6 Field mappings

- **SFCC**: no field mapping in the repository; SFCC rendering and acceptance are listed as open customer evidence
  (`docs/kit/01-integration-guide.md:21`, `:254`; `docs/PS-Implementation-Delivery-Guide.md:5-7`). **Open.**
- **Content metadata** to piece fields: `docs/PS-Implementation-Delivery-Guide.md` §7.1. **Correction to carry:** its
  embedding row says an embedding model "scores as the external model term (`learn.external`)"; that term is
  withdrawn (`src/content/service.ts:471-479`).
- The only promotion-grid mapping documented is the carrier demo's (`docs/verizon/explainer/FACTS.md` §11), and it is
  demo-specific.

### 7.7 What a customer must provide

| What we need | What we use it for | Who provides it | Where it enters | Source |
|---|---|---|---|---|
| The exact origins (scheme and host) their pages call from, for staging and production | The cross-origin allow-list | The customer's platform team | `CORS_ORIGINS` | `docs/kit/00-README.md:23`; `wrangler.toml:242-244` |
| A site key per brand (or we mint one) | Identifies the site and binds the tenant on every shopper call; not a secret | Either | `SDK_KEYS` | `docs/kit/00-README.md:24`; `src/middleware/edgeAccess.ts:76-121` |
| The dimension registry: the dimensions, the field each reads, the action weights, the memory settings | What the engine scores on and how fast it forgets | The customer with Professional Services | The `reflex` document | `docs/PS-Implementation-Runbook.md` §5 item 1; `src/reflex/configStore.ts:299-365` |
| A content feed: each piece's own id, type, title, tags in the registry's vocabulary, slot types, render URL, windows | The catalog the engine ranks | The customer's content team | `/content/catalog/import` or `/pull` | `docs/kit/00-README.md:25`; `src/content/kinds.ts:34-36` |
| A slot map: pages, slots and each slot's default | The slots document; the defaults render whenever the engine is silent | The customer's front-end and merchandising owners | The `slots` document | `docs/PS-Implementation-Runbook.md` §5 item 4 |
| Product events carrying the product id and the registry's attribute fields | Building interest, because the engine holds no product catalog for a customer tenant | The customer's tag owner | `POST /realtime/action` | `src/reflex/core.ts:491-510`; `src/demos/registry.ts:220-225` |
| The conversion event: order id, value, currency, items | Outcomes for attribution and learning | The customer's commerce and analytics owners | `POST /realtime/action` (`purchase`) | `docs/kit/00-README.md:26`; `src/ledger/records.ts:121-152` |
| An explicit consent choice from their consent banner | Without it nothing personalizes and nothing is recorded | The customer's privacy owner | `POST /realtime/session/preferences` | `src/content/consent.ts:7`; `docs/kit/01-integration-guide.md:5` |
| A signed identity proof at sign-in, and the secret behind it | Merging the anonymous and signed-in profiles | The customer's backend | `IDENTITY_SECRETS`; `/v1/{tenant}/identity/link` | `src/identity/assertion.ts:11-18` |
| Retention periods per data category | Required before anything policy-dependent is captured | The customer's privacy owner | `RETENTION` | `src/retention.ts:49-75`; `docs/handover/HANDOFF-2026-09-18.md` §8, D06 |
| A person who runs the connection check from inside their network | Proves the network path from their side | The customer | `scripts/verify-origin.sh` | `docs/kit/00-README.md:27` |

Optional: candidate lists for `/sort` (the commerce platform); a catalog-search service and a model key for
`/search`; historical rows for import.

---

## 8. Privacy and security posture, as built

### 8.1 Tenant isolation — Built

- Every tenant's keys carry `t:<tenant>:`; only the default demo tenant is unprefixed, so existing demo data never
  moved (`src/tenancy/tenant.ts:11-25`, `:156-171`). Per-visitor object names are namespaced the same way
  (`src/tenancy/objects.ts:33-45`). A caller-supplied key or visitor id that starts with the marker is refused
  (`src/tenancy/tenant.ts:65-76`; `src/routes/decisions.ts:541-543`).
- Configuration is per tenant scope (`src/config/publication.ts:64-69`); statistics and the ledger are keyed by
  tenant and brand, and "Nothing pools across brands" (`src/learn/fan.ts:71-74`; `src/ledger/records.ts:168-173`;
  `docs/architecture/22-outcome-learning-design.md` §15). Isolation tests use two non-default tenants, because only
  that pair can fail (`src/tenancy/tenant.ts:19-25`; `src/tenancy/storeIsolation.test.ts`).
- Across customers: a separate stamp per customer (`docs/PS-Implementation-Runbook.md` §9; `wrangler.toml:231-423`).
  The demo workers share KV, R2 and D1 and rely on tenant prefixes (`scripts/build-demo-worker-config.mjs:42-44`).

### 8.2 `X-Tenant` — Built

The tenant is resolved once per request from the `/v1/{tenant}` path, the `X-Tenant` header, a socket's `?tenant=`,
and the host map. All must agree on a provisioned tenant; with no selector at all, only the default tenant answers,
and only if it is provisioned (`src/tenancy/tenant.ts:94-145`; `src/tenancy/middleware.ts:77-116`). The provisioned
list is what stops the header being "AN UNAUTHENTICATED BRAND SELECTOR" (`src/tenancy/tenant.ts:105-118`). A
customer profile must declare its tenants (`src/tenancy/middleware.ts:53`). A demo page must send `X-Tenant`, or a
single-tenant worker answers "Tenant unavailable" (`AGENTS.md`, "No demo page carries a credential";
`src/tenancy/middleware.ts:109-113`).

### 8.3 Access — Built

- Profiles and modes: §2.5.
- The site key identifies the site and is not a secret (`docs/kit/00-README.md:24`); the server keeps the key table
  as a secret setting (`src/types/env.ts:132-133`). A wildcard key works under enforced mode only on a stamp with a
  single tenant (`src/middleware/edgeAccess.ts:100-121`).
- The shopper capability is required on every shopper route, in every mode (`src/identity/sessionCapability.ts:10-25`;
  `src/sdk/README.md:214`).
- Operator routes: a JWT plus a grant for the tenant (`src/middleware/operatorAuth.ts:11-48`); a sign-in budget
  (`src/durable-objects/RateLimiter.ts`; `src/auth/loginBudget.ts`).
- CORS: the allow-list, the same origin and the local dev server (`src/middleware/edgeAccess.ts:31-73`); standard
  security headers on every response (`src/index.ts:67`); a per-visitor ingest cap of 240 events a minute by
  default on the object host (`src/durable-objects/ShopperReflex.ts:308-310`).

### 8.4 Consent — Built

§3.2. Off until an explicit choice; 30-day choices; tracking off writes nothing.

### 8.5 What is stored, and what is never stored

**Stored, with tracking consent:** pseudonymous visitor and session ids; per-dimension interest state; visit and
journey counters; decision records with the cell (channel, visit band, region key, leading interest, stage) and the
vector as scored (`src/content/types.ts:451-548`); outcomes with value, currency, margin and product ids
(`src/ledger/records.ts:121-152`); a typed behaviour projection that excludes "arbitrary raw data, query, URL, IP,
cookies, credentials, geography or private affinity" (`src/ledger/behavior.ts:1-5`); region counts with no visitor
ids (`src/durable-objects/RegionTrend.ts:1-6`); learning counts with no identifiers
(`docs/architecture/22-outcome-learning-design.md` §15); identity links with no raw account id
(`src/identity/store.ts:14-16`).

**Never stored:**

- Asserted `ctx.*` conditions, as evidence about the visitor (`src/content/service.ts:498-513`;
  `src/routes/decisions.ts:567-573`); they are not on the record (`src/demos/kit/helpers.ts:94-98`).
- The arrival beyond its classified channel and any seed that fired (`src/content/decide.ts:78-86`).
- Any device detail beyond `ios` or `android`, kept only as a fired seed driver; no fingerprinting
  (`src/services/platform.ts:1-16`).
- The raw account id (`src/identity/shopperId.ts:5-11`; `src/identity/history.ts:6-7`).
- A credential in any demo page (`AGENTS.md`; `src/routes/topOffers.ts:10-31`).
- The render offer token, which the SDK never logs, exports or stores (`src/sdk/README.md:66`).

### 8.6 The identity salt — Built

`IDENTITY_SALT`, a secret, salts the shopper id; without it a dictionary of account ids could be checked against
the hashes. An unsalted fallback exists for demos and tests and is recorded on each link as `salted: false`
(`src/identity/shopperId.ts:13-17`, `:31-34`); safe-identity mode refuses to run without a salt where one is
required (`src/identity/shopperId.ts:49`). The stamp workflow refuses any change of salt, because it would orphan
existing shoppers (`docs/deployment/01-deploy.md:16`).

### 8.7 No credential in static assets — Built

`public/` is served whole, so a token written there is "a credential anyone with the URL can fetch" (`AGENTS.md`).
The pattern: a demo page names an action and the worker performs it (`src/routes/topOffers.ts:16-31`). The demo kit
greps everything a demo's pages load for token shapes, forbidden file names and any value from the local secrets
file (`scripts/demo-kit/lib/credentials.mjs:1-27`).

### 8.8 Retention and erasure

- `RETENTION` sets an explicit policy per tenant and per category (profile, identity, ledger, online, hourly,
  recovery, quarantine, and per-destination external and telemetry categories). A missing category has no default
  and refuses capture that depends on it (`src/retention.ts:5-8`, `:49-75`; `docs/handover/HANDOFF-2026-09-18.md` §7
  "Retention"). Built.
- A session record expires at the earlier of 30 days and its retention (`src/services/SessionManager.ts:96`,
  `:352-353`).
- **Erasure**: `POST /v1/{tenant}/identity/erase` (`src/routes/identity.ts:525`), described in the code as "Bounded,
  manually resumable LOCAL erasure steps. This is not a deletion epoch, replay barrier, exhaustive discovery or proof
  of physical/external erasure" (`src/identity/erase.ts:1-2`). Ledger tombstones are honoured by every reader at
  once; the nightly rewrite removes the rows over `LEDGER_RETENTION_DAYS` (default 90), which must match the R2
  bucket's lifecycle rule (`docs/architecture/22-outcome-learning-design.md` §15; `src/ledger/erasure.ts:65`,
  `:121-125`; `src/types/env.ts:32-37`; `src/index.ts:307-313`). Console: Erasures (`public/console/views.js:550-552`).
- **Open**: the actual periods and the disposition of history (`docs/handover/HANDOFF-2026-09-18.md` §8, D06).

### 8.9 Logs

Persistent observability and invocation logs are off in every configuration, described as "Desired local controls,
not evidence of deployed settings" (`wrangler.toml:218-226`). Log lines are fixed phrases and counts
(`src/index.ts:280-322`).

### 8.10 Security notes on record

- Staging accepted the example site key `demo-site` on 2026-09-05, and the document recommends replacing it
  (`docs/architecture/32-latency-numbers.md` §7). Current state: **unverified**.
- The capability and site-key transports "remain sensitive" (`src/sdk/README.md:206-208`).
- `/__shot` runs arbitrary JavaScript in a real browser, so it does not exist without a token and is refused under
  enforced mode (`src/routes/shot.ts:17-27`; `src/index.ts:233`).

---

## 9. Scale, performance and limits, as known

### 9.1 What has been measured, and where (no figures quoted)

- **Staging latency**: `docs/architecture/32-latency-numbers.md`, 2026-09-05, one machine, forty calls per row. Its
  own conclusions, without its numbers: the engine's decision step is not measurable at that resolution; a
  never-seen shopper's first request was dominated by session storage work; "No pilot target is met yet on the
  first request" as of that day; §5 records changes made the same evening. Not re-measured since. Any timing claim
  must come from a fresh run of `scripts/latency.mjs` on the target stamp (doc 32 §6), and the audit calls forty
  samples "weak tail evidence" (`docs/architecture/35-audit-verification-and-source-of-truth.md:492`).
- **Staging load test**: `docs/architecture/31-load-test-2026-09-05.md`.
- **The monitor** samples one real decision per tenant every five minutes; "Single samples are diagnostics, not
  SLOs" (`src/ops/monitor.ts:1-7`). The monitor's functional flows passed while its latency thresholds failed
  (`docs/handover/HANDOFF-2026-09-18.md` §8, risks).
- **Hosted demo suites** are functional checks, not timings: Vantage version `f20c11dd`, request level 115 of 115 and
  DOM 292 of 292 (`docs/verizon/RESUME-vantage.md:3`, `:26`); Top Offers has its own pair
  (`docs/demos/BOOTSTRAP.md` §10).
- **Volume observation**: the report route refused (413) after 4,859 decisions in one day; the request was then
  shaped inside its budget (`docs/verizon/Vantage-Demo-Design.md` §12, 2026-09-30 R1 entry).

### 9.2 Why the decision step has not been timed

"A deployed Worker clock advances with I/O, not synchronous CPU work; a pure scoring stage can report zero without
being free" (`docs/architecture/35-audit-verification-and-source-of-truth.md:494`). The design log records that a
zero reading for the decide stage "is not a measurement" (`docs/verizon/Vantage-Demo-Design.md` §12, 2026-10-01 E1
entry). What can be said is a count: per candidate, one lookup and multiply-add per tag value on a weighted
dimension, a check per seed tag, up to three merchandising factors and one power (`docs/verizon/explainer/FACTS.md`
§2, "Cost").

### 9.3 Limits in code (application budgets, not measured capacity)

| Limit | Value | Source |
|---|---|---|
| Registry | 32 dimensions, 200 weights, τ at most 90 days, at most 1,000 values per dimension | `src/reflex/configStore.ts:134-136`, `:318` |
| Slot | 1–50 pieces, weights 0–1, pins ≤ 50, exclusions ≤ 1,000, seeds ≤ 100 rules, ≤ 50 tags, ≤ 4 dampen entries | `src/content/kinds.ts:253`, `:327-358` |
| Eligibility rule | 1–64 regions; 1–8 conditions × 1–32 values of ≤ 64 characters | `src/content/kinds.ts:126-160` |
| Snapshot | ≤ 8 `ctx` conditions; body ≤ 8 KiB; answer ≤ 2 MiB | `src/routes/decisions.ts:530`, `:574-581`, `:641` |
| Sort | ≤ 500 candidates; body ≤ 2 MiB (intent ≤ 256 KiB) | `src/routes/sort.ts:39`, `:112`, `:199` |
| Document | ≤ 2 MiB each | `src/config/publication.ts:7` |
| Event attributes | ≤ 8 values per field, ≤ 64 characters | `src/reflex/core.ts:340-341` |
| Ring | 200 decisions, 7 days | `src/durable-objects/DecisionRing.ts:36`; `src/learn/stats.ts:34` |
| Learning object | 256 pieces per slot | `src/learn/stats.ts:118`; `src/durable-objects/LearnStats.ts:24-27` |
| Day report | 50,000 records; 16 MiB raw; 800 objects; 6 policies | `src/learn/report.ts:26-31` |
| Ledger messages | 120,000 bytes per body; 240,000 per batch; 100 per batch | `src/ledger/enqueue.ts:19-21` |
| Queue consumer | Batches of 100, concurrency 6, 2 retries, then the dead-letter queue | `wrangler.toml:29-42` |
| Historical import | 1,000 rows per request | `src/identity/history.ts:18-19` |

### 9.4 Known engine findings (build items, with where each starts)

From `docs/verizon/RESUME-vantage.md` "Known engine findings", unless noted.

1. The object host stalls the ledger consumer under a burst of snapshots, so every configuration runs the session
   host. Starts at the owner forward in `src/identity/sessionAuthority.ts:178`; a timeout was proposed and not built
   (finding 1; `docs/verizon/Vantage-Demo-Design.md` §12, 2026-09-30 L4 entry).
2. Rare slow reads on the session host; same owner forwards (`src/identity/sessionAuthority.ts:178`, `:290-302`)
   (finding 2).
3. Report builds raise "Configuration publication authority unavailable" in `LearnStats.priorsFor`
   (`src/durable-objects/LearnStats.ts:851-855`) (finding 3).
4. On the session host a membership flag outlives its score until the visitor's next event; ranking reads the
   score (finding 4).
5. The local session-host ledger consumer stalled twice after report builds; the cause is a hypothesis (finding 5).
6. A busy hour can fail to fold on every run without a logged cause; the report then lists it as missing (finding 6).
7. Hosted, once: a receipt was written late after a report build; cause not caught (finding 7).
8. A pin whose piece is ineligible empties the whole slot (`src/reflex/contentCompose.ts:184-199`, `:229`); W20's
   territory (finding 8).
9. The regional prior is fed by every visitor's events, rehearsals included (finding 9).
10. The day report has no window narrower than a UTC day and sums only folded hours once any has folded; a
    publish-time check that a listed regional dimension exists in the registry is not built
    (`docs/verizon/Vantage-Demo-Design.md` §12, 2026-09-30 F1 and 2026-10-01 F2/F3 entries).

**Programme status.** The remediation programme (W16–W41) stopped on 2026-09-20 on the owner's order, "stop
everything and regroup with the architecture board" (`docs/remediation/RESUME.md:3`). Its last derived score:
"Units 191/199 · W closed 4/26 (W16–W41) · suite 2053/2132 · residual 79 in 9 files · typecheck GREEN"
(`docs/remediation/SCORE.md:8`). This lane did not run the suite; today's pass count is unverified.

### 9.5 Not measured

Production τ on real traffic; ten thousand candidates; the object host under sustained load; customer
server-first paint and flash; customer browser, SFCC, provider or warehouse acceptance; cost on real traffic (the
cost model is a model) (`docs/verizon/explainer/FACTS.md` "Not sourced"; `src/sdk/README.md:83`;
`docs/kit/04-staging-connection.md:11`; `docs/architecture/35-audit-verification-and-source-of-truth.md:496`).

---

## 10. Built, designed, open

### 10.1 Capabilities a salesperson might claim

| Capability | Status | Evidence | What a customer deployment needs, or the caveat |
|---|---|---|---|
| Anonymous, in-session personalization from the first event | Built | §3.3–§3.4; `src/reflex/core.test.ts`; Vantage hosted | Consent, a registry, a catalog, events carrying attributes (§7.7) |
| Graded, fading interests with audience entry and exit | Built | `src/reflex/core.ts:553-662` | Production τ and lines are an owner input (Open) |
| Exit by time alone, pushed at the exact moment | Built on the object host; not the serving host anywhere | `src/reflex/core.ts:704-731`; `wrangler.toml:252` | On the session host the exit is computed at the next read |
| Regional prior for strangers | Built | §3.6; `src/content/service.regionalDimensions.test.ts` | The region's counts come from the site's own events; demos seed synthetic, labelled data |
| Census-based geo cold start | Demo only, shown not scored | `docs/verizon/explainer/FACTS.md` §3; `docs/demos/BOOTSTRAP.md` §5.1 | Not a content-engine input |
| Arrival seeds (campaign term, channel, referring network, OS family) | Built | §3.11; `src/content/seedPlatform.test.ts` | Published on the slots document; no console screen |
| Eligibility (windows, stock, regions, named conditions) | Built | §3.9 | Conditions are asserted by the caller and only gate |
| Merchandiser controls (pins, off-limits, exclusions, diversity, multipliers, stage, freshness, fatigue) | Built | §3.10–§3.11; `src/reflex/contentCompose.test.ts`; `src/reflex/merchandising.test.ts` | An ineligible pin empties its slot (§9.4) |
| "Completes what she committed to" (anchor product) | Built, not yet on a hosted demo | `2313527`; `src/content/complements.test.ts` | The page sends `ctx.anchor`; pieces list `complements` |
| Receipts for every decision | Built | §3.14 | Four strongest tag terms only; operator access |
| Replay | Built | `src/learn/replay.ts:1-8` | Exact for one slot; never claim it for a whole page |
| Versioned configuration without deploys; operator console | Built | §4 | No catalog or seed screen; publication propagation has no SLO |
| Product re-ranking within a supplied list | Built | §7.2; `src/reflex/sortCandidates.test.ts` | Candidates must carry the registry's attribute fields |
| Typed search with a model | Built locally, off by default | `src/routes/search.ts:35-71` | The tenant's own model key and catalog-search service; live acceptance Open |
| Design-time content tagging, human-approved | Built locally, off by default | `src/content/enrichmentGeneration.ts:10-30` | Provider approvals; sample calibration Open (`docs/PS-Implementation-Delivery-Guide.md:5-7`) |
| Outcome attribution and the day report | Built | §3.15–§3.16; `src/learn/report.test.ts`; `src/learn/hourly.test.ts` | An attribution diagnostic; inference unavailable |
| Learning that changes rankings | Built, dial at 0 | §5.2 | Raising γ is a published setting; the experiment design is Open (D04) |
| Holdout arms | Built | §5.3; `src/learn/holdoutArms.test.ts` | Demos run 0 % |
| Exploration (rotation, epsilon) | Built, off | §5.4 | Which is offered: Open (D05) |
| Thompson sampling, autonomy, the customer's own model in the score | Withdrawn | `src/content/kinds.ts:652`; `src/learn/cycle.ts:2`; `src/content/service.ts:471-479` | Do not offer |
| Imported priors | Built | `src/learn/priors.ts` | Not exercised by a hosted demo: unverified in use |
| Named partner outcomes (pickup, referral) | Built, not yet on a hosted demo | `2313527`; `src/learn/namedOutcomes.test.ts` | Never reported as a sale |
| Paid-search classification from an auto-tagged click | Classification built; the wire still refuses the click id | `src/services/visit.ts:381-395`; `2313527` commit message | Widening the entry contract is left to the remediation track |
| Position-bias correction | Designed | §5.5 | Build item P05 |
| Module sequencing and per-context layout | Designed | `docs/BTI-Parity-and-Mechanism.md` §3; tickets P01–P08 | First build item: per-context layout configuration (parity §3.8) |
| Embeddings and a semantic term | Designed | `docs/BTI-Vector-Embeddings-Design.md`; no embedding code in `src` | Tickets P17–P25 |
| Sign-in merge of anonymous and known profiles | Built | §3.1; `src/reflex/identityMerge.test.ts` | The customer's backend signs the proof |
| Anonymous return recognition | Built, off until configured | §3.1 | Production window and purpose: Open |
| Consent gating | Built | §3.2; `src/content/consent.test.ts` | The site must pass an explicit choice |
| Erasure | Built locally | §8.8 | "not … proof of physical/external erasure" |
| Multi-brand tenancy and isolation | Built | §8.1–§8.2; `src/tenancy/storeIsolation.test.ts` | Tenants are declared in `TENANTS` by an engineer |
| ODP loop | Built for the default demo tenant | §7.3 | Not configurable on a customer stamp: Open (D10) |
| Feature Experimentation, CMAB | Demo seams | §7.4 | Not in the content decision; not configurable on a stamp |
| Opal authoring and explanation | Not wired; demo stand-in only | §6.2 | Open |
| Server-first paint without flash | Source module built; acceptance Open | §7.1 | — |
| Native mobile SDK | Not built | `docs/PS-Implementation-Runbook.md:142` | "never sell it as available" |
| Usage metering for billing | Not built | §6.3 | Open |
| Latency figures | Measured on staging once; not quotable | §9.1 | Re-measure on the target stamp |

### 10.2 The implementation path for a customer deployment, as the repository has it

| Step | What exists | Status | Source |
|---|---|---|---|
| Provision a stamp | `scripts/stamp-workflow.mjs`: plan, package, create, reconcile, add-brand, rotate, upload, promote, rollback, restore; mutating modes need `--execute`, a protected authorization record and evidence | Built locally; "not deployment approval" | `docs/deployment/01-deploy.md:3`, `:9-24` |
| Secrets and settings | Required secrets `JWT_SECRET`, `SDK_KEYS`, `IDENTITY_SALT`, `IDENTITY_SECRETS`, `ALERT_WEBHOOK_URL`; required vars `JWT_ISSUER`, `JWT_AUDIENCE`, `REFLEX_HOST`, `RETENTION`, `TENANT_CONNECTORS` | Built (validated) | `docs/deployment/01-deploy.md:32-36` |
| Database migrations | Product migrations 0010–0013 only (operator accounts, audit, authority, SSO); demo migrations and seeds never replayed | Built | `docs/deployment/01-deploy.md:42`; `migrations/product/` |
| First operator | One exact initial owner bootstrapped with a temporary password | Built | `docs/deployment/01-deploy.md:38` |
| Seeds | None for customers: no seed loop runs on a stamp | — | `docs/deployment/01-deploy.md:7` |
| The tenant's first configuration (registry, catalog, slots, learn) | No customer route; library capability only | Open (W08, D01) | `src/routes/demoBootstrap.ts:12-14`; `docs/kit/02-api-reference.md:530` |
| Connectors | Telemetry, enrichment, search, catalog search, warehouse admitted; ODP and FX not | Built for the admitted kinds; ODP and FX Open | `scripts/stamp-workflow.mjs:228` |
| Durable recovery (needed for rendered measurement) | Off by default; enabling needs approved recovery and quarantine retention | Open (D06) | `docs/deployment/01-deploy.md:34` |
| Connect the site | The integration kit: SDK, API reference, payload schemas, the staging connection check | Built | `docs/kit/00-README.md`; `scripts/verify-origin.sh` |
| The services motion | `docs/PS-Implementation-Runbook.md` (v0.2) describes the model "at handover", including a fleet manifest `stamps/{customer}.yaml` and an automated wire-check gate; neither the folder nor a wire-check script is in the repository. `docs/PS-Implementation-Delivery-Guide.md` is the engagement frame (phases P0–P7) | Designed | `docs/PS-Implementation-Runbook.md` §3, §11; `docs/PS-Implementation-Delivery-Guide.md` §4 |
| Live gates | Account ownership, provider permissions, approved retention and access, real quiescence, customer and release acceptance | Open | `docs/deployment/01-deploy.md:68` |

### 10.3 Questions with no answer yet

From `docs/handover/HANDOFF-2026-09-18.md` §8 unless noted. None of these may be answered in a customer document.

| # | Question | Owner named in the record |
|---|---|---|
| D02 | Milestones, staffing and contractual acceptance; "No defensible finish date is established" | Delivery and customer leadership |
| D03 | Production resource initialization, the host cutover, rollback and performance | Architecture, security, delivery |
| D04 | The production experiment: enrollment unit, metrics, allocation, windows, stopping | The customer's data science and business owners |
| D05 | Which exploration, autonomy and external-model promises are offered or withdrawn | Product, customer scope, architecture |
| D06 | Retention periods per category; the disposition of history; physical erasure progress | Privacy, security, customer |
| D07 | The real identity provider, onboarding and SSO acceptance | Identity owner, delivery |
| D08 | Customer, brand, environment and region topology; residency | Architecture, customer |
| D09 | Money semantics: currency, refunds, returns, priors | The customer's business and data science owners |
| D10 | Entitlements, feeds, SFCC, Snowflake, ODP and distribution acceptance | Commercial, customer, integration owners |
| — | Production memory horizon and thresholds (τ, K, lines) | Owner input (`src/reflex/core.ts:245-258`) |
| — | Anonymous return recognition: production window and purpose | Customer, privacy, delivery |
| — | The billing meter and rates; whether design-time tagging consumes Opal credits | Monetization (`docs/Monetization-Legal-Brief.md:5`) |
| — | How a customer stamp gets its first tenant configuration | W08 and D01 (`src/routes/demoBootstrap.ts:12-14`) |
| — | The architecture board's ruling on the findings in §9.4 | Architecture board (`docs/remediation/RESUME.md:3`) |

---

## Appendix A. Corrections to carry into any document drawn from older material

| Older statement | What the code says | Source |
|---|---|---|
| Doc 22 §15: consent "Absent means consenting" | Absent or expired consent is off | `src/content/consent.ts:7`; `docs/handover/HANDOFF-2026-09-18.md` §7 |
| Parity §3.7: rotation and a position discount are "both already in the engine's exploration modes" | No position term; rotation serves the least-observed piece | §5.5 |
| `src/middleware/edgeAccess.ts:4-12`: `open` is the default mode | The code default is `open`; every checked-in configuration sets `enforced` | §2.5 |
| `src/types/env.ts:113-115`: the shopper object's idle expiry defaults to 30 days | Its expiry follows the explicit retention stamp | `src/durable-objects/ShopperReflex.ts:1525-1528` |
| `wrangler.toml:187-188`: `TREND_ROLLUP_TENANTS` selects the roll-up | Dead configuration; the roll-up covers every provisioned tenant | §2.4 |
| PS runbook §2: D1 holds event capture; the queue carries generation work; R2 holds generated assets; `OpalAgent` and Browser are stamp resources | Customer D1 holds operator accounts; the queue carries the ledger; R2 holds configuration, the ledger and reports; `OpalAgent` and Browser must be absent on a customer stamp | §2.2–§2.3 |
| PS runbook §7: audiences generate from the customer's catalog automatically | The generator runs only for the default demo tenant on the demo profile | `src/services/RealtimeSegmentEngine.ts:328` |
| Delivery guide §7.1: an embedding model scores as the external term | The external term is withdrawn | `src/content/service.ts:471-479` |
| Pricing guide §2: Opal creates audiences in ODP | The repository's demo agent creates them in Feature Experimentation; no Opal integration is wired | §6.2 |
| `docs/Content-Personalization-Explained-Simply.md`: the content catalog is "being built now"; timing and deployment-time claims | The catalog and matching are built; timing is not quotable | §3; §9 |
| "ODP is the backbone" (older explainers) | The content decision reads no ODP data, and a customer stamp cannot configure ODP today | §7.3 |
| `AGENTS.md`: "two demo workers" | Its table lists three | §2.6 |
| `docs/Edge-Unit-Economics.md`: the production cost basis | Assumes the object host, which serves no stamp today | §6.3 |

## Appendix B. Not verified by this lane

1. The live state of the staging and production stamps (§2.6).
2. Whether staging still accepts the example site key (§8.10).
3. How a tracked event is answered on a customer stamp while durable recovery is off (§3.15).
4. Imported priors in use on any hosted worker (§10.1).
5. Today's test-suite pass count (§9.4).
6. Whether design-time tagging is billed as Opal credits (§6.3).
