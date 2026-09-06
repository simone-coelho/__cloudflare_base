# Synthesis of the independent adversarial audit and its verification

Internal delivery document. 2026-09-06. Repository `__cloudflare_base`, branch `feature/real-time-personalization`,
HEAD `c10ccff7303d06492e4acdf932fc70273d7159ac` (the exact commit doc 34 audited). Working tree carries only
`public/meridian/engine.bundle.js` and two untracked documents, so no source line drifted between the audit and
this verification, and nothing in any finding has been repaired since.

Inputs: doc 34 (35 findings), doc 33 (the brief), one Opus verifier per finding at maximum effort, six section
verifiers, five adversarial sweeps for what both documents missed. My own spot checks are noted where they
change a conclusion.

---

## 1 · Is the audit's verdict supported?

**Yes, and on the verified evidence it is conservative.** The verdict stands unchanged:

> retain the deterministic scoring core, but do not accept the current implementation as customer-pilot-ready,
> enterprise-isolated, or evidence of incremental business lift.

Thirty-five of thirty-five findings were confirmed at high confidence. Not one was refuted, not one was downgraded
to "partly", and not one was found already fixed. Independent verifiers reproduced the behaviour behind every
finding against the repository's own modules, and in several cases reproduced the audit's exact numbers
(1.367879 vs 0.735759 decayed exposures; `s=401` across an objective change; an arm "rate" of 3.0; SQLITE_TOOBIG
on the real Durable Object; a 92-day window labelled six months; a stale 0.15 overwriting a live 0.90).

Each clause of the verdict is independently carried:

**"Retain the deterministic scoring core."** Supported and worth stating positively, which the audit does too
sparingly. The composer, the readable per-dimension affinity vector, the content-ID contract, the
candidate-preserving `/sort`, the receipt, the stage rule that correctly suppresses itself rather than guessing,
and the validator that rejects a value objective on a valueless reward are all sound and were repeatedly confirmed
as correct while their surroundings failed. Doc 34's own §4 review of the thirteen deliberate decisions holds:
22 of 22 mechanical checks passed. The design judgement was good. The engineering around it was not.

**"Not customer-pilot-ready."** Fourteen work items below are blocks-launch, and they are not stylistic. With
`AUTH_MODE=enforced` and no credentials, a real workerd run of this worker answers 200 on `/sort`, `/cdp/*`,
`/track`, `/optimizely`, `/webhook`, `/operator` reads, `/live/ops-api` writes, `/ai/scene` and
`/experiment/launch`, and returns 101 WebSocket upgrades on `/agents/*`. An anonymous caller wrote a PII profile
and a second anonymous caller read it back. A refresh token, which survives sign-out for seven days, opens `/v1`,
`/realtime` and operator writes. I confirmed independently that `/api/storage/:key` and `/api/cache/:key` are
unscoped GET, PUT and DELETE over the R2 ledger bucket and the configuration KV behind nothing but a valid
operator token, and that `wrangler.toml:159` publishes `JWT_SECRET` in the same `[vars]` block that sets
`AUTH_MODE = "enforced"`. None of that is a hardening backlog; it is the absence of a boundary.

**"Not enterprise-isolated."** Confirmed and understated. The audit files the topology finding (F33) as
"fix before the next customer"; its verifier raises it to blocks-the-pilot because the isolation it leans on
already fails on a two-brand stamp today: a Coach site key plus one `X-Tenant` header opened
`t:kate-spade:vis-1` with HTTP 200, and an operator token wrote another brand's store with one header. Doc 20
row 3 records §1.7 hard multi-brand isolation as CLOSED. It is not closed. The single mitigating fact, which the
audit omits and which matters for how this is said to the customer, is that `TENANTS` is set in no environment,
so only `coach` is provisioned and the crossing is latent. It arms the day Kate Spade is provisioned.

**"Not evidence of incremental business lift."** This is the strongest-carried clause. The shipped comparison
calls a winner on null data 23.5% of the time at a nominal 95%, declares `control_better` on a real null day,
reports a genuine 59% clicks-per-visitor win as undecided, and prints "about NaN decisions on each arm" to a
human. Login moves 94% of anonymous controls out of the control arm and orphans the decision ring. The same
defective construction is repeated in `hourly.ts`, the path used at Tapestry's volume, and in `window.ts`, whose
92-day cap cannot express the customer's stated six-month minimum and silently returns 92 days under the
requested end-date label. Two recomputations of the same settled day disagree, and the online lift table is a
third answer, so doc 22's "recompute every number from the ledger" has no single answer. And the arm is not
persisted at all, so there is no stable population to analyse. There is no number here that can be shown to
Tapestry as incremental lift, and none can be produced until the arm is persisted.

**"A synthetic demonstration can continue in an isolated demo environment."** Supported, with one correction the
team must act on: the demo estate is not isolated. `/live/api`, `/live/ops-api`, `/meridian/api`, `/ai`,
`/experiment`, `/signals`, `/funnel`, `/geo` and the whole 74 MB `public/` tree are mounted on the staging and
production customer stamps, and migrations 0002 through 0008 install four other prospects' demo schema and seed
rows into the customer's production database. "Isolated demo environment" is a thing to build, not a thing to
keep using.

### Where the verification changed the picture

Four things came back materially worse than the audit said, and they belong in any summary of the verdict:

1. **A page's ledger message exceeds Cloudflare's 128 KB queue limit at the contracted page size, and the failure
   is swallowed.** `decide.ts:277` attaches the whole `inputs` block, including the full affinity vector, to
   every record; `enqueue.ts` sends the entire decision set as one message; `sendAll`'s catch is empty. My own
   synthetic measurement at a realistic record shape: 9 slots = 52 KiB, 20 slots = 116 KiB, 30 slots = 175 KiB.
   The contracted homepage is 20 to 30 assets. The loss is biased toward the richest affinity vectors, which is
   to say toward exactly the shoppers the lift claim rests on, and nothing anywhere records it.
2. **`POST /v1/:tenant/learn/report` permanently overwrites the canonical stored day report** at
   `reports/{tenant}/{brand}/{date}.json` (`report.ts:221`) with whatever reporting policy the caller passed.
   Cron rebuilds only yesterday, so older dates stay rewritten, `windowReport` pools the substituted numbers,
   and both report GETs carry no `jwt()`. A data scientist exploring an alternate attribution policy silently
   and irreversibly rewrites the customer's incrementality series.
3. **Erasure is undone by the browser.** The platform mirrors profiling output into non-httpOnly cookies,
   erasure never clears them, and the server rebuilds the deleted profile from them on the next page view, after
   the receipt said erased. Analytics Engine separately holds raw IP, user agent, email and traits indexed per
   person, in a store with no delete API, that `erase.ts:19` tells operators contains nothing to erase, and that
   all three environments share.
4. **Monitoring corrupts the evidence it monitors.** On the object host the five-minute self-monitor fans roughly
   2,000 synthetic exposures per tenant per day into live `LEARN_STATS` at every pooling level including
   "everyone", before failing its own consent assertion deterministically.

### The one place the audit is meaningfully unfair to itself

Doc 34 repeatedly prices the launch-blocking core of a finding at the size of its full remedy. F01 leads with
"ship an explicit route/binding allowlist" (project-sized) for something that closes in about 25 lines that are
inert in open mode. F02's blocking core is one line. F10's is a `sed`, four trivial lint errors and a
`--max-warnings` pin. F08's is a key cap. F16's is a read-time `Set`. F22's is three small changes. F26's is
four lines in one file. Presented as M and L bundles, the cheapest and most urgent work looks expensive and will
be deferred. The ranked list below separates the blocking core from the full remedy in every case.

---

## 2 · Ranked remediation list

Twenty work items merging all 35 findings, all six section reviews and all 30 sweep findings. Severity uses the
brief's labels. S = roughly 1 to 3 engineer-days, M = 1 to 2 engineer-weeks, L = multiple engineer-weeks.
Overlapping work has been merged, so these sizes may be added.

| # | Work item | Severity | Size | Depends on | Owner |
|---|---|---|---|---|---|
| 1 | Close the enforced-mode reachable surface | blocks launch | S (M full) | none | delivery |
| 2 | Make the operator token mean what it says | blocks launch | S core, M full | none | delivery |
| 3 | Stop losing ledger messages, silently and by size | blocks launch | S | none | outcome-learning |
| 4 | Withdraw the incrementality claim; make the day report immutable | blocks launch | S | 1 | outcome-learning + leadership |
| 5 | Correct the register and every customer-facing claim | blocks launch | S–M | none | leadership + delivery |
| 6 | Bind every request's tenant to its credential | blocks launch | M (S core) | 2 | delivery |
| 7 | One consent decision, enforced at capture, scoring and egress | blocks launch | M | none | delivery |
| 8 | Identity: refuse unsigned claims, stop resurrecting the shopper | blocks launch | M | 7 | delivery |
| 9 | Erasure that is complete and cannot be undone | blocks launch | M–L | 3, 8 | both |
| 10 | Configuration that cannot silently revert or collide | blocks launch | S core, M full | none | delivery |
| 11 | Bound the learning state and the catalog document | blocks launch | S core, L full | none | outcome-learning |
| 12 | Authoritative shopper state | blocks launch | S subset, L full | 7, 8 | delivery |
| 13 | Release engineering: gates, provisioning, migrations, alerting | blocks launch | M | none | delivery |
| 14 | Persist the arm; deduplicate and repair the ledger reads | blocks the pilot | M | 3, 4 | outcome-learning |
| 15 | Learning arithmetic: order, units, slot, priors | blocks the pilot | M | 11 | outcome-learning |
| 16 | Withdraw or gate the undelivered learning features | blocks the pilot | S | 5 | outcome-learning + leadership |
| 17 | The merchandiser's controls and feed fidelity | blocks the pilot | M | none | delivery |
| 18 | The SDK contract: repaint, absence, idempotent listeners | blocks the pilot | S | none | delivery |
| 19 | Replay that reproduces a coupled page | blocks the pilot | S | 11 | outcome-learning |
| 20 | Portability: one registry, per-customer deployment | fix before next customer | L | 6, 13 | leadership + delivery |

### 1 · Close the enforced-mode reachable surface
*F01, sweep-security 1 and 3, sweep-customer-facing 1, F24 (no role gate on `POST /learn/proposals/:id/:decision`),
F25 and F34 (unauthenticated report GETs).*

A deny-by-default middleware ahead of the route table: in enforced mode, 404 anything outside `/health`, `/auth`,
`/v1`, `/realtime`, `/sort`, `/content`, `/config`, `/operator`, `/track`. Delete or gate `/api/storage/:key` and
`/api/cache/:key`, which are today unscoped read, write and delete over the R2 ledger bucket and the
configuration KV behind any operator token: that one route defeats erasure (item 9), ledger immutability
(item 3), replay archives (item 19) and the customer-facing "complete audit trail" promise simultaneously.
Dispatch `/agents/*` only in open mode. Extend `sdkKey()` to `/sort` and `/track/*`. Add `jwt()` to the two
report GETs and a role check to the proposal decision route. Scope or authenticate the `?scope=` reads that
today serve any brand's catalogue, learning dials, reflex configuration and full revision history to anyone.

Every edit is inert while `AUTH_MODE='open'`, so the demo worker and the Opticon stage cannot regress. Ship with
negative tests that enumerate the real route table rather than the fabricated four-route app `edgeAccess.test.ts`
currently asserts against.

### 2 · Make the operator token mean what it says
*F02, sweep-security 2, F33 (no tenant claim on operator tokens), F09 (secret rotation, split to item 13).*

One line first: deny `type === 'refresh'` in `src/middleware/auth.ts` after `jwtVerify`. A deny, not a require:
`mintAccess` emits no type claim, so requiring one rejects every live token and all eight tooling scripts on
deploy. Then remove `JWT_SECRET` from the default `[vars]` block, which currently publishes the signing secret of
an environment that sets `AUTH_MODE = "enforced"`, and make verification fail closed when the secret is absent.
Then the real work: type and session id on access tokens, a service token type for the eight self-minting
scripts, session lookup on every verify, revocation on password change and role change, a tenant claim, and the
same treatment on the `edgeAccess.ts:119` Bearer branch, which today hands any Bearer request straight through.
The algorithm allowlist doc 34 leads with is hygiene; jose already rejects `alg:none`.

### 3 · Stop losing ledger messages, silently and by size
*Sweep-operations 1 and 3, F16, F32 (payload half).*

Hoist `inputs` from the per-record object to the message envelope. `decide.ts:277` attaches the full affinity
vector to every record; at the contracted 20 to 30 assets one page's message is 116 to 175 KiB against
Cloudflare's 128 KB limit, and `sendAll`'s empty catch discards the whole page's rows with no log, counter or
metric. My measurement: hoisting cuts the same message to 35 to 52 KiB, comfortably under at every contracted
size, for about ten lines. Add `dead_letter_queue` to all three consumer blocks, log and count the enqueue
failure, check `res.ok` in `fan.ts`, and stop dropping unplaceable messages with a `console.warn`.

This is the highest value per engineer-day in the list. Until it lands, the ledger is not a system of record and
nothing computed from it can be defended, including everything in items 4, 14 and 19.

### 4 · Withdraw the incrementality claim; make the day report immutable
*F07 (representation half), F25, sweep-learning 1, S5a's NaN.*

Stop `POST /v1/:tenant/learn/report` overwriting `reports/{tenant}/{brand}/{date}.json`: return the computed
report, or write it under a caller-named key. Drop the `TAPESTRY_TARGETS` reading and the sentence "the holdout
is the reason we can say so" from `compareArms`. Clamp `s` to `n`, guard `neededPerArm` against rates above 1
(this is the "about NaN decisions" a human currently reads), and rename every field to attribution-diagnostic
language across `holdout.ts`, `report.ts`, `hourly.ts`, `window.ts` and `public/learning.js:298`. When a window
truncates, say so and force `standing` to undecided.

About one engineer-day, and it is the item that most directly settles the audit's third verdict clause. Do it
before anything is shown to the customer, and do not let it wait on item 14.

### 5 · Correct the register and every customer-facing claim
*F11, F29, F30 (documentation half), F31 (doc 20 row 3), sweep-customer-facing 2 to 6, S5a, S5b and S6/S7
corrections.*

Doc 20 has no row at all for §1.9 or §1.10, and never did in any commit, so this is a claim-to-register sweep,
not a regression repair. Split §1.3 so a catalog importer cannot close AI enrichment approval, and §1.12 so R2
partitions cannot close a scheduled Snowflake share. Reopen row 3 (multi-brand isolation is not closed). Add
§2.3's widget clause. Then correct the same claims where the customer reads them: the sent solution document,
PS guide step P3 with its 3 to 8 person-days for a workflow that does not exist, deliverables 11 and 14, and
`docs/kit/04`'s statement that the scripted run "is the acceptance evidence". Correct the published learn schema,
which omits the money objective and mis-defines the lift symbols for the very slot the acceptance walk uses;
the exploration default, documented at 10% and shipping off; the "one npm package, tree-shakeable" SDK, which
does not exist; and the ODP re-seed path, which does not restore the interest vector.

### 6 · Bind every request's tenant to its credential
*F03, F33, sweep-operations 8.*

In `sdkKey()`, authorize against the tenant resolved from the request, not the path parameter: 409 when they
disagree, and apply the same check on the Bearer branch instead of accepting any token. Refuse a `*` owner in
`SDK_KEYS` when enforced. Mount the gate on `/sort`, which today is behind no gate at all yet reads
`c.get('tenant')`. Fix the split brain inside a single `/v1` request, where `decisions.ts:332` names documents by
the path tenant while `content/service.ts:155` names shopper state by the context tenant, so brand B's ledger is
built from brand A's behaviour: this needs no second provisioned brand. Ship together with the SDK sending its
brand and `X-Tenant` added to `allowHeaders` at `index.ts:74`, or every cross-origin preflight fails.

### 7 · One consent decision, enforced at capture, scoring and egress
*F05, F10 (the `readShopper` object-host edit), sweep-privacy 3.*

Resolve consent once as the intersection of stored switches and cookie state, explicit refusal winning, and
return that intersection from both catch blocks instead of `CONSENTING`. Add a consent field to `ServeRequest`
and to the `/v1/:tenant/decisions` and `/sort` bodies, so a server-to-server integration can express a refusal at
all. Put the ODP send, the regional fan-in and the demo capture behind it, and return the platform's order
unchanged from `/sort` when personalization is refused. Stop writing identifiers to the log store on requests
where consent was refused. The same `readShopper` edit fixes the monitor's deterministic false red and stops the
monitor writing synthetic exposures into live learning statistics.

### 8 · Identity: refuse unsigned claims, stop resurrecting the shopper
*F04, sweep-privacy 1, F14 (pointer orphaning).*

Refuse instead of returning `assurance:'site'` when enforced, and add `IDENTITY_SECRETS` to provisioning so a
stamp without it reports unready. Then one ownership guard in `getOrCreateSessionFromCookies` and the two
`/realtime/session/:sessionId/*` handlers: refuse a resolved record whose `identity.shopperId` is set and does
not match the requesting user, and start a new session. Because four call paths funnel through `resolveRecord`,
that single check closes the carried-session path, the `user:{visitorId}` pointer path, the cross-tab leak, the
failed-detach cookie path and the analytics and preferences bearer paths at once. Make detach delete the pointer
and strip `forwardTo`, have the SDK mint a new session on logout and check `res.ok`, and clear the profiling
cookies on erasure.

### 9 · Erasure that is complete and cannot be undone
*F06, sweep-privacy 1, 2, 4 and 5, sweep-security 4.*

Stop deleting the pending tombstone; rewrite it in place with a `state:'rewritten'` marker for the full replay
horizon. Load the tenant's erasure watermark once per queue batch and drop tombstoned records before
`writeBatches` runs. Bound the client-supplied event timestamp, which today makes the ordinary event endpoint a
back-dating endpoint. Run both hosts in `eraseProfile`, snapshot the visitor list before erase, delete links
last, report partial failure honestly, and copy the 410 guard to `decisions.ts:270`. Enumerate D1 `demo_events`
and the orphaned session records the design never counted. Record every privileged read of, and every erasure
of, one person's data.

The Analytics Engine question is not an engineering choice (see decision 3). At the repo's own volume constants
one erasure takes roughly 259 nightly runs against a one-month statutory deadline, which is also a decision
(11), not a tuning exercise.

### 10 · Configuration that cannot silently revert or collide
*F15, F24 (the lost-update path).*

About 30 lines in `versionedStore.ts`: make `readRevision` distinguish "read failed" from "nothing stored" so a
transient KV failure stops silently reverting every tuned value to the compiled default and returning 200 with a
clean, monotonic audit trail; compute the next revision as `max(previous, index[0].revision)+1` and check for an
existing body before writing; bypass the isolate cache inside `write`/`patch`; wrap the three puts so a failure
is a visible 5xx. The `ConfigPublisher` Durable Object follows before anyone is told concurrent tuning is safe.
This is not primarily a concurrency defect: two publishes 28 seconds apart collide, and the data-destroying paths
need one writer and no race at all.

### 11 · Bound the learning state and the catalog document
*F08, F32, F34 (report projection).*

Cap distinct keys per item and per slot, evicting the least-recently-touched deep level, since `liftFor` already
answers at a coarser level. Allow-list `channel`, which is today an unvalidated query parameter that a holder of
the public site key can use to kill a named slot object in a few thousand unrate-limited requests. Catch the
failed `save()` so the object is not permanently poisoned and silently stops publishing. Pass `{tenant, brand,
slot}` at `LearnStats.ts:110` and `:56` instead of the whole state, which today duplicates the raw statistics
into every KV snapshot the decision path parses. Cap or delete the `DecisionRing` index, which nothing reads.
Replace `FakeStorage` with a double that structured-clones and refuses over 2 MiB, so the suite can express the
failure at all. Separately: delete `config: value` from `versionedStore.ts:243`, which halves the stored
catalog envelope and removes 58 to 174 ms of parse from every isolate-cache miss.

### 12 · Authoritative shopper state
*F14, F31 (connectors half).*

No small fix makes KV consistent; that is the finding, and the Durable Object transition is genuinely L. Land
the S subset now and record it as buying time, never as closing the finding: pass the request's session id
through to the deferred write so concurrent updates stop splitting; use `createOrUpdateSession`'s return value
instead of re-reading, removing the HTTP 500 and the dropped outcome; make `/sort` read-only; stop repointing
`user:<id>` from a session the request just invented, which today permanently orphans a shopper from her vector
on one missed read; and use the registry's memoized catalog instead of the O(N^2 log N) all-pairs precompute the
engine constructor runs per event. Note that flipping `REFLEX_HOST` to fix this regresses item 17; sequence them.

### 13 · Release engineering: gates, provisioning, migrations, alerting
*F10, F09, F35, sweep-operations 4, 5, 6 and 7.*

Fix the `.eslintrc.json` plugin prefix, four trivial errors and one deliberate inline disable, pin
`--max-warnings 324`, and add lint to CI: this alone makes `deploy.sh` run past line 15 and reach tests it has
never reached. Gate secret rotation in `provision-stamp.sh` behind an explicit flag, print the site key at
generation rather than after a seed that aborts first, drop the blanket `|| true`, and make the operator seed
`ON CONFLICT DO NOTHING`; today a second run rotates `JWT_SECRET`, `IDENTITY_SALT` and `SDK_KEYS` on a live
worker and ends with an enforced stamp whose site key nobody holds. Add a migration step to the release path,
which has none. Exclude migrations 0002 to 0008, four other prospects' demo schema, from customer stamps, and
make the geo seed `INSERT OR IGNORE`: run once as the published runbook says, it drops NY crosswalk ZIPs from 14
to 1 and replaces a "Census ACS 2024" provenance row with a proxy. Set the alert webhook, which no provisioning
script sets, and name the Analytics Engine dataset per environment. Fix the monitor: fail on zero decisions,
time a personalized probe, set the budget from the stated envelope, and give `runChecks` its first test.

### 14 · Persist the arm; deduplicate and repair the ledger reads
*F07 (measurement half), F16, F17, F34 (`buildReport`), sweep-learning 5 and 6.*

Persist the arm and salt version once on first decision and read it back instead of recomputing, carrying it
through `linkVisitor` and detach alongside a `DECISION_RING` migration. Until this exists there is no stable
population, so no statistical work can produce a valid result: this is the prerequisite for every later
measurement item. Deduplicate on read in `loadDay` and `loadHourRecords` using the decision and outcome ids that
already exist and are byte-identical across a redelivery. Replace the quadratic `decisions.find` inside the
outcome loop with a Map (1.05 s becomes negligible; 160 s at cap becomes tractable). Rebuild immature hours whose
object count exceeds the stored aggregate, replace `ShardState.through` with a horizon-pruned set so a repair can
enter the rings at all, key `seen` by date so an out-of-order repair stops freezing the day's visitor count, and
carry `truncated`, `unfolded` and `horizonMs` into the day and window reports and onto the operator's screen.

### 15 · Learning arithmetic: order, units, slot, priors
*F18, F19, F20, F21, sweep-learning 3 and 4.*

Make `bump` decay both operands to `max(entry.t, ts)`, the shape `mergeEntry` already implements 90 lines away,
and memoize the exact slot rate rather than the value rounded to three decimals, which today forces lift to
exactly 1 at every level below a 0.0005 rate. Stamp a generation hash of the objective and policy on the
counters and restart them on a change, so an objective change stops mixing dollars and clicks into one scalar
(reproduced: the mixed snapshot serves the piece that earned $1,100 over the one that earned $10,000, and prints
"weighed by revenue" over the mixed number). Index priors by item so the four of six ladder levels that are
currently dead come alive, and reject cells that are not a canonical prefix. Add a `placement` axis to
attribution so a click naming `hero` stops crediting `rail`, treating the literal `'unknown'` as absent, and
filter fatigue's `servedCounts` by slot. Bucket position, which today produces a 3.80x lift spread on identical
content.

### 16 · Withdraw or gate the undelivered learning features
*F23, F30, F24.*

Remove `thompson` from the accepted values, both operator selects and the published schemas, and mark it
undelivered: it ignores the exploration budget entirely (48 of 100 leader changes at share zero), and under a
revenue objective the Beta collapses so it stops exploring while preferring total revenue over revenue per
exposure. Gate the external model behind an environment switch unset on every stamp, restrict the kind and ref
so a free-text `http://` URL cannot be entered in the operator UI, filter the candidate list, and add the test
that off means zero calls. For autonomy: refuse a proposal whose recorded `from` does not match the live weight,
whose slot is configured or pinned, or which is older than seven days, and write the proposals document after
the slots document rather than before. One stale proposal today writes 15x the configured step onto a slot whose
autonomy is off and whose dimension is pinned.

### 17 · The merchandiser's controls and feed fidelity
*F26, F27, F28, F13.*

Four lines in `views-config.js` make the shipped stage form produce values the real validator accepts and stop
an emptied field defaulting to the maximum-effect value; delete the console test's stub and call the real
validator so the suite becomes a form-to-API contract test. Stop `rows.ts:176` stripping weights server-side, so
a merchandiser can at least read what a slot is tuned to. Carry `merchandising` through `normalizePiece`, stop
defaulting lifecycle to `live` on a merge refresh (which today resurrects retired campaigns), accept the
customer's own `explore`/`consider`/`decide` vocabulary, and dedupe tag values. Reserve pinned pieces before the
slot loop so a later pin cannot duplicate an earlier selection, and reject two slots pinning one piece at write
time. Thread `visitNumber` and `channel` into `ShopperRead` and `cellFor` so the published `2-3` and `4+` buckets
become reachable at all, and stop writing `'direct'` when nothing is known.

### 18 · The SDK contract: repaint, absence, idempotent listeners
*F12, F34 (listener half), F29 (`notifyAbsence`).*

Strike the `content_decisions` frame from five documents, or build it. Add a documented coalescing
`listen.refresh()` that guards `apply()` on the set and does not clear the impression dedupe when the set is
unchanged, and make it not write an exposure, or the fix inflates the lift denominator. Fix `notifyAbsence` to
notify slot subscribers, since the kit's own headline ten lines currently render an empty hero on a failed
snapshot while three documents promise "guaranteed graceful absence". Add a module-level WeakMap attach guard so
`declarative()` is idempotent, and replace the Map-backed fake element with a jsdom element so the tests can see
the duplicate events at all.

### 19 · Replay that reproduces a coupled page
*F22.*

Carry the page's per-slot snapshot versions on every record, fetch each slot's archive at its recorded version,
and fail with a named reason rather than replaying with a hole. Write the R2 archive before the KV publish and
skip the publish if the archive throws. Stop stamping `versions.lift` on pinned and default-arm records. Add a
multi-slot replay test with a real archive and the gamma-zero rotation case: the only existing test is green
because both preconditions are absent. On Coach's own seeded four-slot home page, one ordinary lift makes 7 of 9
valid receipts report `equal:false`.

### 20 · Portability: one registry, per-customer deployment
*F31, F33, F32, F35 (`setup.sh`).*

Thread the tenant through `getConnectors`, `ensureAudiencesSeeded`, the regional trend key and `applyHistory`,
and collapse the four tenant registries (path scope, middleware tenant, demo surface, `TREND_ROLLUP_TENANTS`)
to one. Write the failing isolation test first: a decision and an event under two non-default tenants, asserting
config scope, audience keys and trend key all carry the tenant. Then templated per-customer configuration, a
provisioning script taking customer and environment, a deploy matrix, per-customer secrets and domains, version
pinning, and migrating Coach off the shared workers. CW15's 1.5-day budget in ledger 19:101 is off by roughly an
order of magnitude.

---

## 3 · Decisions only a person can make

1. **Do we run any pilot on real Tapestry shopper data before items 1 to 13 land?**
   Who: Simone Coelho, with leadership and the customer's capability owner.
   Options: (a) no real data until items 1 to 13 are done, demo continues on an isolated stamp; (b) real data on
   a narrowed surface with written customer acknowledgement of the gaps; (c) proceed as planned.
   (c) cannot be defended: anonymous PII read and write, a seven-day post-logout token, an unscoped ledger door
   and unerasable subject data are all live today.

2. **Is the January date held by narrowing the scope, or moved?**
   Who: leadership with Simone.
   Options: (a) hold January with deterministic ranking only, learning in shadow, no incrementality claim, one
   Coach page; (b) hold the date and move acceptance; (c) move the date now.
   Twenty items, fourteen of them blocks-launch, do not fit two tracks before January without one of these.

3. **Analytics Engine: accept it as an unerasable subject-data store, or stop writing identifiers to it.**
   Who: Simone with legal/privacy and the customer's data protection owner.
   Options: (a) strip visitor id, IP, user agent, email and traits and keep it as aggregate telemetry;
   (b) declare it in the privacy notice and on every erasure receipt as a store with platform retention and no
   per-row delete; (c) move that telemetry to a store that supports deletion.
   Today the code asserts the opposite of the truth to operators, and all three environments share one dataset.

4. **Does the demo estate ship inside the customer worker at all?**
   Who: Simone with leadership.
   Options: (a) deny-by-default gate only (item 1), code stays in place; (b) separate build or deployable;
   (c) separate worker and account.
   (a) closes January. The audit wants (c), and migrations 0002 to 0008 and the 74 MB `public/` tree are the
   reason.

5. **Which capabilities are reported to Tapestry as undelivered, and when?**
   Who: leadership with Simone and the customer's capability owner.
   The list, from item 5: AI enrichment approval (§1.3), scheduled Snowflake and third-party share (§1.12),
   AI Search live affinity (§1.10), commercial entitlement (§1.9), widget rendering (§2.3), embeddings,
   similar-user matching and the learned journey classifier (D8), Thompson sampling, the external model hook,
   the npm SDK package, content-type affinity, and the incrementality claim itself.
   Options: (a) disclose before the next procurement milestone; (b) disclose at M3 with the kit; (c) requalify
   the register quietly and disclose only what is asked. (c) is how the register got here.

6. **Is Kate Spade provisioned before or after item 6 lands?**
   Who: Simone with Mandeep.
   Options: (a) hold at Coach-only until tenant binding ships; (b) provision and accept the crossing;
   (c) a separate stamp per brand.
   The cross-brand crossing is latent today only because `TENANTS` is set nowhere. Provisioning arms it, and
   `provision-stamp.sh` currently destroys brand one's site key when adding brand two.

7. **The tuning-UI commitment and the acceptance bar (doc 20 row B4).**
   Who: leadership with Simone.
   Weights are not editable and not even readable in the console, and the acceptance statement requires them
   live-tunable. Options: (a) build it, and item 17 is the prerequisite; (b) change the acceptance criterion with
   the customer; (c) name an owner and a date. The row has had no owner since it opened.

8. **The erasure service level.**
   Who: Simone with legal and the customer.
   At the repository's own volume constants, one erasure needs roughly 259 nightly runs against a one-month
   statutory deadline. Options: (a) raise the cap or run a dedicated job; (b) partition the ledger so erasure is
   bounded; (c) contract to a longer window. This cannot be left to a default.

9. **Data residency.**
   Who: leadership with the customer.
   `jurisdiction` and `locationHint` appear zero times in the repository, while
   `PS-Implementation-Runbook.md` §9 already makes a residency claim to customers. Options: (a) withdraw the
   claim; (b) build per-region stamps (part of item 20); (c) contract to a single region.

10. **Staffing and sequencing across the two tracks.**
    Who: leadership.
    Items 1, 2, 3, 4, 5, 10, 13 and 16 are days each and close most of the launch risk. Items 9, 12, 14 and 20
    are weeks. Options: (a) add engineers; (b) sequence the cheap blocking items first and accept a narrowed
    January; (c) both. Recommended: (c), with items 1 to 5 inside the first week.

---

## 4 · Material disagreements the verifiers established

Line-number drift is excluded; these change what should be built or said.

1. **F01's remedy is priced wrong.** The launch blocker closes in about 25 lines that are inert in open mode, not
   in a project-sized allowlist. And the agent exposure is not "a source/installed-dependency finding": it is an
   application choice at `index.ts:185`, which calls `routeAgentRequest` with no options, before auth, ignoring
   the SDK's own `onBeforeRequest`/`onBeforeConnect` hooks.
2. **F02's algorithm allowlist is hygiene, not the hole.** jose 5.10 already rejects `alg:none` and asymmetric
   algorithms against a symmetric secret; both measured 401. Worse, F02's typed-claim remedy applied literally
   breaks eight tooling scripts including the acceptance run. And "beyond fifteen minutes" undersells the
   seven-day refresh token by a factor of 672.
3. **F03 overstates today's exposure and understates the mechanism.** `TENANTS` is set nowhere, so the
   cross-brand crossing is latent until brand two is provisioned. But the operator-token branch bypasses the one
   gate that binds, and the split-brain inside a single `/v1` request needs no second brand at all.
4. **F05 overweights the demo D1 capture.** `demoEventCaptureEnabled` returns false for
   `ENVIRONMENT=production`, so that is a staging and pilot-data issue, not production. Conversely F05 omits its
   own strongest instance: with tracking refused the event still reaches ODP on both hosts with a stable vuid
   and product ids.
5. **F06 overstates one consequence and badly understates another.** `profile:{userId}` is written only by an
   operator action. But "can exceed its intended work budget" is roughly 259 nightly runs for one erasure.
6. **F07's headline probe is its least representative failure.** "rate 3 (300%)" is a degenerate one-decision
   case; a 40,000-visitor day produced 0.099 and 0.102. A team could clamp the rate and believe the finding
   closed. Lead with the variance and denominator failures, and note that the same construction is repeated in
   `hourly.ts`, the path used at Tapestry's volume, and in `window.ts`, neither of which F07 names.
7. **F08's severity qualifier is wrong and dangerous.** "blocks launch of enabled learning" invites shipping with
   learning off; exposures fan at gamma 0, gated only on tracking consent. The byte figure 2,618,613 is also not
   reproducible (2,468,636 JSON at 15,000 cells), and the failure is items x cells, so the seeded chero slot dies
   at 1,203 cells, not 15,000.
8. **F09's "merge site-key entries" cannot be implemented as a script change.** Wrangler 4 has no `secret get`
   and Worker secrets cannot be read back; a merge requires a manifest outside the secret. That is a design
   change, and the stop-guard is inert precisely when it matters, because the ids are committed.
9. **F10's "may also fail the monitor's consent assertion" is wrong: it will, deterministically, every run.** The
   lint baseline is also measurable for the cost of a `sed` (5 errors, 324 warnings), so the cheapest blocking
   item on the list currently looks expensive inside an M–L bundle. And F10 misses that the monitor injects
   synthetic exposures into live learning statistics on the object host.
10. **F11's "restore the exact twelve clauses" is wrong.** §1.9 and §1.10 never appeared in doc 20 in any commit
    on any branch. This is a claim-to-register sweep, not a regression repair.
11. **F12's title overstates and its size over-prices.** The SDK is not incapable; one added `hydrate()` call
    repaints correctly, and staleness is bounded to the page view. The real defect is a documented
    `content_decisions` frame that no code sends. S for the pilot gate, not M.
12. **F13 is wrong that the SDK does not forward channel.** `listen.ts:75` forwards it and the SDK already
    computes and sends entry signals; the gap is the documented example and the server-side wiring.
13. **F14 badly understates `:363`.** The engine constructor runs an O(N^2 log N) all-pairs precompute per event,
    bypassing the memo that exists precisely because it "must never run per event": 5 ms today, about 3 s at
    2,000 products.
14. **F15 is framed as a concurrency defect and is not.** Two publishes 28 seconds apart collide, and a single
    transient KV read failure silently reverts every tuned value to the compiled default with a clean, monotonic
    audit trail and HTTP 200, with one writer and no race. F15's own remedy tests would not catch either.
    Severity should be raised to blocks launch.
15. **F16 mis-cites the duplication harm and over-sizes the fix.** A duplicated ring append cannot double a
    credit, because `attribute()` caps at one per slot. And the stable ids the remedy asks for already exist and
    are byte-identical across redelivery: the work is to use them on read, which is S, not L.
16. **F17's "7 to 10 pages" is wrong.** Configured pages emit 7 to 9 records, so 200 receipts is about 22 page
    views. And "incomplete reports that can appear final" is too broad: failed hours and truncation are surfaced;
    only four cases are genuinely silent. Naming those four makes it far harder to rebut.
17. **F18 names the wrong live vector.** Queue reordering is 0.00% at realistic jitter; framed that way the team
    will measure it, find nothing, and dismiss the finding. The real vectors are unbounded client-supplied
    timestamps (ten crafted events destroy 81.8% of an item's evidence slot-wide) and replay (-46%). And the
    correct implementation already exists in-repo as `mergeEntry`.
18. **F19 is M, not M–L**, because `report.ts` and `hourly.ts` already rebuild sufficient statistics from the
    ledger. Its "expose reset status" remedy also ignores that the reset route ships and cannot repair anything,
    since it deletes only `stats.items` and leaves every denominator mixed.
19. **F20's own example cannot pass even after the fix.** It uses `n_equiv=20` against `nMin=30`, so a retest
    with the audit's numbers will look like the fix failed. And the title names the cosmetic harm: the damage is
    that four of six ladder levels of the priors feature are dead, and a coarse prior can serve a confidently
    wrong number rather than none.
20. **F21's hero/rail claim is broader than the truth** (it needs the same item or a shared featured product),
    and its "use decision ID for direct interaction credit" is not implementable as written, because
    `ContentDecision` carries no `decision_id`. Its served/rendered/viewable/click/conversion split is a
    telemetry redesign, not a pilot gate.
21. **F22 understates when it fires and over-sizes the fix.** It fires at gamma 0 through rotation on an earlier
    slot, so "learning stays in shadow for the pilot" is not a mitigation. S, not M.
22. **F23 carries only half the reward-model failure.** Under a revenue objective the failure inverts: `s > n`
    collapses the Beta to `(s+1, 1)`, 1995 of 2000 draws round to 1.000, and Thompson stops exploring while
    preferring total revenue over revenue per exposure.
23. **F25's retention sentence names the wrong mechanism.** `LEDGER_RETENTION_DAYS` bounds the erasure back-scan,
    not report deletion; nothing deletes day reports. Its sample-size error is also bidirectional (1.9x
    conservative as a control gate, 5.2x optimistic as a traffic estimate), so a remediator could fix it the
    wrong way.
24. **F26 demands "exclusions" that do not exist anywhere in `src/content/`.** That is a new capability, not a
    missing form. The finding's own evidence is two S pieces, not one M.
25. **F27's duplicate-tag inflation is not reachable through the feed** (the import adapter already dedupes), and
    its "one canonical normalizer including direct PUT" would break the only path that currently preserves
    merchandising.
26. **F28 omits that no shipped configuration triggers it.** Every seed pins first, so the demo does not
    duplicate today; the risk is customer configuration. And "reject contradictory pins" cannot be a write-time
    guarantee, because the catalog is a separate versioned document.
27. **F29 omits `scripts/rehearse-storefront.sh`,** which already drives the shipped SDK in a real headless
    browser in both transports with per-check PASS/FAIL, and omits the recorded browser walk ten lines below the
    sentence it cites. It reads as "no browser proof exists", which is false, and inflates the remaining work.
    CW16's dataLayer/GTM adapter is also built and tested; only the tag-plan template and overlay are absent.
28. **F30 overstates the availability risk.** `fallback: 'omit'` is honoured, so a dead model cannot fail a
    decision; the real risks are latency, third-party egress and measurement instability. F30 also misses that
    the control ships in the operator UI with a free-text URL field and a 5000 ms budget.
29. **F31's title names "the event engine" and never cites it.** It pins the seed and regional defects on
    `ShopperReflex`, which `REFLEX_HOST='session'` makes dormant in all three environments, while
    `RealtimeSegmentEngine` carries the same defects live. It is four registries, not two, and it misses
    `connectors/index.ts:27`, which builds a Coach audience store on every live path.
30. **F32 understates both measurements and over-sizes the remedy.** 101 MiB at 100,000 pieces, not 37.42, so the
    25 MiB wall arrives at about 24,700 realistic pieces, not 67,000; and 1,586 to 3,297 ms for the
    300,000-piece ranker, not 502. But the launch-relevant fix is S–M, and the dominant cost F32 never measures
    is re-parsing and re-validating the whole catalog on every 30-second isolate-cache miss.
31. **F33's severity is wrong.** It is filed "fix before the next customer"; the isolation it leans on already
    fails on a two-brand stamp, so it is blocks the pilot. Its "five customer regions" is also unsourced, and it
    leaves its strongest citations unused, including `wrangler.toml:312` calling `TENANTS` a per-customer input
    on a single shared production worker.
32. **F34's measurement half is aimed at the browser and the server fails first.** `buildReport` takes 1.05 s at
    a mid-pilot shape and 160 s when outcomes approach decisions, so this is not a UI-paging job. Its SDK remedy
    also needs an `ElementLike` interface change it does not name.
33. **F35's severity is understated.** The audit declined to execute the geo seed; executed, the published deploy
    runbook silently drops NY crosswalk ZIPs from 14 to 1, cuts a demo cohort from 640 to 44 while still
    clearing its own 30-row gate, and replaces a "Census ACS 2024" provenance row with a proxy, falsifying a
    stage claim. It also folds `.npmrc.bak` into a secret-hygiene consequence it cannot carry.
34. **§3's "forty measured calls" is wrong** (the script default is 60, and it is 240 calls across six rows), the
    object-host row is unlabeled caller wall time in a section whose own preamble requires the label, and
    `decide: 0 ms` is not a resolution artifact: the instrument cannot see CPU-only work at any catalog size.
35. **§4 rebuts three claims the delivery documents never make** (row 1 twice, row 10), and row 2 misnames a
    wiring gap as a missing input. The genuinely false statement there is doc 22 §18.8's "Resolved 2026-09-02".
36. **§5b's D12 conflates the delta with the target.** The latency measurement was delivered as asked; the
    budgets it revealed are unmet. Say that, or the team loses credit for work it did.
37. **§7 item 9 understates the JWT finding.** The committed placeholder is untouched, and the default `[vars]`
    block now also sets `AUTH_MODE = "enforced"`, so a default-environment deploy enforces auth on a secret
    published in the repository.
38. **§8 files as unverifiable several things the repository decides today.** The binding manifest is complete;
    `TENANTS` is absent; `CORS_ORIGINS` is empty on both customer stamps, so the customer's own site is refused
    today; allocation, holdout permanence and the estimator's Type-I error are all measurable without customer
    data. Three further items are absent or broken rather than unverified: no non-rotating reconcile, no
    down-migrations anywhere, no configured retention.

---

## 5 · The fitness question, answered plainly

### Tapestry

**The scoring core is the right foundation and should be kept. The implementation around it is not a product
yet, and cannot take Tapestry's real shopper data today.**

Keep, without hesitation: bounded per-shopper per-dimension affinity that a human can read; explainable recency
arithmetic; content IDs rather than page markup; configurable slot strategies; deterministic default scoring;
candidate-preserving external-feed sorting; the receipt; and separate population estimates as a concept. These
support 20 to 30 personalized assets, business tuning and within-session adaptation with no embedding service on
the render path. That judgement was right and the verification strengthened it.

What is not delivered is everything that turns that core into something a customer can be given: the security
boundary, tenant binding, consent, identity, erasure, the ledger, configuration publication, learning
persistence, and measurement. Each of those is independently unsound, and several are unsound in ways that are
silent. That is the pattern the team should take from this audit: almost every defect here fails quietly and
passes its own tests. 1,092 tests are green while an anonymous caller reads a PII profile, an erased shopper is
rebuilt from her own cookies, a page's ledger rows exceed the queue limit and vanish, learning dies permanently
with a valid-looking snapshot still on screen, and a holdout comparison prints NaN.

January on one Coach page is achievable, but only as: deterministic ranking, learning in shadow with the
exposure path fixed (it fans at gamma 0 regardless), no incrementality claim, one brand, and items 1 to 13
landed. The readable-vector and pooled-counts substitutions for embeddings, similar-user matching and the
learned journey classifier are defensible engineering, and I would keep them, but they are substitutions and
they need the customer's explicit agreement rather than a register row. The January page is not the May 2027
experience-composition tier, and neither date closes the multi-brand, data-sharing or product-sort commitments.

### The next customer

**Not ready, and the honest reason is that nothing has yet proved it is not Coach-shaped.**

Keep the engine: the composer, the affinity model, the content-ID contract, the sort, the receipt, the versioned
configuration document as a concept. Discard the deployment assumptions entirely: one worker per environment
rather than per customer; four separate tenant registries that all default to `coach`; connectors constructed
with no tenant at all, so a second brand's operator-authored audiences are dead on arrival; a demo estate and
four other prospects' database migrations mounted on customer stamps; and a provisioning script that rotates
every credential on re-run and destroys brand one's site key when adding brand two.

The specific trap is that Coach is the default of every registry, so today "it works" and "it silently fell back
to Coach" are indistinguishable from the outside, and the isolation test suite codifies that fallback as
correct. The first honest portability proof is the one the F31 verifier specifies: a decision and an event run
end to end under two non-default tenants, asserting that config scope, audience keys and trend key all carry the
tenant, written so that it fails on today's HEAD. Until that test exists and passes, no statement about
arbitrary-customer readiness is supportable, and doc 20 row 3 should read open.

Ten brands, five regions and 300,000 products remain a workload to size rather than a reason for GPUs or a
vector database. But the measured catalog wall is about 24,700 pieces per scope, not the 67,000 the audit
estimated, and a 300,000-piece ranker takes 1.6 to 3.3 seconds, so indexed retrieval before scoring is required
for a large corpus, and the currently supported envelope should be published rather than implied.
