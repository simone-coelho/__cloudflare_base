# Independent sweep — operations and delivery

**Lens:** provisioning, deploys, CI, migrations, cron, queues, monitoring and alerting, failure modes, the limits of the Cloudflare primitives, runbooks, the two-track process.

**Checkout:** `/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base`, branch `feature/real-time-personalization`, working tree as found (another engineer's uncommitted work present, read only; nothing in the tree was modified).

**Out of scope by instruction:** everything named in `docs/architecture/33-adversarial-audit-brief.md` and `docs/architecture/34-independent-adversarial-audit.md` (F01–F35). Where a finding below sits next to one of theirs, the delta is stated explicitly.

**Scratch harnesses** (created under `/tmp/audit-verify/sweep-operations-and-delivery/`, run from the repository root; nothing was deployed and no `*.workers.dev` host was contacted):

- `ledger-loss.test.ts` — four loss paths in the ledger pipeline, exercised against the real modules.
- `message-size.test.ts`, `message-size2.test.ts`, `message-size3.test.ts` — the wire size of one decision-set queue message from the real `decideContent`.
- `fold-capacity.mjs` — the arithmetic of the queue's batch settings against the fold's object cap.

Run them with:

```
npx vitest run --root /tmp/audit-verify/sweep-operations-and-delivery \
  --config /tmp/audit-verify/sweep-operations-and-delivery/vitest.config.ts
node /tmp/audit-verify/sweep-operations-and-delivery/fold-capacity.mjs
```

---

## Findings, most severe first

### OD-1 · One page's ledger message exceeds Cloudflare's 128 KB queue limit at the contracted homepage scale, and the failure is thrown away

**Severity: blocks launch. Size: S.**

**Evidence.** `src/routes/decisions.ts:343` calls `enqueueDecisions(c.env, out.records)` with every record from one snapshot request. `src/ledger/enqueue.ts:54` puts the whole set in **one** queue message (`{ kind, type:'decisions', records: [...records] }`) — doc 31 §3's deliberate change, "the producer sends a decision set as one message". `src/content/decide.ts:238` builds `inputs` — the shopper's whole affinity vector, plus `regional_share` when a population prior applied — and `:277` attaches it to **every record in the set**, so the vector is serialised N times in that one message. Cloudflare Queues rejects a message above 128 KB.

`src/reflex/core.ts:207` sets the engine's own default `maxValuesPerDim: 24`. The contract is 6–8 dimensions (doc 19; the customer's paper §5) and 20–30 personalized homepage assets (`docs/architecture/19-tapestry-delivery-ledger.md:17`).

Measured with the real `decideContent` (`message-size3.test.ts`), 30 assets, values at the engine's own cap:

| configuration | records | message bytes | over 131,072? |
|---|---|---|---|
| 6 dims × 24 values, affinity only | 30 | 111,362 | no (85% of the limit) |
| 6 dims × 24 values, **+ regional prior** | 30 | **188,372** | **yes, 1.44×** |
| 8 dims × 24 values, affinity only | 30 | **135,062** | **yes** |
| 8 dims × 24 values, **+ regional prior** | 30 | **235,922** | **yes, 1.80×** |

For reference, a small page (3 slots, 6 dims × 8 values) is 6,797 bytes — which is why nothing in the suite or the acceptance run has ever seen this.

The failure is then silent: `src/ledger/enqueue.ts:16–21` wraps `sendBatch`/`send` in `try { } catch { }` with the comment "a queue hiccup must never surface to the shopper". `ledger-loss.test.ts` case D: a queue whose `sendBatch` throws `message length … exceeds limit of 131072` leaves `enqueueDecisions` resolving normally, three Analytics Engine points already written, and zero rows in R2.

**Consequence.** At the launch configuration — Coach homepage, 20–30 personalized assets, 6–8 dimensions, geo cold-start on — the entire page's decision records never reach the ledger, and nothing anywhere records that they were lost. The loss is **not random**: the message grows with the richness of the shopper's affinity vector, so the shoppers the personalization works hardest for are exactly the ones whose decisions disappear. Everything computed from the ledger — the lift table, the day and window reports, the holdout comparison, replay, and the "your data scientists can recompute every number" promise of doc 22 — is then computed on a sample that systematically excludes the best-personalized sessions. Analytics Engine, written first at `enqueue.ts:51`, keeps its points, so the two destinations disagree by exactly the biased slice.

**Remedy.** Hoist `inputs` out of the per-record payload into the message envelope (one copy per set, not one per record); add a size guard in `sendAll` that splits a set into several messages before sending; on any send failure, increment a counter and write one structured log line the monitor can assert on. A size assertion at the contracted scale belongs in the suite.

**Why not in 33 or 34.** Brief §6 lists worker storage-object limits and the batch-attribution horizon as the known Cloudflare-limit risks; it does not mention the queue message limit. F16 is about duplication and independent deliveries, F32 about KV value size and catalog scale — neither touches the per-message limit, the per-record duplication of `inputs`, or the producer-side swallow at `enqueue.ts:19` (F16 cites the *learning* fan-out swallow at `fan.ts:84`).

---

### OD-2 · The hourly fold reads at most 600 objects, and the queue's three-second batch timeout produces far more than that at any real traffic

**Severity: blocks launch. Size: M.**

**Evidence.** `src/learn/hourly.ts:46` `MAX_HOUR_OBJECTS = 600`. `loadHourRecords` (`:350`) lists **both** streams under `{tenant}/{date}/{hh}/`, sorts by the start time in the object name, and takes `all.slice(0, cap)` — the **earliest** 600 — marking the rest `truncated`. Every hourly aggregate, and therefore the day report, the window report and the batch attribution rings, is built from that slice.

The queue writes one R2 object per batch, per hour, per stream (`src/ledger/writer.ts:45` `writeBatches`; `wrangler.toml:31`). `wrangler.toml:31–34`, `:252–255`, `:350–353` set `max_batch_size = 100`, **`max_batch_timeout = 3`**, `max_concurrency = 6` in all three environments. A batch closes on whichever comes first, so a queue that is not idle closes up to **1,200 batches an hour whatever the arrival rate**.

`fold-capacity.mjs`:

```
arrival                          msgs/h  batches/h  streams  objects/h  fold reads
600 decision sets / hour            600        600        1        600        100%
600 decision sets / hour            600        600        2       1200         50%
1 msg/s                            3600       1200        1       1200         50%
10 msg/s                          36000       1200        1       1200         50%
40 msg/s (doc 31 run 3 load)     144000       1440        2       2880         21%
100 msg/s                        360000       3600        2       7200          8%
```

Break-even is ~600 objects an hour: about **600 personalized page views an hour, or 300 once outcomes share the hour** — roughly one page every six to twelve seconds.

Doc 31 §3 concludes "run 3's objects are 0.6 to 1.8 MB each, so an hour of that load is dozens of objects, not thousands", and the brief carries that forward as "Closed for the design's volume". That extrapolation is from a **sixty-second** run: a minute of 40 rps is ~24 batches, an hour of the same load is ~1,440 batches and ~2,880 objects. The conclusion is off by roughly two orders of magnitude, and the 600 cap was sized against it.

**Consequence.** Above a few hundred pages an hour — which Coach's homepage will pass in the first minute of the pilot — every hour is folded from a fraction of its ledger, and the fraction is the *beginning* of the hour, so the tail of every hour (including the outcomes that arrive late in it) is dropped. The day report, the lift snapshots, the holdout comparison and the window report are then all computed on a truncated head of each hour, permanently: nothing re-folds a truncated hour. `truncated: true` is recorded and surfaced honestly, but no job repairs it, and `src/ops/monitor.ts:55` does not check it, so the flag reaches nobody.

**Remedy.** Raise `max_batch_timeout` (30–60 s) so a quiet queue does not manufacture objects, and let `max_batch_size` do the work; or fold by object *bytes* rather than object *count*, and page the listing so an hour is read whole. Either way, treat a truncated hour as unbuilt: leave no aggregate, retry it, and alert when the count is not repaired within a run or two. Re-derive the supported page rate from the chosen settings and put it in the kit.

**Why not in 33 or 34.** F17 names truncation as a correctness discipline ("never mark a truncated/failed hour final") and F25 names the 92-day window truncation. Neither computes the volume at which truncation begins, neither connects it to the queue's batch settings, and neither identifies the sixty-second extrapolation in doc 31 §3 that the cap was sized against. The remedy here is a queue configuration change, not a fold rewrite.

---

### OD-3 · Four uncounted loss paths in the ledger pipeline, and no dead-letter queue in any environment

**Severity: blocks launch. Size: M.**

**Evidence.** All four proven in `ledger-loss.test.ts` against the real modules:

1. **Producer swallow.** `src/ledger/enqueue.ts:16–21` catches every `send`/`sendBatch` error and returns normally. Case D: queue throws, `enqueueDecisions` resolves, no counter, no log.
2. **Partial record loss, counted as zero.** `src/ledger/writer.ts:41` filters unparseable records out of a decision set; `src/ledger/consume.ts:20` only increments `skipped` when a body expands to *nothing*. Case A: 4 records in, 2 written, `skipped = 0` — so `src/index.ts:263`'s warn never fires and no signal exists at all.
3. **Whole message acked and dropped.** `consume.ts:21` returns `ok: true` for unplaceable bodies; `src/index.ts:261` acks them and `:263` writes `console.warn`. Case B: `ok = true, skipped = 2, objects written = 0`. Nothing counts it, nothing alerts.
4. **No dead-letter queue.** `wrangler.toml` has `max_retries = 2` and **no `dead_letter_queue`** in any of the three consumer blocks (`:29–34`, `:250–255`, `:348–353`; verified by grep — the key does not appear in the file). Case C: an R2 outage returns `ok:false` → `m.retry()`; after two retries Cloudflare deletes the batch permanently.

**Consequence.** During an R2 or Queues incident the system of record loses rows with no artifact of any kind: no dead-letter objects to replay, no counter, no alert, and a monitor that stays green because `runChecks` never touches the queue or the ledger. Reconciliation after the incident is impossible — there is nothing to reconcile against. For a customer whose data scientists are meant to recompute the lift table from the ledger, "some hours are short and we cannot say which" is not a recoverable position.

**Remedy.** Declare a `dead_letter_queue` per environment and a consumer for it that writes the message body to R2 under `deadletter/`. Count and log every drop: `skipped`, per-record filter drops, and producer send failures, each as a structured line with tenant and stream. Add a ledger-continuity check to `runChecks` (rows written in the last five minutes versus decisions served) so the monitor can go red.

**Why not in 33 or 34.** F16 establishes at-least-once *duplication* and that ledger and learning are independent deliveries; its swallowed-error evidence is `fan.ts:84` in the learning path. F10's remedy list mentions alerting on "queue age/dead letters", which presumes dead letters exist. No finding states that no dead-letter queue is configured, that `max_retries = 2` therefore deletes the batch, or that the per-record filter loses rows without incrementing any counter.

---

### OD-4 · Provisioning a customer stamp installs four other demos' schema and seed data into that customer's production database

**Severity: fix before the next customer. Size: S.**

**Evidence.** `scripts/provision-stamp.sh:44` runs `npx wrangler d1 migrations apply "edge-platform-db-$ENV" --env "$ENV" --remote`, and `wrangler.toml:139`, `:303`, `:398` all set `migrations_dir = "migrations"`. That directory holds ten files and wrangler applies all of them:

| file | what it is |
|---|---|
| `0001_d1_init.sql` (30 KB) | "Coach / Tapestry personalization demo" schema — 9 tables |
| `0002_demo_events.sql` | demo-captured event isolation, the Opal union audience surface |
| `0003_funnel_seed.sql` | "Revenue Radar" checkout-funnel **seed** baseline, generated, ~69 rows |
| `0004_geo_census.sql` | geo census/crosswalk reference tables |
| `0005_dimension_enrichment.sql` | dimension enrichment data |
| `0006_brighthour_decisions.sql` | **The Bright Hour** demo's decision table |
| `0007_meridian_decisions.sql` | **Meridian (Opticon)** demo's decision table |
| `0008_meridian_geo_cohort.sql` (26 KB) | Meridian geo cohort, 11 inserts, ~126 rows |
| `0009_tenant_columns.sql` | tenant column on `mrd_decisions` |
| `0010_operator_accounts.sql` | the three tables the product actually needs |

So a customer stamp's D1 ends up with 19 tables, of which 3 are product tables, plus roughly 200 rows of demo seed data. There is no product-only migration path and no way to apply `0010` alone.

**Consequence.** The customer's production database — the one that holds operator credentials, sessions and the audit log — is provisioned with two other prospects' demo tables by name and with generated demo rows. It is a confidentiality problem (the table names identify other pursuits inside a Tapestry-named database), an operability problem (a DBA reviewing the migration set cannot tell product schema from demo fixture), and a portability problem (every future migration is appended to a chain whose first nine entries are demo material).

**Remedy.** Split the directory: `migrations/` for the product (renumbered, starting from the operator accounts and whatever the engine genuinely needs in D1), `migrations/demo/` for everything else, and point `migrations_dir` at the product set. Leave the demo directory applied only on the demo worker. Add a check to `provision-stamp.sh` that prints the migrations it is about to apply and stops on anything outside the product set.

**Why not in 33 or 34.** F35 names the `migrations/seed/` subdirectory (`seed_011_geo.sql:32`, unscoped geo deletes) and asks for "tenant-safe seed fixtures", as repository hygiene a services engineer must be careful with. Neither document observes that the automated, documented provisioning path applies the demo migration set to a customer's production database, nor that only 3 of the 19 resulting tables belong to the product.

---

### OD-5 · The release path has no migration step: schema and code are shipped by different, unlinked commands

**Severity: blocks the pilot. Size: S.**

**Evidence.** `scripts/deploy.sh` runs typecheck (`:11`), lint (`:15`), tests (`:19`), a placeholder guard, `npm run build:meridian && npm run build:sdk`, then `wrangler deploy --env <env>` (`:31`, `:40`, `:58`). It never runs `wrangler d1 migrations apply`. `npm run deploy` in `package.json:8` is the same without the guards. Migrations run in exactly two places, both of them first-time provisioning: `scripts/provision-stamp.sh:44` and `scripts/provision-staging.sh:36`. None of the ten migrations has a down migration, and nothing at boot checks that the schema the code expects exists.

`0010_operator_accounts.sql` is dated 2026-09-05, the day production was provisioned, so it happened to ride in on the provisioning run. The next one will not.

**Consequence.** The first schema change after provisioning ships as code against an old database. On the operator path that is a 500 on sign-in for every operator on the stamp, discovered by the customer rather than by the deploy. There is also no reverse: rolling the worker back to a commit that predates a migration leaves the newer schema in place with no tested path back, and nothing in the repository describes one. Combined with the brief's own note that deploys are made from a throwaway worktree *around* `deploy.sh`, the migration step is not merely unlinked — it is on a path nobody uses.

**Remedy.** Put `wrangler d1 migrations apply <db> --env <env> --remote` into `deploy.sh` before `wrangler deploy`, gated on a diff so a no-op deploy stays a no-op; add a startup assertion that the expected migration id is present and fail the health check when it is not; write down the rollback for each migration, even if the answer for some is "forward only, restore from D1 point-in-time".

**Why not in 33 or 34.** F10's remedy asks to "test migrations forward and recovery/rollback with compatible state", as one line in a long list of release-gate improvements; its evidence is the lint configuration, the CI workflow, the monitor thresholds and the cron tenant lists. Neither document observes that the deploy script contains no migration step at all and that migrations are only ever applied by the provisioning scripts.

---

### OD-6 · Alerting is inert on the stamps as provisioned, and the alert's own failures are discarded

**Severity: blocks the pilot. Size: S.**

**Evidence.** `src/ops/monitor.ts:92` reads `env.ALERT_WEBHOOK_URL` and returns `'no-webhook'` when it is empty. That variable appears in `src/types/env.ts:41`, in the monitor, and in one honest status string at `src/routes/decisions.ts:184` — and **nowhere in `wrangler.toml`, nowhere in `scripts/provision-stamp.sh`, nowhere in `scripts/provision-staging.sh`, and nowhere in `scripts/deploy.sh`**. `provision-stamp.sh:47–51` generates and sets `JWT_SECRET`, `IDENTITY_SALT` and `SDK_KEYS`, and prints what it set; the alert webhook is not among them, and no deploy guard refuses without it (contrast `deploy.sh:48–55`, which does refuse a demo deploy without `SDK_KEYS`).

Separately, `alert()` returns `'failed'` when the webhook POST throws or answers non-2xx (`:102`, `:105`), and `runMonitor:85` discards that return value. A webhook that is misconfigured, revoked or down drops every alert forever with no trace beyond the ordinary monitor log line, which says the run's own result, not the delivery's.

**Consequence.** Production was provisioned on 2026-09-05 by a script that does not set this secret, so on the current stamps the five-minute self-monitor almost certainly runs, records, logs — and pages nobody. That is the exact question the brief asks under Operability ("what the on-call person sees at three in the morning"), and the honest answer today is: a log line, if they think to look. When the webhook *is* configured, a delivery failure is indistinguishable from a healthy period.

**Remedy.** Set `ALERT_WEBHOOK_URL` in `provision-stamp.sh` (prompt for it, or refuse and print the one command), and make `deploy.sh` refuse a staging or production deploy without it, the way it already refuses a demo deploy without `SDK_KEYS`. Log `alert()`'s outcome and write a data point on `'failed'`; treat two consecutive delivery failures as a condition of its own.

**Why not in 33 or 34.** F10 attacks what the monitor *measures* — the 1,500 ms threshold, accepting zero decisions, not completing the event → ledger → learning loop, the cron tenant lists. It does not examine the alert channel: that provisioning never sets it, that no deploy gate requires it, or that the delivery result is discarded.

---

### OD-7 · All three environments write to the same unnamed Analytics Engine dataset

**Severity: fix before the next customer. Size: S.**

**Evidence.** `wrangler.toml:126–127`, `:296–297` and `:391–392` each declare `[[analytics_engine_datasets]] binding = "ANALYTICS"` with **no `dataset` field**. Wrangler defaults the dataset name to the binding name — `node_modules/wrangler/wrangler-dist/cli.js:148647`, `value: dataset ?? binding`. So the demo worker (`edge-platform`, deployed at `edge-platform.expedge.workers.dev`, referenced 21 times in `docs/`), staging and production all write into one account-level dataset called `ANALYTICS`.

The points carry no environment discriminator: `src/ledger/enqueue.ts:30` and `:42` index on `r.tenant` and blob tenant/brand/page/slot/item; both stamps and the demo use tenant `coach`. The monitor's point (`src/ops/monitor.ts:83`) does carry `result.environment`, so monitor rows are separable and decision/outcome rows are not. `src/routes/health.ts:52` also writes a point on every `/health` call.

**Consequence.** The one telemetry store that spans decisions, outcomes and monitor runs cannot be filtered to a single environment or a single customer after the fact. Demo traffic on the shared worker is indistinguishable from production Coach decisions in the same rows. If a customer ever asks for their telemetry, or asks what personal-adjacent data the platform holds about their shoppers outside the ledger, the answer cannot be scoped. Nothing in `src/` reads the dataset today, so this is currently a latent isolation defect rather than a wrong number on a report — but it becomes unrecoverable history the longer it runs.

**Remedy.** Name the dataset per environment (`dataset = "edge_platform_production"` and so on) and add an `environment` blob to every point. Data already written cannot be separated; decide whether to keep or drop it.

**Why not in 33 or 34.** F06 discusses Analytics Engine only to say the decision/outcome points omit visitor and session ids and that individual rows should not be invented to erase. F33 addresses the worker/stamp boundary. Neither looks at the dataset binding, and the default-to-binding-name behaviour is invisible in the configuration file itself.

---

### OD-8 · There is no runtime tenant registry: onboarding a brand is a code deploy, and provisioning never sets one

**Severity: fix before the next customer. Size: M.**

**Evidence.** `src/tenancy/middleware.ts:44–70` reads the tenant list from `env.TENANTS`, a JSON string; `:46` returns `DEFAULT_CONFIG` when it is absent, and `src/tenancy/tenant.ts:36` sets `DEFAULT_TENANT = 'coach'`. `TENANTS` **is not set anywhere**: not in `[vars]`, not in `[env.staging.vars]`, not in `[env.production.vars]`. `wrangler.toml:312` describes it as "an onboarding input per customer", but it is a plain `var`, so setting it requires editing `wrangler.toml` and running `wrangler deploy` — a code release. `scripts/provision-stamp.sh` sets `SDK_KEYS` for one tenant (`:50`) and never touches `TENANTS`.

Every scheduled job iterates `tenantConfig(env).provisioned` (`src/index.ts:193`, `:201`, `:222`, `:230`), so today, on both stamps, the monitor, the hourly fold, the day report and the erasure rewrite all run for `coach` alone.

**Consequence.** Adding Kate Spade — the pilot brand carried to Coach in the contract — is a worker deploy, not a configuration action, on an environment whose release cadence is shared with every other brand on the stamp. Until that deploy happens, a second brand can have a site key and serve decisions while being invisible to the monitor, unfolded by the hourly job, absent from the day report and skipped by the nightly erasure rewrite: its shoppers' erasure requests would produce a tombstone that no job ever sweeps.

**Remedy.** Move the tenant registry into a store the platform already has — a versioned KV document or a D1 table — read by `tenantConfig` with the `vars` entry as a fallback; have `provision-stamp.sh` and the operator console add a brand there. Add a monitor check that every tenant holding a site key is also in the provisioned list.

**Why not in 33 or 34.** F10 observes that scheduled work uses *different* tenant lists and that "other work discovers provisioned tenants" — this finding shows that discovery is a static variable that is unset on every stamp, so nothing is discovered at all; F31 addresses two *code* registries diverging (`src/demos/registry.ts` versus the content service), not the absence of a runtime one; F33 addresses the stamp boundary. The delta is the provisioning and release consequence: a brand cannot be onboarded without a deploy, and the provisioning script does not set the value it names.

---

## Checked and found clean

Recorded so the absence of a finding is evidence.

- **Per-environment resource isolation in `wrangler.toml`.** KV namespace ids (`:10/:15`, `:236/:240`, `:334/:338`), R2 buckets (`edge-platform-storage{,-staging,-production}`), queue names (`events`, `events-staging`, `events-production`) and D1 databases (`coach-demo-db`, `coach-demo-db-staging`, `edge-platform-db-production`) are all distinct. No store is shared between environments — with the single exception of the Analytics Engine dataset (OD-7).
- **Cron and log configuration really do reach the named environments.** `[triggers]` and `[observability]` are declared only at the top level, but both are *inheritable* keys in wrangler 4 — verified in `node_modules/wrangler/wrangler-dist/cli.js:30700` (`triggers: inheritable(`) and `:31186` (`observability: inheritable(`). The three crons and `head_sampling_rate = 1` apply to staging and production. `analytics_engine_datasets` is `notInheritable(` at `:30918` and *is* redefined per environment, so the binding exists on every stamp.
- **Durable Object migrations are complete.** All nine bound classes appear in tags v1–v7 (`wrangler.toml:92–123`): StateManager, RateLimiter, PersonalizationWebSocket, OpalAgent, ShopperReflex, MeridianReflex, RegionTrend, DecisionRing, LearnStats. 27 `class_name` entries = 9 classes × 3 environments; no class is bound without a migration, so no deploy will fail on an unmigrated class.
- **`deploy.sh`'s placeholder guards work and do not trip on their own comments.** Both greps run against the current file return no match, so neither staging nor production is blocked; the comment at `:24` that names the placeholder pattern is correctly excluded by the `^\s*(id|database_id)` anchor.
- **`set -e` behaviour in the provisioning scripts.** `provision-stamp.sh:40` and `provision-staging.sh:32` use `grep -q "<env-" wrangler.toml && exit 1`. A failing `grep` inside a `&&` list is exempt from `set -e`, so the scripts do not exit early when no placeholder remains. Not a bug.
- **`scripts/operator-seed.mjs`.** Defaults to `--remote`, passes `--env` through, derives the PBKDF2-SHA256 hash in-process before anything is handed to wrangler, and never puts the password on the wrangler command line. Sound.
- **Explicit acks protect the ledger from the scene workload's batch failures.** `src/index.ts:261` acks ledger messages individually before the scene loop at `:265`, so a scene job that throws does not cause ledger redelivery. (The coupling that remains is capacity, not correctness — see the note below.)
- **Re-folding an hour does not double-count.** `src/learn/hourly.ts` `foldShard` guards the append with `const folded = ctx.from > state.through`, and the aggregate object is written by key, so a repeated `catchUp` over an already-folded hour is idempotent.
- **The fold's run budget is sized to keep pace.** `RUN_BUDGET = 700` against a per-hour charge of `objectsRead + 2×64 + 4` means one full hour per five-minute run — twelve an hour, enough to stay ahead of one closed hour an hour.
- **`/health` no longer enqueues a message per call** (`src/routes/health.ts:36–39` probes the binding's presence instead), which closes one item from the 2026-08-29 baseline audit.
- **`.npmrc` is tracked** (`legacy-peer-deps=true`), so CI's `npm ci` reads the same flag the lockfile was written with; `.dev.vars` and `.env` are untracked and gitignored (`.gitignore:88–92`).
- **CI shape.** `.github/workflows/ci.yml` runs typecheck and tests as two independent jobs on every branch push and on pull requests, with `concurrency` cancellation. The two-jobs-on-purpose choice is right; the gaps in it (no lint, no build/promotion chain) are F10's.

### Checked, and already named by 33 or 34 — not repeated here

- The broken lint gate and the bypass deploy (brief §6; F10).
- The monitor's 1,500 ms threshold, its acceptance of zero decisions, and its not completing the event → ledger → learning loop (F10).
- `TREND_ROLLUP_TENANTS` being absent from the staging and production vars, so trend and autonomy default to `coach` (F10). The mechanism is the same non-inheritance of `[vars]` as OD-8, but the consequence is F10's.
- No retention *deletion* job exists anywhere: `retentionDays` (`src/ledger/erasure.ts:75`) is used only as the erasure rewrite's lookback window (`src/index.ts:231`), so ledger objects, aggregates, day reports, ring shards and retired tombstones are never deleted on age. F06 already states that ninety days in a constant is not an enforced retention lifecycle.
- KV eventual consistency as the authority for shopper state (F14) and for the versioned configuration store (F15).
- Durable Object per-value storage limits in `LearnStats` and `DecisionRing` (F08).
- Whole-catalog KV documents against the 25 MiB value limit (F32).
- The per-customer stamp boundary and data residency (F33).
- Repository and setup debt, including `migrations/seed/seed_011_geo.sql` (F35).

### Noted, below the bar for a finding

- **One queue carries three unrelated workloads.** `EVENT_QUEUE` takes the ledger, ~8-second AI scene generation (`src/routes/aiScene.ts:63`), and an arbitrary JSON body from `POST /api/queue/send` (`src/routes/api.ts:111–115`), under one `max_batch_size = 100` / `max_concurrency = 6` in every environment. The consumer processes scene jobs sequentially and awaited (`src/index.ts:265–282`), so a full batch of scene jobs is ~800 seconds of wall time in one invocation. Ledger messages are acked first so they are not lost, but their delivery latency is set by the slowest AI job, and a scene burst can occupy all six consumer lanes. I did not measure this against a real queue and the auth half of it is F01's, so I record it as context for OD-2 and OD-3 rather than as a separate finding; separating the ledger onto its own queue would be the cheap fix and would also let OD-2's batch settings be tuned for the ledger alone.
- **Three cron patterns fire at the same instant at 03:00 UTC** (`*/5`, `0 * * * *`, `0 3 * * *`), so the hourly fold, the trend roll-up, the day report and the erasure rewrite run as concurrent invocations with no ordering and no mutual exclusion. I traced the two races that looked dangerous — a concurrent re-fold, and the rewrite mutating objects the fold is reading — and both are benign as written (`foldShard`'s `through` guard; the fold applies tombstones itself). What remains is wasted work and a day report that can read hours the fold is still building, which it reports as `missing`. Worth an ordering fix, not worth a finding.

---

## What I could not verify

- Nothing was run against `edge-platform-staging` or `edge-platform-production`, so the *actual* state of `ALERT_WEBHOOK_URL`, `TENANTS`, the queue configuration and the applied migrations on those stamps is inferred from the scripts that provisioned them, not attested. Each of OD-4, OD-6 and OD-8 can be confirmed or dismissed in one command by someone with account access (`wrangler secret list --env production`, `wrangler d1 execute edge-platform-db-production --command "select name from sqlite_master where type='table'" --remote`).
- OD-1 and OD-2 are measured against the real modules and the documented Cloudflare limits, not against live Queues. A single oversized `sendBatch` on a staging queue, and one hour of the load test extended past sixty seconds, would close both empirically.
