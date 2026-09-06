# 33 · Adversarial audit brief for the global architecture team

**Audience:** the global architecture team, as independent reviewers. Internal only: this brief and several
documents it points to name a customer and carry internal dates, and none of it goes to any customer.

**Date:** 2026-09-06. **State audited:** branch `feature/real-time-personalization` at commit `5280ad1`,
deployed as staging version `e1135143` and production version `1c4049d5` the same day.

**Requested by:** Simone Coelho, Managing Principal Enterprise Architect, who runs the delivery.

---

## 0 · What we are asking you to do

The product is "Behavioral Targeting and Intelligence": an edge platform that decides, per shopper and per
request, which content and which products a customer's site shows, learns from the outcomes, and explains
every decision. Tapestry is the first customer, with Coach as the launch brand; the platform is built for
any customer, and the contract is Tapestry-wide, so the architecture must hold for brands and customers
we have not met.

Two engineering tracks built it over the last two months from one checkout, each owning named files,
with every decision, disagreement and handover written down as it happened. What we do not have is an
outside reading. We are asking you to be adversarial: assume the people who built this were wrong, and
find where.

Come back with four things:

1. **Missed requirements.** Anything the customer asked for, in their paper or in the calls, that the
   ledgers claim closed and the code does not deliver, or that nobody traced at all.
2. **Remedies.** For each finding, what to change, how large it is, and whether it must precede the
   January launch, the pilot, or can follow.
3. **Performance guidance.** We have measured numbers and two targets not yet met (§6). Tell us where
   the time should go, and whether the targets themselves are the right ones.
4. **The fitness question, answered plainly.** Is this the right architecture for Tapestry's stated
   requirements, and is it the right architecture for the next customer, whose catalog, brands, traffic,
   regions and privacy regime we do not know? If not, what would you change, and what would you keep?

A finding needs three parts to be actionable: the evidence (a file and line, a document and section, or a
number you measured), the consequence (what breaks, for whom, at what scale), and the remedy. A severity
per finding: **blocks launch**, **blocks the pilot**, **fix before the next customer**, **improvement**.

---

## 1 · The requirements, in the customer's words and in ours

Read these in this order. Every path is relative to the repository root.

| Read | What it is | Why it matters to the audit |
|---|---|---|
| `docs/architecture/tapestry_requirements.txt` | The customer's own vision paper, "Behavioral Targeting and Intelligence Engine", 593 lines. Sections 3 (the three-click adaptive experience), 5 (design principles and the phased capabilities) and 6 (measurement: incrementality over attribution, pre-set targets, the analytics flywheel) are the ones the platform is judged against | This is the source. Everything else is our reading of it |
| `docs/architecture/26-btie-requirements-gap-review.md` | Their paper reviewed clause by clause against what is built, with thirteen deltas D1 to D13 and a decision on each | Check that each delta was read correctly and that the "build nothing now" positions (D8 embeddings, D13 their later phases) are defensible |
| `docs/architecture/19-tapestry-delivery-ledger.md` | The contract picture from the 2026-07-24 call: contractual procurement milestones, Tapestry-wide with a Kate Spade pilot carried to Coach, the acceptance statement in the capability owner's words, their end-of-October need for the API in their lower environment, their November code freeze, January launch on one page. Internal dates live here and nowhere else | The dates and the acceptance statement are what "done" means |
| `docs/architecture/20-scope-truth-ledger.md` | Every clause the customer-facing proposal claims as built, with what stands behind it in code. Twelve capabilities; eleven closed; row 5 is partly open (§6 below) | Adversarial target number one: a claim marked closed whose evidence you do not accept |
| `docs/content-personalization-design-tapestry.html` | The Solution and Algorithm document as sent to the customer, revised 2026-09-04 to what is built | What the customer believes they are getting |
| `docs/Tapestry-Implementation-Plan.md` | The Implementation Plan, still a draft for their response; dates relative to a kickoff not yet set | Whether the plan matches the platform's real state |
| `docs/PS-Implementation-Delivery-Guide.md` | The professional services guide, including the mapping from the customer's content metadata table (their A.3.6) to our content piece schema | Whether a services engineer could implement this without the authors in the room |

Two rules from the delivery that you should know: the launch brand is Coach, settled by the customer's
capability owner; and support for sorting feeds from Salesforce Commerce Cloud or any other source is
committed scope and closed in code (`POST /sort`, ledger 20 row 9).

---

## 2 · The North Star and the design documents

| Read | What it is |
|---|---|
| `docs/architecture/18-content-affinity-engine.md` | The committed direction: content personalization as the reflex pointed at a second catalog, decisions by content ID, headless, explain records on every decision. The multi-customer thesis is stated here |
| `docs/architecture/16-edge-affinity-reflex.md` | The behavioral scoring underneath: a deterministic, decayed per-dimension affinity vector per shopper, catalog-generated audiences, instant membership. Not a model; arithmetic anyone can recompute |
| `docs/architecture/22-outcome-learning-design.md` | Stage two of the learning ladder, specified completely: the ledger, attribution as a four-axis policy, the six-level pooling ladder of decayed counts with shrinkage, lift, the holdout, exploration, the assisted autonomy cycle, imported priors, the external model hook, replay, consent and erasure. Every symbol defined where used. Written to be read by the customer's data scientists after light editing |
| `docs/architecture/25-identity-stitching.md` | Identity: a durable first-party visitor id, deterministic stitching on sign-in, historical transactions, what is deliberately not done (probabilistic cross-device) |
| `docs/architecture/15-edge-composition-design.md` | The later tier, experience composition, designed and not built; the May 2027 milestone |
| `docs/architecture/14-architecture-and-optimizely-capability-map.md` | How the platform relates to the rest of the Optimizely estate |

The position to test hardest: **nothing on the decision path is a model.** Shopper state is a decayed
vector; what works is a table of decayed counts with shrinkage toward the coarser level; the lift is the
ratio of two rates, clamped. The authors chose this for explainability, for a customer's data scientists
to recompute every number from the ledger, and for latency. Delta D8 in doc 26 records the decision not
to build embeddings, a vector store or lookalikes now, and leaves the external model hook as the seam.
Tell us whether that position survives the customer's section 5 and 6, and whether it survives a second
customer with a larger catalog.

---

## 3 · How the work was organized, and what each track built

| Read | What it is |
|---|---|
| `docs/architecture/21-tapestry-gap-closure-plan.md` | The working plan. The lane table at the top (CW0 to CW39), the milestones, the file ownership table (§ "Owner / Files"), and below it the handshake log: every request one track made of the other, and every answer, dated. This is the audit trail |
| `docs/architecture/23-parallel-session-handshake.md`, `24-handshake-reply.md`, `27-btie-deltas-handover.md`, `29-console-handover-reply.md` | The handovers between the tracks: who owned what, what was asked, what was declined and why |
| `docs/handover/00-readiness-summary.md`, `docs/handover/01-code-audit.md` | The previous internal audit, 2026-08-29, before the delivery tracks began: a 34-item list, the test harness and README findings. Use it as the baseline and check what was and was not remedied |

**The delivery track** built and owns: tenancy and the site-key gate, the catalog import seam, identity
stitching, the shopper object (`ShopperReflex`), the experiment and feature-variable services, the
operator application at `/console/` with server-side paging, the measurement window and confidence rules,
the journey-stage derivation, the latency measurement, and, in the last day, the session write leaving the
decision path and the object host accepting content events.

**The outcome-learning track** built and owns: the content decision service and its terms (stage,
freshness, fatigue, merchandising, diversity, inventory, consent), the SDK, the decision and outcome
ledger, attribution and the statistics objects, the holdout, exploration, autonomy, priors, the external
hook, replay, the day report and its hourly fold, erasure, operator sign-in and accounts, the self-monitor
and alerts, the staging and production stamps, the load test, and the integration kit.

The **integration kit** the customer's engineers receive is `docs/kit/00-README.md` through
`04-staging-connection.md`: the front page with what we need from them, the integration guide, the API
reference, the payload schemas, and the staging connection check both sides run. Every shape in it was
executed against the code before it was written down. Read it as the customer's engineer would.

---

## 4 · The architecture as deployed

One Cloudflare Worker per environment, called a stamp, serving every tenant of that environment.
Hono routes in `src/routes/`; the content decision path in `src/content/`; learning in `src/learn/`;
the ledger in `src/ledger/`; measurement in `src/measure/`; identity in `src/identity/`; the SDK in
`src/sdk/` (built to `public/sdk/`); the operator application in `public/console/`; the demo storefront in
`public/` on the same worker.

| Component | Used for | Where to look |
|---|---|---|
| Durable Objects | `ShopperReflex` (one per shopper, the object host), `DecisionRing` (a shopper's recent decisions, what attribution reads), `LearnStats` (one per slot, the decayed counts), `RegionTrend` (population priors by region) | `src/durable-objects/` |
| KV | `CACHE` (documents, snapshots, the lift table), `SESSIONS` (the session host's sessions) | `wrangler.toml` bindings |
| R2 | The ledger: decisions and outcomes as NDJSON objects under `{tenant}/{date}/{hour}/{stream}/`, named by the id range they hold; hourly aggregates and the batch ring shards under `aggregates/`; day reports; erasure tombstones | `src/ledger/writer.ts`, `src/learn/hourly.ts`, `src/ledger/erasure.ts` |
| Queues | The producer sends a decision set as one message; the consumer writes batches of a hundred messages or three seconds to R2 | `src/ledger/enqueue.ts`, `consume.ts` |
| D1 | Operator accounts, sessions as token hashes, the audit log; the demo's own tables | `migrations/`, `src/auth/` |
| Analytics Engine | A point per decision, outcome and monitor run | search `writeDataPoint` |
| Cron | Every five minutes: the self-monitor and the hourly fold. Hourly: the region trend roll-up. 03:00 UTC: the autonomy cycle, yesterday's day report, the erasure rewrite | `src/index.ts` `scheduled` |

Environments: `dev` (local, `wrangler dev`), `staging` (`edge-platform-staging.expedge.workers.dev`, its
own stores, the customer's lower environment connects here), `production`
(`edge-platform-production.expedge.workers.dev`, its own stores, no screenshot route). Secrets live only
on the worker: the JWT secret, the identity salt, the site keys per tenant, the alert webhook. Provisioning
is `scripts/provision-stamp.sh`; it generates every secret and prints the two a person keeps, once.

The test suite is 92 files and 1,089 tests at the audited commit, run with `npx vitest run`; the type
check with `npx tsc --noEmit`. Deploys are made from a throwaway worktree at HEAD, because the lint gate in
`scripts/deploy.sh` has never passed (§6). Continuous integration (`.github/workflows/ci.yml`) runs the
type check and the test suite on push; it does not gate the lint or the deploy.

---

## 5 · Decisions we want challenged

Each of these was taken deliberately and is recorded. For each, tell us whether you would have decided the
same, and what a second customer would expose.

1. **Counts, not models, on the decision path** (doc 22 §5). Decayed accumulators with a 21-day
   horizon, shrinkage strength 30 toward the slot's rate in the same cell, a minimum of 30 exposures
   before the finest level answers, lift clamped to the range one half to two.
2. **The six-level pooling ladder** (doc 22 §5, `src/learn/stats.ts` `levelKeys`): everyone, channel,
   channel and visit bucket, then journey stage, then region, then the affinity cell. The finest level
   with enough exposures answers. The order was changed once to put the journey stage before the region.
3. **Attribution as a policy** (doc 22 §4, `src/learn/policy.ts`): scope session or visitor, match
   direct or any, credit last or first, a window per reward type. The learning default is session, direct,
   last touch, thirty minutes for a click, seven days for a purchase. Reporting overlays run the other
   policies over the same ledger without changing what is served.
4. **The holdout** (doc 22 §10, `src/content/holdout.ts`, `src/measure/holdout.ts`): five percent by
   default, assigned by a well-mixed hash of the visitor id so it is sticky, compared per slot at 90, 95
   or 99 percent with the decisions still needed stated. The customer's paper wants a permanent holdout on
   a persistent identifier and incrementality over attribution.
5. **Exploration and autonomy** (doc 22 §7 and §11, `src/learn/explore.ts`, `cycle.ts`): a configured
   share of first-position decisions explores; a daily cycle proposes dial changes within bounds and an
   operator approves, unless a slot is set to act on its own.
6. **The ledger on object storage as NDJSON** rather than a database (doc 22 §3, `src/ledger/`).
   Immutable, cheap, replayable, and the reason erasure is a tombstone plus a nightly rewrite. The day
   report is the sum of hourly aggregates; attribution's batch rings are carried in 64 shards with a
   two-day horizon (`src/learn/hourly.ts`, doc 31 §3). The online ring holds seven days.
7. **Two hosts for shopper state** (`REFLEX_HOST` in `wrangler.toml`): the session host keeps the session
   in KV, the object host keeps it in the shopper's Durable Object. Staging and production run the session
   host today. The object host is three times faster on a decision and was held back by its ingest; that
   was fixed on 2026-09-06 and it has not yet passed the scripted acceptance run.
8. **Consent** (`src/content/consent.ts`): two switches, tracking and personalization. Either off means
   the default arm; tracking off means nothing is written anywhere.
9. **Erasure** (doc 22 §15, `src/ledger/erasure.ts`): a tombstone hides the visitor's rows at once,
   lookups answer 410, the nightly job rewrites the ledger objects, the ring shards drop the visitor at the
   next fold. Ledger retention defaults to ninety days.
10. **Operator accounts in D1** (doc 30): PBKDF2-SHA256 with 100,000 iterations, ten failures lock ten
    minutes, fifteen-minute access tokens with refresh, one token per session, hashed at rest, an audit
    table. No open registration. No single sign-on and no email invitation: an admin creates an account and
    hands a temporary password once. The customer decides which path they need.
11. **The operator application** (doc 28, the evaluation at a customer's scale; doc 29): one application,
    a rail, every catalog-sized list paged by the server with a cursor bound to a snapshot version. Written
    for thousands of products and hundreds of slots. Judge it as an enterprise system, which was the
    instruction.
12. **Multi-tenancy** (`src/tenancy/`): a tenant with brands, a site key per tenant, hostnames mapped to
    tenants, catalogs and configuration documents per scope, statistics objects named per tenant, brand
    and slot. One worker serves every tenant of a stamp.
13. **The demo storefront shares the worker** with the product. The customer never sees it; it is how the
    engine is shown. Tell us whether it belongs in the same deployable.

---

## 6 · What we know is open or weak

This list is ours. Add to it; do not trust it to be complete.

| Item | Evidence | State |
|---|---|---|
| Event latency | `docs/architecture/32-latency-numbers.md` §5: an event is 1.7 s at the median for a new shopper because the catalog, configuration and audience seeding are resolved on every event. Target: under 300 ms | Open, delivery track |
| Decision latency for a new shopper | Same document: 285 ms wall, 235 ms inside the worker at the median after the session write left the path; three KV reads in series that all miss. Target: under 200 ms at P95 on the server. Returning shoppers: about 12 ms | Close, not proven at P95 |
| The object host | Accepts content events since 2026-09-06 (CW38); has not passed `scripts/acceptance-run.mjs`; stamps stay on the session host | Open |
| Product and section decisions on the ledger | Ledger 20 row 5: only content decisions and outcomes are on the ledger; the product sort and section grains are not. Experience Personalization scope, May 2027 | Open by design, scheduled |
| Batch attribution horizon | The day report credits within two days; the learning policy's purchase window is seven days and the online ring honours it. Past the horizon at a million decisions a day the batch ring needs a database, not objects (doc 31 §3) | Known limit, documented |
| The example site key on staging | Doc 32 §6: staging accepts the example key printed in the repository's deploy instructions. One command fixes it and breaks the demo pages there unless they get a real key | Decision pending |
| The Implementation Plan | Draft for the customer's response; dates relative to a kickoff not yet set | Waiting on the kickoff date |
| Single sign-on and invitations | Do not exist (doc 30 §4) | Customer decision |
| The deploy script's lint gate | `scripts/deploy.sh` runs a lint that has never passed (six errors, hundreds of warnings, an ESLint configuration that extends without the plugin prefix). Deploys go around it from a clean worktree | Open, process |
| Two tracks in one checkout | Twice a commit swept the other track's staged hunks into HEAD (plan 21 handshake log, 2026-09-05 and 2026-09-06). The mechanics that prevent it are written down; they are discipline, not tooling | Process risk |
| KV consistency | Eventual consistency bit the acceptance script once (a stale lift table) and the session split five out of five before the SDK's session id was used to name the session (doc 32 §5, CW39). Tell us where else it can bite | Partly closed |
| Worker limits | A request may open a bounded number of storage objects; the report answered 500 under load before the ledger wrote fewer, larger objects and the fold took the day off the request path (doc 31). The fold caps an hour at 600 objects and says when it could not read it all | Closed for the design's volume |
| `REFLEX_HOST` is one global variable | The host is chosen per stamp, not per tenant | Design question |
| Observability | Logs persisted, a point per record in Analytics Engine, the self-monitor every five minutes with a webhook alert on failure or slowness. No dashboard, no runbook beyond the kit and the plan | Improvement |

---

## 7 · The questions, by area

**Requirements.** Take the customer's sections 3, 5 and 6 and the thirteen deltas of doc 26. For each
clause: is it built, is the evidence in ledger 20 sufficient, would the customer's data scientists agree?
Pay particular attention to their measurement section: incrementality, pre-set targets, the flywheel.

**Fitness for any customer.** A second customer with ten brands, three hundred thousand products, five
regions, a different privacy regime and their own content management system. Where does the tenancy model
break? Where does a per-scope catalog in KV break? Where does one worker per stamp break? What must be
per-region? What has a customer name hard-wired where it should not be?

**Learning soundness.** Is the ladder statistically defensible? Does shrinkage toward the slot's rate bias
toward incumbents? Is the holdout a valid control under the exploration share? Does last-touch, direct
match, session scope credit the right decision on a site with rails and carousels? Are imported priors
weighted correctly against live evidence? Can the autonomy cycle be gamed by a noisy slot? Can a customer's
data scientist recompute the lift table from the ledger, as doc 22 promises?

**Performance.** With the numbers in docs 31 and 32: what is the right shape for the decision path for a
new shopper, and for the event path? Is the session host or the object host the production path? Are the
targets right for a page that waits on three routes?

**Security and privacy.** Site keys, JWT issuance and refresh, the identity salt, PBKDF2 parameters, what a
leaked access token can do in fifteen minutes, what is logged, what the ledger holds that is personal
(visitor ids, session ids, products bought), consent semantics, erasure completeness including the
Analytics Engine points and KV snapshots, retention.

**Operability.** Provisioning a new customer: what is manual, what is a script, what is a secret handed to a
person. Migrations. Rollback. What the on-call person sees at three in the morning.

**The operator's experience.** Read doc 28 and walk `/console/` on staging. Would a merchandiser at a
large brand accept it? Is every symbol defined in words on the page?

**Delivery.** Their end-of-October need, their November freeze, the January launch, the May milestone. Is
the plan honest about what is built and what is scheduled?

---

## 8 · How to run it yourselves

```
npm install                       # .npmrc carries legacy-peer-deps
npx tsc --noEmit                  # the type check
npx vitest run                    # 92 files, 1,089 tests
npm run dev                       # wrangler dev on the local port; the storefront and the console at /
```

Against staging, with the site key and an operator account that Simone will hand you. Sign in on the
console for a token, or `POST /auth/login`; tokens last fifteen minutes:

```
node scripts/acceptance-run.mjs --base https://edge-platform-staging.expedge.workers.dev --scope coach --sdk-key <key> --token <jwt>
node scripts/load-test.mjs --base <stamp> --sdk-key <key> --rps 40 --seconds 60 --token <jwt>
node scripts/latency.mjs <stamp> --tenant coach --n 40 --key <key>
node scripts/holdout-proof.mjs                       # the holdout's assignment and comparison, from an isolated worktree
bash scripts/verify-origin.sh <stamp> <page origin> <key> coach   # the connection check both sides run
```

The API reference (`docs/kit/02-api-reference.md`) lists every route, including the operator ones: the
lift rows, slots, the work queue, receipts per shopper, the day report and the window report, replay by
decision id, the ledger by id, erasures, the monitor. Sign in on the console rather than minting tokens;
tokens last fifteen minutes and renew on the page.

---

## 9 · What to send back

A single document, findings first, most severe first, each with evidence, consequence, remedy, size and
the severity from §0. Then your answer to the fitness question in a paragraph each for Tapestry and for
the next customer. Then the performance guidance. Anything you could not verify, say so and say what you
would need.

We would rather hear that the architecture is wrong now than in January.
