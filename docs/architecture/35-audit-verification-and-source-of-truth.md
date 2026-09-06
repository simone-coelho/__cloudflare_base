# 35 · The audit, verified: one source of truth for what is wrong and what to do

Internal. 2026-09-06 and 07. Verifies docs/architecture/34-independent-adversarial-audit.md against the
code at commit `c10ccff`, which is HEAD and the commit the audit names, so no line drifted and nothing
has been fixed since. Written for the delivery decision: what stands, what the audit got wrong, what
both the audit and the builders' brief (doc 33) missed, and one ranked remediation list.

**How it was verified.** Forty-six independent verifiers, one per audit finding (F01 to F35), one per
audit section (performance, the thirteen decisions, the two traceability tables, gates and the earlier
34-item audit, the not-verified list), and five sweeps for what neither document names (security and
tenancy, data privacy and lifecycle, learning and statistics, operations and delivery, customer-facing
promises). Each ran on Opus at maximum reasoning effort, read-only on the tree, and reproduced the
audit's probes in scratch harnesses against the repository's own modules, Miniflare and workerd where
the question was a runtime limit. Every verifier's full report is committed under
`docs/architecture/35-verification-reports/`; this document carries their verdicts.

---

## 1 · The verdict

**Every one of the thirty-five findings is confirmed, at high confidence.** None is refuted. Most are
understated: the verifiers found the failure reaches further than the audit said, or a second path to
the same failure, or a test that passes for the wrong reason, in 33 of 35. The audit's own verdict
stands: retain the deterministic scoring core; do not accept the current implementation as
customer-pilot-ready, enterprise-isolated, or evidence of incremental business lift.

Severity moved in eight places, always upward:

| Finding | Audit | Verified | Why |
|---|---|---|---|
| F14 KV as authority | blocks the pilot | **blocks launch** | Reproducible state destruction: 7 of 8 page-paint signals lost, a missed pointer read permanently orphans a shopper's profile, KV lag returns 500 and drops the outcome from the ledger |
| F15 configuration not atomic | blocks the pilot | **blocks launch** | One transient KV read failure silently reverts every tuned weight to the compiled default, returns 200, and leaves a clean audit trail |
| F33 stamp boundary | fix before next customer | **blocks the pilot** | Ledger 20 reports brand isolation closed; a Coach site key plus one header reaches Kate Spade's shopper object with a 200 |
| F34 SDK lifecycle | fix before next customer | **blocks the pilot** | A correct SPA mount/detach/mount fires two clicks per human click, silently, and moves the learned lift 1.256 against 0.744 for identical pieces |
| F31 two registries | fix before next customer | fix before next customer, but **doc 20 row 3 must reopen today** | Multi-brand isolation is recorded closed and is false |
| F35 repository debt | improvement | **fix before the next customer** | The published deploy runbook, run once on a fresh database, silently degrades the Meridian NYC cohort from 640 shoppers to 44 and falsifies a census-provenance claim |
| F16 ledger duplicates | blocks the pilot | blocks the pilot, loss half **near blocks launch** | No dead-letter queue anywhere; a thrice-failed batch is deleted with one console line |
| F18 order-dependent decay | blocks the pilot | blocks the pilot, one path **blocks launch** | Client-supplied outcome timestamps are unbounded; ten crafted back-dated purchases destroy 82% of an item's evidence slot-wide |

**Sizes moved in the other direction.** In 27 of 35 findings the launch- or pilot-blocking part is S,
one to three engineer-days, while the audit's single size label covered the full remedy programme.
The audit's estimates are right for the programmes; presenting each as one unit is what would cause
the sharp, hours-long fixes to be scheduled behind multi-week builds. Section 4 separates them.

**Thirty new findings** neither document had, from the five sweeps. Nine block launch. The three
sharpest: an authenticated generic store route that lets any operator token read, overwrite and
delete any tenant's KV keys and ledger objects; the default environment enforcing authentication
against a JWT secret published in the repository; and erasure that the browser undoes on the next
page view because the profile is mirrored into cookies. Section 3 lists all thirty.

---

## 2 · The thirty-five findings, verified

Columns: verdict; severity as verified; size of the part that closes the blocking severity, then the
audit's full remedy; what the audit got wrong; what it missed; the smallest safe fix. Line numbers are
at c10ccff. Sizes: S one to three engineer-days, M one to two weeks, L multiple weeks.

### F01 · Public and demo surfaces inside the customer boundary
Confirmed. **Blocks launch.** S closes it; M for the audit's containment; L for deployable separation.
Reproduced in workerd with AUTH_MODE=enforced and no credentials: `/v1` and `/realtime` answer 401,
while `/sort`, `/track/*`, `/pixel`, `/cdp/*`, `/optimizely/*`, `/webhook/*`, `/operator` reads,
`/live/ops-api` writes, `/ai/scene` and `/experiment/launch` answer 200, and `/agents/*` returns 101
upgrades to the Opal agent, the shopper object and the push relay. An anonymous caller wrote a PII
profile; a second anonymous caller read it back. Five lexical bypasses of the agent's SQL guard reach
D1 and return operator password and session hashes, because migration 0010 put the credential tables
in the same database the agent queries. **Audit wrong:** `index.ts:85` gates `/realtime/*` only, `/v1`
is line 86; the agent exposure is an application choice at `index.ts:185` (no auth hook), not a
dependency finding; the remedy leads with an allowlist that is 25 lines. **Missed:** the credential
tables in the agent's D1; the SQL guard fails open when its regex does not match; `/agents/rate-limiter/<ip>`
is a targeted denial of that caller's budget; `operatorWrites()` passes every GET so `/operator/insights`
is anonymous; `/webhook/segment` and `/webhook/custom` verify nothing; the demo pages carrying the site
key in a meta tag ship in both customer stamps' assets. **Smallest fix:** two edits in `src/index.ts`,
inert in open mode: a deny-by-default middleware in enforced mode, and agent dispatch only in open mode.

### F02 · Refresh tokens as access tokens
Confirmed. **Blocks launch.** S closes it; M for the full remedy. Reproduced first try: after logout
the refresh token gets 401 at `/auth/refresh` and 200 on `/v1/coach/monitor`; it also retuned live
decisioning via `PATCH /config/reflex`, logged against the signed-out operator. Revocation is missing in
five directions: logout, disable, delete, role demotion, and password change never calls
`revokeSessions`. In enforced mode `sdkKey()` hands any bearer to `jwt()`, so the refresh token also
opens `/realtime/*` and `/operator/*` for any tenant with no site key. Eleven green auth tests assert
revocation only through `/auth/refresh`. `wrangler.toml:159` commits `JWT_SECRET` in the default
`[vars]`; a forged admin token from that value passed. **Audit wrong:** the algorithm allowlist is
hygiene (jose already rejects `alg:none`); the typed-claim remedy as written breaks eight tooling
scripts including the acceptance run. **Smallest fix:** one line after `jwtVerify` in
`src/middleware/auth.ts`: reject `type === 'refresh'`; then add `revokeSessions` to `/auth/password`.

### F03 · Tenant not bound to caller authority
Confirmed. **Blocks launch** for a Tapestry-wide launch; latent today because `TENANTS` is unset
everywhere, so only Coach is provisioned. M to L overall, S core. Reproduced through the real
`/realtime` handler: a Coach key plus `X-Tenant: kate-spade` opens `t:kate-spade:vis-1` with 200; a
Kate Spade key on a shared host silently writes Coach's unprefixed namespace. **Missed:** the
operator-token branch at `edgeAccess.ts:119` bypasses the one gate that binds; path and context tenants
disagree inside a single `/v1` request, so brand B's ledger is built from brand A's behaviour; 24 of 37
`/v1/:tenant/*` routes authorize by path segment alone, including ledger export and erasure; the shipped
default `SDK_KEYS='*:demo-site'` voids the binding; `X-Tenant` is absent from CORS `allowHeaders`, so
the remedy's SDK change fails every preflight until that list changes; `provision-stamp.sh:50`
replaces the secret, deleting brand one's key when brand two is added. **Smallest fix:** in `sdkKey()`
authorize against the resolved tenant not the path param, 409 on disagreement, refuse `*` in enforced
multi-brand mode, ship with the SDK sending its brand and the CORS header.

### F04 · Account proof optional; logout resurrects the previous shopper
Confirmed. **Blocks launch.** M. On an env shaped exactly like `provision-stamp.sh` output with
AUTH_MODE=enforced, an unsigned link to any account id returns 200 and hands back that person's live
profile: the script never sets `IDENTITY_SECRETS`, and `assertion.ts:99` falls open without them.
After link then detach, a fresh anonymous visitor carrying the unrotated SDK session resolves to the
previous shopper and is personalized on that shopper's affinity. **Missed, and these defeat the audit's
remedy:** a second resurrection path with no cookie and no session id, the `user:{visitorId}` pointer
written at `SessionManager.ts:434` and followed at `RealtimeSegmentEngine.ts:897`; a live cross-tab leak
before any logout; the pointer never lapses (re-put every 24 hours on read); a session id is a bearer
credential for a person's record (`GET /realtime/session/{id}/analytics` returned the person's segment
history on the site key alone); session ids carry 24 bits of randomness. **Smallest fix:** refuse
`assurance:'site'` in enforced mode and add `IDENTITY_SECRETS` to provisioning; one ownership guard in
`getOrCreateSessionFromCookies` refusing a record whose shopper id is set and is not the requester.

### F05 · Consent not one enforced decision
Confirmed. **Blocks launch.** M to L. Reproduced: the object host ignores an explicit cookie refusal;
a state-read failure reads as consenting; a server-to-server call with no cookie reads as consenting;
`/sort` re-ranks for a shopper who refused both switches; with tracking refused the event still reaches
ODP on both hosts with a stable id and product ids (`ShopperReflex.ts:614` comments "nothing left the
edge" four lines after the send). **Missed:** the personalization switch is enforced in one file only;
the contracted API has no consent parameter; logout erases the refusal; `/track` and `/pixel` store the
IP outside the consent model; the self-monitor's consent check passes only on the session host and would
alarm permanently on the other; consent cookies are not httpOnly so page script can set consent to true.
**Smallest fix:** resolve consent once in `readShopper` as the intersection of stored switches and the
cookie, explicit false winning, on both catch paths; a consent field on the decision and sort bodies;
ODP, region fan-in and demo capture behind that value.

### F06 · Erasure incomplete and undone by delayed delivery
Confirmed. **Blocks launch.** M for the core; L for the audit's full remedy. The headline replay
reproduced: erase, let the nightly rewrite retire the tombstone, redeliver the queue message, the row
is back permanently and visible. Worse: the rewrite never revisits a cleaned day, so a late row is
permanent from the first nightly run; at the repo's own volume constant one erasure needs about 259
nightly runs against a one-month statutory deadline. **Missed:** the ordinary event endpoint accepts an
unbounded client timestamp, so it is a back-dating endpoint that re-creates pre-erasure rows; D1
`demo_events` is uncovered on staging; earlier session records are orphaned for 30 days; the 50-visitor
cap leaves identity keys resolving to the erased person for 400 days; the export's only erasure signal
disappears in 3 to 27 hours. **Smallest fix:** stop deleting the pending tombstone at `erasure.ts:214`,
mark it rewritten and keep hiding for the replay horizon; in `consumeLedger` drop tombstoned records
before the write, from a cached watermark.

### F07 · The holdout is not a test of incrementality
Confirmed. **Blocks launch** of any incrementality claim. L. Both audit numbers reproduce. Under a true
null the shipped comparison calls a winner 23.5% of the time at nominal 95%; on a real null day it
declares control better; a genuine 59% clicks-per-visitor win reports as undecided. Login moves 94% of
anonymous controls out of the control and orphans the decision ring (`link.ts` never migrates it).
**Missed:** the identical construction in `hourly.ts:307` (the production path) and `window.ts:78`;
`neededPerArm` returns NaN when a rate exceeds 1 and the NaN reaches the operator; the holdout is
per-brand with no Tapestry-wide population and nothing records which salt a result was measured under;
`TAPESTRY_TARGETS` is a CVR target applied to a clicks-per-decision ratio, and nothing computes CVR,
revenue per visitor or return rate. **Smallest fix:** stop publishing it as incrementality (rename,
drop the target reading, clamp, guard NaN, about a day); then persist arm and salt version on first
decision and carry it through link and detach (M, the prerequisite for any statistical work).

### F08 · Learning storage hits the Durable Object limit
Confirmed. **Blocks launch**, and the audit's qualifier "of enabled learning" is wrong: exposures fan
at gamma 0, gated only on tracking consent, so shipping with learning off does not avoid it. S closes
it; L for the full remedy. The real `LearnStats` class in workerd fails at 14,810 cells with
`SQLITE_TOOBIG`; `DecisionRing` fails at 20,300 decisions for one visitor. The stored value is items
times cells: the seeded chero slot dies at 1,203 cells, 0.75% of the cell space its own config can
produce from US traffic. **Audit wrong:** the byte figure 2,618,613 is unreproducible (2,468,636 at
15,000 cells); nothing returns 500, the call throws and every layer swallows it. **Missed:** the failure
is silent and permanent (the poisoned map fails even no-new-key writes, the alarm never re-arms);
`publish()` spreads the whole raw state into every KV snapshot the decision path parses; `channel` is an
unvalidated query parameter in five of six level keys, so a site-key holder can kill a slot object in a
few thousand requests; the 90-day index that kills `DecisionRing` is dead weight nothing reads.
**Smallest fix:** cap distinct keys per item and per slot with least-recently-touched eviction at the
fine levels, allow-list channel, catch the save and make the failure loud, delete or cap the ring index.

### F09 · Re-provisioning rotates identity, authentication and all site keys
Confirmed. **Blocks launch.** S closes it; M for the programme. Reproduced with a fake wrangler: a
second run swallows the create failures, prints a message saying nothing was done, then rotates
`JWT_SECRET`, `IDENTITY_SALT` and `SDK_KEYS` on the live worker, because the stop-guard is inert once the
ids are filled, which is the committed state of both environments. Then the seed hits the email UNIQUE
constraint, `set -e` kills the script before the key is printed, and the environment enforces a site key
nobody holds. **Audit wrong:** "merge site-key entries" is not implementable in the script; secret values
cannot be read back. **Missed:** nothing else can add a brand's key; it is a regression from the older
script that prompted a human; `IDENTITY_SECRETS` supports a previous value but `IDENTITY_SALT`, whose
change renames people, does not. **Smallest fix:** gate secret generation behind `--rotate-secrets`,
skip when `wrangler secret list` names them, print the site key at generation, drop the blanket `|| true`,
make the seed `ON CONFLICT DO NOTHING`.

### F10 · Release gates and monitoring
Confirmed. **Blocks launch.** S for the sliver; L for the remedy as written. Lint exits 2 before
analysis; with the one-word config repair it is 5 errors and 324 warnings, all trivial. `deploy.sh`
aborts at line 15 and has never reached its tests. **Worst, missed:** on the object host the monitor's
synthetic decision writes exposures into live learning statistics before its consent check throws, about
2,000 per tenant per day at every pooling level; on the session host it writes two KV keys per run at
30-day TTL. No dead-letter queue on any consumer with `max_retries=2`. The monitor is green on an empty
tenant. **Smallest fix:** the ESLint prefix, four trivial errors, lint in CI; fold cookie consent into the
object-host read (also F05's fix); fail the monitor on zero decisions where slots exist; a dead-letter queue.

### F11 · The twelve-capabilities register omits scope
Confirmed. **Blocks launch** as a representation. S for the register; L for the missing workflows.
Doc 20 has no row at all for §1.9 (Product Recommendations entitlement) or §1.10 (AI Search on the
customer catalog); §1.3 closes on an importer with no label-approval step; §1.12 closes on a pull API
with no Snowflake destination anywhere. **Audit wrong:** "restore" describes a regression that never
happened, those rows were never entered. **Missed:** the enrichment commitment lives in three more
customer-facing documents including the PS guide's onboarding step P3 with person-days; AI Search's
"live affinity" is two caller-supplied fields; history ingest applies rows the tenant's own registry
weights at zero. **Smallest fix:** documentary, add and split the rows, qualify the same claims in the
four documents.

### F12 · The documented SDK integration never repaints
Confirmed. **Blocks the pilot.** S for the gate; M only if a genuine push is in scope. Reproduced
exactly: three events, one paint, one snapshot, the original hero. **Audit wrong:** the SDK is not
incapable, one added `hydrate()` repaints; the defect is a kit promising a `content_decisions` frame
(`01-integration-guide.md:156` and four other documents) that no server sends. **Missed:** the
storefront rehearsal passes on the demo's private rehydrate, not the published contract; an exposure is
written per snapshot call, so a naive refresh loop corrupts the lift denominator; overlapping hydrates
land in completion order and the older wins; every repaint re-fires impressions. **Smallest fix:**
correct the five documents; a documented coalescing `refresh()`; make refresh not write an exposure.

### F13 · Visit, channel, journey and memory not as claimed
Confirmed. **Blocks the pilot.** M. A shopper with visit 4 and paid social in KV gets cell
`{channel: unknown, visit_bucket: unknown}`; buckets 2-3 and 4+ are unreachable though published; at
gamma 0 the two fields move no score; two product views are labelled considering where the customer's
paper says exploring; the launch brand runs a 60-second decay, so return memory is zero after an hour.
**Missed:** the stored entry channel is itself wrong for the kit's own hydrate-first integration (written
`direct`, never corrected); the decision path never advances the visit boundary; the object host has no
visit or channel state at all, so flipping `REFLEX_HOST` regresses the one value that works; the journey
stage latches for a month. **Smallest fix:** about a day, carry visit number and channel into
`ShopperRead`, apply the visit boundary at read time, stop writing `direct` for unknown.

### F14 · KV as the authority for shopper state
Confirmed. **Raised to blocks launch.** L for the transition; S subset now. Ten reproductions: two
concurrent views record one; eight page-paint impressions record one of eight at seven writes to one
key; KV lag returns 500 and drops the outcome from the ledger while D1 already holds the event.
**Missed:** `createOrUpdateSession` unconditionally rewrites the `user:<visitor>` pointer, so one missed
read permanently orphans a shopper's profile; CW37's deferred create, dispatched with an empty body,
erased two views and six dimensions committed after it; the identity link has the same shape;
`SameSite=Lax` means an SDK on the customer's domain never sends the session cookie, so the pointer path
is the normal case; `/sort` mutates state on the session host. **Smallest subset:** thread the client
session through the event route, use the create's return value instead of re-reading, make `/sort`
read-only, use the memoized catalog. Record these as buying time, never as closing F14.

### F15 · Configuration neither atomic nor conflict-safe
Confirmed. **Raised to blocks launch.** M overall; S for the blocking subset. The audit's probe
reproduced verbatim, and through the real `PATCH /config/reflex` both operators get 200, revision 2 and
the same label while one slider is discarded. **Missed, worse than what was found:** publishes 28
seconds apart collide with no concurrency at all (30-second isolate cache); a single transient KV read
failure makes `patch` merge onto the compiled default, silently reverting every tuned value with a
clean monotonic audit trail; `write` cannot distinguish read-failed from nothing-stored, so the counter
rewinds and rollback restores the wrong document; the audit index is itself an unguarded
read-modify-write. **Audit wrong:** "immediately effective" is its paraphrase, doc 22 says "without a
deployment". **Smallest fix:** about 30 lines in `versionedStore.ts`: distinguish read failure from
empty and fail closed, compute the next number from the index and check the key before writing, bypass
the isolate cache inside write, wrap the puts.

### F16 · Ledger and online learning disagree about the same event
Confirmed. **Blocks the pilot**; the loss half near blocks launch. M. A redelivered decision set plus
a redelivered outcome move the learned lift from 1.418 to 1.471 and, at a true 5.00 versus 5.64 split, a
10% duplicated share flips the holdout verdict to treatment better. **Audit wrong:** stable ids already
exist and are byte-identical across redelivery, the work is to use them; content-addressed object naming
will not survive a Queues regroup; a duplicated ring append cannot double a credit (attribution caps
per slot), it inflates fatigue instead. **Missed:** no dead-letter queue in any of three consumer blocks;
`enqueue.ts:19` is an empty catch; `post()` in `fan.ts` never checks `res.ok`; duplicates push legitimate
hours past the fold's object cap. **Smallest fix:** deduplicate on read in `loadDay` and
`loadHourRecords` on the ids that exist, plus a dead-letter queue and a logged enqueue failure.

### F17 · Hourly folding loses late data
Confirmed. **Blocks the pilot.** S for the silent-failure part; L for the full remedy. All four
scenarios reproduce. **Audit wrong:** configured pages emit 7 to 9 records, not 20 to 30, so 200
receipts is about 22 page views, not 7 to 10; failed hours are listed in `hours.missing` and truncation
in `counts.truncated`, so only four cases are genuinely silent: late data, `ringsFolded=false`, the
visitor-count freeze, and a truncated hour rebuilt at a higher cap. **Missed:** the day's distinct
visitor count freezes after an out-of-order repair across a date boundary (4 reported where 8 served);
truncation drops the end of the hour, time-biased; `ringsFolded` is written and never read; the window
report carries no truncated, unfolded or horizon field and is the artefact a lift claim would be made
from. **Smallest fix:** a maturity window that rebuilds an hour when its object count grew; a set of
folded hour-starts instead of `through`; key `seen` by date; carry the flags into the day and window
reports and render them.

### F18 · Decay depends on arrival order; rare rates round away
Confirmed. **Blocks the pilot**; the timestamp path blocks launch. S. Both audit numbers reproduce
exactly. Below a 0.0005 rate the slot rate rounds to 0 and lift is forced to exactly 1 at every level:
an item with true lift 1.994 serves at 1.000. **Audit wrong:** steady-state online jitter is 0.00% at one
second, so "queue reordering" is not the live vector; replay and catch-up shapes are (-46%), and
unbounded client timestamps are (ten crafted back-dated purchases destroy 82% of an item's evidence).
**Missed:** the fix already exists 90 lines away as `mergeEntry` in `hourly.ts:143`; the remedy has no
migration step for counters already skewed. **Smallest fix:** make `bump` the shape of `mergeEntry`,
memoize the exact slot rate and round only for publication, reset and refold each object once, clamp
the event timestamp.

### F19 · Changing objective or policy relabels history
Confirmed. **Blocks the pilot.** M, not M to L, since the report and fold already rebuild statistics
from the ledger; S for the guard. The 401 probe reproduces through the real object; a mixed snapshot
serves the piece that earned $1,100 over the one that earned $10,000. **Missed:** contamination needs
no objective change, because the online path banks purchase credits at unit weight while the slot learns
clicks; `margin ?? value` makes the counter's unit depend on feed completeness; currencies sum into one
scalar and a refund can never subtract; `learn.stats` is tenant-wide so tuning tau for one slot re-bases
every slot; the autonomy cycle propagates mixed units into configuration with a justifying note; doc 22
claims the ladder order is a dial and it is hardcoded. **Smallest fix:** stamp a generation hash on the
counters and restart on mismatch, keeping the superseded snapshot in the archive.

### F20 · Priors attached to a nonexistent item
Confirmed. **Blocks the pilot**, unconditionally, since doc 20 records priors import as closed. S.
Reproduces verbatim including the phantom id. Four of six ladder levels of the priors feature are dead;
coarse plus fine priors serve the wrong value, not none; a valid prior on a revenue slot clamps the item
to lift 0.5. **Audit wrong:** its example uses `n_equiv=20` below `nMin=30`, so a retest with its own
numbers will look like the fix failed. **Missed:** the operator surfaces publish the phantom; a new slot
with priors and no events publishes no snapshot at all; the prior cell grammar accepts any order, and
CW29's ladder reordering silently invalidated older DS exports; the day report ignores priors at every
depth. **Smallest fix:** six lines, index priors by item from the structured rows; a seven-case
regression test fails 5 of 7 at HEAD.

### F21 · Direct attribution ignores the slot; served is not seen
Confirmed. **Blocks the pilot.** M; the slot half S. A click naming hero credits hero and rail;
position alone gives a 3.80x lift spread between rank 1 and 5 with identical content, nearly
saturating the clamp. **Missed:** `servedCounts` ignores the slot too, and fatigue is a live scoring term,
not shadow; the learning identity has no page, so home hero and PDP hero share one statistics object;
`learn.test.ts:25` titled "one credit per slot" asserts two slots credited for one click; the receipt
reports 3,991 exposures at the finest level for a slot nobody painted. **Audit wrong:** "use decision ID"
is a wire and SDK change, the click carries no decision id. **Smallest fix:** a fifth policy axis,
`placement: named | any`, default named, treating the literal `unknown` as absent; one pure function
fixes online and batch together.

### F22 · Replay lacks the page state
Confirmed. **Blocks the pilot.** S; the audit's M fits its broader list. The two-slot example
reproduces verbatim. **Missed:** it fires at gamma 0 through rotation or Thompson on an earlier slot,
so shadow mode is not a mitigation; on Coach's own seeded four-slot page 7 of 9 valid receipts report
unequal, 31.7% across 200 shoppers; the archive gap is permanent (version is `Date.now()`); a pinned
decision is refused for a lift it never used. **Smallest fix:** carry the page's per-slot snapshot
versions on every record, fetch every slot's archive on replay and fail naming the missing slot, write
R2 before KV.

### F23 · Thompson ignores the budget; wrong model for money
Confirmed. **Blocks the pilot**, condition already met since the mode is offered in two operator UIs.
S to withdraw; M to repair. 48 of 100 leader changes at share 0 and identical at share 1. Under revenue
the failure inverts: s exceeds n, the Beta collapses, and exploration silently stops while preferring
total revenue over revenue per exposure. **Missed:** 71% of Thompson's reordering is logged as
un-explored; the recorded candidate support is truncated after the reorder; merchandiser freeze and
reject are bypassed; doc 22 §7's cooldown dial does not exist. **Smallest fix:** withdraw `thompson`
from the schema, the two selects and the two documents; or two lines moving the share gate above the
Thompson block and returning only a first-position pick.

### F24 · Autonomy applies stale proposals
Confirmed. **Blocks the pilot.** M. Every probe reproduces: a 0.10 to 0.15 proposal applied 30 days
later onto 0.90 wrote 0.15, on a slot whose autonomy was off and whose dimension was pinned; a failed
write left a durable "applied" receipt; one observation out-scored 9,999. **Missed:** a proposal has no
page, so it applies to every page with that slot name; duplicate proposal ids per cycle; the spread
statistic is a count of tag values and favours high-cardinality dimensions 400 of 400 under noise; no
role gate on the apply route; the monitor never references proposals. **Smallest fix:** about 25 lines
in `decideProposal`: refuse when mode is configured, the dimension is pinned, the proposal is old, the
step is exceeded, or the current value differs from `p.from`; write the receipt after the slot write.

### F25 · Long-window reports truncate and overstate readiness
Confirmed. **Blocks the pilot.** M with an S core. A January-to-June request returns 92 days ending
April 2 under a June 30 label, 51% of the period, with `missing` empty. `neededPerArm` is fixed at 95%
and equal arms: 5.2x optimistic on traffic, 1.9x conservative on the control gate. Scaling the absolute
interval by a point rate awarded a too-generous target rung in 83 of 756 realistic shapes and a shipped
test locks that in. **Audit wrong:** retention names the wrong mechanism, the window reads stored day
reports that nothing deletes. **Missed:** both report GETs are unauthenticated; targets are hardcoded to
Tapestry for every tenant; the window pools days built under different policies with no signal.
**Smallest fix:** 400 or a truncation field on an oversized request, force undecided when any pooled
day is incomplete, a log relative interval, pass the confidence into the sample size.

### F26 · The merchandiser's control is missing; the stage form is invalid
Confirmed. **Blocks the pilot.** S plus S. The shipped default `inStage: 1.2` is rejected by the real
validator; one click on the journey-stage switch leaves a merchandiser with a raw JSON-path error and a
disabled save. Of the form's 1 to 3 range only the value 1 validates, and at that value a piece with
affinity 0.05 outranks one with 0.9. **Missed, worse:** clearing the box saves the maximum-effect value
silently, exactly inverted from the engine's off defaults; the slots grid strips weight values
server-side so the merchandiser cannot even read them; the console test stubs the validator. **Audit
wrong:** "exclusions" is a capability that does not exist anywhere, not a missing form. **Smallest fix:**
four lines in `views-config.js`, and wire the real validator into the console test.

### F27 · Feed normalization drops merchandising
Confirmed. **Blocks the pilot.** S core; M as written. All three behaviours reproduce; a merge refresh
destroys a stored merchandising block even when the feed still supplies it; the customer's own
explore/consider/decide words 422 the whole catalog. **Audit wrong:** the import adapter already dedupes
tags, so inflation is a direct-PUT defect; routing direct PUT through the normalizer, as the remedy
instructs, would break the only path that works. **Missed:** a refresh omitting status resurrects
expired content; a tag-less feed validates and silently zeroes the catalog; no console can set the field
at all. **Smallest fix:** carry merchandising in the normalizer, stop defaulting lifecycle to live on
merge, accept the customer's stage words, dedupe tags in the validator.

### F28 · Later pins duplicate earlier selections
Confirmed. **Blocks the pilot.** S for reservation; M for the contract. Reproduces in the real
composer on both arms. **Missed:** two slots pinning one piece duplicate it with no ranking involved
and the validator accepts the document; a pin overrides `slotTypes`, the only eligibility control; a
pinned slot ignores `take`; a dead pin silently deletes the slot; the duplicate double-credits the
pinned slot in attribution. **Audit wrong:** no shipped configuration triggers it, all seeds pin first;
"reject contradictory pins" cannot be a write-time guarantee because the catalog is a separate document.
**Smallest fix:** four lines reserving every resolved pin before the slot loop.

### F29 · Engineering proofs are not the customer acceptance
Confirmed. **Blocks the pilot.** M. **Missed, and blocks-launch grade:** the kit already tells the
customer the script transcript "is the acceptance evidence" (`04-staging-connection.md:86`); doc 21
contradicts itself ten lines apart; `notifyAbsence()` in `listen.ts:53` notifies only `onDecisions`
subscribers, never slot subscribers, so the kit's headline ten lines render an empty hero when the
snapshot fails, contradicting "never shows a hole" in three documents. **Audit wrong:** it omits
`rehearse-storefront.sh`, which already drives the SDK headlessly; doc 19 still names Kate Spade as the
pilot brand against the settled Coach. **Smallest fix:** correct the kit's tense, fix `notifyAbsence`
(five lines and a test), document the server-injected snapshot pattern or correct the no-flash claims,
delete the SSO baseline from the Implementation Plan.

### F30 · The no-runtime-model North Star is conditional
Confirmed. **Blocks the pilot.** S for the gate; M for the table seam. With `learn.external` configured,
the decision path POSTs the shopper's interest vector, cell and the entire unfiltered catalog to an
arbitrary URL; the timeout returns at the budget while the upstream call runs on. **Missed:** the
operator UI ships the control with `workers_ai` in a dropdown and a free-text URL; no scheme or host
validation, so any operator can redirect every shopper profile to any host with no allow-list or alert;
the budget validates up to 5,000 ms against a 200 ms target; the table kind has no writer; the M3 kit
documents `workers_ai` to a customer whose scope forbids it. **Audit wrong:** availability is not at risk,
fallback omit is honoured. **Smallest fix:** an environment switch unset on every stamp, restrict the
validator to table and service, clamp the budget, filter candidates, a test that off makes no call.

### F31 · Two customer registries
Confirmed. **Fix before the next customer**, and doc 20 row 3 must reopen today. L. Nine probes
reproduce every divergence. **Audit wrong:** its title names the event engine and never cites
`RealtimeSegmentEngine.ts`, the live host, pinning the defects on the dormant object host; "two
registries" undercounts, there are four axes. **Missed:** `getConnectors(env)` builds a Coach audience
store on every path, so a second brand's operator-authored audience is never evaluated;
`ensureAudiencesSeeded`'s tenant parameter has no production caller; the operator console is
tenant-scoped while the engine is not, so a merchandiser can author a second brand's audience and no
decision evaluates it. **Smallest fix:** two days, pass the tenant at four call sites and reopen the row.

### F32 · Whole-catalog documents at scale
Confirmed. **Fix before the next customer.** S to M for the real risk; L as written. **Audit wrong,
in the direction of worse:** with pieces shaped like the shipped Coach catalog the 25 MiB wall arrives
at about 24,700 pieces, not 67,000; the 300,000-piece ranker takes 1.6 to 3.3 seconds, not 502 ms.
**Missed:** the dominant cost is the read path, every 30-second cache miss re-parses and re-validates
the whole catalog (92 ms at 10,000 pieces, against the 200 ms target); the `config` duplicate costs 58
to 174 ms per miss for a field nothing reads; every revision body is retained forever; the isolate cache
is an unbounded map. **Smallest fix:** delete the `config` duplicate and invert the one test that pins
it; a 20 MiB size guard; bound the cache.

### F33 · No per-customer stamp boundary
Confirmed. **Raised to blocks the pilot.** M to L. `X-Tenant` is a credential-free brand selector on
`/realtime/*`; `/sort` is behind no gate and uses the resolved tenant; operator tokens carry no tenant
claim and the audit table has no tenant column; a typo in `TENANTS` degrades to coach-only with a
warning and every other brand silently stops being erased. **Audit wrong:** "five customer regions" is
unsourced; slots are per-tenant objects, the shared hot resources are the queue, KV, R2 and D1.
**Smallest fix:** bind the resolved tenant to the credential in `sdkKey()`, mount it on `/sort`, a
tenant claim on operator tokens.

### F34 · SDK lifecycle and measurement cardinality
Confirmed. **Raised to blocks the pilot.** M. A correct mount/detach/mount produces two clicks and two
add-to-carts per human click; the existing test cannot see it because its fake element stores listeners
in a map. **Audit wrong:** the second anonymous listener at `emit.ts:117` for commerce events is the
worse half; the measurement consequence is on the server first, `buildReport` takes 5.5 seconds and 112
MB at its own cap, 160 seconds when outcomes approach decisions, from a linear `find` inside a double
loop. **Smallest fix:** a `WeakMap` attach guard in `emit.ts`; a slot projection on the report route
and a one-line id map in `buildReport`.

### F35 · Repository and setup debt
Confirmed. **Raised to fix before the next customer.** S. The audit declined to execute the geo seed;
the verifier did: the published deploy runbook, run once on a fresh database, drops NY crosswalk ZIPs
from 14 to 1, cuts the Meridian NYC cohort from 640 to 44 (still above the 30 gate, so it clears
silently), and replaces a Census row with a proxy row. **Missed:** `scripts/setup.sh` is broken against
wrangler 4 and overwrites secrets; a superseded engine build under `public/` is uploaded and served by
both customer stamps; two more live copies of the dead `wrangler.toml.example` instruction. **Smallest
fix:** seven lines in the geo seed (`INSERT OR IGNORE`, drop the deletes), the runbook, a regression test.

---

## 3 · What both documents missed: thirty new findings

From the five sweeps, each with a reproduction against the repository's modules. Grouped by severity.
The lens is in brackets.

### Blocks launch (nine)

1. **`/api/*` is a generic cross-tenant read, write and delete door onto every store, behind any
   operator token** [security]. `src/routes/api.ts:7` guards with `jwt()` alone; lines 63, 79, 99 read,
   overwrite and delete raw KV keys; 9, 28, 51 do the same for R2 ledger objects; 111 sends arbitrary
   queue messages. Mounted at `index.ts:93`. A read-only token performed all six. Nothing in the console,
   SDK, scripts or kit calls it. **Remedy:** delete the mount and the file. S.
2. **The default environment enforces authentication against a JWT secret published in the
   repository, and verification fails open when the secret is absent** [security]. `wrangler.toml:151`
   sets enforced beside `:159` plaintext `JWT_SECRET`; `auth.ts:49` encodes an absent secret to zero
   bytes. A forged admin cleared the site-key gate for a foreign tenant. **Remedy:** secret binding,
   refuse to mint or verify on absent, short or placeholder values, extend the deploy guard. S.
3. **Every brand's catalogue, learning dials, reflex configuration and revision history are
   world-readable via `?scope=`** [security]. `content.ts:42` takes the scope from a query parameter,
   `:52` leaves GET open, `/config` and `/content` are mounted behind no gate. **Remedy:** derive scope
   from the verified key or operator membership, gate with `/v1`. S.
4. **`/api/storage` is an unscoped read and write proxy over the ledger bucket** [customer promises].
   The same file as item 1, called out because a Coach operator token read and overwrote a Kate Spade
   decision object. Same remedy.
5. **Erasure is undone by the browser on the next page view** [privacy]. `SessionManager.ts:566`
   mirrors segments, engagement score and user id into non-httpOnly cookies; `RealtimeSegmentEngine.ts:927`
   rebuilds the profile from them when no record is found; erase sends no `Set-Cookie`. After erasure KV
   is empty; the next request restores the exact segment list. F04 and F06 both miss the cookie mirror.
   **Remedy:** clear cookies on erase, stop treating cookie-borne profile fields as inputs, mark them
   HttpOnly. S to M.
6. **Analytics Engine holds subject-level rows with IP, user agent, email and traits, unerasable, in
   one dataset shared by all environments** [privacy, security]. Seven `writeDataPoint` sites beyond the
   ledger points (`tracking.ts:33,89`, `pixel.ts:48`, `webhook.ts:39,112,151`, `optimizely.ts:154`)
   serialise the whole event indexed by the person. F06 concluded no individual rows exist there and did
   not look further. No dataset name in any environment, so dev, staging and production share one.
   **Remedy:** fixed low-cardinality blobs indexed by tenant; gate or remove the routes; name the dataset
   per environment. S to M.
7. **One page's ledger message exceeds the 128 KB Queues limit at the contracted homepage scale, and
   the send failure is swallowed** [operations]. `decide.ts:238,277` copies the affinity vector onto every
   record; measured at 30 assets with 8 dimensions: 135 KB, with 6 plus regional: 188 KB. The loss is
   biased toward the best-personalized sessions. **Remedy:** hoist `inputs` into the envelope, split
   oversized sets, count failures. S.
8. **The hourly fold reads at most 600 objects; the queue's three-second batch timeout produces far
   more at any real traffic** [operations]. A non-idle queue closes up to 1,200 batches an hour, each an
   object per stream; break-even is about 600 pages an hour; at 40 messages a second the fold reads 21%.
   Doc 31 §3 extrapolated a sixty-second run to "dozens of objects" an hour. **Remedy:** raise the batch
   timeout to 30 to 60 seconds or read the hour whole; treat a truncated hour as unbuilt. M.
9. **A reporting overlay silently overwrites the canonical day report** [learning]. `POST /learn/report`
   with custom policies skips the aggregates branch and `runReport` writes the same `reportKey` the fold
   writes and the window pools. The window verdict moved from -47% to -40% relative. **Remedy:** persist
   only when `reporting === null`. S.

### Blocks the pilot (fourteen)

10. **Four uncounted loss paths in the ledger pipeline and no dead-letter queue** [operations].
    Producer errors swallowed, bad records filtered with `skipped = 0`, unplaceable messages acked with
    a warn, `max_retries=2` with no dead letter. During an R2 or Queues incident the system of record
    loses rows with no artefact. M. (Named by F16 as a mechanism; the absence of the queue and the
    per-record filter are new.)
11. **Identifiers are written to the log store on every request, including refused consent**
    [privacy]. Hono `logger()` on `*` logs path plus query; the SDK's decision call carries visitor and
    session id in the query; `index.ts:275` logs whole queued event bodies; logs retained. S.
12. **D1 is a personal-data store the erasure design never enumerated** [privacy]. `demo_events` on
    staging holds a row per action with the visitor id and raw payload; `erase.ts` never references D1.
    M.
13. **No audit trail for privileged access to, or erasure of, an individual's data** [privacy].
    `audit()` is called only for account lifecycle; receipts, identity lookups, ledger export and erase
    leave no row; the rewrite drops the actor from the retired tombstone. S.
14. **Ten anonymous requests lock any named operator out of the console indefinitely, and flood the
    audit table** [security]. Failures counted by caller-supplied email with no IP dimension and no
    unlock route. S.
15. **Content-type affinity never closes: the engine learns on `type` and scores on
    `tags.contentType`** [customer promises]. Three video completions gave affinity `contentType:film`
    and left every hero candidate at score 0; the shipped Coach catalog already disagrees for its four
    films. M.
16. **ODP does not re-seed the interest vector; the documented recovery path is absent**
    [customer promises]. The design document promises re-seeding from ODP on the first event; the code
    restores five audience labels. M.
17. **The published learn schema omits the money objective and mis-defines its lift symbols**
    [customer promises]. The kit's table lists no `objective` though the seed sets the story slot to
    revenue, the slot the acceptance walk sends operators to. S.
18. **The release path has no migration step** [operations]. `deploy.sh` never runs
    `d1 migrations apply`; the first schema change after provisioning ships as code against an old
    database, a 500 on sign-in found by the customer. S.
19. **Alerting is inert on the stamps as provisioned, and the alert's own delivery failures are
    discarded** [operations]. `ALERT_WEBHOOK_URL` is set by no script and required by no gate;
    `alert()`'s result is thrown away. S.
20. **The learned lift is a multiplier on a base score that is zero for a shopper with no matching
    affinity** [learning]. At gamma 1 a cold shopper gets score 0 and catalogue order while the receipt
    says "applied at trust 1"; learning cannot influence the first interaction, the customer's own
    click-one scenario. M.
21. **The lift's reference is the slot rate the item is inside, so a winner's measured lift decays
    toward 1 as it wins** [learning]. An item at a true 0.10 against 0.02: lift 2.00 at 10% share, 1.02
    at 98%. Doc 33 §7 asks exactly this question and doc 34 never answers it. S (leave-one-out reference).
22. **Imported priors cannot move a cold slot, and the receipt attributes their estimate to evidence
    that does not exist** [learning]. Lift is 1 whenever the slot rate is 0, which it is until any
    success; then one unrelated success flips it to the clamp. Distinct from F20. S.
23. **The two recomputations of one day disagree** [learning]. Three attribution readers with three
    bounds (ring 200 and 7 days, fold 200 and 48 hours, records uncapped); one settled day gives 6
    credits from records and 5 from aggregates. M.

### Fix before the next customer (seven)

24. **The day report from records is quadratic** [learning]. 20,000 records take 1.2 to 2 seconds
    locally; at the code's own 50,000 cap it is tens of seconds of CPU with no partial answer. S.
25. **Exploration is documented at 10% by default and ships off in every document** [customer
    promises]. `DEFAULT_LEARN` ships no exploration, so new content never crosses `nMin` and cold
    traffic sees the first-listed piece indefinitely; two customer documents state opposite defaults. S.
26. **The "one npm package, tree-shakeable" SDK does not exist** [customer promises]. The PS guide
    records it as decided; the build emits two whole bundles with no manifest, exports or types. S.
27. **Provisioning a customer stamp installs four other demos' schema and seed data into that
    customer's production database** [operations]. The migrations directory is nine demo migrations
    then the operator accounts. S.
28. **All three environments write to the same unnamed Analytics Engine dataset** [operations]. S.
29. **No runtime tenant registry: `TENANTS` is unset everywhere, so onboarding a brand is a code
    deploy**, and until that deploy a second brand serves decisions while invisible to the monitor, the
    fold, the report and the erasure sweep [operations]. M.
30. **Every stage form and console default was checked against its real validator**: only
    `stage.inStage` fails (F26). Recorded here as a bound, so the absence of other findings is evidence.

The sweeps also recorded 73 things checked and found clean, among them: SQL construction on D1,
the namespacing primitives, the SDK's DOM handling, cookie attributes on the session cookie, the
screenshot route's token comparison, password and session primitives, JWT algorithm pinning, CORS
failing closed, secret generation in provisioning, the Wilson and Newcombe intervals, the holdout hash's
realized share and stickiness, `mergeStats` order-independence, the ladder's key algebra, attribution's
four axes, holdout isolation from learning, the `no_learning` arm, every route and default the kit
documents, the thirteen event types, and every socket frame the kit names having a server-side sender.

---

## 4 · Corrections to the audit's sections

**§3 performance (mostly accurate).** Figures quoted correctly; the synthetic scale check reproduced
within 9% on bytes. Corrections: the latency script's default is 60 calls per row and the audit's forty
is doc 32's flag, 240 measured calls in all; the object-host row is unlabeled wall time; `decide: 0 ms`
is a rounding to whole milliseconds and a Worker clock that does not advance across CPU-only work, not a
resolution artefact; the composer-time column varies 2 to 4x across repeats and should be a range.
Additions: `/sort`'s fix is two arguments at one call site; the value/config duplication costs exactly
half the KV headroom; no piece-count cap exists; the latency script sends no session id so the CW39
path has never been measured; at n=40 the P95 rests on two observations.

**§4 the thirteen decisions (mostly accurate).** 22 of 22 mechanics confirmed. Three cells rebut claims
no delivery document makes (48 to 72 hour convergence, "confidence guarantees", "an SSO claim"); row 2
misnames a wiring gap as a missing input, the dimensions are built and persisted and simply not carried
into the content contract; row 3 under-credits the existing reporting-policy recomputation. Additions:
host choice disables learning (the object host returns null session ids and credit refuses on null);
cell cardinality is integrator-controlled through the free-text channel; the arm called `default`
blends randomized controls, consent refusers and pinned merchandising.

**§5a the twelve capabilities and doc 20 rows (accurate).** All twelve rows and thirteen dispositions
hold against the accepted view of the v8 scope document. Corrections: the 1,092-test count is exact but
a loaded run exited 1 with two timeouts; "every doc 20 row" disposes Section A only. Additions: the
holdout sentence prints "about NaN decisions"; `/sort` persists nothing; doc 20 row 9's "never drops a
candidate" is false as written; v8 materially narrowed §1.1; §1.11's SFCC commitment is a joint
integration during the Section 3.1 window, not a signature-available adapter; no cron performs any export.

**§5b D1 to D13 and the customer's sections (accurate).** Every disposition holds; twelve probes
reproduced, three to the audit's exact figure. Corrections: the section concedes no code-level
strengths in D1 to D5 (the stage rule correctly suppresses itself on the default arm; a value objective
on a valueless reward is rejected; the sort parity proof is kept in code); D12's measurement deliverable
was met, the budgets it revealed are unmet; D11 drops the sharper half, that pins bypass slot-type
matching. Additions: ninety days is a search bound, not a retention policy, raw events are retained
indefinitely; fatigue is page-wide; only one of the customer's three target families exists.

**§6 and §7 gates, verification, the earlier audit (accurate).** All seven gates check out; every
re-executable method claim reproduced exactly; 138 citations resolve; all 34 baseline dispositions hold.
Corrections: item 9 conceals that the committed JWT placeholder ships under enforced auth in the default
environment; gate 3's "end October" names no source while doc 21 re-keys to Kickoff+60; the owner roles
are generic while the plan records two engineering owners. Additions: the `.dev.vars.example`
deliverable is blocked by a `.gitignore` line; 23 of 35 documentation-index links are missing, unchanged
from the baseline; `ONBOARDING.md:160` still tells a new engineer the operator routes are unauthenticated.

**§8 not verified (mostly accurate).** Right on contract, customer integration, the operator walkthrough
and scale. Corrections of kind: the binding manifest is complete in-repo; host mapping is not unverified
but absent; CORS is empty so the customer's site is refused today; non-rotating reconcile, down-migrations
and configured retention are verifiably absent, not unverified; late-backfill suppression is a reproduced
defect; Analytics Engine does carry identifiers, contradicting the erase receipt's basis. Additions: the
suite never runs the shipping runtime (a zero-length HMAC key verifies under Node and throws under
workerd); the compute half of the latency budget is certifiable locally (0.1 ms at the Coach catalog,
31.6 ms at 10,000 pieces under workerd); a doc-22-only reimplementation matches the lift table exactly
once the undocumented per-level rounding is applied; `GEMINI_API_KEY` is typed required and set nowhere.

---

## 5 · The remediation list, ranked

Work items, not findings. Overlapping findings share work. Severity is the highest the item carries;
size is for the item as scoped here. Owner: D delivery track, OL outcome-learning track, B both, C
customer, L leadership.

### Before any real customer data or account reaches a stamp

| # | Item | Findings | Size | Owner |
|---|---|---|---|---|
| 1 | Deny-by-default routing in enforced mode; agent dispatch only in open mode; delete `/api/*`; gate `/sort`, `/track`, `/content`, `/config` reads; require every webhook signature | F01, F33, new 1, 3, 4 | S | D |
| 2 | Reject a refresh token as a bearer; revoke on password change; `JWT_SECRET` as a secret binding with refuse-on-absent; require `sub` | F02, new 2 | S | OL |
| 3 | Bind the resolved tenant to the credential in `sdkKey()`, 409 on disagreement, refuse `*` in enforced multi-brand mode; SDK sends its brand; CORS allows the header; tenant claim on operator tokens and a tenant column on the audit | F03, F33 | S then M | B |
| 4 | Refuse site-assured identity links in enforced mode; provision `IDENTITY_SECRETS`; session ownership guard; rotate the browsing session and revoke the browser-to-person pointer on detach | F04 | M | D |
| 5 | Resolve consent once, explicit false winning, on both hosts and both catch paths; consent field on the decision and sort bodies; ODP, region fan-in, demo capture, `/track` and `/pixel` behind it; keep the refusal across logout | F05, F10, new 11 | M | B |
| 6 | Erasure: keep the tombstone as a watermark for the replay horizon; drop tombstoned records in the consumer; clear cookies on erase and stop rebuilding the profile from them; cover D1 `demo_events`, orphaned sessions, both hosts; audit every privileged read and erase; bound the event timestamp | F06, F18 path, new 5, 12, 13 | M | OL |
| 7 | Analytics Engine: fixed low-cardinality blobs indexed by tenant, never IP, agent, email or traits; dataset named per environment; correct the erase receipt | new 6, 28 | S to M | B |
| 8 | Provisioning: no secret rotation without `--rotate-secrets`, skip existing, print the key at generation, fail on create errors, idempotent seed; an add-a-brand path that merges keys from a manifest; `ALERT_WEBHOOK_URL` set and required; migrations in the deploy path; product migrations separated from demo ones | F09, F10, new 19, 18, 27 | S then M | OL |
| 9 | Ledger integrity: dead-letter queue in every environment; count and log every producer, filter and ack drop; hoist `inputs` into the message envelope and split oversized sets; a continuity check in the monitor | F16, new 7, 10 | S | OL |
| 10 | Learning storage: cap distinct keys per item and slot with eviction at the fine levels; allow-list the channel; loud failure with a degraded flag; cap or delete the ring index; stop spreading raw state into snapshots | F08 | S | OL |
| 11 | Configuration store: fail closed on read failure, next revision from the index with a key check, bypass the cache inside write, visible 5xx on a failed put | F15 | S | OL |
| 12 | Monitor: no synthetic exposures on the object host (item 5 closes it); no KV writes per run; fail on zero decisions where slots exist; a threshold from the stated envelope; the alert result logged | F10, new 19 | S | OL |
| 13 | Lint gate: the plugin prefix, four trivial errors, a pinned warning baseline, lint in CI, so `deploy.sh` runs end to end | F10, F35 | S | OL |
| 14 | The register: rows for §1.9 and §1.10, split §1.3 and §1.12, reopen row 3 (isolation) and row 12 (holdout), qualify the same claims in the four customer documents | F11, F31, F07 | S | L with B |

### Before the SDK and kit are handed to the customer's engineers

| # | Item | Findings | Size | Owner |
|---|---|---|---|---|
| 15 | Kit corrections: strike the `content_decisions` frame from five documents; a documented coalescing `refresh()` that does not write an exposure; fix `notifyAbsence` for slot subscribers; document the server-injected snapshot pattern or correct the no-flash claims; stop calling the script the acceptance; delete the SSO baseline; add `objective` to the learn schema and define `s` and lift for money; state the true exploration default; state log retention | F12, F29, new 17, 25 | S | OL |
| 16 | Visit and channel into the content contract; apply the visit boundary at read time; stop writing `direct` for unknown; validate the channel; carry both into the object host | F13, F14 regression | M | D |
| 17 | SDK attach guard for declarative capture and the dataLayer adapter; the click-listener leak; a real-DOM remount test | F34 | S | OL |
| 18 | The merchandiser's controls: valid stage form with correct arithmetic and no inverted fallbacks; weight readback in the slots grid; the real validator in the console test; the per-slot dimension-weight editor doc 19's acceptance sentence requires | F26, F29 | S then M | D |
| 19 | Feed normalizer: carry merchandising, accept the customer's stage words, preserve lifecycle on merge, dedupe tags, warn on empty tags, mirror `type` into `tags.contentType` | F27, new 15 | S | OL |
| 20 | Pin reservation before ranking; reject two slots pinning one piece; a signal for a dead pin; honour `slotTypes` and `take` on pinned slots | F28 | S | OL |

### Before learned lift, exploration, autonomy or any lift claim is enabled

| # | Item | Findings | Size | Owner |
|---|---|---|---|---|
| 21 | Stop publishing the holdout as incrementality: rename, drop the target reading, clamp, guard NaN, across report, fold, window and the console. Then persist arm and salt version per visitor and carry them through link and detach with the decision ring | F07, F25 | S then M | OL |
| 22 | Deduplicate on read in the day and hour loaders; one attribution reader with one cap and one horizon stamped onto every report | F16, new 23 | S then M | OL |
| 23 | Order-invariant decay (`bump` as `mergeEntry`), exact slot rates rounded only for display, a one-time counter refold, a clamped event timestamp | F18 | S | OL |
| 24 | A generation stamp on the counters that restarts learning on objective, reward, horizon or policy change; filter the online credit path to the slot's reward; currency and refunds as an explicit decision | F19 | S then M | OL |
| 25 | Priors indexed by item; a canonical cell grammar at import; a reference at cold start instead of lift 1 on a zero denominator; the prior named on the receipt | F20, new 22 | S | OL |
| 26 | Attribution `placement` axis; fatigue by slot; page in the statistics identity; brand and position on the ring entry | F21 | S then M | OL |
| 27 | Replay with every slot's snapshot version on the record; R2 before KV; fail naming the missing slot | F22 | S | OL |
| 28 | Withdraw Thompson from the schema, selects and documents until it honours the share, the context and the objective; log propensity honestly | F23 | S | OL |
| 29 | Proposal preconditions in `decideProposal` (mode, pin, age, step, current value per slot entry); receipt after the write; a page on the proposal; a role gate on apply; an evidence statistic that is not a count of tag values | F24 | S then M | OL |
| 30 | The fold: rebuild an hour whose object count grew within a maturity window; folded-hours set instead of `through`; `seen` keyed by date; flags carried into the day and window reports and rendered; raise the queue batch timeout so a quiet queue stops manufacturing objects | F17, new 8 | S then M | OL |
| 31 | Window report: refuse or flag oversized windows, undecided on incomplete days, a log relative interval, confidence into the sample size, per-tenant targets, authenticate both GETs | F25 | S | OL |
| 32 | Lift's base and reference: a base the learned term can act on at cold start; a leave-one-out slot reference; a linear id map in `buildReport` | new 20, 21, 24 | M | OL |
| 33 | Overlay reports never overwrite the stored day report | new 9 | S | OL |
| 34 | The external model: an environment switch unset everywhere, validator restricted to table and service, budget clamped, candidates filtered, a test that off makes no call, the kit line corrected | F30 | S | OL |

### Before the object host becomes the production path (recommended, not before January)

| # | Item | Findings | Size | Owner |
|---|---|---|---|---|
| 35 | The authoritative-host transition: `ShopperReflex` carries session identity, visit, channel and consent; the identity link moves with it; parity across SDK, identity, consent, sort, fatigue, erasure, rollback, then the acceptance run on both hosts | F14, F13, F05 | L | D |
| 36 | The interim KV subset: thread the client session through the event route, use the create's return value, `/sort` read-only, memoized catalog; recorded as buying time | F14 | S | D |

### Before the next customer

| # | Item | Findings | Size | Owner |
|---|---|---|---|---|
| 37 | One tenant on every path: `getConnectors(env, tenant)`, the seeded audiences, the region trend, history and link ingest, `/sort`, ODP; a runtime tenant registry; one tenant list for every cron; two non-default brands as the isolation test | F31, F33, new 29 | L | B |
| 38 | Catalog scale: drop the `config` duplicate, a size guard, a bounded isolate cache, revision retention, top-k with a parity test | F32 | S then M | OL |
| 39 | Repository: the geo seed and runbook, `setup.sh`, the served backup under `public/`, the three dead instructions, the documentation index | F35 | S | D |
| 40 | The npm package, or amend the PS guide | new 26 | S | OL |
| 41 | ODP re-seeding, or amend the design document and the plan | new 16 | M | D |

---

## 6 · Decisions only a person can make

| Decision | Who | Options |
|---|---|---|
| Whether the demo storefront and its routes ship in customer stamps at all | Simone, leadership | Item 1 removes them from enforced mode; full deployable separation (L) is the alternative |
| The staging site key, and whether the demo pages on staging get a real key | Simone | One command; the demo pages break there unless re-keyed |
| The holdout's representation to the customer | Simone with the customer's data science | Attribution diagnostic now; a real incrementality design (unit, control, metrics, window) is item 21 plus a customer-owned production control |
| Whether Thompson, autonomy and the external model hook stay in the product surface for the pilot | Simone | Withdraw (S) or repair (M each) |
| The per-customer stamp versus shared-environment model, and regional obligations | Leadership with the customer | The recorded contract says a stamp per customer; the provisioning today is per environment |
| Consent semantics for unknown and error states | Customer's privacy owner | Fail closed is the safe default and changes behaviour for cookie-blocked shoppers |
| The account path: handed password, invitation, or SSO | Customer | Doc 30 |
| Currency, refunds and margin semantics for the money objective | Customer with data science | Until agreed, the objective should read revenue-per-exposure and refuse mixed currencies |
| Whether §1.9 Product Recommendations and §1.10 AI Search are in the January scope | Leadership | They are signature clauses with no register row and no generic build |
| The kickoff date, which the Implementation Plan's every date depends on | Leadership with the customer | |

---

## 7 · Fitness, answered plainly

**For Tapestry.** The core the audit says to keep is the core the verifiers found clean: the ladder's
algebra, the intervals, the holdout hash, the merge arithmetic, attribution's axes, the arms' isolation,
the kit's routes and defaults. What is wrong is the perimeter and the plumbing around that core:
authentication and tenant binding, consent and erasure completeness, the KV authority, the configuration
store, the ledger's delivery guarantees, and a set of learning defects that each turn a correct
statistic into a wrong number. Twenty-seven of thirty-five findings, and most of the new ones, close in
one to three days each. The January content page is reachable on this architecture if items 1 to 20 land
before the customer's engineers connect, and if the lift, holdout and autonomy surfaces are held back or
relabelled until items 21 to 34 land. It is not reachable by dates alone: items 4, 5, 6 and 35 are weeks.

**For the next customer.** The engine is portable; the deployment is not. Four registries, a
per-environment provisioning script that rotates secrets, no runtime tenant list, a shared Analytics
Engine dataset, demo schema in every customer database, and whole-catalog documents in KV. Items 37 to
41 are the portability gate, and item 37 is the one that must be proven with two non-default brands
before the word "any customer" is used again. Nothing found asks for a model, a vector store or a
rewrite; everything found asks for the tenant to be carried, the write to be safe, and the number to
be honest.

---

## 8 · What this verification did not do

It did not call either stamp, deploy, or run the acceptance or load scripts, which need a live worker.
It did not read the executed contract, only the repository's tracked draft. It did not walk the console
in a browser. It reproduced every probe that can run locally, and for each finding it says which
reproduction was not possible and why. The full report of every verifier, with its probes, numbers and
line-level evidence, is committed beside this document under `docs/architecture/35-verification-reports/`,
one file per finding (F01 to F35), per section (S3 to S8) and per sweep. A remediating engineer should
read the finding's report before opening the ticket.
